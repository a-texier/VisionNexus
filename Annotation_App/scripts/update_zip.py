#!/usr/bin/env python3
"""
update_zip.py
Met a jour un fichier 7z/zip avec les fichiers nouveaux ou modifies du projet.
Usage :
    python scripts/update_zip.py [--zip <path>] [--dry-run]
"""

import argparse
import os
import subprocess
import sys
from pathlib import Path

# Repertoires et fichiers a exclure de l'archive
EXCLUDE_PATTERNS = [
    "__pycache__",
    "*.pyc",
    "*.pyo",
    ".git",
    "node_modules",
    "frontend/dist",
    "*.db",
    "*.db-wal",
    "*.db-shm",
    "data/",
    ".env",
    "*.log",
    ".venv",
    "venv",
]

def find_7z() -> str:
    """Trouve l'executable 7z sur le systeme."""
    candidates = [
        "7z",
        r"C:\Program Files\7-Zip\7z.exe",
        r"C:\Program Files (x86)\7-Zip\7z.exe",
        "/usr/bin/7z",
        "/usr/local/bin/7z",
    ]
    for c in candidates:
        try:
            result = subprocess.run([c, "i"], capture_output=True, timeout=5)
            if result.returncode == 0:
                return c
        except (FileNotFoundError, subprocess.TimeoutExpired):
            continue
    raise FileNotFoundError(
        "7z introuvable. Installez 7-Zip : https://www.7-zip.org/"
    )


def build_exclude_args(exe: str) -> list:
    """Construit les arguments d'exclusion pour 7z."""
    args = []
    for pattern in EXCLUDE_PATTERNS:
        args.append(f"-x!{pattern}")
    return args


def update_zip(zip_path: Path, project_dir: Path, dry_run: bool = False) -> None:
    """Met a jour le zip avec les fichiers nouveaux ou modifies."""
    exe = find_7z()
    print(f"[update_zip] 7z trouve : {exe}")
    print(f"[update_zip] Archive  : {zip_path}")
    print(f"[update_zip] Projet   : {project_dir}")

    cmd = [
        exe,
        "u",                    # update
        str(zip_path),          # archive
        ".",                    # source = repertoire courant
        "-r",                   # recursif
        "-mx=5",                # compression niveau 5
        "-mmt=on",              # multi-thread
    ] + build_exclude_args(exe)

    if dry_run:
        print("[update_zip] DRY RUN — commande qui serait executee :")
        print(" ".join(f'"{a}"' if " " in a else a for a in cmd))
        return

    print("[update_zip] Lancement...")
    result = subprocess.run(cmd, cwd=str(project_dir))
    # 7-zip codes : 0 = succes, 1 = avertissements (non fatals), 2+ = erreur fatale
    if result.returncode == 0:
        print(f"[update_zip] Archive mise a jour : {zip_path}")
    elif result.returncode == 1:
        print(f"[update_zip] Archive mise a jour avec avertissements (code 1 - non fatal)")
        print(f"[update_zip] Archive : {zip_path}")
    else:
        print(f"[update_zip] ERREUR (code {result.returncode})", file=sys.stderr)
        sys.exit(result.returncode)


def main():
    parser = argparse.ArgumentParser(description="Met a jour l'archive 7z du projet")
    parser.add_argument(
        "--zip",
        type=str,
        default=None,
        help="Chemin vers l'archive .zip/.7z (defaut: premier .zip trouve a la racine)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Affiche la commande sans l'executer",
    )
    args = parser.parse_args()

    # Localiser la racine du projet (parent du dossier scripts/)
    script_dir = Path(__file__).resolve().parent
    project_dir = script_dir.parent

    # Trouver l'archive
    if args.zip:
        zip_path = Path(args.zip)
    else:
        zips = list(project_dir.glob("*.zip")) + list(project_dir.glob("*.7z"))
        if not zips:
            print("Aucune archive .zip ou .7z trouvee a la racine du projet.", file=sys.stderr)
            print("Specifiez le chemin avec --zip <path>", file=sys.stderr)
            sys.exit(1)
        zip_path = sorted(zips)[-1]
        print(f"[update_zip] Archive detectee automatiquement : {zip_path.name}")

    update_zip(zip_path, project_dir, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
