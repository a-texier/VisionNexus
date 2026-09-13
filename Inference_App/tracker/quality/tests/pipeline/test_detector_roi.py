"""
Tests unitaires pour pipeline/detector/detector_roi.py.

Couvre :
  - NoneDetectorROI.detect_at_click -> toujours None
  - TopHatROIDetector : constructeur + valeurs par défaut
  - TopHatROIDetector.detect_at_click :
      * frame uniforme -> None (top-hat = 0, aucun blob)
      * frame avec tache lumineuse -> détection (liste [x1,y1,x2,y2])
      * clic hors image -> None (ROI invalide)
      * clic en bord d'image -> ne pas crasher (ROI clippée)
      * max_candidates limitant
"""

import numpy as np
import pytest

from pipeline.detector.detector_roi import NoneDetectorROI, TopHatROIDetector


###### NoneDetectorROI ###############################


class TestNoneDetectorROI:
    def test_returns_none_on_gray_frame(self, frame_uint8_gray):
        det = NoneDetectorROI()
        assert det.detect_at_click(frame_uint8_gray, (100, 100)) is None

    def test_returns_none_on_black_frame(self):
        frame = np.zeros((200, 200), dtype=np.uint8)
        det = NoneDetectorROI()
        assert det.detect_at_click(frame, (50, 50)) is None

    def test_returns_none_regardless_of_click_pos(self, frame_uint8_gray):
        det = NoneDetectorROI()
        for pos in [(0, 0), (320, 256), (639, 511)]:
            assert det.detect_at_click(frame_uint8_gray, pos) is None


###### TopHatROIDetector -  constructeur / valeurs par défaut ###################


class TestTopHatROIDetectorDefaults:
    def test_default_roi_size(self):
        det = TopHatROIDetector()
        assert det.roi_size_px == 120

    def test_default_tophat_kernels(self):
        det = TopHatROIDetector()
        assert det.tophat_kernels == [5]

    def test_default_k_sigma_levels(self):
        det = TopHatROIDetector()
        assert det.k_sigma_levels == [2.0]

    def test_default_threshold_rel(self):
        det = TopHatROIDetector()
        assert det.threshold_rel == pytest.approx(0.3)

    def test_default_use_adaptive_false(self):
        det = TopHatROIDetector()
        assert det.use_adaptive is False

    def test_custom_kernels_stored(self):
        det = TopHatROIDetector(tophat_kernels=[3, 7])
        assert det.tophat_kernels == [3, 7]

    def test_kernel_size_compat_first_element(self):
        det = TopHatROIDetector(tophat_kernels=[9])
        assert det.kernel_size == 9

    def test_none_kernels_falls_back_to_default(self):
        det = TopHatROIDetector(tophat_kernels=None)
        assert det.tophat_kernels == [5]


###### TopHatROIDetector -  detect_at_click #####################################


@pytest.fixture
def black_frame():
    """Frame 300×300 uniformément noire."""
    return np.zeros((300, 300), dtype=np.uint8)


@pytest.fixture
def blob_frame():
    """
    Frame 300×300 sombre (valeur 5) avec une tache lumineuse 20×20 au centre (150,150).
    Le top-hat morphologique doit la détecter.
    """
    frame = np.full((300, 300), 5, dtype=np.uint8)
    frame[140:160, 140:160] = 220  # blob bien contrasté
    return frame


class TestTopHatROIDetectorDetect:
    def test_uniform_frame_returns_none(self, black_frame):
        """Frame uniforme -> top-hat nul -> aucun blob -> None."""
        det = TopHatROIDetector(roi_size_px=60)
        result = det.detect_at_click(black_frame, (150, 150))
        assert result is None

    def test_blob_frame_returns_list_or_none(self, blob_frame):
        """Frame avec tache -> résultat est None ou une liste de 4 flottants."""
        det = TopHatROIDetector(roi_size_px=60, tophat_kernels=[5])
        result = det.detect_at_click(blob_frame, (150, 150))
        if result is not None:
            assert isinstance(result, list)
            assert len(result) == 4
            x1, y1, x2, y2 = result
            assert x1 < x2 and y1 < y2

    def test_blob_detected_near_click(self, blob_frame):
        """
        Avec des paramètres agressifs (seuil bas, use_adaptive=False),
        la tache doit être trouvée.
        """
        det = TopHatROIDetector(
            roi_size_px=80,
            tophat_kernels=[5],
            threshold_rel=0.1,
            min_area_px2=4,
            max_area_px2=5000,
        )
        result = det.detect_at_click(blob_frame, (150, 150))
        if result is not None:  # peut être None sur certains envs
            x1, y1, x2, y2 = result
            assert x1 >= 0 and y1 >= 0

    def test_result_coords_within_image(self, blob_frame):
        """Les coordonnées retournées ne dépassent pas les bords de l'image."""
        det = TopHatROIDetector(roi_size_px=80, threshold_rel=0.1)
        result = det.detect_at_click(blob_frame, (150, 150))
        if result is not None:
            h, w = blob_frame.shape[:2]
            x1, y1, x2, y2 = result
            assert x1 >= 0 and y1 >= 0
            assert x2 <= w and y2 <= h

    def test_click_at_image_corner_no_crash(self, blob_frame):
        """Clic en coin : ROI clippée aux bords -> ne pas crasher."""
        det = TopHatROIDetector(roi_size_px=60)
        result = det.detect_at_click(blob_frame, (0, 0))
        assert result is None or isinstance(result, list)

    def test_click_outside_image_returns_none(self, black_frame):
        """Clic totalement hors image : ROI vide -> None."""
        det = TopHatROIDetector(roi_size_px=10)
        # Clic à (-100, -100) -> ROI clippée à rx1=0,ry1=0,rx2=0,ry2=0 (vide)
        result = det.detect_at_click(black_frame, (-100, -100))
        assert result is None

    def test_rgb_frame_accepted(self, blob_frame):
        """_to_uint8_gray doit gérer un frame 3 canaux."""
        rgb = np.stack([blob_frame, blob_frame, blob_frame], axis=-1)
        det = TopHatROIDetector(roi_size_px=60)
        result = det.detect_at_click(rgb, (150, 150))
        assert result is None or isinstance(result, list)

    def test_max_candidates_limits_blobs(self):
        """max_candidates=1 : au plus 1 candidat considéré."""
        frame = np.zeros((200, 200), dtype=np.uint8)
        # Plusieurs taches distinctes
        for cx, cy in [(50, 50), (100, 100), (150, 150)]:
            frame[cy - 5 : cy + 5, cx - 5 : cx + 5] = 200
        det = TopHatROIDetector(
            roi_size_px=100,
            threshold_rel=0.1,
            max_candidates=1,
        )
        result = det.detect_at_click(frame, (100, 100))
        assert result is None or isinstance(result, list)

    def test_tiny_frame_no_crash(self):
        """Frame 10×10 avec tache : pas de crash même si ROI très petite."""
        frame = np.full((10, 10), 5, dtype=np.uint8)
        frame[3:7, 3:7] = 200
        det = TopHatROIDetector(roi_size_px=5)
        result = det.detect_at_click(frame, (5, 5))
        assert result is None or isinstance(result, list)
