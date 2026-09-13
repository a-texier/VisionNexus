# ============================================================
# routers/settings.py -- reglages utilisateur (workspace) +
# historique des workspaces. Les metriques/export lisent ces
# reglages comme defauts (voir settings_service).
# ============================================================

import json
import os
from pathlib import Path

from fastapi import APIRouter
from pydantic import BaseModel

from backend import config as C
from backend.services import settings_service as S

router = APIRouter(prefix="/api", tags=["Settings"])


@router.get("/settings")
def get_settings():
    """Reglages courants + chemins du workspace (affiches en clair dans l'IHM)."""
    return {
        "settings": S.load(),
        "settings_file": S.settings_file(),
        "paths": {
            "workspace":     str(C.WORKSPACE),
            "runs_dir":      str(C.RUNS_DIR),
            "exports_dir":   str(C.EXPORTS_DIR),
            "sequences_dir": str(C.SEQUENCES_DIR),
            "cmd_send_dir":  str(C.CMD_SEND_DIR),
        },
    }


class SettingsPatch(BaseModel):
    patch: dict


@router.put("/settings")
def put_settings(body: SettingsPatch):
    """PUT partiel (deep-merge)."""
    return {"settings": S.save(body.patch)}


@router.get("/workspace/history")
def workspace_history():
    """Historique des workspaces (dossiers encore existants uniquement)."""
    hist_file = os.environ.get("IA_WORKSPACE_HISTORY_FILE")
    if not hist_file:
        return []
    p = Path(hist_file)
    if not p.exists():
        return []
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        if not isinstance(data, list):
            return []
        out = []
        for entry in data:
            if isinstance(entry, str):
                path, user = entry, "?"
            elif isinstance(entry, dict):
                path, user = entry.get("path", ""), entry.get("user", "?")
            else:
                continue
            if path and Path(path).exists():
                out.append({"path": path, "user": user})
        return out
    except Exception:
        return []
