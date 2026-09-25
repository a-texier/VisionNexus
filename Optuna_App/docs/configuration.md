---
app: optuna
doc_type: configuration
audience: both
lang: en
title: Configuration
order: 40
tags: [installation, ports, environment variables, workspace, launcher]
sources: [Optuna_App/backend/config.py, Optuna_App/launcher.py, Optuna_App/start.sh, _lib/launcher_engine.py, Optuna_App/pyproject.toml]
---

# Configuration

## System requirements for Optuna App

Optuna App runs on Windows and on Linux x86_64 (the usual target for a remote GPU VM). It needs a Python environment for the backend and Node.js for the frontend.

| Component | Minimum | Notes |
|---|---|---|
| Python | 3.10+ | Conda environment `IA_env` by default |
| Node.js / npm | 18+ / 8+ | For the Vite frontend |
| NVIDIA GPU | recommended | Only needed for the detection training preset; a study on a CPU-only script works without one |
| Disk | a few GB | `optuna.db`, logs, and the per-trial folders under `hpo_runs/` (checkpoints included) |

Python dependencies: `fastapi`, `uvicorn`, `optuna`. Installing them with `pip install fastapi uvicorn optuna` is enough for a standalone study on your own script. The detection training preset additionally needs Training App to be present next to Optuna App, with its own training dependencies installed.

## Launching Optuna App from VisionNexus or the suite launcher

The normal way to run Optuna App is through the suite launcher, directly or from the VisionNexus desktop application.

From the suite root:

```bash
python launcher.py --app optuna --workspace <workspaces-root> --user <user>
```

Directly from the app folder:

```bash
cd Optuna_App
python launcher.py --workspace <workspaces-root> --user <user>
```

Options of `Optuna_App/launcher.py`:

| Option | Default | Effect |
|---|---|---|
| `--user` | required | User name; the workspace is `<workspaces-root>/optuna_<user>` |
| `--workspace` | required | Root folder of all workspaces |
| `--conda-env` | `IA_env` | Conda environment used to find Python |
| `--backend-port` / `--frontend-port` | automatic | Force the ports instead of allocating free ones |
| `--backend-only` | off | Start only the API |
| `--no-reload` | off | Start uvicorn without auto-reload |
| `--access-log` | off | Print every HTTP request |

The launcher creates the workspace, registers the instance in the suite's shared `.run/.instances.json`, starts uvicorn and the Vite dev server, and stops both on `Ctrl+C`.

## Launching the backend and frontend manually

For development, or for a study on your own script without the rest of the suite, the backend and the frontend can be started by hand. Without the launcher, the workspace defaults to `Optuna_App/data/`.

Terminal 1, backend (from `Optuna_App/`):

```bash
pip install fastapi uvicorn optuna
uvicorn backend.main:app --host 127.0.0.1 --port 8003 --reload
```

Terminal 2, frontend:

```bash
cd Optuna_App/frontend
npm install
npm run dev
```

`bash start.sh` runs both terminals for you on Linux, with the same default ports. Always run a single uvicorn worker: Optuna's SQLite storage is not safe for multi-process writes. To point a manual backend at an existing workspace instead of the default `Optuna_App/data/`, export `OPTUNA_APP_WORKSPACE` before starting uvicorn; to change the frontend's target port, export `VITE_BACKEND_PORT` before `npm run dev`.

## Ports and network access

Optuna App uses two ports: the FastAPI backend and the Vite frontend.

| Service | Standalone default | Full-stack (launcher) default | Environment variable |
|---|---|---|---|
| Backend (FastAPI) | 8003 | 8063 | `BACKEND_PORT` |
| Frontend (Vite) | 3003 | 3003 | `OPTUNA_APP_FRONTEND_PORT` |

The standalone default (`backend/config.py`, `start.sh`) and the full-stack starting port (`launcher.py`, `_lib/launcher_engine.py`) are not the same for the backend: a manual launch without the launcher opens port 8003, while the suite launcher starts allocating from 8063 upward so that Optuna App does not collide with DVC App (8061) and MLflow App (8062). The frontend base is 3003 in both modes. When several users or instances run on the same machine, the launcher allocates the first free ports from these bases and records them in `<suite root>/.run/.instances.json`.

The backend allows cross-origin requests from ports 3001 to 3003 and 5173 to 5174 on `localhost` and `127.0.0.1`, plus the current frontend port. The frontend proxies `/api` to the backend port (`vite.config.ts`); the study logs (`GET /api/studies/{name}/logs`) connect straight to the backend port instead, to avoid the buffering of the Vite proxy on server-sent events.

## Environment variables of Optuna App

Most variables are set by the launcher; set them yourself only for manual launches.

| Variable | Default | Effect |
|---|---|---|
| `OPTUNA_APP_WORKSPACE` | `Optuna_App/data` | Workspace folder: study database, logs, settings |
| `OPTUNA_APP_USER` | `unknown` | Current user name |
| `BACKEND_PORT` | `8003` | Backend port (used for CORS and study storage messages) |
| `OPTUNA_APP_FRONTEND_PORT` | `3003` | Frontend port (added to the allowed CORS origins) |
| `VITE_BACKEND_PORT`, `VITE_FRONTEND_PORT` | `8063`, `3003` | Ports used by the Vite dev server and its `/api` proxy |
| `VITE_IA_USER`, `IA_USER` | none | User name shown by the frontend and recorded by the launcher |
| `VITE_CACHE_DIR` | Vite default | Separate Vite cache per instance |
| `IA_APP_ID`, `IA_INSTANCES_FILE`, `IA_WORKSPACE_HISTORY_FILE` | set by the launcher | Instance registry and workspace history shown in the user badge |

Variables must be set before uvicorn starts; changing them afterwards has no effect.

## Workspace layout on disk

The workspace is the folder that holds all the data of one user. With the launcher it is `<workspaces-root>/optuna_<user>/`; a manual launch without `OPTUNA_APP_WORKSPACE` uses `Optuna_App/data/`.

```text
optuna_<user>/
  optuna.db              SQLite database (Optuna's native storage): every study and trial
  settings.json           Application settings (workspace path, user name written back)
  logs/                   Created by the launcher; reserved for backend log files
  hpo_runs/<study>/
    trial_<n>/             Orchestrator trial: result.json, stdout.log, stderr.log, results.csv, checkpoints
    trial_<date>_<pid>/    Standalone trial launched with the detection preset (no --trial_dir given)
  hpo_datasets/<name>/     YOLO dataset extracted once from an Annotation Zip export, reused by later trials
```

`optuna.db` is the single source of truth for studies and trials: deleting it loses every study. Deleting a `hpo_runs/` folder only loses the on-disk artifacts (checkpoints, per-epoch CSV) of the matching trials; the trial still exists in the database with its recorded objective value. To back up a workspace, copy `optuna.db` together with `hpo_runs/` if you also want to keep the checkpoints of past trials; `hpo_datasets/` can always be rebuilt from the original export and does not need backing up.

## Defaults of the trials and of the preset

These values are not settings of the app; they are defaults applied where the study is started.

| Default | Value | Where |
|---|---|---|
| Epochs per trial (preset and Orchestrator) | 10 | `EnginePreset.tsx`, `HpoRequest.epochs` |
| Trial timeout (Orchestrator) | 1200 s (20 min) | `HpoRequest.trial_timeout_s` |
| Trial timeout (standalone script) | 3600 s (1 h) | `optuna_runner.py` |
| DataLoader workers | 0 on Windows, 2 elsewhere | `HpoRequest.workers`, avoids multiprocessing DataLoader freezes on Windows |
| Sampler | TPE (`TPESampler`), 10 startup trials | fixed, not configurable from the interface |
| Pruner | disabled (`NopPruner`) | fixed; the engines do not report per-epoch metrics yet |
| Failure policy (Orchestrator) | stop the pipeline | `HpoRequest.stop_on_failure`, can be turned off on the Optuna node |

## Verifying the installation

1. Start the backend and open `http://localhost:<backend-port>/health`: it answers `{"status": "ok", "study_count": N}`.
2. Open the frontend and check that the studies page loads without an error toast.
3. Create a test study, launch it on a trivial script (see [Workflows](workflows.md)) and confirm that a trial appears with a `COMPLETE` state.
4. For the detection preset, open `http://localhost:<backend-port>/api/orchestrator/engines`: a non-empty `engines` list confirms that Training App is reachable; an `error` field explains why not.
5. For an Orchestrator study, run a small pipeline with an Optuna node in automatic mode with a low **Number of trials** and check that the node finishes with a non-empty `best_params` before relying on it for a real training run.
