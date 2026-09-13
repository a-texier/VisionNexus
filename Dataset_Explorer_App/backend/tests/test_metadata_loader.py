# ============================================================
# tests/test_metadata_loader.py
# Tests unitaires : lecture CSV/Excel + association image <-> ligne.
# ============================================================

import pytest

from backend.core.metadata_loader import (
    build_key_map,
    match_image,
    preview,
)


def _write_csv(tmp_path, name, content, encoding="utf-8"):
    p = tmp_path / name
    p.write_text(content, encoding=encoding)
    return p


# ------------------------------------------------------------------ #
# preview()
# ------------------------------------------------------------------ #

def test_preview_missing_file_raises():
    with pytest.raises(ValueError):
        preview("C:/nope/missing.csv")


def test_preview_unsupported_extension_raises(tmp_path):
    p = tmp_path / "data.docx"
    p.write_text("hello", encoding="utf-8")
    with pytest.raises(ValueError):
        preview(str(p))


def test_preview_basic_csv(tmp_path):
    p = _write_csv(tmp_path, "meta.csv", "filename,label\nimg1.jpg,cat\nimg2.jpg,dog\n")
    result = preview(str(p))
    assert result["columns"] == ["filename", "label"]
    assert result["n_rows"] == 2
    assert result["format"] == "csv"
    assert result["sample_rows"][0]["filename"] == "img1.jpg"


def test_preview_semicolon_separator(tmp_path):
    p = _write_csv(tmp_path, "meta.csv", "filename;label\nimg1.jpg;cat\nimg2.jpg;dog\n")
    result = preview(str(p))
    assert result["columns"] == ["filename", "label"]


def test_preview_n_rows_limit(tmp_path):
    rows = "\n".join(f"img{i}.jpg,label{i}" for i in range(20))
    p = _write_csv(tmp_path, "meta.csv", f"filename,label\n{rows}\n")
    result = preview(str(p), n_rows=3)
    assert len(result["sample_rows"]) == 3
    assert result["n_rows"] == 20


def test_preview_latin1_fallback(tmp_path):
    """Fichier encode en latin-1 (accents) doit se lire malgre l'echec utf-8."""
    p = tmp_path / "meta.csv"
    p.write_bytes("filename,label\nimg1.jpg,caf\xe9\n".encode("latin-1"))
    result = preview(str(p))
    assert result["columns"] == ["filename", "label"]
    assert result["n_rows"] == 1


def test_preview_empty_values_become_empty_string(tmp_path):
    p = _write_csv(tmp_path, "meta.csv", "filename,label\nimg1.jpg,\n")
    result = preview(str(p))
    assert result["sample_rows"][0]["label"] == ""


# ------------------------------------------------------------------ #
# build_key_map() + match_image()
# ------------------------------------------------------------------ #

def test_build_key_map_default_first_column(tmp_path):
    p = _write_csv(tmp_path, "meta.csv", "filename,label\nimg1.jpg,cat\nimg2.jpg,dog\n")
    key_map, columns = build_key_map(str(p), key_column=None)
    assert columns == ["filename", "label"]
    assert "img1.jpg" in key_map
    assert key_map["img1.jpg"]["label"] == "cat"


def test_build_key_map_explicit_key_column(tmp_path):
    p = _write_csv(tmp_path, "meta.csv", "id,filename,label\n1,img1.jpg,cat\n2,img2.jpg,dog\n")
    key_map, columns = build_key_map(str(p), key_column="filename")
    assert "img1.jpg" in key_map
    assert key_map["img1.jpg"]["id"] == "1"


def test_build_key_map_indexes_stem_variant(tmp_path):
    """La cle 'img1.jpg' doit aussi etre indexee sous sa forme sans extension 'img1'."""
    p = _write_csv(tmp_path, "meta.csv", "filename,label\nimg1.jpg,cat\n")
    key_map, _ = build_key_map(str(p), key_column="filename")
    assert "img1" in key_map
    assert "img1.jpg" in key_map


def test_build_key_map_invalid_key_column_falls_back_to_first(tmp_path):
    p = _write_csv(tmp_path, "meta.csv", "filename,label\nimg1.jpg,cat\n")
    key_map, columns = build_key_map(str(p), key_column="does_not_exist")
    # Retombe sur la premiere colonne ("filename")
    assert "img1.jpg" in key_map


def test_build_key_map_empty_keys_are_skipped(tmp_path):
    p = _write_csv(tmp_path, "meta.csv", "filename,label\n,cat\nimg2.jpg,dog\n")
    key_map, _ = build_key_map(str(p), key_column="filename")
    # "img2.jpg" indexe 2 variantes (nom complet + stem sans extension) ; la
    # ligne a cle vide ("," -> "") ne doit produire aucune entree.
    assert len(key_map) == 2
    assert "img2.jpg" in key_map
    assert "img2" in key_map
    assert "" not in key_map


def test_match_image_by_full_name(tmp_path):
    p = _write_csv(tmp_path, "meta.csv", "filename,label\nimg1.jpg,cat\n")
    key_map, _ = build_key_map(str(p), key_column="filename")
    hit = match_image("img1.jpg", key_map)
    assert hit is not None
    assert hit["label"] == "cat"


def test_match_image_by_stem_only(tmp_path):
    """La metadonnee est indexee par 'photo123', on doit retrouver 'photo123.png'."""
    p = _write_csv(tmp_path, "meta.csv", "filename,label\nphoto123,rare\n")
    key_map, _ = build_key_map(str(p), key_column="filename")
    hit = match_image("photo123.png", key_map)
    assert hit is not None
    assert hit["label"] == "rare"


def test_match_image_case_insensitive(tmp_path):
    p = _write_csv(tmp_path, "meta.csv", "filename,label\nIMG1.JPG,cat\n")
    key_map, _ = build_key_map(str(p), key_column="filename")
    hit = match_image("img1.jpg", key_map)
    assert hit is not None


def test_match_image_no_match_returns_none(tmp_path):
    p = _write_csv(tmp_path, "meta.csv", "filename,label\nimg1.jpg,cat\n")
    key_map, _ = build_key_map(str(p), key_column="filename")
    assert match_image("unknown.jpg", key_map) is None


def test_match_image_empty_key_map_returns_none():
    assert match_image("anything.jpg", {}) is None


def test_build_key_map_empty_file_returns_empty(tmp_path):
    p = _write_csv(tmp_path, "meta.csv", "filename,label\n")
    key_map, columns = build_key_map(str(p), key_column="filename")
    assert key_map == {}
    assert columns == ["filename", "label"]
