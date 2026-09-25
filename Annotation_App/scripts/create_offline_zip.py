#!/usr/bin/env python3
"""
Script pour creer une archive deployable de l'Annotation App.

Cree un ZIP autonome contenant :
  - Tout le code source (backend + frontend)
  - Les modeles IA locaux (checkpoints SAM2, Grounding DINO, SAM3.1, XFeat)
  - Le dossier offline/ correspondant a la plateforme cible :
      offline_windows/  (wheels pip + cache npm Windows)
      offline_linux/    (wheels pip + cache npm Linux)
      offline/          (conda spec-file, conda-pack, README)

Exclut par defaut :
  - node_modules/           (regenere par npm install --cache offline_<platform>/npm-cache)
  - __pycache__/ et *.pyc   (regeneres automatiquement)
  - .git/                   (historique Git non necessaire au deploiement)
  - data/annotation.db      (base de donnees specifique a la machine)
  - data/projects/          (images et frames specifiques a la machine)
  - data/exports/           (exports YOLO generes)
  - data/backup/            (sauvegardes locales)
  - .env                    (variables d'environnement locales)
  - frontend/dist/          (regenere par npm run build)
  - offline/conda/IA_env.tar.gz  (conda-pack ~6-8 GB, exclure avec --include-conda-pack)
  - offline_windows/        (exclure si --platform linux)
  - offline_linux/          (exclure si --platform windows)

Usage :
  python scripts/create_offline_zip.py
  python scripts/create_offline_zip.py --platform linux
  python scripts/create_offline_zip.py --platform windows
  python scripts/create_offline_zip.py --output /chemin/vers/destination/
  python scripts/create_offline_zip.py --skip-models         (code + offline/ seulement)
  python scripts/create_offline_zip.py --include-conda-pack  (inclure IA_env.tar.gz, +6 GB)
  python scripts/create_offline_zip.py --dry-run

Preparer les dossiers offline avant de zipper (machine source avec internet) :
  # Wheels pip (Windows)
  pip download -r backend/requirements.txt -d offline_windows/wheels/ --platform win_amd64 --python-version 311 --only-binary :all:
  # Wheels pip (Linux)
  pip download -r backend/requirements.txt -d offline_linux/wheels/ --platform linux_x86_64 --python-version 311 --only-binary :all:
  # Cache npm Windows
  cp -r "$(npm config get cache)" offline_windows/npm-cache
  # Cache npm Linux — installer les binaires Linux d'abord :
  npm install --no-save @rolldown/binding-linux-x64-gnu @tailwindcss/oxide-linux-x64-gnu
  cp -r "$(npm config get cache)" offline_linux/npm-cache
  # Spec-file conda (leger)
  conda env export > offline/conda/environment.yml
  conda list --explicit > offline/conda/spec-file.txt
  # conda-pack (optionnel, gros)
  conda pack -n IA_env -o offline/conda/IA_env.tar.gz
"""

import argparse
import os
import sys
import zipfile
from datetime import datetime
from pathlib import Path

# ============================================================
# Configuration
# ============================================================

# Dossier racine du projet (parent du dossier scripts/)
ROOT_DIR = Path(__file__).resolve().parent.parent

# Nom de base du fichier ZIP genere
ZIP_BASE_NAME = "AnnotationApp_offline"

# Patterns de dossiers et fichiers a exclure (relatifs a ROOT_DIR)
EXCLUDE_DIRS = {
    "node_modules",
    "__pycache__",
    ".git",
    ".venv",
    "venv",
    ".mypy_cache",
    ".pytest_cache",
    ".ruff_cache",
    "frontend/dist",
    "data/projects",
    "data/exports",
    "data/backup",
}

EXCLUDE_FILES = {
    "data/annotation.db",
    ".env",
    ".env.local",
    ".env.production",
    "frontend/.env",
    "backend/.env",
}

EXCLUDE_EXTENSIONS = {
    ".pyc",
    ".pyo",
    ".pyd",
    ".DS_Store",
    "Thumbs.db",
    ".log",
}

# Fichiers offline/ exclus par defaut car trop volumineux
# (inclure avec --include-conda-pack)
EXCLUDE_OFFLINE_HEAVY = {
    "offline/conda/IA_env.tar.gz",
}

# Dossiers offline plateforme — exclus selon --platform
OFFLINE_PLATFORM_DIRS = {
    "windows": "offline_windows",
    "linux":   "offline_linux",
}


# ============================================================
# Fonctions utilitaires
# ============================================================

def format_size(bytes_count: int) -> str:
    """Formater une taille en octets en chaine lisible."""
    for unit in ["B", "KB", "MB", "GB"]:
        if bytes_count < 1024:
            return f"{bytes_count:.1f} {unit}"
        bytes_count /= 1024
    return f"{bytes_count:.1f} TB"


def should_exclude(path: Path, root: Path, platform: str) -> bool:
    """Determiner si un fichier ou dossier doit etre exclu du ZIP."""
    rel = path.relative_to(root)
    rel_str = str(rel).replace("\\", "/")

    # Exclure le dossier offline de la plateforme opposee
    if platform == "windows" and rel_str.startswith("offline_linux/"):
        return True
    if platform == "linux" and rel_str.startswith("offline_windows/"):
        return True
    # Si plateforme = both, garder les deux (aucune exclusion plateforme)

    # Verifier les dossiers exclus (verifier chaque composant du chemin)
    for part in rel.parts:
        if part in EXCLUDE_DIRS:
            return True

    # Verifier les prefixes de dossiers exclus (ex: "data/projects")
    for excluded_dir in EXCLUDE_DIRS:
        if rel_str.startswith(excluded_dir + "/") or rel_str == excluded_dir:
            return True

    # Verifier les fichiers exclus specifiques
    if rel_str in EXCLUDE_FILES:
        return True

    # Verifier les extensions exclues
    if path.suffix.lower() in EXCLUDE_EXTENSIONS:
        return True

    return False


def collect_files(
    root: Path,
    platform: str = "both",
    skip_models: bool = False,
    include_conda_pack: bool = False,
) -> list[Path]:
    """Collecter tous les fichiers a inclure dans le ZIP."""
    files = []

    model_dirs = set()
    if skip_models:
        model_dirs = {
            "backend/checkpoints",
            "backend/models/xfeat/weights",
        }

    for item in root.rglob("*"):
        if not item.is_file():
            continue

        if should_exclude(item, root, platform):
            continue

        rel_str = str(item.relative_to(root)).replace("\\", "/")

        if skip_models:
            if any(rel_str.startswith(d) for d in model_dirs):
                continue

        # Exclure conda-pack par defaut (trop gros)
        if not include_conda_pack and rel_str in EXCLUDE_OFFLINE_HEAVY:
            continue

        files.append(item)

    return sorted(files)


def print_summary(files: list[Path], root: Path, platform: str) -> None:
    """Afficher un resume des fichiers collectes par categorie."""
    # Determiner le label du dossier offline npm selon la plateforme
    if platform == "linux":
        npm_cache_label = "offline_linux/ — Cache npm (Linux)"
        wheels_win_label = None
        wheels_linux_label = "offline_linux/ — Wheels pip"
    elif platform == "windows":
        npm_cache_label = "offline_windows/ — Cache npm (Windows)"
        wheels_win_label = "offline_windows/ — Wheels pip"
        wheels_linux_label = None
    else:
        npm_cache_label = "offline_*/ — Cache npm"
        wheels_win_label = "offline_windows/ — Wheels pip"
        wheels_linux_label = "offline_linux/ — Wheels pip"

    categories: dict[str, list[Path]] = {
        "Code backend (Python)": [],
        "Code frontend (TypeScript/React)": [],
        "Modeles SAM2": [],
        "Modeles SAM3.1": [],
        "Modeles Grounding DINO": [],
        "Modeles XFeat": [],
        "offline/ — Wheel SAM2 (commun)": [],
    }
    if wheels_win_label:
        categories[wheels_win_label] = []
    if wheels_linux_label:
        categories[wheels_linux_label] = []
    categories[npm_cache_label] = []
    categories["offline/ — Conda (env + spec)"] = []
    categories["Configuration / Documentation"] = []
    categories["Autres"] = []

    for f in files:
        rel = str(f.relative_to(root)).replace("\\", "/")
        if rel.startswith("backend/checkpoints/sam2"):
            categories["Modeles SAM2"].append(f)
        elif rel.startswith("backend/checkpoints/sam3"):
            categories["Modeles SAM3.1"].append(f)
        elif rel.startswith("backend/checkpoints/grounding_dino"):
            categories["Modeles Grounding DINO"].append(f)
        elif rel.startswith("backend/models/xfeat"):
            categories["Modeles XFeat"].append(f)
        elif rel.startswith("offline/wheels/"):
            categories["offline/ — Wheel SAM2 (commun)"].append(f)
        elif rel.startswith("offline_windows/wheels/") and wheels_win_label:
            categories[wheels_win_label].append(f)
        elif rel.startswith("offline_linux/wheels/") and wheels_linux_label:
            categories[wheels_linux_label].append(f)
        elif rel.startswith("offline_windows/npm-cache/") or rel.startswith("offline_linux/npm-cache/"):
            categories[npm_cache_label].append(f)
        elif rel.startswith("offline/conda/"):
            categories["offline/ — Conda (env + spec)"].append(f)
        elif rel.startswith("backend/") and f.suffix == ".py":
            categories["Code backend (Python)"].append(f)
        elif rel.startswith("frontend/src/"):
            categories["Code frontend (TypeScript/React)"].append(f)
        elif f.suffix in {".md", ".txt", ".json", ".yaml", ".yml", ".toml", ".cfg", ".ini"}:
            categories["Configuration / Documentation"].append(f)
        else:
            categories["Autres"].append(f)

    print("\nContenu du ZIP :")
    print("-" * 60)
    total_size = 0
    for category, cat_files in categories.items():
        if not cat_files:
            continue
        size = sum(f.stat().st_size for f in cat_files)
        total_size += size
        print(f"  {category:<42} {len(cat_files):>4} fichiers  {format_size(size):>10}")
    print("-" * 60)
    print(f"  {'TOTAL':<42} {len(files):>4} fichiers  {format_size(total_size):>10}")


# ============================================================
# Creation du ZIP
# ============================================================

def create_zip(
    output_path: Path,
    files: list[Path],
    root: Path,
    verbose: bool = False,
) -> None:
    """Creer le fichier ZIP avec tous les fichiers collectes."""
    total = len(files)
    total_size = sum(f.stat().st_size for f in files)

    print(f"\nCreation du ZIP : {output_path.name}")
    print(f"  Fichiers a compresser : {total}")
    print(f"  Taille totale source  : {format_size(total_size)}")
    print()

    with zipfile.ZipFile(output_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        for i, file_path in enumerate(files):
            arcname = str(file_path.relative_to(root)).replace("\\", "/")

            if verbose:
                size = format_size(file_path.stat().st_size)
                print(f"  [{i+1}/{total}] {arcname} ({size})")
            else:
                # Afficher la progression toutes les 50 fichiers ou les gros fichiers
                file_size = file_path.stat().st_size
                if i % 50 == 0 or file_size > 50 * 1024 * 1024:
                    pct = (i + 1) * 100 // total
                    print(f"\r  Progression : {pct:3d}%  [{i+1}/{total}]  {arcname[:60]:<60}", end="", flush=True)

            zf.write(file_path, arcname)

    if not verbose:
        print(f"\r  Progression : 100%  [{total}/{total}]  Termine.{' ' * 50}")

    zip_size = output_path.stat().st_size
    ratio = (1 - zip_size / max(total_size, 1)) * 100
    print(f"\n  Taille du ZIP         : {format_size(zip_size)}")
    print(f"  Taux de compression   : {ratio:.1f}%")


# ============================================================
# Point d'entree principal
# ============================================================

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Creer une archive deployable de l'Annotation App.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Exemples :
  python scripts/create_offline_zip.py
  python scripts/create_offline_zip.py --platform linux
  python scripts/create_offline_zip.py --platform windows
  python scripts/create_offline_zip.py --output C:/Deployments/
  python scripts/create_offline_zip.py --skip-models
  python scripts/create_offline_zip.py --verbose
  python scripts/create_offline_zip.py --platform linux --dry-run
        """,
    )
    parser.add_argument(
        "--platform", "-p",
        type=str,
        default="both",
        choices=["windows", "linux", "both"],
        help="Plateforme cible : windows, linux, ou both (defaut : both). "
             "Selectionne offline_windows/ ou offline_linux/ a inclure dans le ZIP.",
    )
    parser.add_argument(
        "--output", "-o",
        type=str,
        default=None,
        help="Dossier de destination du ZIP (defaut : dossier racine du projet)",
    )
    parser.add_argument(
        "--skip-models",
        action="store_true",
        help="Exclure les modeles IA du ZIP (code source uniquement)",
    )
    parser.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="Afficher chaque fichier ajoute",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Simuler sans creer le ZIP (affiche juste le resume)",
    )
    parser.add_argument(
        "--include-conda-pack",
        action="store_true",
        help="Inclure offline/conda/IA_env.tar.gz (conda-pack ~6-8 GB, exclure par defaut)",
    )
    args = parser.parse_args()

    platform = args.platform

    # Verifier que ROOT_DIR est bien la racine du projet
    if not (ROOT_DIR / "backend" / "main.py").exists():
        print(f"ERREUR : Impossible de trouver backend/main.py depuis {ROOT_DIR}")
        print("         Verifiez que ce script est dans le dossier scripts/ du projet.")
        sys.exit(1)

    # Dossier de sortie
    if args.output:
        output_dir = Path(args.output)
    else:
        output_dir = ROOT_DIR

    output_dir.mkdir(parents=True, exist_ok=True)

    # Nom du fichier ZIP avec date et plateforme
    date_str = datetime.now().strftime("%Y%m%d")
    platform_suffix = f"_{platform}" if platform != "both" else ""
    code_suffix = "_code_only" if args.skip_models else ""
    zip_name = f"{ZIP_BASE_NAME}{platform_suffix}{code_suffix}_{date_str}.zip"
    zip_path = output_dir / zip_name

    print("=" * 60)
    print("  Annotation App — Creation archive offline")
    print("=" * 60)
    print(f"  Racine du projet  : {ROOT_DIR}")
    print(f"  Archive de sortie : {zip_path}")
    print(f"  Plateforme cible  : {platform.upper()}")
    if args.skip_models:
        print("  Mode : CODE SEULEMENT (modeles exclus)")
    else:
        print("  Mode : COMPLET (code + modeles IA)")
    if args.include_conda_pack:
        print("  + conda-pack IA_env.tar.gz INCLUS (+6-8 GB)")
    else:
        print("  conda-pack IA_env.tar.gz EXCLU (utiliser --include-conda-pack pour l'inclure)")

    # Verifier la presence des dossiers offline plateforme
    if platform in ("windows", "both"):
        offline_win = ROOT_DIR / "offline_windows"
        npm_win = offline_win / "npm-cache"
        if not offline_win.exists():
            print(f"\n  ATTENTION : offline_windows/ absent — creer avec mkdir -p offline_windows/npm-cache")
        elif not npm_win.exists() or not any(npm_win.iterdir()):
            print(f"\n  ATTENTION : offline_windows/npm-cache/ absent ou vide")
            print(f"             Copier le cache npm Windows : robocopy $(npm config get cache) offline_windows\\npm-cache /E")

    if platform in ("linux", "both"):
        offline_lin = ROOT_DIR / "offline_linux"
        npm_lin = offline_lin / "npm-cache"
        if not offline_lin.exists():
            print(f"\n  ATTENTION : offline_linux/ absent — creer avec mkdir -p offline_linux/npm-cache")
        elif not npm_lin.exists() or not any(npm_lin.iterdir()):
            print(f"\n  ATTENTION : offline_linux/npm-cache/ absent ou vide")
            print(f"             Installer les binaires Linux puis copier le cache :")
            print(f"               npm install --no-save @rolldown/binding-linux-x64-gnu @tailwindcss/oxide-linux-x64-gnu")
            print(f"               robocopy $(npm config get cache) offline_linux\\npm-cache /E")

    # Collecter les fichiers
    print("\nAnalyse des fichiers...")
    files = collect_files(
        ROOT_DIR,
        platform=platform,
        skip_models=args.skip_models,
        include_conda_pack=args.include_conda_pack,
    )

    # Afficher le resume
    print_summary(files, ROOT_DIR, platform)

    # Afficher ce qui est exclu
    print("\nExclusions actives :")
    dirs_to_show = set(EXCLUDE_DIRS)
    if platform == "windows":
        dirs_to_show.add("offline_linux")
    elif platform == "linux":
        dirs_to_show.add("offline_windows")
    for d in sorted(dirs_to_show):
        excluded_path = ROOT_DIR / d.replace("/", os.sep)
        exists = "[present]" if excluded_path.exists() else "[absent] "
        print(f"  {exists} {d}/")
    for f in sorted(EXCLUDE_FILES):
        excluded_path = ROOT_DIR / f.replace("/", os.sep)
        exists = "[present]" if excluded_path.exists() else "[absent] "
        print(f"  {exists} {f}")

    if args.dry_run:
        print("\nMode --dry-run : aucun fichier cree.")
        return

    # Confirmer si le ZIP existe deja
    if zip_path.exists():
        answer = input(f"\nLe fichier {zip_name} existe deja. Ecraser ? [o/N] ").strip().lower()
        if answer not in ("o", "oui", "y", "yes"):
            print("Operation annulee.")
            sys.exit(0)

    # Creer le ZIP
    create_zip(zip_path, files, ROOT_DIR, verbose=args.verbose)

    print("\n" + "=" * 60)
    print("  Archive creee avec succes !")
    print("=" * 60)
    print(f"  Fichier : {zip_path}")
    print(f"  Taille  : {format_size(zip_path.stat().st_size)}")
    print()
    print("  Pour deployer sur un nouveau PC :")
    print(f"    1. Copier {zip_name} sur la machine cible")
    print(f"    2. Dezipper dans le dossier souhaite")
    print(f"    3. Suivre docs/configuration.fr.md")
    print()

    # Verifier le contenu des dossiers offline plateforme
    def report_offline_dir(label: str, dir_path: Path, rel_prefix: str) -> None:
        npm_path = dir_path / "npm-cache"
        wheels_path = dir_path / "wheels"
        print(f"  {label} :")
        for sub, sublabel in [(npm_path, "npm-cache/"), (wheels_path, "wheels/")]:
            if sub.exists():
                n = sum(1 for _ in sub.rglob("*") if _.is_file())
                sz = sum(f.stat().st_size for f in sub.rglob("*") if f.is_file())
                print(f"    [OK]     {rel_prefix}/{sublabel:<30} {n} fichiers  {format_size(sz)}")
            else:
                print(f"    [ABSENT] {rel_prefix}/{sublabel:<30} (non genere — voir MODEL_WEIGHTS.md a la racine)")

    if platform in ("windows", "both") and (ROOT_DIR / "offline_windows").exists():
        report_offline_dir("offline_windows/", ROOT_DIR / "offline_windows", "offline_windows")
    if platform in ("linux", "both") and (ROOT_DIR / "offline_linux").exists():
        report_offline_dir("offline_linux/", ROOT_DIR / "offline_linux", "offline_linux")

    # Verifier le contenu du dossier offline/ (conda)
    offline_dir = ROOT_DIR / "offline"
    if offline_dir.exists():
        print("  offline/ (conda) :")
        offline_items = [
            ("offline/conda/spec-file.txt",    "Spec-file conda (packages exacts)"),
            ("offline/conda/environment.yml",  "environment.yml conda"),
            ("offline/conda/IA_env.tar.gz",    "conda-pack complet (~6-8 GB)"),
        ]
        for rel_path, label in offline_items:
            full_path = ROOT_DIR / rel_path.replace("/", os.sep)
            if full_path.exists():
                sz = full_path.stat().st_size
                included = rel_path.rstrip("/") not in EXCLUDE_OFFLINE_HEAVY or args.include_conda_pack
                tag = "[OK]    " if included else "[EXCLU] "
                print(f"    {tag} {rel_path:<40} {format_size(sz)}")
            else:
                print(f"    [ABSENT] {rel_path:<40} (non genere — voir MODEL_WEIGHTS.md a la racine)")
        print()
    else:
        print("  ATTENTION : le dossier offline/ est absent.")
        print("  Generer son contenu sur une machine avec internet (section 3 du guide).")
        print()

    if not args.skip_models:
        print("  Contenu des modeles inclus dans l'archive :")
        model_paths = [
            ROOT_DIR / "backend" / "checkpoints" / "sam2.1_hiera_small.pt",
            ROOT_DIR / "backend" / "checkpoints" / "sam2.1_hiera_tiny.pt",
            ROOT_DIR / "backend" / "checkpoints" / "grounding_dino",
            ROOT_DIR / "backend" / "checkpoints" / "sam3.1",
            ROOT_DIR / "backend" / "models" / "xfeat" / "weights" / "xfeat.pt",
        ]
        for mp in model_paths:
            if mp.exists():
                if mp.is_file():
                    print(f"    [OK] {mp.relative_to(ROOT_DIR)}  ({format_size(mp.stat().st_size)})")
                else:
                    dir_size = sum(f.stat().st_size for f in mp.rglob("*") if f.is_file())
                    print(f"    [OK] {mp.relative_to(ROOT_DIR)}/  ({format_size(dir_size)})")
            else:
                print(f"    [ABSENT] {mp.relative_to(ROOT_DIR)}  (non inclus)")
        print()
        print("  Note : SAM3.1 necessite une authentification HuggingFace pour le telechargement.")
        print("         Voir backend/tests/download_all_models.py --hf-token <token>")


if __name__ == "__main__":
    main()
