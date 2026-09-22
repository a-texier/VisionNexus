"""
Catalogue du moteur "ultralytics", meme forme que
Training_App/backend/services/yolox_catalog.py::CATALOG.

N'importe pas ultralytics : ce fichier est lu par /api/capabilities pour
construire les formulaires, y compris sur une machine ou seule l'UI tourne.
"""

from typing import Any

FAMILIES: dict[str, list[str]] = {
    "yolov8": ["n", "s", "m", "l", "x"],
    "yolo11": ["n", "s", "m", "l", "x"],
    "yolo26": ["n", "s", "m", "l", "x"],
}
SIZES: list[str] = [family + size for family, sizes in FAMILIES.items() for size in sizes]

# Valeurs par defaut d'ultralytics/cfg/default.yaml, sauf workers (4 au lieu
# de 8, meme valeur que cote YOLOX).
DEFAULT_HYPERPARAMS: dict[str, Any] = {
    "epochs": 100,
    "patience": 50,
    "batch": 16,
    "imgsz": 640,
    "optimizer": "auto",
    "lr0": 0.01,
    "lrf": 0.01,
    "momentum": 0.937,
    "weight_decay": 0.0005,
    "warmup_epochs": 3.0,
    "warmup_momentum": 0.8,
    "warmup_bias_lr": 0.1,
    "box": 7.5,
    "cls": 0.5,
    "dfl": 1.5,
    "workers": 4,
    "device": "",
    "amp": True,
    "cache": False,
    "seed": 0,
    "save_period": -1,
    "hsv_h": 0.015,
    "hsv_s": 0.7,
    "hsv_v": 0.4,
    "degrees": 0.0,
    "translate": 0.1,
    "scale": 0.5,
    "shear": 0.0,
    "perspective": 0.0,
    "flipud": 0.0,
    "fliplr": 0.5,
    "mosaic": 1.0,
    "mixup": 0.0,
    "copy_paste": 0.0,
    "erasing": 0.4,
    "close_mosaic": 10,
}

HYPERPARAM_GROUPS: list[dict] = [
    {
        "label": "Entrainement",
        "params": [
            {"key": "epochs", "label": "Epochs", "type": "int", "min": 1, "max": 1000, "step": 1},
            {"key": "patience", "label": "Patience (early stop)", "type": "int", "min": 0, "max": 500, "step": 1},
            {"key": "batch", "label": "Batch size", "type": "int", "min": -1, "max": 512, "step": 1},
            {"key": "imgsz", "label": "Taille image", "type": "int", "min": 32, "max": 2048, "step": 32},
            {"key": "close_mosaic", "label": "Sans mosaic (fin, ép.)", "type": "int", "min": 0, "max": 50, "step": 1},
            {"key": "workers", "label": "Workers", "type": "int", "min": 0, "max": 32, "step": 1},
            {"key": "device", "label": "Device", "type": "text", "placeholder": "auto / cpu / 0"},
            {"key": "amp", "label": "AMP (mixed precision)", "type": "bool"},
            {"key": "cache", "label": "Cache images", "type": "bool"},
        ],
    },
    {
        "label": "Optimiseur",
        "params": [
            {"key": "optimizer", "label": "Optimiseur", "type": "text", "placeholder": "auto / SGD / AdamW"},
            {"key": "lr0", "label": "LR initial", "type": "float", "min": 0, "max": 1, "step": 0.0001},
            {"key": "lrf", "label": "LR final (ratio)", "type": "float", "min": 0, "max": 1, "step": 0.001},
            {"key": "momentum", "label": "Momentum", "type": "float", "min": 0, "max": 1, "step": 0.001},
            {"key": "weight_decay", "label": "Weight decay", "type": "float", "min": 0, "max": 0.1, "step": 0.00001},
            {"key": "warmup_epochs", "label": "Warmup epochs", "type": "float", "min": 0, "max": 10, "step": 0.5},
            {"key": "warmup_momentum", "label": "Warmup momentum", "type": "float", "min": 0, "max": 1, "step": 0.01},
            {"key": "warmup_bias_lr", "label": "Warmup bias LR", "type": "float", "min": 0, "max": 1, "step": 0.01},
        ],
    },
    {
        "label": "Pertes",
        "params": [
            {"key": "box", "label": "Poids box", "type": "float", "min": 0, "max": 20, "step": 0.1},
            {"key": "cls", "label": "Poids cls", "type": "float", "min": 0, "max": 5, "step": 0.1},
            {"key": "dfl", "label": "Poids dfl", "type": "float", "min": 0, "max": 5, "step": 0.1},
        ],
    },
    {
        "label": "Data augmentation",
        "params": [
            {"key": "hsv_h", "label": "HSV teinte", "type": "float", "min": 0, "max": 1, "step": 0.005},
            {"key": "hsv_s", "label": "HSV saturation", "type": "float", "min": 0, "max": 1, "step": 0.05},
            {"key": "hsv_v", "label": "HSV valeur", "type": "float", "min": 0, "max": 1, "step": 0.05},
            {"key": "degrees", "label": "Rotation (°)", "type": "float", "min": 0, "max": 180, "step": 1},
            {"key": "translate", "label": "Translation", "type": "float", "min": 0, "max": 1, "step": 0.05},
            {"key": "scale", "label": "Echelle", "type": "float", "min": 0, "max": 1, "step": 0.05},
            {"key": "shear", "label": "Shear (°)", "type": "float", "min": 0, "max": 45, "step": 0.5},
            {"key": "perspective", "label": "Perspective", "type": "float", "min": 0, "max": 0.001, "step": 0.0001},
            {"key": "flipud", "label": "Proba flip vertical", "type": "float", "min": 0, "max": 1, "step": 0.05},
            {"key": "fliplr", "label": "Proba flip horizontal", "type": "float", "min": 0, "max": 1, "step": 0.05},
            {"key": "mosaic", "label": "Proba mosaic", "type": "float", "min": 0, "max": 1, "step": 0.05},
            {"key": "mixup", "label": "Proba mixup", "type": "float", "min": 0, "max": 1, "step": 0.05},
            {"key": "copy_paste", "label": "Proba copy-paste", "type": "float", "min": 0, "max": 1, "step": 0.05},
            {"key": "erasing", "label": "Proba erasing", "type": "float", "min": 0, "max": 1, "step": 0.05},
        ],
    },
]

# Plages reprises de l'espace de recherche par defaut du tuner Ultralytics.
HPO_RANGES: dict[str, dict] = {
    "lr0": {"type": "float", "low": 1e-5, "high": 1e-1, "log": True, "label": "LR initial"},
    "lrf": {"type": "float", "low": 1e-4, "high": 0.1, "log": True, "label": "LR final (ratio)"},
    "momentum": {"type": "float", "low": 0.7, "high": 0.98, "label": "Momentum"},
    "weight_decay": {"type": "float", "low": 0.0, "high": 0.001, "label": "Weight decay"},
    "warmup_epochs": {"type": "float", "low": 0.0, "high": 5.0, "label": "Warmup epochs"},
    "box": {"type": "float", "low": 1.0, "high": 20.0, "label": "Poids box"},
    "cls": {"type": "float", "low": 0.2, "high": 4.0, "label": "Poids cls"},
    "hsv_h": {"type": "float", "low": 0.0, "high": 0.1, "label": "HSV teinte"},
    "hsv_s": {"type": "float", "low": 0.0, "high": 0.9, "label": "HSV saturation"},
    "hsv_v": {"type": "float", "low": 0.0, "high": 0.9, "label": "HSV valeur"},
    "degrees": {"type": "float", "low": 0.0, "high": 45.0, "label": "Rotation (°)"},
    "translate": {"type": "float", "low": 0.0, "high": 0.9, "label": "Translation"},
    "scale": {"type": "float", "low": 0.0, "high": 0.95, "label": "Echelle"},
    "fliplr": {"type": "float", "low": 0.0, "high": 1.0, "label": "Proba flip horizontal"},
    "mosaic": {"type": "float", "low": 0.0, "high": 1.0, "label": "Proba mosaic"},
    "mixup": {"type": "float", "low": 0.0, "high": 1.0, "label": "Proba mixup"},
}

# Plots natifs d'Ultralytics, laisses sous leur nom et a leur place (racine du
# run) : ils sont plus complets que les equivalents YOLOX (matrice
# normalisee, synthese results.png) et restent ceux que connaissent les
# utilisateurs d'Ultralytics.
ARTIFACTS: dict[str, list[str]] = {
    "summary": ["results.png"],
    "confusion": ["confusion_matrix_normalized.png", "confusion_matrix.png"],
    "curves": ["BoxPR_curve.png", "BoxP_curve.png", "BoxR_curve.png", "BoxF1_curve.png"],
    "labels": ["labels.jpg", "labels_correlogram.jpg"],
    "val_labels": ["val_batch0_labels.jpg", "val_batch1_labels.jpg"],
    "val_predictions": ["val_batch0_pred.jpg", "val_batch1_pred.jpg"],
}

CATALOG: dict[str, Any] = {
    "label": "Ultralytics",
    "weights_suffixes": [".pt"],
    "sizes": SIZES,
    "default_size": "yolo11n",
    "size_prefix": "",
    "defaults": DEFAULT_HYPERPARAMS,
    "groups": HYPERPARAM_GROUPS,
    "keys": {"epochs": "epochs", "batch": "batch", "imgsz": "imgsz", "workers": "workers"},
    "hpo_ranges": HPO_RANGES,
    "hpo_default_optimize": ["lr0", "mosaic", "degrees"],
    "artifacts": ARTIFACTS,
    "train_batches_glob": "train_batch*.jpg",
    # Sans poids de depart, le moteur part des poids pre-entraines COCO de la
    # taille choisie (telecharges au premier usage).
    "pretrained_by_default": True,
}
