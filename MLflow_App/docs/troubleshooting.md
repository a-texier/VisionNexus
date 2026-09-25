---
app: mlflow
doc_type: troubleshooting
audience: both
lang: en
title: Troubleshooting
order: 50
tags: [errors, sqlite, store, lineage, orchestrator, artifacts]
sources: [MLflow_App/backend/core/mlflow_client.py, MLflow_App/backend/api/experiments.py, MLflow_App/backend/api/runs.py, MLflow_App/frontend/src/pages/LineagePage.tsx]
---

# Troubleshooting

## Sidebar status dot shows "MLflow off"

**Symptom**: the sidebar shows a red dot and "MLflow off" instead of a green dot and a version number.

**Cause**: `is_mlflow_running()` could not confirm the store is reachable. With the default serverless SQLite store, this means `search_experiments()` failed against `mlflow_data/mlflow.db`; with an explicit `http://...` `MLFLOW_TRACKING_URI` (legacy server mode), it means a `GET /health` to that server failed.

**Solution**:

1. Open `http://localhost:<backend-port>/api/mlflow-status` directly: `running: false` confirms the problem is in the backend, not just a stale frontend poll (it refreshes every 15 seconds).
2. Check that `mlflow_data/mlflow.db` exists under the expected workspace (see [Configuration](configuration.md#workspace-layout-on-disk)); a workspace mismatch (wrong `--user` or `--workspace`) is the most common cause.
3. If `MLFLOW_TRACKING_URI` was set to an `http://...` value on purpose, confirm that server process is actually running; otherwise unset the variable to fall back to the serverless default.

## "Serveur MLflow non disponible. Verifier que MLflow tourne sur le port 5000."

**Symptom**: this exact message appears as a 503 error when opening the experiments list, even though no MLflow server process or port 5000 is involved in the normal serverless setup.

**Cause**: this error text predates the serverless pivot of the app and was not updated afterward (`backend/api/experiments.py`); it still fires correctly whenever `is_mlflow_running()` returns false, but its wording describes the old server-mode failure, not the SQLite-file failure that actually causes it today.

**Solution**:

1. Ignore the mention of port 5000: it does not apply to the default configuration.
2. Follow the steps of *Sidebar status dot shows "MLflow off"* above; the real cause is the SQLite file being unreachable, not a server port.

## An experiment or a run does not appear after training

**Symptom**: a training just finished in Training App (or another writer app), but the run is missing from Lineage, Comparer or the Experiments page.

**Cause**: MLflow App reads the SQLite store of the **current user's** workspace only. The most common cause is a mismatch between the user name used to launch the training and the user name used to launch MLflow App, which resolves to two different `mlflow_<user>/mlflow_data/` folders.

**Solution**:

1. Confirm both apps were launched with the same `--user` (or, from VisionNexus, the same session).
2. Refresh the page: Lineage and the Experiments page do not auto-refresh on their own for new runs.
3. Check that the writer app actually logged successfully: its own logging is fully defensive (a training continues even if `mlflow` is missing or fails), so a logging failure produces no error in the training but silently skips the run. Check the writer app's own logs for an `mlflow_logging` warning.

## Lineage page shows "Orchestrator indisponible : lineage canonique inaccessible."

**Symptom**: the Lineage page fails to load its graph with this error, even though the MLflow status dot in the sidebar is green.

**Cause**: the Lineage page's graph comes from the Orchestrator's `/api/lineage` endpoint, proxied through `/orchestrator-api`, not from MLflow's own store directly. This error means the Orchestrator backend was not reachable at `VITE_ORCHESTRATOR_BACKEND_PORT` (8060 by default), independent of whether the MLflow store itself is fine.

**Solution**:

1. Confirm the Orchestrator App is running; MLflow App does not start it automatically.
2. If the Orchestrator runs on a non-default port, check `VITE_ORCHESTRATOR_BACKEND_PORT` was set correctly before the frontend started (see [Configuration](configuration.md)).
3. Use **Comparer** or **Experiments** in the meantime: both read the MLflow store directly and do not depend on the Orchestrator being reachable.

## A run's plot gallery or artifact link is broken

**Symptom**: a run's detail page shows its metrics and parameters correctly, but the **Plots** gallery is empty or an artifact fails to open (404).

**Cause**: metrics and parameters live in `mlflow.db`; artifact files live separately under `mlflow_data/artifacts/<experiment>/<run>/`. The two can go out of sync if the `artifacts/` folder (or a run's subfolder inside it) was moved, deleted, or not copied along when backing up or migrating a workspace.

**Solution**:

1. Confirm `mlflow_data/artifacts/` exists next to `mlflow.db` in the workspace and was migrated together with it.
2. Re-run the training if the artifacts are genuinely gone; the database record of the run stays, but its files cannot be recovered from MLflow App itself.
3. When copying or backing up a workspace, always copy `mlflow_data/` as a whole (database and `artifacts/` together), never `mlflow.db` alone.

## Model Registry shows no version for a run that should have one

**Symptom**: a training completed with a good metric, but no version appears under its model name in the Model Registry.

**Cause**: the writer app registers a model version only when its final weights file exists on disk at the time of logging; a training that fails after computing its metric but before saving its checkpoint, or one whose metric is not positive, never calls `register_model`.

**Solution**:

1. Open the run's detail page and check **Artifacts** for a weights file under `model/`; its absence confirms nothing was registered for this run.
2. Check the writer app's own logs (Training App) around the end of that run for an error during checkpoint saving.
3. This is expected, not a bug in MLflow App: only runs that produced weights and a usable metric are meant to become registry versions.
