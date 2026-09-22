# ============================================================
# test_yolox_dataset.py -- couverture de yolox_dataset.py :
# parsing data.yaml, YOLO .txt, .ver, et le contrat Dataset YOLOX.
# ============================================================

import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services.yolox_dataset import (  # noqa: E402
    VER_CLASS_MAP,
    YoloTxtDataset,
    _filename_to_frame_idx,
    load_data_yaml,
    load_ver_file,
    load_yolo_txt_labels,
)


def _write_yolo_dataset(root: Path, n_images: int = 3) -> Path:
    """Cree un mini dataset YOLO txt : images/train, labels/train, data.yaml."""
    img_dir = root / "images" / "train"
    lbl_dir = root / "labels" / "train"
    img_dir.mkdir(parents=True)
    lbl_dir.mkdir(parents=True)

    import cv2

    for i in range(n_images):
        img = np.full((100, 200, 3), 30, dtype=np.uint8)
        cv2.imwrite(str(img_dir / f"{i:06d}.jpg"), img)
        # boite au centre, 50% largeur/hauteur -> x1=50,y1=25,x2=150,y2=75
        (lbl_dir / f"{i:06d}.txt").write_text("0 0.5 0.5 0.5 0.5\n", encoding="utf-8")

    data_yaml = root / "data.yaml"
    data_yaml.write_text(
        "path: .\ntrain: images/train\nval: images/train\nnames:\n  0: person\n  1: car\n",
        encoding="utf-8",
    )
    return data_yaml


def _write_ver_dataset(root: Path, n_images: int = 3) -> Path:
    """Cree un mini dataset .ver : images/train (frames numerotees 1-based
    dans le fichier .ver, converties en 0-based cote images 0-based)."""
    img_dir = root / "images" / "train"
    img_dir.mkdir(parents=True)

    import cv2

    for i in range(n_images):
        img = np.full((100, 200, 3), 30, dtype=np.uint8)
        cv2.imwrite(str(img_dir / f"{i:06d}.jpg"), img)

    ver_path = root / "annotations.ver"
    lines = []
    for i in range(n_images):
        frame_1based = i + 1
        # format long : frame_id visibility x1 y1 x2 y2 track_id class
        lines.append(f"{frame_1based} 1 50 25 150 75 {i + 1} drone")
    ver_path.write_text("\n".join(lines) + "\n", encoding="utf-8")

    data_yaml = root / "data.yaml"
    data_yaml.write_text(
        f"path: .\ntrain: images/train\nval: images/train\n"
        f"annotation_file: {ver_path.name}\nnames:\n  0: drone\n  1: bird\n",
        encoding="utf-8",
    )
    return data_yaml


# ------------------------------------------------------------------ #
# load_data_yaml                                                       #
# ------------------------------------------------------------------ #


def test_load_data_yaml_yolo_txt(tmp_path):
    data_yaml = _write_yolo_dataset(tmp_path)
    spec = load_data_yaml(str(data_yaml), "train")
    assert spec.label_format == "yolo_txt"
    assert len(spec.image_paths) == 3
    assert spec.class_names == ["person", "car"]
    assert spec.label_source.name == "train"  # dossier labels/train


def test_load_data_yaml_ver(tmp_path):
    data_yaml = _write_ver_dataset(tmp_path)
    spec = load_data_yaml(str(data_yaml), "train")
    assert spec.label_format == "ver"
    assert spec.label_source.suffix == ".ver"
    assert len(spec.image_paths) == 3


def test_load_data_yaml_missing_split_falls_back_to_val(tmp_path):
    data_yaml = _write_yolo_dataset(tmp_path)
    spec = load_data_yaml(
        str(data_yaml), "test"
    )  # pas de cle 'test' -> repli sur 'val'
    assert len(spec.image_paths) == 3


def test_load_data_yaml_no_images_raises(tmp_path):
    (tmp_path / "images" / "empty").mkdir(parents=True)
    data_yaml = tmp_path / "data.yaml"
    data_yaml.write_text(
        "path: .\ntrain: images/empty\nnames:\n  0: x\n", encoding="utf-8"
    )
    with pytest.raises(FileNotFoundError):
        load_data_yaml(str(data_yaml), "train")


# ------------------------------------------------------------------ #
# load_yolo_txt_labels                                                 #
# ------------------------------------------------------------------ #


def test_load_yolo_txt_labels_basic(tmp_path):
    lbl = tmp_path / "a.txt"
    lbl.write_text("0 0.5 0.5 0.5 0.5\n1 0.25 0.25 0.1 0.1\n", encoding="utf-8")
    boxes = load_yolo_txt_labels(lbl, img_w=200, img_h=100)
    assert boxes.shape == (2, 5)
    # premiere boite : centre (100,50), taille (100,50) -> x1=50,y1=25,x2=150,y2=75
    np.testing.assert_allclose(boxes[0], [50, 25, 150, 75, 0], atol=1e-4)
    assert boxes[1, 4] == 1


def test_load_yolo_txt_labels_missing_file_returns_empty(tmp_path):
    boxes = load_yolo_txt_labels(tmp_path / "absent.txt", 100, 100)
    assert boxes.shape == (0, 5)


def test_load_yolo_txt_labels_malformed_line_skipped(tmp_path):
    lbl = tmp_path / "b.txt"
    lbl.write_text(
        "0 0.5 0.5\nnot a number here at all\n0 0.5 0.5 0.2 0.2\n", encoding="utf-8"
    )
    boxes = load_yolo_txt_labels(lbl, 100, 100)
    assert boxes.shape == (1, 5)


# ------------------------------------------------------------------ #
# load_ver_file                                                        #
# ------------------------------------------------------------------ #


def test_load_ver_file_long_format_and_class_map(tmp_path):
    ver = tmp_path / "x.ver"
    ver.write_text(
        "1 1 10 20 30 40 7 drone\n2 1 11 21 31 41 7 bird\n", encoding="utf-8"
    )
    ann = load_ver_file(ver)
    # frames 1-based dans le fichier -> 0-based en sortie
    assert set(ann.keys()) == {0, 1}
    cls0, x1, y1, x2, y2 = ann[0][0]
    assert (cls0, x1, y1, x2, y2) == (VER_CLASS_MAP["drone"], 10, 20, 30, 40)
    assert ann[1][0][0] == VER_CLASS_MAP["bird"]


def test_load_ver_file_short_format_defaults_class_zero(tmp_path):
    ver = tmp_path / "y.ver"
    ver.write_text("1 1 10 20 30 40\n", encoding="utf-8")
    ann = load_ver_file(ver)
    assert ann[0][0][0] == 0


def test_load_ver_file_unknown_class_defaults_zero(tmp_path):
    ver = tmp_path / "z.ver"
    ver.write_text("1 1 10 20 30 40 7 spaceship\n", encoding="utf-8")
    ann = load_ver_file(ver)
    assert ann[0][0][0] == 0


def test_load_ver_file_comment_and_blank_lines_ignored(tmp_path):
    ver = tmp_path / "w.ver"
    ver.write_text("# comment\n\n1 1 10 20 30 40 7 drone\n", encoding="utf-8")
    ann = load_ver_file(ver)
    assert len(ann) == 1


# ------------------------------------------------------------------ #
# _filename_to_frame_idx                                               #
# ------------------------------------------------------------------ #


@pytest.mark.parametrize(
    "stem,expected",
    [("frame_000042", 42), ("000042", 42), ("img42_mask", 42), ("noindex", 0)],
)
def test_filename_to_frame_idx(stem, expected):
    assert _filename_to_frame_idx(stem) == expected


# ------------------------------------------------------------------ #
# YoloTxtDataset                                                        #
# ------------------------------------------------------------------ #


def test_yolo_txt_dataset_len_and_pull_item(tmp_path):
    data_yaml = _write_yolo_dataset(tmp_path, n_images=3)
    ds = YoloTxtDataset(str(data_yaml), split="train", img_size=(160, 160))
    assert len(ds) == 3
    img, target, img_info, img_id = ds.pull_item(0)
    assert img.shape == (100, 200, 3)
    assert target.shape == (1, 5)
    assert img_info == (100, 200)
    assert img_id[0] == 0


def test_yolo_txt_dataset_load_anno_matches_pull_item_target(tmp_path):
    # Contrat requis par MosaicDetection.mixup() : load_anno(index) doit
    # renvoyer les memes labels que pull_item(index)[1].
    data_yaml = _write_yolo_dataset(tmp_path, n_images=3)
    ds = YoloTxtDataset(str(data_yaml), split="train", img_size=(160, 160))
    anno = ds.load_anno(0)
    _, target, _, _ = ds.pull_item(0)
    assert anno.shape == target.shape
    assert np.array_equal(anno, target)


def test_yolo_txt_dataset_getitem_without_preproc(tmp_path):
    data_yaml = _write_yolo_dataset(tmp_path, n_images=2)
    ds = YoloTxtDataset(str(data_yaml), split="train", img_size=(160, 160))
    img, target, img_info, img_id = ds[0]
    assert img.shape == (100, 200, 3)


def test_yolo_txt_dataset_getitem_with_train_transform(tmp_path):
    from yolox.data.data_augment import TrainTransform

    data_yaml = _write_yolo_dataset(tmp_path, n_images=2)
    ds = YoloTxtDataset(
        str(data_yaml),
        split="train",
        img_size=(160, 160),
        preproc=TrainTransform(max_labels=50, flip_prob=0.0, hsv_prob=0.0),
    )
    img, padded_labels, img_info, img_id = ds[0]
    # image transposee (C,H,W) et paddee au carre img_size
    assert img.shape == (3, 160, 160)
    assert padded_labels.shape == (50, 5)
    # au moins une ligne non nulle (notre boite unique a survecu au filtrage)
    assert (padded_labels[:, 3] > 0).sum() >= 1


def test_yolo_txt_dataset_mosaic_getitem_accepts_tuple_index(tmp_path):
    data_yaml = _write_yolo_dataset(tmp_path, n_images=2)
    ds = YoloTxtDataset(str(data_yaml), split="train", img_size=(160, 160))
    # protocole mosaic_getitem : index = (enable_mosaic, idx, input_dim)
    img, target, img_info, img_id = ds[(False, 0, (160, 160))]
    assert ds.enable_mosaic is False
    assert img_id[0] == 0


def test_ver_dataset_labels_match_images(tmp_path):
    data_yaml = _write_ver_dataset(tmp_path, n_images=3)
    ds = YoloTxtDataset(str(data_yaml), split="train", img_size=(160, 160))
    assert len(ds) == 3
    for i in range(3):
        _, target, _, _ = ds.pull_item(i)
        assert target.shape == (1, 5)
        np.testing.assert_allclose(target[0], [50, 25, 150, 75, VER_CLASS_MAP["drone"]])


def test_ver_dataset_frame_without_annotation_returns_empty(tmp_path):
    data_yaml = _write_ver_dataset(tmp_path, n_images=3)
    # supprime les annotations pour la frame 2 (index 1) en reecrivant le .ver
    ver_path = tmp_path / "annotations.ver"
    lines = ver_path.read_text(encoding="utf-8").splitlines()
    ver_path.write_text(lines[0] + "\n" + lines[2] + "\n", encoding="utf-8")

    ds = YoloTxtDataset(str(data_yaml), split="train", img_size=(160, 160))
    _, target, _, _ = ds.pull_item(1)
    assert target.shape == (0, 5)
