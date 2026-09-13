# ============================================================
# models/frame.py
# Représente une image ou une frame extraite d'une vidéo.
# Chaque frame est liée à un fichier physique dans
# data/projects/{project_id}/frames/ et possède ses annotations.
# ============================================================

from typing import TYPE_CHECKING, List, Optional

from sqlmodel import Field, Relationship, SQLModel

if TYPE_CHECKING:
    from backend.models.annotation import Annotation
    from backend.models.project import Project


class Frame(SQLModel, table=True):
    """
    Table des frames/images d'un projet.
    Le champ frame_index définit l'ordre de navigation (tri par timestamp pour vidéos).
    """
    __tablename__ = "frame"

    id: Optional[int] = Field(default=None, primary_key=True)

    # Référence vers le projet parent
    project_id: int = Field(foreign_key="project.id", index=True)

    # Référence vers la séquence source (multi-séquence).
    # None pour les frames importées avant l'introduction des séquences.
    sequence_id: Optional[int] = Field(default=None, foreign_key="sequence.id", index=True)

    # Position dans la séquence (0-based, trié par timestamp ou nom de fichier)
    frame_index: int = Field(index=True)

    # Chemin relatif depuis data/projects/{project_id}/frames/
    # ex: "frame_0001.jpg" ou "20240101_120000_000.jpg"
    filename: str

    # Chemin relatif de la miniature 160×90 px générée
    # ex: "thumb_0001.jpg" dans data/projects/{project_id}/thumbnails/
    thumbnail_path: Optional[str] = Field(default=None)

    # Dimensions de l'image originale (en pixels)
    width: int = Field(default=0)
    height: int = Field(default=0)

    # Timestamp UNIX en millisecondes (pour vidéos, tiré du nom de fichier)
    timestamp_ms: Optional[int] = Field(default=None)

    # Indique si cette frame a été choisie comme point de référence pour le tracking
    is_keyframe: bool = Field(default=False)

    # Vrai dès qu'au moins une annotation est présente sur cette frame
    is_annotated: bool = Field(default=False)

    # Indique explicitement que la frame ne contient aucun objet d'intérêt
    # (génère un fichier .txt vide YOLO lors de l'export)
    is_empty: bool = Field(default=False)

    # Score de confiance moyen de propagation (0.0 à 1.0)
    # Frames avec score < 0.5 apparaissent en orange sur la timeline
    propagation_confidence: Optional[float] = Field(default=None)

    # ---- Lazy extraction ----
    # True = le fichier physique existe sur disque et peut être servi.
    # False = enregistrement DB uniquement, extraction à la demande.
    # Les images importées directement ont toujours is_extracted=True.
    # Les frames vidéo/optional_format non encore extraites ont is_extracted=False.
    is_extracted: bool = Field(default=True)

    # Index de la frame dans le fichier source (vidéo ou optional_format).
    # Permet de chercher (seek) directement à la bonne position pour l'extraction.
    # None pour les images importées individuellement.
    source_frame_index: Optional[int] = Field(default=None)

    # ---- Relations ----
    project: Optional["Project"] = Relationship(back_populates="frames")
    annotations: List["Annotation"] = Relationship(back_populates="frame")
