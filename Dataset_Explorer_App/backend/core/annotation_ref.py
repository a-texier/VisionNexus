# ============================================================
# core/annotation_ref.py
# Référencement léger de fichiers d'annotation (step 6).
#
# Détecte le format (.ver / dossier YOLO / .txt YOLO) et compte frames+boxes
# pour afficher un badge. Logique vendorisée depuis :
#   <tracker-source>/data/rejeu/annotation_loader.py
# (copie locale pour rester portable/offline dans le bundle — pas d'import
# hors de l'arbre de l'app).
#
# On NE parse PAS tout le contenu au scan : on compte seulement frames/boxes.
# ============================================================

import logging
import re
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

_RE_DIGITS = re.compile(r"\d+")


def _peek_column_count(path: Path) -> int:
    try:
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#"):
                    return len(line.split())
    except Exception:
        pass
    return 0


def _count_lines(path: Path) -> int:
    n = 0
    try:
        with open(path, encoding="utf-8") as f:
            for line in f:
                s = line.strip()
                if s and not s.startswith("#"):
                    n += 1
    except Exception:
        pass
    return n


def describe_annotations(annotation_path: str) -> Optional[dict]:
    """Détecte le format et compte frames+boxes. Retourne None si invalide/absent.

    Résultat : {"format": "ver"|"yolo_folder"|"yolo_txt", "frames": int, "boxes": int}
    """
    if not annotation_path:
        return None
    p = Path(annotation_path)
    if not p.exists():
        return None

    # --- Dossier YOLO : un .txt par frame ---
    if p.is_dir():
        txts = sorted(p.glob("*.txt"))
        if not txts:
            return None
        boxes = sum(_count_lines(t) for t in txts)
        return {"format": "yolo_folder", "frames": len(txts), "boxes": boxes}

    ext = p.suffix.lower()

    # --- .ver (natif) : frame_id visibility x1 y1 x2 y2 [track class ...] ---
    if ext == ".ver":
        frames: set[int] = set()
        boxes = 0
        try:
            with open(p, encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#"):
                        continue
                    toks = line.split()
                    if len(toks) < 6:
                        continue
                    try:
                        frames.add(int(float(toks[0])))
                    except ValueError:
                        continue
                    boxes += 1
        except Exception as exc:
            logger.warning("Lecture .ver echouee (%s) : %s", p, exc)
            return None
        return {"format": "ver", "frames": len(frames), "boxes": boxes}

    # --- .txt YOLO fusionné (frame_id class cx cy w h) ou mono-frame ---
    if ext == ".txt":
        n_cols = _peek_column_count(p)
        boxes = _count_lines(p)
        if n_cols >= 6:
            frames: set[int] = set()
            try:
                with open(p, encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if not line or line.startswith("#"):
                            continue
                        parts = line.split()
                        try:
                            frames.add(int(parts[0]))
                        except (ValueError, IndexError):
                            pass
            except Exception:
                pass
            return {"format": "yolo_txt", "frames": len(frames), "boxes": boxes}
        return {"format": "yolo_txt", "frames": 1, "boxes": boxes}

    return None
