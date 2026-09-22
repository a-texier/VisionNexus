# ============================================================
# config.py
# Configuration centrale — workspace utilisateur.
#
# Le workspace stocke toutes les données persistantes :
#   dataset_explorer.db, thumbnails, index FAISS, subsets, settings.
#
# Configurable via la variable d'environnement EXPLORER_WORKSPACE.
# Valeur par défaut : <racine projet>/data
#
# Lancement avec workspace personnalisé :
#   EXPLORER_WORKSPACE=/mnt/data uvicorn backend.main:app --port 8001
# ============================================================

import os
from pathlib import Path

# ---- Mode hors-ligne CLIP / Hugging Face ----
# L'app BDD doit tourner SANS internet : on interdit tout acces reseau de
# huggingface_hub / open_clip. Les poids CLIP sont lus depuis un fichier local
# (CLIP_WEIGHTS) ou depuis le cache HF deja present — jamais telecharges.
# Doit etre defini AVANT le premier import d'open_clip (import paresseux dans
# embedder.load()). Pour (re)telecharger volontairement les poids une fois :
# relancer avec la variable HF_HUB_OFFLINE=0.
os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")

# ---- Workspace utilisateur ----
_default_workspace = Path(__file__).parent.parent / "data"
WORKSPACE = Path(os.environ.get("EXPLORER_WORKSPACE", str(_default_workspace)))
WORKSPACE.mkdir(parents=True, exist_ok=True)

DATA_DIR = WORKSPACE

# ---- Base de données ----
DATABASE_PATH = WORKSPACE / "dataset_explorer.db"
DATABASE_URL = f"sqlite:///{DATABASE_PATH}"

# ---- Paramètres utilisateur ----
SETTINGS_FILE = WORKSPACE / "settings.json"

# ---- Données d'exemple partagées par TOUTE la suite (hors workspace) ----
# Un seul jeu d'images de démo pour tous les tutoriels des apps :
# <racine Computer_Vision_App>/data_tuto/. Surchargeable par CV_DATA_TUTO
# (utile si le dépôt est déployé autrement sur la VM).
_default_data_tuto = Path(__file__).parent.parent.parent / "data_tuto"
SAMPLE_DATASETS_DIR = Path(os.environ.get("CV_DATA_TUTO", str(_default_data_tuto)))

# ---- Cache images (thumbnails + index FAISS) ----
THUMBS_DIR = WORKSPACE / "thumbs"       # miniatures 256px, nommées par MD5
FAISS_DIR  = WORKSPACE / "faiss"        # un sous-dossier par dataset_id
SUBSETS_DIR = WORKSPACE / "subsets"     # dossiers symlink des subsets

# Galerie partagée : symlinks vers les dossiers images originaux
# Accessible à tous les workspaces — chemin fixe dans l'app
_app_root = Path(__file__).parent.parent
DATASET_GALLERY_DIR = _app_root / "data" / "dataset_gallery"

# Registre global : persiste les datasets globaux indépendamment du workspace
# Permet de les afficher même si le workspace change
GLOBAL_REGISTRY_FILE = DATASET_GALLERY_DIR / "registry.json"

# Créer les dossiers critiques dès l'import (StaticFiles en a besoin)
THUMBS_DIR.mkdir(parents=True, exist_ok=True)
FAISS_DIR.mkdir(parents=True, exist_ok=True)
SUBSETS_DIR.mkdir(parents=True, exist_ok=True)
DATASET_GALLERY_DIR.mkdir(parents=True, exist_ok=True)

# ---- Export vers Annotation App ----
ANNOTATION_APP_IMPORTS = Path(
    os.environ.get(
        "ANNOTATION_APP_IMPORTS",
        str(Path(__file__).parent.parent.parent / "Annotation_App" / "data" / "imports")
    )
)

# ---- Modèle CLIP ----
CLIP_MODEL      = "ViT-B-32"
CLIP_PRETRAINED = "openai"      # tag open_clip (resolu depuis le cache HF, hors-ligne)
EMBED_DIM       = 512
BATCH_SIZE      = 64

# Poids CLIP — resolution hors-ligne, par ordre de priorite :
#   1. variable d'env CLIP_WEIGHTS (chemin .safetensors explicite),
#   2. fichier EMBARQUE <app>/models/ViT-B-32-openai.safetensors (zip "cle en main"),
#   3. vide -> open_clip lit le cache HF en mode offline (HF_HUB_OFFLINE=1).
# IMPORTANT : garder CLIP_MODEL="ViT-B-32" (et NON "ViT-B-32-quickgelu") — c'est la
# variante qui reproduit a l'identique les embeddings deja stockes dans la BDD/FAISS.
CLIP_MODELS_DIR = _app_root / "models"
_bundled_clip   = CLIP_MODELS_DIR / "ViT-B-32-openai.safetensors"
CLIP_WEIGHTS = (
    os.environ.get("CLIP_WEIGHTS", "").strip()
    or (str(_bundled_clip) if _bundled_clip.is_file() else "")
)

# ---- Pipeline ----
DEFAULT_N_CLUSTERS    = 20
DUPLICATE_THRESHOLD   = 0.97
UMAP_N_NEIGHBORS      = 15
UMAP_MIN_DIST         = 0.1

# ---- Formats supportés ----
SUPPORTED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".tif", ".webp"}

# ---- Utilisateur courant ----
CURRENT_USER = os.environ.get("EXPLORER_USER", "unknown")

# ---- Réseau ----
# Lecture depuis les variables d'environnement pour support multi-utilisateurs
# (chaque copie de launcher.py peut configurer ses propres ports)
BACKEND_PORT  = int(os.environ.get("BACKEND_PORT",  "8001"))
FRONTEND_PORT = int(os.environ.get("EXPLORER_FRONTEND_PORT", "5173"))

_cors_origins = {
    f"http://localhost:{FRONTEND_PORT}",
    f"http://127.0.0.1:{FRONTEND_PORT}",
}
# Toujours autoriser les ports dev courants (évite les erreurs si frontend
# n'exporte pas EXPLORER_FRONTEND_PORT ou si Vite prend le port suivant)
_cors_origins.update({
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5174",
    "http://localhost:5175",
    "http://127.0.0.1:5175",
})
CORS_ORIGINS = list(_cors_origins)
