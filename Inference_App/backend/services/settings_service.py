# ============================================================
# settings_service.py -- reglages utilisateur persistes dans le
# workspace (la "db" du user). Un seul fichier JSON :
#   <workspace>/user_settings.json
#
# Sert de source de defauts pour :
#   - le calcul des metriques (IoU, GT par defaut, ON/OFF)
#   - l'export modele (imgsz ONNX/TensorRT) + cible de deploiement
#   - les chemins (affiches en clair dans l'IHM : rien de cache)
#
# Deep-merge : un PUT partiel ne remplace que les cles fournies.
# ============================================================

import json
import os
import threading
from copy import deepcopy
from typing import Any

from backend import config as C

_SETTINGS_FILE = C.WORKSPACE / "user_settings.json"
_lock = threading.Lock()

# Defauts alignes sur config/config.yaml du tracker (voir la page Documentation).
DEFAULTS: dict[str, Any] = {
    "metrics": {
        "compute_metrics": True,        # calcule MOTA/IDF1 si un GT est fourni
        "iou_threshold": 0.1,           # cibles IR minuscules -> 0.1/0.2 (COCO = 0.5)
        "default_annotation_file": "",  # GT .ver / YOLO applique par defaut si vide
    },
    "export": {
        "onnx_imgsz": 640,              # taille d'entree export ONNX/TensorRT
        "default_deploy_target": "standalone",  # standalone | container
        "trt_builder": "python",        # python (API TensorRT, air-gap) | trtexec
    },
    "render": {
        "light_render": False,          # rendu ultra-rapide (Jetson/bench) si True
        "trail": 20,                    # longueur de trace (frames)
        "stream_quality": 70,           # qualite JPEG du flux MJPEG
    },
    "paths": {
        "native_share_host": os.environ.get("NATIVE_SHARE_HOST", ""),
    },
    # -- Evaluation (app unifiee : le tracker fait aussi l'eval) --
    "detection": {
        "imgsz": 640,
        "conf": 0.001,                  # confiance mini pour model.val (defaut Ultralytics)
        "iou": 0.6,                     # IoU NMS
        "split": "val",                 # split evalue (val | test | train)
    },
    "tracker": {
        "compute_metrics": True,        # MOTA/IDF1 si GT fourni ; sinon inference + benchmark
        "iou_threshold": 0.1,           # IoU pred<->GT (cibles IR minuscules)
        "tracker_mot": "botsort",
        "tracker_sot": "tracking_tophat",
        "max_frames": 0,                # 0 = toute la sequence ; >0 = borne (eval rapide)
    },
    "mlflow": {
        "experiment": "inference",
    },
}


def _deep_merge(base: dict, patch: dict) -> dict:
    out = deepcopy(base)
    for k, v in patch.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _deep_merge(out[k], v)
        else:
            out[k] = v
    return out


def load() -> dict:
    """Reglages courants = DEFAULTS deep-merges avec le fichier workspace."""
    with _lock:
        stored: dict = {}
        if _SETTINGS_FILE.exists():
            try:
                stored = json.loads(_SETTINGS_FILE.read_text(encoding="utf-8")) or {}
            except Exception:
                stored = {}
        return _deep_merge(DEFAULTS, stored)


def save(patch: dict) -> dict:
    """PUT partiel : merge le patch dans le fichier existant, renvoie l'etat complet."""
    with _lock:
        stored: dict = {}
        if _SETTINGS_FILE.exists():
            try:
                stored = json.loads(_SETTINGS_FILE.read_text(encoding="utf-8")) or {}
            except Exception:
                stored = {}
        merged_stored = _deep_merge(stored, patch)
        _SETTINGS_FILE.write_text(
            json.dumps(merged_stored, ensure_ascii=False, indent=2), encoding="utf-8")
    return _deep_merge(DEFAULTS, merged_stored)


def settings_file() -> str:
    return str(_SETTINGS_FILE)
