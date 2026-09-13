# ============================================================
# config.py
# Configuration centrale — workspace utilisateur.
#
# Le workspace est le répertoire racine de toutes les données :
#   annotation.db, projets, exports, backups, paramètres.
#
# Configurable via la variable d'environnement ANNOTATION_WORKSPACE.
# Valeur par défaut : <racine projet>/data
#
# Usage :
#   from backend.config import DATA_DIR, DATABASE_URL, SETTINGS_FILE
#
# Lancement avec workspace personnalisé :
#   ANNOTATION_WORKSPACE=/mnt/data python launcher.py
# ============================================================

import os
from pathlib import Path

# ---- Workspace ----
# Lire depuis la variable d'environnement, ou utiliser ./data par défaut
_default_workspace = Path(__file__).parent.parent / "data"
WORKSPACE = Path(os.environ.get("ANNOTATION_WORKSPACE", str(_default_workspace)))
WORKSPACE.mkdir(parents=True, exist_ok=True)

# Alias pratique
DATA_DIR = WORKSPACE

# ---- Base de données ----
DATABASE_PATH = WORKSPACE / "annotation.db"
DATABASE_URL = f"sqlite:///{DATABASE_PATH}"

# ---- Fichiers de configuration utilisateur ----
SETTINGS_FILE = WORKSPACE / "user_settings.json"

# ---- Sous-dossiers (créés à la demande par les services) ----
BACKUP_DIR = WORKSPACE / "backup"
EXPORTS_DIR = WORKSPACE / "exports"

# ---- Données d'exemple partagées par TOUTE la suite (hors workspace) ----
# Un seul jeu d'images de démo pour tous les tutoriels des apps :
# <racine Computer_Vision_App>/data_tuto/. Surchargeable par CV_DATA_TUTO
# (utile si le dépôt est déployé autrement sur la VM).
_default_data_tuto = Path(__file__).parent.parent.parent / "data_tuto"
SAMPLE_SEQUENCES_DIR = Path(os.environ.get("CV_DATA_TUTO", str(_default_data_tuto)))

# ---- Ports (injectés par launcher.py) ----
BACKEND_PORT  = int(os.environ.get("BACKEND_PORT",             "8000"))
FRONTEND_PORT = int(os.environ.get("ANNOTATION_FRONTEND_PORT", "5173"))

# ---- CORS dynamique ----
# Toujours autoriser le port par défaut (lancement manuel sans launcher)
# + le port courant injecté par le launcher.
_cors_origins: set[str] = {
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
}
_cors_origins.add(f"http://localhost:{FRONTEND_PORT}")
_cors_origins.add(f"http://127.0.0.1:{FRONTEND_PORT}")
CORS_ORIGINS: list[str] = list(_cors_origins)
