# ============================================================
# models/track.py
# Piste de tracking multi-objets (ByteTrack).
# Une piste représente un objet unique suivi à travers plusieurs frames.
# Son ID (track_uid) reste stable même si ByteTrack réinitialise ses compteurs.
# ============================================================

from typing import TYPE_CHECKING, List, Optional

from sqlmodel import Field, Relationship, SQLModel

if TYPE_CHECKING:
    from backend.models.annotation import Annotation
    from backend.models.label_class import LabelClass
    from backend.models.project import Project


class Track(SQLModel, table=True):
    """
    Table des pistes de tracking.
    Chaque annotation peut être associée à une piste pour maintenir
    la cohérence de l'identité d'un objet à travers les frames.
    """
    __tablename__ = "track"

    id: Optional[int] = Field(default=None, primary_key=True)

    # Référence vers le projet parent
    project_id: int = Field(foreign_key="project.id", index=True)

    # Séquence propriétaire (multi-séquence). Les pistes sont DÉCORRÉLÉES par
    # séquence : uid, classes, propagation sont propres à une séquence. NULL =
    # frames legacy (pseudo-séquence principale). (S2b/c)
    sequence_id: Optional[int] = Field(default=None, foreign_key="sequence.id", index=True)

    # Identifiant stable de la piste, 0-based PAR SÉQUENCE (pas par projet)
    # Distinct de l'ID interne ByteTrack qui peut varier entre les runs
    track_uid: int = Field(default=0)

    # Classe de l'objet suivi (peut être mise à jour après relabellisation)
    class_id: int = Field(foreign_key="labelclass.id")

    # Couleur hexadécimale pour distinguer visuellement les pistes
    color: str = Field(default="#FF6B6B", max_length=7)

    # Indices de début et fin de piste (frame_index, pas frame.id)
    start_frame: int = Field(default=0)
    end_frame: int = Field(default=0)

    # Indique si la piste est encore active (false = supprimée manuellement)
    is_active: bool = Field(default=True)

    # Nombre de frames interpolées (générées automatiquement, pas annotées manuellement)
    interpolated_frames: int = Field(default=0)

    # ---- Relations ----
    project: Optional["Project"] = Relationship(back_populates="tracks")
    label_class: Optional["LabelClass"] = Relationship(back_populates="tracks")
    annotations: List["Annotation"] = Relationship(back_populates="track")
