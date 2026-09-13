# ============================================================
# main.py
# Point d'entrée de l'application FastAPI.
#
# Démarrage : conda activate IA_env && uvicorn backend.main:app --reload
# (depuis le dossier Annotation_App/)
#
# L'application démarre avec :
#   1. Création des tables SQLite si elles n'existent pas
#   2. Chargement du modèle SAM2 en mémoire (GPU si disponible)
#   3. Montage des fichiers statiques (images, miniatures)
#   4. Configuration CORS pour le frontend Vite (port 5173)
# ============================================================

from contextlib import asynccontextmanager
from datetime import datetime
import os
from pathlib import Path  # Utilisé pour checkpoint_small
from typing import Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles

from backend.models.routers import annotation, dataset, export, projects, sam, samples, settings, storage, tracking, convert, orchestrator as orchestrator_router
from backend.database import create_db_and_tables, engine
from backend.services.sam_service import sam_service
from backend.config import DATA_DIR, CORS_ORIGINS  # noqa: F401


def _run_migrations():
    """
    Applique les migrations de schéma SQLite manquantes.
    Ajoute les colonnes absentes sans recréer les tables (ALTER TABLE).
    Compatible avec les bases de données existantes.
    """
    from sqlalchemy import text, inspect as sa_inspect
    with engine.connect() as conn:
        inspector = sa_inspect(engine)
        # --- Migration : colonne source_algorithm dans annotation ---
        try:
            cols = [c['name'] for c in inspector.get_columns('annotation')]
            if 'source_algorithm' not in cols:
                conn.execute(text('ALTER TABLE annotation ADD COLUMN source_algorithm VARCHAR DEFAULT NULL'))
                conn.commit()
                print("[migration] Colonne source_algorithm ajoutee a la table annotation")
        except Exception as e:
            print(f"[migration] Avertissement source_algorithm : {e}")

        # --- Migration : multi-sequence (frame.sequence_id) ---
        try:
            cols = [c['name'] for c in inspector.get_columns('frame')]
            if 'sequence_id' not in cols:
                conn.execute(text('ALTER TABLE frame ADD COLUMN sequence_id INTEGER DEFAULT NULL'))
                conn.commit()
                print("[migration] Colonne sequence_id ajoutee a la table frame")
        except Exception as e:
            print(f"[migration] Avertissement multi-sequence : {e}")

        # --- Migration : tracabilite des exports par sequence ---
        # Une sequence n'est "terminee" que si elle a ete exportee : ces deux
        # colonnes portent ce fait, lu par le monitoring (coche verte).
        try:
            cols = [c['name'] for c in inspector.get_columns('sequence')]
            if 'last_export_at' not in cols:
                conn.execute(text('ALTER TABLE sequence ADD COLUMN last_export_at DATETIME DEFAULT NULL'))
                conn.commit()
                print("[migration] Colonne last_export_at ajoutee a la table sequence")
            if 'last_export_format' not in cols:
                conn.execute(text('ALTER TABLE sequence ADD COLUMN last_export_format VARCHAR DEFAULT NULL'))
                conn.commit()
                print("[migration] Colonne last_export_format ajoutee a la table sequence")
        except Exception as e:
            print(f"[migration] Avertissement export sequence : {e}")

        # --- Migration : pistes décorrélées par séquence (track.sequence_id) ---
        try:
            cols = [c['name'] for c in inspector.get_columns('track')]
            if 'sequence_id' not in cols:
                conn.execute(text('ALTER TABLE track ADD COLUMN sequence_id INTEGER DEFAULT NULL'))
                conn.commit()
                print("[migration] Colonne sequence_id ajoutee a la table track")
        except Exception as e:
            print(f"[migration] Avertissement track.sequence_id : {e}")

        # --- Migration : hierarchie de classes (labelclass) ---
        try:
            cols = [c['name'] for c in inspector.get_columns('labelclass')]
            if 'subclass' not in cols:
                conn.execute(text('ALTER TABLE labelclass ADD COLUMN subclass VARCHAR DEFAULT NULL'))
                conn.commit()
                print("[migration] Colonne subclass ajoutee a la table labelclass")
            if 'subsubclass' not in cols:
                conn.execute(text('ALTER TABLE labelclass ADD COLUMN subsubclass VARCHAR DEFAULT NULL'))
                conn.commit()
                print("[migration] Colonne subsubclass ajoutee a la table labelclass")
        except Exception as e:
            print(f"[migration] Avertissement hierarchie classes : {e}")

        # --- Migration : LUT d'affichage par projet (project.lut_json) ---
        try:
            cols = [c['name'] for c in inspector.get_columns('project')]
            if 'lut_json' not in cols:
                conn.execute(text('ALTER TABLE project ADD COLUMN lut_json VARCHAR DEFAULT NULL'))
                conn.commit()
                print("[migration] Colonne lut_json ajoutee a la table project")
        except Exception as e:
            print(f"[migration] Avertissement lut_json : {e}")

        # --- Migration : LUT d'affichage par séquence (sequence.lut_json) ---
        try:
            cols = [c['name'] for c in inspector.get_columns('sequence')]
            if 'lut_json' not in cols:
                conn.execute(text('ALTER TABLE sequence ADD COLUMN lut_json VARCHAR DEFAULT NULL'))
                conn.commit()
                print("[migration] Colonne lut_json ajoutee a la table sequence")
        except Exception as e:
            print(f"[migration] Avertissement lut_json sequence : {e}")

        # --- Migration : projet template du tutoriel (project.is_template) ---
        try:
            cols = [c['name'] for c in inspector.get_columns('project')]
            if 'is_template' not in cols:
                conn.execute(text('ALTER TABLE project ADD COLUMN is_template INTEGER NOT NULL DEFAULT 0'))
                conn.commit()
                print("[migration] Colonne is_template ajoutee a la table project")
        except Exception as e:
            print(f"[migration] Avertissement is_template : {e}")

        # --- Migration : lazy extraction (frame) ---
        try:
            cols = [c['name'] for c in inspector.get_columns('frame')]
            if 'is_extracted' not in cols:
                conn.execute(text('ALTER TABLE frame ADD COLUMN is_extracted INTEGER NOT NULL DEFAULT 1'))
                conn.commit()
                print("[migration] Colonne is_extracted ajoutee a la table frame")
            if 'source_frame_index' not in cols:
                conn.execute(text('ALTER TABLE frame ADD COLUMN source_frame_index INTEGER DEFAULT NULL'))
                conn.commit()
                print("[migration] Colonne source_frame_index ajoutee a la table frame")
        except Exception as e:
            print(f"[migration] Avertissement lazy extraction : {e}")

# DATA_DIR est maintenant géré par backend.config (workspace configurable)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Gestionnaire du cycle de vie de l'application.
    Code avant 'yield' = démarrage, code après = arrêt.
    """
    # ---- Démarrage ----
    print("=" * 60)
    print("[startup] Demarrage de l'application d'annotation")
    print("=" * 60)

    # Threadpool anyio : TOUS les endpoints declares `def` (non-async) y sont
    # executes, ainsi que les ecritures DB des taches de tracking. Le defaut
    # (40) se sature pendant une propagation (worker GPU + commits + images
    # servies) → les requetes de statut/stop restaient en file jusqu'au timeout.
    try:
        import anyio.to_thread
        anyio.to_thread.current_default_thread_limiter().total_tokens = 96
    except Exception as e:
        print(f"[startup] Avertissement threadpool : {e}")

    # 1. Création des tables SQLite
    print("[startup] Initialisation de la base de donnees...")
    create_db_and_tables()
    _run_migrations()
    print("[startup] Base de donnees prete")

    # 2. Chargement du modèle SAM2
    # Priorité : small (si checkpoint présent) → tiny (fallback léger)
    print("[startup] Chargement du modele SAM2...")
    checkpoint_small = Path(__file__).parent / "checkpoints" / "sam2.1_hiera_small.pt"
    model_size = "small" if checkpoint_small.exists() else "tiny"
    print(f"[startup] Taille selectionnee : {model_size}")
    status = await sam_service.load_model(model_size=model_size)
    print(f"[startup] SAM2 status : {status}")

    print("=" * 60)
    print("[startup] Application prete !")
    backend_port = os.getenv("BACKEND_PORT", "8000")
    print(f"   API disponible sur : http://localhost:{backend_port}")
    print(f"   Documentation API : http://localhost:{backend_port}/docs")
    print("=" * 60)

    yield

    # ---- Arrêt ----
    print("[shutdown] Fermeture de l'application...")


# ---- Création de l'application FastAPI ----
app = FastAPI(
    title="Annotation App",
    description="""
    Application d'annotation semi-automatique de datasets visuels.

    ## Fonctionnalités
    - **Annotation manuelle** : bounding boxes et polygones via canvas Konva.js
    - **SAM2** : segmentation automatique ou par points interactifs
    - **Tracking vidéo** : ByteTrack + propagation homographique
    - **Export YOLO** : format train/val/test avec data.yaml

    ## WebSockets
    - `ws://localhost:8000/ws/sam/image` : streaming SAM2 image
    - `ws://localhost:8000/ws/sam/video` : session de propagation vidéo
    """,
    version="1.0.0",
    lifespan=lifespan,
)


# ---- CORS (Cross-Origin Resource Sharing) ----
# Permet au frontend Vite (port 5173) d'accéder à l'API FastAPI (port 8000)
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---- Compression GZip ----
# Essentiel en usage distant (SSH port-forward vers une VM) : les listes JSON
# de frames/annotations (plusieurs milliers d'entrees) sont compressees ~10x.
# Les images (JPEG/PNG deja compressees) passent sous le seuil et ne sont pas re-compressees.
app.add_middleware(GZipMiddleware, minimum_size=1024)


# ---- Montage des routers ----
app.include_router(projects.router)
app.include_router(dataset.router)
app.include_router(annotation.router)
app.include_router(sam.router)
app.include_router(tracking.router)
app.include_router(export.router)
app.include_router(samples.router)
app.include_router(settings.router)
app.include_router(storage.router)
app.include_router(convert.router)
app.include_router(orchestrator_router.router)


# ---- Fichiers statiques (images, miniatures) ----
# Accessible via /media/projects/{project_id}/frames/{filename}
if DATA_DIR.exists():
    app.mount("/media", StaticFiles(directory=str(DATA_DIR), follow_symlink=True), name="media")


# ---- Mode de lancement ----

@app.get("/api/app-mode")
def get_app_mode():
    """Retourne si l'app est lancée par l'Orchestrateur ou en mode solo."""
    import os
    from backend.config import EXPORTS_DIR
    is_orch = bool(os.environ.get("LAUNCHED_BY_ORCHESTRATOR"))
    return {
        "mode": "orchestrator" if is_orch else "solo",
        "exports_dir": str(EXPORTS_DIR),
        "workspace": str(DATA_DIR),
    }


@app.get("/api/capabilities", tags=["Capabilities"])
def get_capabilities():
    """Expose optional formats without coupling the frontend to a plugin name."""
    from backend.services.format_registry import available_formats

    return {"specific_formats": available_formats()}


# ---- Endpoints de santé ----

@app.get("/", tags=["Santé"])
def root():
    """Page d'accueil de l'API avec liens utiles."""
    return {
        "message": "Annotation App API",
        "version": "1.0.0",
        "docs": "/docs",
        "redoc": "/redoc",
        "health": "/health",
    }


@app.get("/health", tags=["Santé"])
async def health_check():
    """
    Vérification de l'état de l'application :
    - API FastAPI opérationnelle
    - État du modèle SAM2 (chargé, dispositif, mémoire GPU)
    """
    sam_status = sam_service.get_status()
    return {
        "status": "ok",
        "api": "running",
        "sam2": sam_status,
        "database": "connected",
    }


@app.get("/api/workspace/users", tags=["Santé"])
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


# Traduction POSIX -> UNC partage réseau natif : deplacee dans utils/native_share.py (reutilisee aussi
# par dataset.py pour /api/frames/{id}/image-path, cf. coquille Electron).
from backend.utils.native_share import to_native_share_path as _to_native_share_path


@app.post("/api/workspace/open", tags=["Santé"])
def workspace_open(request: Request, path: str = None):
    r"""Ouvre un dossier dans l'explorateur de fichiers.

    Le backend ne peut ouvrir une fenêtre QUE s'il tourne sur la machine de
    l'utilisateur. Quand il tourne sur la VM Linux et que le navigateur est sur
    un poste Windows, `xdg-open` ouvrirait un explorateur SUR LA VM (invisible,
    ou pire : un arbre texte dans le terminal SSH). Dans ce cas on renvoie le
    chemin UNC partage réseau natif (\\<share-host>\...) et c'est le frontend qui le propose à la
    copie — un navigateur ne peut pas lancer l'explorateur du poste client.
    """
    import os, subprocess, sys
    from pathlib import Path
    if path:
        raw = path
    else:
        ws = os.environ.get("ANNOTATION_WORKSPACE", "")
        if not ws:
            from backend.config import WORKSPACE
            ws = str(WORKSPACE)
        raw = ws

    # Client Windows tandis que le serveur est ailleurs → session distante.
    ua = (request.headers.get("user-agent") or "").lower()
    client_is_windows = "windows" in ua
    remote_session = sys.platform != "win32" and client_is_windows

    if remote_session:
        unc = _to_native_share_path(raw)
        if unc:
            return {"ok": False, "remote": True, "path": raw, "unc": unc,
                    "message": "Chemin reseau a coller dans l'explorateur Windows"}
        return {"ok": False, "remote": True, "path": raw, "unc": None,
                "message": ("Aucun partage partage réseau natif ne couvre ce chemin "
                            "(voir Parametres > Chemins : hote partage réseau natif et racines partagees)")}

    ws_path = Path(raw)
    try:
        ws_path.mkdir(parents=True, exist_ok=True)
    except Exception:
        pass
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


@app.get("/api/monitoring/stats", tags=["Monitoring"])
def monitoring_stats(scope: str = "me"):
    """Statistiques d'usage.

    scope="me"  : workspace courant uniquement.
    scope="all" : tous les workspaces d'annotation voisins (meme racine partagee),
                  ce qui donne la vue multi-utilisateurs sans quitter l'app.
    """
    from backend.config import WORKSPACE
    from backend.services.monitoring_service import (
        aggregate_workspace, discover_workspaces, group_by_root, group_by_user,
    )

    if scope == "all":
        workspaces = discover_workspaces([str(Path(WORKSPACE).parent)])
        if not workspaces:
            workspaces = [Path(WORKSPACE)]
    else:
        workspaces = [Path(WORKSPACE)]

    entries = []
    for w in workspaces:
        data = aggregate_workspace(w)
        data["root"] = Path(w).parent.name
        entries.append(data)

    return {
        "scope": scope,
        "workspaces": entries,
        # Vues globales : par utilisateur (somme de tous ses projets) et par
        # racine partagee. Calculees ici pour que l'UI n'ait pas a refaire
        # l'agregation, et pour que le rapport HTML utilise les memes chiffres.
        "by_user": group_by_user(entries),
        "by_root": group_by_root(entries),
    }


@app.get("/api/monitoring/report", tags=["Monitoring"])
def monitoring_report(scope: str = "me"):
    """Genere et renvoie le rapport HTML autonome (meme sortie que l'outil CLI).

    Le HTML est produit par tools/monitoring_report.py : une seule mise en forme
    a maintenir pour l'export depuis l'UI et pour le rapport de deconnexion.
    """
    import sys
    from fastapi.responses import Response as _Response
    from backend.config import WORKSPACE

    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    from tools.monitoring_report import build_payload, render_html

    base = str(Path(WORKSPACE).parent) if scope == "all" else str(WORKSPACE)
    try:
        html = render_html(build_payload([base]))
    except SystemExit as exc:  # aucun workspace trouve
        raise HTTPException(status_code=404, detail=str(exc))

    stamp = datetime.now().strftime("%Y%m%d_%H%M")
    return _Response(
        content=html.encode("utf-8"),
        media_type="text/html; charset=utf-8",
        headers={"Content-Disposition":
                 f'attachment; filename="annot_monitoring_{stamp}.html"'},
    )


@app.get("/api/workspace/open-cmd", tags=["Santé"])
def workspace_open_cmd(path: str = None):
    r"""Renvoie un petit script .cmd qui ouvre le dossier dans l'Explorateur Windows.

    Contournement de la seule limite reelle : le backend tourne sur la VM Linux et
    ne peut pas piloter le poste client ; un navigateur refuse `file://` depuis une
    page http. Le poste, lui, voit le dossier via le montage partage réseau natif. On lui donne
    donc un raccourci a executer localement (l'utilisateur doit cliquer dessus —
    aucun navigateur n'execute un telechargement tout seul, et c'est tant mieux).
    """
    import os
    from fastapi.responses import Response as _Response

    raw = path or os.environ.get("ANNOTATION_WORKSPACE", "")
    if not raw:
        from backend.config import WORKSPACE
        raw = str(WORKSPACE)

    target = _to_native_share_path(raw) or raw.replace("/", "\\")
    # Le .cmd est en cp850/ANSI cote console Windows : on reste en ASCII.
    body = (
        "@echo off\r\n"
        "rem Ouvre le dossier de travail dans l'Explorateur Windows.\r\n"
        f'start "" explorer "{target}"\r\n'
    )
    filename = "ouvrir_dossier.cmd"
    return _Response(
        content=body.encode("ascii", "replace"),
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.get("/api/workspace/history", tags=["Santé"])
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


@app.get("/api/sam/ping", tags=["SAM2"])
async def sam_ping():
    """
    Endpoint de test rapide pour vérifier que SAM2 est chargé et opérationnel.
    Utilisé par le frontend pour afficher l'état du modèle dans les paramètres.
    """
    status = sam_service.get_status()
    return {
        "status": "loaded" if status["loaded"] else "not_loaded",
        "device": status["device"],
        "model": status["model"],
        "gpu_memory_gb": status.get("gpu_memory_gb"),
        "message": "SAM2 opérationnel" if status["loaded"] else "Checkpoint manquant — voir README",
    }
