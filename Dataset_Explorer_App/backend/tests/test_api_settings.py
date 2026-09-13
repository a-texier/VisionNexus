# ============================================================
# tests/test_api_settings.py
# Tests API : GET/PUT /api/settings.
# ============================================================

import pytest


@pytest.fixture(autouse=True)
def _restore_settings_after_test(api_client):
    """Chaque test peut modifier settings.json — on restaure les defauts apres."""
    original = api_client.get("/api/settings").json()
    yield
    api_client.put("/api/settings", json=original)


def test_get_settings_returns_defaults(api_client):
    resp = api_client.get("/api/settings")
    assert resp.status_code == 200
    data = resp.json()
    assert "workspace_path" in data
    assert data["theme"] in ("dark", "light")
    assert data["use_symlinks"] is True
    assert data["reduction_method"] == "umap"


def test_put_settings_roundtrip(api_client):
    current = api_client.get("/api/settings").json()
    current["default_n_clusters"] = 42
    current["theme"] = "dark"
    current["use_symlinks"] = False

    resp = api_client.put("/api/settings", json=current)
    assert resp.status_code == 200
    saved = resp.json()
    assert saved["default_n_clusters"] == 42
    assert saved["use_symlinks"] is False

    # Re-lecture doit refleter la sauvegarde (persistee sur disque)
    reread = api_client.get("/api/settings").json()
    assert reread["default_n_clusters"] == 42
    assert reread["use_symlinks"] is False


def test_put_settings_workspace_path_is_forced_from_env(api_client):
    """workspace_path/user_name sont toujours forces via l'env, jamais depuis le body."""
    current = api_client.get("/api/settings").json()
    current["workspace_path"] = "C:/fake/path/should/be/ignored"
    resp = api_client.put("/api/settings", json=current)
    assert resp.status_code == 200
    assert resp.json()["workspace_path"] != "C:/fake/path/should/be/ignored"


def test_put_settings_invalid_body_returns_422(api_client):
    resp = api_client.put("/api/settings", json={"default_n_clusters": "not_a_number"})
    assert resp.status_code == 422


def test_put_settings_reduction_params(api_client):
    current = api_client.get("/api/settings").json()
    current["reduction_method"] = "tsne"
    current["tsne_perplexity"] = 15
    resp = api_client.put("/api/settings", json=current)
    assert resp.status_code == 200
    assert resp.json()["reduction_method"] == "tsne"
    assert resp.json()["tsne_perplexity"] == 15
