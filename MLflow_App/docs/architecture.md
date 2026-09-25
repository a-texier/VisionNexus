---
app: mlflow
doc_type: architecture
audience: dev
lang: en
title: Architecture
order: 60
tags: [fastapi, mlflow sdk, sqlite, serverless, supervisor, lineage]
sources: [MLflow_App/backend/main.py, MLflow_App/backend/config.py, MLflow_App/backend/core/mlflow_client.py, MLflow_App/backend/api/experiments.py, MLflow_App/backend/api/runs.py, MLflow_App/backend/api/models.py, MLflow_App/backend/api/compare.py, Training_App/backend/services/mlflow_logging.py, Orchestrator_App/backend/core/graph_runner.py, MLflow_App/frontend/src/pages/LineagePage.tsx]
---

# Architecture

## Components overview of MLflow App

MLflow App is a thin FastAPI backend around the MLflow Python SDK's `MlflowClient`, plus a Vite/React frontend. It holds no database and no business logic of its own beyond formatting: every read goes straight to `MlflowClient` against a tracking URI resolved once at import time, and every write endpoint (`POST /api/experiments`, the stage transition endpoint, `POST /api/runs/{id}/tags`) is a thin pass-through to the SDK.

The app is a **supervisor**, not a pipeline participant: it has no `orchestrator.py` router, unlike DVC App and Optuna App, because it never drives a pipeline step. Its only integration with the Orchestrator is one-directional and read-only from the frontend: the Lineage page fetches `/orchestrator-api/lineage` and `/orchestrator-api/apps` to draw its graph, and the Orchestrator, in the other direction, calls this app's own `GET /api/experiments`, `GET /api/runs` and `POST /api/runs/{id}/tags` through its proxy client to read run data and backfill lineage tags after a DVC commit.

## Serverless store: the pivot away from `mlflow server`

`backend/config.py` resolves `MLFLOW_TRACKING_URI` from the environment, defaulting to `sqlite:///<workspace>/mlflow_data/mlflow.db`; `MLFLOW_ARTIFACT_ROOT` points at `mlflow_data/artifacts/` as a `file://` URI. `backend/core/mlflow_client.py::get_client()` builds a fresh `MlflowClient(tracking_uri=MLFLOW_TRACKING_URI)` on every call; there is no long-lived client instance to keep in sync, since the SQLite file itself is the shared state.

`_is_http_uri()` checks whether the URI starts with `http(s)://`. With the default `sqlite:///` URI, `ensure_mlflow_running()` starts no process at all and only confirms the file is reachable via `is_mlflow_running()` (`search_experiments(max_results=1)`); no port is opened, so there is nothing to collide or disconnect. Only when `MLFLOW_TRACKING_URI` is explicitly set to an `http://` or `https://` URL does `ensure_mlflow_running()` spawn `python -m mlflow server` as a subprocess and poll it, for compatibility with the pre-2026-07 legacy setup; `stop_mlflow_server()` terminates that subprocess on shutdown, and is a no-op in the default mode.

## Shared store and the writer side

MLflow App never receives a "push" from a writer app; there is no network call between Training App and MLflow App for logging. Both resolve the exact same file path independently: `backend/config.py` here computes `<MLFLOW_APP_WORKSPACE>/mlflow_data/mlflow.db`, while `Training_App/backend/services/mlflow_logging.py::resolve_tracking_uri()` computes `<workspace>.parent / mlflow_<user> / mlflow_data / mlflow.db` from its own workspace, a sibling folder under the same `<workspaces-root>` and the same `<user>`. When the Orchestrator launches a writer app, it can also inject `IA_MLFLOW_TRACKING_URI` directly, which `resolve_tracking_uri()` prefers over the computed sibling path.

`mlflow_logging.py` (duplicated identically in every writer app, not imported across app boundaries) is entirely defensive: every method of its `_Run` wrapper (`log_metrics`, `log_params`, `log_artifact`, `set_tags`, `register_model`, `finish`) is wrapped in a bare `try/except Exception: pass`, and `start_run()`/`mlflow_run()` return a `_Run(mlflow, ok=False)` stub if `mlflow.start_run()` itself raises. A training never fails, slows down noticeably, or changes behavior because MLflow logging failed; it simply produces no visible run.

`_use_experiment()` on the writer side creates an experiment's artifact location explicitly under `<store>/artifacts/<experiment>/` when the experiment does not exist yet, rather than accepting MLflow's own default of `./mlruns` relative to the writer process's working directory, which would otherwise scatter artifacts outside any workspace this app knows how to serve.

## Backend routers

`backend/main.py` builds the FastAPI app with a `lifespan` that calls `ensure_mlflow_running()` on startup and `stop_mlflow_server()` on shutdown (both no-ops in the default serverless mode), and mounts five routers plus the `docs` router added for this documentation set: `experiments`, `runs`, `models`, `compare`, `settings`, `docs`. `/health` and the workspace helpers (`/api/workspace/users`, `/api/workspace/open`, `/api/workspace/history`) are defined directly on the app, identical in source to the other apps of the suite.

Every router shares the same `_require_mlflow()` guard, raising a 503 before touching `MlflowClient` if `is_mlflow_running()` is false, so a store that is briefly unreachable produces one consistent error shape everywhere instead of a raw SDK exception leaking through.

- `api/experiments.py`: `GET`/`POST`/`DELETE /api/experiments`, plus `GET /api/mlflow-status` used by the sidebar dot.
- `api/runs.py`: `GET /api/runs` (by `experiment_id`), `GET /api/runs/{id}` (with its full metric history and artifact listing), `POST /api/runs/{id}/tags` (used by the Orchestrator's lineage backfill after a DVC commit), and the artifact-serving pair `GET /api/runs/{id}/artifacts` (listing) and `GET /api/runs/{id}/artifact` (a single image file, restricted to `.png`/`.jpg`/`.jpeg`).
- `api/models.py`: `GET /api/models`, `GET /api/models/{name}/versions` and the stage-transition endpoint.
- `api/compare.py`: `POST /api/compare`, computing the union and intersection of metric and parameter keys across the requested runs server-side, so the frontend never has to reconcile mismatched keys itself.
- `api/docs.py`: serves this documentation set to the frontend's Doc page.

## Frontend structure and the Lineage graph

`frontend/src/App.tsx` is a single sidebar layout with six routes: `/` and `/lineage` (`LineagePage`), `/experiments` (`ExperimentsPage`, reachable but not in the sidebar), `/runs/:runId` (`RunDetailPage`), `/models` (`ModelRegistryPage`), `/compare` (`CompareRunsPage`) and `/doc` (`DocPage`). `api/client.ts` holds every typed call to this app's own backend; `LineagePage.tsx` additionally calls the Orchestrator directly through `axios` at `/orchestrator-api/lineage` and `/orchestrator-api/apps`, bypassing `api/client.ts`, since that data does not come from this app's own backend.

`LineagePage.tsx::build()` merges two sources into one graph: the Orchestrator's canonical `{nodes, edges}` payload (source dataset, subsets, one node per pipeline run) and this app's own `runsAPI.list()` per experiment (used to attach live metrics onto each run's stage nodes via `stageById`, keyed by `run_id`). A run's frame height and the graph's total width are computed from its stage count so that collapsed runs (`collapsed` state, toggled per run) take less space without needing a second layout pass.

## Invariants that must not be broken

- **Never spawn an `mlflow server` process in the default configuration.** `ensure_mlflow_running()` must keep gating server-mode startup strictly on `_is_http_uri()`; starting a server unconditionally would reintroduce the port collisions and disconnects the 2026-07 pivot removed.
- **Both sides of the shared store must keep resolving the same path.** Any change to the workspace-to-store path formula in `backend/config.py` must be mirrored in every writer app's `mlflow_logging.py::resolve_tracking_uri()`, or runs silently stop appearing for one side while the other still logs successfully.
- **Writer-side logging stays 100% defensive.** `mlflow_logging.py`'s bare `except Exception: pass` around every SDK call is deliberate: a training must never fail, slow down, or change its saved artifacts because MLflow logging raised.
- **MLflow App drives no pipeline step.** Adding an `orchestrator.py` router or any endpoint the Orchestrator would call to advance a graph would break the supervisor contract documented in `Orchestrator_App/CLAUDE.md` and change how the Orchestrator decides which apps to auto-launch.
- **Lineage tags are additive, never inferred.** `git_commit` and `dataset_version` are written only by the Orchestrator's DVC-commit backfill; MLflow App must not guess or reconstruct them from other fields when they are absent, since [Concepts](concepts.md) documents their absence as meaningful (no DVC commit yet) rather than as missing data to paper over.
