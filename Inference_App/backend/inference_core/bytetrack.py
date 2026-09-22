from __future__ import annotations

from .models import Detection, Track


def box_iou(a: tuple[float, float, float, float], b: tuple[float, float, float, float]) -> float:
    x1, y1 = max(a[0], b[0]), max(a[1], b[1])
    x2, y2 = min(a[2], b[2]), min(a[3], b[3])
    intersection = max(0.0, x2 - x1) * max(0.0, y2 - y1)
    area_a = max(0.0, a[2] - a[0]) * max(0.0, a[3] - a[1])
    area_b = max(0.0, b[2] - b[0]) * max(0.0, b[3] - b[1])
    union = area_a + area_b - intersection
    return intersection / union if union > 0 else 0.0


def _greedy_match(
    tracks: list[Track], detections: list[Detection], threshold: float
) -> tuple[list[tuple[int, int]], set[int], set[int]]:
    candidates = []
    for track_index, track in enumerate(tracks):
        for detection_index, detection in enumerate(detections):
            if track.detection.class_id != detection.class_id:
                continue
            overlap = box_iou(track.detection.box, detection.box)
            if overlap >= threshold:
                candidates.append((overlap, track_index, detection_index))
    matches = []
    used_tracks: set[int] = set()
    used_detections: set[int] = set()
    for _overlap, track_index, detection_index in sorted(candidates, reverse=True):
        if track_index in used_tracks or detection_index in used_detections:
            continue
        matches.append((track_index, detection_index))
        used_tracks.add(track_index)
        used_detections.add(detection_index)
    return matches, used_tracks, used_detections


class ByteTracker:
    """Small ByteTrack-style two-pass association for the public runtime.

    High-confidence detections update or create tracks. A second pass lets
    lower-confidence detections preserve existing identities through brief
    detector confidence drops.
    """

    def __init__(
        self,
        *,
        high_thresh: float = 0.5,
        low_thresh: float = 0.1,
        new_track_thresh: float = 0.6,
        match_thresh: float = 0.3,
        buffer_size: int = 30,
    ) -> None:
        self.high_thresh = high_thresh
        self.low_thresh = low_thresh
        self.new_track_thresh = new_track_thresh
        self.match_thresh = match_thresh
        self.buffer_size = buffer_size
        self._tracks: list[Track] = []
        self._next_id = 1

    def update(self, detections: list[Detection]) -> list[Track]:
        high = [d for d in detections if d.score >= self.high_thresh]
        low = [d for d in detections if self.low_thresh <= d.score < self.high_thresh]
        matches, matched_tracks, matched_high = _greedy_match(self._tracks, high, self.match_thresh)
        for track_index, detection_index in matches:
            track = self._tracks[track_index]
            track.detection = high[detection_index]
            track.age += 1
            track.missed = 0

        remaining_indexes = [index for index in range(len(self._tracks)) if index not in matched_tracks]
        remaining = [self._tracks[index] for index in remaining_indexes]
        low_matches, recovered, _ = _greedy_match(remaining, low, self.match_thresh)
        recovered_indexes: set[int] = set()
        for relative_index, detection_index in low_matches:
            original_index = remaining_indexes[relative_index]
            recovered_indexes.add(original_index)
            track = self._tracks[original_index]
            track.detection = low[detection_index]
            track.age += 1
            track.missed = 0

        for index, track in enumerate(self._tracks):
            if index not in matched_tracks and index not in recovered_indexes:
                track.missed += 1
        self._tracks = [track for track in self._tracks if track.missed <= self.buffer_size]

        for detection_index, detection in enumerate(high):
            if detection_index in matched_high or detection.score < self.new_track_thresh:
                continue
            self._tracks.append(Track(self._next_id, detection))
            self._next_id += 1
        return [track for track in self._tracks if track.missed == 0]

