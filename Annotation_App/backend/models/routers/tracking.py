# ============================================================
# routers/tracking.py
# Endpoints pour la gestion des pistes de tracking multi-objets.
# Gère le CRUD des pistes, l'exécution de ByteTrack,
# la propagation homographique, et la fusion de pistes.
# ============================================================

import os
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
from sqlmodel import Session, select

from backend.database import get_session
from backend.models.annotation import Annotation, AnnotationType
from backend.models.frame import Frame
from backend.models.label_class import LabelClass
from backend.models.project import Project
from backend.models.track import Track
from backend.services.format_registry import supports_filename

router = APIRouter(tags=["Tracking"])


# ---- Schémas Pydantic ----

class TrackCreate(BaseModel):
    class_id: int
    color: Optional[str] = None
    start_frame: int = 0


class TrackUpdate(BaseModel):
    class_id: Optional[int] = None
    color: Optional[str] = None
    is_active: Optional[bool] = None


class ByteTrackRunRequest(BaseModel):
    """Paramètres pour lancer ByteTrack sur une plage de frames."""
    start_frame_index: int = 0
    end_frame_index: Optional[int] = None  # None = toutes les frames
    track_thresh: float = 0.5
    track_buffer: int = 30
    match_thresh: float = 0.8
    class_ids: Optional[List[int]] = None  # None = toutes les classes


class HomographyPropagateRequest(BaseModel):
    """Paramètres pour la propagation homographique depuis une keyframe."""
    keyframe_id: int                  # Frame source (annotée)
    end_frame_id: int                 # Frame de fin de propagation
    annotation_ids: List[int]         # Annotations à propager
    # Filtres qualité homographie
    min_inlier_count: int = 30        # Nombre absolu minimum d'inliers RANSAC
    min_inlier_ratio: float = 0.5     # Ratio minimum d'inliers (0-1)
    ransac_threshold: float = 3.0     # Erreur reprojection RANSAC en pixels
    # Paramètres XFeat GPU (ignorés en mode SIFT)
    xfeat_top_k: int = 4096          # Nb de keypoints détectés par image
    xfeat_min_cossim: float = 0.82   # Seuil similarité cosinus pour le matching
    use_optical_flow: bool = True     # True = LK optflow (suit l'objet), False = homographie pure
    # Paramètres Flux Optique Lucas-Kanade (ignorés si use_optical_flow=False)
    optflow_win_size: int = 21        # Taille fenêtre LK en pixels
    optflow_max_level: int = 3        # Niveaux de pyramide LK
    optflow_min_pts: int = 4          # Min points suivis pour valider


class MergeTracksRequest(BaseModel):
    """Fusionner deux pistes (même objet, IDs différents après réidentification)."""
    track_id_keep: int    # ID de la piste à conserver
    track_id_merge: int   # ID de la piste à absorber


class GuidedTrackingRequest(BaseModel):
    """Parametres pour le Tracking Guide (GD/SAM3 + matching par centroide)."""
    reference_frame_id: int            # Frame de reference contenant les cibles
    annotation_ids: List[int]          # IDs des annotations-cibles sur la frame de reference
    start_frame_index: int             # Premiere frame a traiter (incluse)
    end_frame_index: int               # Derniere frame a traiter (incluse)
    algorithm: str = "grounding_dino"  # "grounding_dino" | "sam3"
    text_prompt: str = ""              # Prompt texte (obligatoire pour GD/SAM3)
    box_threshold: float = 0.20        # Seuil de confiance bas (maximise le rappel)
    text_threshold: float = 0.15       # Seuil texte pour Grounding DINO
    max_centroid_distance: float = 0.15  # Distance max normalisee pour le matching
    size_variation_threshold: float = 0.5  # Variation de surface max (0.5 = 50%)
    sam3_output_mode: str = "bbox"     # SAM3 uniquement : "bbox" | "segmentation"
    ref_array_index: int = -1          # Position tableau de la frame de reference (-1 = non fourni)
    end_array_index: int = -1          # Position tableau de la frame de fin (-1 = non fourni)
    # Auto-stop : arrêt automatique si trop de cibles perdues
    auto_stop_lost_ratio: float = 0.0  # 0.0 = désactivé ; 0.5 = stop si > 50% perdus
    auto_stop_consecutive_frames: int = 5  # frames consécutives avec trop de pertes avant arrêt


# ---- Helpers ----

def _to_unc(path_str: str) -> Optional[str]:
    r"""Chemin natif joignable par le client, ou None si aucun partage ne le couvre.

    Enveloppe to_native_share_path() : un lancement LOCAL renvoie le chemin Windows tel
    quel, un lancement sur VM renvoie l'UNC \hote\partage\... Retourner None
    n'est pas une erreur, c'est le signal "passe par HTTP comme avant".
    """
    try:
        from backend.utils.native_share import to_native_share_path
        return to_native_share_path(str(path_str))
    except Exception:
        return None


def _next_track_uid(project_id: int, session: Session, sequence_id: Optional[int] = None) -> int:
    """Prochain track_uid = max existant + 1, PAR SÉQUENCE (décorrélation S2b/c) :
    dessiner la 1re piste de la séquence 2 redonne uid 0, pas la suite de la séquence 1.
    `sequence_id=None` → espace des frames legacy (pseudo-séquence principale)."""
    from sqlmodel import func as _func
    q = select(_func.max(Track.track_uid)).where(Track.project_id == project_id)
    if sequence_id is None:
        q = q.where(Track.sequence_id.is_(None))
    else:
        q = q.where(Track.sequence_id == sequence_id)
    max_uid = session.exec(q).one()
    return int(max_uid) + 1 if max_uid is not None else 0


def _free_track_uid_for_frame(project_id: int, frame, session: Session,
                              sequence_id: Optional[int] = None) -> int:
    """Plus petit track_uid libre SUR CETTE FRAME (0, 1, 2... sans trou).

    L'increment suit ce que l'annotateur voit a l'ecran : une frame sans boite
    redonne 0, une frame ou 0 et 1 existent deja donne 2. Volontairement
    decorrele du nombre de pistes de la sequence (`_next_track_uid`), qui reste
    la regle pour les pistes creees par le tracking automatique.
    """
    from backend.models.annotation import Annotation
    used = set(session.exec(
        select(Track.track_uid)
        .join(Annotation, Annotation.track_id == Track.id)
        .where(Annotation.frame_id == frame.id)
    ).all())
    uid = 0
    while uid in used:
        uid += 1
    return uid


def _frame_sequence_id(frame, session) -> Optional[int]:
    """sequence_id d'une frame (None pour les frames legacy)."""
    return getattr(frame, "sequence_id", None)


def _compact_track_uids(project_id: int, removed_uid: int, session: Session,
                        sequence_id: Optional[int] = None) -> None:
    """Renumérotation contiguë APRÈS suppression, DANS la même séquence."""
    q = (
        select(Track)
        .where(Track.project_id == project_id)
        .where(Track.track_uid > removed_uid)
    )
    if sequence_id is None:
        q = q.where(Track.sequence_id.is_(None))
    else:
        q = q.where(Track.sequence_id == sequence_id)
    for t in session.exec(q.order_by(Track.track_uid)).all():
        t.track_uid = t.track_uid - 1
        session.add(t)


class AssignTrackRequest(BaseModel):
    """Assigner/créer/détacher la track d'une annotation (MOT)."""
    action: str = "new"            # "new" | "assign" | "detach"
    track_id: Optional[int] = None  # requis pour action="assign"


def _track_to_dict(t: Track) -> dict:
    return {
        "id": t.id,
        "project_id": t.project_id,
        "sequence_id": t.sequence_id,
        "track_uid": t.track_uid,
        "class_id": t.class_id,
        "color": t.color,
        "start_frame": t.start_frame,
        "end_frame": t.end_frame,
        "is_active": t.is_active,
        "interpolated_frames": t.interpolated_frames,
    }


def _resolve_frame_image_path(project_id: int, frame: Frame, db: Session) -> Optional[Path]:
    """Retourne un fichier image existant pour une frame, y compris source optional_format externe.
    Multi-séquence : la source optional_format est résolue via la séquence de la frame,
    avec repli sur project.source_path (anciens projets)."""
    from backend.services.dataset_service import dataset_service

    image_path = dataset_service.get_frame_path(project_id, frame.filename)
    if image_path.exists():
        return image_path

    candidates = []
    if getattr(frame, "sequence_id", None):
        from backend.models.sequence import Sequence
        seq = db.get(Sequence, frame.sequence_id)
        if seq and seq.source_path:
            candidates.append(Path(seq.source_path))
    project = db.get(Project, project_id)
    if project and project.source_path:
        candidates.append(Path(project.source_path))

    for source in candidates:
        if supports_filename(str(source)):
            png_path = source.parent / f"{source.stem}_png" / frame.filename
            if png_path.exists():
                return png_path

    return None


def _frame_display_lut(frame: Frame, db: Session) -> Optional[dict]:
    """LUT d'affichage effective d'une frame : séquence d'abord (sequence.lut_json),
    repli sur le projet (project.lut_json). None = 3-sigma par défaut.
    Permet que l'IA (GD/SAM3/YOLO) voie la MÊME image que l'utilisateur."""
    import json as _json

    def _parse(raw):
        if not raw:
            return None
        try:
            d = _json.loads(raw)
            return d if isinstance(d, dict) else None
        except Exception:
            return None

    if getattr(frame, "sequence_id", None):
        from backend.models.sequence import Sequence
        seq = db.get(Sequence, frame.sequence_id)
        lut = _parse(getattr(seq, "lut_json", None)) if seq else None
        if lut is not None:
            return lut
    proj = db.get(Project, frame.project_id)
    return _parse(getattr(proj, "lut_json", None)) if proj else None


def _ai_input_path(img_path: str, project_id: int, lut: Optional[dict]) -> str:
    """Chemin image à donner aux détecteurs IA : si une LUT non-défaut est active
    (ou image 16 bits), on bake la LUT dans un JPEG 8 bits mis en cache, sinon on
    renvoie le chemin source tel quel. Garantit GD/SAM3/YOLO ↔ affichage cohérents."""
    from backend.utils.image_utils import ensure_8bit_cached
    from backend.services.dataset_service import dataset_service
    try:
        cache_dir = dataset_service.get_project_dir(project_id) / "frames_ai_lut"
        baked = ensure_8bit_cached(img_path, str(cache_dir), lut)
        return baked or img_path
    except Exception:
        return img_path


# ---- Endpoints CRUD Tracks ----

def _track_segments(project_id: int, session: Session) -> dict:
    """
    Segments RÉELS de chaque track = plages de frames contiguës où une annotation
    du track existe VRAIMENT (l'objet a été trouvé). Un track peut donc apparaître
    en plusieurs blocs séparés (ex : vu 500-600 puis 800-1000). Les trous DANS la
    plage explorée [start_frame, end_frame] du track = "passé dessus, rien vu".

    Retourne {track_id: [[s, e], ...]} (bornes incluses, triées).
    """
    from sqlalchemy import func as _func
    rows = session.exec(
        select(Annotation.track_id, Frame.frame_index)
        .join(Frame, Frame.id == Annotation.frame_id)
        .where(Frame.project_id == project_id)
        .where(Annotation.track_id != None)  # noqa: E711
    ).all()
    by_track: dict[int, set] = {}
    for tid, fidx in rows:
        by_track.setdefault(tid, set()).add(fidx)

    segments: dict[int, list] = {}
    for tid, idx_set in by_track.items():
        indices = sorted(idx_set)
        segs: list = []
        run_start = prev = indices[0]
        for i in indices[1:]:
            if i == prev + 1:
                prev = i
                continue
            segs.append([run_start, prev])
            run_start = prev = i
        segs.append([run_start, prev])
        segments[tid] = segs
    return segments


@router.get("/api/projects/{project_id}/tracks", response_model=List[dict])
def list_tracks(
    project_id: int,
    active_only: bool = True,
    session: Session = Depends(get_session),
):
    """Liste toutes les pistes de tracking d'un projet (avec segments réels)."""
    query = select(Track).where(Track.project_id == project_id)
    if active_only:
        query = query.where(Track.is_active == True)
    tracks = session.exec(query.order_by(Track.track_uid)).all()
    segments = _track_segments(project_id, session)
    result = []
    for t in tracks:
        d = _track_to_dict(t)
        d["segments"] = segments.get(t.id, [])
        result.append(d)
    return result


@router.post("/api/projects/{project_id}/tracks", response_model=dict, status_code=201)
def create_track(
    project_id: int,
    data: TrackCreate,
    session: Session = Depends(get_session),
):
    """Crée une nouvelle piste manuellement."""
    from backend.utils.color_utils import get_track_color

    next_uid = _next_track_uid(project_id, session)
    color = data.color or get_track_color(next_uid)

    track = Track(
        project_id=project_id,
        track_uid=next_uid,
        class_id=data.class_id,
        color=color,
        start_frame=data.start_frame,
        end_frame=data.start_frame,
    )
    session.add(track)
    session.commit()
    session.refresh(track)

    return _track_to_dict(track)


@router.post("/api/annotations/{annotation_id}/track", response_model=dict)
def assign_annotation_track(
    annotation_id: int,
    data: AssignTrackRequest,
    session: Session = Depends(get_session),
):
    """
    Assigne une track à une annotation (suivi objet / MOT) :
      - action="new"    : crée une nouvelle track (uid incrémental, couleur, classe
                          de l'annotation) et l'assigne ;
      - action="assign" : assigne une track existante (track_id) ;
      - action="detach" : détache (track_id = None).
    Met à jour la plage [start_frame, end_frame] de la track pour inclure la frame.
    """
    from backend.utils.color_utils import get_track_color

    ann = session.get(Annotation, annotation_id)
    if not ann:
        raise HTTPException(status_code=404, detail="Annotation introuvable")
    frame = session.get(Frame, ann.frame_id)
    if not frame:
        raise HTTPException(status_code=404, detail="Frame introuvable")
    project_id = frame.project_id

    if data.action == "detach":
        ann.track_id = None
        session.add(ann)
        session.commit()
        return {"success": True, "track_id": None}

    if data.action == "assign":
        if data.track_id is None:
            raise HTTPException(status_code=400, detail="track_id requis pour action=assign")
        track = session.get(Track, data.track_id)
        if not track or track.project_id != project_id:
            raise HTTPException(status_code=404, detail="Track introuvable dans ce projet")
    else:  # action == "new"
        # Les uid sont numerotes PAR SEQUENCE. Sans passer sequence_id ici, la
        # recherche du prochain uid ne regardait que les pistes legacy
        # (sequence_id IS NULL) : la numerotation repartait de travers, et la
        # piste creee atterrissait dans la pseudo-sequence principale — d'ou
        # une piste qui restait affichee/active en dehors de sa sequence.
        seq_id = _frame_sequence_id(frame, session)
        next_uid = _next_track_uid(project_id, session, seq_id)
        track = Track(
            project_id=project_id,
            sequence_id=seq_id,
            track_uid=next_uid,
            class_id=ann.class_id,
            color=get_track_color(next_uid),
            start_frame=frame.frame_index,
            end_frame=frame.frame_index,
        )
        session.add(track)
        session.flush()  # obtenir track.id

    # Étendre la plage de la track pour inclure cette frame
    track.start_frame = min(track.start_frame, frame.frame_index)
    track.end_frame = max(track.end_frame, frame.frame_index)
    ann.track_id = track.id
    session.add(track)
    session.add(ann)
    session.commit()
    session.refresh(track)
    return {"success": True, "track_id": track.id, "track": _track_to_dict(track)}


@router.put("/api/tracks/{track_id}", response_model=dict)
def update_track(
    track_id: int,
    data: TrackUpdate,
    session: Session = Depends(get_session),
):
    """Met à jour les métadonnées d'une piste (classe, couleur, statut)."""
    track = session.get(Track, track_id)
    if not track:
        raise HTTPException(status_code=404, detail="Piste introuvable")

    if data.class_id is not None:
        track.class_id = data.class_id
        # Propager la mise à jour de classe à toutes les annotations de la piste
        annotations = session.exec(
            select(Annotation).where(Annotation.track_id == track_id)
        ).all()
        for ann in annotations:
            ann.class_id = data.class_id
            session.add(ann)

    if data.color is not None:
        track.color = data.color
    if data.is_active is not None:
        track.is_active = data.is_active

    session.add(track)
    session.commit()

    return _track_to_dict(track)


@router.delete("/api/tracks/{track_id}", response_model=dict)
def delete_track(track_id: int, session: Session = Depends(get_session)):
    """Supprime une piste et toutes ses annotations associées."""
    track = session.get(Track, track_id)
    if not track:
        raise HTTPException(status_code=404, detail="Piste introuvable")

    # Suppression des annotations liées à cette piste
    annotations = session.exec(
        select(Annotation).where(Annotation.track_id == track_id)
    ).all()
    deleted_annotations = len(annotations)
    from backend.services.monitoring_service import record_bulk_delete
    record_bulk_delete(
        [(a.id, a.source_algorithm, a.frame_id) for a in annotations],
        origin="track_delete",
    )
    for ann in annotations:
        session.delete(ann)

    removed_uid = track.track_uid
    project_id = track.project_id
    seq_id = track.sequence_id
    session.delete(track)
    session.flush()
    # Renumérotation contiguë des uids DANS la séquence (0,1,2,3 → suppr 2 → 3 devient 2)
    _compact_track_uids(project_id, removed_uid, session, seq_id)
    session.commit()

    return {
        "success": True,
        "deleted_track_id": track_id,
        "deleted_annotations": deleted_annotations,
    }


class DeleteBlockRequest(BaseModel):
    start_frame: int
    end_frame: int


@router.post("/api/tracks/{track_id}/delete-block", response_model=dict)
def delete_track_block(
    track_id: int,
    data: DeleteBlockRequest,
    session: Session = Depends(get_session),
):
    """Supprime les annotations d'une piste sur une plage de frames (un 'bloc'
    de la timeline), sans toucher au reste de la piste. Si la piste devient
    vide, elle est supprimée aussi."""
    from sqlalchemy import func as _func
    from backend.models.routers.annotation import _update_frame_annotation_status

    track = session.get(Track, track_id)
    if not track:
        raise HTTPException(status_code=404, detail="Piste introuvable")

    lo = min(data.start_frame, data.end_frame)
    hi = max(data.start_frame, data.end_frame)

    rows = session.exec(
        select(Annotation, Frame)
        .join(Frame, Annotation.frame_id == Frame.id)
        .where(Annotation.track_id == track_id)
        .where(Frame.frame_index >= lo)
        .where(Frame.frame_index <= hi)
    ).all()

    affected: dict[int, Frame] = {}
    deleted = 0
    from backend.services.monitoring_service import record_bulk_delete
    record_bulk_delete(
        [(a.id, a.source_algorithm, a.frame_id) for a, _ in rows],
        origin="track_block_delete",
    )
    for ann, frame in rows:
        affected[frame.id] = frame
        session.delete(ann)
        deleted += 1
    session.flush()

    for frame in affected.values():
        _update_frame_annotation_status(frame, session)

    remaining = session.exec(
        select(_func.count(Annotation.id)).where(Annotation.track_id == track_id)
    ).one()
    track_removed = False
    if remaining == 0:
        removed_uid = track.track_uid
        project_id = track.project_id
        seq_id = track.sequence_id
        session.delete(track)
        session.flush()
        _compact_track_uids(project_id, removed_uid, session, seq_id)
        track_removed = True

    session.commit()
    return {
        "success": True,
        "deleted_annotations": deleted,
        "track_removed": track_removed,
        "track_id": track_id,
    }


@router.post("/api/projects/{project_id}/tracks/merge", response_model=dict)
def merge_tracks(
    project_id: int,
    data: MergeTracksRequest,
    session: Session = Depends(get_session),
):
    """
    Fusionne deux pistes en une seule.
    Toutes les annotations de track_id_merge sont réassignées à track_id_keep.
    Utile quand un objet est perdu puis réidentifié avec un nouvel ID.
    """
    track_keep = session.get(Track, data.track_id_keep)
    track_merge = session.get(Track, data.track_id_merge)

    if not track_keep or not track_merge:
        raise HTTPException(status_code=404, detail="Une des pistes est introuvable")

    if track_keep.project_id != project_id or track_merge.project_id != project_id:
        raise HTTPException(status_code=403, detail="Les pistes n'appartiennent pas à ce projet")

    # Réassignation des annotations
    annotations = session.exec(
        select(Annotation).where(Annotation.track_id == data.track_id_merge)
    ).all()
    merged_count = len(annotations)

    for ann in annotations:
        ann.track_id = data.track_id_keep
        session.add(ann)

    # Mise à jour des bornes de la piste conservée
    track_keep.start_frame = min(track_keep.start_frame, track_merge.start_frame)
    track_keep.end_frame = max(track_keep.end_frame, track_merge.end_frame)
    session.add(track_keep)

    # Suppression de la piste absorbée
    session.delete(track_merge)
    session.commit()

    return {
        "success": True,
        "merged_annotations": merged_count,
        "track_id": data.track_id_keep,
    }


# ---- ByteTrack ----

@router.get("/api/tasks/{task_id}", response_model=dict)
def get_task_status(task_id: str):
    """
    Retourne le statut d'une tache en arriere-plan (ByteTrack, propagation, etc.)
    Statuts possibles : pending | running | completed | error
    """
    from backend.services.task_registry import get_task
    task = get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Tache introuvable")
    return task


@router.get("/api/tasks/{task_id}/logs", response_model=dict)
def get_task_logs_endpoint(task_id: str, since: int = 0):
    """
    Retourne les lignes de log de l'algo depuis l'index `since` (incrementiel).
    Alimente le panneau de logs temps reel du TrackPanel (memes lignes que le
    terminal serveur). Renvoie {"lines": [...], "next": <index a renvoyer>}.
    """
    from backend.services.task_registry import get_task_logs
    logs = get_task_logs(task_id, since)
    if logs is None:
        raise HTTPException(status_code=404, detail="Tache introuvable")
    return logs


@router.post("/api/tasks/{task_id}/stop", response_model=dict)
def stop_task(task_id: str):
    """Demande l'arret propre d'une tache en cours (verifie le flag a la prochaine iteration)."""
    from backend.services.task_registry import get_task, request_stop
    task = get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Tache introuvable")
    request_stop(task_id)
    return {"success": True, "task_id": task_id}


@router.post("/api/tasks/{task_id}/pause", response_model=dict)
def pause_task(task_id: str):
    """Met une tache en pause (la boucle de traitement attend la reprise)."""
    from backend.services.task_registry import get_task, request_pause
    task = get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Tache introuvable")
    request_pause(task_id)
    return {"success": True, "task_id": task_id}


@router.post("/api/tasks/{task_id}/resume", response_model=dict)
def resume_task(task_id: str):
    """Reprend une tache en pause."""
    from backend.services.task_registry import get_task, request_resume
    task = get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Tache introuvable")
    request_resume(task_id)
    return {"success": True, "task_id": task_id}


@router.websocket("/ws/tasks/{task_id}")
async def websocket_task_progress(websocket: WebSocket, task_id: str):
    """
    Pousse l'etat d'une tache en arriere-plan (statut, progression,
    current_frame_id, live_frame) au client DES QU'IL CHANGE, sur UNE seule
    connexion persistante.

    Remplace le polling HTTP repete (GET /api/tasks/{id} toutes les 600-1500ms
    depuis 2 endroits du frontend). Ce n'etait pas juste redondant : chaque
    poll HTTP passe par le threadpool anyio (meme si get_task() ne touche que
    la memoire) et consomme un des 6 slots de connexion par origine du
    navigateur — sous SSH, avec des dizaines de requetes/s pendant une
    propagation, ce trafic entrait en contention avec les vraies requetes
    (image, annotations, stop) au point de tout figer. Un WebSocket = une
    seule connexion pour toute la duree du run, zero requete HTTP par frame.

    Cote serveur, la boucle relit get_task() toutes les 150ms (lecture memoire
    sous verrou, cout negligeable) mais n'ENVOIE sur le socket que si l'etat a
    reellement change — le trafic reseau reste proportionnel aux VRAIS
    changements, pas a la frequence de poll.
    """
    import asyncio
    from backend.services.task_registry import drain_live_frames, get_task

    await websocket.accept()
    last_sent: Optional[tuple] = None
    try:
        while True:
            task = get_task(task_id)
            if task is None:
                await websocket.send_json({"type": "not_found"})
                break

            # Vider la file AVANT de comparer l'instantane : `live_frame` seul
            # est ecrase a chaque frame propagee, donc echantillonner ce champ
            # toutes les 150 ms perdait les frames intercalees (mesure : 18% a
            # 6 f/s, bien pire quand le GPU accelere). `live_frames` porte la
            # TOTALITE des apercus produits depuis le tour precedent.
            pending = drain_live_frames(task_id)

            snapshot = (
                task["status"], task["progress"], task["message"],
                task.get("current_frame_id"), task.get("live_frame"),
            )
            if pending or snapshot != last_sent:
                last_sent = snapshot
                await websocket.send_json({
                    "type": "update",
                    "status": task["status"],
                    "progress": task["progress"],
                    "message": task["message"],
                    "error": task.get("error"),
                    "current_frame_id": task.get("current_frame_id"),
                    # Conserve pour compatibilite : un client plus ancien lit
                    # encore ce champ seul.
                    "live_frame": task.get("live_frame"),
                    "live_frames": pending,
                })

            if task["status"] in ("completed", "error"):
                break
            await asyncio.sleep(0.15)
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        # Une fermeture proxy est recuperable cote client, mais elle doit rester
        # visible dans les logs : auparavant toute erreur de serialisation ou
        # d'envoi etait avalee, rendant un canvas gris impossible a diagnostiquer.
        print(f"[TaskWS] {task_id}: {type(exc).__name__}: {exc}", flush=True)


@router.post("/api/projects/{project_id}/bytetrack/run", response_model=dict)
def run_bytetrack(
    project_id: int,
    background_tasks: BackgroundTasks,
    data: ByteTrackRunRequest,
    session: Session = Depends(get_session),
):
    """
    Lance ByteTrack sur une plage de frames avec les annotations existantes comme détections.
    Génère des IDs de piste stables et met à jour les annotations en base de données.
    Exécuté en arrière-plan pour ne pas bloquer l'API.
    """
    import uuid
    task_id = str(uuid.uuid4())

    # Récupération des frames de la plage
    query = select(Frame).where(Frame.project_id == project_id).order_by(Frame.frame_index)
    if data.end_frame_index is not None:
        query = query.where(Frame.frame_index <= data.end_frame_index)
    query = query.where(Frame.frame_index >= data.start_frame_index)

    frames = session.exec(query).all()
    frame_ids = [f.id for f in frames]

    # Enregistrement de la tache dans le registre
    from backend.services.task_registry import create_task, update_task
    create_task(task_id, f"ByteTrack sur {len(frame_ids)} frames")

    async def run_bytetrack_background():
        """Exécution du tracking en arrière-plan."""
        from backend.services.tracker_service import Detection, TrackerService
        from sqlmodel import Session as DBSession
        from backend.database import engine
        from backend.services.task_registry import update_task as _upd

        _upd(task_id, "running", 0, "Initialisation ByteTrack...")

        tracker = TrackerService(
            track_thresh=data.track_thresh,
            track_buffer=data.track_buffer,
            match_thresh=data.match_thresh,
        )

        # Récupération des classes du projet pour le mapping
        with DBSession(engine) as db:
            classes = db.exec(
                select(LabelClass).where(LabelClass.project_id == project_id)
            ).all()
            class_ids_set = set(c.id for c in classes)

        total = len(frame_ids)
        for frame_num, frame_id in enumerate(frame_ids):
            # Mise a jour de la progression
            progress_pct = int((frame_num / max(total, 1)) * 90)
            _upd(task_id, "running", progress_pct, f"Frame {frame_num + 1}/{total}...")

            with DBSession(engine) as db:
                # Récupération de la frame et de ses annotations
                frame = db.get(Frame, frame_id)
                if not frame:
                    continue

                annotations = db.exec(
                    select(Annotation).where(Annotation.frame_id == frame_id)
                ).all()

                # Filtrage par classe si demandé
                if data.class_ids:
                    annotations = [a for a in annotations if a.class_id in data.class_ids]

                # Conversion des annotations en détections ByteTrack
                detections = []
                for ann in annotations:
                    if ann.confidence is None:
                        continue

                    # Conversion YOLO normalisé → pixels
                    cx, cy, w, h = ann.cx, ann.cy, ann.width, ann.height
                    x1 = int((cx - w / 2) * frame.width)
                    y1 = int((cy - h / 2) * frame.height)
                    x2 = int((cx + w / 2) * frame.width)
                    y2 = int((cy + h / 2) * frame.height)

                    detections.append(Detection(
                        bbox_pixel=(x1, y1, x2, y2),
                        confidence=ann.confidence,
                        class_id=ann.class_id,
                    ))

                # Mise à jour du tracker
                tracked_objects = tracker.update(detections, frame.frame_index)

                # Mise à jour des annotations avec les IDs de piste
                for tracked in tracked_objects:
                    # Trouver ou créer la piste dans la BDD
                    existing_track = db.exec(
                        select(Track)
                        .where(Track.project_id == project_id)
                        .where(Track.track_uid == tracked.project_track_id)
                    ).first()

                    if not existing_track:
                        from backend.utils.color_utils import get_track_color
                        existing_track = Track(
                            project_id=project_id,
                            track_uid=tracked.project_track_id,
                            class_id=tracked.class_id,
                            color=get_track_color(tracked.project_track_id),
                            start_frame=frame.frame_index,
                            end_frame=frame.frame_index,
                        )
                        db.add(existing_track)
                        db.flush()
                    else:
                        existing_track.end_frame = max(existing_track.end_frame, frame.frame_index)
                        db.add(existing_track)

                    # Associer l'annotation la plus proche à cette piste
                    best_ann = None
                    best_iou = 0.0
                    from backend.utils.yolo_utils import compute_iou
                    for ann in annotations:
                        cx = ann.cx; cy = ann.cy; w = ann.width; h = ann.height
                        iou = compute_iou(
                            (cx, cy, w, h),
                            (
                                (tracked.bbox_pixel[0] + tracked.bbox_pixel[2]) / 2 / frame.width,
                                (tracked.bbox_pixel[1] + tracked.bbox_pixel[3]) / 2 / frame.height,
                                (tracked.bbox_pixel[2] - tracked.bbox_pixel[0]) / frame.width,
                                (tracked.bbox_pixel[3] - tracked.bbox_pixel[1]) / frame.height,
                            )
                        )
                        if iou > best_iou:
                            best_iou = iou
                            best_ann = ann

                    if best_ann and existing_track.id:
                        best_ann.track_id = existing_track.id
                        db.add(best_ann)

                db.commit()

    async def run_bytetrack_with_completion():
        """Wrapper qui marque la tache comme terminee ou en erreur."""
        from backend.services.task_registry import update_task as _upd
        try:
            await run_bytetrack_background()
            _upd(task_id, "completed", 100, "ByteTrack termine avec succes")
        except Exception as exc:
            _upd(task_id, "error", 0, str(exc), str(exc))

    background_tasks.add_task(run_bytetrack_with_completion)

    return {
        "success": True,
        "task_id": task_id,
        "frames_to_process": len(frame_ids),
        "message": "ByteTrack lance en arriere-plan",
    }


# ---- Propagation homographique ----

@router.post("/api/projects/{project_id}/homography/propagate", response_model=dict)
def propagate_homography(
    project_id: int,
    background_tasks: BackgroundTasks,
    data: HomographyPropagateRequest,
    session: Session = Depends(get_session),
):
    """
    Propage des annotations depuis une keyframe vers les frames suivantes
    en utilisant l'homographie (compensation du mouvement de caméra).
    Les frames avec faible score homographique sont marquées en orange.
    """
    import uuid
    task_id = str(uuid.uuid4())

    # Validation des frames
    keyframe = session.get(Frame, data.keyframe_id)
    end_frame = session.get(Frame, data.end_frame_id)

    if not keyframe or not end_frame:
        raise HTTPException(status_code=404, detail="Frames introuvables")
    if end_frame.frame_index <= keyframe.frame_index:
        raise HTTPException(
            status_code=400,
            detail=f"La frame de fin ({end_frame.frame_index}) doit etre apres la keyframe ({keyframe.frame_index})",
        )

    # Récupération des annotations source
    keyframe_annotations = session.exec(
        select(Annotation)
        .where(Annotation.frame_id == data.keyframe_id)
        .where(Annotation.id.in_(data.annotation_ids))
    ).all()

    if not keyframe_annotations:
        raise HTTPException(status_code=400, detail="Aucune annotation trouvée pour la propagation")

    # Récupération des frames intermédiaires + fin
    intermediate_frames = session.exec(
        select(Frame)
        .where(Frame.project_id == project_id)
        .where(Frame.frame_index > keyframe.frame_index)
        .where(Frame.frame_index <= end_frame.frame_index)
        .order_by(Frame.frame_index)
    ).all()

    frame_ids = [f.id for f in intermediate_frames]
    source_annotations = [
        {
            "id": a.id,
            "class_id": a.class_id,
            "cx": a.cx,
            "cy": a.cy,
            "width": a.width,
            "height": a.height,
            "confidence": a.confidence,
            "track_id": a.track_id,
            "annotation_type": a.annotation_type,
        }
        for a in keyframe_annotations
    ]

    # Enregistrement de la tache dans le registre (pour polling frontend)
    from backend.services.task_registry import create_task, update_task
    create_task(task_id, f"Propagation homographique sur {len(frame_ids)} frames")

    def run_propagation():
        """
        Propagation homographique en arrière-plan.
        IMPORTANT : fonction SYNCHRONE (def, pas async def) → FastAPI l'exécute
        dans son threadpool. En async sans await, tout le calcul XFeat/OpenCV
        bloquait la boucle d'événements : plus aucune requête servie pendant la
        propagation (polling figé sur "Démarrage", timeouts, stop inopérant).
        """
        import cv2
        from backend.services.homography_service import homography_service
        from backend.services.dataset_service import dataset_service
        from backend.database import engine
        from sqlmodel import Session as DBSession
        from backend.services.task_registry import update_task as _upd, is_stop_requested, append_log

        import time as _time
        from backend.services.task_registry import append_progress as _prog
        algo = "flux optique LK" if data.use_optical_flow else "homographie XFeat/SIFT"
        _lbl = "[OptFlow]" if data.use_optical_flow else "[Homography]"
        total = len(frame_ids)
        _t0 = _time.monotonic()
        _upd(task_id, "running", 0, "Initialisation...")
        append_log(task_id, f"$ propagate --algo {algo} --annotations {len(source_annotations)} "
                            f"--frames {total} --min-inlier-ratio {data.min_inlier_ratio}")

        with DBSession(engine) as db:
            resolved_prev = _resolve_frame_image_path(project_id, keyframe, db)
        if resolved_prev is None:
            append_log(task_id, "[Homography] Frame source introuvable ou non extraite")
            _upd(task_id, "error", 0, "", "Frame source introuvable ou non extraite")
            return
        prev_image_path = str(resolved_prev)
        current_annotations = source_annotations.copy()

        kp_msg = ""
        for frame_num, frame_id in enumerate(frame_ids):
            if is_stop_requested(task_id):
                _upd(task_id, "completed", 100,
                     f"Arrete par l'utilisateur a la frame {frame_num}/{total}")
                append_log(task_id, f"[Homography] arret demande — stoppe a {frame_num}/{total}")
                return
            progress_pct = int((frame_num / max(total, 1)) * 95)
            _upd(task_id, "running", progress_pct, f"Frame {frame_num + 1}/{total}...")

            with DBSession(engine) as db:
                frame = db.get(Frame, frame_id)
                if not frame:
                    continue

                resolved_curr = _resolve_frame_image_path(project_id, frame, db)
                if resolved_curr is None:
                    _upd(task_id, "running", progress_pct, f"Frame {frame_num + 1}/{total} introuvable", current_frame_id=frame_id)
                    continue
                curr_image_path = str(resolved_curr)

                # LUT d'affichage effective de la frame (séquence→projet) : l'homographie
                # et le flux optique travaillent sur la MÊME image 8 bits que l'utilisateur.
                _prop_lut = _frame_display_lut(frame, db)
                from backend.utils.image_utils import load_image_bgr_8bit
                try:
                    img_prev = load_image_bgr_8bit(prev_image_path, _prop_lut)
                    img_curr = load_image_bgr_8bit(curr_image_path, _prop_lut)
                except FileNotFoundError:
                    continue

                # Calcul de l'homographie avec tous les paramètres de la requête
                H_matrix, inlier_ratio, hstats = homography_service.compute_homography(
                    img_prev, img_curr,
                    min_inlier_count=data.min_inlier_count,
                    min_inlier_ratio=data.min_inlier_ratio,
                    ransac_threshold=data.ransac_threshold,
                    xfeat_top_k=data.xfeat_top_k,
                    xfeat_min_cossim=data.xfeat_min_cossim,
                )

                # Message enrichi avec stats keypoints visibles dans le frontend
                kp_msg = (
                    f"Frame {frame_num + 1}/{total} — "
                    f"kp:{hstats['keypoints']} match:{hstats['matches']} inliers:{hstats['inliers']} "
                    f"ratio:{inlier_ratio:.2f}"
                )

                new_annotations = []
                h, w = img_curr.shape[:2]

                if data.use_optical_flow:
                    # Flux optique : suit le mouvement reel de chaque objet
                    bboxes_in = [(ann["cx"], ann["cy"], ann["width"], ann["height"]) for ann in current_annotations]
                    warped_bboxes = homography_service.track_bboxes_optical_flow(
                        img_prev, img_curr, bboxes_in, w, h,
                        win_size=data.optflow_win_size,
                        max_level=data.optflow_max_level,
                        min_tracked_pts=data.optflow_min_pts,
                    )
                else:
                    # Homographie pure : ne compense que le mouvement camera
                    warped_bboxes = []
                    for ann in current_annotations:
                        if H_matrix is not None:
                            wb = homography_service.warp_bbox_yolo(
                                bbox_yolo=(ann["cx"], ann["cy"], ann["width"], ann["height"]),
                                H=H_matrix, src_width=w, src_height=h, dst_width=w, dst_height=h,
                            )
                        else:
                            wb = (ann["cx"], ann["cy"], ann["width"], ann["height"])
                        warped_bboxes.append(wb)

                for ann, new_bbox in zip(current_annotations, warped_bboxes):
                    if new_bbox:
                        new_ann = ann.copy()
                        new_ann["cx"], new_ann["cy"] = new_bbox[0], new_bbox[1]
                        new_ann["width"], new_ann["height"] = new_bbox[2], new_bbox[3]
                        # Confiance fixe basée sur la qualité homographique de CE pas
                        # (pas de décroissance cumulative : on garde la confiance source)
                        confidence_score = ann.get("_source_confidence", ann["confidence"]) * (0.6 + 0.4 * inlier_ratio)
                        new_ann["confidence"] = confidence_score
                        # Propager la confiance source originale pour éviter la décroissance
                        new_ann["_source_confidence"] = ann.get("_source_confidence", ann["confidence"])
                        new_annotations.append(new_ann)

                        db_ann = Annotation(
                            frame_id=frame_id,
                            class_id=new_ann["class_id"],
                            annotation_type=new_ann["annotation_type"],
                            cx=new_ann["cx"],
                            cy=new_ann["cy"],
                            width=new_ann["width"],
                            height=new_ann["height"],
                            confidence=confidence_score,
                            is_auto=True,
                            is_interpolated=True,
                            track_id=new_ann.get("track_id"),
                        )
                        db.add(db_ann)

                frame.is_annotated = len(new_annotations) > 0
                frame.propagation_confidence = inlier_ratio
                db.add(frame)
                db.commit()

                prev_image_path = curr_image_path
                current_annotations = new_annotations

            # Mise a jour current_frame_id APRES le commit
            _upd(task_id, "running", progress_pct, kp_msg, current_frame_id=frame_id)
            if (frame_num + 1) % 20 == 0:
                _elapsed = _time.monotonic() - _t0
                _fps = (frame_num + 1) / _elapsed if _elapsed > 0 else 0.0
                _prog(task_id, _lbl, frame_num + 1, total, _fps, kp_msg)

        append_log(task_id, f"{_lbl} propagation terminee ({total} frames)")
        _upd(task_id, "completed", 100, f"Propagation terminee ({total} frames)")

    background_tasks.add_task(run_propagation)

    return {
        "success": True,
        "task_id": task_id,
        "frames_to_propagate": len(frame_ids),
        "message": "Propagation homographique lancee en arriere-plan",
    }


# ---- Tracking Guide ----

import math as _math


def _centroid_dist_yolo(b1, b2) -> float:
    """Distance euclidienne normalisee entre centroïdes (format YOLO cx,cy,w,h)."""
    dx = b2[0] - b1[0]
    dy = b2[1] - b1[1]
    return _math.sqrt(dx * dx + dy * dy)


def _size_variation(b1, b2) -> float:
    """Variation relative de surface entre deux bbox YOLO (0=identique)."""
    a1 = b1[2] * b1[3]
    a2 = b2[2] * b2[3]
    if a1 < 1e-8:
        return 0.0
    return abs(a2 - a1) / a1


def _greedy_match(targets_bbox, detections_bbox, max_dist: float):
    """
    Greedy matching : pour chaque cible, trouve la detection la plus proche.

    Returns:
        List[(target_idx, detection_idx)]
        detection_idx == -1 signifie aucun match trouve.
    """
    used = set()
    matches = []
    for t_idx, t_bbox in enumerate(targets_bbox):
        best_dist = max_dist + 1.0
        best_d = -1
        for d_idx, d_bbox in enumerate(detections_bbox):
            if d_idx in used:
                continue
            dist = _centroid_dist_yolo(t_bbox, d_bbox)
            if dist < best_dist:
                best_dist = dist
                best_d = d_idx
        if best_d >= 0 and best_dist <= max_dist:
            matches.append((t_idx, best_d))
            used.add(best_d)
        else:
            matches.append((t_idx, -1))
    return matches


@router.post("/api/projects/{project_id}/guided-tracking/run", response_model=dict)
def run_guided_tracking(
    project_id: int,
    background_tasks: BackgroundTasks,
    data: GuidedTrackingRequest,
    session: Session = Depends(get_session),
):
    """
    Tracking Guide : selectionner N cibles sur une frame de reference,
    puis les suivre sur une plage de frames via Grounding DINO ou SAM3
    avec matching par distance de centroide.

    Anomalies detectees :
      - Cible manquante (aucun match dans max_centroid_distance)
      - Variation de surface excessive (> size_variation_threshold)
    """
    import uuid

    # Validation : frame de reference
    ref_frame = session.get(Frame, data.reference_frame_id)
    if not ref_frame or ref_frame.project_id != project_id:
        raise HTTPException(status_code=404, detail="Frame de reference introuvable")

    # Validation : annotations cibles
    target_annotations = session.exec(
        select(Annotation)
        .where(Annotation.frame_id == data.reference_frame_id)
        .where(Annotation.id.in_(data.annotation_ids))
    ).all()

    if not target_annotations:
        raise HTTPException(status_code=400, detail="Aucune annotation cible trouvee")

    # Validation : algorithme
    if data.algorithm not in ("grounding_dino", "sam3"):
        raise HTTPException(status_code=400, detail="Algorithme invalide (grounding_dino | sam3)")

    # Les deux detecteurs restants sont guides par texte : le prompt est requis.
    if not data.text_prompt.strip():
        raise HTTPException(status_code=400, detail="Le prompt texte est obligatoire")

    # Recuperation des frames de la plage
    frames_in_range = session.exec(
        select(Frame)
        .where(Frame.project_id == project_id)
        .where(Frame.frame_index >= data.start_frame_index)
        .where(Frame.frame_index <= data.end_frame_index)
        .where(Frame.id != data.reference_frame_id)
        .order_by(Frame.frame_index)
    ).all()

    if not frames_in_range:
        raise HTTPException(status_code=400, detail="Aucune frame dans la plage specifiee")

    # Serialisation des cibles pour le background task
    serialized_targets = [
        {
            "id": a.id,
            "class_id": a.class_id,
            "cx": a.cx, "cy": a.cy,
            "width": a.width, "height": a.height,
        }
        for a in target_annotations
    ]
    frame_ids_range = [f.id for f in frames_in_range]

    # Track par cible : réutiliser la track existante de l'annotation si elle en
    # a une (continuité MOT), sinon en créer une nouvelle (uid incrémental).
    from backend.utils.color_utils import get_track_color
    # uid numerotes PAR SEQUENCE (cf. _next_track_uid) : omettre sequence_id
    # rangeait la piste dans la pseudo-sequence legacy.
    _seq_id = _frame_sequence_id(ref_frame, session)
    next_uid = _next_track_uid(project_id, session, _seq_id)
    _start = data.ref_array_index if data.ref_array_index >= 0 else ref_frame.frame_index
    _end = data.end_array_index if data.end_array_index >= 0 else data.end_frame_index

    track_ids_by_target = {}  # target annotation id -> track DB id
    for ann in target_annotations:
        if ann.track_id:
            existing = session.get(Track, ann.track_id)
            if existing and existing.project_id == project_id:
                existing.start_frame = min(existing.start_frame, _start)
                existing.end_frame = max(existing.end_frame, _start)
                session.add(existing)
                track_ids_by_target[ann.id] = existing.id
                continue
        track = Track(
            project_id=project_id,
            sequence_id=_seq_id,
            track_uid=next_uid,
            class_id=ann.class_id,
            color=get_track_color(next_uid),
            start_frame=_start,
            end_frame=_start,  # grandit frame par frame (voir _write_frame / boucle guidée)
        )
        next_uid += 1
        session.add(track)
        session.flush()
        track_ids_by_target[ann.id] = track.id
        ann.track_id = track.id
        session.add(ann)
    session.commit()

    task_id = str(uuid.uuid4())
    from backend.services.task_registry import create_task
    create_task(task_id, f"Tracking guide sur {len(frame_ids_range)} frames")

    async def _run():
        from backend.services.task_registry import (
            update_task as _upd, set_task_result, append_log, append_progress as _prog)
        from backend.services.dataset_service import dataset_service
        from backend.database import engine
        from sqlmodel import Session as DBSession
        import time as _time

        _upd(task_id, "running", 0, "Chargement du modele...")
        append_log(task_id, f"$ track --algo detect/{data.algorithm} "
                            f"--targets {len(serialized_targets)} --frames {len(frame_ids_range)} "
                            f"--prompt \"{data.text_prompt}\"")
        _t0 = _time.monotonic()

        # Chargement du service de detection
        if data.algorithm == "grounding_dino":
            from backend.services.grounding_service import get_grounding_service
            detector = get_grounding_service()
            if not detector.load():
                _upd(task_id, "error", 0, "", "Grounding DINO non disponible")
                return
        else:
            from backend.services.sam3_service import get_sam3_service
            detector = get_sam3_service()
            if not detector.load_model():
                _upd(task_id, "error", 0, "", "SAM3 non disponible")
                return

        anomalies = []
        total_created = 0
        total = len(frame_ids_range)
        n_targets = len(serialized_targets)

        # Positions courantes des cibles (mises a jour a chaque frame matchee)
        current_target_bboxes = {
            ann["id"]: (ann["cx"], ann["cy"], ann["width"], ann["height"])
            for ann in serialized_targets
        }

        # Auto-stop : compteur de frames consécutives avec trop de pertes
        consecutive_lost_frames = 0
        auto_stopped = False
        frame_num = -1  # initialisé ici pour être visible après la boucle

        import asyncio
        from backend.services.task_registry import is_stop_requested, is_pause_requested

        loop = asyncio.get_event_loop()

        for frame_num, frame_id in enumerate(frame_ids_range):

            # ---- Pause : attente active sans bloquer l'event loop ----
            while is_pause_requested(task_id):
                pct_now = int((frame_num / max(total, 1)) * 95)
                _upd(task_id, "running", pct_now, f"En pause... (frame {frame_num + 1}/{total})", current_frame_id=frame_id)
                await asyncio.sleep(0.4)

            # ---- Stop : sortie propre de la boucle ----
            if is_stop_requested(task_id):
                break

            pct = int((frame_num / max(total, 1)) * 95)
            n_matched_this_frame = 0  # initialisé avant le with block
            n_lost_this_frame = 0
            pct_updated = pct
            _upd(task_id, "running", pct, f"Frame {frame_num + 1}/{total}...")

            with DBSession(engine) as db:
                frame = db.get(Frame, frame_id)
                if not frame:
                    continue

                resolved_path = _resolve_frame_image_path(project_id, frame, db)
                if resolved_path is None:
                    anomalies.append({
                        "frame_index": frame.frame_index,
                        "frame_id": frame_id,
                        "type": "detection_error",
                        "message": "Image non extraite ou introuvable",
                    })
                    _upd(task_id, "running", pct, f"Frame {frame_num + 1}/{total} introuvable", current_frame_id=frame_id)
                    continue
                img_path = str(resolved_path)

                # LUT d'affichage de la frame bakée dans l'entrée IA (#5) : GD/SAM3/YOLO
                # voient la même image 8 bits que l'utilisateur.
                _frame_lut = _frame_display_lut(frame, db)
                ai_path = _ai_input_path(img_path, project_id, _frame_lut)

                # Detection sur la frame
                # DINO/YOLO : appel synchrone bloquant → run_in_executor pour ne pas geler l'event loop
                # SAM3 : coroutine native → await direct
                try:
                    if data.algorithm == "grounding_dino":
                        _box_threshold = data.box_threshold
                        _text_threshold = data.text_threshold
                        _text_prompt = data.text_prompt
                        _img_width = frame.width
                        _img_height = frame.height
                        detections = await loop.run_in_executor(
                            None,
                            lambda: detector.detect_objects(
                                image_path=ai_path,
                                text_prompt=_text_prompt,
                                box_threshold=_box_threshold,
                                text_threshold=_text_threshold,
                                image_width=_img_width,
                                image_height=_img_height,
                            ),
                        )
                    else:
                        detections = await detector.detect_and_segment(
                            image_path=ai_path,
                            text_prompt=data.text_prompt,
                            img_width=frame.width,
                            img_height=frame.height,
                        )
                except Exception as exc:
                    anomalies.append({
                        "frame_index": frame.frame_index,
                        "frame_id": frame_id,
                        "type": "detection_error",
                        "message": str(exc),
                    })
                    continue

                det_bboxes = [d["bbox_yolo"] for d in detections]
                target_ids_ordered = [ann["id"] for ann in serialized_targets]
                target_bboxes_ordered = [current_target_bboxes[tid] for tid in target_ids_ordered]

                matches = _greedy_match(
                    target_bboxes_ordered,
                    det_bboxes,
                    data.max_centroid_distance,
                )

                for t_idx, d_idx in matches:
                    t_ann = serialized_targets[t_idx]
                    t_id = t_ann["id"]
                    track_db_id = track_ids_by_target.get(t_id)

                    if d_idx == -1:
                        # Aucun match
                        anomalies.append({
                            "frame_index": frame.frame_index,
                            "frame_id": frame_id,
                            "type": "missing",
                            "target_annotation_id": t_id,
                            "target_class_id": t_ann["class_id"],
                        })
                        continue

                    matched_det = detections[d_idx]
                    matched_bbox = matched_det["bbox_yolo"]

                    # Verification variation de taille
                    ref_bbox = current_target_bboxes[t_id]
                    variation = _size_variation(ref_bbox, matched_bbox)
                    anomaly_flags = []
                    if variation > data.size_variation_threshold:
                        anomaly_flags.append("size_variation")
                        anomalies.append({
                            "frame_index": frame.frame_index,
                            "frame_id": frame_id,
                            "type": "size_variation",
                            "target_annotation_id": t_id,
                            "target_class_id": t_ann["class_id"],
                            "variation": round(variation, 3),
                        })

                    # Creation de l'annotation (bbox ou polygone selon mode SAM3)
                    use_polygon = (
                        data.algorithm == "sam3"
                        and data.sam3_output_mode == "segmentation"
                        and matched_det.get("polygon")
                    )

                    if use_polygon:
                        import json as _json
                        polygon_pts = matched_det["polygon"]
                        new_ann = Annotation(
                            frame_id=frame_id,
                            class_id=t_ann["class_id"],
                            annotation_type=AnnotationType.POLYGON,
                            cx=matched_bbox[0],
                            cy=matched_bbox[1],
                            width=matched_bbox[2],
                            height=matched_bbox[3],
                            points=_json.dumps(polygon_pts),
                            confidence=matched_det.get("score", 0.9),
                            is_auto=True,
                            source_algorithm="guided_tracking",
                            track_id=track_db_id,
                        )
                    else:
                        new_ann = Annotation(
                            frame_id=frame_id,
                            class_id=t_ann["class_id"],
                            annotation_type=AnnotationType.BBOX,
                            cx=matched_bbox[0],
                            cy=matched_bbox[1],
                            width=matched_bbox[2],
                            height=matched_bbox[3],
                            confidence=matched_det.get("score", 0.9),
                            is_auto=True,
                            source_algorithm="guided_tracking",
                            track_id=track_db_id,
                        )
                    db.add(new_ann)

                    # Mise a jour de la position courante pour la prochaine frame
                    current_target_bboxes[t_id] = tuple(matched_bbox)
                    total_created += 1

                # Comptage des cibles matchées pour cette frame
                n_matched_this_frame = sum(1 for _, d_idx in matches if d_idx != -1)
                n_lost_this_frame = n_targets - n_matched_this_frame
                pct_updated = int((frame_num / max(total, 1)) * 95)

                # Auto-stop : si trop de cibles perdues sur N frames consécutives
                if data.auto_stop_lost_ratio > 0 and n_targets > 0:
                    lost_ratio = n_lost_this_frame / n_targets
                    if lost_ratio > data.auto_stop_lost_ratio:
                        consecutive_lost_frames += 1
                    else:
                        consecutive_lost_frames = 0
                    if consecutive_lost_frames >= data.auto_stop_consecutive_frames:
                        auto_stopped = True
                        db.commit()
                        _upd(task_id, "running", pct_updated,
                             f"Frame {frame_num + 1}/{total} — {n_matched_this_frame}/{n_targets} boîtes",
                             current_frame_id=frame_id)
                        break
                else:
                    consecutive_lost_frames = 0

                # Mise a jour end_frame du track
                for track_db_id in track_ids_by_target.values():
                    t_obj = db.get(Track, track_db_id)
                    if t_obj:
                        t_obj.end_frame = max(t_obj.end_frame, frame.frame_index)
                        db.add(t_obj)

                # Marquer la frame annotee (stats sequences, exports, timeline)
                if n_matched_this_frame > 0:
                    frame.is_annotated = True
                    db.add(frame)

                db.commit()

            # Mise a jour current_frame_id APRES le commit → annotations visibles côté client
            _upd(task_id, "running", pct_updated,
                 f"Frame {frame_num + 1}/{total} — {n_matched_this_frame}/{n_targets} boîtes",
                 current_frame_id=frame_id)
            if (frame_num + 1) % 20 == 0:
                _elapsed = _time.monotonic() - _t0
                _fps = (frame_num + 1) / _elapsed if _elapsed > 0 else 0.0
                _prog(task_id, "[Detect]", frame_num + 1, total, _fps,
                      f"{n_matched_this_frame}/{n_targets} boites, {total_created} annots")
            # Yield a l'event loop entre chaque frame → les requetes de polling passent
            await asyncio.sleep(0)

        stopped_early = is_stop_requested(task_id)
        processed = frame_num + 1 if frame_num >= 0 else 0
        set_task_result(task_id, {
            "anomalies": anomalies,
            "total_annotations_created": total_created,
            "processed_frames": processed,
            "stopped_early": stopped_early or auto_stopped,
        })
        final_pct = min(100, int(processed / max(total, 1) * 100)) if total > 0 else 100
        if auto_stopped:
            _upd(task_id, "completed", final_pct,
                 f"Auto-stop ({data.auto_stop_consecutive_frames} frames perdues) : {total_created} annotations sur {processed}/{total} frames")
        elif stopped_early:
            _upd(task_id, "completed", final_pct,
                 f"Arrete : {total_created} annotations creees ({processed}/{total} frames)")
        else:
            _upd(task_id, "completed", 100, f"Termine : {total_created} annotations creees")

    async def _run_safe():
        from backend.services.task_registry import update_task as _upd
        try:
            await _run()
        except Exception as exc:
            _upd(task_id, "error", 0, "", str(exc))

    background_tasks.add_task(_run_safe)

    return {
        "success": True,
        "task_id": task_id,
        "frames_to_process": len(frame_ids_range),
        "targets_count": len(serialized_targets),
        "message": "Tracking guide lance en arriere-plan",
    }


# ---- Status / Debug XFeat / SIFT ----

@router.get("/api/homography/status", response_model=dict)
def homography_status():
    """Retourne la methode de matching active (xfeat ou sift) et les parametres courants."""
    from backend.services.homography_service import homography_service
    return {
        "method": "xfeat" if homography_service._use_xfeat else "sift",
        "defaults": {
            "min_inlier_count": homography_service.min_inlier_count,
            "min_inlier_ratio": homography_service.min_inlier_ratio,
            "ransac_threshold": homography_service.ransac_reproj_threshold,
            "xfeat_top_k": homography_service.xfeat_top_k,
            "xfeat_min_cossim": homography_service.xfeat_min_cossim,
        },
    }


@router.delete("/api/projects/{project_id}/tracks", response_model=dict)
def delete_all_tracks(
    project_id: int,
    session: Session = Depends(get_session),
):
    """Supprime toutes les pistes de tracking d'un projet et detache les annotations associees."""
    tracks = session.exec(
        select(Track).where(Track.project_id == project_id)
    ).all()
    deleted_count = len(tracks)
    for track in tracks:
        # Detacher les annotations (track_id → null plutot que supprimer)
        anns = session.exec(
            select(Annotation).where(Annotation.track_id == track.id)
        ).all()
        for ann in anns:
            ann.track_id = None
            session.add(ann)
        session.delete(track)
    session.commit()
    return {"success": True, "deleted_count": deleted_count}


# ============================================================
# Tracking SAM2 Video (style SAMURAI)
# ============================================================

class Sam2TrackingRequest(BaseModel):
    """Parametres pour le tracking SAM2 video (propagation de masques)."""
    reference_frame_id: int       # Frame source (annotee)
    annotation_ids: List[int]     # Annotations a suivre (leurs boxes servent de prompts SAM2)
    end_frame_id: int             # Frame de fin
    output_mode: str = "bbox"     # 'bbox' | 'segmentation'
    ref_array_index: int = -1
    end_array_index: int = -1
    # 'auto' : SAMURAI si 1 cible, sinon SAM2 multi-objets (1 passe, rapide).
    # 'samurai_per_object' : N passes SAMURAI independantes (filtre de Kalman
    #   par cible) — meilleur suivi MOT, mais N fois plus lent (1 passe/cible).
    tracking_mode: str = "auto"


@router.post("/api/projects/{project_id}/sam2-tracking/run", response_model=dict)
def run_sam2_tracking(
    project_id: int,
    background_tasks: BackgroundTasks,
    data: Sam2TrackingRequest,
    session: Session = Depends(get_session),
):
    """
    Tracking video SAM2 (style SAMURAI) :
    - Utilise les boxes annotees sur la frame de reference comme prompts SAM2
    - Propage les masques sur les frames suivantes
    - Cree des annotations bbox ou polygone selon output_mode

    Necessite le checkpoint SAM2.1 (deja present dans checkpoints/).
    """
    import uuid

    ref_frame = session.get(Frame, data.reference_frame_id)
    end_frame = session.get(Frame, data.end_frame_id)
    if not ref_frame or not end_frame:
        raise HTTPException(status_code=404, detail="Frame introuvable")

    # Propagation INVERSE : demander une frame de fin anterieure a la reference
    # remonte le temps (annoter 500 puis viser 300). SAM2 le gere nativement ;
    # on ordonne toujours la plage par index croissant et on indique juste par
    # ou commencer et dans quel sens parcourir.
    _reverse = end_frame.frame_index < ref_frame.frame_index
    _lo = min(ref_frame.frame_index, end_frame.frame_index)
    _hi = max(ref_frame.frame_index, end_frame.frame_index)
    if _lo == _hi:
        raise HTTPException(
            status_code=400,
            detail="La frame de fin est identique a la frame de reference",
        )

    target_annotations = session.exec(
        select(Annotation)
        .where(Annotation.frame_id == data.reference_frame_id)
        .where(Annotation.id.in_(data.annotation_ids))
    ).all()
    if not target_annotations:
        raise HTTPException(status_code=400, detail="Aucune annotation cible trouvee")

    frames_in_range = session.exec(
        select(Frame)
        .where(Frame.project_id == project_id)
        .where(Frame.frame_index >= _lo)
        .where(Frame.frame_index <= _hi)
        .order_by(Frame.frame_index)
    ).all()
    if not frames_in_range:
        raise HTTPException(status_code=400, detail="Aucune frame dans la plage")

    # Propagation INVERSE : on inverse la PLAGE au lieu de demander a SAM2 de
    # remonter le temps (reverse=True). La reference se retrouve en position 0
    # et la propagation se fait toujours "en avant" sur un tableau qui, lui,
    # descend dans le temps -- resultat identique pour l'utilisateur.
    #
    # Ce n'est pas une preference de style : le mode SAMURAI est INCOMPATIBLE
    # avec reverse=True. Sa selection de banque memoire (sam2_base.py, bloc
    # `if self.samurai_mode`) est ecrite en dur pour la marche avant --
    #
    #     for i in range(frame_idx - 1, 1, -1):
    #         iou_score = output_dict["non_cond_frame_outputs"][i][...]
    #
    # elle suppose que les frames deja suivies portent des indices INFERIEURS a
    # la frame courante, et y accede en indexation directe (pas .get()). En
    # marche arriere on part de l'indice le plus haut : des la 1re frame
    # d'inference, ces indices n'existent pas encore -> KeyError immediat.
    # Verifie sur les logs du 2026-09-04 : 3 runs --reverse, 3 plantages a la
    # 1re frame ; 9 runs en marche avant, 0 plantage. Contourner ici evite de
    # patcher le fork SAMURAI vendorise (backend/ext/samurai_repo), qu'une mise
    # a jour ecraserait.
    if _reverse:
        frames_in_range = list(reversed(frames_in_range))

    serialized_targets = [
        {"id": a.id, "class_id": a.class_id,
         "cx": a.cx, "cy": a.cy, "width": a.width, "height": a.height}
        for a in target_annotations
    ]
    frame_ids_range = [f.id for f in frames_in_range]
    # Position de la reference DANS la plage. La plage etant deja retournee en
    # marche arriere (ci-dessus), c'est toujours 0 : la propagation part de la
    # frame de reference et avance dans le tableau, dans les deux sens reels.
    ref_array_idx_in_range = next(
        (i for i, f in enumerate(frames_in_range) if f.id == ref_frame.id), 0
    )

    # Tracks : si la cible a DÉJÀ une track (assignée manuellement) on la
    # RÉUTILISE (continuité MOT) ; sinon on en crée une nouvelle.
    from backend.utils.color_utils import get_track_color
    # uid numerotes PAR SEQUENCE : sans sequence_id, la piste creee tombait dans
    # la pseudo-sequence legacy et n'apparaissait pas dans la bonne timeline.
    _seq_id = _frame_sequence_id(ref_frame, session)
    next_uid = _next_track_uid(project_id, session, _seq_id)
    track_ids_by_target = {}
    _start = data.ref_array_index if data.ref_array_index >= 0 else ref_frame.frame_index
    _end = data.end_array_index if data.end_array_index >= 0 else end_frame.frame_index
    for ann in target_annotations:
        if ann.track_id:
            existing = session.get(Track, ann.track_id)
            if existing and existing.project_id == project_id:
                existing.start_frame = min(existing.start_frame, _start)
                existing.end_frame = max(existing.end_frame, _start)
                session.add(existing)
                track_ids_by_target[ann.id] = existing.id
                continue
        track = Track(
            project_id=project_id,
            sequence_id=_seq_id,
            track_uid=next_uid,
            class_id=ann.class_id,
            color=get_track_color(next_uid),
            start_frame=_start,
            end_frame=_start,  # grandit frame par frame (voir _write_frame / boucle guidée)
        )
        next_uid += 1
        session.add(track)
        session.flush()
        track_ids_by_target[ann.id] = track.id
        ann.track_id = track.id
        session.add(ann)
    session.commit()

    task_id = str(uuid.uuid4())
    from backend.services.task_registry import create_task
    create_task(task_id, f"SAMURAI/SAM2 tracking sur {len(frame_ids_range)} frames")

    # Serialiser ce dont on a besoin dans le bg task
    _ref_width       = ref_frame.width
    _ref_height      = ref_frame.height
    _project_id      = project_id
    _output_mode     = data.output_mode
    _task_id         = task_id
    _end_array_index = data.end_array_index  # position tableau de la frame de fin
    _tracking_mode   = data.tracking_mode    # 'auto' | 'samurai_per_object'

    # Offload frames CPU : piloté par les paramètres (section Algorithmes).
    # False (défaut) = mode GPU rapide (frames sur le GPU, 1.5–3x plus vite, mais
    # limité par la VRAM ~350–450 frames @1024² sur 10 Go). True = frames en RAM CPU
    # (VRAM mini, robuste GPU modeste / séquences longues).
    from backend.services.settings_service import settings_service as _settings
    try:
        _offload_cpu = bool(_settings.load()["algorithms"].get("sam2_offload_video_to_cpu", False))
    except Exception:
        _offload_cpu = False

    async def _run_sam2():
        from backend.services.task_registry import update_task as _upd, is_stop_requested, append_log
        from backend.services.sam_service import sam_service as sam
        from backend.services.dataset_service import dataset_service
        from backend.database import engine
        from sqlmodel import Session as DBSession
        import cv2 as _cv2
        import asyncio

        import time as _time

        def _log(msg: str):
            append_log(_task_id, msg)

        def _gpu_mem_str() -> str:
            """Résumé VRAM courant (alloué / pic / libre-total du device)."""
            try:
                import torch as _torch
                if not _torch.cuda.is_available():
                    return "cpu (pas de CUDA)"
                alloc = _torch.cuda.memory_allocated() / 1e9
                peak = _torch.cuda.max_memory_allocated() / 1e9
                free, tot = _torch.cuda.mem_get_info()
                return (f"VRAM {alloc:.2f}Go (pic {peak:.2f}Go) — "
                        f"libre {free/1e9:.1f}/{tot/1e9:.1f}Go")
            except Exception:
                return "VRAM n/a"

        _upd(_task_id, "running", 0, "Initialisation SAMURAI/SAM2 video...")

        if not sam._model_loaded or sam._video_predictor is None:
            _log(f"[SAM2Track] {_task_id}: predicteur video indisponible (modele non charge)")
            _upd(_task_id, "error", 0, "", "SAM2 video predictor non disponible (charger le modele SAM2 d'abord)")
            return

        # SAMURAI ne suit qu'UNE cible (Kalman a etat unique). Avec plusieurs
        # cibles → SAM2 multi-objets natif. Reinitialise aussi l'etat Kalman.
        n_targets = len(serialized_targets)
        # Mode par-objet : N passes SAMURAI independantes (Kalman par cible).
        # Ne s'active que si SAMURAI est charge ET plusieurs cibles.
        per_object = (
            _tracking_mode == "samurai_per_object"
            and getattr(sam, "_samurai_loaded", False)
            and n_targets > 1
        )
        if per_object:
            tracker_label = "SAMURAI (par objet)"
        else:
            tracker_label = sam.configure_video_tracking(n_targets)

        # Provenance ecrite en base. SAMURAI et SAM2 video sont deux trackers
        # DISTINCTS (Kalman + selection de masque motion-aware vs memoire seule) :
        # les confondre sous une meme etiquette rendait le monitoring illisible.
        # 'sam2_tracking' reste la valeur historique des runs anterieurs.
        _src_algo = "samurai" if tracker_label.startswith("SAMURAI") else "sam2_video"

        total = len(frame_ids_range)
        # "Commande" synthetique affichee en tete du panneau de logs
        _log(f"$ track --algo {tracker_label} --targets {n_targets} "
             f"--frames {total} --mode {_output_mode} --device {sam.device}"
             f"{' --reverse' if _reverse else ''}")
        if _reverse:
            _log("[SAM2Track] propagation INVERSE : remontee du temps depuis la "
                 "frame de reference vers les frames anterieures")
        _log(f"[SAM2Track] {_task_id}: demarrage {tracker_label} — "
             f"{total} frames, {n_targets} cible(s), mode={_output_mode}")
        # Ligne de config : device + offload CPU + resolution interne du modele.
        # Le resize a image_size (typiquement 1024) est applique a CHAQUE frame.
        _img_size = getattr(
            getattr(sam._video_predictor, "module", sam._video_predictor),
            "image_size", "?")
        _log(f"[SAM2Track] config: device={sam.device}, "
             f"offload_video_to_cpu={_offload_cpu}, image_size={_img_size}, "
             f"async_loading=True — {_gpu_mem_str()}")
        if per_object:
            _log(f"[SAM2Track] mode par-objet : {n_targets} passes SAMURAI "
                 f"independantes (filtre de Kalman par cible, ~{n_targets}x plus lent)")
        elif n_targets > 1 and getattr(sam, "_samurai_loaded", False):
            _log(f"[SAM2Track] {n_targets} cibles -> SAM2 multi-objets "
                 f"(SAMURAI mono-cible desactive pour ce run : Kalman a etat unique)")

        # Construire un repertoire temporaire de frames symlinks ordonnees
        # SAMURAI/SAM2 attend des frames nommees {N}.jpg (entier pur) :
        # load_video_frames_from_jpg_images fait int(os.path.splitext(p)[0])
        # → nommer 000000.jpg, 000001.jpg … et NON frame_000000.jpg
        import tempfile, shutil
        # Le dossier temporaire vit DANS le workspace du projet, pas dans /tmp.
        # Raison : ces JPEG sont exactement ce que le client doit afficher en
        # suivi temps reel (8 bits, LUT deja appliquee, c'est l'image que SAM2
        # consomme). Les servir par leur chemin natif evite une requete HTTP par
        # frame -- mais to_native_share_path() ne sait traduire QUE les chemins sous une
        # racine partagee (home, mnt, ...). Un /tmp/sam2_track_xxx n'est joignable
        # par aucun client SMB ; sous le workspace, si.
        _tmp_parent = dataset_service.get_project_dir(_project_id) / "_tracking_tmp"
        _tmp_parent.mkdir(parents=True, exist_ok=True)
        # Menage des runs precedents interrompus (crash, kill) : sans ca ces
        # dossiers s'accumuleraient dans le workspace, visibles par l'utilisateur.
        for _old in _tmp_parent.glob("sam2_track_*"):
            if _old.is_dir():
                shutil.rmtree(_old, ignore_errors=True)
        tmp_dir = tempfile.mkdtemp(prefix="sam2_track_", dir=str(_tmp_parent))
        session_id = None
        _t_run_start = _time.monotonic()  # duree totale du run (monitoring)

        try:
            # 1) Resolution des sources (rapide, sequentiel en DB).
            # Items : (i, "file", chemin, ext) OU (i, "optional_format", chemin_optional_format, source_frame_index)
            # pour les séquences optional_format importées en on-the-fly (aucun PNG sur disque).
            from backend.models.sequence import Sequence as _Seq
            src_by_index: list[tuple] = []
            _sam_lut = None       # LUT d'affichage de la séquence trackée (None = 3-sigma défaut)
            _lut_resolved = False
            with DBSession(engine) as db:
                proj_obj = db.get(Project, _project_id)
                for i, fid in enumerate(frame_ids_range):
                    frame_obj = db.get(Frame, fid)
                    if not frame_obj:
                        continue
                    if not _lut_resolved:
                        # SAM2/SAMURAI voient la MÊME image 8 bits que l'utilisateur
                        # (LUT séquence→projet bakée dans les JPEG temporaires).
                        _sam_lut = _frame_display_lut(frame_obj, db)
                        _lut_resolved = True
                    resolved_src = _resolve_frame_image_path(_project_id, frame_obj, db)
                    if resolved_src is not None:
                        src_by_index.append((i, "file", str(resolved_src), Path(frame_obj.filename).suffix.lower()))
                        continue
                    # Pas de fichier → optional_format on-the-fly : décoder la frame du .optional
                    optional_format_path = None
                    if frame_obj.sequence_id:
                        sq = db.get(_Seq, frame_obj.sequence_id)
                        if sq and sq.source_path and supports_filename(sq.source_path):
                            optional_format_path = sq.source_path
                    if optional_format_path is None and proj_obj and proj_obj.source_path \
                            and supports_filename(proj_obj.source_path):
                        optional_format_path = proj_obj.source_path
                    if optional_format_path and Path(optional_format_path).exists() and frame_obj.source_frame_index is not None:
                        src_by_index.append((i, "optional_format", optional_format_path, int(frame_obj.source_frame_index)))
                    else:
                        raise FileNotFoundError(f"Frame introuvable pour SAMURAI/SAM2: {frame_obj.filename}")

            # Trace UNIQUE du chemin emprunte par les images du suivi temps reel.
            # Une seule ligne par run (pas par frame) : assez pour savoir apres
            # coup si on etait en lecture native ou en repli HTTP, sans peser sur
            # le log ni sur la boucle de propagation.
            _probe_unc = _to_unc(os.path.join(tmp_dir, "000000.jpg"))
            if _probe_unc and _probe_unc.startswith("\\\\"):
                _transport_msg = (f"[SAM2Track] apercu temps reel : chemin NATIF (SMB) -> {_probe_unc} "
                                  f"-- lecture directe par le client, hors tunnel, 0 requete HTTP par frame")
            elif _probe_unc:
                _transport_msg = (f"[SAM2Track] apercu temps reel : chemin NATIF (disque local) -> {_probe_unc} "
                                  f"-- lecture directe, 0 requete HTTP par frame")
            else:
                _transport_msg = ("[SAM2Track] apercu temps reel : REPLI HTTP (aucun partage ne couvre "
                                  f"{tmp_dir}) -- 2 requetes HTTP par frame affichee")
            # append_log imprime normalement aussi dans stdout, mais stdout est
            # bufferise quand launcher.py est capture par Electron. Cette trace
            # unique doit etre disponible meme si l'app est fermee en plein run.
            append_log(_task_id, _transport_msg, also_print=False)
            print(_transport_msg, flush=True)

            # 2) Conversion PNG→JPEG (ou symlink JPEG) EN PARALLELE : cette phase
            #    (2000+ frames 4K) prenait plusieurs minutes en sequentiel. Les
            #    conversions sont independantes → ThreadPoolExecutor (OpenCV libere
            #    le GIL pendant imread/imwrite, on scale bien sur plusieurs coeurs).
            from concurrent.futures import ThreadPoolExecutor
            from backend.utils.image_utils import load_image_bgr_8bit
            import shutil as _shutil

            # LUT non-défaut (minmax/manual) → il faut la baker même sur les JPEG 8 bits
            # (sinon le symlink direct court-circuiterait le réglage de la séquence).
            _lut_active = bool(_sam_lut) and _sam_lut.get("mode", "sigma") != "sigma"

            def _prepare_one(item):
                i, kind = item[0], item[1]
                dst = os.path.join(tmp_dir, f"{i:06d}.jpg")
                if kind == "optional_format":
                    # optional_format on-the-fly : décodage direct de la frame (seek O(1)) →
                    # BGR 8 bits via la LUT de la séquence (= même image que l'affichage).
                    optional_format_path, src_idx = item[2], item[3]
                    try:
                        img = dataset_service.read_optional_format_frame_bgr(optional_format_path, int(src_idx), _sam_lut)
                        _cv2.imwrite(dst, img, [_cv2.IMWRITE_JPEG_QUALITY, 95])
                    except Exception as e:
                        print(f"[SAM2Track] optional_format decode {optional_format_path}#{src_idx}: {e}")
                    return
                src, ext = item[2], item[3]
                if ext in (".jpg", ".jpeg") and not _lut_active:
                    # JPEG 8 bits + LUT auto (sigma) = identité → symlink rapide.
                    try:
                        os.symlink(os.path.abspath(src), dst)
                    except OSError:
                        _shutil.copy2(src, dst)  # Windows sans Mode Developpeur
                else:
                    try:
                        img = load_image_bgr_8bit(src, _sam_lut)  # LUT séquence (16 bits ou 8 bits réglé)
                        _cv2.imwrite(dst, img, [_cv2.IMWRITE_JPEG_QUALITY, 95])
                    except FileNotFoundError:
                        _shutil.copy2(src, dst)

            n_workers = min(8, (os.cpu_count() or 4))
            done = 0
            # Traitement par lots : permet un stop reactif (on ne soumet pas
            # les 2000+ frames d'un coup, sinon l'arret attendrait toute la file).
            chunk = max(n_workers * 4, 32)
            with ThreadPoolExecutor(max_workers=n_workers) as pool:
                for start in range(0, len(src_by_index), chunk):
                    if is_stop_requested(_task_id):
                        _upd(_task_id, "completed", 100, "Arrete par l'utilisateur (preparation)")
                        print(f"[SAM2Track] {_task_id}: arret pendant la preparation ({done}/{total})")
                        return
                    batch = src_by_index[start:start + chunk]
                    list(pool.map(_prepare_one, batch))
                    done += len(batch)
                    prep_pct = int((done / max(total, 1)) * 4)  # phase 0 → 4 %
                    _upd(_task_id, "running", prep_pct, f"Preparation des frames {done}/{total}...")
                    from backend.services.task_registry import append_progress as _prog
                    _prog(_task_id, "[SAM2Track] etape 1/3 preparation images (disque)", done, total)

            # ---- Ecriture des annotations d'un LOT de frames propagees ----
            # Un seul commit SQLite pour tout le lot au lieu d'un commit par frame :
            # avec des runs de plusieurs centaines/milliers de frames, un commit par
            # frame multiplie les transactions (et le risque d'attente sur le verrou
            # d'ecriture SQLite partage avec les endpoints frontend — session, etc.)
            # sans necessite : l'aperçu temps reel consomme les objets pousses par
            # WebSocket et n'a pas besoin de relire chaque annotation en SQLite.
            # items : liste de (frame_id, VideoPropagationResult)
            # objid_to_target : obj_id (int, >=1) -> {"target": <dict cible>,
            #                    "track_id": <id Track DB | None>}
            def _write_frame_batch(items, objid_to_target):
                created = 0
                track_cache: dict[int, Track] = {}
                with DBSession(engine) as db:
                    for frame_id, prop_result in items:
                        frame_obj = db.get(Frame, frame_id)
                        if not frame_obj:
                            continue
                        frame_has_objects = False
                        for obj_id, mask_result in prop_result.objects.items():
                            tinfo = objid_to_target.get(obj_id)
                            if tinfo is None:
                                continue
                            tgt = tinfo["target"]
                            track_db_id = tinfo["track_id"]
                            # Etendre les bornes jusqu'à la frame RÉELLEMENT propagée (index
                            # global), pas jusqu'à la fin demandée : un arrêt au milieu ne
                            # doit colorer le track que sur la zone explorée.
                            # min ET max : en propagation INVERSE les frames ecrites ont un
                            # index DECROISSANT a partir de la reference. Ne bouger que
                            # end_frame laissait alors la barre de timeline reduite a la
                            # seule frame de reference, alors que les annotations, elles,
                            # etaient bien ecrites sur toute la plage remontee.
                            if track_db_id:
                                track_obj = track_cache.get(track_db_id)
                                if track_obj is None:
                                    track_obj = db.get(Track, track_db_id)
                                    if track_obj:
                                        track_cache[track_db_id] = track_obj
                                if track_obj:
                                    track_obj.start_frame = min(track_obj.start_frame, frame_obj.frame_index)
                                    track_obj.end_frame = max(track_obj.end_frame, frame_obj.frame_index)
                                    db.add(track_obj)
                            if _output_mode == "segmentation" and mask_result.polygon:
                                import json as _json
                                new_ann = Annotation(
                                    frame_id=frame_id, class_id=tgt["class_id"],
                                    annotation_type=AnnotationType.POLYGON,
                                    cx=mask_result.bbox_yolo[0], cy=mask_result.bbox_yolo[1],
                                    width=mask_result.bbox_yolo[2], height=mask_result.bbox_yolo[3],
                                    points=_json.dumps(mask_result.polygon),
                                    confidence=mask_result.score, is_auto=True,
                                    source_algorithm=_src_algo, track_id=track_db_id,
                                )
                            else:
                                new_ann = Annotation(
                                    frame_id=frame_id, class_id=tgt["class_id"],
                                    annotation_type=AnnotationType.BBOX,
                                    cx=mask_result.bbox_yolo[0], cy=mask_result.bbox_yolo[1],
                                    width=mask_result.bbox_yolo[2], height=mask_result.bbox_yolo[3],
                                    confidence=mask_result.score, is_auto=True,
                                    source_algorithm=_src_algo, track_id=track_db_id,
                                )
                            db.add(new_ann)
                            created += 1
                            frame_has_objects = True
                        if frame_has_objects:
                            frame_obj.is_annotated = True
                            db.add(frame_obj)
                    db.commit()
                return created

            def _json_polygon(poly):
                if not poly:
                    return None
                return [[float(x), float(y)] for x, y in poly]

            # ---- Une passe de propagation sur une session video ----
            # Emet la progression dans la bande [prog_lo, prog_hi] (%).
            async def _run_pass(pass_session_id, objid_to_target, prog_lo, prog_hi):
                created_here = 0
                seen = 0
                t_start = _time.monotonic()
                _loop = asyncio.get_event_loop()
                # Lot de frames en attente d'ecriture DB — voir _write_frame_batch.
                # current_frame_id (navigation temps reel optionnelle) est mis a jour
                # PAR FRAME (juste un dict en memoire, gratuit) ; les annotations,
                # elles, n'apparaissent en base qu'au flush du lot (retard de quelques
                # frames au plus si le suivi temps reel est active).
                _WRITE_BATCH = 10
                pending: list[tuple[int, object]] = []

                async def _flush():
                    nonlocal created_here, pending
                    if not pending:
                        return
                    batch, pending = pending, []
                    created_here += await _loop.run_in_executor(
                        None, _write_frame_batch, batch, objid_to_target)

                # should_stop est consulte PAR LE WORKER avant chaque frame : c'est
                # le seul arret propre. Un simple `break` ici laisserait le thread
                # GPU tourner sur un inference_state qu'on libere juste apres.
                # aclosing : garantit que le nettoyage du generateur (arret du
                # worker) tourne TOUT DE SUITE en cas de break, sans attendre le GC.
                from contextlib import aclosing
                async with aclosing(sam.propagate_video(
                    pass_session_id, _ref_width, _ref_height,
                    should_stop=lambda: is_stop_requested(_task_id),
                    need_polygon=(_output_mode == "segmentation"),
                    # Toujours False : le sens est deja porte par l'ordre du
                    # tableau de frames (cf. `if _reverse` plus haut). SAMURAI
                    # ne sait pas tracker en reverse=True.
                    reverse=False,
                    start_frame_idx=ref_array_idx_in_range,
                )) as _stream:
                    async for prop_result in _stream:
                        seen += 1
                        fi = prop_result.frame_index  # index dans le tableau
                        if fi == ref_array_idx_in_range:
                            continue  # sauter la frame de ref (deja annotee)
                        if fi < 0 or fi >= len(frame_ids_range):
                            break
                        frame_id = frame_ids_range[fi]
                        # Progression = distance parcourue depuis la reference,
                        # valable dans les deux sens de propagation.
                        done_frames = abs(fi - ref_array_idx_in_range)
                        pct = int(prog_lo + (prog_hi - prog_lo) * (done_frames / max(total, 1)))
                        pending.append((frame_id, prop_result))
                        if len(pending) >= _WRITE_BATCH:
                            # Ecriture DB DANS LE THREADPOOL, jamais sur l'event loop :
                            # sinon chaque lot bloquerait la boucle le temps du commit
                            # → requetes status/navigation/stop mises en attente.
                            await _flush()
                        if seen % 25 == 0:
                            elapsed = _time.monotonic() - t_start
                            fps = seen / elapsed if elapsed > 0 else 0.0
                            from backend.services.task_registry import append_progress as _prog
                            _prog(_task_id, "[SAM2Track] etape 3/3 propagation GPU",
                                  done_frames, total, fps,
                                  f"{len(prop_result.objects)} masque(s)/frame, "
                                  f"{created_here} annotations ecrites — {_gpu_mem_str()}")
                        # Apercu leger pousse via WS (/ws/tasks/{id}) : le frontend peut
                        # afficher CETTE frame sans attendre le prochain flush du lot DB
                        # (_write_frame_batch commit toutes les _WRITE_BATCH frames, donc
                        # potentiellement pas encore en base au moment ou l'utilisateur
                        # navigue dessus en suivi temps reel).
                        # Chemin natif de CETTE frame, deja ecrit par la phase de
                        # preparation : c'est le JPEG 8 bits LUT appliquee que SAM2
                        # vient de consommer, donc rien a re-encoder. Le client
                        # Electron le lit directement (fs.readFile via SMB) au lieu
                        # de faire un GET /image-path puis un GET /image : deux
                        # requetes HTTP economisees par frame, et surtout aucun des
                        # 6 creneaux de connexion par origine consomme -- c'est ce
                        # qui entrait en concurrence avec les requetes vitales
                        # (stop, annotations) pendant une propagation sous SSH.
                        # None si aucun partage ne couvre ce chemin : le client
                        # retombe alors sur son comportement HTTP habituel.
                        live_frame = {
                            "frame_id": int(frame_id),
                            "native_path": _to_unc(os.path.join(tmp_dir, f"{fi:06d}.jpg")),
                            "objects": [
                                {
                                    "class_id": int(objid_to_target[obj_id]["target"]["class_id"]),
                                    "bbox": [float(v) for v in mask_result.bbox_yolo],
                                    "polygon": _json_polygon(mask_result.polygon),
                                    "score": float(mask_result.score or 0.0),
                                }
                                for obj_id, mask_result in prop_result.objects.items()
                                if obj_id in objid_to_target
                            ],
                        }
                        _upd(_task_id, "running", pct,
                             f"Frame {done_frames}/{total} — {len(prop_result.objects)} masque(s)",
                             current_frame_id=frame_id, live_frame=live_frame)
                        await asyncio.sleep(0)
                # Dernier lot partiel (fin normale, stop, ou arret sur bornes de plage).
                await _flush()
                return created_here

            total_created = 0

            if per_object:
                # N passes SAMURAI independantes : une session + un filtre de
                # Kalman par cible. Le repertoire de frames (tmp_dir) est partage,
                # seule la session video est re-initialisee entre les cibles.
                for j, tgt in enumerate(serialized_targets):
                    if is_stop_requested(_task_id):
                        break
                    sam.configure_video_tracking(1)  # SAMURAI + reset du Kalman
                    prog_lo = 5 + (95 * j) // n_targets
                    prog_hi = 5 + (95 * (j + 1)) // n_targets
                    _upd(_task_id, "running", prog_lo,
                         f"SAMURAI cible {j + 1}/{n_targets} — ouverture session...")
                    _log(f"[SAM2Track] === cible {j + 1}/{n_targets} (annotation #{tgt['id']}) ===")
                    session_id = await sam.init_video_session(
                        tmp_dir, total, async_loading=True, offload_video_to_cpu=_offload_cpu)
                    cx, cy, w, h = tgt["cx"], tgt["cy"], tgt["width"], tgt["height"]
                    box_norm = (cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2)
                    await sam.add_video_prompt(
                        session_id=session_id, frame_index=ref_array_idx_in_range,
                        object_id=1, points=[], labels=[],
                        image_width=_ref_width, image_height=_ref_height, box=box_norm,
                    )
                    objid_to_target = {1: {"target": tgt,
                                           "track_id": track_ids_by_target.get(tgt["id"])}}
                    total_created += await _run_pass(session_id, objid_to_target, prog_lo, prog_hi)
                    try:
                        sam.close_video_session(session_id)
                    except Exception:
                        pass
                    session_id = None
            else:
                # 1 passe : SAMURAI (1 cible) ou SAM2 multi-objets natif.
                # async_loading=True → propagation quasi immediate.
                _upd(_task_id, "running", 4, f"Ouverture de la session {tracker_label} ({total} frames)...")
                _log(f"[SAM2Track] etape 2/3 ouverture session video ({total} frames, "
                     f"decodage JPEG->tenseurs en tache de fond)...")
                session_id = await sam.init_video_session(
                    tmp_dir, total, async_loading=True, offload_video_to_cpu=_offload_cpu)
                _log(f"[SAM2Track] session video prete ({session_id})")
                if is_stop_requested(_task_id):
                    _upd(_task_id, "completed", 100, "Arrete par l'utilisateur (avant propagation)")
                    return

                # BOX-prompts (la box englobante est le prompt attendu par SAMURAI).
                _upd(_task_id, "running", 2, f"Prompts {tracker_label} sur frame de reference...")
                objid_to_target = {}
                for i, tgt in enumerate(serialized_targets):
                    cx, cy, w, h = tgt["cx"], tgt["cy"], tgt["width"], tgt["height"]
                    box_norm = (cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2)
                    await sam.add_video_prompt(
                        session_id=session_id, frame_index=ref_array_idx_in_range,
                        object_id=i + 1, points=[], labels=[],
                        image_width=_ref_width, image_height=_ref_height, box=box_norm,
                    )
                    objid_to_target[i + 1] = {"target": tgt,
                                              "track_id": track_ids_by_target.get(tgt["id"])}
                    _log(f"[SAM2Track] prompt box cible {i + 1}/{n_targets} = "
                         f"({box_norm[0]:.3f}, {box_norm[1]:.3f}, {box_norm[2]:.3f}, {box_norm[3]:.3f})")

                _upd(_task_id, "running", 5, f"Propagation {tracker_label} sur {total} frames...")
                _log(f"[SAM2Track] propagation demarree sur {total} frames...")
                total_created += await _run_pass(session_id, objid_to_target, 5, 100)

            _stopped = is_stop_requested(_task_id)
            if _stopped:
                _log(f"[SAM2Track] arrete par l'utilisateur — {total_created} annotations conservees")
                _upd(_task_id, "completed", 100,
                     f"Arrete : {total_created} annotations conservees")
            else:
                _log(f"[SAM2Track] termine — {total_created} annotations ecrites en base")
                _upd(_task_id, "completed", 100, f"Termine : {total_created} annotations creees")

            from backend.services.monitoring_service import record_run
            record_run(algorithm=tracker_label, project_id=_project_id, frames=total,
                       created=total_created, duration_s=_time.monotonic() - _t_run_start,
                       mode=_output_mode, targets=n_targets, stopped=_stopped)

        finally:
            # Fermer la session video (libere la VRAM — sinon fuite GPU a chaque run)
            try:
                if session_id:
                    sam.close_video_session(session_id)
            except Exception:
                pass
            # Nettoyage du repertoire temporaire
            shutil.rmtree(tmp_dir, ignore_errors=True)

    async def _run_safe():
        from backend.services.task_registry import update_task as _upd, append_log
        try:
            await _run_sam2()
        except Exception as exc:
            import sys
            import traceback
            append_log(task_id, f"[SAM2Track] ERREUR — {exc}")
            # format_exc + UNE seule ecriture flushee, jamais print_exc() : la
            # propagation tourne pendant que tqdm ecrit sa barre sur le meme
            # stderr avec des "\r". Les lignes du traceback, emises une par une
            # et sans flush, se faisaient ecraser -- le log ne gardait que
            # "Traceback (most recent call last):" suivi de rien, ce qui rend
            # une erreur de propagation impossible a diagnostiquer apres coup.
            for line in traceback.format_exc().splitlines():
                append_log(task_id, f"[SAM2Track] {line}")
            sys.stderr.write("\n" + traceback.format_exc() + "\n")
            sys.stderr.flush()
            _upd(task_id, "error", 0, "", str(exc))

    background_tasks.add_task(_run_safe)

    return {
        "success": True,
        "task_id": task_id,
        "frames_to_process": len(frame_ids_range),
        "targets_count": len(serialized_targets),
        "message": "SAMURAI/SAM2 video tracking lance en arriere-plan",
    }


@router.get("/api/samurai/status", response_model=dict)
def samurai_status():
    """Retourne si SAMURAI est disponible comme prédicteur vidéo.
    SAMURAI = fork de SAM2 avec filtre de Kalman, repo cloné dans backend/ext/samurai_repo/sam2.
    Installé via : pip install -e backend/ext/samurai_repo/sam2
    Détection : présence du dossier ext/samurai_repo + _samurai_loaded=True sur le service.
    """
    from pathlib import Path
    from backend.services.sam_service import sam_service as sam, _SAMURAI_AVAILABLE
    # SAMURAI est "installé" si le repo est cloné localement
    samurai_installed = _SAMURAI_AVAILABLE

    # ---- Info GPU / VRAM (robuste Windows ET Linux via torch.cuda.mem_get_info) ----
    # mem_get_info() renvoie (free, total) en octets pour le device courant ; pas de
    # dépendance à nvidia-smi ni au parsing texte → identique sur les deux OS.
    gpu: dict = {
        "cuda": False, "name": None,
        "vram_total_gb": None, "vram_free_gb": None, "vram_used_gb": None,
        "image_size": None, "bytes_per_frame": None, "est_max_frames_gpu": None,
    }
    try:
        import torch
        if torch.cuda.is_available():
            dev = torch.cuda.current_device()
            free_b, total_b = torch.cuda.mem_get_info(dev)
            img_size = int(getattr(
                getattr(sam._video_predictor, "module", sam._video_predictor),
                "image_size", 1024) or 1024) if sam._video_predictor is not None else 1024
            # Frame stockée par SAM2 : (3, S, S) float32 = S*S*3*4 octets.
            bytes_per_frame = img_size * img_size * 3 * 4
            # 85% de la VRAM libre pour les frames (réserve pour memory-bank +
            # activations qui croissent pendant la propagation). Offload OFF.
            est = int((free_b * 0.85) / bytes_per_frame) if bytes_per_frame else 0
            gpu.update({
                "cuda": True,
                "name": torch.cuda.get_device_name(dev),
                "vram_total_gb": round(total_b / 1e9, 2),
                "vram_free_gb": round(free_b / 1e9, 2),
                "vram_used_gb": round((total_b - free_b) / 1e9, 2),
                "image_size": img_size,
                "bytes_per_frame": bytes_per_frame,
                "est_max_frames_gpu": max(est, 0),
            })
    except Exception:
        pass  # pas de CUDA / torch indisponible → gpu.cuda reste False

    return {
        "installed": samurai_installed,
        "loaded": getattr(sam, "_samurai_loaded", False),
        "sam_loaded": sam._model_loaded,
        "device": sam.device,
        "gpu": gpu,
    }


@router.get("/api/projects/{project_id}/homography/debug", response_model=dict)
def debug_homography(
    project_id: int,
    frame_a_id: int,
    frame_b_id: int,
    session: Session = Depends(get_session),
):
    """
    Retourne les informations de debug de l'homographie entre deux frames :
    methode utilisee, nb keypoints, matches, inliers, ratio, et visualisation base64.
    Utile pour evaluer la qualite du matching XFeat / SIFT entre deux frames consecutives.
    """
    import cv2
    from backend.services.homography_service import homography_service
    from backend.services.dataset_service import dataset_service

    frame_a = session.get(Frame, frame_a_id)
    frame_b = session.get(Frame, frame_b_id)

    if not frame_a or not frame_b:
        raise HTTPException(status_code=404, detail="Frame introuvable")

    img_a_path = dataset_service.get_frame_path(project_id, frame_a.filename)
    img_b_path = dataset_service.get_frame_path(project_id, frame_b.filename)

    from backend.utils.image_utils import load_image_bgr_8bit
    try:
        img_a = load_image_bgr_8bit(str(img_a_path))
        img_b = load_image_bgr_8bit(str(img_b_path))
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Images introuvables sur le disque")

    debug_info = homography_service.compute_homography_debug(img_a, img_b)
    debug_info["frame_a_index"] = frame_a.frame_index
    debug_info["frame_b_index"] = frame_b.frame_index

    return debug_info
