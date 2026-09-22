# ============================================================
# utils/image_utils.py
# Utilitaires pour la manipulation d'images :
# génération de miniatures, conversion de masques SAM2,
# encodage RLE, et redimensionnement.
# ============================================================

import base64
import io
from pathlib import Path
from typing import List, Optional, Tuple

import cv2
import numpy as np
from PIL import Image


def generate_thumbnail(
    image_path: str,
    output_path: str,
    size: Tuple[int, int] = (160, 90),
    quality: int = 75,
) -> bool:
    """
    Génère une miniature d'image en conservant le ratio d'aspect.
    Utilise un fond noir pour compléter si l'image n'est pas au format 16:9.

    Args:
        image_path: Chemin de l'image source
        output_path: Chemin de sortie de la miniature
        size: Dimensions cibles (largeur, hauteur) en pixels
        quality: Qualité JPEG de 1 à 95

    Returns:
        True si la miniature a été générée avec succès
    """
    try:
        Path(output_path).parent.mkdir(parents=True, exist_ok=True)
        img = Image.open(image_path)

        # Conversion en RGB si nécessaire (ex: PNG avec canal alpha)
        if img.mode not in ("RGB", "L"):
            img = img.convert("RGB")

        # Redimensionnement avec conservation du ratio
        img.thumbnail(size, Image.Resampling.LANCZOS)

        # Fond noir pour les images non-16:9
        background = Image.new("RGB", size, (0, 0, 0))
        offset = ((size[0] - img.size[0]) // 2, (size[1] - img.size[1]) // 2)
        background.paste(img, offset)

        background.save(output_path, "JPEG", quality=quality)
        return True
    except Exception as e:
        print(f"[image_utils] Erreur génération thumbnail {image_path}: {e}")
        return False


def mask_to_bbox_yolo(
    mask: np.ndarray,
    img_width: int,
    img_height: int,
) -> Optional[Tuple[float, float, float, float]]:
    """
    Convertit un masque binaire SAM2 en bounding box YOLO normalisée.
    La bbox est la plus petite boîte englobant tous les pixels à True.

    Args:
        mask: Tableau numpy 2D booléen (True = objet)
        img_width: Largeur de l'image en pixels
        img_height: Hauteur de l'image en pixels

    Returns:
        Tuple (cx, cy, w, h) normalisé dans [0, 1], ou None si masque vide
    """
    # Trouver les coordonnées des pixels actifs
    rows = np.any(mask, axis=1)
    cols = np.any(mask, axis=0)

    if not rows.any():
        return None  # Masque vide, pas de bbox

    # Limites du masque en pixels
    y_min, y_max = np.where(rows)[0][[0, -1]]
    x_min, x_max = np.where(cols)[0][[0, -1]]

    # Conversion en coordonnées YOLO normalisées
    cx = (x_min + x_max) / 2.0 / img_width
    cy = (y_min + y_max) / 2.0 / img_height
    w = (x_max - x_min) / img_width
    h = (y_max - y_min) / img_height

    return (cx, cy, w, h)


def mask_to_polygon(
    mask: np.ndarray,
    img_width: int,
    img_height: int,
    epsilon_factor: float = 0.005,
    max_points: int = 100,
) -> List[Tuple[float, float]]:
    """
    Convertit un masque binaire SAM2 en polygone simplifié (contour externe).
    Utilise l'algorithme de Douglas-Peucker (cv2.approxPolyDP) pour réduire
    le nombre de points tout en conservant la forme générale.

    Args:
        mask: Tableau numpy 2D booléen
        img_width: Largeur de l'image pour normalisation
        img_height: Hauteur de l'image pour normalisation
        epsilon_factor: Facteur de simplification (plus grand = moins de points)
        max_points: Nombre maximum de points dans le polygone de sortie

    Returns:
        Liste de points normalisés [(x1,y1), (x2,y2), ...]
    """
    # Conversion en image uint8 pour OpenCV
    mask_uint8 = (mask.astype(np.uint8)) * 255

    # Trouver les contours externes
    contours, _ = cv2.findContours(
        mask_uint8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
    )

    if not contours:
        return []

    # Prendre le contour le plus grand (objet principal)
    largest_contour = max(contours, key=cv2.contourArea)

    # Simplification avec Douglas-Peucker
    perimeter = cv2.arcLength(largest_contour, True)
    epsilon = epsilon_factor * perimeter
    approx = cv2.approxPolyDP(largest_contour, epsilon, True)

    # Limitation du nombre de points
    if len(approx) > max_points:
        # Rééchantillonnage uniforme
        indices = np.linspace(0, len(approx) - 1, max_points, dtype=int)
        approx = approx[indices]

    # Normalisation des coordonnées dans [0, 1]
    points = []
    for pt in approx:
        x = float(pt[0][0]) / img_width
        y = float(pt[0][1]) / img_height
        points.append((x, y))

    return points


def image_to_base64(image_path: str, max_size: Optional[Tuple[int, int]] = None) -> str:
    """
    Encode une image en base64 pour transmission via WebSocket.
    Optionnellement redimensionne l'image pour réduire la taille.

    Args:
        image_path: Chemin de l'image
        max_size: Dimensions maximales (largeur, hauteur) pour redimensionnement

    Returns:
        Chaîne base64 de l'image JPEG encodée
    """
    img = Image.open(image_path)
    if img.mode != "RGB":
        img = img.convert("RGB")

    if max_size:
        img.thumbnail(max_size, Image.Resampling.LANCZOS)

    buffer = io.BytesIO()
    img.save(buffer, format="JPEG", quality=80)
    return base64.b64encode(buffer.getvalue()).decode("utf-8")


# ── LUT d'affichage (remap dynamique 16/8 bits) ───────────────────────────────
# lut = {"mode": "sigma"|"minmax"|"manual", "sigma": 3.0, "lo": <float|None>, "hi": <float|None>}
# Point d'entrée UNIQUE de la conversion vers 8 bits : tout passe par apply_lut.
DEFAULT_LUT = {"mode": "sigma", "sigma": 3.0, "lo": None, "hi": None}


def _lut_bounds(img_f: np.ndarray, lut: dict) -> Tuple[float, float]:
    mode = lut.get("mode", "sigma")
    fmin, fmax = float(img_f.min()), float(img_f.max())
    if mode == "minmax":
        return fmin, fmax
    if mode == "manual":
        lo = lut.get("lo")
        hi = lut.get("hi")
        return (float(lo) if lo is not None else fmin,
                float(hi) if hi is not None else fmax)
    # sigma (défaut)
    sigma = float(lut.get("sigma", 3.0))
    mean, std = float(img_f.mean()), float(img_f.std())
    return max(mean - sigma * std, fmin), min(mean + sigma * std, fmax)


def apply_lut(img: np.ndarray, lut: Optional[dict] = None) -> np.ndarray:
    """
    Convertit une image quelconque (uint8/uint16/int/float) en uint8 via la LUT.
      - mode 'sigma'  : [mean - Nσ, mean + Nσ] → [0,255]  (N=sigma, défaut 3)
      - mode 'minmax' : [min, max] → [0,255]
      - mode 'manual' : [lo, hi] → [0,255]
    Les images déjà uint8 en mode 'sigma' sont retournées TELLES QUELLES
    (compat historique) ; en minmax/manual la LUT s'applique aussi au 8 bits.
    """
    lut = lut or DEFAULT_LUT
    mode = lut.get("mode", "sigma")
    if img.dtype == np.uint8 and mode == "sigma":
        return img
    img_f = img.astype(np.float32)
    lo, hi = _lut_bounds(img_f, lut)
    if hi - lo < 1e-6:
        hi = lo + 1.0
    out = (img_f - lo) / (hi - lo) * 255.0
    return np.clip(out, 0, 255).astype(np.uint8)


def to_8bit_3sigma(img: np.ndarray) -> np.ndarray:
    """Compat : conversion 8 bits par étirement 3-sigma (= apply_lut défaut)."""
    return apply_lut(img, DEFAULT_LUT)


def lut_signature(lut: Optional[dict]) -> str:
    """Signature courte et stable d'une LUT, pour nommer les caches (invalidation)."""
    if not lut or lut.get("mode", "sigma") == "sigma":
        s = float((lut or DEFAULT_LUT).get("sigma", 3.0))
        # 'sig3' == défaut historique -> caches existants conservés.
        return "sig3" if abs(s - 3.0) < 1e-9 else f"sig{s:g}"
    mode = lut.get("mode")
    if mode == "minmax":
        return "mm"
    lo, hi = lut.get("lo"), lut.get("hi")
    return f"man{('' if lo is None else f'{float(lo):g}')}_{('' if hi is None else f'{float(hi):g}')}"


def purge_stale_lut_caches(project_dir, keep_signatures) -> int:
    """Supprime les JPEG de cache portant une signature de LUT qui n'est plus
    utilisee par le projet. Retourne le nombre de fichiers supprimes.

    Les caches sont nommes `<stem>_prev<width>_<sig>.jpg` (frames_preview/) et
    `<stem>_8bit_<sig>.jpg` (frames_8bit/) : changer un reglage de LUT genere
    donc une serie COMPLETE de nouveaux fichiers sans jamais toucher a
    l'ancienne. Sur un projet de quelques milliers de frames, quelques
    ajustements du curseur suffisent a empiler plusieurs generations mortes
    (constate : 1511 fichiers preview pour 4410 frames, deux signatures
    coexistantes). On ne garde que les signatures vivantes -- celle du projet et
    celle de chaque sequence.

    Best-effort : un fichier verrouille ou une arborescence absente ne doit
    jamais faire echouer l'enregistrement d'une LUT.
    """
    keep = {s for s in keep_signatures if s}
    removed = 0
    # On decoupe sur le marqueur, jamais sur le dernier "_" : une signature
    # manuelle vaut `man<lo>_<hi>` et contient elle-meme un underscore, tout
    # comme les stems de frames (`s001_frame_000000`). On prend la DERNIERE
    # occurrence du marqueur pour rester correct si un nom source contenait
    # deja "_prev".
    for sub, marker, drop_width in (
        ("frames_preview", "_prev", True),   # <stem>_prev<width>_<sig>
        ("frames_8bit", "_8bit_", False),    # <stem>_8bit_<sig>
    ):
        d = Path(project_dir) / sub
        if not d.is_dir():
            continue
        for f in d.glob("*.jpg"):
            head, found, tail = f.stem.rpartition(marker)
            if not found:
                continue
            if drop_width:
                # tail == "<width>_<sig>" : la largeur est purement numerique.
                width, _, tail = tail.partition("_")
                if not width.isdigit():
                    continue
            if not tail or tail in keep:
                continue
            try:
                f.unlink()
                removed += 1
            except OSError:
                pass
    return removed


def compute_histogram(img: np.ndarray, bins: int = 256, max_samples: int = 500_000) -> dict:
    """
    Histogramme des valeurs BRUTES d'une image (avant LUT). Sous-échantillonne
    les grosses images pour rester rapide. Convertit un multi-canal en luminance.
    Retourne {bins, counts, min, max, mean, std, dtype, bit_depth}.
    """
    if img.ndim == 3:
        a = img[..., :3].astype(np.float32).mean(axis=2)
    else:
        a = img.astype(np.float32)
    flat = a.ravel()
    if flat.size > max_samples:
        idx = np.linspace(0, flat.size - 1, max_samples).astype(np.int64)
        flat = flat[idx]
    vmin, vmax = float(flat.min()), float(flat.max())
    hi = vmax if vmax > vmin else vmin + 1.0
    counts, edges = np.histogram(flat, bins=bins, range=(vmin, hi))
    return {
        "bins": [float(e) for e in edges[:-1]],
        "counts": [int(c) for c in counts],
        "min": vmin, "max": vmax,
        "mean": float(flat.mean()), "std": float(flat.std()),
        "dtype": str(img.dtype),
        "bit_depth": int(img.dtype.itemsize * 8),
    }


def load_image_bgr_8bit(image_path: str, lut: Optional[dict] = None) -> np.ndarray:
    """
    Charge une image en BGR uint8 quel que soit son format source :
    8 bits classique, 16 bits (PNG/TIFF RGB ou IR mono), float.
    La conversion vers 8 bits applique la LUT (défaut = 3-sigma).
    Retourne un tableau numpy (H, W, 3) BGR uint8.
    """
    img = cv2.imread(image_path, cv2.IMREAD_UNCHANGED)
    if img is None:
        raise FileNotFoundError(f"Image introuvable : {image_path}")
    img = apply_lut(img, lut)
    if img.ndim == 2:
        return cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
    if img.shape[2] == 4:
        return cv2.cvtColor(img, cv2.COLOR_BGRA2BGR)
    return img


def load_image_rgb(image_path: str, lut: Optional[dict] = None) -> np.ndarray:
    """
    Charge une image en RGB uint8 (gère aussi le 16 bits via la LUT).
    Retourne un tableau numpy (H, W, 3) en uint8.
    """
    return cv2.cvtColor(load_image_bgr_8bit(image_path, lut), cv2.COLOR_BGR2RGB)


def is_high_bitdepth_image(image_path: str) -> bool:
    """
    Détecte rapidement (via les métadonnées PIL) si une image est stockée
    sur plus de 8 bits par canal (PNG 16 bits, TIFF IR, etc.).
    """
    try:
        with Image.open(image_path) as img:
            return img.mode in ("I", "I;16", "I;16B", "I;16L", "I;16N", "F", "RGB;16", "RGBA;16")
    except Exception:
        return False


def ensure_8bit_cached(image_path: str, cache_dir: str, lut: Optional[dict] = None) -> Optional[str]:
    """
    Retourne le chemin d'une version 8 bits (JPEG) de l'image, générée via la LUT
    et mise en cache dans cache_dir. Le nom de cache inclut la signature LUT
    (invalidation propre au changement de réglage). None si l'image est déjà 8 bits
    ET la LUT est en mode 'sigma' (rien à convertir).
    """
    src = Path(image_path)
    sig = lut_signature(lut)
    manual = (lut or DEFAULT_LUT).get("mode", "sigma") != "sigma"
    # 8 bits + LUT auto (sigma) : rien à faire ; mais 8 bits + minmax/manual : on applique.
    if not is_high_bitdepth_image(str(src)) and not manual:
        return None
    cache = Path(cache_dir)
    cache.mkdir(parents=True, exist_ok=True)
    dst = cache / f"{src.stem}_8bit_{sig}.jpg"
    if not dst.exists():
        try:
            img = load_image_bgr_8bit(str(src), lut)
            cv2.imwrite(str(dst), img, [cv2.IMWRITE_JPEG_QUALITY, 92])
        except Exception as e:
            print(f"[image_utils] Conversion 8 bits échouée {src}: {e}")
            return None
    return str(dst)


def get_image_dimensions(image_path: str) -> Tuple[int, int]:
    """
    Retourne les dimensions (largeur, hauteur) d'une image sans la charger complètement.
    Utilise PIL pour une lecture rapide des métadonnées.
    """
    with Image.open(image_path) as img:
        return img.size  # (width, height)
