"""
Fixtures partagées pour tous les tests VisionNexus.

Chargé automatiquement par pytest depuis n'importe quel sous-dossier de tests/.
Contient uniquement des données synthétiques (numpy) -  aucune dépendance projet ici.
"""

import numpy as np
import pytest

###### Frames synthétiques ###########################


@pytest.fixture
def frame_uint8_gray():
    """Frame 640×512 uint8 niveaux de gris (simulée, seed fixe)."""
    rng = np.random.default_rng(0)
    return rng.integers(0, 255, (512, 640), dtype=np.uint8)


@pytest.fixture
def frame_uint16_gray():
    """Frame IR 640×512 uint16 (caméra thermique simulée, plage 1000-4096)."""
    rng = np.random.default_rng(1)
    return rng.integers(1000, 4096, (512, 640), dtype=np.uint16)


@pytest.fixture
def frame_float32_gray():
    """Frame float32 normalisée dans [0, 1]."""
    rng = np.random.default_rng(2)
    return rng.random((512, 640)).astype(np.float32)


@pytest.fixture
def frame_rgb_uint8():
    """Frame RGB 3 canaux uint8 pour tester les conversions couleur → gris."""
    rng = np.random.default_rng(3)
    return rng.integers(0, 255, (512, 640, 3), dtype=np.uint8)


###### Homographies ##################################


@pytest.fixture
def identity_H():
    """Homographie identité 3×3 (aucune transformation)."""
    return np.eye(3, dtype=np.float64)


@pytest.fixture
def translation_H():
    """Homographie = translation (+10 px en X, +20 px en Y)."""
    H = np.eye(3, dtype=np.float64)
    H[0, 2] = 10.0
    H[1, 2] = 20.0
    return H


###### Détections ####################################


@pytest.fixture
def dummy_detection():
    """Détection unique [x1, y1, x2, y2, score, class_id]."""
    return [100.0, 80.0, 130.0, 110.0, 0.85, 0.0]


@pytest.fixture
def dummy_detections():
    """Liste de 3 détections valides."""
    return [
        [100.0, 80.0, 130.0, 110.0, 0.85, 0.0],
        [200.0, 150.0, 250.0, 190.0, 0.72, 0.0],
        [320.0, 300.0, 360.0, 340.0, 0.60, 1.0],
    ]
