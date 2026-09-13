"""
Script de téléchargement du checkpoint SAM2.1 hiera_small.
Usage : python backend/tests/download_sam2.py
Depuis le dossier racine Annotation_App/
"""

import hashlib
import sys
import urllib.request
from pathlib import Path


# ---- Checkpoint cible ----
MODEL_URL = "https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_small.pt"
DEST_DIR  = Path(__file__).parent.parent / "checkpoints"
DEST_FILE = DEST_DIR / "sam2.1_hiera_small.pt"

# Taille approximative attendue : ~185 MB
EXPECTED_SIZE_MB = 185


def _progress_bar(count: int, block_size: int, total: int) -> None:
    """Affiche une barre de progression dans le terminal."""
    downloaded = count * block_size
    if total > 0:
        pct = min(100, downloaded * 100 // total)
        done = pct // 2
        bar = "#" * done + "-" * (50 - done)
        mb_dl = downloaded / 1_048_576
        mb_tot = total / 1_048_576
        print(f"\r  [{bar}] {pct:3d}%  {mb_dl:.1f}/{mb_tot:.1f} MB", end="", flush=True)
    else:
        mb = downloaded / 1_048_576
        print(f"\r  Telechargement... {mb:.1f} MB", end="", flush=True)


def download_sam2_small() -> None:
    """Télécharge le checkpoint SAM2.1 hiera_small si absent."""
    DEST_DIR.mkdir(parents=True, exist_ok=True)

    if DEST_FILE.exists():
        size_mb = DEST_FILE.stat().st_size / 1_048_576
        print(f"[OK] Checkpoint deja present : {DEST_FILE} ({size_mb:.1f} MB)")
        if size_mb < EXPECTED_SIZE_MB * 0.9:
            print(f"[WARN] Fichier trop petit ({size_mb:.1f} MB < {EXPECTED_SIZE_MB*0.9:.0f} MB) — retelecharge")
        else:
            return

    print(f"[INFO] Telechargement de : {MODEL_URL}")
    print(f"[INFO] Destination       : {DEST_FILE}")
    print(f"[INFO] Taille attendue   : ~{EXPECTED_SIZE_MB} MB")
    print()

    try:
        urllib.request.urlretrieve(MODEL_URL, DEST_FILE, reporthook=_progress_bar)
    except KeyboardInterrupt:
        print("\n[ANNULE] Telechargement interrompu.")
        if DEST_FILE.exists():
            DEST_FILE.unlink()
        sys.exit(1)
    except Exception as e:
        print(f"\n[ERREUR] Telechargement echoue : {e}")
        if DEST_FILE.exists():
            DEST_FILE.unlink()
        sys.exit(1)

    print()  # Nouvelle ligne après la barre de progression

    # Vérification de l'intégrité (taille)
    size_mb = DEST_FILE.stat().st_size / 1_048_576
    print(f"[OK] Fichier telecharge : {size_mb:.1f} MB")

    if size_mb < EXPECTED_SIZE_MB * 0.9:
        print(f"[WARN] Fichier suspects : {size_mb:.1f} MB < {EXPECTED_SIZE_MB * 0.9:.0f} MB attendus")
        print("       Verifiez votre connexion et relancez.")
    else:
        print(f"[OK] Integrite verifiee (taille dans la plage attendue)")
        print(f"[OK] Pret pour l'utilisation dans SAM2")


if __name__ == "__main__":
    download_sam2_small()
