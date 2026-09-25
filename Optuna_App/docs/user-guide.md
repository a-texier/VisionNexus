---
app: optuna
doc_type: user-guide
audience: user
lang: en
title: User guide
order: 10
tags: [studies, study page, launch, dashboard, trials, preset]
sources: [Optuna_App/frontend/src/App.tsx, Optuna_App/frontend/src/pages/StudiesPage.tsx, Optuna_App/frontend/src/pages/StudyDetailPage.tsx, Optuna_App/frontend/src/pages/LaunchPage.tsx, Optuna_App/frontend/src/components/StudyDashboard.tsx, Optuna_App/frontend/src/components/EnginePreset.tsx, Optuna_App/frontend/src/pages/HPOLearnPage.tsx, Optuna_App/frontend/src/components/UserBadge.tsx]
---

# User guide

## Sidebar and navigation of Optuna App

The sidebar on the left of Optuna App is always visible. It holds four entries and the user badge.

- **Études** opens the studies page, the home page of the app. A small indigo counter next to it shows how many studies are running in this backend right now (refreshed every 5 seconds).
- **Comprendre HPO** opens an interactive introduction to hyperparameter optimization, described in the section *Understanding HPO page* of this guide.
- **Documentation** opens this documentation inside the app.
- **Paramètres** opens a placeholder page with no setting yet.

The sidebar entries and a few panels are displayed in French even when the interface language is English: the analysis dashboard of a study and the detection training preset of the launch page. This guide quotes them exactly as displayed.

The user badge at the bottom shows the user name given by the launcher and four buttons: **Open workspace** opens the workspace folder in the file explorer of the machine that runs the backend, **Workspace history** lists the recent workspaces of this app, **Connected users** lists the other users running Optuna App on the same machine, and the language toggle switches between English and French. When the app is opened from VisionNexus, VisionNexus imposes the language.

## Studies page

The studies page lists every study stored in the workspace database, whether it was created by hand or by the Orchestrator. The header shows the number of studies, a refresh button and **New study**. The list refreshes itself every 15 seconds.

Each row shows:

- **Name**: the study name. For a study launched by the Orchestrator, a second line shows the metric, the graph id and the run id.
- **Status**: **Running** (at least one trial is running or waiting), **Finished** (at least one trial completed), **HPO failed** (trials exist but none completed) or **Empty** (no trial yet).
- **Direction**: `minimize` or `maximize`.
- **Trials C/F/P**: the number of completed, failed and pruned trials.
- **Best val.**: the best objective value, or a dash.

Click a row to open the study page. The trash icon deletes the study and all its trials after a confirmation; the files written by the trials in `hpo_runs/` stay on disk.

The **New study** window asks for a **Name** and a **Direction** (`minimize` by default) and creates an empty study. The name must be unique in the workspace; a duplicate name shows "Error while creating (name already in use?)". Choose the direction carefully: it cannot be changed later, and the **Direction** field of the launch page does not override it (see [Troubleshooting](troubleshooting.md)).

## Study page: header, verdict and counters

The study page opens when you click a study. Its top bar holds **Back to studies**, a refresh button, **Stop** while an optimization started from this app is running, and **Launch an optimization**. Under the study name, a line says whether the study was launched from Optuna App or from an Orchestrator node ("Study launched from a Sandgraph node").

A verdict box follows the analysis dashboard:

- **HPO usable - official best trial #N** in green when at least one trial completed.
- **Study in progress - no official result selectable yet** in blue while no trial has completed.
- **Official HPO FAILURE - no Optuna best_params** in red when trials exist but none completed. The box then lists the failures grouped by root cause: title, number and list of trials, **Cause:** and **To do:**. A failure shared by all trials appears once, so you fix it once. For old studies whose trainings finished but whose value was lost, the box can also show a recovered historical candidate, marked as informative and never turned into a completed trial.

Six counters show **Planned**, **Finalized**, **Succeeded**, **Failed**, **Pruned** and **Interrupted** trials. While an optimization launched from this app runs, a **Progress** bar appears under the counters.

The study page refreshes its status every 2 seconds and its analysis every 5 seconds while the study runs, and every 10 to 30 seconds otherwise.

## Study page: analysis dashboard

The analysis dashboard sits between the header and the verdict box. Its panels are displayed in French.

- **Comment cette étude Optuna fonctionne**: the optimization cycle, the phase of the sampler (startup or adaptive TPE, with the number of adaptive decisions observed) and six cells: dataset or script, number of trials, direction, objective metric, sampler and pruner. A warning appears when the requested number of trials cannot leave the startup phase of TPE.
- **Espace de recherche**: one card per hyperparameter with its type, distribution, bounds or choices, and a golden marker at the value of the best trial.
- **Historique de l'optimisation**: one point per completed trial and a green line for the best value reached so far.
- **Distribution de l'objectif**: histogram of the completed values with best, mean, median and worst.
- **Interaction entre paramètres**: a 7 x 7 heat map of the mean objective for two numeric parameters chosen in the **X** and **Y** lists. Empty cells stay empty.
- **Évolution de l'exploration TPE**: the values proposed for one parameter trial after trial, with a **Lecture** button to replay them.
- **Importance des paramètres**: fANOVA importance of each parameter, with its warnings. It needs at least 5 completed trials with different values (see [Concepts](concepts.md)).
- **Trials et pruning**: counts of completed, pruned, running and failed trials, and the pruner status.
- **Coordonnées parallèles**: one line per completed trial (the last 80) across up to six numeric parameters and the objective, colored from worst to best.

## Study page: best trial and trials table

Below the counters, the **Best trial #N** card shows the best objective value and one tile per hyperparameter with its value. These are the values to copy into Training App or into the `best_params` field of an Orchestrator Training node.

The **All trials** table lists every trial, newest first:

- **#**: trial number.
- **State**: the effective state badge (`COMPLETE`, `FAIL`, `PRUNED`, `RUNNING`, `WAITING`, `INTERRUPTED`, `LEGACY_PRUNED_UNKNOWN`, `LEGACY_FAILURE_RECOVERED`). The states are explained in [Concepts](concepts.md).
- **Observed result**: "official objective = value" for a completed trial, "training recovered - not official" with recovered metrics for an old trial, or "no metric".
- **Parameters**: the first four parameters. When the trial failed, a red line "Cause grouped in the study's verdict" sends you to the verdict box.
- **Duration**: from start to end of the trial.

When a trial has files or metrics, the **Results and artifacts** link opens the metric source, the metrics (`map50`, `map5095`) and the folder of the trial on disk.

## Launch an optimization page

The launch page opens from **Launch an optimization** on a study page. It configures and starts an optimization of the current study with a script that runs on the backend machine, and it streams the resulting log live once the study is running. The back button at the top returns to the study page without stopping anything that is already running: leaving the launch page never cancels an optimization, since it keeps running on the backend independently of the browser tab. The three panels below fill in this page from top to bottom: an optional preset, the script and its trials, and the search space with the launch controls.

### Detection training preset

The panel **Optimiser un entraînement de détection** fills the whole page to optimize a detection training with an engine of Training App. It appears only when the backend finds Training App and at least one usable engine.

- **Moteur**: shown only when several engines are available (YOLOX is built in, other engines come from plugins).
- **Modèle YOLOX**: the model size of the engine (`nano`, `tiny`, `s`, `m`, `l`, `x` for YOLOX; `s` by default).
- **Epochs par trial**: epochs of each trial, 10 by default. Keep it low: trials only compare settings.
- **Chemin data.yaml**: absolute path of the `data.yaml` of a YOLO dataset, as seen by the backend.

**Préremplir l'étude** is enabled once a path is typed. It fills the script with the trial script of the app (`backend/hpo_trial.py`), the fixed arguments (dataset, engine, size, epochs, metric `map50`, a `--runs_dir` under `hpo_runs/<study>`), the default search space of the engine, **Metric name** `map50` and **Direction** `maximize`. Everything stays editable.

### Objective script, trials and metric

The **Objective script** panel describes what each trial runs.

- **Absolute path to the Python script**: the script, on the backend machine. It receives each hyperparameter as `--param_name value` and must print the metric on the last line of its output (see the trial contract in [Concepts](concepts.md)).
- **Fixed arguments (before the hyperparameters)**: shown only after a preset; **Remove** clears them.
- **Number of trials**: 20 by default.
- **Metric name**: `value` by default. It labels the log, and it is used as a fallback when the last line is not a number: the app then looks for a line `metric_name=value`.
- **Direction**: `minimize` or `maximize`. It is recorded with the run, but an existing study keeps the direction chosen at its creation.

### Hyperparameter space, launch and output

The **Hyperparameter space** panel holds one row per hyperparameter: a name, a type (`float`, `int` or `categorical`), then **min** and **max** with a **log** box for numeric types, or a comma-separated list of values for `categorical`. **Add** adds a row, the trash icon removes one. A row with an empty name, a missing bound or a minimum not lower than the maximum blocks the launch with "Parameter ... invalid - check the fields".

**Launch** starts the optimization in the background and shows "Optimization in progress...". The **Output** panel streams the log: one line per trial with its parameters, the metric value or the failure diagnosis (**ÉCHEC**, cause and action), and status lines. **Stop** asks the optimization to stop; the trial that is running finishes first. You can leave the page: the optimization continues on the backend and its state stays visible on the study page.

## Understanding HPO page

The page **Comprendre HPO** is a self-contained, interactive introduction for users who are new to hyperparameter optimization. It does not read or change any study.

It explains what hyperparameters are, what a trial is, and compares grid search, random search and TPE. Three interactive parts help to build intuition: sliders that build an example configuration of `lr`, `mosaic` and `scale` (with a logarithmic scale for the learning rate), an animation of how TPE concentrates its proposals after a startup phase, and a simulated study of 18 trials that you can play step by step to watch the best score improve. A final part explains the difference between the sampler (what to try next) and the pruner (whether to continue a trial).

All values on this page are a fixed teaching example. The real behavior of the app is described in [Concepts](concepts.md).
