---
app: training
doc_type: troubleshooting
audience: both
lang: en
title: Troubleshooting
order: 50
tags: [errors, cuda, mlflow, dataset, reload, orchestrator, weights]
sources: [Training_App/backend/services/training_service.py, Training_App/backend/services/trainer_backend.py, Training_App/backend/services/yolox_dataset.py, Training_App/backend/services/yolox_trainer.py, Training_App/backend/routers/training.py, Training_App/backend/routers/orchestrator.py, Training_App/backend/database.py]
---

# Troubleshooting

## Start refused with "data.yaml introuvable"

**Symptom**: clicking **Start** shows an error "data.yaml introuvable : '<path>'" and the run is never created.

**Cause**: `POST /api/training/start` checks that the path in **data.yaml path** exists on the backend machine before doing anything else. A path valid on your workstation is meaningless when the backend runs on a remote VM: only paths reachable from the backend are checked.

**Solution**:

1. Check the path as seen by the backend, not by your workstation: with a remote VM, use its own path (for example `/srv/datasets/run01/data.yaml`), not a Windows path.
2. Check that the file exists at that exact path (`data.yaml`, not the dataset folder).
3. If the dataset comes from an Annotation App export, copy the path shown at the end of the export, then append `/data.yaml`.

## Start refused with "model_size invalide" or a weights error

**Symptom**: **Start** shows "model_size invalide pour le moteur '<engine>' : ..." or "Poids '<file>' incompatibles avec le moteur '<engine>' (extensions attendues : ...)".

**Cause**: the size or the starting weights do not match the catalog of the chosen engine. This is checked before the run starts, so no GPU time is wasted on a request that would fail anyway. Weights are matched only by file extension: a `.pth` file that is not a real YOLOX checkpoint passes this check but fails when the checkpoint is actually loaded (see the next entry).

**Solution**:

1. Check **Size** in the model panel: it must be one of the buttons shown for the current **Engine**.
2. Check the extension of **Starting weights (optional)**: `.pth` for YOLOX, another extension for a plugin engine (see its catalog in `GET /api/training/models?engine=<name>`).
3. If you changed engine after typing a weights path, clear the field: sizes and extensions of the previous engine do not apply to the new one.

## Run fails immediately with a checkpoint loading error

**Symptom**: the run reaches **Error** within seconds of starting, with a message mentioning `state_dict`, `size mismatch`, `Unpickling error` or a similar `torch.load` failure.

**Cause**: **Starting weights (optional)** points to a `.pth` file that is not a YOLOX checkpoint of the selected size (a checkpoint from a very different architecture, a corrupted download, or a checkpoint saved by another PyTorch version with incompatible internals).

**Solution**:

1. Check that the file was produced by YOLOX (a previous Training App run, or an official YOLOX release), not by another framework saved with the same extension.
2. Check that the size selected in the form matches the size the checkpoint was trained with; a mismatched size makes most layers incompatible in shape, not just a few (see [Concepts](concepts.md), section *Starting weights: training from scratch or fine-tuning*).
3. Re-download the file if it may be corrupted (partial download, interrupted copy to the backend machine).

## CUDA out of memory during a run

**Symptom**: the run reaches **Error** with a message containing `CUDA out of memory` or `OutOfMemoryError`, sometimes only after a few epochs.

**Cause**: the batch of images at the current **Image size**, together with the network activations, no longer fits in the GPU memory. Larger sizes (`yolox-l`, `yolox-x`), a higher **Batch size** or a higher **Image size** all raise the memory used. Other processes on the same GPU (another user, an Inference App run, a second Training App run) reduce what is available.

**Solution**:

1. Lower **Batch size** first; it has the most direct effect on memory.
2. Lower **Image size**, or choose a smaller model size.
3. Check with `nvidia-smi` on the backend machine whether another process already uses the GPU.
4. Enable **FP16 (mixed precision)** to reduce memory at a similar accuracy, on a GPU that supports it.
5. Avoid running two trainings, or a training and an Inference App evaluation, on the same GPU at the same time.

## The run restarts on its own and loses progress

**Symptom**: a run in progress disappears or restarts from the beginning, with no error shown in the interface; the backend terminal shows uvicorn reloading.

**Cause**: the backend was started with `--reload` (the default of the launchers without `--no-reload`), which restarts the whole process whenever a Python file of the app changes on disk. A run is a background thread of that process: it is lost on restart, along with the events not yet read by the interface. A `.py` file touched by an editor, a `git checkout`, or another process writing into the backend folder can trigger this even without an intentional code change.

**Solution**:

1. For long trainings, launch with `--no-reload` (`python launcher.py --app training ... --no-reload`, or the same flag on `Training_App/launcher.py`).
2. Avoid editing backend files while a long run is in progress.
3. After an unwanted restart, the run stays at its last saved status in **History** (usually still **Running**, never updated again); delete it and start a new one.

## A run stays "En attente" and never starts training

**Symptom**: a run appears in **History** with the status **En attente** (Pending) and never moves to **Running**.

**Cause**: `start_training` failed to find the run in the database right after creating it, or the backend process restarted between the creation of the database row and the start of the background thread (see the previous entry). This is rare and points to a backend restart or a database issue at that exact moment.

**Solution**:

1. Check the backend terminal for a traceback around the time the run was created.
2. Check that `training.db` in the workspace is not on a network share with weak file locking (see [Configuration](configuration.md)).
3. Delete the stuck run and start a new one; a single occurrence is usually not worth investigating further.

## Metrics stay empty in Progress or in the run curves

**Symptom**: the **Progress** panel shows the epoch counter and losses but no `metrics/mAP50(B)` tile; the **History** table shows "-" for mAP50 even after several epochs; the curves in the run detail stay empty.

**Cause**: YOLOX only evaluates the model every **Eval interval (ep.)** epochs (10 by default), plus during the final epochs without augmentation. Epochs between two evaluations only report losses, by design (see [Concepts](concepts.md), section *Epochs, evaluation interval and the final epochs without augmentation*). The mAP evolution chart only appears once at least two evaluated epochs exist.

**Solution**:

1. Wait for the next evaluation, or check **Eval interval (ep.)** in the **Training** group of hyperparameters before starting a run where you want frequent feedback.
2. For a short test run, lower **Eval interval (ep.)** to 1 so every epoch is evaluated.
3. If **Epochs** is lower than **Eval interval (ep.)**, only the final epoch is evaluated: metrics appear only at the very end.

## Analysis plots are missing or show an old model

**Symptom**: the **Model analysis** section of a finished run shows "No analysis plot (run not finished or plots disabled)." even though the run is **Done**, or **Validation** predictions look older than the final model.

**Cause**: plots are written under `artifacts/` of the run folder only at evaluation epochs; a run stopped before its first evaluation, or one whose folder was moved or deleted, has nothing to show. `val_batch0_pred.jpg` is regenerated at every evaluation but not after the run ends, so it reflects the model of the last evaluation, which can be an earlier epoch than the final one when mAP50-95 later dropped (the file itself is always overwritten, its content is simply from that last evaluation).

**Solution**:

1. Check that the run reached at least one evaluation (current epoch at least **Eval interval (ep.)**, or the run reached its last epoch).
2. Check that the run folder (`runs/<run name>/`) still exists on the backend machine; a deleted or moved folder breaks the gallery even if the run stays in **History**.
3. Compare the epoch of the plots (visible in `results.csv` of the run folder) with the final epoch if an exact match matters.

## "engine_error" shown instead of the analysis plots

**Symptom**: the **Model analysis** section shows an amber message instead of any plot, or `GET /api/training/<run name>/artifacts` returns an `engine_error` field.

**Cause**: the run was trained with a plugin engine that is no longer installed (removed plugin, missing library), so its catalog (which lists where the plots live) cannot be read.

**Solution**:

1. Reinstall or fix the engine plugin used by the run (see [Configuration](configuration.md), section *Installing a training engine plugin*).
2. Check `GET /api/capabilities`: the engine must be listed with `"available": true`.
3. If the engine cannot be restored, the run's weights may still be usable directly (the file itself does not depend on the plugin being installed), but the gallery and the best/worst case inference stay unavailable.

## The Orchestrator step for Training times out or never continues

**Symptom**: an Orchestrator pipeline stays stuck on the Training node for a long time, or the automatic step reports a timeout message ("Entrainement encore en cours (timeout attente)").

**Cause**: `POST /api/orchestrator/train` waits for the run to reach **Done**, **Error** or **Stopped** before answering (blocking mode, the default), for up to `TRAINING_ORCH_MAX_WAIT_S` seconds (90 minutes by default). A long training (many epochs, a large model, a slow GPU) can exceed this window; the call then returns a "still running" message instead of the final result, and the Orchestrator step does not get the weights it expects.

**Solution**:

1. For long trainings driven by the Orchestrator, raise `TRAINING_ORCH_MAX_WAIT_S` on the Training App process before running the pipeline.
2. Alternatively, set `TRAINING_ORCH_BLOCKING=0` so the call returns as soon as the run starts, and poll `GET /api/orchestrator/run-status?run_name=...` from outside; this only applies to custom integrations, not to the Orchestrator App's own pipeline runner, which expects the blocking behavior.
3. Check **History** directly: if the run reached **Done**, the training itself succeeded even if the Orchestrator call timed out.

## "database is locked" errors

**Symptom**: an action fails with a message containing `database is locked`, usually when several runs write to the database at the same time.

**Cause**: `training.db` is a SQLite file; SQLite accepts a limited number of concurrent writers. Several backend processes writing to the same file (two launcher instances pointed at the same workspace, a workspace placed on a network share with weak locking) increase the chance of this error.

**Solution**:

1. Never launch two backend instances on the same workspace; each user should have their own `training_<user>` workspace.
2. Keep the workspace, or at least `training.db`, on a local disk of the backend machine rather than on a network share.
3. Retry the action; a transient lock during a short write usually clears itself.

## The backend does not start

**Symptom**: the backend terminal stops with an error at startup, and the interface shows nothing or "the backend is not responding".

**Cause and solution by message**:

- `ModuleNotFoundError: No module named 'yolox'`: the vendored YOLOX code is not on the Python path; start uvicorn from `Training_App/` (not from a subfolder), which is how `backend/services/yolox_model.py` adds `backend/vendor/yolox/` to `sys.path`.
- `ModuleNotFoundError: No module named 'pycocotools'` (or `thop`, `loguru`, `tabulate`): a dependency of the vendored YOLOX code is missing from the environment; install it (see [Configuration](configuration.md)).
- `Address already in use` / port 8064 in use: another instance is already running. Let the launcher allocate a free port, or find and stop the process (`netstat -ano | findstr :8064` then `taskkill /PID <pid> /F` on Windows).
- Errors about CUDA or `torch`: the installed PyTorch build does not match the driver. Check `nvidia-smi` and `python -c "import torch; print(torch.__version__, torch.version.cuda)"`, then reinstall PyTorch for the right CUDA version.

For the frontend, `Cannot find module 'vite'` means the frontend dependencies are missing: run `npm install` in `frontend/`.
