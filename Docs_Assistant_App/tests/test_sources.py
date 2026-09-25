from __future__ import annotations

import json
from pathlib import Path

import pytest

from backend.core.sources import docs_relpath, scan_sources, split_doc_name, split_frontmatter

BOM = chr(0xFEFF)


def test_frontmatter_basic_types() -> None:
    text = (
        "---\napp: annotation\ntitle: \"Guide: rapide\"\ntags: [a, 'b c', ]\nempty: []\norder: 20\n---\n# T\n"
    )
    meta, body = split_frontmatter(text)
    assert meta["app"] == "annotation"
    assert meta["title"] == "Guide: rapide"
    assert meta["tags"] == ["a", "b c"]
    assert meta["empty"] == []
    assert meta["order"] == "20"
    assert body == "# T\n"


def test_frontmatter_missing_or_unclosed() -> None:
    assert split_frontmatter("# T\n\ntext") == ({}, "# T\n\ntext")
    meta, body = split_frontmatter("---\napp: x\n# jamais ferme\n")
    assert meta == {} and body.startswith("---")


def test_frontmatter_bom_and_crlf() -> None:
    meta, body = split_frontmatter(BOM + "---\r\napp: dvc\r\nlang: fr\r\n---\r\n# T\r\ntexte\r\n")
    assert meta == {"app": "dvc", "lang": "fr"}
    assert "\r" not in body


def test_frontmatter_ignores_invalid_lines_and_comments() -> None:
    meta, _ = split_frontmatter("---\n# commentaire\napp: dvc\nligne sans deux points\n  \n---\nx")
    assert meta == {"app": "dvc"}


def test_frontmatter_first_dashes_must_be_first_line() -> None:
    meta, body = split_frontmatter("\n---\napp: dvc\n---\nx")
    assert meta == {} and "app: dvc" in body


@pytest.mark.parametrize(
    ("name", "expected"),
    [
        ("user-guide.md", ("user-guide", "en")),
        ("user-guide.fr.md", ("user-guide", "fr")),
        ("README.FR.md", ("README", "fr")),
    ],
)
def test_split_doc_name(name: str, expected: tuple[str, str]) -> None:
    assert split_doc_name(name) == expected


def test_scan_sources_reads_indexed_apps_only(docs_root: Path) -> None:
    docs = scan_sources(docs_root)
    assert {d.app for d in docs} == {"annotation", "dvc"}
    assert len(docs) == 4
    fr = next(d for d in docs if d.app == "dvc" and d.lang == "fr")
    assert fr.path == "DVC_App/docs/user-guide.fr.md"
    assert fr.doc_name == "user-guide" and fr.audience == "user" and fr.tags == ("alpha", "beta")
    assert fr.body.startswith("\n# ") or fr.body.lstrip().startswith("# ")


def test_scan_sources_lenient_without_frontmatter(docs_root: Path) -> None:
    (docs_root / "DVC_App" / "docs" / "architecture.fr.md").write_text(
        "# Architecture DVC\n\ntexte\n", encoding="utf-8"
    )
    doc = next(d for d in scan_sources(docs_root) if d.doc_name == "architecture")
    # app, lang, doc_type et audience sont deduits de la source, du nom et du doc_set
    assert (doc.app, doc.lang, doc.doc_type, doc.audience) == ("dvc", "fr", "architecture", "dev")
    assert doc.title == "Architecture DVC"


def test_scan_sources_plugin_pages(docs_root: Path) -> None:
    page_dir = docs_root / "plugins" / "vn_plugin" / "docs" / "Annotation_App"
    page_dir.mkdir(parents=True)
    (page_dir / "plugin-notes.md").write_text("# Plugin notes\n\nhello\n", encoding="utf-8")
    docs = scan_sources(docs_root)
    plugin = next(d for d in docs if d.doc_name == "plugin-notes")
    assert plugin.app == "annotation" and plugin.path.startswith("plugins/vn_plugin/")


def test_scan_sources_docs_path_source(docs_root: Path) -> None:
    # La suite declare docs_path "docs" (dir "."): ses pages sont a la racine du depot.
    meta = "app: suite\ndoc_type: README\naudience: both\nlang: en\ntitle: Suite"
    page = f"---\n{meta}\n---\n# Suite\n\ntexte\n"
    (docs_root / "docs" / "README.md").write_text(page, encoding="utf-8")
    (docs_root / "docs" / "assets").mkdir()
    (docs_root / "docs" / "assets" / "notes.md").write_text("# ignore\n", encoding="utf-8")
    suite = [d for d in scan_sources(docs_root) if d.app == "suite"]
    assert [d.path for d in suite] == ["docs/README.md"]


def test_docs_relpath() -> None:
    assert docs_relpath({"id": "dvc", "dir": "DVC_App"}) == "DVC_App/docs"
    assert docs_relpath({"id": "suite", "dir": ".", "docs_path": "docs"}) == "docs"


def test_scan_sources_skips_non_utf8(docs_root: Path) -> None:
    (docs_root / "DVC_App" / "docs" / "bad.md").write_bytes(b"\xff\xfe\x00bad")
    assert all(d.doc_name != "bad" for d in scan_sources(docs_root))


def test_scan_sources_missing_manifest(tmp_path: Path) -> None:
    with pytest.raises(OSError):
        scan_sources(tmp_path)


def test_scan_sources_broken_manifest(tmp_path: Path) -> None:
    (tmp_path / "docs").mkdir()
    (tmp_path / "docs" / "docs_manifest.json").write_text("{nope", encoding="utf-8")
    with pytest.raises(json.JSONDecodeError):
        scan_sources(tmp_path)
