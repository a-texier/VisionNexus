---
app: dvc
doc_type: configuration
audience: both
lang: en
title: Configuration
order: 40
tags: [installation, ports, environment variables, workspace, launcher, repo]
sources: [DVC_App/backend/config.py, DVC_App/launcher.py, DVC_App/start.sh, _lib/launcher_engine.py, DVC_App/backend/core/dvc_runner.py]
---

# Configuration

## System requirements for DVC App

DVC App runs on Windows and on Linux x86_64. It needs a Python environment for the backend (with `git` and the `dvc` package available) and Node.js for the frontend. It needs no GPU.

| Component | Minimum | Notes |
|---|---|---|
| Python | 3.10+ | Conda environment `IA_env` by default; needs the `dvc` package |
| Git | any recent version | `git` must be on the `PATH` of the backend process |
| Node.js / npm | 18+ / 8+ | For the Vite frontend |
| Disk | dataset and model dependent | The DVC cache stores one physical copy per unique file; see [Concepts](concepts.md#cache-and-disk-usage) |

An initialized Git + DVC repository (`git init && dvc init`) is recommended at the target path, but the backend still starts without one; its routes then report a "repo not found" status, and `POST /api/orchestrator/commit` initializes it itself the first time it is called.

## Launching DVC App from VisionNexus or the suite launcher

The normal way to run DVC App is through the suite launcher, directly or from the VisionNexus desktop application.

From the suite root:

```bash
python launcher.py --app dvc --workspace <workspaces-root> --user <user>
```

Directly from the app folder:

```bash
cd DVC_App
python launcher.py --workspace <workspaces-root> --user <user>
```

Options of `DVC_App/launcher.py` mirror those of the other apps of the suite: `--user` and `--workspace` (required), `--conda-env` (default `IA_env`), `--backend-port`/`--frontend-port` (automatic by default), `--backend-only`, `--no-reload` and `--access-log`. The launcher creates the workspace and the repository folder, registers the instance in the suite's shared `.run/.instances.json`, starts uvicorn and the Vite dev server, and stops both on `Ctrl+C`.

## Launching the backend and frontend manually

For development, the backend and the frontend can be started by hand. Without the launcher, the workspace defaults to `DVC_App/data/` and the repository defaults to `<workspace>/repo`.

Terminal 1, backend (from `DVC_App/`):

```bash
DVC_REPO_PATH=/path/to/repo BACKEND_PORT=8002 python -m uvicorn backend.main:app --port 8002 --reload
```

Terminal 2, frontend:

```bash
cd DVC_App/frontend
VITE_BACKEND_PORT=8002 npm run dev -- --port 3002
```

`bash start.sh` runs both for you: it starts the backend, polls `/health` for up to 30 seconds before starting the frontend, and stops both on `Ctrl+C`. Always run a single uvicorn worker, and never call the bare `dvc` executable manually from a different shell while the backend is mid-operation on the same repository, to avoid concurrent writers to the same DVC cache.

## Ports and network access

DVC App uses two ports: the FastAPI backend and the Vite frontend.

| Service | Standalone default | Full-stack (launcher) default | Environment variable |
|---|---|---|---|
| Backend (FastAPI) | 8002 | 8061 | `BACKEND_PORT` |
| Frontend (Vite) | 3002 | 3002 | `DVC_APP_FRONTEND_PORT` |

As with the other apps of the suite, the standalone default and the full-stack starting port differ for the backend: a manual launch opens port 8002, while the suite launcher starts allocating from 8061 upward, the lowest base among DVC App (8061), MLflow App (8062) and Optuna App (8063). The frontend base is 3002 in both modes. When several users or instances run on the same machine, the launcher allocates the first free ports from these bases and records them in `<suite root>/.run/.instances.json`.

The backend allows cross-origin requests from ports 3001 to 3003 and 5173 to 5174 on `localhost` and `127.0.0.1`, plus the current frontend port. The frontend also proxies `/orchestrator-api` to the Orchestrator's backend port (`VITE_ORCHESTRATOR_BACKEND_PORT`, 8060 by default), which the Lineage page uses to read the canonical lineage graph and the list of running apps.

## Environment variables of DVC App

Most variables are set by the launcher; set them yourself only for manual launches.

| Variable | Default | Effect |
|---|---|---|
| `DVC_REPO_PATH` | `<DVC_APP_WORKSPACE>/repo` | Path of the Git + DVC repository this app operates on |
| `DVC_APP_WORKSPACE` | `DVC_App/data` | Workspace folder; the default repository path is derived from it |
| `DVC_APP_USER` | `unknown` | Current user name |
| `BACKEND_PORT` | `8002` | Backend port (used for CORS) |
| `DVC_APP_FRONTEND_PORT` | `3002` | Frontend port (added to the allowed CORS origins) |
| `VITE_BACKEND_PORT`, `VITE_FRONTEND_PORT` | `8061`, `3002` | Ports used by the Vite dev server and its `/api` proxy |
| `VITE_ORCHESTRATOR_BACKEND_PORT` | `8060` | Backend port of the Orchestrator, used by the `/orchestrator-api` proxy on the Lineage page |
| `VITE_IA_USER`, `IA_USER` | none | User name shown by the frontend and recorded by the launcher |
| `IA_APP_ID`, `IA_INSTANCES_FILE`, `IA_WORKSPACE_HISTORY_FILE` | set by the launcher | Instance registry and workspace history shown in the user badge |

Variables must be set before uvicorn starts; changing them afterwards has no effect.

## Repository layout on disk

With the launcher, the repository is always `<workspaces-root>/dvc_<user>/repo/`; this path becomes `DVC_REPO_PATH` via the environment passed to the backend subprocess, so two users never share the same DVC repository. A manual launch without `DVC_REPO_PATH` falls back to `<DVC_APP_WORKSPACE>/repo`.

```text
dvc_<user>/repo/
  .git/                    Git history: every commit, including the lineage trailers
  .dvc/                    DVC's own config and cache pointers; cache.type set to reflink,hardlink,copy
  datasets/<name>/          Versioned datasets, one subfolder per name, each with a matching datasets/<name>.dvc pointer
  models/<name>             Versioned model weights (for example best.pt), with a matching .dvc pointer
  annotations/<name>/       Versioned native (.ver) annotation exports
  metrics/<name>            Versioned metrics files (a run's insights.json)
  graphs/<graph_id>.json    Full Orchestrator pipeline snapshots, versioned in clear text (not through DVC)
  params/optuna_best.json   Best Optuna hyperparameters, versioned in clear text (not through DVC)
```

`graphs/` and `params/` are committed directly through Git, not through `dvc add`: they are small, human-readable JSON files meant to be diffable in plain Git history, unlike the large binary datasets and model weights under `dvc add`. Deleting `.git/` loses the entire commit and lineage history; deleting `.dvc/cache` loses the actual content behind every `.dvc` pointer (the pointers themselves, still in Git history, then point at nothing until content is pulled back from a remote).

## Verifying the installation

1. Start the backend and open `http://localhost:<backend-port>/health`: it answers `{"status": "ok", "repo_exists": bool, "repo_path": "..."}`.
2. Open the frontend: the sidebar repository status should show a path; a red cross with "Repo introuvable" is expected and not an error until the first commit is made.
3. From an Orchestrator pipeline with a DVC node, commit a small artifact and confirm the repository status turns green and a commit appears on **Historique**.
4. Open **Sync** and confirm the **Stockage** panel's **Calculer l'usage disque** button returns numbers instead of "repo introuvable".
