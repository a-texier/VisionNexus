# ============================================================
# api/filter.py
# Endpoint : recherche sémantique texte → images.
# ============================================================

import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session

from backend.core.semantic_filter import semantic_search, semantic_search_global
from backend.db.database import get_session

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["filter"])


class SearchRequest(BaseModel):
    query: str
    top_k: int = 20
    min_score: Optional[float] = None   # 0.0–1.0 : retourne toutes les images >= ce seuil


class SearchResult(BaseModel):
    image_id: int
    score: float
    rank: int
    filename: str
    thumbnail_url: Optional[str]
    cluster_id: Optional[int]
    rarity_score: Optional[float]
    umap_x: Optional[float]
    umap_y: Optional[float]


class SearchResponse(BaseModel):
    query: str
    top_k: int
    min_score: Optional[float] = None
    results: List[SearchResult]


@router.post("/datasets/{dataset_id}/semantic-search", response_model=SearchResponse)
def do_semantic_search(
    dataset_id: int,
    body: SearchRequest,
    session: Session = Depends(get_session),
):
    from backend.db.models import Dataset
    dataset = session.get(Dataset, dataset_id)
    if not dataset:
        raise HTTPException(404, "Dataset introuvable")
    if not dataset.umap_cached:
        raise HTTPException(425, "Index FAISS non construit — lancer /embed d'abord")

    from backend.core.embedder import clip_embedder
    if not clip_embedder.is_loaded:
        raise HTTPException(503, "Modele CLIP non charge")

    try:
        if body.min_score is not None:
            # Recherche sur tout le dataset puis filtre par seuil
            effective_k = max(dataset.image_count, 1)
            raw = semantic_search(dataset_id, body.query, effective_k, session)
            raw = [r for r in raw if r["score"] >= body.min_score]
        else:
            raw = semantic_search(dataset_id, body.query, body.top_k, session)
    except RuntimeError as exc:
        raise HTTPException(425, str(exc))

    return SearchResponse(
        query=body.query,
        top_k=body.top_k,
        min_score=body.min_score,
        results=[SearchResult(**r) for r in raw],
    )


# ------------------------------------------------------------------ #
# POST /api/search/global                                             #
# Recherche cross-dataset : pas de fusion prealable necessaire.       #
# ------------------------------------------------------------------ #

class GlobalSearchRequest(BaseModel):
    query: str
    top_k: int = 50
    min_score: Optional[float] = None
    dataset_ids: Optional[List[int]] = None   # None = tous les datasets indexés


class GlobalSearchResult(BaseModel):
    image_id: int
    dataset_id: int
    dataset_name: str
    score: float
    rank: int
    filename: str
    thumbnail_url: Optional[str]
    cluster_id: Optional[int]
    rarity_score: Optional[float]


class GlobalSearchResponse(BaseModel):
    query: str
    top_k: int
    min_score: Optional[float] = None
    indexed_datasets: List[int]
    indexed_vectors: int
    dataset_counts: dict          # dataset_id -> nb de resultats
    results: List[GlobalSearchResult]


@router.post("/search/global", response_model=GlobalSearchResponse)
def do_global_search(
    body: GlobalSearchRequest,
    session: Session = Depends(get_session),
):
    from backend.core.embedder import clip_embedder
    from backend.core.indexer import faiss_indexer

    if not clip_embedder.is_loaded:
        raise HTTPException(503, "Modele CLIP non charge")

    faiss_indexer.ensure_global()
    indexed = faiss_indexer.loaded_dataset_ids()
    if not indexed:
        raise HTTPException(425, "Aucun index FAISS charge — lancer /embed sur au moins un dataset")

    try:
        raw = semantic_search_global(
            body.query, body.top_k, session,
            dataset_ids=body.dataset_ids,
            min_score=body.min_score,
        )
    except RuntimeError as exc:
        raise HTTPException(425, str(exc))

    counts: dict = {}
    for r in raw:
        counts[r["dataset_id"]] = counts.get(r["dataset_id"], 0) + 1

    return GlobalSearchResponse(
        query=body.query,
        top_k=body.top_k,
        min_score=body.min_score,
        indexed_datasets=indexed,
        indexed_vectors=faiss_indexer.global_size(),
        dataset_counts=counts,
        results=[GlobalSearchResult(**r) for r in raw],
    )
