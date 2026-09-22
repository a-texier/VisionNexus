# ============================================================
# tests/test_api_datasets.py
# Tests API : cycle de vie d'un dataset via TestClient.
#
# NOTE : POST /api/datasets lance un scan en BackgroundTasks. Avec
# starlette TestClient, les background tasks s'executent de maniere
# synchrone AVANT que la reponse HTTP ne soit renvoyee au client — donc
# par le temps que `resp = client.post(...)` retourne, le scan (glob +
# md5 + 5 thumbnails) est deja termine. Pas besoin de polling ici.
# ============================================================

from PIL import Image as PILImage


def _make_image_folder(tmp_path, n=4, ext="png"):
    d = tmp_path / "imgs"
    d.mkdir()
    for i in range(n):
        PILImage.new("RGB", (16, 16), color=(i * 20, 50, 100)).save(d / f"img{i}.{ext}", ext.upper())
    return d


# ------------------------------------------------------------------ #
# Création + scan
# ------------------------------------------------------------------ #

def test_create_dataset_scans_synchronously(api_client, tmp_path):
    folder = _make_image_folder(tmp_path, n=4)
    resp = api_client.post("/api/datasets", json={"root_path": str(folder), "n_clusters": 2})
    assert resp.status_code == 201
    body = resp.json()
    assert body["status"] == "scanning"  # etat renvoye immediatement, avant le scan bg
    dataset_id = body["id"]

    # Le scan bg est deja termine (TestClient execute les BackgroundTasks avant de repondre)
    get_resp = api_client.get(f"/api/datasets/{dataset_id}")
    assert get_resp.status_code == 200
    data = get_resp.json()
    assert data["image_count"] == 4
    assert data["status"] == "pending"  # scan complet -> pending (avant embed)


def test_create_dataset_invalid_path_returns_400(api_client):
    resp = api_client.post("/api/datasets", json={"root_path": "C:/definitely/not/a/real/path"})
    assert resp.status_code == 400


def test_create_dataset_empty_folder_status_error(api_client, tmp_path):
    empty_dir = tmp_path / "empty"
    empty_dir.mkdir()
    resp = api_client.post("/api/datasets", json={"root_path": str(empty_dir)})
    assert resp.status_code == 201
    dataset_id = resp.json()["id"]
    data = api_client.get(f"/api/datasets/{dataset_id}").json()
    assert data["status"] == "error"


def test_create_dataset_custom_name(api_client, tmp_path):
    folder = _make_image_folder(tmp_path, n=2)
    resp = api_client.post("/api/datasets", json={"root_path": str(folder), "name": "mon_dataset_perso"})
    assert resp.json()["name"] == "mon_dataset_perso"


# ------------------------------------------------------------------ #
# Listing
# ------------------------------------------------------------------ #

def test_list_datasets_includes_created(api_client, tmp_path):
    folder = _make_image_folder(tmp_path, n=2)
    create_resp = api_client.post("/api/datasets", json={"root_path": str(folder)})
    dataset_id = create_resp.json()["id"]

    resp = api_client.get("/api/datasets")
    assert resp.status_code == 200
    ids = [d["id"] for d in resp.json()]
    assert dataset_id in ids


def test_check_path_detects_existing_dataset(api_client, tmp_path):
    folder = _make_image_folder(tmp_path, n=2)
    api_client.post("/api/datasets", json={"root_path": str(folder)})

    resp = api_client.get("/api/datasets/check-path", params={"root_path": str(folder)})
    assert resp.status_code == 200
    matches = resp.json()
    assert len(matches) == 1


def test_check_path_no_match_returns_empty(api_client, tmp_path):
    other = tmp_path / "never_scanned"
    other.mkdir()
    resp = api_client.get("/api/datasets/check-path", params={"root_path": str(other)})
    assert resp.json() == []


# ------------------------------------------------------------------ #
# GET /{id}, /{id}/stats, /{id}/images — 404 et contenu
# ------------------------------------------------------------------ #

def test_get_dataset_not_found_404(api_client):
    resp = api_client.get("/api/datasets/999999")
    assert resp.status_code == 404


def test_get_dataset_stats(api_client, tmp_path):
    folder = _make_image_folder(tmp_path, n=3)
    dataset_id = api_client.post("/api/datasets", json={"root_path": str(folder)}).json()["id"]
    resp = api_client.get(f"/api/datasets/{dataset_id}/stats")
    assert resp.status_code == 200


def test_get_dataset_images_page(api_client, tmp_path):
    folder = _make_image_folder(tmp_path, n=5)
    dataset_id = api_client.post("/api/datasets", json={"root_path": str(folder)}).json()["id"]
    resp = api_client.get(f"/api/datasets/{dataset_id}/images", params={"page": 0, "limit": 3})
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["items"]) <= 3
    assert data["total"] == 5


def test_get_dataset_images_unknown_dataset_returns_empty_page(api_client):
    """L'endpoint ne verifie pas l'existence du dataset : un id inconnu
    renvoie 200 avec une page vide plutot qu'un 404 (comportement actuel,
    documente ici pour ne pas regresser silencieusement)."""
    resp = api_client.get("/api/datasets/999999/images")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 0
    assert data["items"] == []


# ------------------------------------------------------------------ #
# Suppression
# ------------------------------------------------------------------ #

def test_delete_dataset_removes_it(api_client, tmp_path):
    folder = _make_image_folder(tmp_path, n=2)
    dataset_id = api_client.post("/api/datasets", json={"root_path": str(folder)}).json()["id"]

    del_resp = api_client.delete(f"/api/datasets/{dataset_id}")
    assert del_resp.status_code == 200
    assert del_resp.json()["success"] is True

    get_resp = api_client.get(f"/api/datasets/{dataset_id}")
    assert get_resp.status_code == 404


def test_delete_dataset_not_found_404(api_client):
    resp = api_client.delete("/api/datasets/999999")
    assert resp.status_code == 404
