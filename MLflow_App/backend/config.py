# ============================================================
# config.py
# Configuration centrale — workspace utilisateur.
#
# Configurable via la variable d'environnement MLFLOW_APP_WORKSPACE.
# Valeur par défaut : <racine projet>/data
# ============================================================

import os
from pathlib import Path

# ---- Workspace utilisateur ----
_default_workspace = Path(__file__).parent.parent / "data"
WORKSPACE = Path(os.environ.get("MLFLOW_APP_WORKSPACE", str(_default_workspace)))
WORKSPACE.mkdir(parents=True, exist_ok=True)

DATA_DIR = WORKSPACE

# ---- Paramètres utilisateur ----
SETTINGS_FILE = WORKSPACE / "settings.json"

# ---- Utilisateur courant ----
CURRENT_USER = os.environ.get("MLFLOW_APP_USER", "unknown")

# ---- Réseau ----
BACKEND_PORT  = int(os.environ.get("BACKEND_PORT",              "8001"))
FRONTEND_PORT = int(os.environ.get("MLFLOW_APP_FRONTEND_PORT",  "3001"))

# ---- MLflow ----
# Store SERVERLESS par defaut : sqlite dans le workspace (aucun `mlflow server`,
# aucun port -> plus de deconnexions/collisions de port). MlflowClient lit/ecrit
# directement le fichier sqlite. Un URI http:// explicite reste supporte (legacy).
MLFLOW_DATA_DIR = WORKSPACE / "mlflow_data"
MLFLOW_DATA_DIR.mkdir(parents=True, exist_ok=True)
(MLFLOW_DATA_DIR / "artifacts").mkdir(parents=True, exist_ok=True)

_default_uri = f"sqlite:///{(MLFLOW_DATA_DIR / 'mlflow.db').as_posix()}"
MLFLOW_TRACKING_URI = os.environ.get("MLFLOW_TRACKING_URI", _default_uri)
MLFLOW_ARTIFACT_ROOT = (MLFLOW_DATA_DIR / "artifacts").as_uri()

# ---- CORS dynamique ----
_cors_origins: set[str] = {
    f"http://localhost:{FRONTEND_PORT}",
    f"http://127.0.0.1:{FRONTEND_PORT}",
    "http://localhost:3001", "http://127.0.0.1:3001",
    "http://localhost:3002", "http://127.0.0.1:3002",
    "http://localhost:3003", "http://127.0.0.1:3003",
    "http://localhost:5173", "http://127.0.0.1:5173",
    "http://localhost:5174", "http://127.0.0.1:5174",
}
CORS_ORIGINS: list[str] = list(_cors_origins)
