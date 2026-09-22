# ============================================================
# models/annotation.py
# Représente une annotation (bounding box ou polygone) sur une frame.
# Les coordonnées sont TOUJOURS stockées en format YOLO normalisé [0, 1].
# Format YOLO : cx cy w h  où cx,cy = centre, w,h = largeur/hauteur
# ============================================================

import json
from datetime import datetime
from enum import Enum
from typing import TYPE_CHECKING, List, Optional, Tuple

from sqlmodel import Field, Relationship, SQLModel

if TYPE_CHECKING:
    from backend.models.frame import Frame
    from backend.models.label_class import LabelClass
    from backend.models.track import Track


class AnnotationType(str, Enum):
    """Type géométrique de l'annotation."""
    BBOX = "bbox"        # Boîte englobante rectangulaire
    POLYGON = "polygon"  # Polygone pour la segmentation d'instance


class Annotation(SQLModel, table=True):
    """
    Table des annotations YOLO par frame.
    Chaque ligne correspond à un objet détecté/annoté sur une frame spécifique.

    IMPORTANT : toutes les coordonnées (cx, cy, width, height) sont normalisées
    dans l'intervalle [0, 1] par rapport aux dimensions de l'image.
    La conversion vers les coordonnées pixel se fait côté frontend (canvas).
    """
    __tablename__ = "annotation"

    id: Optional[int] = Field(default=None, primary_key=True)

    # Référence vers la frame parente
    frame_id: int = Field(foreign_key="frame.id", index=True)

    # Référence optionnelle vers une piste de tracking (None = annotation isolée)
    track_id: Optional[int] = Field(default=None, foreign_key="track.id", index=True)

    # Classe de l'objet (référence vers LabelClass)
    class_id: int = Field(foreign_key="labelclass.id")

    # Type géométrique : bbox (format YOLO standard) ou polygon
    annotation_type: AnnotationType = Field(default=AnnotationType.BBOX)

    # ---- Coordonnées YOLO normalisées [0, 1] ----
    # cx, cy : coordonnées du centre de la boîte
    cx: float = Field(default=0.5)
    cy: float = Field(default=0.5)
    # w, h : largeur et hauteur relatives à l'image
    width: float = Field(default=0.1)
    height: float = Field(default=0.1)

    # Points du polygone en JSON : "[[x1,y1],[x2,y2],...]" (coordonnées normalisées)
    # None si annotation_type == BBOX
    points: Optional[str] = Field(default=None)

    # Score de confiance SAM2 ou ByteTrack (1.0 = annotation manuelle)
    confidence: float = Field(default=1.0)

    # Indique si l'annotation a été générée par l'IA (True) ou manuellement (False)
    is_auto: bool = Field(default=False)

    # Indique si cette annotation est le résultat d'une interpolation entre keyframes
    is_interpolated: bool = Field(default=False)

    # Algorithme source : 'manual', 'sam_point', 'sam_auto', 'grounding_dino', 'bytetrack', 'interpolation'
    # None = annotation manuelle (valeur par défaut pour rétro-compatibilité)
    source_algorithm: Optional[str] = Field(default=None)

    # Horodatage de création
    created_at: datetime = Field(default_factory=datetime.utcnow)

    # ---- Relations ----
    frame: Optional["Frame"] = Relationship(back_populates="annotations")
    label_class: Optional["LabelClass"] = Relationship(back_populates="annotations")
    track: Optional["Track"] = Relationship(back_populates="annotations")

    def get_points(self) -> Optional[List[Tuple[float, float]]]:
        """Désérialise les points du polygone depuis JSON."""
        if self.points is None:
            return None
        return json.loads(self.points)

    def set_points(self, pts: List[Tuple[float, float]]) -> None:
        """Sérialise les points du polygone en JSON."""
        self.points = json.dumps(pts)

    def to_yolo_line(self, class_index: int) -> str:
        """
        Génère la ligne YOLO correspondante.
        Format : class_id cx cy w h
        """
        return f"{class_index} {self.cx:.6f} {self.cy:.6f} {self.width:.6f} {self.height:.6f}"

    def is_valid_yolo(self) -> bool:
        """
        Vérifie que les coordonnées sont dans l'intervalle valide [0, 1].
        Retourne False si une coordonnée est hors bornes (erreur de propagation).
        """
        coords = [self.cx, self.cy, self.width, self.height]
        # Le centre ± demi-largeur/hauteur doit rester dans [0, 1]
        if not all(0.0 <= c <= 1.0 for c in coords):
            return False
        if self.cx - self.width / 2 < 0 or self.cx + self.width / 2 > 1:
            return False
        if self.cy - self.height / 2 < 0 or self.cy + self.height / 2 > 1:
            return False
        return True
