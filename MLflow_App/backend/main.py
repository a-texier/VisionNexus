# ============================================================
# main.py
# Point d'entrée FastAPI — lifespan, routers, CORS.
#
# Lancement :
#   uvicorn backend.main:app --host 0.0.0.0 --port 8001 --reload
# ============================================================

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.api import experiments as experiments_router
from backend.api import runs as runs_router
from backend.api import models as models_router
from backend.api import compare as compare_router
from backend.api import settings as settings_router
from backend.api import docs as docs_router
from backend.config import CORS_ORIGINS
from backend.core.mlflow_client import ensure_mlflow_running, stop_mlflow_server

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


# ------------------------------------------------------------------ #
# Lifespan                                                            #
# ------------------------------------------------------------------ #

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Demarrage mlflow-app...")
    ensure_mlflow_running()
    logger.info("mlflow-app pret")
    yield
    stop_mlflow_server()
    logger.info("mlflow-app arrete")


# ------------------------------------------------------------------ #
# Application                                                         #
# ------------------------------------------------------------------ #

app = FastAPI(
    title="MLflow App",
    description="Experiment Tracking & Model Registry UI",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Jeton de session par instance (cf. _lib/session_auth.py). Installe apres le
# CORS pour l'envelopper : une requete sans jeton s'arrete avant toute route.
def _install_session_auth() -> None:
    import os
    import sys
    from pathlib import Path

    root = str(Path(__file__).resolve().parents[2])
    if root not in sys.path:
        sys.path.append(root)
    try:
        from _lib.session_auth import install_session_auth
    except ImportError:
        # App extraite seule : toleree sans jeton, jamais avec (backend ouvert).
        if os.environ.get("CV_SESSION_TOKEN"):
            raise
        return
    install_session_auth(app)


_install_session_auth()


# ---- Routers (spécifiques avant génériques) ----
app.include_router(experiments_router.router)
app.include_router(runs_router.router)
app.include_router(models_router.router)
app.include_router(compare_router.router)
app.include_router(settings_router.router)
app.include_router(docs_router.router)


# ------------------------------------------------------------------ #
# Health                                                              #
# ------------------------------------------------------------------ #

@app.get("/health")
def health():
    from backend.core.mlflow_client import is_mlflow_running
    return {"status": "ok", "mlflow_running": is_mlflow_running()}


@app.get("/api/workspace/users")
def workspace_users():
    import json, os
    from pathlib import Path
    instances_file = os.environ.get("IA_INSTANCES_FILE")
    app_id         = os.environ.get("IA_APP_ID", "")
    if not instances_file:
        return []
    try:
        p = Path(instances_file)
        if not p.exists():
            return []
        entries = json.loads(p.read_text(encoding="utf-8"))
        return sorted(
            [
                {"user": e["user"], "workspace": e.get("workspace", "")}
                for e in entries
                if e.get("app") == app_id
            ],
            key=lambda x: x["workspace"],
        )
    except Exception:
        return []


@app.post("/api/workspace/open")
def workspace_open(path: str = None):
    """Ouvre un dossier dans l'explorateur OS. path optionnel = dossier specifique."""
    import os, subprocess, sys
    from pathlib import Path
    if path:
        ws_path = Path(path)
    else:
        ws = os.environ.get("MLFLOW_APP_WORKSPACE", "")
        ws_path = Path(ws) if ws else Path(".")
    ws_path.mkdir(parents=True, exist_ok=True)
    try:
        if sys.platform == "win32":
            os.startfile(str(ws_path))
        elif sys.platform == "darwin":
            subprocess.Popen(["open", str(ws_path)])
        else:
            subprocess.Popen(["xdg-open", str(ws_path)])
        return {"ok": True, "path": str(ws_path)}
    except Exception as exc:
        return {"ok": False, "error": str(exc), "path": str(ws_path)}


@app.get("/api/workspace/history")
def workspace_history():
    """Retourne l'historique des workspaces (seulement les dossiers encore existants).
    Chaque entree: {"path": str, "user": str}."""
    import json, os
    from pathlib import Path
    hist_file = os.environ.get("IA_WORKSPACE_HISTORY_FILE")
    if not hist_file:
        return []
    try:
        p = Path(hist_file)
        if not p.exists():
            return []
        data = json.loads(p.read_text(encoding="utf-8"))
        if not isinstance(data, list):
            return []
        result = []
        for entry in data:
            if isinstance(entry, str):
                path, user = entry, "?"
            elif isinstance(entry, dict):
                path = entry.get("path", "")
                user = entry.get("user", "?")
            else:
                continue
            if path and Path(path).exists():
                result.append({"path": path, "user": user})
        return result
    except Exception:
        return []
