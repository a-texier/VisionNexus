---
app: orchestrator
doc_type: user-guide
audience: user
lang: en
title: User guide
order: 10
tags: [sandgraph, nodes, toolbar, configuration panel, experiments, mlops, insights, lineage]
sources: [Orchestrator_App/frontend/src/App.tsx, Orchestrator_App/frontend/src/pages/SandgraphPage.tsx, Orchestrator_App/frontend/src/components/NodeConfigPanel.tsx, Orchestrator_App/frontend/src/nodes/AppNode.tsx, Orchestrator_App/frontend/src/nodes/ports.ts, Orchestrator_App/frontend/src/nodes/nodeHelp.ts, Orchestrator_App/frontend/src/pages/ExperimentsPage.tsx, Orchestrator_App/frontend/src/pages/InsightsPage.tsx, Orchestrator_App/frontend/src/pages/PlansPage.tsx, Orchestrator_App/frontend/src/pages/ActivityPage.tsx, Orchestrator_App/frontend/src/pages/LineageGraphPage.tsx, Orchestrator_App/frontend/src/pages/GuidePage.tsx, Orchestrator_App/frontend/src/pages/AppsPage.tsx, Orchestrator_App/frontend/src/components/UserBadge.tsx]
---

# User guide

## Main window and navigation of Orchestrator App

The Orchestrator App window has a sidebar on the left and the current page on the right. The sidebar lists six entries, from top to bottom:

- **Sandgraph**: the visual pipeline editor, the home page of the app.
- **Experiments**: the list of saved graphs and the predefined templates.
- **MLOps**: monitoring and traceability, with the sub-tabs **Insights**, **Plans**, **Activity**, **Lineage** and **Guide**.
- **About**: a static presentation of the platform.
- **Settings**: a placeholder page that only shows "Workspace configuration.". The real settings of the suite live in VisionNexus and in [Configuration](configuration.md).
- **Applications**: the launch and status page of the seven sub-applications.

The bottom of the sidebar holds the user badge: the current user name, then three buttons (**Open workspace**, **Workspace history**, **Connected users**) and the language toggle. **Open workspace** opens the workspace folder in the file explorer of the machine that runs the backend, so it only makes sense for a local launch. **Workspace history** lists the recently used workspaces that still exist and opens one of them the same way. **Connected users** lists the Orchestrator instances registered on the same machine, with their workspace.

The language toggle switches between English and French. When VisionNexus launches the app, it imposes the language through the `?lang=` URL parameter. A few labels are written in French in the code without translation (for example **Intervention requise**, **Stop**, **Auto Save**, **Kill All**); they stay in French in both languages, and this guide quotes them as displayed.

## Sandgraph editor: toolbox and canvas

The **Sandgraph** page is where you build and run a pipeline, called a graph or an experiment. It has three zones: the toolbox on the left, the canvas in the center and, when a node is selected, the configuration panel on the right.

The toolbox, titled **Nodes** with the hint "Drag onto canvas", lists the node types in two groups:

- **Applications**: **Dataset Explorer**, **Annotation**, **Training**, **Inference / Eval**, **DVC Commit**, **MLflow (superviseur)** and **Optuna HPO**.
- **Inputs**: **Dataset Source** and **Modèle**.

Drag an entry onto the canvas to create a node with its default values. The footer of the toolbox recalls the shortcuts: `Del` deletes, `F` fits the view, `Ctrl+Z` / `Ctrl+Y` undo and redo.

On the canvas:

| Action | Effect |
|---|---|
| Mouse wheel, drag on the background | Zoom and pan |
| Drag a node | Move it (allowed even during a run) |
| Drag from an output port to an input port | Create an edge, if the ports are compatible |
| Drag from a port and release in the void | Open the compatible node popup |
| Click a node | Open its configuration panel |
| Click the background | Close the configuration panel |
| `Del` or `Backspace` | Delete the selected nodes or edges (blocked during a run) |
| `F`, or the **F** button at the top right | Fit the view |
| `Ctrl+Z`, `Ctrl+Y` or `Ctrl+Shift+Z` | Undo, redo |
| `Ctrl+S` | Save the graph |

The bottom left corner holds the zoom controls and the bottom right corner a minimap, where each node is colored by its execution status. When no graph exists, the canvas shows **No experiment** with a **Create an experiment** button.

During a run, connecting and deleting are blocked because they would break the link between pipeline steps and nodes; moving nodes and zooming stay possible.

## Sandgraph top bar

The top bar of the **Sandgraph** page controls the open graph. From left to right:

- **Graph selector**: a drop-down list with a status dot per graph. It offers **Nouvelle expérience** at the top and, on hover of a graph, duplicate and delete icons. The last opened graph is remembered per workspace and user.
- **Graph name**: click it (**Click to rename**) to rename the graph; `Enter` confirms, `Esc` cancels.
- **MLOps badge**: **MLOps** in green when the graph contains both an MLflow node and a DVC node; **Incomplete tracking - complete it** in amber when only one of them is present (click to add the missing one); **Experimental - Track in MLOps** when neither is present (click to add both). See [Concepts](concepts.md) for what this changes.
- **Undo (Ctrl+Z)** and **Redo (Ctrl+Y)**.
- **Auto Save**: when active, the graph is saved one second after each edit, with the same validation as a manual save. The choice is remembered in the browser.
- **Auto Check**: when active, the application nodes are aligned and spaced automatically after each edit. It does not save by itself; combine it with **Auto Save** to persist the layout.
- **Save**: shown only when there are unsaved changes. Saving validates the graph first (see the section on ports of this guide) and propagates names along the edges.
- **Run**: saves the graph, validates it, then starts the pipeline. During a run it is replaced by the elapsed time in seconds, **Stop** (**Stop the pipeline**) and **Reset**. At a human gate, an orange **Done -> Continue** button also appears.
- **Insights**: shown after a successful run, it opens the Insights sub-tab (**Plots and log of the last run**).
- **Event log**: shows or hides the log panel on the right, with the number of entries.

Without **Auto Save**, changes made in the configuration panel are kept only in the page until you click **Save** or press `Ctrl+S`. **Run** always saves first.

## Node cards on the canvas

Each node is a card whose header shows the icon, the name and a status. The border and the minimap color follow the execution status: gray (idle), blue (running), orange (waiting for you), green (done), red (failed).

Elements that may appear on a card:

- **FREE** (green, open lock) or **LOCKED** (amber, closed lock) on Dataset Explorer, Annotation and Inference / Eval nodes. FREE means the node has no incoming edge; LOCKED means it runs a new pipeline. The distinction is explained in [Concepts](concepts.md).
- **Execution order badge** at the top right: the logical step number of the node in the pipeline.
- **Action required**: the node waits at a human gate.
- **Step failed** with the error message, or **HPO failed - Training fallback active** for an Optuna study that failed with the continue policy.
- **Live tracking**: under a running node, one line per sub-step (for example scan, CLIP embedding, subset creation) with its progress bar, and result chips at the end (subset size, annotated frames, mAP, DVC hash...).
- **Choose an existing subset** or **Choose an existing annotation** on FREE Dataset Explorer and Annotation nodes: opens the configuration panel on the list of existing outputs.
- An **Open** link to the sub-application of the node.
- The ports strip at the bottom: inputs on the left, outputs on the right, colored by data type.

Each edge carries a label that says what travels on it, for example `subset : night_dark` or `dataset YOLO : Annot_cars-yolo`. The label reads `None` as long as the source has nothing concrete to pass. Edges are drawn with right angles and avoid the nodes; double-click an edge to add a waypoint and switch it to manual routing.

## Node configuration panel and help panel

Clicking a node opens its configuration panel on the right. The header shows the node type, a red help button (**Help - parameter explanations**), a delete button (**Delete (Del)**) and a close button. The first field of every node is **Node name (displayed)**; the other fields depend on the node type and are described one by one in the sections of this guide.

Common rules in the panel:

- A field grayed with a lock is provided by a connected node (tooltip "Fourni par un nœud branché (figé)"); change it on the source node.
- Path fields accept a typed path, a pasted Windows or network path, a folder dragged from the Windows explorer, and a **Browse...** button when the app runs inside VisionNexus. A UNC path such as `\\server\share\images` is translated for a Linux backend at run time (see [Configuration](configuration.md)).
- A mode toggle offers an automatic mode (for example **Full Automatic (AI)**) and a manual mode, where the pipeline stops at a human gate so you can work in the sub-application.
- A gray **Output** box at the bottom summarizes what the node will produce and where it goes.

The help button opens a second panel next to the configuration panel, resizable by dragging its left edge. It lists each parameter of the node with what it is, its options and its effect, and ends with a link to the matching section of this guide.

## Connecting nodes: ports and compatibility

Every node declares typed ports. The type decides the color of the port and of the edge:

| Port type | Color | Produced by |
|---|---|---|
| dataset | amber | Dataset Source |
| subset | violet | Dataset Explorer |
| dataset YOLO | rose | Annotation (output `out_yolo`) |
| GT (.ver) | teal | Annotation (output `out_ver`) |
| model | blue | Modèle, Training |
| best params | cyan | Optuna HPO |
| metrics | emerald | Inference / Eval |

Accepted connections, per input port:

| Target node | Input port | Accepted sources |
|---|---|---|
| Dataset Explorer | dataset | Dataset Source, Dataset Explorer, Inference / Eval |
| Annotation | images (required) | Dataset Explorer, Inference / Eval, Dataset Source |
| Optuna HPO | dataset YOLO (required) | Annotation |
| Training | dataset YOLO (required) | Annotation |
| Training | model | Modèle |
| Training | best params | Optuna HPO |
| Inference / Eval | model | Training, Modèle |
| Inference / Eval | dataset (images) | Dataset Source (exclusive with dataset YOLO) |
| Inference / Eval | dataset YOLO (GT included) | Annotation (exclusive with dataset (images)) |
| Inference / Eval | GT (.ver) | Annotation (meaningful only with dataset (images)) |

Dataset Source and Modèle have no input. DVC Commit and MLflow have no port at all: they observe the whole graph and are never connected.

An incompatible connection is refused while you drag. Connecting a second exclusive input shows "Exclusive inputs: disconnect the other port first.". A missing required input, two exclusive inputs, or an engine or size mismatch between model nodes blocks **Save** and **Run** with a message such as "Annotation : entrée obligatoire manquante". A FREE Dataset Explorer or Annotation node is exempt from the required input rule. A GT (.ver) input without a dataset (images) input only raises a warning.

Dragging a wire from a port and releasing it on an empty spot opens a popup (**Search a compatible node...**) that lists the node types able to connect to that port. Type to filter, click an entry or press `Enter` to create the node already connected.

When you save, some names follow the edges automatically: a Dataset Explorer takes the dataset name of its source and proposes `subset_<dataset>`, an Annotation takes the subset name and proposes `Annot_<subset>`, a Training proposes `best_<export>` as run name, and a Modèle node imposes its engine and size on the connected Training. A name you edit by hand is kept until the source value changes again.

## Run banners, event log and end of chain window

While a graph runs, several elements appear around the canvas of the **Sandgraph** page to follow the pipeline and to ask for your intervention.

### Human gate banner of the Sandgraph

When the pipeline reaches a human gate, an orange banner titled **Intervention requise** appears under the top bar. It shows the instruction of the step, an **Ouvrir <app>** link to the sub-application concerned, the button **Terminé -> Continuer** and, after it, the label of the next step ("ensuite : ..."). The same continue action exists in the top bar as **Done -> Continue**.

For a LOCKED Annotation node in manual mode, the banner lists the exports already produced for the project, grouped into **.ver (GT natif)** and **Dataset YOLO**, and the continue button stays disabled until you click one. For a LOCKED Dataset Explorer node in manual mode, it lists the existing subsets the same way. The list refreshes every 30 seconds and after each export step.

### Fork divergence banner of the Sandgraph

A graph created by forking a run shows an indigo banner under the top bar: **Fork de <run>**, the frozen base (dataset, Git commit, parent mAP50) and a counter of diverging parameters. Unfold it to see, per node, the parameters that changed (old value -> new value) and those that stay identical. A red block warns when a Dataset Explorer or Annotation node has changed parameters but kept the same `subset_name` or `project_name`: the run would then reuse or overwrite the existing output instead of creating a new one.

### Event log of the Sandgraph

The **Event log** button opens the **Logs** panel on the right. Entries are grouped into foldable blocks, one per node, colored by node type, with a red counter of errors. Each entry has a time, a message and an optional detail (the full error of a failed step, for example). The log of each graph is kept in the browser per workspace, and the same blocks are shown in the Insights and Activity sub-tabs.

When the pipeline finishes successfully, a **Chain complete** window opens. It says whether the run is already versioned or not; if not, the DVC node blinks until you create a version. **Open the DVC node** selects it, **Later** closes the window.

## Dataset Source node

The **Dataset Source** node is an input: it points to a folder of images on the backend machine. Connected to a Dataset Explorer, it makes the pipeline scan the folder and compute CLIP embeddings; connected to an Annotation, it imports the folder directly; connected to an Inference / Eval, it provides the sequence to process.

Fields:

- **Dataset name** (`dataset_name`, default `mon-dataset`): identifier of the dataset in Dataset Explorer; reused downstream as subset or project name.
- **Path (folder)** (`dataset_path`): absolute path of the image folder. The panel asks Dataset Explorer whether this path is already known under another name; if so, it shows "Ce chemin existe déjà dans Dataset Explorer sous ce nom" and a checkbox **Create a separate dataset anyway (new scan + re-embedding CLIP)** (`allow_duplicate`). Without the checkbox, the existing dataset is reused.
- **n_clusters** (default 15): number of CLIP clusters shown in the Dataset Explorer playground.

## Model node

The **Modèle** node is an input that provides existing weights, without an upstream Training. Connect it to a Training to fine-tune from these weights, or to an Inference / Eval to test them.

Fields:

- **Training engine** (`engine`): the engine that produced the weights. YOLOX is the default; the selector appears only when a plugin provides other engines.
- **Model path** (`model_path`), followed by the accepted extensions of the engine: path of the weights file. A warning appears when the extension does not match the engine ("ces poids ne se chargeront pas").
- **Size (locks Training)** (`model_size`): the architecture of the weights. When the node is connected to a Training, the engine and size of the Training are locked to these values, because weights only reload with their own engine and size.

## Dataset Explorer node

The **Dataset Explorer** node selects a subset of images with Dataset Explorer. In LOCKED mode (with an incoming edge) it creates a new subset; in FREE mode (no incoming edge) it exposes a subset that already exists in the workspace.

Fields:

- **Dataset source** (`dataset_name`): filled from the connected source and locked (**Dataset source (branché · figé)**).
- **Nom du subset (sortie)** (`subset_name`): name of the subset to create or to use. **Browse** loads the existing subsets of the workspace (`explorer_<user>/subsets/`) with their image count; in FREE mode, clicking one selects it.
- **Full Automatic (CLIP)** / **Manual** (`full_auto`, default automatic): automatic mode selects the images with a CLIP text query; manual mode stops at a gate so you create the subset yourself in the Dataset Explorer playground.
- **Semantic query** (`query`): text describing the wanted images, for example `night dark road car headlight`.
- **top_k** (default 50): number of images selected, the closest to the query.

In automatic LOCKED mode the node produces four steps: a gate to check the CLIP clusters, the subset creation, a gate to validate the subset, and the export of the subset to the Annotation imports folder. Chaining two Dataset Explorer nodes creates a subset of a subset.

## Annotation node

The **Annotation** node creates an Annotation App project from its input, annotates it automatically or waits for you, then exports it in two formats: a YOLO dataset and a `.ver` ground truth file. In FREE mode it exposes an export that already exists.

Fields:

- **Subset source** (`subset_name`): filled from the connected Dataset Explorer or Dataset Source, locked.
- **Project name (to annotate)** (`project_name`): the Annotation App project, proposed as `Annot_<subset>`. The panel warns when the subset was already imported into another project ("Ce subset a déjà été annoté dans ce projet").
- **Mode** (`annotation_mode`): **Sequential (frame by frame)** (`sequence`, default) or **Random** (`random`).
- **Train**, **Val**, **Test** (`split_train` 0.8, `split_val` 0.2, `split_test` 0): split of the YOLO export.
- **Full Automatic (AI)** / **Manual (annotate in the app)** (`full_auto`, default manual for a new node).
- In automatic mode: **AI model** (`ai_model`: **SAM 3** or **Grounding DINO**), **Text prompt (open-vocab)** (`ai_text`, for example `car. person. tree.`), **Box threshold (box_threshold)** or **Confidence threshold** (`ai_threshold`, default 0.5 for a new node), and **Review annotations before export (Continue)** (`review_before_export`), which adds a gate after the automatic annotation.
- **Export to use (downstream)**, FREE mode only: **Browse** lists the exports of `annotation_<user>/exports/` in two blocks, **.ver (-> Inference/Éval)** and **YOLO (-> Training/Optuna)**; the chosen one is stored in `export_name`.
- **Classes (labels)** (`label_classes`): list of classes with a color, **+** to add one; a new node starts with `objet`.

In LOCKED automatic mode the export is automatic (the `<project>-yolo` dataset is created by itself). In LOCKED manual mode, the export to use is chosen in the human gate banner while the pipeline waits.

## Training node

The **Training** node trains a model with Training App. Its form is built from the catalog of the selected engine, fetched from Training App (or from the local registry when Training App is not running).

Fields:

- **Run / model name (output)** (`run_label`): name of the run and of the final weights.
- **Training engine** (`engine`, default YOLOX): locked by a connected Modèle node. A red message appears when an upstream Optuna study optimizes another engine.
- **Size** (`model_size`): model size in the engine catalog (for YOLOX: nano, tiny, s, m, l, x); empty means the engine default; locked by a connected Modèle node.
- **Epochs** (default 300 for a new node), **Batch** (16), **Imgsz** (640).
- **Device**: `auto`, `cpu` or `cuda:0`.
- **Full Automatic (REST)** / **Manual (start in the app)** (`full_auto`): automatic mode calls Training App and waits for the end of training; manual mode stops at a gate while you train in Training App.
- **All hyperparameters (N)**: foldable list of every hyperparameter of the engine, with its default. When an Optuna node is connected, these values are locked ("figés (Optuna)") because the best params of the study replace them at run time.

The dataset path is derived from the connected Annotation node; you never type it.

## Inference / Eval node

The **Inference / Eval** node evaluates or runs a model with Inference App. Without any input (FREE) it opens an interactive session in Inference App: choose a media file, a weights file and a mode there.

With inputs (LOCKED):

- **Auto (headless)** / **Manual (interactive)** (`full_auto`): manual mode stops at a gate while you run YOLO, MOT or click-based SOT in the app.
- **Task** (`task`): **Tracking (tracker)** (`tracking`, default) or **Detection (YOLO only)** (`detection`).
- **Training engine** and **Architecture** (`engine`, `model_size`): locked by the upstream model. A red message appears when this node declares another engine or size than the upstream checkpoint.
- **Model (best.pt)** (`model_path`): empty means the best weights of the upstream Training (or the path of the Modèle node).
- **Sequence (source)** (`sequence_dir`): locked when a Dataset Source is connected; empty with a connected Annotation means the images of the chosen split.
- **Annotation split (train/val/test)** (`gt_split`, default `val`): shown when an Annotation is connected; picks the split used as sequence and ground truth.
- **GT (YOLO .txt folder / .ver)** (`annotation_file`): ground truth; empty means the `.ver` export of the connected Annotation, otherwise the labels of the chosen split.
- **conf**, **iou**, **imgsz** (`conf_thresh`, `iou_thresh`, `img_size`).
- Tracking only: **Multi-object tracker** (`tracker_mot`: **None - YOLO only** or **ByteTrack**), **Track high**, **Match IoU**, and the foldable blocks **Rendering & saving** (**Save the annotated media**, **Max frames (0 = all)**), **Window & system** (**Device**, **ByteTrack buffer**) and **raw yaml (all params)** (any key of the Inference App configuration, in JSON).
- **full config.yaml (all params, pre-filled)**: every key of the Inference App `config/defaults.yaml`, grouped; only the fields you change are sent.

In detection mode, the node runs a standard validation of the model on the chosen split of the YOLO dataset (mAP50, mAP50-95, precision, recall, PR and F1 curves, confusion matrix), with no tracker. In tracking mode, it runs YOLO alone or YOLO plus ByteTrack on the sequence and reports speed and, with a ground truth, tracking metrics.

## Optuna HPO node

The **Optuna HPO** node runs a hyperparameter study with Optuna App. Each trial is a full training on the YOLO dataset of the connected Annotation; the best parameters travel on the edge to the downstream Training.

Fields:

- **Nb trials** (`n_trials`, default 20).
- **Direction** (`direction`): **Maximize** (default) or **Minimize**.
- **Objective metric** (`metric`): mAP@50 (default), mAP@50-95, Recall or Precision.
- **Training engine** and **Size trained by the trials** (`engine`, `model_size`): must match the downstream Training, otherwise the run is refused.
- **Stop the pipeline if no trial succeeds** (`stop_on_failure`, checked by default): when unchecked and the study fails, the Training starts anyway with its own configured parameters.
- **Full Automatic (auto study)** / **Manual (gate - study in the app)** (`full_auto`).
- **Search space (N selected)**: the hyperparameters to optimize, checked; the ranges are fixed by the engine catalog. With nothing checked, the default selection of the engine is used.
- In manual mode, **best_params (-> Training)**: the best parameters you found in Optuna App, as `key=value` pairs separated by commas, or JSON.

The sampler is TPE and pruning is disabled.

## DVC Commit node

The **DVC Commit** node versions the outputs of a finished run on demand. It has no port: it observes the whole graph. Nothing is versioned automatically at launch; as long as you do not click, the run is not traced in DVC.

The panel shows:

- An amber explanation: creating a version makes a Git commit of the snapshot with the run metadata (Run-Id, dataset, mAP50), stores the content of the checked artifacts in the DVC cache, and pushes it if a remote is configured.
- The version state of the last finished run: **Versioned** (commit, dataset, date) or **Not versioned - no DVC commit for this run**.
- **Commit message** (`commit_message`).
- **Graph artifacts** with **refresh**: one line per artifact of the run with a checkbox, its path, its size and a **download** link: the YOLO dataset, the GT annotations (.ver), the best model, the best Optuna params, the final metrics (`metrics.json` of the Insight) and the graph snapshot (JSON). An artifact not produced yet shows "pas encore produit - lancez le pipeline".
- **Create a DVC version (Git + DVC cache)**: disabled until a run has finished, and replaced by **Run already versioned** once done.
- **Open this run in DVC App**.

## MLflow node

The **MLflow (superviseur)** node observes the MLflow store of the workspace. It has no port and no parameter. Its presence makes the pipeline launch MLflow App, and each Training, Inference / Eval and Optuna step logs its runs there under a deterministic name `{graph}/{node}`, in one MLflow experiment named after the graph.

The panel lists **What will be logged**: one line per Training (parameters, mAP, plots, weights) and per Inference / Eval (mAP, MOTA, IDF1, benchmark). The node card shows the planned runs (**À logger**) and a live summary of the store (**Store (live)**), or "MLflow_App non lancée" when the app does not answer. **Open this run in MLflow App** opens the last run.

## Experiments page

The **Experiments** page lists your graphs and the predefined templates.

The **Predefined templates** block (read only) has two groups:

- **Mainstream scenarios**: **Quick training**, **Standard chain** and **Chain + Optuna HPO**.
- **Example scenarios / use case**: **Dataset exploration**, **Re-train from existing annotation** and **Annotation from existing subset**.

Each template card shows a description and tags. **Use this template** creates a new graph from it and opens it in the Sandgraph. The content of each template and how to use it are described in [Workflows](workflows.md).

Under **My experiments**, each graph card shows its name, status badge, number of nodes and connections, a progress bar of finished nodes, the last modification and the number of runs. Actions: **Open**, **Run** (or **Reset** while it runs), **Duplicate** and **Delete** (with a confirmation). **New** creates an empty graph.

## MLOps tab: Insights sub-tab

The **Insights** sub-tab shows the Run Insight of each run: the collected results, plots and lineage of one execution. The list on the left shows one entry per run (graph name, run id, number of plots, generation date), with a delete icon on hover; deleting an Insight only removes a display cache. The header offers one regenerate button per recent graph.

The detail of a run contains, from top to bottom:

- **Run identity**: the run id, the MLOps or Experimental badge, the fork origin, and six fields (Git, Dataset, DVC version, MLflow Run, Model, mAP50), each either a real link or marked as not linked.
- Actions: **Open MLflow Run**, **Inspect DVC**, **Inspect Dataset**, **View Artifacts**, **Open Sandgraph**, **Open Lineage**, **Track in MLOps** (for an experimental graph) and **Fork this run**.
- **Reproduce Run**: a four-step recipe (restore the data version in DVC App, pull the files, fork and relaunch, compare with the original MLflow run), active only when the run is reproducible.
- **Reproducibility**: the checklist, **Reproducible** or **Incomplete**, with the detail of each check.
- **Regenerate** and **Export HTML report** (a standalone file with interactive charts).
- **Results - trained models**, **Training - curves per epoch** (mAP, losses, precision and recall), **Optuna - study history**, **Detailed model analysis** (confusion matrix, PR and F1 curves, label distribution, validation images), **Step log** and **Full logs**, and the list of files persisted in the workspace.

The content of an Insight and the meaning of each check are explained in [Concepts](concepts.md).

## MLOps tab: Plans sub-tab

The **Plans** sub-tab (**Experiment Plans**) builds a series of experiments and runs it in one click. The list of plans is on the left; **New plan** creates one.

For the selected plan:

- The plan name, **Save**, **Run the plan** and a delete icon.
- One card per step: a step label, the base graph to duplicate (**graphe de base...**), and override fields: **Subset**, **Annot. project**, **Nb images**, **Annot. threshold**, **Epochs**, **LR per image**, **Batch** and **Run label**. Empty fields keep the value of the base graph.
- **Add a step**.
- During and after execution, a progress block with the status of each step and, when available, its mAP50, DVC version and Git commit.

The intro text of the page says that a plan commits in DVC; this is not the case: a plan never creates a DVC commit, you version the runs you want from the DVC node. How the overrides are applied is described in [Concepts](concepts.md).

## MLOps tab: Activity sub-tab

The **Activity** sub-tab is the raw journal of every execution, newest first. A search field (**Filter by name...**), a status filter (**All statuses**) and **Reset** narrow the list; the footer shows how many rows are displayed.

Columns: **Statut**, **Experiment** (graph or pipeline name), **Étapes** (number of steps), **Démarré**, **Durée** and **Actions**. Row actions:

- **Open the graph** in the Sandgraph.
- **View logs**: the full logs of the last run of the graph, in foldable blocks.
- **Stop this run**, for a run still in progress.
- **Duplicate and redo** / **Redo**: duplicates the graph so you can relaunch it.

The journal keeps the last 200 executions.

## MLOps tab: Lineage sub-tab

The **Lineage** sub-tab (**Experiment lineage**) shows how all runs of all graphs relate: common source datasets, extracted subsets, runs, forks, models, MLflow runs and produced artifacts.

Controls:

- **Graph** / **List**: graph view (runs grouped per experiment, source dataset at the top) or list view.
- **Compact** / **Expand**: hides or shows the productions of each run.
- A search field (`Run, dataset, subset...`).
- Clicking a node opens **Details**: consumed inputs, produced outputs, direct links to DVC App and MLflow App, **Fork this run** and **Compare this run**.

Each run also appears as a draggable token. Drop two tokens in the **Run comparison** panel to compare them section by section: identical sections stay discreet, differences are marked as modified, added or removed, field by field. An output absent in a fork is never replaced by the one of its parent. Only finished runs are shown; failed and interrupted runs are hidden from this view.

## MLOps tab: Guide sub-tab

The **Guide** sub-tab is the built-in documentation: it displays the nine pages of this documentation, in the interface language. The left column groups the pages into **User**, **Installation et réglages** and **Développeur**, and shows the table of contents of the open page. Links between pages stay inside the Guide, and the URL (`/mlops/guide?doc=<page>#h-<n>`) can be bookmarked. When a page is missing in the current language, the other language is shown with a notice.

## Applications page

The **Applications** page launches and monitors the seven sub-applications (annotation, explorer, training, inference, dvc, mlflow, optuna) started by this Orchestrator instance. Each card shows the app id, a description, the health status (latency in ms, or `offline`), the workspace of the running session, and the buttons **Open** (frontend of the app) and **Run** or **Stop**.

**Run** opens a small window with **Base workspace** (empty means inside the Orchestrator workspace), **User** (empty means the current user) and **Conda env** (default `IA_env`). **Launch All** launches every app that is not running, **Kill All** stops them all. A card in error shows **Startup failed** with the reason and the path of the backend log; a card starting shows **Starting...**. The page refreshes every 3 seconds.

You rarely need this page: running a graph launches the apps it needs automatically (see [Concepts](concepts.md)). The footer (**Standalone mode**) recalls that each app can also be launched on its own with the suite launcher.

## About, Settings and hidden legacy pages

The **About** page is a static presentation of the platform (applications, a sample training loop, technologies, quick start, shortcuts). Its content predates several changes (for example DVC is no longer an automatic step), so rely on this documentation instead. The **Settings** page is an empty placeholder.

Three older pages are still reachable only by URL: `/dashboard` (active pipelines and recent activity), `/library` (a list-based pipeline editor, predating the Sandgraph) and `/pipeline/<id>` (the run view of such a pipeline). They use the legacy pipeline API and are not needed for normal use.
