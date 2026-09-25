---
app: mlflow
doc_type: user-guide
audience: user
lang: en
title: User guide
order: 10
tags: [lineage, model registry, compare, run detail, experiments, doc page]
sources: [MLflow_App/frontend/src/App.tsx, MLflow_App/frontend/src/pages/LineagePage.tsx, MLflow_App/frontend/src/pages/ModelRegistryPage.tsx, MLflow_App/frontend/src/pages/CompareRunsPage.tsx, MLflow_App/frontend/src/pages/RunDetailPage.tsx, MLflow_App/frontend/src/pages/ExperimentsPage.tsx, MLflow_App/frontend/src/pages/DocPage.tsx, MLflow_App/frontend/src/components/UserBadge.tsx]
---

# User guide

## Sidebar and navigation of MLflow App

The sidebar on the left of MLflow App is always visible. Under the app title, a status dot and text show whether the MLflow store is reachable ("MLflow x.y.z" in green) or not ("MLflow off" in red), refreshed every 15 seconds. Four entries follow: **Lineage** (the home page), **Model Registry**, **Comparer** and **Doc**. A fifth page, **Experiments**, exists at `/experiments` but has no sidebar entry; reach it by typing the URL directly, or through a run's page when you need the classic experiment-first browsing instead of the pipeline-first Lineage view.

The user badge at the bottom shows the user name given by the launcher and four controls: **Open workspace** opens the workspace folder in the file explorer of the machine that runs the backend, **Workspace history** lists the recent workspaces of this app, **Connected users** lists the other users running MLflow App on the same machine, and the language toggle switches between English and French. When the app is opened from VisionNexus, VisionNexus imposes the language.

## Lineage page

The Lineage page is the home page. It builds a graph from the Orchestrator's canonical lineage endpoint, combined with the runs of the current store, and shows: a shared source dataset, one frame per pipeline run (a fork drawn with a dashed rose border, a parent run with a dashed sky border), the subset each run used, and the MLflow stages produced by that run, each carrying its role badge and a few metrics.

Toolbar controls: the search box filters by name, run id or dataset; **Compact/Décompact** collapses or expands every run's stages at once, and a chevron on a single run frame does the same for that run only; the list/graph toggle switches to a flat card view of the same data, useful when the graph is crowded; **Comparer les runs** opens the Orchestrator's own lineage page.

Click a run frame's header to open its Insight (a chart icon) or Sandgraph (a network icon) view in the Orchestrator App. Click any node (the source dataset, a subset, a run, a stage) to open its detail panel on the right: it shows the MLOps run id, and buttons to MLflow's own compare view, the Orchestrator's Insight and Sandgraph, and, for a stage, a link straight into that stage's [run detail page](#run-detail-page) of this app.

## Model Registry page

The Model Registry page lists every registered model, refreshed with a manual refresh button (no auto-refresh). Each model row shows its name, a badge per known stage among its latest versions, and its last update date; clicking it expands the full version table for that model.

The version table's columns are **Version**, **Dataset** (the dataset tag recorded at registration), **mAP50**, **Stage**, **Run** (a link to the [run detail page](#run-detail-page) that produced this version, when known), **Créé le**, and **Transition**: one button per possible stage (`None`, `Staging`, `Production`, `Archived`). Click a stage to move the version there immediately; the current stage's button is disabled. A model name that ends with a project prefix (for example `<project>/yolox-s`) means every version under that name is a successive training of the same model within that project, not unrelated models.

## Comparer (compare runs) page

The Comparer page selects runs by experiment rather than through the pipeline graph. Step 1 picks an **experiment** from a dropdown; step 2 lists its runs in a table with a checkbox per row, its status badge and its first metrics, and a counter of how many are selected. Rows are clickable anywhere, not only on the checkbox.

**Comparer N run(s)** requires at least 2 and at most 10 selected runs. Once it runs, step 3 shows one line chart per metric (a dropdown narrows to a single metric when several are available, each run drawn in a distinct color with a legend) and a table of every parameter value across the selected runs, with a dash where a run does not have that parameter.

## Run detail page

Opened from any run row across the app (`/runs/{runId}`), this page shows: the run name and id, its status badge, start time, duration and experiment id; a **Lineage** section with the suite's own tags when present (`orch_run_id`, `graph_id`, `git_commit`, `dataset_version`, `node_label`, `stage`); one chart per metric that has a recorded history over training steps; a grid of the final metric values; a table of every parameter; a gallery of the training plots the engine attached under its `plots/` artifact folder, when any; and a table of every artifact with its type and size.

## Experiments page

The Experiments page (`/experiments`, no sidebar link) lists every experiment with its id and creation date, and lets you create one (**Nouvelle expérience**, name only) or delete one. Expanding an experiment shows its runs ordered as a fork tree: a run whose `fork_parent_run` tag matches another run's `orch_run_id` is indented under its parent with a fork icon, so a pipeline that was forked in the Orchestrator reads as a tree here instead of a flat list. Each row shows the run's **Rôle** badge (Training, Evaluation, Inference or HPO, from its `run_type` tag), its **ID unifié** (the first 8 characters of `orch_run_id`), status, start date and first metrics; click a row to open its [run detail page](#run-detail-page).

## Doc page

The Doc page is a short, suite-specific explanation of how MLflow is actually used here, distinct from the Orchestrator's general MLOps guide (Git vs DVC vs MLflow). It covers the serverless SQLite store, what Comparer and the Model Registry are for, the naming and lineage tag convention applied to Orchestrator runs (`graph_id/NodeLabel`, tags `orch_run_id`, `graph_id`, `git_commit`, `dataset_version`), and a worked example tracing one run from its id through its Git commit to its dataset version. Read it once when you join a project that already uses the suite's Orchestrator, since the tag names it introduces are used throughout Lineage, Experiments and the run detail page without being re-explained there.
