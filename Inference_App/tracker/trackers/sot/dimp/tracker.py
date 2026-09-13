"""
trackers/sot/dimp/tracker.py
-----------------------------
SOT DiMP - niveau 2.
SOT IA léger (~2 GB VRAM). Fallback automatique sur CSRT si GPU insuffisant.
Repo : https://github.com/visionml/pytracking

Installation :
  git clone https://github.com/visionml/pytracking trackers/sot/dimp/pytracking
  cd trackers/sot/dimp/pytracking
  pip install -r requirements.txt
  python -c "from pytracking.evaluation import Tracker"  # test
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


class DimpSot(BaseSot):
    """
    Wrapper DiMP50 via pytracking.
    Si GPU insuffisant (VRAM < vram_threshold_gb), bascule sur CSRT.

    init() accepte un clic (x, y) et tente d'extraire la bbox initiale depuis
    les tracks MOT (closest track).  Si aucune track n'est disponible, une bbox
    par défaut (_DEFAULT_BOX_SIZE x _DEFAULT_BOX_SIZE) est centrée sur le clic.
    """

    def __init__(self, pytracking_root: str = None, vram_threshold_gb: float = 4.0):
        if pytracking_root is None:
            pytracking_root = str(Path(__file__).parent / "pytracking")
        self._root = pytracking_root
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
        Initialise DiMP sur la bbox la plus proche du clic.

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
                "DimpSot.init: no MOT bbox - default %dx%d at click",
                _DEFAULT_BOX_SIZE,
                _DEFAULT_BOX_SIZE,
            )

        x1, y1, x2, y2 = bbox
        w, h = x2 - x1, y2 - y1
        log.info(
            "DimpSot.init: click=(%d,%d)  bbox=[%d,%d,%d,%d]",
            int(cx),
            int(cy),
            x1,
            y1,
            x2,
            y2,
        )

        #### Fallback CSRT si VRAM insuffisante
        if not self._check_vram():
            log.warning("DiMP: insufficient VRAM (< %.1f GB) -> fallback CSRT", self._threshold)
            self._use_fallback = True
            self._fallback.init(frame, click_pos, mot_tracks=mot_tracks)
            return

        #### Import pytracking
        if self._root not in sys.path:
            sys.path.insert(0, self._root)
        try:
            from pytracking.evaluation import Tracker as PyTracker
        except ImportError as e:
            log.warning("DiMP: pytracking not found -> fallback CSRT. %s", e)
            self._use_fallback = True
            self._fallback.init(frame, click_pos, mot_tracks=mot_tracks)
            return

        #### DiMP init (xywh)
        self._use_fallback = False
        try:
            import torch

            tracker_obj = PyTracker("dimp", "dimp50")
            self._tracker = tracker_obj.tracker_class(tracker_obj.get_parameters())
            self._tracker.initialize(
                frame, {"init_bbox": torch.tensor([x1, y1, w, h], dtype=torch.float)}
            )
            log.info("DiMP50 initialized  bbox=[%d,%d,%d,%d]", x1, y1, x2, y2)
        except Exception as exc:
            log.error("DiMP.init error: %s -> fallback CSRT", exc)
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
            log.error("DiMP.update error: %s -> fallback CSRT", e)
            return False, None, None

    def reset(self) -> None:
        self._tracker = None
        self._use_fallback = False
        self._fallback.reset()
