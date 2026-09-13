# ============================================================
# main.py — FastAPI orchestrator-app
# Lancement : uvicorn backend.main:app --host 0.0.0.0 --port 8000
# ============================================================

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.api import health as health_router
from backend.api import pipelines as pipelines_router
from backend.api import activity as activity_router
from backend.api import settings as settings_router
from backend.api import experiments as experiments_router
from backend.api import graphs as graphs_router
from backend.api import launcher_api as launcher_router
from backend.api import insights as insights_router
from backend.api import lineage as lineage_router
from backend.api import plans as plans_router
from backend.config import CORS_ORIGINS, APP_URLS, PIPELINES_DIR, WORKSPACE, CURRENT_USER
from backend.utils.debug_logger import dbg

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)

# Bruit de fond des sondes periodiques. Sur une session d'une heure, la seule
# supervision (health des sous-apps toutes les secondes + /api/apps du lanceur)
# ecrivait plus de 13 000 lignes : le panneau de logs de VisionNexus devenait
# un ecran noir qui defile, ou plus aucune ligne utile n'etait lisible, et le
# fichier .log de la session pesait plusieurs Mo pour ~40 lignes de contenu
# reel. On coupe le journal de ces requetes-la uniquement (une erreur reste
# visible : httpx en WARNING, et un acces non filtre passe toujours).
logging.getLogger("httpx").setLevel(logging.WARNING)


class _SkipPollingAccessLogs(logging.Filter):
    """Retire du log d'acces uvicorn les GET de polling (jamais les erreurs)."""

    _QUIET = ("GET /api/apps ", "GET /api/settings ", "GET /api/graphs ",
              "GET /health ", "GET /api/health ")

    def filter(self, record: logging.LogRecord) -> bool:
        msg = record.getMessage()
        if " 200 " not in msg and " 304 " not in msg:
            return True
        return not any(q in msg for q in self._QUIET)


logging.getLogger("uvicorn.access").addFilter(_SkipPollingAccessLogs())

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    dbg.init(WORKSPACE, title=f"Orchestrator — user:{CURRENT_USER}")
    # Reconnexion aux sous-apps déjà lancées (après un reload uvicorn, APP_URLS
    # revient aux ports par défaut → re-patch depuis launcher_state.json). Bug B14.
    try:
        from backend.core import app_launcher
        patched = app_launcher.repatch_app_urls()
        if patched:
            logger.info("APP_URLS re-patchées depuis launcher_state: %s", patched)
    except Exception as exc:
        logger.warning("repatch_app_urls échoué: %s", exc)
    dbg.launch("main", "lifespan", "Orchestrator demarré",
                workspace=str(WORKSPACE), user=CURRENT_USER,
                apps=",".join(APP_URLS.keys()))
    logger.info("Démarrage orchestrator-app...")
    logger.info("Apps cibles : %s", list(APP_URLS.keys()))
    logger.info("Pipelines dir : %s (%d pipeline(s))", PIPELINES_DIR, len(list(PIPELINES_DIR.glob("*.json"))))
    logger.info("orchestrator-app prêt")
    yield
    dbg.launch("main", "lifespan", "Orchestrator arrêté")
    logger.info("orchestrator-app arrêté")


app = FastAPI(
    title="Orchestrator App",
    description="Hub central — coordonne les 7 sous-applications Computer Vision",
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

# Routes spécifiques avant génériques
app.include_router(health_router.router)
app.include_router(pipelines_router.router)
app.include_router(activity_router.router)
app.include_router(settings_router.router)
app.include_router(experiments_router.router)
app.include_router(graphs_router.router)
app.include_router(launcher_router.router)
app.include_router(insights_router.router)
app.include_router(lineage_router.router)
app.include_router(plans_router.router)


@app.get("/health")
async def root_health():
    return {"status": "ok", "app": "orchestrator-app"}


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
        ws = os.environ.get("ORCHESTRATOR_WORKSPACE", "")
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
