# ============================================================
# services/interpolation_service.py
# Interpolation linéaire des boîtes englobantes entre keyframes.
# Utile quand SAM2/tracking échoue sur une courte séquence :
# l'utilisateur annote deux keyframes et le service génère
# automatiquement les frames intermédiaires.
# ============================================================

from typing import Dict, List, Optional, Tuple


def lerp(a: float, b: float, t: float) -> float:
    """Interpolation linéaire entre a et b. t ∈ [0, 1]."""
    return a + (b - a) * t


class InterpolationService:
    """
    Service d'interpolation linéaire des annotations entre keyframes.
    Génère des annotations intermédiaires pour les frames sans annotation
    situées entre deux frames annotées manuellement (keyframes).
    """

    def interpolate_bbox(
        self,
        ann_start: Dict,  # Annotation de début : {cx, cy, width, height, ...}
        ann_end: Dict,    # Annotation de fin
        t: float,         # Progression dans [0, 1]
    ) -> Dict:
        """
        Interpole linéairement une boîte entre deux états.

        Args:
            ann_start: Annotation au début (t=0)
            ann_end: Annotation à la fin (t=1)
            t: Facteur d'interpolation [0, 1]

        Returns:
            Nouvelle annotation interpolée avec les coordonnées YOLO interpolées
        """
        new_ann = ann_start.copy()
        new_ann["cx"] = lerp(ann_start["cx"], ann_end["cx"], t)
        new_ann["cy"] = lerp(ann_start["cy"], ann_end["cy"], t)
        new_ann["width"] = lerp(ann_start["width"], ann_end["width"], t)
        new_ann["height"] = lerp(ann_start["height"], ann_end["height"], t)
        new_ann["is_interpolated"] = True
        new_ann["is_auto"] = True
        # Réduction progressive de la confiance au milieu de l'interpolation
        # (la confiance est maximale aux keyframes et minimale au milieu)
        confidence = 1.0 - 2 * t * (1 - t) * 0.3  # Minimum 0.7 au milieu
        new_ann["confidence"] = confidence
        # Suppression de l'ID existant (sera créé en BDD)
        new_ann.pop("id", None)
        return new_ann

    def interpolate_polygon(
        self,
        pts_start: List[Tuple[float, float]],
        pts_end: List[Tuple[float, float]],
        t: float,
    ) -> List[Tuple[float, float]]:
        """
        Interpole linéairement entre deux polygones.
        Si les polygones n'ont pas le même nombre de points,
        utilise les boîtes englobantes pour l'interpolation.

        Args:
            pts_start: Points du polygone de début [(x,y), ...]
            pts_end: Points du polygone de fin
            t: Facteur d'interpolation [0, 1]

        Returns:
            Polygone interpolé
        """
        if not pts_start or not pts_end:
            return pts_start or pts_end or []

        # Si même nombre de points : interpolation directe
        if len(pts_start) == len(pts_end):
            return [
                (lerp(p1[0], p2[0], t), lerp(p1[1], p2[1], t))
                for p1, p2 in zip(pts_start, pts_end)
            ]

        # Sinon : rééchantillonnage vers le polygone le plus petit
        n = min(len(pts_start), len(pts_end))
        resampled_start = self._resample_polygon(pts_start, n)
        resampled_end = self._resample_polygon(pts_end, n)

        return [
            (lerp(p1[0], p2[0], t), lerp(p1[1], p2[1], t))
            for p1, p2 in zip(resampled_start, resampled_end)
        ]

    def _resample_polygon(
        self,
        pts: List[Tuple[float, float]],
        n: int,
    ) -> List[Tuple[float, float]]:
        """Rééchantillonne un polygone pour avoir exactement n points."""
        if len(pts) == n:
            return pts

        import numpy as np

        pts_arr = np.array(pts)

        # Calcul des longueurs de segments
        diffs = np.diff(pts_arr, axis=0, append=pts_arr[:1])
        lengths = np.sqrt((diffs**2).sum(axis=1))
        total_length = lengths.sum()

        if total_length == 0:
            return [pts[0]] * n

        # Paramétrage par longueur d'arc
        cumulative = np.concatenate([[0], np.cumsum(lengths)])
        target_lengths = np.linspace(0, total_length, n, endpoint=False)

        # Interpolation des nouveaux points
        new_pts = []
        for tl in target_lengths:
            idx = np.searchsorted(cumulative, tl, side="right") - 1
            idx = min(idx, len(pts) - 1)
            next_idx = (idx + 1) % len(pts)

            seg_start = cumulative[idx]
            seg_len = lengths[idx]

            if seg_len > 0:
                local_t = (tl - seg_start) / seg_len
                x = lerp(pts[idx][0], pts[next_idx][0], local_t)
                y = lerp(pts[idx][1], pts[next_idx][1], local_t)
            else:
                x, y = pts[idx]

            new_pts.append((x, y))

        return new_pts

    def interpolate_track_annotations(
        self,
        keyframe_annotations: Dict[int, Dict],  # frame_index → annotation
        start_frame: int,
        end_frame: int,
    ) -> Dict[int, Dict]:
        """
        Génère toutes les annotations interpolées pour une piste entre
        deux keyframes annotées manuellement.

        Args:
            keyframe_annotations: Annotations des keyframes {frame_index: annotation}
            start_frame: Première frame de la plage à interpoler
            end_frame: Dernière frame de la plage à interpoler

        Returns:
            Dict {frame_index: annotation_interpolée} pour toutes les frames intermédiaires
        """
        if not keyframe_annotations:
            return {}

        # Tri des keyframes par indice
        sorted_keyframes = sorted(keyframe_annotations.keys())

        # Vérification qu'on a au moins 2 keyframes pour interpoler
        if len(sorted_keyframes) < 2:
            return keyframe_annotations

        results: Dict[int, Dict] = {}

        # Interpolation entre chaque paire de keyframes consécutives
        for i in range(len(sorted_keyframes) - 1):
            kf_start_idx = sorted_keyframes[i]
            kf_end_idx = sorted_keyframes[i + 1]

            # Vérifie si cette paire couvre la plage demandée
            if kf_end_idx < start_frame or kf_start_idx > end_frame:
                continue

            ann_start = keyframe_annotations[kf_start_idx]
            ann_end = keyframe_annotations[kf_end_idx]

            # Nombre de frames entre les deux keyframes
            n_frames = kf_end_idx - kf_start_idx

            # Génération des frames intermédiaires
            for frame_idx in range(kf_start_idx, kf_end_idx + 1):
                if frame_idx < start_frame or frame_idx > end_frame:
                    continue

                # Les keyframes elles-mêmes sont conservées telles quelles
                if frame_idx == kf_start_idx:
                    results[frame_idx] = ann_start.copy()
                elif frame_idx == kf_end_idx:
                    results[frame_idx] = ann_end.copy()
                else:
                    # Calcul du facteur t pour cette frame intermédiaire
                    t = (frame_idx - kf_start_idx) / n_frames
                    interpolated = self.interpolate_bbox(ann_start, ann_end, t)

                    # Interpolation du polygone si disponible
                    pts_start = ann_start.get("points")
                    pts_end = ann_end.get("points")
                    if pts_start and pts_end:
                        import json
                        pts_s = json.loads(pts_start) if isinstance(pts_start, str) else pts_start
                        pts_e = json.loads(pts_end) if isinstance(pts_end, str) else pts_end
                        new_pts = self.interpolate_polygon(pts_s, pts_e, t)
                        interpolated["points"] = json.dumps(new_pts)

                    results[frame_idx] = interpolated

        return results

    def find_interpolation_gaps(
        self,
        annotated_frame_indices: List[int],
        total_frames: int,
        max_gap: int = 50,
    ) -> List[Tuple[int, int]]:
        """
        Identifie les segments sans annotation entre les keyframes.
        Retourne les plages (start, end) éligibles pour l'interpolation.

        Args:
            annotated_frame_indices: Frames ayant des annotations
            total_frames: Nombre total de frames
            max_gap: Gap maximum pour proposer l'interpolation (>max_gap = trop long)

        Returns:
            Liste de (frame_start, frame_end) représentant les gaps
        """
        if not annotated_frame_indices:
            return []

        sorted_frames = sorted(set(annotated_frame_indices))
        gaps = []

        for i in range(len(sorted_frames) - 1):
            gap_start = sorted_frames[i]
            gap_end = sorted_frames[i + 1]
            gap_size = gap_end - gap_start - 1

            # Proposer l'interpolation pour les gaps de taille raisonnable
            if 0 < gap_size <= max_gap:
                gaps.append((gap_start, gap_end))

        return gaps


# Instance singleton partagée
interpolation_service = InterpolationService()
