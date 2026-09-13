# ============================================================
# api/models.py
# GET  /api/models                              — lister modèles enregistrés
# GET  /api/models/{name}/versions             — lister versions
# POST /api/models/{name}/versions/{v}/transition — changer stage
# ============================================================

import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.core.mlflow_client import get_client, is_mlflow_running

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["models"])

VALID_STAGES = {"None", "Staging", "Production", "Archived"}


# ------------------------------------------------------------------ #
# Helpers                                                             #
# ------------------------------------------------------------------ #

def _version_to_dict(v) -> dict:
    return {
        "name":                  v.name,
        "version":               v.version,
        "current_stage":         v.current_stage,
        "status":                v.status,
        "source":                v.source,
        "run_id":                v.run_id,
        "description":           v.description,
        "creation_timestamp":    v.creation_timestamp,
        "last_updated_timestamp": v.last_updated_timestamp,
        # Tags de version poses a l'enregistrement (dataset, mAP50, orch_run_id...) :
        # relient chaque version a son run / dataset / metriques.
        "tags": dict(getattr(v, "tags", None) or {}),
    }


def _model_to_dict(m) -> dict:
    return {
        "name":                  m.name,
        "description":           m.description,
        "creation_timestamp":    m.creation_timestamp,
        "last_updated_timestamp": m.last_updated_timestamp,
        "latest_versions": [_version_to_dict(v) for v in (m.latest_versions or [])],
        "tags": {t.key: t.value for t in (m.tags or [])},
    }


def _require_mlflow():
    if not is_mlflow_running():
        raise HTTPException(503, "Serveur MLflow non disponible")


# ------------------------------------------------------------------ #
# Endpoints                                                           #
# ------------------------------------------------------------------ #

@router.get("/models")
def list_models(max_results: int = 100):
    _require_mlflow()
    try:
        client = get_client()
        models = client.search_registered_models(max_results=max_results)
        return [_model_to_dict(m) for m in models]
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("list_models error")
        raise HTTPException(500, str(exc))


@router.get("/models/{model_name}/versions")
def list_model_versions(model_name: str):
    _require_mlflow()
    try:
        client = get_client()
        versions = client.search_model_versions(f"name='{model_name}'")
        return [_version_to_dict(v) for v in sorted(versions, key=lambda v: int(v.version), reverse=True)]
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("list_model_versions error")
        raise HTTPException(500, str(exc))


class TransitionBody(BaseModel):
    stage: str
    archive_existing_versions: bool = False


@router.post("/models/{model_name}/versions/{version}/transition")
def transition_stage(model_name: str, version: str, body: TransitionBody):
    _require_mlflow()
    if body.stage not in VALID_STAGES:
        raise HTTPException(400, f"Stage invalide. Valeurs acceptées : {VALID_STAGES}")
    try:
        client = get_client()
        result = client.transition_model_version_stage(
            name=model_name,
            version=version,
            stage=body.stage,
            archive_existing_versions=body.archive_existing_versions,
        )
        return _version_to_dict(result)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("transition_stage error")
        raise HTTPException(500, str(exc))
