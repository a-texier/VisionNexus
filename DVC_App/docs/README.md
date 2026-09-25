---
app: dvc
doc_type: readme
audience: both
lang: en
title: DVC App
order: 0
tags: [dvc, git, dataset versioning, lineage, remote, push, pull]
sources: [DVC_App/backend/main.py, DVC_App/launcher.py, _lib/launcher_engine.py, DVC_App/frontend/src/App.tsx]
---

# DVC App

## What DVC App does

DVC App is the dataset and model versioning tool of the Computer Vision suite. It gives a web interface to a plain Git + DVC (Data Version Control) repository: which files are tracked, what changed between two commits, and how to push or pull the actual content to and from a remote.

Git alone only stores small pointer files (`.dvc` files); the real content of a dataset or a model's weights lives in DVC's own cache and, optionally, on a remote. DVC App makes that split visible and operable from a browser, without any command line:

- **Lineage** shows every pipeline run of the suite as a graph or a list, from its source dataset through the Git/DVC version it produced to the objects that version tracks, with links out to the matching MLflow run and Orchestrator run.
- **Datasets** (reachable at `/datasets`, not in the sidebar) lists every file or folder DVC currently tracks in the repository, with its size, its hash and whether it is up to date, modified, or missing on disk.
- **Historique** (History, reachable from a run's Lineage panel, not in the sidebar) is a timeline of Git commits that touched a `.dvc` file, each one readable as a dataset or model version, with the run and metric that produced it when the Orchestrator recorded them.
- **Diff** compares two revisions: which files were added, deleted, modified or renamed, with a plain-language summary before the file-by-file detail.
- **Sync** runs `dvc push` and `dvc pull` against a configured remote, with a live log, and shows how much disk space the local cache actually uses.
- **Doc** explains, inside the app, how DVC is actually used in this suite, distinct from the Orchestrator's general MLOps guide.

DVC App never creates a dataset or a model by itself. It versions what other apps produce: an export from Annotation App, a trained model from Training App, a best-parameters file from Optuna App, or a full pipeline snapshot from the Orchestrator.

## Place of DVC App in the suite pipeline

DVC App is a versioning hub, not a pipeline stage with its own input and output:

1. **Annotation App** exports an annotated dataset, **Training App** trains a model from it and logs the run to **MLflow App**, and **Optuna App** may have searched its hyperparameters first.
2. From the Orchestrator's DVC node, you choose which of these artifacts to version: the dataset, the model weights, the annotations, run metrics, the best Optuna parameters, and a full snapshot of the pipeline graph.
3. DVC App copies the chosen artifacts into its own repository, tracks them with `dvc add`, and commits them with Git, writing lineage trailers into the commit message (which run, which graph, which dataset, the resulting mAP50, the matching MLflow run ids).
4. It then tags the matching MLflow run with the resulting Git commit hash and dataset version, closing the lineage loop shown on the Lineage page of this app and of MLflow App.
5. **Sync** later pushes that commit's content to a remote so it can be pulled on another machine (a GPU VM, a colleague's workstation) to reproduce the exact same run.

In an Orchestrator pipeline, a DVC node has no incoming edge and generates no pipeline step of its own: it is an observer of the whole graph, and you decide from its hub what to version, when. DVC App is still auto-launched whenever a DVC node exists, so the hub has an app to talk to.

Each user has an isolated repository: `dvc_<user>/repo/`, inside that user's own workspace. See [Configuration](configuration.md) for the exact layout.

## Quick start in five steps

This quick start assumes at least one pipeline run has produced a dataset and, ideally, a trained model, and that DVC App is launched from VisionNexus or with `python launcher.py --app dvc --workspace <root> --user <name>` from the suite root.

1. Open DVC App: the **Lineage** page loads and shows the runs of the current user's repository as a graph, with an amber warning if the repository does not exist yet (it is created automatically on the first commit).
2. From the Orchestrator's DVC node (or from an Orchestrator pipeline run), select the artifacts to version and commit: the repository is initialized if needed and the commit is created.
3. Back in DVC App, open a run's version node on Lineage and follow its **Historique** link to see the new commit with its lineage chips (dataset, run, mAP), or navigate directly to `/datasets` to see the newly tracked files.
4. Open **Diff**, pick that commit and its parent, to see exactly what changed in plain terms (images added, annotations changed).
5. Open **Sync**, add a remote if none is configured yet, and click **Push** to make the new version retrievable from another machine.

## Documentation pages for DVC App

The DVC App documentation is split into nine pages. User pages come first, developer pages last.

- [User guide](user-guide.md): every page and panel of the interface, and when to use each one.
- [Workflows](workflows.md): complete tasks in numbered steps, from versioning a pipeline's output to diffing two versions and restoring an old one.
- [Concepts](concepts.md): tracked data and `.dvc` pointer files, commits, remotes, and lineage with Git and MLflow.
- [Configuration](configuration.md): installation, launch commands, ports, environment variables and the repository layout.
- [Troubleshooting](troubleshooting.md): known problems described by their symptom, with cause and solution.
- [Architecture](architecture.md): the subprocess wrapper around `git`/`dvc`, the commit trailer format, cache linking, and invariants.
- [API reference](api-reference.md): HTTP endpoints grouped by domain.
- [Code map](code-map.md): where each feature lives in the code and where to change it.
