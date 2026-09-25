"""Moteur d'entrainement dans un graphe : propagation Model -> Training,
coherence Optuna / Training, garde sur l'Inference, et GET /api/engines."""

import os

import pytest

os.environ.setdefault("ORCHESTRATOR_USER", "pytest")

from backend.core import graph_runner  # noqa: E402


def _node(nid: str, ntype: str, **data) -> dict:
    return {"id": nid, "type": ntype, "data": {"node_type": ntype, "label": nid, **data}}


def _graph(nodes: list[dict], edges: list[tuple[str, str]]) -> dict:
    return {
        "graph_id": "g-test",
        "name": "essai",
        "nodes": nodes,
        "edges": [{"id": f"{s}-{t}", "source": s, "target": t} for s, t in edges],
    }


def _step(graph: dict, suffix: str) -> dict:
    pipeline, _ = graph_runner.graph_to_pipeline(graph)
    return next(s.model_dump() for s in pipeline.steps if s.id.endswith(suffix))


def _dataset():
    return _node("ds", "dataset_source", dataset_name="d", dataset_path="C:/data/d")


def test_training_defaults_to_yolox_with_generic_values():
    graph = _graph([_dataset(), _node("t", "training", epochs=7, batch=4, imgsz=320, degrees=3.0)], [("ds", "t")])
    params = _step(graph, "__train")["params"]
    assert params["engine"] == "yolox" and params["model_size"] == ""
    assert (params["epochs"], params["batch"], params["imgsz"]) == (7, 4, 320)
    # Ancien graphe : cles YOLOX a plat, toujours transmises.
    assert params["hyperparams"]["degrees"] == 3.0


def test_node_hyperparams_dict_wins_over_legacy_flat_keys():
    graph = _graph(
        [_dataset(), _node("t", "training", engine="plugin-engine", degrees=3.0, hyperparams={"degrees": 9.0, "lr0": 0.02})],
        [("ds", "t")],
    )
    params = _step(graph, "__train")["params"]
    assert params["engine"] == "plugin-engine"
    assert params["hyperparams"] == {"degrees": 9.0, "lr0": 0.02}


def test_model_node_mismatch_is_blocked_before_training():
    graph = _graph(
        [
            _dataset(),
            _node("m", "model", engine="plugin-engine", model_size="plugin-small", model_path="C:/w/best.pt"),
            _node("t", "training", engine="yolox", model_size="yolox-s"),
        ],
        [("ds", "t"), ("m", "t")],
    )
    with pytest.raises(graph_runner.GraphConfigError, match="Blocking pre-check"):
        graph_runner.graph_to_pipeline(graph)


def test_model_node_imposes_missing_engine_and_size_on_training():
    graph = _graph(
        [
            _dataset(),
            _node("m", "model", engine="yolox", model_size="yolox-nano", model_path="C:/w/best.pth"),
            _node("t", "training", engine="yolox", model_size=""),
        ],
        [("ds", "t"), ("m", "t")],
    )
    params = _step(graph, "__train")["params"]
    assert params["engine"] == "yolox" and params["model_size"] == "yolox-nano"
    assert params["model_weights"].endswith("best.pth")


def test_optuna_and_training_must_share_the_engine():
    graph = _graph(
        [_dataset(), _node("o", "optuna", engine="yolox"), _node("t", "training", engine="plugin-engine")],
        [("ds", "o"), ("o", "t")],
    )
    with pytest.raises(graph_runner.GraphConfigError, match="same engine"):
        graph_runner.graph_to_pipeline(graph)


def test_optuna_step_carries_engine_and_lets_it_choose_defaults():
    graph = _graph(
        [_dataset(), _node("o", "optuna", engine="plugin-engine"), _node("t", "training", engine="plugin-engine")],
        [("ds", "o"), ("o", "t")],
    )
    params = _step(graph, "__hpo")["params"]
    assert params["engine"] == "plugin-engine"
    assert params["optimize"] == [] and params["model_size"] == ""


def test_manual_best_params_are_passed_whole_for_the_engine_to_filter():
    graph = _graph(
        [_dataset(), _node("o", "optuna", engine="plugin-engine", full_auto=False, best_params="lr0=0.02, mosaic=0.5"),
         _node("t", "training", engine="plugin-engine")],
        [("ds", "o"), ("o", "t")],
    )
    params = _step(graph, "__train")["params"]
    assert params["hyperparams"] == {"lr0": 0.02, "mosaic": 0.5}


def test_inference_refuses_weights_it_cannot_load_yet():
    graph = _graph(
        [_dataset(), _node("t", "training", engine="plugin-engine"), _node("i", "inference", task="detection")],
        [("ds", "t"), ("t", "i")],
    )
    with pytest.raises(graph_runner.GraphConfigError, match="same engine"):
        graph_runner.graph_to_pipeline(graph)


def test_inference_after_a_yolox_training_is_accepted():
    graph = _graph(
        [_dataset(), _node("t", "training", model_size="yolox-nano"), _node("i", "inference", task="detection")],
        [("ds", "t"), ("t", "i")],
    )
    params = _step(graph, "__evaluate")["params"]
    assert params["engine"] == "yolox"
    assert params["model_size"] == "yolox-nano"


def test_inference_architecture_mismatch_is_blocked():
    graph = _graph(
        [_dataset(), _node("t", "training", model_size="yolox-nano"),
         _node("i", "inference", task="detection", model_size="yolox-s")],
        [("ds", "t"), ("t", "i")],
    )
    with pytest.raises(graph_runner.GraphConfigError, match="architecture"):
        graph_runner.graph_to_pipeline(graph)


def test_engines_endpoint_falls_back_to_the_local_registry(monkeypatch, tmp_path):
    from fastapi.testclient import TestClient

    from backend.api import engines
    from backend.main import app

    monkeypatch.setitem(engines.APP_URLS, "Training_App", "http://127.0.0.1:9")  # rien n'ecoute
    monkeypatch.setenv("VISIONNEXUS_PLUGINS_DIR", str(tmp_path / "absent"))
    data = TestClient(app).get("/api/engines").json()
    assert data["source"] == "local"
    assert [e["name"] for e in data["engines"]] == ["yolox"]
    assert data["engines"][0]["catalog"]["sizes"]
