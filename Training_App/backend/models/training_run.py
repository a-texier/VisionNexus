# ============================================================
# models/training_run.py
# Modele SQLModel pour un run d'entrainement YOLOX.
# ============================================================

import json
from datetime import datetime

from sqlmodel import Field, SQLModel


class TrainingRun(SQLModel, table=True):
    """Un run d'entrainement, tous moteurs confondus (voir trainer_backend.py)."""

    __tablename__ = "training_run"

    id: int | None = Field(default=None, primary_key=True)
    run_name: str = Field(index=True)         # nom unique (uuid court)

    # Configuration modele
    yolo_version: str = Field(default="yolox")     # conserve pour compat DB, remplace par `engine`
    # Moteur qui a produit (et seul sait relire) les poids du run.
    engine: str       = Field(default="yolox")
    model_size: str   = Field(default="yolox-s")   # taille du catalogue du moteur
    model_weights: str = Field(default="")         # poids de depart (vide = defaut du moteur)

    # Dataset
    data_yaml: str    = Field(default="")          # chemin vers data.yaml
    dataset_name: str = Field(default="")         # nom lisible

    # Hyperparametres (serialises en JSON)
    hyperparams_json: str = Field(default="{}")

    # Statut
    status: str = Field(default="pending")         # pending | running | done | error | stopped
    progress_pct: float = Field(default=0.0)
    current_epoch: int  = Field(default=0)
    total_epochs:  int  = Field(default=300)

    # Metriques finales
    best_map50:    float | None = Field(default=None)
    best_map5095:  float | None = Field(default=None)
    best_model_path: str | None = Field(default=None)  # poids finaux (format du moteur)

    # Meta
    error_message: str | None = Field(default=None)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    started_at: datetime | None = Field(default=None)
    finished_at: datetime | None = Field(default=None)

    @property
    def hyperparams(self) -> dict:
        try:
            return json.loads(self.hyperparams_json)
        except Exception:
            return {}

    @hyperparams.setter
    def hyperparams(self, value: dict):
        self.hyperparams_json = json.dumps(value)
