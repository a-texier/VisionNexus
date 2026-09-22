# ============================================================
# yolox_plots.py -- previews dataset/augmentation, parite avec la galerie
# Ultralytics au-dela de ce que detection_metrics.py couvre deja
# (confusion matrix, PR/P/R/F1 curves) :
#   - labels.jpg           : histogramme des classes + nuage largeur/hauteur
#                             des boites (verite terrain brute, pre-augmentation)
#   - train_batchN.jpg     : grille d'images telles que vues par le reseau
#                             (mosaic/mixup/HSV/flip deja appliques)
#   - val_batch0_labels.jpg: echantillon d'images de validation, boites verite
#                             terrain (equivalent val_batch0_labels.jpg Ultralytics)
#   - val_batch0_pred.jpg  : memes images, boites predites par le modele courant
#                             (equivalent val_batch0_pred.jpg Ultralytics) --
#                             controle visuel rapide train/val d'un coup d'oeil
# ============================================================

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING

import cv2
import numpy as np

if TYPE_CHECKING:
    from .detection_metrics import Detection, GroundTruth


def _dataset_label_stats(base_dataset) -> tuple[list[int], list[tuple[float, float]]]:
    """Parcourt un YoloTxtDataset (non wrappe) et retourne (class_ids, (w,h)_normalises)."""
    class_ids: list[int] = []
    sizes: list[tuple[float, float]] = []
    for idx in range(len(base_dataset)):
        _, target, img_info, _ = base_dataset.pull_item(idx)
        h, w = img_info
        for x1, y1, x2, y2, cls in target:
            class_ids.append(int(cls))
            if w > 0 and h > 0:
                sizes.append(((x2 - x1) / w, (y2 - y1) / h))
    return class_ids, sizes


def save_labels_plot(base_dataset, class_names: list[str], out_path: Path) -> Path:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    class_ids, sizes = _dataset_label_stats(base_dataset)

    fig, axes = plt.subplots(1, 2, figsize=(11, 5))

    counts = np.zeros(len(class_names), dtype=np.int64)
    for c in class_ids:
        if 0 <= c < len(class_names):
            counts[c] += 1
    axes[0].bar(range(len(class_names)), counts, color="steelblue")
    axes[0].set_xticks(range(len(class_names)))
    axes[0].set_xticklabels(class_names, rotation=45, ha="right", fontsize=7)
    axes[0].set_ylabel("Instances")
    axes[0].set_title(f"Distribution des classes ({len(class_ids)} boites)")

    if sizes:
        ws, hs = zip(*sizes, strict=True)
        axes[1].scatter(ws, hs, s=6, alpha=0.4, color="darkorange")
    axes[1].set_xlim(0, 1)
    axes[1].set_ylim(0, 1)
    axes[1].set_xlabel("largeur (normalisee)")
    axes[1].set_ylabel("hauteur (normalisee)")
    axes[1].set_title("Tailles des boites")

    fig.tight_layout()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out_path, dpi=150)
    plt.close(fig)
    return out_path


def _chw_float_to_bgr_uint8(img_chw: np.ndarray) -> np.ndarray:
    """Image telle que produite par TrainTransform (C,H,W float32, pixels
    0-255 non normalises -- cf. detector_mot.py / convention YOLOX >= 0.3.0)
    -> image affichable (H,W,C uint8)."""
    img = np.clip(img_chw, 0, 255).astype(np.uint8)
    return np.ascontiguousarray(img.transpose(1, 2, 0))


def save_train_batch_plot(
    wrapped_dataset, class_names: list[str], out_path: Path, n_samples: int = 16
) -> Path:
    """Echantillonne n_samples elements DEPUIS le dataset wrappe (mosaic/mixup/
    HSV/flip deja appliques par TrainTransform) et les assemble en grille --
    equivalent de train_batch0.jpg d'Ultralytics."""
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    n = min(n_samples, len(wrapped_dataset))
    cols = 4
    rows = (n + cols - 1) // cols
    fig, axes = plt.subplots(rows, cols, figsize=(cols * 3, rows * 3))
    axes_flat = np.atleast_1d(axes).ravel()

    for i in range(n):
        img_chw, target, _, _ = wrapped_dataset[i]
        img = _chw_float_to_bgr_uint8(img_chw)
        img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        ax = axes_flat[i]
        ax.imshow(img_rgb)
        for row in target:
            cls, cx, cy, w, h = row
            if w <= 0 or h <= 0:
                continue
            x1, y1 = cx - w / 2, cy - h / 2
            rect = plt.Rectangle(
                (x1, y1), w, h, fill=False, edgecolor="lime", linewidth=1
            )
            ax.add_patch(rect)
            label = (
                class_names[int(cls)]
                if 0 <= int(cls) < len(class_names)
                else str(int(cls))
            )
            ax.text(x1, max(y1 - 2, 0), label, color="lime", fontsize=6)
        ax.axis("off")
    for j in range(n, len(axes_flat)):
        axes_flat[j].axis("off")

    fig.suptitle("Apercu batch d'entrainement (mosaic/mixup/augmentations appliques)")
    fig.tight_layout()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out_path, dpi=120)
    plt.close(fig)
    return out_path


def save_dataset_preview_plots(
    wrapped_dataset, class_names: list[str], out_dir: Path
) -> list[Path]:
    """Genere labels.jpg + train_batch0.jpg dans out_dir. wrapped_dataset est
    le dataset MosaicDetection tel qu'utilise par le Trainer (expose
    ._dataset = le YoloTxtDataset sous-jacent, non augmente)."""
    base_dataset = getattr(wrapped_dataset, "_dataset", wrapped_dataset)
    produced = [
        save_labels_plot(base_dataset, class_names, out_dir / "labels.jpg"),
        save_train_batch_plot(
            wrapped_dataset, class_names, out_dir / "train_batch0.jpg"
        ),
    ]
    return produced


def _draw_boxes(
    img_bgr: np.ndarray,
    boxes: list[tuple[float, float, float, float]],
    labels: list[str],
    color: tuple[int, int, int],
) -> np.ndarray:
    """Dessine des boites xyxy (coord. pixel image d'origine) + labels texte."""
    img = img_bgr.copy()
    for (x1, y1, x2, y2), label in zip(boxes, labels, strict=True):
        p1, p2 = (int(x1), int(y1)), (int(x2), int(y2))
        cv2.rectangle(img, p1, p2, color, 2)
        cv2.putText(
            img, label, (p1[0], max(p1[1] - 4, 0)),
            cv2.FONT_HERSHEY_SIMPLEX, 0.4, color, 1, cv2.LINE_AA,
        )
    return img


def _save_image_grid(
    images_rgb: list[np.ndarray], out_path: Path, title: str, cols: int = 4
) -> Path:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    n = len(images_rgb)
    rows = (n + cols - 1) // cols
    fig, axes = plt.subplots(rows, cols, figsize=(cols * 3, rows * 3))
    axes_flat = np.atleast_1d(axes).ravel()
    for i, img in enumerate(images_rgb):
        axes_flat[i].imshow(img)
        axes_flat[i].axis("off")
    for j in range(n, len(axes_flat)):
        axes_flat[j].axis("off")
    fig.suptitle(title)
    fig.tight_layout()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out_path, dpi=120)
    plt.close(fig)
    return out_path


def save_val_batch_plots(
    samples: "list[tuple[np.ndarray, list[GroundTruth], list[Detection]]]",
    class_names: list[str],
    out_dir: Path,
    n_samples: int = 16,
) -> list[Path]:
    """
    Genere val_batch0_labels.jpg (verite terrain) et val_batch0_pred.jpg
    (predictions du modele courant) a partir d'un echantillon d'images de
    validation -- equivalent des deux galeries Ultralytics du meme nom, pour
    un controle visuel rapide train/val d'un coup d'oeil.

    `samples` : (img_bgr, gts, preds) par image, memes GroundTruth/Detection
    que detection_metrics.py, boites en coordonnees pixel de l'image
    d'origine (convention de yolox_trainer._run_validation). Retourne une
    liste vide si `samples` est vide (ex. dataset de validation vide).
    """
    picked = samples[:n_samples]
    if not picked:
        return []

    def _label_name(cls_id: int) -> str:
        return class_names[cls_id] if 0 <= cls_id < len(class_names) else str(cls_id)

    gt_images: list[np.ndarray] = []
    pred_images: list[np.ndarray] = []
    for img_bgr, gts, preds in picked:
        gt_img = _draw_boxes(
            img_bgr, [g.box for g in gts], [_label_name(g.cls_id) for g in gts], (0, 255, 0)
        )
        pred_img = _draw_boxes(
            img_bgr,
            [p.box for p in preds],
            [f"{_label_name(p.cls_id)} {p.conf:.2f}" for p in preds],
            (0, 165, 255),
        )
        gt_images.append(cv2.cvtColor(gt_img, cv2.COLOR_BGR2RGB))
        pred_images.append(cv2.cvtColor(pred_img, cv2.COLOR_BGR2RGB))

    return [
        _save_image_grid(gt_images, out_dir / "val_batch0_labels.jpg", "Validation -- verite terrain"),
        _save_image_grid(pred_images, out_dir / "val_batch0_pred.jpg", "Validation -- predictions du modele"),
    ]
