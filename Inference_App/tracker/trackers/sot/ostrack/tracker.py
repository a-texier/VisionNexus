"""
trackers/sot/ostrack/tracker.py
--------------------------------
SOT OSTrack - niveau 2 bis.
Transformer-based SOT one-stream (~3 GB VRAM).
Repo : https://github.com/botaoye/OSTrack

Installation :
  git clone https://github.com/botaoye/OSTrack trackers/sot/ostrack/OSTrack
  cd trackers/sot/ostrack/OSTrack
  pip install -r requirements.txt
"""

import logging
import sys
from pathlib import Path
from typing import Optional, Tuple

import numpy as np

from trackers.sot.base_sot import BaseSot, find_bbox_from_tracks
from trackers.sot.csrt.tracker import CsrtSot

log = logging.getLogger(__name__)

_DEFAULT_BOX_SIZE = 60  # px - bbox de secours si aucune track MOT


class OSTrackSot(BaseSot):
    """
    Wrapper OSTrack.
    Si GPU insuffisant (VRAM < vram_threshold_gb), bascule sur CSRT.

    init() accepte un clic (x, y) et tente d'extraire la bbox initiale depuis
    les tracks MOT (closest track).  Si aucune track n'est disponible, une bbox
    par défaut (_DEFAULT_BOX_SIZE x _DEFAULT_BOX_SIZE) est centrée sur le clic.
    """

    def __init__(self, ostrack_root: str = None, vram_threshold_gb: float = 4.0):
        if ostrack_root is None:
            ostrack_root = str(Path(__file__).parent / "OSTrack")
        self._root = ostrack_root
        self._threshold = vram_threshold_gb
        self._tracker = None
        self._fallback = CsrtSot()
        self._use_fallback = False

    def _check_vram(self) -> bool:
        try:
            import torch

            if not torch.cuda.is_available():
                return False
            free = (
                torch.cuda.get_device_properties(0).total_memory - torch.cuda.memory_allocated()
            ) / 1e9
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
        Initialise OSTrack sur la bbox la plus proche du clic.

        Priorité bbox :
          1. Track MOT contenant le clic (hit exact)
          2. Track MOT dont le centre est le plus proche (≤ 300 px)
          3. Boîte par défaut _DEFAULT_BOX_SIZE x _DEFAULT_BOX_SIZE centrée sur le clic
        """
        cx, cy = float(click_pos[0]), float(click_pos[1])

        bbox = find_bbox_from_tracks(cx, cy, mot_tracks)
        if bbox is None:
            h_f, w_f = frame.shape[:2]
            half = _DEFAULT_BOX_SIZE // 2
            x1 = max(0, int(cx) - half)
            y1 = max(0, int(cy) - half)
            x2 = min(w_f, int(cx) + half)
            y2 = min(h_f, int(cy) + half)
            bbox = [x1, y1, x2, y2]
            log.debug(
                "OSTrackSot.init: no MOT bbox - default %dx%d at click",
                _DEFAULT_BOX_SIZE,
                _DEFAULT_BOX_SIZE,
            )

        x1, y1, x2, y2 = bbox
        log.info(
            "OSTrackSot.init: click=(%d,%d)  bbox=[%d,%d,%d,%d]",
            int(cx),
            int(cy),
            x1,
            y1,
            x2,
            y2,
        )

        #### Fallback CSRT si VRAM insuffisante
        if not self._check_vram():
            log.warning("OSTrack: insufficient VRAM -> fallback CSRT")
            self._use_fallback = True
            self._fallback.init(frame, click_pos, mot_tracks=mot_tracks)
            return

        #### Import OSTrack
        if self._root not in sys.path:
            sys.path.insert(0, self._root)
        try:
            from lib.test.evaluation import Tracker as OSTTracker
        except ImportError as e:
            log.warning("OSTrack: not installed -> fallback CSRT. %s", e)
            self._use_fallback = True
            self._fallback.init(frame, click_pos, mot_tracks=mot_tracks)
            return

        #### OSTrack init (x1, y1, w, h)
        self._use_fallback = False
        try:
            tracker_obj = OSTTracker("ostrack", "vitb_256_mae_ce_32x4_ep300")
            w_box = x2 - x1
            h_box = y2 - y1
            self._tracker = tracker_obj
            self._tracker.initialize(frame, {"init_bbox": [x1, y1, w_box, h_box]})
            log.info("OSTrack initialized  bbox=[%d,%d,%d,%d]", x1, y1, x2, y2)
        except Exception as exc:
            log.error("OSTrack.init error: %s -> fallback CSRT", exc)
            self._use_fallback = True
            self._tracker = None
            self._fallback.init(frame, click_pos, mot_tracks=mot_tracks)

    def update(
        self,
        frame: np.ndarray,
        mot_tracks=None,
        H=None,
    ) -> Tuple[bool, Optional[list], Optional[np.ndarray]]:
        if self._use_fallback:
            return self._fallback.update(frame, mot_tracks=mot_tracks, H=H)
        if self._tracker is None:
            return False, None, None
        try:
            out = self._tracker.track(frame)
            x, y, w, h = out["target_bbox"]
            return True, [x, y, x + w, y + h], None
        except Exception as e:
            log.error("OSTrack.update error: %s", e)
            return False, None, None

    def reset(self) -> None:
        self._tracker = None
        self._use_fallback = False
        self._fallback.reset()
