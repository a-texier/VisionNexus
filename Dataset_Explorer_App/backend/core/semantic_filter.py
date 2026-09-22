# ============================================================
# core/semantic_filter.py
# Recherche sémantique texte → images via CLIP + FAISS.
# ============================================================

import logging
from typing import Dict, List, Optional, Sequence

import numpy as np
from sqlmodel import Session, select

from backend.core.embedder import clip_embedder
from backend.core.indexer import faiss_indexer
from backend.db.models import Dataset, Image

logger = logging.getLogger(__name__)


def ordered_image_ids(dataset_id: int, session: Session) -> List[int]:
    """Ids des images d'un dataset triés par id ascendant.

    INVARIANT : position FAISS i = cet id de rang i. On ne charge que la colonne
    id (et pas les lignes completes) : suffisant pour traduire une position FAISS
    en identifiant, sans payer le cout d'un SELECT * sur tout le dataset.
    """
    return list(session.exec(
        select(Image.id).where(Image.dataset_id == dataset_id).order_by(Image.id)
    ).all())


def semantic_search(
    dataset_id: int,
    query: str,
    top_k: int,
    session: Session,
) -> List[dict]:
    """
    Recherche les top_k images les plus similaires à une requête texte.

    Returns:
        Liste de dicts avec image_id, score, rank, filename, thumbnail_url,
        cluster_id, rarity_score.
    """
    # 1. Encoder la requête texte
    text_vec = clip_embedder.embed_text(query)                   # (512,) float32
    query_matrix = text_vec.reshape(1, -1).astype(np.float32)   # (1, 512)

    # 2. Recherche FAISS
    try:
        scores, indices = faiss_indexer.search(dataset_id, query_matrix, top_k)
    except RuntimeError as exc:
        raise RuntimeError(f"Index FAISS non disponible : {exc}") from exc

    # 3. Mapping FAISS position → Image
    # INVARIANT : FAISS position i = Image avec rang i trié par id ascendant
    images_ordered = session.exec(
        select(Image)
        .where(Image.dataset_id == dataset_id)
        .order_by(Image.id)
    ).all()

    results = []
    for rank, (score, idx) in enumerate(zip(scores[0], indices[0])):
        if idx == -1 or idx >= len(images_ordered):
            continue
        img = images_ordered[idx]
        results.append({
            "image_id": img.id,
            "score": float(score),
            "rank": rank + 1,
            "filename": img.filename,
            "thumbnail_url": img.thumbnail_path or "",
            "cluster_id": img.cluster_id,
            "rarity_score": img.rarity_score,
            "umap_x": img.umap_x,
            "umap_y": img.umap_y,
        })

    return results


def semantic_search_global(
    query: str,
    top_k: int,
    session: Session,
    dataset_ids: Optional[Sequence[int]] = None,
    min_score: Optional[float] = None,
) -> List[dict]:
    """Recherche sémantique texte -> images **à travers tous les datasets**.

    Contrairement à semantic_search(), aucune fusion préalable n'est nécessaire :
    l'index global concatène les index par dataset déjà en mémoire. Chaque
    résultat porte son dataset d'origine.
    """
    text_vec = clip_embedder.embed_text(query)

    # Avec un seuil, on balaie tout l'index global puis on coupe par score.
    effective_k = faiss_indexer.global_size() if min_score is not None else top_k
    effective_k = max(effective_k, 1)

    hits = faiss_indexer.search_global(text_vec, effective_k, dataset_ids)
    if min_score is not None:
        hits = [h for h in hits if h[2] >= min_score][:top_k] if top_k else \
               [h for h in hits if h[2] >= min_score]

    if not hits:
        return []

    # Positions FAISS -> ids, par dataset (une seule requête d'ids par dataset)
    ids_by_dataset: Dict[int, List[int]] = {}
    wanted_ids: List[int] = []
    for ds_id, local_pos, _ in hits:
        if ds_id not in ids_by_dataset:
            ids_by_dataset[ds_id] = ordered_image_ids(ds_id, session)
        ordered = ids_by_dataset[ds_id]
        if local_pos < len(ordered):
            wanted_ids.append(ordered[local_pos])

    if not wanted_ids:
        return []

    images = {
        img.id: img
        for img in session.exec(select(Image).where(Image.id.in_(wanted_ids))).all()
    }
    names = {
        d.id: d.name
        for d in session.exec(
            select(Dataset).where(Dataset.id.in_(list(ids_by_dataset.keys())))
        ).all()
    }

    results = []
    rank = 0
    for ds_id, local_pos, score in hits:
        ordered = ids_by_dataset.get(ds_id, [])
        if local_pos >= len(ordered):
            continue
        img = images.get(ordered[local_pos])
        if img is None:
            continue
        rank += 1
        results.append({
            "image_id": img.id,
            "dataset_id": ds_id,
            "dataset_name": names.get(ds_id, f"#{ds_id}"),
            "score": float(score),
            "rank": rank,
            "filename": img.filename,
            "thumbnail_url": img.thumbnail_path or "",
            "cluster_id": img.cluster_id,
            "rarity_score": img.rarity_score,
        })

    return results
