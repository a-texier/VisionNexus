##########################################
# Project  : VisionNexus
# File     : annotation_loader.py
# Author   : VisionNexus contributors
# Created  : 2026-06-12
# Obj  : Auto-detecting ground-truth annotation loader supporting .ver, YOLO txt, and folder formats.
##########################################

import logging
import re
from pathlib import Path

log = logging.getLogger(__name__)

Annotations = dict[int, list[tuple[int, int, int, int, int]]]


####
# Public entry point
####


def load_annotations(
    annotation_file: str,
    image_width: int = 0,
    image_height: int = 0,
) -> Annotations:
    """
    Load annotations. Format is auto-detected from the path.

    Parameters
    ########
    annotation_file  : path to a .ver file, a .txt file, or a directory
                       of YOLO .txt files. Empty string -> returns {}.
    image_width, image_height : required when loading YOLO normalized coords.

    Returns
    ######
    {frame_idx: [(class_id, x1, y1, x2, y2), ...]}
    """
    if not annotation_file:
        return {}

    p = Path(annotation_file)

    ####
    # DIRECTORY -> YOLO ultralytics folder (one .txt per frame)
    ####
    if p.is_dir():
        return _load_yolo_folder(p, image_width, image_height)

    if not p.exists():
        log.warning("Annotation file not found: %s", p)
        return {}

    ext = p.suffix.lower()

    if ext == ".ver":
        return _load_ver(p)

    if ext == ".txt":
        # Detect: if the first data line has 5 tokens -> YOLO per-file format
        #         (no frame_id column); 6 tokens -> merged format (with frame_id).
        n_cols = _peek_column_count(p)
        if n_cols == 5:
            # single .txt that looks like a YOLO per-frame file
            # treat it as frame 0 only (edge case)
            return _load_yolo_single_frame(p, image_width, image_height, frame_idx=0)
        else:
            return _load_yolo_merged(p, image_width, image_height)

    log.warning("Unknown annotation extension '%s', trying .ver parser", ext)
    return _load_ver(p)


# Known .ver class labels -> integer id
_VER_CLASS_MAP: dict[str, int] = {
    "drone": 0,
    "bird": 1,
    "plane": 2,
    "helicopter": 3,
    "unknown": 4,
}


####
# Internal loaders
####


def _load_ver(path: Path) -> Annotations:
    """
    Parse a .ver ground-truth file.
    Format texte natif (10 colonnes) :
      frame_id  visibility  x1  y1  x2  y2  track_id  class  subclass  subsubclass
    Format court (6+ colonnes, pas de track_id persistant) :
      frame_id  visibility  x1  y1  x2  y2  [...]

    IMPORTANT : col[1] = visibility (0/1), col[6] = track_id persistant de l'objet.
    Ne pas confondre les deux - visibility n'est pas un ID d'objet.

    Frame indices dans le .ver sont 1-bases (le premier frame annote est 1, pas 0).
    On les convertit en 0-bases ici (soustraction de 1) pour aligner avec
    les frame_id 0-bases du SequenceLoader.

    Output : {frame_idx_0based: [(cls, x1, y1, x2, y2, track_id), ...]}
    Le track_id (6e element, entier) est preserve pour le calcul IDSW.
    """
    annotations: Annotations = {}

    log.info("Loading .ver annotations: %s", path)
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            tokens = line.split()
            parsed = []
            for tok in tokens:
                try:
                    parsed.append(eval(tok))  # handles int, float, str tokens
                except Exception:
                    parsed.append(tok)
            track_id = 0
            try:
                if len(parsed) >= 8:
                    # Format long natif : frame_id visibility x1 y1 x2 y2 track_id class [...]
                    # col[1] = visibility (flag 0/1), col[6] = track_id persistant objet
                    frame_idx = parsed[0]
                    x1, y1, x2, y2 = parsed[2], parsed[3], parsed[4], parsed[5]
                    tid = parsed[6]
                    cls_key = str(parsed[7])
                    track_id = int(round(float(tid)))
                    cls = _VER_CLASS_MAP.get(cls_key, 0) if cls_key in _VER_CLASS_MAP else 0
                elif len(parsed) >= 6:
                    # Format court : frame_id visibility x1 y1 x2 y2 [pas de track_id]
                    frame_idx = parsed[0]
                    x1, y1, x2, y2 = parsed[2], parsed[3], parsed[4], parsed[5]
                    track_id = 0
                    cls = 0
                else:
                    log.debug(".ver line ignored (< 6 colonnes): %r", line)
                    continue
            except (ValueError, TypeError, IndexError):
                log.debug(".ver line ignored (erreur parsing): %r", line)
                continue

            # .ver frame indices sont 1-bases -> convertir en 0-base
            frame_idx_0 = int(frame_idx) - 1
            x1, y1, x2, y2 = map(int, [x1, y1, x2, y2])
            annotations.setdefault(frame_idx_0, []).append((int(cls), x1, y1, x2, y2, track_id))

    total = sum(len(v) for v in annotations.values())
    log.info(
        ".ver annotations: %d frames, %d boxes  (frame indices: 1-based -> 0-based)",
        len(annotations),
        total,
    )
    return annotations


def _load_yolo_merged(path: Path, img_w: int, img_h: int) -> Annotations:
    """
    YOLO merged single-file format.
    Each line: frame_id  class  cx_norm  cy_norm  w_norm  h_norm
    """
    annotations: Annotations = {}
    with open(path, encoding="utf-8") as f:
        for lineno, line in enumerate(f, 1):
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            parts = line.split()
            if len(parts) < 6:
                log.debug("YOLO merged line %d: expected 6 fields, got %d", lineno, len(parts))
                continue
            try:
                frame_idx = int(parts[0])
                cls = int(parts[1])
                box = _yolo_norm_to_pixel(
                    float(parts[2]),
                    float(parts[3]),
                    float(parts[4]),
                    float(parts[5]),
                    img_w,
                    img_h,
                )
                annotations.setdefault(frame_idx, []).append((cls, *box))
            except (ValueError, IndexError):
                log.debug("YOLO merged line %d parse error: %r", lineno, line)
    _log_summary("YOLO merged", annotations, path)
    return annotations


def _load_yolo_folder(folder: Path, img_w: int, img_h: int) -> Annotations:
    """
    YOLO ultralytics folder: one .txt per frame.
    Filename numeric part -> frame_idx.
    Each file line: class  cx_norm  cy_norm  w_norm  h_norm
    """
    txt_files = sorted(folder.glob("*.txt"))
    if not txt_files:
        log.warning("YOLO folder: no .txt files in %s", folder)
        return {}

    annotations: Annotations = {}
    for txt_path in txt_files:
        # Extract numeric part of filename for frame_idx
        frame_idx = _filename_to_frame_idx(txt_path.stem)
        boxes = _parse_yolo_frame_file(txt_path, img_w, img_h)
        if boxes:
            annotations[frame_idx] = boxes

    _log_summary("YOLO folder", annotations, folder)
    return annotations


def _load_yolo_single_frame(path: Path, img_w: int, img_h: int, frame_idx: int) -> Annotations:
    """Single YOLO .txt file (no frame_id) -> treat as one frame."""
    boxes = _parse_yolo_frame_file(path, img_w, img_h)
    return {frame_idx: boxes} if boxes else {}


####
# YOLO helpers
####


def _parse_yolo_frame_file(
    path: Path, img_w: int, img_h: int
) -> list[tuple[int, int, int, int, int]]:
    """
    Parse a single YOLO annotation file (one box per line).
    Format: class  cx_norm  cy_norm  w_norm  h_norm
    """
    boxes = []
    with open(path, encoding="utf-8") as f:
        for lineno, line in enumerate(f, 1):
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            parts = line.split()
            if len(parts) < 5:
                log.debug("%s line %d: expected 5 fields, got %d", path.name, lineno, len(parts))
                continue
            try:
                cls = int(parts[0])
                box = _yolo_norm_to_pixel(
                    float(parts[1]),
                    float(parts[2]),
                    float(parts[3]),
                    float(parts[4]),
                    img_w,
                    img_h,
                )
                boxes.append((cls, *box))
            except (ValueError, IndexError):
                log.debug("%s line %d parse error: %r", path.name, lineno, line)
    return boxes


def _yolo_norm_to_pixel(
    cx_n: float,
    cy_n: float,
    w_n: float,
    h_n: float,
    img_w: int,
    img_h: int,
) -> tuple[int, int, int, int]:
    """
    Convert YOLO normalized (cx, cy, w, h) to pixel (x1, y1, x2, y2).
    When img_w / img_h == 0 the normalized values are returned as-is
    (multiplied by 1) to avoid crashing.
    """
    W = img_w if img_w > 0 else 1
    H = img_h if img_h > 0 else 1
    cx = cx_n * W
    cy = cy_n * H
    bw = w_n * W
    bh = h_n * H
    x1 = int(cx - bw / 2)
    y1 = int(cy - bh / 2)
    x2 = int(cx + bw / 2)
    y2 = int(cy + bh / 2)
    return (x1, y1, x2, y2)


_RE_DIGITS = re.compile(r"\d+")


def _filename_to_frame_idx(stem: str) -> int:
    """
    Extract frame index from filename stem.
    "frame_000042" -> 42,  "000042" -> 42,  "img42_mask" -> 42
    Falls back to 0 if no digits are found.
    """
    m = _RE_DIGITS.search(stem)
    return int(m.group()) if m else 0


def _peek_column_count(path: Path) -> int:
    """Return the column count of the first non-comment line, or 0."""
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#"):
                return len(line.split())
    return 0


def _log_summary(label: str, annotations: Annotations, src) -> None:
    total = sum(len(v) for v in annotations.values())
    log.info(
        "%s annotations: %d frames, %d boxes  [%s]",
        label,
        len(annotations),
        total,
        src,
    )
