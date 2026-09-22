# ============================================================
# Tests unitaires — backend/services/settings_service.py
# Isole chaque test sur un fichier user_settings.json temporaire
# (monkeypatch du module SETTINGS_FILE) pour ne jamais toucher au
# workspace de test partage ni a un workspace de prod.
# ============================================================

import json

import pytest

from backend.services import settings_service as ss_module
from backend.services.settings_service import DEFAULT_SETTINGS, SETTINGS_SCHEMA_VERSION, SettingsService

pytestmark = pytest.mark.unit


@pytest.fixture()
def svc(tmp_path, monkeypatch):
    settings_file = tmp_path / "user_settings.json"
    monkeypatch.setattr(ss_module, "SETTINGS_FILE", settings_file)
    return SettingsService(), settings_file


def test_load_creates_file_with_defaults_when_missing(svc):
    service, settings_file = svc
    assert not settings_file.exists()
    loaded = service.load()
    assert loaded == DEFAULT_SETTINGS
    assert settings_file.exists()


def test_load_merges_saved_values_with_defaults(svc):
    service, settings_file = svc
    settings_file.write_text(
        json.dumps({"interface": {"default_tool": "polygon"}}), encoding="utf-8"
    )
    loaded = service.load()
    assert loaded["interface"]["default_tool"] == "polygon"
    # Les autres cles de la section restent celles par defaut.
    assert loaded["interface"]["timeline_height"] == DEFAULT_SETTINGS["interface"]["timeline_height"]
    # Les sections absentes du fichier sauvegarde restent presentes.
    assert loaded["export"] == DEFAULT_SETTINGS["export"]


def test_load_migrates_legacy_default_throttle(svc):
    service, settings_file = svc
    settings_file.write_text(
        json.dumps({"interface": {"propagation_nav_throttle_ms": 700}}),
        encoding="utf-8",
    )

    loaded = service.load()

    assert loaded["interface"]["propagation_nav_throttle_ms"] == 150
    persisted = json.loads(settings_file.read_text(encoding="utf-8"))
    assert persisted["_schema_version"] == SETTINGS_SCHEMA_VERSION
    assert persisted["interface"]["propagation_nav_throttle_ms"] == 150


def test_load_preserves_custom_throttle_during_migration(svc):
    service, settings_file = svc
    settings_file.write_text(
        json.dumps({"interface": {"propagation_nav_throttle_ms": 300}}),
        encoding="utf-8",
    )

    loaded = service.load()

    assert loaded["interface"]["propagation_nav_throttle_ms"] == 300


def test_load_corrupted_json_falls_back_to_defaults(svc):
    service, settings_file = svc
    settings_file.parent.mkdir(parents=True, exist_ok=True)
    settings_file.write_text("{not valid json", encoding="utf-8")
    loaded = service.load()
    assert loaded == DEFAULT_SETTINGS


def test_save_then_load_roundtrip(svc):
    service, settings_file = svc
    custom = {"interface": {"default_tool": "sam_point"}}
    service.save(custom)
    with open(settings_file, encoding="utf-8") as f:
        assert json.load(f) == custom


def test_update_merges_partial_and_persists(svc):
    service, _ = svc
    service.load()  # cree le fichier par defaut
    merged = service.update({"algorithms": {"nms_iou_threshold": 0.7}})
    assert merged["algorithms"]["nms_iou_threshold"] == 0.7
    # Reload : la modification a bien ete persistee.
    reloaded = service.load()
    assert reloaded["algorithms"]["nms_iou_threshold"] == 0.7
    # Les autres cles de la section 'algorithms' restent inchangees.
    assert reloaded["algorithms"]["sam_points_per_side"] == DEFAULT_SETTINGS["algorithms"]["sam_points_per_side"]


def test_reset_restores_defaults(svc):
    service, _ = svc
    service.update({"interface": {"default_tool": "polygon"}})
    reset = service.reset()
    assert reset == DEFAULT_SETTINGS
    assert service.load() == DEFAULT_SETTINGS


def test_deep_merge_override_wins_on_scalar_conflict():
    base = {"a": 1, "b": {"c": 2, "d": 3}}
    override = {"b": {"c": 99}}
    merged = SettingsService._deep_merge(base, override)
    assert merged == {"a": 1, "b": {"c": 99, "d": 3}}


def test_deep_merge_does_not_mutate_base():
    base = {"a": {"b": 1}}
    override = {"a": {"b": 2}}
    SettingsService._deep_merge(base, override)
    assert base == {"a": {"b": 1}}  # base non mute (dict copies)


def test_deep_merge_non_dict_override_replaces_dict_value():
    base = {"a": {"b": 1}}
    override = {"a": "replaced"}
    merged = SettingsService._deep_merge(base, override)
    assert merged["a"] == "replaced"
