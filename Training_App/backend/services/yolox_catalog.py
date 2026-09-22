# ============================================================
# yolox_catalog.py -- catalogue declaratif du moteur YOLOX : tailles,
# hyperparametres par defaut, formulaire, plages HPO et plots produits.
#
# Module volontairement leger (ni torch ni yolox) : il est lu par
# /api/capabilities, par Optuna_App et, via HTTP, par l'Orchestrator pour
# construire leurs formulaires. Tout moteur (y compris ceux des plugins)
# publie un catalogue de meme forme, voir trainer_backend.CATALOG_KEYS.
#
# Valeurs par defaut reprises telles quelles de yolox/exp/yolox_base.py
# (vendor/yolox).
# ============================================================

from typing import Any

# exps/default/*.py vendorises -> nom catalogue expose a l'utilisateur.
EXP_FILES: dict[str, str] = {
    "yolox-nano": "yolox_nano.py",
    "yolox-tiny": "yolox_tiny.py",
    "yolox-s": "yolox_s.py",
    "yolox-m": "yolox_m.py",
    "yolox-l": "yolox_l.py",
    "yolox-x": "yolox_x.py",
}

SUPPORTED_MODEL_SIZES: list[str] = list(EXP_FILES.keys())

DEFAULT_HYPERPARAMS: dict[str, Any] = {
    # -- Duree / planning --
    "max_epoch": 300,
    "warmup_epochs": 5,
    "no_aug_epochs": 15,  # derniers epochs sans mosaic/mixup
    "eval_interval": 10,
    "print_interval": 10,
    # -- Optimiseur --
    "basic_lr_per_img": 0.01 / 64.0,  # lr reel = basic_lr_per_img * batch_size
    "scheduler": "yoloxwarmcos",
    "warmup_lr": 0.0,
    "min_lr_ratio": 0.05,
    "weight_decay": 5e-4,
    "momentum": 0.9,
    "ema": True,
    # -- Dataloader --
    "batch_size": 16,
    "data_num_workers": 4,
    "seed": None,
    "imgsz": 640,
    # -- Augmentations geometriques --
    "degrees": 10.0,
    "translate": 0.1,
    "scale": (0.1, 2.0),
    "shear": 2.0,
    "perspective": 0.0,
    # -- Augmentations couleur / composition --
    "hsv_prob": 1.0,
    "flip_prob": 0.5,
    "mosaic_prob": 1.0,
    "mixup_prob": 1.0,
    "enable_mixup": True,
    "mosaic_scale": (0.8, 1.6),
    "mixup_scale": (0.5, 1.5),
    # -- Inference / evaluation --
    "test_conf": 0.01,
    "nmsthre": 0.65,
    # -- Materiel --
    "device": "",  # "" = auto (cuda si dispo, sinon cpu)
    "fp16": False,
}

# Formulaire des UI. Les cles a valeur tuple (scale/mosaic_scale/mixup_scale)
# et seed ne rentrent pas dans un formulaire scalaire : elles restent a leur
# defaut.
HYPERPARAM_GROUPS: list[dict] = [
    {
        "label": "Entrainement",
        "params": [
            {"key": "max_epoch", "label": "Epochs", "type": "int", "min": 1, "max": 1000, "step": 1},
            {"key": "warmup_epochs", "label": "Warmup epochs", "type": "float", "min": 0, "max": 10, "step": 0.5},
            {"key": "no_aug_epochs", "label": "Sans mosaic/mixup (fin, ép.)", "type": "int", "min": 0, "max": 50, "step": 1},
            {"key": "eval_interval", "label": "Intervalle eval (ép.)", "type": "int", "min": 1, "max": 50, "step": 1},
            {"key": "print_interval", "label": "Intervalle log (iter.)", "type": "int", "min": 1, "max": 100, "step": 1},
            {"key": "batch_size", "label": "Batch size", "type": "int", "min": 1, "max": 512, "step": 1},
            {"key": "imgsz", "label": "Taille image", "type": "int", "min": 32, "max": 2048, "step": 32},
            {"key": "data_num_workers", "label": "Workers", "type": "int", "min": 0, "max": 32, "step": 1},
            {"key": "device", "label": "Device", "type": "text", "placeholder": "auto / cpu / cuda:0"},
            {"key": "fp16", "label": "FP16 (mixed precision)", "type": "bool"},
        ],
    },
    {
        "label": "Optimiseur",
        "params": [
            {"key": "basic_lr_per_img", "label": "LR par image", "type": "float", "min": 0, "max": 0.01, "step": 0.00001},
            {"key": "scheduler", "label": "Scheduler", "type": "text", "placeholder": "yoloxwarmcos"},
            {"key": "warmup_lr", "label": "Warmup LR", "type": "float", "min": 0, "max": 1, "step": 0.0001},
            {"key": "min_lr_ratio", "label": "LR min (ratio)", "type": "float", "min": 0, "max": 1, "step": 0.01},
            {"key": "weight_decay", "label": "Weight decay", "type": "float", "min": 0, "max": 1, "step": 0.00001},
            {"key": "momentum", "label": "Momentum", "type": "float", "min": 0, "max": 1, "step": 0.001},
            {"key": "ema", "label": "EMA", "type": "bool"},
        ],
    },
    {
        "label": "Data augmentation",
        "params": [
            {"key": "degrees", "label": "Rotation (°)", "type": "float", "min": 0, "max": 180, "step": 1},
            {"key": "translate", "label": "Translation", "type": "float", "min": 0, "max": 1, "step": 0.05},
            {"key": "shear", "label": "Shear (°)", "type": "float", "min": 0, "max": 45, "step": 0.5},
            {"key": "perspective", "label": "Perspective", "type": "float", "min": 0, "max": 0.001, "step": 0.0001},
            {"key": "hsv_prob", "label": "Proba HSV jitter", "type": "float", "min": 0, "max": 1, "step": 0.05},
            {"key": "flip_prob", "label": "Proba flip", "type": "float", "min": 0, "max": 1, "step": 0.05},
            {"key": "mosaic_prob", "label": "Proba mosaic", "type": "float", "min": 0, "max": 1, "step": 0.05},
            {"key": "mixup_prob", "label": "Proba mixup", "type": "float", "min": 0, "max": 1, "step": 0.05},
            {"key": "enable_mixup", "label": "Mixup active", "type": "bool"},
        ],
    },
]

# Plages Optuna par defaut (nom d'hyperparametre -> definition trial.suggest_*).
HPO_RANGES: dict[str, dict] = {
    "basic_lr_per_img": {"type": "float", "low": 1e-5, "high": 1e-2, "log": True, "label": "LR par image"},
    "min_lr_ratio": {"type": "float", "low": 0.01, "high": 0.5, "label": "LR min (ratio)"},
    "momentum": {"type": "float", "low": 0.80, "high": 0.99, "label": "Momentum"},
    "weight_decay": {"type": "float", "low": 1e-5, "high": 1e-2, "log": True, "label": "Weight decay"},
    "mosaic_prob": {"type": "float", "low": 0.0, "high": 1.0, "label": "Proba mosaic"},
    "mixup_prob": {"type": "float", "low": 0.0, "high": 1.0, "label": "Proba mixup"},
    "hsv_prob": {"type": "float", "low": 0.0, "high": 1.0, "label": "Proba HSV"},
    "flip_prob": {"type": "float", "low": 0.0, "high": 0.5, "label": "Proba flip"},
    "degrees": {"type": "float", "low": 0.0, "high": 20.0, "label": "Rotation (°)"},
    "translate": {"type": "float", "low": 0.0, "high": 0.3, "label": "Translation"},
    "shear": {"type": "float", "low": 0.0, "high": 5.0, "label": "Shear (°)"},
}

# Plots d'analyse ecrits par yolox_trainer.py / detection_metrics.py /
# yolox_plots.py, chemins relatifs au dossier du run. Une categorie liste ses
# fichiers par ordre de preference : Insights prend le premier present.
ARTIFACTS: dict[str, list[str]] = {
    "confusion": ["artifacts/confusion_matrix.png"],
    "curves": [
        "artifacts/PR_curve.png",
        "artifacts/P_curve.png",
        "artifacts/R_curve.png",
        "artifacts/F1_curve.png",
    ],
    "labels": ["artifacts/labels.jpg"],
    "val_labels": ["artifacts/val_batch0_labels.jpg"],
    "val_predictions": ["artifacts/val_batch0_pred.jpg"],
}

CATALOG: dict[str, Any] = {
    "label": "YOLOX",
    "weights_suffixes": [".pth"],
    "sizes": SUPPORTED_MODEL_SIZES,
    "default_size": "yolox-s",
    # Prefixe retire des tailles pour des boutons courts ("yolox-s" -> "s").
    "size_prefix": "yolox-",
    "defaults": DEFAULT_HYPERPARAMS,
    "groups": HYPERPARAM_GROUPS,
    # Cles communes que l'Orchestrator et Optuna renseignent sans connaitre
    # le moteur (epochs/batch/imgsz/workers d'un noeud).
    "keys": {"epochs": "max_epoch", "batch": "batch_size", "imgsz": "imgsz", "workers": "data_num_workers"},
    "hpo_ranges": HPO_RANGES,
    "hpo_default_optimize": ["basic_lr_per_img", "mosaic_prob", "degrees"],
    "artifacts": ARTIFACTS,
    "train_batches_glob": "artifacts/train_batch*.jpg",
    # Sans poids de depart, YOLOX part de poids aleatoires.
    "pretrained_by_default": False,
}

