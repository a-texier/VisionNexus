# ============================================================
# api/runs.py
# GET /api/runs            — lister (query: experiment_id)
# GET /api/runs/{run_id}   — détail + historique métriques + artifacts
# ============================================================

import logging

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from backend.core.mlflow_client import get_client, is_mlflow_running

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["runs"])


# ------------------------------------------------------------------ #
# Helpers                                                             #
# ------------------------------------------------------------------ #

def _run_to_summary(run) -> dict:
    return {
        "run_id":        run.info.run_id,
        "run_name":      run.info.run_name,
        "experiment_id": run.info.experiment_id,
        "status":        run.info.status,
        "start_time":    run.info.start_time,
        "end_time":      run.info.end_time,
        "artifact_uri":  run.info.artifact_uri,
        "params":        dict(run.data.params),
        "metrics":       dict(run.data.metrics),
        "tags": {k: v for k, v in (run.data.tags or {}).items()
                 if not k.startswith("mlflow.")},
        "duration_ms": (
            (run.info.end_time - run.info.start_time)
            if run.info.end_time and run.info.start_time else None
        ),
    }


def _artifact_to_dict(a) -> dict:
    return {
        "path":      a.path,
        "is_dir":    a.is_dir,
        "file_size": a.file_size,
    }


def _require_mlflow():
    if not is_mlflow_running():
        raise HTTPException(503, "Serveur MLflow non disponible")


# ------------------------------------------------------------------ #
# Endpoints                                                           #
# ------------------------------------------------------------------ #

@router.get("/runs")
def list_runs(
    experiment_id: str = Query(..., description="ID de l'expérience"),
    max_results: int = Query(200, ge=1, le=1000),
    order_by: str = Query("start_time DESC"),
):
    _require_mlflow()
    try:
        client = get_client()
        runs = client.search_runs(
            experiment_ids=[experiment_id],
            max_results=max_results,
            order_by=[order_by],
        )
        return [_run_to_summary(r) for r in runs]
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("list_runs error")
        raise HTTPException(500, str(exc))


class SetTagsBody(BaseModel):
    tags: dict[str, str] = {}


@router.post("/runs/{run_id}/tags")
def set_run_tags(run_id: str, body: SetTagsBody):
    """Pose/complete des tags sur un run existant (lineage : git_commit,
    dataset_version...). Utilise par l'Orchestrateur pour boucler le lien
    MLflow <-> Git/DVC au moment du commit DVC (l'app proprietaire du store ecrit)."""
    _require_mlflow()
    try:
        client = get_client()
        applied = {}
        for k, v in (body.tags or {}).items():
            if v is None or v == "":
                continue
            client.set_tag(run_id, str(k), str(v))
            applied[str(k)] = str(v)
        return {"ok": True, "run_id": run_id, "tags": applied}
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("set_run_tags error")
        raise HTTPException(500, str(exc))


@router.get("/runs/{run_id}")
def get_run(run_id: str):
    _require_mlflow()
    try:
        client = get_client()
        run = client.get_run(run_id)

        metric_history: dict[str, list] = {}
        for key in run.data.metrics:
            history = client.get_metric_history(run_id, key)
            metric_history[key] = [
                {"step": h.step, "value": h.value, "timestamp": h.timestamp}
                for h in sorted(history, key=lambda h: h.step)
            ]

        try:
            raw_artifacts = client.list_artifacts(run_id)
            artifacts = [_artifact_to_dict(a) for a in raw_artifacts]
        except Exception:
            artifacts = []

        summary = _run_to_summary(run)
        summary["metric_history"] = metric_history
        summary["artifacts"] = artifacts
        return summary
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("get_run error")
        raise HTTPException(500, str(exc))
