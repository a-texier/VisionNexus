"""Moteur "ultralytics" : conformite du catalogue au contrat de Training_App,
preparation du dataset, arguments d'entrainement, et (slow) un vrai run
court : metriques par epoque, plots natifs, arret propre, predicteur."""

import os
import sys
import threading
from pathlib import Path
from types import SimpleNamespace

import cv2
import numpy as np
import pytest
import yaml

_REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(_REPO_ROOT / "plugins"))
sys.path.insert(0, str(_REPO_ROOT / "Training_App" / "backend"))

from services.run_artifacts import collect_artifacts  # noqa: E402
from services.trainer_backend import CATALOG_KEYS  # noqa: E402
from visionnexus_ultralytics import PLUGIN  # noqa: E402
from visionnexus_ultralytics import trainer as ul  # noqa: E402
from visionnexus_ultralytics.catalog import CATALOG  # noqa: E402


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


# -- Manifeste et catalogue --------------------------------------------------

def test_manifest_declares_the_trainer_extension():
    target = PLUGIN["extensions"]["visionnexus.trainer_backends"]["ultralytics"]
    assert target == "visionnexus_ultralytics.trainer:UltralyticsEngine"
    assert ul.UltralyticsEngine.CATALOG is CATALOG


def test_manifest_declares_the_detector_extension():
    target = PLUGIN["extensions"]["visionnexus.detector_backends"]["ultralytics"]
    assert target == "visionnexus_ultralytics.detector:UltralyticsDetector"


def test_catalog_honours_the_engine_contract():
    for key in CATALOG_KEYS:
        assert key in CATALOG, key
    defaults = CATALOG["defaults"]
    assert CATALOG["default_size"] in CATALOG["sizes"]
    assert CATALOG["weights_suffixes"] == [".pt"]
    for group in CATALOG["groups"]:
        for field in group["params"]:
            assert field["key"] in defaults, field["key"]
    for name, spec in CATALOG["hpo_ranges"].items():
        assert name in defaults, name
        assert spec["low"] < spec["high"], name
    assert set(CATALOG["hpo_default_optimize"]) <= set(CATALOG["hpo_ranges"])
    assert set(CATALOG["keys"].values()) <= set(defaults)


def test_catalog_does_not_reuse_yolox_names():
    # Deux moteurs, deux jeux de cles : la separation evite qu'un best_params
    # YOLOX soit applique tel quel a ce moteur.
    assert not {"max_epoch", "basic_lr_per_img", "batch_size", "mosaic_prob"} & set(CATALOG["defaults"])
    assert not any(size.startswith("yolox") for size in CATALOG["sizes"])


def test_importing_the_engine_module_does_not_import_the_library():
    assert "ultralytics" not in ul.__dict__


# -- Preparation -------------------------------------------------------------

def test_relative_dataset_path_is_resolved_against_the_yaml(tmp_path):
    data_yaml = _write_dataset(tmp_path / "export")
    resolved = ul.prepare_data_yaml(str(data_yaml), tmp_path / "run")
    cfg = yaml.safe_load(Path(resolved).read_text(encoding="utf-8"))
    assert Path(cfg["path"]) == (tmp_path / "export").resolve()
    assert cfg["names"] == {0: "person"}


def test_ver_dataset_is_refused_with_a_clear_message(tmp_path):
    data_yaml = tmp_path / "data.yaml"
    data_yaml.write_text("path: .\ntrain: images\nval: images\nnames: [a]\nannotation_file: gt.ver\n", encoding="utf-8")
    with pytest.raises(ValueError, match=r"\.ver"):
        ul.prepare_data_yaml(str(data_yaml), tmp_path / "run")


def test_train_kwargs_keep_known_keys_and_auto_device():
    kwargs = ul.train_kwargs(
        {"epochs": 3, "lr0": 0.02, "device": "", "max_epoch": 99, "seed": None},
        "data.yaml", "C:/runs", "r1",
    )
    assert kwargs["epochs"] == 3 and kwargs["lr0"] == 0.02
    assert "device" not in kwargs and "max_epoch" not in kwargs and "seed" not in kwargs
    assert kwargs["project"] == "C:/runs" and kwargs["name"] == "r1" and kwargs["exist_ok"] is True


def test_pretrained_weights_go_to_a_stable_folder(tmp_path, monkeypatch):
    monkeypatch.delenv(ul.PRETRAINED_DIR_ENV, raising=False)
    assert ul.pretrained_weights("yolo11n", str(tmp_path / "runs")) == tmp_path / "pretrained" / "yolo11n.pt"
    monkeypatch.setenv(ul.PRETRAINED_DIR_ENV, str(tmp_path / "cache"))
    assert ul.pretrained_weights("yolo11n", str(tmp_path / "runs")) == tmp_path / "cache" / "yolo11n.pt"


def test_strip_mlflow_callbacks_leaves_the_others():
    def mlflow_cb(_):
        pass

    def own_cb(_):
        pass

    mlflow_cb.__module__ = "ultralytics.utils.callbacks.mlflow"
    trainer = SimpleNamespace(callbacks={
        "on_pretrain_routine_start": [ul.strip_mlflow_callbacks],
        "on_pretrain_routine_end": [mlflow_cb, own_cb],
        "on_fit_epoch_end": [own_cb, mlflow_cb],
    })
    ul.strip_mlflow_callbacks(trainer)
    assert trainer.callbacks["on_pretrain_routine_end"] == [own_cb]
    assert trainer.callbacks["on_fit_epoch_end"] == [own_cb]


def test_cuda_visibility_is_restored_after_the_block(monkeypatch):
    monkeypatch.delenv("CUDA_VISIBLE_DEVICES", raising=False)
    with ul.preserve_cuda_visibility():
        os.environ["CUDA_VISIBLE_DEVICES"] = "-1"  # ce que fait Ultralytics avec device=cpu
    assert "CUDA_VISIBLE_DEVICES" not in os.environ

    monkeypatch.setenv("CUDA_VISIBLE_DEVICES", "1")
    with pytest.raises(RuntimeError), ul.preserve_cuda_visibility():
        os.environ["CUDA_VISIBLE_DEVICES"] = "-1"
        raise RuntimeError("echec en cours de run")
    assert os.environ["CUDA_VISIBLE_DEVICES"] == "1"


def test_epoch_payload_has_the_yolox_shape():
    trainer = SimpleNamespace(
        epoch=1, epochs=4, tloss=[1.0, 2.0, 3.0],
        label_loss_items=lambda tloss, prefix: {
            f"{prefix}/box_loss": tloss[0], f"{prefix}/cls_loss": tloss[1], f"{prefix}/dfl_loss": tloss[2],
        },
        metrics={"metrics/mAP50(B)": 0.5, "metrics/mAP50-95(B)": 0.25, "val/box_loss": None},
    )
    payload = ul.epoch_payload(trainer)
    assert payload["epoch"] == 2 and payload["total_epochs"] == 4 and payload["progress_pct"] == 50.0
    assert payload["loss"] == {"box_loss": 1.0, "cls_loss": 2.0, "dfl_loss": 3.0}
    assert payload["metrics"] == {"metrics/mAP50(B)": 0.5, "metrics/mAP50-95(B)": 0.25}


# -- Vrais runs (slow) -------------------------------------------------------

def _engine(tmp_path, **overrides):
    pytest.importorskip("ultralytics")
    data_yaml = _write_dataset(tmp_path / "ds")
    kwargs = {
        "model_size": "yolov8n",
        "data_yaml": str(data_yaml),
        "run_name": "pytest_ul",
        "output_dir": str(tmp_path / "runs"),
        # Architecture depuis sa config : aucun telechargement pendant les tests.
        "model_weights": "yolov8n.yaml",
        "hyperparams": {"epochs": 2, "batch": 4, "imgsz": 64, "workers": 0, "device": "cpu", "amp": False},
    }
    kwargs.update(overrides)
    return ul.UltralyticsEngine(**kwargs)


@pytest.mark.slow
def test_short_run_reports_epochs_and_writes_the_declared_plots(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("CUDA_VISIBLE_DEVICES", raising=False)
    events: list[dict] = []
    result = _engine(tmp_path, on_epoch_end=events.append).train()
    assert "CUDA_VISIBLE_DEVICES" not in os.environ  # device=cpu sans effet durable

    assert [e["epoch"] for e in events] == [1, 2]
    assert {"box_loss", "cls_loss", "dfl_loss"} <= set(events[-1]["loss"])
    assert "metrics/mAP50(B)" in events[-1]["metrics"]
    assert Path(result["best_model_path"]).suffix == ".pt" and Path(result["best_model_path"]).is_file()
    assert "metrics/mAP50(B)" in result["metrics"]  # revalidation de best.pt

    found = collect_artifacts(Path(result["run_dir"]), CATALOG)
    for category in ("summary", "confusion", "curves", "labels", "val_labels", "val_predictions", "train_batches"):
        assert found[category], category
    # Callback MLflow d'Ultralytics bien retire : pas de store parasite.
    assert not (tmp_path / "runs" / "mlflow").exists()
    assert not list(tmp_path.glob("**/mlruns"))

    predict = ul.UltralyticsEngine.load_predictor(result["best_model_path"], "yolov8n", ["person"], 64)
    boxes = predict(cv2.imread(str(tmp_path / "ds" / "images" / "train" / "000000.jpg")))
    assert all(len(b) == 6 and isinstance(b[5], int) for b in boxes)


@pytest.mark.slow
def test_stop_flag_interrupts_the_run(tmp_path):
    stop = threading.Event()

    def stop_after_first_epoch(payload: dict) -> None:
        stop.set()

    engine = _engine(
        tmp_path, stop_flag=stop, on_epoch_end=stop_after_first_epoch,
        hyperparams={"epochs": 5, "batch": 4, "imgsz": 64, "workers": 0, "device": "cpu", "amp": False},
    )
    with pytest.raises(ul.UltralyticsStopped):
        engine.train()
    assert stop.is_set()


@pytest.mark.slow
def test_cpu_run_does_not_hide_the_gpu_from_later_runs(tmp_path, monkeypatch):
    torch = pytest.importorskip("torch")
    if not torch.cuda.is_available():
        pytest.skip("pas de GPU CUDA")
    cwd = tmp_path / "cwd"
    cwd.mkdir()
    monkeypatch.chdir(cwd)
    _engine(tmp_path / "cpu").train()
    assert torch.cuda.device_count() >= 1
    gpu = _engine(tmp_path / "gpu", hyperparams={"epochs": 1, "batch": 4, "imgsz": 64, "workers": 0, "device": "0"})
    result = gpu.train()
    assert Path(result["best_model_path"]).is_file()
    # Le controle AMP telecharge un modele : il ne doit pas atterrir dans le
    # dossier courant du processus (souvent le depot).
    assert not list(cwd.glob("*.pt")) and not list(cwd.glob("weights/*.pt"))
    assert list((tmp_path / "gpu" / "pretrained").glob("*.pt"))
