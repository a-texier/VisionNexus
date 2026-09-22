from __future__ import annotations

import io
import os
import threading
import uuid
from dataclasses import asdict
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field

from backend.config import CORS_ORIGINS, CURRENT_USER, DEFAULT_CONFIG_FILE, RUNS_DIR, USER_CONFIG_FILE, WORKSPACE
from backend.inference_core.detectors import detector_capabilities
from backend.inference_core.evaluation import evaluate_detection
from backend.inference_core.media import inspect_media, read_frame
from backend.inference_core.models import RunOptions
from backend.inference_core.runner import run_inference

app = FastAPI(
    title="VisionNexus Inference App",
    description="Inference image/video with YOLOX, optional detector plugins, MOT and click-SOT.",
    version="2.0.0",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class InspectRequest(BaseModel):
    source: str


class ConfigRequest(BaseModel):
    yaml_text: str


@app.get("/api/config")
def get_config():
    import yaml
    source = USER_CONFIG_FILE if USER_CONFIG_FILE.is_file() else DEFAULT_CONFIG_FILE
    text = source.read_text(encoding="utf-8")
    return {"source": str(source), "yaml_text": text, "values": yaml.safe_load(text) or {}}


@app.put("/api/config")
def put_config(body: ConfigRequest):
    import yaml
    try:
        values = yaml.safe_load(body.yaml_text)
    except yaml.YAMLError as exc:
        raise HTTPException(400, f"YAML invalide : {exc}") from exc
    if not isinstance(values, dict):
        raise HTTPException(400, "la racine YAML doit etre un objet")
    USER_CONFIG_FILE.write_text(body.yaml_text, encoding="utf-8")
    return {"saved": True, "source": str(USER_CONFIG_FILE), "values": values}


class RunRequest(BaseModel):
    source: str
    model_path: str
    engine: str = "yolox"
    model_size: str = "yolox-s"
    mode: Literal["infer", "mot", "sot"] = "infer"
    tracker: Literal["none", "bytetrack"] = "none"
    click_x: float | None = Field(default=None, ge=0, le=1)
    click_y: float | None = Field(default=None, ge=0, le=1)
    confidence: float = Field(default=0.25, ge=0, le=1)
    iou: float = Field(default=0.45, ge=0, le=1)
    imgsz: int = Field(default=640, ge=32, le=4096)
    device: str = ""
    class_names: list[str] = Field(default_factory=list)
    track_high_thresh: float = Field(default=0.5, ge=0, le=1)
    track_low_thresh: float = Field(default=0.1, ge=0, le=1)
    new_track_thresh: float = Field(default=0.6, ge=0, le=1)
    match_thresh: float = Field(default=0.3, ge=0, le=1)
    track_buffer: int = Field(default=30, ge=0, le=1000)
    save_output: bool = True
    max_frames: int = Field(default=0, ge=0)
    run_name: str = ""

    def options(self) -> RunOptions:
        return RunOptions(**self.model_dump())


_jobs: dict[str, dict] = {}
_jobs_lock = threading.Lock()


def _set_job(job_id: str, value: dict) -> None:
    with _jobs_lock:
        _jobs[job_id] = value


def _run_job(job_id: str, options: RunOptions) -> None:
    try:
        result = run_inference(options, RUNS_DIR)
        _set_job(job_id, result)
    except Exception as exc:
        _set_job(job_id, {"status": "error", "error": f"{type(exc).__name__}: {exc}"})


@app.get("/health")
def health():
    return {"status": "ok", "app": "Inference_App", "version": "2.0.0"}


@app.get("/api/app-mode")
def app_mode():
    return {
        "mode": "orchestrator" if os.environ.get("LAUNCHED_BY_ORCHESTRATOR") else "solo",
        "workspace": str(WORKSPACE),
        "runs_dir": str(RUNS_DIR),
        "user": CURRENT_USER,
    }


@app.get("/api/capabilities")
def capabilities():
    return {
        "detectors": detector_capabilities(),
        "modes": ["infer", "mot", "sot"],
        "trackers": ["none", "bytetrack", "csrt"],
        "media": ["mp4", "avi", "mov", "mkv", "webm", "png", "jpg", "jpeg", "bmp", "tif", "webp"],
    }


@app.post("/api/media/inspect")
def media_inspect(body: InspectRequest):
    try:
        return inspect_media(body.source).to_dict()
    except Exception as exc:
        raise HTTPException(400, str(exc)) from exc


@app.get("/api/media/preview")
def media_preview(source: str = Query(...), frame: int = Query(0, ge=0)):
    try:
        import cv2
        image = read_frame(source, frame)
        ok, encoded = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, 90])
        if not ok:
            raise ValueError("encodage JPEG impossible")
        return StreamingResponse(io.BytesIO(encoded.tobytes()), media_type="image/jpeg")
    except Exception as exc:
        raise HTTPException(400, str(exc)) from exc


@app.get("/api/output")
def output(path: str = Query(...)):
    candidate = Path(path).expanduser().resolve()
    try:
        candidate.relative_to(RUNS_DIR.resolve())
    except ValueError as exc:
        raise HTTPException(403, "sortie hors du workspace") from exc
    if not candidate.is_file():
        raise HTTPException(404, "sortie introuvable")
    return FileResponse(candidate)


@app.post("/api/runs", status_code=202)
def start_run(body: RunRequest):
    job_id = uuid.uuid4().hex
    _set_job(job_id, {"status": "running", "job_id": job_id})
    thread = threading.Thread(target=_run_job, args=(job_id, body.options()), daemon=True)
    thread.start()
    return {"status": "running", "job_id": job_id}


@app.get("/api/runs/{job_id}")
def run_status(job_id: str):
    with _jobs_lock:
        state = _jobs.get(job_id)
    if state is None:
        raise HTTPException(404, "run inconnu")
    return state


class TraceFields(BaseModel):
    graph_id: str | None = None
    graph_name: str | None = None
    node_id: str | None = None
    node_label: str | None = None
    run_id: str | None = None


class OrchestratorInferRequest(BaseModel):
    sequence_dir: str
    model_path: str | None = None
    engine: str = "yolox"
    model_size: str = "yolox-s"
    mode: str = "headless"
    clicks: str | None = None
    tracker_mot: str = "yolo"
    tracker_sot: str = "csrt"
    n_targets: int = 1
    compute_metrics: bool = False
    annotation_file: str | None = None
    overrides: dict = Field(default_factory=dict)
    trace: TraceFields | None = None


@app.post("/api/orchestrator/infer")
def orchestrator_infer(body: OrchestratorInferRequest):
    overrides = dict(body.overrides)
    model_path = body.model_path or ""
    run_name = ""
    if body.trace:
        run_name = "_".join(filter(None, (body.trace.graph_name, body.trace.node_label)))
    options = RunOptions(
        source=body.sequence_dir,
        model_path=model_path,
        engine=body.engine,
        model_size=body.model_size or "yolox-s",
        mode="mot",
        tracker="bytetrack" if body.tracker_mot == "bytetrack" else "none",
        confidence=float(overrides.get("confidence", overrides.get("conf_thresh", 0.25))),
        iou=float(overrides.get("iou", overrides.get("iou_thresh", 0.45))),
        imgsz=int(overrides.get("imgsz", overrides.get("img_size", 640))),
        device=str(overrides.get("device", "")),
        class_names=list(overrides.get("class_names", [])),
        track_high_thresh=float(overrides.get("track_high_thresh", 0.5)),
        track_low_thresh=float(overrides.get("track_low_thresh", 0.1)),
        new_track_thresh=float(overrides.get("new_track_thresh", 0.6)),
        match_thresh=float(overrides.get("match_thresh", 0.3)),
        track_buffer=int(overrides.get("track_buffer", 30)),
        save_output=bool(overrides.get("save_output", overrides.get("save_video", True))),
        max_frames=int(overrides.get("max_frames", 0)),
        run_name=run_name,
    )
    try:
        result = run_inference(options, RUNS_DIR)
    except Exception as exc:
        raise HTTPException(500, f"echec inference: {type(exc).__name__}: {exc}") from exc
    return {
        **result,
        "video": Path(result["output_path"]).name if result.get("output_path") else None,
        "benchmark": {
            "fps_total": result["fps"],
            "n_frames": result["frames"],
            "detections": result["detections"],
            "objects_last_frame": result["objects_last_frame"],
            "unique_tracks": result["unique_tracks"],
            "detector_ms_per_frame": result["detector_ms_per_frame"],
            "tracker_ms_per_frame": result["tracker_ms_per_frame"],
        },
    }


class EvaluateRequest(BaseModel):
    kind: Literal["detection", "tracker"] = "detection"
    model_path: str
    engine: str = "yolox"
    model_size: str = "yolox-s"
    data_yaml: str | None = None
    sequence_dir: str | None = None
    overrides: dict = Field(default_factory=dict)
    timeout_s: int = 3600
    trace: TraceFields | None = None


@app.post("/api/orchestrator/evaluate")
def orchestrator_evaluate(body: EvaluateRequest):
    run_name = uuid.uuid4().hex[:12]
    if body.trace:
        run_name = "_".join(filter(None, (body.trace.graph_name, body.trace.node_label))) or run_name
    overrides = dict(body.overrides)
    if body.kind == "detection":
        if not body.data_yaml:
            raise HTTPException(400, "data_yaml requis pour l'evaluation detection")
        try:
            result = evaluate_detection(
                data_yaml=body.data_yaml,
                split=str(overrides.get("split", "val")),
                model_path=body.model_path,
                engine=body.engine,
                model_size=body.model_size,
                confidence=float(overrides.get("conf", overrides.get("confidence", 0.001))),
                iou=float(overrides.get("iou", 0.6)),
                imgsz=int(overrides.get("imgsz", 640)),
                device=str(overrides.get("device", "")),
                run_dir=RUNS_DIR / f"eval_{run_name}",
            )
        except Exception as exc:
            raise HTTPException(500, f"echec evaluation: {type(exc).__name__}: {exc}") from exc
        return {**result, "kind": "detection", "mlflow_run_id": ""}
    if not body.sequence_dir:
        raise HTTPException(400, "sequence_dir requis pour le benchmark tracker")
    try:
        result = run_inference(
            RunOptions(
                source=body.sequence_dir,
                model_path=body.model_path,
                engine=body.engine,
                model_size=body.model_size,
                mode="mot",
                tracker="bytetrack",
                confidence=float(overrides.get("confidence", 0.25)),
                iou=float(overrides.get("iou", 0.45)),
                imgsz=int(overrides.get("imgsz", 640)),
                device=str(overrides.get("device", "")),
                save_output=bool(overrides.get("save_output", True)),
                run_name=f"track_eval_{run_name}",
            ),
            RUNS_DIR,
        )
    except Exception as exc:
        raise HTTPException(500, f"echec benchmark tracker: {type(exc).__name__}: {exc}") from exc
    metrics = {key: result[key] for key in ("fps", "detector_fps", "detector_ms_per_frame", "tracker_ms_per_frame", "frames", "detections", "unique_tracks")}
    return {"status": "done", "kind": "tracker", "run_dir": result["run_dir"], "metrics": metrics, "mlflow_run_id": ""}


@app.get("/")
def root():
    return {"app": "VisionNexus Inference App", "version": "2.0.0", "docs": "/docs"}
