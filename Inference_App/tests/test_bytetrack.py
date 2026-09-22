from backend.inference_core.bytetrack import ByteTracker
from backend.inference_core.models import Detection


def detection(x: float, score: float) -> Detection:
    return Detection(x, 0, x + 20, 20, score, 0, "object")


def test_identity_survives_low_confidence_detection():
    tracker = ByteTracker(high_thresh=0.5, low_thresh=0.1, new_track_thresh=0.6, match_thresh=0.2)
    first = tracker.update([detection(0, 0.9)])
    second = tracker.update([detection(2, 0.3)])
    assert first[0].track_id == second[0].track_id == 1


def test_new_low_confidence_detection_does_not_create_track():
    tracker = ByteTracker()
    assert tracker.update([detection(0, 0.2)]) == []

