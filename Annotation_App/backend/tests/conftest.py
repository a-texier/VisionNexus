# ============================================================
# backend/tests/conftest.py
#
# Configuration globale des tests unitaires / API (pytest).
#
# IMPORTANT : ce fichier DOIT positionner les variables d'environnement
# d'isolation AVANT tout import du package `backend` (backend.config lit
# ANNOTATION_WORKSPACE au moment de l'import et cree le dossier + le
# singleton dataset_service pointe dessus des son instanciation). Comme
# pytest importe les conftest.py avant de collecter les modules de test,
# placer ce code au niveau module (avant toute fonction) garantit l'ordre.
#
# Aucun test de ce dossier ne doit toucher au vrai workspace de l'utilisateur
# (data/, All_workspaces/, *.db de prod) : chaque session de test tourne
# dans un dossier temporaire dedie, detruit a la fin.
# ============================================================

import os
import sys
import tempfile
from pathlib import Path

# ---- Isolation AVANT tout import de `backend` ----
_TEST_WORKSPACE = tempfile.mkdtemp(prefix="annotation_app_tests_")
os.environ["ANNOTATION_WORKSPACE"] = _TEST_WORKSPACE
# Pas de telechargement / appel reseau pendant les tests (HuggingFace, etc.)
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")

import atexit
import shutil

import pytest

# Nettoyage du workspace temporaire meme si la session pytest est interrompue
# (Ctrl+C, crash) : sans ca, chaque run laissait un dossier orphelin dans %TEMP%.
atexit.register(lambda: shutil.rmtree(_TEST_WORKSPACE, ignore_errors=True))

# ---- Collection : exclure les scripts standalone (pas des tests pytest) ----
# Ces fichiers n'ont aucune fonction test_*() ; ce sont des scripts manuels
# (`python backend/tests/test_sam2.py`) qui chargent torch/SAM2/GPU reels a
# l'import. Les collecter ralentit / bloque la suite sans rien apporter.
collect_ignore = [
    "test_sam2.py",
    "test_sam3.py",
    "test_xfeat.py",
    "download_all_models.py",
    "download_grounding_dino.py",
    "download_sam2.py",
    "download_sam3.py",
]


@pytest.fixture(scope="session")
def test_workspace() -> Path:
    """Dossier workspace temporaire utilise par toute la session de test."""
    return Path(_TEST_WORKSPACE)


@pytest.fixture(autouse=True)
def _no_real_sam_load(monkeypatch):
    """
    Empeche tout test API de charger reellement SAM2 (poids/torch/GPU) via le
    lifespan FastAPI. `sam_service.load_model` est monkeypatche pour renvoyer
    un statut 'checkpoint_missing' rapide, sans toucher au disque/GPU.
    Un test qui a explicitement besoin du vrai chargement peut annuler ce
    monkeypatch localement (non utilise actuellement dans cette suite).
    """
    from backend.services.sam_service import sam_service

    async def _fake_load_model(model_size: str = "tiny"):
        return {
            "status": "checkpoint_missing",
            "device": sam_service.device,
            "model": model_size,
            "checkpoint_path": "(mocked in tests)",
            "message": "SAM2 non charge en environnement de test.",
        }

    monkeypatch.setattr(sam_service, "load_model", _fake_load_model)
    yield


@pytest.fixture()
def app():
    """Instance FastAPI de l'application (import differe : apres set des env vars)."""
    from backend.main import app as _app
    return _app


@pytest.fixture()
def client(app):
    """
    TestClient avec le cycle de vie (lifespan) execute : cree les tables,
    applique les migrations, "charge" SAM2 (mocke, voir _no_real_sam_load).
    Chaque test recoit un client frais, mais la BASE SQLITE EST PARTAGEE
    pour toute la session (fichier unique dans le workspace temporaire) —
    les tests doivent donc creer leurs propres projets plutot que de supposer
    une base vide.
    """
    from fastapi.testclient import TestClient

    with TestClient(app) as c:
        yield c


@pytest.fixture()
def db_session():
    """Session SQLModel brute sur la meme base que l'app (pour setup direct)."""
    from sqlmodel import Session
    from backend.database import engine, create_db_and_tables

    create_db_and_tables()
    with Session(engine) as session:
        yield session


def _make_project(client, name="Test project", project_type="image", classes=None):
    payload = {
        "name": name,
        "project_type": project_type,
        "classes": classes or [{"name": "objet"}],
    }
    resp = client.post("/api/projects", json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


@pytest.fixture()
def make_project(client):
    """Factory fixture : cree un projet via l'API et retourne son dict JSON."""
    def _factory(**kwargs):
        return _make_project(client, **kwargs)
    return _factory


@pytest.fixture()
def project_with_frame(client, db_session, make_project):
    """
    Cree un projet (avec 1 classe) + 1 frame insere directement en base
    (pas de vrai fichier image sur disque : suffisant pour les tests CRUD
    d'annotations qui ne lisent pas le fichier).
    """
    from backend.models.frame import Frame

    project = make_project()
    frame = Frame(
        project_id=project["id"],
        frame_index=0,
        filename="frame_000000.jpg",
        width=640,
        height=480,
    )
    db_session.add(frame)
    db_session.commit()
    db_session.refresh(frame)

    classes_resp = client.get(f"/api/projects/{project['id']}/classes")
    classes = classes_resp.json()

    return {
        "project": project,
        "frame_id": frame.id,
        "class_id": classes[0]["id"] if classes else None,
    }
