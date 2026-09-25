---
app: explorer
doc_type: configuration
audience: both
lang: en
title: Configuration
order: 40
tags: [installation, clip weights, ports, environment variables, workspace, settings, symlinks]
sources: [Dataset_Explorer_App/backend/config.py, Dataset_Explorer_App/backend/api/settings.py, Dataset_Explorer_App/launcher.py, _lib/launcher_engine.py, Dataset_Explorer_App/frontend/vite.config.ts, Dataset_Explorer_App/backend/core/subset_manager.py, Dataset_Explorer_App/backend/core/job_runner.py, Dataset_Explorer_App/backend/utils/native_share.py, Dataset_Explorer_App/frontend/src/pages/SettingsPage.tsx, MODEL_WEIGHTS.md]
---

# Configuration

## Requirements and dependencies of Dataset Explorer

Dataset Explorer needs Python 3.12 (the suite uses the conda environment `IA_env`) and Node.js with npm for the frontend. A CUDA GPU speeds up the embeddings but is optional: CLIP runs on CPU when no GPU is found.

Python packages used by the backend:

- Web and storage: `fastapi`, `uvicorn`, `pydantic`, `sqlmodel` (SQLAlchemy, SQLite).
- Models and maths: `torch`, `open_clip_torch`, `numpy`, `pillow`, `faiss-cpu` (or a GPU build of FAISS), `umap-learn`, `scikit-learn` (t-SNE, PCA, KMeans), `hdbscan`.
- Optional features: `opencv-python` (faster and more complete reading of 16-bit and infrared images; PIL is used otherwise), `pandas` with `openpyxl` or `xlrd` (metadata tables; CSV needs only `pandas`), `httpx` (only for the Orchestrator `start-embed` call).

First installation from the suite root, in a terminal where `IA_env` is active:

```bash
pip install open_clip_torch faiss-cpu umap-learn hdbscan sqlmodel pandas openpyxl
cd Dataset_Explorer_App/frontend
npm install
```

The CLIP weights must then be placed as described in the next section. The app never downloads anything by itself.

## CLIP model weights

Dataset Explorer works offline: at startup it sets `HF_HUB_OFFLINE=1` and `TRANSFORMERS_OFFLINE=1` (unless they are already defined) and loads the CLIP ViT-B/32 weights from a local source, in this order:

1. The file given by the `CLIP_WEIGHTS` environment variable, when it exists.
2. The bundled file `Dataset_Explorer_App/models/ViT-B-32-openai.safetensors`.
3. The Hugging Face cache, still offline, for the `openai` tag of `ViT-B-32`.

The expected file is `open_clip_model.safetensors` from the Hugging Face repository `timm/vit_base_patch32_clip_224.openai`, renamed `ViT-B-32-openai.safetensors` (see `MODEL_WEIGHTS.md` at the suite root). To fill the cache once with a network connection instead, start the backend with `HF_HUB_OFFLINE=0`.

The architecture name must stay `ViT-B-32` (not `ViT-B-32-quickgelu`): it is the variant that reproduces the embeddings already stored in existing databases. Changing the model makes stored embeddings incompatible; in that case re-encode each dataset with `POST /api/datasets/{id}/embed?force=true`.

If no weights are found, the backend still starts but logs "Impossible de charger CLIP", `/health` reports `clip_loaded: false`, and every embedding and search request fails with "Modele CLIP non charge" (see [Troubleshooting](troubleshooting.md)).

## Launching Dataset Explorer

VisionNexus launches Dataset Explorer for you, locally or on the remote VM, with the user and workspace chosen in the launcher. Without VisionNexus, two command-line launchers exist.

From the suite root (shared launcher, same options for every app):

```bash
python launcher.py --app explorer --workspace <workspaces root> --user <name>
```

From the app folder (standalone launcher):

```bash
python Dataset_Explorer_App/launcher.py --workspace <workspaces root> --user <name>
```

Both create the workspace `<workspaces root>/explorer_<name>/`, pick free ports, register the instance in the shared list of running instances, then start the backend (uvicorn on `127.0.0.1`) and the Vite frontend. Useful options: `--backend-port` and `--frontend-port` to force ports, `--backend-only`, `--no-reload` (the backend auto-reloads on code changes otherwise), `--conda-env` (default `IA_env`) and `--native-share-host` (see *Remote VM and native share*). Workspaces created before the app was renamed (`visu_<name>` with `visu_bdd.db`) are renamed automatically on first launch.

Manual launch for development, from `Dataset_Explorer_App/`:

```bash
BACKEND_PORT=8001 EXPLORER_FRONTEND_PORT=5173 uvicorn backend.main:app --host 127.0.0.1 --port 8001 --reload
cd frontend && VITE_BACKEND_PORT=8001 npm run dev -- --port 5173
```

Without `EXPLORER_WORKSPACE`, the manual launch uses `Dataset_Explorer_App/data/` as workspace.

## Ports and network

Each Dataset Explorer instance uses two ports: the FastAPI backend and the Vite frontend.

| Launch | Backend | Frontend |
|---|---|---|
| Suite or app launcher | first free port from 8001 | first free port from 5174 |
| Manual | 8001 (`BACKEND_PORT`) | 5173 (`VITE_FRONTEND_PORT`) |

Several users can run their own instance on the same machine: the launchers skip ports already used by other registered instances.

The browser only talks to the frontend port. Vite forwards `/api`, `/thumbs` and `/gallery-thumbs` to the backend (`VITE_BACKEND_PORT`, timeout 5 minutes), including the progress streams of merge and rebuild operations. This is why only the frontend port needs to be forwarded when the app runs on a remote VM over SSH. The backend accepts cross-origin requests from `localhost` and `127.0.0.1` on the frontend port given by `EXPLORER_FRONTEND_PORT`, and always on 5173, 5174 and 5175.

The interactive API documentation of FastAPI is available on the backend port at `/docs`.

## Environment variables

The launchers set most of these variables; set them yourself only for a manual launch or a special deployment.

| Variable | Default | Effect |
|---|---|---|
| `EXPLORER_WORKSPACE` | `Dataset_Explorer_App/data` | Workspace folder (database, thumbnails, indexes, subsets, settings). |
| `EXPLORER_USER` | `unknown` | Current user; owner of the datasets and folders it publishes, shown in the audit log. |
| `BACKEND_PORT` | `8001` | Backend port, used for the self-call of the Orchestrator `start-embed`. |
| `EXPLORER_FRONTEND_PORT` | `5173` | Frontend port allowed by CORS. |
| `VITE_BACKEND_PORT`, `VITE_FRONTEND_PORT` | `8001`, `5173` | Proxy target and port of the Vite server. |
| `VITE_IA_USER` | `anonymous` | User name shown in the user badge. |
| `ANNOTATION_APP_IMPORTS` | `<suite>/Annotation_App/data/imports` | Default export folder for subsets. The Orchestrator sets it to the `imports` folder of the Annotation App workspace. |
| `CLIP_WEIGHTS` | empty | Explicit path of the CLIP weights file. |
| `HF_HUB_OFFLINE`, `TRANSFORMERS_OFFLINE` | `1` | Forbid any download by Hugging Face libraries. |
| `CV_DATA_TUTO` | `<suite>/data_tuto` | Folder of the tutorial sample images. |
| `EXPLORER_JOB_WORKERS` | `3` | Number of heavy background jobs running at the same time. |
| `NATIVE_SHARE_HOST` | empty | Share host for Windows paths (set by `--native-share-host`). |
| `LAUNCHED_BY_ORCHESTRATOR` | unset | Set by the Orchestrator; exports then always go to `ANNOTATION_APP_IMPORTS`. |
| `IA_INSTANCES_FILE`, `IA_APP_ID`, `IA_WORKSPACE_HISTORY_FILE` | set by the launchers | Sources of the **Connected users** and **Workspace history** panels. |
| `VITE_CACHE_DIR` | unset | Separate Vite cache when two frontends run from the same folder. |

## Workspace layout on disk

The workspace of a Dataset Explorer user holds all its persistent data, outside the source code:

```text
<workspaces root>/explorer_<user>/
|-- dataset_explorer.db     SQLite database (datasets, images, embeddings, clusters, subsets, folders)
|-- settings.json           settings of the Settings page, pinned datasets, fallback language and tutorial state
|-- audit.jsonl             audit log of deletions, locks and exports (rotated at 5 MB into audit.jsonl.1)
|-- thumbs/                 256-pixel JPEG thumbnails named <md5>.jpg
|-- faiss/<dataset id>/index.faiss   similarity index of each dataset
`-- subsets/<subset name>/  one folder of links (or copies) per subset
```

Thumbnails are named after the MD5 of the image file, so identical files share one thumbnail. Deleting a dataset removes its records, its index and the thumbnails no other image uses; the subset folders under `subsets/` stay on disk.

Shared data lives in the application folder, not in the workspace, so that every workspace of the installation sees it:

```text
Dataset_Explorer_App/data/dataset_gallery/
|-- registry.json           published datasets: name, path, counts, basic statistics, thumbnails, owner, folder
|-- folders_registry.json   shared folders
`-- <dataset name>/thumbs/0.jpg ... 4.jpg   fixed preview thumbnails of a published dataset
```

Back up the workspace folder to keep the analyses; back up `dataset_gallery/` to keep the shared catalog.

## Symbolic links on Windows

Subsets and exports are made of symbolic links by default. On Linux they always work. On Windows, creating a symbolic link requires Developer Mode (Windows Settings, For developers, Developer Mode on) or a backend started with administrator rights.

Without either, creating a subset records it in the database but its folder cannot be filled (a warning is logged), and exporting fails. Two solutions: enable Developer Mode, or choose **Physical copy** in **Subsets & links** of the **Settings** page. Copies take disk space and time but work everywhere, including on shares that refuse links. The choice applies to the next subsets and exports; existing folders are not converted.

Links are relative when possible and absolute otherwise (different drives). A link breaks if the original image is moved.

## Options of the Settings page

The **Settings** page writes `settings.json` in the workspace when you click **Save changes**. Options and their real effect:

| Option | Default | Effect |
|---|---|---|
| **Imports folder** | `ANNOTATION_APP_IMPORTS` | Default export folder when the export window has no **Destination folder** (standalone mode; an Orchestrator launch always uses its own folder). |
| **Link strategy** | Symlinks | Symbolic links or physical copies for subsets and exports. |
| **Method** (reduction) | UMAP | Method of the next embeddings, **Recompute map**, merges and rebuilds; a change flags existing maps as outdated. |
| `n_neighbors`, `min_dist` | 15, 0.1 | UMAP parameters. |
| **Perplexity**, **Learning rate** | 30, 200 | t-SNE parameters. |
| **Default method** (clustering) | KMeans | Clustering of the next embeddings and filtered merges; default of the **Cluster** panels. |
| `min_cluster_size` | 5 | HDBSCAN parameter. |
| **Clusters KMeans** | 20 | Loaded by the **Default** buttons of the Cluster panels. The add form always starts at 20. |
| **Search Top-K** | 20 | Starting value of Top-K in the search pages. |
| **UMAP map color mode (default)** | Cluster | Color mode the map opens with (**Cluster**, **Rarity** or **Uniform**). |
| **Application background**, **Accent color** | Dark gray, Indigo | Theme of the interface. |

Fields without an interface, editable in `settings.json`: `native_share_host` (share host, overridden by `NATIVE_SHARE_HOST`), `ui_language` (language used outside VisionNexus), `tutorial_launched_once` and `tutorial_completed` (tutorial state outside VisionNexus), `playground_dataset_ids` (pinned datasets).

## Remote VM and native share

When the Dataset Explorer backend runs on a Linux VM and the interface on Windows, paths travel in both directions and need a share host: the DNS name or IP of the SMB server that exposes the VM folders to Windows. VisionNexus passes it with `--native-share-host`; it can also be set in `settings.json` (`native_share_host`).

The translation assumes that the share name is the second segment of the server path under a known root (`/home`, `/mnt`, `/srv`, `/media`, `/data`):

- Server to Windows: `/srv/datasets/run01/img.jpg` becomes `\\<share host>\datasets\run01\img.jpg`. Inside VisionNexus, thumbnails and full-resolution images are then read directly from the share, which is much faster over SSH; without a share host they are served by the backend.
- Windows to server: a path such as `\\host\datasets\run01` typed or dropped in **Add a dataset** (and in the Orchestrator dataset source) becomes the first existing folder among `/home/datasets/run01`, `/mnt/datasets/run01`, `/srv/datasets/run01`, `/media/datasets/run01`, `/data/datasets/run01`.

Local Windows paths (`D:\...`) are used as they are.
