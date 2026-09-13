# ============================================================
# api/settings.py
# ============================================================

import json

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.config import CURRENT_USER, SETTINGS_FILE, WORKSPACE

router = APIRouter(prefix="/api", tags=["settings"])


class AppSettings(BaseModel):
    workspace_path: str
    user_name: str = "unknown"
    theme: str = "dark"


def _defaults() -> AppSettings:
    return AppSettings(workspace_path=str(WORKSPACE), user_name=CURRENT_USER)


def load_settings() -> AppSettings:
    base = _defaults()
    if not SETTINGS_FILE.exists():
        return base
    try:
        data = json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
        data["workspace_path"] = str(WORKSPACE)
        data["user_name"] = CURRENT_USER
        merged = base.model_dump()
        merged.update({k: v for k, v in data.items() if k in merged})
        return AppSettings(**merged)
    except Exception:
        return base


def _save(s: AppSettings) -> None:
    data = s.model_dump(exclude={"workspace_path", "user_name"})
    SETTINGS_FILE.write_text(
        json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8"
    )


@router.get("/settings", response_model=AppSettings)
def get_settings():
    return load_settings()


@router.put("/settings", response_model=AppSettings)
def update_settings(body: AppSettings):
    try:
        _save(body)
        return load_settings()
    except Exception as exc:
        raise HTTPException(500, str(exc))
