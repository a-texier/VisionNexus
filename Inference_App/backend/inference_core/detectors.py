from __future__ import annotations

import sys
from pathlib import Path
from typing import Protocol

from .models import Detection

PLUGIN_GROUP = "visionnexus.detector_backends"


class Detector(Protocol):
    class_names: list[str]

    def predict(self, frame) -> list[Detection]: ...


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


class YoloxDetector:
    def __init__(
        self,
        *,
        model_path: str,
        model_size: str,
        class_names: list[str],
        confidence: float,
        iou: float,
        imgsz: int,
        device: str = "",
    ) -> None:
        import torch

        root = _repo_root()
        training_backend = root / "Training_App" / "backend"
        if str(root) not in sys.path:
            sys.path.insert(0, str(root))
        if str(training_backend) not in sys.path:
            sys.path.insert(0, str(training_backend))
        from services.yolox_model import build_exp, load_checkpoint
        from yolox.data.data_augment import preproc
        from yolox.utils import postprocess

        checkpoint = torch.load(model_path, map_location="cpu", weights_only=True)
        state = checkpoint.get("model", checkpoint) if isinstance(checkpoint, dict) else checkpoint
        inferred_classes = self._infer_num_classes(state)
        if not class_names:
            class_names = [f"class_{index}" for index in range(inferred_classes)]
        if len(class_names) != inferred_classes:
            raise ValueError(
                f"le checkpoint YOLOX contient {inferred_classes} classes, "
                f"mais {len(class_names)} noms ont ete fournis"
            )
        exp = build_exp(model_size or "yolox-s", img_size=imgsz, num_classes=inferred_classes)
        exp.test_conf = confidence
        exp.nmsthre = iou
        model = exp.get_model()
        load_checkpoint(model, model_path)
        selected_device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        self._torch = torch
        self._model = model.to(selected_device).eval()
        self._device = selected_device
        self._exp = exp
        self._preproc = preproc
        self._postprocess = postprocess
        self.class_names = class_names

    @staticmethod
    def _infer_num_classes(state: dict) -> int:
        for key, value in state.items():
            if "head.cls_preds" in key and key.endswith("weight") and hasattr(value, "shape"):
                return int(value.shape[0])
        raise ValueError("nombre de classes YOLOX impossible a lire dans le checkpoint")

    def predict(self, frame) -> list[Detection]:
        image, ratio = self._preproc(frame, self._exp.test_size)
        tensor = self._torch.from_numpy(image).unsqueeze(0).float().to(self._device)
        with self._torch.no_grad():
            raw = self._model(tensor)
        output = self._postprocess(
            raw, self._exp.num_classes, self._exp.test_conf, self._exp.nmsthre
        )[0]
        if output is None:
            return []
        detections = []
        for x1, y1, x2, y2, objectness, class_confidence, class_id in output.detach().cpu().numpy():
            class_index = int(class_id)
            detections.append(
                Detection(
                    float(x1 / ratio),
                    float(y1 / ratio),
                    float(x2 / ratio),
                    float(y2 / ratio),
                    float(objectness * class_confidence),
                    class_index,
                    self.class_names[class_index],
                )
            )
        return detections


def _plugin_registry():
    root = _repo_root()
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))
    try:
        from _lib import plugin_registry
    except ImportError:
        return None
    return plugin_registry


def detector_capabilities() -> list[dict]:
    result = [{"name": "yolox", "label": "YOLOX", "available": True, "plugin": None, "reason": None}]
    registry = _plugin_registry()
    if registry:
        result.extend(registry.describe(PLUGIN_GROUP))
    return result


def create_detector(engine: str, **kwargs) -> Detector:
    normalized = (engine or "yolox").strip().lower()
    if normalized == "yolox":
        return YoloxDetector(**kwargs)
    registry = _plugin_registry()
    detector_class = registry.load_extension(PLUGIN_GROUP, normalized) if registry else None
    if detector_class is None:
        raise ValueError(f"moteur de detection inconnu : {normalized}")
    plugin_detector = detector_class(**kwargs)

    class Adapter:
        class_names = list(getattr(plugin_detector, "class_names", []))

        def predict(self, frame) -> list[Detection]:
            output = plugin_detector.predict(frame)
            return [item if isinstance(item, Detection) else Detection(*item) for item in output]

    return Adapter()

