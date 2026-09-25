---
app: mlflow
doc_type: configuration
audience: both
lang: en
title: Configuration
order: 40
tags: [installation, ports, environment variables, workspace, launcher, serverless]
sources: [MLflow_App/backend/config.py, MLflow_App/launcher.py, MLflow_App/start.sh, _lib/launcher_engine.py]
---

# Configuration

## System requirements for MLflow App

MLflow App runs on Windows and on Linux x86_64. It needs a Python environment for the backend and Node.js for the frontend. It needs no GPU: it only reads a SQLite file and serves it.

| Component | Minimum | Notes |
|---|---|---|
| Python | 3.10+ | Conda environment `IA_env` by default; needs the `mlflow` package |
| Node.js / npm | 18+ / 8+ | For the Vite frontend |
| Disk | depends on training artifacts | The store grows with the plots and weights logged by writer apps, not with MLflow App itself |

MLflow App has no dependency on a GPU or on the training engines: it never runs a training or an evaluation itself. The apps that write to the store (Training App, and any other app with its own `mlflow_logging.py`) have their own, separate requirements.

## Launching MLflow App from VisionNexus or the suite launcher

The normal way to run MLflow App is through the suite launcher, directly or from the VisionNexus desktop application.

From the suite root:

```bash
python launcher.py --app mlflow --workspace <workspaces-root> --user <user>
```

Directly from the app folder:

```bash
cd MLflow_App
python launcher.py --workspace <workspaces-root> --user <user>
```

Options of `MLflow_App/launcher.py` mirror those of the other apps of the suite: `--user` and `--workspace` (required), `--conda-env` (default `IA_env`), `--backend-port`/`--frontend-port` (automatic by default), `--backend-only`, `--no-reload` and `--access-log`. The launcher creates the workspace, registers the instance in the suite's shared `.run/.instances.json`, starts uvicorn and the Vite dev server, and stops both on `Ctrl+C`.

## Launching the backend and frontend manually

For development, the backend and the frontend can be started by hand. Without the launcher, the workspace defaults to `MLflow_App/data/`.

Terminal 1, backend (from `MLflow_App/`):

```bash
BACKEND_PORT=8001 python -m uvicorn backend.main:app --host 127.0.0.1 --port 8001 --reload
```

Terminal 2, frontend:

```bash
cd MLflow_App/frontend
VITE_BACKEND_PORT=8001 npm run dev -- --port 3001
```

`bash start.sh` runs both for you: it starts the backend, polls `/health` for up to 30 seconds before starting the frontend, and stops both on `Ctrl+C`. Always run a single uvicorn worker: the SQLite store is not safe for multi-process writes, whether from this backend or from a writer app running at the same time.

## Ports and network access

MLflow App uses two ports: the FastAPI backend and the Vite frontend.

| Service | Standalone default | Full-stack (launcher) default | Environment variable |
|---|---|---|---|
| Backend (FastAPI) | 8001 | 8062 | `BACKEND_PORT` |
| Frontend (Vite) | 3001 | 3001 | `MLFLOW_APP_FRONTEND_PORT` |

As with the other apps of the suite, the standalone default and the full-stack starting port differ for the backend: a manual launch opens port 8001, while the suite launcher starts allocating from 8062 upward, next to DVC App (8061) and before Optuna App (8063). The frontend base is 3001 in both modes. When several users or instances run on the same machine, the launcher allocates the first free ports from these bases and records them in `<suite root>/.run/.instances.json`.

The backend allows cross-origin requests from ports 3001 to 3003 and 5173 to 5174 on `localhost` and `127.0.0.1`, plus the current frontend port. The frontend also proxies `/orchestrator-api` to the Orchestrator's backend port (`VITE_ORCHESTRATOR_BACKEND_PORT`, 8060 by default), which the Lineage page uses to read the canonical lineage graph and the list of running apps.

## Environment variables of MLflow App

Most variables are set by the launcher; set them yourself only for manual launches.

| Variable | Default | Effect |
|---|---|---|
| `MLFLOW_APP_WORKSPACE` | `MLflow_App/data` | Workspace folder; `mlflow_data/` is created inside it |
| `MLFLOW_TRACKING_URI` | `sqlite:///<workspace>/mlflow_data/mlflow.db` | The store MLflow App reads. Setting an explicit `http://...` reactivates the legacy server mode (see [Architecture](architecture.md)) |
| `MLFLOW_APP_USER` | `unknown` | Current user name |
| `BACKEND_PORT` | `8001` | Backend port (used for CORS) |
| `MLFLOW_APP_FRONTEND_PORT` | `3001` | Frontend port (added to the allowed CORS origins) |
| `VITE_BACKEND_PORT`, `VITE_FRONTEND_PORT` | `8062`, `3001` | Ports used by the Vite dev server and its `/api` proxy |
| `VITE_ORCHESTRATOR_BACKEND_PORT` | `8060` | Backend port of the Orchestrator, used by the `/orchestrator-api` proxy on the Lineage page |
| `VITE_IA_USER`, `IA_USER` | none | User name shown by the frontend and recorded by the launcher |
| `IA_APP_ID`, `IA_INSTANCES_FILE`, `IA_WORKSPACE_HISTORY_FILE` | set by the launcher | Instance registry and workspace history shown in the user badge |

Variables must be set before uvicorn starts; changing them afterwards has no effect. `IA_MLFLOW_TRACKING_URI`, read by writer apps such as Training App, is a separate variable (set by the Orchestrator when it launches them) that resolves to the same store as `MLFLOW_TRACKING_URI` here when both point at the same user's workspace.

## Workspace layout on disk

With the launcher, the workspace is `<workspaces-root>/mlflow_<user>/`; a manual launch without `MLFLOW_APP_WORKSPACE` uses `MLflow_App/data/`.

```text
mlflow_<user>/
  mlflow_data/
    mlflow.db             SQLite database: every experiment, run, parameter, metric and tag
    artifacts/<experiment>/<run>/
      plots/               Training plots attached by the engine (served by GET /api/runs/{id}/artifact)
      model/                Registered weights, when the run produced one
  settings.json            Application settings (workspace path, user name written back)
```

`mlflow.db` is the source of truth: deleting it loses every experiment, run and registered model version. The `artifacts/` folder holds the actual files (plots, weights); deleting a run's artifact folder leaves the run's parameters and metrics intact in the database but breaks its plot gallery and its registered model's weights link.

Writer apps (Training App and any other app with its own `mlflow_logging.py`) resolve the exact same store path from their own workspace: `<their-workspace>.parent / mlflow_<user> / mlflow_data`, a sibling folder next to every app's own workspace under the same `<workspaces-root>`. This is why nothing needs to be configured on the MLflow App side to "receive" a run from another app: both sides compute the same path from the same user name.

## Verifying the installation

1. Start the backend and open `http://localhost:<backend-port>/health`: it answers `{"status": "ok", "mlflow_running": true}` once the store is reachable.
2. Open the frontend: the sidebar status dot should turn green with an MLflow version number within a few seconds.
3. If no run exists yet, log a test run from Training App (or any script using `mlflow_logging.py`) into the same user's workspace, then reload the Lineage page and confirm it appears.
4. Open a run's detail page and confirm its metrics and artifacts load; a broken artifact gallery with working metrics usually means the `artifacts/` folder was moved or deleted separately from `mlflow.db`.
