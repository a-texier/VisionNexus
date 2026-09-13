# ============================================================
# routers/storage.py
# Endpoints d'information et de gestion de l'espace disque.
#
# GET  /api/storage/stats   — tailles backup / projets / exports (Mo)
# DELETE /api/storage/backup  — vider le dossier backup
# DELETE /api/storage/exports — vider le dossier exports
# ============================================================

import shutil
import stat as _stat
from pathlib import Path

from fastapi import APIRouter

from backend.config import BACKUP_DIR, EXPORTS_DIR, WORKSPACE

router = APIRouter(tags=["Stockage"])

PROJECTS_DIR = WORKSPACE / "projects"


def _dir_size_mb(path: Path) -> float:
    """Taille RÉELLE d'un dossier en Mo (0.0 si absent).

    IMPORTANT : ne SUIT PAS les symlinks (lstat). Les frames importées en « zéro
    copie » sont des liens symboliques vers les images sources — les compter via
    stat() (qui suit le lien) gonflait le total à des dizaines de Go alors qu'elles
    ne consomment quasi rien dans le workspace. (S12)
    """
    if not path.exists():
        return 0.0
    total_bytes = 0
    for f in path.rglob("*"):
        try:
            st = f.lstat()                       # ne suit pas les symlinks
            if _stat.S_ISLNK(st.st_mode):
                continue                         # symlink → n'occupe pas d'espace réel
            if _stat.S_ISREG(st.st_mode):
                total_bytes += st.st_size
        except OSError:
            continue
    return round(total_bytes / (1024 * 1024), 1)


@router.get("/api/storage/stats")
def storage_stats() -> dict:
    """
    Retourne la taille en Mo de chaque dossier du workspace.
    """
    return {
        "backup_mb":   _dir_size_mb(BACKUP_DIR),
        "projects_mb": _dir_size_mb(PROJECTS_DIR),
        "exports_mb":  _dir_size_mb(EXPORTS_DIR),
        "backup_path":  str(BACKUP_DIR),
        "projects_path": str(PROJECTS_DIR),
        "exports_path":  str(EXPORTS_DIR),
    }


@router.delete("/api/storage/backup")
def clear_backup() -> dict:
    """Vide le dossier backup (JSON de sauvegarde d'annotations)."""
    if BACKUP_DIR.exists():
        shutil.rmtree(BACKUP_DIR)
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    return {"success": True, "cleared": "backup"}


@router.delete("/api/storage/exports")
def clear_exports() -> dict:
    """Vide le dossier exports (ZIP YOLO générés)."""
    if EXPORTS_DIR.exists():
        shutil.rmtree(EXPORTS_DIR)
    EXPORTS_DIR.mkdir(parents=True, exist_ok=True)
    return {"success": True, "cleared": "exports"}
