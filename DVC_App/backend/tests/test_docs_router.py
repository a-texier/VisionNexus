# ============================================================
# Tests unitaires -- api/docs.py (doc markdown de la page Doc)
# Mini app FastAPI avec le seul router docs, sur un dossier docs temporaire.
# ============================================================

import json
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api import docs


@pytest.fixture
def docs_client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    docs_dir = tmp_path / "docs"
    (docs_dir / "assets").mkdir(parents=True)
    (docs_dir / "workflows.md").write_text(
        "---\ntitle: Workflows\norder: 20\ntags: [a, b]\n---\n# Workflows\n",
        encoding="utf-8",
    )
    (docs_dir / "workflows.fr.md").write_text(
        "---\ntitle: Flux de travail\n---\n# Flux\n", encoding="utf-8"
    )
    (docs_dir / "concepts.fr.md").write_text(
        "---\ntitle: Concepts FR\n---\nCorps\n", encoding="utf-8"
    )
    (docs_dir / "assets" / "shot.png").write_bytes(b"png")
    (tmp_path / "secret.md").write_text("secret", encoding="utf-8")

    manifest = tmp_path / "docs_manifest.json"
    manifest.write_text(
        json.dumps(
            {
                "doc_set": [
                    {"name": "workflows", "doc_type": "workflows", "audience": "user", "order": 20},
                    {"name": "concepts", "doc_type": "concepts", "audience": "user", "order": 30},
                    {"name": "code-map", "doc_type": "code-map", "audience": "dev", "order": 80},
                ]
            }
        ),
        encoding="utf-8",
    )

    monkeypatch.setattr(docs, "DOCS_DIR", docs_dir)
    monkeypatch.setattr(docs, "MANIFEST_PATH", manifest)
    app = FastAPI()
    app.include_router(docs.router)
    return TestClient(app)


def test_real_docs_dir_points_to_app_docs():
    assert docs.DOCS_DIR.parent.name == docs.APP_DIR.name
    assert (docs.APP_DIR / "backend" / "api" / "docs.py").is_file()


def test_parse_frontmatter_subset():
    meta, body = docs.parse_frontmatter(
        "---\napp: dvc\norder: 10\ntags: [x, 'y z']\nempty: []\ntitle: \"A: B\"\n---\n\n# H\n"
    )
    assert meta == {"app": "dvc", "order": 10, "tags": ["x", "y z"], "empty": [], "title": "A: B"}
    assert body == "# H\n"


def test_parse_frontmatter_absent_or_unclosed():
    assert docs.parse_frontmatter("# Titre\n") == ({}, "# Titre\n")
    assert docs.parse_frontmatter("---\ntitle: x\n# pas de fin\n")[0] == {}


def test_missing_manifest_falls_back_to_builtin(tmp_path: Path):
    names = [e["name"] for e in docs.load_doc_set(tmp_path / "absent.json")]
    assert names[0] == "README" and "code-map" in names and len(names) == 9


def test_list_docs_titles_and_langs(docs_client: TestClient):
    pages = docs_client.get("/api/docs", params={"lang": "fr"}).json()
    by_name = {p["name"]: p for p in pages}
    assert [p["name"] for p in pages] == ["workflows", "concepts", "code-map"]
    assert by_name["workflows"]["title"] == "Flux de travail"
    assert by_name["workflows"]["langs"] == ["en", "fr"]
    assert by_name["code-map"]["langs"] == []


def test_get_doc_lang_fallback(docs_client: TestClient):
    data = docs_client.get("/api/docs/concepts", params={"lang": "en"}).json()
    assert data["lang"] == "fr"
    assert data["title"] == "Concepts FR"
    assert data["body"] == "Corps\n"
    assert docs_client.get("/api/docs/workflows").json()["frontmatter"]["tags"] == ["a", "b"]


def test_get_doc_name_validation(docs_client: TestClient):
    assert docs_client.get("/api/docs/secret").status_code == 404
    assert docs_client.get("/api/docs/..%2Fsecret").status_code == 404
    assert docs_client.get("/api/docs/code-map").status_code == 404
    assert docs_client.get("/api/docs/workflows", params={"lang": "de"}).status_code == 422


def test_assets_safe_join(docs_client: TestClient, tmp_path: Path):
    assert docs_client.get("/api/docs/assets/shot.png").content == b"png"
    assert docs_client.get("/api/docs/assets/missing.png").status_code == 404
    assets = tmp_path / "docs" / "assets"
    assert docs.safe_asset_path(assets, "../workflows.md") is None
    assert docs.safe_asset_path(assets, "/etc/passwd") is None
    assert docs.safe_asset_path(assets, "..\\secret.md") is None
    assert docs.safe_asset_path(assets, "C:/secret.md") is None
