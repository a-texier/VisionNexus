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
    CURRENT_USER, DVC_REPO_PATH, SETTINGS_FILE, WORKSPACE,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["settings"])


class AppSettings(BaseModel):
    workspace_path: str
    user_name:      str = "unknown"
    dvc_repo_path:  str = ""
    theme:          str = "dark"

    # ---- Langue de l'interface (repli uniquement) ----
    # La source de verite est VisionNexus (reglage centralise "Langue des apps"
    # dans son panneau Settings) : quand l'app est lancee depuis le launcher,
    # ?lang= impose la langue au chargement et rien n'est ecrit ici. Ce champ
    # ne sert que hors du lanceur (navigateur, dev, ligne de commande).
    ui_language: str = "en"


def _defaults() -> AppSettings:
    return AppSettings(
        workspace_path=str(WORKSPACE),
        user_name=CURRENT_USER,
        dvc_repo_path=str(DVC_REPO_PATH),
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
        json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8"
    )


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
