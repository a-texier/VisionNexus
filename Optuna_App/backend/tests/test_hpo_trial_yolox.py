# ============================================================
# test_hpo_trial_yolox.py -- hpo_trial.py appele en subprocess (contrat reel
# utilise par orchestrator.py) sur un dataset synthetique, verifie le JSON de
# resultat + la compatibilite stdout, puis une mini-etude Optuna (2 trials)
# pour verifier que study.best_trial se remplit.
# ============================================================

import json
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np
import optuna
import pytest

_OPTUNA_APP_ROOT = Path(__file__).resolve().parent.parent.parent
_HPO_TRIAL_SCRIPT = str(_OPTUNA_APP_ROOT / "backend" / "hpo_trial.py")


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


def _run_trial(data_yaml: Path, trial_dir: Path, engine: str = "yolox", model_size: str = "yolox-nano",
               weights: str = "", **extra_hp) -> tuple[subprocess.CompletedProcess, dict]:
    trial_dir.mkdir(parents=True, exist_ok=True)
    result_json = trial_dir / "result.json"
    cmd = [
        sys.executable, _HPO_TRIAL_SCRIPT,
        "--data_yaml", str(data_yaml), "--engine", engine, "--model_size", model_size,
        "--epochs", "1", "--imgsz", "64", "--metric", "map50",
        "--workers", "0", "--result_json", str(result_json), "--trial_dir", str(trial_dir),
    ]
    if weights:
        cmd += ["--weights", weights]
    for k, v in extra_hp.items():
        cmd += [f"--{k}", str(v)]
    r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=600)
    payload = json.loads(result_json.read_text(encoding="utf-8")) if result_json.exists() else {}
    return r, payload


@pytest.mark.slow
def test_hpo_trial_script_completes_and_writes_result(tmp_path):
    data_yaml = _write_dataset(tmp_path / "dataset")
    r, payload = _run_trial(data_yaml, tmp_path / "trial_0000", degrees=5.0)

    assert r.returncode == 0, r.stderr
    assert payload["status"] == "completed" and payload["engine"] == "yolox"
    assert isinstance(payload["objective_value"], float)
    assert payload["best_weights"] and Path(payload["best_weights"]).suffix == ".pth"
    assert Path(payload["best_weights"]).exists()

    # contrat historique optuna_runner.py : derniere ligne stdout = float brut.
    last_line = r.stdout.strip().splitlines()[-1]
    assert float(last_line) == pytest.approx(payload["objective_value"])


@pytest.mark.slow
def test_hpo_trial_script_missing_engine_fails_cleanly(tmp_path):
    data_yaml = _write_dataset(tmp_path / "dataset")
    # hpo_trial.py localise Training_App/backend par chemin relatif a lui-meme
    # (parent.parent.parent / "Training_App" / "backend") : copie isolee sans
    # Training_App a cote -> import du moteur echoue proprement (code 2), sans
    # dependre du sys.path du process de test.
    isolated_script = tmp_path / "isolated_app" / "backend" / "hpo_trial.py"
    isolated_script.parent.mkdir(parents=True)
    isolated_script.write_text(Path(_HPO_TRIAL_SCRIPT).read_text(encoding="utf-8"), encoding="utf-8")

    cmd = [
        sys.executable, str(isolated_script),
        "--data_yaml", str(data_yaml), "--model_size", "yolox-nano", "--epochs", "1",
    ]
    r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=60)
    assert r.returncode == 2


@pytest.mark.slow
def test_mini_optuna_study_best_trial_populated(tmp_path):
    data_yaml = _write_dataset(tmp_path / "dataset")
    study = optuna.create_study(direction="maximize", sampler=optuna.samplers.TPESampler(seed=0))

    def objective(trial: optuna.Trial) -> float:
        degrees = trial.suggest_float("degrees", 0.0, 10.0)
        trial_dir = tmp_path / "runs" / f"trial_{trial.number:04d}"
        _, payload = _run_trial(data_yaml, trial_dir, degrees=degrees)
        assert payload.get("status") == "completed"
        return float(payload["objective_value"])

    study.optimize(objective, n_trials=2)

    assert len(study.trials) == 2
    assert study.best_trial is not None
    assert "degrees" in study.best_trial.params


@pytest.mark.slow
def test_hpo_trial_ignores_keys_of_another_engine(tmp_path):
    data_yaml = _write_dataset(tmp_path / "dataset")
    r, payload = _run_trial(data_yaml, tmp_path / "trial_0000", degrees=5.0, lr0=0.02)
    assert r.returncode == 0, r.stderr
    assert payload["ignored_params"] == ["lr0"]


@pytest.mark.slow
def test_hpo_trial_unknown_engine_fails_with_a_result(tmp_path):
    data_yaml = _write_dataset(tmp_path / "dataset")
    r, payload = _run_trial(data_yaml, tmp_path / "trial_0000", engine="inexistant")
    assert r.returncode != 0
    assert payload["status"] == "failed" and "inexistant" in payload["error"]


@pytest.mark.slow
def test_hpo_trial_without_trial_dir_uses_a_fresh_folder_of_runs_dir(tmp_path):
    data_yaml = _write_dataset(tmp_path / "dataset")
    runs_dir = tmp_path / "manual"
    cmd = [
        sys.executable, _HPO_TRIAL_SCRIPT, "--data_yaml", str(data_yaml), "--engine", "yolox",
        "--model_size", "yolox-nano", "--epochs", "1", "--imgsz", "64", "--workers", "0",
        "--runs_dir", str(runs_dir),
    ]
    r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=600)
    assert r.returncode == 0, r.stderr
    [trial] = list(runs_dir.iterdir())
    assert trial.name.startswith("trial_") and (trial / "results.csv").exists()
    float(r.stdout.strip().splitlines()[-1])


def _ultralytics_ready() -> bool:
    sys.path.insert(0, str(_OPTUNA_APP_ROOT.parent / "Training_App" / "backend"))
    from services import trainer_backend

    return "ultralytics" in trainer_backend.list_available_backends()


@pytest.mark.slow
def test_hpo_trial_trains_the_ultralytics_engine(tmp_path):
    if not _ultralytics_ready():
        pytest.skip("plugin Ultralytics absent ou bibliotheque non installee")
    data_yaml = _write_dataset(tmp_path / "dataset")
    r, payload = _run_trial(
        data_yaml, tmp_path / "trial_0000", engine="ultralytics", model_size="yolov8n",
        weights="yolov8n.yaml", lr0=0.02, degrees=3.0, basic_lr_per_img=0.001, device="cpu",
    )
    assert r.returncode == 0, r.stderr
    assert payload["status"] == "completed" and payload["engine"] == "ultralytics"
    assert payload["ignored_params"] == ["basic_lr_per_img"]
    assert Path(payload["best_weights"]).suffix == ".pt"
    assert float(r.stdout.strip().splitlines()[-1]) == pytest.approx(payload["objective_value"])
