# ============================================================
# services/sam_service.py
# Service singleton pour l'inférence SAM2 (Segment Anything Model 2).
#
# Fonctionnalités :
#   1. Segmentation automatique d'images (génération de masques sans prompt)
#   2. Segmentation interactive par points (foreground/background)
#   3. Propagation vidéo (tracking de masques à travers les frames)
#
# Comportement GPU/CPU :
#   - CUDA disponible → modèle large possible, autocast activé
#   - CPU seulement → force modèle tiny, autocast désactivé, batch_size=1
# ============================================================

import asyncio
import contextlib
import os
import sys
import threading
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import AsyncGenerator, Callable, Dict, List, Optional, Tuple

import numpy as np
import torch

# Vérification de la disponibilité CUDA au chargement du module
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
USING_GPU = DEVICE == "cuda"

print(f"[SAMService] Dispositif détecté : {DEVICE}")

# Dtype d'inférence GPU. Sans autocast, SAM2 tourne en float32 : les kernels
# Flash / mem-efficient de scaled_dot_product_attention sont alors REFUSÉS
# ("Expected query, key and value to all be of dtype: {Half, BFloat16}") et
# torch retombe sur l'implémentation math naïve — 3 à 5x plus lent par frame.
AUTOCAST_DTYPE = (
    torch.bfloat16
    if USING_GPU and torch.cuda.is_bf16_supported()
    else torch.float16
)

if USING_GPU:
    torch.backends.cuda.matmul.allow_tf32 = True
    torch.backends.cudnn.allow_tf32 = True


def _infer_ctx():
    """Contexte d'inférence commun (inference_mode + autocast GPU).

    Le MÊME contexte doit envelopper init_state, add_new_points_or_box et
    propagate_in_video : les features de la frame de conditionnement sont
    mémorisées puis réutilisées par la propagation, un dtype différent entre
    les deux corromprait la banque de mémoire.
    """
    stack = contextlib.ExitStack()
    stack.enter_context(torch.inference_mode())
    if USING_GPU:
        stack.enter_context(torch.autocast("cuda", dtype=AUTOCAST_DTYPE))
    return stack

# Chemin vers le repo SAMURAI cloné (backend/ext/samurai_repo/sam2)
_SAMURAI_REPO_SAM2 = Path(__file__).parent.parent / "ext" / "samurai_repo" / "sam2"
_SAMURAI_AVAILABLE = _SAMURAI_REPO_SAM2.exists()
if _SAMURAI_AVAILABLE:
    print(f"[SAMService] SAMURAI repo détecté : {_SAMURAI_REPO_SAM2}")
    # _SAMURAI_REPO_SAM2 is the repo root (backend/ext/samurai_repo/sam2/).
    # The actual sam2 Python package lives at {repo_root}/sam2/.
    # Add the repo root to sys.path so `import sam2` resolves correctly.
    _samurai_root = str(_SAMURAI_REPO_SAM2)
    if _samurai_root not in sys.path:
        sys.path.insert(0, _samurai_root)
else:
    print("[SAMService] SAMURAI repo absent — utilisation SAM2 standard")

# Configurations des modèles SAM2
# Les checkpoints sont cherchés dans backend/checkpoints/
# Noms des configs Hydra : path relatif depuis le package sam2
# Sous-dossier configs/sam2.1/ pour les modèles SAM 2.1
# Sous-dossier configs/samurai/ pour la version SAMURAI (Kalman)
MODEL_CONFIGS = {
    "tiny":      ("configs/sam2.1/sam2.1_hiera_t.yaml",  "sam2.1_hiera_tiny.pt"),
    "small":     ("configs/sam2.1/sam2.1_hiera_s.yaml",  "sam2.1_hiera_small.pt"),
    "base_plus": ("configs/sam2.1/sam2.1_hiera_b+.yaml", "sam2.1_hiera_base_plus.pt"),
    "large":     ("configs/sam2.1/sam2.1_hiera_l.yaml",  "sam2.1_hiera_large.pt"),
}

# Configs SAMURAI (mêmes checkpoints, configs différentes avec filtre Kalman)
SAMURAI_CONFIGS = {
    "tiny":      "configs/samurai/sam2.1_hiera_t.yaml",
    "small":     "configs/samurai/sam2.1_hiera_s.yaml",
    "base_plus": "configs/samurai/sam2.1_hiera_b+.yaml",
    "large":     "configs/samurai/sam2.1_hiera_l.yaml",
}

CHECKPOINTS_DIR = Path(__file__).parent.parent / "checkpoints"


@dataclass
class MaskResult:
    """Résultat d'une prédiction de masque SAM2."""
    mask: np.ndarray                    # Tableau 2D booléen (H × W)
    score: float                        # Score de confiance SAM2 [0, 1]
    bbox_yolo: Tuple[float, float, float, float]  # (cx, cy, w, h) normalisé
    bbox_pixel: Tuple[int, int, int, int]          # (x1, y1, x2, y2) en pixels
    polygon: List[Tuple[float, float]]             # Contour simplifié (normalisé)
    area: float                          # Aire du masque en pixels²


@dataclass
class VideoPropagationResult:
    """Résultat de propagation sur une frame vidéo."""
    frame_index: int
    objects: Dict[int, MaskResult]      # object_id → MaskResult
    progress: float                     # Progression [0, 1]


class SAMService:
    """
    Service singleton gérant le cycle de vie du modèle SAM2.
    Un seul modèle est chargé en mémoire GPU/CPU à la fois.
    """
    _instance: Optional["SAMService"] = None

    def __new__(cls):
        """Pattern singleton : une seule instance partagée."""
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return
        self._initialized = True

        self.device = DEVICE
        self.model_size = "tiny"  # Modèle par défaut (compatible CPU)
        self._model_loaded = False
        self._samurai_loaded = False  # True si le predicteur vidéo est SAMURAI

        # Prédicteurs SAM2 (chargés à la demande)
        self._image_predictor = None
        self._video_predictor = None
        self._auto_generator = None

        # Sessions vidéo actives : session_id → état SAM2
        self._video_sessions: Dict[str, dict] = {}

        print(f"[SAMService] Initialisé — dispositif : {self.device}")

    async def load_model(self, model_size: str = "tiny") -> dict:
        """
        Charge le modèle SAM2 en mémoire.
        Sur CPU, force le modèle 'tiny' pour limiter l'utilisation mémoire.

        Args:
            model_size: "tiny" | "small" | "base_plus" | "large"

        Returns:
            Dict avec le statut de chargement
        """
        from sam2.build_sam import build_sam2
        from sam2.sam2_image_predictor import SAM2ImagePredictor
        from sam2.automatic_mask_generator import SAM2AutomaticMaskGenerator
        from sam2.build_sam import build_sam2_video_predictor

        # Sur CPU, forcer le modèle tiny pour économiser la mémoire
        if not USING_GPU and model_size != "tiny":
            print(f"[SAMService] CPU détecté — modèle forcé à 'tiny' (demandé: {model_size})")
            model_size = "tiny"

        if model_size not in MODEL_CONFIGS:
            model_size = "tiny"

        cfg_name, checkpoint_name = MODEL_CONFIGS[model_size]
        checkpoint_path = CHECKPOINTS_DIR / checkpoint_name

        if not checkpoint_path.exists():
            # Retourner un statut d'erreur sans lever d'exception (l'app reste fonctionnelle)
            print(f"[SAMService] AVERTISSEMENT Checkpoint introuvable : {checkpoint_path}")
            print(f"[SAMService] Télécharger depuis : https://github.com/facebookresearch/segment-anything-2")
            return {
                "status": "checkpoint_missing",
                "device": self.device,
                "model": model_size,
                "checkpoint_path": str(checkpoint_path),
                "message": f"Checkpoint {checkpoint_name} absent. Voir README pour l'installation.",
            }

        try:
            print(f"[SAMService] Chargement du modèle SAM2 {model_size} sur {self.device}...")

            # Construction du modèle SAM2 pour images
            sam2_model = build_sam2(
                config_file=cfg_name,
                ckpt_path=str(checkpoint_path),
                device=self.device,
                apply_postprocessing=False,  # Postprocessing géré manuellement
            )

            self._image_predictor = SAM2ImagePredictor(sam2_model)

            # Générateur automatique de masques (pour auto-annotation)
            self._auto_generator = SAM2AutomaticMaskGenerator(
                model=sam2_model,
                points_per_side=32,
                pred_iou_thresh=0.88,
                stability_score_thresh=0.95,
                box_nms_thresh=0.7,
                min_mask_region_area=100,  # Ignore les très petites régions
            )

            # Prédicteur vidéo — utiliser SAMURAI si disponible, sinon SAM2 standard.
            # SAMURAI (yangchris11/samurai) = fork de SAM2 avec filtre de Kalman.
            # Activé par samurai_mode=True dans les configs configs/samurai/*.yaml.
            # Le package sam2 installé est le fork SAMURAI (pip install -e ext/samurai_repo/sam2).
            # Mêmes checkpoints SAM2, configs différentes → aucun téléchargement supplémentaire.
            self._video_predictor = None
            self._samurai_loaded = False

            # Essai avec les configs SAMURAI (samurai_mode=True + filtre de Kalman)
            if model_size in SAMURAI_CONFIGS:
                try:
                    samurai_cfg = SAMURAI_CONFIGS[model_size]
                    self._video_predictor = build_sam2_video_predictor(
                        config_file=samurai_cfg,
                        ckpt_path=str(checkpoint_path),
                        device=self.device,
                    )
                    self._samurai_loaded = True
                    print(f"[SAMService] SAMURAI video predictor charge (Kalman actif) — config: {samurai_cfg}")
                except Exception as se:
                    print(f"[SAMService] SAMURAI echoue ({se}) — retour SAM2 standard")

            if self._video_predictor is None:
                # Retour SAM2 standard (configs sans samurai_mode)
                try:
                    self._video_predictor = build_sam2_video_predictor(
                        config_file=cfg_name,
                        ckpt_path=str(checkpoint_path),
                        device=self.device,
                    )
                    print("[SAMService] SAM2 video predictor standard charge")
                except Exception as ve:
                    print(f"[SAMService] Predicteur video non disponible : {ve}")
                    self._video_predictor = None

            self._model_loaded = True
            self.model_size = model_size

            predictor_label = "SAMURAI" if self._samurai_loaded else "SAM2"
            print(f"[SAMService] Modele {model_size} charge sur {self.device} (video: {predictor_label})")
            return {
                "status": "loaded",
                "device": self.device,
                "model": model_size,
                "samurai": self._samurai_loaded,
                "gpu_memory_gb": self._get_gpu_memory() if USING_GPU else None,
            }

        except Exception as e:
            print(f"[SAMService] ERREUR chargement modele : {e}")
            return {"status": "error", "message": str(e), "device": self.device}

    def _get_gpu_memory(self) -> Optional[float]:
        """Retourne la mémoire GPU utilisée en Go."""
        if not USING_GPU:
            return None
        try:
            return torch.cuda.memory_allocated() / 1024**3
        except Exception:
            return None

    def get_status(self) -> dict:
        """Retourne l'état actuel du service SAM2."""
        return {
            "loaded": self._model_loaded,
            "device": self.device,
            "model": self.model_size,
            "gpu_memory_gb": self._get_gpu_memory(),
            "active_video_sessions": len(self._video_sessions),
        }

    # --------------------------------------------------------
    # Segmentation interactive par points
    # --------------------------------------------------------

    async def predict_with_points(
        self,
        image_path: str,
        points: List[Tuple[float, float]],  # Coordonnées normalisées [0,1]
        labels: List[int],                   # 1=foreground, 0=background
        image_width: int,
        image_height: int,
        multimask: bool = True,
    ) -> List[MaskResult]:
        """
        Génère des masques SAM2 depuis des points de prompt interactifs.
        Les points en entrée sont en coordonnées normalisées, convertis en pixels.

        Args:
            image_path: Chemin de l'image
            points: Liste de (x, y) normalisés dans [0, 1]
            labels: 1 = point foreground, 0 = point background
            image_width, image_height: Dimensions de l'image en pixels
            multimask: Si True, retourne les 3 meilleurs masques

        Returns:
            Liste de MaskResult triée par score décroissant
        """
        if not self._model_loaded or self._image_predictor is None:
            raise RuntimeError("Modèle SAM2 non chargé. Appelez load_model() d'abord.")

        from backend.utils.image_utils import load_image_rgb, mask_to_bbox_yolo, mask_to_polygon

        # Chargement de l'image en RGB
        image = load_image_rgb(image_path)

        # Conversion des coordonnées normalisées → pixels
        pixel_points = np.array([
            [x * image_width, y * image_height]
            for x, y in points
        ], dtype=np.float32)

        labels_array = np.array(labels, dtype=np.int32)

        # Inférence SAM2 (synchrone, exécutée dans un thread pour ne pas bloquer)
        def _predict():
            with torch.inference_mode():
                if USING_GPU:
                    with torch.autocast(device_type="cuda", dtype=torch.bfloat16):
                        return self._run_image_prediction(image, pixel_points, labels_array, multimask)
                else:
                    return self._run_image_prediction(image, pixel_points, labels_array, multimask)

        loop = asyncio.get_event_loop()
        masks, scores, _ = await loop.run_in_executor(None, _predict)

        # Conversion des masques en MaskResult
        results = []
        for mask, score in zip(masks, scores):
            bbox_yolo = mask_to_bbox_yolo(mask, image_width, image_height)
            if bbox_yolo is None:
                continue

            x1 = int((bbox_yolo[0] - bbox_yolo[2] / 2) * image_width)
            y1 = int((bbox_yolo[1] - bbox_yolo[3] / 2) * image_height)
            x2 = int((bbox_yolo[0] + bbox_yolo[2] / 2) * image_width)
            y2 = int((bbox_yolo[1] + bbox_yolo[3] / 2) * image_height)

            polygon = mask_to_polygon(mask, image_width, image_height)
            area = float(mask.sum())

            results.append(MaskResult(
                mask=mask,
                score=float(score),
                bbox_yolo=bbox_yolo,
                bbox_pixel=(x1, y1, x2, y2),
                polygon=polygon,
                area=area,
            ))

        # Tri par score décroissant
        results.sort(key=lambda r: r.score, reverse=True)
        return results

    def _run_image_prediction(self, image, pixel_points, labels_array, multimask):
        """Exécute la prédiction SAM2 image (appelé dans un thread séparé)."""
        self._image_predictor.set_image(image)
        masks, scores, logits = self._image_predictor.predict(
            point_coords=pixel_points,
            point_labels=labels_array,
            multimask_output=multimask,
        )
        return masks, scores, logits

    def predict_with_box_sync(
        self,
        image_np: "np.ndarray",  # RGB numpy array (H×W×3)
        box_pixel: tuple,        # (x1, y1, x2, y2) en pixels
    ) -> tuple:
        """
        Segmentation SAM2 synchrone à partir d'une boîte (box prompt).
        Utilisé par grounding_service pour éviter les problèmes async/inference_mode.

        Args:
            image_np: Image RGB numpy (H×W×3)
            box_pixel: Boîte englobante en pixels (x1, y1, x2, y2)

        Returns:
            (masks, scores) ou (None, None) en cas d'erreur
        """
        if not self._model_loaded or self._image_predictor is None:
            return None, None

        import torch

        def _run():
            input_box = np.array(box_pixel, dtype=np.float32)
            self._image_predictor.set_image(image_np)
            masks, scores, _ = self._image_predictor.predict(
                point_coords=None,
                point_labels=None,
                box=input_box[None, :],
                multimask_output=False,
            )
            return masks, scores

        try:
            with torch.inference_mode():
                if USING_GPU:
                    with torch.autocast(device_type="cuda", dtype=torch.bfloat16):
                        return _run()
                else:
                    return _run()
        except Exception as e:
            print(f"[SAMService] predict_with_box_sync erreur : {e}")
            return None, None

    # --------------------------------------------------------
    # Segmentation automatique (sans prompt)
    # --------------------------------------------------------

    async def auto_segment_image(
        self,
        image_path: str,
        image_width: int,
        image_height: int,
        points_per_side: int = 32,
        pred_iou_thresh: float = 0.88,
        stability_score_thresh: float = 0.95,
        min_mask_area: int = 100,
        box_nms_thresh: float = 0.7,
    ) -> AsyncGenerator[MaskResult, None]:
        """
        Génère automatiquement tous les masques d'une image (aucun prompt requis).
        Yield les résultats au fur et à mesure pour streaming WebSocket.

        Args:
            image_path: Chemin de l'image
            image_width, image_height: Dimensions pour normalisation
            points_per_side: Densité de la grille de points SAM (plus = plus de masques)
            pred_iou_thresh: Seuil de confiance IoU (0.88 recommandé)
            stability_score_thresh: Stabilité du masque (0.95 recommandé)
            min_mask_area: Surface minimale des masques en pixels²
            box_nms_thresh: Seuil NMS pour supprimer les boxes trop proches
        """
        if not self._model_loaded:
            raise RuntimeError("Modèle SAM2 non chargé.")

        from sam2.automatic_mask_generator import SAM2AutomaticMaskGenerator
        from backend.utils.image_utils import load_image_rgb, mask_to_bbox_yolo, mask_to_polygon

        image = load_image_rgb(image_path)

        # Reconfiguration du générateur avec les paramètres de l'utilisateur
        from sam2.build_sam import build_sam2
        generator = SAM2AutomaticMaskGenerator(
            model=self._image_predictor.model,
            points_per_side=points_per_side,
            pred_iou_thresh=pred_iou_thresh,
            stability_score_thresh=stability_score_thresh,
            box_nms_thresh=box_nms_thresh,
            min_mask_region_area=min_mask_area,
        )

        # Exécution dans un thread pour ne pas bloquer l'event loop
        def _generate():
            with torch.inference_mode():
                if USING_GPU:
                    with torch.autocast(device_type="cuda", dtype=torch.bfloat16):
                        return generator.generate(image)
                else:
                    return generator.generate(image)

        loop = asyncio.get_event_loop()
        masks_data = await loop.run_in_executor(None, _generate)

        # Tri des masques par score décroissant avant streaming
        masks_data.sort(key=lambda x: x["predicted_iou"], reverse=True)

        for mask_dict in masks_data:
            mask = mask_dict["segmentation"]
            score = mask_dict["predicted_iou"]
            area = mask_dict["area"]

            bbox_yolo = mask_to_bbox_yolo(mask, image_width, image_height)
            if bbox_yolo is None:
                continue

            x1 = int((bbox_yolo[0] - bbox_yolo[2] / 2) * image_width)
            y1 = int((bbox_yolo[1] - bbox_yolo[3] / 2) * image_height)
            x2 = int((bbox_yolo[0] + bbox_yolo[2] / 2) * image_width)
            y2 = int((bbox_yolo[1] + bbox_yolo[3] / 2) * image_height)

            polygon = mask_to_polygon(mask, image_width, image_height)

            result = MaskResult(
                mask=mask,
                score=float(score),
                bbox_yolo=bbox_yolo,
                bbox_pixel=(x1, y1, x2, y2),
                polygon=polygon,
                area=float(area),
            )

            yield result

            # Pause pour permettre à l'event loop de traiter d'autres tâches
            await asyncio.sleep(0)

    # --------------------------------------------------------
    # Propagation vidéo SAM2
    # --------------------------------------------------------

    def configure_video_tracking(self, num_objects: int) -> str:
        """
        Prépare le prédicteur vidéo pour un run de tracking.

        SAMURAI ne suit qu'UNE seule cible : son filtre de Kalman est un état
        UNIQUE porté par le modèle (`kf_mean`, `kf_covariance`, `stable_frames`).
        Avec plusieurs objets, la comparaison `ious[0][best_iou_inds] > seuil`
        porte sur un tenseur multi-éléments → RuntimeError « Boolean value of
        Tensor with more than one value is ambiguous ». On bascule donc en SAM2
        multi-objets natif (samurai_mode=False) dès qu'il y a > 1 cible, et on
        remet SAMURAI pour une cible unique.

        Réinitialise aussi l'état du Kalman : le modèle est un singleton partagé,
        un run précédent laisserait `kf_mean` non nul et corromprait le suivant.

        Retourne le label du tracker effectivement actif ('SAMURAI' | 'SAM2').
        """
        base = getattr(self._video_predictor, "module", self._video_predictor)
        want_samurai = self._samurai_loaded and num_objects <= 1
        if hasattr(base, "samurai_mode"):
            base.samurai_mode = want_samurai
        # Reset de l'état Kalman quel que soit le mode (évite les fuites d'état)
        for attr, val in (
            ("kf_mean", None), ("kf_covariance", None),
            ("stable_frames", 0), ("frame_cnt", 0),
        ):
            if hasattr(base, attr):
                setattr(base, attr, val)
        return "SAMURAI" if want_samurai else "SAM2"

    async def init_video_session(
        self,
        frames_dir: str,
        frame_count: int,
        async_loading: bool = True,
        offload_video_to_cpu: Optional[bool] = None,
    ) -> str:
        """
        Initialise une session de prédiction vidéo SAM2/SAMURAI.
        Retourne un session_id unique pour les appels suivants.

        Args:
            frames_dir: Répertoire contenant les frames nommées {N}.jpg (entiers purs)
            frame_count: Nombre total de frames à propager
            async_loading: Si True, les frames sont chargées PARESSEUSEMENT en
                arrière-plan (AsyncVideoFrameLoader) : la propagation démarre
                quasi immédiatement au lieu d'attendre le chargement complet
                (~2 min pour 2000 frames). Chaque frame se charge à la demande,
                ce qui donne un vrai avancement temps réel côté UI.

        Returns:
            session_id (UUID)

        Notes:
            - offload_video_to_cpu=True : toutes les frames restent en RAM CPU,
              seule la frame courante est envoyée au GPU lors du traitement.
              Cela évite les OOM GPU sur les vidéos 4K et les modèles lourds.
            - L'appel à init_state est exécuté dans un thread (run_in_executor)
              pour ne pas bloquer l'event loop FastAPI.
        """
        if not self._model_loaded or self._video_predictor is None:
            raise RuntimeError("Prédicteur vidéo SAM2 non disponible.")

        session_id = str(uuid.uuid4())

        # Offload configurable : par défaut True (économise la VRAM, cf. Notes).
        # Sur GPU à grosse VRAM (>=~24 Go), le mettre à False garde toutes les
        # frames sur le GPU → supprime la copie CPU→GPU par frame → 1.5–3x plus
        # rapide. Piloté par ANNOTATION_SAM2_OFFLOAD_CPU (0/1) si non précisé.
        if offload_video_to_cpu is None:
            offload_video_to_cpu = os.environ.get(
                "ANNOTATION_SAM2_OFFLOAD_CPU", "1"
            ).strip().lower() not in ("0", "false", "no", "off")

        # Exécution dans un thread → ne bloque pas l'event loop
        loop = asyncio.get_event_loop()

        def _init():
            with _infer_ctx():
                return self._video_predictor.init_state(
                    video_path=frames_dir,
                    offload_video_to_cpu=offload_video_to_cpu,
                    async_loading_frames=async_loading,
                )

        inference_state = await loop.run_in_executor(None, _init)

        self._video_sessions[session_id] = {
            "inference_state": inference_state,
            "frames_dir": frames_dir,
            "frame_count": frame_count,
            "object_prompts": {},  # object_id → {frame_index, points, labels}
            "offload_video_to_cpu": offload_video_to_cpu,
        }

        return session_id

    async def add_video_prompt(
        self,
        session_id: str,
        frame_index: int,
        object_id: int,
        points: List[Tuple[float, float]],  # Coordonnées normalisées
        labels: List[int],
        image_width: int,
        image_height: int,
        box: Optional[Tuple[float, float, float, float]] = None,  # (x1,y1,x2,y2) normalisé
    ) -> MaskResult:
        """
        Ajoute un prompt pour un objet spécifique sur une frame de référence.
        Si `box` est fourni (recommandé — c'est le mode d'emploi SAMURAI),
        la boîte englobante est utilisée comme prompt : bien plus fiable
        qu'un simple point central pour cibler l'objet à suivre.
        """
        if session_id not in self._video_sessions:
            raise ValueError(f"Session vidéo introuvable : {session_id}")

        sess = self._video_sessions[session_id]
        inference_state = sess["inference_state"]

        # Conversion coordonnées normalisées → pixels
        pixel_points = np.array([
            [x * image_width, y * image_height]
            for x, y in points
        ], dtype=np.float32)
        labels_array = np.array(labels, dtype=np.int32)
        pixel_box = None
        if box is not None:
            pixel_box = np.array([
                box[0] * image_width,
                box[1] * image_height,
                box[2] * image_width,
                box[3] * image_height,
            ], dtype=np.float32)

        # Exécution dans un thread pour ne pas bloquer l'event loop
        loop = asyncio.get_event_loop()

        def _add_prompt():
            with _infer_ctx():
                if pixel_box is not None:
                    # Box prompt seul : SAM2/SAMURAI cible exactement l'objet annoté
                    return self._video_predictor.add_new_points_or_box(
                        inference_state=inference_state,
                        frame_idx=frame_index,
                        obj_id=object_id,
                        box=pixel_box,
                    )
                return self._video_predictor.add_new_points_or_box(
                    inference_state=inference_state,
                    frame_idx=frame_index,
                    obj_id=object_id,
                    points=pixel_points,
                    labels=labels_array,
                )

        _, obj_ids, mask_logits = await loop.run_in_executor(None, _add_prompt)

        # Extraction du masque pour l'objet ajouté
        obj_idx = list(obj_ids).index(object_id) if object_id in obj_ids else 0
        mask = (mask_logits[obj_idx, 0] > 0.0).cpu().numpy()

        from backend.utils.image_utils import mask_to_bbox_yolo, mask_to_polygon
        bbox_yolo = mask_to_bbox_yolo(mask, image_width, image_height) or (0.5, 0.5, 0.1, 0.1)

        x1 = int((bbox_yolo[0] - bbox_yolo[2] / 2) * image_width)
        y1 = int((bbox_yolo[1] - bbox_yolo[3] / 2) * image_height)
        x2 = int((bbox_yolo[0] + bbox_yolo[2] / 2) * image_width)
        y2 = int((bbox_yolo[1] + bbox_yolo[3] / 2) * image_height)

        sess["object_prompts"][object_id] = {
            "frame_index": frame_index,
            "image_width": image_width,
            "image_height": image_height,
        }

        return MaskResult(
            mask=mask,
            score=1.0,  # Score de confiance initial (prompt manuel)
            bbox_yolo=bbox_yolo,
            bbox_pixel=(x1, y1, x2, y2),
            polygon=mask_to_polygon(mask, image_width, image_height),
            area=float(mask.sum()),
        )

    async def propagate_video(
        self,
        session_id: str,
        image_width: int,
        image_height: int,
        should_stop: Optional[Callable[[], bool]] = None,
        need_polygon: bool = True,
        reverse: bool = False,
        start_frame_idx: Optional[int] = None,
    ) -> AsyncGenerator[VideoPropagationResult, None]:
        """
        Propage les masques sur toute la séquence vidéo.
        Yield les résultats frame par frame en temps réel.

        Architecture :
            - Un thread DÉDIÉ (pas le threadpool anyio partagé avec les endpoints
              FastAPI sync) exécute propagate_in_video() frame par frame.
            - Une Queue thread-safe transfère les résultats au générateur async.
            - L'event loop FastAPI n'est jamais bloqué : chaque frame GPU est
              isolée dans le thread, le générateur attend via asyncio.

        Args:
            session_id: ID de la session vidéo initialisée
            image_width, image_height: Dimensions des frames (pour normalisation)
            should_stop: Prédicat consulté par le worker AVANT chaque frame.
                C'est le SEUL arrêt propre : sans lui, un `break` côté appelant
                laisse le thread bloqué à jamais sur queue.put() (queue pleine,
                plus aucun consommateur) alors que l'appelant libère déjà
                l'inference_state et supprime les JPEG sous ses pieds.
            need_polygon: False en mode bbox — évite un cv2.findContours sur un
                masque pleine résolution par frame (coûteux, tient le GIL).
            reverse: True = remonter le temps depuis la frame de référence
                (annoter 500 puis demander 300). SAM2 sait le faire nativement ;
                la mémoire est alimentée dans l'ordre de parcours, pas dans
                l'ordre des indices.
            start_frame_idx: index (dans le tableau de frames) d'où partir.
                None = la frame de conditionnement, ce qui suffit tant que la
                référence est la première frame de la plage.

        Yields:
            VideoPropagationResult avec les masques de chaque frame
        """
        if session_id not in self._video_sessions:
            raise ValueError(f"Session vidéo introuvable : {session_id}")

        sess = self._video_sessions[session_id]
        inference_state = sess["inference_state"]
        frame_count = sess["frame_count"]

        from backend.utils.image_utils import mask_to_bbox_yolo, mask_to_polygon
        from concurrent.futures import ThreadPoolExecutor
        import queue as _queue

        # Sentinelle pour signaler la fin de la propagation
        _DONE = object()

        result_queue: "_queue.Queue" = _queue.Queue(maxsize=4)  # buffer limité
        stop_event = threading.Event()

        def _put(item) -> bool:
            """Dépose un item sans jamais bloquer indéfiniment.
            Retourne False si l'arrêt a été demandé pendant l'attente."""
            while not stop_event.is_set():
                try:
                    result_queue.put(item, timeout=0.25)
                    return True
                except _queue.Full:
                    continue
            return False

        def _worker():
            """Thread : exécute propagate_in_video et pousse les résultats dans la queue."""
            try:
                with _infer_ctx():
                    for frame_idx, obj_ids, mask_logits in self._video_predictor.propagate_in_video(
                        inference_state,
                        start_frame_idx=start_frame_idx,
                        reverse=reverse,
                    ):
                        if stop_event.is_set() or (should_stop is not None and should_stop()):
                            break

                        frame_objects: Dict[int, MaskResult] = {}

                        for i, obj_id in enumerate(obj_ids):
                            mask = (mask_logits[i, 0] > 0.0).cpu().numpy()
                            bbox_yolo = mask_to_bbox_yolo(mask, image_width, image_height)
                            if bbox_yolo is None:
                                continue

                            x1 = int((bbox_yolo[0] - bbox_yolo[2] / 2) * image_width)
                            y1 = int((bbox_yolo[1] - bbox_yolo[3] / 2) * image_height)
                            x2 = int((bbox_yolo[0] + bbox_yolo[2] / 2) * image_width)
                            y2 = int((bbox_yolo[1] + bbox_yolo[3] / 2) * image_height)

                            frame_objects[int(obj_id)] = MaskResult(
                                mask=mask,
                                score=0.9,
                                bbox_yolo=bbox_yolo,
                                bbox_pixel=(x1, y1, x2, y2),
                                polygon=(
                                    mask_to_polygon(mask, image_width, image_height)
                                    if need_polygon else []
                                ),
                                area=float(mask.sum()),
                            )

                        progress = (frame_idx + 1) / max(frame_count, 1)
                        if not _put(VideoPropagationResult(
                            frame_index=frame_idx,
                            objects=frame_objects,
                            progress=progress,
                        )):
                            break
            except Exception as exc:
                _put(exc)
            finally:
                # put_nowait : la queue vient d'être drainée par le finally du
                # générateur en cas d'arrêt, et _DONE ne doit jamais bloquer.
                with contextlib.suppress(Exception):
                    result_queue.put_nowait(_DONE)

        loop = asyncio.get_event_loop()
        # Pool dédié : le pool par défaut est celui des endpoints FastAPI sync.
        # Y bloquer un worker GPU long + un queue.get() affamait les requêtes
        # (navigation, status, stop) → l'app entière devenait non réactive.
        pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="sam2prop")
        worker_fut = loop.run_in_executor(pool, _worker)

        def _get_next():
            """Attend un item, en repassant la main régulièrement pour rester
            interruptible même si le worker met plusieurs secondes par frame."""
            while True:
                try:
                    return result_queue.get(timeout=0.5)
                except _queue.Empty:
                    if stop_event.is_set():
                        return _DONE

        try:
            while True:
                item = await loop.run_in_executor(pool, _get_next)
                if item is _DONE:
                    break
                if isinstance(item, Exception):
                    raise item
                yield item
                await asyncio.sleep(0)  # libère l'event loop entre chaque frame
        finally:
            # Arrêt inconditionnel du worker, y compris si l'appelant a `break`
            # ou si une exception a traversé le générateur.
            stop_event.set()
            while True:
                try:
                    result_queue.get_nowait()
                except _queue.Empty:
                    break
            with contextlib.suppress(Exception):
                await asyncio.wait_for(asyncio.shield(worker_fut), timeout=30)
            pool.shutdown(wait=False)

    def close_video_session(self, session_id: str) -> None:
        """
        Libère les ressources GPU/CPU associées à une session vidéo.
        À appeler après la fin de la propagation ou en cas d'annulation.
        """
        if session_id in self._video_sessions:
            sess = self._video_sessions.pop(session_id)
            # Nettoyage de l'état SAM2 (libère la mémoire GPU)
            if self._video_predictor is not None:
                try:
                    self._video_predictor.reset_state(sess["inference_state"])
                except Exception:
                    pass
            print(f"[SAMService] Session vidéo {session_id} fermée")


# Instance singleton partagée entre les routers
sam_service = SAMService()
