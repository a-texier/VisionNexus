# ============================================================
# Tests API — backend/models/routers/export.py
# L'export tourne en BackgroundTasks : avec starlette TestClient, la tache
# de fond s'execute avant que la reponse ne soit rendue au test (execution
# synchrone sous ASGI transport), donc pas besoin de polling actif ici,
# mais on poll quand meme (boucle courte) pour rester robuste si ce
# comportement changeait.
# ============================================================

import io
import time
import zipfile

import pytest
from PIL import Image

pytestmark = pytest.mark.unit


def _jpeg_bytes(size=(16, 16), color=(10, 20, 30)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, format="JPEG")
    return buf.getvalue()


def _wait_export(client, task_id, timeout=10.0):
    deadline = time.time() + timeout
    status = None
    while time.time() < deadline:
        resp = client.get(f"/api/exports/{task_id}/status")
        assert resp.status_code == 200
        status = resp.json()
        if status["status"] in ("completed", "error"):
            return status
        time.sleep(0.05)
    raise AssertionError(f"Export not finished within {timeout}s: {status}")


def _project_with_annotated_image(client, make_project, output_format="ver", symlink=False):
    project = make_project(classes=[{"name": "voiture"}])
    client.post(
        f"/api/projects/{project['id']}/import/images",
        files=[("files", ("a.jpg", _jpeg_bytes(), "image/jpeg"))],
        data={"sequence_name": "seq1"},
    )
    frame_id = client.get(f"/api/projects/{project['id']}/frames").json()[0]["id"]
    class_id = client.get(f"/api/projects/{project['id']}/classes").json()[0]["id"]
    client.post(f"/api/frames/{frame_id}/annotations", json={
        "class_id": class_id, "cx": 0.5, "cy": 0.5, "width": 0.2, "height": 0.2,
    })
    return project


# ---------------------------------------------------------------- validation

def test_start_export_unknown_project_returns_404(client):
    resp = client.post("/api/projects/999999999/export", json={})
    assert resp.status_code == 404


def test_start_export_invalid_split_sum_returns_422(client, make_project):
    project = make_project(classes=[{"name": "a"}])
    resp = client.post(f"/api/projects/{project['id']}/export", json={
        "split_train": 0.5, "split_val": 0.5, "split_test": 0.5,
    })
    assert resp.status_code == 422


def test_start_export_no_classes_returns_400(client, make_project):
    resp = client.post("/api/projects/999999999/export", json={}, params={})
    assert resp.status_code == 404  # projet inconnu, verifie le garde-fou en premier

    empty_project = client.post("/api/projects", json={"name": "sans classes"}).json()
    resp2 = client.post(f"/api/projects/{empty_project['id']}/export", json={})
    assert resp2.status_code == 400


# ---------------------------------------------------------------- .ver export (pas de copie d'image)

def test_export_ver_format_completes_and_downloads_txt_free_zip(client, make_project):
    project = _project_with_annotated_image(client, make_project)

    resp = client.post(f"/api/projects/{project['id']}/export", json={
        "output_format": "ver", "symlink_images": False,
    })
    assert resp.status_code == 200
    task_id = resp.json()["task_id"]

    status = _wait_export(client, task_id)
    assert status["status"] == "completed", status
    assert status["ready"] is True


def test_export_status_unknown_task_returns_404(client):
    resp = client.get("/api/exports/unknown-task-id/status")
    assert resp.status_code == 404


def test_download_export_before_completion_state_unknown_task_returns_404(client):
    resp = client.get("/api/exports/unknown-task-id/download")
    assert resp.status_code == 404


# ---------------------------------------------------------------- yolo export (copie d'image reelle)

def test_export_yolo_format_with_copy_produces_zip(client, make_project):
    project = _project_with_annotated_image(client, make_project)

    resp = client.post(f"/api/projects/{project['id']}/export", json={
        "output_format": "yolo", "symlink_images": False,
    })
    assert resp.status_code == 200
    task_id = resp.json()["task_id"]

    status = _wait_export(client, task_id)
    assert status["status"] == "completed", status

    if status.get("zip_path"):
        download = client.get(f"/api/exports/{task_id}/download")
        assert download.status_code == 200
        assert download.headers["content-type"] == "application/zip"
        with zipfile.ZipFile(io.BytesIO(download.content)) as zf:
            assert len(zf.namelist()) > 0


# ---------------------------------------------------------------- preview

def test_export_preview_reports_class_stats(client, make_project):
    project = _project_with_annotated_image(client, make_project)
    resp = client.get(f"/api/projects/{project['id']}/export/preview")
    assert resp.status_code == 200
    data = resp.json()
    assert data is not None


def test_export_preview_unknown_project_returns_404(client):
    resp = client.get("/api/projects/999999999/export/preview")
    assert resp.status_code == 404
