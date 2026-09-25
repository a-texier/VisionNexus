---
app: dvc
doc_type: architecture
audience: dev
lang: en
title: Architecture
order: 60
tags: [fastapi, subprocess, git, dvc cli, cache linking, lineage trailers, sse]
sources: [DVC_App/backend/main.py, DVC_App/backend/config.py, DVC_App/backend/core/dvc_runner.py, DVC_App/backend/api/orchestrator.py, DVC_App/backend/api/sync.py, DVC_App/backend/api/commits.py, DVC_App/backend/api/datasets.py, Orchestrator_App/backend/api/graphs.py, DVC_App/frontend/src/pages/LineagePage.tsx]
---

# Architecture

## Components overview of DVC App

DVC App is a FastAPI backend that wraps the `git` and `dvc` command-line tools in subprocesses, turning their text and JSON output into structured responses, plus a Vite/React frontend. It has no database of its own: the Git + DVC repository at `DVC_REPO_PATH` is the entire source of truth, and every read re-runs the matching `git`/`dvc` command against it rather than caching state in the backend process.

Like Optuna App, DVC App exposes an `orchestrator.py` router and genuinely participates in pipeline runs, but not as a linear pipeline stage: `graph_runner.py` treats a `dvc` node type as generating zero pipeline steps (`return []`), the same as `mlflow`. It is a hub, not an edge: the Orchestrator's own commit endpoint calls this app's `POST /api/orchestrator/commit` on demand from the DVC node's UI, not automatically at a fixed point in the graph.

## The subprocess wrapper: `_run()` and the `dvc` PATH workaround

`backend/core/dvc_runner.py::_run()` is the single choke point every backend function goes through to call `git` or `dvc`: it takes an argument list, substitutes `sys.executable -m dvc` for a leading bare `dvc` (see *Invariants*, below), runs `subprocess.run(..., cwd=DVC_REPO_PATH, capture_output=True, text=True, encoding="utf-8")`, and raises `RuntimeError(stderr)` on a non-zero exit code unless `check=False` was passed. Every higher-level function in this file (`get_status`, `get_git_log`, `get_diff`, `checkout`, `list_tracked_files`, `get_remotes`, `add_remote`, `get_disk_usage`) is a thin layer of parsing on top of one or more `_run()` calls, none of it stateful between calls.

`repo_exists()` checks for both a `.git` and a `.dvc` subfolder under `DVC_REPO_PATH`; every route-level function that touches the repository calls it first and raises a 503 "Repo DVC non trouvé" if false, rather than letting a `git`/`dvc` call against a non-existent repository fail with a less legible error.

## Commit creation and lineage trailers (orchestrator.py)

`POST /api/orchestrator/commit` (`backend/api/orchestrator.py::commit_data()`) is the only endpoint that creates a commit, and it is designed to be safe to call repeatedly with the same or a different selection of artifacts:

1. It first verifies the repository is a *valid* Git repository, not just that `.git` exists: `git rev-parse --is-inside-work-tree` catches a partially-deleted `.git` folder (objects present, `HEAD`/`refs` missing) that would otherwise pass a naive existence check and then fail every subsequent commit silently. A broken `.git` is removed and re-initialized rather than left to fail again.
2. For each requested artifact kind (`dataset_path`, `model_path`, `annotations_path`, `metrics_path`), it copies the source into `<sub>/<name>` of the repository, hardlinking each file (`os.link`, falling back to `copy2` across devices) rather than copying, so that with the cache also in linked mode, source, working copy and cache end up sharing the same inode, then runs `dvc add` on it. A `.zip` source (Annotation App's export format) is auto-extracted first.
3. `body.graph_json` and `body.params_json`, when present, are written directly as plain JSON files under `graphs/` and `params/` and `git add`-ed, never passed through `dvc add`: they are small and meant to be human-diffable in Git history.
4. The commit message is built from `body.message` plus a block of trailers (`Run-Id`, `Graph-Id`, `Graph-Name`, `Parent-Run`, `Dataset`, `mAP50`, one `MLflow-Run` line per matching run) assembled by the *caller*, `Orchestrator_App/backend/api/graphs.py::dvc_commit_selected()` : this endpoint itself does not know about runs, graphs or MLflow; it only accepts an already-formatted `message` string.
5. Before committing, it diffs `git status --porcelain`; if empty, it returns `{"ok": true, "skipped": true, ...}` without creating an empty commit : a deliberate no-op, not an error path.

## Parsing lineage trailers back out (dvc_runner.py)

`get_git_log()` reads history with a custom `git log` format that opens each commit with an ASCII Record Separator, separates fields with a Unit Separator, and appends `%(trailers:unfold,separator=<GS>)` : chosen because trailer values never contain newlines, making this format immune to the embedded-newline parsing bugs a naive line-based approach would hit. `_parse_trailers()` splits on the Group Separator and lowercases each `Key: Value` pair into the `CommitLineage` shape the frontend expects (`run_id`, `graph_id`, `graph_name`, `dataset`, `map50`, `mlflow_runs: []`, `parent_run_id`). When a commit's trailers name a `graph_id` but not a `graph_name`, `get_git_log()` makes one extra lookup into `graphs/<graph_id>.json` (written by step 3 above, when that commit also versioned a graph snapshot) to recover a human-readable name.

## Cache linking, disk usage and remotes

`configure_cache_links()` sets `dvc config cache.type reflink,hardlink,copy` (DVC tries each in order, falling back to a real copy only if neither link type is available on the filesystem) and `cache.protected true` (link-based cache entries become read-only, since a shared inode must never be mutated by one of its links) : applied idempotently on every commit that touches DVC, so it also self-heals a repository that predates this setting. `relink_cache()` re-runs `dvc checkout --relink` to retroactively convert an already-copied working directory to links, for repositories that had files added before linking was configured. `get_disk_usage()` computes real byte sizes by walking `.dvc/cache` and `datasets/`+`models/` with `Path.rglob`, which is a genuinely slow, on-demand operation for large repositories : deliberately not run automatically, only from the Sync page's explicit button.

`get_remotes()` does not shell out to `dvc remote list`; it parses `.dvc/config` and `.dvc/config.local` directly with a regex, which is more robust against Windows path quoting and inconsistent tab/space formatting than parsing CLI output would be. `add_remote()` is the one write path here that also touches the filesystem directly (creating a local folder destination) before calling `dvc remote add -f`.

## Push/pull streaming (sync.py)

`POST /api/push` and `POST /api/pull` return a `StreamingResponse` over `_run_and_stream()`, an async generator that launches `dvc push`/`dvc pull` with `asyncio.create_subprocess_exec` (not the synchronous `_run()` used elsewhere, since this needs to stream output line by line as it happens rather than wait for completion) and yields one SSE `log` event per line of combined stdout/stderr. It pre-flight-checks `get_remotes()` before starting the subprocess at all, emitting a single clear `error` event instead of letting `dvc` fail with a less legible message when no remote exists.

## Frontend structure and the Lineage graph

`frontend/src/App.tsx` is a single sidebar layout with seven routes: `/` and `/lineage` (`LineagePage`), `/datasets` (`DatasetsPage`, reachable but not in the sidebar), `/history` (`HistoryPage`, reachable but not in the sidebar, linked from Lineage's detail panel), `/diff` (`DiffPage`), `/sync` (`SyncPage`) and `/doc` (`DocPage`). `api/client.ts` holds every typed call to this app's own backend; `LineagePage.tsx` additionally calls the Orchestrator directly through `axios` at `/orchestrator-api/lineage` and `/orchestrator-api/apps`.

`LineagePage.tsx` wraps its graph in a `LineageErrorBoundary` React error boundary (unusual among the suite's Lineage pages), since a malformed trailer or an unexpected node shape from the Orchestrator's canonical payload would otherwise crash the whole page rather than degrade to an error message. `build()` merges the Orchestrator's `{nodes, edges}` payload with this app's own `commitsAPI.list(200)` (matched to runs by their `lineage.run_id` trailer, via `commitByRun`) to attach a version node and its tracked objects onto each run's frame.

## Invariants that must not be broken

- **Never call the bare `dvc` executable.** `core/dvc_runner.py::_run()` and `api/sync.py::_dvc_args()` both rewrite a leading `dvc` argument to `sys.executable -m dvc`, because the backend is launched without the conda environment's `Scripts/`/`bin/` folder on its `PATH`. Reverting either substitution reintroduces "commande introuvable" failures identical to those documented for MLflow App's own analogous fix.
- **Cache linking must stay idempotent and safe to re-apply.** `configure_cache_links()` runs on every commit that touches DVC precisely so a repository is self-healing; it must never assume it runs exactly once.
- **Lineage trailers are written once, by the caller, never reconstructed.** `commit_data()` accepts an already-built `message` string; it must not start guessing or synthesizing trailer values itself, and `dvc_runner.py`'s trailer parser must not paper over an absent trailer with a default value, since [Concepts](concepts.md) documents that absence as meaningful.
- **An empty `git status --porcelain` must short-circuit to a skipped, non-error result.** Treating "nothing to commit" as a failure would make the Orchestrator's DVC node unusable for the common case of re-running a commit action on an already-versioned artifact.
- **The Lineage page's error boundary must stay in place.** Removing it reintroduces a whole-page crash risk from any Orchestrator payload shape this app was not updated to expect yet.
