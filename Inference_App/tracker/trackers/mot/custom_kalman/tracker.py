"""
trackers/mot/custom_kalman/tracker.py
---------------------------------------
Adaptateur BaseTracker -> MultiObjectTracker (Kalman + Hongrois).

CMC (Methode B - Camera Update) :
  has_internal_cmc = True -> les detections YOLO sont toujours passees brutes.
  La compensation ego-motion est appliquee en interne par
  KalmanFilter2D.camera_update(H) AVANT chaque predict().
  Resultat : x_pred = F @ (H @ x_prev) exprime dans frame_i.

  H est transmis via update(frame, detections, H=H_cmc) depuis session.py.
  H_cmc = H_ldv si use_ldv_cmc=True et LDV dispo, sinon H_image (ORB/ECC).
"""

import logging

import numpy as np

from trackers.base_tracker import BaseTracker
from trackers.mot.custom_kalman.mot_tracker import MultiObjectTracker

log = logging.getLogger(__name__)


class CustomKalmanTracker(BaseTracker):
    def __init__(self):
        self._mot = None
        self._frame_idx = 0
        self._verbose: bool = False

    def init(self, cfg: dict) -> None:
        k = cfg.get("kalman_mot_custom", cfg.get("kalman", {}))
        self._mot = MultiObjectTracker(
            max_age=int(k.get("max_age", 5)),
            min_hits=int(k.get("min_hits", 2)),
            iou_threshold=float(k.get("iou_threshold", 0.3)),
            dist_threshold=float(k.get("dist_threshold", 100)),
            process_noise=float(k.get("process_noise", 100)),
            measure_noise=float(k.get("measure_noise", 0.001)),
            use_mahalanobis=bool(k.get("use_mahalanobis", False)),
        )
        self._verbose = bool(cfg.get("debug_tracking", {}).get("verbose_mot_tracker", False))
        self._frame_idx = 0
        log.info(
            "CustomKalmanTracker.init: max_age=%d min_hits=%d iou=%.2f dist=%.0f",
            int(k.get("max_age", 5)),
            int(k.get("min_hits", 2)),
            float(k.get("iou_threshold", 0.3)),
            float(k.get("dist_threshold", 100)),
        )

    @property
    def has_internal_cmc(self) -> bool:
        """
        True : detections YOLO passees brutes ; CMC appliquee en interne
        par KalmanFilter2D.camera_update(H) AVANT predict() (Methode B).
        """
        return True

    def update(
        self,
        frame: np.ndarray,
        detections: list,
        H: np.ndarray | None = None,
    ) -> list:
        """
        Met a jour le tracker.

        Parameters
        ########
        frame      : image courante (non utilisee - interface uniformite)
        detections : list de [x1,y1,x2,y2,score,cls] YOLO bruts
        H          : homographie 3x3 frame_{i-1}->frame_i (LDV ou ORB/ECC).
                     None si indisponible ou premiere frame.

        Returns
        ######
        list de Track
        """
        tracks = self._mot.update(detections, self._frame_idx, H=H)
        log.debug(
            "CustomKalman F%05d: dets=%d -> tracks=%d  H=%s",
            self._frame_idx,
            len(detections),
            len(tracks),
            "yes" if H is not None else "no",
        )
        if self._verbose and log.isEnabledFor(logging.DEBUG):
            self._log_verbose(self._frame_idx)
        self._frame_idx += 1
        return tracks

    def _log_verbose(self, frame_idx: int) -> None:
        """Log detaille etat interne : toutes les tracks (confirmed + tentative)."""
        all_trks = self._mot._tracks
        confirmed = [t for t in all_trks if t.is_confirmed]
        tentative = [t for t in all_trks if not t.is_confirmed]
        returned = [t for t in all_trks if t.is_confirmed or t.time_since_update == 0]
        parts = []
        for t in all_trks[:12]:  # cap a 12 pour la lisibilite
            state = "CONF" if t.is_confirmed else "TENT"
            cx, cy = t.kf.position
            vx, vy = t.kf.velocity
            bx = [int(v) for v in t.bbox]
            parts.append(
                f"T{t.track_id:02d}[{state} h={t.hits} tsu={t.time_since_update}"
                f" c=({int(cx)},{int(cy)}) v=({vx:.1f},{vy:.1f}) b={bx}]"
            )
        if len(all_trks) > 12:
            parts.append(f"...+{len(all_trks) - 12}more")
        log.debug(
            "[CK F%05d] all=%d conf=%d tent=%d ret=%d | %s",
            frame_idx,
            len(all_trks),
            len(confirmed),
            len(tentative),
            len(returned),
            "  ".join(parts) if parts else "(aucune track)",
        )

    def reset(self) -> None:
        if self._mot is not None:
            self._mot._tracks = []
            self._mot._next_id = 0
        self._frame_idx = 0
        log.debug("CustomKalmanTracker.reset")
