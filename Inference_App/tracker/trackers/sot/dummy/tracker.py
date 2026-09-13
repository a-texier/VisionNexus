"""
trackers/sot/dummy/tracker.py
------------------------------
SOT dummy - selects and follows the closest MOT track to the click.

Strategy
--------
* init()   : find the MOT track whose centre is closest to the click position.
             Falls back to the click position itself when no MOT track exists.
* update() : find the MOT track whose centre is closest to the last known target
             centre.  Returns the track's bbox as the SOT result.

This tracker is purely proximity-based - no appearance model, no Kalman.
It requires the MOT tracker to keep running in background (mot_background=True).

Display behaviour (DummySot always sets hides_mot_tracks=True):
  Only the selected SOT track (magenta, ID=0) is shown; all other MOT tracks
  are hidden by the state-machine.  The MOT tracker still runs in background
  so DummySot always receives an up-to-date mot_tracks list.

Parametre unifie (top-level YAML) :
sot_click_max_dist_px : float  (default 0.0 = pas de filtre)
    Distance max (px) pour accepter une track MOT comme cible SOT a chaque frame.
    0 = pas de filtre (accepte n'importe quelle distance).
    Meme valeur que le filtre de la state_machine et de CSRT -> coherence garantie.
    Remplace l'ancien parametre dummy_sot.max_match_dist_px (supprime).
"""

import logging
import math

import numpy as np

log = logging.getLogger(__name__)


class DummySot:
    """
    Proximity-based SOT wrapper around the MOT tracker.

    The SOT target is the MOT track closest to:
      * the click position  (at init)
      * the last known target centre (at each update)

    hides_mot_tracks = True forces the state machine to:
      - always run MOT in background (regardless of mot_active state set by command)
      - return only the selected track (ID=0) to the visualizer
    This is required because DummySot has no appearance model of its own --
    it relies entirely on MOT tracks to locate the target each frame.
    """

    hides_mot_tracks: bool = True

    def __init__(self):
        self._target_cx: float = 0.0
        self._target_cy: float = 0.0
        self._target_id: int = -1
        self._initialized: bool = False
        self._max_match_dist: float = float("inf")  # overridden by configure()

    ####
    # Configuration (called by builders.build_trackers)
    ####

    def configure(self, cfg: dict) -> None:
        """
        Charge les hyperparametres depuis le config.

        sot_click_max_dist_px: 200  # [top-level, param unifie]
          Distance max (px) pour trouver la track MOT la plus proche a chaque frame.
          0 = pas de filtre (accepte n'importe quelle distance).
          Meme valeur que le filtre state_machine et CSRT -> coherence garantie.
        """
        # Parametre unifie : sot_click_max_dist_px (top-level)
        # 0 = pas de filtre -> on accepte n'importe quelle track (inf interne)
        sot_dist = float(cfg.get("sot_click_max_dist_px", 0.0))
        self._max_match_dist = float("inf") if sot_dist <= 0 else sot_dist
        log.debug(
            "DummySot.configure: max_match_dist=%s",
            "inf" if self._max_match_dist == float("inf") else f"{self._max_match_dist:.0f}px",
        )

    ####
    # SOT interface
    ####

    def init(self, frame: np.ndarray, click_pos: tuple, mot_tracks=None) -> None:
        """
        Select the MOT track closest to *click_pos*.

        Parameters
        ########
        frame      : current image (unused, kept for interface uniformity)
        click_pos  : (x, y) pixel position of the user click
        mot_tracks : current MOT track list (may be empty or None)
        """
        cx, cy = float(click_pos[0]), float(click_pos[1])

        best_trk = _closest_track(cx, cy, mot_tracks, max_dist=float("inf"))

        if best_trk is not None:
            bx1, by1, bx2, by2 = best_trk.bbox[:4]
            self._target_cx = (bx1 + bx2) / 2.0
            self._target_cy = (by1 + by2) / 2.0
            self._target_id = best_trk.track_id
            dist = _centre_dist(cx, cy, best_trk)
            log.info(
                "DummySot.init: click=(%d,%d) -> track_id=%d  dist=%.1f px"
                "  bbox=[%d,%d,%d,%d]  max_match_dist=%.0f px",
                int(cx),
                int(cy),
                best_trk.track_id,
                dist,
                int(bx1),
                int(by1),
                int(bx2),
                int(by2),
                self._max_match_dist,
            )
        else:
            # No MOT track available - anchor on click position
            self._target_cx = cx
            self._target_cy = cy
            self._target_id = -1
            log.warning(
                "DummySot.init: click=(%d,%d) -> aucune track MOT disponible."
                " DummySot ne peut pas suivre sans tracks MOT."
                " Configurer tracker_sot_solo: csrt ou sam2 pour le mode sans MOT.",
                int(cx),
                int(cy),
            )

        self._initialized = True

    def update(self, frame: np.ndarray, mot_tracks=None, H=None):
        """
        Retourne la bbox de la track MOT suivie.

        Stratégie de recherche (dans l'ordre) :
          1. Track avec le même track_id que celui sélectionné au clic (lookup exact)
          2. Track la plus proche du dernier centre connu (fallback si track perdue)
          Le fallback est limité à max_match_dist (sot_click_max_dist_px).

        Returns
        ######
        (ok, bbox, mask)
          ok   : True si la track est retrouvée
          bbox : [x1, y1, x2, y2] de la track sélectionnée
          mask : toujours None
        """
        if not self._initialized:
            log.debug("DummySot.update: not initialized")
            return False, None, None

        if not mot_tracks:
            log.debug(
                "DummySot.update: aucune track MOT (mot_background=true requis)"
                " -> echec (target_id=%d  cx=%.0f cy=%.0f)",
                self._target_id,
                self._target_cx,
                self._target_cy,
            )
            return False, None, None

        # --- Priorité 1 : retrouver la même track par ID (lookup exact) ---
        if self._target_id != -1:
            for trk in mot_tracks:
                if trk.track_id == self._target_id:
                    bx1, by1, bx2, by2 = [int(v) for v in trk.bbox[:4]]
                    self._target_cx = (bx1 + bx2) / 2.0
                    self._target_cy = (by1 + by2) / 2.0
                    log.debug(
                        "DummySot.update: [ID] track_id=%d  bbox=[%d,%d,%d,%d]",
                        self._target_id,
                        bx1,
                        by1,
                        bx2,
                        by2,
                    )
                    return True, [bx1, by1, bx2, by2], None

            # Track disparue du MOT (occultation ou fin de track) -> fallback proximité
            log.debug(
                "DummySot.update: track_id=%d disparue -> fallback proximite",
                self._target_id,
            )

        # --- Priorité 2 : track la plus proche (fallback) ---
        best_trk = _closest_track(
            self._target_cx,
            self._target_cy,
            mot_tracks,
            max_dist=self._max_match_dist,
        )

        if best_trk is None:
            any_trk = min(
                mot_tracks, key=lambda t: _centre_dist(self._target_cx, self._target_cy, t)
            )
            any_dist = _centre_dist(self._target_cx, self._target_cy, any_trk)
            log.info(
                "DummySot.update: echec - track la plus proche dist=%.1f px > seuil=%.0f px"
                " (target_id=%d cx=%.0f cy=%.0f)",
                any_dist,
                self._max_match_dist,
                self._target_id,
                self._target_cx,
                self._target_cy,
            )
            return False, None, None

        bx1, by1, bx2, by2 = [int(v) for v in best_trk.bbox[:4]]
        self._target_cx = (bx1 + bx2) / 2.0
        self._target_cy = (by1 + by2) / 2.0
        self._target_id = best_trk.track_id  # ré-ancrage sur le nouvel ID
        log.debug(
            "DummySot.update: [PROX] track_id=%d  bbox=[%d,%d,%d,%d]",
            best_trk.track_id,
            bx1,
            by1,
            bx2,
            by2,
        )
        return True, [bx1, by1, bx2, by2], None

    def reset(self) -> None:
        self._initialized = False
        self._target_cx = 0.0
        self._target_cy = 0.0
        self._target_id = -1
        log.debug("DummySot.reset")


####
# Helpers
####


def _centre_dist(cx: float, cy: float, trk) -> float:
    """Euclidean distance from (cx, cy) to the centre of trk.bbox."""
    x1, y1, x2, y2 = trk.bbox[:4]
    tx = (x1 + x2) / 2.0
    ty = (y1 + y2) / 2.0
    return math.hypot(tx - cx, ty - cy)


def _closest_track(cx: float, cy: float, mot_tracks, max_dist: float):
    """
    Return the MOT track whose centre is closest to (cx, cy).

    Returns None when *mot_tracks* is empty or the closest track is farther
    than *max_dist* pixels.
    """
    if not mot_tracks:
        return None

    best_trk = None
    best_dist = float("inf")

    for trk in mot_tracks:
        d = _centre_dist(cx, cy, trk)
        if d < best_dist:
            best_dist = d
            best_trk = trk

    if best_dist <= max_dist:
        return best_trk
    return None
