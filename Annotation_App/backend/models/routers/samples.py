# ============================================================
# routers/samples.py
# Sequences d'exemple livrees avec la suite (dossier data_tuto/ a la
# racine de Computer_Vision_App, partage par tous les tutoriels).
#
# Le tutoriel interactif a besoin du chemin TEL QUE VU PAR LE BACKEND :
# c'est lui qui resout le chemin serveur saisi dans la modale d'import
# (symlink zero copie). En session SSH le frontend ne connait pas ce
# chemin, d'ou cet endpoint.
# Prefixe : /api/samples
# ============================================================

from typing import List

from fastapi import APIRouter, HTTPException

from backend.config import SAMPLE_SEQUENCES_DIR

router = APIRouter(prefix="/api/samples", tags=["Samples"])

# Sequence utilisee par le tutoriel interactif ("Template Cars Annotation").
TEMPLATE_SEQUENCE_ID = "cars_10_frames"

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff", ".webp"}


def _describe(folder_name: str) -> dict:
    folder = SAMPLE_SEQUENCES_DIR / folder_name
    images = sorted(
        f.name for f in folder.iterdir()
        if f.is_file() and f.suffix.lower() in IMAGE_SUFFIXES
    ) if folder.is_dir() else []
    return {
        "id": folder_name,
        "path": str(folder),
        "exists": folder.is_dir() and len(images) > 0,
        "frame_count": len(images),
        "first_frame": images[0] if images else None,
    }


@router.get("/sequences", response_model=List[dict])
def list_sample_sequences():
    """Liste les sequences d'exemple embarquees (chemin absolu cote backend)."""
    if not SAMPLE_SEQUENCES_DIR.is_dir():
        return []
    return [
        _describe(child.name)
        for child in sorted(SAMPLE_SEQUENCES_DIR.iterdir())
        if child.is_dir()
    ]


@router.get("/sequences/{sample_id}", response_model=dict)
def get_sample_sequence(sample_id: str):
    """Detail d'une sequence d'exemple. 404 si le dossier livre est absent."""
    # Pas de traversee : seul un nom de dossier direct est accepte.
    if "/" in sample_id or "\\" in sample_id or sample_id.startswith("."):
        raise HTTPException(status_code=400, detail="Identifiant invalide")
    info = _describe(sample_id)
    if not info["exists"]:
        raise HTTPException(
            status_code=404,
            detail=f"Sequence d'exemple '{sample_id}' absente de l'installation",
        )
    return info
