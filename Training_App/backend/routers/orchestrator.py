# ============================================================
# routers/orchestrator.py
# Endpoints consommes par l'Orchestrator App.
# POST /api/orchestrator/train
# GET  /api/orchestrator/run-status
# ============================================================

import os
import time
from pathlib import Path
from typing import Any, Dict, Optional
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator
from sqlmodel import Session, select

from backend.database import get_session
from backend.models.training_run import TrainingRun
from backend.services import training_service as ts

router = APIRouter(prefix="/api/orchestrator", tags=["Orchestrator"])


class OrchestratorTrainRequest(BaseModel):
    # Dataset
    data_yaml:    str = ""        # chemin data.yaml (prioritaire)
    dataset_path: str = ""        # chemin dossier YOLO (data.yaml detecte automatiquement)
    dataset_name: str = ""

    # Modele
    yolo_version:  str = "yolov8"
    model_size:    str = "n"
    model_weights: str = ""

    # Hyperparametres (surcharge des defauts)
    hyperparams: Dict[str, Any] = {}

    # Best params issus d'un noeud Optuna AUTO amont (resolus au run-time par
    # l'orchestrateur -> dict). Fusionnes APRES hyperparams (priorite a l'etude HPO).
    # Tolerant : l'orchestrateur envoie un placeholder ${STEP:...best_params} qui,
    # si l'etude HPO n'a rien produit, se resout en "" (chaine vide) -> on le
    # normalise en {} au lieu de renvoyer 422 (bug chaine Annot->Optuna->Training).
    optuna_best: Any = {}

    # Tracabilite : {graph_id, node_id, node_label} -> nom de run MLflow deterministe
    trace: Optional[Dict[str, Any]] = None

    @field_validator("optuna_best", mode="before")
    @classmethod
    def _coerce_optuna_best(cls, v):
        return v if isinstance(v, dict) else {}


@router.post("/train")
def orchestrator_train(
    body: OrchestratorTrainRequest,
    session: Session = Depends(get_session),
):
    """
    Lance un entrainement depuis l'Orchestrator.
    Detecte automatiquement data.yaml si seul dataset_path est fourni.
    Retourne immediatement avec le run_name — le polling se fait via /run-status.
    """
    # Resoudre le chemin data.yaml
    data_yaml = body.data_yaml
    if not data_yaml and body.dataset_path:
        from backend.config import RUNS_DIR
        import zipfile as _zipfile

        dp = Path(body.dataset_path)

        # 1. Chemin exact est un dossier
        if dp.is_dir():
            candidate = dp / "data.yaml"
            if candidate.exists():
                data_yaml = str(candidate)
            else:
                found = list(dp.rglob("data.yaml"))
                if found:
                    data_yaml = str(found[0])

        # 2. Chemin exact est un .zip, ou {path}.zip existe
        if not data_yaml:
            zip_path = dp if dp.suffix == ".zip" else Path(str(dp) + ".zip")
            if zip_path.exists():
                try:
                    with _zipfile.ZipFile(zip_path, "r") as zf:
                        members = zf.namelist()
                        if not any(Path(member).name == "data.yaml" for member in members):
                            raise HTTPException(
                                400,
                                f"Archive non-YOLO refusée : {zip_path} ne contient aucun data.yaml",
                            )
                except _zipfile.BadZipFile as exc:
                    raise HTTPException(400, f"Archive ZIP invalide : {zip_path}") from exc
                extract_dir = RUNS_DIR / zip_path.stem
                if not extract_dir.exists():
                    extract_dir.mkdir(parents=True, exist_ok=True)
                    with _zipfile.ZipFile(zip_path, "r") as zf:
                        zf.extractall(extract_dir)
                found = list(extract_dir.rglob("data.yaml"))
                if found:
                    data_yaml = str(found[0])

        # 3. Fallback: rglob sur le chemin original (si c'est un dossier partiel)
        if not data_yaml and dp.exists():
            found = list(dp.rglob("data.yaml"))
            if found:
                data_yaml = str(found[0])

    if not data_yaml or not Path(data_yaml).exists():
        raise HTTPException(400, f"data.yaml introuvable (data_yaml={body.data_yaml!r}, dataset_path={body.dataset_path!r})")

    # Robustesse : Ultralytics résout un `path:` RELATIF par rapport au CWD du
    # process (Training_App/), pas au dossier du yaml → "images not found".
    # On absolutise `path` vers le dossier du data.yaml si nécessaire.
    # (Bug découvert lors du test complet Fable 2026-07.)
    try:
        import yaml as _yaml
        _p = Path(data_yaml)
        _d = _yaml.safe_load(_p.read_text(encoding="utf-8")) or {}
        _path_val = str(_d.get("path", "") or "")
        if not _path_val or not Path(_path_val).is_absolute():
            _d["path"] = str(_p.parent.resolve())
            _p.write_text(_yaml.safe_dump(_d, sort_keys=False), encoding="utf-8")
    except Exception:
        pass  # best effort — l'entraînement échouera avec un message clair sinon

    merged = dict(ts.DEFAULT_HYPERPARAMS)
    merged.update(body.hyperparams)
    # Best params Optuna (mode auto) — priorite sur les hyperparams manuels.
    if body.optuna_best:
        merged.update({k: v for k, v in body.optuna_best.items() if v is not None})

    run_name = f"orch_{uuid.uuid4().hex[:8]}"
    weights  = body.model_weights or ts.get_model_weights(body.yolo_version, body.model_size)
    dataset_name = body.dataset_name or Path(data_yaml).parent.name

    run = TrainingRun(
        run_name=run_name,
        yolo_version=body.yolo_version,
        model_size=body.model_size,
        model_weights=weights,
        data_yaml=data_yaml,
        dataset_name=dataset_name,
        total_epochs=int(merged.get("epochs", 100)),
    )
    run.hyperparams = merged
    session.add(run)
    session.commit()
    session.refresh(run)

    # Demarrage dans thread daemon (trace = tracabilite MLflow graph/node)
    ts.start_training(run_name, trace=body.trace)

    # IMPORTANT : appel SYNCHRONE cote orchestrateur — on attend la FIN du run
    # (done/error) avant de repondre. Sinon le noeud Training se marque "done"
    # des le demarrage et les etapes AVAL automatiques (ex. commit DVC) tournent
    # sur un modele pas encore entraine (bug B12, test Fable 2026-07). Le
    # pipeline_runner appelle cet endpoint avec un timeout large (proxy_client 3600s).
    _blocking = os.environ.get("TRAINING_ORCH_BLOCKING", "1") != "0"
    if _blocking:
        deadline = time.monotonic() + float(os.environ.get("TRAINING_ORCH_MAX_WAIT_S", "5400"))
        while time.monotonic() < deadline:
            with Session(session.bind) as db:
                r = db.exec(select(TrainingRun).where(TrainingRun.run_name == run_name)).first()
                if r and r.status in ("done", "error", "stopped"):
                    if r.status == "error":
                        raise HTTPException(500, f"Entrainement echoue : {r.error_message}")
                    return {
                        "status":          "ok",
                        "run_name":        run_name,
                        "run_id":          run.id,
                        "run_status":      r.status,
                        "best_map50":      r.best_map50,
                        "best_map5095":    r.best_map5095,
                        "best_model_path": r.best_model_path,
                        # data_yaml RÉSOLU (dézippé) — l'éval Détection aval le réutilise
                        # au runtime via ${STEP:<id>__train.data_yaml} (l'export annotation
                        # est un .zip, Training l'a déjà décompressé au bon endroit).
                        "data_yaml":       data_yaml,
                        "message":         f"Entrainement termine : {run_name}",
                    }
            time.sleep(2.0)
        return {"status": "ok", "run_name": run_name, "run_id": run.id,
                "run_status": "running", "message": "Entrainement encore en cours (timeout attente)"}

    # Mode non-bloquant (compat) : attente courte que le run passe en "running"
    deadline = time.monotonic() + 10.0
    while time.monotonic() < deadline:
        with Session(session.bind) as db:
            r = db.exec(select(TrainingRun).where(TrainingRun.run_name == run_name)).first()
            if r and r.status in ("running", "done", "error"):
                break
        time.sleep(0.5)
    return {"status": "ok", "run_name": run_name, "run_id": run.id,
            "message": f"Entrainement demarre : {run_name}"}


@router.get("/run-status")
def orchestrator_run_status(
    run_name: str,
    session: Session = Depends(get_session),
):
    """Retourne l'etat actuel d'un run (utilise par l'Orchestrator pour poller)."""
    run = session.exec(
        select(TrainingRun).where(TrainingRun.run_name == run_name)
    ).first()
    if not run:
        raise HTTPException(404, f"Run {run_name!r} introuvable")
    return {
        "run_name":        run.run_name,
        "status":          run.status,
        "progress_pct":    run.progress_pct,
        "current_epoch":   run.current_epoch,
        "total_epochs":    run.total_epochs,
        "best_map50":      run.best_map50,
        "best_map5095":    run.best_map5095,
        "best_model_path": run.best_model_path,
        "error_message":   run.error_message,
    }
