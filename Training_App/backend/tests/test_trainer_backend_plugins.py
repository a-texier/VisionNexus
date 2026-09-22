"""Moteurs d'entrainement : decouverte dans <racine>/plugins/, catalogues,
controles avant lancement (poids, tailles, hyperparametres)."""

import sys
import textwrap
import uuid
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services import trainer_backend  # noqa: E402
from services.yolox_catalog import CATALOG as YOLOX_CATALOG  # noqa: E402

_FAKE_CATALOG = {
    "label": "Moteur factice",
    "weights_suffixes": [".bin"],
    "sizes": ["petit", "grand"],
    "default_size": "petit",
    "defaults": {"epochs": 5, "lr": 0.1, "batch": 2, "imgsz": 64, "workers": 0},
    "groups": [],
    "keys": {"epochs": "epochs", "batch": "batch", "imgsz": "imgsz", "workers": "workers"},
    "hpo_ranges": {"lr": {"type": "float", "low": 0.01, "high": 1.0}},
    "hpo_default_optimize": ["lr"],
    "artifacts": {"summary": ["synthese.png"]},
    "train_batches_glob": "batch*.jpg",
}


def _fake_plugin(root: Path, requires: list[str], catalog: dict | None = None) -> str:
    name = f"vn_trainer_plugin_{uuid.uuid4().hex[:8]}"
    package = root / name
    package.mkdir(parents=True)
    (package / "__init__.py").write_text(textwrap.dedent(f"""
        PLUGIN = {{
            "label": "Moteur factice",
            "requires": {requires!r},
            "extensions": {{
                "visionnexus.trainer_backends": {{"factice": "{name}.trainer:FakeEngine"}},
            }},
        }}
    """), encoding="utf-8")
    (package / "trainer.py").write_text(
        f"class FakeEngine:\n    CATALOG = {catalog if catalog is not None else _FAKE_CATALOG!r}\n",
        encoding="utf-8",
    )
    return name


@pytest.fixture
def no_plugins(tmp_path, monkeypatch):
    monkeypatch.setenv("VISIONNEXUS_PLUGINS_DIR", str(tmp_path / "absent"))
    monkeypatch.delenv("TRAINING_APP_TRAINER_BACKEND", raising=False)


@pytest.fixture
def fake_plugin_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("VISIONNEXUS_PLUGINS_DIR", str(tmp_path))
    monkeypatch.delenv("TRAINING_APP_TRAINER_BACKEND", raising=False)
    return tmp_path


# -- Decouverte --------------------------------------------------------------

def test_without_plugin_only_yolox_is_listed(no_plugins):
    assert trainer_backend.list_available_backends() == ["yolox"]
    [only] = trainer_backend.describe_backends(with_catalog=True)
    assert only["name"] == "yolox" and only["source"] == "builtin"
    assert only["catalog"]["label"] == "YOLOX"


def test_folder_plugin_is_listed_and_resolved(fake_plugin_dir):
    _fake_plugin(fake_plugin_dir, requires=["json"])

    assert trainer_backend.list_available_backends() == ["yolox", "factice"]
    entry = next(b for b in trainer_backend.describe_backends(with_catalog=True) if b["name"] == "factice")
    assert entry["source"] == "plugin" and entry["label"] == "Moteur factice"
    assert entry["catalog"]["sizes"] == ["petit", "grand"]
    assert trainer_backend.resolve_engine("factice").__name__ == "FakeEngine"


def test_plugin_without_its_library_stays_out_of_available(fake_plugin_dir):
    _fake_plugin(fake_plugin_dir, requires=["bibliotheque_absente_xyz"])

    assert trainer_backend.list_available_backends() == ["yolox"]
    entry = next(b for b in trainer_backend.describe_backends(with_catalog=True) if b["name"] == "factice")
    assert entry["available"] is False and "bibliotheque_absente_xyz" in entry["reason"]
    assert "catalog" not in entry
    with pytest.raises(RuntimeError, match="bibliotheque_absente_xyz"):
        trainer_backend.resolve_engine("factice")


def test_plugin_with_incomplete_catalog_is_reported_not_offered(fake_plugin_dir):
    _fake_plugin(fake_plugin_dir, requires=[], catalog={"label": "Incomplet"})

    entry = next(b for b in trainer_backend.describe_backends(with_catalog=True) if b["name"] == "factice")
    assert entry["available"] is False and "incomplet" in entry["reason"]
    # YOLOX reste proposable : un plugin casse ne masque pas les autres.
    assert trainer_backend.describe_backends(with_catalog=True)[0]["available"] is True


def test_unknown_engine_is_an_error_not_a_fallback(no_plugins):
    with pytest.raises(RuntimeError, match="introuvable"):
        trainer_backend.resolve_engine("inexistant")


def test_env_variable_sets_default_engine(fake_plugin_dir, monkeypatch):
    _fake_plugin(fake_plugin_dir, requires=[])
    monkeypatch.setenv("TRAINING_APP_TRAINER_BACKEND", "factice")
    assert trainer_backend.normalize_engine("") == "factice"
    assert trainer_backend.normalize_engine("YOLOX") == "yolox"


# -- Catalogue YOLOX ---------------------------------------------------------

def test_yolox_catalog_is_complete_and_consistent():
    for key in trainer_backend.CATALOG_KEYS:
        assert key in YOLOX_CATALOG, key
    defaults = YOLOX_CATALOG["defaults"]
    assert YOLOX_CATALOG["default_size"] in YOLOX_CATALOG["sizes"]
    for group in YOLOX_CATALOG["groups"]:
        for field in group["params"]:
            assert field["key"] in defaults, field["key"]
    for name, spec in YOLOX_CATALOG["hpo_ranges"].items():
        assert name in defaults, name
        assert spec["low"] < spec["high"], name
    assert set(YOLOX_CATALOG["hpo_default_optimize"]) <= set(YOLOX_CATALOG["hpo_ranges"])
    assert set(YOLOX_CATALOG["keys"].values()) <= set(defaults)


def test_yolox_catalog_has_no_foreign_engine_keys():
    # Cles d'autres moteurs (ex. lr0/box/dfl) : n'ont pas d'attribut Exp YOLOX.
    assert not {"lr0", "lrf", "box", "cls", "dfl", "epochs", "batch"} & set(YOLOX_CATALOG["defaults"])


# -- Controles avant lancement -----------------------------------------------

def test_weights_must_match_engine_suffix(no_plugins):
    assert trainer_backend.check_weights_for_engine("yolox", "") is None
    assert trainer_backend.check_weights_for_engine("yolox", "C:/runs/best_ckpt.pth") is None
    message = trainer_backend.check_weights_for_engine("yolox", "C:/runs/best.pt")
    assert message and "best.pt" in message and ".pth" in message


def test_merge_ignores_keys_of_another_engine():
    merged, ignored = trainer_backend.merge_hyperparams(
        YOLOX_CATALOG, {"degrees": 3.0, "lr0": 0.02, "mosaic": 0.5}, epochs=7, batch=4, imgsz=320,
    )
    assert merged["degrees"] == 3.0
    assert merged["max_epoch"] == 7 and merged["batch_size"] == 4 and merged["imgsz"] == 320
    assert ignored == ["lr0", "mosaic"]
    assert "lr0" not in merged


def test_generic_values_override_explicit_hyperparams():
    merged, _ = trainer_backend.merge_hyperparams(YOLOX_CATALOG, {"max_epoch": 50}, epochs=3)
    assert merged["max_epoch"] == 3


def test_epochs_of_reads_engine_key():
    assert trainer_backend.epochs_of(YOLOX_CATALOG, {"max_epoch": 12}) == 12
    assert trainer_backend.epochs_of(_FAKE_CATALOG, {"epochs": 4}) == 4
    assert trainer_backend.epochs_of(_FAKE_CATALOG, {}) == 5
