# ============================================================
# detection_metrics.py -- moteur mAP maison (sans ultralytics/pycocotools),
# utilise par yolox_trainer.py pour l'evaluation periodique pendant
# l'entrainement (evaluate_and_save_model). Inference_App a sa propre
# evaluation (inference_core/evaluation.py), aux conventions differentes.
#
# Calcule mAP50 / mAP50-95 / precision / recall / F1 + les 5 plots
# classiques (confusion_matrix, PR_curve, P_curve, R_curve, F1_curve) avec
# numpy/matplotlib uniquement.
#
# Algorithme mAP : AP COCO standard (interpolation 101 points), moyenne sur
# les seuils IoU 0.50:0.05:0.95 pour mAP50-95. Matching glouton pred<->GT
# trie par confiance decroissante, comme pycocotools/Ultralytics.
# ============================================================

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np

Box = tuple[float, float, float, float]  # x1, y1, x2, y2


@dataclass
class Detection:
    box: Box
    conf: float
    cls_id: int


@dataclass
class GroundTruth:
    box: Box
    cls_id: int


IOU_THRESHOLDS = np.round(np.arange(0.50, 1.00, 0.05), 2)  # 0.50 .. 0.95


# ------------------------------------------------------------------ #
# Geometrie                                                            #
# ------------------------------------------------------------------ #


def _iou_matrix(pred_boxes: np.ndarray, gt_boxes: np.ndarray) -> np.ndarray:
    """IoU vectorise entre N boites pred et M boites GT (xyxy) -> matrice [N, M]."""
    if len(pred_boxes) == 0 or len(gt_boxes) == 0:
        return np.zeros((len(pred_boxes), len(gt_boxes)), dtype=np.float32)
    px1, py1, px2, py2 = (
        pred_boxes[:, 0:1],
        pred_boxes[:, 1:2],
        pred_boxes[:, 2:3],
        pred_boxes[:, 3:4],
    )
    gx1, gy1, gx2, gy2 = gt_boxes[:, 0], gt_boxes[:, 1], gt_boxes[:, 2], gt_boxes[:, 3]

    ix1 = np.maximum(px1, gx1)
    iy1 = np.maximum(py1, gy1)
    ix2 = np.minimum(px2, gx2)
    iy2 = np.minimum(py2, gy2)
    inter = np.clip(ix2 - ix1, 0, None) * np.clip(iy2 - iy1, 0, None)

    area_p = np.clip(px2 - px1, 0, None) * np.clip(py2 - py1, 0, None)
    area_g = np.clip(gx2 - gx1, 0, None) * np.clip(gy2 - gy1, 0, None)
    union = area_p + area_g - inter
    return np.where(union > 0, inter / union, 0.0).astype(np.float32)


def _ap_101point(recall: np.ndarray, precision: np.ndarray) -> float:
    """AP COCO standard : moyenne de la precision (enveloppe monotone) a 101 seuils
    de rappel (0, 0.01, ..., 1.00). Meme algorithme que pycocotools.accumulate() :
    searchsorted sur le rappel brut, pas d'interpolation lineaire (evite l'artefact
    de np.interp quand le rappel atteint exactement 1.0 en plusieurs points)."""
    if len(recall) == 0:
        return 0.0
    envelope = np.maximum.accumulate(precision[::-1])[::-1]
    recall_points = np.linspace(0, 1, 101)
    inds = np.searchsorted(recall, recall_points, side="left")
    q = np.zeros(101, dtype=np.float64)
    valid = inds < len(envelope)
    q[valid] = envelope[inds[valid]]
    return float(q.mean())


# ------------------------------------------------------------------ #
# Coeur du calcul mAP                                                  #
# ------------------------------------------------------------------ #


@dataclass
class ClassCurve:
    """Precision/recall/F1 vs confiance (IoU=0.5), pour les plots P/R/F1/PR."""

    cls_id: int
    conf_grid: np.ndarray
    precision: np.ndarray
    recall: np.ndarray
    ap50: float


@dataclass
class EvalResult:
    map50: float
    map50_95: float
    mean_precision: float
    mean_recall: float
    per_class_ap50: dict[int, float]
    curves: list[ClassCurve]
    confusion: (
        np.ndarray
    )  # [n_classes+1, n_classes+1], derniere ligne/colonne = background


def _match_class(
    preds: list[tuple[int, Detection]],  # (image_idx, Detection)
    gts_by_image: dict[int, list[GroundTruth]],
    cls_id: int,
    iou_thresh: float,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, int]:
    """Matching glouton pour une classe/seuil IoU donnes.

    Retourne (tp, fp, conf) tries par confiance decroissante, + nb total de GT.
    """
    cls_preds = [(img_idx, d) for img_idx, d in preds if d.cls_id == cls_id]
    cls_preds.sort(key=lambda t: t[1].conf, reverse=True)

    gt_by_image: dict[int, np.ndarray] = {}
    matched_by_image: dict[int, np.ndarray] = {}
    n_gt_total = 0
    for img_idx, gts in gts_by_image.items():
        boxes = np.array([g.box for g in gts if g.cls_id == cls_id], dtype=np.float32)
        gt_by_image[img_idx] = boxes.reshape(-1, 4)
        matched_by_image[img_idx] = np.zeros(len(boxes), dtype=bool)
        n_gt_total += len(boxes)

    n = len(cls_preds)
    tp = np.zeros(n, dtype=np.float32)
    fp = np.zeros(n, dtype=np.float32)
    conf = np.zeros(n, dtype=np.float32)

    for i, (img_idx, det) in enumerate(cls_preds):
        conf[i] = det.conf
        gt_boxes = gt_by_image.get(img_idx, np.zeros((0, 4), dtype=np.float32))
        if gt_boxes.shape[0] == 0:
            fp[i] = 1.0
            continue
        ious = _iou_matrix(np.array([det.box], dtype=np.float32), gt_boxes)[0]
        best_j = int(np.argmax(ious))
        if ious[best_j] >= iou_thresh and not matched_by_image[img_idx][best_j]:
            tp[i] = 1.0
            matched_by_image[img_idx][best_j] = True
        else:
            fp[i] = 1.0

    return tp, fp, conf, n_gt_total


def compute_metrics(
    preds_by_image: list[list[Detection]],
    gts_by_image: list[list[GroundTruth]],
    class_names: list[str],
    conf_grid_size: int = 1000,
) -> EvalResult:
    """Calcule mAP50, mAP50-95, courbes P/R/F1 et matrice de confusion.

    preds_by_image / gts_by_image : listes paralleles indexees par image.
    """
    n_classes = len(class_names)
    gts_map = dict(enumerate(gts_by_image))
    preds_flat = [(i, d) for i, dets in enumerate(preds_by_image) for d in dets]

    ap50_per_class: dict[int, float] = {}
    ap_mean_per_class: dict[int, float] = {}
    curves: list[ClassCurve] = []
    conf_grid = np.linspace(0, 1, conf_grid_size)

    for cls_id in range(n_classes):
        n_gt = sum(1 for gts in gts_by_image for g in gts if g.cls_id == cls_id)
        aps_over_iou: list[float] = []
        tp50: np.ndarray | None = None
        fp50: np.ndarray | None = None
        conf50: np.ndarray | None = None

        for t in IOU_THRESHOLDS:
            tp, fp, conf, n_gt_t = _match_class(preds_flat, gts_map, cls_id, float(t))
            if n_gt_t == 0:
                continue
            cum_tp = np.cumsum(tp)
            cum_fp = np.cumsum(fp)
            recall = cum_tp / max(n_gt_t, 1)
            precision = cum_tp / np.maximum(cum_tp + cum_fp, 1e-9)
            aps_over_iou.append(_ap_101point(recall, precision))
            if abs(t - 0.5) < 1e-6:
                tp50, fp50, conf50 = tp, fp, conf

        if n_gt == 0:
            continue  # classe absente du GT -> exclue des moyennes (comme COCO/Ultralytics)
        ap50_per_class[cls_id] = aps_over_iou[0] if aps_over_iou else 0.0
        ap_mean_per_class[cls_id] = (
            float(np.mean(aps_over_iou)) if aps_over_iou else 0.0
        )

        if (
            tp50 is not None
            and fp50 is not None
            and conf50 is not None
            and len(conf50) > 0
        ):
            order = np.argsort(
                -conf50
            )  # confiance decroissante -> -conf croissant pour interp
            cum_tp = np.cumsum(tp50[order])
            cum_fp = np.cumsum(fp50[order])
            recall = cum_tp / max(n_gt, 1)
            precision = cum_tp / np.maximum(cum_tp + cum_fp, 1e-9)
            conf_sorted = conf50[order]
            prec_i = np.interp(
                -conf_grid, -conf_sorted, precision, left=1.0, right=precision[-1]
            )
            rec_i = np.interp(
                -conf_grid, -conf_sorted, recall, left=0.0, right=recall[-1]
            )
        else:
            prec_i = np.ones_like(conf_grid)
            rec_i = np.zeros_like(conf_grid)

        curves.append(
            ClassCurve(
                cls_id=cls_id,
                conf_grid=conf_grid,
                precision=prec_i,
                recall=rec_i,
                ap50=ap50_per_class[cls_id],
            )
        )

    map50 = float(np.mean(list(ap50_per_class.values()))) if ap50_per_class else 0.0
    map50_95 = (
        float(np.mean(list(ap_mean_per_class.values()))) if ap_mean_per_class else 0.0
    )
    mean_precision = (
        float(np.mean([c.precision.mean() for c in curves])) if curves else 0.0
    )
    mean_recall = float(np.mean([c.recall.mean() for c in curves])) if curves else 0.0

    confusion = _confusion_matrix(preds_by_image, gts_by_image, n_classes)

    return EvalResult(
        map50=map50,
        map50_95=map50_95,
        mean_precision=mean_precision,
        mean_recall=mean_recall,
        per_class_ap50=ap50_per_class,
        curves=curves,
        confusion=confusion,
    )


def _confusion_matrix(
    preds_by_image: list[list[Detection]],
    gts_by_image: list[list[GroundTruth]],
    n_classes: int,
    iou_thresh: float = 0.45,
    conf_thresh: float = 0.25,
) -> np.ndarray:
    """Matrice [n_classes+1, n_classes+1] ; derniere ligne/colonne = 'background'
    (ligne = detection manquee -> FN, colonne = fausse alerte -> FP)."""
    bg = n_classes
    matrix = np.zeros((n_classes + 1, n_classes + 1), dtype=np.int64)

    for dets, gts in zip(preds_by_image, gts_by_image, strict=True):
        kept = [d for d in dets if d.conf >= conf_thresh]
        if not gts and not kept:
            continue
        gt_boxes = np.array([g.box for g in gts], dtype=np.float32).reshape(-1, 4)
        pred_boxes = np.array([d.box for d in kept], dtype=np.float32).reshape(-1, 4)
        ious = _iou_matrix(pred_boxes, gt_boxes)  # [n_pred, n_gt]

        matched_gt = np.zeros(len(gts), dtype=bool)
        matched_pred = np.zeros(len(kept), dtype=bool)

        # Meilleurs appariements d'abord (glouton global sur la matrice IoU).
        pairs = [
            (ious[p, g], p, g)
            for p in range(len(kept))
            for g in range(len(gts))
            if ious[p, g] >= iou_thresh
        ]
        for _, p, g in sorted(pairs, key=lambda x: x[0], reverse=True):
            if matched_pred[p] or matched_gt[g]:
                continue
            matched_pred[p] = True
            matched_gt[g] = True
            matrix[kept[p].cls_id, gts[g].cls_id] += 1

        for g in range(len(gts)):
            if not matched_gt[g]:
                matrix[bg, gts[g].cls_id] += 1  # cible manquee (FN)
        for p in range(len(kept)):
            if not matched_pred[p]:
                matrix[kept[p].cls_id, bg] += 1  # fausse alerte (FP)

    return matrix


# ------------------------------------------------------------------ #
# Plots (remplacent les PNG generes par ultralytics model.val())      #
# ------------------------------------------------------------------ #


def save_plots(result: EvalResult, class_names: list[str], out_dir: Path) -> list[Path]:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    out_dir.mkdir(parents=True, exist_ok=True)
    produced: list[Path] = []

    def _finish(fig, name: str) -> None:
        path = out_dir / name
        fig.savefig(path, dpi=150, bbox_inches="tight")
        plt.close(fig)
        produced.append(path)

    # -- P / R / F1 curves --------------------------------------------------
    for metric_name, attr, fname in (
        ("Precision", "precision", "P_curve.png"),
        ("Recall", "recall", "R_curve.png"),
    ):
        fig, ax = plt.subplots(figsize=(7, 5))
        for c in result.curves:
            ax.plot(
                c.conf_grid, getattr(c, attr), linewidth=1, label=class_names[c.cls_id]
            )
        if result.curves:
            mean_curve = np.mean([getattr(c, attr) for c in result.curves], axis=0)
            ax.plot(
                result.curves[0].conf_grid,
                mean_curve,
                linewidth=3,
                color="blue",
                label="toutes classes",
            )
        ax.set_xlabel("Confiance")
        ax.set_ylabel(metric_name)
        ax.set_title(f"{metric_name}-Confidence Curve")
        ax.set_xlim(0, 1)
        ax.set_ylim(0, 1.05)
        ax.legend(
            loc="lower left" if attr == "precision" else "lower right", fontsize=7
        )
        _finish(fig, fname)

    # -- F1 curve -------------------------------------------------------
    fig, ax = plt.subplots(figsize=(7, 5))
    f1_curves = []
    for c in result.curves:
        f1 = 2 * c.precision * c.recall / np.maximum(c.precision + c.recall, 1e-9)
        f1_curves.append(f1)
        ax.plot(c.conf_grid, f1, linewidth=1, label=class_names[c.cls_id])
    if f1_curves:
        mean_f1 = np.mean(f1_curves, axis=0)
        ax.plot(
            result.curves[0].conf_grid,
            mean_f1,
            linewidth=3,
            color="blue",
            label="toutes classes",
        )
    ax.set_xlabel("Confiance")
    ax.set_ylabel("F1")
    ax.set_title("F1-Confidence Curve")
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1.05)
    ax.legend(loc="lower center", fontsize=7)
    _finish(fig, "F1_curve.png")

    # -- PR curve ---------------------------------------------------------
    fig, ax = plt.subplots(figsize=(7, 5))
    for c in result.curves:
        ax.plot(
            c.recall,
            c.precision,
            linewidth=1,
            label=f"{class_names[c.cls_id]} {c.ap50:.3f}",
        )
    ax.set_xlabel("Recall")
    ax.set_ylabel("Precision")
    ax.set_title(f"Precision-Recall Curve (mAP50={result.map50:.3f})")
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1.05)
    ax.legend(loc="lower left", fontsize=7)
    _finish(fig, "PR_curve.png")

    # -- Confusion matrix ---------------------------------------------------
    labels = class_names + ["background"]
    fig, ax = plt.subplots(
        figsize=(max(6, len(labels) * 0.6), max(5, len(labels) * 0.6))
    )
    norm = result.confusion / np.maximum(result.confusion.sum(axis=0, keepdims=True), 1)
    im = ax.imshow(norm, cmap="Blues", vmin=0, vmax=1)
    ax.set_xticks(range(len(labels)))
    ax.set_yticks(range(len(labels)))
    ax.set_xticklabels(labels, rotation=90, fontsize=7)
    ax.set_yticklabels(labels, fontsize=7)
    ax.set_xlabel("Ground Truth")
    ax.set_ylabel("Predicted")
    ax.set_title("Confusion Matrix (normalisee par colonne)")
    fig.colorbar(im, ax=ax, fraction=0.046, pad=0.04)
    _finish(fig, "confusion_matrix.png")

    return produced
