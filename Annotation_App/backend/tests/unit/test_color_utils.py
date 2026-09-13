# ============================================================
# Tests unitaires — backend/utils/color_utils.py
# ============================================================

import pytest

from backend.utils.color_utils import (
    DEFAULT_COLORS,
    generate_distinct_colors,
    get_class_color,
    get_track_color,
    hex_to_rgb,
    rgb_to_hex,
)

pytestmark = pytest.mark.unit


def test_get_class_color_matches_palette_for_low_index():
    assert get_class_color(0) == DEFAULT_COLORS[0]
    assert get_class_color(3) == DEFAULT_COLORS[3]


def test_get_class_color_cycles_beyond_palette_length():
    n = len(DEFAULT_COLORS)
    assert get_class_color(n) == DEFAULT_COLORS[0]
    assert get_class_color(n + 2) == DEFAULT_COLORS[2]


def test_get_track_color_offset_by_three():
    assert get_track_color(0) == DEFAULT_COLORS[3]


def test_get_track_color_wraps_around():
    n = len(DEFAULT_COLORS)
    assert get_track_color(n - 3) == DEFAULT_COLORS[0]


def test_hex_to_rgb_basic():
    assert hex_to_rgb("#3B82F6") == (0x3B, 0x82, 0xF6)


def test_hex_to_rgb_without_hash_prefix():
    assert hex_to_rgb("FF0000") == (255, 0, 0)


def test_rgb_to_hex_basic():
    assert rgb_to_hex(59, 130, 246) == "#3B82F6"


def test_hex_rgb_roundtrip():
    for hexcol in DEFAULT_COLORS:
        r, g, b = hex_to_rgb(hexcol)
        assert rgb_to_hex(r, g, b) == hexcol


def test_generate_distinct_colors_returns_n_colors():
    colors = generate_distinct_colors(5)
    assert len(colors) == 5
    for c in colors:
        assert c.startswith("#")
        assert len(c) == 7


def test_generate_distinct_colors_are_unique_for_reasonable_n():
    colors = generate_distinct_colors(12)
    assert len(set(colors)) == len(colors)


def test_generate_distinct_colors_zero_returns_empty():
    assert generate_distinct_colors(0) == []
