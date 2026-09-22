# ============================================================
# api/engines.py
# GET /api/engines -- moteurs d'entrainement proposes par les noeuds Model,
# Training et Optuna, avec leurs catalogues (tailles, hyperparametres,
# plages HPO).
#
# Source de verite : GET /api/capabilities de Training_App, qui est l'app
# qui entrainera reellement. Si elle n'est pas lancee (edition d'un graphe
# avant tout run), repli sur le meme registre lu localement dans le monorepo.
# Le frontend n'ecrit aucun nom de moteur en dur : sans plugin, seul YOLOX
# revient et aucun selecteur n'est affiche.
# ============================================================

import logging
import sys
from pathlib import Path

import httpx
from fastapi import APIRouter

from backend.config import APP_URLS

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["Engines"])

_TRAINING_BACKEND = Path(__file__).resolve().parents[3] / "Training_App" / "backend"


async def _from_training_app() -> dict | None:
    base = APP_URLS.get("Training_App")
    if not base:
        return None
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            r = await client.get(f"{base}/api/capabilities")
        if r.status_code >= 400:
            return None
        data = r.json()
    except (httpx.HTTPError, ValueError):
        return None
    return {
        "engines": data.get("trainer_backends", []),
        "default": data.get("active") or data.get("default") or "yolox",
        "source": "training_app",
    }


def _from_local_registry() -> dict:
    if str(_TRAINING_BACKEND) not in sys.path:
        sys.path.insert(0, str(_TRAINING_BACKEND))
    from services import trainer_backend

    return {
        "engines": trainer_backend.describe_backends(with_catalog=True),
        "default": trainer_backend.DEFAULT_BACKEND,
        "source": "local",
    }


@router.get("/engines")
async def list_engines() -> dict:
    remote = await _from_training_app()
    if remote and any(e.get("catalog") for e in remote["engines"]):
        return remote
    try:
        return _from_local_registry()
    except Exception as exc:  # deploiement sans Training_App a cote
        logger.warning("catalogue des moteurs indisponible : %s", exc)
        return {"engines": [], "default": "yolox", "source": "none", "error": str(exc)}
