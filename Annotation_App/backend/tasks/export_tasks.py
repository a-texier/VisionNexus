# ============================================================
# tasks/export_tasks.py
# Tâches Celery pour l'export asynchrone du dataset YOLO.
# ============================================================

from typing import Dict, List, Optional

from backend.tasks.celery_app import celery_app


@celery_app.task(
    bind=True,
    name="tasks.export_yolo",
    max_retries=1,
)
def export_yolo_task(
    self,
    project_id: int,
    class_names: List[str],
    class_index_map: Dict[int, int],
    split_train: float = 0.8,
    split_val: float = 0.1,
    split_test: float = 0.1,
    include_unannotated: bool = False,
    class_filter: Optional[List[int]] = None,
    export_name: Optional[str] = None,
) -> Dict:
    """
    Tâche Celery pour l'export YOLO complet d'un projet.
    Récupère toutes les annotations, génère la structure de dossiers
    et crée le fichier ZIP téléchargeable.

    Returns:
        Dict avec le chemin du ZIP et les statistiques d'export
    """
    from sqlmodel import Session, select
    from backend.database import engine
    from backend.models.annotation import Annotation
    from backend.models.frame import Frame
    from backend.services.dataset_service import dataset_service

    self.update_state(state="PROGRESS", meta={"step": "Récupération des annotations", "progress": 0.1})

    with Session(engine) as session:
        # Récupération des frames
        query = select(Frame).where(Frame.project_id == project_id).order_by(Frame.frame_index)
        if not include_unannotated:
            query = query.where((Frame.is_annotated == True) | (Frame.is_empty == True))
        frames = session.exec(query).all()

        if not frames:
            return {"error": "Aucune frame à exporter", "success": False}

        self.update_state(state="PROGRESS", meta={
            "step": f"Préparation de {len(frames)} frames",
            "progress": 0.2,
        })

        frames_annotations = []
        for i, frame in enumerate(frames):
            annotations = session.exec(
                select(Annotation).where(Annotation.frame_id == frame.id)
            ).all()

            if class_filter:
                annotations = [a for a in annotations if a.class_id in class_filter]

            frames_annotations.append({
                "filename": frame.filename,
                "is_empty": frame.is_empty,
                "annotations": [
                    {
                        "class_id": a.class_id,
                        "cx": a.cx,
                        "cy": a.cy,
                        "width": a.width,
                        "height": a.height,
                    }
                    for a in annotations
                ],
            })

            if i % 100 == 0:
                progress = 0.2 + 0.5 * (i / len(frames))
                self.update_state(state="PROGRESS", meta={
                    "step": f"Frame {i + 1}/{len(frames)}",
                    "progress": progress,
                })

    self.update_state(state="PROGRESS", meta={"step": "Génération du ZIP YOLO", "progress": 0.8})

    zip_path = dataset_service.export_yolo_dataset(
        project_id=project_id,
        class_names=class_names,
        class_index_map=class_index_map,
        frames_annotations=frames_annotations,
        split_ratios=(split_train, split_val, split_test),
        include_unannotated=include_unannotated,
        export_name=export_name,
    )

    return {
        "success": True,
        "zip_path": zip_path,
        "total_frames": len(frames_annotations),
        "progress": 1.0,
    }
