# ============================================================
# api/settings.py
# Paramètres utilisateur persistants dans le workspace.
# GET  /api/settings  — lire les paramètres
# PUT  /api/settings  — sauvegarder les paramètres
# ============================================================

import json
import logging
import os
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.config import ANNOTATION_APP_IMPORTS, CURRENT_USER, SETTINGS_FILE, WORKSPACE

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["settings"])


# ------------------------------------------------------------------ #
# Schéma                                                              #
# ------------------------------------------------------------------ #

class AppSettings(BaseModel):
    # Workspace (lecture seule — géré par EXPLORER_WORKSPACE)
    workspace_path: str

    # Utilisateur courant (lecture seule — géré par EXPLORER_USER)
    user_name: str = "unknown"

    # Chemin export Annotation App (configurable via UI)
    annotation_app_imports_path: str

    # Valeurs par défaut du pipeline
    default_n_clusters: int = 20
    default_top_k: int = 20

    # ---- Clustering ----
    # Méthode par défaut appliquée au pipeline d'embedding et proposée au recluster.
    cluster_method: str = "kmeans"              # "kmeans" | "hdbscan"
    hdbscan_min_cluster_size: int = 5           # HDBSCAN : taille min d'un cluster

    # Préférences UI générales
    theme: str = "dark"
    scatter_default_color: str = "cluster"  # "cluster" | "rarity" | "uniform"

    # Thème visuel
    theme_bg: str = "dark-gray"     # dark-gray | dark-slate | dark-purple | dark-teal | dark-zinc
    theme_accent: str = "indigo"    # indigo | blue | violet | emerald | rose | amber

    # Stratégie de liens pour les subsets/exports
    # True  = symlinks uniquement (os.symlink) — défaut ; nécessite Mode Développeur sur Windows
    # False = copie physique (shutil.copy2) — plus lent mais universel
    use_symlinks: bool = True

    # Datasets épinglés dans le Dashboard Playground (par ID)
    playground_dataset_ids: List[int] = []

    # Hôte du partage réseau natif. Vide par défaut : rien n'est supposé.
    native_share_host: str = ""

    # ---- Tutoriel interactif (REPLI uniquement) ----
    # La source de vérité est VisionNexus
    # (%APPDATA%\VisionNexusElectron\settings.json, champ tutorials.dataset_explorer) :
    # le « déjà vu ce tuto » appartient à l'utilisateur et à son poste, pas au
    # workspace. Ces deux champs ne servent que hors du lanceur (navigateur, dev).
    tutorial_launched_once: bool = False
    tutorial_completed: bool = False

    # ---- Réduction dimensionnelle ----
    # Méthode : "umap" | "tsne" | "pca"
    reduction_method: str = "umap"

    # Hyperparamètres UMAP
    umap_n_neighbors: int = 15
    umap_min_dist: float = 0.1

    # Hyperparamètres t-SNE
    tsne_perplexity: int = 30
    tsne_learning_rate: float = 200.0

    # Hyperparamètres PCA (toujours 2 composantes pour la projection)
    # pas de param spécifique


# ------------------------------------------------------------------ #
# Helpers                                                             #
# ------------------------------------------------------------------ #

def _defaults() -> AppSettings:
    return AppSettings(
        workspace_path=str(WORKSPACE),
        user_name=CURRENT_USER,
        annotation_app_imports_path=str(ANNOTATION_APP_IMPORTS),
        native_share_host=os.environ.get("NATIVE_SHARE_HOST", ""),
    )


def load_settings() -> AppSettings:
    """Lit settings.json ou retourne les valeurs par défaut."""
    base = _defaults()
    if not SETTINGS_FILE.exists():
        return base
    try:
        data = json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
        # workspace_path et user_name toujours forcés via env
        data["workspace_path"] = str(WORKSPACE)
        data["user_name"] = CURRENT_USER
        merged = base.model_dump()
        merged.update({k: v for k, v in data.items() if k in merged})
        runtime_host = os.environ.get("NATIVE_SHARE_HOST", "").strip()
        if runtime_host:
            merged["native_share_host"] = runtime_host
        return AppSettings(**merged)
    except Exception as exc:
        logger.warning("Lecture settings.json echouee : %s — valeurs par defaut utilisees", exc)
        return base


def _save_settings(settings: AppSettings) -> None:
    data = settings.model_dump(exclude={"workspace_path", "user_name"})
    SETTINGS_FILE.write_text(
        json.dumps(data, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )


# ------------------------------------------------------------------ #
# Endpoints                                                           #
# ------------------------------------------------------------------ #

@router.get("/settings", response_model=AppSettings)
def get_settings():
    """Retourne les paramètres actuels."""
    return load_settings()


@router.put("/settings", response_model=AppSettings)
def update_settings(body: AppSettings):
    """Sauvegarde les paramètres dans le workspace."""
    try:
        _save_settings(body)
        return load_settings()
    except Exception as exc:
        raise HTTPException(500, f"Erreur sauvegarde settings : {exc}")
