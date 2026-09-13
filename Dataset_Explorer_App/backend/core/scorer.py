# ============================================================
# core/scorer.py
# Re-export de compute_rarity_scores (point d'entrée propre).
# ============================================================

from backend.core.clusterer import clusterer

compute_rarity_scores = clusterer.compute_rarity_scores

__all__ = ["compute_rarity_scores"]
