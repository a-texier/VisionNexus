# ============================================================
# tests/test_clusterer.py
# Tests unitaires : Clusterer (KMeans, HDBSCAN, scores de rareté).
# ============================================================

import numpy as np
import pytest

from backend.core.clusterer import Clusterer


@pytest.fixture()
def clusterer():
    return Clusterer()


def _make_blobs(n_per_blob=10, dim=8, n_blobs=3, spread=0.01, seed=0):
    """Petits blobs bien separes pour verifier le clustering sans ambiguite."""
    rng = np.random.RandomState(seed)
    centers = rng.randn(n_blobs, dim).astype(np.float32) * 10
    points = []
    labels_true = []
    for i, c in enumerate(centers):
        pts = c + rng.randn(n_per_blob, dim).astype(np.float32) * spread
        points.append(pts)
        labels_true.extend([i] * n_per_blob)
    return np.vstack(points).astype(np.float32), np.array(labels_true)


# ------------------------------------------------------------------ #
# KMeans
# ------------------------------------------------------------------ #

def test_kmeans_shapes(clusterer):
    embs, _ = _make_blobs(n_per_blob=10, n_blobs=3)
    labels, centroids = clusterer.kmeans(embs, n_clusters=3)
    assert labels.shape == (30,)
    assert centroids.shape == (3, 8)
    assert labels.dtype == np.int32
    assert centroids.dtype == np.float32


def test_kmeans_recovers_blobs(clusterer):
    """Sur des blobs bien separes, KMeans doit regrouper les points identiques."""
    embs, labels_true = _make_blobs(n_per_blob=15, n_blobs=3, spread=0.001)
    labels, _ = clusterer.kmeans(embs, n_clusters=3)
    # Chaque blob d'origine doit se retrouver dans un seul cluster KMeans
    for true_label in np.unique(labels_true):
        mask = labels_true == true_label
        found = set(labels[mask].tolist())
        assert len(found) == 1, f"Le blob {true_label} est eclate en {found}"


def test_kmeans_n_clusters_greater_than_n_points(clusterer):
    """n_clusters > n_points doit etre reduit silencieusement (pas de crash)."""
    embs = np.random.randn(3, 8).astype(np.float32)
    labels, centroids = clusterer.kmeans(embs, n_clusters=10)
    assert labels.shape == (3,)
    assert centroids.shape[0] <= 3


def test_kmeans_single_point(clusterer):
    embs = np.random.randn(1, 8).astype(np.float32)
    labels, centroids = clusterer.kmeans(embs, n_clusters=5)
    assert labels.shape == (1,)
    assert centroids.shape == (1, 8)


# ------------------------------------------------------------------ #
# HDBSCAN
# ------------------------------------------------------------------ #

def test_hdbscan_returns_labels_array(clusterer):
    coords, _ = _make_blobs(n_per_blob=15, dim=2, n_blobs=3, spread=0.05)
    labels = clusterer.hdbscan_cluster(coords, min_cluster_size=5)
    assert labels.shape == (45,)
    assert labels.dtype == np.int32
    # Au moins un cluster non-bruit doit apparaitre
    assert (labels >= 0).any()


def test_hdbscan_noise_label_minus_one(clusterer):
    """Points isoles au milieu de rien => label -1 (bruit) attendu pour au moins un point."""
    rng = np.random.RandomState(1)
    dense = rng.randn(30, 2).astype(np.float32) * 0.1
    outlier = np.array([[1000.0, 1000.0]], dtype=np.float32)
    coords = np.vstack([dense, outlier])
    labels = clusterer.hdbscan_cluster(coords, min_cluster_size=5)
    assert labels[-1] == -1


# ------------------------------------------------------------------ #
# compute_rarity_scores
# ------------------------------------------------------------------ #

def test_rarity_scores_range(clusterer):
    embs, labels_true = _make_blobs(n_per_blob=10, n_blobs=2, spread=1.0)
    _, centroids = clusterer.kmeans(embs, n_clusters=2)
    scores = clusterer.compute_rarity_scores(embs, centroids, labels_true)
    assert scores.shape == (20,)
    assert scores.dtype == np.float32
    assert (scores >= 0).all() and (scores <= 1).all()


def test_rarity_scores_centroid_is_zero(clusterer):
    """Le point le plus proche du centroide doit avoir un score de rarete minimal (0)."""
    rng = np.random.RandomState(2)
    embs = rng.randn(10, 4).astype(np.float32)
    labels = np.zeros(10, dtype=np.int32)
    centroid = embs.mean(axis=0, keepdims=True).astype(np.float32)
    scores = clusterer.compute_rarity_scores(embs, centroid, labels)
    closest_idx = np.argmin(np.linalg.norm(embs - centroid, axis=1))
    assert scores[closest_idx] == pytest.approx(0.0, abs=1e-6)


def test_rarity_scores_identical_points_all_zero(clusterer):
    """Si tous les points d'un cluster sont identiques, d_max - d_min = 0 => scores = 0."""
    embs = np.tile(np.array([1.0, 2.0, 3.0], dtype=np.float32), (5, 1))
    centroid = embs[0:1]
    labels = np.zeros(5, dtype=np.int32)
    scores = clusterer.compute_rarity_scores(embs, centroid, labels)
    assert np.allclose(scores, 0.0)


def test_rarity_scores_noise_label_gets_half(clusterer):
    """Label negatif (bruit HDBSCAN) => score fixe 0.5 (ni rare ni commun)."""
    embs = np.random.randn(4, 4).astype(np.float32)
    centroids = np.random.randn(1, 4).astype(np.float32)
    labels = np.array([-1, -1, 0, 0], dtype=np.int32)
    scores = clusterer.compute_rarity_scores(embs, centroids, labels)
    assert scores[0] == pytest.approx(0.5)
    assert scores[1] == pytest.approx(0.5)


def test_rarity_scores_label_out_of_range(clusterer):
    """Label >= len(centroids) doit aussi retomber sur 0.5 (garde-fou)."""
    embs = np.random.randn(3, 4).astype(np.float32)
    centroids = np.random.randn(1, 4).astype(np.float32)  # un seul centroide (index 0 valide)
    labels = np.array([5, 5, 5], dtype=np.int32)
    scores = clusterer.compute_rarity_scores(embs, centroids, labels)
    assert np.allclose(scores, 0.5)
