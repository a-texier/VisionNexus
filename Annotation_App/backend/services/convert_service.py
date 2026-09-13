# ============================================================
# services/convert_service.py
# Conversions utilitaires (page Convert, S10) :
#   - optional_format  ↔ dossier PNG
#   - .ver ↔ YOLO (dossier .txt)
# Les conversions .ver↔YOLO nécessitent la résolution image (width/height) :
# .ver est en pixels, YOLO est normalisé [0,1].
# ============================================================

import logging
from pathlib import Path
from typing import Optional

import cv2
import numpy as np

from backend.services import annotation_import_service as imp
from backend.services.format_registry import preferred_extension, supports_filename

logger = logging.getLogger(__name__)


# ---- Images : optional_format ↔ PNG ----------------------------------------------------

def optional_format_to_png_folder(optional_format_path: str, out_dir: Optional[str] = None,
                      on_progress=None) -> dict:
    """Convertit un .optional en dossier de PNG (frame_000000.png …)."""
    from backend.services.format_registry import invoke_for_filename
    src = Path(optional_format_path)
    if not src.exists() or not supports_filename(str(src)):
        raise ValueError(f"Fichier .optional introuvable : {optional_format_path}")
    out = Path(out_dir) if out_dir else src.parent / f"{src.stem}_png"
    out.mkdir(parents=True, exist_ok=True)
    seq, _hdr = invoke_for_filename(str(src), "read", src)
    n = seq.shape[0]
    for i in range(n):
        img = seq[i]
        if img.ndim == 3 and img.shape[2] == 1:
            img = img[:, :, 0]
        # OpenCV attend du BGR ; nos optional_format sont souvent gris ou RGB
        if img.ndim == 3 and img.shape[2] == 3:
            img = cv2.cvtColor(img, cv2.COLOR_RGB2BGR)
        cv2.imwrite(str(out / f"frame_{i:06d}.png"), img)
        if on_progress:
            on_progress(i + 1, n)
    return {"output_dir": str(out), "frames": n}


def png_folder_to_optional_format(png_dir: str, out_path: Optional[str] = None,
                      on_progress=None) -> dict:
    """Convertit un dossier d'images (PNG/JPG) en fichier .optional."""
    from backend.services.format_registry import invoke_for_filename
    folder = Path(png_dir)
    if not folder.is_dir():
        raise ValueError(f"Dossier introuvable : {png_dir}")
    files = sorted(
        f for f in folder.iterdir()
        if f.suffix.lower() in imp.IMAGE_EXTS
    )
    if not files:
        raise ValueError("Aucune image dans le dossier")
    out = Path(out_path) if out_path else folder.parent / f"{folder.name}{preferred_extension()}"
    frames = []
    for i, f in enumerate(files):
        img = cv2.imread(str(f), cv2.IMREAD_UNCHANGED)
        if img is None:
            continue
        if img.ndim == 2:
            img = img[:, :, None]                       # gris → [h,w,1]
        elif img.ndim == 3 and img.shape[2] == 3:
            img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)  # BGR → RGB
        frames.append(img)
        if on_progress:
            on_progress(i + 1, len(files))
    seq = np.stack(frames, axis=0)                      # [n, h, w, c]
    if out.exists():
        out.unlink()
    invoke_for_filename(str(out), "write", str(out), seq)
    return {"output_path": str(out), "frames": len(frames)}


# ---- Annotations : .ver ↔ YOLO ---------------------------------------------

def ver_to_yolo(ver_path: str, out_dir: str, width: int, height: int) -> dict:
    """`.ver` (pixels) → dossier YOLO (un .txt normalisé par frame + classes.txt).

    Les classes sont indexées par (name, subclass, subsubclass) rencontrées.
    """
    dets = imp.parse_ver(ver_path)
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    class_index: dict[tuple, int] = {}
    per_frame: dict[int, list[str]] = {}
    for d in dets:
        key = (d["name"], d["subclass"], d["subsubclass"])
        if key not in class_index:
            class_index[key] = len(class_index)
        ci = class_index[key]
        cx, cy, bw, bh = imp._to_norm(d["x1"], d["y1"], d["x2"], d["y2"], width, height)
        per_frame.setdefault(d["frame_1b"], []).append(f"{ci} {cx:.6f} {cy:.6f} {bw:.6f} {bh:.6f}")
    for frame_1b, lines in per_frame.items():
        (out / f"frame_{frame_1b - 1:06d}.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
    # classes.txt (ordre d'index) : nom hiérarchique joint par _
    names = [None] * len(class_index)
    for (n, s, ss), i in class_index.items():
        names[i] = "_".join(p for p in (n, s, ss) if p)
    (out / "classes.txt").write_text("\n".join(names) + "\n", encoding="utf-8")
    return {"output_dir": str(out), "frames": len(per_frame), "classes": len(class_index)}


def yolo_to_ver(yolo_dir: str, out_path: str, width: int, height: int) -> dict:
    """Dossier YOLO (normalisé) → `.ver` (pixels).

    YOLO n'a pas de hiérarchie ni de track : classe = sous-classe = sous-sous-classe
    (= nom de classe YOLO) et track_id = -1 (S10).
    """
    per_stem, names = imp.parse_yolo_folder(yolo_dir)
    out = Path(out_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    lines = ["# Format .ver : frame_id visibility x1 y1 x2 y2 track_id classe sous-classe sous-sous-classe"]
    # Ordonner les frames par nom (frame_000000, …)
    for stem in sorted(per_stem.keys()):
        # frame_1b : si le stem finit par un nombre, on l'utilise (+1), sinon ordre.
        import re
        m = re.search(r"(\d+)$", stem)
        frame_1b = (int(m.group(1)) + 1) if m else (sorted(per_stem).index(stem) + 1)
        for d in per_stem[stem]:
            name = names.get(d["class_index"], f"classe_{d['class_index']}")
            x1 = int(round((d["cx"] - d["w"] / 2) * width))
            y1 = int(round((d["cy"] - d["h"] / 2) * height))
            x2 = int(round((d["cx"] + d["w"] / 2) * width))
            y2 = int(round((d["cy"] + d["h"] / 2) * height))
            lines.append(f"{frame_1b} 1 {x1} {y1} {x2} {y2} -1 {name} {name} {name}")
    out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return {"output_path": str(out), "boxes": len(lines) - 1}
