# ============================================================
# models/session_state.py
# Persistance de l'état de la session d'annotation pour chaque projet.
# Permet de reprendre exactement là où l'utilisateur s'est arrêté
# (frame courante, zoom, outil sélectionné, etc.) à la réouverture.
# ============================================================

from datetime import datetime
from typing import Optional

from sqlmodel import Field, SQLModel


class SessionState(SQLModel, table=True):
    """
    Table de persistance des sessions d'annotation.
    Une seule entrée par projet (relation 1-1 avec Project).
    Sauvegardée automatiquement toutes les 30 secondes depuis le frontend.
    """
    __tablename__ = "sessionstate"

    id: Optional[int] = Field(default=None, primary_key=True)

    # Référence unique vers le projet (un projet = une session)
    project_id: int = Field(foreign_key="project.id", unique=True, index=True)

    # Index de la frame affichée lors de la dernière fermeture (frame_index, pas id)
    current_frame_index: int = Field(default=0)

    # Niveau de zoom du canvas (1.0 = 100%, 2.0 = 200%, etc.)
    zoom_level: float = Field(default=1.0)

    # Décalage du canvas (pan) en pixels logiques
    canvas_offset_x: float = Field(default=0.0)
    canvas_offset_y: float = Field(default=0.0)

    # ID de la classe sélectionnée dans le panneau latéral
    selected_class_id: Optional[int] = Field(default=None)

    # Outil actif : "select" | "bbox" | "polygon" | "sam_point" | "sam_auto"
    selected_tool: str = Field(default="select", max_length=20)

    # Snapshot JSON de la pile undo (max 50 entrées, format compressé)
    # Stocké comme chaîne JSON pour éviter une table séparée
    undo_stack_snapshot: Optional[str] = Field(default=None)

    # Filtre de la timeline/galerie : "all" | "unannotated" | "flagged"
    timeline_filter: str = Field(default="all", max_length=20)

    # Horodatage de la dernière sauvegarde automatique
    last_saved: datetime = Field(default_factory=datetime.utcnow)
