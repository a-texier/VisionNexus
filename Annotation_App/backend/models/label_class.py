# ============================================================
# models/label_class.py
# Classe d'objet à annoter dans un projet (ex: voiture, camion).
# Correspond à une entrée dans le fichier classes.yaml YOLO.
# ============================================================

from typing import TYPE_CHECKING, List, Optional

from sqlmodel import Field, Relationship, SQLModel

if TYPE_CHECKING:
    from backend.models.annotation import Annotation
    from backend.models.project import Project
    from backend.models.track import Track


class LabelClass(SQLModel, table=True):
    """
    Table des classes d'objets annotables dans un projet.
    L'index de classe (class_index) correspond à l'indice dans le format YOLO.
    """
    __tablename__ = "labelclass"

    id: Optional[int] = Field(default=None, primary_key=True)

    # Référence vers le projet parent
    project_id: int = Field(foreign_key="project.id", index=True)

    # Nom de la classe (ex: "voiture", "camion", "pieton")
    name: str = Field(min_length=1, max_length=100)

    # Couleur hexadécimale pour l'affichage sur le canvas (ex: "#3B82F6")
    color: str = Field(default="#3B82F6", max_length=7)

    # Indice 0-based dans classes.yaml — doit être unique par projet
    class_index: int = Field(default=0)

    # Supercatégorie optionnelle (ex: "vehicle" pour voiture et camion)
    supercategory: Optional[str] = Field(default=None, max_length=100)

    # Hiérarchie taxonomique optionnelle :
    #   name        = classe (détection)        — obligatoire, ex: "drone"
    #   subclass    = sous-classe (reconnaissance)   — ex: "quadcoptere"
    #   subsubclass = sous-sous-classe (identification) — ex: "mavic"
    subclass: Optional[str] = Field(default=None, max_length=100)
    subsubclass: Optional[str] = Field(default=None, max_length=100)

    # Raccourci clavier 1-9 optionnel pour sélection rapide
    shortcut_key: Optional[str] = Field(default=None, max_length=1)

    @property
    def full_name(self) -> str:
        """Nom complet hiérarchique, ex: 'drone_quadcoptere_mavic'."""
        return "_".join(p for p in (self.name, self.subclass, self.subsubclass) if p)

    # ---- Relations ----
    project: Optional["Project"] = Relationship(back_populates="classes")
    annotations: List["Annotation"] = Relationship(back_populates="label_class")
    tracks: List["Track"] = Relationship(back_populates="label_class")
