---
app: orchestrator
doc_type: configuration
audience: both
lang: en
title: Configuration
order: 40
tags: [launcher, ports, environment variables, workspace, conda, cors]
sources: [Orchestrator_App/launcher.py, Orchestrator_App/backend/config.py, Orchestrator_App/backend/core/app_launcher.py, Orchestrator_App/start.sh, Orchestrator_App/frontend/vite.config.ts, _lib/launcher_engine.py]
---

# Configuration

## Launching Orchestrator App

The normal way to start the app is `launcher.py`, which allocates ports, builds the workspace layout and starts both the backend and the frontend:

```bash
cd Orchestrator_App
python launcher.py --user alice --workspace C:/ws
```

`--user` and `--workspace` are required. The final backend workspace is `<workspace>/orchestrator_<user>/`. Other flags: `--conda-env` (default `IA_env`), `--backend-port` and `--frontend-port` (fixed ports instead of automatic allocation), `--backend-only` (skip the frontend), `--reload` (enable uvicorn auto-reload, development only) and `--access-log` (enable uvicorn per-request access logs). VisionNexus launches the app the same way, through `_lib/launcher_engine.py`, which shares the same port registry and lock file.

On Linux, `start.sh` is a minimal alternative that reads `BACKEND_PORT` and `ORCHESTRATOR_FRONTEND_PORT` from the environment (defaulting to 8000 and 3000) and starts uvicorn with `--reload`; it does not allocate ports or set up the workspace, so use `launcher.py` unless you already have a working environment.

Never start `uvicorn backend.main:app` directly without `ORCHESTRATOR_WORKSPACE` and `ORCHESTRATOR_USER` set: the backend would write to the default `data/` workspace and, worse, refuses to start entirely if it cannot resolve a real, non-placeholder user name (see "Current user resolution" below).

## Ports

Default backend port: **8060**. Default frontend port: **3000**. Both are allocated dynamically from these bases if taken, using a lock file shared with every other app of the suite (`Computer_Vision_App/.run/.port_lock` and `.instances.json`), so two users or two apps launched at the same time never collide.

Reference table for the whole suite, as seen from `config.py`'s `APP_URLS`:

| Service | Default port |
|---|---|
| Orchestrator backend | 8060 |
| Orchestrator frontend | 3000 |
| Annotation_App | 8000 |
| Dataset_Explorer_App | 8001 |
| dvc-app | 8061 |
| mlflow-app | 8062 |
| optuna-app | 8063 |
| Training_App | 8064 |
| Inference_App | 8065 |

`APP_URLS` and `APP_FRONTEND_URLS` are mutable dictionaries: `app_launcher.py` patches them in place with the real port of each sub-app once it launches it, or once it detects that instance is already running. Backend-to-backend calls always use `127.0.0.1`, never `localhost`, because on Windows `localhost` can resolve to `::1` (IPv6) while uvicorn only listens on IPv4, which otherwise causes phantom "offline" badges.

## Environment variables

Set by `launcher.py` (or by VisionNexus through `_lib/launcher_engine.py`); read by `backend/config.py`:

| Variable | Meaning |
|---|---|
| `ORCHESTRATOR_WORKSPACE` | Backend workspace root, `<workspace>/orchestrator_<user>/`. Defaults to `Orchestrator_App/data/` if unset. |
| `ORCHESTRATOR_USER` | Current user id. Required for real use; see below. |
| `BACKEND_PORT` | Backend listen port (default 8060). |
| `ORCHESTRATOR_FRONTEND_PORT` | Frontend dev server port (default 3000). |
| `VITE_BACKEND_PORT` | Read by `vite.config.ts` to build the `/api` proxy target. |

Each sub-application, once launched by Orchestrator, receives its own env vars (`ANNOTATION_APP_URL`, `DATASET_EXPLORER_APP_URL`, `TRAINING_APP_URL`, `INFERENCE_APP_URL`, `DVC_APP_URL`, `MLFLOW_APP_URL`, `OPTUNA_APP_URL`, plus the matching `*_FRONTEND_URL` variables) so that Orchestrator can reach it; these can also be set manually to point at an already-running instance instead of letting Orchestrator launch one.

### Current user resolution

`ORCHESTRATOR_USER` is never allowed to fall back to a shared placeholder such as `unknown`, `user` or an empty string: all multi-user isolation (workspace paths, the shared port registry key) rests on this single value, and two users silently sharing `annotation_unknown` would mean sharing the same SQLite database and caches with no warning at all. If `ORCHESTRATOR_USER` is unset or is one of these placeholders, the backend tries the OS login next; if that also fails, startup is refused with an explicit error asking you to pass a real user name.

## Workspace layout on disk

```
{WORKSPACE}/
  orchestrator_{user}/
    graphs/experiments.json      every saved sandgraph (nodes, edges, execution state)
    pipelines/                   generated PipelineDef JSON files, one per run
    insights/{graph_id}/{run_id}/  insights.json, insights.md, metrics.json, plots
    runs/{run_id}/manifest.json  canonical index of one run's outputs
    plans/plans.json             Experiment Plans
    activity.json                append-only run log (max 200 entries)
    experiments.json             legacy experiment records
    launcher_state.json          sub-app session state (pid, ports, workspace)
    settings.json                user preferences (theme, ui_language)
    debug.html                   colorized developer debug log, overwritten at each startup
  explorer_{user}/                 Dataset_Explorer_App workspace
    subsets/{name}/               each subset Dataset Explorer created
  annotation_{user}/           Annotation_App workspace
    imports/                     images staged for a new annotation project
    exports/                     `{name}-yolo/`, `{name}.zip` or `{name}.ver` outputs
  dvc_{user}/                   dvc-app workspace (Git + DVC repo)
  mlflow_{user}/                mlflow-app workspace (SQLite MLflow store)
  optuna_{user}/                optuna-app workspace
  training_{user}/              Training_App workspace (runs, exported weights)
  inference_{user}/             Inference_App workspace
```

`explorer_{user}/subsets/` and `annotation_{user}/exports/` are the only two locations Orchestrator scans to build the FREE-mode lists of existing subsets and exports; it never asks a sub-application over HTTP for this. Everything is human-readable JSON: to inspect a graph's raw state, read `graphs/experiments.json`; for the run history, `activity.json`.

## Conda environment and Node.js

Every sub-application launched by Orchestrator runs with the same conda environment (default `IA_env`, overridable with `--conda-env` on `launcher.py` or per-launch on the **Applications** page). `app_launcher.py` looks for `python.exe` under `<conda root>/envs/<env>/` next to the currently running Python interpreter; on Linux it falls back to `envs/<env>/bin/python`.

For the frontend dev servers, Orchestrator prefers a Node.js binary bundled with the suite (`<Computer_Vision_App>/node-v20.20.2-linux-x64/bin` on Linux) over the system `npm`, so an offline deployment does not depend on Node being installed separately; on Windows it always uses the system `npm.cmd`.

## CORS and network access

The backend accepts requests from `http://localhost:<FRONTEND_PORT>` and `http://127.0.0.1:<FRONTEND_PORT>` (the configured frontend port), plus the fixed defaults `3000`, `5173`, `5174` and `5175`/`5176` on both `localhost` and `127.0.0.1`, to cover the frontend dev servers of the whole suite during local development. This list is not meant to be edited for a normal deployment; if you serve the frontend from a different origin, adjust `_cors_origins` in `backend/config.py`.

The Vite dev server proxies every `/api/*` request to the backend target (`http://localhost:<BACKEND_PORT>`) with a 300-second timeout, so the frontend always calls relative URLs. The one exception is the SSE run stream: it uses a fixed empty `BACKEND_BASE` (`''`, meaning same-origin, still through the proxy) rather than an absolute URL, because an absolute cross-origin URL used to break SSE entirely when the app was opened from a LAN IP address instead of `localhost`.
