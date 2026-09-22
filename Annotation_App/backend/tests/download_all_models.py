"""
Script maitre de telechargement de tous les modeles IA.
Apres execution, l'application tourne entierement OFFLINE —
aucune requete reseau au demarrage ou a l'usage.

Usage : python backend/tests/download_all_models.py
Depuis le dossier racine Annotation_App/

Modeles telecharges :
  1. Grounding DINO tiny (public)
     -> backend/checkpoints/grounding_dino/   (~172 MB)

  2. SAM3.1 (acces gated : https://huggingface.co/facebook/sam3.1)
     -> backend/checkpoints/sam3.1/           (~2.4 GB)

  3. SAM2.1 small (si absent)
     -> backend/checkpoints/sam2.1_hiera_small.pt (~180 MB)

Modeles DEJA locaux (aucun telechargement requis) :
  - XFeat : backend/models/xfeat/weights/xfeat.pt  (deja present)
  - ByteTrack : algorithme pur, pas de poids
"""

import sys
from pathlib import Path

ROOT_DIR = Path(__file__).parent.parent.parent
CHECKPOINTS_DIR = ROOT_DIR / "backend" / "checkpoints"


# ============================================================
# 1. Grounding DINO
# ============================================================

def download_grounding_dino() -> bool:
    from pathlib import Path
    dest = CHECKPOINTS_DIR / "grounding_dino"
    dest.mkdir(parents=True, exist_ok=True)

    config = dest / "config.json"
    weights = list(dest.glob("*.safetensors")) + list(dest.glob("pytorch_model*.bin"))
    if config.exists() and weights:
        total_mb = sum(f.stat().st_size for f in weights) / 1_048_576
        print(f"  [OK] Grounding DINO deja present ({total_mb:.0f} MB)")
        return True

    print("  [...] Telechargement Grounding DINO tiny...")
    try:
        from huggingface_hub import snapshot_download
        snapshot_download(
            repo_id="IDEA-Research/grounding-dino-tiny",
            local_dir=str(dest),
            ignore_patterns=["*.msgpack", "flax_model.*", "tf_model.*", "rust_model.*"],
        )
        print(f"  [OK] Grounding DINO telecharge -> {dest}")
        return True
    except Exception as e:
        print(f"  [ERREUR] {e}")
        return False


# ============================================================
# 2. SAM3.1 (gated — authentification requise)
# ============================================================

def download_sam31(token: str = None) -> bool:
    dest = CHECKPOINTS_DIR / "sam3.1"
    dest.mkdir(parents=True, exist_ok=True)

    checkpoint = dest / "sam3.1_multiplex.pt"
    if checkpoint.exists():
        size_mb = checkpoint.stat().st_size / 1_048_576
        print(f"  [OK] SAM3.1 deja present ({size_mb:.0f} MB)")
        return True

    # Verification de l'authentification
    try:
        from huggingface_hub import HfApi, hf_hub_download
        api = HfApi()
        user = api.whoami()
        print(f"  [AUTH] Connecte en tant que : {user['name']}")
    except Exception as e:
        print(f"  [ERREUR] Non authentifie : {e}")
        print("           Lancez : hf auth login")
        print("           Ou definissez : HF_TOKEN=votre_token")
        return False

    SAM31_FILES = [
        "sam3.1_multiplex.pt",
        "config.json",
        "tokenizer.json",
        "vocab.json",
        "merges.txt",
        "special_tokens_map.json",
        "processor_config.json",
        "tokenizer_config.json",
    ]

    all_ok = True
    for filename in SAM31_FILES:
        fpath = dest / filename
        if fpath.exists():
            print(f"  [OK] {filename}")
            continue
        try:
            print(f"  [...] {filename} ...")
            hf_hub_download(
                repo_id="facebook/sam3.1",
                filename=filename,
                local_dir=str(dest),
                token=token,
            )
            size_mb = fpath.stat().st_size / 1_048_576
            print(f"  [OK] {filename} ({size_mb:.1f} MB)")
        except Exception as e:
            print(f"  [ERREUR] {filename} : {e}")
            all_ok = False

    return all_ok


# ============================================================
# 3. SAM2.1 small (si absent)
# ============================================================

def download_sam21() -> bool:
    dest = CHECKPOINTS_DIR / "sam2.1_hiera_small.pt"
    if dest.exists():
        size_mb = dest.stat().st_size / 1_048_576
        print(f"  [OK] SAM2.1 small deja present ({size_mb:.0f} MB)")
        return True

    print("  [...] Telechargement SAM2.1 small...")
    url = "https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_small.pt"
    try:
        import urllib.request
        CHECKPOINTS_DIR.mkdir(parents=True, exist_ok=True)

        def show_progress(block_num, block_size, total_size):
            downloaded = block_num * block_size
            if total_size > 0:
                pct = min(100, downloaded * 100 // total_size)
                mb = downloaded / 1_048_576
                print(f"\r  [...] {mb:.0f} MB / {total_size/1_048_576:.0f} MB ({pct}%)", end="", flush=True)

        urllib.request.urlretrieve(url, str(dest), show_progress)
        print()
        size_mb = dest.stat().st_size / 1_048_576
        print(f"  [OK] SAM2.1 small telecharge ({size_mb:.0f} MB)")
        return True
    except Exception as e:
        print(f"\n  [ERREUR] {e}")
        return False


# ============================================================
# 4. Verification XFeat (deja local)
# ============================================================

def check_xfeat() -> bool:
    xfeat_pt = ROOT_DIR / "backend" / "models" / "xfeat" / "weights" / "xfeat.pt"
    if xfeat_pt.exists():
        size_mb = xfeat_pt.stat().st_size / 1_048_576
        print(f"  [OK] XFeat deja present ({size_mb:.1f} MB)")
        return True
    else:
        print(f"  [WARN] XFeat non trouve : {xfeat_pt}")
        print("         Clonez le repo : git clone https://github.com/verlab/accelerated_features backend/models/xfeat")
        return False


# ============================================================
# Point d'entree principal
# ============================================================

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Telechargement de tous les modeles IA")
    parser.add_argument("--skip-sam3", action="store_true", help="Ne pas telecharger SAM3.1 (gated)")
    parser.add_argument("--skip-sam2", action="store_true", help="Ne pas telecharger SAM2.1")
    parser.add_argument("--hf-token", type=str, default=None, help="Token HuggingFace (pour SAM3.1)")
    args = parser.parse_args()

    print("=" * 60)
    print("Telechargement de tous les modeles IA")
    print("=" * 60)

    results = {}

    print("\n[1/4] Grounding DINO tiny (public)")
    results["grounding_dino"] = download_grounding_dino()

    if not args.skip_sam3:
        print("\n[2/4] SAM3.1 multiplex (gated — authentification requise)")
        results["sam3.1"] = download_sam31(token=args.hf_token)
    else:
        print("\n[2/4] SAM3.1 — IGNORE (--skip-sam3)")
        results["sam3.1"] = None

    if not args.skip_sam2:
        print("\n[3/4] SAM2.1 small")
        results["sam2.1"] = download_sam21()
    else:
        print("\n[3/4] SAM2.1 — IGNORE (--skip-sam2)")
        results["sam2.1"] = None

    print("\n[4/4] XFeat (verification)")
    results["xfeat"] = check_xfeat()

    # Resume final
    print("\n" + "=" * 60)
    print("Resume")
    print("=" * 60)
    for name, ok in results.items():
        if ok is None:
            status = "IGNORE"
        elif ok:
            status = "OK"
        else:
            status = "ECHEC"
        print(f"  {name:<20} : {status}")

    failed = [k for k, v in results.items() if v is False]
    if failed:
        print(f"\n[ATTENTION] Modeles non telecharges : {', '.join(failed)}")
        print("  L'application demarrera mais ces fonctionnalites seront indisponibles.")
    else:
        print("\n[OK] Tous les modeles sont disponibles localement.")
        print("     L'application peut fonctionner entierement OFFLINE.")
