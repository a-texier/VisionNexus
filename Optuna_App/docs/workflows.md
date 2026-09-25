---
app: optuna
doc_type: workflows
audience: user
lang: en
title: Workflows
order: 20
tags: [study, preset, yolox, stop, best params, diagnosis, orchestrator]
sources: [Optuna_App/frontend/src/pages/StudiesPage.tsx, Optuna_App/frontend/src/pages/LaunchPage.tsx, Optuna_App/frontend/src/components/EnginePreset.tsx, Optuna_App/frontend/src/pages/StudyDetailPage.tsx, Optuna_App/backend/core/optuna_runner.py, Optuna_App/backend/api/orchestrator.py, Orchestrator_App/backend/core/graph_runner.py]
---

# Workflows

## Optimize a detection training with the engine preset

This workflow tunes the hyperparameters of a YOLOX (or plugin engine) detection training on a YOLO dataset, entirely from Optuna App.

*Prerequisites*: Training App is installed next to Optuna App; a YOLO dataset with a `data.yaml` is reachable from the backend machine (for example an export of Annotation App); a GPU is recommended.

1. On the studies page, click **New study**, type a **Name**, select **maximize** (mAP must be maximized) and click **Create**.
2. Click the study, then **Launch an optimization**.
3. In **Optimiser un entraînement de détection**, pick the engine if several are listed, the model size in **Modèle YOLOX**, and keep **Epochs par trial** low (10 is the default).
4. Type the absolute path of the dataset `data.yaml` in **Chemin data.yaml** and click **Préremplir l'étude**. The script, its fixed arguments, the search space of the engine, **Metric name** `map50` and **Direction** `maximize` are filled in.
5. Optionally adjust the **Hyperparameter space**: remove parameters you do not want to tune, add others from the engine catalog (see [Concepts](concepts.md)), or narrow the bounds.
6. Set **Number of trials**. Below 10 completed trials, TPE is still exploring at random; 20 to 50 trials give a more informed search.
7. Click **Launch** and watch the **Output** panel: each trial prints its parameters, then `map50 = ...` or a failure diagnosis.

*Result*: each trial trains a model in `hpo_runs/<study>/trial_<date>_<pid>/` of the workspace and the study records its mAP50. The study page shows the best trial and the dashboard. If the first trials fail, stop the study and follow the diagnosis workflow of this page before spending more GPU time.

## Optimize your own training script

This workflow runs a study on any Python script, for example a classifier or a custom training loop.

*Prerequisites*: a script on the backend machine that accepts its hyperparameters as `--name value` arguments and prints the final metric on the last line of its standard output (contract in [Concepts](concepts.md)); the script runs with the Python of the backend environment.

1. Create a study with **New study**, choosing the **Direction** that fits the metric: **minimize** for a loss, **maximize** for an accuracy or an mAP.
2. Open the study and click **Launch an optimization**.
3. Type the absolute path of the script in **Absolute path to the Python script**.
4. In **Hyperparameter space**, add one row per hyperparameter: a name identical to the script argument without `--`, a type, and the bounds or the choices. Tick **log** for values that span orders of magnitude (learning rate, weight decay).
5. Type the **Metric name**. If the script prints extra text after the metric, make it print a line `metric_name=value` instead.
6. Set **Number of trials** and click **Launch**.

*Result*: the app runs the script once per trial with `python <script> --name value ...`, waits for it to finish (one hour at most per trial) and records the parsed value. A trial whose script exits with an error is recorded as failed with a diagnosis, and the study moves on to the next trial.

## Follow a running study and stop it

This workflow monitors an optimization that is running and stops it cleanly.

*Prerequisites*: an optimization was launched from the launch page of Optuna App.

1. On the studies page, running studies show **Running** and the counter next to **Études** in the sidebar counts them.
2. Open the study: the counters, the **Progress** bar and the dashboard refresh every few seconds. The launch page, if still open, streams the full log.
3. To stop, click **Stop** on the study page or on the launch page.
4. Wait for the trial in progress to finish: the stop request is checked before each new trial and does not kill the running training.

*Result*: the study status returns to **Finished** (or **HPO failed** if nothing completed). The trials that were planned but not run are recorded as pruned without any intermediate value, so they appear with the state `LEGACY_PRUNED_UNKNOWN` and increase the **Pruned** counter; they carry no result.

## Read the result of a study and reuse the best parameters

This workflow turns a finished study into settings for the final training.

*Prerequisites*: the study has at least one `COMPLETE` trial.

1. Open the study. Check the verdict box: **HPO usable - official best trial #N** confirms that an official winner exists.
2. Read the **Best trial #N** card: the objective value and one tile per tuned hyperparameter.
3. Check the robustness of the result on the dashboard: in **Historique de l'optimisation**, a best value reached early and never improved suggests a flat landscape; in **Importance des paramètres**, read the warnings (few trials, low dispersion).
4. Find the files of the best trial. For an Orchestrator study, open **Results and artifacts** in its row: it gives the trial folder. For a study launched with the preset, the folders are under `hpo_runs/<study>/` of the workspace, one per trial, named after the start time. In both cases `results.csv` holds the per-epoch metrics and the checkpoint files hold the weights of this short training.
5. Copy the best parameter values into the hyperparameters of Training App, or into the `best_params` field of the Training node of an Orchestrator pipeline, with the same engine and model size.
6. Train with the full number of epochs. The best parameters only describe the tuned hyperparameters: the fixed ones (epochs, image size, batch) keep their own values.

*Result*: the final training starts from settings chosen on evidence. The short trial weights are not the final model.

## Diagnose a study with failed trials

This workflow finds and fixes the cause of failed trials without re-running the whole study blindly.

*Prerequisites*: a study shows failed trials or **Official HPO FAILURE - no Optuna best_params**.

1. Open the study and read the red verdict box. Each group gives a title (for example "Dataset introuvable ou mal référencé"), the number of trials it concerns, the **Cause:** (end of the error output) and **To do:**.
2. Fix the most frequent group first: a failure shared by every trial is a setup problem (dataset path, missing dependency, GPU), not a hyperparameter problem.
3. For a detail, open **Results and artifacts** of a failed trial and look in its folder: `stderr.log` and `stdout.log` (Orchestrator studies) or the output log of the launch page (standalone studies).
4. Check the setup outside the app if needed: the `data.yaml` paths, `nvidia-smi` for the GPU, the Python environment.
5. Relaunch. For a standalone study, launching again on the same study adds trials to it; create a new study if the setup changed a lot, so that the old failures do not mix with the new results.

*Result*: the next trials complete. The specific error messages and their fixes are listed in [Troubleshooting](troubleshooting.md).

## Run Optuna from an Orchestrator pipeline

This workflow uses Optuna App as the HPO step of an Orchestrator pipeline, between the annotation export and the training.

*Prerequisites*: the Orchestrator App is running; the graph contains an Optuna HPO node connected after the dataset (Annotation node or dataset source) and before a Training node that uses the same engine.

1. In the Orchestrator, select the Optuna node and configure it: automatic mode (on by default), number of trials (20 by default), the hyperparameters to optimize (empty = the default selection of the engine), and the failure policy (stop the pipeline, the default, or continue the Training with its own parameters).
2. Run the pipeline. The Orchestrator starts Optuna App if needed and calls it with the dataset path of the upstream node; an Annotation export in `.zip` is extracted once into `hpo_datasets/` of the Optuna workspace.
3. Wait: the call returns only when all trials are done. Each trial trains for 10 epochs by default, with a 20-minute limit per trial.
4. Follow the study in Optuna App if you want: it appears on the studies page with the graph and run ids, and its trials fill in as they finish.
5. At the end, the best parameters are merged into the hyperparameters of the downstream Training node. If no trial completed, the pipeline stops before Training, or continues with the Training defaults when the node allows it.
6. In manual mode, the pipeline instead waits at "Optimize hyperparameters (manual)": run a study yourself in Optuna App, type the best parameters in the node, then click **Continue** in the Orchestrator.

*Result*: the study `<graph>__<run>__<node>__<attempt>` stays in the workspace as a record of the HPO step. Re-running the pipeline creates a new attempt and a new study, never extra trials in the old one.
