# ============================================================
# Tests unitaires — backend/services/dataset_service.py
# Se limite aux fonctions pures / IO fichier simples (tri naturel,
# chemins, classes.yaml). Les fonctions d'import video/optional_format/GPU ne sont
# pas couvertes ici (nécessitent des fichiers médias réels + cv2 lourd).
# ============================================================

import pytest

from backend.services.dataset_service import DatasetService, natural_sort_key, dataset_service

pytestmark = pytest.mark.unit


# ---------------------------------------------------------------- natural_sort_key

def test_natural_sort_key_orders_numbers_numerically():
    names = ["frame_10.png", "frame_2.png", "frame_1.png"]
    ordered = sorted(names, key=natural_sort_key)
    assert ordered == ["frame_1.png", "frame_2.png", "frame_10.png"]


def test_natural_sort_key_handles_unix_timestamps():
    names = ["1700000200.jpg", "1700000001.jpg", "1700000050.jpg"]
    ordered = sorted(names, key=natural_sort_key)
    assert ordered == ["1700000001.jpg", "1700000050.jpg", "1700000200.jpg"]


def test_natural_sort_key_is_case_insensitive_for_text_chunks():
    names = ["Frame_1.png", "frame_2.png"]
    ordered = sorted(names, key=natural_sort_key)
    assert ordered == ["Frame_1.png", "frame_2.png"]


def test_natural_sort_key_no_digits_falls_back_to_lexicographic():
    names = ["banana.png", "apple.png"]
    ordered = sorted(names, key=natural_sort_key)
    assert ordered == ["apple.png", "banana.png"]


# ---------------------------------------------------------------- chemins projet

def test_get_project_dir_and_frames_dir_are_nested(tmp_path, monkeypatch):
    svc = DatasetService.__new__(DatasetService)
    svc.projects_dir = tmp_path / "projects"
    svc.exports_dir = tmp_path / "exports"
    svc.projects_dir.mkdir()
    svc.exports_dir.mkdir()

    project_dir = svc.get_project_dir(42)
    assert project_dir == svc.projects_dir / "42"

    frames_dir = svc.get_frames_dir(42)
    assert frames_dir == project_dir / "frames"
    assert frames_dir.exists()  # cree a la demande


def test_get_thumbnail_path_replaces_extension(tmp_path):
    svc = DatasetService.__new__(DatasetService)
    svc.projects_dir = tmp_path / "projects"
    svc.exports_dir = tmp_path / "exports"
    svc.projects_dir.mkdir()
    svc.exports_dir.mkdir()

    thumb = svc.get_thumbnail_path(1, "frame_0005.png")
    assert thumb.name == "frame_0005_thumb.jpg"


# ---------------------------------------------------------------- classes.yaml (singleton reel, workspace isole par conftest)

def test_write_and_read_classes_yaml_roundtrip():
    project_id = 999_001  # id improbable pour eviter les collisions avec d'autres tests
    dataset_service.write_classes_yaml(
        project_id,
        class_names=["voiture", "camion"],
        class_colors=["#3B82F6", "#EF4444"],
    )
    classes = dataset_service.read_classes_yaml(project_id)
    assert classes == [
        {"name": "voiture", "color": "#3B82F6"},
        {"name": "camion", "color": "#EF4444"},
    ]


def test_read_classes_yaml_missing_file_returns_empty_list():
    classes = dataset_service.read_classes_yaml(999_002)
    assert classes == []
