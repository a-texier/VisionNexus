---
app: suite
doc_type: configuration
audience: both
lang: en
title: Configuration
order: 40
tags: [prerequisites, settings, environment variables, ports, workspace, ssh, vm, weights, build]
sources: [launcher.py, _lib/launcher_engine.py, rebuild_all.py, desktop/package.json, desktop/src/settings.ts, desktop/src/catalog.ts, desktop/src/main.ts, MODEL_WEIGHTS.md]
---

# Configuration

## Prerequisites

The requirements differ between the machine that shows VisionNexus and the machine that runs the applications. They are the same machine in local mode.

| Where | What is needed |
|---|---|
| Machine that shows VisionNexus (Windows) | `VisionNexusElectron.exe`, a portable program with its own runtime: no Node.js is needed to run it. For VM mode, the OpenSSH client (`ssh` on the PATH). |
| Machine that runs the applications | The full `Computer_Vision_App/` repository, Python 3.11 or later, a conda environment holding the application dependencies, and Node.js 20 or later. |
| Frontends | Dependencies installed and built in each application: run `python rebuild_all.py` from the repository root (`--skip-install` keeps existing `node_modules`). |
| Model weights | Placed in the application folders, see [Model weights](#model-weights). |

The launcher itself, `launcher.py`, only uses the Python standard library, so the `python` found on the PATH by the shell that starts it can be any Python 3.11 or later. The applications run with the interpreter of the environment given in **Conda path**. On Linux, if a folder named `node-v20.20.2-linux-x64` or `node` sits at the repository root, its `bin/` directory is put first on the PATH so that `npm` and `node` work without a system installation.

A machine with a CUDA-capable GPU is expected for the model-heavy applications (Annotation, Training, Inference, Dataset Explorer embeddings). VisionNexus does not check it: the applications report their own errors.

## Settings file and log folders

VisionNexus stores its settings in a JSON file in the user data folder of the program: `%APPDATA%\VisionNexusElectron\settings.json` on Windows and `~/.config/VisionNexusElectron/settings.json` on Linux. The file belongs to the Windows user and is not shared with the workspace.

| Key | Meaning | Default |
|---|---|---|
| `username` | **User** field | empty |
| `workspace` | **Workspace** field | empty |
| `cvRoot` | **Computer_Vision_App root** field | empty |
| `condaPath` | **Conda path** field | empty |
| `vms` | List of known VMs | `[]` |
| `selectedVm` | Selected target VM, empty for local | empty |
| `nativeMountHost` | **Native network share (optional)** host | empty |
| `uiLanguage` | `en` or `fr` | `en` |
| `tutorials` | Progress of the guided tours, by app | `{}` |

Every launch writes a complete log, `logs/<id>_<timestamp>.log`, in the same user data folder (the id is the app id, `docs` for the Docs Assistant, or `orch_<app>` for a tab opened from the Orchestrator). It contains the raw output of the launcher, without terminal colour codes, and stays after the window closes. Logs older than 14 days are deleted at start-up, and only the 200 most recent are kept. The **Logs** button opens that folder. The **Launches** panel shows only the last 800 lines of each item.

## Start an app from the command line

Every application can be launched without VisionNexus, from the repository root:

```bash
python launcher.py --app annotation --workspace D:/ws --user alice
python launcher.py --app annotation explorer --workspace /data/ws --user alice
python launcher.py --app docs --workspace /data/ws --user alice --backend-only
```

`--app`, `--workspace` and `--user` are required. The launcher creates `<workspace>/<app>_<user>`, picks free ports, starts the backend (and the frontend unless `--backend-only`), prints the ports it chose, and keeps running until you press Ctrl+C. It stops every application it started as soon as one of their processes dies. If you give `--backend-port` or `--frontend-port` (for a single app only), the value is a fixed port: the launch fails when it is busy instead of moving to the next free one.

Use `--conda-path` for the environment: it accepts the environment folder, its `bin/activate` script, or its Python executable. Without it, the launcher looks for an environment named `IA_env` (or the name given with `--conda-env`) in the usual conda folders, then falls back on the Python that runs the launcher, with a warning. Each argument is described in the [API reference](api-reference.md#launcher-command-line).

## Environment variables set by the launcher

The launcher gives each backend its configuration through environment variables. An application reads them at start-up; you never set them by hand when you use VisionNexus.

| Variable | Set for | Meaning |
|---|---|---|
| `BACKEND_PORT` | every app | Port the backend must listen on |
| `VITE_BACKEND_PORT` | every app | Backend port, read by the frontend dev server proxy |
| `VITE_FRONTEND_PORT` | apps with a frontend | Port of the frontend dev server |
| `IA_USER`, `VITE_IA_USER` | every app | User name (backend and frontend) |
| `IA_APP_ID` | every app | Launcher key, used to filter connected users |
| `IA_INSTANCES_FILE` | every app | Path of `.run/.instances.json` |
| `IA_WORKSPACE_HISTORY_FILE` | every app | Path of the app's `data/.history.json` |
| `NATIVE_SHARE_HOST` | every app, if a host is set | Host given by `--native-share-host` |
| `VISIONNEXUS_PLUGINS_DIR` | read by the plugin registry | Use another folder instead of `plugins/` |
| `CV_SESSION_TOKEN`, `CV_BOOTSTRAP_CODE` | every app, unless `CV_AUTH=0` | Session token of the instance and first one-time browser code, see [Security](security.md) |

Each app also receives its own three variables, named after its key: the workspace, the user and, for apps with a frontend, the frontend port.

| App | Workspace | User | Frontend port |
|---|---|---|---|
| `annotation` | `ANNOTATION_WORKSPACE` | `ANNOTATION_USER` | `ANNOTATION_FRONTEND_PORT` |
| `explorer` | `EXPLORER_WORKSPACE` | `EXPLORER_USER` | `EXPLORER_FRONTEND_PORT` |
| `orchestrator` | `ORCHESTRATOR_WORKSPACE` | `ORCHESTRATOR_USER` | `ORCHESTRATOR_FRONTEND_PORT` |
| `dvc` | `DVC_APP_WORKSPACE` | `DVC_APP_USER` | `DVC_APP_FRONTEND_PORT` |
| `mlflow` | `MLFLOW_APP_WORKSPACE` | `MLFLOW_APP_USER` | `MLFLOW_APP_FRONTEND_PORT` |
| `optuna` | `OPTUNA_APP_WORKSPACE` | `OPTUNA_APP_USER` | `OPTUNA_APP_FRONTEND_PORT` |
| `training` | `TRAINING_APP_WORKSPACE` | `TRAINING_APP_USER` | `TRAINING_APP_FRONTEND_PORT` |
| `inference` | `INFERENCE_APP_WORKSPACE` | `INFERENCE_APP_USER` | `INFERENCE_APP_FRONTEND_PORT` |
| `docs` | `DOCS_ASSISTANT_WORKSPACE` | `DOCS_ASSISTANT_USER` | none (no frontend) |

## Base ports of every application

These are the base ports of the catalog. The launcher starts from them and picks the first free port, so the real ports can be higher; VisionNexus always reads the real ones from the launcher output.

| Launcher key | App | Backend | Frontend |
|---|---|---|---|
| `orchestrator` | Orchestrator | 8060 | 3000 |
| `annotation` | Annotation | 8000 | 5173 |
| `explorer` | Dataset Explorer | 8001 | 5174 |
| `optuna` | Optuna | 8063 | 3003 |
| `training` | Training | 8064 | 5176 |
| `inference` | Inference | 8065 | 5177 |
| `mlflow` | MLflow | 8062 | 3001 |
| `dvc` | DVC | 8061 | 3002 |
| `docs` | Docs Assistant | 8068 | none |

The launcher registry also knows `compare`, `3d`, `meshy` and `recon3d`, which are not part of this repository or of the catalog; the launcher accepts their names but cannot start them when their folders are absent. Starting a backend by hand with `uvicorn`, without the launcher, uses the defaults of its own `config.py`, which can differ from the base ports above (DVC uses 8002 and MLflow 8001 that way). Two apps with the same default can then collide. Backends listen on all interfaces of their machine, and frontends on `127.0.0.1` only.

## Workspace layout

Under the workspace root, the launcher creates one folder per application and user, plus the subfolders below. The applications create everything else themselves; each app documents its files in its own configuration page.

```text
<workspace>/
  annotation_<user>/
  explorer_<user>/        thumbs/  faiss/  subsets/
  orchestrator_<user>/    pipelines/
  training_<user>/        runs/  exports/
  inference_<user>/       runs/
  optuna_<user>/          logs/
  mlflow_<user>/          mlflow_data/
  dvc_<user>/             repo/
  docs_<user>/
```

Two files live in the repository of the target machine, outside the workspace: `.run/.instances.json` and `.run/.port_lock` (see [Concepts](concepts.md#the-shared-instance-registry)), and each application keeps a small `data/.history.json` in its own folder that records the workspaces it has used.

## Linux GPU VM prerequisites

VM mode has requirements of its own on the SSH side and on the VM.

- **Non-interactive SSH**: `ssh <vm>` must work from Windows without a password prompt (key or agent). VisionNexus starts `ssh` with no way to answer a prompt, and the **Ports** panel uses `BatchMode=yes` with a 5-second connection limit.
- **Destination name**: each entry of **Known VM(s)** is passed to `ssh` as is: a host alias of your `~/.ssh/config` or `user@host`. The SSH user is decided there, not by **User**.
- **Repository and paths**: **Computer_Vision_App root**, **Workspace** and **Conda path** must be Linux paths that exist on the VM. Launch commands run as `cd '<root>' && python launcher.py ...`, so `python` must be found by that shell.
- **Free local ports**: the same port numbers the VM chose must be free on your Windows machine, since tunnels reuse them.
- **Tools for the Ports panel**: `ss`, `ps` and `pgrep`. **Kill** takes the process id from `ss`; `lsof` or `fuser` only serve as a fallback when `ss` shows no process id.
- **Exposure**: backends and frontends listen on `127.0.0.1` only, and every backend requires the session token of its instance. Only your tunnels reach them; [Security](security.md) describes the protections and the variables `CV_BIND_HOST` and `CV_AUTH` that relax them.

## Model weights

The applications never download weights at run time. The weights, their expected paths and their sources are listed per application in [MODEL_WEIGHTS.md](../MODEL_WEIGHTS.md), which is the reference; this page does not repeat them. Each app documents in its own configuration page how it finds its weights and what it does when one is missing.

For the Docs Assistant, the small embedding model is downloaded once, online, with `python scripts/download_model.py` from `Docs_Assistant_App/`, then used offline. Without it, documentation search still works with keywords only.

## Building and installing the desktop app

To run the launcher from source, install the dependencies and start it from the `desktop/` folder. The npm scripts are:

| Command | Effect |
|---|---|
| `npm ci` | Installs the dependencies from `package-lock.json` |
| `npm run build` | Compiles `src/*.ts` into `dist/` |
| `npm test` | Runs the unit tests and the documentation anchor check |
| `npm start` | Builds, then starts the program in development mode |
| `npm run dist:win` | Builds, tests, embeds the documentation and produces the portable `release/VisionNexusElectron.exe` |
| `npm run dist:linux` | Same, producing an AppImage on a Linux machine |

The portable program needs no installation. It embeds a copy of the documentation pages (`npm run copy-docs`, done by the `dist` scripts), used when no repository is found next to it. Running `python rebuild_all.py --package-desktop` from the repository root installs and builds every frontend and the desktop app in one command.
