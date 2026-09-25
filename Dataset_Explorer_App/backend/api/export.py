# ============================================================
# api/export.py
# Gestion des subsets + exports multiples + doublons locaux.
#
# Nouveautés :
#   POST /api/subsets/{id}/duplicate   — dupliquer un subset
#   POST /api/subsets/{id}/export-to-annotation-app
#         → permet maintenant plusieurs exports (un par chemin unique)
#         → crée un enregistrement SubsetExport par export
#   GET  /api/subsets/{id}/exports     — liste des exports d'un subset
# ============================================================

import logging
from datetime import datetime
from pathlib import Path
from typing import List, Optional

import numpy as np
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from backend.core import audit
from backend.core.subset_manager import (
    create_subset_symlinks,
    delete_subset_dir,
    export_to_annotation_app,
    remove_from_subset_dir,
)
from backend.db.database import get_session
from backend.db.models import Embedding, Image, Subset, SubsetExport, SubsetImage

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["export"])


# ------------------------------------------------------------------ #
# Schémas                                                             #
# ------------------------------------------------------------------ #

class SubsetCreate(BaseModel):
    dataset_id: int
    name: str
    image_ids: List[int]


class DuplicateSubsetRequest(BaseModel):
    name: Optional[str] = None   # si absent : "{nom_original}_n"


class ExportToAnnotationRequest(BaseModel):
    custom_export_path: Optional[str] = None  # Chemin de destination (mode solo uniquement)


class SubsetExportInfo(BaseModel):
    id: int
    export_path: str
    export_type: str  # symlink | copy
    created_at: datetime


class SubsetSummary(BaseModel):
    id: int
    dataset_id: int
    name: str
    image_count: int
    symlink_dir: Optional[str]
    exported_to_annotation_app: bool
    export_path: Optional[str]
    locked: bool = False
    exports: List[SubsetExportInfo] = []
    created_at: datetime


# ------------------------------------------------------------------ #
# POST /api/subsets — créer depuis une sélection                      #
# ------------------------------------------------------------------ #

@router.post("/subsets", response_model=SubsetSummary, status_code=201)
def create_subset(body: SubsetCreate, session: Session = Depends(get_session)):
    if not body.image_ids:
        raise HTTPException(400, "Liste d'images vide")

    images = session.exec(
        select(Image).where(
            Image.id.in_(body.image_ids),
            Image.dataset_id == body.dataset_id,
        )
    ).all()
    if not images:
        raise HTTPException(404, "Aucune image valide trouvée")

    subset = Subset(
        dataset_id=body.dataset_id,
        name=body.name,
        image_count=len(images),
    )
    session.add(subset)
    session.commit()
    session.refresh(subset)

    for img in images:
        session.add(SubsetImage(subset_id=subset.id, image_id=img.id))
    session.commit()

    image_paths = [img.file_path for img in images]
    try:
        subset_dir = create_subset_symlinks(body.name, image_paths)
        subset.symlink_dir = str(subset_dir)
        session.commit()
    except Exception as exc:
        logger.warning("Liens subset echoues : %s", exc)

    session.refresh(subset)
    return _subset_to_schema(subset, session)


# ------------------------------------------------------------------ #
# POST /api/subsets/{id}/duplicate — dupliquer un subset              #
# ------------------------------------------------------------------ #

@router.post("/subsets/{subset_id}/duplicate", response_model=SubsetSummary, status_code=201)
def duplicate_subset(
    subset_id: int,
    body: Optional[DuplicateSubsetRequest] = None,
    session: Session = Depends(get_session),
):
    """
    Duplique un subset existant (images + liens, pas les exports).
    Le nom par défaut est "{nom_original}_n" (n auto-incrémenté).
    Fonctionne même si le subset original a été exporté.
    """
    original = session.get(Subset, subset_id)
    if not original:
        raise HTTPException(404, "Subset introuvable")

    # Nom de base
    base_name = (body.name.strip() if body and body.name else None) or original.name

    # Trouver le prochain numéro libre
    existing = session.exec(
        select(Subset.name).where(Subset.dataset_id == original.dataset_id)
    ).all()
    n = 1
    while f"{base_name}_{n}" in existing:
        n += 1
    new_name = f"{base_name}_{n}"

    # Récupérer les images du subset original
    links = session.exec(
        select(SubsetImage).where(SubsetImage.subset_id == subset_id)
    ).all()
    image_ids = [lnk.image_id for lnk in links]
    images = session.exec(select(Image).where(Image.id.in_(image_ids))).all()

    new_subset = Subset(
        dataset_id=original.dataset_id,
        name=new_name,
        image_count=len(images),
    )
    session.add(new_subset)
    session.commit()
    session.refresh(new_subset)

    for img in images:
        session.add(SubsetImage(subset_id=new_subset.id, image_id=img.id))
    session.commit()

    # Créer les liens
    image_paths = [img.file_path for img in images]
    try:
        subset_dir = create_subset_symlinks(new_name, image_paths)
        new_subset.symlink_dir = str(subset_dir)
        session.commit()
    except Exception as exc:
        logger.warning("Liens subset duplique echoues : %s", exc)

    session.refresh(new_subset)
    logger.info("Subset %d duplique -> %d ('%s')", subset_id, new_subset.id, new_name)
    return _subset_to_schema(new_subset, session)


# ------------------------------------------------------------------ #
# GET /api/subsets                                                    #
# ------------------------------------------------------------------ #

@router.get("/subsets", response_model=List[SubsetSummary])
def list_subsets(
    dataset_id: Optional[int] = None,
    session: Session = Depends(get_session),
):
    query = select(Subset)
    if dataset_id is not None:
        query = query.where(Subset.dataset_id == dataset_id)
    subsets = session.exec(query.order_by(Subset.created_at.desc())).all()
    return [_subset_to_schema(s, session) for s in subsets]


# ------------------------------------------------------------------ #
# DELETE /api/subsets/{id}                                            #
# ------------------------------------------------------------------ #

class SubsetLockRequest(BaseModel):
    locked: bool


@router.patch("/subsets/{subset_id}/lock", response_model=SubsetSummary)
def set_subset_lock(subset_id: int, body: SubsetLockRequest, session: Session = Depends(get_session)):
    """Verrouille/déverrouille un subset (protection anti-suppression).

    Le verrou était auparavant un simple useState côté React : il disparaissait
    au rechargement de la page et n'empêchait rien côté serveur.
    """
    subset = session.get(Subset, subset_id)
    if not subset:
        raise HTTPException(404, "Subset introuvable")
    subset.locked = body.locked
    session.commit()
    session.refresh(subset)
    audit.record("subset.lock", subset_id=subset_id, name=subset.name, locked=body.locked)
    return _subset_to_schema(subset, session)


@router.delete("/subsets/{subset_id}")
def delete_subset(subset_id: int, session: Session = Depends(get_session)):
    subset = session.get(Subset, subset_id)
    if not subset:
        raise HTTPException(404, "Subset introuvable")
    if subset.locked:
        raise HTTPException(409, f"Subset '{subset.name}' verrouille — le deverrouiller avant suppression")

    audit.record(
        "subset.delete",
        subset_id=subset_id, name=subset.name,
        dataset_id=subset.dataset_id, image_count=subset.image_count,
    )

    if subset.symlink_dir:
        try:
            delete_subset_dir(subset.symlink_dir)
        except Exception as exc:
            logger.warning("Suppression dossier echouee : %s", exc)

    links = session.exec(select(SubsetImage).where(SubsetImage.subset_id == subset_id)).all()
    for link in links:
        session.delete(link)

    exports = session.exec(select(SubsetExport).where(SubsetExport.subset_id == subset_id)).all()
    for exp in exports:
        session.delete(exp)

    session.delete(subset)
    session.commit()

    return {"success": True}


# ------------------------------------------------------------------ #
# POST /api/subsets/{id}/export-to-annotation-app                     #
# Plusieurs exports autorisés — un par chemin unique.                 #
# ------------------------------------------------------------------ #

@router.post("/subsets/{subset_id}/export-to-annotation-app")
def export_subset(
    subset_id: int,
    body: Optional[ExportToAnnotationRequest] = None,
    session: Session = Depends(get_session),
):
    import os
    subset = session.get(Subset, subset_id)
    if not subset:
        raise HTTPException(404, "Subset introuvable")

    links = session.exec(select(SubsetImage).where(SubsetImage.subset_id == subset_id)).all()
    image_ids = [link.image_id for link in links]
    images = session.exec(select(Image).where(Image.id.in_(image_ids))).all()
    # Une image rejetee (doublon) n'est jamais exportee, meme si elle est encore dans le subset.
    image_paths = [img.file_path for img in images if img.is_duplicate_kept is not False]

    # Mode solo : utiliser le chemin personnalisé si fourni
    # Mode orchestrateur : toujours ANNOTATION_APP_IMPORTS (env var)
    is_orch = bool(os.environ.get("LAUNCHED_BY_ORCHESTRATOR"))
    custom_path = None
    if not is_orch:
        # Chemin saisi dans la fenetre d'export, sinon le dossier d'imports des Parametres
        # (qui vaut ANNOTATION_APP_IMPORTS tant que l'utilisateur ne l'a pas change).
        from backend.api.settings import load_settings
        custom_path = (body.custom_export_path if body and body.custom_export_path else None)             or load_settings().annotation_app_imports_path

    try:
        target_dir = export_to_annotation_app(subset.name, image_paths, custom_base_dir=custom_path)
    except FileExistsError as exc:
        raise HTTPException(409, str(exc))
    except Exception as exc:
        raise HTTPException(500, f"Export echoue : {exc}")

    target_path_str = str(target_dir)
    audit.record(
        "subset.export",
        subset_id=subset_id, name=subset.name,
        target=target_path_str, image_count=len(image_paths),
    )

    # Vérifier si ce chemin exact existe déjà en export
    existing_exp = session.exec(
        select(SubsetExport).where(
            SubsetExport.subset_id == subset_id,
            SubsetExport.export_path == target_path_str,
        )
    ).first()

    if existing_exp:
        raise HTTPException(409, f"Ce chemin d'export existe déjà : {target_path_str}")

    # Déterminer le type (symlink ou copie)
    try:
        from backend.api.settings import load_settings
        export_type = "symlink" if load_settings().use_symlinks else "copy"
    except Exception:
        export_type = "symlink"

    # Enregistrer l'export
    exp = SubsetExport(
        subset_id=subset_id,
        export_path=target_path_str,
        export_type=export_type,
    )
    session.add(exp)

    # Compatibilité avec l'ancien champ export_path (premier export)
    if not subset.exported_to_annotation_app:
        subset.exported_to_annotation_app = True
        subset.export_path = target_path_str

    session.commit()

    return {
        "success": True,
        "export_path": target_path_str,
        "export_type": export_type,
        "image_count": len(image_paths),
    }


# ------------------------------------------------------------------ #
# GET /api/subsets/{id}/exports — liste des exports                   #
# ------------------------------------------------------------------ #

@router.get("/subsets/{subset_id}/exports", response_model=List[SubsetExportInfo])
def get_subset_exports(subset_id: int, session: Session = Depends(get_session)):
    subset = session.get(Subset, subset_id)
    if not subset:
        raise HTTPException(404, "Subset introuvable")

    exports = session.exec(
        select(SubsetExport)
        .where(SubsetExport.subset_id == subset_id)
        .order_by(SubsetExport.created_at)
    ).all()
    return [
        SubsetExportInfo(
            id=e.id,
            export_path=e.export_path,
            export_type=e.export_type,
            created_at=e.created_at,
        )
        for e in exports
    ]


# ------------------------------------------------------------------ #
# POST /api/subsets/{id}/apply-duplicate-filter                       #
# ------------------------------------------------------------------ #

@router.post("/subsets/{subset_id}/apply-duplicate-filter")
def apply_duplicate_filter(subset_id: int, session: Session = Depends(get_session)):
    subset = session.get(Subset, subset_id)
    if not subset:
        raise HTTPException(404, "Subset introuvable")

    links = session.exec(
        select(SubsetImage).where(SubsetImage.subset_id == subset_id)
    ).all()
    image_ids = [lnk.image_id for lnk in links]

    if not image_ids:
        return {"removed": 0, "subset_id": subset_id, "image_count": 0}

    images = session.exec(
        select(Image).where(Image.id.in_(image_ids))
    ).all()

    rejected = [img for img in images if img.is_duplicate_kept is False]
    rejected_ids = {img.id for img in rejected}

    if not rejected:
        return {"removed": 0, "subset_id": subset_id, "image_count": subset.image_count}

    for link in links:
        if link.image_id in rejected_ids:
            session.delete(link)

    subset.image_count = len(image_ids) - len(rejected)
    session.commit()

    if subset.symlink_dir:
        rejected_filenames = [img.filename for img in rejected]
        try:
            remove_from_subset_dir(subset.symlink_dir, rejected_filenames)
        except Exception as exc:
            logger.warning("Suppression fichiers subset echouee : %s", exc)

    logger.info(
        "Filtre doublon applique sur subset %d : %d images retirees",
        subset_id, len(rejected)
    )
    return {
        "removed": len(rejected),
        "subset_id": subset_id,
        "image_count": subset.image_count,
    }


# ------------------------------------------------------------------ #
# GET /api/subsets/{id}/duplicates                                    #
# ------------------------------------------------------------------ #

@router.get("/subsets/{subset_id}/duplicates")
def get_subset_duplicates(
    subset_id: int,
    threshold: float = 0.97,
    session: Session = Depends(get_session),
):
    subset = session.get(Subset, subset_id)
    if not subset:
        raise HTTPException(404, "Subset introuvable")

    links = session.exec(select(SubsetImage).where(SubsetImage.subset_id == subset_id)).all()
    image_ids = [lnk.image_id for lnk in links]

    if len(image_ids) < 2:
        return _empty_dup_response(subset_id, threshold)

    images = session.exec(
        select(Image).where(Image.id.in_(image_ids)).order_by(Image.id)
    ).all()

    vecs: List[np.ndarray] = []
    valid: List[Image] = []
    for img in images:
        emb = session.exec(
            select(Embedding).where(Embedding.image_id == img.id)
        ).first()
        if emb is not None:
            vec = np.frombuffer(emb.vector_blob, dtype=np.float32).copy()
            vecs.append(vec)
            valid.append(img)

    if len(vecs) < 2:
        return _empty_dup_response(subset_id, threshold)

    matrix = np.stack(vecs)
    sims = matrix @ matrix.T

    N = len(valid)
    visited: set[int] = set()
    groups: List[List[int]] = []

    for i in range(N):
        if i in visited:
            continue
        component = {i}
        queue = [i]
        while queue:
            curr = queue.pop()
            for j in range(N):
                if j not in component and float(sims[curr, j]) >= threshold:
                    component.add(j)
                    queue.append(j)
        if len(component) > 1:
            groups.append(sorted(component))
            visited.update(component)

    result_groups = []
    for group_idx, group in enumerate(groups):
        ref_idx = group[0]
        imgs_in_group = []
        for idx in group:
            img = valid[idx]
            sim_val = 1.0 if idx == ref_idx else float(sims[ref_idx, idx])
            imgs_in_group.append({
                "image_id": img.id,
                "filename": img.filename,
                "thumbnail_url": img.thumbnail_path,
                "similarity_to_representative": sim_val,
                "is_kept": img.is_duplicate_kept,
            })

        max_sim = float(np.max(sims[np.ix_(group, group)] - np.eye(len(group))))
        result_groups.append({
            "group_id": group_idx,
            "representative_image_id": valid[ref_idx].id,
            "images": sorted(imgs_in_group, key=lambda x: -x["similarity_to_representative"]),
            "max_sim": max_sim,
        })

    dup_count = sum(len(g["images"]) for g in result_groups)
    return {
        "subset_id": subset_id,
        "dataset_id": subset.dataset_id,
        "threshold": threshold,
        "group_count": len(result_groups),
        "duplicate_count": dup_count,
        "groups": result_groups,
    }


def _empty_dup_response(subset_id: int, threshold: float) -> dict:
    return {
        "subset_id": subset_id,
        "dataset_id": None,
        "threshold": threshold,
        "group_count": 0,
        "duplicate_count": 0,
        "groups": [],
    }


# ------------------------------------------------------------------ #
# Helper                                                              #
# ------------------------------------------------------------------ #

def _subset_to_schema(s: Subset, session: Session) -> SubsetSummary:
    exports = session.exec(
        select(SubsetExport)
        .where(SubsetExport.subset_id == s.id)
        .order_by(SubsetExport.created_at)
    ).all()
    return SubsetSummary(
        id=s.id,
        dataset_id=s.dataset_id,
        name=s.name,
        image_count=s.image_count,
        symlink_dir=s.symlink_dir,
        exported_to_annotation_app=s.exported_to_annotation_app,
        export_path=s.export_path,
        locked=bool(s.locked),
        exports=[
            SubsetExportInfo(
                id=e.id,
                export_path=e.export_path,
                export_type=e.export_type,
                created_at=e.created_at,
            )
            for e in exports
        ],
        created_at=s.created_at,
    )
