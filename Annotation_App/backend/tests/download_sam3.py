"""
Script de telechargement du checkpoint SAM3.1.
Usage : python backend/tests/download_sam3.py
Depuis le dossier racine Annotation_App/

PREREQUIS :
  1. Demander l'acces sur HuggingFace : https://huggingface.co/facebook/sam3.1
  2. Creer un token HF sur : https://huggingface.co/settings/tokens
  3. Authentifier : hf auth login  (ou definir HF_TOKEN=xxx dans l'env)
  4. pip install huggingface_hub

Fichiers telecharges dans backend/checkpoints/sam3.1/ :
  - sam3.1_multiplex.pt   (checkpoint principal, ~2.4 GB)
  - config.json
  - tokenizer.json
  - vocab.json + merges.txt + special_tokens_map.json
  - processor_config.json + tokenizer_config.json
"""

import os
import sys
from pathlib import Path

DEST_DIR = Path(__file__).parent.parent / "checkpoints" / "sam3.1"
DEST_DIR.mkdir(parents=True, exist_ok=True)

HF_REPO_ID = "facebook/sam3.1"

# Tous les fichiers du repo a telecharger pour fonctionner offline
SAM31_FILES = [
    "sam3.1_multiplex.pt",      # Checkpoint principal (~2.4 GB)
    "config.json",              # Configuration du modele
    "tokenizer.json",           # Tokenizer
    "vocab.json",               # Vocabulaire BPE
    "merges.txt",               # Merges BPE
    "special_tokens_map.json",  # Tokens speciaux
    "processor_config.json",    # Config processeur
    "tokenizer_config.json",    # Config tokenizer
]


def check_hf_auth() -> bool:
    """Verifie que l'authentification HuggingFace est disponible."""
    try:
        from huggingface_hub import HfApi
        api = HfApi()
        user = api.whoami()
        print(f"[SAM3-Download] Authentifie en tant que : {user['name']}")
        return True
    except ImportError:
        print("[ERREUR] huggingface_hub non installe.")
        print("         pip install huggingface_hub")
        return False
    except Exception as e:
        print(f"[ERREUR] Non authentifie sur HuggingFace : {e}")
        print()
        print("  Pour vous authentifier :")
        print("  1. Generez un token sur https://huggingface.co/settings/tokens")
        print("  2. Lancez : hf auth login")
        print("  OU definissez la variable d'environnement : HF_TOKEN=votre_token")
        print()
        print("  Acces requis sur : https://huggingface.co/facebook/sam3.1")
        return False


def download_sam31_files() -> bool:
    """Telecharge tous les fichiers SAM3.1 depuis HuggingFace."""
    if not check_hf_auth():
        return False

    from huggingface_hub import hf_hub_download

    print(f"\n[SAM3-Download] Destination : {DEST_DIR}")
    print(f"[SAM3-Download] Repo HF     : {HF_REPO_ID}")
    print()

    all_ok = True
    for filename in SAM31_FILES:
        dest_path = DEST_DIR / filename

        if dest_path.exists():
            size_mb = dest_path.stat().st_size / 1_048_576
            print(f"[OK] Deja present : {filename} ({size_mb:.1f} MB)")
            continue

        try:
            print(f"[...] Telechargement : {filename} ...")
            hf_hub_download(
                repo_id=HF_REPO_ID,
                filename=filename,
                local_dir=str(DEST_DIR),
            )
            size_mb = dest_path.stat().st_size / 1_048_576
            print(f"[OK] Telecharge     : {filename} ({size_mb:.1f} MB)")
        except Exception as e:
            print(f"[ERREUR] {filename} : {e}")
            all_ok = False

    return all_ok


def verify_installation() -> bool:
    """Verifie que tous les fichiers necessaires sont presents."""
    checkpoint = DEST_DIR / "sam3.1_multiplex.pt"
    if not checkpoint.exists():
        print(f"\n[ERREUR] Checkpoint manquant : {checkpoint}")
        return False

    size_mb = checkpoint.stat().st_size / 1_048_576
    if size_mb < 100:
        print(f"[ERREUR] Checkpoint trop petit ({size_mb:.1f} MB) — telechargement incomplet")
        return False

    print(f"\n[OK] SAM3.1 pret a utiliser :")
    print(f"     Checkpoint : {checkpoint} ({size_mb:.0f} MB)")
    print(f"     Dossier    : {DEST_DIR}")
    return True


if __name__ == "__main__":
    print("=" * 60)
    print("SAM3.1 Checkpoint Download")
    print("=" * 60)

    ok = download_sam31_files()
    if not ok:
        print("\n[ERREUR] Certains fichiers n'ont pas pu etre telecharges.")
        print("  Verifiez :")
        print("  1. Acces approuve sur https://huggingface.co/facebook/sam3.1")
        print("  2. Token HF valide (hf auth login)")
        sys.exit(1)

    if not verify_installation():
        sys.exit(1)

    print("\n[OK] Telechargement termine avec succes !")
    print(f"     Les fichiers sont dans : {DEST_DIR}")
