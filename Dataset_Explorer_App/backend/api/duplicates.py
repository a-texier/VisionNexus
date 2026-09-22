# ============================================================
# api/duplicates.py
# Détection et gestion des doublons.
# ============================================================

import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from backend.config import DUPLICATE_THRESHOLD
from backend.core.indexer import faiss_indexer
from backend.db.database import get_session
from backend.db.models import Image

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["duplicates"])


# ------------------------------------------------------------------ #
# Schémas                                                             #
# ------------------------------------------------------------------ #

class DuplicateImageInfo(BaseModel):
    image_id: int
    filename: str
    thumbnail_url: Optional[str]
    similarity_to_representative: float
    is_kept: Optional[bool]


class DuplicateGroup(BaseModel):
    group_id: int
    representative_image_id: int
    images: List[DuplicateImageInfo]
    max_sim: float


class DuplicatesResponse(BaseModel):
    dataset_id: int
    threshold: float
    group_count: int
    duplicate_count: int
    groups: List[DuplicateGroup]


class Decision(BaseModel):
    image_id: int
    keep: bool


class DecisionRequest(BaseModel):
    decisions: List[Decision]


# ------------------------------------------------------------------ #
# GET /api/datasets/{id}/duplicates                                   #
# ------------------------------------------------------------------ #

@router.get("/datasets/{dataset_id}/duplicates", response_model=DuplicatesResponse)
def get_duplicates(
    dataset_id: int,
    threshold: float = DUPLICATE_THRESHOLD,
    session: Session = Depends(get_session),
):
    from backend.db.models import Dataset
    dataset = session.get(Dataset, dataset_id)
    if not dataset:
        raise HTTPException(404, "Dataset introuvable")
    if not dataset.umap_cached:
        raise HTTPException(425, "Index FAISS non construit — lancer /embed d'abord")

    index = faiss_indexer.get(dataset_id)
    if index is None:
        raise HTTPException(425, "Index FAISS non charge en memoire")

    # Groupes de doublons (positions FAISS)
    groups_faiss = faiss_indexer.find_duplicates(dataset_id, threshold)

    # Mapper les positions FAISS → Image rows
    images_ordered = session.exec(
        select(Image)
        .where(Image.dataset_id == dataset_id)
        .order_by(Image.id)
    ).all()

    import numpy as np
    # Récupérer les embeddings pour calculer la similarité intra-groupe.
    # Une seule requête (et non `img.embedding` par image, qui déclenchait un
    # SELECT par ligne — 9k requêtes sur un dataset de 9k images).
    from backend.db.models import Embedding
    image_ids = [img.id for img in images_ordered]
    all_blobs = {
        emb.image_id: np.frombuffer(emb.vector_blob, dtype=np.float32)
        for emb in session.exec(
            select(Embedding).where(Embedding.image_id.in_(image_ids))
        ).all()
    } if image_ids else {}

    groups_response: List[DuplicateGroup] = []
    dup_count = 0

    for group_faiss_indices in groups_faiss:
        group_images = [images_ordered[i] for i in group_faiss_indices if i < len(images_ordered)]
        if len(group_images) < 2:
            continue

        # Représentant = premier image du groupe (id minimal)
        representative = group_images[0]
        rep_vec = all_blobs.get(representative.id)

        image_infos = []
        max_sim = 0.0

        for img in group_images:
            vec = all_blobs.get(img.id)
            sim = float(np.dot(rep_vec, vec)) if (rep_vec is not None and vec is not None) else 0.0
            if img.id != representative.id:
                max_sim = max(max_sim, sim)

            image_infos.append(DuplicateImageInfo(
                image_id=img.id,
                filename=img.filename,
                thumbnail_url=img.thumbnail_path,
                similarity_to_representative=1.0 if img.id == representative.id else round(sim, 4),
                is_kept=img.is_duplicate_kept,
            ))

        # Mettre à jour duplicate_group_id en DB
        group_id = representative.id
        for img in group_images:
            img.duplicate_group_id = group_id

        groups_response.append(DuplicateGroup(
            group_id=group_id,
            representative_image_id=representative.id,
            images=image_infos,
            max_sim=round(max_sim, 4),
        ))
        dup_count += len(group_images)

    session.commit()

    return DuplicatesResponse(
        dataset_id=dataset_id,
        threshold=threshold,
        group_count=len(groups_response),
        duplicate_count=dup_count,
        groups=groups_response,
    )


# ------------------------------------------------------------------ #
# PATCH /api/datasets/{id}/duplicates/decision                        #
# ------------------------------------------------------------------ #

@router.patch("/datasets/{dataset_id}/duplicates/decision")
def patch_duplicate_decision(
    dataset_id: int,
    body: DecisionRequest,
    session: Session = Depends(get_session),
):
    updated = 0
    for dec in body.decisions:
        img = session.get(Image, dec.image_id)
        if img and img.dataset_id == dataset_id:
            img.is_duplicate_kept = dec.keep
            updated += 1
    session.commit()
    return {"updated": updated}


# ------------------------------------------------------------------ #
# GET /api/duplicates/global                                          #
# Doublons CROSS-dataset : la meme image presente dans deux datasets  #
# differents n'etait jusqu'ici jamais rapprochee (index FAISS scope    #
# strictement par dataset).                                           #
# ------------------------------------------------------------------ #

class GlobalDuplicateImage(BaseModel):
    image_id: int
    dataset_id: int
    dataset_name: str
    filename: str
    thumbnail_url: Optional[str]
    similarity_to_representative: float
    is_kept: Optional[bool]


class GlobalDuplicateGroup(BaseModel):
    group_id: int                 # = image_id du representant
    representative_image_id: int
    dataset_ids: List[int]        # datasets couverts par le groupe
    size: int                     # taille reelle du groupe (avant troncature)
    truncated: bool               # True si `images` ne contient pas tout le groupe
    images: List[GlobalDuplicateImage]


class GlobalDuplicatesResponse(BaseModel):
    threshold: float
    cross_only: bool
    indexed_datasets: List[int]
    indexed_vectors: int
    group_count: int              # groupes retournes
    total_group_count: int        # groupes detectes avant filtre/limite
    duplicate_count: int          # images concernees (groupes retournes)
    groups: List[GlobalDuplicateGroup]


@router.get("/duplicates/global", response_model=GlobalDuplicatesResponse)
def get_global_duplicates(
    threshold: float = DUPLICATE_THRESHOLD,
    cross_only: bool = True,
    max_groups: int = 50,
    max_images_per_group: int = 24,
    session: Session = Depends(get_session),
):
    """Groupes de doublons a travers tous les datasets indexes.

    `cross_only=True` (defaut) ne retourne que les groupes qui couvrent au moins
    deux datasets — c'est l'apport reel par rapport aux doublons intra-dataset
    deja disponibles ailleurs. Les groupes sont tronques (`max_*`) car sur des
    donnees tres redondantes (rafales video) un seul groupe peut contenir des
    milliers d'images.
    """
    import numpy as np
    from backend.core.indexer import faiss_indexer
    from backend.core.semantic_filter import ordered_image_ids
    from backend.db.models import Dataset, Embedding

    faiss_indexer.ensure_global()
    indexed = faiss_indexer.loaded_dataset_ids()
    if not indexed:
        raise HTTPException(425, "Aucun index FAISS charge — lancer /embed d'abord")

    raw_groups = faiss_indexer.find_duplicates_global(threshold=threshold)

    # Positions FAISS -> image_id (une requete d'ids par dataset concerne)
    ids_cache: dict = {}

    def to_image_ids(group) -> List[tuple]:
        out = []
        for ds_id, pos in group:
            if ds_id not in ids_cache:
                ids_cache[ds_id] = ordered_image_ids(ds_id, session)
            ordered = ids_cache[ds_id]
            if pos < len(ordered):
                out.append((ds_id, ordered[pos]))
        return out

    resolved = [to_image_ids(g) for g in raw_groups]
    if cross_only:
        resolved = [g for g in resolved if len({ds for ds, _ in g}) >= 2]

    total_groups = len(resolved)
    # Les groupes couvrant le plus de datasets d'abord : ce sont les plus utiles.
    resolved.sort(key=lambda g: (-len({ds for ds, _ in g}), -len(g)))
    resolved = resolved[:max_groups]

    if not resolved:
        return GlobalDuplicatesResponse(
            threshold=threshold, cross_only=cross_only,
            indexed_datasets=indexed, indexed_vectors=faiss_indexer.global_size(),
            group_count=0, total_group_count=total_groups, duplicate_count=0, groups=[],
        )

    # Chargement groupe des images + embeddings + noms de datasets
    shown_ids = [img_id for g in resolved for _, img_id in g[:max_images_per_group]]
    images = {
        img.id: img
        for img in session.exec(select(Image).where(Image.id.in_(shown_ids))).all()
    }
    blobs = {
        emb.image_id: np.frombuffer(emb.vector_blob, dtype=np.float32)
        for emb in session.exec(select(Embedding).where(Embedding.image_id.in_(shown_ids))).all()
    }
    ds_names = {
        d.id: d.name
        for d in session.exec(select(Dataset).where(Dataset.id.in_(indexed))).all()
    }

    groups_out: List[GlobalDuplicateGroup] = []
    dup_count = 0

    for group in resolved:
        shown = group[:max_images_per_group]
        rep_ds, rep_id = shown[0]
        rep_vec = blobs.get(rep_id)

        infos = []
        for ds_id, img_id in shown:
            img = images.get(img_id)
            if img is None:
                continue
            vec = blobs.get(img_id)
            sim = 1.0 if img_id == rep_id else (
                float(np.dot(rep_vec, vec)) if (rep_vec is not None and vec is not None) else 0.0
            )
            infos.append(GlobalDuplicateImage(
                image_id=img.id,
                dataset_id=ds_id,
                dataset_name=ds_names.get(ds_id, f"#{ds_id}"),
                filename=img.filename,
                thumbnail_url=img.thumbnail_path,
                similarity_to_representative=round(sim, 4),
                is_kept=img.is_duplicate_kept,
            ))

        if len(infos) < 2:
            continue

        groups_out.append(GlobalDuplicateGroup(
            group_id=rep_id,
            representative_image_id=rep_id,
            dataset_ids=sorted({ds for ds, _ in group}),
            size=len(group),
            truncated=len(group) > len(shown),
            images=infos,
        ))
        dup_count += len(group)

    return GlobalDuplicatesResponse(
        threshold=threshold,
        cross_only=cross_only,
        indexed_datasets=indexed,
        indexed_vectors=faiss_indexer.global_size(),
        group_count=len(groups_out),
        total_group_count=total_groups,
        duplicate_count=dup_count,
        groups=groups_out,
    )


# ------------------------------------------------------------------ #
# PATCH /api/duplicates/global/decision                               #
# Meme principe que la version par dataset, mais sans contrainte de   #
# dataset (un groupe cross-dataset touche plusieurs datasets).        #
# ------------------------------------------------------------------ #

@router.patch("/duplicates/global/decision")
def patch_global_duplicate_decision(
    body: DecisionRequest,
    session: Session = Depends(get_session),
):
    updated = 0
    for dec in body.decisions:
        img = session.get(Image, dec.image_id)
        if img:
            img.is_duplicate_kept = dec.keep
            updated += 1
    session.commit()
    return {"updated": updated}
