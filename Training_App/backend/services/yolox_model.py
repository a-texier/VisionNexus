# ============================================================
# yolox_model.py -- construction du modele YOLOX (Exp + poids) pour chaque
# taille du catalogue. Meme logique que celle utilisee cote Inference_App
# (pipeline/detector/detector_mot.py::YOLODetectorMOT), maintenue
# independamment ici : Training_App est proprietaire de l'architecture,
# Inference_App garde sa propre copie vendorisee pour rester deployable
# seul (voir vendor/yolox/VENDOR_NOTES.md).
# ============================================================

from __future__ import annotations

import sys
from pathlib import Path

import torch

_YOLOX_VENDOR = Path(__file__).resolve().parent.parent / "vendor" / "yolox"
if str(_YOLOX_VENDOR) not in sys.path:
    sys.path.insert(0, str(_YOLOX_VENDOR))

from yolox.exp.build import get_exp_by_file  # noqa: E402
from yolox.exp.yolox_base import Exp  # noqa: E402

from .yolox_catalog import EXP_FILES  # noqa: E402

MODEL_SIZES: list[str] = list(EXP_FILES.keys())


def build_exp(
    model_size: str,
    img_size: int = 640,
    num_classes: int = 80,
    yolox_root: str | None = None,
) -> Exp:
    """Charge l'Exp correspondant a la taille demandee (config d'architecture
    + hyperparametres par defaut), ajuste img_size/num_classes."""
    if model_size not in EXP_FILES:
        raise ValueError(
            f"taille de modele inconnue '{model_size}' (choix : {MODEL_SIZES})"
        )
    root = Path(yolox_root) if yolox_root else _YOLOX_VENDOR
    exp_file = root / "exps" / "default" / EXP_FILES[model_size]
    if not exp_file.exists():
        raise FileNotFoundError(f"fichier exp introuvable : {exp_file}")
    exp = get_exp_by_file(str(exp_file))
    exp.input_size = (img_size, img_size)
    exp.test_size = (img_size, img_size)
    exp.num_classes = num_classes
    return exp


def build_model(
    model_size: str,
    img_size: int = 640,
    num_classes: int = 80,
    yolox_root: str | None = None,
):
    """Retourne (exp, model) -- le modele est cree non entraine (poids aleatoires)."""
    exp = build_exp(model_size, img_size, num_classes, yolox_root)
    model = exp.get_model()
    return exp, model


def load_checkpoint(
    model: torch.nn.Module, weights_path: str, map_location: str = "cpu"
) -> dict:
    """Charge un checkpoint .pth (natif YOLOX) dans un modele deja construit.
    Retourne le checkpoint complet (utile pour recuperer optimizer/epoch en
    cas de reprise d'entrainement)."""
    ckpt = torch.load(weights_path, map_location=map_location, weights_only=True)
    state_dict = ckpt["model"] if isinstance(ckpt, dict) and "model" in ckpt else ckpt
    model.load_state_dict(state_dict)
    return ckpt if isinstance(ckpt, dict) else {"model": state_dict}
