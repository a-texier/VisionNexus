# ============================================================
# main.py -- Inference_App (wrap IHM du tracker VisionNexus MOT/SOT)
#
# Lancement solo :
#   python launcher.py --app inference --user bob --workspace <ws>
#   (ou depuis Inference_App/ : uvicorn backend.main:app --port 8065)
# ============================================================

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.config import CORS_ORIGINS, WORKSPACE, RUNS_DIR
from backend.routers import (session, export, orchestrator, settings,
                             eval as eval_router, acquisition)


@asynccontextmanager
async def lifespan(app: FastAPI):
    print("=" * 60)
    print("[startup] Inference_App (tracker MOT/SOT) -- demarrage")
    print(f"[startup] workspace = {WORKSPACE}")
    print("=" * 60)
    yield
    print("[shutdown] Inference_App arretee")


app = FastAPI(
    title="Inference App",
    description="IHM web d'un tracker generique MOT/SOT (IR) + noeud orchestrateur MLOps.",
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

app.include_router(session.router)
app.include_router(export.router)
app.include_router(orchestrator.router)
app.include_router(settings.router)
app.include_router(eval_router.router)
app.include_router(acquisition.router)


@app.get("/api/capabilities", tags=["Capabilities"])
def capabilities():
    from backend.services.format_registry import available_formats

    return {"specific_formats": available_formats()}


@app.get("/health", tags=["Sante"])
def health():
    return {"status": "ok", "app": "Inference_App"}


@app.get("/", tags=["Sante"])
def root():
    return {"app": "Inference App", "version": "1.0.0", "docs": "/docs", "health": "/health"}


@app.get("/api/app-mode", tags=["Sante"])
def get_app_mode():
    is_orch = bool(os.environ.get("LAUNCHED_BY_ORCHESTRATOR"))
    return {"mode": "orchestrator" if is_orch else "solo",
            "runs_dir": str(RUNS_DIR), "workspace": str(WORKSPACE)}


@app.get("/api/workspace/users", tags=["Sante"])
def workspace_users():
    import json
    from pathlib import Path
    instances_file = os.environ.get("IA_INSTANCES_FILE")
    app_id = os.environ.get("IA_APP_ID", "")
    if not instances_file:
        return []
    try:
        p = Path(instances_file)
        if not p.exists():
            return []
        entries = json.loads(p.read_text(encoding="utf-8"))
        return sorted(
            [{"user": e["user"], "workspace": e.get("workspace", "")}
             for e in entries if e.get("app") == app_id],
            key=lambda x: x["workspace"],
        )
    except Exception:
        return []


@app.post("/api/workspace/open", tags=["Sante"])
def workspace_open(path: str = None):
    import subprocess
    import sys
    from pathlib import Path
    ws_path = Path(path) if path else WORKSPACE
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
