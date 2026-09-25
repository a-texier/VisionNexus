# ============================================================
# services/training_service.py
# Lancement, suivi et arret des runs, quel que soit le moteur
# (trainer_backend.py : "yolox" integre ou moteur de plugin). Le moteur est
# lu sur le run en base : il voyage avec les poids qu'il produit.
#
# Chaque run tourne dans un thread daemon (l'entrainement est bloquant). La
# progression est communiquee via une queue et poussee dans un dict en
# memoire (_run_progress), meme mecanisme qu'avant.
# ============================================================

import threading
from datetime import datetime
from pathlib import Path

from sqlmodel import Session

from backend.config import CURRENT_USER, RUNS_DIR, WORKSPACE
from backend.database import engine
from backend.models.training_run import TrainingRun
from backend.services.mlflow_logging import start_run
from backend.services.run_artifacts import artifact_files
from backend.services.trainer_backend import (
    check_weights_for_engine,
    engine_catalog,
    epochs_of,
    merge_hyperparams,
    normalize_engine,
    resolve_engine,
)

# ── In-memory run registry ────────────────────────────────────────────────────
# {run_name: {"events": [dict], "stop_flag": threading.Event, "thread": Thread}}
_active_runs: dict[str, dict] = {}
_lock = threading.Lock()


class RunConfigError(ValueError):
    """Parametres de run refuses avant tout lancement (-> HTTP 400)."""


def build_run_config(
    engine: str | None,
    model_size: str,
    model_weights: str,
    hyperparams: dict | None,
    *,
    epochs: int | None = None,
    batch: int | None = None,
    imgsz: int | None = None,
    extra: dict | None = None,
) -> dict:
    """Valide et complete les parametres d'un run pour un moteur donne.

    Renvoie {"engine", "model_size", "hyperparams", "total_epochs",
    "ignored"}. `extra` (best params HPO...) passe apres `hyperparams`. Les
    cles inconnues du moteur sont ignorees et listees dans "ignored".
    """
    name = normalize_engine(engine)
    try:
        catalog = engine_catalog(name)
    except RuntimeError as exc:
        raise RunConfigError(str(exc)) from exc
    size = model_size or catalog["default_size"]
    if size not in catalog["sizes"]:
        raise RunConfigError(
            f"model_size invalide pour le moteur '{name}' : {size!r} (choix : {catalog['sizes']})"
        )
    weights_error = check_weights_for_engine(name, model_weights)
    if weights_error:
        raise RunConfigError(weights_error)
    overrides = {**(hyperparams or {}), **{k: v for k, v in (extra or {}).items() if v is not None}}
    merged, ignored = merge_hyperparams(catalog, overrides, epochs=epochs, batch=batch, imgsz=imgsz)
    return {
        "engine": name,
        "model_size": size,
        "hyperparams": merged,
        "total_epochs": epochs_of(catalog, merged),
        "ignored": ignored,
    }


def _db_update(run_name: str, **kwargs):
    """Mise a jour des champs d'un run dans SQLite."""
    with Session(engine) as db:
        from sqlmodel import select

        run = db.exec(select(TrainingRun).where(TrainingRun.run_name == run_name)).first()
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


def start_training(run_name: str, trace: dict | None = None) -> bool:
    """
    Lance le run d'entrainement identifie par run_name.
    Lit les parametres depuis la DB, execute le moteur du run dans un
    thread. `trace` = {graph_id, node_id, node_label} -> nom de run MLflow
    deterministe + tags.
    Retourne True si demarrage OK, False si erreur.
    """
    trace = trace or {}
    with Session(engine) as db:
        from sqlmodel import select

        run = db.exec(select(TrainingRun).where(TrainingRun.run_name == run_name)).first()
        if not run:
            return False
        data_yaml = run.data_yaml
        model_weights = run.model_weights
        hyperparams = run.hyperparams
        model_size = run.model_size
        engine_name = run.engine or "yolox"
        dataset_name = run.dataset_name or ""

    stop_flag = threading.Event()
    with _lock:
        _active_runs[run_name] = {"events": [], "stop_flag": stop_flag, "thread": None}

    def _train():
        nonlocal model_weights
        try:
            _db_update(run_name, status="running", started_at=datetime.utcnow())
            _push_event(run_name, {"type": "status", "status": "running"})

            EngineCls = resolve_engine(engine_name)
            catalog = engine_catalog(engine_name)
            total_epochs = epochs_of(catalog, hyperparams)

            if model_weights and not Path(model_weights).exists():
                # Un nom nu ("yolov8n.pt") est laisse au moteur, qui sait
                # peut-etre le telecharger ; un chemin absent est une erreur
                # de saisie, signalee sans bloquer (depart sans ces poids).
                if Path(model_weights).parent != Path("."):
                    _push_event(
                        run_name,
                        {
                            "type": "status",
                            "status": "running",
                            "message": f"poids '{model_weights}' introuvables -> poids par defaut du moteur",
                        },
                    )
                    model_weights = ""

            # ── MLflow (store workspace serverless, 100% defensif) ──────────────
            _gid = trace.get("graph_id", "")
            _gname = trace.get("graph_name") or _gid
            _label = trace.get("node_label", "")
            _experiment = trace.get("experiment") or "training"
            _run_type = trace.get("run_type") or "training"
            ml_run_name = f"{_gname}/{_label}" if _gname and _label else (_label or run_name)
            _trace_tags = {
                k: v
                for k, v in {
                    "graph_id": trace.get("graph_id"),
                    "graph_name": _gname,
                    "node_id": trace.get("node_id"),
                    "node_label": trace.get("node_label"),
                    "training_run": run_name,
                    "orch_run_id": trace.get("run_id"),
                    "run_type": _run_type,
                    "fork_parent_run": trace.get("fork_parent_run"),
                }.items()
                if v
            }
            ml = start_run(
                WORKSPACE,
                CURRENT_USER,
                experiment=_experiment,
                run_name=ml_run_name,
                params={
                    **hyperparams,
                    "model_weights": model_weights,
                    "model_size": model_size,
                    "engine": engine_name,
                    "data_yaml": data_yaml,
                },
                tags={
                    "app": "Training_App",
                    "user": CURRENT_USER,
                    "stage": "training",
                    "engine": engine_name,
                    **_trace_tags,
                },
            )

            # Derniere epoque reellement executee : un moteur peut s'arreter
            # avant total_epochs (early stopping).
            last_epoch = {"value": 0}

            def _on_epoch_end(payload: dict) -> None:
                last_epoch["value"] = payload["epoch"]
                metrics = dict(payload["loss"])
                metrics.update(payload["metrics"])
                ml.log_metrics(metrics, step=payload["epoch"])
                _push_event(
                    run_name,
                    {
                        "type": "epoch",
                        "epoch": payload["epoch"],
                        "total_epochs": payload["total_epochs"],
                        "progress_pct": payload["progress_pct"],
                        "metrics": metrics,
                    },
                )
                fields = {"current_epoch": payload["epoch"], "progress_pct": payload["progress_pct"]}
                # Une epoque sans evaluation n'a pas de mAP : garder la derniere
                # valeur connue au lieu de l'effacer dans l'historique.
                if "metrics/mAP50(B)" in metrics:
                    fields["best_map50"] = metrics["metrics/mAP50(B)"]
                if "metrics/mAP50-95(B)" in metrics:
                    fields["best_map5095"] = metrics["metrics/mAP50-95(B)"]
                _db_update(run_name, **fields)

            trainer = EngineCls(
                model_size=model_size,
                data_yaml=data_yaml,
                run_name=run_name,
                output_dir=str(RUNS_DIR),
                hyperparams=hyperparams,
                model_weights=model_weights,
                stop_flag=stop_flag,
                on_epoch_end=_on_epoch_end,
            )

            # Un arret demande pendant le run est un arret, quel que soit ce
            # que le moteur leve (ou pas) en reponse au stop_flag.
            try:
                result = trainer.train() or {}
            except Exception:
                if not stop_flag.is_set():
                    raise
                result = None
            if stop_flag.is_set():
                _db_update(run_name, status="stopped", finished_at=datetime.utcnow())
                _push_event(run_name, {"type": "stopped"})
                ml.finish("KILLED")
                return

            # ── Success ─────────────────────────────────────────────────────────
            best_pt_str = result.get("best_model_path") or ""
            run_dir = Path(result.get("run_dir") or RUNS_DIR / run_name)

            final_map50 = final_map5095 = None
            with Session(engine) as db:
                from sqlmodel import select

                r = db.exec(select(TrainingRun).where(TrainingRun.run_name == run_name)).first()
                if r:
                    final_map50, final_map5095 = r.best_map50, r.best_map5095
            # Metriques de la revalidation des poids finaux, si le moteur en fait une.
            final_metrics = result.get("metrics") or {}
            final_map50 = final_metrics.get("metrics/mAP50(B)", final_map50)
            final_map5095 = final_metrics.get("metrics/mAP50-95(B)", final_map5095)

            _db_update(
                run_name,
                status="done",
                progress_pct=100.0,
                current_epoch=last_epoch["value"] or total_epochs,
                finished_at=datetime.utcnow(),
                best_model_path=best_pt_str,
                best_map50=final_map50,
                best_map5095=final_map5095,
            )
            ml.log_metrics(
                {
                    k: v
                    for k, v in {
                        "final_mAP50": final_map50,
                        "final_mAP50-95": final_map5095,
                    }.items()
                    if v is not None
                }
            )
            # Plots du moteur (catalogue) -> visibles dans MLflow_App et l'UI MLflow.
            for plot in artifact_files(run_dir, catalog):
                ml.log_artifact(str(plot), artifact_path="plots")
            _model_name = f"{_experiment}/{model_size}" if _experiment else f"{model_size}_{run_name}"
            if best_pt_str:
                ml.register_model(
                    best_pt_str,
                    name=_model_name,
                    tags={
                        "dataset": dataset_name,
                        "mAP50": final_map50,
                        "mAP50-95": final_map5095,
                        "orch_run_id": trace.get("run_id"),
                        "graph_name": _gname,
                        "model_size": model_size,
                        "engine": engine_name,
                    },
                )
            ml.finish("FINISHED")

            _push_event(
                run_name,
                {
                    "type": "done",
                    "engine": engine_name,
                    "best_model_path": best_pt_str,
                    "map50": final_map50,
                    "map5095": final_map5095,
                },
            )

        except Exception as exc:  # noqa: BLE001
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
    return True


def get_events(run_name: str, cursor: int = 0) -> list[dict]:
    with _lock:
        info = _active_runs.get(run_name)
    if not info:
        return []
    return info["events"][cursor:]


__all__ = [
    "RunConfigError",
    "build_run_config",
    "get_events",
    "start_training",
    "stop_training",
]
