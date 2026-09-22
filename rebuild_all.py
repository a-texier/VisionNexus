#!/usr/bin/env python3
"""Restore Node dependencies and rebuild every VisionNexus interface."""
from __future__ import annotations

import argparse
import platform
import shutil
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
FRONTENDS = [
    ROOT / "Annotation_App" / "frontend",
    ROOT / "Dataset_Explorer_App" / "frontend",
    ROOT / "Training_App" / "frontend",
    ROOT / "Inference_App" / "frontend",
    ROOT / "Orchestrator_App" / "frontend",
    ROOT / "DVC_App" / "frontend",
    ROOT / "MLflow_App" / "frontend",
    ROOT / "Optuna_App" / "frontend",
]
DESKTOP = ROOT / "desktop"


def run(command: list[str], cwd: Path) -> None:
    print(f"\n[{cwd.relative_to(ROOT)}] {' '.join(command)}", flush=True)
    subprocess.run(command, cwd=cwd, check=True)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Restaure et compile toutes les interfaces VisionNexus."
    )
    parser.add_argument(
        "--skip-install",
        action="store_true",
        help="Conserve les node_modules existants au lieu d'executer npm ci",
    )
    parser.add_argument(
        "--package-desktop",
        action="store_true",
        help="Produit aussi l'executable Electron pour le systeme courant",
    )
    args = parser.parse_args()

    if sys.version_info < (3, 11):
        raise SystemExit("Python 3.11 ou plus recent est requis.")
    npm = shutil.which("npm")
    if not npm:
        raise SystemExit("npm est introuvable. Installez Node.js 20 LTS ou plus recent.")

    targets = [path for path in FRONTENDS if (path / "package-lock.json").is_file()]
    targets.append(DESKTOP)
    for target in targets:
        if not args.skip_install:
            run([npm, "ci"], target)
        run([npm, "run", "build"], target)

    if args.package_desktop:
        desktop_script = "dist:win" if platform.system() == "Windows" else "dist:linux"
        run([npm, "run", desktop_script], DESKTOP)

    print("\nReconstruction terminee.")
    if not args.package_desktop:
        print("Ajoutez --package-desktop pour produire le binaire Electron.")


if __name__ == "__main__":
    main()
