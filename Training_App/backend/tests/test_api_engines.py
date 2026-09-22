"""API Training_App face aux moteurs : capacites, catalogues, refus avant
lancement, plots par moteur, historique, et (slow) un vrai run par moteur."""

import os
import sys
import tempfile
import time
from pathlib import Path

import cv2
import numpy as np
import pytest

# Workspace isole AVANT l'import de backend.config (lu a l'import).
_WORKSPACE = Path(tempfile.mkdtemp(prefix="vn_training_api_")) / "workspace"
os.environ["TRAINING_APP_WORKSPACE"] = str(_WORKSPACE)
os.environ["TRAINING_APP_USER"] = "pytest"
os.environ.pop("IA_MLFLOW_TRACKING_URI", None)

_APP_ROOT = Path(__file__).resolve().parents[2]
_REPO_ROOT = _APP_ROOT.parent
sys.path.insert(0, str(_APP_ROOT))

from fastapi.testclient import TestClient  # noqa: E402
from sqlmodel import Session  # noqa: E402

from backend.config import RUNS_DIR  # noqa: E402
from backend.database import engine as db_engine  # noqa: E402
from backend.main import app  # noqa: E402
from backend.models.training_run import TrainingRun  # noqa: E402
from backend.services import trainer_backend  # noqa: E402

_PLUGINS_DIR = _REPO_ROOT / "plugins"


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture
def no_plugins(tmp_path, monkeypatch):
    monkeypatch.setenv("VISIONNEXUS_PLUGINS_DIR", str(tmp_path / "absent"))


def _write_dataset(root: Path, n_images: int = 8) -> Path:
    img_dir = root / "images" / "train"
    lbl_dir = root / "labels" / "train"
    img_dir.mkdir(parents=True)
    lbl_dir.mkdir(parents=True)
    for i in range(n_images):
        img = np.full((100, 200, 3), 30 + i, dtype=np.uint8)
        cv2.rectangle(img, (40, 20), (160, 80), (200, 200, 200), -1)
        cv2.imwrite(str(img_dir / f"{i:06d}.jpg"), img)
        (lbl_dir / f"{i:06d}.txt").write_text("0 0.5 0.5 0.6 0.6\n", encoding="utf-8")
    data_yaml = root / "data.yaml"
    data_yaml.write_text(
        "path: .\ntrain: images/train\nval: images/train\nnames:\n  0: person\n",
        encoding="utf-8",
    )
    return data_yaml


def _add_run(run_name: str, engine: str, **fields) -> None:
    with Session(db_engine) as db:
        db.add(TrainingRun(run_name=run_name, engine=engine, **fields))
        db.commit()


def _wait_done(client, run_name: str, timeout_s: float = 600) -> dict:
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        status = client.get(f"/api/training/{run_name}/status").json()
        if status["status"] in ("done", "error", "stopped"):
            return status
        time.sleep(1.0)
    raise AssertionError(f"run {run_name} pas termine en {timeout_s}s")


def _mlflow_plots(run_name: str) -> list[str]:
    store = _WORKSPACE.parent / "mlflow_pytest"
    return sorted(p.name for p in store.rglob("plots/*") if p.is_file())


# -- Capacites et catalogues -------------------------------------------------

def test_capabilities_without_plugin_offers_only_yolox(client, no_plugins):
    data = client.get("/api/capabilities").json()
    assert [b["name"] for b in data["trainer_backends"]] == ["yolox"]
    assert data["trainer_backends"][0]["catalog"]["label"] == "YOLOX"
    assert data["active"] == "yolox"


def test_models_endpoint_returns_engine_catalog(client, no_plugins):
    data = client.get("/api/training/models", params={"engine": "yolox"}).json()
    assert data["engine"] == "yolox"
    assert "yolox-s" in data["sizes"] and data["defaults"]["max_epoch"] == 300
    assert data["groups"] and data["hpo_ranges"]
    assert client.get("/api/training/models", params={"engine": "inexistant"}).status_code == 404


# -- Refus avant lancement ---------------------------------------------------

def test_start_refuses_unknown_engine(client, no_plugins, tmp_path):
    data_yaml = _write_dataset(tmp_path / "ds")
    r = client.post("/api/training/start", json={"engine": "inexistant", "data_yaml": str(data_yaml)})
    assert r.status_code == 400 and "introuvable" in r.json()["detail"]


def test_start_refuses_size_of_another_engine(client, no_plugins, tmp_path):
    data_yaml = _write_dataset(tmp_path / "ds")
    r = client.post("/api/training/start", json={"engine": "yolox", "model_size": "yolo11n", "data_yaml": str(data_yaml)})
    assert r.status_code == 400 and "model_size" in r.json()["detail"]


def test_start_refuses_weights_of_another_engine(client, no_plugins, tmp_path):
    data_yaml = _write_dataset(tmp_path / "ds")
    r = client.post("/api/training/start", json={
        "engine": "yolox", "model_size": "yolox-s", "model_weights": "C:/runs/best.pt", "data_yaml": str(data_yaml),
    })
    assert r.status_code == 400 and ".pth" in r.json()["detail"]


def test_orchestrator_train_refuses_before_creating_a_run(client, no_plugins, tmp_path):
    data_yaml = _write_dataset(tmp_path / "ds")
    before = len(client.get("/api/training/runs").json())
    r = client.post("/api/orchestrator/train", json={
        "engine": "inexistant", "data_yaml": str(data_yaml), "epochs": 1,
    })
    assert r.status_code == 400
    assert len(client.get("/api/training/runs").json()) == before


# -- Plots selon le moteur du run --------------------------------------------

def test_artifacts_follow_the_run_engine(client, no_plugins):
    run_dir = RUNS_DIR / "pytest_yolox_plots"
    (run_dir / "artifacts").mkdir(parents=True, exist_ok=True)
    for name in ("confusion_matrix.png", "PR_curve.png", "train_batch0.jpg", "train_batch1.jpg"):
        (run_dir / "artifacts" / name).write_bytes(b"x")
    (run_dir / "results.png").write_bytes(b"x")  # pas un plot YOLOX : ignore
    _add_run("pytest_yolox_plots", "yolox")

    data = client.get("/api/training/pytest_yolox_plots/artifacts").json()
    assert data["engine"] == "yolox"
    assert data["confusion"] == ["artifacts/confusion_matrix.png"]
    assert data["curves"] == ["artifacts/PR_curve.png"]
    assert data["train_batches"] == ["artifacts/train_batch0.jpg", "artifacts/train_batch1.jpg"]
    assert "summary" not in data


def test_artifacts_of_a_run_whose_engine_is_gone(client, no_plugins):
    (RUNS_DIR / "pytest_orphan").mkdir(parents=True, exist_ok=True)
    _add_run("pytest_orphan", "moteur_retire")
    data = client.get("/api/training/pytest_orphan/artifacts").json()
    assert "moteur_retire" in data["engine_error"]


def test_get_artifact_serves_images_inside_run_dir_only(client):
    run_dir = RUNS_DIR / "pytest_serve"
    run_dir.mkdir(parents=True, exist_ok=True)
    (run_dir / "results.png").write_bytes(b"\x89PNG")
    (run_dir / "args.yaml").write_text("x: 1", encoding="utf-8")

    assert client.get("/api/training/pytest_serve/artifact/results.png").status_code == 200
    assert client.get("/api/training/pytest_serve/artifact/args.yaml").status_code == 400
    assert client.get("/api/training/pytest_serve/artifact/..%2F..%2Ftraining.db").status_code in (400, 404)
    assert client.get("/api/training/pytest_serve/artifact/absent.png").status_code == 404


def test_metrics_history_reads_both_column_conventions(client):
    for run_name, header, row in (
        ("pytest_hist_a", "epoch,iou_loss,cls_loss,metrics/mAP50(B)", "1,0.5,0.4,0.25"),
        ("pytest_hist_b", "epoch,train/box_loss,train/cls_loss,metrics/mAP50(B)", "1,0.6,0.3,0.5"),
    ):
        run_dir = RUNS_DIR / run_name
        run_dir.mkdir(parents=True, exist_ok=True)
        (run_dir / "results.csv").write_text(f"{header}\n{row}\n", encoding="utf-8")

    a = client.get("/api/training/pytest_hist_a/metrics-history").json()["epochs"][0]
    b = client.get("/api/training/pytest_hist_b/metrics-history").json()["epochs"][0]
    assert (a["box_loss"], a["map50"]) == (0.5, 0.25)
    assert (b["box_loss"], b["cls_loss"], b["map50"]) == (0.6, 0.3, 0.5)


# -- Vrais runs (slow) -------------------------------------------------------

@pytest.mark.slow
def test_yolox_run_end_to_end(client, no_plugins, tmp_path):
    data_yaml = _write_dataset(tmp_path / "ds")
    r = client.post("/api/training/start", json={
        "engine": "yolox", "model_size": "yolox-nano", "data_yaml": str(data_yaml),
        "hyperparams": {
            "max_epoch": 1, "imgsz": 64, "batch_size": 2, "data_num_workers": 0, "device": "cpu",
            "eval_interval": 1, "warmup_epochs": 0, "no_aug_epochs": 0, "lr0": 0.1,
        },
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["engine"] == "yolox" and body["ignored_hyperparams"] == ["lr0"]

    status = _wait_done(client, body["run_name"])
    assert status["status"] == "done", status["error_message"]
    assert status["engine"] == "yolox"
    assert status["best_model_path"].endswith(".pth")

    arts = client.get(f"/api/training/{body['run_name']}/artifacts").json()
    assert arts["confusion"] and arts["curves"] and arts["val_predictions"]
    assert client.get(f"/api/training/{body['run_name']}/metrics-history").json()["epochs"]
    assert "confusion_matrix.png" in _mlflow_plots(body["run_name"])


def _ultralytics_available() -> bool:
    return any(
        b["name"] == "ultralytics" and b["available"]
        for b in trainer_backend.describe_backends()
    )


@pytest.mark.slow
def test_ultralytics_run_end_to_end(client, tmp_path, monkeypatch):
    monkeypatch.setenv("VISIONNEXUS_PLUGINS_DIR", str(_PLUGINS_DIR))
    if not _ultralytics_available():
        pytest.skip("plugin Ultralytics absent ou bibliotheque non installee")
    weights = _REPO_ROOT / "yolov8n.pt"
    if not weights.is_file():
        pytest.skip("poids yolov8n.pt absents (pas de telechargement dans les tests)")
    monkeypatch.chdir(tmp_path)  # un store MLflow parasite apparaitrait ici

    data_yaml = _write_dataset(tmp_path / "ds")
    caps = client.get("/api/capabilities").json()
    assert {"yolox", "ultralytics"} <= {b["name"] for b in caps["trainer_backends"] if b["available"]}

    r = client.post("/api/training/start", json={
        "engine": "ultralytics", "model_size": "yolov8n", "model_weights": str(weights),
        "data_yaml": str(data_yaml),
        "hyperparams": {
            "epochs": 2, "imgsz": 64, "batch": 4, "workers": 0, "device": "cpu", "amp": False,
            "basic_lr_per_img": 0.001,
        },
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["engine"] == "ultralytics" and body["ignored_hyperparams"] == ["basic_lr_per_img"]

    status = _wait_done(client, body["run_name"])
    assert status["status"] == "done", status["error_message"]
    assert status["engine"] == "ultralytics"
    assert status["best_model_path"].endswith(".pt")
    assert status["total_epochs"] == 2 and status["current_epoch"] == 2

    arts = client.get(f"/api/training/{body['run_name']}/artifacts").json()
    assert arts["summary"] == ["results.png"]
    assert arts["confusion"][0] == "confusion_matrix_normalized.png"
    assert "BoxPR_curve.png" in arts["curves"]
    assert arts["val_predictions"] and arts["train_batches"]
    assert client.get(f"/api/training/{body['run_name']}/artifact/results.png").status_code == 200

    history = client.get(f"/api/training/{body['run_name']}/metrics-history").json()["epochs"]
    assert len(history) == 2 and history[0]["box_loss"] is not None

    cases = client.get(f"/api/training/{body['run_name']}/inference-cases", params={"top_k": 1})
    assert cases.status_code == 200, cases.text
    assert cases.json()["n_images_scored"] == 8

    plots = _mlflow_plots(body["run_name"])
    assert "results.png" in plots and "BoxPR_curve.png" in plots
    assert not (tmp_path / "runs" / "mlflow").exists()
