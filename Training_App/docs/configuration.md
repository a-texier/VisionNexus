---
app: training
doc_type: configuration
audience: both
lang: en
title: Configuration
order: 40
tags: [installation, launcher, ports, environment variables, workspace, weights, mlflow, plugins]
sources: [Training_App/backend/config.py, Training_App/backend/api/settings.py, Training_App/launcher.py, _lib/launcher_engine.py, launcher.py, Training_App/frontend/vite.config.ts, Training_App/backend/services/mlflow_logging.py, Training_App/backend/services/trainer_backend.py, Training_App/pyproject.toml]
---

# Configuration

## System requirements for Training App

Training App needs a Python environment for the backend and Node.js for the interface. The suite uses one conda environment for all apps, `IA_env` by default.

- **Python** 3.10 or later, with: `fastapi`, `uvicorn`, `sqlmodel`, `pydantic`, `torch` and `torchvision`, `opencv-python`, `numpy`, `pyyaml`, `matplotlib`, and the libraries imported by the vendored YOLOX code: `loguru`, `thop`, `tabulate`, `tqdm` and `pycocotools`.
- **MLflow** (`mlflow`) is optional: without it, runs train normally but nothing is logged to MLflow.
- **Node.js** 18 or later with npm, to run the Vite interface. Bundles for Linux embed their own Node.js.
- **GPU**: an NVIDIA GPU with a CUDA build of PyTorch is strongly recommended. Training on CPU works but is very slow. The GPU memory needed grows with the model size, **Image size** and **Batch size**; lower **Batch size** first on a small GPU.
- **Disk**: each run folder holds several checkpoints (from a few MB for `nano` to several hundred MB for `x`, times the number of evaluations).

The YOLOX code itself is included in `Training_App/backend/vendor/yolox/` (version 0.3.0, Apache-2.0): nothing to install for it. Inference App imports this same code to load YOLOX weights, so Training App must be present next to it.

## Launching Training App from VisionNexus or the suite launcher

The normal way to start Training App is from VisionNexus, which starts the backend and the interface for the selected user and workspace root, locally or on a remote VM over SSH, and opens the interface in a tab once the backend answers `/health`.

From the root of the suite (`Computer_Vision_App/`), the common launcher does the same in a terminal:

```bash
python launcher.py --app training --workspace <workspaces root> --user <name>
```

Useful options: `--conda-env` (default `IA_env`) or `--conda-path` (explicit environment), `--backend-only` (no interface), `--no-reload` (disable the automatic restart of the backend when a Python file changes), `--backend-port` / `--frontend-port` (fixed ports). Several apps can be started at once (`--app training inference`).

The workspace of the app is `<workspaces root>/training_<name>`. The launcher registers the instance in `Computer_Vision_App/.run/.instances.json`, so that several users and apps get distinct ports, and stops the backend and the interface on `Ctrl+C`.

`Training_App/launcher.py` is an equivalent launcher limited to this app (`python launcher.py --user <name> --workspace <root>` from `Training_App/`), with the same options except `--conda-path`.

## Launching the backend and frontend manually

For development, the two processes can be started by hand from `Training_App/`:

```bash
uvicorn backend.main:app --host 127.0.0.1 --port 8064 --reload
cd frontend
npm install
npm run dev
```

Without environment variables, the workspace is `Training_App/data/` and the ports are 8064 (backend) and 5176 (interface). To use other ports, set `BACKEND_PORT` for the backend, and `VITE_BACKEND_PORT` and `VITE_FRONTEND_PORT` for the interface. `TRAINING_APP_WORKSPACE` and `TRAINING_APP_USER` can also be set by hand to reproduce a launcher-managed workspace.

With `--reload`, uvicorn restarts the backend whenever a Python file of the app changes: a run in progress is then lost (see [Troubleshooting](troubleshooting.md)). Use `--no-reload` for long trainings, and prefer the launcher for anything but active backend development.

## Ports and network access

| Component | Default port | Variable |
|---|---|---|
| Backend (FastAPI) | 8064 | `BACKEND_PORT` |
| Interface (Vite) | 5176 | `TRAINING_APP_FRONTEND_PORT` for the backend CORS list, `VITE_FRONTEND_PORT` for Vite |

The launchers start from these base ports and take the next free ones when they are used by another instance. The Vite server proxies `/api` to the backend, but two kinds of requests go directly from the browser to `http://localhost:<backend port>`: the progress stream of a run (SSE) and the images of the analysis gallery. The backend port must therefore be reachable as `localhost` from the machine that displays the interface. VisionNexus forwards both ports through its SSH tunnel when the app runs on a remote VM; a browser opened on another machine without tunnel shows the pages but no live progress and no plots.

The backend accepts requests from the interface port and from the usual development ports (5173, 5175, 5176, 3000) on `localhost` and `127.0.0.1`.

## Environment variables of Training App

| Variable | Default | Role |
|---|---|---|
| `TRAINING_APP_WORKSPACE` | `Training_App/data` | Workspace folder (database, runs, settings). Set by the launchers. |
| `TRAINING_APP_USER` | `unknown` | User name, used for the MLflow store and tags. Set by the launchers. |
| `BACKEND_PORT` | `8064` | Backend port. |
| `TRAINING_APP_FRONTEND_PORT` | `5176` | Interface port, added to the allowed origins of the backend. |
| `VITE_BACKEND_PORT` / `VITE_FRONTEND_PORT` | `8064` / `5176` | Ports used by the Vite server and by the interface for direct backend calls. |
| `TRAINING_APP_TRAINER_BACKEND` | `yolox` | Default engine when a request names none. |
| `LAUNCHED_BY_ORCHESTRATOR` | empty | `1` when started by the Orchestrator: the interface shows orchestrator mode. |
| `IA_MLFLOW_TRACKING_URI` | empty | MLflow store to use instead of the user store (set by the Orchestrator). |
| `TRAINING_ORCH_BLOCKING` | `1` | `0` makes `POST /api/orchestrator/train` answer as soon as the run starts instead of waiting for its end. |
| `TRAINING_ORCH_MAX_WAIT_S` | `5400` | Maximum wait of that call, in seconds, before answering "still running". |
| `IA_INSTANCES_FILE`, `IA_APP_ID` | set by the suite launcher | Used to list the users of the same app in `GET /api/workspace/users`. |
| `VITE_CACHE_DIR` | empty | Separate Vite cache folder, when two interfaces run from the same folder. |

## Workspace layout on disk

The workspace of a user (`<workspaces root>/training_<user>`, or `Training_App/data/` without launcher) contains:

```text
training_<user>/
  training.db              run database (SQLite)
  settings.json            interface language (outside VisionNexus only)
  runs/
    <run name>/            one folder per run
      train_log.txt        full training log
      results.csv          metrics and losses per epoch
      latest_ckpt.pth      checkpoints (see Concepts)
      best_ckpt.pth
      ...
      artifacts/           analysis plots
      inference_cases/     best / worst cases, once computed
    <archive name>/        .zip datasets extracted for the Orchestrator
  exports/                 created, not used by the current version
```

The MLflow store is not in this folder but next to it (see the section *MLflow store location*). Deleting a run from **History** removes only its database record; its folder stays until you delete it (see [Workflows](workflows.md), section *Delete a run and free disk space*, for what to keep first).

## Model weights for Training App

Training App never downloads weights. A YOLOX run starts from random weights unless **Starting weights (optional)** gives a `.pth` file readable by the backend.

To start from COCO pretrained weights, download the official checkpoint of the chosen size from the YOLOX releases on GitHub (`Megvii-BaseDetection/YOLOX`: `yolox_nano.pth`, `yolox_tiny.pth`, `yolox_s.pth`, `yolox_m.pth`, `yolox_l.pth`, `yolox_x.pth`, Apache-2.0), copy it to the backend machine, and type its absolute path. The list of weights used by the whole suite is in `MODEL_WEIGHTS.md` at the root of the repository.

The weights produced by a run are the `.pth` checkpoints of its folder; the recommended file is `best_ckpt.pth` (see [Concepts](concepts.md)).

## MLflow store location

Every run is logged to MLflow without any MLflow server: Training App writes directly into a SQLite store.

- By default, the store is `<workspaces root>/mlflow_<user>/mlflow_data/mlflow.db`, next to the Training workspace, with the artifacts (plots and weights) in `mlflow_data/artifacts/<experiment>/`. The folders are created on the first run. MLflow App launched for the same user and root reads this same store.
- When `IA_MLFLOW_TRACKING_URI` is set (the Orchestrator does it), that store is used instead.
- The experiment is `training` for runs started from the interface or the API; the Orchestrator chooses the experiment of its runs.

If the `mlflow` package is missing or the store cannot be written, logging is skipped silently and the training is not affected. What is logged is described in [Workflows](workflows.md), section *Find a run and its model in MLflow App*.

## Installing a training engine plugin

Engines other than YOLOX are provided by plugins. A plugin is a folder placed in `plugins/` at the root of the suite, which declares its engines in the group `visionnexus.trainer_backends`; an installed Python package declaring an entry point in that group works too. No setting is needed: the plugin is discovered when the backend reads the engine list.

- A plugin whose library is missing is listed as unavailable, with the reason, in the model panel and in `GET /api/capabilities`; YOLOX keeps working.
- With more than one available engine, the **Engine** row appears on the **Training** page.
- A plugin can add its own documentation page to this documentation, shown only where the plugin is installed.

The contract a plugin must follow is described in `docs/plugins/README.md` at the root of the repository and in [Architecture](architecture.md).

## Interface language of Training App

The interface is available in English and French. When the app is opened from VisionNexus, the language set in VisionNexus is passed in the address (`?lang=en` or `?lang=fr`) and applied at load time; the **EN** / **FR** button then changes only the current window.

Outside VisionNexus, the language comes from the browser storage, then from `ui_language` in `settings.json` of the workspace (`en` by default). The **EN** / **FR** button saves the choice there through `PUT /api/settings`. This file has no other setting.

## Verifying the installation of Training App

After installation, check the chain from the backend to a real run:

1. Open `http://localhost:<backend port>/health`: the answer is `{"status": "ok", "app": "Training_App"}`.
2. Open `http://localhost:<backend port>/api/capabilities`: `yolox` is listed with `"available": true`, and each plugin with its availability.
3. In the backend environment, run `python -c "import torch; print(torch.cuda.is_available())"`: `True` means the GPU will be used.
4. From `Training_App/`, run the tests: `python -m pytest backend/tests -m "not slow"` (unit tests) and `python -m pytest backend/tests` (includes short real trainings).
5. Start a run of 2 epochs on a small dataset with **Eval interval (ep.)** at 1: it must reach **Done** with a **Best model** path and plots in **Model analysis**.
