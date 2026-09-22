import os
import zipfile
from pathlib import Path

os.environ.setdefault("ORCHESTRATOR_USER", "pytest")


def test_published_lineage_excludes_failed_runs(monkeypatch):
    from backend.api import lineage
    from backend.core import run_manifest

    graph = {
        "graph_id": "graph-1",
        "name": "experiment",
        "nodes": [],
        "edges": [],
        "run_history": [
            {"run_id": "ok-run", "status": "done"},
            {"run_id": "bad-run", "status": "failed"},
        ],
        "run_lineage": {"ok-run": {}, "bad-run": {}},
    }
    monkeypatch.setattr(lineage.graph_store, "list_graphs", lambda: [graph])
    monkeypatch.setattr(lineage.insights_mod, "list_all", lambda: [])
    monkeypatch.setattr(lineage.insights_mod, "load", lambda *_: {})
    monkeypatch.setattr(run_manifest, "load", lambda *_: {})

    published = lineage.get_lineage(include_failed=False)
    audit = lineage.get_lineage(include_failed=True)

    published_ids = {n["data"].get("run_id") for n in published["nodes"] if n["type"] == "run"}
    audit_ids = {n["data"].get("run_id") for n in audit["nodes"] if n["type"] == "run"}
    assert published_ids == {"ok-run"}
    assert audit_ids == {"ok-run", "bad-run"}
    assert published["excluded_runs"] == [
        {"graph_id": "graph-1", "run_id": "bad-run", "status": "failed"}
    ]


def test_yolo_resolver_inspects_zip_content_instead_of_mtime(tmp_path):
    from backend.core.graph_runner import _resolve_yolo_dataset

    ver_zip = tmp_path / "project-ver.zip"
    yolo_zip = tmp_path / "project-yolo.zip"
    with zipfile.ZipFile(yolo_zip, "w") as archive:
        archive.writestr("project-yolo/data.yaml", "path: .")
    with zipfile.ZipFile(ver_zip, "w") as archive:
        archive.writestr("project-ver/sequence.ver", "# annotations")
    # Reproduit le bug : le VER est plus récent que le YOLO.
    os.utime(yolo_zip, (1, 1))
    os.utime(ver_zip, (2, 2))

    assert Path(_resolve_yolo_dataset("project", str(tmp_path))) == yolo_zip


def test_launcher_surfaces_process_exit_and_log_tail(monkeypatch, tmp_path):
    from backend.core import app_launcher

    class FakeProcess:
        def __init__(self, code):
            self.code = code

        def poll(self):
            return self.code

    log = tmp_path / "backend.log"
    log.write_text("initialisation\nModuleNotFoundError: optuna dependency\n", encoding="utf-8")
    session = app_launcher.AppSession(
        app_id="optuna",
        label="Optuna_App",
        backend_port=8063,
        frontend_port=3003,
        workspace=str(tmp_path),
        backend_pid=123,
        frontend_pid=124,
        backend_url="http://127.0.0.1:8063",
        frontend_url="http://localhost:3003",
        status="starting",
        launched_at="2026-08-31T00:00:00+00:00",
        backend_log=str(log),
    )
    monkeypatch.setattr(app_launcher, "_loaded", True)
    monkeypatch.setattr(app_launcher, "STATE_FILE", tmp_path / "launcher_state.json")
    monkeypatch.setattr(app_launcher, "_sessions", {"optuna": session})
    monkeypatch.setattr(
        app_launcher,
        "_processes",
        {"optuna": (FakeProcess(1), FakeProcess(None))},
    )

    state = app_launcher.get_all_sessions()["optuna"]
    assert state["status"] == "error"
    assert state["backend_exit_code"] == 1
    assert "ModuleNotFoundError" in state["failure_reason"]


def test_lost_in_memory_run_is_interrupted_not_silently_reset(monkeypatch):
    from backend.api import graphs

    graph = {
        "graph_id": "graph-lost",
        "status": "running",
        "active_run_id": "run-lost",
    }
    calls = []
    monkeypatch.setattr(graphs.pipeline_runner, "get_run_state", lambda _run_id: None)
    monkeypatch.setattr(
        graphs.graph_store,
        "stop_execution",
        lambda graph_id, run_id: calls.append((graph_id, run_id)),
    )

    graphs._sync_graph_from_run("graph-lost", graph)

    assert calls == [("graph-lost", "run-lost")]


def test_comparison_does_not_inherit_parent_hpo_result_from_fork_node():
    from backend.api.lineage import _comparison_snapshot

    graph = {
        "nodes": [{
            "data": {
                "node_type": "optuna",
                "n_trials": 5,
                "optimize": ["lr0"],
                "full_auto": True,
                "best_params": {"lr0": 0.001},
            }
        }]
    }
    comparison = _comparison_snapshot(
        graph,
        {},
        [{"kind": "optuna", "exists": False, "value": None}],
        [],
        model_path=None,
        map50=None,
    )

    assert comparison["hpo"]["best_params"] is None
