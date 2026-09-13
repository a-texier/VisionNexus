# ============================================================
# api/settings.py
# GET /api/settings  — lire les paramètres
# PUT /api/settings  — sauvegarder les paramètres
# ============================================================

import json
import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.config import (
    CURRENT_USER,
    MLFLOW_TRACKING_URI,
    SETTINGS_FILE,
    WORKSPACE,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["settings"])


# ------------------------------------------------------------------ #
# Schéma                                                              #
# ------------------------------------------------------------------ #

class AppSettings(BaseModel):
    workspace_path:      str
    user_name:           str = "unknown"
    mlflow_tracking_uri: str = "http://localhost:5000"
    theme:               str = "dark"
    auto_refresh_ms:     int = 10000


# ------------------------------------------------------------------ #
# Helpers                                                             #
# ------------------------------------------------------------------ #

def _defaults() -> AppSettings:
    return AppSettings(
        workspace_path=str(WORKSPACE),
        user_name=CURRENT_USER,
        mlflow_tracking_uri=MLFLOW_TRACKING_URI,
    )


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
    except Exception as exc:
        logger.warning("Lecture settings.json echouee : %s", exc)
        return base


def _save_settings(s: AppSettings) -> None:
    data = s.model_dump(exclude={"workspace_path", "user_name"})
    SETTINGS_FILE.write_text(
        json.dumps(data, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )


# ------------------------------------------------------------------ #
# Endpoints                                                           #
# ------------------------------------------------------------------ #

@router.get("/settings", response_model=AppSettings)
def get_settings():
    return load_settings()


@router.put("/settings", response_model=AppSettings)
def update_settings(body: AppSettings):
    try:
        _save_settings(body)
        return load_settings()
    except Exception as exc:
        raise HTTPException(500, f"Erreur sauvegarde settings : {exc}")
