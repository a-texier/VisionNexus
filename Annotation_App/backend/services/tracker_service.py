# ============================================================
# services/tracker_service.py
# Service de tracking multi-objets utilisant l'algorithme ByteTrack.
# ByteTrack associe des détections entre frames successives via l'algorithme
# hongrois (assignment problem) sur des scores IoU + score de confiance.
#
# Caractéristiques :
#   - Maintient des IDs stables entre les frames (même après occlusion courte)
#   - Gère les pistes perdues (tracks dans le "buffer") et leur réidentification
#   - Map les IDs ByteTrack temporaires vers des IDs de projet stables
# ============================================================

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

import numpy as np
import lap  # Hungarian algorithm (LinearAssignment Problem)


@dataclass
class Detection:
    """Représente une détection d'objet sur une frame."""
    bbox_pixel: Tuple[int, int, int, int]  # (x1, y1, x2, y2)
    confidence: float
    class_id: int


@dataclass
class TrackedObject:
    """Objet suivi avec son ID stable dans le projet."""
    project_track_id: int      # ID stable dans le projet (ne change jamais)
    bbox_pixel: Tuple[int, int, int, int]
    class_id: int
    confidence: float
    age: int                   # Nombre de frames depuis la première détection
    hits: int                  # Nombre de frames avec correspondance
    time_since_update: int     # Frames depuis la dernière mise à jour
    is_new: bool               # True si première apparition ce frame


class KalmanBoxTracker:
    """
    Tracker Kalman pour une boîte englobante unique.
    Utilise un filtre de Kalman pour prédire la position future
    en cas d'occultation temporaire.

    État du filtre : [x, y, s, r, dx, dy, ds]
    où (x,y) = centre, s = surface, r = ratio d'aspect, d* = vitesses
    """
    count = 0  # Compteur global des IDs ByteTrack

    def __init__(self, bbox_pixel: Tuple[int, int, int, int]):
        from filterpy.kalman import KalmanFilter
        # Filtre Kalman 7D (état) → 4D (mesure)
        self.kf = KalmanFilter(dim_x=7, dim_z=4)

        # Matrice de transition d'état (physique du mouvement)
        self.kf.F = np.array([
            [1, 0, 0, 0, 1, 0, 0],
            [0, 1, 0, 0, 0, 1, 0],
            [0, 0, 1, 0, 0, 0, 1],
            [0, 0, 0, 1, 0, 0, 0],
            [0, 0, 0, 0, 1, 0, 0],
            [0, 0, 0, 0, 0, 1, 0],
            [0, 0, 0, 0, 0, 0, 1],
        ])

        # Matrice d'observation (on mesure x, y, s, r)
        self.kf.H = np.array([
            [1, 0, 0, 0, 0, 0, 0],
            [0, 1, 0, 0, 0, 0, 0],
            [0, 0, 1, 0, 0, 0, 0],
            [0, 0, 0, 1, 0, 0, 0],
        ])

        # Bruit de mesure (incertitude sur les détections)
        self.kf.R[2:, 2:] *= 10.0
        # Bruit de processus (incertitude sur le modèle de mouvement)
        self.kf.P[4:, 4:] *= 1000.0
        self.kf.P *= 10.0
        self.kf.Q[-1, -1] *= 0.01
        self.kf.Q[4:, 4:] *= 0.01

        # Initialisation de l'état
        self.kf.x[:4] = self._bbox_to_z(bbox_pixel)

        KalmanBoxTracker.count += 1
        self.bytetrack_id = KalmanBoxTracker.count
        self.time_since_update = 0
        self.history = []
        self.hits = 0
        self.hit_streak = 0
        self.age = 0
        self.class_id = 0
        self.confidence = 1.0

    def update(self, bbox_pixel: Tuple[int, int, int, int], confidence: float = 1.0) -> None:
        """Met à jour le filtre Kalman avec une nouvelle détection."""
        self.time_since_update = 0
        self.history = []
        self.hits += 1
        self.hit_streak += 1
        self.confidence = confidence
        self.kf.update(self._bbox_to_z(bbox_pixel))

    def predict(self) -> Tuple[int, int, int, int]:
        """Prédit la prochaine position de la boîte."""
        if (self.kf.x[6] + self.kf.x[2]) <= 0:
            self.kf.x[6] = 0.0

        self.kf.predict()
        self.age += 1

        if self.time_since_update > 0:
            self.hit_streak = 0
        self.time_since_update += 1

        self.history.append(self._z_to_bbox(self.kf.x))
        return self.history[-1]

    def get_state(self) -> Tuple[int, int, int, int]:
        """Retourne l'état actuel (boîte estimée)."""
        return self._z_to_bbox(self.kf.x)

    @staticmethod
    def _bbox_to_z(bbox: Tuple[int, int, int, int]) -> np.ndarray:
        """Convertit (x1,y1,x2,y2) en (cx,cy,surface,ratio)."""
        x1, y1, x2, y2 = bbox
        w = x2 - x1
        h = y2 - y1
        cx = x1 + w / 2
        cy = y1 + h / 2
        s = w * h
        r = w / h if h != 0 else 1.0
        return np.array([[cx], [cy], [s], [r]])

    @staticmethod
    def _z_to_bbox(z: np.ndarray) -> Tuple[int, int, int, int]:
        """Convertit (cx,cy,surface,ratio) en (x1,y1,x2,y2)."""
        cx, cy, s, r = float(z[0]), float(z[1]), float(z[2]), float(z[3])
        w = np.sqrt(abs(s * r))
        h = s / w if w != 0 else 1
        return (
            int(cx - w / 2),
            int(cy - h / 2),
            int(cx + w / 2),
            int(cy + h / 2),
        )


def compute_iou_matrix(trackers: List[Tuple], detections: List[Tuple]) -> np.ndarray:
    """
    Calcule la matrice IoU entre N trackers et M détections.
    Retourne un tableau (N, M) de valeurs IoU dans [0, 1].
    """
    N = len(trackers)
    M = len(detections)
    iou_matrix = np.zeros((N, M), dtype=np.float32)

    for i, trk in enumerate(trackers):
        for j, det in enumerate(detections):
            iou_matrix[i, j] = _iou(trk, det)

    return iou_matrix


def _iou(boxA: Tuple, boxB: Tuple) -> float:
    """Calcule l'IoU entre deux boîtes (x1,y1,x2,y2)."""
    xA = max(boxA[0], boxB[0])
    yA = max(boxA[1], boxB[1])
    xB = min(boxA[2], boxB[2])
    yB = min(boxA[3], boxB[3])

    inter = max(0, xB - xA) * max(0, yB - yA)
    if inter == 0:
        return 0.0

    area_a = (boxA[2] - boxA[0]) * (boxA[3] - boxA[1])
    area_b = (boxB[2] - boxB[0]) * (boxB[3] - boxB[1])
    union = area_a + area_b - inter

    return inter / union if union > 0 else 0.0


class TrackerService:
    """
    Service de tracking multi-objets basé sur ByteTrack simplifié.
    Maintient une liste de pistes actives et les met à jour à chaque frame.
    """

    def __init__(
        self,
        track_thresh: float = 0.5,
        track_buffer: int = 30,
        match_thresh: float = 0.8,
    ):
        """
        Args:
            track_thresh: Seuil de confiance minimum pour initier une piste
            track_buffer: Nombre de frames à conserver une piste perdue
            match_thresh: Seuil IoU minimum pour associer une détection à une piste
        """
        self.track_thresh = track_thresh
        self.track_buffer = track_buffer
        self.match_thresh = match_thresh

        # Pistes actives : bytetrack_id → KalmanBoxTracker
        self._trackers: List[KalmanBoxTracker] = []

        # Mapping stable : bytetrack_id → project_track_id
        self._id_map: Dict[int, int] = {}
        self._next_project_id = 1

        # Historique des pistes par frame
        self._track_history: Dict[int, List[int]] = {}  # project_id → [frame_indices]

        print(f"[TrackerService] Initialisé — thresh={track_thresh}, buffer={track_buffer}")

    def reset(self) -> None:
        """Remet à zéro le tracker (nouveau projet ou nouvelle séquence)."""
        self._trackers = []
        self._id_map = {}
        self._next_project_id = 1
        self._track_history = {}
        KalmanBoxTracker.count = 0
        print("[TrackerService] Tracker remis à zéro")

    def update(
        self,
        detections: List[Detection],
        frame_index: int,
    ) -> List[TrackedObject]:
        """
        Met à jour le tracker avec les nouvelles détections d'une frame.
        Associe les détections aux pistes existantes (algorithme hongrois sur IoU).

        Args:
            detections: Liste des objets détectés sur la frame courante
            frame_index: Indice de la frame dans la séquence

        Returns:
            Liste des objets trackés avec leur ID stable
        """
        # Prédiction de la position actuelle pour chaque tracker existant
        predicted_boxes = []
        for trk in self._trackers:
            predicted_boxes.append(trk.predict())

        # ---- Étape 1 : Détections haute confiance ----
        high_conf_dets = [d for d in detections if d.confidence >= self.track_thresh]
        low_conf_dets = [d for d in detections if d.confidence < self.track_thresh]

        # Séparation des pistes confirmées vs incertaines
        confirmed_trackers = [t for t in self._trackers if t.time_since_update <= 1]
        lost_trackers = [t for t in self._trackers if t.time_since_update > 1]

        # ---- Étape 2 : Association haute confiance ----
        matched_det_ids, unmatched_det_ids, unmatched_trk_ids = self._associate(
            detections=high_conf_dets,
            tracker_indices=list(range(len(self._trackers))),
            iou_threshold=self.match_thresh,
        )

        # Mise à jour des trackers associés
        for det_idx, trk_idx in matched_det_ids:
            det = high_conf_dets[det_idx]
            self._trackers[trk_idx].update(det.bbox_pixel, det.confidence)
            self._trackers[trk_idx].class_id = det.class_id

        # ---- Étape 3 : Association des pistes perdues avec détections basse confiance ----
        lost_trk_indices = [
            i for i, t in enumerate(self._trackers)
            if i in unmatched_trk_ids and t.time_since_update <= self.track_buffer
        ]

        if low_conf_dets and lost_trk_indices:
            matched_low, _, _ = self._associate(
                detections=low_conf_dets,
                tracker_indices=lost_trk_indices,
                iou_threshold=0.5,  # Seuil plus bas pour les pistes perdues
            )
            for det_idx, trk_idx in matched_low:
                det = low_conf_dets[det_idx]
                self._trackers[trk_idx].update(det.bbox_pixel, det.confidence)
                unmatched_trk_ids.discard(trk_idx)
                unmatched_det_ids.discard(det_idx)

        # ---- Étape 4 : Création de nouvelles pistes ----
        for det_idx in unmatched_det_ids:
            det = high_conf_dets[det_idx]
            new_tracker = KalmanBoxTracker(det.bbox_pixel)
            new_tracker.class_id = det.class_id
            new_tracker.confidence = det.confidence

            # Attribution d'un ID stable de projet
            project_id = self._next_project_id
            self._id_map[new_tracker.bytetrack_id] = project_id
            self._next_project_id += 1
            self._trackers.append(new_tracker)

        # ---- Étape 5 : Suppression des pistes trop longtemps perdues ----
        self._trackers = [
            t for t in self._trackers
            if t.time_since_update <= self.track_buffer
        ]

        # ---- Construction des résultats ----
        results = []
        for trk in self._trackers:
            if trk.time_since_update > 0:
                continue  # N'exporter que les pistes actives ce frame

            project_id = self._id_map.get(trk.bytetrack_id, trk.bytetrack_id)
            bbox = trk.get_state()

            # Mise à jour de l'historique
            if project_id not in self._track_history:
                self._track_history[project_id] = []
            self._track_history[project_id].append(frame_index)

            results.append(TrackedObject(
                project_track_id=project_id,
                bbox_pixel=bbox,
                class_id=trk.class_id,
                confidence=trk.confidence,
                age=trk.age,
                hits=trk.hits,
                time_since_update=trk.time_since_update,
                is_new=(trk.hits == 1),
            ))

        return results

    def _associate(
        self,
        detections: List[Detection],
        tracker_indices: List[int],
        iou_threshold: float,
    ) -> Tuple[List[Tuple[int, int]], set, set]:
        """
        Associe les détections aux trackers existants via l'algorithme hongrois.

        Returns:
            (matched_pairs, unmatched_det_ids, unmatched_trk_ids)
            où matched_pairs = [(det_idx, trk_idx), ...]
        """
        if not detections or not tracker_indices:
            return [], set(range(len(detections))), set(tracker_indices)

        # Construction de la matrice de coût (1 - IoU)
        det_boxes = [d.bbox_pixel for d in detections]
        trk_boxes = [self._trackers[i].get_state() for i in tracker_indices]

        iou_matrix = compute_iou_matrix(trk_boxes, det_boxes)

        # Algorithme hongrois pour l'assignation optimale
        cost_matrix = 1.0 - iou_matrix  # Minimisation du coût
        cost, x, y = lap.lapjv(cost_matrix, extend_cost=True, cost_limit=1 - iou_threshold)

        matched_pairs = []
        unmatched_det_ids = set()
        unmatched_trk_ids = set(range(len(tracker_indices)))

        for det_idx, trk_local_idx in enumerate(y):
            if trk_local_idx >= 0 and iou_matrix[trk_local_idx, det_idx] >= iou_threshold:
                matched_pairs.append((det_idx, tracker_indices[trk_local_idx]))
                unmatched_trk_ids.discard(tracker_indices[trk_local_idx])
            else:
                unmatched_det_ids.add(det_idx)

        return matched_pairs, unmatched_det_ids, unmatched_trk_ids

    def get_track_history(self, project_track_id: int) -> List[int]:
        """Retourne la liste des frame_index où cette piste est apparue."""
        return self._track_history.get(project_track_id, [])

    def get_active_tracks(self) -> Dict[int, TrackedObject]:
        """Retourne les pistes actuellement actives."""
        return {
            self._id_map.get(t.bytetrack_id, t.bytetrack_id): TrackedObject(
                project_track_id=self._id_map.get(t.bytetrack_id, t.bytetrack_id),
                bbox_pixel=t.get_state(),
                class_id=t.class_id,
                confidence=t.confidence,
                age=t.age,
                hits=t.hits,
                time_since_update=t.time_since_update,
                is_new=False,
            )
            for t in self._trackers
            if t.time_since_update == 0
        }


# Instance singleton partagée
tracker_service = TrackerService()
