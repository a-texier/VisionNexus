---
app: inference
doc_type: code-map
audience: dev
lang: en
title: Code map
order: 80
tags: [modules, backend, frontend, detector plugin, bytetrack, evaluation]
sources: [Inference_App/backend, Inference_App/frontend/src]
---

# Code map

## Where to start reading the backend code

Start at `backend/main.py`: it is short enough to read end to end and is where every request body, every response shape and the two Orchestrator adapters live. From there, `backend/inference_core/runner.py::run_inference` is the core of the **Inférence** tab (all three modes), and `backend/inference_core/evaluation.py::evaluate_detection` is the core of the **Évaluation** tab; both are called directly by `main.py`, with no service layer in between. `backend/config.py` resolves the workspace path, the ports and the CORS origin from environment variables; read it before changing anything that depends on the workspace layout.

## Where to start reading the frontend code

Start at `frontend/src/App.tsx`: unlike Training App, there is only this one file (plus `LanguageToggle.tsx` and the i18n helpers) holding the entire interface, state included. Read the `api<T>()` helper first, then the `run`/`evaluate`/`saveConfig` functions, then the JSX at the bottom, which is organized by tab (`tab === 'run'`, `'evaluate'`, `'config'`).

## Where to add a new detector engine

A new detector engine is a plugin, not a change to Inference App itself: add an entry to the group `visionnexus.detector_backends` (distinct from Training App's `visionnexus.trainer_backends`) in a plugin's `__init__.py` manifest, and implement a class with a `class_names` attribute and a `predict(frame)` method returning a list of `(x1, y1, x2, y2, score, class_id, label)` tuples or `Detection` objects (`backend/inference_core/models.py`). Nothing in `Inference_App/` needs editing; the engine is discovered through `_lib/plugin_registry.py` (see [Configuration](configuration.md) and [Architecture](architecture.md)). `plugins/visionnexus_ultralytics/detector.py` is a worked example of the contract, alongside the trainer-engine contract in the same plugin.

## Where to change how a source is read (images, video, frame extraction)

`backend/inference_core/media.py`: `media_files` (lists the files a source resolves to), `inspect_media` (dimensions, frame count, fps), `iter_frames` (the generator every pipeline consumes), `read_frame` (a single frame by index, used by the preview endpoint). `IMAGE_EXTENSIONS` and `VIDEO_EXTENSIONS` are the fixed, hardcoded set of supported extensions; add to them here if a new container or image format needs support, and update [Configuration](configuration.md) and [Troubleshooting](troubleshooting.md) to match.

## Where to change the YOLOX detector or add class-name handling

`backend/inference_core/detectors.py::YoloxDetector`: construction (imports `Training_App/backend/services/yolox_model.py` across the repository, infers class count from the checkpoint) and `predict()` (preprocessing, forward pass, postprocessing, back to original-image coordinates). Do not duplicate YOLOX architecture code here; any change to how a checkpoint is built or loaded belongs in Training App's `yolox_model.py`, shared by both apps (see [Architecture](architecture.md)).

## Where to change ByteTrack's matching or thresholds

`backend/inference_core/bytetrack.py`: `box_iou` (also reused by `evaluation.py`), `_greedy_match` (the two-pass matching primitive), `ByteTracker.update` (the per-frame association logic and track lifecycle). `Inference_App/tests/test_bytetrack.py` covers identity persistence through a low-confidence frame and the no-new-track-from-low-confidence rule; extend it alongside any matching change.

## Where to change the inference pipeline or output writing

`backend/inference_core/runner.py::run_inference`: the per-mode branching (`infer`/`mot`/`sot`), `_draw` (annotation rendering, shared by all modes), `_select_detection` (SOT click resolution), the `cv2.VideoWriter`/`cv2.imwrite` output branch, and the `result.json`/`request.json` bookkeeping. `main.py::start_run`/`_run_job` wrap this in a background thread and the `_jobs` polling registry; keep the two in sync if you change what `run_inference` returns, since `main.py` stores that dict as-is for `GET /api/runs/{job_id}`.

## Where to change evaluation metrics or plots

`backend/inference_core/evaluation.py`: `_dataset_images`/`_ground_truth` (reading the dataset), `_score_class`/`_average_precision` (the AP computation), `_save_plots` (the three PNG outputs), `evaluate_detection` (orchestrates all of the above and writes `metrics.json`). This is a separate implementation from Training App's `detection_metrics.py`; do not assume the two produce identical numbers on the same input (see [Architecture](architecture.md)). `Inference_App/tests/test_evaluation.py` covers the metric computation on small synthetic datasets.

## Where to change the Orchestrator contract

`backend/main.py::orchestrator_infer` and `orchestrator_evaluate`: the accepted request models (`OrchestratorInferRequest`, `EvaluateRequest`, `TraceFields`) and the translation from `overrides` into `RunOptions` or explicit evaluation arguments. Endpoint paths and response shapes are meant to stay stable since Orchestrator App depends on them; if a field must change, keep the old one working or coordinate with Orchestrator App's `backend/core/graph_runner.py`, which builds the request body for the Inference node.

## Where to change ports, workspace layout or environment variables

`backend/config.py` (workspace path, ports, CORS origin) and `_lib/launcher_engine.py` (the `"inference"` entry of `APP_REGISTRY`: port allocation, environment variables, workspace subfolder creation). Inference App has no app-local launcher script, unlike Training App; it is only started through the suite-wide launcher or VisionNexus. See [Configuration](configuration.md) for the full list of variables.

## Where to change the config.yaml schema or its Orchestrator form

`config/defaults.yaml` at the app root is both the packaged defaults the app falls back to and the schema `Orchestrator_App/backend/api/graphs.py::_INFERENCE_GROUPS` reads to build its node form; add a new key there first, then group it in `_INFERENCE_GROUPS` on the Orchestrator side if it should appear in a specific section rather than the catch-all "Autres champs" group. See [Configuration](configuration.md) for the current schema.

## Where to change translations

`frontend/src/i18n/translate.ts`: `EXACT_EN` is the French-to-English dictionary keyed by the exact French string used in the JSX (`t('...')`); there is no semantic key. Add every new user-facing French string here when introducing it in `App.tsx`; a string missing from the dictionary is shown untranslated in English mode rather than breaking the page.

## Debugging tools: run and evaluation state

- `GET /api/runs/{job_id}` is the only way to inspect a run's state from outside; the `_jobs` dict in `main.py` is in-memory only and empty after a backend restart, so a job started before a restart cannot be recovered.
- `runs/<run name>/request.json` records the exact `RunOptions` a run was started with, useful when a result looks wrong and you need to confirm what was actually requested versus what the sidebar currently shows.
- `runs/<run name>/result.json` and `runs/eval_<id>/metrics.json` are the same payloads returned over the API, readable directly on disk if the interface session is gone.
- `Inference_App/tests` runs with `pytest tests -q` from `Inference_App/`; there is no `slow` marker here, all tests are fast unit tests over synthetic data.

## Module map

<!-- generated:start -->
### backend

| File | Description | Exports |
|---|---|---|
| `__init__.py` | Backend package for the public VisionNexus Inference App. |  |
| `config.py` |  |  |
| `main.py` |  | `InspectRequest`, `ConfigRequest`, `get_config`, `put_config`, `RunRequest`, `health`, `app_mode`, `capabilities`, `media_inspect`, `media_preview`, `output`, `start_run` (+7) |

### backend/api

| File | Description | Exports |
|---|---|---|
| `settings.py` |  | `AppSettings`, `load_settings`, `get_settings`, `update_settings` |

### backend/inference_core

| File | Description | Exports |
|---|---|---|
| `__init__.py` | Small, public inference runtime: media, detectors and tracking only. |  |
| `bytetrack.py` |  | `box_iou`, `ByteTracker` |
| `detectors.py` |  | `Detector`, `YoloxDetector`, `detector_capabilities`, `create_detector` |
| `evaluation.py` |  | `evaluate_detection` |
| `media.py` |  | `MediaInfo`, `media_files`, `inspect_media`, `iter_frames`, `read_frame` |
| `models.py` |  | `Detection`, `Track`, `RunOptions` |
| `runner.py` |  | `run_inference` |

### frontend/src

| File | Description | Exports |
|---|---|---|
| `App.tsx` |  | `api`, `App` |
| `main.tsx` |  |  |

### frontend/src/components

| File | Description | Exports |
|---|---|---|
| `LanguageToggle.tsx` |  | `LanguageToggle` |

### frontend/src/i18n

| File | Description | Exports |
|---|---|---|
| `translate.ts` | Traduction FR -> EN a l'affichage. Le francais reste la source de | `isDesktopPiloted`, `getLang`, `setLang`, `subscribeLang`, `initWorkspaceLanguage`, `setLangAndMaybePersist`, `t` |
| `useLang.ts` |  | `useLang`, `useT` |
<!-- generated:end -->
