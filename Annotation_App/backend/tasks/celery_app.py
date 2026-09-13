# ============================================================
# tasks/celery_app.py
# Configuration de l'application Celery pour les tâches asynchrones longues.
#
# Celery gère les traitements qui ne doivent pas bloquer l'API FastAPI :
#   - Auto-segmentation SAM2 batch (toutes les frames)
#   - Export YOLO
#   - Propagation homographique longue
#
# Prérequis :
#   - Redis en cours d'exécution sur localhost:6379
#   - Démarrer le worker : celery -A backend.tasks.celery_app worker --loglevel=info
#   - Sur Windows : celery -A backend.tasks.celery_app worker --loglevel=info -P solo
# ============================================================

from celery import Celery

# ---- Configuration Celery ----
# Broker : Redis pour la file de messages (FIFO)
# Backend : Redis pour stocker les résultats des tâches
celery_app = Celery(
    "annotation_tasks",
    broker="redis://localhost:6379/0",
    backend="redis://localhost:6379/1",
    include=[
        "backend.tasks.sam_tasks",
        "backend.tasks.export_tasks",
    ],
)

celery_app.conf.update(
    # Sérialisation JSON pour la portabilité
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],

    # Expiration des résultats après 1 heure
    result_expires=3600,

    # 1 tâche GPU à la fois (évite les conflits mémoire)
    worker_prefetch_multiplier=1,

    # Acknowledge la tâche seulement après son achèvement
    # (permet la reprise en cas de crash du worker)
    task_acks_late=True,

    # Timeout par défaut des tâches : 30 minutes
    task_soft_time_limit=1800,
    task_time_limit=2000,

    # Fuseau horaire
    timezone="Europe/Paris",
    enable_utc=True,
)
