"""
trackers/mot/boosttrack/tracker.py
------------------------------------
Wrapper BoostTrack -> BaseTracker.
Repo source : https://github.com/vukasin-stanojevic/BoostTrack
Ne JAMAIS modifier le code du repo clone - wrapper uniquement.

Installation :
  git clone https://github.com/vukasin-stanojevic/BoostTrack trackers/mot/boosttrack/BoostTrack

Modele Kalman BoostTrack (DIFFERENT de ByteTrack/BotSort) :
  BoostTrack utilise KalmanBoxTracker avec etat z = [cx, cy, h, r]
  ou r = w/h est le rapport d'aspect. L'etat etendu 8D est
  [cx, cy, h, r, vcx, vcy, vh, vr] (vitesses implicites du modele CV).
  Cela differe de ByteTrack/BotSort qui utilisent [cx, cy, a, h, vx, vy, va, vh].

CMC :
  has_internal_cmc = True toujours (use_ecc ou non).
  Les detections YOLO sont toujours passees brutes.

  use_ecc=True (ECC interne active) :
    Si H fourni (LDV bypass) : H injecte dans ecc.cache avant update().
    ecc.cache est un Dict[str, np.ndarray] avec des cles "{video}-{frame_id}".
    video = tag = f"frame_{frame_idx}", frame_id = tracker.frame_count + 1
    (frame_count est incremente au debut de BoostTrack.update() avant l'appel ECC).
    ECC.__call__ consulte cache avant de calculer -> le H injecte est retourne.
    Si H=None : ECC interne calcule H depuis l'image.

  use_ecc=False (pas d'ECC) :
    Si H fourni : _apply_camera_update(H) appelle directement
    KalmanBoxTracker.camera_update(H) sur chaque tracker interne.
    (Via self._tracker.trackers, PAS tracked_stracks qui n'existe pas.)
    Si H=None : aucune compensation (camera fixe ou premiere frame).

  Note : BoostTrack n'expose pas tracked_stracks/lost_stracks comme ByteTrack.
  Tous les trackers sont dans self._tracker.trackers (list[KalmanBoxTracker]).
  time_since_update=0 => updated ce frame, >= 1 => prediction pure.
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


class BoostTrackWrapper(BaseTracker):
    """
    Wrapper BoostTrack.
    Attend que le repo soit cloné dans :
      trackers/mot/boosttrack/BoostTrack/
    API : update(dets, img_tensor, img_numpy, tag)
    """

    def __init__(self, boosttrack_root: str = None):
        if boosttrack_root is None:
            boosttrack_root = str(Path(__file__).parent / "BoostTrack")
        self._root = boosttrack_root
        self._tracker = None
        self._frame_idx = 0
        self._history: dict = {}
        self._use_ecc: bool = False
        self._last_H: Optional[np.ndarray] = None
        # "LDV", "ECC", or "none" - source du H utilise ce frame (pour _log_verbose)
        self._last_H_src: str = "none"
        self._verbose: bool = False
        self._show_kalman_predict: bool = False
        # torch cache : importe une fois dans init(), None si absent
        self._torch = None

    @staticmethod
    def _to_uint8_bgr(frame: np.ndarray) -> np.ndarray:
        import cv2

        img = frame.astype(np.float32)
        lo, hi = img.min(), img.max()
        if hi > lo:
            img = (img - lo) / (hi - lo) * 255.0
        img = img.clip(0, 255).astype(np.uint8)
        if img.ndim == 2:
            img = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
        return img

    def _apply_camera_update(self, H: np.ndarray) -> None:
        """
        Applique H aux trackers internes BoostTrack via KalmanBoxTracker.camera_update(H).

        BoostTrack stocke ses trackers dans self._tracker.trackers (list[KalmanBoxTracker]),
        PAS dans tracked_stracks/lost_stracks (qui n'existent pas dans BoostTrack).
        KalmanBoxTracker.camera_update(H) applique H sur les coins [x1,y1,x2,y2] du tracker.

        Utilise quand use_ecc=False et H fourni (LDV ou ORB).
        Appele AVANT tracker.update() pour que la prediction interne parte d'un etat
        deja exprime dans le referentiel de la frame courante.
        """
        if H is None or self._tracker is None:
            return
        for trk in getattr(self._tracker, "trackers", []):
            if hasattr(trk, "camera_update"):
                trk.camera_update(H)

    def init(self, config: dict) -> None:
        root = config.get("boosttrack_root", None)
        if root:
            p = Path(root)
            if not p.is_absolute():
                project_root = Path(__file__).parent.parent.parent.parent
                p = (project_root / p).resolve()
            self._root = str(p)
        for p in [self._root, str(Path(self._root) / "external")]:
            if p not in sys.path:
                sys.path.insert(0, p)

        try:
            from default_settings import BoostTrackSettings, GeneralSettings
            from tracker.boost_track import BoostTrack
        except ImportError as e:
            raise ImportError(
                f"BoostTrack non trouve dans {self._root}. "
                "Cloner : git clone https://github.com/vukasin-stanojevic/BoostTrack"
            ) from e

        bk = config.get("boosttrack", {})
        self._use_ecc = bk.get("use_ecc", False)
        self._last_H = None


        # dataset selectionne les poids ReID : "mot17" -> mot17_sbs_S50.pth, "mot20" -> mot20_sbs_S50.pth
        GeneralSettings.values["dataset"] = bk.get("embedding_dataset", "mot17")
        GeneralSettings.values["test_dataset"] = bool(bk.get("embedding_test_dataset", False))
        GeneralSettings.dataset_specific_settings["mot17"]["det_thresh"] = float(bk.get("track_thresh", 0.5))
        GeneralSettings.dataset_specific_settings["mot20"]["det_thresh"] = float(bk.get("track_thresh", 0.5))

        # --- Appliquer tous les params YAML dans GeneralSettings AVANT creation du tracker ---
        _use_embedding = bool(bk.get("use_embedding", False))
        GeneralSettings.values["use_embedding"] = _use_embedding
        GeneralSettings.values["use_ecc"] = self._use_ecc
        GeneralSettings.values["det_thresh"] = float(bk.get("track_thresh", 0.5))
        GeneralSettings.values["iou_threshold"] = float(bk.get("match_thresh", 0.3))
        GeneralSettings.values["min_hits"] = int(bk.get("min_hits", 3))
        GeneralSettings.values["min_box_area"] = float(bk.get("min_box_area", 10))
        # --- BoostTrackSettings : poids du cout combine IoU+Mahalanobis+Shape ---
        BoostTrackSettings.values["lambda_iou"] = float(bk.get("lambda_iou", 0.5))
        BoostTrackSettings.values["lambda_mhd"] = float(bk.get("lambda_mhd", 0.25))
        BoostTrackSettings.values["lambda_shape"] = float(bk.get("lambda_shape", 0.25))
        BoostTrackSettings.values["use_dlo_boost"] = bool(bk.get("use_dlo_boost", True))
        BoostTrackSettings.values["use_duo_boost"] = bool(bk.get("use_duo_boost", True))

        
        #  Bruit Kalman BoostTrack via monkey-patch ConstantNoise 
        # BoostTrack utilise kalmanfilter.ConstantNoise comme CovariancePolicy.
        # R = matrice de bruit de mesure [cx, cy, h, r=w/h] (absolue, pas relative).
        # Q = matrice de bruit de process (echelle*I pour positions, q_vel pour vitesses).
        # Defaults BoostTrack : R=diag([1,1,10,0.01])  Q: scale=1.0 vel=0.01
        # Monkey-patch sans toucher au repo ; les valeurs sont captures dans la fermeture.
        try:
            import numpy as _np
            from tracker.kalmanfilter import ConstantNoise as _CN

            _r_pos = float(bk.get("kalman_R_pos", 1.0))
            _r_h = float(bk.get("kalman_R_h", 10.0))
            _r_a = float(bk.get("kalman_R_a", 0.01))
            _q_scale = float(bk.get("kalman_Q_scale", 1.0))
            _q_vel = float(bk.get("kalman_Q_vel", 0.01))

            def _get_R(self, x, confidence=0.0):
                return _np.diag([_r_pos, _r_pos, _r_h, _r_a])

            def _get_Q(self, x):
                Q = _np.eye(self.x_dim) * _q_scale
                Q[4:, 4:] = _q_vel
                return Q

            _CN.get_R = _get_R
            _CN.get_Q = _get_Q
            log.debug(
                "BoostTrack Kalman patche : R_pos=%.3f  R_h=%.2f  R_a=%.4f  "
                "Q_scale=%.3f  Q_vel=%.4f",
                _r_pos,
                _r_h,
                _r_a,
                _q_scale,
                _q_vel,
            )
        except Exception as _e:
            log.warning("BoostTrack : impossible de patcher ConstantNoise (%s)", _e)

        try:
            import torch as _torch
            self._torch = _torch
        except ImportError:
            self._torch = None
            log.warning("BoostTrack: torch absent, img_tensor=None (tracker fonctionne sans)")

        self._tracker = BoostTrack(video_name=None)
        # BoostTrack.max_age est calcule depuis video_name (FPS lookup) -> override manuel
        self._tracker.max_age = int(bk.get("max_age", 30))
        self._frame_idx = 0
        self._verbose = bool(config.get("debug_tracking", {}).get("verbose_mot_tracker", False))
        self._show_kalman_predict = bool(bk.get("show_kalman_predict", False))
        log.info(
            "BoostTrack initialise (use_ecc=%s  use_embedding=%s  min_hits=%d  max_age=%d  det_thresh=%.2f)",
            self._use_ecc,
            _use_embedding,
            GeneralSettings.values["min_hits"],
            self._tracker.max_age,
            GeneralSettings.values["det_thresh"],
        )
        if _use_embedding:
            log.info(
                "BoostTrack embedding: dataset=%s  poids dans %s/external/weights/",
                GeneralSettings.values["dataset"],
                self._root,
            )

    def update(
        self,
        frame: np.ndarray,
        detections: List[List[float]],
        H: Optional[np.ndarray] = None,
    ) -> list:
        """
        Met a jour BoostTrack pour une frame.

        Parameters
        ########
        frame      : image courante
        detections : detections YOLO [x1,y1,x2,y2,score] toujours brutes.
                     La CMC est appliquee en interne (jamais sur les dets).
        H          : homographie 3x3 frame_{i-1}->frame_i ou None.
                     use_ecc=True  : H injecte dans ecc.cache avec key f"{tag}-{frame_count+1}".
                     use_ecc=False : H applique via _apply_camera_update.
                     Si None : aucune compensation.
        """
        if self._tracker is None:
            raise RuntimeError("Appeler init() avant update()")

        bgr = self._to_uint8_bgr(frame)
        tag = f"frame_{self._frame_idx}"
        self._frame_idx += 1

        if not detections:
            dets_np = np.empty((0, 5), dtype=np.float32)
        else:
            dets_np = np.array([[*d[:4], d[4]] for d in detections], dtype=np.float32)

        # Bypass LDV pour ECC : injecter H dans ecc.cache avant update().
        # ECC.__call__ utilise key = f"{video}-{frame_id}" ou :
        #   video     = tag (passe a BoostTrack.update)
        #   frame_id  = self._tracker.frame_count + 1 (incremente au debut de update())
        # L'injection est ignoree pour frame_count+1==1 (premiere frame) car ECC
        # retourne np.eye() sans consulter le cache sur frame_id==1.
        self._last_H_src = "none"

        if H is not None and self._use_ecc:
            try:
                ecc = getattr(self._tracker, "ecc", None)
                if ecc is not None:
                    _key = f"{tag}-{self._tracker.frame_count + 1}"
                    ecc.cache[_key] = H.copy()
                    log.debug("BoostTrack: H_ldv injected into ecc.cache[%s]", _key)
            except Exception as _e:
                log.debug("BoostTrack bypass LDV: %s (fallback ECC image)", _e)
            self._last_H = H
            self._last_H_src = "LDV"
        elif H is not None and not self._use_ecc:
            self._apply_camera_update(H)
            self._last_H = H
            self._last_H_src = "LDV"

        if self._torch is not None:
            try:
                img_tensor = (
                    self._torch.from_numpy(bgr).permute(2, 0, 1).unsqueeze(0).float() / 255.0
                )
            except Exception:
                img_tensor = None
        else:
            img_tensor = None


        output = self._tracker.update(dets_np, img_tensor, bgr, tag)

        # Capture du warp ECC apres update().
        # Apres update(), ecc.cache contient le warp pour ce frame (calcule ou injecte).
        # Key: f"{tag}-{frame_count}" ou frame_count est deja incremente dans update().
        # frame_id==1 ne stocke pas dans cache (ECC retourne eye() sans caching).
        if self._use_ecc:
            try:
                ecc = getattr(self._tracker, "ecc", None)
                if ecc is not None:
                    _key = f"{tag}-{self._tracker.frame_count}"
                    if _key in ecc.cache:
                        self._last_H = ecc.cache[_key].copy()
                        if H is None:
                            # H calcule depuis l'image par ECC (pas de bypass LDV)
                            self._last_H_src = "ECC"
            except Exception as _e:
                log.debug("BoostTrack: cannot retrieve ECC H: %s", _e)
        elif H is None:
            self._last_H = None

        results = []
        active_ids = set()
        if output is not None and len(output) > 0:
            for row in output:
                x1, y1, x2, y2 = row[0], row[1], row[2], row[3]
                tid = int(row[4]) if len(row) > 4 else 0
                score = float(row[5]) if len(row) > 5 else 1.0
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
                        score=score,
                        is_confirmed=True,
                        time_since_update=0,
                        history=list(hist),
                    )
                )
        # Predictions Kalman des tracks perdues (show_kalman_predict: true)
        # KalmanBoxTracker avec time_since_update >= 1 = pas de detection ce frame.
        if self._show_kalman_predict:
            for trk in getattr(self._tracker, "trackers", []):
                if trk.time_since_update < 1:
                    continue  # deja dans output (active)
                tid = int(trk.id) + 1  # BoostTrack id 0-indexed, output est id+1
                if tid in active_ids:
                    continue
                state = trk.get_state()[0]  # [x1, y1, x2, y2]
                x1, y1, x2, y2 = float(state[0]), float(state[1]), float(state[2]), float(state[3])
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
                        score=0.0,
                        is_confirmed=True,
                        time_since_update=trk.time_since_update,
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
        """Log detaille etat interne BoostTrack (self._tracker.trackers = list[KalmanBoxTracker])."""
        trackers = getattr(self._tracker, "trackers", [])
        active_trks = [t for t in trackers if t.time_since_update < 1]
        lost_trks = [t for t in trackers if t.time_since_update >= 1]
        parts = []
        for trk in sorted(trackers[:12], key=lambda t: t.id):
            state = trk.get_state()[0]  # [x1, y1, x2, y2]
            cx = int((state[0] + state[2]) / 2)
            cy = int((state[1] + state[3]) / 2)
            streak = getattr(trk, "hit_streak", "?")
            tsu = trk.time_since_update
            tag = "act" if tsu < 1 else "LOST"
            parts.append(f"T{trk.id + 1}[{tag} str={streak} tsu={tsu} c=({cx},{cy})]")
        if len(trackers) > 12:
            parts.append(f"...+{len(trackers) - 12}more")
        cmc_info = f"ecc={'on' if self._use_ecc else 'off'} H={self._last_H_src}"
        log.debug(
            "[BoostTrack] trk=%d active=%d lost=%d ret=%d %s | %s",
            len(trackers),
            len(active_trks),
            len(lost_trks),
            len(results),
            cmc_info,
            "  ".join(parts) if parts else "(aucune track)",
        )

    ####
    # Interface CMC (BaseTracker)
    ####

    @property
    def has_internal_cmc(self) -> bool:
        """True toujours : CMC appliquee en interne (ECC si use_ecc, sinon Methode B)."""
        return True

    @property
    def has_own_image_cmc(self) -> bool:
        """
        True si ECC interne est active (use_ecc=True dans le YAML).
        Quand True, session.py est en niveau 2 : H=None transmis au tracker,
        ECC interne calcule H depuis l'image sans interference externe.
        Quand False (use_ecc=False), session.py doit fournir H (niveaux 1 ou 3).
        """
        return self._use_ecc

    def get_last_homography(self) -> Optional[np.ndarray]:
        """
        Retourne l'homographie H (3x3) produite par l'ECC interne lors du
        dernier update(). None si use_ecc=False ou premier appel.
        L'ECC de BoostTrack retourne déjà une matrice 3x3 (2x3 paddée).
        """
        return self._last_H

    def reset(self) -> None:
        self._history.clear()
        self._last_H = None
        self._use_ecc = False
        if self._tracker is not None:
            self.init({})
        self._frame_idx = 0
