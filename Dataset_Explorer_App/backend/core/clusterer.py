# ============================================================
# core/clusterer.py
# Clustering KMeans + HDBSCAN, scores de rareté.
# ============================================================

import logging
from typing import Tuple

import numpy as np

logger = logging.getLogger(__name__)


class Clusterer:
    """KMeans, HDBSCAN, scores de rareté."""

    # ------------------------------------------------------------------ #
    # KMeans                                                              #
    # ------------------------------------------------------------------ #

    def kmeans(
        self,
        embeddings: np.ndarray,
        n_clusters: int,
    ) -> Tuple[np.ndarray, np.ndarray]:
        """
        Clustering KMeans.

        Returns:
            labels:    (N,) int — identifiant de cluster par image.
            centroids: (n_clusters, D) float32 — centroïdes.
        """
        from sklearn.cluster import KMeans

        n = embeddings.shape[0]
        k = min(n_clusters, max(1, n))

        if k != n_clusters:
            logger.warning("n_clusters reduit a %d (seulement %d images)", k, n)

        km = KMeans(n_clusters=k, n_init=10, random_state=42)
        labels = km.fit_predict(embeddings)
        centroids = km.cluster_centers_.astype(np.float32)

        return labels.astype(np.int32), centroids

    # ------------------------------------------------------------------ #
    # HDBSCAN                                                             #
    # ------------------------------------------------------------------ #

    def hdbscan_cluster(
        self,
        coords_2d: np.ndarray,
        min_cluster_size: int = 5,
    ) -> np.ndarray:
        """
        Clustering HDBSCAN sur les coordonnées UMAP 2D.

        Returns:
            labels (N,) int — -1 = bruit.
        """
        import hdbscan

        clusterer = hdbscan.HDBSCAN(
            min_cluster_size=min_cluster_size,
            metric="euclidean",
        )
        labels = clusterer.fit_predict(coords_2d)
        return labels.astype(np.int32)

    # ------------------------------------------------------------------ #
    # Score de rareté                                                     #
    # ------------------------------------------------------------------ #

    def compute_rarity_scores(
        self,
        embeddings: np.ndarray,
        centroids: np.ndarray,
        labels: np.ndarray,
    ) -> np.ndarray:
        """
        Score de rareté par image : distance au centroïde du cluster,
        normalisée par cluster en [0, 1].

        0 = image typique (proche du centroïde)
        1 = image rare (éloignée du centroïde)

        Returns:
            (N,) float32.
        """
        scores = np.zeros(len(embeddings), dtype=np.float32)

        unique_labels = np.unique(labels)

        for label in unique_labels:
            mask = labels == label
            cluster_embs = embeddings[mask]

            if label < 0 or label >= len(centroids):
                # Cluster bruit (HDBSCAN) ou label invalide
                scores[mask] = 0.5
                continue

            centroid = centroids[label]
            dists = np.linalg.norm(cluster_embs - centroid, axis=1)

            d_min, d_max = dists.min(), dists.max()
            if d_max - d_min < 1e-8:
                normalized = np.zeros_like(dists)
            else:
                normalized = (dists - d_min) / (d_max - d_min)

            scores[mask] = normalized.astype(np.float32)

        return scores


# Singleton global
clusterer = Clusterer()
