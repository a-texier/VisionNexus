# ============================================================
# yolox_dataset.py -- dataset YOLOX natif (remplace le dataset loader
# interne d'Ultralytics).
#
# Lit un data.yaml (path, train/val/test, names) -- le MEME data.yaml qu'un
# utilisateur Ultralytics a deja, aucune conversion requise -- et les
# annotations au format :
#   - YOLO .txt par image (convention communautaire, pas propriete
#     d'Ultralytics) : un fichier <image>.txt par image, "class cx cy w h"
#     normalise, dans un dossier labels/ miroir de images/.
#   - .ver (format historique VisionNexus) : un seul fichier pour toute la
#     sequence, "frame_id visibility x1 y1 x2 y2 [track_id class]".
#     Convention historique VisionNexus (class map, frames 1-based,
#     format court/long) afin de garder les class id coherents.
# ============================================================

from __future__ import annotations

import ast
import re
import sys
from pathlib import Path

import cv2
import numpy as np
import yaml

_YOLOX_VENDOR = Path(__file__).resolve().parent.parent / "vendor" / "yolox"
if str(_YOLOX_VENDOR) not in sys.path:
    sys.path.insert(0, str(_YOLOX_VENDOR))

from yolox.data.datasets.datasets_wrapper import Dataset  # noqa: E402

_IMG_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff"}

# Meme mapping que _VER_CLASS_MAP dans annotation_loader.py (Inference_App) :
# garantit les memes class id pour un .ver utilise a la fois comme verite
# terrain d'evaluation (tracker) et comme labels d'entrainement (ici).
VER_CLASS_MAP: dict[str, int] = {
    "drone": 0,
    "bird": 1,
    "plane": 2,
    "helicopter": 3,
    "unknown": 4,
}

_RE_DIGITS = re.compile(r"\d+")


def _filename_to_frame_idx(stem: str) -> int:
    """Extrait la partie numerique d'un nom de fichier ("frame_000042" -> 42)."""
    m = _RE_DIGITS.search(stem)
    return int(m.group()) if m else 0


def _labels_dir_for(images_dir: Path) -> Path:
    """Convention Ultralytics : .../images/xxx -> .../labels/xxx (dernier segment 'images')."""
    parts = list(images_dir.parts)
    for i in range(len(parts) - 1, -1, -1):
        if parts[i] == "images":
            parts[i] = "labels"
            return Path(*parts)
    return images_dir.parent / "labels" / images_dir.name


# ------------------------------------------------------------------ #
# data.yaml                                                            #
# ------------------------------------------------------------------ #


class DatasetSpec:
    def __init__(
        self,
        image_paths: list[Path],
        class_names: list[str],
        label_format: str,  # "yolo_txt" | "ver"
        label_source: Path,  # dossier .txt (yolo_txt) ou fichier .ver (ver)
    ):
        self.image_paths = image_paths
        self.class_names = class_names
        self.label_format = label_format
        self.label_source = label_source


def load_data_yaml(data_yaml: str, split: str) -> DatasetSpec:
    """Parse un data.yaml (path/train/val/test/names, + 'annotation_file'
    optionnel pointant un .ver) et retourne les images + le format de labels
    a utiliser pour ce split."""
    cfg = yaml.safe_load(Path(data_yaml).read_text(encoding="utf-8")) or {}
    root = Path(cfg.get("path", Path(data_yaml).parent))
    if not root.is_absolute():
        root = (Path(data_yaml).parent / root).resolve()

    split_rel = cfg.get(split) or cfg.get("val")
    if not split_rel:
        raise ValueError(f"data.yaml sans cle '{split}' ni 'val'")
    images_dir = (
        root / split_rel if not Path(split_rel).is_absolute() else Path(split_rel)
    )

    names_cfg = cfg.get("names", {})
    if isinstance(names_cfg, dict):
        class_names = [names_cfg[k] for k in sorted(names_cfg, key=int)]
    else:
        class_names = list(names_cfg)
    if not class_names:
        raise ValueError("data.yaml sans cle 'names' (liste des classes)")

    if images_dir.is_file():
        image_paths = [images_dir]
    else:
        image_paths = sorted(
            p for p in images_dir.rglob("*") if p.suffix.lower() in _IMG_EXTS
        )
    if not image_paths:
        raise FileNotFoundError(f"aucune image trouvee dans {images_dir}")

    ver_override = cfg.get("annotation_file")
    if ver_override and str(ver_override).lower().endswith(".ver"):
        ver_path = Path(ver_override)
        if not ver_path.is_absolute():
            ver_path = (Path(data_yaml).parent / ver_path).resolve()
        return DatasetSpec(image_paths, class_names, "ver", ver_path)

    labels_dir = _labels_dir_for(images_dir)
    if labels_dir.is_file() and labels_dir.suffix.lower() == ".ver":
        return DatasetSpec(image_paths, class_names, "ver", labels_dir)
    return DatasetSpec(image_paths, class_names, "yolo_txt", labels_dir)


# ------------------------------------------------------------------ #
# Parsing des annotations                                              #
# ------------------------------------------------------------------ #


def load_yolo_txt_labels(label_path: Path, img_w: int, img_h: int) -> np.ndarray:
    """Parse un fichier YOLO .txt (class cx cy w h normalise) -> [[x1,y1,x2,y2,cls], ...]."""
    if not label_path.exists():
        return np.zeros((0, 5), dtype=np.float32)
    rows = []
    for line in label_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split()
        if len(parts) < 5:
            continue
        try:
            cls_id = int(float(parts[0]))
            cx, cy, w, h = (float(v) for v in parts[1:5])
        except ValueError:
            continue
        x1 = (cx - w / 2) * img_w
        y1 = (cy - h / 2) * img_h
        x2 = (cx + w / 2) * img_w
        y2 = (cy + h / 2) * img_h
        rows.append([x1, y1, x2, y2, float(cls_id)])
    if not rows:
        return np.zeros((0, 5), dtype=np.float32)
    return np.asarray(rows, dtype=np.float32)


def load_ver_file(path: Path) -> dict[int, list[tuple[int, int, int, int, int]]]:
    """Parse un fichier .ver complet -> {frame_idx_0based: [(cls,x1,y1,x2,y2), ...]}.

    Format long (8+ colonnes) : frame_id visibility x1 y1 x2 y2 track_id class [...]
    Format court (6+ colonnes) : frame_id visibility x1 y1 x2 y2 (pas de classe -> 0)
    Memes regles que _load_ver() dans annotation_loader.py (Inference_App),
    y compris la conversion frame 1-based -> 0-based.
    """
    annotations: dict[int, list[tuple[int, int, int, int, int]]] = {}
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            tokens = line.split()
            parsed: list = []
            for tok in tokens:
                try:
                    parsed.append(ast.literal_eval(tok))
                except (ValueError, SyntaxError):
                    parsed.append(tok)
            try:
                if len(parsed) >= 8:
                    frame_idx = parsed[0]
                    x1, y1, x2, y2 = parsed[2], parsed[3], parsed[4], parsed[5]
                    cls_key = str(parsed[7])
                    cls = VER_CLASS_MAP.get(cls_key, 0)
                elif len(parsed) >= 6:
                    frame_idx = parsed[0]
                    x1, y1, x2, y2 = parsed[2], parsed[3], parsed[4], parsed[5]
                    cls = 0
                else:
                    continue
            except (ValueError, TypeError, IndexError):
                continue
            frame_idx_0 = int(frame_idx) - 1
            x1i, y1i, x2i, y2i = (int(x1), int(y1), int(x2), int(y2))
            annotations.setdefault(frame_idx_0, []).append(
                (int(cls), x1i, y1i, x2i, y2i)
            )
    return annotations


# ------------------------------------------------------------------ #
# Dataset torch/YOLOX                                                  #
# ------------------------------------------------------------------ #


class YoloTxtDataset(Dataset):
    """Dataset YOLOX (contrat pull_item/__getitem__ de yolox.data.datasets)
    lisant directement un data.yaml + labels YOLO .txt ou .ver -- pas de
    conversion COCO JSON, pas de dependance pycocotools."""

    def __init__(
        self,
        data_yaml: str,
        split: str = "train",
        img_size: tuple[int, int] = (640, 640),
        preproc=None,
    ):
        spec = load_data_yaml(data_yaml, split)
        super().__init__(img_size)
        self.image_paths = spec.image_paths
        self.class_names = spec.class_names
        self.label_format = spec.label_format
        self.img_size = img_size
        self.preproc = preproc

        self._ver_annotations: dict | None = None
        self._labels_dir: Path | None = None
        if spec.label_format == "ver":
            self._ver_annotations = load_ver_file(spec.label_source)
        else:
            self._labels_dir = spec.label_source

    def __len__(self) -> int:
        return len(self.image_paths)

    def _load_target(self, index: int, img_w: int, img_h: int) -> np.ndarray:
        img_path = self.image_paths[index]
        if self.label_format == "ver":
            frame_idx = _filename_to_frame_idx(img_path.stem)
            boxes = (self._ver_annotations or {}).get(frame_idx, [])
            if not boxes:
                return np.zeros((0, 5), dtype=np.float32)
            return np.asarray(
                [[b[1], b[2], b[3], b[4], float(b[0])] for b in boxes], dtype=np.float32
            )
        label_path = (self._labels_dir or Path()) / (img_path.stem + ".txt")
        return load_yolo_txt_labels(label_path, img_w, img_h)

    def pull_item(self, index: int):
        """Retourne (img, target[N,5] xyxy+cls en coord. pixel d'origine, img_info, img_id).

        Pas de pre-resize/cache ici (contrairement a COCODataset) : le
        preproc (TrainTransform/ValTransform) redimensionne + pad a la
        volee, image d'origine ou deja redimensionnee fonctionnent
        indifferemment avec son calcul de ratio."""
        img_path = self.image_paths[index]
        img = cv2.imread(str(img_path))
        if img is None:
            raise FileNotFoundError(f"image illisible : {img_path}")
        h, w = img.shape[:2]
        target = self._load_target(index, w, h)
        img_info = (h, w)
        return img, target, img_info, np.array([index])

    def load_anno(self, index: int) -> np.ndarray:
        """Contrat requis par MosaicDetection.mixup() (yolox/data/datasets/
        mosaicdetection.py) : boucle sur des candidats jusqu'a en trouver un
        avec au moins une annotation. Pas de cache d'annotations separe ici
        (contrairement a COCODataset) donc repasse par pull_item -- le cout
        (relecture image) est marginal, mixup ne tire qu'un candidat par appel."""
        _, target, _, _ = self.pull_item(index)
        return target

    @Dataset.mosaic_getitem
    def __getitem__(self, index: int):
        img, target, img_info, img_id = self.pull_item(index)
        if self.preproc is not None:
            img, target = self.preproc(img, target, self.input_dim)
        return img, target, img_info, img_id
