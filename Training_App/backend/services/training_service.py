# ============================================================
# services/training_service.py
# Wrapping Ultralytics YOLO — lancement, suivi, arret.
#
# Chaque run tourne dans un thread daemon (Ultralytics est
# bloquant). La progression est communiquee via une queue
# et poussee dans un dict en memoire (_run_progress).
# ============================================================

import queue
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from sqlmodel import Session

from backend.config import RUNS_DIR, WORKSPACE, CURRENT_USER
from backend.database import engine
from backend.models.training_run import TrainingRun
from backend.services.mlflow_logging import start_run

# ── YOLO model name builders ──────────────────────────────────────────────────

# Maps (version, size) → pretrained weights name
_MODEL_MAP: dict[tuple[str, str], str] = {
    # YOLOv8
    ("yolov8", "n"): "yolov8n.pt",
    ("yolov8", "s"): "yolov8s.pt",
    ("yolov8", "m"): "yolov8m.pt",
    ("yolov8", "l"): "yolov8l.pt",
    ("yolov8", "x"): "yolov8x.pt",
    # YOLOv9
    ("yolov9", "c"): "yolov9c.pt",
    ("yolov9", "e"): "yolov9e.pt",
    # YOLOv10
    ("yolov10", "n"): "yolov10n.pt",
    ("yolov10", "s"): "yolov10s.pt",
    ("yolov10", "m"): "yolov10m.pt",
    ("yolov10", "b"): "yolov10b.pt",
    ("yolov10", "l"): "yolov10l.pt",
    ("yolov10", "x"): "yolov10x.pt",
    # YOLO11
    ("yolo11",  "n"): "yolo11n.pt",
    ("yolo11",  "s"): "yolo11s.pt",
    ("yolo11",  "m"): "yolo11m.pt",
    ("yolo11",  "l"): "yolo11l.pt",
    ("yolo11",  "x"): "yolo11x.pt",
}

SUPPORTED_VERSIONS: List[str] = ["yolov8", "yolov9", "yolov10", "yolo11"]
SIZES_FOR_VERSION: Dict[str, List[str]] = {
    "yolov8":  ["n", "s", "m", "l", "x"],
    "yolov9":  ["c", "e"],
    "yolov10": ["n", "s", "m", "b", "l", "x"],
    "yolo11":  ["n", "s", "m", "l", "x"],
}

DEFAULT_HYPERPARAMS: Dict[str, Any] = {
    "epochs":          100,
    "patience":        50,
    "batch":           16,
    "imgsz":           640,
    "lr0":             0.01,
    "lrf":             0.01,
    "momentum":        0.937,
    "weight_decay":    0.0005,
    "warmup_epochs":   3.0,
    "warmup_momentum": 0.8,
    "warmup_bias_lr":  0.1,
    "box":             7.5,
    "cls":             0.5,
    "dfl":             1.5,
    "workers":         8,
    "device":          "",      # "" = auto (GPU si dispo, sinon CPU)
    "cache":           False,
    "save_period":     -1,      # -1 = seulement best + last
    # Augmentations
    "hsv_h":        0.015,
    "hsv_s":        0.7,
    "hsv_v":        0.4,
    "degrees":      0.0,
    "translate":    0.1,
    "scale":        0.5,
    "shear":        0.0,
    "perspective":  0.0,
    "flipud":       0.0,
    "fliplr":       0.5,
    "mosaic":       1.0,
    "mixup":        0.0,
    "copy_paste":   0.0,
    "erasing":      0.4,
    "close_mosaic": 10,
}

# ── In-memory run registry ────────────────────────────────────────────────────
# {run_name: {"events": [dict], "stop_flag": threading.Event, "thread": Thread}}
_active_runs: dict[str, dict] = {}
_lock = threading.Lock()


def get_model_weights(version: str, size: str) -> str:
    """Retourne le nom de fichier du modele pretrained."""
    key = (version, size)
    return _MODEL_MAP.get(key, f"{version}{size}.pt")


def _db_update(run_name: str, **kwargs):
    """Mise a jour des champs d'un run dans SQLite."""
    with Session(engine) as db:
        run = db.exec(
            __import__("sqlmodel").select(TrainingRun).where(TrainingRun.run_name == run_name)
        ).first()
        if not run:
            return
        for k, v in kwargs.items():
            setattr(run, k, v)
        db.add(run)
        db.commit()


def _push_event(run_name: str, event: dict):
    with _lock:
        if run_name in _active_runs:
            _active_runs[run_name]["events"].append(event)


def start_training(run_name: str, trace: Optional[dict] = None) -> bool:
    """
    Lance le run d'entrainement identifie par run_name.
    Lit les parametres depuis la DB, execute Ultralytics dans un thread.
    `trace` = {graph_id, node_id, node_label} -> nom de run MLflow deterministe + tags.
    Retourne True si demarrage OK, False si erreur.
    """
    trace = trace or {}
    with Session(engine) as db:
        from sqlmodel import select
        run = db.exec(select(TrainingRun).where(TrainingRun.run_name == run_name)).first()
        if not run:
            return False
        data_yaml    = run.data_yaml
        model_weights = run.model_weights or get_model_weights(run.yolo_version, run.model_size)
        hyperparams  = run.hyperparams
        total_epochs = hyperparams.get("epochs", 100)
        yolo_version = run.yolo_version
        model_size   = run.model_size
        dataset_name = run.dataset_name or ""

    stop_flag = threading.Event()
    with _lock:
        _active_runs[run_name] = {
            "events":    [],
            "stop_flag": stop_flag,
            "thread":    None,
        }

    def _train():
        try:
            # Import Ultralytics — import tardif pour ne pas bloquer le demarrage si absent
            from ultralytics import YOLO  # type: ignore

            _db_update(run_name, status="running", started_at=datetime.utcnow())
            _push_event(run_name, {"type": "status", "status": "running"})

            model = YOLO(model_weights)
            # Notre logger MLflow ci-dessous est la source canonique et pose
            # orch_run_id/graph_id. Ultralytics ajoute aussi son callback MLflow
            # automatique, créant un second run orphelin (ex. smiling-conch-288).
            # Retire uniquement ce callback d'intégration, sans modifier les
            # settings Ultralytics globaux ni les autres callbacks.
            for callbacks in model.callbacks.values():
                callbacks[:] = [
                    cb for cb in callbacks
                    if not getattr(cb, "__module__", "").endswith("utils.callbacks.mlflow")
                ]
            output_dir = RUNS_DIR

            # ── MLflow (store workspace serverless, 100 % defensif) ──────────────
            # Convention MLOps (orchestrateur) : UN experiment par PROJET (nom du
            # graphe) qui regroupe training/eval/hpo, un run_name lisible {projet}/{node},
            # et un tag `run_type` pour le code couleur. Fallback solo -> "training".
            _gid = trace.get("graph_id", "")
            _gname = trace.get("graph_name") or _gid
            _label = trace.get("node_label", "")
            _experiment = trace.get("experiment") or "training"
            _run_type = trace.get("run_type") or "training"
            ml_run_name = f"{_gname}/{_label}" if _gname and _label else (_label or run_name)
            _trace_tags = {k: v for k, v in {
                "graph_id": trace.get("graph_id"), "graph_name": _gname,
                "node_id": trace.get("node_id"), "node_label": trace.get("node_label"),
                "training_run": run_name,
                # orch_run_id = run orchestrateur exact (lien Run <-> run MLflow).
                "orch_run_id": trace.get("run_id"),
                "run_type": _run_type,
                # Filiation de fork (run orchestrateur parent) -> branches dans MLflow_App.
                "fork_parent_run": trace.get("fork_parent_run"),
            }.items() if v}
            ml = start_run(
                WORKSPACE, CURRENT_USER, experiment=_experiment, run_name=ml_run_name,
                params={**hyperparams, "model_weights": model_weights,
                        "yolo_version": yolo_version, "model_size": model_size,
                        "data_yaml": data_yaml},
                tags={"app": "Training_App", "user": CURRENT_USER, "stage": "training", **_trace_tags},
            )

            # ── Callbacks Ultralytics ────────────────────────────────────────────
            def on_train_epoch_end(trainer):
                if stop_flag.is_set():
                    trainer.epoch = trainer.epochs  # force stop
                    return

                epoch     = trainer.epoch + 1
                pct       = round(epoch / total_epochs * 100, 1)
                metrics   = {}
                try:
                    if hasattr(trainer, "loss_items") and trainer.loss_items is not None:
                        li = [float(x) for x in trainer.loss_items]
                        names = ["box_loss", "cls_loss", "dfl_loss"]
                        metrics.update({names[i]: li[i] for i in range(min(len(names), len(li)))})
                    if hasattr(trainer, "metrics") and trainer.metrics:
                        metrics.update({
                            k.strip(): float(v)
                            for k, v in trainer.metrics.items()
                            if v is not None
                        })
                except Exception:
                    pass

                ml.log_metrics(metrics, step=epoch)
                _push_event(run_name, {
                    "type":         "epoch",
                    "epoch":        epoch,
                    "total_epochs": total_epochs,
                    "progress_pct": pct,
                    "metrics":      metrics,
                })
                _db_update(
                    run_name,
                    current_epoch=epoch,
                    progress_pct=pct,
                    best_map50=metrics.get("metrics/mAP50(B)", metrics.get("mAP50")),
                    best_map5095=metrics.get("metrics/mAP50-95(B)", metrics.get("mAP50-95")),
                )

            def on_val_end(validator):
                metrics = {}
                try:
                    if hasattr(validator, "metrics") and validator.metrics:
                        metrics.update({
                            k.strip(): float(v)
                            for k, v in validator.metrics.results_dict.items()
                            if v is not None
                        })
                except Exception:
                    pass
                if metrics:
                    ml.log_metrics(metrics)
                    _push_event(run_name, {"type": "val_metrics", "metrics": metrics})

            model.add_callback("on_train_epoch_end", on_train_epoch_end)
            model.add_callback("on_val_end", on_val_end)

            # ── Build Ultralytics train args ─────────────────────────────────────
            train_kwargs = {
                "data":       data_yaml,
                "project":    str(output_dir),
                "name":       run_name,
                "exist_ok":   True,
                "verbose":    False,
            }
            # Forward all hyperparams except empties
            param_keys = [
                "epochs", "patience", "batch", "imgsz",
                "lr0", "lrf", "momentum", "weight_decay",
                "warmup_epochs", "warmup_momentum", "warmup_bias_lr",
                "box", "cls", "dfl", "workers", "cache", "save_period",
                "hsv_h", "hsv_s", "hsv_v", "degrees", "translate", "scale",
                "shear", "perspective", "flipud", "fliplr", "mosaic", "mixup",
                "copy_paste", "erasing", "close_mosaic",
            ]
            for k in param_keys:
                if k in hyperparams:
                    train_kwargs[k] = hyperparams[k]
            device = hyperparams.get("device", "")
            if device not in ("", None):
                train_kwargs["device"] = device

            results = model.train(**train_kwargs)

            # ── Success ─────────────────────────────────────────────────────────
            best_pt = str(output_dir / run_name / "weights" / "best.pt")
            if not Path(best_pt).exists():
                # Fallback: search for best.pt recursively
                found = list((output_dir / run_name).rglob("best.pt"))
                best_pt = str(found[0]) if found else ""

            final_map50 = final_map5095 = None
            try:
                if hasattr(results, "results_dict"):
                    final_map50   = float(results.results_dict.get("metrics/mAP50(B)", 0))
                    final_map5095 = float(results.results_dict.get("metrics/mAP50-95(B)", 0))
            except Exception:
                pass

            _db_update(
                run_name,
                status="done",
                progress_pct=100.0,
                current_epoch=total_epochs,
                finished_at=datetime.utcnow(),
                best_model_path=best_pt,
                best_map50=final_map50,
                best_map5095=final_map5095,
            )
            # MLflow : metriques finales + enregistrement du best.pt (Model Registry).
            # Nom SCELLE au projet -> "{projet}/{arch}" (ex. mon-projet/yolov8n) : chaque
            # entrainement devient une VERSION v1..vN du meme modele (au lieu de N modeles
            # "yolov8n" distincts). Tags de version = lien vers dataset / mAP50 / run.
            ml.log_metrics({"final_mAP50": final_map50, "final_mAP50-95": final_map5095})
            _model_name = f"{_experiment}/{yolo_version}{model_size}" if _experiment else f"{yolo_version}{model_size}_{run_name}"
            ml.register_model(best_pt, name=_model_name, tags={
                "dataset": dataset_name, "mAP50": final_map50, "mAP50-95": final_map5095,
                "orch_run_id": trace.get("run_id"), "graph_name": _gname,
                "yolo": f"{yolo_version}{model_size}",
            })
            ml.finish("FINISHED")

            _push_event(run_name, {
                "type":       "done",
                "best_model_path": best_pt,
                "map50":      final_map50,
                "map5095":    final_map5095,
            })

        except Exception as exc:
            try:
                ml.finish("FAILED")
            except Exception:
                pass
            err = str(exc)
            _db_update(run_name, status="error", error_message=err, finished_at=datetime.utcnow())
            _push_event(run_name, {"type": "error", "message": err})

    t = threading.Thread(target=_train, daemon=True, name=f"train-{run_name}")
    with _lock:
        if run_name in _active_runs:
            _active_runs[run_name]["thread"] = t
    t.start()
    return True


def stop_training(run_name: str) -> bool:
    with _lock:
        info = _active_runs.get(run_name)
    if not info:
        return False
    info["stop_flag"].set()
    _db_update(run_name, status="stopped", finished_at=datetime.utcnow())
    _push_event(run_name, {"type": "stopped"})
    return True


def get_events(run_name: str, cursor: int = 0) -> list[dict]:
    with _lock:
        info = _active_runs.get(run_name)
    if not info:
        return []
    return info["events"][cursor:]
