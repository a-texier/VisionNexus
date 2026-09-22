"""Detector adapter used by Inference_App when this optional plugin exists."""

from __future__ import annotations


class UltralyticsDetector:
    def __init__(
        self,
        *,
        model_path: str,
        model_size: str = "",
        class_names: list[str] | None = None,
        confidence: float = 0.25,
        iou: float = 0.45,
        imgsz: int = 640,
        device: str = "",
    ) -> None:
        from ultralytics import YOLO

        self._model = YOLO(model_path)
        self._confidence = confidence
        self._iou = iou
        self._imgsz = imgsz
        self._device = device or None
        names = class_names or self._model.names
        if isinstance(names, dict):
            self.class_names = [str(names[key]) for key in sorted(names, key=int)]
        else:
            self.class_names = [str(name) for name in names]

    def predict(self, frame) -> list[tuple[float, float, float, float, float, int, str]]:
        result = self._model.predict(
            source=frame,
            conf=self._confidence,
            iou=self._iou,
            imgsz=self._imgsz,
            device=self._device,
            verbose=False,
        )[0]
        if result.boxes is None:
            return []
        boxes = result.boxes.xyxy.detach().cpu().numpy()
        scores = result.boxes.conf.detach().cpu().numpy()
        classes = result.boxes.cls.detach().cpu().numpy().astype(int)
        return [
            (
                float(box[0]), float(box[1]), float(box[2]), float(box[3]),
                float(score), int(class_id), self.class_names[int(class_id)],
            )
            for box, score, class_id in zip(boxes, scores, classes)
        ]
