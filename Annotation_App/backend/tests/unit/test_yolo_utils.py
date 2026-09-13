# ============================================================
# Tests unitaires — backend/utils/yolo_utils.py
# Lecture/ecriture de fichiers YOLO, validation de coordonnees, IoU.
# ============================================================

import json

import pytest
import yaml

from backend.utils.yolo_utils import (
    compute_iou,
    read_yolo_label_file,
    validate_yolo_coordinates,
    write_data_yaml,
    write_yolo_label_file,
    write_yolo_segmentation_label_file,
)

pytestmark = pytest.mark.unit


# ---------------------------------------------------------------- write/read label file

def test_write_and_read_yolo_label_file_roundtrip(tmp_path):
    out = tmp_path / "labels" / "frame_0.txt"
    anns = [
        {"class_id": 10, "cx": 0.5, "cy": 0.5, "width": 0.2, "height": 0.3},
        {"class_id": 20, "cx": 0.1, "cy": 0.9, "width": 0.05, "height": 0.05},
    ]
    class_index_map = {10: 0, 20: 1}
    write_yolo_label_file(str(out), anns, class_index_map)

    assert out.exists()
    parsed = read_yolo_label_file(str(out), class_names=["car", "person"])
    assert len(parsed) == 2
    assert parsed[0]["class_index"] == 0
    assert parsed[0]["class_name"] == "car"
    assert parsed[0]["cx"] == pytest.approx(0.5)
    assert parsed[1]["class_name"] == "person"


def test_write_yolo_label_file_empty_annotations_creates_empty_file(tmp_path):
    out = tmp_path / "empty.txt"
    write_yolo_label_file(str(out), [], {})
    assert out.exists()
    assert out.read_text(encoding="utf-8") == ""


def test_write_yolo_label_file_skips_unknown_class(tmp_path):
    out = tmp_path / "labels.txt"
    anns = [{"class_id": 999, "cx": 0.5, "cy": 0.5, "width": 0.1, "height": 0.1}]
    write_yolo_label_file(str(out), anns, class_index_map={1: 0})
    assert out.read_text(encoding="utf-8") == ""


def test_write_yolo_label_file_skips_out_of_bounds(tmp_path):
    out = tmp_path / "labels.txt"
    anns = [{"class_id": 1, "cx": 1.5, "cy": 0.5, "width": 0.1, "height": 0.1}]
    write_yolo_label_file(str(out), anns, class_index_map={1: 0})
    assert out.read_text(encoding="utf-8") == ""


def test_read_yolo_label_file_missing_file_returns_empty_list(tmp_path):
    assert read_yolo_label_file(str(tmp_path / "nope.txt"), []) == []


def test_read_yolo_label_file_ignores_malformed_lines(tmp_path):
    p = tmp_path / "labels.txt"
    p.write_text("0 0.5 0.5 0.1 0.1\nnot a valid line\n1 abc 0.5 0.1 0.1\n\n", encoding="utf-8")
    parsed = read_yolo_label_file(str(p), class_names=["a", "b"])
    assert len(parsed) == 1
    assert parsed[0]["class_index"] == 0


def test_read_yolo_label_file_unknown_class_index_falls_back_to_generic_name(tmp_path):
    p = tmp_path / "labels.txt"
    p.write_text("5 0.5 0.5 0.1 0.1\n", encoding="utf-8")
    parsed = read_yolo_label_file(str(p), class_names=["a"])
    assert parsed[0]["class_name"] == "class_5"


# ---------------------------------------------------------------- segmentation label file

def test_write_yolo_segmentation_with_real_polygon(tmp_path):
    out = tmp_path / "seg.txt"
    anns = [{
        "class_id": 1,
        "annotation_type": "polygon",
        "points": json.dumps([[0.1, 0.1], [0.2, 0.1], [0.2, 0.2]]),
    }]
    has_poly = write_yolo_segmentation_label_file(str(out), anns, {1: 0})
    assert has_poly is True
    line = out.read_text(encoding="utf-8").strip()
    assert line.startswith("0 ")
    assert len(line.split()) == 1 + 3 * 2  # class + 3 points


def test_write_yolo_segmentation_falls_back_to_bbox_rectangle(tmp_path):
    out = tmp_path / "seg.txt"
    anns = [{"class_id": 1, "cx": 0.5, "cy": 0.5, "width": 0.2, "height": 0.4}]
    has_poly = write_yolo_segmentation_label_file(str(out), anns, {1: 0})
    assert has_poly is False
    line = out.read_text(encoding="utf-8").strip()
    parts = line.split()
    assert parts[0] == "0"
    assert len(parts) == 1 + 4 * 2  # rectangle 4 points


def test_write_yolo_segmentation_malformed_points_falls_back(tmp_path):
    out = tmp_path / "seg.txt"
    anns = [{
        "class_id": 1,
        "annotation_type": "polygon",
        "points": "not-json",
        "cx": 0.5, "cy": 0.5, "width": 0.2, "height": 0.2,
    }]
    has_poly = write_yolo_segmentation_label_file(str(out), anns, {1: 0})
    assert has_poly is False  # repli sur bbox rectangle


def test_write_yolo_segmentation_polygon_with_too_few_points_falls_back(tmp_path):
    out = tmp_path / "seg.txt"
    anns = [{
        "class_id": 1,
        "annotation_type": "polygon",
        "points": json.dumps([[0.1, 0.1], [0.2, 0.2]]),  # seulement 2 points
        "cx": 0.5, "cy": 0.5, "width": 0.1, "height": 0.1,
    }]
    has_poly = write_yolo_segmentation_label_file(str(out), anns, {1: 0})
    assert has_poly is False


# ---------------------------------------------------------------- data.yaml

def test_write_data_yaml_contains_expected_fields(tmp_path):
    out = tmp_path / "data.yaml"
    write_data_yaml(str(out), "/dataset", ["car", "person"])
    data = yaml.safe_load(out.read_text(encoding="utf-8"))
    assert data["nc"] == 2
    assert data["names"] == ["car", "person"]
    assert data["path"] == "/dataset"
    assert data["test"] == "images/test"


def test_write_data_yaml_without_test_path_omits_key(tmp_path):
    out = tmp_path / "data.yaml"
    write_data_yaml(str(out), "/dataset", ["car"], test_path=None)
    data = yaml.safe_load(out.read_text(encoding="utf-8"))
    assert "test" not in data


# ---------------------------------------------------------------- validate_yolo_coordinates

@pytest.mark.parametrize("cx,cy,w,h", [
    (0.5, 0.5, 0.5, 0.5),
    (0.0, 0.0, 0.0, 0.0),
    (1.0, 1.0, 0.0, 0.0),
    (0.5, 0.5, 1.0, 1.0),
])
def test_validate_yolo_coordinates_valid_cases(cx, cy, w, h):
    ok, msg = validate_yolo_coordinates(cx, cy, w, h)
    assert ok is True
    assert msg == ""


@pytest.mark.parametrize("cx,cy,w,h", [
    (1.5, 0.5, 0.1, 0.1),   # cx hors [0,1]
    (-0.1, 0.5, 0.1, 0.1),  # cx negatif
    (0.05, 0.5, 0.2, 0.1),  # bord gauche negatif
    (0.95, 0.5, 0.2, 0.1),  # bord droit > 1
    (0.5, 0.05, 0.1, 0.2),  # bord haut negatif
    (0.5, 0.95, 0.1, 0.2),  # bord bas > 1
])
def test_validate_yolo_coordinates_invalid_cases(cx, cy, w, h):
    ok, msg = validate_yolo_coordinates(cx, cy, w, h)
    assert ok is False
    assert msg


# ---------------------------------------------------------------- compute_iou

def test_compute_iou_identical_boxes_is_one():
    box = (0.5, 0.5, 0.2, 0.2)
    assert compute_iou(box, box) == pytest.approx(1.0)


def test_compute_iou_disjoint_boxes_is_zero():
    box1 = (0.1, 0.1, 0.1, 0.1)
    box2 = (0.9, 0.9, 0.1, 0.1)
    assert compute_iou(box1, box2) == 0.0


def test_compute_iou_partial_overlap():
    box1 = (0.5, 0.5, 0.4, 0.4)   # [0.3,0.7]x[0.3,0.7]
    box2 = (0.6, 0.5, 0.4, 0.4)   # [0.4,0.8]x[0.3,0.7]
    iou = compute_iou(box1, box2)
    # intersection = 0.3 x 0.4 = 0.12 ; union = 0.16+0.16-0.12 = 0.2
    assert iou == pytest.approx(0.12 / 0.2, rel=1e-6)


def test_compute_iou_touching_edges_is_zero():
    box1 = (0.25, 0.5, 0.5, 0.5)   # [0,0.5]x[0.25,0.75]
    box2 = (0.75, 0.5, 0.5, 0.5)   # [0.5,1.0]x[0.25,0.75]
    assert compute_iou(box1, box2) == 0.0
