# ============================================================
# api/runs.py
# GET /api/runs            — lister (query: experiment_id)
# GET /api/runs/{run_id}   — détail + historique métriques + artifacts
# GET /api/runs/{run_id}/artifacts?path=  — contenu d'un sous-dossier d'artifacts
# GET /api/runs/{run_id}/artifact?path=   — un fichier image (plots d'entrainement)
# ============================================================

import logging
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse
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


# ------------------------------------------------------------------ #
# Artifacts : listing d'un sous-dossier + service des images           #
# ------------------------------------------------------------------ #
# Training_App joint les plots du moteur du run sous "plots/" : les servir
# ici evite d'avoir a ouvrir le dossier du run sur le disque pour les voir.

_IMAGE_MEDIA = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg"}


def _safe_artifact_path(path: str) -> str:
    """Chemin d'artefact relatif, sans remontee de dossier."""
    cleaned = (path or "").replace("\\", "/").strip("/")
    if ".." in cleaned.split("/"):
        raise HTTPException(400, "chemin invalide")
    return cleaned


@router.get("/runs/{run_id}/artifacts")
def list_run_artifacts(run_id: str, path: str = Query("", description="sous-dossier, vide = racine")):
    _require_mlflow()
    try:
        client = get_client()
        return {"path": path, "artifacts": [_artifact_to_dict(a) for a in client.list_artifacts(run_id, _safe_artifact_path(path))]}
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("list_run_artifacts error")
        raise HTTPException(500, str(exc))


@router.get("/runs/{run_id}/artifact")
def get_run_artifact(run_id: str, path: str = Query(..., description="chemin du fichier dans les artifacts")):
    _require_mlflow()
    rel = _safe_artifact_path(path)
    media = _IMAGE_MEDIA.get(Path(rel).suffix.lower())
    if media is None:
        raise HTTPException(400, "seules les images sont servies")
    try:
        local = Path(get_client().download_artifacts(run_id, rel))
    except Exception as exc:
        raise HTTPException(404, f"artefact introuvable : {exc}") from exc
    if not local.is_file():
        raise HTTPException(404, "artefact introuvable")
    return FileResponse(local, media_type=media)
