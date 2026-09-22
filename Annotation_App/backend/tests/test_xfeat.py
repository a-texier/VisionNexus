"""
Script de test standalone pour XFeat (matching de keypoints accéléré).
Usage : python backend/tests/test_xfeat.py
Depuis le dossier racine Annotation_App/

Ce script :
1. Prend les deux premières images du dossier data_test/test dev/img/ (ordre alphabétique)
2. Extrait les keypoints + descripteurs XFeat sur chaque image
3. Effectue le matching + RANSAC pour estimer l'homographie H
4. Compare avec SIFT classique sur les mêmes images
5. Sauvegarde xfeat_matches.jpg et xfeat_warped.jpg dans data_test/results_xfeat/

XFeat est importé depuis le repo cloné dans backend/models/xfeat/
(from modules.xfeat import XFeat — pas un package PyPI)
"""

import sys
import time
from pathlib import Path

import cv2
import numpy as np
import torch

# ---- Chemins (défini avant les imports XFeat) ----
ROOT_DIR  = Path(__file__).resolve().parent.parent.parent
XFEAT_DIR = ROOT_DIR / "backend" / "models" / "xfeat"

# Ajout du dossier XFeat au sys.path pour `from modules.xfeat import XFeat`
if str(XFEAT_DIR) not in sys.path:
    sys.path.insert(0, str(XFEAT_DIR))

# ---- Dispositif ----
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
print(f"[XFeat-Test] Dispositif : {DEVICE}")

TEST_DIR  = ROOT_DIR / "data_test" / "test dev" / "img"
OUT_DIR   = ROOT_DIR / "data_test" / "results_xfeat"
OUT_DIR.mkdir(parents=True, exist_ok=True)


# ============================================================
# Chargement de XFeat
# ============================================================

def load_xfeat():
    """
    Charge le modèle XFeat depuis le repo cloné (backend/models/xfeat/).
    Utilise torch.hub si le repo est disponible.
    Retourne l'objet XFeat ou None si non disponible.
    """
    if not XFEAT_DIR.exists():
        print(f"[ERREUR] Repo XFeat absent : {XFEAT_DIR}")
        print("         git clone https://github.com/verlab/accelerated_features.git backend/models/xfeat")
        return None

    try:
        # Import direct depuis le repo cloné (pas un package PyPI)
        from modules.xfeat import XFeat
        xfeat = XFeat()
        print(f"[XFeat-Test] Modele XFeat charge (repo local : {XFEAT_DIR.name})")
        return xfeat
    except ImportError as e:
        print(f"[ERREUR] Import XFeat echoue : {e}")
        print("         Verifiez que backend/models/xfeat/modules/xfeat.py existe.")
        return None


# ============================================================
# XFeat matching
# ============================================================

def xfeat_match(xfeat, img1_bgr: np.ndarray, img2_bgr: np.ndarray):
    """
    Extrait les keypoints et descripteurs XFeat puis effectue le matching.

    Returns:
        kps1, kps2, matches_xfeat (matched keypoints), time_s
    """
    # Conversion BGR → RGB (attendu par XFeat)
    img1_rgb = cv2.cvtColor(img1_bgr, cv2.COLOR_BGR2RGB)
    img2_rgb = cv2.cvtColor(img2_bgr, cv2.COLOR_BGR2RGB)

    t0 = time.perf_counter()

    # match_xfeat retourne (kps1, kps2) — pas de scores séparés
    kps1, kps2 = xfeat.match_xfeat(img1_rgb, img2_rgb, top_k=4096)

    elapsed = time.perf_counter() - t0

    # Les tableaux sont déjà en numpy (CPU) d'après l'implémentation XFeat
    kps1_np = np.array(kps1)
    kps2_np = np.array(kps2)

    return kps1_np, kps2_np, elapsed


# ============================================================
# SIFT matching (référence)
# ============================================================

def sift_match(img1_bgr: np.ndarray, img2_bgr: np.ndarray):
    """
    Matching SIFT classique avec ratio test de Lowe.

    Returns:
        kps1_matched, kps2_matched, temps_inference
    """
    # Conversion en niveaux de gris
    gray1 = cv2.cvtColor(img1_bgr, cv2.COLOR_BGR2GRAY)
    gray2 = cv2.cvtColor(img2_bgr, cv2.COLOR_BGR2GRAY)

    sift = cv2.SIFT_create(nfeatures=4096)

    t0 = time.perf_counter()
    kps1_all, desc1 = sift.detectAndCompute(gray1, None)
    kps2_all, desc2 = sift.detectAndCompute(gray2, None)

    # Matching BF avec ratio test de Lowe (k=2 voisins)
    bf = cv2.BFMatcher(cv2.NORM_L2, crossCheck=False)
    raw_matches = bf.knnMatch(desc1, desc2, k=2)
    elapsed = time.perf_counter() - t0

    # Filtre ratio test Lowe (0.75)
    good_matches = [m for m, n in raw_matches if m.distance < 0.75 * n.distance]

    # Extraction des coordonnées des points matchés
    kps1_m = np.array([kps1_all[m.queryIdx].pt for m in good_matches])
    kps2_m = np.array([kps2_all[m.trainIdx].pt for m in good_matches])

    n_kps1 = len(kps1_all)
    n_kps2 = len(kps2_all)

    return kps1_m, kps2_m, elapsed, n_kps1, n_kps2


# ============================================================
# Estimation homographie + RANSAC
# ============================================================

def estimate_homography(kps1: np.ndarray, kps2: np.ndarray, method_name: str):
    """
    Estime la matrice d'homographie H par RANSAC.

    Returns:
        H (3x3), mask (inliers bool), inlier_ratio
    """
    if len(kps1) < 4:
        print(f"  [{method_name}] Pas assez de matches pour RANSAC ({len(kps1)} < 4)")
        return None, None, 0.0

    H, mask = cv2.findHomography(
        kps1.reshape(-1, 1, 2).astype(np.float32),
        kps2.reshape(-1, 1, 2).astype(np.float32),
        cv2.RANSAC,
        ransacReprojThreshold=4.0,
    )

    if mask is None:
        return H, None, 0.0

    n_inliers = int(mask.sum())
    inlier_ratio = n_inliers / len(kps1) if len(kps1) > 0 else 0.0
    return H, mask.ravel().astype(bool), inlier_ratio


# ============================================================
# Visualisation matches
# ============================================================

def draw_matches_custom(
    img1: np.ndarray,
    img2: np.ndarray,
    kps1: np.ndarray,
    kps2: np.ndarray,
    mask: np.ndarray | None,
    title: str,
) -> np.ndarray:
    """
    Dessine les correspondances entre les deux images.
    Inliers en vert, outliers en rouge.
    """
    h1, w1 = img1.shape[:2]
    h2, w2 = img2.shape[:2]
    canvas_h = max(h1, h2)
    canvas_w = w1 + w2 + 20  # 20px de séparateur

    canvas = np.zeros((canvas_h, canvas_w, 3), dtype=np.uint8)
    canvas[:h1, :w1] = img1
    canvas[:h2, w1 + 20:w1 + 20 + w2] = img2

    # Dessin des correspondances
    n_show = min(300, len(kps1))  # Limite pour lisibilité
    step = max(1, len(kps1) // n_show)

    for i in range(0, len(kps1), step):
        pt1 = (int(kps1[i][0]), int(kps1[i][1]))
        pt2 = (int(kps2[i][0]) + w1 + 20, int(kps2[i][1]))

        if mask is not None:
            color = (0, 220, 80) if mask[i] else (0, 60, 200)
            thickness = 1 if mask[i] else 1
        else:
            color = (100, 180, 255)
            thickness = 1

        cv2.line(canvas, pt1, pt2, color, thickness, cv2.LINE_AA)
        cv2.circle(canvas, pt1, 2, color, -1, cv2.LINE_AA)
        cv2.circle(canvas, pt2, 2, color, -1, cv2.LINE_AA)

    # Légende
    legend = f"{title} | {len(kps1)} matches"
    if mask is not None:
        n_in = int(mask.sum())
        ratio = n_in / len(kps1) if len(kps1) > 0 else 0
        legend += f" | {n_in} inliers ({ratio:.1%}) | vert=inlier rouge=outlier"

    cv2.rectangle(canvas, (0, 0), (len(legend) * 7 + 10, 22), (0, 0, 0), -1)
    cv2.putText(canvas, legend, (5, 15), cv2.FONT_HERSHEY_SIMPLEX, 0.42, (255, 255, 255), 1)

    return canvas


# ============================================================
# Test principal
# ============================================================

def run_tests() -> None:
    """Lance les tests XFeat et SIFT sur les deux premières images."""

    # Récupération des deux premières images
    extensions = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
    image_paths = sorted([p for p in TEST_DIR.iterdir() if p.suffix.lower() in extensions])

    if len(image_paths) < 2:
        print(f"[ERREUR] Moins de 2 images dans : {TEST_DIR}")
        print("         Ajoutez au moins 2 images pour le test.")
        return

    path1, path2 = image_paths[0], image_paths[1]
    print(f"\n[XFeat-Test] Image 1 : {path1.name}")
    print(f"[XFeat-Test] Image 2 : {path2.name}")

    img1 = cv2.imread(str(path1))
    img2 = cv2.imread(str(path2))

    if img1 is None or img2 is None:
        print("[ERREUR] Impossible de lire les images.")
        return

    print(f"  Taille image 1 : {img1.shape[1]}x{img1.shape[0]}")
    print(f"  Taille image 2 : {img2.shape[1]}x{img2.shape[0]}")

    # Chargement XFeat
    xfeat = load_xfeat()

    print("\n" + "=" * 60)

    # ---- XFeat ----
    if xfeat is not None:
        print("\n[XFeat] Extraction des keypoints et matching...")
        try:
            kps1_x, kps2_x, t_xfeat = xfeat_match(xfeat, img1, img2)
            n_kps_xfeat = len(kps1_x)

            print(f"  Keypoints matches      : {n_kps_xfeat}")
            print(f"  Temps d'inference      : {t_xfeat*1000:.1f} ms")

            # RANSAC
            H_x, mask_x, ratio_x = estimate_homography(kps1_x, kps2_x, "XFeat")
            if mask_x is not None:
                n_in_x = int(mask_x.sum())
                print(f"  Inliers RANSAC         : {n_in_x} / {n_kps_xfeat} ({ratio_x:.1%})")
                print(f"  Homographie estimee    : {'OK' if H_x is not None else 'ECHEC'}")
                if ratio_x < 0.3:
                    print(f"  [WARN] Ratio inliers faible ({ratio_x:.1%} < 30%) — homographie peu fiable")

            # Visualisation des matches XFeat
            viz_matches = draw_matches_custom(img1, img2, kps1_x, kps2_x, mask_x, "XFeat")
            out_matches = OUT_DIR / "xfeat_matches.jpg"
            cv2.imwrite(str(out_matches), viz_matches, [cv2.IMWRITE_JPEG_QUALITY, 92])
            print(f"  Sauvegarde : {out_matches.name}")

            # Warp image 1 → image 2 via H
            if H_x is not None:
                h2, w2 = img2.shape[:2]
                warped = cv2.warpPerspective(img1, H_x, (w2, h2))
                out_warped = OUT_DIR / "xfeat_warped.jpg"
                cv2.imwrite(str(out_warped), warped, [cv2.IMWRITE_JPEG_QUALITY, 92])
                print(f"  Sauvegarde : {out_warped.name}")

        except Exception as e:
            print(f"  [ERREUR] XFeat matching : {e}")
            kps1_x, kps2_x, mask_x, t_xfeat = np.array([]), np.array([]), None, 0.0
            n_kps_xfeat = 0
            ratio_x = 0.0
    else:
        n_kps_xfeat, t_xfeat, ratio_x = 0, 0.0, 0.0

    print("\n" + "=" * 60)

    # ---- SIFT (référence) ----
    print("\n[SIFT] Extraction des keypoints et matching (reference)...")
    try:
        kps1_s, kps2_s, t_sift, n_kps1_s, n_kps2_s = sift_match(img1, img2)

        print(f"  Keypoints detectes     : {n_kps1_s} (img1), {n_kps2_s} (img2)")
        print(f"  Matches apres ratio    : {len(kps1_s)}")
        print(f"  Temps d'inference      : {t_sift*1000:.1f} ms")

        # RANSAC
        H_s, mask_s, ratio_s = estimate_homography(kps1_s, kps2_s, "SIFT")
        if mask_s is not None:
            n_in_s = int(mask_s.sum())
            print(f"  Inliers RANSAC         : {n_in_s} / {len(kps1_s)} ({ratio_s:.1%})")
            print(f"  Homographie estimee    : {'OK' if H_s is not None else 'ECHEC'}")

        # Visualisation SIFT
        viz_sift = draw_matches_custom(img1, img2, kps1_s, kps2_s, mask_s, "SIFT")
        out_sift = OUT_DIR / "sift_matches.jpg"
        cv2.imwrite(str(out_sift), viz_sift, [cv2.IMWRITE_JPEG_QUALITY, 92])
        print(f"  Sauvegarde : {out_sift.name}")

    except Exception as e:
        print(f"  [ERREUR] SIFT : {e}")
        t_sift, ratio_s = 0.0, 0.0
        len_s = 0
    else:
        len_s = len(kps1_s)

    # ---- Comparaison finale ----
    print("\n" + "=" * 60)
    print("[XFeat-Test] COMPARAISON XFeat vs SIFT")
    print(f"{'Metrique':<30} {'XFeat':>12} {'SIFT':>12}")
    print("-" * 54)
    print(f"{'Matches totaux':<30} {n_kps_xfeat:>12} {len_s:>12}")
    print(f"{'Ratio inliers RANSAC':<30} {ratio_x:>11.1%} {ratio_s:>11.1%}")
    print(f"{'Temps inference (ms)':<30} {t_xfeat*1000:>11.1f} {t_sift*1000:>11.1f}")
    print("=" * 60)
    print(f"[XFeat-Test] Resultats sauvegardes dans : {OUT_DIR}")


if __name__ == "__main__":
    print("=" * 60)
    print("XFeat Test Standalone")
    print("=" * 60)
    run_tests()
