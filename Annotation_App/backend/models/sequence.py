# ============================================================
# models/sequence.py
# Une séquence = une source importée dans un projet :
# dossier d'images, fichier vidéo (MP4/AVI...) ou fichier optional_format.
# Un projet peut contenir plusieurs séquences (multi-séquence) ;
# les frames de chaque séquence occupent une plage contiguë de
# frame_index globaux [start_index, start_index + frame_count).
# ============================================================

from datetime import datetime
from typing import Optional

from sqlmodel import Field, SQLModel


class Sequence(SQLModel, table=True):
    """Table des séquences (sources d'import) d'un projet."""
    __tablename__ = "sequence"

    id: Optional[int] = Field(default=None, primary_key=True)

    # Référence vers le projet parent
    project_id: int = Field(foreign_key="project.id", index=True)

    # Nom lisible (nom du dossier, du fichier vidéo ou de l'optional_format)
    name: str = Field(min_length=1, max_length=255)

    # Type de source : 'images' | 'video' | 'optional_format'
    source_type: str = Field(default="images", max_length=16)

    # Chemin source sur le serveur (vidéo, optional_format ou dossier d'images).
    # None pour les uploads sans source persistante (ou après nettoyage).
    source_path: Optional[str] = Field(default=None)

    # frame_index global de la première frame de la séquence
    start_index: int = Field(default=0)

    # Nombre de frames de la séquence
    frame_count: int = Field(default=0)

    # FPS source (vidéos uniquement)
    fps: Optional[float] = Field(default=None)

    # LUT d'affichage PROPRE à la séquence (remap 16/8 bits), même format que
    # Project.lut_json. Prioritaire sur la LUT projet (IR et RGB dans un même
    # projet ont besoin de réglages distincts). null/absent => repli LUT projet.
    lut_json: Optional[str] = Field(default=None)

    # Dernier export reussi de CETTE sequence. C'est le critere qui fait
    # qu'une sequence est consideree comme terminee : une sequence annotee mais
    # jamais exportee n'est pas livrable. Fait metier porte par la sequence, pas
    # une trace d'usage — d'ou une colonne plutot qu'un evenement de monitoring.
    last_export_at: Optional[datetime] = Field(default=None)
    last_export_format: Optional[str] = Field(default=None, max_length=16)  # 'yolo' | 'coco' | 'ver'

    created_at: datetime = Field(default_factory=datetime.now)
