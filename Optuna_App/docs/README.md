---
app: optuna
doc_type: readme
audience: both
lang: en
title: Optuna App
order: 0
tags: [optuna, hpo, hyperparameters, study, trial, tpe, yolox]
sources: [Optuna_App/backend/main.py, Optuna_App/launcher.py, _lib/launcher_engine.py, Optuna_App/frontend/src/App.tsx]
---

# Optuna App

## What Optuna App does

Optuna App is the hyperparameter optimization (HPO) tool of the Computer Vision suite. It runs Optuna studies: each study tries many combinations of training hyperparameters (learning rate, augmentation probabilities, rotation...), trains a model for each combination, measures a metric such as mAP50, and keeps the combination that scored best.

The app covers two ways of working:

- **Standalone studies**: you create a study in the interface, point it to a Python script that trains and prints a score, describe the search space, and launch it. A preset fills everything in to optimize a detection training with an engine of Training App (YOLOX by default).
- **Studies driven by the Orchestrator**: an Optuna node of an Orchestrator pipeline asks the app to run a complete study on the dataset exported by Annotation App, then passes the best parameters to the downstream Training node.

For every study, the study page shows the progress, the best trial, a table of all trials with their result files, and an analysis dashboard (optimization history, search space, parameter importance, parallel coordinates). When trials fail, the page groups them by root cause and tells you what to fix.

All studies of a user live in one SQLite file (`optuna.db`) in the user's workspace, so they survive restarts and can be reopened at any time.

## Place of Optuna App in the suite pipeline

Optuna App sits between the annotated dataset and the final training:

1. **Dataset Explorer** selects images and **Annotation App** annotates them and exports a YOLO dataset.
2. **Optuna App** runs short trainings (10 epochs per trial by default) on that dataset to find good hyperparameters.
3. **Training App** runs the final, long training with the best parameters, using the same engine as the trials.
4. **MLflow App** shows the training runs and **DVC App** can version the best parameters with the dataset and the model.

The trials reuse the training engines of Training App directly (no copy of the training code), which is why Training App must be present next to Optuna App for detection studies. Studies with your own script work without it.

Each user gets an isolated workspace (`optuna_<user>` under the workspaces root) holding the study database and the files of every trial. The layout is described in [Configuration](configuration.md).

## Quick start in five steps

This quick start optimizes a YOLOX detection training on a YOLO dataset. It assumes the app is launched from VisionNexus or with `python launcher.py --app optuna --workspace <root> --user <name>` from the suite root.

1. On the studies page, click **New study**, type a name, choose **maximize** and click **Create**.
2. Click the study in the list, then **Launch an optimization**.
3. In the panel **Optimiser un entraînement de détection**, choose the model size, the epochs per trial and type the absolute path of the dataset `data.yaml`, then click **Préremplir l'étude**.
4. Set **Number of trials** (20 is a reasonable start) and click **Launch**. The output log shows each trial as it runs.
5. Go back to the study page: when the study is finished, the best trial card lists the best parameters to use in Training App.

## Documentation pages for Optuna App

The Optuna App documentation is split into nine pages. User pages come first, developer pages last.

- [User guide](user-guide.md): every page, panel, chart and button of the interface, and when to use each one.
- [Workflows](workflows.md): complete tasks in numbered steps, from a first study to diagnosing failed trials and running a study from an Orchestrator pipeline.
- [Concepts](concepts.md): study, trial and trial states, search space, objective and direction, TPE sampler, pruner, best parameters, parameter importance, and the trial result contract.
- [Configuration](configuration.md): installation, launch commands, ports, environment variables, workspace layout and the defaults of the trials.
- [Troubleshooting](troubleshooting.md): known problems described by their symptom, with cause and solution.
- [Architecture](architecture.md): backend and frontend components, the two optimization runners, storage, log streaming and invariants.
- [API reference](api-reference.md): HTTP endpoints grouped by domain.
- [Code map](code-map.md): where each feature lives in the code and where to change it.
