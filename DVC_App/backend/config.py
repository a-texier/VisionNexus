# ============================================================
# config.py
# Configuration centrale — workspace utilisateur.
#
# Configurable via DVC_APP_WORKSPACE et DVC_REPO_PATH.
# ============================================================

import os
from pathlib import Path

# ---- Workspace utilisateur ----
_default_workspace = Path(__file__).parent.parent / "data"
WORKSPACE = Path(os.environ.get("DVC_APP_WORKSPACE", str(_default_workspace)))
WORKSPACE.mkdir(parents=True, exist_ok=True)

DATA_DIR = WORKSPACE

# ---- Paramètres utilisateur ----
SETTINGS_FILE = WORKSPACE / "settings.json"

# ---- Répertoire DVC (git repo avec DVC initialisé) ----
# Configurable via variable d'environnement DVC_REPO_PATH
DVC_REPO_PATH = Path(os.environ.get("DVC_REPO_PATH", str(WORKSPACE / "repo")))

# ---- Utilisateur courant ----
CURRENT_USER = os.environ.get("DVC_APP_USER", "unknown")

# ---- Réseau ----
BACKEND_PORT  = int(os.environ.get("BACKEND_PORT",             "8002"))
FRONTEND_PORT = int(os.environ.get("DVC_APP_FRONTEND_PORT",    "3002"))

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
