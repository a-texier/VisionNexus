# ============================================================
# tests/test_semantic.py
# Tests unitaires : recherche sémantique texte → images.
# ============================================================

import os
from pathlib import Path

import numpy as np
import pytest

TEST_DATASET_DIR = Path(
    os.environ.get(
        "TEST_DATASET_DIR",
        str(Path(__file__).parent.parent.parent.parent / "Annotation_App" / "data_test" / "test dev" / "img"),
    )
)


def _build_test_index(embedder, indexer, image_paths, dataset_id=99, tmp_faiss_dir=None):
    """Helper : crée un index FAISS depuis une liste d'images."""
    import backend.config as cfg
    if tmp_faiss_dir:
        cfg.FAISS_DIR = tmp_faiss_dir

    embs = embedder.embed_images([str(p) for p in image_paths])
    indexer.build(dataset_id=dataset_id, embeddings=embs)
    return embs


@pytest.fixture(scope="module")
def embedder_loaded():
    from backend.core.embedder import CLIPEmbedder
    e = CLIPEmbedder()
    e.load()
    return e


def test_embed_text_shape(embedder_loaded):
    """Le vecteur texte doit avoir la forme (512,) et être L2-normalisé."""
    vec = embedder_loaded.embed_text("a car driving on the road")
    assert vec.shape == (512,), f"Forme inattendue : {vec.shape}"
    assert vec.dtype == np.float32
    norm = np.linalg.norm(vec)
    assert abs(norm - 1.0) < 1e-4, f"Norme L2 inattendue : {norm}"


def test_embed_text_different_queries(embedder_loaded):
    """Deux requêtes différentes produisent des vecteurs différents."""
    v1 = embedder_loaded.embed_text("car")
    v2 = embedder_loaded.embed_text("tree")
    sim = float(np.dot(v1, v2))
    assert sim < 0.99, "Deux requêtes distinctes ne devraient pas être identiques"


@pytest.mark.skipif(not TEST_DATASET_DIR.exists(), reason="Dataset test absent")
def test_semantic_search_returns_top_k(tmp_path):
    """Recherche sur le vrai dataset : top_k résultats retournés."""
    from backend.core.embedder import CLIPEmbedder
    from backend.core.indexer import FAISSIndexer
    import backend.config as cfg

    original_faiss_dir = cfg.FAISS_DIR
    cfg.FAISS_DIR = tmp_path / "faiss"

    try:
        embedder = CLIPEmbedder()
        embedder.load()
        indexer = FAISSIndexer()

        paths = list(TEST_DATASET_DIR.glob("*.jpg"))[:20]
        assert len(paths) >= 5, "Besoin d'au moins 5 images pour ce test"

        embs = embedder.embed_images([str(p) for p in paths])
        indexer.build(dataset_id=99, embeddings=embs)

        # Mock session
        class FakeImage:
            def __init__(self, i, path):
                self.id = i
                self.filename = path.name
                self.thumbnail_path = None
                self.cluster_id = None
                self.rarity_score = None
                self.umap_x = None
                self.umap_y = None

        class FakeResult(list):
            """Imite l'objet renvoye par Session.exec() : liste + .all()."""
            def all(self):
                return list(self)

        class FakeSession:
            def exec(self, _):
                return FakeResult(FakeImage(i, p) for i, p in enumerate(paths))

        # Remplacer faiss_indexer global par notre instance de test
        import backend.core.semantic_filter as sm
        original_indexer = sm.faiss_indexer
        sm.faiss_indexer = indexer

        original_embedder = sm.clip_embedder
        sm.clip_embedder = embedder

        try:
            top_k = 5
            results = sm.semantic_search(99, "car", top_k, FakeSession())
            assert len(results) == top_k, f"Attendu {top_k} résultats, reçu {len(results)}"

            # Scores décroissants
            scores = [r["score"] for r in results]
            assert scores == sorted(scores, reverse=True), "Scores non triés"

            # Scores dans [0, 1]
            assert all(0.0 <= s <= 1.0 for s in scores), f"Scores hors plage : {scores}"

            # Rank correct
            for i, r in enumerate(results):
                assert r["rank"] == i + 1
        finally:
            sm.faiss_indexer = original_indexer
            sm.clip_embedder = original_embedder
    finally:
        cfg.FAISS_DIR = original_faiss_dir
