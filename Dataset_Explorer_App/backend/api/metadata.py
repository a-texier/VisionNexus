# ============================================================
# api/metadata.py
# Le catalogue vu par ses métadonnées : recherche plein-texte
# cross-dataset, facettes par colonne, rapprochement de colonnes
# entre CSV hétérogènes.
# ============================================================

import json
import logging
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlmodel import Session, select

from backend.core import metadata_index
from backend.core.metadata_loader import suggest_column_mapping, suggest_key_column
from backend.db.database import get_session
from backend.db.models import Dataset, Image

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/metadata", tags=["metadata"])


# ------------------------------------------------------------------ #
# Schémas                                                             #
# ------------------------------------------------------------------ #

class MetadataSearchRequest(BaseModel):
    query: str
    dataset_ids: Optional[List[int]] = None
    mode: str = "and"            # and | or
    limit: int = 100
    offset: int = 0


class MetadataHit(BaseModel):
    image_id: int
    dataset_id: int
    dataset_name: str
    filename: str
    thumbnail_url: Optional[str]
    cluster_id: Optional[int]
    rarity_score: Optional[float]
    metadata: dict


class MetadataSearchResponse(BaseModel):
    query: str
    mode: str
    total: int
    limit: int
    offset: int
    dataset_counts: Dict[int, int]
    indexed_datasets: List[int]
    items: List[MetadataHit]


class ColumnInfo(BaseModel):
    column: str
    datasets: List[int]
    dataset_names: List[str]


class ColumnsResponse(BaseModel):
    columns: List[ColumnInfo]
    groups: Dict[str, List[str]]    # colonne canonique -> variantes rapprochées


class MappingRequest(BaseModel):
    columns: List[str]
    exclude_dataset_id: Optional[int] = None


# ------------------------------------------------------------------ #
# Helpers                                                             #
# ------------------------------------------------------------------ #

def _dataset_columns(session: Session) -> List[tuple]:
    """[(dataset_id, name, [colonnes])] pour les datasets ayant des métadonnées."""
    out = []
    for ds in session.exec(select(Dataset).where(Dataset.metadata_columns_json.is_not(None))).all():
        try:
            cols = json.loads(ds.metadata_columns_json) or []
        except Exception:
            cols = []
        if cols:
            out.append((ds.id, ds.name, [str(c) for c in cols]))
    return out


def _auto_reindex_if_needed(session: Session) -> List[int]:
    """Indexe les datasets qui ont des métadonnées mais aucune ligne FTS.

    Couvre les datasets importés avant l'introduction de l'index, sans imposer
    une réindexation manuelle à l'utilisateur.
    """
    metadata_index.ensure_fts(session)
    already = set(metadata_index.indexed_dataset_ids(session))
    indexed = []
    for ds_id, _name, _cols in _dataset_columns(session):
        if ds_id not in already:
            try:
                if metadata_index.reindex_dataset(session, ds_id):
                    indexed.append(ds_id)
            except Exception:
                logger.exception("Auto-indexation metadonnees echouee (dataset %d)", ds_id)
    return indexed


# ------------------------------------------------------------------ #
# POST /api/metadata/search — recherche plein-texte cross-dataset      #
# ------------------------------------------------------------------ #

@router.post("/search", response_model=MetadataSearchResponse)
def search_metadata(body: MetadataSearchRequest, session: Session = Depends(get_session)):
    _auto_reindex_if_needed(session)

    try:
        total, hits = metadata_index.search(
            session, body.query, body.dataset_ids, body.mode, body.limit, body.offset
        )
    except Exception as exc:
        raise HTTPException(400, f"Requete invalide : {exc}")

    image_ids = [i for i, _ in hits]
    images = {
        img.id: img
        for img in (session.exec(select(Image).where(Image.id.in_(image_ids))).all() if image_ids else [])
    }
    ds_ids = sorted({d for _, d in hits})
    names = {
        d.id: d.name
        for d in (session.exec(select(Dataset).where(Dataset.id.in_(ds_ids))).all() if ds_ids else [])
    }

    items: List[MetadataHit] = []
    counts: Dict[int, int] = {}
    for image_id, dataset_id in hits:
        img = images.get(image_id)
        if img is None:
            continue
        try:
            meta = json.loads(img.metadata_json) if img.metadata_json else {}
        except Exception:
            meta = {}
        counts[dataset_id] = counts.get(dataset_id, 0) + 1
        items.append(MetadataHit(
            image_id=img.id,
            dataset_id=dataset_id,
            dataset_name=names.get(dataset_id, f"#{dataset_id}"),
            filename=img.filename,
            thumbnail_url=img.thumbnail_path,
            cluster_id=img.cluster_id,
            rarity_score=img.rarity_score,
            metadata=meta if isinstance(meta, dict) else {},
        ))

    return MetadataSearchResponse(
        query=body.query,
        mode=body.mode,
        total=total,
        limit=body.limit,
        offset=body.offset,
        dataset_counts=counts,
        indexed_datasets=metadata_index.indexed_dataset_ids(session),
        items=items,
    )


# ------------------------------------------------------------------ #
# GET /api/metadata/columns — colonnes du catalogue + rapprochements   #
# ------------------------------------------------------------------ #

@router.get("/columns", response_model=ColumnsResponse)
def list_columns(session: Session = Depends(get_session)):
    per_dataset = _dataset_columns(session)

    by_column: Dict[str, dict] = {}
    for ds_id, name, cols in per_dataset:
        for col in cols:
            entry = by_column.setdefault(col, {"datasets": [], "names": []})
            entry["datasets"].append(ds_id)
            entry["names"].append(name)

    columns = [
        ColumnInfo(column=col, datasets=v["datasets"], dataset_names=v["names"])
        for col, v in sorted(by_column.items())
    ]

    # Regroupe les variantes ("scene" / "scene_name") sous une colonne pivot :
    # la plus utilisée, à défaut la première par ordre alphabétique.
    groups: Dict[str, List[str]] = {}
    remaining = sorted(by_column.keys(), key=lambda c: (-len(by_column[c]["datasets"]), c))
    assigned: set = set()
    for col in remaining:
        if col in assigned:
            continue
        others = [c for c in remaining if c not in assigned and c != col]
        matches = suggest_column_mapping(others, [col])
        variants = sorted(matches.keys())
        if variants:
            groups[col] = variants
            assigned.update(variants)
        assigned.add(col)

    return ColumnsResponse(columns=columns, groups=groups)


# ------------------------------------------------------------------ #
# GET /api/metadata/facets — valeurs d'une colonne + comptages         #
# ------------------------------------------------------------------ #

@router.get("/facets")
def get_facets(
    column: str,
    dataset_ids: Optional[List[int]] = Query(default=None),
    limit: int = 50,
    session: Session = Depends(get_session),
):
    """Valeurs distinctes d'une colonne de métadonnées, tous datasets confondus.

    C'est la brique du tri « par mot-clé / domaine » : on voit d'un coup les
    valeurs présentes et leur volume avant de filtrer dessus.
    """
    values = metadata_index.facet_values(session, column, dataset_ids, limit)
    return {
        "column": column,
        "dataset_ids": dataset_ids or [],
        "values": values,
        "distinct_shown": len(values),
    }


# ------------------------------------------------------------------ #
# POST /api/metadata/suggest-mapping — CSV aux en-têtes hétérogènes    #
# ------------------------------------------------------------------ #

@router.post("/suggest-mapping")
def suggest_mapping(body: MappingRequest, session: Session = Depends(get_session)):
    known: List[str] = []
    for ds_id, _name, cols in _dataset_columns(session):
        if body.exclude_dataset_id is not None and ds_id == body.exclude_dataset_id:
            continue
        known.extend(cols)
    known = sorted(set(known))

    return {
        "known_columns": known,
        "suggested_key_column": suggest_key_column(body.columns),
        "mapping": suggest_column_mapping(body.columns, known),
    }


# ------------------------------------------------------------------ #
# POST /api/metadata/reindex — reconstruction de l'index               #
# ------------------------------------------------------------------ #

@router.post("/reindex")
def reindex(dataset_id: Optional[int] = None, session: Session = Depends(get_session)):
    metadata_index.ensure_fts(session)
    targets = [dataset_id] if dataset_id is not None else [d[0] for d in _dataset_columns(session)]
    indexed = {ds: metadata_index.reindex_dataset(session, ds) for ds in targets}
    return {"indexed": indexed, "total_rows": sum(indexed.values())}
