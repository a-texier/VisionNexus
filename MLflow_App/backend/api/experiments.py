# ============================================================
# api/experiments.py
# GET /api/experiments      — lister
# POST /api/experiments     — créer
# DELETE /api/experiments/{id} — supprimer
# GET /api/mlflow-status    — état du serveur MLflow
# ============================================================

import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.core.mlflow_client import get_client, is_mlflow_running

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["experiments"])


# ------------------------------------------------------------------ #
# Helpers                                                             #
# ------------------------------------------------------------------ #

def _exp_to_dict(exp) -> dict:
    return {
        "experiment_id": exp.experiment_id,
        "name":          exp.name,
        "artifact_location": exp.artifact_location,
        "lifecycle_stage":   exp.lifecycle_stage,
        "creation_time":     exp.creation_time,
        "last_update_time":  exp.last_update_time,
        "tags": {k: v for k, v in (exp.tags or {}).items()},
    }


def _require_mlflow():
    if not is_mlflow_running():
        raise HTTPException(503, "Serveur MLflow non disponible. Verifier que MLflow tourne sur le port 5000.")


# ------------------------------------------------------------------ #
# Endpoints                                                           #
# ------------------------------------------------------------------ #

@router.get("/mlflow-status")
def mlflow_status():
    running = is_mlflow_running()
    if running:
        try:
            from mlflow.tracking import MlflowClient
            from backend.config import MLFLOW_TRACKING_URI
            import mlflow
            mlflow.set_tracking_uri(MLFLOW_TRACKING_URI)
            version = mlflow.__version__
        except Exception:
            version = None
        return {"running": True, "version": version}
    return {"running": False, "version": None}


@router.get("/experiments")
def list_experiments():
    _require_mlflow()
    try:
        from mlflow.entities import ViewType
        client = get_client()
        experiments = client.search_experiments(view_type=ViewType.ALL)
        return [_exp_to_dict(e) for e in experiments]
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("list_experiments error")
        raise HTTPException(500, str(exc))


class ExperimentCreate(BaseModel):
    name: str
    artifact_location: str | None = None
    tags: dict[str, str] = {}


@router.post("/experiments", status_code=201)
def create_experiment(body: ExperimentCreate):
    _require_mlflow()
    try:
        client = get_client()
        exp_id = client.create_experiment(
            name=body.name,
            artifact_location=body.artifact_location,
            tags=body.tags or {},
        )
        exp = client.get_experiment(exp_id)
        return _exp_to_dict(exp)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("create_experiment error")
        raise HTTPException(500, str(exc))


@router.delete("/experiments/{experiment_id}")
def delete_experiment(experiment_id: str):
    _require_mlflow()
    try:
        client = get_client()
        client.delete_experiment(experiment_id)
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("delete_experiment error")
        raise HTTPException(500, str(exc))
