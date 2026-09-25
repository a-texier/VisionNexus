"""Resolution du dossier des poids d'embeddings, hors ligne.

Aucun telechargement ici : un modele absent est signale par missing_files(),
le service reste utilisable en recherche par mots-cles. Convention du depot
(MODEL_WEIGHTS.md) : les poids vivent sous backend/models/<nom-du-modele>/.
"""

from __future__ import annotations

import os
from pathlib import Path

MODELS_DIR = Path(__file__).resolve().parent / "models"

DEFAULT_MODEL = "intfloat/multilingual-e5-small"
SUPPORTED_MODELS = (
    "intfloat/multilingual-e5-small",
    "intfloat/multilingual-e5-base",
)

# Fichiers a la racine du snapshot HF ; le reste (onnx, openvino, tf) est inutile.
TOKENIZER_FILES = (
    "tokenizer.json",
    "tokenizer_config.json",
    "sentencepiece.bpe.model",
    "special_tokens_map.json",
)
WEIGHT_FILES = ("model.safetensors",)
DOWNLOAD_FILES = ("config.json", *TOKENIZER_FILES, *WEIGHT_FILES)


def model_name() -> str:
    return os.environ.get("DOCS_ASSISTANT_MODEL", "").strip() or DEFAULT_MODEL


def model_dir(name: str | None = None) -> Path:
    """DOCS_ASSISTANT_MODEL_DIR gagne sur la convention backend/models/<nom>/."""
    override = os.environ.get("DOCS_ASSISTANT_MODEL_DIR", "").strip()
    if override:
        return Path(override)
    return MODELS_DIR / (name or model_name()).split("/")[-1]


def missing_files(directory: Path) -> list[str]:
    """Liste ce qui manque pour charger le modele (vide = utilisable)."""
    missing: list[str] = []
    if not (directory / "config.json").is_file():
        missing.append("config.json")
    if not any((directory / f).is_file() for f in WEIGHT_FILES + ("pytorch_model.bin",)):
        missing.append("model.safetensors")
    if not ((directory / "tokenizer.json").is_file() or (directory / "sentencepiece.bpe.model").is_file()):
        missing.append("tokenizer.json")
    return missing
