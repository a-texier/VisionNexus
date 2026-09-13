# ============================================================
# config.py
# Configuration centrale — workspace utilisateur.
# ============================================================

import os
from pathlib import Path

_default_workspace = Path(__file__).parent.parent / "data"
WORKSPACE = Path(os.environ.get("OPTUNA_APP_WORKSPACE", str(_default_workspace)))
WORKSPACE.mkdir(parents=True, exist_ok=True)

DATA_DIR = WORKSPACE

# ---- Optuna storage ----
OPTUNA_DB_PATH = WORKSPACE / "optuna.db"
OPTUNA_STORAGE = f"sqlite:///{OPTUNA_DB_PATH}"

# ---- Paramètres utilisateur ----
SETTINGS_FILE = WORKSPACE / "settings.json"

# ---- Logs études ----
LOGS_DIR = WORKSPACE / "logs"
LOGS_DIR.mkdir(parents=True, exist_ok=True)

# ---- Utilisateur courant ----
CURRENT_USER = os.environ.get("OPTUNA_APP_USER", "unknown")

# ---- Réseau ----
BACKEND_PORT  = int(os.environ.get("BACKEND_PORT",              "8003"))
FRONTEND_PORT = int(os.environ.get("OPTUNA_APP_FRONTEND_PORT",  "3003"))

# ---- CORS ----
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
