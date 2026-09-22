# ============================================================
# Tests unitaires — backend/utils/image_utils.py
# Pas de GPU, pas de reseau : uniquement des tableaux numpy en memoire
# ou des petits fichiers PNG/JPEG generes dans tmp_path.
# ============================================================

from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from backend.utils.image_utils import (
    DEFAULT_LUT,
    apply_lut,
    compute_histogram,
    ensure_8bit_cached,
    generate_thumbnail,
    get_image_dimensions,
    image_to_base64,
    is_high_bitdepth_image,
    load_image_bgr_8bit,
    load_image_rgb,
    lut_signature,
    mask_to_bbox_yolo,
    mask_to_polygon,
    to_8bit_3sigma,
)

pytestmark = pytest.mark.unit


# ---------------------------------------------------------------- mask_to_bbox_yolo

def test_mask_to_bbox_yolo_simple_square():
    mask = np.zeros((100, 100), dtype=bool)
    mask[20:40, 30:50] = True  # rows 20..39, cols 30..49
    bbox = mask_to_bbox_yolo(mask, img_width=100, img_height=100)
    assert bbox is not None
    cx, cy, w, h = bbox
    assert cx == pytest.approx((30 + 49) / 2 / 100)
    assert cy == pytest.approx((20 + 39) / 2 / 100)
    assert w == pytest.approx((49 - 30) / 100)
    assert h == pytest.approx((39 - 20) / 100)
    for v in (cx, cy, w, h):
        assert 0.0 <= v <= 1.0


def test_mask_to_bbox_yolo_empty_mask_returns_none():
    mask = np.zeros((50, 50), dtype=bool)
    assert mask_to_bbox_yolo(mask, 50, 50) is None


def test_mask_to_bbox_yolo_single_pixel():
    mask = np.zeros((10, 10), dtype=bool)
    mask[5, 5] = True
    bbox = mask_to_bbox_yolo(mask, 10, 10)
    assert bbox is not None
    cx, cy, w, h = bbox
    assert w == 0.0
    assert h == 0.0
    assert cx == pytest.approx(0.5)
    assert cy == pytest.approx(0.5)


def test_mask_to_bbox_yolo_full_image():
    mask = np.ones((20, 40), dtype=bool)
    cx, cy, w, h = mask_to_bbox_yolo(mask, 40, 20)
    # Bbox couvre pixels [0, dim-1] -> centre legerement avant le milieu exact.
    assert cx == pytest.approx((0 + 39) / 2 / 40)
    assert cy == pytest.approx((0 + 19) / 2 / 20)
    assert w == pytest.approx(39 / 40)
    assert h == pytest.approx(19 / 20)


# ---------------------------------------------------------------- mask_to_polygon

def test_mask_to_polygon_returns_points_for_filled_square():
    mask = np.zeros((100, 100), dtype=bool)
    mask[10:60, 10:60] = True
    pts = mask_to_polygon(mask, 100, 100)
    assert len(pts) >= 3
    for x, y in pts:
        assert 0.0 <= x <= 1.0
        assert 0.0 <= y <= 1.0


def test_mask_to_polygon_empty_mask_returns_empty_list():
    mask = np.zeros((30, 30), dtype=bool)
    assert mask_to_polygon(mask, 30, 30) == []


def test_mask_to_polygon_respects_max_points():
    # Un cercle genere beaucoup de points de contour -> teste le sous-echantillonnage.
    mask = np.zeros((200, 200), dtype=bool)
    yy, xx = np.ogrid[:200, :200]
    circle = (xx - 100) ** 2 + (yy - 100) ** 2 <= 90 ** 2
    mask[circle] = True
    pts = mask_to_polygon(mask, 200, 200, epsilon_factor=0.0001, max_points=10)
    assert len(pts) <= 10


# ---------------------------------------------------------------- LUT / apply_lut

def test_apply_lut_uint8_sigma_mode_is_passthrough():
    img = (np.random.rand(10, 10) * 255).astype(np.uint8)
    out = apply_lut(img, DEFAULT_LUT)
    assert out is img  # meme objet, pas de copie (comportement historique)


def test_apply_lut_uint16_converts_to_uint8_full_range():
    img = np.zeros((10, 10), dtype=np.uint16)
    img[:, :5] = 0
    img[:, 5:] = 65535
    out = apply_lut(img, {"mode": "minmax"})
    assert out.dtype == np.uint8
    assert out.min() == 0
    assert out.max() == 255


def test_apply_lut_manual_mode_clips_out_of_range():
    img = np.array([[0, 50, 100]], dtype=np.float32)
    out = apply_lut(img, {"mode": "manual", "lo": 25.0, "hi": 75.0})
    assert out.dtype == np.uint8
    # 0 -> clip bas (0), 100 -> clip haut (255)
    assert out[0, 0] == 0
    assert out[0, 2] == 255


def test_apply_lut_constant_image_does_not_divide_by_zero():
    img = np.full((5, 5), 42, dtype=np.uint16)
    out = apply_lut(img, {"mode": "minmax"})
    assert out.dtype == np.uint8
    assert np.all(out == 0)  # lo == hi -> plage forcee a +1 -> valeur au minimum


def test_to_8bit_3sigma_matches_apply_lut_default():
    img = np.random.randint(0, 4096, size=(20, 20), dtype=np.uint16)
    assert np.array_equal(to_8bit_3sigma(img), apply_lut(img, DEFAULT_LUT))


def test_lut_signature_default_sigma_is_sig3():
    assert lut_signature(None) == "sig3"
    assert lut_signature(DEFAULT_LUT) == "sig3"


def test_lut_signature_custom_sigma():
    assert lut_signature({"mode": "sigma", "sigma": 2.0}) == "sig2"


def test_lut_signature_minmax():
    assert lut_signature({"mode": "minmax"}) == "mm"


def test_lut_signature_manual_with_bounds():
    sig = lut_signature({"mode": "manual", "lo": 10, "hi": 200})
    assert sig == "man10_200"


def test_lut_signature_manual_with_missing_bounds():
    sig = lut_signature({"mode": "manual", "lo": None, "hi": None})
    assert sig == "man_"


# ---------------------------------------------------------------- compute_histogram

def test_compute_histogram_basic_stats():
    img = np.arange(256, dtype=np.uint8).reshape(16, 16)
    hist = compute_histogram(img, bins=8)
    assert hist["min"] == 0
    assert hist["max"] == 255
    assert len(hist["counts"]) == 8
    assert len(hist["bins"]) == 8
    assert hist["dtype"] == "uint8"
    assert hist["bit_depth"] == 8


def test_compute_histogram_multichannel_converted_to_luminance():
    img = np.zeros((10, 10, 3), dtype=np.uint8)
    img[..., 0] = 100
    hist = compute_histogram(img, bins=4)
    # Moyenne des 3 canaux (100,0,0) = 33.33
    assert hist["mean"] == pytest.approx(100 / 3, abs=0.5)


def test_compute_histogram_downsamples_large_images():
    img = np.random.randint(0, 255, size=(1000, 1000), dtype=np.uint8)
    hist = compute_histogram(img, bins=16, max_samples=1000)
    assert sum(hist["counts"]) <= 1000


# ---------------------------------------------------------------- fichiers (tmp_path)

def test_get_image_dimensions(tmp_path):
    p = tmp_path / "img.png"
    Image.new("RGB", (123, 77)).save(p)
    w, h = get_image_dimensions(str(p))
    assert (w, h) == (123, 77)


def test_generate_thumbnail_creates_file_with_target_size(tmp_path):
    src = tmp_path / "src.png"
    Image.new("RGB", (400, 300), (255, 0, 0)).save(src)
    dst = tmp_path / "out" / "thumb.jpg"
    ok = generate_thumbnail(str(src), str(dst), size=(160, 90))
    assert ok is True
    assert dst.exists()
    with Image.open(dst) as im:
        assert im.size == (160, 90)


def test_generate_thumbnail_missing_source_returns_false(tmp_path):
    ok = generate_thumbnail(str(tmp_path / "does_not_exist.png"), str(tmp_path / "out.jpg"))
    assert ok is False


def test_image_to_base64_roundtrip(tmp_path):
    src = tmp_path / "src.png"
    Image.new("RGB", (20, 20), (0, 255, 0)).save(src)
    b64 = image_to_base64(str(src))
    assert isinstance(b64, str)
    import base64
    raw = base64.b64decode(b64)
    assert raw[:2] == b"\xff\xd8"  # JPEG magic bytes


def test_is_high_bitdepth_image_false_for_8bit_png(tmp_path):
    p = tmp_path / "8bit.png"
    Image.new("RGB", (10, 10)).save(p)
    assert is_high_bitdepth_image(str(p)) is False


def test_is_high_bitdepth_image_true_for_16bit_png(tmp_path):
    p = tmp_path / "16bit.png"
    Image.fromarray(np.zeros((10, 10), dtype=np.uint16), mode="I;16").save(p)
    assert is_high_bitdepth_image(str(p)) is True


def test_is_high_bitdepth_image_missing_file_returns_false(tmp_path):
    assert is_high_bitdepth_image(str(tmp_path / "nope.png")) is False


def test_load_image_bgr_8bit_missing_file_raises(tmp_path):
    with pytest.raises(FileNotFoundError):
        load_image_bgr_8bit(str(tmp_path / "missing.png"))


def test_load_image_bgr_8bit_grayscale_16bit(tmp_path):
    p = tmp_path / "gray16.png"
    arr = np.random.randint(0, 65535, size=(30, 40), dtype=np.uint16)
    Image.fromarray(arr, mode="I;16").save(p)
    out = load_image_bgr_8bit(str(p))
    assert out.dtype == np.uint8
    assert out.shape == (30, 40, 3)


def test_load_image_rgb_channel_order(tmp_path):
    p = tmp_path / "rgb.png"
    arr = np.zeros((5, 5, 3), dtype=np.uint8)
    arr[..., 0] = 255  # Rouge en RGB
    Image.fromarray(arr, mode="RGB").save(p)
    rgb = load_image_rgb(str(p))
    assert rgb[0, 0, 0] == 255  # canal R en premier
    assert rgb[0, 0, 2] == 0


def test_ensure_8bit_cached_returns_none_for_regular_8bit_sigma(tmp_path):
    src = tmp_path / "src.png"
    Image.new("RGB", (10, 10)).save(src)
    cache_dir = tmp_path / "cache"
    result = ensure_8bit_cached(str(src), str(cache_dir))
    assert result is None


def test_ensure_8bit_cached_converts_16bit_and_caches(tmp_path):
    src = tmp_path / "src16.png"
    arr = np.random.randint(0, 65535, size=(10, 10), dtype=np.uint16)
    Image.fromarray(arr, mode="I;16").save(src)
    cache_dir = tmp_path / "cache"

    result = ensure_8bit_cached(str(src), str(cache_dir))
    assert result is not None
    assert Path(result).exists()

    # Deuxieme appel : doit reutiliser le cache (meme chemin, pas de recalcul)
    result2 = ensure_8bit_cached(str(src), str(cache_dir))
    assert result2 == result
