from __future__ import annotations

import json
import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.config import WORKSPACE

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["settings"])
SETTINGS_FILE = WORKSPACE / "settings.json"


class AppSettings(BaseModel):
    # ---- Langue de l'interface (repli uniquement) ----
    # La source de verite est VisionNexus (reglage centralise "Langue des apps"
    # dans son panneau Settings) : quand l'app est lancee depuis le launcher,
    # ?lang= impose la langue au chargement et rien n'est ecrit ici. Ce champ
    # ne sert que hors du lanceur (navigateur, dev, ligne de commande).
    ui_language: str = "en"


def load_settings() -> AppSettings:
    if not SETTINGS_FILE.exists():
        return AppSettings()
    try:
        data = json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
        return AppSettings(**{k: v for k, v in data.items() if k in AppSettings.model_fields})
    except Exception:
        return AppSettings()


def _save_settings(settings: AppSettings) -> None:
    SETTINGS_FILE.write_text(json.dumps(settings.model_dump(), indent=2, ensure_ascii=False), encoding="utf-8")


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
