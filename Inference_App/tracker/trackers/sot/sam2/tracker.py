"""
trackers/sot/sam2/tracker.py
-----------------------------
SOT SAM 2 - niveau 3 (lourd, optionnel).
6-8 GB VRAM. Init par point (x, y) - tracker "single" par excellence.
Repo : https://github.com/facebookresearch/sam2

Installation :
  git clone https://github.com/facebookresearch/sam2 trackers/sot/sam2/sam2
  cd trackers/sot/sam2/sam2
  pip install -e .
  # Poids : https://dl.fbaipublicfiles.com/segment_anything_2/sam2_hiera_large.pt

Usage SOT Solo (sans MOT) :
  SAM2 est le tracker privilegié pour tracker_sot_solo car il démarre
  directement depuis un clic (x, y), sans bbox MOT nécessaire.
  Le mode SOT solo est activé quand une commande mot_state=0 désactive le MOT.
  Avec 8 GB VRAM, préférer sam2_hiera_small (vram_threshold_gb: 4.0).
"""

import logging
import sys
from pathlib import Path
from typing import Optional, Tuple

import numpy as np

from trackers.sot.base_sot import BaseSot
from trackers.sot.csrt.tracker import CsrtSot

log = logging.getLogger(__name__)

_FALLBACK_BOX_SIZE = 40  # px - boîte CSRT de secours centrée sur le clic


class Sam2Sot(BaseSot):
    """
    Wrapper SAM 2 pour tracking vidéo par propagation de masque.
    Fallback automatique sur CSRT si VRAM insuffisante.

    SAM2 est un tracker "point-only" : il n'a pas besoin de bbox MOT.
    Le paramètre mot_tracks est accepté pour uniformité de l'interface
    mais n'est pas utilisé (SAM2 travaille directement depuis click_pos).
    """

    def __init__(
        self,
        sam2_root: str = None,
        weights_path: str = None,
        vram_threshold_gb: float = 4.0,
    ):
        if sam2_root is None:
            sam2_root = str(Path(__file__).parent / "sam2")
        self._root = sam2_root
        self._weights = weights_path or str(Path(sam2_root) / "checkpoints" / "sam2_hiera_large.pt")
        self._threshold = vram_threshold_gb
        self._predictor = None
        self._inference_state = None
        self._obj_id = 1
        self._fallback = CsrtSot()
        self._use_fallback = False
        self._init_frame: Optional[np.ndarray] = None

    def _check_vram(self) -> bool:
        try:
            import torch

            if not torch.cuda.is_available():
                return False
            allocated = torch.cuda.memory_allocated() / 1e9
            total = torch.cuda.get_device_properties(0).total_memory / 1e9
            free = total - allocated
            log.info(
                "SAM2 VRAM: %.1f GB allocated / %.1f GB total (free: %.1f GB)",
                allocated,
                total,
                free,
            )
            return free >= self._threshold
        except Exception:
            return False

    def init(
        self,
        frame: np.ndarray,
        click_pos: tuple,
        mot_tracks=None,
    ) -> None:
        """
        Initialise SAM2 sur le point de clic.

        SAM2 est un tracker point-only - mot_tracks est ignoré.
        Seul click_pos (x, y) est utilisé comme point d'initialisation.
        """
        x, y = int(click_pos[0]), int(click_pos[1])
        h_f, w_f = frame.shape[:2]

        log.info("Sam2Sot.init: click=(%d,%d)  [point-only, mot_tracks ignored]", x, y)

        #### Fallback CSRT si VRAM insuffisante
        if not self._check_vram():
            log.warning("SAM2: insufficient VRAM (< %.1f GB) -> fallback CSRT", self._threshold)
            self._use_fallback = True
            # CSRT a besoin d'une bbox - on crée une petite boîte autour du clic
            half = _FALLBACK_BOX_SIZE // 2
            bbox_csrt = (
                max(0, x - half),
                max(0, y - half),
                min(w_f, x + half),
                min(h_f, y + half),
            )
            # Passer mot_tracks à CSRT pour qu'il cherche une meilleure bbox
            self._fallback.init(frame, click_pos, mot_tracks=mot_tracks)
            return

        #### Import SAM2
        if self._root not in sys.path:
            sys.path.insert(0, self._root)
        try:
            import torch
            from sam2.build_sam import build_sam2_video_predictor
        except ImportError as e:
            log.warning("SAM2 not installed -> fallback CSRT. %s", e)
            self._use_fallback = True
            self._fallback.init(frame, click_pos, mot_tracks=mot_tracks)
            return

        #### SAM2 init
        self._use_fallback = False
        try:
            device = "cuda"
            self._predictor = build_sam2_video_predictor(
                "sam2_hiera_l.yaml", self._weights, device=device
            )
            self._init_frame = frame
            self._inference_state = self._predictor.init_state(video_path=None)

            _, _, _ = self._predictor.add_new_points(
                inference_state=self._inference_state,
                frame_idx=0,
                obj_id=self._obj_id,
                points=np.array([[x, y]], dtype=np.float32),
                labels=np.array([1], dtype=np.int32),
            )
            log.info("SAM2 initialized on point=(%d,%d)", x, y)
        except Exception as exc:
            log.error("SAM2.init error: %s -> fallback CSRT", exc)
            self._use_fallback = True
            self._predictor = None
            self._inference_state = None
            self._fallback.init(frame, click_pos, mot_tracks=mot_tracks)

    def update(
        self,
        frame: np.ndarray,
        mot_tracks=None,
        H=None,
    ) -> Tuple[bool, Optional[list], Optional[np.ndarray]]:
        if self._use_fallback:
            return self._fallback.update(frame, mot_tracks=mot_tracks, H=H)
        if self._predictor is None or self._inference_state is None:
            return False, None, None
        try:
            for out_frame_idx, out_obj_ids, out_mask_logits in self._predictor.propagate_in_video(
                self._inference_state, max_frame_num_to_track=1
            ):
                if self._obj_id in out_obj_ids:
                    idx = list(out_obj_ids).index(self._obj_id)
                    mask = (out_mask_logits[idx] > 0.0).squeeze().cpu().numpy().astype(np.uint8)
                    ys, xs = np.where(mask)
                    if len(xs) == 0:
                        return False, None, None
                    bbox = [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())]
                    return True, bbox, mask
            return False, None, None
        except Exception as e:
            log.error("SAM2.update error: %s", e)
            return False, None, None

    def reset(self) -> None:
        if self._predictor and self._inference_state:
            try:
                self._predictor.reset_state(self._inference_state)
            except Exception:
                pass
        self._predictor = None
        self._inference_state = None
        self._use_fallback = False
        self._fallback.reset()
