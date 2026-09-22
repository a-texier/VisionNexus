# ============================================================
# Tests unitaires -- idempotence de l'export YOLO orchestrateur
# (backend/models/routers/orchestrator.py).
#
# Verifie la resolution du nom d'export : reutilisation quand la signature
# des entrees est identique, suffixe "(1)", "(2)"... quand elle change, et
# jamais d'ecrasement d'un dossier existant.
# ============================================================

import pytest

from backend.models.routers.orchestrator import (
    _is_valid_export,
    _read_export_signature,
    _resolve_export_target,
    _write_export_signature,
)

pytestmark = pytest.mark.unit


def _make_export(exports_dir, name, digest=None):
    """Cree un dossier d'export valide (data.yaml), avec sa signature optionnelle."""
    folder = exports_dir / name
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "data.yaml").write_text("names: [a]\n", encoding="utf-8")
    if digest is not None:
        _write_export_signature(str(folder), {"k": "v"}, digest, name)
    return folder


def test_is_valid_export_requires_data_yaml(tmp_path):
    empty = tmp_path / "empty"
    empty.mkdir()
    assert not _is_valid_export(empty)
    _make_export(tmp_path, "ok")
    assert _is_valid_export(tmp_path / "ok")


def test_signature_roundtrip(tmp_path):
    folder = _make_export(tmp_path, "run", digest="abc123")
    assert _read_export_signature(folder) == "abc123"


def test_free_dir_returns_base(tmp_path):
    name, reuse = _resolve_export_target(tmp_path, "proj-yolo", "sig")
    assert name == "proj-yolo"
    assert reuse is None


def test_same_signature_is_reused(tmp_path):
    folder = _make_export(tmp_path, "proj-yolo", digest="sig-1")
    name, reuse = _resolve_export_target(tmp_path, "proj-yolo", "sig-1")
    assert name == "proj-yolo"
    assert reuse == folder


def test_changed_signature_suffixes(tmp_path):
    _make_export(tmp_path, "proj-yolo", digest="sig-1")
    name, reuse = _resolve_export_target(tmp_path, "proj-yolo", "sig-2")
    assert name == "proj-yolo (1)"
    assert reuse is None


def test_suffix_increments_over_several_variants(tmp_path):
    _make_export(tmp_path, "proj-yolo", digest="sig-1")
    _make_export(tmp_path, "proj-yolo (1)", digest="sig-2")
    name, reuse = _resolve_export_target(tmp_path, "proj-yolo", "sig-3")
    assert name == "proj-yolo (2)"
    assert reuse is None


def test_legacy_export_without_signature_is_not_reused(tmp_path):
    # Un export sans fichier de signature ne peut pas etre prouve identique :
    # on suffixe plutot que d'ecraser.
    _make_export(tmp_path, "proj-yolo", digest=None)
    name, reuse = _resolve_export_target(tmp_path, "proj-yolo", "sig-1")
    assert name == "proj-yolo (1)"
    assert reuse is None


def test_reuses_matching_variant_even_if_base_differs(tmp_path):
    _make_export(tmp_path, "proj-yolo", digest="sig-1")
    match = _make_export(tmp_path, "proj-yolo (1)", digest="sig-2")
    name, reuse = _resolve_export_target(tmp_path, "proj-yolo", "sig-2")
    assert name == "proj-yolo (1)"
    assert reuse == match


def test_zip_only_export_counts_as_taken(tmp_path):
    (tmp_path / "proj-yolo.zip").write_text("x", encoding="utf-8")
    name, reuse = _resolve_export_target(tmp_path, "proj-yolo", "sig-1")
    assert name == "proj-yolo (1)"
    assert reuse is None
