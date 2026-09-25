---
app: orchestrator
doc_type: architecture
audience: dev
lang: en
title: Architecture
order: 60
tags: [graph runner, pipeline runner, sse, ports, insights, lineage, plans, react flow]
sources: [Orchestrator_App/backend/config.py, Orchestrator_App/backend/main.py, Orchestrator_App/backend/api/graphs.py, Orchestrator_App/backend/core/graph_runner.py, Orchestrator_App/backend/core/pipeline_runner.py, Orchestrator_App/backend/core/graph_store.py, Orchestrator_App/backend/core/app_launcher.py, Orchestrator_App/backend/core/proxy_client.py, Orchestrator_App/backend/core/insights.py, Orchestrator_App/backend/core/run_manifest.py, Orchestrator_App/backend/api/lineage.py, Orchestrator_App/backend/core/plan_store.py, Orchestrator_App/backend/core/plan_runner.py, Orchestrator_App/frontend/src/pages/SandgraphPage.tsx, Orchestrator_App/frontend/src/nodes/ports.ts, Orchestrator_App/frontend/src/api/client.ts]
---

# Architecture

## Components overview of Orchestrator App

Orchestrator App is a two-tier application: a FastAPI backend that converts a visual graph into an executable pipeline and drives it, and a React frontend built around `@xyflow/react` (the Sandgraph editor).

```text
Frontend (React 18 + TypeScript + Vite + @xyflow/react + TanStack Query)
  |-- HTTP /api (axios, typed client)  --+
  |-- SSE /api/graphs/{id}/run/{run}/stream (raw fetch, bypasses axios) --+--> Vite proxy --> FastAPI backend
  `-- deep links to sub-app frontends (Annotation, DVC, MLflow, ...)

Backend (FastAPI, single uvicorn worker, no persistence layer beyond JSON files)
  |-- api/: one router per domain (graphs, launcher_api, insights, lineage, plans, engines, ...)
  |-- core/: graph_runner (graph -> pipeline), pipeline_runner (async DAG executor),
  |          graph_store / pipeline_store / plan_store / experiment_store / activity_store (JSON persistence),
  |          app_launcher (spawns sub-app processes), proxy_client (HTTP calls to sub-apps),
  |          insights.py / run_manifest.py (Run Insight generation and canonical run index)
  `-- workspace on disk: graphs/experiments.json, pipelines/*.json, insights/, runs/, plans/, activity.json
```

The backend never touches a sub-application's own database; it only calls its HTTP API (`proxy_client`) and scans two fixed workspace folders (`explorer_{user}/subsets/`, `annotation_{user}/exports/`) to discover existing outputs for FREE mode. Run state that must survive a resume (the DAG execution engine) lives only in backend memory (`_active_runs`), never on disk; everything else (graphs, pipelines, plans, activity, insights) is plain JSON written to the workspace.

## Backend application startup

`backend/main.py` builds the FastAPI app and mounts eleven routers in a specific order: `health`, `pipelines`, `activity`, `settings`, `experiments`, `graphs`, `launcher_api`, `insights`, `lineage`, `plans`, `engines`. The order matters for `graphs`: its `/meta/*` routes must resolve before the parameterized `/{graph_id}` route.

The lifespan handler initializes the debug HTML logger (`WORKSPACE/debug.html`), then calls `app_launcher.repatch_app_urls()`, which reads `launcher_state.json` and re-injects the real URL of every sub-app session whose port is actually listening back into `APP_URLS` / `APP_FRONTEND_URLS`. This is necessary after an uvicorn reload: without it, `APP_URLS` would revert to its default ports and the proxy would lose track of every already-launched sub-app.

CORS, access-log filtering (polling endpoints such as `GET /api/apps` and `GET /api/graphs` are dropped from the uvicorn access log to keep it readable over a long session) and the two direct workspace endpoints (`/api/workspace/users`, `/api/workspace/history`, `/api/workspace/open`) are also defined directly in `main.py`.

## Node types and their pipeline steps

Step ids follow the `{node_id}__{action}` convention (double underscore); `graph_runner._steps_for_node()` is the single function that translates one node into a list of steps.

### dataset_source

- `{id}__load` -> `POST Dataset_Explorer_App /api/orchestrator/load-dataset`. Live progress polls `GET /api/datasets`, matched by name until the real id is known.
- `{id}__embed` -> `POST Dataset_Explorer_App /api/orchestrator/start-embed`, referencing the `dataset_id` returned by `load` (never just the name, since two datasets can share a name).

### explorer (LOCKED only; a FREE node produces no step)

- Manual mode (`full_auto=false`): a `manual_create` human gate, then `{id}__export`.
- Automatic mode: `{id}__verifyembed` (human gate) -> `{id}__subset` (`POST /api/orchestrator/create-subset`) -> `{id}__validatesubset` (human gate) -> `{id}__export` (`POST /api/orchestrator/export-subset`).
- After a successful export, the frontend rescans the workspace and refreshes `available_subsets` on every FREE node.

### annotation (LOCKED only; a FREE node produces no step)

- `{id}__project` -> `POST Annotation_App /api/orchestrator/create-project`, with `import_path` set when a `dataset_source` ancestor provides a folder directly (zero-copy import).
- Automatic (`full_auto=true`): `{id}__auto_annotate`, optionally followed by a `review` human gate if `review_before_export` is checked.
- Manual: an `annotate` human gate.
- `{id}__exportyolo` (`POST /api/orchestrator/export-yolo`, `reuse_if_exists` set to the export chosen at the manual gate) and `{id}__exportver` (`POST /api/orchestrator/export-ver`) always both run after the gate, so both formats exist on disk regardless of which downstream port is actually connected.

### dvc / mlflow

Neither type generates a step: both are pure observers with no ports at all (`NODE_PORTS.dvc` and `.mlflow` are `{inputs: [], outputs: []}`). `dvc-app` and `mlflow-app` are still auto-launched whenever a node of that type exists in the graph (`_needed_app_keys`), independent of any edge.

### optuna

- Automatic: `{id}__hpo` (`POST optuna-app /api/orchestrator/hpo`), with `dataset_path` derived from the connected Annotation (directly, or by walking ancestors) and a `trace` block for MLflow tagging.
- Manual: a `hpo` human gate.

### training

- Manual: a `train` human gate.
- Automatic: `{id}__train` (`POST Training_App /api/orchestrator/train`). `dataset_path` comes from the connected Annotation's YOLO export; `model_weights` from a connected `model` node (fine-tuning); `optuna_best` from a connected Optuna node, as a `${STEP:...}` placeholder when the study runs automatically, or merged at build time when the study was manual. `hyperparams` merges the engine-specific dict on the node with a fixed set of legacy flat keys kept for old graphs (`basic_lr_per_img`, `mosaic_prob`, ...).

### inference

- FREE (no input): a human gate that simply opens Inference App.
- LOCKED, manual (`full_auto=false`): a human gate for an interactive SOT/MOT session.
- LOCKED, automatic, `task=detection`: `{id}__evaluate` (`kind=detection`), a standard `model.val()` on the chosen split of the connected Annotation's `data.yaml` (preferring the exact `data.yaml` a connected Training already unzipped, since the raw export is a `.zip`).
- LOCKED, automatic, `task=tracking` (default): `{id}__infer`, YOLO alone or with ByteTrack, against a sequence and an optional ground truth (`.ver` preferred, a YOLO split as fallback).

## Model lineage validation (engine and size)

`model`, `training`, `optuna` and `inference` nodes carry an `engine` field (empty means the default engine, `yolox`); their configuration panels are built from `GET /api/engines`, which proxies Training_App's `/api/capabilities` and falls back to the local plugin registry when Training_App is not running. No engine name is ever hardcoded in the frontend: with no plugin installed, only YOLOX exists and no engine selector is shown at all.

Before building the pipeline, `_model_lineage_spec()` walks every node reachable in a model lineage (a `training`, `optuna`, `inference` node plus its ancestors) and raises `GraphConfigError` (surfaced as HTTP 400, never a mid-run failure) if two nodes in the same lineage declare different engines, or different sizes once a size is set anywhere in the chain. A connected `model` node imposes its engine and size on the downstream `training`, since a checkpoint only reloads with the exact engine and size that produced it.

## Typed node ports

`frontend/src/nodes/ports.ts` (`NODE_PORTS`) replaced an older, per-node `target type -> accepted source types` dictionary with a per-port schema: each node declares typed `inputs` (left side) and `outputs` (right side), each with a `PortType` that fixes its color (`dataset`, `subset`, `yolo`, `ver`, `model`, `params`, `metrics`, `any`).

This lets `training` expose three independently typed inputs on the same node (`dataset` from `annotation` only, `model` from `model` only, `hpo` from `optuna` only), and lets `annotation` expose two typed outputs (`out_yolo`, `out_ver`) so `resolveHandles(srcType, tgtType)` picks the correct pair of handles automatically when an edge is drawn. `exclusiveWith` blocks two ports of the same node from ever being connected together (`inference`'s `sequence` and `dataset_yolo`); `requiresPeer` only produces a non-blocking warning (`inference`'s `gt` without `sequence`); `required` blocks save/run unless the node is in FREE mode. `compatibleNodeTypes(fromType, handleType, handleId)` feeds the drag-to-create popup shown when a wire is released over empty canvas.

Rendering: `NodePorts.tsx` draws the inputs/outputs strip at the bottom of a node card; a port only lights up when its own specific handle id has an edge, never just because the node has some incoming edge on a different port (a fixed bug: on `inference`, `dataset_yolo` and `gt` both accept an `annotation` source, so a naive per-type check would light up `gt` as soon as `dataset_yolo` alone was connected). `OrthogonalEdge.tsx` is the only edge type used on the canvas; its path is computed by the pure module `routing.ts` (no React or xyflow dependency), which detects nodes to route around and picks `direct`, `zbend` or `corridor` mode, stacking parallel corridors. A path recomputes automatically on every node move until a waypoint is added (double-click on the edge), which switches that edge to `routeMode: 'manual'`.

## SSE architecture

1. `run_graph()` creates a `RunState` in `pipeline_runner._active_runs` (in-memory, keyed by `run_id`).
2. The executor appends every event to `state.events`.
3. `stream_events(run_id)` is an async generator that replays the full event list from cursor 0 on every connection, so a reconnecting client never misses history.
4. `graphs.py`'s `event_generator()` consumes that stream, updates `graph_store` (node execution status, `next_label` preview, progressive Insight regeneration after a significant step) and forwards each event as SSE to the client. It exits the loop only on `type == "done"`; exiting early on a historical "waiting" event during replay after a resume was the root cause of an infinite-loop bug where the same gate kept reappearing (fixed, see the Troubleshooting page). It sets the graph's status to `"waiting"` only once the stream itself ends without a `"done"` event, never during replay, so historical events can never flip a finished graph back to waiting.

### Human gate flow

`_run_step()` sets `state.status = "waiting"` and emits a `waiting` event, then returns without touching later steps; `_execute()` sees `status == "waiting"` and returns without raising. The frontend shows the "Intervention requise" banner. Clicking **Terminé -> Continuer** calls `POST /api/graphs/{id}/resume`, which marks the waiting step `success`, rebuilds the pipeline from the graph's current state (picking up any edits made while the run was paused, including a freshly chosen `export_name`/`subset_name`), and calls `_execute()` again. The frontend reconnects the SSE stream, which replays every event from the start.

### Server restart fallback

`run_in_memory(run_id)` checks whether the run still exists in `_active_runs`. If a resume targets a run that is gone (the backend restarted while the graph was paused), `reset_graph_execution()` runs and the endpoint returns HTTP 410, telling the frontend to refresh instead of retrying silently.

### Poll-based resynchronization fallback

`_sync_graph_from_run()` runs on every `list_graphs()` and `get_graph()` call for a graph with an `active_run_id`. It is the safety net for when the SSE stream never successfully connects at all (a transient error on the very first attempt is not retried by the frontend's raw `fetch()`-based client, unlike a browser `EventSource`): it re-derives every node's execution status directly from `pipeline_runner`'s in-memory `RunState`, which remains the single source of truth regardless of whether any SSE client is currently attached. It also finalizes a run whose `RunState` has vanished (backend restarted mid-run) as `stopped` rather than leaving the graph `running` forever, and only commits a `waiting` graph status once the freshly re-read graph confirms it, to avoid the status flickering between `waiting` and `running` on successive polls.

## Auto-launch flow

1. `run_graph()` calls `_preflight_check()`, which trusts only sessions registered by this Orchestrator process (`app_launcher._sessions`); a session belonging to another process at the same default port is never reused, and a placeholder URL (`http://localhost:1`) is set for any app that needs launching, so a later readiness probe cannot falsely succeed against a foreign process.
2. Needed apps (`_needed_app_keys()`, which skips FREE nodes except `inference`, and always includes `mlflow-app`/`dvc-app` when their node type is present) are launched **sequentially**, in the order the pipeline's topological sort actually needs them (`_ordered_app_keys()`), as a background task. Launching several apps in parallel (each one a full uvicorn plus a Vite dev server, some loading GPU models) was found to saturate CPU and disk enough that none of them answered before the first pipeline step timed out.
3. Each step still calls `_wait_for_app(step.app, max_wait=240s)` before executing, independent of the background launch sequence, and emits a progress ping roughly every twelve seconds so a long cold start is visibly still working rather than silent.
4. `_auto_launch_and_wait()` treats a session whose port is listening but whose `/health` stays silent for about forty seconds as a frozen instance (a stale process from an earlier run, or a zombie uvicorn worker after a reload) and kills and respawns it, rather than polling a dead process for the full four-minute timeout.

## Backend, file by file

```
backend/
  config.py               WORKSPACE, CURRENT_USER (resolved, never a placeholder), APP_URLS, ports, CORS
  main.py                 FastAPI app, lifespan, router mounts, direct workspace endpoints
  api/
    graphs.py              sandgraph CRUD, run/resume/stop, SSE stream, fork-run, track-mlops,
                            workspace-outputs scan, artifacts hub, dvc-commit, annotation-exported webhook
    launcher_api.py         manual launch/stop of sub-apps (Applications page)
    insights.py             Run Insight: list, detail, plot files, on-demand generation
    lineage.py               cross-experiment lineage graph (fork tree, comparison snapshots)
    plans.py                 Experiment Plans: CRUD + launch + status
    engines.py               GET /api/engines, proxied from Training_App or the local plugin registry
    pipelines.py, experiments.py, activity.py, health.py, settings.py   legacy/secondary routers
  core/
    graph_runner.py          graph -> PipelineDef translation, model-lineage validation, auto-launch
    pipeline_runner.py       async DAG executor: depends_on scheduling, human_gate, SSE event emission,
                              ${STEP:id.field} and ${RUN_ID} runtime placeholder resolution
    graph_store.py           graphs/experiments.json persistence, mlops_status(), node exec state
    app_launcher.py          spawns/stops sub-app processes, shared port registry, session state
    proxy_client.py          async HTTP client to sub-apps (health ping, generic request)
    pipeline_store.py, experiment_store.py, activity_store.py   secondary JSON persistence
    insights.py               collection + generation of one Run Insight (plots, markdown, stable metrics)
    run_manifest.py           canonical per-run index of outputs (WORKSPACE/runs/{run_id}/manifest.json)
    plan_store.py, plan_runner.py   Experiment Plans persistence and HTTP-driven execution engine
  utils/
    native_share.py           UNC Windows path -> POSIX path translation, applied at graph build time
    debug_logger.py           colorized WORKSPACE/debug.html developer log
  tools/
    migrate_run_manifests.py  offline, one-shot repair of legacy Insights into strict run manifests
```

### `graph_runner.py`

The brain of the system. `_topo_sort()` (Kahn's algorithm) orders nodes; `_is_free_node()` decides FREE vs LOCKED (see [Concepts](concepts.md#free-and-locked-nodes)); `_steps_for_node()` is the per-type step builder described above. `graph_to_pipeline()` walks the ordered nodes, skips FREE ones (except `inference`, which still gets a human gate), and builds `step_node_map` (`step_id -> node_id`), used by the frontend to color nodes during a run.

Several helpers resolve a value from an ancestor rather than trusting the node's own stale field: `_resolve_yolo_dataset()` tolerates an Annotation export named differently than `<project>-yolo` (a manual export can use any name); `_annotation_yolo_ref()` / `_annotation_ver_output_ref()` return `${STEP:...}` placeholders pointing at the exact path an upstream step actually produced, resolved only at run time by `pipeline_runner`, rather than a name-based guess made at build time; `_optuna_best_ref()` does the same for HPO best params.

`_normalized_data()` runs `native_share.normalize_input_path()` on every field in `_PATH_FIELDS` (`dataset_path`, `model_path`, `sequence_dir`, `annotation_file`) once, here, before any value leaves the Orchestrator process; every sub-app then only ever sees a path meaningful on its own machine.

### `pipeline_runner.py`

`_execute()` computes each step's depth from its `depends_on` chain, then runs one depth level at a time with `asyncio.gather()`, so independent steps at the same depth run concurrently. A step failure marks everything depending on it (transitively) as failed and skips it, without touching unrelated branches. `_run_step()` resolves `${STEP:id.field}` and `${RUN_ID}` placeholders in the step's params only immediately before calling the sub-app, once every upstream step it might reference has already produced output. Steps whose endpoint matches `_LONG` (`/train`, `/infer`, `/evaluate`, `/hpo`, `/start-embed`, `/load-dataset`, `/auto-annotate`, `/create-project`) get a 3600-second HTTP timeout instead of the default 600, and `/hpo` additionally scales its own timeout by `n_trials * (per_trial + 120)` since a synchronous HPO endpoint must outlive every trial it runs.

A step is only considered failed by the executor if the HTTP call itself failed transport-wise, **or** the response body is a `{"ok": false, ...}` JSON contract from the sub-app; several sub-apps (for example Optuna on a missing `data.yaml`, DVC on a failed commit) return HTTP 200 with a business-level failure in the body, which would otherwise look like a green, successful step. A special case (`hpo_succeeded: false` with `fallback_to_training_defaults: true`) is marked `warning` rather than `failed`, so the dependent Training step still runs on its own configured defaults while the failure stays visible.

### `graph_store.py`

Plain JSON persistence in `graphs/experiments.json`. `mlops_status()` derives (never stores) a graph's type: `"mlops"` only when both an `mlflow` and a `dvc` node are present, `"experimental"` otherwise, with a `tracking_partial` flag when only one of the pair exists. `update_node_exec()` uses a status rank (`idle < running < done/warning < failed < waiting`) so a `waiting` status can override an already-`done` sub-step (a multi-step node such as Annotation moving from `project: done` to `annotate: waiting`), while `running`/`done` are explicitly allowed to downgrade a `waiting` node back (resuming after a gate, or a node starting its next sub-step); the graph-level status is flipped to `"waiting"` exclusively by the SSE `event_generator`, never by this function, so a historical SSE replay can never trigger the banner on its own.

### `app_launcher.py`

Spawns each sub-app's backend (`uvicorn`, no `--reload`, since the Windows StatReload reloader was found to sometimes orphan the port or hang the whole launch tree) and frontend (`npm run dev`) as independent processes, each in its own process group so that stopping one sub-app never touches Orchestrator's own process tree. Port allocation goes through the same shared lock file and instance registry (`_lib.launcher_engine`) used by every other app of the suite, so two users or two apps launched at the same moment never race for the same port. `stop_app()` sends a graceful signal first, waits briefly, then force-kills, and finally does a best-effort kill of anything still bound to the app's ports by scanning `netstat`/`lsof`, since a pid-based kill alone misses a child that detached from its process group.

## Run Insight and lineage (Git / DVC / MLflow)

See [Concepts](concepts.md#run-insight-what-a-run-left-behind) and [Concepts](concepts.md#lineage-linking-runs-across-the-whole-workspace) for what an Insight and the Lineage graph mean. This section covers only their implementation.

`core/insights.py`'s `collect(graph_id, run_id)` fetches training status and per-epoch history from Training_App, Optuna studies whose `run_id` user-attribute matches exactly, MLflow runs tagged `orch_run_id == run_id`, and DVC commits whose trailer matches, all through direct `httpx` calls rather than `proxy_client` (which truncates responses at 4000 characters and previously broke the collection of long run lists and per-epoch histories). `_build_lineage()` assembles the lineage object and the seven-check reproducibility list from real, current state (never a cached "green" default). `generate()` writes three files per run (`insights.json` the full bundle, `insights.md` a human-readable log, `metrics.json` a stable, sorted, timestamp-free subset meant to be versioned by DVC without churning on every regeneration) plus matplotlib plots (training curves, a mAP "gains" chart comparing each training to the first one, an Optuna history, a Gantt timeline) and fetched training-engine analysis images (confusion matrix, PR/F1 curves, label distribution), then calls `run_manifest.finalize()`.

`core/run_manifest.py` keeps `WORKSPACE/runs/{run_id}/manifest.json`, a run's logical index: files stay in each sub-app's own workspace, but every output is explicitly tied to the `run_id` that produced it (`start()` at launch, `finalize()` at the end), written atomically (temp file plus `os.replace`) so a reader never sees a half-written manifest. An output of a fork's run never implicitly becomes an output of the parent; an input inherited from a fork base is recorded explicitly as `{"kind": "fork_base", ...}`.

`api/lineage.py`'s `get_lineage(include_failed=False)` builds one `{nodes, edges}` graph across every graph in the workspace. Node kinds: `source_dataset` (deduped by path and name), `dataset` (the subset a specific run actually extracted, deduped by source, subset, query and DVC version, never by the parent's commit, so an uncommitted fork keeps its own identity), `run`, `model` (deduped by path), `stage` (one MLflow run, tied to the pipeline run that produced it) and `artifact`. By default only runs with a terminal, successful status are shown (the "published" view); `include_failed=true` also includes failed/interrupted runs (the "audit" view), with everything hidden by default listed in `excluded_runs` instead of silently dropped. `api/graphs.py`'s `fork_run()` and `track_mlops()` complete this system: forking duplicates the graph and records `forked_from` (parent commit, dataset, DVC version, mAP50, a full parameter snapshot for the divergence view) without triggering any DVC pull; `track_mlops()` idempotently injects the missing `mlflow`/`dvc` node(s) as a coupled pair.

## Experiment Plans

`core/plan_store.py` persists plans as plain JSON in `WORKSPACE/plans/plans.json`; `core/plan_runner.py` executes one as a background `asyncio.create_task`, but deliberately does not call any internal Python function directly. Instead, it replays exactly the HTTP sequence a person would perform by hand, against the app's own `http://127.0.0.1:{BACKEND_PORT}` endpoints: duplicate the base graph, apply named overrides onto standard node ids (`v1`, `a1`, `t1`) via `_apply_overrides()` (silently skipping a node id the base graph does not have), save, run, poll every 3 seconds for up to 40 minutes and auto-resume any gate the run hits (a plan must never sit stuck waiting for a click), then generate the run's Insight and read back its `dvc_version` / `git_commit` / `map50`. This reuse means every existing safeguard (validation, auto-launch, SSE-driven status) applies to a plan step exactly as it would to a run you started by hand. The DVC commit is deliberately left out: a plan only produces runs, and versioning is a manual decision made afterward from each run's own DVC node.

## Frontend, file by file

```
frontend/src/
  api/client.ts             every typed API call; BACKEND_BASE is always '' (same-origin, through
                             the Vite proxy) so SSE never becomes a cross-origin fetch
  types/api.ts               TypeScript mirrors of the backend Pydantic schemas
  nodes/
    ports.ts                 typed port schema (NODE_PORTS) and connection validation, see above
    routing.ts                pure orthogonal edge routing engine, no React/xyflow dependency
    AppNode.tsx               generic card for explorer/annotation/dvc/mlflow/optuna/training/inference
    DatasetNode.tsx, ModelNode.tsx   entry nodes (no input, no FREE/LOCKED logic)
    NodePorts.tsx, OrthogonalEdge.tsx   visual port strip and the single edge type
  components/
    NodeConfigPanel.tsx       right-side per-node-type configuration forms, help panel
    UserBadge.tsx              footer user/workspace widget
    docs/                      markdown.ts, MarkdownDoc.tsx: renders docs/*.md pages, used by GuidePage
  pages/
    SandgraphPage.tsx          the main editor: canvas, toolbox, top bar, SSE client, undo/redo,
                                validateGraph(), edge auto-propagation, live sub-step tray
    ExperimentsPage.tsx        graph list + SANDGRAPH_TEMPLATES
    AppsPage.tsx                sub-app launch/stop dashboard
    ActivityPage.tsx            raw execution journal
    MLOpsPage.tsx               sub-tab bar (Outlet) for the nested /mlops/* routes
    InsightsPage.tsx, PlansPage.tsx, LineageGraphPage.tsx, GuidePage.tsx   the MLOps sub-pages
    LibraryPage.tsx, PipelinePage.tsx, DashboardPage.tsx   legacy pipeline system, reachable only by URL
    AboutPage.tsx                static platform overview (partly outdated, prefer this documentation)
```

### `SandgraphPage.tsx`

`TOOLBOX_NODES` defines the draggable node types and their default `data`. Undo/redo uses ref-backed history stacks (`historyRef`/`futureRef`) plus mirror refs (`nodesRef`/`edgesRef`) to avoid stale closures inside long-lived callbacks. `validateGraph()` runs the port rules from `ports.ts` plus a model-lineage engine/size pre-check (mirroring the backend's `_model_lineage_spec`, so a bad graph is caught before the round trip to the server) and is called by both `saveMut` and `runMut`. `_propagateAllEdges()` runs on save: it copies names along typed edges (dataset name into a Dataset Explorer, subset name into an Annotation project name, and so on), only overwriting a downstream field when its upstream source actually changed since the last propagation (tracked with a hidden marker field), so a manually edited name is never silently clobbered while its source stays the same.

The SSE client opens a raw `fetch()` to `/api/graphs/{id}/run/{run_id}/stream`, reads the body as a stream, and dispatches each `data: ` line to `_handleSSEEvent()`, which updates node status via `stepNodeMap`, appends to the log panel, and refreshes `available_subsets`/`available_exports` after a successful export step. `refreshWorkspaceOutputs()` also injects `has_input` (derived fresh from `edges` on every call, never persisted) into every explorer/annotation node.

### `AppNode.tsx`

The single generic card component for every app-type node. `isFreeMode` is computed as `(type === 'explorer' || 'annotation') && data.has_input === false`; the FREE/LOCKED badge, the clickable list of existing outputs in FREE mode, and the hidden fields in the expanded panel all key off this one boolean. `has_input` arrives inside `data` from `SandgraphPage`, is never itself persisted (stripped before every save/run), and is the only source of truth for the FREE/LOCKED distinction anywhere in the frontend.

### `vite.config.ts`

Dev server on the port set by `VITE_FRONTEND_PORT`; proxies `/api/*` to `http://localhost:${VITE_BACKEND_PORT}` with a 300-second timeout. The SSE run stream still bypasses this proxy's buffering by using a same-origin relative URL (`BACKEND_BASE = ''`) rather than an absolute one, which is what actually matters for it working over a LAN address, not the proxy itself.

## `launcher.py` (app root)

Parses `--user` (required) and `--workspace` (required), plus `--conda-env`, `--backend-port`, `--frontend-port`, `--backend-only`, `--reload`, `--access-log`. Creates the workspace layout, allocates ports under the suite-wide shared lock (`_acquire_lock()` / `Computer_Vision_App/.run/.port_lock`), registers the instance, writes `ORCHESTRATOR_WORKSPACE` / `ORCHESTRATOR_USER` / port env vars, then spawns `uvicorn` and (unless `--backend-only`) `npm run dev` as child processes. A `SIGINT`/`SIGTERM` handler unregisters the instance and kills both process trees cleanly on exit.

## Development test scenarios

Five scenarios exercise FREE/LOCKED mode and the full pipeline chain end to end; SC1 to SC4 are also offered as **Experiments** page templates, and their step-by-step instructions live in [Workflows](workflows.md#test-scenarios-free-and-locked-modes-end-to-end). SC5 is only driven through `run_all_scenarios.py`, which launches an isolated Orchestrator instance per test user (each with its own sub-app instances) and runs SC3 first (it produces the subset and annotation export that SC1/SC2 reuse), then SC4, SC1 and SC2 in parallel.

| Scenario | Goal | Flow |
|---|---|---|
| SC1 | FREE mode without a dataset | explorer FREE (existing subset) -> Annotation LOCKED -> DVC |
| SC2 | FREE mode on Annotation | Annotation FREE (existing export) -> MLflow -> DVC |
| SC3 | Full semi-automatic pipeline | Dataset -> explorer LOCKED -> Annotation LOCKED (full_auto, SAM3) -> MLflow -> DVC, with human gates at every critical step |
| SC4 | Fully manual pipeline | Same chain as SC3 with `full_auto=false`; the Orchestrator only observes and connects |
| SC5 | Fan-out training, HPO and DVC | Dataset -> explorer -> manual Annotation -> 3 parallel Training nodes with distinct hyperparameters -> MLflow check -> Optuna HPO -> a 4th Training using the HPO best params -> final MLflow check -> DVC |

`t_best` in SC5 derives its `dataset_path` by a breadth-first walk over its ancestors: its direct parent is the Optuna node, but the dataset itself only exists on the Annotation node further up the chain, which is exactly the ancestor-walking behavior `_dataset_path_from_ancestors()` implements in `graph_runner.py`.

## Invariants that must not be broken

1. **`has_input` is always derived from edges, never persisted.** Recomputing it from a stored value instead of the live edge list would let a FREE node silently drift out of sync with its actual connectivity.
2. **FREE nodes never generate a pipeline step**, except `inference`, which still gets a human gate to open the app manually. `_needed_app_keys()` and `graph_to_pipeline()` must stay in agreement on this exclusion list.
3. **Outputs for FREE mode always come from the workspace filesystem scan**, never from asking a sub-application over HTTP what it has produced.
4. **`event_generator()` exits the SSE loop only on `type == "done"`**, never on `"waiting"`; exiting on a historical "waiting" event during replay reintroduces the infinite-gate-loop bug.
5. **`update_node_exec()` never regresses a node from `"done"` back to `"waiting"`** on its own; only the SSE `event_generator`, seeing the stream actually end at a live gate, may set the graph-level status to `"waiting"`.
6. **`annotation_imports_path` is always computed from the workspace structure** (`WORKSPACE / f"annotation_{CURRENT_USER}" / "imports"`), never via an HTTP call to Annotation_App, since Annotation may not be running yet when Dataset Explorer needs the value.
7. **`APP_URLS` / `APP_FRONTEND_URLS` are mutable dicts read by reference everywhere.** Copying either dict breaks the live patching `graph_runner`/`app_launcher` perform when a sub-app is launched or its URL repatched after a reload.
8. **A UNC path is normalized exactly once**, at graph-build time in `graph_runner._normalized_data()`, on the four fields in `_PATH_FIELDS`. Normalizing again downstream, or skipping a new path-carrying field added to a node, reintroduces "path not found" errors on the Linux backend.
9. **`_active_runs` is in-memory only.** A resume against a run id the backend does not recognize must trigger `reset_graph_execution()` and HTTP 410, never a silent failure or a hang.
10. **A model lineage (`model`/`optuna`/`training`/`inference`) must share one engine and, once any node sets it, one size**, checked both in the frontend (`validateGraph`) and the backend (`_model_lineage_spec`) before any expensive step runs.
11. **DVC and MLflow nodes have no ports at all** (`NODE_PORTS.dvc`/`.mlflow` are both empty); they must never be reintroduced as a step consuming one specific upstream artifact type.
12. **Never launch `uvicorn backend.main:app` without `ORCHESTRATOR_WORKSPACE` and `ORCHESTRATOR_USER` set** by `launcher.py`; the backend would resolve to the wrong workspace, or refuse to start at all if no real user name can be found.
