---
app: mlflow
doc_type: workflows
audience: user
lang: en
title: Workflows
order: 20
tags: [lineage, compare runs, model registry, promote, orchestrator, dvc]
sources: [MLflow_App/frontend/src/pages/LineagePage.tsx, MLflow_App/frontend/src/pages/CompareRunsPage.tsx, MLflow_App/frontend/src/pages/ModelRegistryPage.tsx, MLflow_App/frontend/src/pages/RunDetailPage.tsx, MLflow_App/backend/api/runs.py, Orchestrator_App/backend/api/graphs.py]
---

# Workflows

## Trace a pipeline run from its dataset to its metrics

This workflow follows one Orchestrator pipeline run end to end on the Lineage page, from the data it used to the numbers it produced.

*Prerequisites*: at least one pipeline run has been executed with an Orchestrator graph that reaches a training or evaluation stage.

1. Open MLflow App: the Lineage page loads with every run of the current store.
2. Type part of the run id, the dataset name or the graph name in the search box to narrow the graph to one run.
3. Look at the amber **Dataset source commun** node at the top and the **Subset utilisé** node under the run frame: together they say exactly which images produced this run.
4. Click a violet stage node under the run to open its detail panel, then follow **Ouvrir le run MLflow détaillé** to the full [run detail page](user-guide.md#run-detail-page).
5. On the run detail page, read the **Lineage** section for the Git commit and dataset version tags, then the metric charts and final metrics.

*Result*: you have the exact dataset, code version and metrics of one run without leaving MLflow App, and links to the matching Orchestrator Insight and DVC version if you need to go further.

## Compare several runs on a metric

This workflow puts two or more runs side by side to see the effect of a hyperparameter change or an HPO search.

*Prerequisites*: at least two runs exist in the same experiment.

1. Open **Comparer**.
2. Pick the experiment that groups the runs you want to compare in the step 1 dropdown.
3. In step 2, click the rows of the runs to compare (2 to 10). The counter next to the section title confirms the selection.
4. Click **Comparer N run(s)**.
5. In step 3, use the metric dropdown to focus on one metric at a time if the study touched several; each colored line is one run, named from its run name or the start of its id.
6. Scroll to **Paramètres comparés** to see exactly which hyperparameter differs between the selected runs.

*Result*: a side-by-side view of the selected runs' curves and parameters, useful right after an Optuna study or a manual sweep of settings to decide which run to keep.

## Promote a model version to Production

This workflow moves a trained model version through its lifecycle stages after validating it.

*Prerequisites*: at least one model version is registered (Training App registers the best weights of a run automatically when training completes with a positive metric).

1. Open **Model Registry**.
2. Click the model whose version you want to promote; the version table expands.
3. Check the version's **Dataset** and **mAP50** columns, and follow its **Run** link to the [run detail page](user-guide.md#run-detail-page) if you need the full training context before deciding.
4. In the **Transition** column of that version's row, click **Staging** to move it there, review it, then click **Production** once satisfied. The current stage's button stays disabled so you always see where a version is.
5. To retire an old version instead, click **Archived**.

*Result*: the version's stage changes immediately, visible instantly in the badge next to the model name on the collapsed row too. Moving a version does not delete or change its weights, its run, or any other version.

## Read a run's training curves and artifacts

This workflow opens one run in detail to check how its training behaved, not just its final score.

*Prerequisites*: a run id or a row to click (from Lineage, Comparer, the Model Registry or Experiments).

1. Open the run's detail page.
2. Read **Historique métriques**: one chart per metric that was logged at every step, showing the trend rather than only the endpoint.
3. Check **Métriques finales** for the last recorded value of every metric, including ones without a full history.
4. If the training engine attached plots, scroll to the **Plots** gallery (loss curves, confusion matrices, or whatever the engine produced) and click one to open it full size.
5. Open **Artifacts** for the full file list with sizes, useful to confirm a checkpoint or a config file was actually saved.

*Result*: a complete picture of one training run, from its curves to its saved files, without needing to open the workspace folder on the backend machine.

## Browse experiments and forks as a tree

This workflow uses the Experiments page to read a pipeline's fork history, which the Lineage page shows spatially but the Experiments page shows as an explicit tree.

*Prerequisites*: the pipeline was forked at least once in the Orchestrator (a Sandgraph fork creates a new run whose `fork_parent_run` tag points at the parent's `orch_run_id`).

1. Navigate to `/experiments` directly (no sidebar link, see [User guide](user-guide.md#experiments-page)).
2. Expand the experiment that groups the pipeline's runs.
3. Read the indentation: a run with a fork icon and a "fork de <id>" chip is a child of the run above it at the previous indentation level.
4. Use the **Rôle** badge column to tell training, evaluation, inference and HPO runs apart at a glance within the tree.
5. Click any row to open its [run detail page](user-guide.md#run-detail-page).

*Result*: a clear parent-to-child reading of every fork of a pipeline, which the graph view of Lineage draws side by side instead of nested.
