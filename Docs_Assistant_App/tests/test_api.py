from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.config import Settings
from backend.main import create_app
from tests.helpers import FakeEmbedder, make_settings


@pytest.fixture
def embedder() -> FakeEmbedder:
    return FakeEmbedder()


@pytest.fixture
def client(settings: Settings, embedder: FakeEmbedder) -> Iterator[TestClient]:
    with TestClient(create_app(settings, embedder, autosync=False)) as c:
        yield c


def synced(client: TestClient) -> None:
    assert client.post("/index/sync").status_code == 202
    client.app.state.services.sync.wait(60)


def test_health_is_fast_and_reports_flags(client: TestClient) -> None:
    body = client.get("/health").json()
    assert body == {
        "status": "ok",
        "model_available": True,
        "model_loaded": True,
        "index_ready": False,
        "syncing": False,
    }
    synced(client)
    assert client.get("/health").json()["index_ready"] is True


def test_health_answers_without_model(settings: Settings) -> None:
    embedder = FakeEmbedder()
    embedder.is_available = False
    embedder.is_loaded = False
    with TestClient(create_app(settings, embedder, autosync=False)) as client:
        assert client.get("/health").json()["model_available"] is False
        status = client.get("/index/status").json()
        assert status["model_available"] is False and "introuvable" in status["message"]
        synced(client)
        res = client.post("/search", json={"q": "alpha section"}).json()
        assert res["mode"] == "keyword" and res["notice"] and res["hits"]


def test_index_status_contents(client: TestClient) -> None:
    synced(client)
    status = client.get("/index/status").json()
    assert status["model_id"] == "fake-model" and status["dim"] == 96 and status["device"] == "fake"
    assert (status["files"], status["chunks"], status["embedded"]) == (4, 12, 12)
    assert status["per_lang"] == {"en": 6, "fr": 6} and status["per_app"] == {"annotation": 6, "dvc": 6}
    assert status["last_sync"]["at"] and status["last_sync"]["seconds"] is not None
    assert status["syncing"] is False and status["last_error"] is None and status["seed_used"] is False
    assert status["progress"]["chunks_embedded"] == 12


def test_sync_is_idempotent_while_running(client: TestClient) -> None:
    sync = client.app.state.services.sync
    sync._state["syncing"] = True
    res = client.post("/index/sync")
    assert res.status_code == 202 and res.json()["started"] is False
    assert client.post("/index/rebuild").status_code == 409
    sync._state["syncing"] = False


def test_rebuild_reindexes(client: TestClient, embedder: FakeEmbedder) -> None:
    synced(client)
    embedder.passage_texts.clear()
    assert client.post("/index/rebuild").status_code == 202
    client.app.state.services.sync.wait(60)
    assert len(embedder.passage_texts) == 12


def test_search_contract(client: TestClient) -> None:
    synced(client)
    res = client.post(
        "/search", json={"q": "endvcbeta3", "lang": "en", "apps": ["dvc"], "audience": "user", "k": 3}
    )
    assert res.status_code == 200
    body = res.json()
    assert body["mode"] == "hybrid" and body["took_ms"] >= 0 and body["terms"] == ["endvcbeta3"]
    hit = body["hits"][0]
    assert (hit["app"], hit["doc"], hit["lang"]) == ("dvc", "user-guide", "en")
    assert hit["heading_path"] == ["User guide", "Beta section"] and hit["keyword_rank"] == 1
    assert hit["other_lang"] == {"lang": "fr", "doc": "user-guide", "heading_idx": hit["heading_idx"]}
    assert len(body["hits"]) <= 3


def test_search_short_query_is_empty(client: TestClient) -> None:
    synced(client)
    for q in ("", "a", "  "):
        res = client.post("/search", json={"q": q})
        assert res.status_code == 200 and res.json()["hits"] == []


@pytest.mark.parametrize(
    ("payload", "fragment"),
    [
        ({"q": "x" * 501}, "q"),
        ({"q": "ok", "k": 31}, "k"),
        ({"q": "ok", "k": 0}, "k"),
        ({"q": "ok", "lang": "de"}, "lang"),
        ({"q": "ok", "audience": "admin"}, "audience"),
        ({}, "q"),
    ],
)
def test_search_validation_errors_are_readable(client: TestClient, payload: dict, fragment: str) -> None:
    res = client.post("/search", json=payload)
    assert res.status_code == 422
    body = res.json()
    assert body["detail"].startswith("Requete invalide") and fragment in body["detail"]
    assert isinstance(body["errors"], list)


def test_search_with_special_characters_does_not_500(client: TestClient) -> None:
    synced(client)
    for q in ['it\'s "a" -b', "AND OR (", "\u00e9cran d\u00e9pannage", "*"]:
        assert client.post("/search", json={"q": q}).status_code == 200


def test_startup_installs_matching_seed(tmp_path: Path, docs_root: Path, embedder: FakeEmbedder) -> None:
    from backend.core.store import Store
    from backend.core.sync import SyncManager

    settings = make_settings(tmp_path, docs_root)
    seed = Store(settings.seed_path)
    SyncManager(seed, FakeEmbedder(), docs_root).run_blocking()
    seed.close()

    with TestClient(create_app(settings, embedder, autosync=True)) as client:
        client.app.state.services.sync.wait(60)
        status = client.get("/index/status").json()
        assert status["seed_used"] is True and status["embedded"] == 12
        assert embedder.passage_texts == []  # rien a re-embedder apres le seed
