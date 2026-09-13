# ============================================================
# api/datasets.py
# GET /api/datasets  — fichiers trackés DVC avec taille + statut
# GET /api/status    — dvc status parsé
# GET /api/branch    — branche git courante
# ============================================================

import logging

from fastapi import APIRouter, HTTPException

from backend.core.dvc_runner import (
    get_current_branch, get_status, list_tracked_files, repo_exists,
)
from backend.config import DVC_REPO_PATH

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["datasets"])


def _require_repo():
    if not repo_exists():
        raise HTTPException(
            503,
            f"Repo DVC non trouvé à : {DVC_REPO_PATH}. "
            "Vérifiez DVC_REPO_PATH et que git + dvc sont initialisés."
        )


@router.get("/datasets")
def list_datasets():
    _require_repo()
    try:
        return list_tracked_files()
    except Exception as exc:
        logger.exception("list_datasets error")
        raise HTTPException(500, str(exc))


@router.get("/status")
def dvc_status():
    try:
        return get_status()
    except Exception as exc:
        logger.exception("dvc_status error")
        raise HTTPException(500, str(exc))


@router.get("/branch")
def current_branch():
    return {"branch": get_current_branch(), "repo_path": str(DVC_REPO_PATH)}
