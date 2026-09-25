"""Telecharge les poids d'embeddings dans backend/models/<nom>/ (une fois, en ligne).

    python scripts/download_model.py                      # modele par defaut (small)
    python scripts/download_model.py --model intfloat/multilingual-e5-base
    python scripts/download_model.py --all                # small et base

Seuls config, tokenizer et model.safetensors sont recuperes (pas d'onnx/openvino/tf).
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(APP_ROOT))

from backend.model_paths import (  # noqa: E402
    DEFAULT_MODEL,
    DOWNLOAD_FILES,
    MODELS_DIR,
    SUPPORTED_MODELS,
    missing_files,
)


def download(repo_id: str) -> Path:
    # Le service tourne hors ligne ; ce script est le seul endroit qui a le droit
    # d'aller sur le reseau.
    os.environ.pop("HF_HUB_OFFLINE", None)
    os.environ.pop("TRANSFORMERS_OFFLINE", None)
    from huggingface_hub import snapshot_download

    target = MODELS_DIR / repo_id.split("/")[-1]
    snapshot_download(repo_id=repo_id, local_dir=str(target), allow_patterns=list(DOWNLOAD_FILES))
    missing = missing_files(target)
    if missing:
        raise RuntimeError(f"telechargement incomplet dans {target} : manque {', '.join(missing)}")
    return target


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    parser.add_argument("--model", default=DEFAULT_MODEL, help=f"un de : {', '.join(SUPPORTED_MODELS)}")
    parser.add_argument("--all", action="store_true", help="telecharge tous les modeles supportes")
    args = parser.parse_args()

    failures = 0
    for repo_id in SUPPORTED_MODELS if args.all else (args.model,):
        try:
            target = download(repo_id)
        except Exception as exc:  # reseau, disque, depot introuvable : on les rapporte tous
            failures += 1
            print(f"[echec] {repo_id} : {exc}", file=sys.stderr)
            continue
        size = sum(f.stat().st_size for f in target.iterdir() if f.is_file()) / 1e6
        print(f"[ok] {repo_id} -> {target} ({size:.0f} Mo)")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
