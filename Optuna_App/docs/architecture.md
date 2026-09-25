---
app: optuna
doc_type: architecture
audience: dev
lang: en
title: Architecture
order: 60
tags: [fastapi, optuna, sqlite, sse, background thread, training app]
sources: [Optuna_App/backend/main.py, Optuna_App/backend/config.py, Optuna_App/backend/core/optuna_runner.py, Optuna_App/backend/core/diagnostics.py, Optuna_App/backend/api/studies.py, Optuna_App/backend/api/orchestrator.py, Optuna_App/backend/hpo_trial.py, Optuna_App/frontend/src/App.tsx]
---

# Architecture

## Components overview of Optuna App

Optuna App is a FastAPI backend plus a Vite/React frontend, with Optuna's own SQLite storage as the only database. It has two independent ways of running an optimization, sharing the same storage and dashboard:

- The **standalone runner** (`backend/core/optuna_runner.py`), used by the studies created and launched from the interface, which runs a background thread per study and streams logs over server-sent events.
- The **Orchestrator endpoint** (`backend/api/orchestrator.py`), used when a pipeline node calls `POST /api/orchestrator/hpo`, which runs a blocking Optuna study inside the HTTP request itself.

Both write to the same `optuna.db` and reuse the same failure diagnosis code (`backend/core/diagnostics.py`), so a study looks the same on the study page whatever launched it.

## Backend application startup

`backend/main.py` builds the FastAPI app with a `lifespan` that pings the Optuna storage (`optuna.get_all_study_summaries`) to confirm the SQLite file is reachable, logging a warning instead of failing if it is not yet initialized. It mounts four routers (`studies`, `settings`, `orchestrator`, `docs`) and defines directly on the app: `/health`, and the workspace helpers `/api/workspace/users`, `/api/workspace/open` and `/api/workspace/history` shared in source with the other apps of the suite (Annotation, MLflow, DVC each carry their own copy). CORS is configured from `CORS_ORIGINS` in `backend/config.py`, which always includes the current frontend port alongside the suite's usual range of ports so that a manually launched frontend on a different port still reaches the backend.

## Routers and services of the backend

`backend/config.py` resolves the workspace (`OPTUNA_APP_WORKSPACE`), the SQLite storage URL (`OPTUNA_STORAGE`), the ports and the CORS origins; every other module imports from it.

- `backend/api/studies.py`: CRUD on studies (`GET`/`POST`/`DELETE /api/studies`), trial listing, the `/analysis` endpoint that computes the whole dashboard payload, `/best`, `/start`, `/stop`, `/status` and the SSE `/logs` endpoint. It also holds the state-qualification logic (`_effective_state`, `_is_stale_running`) and the legacy-recovery logic (`_recover_legacy_artifacts`, `_legacy_log_diagnostic`) that never rewrite the Optuna database.
- `backend/api/orchestrator.py`: `GET /api/orchestrator/engines` (lists the training engines and their HPO catalog) and `POST /api/orchestrator/hpo` (runs one blocking study).
- `backend/api/settings.py`: `GET`/`PUT /api/settings`, a small JSON file in the workspace (workspace path and user name are always overridden from the environment, never persisted).
- `backend/api/docs.py`: serves the pages of this documentation set to the frontend's Documentation page.
- `backend/core/optuna_runner.py`: the standalone runner (see below).
- `backend/core/diagnostics.py`: `diagnose_failure(raw_text)`, a shared rule table that turns a raw error or stderr excerpt into `{code, title, reason, action}`, used by both runners and by the Orchestrator response.
- `backend/hpo_trial.py`: the reference trial script for Orchestrator studies and for the detection preset (see below).

## Standalone runner: background thread and SSE

`start_optimization()` refuses to start if a `StudyRunState` for the same study is already `running` (module-level dict `_study_states`, one entry per study name, surviving frontend navigation but not a backend restart). Otherwise it spawns a daemon `threading.Thread` running `_run()`, which calls Optuna's synchronous `study.optimize()` with a `TPESampler` and a `NopPruner`, and an `objective()` closure that:

1. Suggests each hyperparameter of `param_space` with `trial.suggest_float/int/categorical`.
2. Builds `python <script> <script_args> --k1 v1 --k2 v2 ...` and runs it with `subprocess.run(..., timeout=3600)`.
3. On a non-zero exit code, a timeout, or an unparsable last line, calls `diagnose_failure()`, stores its fields as `trial.user_attrs["failure_*"]` and raises `RuntimeError` (caught by Optuna's `catch=(RuntimeError,)`, so the trial is marked `FAIL` and the study continues).
4. On success, parses the last stdout line as a float (or a `metric_name=value` line as a fallback) and returns it.

`StudyRunState.add_log()` appends timestamped lines to an in-memory list capped at 500 entries. `stream_logs()` is an async generator that polls this list and yields the new lines plus a status event as `text/event-stream`, until the state reaches `finished`, `stopped` or `error`. The frontend connects to it directly at the backend port (`api/client.ts::streamLogs`), bypassing the Vite proxy, which buffers SSE.

## Orchestrator endpoint: blocking study in the request

`run_hpo()` resolves `data.yaml` from the request's `dataset_path` or `data_yaml` (extracting a `.zip` export once into `hpo_datasets/`), loads the engine catalog from Training App via `sys.path` injection (`_TRAINING_APP_BACKEND = ../Training_App/backend`), and builds the search space from the catalog's `hpo_ranges`, filtered by the requested `optimize` keys (or the catalog's default selection). It then creates a fresh study (name derived from the graph/run/node/attempt identifiers, or from the dataset folder name) and calls `study.optimize()` synchronously in the request handler: **the HTTP call does not return until every trial is done**, unlike every other `orchestrator.py` endpoint in the suite, which returns a `run_id` to poll immediately.

Each trial's `objective()` runs `python hpo_trial.py --data_yaml ... --engine ... --result_json <trial_dir>/result.json ...` with a per-trial timeout (`trial_timeout_s`, default 1200 s), writes `stdout.log`/`stderr.log` under `hpo_runs/<study>/trial_<NNNN>/`, and on success reads `objective_value` from `result.json` rather than from stdout (Windows console encoding can otherwise corrupt or drop stdout before it reaches the parent, hence the JSON-file transport). `ACTIVE_HPO_STUDIES` is a module-level set of study names currently running here, checked by `studies.py::_is_active_here()` so the study page does not flag a genuinely running Orchestrator study as `INTERRUPTED`.

## Trial script contract (hpo_trial.py)

`hpo_trial.py` is the single reference implementation of a trial for both the Orchestrator endpoint and the detection preset. It imports `services.trainer_backend` from Training App via `sys.path` (same cross-app pattern as `Inference_App/backend/services/tracker_bridge.py`), resolves the requested engine and model size, merges the free `--key value` CLI arguments against the engine's catalog (unknown keys are ignored and reported in `ignored_params`), instantiates the engine's trainer class and calls `.train()`.

It writes its result atomically (`_write_result`: write to a `.tmp` file, then `os.replace`) to `--result_json`, with `status: "completed"` or `"failed"`, the objective value and both `map50`/`map5095`, and the paths of `results.csv` and the checkpoints. For backward compatibility with the plain stdout contract, it also prints `metric=value` and the bare value to `sys.__stdout__` explicitly (a training engine can redirect `sys.stdout` to its own logger, which would otherwise swallow these lines before they reach the parent process's pipe).

## Failure diagnosis and legacy trial recovery

`diagnose_failure(raw_text)` in `backend/core/diagnostics.py` is an ordered list of `(patterns, code, title, action)` rules matched against the lowercased error text (MLflow-store errors are checked before model-missing errors, since an MLflow traceback mentioning "model"/"store" would otherwise be misclassified). Both runners call it once per failed trial and store the four fields as trial user attributes, which `studies.py` reads back unchanged.

`studies.py` additionally reconstructs information for trials that predate this diagnosis system or that were abandoned:

- `_is_stale_running()`: a `RUNNING` trial older than 30 minutes with no matching entry in `ACTIVE_HPO_STUDIES` or `StudyRunState` is read as `INTERRUPTED`, a read-time qualification never written back to Optuna's database.
- `_recover_legacy_artifacts()`: for an old `FAIL`/`PRUNED` trial with no `artifact_dir` attribute, matches it against Ultralytics `runs/detect/*/args.yaml` by comparing hyperparameters and timestamp, to surface its `results.csv` and weights as "informative, not COMPLETE" without changing the trial's state.
- `_legacy_log_diagnostic()`: scans `optuna_backend_*.log` files for a dataset-loading failure matching an old `PRUNED` trial's timestamp and number.

## Frontend structure

The React app (`frontend/src/App.tsx`) is a single sidebar layout with five routes: `/` (`StudiesPage`), `/studies/:studyName` (`StudyDetailPage`), `/studies/:studyName/launch` (`LaunchPage`), `/learn/hpo` (`HPOLearnPage`) and `/guide` (`GuidePage`, this documentation). `StudyDashboard.tsx` groups the eight analysis panels (overview, search space, history, distribution, heat map, TPE evolution, importance, pruning summary, parallel coordinates) consumed by `StudyDetailPage`, all driven by the single `GET /api/studies/{name}/analysis` payload plus the trial list. `EnginePreset.tsx` calls `GET /api/orchestrator/engines` once on mount and, when engines are available, renders the detection-training preset shown on `LaunchPage`.

TanStack Query drives all data fetching with per-endpoint `refetchInterval`s (5 s for the running-studies badge, 15 s for the studies list, 2 s or 10 s for a study's status depending on whether it is running, 5 s or 30 s for its analysis). `i18n/translate.ts` holds a French-to-English exact-match dictionary; French is the source language in the code and English is a translation layer applied at render time through `t()`.

## Invariants that must not be broken

- **Single uvicorn worker.** Optuna's SQLite storage is not safe for concurrent writers; running with `--workers > 1` corrupts study state under concurrent trial writes.
- **`ACTIVE_HPO_STUDIES` and `StudyRunState` are process-local.** A backend restart loses them; any study genuinely running at that moment will be read back as `INTERRUPTED` once the 30-minute staleness window elapses, which is a deliberate read-time signal, not a bug to "fix" by persisting these sets.
- **Never rewrite Optuna's own trial state from `studies.py`.** `INTERRUPTED`, `LEGACY_PRUNED_UNKNOWN` and `LEGACY_FAILURE_RECOVERED` are display-only qualifications computed on every read; recovered artifacts and legacy log matches are surfaced as separate fields, never used to silently promote a `FAIL`/`PRUNED` trial to `COMPLETE`.
- **The trial script prints last-line-then-nothing.** Any change to `hpo_trial.py`'s trailing output, or to the engine's stdout handling, that prevents the final bare value from reaching `sys.__stdout__` breaks the fallback stdout contract that the detection preset and any hand-written script still rely on.
- **`/api/orchestrator/hpo` stays blocking.** It is the one `orchestrator.py` in the suite designed to hold the HTTP connection for the whole study; changing it to return a pollable `run_id` would break the Orchestrator's current `pipeline_runner.py` integration, which awaits the response directly.
