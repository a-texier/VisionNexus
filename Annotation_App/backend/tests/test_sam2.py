"""
Script de test standalone pour SAM2 (Segment Anything Model 2.1).
Usage : python backend/tests/test_sam2.py
Depuis le dossier racine Annotation_App/

Ce script :
1. Charge SAM2 en mode automatic mask generation
2. Tourne sur toutes les images dans data_test/test dev/img/
3. Pour chaque image : affiche les stats et sauvegarde *_sam2_result.jpg
4. Affiche le temps d'inférence et le nombre de masques détectés
"""

import sys
import time
from pathlib import Path

import cv2
import numpy as np
import torch

# ---- Vérification de la disponibilité CUDA ----
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
print(f"[SAM2-Test] Dispositif : {DEVICE}")
if DEVICE == "cuda":
    print(f"[SAM2-Test] GPU : {torch.cuda.get_device_name(0)}")
    print(f"[SAM2-Test] VRAM disponible : {torch.cuda.get_device_properties(0).total_memory / 1e9:.1f} GB")

# ---- Configuration des chemins ----
ROOT_DIR        = Path(__file__).parent.parent.parent
CHECKPOINT_DIR  = ROOT_DIR / "backend" / "checkpoints"
CHECKPOINT_PATH = CHECKPOINT_DIR / "sam2.1_hiera_small.pt"
# Dossier contenant les images de test
TEST_DIR = ROOT_DIR / "data_test" / "test dev" / "img"

# Dossier de sortie des visualisations
OUT_DIR = ROOT_DIR / "data_test" / "results_sam2"
OUT_DIR.mkdir(parents=True, exist_ok=True)


def load_sam2_model():
    """
    Charge SAM2 en mode automatic mask generation.
    Retourne le predictor ou None si le checkpoint est absent.
    """
    if not CHECKPOINT_PATH.exists():
        print(f"[ERREUR] Checkpoint absent : {CHECKPOINT_PATH}")
        print(f"         Lancez d'abord : python backend/tests/download_sam2.py")
        return None

    print(f"[SAM2-Test] Chargement du modele depuis : {CHECKPOINT_PATH}")

    try:
        # Import conditionnel : SAM2 doit etre installe dans IA_env
        from sam2.automatic_mask_generator import SAM2AutomaticMaskGenerator
        from sam2.build_sam import build_sam2
    except ImportError:
        print("[ERREUR] SAM2 non installe. Installez avec :")
        print("         pip install git+https://github.com/facebookresearch/segment-anything-2.git")
        sys.exit(1)

    # Configuration du modele selon le dispositif
    if DEVICE == "cuda":
        # GPU : parametres standards
        config_file = "configs/sam2.1/sam2.1_hiera_s.yaml"
        model = build_sam2(config_file, str(CHECKPOINT_PATH), device=DEVICE, apply_postprocessing=False)
        mask_generator = SAM2AutomaticMaskGenerator(
            model=model,
            points_per_side=32,
            pred_iou_thresh=0.88,
            stability_score_thresh=0.92,
            box_nms_thresh=0.7,
        )
    else:
        # CPU : batch_size=1 pour eviter les erreurs memoire
        config_file = "configs/sam2.1/sam2.1_hiera_s.yaml"
        model = build_sam2(config_file, str(CHECKPOINT_PATH), device=DEVICE, apply_postprocessing=False)
        mask_generator = SAM2AutomaticMaskGenerator(
            model=model,
            points_per_side=16,        # Reduit pour CPU
            pred_iou_thresh=0.88,
            stability_score_thresh=0.92,
            box_nms_thresh=0.7,
        )

    print(f"[SAM2-Test] Modele charge avec succes sur {DEVICE.upper()}")
    return mask_generator


def colorize_masks(image_bgr: np.ndarray, masks: list) -> np.ndarray:
    """
    Dessine les masques SAM2 colorés sur l'image.

    Args:
        image_bgr: Image source en BGR (numpy array)
        masks: Liste de dicts retournés par SAM2AutomaticMaskGenerator

    Returns:
        Image BGR avec masques colorés et boxes englobantes
    """
    result = image_bgr.copy()
    h, w = result.shape[:2]

    # Génération d'une palette de couleurs stables
    rng = np.random.default_rng(seed=42)
    colors = rng.integers(80, 230, size=(len(masks), 3))

    # Trier les masques par aire décroissante (les grands en dessous)
    sorted_masks = sorted(masks, key=lambda m: m["area"], reverse=True)

    # Superposition des masques semi-transparents
    overlay = result.copy()
    for i, mask_data in enumerate(sorted_masks):
        mask = mask_data["segmentation"]  # Tableau booléen H×W
        color = colors[i % len(colors)].tolist()
        overlay[mask] = color

    # Fusion overlay avec image originale (alpha blending)
    alpha = 0.45
    cv2.addWeighted(overlay, alpha, result, 1 - alpha, 0, result)

    # Dessin des bounding boxes englobantes
    for mask_data in sorted_masks:
        # bbox format SAM2 : [x, y, w, h] en pixels
        x, y, bw, bh = [int(v) for v in mask_data["bbox"]]
        score = mask_data.get("predicted_iou", 0.0)
        cv2.rectangle(result, (x, y), (x + bw, y + bh), (0, 255, 100), 1)
        label = f"{score:.2f}"
        cv2.putText(
            result, label,
            (x + 2, y + 12),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.35, (255, 255, 255), 1, cv2.LINE_AA,
        )

    # Légende en haut à gauche
    legend = f"SAM2 | {len(masks)} masques | {DEVICE.upper()}"
    cv2.rectangle(result, (0, 0), (len(legend) * 7 + 10, 22), (0, 0, 0), -1)
    cv2.putText(result, legend, (5, 15), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 1)

    return result


def run_sam2_on_images(mask_generator) -> None:
    """
    Lance SAM2 sur toutes les images du dossier de test.
    Sauvegarde les visualisations dans OUT_DIR.
    """
    # Récupération des images
    extensions = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
    image_paths = sorted([p for p in TEST_DIR.iterdir() if p.suffix.lower() in extensions])

    if not image_paths:
        print(f"[WARN] Aucune image trouvee dans : {TEST_DIR}")
        return

    print(f"\n[SAM2-Test] {len(image_paths)} images trouvees dans {TEST_DIR}")
    print("-" * 60)

    total_time = 0.0
    total_masks = 0

    for idx, img_path in enumerate(image_paths, 1):
        print(f"\n[{idx}/{len(image_paths)}] {img_path.name}")

        # Chargement de l'image
        img_bgr = cv2.imread(str(img_path))
        if img_bgr is None:
            print(f"  [WARN] Impossible de lire l'image, ignoree.")
            continue

        h, w = img_bgr.shape[:2]
        print(f"  Dimensions : {w} x {h} px")

        # Conversion BGR → RGB pour SAM2
        img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)

        # Inférence SAM2
        t0 = time.perf_counter()
        with torch.inference_mode():
            if DEVICE == "cuda":
                with torch.autocast(device_type="cuda", dtype=torch.bfloat16):
                    masks = mask_generator.generate(img_rgb)
            else:
                masks = mask_generator.generate(img_rgb)
        elapsed = time.perf_counter() - t0

        n_masks = len(masks)
        total_time += elapsed
        total_masks += n_masks

        # Statistiques
        areas = [m["area"] for m in masks]
        scores = [m.get("predicted_iou", 0) for m in masks]
        print(f"  Masques detectes : {n_masks}")
        print(f"  Temps d'inference : {elapsed:.2f}s")
        if areas:
            print(f"  Aire moyenne : {np.mean(areas):.0f} px² | max : {max(areas):.0f} px²")
        if scores:
            print(f"  Score IoU moyen : {np.mean(scores):.3f} | min : {min(scores):.3f}")

        # Génération de la visualisation
        viz = colorize_masks(img_bgr, masks)

        # Sauvegarde
        out_path = OUT_DIR / f"{img_path.stem}_sam2_result.jpg"
        cv2.imwrite(str(out_path), viz, [cv2.IMWRITE_JPEG_QUALITY, 90])
        print(f"  Visualisation sauvegardee : {out_path.name}")

    # Résumé global
    print("\n" + "=" * 60)
    print("[SAM2-Test] RESUME")
    print(f"  Images traitees    : {len(image_paths)}")
    print(f"  Total masques      : {total_masks}")
    if len(image_paths) > 0:
        print(f"  Masques/image (moy): {total_masks / len(image_paths):.1f}")
        print(f"  Temps moyen/image  : {total_time / len(image_paths):.2f}s")
    print(f"  Resultats sauvegardes dans : {OUT_DIR}")
    print("=" * 60)


if __name__ == "__main__":
    print("=" * 60)
    print("SAM2 Test Standalone")
    print("=" * 60)

    # Chargement du modèle
    generator = load_sam2_model()
    if generator is None:
        sys.exit(1)

    # Test sur les images
    run_sam2_on_images(generator)
