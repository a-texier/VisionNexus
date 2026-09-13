"""
Script de test standalone pour SAM3.1.
Usage : python backend/tests/test_sam3.py
Depuis le dossier racine Annotation_App/

REMARQUES SUR SAM3 vs SAM2 :
===========================
SAM3 diffère de SAM2 dans son API :
  - SAM2 : mask_generator.generate(image_rgb) → liste de dicts
  - SAM3 : build_sam3_image_model() → model → Sam3Processor(model)
           processor.set_image(image) → state
           processor.set_text_prompt(state, prompt) → {masks, boxes, scores}

SAM3 supporte :
  - Text prompts (open-vocabulary) — spécificité principale vs SAM2
  - Visual prompts (points, boxes, masks) — comme SAM2
  - Tracking vidéo (via build_sam3_video_predictor)

Checkpoint requis : backend/checkpoints/sam3.1_hiera_large.pt
  Téléchargement : python backend/tests/download_sam3.py
  (nécessite un accès HuggingFace approuvé)
"""

import sys
import time
from pathlib import Path

import cv2
import numpy as np
import torch

# ---- Dispositif ----
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
print(f"[SAM3-Test] Dispositif : {DEVICE}")
if DEVICE == "cuda":
    print(f"[SAM3-Test] GPU : {torch.cuda.get_device_name(0)}")

# ---- Chemins ----
ROOT_DIR        = Path(__file__).parent.parent.parent
CHECKPOINT_DIR  = ROOT_DIR / "backend" / "checkpoints"
CHECKPOINT_PATH = CHECKPOINT_DIR / "sam3.1_hiera_large.pt"
SAM3_REPO       = ROOT_DIR / "backend" / "models" / "sam3"
TEST_DIR        = ROOT_DIR / "data_test" / "test dev" / "img"
OUT_DIR         = ROOT_DIR / "data_test" / "results_sam3"
OUT_DIR.mkdir(parents=True, exist_ok=True)

# Ajouter le repo SAM3 au path Python si nécessaire
if str(SAM3_REPO) not in sys.path:
    sys.path.insert(0, str(SAM3_REPO))


# ============================================================
# Prompts de test (adaptés aux images VisDrone/surveillance)
# ============================================================
TEXT_PROMPTS = [
    "person",
    "car",
    "vehicle",
    "bicycle",
    "pedestrian",
]


# ============================================================
# Chargement de SAM3
# ============================================================

def load_sam3_model():
    """
    Charge le modèle SAM3.1 image.
    Retourne (model, processor) ou (None, None) si le checkpoint est absent.
    """
    if not CHECKPOINT_PATH.exists():
        print(f"[ERREUR] Checkpoint absent : {CHECKPOINT_PATH}")
        print(f"         Lancez : python backend/tests/download_sam3.py")
        print(f"         (Necessite un acces HuggingFace approuve sur facebook/sam3)")
        return None, None

    print(f"[SAM3-Test] Chargement du modele depuis : {CHECKPOINT_PATH}")

    try:
        from sam3.model_builder import build_sam3_image_model
        from sam3.model.sam3_image_processor import Sam3Processor
    except ImportError as e:
        print(f"[ERREUR] SAM3 non installe : {e}")
        print(f"         Installez SAM3 : pip install -e backend/models/sam3")
        return None, None

    model = build_sam3_image_model(
        checkpoint=str(CHECKPOINT_PATH),
    )
    model = model.to(DEVICE)
    model.eval()

    processor = Sam3Processor(model)
    print(f"[SAM3-Test] Modele SAM3.1 charge sur {DEVICE.upper()}")
    return model, processor


# ============================================================
# Visualisation des résultats
# ============================================================

def draw_sam3_results(
    image_bgr: np.ndarray,
    masks: "torch.Tensor",
    boxes: "torch.Tensor",
    scores: "torch.Tensor",
    prompt: str,
) -> np.ndarray:
    """
    Dessine les masques et boxes SAM3 sur l'image.

    Args:
        image_bgr: Image source en BGR
        masks: Tensor [N, H, W] booléen
        boxes: Tensor [N, 4] (x1, y1, x2, y2) en pixels
        scores: Tensor [N] de scores de confiance
        prompt: Texte du prompt affiché en légende

    Returns:
        Image BGR annotée
    """
    result = image_bgr.copy()
    h, w = result.shape[:2]

    # Conversion en numpy si nécessaire
    if hasattr(masks, "cpu"):
        masks_np = masks.cpu().numpy()
    else:
        masks_np = np.array(masks)

    if hasattr(boxes, "cpu"):
        boxes_np = boxes.cpu().numpy()
    else:
        boxes_np = np.array(boxes)

    if hasattr(scores, "cpu"):
        scores_np = scores.cpu().numpy()
    else:
        scores_np = np.array(scores)

    if len(masks_np) == 0:
        # Aucune détection
        cv2.putText(result, f"SAM3 | '{prompt}' | 0 detection", (5, 20),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (80, 80, 255), 1)
        return result

    # Palette de couleurs
    rng = np.random.default_rng(seed=99)
    colors = rng.integers(80, 230, size=(len(masks_np), 3))

    # Overlay des masques semi-transparents
    overlay = result.copy()
    for i, mask in enumerate(masks_np):
        if mask.ndim == 2:
            bool_mask = mask.astype(bool)
        else:
            bool_mask = mask[0].astype(bool)
        color = colors[i % len(colors)].tolist()
        overlay[bool_mask] = color

    cv2.addWeighted(overlay, 0.4, result, 0.6, 0, result)

    # Bounding boxes + scores
    for i, box in enumerate(boxes_np):
        x1, y1, x2, y2 = int(box[0]), int(box[1]), int(box[2]), int(box[3])
        score = float(scores_np[i]) if i < len(scores_np) else 0.0
        cv2.rectangle(result, (x1, y1), (x2, y2), (80, 255, 120), 2)
        label = f"{score:.2f}"
        cv2.putText(result, label, (x1 + 2, y1 + 14),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.4, (255, 255, 255), 1, cv2.LINE_AA)

    # Légende
    legend = f"SAM3.1 | '{prompt}' | {len(masks_np)} det"
    cv2.rectangle(result, (0, 0), (len(legend) * 7 + 10, 22), (0, 0, 0), -1)
    cv2.putText(result, legend, (5, 15), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (180, 255, 180), 1)

    return result


# ============================================================
# Test sur les images
# ============================================================

def run_sam3_on_images(processor) -> None:
    """
    Lance SAM3.1 sur toutes les images du dossier de test.
    Pour chaque image et chaque prompt texte, génère une visualisation.
    """
    extensions = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
    image_paths = sorted([p for p in TEST_DIR.iterdir() if p.suffix.lower() in extensions])

    if not image_paths:
        print(f"[WARN] Aucune image trouvee dans : {TEST_DIR}")
        return

    print(f"\n[SAM3-Test] {len(image_paths)} images | {len(TEXT_PROMPTS)} prompts")
    print("-" * 60)

    total_time = 0.0
    total_det  = 0
    n_processed = 0

    # Import PIL pour SAM3 (utilise PIL en entrée, pas numpy)
    from PIL import Image as PILImage

    for idx, img_path in enumerate(image_paths, 1):
        print(f"\n[{idx}/{len(image_paths)}] {img_path.name}")

        img_bgr = cv2.imread(str(img_path))
        if img_bgr is None:
            print("  [WARN] Impossible de lire l'image, ignoree.")
            continue

        h, w = img_bgr.shape[:2]
        print(f"  Dimensions : {w} x {h} px")

        # Chargement PIL (format attendu par SAM3)
        pil_img = PILImage.open(str(img_path)).convert("RGB")

        # Initialisation de l'état SAM3 pour cette image
        t_img = time.perf_counter()
        with torch.inference_mode():
            inference_state = processor.set_image(pil_img)
        t_img_end = time.perf_counter()
        print(f"  Encodage image : {(t_img_end - t_img)*1000:.0f} ms")

        # Test de chaque prompt texte
        prompt_results = []
        for prompt in TEXT_PROMPTS:
            t0 = time.perf_counter()
            with torch.inference_mode():
                output = processor.set_text_prompt(state=inference_state, prompt=prompt)
            elapsed = time.perf_counter() - t0

            masks  = output.get("masks",  [])
            boxes  = output.get("boxes",  [])
            scores = output.get("scores", [])

            n_det = len(masks) if hasattr(masks, "__len__") else 0
            total_det  += n_det
            total_time += elapsed
            n_processed += 1

            print(f"  Prompt '{prompt}' : {n_det} detection(s) | {elapsed*1000:.0f} ms")

            prompt_results.append((prompt, masks, boxes, scores, n_det))

        # Sauvegarde du meilleur résultat (prompt avec le plus de détections)
        if prompt_results:
            best_prompt, best_masks, best_boxes, best_scores, _ = max(
                prompt_results, key=lambda x: x[4]
            )
            viz = draw_sam3_results(img_bgr, best_masks, best_boxes, best_scores, best_prompt)
            out_path = OUT_DIR / f"{img_path.stem}_sam3_result.jpg"
            cv2.imwrite(str(out_path), viz, [cv2.IMWRITE_JPEG_QUALITY, 90])
            print(f"  Sauvegarde (meilleur prompt='{best_prompt}') : {out_path.name}")

    # Résumé
    print("\n" + "=" * 60)
    print("[SAM3-Test] RESUME")
    print(f"  Images traitees     : {len(image_paths)}")
    print(f"  Total detections    : {total_det}")
    if n_processed > 0:
        print(f"  Detections/appel   : {total_det / n_processed:.1f}")
        print(f"  Temps moyen/appel  : {total_time / n_processed * 1000:.0f} ms")
    print(f"  Resultats dans      : {OUT_DIR}")
    print("=" * 60)


# ============================================================
# Comparaison SAM2 vs SAM3
# ============================================================

def print_comparison() -> None:
    """Affiche un tableau comparatif SAM2 vs SAM3."""
    print("\n" + "=" * 60)
    print("COMPARAISON SAM2 vs SAM3")
    print("=" * 60)
    rows = [
        ("Modele", "SAM2.1 hiera_small", "SAM3.1 hiera_large"),
        ("Parametres", "~46M", "~848M"),
        ("API inference", "AutomaticMaskGenerator", "Sam3Processor"),
        ("Prompt texte", "Non (via Grounding DINO)", "Oui (natif)"),
        ("Prompt visuel", "Points / boxes / masques", "Points / boxes / masques"),
        ("Tracking video", "SAM2VideoPredictor", "build_sam3_video_predictor"),
        ("Checkpoints", "fbaipublicfiles.com (public)", "HuggingFace (acces requis)"),
        ("Concepts uniques", "Limites aux classes COCO", "4M+ concepts open-vocab"),
    ]
    col_w = [28, 22, 22]
    header = rows[0]
    print(f"  {header[0]:<{col_w[0]}} {header[1]:<{col_w[1]}} {header[2]}")
    print("  " + "-" * (col_w[0] + col_w[1] + col_w[2] + 4))
    for row in rows[1:]:
        print(f"  {row[0]:<{col_w[0]}} {row[1]:<{col_w[1]}} {row[2]}")
    print("=" * 60)


if __name__ == "__main__":
    print("=" * 60)
    print("SAM3.1 Test Standalone")
    print("=" * 60)

    # Affichage de la comparaison (toujours disponible)
    print_comparison()

    # Chargement du modèle
    model, processor = load_sam3_model()
    if processor is None:
        print("\n[INFO] Test impossible sans checkpoint.")
        print("[INFO] Etapes pour obtenir le checkpoint SAM3 :")
        print("  1. Demander l'acces : https://huggingface.co/facebook/sam3")
        print("  2. Creer un token   : https://huggingface.co/settings/tokens")
        print("  3. Authentifier     : pip install huggingface_hub && hf auth login")
        print("  4. Telecharger      : python backend/tests/download_sam3.py")
        sys.exit(0)

    # Test sur les images
    run_sam3_on_images(processor)
