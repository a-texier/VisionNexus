# ============================================================
# routers/export.py
# Endpoints pour l'export du dataset au format YOLO.
# Génère la structure train/val/test avec data.yaml.
# Supporte l'export en arrière-plan pour les grands datasets.
# ============================================================

import os
import re
from datetime import datetime
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlmodel import Session, select

from backend.database import get_session
from backend.models.annotation import Annotation
from backend.models.frame import Frame
from backend.models.label_class import LabelClass
from backend.models.project import Project
from backend.services.format_registry import supports_filename

router = APIRouter(tags=["Export"])


# ---- Schémas ----

def _mark_sequences_exported(db, sequence_ids, fmt: str) -> None:
    """Horodate le dernier export des sequences concernees.

    C'est ce qui rend une sequence "terminee" dans le monitoring : annotee ne
    suffit pas, il faut que le jeu de donnees soit sorti. `None` dans la liste
    designe la pseudo-sequence legacy, qui n'a pas de ligne a mettre a jour.
    """
    from datetime import datetime as _dt
    # Import local : Sequence n'est pas dans les imports du module (seulement
    # dans run_export). Sans lui, chaque appel levait NameError, avale par le
    # except ci-dessous -> "Avertissement marquage sequences : name 'Sequence'
    # is not defined" a chaque export, et AUCUNE sequence n'a jamais ete
    # horodatee : le monitoring les voyait toutes comme non exportees.
    from backend.models.sequence import Sequence
    ids = [s for s in sequence_ids if s is not None]
    if not ids:
        return
    try:
        now = _dt.now()
        for seq in db.exec(select(Sequence).where(Sequence.id.in_(ids))).all():
            seq.last_export_at = now
            seq.last_export_format = fmt
            db.add(seq)
        db.commit()
    except Exception as e:
        # Un echec de tracabilite ne doit jamais invalider un export reussi.
        print(f"[export] Avertissement marquage sequences : {e}")


class ExportRequest(BaseModel):
    """Paramètres d'export."""
    format: str = "yolo_bbox"            # yolo_bbox | yolo_polygon
    output_format: str = "yolo"          # 'yolo' = dossier yolo par séquence | 'ver' = fichier .ver par séquence
    split_train: float = 0.8
    split_val: float = 0.1
    split_test: float = 0.1
    include_unannotated: bool = True     # Inclure les frames sans annotation (ligne 0 en .ver) (S11)
    class_filter: Optional[List[int]] = None  # None = toutes les classes
    export_name: Optional[str] = None   # Nom personnalisé pour le ZIP
    symlink_images: bool = True          # True = liens symboliques (pas de ZIP), False = copie + ZIP
    custom_export_dir: Optional[str] = None  # Dossier de destination (mode solo uniquement)


# Stockage en mémoire des tâches d'export (production → Redis)
_export_tasks: dict = {}


# ---- Endpoints ----

@router.post("/api/projects/{project_id}/export", response_model=dict)
def start_export(
    project_id: int,
    background_tasks: BackgroundTasks,
    data: ExportRequest,
    session: Session = Depends(get_session),
):
    """
    Lance l'export du dataset en arrière-plan.
    Retourne un task_id pour suivre la progression et télécharger le fichier.

    Validation préalable : vérifie que le projet a des annotations et des classes.
    """
    import uuid

    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Projet introuvable")

    # Validation de la somme des splits
    total = data.split_train + data.split_val + data.split_test
    if abs(total - 1.0) > 0.01:
        raise HTTPException(
            status_code=422,
            detail=f"La somme des splits doit être 1.0, reçu {total:.2f}"
        )

    # Récupération des classes
    classes = session.exec(
        select(LabelClass)
        .where(LabelClass.project_id == project_id)
        .order_by(LabelClass.class_index)
    ).all()

    if not classes:
        raise HTTPException(status_code=400, detail="Le projet n'a pas de classes définies")

    # ID unique de tâche
    task_id = str(uuid.uuid4())
    _export_tasks[task_id] = {
        "status": "pending",
        "progress": 0.0,
        "project_id": project_id,
        "zip_path": None,
        "folder_path": None,
        "error": None,
    }

    # Préparation des données pour la tâche de fond
    # Nom hiérarchique complet : classe[_sous-classe[_sous-sous-classe]]
    class_names = [c.full_name for c in classes]
    class_index_map = {c.id: c.class_index for c in classes}
    # Hiérarchie brute pour l'export .ver : class / subclass / name
    class_hierarchy = {
        c.id: (c.name, c.subclass or "None", c.subsubclass or "None") for c in classes
    }

    # Nom de l'export : project_name_date (ou nom personnalisé)
    safe_project_name = re.sub(r'[^\w\-]', '_', project.name)
    export_timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    auto_export_name = data.export_name or f"{safe_project_name}_{export_timestamp}"

    # Destination : traduire un chemin UNC Windows saisi/depose par l'utilisateur
    # (\\<native_share_host>\<share>\...) en chemin POSIX, comme le fait deja l'entree
    # cote import (dataset.py). Le backend tourne sur la VM Linux : sans cette
    # traduction, Path() traitait la chaine UNC comme un nom RELATIF et
    # mkdir(parents=True) creait un dossier reellement NOMME
    # "\\<native_share_host>\<share>\..." dans le repertoire courant du process.
    # L'export rendait donc 200 OK, sans erreur, et les fichiers etaient
    # introuvables la ou l'utilisateur les attendait.
    export_dir_override = (data.custom_export_dir or "").strip() or None
    if export_dir_override:
        from backend.utils.native_share import from_native_share_path
        export_dir_override = from_native_share_path(export_dir_override) or export_dir_override

    async def run_export():
        """Tâche d'export exécutée en arrière-plan.

        Multi-séquence :
          - output_format='yolo' : un sous-dossier {sequence}-yolo par séquence annotée
            dans le dossier projet ; ZIP unique du dossier parent si copie.
          - output_format='ver'  : un fichier {sequence}.ver par séquence (format texte natif :
            frame_id(1-based) visibility x1 y1 x2 y2 track_id class subclass name).
          - Projet sans séquence (legacy) : export YOLO classique à plat.
        """
        import shutil
        import zipfile
        from backend.services.dataset_service import dataset_service
        from backend.models.sequence import Sequence
        from backend.models.track import Track
        from sqlmodel import Session as DBSession
        from backend.database import engine

        _export_tasks[task_id]["status"] = "running"

        def _collect_frames(db, sequence_id=None, legacy_only=False):
            """Frames + annotations sérialisées, filtrées par séquence."""
            query = select(Frame).where(Frame.project_id == project_id).order_by(Frame.frame_index)
            if not data.include_unannotated:
                query = query.where(
                    (Frame.is_annotated == True) | (Frame.is_empty == True)
                )
            if sequence_id is not None:
                query = query.where(Frame.sequence_id == sequence_id)
            elif legacy_only:
                query = query.where(Frame.sequence_id == None)  # noqa: E711
            frames = db.exec(query).all()

            out = []
            for frame in frames:
                annotations = db.exec(
                    select(Annotation).where(Annotation.frame_id == frame.id)
                ).all()
                if data.class_filter:
                    annotations = [a for a in annotations if a.class_id in data.class_filter]
                out.append({
                    "filename": frame.filename,
                    "frame_index": frame.frame_index,
                    "width": frame.width,
                    "height": frame.height,
                    "is_empty": frame.is_empty,
                    "is_extracted": frame.is_extracted,
                    "source_frame_index": frame.source_frame_index,
                    "annotations": [
                        {
                            "class_id": a.class_id,
                            "cx": a.cx,
                            "cy": a.cy,
                            "width": a.width,
                            "height": a.height,
                            "track_id": a.track_id,
                            "annotation_type": a.annotation_type.value if hasattr(a.annotation_type, "value") else str(a.annotation_type),
                            "points": a.points,  # JSON string ou None
                        }
                        for a in annotations
                    ],
                })
            return out

        def _optional_format_png_dir_for(source_path):
            if not source_path:
                return None
            sp = Path(source_path)
            if supports_filename(str(sp)):
                candidate = sp.parent / f"{sp.stem}_png"
                if candidate.exists():
                    return str(candidate)
            return None

        def _write_ver_file(path, frames_annotations, start_index, track_uid_map):
            """Écrit un fichier .ver : frame_id(1-based) vis x1 y1 x2 y2 track_id
            classe sous-classe sous-sous-classe. Coordonnées ABSOLUES (pixels) —
            convention .ver historique. Champs de classe vides = « None »
            (jamais « - »)."""
            lines = [
                "# Format .ver : frame_id visibility x1 y1 x2 y2 track_id classe sous-classe sous-sous-classe",
                "# Coordonnees ABSOLUES (pixels), coins. Champs de classe absents = None.",
            ]
            n_boxes = 0
            for fa in frames_annotations:
                w = fa["width"] or 1
                h = fa["height"] or 1
                # frame_id relatif à la séquence, 1-based (convention .ver)
                frame_1b = fa["frame_index"] - start_index + 1
                frame_had_box = False
                for ann in fa["annotations"]:
                    if ann["annotation_type"] == "polygon" and not ann["width"]:
                        continue
                    # Coins en PIXELS (convention .ver absolue).
                    x1 = int(round((ann["cx"] - ann["width"] / 2) * w))
                    y1 = int(round((ann["cy"] - ann["height"] / 2) * h))
                    x2 = int(round((ann["cx"] + ann["width"] / 2) * w))
                    y2 = int(round((ann["cy"] + ann["height"] / 2) * h))
                    # Pas de piste (ex : détections GD/SAM3 « -- track ») → track_id -1,
                    # jamais 0 (0 est un uid de piste valide). (step S6)
                    tuid = track_uid_map.get(ann["track_id"], -1) if ann["track_id"] else -1
                    cls_name, sub_class, subsub_class = class_hierarchy.get(
                        ann["class_id"], ("unknown", "None", "None")
                    )
                    lines.append(
                        f"{frame_1b} 1 {x1} {y1} {x2} {y2} {tuid} {cls_name} {sub_class} {subsub_class}"
                    )
                    n_boxes += 1
                    frame_had_box = True
                # Frame incluse mais sans annotation (include_unannotated) → ligne
                # remplie de 0 (visibility 0, bbox 0, track 0) pour marquer « rien ».
                # Champs de classe = None (jamais « - »). (step S11 + step1)
                if not frame_had_box:
                    lines.append(f"{frame_1b} 0 0 0 0 0 0 None None None")
            Path(path).parent.mkdir(parents=True, exist_ok=True)
            with open(path, "w", encoding="utf-8") as f:
                f.write("\n".join(lines) + "\n")
            return n_boxes

        try:
            with DBSession(engine) as db:
                sequences = db.exec(
                    select(Sequence)
                    .where(Sequence.project_id == project_id)
                    .order_by(Sequence.start_index)
                ).all()

                # Pseudo-séquences : chaque Sequence + éventuellement les frames legacy
                seq_specs = []   # (name, sequence_id|None, start_index, source_path)
                legacy_exists = db.exec(
                    select(Frame.id)
                    .where(Frame.project_id == project_id)
                    .where(Frame.sequence_id == None)  # noqa: E711
                    .limit(1)
                ).first()
                if legacy_exists:
                    proj = db.get(Project, project_id)
                    seq_specs.append(("sequence_principale", None, 0,
                                      proj.source_path if proj else None))
                for s in sequences:
                    safe = re.sub(r'[^\w\-]', '_', s.name) or f"sequence_{s.id}"
                    seq_specs.append((safe, s.id, s.start_index, s.source_path))

                # Map track_id (DB) -> track_uid (persistant, pour .ver)
                track_uid_map = {
                    t.id: t.track_uid
                    for t in db.exec(select(Track).where(Track.project_id == project_id)).all()
                }

                base_dir = Path(export_dir_override) if export_dir_override else dataset_service.exports_dir
                base_dir.mkdir(parents=True, exist_ok=True)

                # ------------------------------------------------------
                # Format .ver : un fichier par séquence
                # ------------------------------------------------------
                if data.output_format == "ver":
                    parent_dir = base_dir / auto_export_name
                    parent_dir.mkdir(parents=True, exist_ok=True)
                    total_boxes = 0
                    exported = 0
                    exported_seq_ids = []
                    for i, (name, seq_id, start_index, _src) in enumerate(seq_specs):
                        fa = _collect_frames(db, sequence_id=seq_id, legacy_only=(seq_id is None))
                        if not any(f["annotations"] for f in fa):
                            continue
                        total_boxes += _write_ver_file(
                            parent_dir / f"{name}.ver", fa, start_index, track_uid_map
                        )
                        exported += 1
                        exported_seq_ids.append(seq_id)
                        _export_tasks[task_id]["progress"] = 0.1 + 0.8 * ((i + 1) / max(len(seq_specs), 1))

                    if exported == 0:
                        _export_tasks[task_id]["status"] = "error"
                        _export_tasks[task_id]["error"] = "Aucune annotation à exporter en .ver"
                        shutil.rmtree(parent_dir, ignore_errors=True)
                        return

                    zip_path = None
                    if not data.symlink_images:
                        zip_path = base_dir / f"{auto_export_name}.zip"
                        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
                            for file in parent_dir.rglob("*"):
                                if file.is_file():
                                    zf.write(file, file.relative_to(parent_dir.parent))

                    _mark_sequences_exported(db, exported_seq_ids, "ver")
                    _export_tasks[task_id]["status"] = "completed"
                    _export_tasks[task_id]["progress"] = 1.0
                    _export_tasks[task_id]["zip_path"] = str(zip_path) if zip_path else None
                    _export_tasks[task_id]["folder_path"] = str(parent_dir)
                    return

                # ------------------------------------------------------
                # Format COCO (instances_{split}.json)
                # ------------------------------------------------------
                if data.output_format == "coco":
                    if len(seq_specs) <= 1:
                        seq_id = seq_specs[0][1] if seq_specs else None
                        fa = _collect_frames(db, sequence_id=seq_id, legacy_only=(seq_id is None))
                        if not fa:
                            _export_tasks[task_id]["status"] = "error"
                            _export_tasks[task_id]["error"] = "Aucune frame annotée à exporter"
                            return
                        _export_tasks[task_id]["progress"] = 0.6
                        src = seq_specs[0][3] if seq_specs else None
                        result = dataset_service.export_coco_dataset(
                            project_id=project_id,
                            class_names=class_names,
                            class_index_map=class_index_map,
                            frames_annotations=fa,
                            split_ratios=(data.split_train, data.split_val, data.split_test),
                            include_unannotated=data.include_unannotated,
                            export_name=auto_export_name,
                            use_symlink=data.symlink_images,
                            optional_format_source_path=_optional_format_png_dir_for(src),
                            output_base_dir=export_dir_override,
                        )
                        _mark_sequences_exported(db, [seq_id], "coco")
                        _export_tasks[task_id]["status"] = "completed"
                        _export_tasks[task_id]["progress"] = 1.0
                        _export_tasks[task_id]["zip_path"] = result["zip_path"]
                        _export_tasks[task_id]["folder_path"] = result["folder_path"]
                        return

                    exported = 0
                    exported_seq_ids = []
                    for i, (name, seq_id, _start, src) in enumerate(seq_specs):
                        fa = _collect_frames(db, sequence_id=seq_id, legacy_only=(seq_id is None))
                        has_content = any(f["annotations"] or f["is_empty"] for f in fa)
                        if not fa or (not data.include_unannotated and not has_content):
                            continue
                        dataset_service.export_coco_dataset(
                            project_id=project_id,
                            class_names=class_names,
                            class_index_map=class_index_map,
                            frames_annotations=fa,
                            split_ratios=(data.split_train, data.split_val, data.split_test),
                            include_unannotated=data.include_unannotated,
                            export_name=f"{auto_export_name}/{name}-coco",
                            use_symlink=data.symlink_images,
                            optional_format_source_path=_optional_format_png_dir_for(src),
                            output_base_dir=export_dir_override,
                            make_zip=False,
                        )
                        exported += 1
                        exported_seq_ids.append(seq_id)
                        _export_tasks[task_id]["progress"] = 0.1 + 0.8 * ((i + 1) / len(seq_specs))

                    if exported == 0:
                        _export_tasks[task_id]["status"] = "error"
                        _export_tasks[task_id]["error"] = "Aucune frame annotée à exporter"
                        return

                    parent_dir = base_dir / auto_export_name
                    zip_path = None
                    if not data.symlink_images:
                        zip_path = base_dir / f"{auto_export_name}.zip"
                        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
                            for file in parent_dir.rglob("*"):
                                if file.is_file():
                                    zf.write(file, file.relative_to(parent_dir.parent))
                        shutil.rmtree(parent_dir, ignore_errors=True)

                    _mark_sequences_exported(db, exported_seq_ids, "coco")
                    _export_tasks[task_id]["status"] = "completed"
                    _export_tasks[task_id]["progress"] = 1.0
                    _export_tasks[task_id]["zip_path"] = str(zip_path) if zip_path else None
                    _export_tasks[task_id]["folder_path"] = None if zip_path else str(parent_dir)
                    return

                # ------------------------------------------------------
                # Format YOLO
                # ------------------------------------------------------
                if len(seq_specs) <= 1:
                    # Projet mono-séquence / legacy : export YOLO classique à plat
                    seq_id = seq_specs[0][1] if seq_specs else None
                    frames_annotations = _collect_frames(
                        db, sequence_id=seq_id, legacy_only=(seq_id is None)
                    )
                    if not frames_annotations:
                        _export_tasks[task_id]["status"] = "error"
                        _export_tasks[task_id]["error"] = "Aucune frame annotée à exporter"
                        return
                    _export_tasks[task_id]["progress"] = 0.6
                    src = seq_specs[0][3] if seq_specs else None
                    result = dataset_service.export_yolo_dataset(
                        project_id=project_id,
                        class_names=class_names,
                        class_index_map=class_index_map,
                        frames_annotations=frames_annotations,
                        split_ratios=(data.split_train, data.split_val, data.split_test),
                        include_unannotated=data.include_unannotated,
                        export_name=auto_export_name,
                        use_symlink=data.symlink_images,
                        optional_format_source_path=_optional_format_png_dir_for(src),
                        output_base_dir=export_dir_override,
                    )
                    _mark_sequences_exported(db, [seq_id], "yolo")
                    _export_tasks[task_id]["status"] = "completed"
                    _export_tasks[task_id]["progress"] = 1.0
                    _export_tasks[task_id]["zip_path"] = result["zip_path"]
                    _export_tasks[task_id]["folder_path"] = result["folder_path"]
                    return

                # Multi-séquence : un sous-dossier {sequence}-yolo par séquence annotée
                exported = 0
                exported_seq_ids = []
                for i, (name, seq_id, _start, src) in enumerate(seq_specs):
                    fa = _collect_frames(db, sequence_id=seq_id, legacy_only=(seq_id is None))
                    has_content = any(f["annotations"] or f["is_empty"] for f in fa)
                    if not fa or (not data.include_unannotated and not has_content):
                        continue
                    dataset_service.export_yolo_dataset(
                        project_id=project_id,
                        class_names=class_names,
                        class_index_map=class_index_map,
                        frames_annotations=fa,
                        split_ratios=(data.split_train, data.split_val, data.split_test),
                        include_unannotated=data.include_unannotated,
                        export_name=f"{auto_export_name}/{name}-yolo",
                        use_symlink=data.symlink_images,
                        optional_format_source_path=_optional_format_png_dir_for(src),
                        output_base_dir=export_dir_override,
                        make_zip=False,   # ZIP unique du parent à la fin
                    )
                    exported += 1
                    exported_seq_ids.append(seq_id)
                    _export_tasks[task_id]["progress"] = 0.1 + 0.8 * ((i + 1) / len(seq_specs))

                if exported == 0:
                    _export_tasks[task_id]["status"] = "error"
                    _export_tasks[task_id]["error"] = "Aucune frame annotée à exporter"
                    return

                parent_dir = base_dir / auto_export_name
                zip_path = None
                if not data.symlink_images:
                    zip_path = base_dir / f"{auto_export_name}.zip"
                    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
                        for file in parent_dir.rglob("*"):
                            if file.is_file():
                                zf.write(file, file.relative_to(parent_dir.parent))
                    shutil.rmtree(parent_dir, ignore_errors=True)

                _mark_sequences_exported(db, exported_seq_ids, "yolo")
                _export_tasks[task_id]["status"] = "completed"
                _export_tasks[task_id]["progress"] = 1.0
                _export_tasks[task_id]["zip_path"] = str(zip_path) if zip_path else None
                _export_tasks[task_id]["folder_path"] = None if zip_path else str(parent_dir)

        except Exception as e:
            _export_tasks[task_id]["status"] = "error"
            _export_tasks[task_id]["error"] = str(e)
            print(f"[export] Erreur : {e}")

    background_tasks.add_task(run_export)

    return {
        "task_id": task_id,
        "status": "pending",
        "project_id": project_id,
    }


@router.get("/api/exports/{task_id}/status", response_model=dict)
def get_export_status(task_id: str):
    """
    Retourne le statut d'une tâche d'export.
    Utilisé par le frontend pour poller la progression.
    """
    if task_id not in _export_tasks:
        raise HTTPException(status_code=404, detail="Tâche d'export introuvable")

    task = _export_tasks[task_id]
    return {
        "task_id": task_id,
        "status": task["status"],         # pending | running | completed | error
        "progress": task["progress"],
        "error": task["error"],
        "ready": task["status"] == "completed",
        "zip_path": task.get("zip_path"),
        "folder_path": task.get("folder_path"),
    }


@router.get("/api/exports/{task_id}/download")
def download_export(task_id: str):
    """
    Télécharge le fichier ZIP de l'export YOLO.
    N'est disponible qu'une fois la tâche terminée (status=completed).
    """
    if task_id not in _export_tasks:
        raise HTTPException(status_code=404, detail="Tâche d'export introuvable")

    task = _export_tasks[task_id]

    if task["status"] != "completed":
        raise HTTPException(
            status_code=400,
            detail=f"Export non terminé (statut: {task['status']})"
        )

    zip_path = task.get("zip_path")
    if not zip_path:
        raise HTTPException(
            status_code=400,
            detail="Export en mode symlink : pas de ZIP. Utilisez le chemin du dossier retourné."
        )
    if not Path(zip_path).exists():
        raise HTTPException(status_code=404, detail="Fichier ZIP introuvable")

    filename = Path(zip_path).name
    return FileResponse(
        path=zip_path,
        filename=filename,
        media_type="application/zip",
    )


@router.get("/api/projects/{project_id}/export/preview", response_model=dict)
def preview_export(
    project_id: int,
    session: Session = Depends(get_session),
):
    """
    Génère un aperçu de ce qui sera exporté : statistiques par classe,
    distribution des splits, validation des coordonnées.
    Utilisé par le modal d'export pour informer l'utilisateur avant le lancement.
    """
    from backend.utils.yolo_utils import validate_yolo_coordinates

    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Projet introuvable")

    # Statistiques globales
    all_frames = session.exec(
        select(Frame).where(Frame.project_id == project_id)
    ).all()
    annotated_frames = [f for f in all_frames if f.is_annotated]
    empty_frames = [f for f in all_frames if f.is_empty]

    # Statistiques par classe
    classes = session.exec(
        select(LabelClass)
        .where(LabelClass.project_id == project_id)
        .order_by(LabelClass.class_index)
    ).all()

    class_stats = []
    total_invalid = 0

    for cls in classes:
        # Nombre d'annotations pour cette classe
        annotations = session.exec(
            select(Annotation)
            .join(Frame, Annotation.frame_id == Frame.id)
            .where(Frame.project_id == project_id)
            .where(Annotation.class_id == cls.id)
        ).all()

        # Vérification des coordonnées
        invalid_count = sum(
            1 for a in annotations
            if not validate_yolo_coordinates(a.cx, a.cy, a.width, a.height)[0]
        )
        total_invalid += invalid_count

        class_stats.append({
            "class_id": cls.id,
            "class_name": cls.name,
            "color": cls.color,
            "annotation_count": len(annotations),
            "invalid_coords": invalid_count,
        })

    # Génération du data.yaml prévisualisé
    preview_yaml = {
        "path": "./dataset",
        "train": "images/train",
        "val": "images/val",
        "test": "images/test",
        "nc": len(classes),
        "names": [c.full_name for c in classes],
    }

    return {
        "total_frames": len(all_frames),
        "annotated_frames": len(annotated_frames),
        "empty_frames": len(empty_frames),
        "unannotated_frames": len(all_frames) - len(annotated_frames) - len(empty_frames),
        "class_stats": class_stats,
        "total_invalid_coords": total_invalid,
        "preview_yaml": preview_yaml,
        "ready_to_export": total_invalid == 0 and len(annotated_frames) > 0,
    }
