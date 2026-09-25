---
app: dvc
doc_type: troubleshooting
audience: both
lang: en
title: Troubleshooting
order: 50
tags: [errors, repo not found, dvc command, remote, push, pull, lineage]
sources: [DVC_App/backend/core/dvc_runner.py, DVC_App/backend/api/orchestrator.py, DVC_App/backend/api/sync.py, DVC_App/backend/api/datasets.py, DVC_App/frontend/src/pages/LineagePage.tsx]
---

# Troubleshooting

## Sidebar shows "Repo introuvable" and pages return 503

**Symptom**: the sidebar's repository status shows a red cross, and Datasets, History, Diff or Sync report a 503 error.

**Cause**: `DVC_REPO_PATH` does not point at a folder containing both a `.git` and a `.dvc` subfolder. This is expected and not an error before the first commit: the repository is created automatically the first time `POST /api/orchestrator/commit` runs, or you can initialize one yourself outside the app.

**Solution**:

1. Open `http://localhost:<backend-port>/health` or the sidebar's expanded status panel to see the exact `repo_path` DVC App is looking at.
2. If a repository should already exist there, confirm `DVC_REPO_PATH` (or the workspace and user used to launch the app) matches the one that was actually populated.
3. If none exists yet, run one commit from the Orchestrator's DVC node (see [Workflows](workflows.md)); the app never requires manual `git init`/`dvc init`.

## "Commande introuvable" or a push/pull fails immediately

**Symptom**: an operation fails with "Commande introuvable : dvc" (or `git`), even though `dvc` and `git` work fine from a normal terminal.

**Cause**: the backend is started by the launcher without the conda environment's `Scripts/` (Windows) or `bin/` folder on its `PATH`, so the bare `dvc` executable is not found even though the Python module is installed. `core/dvc_runner.py::_run()` and `api/sync.py::_dvc_args()` both work around this by replacing a leading `dvc` argument with `sys.executable -m dvc`; a genuinely missing package, or a `git` binary absent from the system `PATH` entirely (this substitution does not apply to `git`), still surfaces this error.

**Solution**:

1. Confirm `dvc` is actually installed in the same environment as the backend: activate it and run `python -m dvc --version`.
2. Confirm `git` is installed and on the system `PATH` for the account running the backend; DVC App does not work around a missing `git` binary the way it does for `dvc`.
3. If you modified `dvc_runner.py` or `sync.py`, keep the `sys.executable -m dvc` substitution; reverting to a bare `dvc` call reintroduces this exact failure.

## Push or Pull says no remote is configured

**Symptom**: clicking **Push** or **Pull** on the Sync page immediately shows "Aucun remote DVC configuré. Ajoutez-en un..." instead of running.

**Cause**: `dvc remote list` returned nothing for this repository. Push and pull are blocked before even attempting the underlying command, since neither has anywhere to send or fetch content without a remote.

**Solution**:

1. Add a remote directly from the Sync page: a plain folder path becomes a local remote (created automatically if it does not exist), or type a URL such as `s3://...`/`ssh://...` for a cloud remote.
2. If a remote should already be configured (for example after cloning an existing repository), check `.dvc/config` and `.dvc/config.local` in the repository for a `[remote "..."]` section; a remote added outside this app through a different mechanism than `dvc remote add` may not be picked up if the config file is malformed.

## A file shows "missing" on the Datasets page

**Symptom**: a tracked file or folder has the status badge `missing` even though you expect it to be there.

**Cause**: its `.dvc` pointer exists in the repository (so DVC knows about it), but the actual content it points to is not present on disk at that path. This happens after a fresh `git clone` without a matching `dvc pull`, after the cache was cleared, or if the file was deleted from the working directory directly.

**Solution**:

1. Run **Pull** on the Sync page if a remote is configured and the content should be retrievable from it.
2. If no remote has this content yet (it was never pushed), the file can only be restored from wherever it was originally produced (re-export from Annotation App, re-train in Training App, etc.).
3. Confirm you are on the right commit first (see **Historique**): a file can be legitimately absent because a different, older or newer revision is currently checked out.

## Diff shows no images/annotations changed but the summary says something changed

**Symptom**: **Résumé métier** on the Diff page shows 0 for images added, images deleted and annotations changed, yet the file-by-file table below is not empty.

**Cause**: the business summary only counts individual file extensions it recognizes (images, `.txt` label files) inside the diff entries DVC reports. When a dataset is tracked as one folder rather than as many individually tracked files, `dvc diff` can report the folder's directory hash as a single changed entry without listing every image inside it by path, so the image/annotation counters find nothing to count even though real content changed.

**Solution**:

1. Read the note shown under the summary ("Ce diff ne touche pas d'images/annotations directement...") and check the file-by-file table for the actual changed path (typically the tracked folder itself).
2. To get a per-image diff instead of a per-folder one, the dataset would need to be tracked with finer-grained `dvc add` calls; this is a property of how the dataset was versioned, not something adjustable from the Diff page itself.

## A commit is missing its lineage chips (Dataset, Run, mAP)

**Symptom**: a commit appears on **Historique** with its `.dvc` files but no colored lineage chips, and no run is named on the Diff page's "Utilisé par" line for it.

**Cause**: the commit was made without the Git trailers the Orchestrator normally writes (`Run-Id`, `Graph-Id`, `Dataset`, `mAP50`, `MLflow-Run`). This is expected for any commit made outside the Orchestrator's DVC node, for example directly with `git commit` on the backend machine, or a commit predating the lineage trailer feature.

**Solution**:

1. This is not a bug to fix on an existing commit: trailers are written once, at commit time, and DVC App never reconstructs or guesses them afterward.
2. For future commits of the same kind of artifact, use the Orchestrator's DVC node instead of committing manually, so the trailers are written automatically.
