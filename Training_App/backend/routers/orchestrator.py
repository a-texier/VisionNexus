# ============================================================
# routers/orchestrator.py
# Endpoints consommes par l'Orchestrator App.
# POST /api/orchestrator/train
# GET  /api/orchestrator/run-status
# ============================================================

import os
import time
import uuid
from pathlib import Path
from typing import Any

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

    # Modele : moteur (GET /api/capabilities) + taille de SON catalogue.
    engine:        str = ""         # vide = moteur "active" de GET /api/capabilities
    model_size:    str = ""         # vide = taille par defaut du moteur
    model_weights: str = ""

    # Hyperparametres (surcharge des defauts du moteur ; les cles d'un autre
    # moteur sont ignorees et renvoyees dans ignored_hyperparams).
    hyperparams: dict[str, Any] = {}
    # Valeurs generiques d'un noeud, traduites vers les cles du moteur
    # (CATALOG["keys"]) : l'orchestrateur n'a pas a connaitre max_epoch/epochs.
    epochs: int | None = None
    batch:  int | None = None
    imgsz:  int | None = None

    # Best params issus d'un noeud Optuna AUTO amont (resolus au run-time par
    # l'orchestrateur -> dict). Fusionnes APRES hyperparams (priorite a l'etude HPO).
    # Tolerant : l'orchestrateur envoie un placeholder ${STEP:...best_params} qui,
    # si l'etude HPO n'a rien produit, se resout en "" (chaine vide) -> on le
    # normalise en {} au lieu de renvoyer 422 (bug chaine Annot->Optuna->Training).
    optuna_best: Any = {}

    # Tracabilite : {graph_id, node_id, node_label} -> nom de run MLflow deterministe
    trace: dict[str, Any] | None = None

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
    Bloque jusqu'a la fin du run (TRAINING_ORCH_BLOCKING=0 : reponse des le demarrage).
    """
    # Resoudre le chemin data.yaml
    data_yaml = body.data_yaml
    if not data_yaml and body.dataset_path:
        import zipfile as _zipfile

        from backend.config import RUNS_DIR

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

    # Note : l'ancien contournement Ultralytics (path: relatif resolu contre le
    # CWD du process au lieu du dossier du yaml) n'est plus necessaire --
    # yolox_dataset.load_data_yaml resout toujours `path:` relatif contre le
    # dossier du data.yaml lui-meme, quel que soit le CWD.

    # Best params Optuna (mode auto) : priorite sur les hyperparams manuels.
    try:
        cfg = ts.build_run_config(
            body.engine, body.model_size, body.model_weights, body.hyperparams,
            epochs=body.epochs, batch=body.batch, imgsz=body.imgsz, extra=body.optuna_best,
        )
    except ts.RunConfigError as exc:
        raise HTTPException(400, str(exc)) from exc

    run_name = f"orch_{uuid.uuid4().hex[:8]}"
    dataset_name = body.dataset_name or Path(data_yaml).parent.name

    run = TrainingRun(
        run_name=run_name,
        yolo_version=cfg["engine"],
        engine=cfg["engine"],
        model_size=cfg["model_size"],
        model_weights=body.model_weights,
        data_yaml=data_yaml,
        dataset_name=dataset_name,
        total_epochs=cfg["total_epochs"],
    )
    run.hyperparams = cfg["hyperparams"]
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
                        # Moteur des poids : un consommateur aval (Inference,
                        # Training de fine-tuning) doit le verifier avant de
                        # charger best_model_path.
                        "engine":          cfg["engine"],
                        "model_size":      cfg["model_size"],
                        "ignored_hyperparams": cfg["ignored"],
                        # data_yaml RÉSOLU (dézippé) — l'éval Détection aval le réutilise
                        # au runtime via ${STEP:<id>__train.data_yaml} (l'export annotation
                        # est un .zip, Training l'a déjà décompressé au bon endroit).
                        "data_yaml":       data_yaml,
                        "message":         f"Entrainement termine : {run_name}",
                    }
            time.sleep(2.0)
        return {"status": "ok", "run_name": run_name, "run_id": run.id, "engine": cfg["engine"],
                "run_status": "running", "message": "Entrainement encore en cours (timeout attente)"}

    # Mode non-bloquant (compat) : attente courte que le run passe en "running"
    deadline = time.monotonic() + 10.0
    while time.monotonic() < deadline:
        with Session(session.bind) as db:
            r = db.exec(select(TrainingRun).where(TrainingRun.run_name == run_name)).first()
            if r and r.status in ("running", "done", "error"):
                break
        time.sleep(0.5)
    return {"status": "ok", "run_name": run_name, "run_id": run.id, "engine": cfg["engine"],
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
        "engine":          run.engine or "yolox",
        "model_size":      run.model_size,
        "progress_pct":    run.progress_pct,
        "current_epoch":   run.current_epoch,
        "total_epochs":    run.total_epochs,
        "best_map50":      run.best_map50,
        "best_map5095":    run.best_map5095,
        "best_model_path": run.best_model_path,
        "error_message":   run.error_message,
    }
