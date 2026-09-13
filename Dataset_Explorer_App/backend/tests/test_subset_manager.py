# ============================================================
# tests/test_subset_manager.py
# Tests unitaires : gestion des subsets (symlinks / copies).
#
# NOTE : les tests forcent use_symlinks=False (copie physique) pour
# rester independants du Mode Developpeur Windows (necessaire pour
# os.symlink sans droits admin).
# ============================================================

from pathlib import Path

import pytest
from PIL import Image as PILImage

import backend.core.subset_manager as subset_manager


@pytest.fixture(autouse=True)
def _force_copy_mode(monkeypatch):
    """Force la copie physique plutot que les symlinks (portable sur CI Windows)."""
    monkeypatch.setattr(subset_manager, "_get_use_symlinks", lambda: False)


@pytest.fixture()
def sample_images(tmp_path):
    src_dir = tmp_path / "originals"
    src_dir.mkdir()
    paths = []
    for i in range(3):
        p = src_dir / f"img{i}.png"
        PILImage.new("RGB", (8, 8), color=(i * 10, 0, 0)).save(p, "PNG")
        paths.append(str(p))
    return paths


# ------------------------------------------------------------------ #
# create_subset_symlinks
# ------------------------------------------------------------------ #

def test_create_subset_symlinks_copies_all_images(sample_images, tmp_path, monkeypatch):
    subsets_root = tmp_path / "subsets_root"
    monkeypatch.setattr(subset_manager, "SUBSETS_DIR", subsets_root)

    out_dir = subset_manager.create_subset_symlinks("my_subset", sample_images)
    assert out_dir == subsets_root / "my_subset"
    assert out_dir.exists()
    created = sorted(p.name for p in out_dir.iterdir())
    assert created == ["img0.png", "img1.png", "img2.png"]


def test_create_subset_symlinks_overwrites_existing(sample_images, tmp_path, monkeypatch):
    subsets_root = tmp_path / "subsets_root"
    monkeypatch.setattr(subset_manager, "SUBSETS_DIR", subsets_root)

    subset_manager.create_subset_symlinks("dup", sample_images[:1])
    # Relancer avec les memes images ne doit pas planter (dest.exists() -> unlink puis recree)
    out_dir = subset_manager.create_subset_symlinks("dup", sample_images[:1])
    assert (out_dir / "img0.png").exists()


def test_create_subset_symlinks_empty_list(tmp_path, monkeypatch):
    subsets_root = tmp_path / "subsets_root"
    monkeypatch.setattr(subset_manager, "SUBSETS_DIR", subsets_root)

    out_dir = subset_manager.create_subset_symlinks("empty_subset", [])
    assert out_dir.exists()
    assert list(out_dir.iterdir()) == []


# ------------------------------------------------------------------ #
# delete_subset_dir
# ------------------------------------------------------------------ #

def test_delete_subset_dir_removes_folder(sample_images, tmp_path, monkeypatch):
    subsets_root = tmp_path / "subsets_root"
    monkeypatch.setattr(subset_manager, "SUBSETS_DIR", subsets_root)
    out_dir = subset_manager.create_subset_symlinks("to_delete", sample_images)
    assert out_dir.exists()
    subset_manager.delete_subset_dir(str(out_dir))
    assert not out_dir.exists()


def test_delete_subset_dir_missing_dir_no_crash():
    subset_manager.delete_subset_dir("C:/does/not/exist/subset")


# ------------------------------------------------------------------ #
# remove_from_subset_dir
# ------------------------------------------------------------------ #

def test_remove_from_subset_dir_removes_specific_files(sample_images, tmp_path, monkeypatch):
    subsets_root = tmp_path / "subsets_root"
    monkeypatch.setattr(subset_manager, "SUBSETS_DIR", subsets_root)
    out_dir = subset_manager.create_subset_symlinks("partial_remove", sample_images)

    subset_manager.remove_from_subset_dir(str(out_dir), ["img0.png"])
    remaining = sorted(p.name for p in out_dir.iterdir())
    assert remaining == ["img1.png", "img2.png"]


def test_remove_from_subset_dir_missing_dir_no_crash():
    subset_manager.remove_from_subset_dir("C:/nope", ["a.png"])


def test_remove_from_subset_dir_missing_file_no_crash(sample_images, tmp_path, monkeypatch):
    subsets_root = tmp_path / "subsets_root"
    monkeypatch.setattr(subset_manager, "SUBSETS_DIR", subsets_root)
    out_dir = subset_manager.create_subset_symlinks("s", sample_images)
    subset_manager.remove_from_subset_dir(str(out_dir), ["does_not_exist.png"])
    assert len(list(out_dir.iterdir())) == 3


# ------------------------------------------------------------------ #
# export_to_annotation_app
# ------------------------------------------------------------------ #

def test_export_to_annotation_app_custom_base_dir(sample_images, tmp_path):
    custom_base = tmp_path / "annot_imports"
    out_dir = subset_manager.export_to_annotation_app(
        "exported_subset", sample_images, custom_base_dir=str(custom_base)
    )
    assert out_dir == custom_base / "exported_subset"
    created = sorted(p.name for p in out_dir.iterdir())
    assert created == ["img0.png", "img1.png", "img2.png"]


def test_export_to_annotation_app_idempotent_only_adds_missing(sample_images, tmp_path):
    custom_base = tmp_path / "annot_imports"
    subset_manager.export_to_annotation_app("s2", sample_images[:1], custom_base_dir=str(custom_base))
    # Deuxieme appel avec une image de plus : ne doit pas planter, doit ajouter la manquante
    out_dir = subset_manager.export_to_annotation_app("s2", sample_images, custom_base_dir=str(custom_base))
    created = sorted(p.name for p in out_dir.iterdir())
    assert created == ["img0.png", "img1.png", "img2.png"]


def test_export_to_annotation_app_default_base_dir(sample_images, tmp_path, monkeypatch):
    default_base = tmp_path / "default_annot_imports"
    monkeypatch.setattr(subset_manager, "ANNOTATION_APP_IMPORTS", default_base)
    out_dir = subset_manager.export_to_annotation_app("s3", sample_images)
    assert out_dir == default_base / "s3"
    assert out_dir.exists()


# ------------------------------------------------------------------ #
# _make_symlink — mode copie physique
# ------------------------------------------------------------------ #

def test_make_symlink_copy_mode_creates_real_file(tmp_path, monkeypatch):
    monkeypatch.setattr(subset_manager, "_get_use_symlinks", lambda: False)
    src = tmp_path / "src.png"
    PILImage.new("RGB", (4, 4)).save(src, "PNG")
    dest = tmp_path / "dest.png"
    subset_manager._make_symlink(src, dest)
    assert dest.exists()
    assert not dest.is_symlink()
