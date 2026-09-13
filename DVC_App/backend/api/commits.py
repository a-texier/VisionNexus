# ============================================================
# api/commits.py
# GET /api/commits       — historique git avec fichiers DVC
# GET /api/diff          — dvc diff entre 2 commits
# POST /api/checkout     — checkout vers un commit
# ============================================================

import logging

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from backend.core.dvc_runner import (
    checkout, get_diff, get_git_log, repo_exists,
)
from backend.config import DVC_REPO_PATH

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["commits"])


def _require_repo():
    if not repo_exists():
        raise HTTPException(503, f"Repo DVC non trouvé à : {DVC_REPO_PATH}")


@router.get("/commits")
def list_commits(n: int = Query(50, ge=1, le=200)):
    _require_repo()
    try:
        return get_git_log(n=n)
    except Exception as exc:
        logger.exception("list_commits error")
        raise HTTPException(500, str(exc))


@router.get("/diff")
def dvc_diff(rev_a: str = Query(...), rev_b: str = Query(...)):
    _require_repo()
    try:
        return get_diff(rev_a=rev_a, rev_b=rev_b)
    except Exception as exc:
        logger.exception("dvc_diff error")
        raise HTTPException(500, str(exc))


class CheckoutBody(BaseModel):
    rev: str


@router.post("/checkout")
def dvc_checkout(body: CheckoutBody):
    _require_repo()
    try:
        result = checkout(body.rev)
        if not result.get("ok"):
            raise HTTPException(400, result.get("error", "Checkout échoué"))
        return result
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("checkout error")
        raise HTTPException(500, str(exc))
