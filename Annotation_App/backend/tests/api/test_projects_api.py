# ============================================================
# Tests API — backend/models/routers/projects.py
# CRUD projets, classes, session, backup/restore. TestClient + SQLite
# temporaire (voir conftest.py). Nominal + limites (404, valeurs invalides).
# ============================================================

import pytest

pytestmark = pytest.mark.unit


# ---------------------------------------------------------------- create / list / get

def test_create_project_minimal(client):
    resp = client.post("/api/projects", json={"name": "Projet minimal"})
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "Projet minimal"
    assert data["project_type"] == "image"
    assert data["frame_count"] == 0


def test_create_project_with_classes(client):
    resp = client.post("/api/projects", json={
        "name": "Projet avec classes",
        "project_type": "video",
        "classes": [
            {"name": "drone", "subclass": "quadcoptere", "subsubclass": "mavic"},
            {"name": "oiseau"},
        ],
    })
    assert resp.status_code == 201
    project_id = resp.json()["id"]

    classes = client.get(f"/api/projects/{project_id}/classes").json()
    assert len(classes) == 2
    assert classes[0]["name"] == "drone"
    assert classes[0]["subclass"] == "quadcoptere"
    assert classes[0]["subsubclass"] == "mavic"
    assert classes[0]["class_index"] == 0
    assert classes[1]["class_index"] == 1
    # Couleur auto-assignee quand non fournie
    assert classes[0]["color"].startswith("#")


def test_create_project_missing_name_returns_422(client):
    resp = client.post("/api/projects", json={"description": "sans nom"})
    assert resp.status_code == 422


def test_list_projects_includes_sequences_summary(client, make_project):
    project = make_project(name="Projet liste")
    resp = client.get("/api/projects")
    assert resp.status_code == 200
    ids = [p["id"] for p in resp.json()]
    assert project["id"] in ids
    found = next(p for p in resp.json() if p["id"] == project["id"])
    assert found["sequences"] == []


def test_get_project_not_found_returns_404(client):
    resp = client.get("/api/projects/999999999")
    assert resp.status_code == 404


def test_get_project_returns_classes_and_session(client, make_project):
    project = make_project(classes=[{"name": "voiture"}])
    resp = client.get(f"/api/projects/{project['id']}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == project["id"]
    assert len(data["classes"]) == 1
    assert data["session"]["selected_tool"] == "select"


def test_get_project_self_heals_frame_count(client, make_project, db_session):
    from backend.models.frame import Frame

    project = make_project()
    for i in range(3):
        db_session.add(Frame(project_id=project["id"], frame_index=i, filename=f"f{i}.jpg"))
    db_session.commit()

    resp = client.get(f"/api/projects/{project['id']}")
    assert resp.json()["frame_count"] == 3


# ---------------------------------------------------------------- update / delete

def test_update_project_partial(client, make_project):
    project = make_project(name="Original")
    resp = client.put(f"/api/projects/{project['id']}", json={"description": "nouvelle desc"})
    assert resp.status_code == 200

    fetched = client.get(f"/api/projects/{project['id']}").json()
    assert fetched["name"] == "Original"  # inchange
    assert fetched["description"] == "nouvelle desc"


def test_update_project_not_found_returns_404(client):
    resp = client.put("/api/projects/999999999", json={"name": "x"})
    assert resp.status_code == 404


def test_delete_project_removes_it(client, make_project):
    project = make_project(name="A supprimer")
    resp = client.delete(f"/api/projects/{project['id']}")
    assert resp.status_code == 200
    assert resp.json()["success"] is True

    assert client.get(f"/api/projects/{project['id']}").status_code == 404


def test_delete_project_not_found_returns_404(client):
    resp = client.delete("/api/projects/999999999")
    assert resp.status_code == 404


def test_delete_project_cascades_frames_and_annotations(client, make_project, db_session):
    from sqlmodel import select
    from backend.models.frame import Frame
    from backend.models.annotation import Annotation

    project = make_project(classes=[{"name": "x"}])
    frame = Frame(project_id=project["id"], frame_index=0, filename="f.jpg")
    db_session.add(frame)
    db_session.commit()
    db_session.refresh(frame)

    classes = client.get(f"/api/projects/{project['id']}/classes").json()
    client.post(f"/api/frames/{frame.id}/annotations", json={
        "class_id": classes[0]["id"], "cx": 0.5, "cy": 0.5, "width": 0.1, "height": 0.1,
    })

    client.delete(f"/api/projects/{project['id']}")

    remaining = db_session.exec(select(Frame).where(Frame.project_id == project["id"])).all()
    assert remaining == []
    remaining_anns = db_session.exec(
        select(Annotation).where(Annotation.frame_id == frame.id)
    ).all()
    assert remaining_anns == []


# ---------------------------------------------------------------- stats

def test_project_stats_empty_project(client, make_project):
    project = make_project(classes=[{"name": "a"}])
    resp = client.get(f"/api/projects/{project['id']}/stats")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total_frames"] == 0
    assert data["annotation_rate"] == 0.0
    assert len(data["classes_distribution"]) == 1
    assert data["classes_distribution"][0]["count"] == 0


def test_project_stats_not_found_returns_404(client):
    resp = client.get("/api/projects/999999999/stats")
    assert resp.status_code == 404


# ---------------------------------------------------------------- session state

def test_session_state_not_found_before_creation(client, make_project):
    # create_project cree deja une SessionState vide -> devrait exister.
    project = make_project()
    resp = client.get(f"/api/projects/{project['id']}/session")
    assert resp.status_code == 200


def test_session_state_get_unknown_project_returns_404(client):
    resp = client.get("/api/projects/999999999/session")
    assert resp.status_code == 404


def test_update_session_state(client, make_project):
    project = make_project()
    resp = client.put(f"/api/projects/{project['id']}/session", json={
        "current_frame_index": 5, "zoom_level": 2.0, "selected_tool": "bbox",
    })
    assert resp.status_code == 200

    fetched = client.get(f"/api/projects/{project['id']}/session").json()
    assert fetched["current_frame_index"] == 5
    assert fetched["zoom_level"] == 2.0
    assert fetched["selected_tool"] == "bbox"


def test_update_session_state_unknown_project_returns_404(client):
    resp = client.put("/api/projects/999999999/session", json={"current_frame_index": 1})
    assert resp.status_code == 404


# ---------------------------------------------------------------- classes CRUD

def test_create_class_appends_next_index(client, make_project):
    project = make_project(classes=[{"name": "a"}])
    resp = client.post(f"/api/projects/{project['id']}/classes", json={"name": "b"})
    assert resp.status_code == 201
    assert resp.json()["class_index"] == 1


def test_update_class_fields(client, make_project):
    project = make_project(classes=[{"name": "a"}])
    class_id = client.get(f"/api/projects/{project['id']}/classes").json()[0]["id"]
    resp = client.put(f"/api/projects/{project['id']}/classes/{class_id}", json={
        "name": "b", "color": "#000000",
    })
    assert resp.status_code == 200
    assert resp.json()["name"] == "b"
    assert resp.json()["color"] == "#000000"


def test_update_class_not_found_returns_404(client, make_project):
    project = make_project(classes=[{"name": "a"}])
    resp = client.put(f"/api/projects/{project['id']}/classes/999999999", json={"name": "x"})
    assert resp.status_code == 404


def test_update_class_wrong_project_returns_404(client, make_project):
    p1 = make_project(classes=[{"name": "a"}])
    p2 = make_project(classes=[{"name": "b"}])
    class_id_p1 = client.get(f"/api/projects/{p1['id']}/classes").json()[0]["id"]
    resp = client.put(f"/api/projects/{p2['id']}/classes/{class_id_p1}", json={"name": "x"})
    assert resp.status_code == 404


def test_delete_class(client, make_project):
    project = make_project(classes=[{"name": "a"}])
    class_id = client.get(f"/api/projects/{project['id']}/classes").json()[0]["id"]
    resp = client.delete(f"/api/projects/{project['id']}/classes/{class_id}")
    assert resp.status_code == 200
    assert client.get(f"/api/projects/{project['id']}/classes").json() == []


def test_delete_class_not_found_returns_404(client, make_project):
    project = make_project()
    resp = client.delete(f"/api/projects/{project['id']}/classes/999999999")
    assert resp.status_code == 404


# ---------------------------------------------------------------- LUT

def test_get_project_lut_defaults_to_none(client, make_project):
    project = make_project()
    resp = client.get(f"/api/projects/{project['id']}/lut")
    assert resp.status_code == 200
    data = resp.json()
    assert data["lut"] is None
    assert data["signature"] == "sig3"


def test_set_and_get_project_lut(client, make_project):
    project = make_project()
    resp = client.put(f"/api/projects/{project['id']}/lut", json={"mode": "minmax"})
    assert resp.status_code == 200
    assert resp.json()["signature"] == "mm"

    fetched = client.get(f"/api/projects/{project['id']}/lut").json()
    assert fetched["lut"]["mode"] == "minmax"


def test_set_project_lut_unknown_project_returns_404(client):
    resp = client.put("/api/projects/999999999/lut", json={"mode": "sigma"})
    assert resp.status_code == 404


# ---------------------------------------------------------------- backup / restore

def test_backup_and_restore_roundtrip(client, project_with_frame):
    ctx = project_with_frame
    project_id = ctx["project"]["id"]

    create = client.post(f"/api/frames/{ctx['frame_id']}/annotations", json={
        "class_id": ctx["class_id"], "cx": 0.4, "cy": 0.4, "width": 0.2, "height": 0.2,
    })
    assert create.status_code == 201

    backup = client.get(f"/api/projects/{project_id}/backup")
    assert backup.status_code == 200
    backup_data = backup.json()
    assert len(backup_data["frames"]) == 1
    assert len(backup_data["frames"][0]["annotations"]) == 1

    # Suppression puis restauration
    client.delete(f"/api/frames/{ctx['frame_id']}/annotations/all")
    assert client.get(f"/api/frames/{ctx['frame_id']}/annotations").json() == []

    restore = client.post(f"/api/projects/{project_id}/restore", json=backup_data)
    assert restore.status_code == 200
    assert restore.json()["restored_count"] == 1

    restored_anns = client.get(f"/api/frames/{ctx['frame_id']}/annotations").json()
    assert len(restored_anns) == 1
    assert restored_anns[0]["cx"] == pytest.approx(0.4)


def test_backup_unknown_project_returns_404(client):
    resp = client.get("/api/projects/999999999/backup")
    assert resp.status_code == 404


def test_restore_unknown_project_returns_404(client):
    resp = client.post("/api/projects/999999999/restore", json={"frames": [], "sequences": []})
    assert resp.status_code == 404
