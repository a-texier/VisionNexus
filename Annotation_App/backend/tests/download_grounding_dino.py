"""
Script de telechargement de Grounding DINO (IDEA-Research/grounding-dino-tiny).
Sauvegarde le modele dans backend/checkpoints/grounding_dino/ pour
fonctionner entierement offline (pas de cache HuggingFace).

Usage : python backend/tests/download_grounding_dino.py
Depuis le dossier racine Annotation_App/

Pas d'authentification requise (modele public).
"""

import sys
from pathlib import Path

DEST_DIR = Path(__file__).parent.parent / "checkpoints" / "grounding_dino"
DEST_DIR.mkdir(parents=True, exist_ok=True)

HF_REPO_ID = "IDEA-Research/grounding-dino-tiny"


def download_grounding_dino() -> bool:
    """Telecharge Grounding DINO tiny depuis HuggingFace dans le projet."""
    try:
        from huggingface_hub import snapshot_download
    except ImportError:
        print("[ERREUR] huggingface_hub non installe.")
        print("         pip install huggingface_hub")
        return False

    # Verification si deja present
    config_path = DEST_DIR / "config.json"
    model_path = DEST_DIR / "pytorch_model.bin"
    safe_path = DEST_DIR / "model.safetensors"

    if config_path.exists() and (model_path.exists() or safe_path.exists()):
        print(f"[OK] Grounding DINO deja present dans : {DEST_DIR}")
        return True

    print(f"[...] Telechargement de {HF_REPO_ID}...")
    print(f"      Destination : {DEST_DIR}")
    print("      (modele public, pas d'authentification requise)")
    print()

    try:
        snapshot_download(
            repo_id=HF_REPO_ID,
            local_dir=str(DEST_DIR),
            local_dir_use_symlinks=False,
            ignore_patterns=["*.msgpack", "flax_model.*", "tf_model.*", "rust_model.*"],
        )
        print(f"\n[OK] Grounding DINO telecharge dans : {DEST_DIR}")
        return True
    except Exception as e:
        print(f"[ERREUR] Telechargement echoue : {e}")
        return False


def verify_installation() -> bool:
    """Verifie que le modele est complet."""
    config = DEST_DIR / "config.json"
    if not config.exists():
        print(f"[ERREUR] config.json manquant dans {DEST_DIR}")
        return False

    # Chercher les poids (safetensors prefere, sinon pytorch_model.bin)
    weights = list(DEST_DIR.glob("*.safetensors")) + list(DEST_DIR.glob("pytorch_model*.bin"))
    if not weights:
        print(f"[ERREUR] Aucun fichier de poids trouve dans {DEST_DIR}")
        return False

    total_mb = sum(f.stat().st_size for f in weights) / 1_048_576
    print(f"\n[OK] Grounding DINO pret :")
    print(f"     Dossier : {DEST_DIR}")
    print(f"     Poids   : {', '.join(f.name for f in weights)} ({total_mb:.0f} MB total)")
    return True


if __name__ == "__main__":
    print("=" * 60)
    print("Grounding DINO Download (grounding-dino-tiny)")
    print("=" * 60)

    if not download_grounding_dino():
        sys.exit(1)

    if not verify_installation():
        sys.exit(1)

    print("\n[OK] Telechargement termine avec succes !")
    print(f"     Les fichiers sont dans : {DEST_DIR}")
