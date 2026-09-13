"""
Tests unitaires pour data/annotation_loader.py.

Couvre : load_annotations (dispatch), _load_ver, _load_yolo_merged,
         _load_yolo_folder, _load_yolo_single_frame, _yolo_norm_to_pixel,
         _filename_to_frame_idx, _peek_column_count.
"""

import pytest

from data.rejeu.annotation_loader import (
    _filename_to_frame_idx,
    _peek_column_count,
    _yolo_norm_to_pixel,
    load_annotations,
)


# ## load_annotations -  cas limites ###########################################


def test_empty_string_returns_empty():
    assert load_annotations("") == {}


def test_nonexistent_file_returns_empty(tmp_path):
    assert load_annotations(str(tmp_path / "ghost.ver")) == {}


def test_unknown_extension_falls_back_to_ver(tmp_path):
    f = tmp_path / "annot.xyz"
    f.write_text("1 1 10 20 50 60\n", encoding="utf-8")
    result = load_annotations(str(f))
    assert 0 in result


# ## _load_ver -  format long natif (10 colonnes) ################################


@pytest.fixture
def ver_long(tmp_path):
    content = (
        "# commentaire\n"
        "1 1 100 80 130 110 42 drone subclass source\n"
        "1 1 200 150 250 200 43 bird subclass source\n"
        "2 1 300 200 350 250 42 drone subclass source\n"
    )
    p = tmp_path / "annot.ver"
    p.write_text(content, encoding="utf-8")
    return p


def test_ver_long_frame_count(ver_long):
    result = load_annotations(str(ver_long))
    assert len(result) == 2  # frames 1 et 2 -> indices 0 et 1


def test_ver_long_frame0_has_two_boxes(ver_long):
    result = load_annotations(str(ver_long))
    assert len(result[0]) == 2


def test_ver_long_frame1_has_one_box(ver_long):
    result = load_annotations(str(ver_long))
    assert len(result[1]) == 1


def test_ver_long_class_drone(ver_long):
    result = load_annotations(str(ver_long))
    cls = result[0][0][0]
    assert cls == 0  # "drone" -> 0


def test_ver_long_class_bird(ver_long):
    result = load_annotations(str(ver_long))
    cls = result[0][1][0]
    assert cls == 1  # "bird" -> 1


def test_ver_long_coords(ver_long):
    result = load_annotations(str(ver_long))
    _, x1, y1, x2, y2, _ = result[0][0]
    assert (x1, y1, x2, y2) == (100, 80, 130, 110)


def test_ver_long_track_id(ver_long):
    result = load_annotations(str(ver_long))
    track_id = result[0][0][5]
    assert track_id == 42


def test_ver_1based_to_0based(ver_long):
    result = load_annotations(str(ver_long))
    assert 0 in result   # frame 1 dans .ver -> index 0
    assert 1 in result   # frame 2 dans .ver -> index 1


# ## _load_ver -  format court (6 colonnes) ####################################


@pytest.fixture
def ver_short(tmp_path):
    content = "1 1 10 20 50 60\n2 1 70 80 90 100\n"
    p = tmp_path / "short.ver"
    p.write_text(content, encoding="utf-8")
    return p


def test_ver_short_parses(ver_short):
    result = load_annotations(str(ver_short))
    assert 0 in result and 1 in result


def test_ver_short_track_id_is_zero(ver_short):
    result = load_annotations(str(ver_short))
    assert result[0][0][5] == 0


def test_ver_ignores_comment_lines(tmp_path):
    content = "# full comment line\n1 1 10 20 50 60\n"
    p = tmp_path / "c.ver"
    p.write_text(content, encoding="utf-8")
    result = load_annotations(str(p))
    assert len(result) == 1


def test_ver_ignores_malformed_lines(tmp_path):
    content = "1 1 10 20 50 60\nbad line\n2 1 10 20 50 60\n"
    p = tmp_path / "bad.ver"
    p.write_text(content, encoding="utf-8")
    result = load_annotations(str(p))
    assert 0 in result and 1 in result


# ## YOLO merged (.txt 6 colonnes) ############################################


@pytest.fixture
def yolo_merged(tmp_path):
    content = (
        "# header\n"
        "0 0 0.500 0.500 0.100 0.100\n"
        "0 1 0.300 0.300 0.200 0.200\n"
        "1 0 0.700 0.700 0.100 0.100\n"
    )
    p = tmp_path / "merged.txt"
    p.write_text(content, encoding="utf-8")
    return p


def test_yolo_merged_frame_count(yolo_merged):
    result = load_annotations(str(yolo_merged), 640, 512)
    assert len(result) == 2


def test_yolo_merged_frame0_boxes(yolo_merged):
    result = load_annotations(str(yolo_merged), 640, 512)
    assert len(result[0]) == 2


def test_yolo_merged_frame1_boxes(yolo_merged):
    result = load_annotations(str(yolo_merged), 640, 512)
    assert len(result[1]) == 1


def test_yolo_merged_class(yolo_merged):
    result = load_annotations(str(yolo_merged), 640, 512)
    assert result[0][0][0] == 0
    assert result[0][1][0] == 1


def test_yolo_merged_coords_valid(yolo_merged):
    result = load_annotations(str(yolo_merged), 640, 512)
    cls, x1, y1, x2, y2 = result[0][0]
    assert x1 < x2 and y1 < y2


def test_yolo_merged_skips_short_lines(tmp_path):
    content = "0 0 0.5 0.5\n0 0 0.5 0.5 0.1 0.1\n"
    p = tmp_path / "short.txt"
    p.write_text(content, encoding="utf-8")
    result = load_annotations(str(p), 640, 512)
    assert len(result[0]) == 1


# ## YOLO folder (un .txt par frame) ##########################################


@pytest.fixture
def yolo_folder(tmp_path):
    folder = tmp_path / "labels"
    folder.mkdir()
    (folder / "frame_0000.txt").write_text("0 0.5 0.5 0.1 0.1\n", encoding="utf-8")
    (folder / "frame_0001.txt").write_text("1 0.3 0.3 0.2 0.2\n0 0.7 0.7 0.1 0.1\n", encoding="utf-8")
    (folder / "frame_0002.txt").write_text("", encoding="utf-8")  # frame vide
    return folder


def test_yolo_folder_frame_count(yolo_folder):
    result = load_annotations(str(yolo_folder), 640, 512)
    assert 0 in result and 1 in result


def test_yolo_folder_frame0_one_box(yolo_folder):
    result = load_annotations(str(yolo_folder), 640, 512)
    assert len(result[0]) == 1


def test_yolo_folder_frame1_two_boxes(yolo_folder):
    result = load_annotations(str(yolo_folder), 640, 512)
    assert len(result[1]) == 2


def test_yolo_folder_empty_file_ignored(yolo_folder):
    result = load_annotations(str(yolo_folder), 640, 512)
    assert 2 not in result


def test_yolo_empty_folder_returns_empty(tmp_path):
    empty = tmp_path / "empty"
    empty.mkdir()
    result = load_annotations(str(empty), 640, 512)
    assert result == {}


# ## YOLO single frame (5 colonnes, dispatch via _peek_column_count) ##########


def test_yolo_single_frame_dispatch(tmp_path):
    p = tmp_path / "single.txt"
    p.write_text("0 0.5 0.5 0.1 0.1\n", encoding="utf-8")
    result = load_annotations(str(p), 640, 512)
    assert 0 in result
    assert len(result[0]) == 1


# ## _yolo_norm_to_pixel #############################


def test_yolo_norm_center():
    x1, y1, x2, y2 = _yolo_norm_to_pixel(0.5, 0.5, 0.1, 0.1, 640, 512)
    assert x1 < 320 < x2
    assert y1 < 256 < y2


def test_yolo_norm_coords_valid():
    x1, y1, x2, y2 = _yolo_norm_to_pixel(0.5, 0.5, 0.2, 0.2, 640, 512)
    assert x1 < x2
    assert y1 < y2


def test_yolo_norm_zero_image_size_no_crash():
    x1, y1, x2, y2 = _yolo_norm_to_pixel(0.5, 0.5, 0.1, 0.1, 0, 0)
    assert isinstance(x1, int)


def test_yolo_norm_full_frame():
    x1, y1, x2, y2 = _yolo_norm_to_pixel(0.5, 0.5, 1.0, 1.0, 100, 100)
    assert x1 == 0 and y1 == 0 and x2 == 100 and y2 == 100


# ## _filename_to_frame_idx ####################################################


def test_filename_frame_idx_padded():
    assert _filename_to_frame_idx("frame_000042") == 42


def test_filename_frame_idx_bare_digits():
    assert _filename_to_frame_idx("000042") == 42


def test_filename_frame_idx_embedded():
    assert _filename_to_frame_idx("img42_mask") == 42


def test_filename_frame_idx_no_digits():
    assert _filename_to_frame_idx("nodigits") == 0


def test_filename_frame_idx_zero():
    assert _filename_to_frame_idx("frame_0000") == 0


# ## _peek_column_count ##############################


def test_peek_column_count_5(tmp_path):
    p = tmp_path / "f.txt"
    p.write_text("0 0.5 0.5 0.1 0.1\n", encoding="utf-8")
    assert _peek_column_count(p) == 5


def test_peek_column_count_6(tmp_path):
    p = tmp_path / "f.txt"
    p.write_text("0 0 0.5 0.5 0.1 0.1\n", encoding="utf-8")
    assert _peek_column_count(p) == 6


def test_peek_column_count_skips_comments(tmp_path):
    p = tmp_path / "f.txt"
    p.write_text("# comment\n0 0.5 0.5 0.1 0.1\n", encoding="utf-8")
    assert _peek_column_count(p) == 5


def test_peek_column_count_empty_file(tmp_path):
    p = tmp_path / "empty.txt"
    p.write_text("", encoding="utf-8")
    assert _peek_column_count(p) == 0
