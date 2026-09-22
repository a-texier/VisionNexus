# ============================================================
# tests/test_indexer.py
# Tests unitaires : FAISSIndexer.
# ============================================================

import tempfile
from pathlib import Path

import numpy as np
import pytest

from backend.core.indexer import FAISSIndexer


def _random_l2(n: int, dim: int = 512) -> np.ndarray:
    """Génère n vecteurs L2-normalisés aléatoires."""
    vecs = np.random.randn(n, dim).astype(np.float32)
    norms = np.linalg.norm(vecs, axis=1, keepdims=True)
    return vecs / (norms + 1e-8)


# ------------------------------------------------------------------ #

def test_build_and_search_self(tmp_path):
    """Top-1 d'un vecteur doit être lui-même (score ≈ 1.0)."""
    import backend.config as cfg
    import backend.core.indexer as indexer_mod
    # indexer.py fait "from backend.config import FAISS_DIR" (import de valeur) :
    # patcher cfg.FAISS_DIR seul ne suffit pas, il faut aussi patcher le nom
    # lie dans le module indexer lui-meme (utilise par _index_path()).
    original_faiss_dir = cfg.FAISS_DIR
    cfg.FAISS_DIR = tmp_path / "faiss"
    indexer_mod.FAISS_DIR = cfg.FAISS_DIR

    try:
        indexer = FAISSIndexer()
        embs = _random_l2(20)
        indexer.build(dataset_id=1, embeddings=embs)

        scores, indices = indexer.search(1, embs[0:1], top_k=1)
        assert indices[0][0] == 0, "Top-1 devrait être l'index 0 (lui-même)"
        assert abs(scores[0][0] - 1.0) < 1e-4, f"Score attendu ~1.0, reçu {scores[0][0]}"
    finally:
        cfg.FAISS_DIR = original_faiss_dir
        indexer_mod.FAISS_DIR = original_faiss_dir


def test_duplicate_detection(tmp_path):
    """
    5 vecteurs dont 2 paires quasi-identiques.
    La détection doit retourner exactement 2 groupes.
    """
    import backend.config as cfg
    import backend.core.indexer as indexer_mod
    original_faiss_dir = cfg.FAISS_DIR
    cfg.FAISS_DIR = tmp_path / "faiss"
    indexer_mod.FAISS_DIR = cfg.FAISS_DIR

    try:
        indexer = FAISSIndexer()

        base = _random_l2(3)  # 3 vecteurs distincts

        # Paire 1 : base[0] + légère perturbation
        noise1 = np.random.randn(512).astype(np.float32) * 0.001
        dup1 = base[0] + noise1
        dup1 /= np.linalg.norm(dup1)

        # Paire 2 : base[1] + légère perturbation
        noise2 = np.random.randn(512).astype(np.float32) * 0.001
        dup2 = base[1] + noise2
        dup2 /= np.linalg.norm(dup2)

        # Ordre : [base[0], dup1, base[1], dup2, base[2]]
        embs = np.stack([base[0], dup1, base[1], dup2, base[2]])

        indexer.build(dataset_id=2, embeddings=embs)
        groups = indexer.find_duplicates(2, threshold=0.99)

        assert len(groups) == 2, f"2 groupes attendus, reçu {len(groups)}: {groups}"
        sizes = sorted(len(g) for g in groups)
        assert sizes == [2, 2], f"Chaque groupe doit avoir 2 membres : {sizes}"
    finally:
        cfg.FAISS_DIR = original_faiss_dir
        indexer_mod.FAISS_DIR = original_faiss_dir


def test_index_persistence(tmp_path):
    """Index sauvegardé puis rechargé → mêmes résultats de recherche."""
    import backend.config as cfg
    import backend.core.indexer as indexer_mod
    original_faiss_dir = cfg.FAISS_DIR
    cfg.FAISS_DIR = tmp_path / "faiss"
    indexer_mod.FAISS_DIR = cfg.FAISS_DIR

    try:
        indexer1 = FAISSIndexer()
        embs = _random_l2(15)
        indexer1.build(dataset_id=3, embeddings=embs)
        scores1, indices1 = indexer1.search(3, embs[5:6], top_k=3)

        index_path = str(cfg.FAISS_DIR / "3" / "index.faiss")
        indexer2 = FAISSIndexer()
        indexer2.load(dataset_id=3, index_path=index_path)
        scores2, indices2 = indexer2.search(3, embs[5:6], top_k=3)

        np.testing.assert_array_equal(indices1, indices2)
        np.testing.assert_allclose(scores1, scores2, atol=1e-5)
    finally:
        cfg.FAISS_DIR = original_faiss_dir
        indexer_mod.FAISS_DIR = original_faiss_dir


def test_no_duplicates_below_threshold(tmp_path):
    """Des vecteurs distincts ne doivent pas former de groupes à threshold=0.99."""
    import backend.config as cfg
    import backend.core.indexer as indexer_mod
    original_faiss_dir = cfg.FAISS_DIR
    cfg.FAISS_DIR = tmp_path / "faiss"
    indexer_mod.FAISS_DIR = cfg.FAISS_DIR

    try:
        indexer = FAISSIndexer()
        embs = _random_l2(10)
        indexer.build(dataset_id=4, embeddings=embs)
        groups = indexer.find_duplicates(4, threshold=0.99)
        assert groups == [], f"Aucun doublon attendu : {groups}"
    finally:
        cfg.FAISS_DIR = original_faiss_dir
        indexer_mod.FAISS_DIR = original_faiss_dir
