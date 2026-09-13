# ============================================================
# models/training_run.py
# Modele SQLModel pour un run d'entrainement YOLO.
# ============================================================

import json
from datetime import datetime
from typing import Optional

from sqlmodel import Field, SQLModel


class TrainingRun(SQLModel, table=True):
    """Un run d'entrainement Ultralytics YOLO."""

    __tablename__ = "training_run"

    id: Optional[int] = Field(default=None, primary_key=True)
    run_name: str = Field(index=True)         # nom unique (uuid court)

    # Configuration modele
    yolo_version: str = Field(default="yolov8")   # yolov8 | yolov9 | yolov10 | yolo11
    model_size: str   = Field(default="n")         # n | s | m | l | x | c | e | b
    model_weights: str = Field(default="")         # chemin .pt ou nom pretrained

    # Dataset
    data_yaml: str    = Field(default="")          # chemin vers data.yaml
    dataset_name: str = Field(default="")         # nom lisible

    # Hyperparametres (serialises en JSON)
    hyperparams_json: str = Field(default="{}")

    # Statut
    status: str = Field(default="pending")         # pending | running | done | error | stopped
    progress_pct: float = Field(default=0.0)
    current_epoch: int  = Field(default=0)
    total_epochs:  int  = Field(default=100)

    # Metriques finales
    best_map50:    Optional[float] = Field(default=None)
    best_map5095:  Optional[float] = Field(default=None)
    best_model_path: Optional[str] = Field(default=None)  # chemin best.pt

    # Meta
    error_message: Optional[str] = Field(default=None)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    started_at: Optional[datetime] = Field(default=None)
    finished_at: Optional[datetime] = Field(default=None)

    @property
    def hyperparams(self) -> dict:
        try:
            return json.loads(self.hyperparams_json)
        except Exception:
            return {}

    @hyperparams.setter
    def hyperparams(self, value: dict):
        self.hyperparams_json = json.dumps(value)
