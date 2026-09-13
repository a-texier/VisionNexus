"""
Tests unitaires pour pipeline/ego_motion.py.

Couvre :
  - _frame_to_uint8           : normalisation dtype → uint8
  - EgoMotionCompensator      : construction K, rotation LDV, homographie, compensation
  - FrameBuffer / LdvBuffer   : push/get, éviction par maxlen
"""

import math

import numpy as np
import pytest

from pipeline.ego_motion import (
    EgoMotionCompensator,
    FrameBuffer,
    LdvBuffer,
    _frame_to_uint8,
)

###### _frame_to_uint8 ###############################


class TestFrameToUint8:
    def test_uint8_input_stays_uint8(self, frame_uint8_gray):
        out = _frame_to_uint8(frame_uint8_gray)
        assert out.dtype == np.uint8
        assert out.shape == frame_uint8_gray.shape

    def test_uint16_normalized_to_full_range(self, frame_uint16_gray):
        out = _frame_to_uint8(frame_uint16_gray)
        assert out.dtype == np.uint8
        assert out.max() == 255
        assert out.min() == 0

    def test_float32_produces_valid_uint8(self, frame_float32_gray):
        out = _frame_to_uint8(frame_float32_gray)
        assert out.dtype == np.uint8
        assert 0 <= int(out.min()) <= int(out.max()) <= 255

    def test_flat_frame_no_crash(self):
        flat = np.full((50, 50), 128, dtype=np.uint8)
        out = _frame_to_uint8(flat)
        assert out.dtype == np.uint8
        assert out.shape == (50, 50)

    def test_all_zeros_stays_zero(self):
        out = _frame_to_uint8(np.zeros((10, 10), dtype=np.float32))
        assert out.max() == 0

    def test_output_clipped_to_255(self):
        big = np.array([[0.0, 1.0]], dtype=np.float32)
        out = _frame_to_uint8(big)
        assert out.max() <= 255


###### EgoMotionCompensator -  matrice intrinsèque ##############################


class TestBuildK:
    def test_explicit_focal_length(self):
        comp = EgoMotionCompensator(focal_length_px=500.0)
        K = comp._build_K(h=512, w=640)
        assert K.shape == (3, 3)
        assert K[0, 0] == pytest.approx(500.0)
        assert K[1, 1] == pytest.approx(500.0)
        assert K[0, 2] == pytest.approx(320.0)  # cx = w/2
        assert K[1, 2] == pytest.approx(256.0)  # cy = h/2
        assert K[2, 2] == pytest.approx(1.0)

    def test_focal_from_chh_90deg(self):
        # f = (w/2) / tan(45°) = w/2
        comp = EgoMotionCompensator(hfov_deg=90.0)
        K = comp._build_K(h=512, w=640)
        assert K[0, 0] == pytest.approx(320.0, rel=1e-6)

    def test_focal_from_chh_14deg(self):
        comp = EgoMotionCompensator(hfov_deg=14.0)
        K = comp._build_K(h=512, w=640)
        expected_f = 320.0 / math.tan(math.radians(7.0))
        assert K[0, 0] == pytest.approx(expected_f, rel=1e-6)

    def test_K_cached_on_same_shape(self):
        comp = EgoMotionCompensator(focal_length_px=400.0)
        K1 = comp._get_K(512, 640)
        K2 = comp._get_K(512, 640)
        assert K1 is K2  # même objet : pas de reconstruction

    def test_K_rebuilt_on_shape_change(self):
        comp = EgoMotionCompensator(focal_length_px=400.0)
        K1 = comp._get_K(512, 640)
        K2 = comp._get_K(256, 320)
        assert K1 is not K2


###### EgoMotionCompensator -  rotation LDV #####################################


class TestLdvToRotation:
    def test_identity_when_no_delta(self):
        R = EgoMotionCompensator._ldv_to_rotation((10.0, 5.0), (10.0, 5.0))
        assert np.allclose(R, np.eye(3), atol=1e-12)

    def test_shape(self):
        R = EgoMotionCompensator._ldv_to_rotation((0.0, 0.0), (1.0, 0.5))
        assert R.shape == (3, 3)

    def test_orthogonality(self):
        R = EgoMotionCompensator._ldv_to_rotation((5.0, 2.0), (6.5, 3.0))
        assert np.allclose(R @ R.T, np.eye(3), atol=1e-10)

    def test_determinant_is_one(self):
        R = EgoMotionCompensator._ldv_to_rotation((0.0, 0.0), (2.0, 1.0))
        assert math.isclose(float(np.linalg.det(R)), 1.0, rel_tol=1e-9)

    def test_transpose_is_inverse(self):
        # Pour une matrice de rotation orthogonale : R.T @ R = I (et R @ R.T = I)
        # Note : R(A→B) @ R(B→A) ≠ I car Ry·Rx n'est pas commutatif.
        R = EgoMotionCompensator._ldv_to_rotation((0.0, 0.0), (3.0, 1.0))
        assert np.allclose(R.T @ R, np.eye(3), atol=1e-10)


###### EgoMotionCompensator -  homographie ######################################


class TestBuildHomography:
    def test_identity_when_no_delta(self):
        comp = EgoMotionCompensator(focal_length_px=500.0)
        H = comp.build_homography((0.0, 0.0), (0.0, 0.0), (512, 640))
        assert np.allclose(H, np.eye(3), atol=1e-10)

    def test_shape(self):
        comp = EgoMotionCompensator(focal_length_px=500.0)
        H = comp.build_homography((0.0, 0.0), (1.0, 0.5), (512, 640))
        assert H.shape == (3, 3)

    def test_h22_normalized_to_one(self):
        comp = EgoMotionCompensator(focal_length_px=500.0)
        H = comp.build_homography((0.0, 0.0), (2.0, 1.0), (512, 640))
        assert H[2, 2] == pytest.approx(1.0, abs=1e-10)

    def test_different_shapes_rebuild_K(self):
        comp = EgoMotionCompensator(focal_length_px=500.0)
        H1 = comp.build_homography((0.0, 0.0), (1.0, 0.0), (512, 640))
        H2 = comp.build_homography((0.0, 0.0), (1.0, 0.0), (256, 320))
        # Petite image → focale identique → H différent (cx/cy différents)
        assert not np.allclose(H1, H2)


###### EgoMotionCompensator -  _transform_point #################################


class TestTransformPoint:
    def test_identity_H(self, identity_H):
        x, y = EgoMotionCompensator._transform_point(identity_H, (100.0, 200.0))
        assert x == pytest.approx(100.0)
        assert y == pytest.approx(200.0)

    def test_pure_translation(self, translation_H):
        x, y = EgoMotionCompensator._transform_point(translation_H, (50.0, 60.0))
        assert x == pytest.approx(60.0)
        assert y == pytest.approx(80.0)

    def test_origin(self, identity_H):
        x, y = EgoMotionCompensator._transform_point(identity_H, (0.0, 0.0))
        assert x == pytest.approx(0.0)
        assert y == pytest.approx(0.0)


###### EgoMotionCompensator -  compensate_detections ############################


class TestCompensateDetections:
    def test_identity_H_no_change(self, identity_H, dummy_detection):
        comp = EgoMotionCompensator(focal_length_px=500.0)
        result = comp.compensate_detections([dummy_detection], identity_H)
        assert len(result) == 1
        r = result[0]
        assert r[0] == pytest.approx(dummy_detection[0])
        assert r[1] == pytest.approx(dummy_detection[1])
        assert r[2] == pytest.approx(dummy_detection[2])
        assert r[3] == pytest.approx(dummy_detection[3])
        assert r[4] == pytest.approx(dummy_detection[4])  # score conservé

    def test_translation_shifts_center_keeps_size(self, translation_H):
        # Box 30×30 centrée en (115, 95). Tx=+10 → centre passe à (125, 115).
        det = [100.0, 80.0, 130.0, 110.0, 0.9, 0.0]
        comp = EgoMotionCompensator(focal_length_px=500.0)
        result = comp.compensate_detections([det], translation_H)
        r = result[0]
        assert r[2] - r[0] == pytest.approx(30.0, abs=1e-6)  # largeur conservée
        assert r[3] - r[1] == pytest.approx(30.0, abs=1e-6)  # hauteur conservée
        assert (r[0] + r[2]) / 2 == pytest.approx(125.0, abs=1e-6)  # cx déplacé

    def test_empty_detections(self, identity_H):
        comp = EgoMotionCompensator(focal_length_px=500.0)
        assert comp.compensate_detections([], identity_H) == []

    def test_none_H_returns_original(self, dummy_detections):
        comp = EgoMotionCompensator(focal_length_px=500.0)
        result = comp.compensate_detections(dummy_detections, None)
        assert result is dummy_detections  # renvoyé tel quel sans copie

    def test_multiple_detections(self, identity_H, dummy_detections):
        comp = EgoMotionCompensator(focal_length_px=500.0)
        result = comp.compensate_detections(dummy_detections, identity_H)
        assert len(result) == len(dummy_detections)

    def test_score_and_class_preserved(self, translation_H):
        det = [50.0, 40.0, 80.0, 70.0, 0.77, 2.0]
        comp = EgoMotionCompensator(focal_length_px=500.0)
        r = comp.compensate_detections([det], translation_H)[0]
        assert r[4] == pytest.approx(0.77)
        assert r[5] == pytest.approx(2.0)


###### FrameBuffer ###################################


class TestFrameBuffer:
    def test_push_and_get(self, frame_uint8_gray):
        buf = FrameBuffer(max_delay=10)
        buf.push(5, frame_uint8_gray)
        assert buf.get(5) is frame_uint8_gray

    def test_get_missing_returns_none(self):
        buf = FrameBuffer(max_delay=10)
        assert buf.get(999) is None

    def test_empty_buffer(self):
        buf = FrameBuffer(max_delay=5)
        assert buf.get(0) is None

    def test_maxlen_evicts_oldest(self):
        buf = FrameBuffer(max_delay=3)
        frames = [np.zeros((2, 2), dtype=np.uint8) + i for i in range(4)]
        for i, f in enumerate(frames):
            buf.push(i, f)
        assert buf.get(0) is None  # évincé
        assert buf.get(3) is frames[3]  # le plus récent est là

    def test_multiple_pushes_same_id(self, frame_uint8_gray, frame_float32_gray):
        buf = FrameBuffer(max_delay=5)
        buf.push(1, frame_uint8_gray)
        buf.push(1, frame_float32_gray)
        # get renvoie la première occurrence trouvée (reversed → la plus récente)
        result = buf.get(1)
        assert result is not None

    def test_fifo_order(self):
        buf = FrameBuffer(max_delay=5)
        frames = [np.full((2, 2), i, dtype=np.uint8) for i in range(5)]
        for i, f in enumerate(frames):
            buf.push(i, f)
        for i, f in enumerate(frames):
            assert buf.get(i) is f


###### LdvBuffer #####################################


class TestLdvBuffer:
    def test_push_and_get(self):
        buf = LdvBuffer(max_delay=10)
        buf.push(5, (10.0, 3.0))
        assert buf.get(5) == (10.0, 3.0)

    def test_get_missing_returns_none(self):
        buf = LdvBuffer(max_delay=10)
        assert buf.get(999) is None

    def test_push_none_ldv_ignored(self):
        buf = LdvBuffer(max_delay=10)
        buf.push(1, None)
        assert buf.get(1) is None

    def test_maxlen_evicts_oldest(self):
        buf = LdvBuffer(max_delay=3)
        for i in range(4):
            buf.push(i, (float(i), 0.0))
        assert buf.get(0) is None
        assert buf.get(3) == (3.0, 0.0)

    def test_multiple_entries(self):
        buf = LdvBuffer(max_delay=20)
        for i in range(10):
            buf.push(i, (float(i * 2), float(i)))
        for i in range(10):
            assert buf.get(i) == (float(i * 2), float(i))
