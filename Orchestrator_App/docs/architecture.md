*[Lire en francais](architecture.fr.md)*

# Architecture - Orchestrator App

Back to [docs/README.md](README.md).

This document covers the internal workings of the orchestrator: graph -> pipeline conversion,
async DAG execution, SSE architecture, FREE/LOCKED mode, sub-app auto-launch, and the file-by-file
detail of the backend and frontend.

---

<a id="ports"></a>
## Ports

Single reference table for the whole Computer Vision suite (orchestrator + sub-apps). Do not
duplicate this table elsewhere: README.md points here.

| Service | Port |
|---------|------|
| Orchestrator backend | 8060 |
| Orchestrator frontend | 3000 |
| Annotation_App | 8000 |
| Dataset_Explorer_App | 8001 |
| dvc-app | 8061 |
| mlflow-app | 8062 |
| optuna-app | 8063 |
| Training_App | 8064 |
| Inference_App | 8065 |

`config.py` reads `APP_URLS` / `APP_FRONTEND_URLS` as mutable dicts: `graph_runner.py` updates
them live when it launches an app (`APP_URLS[key] = session.backend_url`). Never copy them,
always read by reference.

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

Critical rule: existing outputs (explorer subsets, Annotation exports) always come from the
workspace filesystem, never from application directories. See
`GET /api/graphs/meta/workspace-outputs`.
- Explorer subsets: `explorer_{user}/subsets/{name}/`
- Annotation exports: `annotation_{user}/exports/{name}.zip`

---

<a id="free--locked-node-mode-cle-du-systeme"></a>
## FREE / LOCKED node mode (key to the system)

Every `explorer` and `annotation` node has two modes depending on its connectivity:

### FREE MODE (no incoming edge)
- The node **exposes the workspace's existing outputs** (filesystem scan)
- The user **clicks** a subset/export to select it -> updates `subset_name` / `project_name`
- The node is **directly connectable** downstream without launching a pipeline
- **No pipeline step is generated** by this node -> the corresponding app is not auto-launched
- Green `FREE` badge shown in the node header

### LOCKED MODE (at least one incoming edge)
- The node **runs a new pipeline** from its input
- Shows the output that will be produced after the run (single)
- Amber `LOCKED` badge shown in the node header

### Technical implementation

**Frontend (`AppNode.tsx`)**:
- `data.has_input: boolean` - computed from the edges, never persisted
- In FREE mode: clicking an item -> `window.dispatchEvent('orch:select-output', {nodeId, nodeType, name})`
- In LOCKED mode: classic display, items not clickable

**Frontend (`SandgraphPage.tsx`)**:
- `useEffect([edges])` -> recomputes `has_input` for all nodes whenever the topology changes
- `window.addEventListener('orch:select-output')` -> updates `subset_name`/`project_name`
- `refreshWorkspaceOutputs()` -> also injects `has_input` via `edgesRef.current`
- `has_input` is stripped on save/run (derived state, not persisted)

**Backend (`graph_runner.py`)**:
- `_is_free_node(node, edges)` -> True if ntype != dataset_source AND no incoming edge
- `graph_to_pipeline()` -> skips FREE nodes (no step generated)
- `_needed_app_keys()` -> skips FREE nodes (app not launched)

---

<a id="node-types-et-leurs-etapes-pipeline"></a>
## Node types and their pipeline steps

Step IDs follow the `{node_id}__{action}` convention (double underscore).

### dataset_source
- `{id}__load` -> POST Dataset_Explorer_App `/api/orchestrator/load-dataset`
- `{id}__embed` -> POST Dataset_Explorer_App `/api/orchestrator/start-embed`

### explorer (LOCKED only - if FREE: no step)
- `{id}__verifyembed` -> human_gate (check the CLIP clusters in the explorer playground)
- `{id}__subset` -> POST Dataset_Explorer_App `/api/orchestrator/create-subset`
- `{id}__validatesubset` -> human_gate (check the subset's images)
- `{id}__export` -> POST Dataset_Explorer_App `/api/orchestrator/export-subset`
- After a successful export: the frontend rescans the workspace -> `available_subsets` refreshed

### annotation (LOCKED only - if FREE: no step)
- `{id}__project` -> POST Annotation_App `/api/orchestrator/create-project`
- If `full_auto=true`: `{id}__auto_annotate` -> POST Annotation_App `/api/orchestrator/auto-annotate`
- If `full_auto=false`: `{id}__annotate` -> human_gate
- `{id}__exportyolo` -> POST Annotation_App `/api/orchestrator/export-yolo`
- After a successful exportyolo: the frontend rescans the workspace -> `available_exports` refreshed

### dvc
- `{id}__commit` -> POST dvc-app `/api/orchestrator/commit`

### training
- `{id}__train` -> POST Training_App `/api/orchestrator/train` (task, automatic)
- Inputs: YOLO dataset (`annotation`, required), starting model (node `model`, optional),
  best HPO params (`optuna`, optional) - see [Typed node ports](#ports-types-des-nodes-portsts)
- Parameters sent: `engine`, `model_size`, `epochs`/`batch`/`imgsz` (generic, translated by
  Training_App into the engine's own keys) and `hyperparams` (an engine-specific dict, plus the
  legacy YOLOX keys stored flat by earlier graphs).

### Training engine within a graph
The `model`, `training` and `optuna` nodes carry an `engine` field (empty = the default engine,
YOLOX). Their panels are built from `GET /api/engines` (Training_App's catalogs, falling back to
the local registry if the app isn't launched): no engine name is hardcoded in the frontend, and
with no plugin no selector appears. When building the pipeline (`graph_runner.py`), an explicit
refusal (`GraphConfigError` -> HTTP 400) is raised rather than failing mid-run:
- a connected `model` node imposes its engine and size on the `training` node (its weights only
  reload with them);
- an `optuna` study and the `training` it feeds must share the same engine;
- an `inference` currently only accepts weights from the default engine (the only engine
  Inference_App can load).

### mlflow / optuna
- `{id}__train` / `{id}__hpo` -> human_gate

MLflow is **not** a classic pipeline step: it is an **observer** of the workspace's MLflow
store (serverless). MLflow_App is auto-launched as soon as an MLflow node exists, and the node
displays a live summary of the runs.

### model
No pipeline step generated: a `model` node is never LOCKED, it has no input. It is a pure
value source (engine, size and weights path entered by hand in `NodeConfigPanel`, extension
checked against the engine's catalog) exposed via its `model` output port, consumed by
`training` (starting weights / fine-tuning) or `inference` (model to test) without going
through an upstream Training. See the [Typed node ports](#ports-types-des-nodes-portsts)
section below.

---

<a id="ports-types-des-nodes-portsts"></a>
## Typed node ports (ports.ts)

`NODE_ACCEPTS` (the old flat `target type -> accepted source types` dict in SandgraphPage.tsx)
has been replaced by `frontend/src/nodes/ports.ts`: a **per-port** schema, not just per node.
A node declares **inputs** (on the left) and **outputs** (on the right), each with a data type
(`PortType`) that determines its color (handle + edge):

```typescript
type PortType = 'dataset' | 'subset' | 'yolo' | 'ver' | 'model' | 'params' | 'metrics' | 'any'
```

What the ports system solves, which a per-node `NODE_ACCEPTS` could not express:
- **Several typed inputs on the same node**: `training` has 3 independent inputs
  (`dataset` <- annotation, `model` <- `model` node only, `hpo` <- optuna), each with its own
  handle and its own acceptance rule (`accepts`).
- **Several typed outputs on the same node**: `annotation` has 2 distinct outputs
  (`out_yolo` = full YOLO dataset -> Training/Optuna, `out_ver` = native `.ver` format for
  Inference_App -> Inference/Eval). `resolveHandles(srcType, tgtType)` automatically picks the
  right pair of handles on connection (source whose TYPE matches the chosen target port).
- **Exclusivity between two inputs** (`exclusiveWith`): on `inference`, `sequence` (raw images)
  and `dataset_yolo` (YOLO dataset, GT included) can never be connected at the same time -
  `wouldViolateExclusivity` blocks the connection BEFORE it is created.
- **Dependency between inputs** (`requiresPeer`): on `inference`, `gt` (.ver) only makes sense if
  `sequence` is also connected - otherwise `validatePortRules` raises a simple warning (not
  blocking).
- **Required input** (`required`): `validatePortRules` refuses saving/launching if a `required`
  port isn't connected, EXCEPT in FREE mode (explorer/annotation with no edge stay valid).

`dvc` and `mlflow` have `{ inputs: [], outputs: [] }`: no ports, so **unconnectable**. They are
pure observers of the workspace (DVC scans the artifacts produced by the whole graph via
`_gather_graph_artifacts`, MLflow scans its store), not DAG steps.

`compatibleNodeTypes(fromType, handleType, handleId)` feeds the "compatible node" popup when you
drag a wire from a port without dropping it on a target (drag-to-create).

`explorer` and `annotation` nodes with NO incoming input automatically stay in FREE mode (the
ports system changes nothing about FREE/LOCKED, see the dedicated section above).

Auto-propagation of parameters on `onConnect` (unchanged):
- `dataset_source -> explorer`: copies `dataset_name`
- `explorer -> explorer`: copies `dataset_name`
- `explorer -> annotation`: copies `subset_name`
- `dataset_source -> annotation`: copies `dataset_name` into `subset_name`

Special cases:
- **Dataset Explorer -> Dataset Explorer**: subset-of-subset - the 2nd explorer filters within
  the images of the 1st subset
- **Inference FREE**: opens a manual file session (YOLO, MOT or click-SOT)

### Visual rendering of ports (`NodePorts.tsx`) and edges (`OrthogonalEdge.tsx`)

`NodePorts` is the "blueprint" strip shown at the bottom of each node (via `NODE_PORTS[nodeType]`):
an Inputs column on the left, an Outputs column on the right, each port on its own row with its
own ReactFlow handle. An input port is colored/lit only if THAT specific handle receives an edge
(`inputHandles.includes(p.id)`) - not if the node has an incoming edge on ANOTHER port (a fixed
bug: on `inference`, `dataset_yolo` and `gt` both accept an `annotation` source, a per-type check
would have lit up `gt` as soon as `dataset_yolo` was connected).

`OrthogonalEdge` replaces the old `smoothstep` + `DetourEdge` fallback: it is now the ONLY
edge type (`edgeTypes = { orthogonal: OrthogonalEdge }`), used for every connection. The path is
computed by `routing.ts` (a pure module, with no React/xyflow dependency): detection of nodes to
route around, choice of a mode (`direct` / `zbend` / `corridor`), stacking of parallel corridors,
SVG path generation. As long as the edge hasn't been hand-edited, the path is recomputed
automatically on every node move. As soon as a waypoint is added (double-click on the edge) or
moved, the edge switches to `routeMode: 'manual'` and keeps that path fixed (a button on the
label lets you go back to automatic routing). Convention: an output always leaves its node to
the right, an input always receives from the left.

---

<a id="sse-architecture"></a>
## SSE architecture

1. `start_run` -> creates a `RunState` in `_active_runs: dict[str, RunState]` (in-memory)
2. The pipeline emits events into `state.events: list[dict]`
3. `stream_events(run_id)` is an async generator that replays every event from cursor=0 on each connection
4. `graphs.py`'s `event_generator` consumes this stream, updates `graph_store`, and yields SSE to the client

### Human gate flow
- `_run_step` sets `state.status = "waiting"`, emits the waiting event, returns
- `_execute` sees `state.status == "waiting"` -> returns
- `stream_events` exits when `cursor >= len(events)` at the waiting event
- The frontend shows the "Intervention required" banner
- The user clicks "Continue" -> POST `/api/graphs/{id}/resume`
- `resume_run` marks the waiting step as success, emits the success event, calls `_execute` again
- The frontend reconnects the SSE -> replays every event from cursor=0

<a id="loop-bug-fix-mai-2026"></a>
### Loop bug fix (May 2026)
- Root cause: on SSE reconnect after resume, `event_generator` exited on the historical "waiting"
  event AND `graph_store.update_node_exec` regressed the node's status back to "waiting"
- Fix 1 (`graphs.py`): removed `if evt_type in ("done", "waiting"): return` - it now only exits
  on "done"
- Fix 2 (`graph_store.py`): removed "waiting" from the "always update" bypass in
  `update_node_exec`; the graph-level status only switches to "waiting" if the node actually
  transitions down from a higher rank

### Server restart fix
- `run_in_memory(run_id)` checks whether the run exists in `_active_runs`
- If missing on resume: `reset_graph_execution()` -> HTTP 410 -> the frontend refreshes

---

## Auto-launch flow

1. `run_graph()` calls `_preflight_check()` -> lists the unreachable apps needed by the graph's nodes
2. For FREE nodes: app not included in `_needed_app_keys` -> no auto-launch
3. For LOCKED nodes: auto-launch in the background if the app isn't available
4. Each step calls `_wait_for_app(step.app, max_wait=60s)` before executing - polls `/health` every 2s

---

## Canvas behavior (SandgraphPage.tsx)

- `nodesDraggable`, `nodesConnectable`, `deleteKeyCode` all disabled when `isRunning || isWaiting`
- Undo/redo: `useRef` stacks (`historyRef`, `futureRef`) + mirror refs (`nodesRef`, `edgesRef`) to avoid stale closures
- Auto-propagation on `onConnect` (see the connections section above)
- `stepNodeMap` (`step_id -> node_id`) is set by `runMut.onSuccess` and reused by `resumeMut.onSuccess`
- `has_input` injected via `useEffect([edges])` + `refreshWorkspaceOutputs()`, stripped on save/run

Shortcuts:

| Key | Action |
|--------|--------|
| `Ctrl+Z` / `Ctrl+Y` | Undo / Redo |
| `F` | Fit view |
| `Suppr` / `Backspace` | Delete selection |
| Canvas locked during execution | - |

---

## Annotation node params

Fields in `node.data`:
- `annotation_mode`: `"sequence"` | `"random"`
- `full_auto`: boolean
- `ai_model`: `"sam3"` | `"grounding_dino"`
- `ai_text`: string (prompt for GroundingDINO)
- `ai_threshold`: number (0-1)

---

<a id="run-insight-et-lineage-git--dvc--mlflow"></a>
## Run Insight and lineage (Git / DVC / MLflow)

A "Run Insight" is the document (JSON + Markdown + plots) generated for ONE graph run. The
"Lineage" is the graph that links ALL runs of ALL graphs together (common dataset, forks). Both
rely on the same raw lineage written by `graph_runner`/`graph_store` during the run
(`git_commit`, `dataset`, `dvc_version`, `model_path`, `map50`, MLflow tags), but each treats it
differently: the Insight COLLECTS and FREEZES the state of one run, the Lineage READS that
already-frozen state to build relationships between runs.

### `core/insights.py` - generating an Insight

A `WORKSPACE/insights/{graph_id}/{run_id}/` folder is (re)generated automatically at the end of
a run (SSE `done` event) and progressively during the run (after each successful `train`,
`exportyolo`, `commit`, `hpo`, `export`, `subset` step - see `event_generator` in `graphs.py`),
or on demand via `POST /api/insights/{graph_id}/generate`.

- `collect(graph_id, run_id)` aggregates EVERYTHING the sub-apps know about this run: node
  status/timings and the raw step log (from `graph_store`/`experiment_store`), epoch-by-epoch
  training history (Training_App, `GET .../metrics-history`), Optuna studies whose `run_id`
  (user_attr) matches this run exactly (no fallback by date or graph_id), MLflow runs tagged
  `orch_run_id == run_id`, DVC commits whose `run_id` trailer matches. Everything is filtered on
  the run's exact identity: a fork never accidentally picks up its parent's curves or artifacts.
- `_build_lineage(...)` assembles the `lineage` object (git_commit, dataset, dvc_version resolved
  by scanning DVC files, model_path, map50 - first looks at the lineage written during the run,
  then MLflow metrics, then Training_App status) and a `reproducibility` checklist of 7 honest
  checks (Git code committed, graph snapshot, DVC-versioned dataset, linked MLflow run, model
  file present on disk, analysis artifacts present, DVC remote configured). `reproducible` is
  true ONLY if all 7 are true - no "green" by default.
- `generate()` also regenerates 4 matplotlib plots (`training_curves.png`, `gains.png` - final
  mAP50 per training with delta vs. the first run, `optuna_history.png`, `timeline.png` - a Gantt
  chart of the nodes), fetches the training engine's analysis images (plots declared by the run's
  engine: a summary if it produces one, confusion matrix, PR/F1 curves, label distribution,
  validation), then writes 3 files: `insights.json` (full raw bundle), `insights.md` (human-
  readable log, no hidden data), `metrics.json` (a STABLE, sorted subset - no timestamp - meant
  to be versioned by DVC without "churning" on every regeneration). Finishes with
  `run_manifest.finalize(...)`.

### `api/insights.py`

| Method | Route | Description |
|---------|-------|--------------|
| GET | `/api/insights` | Lists all generated insights (across all graphs/runs) |
| GET | `/api/insights/{graph_id}/{run_id}` | Full insight content (404 if not generated) |
| GET | `/api/insights/{graph_id}/{run_id}/plot/{name}` | Serves a PNG plot (path-traversal guard) |
| DELETE | `/api/insights/{graph_id}/{run_id}` | Deletes the insight folder (a display cache - the underlying lineage/DVC/MLflow stay intact, regenerable) |
| POST | `/api/insights/{graph_id}/generate` | (Re)generates the insight for the given run, or the graph's last known run if `run_id` is omitted |

### `core/run_manifest.py` - a run's canonical index

`WORKSPACE/runs/{run_id}/manifest.json` is a run's logical index: the files stay in the sub-apps'
workspaces, but every output produced (`outputs`) is explicitly tied to its originating `run_id`
(`start()` when the run opens, `finalize()` at the end). Atomic write (temp file + `os.replace`)
so a partial JSON manifest is never exposed. An output of the current run never implicitly
becomes an output of the parent (`source_run_id` explicit), including for inputs inherited from
a fork (`inputs: [{kind: "fork_base", ...}]`).

### `api/lineage.py` - cross-experiment graph

`GET /api/lineage?include_failed=bool` builds, across ALL graphs in the workspace, a
`{nodes, edges}` graph: every published run (status done/success/completed by default - the
"published" view; `include_failed=true` also includes failed/interrupted/partial runs - the
"audit" view, with `excluded_runs` listing what the published view hides). Read-only and
defensive: a run with no lineage at all still shows up (marked "not versioned"), never an
exception that would break the whole page over one incomplete run.

Node types: `source_dataset` (common source dataset, deduped by path+name) | `dataset`
(the subset actually extracted by THIS run, deduped by source+subset+query+DVC version - never by
the parent's commit, so an uncommitted fork keeps its own identity) | `run` | `model` (deduped by
path) | `stage` (an individual MLflow run, tied to the pipeline run that produced it) |
`artifact` (produced annotations/metrics/graph/optuna, with their `versioned` state computed from
the DVC paths actually tracked).

Edge types: `source` (source dataset -> run), `subset` (run -> extracted subset), `model`
(run -> model), `mlflow` (run -> MLflow stage), `artifact` (run -> artifact), `fork` (parent run ->
child run via `graph["forked_from"]`; if a fork has no run yet, a "not launched" `draft` node
still appears to represent the branch).

No URL is resolved server-side - deep links to dvc-app/mlflow-app are built client-side via
`/api/graphs/meta/app-urls`. Every `run`-type node carries a `comparison` object
(`_comparison_snapshot`): a normalized, stable view (source dataset, subset, YOLO annotations,
`.ver` annotations, HPO - `best_params` only if produced by THIS run, never inherited from the
parent -, training params, model, MLflow stages with their metrics, artifacts, mAP50) used by the
frontend to diff one run against another section by section.

### `api/graphs.py` - related actions (fork / MLOps promotion)

Two actions on the `graphs` router complete this system (not in the lineage/insights files
themselves, but inseparable from the Insight -> Lineage flow):
- `POST /api/graphs/{graph_id}/fork-run`: duplicates the graph (same dataset/annotation nodes,
  hence the same subset + same annotations) and records the source run's provenance in
  `forked_from` (git_commit, dataset, dvc_version, map50, a snapshot of the parent's tunable
  parameters). Triggers NO DVC pull/re-download - only serves traceability and the divergence
  screen. The user adjusts their parameters and relaunches themselves.
- `POST /api/graphs/{graph_id}/track-mlops`: promotes an "experimental" graph to "mlops" by
  injecting, if missing, the FREE `mlflow` + `dvc` nodes (a coupled pair). Idempotent, launches
  and versions nothing - just the structure so the user can then commit via the DVC node.
  The derived `mlops` type (`graph_store.mlops_status`) drives the MLOps/Experimental badge shown
  by `InsightsPage`.

### Frontend - `InsightsPage.tsx`

A run's detail page: an identity card (`LineageHeader`) with an MLOps/Experimental badge, fork
provenance, 6 clickable fields (Git, Dataset, DVC version, MLflow Run, Model, mAP50 - each either
a real link or "not linked", never a fake value), direct actions (Open MLflow Run, Inspect DVC,
Inspect Dataset, View Artifacts, Open Sandgraph, Open Lineage, Track in MLOps, Fork this run), a
"Reproduce Run" panel (a 4-step recipe with no command line, active only if
`reproducibility.reproducible`) and the detail of the reproducibility checklist. Below: a preview
of the source Sandgraph, interactive Plotly charts (mAP/losses/precision-recall per epoch, Optuna
history), collapsible training-engine analysis images, a raw step log, full colored logs (the
same blocks as the Sandgraph), and a standalone "HTML report" export (Plotly inline, viewable
offline with no server).

### Frontend - `LineageGraphPage.tsx`

A graph view (ReactFlow) of the full lineage tree, grouped by experiment (common source dataset
at the top, a dashed box per run with its productions). Each run is also represented by a
draggable "token" (`RunToken`): dropping it into the `ComparisonPanel` (or into the List view)
compares two runs section by section via their `comparison` snapshot, highlighting only the
sections that differ (added/removed/modified) with field-by-field detail. Graph/List toggle,
search by name/dataset/subset, compacting a run's productions, a per-node detail panel with
direct DVC/MLflow links and a "Fork this run" shortcut identical to the one on InsightsPage.

---

<a id="plans-dexperiences"></a>
## Experiment Plans

An "Experiment Plan" is an ORDERED suite of steps; each step duplicates a base graph already
built in the Sandgraph and applies named overrides to it, then launches it. It's the automation
of "duplicate + change 2-3 parameters + relaunch" repeated several times (e.g. sweeping several
epochs/basic_lr_per_img values starting from the same FREE-annotation-reuse -> training graph).

### `core/plan_store.py`

Simple JSON persistence in `WORKSPACE/plans/plans.json`. A plan = `{plan_id, name, created_at,
updated_at, steps: [{id, label, base_graph_id, overrides}], last_run}`. `last_run` is written by
`plan_runner` during execution (`status`, `started_at`, `finished_at`, `current`/`total`,
`results: [...]`) and serves as the progress state polled by the frontend.

### `core/plan_runner.py`

The execution engine does NOT directly reuse the internal Python functions: it replays, as a
background task (`asyncio.create_task`), the same sequence a user would do by hand, but BY
CALLING THE APP'S OWN INTERNAL HTTP ENDPOINTS (`http://127.0.0.1:{BACKEND_PORT}`) - so all the
existing logic (validation, auto-launch, SSE) is reused as-is, with no duplicated code. For each
step:
1. `POST /api/graphs/{base_graph_id}/duplicate`
2. `_apply_overrides(graph, overrides)` - applies the named overrides onto standard nodes
   identified by id convention (`v1` = explorer, `a1` = annotation, `t1` = training); silent if
   a node doesn't exist (a "reuse" graph, for instance, only has `a1` + `t1`)
3. `PUT /api/graphs/{id}` to save the overrides
4. `POST /api/graphs/{id}/run` then polling every 3s (up to 40 min): as soon as the graph turns
   `waiting`, `POST /api/graphs/{id}/resume` automatically - a plan is a scheduled execution, it
   must never stay stuck on a human gate
5. If the run finishes `done`: `POST /api/insights/{id}/generate` then re-reads the insight to
   retrieve `dvc_version`/`git_commit`/`map50` for the step's result

Important: the DVC commit deliberately stays MANUAL. A plan never creates a commit itself - the
exact outputs of each run remain offered in the DVC hub, where the user chooses what to version.
The result of each step is then browsable in the Lineage tab.

### `api/plans.py`

| Method | Route | Description |
|---------|-------|--------------|
| GET | `/api/plans` | List of plans |
| POST | `/api/plans` | Creates a plan (name + steps) |
| GET/PUT/DELETE | `/api/plans/{plan_id}` | Read / edit / delete |
| POST | `/api/plans/{plan_id}/run` | Starts execution as a background task (`{ok: false}` if already running - not an HTTP error) |
| GET | `/api/plans/{plan_id}/status` | Current execution state (`last_run`, or `{status: "idle"}`) |

### Frontend - `PlansPage.tsx`

Plan editor: name + list of steps, each step picks a base graph and override fields
(subset, annotation project, number of images, threshold, epochs, basic_lr_per_img, batch, run
label - mapped directly to the keys read by `_apply_overrides`). A Run button, then status
polling every 2.5s during execution, with, per step, the status and the mAP50/dvc/git badges
pulled from the generated insight.

---

## Backend - file-by-file detail

```
backend/
  config.py
  main.py
  api/
    graphs.py
    pipelines.py
    launcher_api.py
    experiments.py
    activity.py
    health.py
    settings.py
    insights.py            Run Insight: list, detail, plots, generation
    lineage.py              cross-experiment graph (fork tree)
    plans.py                Experiment Plans: CRUD + launch
  core/
    graph_runner.py        brain of the system
    pipeline_runner.py     async executor
    graph_store.py
    app_launcher.py
    proxy_client.py
    pipeline_store.py
    experiment_store.py
    activity_store.py
    insights.py             collection + generation of a Run Insight
    run_manifest.py         canonical index of a run's outputs
    plan_store.py            Experiment Plans persistence
    plan_runner.py           a plan's execution engine
```

### `backend/config.py`
Centralized configuration: ports, sub-app URLs, workspace.
- `WORKSPACE` (Path) - read from `ORCHESTRATOR_WORKSPACE`
- `CURRENT_USER` - from `ORCHESTRATOR_USER`
- `APP_URLS` / `APP_FRONTEND_URLS` - mutable dicts, see the Ports section above

### `backend/main.py`
FastAPI entry point - mounts the 10 routers (`health`, `pipelines`, `activity`, `settings`,
`experiments`, `graphs`, `launcher_api`, `insights`, `lineage`, `plans`), configures CORS
(localhost:3000 and 5173), exposes a few direct workspace endpoints (`/api/workspace/users`,
`/api/workspace/history`).

Important: router order matters - `graphs` comes first because its `/meta/*` routes must be
resolved before the parameterized `/{id}` routes.

### `backend/api/graphs.py`
The sandgraph's main router: CRUD + execution + SSE streaming + workspace scan.
- `GET/POST /api/graphs` - list / create
- `GET/PUT/DELETE /api/graphs/{id}` - read / update / delete
- `POST /api/graphs/{id}/duplicate`
- `POST /api/graphs/{id}/run` -> calls `graph_runner.run_graph()`
- `GET /api/graphs/{id}/run/{run_id}/stream` -> SSE, replays every event from cursor=0
- `POST /api/graphs/{id}/resume` - resumes after a human gate
- `POST /api/graphs/{id}/reset`
- `GET /api/graphs/meta/app-urls`
- `GET /api/graphs/meta/workspace-outputs` -> filesystem scan, returns existing subsets + exports without the apps running

See the SSE architecture section above for the detail of `event_generator()`.

### `backend/api/launcher_api.py`
Router for manually launching/stopping sub-apps from the UI (Apps page).
- `GET /api/apps` - lists all sessions with status (running/stopped/error)
- `POST /api/apps/launch` - launches an app with workspace + user + conda_env
- `POST /api/apps/{id}/stop`
- `POST /api/apps/launch-all`, `POST /api/apps/stop-all`
- Live per-app health check

Important: uses `app_launcher.launch_app()` from core, the same function used by
graph_runner's auto-launch. The workspace is always passed as a parameter, never hardcoded.

### `backend/api/insights.py`, `lineage.py`, `plans.py`, `backend/core/insights.py`,
`run_manifest.py`, `plan_store.py`, `plan_runner.py`
Detailed in the [Run Insight and lineage](#run-insight-et-lineage-git--dvc--mlflow) and
[Experiment Plans](#plans-dexperiences) sections above - not repeated here to avoid duplication.

### `backend/api/pipelines.py`, `experiments.py`, `activity.py`, `health.py`, `settings.py`
Secondary routers, less critical to the main flow.
- **pipelines.py**: JSON pipelines CRUD + POST run with SSE (legacy system, kept for compatibility)
- **experiments.py**: list/get/resume of experiments (full Pydantic schema with metrics)
- **activity.py**: `GET /api/activity?limit=50` - returns `activity.json`
- **health.py**: `GET /api/health` - concurrent ping of the sub-apps, returns latencies
- **settings.py**: `GET/PUT /api/settings` - persisted user preferences

### `backend/core/graph_runner.py` (brain)
Converts the visual ReactFlow graph into an executable `PipelineDef` + handles auto-launch.
- `_is_free_node(node, edges) -> bool`: see the FREE/LOCKED section
- `_steps_for_node(node, deps, ctx, parent_nodes) -> list[dict]`: translates each node type into
  a list of pipeline steps, see "Node types and their pipeline steps" section
- `graph_to_pipeline(graph) -> (PipelineDef, step_node_map)`: topological sort (Kahn) -> for
  each LOCKED node -> `_steps_for_node` -> builds the `step_id -> node_id` map used by
  the frontend to color the nodes during execution
- `_needed_app_keys(graph) -> set[str]`: lists the apps needed, skips FREE nodes
- `_auto_launch_and_wait(app_key, timeout) -> bool`: launches in the background via
  `asyncio.create_task()`, waits up to `timeout` seconds for `/health` to respond. For explorer:
  always computes `annotation_imports` from the workspace structure (even if Annotation
  hasn't started yet)

Important: `annotation_imports_path` in the pipeline context is computed directly as
`WORKSPACE / f"annotation_{CURRENT_USER}" / "imports"`, never via HTTP.

### `backend/core/pipeline_runner.py` (executor)
Async execution of the steps DAG + human gate handling + SSE events.
- `RunState`: an in-memory (not persisted) class - `status`, `events: list[dict]`,
  `step_states: dict`, `waiting_step`. Stored in `_active_runs: dict[str, RunState]`
- `_execute(pipeline, state)`: async loop, finds the steps whose dependencies are all
  "success" -> `asyncio.gather()` -> runs them in parallel. Exits if `state.status == "waiting"`
- `_run_step(step, state)`: calls `_wait_for_app(step.app, max_wait=60s)` first; if
  `type == "human_gate"` -> sets `state.status = "waiting"`, emits the waiting event, returns; if
  `type == "task"` -> `proxy_client.request()` to the target app
- `stream_events(run_id)`: async generator that replays `state.events` from index 0
- `resume_run(pipeline_id, run_id)`: marks the waiting step as "success", emits the
  success event, calls `_execute()` again

Important: `_active_runs` is in-memory. If the server restarts, see "Server restart fix"
in the SSE section above.

### `backend/core/graph_store.py`
Sandgraph persistence in `graphs/experiments.json`.
- CRUD: `create_graph`, `get_graph`, `update_graph`, `delete_graph`, `list_graphs`
- `start_run(graph_id, run_id, pipeline_id, step_node_map)` - initializes the execution state
- `update_node_exec(graph_id, node_id, status, result)` - updated by `graphs.py` on each SSE event
- Graph-level status logic: idle/running/waiting/done/failed computed from the node statuses

Important: `update_node_exec` never downgrades a node from "done" back to "waiting" (fix from
the May 2026 loop bug, see the SSE section).

### `backend/core/app_launcher.py`
Spawns and monitors sub-apps as independent subprocesses.
- `AppSession` dataclass: `app_id`, `pid`, `backend_url`, `frontend_url`, `workspace`, `status`
- `launch_app(app_id, base_workspace, user, annotation_imports=None)`: builds the env vars
  (`EXPLORER_WORKSPACE`, `ANNOTATION_WORKSPACE`, etc.), spawns the process via `subprocess.Popen`
- `get_session(app_id)` -> returns the active session or None
- `stop_app(app_id)`: kills the process + cleanup

Important: passing `annotation_imports` to Dataset_Explorer_App via the `ANNOTATION_APP_IMPORTS`
env var is always computed from the workspace structure, never via HTTP to Annotation.

### `backend/core/proxy_client.py`
Async HTTP client to the sub-apps.
- `ping(app_key) -> float | None` - latency in ms, or None if down
- `ping_all() -> dict` - concurrent ping of every app
- `request(app_key, method, endpoint, json_body)` - generic proxy

Called for each pipeline step.

### `backend/core/pipeline_store.py`
CRUD for `PipelineDef` persisted as JSON in `pipelines/`. Pydantic schemas:
`PipelineStep` (id, label, app, endpoint, method, params, depends_on, type, hint), `PipelineDef`
(id, name, steps).

### `backend/core/experiment_store.py`, `activity_store.py`
- **experiment_store**: a full Pydantic schema for experiments (run_id, steps, artifacts,
  metrics). Used less than graph_store in the main flow.
- **activity_store**: append-only log `activity.json` (max 200 entries).

---

## Frontend - file-by-file detail

```
frontend/src/
  main.tsx
  App.tsx
  index.css
  api/
    client.ts              all typed API calls
  types/
    api.ts                 TS types mirroring the Pydantic schemas
  utils/
    time.ts
  hooks/
    useActivity.ts
    useHealth.ts
    usePipelines.ts
  nodes/                     ReactFlow components
    index.ts
    shared.ts
    ports.ts                 typed ports schema (NODE_PORTS) + connection validation
    routing.ts                orthogonal routing engine (pure, no React/xyflow)
    AppNode.tsx            generic explorer/annotation/dvc/mlflow/optuna node
    DatasetNode.tsx
    ModelNode.tsx            entry node: hand-provided engine weights
    NodePorts.tsx            visual rendering of a node's ports (inputs/outputs)
    OrthogonalEdge.tsx        single edge type, routed via routing.ts
  components/
    NodeConfigPanel.tsx    right-side config panel for the selected node
    UserBadge.tsx
  pages/
    SandgraphPage.tsx      main editor
    ExperimentsPage.tsx
    ActivityPage.tsx
    AppsPage.tsx
    LibraryPage.tsx
    PipelinePage.tsx
    DashboardPage.tsx
    AboutPage.tsx
    MLOpsPage.tsx            parent page for the MLOps sub-tabs (nested routing)
    InsightsPage.tsx          a Run Insight's detail
    PlansPage.tsx             Experiment Plans editor + tracking
    LineageGraphPage.tsx      cross-experiment graph + run comparison
    GuidePage.tsx             Git/DVC/MLflow reference doc (mental model)
```

### `src/main.tsx` + `src/App.tsx`
- **main.tsx**: mounts React, `QueryClientProvider` (React Query), `Toaster` (toast)
- **App.tsx**: global layout - sidebar nav (6 tabs, including `MLOps`), `<Routes>` to each page,
  `UserBadge` in the footer. The `/` route points to `SandgraphPage`. The `MLOps` tab
  (`MLOpsPage`) mounts nested routes (`/mlops/insights`, `/mlops/plans`, `/mlops/activity`,
  `/mlops/lineage`, `/mlops/guide`) under one sub-menu; the old short routes
  (`/insights`, `/activity`, `/lineage`, `/guide`) redirect to their `/mlops/*` equivalent.

### `src/api/client.ts`
API access layer: every fetch function is centralized here.
- `axios` instance with `baseURL: ''` (Vite proxy in dev, relative in prod)
- `BACKEND_BASE` - absolute URL for SSE (bypasses the Vite proxy, which would buffer the stream)
- `graphsAPI` - the most important one: `list`, `create`, `get`, `update`, `delete`, `duplicate`,
  `reset`, `run`, `resume`, `getAppUrls`, `getWorkspaceOutputs`
- `launcherAPI` - launch/stop apps
- `pipelinesAPI`, `activityAPI`, `settingsAPI`, `experimentsAPI` - secondary
- `streamRun()` - direct SSE connection via `fetch()` (not axios), reading the `ReadableStream`

Important: `getWorkspaceOutputs()` scans the workspace server-side and returns
`{subsets, exports}` without requiring the apps to be running.

### `src/types/api.ts`
Type contract between frontend and backend.
- `SandGraph` - graph_id, name, nodes, edges, status, execution (node_id -> NodeExecState map), run_history
- `RunEvent` - step_id, status, type (step_update | done | waiting | error), hint, error
- `GraphRunResponse` - run_id, step_node_map
- `AppLaunchStatus` - app_id, status, backend_url, frontend_url, pid

### `src/nodes/shared.ts`
Constants shared across all node components.
```typescript
type NodeExecStatus = 'idle' | 'running' | 'waiting' | 'done' | 'failed'
STATUS_DOT  // Tailwind classes per status (dot color)
STATUS_RING // ring classes per status (node's colored border)
```

### `src/nodes/index.ts`
ReactFlow registry of node types:
```typescript
export const nodeTypes = {
  dataset_source: DatasetNode,
  model:          ModelNode,
  explorer:           AppNode,
  annotation:     AppNode,
  dvc:            AppNode,
  mlflow:         AppNode,
  optuna:         AppNode,
  training:       AppNode,
  inference:      AppNode,
}
```

### `src/nodes/DatasetNode.tsx`
Simple dataset source node, no FREE/LOCKED logic. Shows `dataset_name`, `dataset_path`,
`n_clusters`, execution status. Expandable section with the parameters. Source handle
only (no target, it has no input).

### `src/nodes/ModelNode.tsx`
Entry node, same family as `DatasetNode` (no input, no FREE/LOCKED logic): hand-provided
weights (`engine`, `model_size`, `model_path`). Used to fill a `training`'s `model` input
(starting weights for fine-tuning) or an `inference`'s (model to test) without routing the
graph through an upstream `training`. Shows the engine (catalog label), the file name, the
size, and its single output via `<NodePorts nodeType="model" inputHandles={[]} .../>`.

### `src/nodes/ports.ts`, `NodePorts.tsx`, `OrthogonalEdge.tsx`, `routing.ts`
See the [Typed node ports](#ports-types-des-nodes-portsts) section above for the detail of the
`NODE_PORTS` schema, connection validation, visual port rendering and edge routing - not
repeated here.

### `src/nodes/AppNode.tsx` (nodes)
Generic component for app-node types that share the same visual template (explorer,
annotation, dvc, mlflow, optuna, training, inference). All FREE/LOCKED visual logic lives here.
- `AppNodeData` interface: every possible field - `node_type`, `label`, `exec_status`,
  `has_input` (computed, never persisted), `frontend_url`, `waiting_hint`, explorer/annotation/dvc-
  specific fields
- `APP_META`: `AppNodeType -> {icon, color, bg, title}` map, determines each type's color and icon
- `dispatchSelectOutput(nodeId, nodeType, name)`: emits
  `window.CustomEvent('orch:select-output', {nodeId, nodeType, name})` when the user
  clicks an existing output in FREE mode; `SandgraphPage` listens for this event
- `AppNode({ id, data, selected })`: main component, computes
  `isFreeMode = (type === 'explorer' || 'annotation') && data.has_input === false`. FREE badge
  (green, Unlock) or LOCKED (amber, Lock) in the header. "Action required" banner if
  `status === 'waiting'`
- `VisuNodeSummary`: FREE mode -> lists clickable subsets (violet hover, click ->
  `dispatchSelectOutput`); LOCKED mode -> shows the query + an informative non-clickable list. The
  subset matching `data.subset_name` is always highlighted in violet
- `AnnotationNodeSummary`: FREE mode -> lists clickable exports (rose hover); LOCKED mode
  -> shows the mode (auto/manual), classes, list of historical exports. The configured export
  (`{project_name}-yolo`) is highlighted in rose
- `NodeConfig` (expanded panel): shows the detailed parameters depending on the type; in FREE
  mode hides unneeded fields (query, top_k, split%, label_classes)

Important: `has_input` is passed inside `data` by `SandgraphPage`, not as a separate prop. Never
persisted (stripped on save/run).

### `src/components/NodeConfigPanel.tsx`
Right-side panel: editing the selected node's parameters.
- `NodeConfigPanel({ node, appUrls, onUpdate, onClose, onDelete })`
- Switches on `node.data.node_type` -> shows the corresponding sub-form
- `DatasetConfig`: dataset_name, dataset_path, n_clusters
- `VisuConfig`: dataset_name, subset_name, query, top_k
- `AnnotationConfig`: subset_name, project_name, annotation_mode, full_auto, ai_model, ai_text,
  ai_threshold, label_classes (add/remove/color), split_train/val
- `DVCConfig`: commit_message
- `ManualConfig`: info message for MLflow/Optuna (manual step)
- Each form calls `onUpdate(nodeId, patch)` -> `SandgraphPage` updates the state + `setDirty`

Important: changes are not auto-saved, the user has to click "Save" or Ctrl+S.

### `src/components/UserBadge.tsx`
Footer with user info, active workspace, and settings access. Shows: user name, workspace path,
apps status icon, quick settings access.

### `src/pages/SandgraphPage.tsx` (main page)
Visual graph editor: ReactFlow canvas + toolbar + SSE client + state management.
- `TOOLBOX_NODES`: defines the 6 draggable types with their `defaults` (initial values on
  creation). Update here if the default parameters change
- Main state: `nodes`, `edges` (ReactFlow state), `activeId` (open graph, persisted to
  localStorage), `stepNodeMap` (`{step_id: node_id}` received at launch, colors nodes during execution)
- Undo/Redo: `historyRef` + `futureRef` (`{nodes, edges}` snapshots), `nodesRef`/`edgesRef`
  (anti-stale-closure mirrors), `pushHistory()` called before every mutation
- `refreshWorkspaceOutputs()`: calls `getWorkspaceOutputs()` -> injects `available_subsets`
  into explorer nodes and `available_exports` into annotation nodes, also injects `has_input`
  via `edgesRef.current`. Called on load, every 30s, and after each successful
  `__export`/`__exportyolo` step
- `useEffect([edges])`: recomputes `has_input` on every topology change, flips a
  FREE node -> LOCKED as soon as it's connected
- `useEffect(window 'orch:select-output')`: listens for clicks on existing outputs from
  `AppNode`, updates `subset_name`/`project_name` + `setDirty`
- `onConnect`: adds the edge + auto-propagates parameters (see the connections section)
- `isValidConnection`: filters via `inputAccepts`/`wouldViolateExclusivity` (`nodes/ports.ts`)
- `saveMut`: strips runtime fields before saving (`exec_status`, `frontend_url`,
  `waiting_hint`, `has_input`)
- `runMut`: save + POST `/run` -> receives `{run_id, step_node_map}` -> opens SSE via `_openSSE()`
- `_openSSE(graphId, rid, snm)`: SSE connection via `fetch()` (not axios), reads the
  `ReadableStream` line by line, exits on `type === "done"` or `type === "waiting"`, calls
  `_handleSSEEvent` for each event
- `_handleSSEEvent`: updates the matching node's status (via `stepNodeMap`), triggers
  `refreshWorkspaceOutputs()` after successful `__export`/`__exportyolo`, appends a log entry
- `resumeMut`: POST `/resume` -> receives a new `run_id` -> reconnects SSE
- `enrich(node)`: on a graph's first load, injects `exec_status`, `frontend_url`,
  `waiting_hint`, `has_input` from the edges

Important: ReactFlow needs to be wrapped in `ReactFlowProvider` -> `SandgraphPage` exports
a wrapper that renders `<SandgraphInner />` inside the provider.

### `src/pages/ExperimentsPage.tsx`
Gallery of experiments + predefined templates.
- `SANDGRAPH_TEMPLATES`: 8 templates - 4 classic ones (CV Training Loop, Quick Annotation,
  Dataset Exploration, Re-train + HPO) + 4 FREE/LOCKED test scenarios (SC1 to SC4, see
  [test-scenarios.md](test-scenarios.md)). The SC1/SC2 templates have explorer/annotation nodes
  with no incoming edge -> will be in FREE mode on load
- `GraphCard`: status, progress (nodes done / total), last modified, actions
  (open / run / reset / duplicate / delete)
- `TemplateCard`: dashed card for each template, "Use this template" button

Important: on clicking "Use this template", `createFromTemplateMut` creates the graph via the
API then navigates to `/` (SandgraphPage) with `active_graph_id` set in localStorage.

### `src/pages/AppsPage.tsx`
Sub-app management dashboard: live status (running/stopped/error), latency, frontend URL,
Launch/Stop buttons. Health polling every 5s. Useful for debugging and for manually launching
the apps before using FREE mode.

### `src/pages/ActivityPage.tsx`
Pipeline execution history. Lists recent runs with status, duration, steps executed,
timestamp. Append-only, no actions.

### `src/pages/LibraryPage.tsx` + `PipelinePage.tsx`
"Legacy" pipeline system, predating the sandgraph system. Lets you create pipelines
manually step by step (no visual editor). Still functional but secondary, the
main flow goes through sandgraphs.

### `src/pages/DashboardPage.tsx`
Overview: workspace state, active apps, latest activity, shortcuts. Home page
if no graph is active.

### `src/pages/MLOpsPage.tsx`, `InsightsPage.tsx`, `PlansPage.tsx`, `LineageGraphPage.tsx`, `GuidePage.tsx`
The "MLOps" group of pages (monitoring + traceability), see the
[Run Insight and lineage](#run-insight-et-lineage-git--dvc--mlflow) and
[Experiment Plans](#plans-dexperiences) sections above for the detail of each. `MLOpsPage.tsx`
only renders the sub-tab bar + `<Outlet/>` (nested routing); `GuidePage.tsx` is the static
reference doc for the Git/DVC/MLflow mental model (which the dvc-app/mlflow-app apps don't
repeat, they link back to it and stay focused on their own usage).

### `src/hooks/`
Three secondary React Query hooks:
- `useActivity(limit)` -> polls `GET /api/activity`
- `useHealth()` -> polls `GET /api/health` (app latency), 10s cache
- `usePipelines()` -> lists legacy pipelines

### `src/utils/time.ts`
`formatDistanceToNow(isoDate)` -> "3 minutes ago", `formatDuration(ms)` -> "2m 34s".

### `vite.config.ts`
Dev server on port 3000. Proxies `/api/*` -> `http://localhost:{VITE_BACKEND_PORT}` (default 8060).
Important: SSE bypasses this proxy (direct `BACKEND_BASE` connection) to avoid Vite's buffering.

---

## `launcher.py` (root)

Main launch script, the single entry point to start everything correctly.
- Parses args: `--workspace`, `--user`, `--app orchestrator`, `--conda-env`
- Creates the workspace structure (`explorer_{user}/`, `annotation_{user}/`, etc.) if it doesn't exist
- Allocates ports dynamically (lock file to avoid collisions)
- Sets the backend's env vars: `ORCHESTRATOR_WORKSPACE`, `ORCHESTRATOR_USER`
- Launches `uvicorn` (backend 8060) + `npm run dev` (frontend 3000)
- SIGINT/SIGTERM signal handler -> cleanly kills both processes

Important: never launch `uvicorn` manually without these env vars, the backend would write to
the wrong directories.

---

## `data/` (data directory)

```
data/
  graphs/experiments.json    all sandgraphs (nodes, edges, exec state)
  pipelines/*.json           legacy pipelines + graph__*.json generated on run
  activity.json              execution log (max 200)
  experiments.json           experiments with metrics
  launcher_state.json        sub-app sessions state
```

Everything is human-readable JSON. If you hit a bug, read `graphs/experiments.json` to inspect
a graph's state and `activity.json` for the run history.
