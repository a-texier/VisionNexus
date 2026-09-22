from __future__ import annotations

from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Literal


@dataclass(slots=True)
class Detection:
    x1: float
    y1: float
    x2: float
    y2: float
    score: float
    class_id: int
    label: str = "object"

    @property
    def box(self) -> tuple[float, float, float, float]:
        return self.x1, self.y1, self.x2, self.y2

    def contains(self, x: float, y: float) -> bool:
        return self.x1 <= x <= self.x2 and self.y1 <= y <= self.y2

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass(slots=True)
class Track:
    track_id: int
    detection: Detection
    age: int = 1
    missed: int = 0

    def to_dict(self) -> dict:
        return {"track_id": self.track_id, "age": self.age, **self.detection.to_dict()}


@dataclass(slots=True)
class RunOptions:
    source: str
    model_path: str
    engine: str = "yolox"
    model_size: str = "yolox-s"
    mode: Literal["infer", "mot", "sot"] = "infer"
    tracker: Literal["none", "bytetrack"] = "none"
    click_x: float | None = None
    click_y: float | None = None
    confidence: float = 0.25
    iou: float = 0.45
    imgsz: int = 640
    device: str = ""
    class_names: list[str] = field(default_factory=list)
    track_high_thresh: float = 0.5
    track_low_thresh: float = 0.1
    new_track_thresh: float = 0.6
    match_thresh: float = 0.3
    track_buffer: int = 30
    save_output: bool = True
    max_frames: int = 0
    run_name: str = ""

    def validate(self) -> None:
        source = Path(self.source)
        model = Path(self.model_path)
        if not source.exists():
            raise FileNotFoundError(f"source introuvable : {source}")
        if not model.is_file():
            raise FileNotFoundError(f"poids introuvables : {model}")
        if self.mode == "sot" and (self.click_x is None or self.click_y is None):
            raise ValueError("le mode SOT requiert un clic (click_x, click_y)")
        if self.mode != "mot" and self.tracker != "none":
            raise ValueError("ByteTrack est une option du mode MOT uniquement")
        if not 0 <= self.confidence <= 1 or not 0 <= self.iou <= 1:
            raise ValueError("confidence et iou doivent etre compris entre 0 et 1")
        if self.max_frames < 0:
            raise ValueError("max_frames doit etre positif ou nul")
