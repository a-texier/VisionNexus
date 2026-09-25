---
app: annotation
doc_type: troubleshooting
audience: both
lang: en
title: Troubleshooting
order: 50
tags: [errors, vram, samurai, smb, ssh, startup, performance]
sources: [Annotation_App/backend/main.py, Annotation_App/backend/database.py, Annotation_App/backend/models/routers/sam.py, Annotation_App/backend/models/routers/tracking.py, Annotation_App/backend/models/routers/dataset.py, Annotation_App/backend/utils/native_share.py, Annotation_App/frontend/src/services/api.ts, Annotation_App/frontend/src/components/sidebar/TrackPanel.tsx, Annotation_App/frontend/src/pages/AnnotationPage.tsx]
---

# Troubleshooting

## "The backend is not responding" message and the interface freezes

**Symptom**: a red message "The backend is not responding (calculation in progress?) - request aborted" appears, buttons stop reacting, or the Tracks panel shows "Backend connection lost: polling stopped.".

**Cause**: every request of the interface has a 30-second timeout (longer for uploads). The message appears when the backend does not answer in time: the backend process stopped or restarted (crash, `--reload` after a file change), the SSH tunnel to the VM dropped, or the backend is saturated by very heavy requests, for example 16-bit images read from a slow network mount while an import and a propagation run at the same time. The server is sized so that requests never wait for a database connection (a pool of 60 connections for 96 worker threads); if the pool is still exhausted, requests now fail after 10 seconds instead of hanging.

**Solution**:

1. Look at the backend terminal or at the log of the Annotation tab in VisionNexus: a Python traceback means a crash, a restart message means an auto-reload.
2. Check that the backend answers: open `http://localhost:<backend port>/health`. If it does not answer, restart the app from VisionNexus or with the launcher.
3. With a remote VM, check the SSH connection; VisionNexus reconnects the tunnel when the tab is reopened.
4. If the freeze happens only during a propagation, wait for it to finish or stop it with the red stop button; reduce concurrent work (no import and propagation at the same time on a slow mount).
5. Reload the page (`F5`) once the backend answers again; the session is restored.

## The projects page is empty right after launch

**Symptom**: Annotation App opens, but the projects page shows "No project yet." although projects exist, or it keeps loading. The frontend console may show `[vite] http proxy error: /api/projects`.

**Cause**: the interface was opened before the backend was ready. The Vite frontend is ready in about one second, while the backend needs 10 to 40 seconds to load PyTorch, CUDA and SAM2. Requests sent during that time fail and are not replayed. VisionNexus waits for the backend `/health` endpoint and shows "Backend en cours de demarrage (chargement des modeles)..." (backend starting, loading models) before opening the tab, but a manual launch or a browser bookmark can still hit the gap. A second cause is a different workspace: the app was launched with another `--user` or `--workspace`, or manually without `ANNOTATION_WORKSPACE` (which uses `Annotation_App/data/`).

**Solution**:

1. Wait until the backend terminal prints "Application prete" (application ready), then reload the page.
2. Open the **Workspace** menu at the bottom left of the projects page and check the path. If it is not the expected workspace, relaunch with the right `--workspace` and `--user`.
3. Check that `annotation.db` exists in that workspace. If it was deleted, a new empty database was created: restore it from your backup, or rebuild projects from the automatic backups in `backup/` (see [Workflows](workflows.md)).

## SAM Point does nothing or shows "SAM point error"

**Symptom**: clicking on the canvas with **SAM Point** produces no mask, or the message "SAM point error - check that SAM2 is loaded" appears. **SAM Auto** fails with "SAM Auto error".

**Cause**: SAM2 is not loaded. At startup, the backend loads `backend/checkpoints/sam2.1_hiera_small.pt` (or the tiny checkpoint). If neither file exists, or if the `sam2` Python package is missing, the server starts anyway but every SAM request fails with "Modèle SAM2 non chargé" (SAM2 model not loaded).

**Solution**:

1. Open `http://localhost:<backend port>/api/sam/ping`: `"status": "not_loaded"` confirms the cause.
2. Check that `Annotation_App/backend/checkpoints/sam2.1_hiera_small.pt` exists. If not, download it with `python backend/tests/download_all_models.py --skip-sam3` or copy it from a bundle (see [Configuration](configuration.md)).
3. Check that the `sam2` package is installed in `IA_env` (`python -c "import sam2"`).
4. Restart the backend: the model is loaded only at startup.
5. Make sure a class is active: SAM masks are saved with the active class.

## Text detection fails with an error message

**Symptom**: pressing `Enter` in the text detection bar, running **Batch**, or starting the **Detect.** tab shows "Text detection :" followed by an error such as "Grounding DINO non disponible", "SAM3 non installé", "Checkpoint SAM3 absent" or "Erreur Grounding".

**Cause**: the chosen detector cannot run. Grounding DINO needs the `transformers` package and either the local folder `backend/checkpoints/grounding_dino/` or internet access to download `IDEA-Research/grounding-dino-tiny`; with `HF_HUB_OFFLINE=1` and no local folder, loading fails. SAM3 needs the SAM3 package and the checkpoint `backend/checkpoints/sam3.1/sam3.1_multiplex.pt`, which is gated on Hugging Face and not downloaded automatically.

**Solution**:

1. Check the detector status: `GET /api/sam/grounding/status` for Grounding DINO, `GET /api/sam3/status` for SAM3.
2. For Grounding DINO: `pip install transformers` (or from the offline wheels), then check that `backend/checkpoints/grounding_dino/config.json` and a weight file exist.
3. For SAM3: request access to `facebook/sam3.1` on Hugging Face, then run `python backend/tests/download_sam3.py` (or `download_all_models.py --hf-token ...`).
4. Restart the backend and try again, or switch to the other detector (**GD** / **SAM3**, or **GDINO** / **SAM3.1** in the Detect. tab).

If Grounding DINO detects nothing and no error appears, the toast reads "No object detected with this prompt.": the detector runs but no box passes the thresholds. Lower **Box:** and **Txt:**, and write the prompt as a short English noun (for example `car` or `person`), which this model handles best.

## Text detection asks for a class or stays disabled

**Symptom**: the run button of the text detection bar is disabled with a warning, or a message says "Create a class first in the Classes panel before running GD or SAM3." or "Select an active class before running GD or SAM3.". Drawing on the canvas shows "First create a class (Classes tab, + button) before you can annotate.".

**Cause**: every annotation belongs to a class, and automatic tools create annotations of the active class. When the project has no class, or no class is selected, the tools cannot save anything.

**Solution**:

1. Open the **Classes** tab of the right panel.
2. If the list is empty, click **+**, type a name and click **Create**.
3. Click the class to make it active (it is highlighted in blue).
4. Run the text detection again. To detect several object types, run the prompt once per class, changing the active class in between.

## CUDA out of memory during a SAMURAI or SAM2 propagation

**Symptom**: a SAMURAI or SAM2 propagation stops with an error mentioning `CUDA out of memory` or `OutOfMemoryError` in the **Logs** view or the backend terminal. The **Estimated max frames (fast GPU)** gauge of the SAMURAI tab was red before the run.

**Cause**: in fast GPU mode (the default), all frames of the range are kept in VRAM at 1024 x 1024. A 10 GB GPU holds about 350 to 450 frames; longer ranges, several targets, or other jobs on the same GPU (another user, Training App) exceed the memory.

**Solution**:

1. Reduce the range with **Up to frame** until the gauge is no longer red, and propagate in several chunks, each starting from the last good frame.
2. Or open **Settings**, section **Algorithms**, and uncheck **Fast GPU mode**: frames then stay in RAM, with no VRAM limit, at a cost of 1.5 to 3 times the time.
3. Decimate long videos at import (**Video frame decimation**) when consecutive frames are redundant.
4. Check with `nvidia-smi` that no other process uses the GPU memory.
5. On a small GPU, keep only the tiny SAM2 checkpoint, or run on CPU (very slow but without VRAM limit).

## The SAMURAI tab shows "Standard SAM2 (SAMURAI absent)"

**Symptom**: the badge of the **SAMURAI** tab reads **Standard SAM2 (SAMURAI absent)** or **SAMURAI installed, SAM2 running**, the button reads **Propagate via SAM2**, and **SAMURAI / object** is disabled with "Requires SAMURAI loaded".

**Cause**: the SAMURAI fork was not found in `backend/ext/samurai_repo/`, its package is not installed in the Python environment, or its configuration failed to load. The app then uses standard SAM2 video, which works but has no Kalman filter.

**Solution**:

1. On Windows, run `install_samurai.bat` from `Annotation_App/` (internet access needed); on an offline machine, copy `backend/ext/samurai_repo/` from a bundle and install its `sam2/` subfolder with `pip install -e`.
2. Restart the backend.
3. Check `GET /api/samurai/status` and the backend startup log, which prints whether the SAMURAI video predictor was loaded.

Standard SAM2 remains usable in the meantime: the difference matters mostly for occlusions and similar objects crossing.

## A propagation seems stuck at the start or does not stop

**Symptom**: after clicking a propagation button, the progress bar stays at 0 % with "Starting..." for a long time, or the stop button does not seem to act immediately.

**Cause**: before the first propagated frame, SAMURAI and SAM2 prepare the range: every frame is converted to an 8-bit JPEG (LUT applied) in `_tracking_tmp/` of the project, in parallel. On a long range read from a slow network mount, this phase can take a while. The stop request is checked between frames and during preparation, so it takes effect after the current frame. A very long Detect. frame (SAM3 on a large image) also delays the stop.

**Solution**:

1. Open the **Logs** view of the Tracks panel: preparation progress and the first frames are reported there, with the same lines as the server terminal.
2. Wait for the current frame; the status changes to "Stopping..." then to the final message.
3. For long ranges on network storage, propagate in chunks, or import the sequence as JPEG so that preparation only links files.
4. If nothing moves in the logs for several minutes, check the backend terminal for an error, then stop the task and restart the backend if needed.

## Boxes appear only at the end of a propagation

**Symptom**: during a SAMURAI or SAM2 run, the canvas stays on the same frame and the boxes appear only when the run ends, or only one frame out of several shows its boxes.

**Cause**: the canvas follows the propagation only when **Real-time live by default** is enabled in the **Interface** section of Settings. Even then, the canvas jumps at most once per interval set by **Propagation tracking: canvas cadence** (150 ms by default), so with a fast GPU some frames are skipped on screen. Annotations are committed to the database in batches during the run; the live boxes come from the WebSocket messages, and the database becomes the reference only after the final reload.

**Solution**:

1. Enable **Real-time live by default** in Settings, **Interface** section, then save.
2. Set the canvas cadence to 150 ms (or 0 to follow every GPU result).
3. Check the timeline: its cells turn green for every processed frame, whatever the cadence.
4. At the end of the run, the frames, tracks and annotations are reloaded once; if a frame still looks empty, navigate away and back.

## Gray screen when a propagation starts

**Symptom**: the annotation workspace turns gray or blank when a propagation starts, sometimes with `Maximum update depth exceeded` or `drawImage ... width or height of 0` in the browser console.

**Cause**: two situations used to break the page: the canvas alternated between cached annotations and live WebSocket annotations of the same frame, and a hidden or resizing VisionNexus tab reported a canvas size of 0 x 0. The current version prevents both (during a run the WebSocket is the only source of annotations for the canvas, and zero sizes are ignored). A gray screen now points to an older frontend build still cached, or to a new, different error.

**Solution**:

1. Reload the page (`F5`), or close and reopen the Annotation tab in VisionNexus to load the current frontend.
2. If it happens again, open the developer console (`F12`) and note the first error; check the backend log at the same time.
3. Disable **Real-time live by default** as a workaround: the canvas then stays still during the run and the result is reloaded at the end.

## Frames load slowly over SSH

**Symptom**: with the backend on a remote VM, changing frame takes a long time, the slider is jerky, or the first display of a frame stays blurred for seconds.

**Cause**: over SSH, every image goes through the tunnel and competes with the other requests; a browser opens at most 6 connections per origin. The first display of a large image never seen before (4K PNG, 16-bit TIFF on a network mount) costs its full size times the latency. Without a configured share host, VisionNexus cannot read pixels directly from the SMB share.

**Solution**:

1. Configure the share host (**Workspace** menu of the projects page, or `--native-share-host` in VisionNexus) so that images are read from the share instead of the tunnel.
2. Keep **Preview downscale (480/1600px)** enabled in Settings, **Interface**: the slider then loads 480 px previews and the canvas 1600 px images, with full resolution only when zooming in.
3. Import heavy datasets as JPEG (extraction) rather than 4K PNG, or keep a reasonable JPEG quality.
4. Navigate with the slider and release it on the target frame; the timeline never loads thumbnails, and prefetch only covers a few neighbors at rest.
5. Avoid running imports and propagations while browsing on a slow link.

## A gray placeholder is shown instead of the frame

**Symptom**: the canvas shows a uniform gray image instead of the frame, for one frame or for a whole sequence.

**Cause**: the backend sends a gray placeholder when the frame file is missing: a broken symbolic link (the source folder was moved, renamed or unmounted), or a video frame not extracted yet. The placeholder is marked as not cacheable, so the real image appears as soon as it becomes available.

**Solution**:

1. For a video being imported, wait for the orange extraction bar to finish; the canvas asks for extraction around the current frame first.
2. For a server folder, check that the source path of the sequence still exists on the backend machine and that the share is mounted (`ls` the folder on the VM).
3. If the source moved, restore it at its original path, or recreate the project by importing the new path and restoring the annotations from the backup (see [Workflows](workflows.md)).

## "Dossier introuvable" when importing a server path on a VM

**Symptom**: importing a server path fails with "Dossier introuvable" (folder not found), "Chemin introuvable" or "Ce chemin n'est pas un dossier", although the folder is visible from Windows.

**Cause**: the backend runs on Linux and only knows Linux paths. A Windows drive letter (`Z:\datasets`) means nothing on the VM. A UNC path (`\\host\share\...`) is translated to `/<root>/<share>/...` using the shared roots (`home`, `mnt`, `srv`, `media`, `data`), trying each root and keeping the first that exists; if none exists on the VM, the import fails. Dragging a folder from a Windows network drive works but uploads the files instead of referencing them.

**Solution**:

1. Use the path as seen by the backend, for example `/srv/datasets/run01`. Click **Server** in the import window to browse the backend folders and pick the right one.
2. For UNC paths, check that the share name corresponds to a folder under one of the shared roots on the VM (for example `\\host\datasets\run01` needs `/srv/datasets/run01` or `/mnt/datasets/run01`...).
3. Check the permissions: "Accès refusé à ce dossier" (access denied) means the backend user cannot read the folder.

## The logs show "REPLI HTTP" instead of "chemin NATIF (SMB)"

**Symptom**: at the start of a SAMURAI or SAM2 run, the log line `[SAM2Track] apercu temps reel : REPLI HTTP (...)` appears instead of `chemin NATIF (SMB)`, or VisionNexus logs `[app-image] repli HTTP: <reason>` instead of `[app-image] lecture native confirmee`. Live images during propagation are slower.

**Cause**: the backend could not translate the temporary frame folder into a UNC path: no share host is configured, or the project folder is outside the shared roots (`home`, `mnt`, `srv`, `media`, `data`). On the client side, the direct read can also fail when the share is not reachable from Windows or the credentials are missing; after a 1.5-second timeout VisionNexus falls back to HTTP. The backend line only tells the intended route; the `[app-image]` line tells the route actually used.

**Solution**:

1. Save the share host in the **Workspace** menu (or pass `--native-share-host` from VisionNexus), then start a new run.
2. Make sure the workspace lives under a shared root, for example `/srv/...` or `/data/...`, not under `/tmp`.
3. From Windows, open the UNC path shown in the log in the file explorer to check access and credentials.
4. The HTTP fallback keeps everything working; only speed is affected.

## Video import fails

**Symptom**: importing an `.mp4` or another video fails immediately or during extraction with "Erreur scan video", "Erreur extraction" or `ffmpeg not found` in the backend terminal.

**Cause**: video import needs ffmpeg and OpenCV video support in the backend environment. A corrupted or unsupported file, or a variable frame rate container, can also stop the extraction.

**Solution**:

1. Check `ffmpeg -version` in the backend environment. If missing, install it (`conda install -c conda-forge ffmpeg`, or `winget install Gyan.FFmpeg` on Windows) and restart the backend.
2. Try to open the video with another player; re-encode it with ffmpeg if needed.
3. For very long videos, use decimation (**Video frame decimation**) to reduce the number of frames.

## Homography propagation leaves boxes frozen or drifting

**Symptom**: after **Propagate via homography**, boxes stay at the same position over several frames while the scene moves, or they slowly slide off the objects.

**Cause**: frozen boxes mean the homography of those steps was rejected (too few inliers, or inlier ratio below the threshold): the boxes are then copied unchanged. This happens on low-texture scenes, fast camera motion or strong parallax. Drift means the objects move on their own: homography only follows the camera.

**Solution**:

1. Check the per-frame lines of the **Logs** view (`kp`, `match`, `inliers`, `ratio`) and use the **Debug** tab on two frames of the problem area.
2. For rejected steps, lower **Inlier ratio** slightly or raise **Top-K pts**; for noisy results, raise **Min inliers**.
3. Import the sequence with **Lossless PNG for MP4** or a high JPEG quality: compression artifacts reduce matches.
4. For objects that move on their own, use **Opt. flow** or SAMURAI instead.

## Optical flow boxes stop following the object

**Symptom**: with **Track via optical flow**, a box stops moving after some frames while the object keeps moving, or jumps to the background.

**Cause**: optical flow needs trackable texture inside the box. When fewer than **Min pts** points are tracked (uniform surface, reflection, lighting change, motion blur, occlusion), the box is copied unchanged. Motion larger than the search window over the pyramid levels also loses the points.

**Solution**:

1. Raise **Pyramid levels** (4 for large displacements) or **Window (px)** (25 to 31 for compressed video).
2. Lower **Min pts** to 2 or 3 for small objects.
3. Redraw the box on the first frame where it stopped and run again from there.
4. For long sequences or occlusions, use SAMURAI.

## The backend does not start

**Symptom**: the backend terminal stops at startup with an error, and the interface shows "The backend is not responding" or stays empty.

**Cause and solution by message**:

- `ModuleNotFoundError: No module named 'sam2'`: SAM2 is not installed in the environment. Install it (`pip install git+https://github.com/facebookresearch/segment-anything-2.git`, or `pip install --no-index --find-links <offline>/wheels/ segment_anything_2` offline).
- `UnicodeEncodeError` at startup: the Windows console cannot print a character. Set `PYTHONIOENCODING=utf-8` before starting uvicorn.
- `Address already in use` / port 8000 in use: another instance is running. Let the launcher allocate free ports, or find and stop the process (`netstat -ano | findstr :8000` then `taskkill /PID <pid> /F` on Windows).
- `ModuleNotFoundError: No module named 'backend'`: uvicorn was started from the wrong folder. Start it from `Annotation_App/`.
- Errors about CUDA or `torch`: the installed PyTorch build does not match the driver. Check `nvidia-smi` and `python -c "import torch; print(torch.__version__, torch.version.cuda)"`, then reinstall PyTorch for the right CUDA version.

For the frontend, `Cannot find module 'vite'` means the frontend dependencies are missing: run `npm install` in `frontend/` (or the offline command with the npm cache, see [Configuration](configuration.md)).

## "database is locked" errors

**Symptom**: an action fails with a message containing `database is locked`, usually while an import or a propagation writes many annotations.

**Cause**: SQLite accepts one writer at a time. The app runs SQLite in WAL mode with a 30-second lock wait, which covers normal concurrency between imports, propagations and the interface. The error appears when several backend processes write to the same `annotation.db`: uvicorn started with `--workers` greater than 1, two app instances launched on the same workspace, or a workspace on a network file system with poor locking.

**Solution**:

1. Run a single uvicorn worker; never use `--workers` greater than 1.
2. Do not launch two instances on the same workspace; each user should have their own `annotation_<user>` workspace.
3. Keep the workspace (at least `annotation.db`) on a local disk of the backend machine rather than on a network share.
4. Retry the action once the heavy job is finished.

## The workspace disk fills up

**Symptom**: the disk of the backend machine fills up; the **Workspace storage** section of Settings shows large sizes.

**Cause**: exports in copy mode duplicate every image and create ZIP files; video imports extract every frame; cached previews and 8-bit versions accumulate for large 16-bit datasets. Automatic backups are small (one JSON per project, overwritten).

**Solution**:

1. Open **Settings**, section **Workspace storage**, and empty the exports folder once the exports have been copied elsewhere.
2. Prefer **Symbolic links for images** at export and symbolic links at import: no image is copied.
3. Delete cache folders if needed (`frames_preview/`, `frames_8bit/`, `frames_ai_lut/`, `frames_format specialise_cache/` in each project): they are rebuilt on demand.
4. Decimate videos at import and use JPEG rather than lossless PNG when geometry-based propagation is not needed.

## Keys 1 to 9 do not select a class

**Symptom**: pressing a digit key does not change the active class.

**Cause**: a digit key only selects a class whose shortcut key is that digit, shown next to the class name in the **Classes** tab. A class without a shortcut key does not react, and the interface does not offer a way to assign one (the `shortcut_key` field of a class can be set through the API).

**Solution**: click the class in the **Classes** tab to make it active, or give the class a shortcut key through the API (`PUT /api/projects/{project_id}/classes/{class_id}` with `shortcut_key`).

## A text batch annotates frames of another sequence

**Symptom**: after a **Batch** run of the text detection bar in a multi-sequence project, annotations also appear on frames of the following sequences, or the batch processes far more frames than the current sequence contains.

**Cause**: the **From F** / **to F** fields of the text detection bar take project-wide frame indices starting at 0, and the end of the range defaults to the last frame of the project, not of the current sequence. The range button `[F<start>...F<end>]` shows these global indices.

**Solution**:

1. Before clicking **Batch**, open the range button and set **to F** to the last global index of the current sequence (the first frame of the sequence plus its frame count, minus 1).
2. To clean frames annotated by mistake, go to the other sequence, select the frames on the timeline (`Ctrl+click`, `Shift+click` or `Ctrl+A` over the timeline) and press `Delete`; `Ctrl+Z` restores them if needed.
