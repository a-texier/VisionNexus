---
app: optuna
doc_type: troubleshooting
audience: both
lang: en
title: Troubleshooting
order: 50
tags: [errors, diagnosis, dataset, cuda, timeout, metric parse, training app]
sources: [Optuna_App/backend/core/diagnostics.py, Optuna_App/backend/core/optuna_runner.py, Optuna_App/backend/api/orchestrator.py, Optuna_App/backend/api/studies.py]
---

# Troubleshooting

## A study shows "Official HPO FAILURE - no Optuna best_params"

**Symptom**: the study page shows a red box "Official HPO FAILURE - no Optuna best_params" with a list of failure groups, and no best trial card.

**Cause**: every trial of the study finished as `FAIL` (or `INTERRUPTED`), so Optuna has zero `COMPLETE` trial and cannot select a winner. The red box already groups the failures by root cause: each group has a title, the trials it affects, a **Cause:** and a **To do:**.

**Solution**:

1. Open the group with the most trials first: a cause shared by every trial is almost always a setup problem, not a hyperparameter problem.
2. Follow **To do:**; the specific cases below give the underlying fixes.
3. Open **Results and artifacts** of one failed trial for the raw error text if the summary is not enough.
4. Relaunch only after the fix; launching again on the same study adds trials to the same run.

## "Dataset introuvable ou mal référencé"

**Symptom**: the diagnosis code is `dataset_missing`; the trial fails before any training output appears.

**Cause**: `data.yaml` was not found at the given path, or its `path`/`train`/`val` keys point to folders that do not exist on the backend machine. For the detection preset, the **Chemin data.yaml** field must be a path as seen by the backend, not by your local machine.

**Solution**:

1. Check the absolute path typed in **Chemin data.yaml** (or in the fixed arguments of your own script).
2. Open `data.yaml` and check that `path`, `train` and `val` resolve to existing `images/` and `labels/` folders once combined.
3. For an Orchestrator study, confirm that the upstream node produced a YOLO export; a `.zip` export is extracted once into `hpo_datasets/<name>/` of the workspace and reused.

## "Mémoire GPU insuffisante" (CUDA out of memory)

**Symptom**: the diagnosis code is `cuda_oom`; the trial fails partway through a training epoch.

**Cause**: the batch size or the image size of the engine, combined with the model size chosen in the preset, does not fit in the available VRAM. Several trials or apps sharing the same GPU at once make this worse.

**Solution**:

1. Choose a smaller model size in **Modèle YOLOX** (or the equivalent field of another engine).
2. Reduce batch or image size if your script exposes them as hyperparameters.
3. Close other GPU processes (Training App, Inference App, another running study) before launching.

## "CUDA ou pilote GPU indisponible"

**Symptom**: the diagnosis code is `cuda_unavailable`; every trial fails immediately, even a minimal one.

**Cause**: the NVIDIA driver is missing or too old, or the installed PyTorch build does not match the CUDA version, so no trial can even start training on the GPU.

**Solution**:

1. Run `nvidia-smi` on the backend machine; if it fails, fix the driver first.
2. Check that PyTorch was installed with CUDA support (`python -c "import torch; print(torch.cuda.is_available())"` in the `IA_env` environment).
3. If the GPU truly cannot be used, force CPU in your own script to at least validate the rest of the pipeline; the detection preset expects a GPU.

## "Poids ou modèle introuvable"

**Symptom**: the diagnosis code is `model_missing`.

**Cause**: the requested model size has no cached starting weights, or a custom `--weights` path does not exist.

**Solution**:

1. Check the model size selected in the preset against the sizes listed by `GET /api/orchestrator/engines`.
2. Let Training App download or build its default weights once outside of a study, then relaunch.
3. For a custom starting checkpoint, confirm the `--weights` path (or the equivalent fixed argument on your own script) is an absolute path readable from the backend machine, not from your local Windows workstation.

## "Trial trop long ou bloqué" (timeout)

**Symptom**: the diagnosis code is `timeout`; a trial disappears from the log without a final metric after a long wait.

**Cause**: the trial exceeded its time limit: 20 minutes for an Orchestrator study (`trial_timeout_s`, configurable on the node) or 1 hour for a study launched from the launch page. A very large dataset, too many epochs per trial, or a stuck DataLoader can all cause this.

**Solution**:

1. Check `results.csv` of the trial before raising the timeout: if epochs were progressing normally, the trial was simply too slow for the limit; if it never started, the process was stuck.
2. Lower **Epochs par trial**, the dataset size for the trials, or the model size.
3. On Windows, confirm `workers` is `0` (the app's default); a non-zero DataLoader worker count is a common cause of a silent freeze before the first epoch.

## "Métrique objectif illisible" (metric parse error)

**Symptom**: the diagnosis code is `metric_parse`; the trial otherwise seems to have run.

**Cause**: for a standalone study, the script did not print a plain number on the last line of its output, and no `metric_name=value` line was found either. For an Orchestrator study, `result.json` was missing or invalid.

**Solution**:

1. Check that your script's last `print(...)` is exactly the numeric value, with nothing else on that line.
2. If the script also logs progress after computing the metric, print `metric_name=value` as a fallback line instead of relying on the very last line.
3. Verify **Metric name** on the launch page matches the key used in that fallback line.

## "Dépendance Python manquante"

**Symptom**: the diagnosis code is `dependency_missing`; the error mentions `ModuleNotFoundError` or `ImportError`.

**Cause**: a package used by the script or by the training engine is not installed in the Python environment that runs the backend (`IA_env` by default).

**Solution**:

1. Activate the same environment the backend uses and install the missing package.
2. Restart the backend: a package installed while it is running is not picked up.
3. If the missing module belongs to a training engine plugin rather than to your own script, confirm the plugin is installed in the same environment as Training App, since Optuna App imports the engine catalog through it.

## The detection training preset does not appear on the launch page

**Symptom**: opening **Launch an optimization** shows no **Optimiser un entraînement de détection** panel, only the generic script fields.

**Cause**: the backend could not import Training App's training engines. This happens when Training App is not installed next to Optuna App, or when `GET /api/orchestrator/engines` returns an empty `engines` list with an `error`.

**Solution**:

1. Open `http://localhost:<backend-port>/api/orchestrator/engines` directly and read the `error` field.
2. Confirm `Training_App/backend/services/trainer_backend.py` exists at the expected relative path next to `Optuna_App/`.
3. Studies on your own script do not need Training App and still work with this panel absent.

## Trial logs stop updating on the launch page

**Symptom**: the **Output** panel of the launch page freezes while the study status on the study page still changes.

**Cause**: the log stream (`GET /api/studies/{name}/logs`) is a direct fetch to the backend port, deliberately bypassing the Vite proxy, which buffers server-sent events. A closed browser tab, a network interruption, or a backend restart breaks that connection without breaking the study itself.

**Solution**:

1. Reload the launch page: the log stream reconnects and replays from the current cursor.
2. Check the study page instead; its counters and dashboard refresh independently of the log stream and reflect the true state.
3. If the backend was restarted, in-memory run state (the "En cours" badge, the live log buffer) is lost, but the trials already recorded in `optuna.db` are not.
