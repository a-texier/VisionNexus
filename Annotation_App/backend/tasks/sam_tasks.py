# ============================================================
# tasks/sam_tasks.py
# Tâches Celery pour les opérations SAM2 longues en arrière-plan.
# Ces tâches s'exécutent dans des processus/threads séparés pour
# ne pas bloquer l'API FastAPI principale.
# ============================================================

import asyncio
from typing import Dict, List, Optional

from backend.tasks.celery_app import celery_app


@celery_app.task(
    bind=True,
    name="tasks.auto_segment_image",
    max_retries=2,
)
def auto_segment_image_task(
    self,
    project_id: int,
    frame_id: int,
    params: Dict,
    class_id: Optional[int] = None,
) -> Dict:
    """
    Tâche Celery pour l'auto-segmentation d'une image unique.
    Génère tous les masques SAM2 et les sauvegarde en base de données.

    Args:
        project_id: ID du projet
        frame_id: ID de la frame à segmenter
        params: Paramètres SAM2 (points_per_side, pred_iou_thresh, etc.)
        class_id: Classe à assigner aux annotations (None = non assignée)

    Returns:
        Dict avec nombre d'annotations créées et statut
    """
    from sqlmodel import Session, select
    from backend.database import engine
    from backend.models.frame import Frame
    from backend.models.annotation import Annotation, AnnotationType
    from backend.models.project import Project
    from backend.services.sam_service import sam_service
    from backend.services.dataset_service import dataset_service
    import json

    # Mise à jour du statut de la tâche
    self.update_state(state="PROGRESS", meta={"step": "Chargement de l'image", "progress": 0.1})

    with Session(engine) as session:
        frame = session.get(Frame, frame_id)
        if not frame:
            return {"error": f"Frame {frame_id} introuvable", "count": 0}

        image_path = str(dataset_service.get_frame_path(project_id, frame.filename))

    if not sam_service._model_loaded:
        # Tentative de chargement du modèle si pas encore fait
        loop = asyncio.new_event_loop()
        loop.run_until_complete(sam_service.load_model())
        loop.close()

    self.update_state(state="PROGRESS", meta={"step": "Segmentation SAM2 en cours", "progress": 0.3})

    # Exécution de l'auto-segmentation
    async def run_segmentation():
        masks = []
        async for mask_result in sam_service.auto_segment_image(
            image_path=image_path,
            image_width=frame.width,
            image_height=frame.height,
            **params,
        ):
            masks.append(mask_result)
        return masks

    loop = asyncio.new_event_loop()
    try:
        masks = loop.run_until_complete(run_segmentation())
    finally:
        loop.close()

    self.update_state(state="PROGRESS", meta={
        "step": f"Sauvegarde de {len(masks)} annotations",
        "progress": 0.8,
    })

    # Sauvegarde des annotations en base de données
    annotations_created = 0
    with Session(engine) as session:
        frame = session.get(Frame, frame_id)

        # Suppression des annotations auto existantes sur cette frame
        existing_auto = session.exec(
            select(Annotation)
            .where(Annotation.frame_id == frame_id)
            .where(Annotation.is_auto == True)
        ).all()
        for ann in existing_auto:
            session.delete(ann)

        # Ajout des nouvelles annotations
        for mask_result in masks:
            if not mask_result.bbox_yolo:
                continue

            ann = Annotation(
                frame_id=frame_id,
                class_id=class_id or 1,  # Classe par défaut si non spécifiée
                annotation_type=AnnotationType.BBOX,
                cx=mask_result.bbox_yolo[0],
                cy=mask_result.bbox_yolo[1],
                width=mask_result.bbox_yolo[2],
                height=mask_result.bbox_yolo[3],
                points=json.dumps(mask_result.polygon) if mask_result.polygon else None,
                confidence=mask_result.score,
                is_auto=True,
            )
            session.add(ann)
            annotations_created += 1

        # Mise à jour du statut de la frame
        if frame:
            frame.is_annotated = True
            session.add(frame)

            # Mise à jour du compteur du projet
            project = session.get(Project, project_id)
            if project:
                annotated_frames = session.exec(
                    select(Frame)
                    .where(Frame.project_id == project_id)
                    .where(Frame.is_annotated == True)
                ).all()
                project.annotated_count = len(annotated_frames)
                session.add(project)

        session.commit()

    return {
        "success": True,
        "frame_id": frame_id,
        "annotations_created": annotations_created,
        "progress": 1.0,
    }


@celery_app.task(
    bind=True,
    name="tasks.auto_segment_all_frames",
    max_retries=1,
)
def auto_segment_all_frames_task(
    self,
    project_id: int,
    frame_ids: List[int],
    params: Dict,
    class_id: Optional[int] = None,
) -> Dict:
    """
    Tâche Celery pour l'auto-segmentation de toutes les frames d'un projet.
    Traite les frames séquentiellement pour éviter les conflits GPU.

    Args:
        project_id: ID du projet
        frame_ids: Liste des IDs de frames à traiter
        params: Paramètres SAM2
        class_id: Classe à assigner aux annotations

    Returns:
        Dict avec le résumé du traitement (frames traitées, annotations créées)
    """
    total = len(frame_ids)
    total_annotations = 0
    errors = []

    for idx, frame_id in enumerate(frame_ids):
        progress = (idx + 1) / total

        self.update_state(state="PROGRESS", meta={
            "step": f"Frame {idx + 1}/{total}",
            "progress": progress,
            "current_frame_id": frame_id,
        })

        try:
            # Appel synchrone de la tâche de segmentation unitaire
            result = auto_segment_image_task(
                project_id=project_id,
                frame_id=frame_id,
                params=params,
                class_id=class_id,
            )
            total_annotations += result.get("annotations_created", 0)
        except Exception as e:
            errors.append({"frame_id": frame_id, "error": str(e)})

    return {
        "success": True,
        "total_frames": total,
        "total_annotations": total_annotations,
        "errors": errors,
        "error_count": len(errors),
    }
