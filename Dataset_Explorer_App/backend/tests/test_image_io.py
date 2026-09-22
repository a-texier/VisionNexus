# ============================================================
# tests/test_image_io.py
# Tests unitaires : chargement robuste d'images (8/16 bits, float, IR).
# ============================================================

import numpy as np
import pytest
from PIL import Image as PILImage

from backend.core.image_io import is_high_bitdepth, load_pil_rgb, to_8bit_3sigma


# ------------------------------------------------------------------ #
# to_8bit_3sigma
# ------------------------------------------------------------------ #

def test_to_8bit_3sigma_output_range():
    a = np.random.randn(50, 50).astype(np.float32) * 1000 + 500
    out = to_8bit_3sigma(a)
    assert out.dtype == np.uint8
    assert out.min() >= 0 and out.max() <= 255


def test_to_8bit_3sigma_constant_array_no_div_by_zero():
    """Tableau constant (std=0) : hi<=lo => garde-fou hi=lo+1, pas de NaN/erreur."""
    a = np.full((10, 10), 42.0, dtype=np.float32)
    out = to_8bit_3sigma(a)
    assert out.dtype == np.uint8
    assert np.isfinite(out).all()


def test_to_8bit_3sigma_preserves_shape():
    a = np.random.randint(0, 65535, size=(20, 30), dtype=np.uint16)
    out = to_8bit_3sigma(a)
    assert out.shape == (20, 30)


# ------------------------------------------------------------------ #
# load_pil_rgb — formats standards
# ------------------------------------------------------------------ #

def test_load_pil_rgb_standard_jpeg(tmp_path):
    p = tmp_path / "img.jpg"
    PILImage.new("RGB", (32, 32), color=(10, 20, 30)).save(p, "JPEG")
    img = load_pil_rgb(str(p))
    assert img.mode == "RGB"
    assert img.size == (32, 32)


def test_load_pil_rgb_grayscale_png_converted_to_rgb(tmp_path):
    p = tmp_path / "gray.png"
    PILImage.new("L", (16, 16), color=128).save(p, "PNG")
    img = load_pil_rgb(str(p))
    assert img.mode == "RGB"


def test_load_pil_rgb_rgba_png_converted_to_rgb(tmp_path):
    p = tmp_path / "rgba.png"
    PILImage.new("RGBA", (16, 16), color=(1, 2, 3, 128)).save(p, "PNG")
    img = load_pil_rgb(str(p))
    assert img.mode == "RGB"
    assert img.size == (16, 16)


# ------------------------------------------------------------------ #
# load_pil_rgb — 16 bits
# ------------------------------------------------------------------ #

def test_load_pil_rgb_16bit_png(tmp_path):
    """PNG 16 bits (mode I;16) doit etre remap 3-sigma vers RGB 8 bits, pas noir/bruit."""
    p = tmp_path / "img16.png"
    arr = (np.random.rand(24, 24) * 65535).astype(np.uint16)
    PILImage.fromarray(arr, mode="I;16").save(p, "PNG")
    img = load_pil_rgb(str(p))
    assert img.mode == "RGB"
    # L'image ne doit pas etre entierement noire (remap effectif)
    px = np.asarray(img)
    assert px.max() > 0


# ------------------------------------------------------------------ #
# is_high_bitdepth
# ------------------------------------------------------------------ #

def test_is_high_bitdepth_8bit_false(tmp_path):
    p = tmp_path / "img8.jpg"
    PILImage.new("RGB", (8, 8)).save(p, "JPEG")
    assert is_high_bitdepth(str(p)) is False


def test_is_high_bitdepth_16bit_true(tmp_path):
    p = tmp_path / "img16.png"
    arr = (np.random.rand(8, 8) * 65535).astype(np.uint16)
    PILImage.fromarray(arr, mode="I;16").save(p, "PNG")
    assert is_high_bitdepth(str(p)) is True


def test_is_high_bitdepth_missing_file_returns_none():
    assert is_high_bitdepth("C:/does/not/exist/nope.png") is None


def test_load_pil_rgb_missing_file_raises():
    with pytest.raises(Exception):
        load_pil_rgb("C:/does/not/exist/nope.jpg")
