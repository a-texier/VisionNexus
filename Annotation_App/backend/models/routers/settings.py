# ============================================================
# routers/settings.py
# Paramètres utilisateur — lecture, mise à jour, reset.
# Préfixe : /api/settings
# ============================================================

import os
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict

from fastapi import APIRouter, HTTPException

from backend.services.settings_service import settings_service
from backend.config import DATA_DIR

router = APIRouter(tags=["Settings"])


@router.get("/api/settings", response_model=dict)
def get_settings():
    """
    Retourne les paramètres utilisateur courants.
    Fusionne avec les valeurs par défaut si des clés sont manquantes.
    """
    return settings_service.load()


@router.put("/api/settings", response_model=dict)
def update_settings(data: Dict[str, Any]):
    """
    Met à jour les paramètres utilisateur (fusion partielle profonde).
    Seules les sections envoyées sont mises à jour.

    Exemple : envoyer {"algorithms": {"nms_iou_threshold": 0.4}}
    ne modifie que cette clé, le reste est conservé.
    """
    return settings_service.update(data)


@router.post("/api/settings/reset", response_model=dict)
def reset_settings():
    """
    Remet tous les paramètres aux valeurs par défaut.
    Écrase le fichier user_settings.json avec les defaults.
    """
    return settings_service.reset()


@router.get("/api/workspace/info", response_model=dict)
def workspace_info():
    """Retourne le chemin du dossier de données du workspace."""
    return {"path": str(DATA_DIR), "exists": DATA_DIR.exists()}


@router.post("/api/workspace/reveal", response_model=dict)
def reveal_workspace(path: str = ""):
    """
    Ouvre le dossier workspace dans l'explorateur de fichiers du serveur.
    Fonctionne sur Windows (Explorer), macOS (Finder), Linux (xdg-open).
    path optionnel : sous-dossier à ouvrir (relatif à DATA_DIR ou absolu).
    """
    if path:
        target = Path(path) if Path(path).is_absolute() else DATA_DIR / path
    else:
        target = DATA_DIR

    target.mkdir(parents=True, exist_ok=True)

    try:
        if sys.platform == "win32":
            subprocess.Popen(["explorer", str(target)])
        elif sys.platform == "darwin":
            subprocess.Popen(["open", str(target)])
        else:
            subprocess.Popen(["xdg-open", str(target)])
        return {"success": True, "path": str(target)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Impossible d'ouvrir l'explorateur : {e}")
