# ============================================================
# core/image_io.py
# Chargement robuste d'images pour Dataset Explorer (embeddings CLIP + thumbnails).
# Gère nativement le 16 bits (PNG / TIFF RGB ou IR) et le float via un
# étirement 3-sigma → 8 bits (même logique que l'Annotation App). Sans ça,
# PIL `Image.open(p).convert("RGB")` sur du 16 bits produit du bruit/noir →
# embeddings CLIP inutiles et miniatures noires.
# ============================================================

import logging
from typing import Optional

import numpy as np
from PIL import Image

logger = logging.getLogger(__name__)

try:
    import cv2  # OpenCV lit le 16 bits / IR via IMREAD_UNCHANGED
    _HAS_CV2 = True
except Exception:  # pragma: no cover
    _HAS_CV2 = False


def to_8bit_3sigma(a: np.ndarray, sigma: float = 3.0) -> np.ndarray:
    """Étire un tableau (8/16 bits ou float) vers uint8 par fenêtre 3-sigma.
    Fenêtre = [mean - kσ, mean + kσ] calculée sur toute l'image (mêmes bornes
    pour tous les canaux → couleurs préservées)."""
    a = a.astype(np.float32)
    m, s = float(a.mean()), float(a.std())
    lo, hi = m - sigma * s, m + sigma * s
    if hi <= lo:
        hi = lo + 1.0
    out = (a - lo) / (hi - lo) * 255.0
    return np.clip(out, 0, 255).astype(np.uint8)


def load_pil_rgb(path: str) -> Image.Image:
    """Charge une image en PIL RGB 8 bits, quel que soit le format source
    (8 bits classique, 16 bits PNG/TIFF, IR mono, float). Applique un
    remap 3-sigma si la source n'est pas déjà 8 bits."""
    # Voie rapide : OpenCV lit tout (y compris 16 bits) ; sinon repli PIL.
    if _HAS_CV2:
        arr = cv2.imread(path, cv2.IMREAD_UNCHANGED)
        if arr is not None:
            if arr.dtype != np.uint8:                 # 16 bits / float → 3-sigma
                arr = to_8bit_3sigma(arr)
            if arr.ndim == 2:                          # gris → RGB
                arr = cv2.cvtColor(arr, cv2.COLOR_GRAY2RGB)
            elif arr.shape[2] == 4:                    # BGRA → RGB
                arr = cv2.cvtColor(arr, cv2.COLOR_BGRA2RGB)
            else:                                      # BGR → RGB
                arr = cv2.cvtColor(arr, cv2.COLOR_BGR2RGB)
            return Image.fromarray(arr, "RGB")

    # Repli PIL (webp, formats exotiques). Gère aussi le 16 bits (mode I;16/I/F).
    img = Image.open(path)
    if img.mode in ("I", "I;16", "I;16B", "I;16L", "I;16N", "F"):
        arr = np.asarray(img)
        return Image.fromarray(to_8bit_3sigma(arr), "L").convert("RGB")
    if img.mode not in ("RGB", "L"):
        img = img.convert("RGB")
    return img.convert("RGB")


def is_high_bitdepth(path: str) -> Optional[bool]:
    """True si l'image est stockée sur >8 bits/canal (best effort via PIL)."""
    try:
        with Image.open(path) as img:
            return img.mode in ("I", "I;16", "I;16B", "I;16L", "I;16N", "F")
    except Exception:
        return None
