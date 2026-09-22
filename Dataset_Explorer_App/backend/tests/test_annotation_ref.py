# ============================================================
# tests/test_annotation_ref.py
# Tests unitaires : détection de format d'annotation + comptage.
# ============================================================

from backend.core.annotation_ref import describe_annotations


# ------------------------------------------------------------------ #
# Entrées invalides / absentes
# ------------------------------------------------------------------ #

def test_describe_annotations_empty_path_returns_none():
    assert describe_annotations("") is None


def test_describe_annotations_missing_path_returns_none():
    assert describe_annotations("C:/does/not/exist.ver") is None


def test_describe_annotations_unknown_extension_returns_none(tmp_path):
    p = tmp_path / "data.json"
    p.write_text("{}", encoding="utf-8")
    assert describe_annotations(str(p)) is None


# ------------------------------------------------------------------ #
# .ver (natif)
# ------------------------------------------------------------------ #

def test_describe_annotations_ver_format(tmp_path):
    p = tmp_path / "seq.ver"
    p.write_text(
        "# comment\n"
        "0 1 10 10 50 50 1 car\n"
        "0 1 60 60 90 90 1 car\n"
        "1 1 12 12 52 52 1 car\n",
        encoding="utf-8",
    )
    result = describe_annotations(str(p))
    assert result["format"] == "ver"
    assert result["frames"] == 2      # frame_id 0 et 1
    assert result["boxes"] == 3


def test_describe_annotations_ver_ignores_short_lines(tmp_path):
    """Lignes avec moins de 6 tokens doivent etre ignorees (pas une box valide)."""
    p = tmp_path / "seq.ver"
    p.write_text("0 1 2 3\n0 1 10 10 50 50 1 car\n", encoding="utf-8")
    result = describe_annotations(str(p))
    assert result["boxes"] == 1


def test_describe_annotations_ver_empty_file(tmp_path):
    p = tmp_path / "seq.ver"
    p.write_text("", encoding="utf-8")
    result = describe_annotations(str(p))
    assert result == {"format": "ver", "frames": 0, "boxes": 0}


# ------------------------------------------------------------------ #
# .txt YOLO fusionné (>= 6 colonnes => multi-frame)
# ------------------------------------------------------------------ #

def test_describe_annotations_yolo_txt_multiframe(tmp_path):
    p = tmp_path / "merged.txt"
    p.write_text(
        "0 0 0.5 0.5 0.1 0.1\n"
        "0 1 0.4 0.4 0.1 0.1\n"
        "1 0 0.5 0.5 0.1 0.1\n",
        encoding="utf-8",
    )
    result = describe_annotations(str(p))
    assert result["format"] == "yolo_txt"
    assert result["frames"] == 2
    assert result["boxes"] == 3


def test_describe_annotations_yolo_txt_single_frame(tmp_path):
    """< 6 colonnes => format YOLO mono-frame classique (class cx cy w h)."""
    p = tmp_path / "frame.txt"
    p.write_text("0 0.5 0.5 0.1 0.1\n1 0.4 0.4 0.2 0.2\n", encoding="utf-8")
    result = describe_annotations(str(p))
    assert result["format"] == "yolo_txt"
    assert result["frames"] == 1
    assert result["boxes"] == 2


def test_describe_annotations_yolo_txt_empty_file(tmp_path):
    p = tmp_path / "empty.txt"
    p.write_text("", encoding="utf-8")
    result = describe_annotations(str(p))
    assert result["format"] == "yolo_txt"
    assert result["boxes"] == 0


# ------------------------------------------------------------------ #
# Dossier YOLO (un .txt par frame)
# ------------------------------------------------------------------ #

def test_describe_annotations_yolo_folder(tmp_path):
    d = tmp_path / "labels"
    d.mkdir()
    (d / "frame0.txt").write_text("0 0.5 0.5 0.1 0.1\n1 0.4 0.4 0.2 0.2\n", encoding="utf-8")
    (d / "frame1.txt").write_text("0 0.5 0.5 0.1 0.1\n", encoding="utf-8")
    result = describe_annotations(str(d))
    assert result["format"] == "yolo_folder"
    assert result["frames"] == 2
    assert result["boxes"] == 3


def test_describe_annotations_empty_folder_returns_none(tmp_path):
    d = tmp_path / "empty_labels"
    d.mkdir()
    assert describe_annotations(str(d)) is None


def test_describe_annotations_yolo_folder_ignores_comments(tmp_path):
    d = tmp_path / "labels"
    d.mkdir()
    (d / "frame0.txt").write_text("# comment\n0 0.5 0.5 0.1 0.1\n", encoding="utf-8")
    result = describe_annotations(str(d))
    assert result["boxes"] == 1
