# ============================================================
# test_yolox_trainer.py -- mini run (1-2 epochs, dataset synthetique),
# evenements emis, arret propre via stop_flag, checkpoint ecrit/rechargeable.
# ============================================================

import sys
import threading
from pathlib import Path

import cv2
import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services.yolox_model import build_exp, load_checkpoint  # noqa: E402
from services.yolox_trainer import TrainingStopped, VisionNexusYoloxTrainer  # noqa: E402


def _write_dataset(root: Path, n_images: int = 8) -> Path:
    img_dir = root / "images" / "train"
    lbl_dir = root / "labels" / "train"
    img_dir.mkdir(parents=True)
    lbl_dir.mkdir(parents=True)
    for i in range(n_images):
        img = np.full((100, 200, 3), 30 + i, dtype=np.uint8)
        cv2.rectangle(img, (40, 20), (160, 80), (200, 200, 200), -1)
        cv2.imwrite(str(img_dir / f"{i:06d}.jpg"), img)
        (lbl_dir / f"{i:06d}.txt").write_text("0 0.5 0.5 0.6 0.6\n", encoding="utf-8")
    data_yaml = root / "data.yaml"
    data_yaml.write_text(
        "path: .\ntrain: images/train\nval: images/train\nnames:\n  0: person\n",
        encoding="utf-8",
    )
    return data_yaml


def _build_trainer(tmp_path, **overrides):
    data_yaml = _write_dataset(tmp_path)
    exp = build_exp("yolox-nano", img_size=64, num_classes=1)
    exp.max_epoch = overrides.pop("max_epoch", 1)
    exp.warmup_epochs = 0
    exp.no_aug_epochs = 0
    exp.eval_interval = overrides.pop("eval_interval", 1)
    exp.print_interval = 1
    exp.data_num_workers = 0
    kwargs = {
        "data_yaml": str(data_yaml),
        "run_name": "pytest_run",
        "output_dir": str(tmp_path / "runs"),
        "batch_size": 2,
        "device": "cpu",
        "max_labels": 10,
    }
    kwargs.update(overrides)
    return VisionNexusYoloxTrainer(exp, **kwargs)


@pytest.mark.slow
def test_trainer_runs_one_epoch_and_writes_checkpoint(tmp_path):
    events = []
    trainer = _build_trainer(tmp_path, on_epoch_end=events.append)
    trainer.train()

    assert len(events) == 1
    ev = events[0]
    assert ev["epoch"] == 1
    assert ev["total_epochs"] == 1
    assert "metrics/mAP50(B)" in ev["metrics"]

    ckpt_dir = Path(trainer.file_name)
    # best_ckpt.pth n'est copie que si mAP > 0 (cf. yolox/utils/checkpoint.py) :
    # sur un nano non entraine, 1 epoch, ca n'est pas garanti -- last_epoch_ckpt
    # est lui toujours ecrit par evaluate_and_save_model, c'est la garantie utile.
    assert (ckpt_dir / "latest_ckpt.pth").exists()
    assert (ckpt_dir / "last_epoch_ckpt.pth").exists()
    assert (ckpt_dir / "artifacts" / "confusion_matrix.png").exists()
    assert (ckpt_dir / "artifacts" / "labels.jpg").exists()
    assert (ckpt_dir / "artifacts" / "train_batch0.jpg").exists()
    assert (ckpt_dir / "artifacts" / "val_batch0_labels.jpg").exists()
    assert (ckpt_dir / "artifacts" / "val_batch0_pred.jpg").exists()


@pytest.mark.slow
def test_trainer_checkpoint_reloadable(tmp_path):
    trainer = _build_trainer(tmp_path)
    trainer.train()

    ckpt_path = Path(trainer.file_name) / "last_epoch_ckpt.pth"
    _, model2 = trainer.exp, trainer.exp.get_model()
    ckpt = load_checkpoint(model2, str(ckpt_path))
    assert "model" in ckpt or isinstance(ckpt, dict)


@pytest.mark.slow
def test_trainer_stop_flag_raises_training_stopped(tmp_path):
    stop_flag = threading.Event()
    stop_flag.set()  # arme AVANT le premier before_iter
    trainer = _build_trainer(tmp_path, max_epoch=5, stop_flag=stop_flag)
    with pytest.raises(TrainingStopped):
        trainer.train()
