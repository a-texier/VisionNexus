# ============================================================
# api/explore.py
# Endpoints : carte UMAP, clusters.
#
# Map : les images avec is_duplicate_kept=False (explicitement rejetées
#       après application du filtre doublon) sont exclues de la vue.
# ============================================================

import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import or_
from sqlmodel import Session, select

from backend.db.database import get_session
from backend.db.models import ClusterCentroid, Image

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["explore"])


def _json_dict(raw: Optional[str]) -> dict:
    """Parse un JSON dict stocké en colonne ; {} si vide/invalide."""
    if not raw:
        return {}
    try:
        import json
        data = json.loads(raw)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


# ------------------------------------------------------------------ #
# Schémas                                                             #
# ------------------------------------------------------------------ #

class MapPoint(BaseModel):
    image_id: int
    x: float
    y: float
    cluster_id: Optional[int]
    rarity_score: Optional[float]
    filename: str
    thumbnail_url: Optional[str]
    duplicate_group_id: Optional[int]
    metadata: dict = {}   # métadonnées tabulaires liées (CSV/Excel)


class MapData(BaseModel):
    dataset_id: int
    points: List[MapPoint]


class ClusterSample(BaseModel):
    image_id: int
    thumbnail_url: Optional[str]


class ClusterInfo(BaseModel):
    cluster_id: int
    count: int
    avg_rarity: Optional[float]
    sample_images: List[ClusterSample]


class ClusterData(BaseModel):
    dataset_id: int
    n_clusters: int
    clusters: List[ClusterInfo]


# ------------------------------------------------------------------ #
# GET /api/datasets/{id}/map                                          #
# Exclut les images rejetées (is_duplicate_kept=False).               #
# ------------------------------------------------------------------ #

@router.get("/datasets/{dataset_id}/map", response_model=MapData)
def get_map(dataset_id: int, session: Session = Depends(get_session)):
    from backend.db.models import Dataset
    dataset = session.get(Dataset, dataset_id)
    if not dataset:
        raise HTTPException(404, "Dataset introuvable")
    if not dataset.umap_cached:
        raise HTTPException(425, "UMAP non calculé — lancer /embed d'abord")

    images = session.exec(
        select(Image)
        .where(Image.dataset_id == dataset_id)
        .where(Image.umap_x.is_not(None))
        # Exclure les images explicitement rejetées (filtre doublon appliqué)
        .where(or_(Image.is_duplicate_kept.is_(None), Image.is_duplicate_kept == True))
    ).all()

    points = [
        MapPoint(
            image_id=img.id,
            x=img.umap_x,
            y=img.umap_y,
            cluster_id=img.cluster_id,
            rarity_score=img.rarity_score,
            filename=img.filename,
            thumbnail_url=img.thumbnail_path,
            duplicate_group_id=img.duplicate_group_id,
            metadata=_json_dict(getattr(img, "metadata_json", None)),
        )
        for img in images
    ]

    return MapData(dataset_id=dataset_id, points=points)


# ------------------------------------------------------------------ #
# GET /api/datasets/{id}/clusters                                     #
# ------------------------------------------------------------------ #

@router.get("/datasets/{dataset_id}/clusters", response_model=ClusterData)
def get_clusters(dataset_id: int, session: Session = Depends(get_session)):
    from backend.db.models import Dataset
    dataset = session.get(Dataset, dataset_id)
    if not dataset:
        raise HTTPException(404, "Dataset introuvable")

    # Exclure les rejetées des statistiques de cluster
    images = session.exec(
        select(Image)
        .where(Image.dataset_id == dataset_id)
        .where(or_(Image.is_duplicate_kept.is_(None), Image.is_duplicate_kept == True))
    ).all()

    cluster_map: dict = {}
    for img in images:
        if img.cluster_id is None:
            continue
        cid = img.cluster_id
        if cid not in cluster_map:
            cluster_map[cid] = {"images": [], "rarity_sum": 0.0, "rarity_count": 0}
        cluster_map[cid]["images"].append(img)
        if img.rarity_score is not None:
            cluster_map[cid]["rarity_sum"] += img.rarity_score
            cluster_map[cid]["rarity_count"] += 1

    clusters = []
    for cid, data in sorted(cluster_map.items()):
        imgs = data["images"]
        avg_rarity = (
            data["rarity_sum"] / data["rarity_count"]
            if data["rarity_count"] > 0 else None
        )
        sorted_imgs = sorted(imgs, key=lambda i: i.rarity_score if i.rarity_score is not None else 1.0)
        samples = [
            ClusterSample(image_id=i.id, thumbnail_url=i.thumbnail_path)
            for i in sorted_imgs[:3]
        ]
        clusters.append(ClusterInfo(
            cluster_id=cid,
            count=len(imgs),
            avg_rarity=round(avg_rarity, 4) if avg_rarity is not None else None,
            sample_images=samples,
        ))

    return ClusterData(dataset_id=dataset_id, n_clusters=len(clusters), clusters=clusters)
