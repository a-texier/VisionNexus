---
app: dvc
doc_type: code-map
audience: dev
lang: en
title: Code map
order: 80
tags: [code navigation, backend, frontend, lineage, extension]
sources: [DVC_App/backend/main.py, DVC_App/backend/core/dvc_runner.py, DVC_App/frontend/src/App.tsx, DVC_App/frontend/src/pages/LineagePage.tsx, DVC_App/frontend/src/i18n/translate.ts]
---

# Code map

## Where to start reading the backend code

The backend of DVC App is in `DVC_App/backend/`. Read these files in this order to understand it:

1. `main.py`: the entry point. The lifespan logs whether the repository exists at startup; the routers are mounted here; `/health` and the workspace helpers are defined here.
2. `config.py`: the workspace, `DVC_REPO_PATH`, the ports and the CORS origins.
3. `core/dvc_runner.py`: every `git`/`dvc` subprocess call goes through `_run()` here; read this file to understand what the app can actually do to a repository.
4. `api/orchestrator.py`: `commit_data()`, the one function that creates commits, including the artifact-copying and trailer-message logic.
5. `api/datasets.py`, `api/commits.py`, `api/sync.py`: the read-mostly routers for the Datasets, History/Diff and Sync pages, each a thin layer over `dvc_runner.py`.

Outside `backend/`, `Orchestrator_App/backend/api/graphs.py::dvc_commit_selected()` is the code that actually builds the lineage-trailer `message` this app's commit endpoint receives; read it alongside `api/orchestrator.py` to understand the full commit flow end to end.

## Where to start reading the frontend code

The frontend is a Vite/React app in `DVC_App/frontend/src/`. Start with `App.tsx` for the route list, the sidebar repository status, and the two orphan routes (`/datasets`, `/history`) that exist without a sidebar link, then `pages/LineagePage.tsx` (the home page, wrapped in its own error boundary, combining this app's own commit history with the Orchestrator's canonical graph), and `pages/DiffPage.tsx`/`pages/SyncPage.tsx` for the two remaining sidebar pages. `api/client.ts` is the single place that calls this app's own backend; `types/api.ts` mirrors its Pydantic response shapes, including `CommitLineage` for the parsed trailer fields.

## Where to change the lineage trailer format

The trailer keys written into a commit message (`Run-Id`, `Graph-Id`, `Graph-Name`, `Parent-Run`, `Dataset`, `mAP50`, `MLflow-Run`) are assembled in `Orchestrator_App/backend/api/graphs.py::dvc_commit_selected()`, not in this app. The parser that reads them back is `DVC_App/backend/core/dvc_runner.py::_parse_trailers()`; both sides must agree on the exact key spelling (case-insensitive, but the separator characters `_RS`/`_US`/`_GS` used by `get_git_log()`'s custom `git log` format are fixed and must not collide with characters that could appear inside a trailer value). Add a new trailer by adding it on both sides and to the `CommitLineage` TypeScript type.

## Where to change what gets versioned from the Orchestrator

`backend/api/orchestrator.py::commit_data()`'s `_copies` list (built from `body.dataset_path`, `body.model_path`, `body.annotations_path`, `body.metrics_path`) is where a new artifact kind would be added, each entry a `(subfolder_name, source_path)` pair copied into the repository then `dvc add`-ed. `graph_json` and `params_json` are handled separately since they are written as plain JSON rather than through `dvc add`; follow that same plain-JSON pattern for a new artifact kind that should stay human-diffable in Git rather than tracked as binary content. Update the trailer format alongside a new kind if it should also be traceable back to a run on the Lineage and Diff pages.

## Where to change the Lineage graph layout

Everything is in `frontend/src/pages/LineagePage.tsx::build()`: it turns the Orchestrator's `{nodes, edges}` payload plus this app's own commit list into ReactFlow `nodes`/`edges` arrays, matching commits to runs via `commitByRun` (keyed by each commit's `lineage.run_id`). Add a new node kind by extending the `Kind` union and the `META` record (title, CSS class, minimap color) at the top of the file, then a case in `build()` that pushes a positioned node for it. The list view rendered when the graph/list toggle is off reads the same `flow.runs` data structure, so a new node kind usually needs a small addition there too.

## Where to change cache behavior

`configure_cache_links()`, `relink_cache()` and `get_disk_usage()` in `backend/core/dvc_runner.py` are the three functions that touch DVC's cache configuration and measurement. Changing the `cache.type` value passed to `dvc config` changes which link strategy DVC prefers (`reflink,hardlink,copy` tries each in order); keep `cache.protected true` alongside any change, since it is what keeps shared-inode cache entries from being mutated through one of their links. Both functions are idempotent and safe to call on a repository that already has links configured, which is why `configure_cache_links()` runs unconditionally on every commit rather than only once at repository creation.

## Where to change help and translations

This documentation's pages live in `DVC_App/docs/`, served by `backend/api/docs.py` and rendered by `frontend/src/components/docs/MarkdownDoc.tsx` on `frontend/src/pages/DocPage.tsx` (distinct from the suite-specific explanatory content also named `DocPage.tsx` before this documentation set existed; the route `/doc` now serves this rendered markdown instead). French strings are the source of truth in the code; add their English translation to the `EXACT_EN` dictionary in `frontend/src/i18n/translate.ts` (exact match) or to `PHRASE_EN` (substring, for dynamically built strings). The original explanatory content stays in the git history if it needs to be recovered.

## Debugging tools

- `GET /health` and `GET /api/orchestrator/status` are the two fastest checks of repository state without opening a terminal on the backend machine.
- `.dvc/config` and `.dvc/config.local`, read directly by `get_remotes()`, can also be inspected by hand to debug a remote that does not appear in the Sync page.
- The `git log --format=... --name-only` command built by `get_git_log()` can be run directly in the repository to debug a trailer parsing issue independently of this app's Python code.
- `GET /api/disk-usage` is a good check of whether cache linking is active before assuming a large working directory is genuinely using that much disk space.

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
| `commits.py` |  | `list_commits`, `dvc_diff`, `CheckoutBody`, `dvc_checkout` |
| `datasets.py` |  | `list_datasets`, `dvc_status`, `current_branch` |
| `docs.py` |  | `parse_frontmatter`, `load_doc_set`, `doc_path`, `read_doc`, `safe_asset_path`, `list_docs`, `get_doc_asset`, `get_doc` |
| `orchestrator.py` |  | `CommitRequest`, `commit_data`, `get_status` |
| `settings.py` |  | `AppSettings`, `load_settings`, `get_settings`, `update_settings` |
| `sync.py` |  | `list_remotes`, `AddRemoteBody`, `create_remote`, `disk_usage`, `relink`, `dvc_push`, `dvc_pull` |

### backend/core

| File | Description | Exports |
|---|---|---|
| `dvc_runner.py` |  | `repo_exists`, `get_status`, `get_git_log`, `configure_cache_links`, `relink_cache`, `add_remote`, `get_disk_usage`, `get_remotes`, `get_diff`, `checkout`, `list_tracked_files`, `get_current_branch` |

### frontend/src

| File | Description | Exports |
|---|---|---|
| `App.tsx` | App.tsx - Routing + sidebar avec indicateur repo + branche | `App` |
| `main.tsx` |  |  |

### frontend/src/api

| File | Description | Exports |
|---|---|---|
| `client.ts` | api/client.ts - axios + SSE helper | `BACKEND_BASE`, `datasetsAPI`, `repoAPI`, `commitsAPI`, `settingsAPI`, `startSync`, `docsAPI` |

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
| `useCommits.ts` |  | `useCommits`, `useInvalidateCommits` |
| `useDatasets.ts` |  | `useDatasets`, `useDVCStatus`, `useBranch`, `useInvalidateDatasets` |

### frontend/src/i18n

| File | Description | Exports |
|---|---|---|
| `translate.ts` | Traduction FR -> EN a l'affichage. Le francais reste la source de | `getLang`, `setLang`, `subscribeLang`, `isDesktopPiloted`, `initWorkspaceLanguage`, `setLangAndMaybePersist`, `t` |
| `useLang.ts` |  | `useLang`, `useT` |

### frontend/src/pages

| File | Description | Exports |
|---|---|---|
| `DatasetsPage.tsx` | Fichiers DVC trackés avec taille, statut badge. | `DatasetsPage` |
| `DiffPage.tsx` | Sélection de 2 versions, diff DVC affiché. | `DiffPage` |
| `DocPage.tsx` | Page Doc : rend les pages markdown de DVC_App/docs/ servies | `DocPage` |
| `HistoryPage.tsx` | Historique git-style des commits touchant des fichiers DVC. | `HistoryPage` |
| `LineagePage.tsx` |  | `LineagePage` |
| `SyncPage.tsx` | Push/pull DVC avec log SSE en temps réel. | `SyncPage` |

### frontend/src/types

| File | Description | Exports |
|---|---|---|
| `api.ts` | types/api.ts - miroir exact des schémas Pydantic backend |  |
<!-- generated:end -->
