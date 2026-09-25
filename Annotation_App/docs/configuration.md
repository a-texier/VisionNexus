---
app: annotation
doc_type: configuration
audience: both
lang: en
title: Configuration
order: 40
tags: [installation, offline, model weights, ports, environment variables, workspace, settings]
sources: [Annotation_App/backend/config.py, Annotation_App/backend/services/settings_service.py, Annotation_App/launcher.py, _lib/launcher_engine.py, Annotation_App/frontend/vite.config.ts, Annotation_App/backend/requirements.txt, Annotation_App/backend/tests/download_all_models.py, Annotation_App/scripts/create_offline_zip.py, Annotation_App/install_samurai.bat, Annotation_App/backend/utils/native_share.py, Annotation_App/frontend/src/components/modals/SettingsModal.tsx, MODEL_WEIGHTS.md]
---

# Configuration

## System requirements for Annotation App

Annotation App runs on Windows 10/11 (64-bit) and on Linux x86_64 (the usual target for a remote GPU VM). It needs a Python environment for the backend and Node.js for the frontend.

| Component | Minimum | Notes |
|---|---|---|
| Python | 3.11 | Conda environment `IA_env` by default (Miniconda or Anaconda 23+) |
| PyTorch | CUDA build recommended | Installed separately from `backend/requirements.txt` |
| NVIDIA GPU | 6 GB VRAM | Recommended; CPU works but SAM2, SAMURAI and Grounding DINO become slow. A 10 GB GPU propagates about 350 to 450 frames per SAMURAI run in fast GPU mode |
| CUDA | 11.8+ | Optional, for GPU acceleration |
| Node.js / npm | 18+ / 8+ | For the Vite frontend. The Linux bundle ships `node-v20.20.2-linux-x64` |
| ffmpeg | 4+ | Needed for video import |
| RAM | 8 GB, 16 GB recommended | The backend uses about 1 GB at rest and 2 to 2.2 GB with the models loaded |
| Disk | 25 GB+ | Code, models (about 3 GB with SAM3.1), offline bundle and working data |

Python dependencies are listed in `backend/requirements.txt` (FastAPI, uvicorn, SQLModel, OpenCV, Pillow, NumPy, SciPy, ffmpeg-python, lap, filterpy...). PyTorch, torchvision, `transformers` (for Grounding DINO) and the SAM2 package are installed separately, as described in the installation sections of this page. Without `transformers`, the app starts but text detection answers with an error.

## Launching Annotation App from VisionNexus or the suite launcher

The normal way to run Annotation App is through the suite launcher, directly or from the VisionNexus desktop application, which calls it for you (locally or over SSH on a VM).

From the suite root:

```bash
python launcher.py --app annotation --workspace <workspaces-root> --user <user>
```

Directly from the app folder:

```bash
cd Annotation_App
python launcher.py --workspace <workspaces-root> --user <user>
```

Options of `Annotation_App/launcher.py`:

| Option | Default | Effect |
|---|---|---|
| `--user` | required | User name; the workspace is `<workspaces-root>/annotation_<user>` |
| `--workspace` | required | Root folder of all workspaces |
| `--conda-env` | `IA_env` | Conda environment used to find Python |
| `--backend-port` / `--frontend-port` | automatic | Force the ports instead of allocating free ones |
| `--backend-only` | off | Start only the API |
| `--no-reload` | off | Start uvicorn without auto-reload |
| `--access-log` | off | Print every HTTP request (useful for diagnosis only) |
| `--native-share-host` | none | DNS name or IP of the SMB share host seen by Windows clients |

The suite launcher also accepts `--conda-path` (a conda environment root, its `bin/activate`, or a Python executable), which takes priority over `--conda-env`; VisionNexus fills it from its Settings when launching over SSH.

The launcher creates the workspace, registers the instance, starts uvicorn (`backend.main:app` on `127.0.0.1`) and the Vite dev server, and stops both on `Ctrl+C`. VisionNexus waits for the backend `/health` endpoint before opening the tab, because loading the models takes 10 to 40 seconds.

## Launching the backend and frontend manually

For development, the backend and the frontend can be started by hand. Without the launcher, the workspace defaults to `Annotation_App/data/`.

Terminal 1, backend (from `Annotation_App/`):

```bash
conda activate IA_env
uvicorn backend.main:app --host 127.0.0.1 --port 8000 --reload
```

If `conda` is not on the PATH, call the environment's Python directly, for example `/c/Users/<you>/miniconda3/envs/IA_env/python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --reload`.

Terminal 2, frontend:

```bash
cd Annotation_App/frontend
npm run dev
```

Then open `http://localhost:5173`. The API documentation (Swagger) is at `http://localhost:8000/docs`.

To use a specific workspace, set `ANNOTATION_WORKSPACE` before starting uvicorn. To start the frontend on other ports, set `VITE_BACKEND_PORT` and `VITE_FRONTEND_PORT`.

Rules for manual launches:

- Always run a single uvicorn worker: SQLite is not safe for multi-process writes. Never use `--workers` greater than 1.
- `--reload` is for development; remove it for long runs.
- Start uvicorn from `Annotation_App/`, so that `backend.main` and the relative checkpoint paths resolve.

## Ports and network access

Annotation App uses two ports: the FastAPI backend and the Vite frontend.

| Service | Base port | Environment variable | Notes |
|---|---|---|---|
| Backend (FastAPI) | 8000 | `BACKEND_PORT` | API under `/api`, WebSockets under `/ws`, static files under `/media`, Swagger under `/docs` |
| Frontend (Vite) | 5173 | `ANNOTATION_FRONTEND_PORT`, `VITE_FRONTEND_PORT` | Serves the interface and proxies `/api`, `/media` and `/ws` to the backend |

When several users or instances run on the same machine, the launcher allocates the first free ports from 8000 and 5173 upward and records them in `<suite root>/.run/.instances.json`. The ports actually used are printed at startup.

The Vite proxy targets `127.0.0.1`, never `localhost`: on Windows, Node tries IPv6 first while uvicorn listens on IPv4, which would add about 200 ms to every request. The proxy timeout is 3 minutes for long calls (text batch, SAM3).

The backend allows cross-origin requests from ports 5173 and 3000 on `localhost` and `127.0.0.1`, plus the current frontend port.

On a remote VM, the backend and the frontend listen on `127.0.0.1` only (set `CV_BIND_HOST=0.0.0.0` to expose them on the network on purpose). From Windows, reach the frontend through an SSH port forward (VisionNexus sets it up), or through VS Code SSH port forwarding of the frontend port. The frontend proxy then reaches the backend on the VM itself.

## Environment variables of Annotation App

Most variables are set by the launcher; set them yourself only for manual launches.

| Variable | Default | Effect |
|---|---|---|
| `ANNOTATION_WORKSPACE` | `Annotation_App/data` | Workspace folder: database, projects, settings, backups, exports |
| `ANNOTATION_USER` | none | Current user name (set by the launcher) |
| `IA_USER` | none | User name recorded in the monitoring events |
| `BACKEND_PORT` | `8000` | Backend port (used for CORS and startup messages) |
| `ANNOTATION_FRONTEND_PORT` | `5173` | Frontend port (added to the allowed CORS origins) |
| `VITE_BACKEND_PORT`, `VITE_FRONTEND_PORT` | `8000`, `5173` | Ports used by the Vite dev server and its proxy |
| `VITE_IA_USER` | none | User name shown by the frontend |
| `VITE_CACHE_DIR` | Vite default | Separate Vite cache per instance, avoids "Outdated Optimize Dep" errors when two instances share the folder |
| `NATIVE_SHARE_HOST` | empty | SMB host used to translate server paths to UNC paths; overrides the saved share host |
| `CV_DATA_TUTO` | `<suite root>/data_tuto` | Folder of the sample images used by the tutorial |
| `IA_APP_ID`, `IA_INSTANCES_FILE`, `IA_WORKSPACE_HISTORY_FILE` | set by the launcher | Instance registry and workspace history shown in the user badge |
| `LAUNCHED_BY_ORCHESTRATOR` | unset | When set, the app runs in orchestrator mode (export destination fixed) |
| `TRANSFORMERS_OFFLINE`, `HF_HUB_OFFLINE`, `HF_DATASETS_OFFLINE` | unset | Set to `1` to forbid any Hugging Face network access |
| `PYTHONIOENCODING` | system | Set to `utf-8` if the console raises `UnicodeEncodeError` at startup |

Variables must be set before uvicorn starts; changing them afterwards has no effect.

## Workspace layout on disk

The workspace is the folder that holds all the data of one user. With the launcher it is `<workspaces-root>/annotation_<user>/`; the default root used by the suite is `All_workspaces/` next to the applications, and a launch without user gives `annotation_default`. A manual launch without `ANNOTATION_WORKSPACE` uses `Annotation_App/data/`.

```text
annotation_<user>/
  annotation.db              SQLite database (WAL mode): projects, frames, annotations, tracks, classes
  user_settings.json         Settings of the Settings window
  projects/<id>/
    frames/                  Frames: symbolic links, uploaded images or extracted video frames
    frames_preview/          Cached 480 px and 1600 px JPEG previews (regenerated on demand)
    frames_8bit/             Cached 8-bit versions of 16-bit sources (display)
    frames_ai_lut/           Cached LUT-applied images given to the detectors
    frames_format specialise_cache/        Cached frames of the optional format specialise format
    _tracking_tmp/           Temporary JPEG frames of a running SAMURAI / SAM2 job
    <name>_png/              PNG frames converted from an uploaded format specialise file
  backup/p<id>_<name>/       Automatic JSON backup and sequence list (.txt), overwritten every 2 minutes
  exports/                   YOLO, COCO and .ver exports (folders or ZIP files)
  imports/<subset>/          Images handed over by the Orchestrator for a new project
  monitoring/events.jsonl    Event log of the Monitoring page
```

Everything under `frames_preview/`, `frames_8bit/`, `frames_ai_lut/` and `frames_format specialise_cache/` is a cache: it can be deleted safely and is rebuilt when needed. Cache files carry the LUT signature in their name, and stale generations are purged when a LUT changes.

To back up a workspace, save `annotation.db` together with `projects/` (and the source folders referenced by symbolic link). Deleting `annotation.db` recreates an empty database at the next start: every project and annotation is lost. The **Workspace storage** section of the Settings window shows the size of projects, backups and exports and can empty the last two.

## Model weights and where they live

Annotation App loads its models from local files under `Annotation_App/backend/`. In offline mode the models are never downloaded silently.

| Model | Expected location | Size | Source |
|---|---|---|---|
| SAM2 and SAMURAI small (required for SAM, SAMURAI, SAM2 video) | `backend/checkpoints/sam2.1_hiera_small.pt` | about 46 MB | Meta SAM2.1 release |
| SAM2 tiny (optional lighter fallback) | `backend/checkpoints/sam2.1_hiera_tiny.pt` | about 38 MB | Meta SAM2.1 release |
| Grounding DINO tiny | the whole folder `backend/checkpoints/grounding_dino/` (`config.json`, processor and tokenizer files, `model.safetensors` or `pytorch_model.bin`) | a few hundred MB | Hugging Face `IDEA-Research/grounding-dino-tiny` |
| SAM3.1 multiplex (optional) | `backend/checkpoints/sam3.1/sam3.1_multiplex.pt` plus the JSON and tokenizer files of the same snapshot | about 2.4 GB | Hugging Face `facebook/sam3.1` (gated) |
| XFeat (optional, homography on GPU) | `backend/models/xfeat/` with `weights/xfeat.pt` | about 25 MB | GitHub `verlab/accelerated_features` |

At startup, the backend loads SAM2 small when `sam2.1_hiera_small.pt` exists, otherwise the tiny model. Without any SAM2 checkpoint the server still starts, but SAM requests fail. Grounding DINO uses the local folder when `config.json` is present, otherwise it downloads `IDEA-Research/grounding-dino-tiny` from Hugging Face on first use. Without XFeat, homography falls back to SIFT with RANSAC (OpenCV).

Assisted download, from `Annotation_App/` with internet access:

```bash
conda activate IA_env
python backend/tests/download_all_models.py --skip-sam3                 # SAM2 + Grounding DINO
python backend/tests/download_all_models.py --hf-token hf_xxxxxxxx      # also SAM3.1
```

SAM3.1 is gated: accept its terms on its Hugging Face page, then log in (`huggingface-cli login`) or pass `--hf-token`. Individual scripts also exist (`download_sam2.py`, `download_grounding_dino.py`, `download_sam3.py`). The suite-wide list of weights is in `MODEL_WEIGHTS.md` at the suite root.

## Installing SAMURAI and XFeat

SAMURAI and XFeat are not pip packages; they live in folders of the backend.

**SAMURAI** is a fork of SAM2 (same checkpoints, different configurations with `samurai_mode` enabled). It is expected in `backend/ext/samurai_repo/`, with its `sam2/` subfolder installed in editable mode. On Windows, run `install_samurai.bat` from `Annotation_App/`: it clones `https://github.com/yangchris11/samurai` into `backend/ext/samurai_repo/` (or updates it) and installs it into `IA_env`. The bundles of the suite already contain it. When SAMURAI is missing, the **SAMURAI** tab shows **Standard SAM2 (SAMURAI absent)** and propagation uses plain SAM2 video.

**XFeat** is expected in `backend/models/xfeat/` (with `modules/xfeat.py` and `weights/xfeat.pt`). To install it with internet access:

```bash
git clone https://github.com/verlab/accelerated_features backend/models/xfeat
```

When XFeat is present and loads correctly, the **Homog.** tab shows **XFeat GPU**; otherwise it shows **SIFT CPU**.

**SAM2** itself is installed as a Python package: `pip install git+https://github.com/facebookresearch/segment-anything-2.git` with internet access, or from a prebuilt wheel offline (see the offline installation sections). The error `ModuleNotFoundError: No module named 'sam2'` at startup means this step is missing.

## Installing Annotation App with internet access

With internet access, a standard installation takes four steps (commands from `Annotation_App/`).

1. Create the environment and install PyTorch with CUDA:

   ```bash
   conda create -n IA_env python=3.11
   conda activate IA_env
   conda install pytorch torchvision torchaudio pytorch-cuda=12.1 -c pytorch -c nvidia
   ```

   On Linux or without conda-forge PyTorch, `pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121` works too.

2. Install SAM2 and the backend dependencies:

   ```bash
   pip install git+https://github.com/facebookresearch/segment-anything-2.git
   pip install -r backend/requirements.txt
   pip install transformers
   conda install -c conda-forge ffmpeg
   ```

3. Install the frontend dependencies: `cd frontend && npm install`.
4. Download the models (section *Model weights and where they live*) and, on Windows, run `install_samurai.bat`.

Then launch the app as described in *Launching Annotation App from VisionNexus or the suite launcher*.

## Offline installation: preparing the bundle on a connected machine

An offline target (a PC or a VM without internet) is installed from a bundle prepared once on a machine with internet access. All commands run from `Annotation_App/`.

1. **Python wheels**. Download the wheels for each target platform:

   ```bash
   pip download -r backend/requirements.txt -d offline_windows/wheels/ --platform win_amd64 --python-version 311 --only-binary :all:
   pip download -r backend/requirements.txt -d offline_linux/wheels/ --platform linux_x86_64 --python-version 311 --only-binary :all:
   ```

   `pip download` cannot fetch Git URLs: build the SAM2 wheel yourself (`git clone https://github.com/facebookresearch/segment-anything-2`, then `pip wheel . -w <offline folder>/wheels/`).

2. **npm cache**. The frontend depends on native binaries (rolldown for Vite, the Tailwind CSS v4 oxide engine). Run `npm install` in `frontend/`, then copy the npm cache (`npm config get cache`) to `offline_windows/npm-cache`. For Linux, first pull the Linux binaries into the cache with `npm install --no-save --force @rolldown/binding-linux-x64-gnu@<version> @tailwindcss/oxide-linux-x64-gnu@<version>` (versions matching `package-lock.json`), copy the cache to `offline_linux/npm-cache`, then run `npm install` again to restore a clean `node_modules`.

3. **Conda environment**. Either export a spec file (`conda list --explicit > offline/conda/spec-file.txt`, needs Miniconda on the target) or pack the full environment with `conda pack -n IA_env -o offline/conda/IA_env.tar.gz` (6 to 8 GB, no conda needed on the target). Also keep `conda env export > offline/conda/environment.yml` for reference.

4. **Models**. Check that the checkpoints listed in *Model weights and where they live* are present.

5. **Archive**. Build the ZIP with `python scripts/create_offline_zip.py --platform windows` (or `linux`, or `both`). `--skip-models` leaves the checkpoints out and `--dry-run` only lists the content. The archive is named `AnnotationApp_offline_<platform>_<date>.zip`.

## Offline installation: installing on the target machine

On the target machine, unzip the archive and run the commands from `Annotation_App/`. Use `offline_windows/` on Windows and `offline_linux/` on Linux.

1. **Python environment**, one of:
   - from conda-pack: extract `offline/conda/IA_env.tar.gz` into `<miniconda>/envs/IA_env`, activate it and run `conda-unpack` to fix the absolute paths;
   - from the spec file: `conda create --name IA_env --file offline/conda/spec-file.txt`;
   - from wheels only: `conda create -n IA_env python=3.11`, then `pip install --no-index --find-links offline_windows/wheels/ torch torchvision torchaudio`.

2. **Backend dependencies and SAM2**:

   ```bash
   pip install --no-index --find-links offline_windows/wheels/ -r backend/requirements.txt
   pip install --no-index --find-links offline_windows/wheels/ segment_anything_2
   ```

3. **Frontend**: `cd frontend && npm install --offline --cache ../offline_windows/npm-cache` (or `--prefer-offline` to allow downloading what is missing).

4. **Hugging Face offline mode**: set `TRANSFORMERS_OFFLINE=1`, `HF_HUB_OFFLINE=1` and `HF_DATASETS_OFFLINE=1` before starting uvicorn, for example in a `.env` file or in the shell (`set` in CMD, `$env:NAME = "1"` in PowerShell, `export` in bash). Otherwise the backend may try to reach Hugging Face at startup.

5. **Check** the installation as described in *Verifying the installation*.

On a Linux bundle of the whole suite, replacing the `Annotation_App/` folder by a new version is enough: the suite launcher finds the app in place.

## Settings window: Interface options

The **Interface** section of the Settings window (gear button) holds display options. Settings are saved per user in `user_settings.json` of the workspace; missing keys are filled with the defaults below after an update of the app.

| Option (label) | Key | Default | Effect |
|---|---|---|---|
| **Canvas background color** | `background_color` | `#0f172a` | Color behind the image in the annotation canvas |
| **Default tool** | `default_tool` | Rectangle (`bbox`) | Tool selected when a project opens (Selection, Bounding Box, Polygon, SAM Point, Pan) |
| **Annotation opacity** | `annotation_opacity` | 0.2 | Opacity of the fill of boxes and polygons (0 = outline only, 1 = solid) |
| **Show labels** | `show_labels` | yes | Class name drawn on each annotation |
| **Show confidence score** | `show_confidence` | no | Confidence in % drawn on AI annotations |
| **Border thickness** | `annotation_border_width` | 2 | Outline thickness, 1 to 4 px |
| **Preview downscale (480/1600px)** | `preview_downscale_enabled` | enabled | Serves reduced JPEG previews (480 px while scrubbing, 1600 px at normal zoom). Disable on a fast connection to always get full resolution, with no reduced copies written to disk |
| **Real-time live by default** | `realtime_live_enabled` | enabled | During SAMURAI and SAM2 runs, the canvas follows the propagated frame, reads the image through the native share when available and shows the annotations pushed over WebSocket. When disabled, the canvas stays on your frame and the result is reloaded at the end |
| **Propagation tracking: canvas cadence** | `propagation_nav_throttle_ms` | 150 ms | Minimum interval between two image jumps of the canvas during a propagation. 150 ms follows the WebSocket loop; 700 ms saves traffic on the HTTP fallback; 0 follows every GPU result. Timeline dots and annotations are never throttled |

The height of the track lanes (`tracks_panel_height`, 92 px) is saved when you drag the handle above the timeline. Profiles saved with the former default cadence of 700 ms are migrated once to 150 ms; custom values are kept.

## Settings window: Import options

The **Import** section of the Settings window holds default values for imports.

| Option (label) | Key | Default | Effect |
|---|---|---|---|
| **JPEG quality** | `jpeg_quality` | 85 | Quality of frames extracted from videos (50 to 95). Image folders are never re-encoded |
| **Source chunk (MB)** | `chunk_size_mb` | 8 | Size of the chunks of a single-file upload, which is also the maximum RAM used by the server during the upload |
| **Frame decimation (frame_keep)** | `frame_keep` | 0 | 0 keeps all frames, 2 keeps one out of two, 3 one out of three... |
| **Image batch size** | `batch_size_images` | 20 | Number of images sent per request when uploading an image folder |

The **Import sequences** window starts its **JPEG quality** and **Frame decimation** with these values (you can change them for one import in its **Optimization options**). **Source chunk (MB)** and **Image batch size** apply to every upload. **Frames per batch (background extraction)**, **Lossless PNG for MP4 (ignores JPEG quality)** and the symbolic-link option exist only in the import window.

Guidance for extraction: JPEG quality 85 is enough for manual annotation and SAM; use 95 or lossless PNG when homography or optical flow matter, since compression artifacts disturb keypoints and gradients. A 1080p JPEG at quality 85 weighs 200 to 400 KB, so 1000 frames take 200 to 400 MB; decimating a 30 fps video to one frame out of six divides that by six. During extraction, the server holds only one decoded frame in memory at a time (about 6 MB in 1080p, 25 MB in 4K).

## Settings window: Algorithm options

The **Algorithms** section of the Settings window sets the default parameters of the AI tools. The interface reads these values when it loads (saving the Settings window reloads the page); changing a value inside a panel (Tracks tabs, text bar) only affects the current session.

| Group | Option (label) | Key | Default |
|---|---|---|---|
| NMS | **NMS IoU threshold** | `nms_iou_threshold` | 0.5 |
| Grounding DINO | Box threshold / Text threshold | `grounding_dino_box_threshold` / `grounding_dino_text_threshold` | 0.30 / 0.25 |
| Grounding DINO | **Default segmentation output** | `grounding_dino_use_sam_refine` | no (toolbar starts on **BBox**) |
| SAM2 Auto | **Points per side**, IoU threshold SAM | `sam_points_per_side`, `sam_pred_iou_thresh` | 32, 0.88 |
| Homography | XFeat top-k keypoints, XFeat min cossim | `xfeat_top_k`, `xfeat_min_cossim` | 2048, 0.82 |
| Homography | RANSAC threshold (px), **Min inliers**, **Min ratio inliers** | `ransac_threshold`, `min_inlier_count`, `min_inlier_ratio` | 4.0, 20, 0.3 |
| Optical flow | **win_size window (px)**, **max_level pyramid levels**, **Min tracked points** | `optflow_win_size`, `optflow_max_level`, `optflow_min_pts` | 21, 3, 4 |
| SAM3 | Box threshold / Text threshold | `sam3_box_threshold` / `sam3_text_threshold` | 0.25 / 0.20 |
| Detect. matching | **Max centroid distance**, **Max size variation** | `guided_max_centroid_dist`, `guided_size_variation` | 0.15, 0.5 |
| SAMURAI / SAM2 video | **Fast GPU mode** | `sam2_offload_video_to_cpu` (inverted) | checked (frames on GPU) |
| Auto-stop | **Enable auto-stop**, **Max % of lost objects**, **Consecutive frames** | `auto_stop_enabled`, `auto_stop_lost_ratio`, `auto_stop_consecutive_frames` | disabled, 0.5, 5 |

**Fast GPU mode** keeps SAMURAI frames in VRAM (1.5 to 3 times faster, limited to about 350 to 450 frames at 1024 x 1024 on 10 GB); unchecked, frames stay in RAM (minimal VRAM, long sequences, slower). The **SAM Auto** tool of the toolbar uses the **Points per side** and **IoU threshold SAM** of the SAM2 Auto settings (its stability score 0.95 and minimum mask area 100 px are fixed). **Default segmentation output** sets the starting value of the **BBox / Seg** selector of the toolbar, used by SAM Auto, Grounding DINO and SAM3. For SAM3, only the box threshold is used, as a minimum score, by the text detection bar, its batch and the **Detect.** tab; SAM3 has no text threshold. The **Detect. matching** values and the auto-stop values are the starting values of the **Detect.** tab. The meaning of each parameter is explained in [Concepts](concepts.md).

## Settings window: storage and YOLO export defaults

The last two sections of the Settings window deal with disk usage and export defaults.

**Workspace storage** shows the size of three folders of the workspace: **Projects (frames + thumbnails)**, **JSON backups** and **YOLO exports (ZIP)**. The backups and exports lines have a trash button (**Empty this folder**) that deletes their content; the project frames are never deleted from here. **Refresh** recomputes the sizes.

**YOLO export** stores default values for exports:

| Option (label) | Key | Default |
|---|---|---|
| **Train ratio**, **Val ratio**, **Test ratio** (the sum must equal 1.0) | `train_ratio`, `val_ratio`, `test_ratio` | 0.70, 0.20, 0.10 |
| **Include unannotated** | `include_unannotated` | yes |
| **Symbolic links for images** | `symlink_images` | yes (local folder, no ZIP) |

The **Export the dataset** window starts with these values (train, validation and test ratios, symbolic links) and you can change them for one export; **Include unannotated** is always applied (in `.ver`, unannotated frames are written as a line with visibility 0).

Buttons: **Reset** writes every default of every section to the file immediately, **Close** closes without saving, **Save** writes the file and reloads the page after a short delay so that every option takes effect. **Reset** also clears the share host saved in the **Workspace** menu (unless `NATIVE_SHARE_HOST` is set). The interface language is not set here: it follows VisionNexus (`?lang=` parameter), or the language toggle when the app runs outside the launcher.

## Native share (SMB) and path settings

When the backend runs on a Linux VM and the interface on Windows, frame images can be read directly from the SMB share that exposes the VM folders, instead of being downloaded through the backend and the SSH tunnel. This is much faster and relieves the backend. The same settings let you paste Windows paths in the import window.

Two settings of the `paths` group control the translation between server paths and Windows UNC paths:

- **Share host** (`native_share_host`, empty by default): the DNS name or IP of the SMB server as seen from Windows. Set it in the **Workspace** menu of the projects page (**Windows mount - share host**, then **Save the share host**), or let VisionNexus pass it with `--native-share-host` (environment variable `NATIVE_SHARE_HOST`, which takes priority). The SSH host of the VM and the share host can be different machines.
- **Shared roots** (`shared_roots`, default `home`, `mnt`, `srv`, `media`, `data`): the first segments of server paths that are exposed as shares.

Translation rule: `/srv/datasets/run01/f_000042.png` becomes `\\<share-host>\datasets\run01\f_000042.png`. The first segment (the shared root) is dropped, the second becomes the share name. Paths outside the shared roots (for example `/tmp`) cannot be read natively and always use HTTP. In the other direction, a UNC path typed in the import window, the file browser or the export destination is converted to the first existing `/<root>/<share>/...` path on the backend.

When the backend runs on the same Windows machine as the interface, paths are already native and no share host is needed. The last folders browsed on the server are remembered in `browse_history` (12 entries). How the native path is used at runtime is described in [Architecture](architecture.md).

## Verifying the installation

After installation, check each layer from `Annotation_App/`: first the Python environment and the GPU, then the running backend and its models, and finally the interface. Each check below isolates one layer, so the first one that fails tells you where to look in [Troubleshooting](troubleshooting.md).

Python and GPU:

```bash
conda activate IA_env
python -c "import backend.main; print('Backend OK')"
python -c "import torch; print('CUDA:', torch.cuda.is_available())"
python -c "from backend.services.homography_service import homography_service; print('XFeat' if homography_service._use_xfeat else 'SIFT+RANSAC')"
```

Running backend:

```bash
curl http://localhost:8000/health                  # {"status": "ok", ..., "sam2": {...}}
curl http://localhost:8000/api/sam/ping            # SAM2 loaded, device, model
curl http://localhost:8000/api/sam/grounding/status
curl http://localhost:8000/api/sam3/status
curl http://localhost:8000/api/samurai/status
```

Checklist:

- `conda activate IA_env` succeeds and `ffmpeg -version` works.
- uvicorn starts without error and `/health` answers `"status": "ok"`.
- `backend/checkpoints/sam2.1_hiera_small.pt` exists and `/api/sam/ping` reports `loaded`.
- `npm run dev` starts on port 5173 and the interface opens without console errors.
- In a Sequence Image project, the **SAMURAI** tab shows **SAMURAI active (Kalman)** and the **Homog.** tab shows **XFeat GPU** on a GPU machine.

## Local mode and remote VM mode

Annotation App runs the same code in two deployments; only where the backend runs changes.

**Local mode**: backend, models and interface run on the same computer (Windows or Linux). Frames are read from the local disk; paths are native; no share host is needed. Suited to a workstation with its own GPU and moderate datasets.

**Remote VM mode**: the backend, SQLite and the models run on a Linux GPU VM; the interface runs in VisionNexus on a Windows workstation. The API and the WebSockets go through an SSH tunnel to a local port; frame pixels are read directly from the SMB share (`app-image://` protocol of VisionNexus) when the share host is configured, with an automatic HTTP fallback. Memory used by the backend and the models is on the VM, not on the workstation.

Recommendations for remote mode:

- Import datasets by server path with symbolic links rather than by upload.
- Configure the share host, so that images do not go through the tunnel.
- Keep **Preview downscale** enabled unless the connection is fast.
- Keep **Real-time live by default** enabled; raise the canvas cadence to 700 ms only if the native path is not available.
- Check the logs for `chemin NATIF (SMB)` at the start of a SAMURAI run (the log lines are in French): see [Troubleshooting](troubleshooting.md) if it says `REPLI HTTP`.
