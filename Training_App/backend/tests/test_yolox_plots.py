# ============================================================
# test_yolox_plots.py -- chaque plot se genere sans exception sur un mini
# dataset et produit un fichier non vide.
# ============================================================

import sys
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services.detection_metrics import Detection, GroundTruth  # noqa: E402
from services.yolox_dataset import YoloTxtDataset  # noqa: E402
from services.yolox_plots import (  # noqa: E402
    save_dataset_preview_plots,
    save_labels_plot,
    save_train_batch_plot,
    save_val_batch_plots,
)


def _write_dataset(root: Path, n_images: int = 4) -> Path:
    img_dir = root / "images" / "train"
    lbl_dir = root / "labels" / "train"
    img_dir.mkdir(parents=True)
    lbl_dir.mkdir(parents=True)
    for i in range(n_images):
        img = np.full((100, 200, 3), 30, dtype=np.uint8)
        cv2.imwrite(str(img_dir / f"{i:06d}.jpg"), img)
        (lbl_dir / f"{i:06d}.txt").write_text("0 0.5 0.5 0.4 0.4\n", encoding="utf-8")
    data_yaml = root / "data.yaml"
    data_yaml.write_text(
        "path: .\ntrain: images/train\nval: images/train\nnames:\n  0: person\n",
        encoding="utf-8",
    )
    return data_yaml


def test_save_labels_plot(tmp_path):
    data_yaml = _write_dataset(tmp_path)
    ds = YoloTxtDataset(str(data_yaml), split="train", img_size=(160, 160))
    out = save_labels_plot(ds, ["person"], tmp_path / "out" / "labels.jpg")
    assert out.exists()
    assert out.stat().st_size > 0


def test_save_train_batch_plot(tmp_path):
    from yolox.data.data_augment import TrainTransform
    from yolox.data.datasets.mosaicdetection import MosaicDetection

    data_yaml = _write_dataset(tmp_path)
    base = YoloTxtDataset(
        str(data_yaml),
        split="train",
        img_size=(160, 160),
        preproc=TrainTransform(max_labels=50, flip_prob=0.0, hsv_prob=0.0),
    )
    wrapped = MosaicDetection(
        base,
        img_size=(160, 160),
        mosaic=True,
        preproc=TrainTransform(max_labels=120, flip_prob=0.0, hsv_prob=0.0),
        degrees=0.0,
        translate=0.1,
        mosaic_scale=(0.8, 1.2),
        mixup_scale=(0.8, 1.2),
        shear=0.0,
        enable_mixup=False,
        mosaic_prob=1.0,
        mixup_prob=0.0,
    )
    out = save_train_batch_plot(
        wrapped, ["person"], tmp_path / "out" / "train_batch0.jpg", n_samples=4
    )
    assert out.exists()
    assert out.stat().st_size > 0


def test_save_dataset_preview_plots_uses_underlying_dataset(tmp_path):
    from yolox.data.data_augment import TrainTransform
    from yolox.data.datasets.mosaicdetection import MosaicDetection

    data_yaml = _write_dataset(tmp_path)
    base = YoloTxtDataset(
        str(data_yaml),
        split="train",
        img_size=(160, 160),
        preproc=TrainTransform(max_labels=50, flip_prob=0.0, hsv_prob=0.0),
    )
    wrapped = MosaicDetection(
        base,
        img_size=(160, 160),
        mosaic=True,
        preproc=TrainTransform(max_labels=120, flip_prob=0.0, hsv_prob=0.0),
        degrees=0.0,
        translate=0.1,
        mosaic_scale=(0.8, 1.2),
        mixup_scale=(0.8, 1.2),
        shear=0.0,
        enable_mixup=False,
        mosaic_prob=1.0,
        mixup_prob=0.0,
    )
    out_dir = tmp_path / "artifacts"
    produced = save_dataset_preview_plots(wrapped, ["person"], out_dir)
    assert len(produced) == 2
    assert all(p.exists() and p.stat().st_size > 0 for p in produced)
    names = {p.name for p in produced}
    assert names == {"labels.jpg", "train_batch0.jpg"}


def test_save_val_batch_plots(tmp_path):
    samples = [
        (
            np.full((100, 200, 3), 30, dtype=np.uint8),
            [GroundTruth(box=(10.0, 10.0, 60.0, 60.0), cls_id=0)],
            [Detection(box=(12.0, 8.0, 58.0, 62.0), conf=0.87, cls_id=0)],
        ),
        (
            np.full((100, 200, 3), 60, dtype=np.uint8),
            [],
            [],
        ),
    ]
    out_dir = tmp_path / "artifacts"
    produced = save_val_batch_plots(samples, ["person"], out_dir, n_samples=4)
    assert len(produced) == 2
    assert all(p.exists() and p.stat().st_size > 0 for p in produced)
    names = {p.name for p in produced}
    assert names == {"val_batch0_labels.jpg", "val_batch0_pred.jpg"}


def test_save_val_batch_plots_empty_samples(tmp_path):
    assert save_val_batch_plots([], ["person"], tmp_path / "artifacts") == []
