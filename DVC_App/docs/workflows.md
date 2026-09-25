---
app: dvc
doc_type: workflows
audience: user
lang: en
title: Workflows
order: 20
tags: [commit, remote, push, pull, diff, restore, orchestrator]
sources: [DVC_App/frontend/src/pages/LineagePage.tsx, DVC_App/frontend/src/pages/HistoryPage.tsx, DVC_App/frontend/src/pages/DiffPage.tsx, DVC_App/frontend/src/pages/SyncPage.tsx, DVC_App/backend/api/orchestrator.py, Orchestrator_App/backend/api/graphs.py]
---

# Workflows

## Version a pipeline run's dataset and model from the Orchestrator

This workflow turns the output of a finished pipeline run into a Git + DVC commit, with lineage trailers linking it back to the run.

*Prerequisites*: the Orchestrator App is running, a graph contains a DVC node, and at least one run of that graph has finished producing a dataset and, optionally, a trained model.

1. Open the DVC node's hub in the Orchestrator (it observes the whole graph; it is not wired into the pipeline flow itself).
2. Select the finished run and choose which artifacts to version: the dataset, the model weights, the annotations, run metrics, the best Optuna parameters, and/or a full snapshot of the pipeline graph.
3. Confirm the commit. The Orchestrator copies the chosen artifacts into the repository (`.zip` exports are extracted automatically), runs `dvc add` on each, and creates a Git commit whose message carries the lineage trailers (Run-Id, Graph-Id, Dataset, mAP50, MLflow-Run).
4. The Orchestrator then tags the matching MLflow run with the resulting Git commit hash and dataset version, closing the lineage loop.

*Result*: a new commit appears on DVC App's **Historique** page with its lineage chips, and the versioned files appear on **Datasets**. If nothing had actually changed since the last commit, the Orchestrator reports it skipped the commit rather than creating an empty one.

## Read what a version actually contains

This workflow inspects a Git+DVC commit to know exactly what dataset or model version it represents before reusing it.

*Prerequisites*: at least one commit with `.dvc` files exists.

1. Open **Lineage**, find the run whose version you want to inspect, and click its Git/DVC version node (or open **Historique** directly).
2. Read the commit's lineage chips: **Dataset** names the dataset, **Run** gives the Orchestrator run id, **mAP50** the metric recorded at commit time.
3. Expand the commit row to see the exact `.dvc` files it changed; each one is a pointer to one tracked dataset or model folder.
4. For the full picture of what is tracked right now (not just what one commit changed), open `/datasets` directly and check each file's status column.

*Result*: you know which run produced a given version, on which dataset, with what metric, without opening the repository on the backend machine.

## Compare two versions before deciding which to keep

This workflow answers "what actually changed between these two versions" in terms of images and annotations, not just file hashes.

*Prerequisites*: at least two commits touching `.dvc` files exist.

1. Open **Diff**. If you came from a commit row's **Diff** button or a Lineage version node, the two revisions are pre-filled.
2. Otherwise, type or pick **Révision A (base)** and **Révision B (cible)** from the dropdowns (fed by the commit history), then click **Calculer le diff**.
3. Read the **Résumé métier** first: how many images were added or removed, how many annotation files changed. If it shows zero for all three while files still changed, the content is aggregated inside a tracked folder rather than tracked file by file; check the detail table below for the actual paths.
4. Check **Utilisé par**: if a run used revision B, it is named here, taken directly from that commit's trailers; if nothing is shown, no run is recorded against that version, which is stated plainly rather than guessed.
5. Scroll to the file-by-file table for the exact list of added, deleted, modified and renamed paths.

*Result*: enough information to decide which version to keep, restore, or hand off, without downloading either one first.

## Restore an old version of the working directory

This workflow brings the repository's working files back to exactly the state of a past commit.

*Prerequisites*: the commit to restore is visible on **Historique**.

1. Open **Historique** and find the commit to restore.
2. Click **Restaurer** on that commit's row.
3. Read the confirmation dialog carefully: it states that the working directory will return exactly to that commit's state (dataset and model), and that this is reversible by restoring a more recent version afterward.
4. Confirm.

*Result*: the backend runs `git checkout <rev>` followed by `dvc checkout`, so both the tracked pointers and their actual content on disk match that commit. The datasets and commits lists refresh automatically.

## Configure a remote and synchronize a version

This workflow makes a locally committed version retrievable from another machine, such as a remote GPU VM or a colleague's workstation.

*Prerequisites*: at least one commit exists; you know the destination for the remote (a local/network folder path, or a URL such as `s3://...`, `ssh://...`).

1. Open **Sync**. If the amber warning "Aucun remote DVC configuré" is shown, type a **Nom** and a **Destination**, then click **Ajouter le remote**; a folder destination is created automatically if it does not exist yet.
2. Once a remote is listed, click **Push** on the DVC Push card. Watch the live log; a green check and "Push terminé" confirm success, a red cross and an error line mean it failed partway.
3. On the other machine, once DVC App points at the same repository (cloned via Git, with the same remote configured), click **Pull** to retrieve the tracked content matching the checked-out commit.
4. Optionally, click **Calculer l'usage disque** to confirm the cache is in linked mode rather than plain copy mode, which avoids a second physical copy of large files on disk.

*Result*: the content behind the `.dvc` pointers of the pushed commit is now available from the remote, so any machine with access to it and a matching Git history can reproduce the exact same dataset and model version.
