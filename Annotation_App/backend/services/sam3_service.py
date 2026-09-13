# ============================================================
# services/sam3_service.py
# Service singleton pour SAM3.1 (Segment Anything Model 3).
#
# SAM3 permet l'annotation par texte en open-vocabulary :
#   - "voiture rouge", "personne debout", "vélo", etc.
#   - 4M+ concepts (vs ~80 classes COCO pour DINO tiny)
#
# Différences avec SAM2 + Grounding DINO :
#   - SAM3 est un modèle unifié (pas deux modèles en pipeline)
#   - Meilleure discrimination entre concepts proches
#   - Nécessite un accès HuggingFace approuvé (facebook/sam3)
#
# API :
#   from backend.services.sam3_service import get_sam3_service
#   sam3 = get_sam3_service()
#   if sam3.is_available:
#       results = await sam3.detect_and_segment(image_path, "voiture. personne.")
#
# Checkpoint requis : backend/checkpoints/sam3.1_hiera_large.pt
#   Téléchargement : python backend/tests/download_sam3.py
# ============================================================

import logging
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

logger = logging.getLogger(__name__)

# ---- Ajout du repo SAM3 au sys.path ----
# SAM3 est cloné dans backend/models/sam3/ — pas un package PyPI
_SAM3_REPO = Path(__file__).parent.parent / "models" / "sam3"
if _SAM3_REPO.exists() and str(_SAM3_REPO) not in sys.path:
    sys.path.insert(0, str(_SAM3_REPO))

# ---- Vérification des dépendances SAM3 ----
_SAM3_AVAILABLE = False
try:
    import torch
    from sam3.model_builder import build_sam3_image_model
    from sam3.model.sam3_image_processor import Sam3Processor
    _TORCH_DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
    _SAM3_AVAILABLE = True
    logger.info(f"[SAM3Service] SAM3 disponible — device: {_TORCH_DEVICE}")
except ImportError as e:
    logger.warning(f"[SAM3Service] SAM3 non disponible : {e}")
    _TORCH_DEVICE = "cpu"

# Dossier et checkpoint SAM3.1
# Les fichiers sont telecharges par : python backend/tests/download_sam3.py
# Stockes localement dans backend/checkpoints/sam3.1/ (pas dans le cache HF)
CHECKPOINT_DIR  = Path(__file__).parent.parent / "checkpoints" / "sam3.1"
CHECKPOINT_PATH = CHECKPOINT_DIR / "sam3.1_multiplex.pt"


class SAM3Service:
    """
    Service singleton encapsulant SAM3.1 pour l'annotation par texte.

    Utilisation :
        sam3 = SAM3Service()
        if sam3.is_available:
            sam3.load_model()
            results = await sam3.detect_and_segment(image_path, "voiture. personne.")
    """

    _instance: Optional["SAM3Service"] = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return
        self._initialized = True
        self._model = None
        self._processor = None
        self._is_loaded = False

    # ---- Propriétés d'état ----

    @property
    def is_available(self) -> bool:
        """Vrai si SAM3 est installé (checkpoint non requis)."""
        return _SAM3_AVAILABLE

    @property
    def checkpoint_exists(self) -> bool:
        """Vrai si le checkpoint est présent sur le disque."""
        return CHECKPOINT_PATH.exists()

    @property
    def is_loaded(self) -> bool:
        """Vrai si le modèle est chargé en mémoire."""
        return self._is_loaded

    def get_status(self) -> Dict[str, Any]:
        """Retourne le statut complet du service pour l'API /health."""
        return {
            "available":        _SAM3_AVAILABLE,
            "checkpoint_exists": self.checkpoint_exists,
            "loaded":           self._is_loaded,
            "device":           _TORCH_DEVICE,
            "model":            "sam3.1_multiplex" if self._is_loaded else None,
            "checkpoint_path":  str(CHECKPOINT_PATH),
        }

    # ---- Chargement du modèle ----

    def load_model(self) -> bool:
        """
        Charge SAM3.1 en mémoire GPU/CPU.

        Returns:
            True si chargement réussi, False sinon.
        """
        if self._is_loaded:
            return True

        if not _SAM3_AVAILABLE:
            logger.warning("[SAM3Service] SAM3 non installé — chargement impossible")
            return False

        if not self.checkpoint_exists:
            logger.warning(f"[SAM3Service] Checkpoint absent : {CHECKPOINT_PATH}")
            logger.warning("[SAM3Service] Lancez : python backend/tests/download_sam3.py")
            return False

        try:
            logger.info(f"[SAM3Service] Chargement depuis {CHECKPOINT_PATH}...")
            # load_from_HF=False : aucune requete reseau, tout est local
            # checkpoint_path=... : chemin explicite vers le .pt local
            self._model = build_sam3_image_model(
                checkpoint_path=str(CHECKPOINT_PATH),
                load_from_HF=False,
                device=_TORCH_DEVICE,
            )
            # Ne pas appeler .float() : le modele contient des casts internes
            # explicites vers bfloat16 (sam3_image.py ligne 864). Le modele
            # doit etre execute sous torch.autocast(bfloat16) — cf. scripts
            # officiels qualitative_test.py et measure_speed.py.
            self._model.eval()
            self._processor = Sam3Processor(
                self._model, device=_TORCH_DEVICE
            )
            self._is_loaded = True
            logger.info(f"[SAM3Service] Modele charge sur {_TORCH_DEVICE.upper()}")
            return True
        except Exception as e:
            logger.error(f"[SAM3Service] Erreur chargement : {e}")
            self._model = None
            self._processor = None
            return False

    # ---- Détection et segmentation par texte ----

    async def detect_and_segment(
        self,
        image_path: str,
        text_prompt: str,
        img_width: int,
        img_height: int,
    ) -> List[Dict[str, Any]]:
        """
        Détecte et segmente les objets décrits par le texte.

        Args:
            image_path: Chemin absolu vers l'image
            text_prompt: Description des objets à détecter
                         Exemple : "voiture. personne debout. vélo."
            img_width, img_height: Dimensions de l'image pour normalisation

        Returns:
            Liste de détections, chaque dict contenant :
            - bbox_yolo: [cx, cy, w, h] normalisé [0,1]
            - bbox_pixel: [x1, y1, x2, y2] en pixels
            - polygon: liste de [x, y] normalisés (contour)
            - score: score de confiance [0,1]
            - label: texte du prompt ayant généré cette détection
        """
        if not self._is_loaded:
            if not self.load_model():
                raise RuntimeError(
                    "SAM3 non disponible. "
                    "Téléchargez le checkpoint : python backend/tests/download_sam3.py"
                )

        import torch
        from PIL import Image as PILImage

        # Chargement de l'image en PIL (format attendu par SAM3).
        # Passe par load_image_rgb pour gérer les images 16 bits (3-sigma).
        from backend.utils.image_utils import load_image_rgb
        pil_image = PILImage.fromarray(load_image_rgb(image_path))
        w, h = pil_image.size

        detections = []

        # Le modele SAM3 contient des casts internes vers bfloat16
        # (sam3_image.py). L'inference doit etre enveloppee dans autocast
        # bfloat16 — conformement aux scripts officiels du depot.
        # Sur CPU, bfloat16 est moins bien supporte : on reste en float32.
        _device_type = "cuda" if _TORCH_DEVICE.startswith("cuda") else "cpu"
        _infer_dtype = torch.bfloat16 if _device_type == "cuda" else torch.float32

        with torch.inference_mode():
            with torch.autocast(device_type=_device_type, dtype=_infer_dtype):
                # Encodage de l'image (une fois pour tous les prompts)
                state = self._processor.set_image(pil_image)

                # Traitement de chaque sous-prompt séparé par '.'
                # Exemple : "voiture. personne." → ["voiture", "personne"]
                prompts = [p.strip() for p in text_prompt.split(".") if p.strip()]
                if not prompts:
                    prompts = [text_prompt.strip()]

                for prompt in prompts:
                    try:
                        output = self._processor.set_text_prompt(state=state, prompt=prompt)
                        masks  = output.get("masks",  [])
                        boxes  = output.get("boxes",  [])
                        scores = output.get("scores", [])

                        n_det = len(masks) if hasattr(masks, "__len__") else 0

                        for i in range(n_det):
                            # Extraction de la bounding box (x1, y1, x2, y2 pixels)
                            # .float() pour convertir bfloat16 → float32 avant numpy
                            raw_box = boxes[i]
                            if hasattr(raw_box, "cpu"):
                                raw_box = raw_box.float().cpu()
                            box = np.array(raw_box) if not hasattr(raw_box, "numpy") else raw_box.numpy()
                            x1, y1, x2, y2 = float(box[0]), float(box[1]), float(box[2]), float(box[3])

                            # Conversion vers YOLO normalisé
                            cx = (x1 + x2) / 2 / w
                            cy = (y1 + y2) / 2 / h
                            bw = (x2 - x1) / w
                            bh = (y2 - y1) / h

                            # Extraction du masque (contour → polygone normalisé)
                            mask = masks[i]
                            if hasattr(mask, "cpu"):
                                mask = mask.float().cpu()
                            mask_np = np.array(mask)
                            if mask_np.ndim == 3:
                                mask_np = mask_np[0]
                            polygon = _mask_to_polygon(
                                (mask_np > 0.5).astype(np.uint8) * 255, w, h
                            )

                            raw_score = scores[i]
                            score = float(raw_score.float().cpu()) if hasattr(raw_score, "cpu") else float(raw_score)

                            detections.append({
                                "bbox_yolo":  [cx, cy, bw, bh],
                                "bbox_pixel": [int(x1), int(y1), int(x2), int(y2)],
                                "polygon":    polygon,
                                "score":      score,
                                "label":      prompt,
                            })

                    except Exception as e:
                        logger.warning(f"[SAM3Service] Erreur prompt '{prompt}' : {e}")
                        continue

        return detections


# ============================================================
# Utilitaires internes
# ============================================================

def _mask_to_polygon(
    mask_uint8: np.ndarray,
    img_w: int,
    img_h: int,
    epsilon_ratio: float = 0.005,
) -> List[List[float]]:
    """
    Convertit un masque binaire (0/255) en polygone simplifié normalisé.

    Args:
        mask_uint8: Tableau H×W uint8 (0 ou 255)
        img_w, img_h: Dimensions de l'image pour normalisation
        epsilon_ratio: Facteur d'approximation du contour (0.005 = lissé)

    Returns:
        Liste de [x_norm, y_norm] (vide si contour non trouvé)
    """
    import cv2

    contours, _ = cv2.findContours(mask_uint8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return []

    # Contour le plus large (objet principal)
    contour = max(contours, key=cv2.contourArea)
    epsilon = epsilon_ratio * cv2.arcLength(contour, closed=True)
    approx  = cv2.approxPolyDP(contour, epsilon, closed=True)

    # Normalisation [0, 1]
    points = []
    for pt in approx.reshape(-1, 2):
        points.append([float(pt[0]) / img_w, float(pt[1]) / img_h])

    return points


# ---- Singleton d'accès global ----
_sam3_service_instance: Optional[SAM3Service] = None


def get_sam3_service() -> SAM3Service:
    """Retourne l'instance singleton de SAM3Service."""
    global _sam3_service_instance
    if _sam3_service_instance is None:
        _sam3_service_instance = SAM3Service()
    return _sam3_service_instance
