# ============================================================
# routers/annotation.py
# Endpoints CRUD pour les annotations YOLO.
# Gère la création, modification, suppression des boîtes et polygones,
# ainsi que les fonctionnalités avancées :
#   - Copier/coller entre frames
#   - Détection d'overlaps (doublons)
#   - Interpolation linéaire entre keyframes
# ============================================================

import json
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlmodel import Session, func, select

from backend.database import get_session
from backend.models.annotation import Annotation, AnnotationType
from backend.models.frame import Frame
from backend.models.project import Project

router = APIRouter(tags=["Annotations"])


# ---- Schémas Pydantic ----

class AnnotationCreate(BaseModel):
    """Schéma de création d'une annotation."""
    class_id: int
    annotation_type: AnnotationType = AnnotationType.BBOX
    # Coordonnées YOLO normalisées [0, 1]
    cx: float
    cy: float
    width: float
    height: float
    # Points du polygone (optionnel)
    points: Optional[List[List[float]]] = None
    # Référence à une piste de tracking (optionnel)
    track_id: Optional[int] = None
    confidence: float = 1.0
    is_auto: bool = False
    is_interpolated: bool = False
    # Algorithme source : 'manual', 'sam_point', 'sam_auto', 'grounding_dino', 'bytetrack', 'interpolation'
    source_algorithm: Optional[str] = None


class AnnotationUpdate(BaseModel):
    """Schéma de mise à jour partielle d'une annotation."""
    class_id: Optional[int] = None
    cx: Optional[float] = None
    cy: Optional[float] = None
    width: Optional[float] = None
    height: Optional[float] = None
    points: Optional[List[List[float]]] = None
    track_id: Optional[int] = None
    confidence: Optional[float] = None


class BulkAnnotationsCreate(BaseModel):
    """Schéma pour l'ajout en lot d'annotations."""
    annotations: List[AnnotationCreate]
    replace: bool = False  # Si True, supprime les annotations existantes avant insertion


class CopyToFramesRequest(BaseModel):
    """Requête de copie d'annotations vers d'autres frames."""
    target_frame_ids: List[int]
    overwrite: bool = False  # Supprimer les annotations existantes avant copie


class InterpolateRequest(BaseModel):
    """Requête d'interpolation entre deux frames annotées."""
    track_id: Optional[int] = None  # Si None, interpoler toutes les annotations
    start_frame_id: int              # Frame de début (keyframe)
    end_frame_id: int                # Frame de fin (keyframe)


# ---- Fonctions utilitaires ----

def _annotation_to_dict(a: Annotation) -> dict:
    """Convertit une annotation SQLModel en dict JSON-sérialisable."""
    return {
        "id": a.id,
        "frame_id": a.frame_id,
        "track_id": a.track_id,
        "class_id": a.class_id,
        "annotation_type": a.annotation_type,
        "cx": a.cx,
        "cy": a.cy,
        "width": a.width,
        "height": a.height,
        "points": a.get_points(),
        "confidence": a.confidence,
        "is_auto": a.is_auto,
        "is_interpolated": a.is_interpolated,
        "source_algorithm": getattr(a, 'source_algorithm', None),
        "created_at": a.created_at.isoformat(),
    }


def _update_frame_annotation_status(
    frame: Frame,
    session: Session,
) -> None:
    """Met à jour le statut is_annotated d'une frame et le compteur du projet."""
    ann_count = session.exec(
        select(func.count(Annotation.id)).where(Annotation.frame_id == frame.id)
    ).one()

    frame.is_annotated = ann_count > 0
    session.add(frame)

    # Mise à jour du compteur du projet
    project = session.get(Project, frame.project_id)
    if project:
        annotated_count = session.exec(
            select(func.count(Frame.id))
            .where(Frame.project_id == frame.project_id)
            .where(Frame.is_annotated == True)
        ).one()
        project.annotated_count = annotated_count
        session.add(project)


def _compact_after_delete(project_id: int, removed_uid: int, session: Session,
                          sequence_id=None) -> None:
    """Renumérote les track_uid pour rester contigu après suppression d'une piste,
    DANS la même séquence (0,1,2,3 → suppr 2 → 3 devient 2). Les annotations
    référencent le track_id (PK), pas l'uid. À appeler APRÈS le delete + flush."""
    from backend.models.track import Track
    q = (
        select(Track)
        .where(Track.project_id == project_id)
        .where(Track.track_uid > removed_uid)
    )
    if sequence_id is None:
        q = q.where(Track.sequence_id.is_(None))
    else:
        q = q.where(Track.sequence_id == sequence_id)
    for t in session.exec(q).all():
        t.track_uid = t.track_uid - 1
        session.add(t)


def _prune_empty_tracks(track_ids, session: Session) -> None:
    """Supprime les tracks (parmi `track_ids`) devenues vides (0 annotation) et
    renumérote les uids. À appeler après une suppression d'annotations (undo/bulk-replace)."""
    from backend.models.track import Track
    for tid in {t for t in track_ids if t is not None}:
        track = session.get(Track, tid)
        if not track:
            continue
        remaining = session.exec(
            select(func.count(Annotation.id)).where(Annotation.track_id == tid)
        ).one()
        if remaining and remaining > 0:
            continue
        removed_uid, project_id = track.track_uid, track.project_id
        session.delete(track)
        session.flush()
        _compact_after_delete(project_id, removed_uid, session)


# ---- Endpoints ----

@router.get("/api/projects/{project_id}/annotations/all", response_model=List[dict])
def list_all_project_annotations(project_id: int, session: Session = Depends(get_session)):
    """Retourne toutes les annotations du projet en une seule requete (cache client)."""
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Projet introuvable")

    annotations = session.exec(
        select(Annotation)
        .join(Frame, Annotation.frame_id == Frame.id)
        .where(Frame.project_id == project_id)
    ).all()

    return [_annotation_to_dict(a) for a in annotations]


@router.get("/api/frames/{frame_id}/annotations", response_model=List[dict])
def list_annotations(frame_id: int, session: Session = Depends(get_session)):
    """Retourne toutes les annotations d'une frame."""
    frame = session.get(Frame, frame_id)
    if not frame:
        raise HTTPException(status_code=404, detail="Frame introuvable")

    annotations = session.exec(
        select(Annotation).where(Annotation.frame_id == frame_id)
    ).all()

    return [_annotation_to_dict(a) for a in annotations]


@router.post("/api/frames/{frame_id}/annotations", response_model=dict, status_code=201)
def create_annotation(
    frame_id: int,
    data: AnnotationCreate,
    session: Session = Depends(get_session),
):
    """
    Crée une nouvelle annotation sur une frame.
    Valide les coordonnées YOLO avant insertion.
    """
    frame = session.get(Frame, frame_id)
    if not frame:
        raise HTTPException(status_code=404, detail="Frame introuvable")

    # Validation de la class_id (évite la contrainte FOREIGN KEY sur LabelClass)
    from backend.models.label_class import LabelClass
    if data.class_id is not None:
        label_class = session.get(LabelClass, data.class_id)
        if not label_class:
            raise HTTPException(
                status_code=422,
                detail=f"Classe {data.class_id} introuvable. Selectionnez une classe avant d'annoter."
            )
    else:
        raise HTTPException(
            status_code=422,
            detail="class_id requis. Selectionnez une classe avant d'annoter."
        )

    # Validation des coordonnées YOLO
    from backend.utils.yolo_utils import validate_yolo_coordinates
    valid, msg = validate_yolo_coordinates(data.cx, data.cy, data.width, data.height)
    if not valid:
        raise HTTPException(status_code=422, detail=f"Coordonnées YOLO invalides : {msg}")

    ann = Annotation(
        frame_id=frame_id,
        class_id=data.class_id,
        annotation_type=data.annotation_type,
        cx=data.cx,
        cy=data.cy,
        width=data.width,
        height=data.height,
        track_id=data.track_id,
        confidence=data.confidence,
        is_auto=data.is_auto,
        is_interpolated=data.is_interpolated,
        source_algorithm=data.source_algorithm,
    )

    if data.points:
        ann.set_points([(p[0], p[1]) for p in data.points])

    session.add(ann)

    # Mise à jour du statut de la frame
    frame.is_annotated = True
    session.add(frame)

    # Mise à jour du compteur du projet
    project = session.get(Project, frame.project_id)
    if project:
        annotated_count = session.exec(
            select(func.count(Frame.id))
            .where(Frame.project_id == frame.project_id)
            .where(Frame.is_annotated == True)
        ).one()
        project.annotated_count = annotated_count
        session.add(project)

    # ---- Auto-track (MOT) ----
    # Dans un projet VIDÉO (mode "tracks", pas "random"/images), TOUTE annotation
    # manuelle sans piste reçoit automatiquement une piste : un objet a toujours
    # un track_id. On peut ensuite la réassigner via la liste d'annotations.
    #
    # L'uid attribué dépend de ce qu'il y a DANS LA FRAME, pas du nombre de
    # pistes de la séquence : on prend le plus petit uid libre sur cette frame
    # (frame vide -> 0, frame contenant deja 0 -> 1, contenant 0 et 1 -> 2...).
    # Avant, l'uid valait max(uid de la sequence) + 1 : sur une sequence ayant
    # deja servi, une premiere bbox sur une frame vierge sortait en "track 37",
    # numero sans rapport avec l'image affichee.
    #
    # Si une piste porte deja cet uid ailleurs dans la sequence, on la REJOINT
    # au lieu d'en creer une seconde : l'uid identifie l'objet sur toute la
    # sequence (c'est lui qu'on ecrit dans le .ver), donc deux lignes Track de
    # meme uid casseraient a la fois l'export et la renumerotation
    # (_compact_track_uids suppose l'unicite). Pas de nouvelle barre timeline
    # dans ce cas : l'annotation vient prolonger la piste existante.
    from backend.models.project import ProjectType
    if (
        data.track_id is None
        and not data.is_auto
        and project is not None
        and project.project_type == ProjectType.VIDEO
    ):
        from backend.models.routers.tracking import _free_track_uid_for_frame
        from backend.utils.color_utils import get_track_color
        from backend.models.track import Track
        seq_id = getattr(frame, "sequence_id", None)
        uid = _free_track_uid_for_frame(project.id, frame, session, seq_id)
        q = (
            select(Track)
            .where(Track.project_id == project.id)
            .where(Track.track_uid == uid)
        )
        q = q.where(Track.sequence_id.is_(None)) if seq_id is None else q.where(Track.sequence_id == seq_id)
        track = session.exec(q).first()
        if track is None:
            track = Track(
                project_id=project.id,
                sequence_id=seq_id,
                track_uid=uid,
                class_id=data.class_id,
                color=get_track_color(uid),
                start_frame=frame.frame_index,
                end_frame=frame.frame_index,
            )
            session.add(track)
            session.flush()  # obtient track.id
        else:
            # Piste rejointe : elargir ses bornes pour que la barre timeline
            # couvre la nouvelle frame.
            track.start_frame = min(track.start_frame, frame.frame_index)
            track.end_frame = max(track.end_frame, frame.frame_index)
            session.add(track)
        ann.track_id = track.id
        session.add(ann)

    session.commit()
    session.refresh(ann)

    return _annotation_to_dict(ann)


@router.put("/api/annotations/{annotation_id}", response_model=dict)
def update_annotation(
    annotation_id: int,
    data: AnnotationUpdate,
    session: Session = Depends(get_session),
):
    """
    Met à jour partiellement une annotation (position, classe, etc.).
    Utilisé lors du redimensionnement ou déplacement d'une box sur le canvas.
    """
    ann = session.get(Annotation, annotation_id)
    if not ann:
        raise HTTPException(status_code=404, detail="Annotation introuvable")

    if data.class_id is not None:
        ann.class_id = data.class_id
    if data.cx is not None:
        ann.cx = data.cx
    if data.cy is not None:
        ann.cy = data.cy
    if data.width is not None:
        ann.width = data.width
    if data.height is not None:
        ann.height = data.height
    if data.points is not None:
        ann.set_points([(p[0], p[1]) for p in data.points])
    if data.track_id is not None:
        ann.track_id = data.track_id
    if data.confidence is not None:
        ann.confidence = data.confidence

    # Monitoring : tracer la retouche AVANT d'effacer la provenance, sinon on perd
    # l'information « cette boite venait de SAMURAI et l'humain l'a corrigee ».
    from backend.services.monitoring_service import record_edit
    record_edit(annotation_id, ann.source_algorithm, frame_id=ann.frame_id)

    # Réinitialisation : si modifiée manuellement, l'annotation n'est plus "auto"
    ann.is_auto = False
    ann.is_interpolated = False

    session.add(ann)
    session.commit()
    session.refresh(ann)

    return _annotation_to_dict(ann)


@router.delete("/api/annotations/{annotation_id}", response_model=dict)
def delete_annotation(annotation_id: int, session: Session = Depends(get_session)):
    """Supprime une annotation, met à jour les compteurs et recalcule les bornes du track associé."""
    ann = session.get(Annotation, annotation_id)
    if not ann:
        raise HTTPException(status_code=404, detail="Annotation introuvable")

    frame_id = ann.frame_id
    track_id = ann.track_id  # Sauvegarder avant la suppression
    # Monitoring : sur une sortie automatique, une suppression manuelle est un
    # signal de fausse alarme du modele — a lire avec le taux de retouche.
    from backend.services.monitoring_service import record_delete
    record_delete(annotation_id, ann.source_algorithm, frame_id=frame_id)
    session.delete(ann)
    session.flush()

    # Mise à jour du statut de la frame
    frame = session.get(Frame, frame_id)
    if frame:
        _update_frame_annotation_status(frame, session)

    # Recalcul des bornes du track si l'annotation appartenait à une piste
    if track_id is not None:
        from backend.models.track import Track
        track = session.get(Track, track_id)
        if track:
            remaining_frame_ids = session.exec(
                select(Annotation.frame_id).where(Annotation.track_id == track_id)
            ).all()
            if remaining_frame_ids:
                frame_indices = session.exec(
                    select(Frame.frame_index).where(Frame.id.in_(list(remaining_frame_ids)))
                ).all()
                if frame_indices:
                    track.start_frame = min(frame_indices)
                    track.end_frame = max(frame_indices)
                    session.add(track)
                else:
                    removed_uid, pid = track.track_uid, track.project_id
                    session.delete(track)
                    session.flush()
                    _compact_after_delete(pid, removed_uid, session)
            else:
                # Plus aucune annotation → supprimer le track entier + renumérotation
                removed_uid, pid = track.track_uid, track.project_id
                session.delete(track)
                session.flush()
                _compact_after_delete(pid, removed_uid, session)

    session.commit()
    return {"success": True, "deleted_id": annotation_id}


@router.post("/api/frames/{frame_id}/annotations/bulk", response_model=dict)
def bulk_create_annotations(
    frame_id: int,
    data: BulkAnnotationsCreate,
    session: Session = Depends(get_session),
):
    """
    Ajoute plusieurs annotations en une seule requête.
    Si replace=True, supprime toutes les annotations existantes avant l'insertion.
    Utilisé pour sauvegarder les résultats d'une auto-segmentation SAM2.
    """
    frame = session.get(Frame, frame_id)
    if not frame:
        raise HTTPException(status_code=404, detail="Frame introuvable")

    # Suppression optionnelle des annotations existantes
    removed_track_ids: set = set()
    if data.replace:
        existing = session.exec(
            select(Annotation).where(Annotation.frame_id == frame_id)
        ).all()
        for ann in existing:
            if ann.track_id is not None:
                removed_track_ids.add(ann.track_id)
            session.delete(ann)
        session.flush()

    # Insertion des nouvelles annotations
    from backend.models.label_class import LabelClass as _LabelClass
    from backend.models.track import Track as _Track
    from backend.models.project import ProjectType as _PT

    # Réconciliation des track_id périmés (cas REDO après suppression d'une piste par
    # undo/step 3) : un track_id du snapshot peut ne plus exister. Sans réparation,
    # l'INSERT viole la clé étrangère → le redo échoue silencieusement (Ctrl+Y « KO »).
    # → projet vidéo + annotation manuelle : on RECRÉE une piste (uid = max+1, contigu) ;
    #   sinon on détache (track_id=None). Un même ancien id est remappé une seule fois.
    _proj = session.get(Project, frame.project_id)
    _is_video = _proj is not None and _proj.project_type == _PT.VIDEO
    _existing_track_ids = set(
        session.exec(
            select(_Track.id).where(_Track.project_id == frame.project_id)
        ).all()
    )
    _remap_track: dict = {}

    def _resolve_track_id(raw, class_id, is_auto):
        if raw is None or raw in _existing_track_ids:
            return raw
        if raw in _remap_track:
            return _remap_track[raw]
        if _is_video and not is_auto:
            from backend.models.routers.tracking import _next_track_uid
            from backend.utils.color_utils import get_track_color
            _seq = getattr(frame, "sequence_id", None)
            uid = _next_track_uid(frame.project_id, session, _seq)
            nt = _Track(
                project_id=frame.project_id, sequence_id=_seq, track_uid=uid, class_id=class_id,
                color=get_track_color(uid),
                start_frame=frame.frame_index, end_frame=frame.frame_index,
            )
            session.add(nt)
            session.flush()
            _existing_track_ids.add(nt.id)
            _remap_track[raw] = nt.id
            return nt.id
        return None  # piste absente + non recréable → détacher

    created_count = 0
    for ann_data in data.annotations:
        from backend.utils.yolo_utils import validate_yolo_coordinates
        valid, _ = validate_yolo_coordinates(
            ann_data.cx, ann_data.cy, ann_data.width, ann_data.height
        )
        if not valid:
            continue  # Ignore les coordonnées invalides

        # Validation de la class_id
        if not ann_data.class_id or not session.get(_LabelClass, ann_data.class_id):
            continue  # Ignore les annotations avec classe invalide

        _resolved_track = _resolve_track_id(ann_data.track_id, ann_data.class_id, ann_data.is_auto)
        ann = Annotation(
            frame_id=frame_id,
            class_id=ann_data.class_id,
            annotation_type=ann_data.annotation_type,
            cx=ann_data.cx,
            cy=ann_data.cy,
            width=ann_data.width,
            height=ann_data.height,
            track_id=_resolved_track,
            confidence=ann_data.confidence,
            is_auto=ann_data.is_auto,
            is_interpolated=ann_data.is_interpolated,
            source_algorithm=ann_data.source_algorithm,
        )
        if ann_data.points:
            ann.set_points([(p[0], p[1]) for p in ann_data.points])
        session.add(ann)
        created_count += 1

    # Mise à jour du statut de la frame
    frame.is_annotated = created_count > 0
    session.add(frame)

    # Undo/bulk-replace : si une piste n'a plus AUCUNE annotation (dernière box
    # retirée), on la supprime + renumérote les uids (step 3).
    if removed_track_ids:
        session.flush()
        _prune_empty_tracks(removed_track_ids, session)

    session.commit()

    return {
        "success": True,
        "created": created_count,
        "replaced": data.replace,
    }


@router.delete("/api/frames/{frame_id}/annotations/all", response_model=dict)
def delete_all_frame_annotations(
    frame_id: int,
    session: Session = Depends(get_session),
):
    """Supprime toutes les annotations d'une frame."""
    frame = session.get(Frame, frame_id)
    if not frame:
        raise HTTPException(status_code=404, detail="Frame introuvable")

    annotations = session.exec(
        select(Annotation).where(Annotation.frame_id == frame_id)
    ).all()
    deleted_count = len(annotations)

    from backend.services.monitoring_service import record_bulk_delete
    record_bulk_delete(
        [(a.id, a.source_algorithm, a.frame_id) for a in annotations],
        origin="frame_clear",
    )
    for ann in annotations:
        session.delete(ann)

    frame.is_annotated = False
    session.add(frame)

    _update_frame_annotation_status(frame, session)
    session.commit()

    return {"success": True, "deleted_count": deleted_count}


class DeleteFramesAnnotationsRequest(BaseModel):
    """Suppression en masse des annotations de plusieurs frames."""
    frame_ids: List[int]


@router.post("/api/projects/{project_id}/annotations/delete-frames", response_model=dict)
def delete_annotations_for_frames(
    project_id: int,
    data: DeleteFramesAnnotationsRequest,
    session: Session = Depends(get_session),
):
    """
    Supprime toutes les annotations de PLUSIEURS frames en UNE transaction.

    Remplace N appels `DELETE /frames/{id}/annotations/all` (chacun recomptait
    annotated_count sur tout le projet + un commit fsync → ~0,5 s/frame, 100
    frames = ~50 s). Ici : un seul DELETE en masse, un seul recompte, un commit.
    """
    if not data.frame_ids:
        return {"success": True, "deleted_count": 0, "frames": 0}

    from sqlalchemy import delete as _sql_delete, update as _sql_update

    # Capture des annotations AVANT suppression → historique undo (Ctrl+Z timeline).
    rows = session.exec(
        select(Annotation).where(Annotation.frame_id.in_(data.frame_ids))
    ).all()
    deleted_count = len(rows)
    if rows:
        _push_bulk_undo(project_id, {
            "frames": list(data.frame_ids),
            "annotations": [_ann_snapshot(a) for a in rows],
        })
        from backend.services.monitoring_service import record_bulk_delete
        record_bulk_delete(
            [(a.id, a.source_algorithm, a.frame_id) for a in rows],
            origin="timeline_frames_delete",
        )
    session.exec(
        _sql_delete(Annotation).where(Annotation.frame_id.in_(data.frame_ids))
    )

    # Marquer les frames non annotées (une requête UPDATE)
    session.exec(
        _sql_update(Frame)
        .where(Frame.id.in_(data.frame_ids))
        .values(is_annotated=False)
    )

    # Recompte global du projet UNE seule fois
    project = session.get(Project, project_id)
    if project:
        project.annotated_count = int(session.exec(
            select(func.count(Frame.id))
            .where(Frame.project_id == project_id)
            .where(Frame.is_annotated == True)  # noqa: E712
        ).one() or 0)
        session.add(project)

    session.commit()
    return {"success": True, "deleted_count": int(deleted_count or 0), "frames": len(data.frame_ids)}


# ============================================================
# Undo / Redo des suppressions GROUPÉES d'annotations (timeline du bas).
# Historique en mémoire, par projet (LIFO borné). Ne couvre que la suppression
# groupée d'annotations — pas les tracks (voir choix de cadrage). "Dernière
# action gagne" est arbitré côté frontend (annotationStore per-frame vs ici).
# ============================================================

_BULK_MAX = 30
_bulk_undo: dict[int, list] = {}   # project_id -> [op, ...]  (op le plus récent en fin)
_bulk_redo: dict[int, list] = {}


def _ann_snapshot(a: "Annotation") -> dict:
    """Sérialise une annotation pour re-création à l'identique (in-memory)."""
    return {
        "frame_id": a.frame_id, "class_id": a.class_id,
        "annotation_type": a.annotation_type,
        "cx": a.cx, "cy": a.cy, "width": a.width, "height": a.height,
        "points": a.points, "confidence": a.confidence,
        "is_auto": a.is_auto,
        "is_interpolated": getattr(a, "is_interpolated", False),
        "source_algorithm": getattr(a, "source_algorithm", None),
        "track_id": a.track_id,
    }


def _push_bulk_undo(project_id: int, op: dict) -> None:
    hist = _bulk_undo.setdefault(project_id, [])
    hist.append(op)
    if len(hist) > _BULK_MAX:
        del hist[0]
    _bulk_redo.pop(project_id, None)  # une nouvelle suppression invalide le redo


def _recompute_frames_and_project(session: Session, project_id: int, frame_ids) -> None:
    """Recale is_annotated sur les frames touchées + le compteur projet UNE fois."""
    for fid in frame_ids:
        fr = session.get(Frame, fid)
        if fr:
            cnt = session.exec(
                select(func.count(Annotation.id)).where(Annotation.frame_id == fid)
            ).one()
            fr.is_annotated = (cnt or 0) > 0
            session.add(fr)
    project = session.get(Project, project_id)
    if project:
        project.annotated_count = int(session.exec(
            select(func.count(Frame.id))
            .where(Frame.project_id == project_id)
            .where(Frame.is_annotated == True)  # noqa: E712
        ).one() or 0)
        session.add(project)


@router.post("/api/projects/{project_id}/annotations/undo-bulk-delete", response_model=dict)
def undo_bulk_delete(project_id: int, session: Session = Depends(get_session)):
    """Annule la dernière suppression groupée : re-crée les annotations effacées."""
    hist = _bulk_undo.get(project_id) or []
    if not hist:
        return {"success": False, "restored": 0, "can_undo_more": False, "can_redo_more": bool(_bulk_redo.get(project_id))}
    op = hist.pop()
    created_ids: list[int] = []
    for snap in op["annotations"]:
        a = Annotation(**snap)
        session.add(a)
        session.flush()
        created_ids.append(a.id)
    _recompute_frames_and_project(session, project_id, op["frames"])
    session.commit()
    # Redo = re-supprimer précisément les annotations qu'on vient de re-créer.
    _bulk_redo.setdefault(project_id, []).append({
        "frames": op["frames"], "annotation_ids": created_ids, "annotations": op["annotations"],
    })
    return {"success": True, "restored": len(created_ids), "frames": op["frames"],
            "can_undo_more": bool(_bulk_undo.get(project_id)), "can_redo_more": True}


@router.post("/api/projects/{project_id}/annotations/redo-bulk-delete", response_model=dict)
def redo_bulk_delete(project_id: int, session: Session = Depends(get_session)):
    """Refait la suppression annulée : re-supprime les annotations restaurées."""
    from sqlalchemy import delete as _sql_delete
    redo = _bulk_redo.get(project_id) or []
    if not redo:
        return {"success": False, "can_undo_more": bool(_bulk_undo.get(project_id)), "can_redo_more": False}
    op = redo.pop()
    ids = op.get("annotation_ids") or []
    if ids:
        session.exec(_sql_delete(Annotation).where(Annotation.id.in_(ids)))
    _recompute_frames_and_project(session, project_id, op["frames"])
    session.commit()
    # Undo redevient possible (re-supprimé → on peut re-restaurer les mêmes données).
    _bulk_undo.setdefault(project_id, []).append({
        "frames": op["frames"], "annotations": op["annotations"],
    })
    return {"success": True, "frames": op["frames"],
            "can_undo_more": True, "can_redo_more": bool(_bulk_redo.get(project_id))}


@router.post("/api/frames/{frame_id}/copy-to", response_model=dict)
def copy_annotations_to_frames(
    frame_id: int,
    data: CopyToFramesRequest,
    session: Session = Depends(get_session),
):
    """
    Copie toutes les annotations d'une frame vers une ou plusieurs frames cibles.
    Utile pour propager manuellement des annotations vers la frame suivante.
    """
    # Récupération des annotations source
    source_annotations = session.exec(
        select(Annotation).where(Annotation.frame_id == frame_id)
    ).all()

    if not source_annotations:
        return {"success": True, "copied_count": 0, "target_frames": len(data.target_frame_ids)}

    total_copied = 0

    for target_id in data.target_frame_ids:
        target_frame = session.get(Frame, target_id)
        if not target_frame:
            continue

        # Suppression des annotations existantes si demandé
        if data.overwrite:
            existing = session.exec(
                select(Annotation).where(Annotation.frame_id == target_id)
            ).all()
            for ann in existing:
                session.delete(ann)
            session.flush()

        # Copie des annotations
        for src_ann in source_annotations:
            new_ann = Annotation(
                frame_id=target_id,
                class_id=src_ann.class_id,
                annotation_type=src_ann.annotation_type,
                cx=src_ann.cx,
                cy=src_ann.cy,
                width=src_ann.width,
                height=src_ann.height,
                points=src_ann.points,
                track_id=src_ann.track_id,
                confidence=src_ann.confidence,
                is_auto=True,
                is_interpolated=True,
            )
            session.add(new_ann)
            total_copied += 1

        target_frame.is_annotated = True
        session.add(target_frame)

    session.commit()

    return {
        "success": True,
        "copied_count": total_copied,
        "target_frames": len(data.target_frame_ids),
    }


@router.get("/api/frames/{frame_id}/overlaps", response_model=List[dict])
def detect_overlaps(
    frame_id: int,
    iou_threshold: float = 0.85,
    session: Session = Depends(get_session),
):
    """
    Détecte les annotations en doublon sur une frame (IoU > seuil).
    Utile pour identifier les objets annotés deux fois par erreur.

    Returns:
        Liste de paires {ann_id_1, ann_id_2, iou, class_1, class_2}
    """
    annotations = session.exec(
        select(Annotation).where(Annotation.frame_id == frame_id)
    ).all()

    if len(annotations) < 2:
        return []

    from backend.utils.yolo_utils import compute_iou
    overlaps = []

    for i in range(len(annotations)):
        for j in range(i + 1, len(annotations)):
            ann_a = annotations[i]
            ann_b = annotations[j]

            iou = compute_iou(
                (ann_a.cx, ann_a.cy, ann_a.width, ann_a.height),
                (ann_b.cx, ann_b.cy, ann_b.width, ann_b.height),
            )

            if iou >= iou_threshold:
                overlaps.append({
                    "ann_id_1": ann_a.id,
                    "ann_id_2": ann_b.id,
                    "iou": round(iou, 4),
                    "class_id_1": ann_a.class_id,
                    "class_id_2": ann_b.class_id,
                    "same_class": ann_a.class_id == ann_b.class_id,
                })

    return overlaps


@router.post("/api/projects/{project_id}/interpolate", response_model=dict)
def interpolate_annotations(
    project_id: int,
    data: InterpolateRequest,
    session: Session = Depends(get_session),
):
    """
    Génère des annotations interpolées entre deux frames annotées manuellement.
    Utile pour combler les lacunes de tracking sur de courtes séquences.

    Args:
        start_frame_id: Frame de départ (doit avoir des annotations)
        end_frame_id: Frame de fin (doit avoir des annotations)
        track_id: Optionnel, pour interpoler une piste spécifique uniquement
    """
    from backend.services.interpolation_service import interpolation_service

    # Récupération des annotations des deux keyframes
    start_anns = session.exec(
        select(Annotation).where(Annotation.frame_id == data.start_frame_id)
    ).all()
    end_anns = session.exec(
        select(Annotation).where(Annotation.frame_id == data.end_frame_id)
    ).all()

    if not start_anns or not end_anns:
        raise HTTPException(
            status_code=400,
            detail="Les deux frames doivent avoir des annotations pour interpoler"
        )

    # Récupération des frames
    start_frame = session.get(Frame, data.start_frame_id)
    end_frame = session.get(Frame, data.end_frame_id)

    if not start_frame or not end_frame or start_frame.project_id != project_id:
        raise HTTPException(status_code=404, detail="Frames introuvables")

    start_idx = start_frame.frame_index
    end_idx = end_frame.frame_index

    if start_idx >= end_idx:
        raise HTTPException(status_code=400, detail="start_frame doit être avant end_frame")

    # Récupération des frames intermédiaires
    intermediate_frames = session.exec(
        select(Frame)
        .where(Frame.project_id == project_id)
        .where(Frame.frame_index > start_idx)
        .where(Frame.frame_index < end_idx)
        .order_by(Frame.frame_index)
    ).all()

    if not intermediate_frames:
        return {"success": True, "interpolated_count": 0, "message": "Aucune frame intermédiaire"}

    total_created = 0

    # Pour chaque paire d'annotations (même classe entre start et end)
    for start_ann in start_anns:
        if data.track_id and start_ann.track_id != data.track_id:
            continue

        # Trouver l'annotation correspondante dans la frame de fin (même classe)
        matching_end = next(
            (a for a in end_anns if a.class_id == start_ann.class_id),
            None
        )
        if not matching_end:
            continue

        ann_start_dict = {
            "class_id": start_ann.class_id,
            "cx": start_ann.cx,
            "cy": start_ann.cy,
            "width": start_ann.width,
            "height": start_ann.height,
            "points": start_ann.points,
            "track_id": start_ann.track_id,
            "annotation_type": start_ann.annotation_type,
        }
        ann_end_dict = {
            "class_id": matching_end.class_id,
            "cx": matching_end.cx,
            "cy": matching_end.cy,
            "width": matching_end.width,
            "height": matching_end.height,
            "points": matching_end.points,
            "track_id": matching_end.track_id,
            "annotation_type": matching_end.annotation_type,
        }

        # Interpolation pour chaque frame intermédiaire
        n_frames = end_idx - start_idx
        for frame in intermediate_frames:
            t = (frame.frame_index - start_idx) / n_frames

            interp = interpolation_service.interpolate_bbox(ann_start_dict, ann_end_dict, t)

            new_ann = Annotation(
                frame_id=frame.id,
                class_id=interp["class_id"],
                annotation_type=ann_start_dict["annotation_type"],
                cx=interp["cx"],
                cy=interp["cy"],
                width=interp["width"],
                height=interp["height"],
                track_id=interp.get("track_id"),
                confidence=interp["confidence"],
                is_auto=True,
                is_interpolated=True,
            )
            session.add(new_ann)

            frame.is_annotated = True
            session.add(frame)
            total_created += 1

    session.commit()

    return {
        "success": True,
        "interpolated_count": total_created,
        "frames_filled": len(intermediate_frames),
    }


@router.get("/api/projects/{project_id}/annotations/validate", response_model=dict)
def validate_annotations(
    project_id: int,
    session: Session = Depends(get_session),
):
    """
    Valide toutes les annotations du projet avant export.
    Vérifie que les coordonnées sont dans [0, 1] et détecte les incohérences.

    Returns:
        Rapport de validation avec les erreurs trouvées
    """
    from backend.utils.yolo_utils import validate_yolo_coordinates

    # Récupération de toutes les annotations du projet
    all_annotations = session.exec(
        select(Annotation)
        .join(Frame, Annotation.frame_id == Frame.id)
        .where(Frame.project_id == project_id)
    ).all()

    errors = []
    warnings = []

    for ann in all_annotations:
        valid, msg = validate_yolo_coordinates(ann.cx, ann.cy, ann.width, ann.height)
        if not valid:
            errors.append({
                "annotation_id": ann.id,
                "frame_id": ann.frame_id,
                "message": msg,
                "type": "out_of_bounds",
            })

        if ann.width < 0.001 or ann.height < 0.001:
            warnings.append({
                "annotation_id": ann.id,
                "frame_id": ann.frame_id,
                "message": "Annotation très petite (w ou h < 0.001)",
                "type": "too_small",
            })

    return {
        "valid": len(errors) == 0,
        "total_annotations": len(all_annotations),
        "error_count": len(errors),
        "warning_count": len(warnings),
        "errors": errors,
        "warnings": warnings,
    }


class NMSRequest(BaseModel):
    """Paramètres pour la suppression des doublons par NMS."""
    iou_threshold: float = 0.5  # Seuil IoU au-dessus duquel deux boîtes sont considérées en doublon
    same_class_only: bool = False  # Si True, NMS uniquement entre annotations de même classe


@router.post("/api/frames/{frame_id}/annotations/nms", response_model=dict)
def apply_nms(
    frame_id: int,
    data: NMSRequest,
    session: Session = Depends(get_session),
):
    """
    Applique le Non-Maximum Suppression (NMS) sur les annotations d'une frame.
    Supprime les annotations redondantes qui se chevauchent trop.
    Conserve l'annotation avec la meilleure confiance dans chaque groupe.

    Algorithme :
      1. Trier les annotations par confiance décroissante
      2. Pour chaque annotation, calculer l'IoU avec les suivantes
      3. Supprimer celles dont l'IoU > seuil (garder la meilleure)
    """
    from backend.utils.yolo_utils import compute_iou

    frame = session.get(Frame, frame_id)
    if not frame:
        raise HTTPException(status_code=404, detail="Frame introuvable")

    annotations = session.exec(
        select(Annotation).where(Annotation.frame_id == frame_id)
    ).all()

    if len(annotations) < 2:
        return {"success": True, "deleted_count": 0, "remaining_count": len(annotations)}

    # Trier par confiance décroissante (meilleures d'abord)
    sorted_anns = sorted(annotations, key=lambda a: a.confidence, reverse=True)

    kept_ids: set[int] = set()
    deleted_ids: set[int] = set()

    for i, ann_i in enumerate(sorted_anns):
        if ann_i.id in deleted_ids:
            continue
        kept_ids.add(ann_i.id)

        for j in range(i + 1, len(sorted_anns)):
            ann_j = sorted_anns[j]
            if ann_j.id in deleted_ids:
                continue

            # Filtrage par classe si demandé
            if data.same_class_only and ann_i.class_id != ann_j.class_id:
                continue

            iou = compute_iou(
                (ann_i.cx, ann_i.cy, ann_i.width, ann_i.height),
                (ann_j.cx, ann_j.cy, ann_j.width, ann_j.height),
            )

            if iou > data.iou_threshold:
                deleted_ids.add(ann_j.id)

    # Suppression des annotations filtrées par NMS
    deleted_count = 0
    for ann in annotations:
        if ann.id in deleted_ids:
            session.delete(ann)
            deleted_count += 1

    if deleted_count > 0:
        _update_frame_annotation_status(frame, session)

    session.commit()

    return {
        "success": True,
        "deleted_count": deleted_count,
        "remaining_count": len(annotations) - deleted_count,
        "iou_threshold": data.iou_threshold,
    }


# ---- Resume global des annotations multi-frames ----

@router.get("/api/projects/{project_id}/annotations/summary", response_model=List[dict])
def get_annotations_summary(
    project_id: int,
    min_confidence: float = 0.0,
    source_filter: Optional[str] = None,   # ex: "grounding_dino", "sam3", "manual"
    session: Session = Depends(get_session),
):
    """
    Retourne toutes les annotations du projet avec leur contexte de frame.
    Utilise pour le panneau de resume global multi-frames.

    Parametres :
        min_confidence: Seuil minimum de confiance (0.0 = tout inclure)
        source_filter: Filtrer par algorithme source
    """
    from backend.models.label_class import LabelClass

    # Toutes les annotations du projet avec JOIN frame
    all_annotations = session.exec(
        select(Annotation, Frame)
        .join(Frame, Annotation.frame_id == Frame.id)
        .where(Frame.project_id == project_id)
        .where(Annotation.confidence >= min_confidence)
        .order_by(Frame.frame_index, Annotation.id)
    ).all()

    # Classes du projet pour les noms
    classes = session.exec(
        select(LabelClass).where(LabelClass.project_id == project_id)
    ).all()
    class_map = {c.id: c.name for c in classes}

    results = []
    for ann, frame in all_annotations:
        src = getattr(ann, 'source_algorithm', None)
        # Filtrage par source si demande
        if source_filter and src != source_filter:
            continue
        results.append({
            "annotation_id": ann.id,
            "frame_id": frame.id,
            "frame_index": frame.frame_index,
            "class_id": ann.class_id,
            "class_name": class_map.get(ann.class_id, f"classe_{ann.class_id}"),
            "annotation_type": ann.annotation_type,
            "confidence": ann.confidence,
            "is_auto": ann.is_auto,
            "is_interpolated": ann.is_interpolated,
            "source_algorithm": src,
            "cx": ann.cx,
            "cy": ann.cy,
            "width": ann.width,
            "height": ann.height,
        })

    return results


# ---- Suppression en batch par IDs ----

class BatchDeleteRequest(BaseModel):
    """Requete de suppression batch d'annotations par IDs."""
    annotation_ids: List[int]


@router.delete("/api/projects/{project_id}/annotations/batch", response_model=dict)
def batch_delete_annotations(
    project_id: int,
    data: BatchDeleteRequest,
    session: Session = Depends(get_session),
):
    """
    Supprime plusieurs annotations en une seule requete.
    Verifie que chaque annotation appartient bien au projet.
    Met a jour les statuts de frames et compteurs du projet.
    """
    if not data.annotation_ids:
        return {"success": True, "deleted_count": 0}

    # Recuperer les annotations avec verification d'appartenance
    annotations = session.exec(
        select(Annotation, Frame)
        .join(Frame, Annotation.frame_id == Frame.id)
        .where(Frame.project_id == project_id)
        .where(Annotation.id.in_(data.annotation_ids))
    ).all()

    affected_frame_ids: set[int] = set()
    deleted_count = 0

    for ann, frame in annotations:
        affected_frame_ids.add(frame.id)
        session.delete(ann)
        deleted_count += 1

    session.flush()

    # Mise a jour des statuts de toutes les frames affectees
    for frame_id in affected_frame_ids:
        frame = session.get(Frame, frame_id)
        if frame:
            _update_frame_annotation_status(frame, session)

    session.commit()
    return {"success": True, "deleted_count": deleted_count}


# ---- Suppression depuis une frame en avant (nettoyage apres echec IA) ----

@router.delete("/api/projects/{project_id}/annotations/from-frame", response_model=dict)
def delete_annotations_from_frame(
    project_id: int,
    from_frame_index: int,
    source_filter: Optional[str] = None,  # None = tout supprimer, ex: "grounding_dino" = IA seul
    session: Session = Depends(get_session),
):
    """
    Supprime toutes les annotations a partir de la frame N (incluse).
    Utile pour repartir proprement apres un echec de tracking ou de propagation.

    Parametres :
        from_frame_index: Index de la premiere frame a nettoyer (incluse)
        source_filter: Si specifie, supprime uniquement les annotations de cette source
    """
    # Frames a partir de l'index donne
    frames_to_clean = session.exec(
        select(Frame)
        .where(Frame.project_id == project_id)
        .where(Frame.frame_index >= from_frame_index)
    ).all()

    if not frames_to_clean:
        return {"success": True, "deleted_count": 0, "frames_cleaned": 0}

    frame_ids = [f.id for f in frames_to_clean]
    deleted_count = 0

    # Recuperation des annotations a supprimer
    query = select(Annotation).where(Annotation.frame_id.in_(frame_ids))
    if source_filter:
        query = query.where(Annotation.source_algorithm == source_filter)

    annotations_to_delete = session.exec(query).all()
    deleted_count = len(annotations_to_delete)

    for ann in annotations_to_delete:
        session.delete(ann)
    session.flush()

    # Mise a jour des statuts
    for frame in frames_to_clean:
        _update_frame_annotation_status(frame, session)

    session.commit()

    return {
        "success": True,
        "deleted_count": deleted_count,
        "frames_cleaned": len(frames_to_clean),
        "from_frame_index": from_frame_index,
    }
