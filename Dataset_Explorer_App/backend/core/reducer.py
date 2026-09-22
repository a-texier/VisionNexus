# ============================================================
# core/reducer.py
# Réduction dimensionnelle 2D.
# Méthodes : UMAP (défaut), t-SNE, PCA.
# Hyperparamètres lus dynamiquement depuis les settings user.
# ============================================================

import logging

import numpy as np

logger = logging.getLogger(__name__)


_DEFAULT_REDUCTION = {
    "method": "umap",
    "umap_n_neighbors": 15,
    "umap_min_dist": 0.1,
    "tsne_perplexity": 30,
    "tsne_learning_rate": 200.0,
}


def _load_reduction_settings():
    """Charge les settings de réduction dimensionnelle sans import circulaire."""
    try:
        from backend.api.settings import load_settings
        s = load_settings()
        return {
            "method": s.reduction_method,
            "umap_n_neighbors": s.umap_n_neighbors,
            "umap_min_dist": s.umap_min_dist,
            "tsne_perplexity": s.tsne_perplexity,
            "tsne_learning_rate": s.tsne_learning_rate,
        }
    except Exception as exc:
        logger.warning("Impossible de lire les settings de reduction : %s — valeurs UMAP par defaut", exc)
        return dict(_DEFAULT_REDUCTION)


class UMAPReducer:
    """Réduction 2D des embeddings pour visualisation (UMAP / t-SNE / PCA)."""

    def reduce(self, embeddings: np.ndarray, params: dict | None = None) -> np.ndarray:
        """
        Réduit les embeddings en 2D.

        Args:
            embeddings: (N, D) float32.
            params: hyperparamètres explicites (method + umap/tsne). Si None, lit
                les settings user (comportement historique). Permet de relancer la
                réduction depuis l'UI avec une méthode/paramètres choisis (step 1).
        Returns:
            (N, 2) float32.
        """
        if params is None:
            cfg = _load_reduction_settings()
        else:
            cfg = dict(_DEFAULT_REDUCTION)
            cfg.update({k: v for k, v in params.items() if v is not None})
        method = (cfg.get("method") or "umap").lower()
        n = embeddings.shape[0]

        if n < 2:
            logger.warning("Trop peu de points (%d) — fallback PCA", n)
            return self._pca(embeddings)

        if method == "tsne":
            return self._tsne(embeddings, cfg, n)
        elif method == "pca":
            return self._pca(embeddings)
        else:
            # UMAP par défaut, avec fallback t-SNE puis PCA
            return self._umap(embeddings, cfg, n)

    # ---- UMAP ----
    def _umap(self, embeddings: np.ndarray, cfg: dict, n: int) -> np.ndarray:
        if n < 4:
            logger.warning("Trop peu de points pour UMAP (%d), retour a PCA", n)
            return self._pca(embeddings)
        try:
            import umap
            reducer = umap.UMAP(
                n_components=2,
                n_neighbors=min(cfg["umap_n_neighbors"], n - 1),
                min_dist=cfg["umap_min_dist"],
                metric="cosine",
                random_state=42,
                verbose=False,
            )
            logger.info("UMAP : n_neighbors=%d, min_dist=%.3f, n=%d",
                        min(cfg["umap_n_neighbors"], n - 1), cfg["umap_min_dist"], n)
            coords = reducer.fit_transform(embeddings)
            return coords.astype(np.float32)
        except Exception as exc:
            logger.warning("UMAP echoue (%s), fallback t-SNE", exc)
            return self._tsne(embeddings, cfg, n)

    # ---- t-SNE ----
    def _tsne(self, embeddings: np.ndarray, cfg: dict, n: int) -> np.ndarray:
        from sklearn.manifold import TSNE
        perplexity = min(cfg["tsne_perplexity"], max(5, n - 2))
        logger.info("t-SNE : perplexity=%d, learning_rate=%.1f, n=%d",
                    perplexity, cfg["tsne_learning_rate"], n)
        tsne = TSNE(
            n_components=2,
            perplexity=perplexity,
            learning_rate=cfg["tsne_learning_rate"],
            random_state=42,
            metric="cosine",
            init="pca",
        )
        return tsne.fit_transform(embeddings).astype(np.float32)

    # ---- PCA ----
    def _pca(self, embeddings: np.ndarray) -> np.ndarray:
        from sklearn.decomposition import PCA
        if embeddings.shape[0] == 0:
            return np.zeros((0, 2), dtype=np.float32)
        n_components = min(2, embeddings.shape[0] - 1, embeddings.shape[1])
        logger.info("PCA : n_components=%d, n=%d", n_components, embeddings.shape[0])
        pca = PCA(n_components=n_components)
        coords = pca.fit_transform(embeddings).astype(np.float32)
        if coords.shape[1] < 2:
            pad = np.zeros((coords.shape[0], 2 - coords.shape[1]), dtype=np.float32)
            coords = np.hstack([coords, pad])
        return coords

    # Garde la compatibilité avec l'ancien fallback appelé directement
    def _tsne_fallback(self, embeddings: np.ndarray) -> np.ndarray:
        cfg = _load_reduction_settings()
        return self._tsne(embeddings, cfg, embeddings.shape[0])

    def _pca_fallback(self, embeddings: np.ndarray) -> np.ndarray:
        return self._pca(embeddings)


# Singleton global
umap_reducer = UMAPReducer()
