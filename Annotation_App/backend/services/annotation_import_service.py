# ============================================================
# services/annotation_import_service.py
# Import d'annotations existantes (.ver texte natif ou dossier YOLO) sur une
# séquence d'un projet (S9). Convertit vers le format interne (YOLO
# normalisé [0,1]) et crée les classes / tracks manquants.
#
# .ver (natif, 10 colonnes) :
#   frame_id(1-based) visibility x1 y1 x2 y2 track_id classe sous-classe sous-sous-classe
#   - Coordonnées ABSOLUES (pixels), coins. L'import auto-détecte tout de même un
#     éventuel fichier normalisé (toutes coords <= 1 → pas de division par la taille).
#   - visibility 0 ou bbox nulle → frame vide (ignorée).
#   - track_id -1 → pas de piste. Champs de classe « None »/« - » → absent.
# YOLO (un .txt par image, coords normalisées) :
#   class_index cx cy w h
#   - noms de classes lus dans classes.txt / *.yaml si présents, sinon "classe_{i}".
# ============================================================

import logging
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff", ".webp"}


def _to_norm(x1: float, y1: float, x2: float, y2: float, w: int, h: int):
    """Bbox pixels (x1,y1,x2,y2) → YOLO normalisé (cx,cy,bw,bh) borné [0,1]."""
    w = w or 1
    h = h or 1
    cx = ((x1 + x2) / 2) / w
    cy = ((y1 + y2) / 2) / h
    bw = abs(x2 - x1) / w
    bh = abs(y2 - y1) / h
    clamp = lambda v: max(0.0, min(1.0, v))
    return clamp(cx), clamp(cy), clamp(bw), clamp(bh)


def parse_ver(path: str) -> list[dict]:
    """Parse un fichier .ver → liste de détections (coords PIXELS).

    Chaque item : {frame_1b, x1, y1, x2, y2, track_id, name, subclass, subsubclass}.
    Les lignes vides / commentaires (#) / à visibilité 0 sont ignorées.
    """
    out: list[dict] = []
    p = Path(path)
    for raw in p.read_text(encoding="utf-8", errors="replace").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split()
        if len(parts) < 7:
            continue
        try:
            frame_1b = int(float(parts[0]))
            visibility = int(float(parts[1]))
            x1, y1, x2, y2 = (float(parts[i]) for i in range(2, 6))
            track_id = int(float(parts[6]))
        except (ValueError, IndexError):
            continue
        if visibility == 0 or (x2 - x1) == 0 or (y2 - y1) == 0:
            continue  # frame marquée vide
        # Détection normalisé vs pixels : une coordonnée > 1 (+ marge) → pixels
        # (ancien format). Sinon coins déjà normalisés [0,1] → pas de division
        # par la taille de frame à l'import.
        normalized = max(x1, y1, x2, y2) <= 1.0 + 1e-6
        name = parts[7] if len(parts) > 7 else "object"
        _NULL = ("-", "None", "none", "")
        subclass = parts[8] if len(parts) > 8 and parts[8] not in _NULL else None
        subsubclass = parts[9] if len(parts) > 9 and parts[9] not in _NULL else None
        out.append({
            "frame_1b": frame_1b, "x1": x1, "y1": y1, "x2": x2, "y2": y2,
            "track_id": track_id, "name": name, "subclass": subclass, "subsubclass": subsubclass,
            "normalized": normalized,
        })
    return out


def _yolo_class_names(folder: Path) -> dict[int, str]:
    """Noms de classes depuis classes.txt / *.yaml (data.yaml) si présents."""
    names: dict[int, str] = {}
    txt = folder / "classes.txt"
    if txt.exists():
        for i, n in enumerate(txt.read_text(encoding="utf-8", errors="replace").splitlines()):
            if n.strip():
                names[i] = n.strip()
        return names
    for yml in list(folder.glob("*.yaml")) + list(folder.glob("*.yml")):
        try:
            import yaml
            data = yaml.safe_load(yml.read_text(encoding="utf-8", errors="replace"))
            nm = data.get("names") if isinstance(data, dict) else None
            if isinstance(nm, dict):
                names = {int(k): str(v) for k, v in nm.items()}
            elif isinstance(nm, list):
                names = {i: str(v) for i, v in enumerate(nm)}
            if names:
                return names
        except Exception:
            continue
    return names


def parse_yolo_folder(path: str) -> tuple[dict[str, list[dict]], dict[int, str]]:
    """Parse un dossier YOLO (ou un .txt unique) → ({stem: [dets normalisées]}, class_names).

    Chaque det : {class_index, cx, cy, w, h} (déjà normalisé [0,1]).
    La clé est le nom de fichier SANS extension (matché au stem de la frame).
    """
    p = Path(path)
    folder = p if p.is_dir() else p.parent
    txt_files = [p] if p.is_file() and p.suffix.lower() == ".txt" else sorted(folder.glob("*.txt"))
    txt_files = [f for f in txt_files if f.name.lower() != "classes.txt"]
    names = _yolo_class_names(folder)
    result: dict[str, list[dict]] = {}
    for tf in txt_files:
        dets: list[dict] = []
        for raw in tf.read_text(encoding="utf-8", errors="replace").splitlines():
            parts = raw.split()
            if len(parts) < 5:
                continue
            try:
                ci = int(float(parts[0]))
                cx, cy, bw, bh = (float(parts[i]) for i in range(1, 5))
            except ValueError:
                continue
            dets.append({"class_index": ci, "cx": cx, "cy": cy, "w": bw, "h": bh})
        result[tf.stem] = dets
    return result, names


def detect_format(path: str) -> str:
    """Devine le format : 'ver' | 'yolo'."""
    p = Path(path)
    if p.suffix.lower() == ".ver":
        return "ver"
    if p.suffix.lower() == ".txt":
        return "yolo"
    if p.is_dir():
        if list(p.glob("*.txt")):
            return "yolo"
        vers = list(p.glob("*.ver"))
        if vers:
            return "ver"
    return "yolo"
