# ============================================================
# core/subset_manager.py
# Gestion des subsets (dossiers de symlinks vers images orig.).
#
# Stratégie de lien : symlink uniquement (os.symlink).
#   1. Symlink relatif — portable, même volume
#   2. Symlink absolu  — cross-volume
# Si les deux échouent, une OSError est levée (pas de fallback copie).
# Fonctionne sur Linux sans restriction.
# Sur Windows, nécessite le Mode Développeur ou droits admin.
# ============================================================

import logging
import os
import shutil
from pathlib import Path
from typing import List, Optional

from backend.config import ANNOTATION_APP_IMPORTS, SUBSETS_DIR

logger = logging.getLogger(__name__)


def create_subset_symlinks(name: str, image_paths: List[str]) -> Path:
    """
    Crée un dossier de symlinks vers les images originales.

    Returns:
        Chemin absolu du dossier créé.
    """
    subset_dir = SUBSETS_DIR / name
    subset_dir.mkdir(parents=True, exist_ok=True)

    for img_path in image_paths:
        src = Path(img_path).resolve()
        dest = subset_dir / src.name

        if dest.exists() or dest.is_symlink():
            dest.unlink()

        _make_symlink(src, dest)

    logger.info("Subset '%s' cree avec %d images dans %s", name, len(image_paths), subset_dir)
    return subset_dir


def delete_subset_dir(symlink_dir: str) -> None:
    """Supprime le dossier de symlinks d'un subset."""
    path = Path(symlink_dir)
    if path.exists():
        shutil.rmtree(path)
        logger.info("Dossier subset supprime : %s", path)


def remove_from_subset_dir(subset_dir: str, filenames: List[str]) -> None:
    """Retire des symlinks du dossier d'un subset."""
    path = Path(subset_dir)
    if not path.exists():
        return
    for filename in filenames:
        f = path / filename
        if f.is_symlink() or f.exists():
            f.unlink()
            logger.info("Retire du subset : %s", filename)


def export_to_annotation_app(
    name: str,
    image_paths: List[str],
    custom_base_dir: Optional[str] = None,
) -> Path:
    """
    Exporte un subset vers {base}/{name}.
    Par defaut : ANNOTATION_APP_IMPORTS (defini dans config.py / env ANNOTATION_APP_IMPORTS).
    En mode solo avec chemin personnalise : custom_base_dir/{name}.
    Idempotent : si le dossier existe deja, ajoute uniquement les images manquantes.
    """
    base = Path(custom_base_dir) if custom_base_dir else ANNOTATION_APP_IMPORTS
    target_dir = base / name
    target_dir.mkdir(parents=True, exist_ok=True)
    for img_path in image_paths:
        src = Path(img_path).resolve()
        dest = target_dir / src.name
        if not dest.exists():
            _make_symlink(src, dest)

    logger.info("Subset '%s' exporte vers %s (%d images)", name, target_dir, len(image_paths))
    return target_dir


# ------------------------------------------------------------------ #
# Helper                                                              #
# ------------------------------------------------------------------ #

def _get_use_symlinks() -> bool:
    """Lit le paramètre use_symlinks depuis settings.json (défaut : True)."""
    try:
        from backend.api.settings import load_settings
        return load_settings().use_symlinks
    except Exception:
        return True


def _make_symlink(src: Path, dest: Path) -> None:
    """
    Crée un lien vers src à l'emplacement dest.

    Si use_symlinks=True (défaut) : symlink relatif puis absolu.
    Si use_symlinks=False : copie physique via shutil.copy2.
    """
    if not _get_use_symlinks():
        shutil.copy2(src, dest)
        logger.debug("Copie physique : %s -> %s", src, dest)
        return

    try:
        rel = Path(os.path.relpath(src, dest.parent))
        dest.symlink_to(rel)
        return
    except (ValueError, OSError):
        pass

    # Symlink absolu (lecteurs différents ou chemin relatif impossible)
    dest.symlink_to(src)
