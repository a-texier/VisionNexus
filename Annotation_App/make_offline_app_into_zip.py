#!/usr/bin/env python3
"""
make_offline_app_into_zip.py — Annotation_App
===============================================
Cree un ZIP de l'application pret pour distribution offline.

Ce que le ZIP contient :
  - Tout le code source Python + frontend (src/, public/)
  - launcher.py, requirements.txt, package.json
  - CLAUDE.md, README.md

Ce qui est EXCLU :
  - node_modules/        (reinstaller avec npm install)
  - __pycache__/, *.pyc, *.pyo
  - .git/, .gitignore
  - data/                (workspace utilisateur, non distribue)
  - dist/, build/        (generer avec npm run build)
  - .env, .env.*
  - *.log, backend.log
  - All_workspaces/      (si present)
  - .instances.json, .port_lock

Usage :
    python make_offline_app_into_zip.py
    python make_offline_app_into_zip.py --output /tmp/annotation_offline.zip
    python make_offline_app_into_zip.py --include-data   # inclut data/ (attention : peut etre lourd)
"""

import argparse
import zipfile
import sys
from datetime import datetime
from pathlib import Path

APP_ROOT = Path(__file__).parent.resolve()
APP_NAME = "Annotation_App"

# Patterns de dossiers/fichiers a exclure
EXCLUDE_DIRS = {
    "node_modules", "__pycache__", ".git", "dist", "build",
    "data", ".cache", "venv", ".venv", "env",
    "All_workspaces", ".run", ".pytest_cache", ".mypy_cache",
    "checkpoints",    # modeles SAM2 lourds
}
EXCLUDE_EXTENSIONS = {
    ".pyc", ".pyo", ".pyd",
    ".log",
    ".db", ".sqlite", ".sqlite3",
    ".pkl", ".pickle",
    ".npy", ".npz",
    ".pt", ".pth",           # poids PyTorch
    ".onnx",                 # modeles ONNX
    ".h5", ".hdf5",
    ".bin",                  # poids HuggingFace
    ".safetensors",
}
EXCLUDE_FILES = {
    ".env", ".env.local", ".env.production",
    ".instances.json", ".port_lock",
    "backend.log",
}


def should_exclude(path: Path, root: Path, include_data: bool) -> bool:
    rel = path.relative_to(root)
    parts = rel.parts

    # Exclure dossier data/ sauf si --include-data
    if not include_data and parts[0] == "data":
        return True

    # Exclure si premier segment est dans EXCLUDE_DIRS
    for part in parts:
        if part in EXCLUDE_DIRS:
            return True

    # Exclure par extension
    if path.suffix.lower() in EXCLUDE_EXTENSIONS:
        return True

    # Exclure par nom de fichier
    if path.name in EXCLUDE_FILES:
        return True

    # Exclure fichiers cachés sauf .gitignore, .env.example
    if path.name.startswith(".") and path.name not in {".gitignore", ".env.example", ".gitkeep"}:
        return True

    return False


def make_zip(output: Path, include_data: bool) -> None:
    files_added = 0
    files_skipped = 0
    total_size = 0

    print(f"[{APP_NAME}] Creation du ZIP offline...")
    print(f"  Source  : {APP_ROOT}")
    print(f"  Sortie  : {output}")
    print(f"  Data    : {'incluse' if include_data else 'exclue'}")
    print()

    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        for path in sorted(APP_ROOT.rglob("*")):
            if not path.is_file():
                continue
            if should_exclude(path, APP_ROOT, include_data):
                files_skipped += 1
                continue
            # Skip this script itself
            if path == Path(__file__).resolve():
                continue

            arcname = f"{APP_NAME}/{path.relative_to(APP_ROOT)}"
            zf.write(path, arcname)
            size = path.stat().st_size
            total_size += size
            files_added += 1
            if files_added % 50 == 0:
                print(f"  ... {files_added} fichiers ajoutes")

        # Ajouter un README d'installation
        install_readme = f"""# {APP_NAME} — Installation offline

Genere le : {datetime.now().strftime("%Y-%m-%d %H:%M")}

## Prerequis
- Python >= 3.10 (conda env recommande : IA_env)
- Node.js >= 18 + npm

## Installation

### 1. Extraire
```
unzip {output.name} -d .
cd {APP_NAME}/
```

### 2. Backend (Python)
```bash
conda activate IA_env
pip install -r backend/requirements.txt
```

### 3. Frontend (Node)
```bash
cd frontend/
npm install
cd ..
```

### 4. Lancer
```bash
python launcher.py --user bob --workspace /mon/workspace
```

## Notes
- Le workspace est cree automatiquement.
- Pour un lancement multi-utilisateurs, chaque user specifie --user et --workspace distincts.
- Les ports sont alloues automatiquement (8000+ backend, 5173+ frontend).
"""
        zf.writestr(f"{APP_NAME}/INSTALL.md", install_readme)

    zip_size_mb = output.stat().st_size / 1024 / 1024
    print()
    print(f"[OK] ZIP cree avec succes !")
    print(f"  Fichiers inclus  : {files_added}")
    print(f"  Fichiers exclus  : {files_skipped}")
    print(f"  Taille source    : {total_size / 1024 / 1024:.1f} MB")
    print(f"  Taille ZIP       : {zip_size_mb:.1f} MB")
    print(f"  Sortie           : {output}")


def main() -> None:
    parser = argparse.ArgumentParser(description=f"Package {APP_NAME} for offline distribution")
    parser.add_argument(
        "--output", "-o",
        default=str(APP_ROOT.parent / f"{APP_NAME}_offline_{datetime.now().strftime('%Y%m%d')}.zip"),
        help="Chemin du ZIP de sortie"
    )
    parser.add_argument(
        "--include-data", action="store_true",
        help="Inclure le dossier data/ (workspace, peut etre lourd)"
    )
    args = parser.parse_args()

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)

    make_zip(output, args.include_data)


if __name__ == "__main__":
    main()
