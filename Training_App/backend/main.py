# ============================================================
# main.py — Training_App
# FastAPI backend : entrainement YOLOX natif (moteur maison, Apache-2.0).
#
# Lancement solo :
#   conda activate IA_env
#   uvicorn backend.main:app --host 0.0.0.0 --port 8064 --reload
#   (depuis Training_App/)
# ============================================================

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.config import CORS_ORIGINS, DATA_DIR
from backend.database import create_db_and_tables
from backend.routers import capabilities, orchestrator, training


@asynccontextmanager
async def lifespan(app: FastAPI):
    print("=" * 60)
    print("[startup] Training_App — demarrage")
    print("=" * 60)
    create_db_and_tables()
    print("[startup] Base de donnees prete")
    print("[startup] Application prete — http://localhost:8064")
    print("=" * 60)
    yield
    print("[shutdown] Training_App arretee")


app = FastAPI(
    title="Training App",
    description="""
    Entrainement de modeles de detection : moteur YOLOX integre, autres
    moteurs fournis par les plugins de <racine>/plugins/ (GET /api/capabilities).

    ## Fonctionnalites
    - **Moteur choisi par run** — YOLOX nano / tiny / s / m / l / x par defaut
    - **Tous les hyperparametres** — lr, batch, imgsz, augmentations...
    - **Suivi temps reel** — SSE epoch-par-epoch (loss, mAP50, mAP50-95)
    - **Historique** — tous les runs avec metriques finales
    - **Mode solo / orchestrateur** — chemin dataset manuel ou auto
    """,
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

app.include_router(training.router)
app.include_router(orchestrator.router)
app.include_router(capabilities.router)


# ── Sante ─────────────────────────────────────────────────────────────────────

@app.get("/health", tags=["Sante"])
def health():
    """Endpoint de sante — utilise par l'Orchestrateur."""
    return {"status": "ok", "app": "Training_App"}


@app.get("/", tags=["Sante"])
def root():
    return {
        "app":     "Training App",
        "version": "1.0.0",
        "docs":    "/docs",
        "health":  "/health",
    }


@app.get("/api/app-mode", tags=["Sante"])
def get_app_mode():
    """Retourne si l'app est lancee par l'Orchestrateur ou en mode solo."""
    from backend.config import RUNS_DIR
    is_orch = bool(os.environ.get("LAUNCHED_BY_ORCHESTRATOR"))
    return {
        "mode":     "orchestrator" if is_orch else "solo",
        "runs_dir": str(RUNS_DIR),
        "workspace": str(DATA_DIR),
    }


@app.get("/api/workspace/users", tags=["Sante"])
def workspace_users():
    import json
    import os
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


@app.post("/api/workspace/open", tags=["Sante"])
def workspace_open(path: str = None):
    """Ouvre un dossier dans l'explorateur OS."""
    import os
    import subprocess
    import sys
    from pathlib import Path
    if path:
        ws_path = Path(path)
    else:
        ws = os.environ.get("TRAINING_APP_WORKSPACE", "")
        if not ws:
            from backend.config import WORKSPACE
            ws = str(WORKSPACE)
        ws_path = Path(ws)
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
