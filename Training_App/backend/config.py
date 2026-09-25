# ============================================================
# config.py — Training_App
# Workspace configurable via TRAINING_APP_WORKSPACE env var.
# ============================================================

import os
from pathlib import Path

# ---- Workspace ----
_default_workspace = Path(__file__).parent.parent / "data"
WORKSPACE = Path(os.environ.get("TRAINING_APP_WORKSPACE", str(_default_workspace)))
WORKSPACE.mkdir(parents=True, exist_ok=True)

DATA_DIR = WORKSPACE

# ---- Base de donnees ----
DATABASE_PATH = WORKSPACE / "training.db"
DATABASE_URL = f"sqlite:///{DATABASE_PATH}"

# ---- Sous-dossiers ----
RUNS_DIR    = WORKSPACE / "runs"      # dossiers de sortie d'entrainement
EXPORTS_DIR = WORKSPACE / "exports"  # modeles exportes (.pt, .onnx...)

RUNS_DIR.mkdir(parents=True, exist_ok=True)
EXPORTS_DIR.mkdir(parents=True, exist_ok=True)

# ---- Utilisateur ----
CURRENT_USER = os.environ.get("TRAINING_APP_USER", "unknown")

# ---- Moteur d'entrainement ----
# Moteur retenu quand une requete n'en precise aucun : "yolox" (moteur du
# coeur) ou le nom d'un moteur fourni par un plugin de <racine>/plugins/ --
# voir services/trainer_backend.py et docs/architecture.md a la racine.
TRAINER_BACKEND = os.environ.get("TRAINING_APP_TRAINER_BACKEND", "yolox")

# ---- Reseau ----
BACKEND_PORT  = int(os.environ.get("BACKEND_PORT",                   "8064"))
FRONTEND_PORT = int(os.environ.get("TRAINING_APP_FRONTEND_PORT",     "5176"))

# ---- CORS ----
_cors_origins: set[str] = {
    f"http://localhost:{FRONTEND_PORT}",
    f"http://127.0.0.1:{FRONTEND_PORT}",
    "http://localhost:5176",
    "http://127.0.0.1:5176",
    "http://localhost:5175",
    "http://127.0.0.1:5175",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
}
CORS_ORIGINS: list[str] = list(_cors_origins)
