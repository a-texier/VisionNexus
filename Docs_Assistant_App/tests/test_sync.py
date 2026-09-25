from __future__ import annotations

from pathlib import Path

from backend.core.store import Store, install_seed, peek_meta
from backend.core.sync import SyncManager
from tests.helpers import FakeEmbedder, page, prose


def count(store: Store, sql: str, *args) -> int:
    return store._conn().execute(sql, args).fetchone()[0]


def test_first_sync_embeds_everything_second_embeds_nothing(
    sync: SyncManager, embedder: FakeEmbedder, store: Store
) -> None:
    sync.run_blocking()
    n_chunks = count(store, "SELECT COUNT(*) FROM chunks")
    assert n_chunks == 12  # 2 apps x 2 langues x 3 sections (l'intro fusionne avec la premiere)
    assert len(embedder.passage_texts) == n_chunks
    assert count(store, "SELECT COUNT(*) FROM embeddings") == n_chunks
    assert count(store, "SELECT COUNT(*) FROM chunks_fts") == n_chunks

    embedder.passage_texts.clear()
    sync.run_blocking()
    assert embedder.passage_texts == []
    assert sync.status()["progress"]["files_total"] == 0


    sync.run_blocking()


def test_editing_one_section_reembeds_only_that_chunk(
    sync: SyncManager, embedder: FakeEmbedder, docs_root: Path
) -> None:
    sync.run_blocking()
    embedder.passage_texts.clear()
    path = docs_root / "DVC_App" / "docs" / "user-guide.md"
    path.write_text(path.read_text(encoding="utf-8").replace("endvcbeta3", "MODIFIE"), encoding="utf-8")

    sync.run_blocking()
    assert len(embedder.passage_texts) == 1
    assert "MODIFIE" in embedder.passage_texts[0] and "Beta section" in embedder.passage_texts[0]
    assert sync.status()["progress"]["files_total"] == 1


def test_renaming_or_moving_a_file_reembeds_nothing(
    sync: SyncManager, embedder: FakeEmbedder, docs_root: Path, store: Store
) -> None:
    sync.run_blocking()
    embedder.passage_texts.clear()
    old = docs_root / "DVC_App" / "docs" / "user-guide.md"
    new = docs_root / "DVC_App" / "docs" / "user-guide-renamed.md"
    old.rename(new)

    sync.run_blocking()
    assert embedder.passage_texts == []
    assert count(store, "SELECT COUNT(*) FROM files WHERE path = 'DVC_App/docs/user-guide.md'") == 0
    assert count(store, "SELECT COUNT(*) FROM chunks WHERE doc_name = 'user-guide-renamed'") == 3


def test_deleting_a_file_cleans_chunks_fts_and_embeddings(
    sync: SyncManager, docs_root: Path, store: Store
) -> None:
    sync.run_blocking()
    (docs_root / "DVC_App" / "docs" / "user-guide.fr.md").unlink()
    sync.run_blocking()
    assert count(store, "SELECT COUNT(*) FROM chunks WHERE file_path = 'DVC_App/docs/user-guide.fr.md'") == 0
    assert count(store, "SELECT COUNT(*) FROM chunks_fts") == count(store, "SELECT COUNT(*) FROM chunks") == 9
    assert count(store, "SELECT COUNT(*) FROM embeddings") == 9  # vecteurs orphelins supprimes
    assert count(store, "SELECT COUNT(*) FROM files") == 3


def test_changing_model_reembeds_everything_once(store: Store, docs_root: Path) -> None:
    first = FakeEmbedder(model_id="model-a")
    SyncManager(store, first, docs_root).run_blocking()
    assert len(first.passage_texts) == 12

    second = FakeEmbedder(model_id="model-b", dim=64)
    manager = SyncManager(store, second, docs_root)
    manager.run_blocking()
    assert len(second.passage_texts) == 12
    assert count(store, "SELECT COUNT(*) FROM embeddings WHERE model_id = 'model-a'") == 0
    assert count(store, "SELECT COUNT(*) FROM embeddings WHERE model_id = 'model-b'") == 12
    assert manager.snapshot.matrix.shape == (12, 64)

    second.passage_texts.clear()
    manager.run_blocking()
    assert second.passage_texts == []


def test_rebuild_drops_and_reembeds(sync: SyncManager, embedder: FakeEmbedder) -> None:
    sync.run_blocking()
    embedder.passage_texts.clear()
    sync.run_blocking(rebuild=True)
    assert len(embedder.passage_texts) == 12


def test_missing_model_keeps_keyword_index(store: Store, docs_root: Path) -> None:
    embedder = FakeEmbedder()
    embedder.is_available = False
    manager = SyncManager(store, embedder, docs_root)
    manager.run_blocking()
    assert count(store, "SELECT COUNT(*) FROM chunks") == 12
    assert count(store, "SELECT COUNT(*) FROM embeddings") == 0
    assert "introuvable" in manager.status()["last_error"]
    assert len(manager.snapshot.metas) == 12 and len(manager.snapshot.vec_ids) == 0

    # le modele arrive plus tard : une sync embedde ce qui manque, sans rien re-chunker
    embedder.is_available = True
    manager.run_blocking()
    assert len(embedder.passage_texts) == 12


def test_sync_reports_error_when_manifest_missing(
    store: Store, embedder: FakeEmbedder, tmp_path: Path
) -> None:
    manager = SyncManager(store, embedder, tmp_path / "vide")
    manager.run_blocking()
    assert "illisibles" in manager.status()["last_error"]
    assert manager.syncing is False


def test_start_is_idempotent_while_running(sync: SyncManager) -> None:
    sync._state["syncing"] = True
    assert sync.start() is False
    sync._state["syncing"] = False
    assert sync.start() is True
    sync.wait(30)
    assert sync.status()["last_sync_at"] is not None


def test_identical_text_in_two_files_shares_one_vector(
    store: Store, embedder: FakeEmbedder, docs_root: Path
) -> None:
    body = prose("shared", 80)
    for lang_dir in ("Annotation_App", "DVC_App"):
        (docs_root / lang_dir / "docs" / "user-guide.md").write_text(
            page("annotation", "user-guide", "en", "Same title", [("Same heading", body)]), encoding="utf-8"
        )
    SyncManager(store, embedder, docs_root).run_blocking()
    same = [t for t in embedder.passage_texts if "Same heading" in t]
    assert len(same) == 1  # meme chunk_hash : un seul embedding pour deux passages


def test_seed_install_requires_matching_model_and_schema(tmp_path: Path, docs_root: Path) -> None:
    seed = tmp_path / "seed.sqlite"
    seed_store = Store(seed)
    SyncManager(seed_store, FakeEmbedder(model_id="m1"), docs_root).run_blocking()
    seed_store.close()
    assert peek_meta(seed, "model_id") == "m1"

    other = tmp_path / "ws_other" / "index.sqlite"
    assert install_seed(seed, other, "m2") is False and not other.exists()

    target = tmp_path / "ws" / "index.sqlite"
    assert install_seed(seed, target, "m1") is True
    assert install_seed(seed, target, "m1") is False  # ne remplace jamais un index existant

    # avec le seed, la premiere sync n'embedde rien
    store = Store(target)
    embedder = FakeEmbedder(model_id="m1")
    SyncManager(store, embedder, docs_root).run_blocking()
    assert embedder.passage_texts == []
    store.close()
