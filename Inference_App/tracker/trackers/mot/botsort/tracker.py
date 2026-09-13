"""
trackers/mot/botsort/tracker.py
--------------------------------
Wrapper BoT-SORT -> BaseTracker.
Repo source : https://github.com/NirAharon/BoT-SORT
Ne JAMAIS modifier le code du repo clone - wrapper uniquement.

Installation :
  git clone https://github.com/NirAharon/BoT-SORT trackers/mot/botsort/BoT-SORT
  pip install -r trackers/mot/botsort/BoT-SORT/requirements.txt

CMC - Bypass LDV (use_ldv_cmc=True dans config) :
  Quand H est fourni a update() (H_cmc = H_ldv de session.py), le
  monkey-patch sur gmc.apply retourne directement la matrice affine 2x3
  derivee de H_ldv (H_3x3[:2,:] approx affine), sans calcul image.
  Gain de calcul : eliminiation de sparseOptFlow (feature matching image).
  BoT-SORT applique ce warp a ses predictions Kalman exactement comme il
  le ferait avec son GMC interne - aucune modif de la lib.

  Quand H=None (use_ldv_cmc=False ou LDV indisponible) :
  gmc.apply est appele normalement (sparseOptFlow/ORB/ECC depuis l'image).

  Note : H_ldv est une homographie 3x3 ; BoT-SORT attend une matrice
  affine 2x3 (estimateAffinePartial2D). On utilise H[:2,:] comme
  approximation affine valide pour les petites rotations inertielle.
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
    track_id: int
    bbox: list
    score: float
    is_confirmed: bool = True
    time_since_update: int = 0
    history: list = field(default_factory=list)

    def predicted_bbox(self) -> list:
        return self.bbox


class BotSortWrapper(BaseTracker):
    """
    Wrapper BoT-SORT.
    Attend que le repo soit cloné dans :
      trackers/mot/botsort/BoT-SORT/
    """

    def __init__(self, botsort_root: str = None):
        if botsort_root is None:
            botsort_root = str(Path(__file__).parent / "BoT-SORT")
        self._root = botsort_root
        self._tracker = None
        self._history: dict = {}
        # Methode GMC configuree (lue dans init()) - determine has_own_image_cmc
        self._cmc_method: str = "sparseOptFlow"
        # Homographie 2x3 capturee depuis GMC apres chaque update()
        # Convertie en 3x3 par get_last_homography() pour la reprojection des clics.
        self._last_warp_2x3: Optional[np.ndarray] = None
        # Warp LDV 2x3 injecte dans gmc.apply pour le bypass LDV
        # Fixe avant chaque update() quand H_cmc est disponible ; None sinon.
        self._ldv_warp_2x3: Optional[np.ndarray] = None
        self._verbose: bool = False
        self._show_kalman_predict: bool = False

    def init(self, config: dict) -> None:
        root = config.get("botsort_root", None)
        if root:
            # Resolve relative paths against the project root (main.py's directory),
            # not the shell CWD (which may differ when called with absolute path).
            p = Path(root)
            if not p.is_absolute():
                # Anchor to the directory containing this tracker.py, go up 4 levels:
                # tracker.py -> botsort/ -> mot/ -> trackers/ -> project_root/
                project_root = Path(__file__).parent.parent.parent.parent
                p = (project_root / p).resolve()
            self._root = str(p)
        if self._root not in sys.path:
            sys.path.insert(0, self._root)
        try:
            from argparse import Namespace

            from tracker.bot_sort import BoTSORT
        except ImportError as e:
            raise ImportError(
                f"BoT-SORT non trouve dans {self._root}. "
                "Cloner : git clone https://github.com/NirAharon/BoT-SORT"
            ) from e

        bs = config.get("botsort", {})
        self._cmc_method = bs.get("cmc_method", "sparseOptFlow")
        args = Namespace(
            track_high_thresh=bs.get("track_high_thresh", 0.5),
            track_low_thresh=bs.get("track_low_thresh", 0.1),
            new_track_thresh=bs.get("new_track_thresh", 0.6),
            track_buffer=bs.get("track_buffer", 30),
            match_thresh=bs.get("match_thresh", 0.8),
            proximity_thresh=bs.get("proximity_thresh", 0.5),
            appearance_thresh=bs.get("appearance_thresh", 0.25),
            with_reid=bs.get("with_reid", False),
            fast_reid_config=bs.get("fast_reid_config", ""),
            fast_reid_weights=bs.get("fast_reid_weights", ""),
            device=config.get("device", "cpu"),
            fp16=bs.get("fp16", False),
            fuse_score=bs.get("fuse_score", False),
            mot20=bs.get("mot20", False),
            cmc_method=self._cmc_method,
            name=bs.get("name", "botsort"),
            ablation=bs.get("ablation", False),
        )

        self._tracker = BoTSORT(args, frame_rate=config.get("fps", 10))
        # Bruit Kalman - meme interface que ByteTrack (std proportionnel a bbox height).
        # Defauts BoT-SORT : pos=0.05 (1/20), vel=0.00625 (1/160).
        _kf_pos = float(bs.get("kalman_std_position", 1.0 / 20))
        _kf_vel = float(bs.get("kalman_std_velocity", 1.0 / 160))
        kf = getattr(self._tracker, "kalman_filter", None)
        if kf is not None:
            kf._std_weight_position = _kf_pos
            kf._std_weight_velocity = _kf_vel
        self._last_warp_2x3 = None
        self._verbose = bool(config.get("debug_tracking", {}).get("verbose_mot_tracker", False))
        self._show_kalman_predict = bool(bs.get("show_kalman_predict", False))

        #### Monkey-patch GMC.apply - capture + bypass LDV
        # Deux roles combines sans toucher au repo clone :
        #  1. Capture le warp calcule pour get_last_homography() (reprojection clics)
        #  2. Bypass LDV : si _ldv_warp_2x3 est fixe avant update(), retourne
        #     directement cette valeur sans calcul image (sparseOptFlow skippe).
        #     Gain de calcul ~5-15 ms/frame selon resolution.
        gmc = getattr(self._tracker, "gmc", None)
        if gmc is not None:
            _self = self
            _orig_apply = gmc.apply  # methode liee capturee dans la fermeture

            def _apply_capturing(img, dets, _orig=_orig_apply):
                # Bypass LDV : si un warp externe est disponible, l'utiliser
                # directement sans calcul image.
                if _self._ldv_warp_2x3 is not None:
                    warp = _self._ldv_warp_2x3
                else:
                    # prevKeyPoints=None quand goodFeaturesToTrack n'a rien trouvé
                    # sur la frame précédente (frame noire de timeout, IR uniforme,
                    # ou saut de frame_id avec --conflate/--drop).
                    # Forcer la ré-init avant l'appel pour éviter le crash dans
                    # calcOpticalFlowPyrLK (assertion npoints >= 0 échoue sur None).
                    if getattr(gmc, "prevKeyPoints", None) is None and getattr(
                        gmc, "initializedFirstFrame", False
                    ):
                        gmc.initializedFirstFrame = False
                        log.debug("BoT-SORT GMC réinitialisé (prevKeyPoints=None)")
                    warp = _orig(img, dets)
                # warp est une matrice affine 2x3 (estimateAffinePartial2D)
                _self._last_warp_2x3 = warp.copy() if warp is not None else None
                return warp

            # Remplacement sur l'instance (prioritaire sur la classe en Python)
            gmc.apply = _apply_capturing
            log.debug("BoT-SORT GMC.apply patche (capture + bypass LDV)")
        else:
            log.warning(
                "BoT-SORT : attribut 'gmc' introuvable - get_last_homography() retournera None"
            )

        log.info(
            "BoT-SORT initialise (with_reid=%s  cmc=%s  kf_pos=%.4f  kf_vel=%.5f)",
            args.with_reid,
            args.cmc_method,
            _kf_pos,
            _kf_vel,
        )

    @staticmethod
    def _to_bgr(frame: np.ndarray) -> np.ndarray:
        """Convertit IR uint16/float 2D -> uint8 BGR 3 canaux (requis par GMC)."""
        import cv2

        img = frame.astype(np.float32)
        lo, hi = img.min(), img.max()
        if hi > lo:
            img = (img - lo) / (hi - lo) * 255.0
        img = img.clip(0, 255).astype(np.uint8)
        if img.ndim == 2:
            img = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
        return img

    def update(
        self,
        frame: np.ndarray,
        detections: List[List[float]],
        H: Optional[np.ndarray] = None,
    ) -> list:
        """
        Met a jour BoT-SORT pour une frame.

        Parameters
        ########
        frame      : image courante (utilisee par gmc.apply si H=None)
        detections : detections YOLO brutes [x1,y1,x2,y2,score]
                     NON compensees exterieurement (has_internal_cmc=True)
        H          : homographie 3x3 frame_{i-1}->frame_i ou None.
                     Si fourni (use_ldv_cmc=True, LDV disponible) :
                       - converti en warp 2x3 affine (H[:2,:])
                       - inject dans gmc.apply -> sparseOptFlow skippe
                     Si None : gmc.apply calcule le warp depuis l'image.
        """
        if self._tracker is None:
            raise RuntimeError("Appeler init() avant update()")

        # Bypass LDV : convertir H 3x3 en warp affine 2x3 pour gmc.apply
        if H is not None:
            self._ldv_warp_2x3 = H[:2, :].astype(np.float64)
        else:
            self._ldv_warp_2x3 = None

        bgr = self._to_bgr(frame)
        if not detections:
            online_targets = self._tracker.update(np.empty((0, 5), dtype=np.float32), bgr)
        else:
            dets_np = np.array([[*d[:4], d[4]] for d in detections], dtype=np.float32)
            online_targets = self._tracker.update(dets_np, bgr)

        results = []
        active_ids = set()
        for t in online_targets:
            tlwh = t.tlwh
            x1, y1 = tlwh[0], tlwh[1]
            x2, y2 = x1 + tlwh[2], y1 + tlwh[3]
            tid = int(t.track_id)
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
                    score=float(t.score),
                    is_confirmed=True,
                    time_since_update=0,
                    history=list(hist),
                )
            )
        # Predictions Kalman des tracks perdues (show_kalman_predict: true)
        if self._show_kalman_predict:
            for st in getattr(self._tracker, "lost_stracks", []):
                tid = int(st.track_id)
                if tid in active_ids:
                    continue
                tlwh = st.tlwh
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

        for tid in list(self._history):
            if tid not in active_ids:
                del self._history[tid]

        if self._verbose and log.isEnabledFor(logging.DEBUG):
            self._log_verbose(results)

        return results

    def _log_verbose(self, results: list) -> None:
        """Log detaille etat interne BoT-SORT (tracked + lost stracks)."""
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
        warp_info = (
            "LDV"
            if self._ldv_warp_2x3 is not None
            else ("GMC" if self._last_warp_2x3 is not None else "none")
        )
        log.debug(
            "[BotSort] tracked=%d lost=%d ret=%d cmc=%s | %s",
            len(tr_st),
            len(lo_st),
            len(results),
            warp_info,
            "  ".join(parts) if parts else "(aucune track)",
        )

    ####
    # Interface CMC (BaseTracker)
    ####

    @property
    def has_internal_cmc(self) -> bool:
        """BoT-SORT effectue toujours sa propre CMC (sparseOptFlow par défaut)."""
        return True

    @property
    def has_own_image_cmc(self) -> bool:
        """
        True si GMC est actif (cmc_method != 'none' et != '').
        Quand True, session.py est en niveau 2 : H=None transmis au tracker,
        sparseOptFlow interne calcule H depuis l'image sans interference externe.
        """
        return self._cmc_method not in ("", "none")

    def get_last_homography(self) -> Optional[np.ndarray]:
        """
        Retourne l'homographie H (3x3) calculée par GMC lors du dernier update().
        GMC retourne une matrice affine 2x3 (estimateAffinePartial2D) ;
        on la complète en homographie 3x3 (troisième ligne = [0, 0, 1]).
        """
        if self._last_warp_2x3 is None:
            return None
        H = np.eye(3, dtype=np.float64)
        H[:2, :] = self._last_warp_2x3
        return H

    def reset(self) -> None:
        self._history.clear()
        self._last_warp_2x3 = None
        if self._tracker is not None:
            self.init({})
