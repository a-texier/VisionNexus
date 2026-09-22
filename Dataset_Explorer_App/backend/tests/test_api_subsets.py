# ============================================================
# tests/test_api_subsets.py
# Tests API : cycle de vie des subsets (creation, duplication,
# liste, suppression, export vers l'Annotation App).
#
# NOTE : use_symlinks force a False via /api/settings pour rester
# portable sur Windows sans Mode Developpeur (os.symlink echouerait
# sinon). subset_manager retombe silencieusement sur la copie.
# ============================================================

import pytest
from PIL import Image as PILImage

_counter = {"i": 0}


@pytest.fixture(autouse=True)
def _force_copy_mode_and_restore(api_client):
    original = api_client.get("/api/settings").json()
    patched = dict(original)
    patched["use_symlinks"] = False
    api_client.put("/api/settings", json=patched)
    yield
    api_client.put("/api/settings", json=original)


def _make_dataset_with_images(api_client, tmp_path, n=3):
    _counter["i"] += 1
    d = tmp_path / f"imgs_subset_{n}_{_counter['i']}"
    d.mkdir()
    for i in range(n):
        PILImage.new("RGB", (8, 8), color=(i * 10, 0, 0)).save(d / f"img{i}.png", "PNG")
    resp = api_client.post("/api/datasets", json={"root_path": str(d)})
    dataset_id = resp.json()["id"]
    images = api_client.get(f"/api/datasets/{dataset_id}/images").json()["items"]
    return dataset_id, [img["id"] for img in images]


# ------------------------------------------------------------------ #
# Création
# ------------------------------------------------------------------ #

def test_create_subset(api_client, tmp_path):
    dataset_id, image_ids = _make_dataset_with_images(api_client, tmp_path, n=3)
    resp = api_client.post(
        "/api/subsets",
        json={"dataset_id": dataset_id, "name": "mon_subset", "image_ids": image_ids},
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "mon_subset"
    assert data["image_count"] == 3
    assert data["symlink_dir"] is not None


def test_create_subset_empty_image_list_400(api_client, tmp_path):
    dataset_id, _ = _make_dataset_with_images(api_client, tmp_path, n=1)
    resp = api_client.post(
        "/api/subsets", json={"dataset_id": dataset_id, "name": "vide", "image_ids": []}
    )
    assert resp.status_code == 400


def test_create_subset_no_valid_images_404(api_client, tmp_path):
    dataset_id, _ = _make_dataset_with_images(api_client, tmp_path, n=1)
    resp = api_client.post(
        "/api/subsets", json={"dataset_id": dataset_id, "name": "invalide", "image_ids": [999999]}
    )
    assert resp.status_code == 404


def test_create_subset_partial_image_list(api_client, tmp_path):
    """Seules les images du bon dataset_id sont incluses meme si d'autres ids sont fournis."""
    dataset_id, image_ids = _make_dataset_with_images(api_client, tmp_path, n=3)
    resp = api_client.post(
        "/api/subsets",
        json={"dataset_id": dataset_id, "name": "partiel", "image_ids": image_ids[:2] + [999999]},
    )
    assert resp.status_code == 201
    assert resp.json()["image_count"] == 2


def test_orchestrator_export_requires_exact_subset_identity_when_names_collide(api_client, tmp_path):
    ds1, images1 = _make_dataset_with_images(api_client, tmp_path, n=1)
    ds2, images2 = _make_dataset_with_images(api_client, tmp_path, n=2)
    s1 = api_client.post(
        "/api/subsets", json={"dataset_id": ds1, "name": "same_name", "image_ids": images1}
    ).json()
    s2 = api_client.post(
        "/api/subsets", json={"dataset_id": ds2, "name": "same_name", "image_ids": images2}
    ).json()

    ambiguous = api_client.post(
        "/api/orchestrator/export-subset",
        json={"subset_name": "same_name", "annotation_imports_path": str(tmp_path / "ambiguous")},
    )
    assert ambiguous.status_code == 409

    exact = api_client.post(
        "/api/orchestrator/export-subset",
        json={
            "subset_name": "same_name",
            "subset_id": s2["id"],
            "dataset_id": ds2,
            "annotation_imports_path": str(tmp_path / "exact"),
        },
    )
    assert exact.status_code == 200
    assert exact.json()["subset_id"] == s2["id"]
    assert exact.json()["dataset_id"] == ds2
    assert exact.json()["image_count"] == 2


# ------------------------------------------------------------------ #
# Listing + suppression
# ------------------------------------------------------------------ #

def test_list_subsets_filtered_by_dataset(api_client, tmp_path):
    dataset_id, image_ids = _make_dataset_with_images(api_client, tmp_path, n=2)
    api_client.post("/api/subsets", json={"dataset_id": dataset_id, "name": "s1", "image_ids": image_ids})

    resp = api_client.get("/api/subsets", params={"dataset_id": dataset_id})
    assert resp.status_code == 200
    names = [s["name"] for s in resp.json()]
    assert "s1" in names


def test_delete_subset(api_client, tmp_path):
    dataset_id, image_ids = _make_dataset_with_images(api_client, tmp_path, n=2)
    subset = api_client.post(
        "/api/subsets", json={"dataset_id": dataset_id, "name": "to_delete", "image_ids": image_ids}
    ).json()

    resp = api_client.delete(f"/api/subsets/{subset['id']}")
    assert resp.status_code == 200
    assert resp.json()["success"] is True

    listing = api_client.get("/api/subsets", params={"dataset_id": dataset_id}).json()
    assert subset["id"] not in [s["id"] for s in listing]


def test_delete_subset_not_found_404(api_client):
    resp = api_client.delete("/api/subsets/999999")
    assert resp.status_code == 404


# ------------------------------------------------------------------ #
# Duplication
# ------------------------------------------------------------------ #

def test_duplicate_subset_auto_numbered_name(api_client, tmp_path):
    dataset_id, image_ids = _make_dataset_with_images(api_client, tmp_path, n=2)
    original = api_client.post(
        "/api/subsets", json={"dataset_id": dataset_id, "name": "dup_base", "image_ids": image_ids}
    ).json()

    dup1 = api_client.post(f"/api/subsets/{original['id']}/duplicate", json={}).json()
    assert dup1["name"] == "dup_base_1"
    assert dup1["image_count"] == original["image_count"]

    dup2 = api_client.post(f"/api/subsets/{original['id']}/duplicate", json={}).json()
    assert dup2["name"] == "dup_base_2"


def test_duplicate_subset_custom_name(api_client, tmp_path):
    dataset_id, image_ids = _make_dataset_with_images(api_client, tmp_path, n=2)
    original = api_client.post(
        "/api/subsets", json={"dataset_id": dataset_id, "name": "src", "image_ids": image_ids}
    ).json()
    dup = api_client.post(
        f"/api/subsets/{original['id']}/duplicate", json={"name": "custom_copy"}
    ).json()
    assert dup["name"] == "custom_copy_1"


def test_duplicate_subset_not_found_404(api_client):
    resp = api_client.post("/api/subsets/999999/duplicate", json={})
    assert resp.status_code == 404


# ------------------------------------------------------------------ #
# Export vers Annotation App
# ------------------------------------------------------------------ #

def test_export_to_annotation_app_custom_path(api_client, tmp_path):
    dataset_id, image_ids = _make_dataset_with_images(api_client, tmp_path, n=2)
    subset = api_client.post(
        "/api/subsets", json={"dataset_id": dataset_id, "name": "export_me", "image_ids": image_ids}
    ).json()

    export_dir = tmp_path / "annot_export_target"
    resp = api_client.post(
        f"/api/subsets/{subset['id']}/export-to-annotation-app",
        json={"custom_export_path": str(export_dir)},
    )
    assert resp.status_code == 200

    exports = api_client.get(f"/api/subsets/{subset['id']}/exports").json()
    assert len(exports) == 1
    assert exports[0]["export_type"] == "copy"  # use_symlinks=False force en fixture


def test_export_to_annotation_app_not_found_404(api_client):
    resp = api_client.post("/api/subsets/999999/export-to-annotation-app", json={})
    assert resp.status_code == 404
