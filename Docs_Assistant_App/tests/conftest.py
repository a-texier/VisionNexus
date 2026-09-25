"""Fixtures communes : arbre de docs temporaire, settings, store, sync."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from backend.config import Settings
from backend.core.store import Store
from backend.core.sync import SyncManager
from tests.helpers import MANIFEST, FakeEmbedder, make_settings, page, prose


@pytest.fixture
def docs_root(tmp_path: Path) -> Path:
    root = tmp_path / "repo"
    (root / "docs").mkdir(parents=True)
    (root / "docs" / "docs_manifest.json").write_text(json.dumps(MANIFEST), encoding="utf-8")
    for app_dir, app in (("Annotation_App", "annotation"), ("DVC_App", "dvc")):
        docs = root / app_dir / "docs"
        docs.mkdir(parents=True)
        for lang, suffix in (("en", ".md"), ("fr", ".fr.md")):
            sections = [
                ("Alpha section", prose(f"{lang}{app}alpha", 80)),
                ("Beta section", prose(f"{lang}{app}beta", 80)),
                ("Gamma section", prose(f"{lang}{app}gamma", 80)),
            ]
            (docs / f"user-guide{suffix}").write_text(
                page(app, "user-guide", lang, "User guide" if lang == "en" else "Guide", sections),
                encoding="utf-8",
            )
    )
    return root


@pytest.fixture
def settings(tmp_path: Path, docs_root: Path) -> Settings:
    return make_settings(tmp_path, docs_root)


@pytest.fixture
def embedder() -> FakeEmbedder:
    return FakeEmbedder()


@pytest.fixture
def store(tmp_path: Path):
    s = Store(tmp_path / "index.sqlite")
    yield s
    s.close()


@pytest.fixture
def sync(store: Store, embedder: FakeEmbedder, docs_root: Path) -> SyncManager:
    return SyncManager(store, embedder, docs_root)
