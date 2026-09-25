---
app: orchestrator
doc_type: troubleshooting
audience: both
lang: en
title: Troubleshooting
order: 50
tags: [startup, sse, human gate, sub-apps, ports, dvc, optuna, unc paths]
sources: [Orchestrator_App/backend/config.py, Orchestrator_App/backend/api/graphs.py, Orchestrator_App/backend/core/graph_runner.py, Orchestrator_App/backend/core/pipeline_runner.py, Orchestrator_App/backend/core/app_launcher.py, Orchestrator_App/backend/utils/native_share.py, Orchestrator_App/launcher.py]
---

# Troubleshooting

## The backend refuses to start, complaining about the user name

**Symptom**: the backend process exits immediately, printing "ORCHESTRATOR_USER n'est pas défini et le login OS n'a pas pu être déterminé...".

**Cause**: `ORCHESTRATOR_USER` was not set (or was set to a placeholder such as `unknown`, `user` or an empty string), and the OS login name could not be read either. The backend refuses to guess, because a shared placeholder user would make two people silently write to the same workspace and the same SQLite databases.

**Solution**:

1. Always launch through `launcher.py --user <name> --workspace <path>` (or from VisionNexus, which fills the user field); never start `uvicorn backend.main:app` by hand.
2. If you must set the environment manually, export a real, non-placeholder `ORCHESTRATOR_USER` before starting uvicorn.

## "Run" is disabled or fails with "This graph is already running"

**Symptom**: clicking **Run** does nothing, or the top bar shows the elapsed-time counter and **Stop** even though you never clicked Run yourself; a direct API call returns HTTP 409 "This graph is already running".

**Cause**: the graph's stored status is still `running` from a previous launch, either because a run is genuinely in progress in another browser tab, or because the backend restarted while a run was active and the graph was never cleanly finalized.

**Solution**:

1. Reload the Sandgraph page; the graph list polls `/api/graphs` regularly, which resynchronizes the status from the actual run state (or marks it `stopped` if the run is gone from memory).
2. If the status still looks stuck, click **Stop**, then **Reset**.
3. If neither button appears because the page shows a stale state, navigate away and back to the Sandgraph, or restart the backend.

## A node stays gray or the graph looks frozen mid-run

**Symptom**: a node stays stuck in `running`, or the pipeline appears to have stopped advancing; nodes stay in their last visible color, no new log line appears, but the backend is still running.

**Cause**: the frontend follows the run through a Server-Sent Events (SSE) stream over `fetch()`, opened once when you click **Run**. If that connection fails on its very first attempt (a transient error, the tab losing focus, a dev proxy hiccup) it is not automatically retried, unlike a browser `EventSource`. The pipeline itself keeps running in the backend regardless; only the live view stops updating.

**Solution**:

1. Wait a few seconds: `list_graphs()` and `get_graph()` resynchronize the node execution state from the real run state on every poll, even without an active SSE connection, so the page catches up within one poll cycle (about five seconds) once you reload it or switch away and back.
2. If nothing changes after a reload, check the backend log for the step currently running; a step waiting on a slow sub-application is not a frozen pipeline.
3. As a last resort, **Stop** then **Run** again; steps that already succeeded are not repeated unless you also **Reset**.

## "Pipeline state lost (server restarted). The graph was reset"

**Symptom**: clicking **Terminé -> Continuer** at a human gate returns this HTTP 410 error, and the graph switches to `idle`.

**Cause**: the run state lives only in the backend's memory (`_active_runs`), never on disk. If the backend process restarted (a crash, a manual restart, an update) while a graph was waiting at a gate, that run no longer exists anywhere to resume.

**Solution**: this is expected after a backend restart, not a bug to fix. Click **Run** again on the reset graph; if the earlier steps produced outputs that are still valid (an existing subset or export), consider switching the corresponding node to FREE mode instead of regenerating them from scratch.

## The "Intervention requise" banner keeps reappearing after you continue

**Symptom**: you click **Terminé -> Continuer**, the banner briefly disappears, then comes back showing the same gate.

**Cause**: historically, this was a loop bug in the SSE replay logic (fixed): on reconnect after a resume, the event stream could exit on a historical "waiting" event while the node execution state was regressed back to "waiting" at the same time. If you still see this behavior, the backend is likely running an old build.

**Solution**: update Orchestrator_App to the current version. If it persists, check the backend log for repeated `event_generator` / `update_node_exec` messages around the gate's step id, and report it with that log excerpt; do not work around it by spamming the continue button, since each click validates the step again.

## A step fails with "<app> not reachable after 240s"

**Symptom**: a pipeline step fails with a message such as "Training_App not reachable after 240s (cold start took too long).".

**Cause**: the sub-application needed by this step did not answer `/health` within four minutes of being launched. This can happen on a slow machine, when several apps were auto-launched back to back, or when the app crashed during its own startup (for example a missing model checkpoint).

**Solution**:

1. Open the **Applications** page and check the status of the app named in the error; **Échec du démarrage** (startup failed) shows the reason and the backend log path.
2. Fix the underlying issue (missing dependency, bad workspace path, port conflict) and restart the app from that page.
3. Once the app shows **running** and answers quickly, restart the pipeline; steps already completed are skipped unless you also **Reset**.

## A sub-app shows "Échec du démarrage" on the Applications page

**Symptom**: an application card shows a red **Échec du démarrage** (startup failed) block with a reason such as "Le backend s'est arrêté (code 1)." and a log path.

**Cause**: the backend or frontend process of that sub-application exited on its own shortly after being spawned; `get_all_sessions()` detects the dead process and surfaces its exit code and the tail of its log file.

**Solution**:

1. Read the log file at the path shown (or open it directly on disk); it usually points to a Python import error, a missing model file, or a port already held by a stale process from an earlier crash.
2. Fix the cause, then click **Lancer** again on that app's card.
3. If the app's port is suspected to be stuck (a previous process did not release it), stop the app first; `stop_app()` also does a best-effort kill of anything still bound to its port before it hands the port back.

## Save or Run is blocked by a validation error

**Symptom**: clicking **Sauvegarder** or **Lancer** shows a red toast such as "Annotation : entrée obligatoire manquante , images" or "Pré-contrôle bloquant : ... n'utilisent pas le même moteur".

**Cause**: the graph fails one of the port or model-lineage checks: a required input is not connected (and the node is not in FREE mode), two mutually exclusive inputs are both connected, or two nodes in the same model lineage (Modèle, Optuna, Training, Inference / Eval) declare different training engines or sizes. These checks exist to catch a broken graph before spending time launching sub-applications.

**Solution**:

1. Read the exact node and port named in the message; open its configuration panel.
2. For a missing required input, connect the right upstream node, or switch the node to FREE mode if you intended to reuse an existing output instead.
3. For an engine or size mismatch, align the **Moteur d'entraînement** (and, for a locked size, **Taille**) field on every node of the lineage; a checkpoint only reloads with the exact engine and size that produced it.

## Optuna fails with "HPO FAILED - 0/N trial completed"

**Symptom**: the DVC node's Optuna artifact shows an error such as "HPO FAILED - 0/20 trial completed. No Optuna best_params produced. Training fell back to the configured/default parameters, without Optuna optimization.", or the whole pipeline stops at the Optuna step.

**Cause**: every trial of the study failed inside Optuna App (commonly a dataset path problem, an out-of-memory training, or a misconfigured search space), so no usable best parameters were produced.

**Solution**:

1. Open Optuna App and check the study's trial logs for the actual per-trial error.
2. If **Arrêter le pipeline si aucun trial n'aboutit** was checked on the Optuna node, the pipeline stops here by design; fix the underlying training problem and rerun.
3. If it was unchecked, the downstream Training already ran with its own configured (or default) hyperparameters instead of Optuna's; this is not a failure of the overall pipeline, only of the HPO step, and the DVC panel keeps the error visible so it is not mistaken for a real optimization result.

## DVC Commit's "Créer une version" button stays disabled

**Symptom**: the DVC node shows artifacts but the **Créer une version DVC (Git + cache DVC)** button never becomes clickable, or clicking it returns "No existing artifact selected to version." or "The run must be finished before creating a DVC version".

**Cause**: either no run of this graph has finished successfully yet (`runCtx.run_id` is empty), or every checkbox in the artifact list is unchecked, or the checked artifacts have not actually been produced (`exists` is false, shown as "pas encore produit - lancez le pipeline").

**Solution**:

1. Run the graph to completion at least once; the DVC panel only reads artifacts tied to a specific finished run, never a guess based on the newest file in the workspace.
2. Check at least one artifact whose row does not say "pas encore produit".
3. If a run finished but the artifact list looks empty, click **rafraîchir**; the panel does not poll on its own.

## A dropped or typed Windows path is not found by a sub-application

**Symptom**: a path field (dataset, model, sequence, annotation file) accepts a Windows or UNC path such as `\\server\share\images`, but the pipeline step fails with a "path not found" style error from Dataset_Explorer_App, Annotation_App or Inference_App.

**Cause**: the Orchestrator backend runs as PosixPath on the machine it is deployed on (typically a Linux GPU VM); a Windows path only exists on the Windows workstation. Orchestrator translates a UNC path to a POSIX path once, at graph-build time, using the known shared roots (`home`, `mnt`, `srv`, `media`, `data`); if the share is mounted under a root that is not in that list, or under a different share name than what Windows shows, the translation fails and the original string is passed through unchanged.

**Solution**:

1. Check where the share is actually mounted on the backend machine (for example `ls /srv/datasets/...`) and compare it against the UNC path you typed or dropped.
2. If the mount uses a root outside `home`, `mnt`, `srv`, `media`, `data`, either remount it under one of these, or type the POSIX path directly instead of the Windows path.
3. Remember that this translation only runs on the four path fields Orchestrator itself sends downstream (`dataset_path`, `model_path`, `sequence_dir`, `annotation_file`); a path typed inside a sub-application's own UI follows that application's own rules instead (see its Troubleshooting page).

## Launching an app fails with "port already in use" or ports keep shifting

**Symptom**: `launcher.py` (or the **Applications** page) fails with a message naming a fixed port as already in use, or successive launches land on higher and higher port numbers than expected.

**Cause**: a fixed `--backend-port` / `--frontend-port` was requested but is genuinely held by another process, or an earlier session of the same app was stopped uncleanly and its stale entry in the shared port registry (`Computer_Vision_App/.run/.instances.json`) is still reserving its port. A stopped session does not reserve its port for a plain restart, but a session that never got the chance to unregister itself (a hard kill instead of a clean stop) can leave one behind.

**Solution**:

1. For a fixed-port failure, either free that port or drop `--backend-port` / `--frontend-port` to let the launcher pick a free one automatically.
2. If ports keep drifting upward across restarts, check `Computer_Vision_App/.run/.instances.json` for stale entries pointing at PIDs that no longer exist, and remove them; a clean **Kill All** from the Applications page before closing the app avoids this in normal use.
