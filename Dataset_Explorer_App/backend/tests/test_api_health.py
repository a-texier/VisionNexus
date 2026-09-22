# ============================================================
# tests/test_api_health.py
# Tests API : /health et endpoints divers de main.py.
# ============================================================


def test_health_ok(api_client):
    resp = api_client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert "clip_loaded" in data
    assert "device" in data


def test_health_clip_loaded_after_startup(api_client):
    """Le lifespan doit avoir charge CLIP au demarrage de l'app de test."""
    resp = api_client.get("/health")
    assert resp.json()["clip_loaded"] is True


def test_app_mode_solo_by_default(api_client, monkeypatch):
    import os
    monkeypatch.delenv("LAUNCHED_BY_ORCHESTRATOR", raising=False)
    resp = api_client.get("/api/app-mode")
    assert resp.status_code == 200
    data = resp.json()
    assert data["mode"] == "solo"
    assert "workspace" in data


def test_workspace_users_no_instances_file_returns_empty(api_client, monkeypatch):
    monkeypatch.delenv("IA_INSTANCES_FILE", raising=False)
    resp = api_client.get("/api/workspace/users")
    assert resp.status_code == 200
    assert resp.json() == []


def test_workspace_history_no_file_returns_empty(api_client, monkeypatch):
    monkeypatch.delenv("IA_WORKSPACE_HISTORY_FILE", raising=False)
    resp = api_client.get("/api/workspace/history")
    assert resp.status_code == 200
    assert resp.json() == []


def test_cors_headers_present_for_allowed_origin(api_client):
    resp = api_client.get("/health", headers={"Origin": "http://localhost:5173"})
    assert resp.status_code == 200
    assert resp.headers.get("access-control-allow-origin") == "http://localhost:5173"


def test_thumbs_static_mount_404_for_missing_file(api_client):
    resp = api_client.get("/thumbs/does_not_exist.jpg")
    assert resp.status_code == 404


def test_gallery_thumbs_static_mount_404_for_missing_file(api_client):
    resp = api_client.get("/gallery-thumbs/does_not_exist/thumbs/0.jpg")
    assert resp.status_code == 404
