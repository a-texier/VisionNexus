---
app: inference
doc_type: architecture
audience: dev
lang: en
title: Architecture
order: 60
tags: [components, detector contract, bytetrack, csrt, evaluation, invariants]
sources: [Inference_App/backend/main.py, Inference_App/backend/config.py, Inference_App/backend/inference_core/runner.py, Inference_App/backend/inference_core/detectors.py, Inference_App/backend/inference_core/bytetrack.py, Inference_App/backend/inference_core/media.py, Inference_App/backend/inference_core/models.py, Inference_App/backend/inference_core/evaluation.py, Inference_App/frontend/src/App.tsx]
---

# Architecture

## Components overview of Inference App

```text
frontend/ (React + Vite, port 5177)
  App.tsx  --  single page: sidebar inputs + Inference/Evaluation/Config tabs
       |  HTTP, everything through the Vite /api proxy (no direct SSE or image fetch)
       v
backend/ (FastAPI, port 8065)
  main.py                        --  routes, request models, job registry
  api/settings.py                --  UI language persisted in the workspace
  inference_core/
    media.py                     --  read images/video, list frames, probe dimensions/fps
    detectors.py                 --  YoloxDetector + visionnexus.detector_backends plugin contract
    bytetrack.py                 --  small two-pass ByteTrack-style MOT association
    runner.py                    --  the infer/mot/sot pipeline, drawing, output writing
    evaluation.py                --  detection mAP/PR/F1/confusion-matrix on a YOLO dataset
    models.py                    --  Detection, Track, RunOptions dataclasses
  config/defaults.yaml            --  packaged config schema + defaults
```

Inference App is intentionally small and public-facing: `inference_core/` has no dependency on the rest of the monorepo except `yolox_model.py`'s architecture code, imported directly from `Training_App/backend/services/yolox_model.py` across the repository (not through a package). This is the one hard coupling to Training App; everything else in `inference_core/` is self-contained enough to be read (and packaged) independently.

## Backend application startup

`backend/main.py` builds the FastAPI app, adds CORS restricted to the interface's own port (`backend/config.py`), and includes the `settings` router. There is no `lifespan` hook and no model loaded at startup: `GET /health` answers `{"status": "ok", "app": "Inference_App", "version": "2.0.0"}` immediately, and every detector is constructed fresh for each request (see the next section), so there is nothing to warm up or wait for before VisionNexus opens the tab.

## The detector contract and engine resolution

`inference_core/detectors.py` defines the `Detector` protocol (a `class_names: list[str]` attribute and a `predict(frame) -> list[Detection]` method) and `create_detector(engine, **kwargs)`, which resolves it: `"yolox"` builds a `YoloxDetector` directly; any other name goes through the repository's `_lib/plugin_registry.py` (group `visionnexus.detector_backends`, deliberately separate from Training App's `visionnexus.trainer_backends` group, since a detector plugin and a training-engine plugin are different contracts even when provided by the same plugin package) and wraps the result in a thin `Adapter` that normalizes tuple outputs into `Detection` objects. There is no silent fallback: an unresolvable engine name raises `ValueError`.

`YoloxDetector.__init__` adds `Training_App/` and `Training_App/backend/` to `sys.path`, imports `services.yolox_model.build_exp`/`load_checkpoint` from there, and infers the number of classes directly from the checkpoint's `head.cls_preds` weight shape rather than trusting a caller-supplied count; `class_names` from `config.yaml` must then be empty (generic `class_<n>` labels are used) or match that inferred count exactly, or construction fails loudly instead of silently mislabeling classes.

## The inference pipeline: infer, mot and sot

`inference_core/runner.py::run_inference(options, runs_dir)` is a single function driving all three modes over `inference_core/media.py::iter_frames` (a generator reading either a video via OpenCV's `VideoCapture` or a sorted folder of images, yielding `(index, frame)` pairs uniformly):

- **infer**: `detector.predict(frame)` every frame; `last_detections` is drawn as-is.
- **mot**: same detector call; if `tracker == "bytetrack"`, `ByteTracker.update(detections)` (see the next section) additionally produces `Track` objects with a `track_id`, drawn with a `#<id>` prefix instead of raw detections.
- **sot**: on the very first frame, the detector runs once and `_select_detection` picks the highest-scoring detection containing the click point (`options.click_x`/`click_y`, normalized 0-1); that box seeds an OpenCV `TrackerCSRT` (`cv2.TrackerCSRT_create` or, on older OpenCV builds, `cv2.legacy.TrackerCSRT_create`), which alone drives every subsequent frame via `csrt.update(frame)`, with no further detector calls.

Output writing (`save_output`) branches on frame count: a `cv2.VideoWriter` (`mp4v`, source fps) for video or multi-image sources, a single `cv2.imwrite` for a lone image, both to a fresh `runs/<run name>/` folder (`run_name` sanitized by `_safe_name`, de-duplicated with a random suffix if the folder already exists). Every run writes `result.json` (the same dict returned to the caller) and `request.json` (the full `RunOptions`, via `dataclasses.asdict`) next to the output, which is what lets [Troubleshooting](troubleshooting.md) advice reference a run's own recorded parameters.

## ByteTrack association

`inference_core/bytetrack.py::ByteTracker.update(detections)` runs two greedy matching passes per call, each via `_greedy_match` (an IoU-sorted, same-class-only greedy assignment, not the Hungarian algorithm YOLOX's own vendored ByteTrack sometimes uses, but sufficient at the frame rates this app targets): high-confidence detections (`score >= high_thresh`) against all existing tracks first, then low-confidence detections (`low_thresh <= score < high_thresh`) against only the tracks the first pass left unmatched. Unmatched tracks accumulate a `missed` counter and are dropped once it exceeds `buffer_size`; a new track is only created from an unmatched high-confidence detection scoring at or above `new_track_thresh`, never from a low-confidence one, so a new object cannot start a track through the low-confidence pass alone. `update()` returns only tracks with `missed == 0`, so a track invisible this frame is not drawn even though it survives internally until the buffer expires.

## Detection evaluation pipeline

`inference_core/evaluation.py::evaluate_detection(...)` reads a `data.yaml`'s `val` split (`_dataset_images`), matches predictions to YOLO `.txt` ground truth per image (`_ground_truth`, using the same `images/`-to-`labels/` path substitution convention as Training App's dataset loader, implemented independently rather than shared), and computes:

- Per-class AP at ten IoU thresholds 0.50-0.95 (`_score_class`, a from-scratch greedy TP/FP matching plus 101-point interpolated average precision, `_average_precision`), aggregated into `map50`/`map50_95`.
- An aggregate precision-recall curve and F1-vs-confidence curve (pooling every class's predictions into one ranking, offsetting each class's image indices so per-image, per-class ground truth stays separable).
- A confusion matrix at IoU 0.50 and a fixed confidence of 0.25, with a background row (missed ground truth) and column (unmatched predictions), via the same greedy-by-IoU matching approach as the class-level scoring.

This is a separate implementation from Training App's `detection_metrics.py` (different matching order, different threshold defaults for the confusion matrix), not a shared module: expect small numeric differences between the two apps' mAP on the same model and dataset, and keep that in mind before treating either as more "correct" than the other. All outputs (`metrics.json`, `pr_curve.png`, `f1_curve.png`, `confusion_matrix.png`) are written with `matplotlib.use("Agg")` for headless rendering, to a fresh `runs/eval_<id>/` folder that must not already exist (`mkdir(parents=True, exist_ok=False)`).

## The Orchestrator contract

`main.py::orchestrator_infer` and `orchestrator_evaluate` are thin adapters over `run_inference` and `evaluate_detection` respectively, built for `Orchestrator_App/backend/core/graph_runner.py`: they accept an `overrides` dict of loosely-typed values (matching `config/defaults.yaml`'s keys, with a couple of legacy aliases like `conf_thresh`/`iou_thresh`), coerce them into a typed `RunOptions` or explicit keyword arguments, and run synchronously, returning once the pipeline step is done (no background job, no polling needed by the Orchestrator for these two endpoints, unlike Training App's blocking-but-separately-pollable run). `orchestrator_infer` always forces `mode="mot"` (there is no orchestrator-driven SOT, since SOT requires an interactive click) and derives `tracker` from `tracker_mot`.

## Frontend structure

`App.tsx` is the entire frontend: one component holding all state (source, weights, engine, mode, tracker, thresholds, the loaded config, the active job or evaluation result) and rendering the sidebar plus whichever of the three tabs is active. There is no client-side routing and no separate API client module (unlike Training App's `api/client.ts`); the small `api<T>(url, options)` helper wraps `fetch` and throws on a non-OK response, reading the FastAPI `detail` field. `POST /api/runs` returns immediately with a `job_id`; the frontend then polls `GET /api/runs/{job_id}` every 700 ms until the status leaves `"running"`, which is the only asynchronous flow in the app (evaluation, by contrast, is a single blocking `POST /api/orchestrator/evaluate` call awaited directly, reusing the Orchestrator endpoint rather than a dedicated one, since the interface has no need for a separate contract).

## Invariants that must not be broken

- **The vendored YOLOX code is the single architecture source**: `YoloxDetector` must keep importing `Training_App/backend/services/yolox_model.py` rather than acquiring its own copy of the architecture; a checkpoint's compatibility between Training App and Inference App depends on this.
- **Class count comes from the checkpoint, not from configuration**: `class_names` must never override the number of classes inferred from `head.cls_preds`; a mismatch must fail construction rather than silently mislabel or crop detections.
- **No detector plugin fallback**: `create_detector` must raise on an unresolvable engine, never substitute `yolox`; a caller depending on weight compatibility would otherwise fail confusingly at prediction time instead of at detector construction.
- **`/api/output` never serves outside `runs/`**: the path-containment check in `main.py::output` is the only thing preventing arbitrary file disclosure through that endpoint; any change to run-folder resolution must preserve it.
- **A run folder is never silently overwritten**: `run_inference` and `evaluate_detection` both fail loudly (`mkdir(..., exist_ok=False)`, a uniquifying suffix) rather than merge into or overwrite an existing run's files.
- **Evaluation reads only the `val` split**: this is deliberate and depended upon by the Orchestrator contract; do not default to `test` or `train` even when `val` is absent.
