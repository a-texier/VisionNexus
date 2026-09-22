# ============================================================
# tests/test_api_filter_duplicates.py
# Tests API : recherche sémantique + doublons — chemins d'erreur
# (dataset introuvable / index FAISS pas encore construit) et le
# patch de décision qui n'a pas besoin d'embeddings.
# ============================================================

from PIL import Image as PILImage


_counter = {"i": 0}


def _make_pending_dataset(api_client, tmp_path, n=2):
    """Cree un dataset scanne (status=pending) mais SANS embeddings/FAISS."""
    _counter["i"] += 1
    d = tmp_path / f"imgs_{n}_{_counter['i']}"
    d.mkdir()
    for i in range(n):
        PILImage.new("RGB", (8, 8), color=(i * 10, 0, 0)).save(d / f"img{i}.png", "PNG")
    resp = api_client.post("/api/datasets", json={"root_path": str(d)})
    return resp.json()["id"]


# ------------------------------------------------------------------ #
# Semantic search — chemins d'erreur
# ------------------------------------------------------------------ #

def test_semantic_search_dataset_not_found(api_client):
    resp = api_client.post(
        "/api/datasets/999999/semantic-search",
        json={"query": "a car", "top_k": 5},
    )
    assert resp.status_code == 404


def test_semantic_search_index_not_built_425(api_client, tmp_path):
    dataset_id = _make_pending_dataset(api_client, tmp_path)
    resp = api_client.post(
        f"/api/datasets/{dataset_id}/semantic-search",
        json={"query": "a car", "top_k": 5},
    )
    assert resp.status_code == 425


# ------------------------------------------------------------------ #
# Duplicates — chemins d'erreur
# ------------------------------------------------------------------ #

def test_get_duplicates_dataset_not_found(api_client):
    resp = api_client.get("/api/datasets/999999/duplicates")
    assert resp.status_code == 404


def test_get_duplicates_index_not_built_425(api_client, tmp_path):
    dataset_id = _make_pending_dataset(api_client, tmp_path)
    resp = api_client.get(f"/api/datasets/{dataset_id}/duplicates")
    assert resp.status_code == 425


# ------------------------------------------------------------------ #
# Decision de doublon — n'a pas besoin d'embeddings
# ------------------------------------------------------------------ #

def test_patch_duplicate_decision_updates_image(api_client, tmp_path):
    dataset_id = _make_pending_dataset(api_client, tmp_path, n=2)
    images = api_client.get(f"/api/datasets/{dataset_id}/images").json()["items"]
    image_id = images[0]["id"]

    resp = api_client.patch(
        f"/api/datasets/{dataset_id}/duplicates/decision",
        json={"decisions": [{"image_id": image_id, "keep": False}]},
    )
    assert resp.status_code == 200
    assert resp.json()["updated"] == 1

    updated_images = api_client.get(f"/api/datasets/{dataset_id}/images").json()["items"]
    updated = next(i for i in updated_images if i["id"] == image_id)
    assert updated["is_duplicate_kept"] is False


def test_patch_duplicate_decision_wrong_dataset_id_ignored(api_client, tmp_path):
    """Une image appartenant a un AUTRE dataset ne doit pas etre modifiee (isolation)."""
    dataset_a = _make_pending_dataset(api_client, tmp_path, n=1)
    dataset_b = _make_pending_dataset(api_client, tmp_path, n=1)
    images_b = api_client.get(f"/api/datasets/{dataset_b}/images").json()["items"]
    image_id_b = images_b[0]["id"]

    resp = api_client.patch(
        f"/api/datasets/{dataset_a}/duplicates/decision",
        json={"decisions": [{"image_id": image_id_b, "keep": False}]},
    )
    assert resp.status_code == 200
    assert resp.json()["updated"] == 0


def test_patch_duplicate_decision_unknown_image_ignored(api_client, tmp_path):
    dataset_id = _make_pending_dataset(api_client, tmp_path, n=1)
    resp = api_client.patch(
        f"/api/datasets/{dataset_id}/duplicates/decision",
        json={"decisions": [{"image_id": 999999, "keep": True}]},
    )
    assert resp.status_code == 200
    assert resp.json()["updated"] == 0
