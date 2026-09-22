# ============================================================
# Tests unitaires — backend/services/interpolation_service.py
# ============================================================

import json

import pytest

from backend.services.interpolation_service import interpolation_service, lerp

pytestmark = pytest.mark.unit


def test_lerp_endpoints():
    assert lerp(0.0, 10.0, 0.0) == 0.0
    assert lerp(0.0, 10.0, 1.0) == 10.0
    assert lerp(0.0, 10.0, 0.5) == 5.0


def test_interpolate_bbox_midpoint():
    start = {"cx": 0.0, "cy": 0.0, "width": 0.1, "height": 0.1, "class_id": 1}
    end = {"cx": 1.0, "cy": 1.0, "width": 0.3, "height": 0.3, "class_id": 1}
    mid = interpolation_service.interpolate_bbox(start, end, 0.5)
    assert mid["cx"] == pytest.approx(0.5)
    assert mid["cy"] == pytest.approx(0.5)
    assert mid["width"] == pytest.approx(0.2)
    assert mid["is_interpolated"] is True
    assert mid["is_auto"] is True


def test_interpolate_bbox_confidence_dips_at_midpoint_and_is_max_at_edges():
    start = {"cx": 0.0, "cy": 0.0, "width": 0.1, "height": 0.1}
    end = {"cx": 1.0, "cy": 1.0, "width": 0.1, "height": 0.1}
    at_0 = interpolation_service.interpolate_bbox(start, end, 0.0)
    at_mid = interpolation_service.interpolate_bbox(start, end, 0.5)
    at_1 = interpolation_service.interpolate_bbox(start, end, 1.0)
    assert at_0["confidence"] == pytest.approx(1.0)
    assert at_1["confidence"] == pytest.approx(1.0)
    # Formule reelle : 1 - 2*t*(1-t)*0.3 -> 0.85 au milieu (le commentaire du
    # code source dit "minimum 0.7", ce qui est incorrect : 2*0.5*0.5*0.3=0.15).
    assert at_mid["confidence"] == pytest.approx(0.85)
    assert at_mid["confidence"] < at_0["confidence"]


def test_interpolate_bbox_removes_id_field():
    start = {"id": 42, "cx": 0.0, "cy": 0.0, "width": 0.1, "height": 0.1}
    end = {"id": 99, "cx": 1.0, "cy": 1.0, "width": 0.1, "height": 0.1}
    result = interpolation_service.interpolate_bbox(start, end, 0.5)
    assert "id" not in result


def test_interpolate_polygon_same_point_count():
    start = [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0)]
    end = [(0.0, 1.0), (2.0, 1.0), (2.0, 2.0)]
    mid = interpolation_service.interpolate_polygon(start, end, 0.5)
    assert mid == [(0.0, 0.5), (1.5, 0.5), (1.5, 1.5)]


def test_interpolate_polygon_empty_inputs_fall_back():
    assert interpolation_service.interpolate_polygon([], [(1.0, 1.0)], 0.5) == [(1.0, 1.0)]
    assert interpolation_service.interpolate_polygon([(1.0, 1.0)], [], 0.5) == [(1.0, 1.0)]
    assert interpolation_service.interpolate_polygon([], [], 0.5) == []


def test_interpolate_polygon_different_point_counts_resamples():
    start = [(0.0, 0.0), (1.0, 0.0)]
    end = [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)]
    result = interpolation_service.interpolate_polygon(start, end, 0.0)
    # Rééchantillonnage vers min(len) = 2 points
    assert len(result) == 2


def test_interpolate_track_annotations_generates_intermediate_frames():
    keyframes = {
        0: {"cx": 0.0, "cy": 0.0, "width": 0.1, "height": 0.1, "class_id": 1},
        10: {"cx": 1.0, "cy": 1.0, "width": 0.1, "height": 0.1, "class_id": 1},
    }
    result = interpolation_service.interpolate_track_annotations(keyframes, 0, 10)
    assert set(result.keys()) == set(range(0, 11))
    assert result[5]["cx"] == pytest.approx(0.5)
    # Les keyframes elles-memes sont preservees telles quelles (pas de champ 'is_interpolated' force)
    assert result[0] == keyframes[0]
    assert result[10] == keyframes[10]


def test_interpolate_track_annotations_respects_range_restriction():
    keyframes = {
        0: {"cx": 0.0, "cy": 0.0, "width": 0.1, "height": 0.1},
        10: {"cx": 1.0, "cy": 1.0, "width": 0.1, "height": 0.1},
    }
    result = interpolation_service.interpolate_track_annotations(keyframes, 3, 7)
    assert set(result.keys()) == {3, 4, 5, 6, 7}


def test_interpolate_track_annotations_single_keyframe_returns_as_is():
    keyframes = {5: {"cx": 0.5, "cy": 0.5, "width": 0.1, "height": 0.1}}
    result = interpolation_service.interpolate_track_annotations(keyframes, 0, 10)
    assert result == keyframes


def test_interpolate_track_annotations_empty_input_returns_empty():
    assert interpolation_service.interpolate_track_annotations({}, 0, 10) == {}


def test_interpolate_track_annotations_interpolates_polygon_points():
    keyframes = {
        0: {"cx": 0.0, "cy": 0.0, "width": 0.1, "height": 0.1,
            "points": json.dumps([[0.0, 0.0], [1.0, 0.0]])},
        2: {"cx": 1.0, "cy": 1.0, "width": 0.1, "height": 0.1,
            "points": json.dumps([[0.0, 1.0], [1.0, 1.0]])},
    }
    result = interpolation_service.interpolate_track_annotations(keyframes, 0, 2)
    mid_points = json.loads(result[1]["points"])
    assert mid_points == [[0.0, 0.5], [1.0, 0.5]]


def test_find_interpolation_gaps_basic():
    gaps = interpolation_service.find_interpolation_gaps([0, 5, 20], total_frames=25, max_gap=50)
    assert gaps == [(0, 5), (5, 20)]


def test_find_interpolation_gaps_skips_adjacent_frames_no_gap():
    gaps = interpolation_service.find_interpolation_gaps([0, 1, 2], total_frames=10)
    assert gaps == []


def test_find_interpolation_gaps_excludes_gaps_larger_than_max():
    gaps = interpolation_service.find_interpolation_gaps([0, 100], total_frames=200, max_gap=10)
    assert gaps == []


def test_find_interpolation_gaps_empty_input():
    assert interpolation_service.find_interpolation_gaps([], total_frames=10) == []


def test_find_interpolation_gaps_deduplicates_and_sorts():
    gaps = interpolation_service.find_interpolation_gaps([10, 0, 0, 5], total_frames=20, max_gap=50)
    assert gaps == [(0, 5), (5, 10)]
