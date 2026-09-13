# ============================================================
# services/grounding_service.py
# Service de segmentation guidée par texte (Grounding DINO + SAM2).
# Permet d'annoter automatiquement en décrivant les objets en langage
# naturel : "voiture rouge", "personne debout", etc.
#
# Architecture :
#   1. Grounding DINO (via HuggingFace transformers) → boîtes englobantes
#   2. SAM2 image predictor → masques précis à partir des boîtes
#
# Fallback gracieux si Grounding DINO n'est pas disponible.
# ============================================================

import logging
from pathlib import Path
from typing import Optional

import numpy as np

logger = logging.getLogger(__name__)

# ---- Détection de disponibilité de Grounding DINO ----

_GROUNDING_AVAILABLE = False
_grounding_processor = None
_grounding_model = None
_grounding_device = "cpu"

try:
    import torch
    from transformers import AutoProcessor, AutoModelForZeroShotObjectDetection

    _grounding_device = "cuda" if torch.cuda.is_available() else "cpu"
    _GROUNDING_AVAILABLE = True
    logger.info(f"[Grounding] Grounding DINO disponible — device: {_grounding_device}")
except ImportError:
    logger.warning("[Grounding] transformers non disponible — texte-SAM désactivé")


class GroundingService:
    """
    Service singleton pour la détection d'objets guidée par texte.

    Utilise Grounding DINO (IDEA-Research/grounding-dino-tiny) pour localiser
    les objets décrits en texte, puis SAM2 pour générer des masques précis.

    Modèle par défaut : grounding-dino-tiny (léger, ~172M paramètres)
    Alternative       : grounding-dino-base (~341M paramètres, plus précis)

    Priorité de chargement :
      1. backend/checkpoints/grounding_dino/ (local, offline)
      2. HuggingFace Hub (téléchargement auto, connexion requise)

    Pour télécharger en local :
      python backend/tests/download_grounding_dino.py
    """

    # Chemin local (téléchargé par download_grounding_dino.py)
    _LOCAL_MODEL_DIR = Path(__file__).parent.parent / "checkpoints" / "grounding_dino"
    # ID HuggingFace de repli si le modèle local n'est pas présent
    _HF_MODEL_ID = "IDEA-Research/grounding-dino-tiny"

    @property
    def MODEL_ID(self) -> str:
        """Retourne le chemin local si disponible, sinon l'ID HuggingFace."""
        if (self._LOCAL_MODEL_DIR / "config.json").exists():
            return str(self._LOCAL_MODEL_DIR)
        return self._HF_MODEL_ID

    def __init__(self):
        self._is_loaded = False
        self._processor = None
        self._model = None

    @property
    def is_available(self) -> bool:
        """Vérifie si Grounding DINO est disponible dans l'environnement."""
        return _GROUNDING_AVAILABLE

    def load(self) -> bool:
        """
        Charge le modèle Grounding DINO en mémoire.
        Retourne True si chargé avec succès, False sinon.
        """
        if not _GROUNDING_AVAILABLE:
            return False

        if self._is_loaded:
            return True

        try:
            import torch
            from transformers import AutoProcessor, AutoModelForZeroShotObjectDetection

            model_path = self.MODEL_ID
            is_local = (self._LOCAL_MODEL_DIR / "config.json").exists()

            logger.info(f"[Grounding] Chargement depuis {'local' if is_local else 'HuggingFace'}...")
            logger.info(f"[Grounding] Source : {model_path}")

            # local_files_only=True quand le modele est local → aucune requete reseau
            kwargs = {"local_files_only": True} if is_local else {}

            self._processor = AutoProcessor.from_pretrained(model_path, **kwargs)
            self._model = AutoModelForZeroShotObjectDetection.from_pretrained(
                model_path, **kwargs
            ).to(_grounding_device)
            self._model.eval()

            self._is_loaded = True
            logger.info(f"[Grounding] Modele charge sur {_grounding_device} (offline={is_local})")
            return True

        except Exception as e:
            logger.error(f"[Grounding] Erreur chargement modèle : {e}")
            return False

    def detect_objects(
        self,
        image_path: str,
        text_prompt: str,
        box_threshold: float = 0.35,
        text_threshold: float = 0.25,
        image_width: int = 640,
        image_height: int = 480,
    ) -> list[dict]:
        """
        Détecte les objets décrits par le texte dans l'image.

        Args:
            image_path: Chemin vers l'image
            text_prompt: Description textuelle, ex: "voiture. personne. vélo."
                         Séparer les classes par des points pour multi-classes.
            box_threshold: Seuil de confiance pour les boîtes (0.0-1.0)
            text_threshold: Seuil de confiance pour le texte (0.0-1.0)
            image_width: Largeur de l'image (pour normalisation)
            image_height: Hauteur de l'image (pour normalisation)

        Returns:
            Liste de dicts avec :
                - bbox_yolo: [cx, cy, w, h] normalisé [0,1]
                - label: texte du label détecté
                - score: confiance [0,1]
        """
        if not self._is_loaded:
            if not self.load():
                raise RuntimeError("Grounding DINO non disponible — installez transformers>=4.37")

        try:
            import torch
            from PIL import Image as PILImage

            # Chargement de l'image (gère aussi le 16 bits RGB/IR via 3-sigma)
            from backend.utils.image_utils import load_image_rgb
            image = PILImage.fromarray(load_image_rgb(image_path))
            img_w, img_h = image.size

            # Formatage du prompt : Grounding DINO attend des phrases séparées par ". "
            # et terminées par un point.
            formatted_prompt = text_prompt.strip()
            if not formatted_prompt.endswith("."):
                formatted_prompt += "."

            # Inférence Grounding DINO
            inputs = self._processor(
                images=image,
                text=formatted_prompt,
                return_tensors="pt"
            ).to(_grounding_device)

            with torch.no_grad():
                outputs = self._model(**inputs)

            # Post-traitement : conversion en boîtes normalisées
            # Compatibilite transformers >= 4.38 (signature modifiee)
            try:
                results = self._processor.post_process_grounded_object_detection(
                    outputs,
                    inputs.input_ids,
                    box_threshold=box_threshold,
                    text_threshold=text_threshold,
                    target_sizes=[(img_h, img_w)],
                )[0]
            except TypeError:
                # Ancienne API sans box_threshold dans cette methode
                # => filtrage manuel apres
                results_raw = self._processor.post_process_grounded_object_detection(
                    outputs,
                    inputs.input_ids,
                    target_sizes=[(img_h, img_w)],
                )[0]
                # Filtrage manuel par seuil
                keep = results_raw["scores"] >= box_threshold
                results = {
                    "boxes": results_raw["boxes"][keep],
                    "scores": results_raw["scores"][keep],
                    "labels": [l for l, k in zip(results_raw["labels"], keep.tolist()) if k],
                }

            detections = []

            for box, score, label in zip(
                results["boxes"].cpu().numpy(),
                results["scores"].cpu().numpy(),
                results["labels"],
            ):
                # box est en format [x1, y1, x2, y2] en pixels
                x1, y1, x2, y2 = box.tolist()

                # Clamp aux limites de l'image
                x1 = max(0.0, min(float(x1), float(img_w)))
                y1 = max(0.0, min(float(y1), float(img_h)))
                x2 = max(0.0, min(float(x2), float(img_w)))
                y2 = max(0.0, min(float(y2), float(img_h)))

                # Conversion en YOLO normalisé (cx, cy, w, h)
                cx = (x1 + x2) / 2 / img_w
                cy = (y1 + y2) / 2 / img_h
                w = (x2 - x1) / img_w
                h = (y2 - y1) / img_h

                # Filtrage des boîtes trop petites (< 0.5% de l'image)
                if w < 0.005 or h < 0.005:
                    continue

                detections.append({
                    "bbox_yolo": [cx, cy, w, h],
                    "bbox_pixel": [x1, y1, x2, y2],
                    "label": str(label),
                    "score": float(score),
                })

            logger.info(
                f"[Grounding] '{formatted_prompt}' → {len(detections)} détections "
                f"(seuil={box_threshold})"
            )

            return detections

        except Exception as e:
            logger.error(f"[Grounding] Erreur détection : {e}")
            raise

    def detect_and_segment(
        self,
        image_path: str,
        text_prompt: str,
        sam_service,   # SAMService injecté pour éviter import circulaire
        box_threshold: float = 0.35,
        text_threshold: float = 0.25,
    ) -> list[dict]:
        """
        Pipeline complet : Grounding DINO → boîtes → SAM2 → masques.

        Args:
            image_path: Chemin vers l'image
            text_prompt: Description textuelle des objets à détecter
            sam_service: Instance du SAMService pour la segmentation
            box_threshold: Seuil confiance boîtes Grounding DINO
            text_threshold: Seuil confiance texte Grounding DINO

        Returns:
            Liste de dicts avec bbox_yolo, polygon, label, score
        """
        from PIL import Image as PILImage

        with PILImage.open(image_path) as _img_meta:
            img_w, img_h = _img_meta.size

        # Étape 1 : Détection par texte → boîtes
        detections = self.detect_objects(
            image_path=image_path,
            text_prompt=text_prompt,
            box_threshold=box_threshold,
            text_threshold=text_threshold,
            image_width=img_w,
            image_height=img_h,
        )

        if not detections:
            return []

        # Étape 2 : Pour chaque boîte, générer un masque SAM2
        # Si SAM2 non disponible, on retourne les boîtes seules
        if not sam_service or not sam_service._model_loaded:
            logger.warning("[Grounding] SAM2 non chargé — retour des boîtes seules")
            return [{
                "bbox_yolo": d["bbox_yolo"],
                "polygon": [],
                "label": d["label"],
                "score": d["score"],
            } for d in detections]

        results = []

        try:
            import numpy as np

            # Chargement de l'image pour SAM2 (gère aussi le 16 bits via 3-sigma)
            from backend.utils.image_utils import load_image_rgb
            image_np = load_image_rgb(image_path)

            for detection in detections:
                cx, cy, w, h = detection["bbox_yolo"]

                # Conversion bbox YOLO → pixel [x1, y1, x2, y2] pour SAM2
                x1 = (cx - w / 2) * img_w
                y1 = (cy - h / 2) * img_h
                x2 = (cx + w / 2) * img_w
                y2 = (cy + h / 2) * img_h

                try:
                    # SAM2 via méthode publique (gère inference_mode en interne)
                    masks, scores = sam_service.predict_with_box_sync(
                        image_np=image_np,
                        box_pixel=(x1, y1, x2, y2),
                    )

                    if masks is None or len(masks) == 0:
                        raise RuntimeError("SAM2 n'a retourné aucun masque")

                    # Extraction du meilleur masque
                    best_mask = masks[0]  # (H, W) bool
                    polygon = _mask_to_polygon(best_mask, img_w, img_h)

                    results.append({
                        "bbox_yolo": detection["bbox_yolo"],
                        "polygon": polygon,
                        "label": detection["label"],
                        "score": float(scores[0]),
                    })

                except Exception as e:
                    logger.warning(f"[Grounding] SAM2 erreur sur détection : {e}")
                    # Fallback : retourner la boîte sans masque
                    results.append({
                        "bbox_yolo": detection["bbox_yolo"],
                        "polygon": [],
                        "label": detection["label"],
                        "score": detection["score"],
                    })

        except Exception as e:
            logger.error(f"[Grounding] Erreur pipeline segmentation : {e}")
            # Fallback complet : boîtes seules
            return [{
                "bbox_yolo": d["bbox_yolo"],
                "polygon": [],
                "label": d["label"],
                "score": d["score"],
            } for d in detections]

        return results

    @property
    def status(self) -> dict:
        """Retourne le statut du service."""
        return {
            "available": self.is_available,
            "loaded": self._is_loaded,
            "model": self.MODEL_ID if self._is_loaded else None,
            "device": _grounding_device,
        }


def _mask_to_polygon(
    mask: "np.ndarray",
    img_w: int,
    img_h: int,
    max_points: int = 64,
) -> list[list[float]]:
    """
    Convertit un masque binaire (H, W) en polygone simplifié normalisé.
    Utilise les contours OpenCV et simplifie avec l'algorithme Douglas-Peucker.

    Returns:
        Liste de points [[x, y], ...] normalisés dans [0, 1]
    """
    try:
        import cv2

        # Conversion masque bool → uint8
        mask_uint8 = (mask.astype(np.uint8)) * 255

        # Extraction des contours
        contours, _ = cv2.findContours(
            mask_uint8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
        )

        if not contours:
            return []

        # On prend le plus grand contour
        largest_contour = max(contours, key=cv2.contourArea)

        # Simplification du polygone (ε = 1% de la diagonale)
        epsilon = 0.01 * cv2.arcLength(largest_contour, True)
        simplified = cv2.approxPolyDP(largest_contour, epsilon, True)

        # Limitation du nombre de points
        if len(simplified) > max_points:
            step = len(simplified) // max_points
            simplified = simplified[::step]

        # Normalisation dans [0, 1]
        points = []
        for pt in simplified:
            x, y = pt[0]
            points.append([
                float(max(0, min(x, img_w))) / img_w,
                float(max(0, min(y, img_h))) / img_h,
            ])

        return points

    except Exception as e:
        logger.warning(f"[Grounding] Erreur conversion masque→polygone : {e}")
        return []


# ---- Singleton global ----

_grounding_service_instance: Optional[GroundingService] = None


def get_grounding_service() -> GroundingService:
    """Retourne l'instance singleton du GroundingService."""
    global _grounding_service_instance
    if _grounding_service_instance is None:
        _grounding_service_instance = GroundingService()
    return _grounding_service_instance
