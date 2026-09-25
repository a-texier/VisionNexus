---
app: inference
doc_type: configuration
audience: both
lang: en
title: Configuration
order: 40
tags: [installation, launcher, ports, environment variables, workspace, config.yaml]
sources: [Inference_App/backend/config.py, Inference_App/backend/api/settings.py, Inference_App/config/defaults.yaml, Inference_App/requirements.txt, Inference_App/frontend/vite.config.ts, _lib/launcher_engine.py]
---

# Configuration

## System requirements for Inference App

Inference App needs a Python environment for the backend and Node.js for the interface, the same conda environment as the rest of the suite (`IA_env` by default).

- **Python** 3.10 or later, with: `fastapi`, `uvicorn[standard]`, `numpy`, `opencv-contrib-python-headless` (or another OpenCV build providing `cv2.legacy.TrackerCSRT_create` or `cv2.TrackerCSRT_create` for the SOT mode), `torch`, `pyyaml`, `matplotlib` (see `requirements.txt`).
- **Node.js** 18 or later with npm, to run the Vite interface.
- **GPU**: an NVIDIA GPU with a CUDA build of PyTorch is recommended for reasonable frame rates; the app also runs on CPU, more slowly.
- The vendored YOLOX code used to load checkpoints lives in `Training_App/backend/vendor/yolox/`: Training App must be present next to Inference App in the repository, even when only running inference (see [Architecture](architecture.md)).

## Launching Inference App from VisionNexus or the suite launcher

The normal way to start Inference App is from VisionNexus, which starts the backend and the interface for the selected user and workspace root, locally or on a remote VM over SSH.

From the root of the suite (`Computer_Vision_App/`), the common launcher does the same in a terminal:

```bash
python launcher.py --app inference --workspace <workspaces root> --user <name>
```

Useful options: `--conda-env` (default `IA_env`) or `--conda-path`, `--backend-only` (no interface), `--no-reload`, `--backend-port` / `--frontend-port` (fixed ports, single-app launches only). Several apps can be started at once (`--app training inference`).

The workspace of the app is `<workspaces root>/inference_<name>`. Unlike Training App, Inference App has no app-local launcher script; it is only started through the suite-wide launcher (`launcher.py` at the repository root) or VisionNexus.

## Launching the backend and frontend manually

For development, the two processes can be started by hand from `Inference_App/`:

```bash
uvicorn backend.main:app --host 127.0.0.1 --port 8065 --reload
cd frontend
npm install
npm run dev
```

Without environment variables, the workspace is `Inference_App/data/` and the ports are 8065 (backend) and 5177 (interface). Set `BACKEND_PORT` for the backend, and `VITE_BACKEND_PORT` / `VITE_FRONTEND_PORT` for the interface, to use other ports.

## Ports and network access

| Component | Default port | Variable |
|---|---|---|
| Backend (FastAPI) | 8065 | `BACKEND_PORT` |
| Interface (Vite) | 5177 | `INFERENCE_APP_FRONTEND_PORT` for the backend CORS list, `VITE_FRONTEND_PORT` for Vite |

The Vite server proxies every `/api` request to the backend, with a 3600-second timeout to accommodate long inference and evaluation runs; the interface never talks to the backend port directly (unlike Training App's SSE stream). VisionNexus forwards the interface port through its SSH tunnel when the app runs on a remote VM.

The backend accepts requests only from its own interface port (`INFERENCE_APP_FRONTEND_PORT`), on `localhost` and `127.0.0.1`.

## Environment variables of Inference App

| Variable | Default | Role |
|---|---|---|
| `INFERENCE_APP_WORKSPACE` | `Inference_App/data` | Workspace folder (runs, uploads, settings). Set by the launcher. |
| `INFERENCE_APP_USER` | `unknown` | User name, used by `GET /api/app-mode`. Set by the launcher. |
| `BACKEND_PORT` | `8065` | Backend port. |
| `INFERENCE_APP_FRONTEND_PORT` | `5177` | Interface port, the only origin allowed by the backend CORS. |
| `VITE_BACKEND_PORT` / `VITE_FRONTEND_PORT` | `8065` / `5177` | Ports used by the Vite dev server. |
| `LAUNCHED_BY_ORCHESTRATOR` | empty | `1` when started by the Orchestrator: `GET /api/app-mode` reports `orchestrator` mode. |
| `VITE_CACHE_DIR` | empty | Separate Vite cache folder, when two interfaces run from the same folder. |

## Workspace layout on disk

The workspace of a user (`<workspaces root>/inference_<user>`, or `Inference_App/data/` without launcher) contains:

```text
inference_<user>/
  config.yaml        edited configuration (see below); absent until first saved
  settings.json       interface language (outside VisionNexus only)
  runs/
    <run name>/        one folder per inference run or evaluation
      result.mp4 / result<ext>   annotated output (inference runs)
      result.json, request.json  benchmark figures and the request that produced them
      metrics.json, pr_curve.png, f1_curve.png, confusion_matrix.png  (evaluation runs)
  uploads/             created at startup, not used by the current version
```

`GET /api/output?path=` only serves files under `runs/` of the workspace (path traversal outside it is refused), which is how the interface displays a run's result and an evaluation's plots.

## The config.yaml schema

`config/defaults.yaml` at the root of the app ships the built-in defaults and is never modified by the app itself. The workspace's `config.yaml` (created on first save from the **Config YAML** tab) overrides it entirely when present: `GET /api/config` reads `config.yaml` if it exists, else `defaults.yaml`.

The recognized keys, with their default values:

```yaml
engine: yolox
model_size: yolox-s
mode: infer            # infer | mot | sot
tracker: none           # none | bytetrack
confidence: 0.25
iou: 0.45
imgsz: 640
device: ""              # "" = auto (cuda if available, else cpu)
class_names: []          # optional, in class-id order; class_<n> is shown otherwise
track_high_thresh: 0.5
track_low_thresh: 0.1
new_track_thresh: 0.6
match_thresh: 0.3
track_buffer: 30
save_output: true
max_frames: 0            # 0 = no limit
```

`PUT /api/config` accepts any YAML object; unknown keys are kept as-is in the saved file but ignored by the app. Inference App's own `config/defaults.yaml` (not the workspace's saved `config.yaml`) is what the Orchestrator's meta endpoint reads to build its Inference node form, grouped as **Detector** (`engine`, `model_size`, `confidence`, `iou`, `imgsz`, `device`, `class_names`), **Mode** (`mode`, `tracker`), **ByteTrack** (`track_high_thresh`, `track_low_thresh`, `new_track_thresh`, `match_thresh`, `track_buffer`) and **Output** (`save_output`, `max_frames`); `engine` and `model_size` are locked in that form when the Inference node is fed by a Training node.

## Verifying the installation of Inference App

1. Open `http://localhost:<backend port>/health`: the answer is `{"status": "ok", "app": "Inference_App", "version": "2.0.0"}`.
2. Open `http://localhost:<backend port>/api/capabilities`: `yolox` is listed under `detectors` with `"available": true`.
3. In the backend environment, run `python -c "import torch; print(torch.cuda.is_available())"`: `True` means the GPU will be used.
4. From `Inference_App/`, run `pytest tests -q`.
5. From the interface, load a small image with **Read media**, set a valid YOLOX checkpoint, and click **Lancer** in **Inférence pure** mode: the result panel must show frame counts, fps figures and an annotated image.
