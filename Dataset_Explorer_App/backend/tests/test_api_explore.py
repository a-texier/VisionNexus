# ============================================================
# tests/test_api_explore.py
# Tests API : carte UMAP (/map) et clusters (/clusters).
# ============================================================

from PIL import Image as PILImage

_counter = {"i": 0}


def _make_pending_dataset(api_client, tmp_path, n=2):
    _counter["i"] += 1
    d = tmp_path / f"imgs_explore_{n}_{_counter['i']}"
    d.mkdir()
    for i in range(n):
        PILImage.new("RGB", (8, 8), color=(i * 10, 0, 0)).save(d / f"img{i}.png", "PNG")
    resp = api_client.post("/api/datasets", json={"root_path": str(d)})
    return resp.json()["id"]


def test_get_map_dataset_not_found(api_client):
    resp = api_client.get("/api/datasets/999999/map")
    assert resp.status_code == 404


def test_get_map_umap_not_cached_425(api_client, tmp_path):
    dataset_id = _make_pending_dataset(api_client, tmp_path)
    resp = api_client.get(f"/api/datasets/{dataset_id}/map")
    assert resp.status_code == 425


def test_get_clusters_dataset_not_found(api_client):
    resp = api_client.get("/api/datasets/999999/clusters")
    assert resp.status_code == 404


def test_get_clusters_empty_dataset_returns_zero_clusters(api_client, tmp_path):
    """Contrairement a /map, /clusters n'exige pas umap_cached — dataset pending => 0 clusters."""
    dataset_id = _make_pending_dataset(api_client, tmp_path)
    resp = api_client.get(f"/api/datasets/{dataset_id}/clusters")
    assert resp.status_code == 200
    data = resp.json()
    assert data["n_clusters"] == 0
    assert data["clusters"] == []
