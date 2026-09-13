# ============================================================
# services/yolo_service.py
# Service de detection par un modele YOLO CUSTOM (Ultralytics).
#
# Contrairement a Grounding DINO / SAM3 (detection ouverte guidee par
# texte), YOLO a une TACHE FIXE : il detecte les classes sur lesquelles
# il a ete entraine, avec un seuil de confiance choisi. En mode "tracking
# guide" (matching par distance de centroide vers des cibles), on peut
# BAISSER le seuil de confiance YOLO : les detections parasites (fausses
# alarmes) qui n'ont pas de cible proche sont naturellement ecartees par
# le matching, ce qui donne un bon rappel sans polluer les annotations.
#
# Le chemin du modele (.pt) vient des parametres utilisateur
# (settings.algorithms.yolo_model_path), resolu par rapport au workspace.
# Plusieurs modeles peuvent etre charges (cache par chemin resolu).
# ============================================================

import logging
from pathlib import Path
from typing import List, Optional

import numpy as np

from backend.config import DATA_DIR

logger = logging.getLogger(__name__)

# ---- Detection de disponibilite d'Ultralytics ----

_YOLO_AVAILABLE = False
_yolo_device = "cpu"

try:
    import torch
    from ultralytics import YOLO  # noqa: F401

    _yolo_device = "cuda" if torch.cuda.is_available() else "cpu"
    _YOLO_AVAILABLE = True
    logger.info(f"[YOLO] Ultralytics disponible — device: {_yolo_device}")
except ImportError:
    logger.warning("[YOLO] ultralytics non disponible — detection YOLO custom desactivee")


def resolve_model_path(model_path: Optional[str]) -> Optional[Path]:
    """
    Resout un chemin de modele YOLO : absolu s'il existe, sinon relatif au
    workspace (DATA_DIR). Retourne None si vide ou introuvable.
    """
    if not model_path or not str(model_path).strip():
        return None
    p = Path(str(model_path).strip())
    if not p.is_absolute():
        p = DATA_DIR / p
    return p if p.exists() else None


class YoloService:
    """
    Service singleton de detection YOLO custom.

    Cache un modele par chemin resolu (permet de changer de modele sans
    fuite). `detect_objects` renvoie le meme format que GroundingService
    pour etre interchangeable dans le tracking guide.
    """

    def __init__(self):
        # chemin resolu (str) -> instance YOLO chargee
        self._models: dict[str, object] = {}

    @property
    def is_available(self) -> bool:
        return _YOLO_AVAILABLE

    def _get_model(self, resolved_path: Path):
        """Charge (ou recupere du cache) le modele YOLO au chemin donne."""
        key = str(resolved_path.resolve())
        model = self._models.get(key)
        if model is None:
            from ultralytics import YOLO
            logger.info(f"[YOLO] Chargement du modele {key} sur {_yolo_device}...")
            model = YOLO(key)
            try:
                model.to(_yolo_device)
            except Exception:
                pass  # certains modeles gerent le device a l'inference
            self._models[key] = model
            logger.info(f"[YOLO] Modele charge — classes: {getattr(model, 'names', {})}")
        return model

    def class_names(self, model_path: Optional[str]) -> dict:
        """Retourne le mapping {index: nom} des classes du modele, ou {}."""
        resolved = resolve_model_path(model_path)
        if resolved is None or not _YOLO_AVAILABLE:
            return {}
        try:
            model = self._get_model(resolved)
            return {int(k): str(v) for k, v in dict(getattr(model, "names", {})).items()}
        except Exception as e:
            logger.error(f"[YOLO] Impossible de lire les classes : {e}")
            return {}

    def detect_objects(
        self,
        image_path: str,
        model_path: str,
        conf_threshold: float = 0.15,
        class_filter: Optional[List[int]] = None,
        image_width: int = 640,
        image_height: int = 480,
        iou_threshold: float = 0.7,
        max_det: int = 300,
    ) -> List[dict]:
        """
        Detecte les objets avec le modele YOLO custom.

        Args:
            image_path: chemin de l'image (la LUT d'affichage est deja bakee en
                        amont par le pipeline — on charge en RGB 8 bits standard).
            model_path: chemin du modele .pt (resolu vs workspace).
            conf_threshold: seuil de confiance (BAS en mode tracking).
            class_filter: indices de classes YOLO a garder (None = toutes).
            iou_threshold: seuil NMS interne YOLO.
            max_det: nombre max de detections par image.

        Returns:
            Liste de dicts (meme forme que GroundingService.detect_objects) :
              - bbox_yolo: [cx, cy, w, h] normalise [0,1]
              - bbox_pixel: [x1, y1, x2, y2]
              - label: nom de classe YOLO
              - yolo_class_id: indice de classe YOLO (int)
              - score: confiance [0,1]
        """
        if not _YOLO_AVAILABLE:
            raise RuntimeError("ultralytics non disponible — installez 'ultralytics'")

        resolved = resolve_model_path(model_path)
        if resolved is None:
            raise RuntimeError(
                f"Modele YOLO introuvable : '{model_path}' "
                f"(cherche en absolu puis dans le workspace {DATA_DIR})"
            )

        model = self._get_model(resolved)

        # Chargement image via le pipeline commun (gere 16 bits / IR / RGB).
        # La LUT custom eventuelle est deja appliquee en amont (ai_path).
        from backend.utils.image_utils import load_image_rgb
        image_np = load_image_rgb(image_path)
        img_h, img_w = image_np.shape[:2]

        predict_kwargs = dict(
            conf=conf_threshold,
            iou=iou_threshold,
            max_det=max_det,
            verbose=False,
            device=_yolo_device,
        )
        if class_filter:
            predict_kwargs["classes"] = list(class_filter)

        results = model.predict(image_np, **predict_kwargs)
        if not results:
            return []

        res = results[0]
        boxes = getattr(res, "boxes", None)
        if boxes is None or len(boxes) == 0:
            return []

        names = {int(k): str(v) for k, v in dict(getattr(model, "names", {})).items()}
        xyxy = boxes.xyxy.cpu().numpy()
        confs = boxes.conf.cpu().numpy()
        clss = boxes.cls.cpu().numpy().astype(int)

        detections: List[dict] = []
        for (x1, y1, x2, y2), score, cls_idx in zip(xyxy, confs, clss):
            x1 = max(0.0, min(float(x1), float(img_w)))
            y1 = max(0.0, min(float(y1), float(img_h)))
            x2 = max(0.0, min(float(x2), float(img_w)))
            y2 = max(0.0, min(float(y2), float(img_h)))
            w = (x2 - x1) / img_w
            h = (y2 - y1) / img_h
            if w < 0.002 or h < 0.002:
                continue
            cx = (x1 + x2) / 2 / img_w
            cy = (y1 + y2) / 2 / img_h
            detections.append({
                "bbox_yolo": [cx, cy, w, h],
                "bbox_pixel": [x1, y1, x2, y2],
                "label": names.get(int(cls_idx), str(cls_idx)),
                "yolo_class_id": int(cls_idx),
                "score": float(score),
            })

        logger.info(
            f"[YOLO] {resolved.name} conf>={conf_threshold} -> {len(detections)} detections"
        )
        return detections

    def status(self, model_path: Optional[str] = None) -> dict:
        """Statut du service (+ etat du modele configure si fourni)."""
        resolved = resolve_model_path(model_path)
        return {
            "available": _YOLO_AVAILABLE,
            "device": _yolo_device,
            "model_path": model_path,
            "model_resolved": str(resolved) if resolved else None,
            "model_found": resolved is not None,
            "class_names": self.class_names(model_path) if resolved else {},
            "loaded": resolved is not None and str(resolved.resolve()) in self._models,
        }


# ---- Singleton global ----

_yolo_service_instance: Optional[YoloService] = None


def get_yolo_service() -> YoloService:
    """Retourne l'instance singleton du YoloService."""
    global _yolo_service_instance
    if _yolo_service_instance is None:
        _yolo_service_instance = YoloService()
    return _yolo_service_instance
