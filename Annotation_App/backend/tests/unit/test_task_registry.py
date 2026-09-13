# ============================================================
# Tests unitaires — backend/services/task_registry.py
# Registre en memoire (threading.Lock) : pas de reseau, pas de disque.
# Chaque test utilise un task_id unique (uuid) pour eviter les collisions,
# le registre etant un module-level dict partage entre tests.
# ============================================================

import uuid
import json

import pytest

from backend.services import task_registry as tr

pytestmark = pytest.mark.unit


def _tid() -> str:
    return f"test-{uuid.uuid4().hex[:8]}"


def test_create_task_initial_state():
    tid = _tid()
    task = tr.create_task(tid, "Mon traitement")
    assert task["status"] == "pending"
    assert task["progress"] == 0
    assert task["message"] == "Mon traitement"
    assert task["stop_requested"] is False
    assert task["pause_requested"] is False
    assert task["logs"] == []


def test_get_task_returns_none_for_unknown_id():
    assert tr.get_task(_tid()) is None


def test_get_task_excludes_logs_field():
    tid = _tid()
    tr.create_task(tid, "x")
    tr.append_log(tid, "une ligne", also_print=False)
    task = tr.get_task(tid)
    assert "logs" not in task


def test_get_task_excludes_internal_live_queue_and_is_json_serializable():
    tid = _tid()
    tr.create_task(tid, "x")
    tr.update_task(
        tid,
        status="running",
        progress=1,
        message="m",
        current_frame_id=12,
        live_frame={"frame_id": 12, "objects": []},
    )
    task = tr.get_task(tid)
    assert "live_frames_pending" not in task
    json.dumps(task)
    assert len(tr.drain_live_frames(tid)) == 1


def test_update_task_patches_fields():
    tid = _tid()
    tr.create_task(tid, "x")
    tr.update_task(tid, status="running", progress=42, message="en cours")
    task = tr.get_task(tid)
    assert task["status"] == "running"
    assert task["progress"] == 42
    assert task["message"] == "en cours"


def test_update_task_unknown_id_is_noop():
    # Ne doit pas lever d'exception meme si la tache n'existe pas.
    tr.update_task(_tid(), status="running", progress=1, message="x")


def test_update_task_current_frame_id_only_set_when_not_none():
    tid = _tid()
    tr.create_task(tid, "x")
    tr.update_task(tid, status="running", progress=1, message="m", current_frame_id=77)
    assert tr.get_task(tid)["current_frame_id"] == 77
    # Un appel ulterieur sans current_frame_id ne doit pas l'effacer.
    tr.update_task(tid, status="running", progress=2, message="m2")
    assert tr.get_task(tid)["current_frame_id"] == 77


def test_set_task_result_and_get_task():
    tid = _tid()
    tr.create_task(tid, "x")
    tr.set_task_result(tid, {"anomalies": 3})
    assert tr.get_task(tid)["result"] == {"anomalies": 3}


def test_set_task_result_unknown_id_is_noop():
    tr.set_task_result(_tid(), {"a": 1})  # ne doit pas lever


def test_delete_task_removes_it():
    tid = _tid()
    tr.create_task(tid, "x")
    tr.delete_task(tid)
    assert tr.get_task(tid) is None


def test_delete_task_unknown_id_is_noop():
    tr.delete_task(_tid())


def test_append_log_accumulates_and_timestamps():
    tid = _tid()
    tr.create_task(tid, "x")
    tr.append_log(tid, "premiere ligne", also_print=False)
    tr.append_log(tid, "deuxieme ligne", also_print=False)
    logs = tr.get_task_logs(tid)
    assert logs["next"] == 2
    assert len(logs["lines"]) == 2
    assert logs["lines"][0].endswith("premiere ligne")
    assert logs["lines"][0].startswith("[")  # horodatage


def test_append_log_unknown_task_is_noop():
    tr.append_log(_tid(), "ignoree", also_print=False)  # ne doit pas lever


def test_append_log_ring_buffer_caps_at_max_lines():
    tid = _tid()
    tr.create_task(tid, "x")
    for i in range(tr._MAX_LOG_LINES + 50):
        tr.append_log(tid, f"line {i}", also_print=False)
    logs = tr.get_task_logs(tid)
    assert len(logs["lines"]) == tr._MAX_LOG_LINES
    # Les plus anciennes lignes ont ete purgees, les plus recentes conservees.
    assert logs["lines"][-1].endswith(f"line {tr._MAX_LOG_LINES + 49}")


def test_get_task_logs_incremental_since():
    tid = _tid()
    tr.create_task(tid, "x")
    tr.append_log(tid, "a", also_print=False)
    tr.append_log(tid, "b", also_print=False)
    first = tr.get_task_logs(tid, since=0)
    assert first["next"] == 2
    tr.append_log(tid, "c", also_print=False)
    second = tr.get_task_logs(tid, since=first["next"])
    assert len(second["lines"]) == 1
    assert second["lines"][0].endswith("c")


def test_get_task_logs_unknown_task_returns_none():
    assert tr.get_task_logs(_tid()) is None


def test_get_task_logs_since_beyond_length_clamped():
    tid = _tid()
    tr.create_task(tid, "x")
    tr.append_log(tid, "a", also_print=False)
    logs = tr.get_task_logs(tid, since=999)
    assert logs["lines"] == []


def test_stop_pause_resume_flags():
    tid = _tid()
    tr.create_task(tid, "x")
    assert tr.is_stop_requested(tid) is False
    assert tr.is_pause_requested(tid) is False

    tr.request_pause(tid)
    assert tr.is_pause_requested(tid) is True

    tr.request_resume(tid)
    assert tr.is_pause_requested(tid) is False

    tr.request_stop(tid)
    assert tr.is_stop_requested(tid) is True
    # request_stop annule aussi une pause en cours
    assert tr.is_pause_requested(tid) is False


def test_stop_pause_unknown_task_is_noop():
    tid = _tid()
    tr.request_stop(tid)
    tr.request_pause(tid)
    tr.request_resume(tid)
    assert tr.is_stop_requested(tid) is False
    assert tr.is_pause_requested(tid) is False


def test_format_progress_bar_basic():
    bar = tr.format_progress_bar(5, 10)
    assert "50%" in bar
    assert "(5/10)" in bar


def test_format_progress_bar_zero_total_avoids_division_by_zero():
    bar = tr.format_progress_bar(0, 0)
    assert "(0/1)" in bar  # total force a 1 minimum


def test_format_progress_bar_clamps_done_to_total():
    bar = tr.format_progress_bar(999, 10)
    assert "100%" in bar
    assert "(10/10)" in bar


def test_format_progress_bar_with_fps_includes_eta():
    bar = tr.format_progress_bar(5, 10, fps=2.0)
    assert "fps" in bar
    assert "ETA" in bar


def test_format_progress_bar_with_extra_suffix():
    bar = tr.format_progress_bar(1, 2, extra="details")
    assert "details" in bar


def test_append_progress_prefixes_label():
    tid = _tid()
    tr.create_task(tid, "x")
    tr.append_progress(tid, "[Detect]", 3, 10)
    logs = tr.get_task_logs(tid)
    assert "[Detect]" in logs["lines"][0]
