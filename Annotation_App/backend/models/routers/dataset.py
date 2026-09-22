# ============================================================
# routers/dataset.py
# Endpoints pour l'import de datasets (images et vidéos),
# la navigation dans les frames, et le service des fichiers media.
# Préfixe : /api/projects/{id} et /api/frames
# ============================================================

import io
import os
import tempfile
import threading
import uuid
from collections import OrderedDict
from pathlib import Path
from typing import List, Optional

import cv2
import numpy as np
from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response
from sqlalchemy import func
from sqlmodel import Session, select

from backend.database import get_session
from backend.models.annotation import Annotation
from backend.models.frame import Frame
from backend.models.project import Project
from backend.models.sequence import Sequence
from backend.services.dataset_service import dataset_service
from backend.services.dataset_service import IMAGE_EXTENSIONS
from backend.services.format_registry import preferred_extension, supports_filename
from backend.utils.image_utils import get_image_dimensions

router = APIRouter(tags=["Dataset"])
_FRAME_REPAIR_LOCK = threading.Lock()


# ---- Import d'annotations existantes (.ver / YOLO) sur une séquence (S9) ----

from pydantic import BaseModel as _BaseModel


class ImportAnnotationsRequest(_BaseModel):
    path: str
    format: str = "auto"        # auto | ver | yolo
    replace: bool = False       # True = remplace les annotations existantes de la séquence


class ManifestPathRequest(_BaseModel):
    path: str


@router.post("/api/sequences/parse-manifest", response_model=dict)
def parse_sequence_manifest(data: ManifestPathRequest):
    """Lit un .txt de manifeste de séquences côté serveur (une ligne
    « source_path<TAB>nom », ou séparée par espace) et retourne les entrées pour
    pré-remplir l'import. Généré par le backup (step3b) → récupération de projet."""
    p = Path(data.path)
    if not p.exists() or not p.is_file():
        raise HTTPException(400, f"Fichier introuvable : {data.path}")
    rows = []
    for raw in p.read_text(encoding="utf-8", errors="replace").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if "\t" in line:
            src, name = line.split("\t", 1)
        elif " " in line:
            src, name = line.rsplit(" ", 1)
        else:
            src, name = line, ""
        rows.append({"source_path": src.strip(), "name": name.strip()})
    return {"sequences": rows}


def _get_or_create_class(session, project_id, name, subclass=None, subsubclass=None):
    """Trouve/crée une LabelClass par (name, subclass, subsubclass)."""
    from backend.models.label_class import LabelClass
    q = select(LabelClass).where(LabelClass.project_id == project_id).where(LabelClass.name == name)
    for c in session.exec(q).all():
        if (c.subclass or None) == (subclass or None) and (c.subsubclass or None) == (subsubclass or None):
            return c
    from backend.utils.color_utils import get_track_color
    max_idx = session.exec(
        select(func.max(LabelClass.class_index)).where(LabelClass.project_id == project_id)
    ).one()
    idx = (int(max_idx) + 1) if max_idx is not None else 0
    c = LabelClass(project_id=project_id, name=name, subclass=subclass, subsubclass=subsubclass,
                   class_index=idx, color=get_track_color(idx))
    session.add(c); session.flush()
    return c


def _get_or_create_class_by_index(session, project_id, class_index, names_map):
    from backend.models.label_class import LabelClass
    c = session.exec(
        select(LabelClass).where(LabelClass.project_id == project_id).where(LabelClass.class_index == class_index)
    ).first()
    if c:
        return c
    name = names_map.get(class_index, f"classe_{class_index}")
    from backend.utils.color_utils import get_track_color
    c = LabelClass(project_id=project_id, name=name, class_index=class_index, color=get_track_color(class_index))
    session.add(c); session.flush()
    return c


def _get_or_create_track(session, project_id, sequence_id, track_uid, class_id):
    """Trouve/crée une Track (sequence, uid) — décorrélation par séquence."""
    from backend.models.track import Track
    q = (select(Track).where(Track.project_id == project_id)
         .where(Track.track_uid == track_uid))
    if sequence_id is None:
        q = q.where(Track.sequence_id.is_(None))
    else:
        q = q.where(Track.sequence_id == sequence_id)
    t = session.exec(q).first()
    if t:
        return t
    from backend.utils.color_utils import get_track_color
    t = Track(project_id=project_id, sequence_id=sequence_id, track_uid=track_uid,
              class_id=class_id, color=get_track_color(track_uid), start_frame=0, end_frame=0)
    session.add(t); session.flush()
    return t


@router.post("/api/projects/{project_id}/sequences/{sequence_id}/import-annotations", response_model=dict)
def import_sequence_annotations(
    project_id: int,
    sequence_id: int,
    data: ImportAnnotationsRequest,
    session: Session = Depends(get_session),
):
    """Importe des annotations .ver / YOLO sur une séquence (S9). Convertit vers le
    format interne (YOLO normalisé), crée classes/tracks manquants, et associe les
    détections aux frames de la séquence (.ver : frame 1-based ; YOLO : par stem sinon
    par ordre). `replace` remplace les annotations existantes de la séquence."""
    from backend.models.annotation import Annotation, AnnotationType
    from backend.models.track import Track
    from backend.services import annotation_import_service as imp

    project = session.get(Project, project_id)
    seq = session.get(Sequence, sequence_id)
    if not project or not seq or seq.project_id != project_id:
        raise HTTPException(404, "Projet ou séquence introuvable")
    if not Path(data.path).exists():
        raise HTTPException(400, f"Chemin introuvable : {data.path}")

    frames = session.exec(
        select(Frame).where(Frame.project_id == project_id)
        .where(Frame.sequence_id == sequence_id).order_by(Frame.frame_index)
    ).all()
    if not frames:
        raise HTTPException(400, "La séquence n'a aucune frame")

    fmt = data.format if data.format in ("ver", "yolo") else imp.detect_format(data.path)

    created, affected = _do_import_annotations(
        session, project_id, sequence_id, frames, data.path, fmt, data.replace)
    return {"success": True, "format": fmt, "annotations_created": created,
            "frames_annotated": len(affected)}


def _do_import_annotations(session, project_id, sequence_id, frames, src_path, fmt, replace):
    """Cœur d'import (.ver / YOLO) partagé par l'endpoint chemin-serveur ET l'endpoint
    upload. `src_path` = fichier .ver ou dossier YOLO. Crée classes/tracks manquants,
    associe les détections aux frames de la séquence, recale les bornes des tracks.
    Retourne (nb_annotations_créées, set des frame_id touchées)."""
    from backend.models.annotation import Annotation, AnnotationType
    from backend.models.track import Track
    from backend.services import annotation_import_service as imp

    if replace:
        fids = [f.id for f in frames]
        if fids:
            for a in session.exec(select(Annotation).where(Annotation.frame_id.in_(fids))).all():
                session.delete(a)
            session.flush()

    created = 0
    affected_frames: set = set()

    if fmt == "ver":
        for det in imp.parse_ver(src_path):
            idx0 = det["frame_1b"] - 1
            if idx0 < 0 or idx0 >= len(frames):
                continue
            frame = frames[idx0]
            # .ver normalisé [0,1] (nouveau format) → w=h=1 (les coins sont déjà
            # normalisés) ; .ver pixels (ancien) → division par la taille de frame.
            _nw = 1 if det.get("normalized") else frame.width
            _nh = 1 if det.get("normalized") else frame.height
            cx, cy, bw, bh = imp._to_norm(det["x1"], det["y1"], det["x2"], det["y2"], _nw, _nh)
            cls = _get_or_create_class(session, project_id, det["name"], det["subclass"], det["subsubclass"])
            track_id = None
            if det["track_id"] is not None and det["track_id"] >= 0:
                tr = _get_or_create_track(session, project_id, sequence_id, det["track_id"], cls.id)
                track_id = tr.id
            session.add(Annotation(
                frame_id=frame.id, class_id=cls.id, annotation_type=AnnotationType.BBOX,
                cx=cx, cy=cy, width=bw, height=bh, track_id=track_id, is_auto=True,
                source_algorithm="imported",
            ))
            created += 1
            affected_frames.add(frame.id)
    else:  # yolo
        per_stem, names = imp.parse_yolo_folder(src_path)
        # Correspondance par stem de fichier, sinon par ordre (i-ème .txt ↔ i-ème frame)
        by_stem = {Path(f.filename).stem: f for f in frames}
        stems = list(per_stem.keys())
        matched_by_stem = sum(1 for s in stems if s in by_stem)
        use_order = matched_by_stem < max(1, len(stems)) // 2  # peu de correspondances → ordre
        for i, (stem, dets) in enumerate(sorted(per_stem.items())):
            frame = (frames[i] if use_order and i < len(frames) else by_stem.get(stem))
            if frame is None:
                continue
            for d in dets:
                cls = _get_or_create_class_by_index(session, project_id, d["class_index"], names)
                session.add(Annotation(
                    frame_id=frame.id, class_id=cls.id, annotation_type=AnnotationType.BBOX,
                    cx=d["cx"], cy=d["cy"], width=d["w"], height=d["h"], is_auto=True,
                    source_algorithm="imported",
                ))
                created += 1
                affected_frames.add(frame.id)

    # Marquer les frames touchées comme annotées + recaler les bornes des tracks
    for fid in affected_frames:
        fr = session.get(Frame, fid)
        if fr:
            fr.is_annotated = True
    # Bornes des tracks importés (start/end = min/max frame_index de leurs annotations)
    for tr in session.exec(select(Track).where(Track.sequence_id == sequence_id)).all():
        rows = session.exec(
            select(Frame.frame_index).join(Annotation, Annotation.frame_id == Frame.id)
            .where(Annotation.track_id == tr.id)
        ).all()
        if rows:
            tr.start_frame, tr.end_frame = min(rows), max(rows)
    session.commit()

    return created, affected_frames


@router.post("/api/projects/{project_id}/sequences/{sequence_id}/import-annotations-upload", response_model=dict)
async def import_sequence_annotations_upload(
    project_id: int,
    sequence_id: int,
    files: List[UploadFile] = File(...),
    replace: bool = Form(False),
    session: Session = Depends(get_session),
):
    """Variante UPLOAD de l'import d'annotations (drag & drop navigateur) : reçoit
    un ou plusieurs fichiers (un .ver, OU un dossier YOLO de .txt + data.yaml), les
    écrit dans un dossier temporaire serveur, puis réutilise _do_import_annotations.
    Le format est auto-détecté d'après les extensions reçues."""
    from backend.services import annotation_import_service as imp

    project = session.get(Project, project_id)
    seq = session.get(Sequence, sequence_id)
    if not project or not seq or seq.project_id != project_id:
        raise HTTPException(404, "Projet ou séquence introuvable")
    if not files:
        raise HTTPException(400, "Aucun fichier reçu")

    frames = session.exec(
        select(Frame).where(Frame.project_id == project_id)
        .where(Frame.sequence_id == sequence_id).order_by(Frame.frame_index)
    ).all()
    if not frames:
        raise HTTPException(400, "La séquence n'a aucune frame")

    tmp_dir = tempfile.mkdtemp(prefix="annot_import_")
    try:
        saved: list[str] = []
        for uf in files:
            # basename seul (le navigateur peut envoyer un chemin relatif de dossier)
            base = os.path.basename((uf.filename or "annot").replace("\\", "/"))
            if not base:
                continue
            dst = os.path.join(tmp_dir, base)
            with open(dst, "wb") as fh:
                fh.write(await uf.read())
            saved.append(dst)

        if not saved:
            raise HTTPException(400, "Fichiers vides ou invalides")

        # Détection du format : un .ver → ver ; sinon dossier YOLO (.txt)
        ver_files = [p for p in saved if p.lower().endswith(".ver")]
        if ver_files:
            fmt = "ver"
            src_path = ver_files[0]
        else:
            fmt = "yolo"
            src_path = tmp_dir

        created, affected = _do_import_annotations(
            session, project_id, sequence_id, frames, src_path, fmt, replace)
        return {"success": True, "format": fmt, "annotations_created": created,
                "frames_annotated": len(affected)}
    finally:
        import shutil as _sh
        _sh.rmtree(tmp_dir, ignore_errors=True)


# ---- Multi-séquence : helpers ----

def datetime_now_label() -> str:
    """Horodatage court pour nommer les imports sans nom naturel."""
    from datetime import datetime
    return datetime.now().strftime("%Y%m%d_%H%M%S")

def _create_sequence(
    session: Session,
    project_id: int,
    name: str,
    source_type: str,
    source_path: Optional[str],
    start_index: int,
    frame_count: int = 0,
    fps: Optional[float] = None,
) -> Sequence:
    """Crée l'enregistrement Sequence d'un import (une séquence = une source)."""
    seq = Sequence(
        project_id=project_id,
        name=name,
        source_type=source_type,
        source_path=source_path,
        start_index=start_index,
        frame_count=frame_count,
        fps=fps,
    )
    session.add(seq)
    session.flush()   # obtient seq.id avant commit (préfixe de fichiers)
    return seq


def _seq_prefix(seq: Sequence) -> str:
    """Préfixe de nom de fichier unique par séquence : s003_frame_000000.jpg."""
    return f"s{seq.id:03d}_"


def _resolve_sequence_source(session: Session, frame: Frame, project: Project) -> Optional[Path]:
    """Chemin source (vidéo/optional_format) d'une frame : séquence si connue, sinon projet."""
    if frame.sequence_id:
        seq = session.get(Sequence, frame.sequence_id)
        if seq and seq.source_path:
            p = Path(seq.source_path)
            if p.exists():
                return p
    if project.source_path:
        p = Path(project.source_path)
        if p.exists():
            return p
    return None


def _probe_project_image_size(project_id: int, filename: str, fallback: tuple[int, int]) -> tuple[int, int]:
    try:
        return get_image_dimensions(str(dataset_service.get_frame_path(project_id, filename)))
    except Exception:
        return fallback


def _repair_project_frame_records(project: Project, session: Session) -> None:
    """
    Repare les imports dossier interrompus par l'ancien batch commit.
    Les fichiers etaient presents sur disque, mais seules les frames 99,199,...
    etaient enregistrees en base. Cette routine ajoute les lignes manquantes.
    """
    db_count = session.exec(
        select(func.count(Frame.id)).where(Frame.project_id == project.id)
    ).one()
    if int(db_count or 0) == project.frame_count and project.frame_count > 0:
        return

    # Multi-séquence : ne jamais réparer si le projet contient des séquences
    # vidéo/optional_format — leurs frames lazy ne sont pas (toutes) sur disque, la
    # réparation par scan du dossier frames casserait les index.
    has_lazy_seq = session.exec(
        select(Sequence.id)
        .where(Sequence.project_id == project.id)
        .where(Sequence.source_type.in_(("video", "optional_format")))  # type: ignore[attr-defined]
        .limit(1)
    ).first()
    if has_lazy_seq:
        return

    with _FRAME_REPAIR_LOCK:
        db_count = session.exec(
            select(func.count(Frame.id)).where(Frame.project_id == project.id)
        ).one()
        if int(db_count or 0) == project.frame_count and project.frame_count > 0:
            return

        frames_dir = dataset_service.get_frames_dir(project.id)
        if not frames_dir.exists():
            return

        files = sorted(
            f for f in frames_dir.iterdir()
            if f.is_file() and f.suffix.lower() in IMAGE_EXTENSIONS
        )
        if not files:
            return

        existing = session.exec(
            select(Frame).where(Frame.project_id == project.id).order_by(Frame.frame_index, Frame.id)
        ).all()

        by_filename: dict[str, list[Frame]] = {}
        for frame in existing:
            by_filename.setdefault(frame.filename, []).append(frame)

        removed = 0
        existing_by_filename: dict[str, Frame] = {}
        for filename, duplicates in by_filename.items():
            keep = sorted(
                duplicates,
                key=lambda frame: (not frame.is_annotated, frame.id or 0),
            )[0]
            existing_by_filename[filename] = keep
            for frame in duplicates:
                if frame.id != keep.id:
                    session.delete(frame)
                    removed += 1

        if removed:
            session.commit()
            existing = session.exec(
                select(Frame).where(Frame.project_id == project.id).order_by(Frame.frame_index, Frame.id)
            ).all()
            existing_by_filename = {frame.filename: frame for frame in existing}

        if len(existing_by_filename) >= len(files) and project.frame_count == len(files):
            return

        known_size = next(
            ((frame.width, frame.height) for frame in existing_by_filename.values() if frame.width and frame.height),
            (0, 0),
        )
        if known_size == (0, 0):
            known_size = _probe_project_image_size(project.id, files[0].name, (640, 480))

        added = 0
        for index, path in enumerate(files):
            if path.name in existing_by_filename:
                frame = existing_by_filename[path.name]
                if frame.frame_index != index:
                    frame.frame_index = index
                    session.add(frame)
                continue

            width, height = known_size
            if width <= 0 or height <= 0:
                width, height = _probe_project_image_size(project.id, path.name, (640, 480))

            session.add(Frame(
                project_id=project.id,
                frame_index=index,
                filename=path.name,
                thumbnail_path=dataset_service.get_thumbnail_path(project.id, path.name).name,
                width=width,
                height=height,
                timestamp_ms=None,
                is_extracted=True,
            ))
            added += 1

        if project.frame_count != len(files):
            project.frame_count = len(files)
            session.add(project)

        if added or removed or len(existing_by_filename) != len(files):
            session.commit()
            print(
                f"[dataset] Projet {project.id} repare : "
                f"{added} frame(s) ajoutee(s), {removed} doublon(s) retires, total={len(files)}"
            )


# ---- Import d'images ----

@router.post("/api/projects/{project_id}/import/images", response_model=dict)
async def import_images(
    project_id: int,
    files: List[UploadFile] = File(...),
    sequence_name: str = Form(""),  # nom de séquence (défaut = images_horodatage)
    session: Session = Depends(get_session),
):
    """
    Importe des images dans le projet via upload multipart.
    Génère les miniatures et crée les entrées en base de données.
    Supporte : .jpg, .jpeg, .png, .bmp, .tiff, .webp

    Les fichiers sont sauvegardés dans data/projects/{project_id}/frames/
    """
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Projet introuvable")

    # Sauvegarde des fichiers uploadés dans un dossier temporaire
    temp_dir = tempfile.mkdtemp()
    temp_paths = []

    try:
        for upload in files:
            # Filtrage par extension
            ext = Path(upload.filename or "").suffix.lower()
            if ext not in {".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".tif", ".webp"}:
                continue

            temp_path = os.path.join(temp_dir, upload.filename)
            content = await upload.read()
            with open(temp_path, "wb") as f:
                f.write(content)
            temp_paths.append(temp_path)

        if not temp_paths:
            raise HTTPException(status_code=400, detail="Aucun fichier image valide fourni")

        # Multi-séquence : chaque import = une séquence avec préfixe unique
        base_index = project.frame_count
        seq = _create_sequence(
            session, project_id,
            name=(sequence_name.strip() or f"images_{datetime_now_label()}"),
            source_type="images",
            source_path=None,
            start_index=base_index,
        )

        # Import via le service (copie sans re-encodage)
        frame_data_list = dataset_service.import_images_from_files(
            project_id, temp_paths, filename_prefix=_seq_prefix(seq)
        )

        # Création des entrées Frame en BDD
        frames_added = 0
        for fd in frame_data_list:
            # Vérifier que la frame n'existe pas déjà (import incrémental)
            existing = session.exec(
                select(Frame)
                .where(Frame.project_id == project_id)
                .where(Frame.filename == fd["filename"])
            ).first()

            if not existing:
                frame = Frame(
                    project_id=project_id,
                    sequence_id=seq.id,
                    frame_index=fd["frame_index"] + base_index,
                    filename=fd["filename"],
                    thumbnail_path=fd["thumbnail_path"],
                    width=fd["width"],
                    height=fd["height"],
                    timestamp_ms=fd.get("timestamp_ms"),
                )
                session.add(frame)
                frames_added += 1

        # Mise à jour des compteurs
        seq.frame_count = frames_added
        session.add(seq)
        project.frame_count += frames_added
        session.add(project)
        session.commit()

    finally:
        # Nettoyage du dossier temporaire
        import shutil
        shutil.rmtree(temp_dir, ignore_errors=True)

    return {
        "success": True,
        "frames_added": frames_added,
        "total_frames": project.frame_count,
    }


@router.post("/api/projects/{project_id}/import/folder", response_model=dict)
async def import_folder(
    project_id: int,
    folder_path: str = Form(...),
    use_symlink: bool = Form(False),
    sequence_name: str = Form(""),  # nom de séquence (défaut = nom du dossier)
    session: Session = Depends(get_session),
):
    """
    Importe toutes les images d'un dossier local en arrière-plan.
    Retourne immédiatement un task_id pour suivre la progression via GET /api/tasks/{task_id}.
    Supporte les grands dossiers (2000+ images) sans timeout.
    """
    import threading
    from backend.services.task_registry import create_task, update_task

    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Projet introuvable")

    from backend.utils.native_share import from_native_share_path
    folder_path = from_native_share_path(folder_path) or folder_path
    folder = Path(folder_path)
    if not folder.is_dir():
        raise HTTPException(status_code=400, detail=f"Dossier introuvable : {folder_path}")

    # Comptage rapide pour avoir le total dès le départ
    from backend.services.dataset_service import IMAGE_EXTENSIONS as _IMG_EXT
    total_files = sum(1 for f in folder.iterdir() if f.suffix.lower() in _IMG_EXT)
    if total_files == 0:
        return {"success": True, "task_id": None, "frames_added": 0, "total_frames": project.frame_count}

    task_id = str(uuid.uuid4())
    create_task(task_id, f"Import dossier : {folder.name} ({total_files} images)")
    update_task(task_id, "running", 0, f"0/{total_files} images importées")

    # Multi-séquence : le dossier importé devient une séquence.
    # Nom = celui fourni par l'utilisateur, sinon le nom du dossier (auto).
    # Ce nom est réutilisé tel quel à l'export (sous-dossier YOLO / fichier .ver).
    base_index = project.frame_count
    seq = _create_sequence(
        session, project_id,
        name=(sequence_name.strip() or folder.name),
        source_type="images",
        source_path=str(folder),
        start_index=base_index,
    )
    session.commit()

    _project_id  = project_id
    _folder_path = folder_path
    _use_symlink = use_symlink
    _task_id     = task_id
    _total       = total_files
    _seq_id      = seq.id
    _prefix      = _seq_prefix(seq)
    _base_index  = base_index

    def _import_bg():
        from sqlmodel import Session as DBSession
        from backend.database import engine as _engine
        from backend.services.task_registry import update_task as _upd

        frames_added = 0

        def _on_progress(current: int, total: int):
            pct = min(99, int(current / max(total, 1) * 100))
            _upd(_task_id, "running", pct, f"{current}/{total} images importées")

        try:
            batch_size = 100
            pending = 0
            with DBSession(_engine) as db:
                for current, fd in enumerate(
                    dataset_service.iter_import_images_from_folder(
                        _project_id,
                        _folder_path,
                        use_symlink=_use_symlink,
                        filename_prefix=_prefix,
                    ),
                    start=1,
                ):
                    existing = db.exec(
                        select(Frame)
                        .where(Frame.project_id == _project_id)
                        .where(Frame.filename == fd["filename"])
                    ).first()
                    if not existing:
                        db.add(Frame(
                            project_id=_project_id,
                            sequence_id=_seq_id,
                            frame_index=fd["frame_index"] + _base_index,
                            filename=fd["filename"],
                            thumbnail_path=fd["thumbnail_path"],
                            width=fd["width"],
                            height=fd["height"],
                            timestamp_ms=fd.get("timestamp_ms"),
                        ))
                        frames_added += 1
                        pending += 1

                    if pending >= batch_size or current == _total:
                        proj = db.get(Project, _project_id)
                        if proj:
                            proj.frame_count = _base_index + frames_added
                            db.add(proj)
                        seq_obj = db.get(Sequence, _seq_id)
                        if seq_obj:
                            seq_obj.frame_count = frames_added
                            db.add(seq_obj)
                        db.commit()
                        pending = 0

                    _on_progress(current, _total)

            _upd(_task_id, "completed", 100,
                 f"{frames_added} images importées ({_total} traitées)")

        except Exception as exc:
            _upd(_task_id, "error", 0, "", error=str(exc))
            print(f"[import_folder] Erreur : {exc}")

    threading.Thread(target=_import_bg, daemon=True).start()

    return {
        "success": True,
        "task_id": task_id,
        "total_files": total_files,
    }


@router.post("/api/projects/{project_id}/import/video", response_model=dict)
async def import_video(
    project_id: int,
    background_tasks: BackgroundTasks,
    video: UploadFile = File(...),
    frame_keep: int = Form(0),
    jpeg_quality: int = Form(85),
    chunk_size_mb: int = Form(8),
    initial_frames: int = Form(3),
    extraction_batch_size: int = Form(10),
    lossless: bool = Form(False),
    sequence_name: str = Form(""),  # nom de séquence (défaut = nom du fichier vidéo)
    session: Session = Depends(get_session),
):
    """
    Import vidéo — mode lazy :

    1. Upload par chunks (RAM max = chunk_size_mb pendant l'envoi)
    2. Scan rapide des métadonnées OpenCV (O(1))
    3. Création de TOUS les enregistrements Frame en base (is_extracted=False)
    4. Extraction physique des `initial_frames` premières frames uniquement
    5. Retour immédiat — le reste est extrait à la demande via /ensure_extracted

    frame_keep : 0=garder tout, 2=1 sur 2, 3=1 sur 3, ...
    chunk_size_mb : taille du chunk HTTP pour l'upload (RAM max = cette valeur)
    initial_frames : frames physiquement extraites au moment de l'import
    """
    from backend.services.task_registry import create_task, update_task

    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Projet introuvable")

    # ---- 1. Sauvegarde par chunks ----
    project_dir = dataset_service.get_project_dir(project_id)
    project_dir.mkdir(parents=True, exist_ok=True)
    video_path = project_dir / (video.filename or "video.mp4")
    chunk_size = max(1, chunk_size_mb) * 1024 * 1024

    with open(video_path, "wb") as f:
        while True:
            chunk = await video.read(chunk_size)
            if not chunk:
                break
            f.write(chunk)

    # ---- 2. Scan + création lazy ----
    # Multi-séquence : la vidéo devient une séquence ajoutée à la suite
    base_index = project.frame_count
    seq = _create_sequence(
        session, project_id,
        name=(sequence_name.strip() or Path(video.filename or "video.mp4").stem),
        source_type="video",
        source_path=str(video_path),
        start_index=base_index,
    )

    fk = frame_keep if frame_keep and frame_keep >= 2 else None
    try:
        frame_records, width, height, source_fps = dataset_service.scan_video_lazy(
            project_id=project_id,
            video_path=str(video_path),
            frame_keep=fk,
            jpeg_quality=jpeg_quality,
            initial_frames=initial_frames,
            lossless=lossless,
            filename_prefix=_seq_prefix(seq),
        )
    except Exception as e:
        session.rollback()
        raise HTTPException(status_code=422, detail=f"Erreur scan video : {e}")

    # ---- 3. Insertion en base (append à la suite des séquences existantes) ----
    for fd in frame_records:
        frame = Frame(
            project_id=project_id,
            sequence_id=seq.id,
            frame_index=fd["frame_index"] + base_index,
            filename=fd["filename"],
            thumbnail_path=fd["thumbnail_path"],
            width=fd["width"],
            height=fd["height"],
            is_extracted=fd["is_extracted"],
            source_frame_index=fd["source_frame_index"],
        )
        session.add(frame)

    seq.frame_count = len(frame_records)
    seq.fps = source_fps
    session.add(seq)
    project.frame_count += len(frame_records)
    project.source_path  = str(video_path)   # compat : fallback extract-on-demand
    session.add(project)
    session.commit()

    # ---- 4. Tâche d'extraction en arrière-plan pour toutes les frames restantes ----
    task_id = str(uuid.uuid4())
    create_task(task_id, f"Import video : {video.filename or 'video'}")
    n_extracted = sum(1 for r in frame_records if r["is_extracted"])
    total_frames = len(frame_records)
    unextracted = [(r["filename"], r["source_frame_index"]) for r in frame_records if not r["is_extracted"]]

    if unextracted:
        update_task(task_id, "running",
                    int(n_extracted / max(total_frames, 1) * 100),
                    f"{n_extracted}/{total_frames} frames extraites")

        _video_path   = str(video_path)
        _project_id   = project_id
        _jpeg_quality = jpeg_quality
        _lossless     = lossless
        _n_init       = n_extracted
        _total        = total_frames
        _unextracted  = list(unextracted)
        _task_id      = task_id
        _batch_size   = max(1, extraction_batch_size)

        def _extract_all_bg():
            from sqlmodel import Session as DBSession
            from backend.database import engine as _engine
            from backend.services.task_registry import update_task as _upd
            import os as _os

            extracted_count = _n_init

            def on_batch(filenames):
                nonlocal extracted_count
                with DBSession(_engine) as db:
                    for fn in filenames:
                        frame_obj = db.exec(
                            select(Frame)
                            .where(Frame.project_id == _project_id)
                            .where(Frame.filename == fn)
                        ).first()
                        if frame_obj:
                            frame_obj.is_extracted = True
                            db.add(frame_obj)
                    db.commit()
                extracted_count += len(filenames)
                progress = min(99, int(extracted_count / _total * 100))
                _upd(_task_id, "running", progress,
                     f"{extracted_count}/{_total} frames extraites")

            try:
                # Lecture séquentielle — 10-100× plus rapide que le seek aléatoire sur H.264
                dataset_service.extract_video_frames_sequential(
                    _project_id, _video_path, _unextracted,
                    _jpeg_quality, _lossless, on_batch, _batch_size
                )
            except Exception as e:
                print(f"[import_video] Erreur extraction : {e}")

            _upd(_task_id, "completed", 100, f"{_total} frames extraites")

            # Supprimer la vidéo source — toutes les frames sont extraites sur disque,
            # la copie serveur n'est plus nécessaire (l'original est sur la machine client)
            try:
                _os.remove(_video_path)
                with DBSession(_engine) as db:
                    proj = db.get(Project, _project_id)
                    if proj and proj.source_path == _video_path:
                        proj.source_path = None
                        db.add(proj)
                    # Séquence : source supprimée aussi
                    for sq in db.exec(select(Sequence).where(Sequence.source_path == _video_path)).all():
                        sq.source_path = None
                        db.add(sq)
                    db.commit()
            except Exception as e:
                print(f"[import_video] Nettoyage source : {e}")

        background_tasks.add_task(_extract_all_bg)
    else:
        update_task(task_id, "completed", 100, f"{total_frames} frames extraites")

    return {
        "success": True,
        "task_id": task_id,
        "frames_registered": total_frames,
        "frames_extracted": n_extracted,
    }


@router.post("/api/projects/{project_id}/import/specific", response_model=dict)
async def import_specific_format(
    project_id: int,
    background_tasks: BackgroundTasks,
    format_id: str = Form(...),
    source_file: UploadFile = File(...),
    frame_keep: int = Form(0),
    chunk_size_mb: int = Form(8),
    extraction_batch_size: int = Form(10),
    sequence_name: str = Form(""),
    session: Session = Depends(get_session),
):
    """Import an uploaded sequence through an optional format adapter."""
    from backend.services.format_registry import get_format

    resolved = get_format(format_id)
    if resolved is None:
        raise HTTPException(status_code=415, detail="Format spécifique indisponible")
    capability, _adapter = resolved
    suffix = Path(source_file.filename or "").suffix.lower()
    extensions = {str(ext).lower() for ext in capability.get("extensions", [])}
    if suffix not in extensions:
        raise HTTPException(status_code=422, detail="Extension incompatible avec le format sélectionné")
    if capability.get("import_contract") != "annotation_sequence_v1":
        raise HTTPException(status_code=501, detail="Adaptateur sans contrat d'import compatible")

    return await import_optional_format(
        project_id=project_id,
        background_tasks=background_tasks,
        optional_format_file=source_file,
        frame_keep=frame_keep,
        chunk_size_mb=chunk_size_mb,
        extraction_batch_size=extraction_batch_size,
        sequence_name=sequence_name,
        convert_png=False,
        session=session,
    )


@router.post("/api/projects/{project_id}/import/optional_format", response_model=dict, include_in_schema=False)
async def import_optional_format(
    project_id: int,
    background_tasks: BackgroundTasks,
    optional_format_file: UploadFile = File(...),
    frame_keep: int = Form(0),
    chunk_size_mb: int = Form(8),
    extraction_batch_size: int = Form(10),
    sequence_name: str = Form(""),  # nom de séquence (défaut = nom du fichier optional_format)
    convert_png: bool = Form(False),  # True = extraire tous les PNG (long) ; False = on-the-fly
    session: Session = Depends(get_session),
):
    """
    Import fichier .optional uploade — extraction complete vers PNG en arriere-plan.
    Le fichier optional_format est sauvegarde dans data/projects/{id}/ et converti en PNG
    dans data/projects/{id}/{stem}_png/ avant d'entrer dans le projet.
    """
    from backend.services.task_registry import create_task, update_task

    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Projet introuvable")

    fname = optional_format_file.filename or f"sequence{preferred_extension()}"
    if not supports_filename(fname):
        raise HTTPException(status_code=422, detail="Fichier .optional requis")

    project_dir = dataset_service.get_project_dir(project_id)
    project_dir.mkdir(parents=True, exist_ok=True)
    optional_format_path = project_dir / fname
    chunk_size = max(1, chunk_size_mb) * 1024 * 1024

    with open(optional_format_path, "wb") as f:
        while True:
            chunk = await optional_format_file.read(chunk_size)
            if not chunk:
                break
            f.write(chunk)

    # Multi-séquence : l'optional_format devient une séquence ajoutée à la suite
    base_index = project.frame_count
    seq = _create_sequence(
        session, project_id,
        name=(sequence_name.strip() or Path(fname).stem),
        source_type="optional_format",
        source_path=str(optional_format_path),
        start_index=base_index,
    )

    fk = frame_keep if frame_keep and frame_keep >= 2 else None
    try:
        frame_records, width, height, png_dir = dataset_service.scan_optional_format_for_png_extraction(
            project_id=project_id,
            optional_format_path=str(optional_format_path),
            frame_keep=fk,
            filename_prefix=_seq_prefix(seq),
        )
    except Exception as e:
        session.rollback()
        raise HTTPException(status_code=422, detail=f"Erreur scan optional_format : {e}")

    _ = (width, height)

    for fd in frame_records:
        frame = Frame(
            project_id=project_id,
            sequence_id=seq.id,
            frame_index=fd["frame_index"] + base_index,
            filename=fd["filename"],
            thumbnail_path=fd["thumbnail_path"],
            width=fd["width"],
            height=fd["height"],
            # On-the-fly (convert_png=False) : la frame est immédiatement servable
            # (décodage à la volée), donc marquée "extraite".
            is_extracted=(fd["is_extracted"] or not convert_png),
            source_frame_index=fd["source_frame_index"],
        )
        session.add(frame)

    seq.frame_count = len(frame_records)
    session.add(seq)
    project.frame_count += len(frame_records)
    project.source_path = str(optional_format_path)   # compat : fallback
    session.add(project)
    session.commit()

    task_id     = str(uuid.uuid4())
    total_frames = len(frame_records)
    create_task(task_id, f"optional_format : {fname}")

    if not convert_png:
        # Mode on-the-fly (défaut) : AUCUNE extraction PNG. Frames servies ET
        # trackées en décodant le .optional à la volée (seek O(1)) → import instantané,
        # zéro doublon disque. convert_png=1 pour tout extraire en PNG (long).
        update_task(task_id, "completed", 100, f"{total_frames} frames (optional_format on-the-fly)")
        return {"success": True, "task_id": task_id,
                "frames_registered": total_frames, "frames_extracted": 0}

    update_task(task_id, "running", 0, f"0/{total_frames} frames PNG")

    _optional_format_path   = str(optional_format_path)
    _png_dir    = png_dir
    _project_id = project_id
    _total      = total_frames
    _fk         = fk
    _batch      = max(1, extraction_batch_size)
    _task_id    = task_id
    _prefix     = _seq_prefix(seq)

    def _extract_optional_format_png_bg():
        from sqlmodel import Session as DBSession
        from backend.database import engine as _engine
        from backend.services.task_registry import update_task as _upd
        from backend.services.format_registry import invoke_for_filename

        Path(_png_dir).mkdir(parents=True, exist_ok=True)  # créé seulement si convert_png
        frame_step  = max(1, _fk) if _fk and _fk >= 2 else 1
        extracted   = 0
        batch_names = []

        for db_idx in range(_total):
            source_idx = db_idx * frame_step
            filename   = f"{_prefix}frame_{db_idx:06d}.png"
            dst        = Path(_png_dir) / filename
            try:
                if not dst.exists():
                    img, _ = invoke_for_filename(
                        _optional_format_path,
                        "read",
                        _optional_format_path,
                        seq_range=(source_idx, source_idx + 1),
                    )
                    frame_bgr = dataset_service._optional_format_frame_to_bgr(img)
                    cv2.imwrite(str(dst), frame_bgr)
                batch_names.append(filename)
            except Exception as e:
                print(f"[optional_format->PNG] frame {db_idx}: {e}")
                batch_names.append(filename)

            extracted += 1
            if len(batch_names) >= _batch:
                with DBSession(_engine) as db:
                    for fn in batch_names:
                        fo = db.exec(
                            select(Frame)
                            .where(Frame.project_id == _project_id)
                            .where(Frame.filename == fn)
                        ).first()
                        if fo:
                            fo.is_extracted = True
                            db.add(fo)
                    db.commit()
                batch_names = []
                _upd(_task_id, "running", min(99, int(extracted / _total * 100)),
                     f"{extracted}/{_total} frames PNG")

        if batch_names:
            with DBSession(_engine) as db:
                for fn in batch_names:
                    fo = db.exec(
                        select(Frame)
                        .where(Frame.project_id == _project_id)
                        .where(Frame.filename == fn)
                    ).first()
                    if fo:
                        fo.is_extracted = True
                        db.add(fo)
                db.commit()

        _upd(_task_id, "completed", 100, f"{_total} frames optional_format -> PNG")

    background_tasks.add_task(_extract_optional_format_png_bg)

    return {"success": True, "task_id": task_id,
            "frames_registered": total_frames, "frames_extracted": 0}


@router.post("/api/projects/{project_id}/frames/ensure_extracted", response_model=dict)
def ensure_frames_extracted(
    project_id: int,
    center_frame_index: int,
    preload: int = 2,
    jpeg_quality: int = 85,
    session: Session = Depends(get_session),
):
    """
    Extrait à la demande les frames autour de `center_frame_index` qui ne sont
    pas encore extraites physiquement (is_extracted=False).

    center_frame_index : index de la frame centrale (frame_index en BDD)
    preload : nombre de frames à extraire de chaque côté (total = 2*preload+1 max)

    Retourne : liste des frame_id nouvellement extraites.
    """
    lo = max(0, center_frame_index - preload)
    hi = center_frame_index + preload

    unextracted = session.exec(
        select(Frame)
        .where(Frame.project_id == project_id)
        .where(Frame.frame_index >= lo)
        .where(Frame.frame_index <= hi)
        .where(Frame.is_extracted == False)   # noqa: E712
    ).all()

    if not unextracted:
        return {"extracted": [], "message": "Deja extraites"}

    project = session.get(Project, project_id)
    if not project:
        return {"extracted": [], "message": "Projet introuvable"}

    # Multi-séquence : résoudre la source par frame (chaque séquence a la sienne)
    extracted_ids = []
    by_source: dict[str, list[Frame]] = {}
    for f in unextracted:
        src = _resolve_sequence_source(session, f, project)
        if src is None:
            continue
        if supports_filename(str(src)):
            continue  # optional_format : extraction PNG en arriere-plan dediee, pas ici
        by_source.setdefault(str(src), []).append(f)

    if not by_source:
        return {"extracted": [], "message": "Aucun fichier source video"}

    for src_path, frames_grp in by_source.items():
        frames_to_extract = [(f.filename, f.source_frame_index or f.frame_index) for f in frames_grp]
        try:
            dataset_service.extract_video_frames_on_demand(
                project_id, src_path, frames_to_extract, jpeg_quality
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Erreur extraction : {e}")
        for frame in frames_grp:
            frame.is_extracted = True
            session.add(frame)
            extracted_ids.append(frame.id)
    session.commit()

    return {"extracted": extracted_ids, "message": f"{len(extracted_ids)} frame(s) extraites"}


# ---- Navigation dans les frames ----

def _serialize_frame(frame: Frame, annotation_count: int = 0) -> dict:
    return {
        "id": frame.id,
        "project_id": frame.project_id,
        "frame_index": frame.frame_index,
        "filename": frame.filename,
        "thumbnail_url": f"/api/frames/{frame.id}/thumbnail",
            # Endpoint dynamique : suit les symlinks Windows/Linux et evite
            # les vignettes/canvas noirs quand StaticFiles refuse un lien.
            "image_url": f"/api/frames/{frame.id}/image",
        "width": frame.width,
        "height": frame.height,
        "timestamp_ms": frame.timestamp_ms,
        "is_keyframe": frame.is_keyframe,
        "is_annotated": frame.is_annotated,
        "is_empty": frame.is_empty,
        "propagation_confidence": frame.propagation_confidence,
        "is_extracted": frame.is_extracted,
        "annotation_count": annotation_count,
    }

@router.get("/api/projects/{project_id}/frames", response_model=List[dict])
def list_frames(
    project_id: int,
    page: int = 0,
    limit: int = 50,
    annotated_only: bool = False,
    sequence_id: Optional[int] = None,
    session: Session = Depends(get_session),
):
    """
    Liste les frames d'un projet avec pagination.
    Supporte le filtrage des frames annotées uniquement, et par séquence.

    Args:
        page: Numéro de page (0-based)
        limit: Nombre de frames par page
        annotated_only: Si True, retourne seulement les frames avec annotations
        sequence_id: Si fourni, retourne seulement les frames de cette séquence
    """
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Projet introuvable")
    _repair_project_frame_records(project, session)

    query = select(Frame).where(Frame.project_id == project_id).order_by(Frame.frame_index)

    if annotated_only:
        query = query.where(Frame.is_annotated == True)
    if sequence_id is not None:
        query = query.where(Frame.sequence_id == sequence_id)

    query = query.offset(page * limit).limit(limit)
    frames = session.exec(query).all()

    # Compter les annotations par frame en une seule requête
    frame_ids = [f.id for f in frames]
    annotation_counts: dict[int, int] = {}
    if frame_ids:
        count_rows = session.exec(
            select(Annotation.frame_id, func.count(Annotation.id).label("cnt"))
            .where(Annotation.frame_id.in_(frame_ids))
            .group_by(Annotation.frame_id)
        ).all()
        annotation_counts = {row[0]: row[1] for row in count_rows}

    return [_serialize_frame(f, annotation_counts.get(f.id or 0, 0)) for f in frames]


@router.get("/api/projects/{project_id}/sequences", response_model=List[dict])
def list_sequences(project_id: int, session: Session = Depends(get_session)):
    """
    Liste les séquences d'un projet (multi-séquence) avec leurs statistiques
    d'annotation : nombre de frames, frames annotées, nombre d'annotations.
    Les frames de chaque séquence occupent la plage globale
    [start_index, start_index + frame_count).
    """
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Projet introuvable")

    sequences = session.exec(
        select(Sequence)
        .where(Sequence.project_id == project_id)
        .order_by(Sequence.start_index)
    ).all()

    result = []
    for seq in sequences:
        annotated = session.exec(
            select(func.count(Frame.id))
            .where(Frame.sequence_id == seq.id)
            .where(Frame.is_annotated == True)  # noqa: E712
        ).one()
        ann_count = session.exec(
            select(func.count(Annotation.id))
            .join(Frame, Frame.id == Annotation.frame_id)
            .where(Frame.sequence_id == seq.id)
        ).one()
        result.append({
            "id": seq.id,
            "project_id": seq.project_id,
            "name": seq.name,
            "source_type": seq.source_type,
            "source_path": seq.source_path,
            "start_index": seq.start_index,
            "frame_count": seq.frame_count,
            "fps": seq.fps,
            "created_at": seq.created_at.isoformat() if seq.created_at else None,
            "annotated_frames": int(annotated or 0),
            "annotation_count": int(ann_count or 0),
            "lut": _parse_lut_json(getattr(seq, "lut_json", None)),
        })

    # Frames importées avant l'introduction des séquences (sequence_id NULL)
    legacy_count = session.exec(
        select(func.count(Frame.id))
        .where(Frame.project_id == project_id)
        .where(Frame.sequence_id == None)  # noqa: E711
    ).one()
    legacy_count = int(legacy_count or 0)
    if legacy_count > 0:
        legacy_annotated = session.exec(
            select(func.count(Frame.id))
            .where(Frame.project_id == project_id)
            .where(Frame.sequence_id == None)  # noqa: E711
            .where(Frame.is_annotated == True)  # noqa: E712
        ).one()
        legacy_ann = session.exec(
            select(func.count(Annotation.id))
            .join(Frame, Frame.id == Annotation.frame_id)
            .where(Frame.project_id == project_id)
            .where(Frame.sequence_id == None)  # noqa: E711
        ).one()
        first_legacy = session.exec(
            select(func.min(Frame.frame_index))
            .where(Frame.project_id == project_id)
            .where(Frame.sequence_id == None)  # noqa: E711
        ).one()
        result.insert(0, {
            "id": None,
            "project_id": project_id,
            "name": "Sequence principale",
            "source_type": "legacy",
            "source_path": project.source_path,
            "start_index": int(first_legacy or 0),
            "frame_count": legacy_count,
            "fps": None,
            "created_at": None,
            "annotated_frames": int(legacy_annotated or 0),
            "annotation_count": int(legacy_ann or 0),
            "lut": _project_lut(session, project_id),
        })

    return result


class SequenceLutUpdate(_BaseModel):
    mode: str = "sigma"                 # "sigma" | "minmax" | "manual"
    sigma: float = 3.0
    lo: Optional[float] = None
    hi: Optional[float] = None


@router.put("/api/sequences/{sequence_id}/lut", response_model=dict)
def set_sequence_lut(sequence_id: int, body: SequenceLutUpdate,
                     session: Session = Depends(get_session)):
    """Définit la LUT d'affichage PROPRE à une séquence (persistée, prioritaire
    sur la LUT projet). Renvoie la signature de cache pour le cache-buster."""
    seq = session.get(Sequence, sequence_id)
    if not seq:
        raise HTTPException(status_code=404, detail="Séquence introuvable")
    import json as _json
    lut = {"mode": body.mode, "sigma": body.sigma, "lo": body.lo, "hi": body.hi}
    seq.lut_json = _json.dumps(lut)
    session.add(seq)
    session.commit()
    from backend.utils.image_utils import lut_signature
    purged = purge_project_lut_caches(session, seq.project_id)
    return {"lut": lut, "signature": lut_signature(lut), "purged": purged}


@router.delete("/api/sequences/{sequence_id}/lut", response_model=dict)
def clear_sequence_lut(sequence_id: int, session: Session = Depends(get_session)):
    """Efface la LUT propre à la séquence → repli sur la LUT projet."""
    seq = session.get(Sequence, sequence_id)
    if not seq:
        raise HTTPException(status_code=404, detail="Séquence introuvable")
    seq.lut_json = None
    session.add(seq)
    session.commit()
    purged = purge_project_lut_caches(session, seq.project_id)
    return {"success": True, "sequence_id": sequence_id, "purged": purged}


@router.get("/api/projects/{project_id}/frames/by-index/{frame_index}", response_model=dict)
def get_frame_by_index(
    project_id: int,
    frame_index: int,
    session: Session = Depends(get_session),
):
    """
    Retourne une frame par son index logique.
    Utilise pour la navigation sparse: le frontend peut sauter directement
    a F2400 sans charger toutes les frames precedentes.
    NOTE: la reparation des records est intentionnellement absente ici
    (hot path de navigation - appele a chaque frame). La reparation
    se fait uniquement via list_frames (chargement initial).
    """
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Projet introuvable")

    frame = session.exec(
        select(Frame)
        .where(Frame.project_id == project_id)
        .where(Frame.frame_index == frame_index)
    ).first()
    if not frame:
        raise HTTPException(status_code=404, detail="Frame introuvable")

    annotation_count = session.exec(
        select(func.count(Annotation.id)).where(Annotation.frame_id == frame.id)
    ).one()
    return _serialize_frame(frame, int(annotation_count or 0))


@router.get("/api/frames/{frame_id}", response_model=dict)
def get_frame(frame_id: int, session: Session = Depends(get_session)):
    """
    Retourne le détail d'une frame avec toutes ses annotations.
    C'est l'endpoint principal utilisé par le canvas d'annotation.
    """
    frame = session.get(Frame, frame_id)
    if not frame:
        raise HTTPException(status_code=404, detail="Frame introuvable")

    annotations = session.exec(
        select(Annotation).where(Annotation.frame_id == frame_id)
    ).all()

    return {
        "id": frame.id,
        "project_id": frame.project_id,
        "frame_index": frame.frame_index,
        "filename": frame.filename,
        "image_url": f"/api/frames/{frame.id}/image",
        "thumbnail_url": f"/api/frames/{frame.id}/thumbnail",
        "width": frame.width,
        "height": frame.height,
        "timestamp_ms": frame.timestamp_ms,
        "is_keyframe": frame.is_keyframe,
        "is_annotated": frame.is_annotated,
        "is_empty": frame.is_empty,
        "propagation_confidence": frame.propagation_confidence,
        "is_extracted": frame.is_extracted,
        "annotations": [
            {
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
            }
            for a in annotations
        ],
    }


@router.post("/api/frames/{frame_id}/mark-empty", response_model=dict)
def mark_frame_empty(
    frame_id: int,
    empty: bool = True,
    session: Session = Depends(get_session),
):
    """
    Marque une frame comme explicitement vide (aucun objet d'intérêt).
    Lors de l'export YOLO, génère un fichier .txt vide pour cette frame.
    """
    frame = session.get(Frame, frame_id)
    if not frame:
        raise HTTPException(status_code=404, detail="Frame introuvable")

    frame.is_empty = empty
    if empty:
        frame.is_annotated = True  # Considérée comme "traitée"
        # Mise à jour du compteur du projet
        project = session.get(Project, frame.project_id)
        if project:
            project.annotated_count = session.exec(
                select(Frame)
                .where(Frame.project_id == frame.project_id)
                .where(Frame.is_annotated == True)
            ).all().__len__()
            session.add(project)

    session.add(frame)
    session.commit()

    return {"success": True, "frame_id": frame_id, "is_empty": frame.is_empty}


@router.put("/api/frames/{frame_id}/keyframe", response_model=dict)
def toggle_keyframe(
    frame_id: int,
    is_keyframe: bool = True,
    session: Session = Depends(get_session),
):
    """Marque/démarque une frame comme keyframe pour le tracking."""
    frame = session.get(Frame, frame_id)
    if not frame:
        raise HTTPException(status_code=404, detail="Frame introuvable")

    frame.is_keyframe = is_keyframe
    session.add(frame)
    session.commit()

    return {"success": True, "frame_id": frame_id, "is_keyframe": is_keyframe}


# ---- Helpers media ----

def _placeholder_jpeg(width: int = 160, height: int = 90) -> bytes:
    """
    Retourne un JPEG gris fonce (placeholder pour frames non encore extraites).
    Evite le bug d'affichage de la mauvaise image quand le navigateur reçoit un 404
    et affiche la version cachee de la frame precedente.
    """
    img = np.full((height, width, 3), 30, dtype=np.uint8)   # gris très foncé
    _, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 50])
    return buf.tobytes()


# ---- Service des fichiers media ----

def _optional_format_png_dir(optional_format_path: str) -> Path:
    """Retourne le dossier PNG cree a cote du fichier optional_format."""
    p = Path(optional_format_path)
    return p.parent / f"{p.stem}_png"


def _parse_lut_json(raw: Optional[str]) -> Optional[dict]:
    if not raw:
        return None
    try:
        import json as _json
        d = _json.loads(raw)
        return d if isinstance(d, dict) else None
    except Exception:
        return None


def _project_lut(session: Session, project_id: int) -> Optional[dict]:
    """LUT d'affichage du projet (project.lut_json) → dict, ou None (= 3-sigma défaut)."""
    proj = session.get(Project, project_id)
    return _parse_lut_json(getattr(proj, "lut_json", None)) if proj else None


def _frame_lut(session: Session, frame: Frame) -> Optional[dict]:
    """LUT d'affichage effective d'une frame : séquence d'abord (sequence.lut_json),
    repli sur le projet (project.lut_json). None = 3-sigma par défaut."""
    if getattr(frame, "sequence_id", None):
        from backend.models.sequence import Sequence
        seq = session.get(Sequence, frame.sequence_id)
        seq_lut = _parse_lut_json(getattr(seq, "lut_json", None)) if seq else None
        if seq_lut is not None:
            return seq_lut
    return _project_lut(session, frame.project_id)


_missing_warned: set = set()


def _missing_reason(frame: Frame) -> str:
    """Pourquoi les pixels d'une frame sont introuvables : lien symbolique casse
    (source demontee) ou frame reellement pas encore extraite. Loggue une seule
    fois par projet -- une timeline entiere qui disparait genere un placeholder
    par frame visible, on ne veut pas des milliers de lignes identiques."""
    p = dataset_service.get_frame_path(frame.project_id, frame.filename)
    try:
        dangling = p.is_symlink() and not p.exists()
    except OSError:
        dangling = False
    if not dangling:
        return "not-extracted"
    if frame.project_id not in _missing_warned:
        _missing_warned.add(frame.project_id)
        try:
            target = os.readlink(str(p))
        except OSError:
            target = "?"
        print(f"[dataset] Projet {frame.project_id} : liens symboliques casses dans frames/ "
              f"(ex. {p.name} -> {target}). Le dossier source n'est plus monte : "
              f"les images ne peuvent pas s'afficher, les annotations restent intactes.")
    return "broken-symlink"


def purge_project_lut_caches(session: Session, project_id: int) -> int:
    """Nettoie les caches JPEG d'un projet apres un changement de LUT.

    Les signatures encore vivantes sont celle du projet et celle de chaque
    sequence (une sequence sans LUT propre retombe sur celle du projet, deja
    dans l'ensemble). Tout le reste est une generation morte. A appeler apres
    chaque ecriture de LUT : c'est le seul moment ou l'on sait qu'une signature
    vient de cesser d'etre utilisee.
    """
    from backend.utils.image_utils import lut_signature, purge_stale_lut_caches

    keep = {lut_signature(_project_lut(session, project_id))}
    for seq in session.exec(select(Sequence).where(Sequence.project_id == project_id)).all():
        seq_lut = _parse_lut_json(getattr(seq, "lut_json", None))
        if seq_lut is not None:
            keep.add(lut_signature(seq_lut))
    return purge_stale_lut_caches(dataset_service.get_project_dir(project_id), keep)


def _ensure_preview_cached(src_path: Path, project_id: int,
                           max_width: int = 480, quality: int = 70,
                           lut: Optional[dict] = None) -> Optional[Path]:
    """
    Assure qu'une version reduite (JPEG, largeur max `max_width`) de l'image
    existe dans frames_preview/ (la genere si absente) et retourne son `Path`.

    Extrait de _serve_preview pour etre reutilisable par /image-path (coquille
    Electron, cf. plan SMB) SANS dupliquer la logique de reduction/LUT — un
    seul endroit qui sait generer ce cache, que l'appelant veuille un
    FileResponse (_serve_preview) ou juste le chemin (resolve_frame_image_path).

    Deux paliers utilises par le frontend (le traitement IA/export lit
    TOUJOURS la source, jamais ces caches) :
      - 480 px (q70, ~10-20 Ko) : scrubbing du slider, fluide meme en SSH.
      - 1600 px (q85) : affichage du canvas au zoom ajuste. Au zoom fort,
        le frontend rebascule sur la source pleine resolution.

    Retourne None si la generation echoue (repli full-res).
    """
    from backend.utils.image_utils import lut_signature as _sig
    cache_dir = dataset_service.get_project_dir(project_id) / "frames_preview"
    dst = cache_dir / f"{src_path.stem}_prev{max_width}_{_sig(lut)}.jpg"
    if not dst.exists():
        try:
            from backend.utils.image_utils import load_image_bgr_8bit
            img = load_image_bgr_8bit(str(src_path), lut)
            h, w = img.shape[:2]
            if w > max_width:
                new_h = max(1, int(h * max_width / w))
                img = cv2.resize(img, (max_width, new_h), interpolation=cv2.INTER_AREA)
            cache_dir.mkdir(parents=True, exist_ok=True)
            cv2.imwrite(str(dst), img, [cv2.IMWRITE_JPEG_QUALITY, quality])
        except Exception as e:
            print(f"[dataset] Preview echouee {src_path}: {e}")
            return None
    return dst


def _serve_preview(src_path: Path, project_id: int,
                   max_width: int = 480, quality: int = 70,
                   lut: Optional[dict] = None) -> Optional[FileResponse]:
    """Variante FileResponse de _ensure_preview_cached, pour GET /image."""
    dst = _ensure_preview_cached(src_path, project_id, max_width, quality, lut)
    if dst is None:
        return None
    _IMG_CACHE = {"Cache-Control": "max-age=3600, immutable"}
    return FileResponse(str(dst), media_type="image/jpeg", headers=_IMG_CACHE)


def _ensure_optional_format_cached(frame: Frame, optional_format_path: str,
                       preview: bool = False, display: bool = False,
                       lut: Optional[dict] = None) -> Optional[Path]:
    """
    Assure qu'une frame optional_format decodee (seek O(1) dans le .optional, sans extraction PNG
    prealable) existe en JPEG dans frames_optional_format_cache/ et retourne son `Path`.
    Extrait de _serve_optional_format_onthefly — meme raison que _ensure_preview_cached.
      - preview=1 : 480 px q70   - display=1 : 1600 px q85   - sinon : pleine rés q92.
    """
    if frame.source_frame_index is None:
        return None
    if preview:
        tier, max_w, q = "p480", 480, 70
    elif display:
        tier, max_w, q = "d1600", 1600, 85
    else:
        tier, max_w, q = "full", 0, 92
    from backend.utils.image_utils import lut_signature as _sig
    cache_dir = dataset_service.get_project_dir(frame.project_id) / "frames_optional_format_cache"
    dst = cache_dir / f"{Path(frame.filename).stem}_{tier}_{_sig(lut)}.jpg"
    if not dst.exists():
        try:
            img = dataset_service.read_optional_format_frame_bgr(optional_format_path, int(frame.source_frame_index), lut)
            h, w = img.shape[:2]
            if max_w and w > max_w:
                new_h = max(1, int(h * max_w / w))
                img = cv2.resize(img, (max_w, new_h), interpolation=cv2.INTER_AREA)
            cache_dir.mkdir(parents=True, exist_ok=True)
            cv2.imwrite(str(dst), img, [cv2.IMWRITE_JPEG_QUALITY, q])
        except Exception as e:
            print(f"[dataset] optional_format on-the-fly échec {optional_format_path}#{frame.source_frame_index}: {e}")
            return None
    return dst


def _serve_optional_format_onthefly(frame: Frame, optional_format_path: str,
                        preview: bool = False, display: bool = False,
                        lut: Optional[dict] = None) -> Optional[FileResponse]:
    """Variante FileResponse de _ensure_optional_format_cached, pour GET /image."""
    dst = _ensure_optional_format_cached(frame, optional_format_path, preview, display, lut)
    if dst is None:
        return None
    _IMG_CACHE = {"Cache-Control": "max-age=3600, immutable"}
    return FileResponse(str(dst), media_type="image/jpeg", headers=_IMG_CACHE)


@router.get("/api/frames/{frame_id}/image")
def serve_frame_image(
    frame_id: int,
    preview: bool = False,
    display: bool = False,
    session: Session = Depends(get_session),
):
    """
    Sert le fichier image d'une frame.
    - Extraite dans frames_dir standard -> FileResponse.
    - optional_format : fichier dans {optional_format_parent}/{optional_format_stem}_png/ -> FileResponse.
    - Non extraite ou introuvable -> placeholder gris.
    - preview=1 : JPEG 480 px (scrubbing du slider).
    - display=1 : JPEG 1600 px (affichage canvas au zoom ajuste). Le frontend
      rebascule sur la source pleine resolution au zoom fort.
    Le traitement IA (SAMURAI) et l'export lisent TOUJOURS la source, jamais
    ces versions reduites.
    """
    frame = session.get(Frame, frame_id)
    if not frame:
        raise HTTPException(status_code=404, detail="Frame introuvable")

    # LUT d'affichage effective (séquence puis projet). Le param query ?lut=<sig>
    # ajouté par le frontend ne sert QUE de cache-buster navigateur ; vérité en DB.
    lut = _frame_lut(session, frame)

    # Réglage "reduction preview" (Parametres > Interface). Désactivé → chaque requete
    # preview=1/display=1 est traitee comme une requete pleine resolution : aucun JPEG
    # reduit genere, aucune ecriture dans frames_preview/.
    from backend.services.settings_service import settings_service as _settings
    if not bool(_settings.load().get("interface", {}).get("preview_downscale_enabled", True)):
        preview = False
        display = False

    # Frames extraites : mise en cache navigateur 1h (images statiques, jamais modifiees)
    _IMG_CACHE = {"Cache-Control": "max-age=3600, immutable"}

    if frame.is_extracted:
        # Cas 1 : dossier frames standard (MP4 upload, images)
        image_path = dataset_service.get_frame_path(frame.project_id, frame.filename)
        if image_path.exists():
            # Preview/display : réduction (avec LUT). Pour le PNG/TIFF 16 bits en
            # pleine résolution, on passe par le cache 8 bits ci-dessous.
            is_high = image_path.suffix.lower() in (".png", ".tif", ".tiff")
            if preview:
                resp = _serve_preview(image_path, frame.project_id, lut=lut)
                if resp:
                    return resp
            elif display:
                resp = _serve_preview(image_path, frame.project_id, max_width=1600, quality=85, lut=lut)
                if resp:
                    return resp
            # Images 16 bits (PNG/TIFF RGB ou IR) OU LUT manuelle : version 8 bits (LUT)
            # mise en cache dans frames_8bit/ (nom = signature LUT).
            if is_high:
                from backend.utils.image_utils import ensure_8bit_cached
                cache_dir = dataset_service.get_project_dir(frame.project_id) / "frames_8bit"
                cached = ensure_8bit_cached(str(image_path), str(cache_dir), lut)
                if cached:
                    return FileResponse(cached, media_type="image/jpeg", headers=_IMG_CACHE)
            media_type = "image/png" if image_path.suffix.lower() == ".png" else "image/jpeg"
            return FileResponse(str(image_path), media_type=media_type, headers=_IMG_CACHE)

        # Cas 2 : PNG dans le dossier optional_format externe ({optional_format_parent}/{optional_format_stem}_png/)
        # Multi-séquence : la source optional_format vient de la séquence de la frame,
        # avec repli sur project.source_path (anciens projets).
        project = session.get(Project, frame.project_id)
        if project:
            src = _resolve_sequence_source(session, frame, project)
            if src is not None and supports_filename(str(src)):
                png_path = _optional_format_png_dir(str(src)) / frame.filename
                if png_path.exists():
                    if preview:
                        resp = _serve_preview(png_path, frame.project_id, lut=lut)
                        if resp:
                            return resp
                    elif display:
                        resp = _serve_preview(png_path, frame.project_id, max_width=1600, quality=85, lut=lut)
                        if resp:
                            return resp
                    return FileResponse(str(png_path), media_type="image/png", headers=_IMG_CACHE)

    # On-the-fly optional_format : import SANS extraction PNG → décodage direct de la frame
    # depuis le .optional (seek O(1)) + cache JPEG par palier dans le workspace.
    # (Marche que la frame soit "extraite" ou non ; le PNG converti, s'il existe,
    #  est déjà servi plus haut.)
    project_ot = session.get(Project, frame.project_id)
    if project_ot:
        src_ot = _resolve_sequence_source(session, frame, project_ot)
        if src_ot is not None and supports_filename(str(src_ot)):
            resp = _serve_optional_format_onthefly(frame, str(src_ot), preview=preview, display=display, lut=lut)
            if resp:
                return resp

    # Placeholder gris (pas de cache : la frame n'est pas encore extraite)
    w = frame.width  if frame.width  and frame.width  > 0 else 640
    h = frame.height if frame.height and frame.height > 0 else 360
    # Un import en mode lien symbolique ne copie rien : frames/ ne contient que
    # des liens vers le dossier source. Si ce dossier n'est plus monte (autre
    # partage que le workspace, VM redemarree, montage tombe), Path.exists()
    # suit le lien et rend False comme pour une frame jamais extraite -- l'app
    # affichait donc un gris muet, alors que les tracks et l'export .ver, qui ne
    # lisent que la DB, continuaient de marcher. On distingue les deux cas pour
    # que le diagnostic soit lisible sans avoir a fouiller le disque.
    # no-store + X-Frame-Missing : ce placeholder part en HTTP 200 (c'est une
    # image valide, pas une erreur), donc TOUT cache en aval le prend pour la
    # vraie frame et le ressert ensuite indefiniment. La coquille Electron
    # gardait ainsi le gris en memoire pour toute la duree du process : des
    # images manquantes au demarrage (backend encore en train de monter, ou
    # partage source pas encore dispo) restaient grises meme une fois la source
    # revenue, jusqu'a relancer l'app. Ces deux en-tetes rendent le placeholder
    # explicitement non-cachable et identifiable.
    return Response(
        content=_placeholder_jpeg(w, h),
        media_type="image/jpeg",
        headers={
            "X-Frame-Missing": _missing_reason(frame),
            "Cache-Control": "no-store",
        },
    )


def resolve_frame_image_path(frame_id: int, preview: bool, display: bool,
                             session: Session) -> Optional[Path]:
    """
    Equivalent de serve_frame_image() mais retourne un `Path` au lieu d'un
    `FileResponse` (aucune lecture/streaming d'octets) — utilise par
    GET /api/frames/{id}/image-path (coquille Electron : lecture des pixels
    via le partage SMB au lieu du tunnel SSH, cf. plan Electron/SMB).

    Reutilise EXACTEMENT les memes helpers de cache que serve_frame_image
    (_ensure_preview_cached, _ensure_optional_format_cached, ensure_8bit_cached) : la
    resolution LUT et le decodage optional_format ne sont JAMAIS recalcules ici, seule
    la SELECTION de branche (quel cas s'applique) est dupliquee — pas de
    risque de divergence sur la partie qui compte (LUT/optional_format).

    Retourne None si la frame n'existe pas, ou si rien n'est generable/cache
    (placeholder gris) — l'appelant (Electron) doit alors retomber sur
    GET /image, qui gere aussi ce cas.
    """
    frame = session.get(Frame, frame_id)
    if not frame:
        return None

    lut = _frame_lut(session, frame)
    from backend.services.settings_service import settings_service as _settings
    if not bool(_settings.load().get("interface", {}).get("preview_downscale_enabled", True)):
        preview = False
        display = False

    if frame.is_extracted:
        image_path = dataset_service.get_frame_path(frame.project_id, frame.filename)
        if image_path.exists():
            is_high = image_path.suffix.lower() in (".png", ".tif", ".tiff")
            if preview:
                p = _ensure_preview_cached(image_path, frame.project_id, lut=lut)
                if p:
                    return p
            elif display:
                p = _ensure_preview_cached(image_path, frame.project_id, max_width=1600, quality=85, lut=lut)
                if p:
                    return p
            if is_high:
                from backend.utils.image_utils import ensure_8bit_cached
                cache_dir = dataset_service.get_project_dir(frame.project_id) / "frames_8bit"
                cached = ensure_8bit_cached(str(image_path), str(cache_dir), lut)
                if cached:
                    return Path(cached)
            return image_path

        project = session.get(Project, frame.project_id)
        if project:
            src = _resolve_sequence_source(session, frame, project)
            if src is not None and supports_filename(str(src)):
                png_path = _optional_format_png_dir(str(src)) / frame.filename
                if png_path.exists():
                    if preview:
                        p = _ensure_preview_cached(png_path, frame.project_id, lut=lut)
                        if p:
                            return p
                    elif display:
                        p = _ensure_preview_cached(png_path, frame.project_id, max_width=1600, quality=85, lut=lut)
                        if p:
                            return p
                    return png_path

    project_ot = session.get(Project, frame.project_id)
    if project_ot:
        src_ot = _resolve_sequence_source(session, frame, project_ot)
        if src_ot is not None and supports_filename(str(src_ot)):
            p = _ensure_optional_format_cached(frame, str(src_ot), preview=preview, display=display, lut=lut)
            if p:
                return p

    return None


@router.get("/api/frames/{frame_id}/image-path")
def frame_image_path(
    frame_id: int,
    preview: bool = False,
    display: bool = False,
    session: Session = Depends(get_session),
):
    """
    Variante legere de GET /image : au lieu de streamer les octets, garantit
    que le fichier cache existe deja sur disque puis renvoie son chemin natif.
    Pensee pour la coquille Electron (plan SMB) : cet endpoint ne
    transite que via le tunnel SSH avec un JSON minuscule ; les pixels
    (10-800 Ko/image) sont ensuite lus directement via le partage reseau,
    en contournant le tunnel pour la partie qui coute reellement cher.

    `native_path: null` (jamais une erreur) si aucun partage ne couvre le
    chemin resolu (voir Parametres > Chemins) ou si la frame n'a rien a
    servir (placeholder) — l'appelant doit alors retomber sur GET /image.
    """
    frame = session.get(Frame, frame_id)
    if not frame:
        raise HTTPException(status_code=404, detail="Frame introuvable")

    path = resolve_frame_image_path(frame_id, preview, display, session)
    if path is None:
        return {"native_path": None}

    from backend.utils.native_share import to_native_share_path
    return {"native_path": to_native_share_path(str(path))}


# Cache des histogrammes, borne. L'histogramme porte sur les valeurs BRUTES :
# il ne depend NI de la LUT, NI d'aucun reglage d'affichage, et les pixels
# sources ne changent jamais apres l'import -- il est donc calculable une fois
# pour toutes. Sans ce cache, chaque changement de frame avec le panneau LUT
# ouvert relancait un cv2.imread UNCHANGED d'un PNG 16 bits sur un montage
# RESEAU, en tenant une connexion du pool pendant toute la lecture (2218
# appels sur la seule session du 2026-09-04). C'est ce qui saturait le pool et
# figeait l'app, sans le moindre calcul GPU en cours.
_HIST_CACHE: "OrderedDict[int, dict]" = OrderedDict()
_HIST_CACHE_MAX = 4000        # ~quelques Mo : 256 bins + scalaires par frame
_HIST_LOCK = threading.Lock()


@router.get("/api/frames/{frame_id}/histogram")
def frame_histogram(frame_id: int, session: Session = Depends(get_session)):
    """
    Histogramme des valeurs BRUTES de la frame (avant LUT), pour l'outil LUT.
    Lit la source réelle : optional_format décodé à la volée, sinon le fichier image UNCHANGED
    (préserve le 16 bits). Retourne bins/counts/min/max/mean/std/bit_depth.
    """
    from backend.utils.image_utils import compute_histogram
    with _HIST_LOCK:
        hit = _HIST_CACHE.get(frame_id)
        if hit is not None:
            _HIST_CACHE.move_to_end(frame_id)
    if hit is not None:
        return hit
    frame = session.get(Frame, frame_id)
    if not frame:
        raise HTTPException(status_code=404, detail="Frame introuvable")

    raw: Optional[np.ndarray] = None
    project = session.get(Project, frame.project_id)
    src = _resolve_sequence_source(session, frame, project) if project else None

    # optional_format : valeurs brutes décodées à la volée.
    if src is not None and supports_filename(str(src)) and frame.source_frame_index is not None:
        try:
            raw = dataset_service.read_optional_format_frame_raw(str(src), int(frame.source_frame_index))
        except Exception:
            raw = None

    # Fichier image (png/tiff 16 bits inclus) : lecture UNCHANGED.
    if raw is None:
        candidates = [dataset_service.get_frame_path(frame.project_id, frame.filename)]
        if src is not None and supports_filename(str(src)):
            candidates.append(_optional_format_png_dir(str(src)) / frame.filename)
        for p in candidates:
            if p.exists():
                raw = cv2.imread(str(p), cv2.IMREAD_UNCHANGED)
                if raw is not None:
                    break

    if raw is None:
        raise HTTPException(status_code=404, detail="Source frame introuvable pour l'histogramme")
    hist = compute_histogram(raw)
    with _HIST_LOCK:
        _HIST_CACHE[frame_id] = hist
        _HIST_CACHE.move_to_end(frame_id)
        while len(_HIST_CACHE) > _HIST_CACHE_MAX:
            _HIST_CACHE.popitem(last=False)
    return hist


@router.get("/api/frames/{frame_id}/thumbnail")
def serve_frame_thumbnail(frame_id: int, session: Session = Depends(get_session)):
    """
    Sert la miniature 160x90 d'une frame.
    - Miniature sur disque (data/projects/{id}/thumbnails/) -> FileResponse.
    - Non extraite -> placeholder gris.
    """
    frame = session.get(Frame, frame_id)
    if not frame:
        raise HTTPException(status_code=404, detail="Frame introuvable")

    if frame.thumbnail_path:
        thumb_path = dataset_service.get_thumbnails_dir(frame.project_id) / frame.thumbnail_path
        if thumb_path.exists():
            return FileResponse(str(thumb_path), media_type="image/jpeg")

        source_image: Path | None = None
        if frame.is_extracted:
            image_path = dataset_service.get_frame_path(frame.project_id, frame.filename)
            if image_path.exists():
                source_image = image_path
            else:
                project = session.get(Project, frame.project_id)
                if project and project.source_path:
                    src = Path(project.source_path)
                    if supports_filename(str(src)):
                        png_path = _optional_format_png_dir(str(src)) / frame.filename
                        if png_path.exists():
                            source_image = png_path

        if source_image is not None:
            from backend.utils.image_utils import generate_thumbnail
            if generate_thumbnail(str(source_image), str(thumb_path)):
                return FileResponse(str(thumb_path), media_type="image/jpeg")

    return Response(
        content=_placeholder_jpeg(160, 90),
        media_type="image/jpeg",
        headers={"X-Frame-Missing": "thumbnail", "Cache-Control": "no-store"},
    )


# ---- Navigateur de fichiers serveur ----

class BrowseHistoryEntry(_BaseModel):
    path: str


@router.get("/api/files/browse-history", response_model=list)
def get_browse_history():
    """Derniers dossiers serveur parcourus (le plus recent en tete).

    Les chemins disparus sont filtres a la lecture : un dossier demonte ou
    supprime ne doit pas rester proposé en raccourci.
    """
    from backend.services.settings_service import settings_service
    try:
        history = settings_service.load()["paths"].get("browse_history") or []
    except Exception:
        return []
    return [p for p in history if isinstance(p, str) and Path(p).is_dir()]


@router.post("/api/files/browse-history", response_model=dict)
def add_browse_history(data: BrowseHistoryEntry):
    """Enregistre un dossier dans l'historique de navigation de l'utilisateur.

    Appele quand un dossier est effectivement retenu pour un import : on garde
    la trace des emplacements utiles, pas de chaque dossier traverse.
    """
    from backend.services.settings_service import settings_service

    from backend.utils.native_share import from_native_share_path
    folder = (data.path or "").strip()
    if not folder:
        raise HTTPException(status_code=400, detail="Chemin vide")
    folder = from_native_share_path(folder) or folder
    p = Path(folder)
    if p.is_file():
        p = p.parent
    if not p.is_dir():
        raise HTTPException(status_code=400, detail=f"Dossier introuvable : {folder}")

    resolved = str(p)
    settings = settings_service.load()
    paths_cfg = settings.setdefault("paths", {})
    history = [h for h in (paths_cfg.get("browse_history") or []) if isinstance(h, str)]
    history = [resolved] + [h for h in history if h != resolved]
    max_entries = int(paths_cfg.get("browse_history_max") or 12)
    paths_cfg["browse_history"] = history[:max_entries]
    settings_service.save(settings)
    return {"success": True, "history": paths_cfg["browse_history"]}


@router.get("/api/files/browse", response_model=dict)
def browse_filesystem(
    path: str = "",
    filter_type: str = "all",  # "all" | "dirs" | "images" | "video"
):
    """
    Liste les fichiers et dossiers d'un chemin serveur.
    Permet au frontend d'explorer le filesystem pour sélectionner
    un dossier d'images ou un fichier vidéo sans copier-coller.

    filter_type :
        "all"    — tout afficher
        "dirs"   — dossiers uniquement
        "images" — dossiers + fichiers images
        "video"  — dossiers + fichiers vidéo / optional_format
    """
    IMAGE_EXTS  = {".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".tif", ".webp"}
    VIDEO_EXTS  = {".mp4", ".avi", ".mov", ".mkv", ".webm"}

    # --- Résolution du chemin ---
    if not path:
        # Racine : liste les lecteurs sur Windows, "/" ailleurs
        if os.name == "nt":
            import string, ctypes
            bitmask = ctypes.windll.kernel32.GetLogicalDrives()  # type: ignore[attr-defined]
            drives = [
                f"{d}:\\"
                for d in string.ascii_uppercase
                if bitmask & (1 << (ord(d) - ord("A")))
            ]
            return {
                "path": "",
                "parent": None,
                "entries": [{"name": d, "path": d, "is_dir": True, "size": None} for d in drives],
            }
        else:
            path = "/"

    from backend.utils.native_share import from_native_share_path
    path = from_native_share_path(path) or path

    try:
        current = Path(path).resolve()
    except Exception:
        raise HTTPException(status_code=400, detail=f"Chemin invalide : {path}")

    if not current.exists():
        raise HTTPException(status_code=404, detail=f"Chemin introuvable : {path}")

    if not current.is_dir():
        raise HTTPException(status_code=400, detail=f"Ce chemin n'est pas un dossier : {path}")

    # Parent
    parent_path: str | None = str(current.parent) if current != current.parent else None

    # Liste des entrées
    entries = []
    try:
        for entry in sorted(current.iterdir(), key=lambda e: (not e.is_dir(), e.name.lower())):
            try:
                is_dir = entry.is_dir()
                ext    = entry.suffix.lower()

                # Filtrage selon filter_type
                if filter_type == "dirs" and not is_dir:
                    continue
                if filter_type == "images" and not is_dir and ext not in IMAGE_EXTS:
                    continue
                if (
                    filter_type == "video"
                    and not is_dir
                    and ext not in VIDEO_EXTS
                    and not supports_filename(str(entry))
                ):
                    continue

                size = entry.stat().st_size if not is_dir else None
                entries.append({
                    "name":   entry.name,
                    "path":   str(entry),
                    "is_dir": is_dir,
                    "size":   size,
                })
            except PermissionError:
                continue
    except PermissionError:
        raise HTTPException(status_code=403, detail="Accès refusé à ce dossier")

    return {"path": str(current), "parent": parent_path, "entries": entries}


# ---- Import vidéo depuis un chemin serveur (sans upload) ----

@router.post("/api/projects/{project_id}/import/video_from_path", response_model=dict)
async def import_video_from_path(
    project_id: int,
    background_tasks: BackgroundTasks,
    video_path: str = Form(...),
    frame_keep: int = Form(0),
    jpeg_quality: int = Form(85),
    initial_frames: int = Form(3),
    extraction_batch_size: int = Form(10),
    lossless: bool = Form(False),
    sequence_name: str = Form(""),  # nom de séquence (défaut = nom du fichier)
    convert_png: bool = Form(False),  # optional_format seulement : True = extraire les PNG (long), False = on-the-fly
    session: Session = Depends(get_session),
):
    """
    Import vidéo depuis un chemin sur le serveur — aucun upload.
    Identique à import_video mais sans copier le fichier source.
    La vidéo n'est JAMAIS supprimée (elle n'appartient pas au projet).
    """
    from backend.services.task_registry import create_task, update_task

    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Projet introuvable")

    from backend.utils.native_share import from_native_share_path
    video_path = from_native_share_path(video_path) or video_path
    vp = Path(video_path)
    if not vp.exists():
        raise HTTPException(status_code=400, detail=f"Fichier introuvable : {video_path}")

    fk = frame_keep if frame_keep and frame_keep >= 2 else None
    is_optional_format = supports_filename(str(vp))

    # Multi-séquence : le fichier serveur devient une séquence ajoutée à la suite
    base_index = project.frame_count
    seq = _create_sequence(
        session, project_id,
        name=(sequence_name.strip() or vp.stem),
        source_type="optional_format" if is_optional_format else "video",
        source_path=str(vp),
        start_index=base_index,
    )

    try:
        if is_optional_format:
            # optional_format serveur : extraction complete vers PNG dans {optional_format_dir}/{optional_format_stem}_png/
            frame_records, width, height, png_dir = dataset_service.scan_optional_format_for_png_extraction(
                project_id=project_id,
                optional_format_path=str(vp),
                frame_keep=fk,
                filename_prefix=_seq_prefix(seq),
            )
            source_fps = 25.0
        else:
            frame_records, width, height, source_fps = dataset_service.scan_video_lazy(
                project_id=project_id,
                video_path=str(vp),
                frame_keep=fk,
                jpeg_quality=jpeg_quality,
                initial_frames=initial_frames,
                lossless=lossless,
                filename_prefix=_seq_prefix(seq),
            )
    except Exception as e:
        session.rollback()
        raise HTTPException(status_code=422, detail=f"Erreur scan : {e}")

    _ = (width, height, source_fps)

    for fd in frame_records:
        frame = Frame(
            project_id=project_id,
            sequence_id=seq.id,
            frame_index=fd["frame_index"] + base_index,
            filename=fd["filename"],
            thumbnail_path=fd["thumbnail_path"],
            width=fd["width"],
            height=fd["height"],
            # optional_format on-the-fly (convert_png=False) : servable immédiatement (décodage
            # à la volée) → marquée extraite. Vidéo : extraction paresseuse habituelle.
            is_extracted=(fd["is_extracted"] or (is_optional_format and not convert_png)),
            source_frame_index=fd["source_frame_index"],
        )
        session.add(frame)

    seq.frame_count = len(frame_records)
    seq.fps = None if is_optional_format else source_fps
    session.add(seq)
    project.frame_count += len(frame_records)
    project.source_path = str(vp)   # compat : fallback
    session.add(project)
    session.commit()

    task_id = str(uuid.uuid4())
    create_task(task_id, f"Import {'optional_format' if is_optional_format else 'video'} : {vp.name}")
    total_frames = len(frame_records)

    if is_optional_format and not convert_png:
        # optional_format on-the-fly (défaut) : AUCUNE extraction. Frames servies ET trackées
        # en décodant le .optional à la volée (seek O(1)) → import instantané, zéro
        # doublon disque. convert_png=1 pour tout extraire en PNG (long).
        update_task(task_id, "completed", 100, f"{total_frames} frames (optional_format on-the-fly)")
        return {"success": True, "task_id": task_id,
                "frames_registered": total_frames, "frames_extracted": 0}

    if is_optional_format:
        # optional_format serveur + convert_png : extraction complete vers PNG en arriere-plan
        update_task(task_id, "running", 0, f"0/{total_frames} frames PNG")

        _optional_format_path   = str(vp)
        _png_dir    = png_dir
        _project_id = project_id
        _total      = total_frames
        _fk         = fk
        _batch_size = max(1, extraction_batch_size)
        _task_id    = task_id
        _prefix     = _seq_prefix(seq)

        def _extract_optional_format_path_png_bg():
            from sqlmodel import Session as DBSession
            from backend.database import engine as _engine
            from backend.services.task_registry import update_task as _upd
            from backend.services.format_registry import invoke_for_filename

            frame_step  = max(1, _fk) if _fk and _fk >= 2 else 1
            extracted   = 0
            batch_names = []

            for db_idx in range(_total):
                source_idx = db_idx * frame_step
                filename   = f"{_prefix}frame_{db_idx:06d}.png"
                dst        = Path(_png_dir) / filename
                try:
                    if not dst.exists():
                        img, _ = invoke_for_filename(
                            _optional_format_path,
                            "read",
                            _optional_format_path,
                            seq_range=(source_idx, source_idx + 1),
                        )
                        frame_bgr = dataset_service._optional_format_frame_to_bgr(img)
                        cv2.imwrite(str(dst), frame_bgr)
                    batch_names.append(filename)
                except Exception as e:
                    print(f"[optional_format->PNG] frame {db_idx}: {e}")
                    batch_names.append(filename)

                extracted += 1
                if len(batch_names) >= _batch_size:
                    with DBSession(_engine) as db:
                        for fn in batch_names:
                            fo = db.exec(
                                select(Frame)
                                .where(Frame.project_id == _project_id)
                                .where(Frame.filename == fn)
                            ).first()
                            if fo:
                                fo.is_extracted = True
                                db.add(fo)
                        db.commit()
                    batch_names = []
                    _upd(_task_id, "running", min(99, int(extracted / _total * 100)),
                         f"{extracted}/{_total} frames optional_format -> PNG")

            if batch_names:
                with DBSession(_engine) as db:
                    for fn in batch_names:
                        fo = db.exec(
                            select(Frame)
                            .where(Frame.project_id == _project_id)
                            .where(Frame.filename == fn)
                        ).first()
                        if fo:
                            fo.is_extracted = True
                            db.add(fo)
                    db.commit()

            _upd(_task_id, "completed", 100, f"{_total} frames optional_format -> PNG")

        background_tasks.add_task(_extract_optional_format_path_png_bg)
    else:
        # MP4 : extraction complète en arrière-plan
        n_extracted = sum(1 for r in frame_records if r["is_extracted"])
        unextracted = [(r["filename"], r["source_frame_index"]) for r in frame_records if not r["is_extracted"]]

        if unextracted:
            update_task(task_id, "running",
                        int(n_extracted / max(total_frames, 1) * 100),
                        f"{n_extracted}/{total_frames} frames extraites")

            _video_path   = str(vp)
            _project_id   = project_id
            _jpeg_quality = jpeg_quality
            _lossless     = lossless
            _n_init       = n_extracted
            _total        = total_frames
            _unextracted  = list(unextracted)
            _task_id      = task_id
            _batch_size   = max(1, extraction_batch_size)

            def _extract_path_bg():
                from sqlmodel import Session as DBSession
                from backend.database import engine as _engine
                from backend.services.task_registry import update_task as _upd

                extracted_count = _n_init

                def on_batch(filenames):
                    nonlocal extracted_count
                    with DBSession(_engine) as db:
                        for fn in filenames:
                            frame_obj = db.exec(
                                select(Frame)
                                .where(Frame.project_id == _project_id)
                                .where(Frame.filename == fn)
                            ).first()
                            if frame_obj:
                                frame_obj.is_extracted = True
                                db.add(frame_obj)
                        db.commit()
                    extracted_count += len(filenames)
                    progress = min(99, int(extracted_count / _total * 100))
                    _upd(_task_id, "running", progress,
                         f"{extracted_count}/{_total} frames extraites")

                try:
                    dataset_service.extract_video_frames_sequential(
                        _project_id, _video_path, _unextracted,
                        _jpeg_quality, _lossless, on_batch, _batch_size
                    )
                except Exception as e:
                    print(f"[import_video_from_path] Erreur extraction : {e}")

                _upd(_task_id, "completed", 100, f"{_total} frames extraites")

            background_tasks.add_task(_extract_path_bg)
        else:
            update_task(task_id, "completed", 100, f"{total_frames} frames extraites")

    return {
        "success": True,
        "task_id": task_id,
        "frames_registered": total_frames,
        "frames_extracted": 0 if is_optional_format else n_extracted,
    }


# ---- Conversion vidéo → optional_format (tâche en arrière-plan) ----

@router.post("/api/convert/video_to_optional_format", response_model=dict)
async def convert_video_to_optional_format_endpoint(
    background_tasks: BackgroundTasks,
    video_path: str = Form(...),
    output_path: str = Form(""),    # vide = même dossier que la vidéo source
    frame_keep: int = Form(0),
    grayscale: bool = Form(True),
):
    """
    Convertit un fichier vidéo (MP4, AVI…) en optional_format par lecture séquentielle.

    optional_format = frames de taille fixe → seek O(1) → lecture à la volée ultra-rapide.
    Pas de décompression H.264 lors de la navigation.
    """
    from backend.services.task_registry import create_task, update_task as _upd_create

    vp = Path(video_path)
    if not vp.exists():
        raise HTTPException(status_code=400, detail=f"Fichier introuvable : {video_path}")

    if output_path.strip():
        out = Path(output_path.strip())
    else:
        out = vp.with_suffix(preferred_extension())

    if out.exists():
        raise HTTPException(status_code=400, detail=f"Fichier de destination existe déjà : {out}")

    fk = frame_keep if frame_keep and frame_keep >= 2 else None
    task_id = str(uuid.uuid4())
    create_task(task_id, f"Conversion optional_format : {vp.name}")

    _vp   = str(vp)
    _out  = str(out)
    _fk   = fk
    _gray = grayscale
    _tid  = task_id

    def _run_convert():
        from backend.services.task_registry import update_task as _upd
        _upd(_tid, "running", 0, "Conversion en cours…")
        try:
            def on_progress(current, total):
                pct = min(99, int(current / max(total, 1) * 100))
                _upd(_tid, "running", pct, f"{current}/{total} frames converties")

            dataset_service.convert_video_to_optional_format(_vp, _out, _fk, _gray, on_progress)
            _upd(_tid, "completed", 100, f"optional_format créé : {_out}")
        except Exception as e:
            _upd(_tid, "error", 0, str(e), error=str(e))

    background_tasks.add_task(_run_convert)

    return {
        "success": True,
        "task_id": task_id,
        "output_path": str(out),
    }
