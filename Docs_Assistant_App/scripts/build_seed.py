"""Construit data/seed_index.sqlite : un index normal calcule avec le vrai modele.

Au premier demarrage, le service copie ce seed dans le workspace (si le modele et la
version de schema correspondent) puis ne re-embedde que ce qui a change : la VM ne paie
jamais l'indexation complete a froid. A relancer apres un changement notable de la doc,
avant de fabriquer un bundle. Le seed est un artefact de build (ignore par git).

    python scripts/build_seed.py [--model intfloat/multilingual-e5-small] [--docs-root ..]
"""

from __future__ import annotations

import argparse
import os
import sqlite3
import sys
import tempfile
import time
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(APP_ROOT))

os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")

from backend.core.embedder import E5Embedder  # noqa: E402
from backend.core.store import Store  # noqa: E402
from backend.core.sync import SyncManager  # noqa: E402
from backend.model_paths import model_dir, model_name  # noqa: E402


def finalize(path: Path) -> None:
    """Fichier autonome : plus de journal WAL a cote, pages compactees."""
    con = sqlite3.connect(path)
    try:
        con.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        con.execute("PRAGMA journal_mode=DELETE")
        con.execute("VACUUM")
    finally:
        con.close()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    parser.add_argument("--model", default=model_name())
    parser.add_argument("--model-dir", type=Path, default=None)
    parser.add_argument("--docs-root", type=Path, default=APP_ROOT.parent)
    parser.add_argument("--output", type=Path, default=APP_ROOT / "data" / "seed_index.sqlite")
    parser.add_argument("--device", default=None)
    args = parser.parse_args()

    embedder = E5Embedder(args.model, args.model_dir or model_dir(args.model), args.device)
    if not embedder.available:
        print(embedder.unavailable_reason(), file=sys.stderr)
        return 1

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=args.output.parent) as tmp:
        built = Path(tmp) / "seed.sqlite"
        store = Store(built)
        manager = SyncManager(store, embedder, args.docs_root)
        started = time.monotonic()
        manager.run_blocking()
        status = manager.status()
        if status["last_error"]:
            print(f"[echec] {status['last_error']}", file=sys.stderr)
            return 1
        store.close()
        finalize(built)
        built.replace(args.output)
    counts = status["progress"]
    print(
        f"[ok] {args.output} : {counts['chunks_embedded']} passages embeddes avec {args.model} "
        f"en {time.monotonic() - started:.1f} s ({args.output.stat().st_size / 1e6:.1f} Mo)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
