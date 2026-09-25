"""Configuration du service : tout vient de l'environnement (pose par le launcher).

DOCS_ASSISTANT_WORKSPACE   dossier de travail (index.sqlite)
DOCS_ASSISTANT_USER        nom de session, affiche dans /index/status
DOCS_ASSISTANT_DOCS_ROOT   racine de la suite contenant docs/docs_manifest.json
DOCS_ASSISTANT_MODEL       modele d'embeddings (voir model_paths.py)
DOCS_ASSISTANT_MODEL_DIR   dossier des poids (sinon backend/models/<modele>/)
DOCS_ASSISTANT_DEVICE      cuda, cpu... (sinon cuda si disponible)
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from backend.model_paths import model_dir, model_name

APP_ROOT = Path(__file__).resolve().parents[1]

# Cache de secours si l'app est lancee a la main sans workspace.
_DEFAULT_WORKSPACE = APP_ROOT / "data" / "workspace"


@dataclass(frozen=True)
class Settings:
    repo_root: Path
    workspace: Path
    user: str
    model_name: str
    model_dir: Path
    device: str | None
    seed_path: Path

    @property
    def index_path(self) -> Path:
        return self.workspace / "index.sqlite"


def load_settings() -> Settings:
    root_env = os.environ.get("DOCS_ASSISTANT_DOCS_ROOT", "").strip()
    # Layout depot et bundle : les apps sont des freres de Docs_Assistant_App.
    repo_root = Path(root_env) if root_env else APP_ROOT.parent
    workspace = Path(os.environ.get("DOCS_ASSISTANT_WORKSPACE", "").strip() or _DEFAULT_WORKSPACE)
    name = model_name()
    return Settings(
        repo_root=repo_root,
        workspace=workspace,
        user=os.environ.get("DOCS_ASSISTANT_USER", "").strip() or "unknown",
        model_name=name,
        model_dir=model_dir(name),
        device=os.environ.get("DOCS_ASSISTANT_DEVICE", "").strip() or None,
        seed_path=APP_ROOT / "data" / "seed_index.sqlite",
    )
