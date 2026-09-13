"""
trackers/mot/bytetrack/tracker.py
----------------------------------
Wrapper ByteTrack -> BaseTracker.
Repo source : https://github.com/ifzhang/ByteTrack
Ne JAMAIS modifier le code du repo clone - wrapper uniquement.

Installation :
  git clone https://github.com/ifzhang/ByteTrack trackers/mot/bytetrack/ByteTrack
  pip install -r trackers/mot/bytetrack/ByteTrack/requirements.txt

CMC (Methode B interne) :
  has_internal_cmc = True -> H est applique aux etats Kalman internes de
  ByteTrack (STrack.mean) AVANT tracker.update() via _apply_camera_update().
  Methode B : H @ (cx, cy, vx, vy) via Jacobien analytique de H.
  Source de H : LDV (use_ldv_cmc=True) ou ORB/ECC si LDV indisponible.
  => Les detections YOLO sont toujours passees brutes (jamais compensees).
"""

import logging
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional

import numpy as np

from trackers.base_tracker import BaseTracker

log = logging.getLogger(__name__)

_HISTORY_MAX = 50


@dataclass
class _TrackAdapter:
    """Adapte un STrack ByteTrack vers l'interface commune (Track de core.tracker)."""

    track_id: int
    bbox: list
    score: float
    is_confirmed: bool = True
    time_since_update: int = 0
    history: list = field(default_factory=list)

    def predicted_bbox(self) -> list:
        return self.bbox


class ByteTrackWrapper(BaseTracker):
    """
    Wrapper ByteTrack.
    Attend que le repo soit cloné dans :
      trackers/mot/bytetrack/ByteTrack/
    """

    @property
    def has_internal_cmc(self) -> bool:
        """True : CMC appliquee en interne via _apply_camera_update (Methode B)."""
        return True

    def __init__(self, bytetrack_root: str = None):
        if bytetrack_root is None:
            bytetrack_root = str(Path(__file__).parent / "ByteTrack")
        self._root = bytetrack_root
        self._tracker = None
        self._history: dict = {}
        self._verbose: bool = False
        self._min_box_area: float = 10.0
        self._show_kalman_predict: bool = False

    def init(self, config: dict) -> None:
        root = config.get("bytetrack_root", None)
        if root:
            p = Path(root)
            if not p.is_absolute():
                project_root = Path(__file__).parent.parent.parent.parent
                p = (project_root / p).resolve()
            self._root = str(p)
        if self._root not in sys.path:
            sys.path.insert(0, self._root)

        from argparse import Namespace

        from yolox.tracker.byte_tracker import BYTETracker

        bt = config.get("bytetrack", {})
        self._min_box_area: float = float(bt.get("min_box_area", 10))
        self._show_kalman_predict = bool(bt.get("show_kalman_predict", False))
        args = Namespace(
            track_thresh=bt.get("track_thresh", 0.5),
            track_buffer=bt.get("track_buffer", 30),
            match_thresh=bt.get("match_thresh", 0.8),
            mot20=bt.get("mot20", False),
        )
        self._tracker = BYTETracker(args, frame_rate=config.get("fps", 10))
        # Bruit Kalman : std_weight_position et velocity sont des facteurs
        # multiplicatifs appliques a la hauteur du bbox pour obtenir les ecarts-types.
        # Defauts ByteTrack : pos=0.05 (1/20), vel=0.00625 (1/160).
        # Pour cibles IR 5x2px : augmenter pos et vel aide a absorber le bruit.
        _kf_pos = float(bt.get("kalman_std_position", 1.0 / 20))
        _kf_vel = float(bt.get("kalman_std_velocity", 1.0 / 160))
        kf = getattr(self._tracker, "kalman_filter", None)
        if kf is not None:
            kf._std_weight_position = _kf_pos
            kf._std_weight_velocity = _kf_vel
        self._verbose = bool(config.get("debug_tracking", {}).get("verbose_mot_tracker", False))
        log.info(
            "ByteTrack initialise (track_thresh=%.2f  det_thresh=%.2f  match_thresh=%.2f  "
            "min_box_area=%.0f  kf_pos=%.4f  kf_vel=%.5f)",
            bt.get("track_thresh", 0.5),
            bt.get("track_thresh", 0.5) + 0.1,
            bt.get("match_thresh", 0.8),
            self._min_box_area,
            _kf_pos,
            _kf_vel,
        )

    def _apply_camera_update(self, H: np.ndarray) -> None:
        """
        Methode B : applique H aux etats Kalman internes de ByteTrack.

        ByteTrack STrack.mean = [cx, cy, a, h, vx, vy, va, vh] (8D).
        On warp les positions (cx, cy) et vitesses (vx, vy) via le Jacobien
        analytique de H au point (cx, cy). Les composantes a, h, va, vh
        restent inchangees (invariantes par rotation camera pure).

        Appele AVANT tracker.update() pour que la prediction interne de
        ByteTrack parte d'un etat deja exprime dans frame_i.
        """
        if H is None or self._tracker is None:
            return
        all_stracks = getattr(self._tracker, "tracked_stracks", []) + getattr(
            self._tracker, "lost_stracks", []
        )
        for st in all_stracks:
            if getattr(st, "mean", None) is None:
                continue
            cx, cy = float(st.mean[0]), float(st.mean[1])
            w = H[2, 0] * cx + H[2, 1] * cy + H[2, 2]
            if abs(w) < 1e-8:
                continue
            cx_w = (H[0, 0] * cx + H[0, 1] * cy + H[0, 2]) / w
            cy_w = (H[1, 0] * cx + H[1, 1] * cy + H[1, 2]) / w
            vx, vy = float(st.mean[4]), float(st.mean[5])
            # Jacobien d(cx',cy')/d(cx,cy) au point (cx, cy)
            J00 = (H[0, 0] - cx_w * H[2, 0]) / w
            J01 = (H[0, 1] - cx_w * H[2, 1]) / w
            J10 = (H[1, 0] - cy_w * H[2, 0]) / w
            J11 = (H[1, 1] - cy_w * H[2, 1]) / w
            st.mean[0] = cx_w
            st.mean[1] = cy_w
            st.mean[4] = J00 * vx + J01 * vy
            st.mean[5] = J10 * vx + J11 * vy

    def update(
        self,
        frame: np.ndarray,
        detections: List[List[float]],
        H: Optional[np.ndarray] = None,
    ) -> list:
        """
        Met a jour ByteTrack pour une frame (Methode B CMC interne).

        H est applique aux etats STrack AVANT tracker.update() :
        la prediction interne de ByteTrack part d'un etat dans frame_i.
        Les detections sont passees brutes (jamais compensees).
        """
        if self._tracker is None:
            raise RuntimeError("Appeler init() avant update()")

        # Methode B : warp des etats Kalman dans frame_i avant prediction
        self._apply_camera_update(H)

        h, w = frame.shape[:2]
        img_info = (h, w)
        img_size = (h, w)

        if not detections:
            online_targets = self._tracker.update(
                np.empty((0, 5), dtype=np.float32), img_info, img_size
            )
        else:
            dets_np = np.array([[*d[:4], d[4]] for d in detections], dtype=np.float32)
            online_targets = self._tracker.update(dets_np, img_info, img_size)

        results = []
        active_ids = set()
        for t in online_targets:
            tlwh = t.tlwh
            if tlwh[2] * tlwh[3] < self._min_box_area:
                continue
            x1, y1 = tlwh[0], tlwh[1]
            x2, y2 = x1 + tlwh[2], y1 + tlwh[3]
            tid = t.track_id
            cx, cy = (x1 + x2) / 2, (y1 + y2) / 2
            hist = self._history.setdefault(tid, [])
            hist.append((cx, cy))
            if len(hist) > _HISTORY_MAX:
                hist.pop(0)
            active_ids.add(tid)
            results.append(
                _TrackAdapter(
                    track_id=tid,
                    bbox=[x1, y1, x2, y2],
                    score=t.score,
                    is_confirmed=True,
                    time_since_update=0,
                    history=list(hist),
                )
            )
        # Predictions Kalman des tracks perdues (show_kalman_predict: true)
        if self._show_kalman_predict:
            for st in getattr(self._tracker, "lost_stracks", []):
                tid = st.track_id
                if tid in active_ids:
                    continue
                tlwh = st.tlwh
                if tlwh[2] * tlwh[3] < self._min_box_area:
                    continue
                x1, y1 = tlwh[0], tlwh[1]
                x2, y2 = x1 + tlwh[2], y1 + tlwh[3]
                cx, cy = (x1 + x2) / 2, (y1 + y2) / 2
                hist = self._history.setdefault(tid, [])
                hist.append((cx, cy))
                if len(hist) > _HISTORY_MAX:
                    hist.pop(0)
                active_ids.add(tid)
                results.append(
                    _TrackAdapter(
                        track_id=tid,
                        bbox=[x1, y1, x2, y2],
                        score=float(getattr(st, "score", 0.0)),
                        is_confirmed=bool(getattr(st, "is_activated", True)),
                        time_since_update=1,
                        history=list(hist),
                    )
                )

        # Nettoyer l'historique des tracks inactifs
        for tid in list(self._history):
            if tid not in active_ids:
                del self._history[tid]

        if self._verbose and log.isEnabledFor(logging.DEBUG):
            self._log_verbose(results)

        return results

    def _log_verbose(self, results: list) -> None:
        """Log detaille etat interne ByteTrack (tracked + lost stracks)."""
        tr_st = getattr(self._tracker, "tracked_stracks", [])
        lo_st = getattr(self._tracker, "lost_stracks", [])
        parts = []
        for st in tr_st[:10]:
            mean = getattr(st, "mean", None)
            cx = int(mean[0]) if mean is not None else "?"
            cy = int(mean[1]) if mean is not None else "?"
            vx = f"{mean[4]:.1f}" if mean is not None else "?"
            vy = f"{mean[5]:.1f}" if mean is not None else "?"
            tlen = getattr(st, "tracklet_len", "?")
            sc = getattr(st, "score", 0.0)
            parts.append(
                f"T{st.track_id:02d}[tr len={tlen} s={sc:.2f} c=({cx},{cy}) v=({vx},{vy})]"
            )
        for st in lo_st[:4]:
            tlen = getattr(st, "tracklet_len", "?")
            parts.append(f"T{st.track_id:02d}[LOST len={tlen}]")
        if len(tr_st) > 10:
            parts.append(f"...+{len(tr_st) - 10}more")
        log.debug(
            "[ByteTrack] tracked=%d lost=%d ret=%d | %s",
            len(tr_st),
            len(lo_st),
            len(results),
            "  ".join(parts) if parts else "(aucune track)",
        )

    def reset(self) -> None:
        self._history.clear()
        if self._tracker is not None:
            self.init({})
