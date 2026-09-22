from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Iterator

IMAGE_EXTENSIONS = {".bmp", ".jpeg", ".jpg", ".png", ".tif", ".tiff", ".webp"}
VIDEO_EXTENSIONS = {".avi", ".m4v", ".mkv", ".mov", ".mp4", ".webm"}
SUPPORTED_EXTENSIONS = IMAGE_EXTENSIONS | VIDEO_EXTENSIONS


def _cv2():
    try:
        import cv2
    except ImportError as exc:
        raise RuntimeError("OpenCV est requis pour lire les images et videos") from exc
    return cv2


@dataclass(slots=True)
class MediaInfo:
    source: str
    kind: str
    width: int
    height: int
    frames: int
    fps: float

    def to_dict(self) -> dict:
        return {
            "source": self.source,
            "kind": self.kind,
            "width": self.width,
            "height": self.height,
            "frames": self.frames,
            "fps": self.fps,
        }


def media_files(source: str | Path) -> list[Path]:
    path = Path(source).expanduser().resolve()
    if path.is_file():
        if path.suffix.lower() not in SUPPORTED_EXTENSIONS:
            raise ValueError(f"format non pris en charge : {path.suffix or '(sans extension)'}")
        return [path]
    if path.is_dir():
        files = sorted(p for p in path.iterdir() if p.is_file() and p.suffix.lower() in IMAGE_EXTENSIONS)
        if not files:
            raise ValueError("le dossier ne contient aucune image prise en charge")
        return files
    raise FileNotFoundError(f"source introuvable : {path}")


def inspect_media(source: str | Path) -> MediaInfo:
    cv2 = _cv2()
    files = media_files(source)
    first = files[0]
    if len(files) > 1 or first.suffix.lower() in IMAGE_EXTENSIONS:
        image = cv2.imread(str(first), cv2.IMREAD_COLOR)
        if image is None:
            raise ValueError(f"image illisible : {first}")
        height, width = image.shape[:2]
        return MediaInfo(str(Path(source).resolve()), "images", width, height, len(files), 1.0)
    capture = cv2.VideoCapture(str(first))
    if not capture.isOpened():
        raise ValueError(f"video illisible : {first}")
    try:
        width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
        frames = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
        fps = float(capture.get(cv2.CAP_PROP_FPS)) or 25.0
    finally:
        capture.release()
    return MediaInfo(str(first), "video", width, height, frames, fps)


def iter_frames(source: str | Path) -> Iterator[tuple[int, object]]:
    cv2 = _cv2()
    files = media_files(source)
    first = files[0]
    if len(files) > 1 or first.suffix.lower() in IMAGE_EXTENSIONS:
        for index, path in enumerate(files):
            frame = cv2.imread(str(path), cv2.IMREAD_COLOR)
            if frame is None:
                raise ValueError(f"image illisible : {path}")
            yield index, frame
        return

    capture = cv2.VideoCapture(str(first))
    if not capture.isOpened():
        raise ValueError(f"video illisible : {first}")
    index = 0
    try:
        while True:
            ok, frame = capture.read()
            if not ok:
                break
            yield index, frame
            index += 1
    finally:
        capture.release()


def read_frame(source: str | Path, frame_index: int = 0):
    for index, frame in iter_frames(source):
        if index == max(0, frame_index):
            return frame
    raise ValueError(f"frame {frame_index} introuvable")

