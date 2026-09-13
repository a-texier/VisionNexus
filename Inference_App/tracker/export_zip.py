#!/usr/bin/env python3
##########################################
# Project  : VisionNexus
# File     : export_zip.py
# Author   : VisionNexus contributors
# Created  : 2026-06-12
# Obj  : CLI tool to create a clean redistributable ZIP or folder copy of VisionNexus.
##########################################

import argparse
import shutil
import zipfile
from datetime import datetime
from pathlib import Path

#################################
# Configuration des exclusions
#################################

# Dossiers dont on conserve uniquement le placeholder (vide dans la sortie)
EMPTY_DIRS = [
    "outputs",
    "data/sequences",
    "quality/logs",
]

# Patterns de fichiers/dossiers toujours exclus (match sur chaque composant du chemin)
EXCLUDE_PATTERNS = [
    "__pycache__",
    ".git",
    ".ruff_cache",
    ".mypy_cache",
    ".idea",
    "*.pyc",
    "*.pyo",
    "*.egg-info",
    ".pytest_cache",
    "*.tmp",
    ".DS_Store",
    "Thumbs.db",
    # Fichiers generes par quality.py -  inutiles dans un export
    ".coverage",
    "coverage_html",
    # Logs dates generes par quality.py (quality/logs/ est garde vide via EMPTY_DIRS)
    "quality_*.log",
    # Binaires Linux compiles (Cython .so) presents dans les repos tiers clones.
    # Non portables (Linux x86_64 uniquement) et non utilises par la pipeline.
    "*.so",
    # Artefacts de build deploy (env conda + zip standalone). Sans ca, un export
    # lance apres un build embarquerait l'env (~10 Go) et le zip dans lui-meme.
    # "visionnexus_inference_export_*" couvre le dossier standalone ET les zips de sortie
    # (visionnexus_inference_export_standalone.zip, visionnexus_inference_export_YYYYMMDD.zip...).
    "_standalone_build",
    "visionnexus_inference_export_*",
]


def _matches_exclude(rel_path: str) -> bool:
    """Retourne True si rel_path doit etre exclus selon EXCLUDE_PATTERNS."""
    import fnmatch

    for part in Path(rel_path).parts:
        for pattern in EXCLUDE_PATTERNS:
            if fnmatch.fnmatch(part, pattern):
                return True
    return False


def _is_in_empty_dir(rel_path: str, empty_dirs: list) -> bool:
    """
    Retourne True si rel_path est SOUS un des dossiers vides (pas le dossier lui-meme).
    Ex : 'outputs/run_2025/bench.json' -> True
         'outputs'                     -> False (on garde le dossier vide)
    """
    rel = Path(rel_path)
    for ed in empty_dirs:
        ed_path = Path(ed)
        try:
            rel.relative_to(ed_path)
            if rel != ed_path:
                return True
        except ValueError:
            pass
    return False


def collect_files(project_root: Path, empty_dirs: list) -> list:
    """
    Parcourt project_root et retourne la liste des (abs_path, rel_posix).
    Applique les regles d'exclusion.
    """
    entries = []
    for abs_path in sorted(project_root.rglob("*")):
        rel = abs_path.relative_to(project_root)
        rel_str = rel.as_posix()

        if _matches_exclude(rel_str):
            continue
        if _is_in_empty_dir(rel_str, empty_dirs):
            continue

        entries.append((abs_path, rel_str))

    return entries


#################################
# Mode ZIP
#################################


def create_zip(project_root: Path, output_path: Path, dry_run: bool = False) -> None:
    """Cree le ZIP selon les regles d'inclusion."""
    entries = collect_files(project_root, EMPTY_DIRS)
    placeholders = [f"{ed}/.gitkeep" for ed in EMPTY_DIRS]
    total = len(entries) + len(placeholders)

    print("Mode       : ZIP")
    print(f"Projet     : {project_root}")
    print(f"Sortie     : {output_path}")
    print(f"Fichiers   : {len(entries)} + {len(placeholders)} placeholders = {total} entrees")
    print()

    if dry_run:
        _print_dry_run(entries, placeholders)
        return

    with zipfile.ZipFile(output_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        for abs_path, rel_str in entries:
            if abs_path.is_file():
                zf.write(abs_path, rel_str)
            elif abs_path.is_dir():
                zi = zipfile.ZipInfo(rel_str + "/")
                zf.writestr(zi, "")
        for ph in placeholders:
            zf.writestr(ph, "")

    size_mb = output_path.stat().st_size / 1024 / 1024
    print(f"ZIP cree : {output_path}  ({size_mb:.1f} MB)")


#################################
# Mode dossier (--nozip)
#################################


def create_folder_copy(project_root: Path, output_path: Path, dry_run: bool = False) -> None:
    """Copie le projet dans output_path en appliquant les memes regles d'exclusion."""
    entries = collect_files(project_root, EMPTY_DIRS)
    placeholders = [f"{ed}/.gitkeep" for ed in EMPTY_DIRS]
    total = len(entries) + len(placeholders)

    print("Mode       : DOSSIER (--nozip)")
    print(f"Projet     : {project_root}")
    print(f"Sortie     : {output_path}")
    print(f"Fichiers   : {len(entries)} + {len(placeholders)} placeholders = {total} entrees")
    print()

    if dry_run:
        _print_dry_run(entries, placeholders)
        return

    if output_path.exists():
        print(f"Suppression de l'existant : {output_path}")
        shutil.rmtree(output_path)
    output_path.mkdir(parents=True)

    n_copied = 0
    for abs_path, rel_str in entries:
        dest = output_path / rel_str
        if abs_path.is_dir():
            dest.mkdir(parents=True, exist_ok=True)
        elif abs_path.is_file():
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(abs_path, dest)
            n_copied += 1

    # Placeholders pour les dossiers vides
    for ph in placeholders:
        dest = output_path / ph
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.touch()

    print(f"Copie terminee : {output_path}  ({n_copied} fichiers)")


#################################
# Helpers
#################################


def _print_dry_run(entries: list, placeholders: list) -> None:
    print("=== DRY RUN - liste des fichiers inclus ===")
    for _, rel in entries:
        print(f"  {rel}")
    for ph in placeholders:
        print(f"  {ph}  [placeholder]")
    print()
    print(f"Total : {len(entries) + len(placeholders)} entrees (rien cree)")


#################################
# Point d'entree
#################################


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Exporte le projet VisionNexus Inference (sans outputs ni sequences) en ZIP ou dossier."
        ),
    )
    parser.add_argument(
        "--output",
        "-o",
        type=str,
        default=None,
        help=(
            "Chemin de sortie. "
            "ZIP (defaut) : visionnexus_inference_export_YYYYMMDD.zip. "
            "Dossier (--nozip) : visionnexus_inference_export_YYYYMMDD/"
        ),
    )
    parser.add_argument(
        "--nozip",
        action="store_true",
        help="Copie le projet dans un dossier au lieu de creer un ZIP.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Affiche la liste des fichiers sans rien creer.",
    )
    args = parser.parse_args()

    project_root = Path(__file__).resolve().parent
    date_str = datetime.now().strftime("%Y%m%d")

    if args.output is None:
        if args.nozip:
            output_path = project_root / f"visionnexus_inference_export_{date_str}"
        else:
            output_path = project_root / f"visionnexus_inference_export_{date_str}.zip"
    else:
        output_path = Path(args.output).resolve()

    if args.nozip:
        create_folder_copy(project_root, output_path, dry_run=args.dry_run)
    else:
        create_zip(project_root, output_path, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
