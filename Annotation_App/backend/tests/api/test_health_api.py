# ============================================================
# Tests API — endpoints de sante / racine (backend/main.py)
# TestClient avec lifespan (SAM2 mocke via conftest._no_real_sam_load).
# ============================================================

import pytest

pytestmark = pytest.mark.unit


def test_health_endpoint_ok(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert data["api"] == "running"
    assert data["database"] == "connected"
    assert "sam2" in data


def test_root_endpoint(client):
    resp = client.get("/")
    assert resp.status_code == 200
    data = resp.json()
    assert data["message"] == "Annotation App API"
    assert data["docs"] == "/docs"


def test_app_mode_solo_by_default(client, monkeypatch):
    monkeypatch.delenv("LAUNCHED_BY_ORCHESTRATOR", raising=False)
    resp = client.get("/api/app-mode")
    assert resp.status_code == 200
    assert resp.json()["mode"] == "solo"


def test_sam_ping_reports_not_loaded_in_test_env(client):
    resp = client.get("/api/sam/ping")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "not_loaded"


def test_workspace_users_without_instances_file_returns_empty_list(client, monkeypatch):
    monkeypatch.delenv("IA_INSTANCES_FILE", raising=False)
    resp = client.get("/api/workspace/users")
    assert resp.status_code == 200
    assert resp.json() == []


def test_workspace_history_without_env_returns_empty_list(client, monkeypatch):
    monkeypatch.delenv("IA_WORKSPACE_HISTORY_FILE", raising=False)
    resp = client.get("/api/workspace/history")
    assert resp.status_code == 200
    assert resp.json() == []
