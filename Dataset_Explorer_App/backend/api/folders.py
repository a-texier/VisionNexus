# ============================================================
# api/folders.py
# Arborescence de dossiers pour organiser les datasets (step 3).
#
# Deux portées, en miroir des datasets :
#   - perso   (is_global=False) : uniquement dans la DB du workspace
#   - partagé (is_global=True)  : persisté dans folders_registry.json et
#     re-synchronisé dans CHAQUE workspace par son `uid` stable → visible partout.
#
# GET    /api/folders          — arbre (plat) : sync des dossiers partagés d'abord
# POST   /api/folders          — créer (imbriqué, is_global optionnel)
# PATCH  /api/folders/{id}     — renommer / déplacer
# DELETE /api/folders/{id}     — supprimer (réattache enfants+datasets au parent)
# ============================================================

import json
import logging
import tempfile
import uuid
from datetime import datetime
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from backend.config import CURRENT_USER, DATASET_GALLERY_DIR
from backend.db.database import get_session
from backend.db.models import Dataset, Folder

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["folders"])

FOLDERS_REGISTRY_FILE = DATASET_GALLERY_DIR / "folders_registry.json"


# ------------------------------------------------------------------ #
# Registre des dossiers partagés (JSON atomique, comme datasets)      #
# ------------------------------------------------------------------ #

def load_folders_registry() -> list[dict]:
    try:
        if FOLDERS_REGISTRY_FILE.exists():
            data = json.loads(FOLDERS_REGISTRY_FILE.read_text(encoding="utf-8"))
            return data if isinstance(data, list) else []
    except Exception as exc:
        logger.warning("Registre dossiers illisible : %s", exc)
    return []


def _save_folders_registry(entries: list[dict]) -> None:
    tmp_path: str | None = None
    try:
        FOLDERS_REGISTRY_FILE.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", dir=str(FOLDERS_REGISTRY_FILE.parent),
            suffix=".tmp", delete=False,
        ) as tmp:
            json.dump(entries, tmp, ensure_ascii=False, default=str, indent=2)
            tmp_path = tmp.name
        Path(tmp_path).replace(FOLDERS_REGISTRY_FILE)
    except Exception as exc:
        logger.warning("Ecriture registre dossiers echouee : %s", exc)
        if tmp_path:
            try:
                Path(tmp_path).unlink(missing_ok=True)
            except Exception:
                pass


# Correspondance id -> parent_uid, remplie juste avant chaque écriture registre.
_PARENT_UID_CACHE: dict[int, Optional[str]] = {}


def _upsert_folder_registry(folder: Folder) -> None:
    """Insère/maj un dossier partagé dans le registre (clé = uid).
    Le parent_uid doit avoir été renseigné dans _PARENT_UID_CACHE au préalable."""
    if not folder.uid:
        return
    entries = [e for e in load_folders_registry() if e.get("uid") != folder.uid]
    entries.append({
        "uid": folder.uid,
        "name": folder.name,
        "parent_uid": _PARENT_UID_CACHE.get(folder.id),
        "added_by": folder.added_by,
        "created_at": str(folder.created_at),
    })
    _save_folders_registry(entries)


def _parent_uid_of(session: Session, parent_id: Optional[int]) -> Optional[str]:
    if parent_id is None:
        return None
    parent = session.get(Folder, parent_id)
    return parent.uid if parent else None


def sync_shared_folders(session: Session) -> None:
    """Matérialise dans la DB du workspace les dossiers partagés du registre
    absents localement (résolution parent par uid). Parents avant enfants."""
    entries = load_folders_registry()
    if not entries:
        return
    # index uid -> folder DB
    existing = {f.uid: f for f in session.exec(select(Folder).where(Folder.uid.is_not(None))).all()}
    changed = False
    # boucle jusqu'à stabilité (les parents peuvent précéder/suivre les enfants)
    for _ in range(len(entries) + 1):
        progressed = False
        for e in entries:
            uid = e.get("uid")
            if not uid or uid in existing:
                continue
            parent_uid = e.get("parent_uid")
            parent_id = None
            if parent_uid:
                pf = existing.get(parent_uid)
                if pf is None:
                    continue  # parent pas encore matérialisé → prochain tour
                parent_id = pf.id
            try:
                created = datetime.fromisoformat(e["created_at"]) if isinstance(e.get("created_at"), str) else datetime.utcnow()
            except Exception:
                created = datetime.utcnow()
            f = Folder(name=e.get("name", "dossier"), parent_id=parent_id,
                       is_global=True, uid=uid, added_by=e.get("added_by"),
                       created_at=created)
            session.add(f)
            session.commit()
            session.refresh(f)
            existing[uid] = f
            changed = progressed = True
        if not progressed:
            break
    if changed:
        logger.info("Dossiers partages synchronises dans le workspace")


# ------------------------------------------------------------------ #
# Schémas                                                             #
# ------------------------------------------------------------------ #

class FolderCreate(BaseModel):
    name: str
    parent_id: Optional[int] = None
    is_global: bool = False


class FolderUpdate(BaseModel):
    name: Optional[str] = None
    parent_id: Optional[int] = None


class FolderOut(BaseModel):
    id: int
    name: str
    parent_id: Optional[int]
    is_global: bool
    uid: Optional[str]
    added_by: Optional[str]
    dataset_count: int = 0


# ------------------------------------------------------------------ #
# Endpoints                                                           #
# ------------------------------------------------------------------ #

@router.get("/folders", response_model=List[FolderOut])
def list_folders(session: Session = Depends(get_session)):
    sync_shared_folders(session)
    folders = session.exec(select(Folder)).all()
    # comptage direct de datasets par dossier
    counts: dict[int, int] = {}
    for d in session.exec(select(Dataset)).all():
        if d.folder_id is not None:
            counts[d.folder_id] = counts.get(d.folder_id, 0) + 1
    return [
        FolderOut(
            id=f.id, name=f.name, parent_id=f.parent_id, is_global=f.is_global,
            uid=f.uid, added_by=f.added_by, dataset_count=counts.get(f.id, 0),
        )
        for f in folders
    ]


@router.post("/folders", response_model=FolderOut, status_code=201)
def create_folder(body: FolderCreate, session: Session = Depends(get_session)):
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "Nom de dossier requis")
    if body.parent_id is not None and not session.get(Folder, body.parent_id):
        raise HTTPException(400, "Dossier parent introuvable")

    folder = Folder(
        name=name,
        parent_id=body.parent_id,
        is_global=body.is_global,
        uid=uuid.uuid4().hex if body.is_global else None,
        added_by=CURRENT_USER,
    )
    session.add(folder)
    session.commit()
    session.refresh(folder)

    if folder.is_global:
        _PARENT_UID_CACHE[folder.id] = _parent_uid_of(session, folder.parent_id)
        _upsert_folder_registry(folder)

    return FolderOut(id=folder.id, name=folder.name, parent_id=folder.parent_id,
                     is_global=folder.is_global, uid=folder.uid, added_by=folder.added_by)


@router.patch("/folders/{folder_id}", response_model=FolderOut)
def update_folder(folder_id: int, body: FolderUpdate, session: Session = Depends(get_session)):
    folder = session.get(Folder, folder_id)
    if not folder:
        raise HTTPException(404, "Dossier introuvable")
    if body.name is not None and body.name.strip():
        folder.name = body.name.strip()
    if body.parent_id is not None or ("parent_id" in body.model_fields_set):
        if body.parent_id == folder.id:
            raise HTTPException(400, "Un dossier ne peut pas être son propre parent")
        if body.parent_id is not None and not session.get(Folder, body.parent_id):
            raise HTTPException(400, "Dossier parent introuvable")
        folder.parent_id = body.parent_id
    session.commit()
    session.refresh(folder)

    if folder.is_global:
        _PARENT_UID_CACHE[folder.id] = _parent_uid_of(session, folder.parent_id)
        _upsert_folder_registry(folder)

    return FolderOut(id=folder.id, name=folder.name, parent_id=folder.parent_id,
                     is_global=folder.is_global, uid=folder.uid, added_by=folder.added_by)


@router.delete("/folders/{folder_id}")
def delete_folder(folder_id: int, session: Session = Depends(get_session)):
    folder = session.get(Folder, folder_id)
    if not folder:
        raise HTTPException(404, "Dossier introuvable")

    new_parent = folder.parent_id
    # Réattacher enfants et datasets au parent du dossier supprimé
    for child in session.exec(select(Folder).where(Folder.parent_id == folder_id)).all():
        child.parent_id = new_parent
    for ds in session.exec(select(Dataset).where(Dataset.folder_id == folder_id)).all():
        ds.folder_id = new_parent

    if folder.is_global and folder.uid:
        entries = [e for e in load_folders_registry() if e.get("uid") != folder.uid]
        _save_folders_registry(entries)

    session.delete(folder)
    session.commit()
    return {"success": True}
