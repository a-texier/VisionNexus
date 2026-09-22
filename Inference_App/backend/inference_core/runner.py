from __future__ import annotations

import json
import re
import time
import uuid
from dataclasses import asdict
from datetime import datetime
from pathlib import Path

from .bytetrack import ByteTracker
from .detectors import create_detector
from .media import IMAGE_EXTENSIONS, inspect_media, iter_frames
from .models import Detection, RunOptions, Track


def _cv2():
    import cv2
    return cv2


def _safe_name(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9_.-]+", "_", value.strip()).strip("._")
    return cleaned[:80] or datetime.now().strftime("run_%Y%m%d_%H%M%S")


def _colour(class_id: int) -> tuple[int, int, int]:
    return ((37 * (class_id + 1)) % 190 + 50, (83 * (class_id + 1)) % 190 + 50, (151 * (class_id + 1)) % 190 + 50)


def _draw(frame, detections: list[Detection], *, sot: bool = False, tracks: list[Track] | None = None):
    cv2 = _cv2()
    rendered = frame.copy()
    rows = [(track.detection, track.track_id) for track in tracks] if tracks is not None else [(d, None) for d in detections]
    for detection, track_id in rows:
        colour = (0, 215, 255) if sot else _colour(detection.class_id)
        x1, y1, x2, y2 = map(int, detection.box)
        cv2.rectangle(rendered, (x1, y1), (x2, y2), colour, 2)
        prefix = f"#{track_id} " if track_id is not None else ""
        text = f"{prefix}{detection.label} {detection.score:.2f}" if not sot else f"SOT · {detection.label}"
        cv2.putText(rendered, text, (x1, max(18, y1 - 6)), cv2.FONT_HERSHEY_SIMPLEX, 0.55, colour, 2)
    return rendered


def _select_detection(detections: list[Detection], x: float, y: float) -> Detection | None:
    candidates = [detection for detection in detections if detection.contains(x, y)]
    if not candidates:
        return None
    return max(candidates, key=lambda detection: detection.score)


def _create_csrt():
    cv2 = _cv2()
    factory = getattr(cv2, "TrackerCSRT_create", None)
    if factory is None and hasattr(cv2, "legacy"):
        factory = getattr(cv2.legacy, "TrackerCSRT_create", None)
    if factory is None:
        raise RuntimeError("CSRT indisponible : installez opencv-contrib-python")
    return factory()


def run_inference(options: RunOptions, runs_dir: str | Path) -> dict:
    options.validate()
    started = time.perf_counter()
    media = inspect_media(options.source)
    detector = create_detector(
        options.engine,
        model_path=options.model_path,
        model_size=options.model_size,
        class_names=options.class_names,
        confidence=options.confidence,
        iou=options.iou,
        imgsz=options.imgsz,
        device=options.device,
    )
    byte_tracker = ByteTracker(
        high_thresh=options.track_high_thresh,
        low_thresh=options.track_low_thresh,
        new_track_thresh=options.new_track_thresh,
        match_thresh=options.match_thresh,
        buffer_size=options.track_buffer,
    ) if options.mode == "mot" and options.tracker == "bytetrack" else None
    run_name = _safe_name(options.run_name or datetime.now().strftime("run_%Y%m%d_%H%M%S_%f"))
    run_dir = Path(runs_dir).resolve() / run_name
    if run_dir.exists():
        run_name = f"{run_name}_{uuid.uuid4().hex[:8]}"
        run_dir = Path(runs_dir).resolve() / run_name
    run_dir.mkdir(parents=True, exist_ok=False)

    cv2 = _cv2()
    output_path: Path | None = None
    writer = None
    csrt = None
    sot_label = "object"
    processed = 0
    detection_count = 0
    track_ids: set[int] = set()
    detector_seconds = 0.0
    tracker_seconds = 0.0
    last_detections: list[Detection] = []

    try:
        for frame_index, frame in iter_frames(options.source):
            if options.max_frames and processed >= options.max_frames:
                break
            if options.mode == "sot" and csrt is not None:
                ok, box = csrt.update(frame)
                if ok:
                    x, y, width, height = map(float, box)
                    detections = [Detection(x, y, x + width, y + height, 1.0, -1, sot_label)]
                else:
                    detections = []
            else:
                detector_started = time.perf_counter()
                detections = detector.predict(frame)
                detector_seconds += time.perf_counter() - detector_started
                detection_count += len(detections)
            if options.mode == "sot" and csrt is None:
                click_x = float(options.click_x) * frame.shape[1]
                click_y = float(options.click_y) * frame.shape[0]
                selected = _select_detection(detections, click_x, click_y)
                if selected is None:
                    raise ValueError("le clic SOT ne touche aucune detection sur la premiere frame")
                sot_label = selected.label
                csrt = _create_csrt()
                x1, y1, x2, y2 = selected.box
                csrt.init(frame, (int(x1), int(y1), int(x2 - x1), int(y2 - y1)))
                detections = [selected]
            tracks = None
            if byte_tracker is not None:
                tracker_started = time.perf_counter()
                tracks = byte_tracker.update(detections)
                tracker_seconds += time.perf_counter() - tracker_started
                track_ids.update(track.track_id for track in tracks)
                last_detections = [track.detection for track in tracks]
            else:
                last_detections = detections
            rendered = _draw(frame, last_detections, sot=options.mode == "sot", tracks=tracks)

            if options.save_output:
                if media.kind == "video" or media.frames > 1:
                    if writer is None:
                        output_path = run_dir / "result.mp4"
                        writer = cv2.VideoWriter(
                            str(output_path),
                            cv2.VideoWriter_fourcc(*"mp4v"),
                            max(media.fps, 1.0),
                            (frame.shape[1], frame.shape[0]),
                        )
                        if not writer.isOpened():
                            raise RuntimeError("impossible de creer la video MP4 de sortie")
                    writer.write(rendered)
                else:
                    extension = Path(options.source).suffix.lower()
                    extension = extension if extension in IMAGE_EXTENSIONS else ".jpg"
                    output_path = run_dir / f"result{extension}"
                    if not cv2.imwrite(str(output_path), rendered):
                        raise RuntimeError("impossible d'ecrire l'image de sortie")
            processed += 1
    finally:
        if writer is not None:
            writer.release()

    duration = time.perf_counter() - started
    result = {
        "status": "done",
        "run_name": run_name,
        "run_dir": str(run_dir),
        "output_path": str(output_path) if output_path else None,
        "mode": options.mode,
        "tracker": options.tracker,
        "engine": options.engine,
        "frames": processed,
        "detections": detection_count,
        "objects_last_frame": len(last_detections),
        "unique_tracks": len(track_ids),
        "fps": processed / duration if duration else 0.0,
        "detector_fps": processed / detector_seconds if detector_seconds else 0.0,
        "detector_ms_per_frame": 1000.0 * detector_seconds / processed if processed else 0.0,
        "tracker_ms_per_frame": 1000.0 * tracker_seconds / processed if processed else 0.0,
        "duration_s": duration,
        "last_detections": [detection.to_dict() for detection in last_detections],
    }
    (run_dir / "result.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    (run_dir / "request.json").write_text(json.dumps(asdict(options), indent=2), encoding="utf-8")
    return result
