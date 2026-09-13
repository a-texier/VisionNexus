# ============================================================
# tests/test_api_folders.py
# Tests API : arborescence de dossiers (perso + partagés).
# ============================================================


def test_create_and_list_folder(api_client):
    resp = api_client.post("/api/folders", json={"name": "MonDossier"})
    assert resp.status_code == 201
    folder = resp.json()
    assert folder["name"] == "MonDossier"
    assert folder["parent_id"] is None
    assert folder["is_global"] is False
    assert folder["uid"] is None  # perso => pas d'uid

    listing = api_client.get("/api/folders").json()
    ids = [f["id"] for f in listing]
    assert folder["id"] in ids


def test_create_folder_empty_name_400(api_client):
    resp = api_client.post("/api/folders", json={"name": "   "})
    assert resp.status_code == 400


def test_create_folder_invalid_parent_400(api_client):
    resp = api_client.post("/api/folders", json={"name": "Enfant", "parent_id": 999999})
    assert resp.status_code == 400


def test_create_nested_folder(api_client):
    parent = api_client.post("/api/folders", json={"name": "Parent"}).json()
    child = api_client.post("/api/folders", json={"name": "Enfant", "parent_id": parent["id"]}).json()
    assert child["parent_id"] == parent["id"]


def test_create_global_folder_gets_uid(api_client):
    folder = api_client.post("/api/folders", json={"name": "Partage", "is_global": True}).json()
    assert folder["is_global"] is True
    assert folder["uid"] is not None


def test_update_folder_rename(api_client):
    folder = api_client.post("/api/folders", json={"name": "Avant"}).json()
    resp = api_client.patch(f"/api/folders/{folder['id']}", json={"name": "Apres"})
    assert resp.status_code == 200
    assert resp.json()["name"] == "Apres"


def test_update_folder_not_found_404(api_client):
    resp = api_client.patch("/api/folders/999999", json={"name": "x"})
    assert resp.status_code == 404


def test_update_folder_self_parent_400(api_client):
    folder = api_client.post("/api/folders", json={"name": "SelfParentTest"}).json()
    resp = api_client.patch(f"/api/folders/{folder['id']}", json={"parent_id": folder["id"]})
    assert resp.status_code == 400


def test_update_folder_reparent(api_client):
    a = api_client.post("/api/folders", json={"name": "A"}).json()
    b = api_client.post("/api/folders", json={"name": "B"}).json()
    resp = api_client.patch(f"/api/folders/{b['id']}", json={"parent_id": a["id"]})
    assert resp.json()["parent_id"] == a["id"]


def test_delete_folder_reattaches_children_to_grandparent(api_client):
    grandparent = api_client.post("/api/folders", json={"name": "GP"}).json()
    parent = api_client.post("/api/folders", json={"name": "P", "parent_id": grandparent["id"]}).json()
    child = api_client.post("/api/folders", json={"name": "C", "parent_id": parent["id"]}).json()

    del_resp = api_client.delete(f"/api/folders/{parent['id']}")
    assert del_resp.status_code == 200
    assert del_resp.json()["success"] is True

    listing = api_client.get("/api/folders").json()
    updated_child = next(f for f in listing if f["id"] == child["id"])
    assert updated_child["parent_id"] == grandparent["id"]


def test_delete_folder_not_found_404(api_client):
    resp = api_client.delete("/api/folders/999999")
    assert resp.status_code == 404


def test_folder_dataset_count(api_client, tmp_path):
    from PIL import Image as PILImage

    folder = api_client.post("/api/folders", json={"name": "AvecDataset"}).json()

    img_dir = tmp_path / "imgs_for_folder"
    img_dir.mkdir()
    PILImage.new("RGB", (8, 8)).save(img_dir / "a.png", "PNG")

    api_client.post(
        "/api/datasets",
        json={"root_path": str(img_dir), "folder_id": folder["id"]},
    )

    listing = api_client.get("/api/folders").json()
    updated = next(f for f in listing if f["id"] == folder["id"])
    assert updated["dataset_count"] == 1
