"""
trackers/mot/custom_kalman/mot_tracker.py
-----------------------------------------
Tracker multi-objets : Kalman + algorithme Hongrois.

Cycle par frame :
  1. camera_update(H) puis predict() sur tous les tracks (Methode B : H avant F).
  2. Calculer la matrice de coût (IoU ou distance Euclidienne brute).
  3. Associer détections ↔ tracks via scipy.optimize.linear_sum_assignment.
  4. Mettre à jour les tracks associés.
  5. Créer de nouveaux tracks pour les détections non assignées.
  6. Incrémenter l'âge des tracks non associés (mode prédiction seule).
  7. Supprimer les tracks trop vieux sans mise à jour.
"""

from dataclasses import dataclass, field

import numpy as np
from scipy.optimize import linear_sum_assignment

from trackers.mot.custom_kalman.kalman_filter import KalmanFilter2D
from utils.logger import get_logger

log = get_logger(__name__)

Detection = list[float]  # [x1, y1, x2, y2, score, class_id]


### Représentation d'un track #################################################


@dataclass
class Track:
    track_id: int
    kf: KalmanFilter2D
    class_id: int = 0
    score: float = 1.0

    # Dernière bbox (espace image stabilisé)
    bbox: list[float] = field(default_factory=lambda: [0.0, 0.0, 0.0, 0.0])

    age: int = 0  # frames depuis la création
    hits: int = 1  # nombre de mises à jour réussies
    time_since_update: int = 0  # frames depuis la dernière mise à jour

    # Historique des positions (pour affichage trace)
    history: list[tuple[float, float]] = field(default_factory=list)

    @property
    def is_confirmed(self) -> bool:
        """Un track est confirmé après 2 hits consécutifs."""
        return self.hits >= 2

    @property
    def center(self) -> tuple[float, float]:
        return self.kf.position

    def predicted_bbox(self) -> list[float]:
        """Bbox prédite à partir du centre Kalman et de la dernière taille connue."""
        u, v = self.kf.position
        w = self.bbox[2] - self.bbox[0]
        h = self.bbox[3] - self.bbox[1]
        return [u - w / 2, v - h / 2, u + w / 2, v + h / 2]


### Tracker principal #########################################################


class MultiObjectTracker:
    """
    Tracker multi-objets Kalman + Hongrois avec compensation ego-motion.

    Parameters
    ########
    max_age          : int   frames max sans mise à jour avant suppression
    min_hits         : int   hits min pour confirmer un track
    iou_threshold    : float seuil IoU minimum pour l'association
    dist_threshold   : float seuil de distance Euclidienne (fallback si IoU=0)
    process_noise    : float paramètre Q du filtre de Kalman
    measure_noise    : float paramètre R du filtre de Kalman
    use_mahalanobis  : bool  utilise la distance de Mahalanobis comme coût
    """

    def __init__(
        self,
        max_age: int = 5,
        min_hits: int = 2,
        iou_threshold: float = 0.0001,
        dist_threshold: float = 100,
        process_noise: float = 100,
        measure_noise: float = 0.001,
        use_mahalanobis: bool = False,
    ):
        self.max_age = max_age
        self.min_hits = min_hits
        self.iou_threshold = iou_threshold
        self.dist_threshold = dist_threshold
        self.process_noise = process_noise
        self.measure_noise = measure_noise
        self.use_mahalanobis = use_mahalanobis

        self._tracks: list[Track] = []
        self._next_id = 0

    ### Utilitaires de coût ###################################################

    @staticmethod
    def _iou(a: list[float], b: list[float]) -> float:
        ax1, ay1, ax2, ay2 = a[:4]
        bx1, by1, bx2, by2 = b[:4]
        ix1 = max(ax1, bx1)
        iy1 = max(ay1, by1)
        ix2 = min(ax2, bx2)
        iy2 = min(ay2, by2)
        iw = max(0.0, ix2 - ix1)
        ih = max(0.0, iy2 - iy1)
        inter = iw * ih
        area_a = max(0, ax2 - ax1) * max(0, ay2 - ay1)
        area_b = max(0, bx2 - bx1) * max(0, by2 - by1)
        union = area_a + area_b - inter
        return inter / union if union > 0 else 0.0

    @staticmethod
    def _center_dist(det: list[float], track: Track) -> float:
        cx_d = (det[0] + det[2]) / 2.0
        cy_d = (det[1] + det[3]) / 2.0
        cx_t, cy_t = track.kf.position
        return float(np.sqrt((cx_d - cx_t) ** 2 + (cy_d - cy_t) ** 2))

    def _cost_matrix(
        self,
        detections: list[Detection],
        tracks: list[Track],
    ) -> np.ndarray:
        """Matrice de coût : 1 - IoU  (ou distance normalisée si IoU = 0)."""
        n_det = len(detections)
        n_trk = len(tracks)
        cost = np.full((n_det, n_trk), fill_value=1e6, dtype=np.float64)

        for i, det in enumerate(detections):
            for j, trk in enumerate(tracks):
                pred_bbox = trk.predicted_bbox()

                if self.use_mahalanobis:
                    cx = (det[0] + det[2]) / 2.0
                    cy = (det[1] + det[3]) / 2.0
                    cost[i, j] = trk.kf.mahalanobis(cx, cy)
                else:
                    iou = self._iou(det, pred_bbox)
                    if iou > 0:
                        cost[i, j] = 1.0 - iou
                    else:
                        # fallback distance Euclidienne normalisée
                        d = self._center_dist(det, trk)
                        cost[i, j] = min(1e6, d / self.dist_threshold)

        return cost

    ### Association Hongrois ##################################################

    def _associate(
        self,
        detections: list[Detection],
        tracks: list[Track],
    ) -> tuple[list[tuple[int, int]], list[int], list[int]]:
        """
        Associe détections et tracks.

        Returns
        ######
        matches        : liste (det_idx, trk_idx)
        unmatched_dets : indices de détections non associées
        unmatched_trks : indices de tracks non associés
        """
        if not detections or not tracks:
            return [], list(range(len(detections))), list(range(len(tracks)))

        cost = self._cost_matrix(detections, tracks)
        row_ind, col_ind = linear_sum_assignment(cost)

        matches = []
        unmatched_dets = list(range(len(detections)))
        unmatched_trks = list(range(len(tracks)))

        for r, c in zip(row_ind, col_ind):
            if cost[r, c] > 1.0 - self.iou_threshold and cost[r, c] < 1e5:
                # coût trop élevé = pas de match acceptable
                continue
            if cost[r, c] >= 1e5:
                continue
            matches.append((r, c))
            unmatched_dets.remove(r)
            unmatched_trks.remove(c)

        return matches, unmatched_dets, unmatched_trks

    ### Création d'un track ###################################################

    def _new_track(self, det: Detection) -> Track:
        x1, y1, x2, y2, score, cls = det
        cx = (x1 + x2) / 2.0
        cy = (y1 + y2) / 2.0
        kf = KalmanFilter2D(
            process_noise=self.process_noise,
            measure_noise=self.measure_noise,
        )
        kf.init(cx, cy)
        t = Track(
            track_id=self._next_id,
            kf=kf,
            class_id=int(cls),
            score=float(score),
            bbox=[x1, y1, x2, y2],
            history=[(cx, cy)],
        )
        self._next_id += 1
        return t

    ### Boucle principale #####################################################

    def update(
        self,
        detections: list[Detection],
        frame_idx: int,
        H: np.ndarray | None = None,
    ) -> list[Track]:
        """
        Met a jour le tracker pour une frame (Methode B warp-prediction).

        Parameters
        ########
        detections : list of [x1, y1, x2, y2, score, class_id]
                     Coordonnees YOLO brutes (NON compensees exterieurement).
                     La compensation ego-motion est appliquee en interne
                     via camera_update(H) sur chaque filtre de Kalman (AVANT predict()).
        frame_idx  : int
        H          : np.ndarray (3, 3) ou None
                     Homographie frame_{i-1} -> frame_i.
                     LDV prioritaire (K·R·K^-1 inertiel) ; fallback ORB/ECC.
                     Si None : pas de compensation ego-motion (camera fixe
                     ou premiere frame).

        Returns
        ######
        tracks actifs confirmes (list of Track)
        """

        # 1. Camera update PUIS prediction (Methode B : H avant F)
        for trk in self._tracks:
            trk.kf.camera_update(H)  # H @ x d'abord  (no-op si H is None)
            trk.kf.predict()  # F @ (H @ x) : prediction dans frame_i
            trk.age += 1
            trk.time_since_update += 1

        # 2. Association
        matches, unmatched_dets, unmatched_trks = self._associate(detections, self._tracks)

        # 3. Mise à jour des tracks matchés
        for det_idx, trk_idx in matches:
            det = detections[det_idx]
            x1, y1, x2, y2, score, cls = det
            cx = (x1 + x2) / 2.0
            cy = (y1 + y2) / 2.0
            trk = self._tracks[trk_idx]
            trk.kf.update(cx, cy)
            trk.bbox = [x1, y1, x2, y2]
            trk.score = float(score)
            trk.hits += 1
            trk.time_since_update = 0
            trk.history.append((cx, cy))
            if len(trk.history) > 50:
                trk.history.pop(0)

        # 4. Nouveaux tracks pour les détections non matchées
        for det_idx in unmatched_dets:
            new_trk = self._new_track(detections[det_idx])
            self._tracks.append(new_trk)

        # 5. Suppression des tracks trop vieux
        self._tracks = [trk for trk in self._tracks if trk.time_since_update <= self.max_age]

        # 6. Retourne seulement les tracks confirmés
        confirmed = [trk for trk in self._tracks if trk.is_confirmed or trk.time_since_update == 0]

        log.debug(
            f"Frame {frame_idx:5d} | "
            f"dets={len(detections):3d}  "
            f"tracks={len(self._tracks):3d}  "
            f"confirmed={len(confirmed):3d}"
        )
        return confirmed

    ### Accesseur #############################################################

    @property
    def all_tracks(self) -> list[Track]:
        return self._tracks
