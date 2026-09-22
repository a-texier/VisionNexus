# ============================================================
# models/project.py
# Modèle SQLModel représentant un projet d'annotation.
# Un projet regroupe un ensemble d'images ou de frames vidéo,
# les classes d'objets à annoter, et les pistes de tracking.
# ============================================================

from datetime import datetime
from enum import Enum
from typing import TYPE_CHECKING, List, Optional

from sqlmodel import Field, Relationship, SQLModel

if TYPE_CHECKING:
    # Importations conditionnelles pour éviter les imports circulaires
    from backend.models.frame import Frame
    from backend.models.label_class import LabelClass
    from backend.models.track import Track


class ProjectType(str, Enum):
    """Type de projet : dataset d'images non-séquentielles ou vidéo séquentielle."""
    IMAGE = "image"
    VIDEO = "video"


class Project(SQLModel, table=True):
    """
    Table principale des projets d'annotation.
    Chaque projet correspond à un dossier dans data/projects/{id}/.
    """
    __tablename__ = "project"

    # Clé primaire auto-incrémentée
    id: Optional[int] = Field(default=None, primary_key=True)

    # Nom lisible du projet (ex: "Dataset voitures urbaines")
    name: str = Field(index=True, min_length=1, max_length=255)

    # Description optionnelle pour documenter l'objectif du projet
    description: Optional[str] = Field(default=None, max_length=1000)

    # Type de dataset : images indépendantes ou séquence vidéo
    project_type: ProjectType = Field(default=ProjectType.IMAGE)

    # Chemin source original (dossier ou fichier vidéo fourni par l'utilisateur)
    source_path: Optional[str] = Field(default=None)

    # LUT d'affichage (remap 16/8 bits) au format JSON :
    #   {"mode": "sigma"|"minmax"|"manual", "sigma": 3.0, "lo": <float|null>, "hi": <float|null>}
    # null / absent => 3-sigma par défaut (comportement historique).
    lut_json: Optional[str] = Field(default=None)

    # Projet demo cree par le tutoriel interactif. Purement cosmetique cote
    # backend : le frontend l'affiche en orange et le tutoriel le retrouve par
    # ce drapeau. Supprimable comme n'importe quel projet.
    is_template: bool = Field(default=False)

    # Nombre total de frames/images dans le projet
    frame_count: int = Field(default=0)

    # Nombre de frames ayant au moins une annotation
    annotated_count: int = Field(default=0)

    # Horodatages de création et de dernière modification
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    # ---- Relations SQLModel ----
    # Une liste de classes d'objets (ex: voiture, camion, piéton)
    classes: List["LabelClass"] = Relationship(back_populates="project")

    # Toutes les frames/images du projet
    frames: List["Frame"] = Relationship(back_populates="project")

    # Toutes les pistes de tracking multi-objets
    tracks: List["Track"] = Relationship(back_populates="project")
