---
app: training
doc_type: architecture
audience: dev
lang: en
title: Architecture
order: 60
tags: [components, engine contract, run lifecycle, sse, mlflow, plugins, invariants]
sources: [Training_App/backend/main.py, Training_App/backend/database.py, Training_App/backend/models/training_run.py, Training_App/backend/services/training_service.py, Training_App/backend/services/trainer_backend.py, Training_App/backend/services/yolox_engine.py, Training_App/backend/services/yolox_trainer.py, Training_App/backend/services/run_artifacts.py, Training_App/backend/services/mlflow_logging.py, Training_App/backend/routers/training.py, Training_App/backend/routers/orchestrator.py, Training_App/frontend/src/App.tsx]
---

# Architecture

## Components overview of Training App

```text
frontend/ (React + Vite, port 5176)
  TrainingPage.tsx  --  config form + Start/Stop + live Progress (SSE)
  RunsPage.tsx      --  History table + run detail (curves, gallery, best/worst)
       |  HTTP (proxied /api) + direct SSE/image fetch to the backend port
       v
backend/ (FastAPI, port 8064)
  routers/training.py       --  run CRUD, SSE stream, artifacts, models catalog
  routers/orchestrator.py   --  POST /train, GET /run-status (Orchestrator contract)
  routers/capabilities.py   --  GET /api/capabilities (engines + catalogs)
  api/settings.py           --  UI language persisted in the workspace
  services/training_service.py  --  run lifecycle: thread, events, MLflow, DB updates
  services/trainer_backend.py   --  engine contract, resolution, catalog validation
  services/yolox_engine.py + yolox_trainer.py + yolox_dataset.py + yolox_model.py
                              --  the "yolox" engine (only engine in the core)
  services/mlflow_logging.py    --  defensive MLflow logging to a per-user sqlite store
  database.py + models/training_run.py  --  SQLite (SQLModel), one TrainingRun row per run
```

Training App owns the model architecture and the training engine: the core provides only the `yolox` engine; other engines are discovered as plugins (`plugins/` at the monorepo root) through the contract in `trainer_backend.py`. Inference App reuses the vendored YOLOX code (`backend/vendor/yolox/`) to load YOLOX checkpoints, but has no dependency the other way: Training App never imports Inference App. The database (SQLite, one file per user workspace) and the in-memory event registry are the only backend state; nothing is cached across requests beyond what those two hold.

## Backend application startup

`backend/main.py` builds the FastAPI app, adds CORS for the interface origins (`backend/config.py`), and includes the four routers (`training`, `orchestrator`, `capabilities`, `settings`). Its `lifespan` calls `create_db_and_tables()` before serving requests. `GET /health` answers `{"status": "ok", "app": "Training_App"}` unconditionally: unlike Annotation App, Training App does not load any heavy model at startup (engines are resolved lazily, only when a run actually needs them), so readiness is immediate and VisionNexus never has to wait before opening the tab. `create_db_and_tables()` also applies the small set of additive column migrations in `_ADDED_COLUMNS` (`database.py`), so an older workspace database gains new columns (currently the `engine` column, defaulted to `yolox` for rows created before the multi-engine change) without a separate migration step.

## The training engine contract

`trainer_backend.py` defines the contract every engine follows, as a `Protocol` (`TrainingEngine`): a class with a `CATALOG` dict and a constructor taking `model_size`, `data_yaml`, `run_name`, `output_dir`, `hyperparams`, `model_weights`, `stop_flag` and `on_epoch_end`, plus a blocking `train()` method returning `{"run_dir", "best_model_path", "last_model_path"}` and optionally `"metrics"`. `train()` calls `on_epoch_end(payload)` at the end of every epoch with `{"epoch", "total_epochs", "progress_pct", "loss", "metrics"}`, using the metric names `metrics/mAP50(B)`, `metrics/mAP50-95(B)`, `metrics/precision(B)`, `metrics/recall(B)` regardless of the engine, so `training_service.py` and the frontend never special-case an engine.

`resolve_engine(name)` returns the engine class: `yolox` loads `yolox_engine.YoloxEngine` directly; any other name goes through `_plugin_registry()` (the repository's `_lib/plugin_registry.py`, found by walking up from this file to the monorepo root) or a Python entry point in the group `visionnexus.trainer_backends`. There is never a silent fallback to another engine: an unresolvable name raises `RuntimeError` with the reason.

`engine_catalog(name)` resolves the engine and validates its `CATALOG` has every key in `CATALOG_KEYS` (`label`, `weights_suffixes`, `sizes`, `default_size`, `defaults`, `groups`, `keys`, `hpo_ranges`, `hpo_default_optimize`, `artifacts`, `train_batches_glob`); a plugin whose catalog is incomplete is reported as unavailable rather than crashing the whole engine list. `describe_backends()` builds the list served by `GET /api/capabilities`, importing each available engine's module (never its heavy training library) to read its catalog.

`merge_hyperparams(catalog, overrides, epochs=, batch=, imgsz=)` layers the engine defaults, then the overrides filtered to known keys (`filter_hyperparams` separates kept from ignored keys), then the generic `epochs`/`batch`/`imgsz` translated through `catalog["keys"]`. `check_weights_for_engine(engine, weights)` refuses a weights path whose suffix is not in `catalog["weights_suffixes"]`. `build_run_config()` in `training_service.py` combines these to validate a request end to end before any `TrainingRun` row is created.

## Run lifecycle and the in-memory event registry

A `TrainingRun` row (SQLModel, `training_run` table) is created by `routers/training.py::start_training` (interface/API) or `routers/orchestrator.py::orchestrator_train` (Orchestrator), after `build_run_config()` validated the request. `services.training_service.start_training(run_name, trace=None)` then:

1. Reads the run's persisted fields back from the database (engine, size, weights, hyperparams, data_yaml).
2. Registers an entry in the module-level `_active_runs` dict (`{run_name: {"events": [], "stop_flag": Event, "thread": Thread}}`, guarded by a `threading.Lock`), which is the only place run progress events live.
3. Starts a daemon `Thread` running `_train()`: resolves the engine class and catalog, opens an MLflow run (`mlflow_logging.start_run`), builds the engine instance with `on_epoch_end` wired to append events to `_active_runs[run_name]["events"]` and to update the `TrainingRun` row (`current_epoch`, `progress_pct`, `best_map50`, `best_map5095`, only overwritten when the epoch's metrics actually contain a value, since an epoch without evaluation reports none), calls `engine.train()`, then records the final status.

`_active_runs` is pure in-memory state: it does not survive a backend restart (see the invariant below). `get_events(run_name, cursor)` returns events from a cursor onward; `stop_training(run_name)` sets the run's `stop_flag`, which the engine is expected to check between iterations and raise (or otherwise exit) on. `training_service.py` treats any exception raised while `stop_flag` is set as a clean stop rather than an error, so an engine does not need to import a Training App-specific exception type, though YOLOX's `TrainingStopped` does subclass the shared `TrainerStopped` in `trainer_backend.py` for clarity.

## Progress delivery: SSE stream

`GET /api/training/{run_name}/events` (`routers/training.py::stream_events`) is a `StreamingResponse` that polls `get_events` every 0.5 s and yields each new event as an SSE `data:` line, stopping after a `done`, `error` or `stopped` event. The frontend (`api/client.ts::streamTrainingEvents`) connects directly to the backend port (not through the Vite proxy, to avoid buffering) with `fetch` and a manual line reader, reconnecting after 2 s on a network failure. Event types: `status` (engine started), `epoch` (per-epoch payload), `done` (`engine`, `best_model_path`, `map50`, `map5095`), `error` (`message`), `stopped`.

Because events only live in `_active_runs`, a page reload after the SSE connection closes cannot replay them; the **History** page instead polls `GET /api/training/runs` and the run detail polls `GET /api/training/{run_name}/metrics-history`, both reading persisted state (the database and `results.csv`), which is why they are the reliable way to follow a run across reloads.

## The YOLOX engine: dataset, trainer and evaluation

`yolox_engine.YoloxEngine` adapts the vendored `yolox.core.trainer.Trainer` to the `TrainingEngine` contract. `train()` builds an `Exp` (`yolox_model.build_exp`, picking the exp file of the selected size from `backend/vendor/yolox/exps/default/`), applies every hyperparameter that matches an `Exp` attribute, then runs `VisionNexusYoloxTrainer` (`yolox_trainer.py`), a subclass of the base `Trainer` that replaces the parts hardcoded for CUDA/COCO/Ultralytics:

- `__init__`/`before_train`: configurable `device` instead of a hardcoded `cuda:{rank}`; dataset built from `YoloTxtDataset` (`yolox_dataset.py`) instead of `COCODataset`.
- `before_iter`: raises `TrainingStopped` when `stop_flag` is set, checked before every training iteration.
- `after_iter`: same periodic logging as the base class, without the base's `exp.random_resize()` call (which is CUDA-only).
- `after_epoch`: saves `latest_ckpt.pth`, evaluates every `eval_interval` epochs, appends a row to `results.csv`, and calls `on_epoch_end` with the SSE/MLflow payload.
- `evaluate_and_save_model`: runs `detection_metrics.compute_metrics` (this app's own mAP implementation, no `pycocotools`) instead of `COCOEvaluator`, writes the analysis plots (`detection_metrics.save_plots` and `yolox_plots.py`), and updates `best_ckpt.pth` when mAP50-95 improves.

`yolox_dataset.YoloTxtDataset` reads a `data.yaml` and either YOLO `.txt` labels or a legacy `.ver` file (format detailed in [Concepts](concepts.md)), exposing the `pull_item`/`__getitem__`/`load_anno` contract the vendored `MosaicDetection` wrapper expects. `yolox_model.py` (shared with Inference App) builds the `Exp`/model for a given size and loads `.pth` checkpoints, tolerating shape mismatches per layer (`load_ckpt`, from the vendored `utils/checkpoint.py`) so fine-tuning across a class-count change only reinitializes the classification layer.

## Analysis plots and the artifact catalog

Every engine declares its plots in `CATALOG["artifacts"]`, a `{category: [relative paths, most to least preferred]}` mapping, plus `"train_batches_glob"`. `run_artifacts.collect_artifacts(run_dir, catalog)` filters each declared path to those that exist on disk and globs the training batches (capped at 3), producing the structure served by `GET /api/training/{run_name}/artifacts` and consumed by the **History** gallery, the Orchestrator's Insights view, and `artifact_files()` which lists the same files for MLflow attachment (deduplicated, since several categories can point at the same file). `GET /api/training/{run_name}/artifact/{path}` serves one image, guarding against path traversal by resolving the path and checking it stays under the run directory, and only serving `.png`/`.jpg`/`.jpeg`. If the run's engine is no longer resolvable, `collect_artifacts` is skipped and the response carries `engine_error` instead (see [Troubleshooting](troubleshooting.md)).

## MLflow logging

`mlflow_logging.py` (near-identical copies exist in Inference App and other apps of the suite, kept in sync manually) opens a run against a per-user SQLite store, never a network server: `resolve_tracking_uri()` returns `IA_MLFLOW_TRACKING_URI` when set (the Orchestrator injects it for pipeline traceability), else `<workspace>/../mlflow_<user>/mlflow_data/mlflow.db`, creating the experiment's artifact location under `<store>/artifacts/<experiment>/` on first use so that runs started from different working directories still land in the same place. Every public method of the returned `_Run` handle (`log_metrics`, `log_params`, `log_artifact`, `set_tags`, `register_model`, `finish`) swallows its own exceptions: a missing `mlflow` package or a write failure never interrupts training, which is why `training_service.py` calls these methods unconditionally rather than checking availability first. `log_metrics` additionally sanitizes metric names (MLflow rejects characters outside `[alnum _ - . / space :]`, and `metrics/mAP50(B)` contains parentheses) so one bad name does not drop the whole batch.

Model registration (`register_model`) uses `<experiment>/<model_size>` as the registered name, deliberately stable across runs of the same size and experiment so that successive trainings become versions v1..vN of one model rather than separate models; tags on each version carry the dataset name, mAP values, engine and Orchestrator trace fields.

## The Orchestrator contract

`routers/orchestrator.py::orchestrator_train` resolves `data.yaml` from either an explicit `dataset_path` (a folder searched for `data.yaml`, or a `.zip` extracted once into `runs/<archive name>/` and cached there) before validating and starting the run exactly like the interface path, then **blocks** the HTTP request until the run reaches a terminal status (`TRAINING_ORCH_BLOCKING=1` by default, polling the database every 2 s up to `TRAINING_ORCH_MAX_WAIT_S`). This blocking behavior is deliberate: an earlier version returned as soon as the run started, which let downstream pipeline steps (for example a DVC commit) run against a model that was not trained yet (see the code comment referencing bug B12). `optuna_best` on the request is tolerant of the Orchestrator's unresolved-placeholder convention: a string (unresolved `${STEP:...}`) is coerced to `{}` rather than causing a validation error.

## Frontend structure

`App.tsx` is a two-route shell (`/training`, `/runs`) sharing a nav bar and the `LanguageToggle`. `TrainingPage.tsx` fetches `GET /api/capabilities` and, once an engine is chosen, `GET /api/training/models?engine=` to build the hyperparameter form entirely from the catalog (field types, ranges, labels): no hyperparameter name or range is hardcoded in the frontend. `RunsPage.tsx` polls `GET /api/training/runs` for the table and, in the detail drawer, `GET /api/training/{run}/metrics-history` (chart data, refetched every 10 s) and `GET /api/training/{run}/artifacts` (gallery, only for `done` runs). `api/client.ts` centralizes all backend calls and exposes `SSE_BASE`/`artifactUrl`, the two places that bypass the Vite proxy to talk to the backend port directly.

## Invariants that must not be broken

- **Engine ownership of weights**: a run's `engine` field, once recorded, is the only thing allowed to interpret its `best_model_path`. Never load YOLOX weights through another engine's `load_predictor`, or vice versa.
- **No silent engine fallback**: `resolve_engine` must raise, never substitute a different engine, when the requested one is unavailable; a caller relying on weight compatibility would otherwise fail confusingly later.
- **Catalog is the single source of form truth**: hyperparameter names, ranges, defaults and plot categories live only in each engine's `CATALOG`; neither the frontend nor the Orchestrator hardcode a YOLOX- or plugin-specific field.
- **Events are ephemeral, the database is not**: never rely on `_active_runs` surviving a restart; persisted run status, `results.csv` and the run folder are the durable record.
- **One writer per workspace**: never run two backend instances (`--workers` > 1 included) against the same `training.db`; each user's workspace is meant to be exclusive.
- **MLflow logging never raises**: any change to `mlflow_logging.py` must preserve the property that every public method on `_Run` catches its own exceptions; a training run must never fail because of a logging problem.
