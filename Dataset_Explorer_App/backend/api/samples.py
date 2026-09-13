# ============================================================
# api/samples.py
# Datasets d'exemple livres avec la suite (dossier data_tuto/ a la
# racine de Computer_Vision_App, partage par tous les tutoriels).
#
# Le tutoriel interactif a besoin du chemin TEL QUE VU PAR LE BACKEND :
# c'est lui qui scanne le dossier d'images saisi dans la Gallery. En
# session SSH le frontend ne connait pas ce chemin, d'ou cet endpoint.
# GET /api/samples/datasets        -- liste
# GET /api/samples/datasets/{id}   -- detail
# ============================================================

from typing import List

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.config import SAMPLE_DATASETS_DIR

router = APIRouter(prefix="/api/samples", tags=["samples"])

# Dataset utilise par le tutoriel interactif.
TUTO_DATASET_ID = "cars_10_frames"

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff", ".webp"}


class SampleDataset(BaseModel):
    id: str
    path: str           # chemin absolu cote backend
    exists: bool
    image_count: int
    first_image: str | None = None


def _describe(folder_name: str) -> SampleDataset:
    folder = SAMPLE_DATASETS_DIR / folder_name
    images = sorted(
        f.name for f in folder.iterdir()
        if f.is_file() and f.suffix.lower() in IMAGE_SUFFIXES
    ) if folder.is_dir() else []
    return SampleDataset(
        id=folder_name,
        path=str(folder),
        exists=bool(images),
        image_count=len(images),
        first_image=images[0] if images else None,
    )


@router.get("/datasets", response_model=List[SampleDataset])
def list_sample_datasets():
    """Liste les datasets d'exemple embarques (chemin absolu cote backend)."""
    if not SAMPLE_DATASETS_DIR.is_dir():
        return []
    return [
        _describe(child.name)
        for child in sorted(SAMPLE_DATASETS_DIR.iterdir())
        if child.is_dir()
    ]


@router.get("/datasets/{sample_id}", response_model=SampleDataset)
def get_sample_dataset(sample_id: str):
    """Detail d'un dataset d'exemple. 404 si le dossier livre est absent."""
    # Pas de traversee : seul un nom de dossier direct est accepte.
    if "/" in sample_id or "\\" in sample_id or sample_id.startswith("."):
        raise HTTPException(400, "Identifiant invalide")
    info = _describe(sample_id)
    if not info.exists:
        raise HTTPException(404, f"Dataset d'exemple '{sample_id}' absent de l'installation")
    return info
