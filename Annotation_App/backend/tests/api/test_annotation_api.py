# ============================================================
# Tests API — backend/models/routers/annotation.py
# CRUD annotations, bulk, NMS, overlaps, interpolation, batch delete.
# ============================================================

import pytest

pytestmark = pytest.mark.unit


def _create_annotation(client, frame_id, class_id, **overrides):
    payload = {"class_id": class_id, "cx": 0.5, "cy": 0.5, "width": 0.1, "height": 0.1}
    payload.update(overrides)
    return client.post(f"/api/frames/{frame_id}/annotations", json=payload)


# ---------------------------------------------------------------- create / list

def test_create_annotation_nominal(client, project_with_frame):
    ctx = project_with_frame
    resp = _create_annotation(client, ctx["frame_id"], ctx["class_id"])
    assert resp.status_code == 201
    data = resp.json()
    assert data["cx"] == pytest.approx(0.5)
    assert data["annotation_type"] == "bbox"
    assert data["frame_id"] == ctx["frame_id"]


def test_create_annotation_frame_not_found_returns_404(client, project_with_frame):
    ctx = project_with_frame
    resp = _create_annotation(client, 999999999, ctx["class_id"])
    assert resp.status_code == 404


def test_create_annotation_invalid_class_returns_422(client, project_with_frame):
    ctx = project_with_frame
    resp = _create_annotation(client, ctx["frame_id"], 999999999)
    assert resp.status_code == 422


def test_create_annotation_out_of_bounds_returns_422(client, project_with_frame):
    ctx = project_with_frame
    resp = _create_annotation(client, ctx["frame_id"], ctx["class_id"], cx=1.5)
    assert resp.status_code == 422


def test_create_annotation_marks_frame_annotated(client, project_with_frame):
    ctx = project_with_frame
    _create_annotation(client, ctx["frame_id"], ctx["class_id"])
    project = client.get(f"/api/projects/{ctx['project']['id']}").json()
    assert project["annotated_count"] == 1


def test_create_polygon_annotation_with_points(client, project_with_frame):
    ctx = project_with_frame
    resp = _create_annotation(
        client, ctx["frame_id"], ctx["class_id"],
        annotation_type="polygon",
        points=[[0.1, 0.1], [0.2, 0.1], [0.2, 0.2]],
    )
    assert resp.status_code == 201
    assert resp.json()["points"] == [[0.1, 0.1], [0.2, 0.1], [0.2, 0.2]]


def test_list_annotations_for_frame(client, project_with_frame):
    ctx = project_with_frame
    _create_annotation(client, ctx["frame_id"], ctx["class_id"])
    _create_annotation(client, ctx["frame_id"], ctx["class_id"], cx=0.2)
    resp = client.get(f"/api/frames/{ctx['frame_id']}/annotations")
    assert resp.status_code == 200
    assert len(resp.json()) == 2


def test_list_annotations_frame_not_found_returns_404(client):
    resp = client.get("/api/frames/999999999/annotations")
    assert resp.status_code == 404


def test_list_all_project_annotations(client, project_with_frame):
    ctx = project_with_frame
    _create_annotation(client, ctx["frame_id"], ctx["class_id"])
    resp = client.get(f"/api/projects/{ctx['project']['id']}/annotations/all")
    assert resp.status_code == 200
    assert len(resp.json()) == 1


def test_list_all_project_annotations_unknown_project_returns_404(client):
    resp = client.get("/api/projects/999999999/annotations/all")
    assert resp.status_code == 404


# ---------------------------------------------------------------- update / delete

def test_update_annotation_moves_box_and_clears_auto_flag(client, project_with_frame):
    ctx = project_with_frame
    ann = _create_annotation(
        client, ctx["frame_id"], ctx["class_id"], is_auto=True, source_algorithm="grounding_dino",
    ).json()

    resp = client.put(f"/api/annotations/{ann['id']}", json={"cx": 0.7})
    assert resp.status_code == 200
    data = resp.json()
    assert data["cx"] == pytest.approx(0.7)
    assert data["is_auto"] is False
    assert data["is_interpolated"] is False


def test_update_annotation_not_found_returns_404(client):
    resp = client.put("/api/annotations/999999999", json={"cx": 0.1})
    assert resp.status_code == 404


def test_delete_annotation(client, project_with_frame):
    ctx = project_with_frame
    ann = _create_annotation(client, ctx["frame_id"], ctx["class_id"]).json()
    resp = client.delete(f"/api/annotations/{ann['id']}")
    assert resp.status_code == 200
    assert client.get(f"/api/frames/{ctx['frame_id']}/annotations").json() == []


def test_delete_annotation_not_found_returns_404(client):
    resp = client.delete("/api/annotations/999999999")
    assert resp.status_code == 404


def test_delete_annotation_unmarks_frame_when_last_removed(client, project_with_frame):
    ctx = project_with_frame
    ann = _create_annotation(client, ctx["frame_id"], ctx["class_id"]).json()
    client.delete(f"/api/annotations/{ann['id']}")
    project = client.get(f"/api/projects/{ctx['project']['id']}").json()
    assert project["annotated_count"] == 0


# ---------------------------------------------------------------- bulk

def test_bulk_create_annotations(client, project_with_frame):
    ctx = project_with_frame
    resp = client.post(f"/api/frames/{ctx['frame_id']}/annotations/bulk", json={
        "annotations": [
            {"class_id": ctx["class_id"], "cx": 0.2, "cy": 0.2, "width": 0.1, "height": 0.1},
            {"class_id": ctx["class_id"], "cx": 0.6, "cy": 0.6, "width": 0.1, "height": 0.1},
        ],
    })
    assert resp.status_code == 200
    assert resp.json()["created"] == 2
    assert len(client.get(f"/api/frames/{ctx['frame_id']}/annotations").json()) == 2


def test_bulk_create_with_replace_clears_existing(client, project_with_frame):
    ctx = project_with_frame
    _create_annotation(client, ctx["frame_id"], ctx["class_id"])

    resp = client.post(f"/api/frames/{ctx['frame_id']}/annotations/bulk", json={
        "annotations": [
            {"class_id": ctx["class_id"], "cx": 0.3, "cy": 0.3, "width": 0.1, "height": 0.1},
        ],
        "replace": True,
    })
    assert resp.status_code == 200
    remaining = client.get(f"/api/frames/{ctx['frame_id']}/annotations").json()
    assert len(remaining) == 1
    assert remaining[0]["cx"] == pytest.approx(0.3)


def test_bulk_create_skips_invalid_coordinates(client, project_with_frame):
    ctx = project_with_frame
    resp = client.post(f"/api/frames/{ctx['frame_id']}/annotations/bulk", json={
        "annotations": [
            {"class_id": ctx["class_id"], "cx": 2.0, "cy": 0.5, "width": 0.1, "height": 0.1},
        ],
    })
    assert resp.status_code == 200
    assert resp.json()["created"] == 0


def test_bulk_create_skips_unknown_class(client, project_with_frame):
    ctx = project_with_frame
    resp = client.post(f"/api/frames/{ctx['frame_id']}/annotations/bulk", json={
        "annotations": [
            {"class_id": 999999999, "cx": 0.5, "cy": 0.5, "width": 0.1, "height": 0.1},
        ],
    })
    assert resp.status_code == 200
    assert resp.json()["created"] == 0


def test_bulk_create_frame_not_found_returns_404(client, project_with_frame):
    ctx = project_with_frame
    resp = client.post("/api/frames/999999999/annotations/bulk", json={
        "annotations": [{"class_id": ctx["class_id"], "cx": 0.5, "cy": 0.5, "width": 0.1, "height": 0.1}],
    })
    assert resp.status_code == 404


def test_delete_all_frame_annotations(client, project_with_frame):
    ctx = project_with_frame
    _create_annotation(client, ctx["frame_id"], ctx["class_id"])
    _create_annotation(client, ctx["frame_id"], ctx["class_id"])
    resp = client.delete(f"/api/frames/{ctx['frame_id']}/annotations/all")
    assert resp.status_code == 200
    assert resp.json()["deleted_count"] == 2
    assert client.get(f"/api/frames/{ctx['frame_id']}/annotations").json() == []


def test_delete_all_frame_annotations_frame_not_found_returns_404(client):
    resp = client.delete("/api/frames/999999999/annotations/all")
    assert resp.status_code == 404


def test_delete_annotations_for_frames_empty_list_is_noop(client, project_with_frame):
    ctx = project_with_frame
    resp = client.post(f"/api/projects/{ctx['project']['id']}/annotations/delete-frames", json={
        "frame_ids": [],
    })
    assert resp.status_code == 200
    assert resp.json()["deleted_count"] == 0


def test_delete_annotations_for_frames_and_undo(client, project_with_frame):
    ctx = project_with_frame
    ann = _create_annotation(client, ctx["frame_id"], ctx["class_id"]).json()

    resp = client.post(f"/api/projects/{ctx['project']['id']}/annotations/delete-frames", json={
        "frame_ids": [ctx["frame_id"]],
    })
    assert resp.status_code == 200
    assert resp.json()["deleted_count"] == 1
    assert client.get(f"/api/frames/{ctx['frame_id']}/annotations").json() == []

    undo = client.post(f"/api/projects/{ctx['project']['id']}/annotations/undo-bulk-delete")
    assert undo.status_code == 200
    assert undo.json()["success"] is True
    assert undo.json()["restored"] == 1
    restored = client.get(f"/api/frames/{ctx['frame_id']}/annotations").json()
    assert len(restored) == 1
    assert restored[0]["cx"] == pytest.approx(ann["cx"])


def test_undo_bulk_delete_with_no_history_returns_false(client, project_with_frame):
    ctx = project_with_frame
    resp = client.post(f"/api/projects/{ctx['project']['id']}/annotations/undo-bulk-delete")
    assert resp.status_code == 200
    assert resp.json()["success"] is False


def test_redo_bulk_delete_with_no_history_returns_false(client, project_with_frame):
    ctx = project_with_frame
    resp = client.post(f"/api/projects/{ctx['project']['id']}/annotations/redo-bulk-delete")
    assert resp.status_code == 200
    assert resp.json()["success"] is False


# ---------------------------------------------------------------- copy-to

def test_copy_annotations_to_frames(client, project_with_frame, db_session):
    from backend.models.frame import Frame

    ctx = project_with_frame
    _create_annotation(client, ctx["frame_id"], ctx["class_id"])

    target = Frame(project_id=ctx["project"]["id"], frame_index=1, filename="f1.jpg")
    db_session.add(target)
    db_session.commit()
    db_session.refresh(target)

    resp = client.post(f"/api/frames/{ctx['frame_id']}/copy-to", json={
        "target_frame_ids": [target.id],
    })
    assert resp.status_code == 200
    assert resp.json()["copied_count"] == 1

    target_anns = client.get(f"/api/frames/{target.id}/annotations").json()
    assert len(target_anns) == 1
    assert target_anns[0]["is_auto"] is True


def test_copy_annotations_no_source_returns_zero(client, project_with_frame):
    ctx = project_with_frame
    resp = client.post(f"/api/frames/{ctx['frame_id']}/copy-to", json={"target_frame_ids": [123]})
    assert resp.status_code == 200
    assert resp.json()["copied_count"] == 0


# ---------------------------------------------------------------- overlaps

def test_detect_overlaps_finds_duplicate_boxes(client, project_with_frame):
    ctx = project_with_frame
    _create_annotation(client, ctx["frame_id"], ctx["class_id"], cx=0.5, cy=0.5, width=0.2, height=0.2)
    _create_annotation(client, ctx["frame_id"], ctx["class_id"], cx=0.51, cy=0.51, width=0.2, height=0.2)

    resp = client.get(f"/api/frames/{ctx['frame_id']}/overlaps", params={"iou_threshold": 0.5})
    assert resp.status_code == 200
    overlaps = resp.json()
    assert len(overlaps) == 1
    assert overlaps[0]["same_class"] is True


def test_detect_overlaps_less_than_two_annotations_returns_empty(client, project_with_frame):
    ctx = project_with_frame
    _create_annotation(client, ctx["frame_id"], ctx["class_id"])
    resp = client.get(f"/api/frames/{ctx['frame_id']}/overlaps")
    assert resp.json() == []


# ---------------------------------------------------------------- NMS

def test_apply_nms_removes_duplicate_low_confidence_box(client, project_with_frame):
    ctx = project_with_frame
    _create_annotation(client, ctx["frame_id"], ctx["class_id"], cx=0.5, cy=0.5, width=0.2, height=0.2, confidence=0.9)
    _create_annotation(client, ctx["frame_id"], ctx["class_id"], cx=0.5, cy=0.5, width=0.2, height=0.2, confidence=0.4)

    resp = client.post(f"/api/frames/{ctx['frame_id']}/annotations/nms", json={"iou_threshold": 0.5})
    assert resp.status_code == 200
    data = resp.json()
    assert data["deleted_count"] == 1
    assert data["remaining_count"] == 1

    remaining = client.get(f"/api/frames/{ctx['frame_id']}/annotations").json()
    assert remaining[0]["confidence"] == pytest.approx(0.9)


def test_apply_nms_keeps_distinct_boxes(client, project_with_frame):
    ctx = project_with_frame
    _create_annotation(client, ctx["frame_id"], ctx["class_id"], cx=0.1, cy=0.1, width=0.05, height=0.05)
    _create_annotation(client, ctx["frame_id"], ctx["class_id"], cx=0.9, cy=0.9, width=0.05, height=0.05)

    resp = client.post(f"/api/frames/{ctx['frame_id']}/annotations/nms", json={"iou_threshold": 0.5})
    assert resp.json()["deleted_count"] == 0


def test_apply_nms_frame_not_found_returns_404(client):
    resp = client.post("/api/frames/999999999/annotations/nms", json={"iou_threshold": 0.5})
    assert resp.status_code == 404


def test_apply_nms_same_class_only_ignores_cross_class_overlap(client, project_with_frame):
    ctx = project_with_frame
    project_id = ctx["project"]["id"]
    other_class = client.post(f"/api/projects/{project_id}/classes", json={"name": "autre"}).json()

    _create_annotation(client, ctx["frame_id"], ctx["class_id"], cx=0.5, cy=0.5, width=0.2, height=0.2)
    _create_annotation(client, ctx["frame_id"], other_class["id"], cx=0.5, cy=0.5, width=0.2, height=0.2)

    resp = client.post(f"/api/frames/{ctx['frame_id']}/annotations/nms", json={
        "iou_threshold": 0.1, "same_class_only": True,
    })
    assert resp.json()["deleted_count"] == 0  # classes differentes -> pas de suppression


# ---------------------------------------------------------------- validate

def test_validate_annotations_reports_no_errors_for_valid_project(client, project_with_frame):
    ctx = project_with_frame
    _create_annotation(client, ctx["frame_id"], ctx["class_id"])
    resp = client.get(f"/api/projects/{ctx['project']['id']}/annotations/validate")
    assert resp.status_code == 200
    data = resp.json()
    assert data["valid"] is True
    assert data["error_count"] == 0


def test_validate_annotations_flags_too_small_boxes(client, project_with_frame, db_session):
    from backend.models.annotation import Annotation

    ctx = project_with_frame
    db_session.add(Annotation(
        frame_id=ctx["frame_id"], class_id=ctx["class_id"],
        cx=0.5, cy=0.5, width=0.0001, height=0.0001,
    ))
    db_session.commit()

    resp = client.get(f"/api/projects/{ctx['project']['id']}/annotations/validate")
    data = resp.json()
    assert data["warning_count"] == 1
    assert data["warnings"][0]["type"] == "too_small"


# ---------------------------------------------------------------- interpolate

def test_interpolate_annotations_fills_intermediate_frames(client, project_with_frame, db_session):
    from backend.models.frame import Frame

    ctx = project_with_frame
    project_id = ctx["project"]["id"]

    frames = [ctx["frame_id"]]
    for i in range(1, 4):
        f = Frame(project_id=project_id, frame_index=i, filename=f"f{i}.jpg")
        db_session.add(f)
        db_session.commit()
        db_session.refresh(f)
        frames.append(f.id)

    start_resp = _create_annotation(client, frames[0], ctx["class_id"], cx=0.1, cy=0.1, width=0.1, height=0.1)
    end_resp = _create_annotation(client, frames[-1], ctx["class_id"], cx=0.9, cy=0.9, width=0.1, height=0.1)
    assert start_resp.status_code == 201
    assert end_resp.status_code == 201

    resp = client.post(f"/api/projects/{project_id}/interpolate", json={
        "start_frame_id": frames[0], "end_frame_id": frames[-1],
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["interpolated_count"] == 2
    assert data["frames_filled"] == 2

    mid_anns = client.get(f"/api/frames/{frames[1]}/annotations").json()
    assert len(mid_anns) == 1
    assert mid_anns[0]["is_interpolated"] is True


def test_interpolate_annotations_requires_annotated_endpoints(client, project_with_frame, db_session):
    from backend.models.frame import Frame

    ctx = project_with_frame
    project_id = ctx["project"]["id"]
    empty_frame = Frame(project_id=project_id, frame_index=1, filename="empty.jpg")
    db_session.add(empty_frame)
    db_session.commit()
    db_session.refresh(empty_frame)

    resp = client.post(f"/api/projects/{project_id}/interpolate", json={
        "start_frame_id": ctx["frame_id"], "end_frame_id": empty_frame.id,
    })
    assert resp.status_code == 400


def test_interpolate_annotations_start_after_end_returns_400(client, project_with_frame, db_session):
    from backend.models.frame import Frame

    ctx = project_with_frame
    project_id = ctx["project"]["id"]
    earlier = Frame(project_id=project_id, frame_index=-1, filename="earlier.jpg")
    db_session.add(earlier)
    db_session.commit()
    db_session.refresh(earlier)

    _create_annotation(client, ctx["frame_id"], ctx["class_id"])
    _create_annotation(client, earlier.id, ctx["class_id"])

    resp = client.post(f"/api/projects/{project_id}/interpolate", json={
        "start_frame_id": ctx["frame_id"], "end_frame_id": earlier.id,
    })
    assert resp.status_code == 400


# ---------------------------------------------------------------- summary / batch delete / from-frame

def test_annotations_summary_filters_by_confidence(client, project_with_frame):
    ctx = project_with_frame
    _create_annotation(client, ctx["frame_id"], ctx["class_id"], confidence=0.9)
    _create_annotation(client, ctx["frame_id"], ctx["class_id"], confidence=0.2)

    resp = client.get(f"/api/projects/{ctx['project']['id']}/annotations/summary", params={
        "min_confidence": 0.5,
    })
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["confidence"] == pytest.approx(0.9)


def test_annotations_summary_filters_by_source(client, project_with_frame):
    ctx = project_with_frame
    _create_annotation(client, ctx["frame_id"], ctx["class_id"], source_algorithm="grounding_dino")
    _create_annotation(client, ctx["frame_id"], ctx["class_id"], source_algorithm="manual")

    resp = client.get(f"/api/projects/{ctx['project']['id']}/annotations/summary", params={
        "source_filter": "grounding_dino",
    })
    data = resp.json()
    assert len(data) == 1
    assert data[0]["source_algorithm"] == "grounding_dino"


def test_batch_delete_annotations(client, project_with_frame):
    ctx = project_with_frame
    a1 = _create_annotation(client, ctx["frame_id"], ctx["class_id"]).json()
    a2 = _create_annotation(client, ctx["frame_id"], ctx["class_id"]).json()

    resp = client.request(
        "DELETE", f"/api/projects/{ctx['project']['id']}/annotations/batch",
        json={"annotation_ids": [a1["id"], a2["id"]]},
    )
    assert resp.status_code == 200
    assert resp.json()["deleted_count"] == 2
    assert client.get(f"/api/frames/{ctx['frame_id']}/annotations").json() == []


def test_batch_delete_annotations_empty_list_is_noop(client, project_with_frame):
    ctx = project_with_frame
    resp = client.request(
        "DELETE", f"/api/projects/{ctx['project']['id']}/annotations/batch",
        json={"annotation_ids": []},
    )
    assert resp.status_code == 200
    assert resp.json()["deleted_count"] == 0


def test_batch_delete_ignores_annotations_from_other_project(client, project_with_frame, make_project):
    ctx = project_with_frame
    ann = _create_annotation(client, ctx["frame_id"], ctx["class_id"]).json()

    other_project = make_project()
    resp = client.request(
        "DELETE", f"/api/projects/{other_project['id']}/annotations/batch",
        json={"annotation_ids": [ann["id"]]},
    )
    assert resp.json()["deleted_count"] == 0
    # L'annotation appartient toujours au projet d'origine
    assert len(client.get(f"/api/frames/{ctx['frame_id']}/annotations").json()) == 1


def test_delete_annotations_from_frame_onward(client, project_with_frame, db_session):
    from backend.models.frame import Frame

    ctx = project_with_frame
    project_id = ctx["project"]["id"]
    later = Frame(project_id=project_id, frame_index=5, filename="later.jpg")
    db_session.add(later)
    db_session.commit()
    db_session.refresh(later)

    _create_annotation(client, ctx["frame_id"], ctx["class_id"])
    _create_annotation(client, later.id, ctx["class_id"])

    resp = client.request(
        "DELETE", f"/api/projects/{project_id}/annotations/from-frame",
        params={"from_frame_index": 5},
    )
    assert resp.status_code == 200
    assert resp.json()["deleted_count"] == 1
    # La frame 0 garde son annotation, la frame 5 est nettoyee
    assert len(client.get(f"/api/frames/{ctx['frame_id']}/annotations").json()) == 1
    assert client.get(f"/api/frames/{later.id}/annotations").json() == []


def test_delete_annotations_from_frame_with_source_filter(client, project_with_frame):
    ctx = project_with_frame
    _create_annotation(client, ctx["frame_id"], ctx["class_id"], source_algorithm="manual")
    _create_annotation(client, ctx["frame_id"], ctx["class_id"], source_algorithm="grounding_dino")

    resp = client.request(
        "DELETE", f"/api/projects/{ctx['project']['id']}/annotations/from-frame",
        params={"from_frame_index": 0, "source_filter": "grounding_dino"},
    )
    assert resp.json()["deleted_count"] == 1
    remaining = client.get(f"/api/frames/{ctx['frame_id']}/annotations").json()
    assert len(remaining) == 1
    assert remaining[0]["source_algorithm"] == "manual"
