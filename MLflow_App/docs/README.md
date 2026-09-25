---
app: mlflow
doc_type: readme
audience: both
lang: en
title: MLflow App
order: 0
tags: [mlflow, experiment tracking, model registry, lineage, supervisor]
sources: [MLflow_App/backend/main.py, MLflow_App/launcher.py, _lib/launcher_engine.py, MLflow_App/frontend/src/App.tsx]
---

# MLflow App

## What MLflow App does

MLflow App is the experiment tracking and model registry viewer of the Computer Vision suite. It gives a web interface to a plain MLflow store: experiments, runs with their parameters, metrics and artifacts, and a registry of model versions.

MLflow App never trains anything and never starts a training run. It is a **supervisor**: other apps of the suite (mainly Training App) log their runs directly into a shared store, and MLflow App only reads and displays that store. There is nothing to configure to "receive" a run; if a run was logged, it is already there the next time you open or refresh the page.

Four pages cover the whole interface:

- **Lineage** shows every pipeline run of the suite as a graph or a list, from its source dataset through its MLflow stages to its metrics, and links out to the matching DVC version and Orchestrator run.
- **Model Registry** lists the registered model versions, each linked to the run and the dataset that produced it, with buttons to move a version between stages.
- **Comparer** puts the parameters and metrics of several selected runs side by side, with one chart per metric.
- **Doc** explains, inside the app, how MLflow is actually used in this suite: naming, lineage tags and a worked example.

A run detail page (opened from any run row) shows its per-epoch metric charts, its final metrics, its parameters, the training plots produced by the engine, and its full artifact list.

## Place of MLflow App in the suite pipeline

MLflow App sits after training, not inside the pipeline itself:

1. **Dataset Explorer** and **Annotation App** produce a dataset.
2. **Optuna App** optionally searches hyperparameters on that dataset.
3. **Training App** trains a model and logs the run (parameters, metrics, plots, and the best weights as a registered model version) into the shared MLflow store.
4. **MLflow App** displays that run, live, without anything having to be pushed to it.
5. **DVC App** can then version the dataset and the model together, and tags the matching MLflow run with the resulting Git commit and dataset version, closing the lineage loop shown on the Lineage page.

In an Orchestrator pipeline, an MLflow node has no incoming edge and generates no pipeline step: it is only a live viewport into the run the pipeline just produced, opened side by side with the Orchestrator's own Insight and Sandgraph views.

Each user has an isolated store: `mlflow_<user>/mlflow_data/mlflow.db`, a sibling of `mlflow_<user>`'s own workspace next to every other app's workspace. See [Configuration](configuration.md) for the exact layout.

## Quick start in five steps

This quick start assumes at least one training run has already been logged (for example through Training App, standalone or from an Orchestrator pipeline), and that MLflow App is launched from VisionNexus or with `python launcher.py --app mlflow --workspace <root> --user <name>` from the suite root.

1. Open MLflow App: the **Lineage** page loads and shows the runs of the current user's store as a graph.
2. Click a run node to open its side panel, then use its links to jump to the matching Orchestrator Insight, the Sandgraph view, or DVC App's lineage for the same run.
3. Click a run's stage node, or open **Comparer**, select an experiment and two or more runs, to see their metrics side by side.
4. Open **Model Registry** to see the versions of a trained model and move one to **Production** or **Staging**.
5. Open **Doc** for a short, suite-specific explanation of naming and lineage tags with a real example.

## Documentation pages for MLflow App

The MLflow App documentation is split into nine pages. User pages come first, developer pages last.

- [User guide](user-guide.md): every page and panel of the interface, and when to use each one.
- [Workflows](workflows.md): complete tasks in numbered steps, from reading a run's metrics to comparing runs and promoting a model version.
- [Concepts](concepts.md): experiment, run, parameters/metrics/artifacts, the model registry and its versions, and the suite's `run_type`/lineage tag conventions.
- [Configuration](configuration.md): installation, launch commands, ports, environment variables and the store layout.
- [Troubleshooting](troubleshooting.md): known problems described by their symptom, with cause and solution.
- [Architecture](architecture.md): the serverless SQLite store, backend components, the shared logging module used by writer apps, and invariants.
- [API reference](api-reference.md): HTTP endpoints grouped by domain.
- [Code map](code-map.md): where each feature lives in the code and where to change it.
