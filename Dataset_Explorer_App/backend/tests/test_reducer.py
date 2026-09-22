# ============================================================
# tests/test_reducer.py
# Tests unitaires : UMAPReducer (UMAP / t-SNE / PCA).
# ============================================================

import numpy as np
import pytest

from backend.core.reducer import UMAPReducer


@pytest.fixture()
def reducer():
    return UMAPReducer()


def _random_embeddings(n, dim=32, seed=0):
    rng = np.random.RandomState(seed)
    return rng.randn(n, dim).astype(np.float32)


# ------------------------------------------------------------------ #
# PCA (méthode explicite — rapide, déterministe)
# ------------------------------------------------------------------ #

def test_pca_shape(reducer):
    embs = _random_embeddings(20)
    coords = reducer.reduce(embs, params={"method": "pca"})
    assert coords.shape == (20, 2)
    assert coords.dtype == np.float32


def test_pca_deterministic(reducer):
    embs = _random_embeddings(15)
    c1 = reducer.reduce(embs, params={"method": "pca"})
    c2 = reducer.reduce(embs, params={"method": "pca"})
    np.testing.assert_allclose(c1, c2)


def test_pca_single_point_pads_to_2d(reducer):
    """1 seul point => PCA(n_components=0), le resultat doit quand meme etre pad a (1, 2)."""
    embs = np.random.randn(1, 8).astype(np.float32)
    coords = reducer.reduce(embs, params={"method": "pca"})
    assert coords.shape == (1, 2)
    assert np.allclose(coords, 0.0)


def test_pca_pads_to_2d_when_fewer_features(reducer):
    """1 seule feature d'entree => PCA ne peut produire qu'1 composante, complete a 2D avec des zeros."""
    embs = np.random.randn(10, 1).astype(np.float32)
    coords = reducer.reduce(embs, params={"method": "pca"})
    assert coords.shape == (10, 2)
    assert np.allclose(coords[:, 1], 0.0)


# ------------------------------------------------------------------ #
# t-SNE (méthode explicite)
# ------------------------------------------------------------------ #

def test_tsne_shape(reducer):
    embs = _random_embeddings(20)
    coords = reducer.reduce(embs, params={"method": "tsne", "tsne_perplexity": 5})
    assert coords.shape == (20, 2)
    assert coords.dtype == np.float32


# ------------------------------------------------------------------ #
# Cas limites — trop peu de points
# ------------------------------------------------------------------ #

def test_reduce_zero_points_fallback_pca(reducer):
    embs = np.zeros((0, 8), dtype=np.float32)
    coords = reducer.reduce(embs, params={"method": "umap"})
    assert coords.shape == (0, 2)


def test_reduce_two_points_umap_falls_back(reducer):
    """UMAP a besoin d'au moins 4 points => repli sur t-SNE puis potentiellement PCA."""
    embs = _random_embeddings(2)
    coords = reducer.reduce(embs, params={"method": "umap"})
    assert coords.shape == (2, 2)


def test_reduce_default_params_uses_settings(reducer, tmp_path, monkeypatch):
    """params=None => lit les settings utilisateur (comportement historique)."""
    import backend.api.settings as settings_mod

    def fake_load_settings():
        class FakeSettings:
            reduction_method = "pca"
            umap_n_neighbors = 15
            umap_min_dist = 0.1
            tsne_perplexity = 30
            tsne_learning_rate = 200.0
        return FakeSettings()

    monkeypatch.setattr(settings_mod, "load_settings", fake_load_settings)
    embs = _random_embeddings(10)
    coords = reducer.reduce(embs, params=None)
    assert coords.shape == (10, 2)


def test_reduce_settings_load_failure_uses_default(reducer, monkeypatch):
    """Si la lecture des settings echoue, on retombe sur les valeurs UMAP par defaut sans crash."""
    import backend.api.settings as settings_mod

    def broken_load_settings():
        raise RuntimeError("boom")

    monkeypatch.setattr(settings_mod, "load_settings", broken_load_settings)
    embs = _random_embeddings(3)  # < 4 -> pca fallback dans _umap
    coords = reducer.reduce(embs, params=None)
    assert coords.shape == (3, 2)


# ------------------------------------------------------------------ #
# UMAP (méthode par défaut, réelle — plus lent)
# ------------------------------------------------------------------ #

def test_umap_real_shape(reducer):
    embs = _random_embeddings(30)
    coords = reducer.reduce(embs, params={"method": "umap", "umap_n_neighbors": 5, "umap_min_dist": 0.1})
    assert coords.shape == (30, 2)
    assert coords.dtype == np.float32
    assert np.isfinite(coords).all()
