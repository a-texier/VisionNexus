"""
Tests unitaires pour pipeline/detector/detector_mot.py.

Couvre sans cv2 :
  - _compute_adaptive_threshold : seuillage adaptatif / fixe
  - NoneDetectorMOT             : retourne toujours []
  - DummyDetectorMOT            : format, reproductibilité, probabilité de présence

Couvre avec cv2 (auto-skippé si cv2 absent) :
  - _to_uint8_gray              : conversion 3-canaux → gris
  - _detect_candidates_multi    : détection blobs tophat sur frame synthétique
"""

import numpy as np
import pytest

from pipeline.detector.detector_mot import (
    DummyDetectorMOT,
    NoneDetectorMOT,
    _compute_adaptive_threshold,
    _detect_candidates_multi,
    _to_uint8_gray,
)

###### _to_uint8_gray ################################


class TestToUint8Gray:
    def test_uint8_2d_passthrough(self, frame_uint8_gray):
        out = _to_uint8_gray(frame_uint8_gray)
        assert out.dtype == np.uint8
        assert out.ndim == 2

    def test_uint16_normalized(self, frame_uint16_gray):
        out = _to_uint8_gray(frame_uint16_gray)
        assert out.dtype == np.uint8
        assert out.ndim == 2

    def test_float32_normalized(self, frame_float32_gray):
        out = _to_uint8_gray(frame_float32_gray)
        assert out.dtype == np.uint8
        assert out.max() <= 255

    def test_zero_frame_stays_zero(self):
        out = _to_uint8_gray(np.zeros((20, 20), dtype=np.uint16))
        assert out.max() == 0

    def test_3channel_rgb_converts_to_gray(self, frame_rgb_uint8):
        pytest.importorskip("cv2")  # cvtColor requiert cv2
        out = _to_uint8_gray(frame_rgb_uint8)
        assert out.ndim == 2
        assert out.dtype == np.uint8
        assert out.shape == frame_rgb_uint8.shape[:2]

    def test_3channel_single_canal_extracted(self):
        # Frame 4 canaux ou canal unique → prend frame[:,:,0]
        frame = np.stack(
            [
                np.full((10, 10), 42, dtype=np.uint8),
                np.full((10, 10), 99, dtype=np.uint8),
            ],
            axis=2,
        )  # shape (10,10,2)
        out = _to_uint8_gray(frame)
        assert out.ndim == 2
        assert out[0, 0] == 42  # prend le canal 0


###### _compute_adaptive_threshold #############################################


class TestComputeAdaptiveThreshold:
    def test_fixed_mode_uses_threshold_rel(self):
        img = np.full((100, 100), 200, dtype=np.uint8)
        thresh, _ = _compute_adaptive_threshold(img, 0.5, False, 2.0, 5)
        assert thresh == int(0.5 * 200)

    def test_zero_image_thresh_is_zero(self):
        img = np.zeros((50, 50), dtype=np.uint8)
        thresh, _ = _compute_adaptive_threshold(img, 0.5, False, 2.0, 5)
        assert thresh == 0

    def test_adaptive_mode_respects_min_thresh_abs(self):
        img = np.full((50, 50), 10, dtype=np.uint8)
        min_abs = 15
        thresh, _ = _compute_adaptive_threshold(img, 0.5, True, 2.0, min_abs)
        assert thresh >= min_abs

    def test_adaptive_mode_bounded_by_max_val(self):
        img = np.full((50, 50), 100, dtype=np.uint8)
        thresh, _ = _compute_adaptive_threshold(img, 0.5, True, 100.0, 5)
        assert thresh <= 100  # ne peut pas dépasser max_val

    def test_stats_contains_expected_keys(self):
        img = np.arange(100, dtype=np.uint8).reshape(10, 10)
        _, stats = _compute_adaptive_threshold(img, 0.5, False, 2.0, 5)
        expected_keys = {"mean_roi", "std_roi", "median_roi", "noise_est", "thresh_final"}
        assert expected_keys <= stats.keys()

    def test_stats_types_are_float(self):
        img = np.arange(100, dtype=np.uint8).reshape(10, 10)
        _, stats = _compute_adaptive_threshold(img, 0.3, True, 2.0, 3)
        for key in ("mean_roi", "std_roi", "median_roi", "noise_est"):
            assert isinstance(stats[key], float), f"{key} devrait être float"

    def test_return_thresh_is_int(self):
        img = np.arange(64, dtype=np.uint8).reshape(8, 8)
        thresh, _ = _compute_adaptive_threshold(img, 0.4, False, 2.0, 5)
        assert isinstance(thresh, int)


###### NoneDetectorMOT ###############################


class TestNoneDetectorMOT:
    def test_returns_empty_list(self, frame_uint8_gray):
        det = NoneDetectorMOT()
        assert det.detect(frame_uint8_gray, frame_idx=0) == []

    def test_returns_empty_on_multiple_calls(self, frame_uint8_gray):
        det = NoneDetectorMOT()
        for i in range(10):
            assert det.detect(frame_uint8_gray, i) == []

    def test_configure_is_noop(self, frame_uint8_gray):
        det = NoneDetectorMOT()
        det.configure({})  # ne doit pas lever
        assert det.detect(frame_uint8_gray, 0) == []

    def test_close_is_noop(self):
        det = NoneDetectorMOT()
        det.close()  # ne doit pas lever


###### DummyDetectorMOT ##############################


class TestDummyDetectorMOT:
    def test_returns_list(self, frame_uint8_gray):
        det = DummyDetectorMOT(n_objects=3, seed=42)
        result = det.detect(frame_uint8_gray, 0)
        assert isinstance(result, list)

    def test_detection_has_6_elements(self, frame_uint8_gray):
        det = DummyDetectorMOT(n_objects=2, seed=0, presence_prob=1.0)
        result = det.detect(frame_uint8_gray, 0)
        for d in result:
            assert len(d) == 6, f"Détection doit avoir 6 éléments, got {len(d)}"

    def test_bbox_valid(self, frame_uint8_gray):
        det = DummyDetectorMOT(n_objects=4, presence_prob=1.0, seed=7)
        for frame_idx in range(5):
            result = det.detect(frame_uint8_gray, frame_idx)
            for d in result:
                x1, y1, x2, y2, score, cls = d
                assert x1 < x2, f"x1={x1} doit être < x2={x2}"
                assert y1 < y2, f"y1={y1} doit être < y2={y2}"

    def test_bbox_within_frame(self, frame_uint8_gray):
        h, w = frame_uint8_gray.shape
        det = DummyDetectorMOT(n_objects=5, presence_prob=1.0, seed=3)
        for frame_idx in range(10):
            result = det.detect(frame_uint8_gray, frame_idx)
            for d in result:
                assert d[0] >= 0, f"x1={d[0]} hors image"
                assert d[1] >= 0, f"y1={d[1]} hors image"
                assert d[2] <= w, f"x2={d[2]} hors image (w={w})"
                assert d[3] <= h, f"y2={d[3]} hors image (h={h})"

    def test_score_in_range(self, frame_uint8_gray):
        det = DummyDetectorMOT(n_objects=3, presence_prob=1.0, seed=0)
        result = det.detect(frame_uint8_gray, 0)
        for d in result:
            assert 0.0 <= d[4] <= 1.0, f"score={d[4]} hors [0,1]"

    def test_class_id_is_zero(self, frame_uint8_gray):
        det = DummyDetectorMOT(n_objects=3, presence_prob=1.0, seed=0)
        result = det.detect(frame_uint8_gray, 0)
        for d in result:
            assert d[5] == 0.0

    def test_presence_prob_zero_returns_empty(self, frame_uint8_gray):
        det = DummyDetectorMOT(n_objects=10, presence_prob=0.0, seed=5)
        result = det.detect(frame_uint8_gray, 0)
        assert result == []

    def test_reproducible_with_same_seed(self, frame_uint8_gray):
        det1 = DummyDetectorMOT(n_objects=3, seed=42)
        det2 = DummyDetectorMOT(n_objects=3, seed=42)
        r1 = det1.detect(frame_uint8_gray, 0)
        r2 = det2.detect(frame_uint8_gray, 0)
        assert r1 == r2

    def test_different_seeds_differ(self, frame_uint8_gray):
        det1 = DummyDetectorMOT(n_objects=3, seed=1)
        det2 = DummyDetectorMOT(n_objects=3, seed=99)
        r1 = det1.detect(frame_uint8_gray, 0)
        r2 = det2.detect(frame_uint8_gray, 0)
        # Avec seeds différentes les positions initiales diffèrent
        assert r1 != r2

    def test_close_is_noop(self):
        det = DummyDetectorMOT()
        det.close()


###### _detect_candidates_multi (requiert cv2) #################################


def _bright_blob_frame():
    """Frame 100×100 avec un blob brillant 10×10 au centre."""
    frame = np.zeros((100, 100), dtype=np.uint8)
    frame[45:55, 45:55] = 200
    return frame


def test_detect_bright_blob():
    pytest.importorskip("cv2")
    frame = _bright_blob_frame()
    blobs, binary_w, binary_b = _detect_candidates_multi(
        frame,
        tophat_kernels=[7],
        k_sigma_levels=[2.0],
        threshold_rel=0.3,
        min_area_px2=4,
        max_area_px2=5000,
    )
    assert len(blobs) >= 1
    assert binary_w.shape == frame.shape
    assert binary_b.shape == frame.shape


def test_empty_frame_no_blobs():
    pytest.importorskip("cv2")
    frame = np.zeros((100, 100), dtype=np.uint8)
    blobs, _, _ = _detect_candidates_multi(
        frame,
        tophat_kernels=[7],
        k_sigma_levels=[2.0],
        threshold_rel=0.3,
        min_area_px2=4,
        max_area_px2=5000,
    )
    assert blobs == []


def test_blob_format():
    pytest.importorskip("cv2")
    frame = _bright_blob_frame()
    blobs, _, _ = _detect_candidates_multi(
        frame,
        tophat_kernels=[7],
        k_sigma_levels=[2.0],
        threshold_rel=0.3,
        min_area_px2=4,
        max_area_px2=5000,
    )
    for b in blobs:
        assert len(b) == 6
        x1, y1, x2, y2, score, cls = b
        assert x1 <= x2
        assert y1 <= y2
        assert 0.0 <= score <= 1.0
        assert cls == 0.0


def test_blob_filtered_by_min_area():
    pytest.importorskip("cv2")
    frame = _bright_blob_frame()  # blob ~100 px²
    blobs, _, _ = _detect_candidates_multi(
        frame,
        tophat_kernels=[7],
        k_sigma_levels=[2.0],
        threshold_rel=0.3,
        min_area_px2=500,  # seuil trop grand → aucun blob
        max_area_px2=5000,
    )
    assert blobs == []


def test_multi_kernel_returns_deduped():
    pytest.importorskip("cv2")
    frame = _bright_blob_frame()
    blobs_single, _, _ = _detect_candidates_multi(
        frame,
        [7],
        [2.0],
        0.3,
        4,
        5000,
        dedup_dist_px=5.0,
    )
    blobs_multi, _, _ = _detect_candidates_multi(
        frame,
        [5, 7],
        [1.5, 2.0],
        0.3,
        4,
        5000,
        dedup_dist_px=5.0,
    )
    # Multi-kernel peut trouver plus ou autant de blobs, mais pas de doublons
    # (mêmes blobs dédupliqués par centre)
    for b in blobs_multi:
        cx = (b[0] + b[2]) / 2.0
        cy = (b[1] + b[3]) / 2.0
        duplicates = [
            other
            for other in blobs_multi
            if other is not b
            and abs((other[0] + other[2]) / 2.0 - cx) < 5.0
            and abs((other[1] + other[3]) / 2.0 - cy) < 5.0
        ]
        assert len(duplicates) == 0, "Blob dupliqué trouvé après déduplication"
