*[Lire en francais](README.fr.md)*

# Orchestrator App

Central hub of the Computer Vision pipeline. A visual graph editor (Sandgraph) for designing,
running and monitoring multi-application workflows without writing any configuration: it chains
the suite's other apps (Dataset Explorer, Annotation, Training, DVC, MLflow, Optuna) via a DAG of
nodes linked by connections, with auto-launch of sub-apps and human validation at critical
steps.

**Frontend**: http://localhost:3000 - **Backend**: http://localhost:8060

---

## Getting started

```bash
cd Orchestrator_App
python launcher.py --workspace C:/ws --user alice
```

The seven sub-applications (explorer, Annotation, Optuna, Training, Inference, MLflow and DVC) are launched **automatically**
based on the nodes present in the graph. No manual startup required.

---

## Available nodes

| Node | App triggered | What it does |
|------|---------------|---------------|
| **Dataset Source** | Dataset_Explorer_App | Loads an image folder, runs CLIP embedding |
| **Dataset Explorer** | Dataset_Explorer_App | Creates a semantic subset via a text query (top_k images) |
| **Annotation** | Annotation_App | Creates a project, annotates (manual or AI), exports YOLO |
| **Model (.pt)** | none | Entry node with no pipeline step: feeds an existing YOLO model to Training (fine-tuning) or to Inference, without going through an upstream Training |
| **Training** | Training_App | Trains a YOLO (auto or manual gate) -> `best.pt` |
| **Inference / Eval** | Inference_App | UNIFIED node (see FREE/LOCKED below) |
| **DVC Commit** | dvc-app | Versions dataset + annotations |
| **MLflow** | mlflow-app | **SUPERVISOR**: watches the store, no incoming edge |
| **Optuna HPO** | optuna-app | Human gate: optimize the hyperparameters |

### Inference / Eval node - FREE / LOCKED

- **FREE** (no input) -> opens Inference App to choose a media file, weights file
  and interactive mode.
- **LOCKED** (has input) -> detection evaluation or multi-object inference. The
  tracker is either disabled for pure YOLO inference or set to ByteTrack.
  An empty `model_path` uses the upstream Training weights.

Full detail of FREE/LOCKED mode (frontend/backend implementation):
[docs/architecture.md](docs/architecture.md#free--locked-node-mode-cle-du-systeme).

### MLflow - SUPERVISOR node

MLflow is **not** a pipeline step: it is an **observer** of the workspace's MLflow store
(serverless). No real incoming edge in the flow, no generated step;
MLflow_App is auto-launched as soon as an MLflow node exists, and the node displays a **live
summary** of the runs.

### Valid connections

```
DatasetSource -> Dataset Explorer -> Annotation -> Training -> Inference/Eval
                              (Training -> DVC ; Optuna -> Training)
   MLflow = isolated supervisor (not connected)
```

- **Dataset Explorer -> Dataset Explorer**: subset-of-subset - the 2nd explorer filters within the images of the 1st subset
- **Auto-propagation**: DatasetSource->Dataset Explorer copies `dataset_name`; Dataset Explorer->Annotation copies `subset_name`

Each node declares typed input/output ports (dataset, subset, YOLO dataset, GT `.ver`,
model, best params, metrics) rather than a simple list of accepted types - color per type,
exclusivity between certain inputs (e.g. Inference: raw images OR YOLO dataset, never both),
required inputs. Full validation rules: [docs/architecture.md](docs/architecture.md#ports-types-des-nodes-portsts).

---

## Annotation modes

### Manual
`create-project` -> **human gate** (annotate in Annotation_App) -> `export-yolo`

### Full Automatic AI
`create-project` -> `auto-annotate` (SAM3 or Grounding DINO) -> `export-yolo`

The **Text prompt** field of the Annotation node defines what is detected (e.g. `"Cars"`,
`"person. bicycle. car."`).

---

## MLOps features (MLOps tab)

A tab groups experiment monitoring and traceability, in sub-tabs
(Insights, Plans, Activity, Lineage, Guide).

**Run Insight**
- At the end of (and progressively during) each run, the app collects everything the sub-apps
  know about that run (per-epoch training metrics, Optuna studies, MLflow runs, DVC commits) and
  generates a report: interactive charts, analysis images from the training engine (confusion
  matrix, PR/F1 curves, a summary if the engine produces one), a full log of the steps.
- Run identity card with direct links to the real object (Git commit, DVC dataset, MLflow run,
  model) and an honest reproducibility checklist (no "green" by default).
- One-click actions: fork a run (rerun with the same dataset/annotations while changing the
  parameters) or promote an experimental run to MLOps tracking (adds MLflow + DVC to the graph).

**Lineage**
- Interactive graph linking ALL experiments in the workspace: source dataset, runs, forks,
  models and MLflow steps produced, navigable down to the real object.
- Side-by-side comparison of two runs (drag and drop): only the sections that differ
  (dataset, annotations, hyperparameters, results...) are highlighted.

**Experiment Plans**
- Plan a suite of experiments (each = a duplicated base graph + modified parameters) and launch
  them in one click, with human gates auto-validated; the results of each step are then
  browsable in the Lineage. The DVC commit always remains a manual decision.

Full technical detail (collection, data format, comparison, execution engine):
[docs/architecture.md](docs/architecture.md#run-insight-et-lineage-git--dvc--mlflow) and
[docs/architecture.md](docs/architecture.md#plans-dexperiences).

---

## Node configuration

### Dataset Source
| Field | Description |
|-------|-------------|
| Dataset name | Identifier in Dataset_Explorer_App |
| Path (folder) | Absolute path to the images |
| n_clusters | CLIP clusters for visualization (default 15) |

### Dataset Explorer
| Field | Description |
|-------|-------------|
| Subset name | Identifier of the subset to create |
| Semantic query | Text describing the desired images |
| top_k | Number of images to select |

### Annotation
| Field | Description |
|-------|-------------|
| Mode | `random` (individual images) or `sequence` (video/sequence) |
| Full Auto | Enables AI annotation with no human gate |
| AI Model | `SAM3` or `Grounding DINO` |
| Text prompt | Classes to detect |
| Confidence threshold | Minimum detection score (default 0.20) |
| Train / Val split | Proportion of the YOLO export |

---

## Backend API (port 8060)

| Method | Route | Description |
|---------|-------|-------------|
| GET | `/api/graphs` | List of graphs |
| POST | `/api/graphs` | Create a graph |
| GET/PUT/DELETE | `/api/graphs/{id}` | Read / edit / delete |
| POST | `/api/graphs/{id}/duplicate` | Duplicate |
| POST | `/api/graphs/{id}/reset` | Reset the execution |
| POST | `/api/graphs/{id}/run` | Launch the pipeline |
| GET | `/api/graphs/{id}/run/{run_id}/stream` | Real-time SSE events |
| POST | `/api/graphs/{id}/resume` | Resume after a human gate |
| GET | `/api/activity` | Run history |
| GET/POST | `/api/apps` | Sub-app status and launch |

---

## Internal architecture

```
backend/
  api/graphs.py          CRUD + SSE stream + resume
  core/graph_runner.py   Graph -> PipelineDef (translates nodes into HTTP steps)
  core/pipeline_runner.py Async DAG engine: executes the steps, handles the gates
  core/graph_store.py    JSON persistence of the graphs
  core/app_launcher.py   Sub-app spawn / stop / health
  config.py              APP_URLS, ports, workspace paths

frontend/src/
  pages/SandgraphPage.tsx  ReactFlow editor, connection validation, SSE client
  nodes/AppNode.tsx        Visual node rendering (status, subset/export bullets)
  components/NodeConfigPanel.tsx  Side configuration panel
```

Full detail (SSE, FREE/LOCKED, file by file): [docs/architecture.md](docs/architecture.md).

---

## Workspace structure

```
{WORKSPACE}/
  orchestrator_{user}/
    graphs/experiments.json    persisted sandgraphs
    pipelines/                 generated pipelines
    activity.json
    sessions.json
  explorer_{user}/                 Dataset_Explorer_App workspace
  annotation_{user}/           Annotation_App workspace
  dvc_{user}/
  mlflow_{user}/
  optuna_{user}/
```

---

## Default ports

Reference table (Orchestrator backend/frontend + the 7 sub-apps):
[docs/architecture.md](docs/architecture.md#ports).

---

## Canvas - shortcuts

| Key | Action |
|--------|--------|
| `Ctrl+Z` / `Ctrl+Y` | Undo / Redo |
| `F` | Fit view |
| `Suppr` / `Backspace` | Delete selection |
| Canvas locked during execution | - |

---

## Documentation

- **[docs/README.md](docs/README.md)**: thematic index of the documentation (architecture,
  test scenarios, adding a new connected app).
