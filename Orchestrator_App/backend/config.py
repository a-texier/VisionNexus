# ============================================================
# config.py
# Configuration centrale — orchestrator-app.
# Toutes les URL des apps cibles sont configurables via env.
# ============================================================

import os
from pathlib import Path

# ---- Workspace ----
_default_workspace = Path(__file__).parent.parent / "data"
WORKSPACE = Path(os.environ.get("ORCHESTRATOR_WORKSPACE", str(_default_workspace)))
WORKSPACE.mkdir(parents=True, exist_ok=True)

DATA_DIR = WORKSPACE

# ---- Sous-dossiers ----
PIPELINES_DIR = WORKSPACE / "pipelines"
PIPELINES_DIR.mkdir(parents=True, exist_ok=True)

GRAPHS_DIR = WORKSPACE / "graphs"
GRAPHS_DIR.mkdir(parents=True, exist_ok=True)

ACTIVITY_FILE    = WORKSPACE / "activity.json"
EXPERIMENTS_FILE = WORKSPACE / "experiments.json"

# ---- Paramètres utilisateur ----
SETTINGS_FILE = WORKSPACE / "settings.json"

# ---- Utilisateur courant ----
# Toute la separation multi-utilisateur repose sur cette valeur : les workspaces
# des sous-apps sont <WORKSPACE>/<app_id>_<user> et la cle du registre de ports
# partage est "<app_id>:<user>". L'ancien defaut "unknown" faisait donc que DEUX
# utilisateurs qui ne definissaient pas ORCHESTRATOR_USER partageaient
# silencieusement annotation_unknown, mlflow_unknown... : meme base SQLite, memes
# caches, memes ports revendiques, sans le moindre avertissement.
# On refuse desormais de demarrer sur un identifiant non nominatif : on tente
# d'abord le login OS, et a defaut on echoue avec un message explicite.
_PLACEHOLDER_USERS = {"", "unknown", "user", "default", "none", "null"}


class UnknownUserError(RuntimeError):
    """Aucun identifiant utilisateur exploitable -- demarrage refuse."""


def _resolve_current_user() -> str:
    explicit = os.environ.get("ORCHESTRATOR_USER", "").strip()
    if explicit and explicit.lower() not in _PLACEHOLDER_USERS:
        return explicit
    try:
        import getpass
        login = getpass.getuser().strip()
    except Exception:
        login = ""
    if login and login.lower() not in _PLACEHOLDER_USERS:
        return login
    raise UnknownUserError(
        "ORCHESTRATOR_USER n'est pas defini et le login OS n'a pas pu etre "
        "determine. Impossible de separer les workspaces et les ports entre "
        "utilisateurs : deux sessions partageraient la meme base de donnees. "
        "Relance en definissant ORCHESTRATOR_USER (ou, depuis VisionNexus, "
        "renseigne le champ Utilisateur dans les parametres)."
    )


CURRENT_USER = _resolve_current_user()

# ---- URLs des apps cibles (configurables via env) ----
# IMPORTANT : 127.0.0.1 et JAMAIS localhost pour les appels backend→backend —
# sur Windows, localhost peut résoudre en ::1 (IPv6) alors qu'uvicorn n'écoute
# qu'en IPv4 → pings /health en échec (badges "offline" fantômes, test Fable 2026-07).
def _ipv4(url: str) -> str:
    return url.replace("http://localhost:", "http://127.0.0.1:")

APP_URLS: dict[str, str] = {
    "Annotation_App": _ipv4(os.environ.get("ANNOTATION_APP_URL", "http://127.0.0.1:8000")),
    "Dataset_Explorer_App":   _ipv4(os.environ.get("DATASET_EXPLORER_APP_URL",   "http://127.0.0.1:8001")),
    "Training_App":   _ipv4(os.environ.get("TRAINING_APP_URL",   "http://127.0.0.1:8064")),
    "Inference_App":  _ipv4(os.environ.get("INFERENCE_APP_URL",  "http://127.0.0.1:8065")),
    "dvc-app":        _ipv4(os.environ.get("DVC_APP_URL",         "http://127.0.0.1:8061")),
    "mlflow-app":     _ipv4(os.environ.get("MLFLOW_APP_URL",      "http://127.0.0.1:8062")),
    "optuna-app":     _ipv4(os.environ.get("OPTUNA_APP_URL",      "http://127.0.0.1:8063")),
}

# URLs frontend (exposées via /api/apps pour le dashboard "Open app")
APP_FRONTEND_URLS: dict[str, str] = {
    "Annotation_App": os.environ.get("ANNOTATION_APP_FRONTEND_URL", "http://localhost:5173"),
    "Dataset_Explorer_App":   os.environ.get("DATASET_EXPLORER_APP_FRONTEND_URL",   "http://localhost:5174"),
    "Training_App":   os.environ.get("TRAINING_APP_FRONTEND_URL",   "http://localhost:5176"),
    "Inference_App":  os.environ.get("INFERENCE_APP_FRONTEND_URL",  "http://localhost:5177"),
    "dvc-app":        os.environ.get("DVC_APP_FRONTEND_URL",         "http://localhost:3002"),
    "mlflow-app":     os.environ.get("MLFLOW_APP_FRONTEND_URL",      "http://localhost:3001"),
    "optuna-app":     os.environ.get("OPTUNA_APP_FRONTEND_URL",      "http://localhost:3003"),
}

# ---- Réseau orchestrateur ----
BACKEND_PORT  = int(os.environ.get("BACKEND_PORT",                   "8060"))
FRONTEND_PORT = int(os.environ.get("ORCHESTRATOR_FRONTEND_PORT",     "3000"))

# ---- CORS ----
_cors_origins: set[str] = {
    f"http://localhost:{FRONTEND_PORT}",
    f"http://127.0.0.1:{FRONTEND_PORT}",
    "http://localhost:3000", "http://127.0.0.1:3000",
    "http://localhost:5173", "http://127.0.0.1:5173",
    "http://localhost:5174", "http://127.0.0.1:5174",
    "http://localhost:5175", "http://127.0.0.1:5175",
    "http://localhost:5176", "http://127.0.0.1:5176",
}
CORS_ORIGINS: list[str] = list(_cors_origins)
