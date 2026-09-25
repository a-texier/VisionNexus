---
app: mlflow
doc_type: code-map
audience: dev
lang: en
title: Code map
order: 80
tags: [code navigation, backend, frontend, lineage, extension]
sources: [MLflow_App/backend/main.py, MLflow_App/backend/core/mlflow_client.py, MLflow_App/frontend/src/App.tsx, MLflow_App/frontend/src/pages/LineagePage.tsx, MLflow_App/frontend/src/i18n/translate.ts]
---

# Code map

## Where to start reading the backend code

The backend of MLflow App is in `MLflow_App/backend/`. Read these files in this order to understand it:

1. `main.py`: the entry point. The lifespan calls `ensure_mlflow_running()`/`stop_mlflow_server()`; the routers are mounted here; `/health` and the workspace helpers are defined here.
2. `config.py`: the workspace, `MLFLOW_TRACKING_URI` and `MLFLOW_ARTIFACT_ROOT`, the ports and the CORS origins.
3. `core/mlflow_client.py`: `get_client()`, `is_mlflow_running()`, `ensure_mlflow_running()`; the file that draws the line between the default serverless mode and the legacy HTTP server mode.
4. `api/experiments.py`, `api/runs.py`, `api/models.py`, `api/compare.py`: one file per domain, each a thin wrapper around `MlflowClient` calls behind `_require_mlflow()`.

Outside `backend/`, `Training_App/backend/services/mlflow_logging.py` is the writer-side counterpart worth reading alongside this backend: it is what actually populates the store this app only reads.

## Where to start reading the frontend code

The frontend is a Vite/React app in `MLflow_App/frontend/src/`. Start with `App.tsx` for the route list and the sidebar status dot, then `pages/LineagePage.tsx` (the home page and the most involved one, combining this app's own API with the Orchestrator's), `pages/ExperimentsPage.tsx` and `pages/RunDetailPage.tsx` for the classic experiment-first views, and `pages/ModelRegistryPage.tsx`/`pages/CompareRunsPage.tsx` for the two remaining sidebar pages. `api/client.ts` is the single place that calls this app's own backend; `types/api.ts` mirrors its Pydantic response shapes. `hooks/useRuns.ts`, `useExperiments.ts` and `useModels.ts` wrap the matching `client.ts` calls in TanStack Query hooks with their cache invalidation helpers.

## Where to change what counts as a lineage tag

The tag names themselves (`orch_run_id`, `graph_id`, `graph_name`, `fork_parent_run`, `git_commit`, `dataset_version`, `node_label`, `run_type`) are written by the Orchestrator, not by this app: start at `Orchestrator_App/backend/core/graph_runner.py::_trace_of()` for the tags set at run creation, and `Orchestrator_App/backend/api/graphs.py::dvc_commit_selected()` for the `git_commit`/`dataset_version` backfill via `POST /api/runs/{id}/tags`. On the MLflow App side, `frontend/src/pages/RunDetailPage.tsx`'s `lineageFields` array is where a tag becomes a labeled chip on the run detail page, and `frontend/src/pages/ExperimentsPage.tsx`'s `RUN_TYPE_META` is where a `run_type` value becomes a colored role badge. A tag this app does not recognize is simply not shown anywhere; nothing needs to change here to accept a new Orchestrator tag that has no dedicated UI yet.

## Where to change the Lineage graph layout

Everything is in `frontend/src/pages/LineagePage.tsx::build()`: it turns the Orchestrator's `{nodes, edges}` payload plus this app's own run list into ReactFlow `nodes`/`edges` arrays, with per-run x offsets (`BW`, `BG` spacing constants) and per-stage y offsets computed from the run's stage count. Add a new node kind by extending the `Kind` union and the `META` record (title, CSS class, minimap color) at the top of the file, then a case in `build()` that pushes a positioned node for it. The list view rendered when the graph/list toggle is off reads the same `flow.runs` data structure, so a new node kind usually needs a small addition there too if it should be visible outside the graph.

## Where to add an endpoint or a field

Add the FastAPI route in the matching `api/*.py` file (or a new router, mounted in `main.py`), keep it behind `_require_mlflow()` if it touches the SDK, and mirror the response shape in `frontend/src/types/api.ts`. For a new field on an existing response (for example a new run summary field), add it to the dict built in the backend function and to the matching TypeScript interface; nothing else needs to change since every consumer reads through the typed `api/client.ts` functions. Keep the router mount order in `main.py` with specific paths before generic ones, matching the existing comment there.

## Where to change help and translations

This documentation's pages live in `MLflow_App/docs/`, served by `backend/api/docs.py` and rendered by `frontend/src/components/docs/MarkdownDoc.tsx` on `frontend/src/pages/DocPage.tsx` (distinct from the suite-specific explanatory content also named `DocPage.tsx` before this documentation set existed; the route `/doc` now serves this rendered markdown instead). French strings are the source of truth in the code; add their English translation to the `EXACT_EN` dictionary in `frontend/src/i18n/translate.ts` (exact match) or to `PHRASE_EN` (substring, for dynamically built strings). The original explanatory content stays in the git history if it needs to be recovered; the facts it described were folded into this documentation set's Concepts and README pages.

## Debugging tools

- `GET /health` and `GET /api/mlflow-status` are the two fastest checks of whether the backend can reach the SQLite store.
- The `mlflow.db` SQLite file can be opened directly with `mlflow ui --backend-store-uri sqlite:///mlflow.db` (a temporary, separate MLflow UI) or any SQLite browser, to inspect run state independently of this app's interface.
- The writer app's own log output around a training run is the fastest way to confirm whether `mlflow_logging.py` actually attempted to log, since a logging failure there is silent to the training itself.

## Module map

<!-- generated:start -->
### backend

| File | Description | Exports |
|---|---|---|
| `config.py` |  |  |
| `main.py` |  | `lifespan`, `health`, `workspace_users`, `workspace_open`, `workspace_history` |

### backend/api

| File | Description | Exports |
|---|---|---|
| `compare.py` |  | `CompareBody`, `compare_runs` |
| `docs.py` |  | `parse_frontmatter`, `load_doc_set`, `doc_path`, `read_doc`, `safe_asset_path`, `list_docs`, `get_doc_asset`, `get_doc` |
| `experiments.py` |  | `mlflow_status`, `list_experiments`, `ExperimentCreate`, `create_experiment`, `delete_experiment` |
| `models.py` |  | `list_models`, `list_model_versions`, `TransitionBody`, `transition_stage` |
| `runs.py` |  | `list_runs`, `SetTagsBody`, `set_run_tags`, `get_run`, `list_run_artifacts`, `get_run_artifact` |
| `settings.py` |  | `AppSettings`, `load_settings`, `get_settings`, `update_settings` |

### backend/core

| File | Description | Exports |
|---|---|---|
| `mlflow_client.py` |  | `get_client`, `is_mlflow_running`, `ensure_mlflow_running`, `stop_mlflow_server` |

### frontend/src

| File | Description | Exports |
|---|---|---|
| `App.tsx` | Routing + sidebar avec indicateur de statut MLflow. | `App` |
| `main.tsx` |  |  |

### frontend/src/api

| File | Description | Exports |
|---|---|---|
| `client.ts` | Client API typé - axios. | `mlflowAPI`, `experimentsAPI`, `runsAPI`, `modelsAPI`, `compareAPI`, `settingsAPI`, `docsAPI` |

### frontend/src/components

| File | Description | Exports |
|---|---|---|
| `UserBadge.tsx` |  | `UserBadge` |

### frontend/src/components/common

| File | Description | Exports |
|---|---|---|
| `LanguageToggle.tsx` |  | `LanguageToggle` |

### frontend/src/components/docs

| File | Description | Exports |
|---|---|---|
| `markdown.ts` | Rendu markdown -> HTML des pages de docs/ et liens vers la page | `DOCS_ROUTE`, `docLink`, `renderMarkdown` |
| `MarkdownDoc.tsx` | Affiche un corps markdown de docs/ (sans frontmatter) avec les ancres | `MarkdownDoc` |

### frontend/src/hooks

| File | Description | Exports |
|---|---|---|
| `useExperiments.ts` |  | `useExperiments`, `useInvalidateExperiments` |
| `useModels.ts` |  | `useModels`, `useModelVersions`, `useInvalidateModels` |
| `useRuns.ts` |  | `useRuns`, `useRun`, `useInvalidateRuns`, `useRunArtifacts` |
| `useSettings.ts` |  | `useSettings`, `useInvalidateSettings` |

### frontend/src/i18n

| File | Description | Exports |
|---|---|---|
| `translate.ts` | Traduction FR -> EN a l'affichage. Le francais reste la source de | `getLang`, `setLang`, `subscribeLang`, `isDesktopPiloted`, `initWorkspaceLanguage`, `setLangAndMaybePersist`, `t` |
| `useLang.ts` |  | `useLang`, `useT` |

### frontend/src/pages

| File | Description | Exports |
|---|---|---|
| `CompareRunsPage.tsx` | Sélection de runs via checkboxes, métriques côte-à-côte. | `CompareRunsPage` |
| `DocPage.tsx` | Page Doc : rend les pages markdown de MLflow_App/docs/ servies | `DocPage` |
| `ExperimentsPage.tsx` | Liste des expériences + drill-down runs par expérience. | `ExperimentsPage` |
| `LineagePage.tsx` |  | `LineagePage` |
| `ModelRegistryPage.tsx` | Modèles enregistrés, versions, transition de stage. | `ModelRegistryPage` |
| `RunDetailPage.tsx` | Métriques (recharts), params, artifacts d'un run MLflow. | `RunDetailPage` |

### frontend/src/types

| File | Description | Exports |
|---|---|---|
| `api.ts` | Interfaces TypeScript - miroir exact des schémas Pydantic. |  |
<!-- generated:end -->
