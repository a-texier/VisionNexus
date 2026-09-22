from pathlib import Path

import cv2
import numpy as np

from backend.inference_core import evaluation
from backend.inference_core.models import Detection


class PerfectDetector:
    class_names = ["object"]

    def predict(self, _frame):
        return [Detection(25, 25, 75, 75, 0.99, 0, "object")]


def test_perfect_prediction_produces_metrics_and_plots(tmp_path: Path, monkeypatch):
    images = tmp_path / "dataset" / "images" / "val"
    labels = tmp_path / "dataset" / "labels" / "val"
    images.mkdir(parents=True)
    labels.mkdir(parents=True)
    cv2.imwrite(str(images / "sample.jpg"), np.zeros((100, 100, 3), dtype=np.uint8))
    (labels / "sample.txt").write_text("0 0.5 0.5 0.5 0.5\n", encoding="utf-8")
    data_yaml = tmp_path / "dataset" / "data.yaml"
    data_yaml.write_text("path: .\nval: images/val\nnames: [object]\n", encoding="utf-8")
    monkeypatch.setattr(evaluation, "create_detector", lambda *_args, **_kwargs: PerfectDetector())

    result = evaluation.evaluate_detection(
        data_yaml=str(data_yaml), split="val", model_path="unused.pt", engine="fake",
        model_size="", confidence=0.001, iou=0.6, imgsz=640, device="",
        run_dir=tmp_path / "run",
    )

    assert result["metrics"]["map50"] == 1.0
    assert result["metrics"]["map50_95"] == 1.0
    for name in ("metrics.json", "pr_curve.png", "f1_curve.png", "confusion_matrix.png"):
        assert (tmp_path / "run" / name).is_file()


def test_micro_curve_does_not_match_a_prediction_to_another_class():
    predictions = [(0, 0.9, (0, 0, 10, 10))]
    ground_truth = {0: [(0, 0, 10, 10)]}
    ap, *_ = evaluation._score_class(predictions, ground_truth, 0.5)
    assert ap == 1.0

    # The aggregate key contains both image and class. A prediction for class
    # 1 must not match the same box annotated as class 0.
    wrong_class_predictions = [(1, 0.9, (0, 0, 10, 10))]
    ap, *_ = evaluation._score_class(wrong_class_predictions, ground_truth, 0.5)
    assert ap == 0.0
