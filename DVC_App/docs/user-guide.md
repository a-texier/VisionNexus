---
app: dvc
doc_type: user-guide
audience: user
lang: en
title: User guide
order: 10
tags: [lineage, datasets, history, diff, sync, doc page, repo status]
sources: [DVC_App/frontend/src/App.tsx, DVC_App/frontend/src/pages/LineagePage.tsx, DVC_App/frontend/src/pages/DatasetsPage.tsx, DVC_App/frontend/src/pages/HistoryPage.tsx, DVC_App/frontend/src/pages/DiffPage.tsx, DVC_App/frontend/src/pages/SyncPage.tsx, DVC_App/frontend/src/pages/DocPage.tsx, DVC_App/frontend/src/components/UserBadge.tsx]
---

# User guide

## Sidebar and navigation of DVC App

The sidebar on the left of DVC App is always visible. Under the app title, a repository status block shows whether the repository exists (a green check or a red cross) and the current Git branch; clicking the status line expands a small panel with the exact repository path, and, once it exists, whether Git and DVC are initialized and which remotes are configured. Four entries follow: **Lineage** (the home page), **Diff**, **Sync** and **Doc**. Two more pages exist without a sidebar entry: **Datasets** (`/datasets`) and **Historique** (`/history`, reachable from a run's Lineage panel); reach either by typing its URL directly.

The user badge at the bottom shows the user name given by the launcher and four controls: **Open workspace** opens the workspace folder in the file explorer of the machine that runs the backend, **Workspace history** lists the recent workspaces of this app, **Connected users** lists the other users running DVC App on the same machine, and the language toggle switches between English and French. When the app is opened from VisionNexus, VisionNexus imposes the language.

## Lineage page

The Lineage page is the home page. It builds a graph from the Orchestrator's canonical lineage endpoint, combined with the Git commits of the current repository, and shows: a shared source dataset, one frame per pipeline run (a fork drawn with a dashed rose border, a parent run with a dashed sky border), the subset each run used, and, for each run, its Git/DVC version node (the commit that versioned it, or "not versioned" if none exists yet) followed by the individual tracked objects (datasets, models, artifacts) that commit's `.dvc` files point to.

Toolbar controls: the search box filters by name, run id or dataset; **Compact/Décompact** collapses or expands every run's produced objects at once, and a chevron on a single run frame does the same for that run only; the list/graph toggle switches to a flat card view of the same data; **Comparer les runs** opens the Orchestrator's own lineage page. Click a run frame's header to open its Insight (a chart icon) or Sandgraph (a network icon) view in the Orchestrator App. Click any node to open its detail panel on the right, which shows the MLOps run id and buttons to MLflow's lineage view, the Orchestrator's Insight and Sandgraph, and, for a version node, links straight into **Historique** (filtered to that run) and **Diff** (pre-filled with that commit against its parent).

## Datasets page

The Datasets page (`/datasets`, no sidebar link) lists every file or folder currently tracked by DVC in the repository: its type (folder or file icon), its path, the `.dvc` pointer file that tracks it, its size, its hash (`md5`, first 8 characters) and a status badge (`unchanged`, `modified`, `missing`, `new`). A banner above the table summarizes the repository state: a red banner if the status could not be read, an amber banner with counts if any file is modified or missing, or a green "all synchronized" banner otherwise.

## Historique (history) page

The History page shows a vertical timeline of Git commits that touched at least one `.dvc` file, newest first, each with its short hash, author, a relative time ("2h ago"), and its lineage chips when the commit carries them: **Dataset** (green), **Run** (amber, the Orchestrator run id), **mAP50** (blue), and a count of MLflow runs. Click a commit to expand the list of `.dvc` files it changed. Each commit row also has a **Diff** button (opens the Diff page comparing this commit to its parent) and a **Restaurer** (Restore) button, which asks for confirmation before checking out that commit's exact state into the working directory.

## Diff page

The Diff page compares two revisions. Type or pick, from the two dropdowns fed by the commit history, a **Révision A (base)** and a **Révision B (cible)** (hash, `HEAD`, `HEAD~1`, or a tag), then click **Calculer le diff**. A **Résumé métier** (business summary) appears first: counts of images added and deleted, and of annotation files changed, plus, when revision B is a known commit, an **Utilisé par** line naming the Orchestrator run and MLflow runs that used that version, read from the commit's own trailers rather than guessed. Below it, the full file-by-file table lists every added, deleted, modified and renamed path with its hash.

## Sync page

The Sync page runs `dvc push` and `dvc pull`. An explanation block at the top states what each does and shows the configured remote's name and destination; if none is configured, a small form (**Nom**, **Destination**) lets you add one directly, a local folder path or a URL such as `s3://...`, without any command line. Two side-by-side cards, **DVC Push** and **DVC Pull**, each have their own **Push**/**Pull** button, a live scrolling log of the underlying command's output, and an **Annuler** (Cancel) button that appears while the command runs. A **Stockage (dé-duplication)** panel at the bottom, computed on demand (**Calculer l'usage disque**), shows the cache size versus the working directory size and whether the cache is in copy mode or linked mode, with a **Re-lier au cache** button to switch existing files to links retroactively.

## Doc page

The Doc page is a short, suite-specific explanation of how DVC is actually used here, distinct from the Orchestrator's general MLOps guide (Git vs DVC vs MLflow). It covers what each of the four pages actually shows, when to push versus pull, and a worked example tracing one commit from its hash through its lineage trailers to the exact dataset and model version it represents. Read it once when you join a project that already uses the suite's Orchestrator, since the trailer names it introduces are used throughout Lineage, History and Diff without being re-explained there.
