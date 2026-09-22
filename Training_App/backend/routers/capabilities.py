"""
GET /api/capabilities -- moteurs d'entrainement que cette instance sait utiliser.

Source de verite pour les UI (Training_App, Optuna_App, Orchestrator_App) :
un selecteur de moteur n'est affiche que si plusieurs entrees sont
`available`, et ses libelles, tailles, hyperparametres et plages HPO
viennent du `catalog` renvoye ici, jamais du code du frontend. Sans plugin,
la reponse ne contient que YOLOX et aucune UI n'affiche de choix -- rien a
masquer cote client.
"""

from fastapi import APIRouter

from backend.config import TRAINER_BACKEND
from backend.services.trainer_backend import DEFAULT_BACKEND, describe_backends

router = APIRouter(prefix="/api", tags=["Capabilities"])


@router.get("/capabilities")
def capabilities() -> dict:
    return {
        "trainer_backends": describe_backends(with_catalog=True),
        "default": DEFAULT_BACKEND,
        # Moteur retenu quand une requete n'en precise aucun (variable
        # d'environnement TRAINING_APP_TRAINER_BACKEND, "yolox" sinon).
        "active": TRAINER_BACKEND.strip().lower() or DEFAULT_BACKEND,
    }
