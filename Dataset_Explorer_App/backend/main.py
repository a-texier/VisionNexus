# ============================================================
# main.py
# Point d'entrée FastAPI — lifespan, routers, CORS, static.
#
# Lancement :
#   uvicorn backend.main:app --host 0.0.0.0 --port 8001 --reload
# ============================================================

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlmodel import Session, select

from backend.api import datasets as datasets_router
from backend.api import folders as folders_router
from backend.api import explore as explore_router
from backend.api import filter as filter_router
from backend.api import duplicates as duplicates_router
from backend.api import export as export_router
from backend.api import settings as settings_router
from backend.api import orchestrator as orchestrator_router
from backend.api import metadata as metadata_router
from backend.api import samples as samples_router
from backend.config import (
    CORS_ORIGINS,
    DATASET_GALLERY_DIR,
    FAISS_DIR,
    SUBSETS_DIR,
    THUMBS_DIR,
)
from backend.core.embedder import clip_embedder
from backend.core.indexer import faiss_indexer
from backend.db.database import create_db_and_tables, engine
from backend.db.models import Dataset

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
    # 1. Créer tables DB
    create_db_and_tables()
    logger.info("Base de données prête")

    # 1b. Migrations SQLite — DOIT s'exécuter AVANT toute requête ORM sur Dataset :
    #     l'ORM sélectionne toutes les colonnes mappées (dont les nouvelles), donc si
    #     elles manquent encore sur une base existante → "no such column".
    from sqlalchemy import text, inspect as sa_inspect
    with Session(engine) as session:
        inspector = sa_inspect(engine)
        ds_cols = {col["name"] for col in inspector.get_columns("dataset")}
        _ds_new = {
            "reduction_settings_hash": "TEXT",
            "reduction_method": "TEXT",
            "reduction_params_json": "TEXT",
            "cluster_method": "TEXT",
            "cluster_params_json": "TEXT",
            "folder_id": "INTEGER",
            # Wave 3 — filtrage embeddings / tags auto / annotations
            "mean_embedding_blob": "BLOB",
            "auto_tags_json": "TEXT",
            "annotation_path": "TEXT",
            "annotation_format": "TEXT",
            "annotation_name": "TEXT",
            "annotation_frames": "INTEGER",
            "annotation_boxes": "INTEGER",
            # Métadonnées tabulaires liées (CSV/Excel)
            "metadata_path": "TEXT",
            "metadata_key_column": "TEXT",
            "metadata_columns_json": "TEXT",
            # Message d'erreur reel du scan (permission refusee, chemin introuvable...)
            "error_message": "TEXT",
        }
        for col, typ in _ds_new.items():
            if col not in ds_cols:
                session.exec(text(f"ALTER TABLE dataset ADD COLUMN {col} {typ} DEFAULT NULL"))
                session.commit()
                logger.info("Migration : colonne %s ajoutee a dataset", col)

        # Migration table subset : verrou anti-suppression (etait cote client seulement)
        sub_cols = {col["name"] for col in inspector.get_columns("subset")}
        if "locked" not in sub_cols:
            session.exec(text("ALTER TABLE subset ADD COLUMN locked BOOLEAN DEFAULT 0"))
            session.commit()
            logger.info("Migration : colonne locked ajoutee a subset")

        # Migration table image : colonne metadata_json
        img_cols = {col["name"] for col in inspector.get_columns("image")}
        if "metadata_json" not in img_cols:
            session.exec(text("ALTER TABLE image ADD COLUMN metadata_json TEXT DEFAULT NULL"))
            session.commit()
            logger.info("Migration : colonne metadata_json ajoutee a image")

    # 1c. Récupération des datasets bloqués en "embedding" (crash ou déconnexion)
    with Session(engine) as session:
        stuck = session.exec(
            select(Dataset).where(Dataset.status == "embedding")
        ).all()
        if stuck:
            for ds in stuck:
                ds.status = "pending"
            session.commit()
            logger.info(
                "Recuperation : %d dataset(s) bloque(s) en 'embedding' remis en 'pending'",
                len(stuck),
            )

    # 2. Créer les dossiers du workspace
    THUMBS_DIR.mkdir(parents=True, exist_ok=True)
    FAISS_DIR.mkdir(parents=True, exist_ok=True)
    SUBSETS_DIR.mkdir(parents=True, exist_ok=True)
    DATASET_GALLERY_DIR.mkdir(parents=True, exist_ok=True)

    # 3. Charger CLIP
    try:
        clip_embedder.load()
    except Exception as exc:
        logger.error("Impossible de charger CLIP : %s", exc)

    # 4. Recharger les index FAISS des datasets prêts
    with Session(engine) as session:
        ready_datasets = session.exec(
            select(Dataset).where(Dataset.status == "ready")
        ).all()
        for ds in ready_datasets:
            if ds.faiss_index_path and Path(ds.faiss_index_path).exists():
                try:
                    faiss_indexer.load(ds.id, ds.faiss_index_path)
                except Exception as exc:
                    logger.warning("Index FAISS non rechargé pour dataset %d : %s", ds.id, exc)

    logger.info("Dataset Explorer prêt sur port 8001")
    yield

    logger.info("Arrêt Dataset Explorer")


# ------------------------------------------------------------------ #
# Application                                                         #
# ------------------------------------------------------------------ #

app = FastAPI(
    title="Dataset Explorer",
    description="Vision Dataset Intelligence Tool",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
app.include_router(datasets_router.router)
app.include_router(folders_router.router)
app.include_router(explore_router.router)
app.include_router(filter_router.router)
app.include_router(duplicates_router.router)
app.include_router(export_router.router)
app.include_router(settings_router.router)
app.include_router(orchestrator_router.router)
app.include_router(metadata_router.router)
app.include_router(samples_router.router)

# Fichiers statiques : thumbnails workspace
app.mount("/thumbs", StaticFiles(directory=str(THUMBS_DIR)), name="thumbs")

# Fichiers statiques : thumbnails gallery globale (indépendants du workspace)
app.mount("/gallery-thumbs", StaticFiles(directory=str(DATASET_GALLERY_DIR)), name="gallery-thumbs")


@app.get("/api/capabilities")
def capabilities():
    from backend.core.format_registry import available_formats

    return {"specific_formats": available_formats()}


# ------------------------------------------------------------------ #
# Health check                                                        #
# ------------------------------------------------------------------ #

@app.get("/health")
def health():
    from backend.core.job_runner import JOB_WORKERS, active_jobs
    return {
        "status": "ok",
        "clip_loaded": clip_embedder.is_loaded,
        "device": clip_embedder._device,
        "jobs": active_jobs(),
        "job_workers": JOB_WORKERS,
    }


# ------------------------------------------------------------------ #
# Journal d'audit — qui a supprime / partage / fusionne quoi          #
# ------------------------------------------------------------------ #

@app.get("/api/audit")
def get_audit(limit: int = 100, action: str = None):
    from backend.core import audit
    return {"entries": audit.read_recent(limit=limit, action=action)}


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
    """Ouvre un dossier dans l'explorateur de fichiers OS.
    Si path est fourni, ouvre ce dossier ; sinon ouvre le workspace courant.
    """
    import os, subprocess, sys
    from pathlib import Path
    if path:
        ws_path = Path(path)
    else:
        ws = os.environ.get("EXPLORER_WORKSPACE", "")
        if not ws:
            from backend.config import WORKSPACE
            ws = str(WORKSPACE)
        ws_path = Path(ws)
    ws_path.mkdir(parents=True, exist_ok=True)
    try:
        if sys.platform == "win32":
            os.startfile(str(ws_path))
            return {"ok": True, "path": str(ws_path)}
        # Le frontend transmet ce chemin au pont desktop Windows. Ne jamais
        # lancer xdg-open sur une VM SSH : la fenêtre serait côté serveur.
        return {"ok": False, "remote": True, "path": str(ws_path),
                "message": "Ouverture à effectuer côté client via VisionNexus"}
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


@app.get("/api/app-mode")
def get_app_mode():
    """Retourne si l'app est lancee par l'Orchestrateur ou en mode solo."""
    import os
    from backend.config import SUBSETS_DIR, ANNOTATION_APP_IMPORTS, WORKSPACE
    is_orch = bool(os.environ.get("LAUNCHED_BY_ORCHESTRATOR"))
    return {
        "mode": "orchestrator" if is_orch else "solo",
        "subsets_dir": str(SUBSETS_DIR),
        "annotation_imports_dir": str(ANNOTATION_APP_IMPORTS),
        "workspace": str(WORKSPACE),
    }
