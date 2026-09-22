# ============================================================
# tests/conftest.py
# Configuration globale pytest — isolation totale du workspace.
#
# IMPORTANT : ce fichier DOIT s'executer avant tout import de
# "backend.config" (et donc de tout module backend.*), car
# config.py fige WORKSPACE / DATABASE_URL / THUMBS_DIR / FAISS_DIR
# des l'import (module-level). Sans ca, les tests utiliseraient
# le workspace de PRODUCTION (Dataset_Explorer_App/data/dataset_explorer.db).
#
# pytest importe conftest.py avant de collecter les modules de
# test du meme dossier, donc positionner les variables d'env ici,
# au niveau module (avant toute fonction), suffit a proteger tous
# les tests unitaires/API de ce paquet.
# ============================================================

import os
import sys
import tempfile
from pathlib import Path

# mkdtemp() (pas un nom fixe) : chaque run de pytest repart d'un workspace
# vierge, evitant l'accumulation d'etat (datasets, DB) entre executions
# successives qui fausserait des assertions comme "liste vide au depart".
_TEST_WORKSPACE_ROOT = Path(tempfile.mkdtemp(prefix="dataset_explorer_app_test_workspace_"))

os.environ.setdefault("EXPLORER_WORKSPACE", str(_TEST_WORKSPACE_ROOT))
os.environ.setdefault("EXPLORER_USER", "pytest")
os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")

# Garde-fou : si "backend.config" a deja ete importe (par ex. un autre
# conftest ou un import precoce) avec un workspace different, on le
# signale bruyamment plutot que de laisser des tests polluer la prod.
if "backend.config" in sys.modules:
    from backend import config as _cfg  # noqa: E402

    if str(_cfg.WORKSPACE) != str(_TEST_WORKSPACE_ROOT):
        raise RuntimeError(
            "backend.config a ete importe AVANT backend/tests/conftest.py "
            f"avec WORKSPACE={_cfg.WORKSPACE!r} (attendu {_TEST_WORKSPACE_ROOT!r}). "
            "Les tests risqueraient d'ecrire dans le workspace de production."
        )

import pytest  # noqa: E402


@pytest.fixture(autouse=True, scope="session")
def _guard_production_workspace():
    """Vérifie une fois par session que le workspace de test n'est pas celui de prod."""
    from backend import config as cfg

    app_root = Path(__file__).parent.parent.parent
    prod_data_dir = (app_root / "data").resolve()
    assert cfg.WORKSPACE.resolve() != prod_data_dir, (
        "Le workspace de test pointe vers le dossier data/ de production — "
        "verifier EXPLORER_WORKSPACE et l'ordre d'import de backend.config."
    )
    yield


@pytest.fixture(scope="session")
def api_client():
    """TestClient partage pour toute la session — le lifespan FastAPI charge
    CLIP une seule fois (couteux, ~10s) plutot qu'a chaque test.

    Les traitements lourds (scan, embed, recluster, reduce) ne passent plus par
    les BackgroundTasks de Starlette — que TestClient executait avant de rendre
    la main — mais par le pool de jobs (`backend/core/job_runner`), qui tourne
    dans ses propres threads. Sans attente, un test qui interroge le dataset
    juste apres l'avoir cree verrait encore `status="scanning"`.

    On attend donc que le pool soit au repos apres chaque requete : cela restitue
    exactement la semantique sur laquelle la suite est ecrite, sans introduire de
    mode "synchrone" special dans le code de production.
    """
    from fastapi.testclient import TestClient
    from backend.core.job_runner import wait_idle
    from backend.main import app

    with TestClient(app) as client:
        original_request = client.request

        def request_then_drain(*args, **kwargs):
            response = original_request(*args, **kwargs)
            wait_idle(timeout=120)
            return response

        client.request = request_then_drain
        yield client

