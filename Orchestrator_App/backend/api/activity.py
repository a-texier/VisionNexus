# ============================================================
# api/activity.py
# ============================================================

from fastapi import APIRouter, Query
from backend.core.activity_store import get_activity

router = APIRouter(prefix="/api", tags=["activity"])


@router.get("/activity")
def activity(limit: int = Query(50, ge=1, le=200)):
    return get_activity(limit)
