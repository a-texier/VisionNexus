from __future__ import annotations

import json
import time
from collections import defaultdict
from pathlib import Path

import numpy as np
import yaml

from .bytetrack import box_iou
from .detectors import create_detector
from .media import IMAGE_EXTENSIONS


def _dataset_images(data_yaml: str, split: str) -> tuple[list[Path], list[str]]:
    yaml_path = Path(data_yaml).expanduser().resolve()
    config = yaml.safe_load(yaml_path.read_text(encoding="utf-8")) or {}
    names_value = config.get("names", [])
    if isinstance(names_value, dict):
        names = [str(names_value[key]) for key in sorted(names_value, key=lambda key: int(key))]
    else:
        names = [str(name) for name in names_value]
    root_value = Path(str(config.get("path", ".")))
    root = root_value if root_value.is_absolute() else (yaml_path.parent / root_value).resolve()
    split_value = config.get(split)
    if not split_value:
        raise ValueError(f"split '{split}' absent de {yaml_path}")
    entries = split_value if isinstance(split_value, list) else [split_value]
    images: list[Path] = []
    for entry in entries:
        candidate = Path(str(entry))
        candidate = candidate if candidate.is_absolute() else (root / candidate).resolve()
        if candidate.is_dir():
            images.extend(
                path for path in sorted(candidate.rglob("*"))
                if path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS
            )
        elif candidate.is_file() and candidate.suffix.lower() == ".txt":
            for line in candidate.read_text(encoding="utf-8").splitlines():
                item = Path(line.strip())
                item = item if item.is_absolute() else (root / item).resolve()
                if item.suffix.lower() in IMAGE_EXTENSIONS:
                    images.append(item)
        elif candidate.is_file() and candidate.suffix.lower() in IMAGE_EXTENSIONS:
            images.append(candidate)
    if not images:
        raise ValueError(f"aucune image trouvee pour le split '{split}'")
    if not names:
        raise ValueError("la cle 'names' est absente du data.yaml")
    return images, names


def _label_path(image_path: Path) -> Path:
    parts = list(image_path.parts)
    indexes = [index for index, part in enumerate(parts) if part.lower() == "images"]
    if indexes:
        parts[indexes[-1]] = "labels"
        return Path(*parts).with_suffix(".txt")
    return image_path.parent.parent / "labels" / image_path.parent.name / f"{image_path.stem}.txt"


def _ground_truth(image_path: Path, width: int, height: int) -> list[tuple[int, tuple[float, float, float, float]]]:
    label_path = _label_path(image_path)
    if not label_path.is_file():
        return []
    output = []
    for raw in label_path.read_text(encoding="utf-8").splitlines():
        fields = raw.split()
        if len(fields) < 5:
            continue
        class_id, cx, cy, box_width, box_height = map(float, fields[:5])
        x1 = (cx - box_width / 2) * width
        y1 = (cy - box_height / 2) * height
        x2 = (cx + box_width / 2) * width
        y2 = (cy + box_height / 2) * height
        output.append((int(class_id), (x1, y1, x2, y2)))
    return output


def _average_precision(recall: np.ndarray, precision: np.ndarray) -> float:
    if recall.size == 0:
        return 0.0
    recall_points = np.linspace(0, 1, 101)
    values = [float(np.max(precision[recall >= point])) if np.any(recall >= point) else 0.0 for point in recall_points]
    return float(np.mean(values))


def _score_class(
    predictions: list[tuple[int, float, tuple[float, float, float, float]]],
    ground_truth: dict[int, list[tuple[float, float, float, float]]],
    threshold: float,
) -> tuple[float, np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    total_gt = sum(len(boxes) for boxes in ground_truth.values())
    matched: dict[int, set[int]] = defaultdict(set)
    truth_flags: list[float] = []
    false_flags: list[float] = []
    scores: list[float] = []
    for image_index, score, box in sorted(predictions, key=lambda item: item[1], reverse=True):
        scores.append(score)
        boxes = ground_truth.get(image_index, [])
        choices = [(box_iou(box, gt_box), index) for index, gt_box in enumerate(boxes) if index not in matched[image_index]]
        best = max(choices, default=(0.0, -1))
        if best[0] >= threshold:
            matched[image_index].add(best[1])
            truth_flags.append(1.0)
            false_flags.append(0.0)
        else:
            truth_flags.append(0.0)
            false_flags.append(1.0)
    tp = np.cumsum(np.asarray(truth_flags, dtype=float))
    fp = np.cumsum(np.asarray(false_flags, dtype=float))
    recall = tp / max(total_gt, 1)
    precision = tp / np.maximum(tp + fp, 1e-12)
    return _average_precision(recall, precision), recall, precision, np.asarray(scores), np.asarray(truth_flags)


def _save_plots(run_dir: Path, recall: np.ndarray, precision: np.ndarray, scores: np.ndarray, tp_flags: np.ndarray, total_gt: int, matrix: np.ndarray, names: list[str]) -> None:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    fig, axis = plt.subplots(figsize=(7, 5))
    axis.plot(recall, precision, color="#0891b2", linewidth=2)
    axis.set(xlabel="Recall", ylabel="Precision", title="Precision–Recall @ IoU 0.50", xlim=(0, 1), ylim=(0, 1))
    axis.grid(alpha=0.25)
    fig.tight_layout()
    fig.savefig(run_dir / "pr_curve.png", dpi=150)
    plt.close(fig)

    if scores.size:
        tp = np.cumsum(tp_flags)
        fp = np.cumsum(1.0 - tp_flags)
        p = tp / np.maximum(tp + fp, 1e-12)
        r = tp / max(total_gt, 1)
        f1 = 2 * p * r / np.maximum(p + r, 1e-12)
        fig, axis = plt.subplots(figsize=(7, 5))
        axis.plot(scores, f1, color="#7c3aed", linewidth=2)
        axis.set(xlabel="Confidence threshold", ylabel="F1", title="F1–confidence", xlim=(1, 0), ylim=(0, 1))
        axis.grid(alpha=0.25)
        fig.tight_layout()
        fig.savefig(run_dir / "f1_curve.png", dpi=150)
        plt.close(fig)

    fig, axis = plt.subplots(figsize=(7, 6))
    image = axis.imshow(matrix, cmap="Blues")
    labels = names + ["background"]
    if len(labels) <= 20:
        axis.set_xticks(range(len(labels)), labels, rotation=45, ha="right")
        axis.set_yticks(range(len(labels)), labels)
    axis.set(xlabel="Prediction", ylabel="Ground truth", title="Confusion matrix @ IoU 0.50")
    fig.colorbar(image, ax=axis)
    fig.tight_layout()
    fig.savefig(run_dir / "confusion_matrix.png", dpi=150)
    plt.close(fig)


def evaluate_detection(
    *,
    data_yaml: str,
    split: str,
    model_path: str,
    engine: str,
    model_size: str,
    confidence: float,
    iou: float,
    imgsz: int,
    device: str,
    run_dir: str | Path,
) -> dict:
    import cv2

    images, names = _dataset_images(data_yaml, split)
    detector = create_detector(
        engine,
        model_path=model_path,
        model_size=model_size,
        class_names=names,
        confidence=confidence,
        iou=iou,
        imgsz=imgsz,
        device=device,
    )
    target = Path(run_dir).resolve()
    target.mkdir(parents=True, exist_ok=False)
    predictions: dict[int, list[tuple[int, float, tuple[float, float, float, float]]]] = defaultdict(list)
    ground_truth: dict[int, dict[int, list[tuple[float, float, float, float]]]] = defaultdict(lambda: defaultdict(list))
    confusion = np.zeros((len(names) + 1, len(names) + 1), dtype=int)
    started = time.perf_counter()

    for image_index, image_path in enumerate(images):
        frame = cv2.imread(str(image_path), cv2.IMREAD_COLOR)
        if frame is None:
            raise ValueError(f"image illisible : {image_path}")
        height, width = frame.shape[:2]
        gt_rows = _ground_truth(image_path, width, height)
        detected = detector.predict(frame)
        for class_id, box in gt_rows:
            ground_truth[class_id][image_index].append(box)
        for detection in detected:
            predictions[detection.class_id].append((image_index, detection.score, detection.box))

        unmatched_gt = set(range(len(gt_rows)))
        unmatched_pred = set(range(len(detected)))
        pairs = []
        for gt_index, (gt_class, gt_box) in enumerate(gt_rows):
            for pred_index, detection in enumerate(detected):
                overlap = box_iou(gt_box, detection.box)
                if overlap >= 0.5:
                    pairs.append((overlap, gt_index, pred_index, gt_class, detection.class_id))
        for _overlap, gt_index, pred_index, gt_class, pred_class in sorted(pairs, reverse=True):
            if gt_index not in unmatched_gt or pred_index not in unmatched_pred:
                continue
            confusion[gt_class, pred_class] += 1
            unmatched_gt.remove(gt_index)
            unmatched_pred.remove(pred_index)
        for gt_index in unmatched_gt:
            confusion[gt_rows[gt_index][0], -1] += 1
        for pred_index in unmatched_pred:
            confusion[-1, detected[pred_index].class_id] += 1

    thresholds = np.arange(0.5, 0.96, 0.05)
    per_class = []
    aps_by_threshold = []
    aggregate_predictions = []
    aggregate_ground_truth: dict[int, list[tuple[float, float, float, float]]] = defaultdict(list)
    for class_id, name in enumerate(names):
        class_aps = []
        for threshold in thresholds:
            ap, *_ = _score_class(predictions[class_id], ground_truth[class_id], float(threshold))
            class_aps.append(ap)
        per_class.append({"class_id": class_id, "name": name, "ap50": class_aps[0], "ap50_95": float(np.mean(class_aps)), "ground_truth": sum(len(v) for v in ground_truth[class_id].values())})
        aps_by_threshold.append(class_aps)
        aggregate_predictions.extend(
            (image_index * len(names) + class_id, score, box)
            for image_index, score, box in predictions[class_id]
        )
        for image_index, boxes in ground_truth[class_id].items():
            aggregate_ground_truth[image_index * len(names) + class_id].extend(boxes)

    _ap, recall, precision, scores, tp_flags = _score_class(aggregate_predictions, aggregate_ground_truth, 0.5)
    total_gt = sum(len(boxes) for boxes in aggregate_ground_truth.values())
    duration = time.perf_counter() - started
    metrics = {
        "map50": float(np.mean([row[0] for row in aps_by_threshold])) if aps_by_threshold else 0.0,
        "map50_95": float(np.mean(aps_by_threshold)) if aps_by_threshold else 0.0,
        "images": len(images),
        "ground_truth": total_gt,
        "predictions": sum(len(rows) for rows in predictions.values()),
        "duration_s": duration,
        "fps": len(images) / duration if duration else 0.0,
        "per_class": per_class,
    }
    _save_plots(target, recall, precision, scores, tp_flags, total_gt, confusion, names)
    (target / "metrics.json").write_text(json.dumps(metrics, indent=2), encoding="utf-8")
    return {"status": "done", "run_dir": str(target), "metrics": metrics}
