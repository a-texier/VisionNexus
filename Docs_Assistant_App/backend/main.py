# ============================================================
# main.py
# Point d'entree FastAPI du Docs Assistant : service backend seul (pas de frontend).
# Indexe la doc produit (FR + EN) et renvoie des passages, sans generer de texte.
#
# Lancement :
#   uvicorn backend.main:app --host 0.0.0.0 --port 8068 --reload
# ============================================================

import logging
import os
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass

# Le service tourne hors ligne : aucun telechargement de modele au runtime.
os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")

from fastapi import FastAPI, HTTPException, Request  # noqa: E402
from fastapi.exceptions import RequestValidationError  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.responses import JSONResponse  # noqa: E402

from backend.config import Settings, load_settings  # noqa: E402
from backend.core.embedder import E5Embedder, Embedder  # noqa: E402
from backend.core.search import SearchParams, SearchService  # noqa: E402
from backend.core.store import Store, install_seed  # noqa: E402
from backend.core.sync import SyncManager  # noqa: E402
from backend.schemas import SearchRequest, SearchResponse  # noqa: E402

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


@dataclass
class Services:
    settings: Settings
    store: Store
    embedder: Embedder
    sync: SyncManager
    search: SearchService
    seed_used: bool


def build_services(settings: Settings, embedder: Embedder | None = None) -> Services:
    embedder = embedder or E5Embedder(settings.model_name, settings.model_dir, settings.device)
    seed_used = install_seed(settings.seed_path, settings.index_path, embedder.model_id)
    store = Store(settings.index_path)
    if seed_used:
        store.meta_set(seed_used="1")
        logger.info("index initialise depuis %s", settings.seed_path)
    sync = SyncManager(store, embedder, settings.repo_root)
    search = SearchService(
        store, embedder, lambda: sync.snapshot, embedder.model_id, warm_model=sync.warm_model
    )
    return Services(settings, store, embedder, sync, search, seed_used or store.meta_get("seed_used") == "1")


def create_app(
    settings: Settings | None = None, embedder: Embedder | None = None, autosync: bool = True
) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        logger.info("Demarrage docs-assistant...")
        services = build_services(settings or load_settings(), embedder)
        app.state.services = services
        if autosync:
            # Thread d'arriere-plan : /health repond tout de suite, meme modele non charge.
            services.sync.start()
        logger.info("docs-assistant pret (workspace %s)", services.settings.workspace)
        yield
        services.store.close()
        logger.info("docs-assistant arrete")

    app = FastAPI(
        title="Docs Assistant",
        description="Recherche semantique dans la doc produit (passages uniquement)",
        version="1.0.0",
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=r"http://(localhost|127\.0\.0\.1)(:\d+)?",
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.exception_handler(RequestValidationError)
    async def validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        # loc/msg/type suffisent au client ; le reste (input, ctx) n'est pas toujours serialisable.
        errors = [
            {"loc": [str(p) for p in err["loc"] if p != "body"], "msg": err["msg"], "type": err["type"]}
            for err in exc.errors()
        ]
        problems = [f"{'.'.join(e['loc'])}: {e['msg']}" for e in errors]
        return JSONResponse(
            status_code=422,
            content={"detail": "Requete invalide : " + " ; ".join(problems), "errors": errors},
        )

    def services_of(request: Request) -> Services:
        return request.app.state.services

    @app.get("/health")
    def health(request: Request) -> dict:
        svc = services_of(request)
        return {
            "status": "ok",
            "model_available": svc.embedder.available,
            "model_loaded": svc.embedder.loaded,
            "index_ready": len(svc.sync.snapshot.metas) > 0,
            "syncing": svc.sync.syncing,
        }

    @app.get("/index/status")
    def index_status(request: Request) -> dict:
        svc = services_of(request)
        state = svc.sync.status()
        counts = svc.store.counts(svc.embedder.model_id)
        available = svc.embedder.available
        message = ""
        if not available:
            message = svc.embedder.unavailable_reason()
        elif state.get("model_error"):
            message = f"Chargement du modele en echec : {state['model_error']}"
        return {
            "model_id": svc.embedder.model_id,
            "dim": svc.embedder.dim,
            "device": svc.embedder.device,
            "model_available": available,
            "model_loaded": svc.embedder.loaded,
            "message": message,
            **counts,
            "last_sync": {"at": state["last_sync_at"], "seconds": state["last_sync_seconds"]},
            "syncing": state["syncing"],
            "progress": state["progress"],
            "last_error": state["last_error"],
            "seed_used": svc.seed_used,
            "user": svc.settings.user,
            "workspace": str(svc.settings.workspace),
        }

    @app.post("/index/sync", status_code=202)
    def index_sync(request: Request) -> dict:
        svc = services_of(request)
        return {"started": svc.sync.start(), "syncing": True}

    @app.post("/index/rebuild", status_code=202)
    def index_rebuild(request: Request) -> dict:
        svc = services_of(request)
        if not svc.sync.start(rebuild=True):
            raise HTTPException(status_code=409, detail="Une synchronisation est deja en cours.")
        return {"started": True, "syncing": True}

    @app.post("/search", response_model=SearchResponse)
    def search(body: SearchRequest, request: Request) -> dict:
        svc = services_of(request)
        started = time.perf_counter()
        result = svc.search.search(
            SearchParams(
                q=body.q,
                lang=body.lang,
                apps=tuple(body.apps),
                audience=body.audience,
                k=body.k,
                prefer=body.prefer,
                ui_lang=body.ui_lang,
            )
        )
        result["took_ms"] = round((time.perf_counter() - started) * 1000, 1)
        return result

    return app


app = create_app()

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

