import uuid

import pytest

from backend.services import task_registry


pytestmark = pytest.mark.api


def test_task_status_and_websocket_serialize_live_frame_queue(client):
    """Regression: the internal deque must never leak through the HTTP API."""
    task_id = f"api-live-{uuid.uuid4().hex[:8]}"
    task_registry.create_task(task_id, "Propagation")
    for frame_id in (2400, 2401):
        task_registry.update_task(
            task_id,
            status="running",
            progress=50,
            message=f"Frame {frame_id}",
            current_frame_id=frame_id,
            live_frame={
                "frame_id": frame_id,
                "native_path": rf"\\server\share\{frame_id}.jpg",
                "objects": [{"class_id": 1, "bbox": [0.5, 0.5, 0.1, 0.1]}],
            },
        )

    response = client.get(f"/api/tasks/{task_id}")
    assert response.status_code == 200
    assert "live_frames_pending" not in response.json()

    task_registry.update_task(
        task_id,
        status="completed",
        progress=100,
        message="Termine",
    )
    with client.websocket_connect(f"/ws/tasks/{task_id}") as websocket:
        update = websocket.receive_json()

    assert update["type"] == "update"
    assert update["status"] == "completed"
    assert [item["frame_id"] for item in update["live_frames"]] == [2400, 2401]
    assert update["live_frames"][0]["native_path"].startswith(r"\\server\share")

