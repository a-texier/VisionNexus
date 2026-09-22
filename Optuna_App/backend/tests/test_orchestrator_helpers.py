# ============================================================
# test_orchestrator_helpers.py -- plages HPO lues dans le catalogue du
# moteur (Training_App), refus avant tout trial (moteur absent, parametres
# d'un autre moteur), resolution data.yaml (dossier/zip), extraction
# workers depuis la commande stockee d'un trial (studies.py).
# ============================================================

import sys
import zipfile
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from backend.api import orchestrator  # noqa: E402
from backend.api.studies import _workers_from_command  # noqa: E402

# Cles d'un autre moteur, sans attribut Exp YOLOX : absentes des plages YOLOX.
_FOREIGN_KEYS = {"lr0", "lrf", "box", "cls", "dfl", "hsv_h", "hsv_s", "hsv_v", "scale", "mosaic", "yolo_version"}


@pytest.fixture
def no_plugins(tmp_path, monkeypatch):
    monkeypatch.setenv("VISIONNEXUS_PLUGINS_DIR", str(tmp_path / "absent"))


def test_yolox_ranges_come_from_the_engine_catalog():
    ranges = orchestrator.engine_catalog("yolox")["hpo_ranges"]
    assert not (set(ranges) & _FOREIGN_KEYS)
    for name, spec in ranges.items():
        assert spec["type"] in ("float", "int", "categorical"), name
        if spec["type"] in ("float", "int"):
            assert spec["low"] < spec["high"], name


def test_hpo_request_defaults_leave_choices_to_the_engine():
    body = orchestrator.HpoRequest(dataset_path="x")
    assert body.engine == "yolox" and body.model_size == "" and body.optimize == []
    assert not hasattr(body, "yolo_version")


def test_engines_endpoint_lists_trial_engines(no_plugins):
    data = orchestrator.engines()
    assert [e["name"] for e in data["engines"]] == ["yolox"]
    assert data["engines"][0]["catalog"]["hpo_ranges"]
    assert data["trial_script"].endswith("hpo_trial.py") and data["runs_dir"]


def _dataset_dir(tmp_path: Path) -> Path:
    dataset_dir = tmp_path / "dataset"
    dataset_dir.mkdir()
    (dataset_dir / "data.yaml").write_text("path: .\ntrain: images/train\nval: images/train\nnames:\n  0: a\n", encoding="utf-8")
    return dataset_dir


def test_run_hpo_refuses_an_unknown_engine_before_any_trial(tmp_path, no_plugins):
    body = orchestrator.HpoRequest(dataset_path=str(_dataset_dir(tmp_path)), engine="inexistant")
    result = orchestrator.run_hpo(body)
    assert result["hpo_succeeded"] is False and result["n_trials"] == 0
    assert "inexistant" in result["error"]


def test_run_hpo_refuses_parameters_of_another_engine(tmp_path, no_plugins):
    body = orchestrator.HpoRequest(dataset_path=str(_dataset_dir(tmp_path)), engine="yolox", optimize=["lr0", "mosaic"])
    result = orchestrator.run_hpo(body)
    assert result["hpo_succeeded"] is False and result["n_trials"] == 0
    assert "basic_lr_per_img" in result["failure_action"]


def test_resolve_data_yaml_from_directory(tmp_path):
    dataset_dir = tmp_path / "dataset"
    dataset_dir.mkdir()
    (dataset_dir / "data.yaml").write_text("path: .\ntrain: images/train\nval: images/train\nnames:\n  0: a\n", encoding="utf-8")

    found = orchestrator._resolve_data_yaml(str(dataset_dir), "")
    assert found == str(dataset_dir / "data.yaml")


def test_resolve_data_yaml_from_zip(tmp_path, monkeypatch):
    monkeypatch.setattr(orchestrator, "WORKSPACE", tmp_path / "workspace")
    src_dir = tmp_path / "export_src"
    src_dir.mkdir()
    (src_dir / "data.yaml").write_text("path: .\ntrain: images/train\nval: images/train\nnames:\n  0: a\n", encoding="utf-8")

    zip_path = tmp_path / "export.zip"
    with zipfile.ZipFile(zip_path, "w") as zf:
        zf.write(src_dir / "data.yaml", arcname="data.yaml")

    found = orchestrator._resolve_data_yaml(str(tmp_path / "export"), "")
    assert found.endswith("data.yaml")
    assert Path(found).exists()


def test_resolve_data_yaml_missing_returns_empty(tmp_path):
    assert orchestrator._resolve_data_yaml(str(tmp_path / "nope"), "") == ""


class _FakeTrial:
    def __init__(self, user_attrs):
        self.user_attrs = user_attrs


@pytest.mark.parametrize(
    "command,expected",
    [
        (["python", "hpo_trial.py", "--workers", "0"], 0),
        (["python", "hpo_trial.py", "--epochs", "5", "--workers", "4"], 4),
        (["python", "hpo_trial.py"], None),
        (["python", "hpo_trial.py", "--workers", "not-an-int"], None),
    ],
)
def test_workers_from_command(command, expected):
    assert _workers_from_command(_FakeTrial({"command": command})) == expected
