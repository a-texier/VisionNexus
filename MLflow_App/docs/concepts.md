---
app: mlflow
doc_type: concepts
audience: user
lang: en
title: Concepts
order: 30
tags: [experiment, run, metrics, artifacts, model registry, lineage tags, run_type]
sources: [MLflow_App/backend/core/mlflow_client.py, MLflow_App/backend/api/experiments.py, MLflow_App/backend/api/runs.py, MLflow_App/backend/api/models.py, Training_App/backend/services/mlflow_logging.py, Orchestrator_App/backend/core/graph_runner.py]
---

# Concepts

## What MLflow answers in this suite

MLflow answers one question: which experiment was run, with which parameters, which metrics, and which artifacts? It is a record of what already happened, not a tool that runs anything itself. MLflow App is a read-and-organize interface over that record: every fact shown here was written by another app (mainly Training App) at the moment it trained, evaluated or ran inference.

The suite's broader question of what code and what data produced a given result belongs to Git and DVC, not to MLflow: MLflow's own tags only carry pointers to them (see *Lineage tags*, below), it does not version code or data itself.

## Experiment

An experiment is a named container that groups related runs. In this suite, one experiment groups every run of one MLOps project: training, evaluation, inference and HPO runs of the same graph are logged into the same experiment (the graph's name), rather than one experiment per stage, so that opening an experiment shows a project's whole history in one place instead of scattered fragments. An experiment has an id, a name, tags, and an artifact location where its runs store files by default.

## Run, parameters, metrics and artifacts

A run is one execution: one training, one evaluation, one inference pass. It belongs to exactly one experiment and has a status (`RUNNING`, `FINISHED`, `FAILED`, `KILLED`, `SCHEDULED`), a start and end time, and three kinds of recorded data:

- **Parameters** are the settings used for that run (hyperparameters, engine, model size, dataset path): fixed strings recorded once at the start, shown as a flat table.
- **Metrics** are numeric measurements; each one can have a history of values over training steps (an epoch-by-epoch curve) as well as a single final value. A metric with no history still has its last recorded value.
- **Artifacts** are files: training plots, configuration files, and the model's weights when registered. The run detail page shows a gallery for the plots an engine attaches under a `plots/` folder, and a table for everything else.

## Model registry and versions

The model registry keeps named models, each with one or more versions. A version is one specific set of weights, produced by exactly one run, carrying tags recorded at registration time (its source dataset, its mAP50) and a stage: `None`, `Staging`, `Production` or `Archived`.

The suite always registers a model under a name sealed to its project (for example `<project>/yolox-s`), so that successive trainings on the same project become versions `v1`, `v2`, ... of one model instead of unrelated models with random names. Moving a version between stages is a manual decision made from the Model Registry page; nothing in the suite promotes a version automatically. Archiving a version does not delete its weights or its run; it only marks it as retired.

## Suite conventions: run naming, run_type and lineage tags

Runs created from an Orchestrator pipeline follow conventions applied by the Orchestrator at logging time (`_trace_of()` in `graph_runner.py`), not by MLflow App itself, so that a run started outside the suite behaves like plain MLflow with none of these tags.

- **Naming**: a pipeline run is named `<graph_name>/<node_label>` instead of a random MLflow-generated name, so the run list reads as a project and a stage rather than an opaque id.
- **`run_type`**: one of `training`, `evaluation` or `hpo`, derived from the node type that produced the run. The Experiments and Lineage pages use it for the role badge and its color, so a project's runs are readable by kind at a glance instead of all looking the same.
- **`orch_run_id`**: the exact Orchestrator run that produced this MLflow run. It is the single key that links a run across MLflow, DVC and the Orchestrator's own views; every "open in Orchestrator" or "open in DVC" link in this app is built from it.
- **`graph_id`** and **`graph_name`**: identify the pipeline (Sandgraph) itself, independent of which run of it produced this entry.
- **`fork_parent_run`**: set when the pipeline was forked, pointing at the parent run's `orch_run_id`. It is what lets the Experiments page draw a fork tree instead of a flat list.
- **`git_commit`** and **`dataset_version`**: added after the fact, when a DVC commit is made from the Orchestrator for the same run (`POST /api/graphs/{id}/dvc-commit` backfills these tags onto the matching MLflow runs). A run without a DVC commit yet simply does not have these two tags: nothing is invented in their place.

A run without any of these tags (for example one logged by a script outside the suite, or through the legacy `MLFLOW_TRACKING_URI=http://...` server mode) is still a perfectly usable MLflow run; it just does not appear with a role badge or lineage links.
