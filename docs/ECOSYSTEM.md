*[Lire en francais](ECOSYSTEM.fr.md)*

# CV Suite - Full Ecosystem Reference

> Last updated: 2026-09-13. Every fact below is checked against the code or
> the current docs of the relevant app, not copied from an older revision.

---

## 1. Overview

8 independent applications (7 business apps + 1 orchestrator). Each app runs
autonomously; the orchestrator chains them over HTTP according to a visual
DAG (sandgraph).

```
+-----------------------------------------------------------+
|                    ORCHESTRATOR (8060)                    |
|  Sandgraph  ->  PipelineDef  ->  DAG executor  ->  SSE    |
+----+-------+--------+--------+--------+--------+----------+
     |       |        |        |        |        |
  Explorer  Annot.  Training  DVC   MLflow  Optuna  Inference
  (8001)   (8000)   (8064)  (8061) (8062)  (8063)   (8065, FREE node)
```

`Inference_App` is a file-based inference node. It receives a model and media
path from the graph. MLflow remains an isolated supervisor node (see section
4.6).

---

## 2. Port map

### Full-stack / launched by the unified launcher (authoritative)

| App | Launcher key | Backend | Frontend | Workspace subdir |
|-----|-------------|---------|----------|-------------------|
| Orchestrator | `orchestrator` | **8060** | **3000** | `orchestrator_<user>/` |
| Annotation | `annotation` | **8000** | **5173** | `annotation_<user>/` |
| Dataset Explorer | `explorer` | **8001** | **5174** | `explorer_<user>/` |
| Training | `training` | **8064** | **5176** | `training_<user>/` |
| DVC | `dvc` | **8061** | **3002** | `dvc_<user>/` |
| MLflow | `mlflow` | **8062** | **3001** | `mlflow_<user>/` |
| Optuna | `optuna` | **8063** | **3003** | `optuna_<user>/` |
| Inference | `inference` | **8065** | **5177** | `inference_<user>/` |

> Rule: these ports are fixed in the unified launcher. Never hardcode them
> in application code, always read `APP_URLS`/`config.py`.

### Known pitfall: standalone vs full-stack defaults

Several apps have a different default port depending on whether they are
launched alone (`start.sh`/direct uvicorn, for isolated dev) or through the
unified launcher:

- **DVC_App**: standalone 8002/3002, full-stack 8061/3002 (only the backend
  changes).
- **MLflow_App**: standalone 8001/3001 (possible collision with
  Dataset_Explorer_App in full-stack mode, which also uses 8001), full-stack
  8062/3001.

This is not a bug: these are two distinct usage modes. But do not assume
that a `curl localhost:8001` necessarily targets MLflow or explorer -- it
depends on the launch context.

---

## 3. Launching

### Unified launcher (recommended)
```bash
python launcher.py --app orchestrator --workspace <WORKSPACE> --user bob
python launcher.py --app annotation   --workspace <WORKSPACE> --user bob
python launcher.py --app explorer         --workspace <WORKSPACE> --user bob
python launcher.py --app training     --workspace <WORKSPACE> --user bob
python launcher.py --app dvc          --workspace <WORKSPACE> --user bob
python launcher.py --app mlflow       --workspace <WORKSPACE> --user bob
python launcher.py --app optuna       --workspace <WORKSPACE> --user bob
python launcher.py --app inference    --workspace <WORKSPACE> --user bob
```

### From the Orchestrator (recommended for dev)
Applications -> Launch button on each card -> the apps start in the
background, the frontend opens automatically.

### Launching a single app (debug)
```bash
cd Annotation_App && python launcher.py --workspace <WORKSPACE> --user bob
```

### Export / bundle

`App/Vision/package_cv_bundle.py` (one level above `Computer_Vision_App/`)
produces a turnkey zip (global launcher + Node runtime + docs + apps). This
is also the script that feeds the GitHub publication process
(`App/Vision/publish_github.py`): it systematically excludes `CLAUDE.md`
files (internal dev notes) and content specific to the deployment hardware,
so that only generic per-application docs get published.

---

## 4. Current state of each application

### 4.1 Orchestrator_App
Visual pipeline editor (ReactFlow sandgraph), DAG executor with SSE. Nodes:
`dataset_source`, `explorer`, `annotation`, `training`, `dvc`, `mlflow`,
`optuna`. Automatic FREE/LOCKED mode based on connectivity. See
[Orchestrator_App/docs/README.md](../Orchestrator_App/docs/README.md).

### 4.2 Annotation_App
Image and video/format specialise sequence annotation with AI assistance (SAM2/SAMURAI,
Grounding DINO, custom YOLO, homography, optical flow). Multi-sequence,
16-bit images, YOLO/COCO/VER export. See
[Annotation_App/docs/README.md](../Annotation_App/docs/README.md).

### 4.3 Dataset_Explorer_App
Exploration and analysis of image datasets via CLIP + FAISS embeddings,
UMAP/t-SNE/PCA, semantic search, subset management, export to
Annotation_App. See [Dataset_Explorer_App/docs/README.md](../Dataset_Explorer_App/docs/README.md).

### 4.4 Training_App
YOLO training (v8/v9/v10/v11) with real-time SSE (loss, mAP50, mAP50-95,
precision, recall per epoch). **MLflow auto-push is already implemented**
(`backend/services/mlflow_logging.py`, writes directly to the per-user
sqlite store `mlflow_<user>/mlflow_data/mlflow.db`) -- unlike what the older
docs listed as missing. See
[Training_App/docs/README.md](../Training_App/docs/README.md).

### 4.5 DVC_App
Dataset versioning via DVC + Git (commits, history, diff, sync). Diff and
Sync pages are complete (real diff table, SSE push/pull with cancellation).
See [DVC_App/README.md](../DVC_App/README.md).

### 4.6 MLflow_App
ML experiment tracking, model registry. Serverless pivot: reads directly
from the per-user sqlite store, no more MLflow server subprocess. It is an
**isolated supervisor node** in the orchestrator: no incoming edge, no
`mlflow-check` gate, auto-launches as soon as an MLflow node exists in the
graph and shows a live summary of the store. See
[MLflow_App/README.md](../MLflow_App/README.md).

### 4.7 Optuna_App
Bayesian hyperparameter optimization (Optuna + SQLite), real-time SSE. Two
distinct orchestrator contracts: user script (`--name value` args + final
metric on the last stdout line) and the `/api/orchestrator/hpo` endpoint
(blocking for the whole study). See
[Optuna_App/README.md](../Optuna_App/README.md).

### 4.8 Inference_App
Compact FastAPI + React application for YOLO inference from image/video files
or image directories. Pure detection is the default; ByteTrack can be enabled
for MOT, and click-SOT uses OpenCV CSRT after the first YOLO detection. The
evaluation view reports mAP50, mAP50-95, PR/F1 curves, a confusion matrix and
separate detector/tracker/global timings. See
[Inference_App/docs/architecture.md](../Inference_App/docs/architecture.md).

---

## 5. How to grow the suite

See [ADDING_AN_APP.md](ADDING_AN_APP.md) for the full checklist
(`/api/orchestrator/` endpoint, declaration in `config.py`,
`graph_runner.py` node, frontend `NODE_ACCEPTS`/`TOOLBOX_NODES`).

Golden rules:
| Rule | Detail |
|-------|--------|
| 1 app = 1 README.md + 1 docs/ | See [APP_TEMPLATE.md](APP_TEMPLATE.md) to start from a solid base |
| `/api/orchestrator/` contract | Never rename these endpoints without updating `graph_runner.py` |
| Sacred workspace | Never write into the app's own directory, always into `WORKSPACE/<app>_<user>/` |
| Tests before merge | Every app has its own unit tests, always run them before touching the backend |

---

## 6. Workspace structure (reference)

```
WORKSPACE/
  orchestrator_bob/     graphs/ pipelines/ activity.json experiments/
  annotation_bob/       annotation.db  projects/  exports/
  explorer_bob/              dataset_explorer.db  thumbs/  faiss/  subsets/
  training_bob/         runs/
  dvc_bob/               settings.json
  mlflow_bob/            mlflow_data/mlflow.db
  optuna_bob/            optuna.db
  inference_bob/        runs/  config.yaml
```

---

## 7. Test scenarios

Templates SC1 to SC5 (Orchestrator, `ExperimentsPage`): see
[Orchestrator_App/docs/test-scenarios.md](../Orchestrator_App/docs/test-scenarios.md).

---

## 8. Global tech stack

| Layer | Tech |
|--------|--------|
| Backend | Python 3.11+, FastAPI, uvicorn, SQLite (SQLModel), asyncio |
| Inter-app HTTP | httpx (async), proxy_client.py in the Orchestrator |
| Frontend | React 18/19, TypeScript, Vite, Tailwind CSS, lucide-react |
| Server state | TanStack Query v5 |
| Client state | Zustand |
| Graph/Canvas | @xyflow/react (ReactFlow), Konva.js (Annotation) |
| Real time | SSE via direct fetch() to the backend (bypasses the Vite proxy) |
| ML | CLIP (open_clip), FAISS, UMAP-learn, SAM2/SAMURAI, Grounding DINO, YOLO |
| Training | Ultralytics YOLO (v8/v9/v10/v11) |
| Video tracking | YOLO detections, optional ByteTrack MOT, click-SOT with OpenCV CSRT (Inference_App) |
| Experiment tracking | MLflow (serverless, sqlite) |
| HPO | Optuna + SQLite |
| Versioning | DVC + Git |
| OS | Windows 11 (dev), Linux (target GPU VM) |

---

## 9. Per-app documentation reference

| App | Doc |
|-----|-----|
| Orchestrator_App | [docs/README.md](../Orchestrator_App/docs/README.md) |
| Annotation_App | [docs/README.md](../Annotation_App/docs/README.md) |
| Dataset_Explorer_App | [docs/README.md](../Dataset_Explorer_App/docs/README.md) |
| Training_App | [docs/README.md](../Training_App/docs/README.md) |
| DVC_App | [README.md](../DVC_App/README.md) (no docs/, the app is too small to warrant one) |
| MLflow_App | [README.md](../MLflow_App/README.md) (same) |
| Optuna_App | [README.md](../Optuna_App/README.md) (same) |
| Inference_App | [README.md](../Inference_App/README.md), [architecture.md](../Inference_App/docs/architecture.md) |
