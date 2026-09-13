# ============================================================
# routers/projects.py
# Endpoints CRUD pour la gestion des projets d'annotation.
# Préfixe : /api/projects
# ============================================================

import json
import re
from datetime import datetime
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, status
from pydantic import BaseModel
from sqlmodel import Session, select

from backend.database import get_session
from backend.models.label_class import LabelClass
from backend.models.project import Project, ProjectType
from backend.models.session_state import SessionState
from backend.utils.color_utils import get_class_color

from backend.config import BACKUP_DIR as _BACKUP_DIR

router = APIRouter(prefix="/api/projects", tags=["Projets"])


# ---- Schémas Pydantic pour les requêtes/réponses ----

class LabelClassCreate(BaseModel):
    """Schéma de création d'une classe d'objet.
    Hiérarchie : name (classe, obligatoire) > subclass > subsubclass."""
    name: str
    color: Optional[str] = None  # Si None, couleur attribuée automatiquement
    supercategory: Optional[str] = None
    subclass: Optional[str] = None       # sous-classe (reconnaissance)
    subsubclass: Optional[str] = None    # sous-sous-classe (identification)
    shortcut_key: Optional[str] = None


class ProjectCreate(BaseModel):
    """Schéma de création d'un nouveau projet."""
    name: str
    description: Optional[str] = None
    project_type: ProjectType = ProjectType.IMAGE
    source_path: Optional[str] = None
    is_template: bool = False             # Projet demo du tutoriel interactif
    classes: List[LabelClassCreate] = []  # Classes initiales (optionnel)


class ProjectUpdate(BaseModel):
    """Schéma de mise à jour partielle d'un projet."""
    name: Optional[str] = None
    description: Optional[str] = None
    source_path: Optional[str] = None
    is_template: Optional[bool] = None


class SessionStateUpdate(BaseModel):
    """Schéma de mise à jour de l'état de session."""
    current_frame_index: Optional[int] = None
    zoom_level: Optional[float] = None
    canvas_offset_x: Optional[float] = None
    canvas_offset_y: Optional[float] = None
    selected_class_id: Optional[int] = None
    selected_tool: Optional[str] = None
    undo_stack_snapshot: Optional[str] = None
    timeline_filter: Optional[str] = None


# ---- Endpoints ----

@router.get("", response_model=List[dict])
def list_projects(session: Session = Depends(get_session)):
    """
    Liste tous les projets avec leurs statistiques de base, ainsi qu'un
    résumé par séquence (multi-séquence) pour l'affichage de la page d'accueil.
    Retourne un résumé sans les données volumineuses (frames, annotations).
    """
    from sqlmodel import func
    from backend.models.annotation import Annotation
    from backend.models.frame import Frame
    from backend.models.sequence import Sequence

    projects = session.exec(select(Project)).all()

    # Stats par séquence en 3 requêtes groupées (pas de N+1 par projet)
    seq_rows = session.exec(select(Sequence).order_by(Sequence.start_index)).all()
    annotated_by_seq = dict(session.exec(
        select(Frame.sequence_id, func.count(Frame.id))
        .where(Frame.is_annotated == True)  # noqa: E712
        .where(Frame.sequence_id != None)   # noqa: E711
        .group_by(Frame.sequence_id)
    ).all())
    ann_count_by_seq = dict(session.exec(
        select(Frame.sequence_id, func.count(Annotation.id))
        .join(Frame, Frame.id == Annotation.frame_id)
        .where(Frame.sequence_id != None)   # noqa: E711
        .group_by(Frame.sequence_id)
    ).all())

    seqs_by_project: dict[int, list[dict]] = {}
    for s in seq_rows:
        seqs_by_project.setdefault(s.project_id, []).append({
            "id": s.id,
            "name": s.name,
            "source_type": s.source_type,
            "start_index": s.start_index,
            "frame_count": s.frame_count,
            "annotated_frames": int(annotated_by_seq.get(s.id, 0) or 0),
            "annotation_count": int(ann_count_by_seq.get(s.id, 0) or 0),
        })

    return [
        {
            "id": p.id,
            "name": p.name,
            "description": p.description,
            "project_type": p.project_type,
            "source_path": p.source_path,
            "is_template": bool(p.is_template),
            "frame_count": p.frame_count,
            "annotated_count": p.annotated_count,
            "created_at": p.created_at.isoformat(),
            "updated_at": p.updated_at.isoformat(),
            "sequences": seqs_by_project.get(p.id, []),
        }
        for p in projects
    ]


@router.post("", response_model=dict, status_code=status.HTTP_201_CREATED)
def create_project(
    data: ProjectCreate,
    session: Session = Depends(get_session),
):
    """
    Crée un nouveau projet d'annotation avec ses classes initiales.
    Génère automatiquement le fichier classes.yaml et initialise la session.
    """
    # Création du projet
    project = Project(
        name=data.name,
        description=data.description,
        project_type=data.project_type,
        source_path=data.source_path,
        is_template=data.is_template,
    )
    session.add(project)
    session.flush()  # Pour obtenir l'ID généré avant le commit

    # Création des classes initiales
    for idx, class_data in enumerate(data.classes):
        color = class_data.color or get_class_color(idx)
        label_class = LabelClass(
            project_id=project.id,
            name=class_data.name,
            color=color,
            class_index=idx,
            supercategory=class_data.supercategory,
            subclass=class_data.subclass,
            subsubclass=class_data.subsubclass,
            shortcut_key=class_data.shortcut_key,
        )
        session.add(label_class)

    # Création de la session d'annotation vide
    sess_state = SessionState(project_id=project.id)
    session.add(sess_state)

    session.commit()
    session.refresh(project)

    # Mise à jour du classes.yaml
    from backend.services.dataset_service import dataset_service
    if data.classes:
        dataset_service.write_classes_yaml(
            project_id=project.id,
            class_names=[c.name for c in data.classes],
            class_colors=[c.color or get_class_color(i) for i, c in enumerate(data.classes)],
        )

    return {
        "id": project.id,
        "name": project.name,
        "description": project.description,
        "project_type": project.project_type,
        "is_template": bool(project.is_template),
        "frame_count": project.frame_count,
        "annotated_count": project.annotated_count,
        "created_at": project.created_at.isoformat(),
        "updated_at": project.updated_at.isoformat(),
    }


def _parse_lut(lut_json: Optional[str]) -> Optional[dict]:
    """lut_json (str) -> dict, ou None (= 3-sigma par défaut)."""
    if not lut_json:
        return None
    try:
        import json as _json
        d = _json.loads(lut_json)
        return d if isinstance(d, dict) else None
    except Exception:
        return None


class LutUpdate(BaseModel):
    mode: str = "sigma"                 # "sigma" | "minmax" | "manual"
    sigma: float = 3.0
    lo: Optional[float] = None
    hi: Optional[float] = None


@router.get("/{project_id}/lut", response_model=dict)
def get_project_lut(project_id: int, session: Session = Depends(get_session)):
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Projet introuvable")
    from backend.utils.image_utils import lut_signature
    lut = _parse_lut(project.lut_json)
    return {"lut": lut, "signature": lut_signature(lut)}


@router.put("/{project_id}/lut", response_model=dict)
def set_project_lut(project_id: int, body: LutUpdate, session: Session = Depends(get_session)):
    """Définit la LUT d'affichage du projet (persistée). Renvoie la signature de cache."""
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Projet introuvable")
    import json as _json
    lut = {"mode": body.mode, "sigma": body.sigma, "lo": body.lo, "hi": body.hi}
    project.lut_json = _json.dumps(lut)
    session.add(project)
    session.commit()
    from backend.utils.image_utils import lut_signature
    # Import local : dataset.py importe deja des symboles de ce module, un
    # import en tete recreerait un cycle a l'initialisation des routers.
    from backend.models.routers.dataset import purge_project_lut_caches
    purged = purge_project_lut_caches(session, project_id)
    return {"lut": lut, "signature": lut_signature(lut), "purged": purged}


@router.get("/{project_id}", response_model=dict)
def get_project(project_id: int, session: Session = Depends(get_session)):
    """
    Retourne le détail d'un projet incluant ses classes et sa session sauvegardée.
    """
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Projet introuvable")

    # Self-heal : frame_count stocké peut deriver du vrai nombre de frames
    # (extraction interrompue, import partiel). On recompte et on corrige.
    from backend.models.frame import Frame as _Frame
    from sqlmodel import func as _func
    actual_count = session.exec(
        select(_func.count(_Frame.id)).where(_Frame.project_id == project_id)
    ).one()
    actual_count = int(actual_count or 0)
    if actual_count != project.frame_count:
        # Best-effort : si la base est verrouillée par un import en cours,
        # on répond quand même avec le compte recalculé sans persister.
        try:
            project.frame_count = actual_count
            session.add(project)
            session.commit()
            session.refresh(project)
        except Exception:
            session.rollback()
            project.frame_count = actual_count

    # Classes du projet
    classes = session.exec(
        select(LabelClass)
        .where(LabelClass.project_id == project_id)
        .order_by(LabelClass.class_index)
    ).all()

    # État de la session sauvegardée
    sess = session.exec(
        select(SessionState).where(SessionState.project_id == project_id)
    ).first()

    return {
        "id": project.id,
        "name": project.name,
        "description": project.description,
        "project_type": project.project_type,
        "source_path": project.source_path,
        "is_template": bool(project.is_template),
        "frame_count": project.frame_count,
        "annotated_count": project.annotated_count,
        "created_at": project.created_at.isoformat(),
        "updated_at": project.updated_at.isoformat(),
        "lut": _parse_lut(project.lut_json),
        "classes": [
            {
                "id": c.id,
                "name": c.name,
                "color": c.color,
                "class_index": c.class_index,
                "supercategory": c.supercategory,
                "subclass": c.subclass,
                "subsubclass": c.subsubclass,
                "shortcut_key": c.shortcut_key,
            }
            for c in classes
        ],
        "session": {
            "current_frame_index": sess.current_frame_index if sess else 0,
            "zoom_level": sess.zoom_level if sess else 1.0,
            "canvas_offset_x": sess.canvas_offset_x if sess else 0.0,
            "canvas_offset_y": sess.canvas_offset_y if sess else 0.0,
            "selected_class_id": sess.selected_class_id if sess else None,
            "selected_tool": sess.selected_tool if sess else "select",
            "timeline_filter": sess.timeline_filter if sess else "all",
            "undo_stack_snapshot": sess.undo_stack_snapshot if sess else None,
            "last_saved": sess.last_saved.isoformat() if sess else None,
        } if sess else None,
    }


@router.put("/{project_id}", response_model=dict)
def update_project(
    project_id: int,
    data: ProjectUpdate,
    session: Session = Depends(get_session),
):
    """Met à jour les métadonnées d'un projet existant."""
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Projet introuvable")

    if data.name is not None:
        project.name = data.name
    if data.description is not None:
        project.description = data.description
    if data.source_path is not None:
        project.source_path = data.source_path
    if data.is_template is not None:
        project.is_template = data.is_template

    project.updated_at = datetime.utcnow()
    session.add(project)
    session.commit()
    session.refresh(project)

    return {"id": project.id, "name": project.name, "updated_at": project.updated_at.isoformat()}


@router.delete("/{project_id}", response_model=dict)
def delete_project(project_id: int, session: Session = Depends(get_session)):
    """
    Supprime un projet et TOUTES ses données associées (en cascade manuelle).
    Ordre imposé par les FK : annotations → frames → tracks → sequences →
    classes → session → projet. Bulk DELETE (rapide + fiable même sur gros projets).
    Supprime aussi le dossier physique data/projects/{project_id}/.
    """
    from sqlalchemy import delete as _sql_delete
    from backend.models.frame import Frame
    from backend.models.annotation import Annotation
    from backend.models.track import Track
    from backend.models.session_state import SessionState
    from backend.models.sequence import Sequence

    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Projet introuvable")

    # IDs des frames du projet (pour supprimer leurs annotations)
    frame_ids = session.exec(
        select(Frame.id).where(Frame.project_id == project_id)
    ).all()

    # 1. Annotations (référencent frame.id et track.id) — d'abord
    if frame_ids:
        session.exec(_sql_delete(Annotation).where(Annotation.frame_id.in_(frame_ids)))
    # 2. Frames (référencent sequence.id) — avant les séquences
    session.exec(_sql_delete(Frame).where(Frame.project_id == project_id))
    # 3. Tracks — AVANT les séquences : track.sequence_id référence sequence.id
    #    (sinon FOREIGN KEY constraint failed dès qu'un tracking a créé une piste).
    session.exec(_sql_delete(Track).where(Track.project_id == project_id))
    # 4. Séquences (référencent project.id)
    session.exec(_sql_delete(Sequence).where(Sequence.project_id == project_id))
    # 5. Classes
    session.exec(_sql_delete(LabelClass).where(LabelClass.project_id == project_id))
    # 6. Session state
    session.exec(_sql_delete(SessionState).where(SessionState.project_id == project_id))
    session.flush()

    # 7. Le projet lui-même
    session.delete(project)
    session.commit()

    # 8. Suppression du dossier de données physiques
    import shutil
    from backend.services.dataset_service import dataset_service
    project_dir = dataset_service.get_project_dir(project_id)
    if project_dir.exists():
        shutil.rmtree(project_dir, ignore_errors=True)

    return {"success": True, "deleted_id": project_id}


@router.get("/{project_id}/stats", response_model=dict)
def get_project_stats(project_id: int, session: Session = Depends(get_session)):
    """
    Statistiques détaillées du projet : distribution par classe,
    taux d'annotation, nombre de pistes, etc.
    """
    from sqlmodel import func
    from backend.models.annotation import Annotation
    from backend.models.frame import Frame

    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Projet introuvable")

    # Distribution des annotations par classe
    classes = session.exec(
        select(LabelClass)
        .where(LabelClass.project_id == project_id)
        .order_by(LabelClass.class_index)
    ).all()

    class_stats = []
    for cls in classes:
        count = session.exec(
            select(func.count(Annotation.id))
            .join(Frame, Annotation.frame_id == Frame.id)
            .where(Frame.project_id == project_id)
            .where(Annotation.class_id == cls.id)
        ).one()
        class_stats.append({
            "class_id": cls.id,
            "class_name": cls.name,
            "color": cls.color,
            "count": count,
        })

    return {
        "total_frames": project.frame_count,
        "annotated_frames": project.annotated_count,
        "annotation_rate": project.annotated_count / max(project.frame_count, 1),
        "classes_distribution": class_stats,
    }


@router.get("/{project_id}/session", response_model=dict)
def get_session_state(project_id: int, session: Session = Depends(get_session)):
    """Récupère l'état de session sauvegardé pour un projet."""
    sess = session.exec(
        select(SessionState).where(SessionState.project_id == project_id)
    ).first()

    if not sess:
        raise HTTPException(status_code=404, detail="Session introuvable")

    return {
        "current_frame_index": sess.current_frame_index,
        "zoom_level": sess.zoom_level,
        "canvas_offset_x": sess.canvas_offset_x,
        "canvas_offset_y": sess.canvas_offset_y,
        "selected_class_id": sess.selected_class_id,
        "selected_tool": sess.selected_tool,
        "timeline_filter": sess.timeline_filter,
        "undo_stack_snapshot": sess.undo_stack_snapshot,
        "last_saved": sess.last_saved.isoformat(),
    }


@router.put("/{project_id}/session", response_model=dict)
def update_session_state(
    project_id: int,
    data: SessionStateUpdate,
    session: Session = Depends(get_session),
):
    """
    Met à jour l'état de session (sauvegarde automatique toutes les 30s).
    Crée la session si elle n'existe pas encore.
    """
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Projet introuvable")

    sess = session.exec(
        select(SessionState).where(SessionState.project_id == project_id)
    ).first()

    if not sess:
        sess = SessionState(project_id=project_id)
        session.add(sess)

    # Mise à jour des champs modifiés uniquement
    if data.current_frame_index is not None:
        sess.current_frame_index = data.current_frame_index
    if data.zoom_level is not None:
        sess.zoom_level = data.zoom_level
    if data.canvas_offset_x is not None:
        sess.canvas_offset_x = data.canvas_offset_x
    if data.canvas_offset_y is not None:
        sess.canvas_offset_y = data.canvas_offset_y
    if data.selected_class_id is not None:
        sess.selected_class_id = data.selected_class_id
    if data.selected_tool is not None:
        sess.selected_tool = data.selected_tool
    if data.undo_stack_snapshot is not None:
        sess.undo_stack_snapshot = data.undo_stack_snapshot
    if data.timeline_filter is not None:
        sess.timeline_filter = data.timeline_filter

    sess.last_saved = datetime.utcnow()
    session.commit()

    return {"success": True, "last_saved": sess.last_saved.isoformat()}


# ---- Gestion des classes ----

@router.get("/{project_id}/classes", response_model=List[dict])
def list_classes(project_id: int, session: Session = Depends(get_session)):
    """Liste toutes les classes d'un projet dans l'ordre."""
    classes = session.exec(
        select(LabelClass)
        .where(LabelClass.project_id == project_id)
        .order_by(LabelClass.class_index)
    ).all()
    return [
        {
            "id": c.id,
            "project_id": c.project_id,
            "name": c.name,
            "color": c.color,
            "class_index": c.class_index,
            "supercategory": c.supercategory,
            "subclass": c.subclass,
            "subsubclass": c.subsubclass,
            "shortcut_key": c.shortcut_key,
        }
        for c in classes
    ]


class LabelClassUpdate(BaseModel):
    name: Optional[str] = None
    color: Optional[str] = None
    supercategory: Optional[str] = None
    subclass: Optional[str] = None
    subsubclass: Optional[str] = None
    shortcut_key: Optional[str] = None


@router.post("/{project_id}/classes", response_model=dict, status_code=201)
def create_class(
    project_id: int,
    data: LabelClassCreate,
    session: Session = Depends(get_session),
):
    """Ajoute une nouvelle classe au projet."""
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Projet introuvable")

    # Calcul de l'index suivant
    existing = session.exec(
        select(LabelClass).where(LabelClass.project_id == project_id)
    ).all()
    next_index = len(existing)
    color = data.color or get_class_color(next_index)

    cls = LabelClass(
        project_id=project_id,
        name=data.name,
        color=color,
        class_index=next_index,
        supercategory=data.supercategory,
        subclass=data.subclass,
        subsubclass=data.subsubclass,
        shortcut_key=data.shortcut_key,
    )
    session.add(cls)
    session.commit()
    session.refresh(cls)

    return {
        "id": cls.id,
        "name": cls.name,
        "color": cls.color,
        "class_index": cls.class_index,
        "subclass": cls.subclass,
        "subsubclass": cls.subsubclass,
    }


@router.put("/{project_id}/classes/{class_id}", response_model=dict)
def update_class(
    project_id: int,
    class_id: int,
    data: LabelClassUpdate,
    session: Session = Depends(get_session),
):
    """Met à jour une classe existante (nom, couleur, raccourci)."""
    cls = session.get(LabelClass, class_id)
    if not cls or cls.project_id != project_id:
        raise HTTPException(status_code=404, detail="Classe introuvable")

    if data.name is not None:
        cls.name = data.name
    if data.color is not None:
        cls.color = data.color
    if data.supercategory is not None:
        cls.supercategory = data.supercategory
    if data.subclass is not None:
        cls.subclass = data.subclass or None       # "" = effacer
    if data.subsubclass is not None:
        cls.subsubclass = data.subsubclass or None
    if data.shortcut_key is not None:
        cls.shortcut_key = data.shortcut_key

    session.add(cls)
    session.commit()

    return {"id": cls.id, "name": cls.name, "color": cls.color,
            "subclass": cls.subclass, "subsubclass": cls.subsubclass}


@router.delete("/{project_id}/classes/{class_id}", response_model=dict)
def delete_class(
    project_id: int,
    class_id: int,
    session: Session = Depends(get_session),
):
    """Supprime une classe. Attention : les annotations liées conservent la référence."""
    cls = session.get(LabelClass, class_id)
    if not cls or cls.project_id != project_id:
        raise HTTPException(status_code=404, detail="Classe introuvable")

    session.delete(cls)
    session.commit()

    return {"success": True, "deleted_id": class_id}


# ---- Sauvegarde / restauration des annotations ----

def _collect_backup_data(session, project_id: int) -> dict:
    """Construit le dict de backup CONSCIENT DES SÉQUENCES.

    Chaque frame porte `sequence_name` + `seq_frame_index` (index LOCAL dans la
    séquence) → la restauration peut redispatcher les annotations par séquence
    même si le projet a été recréé (ids DB différents). Top-level `sequences`
    liste les sources dans l'ordre (pour le fichier .txt de récupération)."""
    from backend.models.frame import Frame
    from backend.models.annotation import Annotation
    from backend.models.sequence import Sequence
    import json as _json

    seqs = session.exec(
        select(Sequence).where(Sequence.project_id == project_id).order_by(Sequence.start_index)
    ).all()
    seq_by_id = {s.id: s for s in seqs}

    frames = session.exec(
        select(Frame).where(Frame.project_id == project_id).order_by(Frame.frame_index)
    ).all()

    frames_out = []
    for frame in frames:
        seq = seq_by_id.get(frame.sequence_id) if frame.sequence_id else None
        seq_name = seq.name if seq else None
        local_idx = (frame.frame_index - seq.start_index) if seq else frame.frame_index
        annotations = session.exec(
            select(Annotation).where(Annotation.frame_id == frame.id)
        ).all()
        frames_out.append({
            "id": frame.id,
            "frame_index": frame.frame_index,
            "filename": frame.filename,
            "sequence_name": seq_name,        # redispatch par séquence (résilient)
            "seq_frame_index": local_idx,     # index LOCAL dans la séquence
            "annotations": [
                {
                    "id": a.id,
                    "class_id": a.class_id,
                    "annotation_type": a.annotation_type.value if hasattr(a.annotation_type, 'value') else a.annotation_type,
                    "cx": a.cx, "cy": a.cy, "width": a.width, "height": a.height,
                    "points": _json.loads(a.points) if a.points else None,
                    "confidence": a.confidence,
                    "track_id": a.track_id,
                    "is_auto": a.is_auto,
                    "is_interpolated": a.is_interpolated,
                }
                for a in annotations
            ],
        })

    sequences_out = [
        {"name": s.name, "source_path": s.source_path, "start_index": s.start_index,
         "frame_count": s.frame_count, "source_type": s.source_type}
        for s in seqs
    ]
    return {"frames": frames_out, "sequences": sequences_out}


@router.get("/{project_id}/backup")
def get_annotations_backup(
    project_id: int,
    session: Session = Depends(get_session),
):
    """
    Exporte toutes les annotations du projet en JSON.
    Utile pour la sauvegarde automatique et le rechargement de session.
    """
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Projet introuvable")

    data = _collect_backup_data(session, project_id)
    return {
        "project_id": project_id,
        "project_name": project.name,
        "sequences": data["sequences"],
        "frames": data["frames"],
    }


@router.post("/{project_id}/backup/save", response_model=dict)
def save_annotations_backup_to_disk(
    project_id: int,
    session: Session = Depends(get_session),
):
    """
    Sauvegarde les annotations du projet dans un fichier JSON sur le serveur.
    Cree un dossier backup/project_name_date/ contenant project_name_date.json.
    Appele automatiquement toutes les 2 minutes par le frontend.
    """
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Projet introuvable")

    data = _collect_backup_data(session, project_id)
    backup_data = {
        "project_id": project_id,
        "project_name": project.name,
        "saved_at": datetime.now().isoformat(),
        "sequences": data["sequences"],
        "frames": data["frames"],
    }

    # Sauvegarde UNIQUE par projet, ÉCRASÉE à chaque fois (S12). L'ancien schéma
    # créait un dossier horodaté {nom}_{timestamp} toutes les 2 min → accumulation
    # de centaines de JSON (GBs). On garde un seul fichier {id}_{nom}.json overwrite.
    # (L'horodatage reste dans le JSON via "saved_at".) Ctrl+Z/Y n'utilisent PAS
    # ces backups : ils reposent sur l'undo/redo EN MÉMOIRE de annotationStore.
    safe_name = re.sub(r'[^\w\-]', '_', project.name)
    folder_name = f"p{project_id}_{safe_name}"
    backup_dir = _BACKUP_DIR / folder_name
    backup_dir.mkdir(parents=True, exist_ok=True)

    backup_path = backup_dir / f"{folder_name}.json"
    with open(backup_path, "w", encoding="utf-8") as f:
        json.dump(backup_data, f, ensure_ascii=False, indent=2)

    # Fichier .txt des séquences (récupération) : une ligne « source_path<TAB>nom »
    # par séquence, DANS L'ORDRE. Le TAB évite l'ambiguïté (chemins avec espaces).
    # Ce .txt se glisse-dépose dans « Importer une séquence » pour tout re-remplir,
    # puis on glisse le .json pour récupérer les annotations. (step3b)
    seq_txt_path = backup_dir / f"{folder_name}_sequences.txt"
    seq_lines = [
        f"{s['source_path'] or ''}\t{s['name']}"
        for s in data["sequences"] if s.get("source_path")
    ]
    with open(seq_txt_path, "w", encoding="utf-8") as f:
        f.write("\n".join(seq_lines) + ("\n" if seq_lines else ""))

    return {
        "saved": True,
        "filename": f"{folder_name}.json",
        "path": str(backup_path),
        "sequences_txt": str(seq_txt_path),
        "total_frames": len(data["frames"]),
        "total_annotations": sum(len(fd["annotations"]) for fd in data["frames"]),
    }


@router.post("/{project_id}/restore")
def restore_annotations_backup(
    project_id: int,
    backup: dict = Body(...),
    session: Session = Depends(get_session),
):
    """
    Restaure les annotations depuis un JSON de sauvegarde, en REDISPATCHANT par
    SÉQUENCE (résilient aux ids DB différents après recréation du projet, aux
    séquences manquantes et à l'ordre différent).

    Correspondance des frames, par priorité :
      1. (sequence_name, seq_frame_index) — nom de séquence identique.
      2. Fallback positionnel : i-ème séquence du backup ↔ i-ème du projet
         (gère « 4 séquences dans le backup, 3 dans le projet, autre ordre »).
      3. Backup legacy (sans info séquence) : par id DB, sinon par frame_index.
    Les track_id absents du projet sont neutralisés (None) pour éviter les FK mortes.
    """
    from backend.models.frame import Frame
    from backend.models.annotation import Annotation, AnnotationType
    from backend.models.sequence import Sequence
    from backend.models.track import Track
    from sqlalchemy import func as _func
    import json

    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Projet introuvable")

    # ---- Cartes du projet courant ----
    proj_seqs = session.exec(
        select(Sequence).where(Sequence.project_id == project_id).order_by(Sequence.start_index)
    ).all()
    proj_seq_by_name = {s.name: s for s in proj_seqs}
    start_by_seq = {s.id: s.start_index for s in proj_seqs}

    all_frames = session.exec(
        select(Frame).where(Frame.project_id == project_id).order_by(Frame.frame_index)
    ).all()
    by_id: dict = {}
    by_global_index: dict = {}
    legacy_by_index: dict = {}          # frames sans séquence : frame_index -> Frame
    seq_local_map: dict = {}            # seq_id -> {index_local: Frame}
    for fr in all_frames:
        by_id[fr.id] = fr
        by_global_index[fr.frame_index] = fr
        if fr.sequence_id and fr.sequence_id in start_by_seq:
            seq_local_map.setdefault(fr.sequence_id, {})[fr.frame_index - start_by_seq[fr.sequence_id]] = fr
        else:
            legacy_by_index[fr.frame_index] = fr

    existing_track_ids = {
        t.id for t in session.exec(select(Track).where(Track.project_id == project_id)).all()
    }

    # ---- Correspondance séquences backup -> projet ----
    backup_seq_names = [bs.get("name") for bs in (backup.get("sequences") or [])]

    def _resolve_seq(name):
        if name in proj_seq_by_name:
            return proj_seq_by_name[name]                      # même nom
        if name in backup_seq_names:                           # fallback positionnel
            i = backup_seq_names.index(name)
            if i < len(proj_seqs):
                return proj_seqs[i]
        return None

    def _find_frame(fd):
        s_name = fd.get("sequence_name")
        local = fd.get("seq_frame_index")
        if s_name is not None and local is not None:
            tgt = _resolve_seq(s_name)
            if tgt is not None:
                f = seq_local_map.get(tgt.id, {}).get(local)
                if f is not None:
                    return f
            # séquence backup introuvable dans le projet → repli sur l'index
            return legacy_by_index.get(local) or by_global_index.get(local)
        # backup legacy (sans info séquence) : id DB puis frame_index global
        fid = fd.get("id")
        if fid and fid in by_id:
            return by_id[fid]
        gidx = fd.get("frame_index")
        if gidx is not None:
            return by_global_index.get(gidx)
        return None

    restored_count = 0
    matched_frames = 0
    touched_frames: set = set()

    for frame_data in backup.get("frames", []):
        frame = _find_frame(frame_data)
        if frame is None or frame.project_id != project_id:
            continue
        matched_frames += 1
        touched_frames.add(frame.id)

        for ann in session.exec(select(Annotation).where(Annotation.frame_id == frame.id)).all():
            session.delete(ann)

        anns = frame_data.get("annotations", [])
        for ann_data in anns:
            points_val = ann_data.get("points")
            tid = ann_data.get("track_id")
            if tid not in existing_track_ids:
                tid = None
            session.add(Annotation(
                frame_id=frame.id,
                class_id=ann_data["class_id"],
                annotation_type=AnnotationType(ann_data.get("annotation_type", "bbox")),
                cx=ann_data["cx"], cy=ann_data["cy"],
                width=ann_data["width"], height=ann_data["height"],
                points=json.dumps(points_val) if points_val else None,
                confidence=ann_data.get("confidence", 1.0),
                track_id=tid,
                is_auto=ann_data.get("is_auto", False),
                is_interpolated=ann_data.get("is_interpolated", False),
            ))
            restored_count += 1
        frame.is_annotated = len(anns) > 0
        session.add(frame)

    # Recompte du compteur projet (frames touchées ont pu changer d'état)
    project.annotated_count = int(session.exec(
        select(_func.count(Frame.id))
        .where(Frame.project_id == project_id)
        .where(Frame.is_annotated == True)  # noqa: E712
    ).one() or 0)
    session.add(project)
    session.commit()

    return {"success": True, "restored_count": restored_count,
            "matched_frames": matched_frames, "backup_frames": len(backup.get("frames", []))}
