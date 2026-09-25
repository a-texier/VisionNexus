---
app: orchestrator
doc_type: code-map
audience: dev
lang: en
title: Code map
order: 80
tags: [code navigation, backend, frontend, modules]
sources: [Orchestrator_App/backend, Orchestrator_App/frontend/src]
---

# Code map

## Where to start reading the backend code

Read these files in this order to understand the backend:

1. `config.py`: the workspace (`ORCHESTRATOR_WORKSPACE`), the current user resolution, ports, `APP_URLS`/`APP_FRONTEND_URLS`, CORS.
2. `main.py`: the FastAPI app, the lifespan (debug logger init, `repatch_app_urls()`), the router mounts, the direct workspace endpoints.
3. `api/graphs.py`: the sandgraph router, the biggest file of the backend; CRUD, run/resume/stop, the SSE stream, the workspace-outputs scan, the DVC artifacts hub.
4. `core/graph_runner.py`: converts a graph into a `PipelineDef`; this is where every node type's behavior is defined.
5. `core/pipeline_runner.py`: the async DAG executor that actually calls sub-applications.
6. `core/graph_store.py`, `core/app_launcher.py`: graph persistence and sub-app process management.

## Where to start reading the frontend code

1. `App.tsx`: the sidebar layout and the route table, including the nested `/mlops/*` routes.
2. `pages/SandgraphPage.tsx`: the main editor, by far the largest frontend file; read it by feature (toolbox, SSE client, validation, edge propagation) rather than top to bottom.
3. `nodes/ports.ts`: the typed port schema every node type declares.
4. `components/NodeConfigPanel.tsx`: one configuration form per node type.
5. `api/client.ts`: every backend call, grouped by domain (`graphsAPI`, `launcherAPI`, `insightsAPI`, `plansAPI`, `docsAPI`, ...).

## Where to change a node type's pipeline behavior

Each node type's steps are built by one branch of `_steps_for_node()` in `backend/core/graph_runner.py`. To change what a node produces, edit that branch; to change which sub-application endpoint it calls, edit the `endpoint` field of the step dict it returns. The node's visual configuration form lives in a matching function in `frontend/src/components/NodeConfigPanel.tsx` (for example `AnnotationConfig`, `TrainingConfig`), and its contextual help text in `frontend/src/nodes/nodeHelp.ts` (`NODE_HELP`).

## Where to add a new node type

1. Add the type to `NODE_PORTS` in `frontend/src/nodes/ports.ts` (inputs, outputs, `accepts`, `required`/`exclusiveWith`/`requiresPeer` as needed).
2. Add a default entry to `TOOLBOX_NODES` in `frontend/src/pages/SandgraphPage.tsx` so it can be dragged onto the canvas, and register its type in `frontend/src/nodes/index.ts` (`nodeTypes`), reusing `AppNode.tsx` unless the new type needs a very different visual (like `DatasetNode.tsx` or `ModelNode.tsx`).
3. Add a configuration form branch in `NodeConfigPanel.tsx` and a help entry in `nodeHelp.ts`.
4. Add a branch to `_steps_for_node()` in `backend/core/graph_runner.py` that returns the pipeline step(s) for this type, and register the sub-application it needs in `_needed_app_keys()` and `_ordered_app_keys()` if it is not already covered.
5. If the node participates in FREE/LOCKED mode, add it to the `_is_free_node()` exclusion logic and to `graph_to_pipeline()`'s skip condition; most new node types should not opt into FREE mode unless they genuinely expose pre-existing workspace outputs.

## Where to change the auto-launch or SSE logic

Auto-launch: `_preflight_check()`, `_auto_launch_and_wait()` and `_launch_sequence()` in `backend/core/graph_runner.py`; the actual process spawning is in `backend/core/app_launcher.py`. SSE: `event_generator()` in `backend/api/graphs.py` (server side) and the raw `fetch()` client in `_openSSE()` in `frontend/src/pages/SandgraphPage.tsx` (client side); the underlying replay generator is `stream_events()` in `backend/core/pipeline_runner.py`. Read the invariants in [Architecture](architecture.md#invariants-that-must-not-be-broken) before touching either.

## Where to change Run Insight, Lineage or Experiment Plans

Insight generation: `backend/core/insights.py` (`collect()`, `_build_lineage()`, `generate()`) and its API in `backend/api/insights.py`. Lineage graph: `backend/api/lineage.py`. Experiment Plans: `backend/core/plan_store.py` (persistence), `backend/core/plan_runner.py` (execution engine), `backend/api/plans.py` (API), and the editor UI in `frontend/src/pages/PlansPage.tsx`.

## Where to change the in-app documentation

The markdown pages live in `docs/` at the app root (this page's own source). The router that serves them is `backend/api/docs.py`; the rendering components are `frontend/src/components/docs/markdown.ts` and `MarkdownDoc.tsx`; the page that displays them is `frontend/src/pages/GuidePage.tsx`. Regenerate the tables below with `python tools/docs/gen_code_map.py --app orchestrator` after moving or renaming backend or frontend files.

## Module map

<!-- generated:start -->
### backend

| File | Description | Exports |
|---|---|---|
| `config.py` |  | `UnknownUserError` |
| `main.py` |  | `lifespan`, `root_health`, `workspace_users`, `workspace_open`, `workspace_history` |

### backend/api

| File | Description | Exports |
|---|---|---|
| `activity.py` |  | `activity` |
| `docs.py` |  | `parse_frontmatter`, `load_doc_set`, `doc_path`, `read_doc`, `safe_asset_path`, `list_docs`, `get_doc_asset`, `get_doc` |
| `engines.py` |  | `list_engines` |
| `experiments.py` |  | `list_experiments`, `get_experiment`, `resume_experiment`, `delete_experiment`, `restart_experiment` |
| `graphs.py` |  | `CreateGraphBody`, `UpdateGraphBody`, `list_graphs`, `create_graph`, `get_graph`, `update_graph`, `delete_graph`, `duplicate_graph`, `ForkRunBody`, `fork_run`, `track_mlops`, `reset_graph` (+19) |
| `health.py` |  | `health` |
| `insights.py` |  | `GenerateBody`, `list_insights`, `get_insights`, `get_plot`, `delete_insights`, `generate_insights` |
| `launcher_api.py` |  | `LaunchBody`, `list_apps`, `launch_app`, `stop_app`, `launch_all_apps`, `stop_all_apps` |
| `lineage.py` |  | `get_lineage` |
| `pipelines.py` |  | `PipelineBody`, `list_pipelines`, `create_pipeline`, `get_pipeline`, `update_pipeline`, `delete_pipeline`, `start_run`, `stream_run`, `get_run_status` |
| `plans.py` |  | `Step`, `PlanBody`, `list_plans`, `create_plan`, `get_plan`, `update_plan`, `delete_plan`, `run_plan`, `plan_status` |
| `settings.py` |  | `AppSettings`, `load_settings`, `get_settings`, `update_settings` |

### backend/core

| File | Description | Exports |
|---|---|---|
| `activity_store.py` |  | `StepResult`, `ActivityRun`, `record_run`, `get_activity` |
| `app_launcher.py` |  | `AppSession`, `launch_app`, `stop_app`, `get_all_sessions`, `get_session`, `set_status`, `repatch_app_urls` |
| `experiment_store.py` |  | `StepRecord`, `Experiment`, `create_experiment`, `get_experiment`, `get_experiment_by_run`, `list_experiments`, `update_step`, `set_waiting`, `complete_experiment`, `interrupt_experiment`, `update_metrics`, `update_artifacts` |
| `graph_runner.py` |  | `GraphConfigError`, `graph_to_pipeline`, `run_graph` |
| `graph_store.py` |  | `graph_node_types`, `mlops_status`, `create_graph`, `get_graph`, `list_graphs`, `update_graph`, `delete_graph`, `duplicate_graph`, `start_run`, `update_node_exec`, `set_node_data`, `set_graph_waiting` (+6) |
| `insights.py` |  | `collect`, `generate`, `delete`, `list_all`, `load`, `plot_path` |
| `pipeline_runner.py` |  | `StepState`, `RunState`, `start_run`, `get_run_state`, `run_in_memory`, `resume_run`, `stop_run`, `extend_run`, `update_run_pipeline`, `stream_events` |
| `pipeline_store.py` |  | `PipelineStep`, `PipelineDef`, `list_pipelines`, `get_pipeline`, `save_pipeline`, `create_pipeline`, `update_pipeline`, `mark_run`, `delete_pipeline` |
| `plan_runner.py` |  | `run_plan`, `start_plan`, `get_run_state` |
| `plan_store.py` |  | `create_plan`, `get_plan`, `list_plans`, `update_plan`, `delete_plan`, `set_run_state` |
| `proxy_client.py` |  | `ping`, `ping_all`, `request` |
| `run_manifest.py` | Manifeste canonique d'une execution Orchestrator. | `load`, `write`, `start`, `finalize` |

### backend/tools

| File | Description | Exports |
|---|---|---|
| `__init__.py` | Outils de maintenance explicites de l'Orchestrator. |  |
| `migrate_run_manifests.py` | Migre les anciens Insights vers des manifestes stricts par run. | `migrate` |

### backend/utils

| File | Description | Exports |
|---|---|---|
| `debug_logger.py` |  | `DebugLogger` |
| `native_share.py` |  | `from_native_share_path`, `normalize_input_path` |

### frontend/src

| File | Description | Exports |
|---|---|---|
| `App.tsx` | App.tsx - layout principal avec sidebar | `App` |
| `main.tsx` |  |  |

### frontend/src/api

| File | Description | Exports |
|---|---|---|
| `client.ts` |  | `BACKEND_BASE`, `healthAPI`, `pipelinesAPI`, `activityAPI`, `settingsAPI`, `experimentsAPI`, `enginesAPI`, `docsAPI`, `graphsAPI`, `insightsAPI`, `plansAPI`, `launcherAPI` (+1) |

### frontend/src/components

| File | Description | Exports |
|---|---|---|
| `NodeConfigPanel.tsx` | NodeConfigPanel - panneau de configuration d'un nœud sélectionné | `NodeConfigPanel` |
| `Plot.tsx` | Plot.tsx - wrapper React minimal autour de plotly.js (bundle min). | `Plot`, `buildHtmlReport` |
| `UserBadge.tsx` |  | `UserBadge` |

### frontend/src/components/common

| File | Description | Exports |
|---|---|---|
| `LanguageToggle.tsx` |  | `LanguageToggle` |

### frontend/src/components/docs

| File | Description | Exports |
|---|---|---|
| `markdown.ts` | Rendu markdown -> HTML des pages de docs/ et liens vers la page Guide. | `docLink`, `renderMarkdown` |
| `MarkdownDoc.tsx` | Affiche un corps markdown de docs/ (sans frontmatter) avec les ancres | `MarkdownDoc` |

### frontend/src/hooks

| File | Description | Exports |
|---|---|---|
| `useActivity.ts` |  | `useActivity`, `useInvalidateActivity` |
| `useEngines.ts` |  | `useEngines`, `shortSize` |
| `useHealth.ts` |  | `useHealth` |
| `usePipelines.ts` |  | `usePipelines`, `usePipeline`, `useInvalidatePipelines` |

### frontend/src/i18n

| File | Description | Exports |
|---|---|---|
| `translate.ts` | Traduction FR -> EN a l'affichage. Le francais reste la source de | `getLang`, `setLang`, `subscribeLang`, `isDesktopPiloted`, `initWorkspaceLanguage`, `setLangAndMaybePersist`, `t` |
| `useLang.ts` |  | `useLang`, `useT` |

### frontend/src/nodes

| File | Description | Exports |
|---|---|---|
| `AppNode.tsx` | AppNode - nœud générique pour chaque sous-app CV | `NodeActivity`, `NodeProgress` |
| `DatasetNode.tsx` | DatasetNode - nœud source de dataset |  |
| `index.ts` |  | `nodeTypes` |
| `ModelNode.tsx` | ModelNode - nœud d'ENTRÉE : des poids d'un moteur d'entraînement, fournis manuellement. |  |
| `nodeHelp.ts` | nodeHelp.ts - contenu du panneau d'AIDE (bouton HELP rouge du NodeConfigPanel). | `NODE_HELP` |
| `NodePorts.tsx` | nodes/NodePorts.tsx - section « blueprint » partagée par tous les nœuds. | `NodePorts` |
| `OrthogonalEdge.tsx` | nodes/OrthogonalEdge.tsx - arête unique « Blueprint style » utilisée pour | `OrthogonalEdge` |
| `ports.ts` | nodes/ports.ts - schéma de branchement « blueprint » des nœuds. | `PORT_COLOR`, `PORT_EMPTY_HANDLE`, `PORT_STROKE`, `NODE_PORTS`, `resolveHandles`, `inputAccepts`, `wouldViolateExclusivity`, `validatePortRules`, `compatibleNodeTypes` |
| `routing.ts` | nodes/routing.ts - moteur de routage orthogonal « Blueprint style ». | `ROW_BAND`, `CORRIDOR_MARGIN`, `LANE_SPACING`, `STUB`, `CORNER_RADIUS`, `xRangeOf`, `decideMode`, `assignLanes`, `buildPoints`, `svgPathFromPoints`, `estimatePillWidth`, `LABEL_EDGE_MARGIN` (+2) |
| `shared.ts` |  | `STATUS_DOT`, `STATUS_RING` |

### frontend/src/pages

| File | Description | Exports |
|---|---|---|
| `AboutPage.tsx` | Présentation de la plateforme MLOps Computer Vision. | `AboutPage` |
| `ActivityPage.tsx` | Timeline complète des exécutions passées. | `ActivityPage` |
| `AppsPage.tsx` | AppsPage.tsx - Lancement et statut des sous-apps CV | `AppsPage` |
| `DashboardPage.tsx` | Cards de statut des 5 apps + widget run actif + feed activité. | `DashboardPage` |
| `ExperimentsPage.tsx` | Liste des expériences sandgraph + templates prédéfinis. | `ExperimentsPage` |
| `GuidePage.tsx` | Sous-onglet MLOps > Guide : documentation integree. Rend les pages | `GuidePage` |
| `InsightsPage.tsx` | Insights par run de template : plots d'evolution (training, | `InsightsPage` |
| `LibraryPage.tsx` | Grille des pipelines sauvegardés + templates prédéfinis. | `LibraryPage` |
| `LineageGraphPage.tsx` |  | `LineageGraphPage` |
| `MLOpsPage.tsx` | MLOpsPage.tsx - onglet parent "MLOps" : monitoring + tracabilite. | `MLOpsPage` |
| `PipelinePage.tsx` | Éditeur de pipeline + DAG SVG + exécution avec SSE. | `PipelinePage` |
| `PlansPage.tsx` | PlansPage.tsx - Experiment Plans : construire une suite d'etapes | `PlansPage` |
| `SandgraphPage.tsx` | SandgraphPage.tsx - Éditeur de graphe interactif (ReactFlow) | `LogBlocks`, `SandgraphPage` |

### frontend/src/types

| File | Description | Exports |
|---|---|---|
| `api.ts` | types/api.ts - miroir exact des schémas Pydantic backend | `deriveMlops` |

### frontend/src/utils

| File | Description | Exports |
|---|---|---|
| `time.ts` |  | `formatDistanceToNow`, `formatDuration`, `formatDateTime` |
| `workspaceStorage.ts` |  | `workspaceStorageScope`, `workspaceStorageKey`, `useWorkspaceStorageScope` |
<!-- generated:end -->
