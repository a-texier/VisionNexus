# ============================================================
# Tests API — backend/models/routers/dataset.py
# Import multipart d'images reelles (petits JPEG en memoire), listing des
# frames/sequences, service d'image, mark-empty, keyframe. Pas de video/optional_format
# (necessite cv2 VideoCapture / fichiers binaires plus lourds a simuler) :
# ces chemins restent couverts par les tests manuels documentes dans README.
# ============================================================

import io

import pytest
from PIL import Image

pytestmark = pytest.mark.unit


def _jpeg_bytes(size=(32, 24), color=(255, 0, 0)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, format="JPEG")
    return buf.getvalue()


def test_import_images_creates_sequence_and_frames(client, make_project):
    project = make_project()
    files = [
        ("files", ("a.jpg", _jpeg_bytes(), "image/jpeg")),
        ("files", ("b.jpg", _jpeg_bytes(color=(0, 255, 0)), "image/jpeg")),
    ]
    resp = client.post(
        f"/api/projects/{project['id']}/import/images",
        files=files,
        data={"sequence_name": "ma_sequence"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["frames_added"] == 2
    assert data["total_frames"] == 2

    sequences = client.get(f"/api/projects/{project['id']}/sequences").json()
    assert len(sequences) == 1
    assert sequences[0]["name"] == "ma_sequence"
    assert sequences[0]["frame_count"] == 2


def test_import_images_unknown_project_returns_404(client):
    resp = client.post(
        "/api/projects/999999999/import/images",
        files=[("files", ("a.jpg", _jpeg_bytes(), "image/jpeg"))],
    )
    assert resp.status_code == 404


def test_import_images_rejects_non_image_extension(client, make_project):
    project = make_project()
    resp = client.post(
        f"/api/projects/{project['id']}/import/images",
        files=[("files", ("not_image.txt", b"hello", "text/plain"))],
    )
    assert resp.status_code == 400


def test_list_frames_pagination_and_annotated_filter(client, make_project):
    project = make_project()
    files = [("files", (f"f{i}.jpg", _jpeg_bytes(), "image/jpeg")) for i in range(3)]
    client.post(f"/api/projects/{project['id']}/import/images", files=files)

    all_frames = client.get(f"/api/projects/{project['id']}/frames").json()
    assert len(all_frames) == 3

    page0 = client.get(f"/api/projects/{project['id']}/frames", params={"page": 0, "limit": 2}).json()
    assert len(page0) == 2

    none_annotated = client.get(
        f"/api/projects/{project['id']}/frames", params={"annotated_only": True}
    ).json()
    assert none_annotated == []


def test_list_frames_unknown_project_returns_404(client):
    resp = client.get("/api/projects/999999999/frames")
    assert resp.status_code == 404


def test_get_frame_detail(client, make_project):
    project = make_project()
    client.post(
        f"/api/projects/{project['id']}/import/images",
        files=[("files", ("a.jpg", _jpeg_bytes(), "image/jpeg"))],
    )
    frame_id = client.get(f"/api/projects/{project['id']}/frames").json()[0]["id"]

    resp = client.get(f"/api/frames/{frame_id}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == frame_id
    assert data["annotations"] == []
    assert data["image_url"] == f"/api/frames/{frame_id}/image"


def test_get_frame_not_found_returns_404(client):
    resp = client.get("/api/frames/999999999")
    assert resp.status_code == 404


def test_serve_frame_image_returns_actual_file(client, make_project):
    project = make_project()
    client.post(
        f"/api/projects/{project['id']}/import/images",
        files=[("files", ("a.jpg", _jpeg_bytes(size=(64, 48)), "image/jpeg"))],
    )
    frame_id = client.get(f"/api/projects/{project['id']}/frames").json()[0]["id"]

    resp = client.get(f"/api/frames/{frame_id}/image")
    assert resp.status_code == 200
    assert resp.headers["content-type"] in ("image/jpeg", "image/png")
    img = Image.open(io.BytesIO(resp.content))
    assert img.size == (64, 48)


def test_serve_frame_image_missing_frame_returns_404(client):
    resp = client.get("/api/frames/999999999/image")
    assert resp.status_code == 404


def test_serve_frame_image_placeholder_when_not_extracted(client, db_session, make_project):
    from backend.models.frame import Frame

    project = make_project()
    frame = Frame(
        project_id=project["id"], frame_index=0, filename="ghost.jpg",
        width=100, height=80, is_extracted=False,
    )
    db_session.add(frame)
    db_session.commit()
    db_session.refresh(frame)

    resp = client.get(f"/api/frames/{frame.id}/image")
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "image/jpeg"
    img = Image.open(io.BytesIO(resp.content))
    assert img.size == (100, 80)  # placeholder aux dimensions de la frame


def test_mark_frame_empty(client, project_with_frame):
    ctx = project_with_frame
    resp = client.post(f"/api/frames/{ctx['frame_id']}/mark-empty", params={"empty": True})
    assert resp.status_code == 200
    assert resp.json()["is_empty"] is True

    frame = client.get(f"/api/frames/{ctx['frame_id']}").json()
    assert frame["is_empty"] is True
    assert frame["is_annotated"] is True  # considere comme "traite"


def test_mark_frame_empty_not_found_returns_404(client):
    resp = client.post("/api/frames/999999999/mark-empty")
    assert resp.status_code == 404


def test_toggle_keyframe(client, project_with_frame):
    ctx = project_with_frame
    resp = client.put(f"/api/frames/{ctx['frame_id']}/keyframe", params={"is_keyframe": True})
    assert resp.status_code == 200
    assert resp.json()["is_keyframe"] is True

    frame = client.get(f"/api/frames/{ctx['frame_id']}").json()
    assert frame["is_keyframe"] is True

    resp2 = client.put(f"/api/frames/{ctx['frame_id']}/keyframe", params={"is_keyframe": False})
    assert resp2.json()["is_keyframe"] is False


def test_toggle_keyframe_not_found_returns_404(client):
    resp = client.put("/api/frames/999999999/keyframe")
    assert resp.status_code == 404


def test_list_sequences_unknown_project_returns_404(client):
    resp = client.get("/api/projects/999999999/sequences")
    assert resp.status_code == 404


def test_parse_sequence_manifest_missing_file_returns_400(client):
    resp = client.post("/api/sequences/parse-manifest", json={"path": "/no/such/file.txt"})
    assert resp.status_code == 400


def test_parse_sequence_manifest_parses_tab_separated_lines(tmp_path, client):
    manifest = tmp_path / "manifest.txt"
    manifest.write_text("/data/seq1\tSequence 1\n/data/seq2\tSequence 2\n", encoding="utf-8")
    resp = client.post("/api/sequences/parse-manifest", json={"path": str(manifest)})
    assert resp.status_code == 200
    rows = resp.json()["sequences"]
    assert rows == [
        {"source_path": "/data/seq1", "name": "Sequence 1"},
        {"source_path": "/data/seq2", "name": "Sequence 2"},
    ]
