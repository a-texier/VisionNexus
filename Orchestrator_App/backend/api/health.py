# ============================================================
# api/health.py
# ============================================================

from fastapi import APIRouter
from backend.core.proxy_client import ping_all

router = APIRouter(prefix="/api", tags=["health"])


@router.get("/health")
async def health():
    return await ping_all()
