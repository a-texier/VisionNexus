---
app: orchestrator
doc_type: api-reference
audience: dev
lang: en
title: API reference
order: 70
tags: [rest api, sse, graphs, insights, lineage, plans, launcher]
sources: [Orchestrator_App/backend/main.py, Orchestrator_App/backend/api/graphs.py, Orchestrator_App/backend/api/launcher_api.py, Orchestrator_App/backend/api/insights.py, Orchestrator_App/backend/api/lineage.py, Orchestrator_App/backend/api/plans.py, Orchestrator_App/backend/api/engines.py, Orchestrator_App/backend/api/docs.py, Orchestrator_App/backend/api/health.py, Orchestrator_App/backend/api/settings.py, Orchestrator_App/backend/api/activity.py, Orchestrator_App/backend/api/pipelines.py, Orchestrator_App/backend/api/experiments.py]
---

# API reference

## Conventions of the Orchestrator API

The Orchestrator App backend exposes a JSON REST API under `/api`, a Server-Sent Events stream for run execution, and interactive documentation (Swagger) at `/docs` on the backend port (8060 by default, see [Configuration](configuration.md)). Through the Vite frontend, the same paths are proxied, so the frontend always calls relative URLs, except the SSE run stream, which uses a same-origin relative URL of its own to avoid the proxy's buffering.

General rules:

- **Errors** use FastAPI's format `{"detail": "..."}` with 400 (invalid graph, for example a model engine mismatch), 404 (unknown graph, run or plan), 409 (a graph already running, or a run no longer waiting) or 410 (a resume against a run lost after a backend restart). Detail messages mix English and French depending on which module raised them.
- **Long operations** (a graph run) return a `run_id` immediately; follow it with `GET /api/graphs/{id}/run/{run_id}/stream` (SSE). There is no separate polling endpoint for a graph run status beyond re-fetching the graph itself, which is resynchronized from the in-memory run state on every read.
- **Route order matters** for the `graphs` router: its `/meta/*` routes are declared before the parameterized `/{graph_id}` route, so a literal path such as `/api/graphs/meta/app-urls` is never captured as a graph id.
- Responses over 1 KB are not gzip-compressed by this backend (unlike some sub-apps); proxied calls to sub-apps go through `proxy_client`, which truncates response bodies to 100 000 characters.

## Sandgraph endpoints: CRUD, execution and workspace scan

The graphs router (`/api/graphs`) is the main entry point: it manages graphs as a whole and drives their execution.

- `GET /api/graphs` lists graphs (each entry resynchronized from its live run state first if it has one); `POST /api/graphs` creates one (`name`, `nodes`, `edges`). `GET/PUT/DELETE /api/graphs/{id}` read, update or delete one. `POST /api/graphs/{id}/duplicate` copies a graph, resetting its execution history.
- `POST /api/graphs/{id}/run` converts the graph to a pipeline and starts it in the background, auto-launching any missing sub-application first; `POST /api/graphs/{id}/resume` continues a run paused at a human gate, rebuilding the pipeline from the graph's current state; `POST /api/graphs/{id}/stop` cancels an in-progress or waiting run; `POST /api/graphs/{id}/reset` clears execution state without touching nodes or edges.
- `GET /api/graphs/{id}/run/{run_id}/stream` is the SSE endpoint described in [Architecture](architecture.md#sse-architecture): it streams `RunEvent` objects and updates node execution state and progressive Insight generation as it forwards them.
- `POST /api/graphs/{id}/fork-run` duplicates the graph and records `forked_from` provenance from one of its finished runs; `POST /api/graphs/{id}/track-mlops` idempotently adds the missing MLflow and/or DVC observer node(s).
- `GET /api/graphs/meta/workspace-outputs` scans the workspace filesystem (never asks a sub-application) for existing Dataset Explorer subsets and Annotation exports, used to populate FREE-mode pickers. `GET /api/graphs/meta/app-urls` returns the sub-applications' frontend URLs for "Open app" links. `GET /api/graphs/meta/explorer-subsets`, `/meta/mlflow-summary`, `/meta/check-dataset-path`, `/meta/check-annotation-source` and `/meta/annotation-exports` proxy live data from Dataset_Explorer_App, mlflow-app and Annotation_App, all best-effort (an unreachable app returns an empty result, not an error). `GET /api/graphs/meta/inference-config` reads Inference_App's `config/defaults.yaml` directly from disk to prefill its configuration panel without requiring the app to be running.
- `GET /api/graphs/{id}/artifacts` and `POST /api/graphs/{id}/dvc-commit` are the DVC node's hub: listing versionable outputs of a specific run and creating a version from the ones you check. `GET /api/graphs/meta/download` streams (and zips, for a folder) any workspace file under a graph's artifact list. `GET /api/graphs/{id}/download-graph` downloads the raw graph JSON. `GET /api/graphs/{id}/runs/{run_id}/manifest` returns the canonical run manifest.
- `POST /api/graphs/{id}/webhook/annotation-exported` is called by Annotation_App itself when a user completes a manual export, auto-resuming the graph if it is waiting exactly at that gate.

## Launcher endpoints: sub-app lifecycle

The launcher router (`/api/apps`) manages sub-application processes, used by the **Applications** page and internally by `graph_runner`'s auto-launch.

- `GET /api/apps` lists every known sub-app with its live status, pinging `/health` for sessions not already confirmed `running` and promoting or failing them based on the result and how long they have been starting.
- `POST /api/apps/launch` launches one app (`app_id`, optional `base_workspace`, `user`, `conda_env`); `POST /api/apps/{id}/stop` stops one. `POST /api/apps/launch-all` and `POST /api/apps/stop-all` do the same for every app not already running or already stopped.

## Insights endpoints: Run Insight collection and retrieval

The insights router (`/api/insights`) manages the Run Insight described in [Concepts](concepts.md#run-insight-what-a-run-left-behind).

- `GET /api/insights` lists every generated Insight across all graphs and runs. `GET /api/insights/{graph_id}/{run_id}` returns the full bundle (404 if not generated yet). `GET /api/insights/{graph_id}/{run_id}/plot/{name}` serves one plot PNG (path-traversal guarded). `DELETE /api/insights/{graph_id}/{run_id}` removes the Insight's files, which is only a display cache; the underlying lineage, DVC versions and MLflow runs are untouched and the Insight can be regenerated.
- `POST /api/insights/{graph_id}/generate` (re)generates the Insight for a given `run_id`, or the graph's most recent known run if omitted.

## Lineage endpoint: cross-experiment graph

`GET /api/lineage` (`include_failed: bool`, default false) builds the `{nodes, edges}` lineage graph across every graph in the workspace, described in [Concepts](concepts.md#lineage-linking-runs-across-the-whole-workspace) and [Architecture](architecture.md#run-insight-and-lineage-git--dvc--mlflow). No URL is resolved server-side; deep links to sub-application frontends are built by the client from `GET /api/graphs/meta/app-urls`.

## Plans endpoints: Experiment Plans

The plans router (`/api/plans`) manages Experiment Plans, described in [Concepts](concepts.md#experiment-plans).

- `GET /api/plans` lists plans; `POST /api/plans` creates one (`name`, `steps`). `GET/PUT/DELETE /api/plans/{id}` read, update or delete one.
- `POST /api/plans/{id}/run` starts execution as a background task, returning `{"ok": false, "message": "..."}` (not an HTTP error) if the plan is already running. `GET /api/plans/{id}/status` returns the current execution state, or `{"status": "idle"}` if it never ran.

## Engines endpoint: training engine catalog

`GET /api/engines` returns the training engines available to `model`, `training` and `optuna` nodes, each with its size and hyperparameter catalog. It first tries Training_App's own `GET /api/capabilities`; if that app is not reachable or returns an empty catalog, it falls back to importing Training_App's local plugin registry directly (best-effort, works even with no sub-application running, so a graph can be edited offline).

## Docs endpoints: in-app documentation

`GET /api/docs` lists the documentation pages available in a language, sorted by their manifest order. `GET /api/docs/{name}` returns one page's frontmatter and markdown body, falling back to the other language if the requested one is missing. `GET /api/docs/assets/{path}` serves an image referenced from a page. These back the **Guide** sub-tab described in [User guide](user-guide.md).

## Health, settings and activity endpoints

`GET /api/health` concurrently pings every configured sub-application and returns latency and reachability per app; it backs the health dots on the Applications page. `GET/PUT /api/settings` reads and writes the small `AppSettings` record (`theme`, `ui_language`); `workspace_path` and `user_name` are always overwritten from the live `CURRENT_USER`/`WORKSPACE` on read, never taken from the stored file. `GET /api/activity` returns the last N entries (default 50, max 200) of the append-only execution journal, also shown in the **Activité** sub-tab.

## Legacy pipeline and experiment endpoints

`pipelines`, `experiments` and part of `graphs` predate the Sandgraph editor and are kept only for the pages reachable at `/library`, `/pipeline/{id}` and `/dashboard`, described as legacy in [User guide](user-guide.md). `/api/pipelines` is a plain CRUD plus `POST /{id}/run` and its own SSE stream, functionally identical in shape to the Sandgraph one but operating on a hand-built `PipelineDef` instead of a converted graph. `/api/experiments` exposes the same run records the Sandgraph run also creates, with `POST /{id}/resume` and `POST /{id}/restart` as alternate ways to interact with a run's underlying pipeline.

## Endpoint index

The endpoint tables below are generated from the code; the sections above explain each domain.

<!-- generated:start -->
### activity

| Method | Path | Summary | Source |
|---|---|---|---|
| GET | `/api/activity` | Activity | `Orchestrator_App/backend/api/activity.py:12` |

### docs

| Method | Path | Summary | Source |
|---|---|---|---|
| GET | `/api/docs` | Pages du jeu de docs, triees par `order`, avec les langues disponibles. | `Orchestrator_App/backend/api/docs.py:163` |
| GET | `/api/docs/assets/{asset_path}` | Get Doc Asset |  |
| GET | `/api/docs/{name}` | Une page : frontmatter + corps markdown, avec repli de langue. | `Orchestrator_App/backend/api/docs.py:197` |

### Engines

| Method | Path | Summary | Source |
|---|---|---|---|
| GET | `/api/engines` | List Engines | `Orchestrator_App/backend/api/engines.py:61` |

### experiments

| Method | Path | Summary | Source |
|---|---|---|---|
| GET | `/api/experiments` | List Experiments | `Orchestrator_App/backend/api/experiments.py:14` |
| DELETE | `/api/experiments/{experiment_id}` | Delete Experiment | `Orchestrator_App/backend/api/experiments.py:42` |
| GET | `/api/experiments/{experiment_id}` | Get Experiment | `Orchestrator_App/backend/api/experiments.py:19` |
| POST | `/api/experiments/{experiment_id}/restart` | Relance un run pour le même pipeline que cette expérience. | `Orchestrator_App/backend/api/experiments.py:51` |
| POST | `/api/experiments/{experiment_id}/resume` | Resume Experiment | `Orchestrator_App/backend/api/experiments.py:27` |

### graphs

| Method | Path | Summary | Source |
|---|---|---|---|
| GET | `/api/graphs` | List Graphs | `Orchestrator_App/backend/api/graphs.py:126` |
| POST | `/api/graphs` | Create Graph | `Orchestrator_App/backend/api/graphs.py:134` |
| GET | `/api/graphs/meta/annotation-exports` | Proxy: list YOLO exports from Annotation_App for a given project. | `Orchestrator_App/backend/api/graphs.py:641` |
| GET | `/api/graphs/meta/app-urls` | Get App Urls | `Orchestrator_App/backend/api/graphs.py:497` |
| GET | `/api/graphs/meta/check-annotation-source` | Proxy : demande à Annotation_App si ce subset a DÉJÀ été importé dans un projet d'annotation (sous un autre nom potentiellement) - avertissement dès la config du nœud Annotation, avant même de lancer le graphe. Même logique que check-dataset-path (best-effort, [] si l'app ne répond pas). | `Orchestrator_App/backend/api/graphs.py:615` |
| GET | `/api/graphs/meta/check-dataset-path` | Proxy : demande à Dataset_Explorer_App si ce chemin correspond DÉJÀ à un dataset connu (sous un autre nom potentiellement) - avertissement de doublon dès la config du nœud Dataset Source, avant même de lancer le graphe. Renvoie [] si l'app n'est pas encore lancée ou ne répond pas - un check indisponible n'est pas une erreur bloquante, juste "rien à signaler pour l'instant". | `Orchestrator_App/backend/api/graphs.py:592` |
| GET | `/api/graphs/meta/download` | Sert un artefact du workspace ; les dossiers sont zippés temporairement. | `Orchestrator_App/backend/api/graphs.py:878` |
| GET | `/api/graphs/meta/explorer-subsets` | Proxy: list subsets from Dataset_Explorer_App. | `Orchestrator_App/backend/api/graphs.py:546` |
| GET | `/api/graphs/meta/inference-config` | config.yaml complet d'Inference_App (défauts + groupes + enums + clés branchées). | `Orchestrator_App/backend/api/graphs.py:521` |
| GET | `/api/graphs/meta/mlflow-summary` | SUPERVISOR : resume live du store MLflow (via MLflow_App). Le noeud mlflow n'est PAS branche : il observe. Renvoie experiments + derniers runs + meilleure metrique. | `Orchestrator_App/backend/api/graphs.py:561` |
| GET | `/api/graphs/meta/workspace-outputs` | Scan workspace dirs for existing subsets (explorer) and YOLO exports (annotation). | `Orchestrator_App/backend/api/graphs.py:659` |
| DELETE | `/api/graphs/{graph_id}` | Delete Graph | `Orchestrator_App/backend/api/graphs.py:159` |
| GET | `/api/graphs/{graph_id}` | Get Graph | `Orchestrator_App/backend/api/graphs.py:139` |
| PUT | `/api/graphs/{graph_id}` | Update Graph | `Orchestrator_App/backend/api/graphs.py:150` |
| GET | `/api/graphs/{graph_id}/artifacts` | Get Graph Artifacts | `Orchestrator_App/backend/api/graphs.py:854` |
| GET | `/api/graphs/{graph_id}/download-graph` | Download Graph | `Orchestrator_App/backend/api/graphs.py:908` |
| POST | `/api/graphs/{graph_id}/duplicate` | Duplicate Graph | `Orchestrator_App/backend/api/graphs.py:165` |
| POST | `/api/graphs/{graph_id}/dvc-commit` | Versionne dans DVC les artefacts SÉLECTIONNÉS (hub observateur, step6) et ENREGISTRE le lineage : trailers git dans le commit (Run-Id/Graph-Id/Dataset/ mAP50/MLflow-Run), persistance cote graphe (run_lineage), et back-fill des tags git_commit/dataset_version sur les runs MLflow du run. | `Orchestrator_App/backend/api/graphs.py:991` |
| POST | `/api/graphs/{graph_id}/fork-run` | Fork d'un run : duplique le graphe (memes noeuds dataset/annotation = meme subset + memes annotations, pret a re-parametrer l'entrainement) et grave la provenance du run source dans g["forked_from"]. NE declenche PAS de dvc pull / re-telechargement : le bloc forked_from ne sert qu'a la tracabilite (quelle version a servi de base). L'utilisateur ajuste ses params puis relance. | `Orchestrator_App/backend/api/graphs.py:210` |
| POST | `/api/graphs/{graph_id}/reset` | Reset Graph | `Orchestrator_App/backend/api/graphs.py:303` |
| POST | `/api/graphs/{graph_id}/resume` | Resume Graph Run | `Orchestrator_App/backend/api/graphs.py:458` |
| POST | `/api/graphs/{graph_id}/run` | Run Graph | `Orchestrator_App/backend/api/graphs.py:335` |
| GET | `/api/graphs/{graph_id}/run/{run_id}/stream` | SSE stream identique à /api/pipelines/{pid}/run/{run_id}/stream. | `Orchestrator_App/backend/api/graphs.py:350` |
| GET | `/api/graphs/{graph_id}/runs/{run_id}/manifest` | Index canonique d'un run, sans aucun fallback vers un autre run. | `Orchestrator_App/backend/api/graphs.py:868` |
| POST | `/api/graphs/{graph_id}/stop` | Arrête un run en cours (ou coincé sur un gate). Garde-fou anti-blocage : fonctionne même si le run n'est plus en mémoire (serveur redémarré) - le graphe est alors juste remis dans un état terminal 'stopped'. | `Orchestrator_App/backend/api/graphs.py:309` |
| POST | `/api/graphs/{graph_id}/track-mlops` | Promeut un graphe "experimental" en "mlops" en injectant la PAIRE couplee MLflow + DVC manquante (nodes FREE, aucune arete). Idempotent : n'ajoute que ce qui manque. Ne lance rien, ne versionne rien - l'utilisateur committe ensuite via le node DVC. Renvoie le graphe mis a jour avec son type derive recalcule. | `Orchestrator_App/backend/api/graphs.py:257` |
| POST | `/api/graphs/{graph_id}/webhook/annotation-exported` | Annotation_App calls this endpoint when the user completes an export. Auto-resumes the graph pipeline if it is waiting at the annotation human gate. | `Orchestrator_App/backend/api/graphs.py:1103` |

### health

| Method | Path | Summary | Source |
|---|---|---|---|
| GET | `/api/health` | Health | `Orchestrator_App/backend/api/health.py:12` |

### insights

| Method | Path | Summary | Source |
|---|---|---|---|
| GET | `/api/insights` | List Insights | `Orchestrator_App/backend/api/insights.py:23` |
| POST | `/api/insights/{graph_id}/generate` | Generate Insights | `Orchestrator_App/backend/api/insights.py:51` |
| DELETE | `/api/insights/{graph_id}/{run_id}` | Delete Insights | `Orchestrator_App/backend/api/insights.py:45` |
| GET | `/api/insights/{graph_id}/{run_id}` | Get Insights | `Orchestrator_App/backend/api/insights.py:28` |
| GET | `/api/insights/{graph_id}/{run_id}/plot/{name}` | Get Plot | `Orchestrator_App/backend/api/insights.py:36` |

### launcher

| Method | Path | Summary | Source |
|---|---|---|---|
| GET | `/api/apps` | Status de toutes les sous-apps (connues + sessions actives). | `Orchestrator_App/backend/api/launcher_api.py:45` |
| POST | `/api/apps/launch` | Launch App | `Orchestrator_App/backend/api/launcher_api.py:117` |
| POST | `/api/apps/launch-all` | Lance toutes les sous-apps qui ne sont pas encore actives. | `Orchestrator_App/backend/api/launcher_api.py:166` |
| POST | `/api/apps/stop-all` | Arrête toutes les sous-apps actives. | `Orchestrator_App/backend/api/launcher_api.py:199` |
| POST | `/api/apps/{app_id}/stop` | Stop App | `Orchestrator_App/backend/api/launcher_api.py:156` |

### lineage

| Method | Path | Summary | Source |
|---|---|---|---|
| GET | `/api/lineage` | Nodes + edges du lineage a travers TOUS les graphes. | `Orchestrator_App/backend/api/lineage.py:231` |

### main

| Method | Path | Summary | Source |
|---|---|---|---|
| GET | `/api/workspace/history` | Retourne l'historique des workspaces (seulement les dossiers encore existants). Chaque entree: {"path": str, "user": str}. | `Orchestrator_App/backend/main.py:168` |
| POST | `/api/workspace/open` | Ouvre un dossier dans l'explorateur OS. path optionnel = dossier specifique. | `Orchestrator_App/backend/main.py:145` |
| GET | `/api/workspace/users` | Workspace Users | `Orchestrator_App/backend/main.py:120` |
| GET | `/health` | Root Health | `Orchestrator_App/backend/main.py:115` |

### pipelines

| Method | Path | Summary | Source |
|---|---|---|---|
| GET | `/api/pipelines` | List Pipelines | `Orchestrator_App/backend/api/pipelines.py:33` |
| POST | `/api/pipelines` | Create Pipeline | `Orchestrator_App/backend/api/pipelines.py:38` |
| DELETE | `/api/pipelines/{pid}` | Delete Pipeline | `Orchestrator_App/backend/api/pipelines.py:62` |
| GET | `/api/pipelines/{pid}` | Get Pipeline | `Orchestrator_App/backend/api/pipelines.py:46` |
| PUT | `/api/pipelines/{pid}` | Update Pipeline | `Orchestrator_App/backend/api/pipelines.py:54` |
| POST | `/api/pipelines/{pid}/run` | Start Run | `Orchestrator_App/backend/api/pipelines.py:73` |
| GET | `/api/pipelines/{pid}/run/{run_id}/stream` | Stream Run | `Orchestrator_App/backend/api/pipelines.py:84` |
| GET | `/api/pipelines/{pid}/status/{run_id}` | Get Run Status | `Orchestrator_App/backend/api/pipelines.py:103` |

### plans

| Method | Path | Summary | Source |
|---|---|---|---|
| GET | `/api/plans` | List Plans | `Orchestrator_App/backend/api/plans.py:28` |
| POST | `/api/plans` | Create Plan | `Orchestrator_App/backend/api/plans.py:33` |
| DELETE | `/api/plans/{plan_id}` | Delete Plan | `Orchestrator_App/backend/api/plans.py:54` |
| GET | `/api/plans/{plan_id}` | Get Plan | `Orchestrator_App/backend/api/plans.py:38` |
| PUT | `/api/plans/{plan_id}` | Update Plan | `Orchestrator_App/backend/api/plans.py:46` |
| POST | `/api/plans/{plan_id}/run` | Run Plan | `Orchestrator_App/backend/api/plans.py:60` |
| GET | `/api/plans/{plan_id}/status` | Plan Status | `Orchestrator_App/backend/api/plans.py:72` |

### settings

| Method | Path | Summary | Source |
|---|---|---|---|
| GET | `/api/settings` | Get Settings | `Orchestrator_App/backend/api/settings.py:55` |
| PUT | `/api/settings` | Update Settings | `Orchestrator_App/backend/api/settings.py:60` |
<!-- generated:end -->
