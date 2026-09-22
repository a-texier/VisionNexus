# ============================================================
# test_yolox_model.py -- construction Exp/modele pour chaque taille,
# forward pass, chargement/sauvegarde checkpoint.
# ============================================================

import sys
from pathlib import Path

import pytest
import torch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services.yolox_model import (  # noqa: E402
    MODEL_SIZES,
    build_exp,
    build_model,
    load_checkpoint,
)


def test_model_sizes_catalog_nonempty():
    assert len(MODEL_SIZES) == 6
    assert "yolox-s" in MODEL_SIZES
    assert "yolox-nano" in MODEL_SIZES


def test_build_exp_unknown_size_raises():
    with pytest.raises(ValueError):
        build_exp("yolox-does-not-exist")


@pytest.mark.parametrize("size", ["yolox-nano", "yolox-s"])
def test_build_exp_sets_input_size(size):
    exp = build_exp(size, img_size=320, num_classes=3)
    assert exp.input_size == (320, 320)
    assert exp.test_size == (320, 320)
    assert exp.num_classes == 3


def test_build_model_forward_pass_train_mode():
    exp, model = build_model("yolox-nano", img_size=160, num_classes=2)
    model.eval()
    dummy = torch.randn(1, 3, 160, 160)
    with torch.no_grad():
        out = model(dummy)
    # en mode eval, sortie decodee [1, n_anchors, 5+num_classes]
    assert out.shape[0] == 1
    assert out.shape[2] == 5 + 2


def test_save_and_load_checkpoint(tmp_path):
    exp, model = build_model("yolox-nano", img_size=160, num_classes=2)
    ckpt_path = tmp_path / "test.pth"
    torch.save({"model": model.state_dict(), "start_epoch": 3}, ckpt_path)

    _, model2 = build_model("yolox-nano", img_size=160, num_classes=2)
    ckpt = load_checkpoint(model2, str(ckpt_path))
    assert ckpt["start_epoch"] == 3
    # les poids sont bien identiques apres rechargement
    for p1, p2 in zip(model.parameters(), model2.parameters(), strict=True):
        assert torch.equal(p1, p2)


def test_build_exp_custom_yolox_root(tmp_path):
    # yolox_root invalide -> exp_file introuvable -> erreur explicite
    with pytest.raises(FileNotFoundError):
        build_exp("yolox-s", yolox_root=str(tmp_path))
