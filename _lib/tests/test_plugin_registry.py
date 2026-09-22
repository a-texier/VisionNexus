"""Tests de _lib/plugin_registry.py sur des dossiers plugins/ synthetiques."""

import sys
import textwrap
import uuid
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from _lib import plugin_registry  # noqa: E402

GROUP = "visionnexus.trainer_backends"


def _write_plugin(root: Path, init_body: str, extra_files: dict[str, str] | None = None) -> str:
    """Cree un plugin au nom unique (sys.modules garde les imports d'un test a l'autre)."""
    name = f"vn_test_plugin_{uuid.uuid4().hex[:8]}"
    package = root / name
    package.mkdir(parents=True)
    (package / "__init__.py").write_text(textwrap.dedent(init_body).replace("PKG", name), encoding="utf-8")
    for filename, body in (extra_files or {}).items():
        (package / filename).write_text(textwrap.dedent(body), encoding="utf-8")
    return name


@pytest.fixture
def plugins_dir(tmp_path, monkeypatch):
    root = tmp_path / "plugins"
    root.mkdir()
    monkeypatch.setenv(plugin_registry.PLUGINS_DIR_ENV, str(root))
    return root


def test_no_plugins_dir_means_nothing(tmp_path, monkeypatch):
    monkeypatch.setenv(plugin_registry.PLUGINS_DIR_ENV, str(tmp_path / "absent"))
    assert plugin_registry.discover_plugins() == []
    assert plugin_registry.load_extension(GROUP, "anything") is None
    assert plugin_registry.describe(GROUP) == []


def test_available_plugin_loads_its_target_lazily(plugins_dir):
    name = _write_plugin(
        plugins_dir,
        """
        PLUGIN = {
            "label": "Moteur test",
            "requires": ["json"],
            "extensions": {"visionnexus.trainer_backends": {"fake": "PKG.trainer:FakeTrainer"}},
        }
        """,
        {"trainer.py": "class FakeTrainer:\n    pass\n"},
    )
    assert f"{name}.trainer" not in sys.modules

    [info] = plugin_registry.discover_plugins()
    assert info.available and info.label == "Moteur test"
    # La decouverte ne doit jamais importer la cible : c'est elle qui tire les
    # dependances lourdes du plugin.
    assert f"{name}.trainer" not in sys.modules

    cls = plugin_registry.load_extension(GROUP, "fake")
    assert cls.__name__ == "FakeTrainer"
    assert plugin_registry.describe(GROUP) == [{
        "name": "fake", "plugin": name, "label": "Moteur test",
        "available": True, "reason": None,
    }]


def test_missing_requirement_is_listed_but_refused(plugins_dir):
    _write_plugin(
        plugins_dir,
        """
        PLUGIN = {
            "requires": ["module_absent_pour_le_test_xyz"],
            "extensions": {"visionnexus.trainer_backends": {"fake": "PKG.trainer:FakeTrainer"}},
        }
        """,
    )
    [entry] = plugin_registry.describe(GROUP)
    assert entry["available"] is False
    assert "module_absent_pour_le_test_xyz" in entry["reason"]
    with pytest.raises(RuntimeError, match="indisponible"):
        plugin_registry.load_extension(GROUP, "fake")


def test_broken_plugin_does_not_break_discovery(plugins_dir):
    _write_plugin(plugins_dir, "raise ImportError('casse volontairement')\n")
    good = _write_plugin(
        plugins_dir,
        """
        PLUGIN = {"extensions": {"visionnexus.trainer_backends": {"ok": "PKG:PLUGIN"}}}
        """,
    )
    infos = {p.name: p for p in plugin_registry.discover_plugins()}
    broken = [p for p in infos.values() if p.error]
    assert len(broken) == 1 and "casse volontairement" in broken[0].error
    assert infos[good].available


def test_missing_manifest_is_reported(plugins_dir):
    _write_plugin(plugins_dir, "VALEUR = 1\n")
    [info] = plugin_registry.discover_plugins()
    assert not info.available and "PLUGIN" in info.error


def test_real_plugins_of_this_tree_are_readable(monkeypatch):
    """Les plugins presents declarent un manifeste lisible, sans rien importer
    de lourd. Un arbre sans plugin (branche main, bundle public) est valide."""
    monkeypatch.delenv(plugin_registry.PLUGINS_DIR_ENV, raising=False)
    for info in plugin_registry.discover_plugins():
        assert info.error is None, info.error
        assert info.label
        # Une extension declaree doit designer une cible "module:attribut".
        for targets in info.extensions.values():
            for target in targets.values():
                assert ":" in target, target
    # Les extensions declarees ici sont celles que les apps savent charger.
    groups = {g for info in plugin_registry.discover_plugins() for g in info.extensions}
    assert groups <= {"visionnexus.trainer_backends", "visionnexus.detector_backends"}
