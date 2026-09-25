---
app: inference
doc_type: api-reference
audience: dev
lang: en
title: API reference
order: 70
tags: [rest api, endpoints, fastapi, orchestrator]
sources: [Inference_App/backend/main.py, Inference_App/backend/api/settings.py]
---

# API reference

## Conventions of the Inference App API

The backend exposes a JSON REST API under `/api`, plus `/health` and interactive documentation (Swagger) at `/docs` on the backend port (8065 by default, see [Configuration](configuration.md)). Every request is proxied by the Vite frontend at `/api`; unlike Training App, no endpoint is called directly at the backend port.

General rules:

- **Errors** use FastAPI's format `{"detail": "..."}`, with 400 (invalid request: unreadable media, invalid YAML, a SOT click on no detection) or 403/404 (from `GET /api/output`). Detail messages are written in French; the frontend shows them as they are.
- **Long operations**: `POST /api/runs` returns immediately with a `job_id` to poll via `GET /api/runs/{job_id}`. `POST /api/orchestrator/infer` and `POST /api/orchestrator/evaluate`, by contrast, run synchronously and block until the pipeline step is done, matching how the Orchestrator calls them.
- **Paths**: `source`, `model_path`, `data_yaml` and the paths inside `GET /api/output` are all server paths as seen by the backend; nothing is uploaded through these endpoints.

The endpoint table of the section *Endpoint index* is generated from the code; the sections below explain each domain.

## Media endpoints

- `POST /api/media/inspect`: body `{source}`; returns `{source, kind: "images" | "video", width, height, frames, fps}` after reading the file or folder. Raises 400 on an unreadable or unsupported source.
- `GET /api/media/preview?source=&frame=0`: returns one frame as a JPEG image (`image/jpeg`), used for the sidebar preview and the SOT click target.

## Run endpoint: inference, MOT and SOT

- `POST /api/runs` (202 Accepted): body matches `RunRequest` (`source`, `model_path`, `engine` default `yolox`, `model_size` default `yolox-s`, `mode` one of `infer`/`mot`/`sot`, `tracker` `none`/`bytetrack`, `click_x`/`click_y` (required for `sot`, 0-1), `confidence`, `iou`, `imgsz`, `device`, `class_names`, the five `track_*` ByteTrack parameters, `save_output`, `max_frames`, `run_name`). Starts a background thread and returns `{status: "running", job_id}` immediately.
- `GET /api/runs/{job_id}`: the job's current state, `{status: "running"}` while in progress, or the full result once done (`run_name`, `run_dir`, `output_path`, `mode`, `tracker`, `engine`, `frames`, `detections`, `objects_last_frame`, `unique_tracks`, `fps`, `detector_fps`, `detector_ms_per_frame`, `tracker_ms_per_frame`, `duration_s`, `last_detections`), or `{status: "error", error}` on failure. 404 if `job_id` is unknown.

## Evaluation endpoint (used directly and by the Orchestrator)

There is no dedicated `/api/evaluate` endpoint for the interface: the **Évaluation** tab calls `POST /api/orchestrator/evaluate` (below) with `kind: "detection"` directly, the same endpoint the Orchestrator uses.

## Configuration endpoints

- `GET /api/config`: reads the workspace's `config.yaml` if present, else the packaged `config/defaults.yaml`; returns `{source, yaml_text, values}` (`values` is the parsed YAML as JSON).
- `PUT /api/config`: body `{yaml_text}`; parses it as YAML, requires the root to be an object (400 otherwise), writes it to the workspace's `config.yaml`, and returns `{saved: true, source, values}`. The full schema is in [Configuration](configuration.md).

## Output serving endpoint

- `GET /api/output?path=`: serves a file under `runs/` of the workspace (annotated media, evaluation plots, `result.json`). The path is resolved and checked to stay under `RUNS_DIR`; a path outside it is refused with 403, a missing file with 404. This is the only way the frontend reads run outputs; there is no listing endpoint, the frontend already knows the paths from a run's or evaluation's own response.

## Settings and application endpoints

- `GET` / `PUT /api/settings`: reads or merges the workspace's `ui_language` (see [Configuration](configuration.md)); only used outside VisionNexus.
- `GET /health`: `{"status": "ok", "app": "Inference_App", "version": "2.0.0"}`, unconditional.
- `GET /`: `{"app", "version", "docs"}`.
- `GET /api/app-mode`: `{mode: "solo" | "orchestrator", workspace, runs_dir, user}`.
- `GET /api/capabilities`: `{detectors: [{name, label, available, plugin, reason}, ...], modes: ["infer", "mot", "sot"], trackers: ["none", "bytetrack", "csrt"], media: [extensions...]}`. Note `trackers` lists `csrt` for information even though it is never selected explicitly: SOT mode always uses CSRT internally.

## Orchestrator integration endpoints

The two `/api/orchestrator` endpoints are the contract with Orchestrator App; they run synchronously and block until the underlying inference or evaluation finishes (see [Architecture](architecture.md)).

- `POST /api/orchestrator/infer`: `sequence_dir` (required), `model_path`, `engine` (default `yolox`), `model_size` (default `yolox-s`), `mode` (accepted but currently always run as `"mot"` internally), `clicks` (unused for orchestrator-driven runs, since SOT needs an interactive click), `tracker_mot` (`"bytetrack"` or anything else for no tracker), `tracker_sot` (accepted, unused), `n_targets`, `compute_metrics` (accepted, unused), `annotation_file`, `overrides` (a dict of `RunOptions` field values, with `conf_thresh`/`iou_thresh`/`img_size`/`save_video` accepted as aliases of `confidence`/`iou`/`imgsz`/`save_output`), `trace` (`{graph_id, graph_name, node_id, node_label, run_id}`, used to build a deterministic `run_name`). Returns the `run_inference` result plus `video` (output file name) and a `benchmark` summary (`fps_total`, `n_frames`, `detections`, `objects_last_frame`, `unique_tracks`, `detector_ms_per_frame`, `tracker_ms_per_frame`).
- `POST /api/orchestrator/evaluate`: `kind` (`"detection"` or `"tracker"`), `model_path`, `engine`, `model_size`, `data_yaml` (required for `kind: "detection"`), `sequence_dir` (required for `kind: "tracker"`), `overrides` (for detection: `split` default `"val"`, `conf`/`confidence` default 0.001, `iou` default 0.6, `imgsz`, `device`; for tracker: the same `RunOptions` fields as `orchestrator_infer`), `timeout_s` (accepted, unused by this synchronous implementation), `trace`. Detection returns `{status, run_dir, metrics: {map50, map50_95, images, ground_truth, predictions, duration_s, fps, per_class}, kind: "detection", mlflow_run_id: ""}`; tracker returns `{status: "done", kind: "tracker", run_dir, metrics: {fps, detector_fps, detector_ms_per_frame, tracker_ms_per_frame, frames, detections, unique_tracks}, mlflow_run_id: ""}`. `mlflow_run_id` is always an empty string: Inference App does not log to MLflow itself.

## Endpoint index

<!-- generated:start -->
### main

| Method | Path | Summary | Source |
|---|---|---|---|
| GET | `/` | `root()` | `Inference_App/backend/main.py:323` |
| GET | `/api/app-mode` | `app_mode()` | `Inference_App/backend/main.py:118` |
| GET | `/api/capabilities` | `capabilities()` | `Inference_App/backend/main.py:128` |
| GET | `/api/config` | `get_config()` | `Inference_App/backend/main.py:48` |
| PUT | `/api/config` | `put_config()` | `Inference_App/backend/main.py:56` |
| POST | `/api/media/inspect` | `media_inspect()` | `Inference_App/backend/main.py:138` |
| GET | `/api/media/preview` | `media_preview()` | `Inference_App/backend/main.py:146` |
| POST | `/api/orchestrator/evaluate` | `orchestrator_evaluate()` | `Inference_App/backend/main.py:272` |
| POST | `/api/orchestrator/infer` | `orchestrator_infer()` | `Inference_App/backend/main.py:213` |
| GET | `/api/output` | `output()` | `Inference_App/backend/main.py:159` |
| POST | `/api/runs` | `start_run()` | `Inference_App/backend/main.py:171` |
| GET | `/api/runs/{job_id}` | `run_status()` | `Inference_App/backend/main.py:180` |
| GET | `/health` | `health()` | `Inference_App/backend/main.py:113` |

### settings

| Method | Path | Summary | Source |
|---|---|---|---|
| GET | `/api/settings` | `get_settings()` | `Inference_App/backend/api/settings.py:40` |
| PUT | `/api/settings` | `update_settings()` | `Inference_App/backend/api/settings.py:45` |
<!-- generated:end -->
