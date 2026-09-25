---
app: annotation
doc_type: architecture
audience: dev
lang: en
title: Architecture
order: 60
tags: [fastapi, sqlite, websocket, task registry, image pipeline, smb, react]
sources: [Annotation_App/backend/main.py, Annotation_App/backend/models/routers/docs.py, Annotation_App/backend/models/routers/annotation.py, Annotation_App/backend/database.py, Annotation_App/backend/config.py, Annotation_App/backend/services/task_registry.py, Annotation_App/backend/models/routers/tracking.py, Annotation_App/backend/models/routers/dataset.py, Annotation_App/backend/models/routers/export.py, Annotation_App/backend/utils/image_utils.py, Annotation_App/backend/utils/native_share.py, Annotation_App/backend/services/format_registry.py, Annotation_App/frontend/src/pages/AnnotationPage.tsx, Annotation_App/frontend/src/services/websocket.ts, Annotation_App/frontend/src/stores/annotationStore.ts, Annotation_App/frontend/vite.config.ts]
---

# Architecture

## Components overview of Annotation App

Annotation App is a two-tier web application: a FastAPI backend that owns the data, the models and the heavy computation, and a React frontend that runs in a browser or in the VisionNexus Electron shell.

```text
Frontend (React 19 + TypeScript + Vite + Konva.js + Zustand)
  |-- HTTP /api (axios, typed client)  --+
  |-- WebSocket /ws (tasks, SAM)       --+--> Vite proxy (127.0.0.1) --> FastAPI backend
  `-- images: /api/frames/{id}/image, or app-image:// native read in VisionNexus

Backend (FastAPI + SQLModel + SQLite, single uvicorn worker)
  |-- routers (backend/models/routers/): one file per domain
  |-- services (backend/services/): model singletons and business logic
  |-- task registry: in-memory state of background jobs, logs, live frames
  `-- workspace on disk: annotation.db, projects/<id>/frames and caches, backups, exports
```

Main technologies: FastAPI and uvicorn, SQLModel on SQLAlchemy 2 with SQLite in WAL mode, PyTorch with SAM2, SAMURAI (SAM2 fork), Grounding DINO through `transformers`, SAM3.1, OpenCV (SIFT, Lucas-Kanade, video decoding) and XFeat. On the frontend: React 19, React Router, Zustand stores, Konva.js for the canvas, axios and `react-hot-toast`.

The backend runs as a single process. All state that must be shared between requests lives in SQLite (persistent) or in module-level singletons (models, task registry, caches). This is why exactly one uvicorn worker must run per workspace.

## Backend application startup

`backend/main.py` creates the FastAPI application and runs its lifespan at startup:

1. Raises the anyio threadpool limit to 96 tokens. Every endpoint declared with `def` and every database write of the tracking jobs runs in this pool; the default of 40 was saturated during propagations, leaving status and stop requests queued until timeout.
2. Creates the SQLite tables (`create_db_and_tables`) and runs `_run_migrations()`, which adds missing columns with `ALTER TABLE ... ADD COLUMN` (for example `frame.sequence_id`, `sequence.lut_json`, `sequence.last_export_at`, `track.sequence_id`, `labelclass.subclass`, `project.is_template`, `frame.is_extracted`). Tables are never dropped.
3. Loads SAM2: the small model if `backend/checkpoints/sam2.1_hiera_small.pt` exists, otherwise tiny. SAMURAI is loaded with it when available. Grounding DINO, SAM3 and XFeat are loaded lazily by their services.

Middlewares: CORS for the frontend origins (`backend/config.py`), and `GZipMiddleware` with a 1 KB minimum, which compresses JSON lists of frames and annotations about ten times (essential over SSH) while images stay uncompressed. Static files of the workspace are mounted at `/media` (symbolic links followed).

Application-level endpoints defined in `main.py`: `/health`, `/api/app-mode` (solo or orchestrator, from `LAUNCHED_BY_ORCHESTRATOR`), `/api/capabilities` (optional formats), `/api/sam/ping`, the workspace helpers (`/api/workspace/*`) and the monitoring endpoints (`/api/monitoring/stats`, `/api/monitoring/report`).

## Routers and services of the backend

Routers live in `backend/models/routers/`, one file per domain, and are mounted in `main.py`:

| Router | Domain |
|---|---|
| `projects.py` | Projects, classes, session state, LUT per project, backup and restore |
| `dataset.py` | Imports (upload, server folder, server video, specific formats), frames, sequences, image serving, histograms, file browser, annotation import (`.ver`, YOLO) |
| `annotation.py` | Annotation CRUD, bulk replace, multi-frame deletion with undo, copy between frames, overlaps, interpolation, NMS, summaries |
| `sam.py` | SAM2 points and status, Grounding DINO text prediction, SAM3 text prediction, SAM WebSockets |
| `tracking.py` | Tracks, task status, logs, stop/pause/resume, task WebSocket, homography and optical flow propagation, guided tracking (Detect.), SAMURAI / SAM2 video tracking, ByteTrack (API only), homography debug |
| `export.py` | YOLO, COCO and `.ver` export as background tasks, status, download, preview |
| `orchestrator.py` | Contract with Orchestrator App: create project, status, YOLO and `.ver` export, auto-annotation |
| `samples.py`, `settings.py`, `storage.py`, `convert.py` | Tutorial samples, user settings, workspace storage, format conversions |
| `docs.py` | This documentation: page list from `docs/docs_manifest.json` of the suite (built-in list as a fallback), one page with its frontmatter and language fallback, and images of `docs/assets/`; read by the Presentation page |

Services in `backend/services/` are module-level singletons:

| Service | Role |
|---|---|
| `sam_service.py` | SAM2 image predictor, automatic mask generator, SAM2 / SAMURAI video predictor (`configure_video_tracking`, video sessions closed after each run) |
| `grounding_service.py` | Grounding DINO loading and prediction, optional SAM2 refinement |
| `sam3_service.py` | SAM3.1 loading and text prediction |
| `homography_service.py` | XFeat or SIFT matching, RANSAC homography, box warping, Lucas-Kanade optical flow, debug visualization |
| `dataset_service.py` | Frame extraction, folder import, YOLO and COCO export writers |
| `task_registry.py` | In-memory registry of background tasks |
| `settings_service.py` | Reading, migration and writing of `user_settings.json` |
| `interpolation_service.py`, `tracker_service.py` | Linear interpolation, ByteTrack |
| `annotation_import_service.py`, `convert_service.py`, `format_registry.py`, `monitoring_service.py` | `.ver` / YOLO parsing, conversions, optional format discovery, monitoring events and aggregation |

## Data model and database

The database is SQLite at `<workspace>/annotation.db`, in WAL mode with foreign keys enforced. Models are SQLModel classes in `backend/models/`.

| Table | Key fields |
|---|---|
| `project` | `name`, `project_type` (`image` or `video`), `source_path`, `lut_json`, `is_template`, `frame_count`, `annotated_count` |
| `sequence` | `project_id`, `name`, `source_type`, `source_path`, `start_index`, `frame_count`, `fps`, `lut_json`, `last_export_at`, `last_export_format` |
| `frame` | `project_id`, `sequence_id` (null for legacy frames), `frame_index` (global), `filename`, `width`, `height`, `is_annotated`, `is_empty`, `is_keyframe`, `is_extracted`, `source_frame_index`, `propagation_confidence` |
| `annotation` | `frame_id`, `class_id`, `track_id`, `annotation_type` (bbox or polygon), `cx`, `cy`, `width`, `height`, `points` (JSON), `confidence`, `is_auto`, `is_interpolated`, `source_algorithm`, `created_at` |
| `track` | `project_id`, `sequence_id`, `track_uid`, `class_id`, `color`, `start_frame`, `end_frame`, `is_active`, `interpolated_frames` |
| `labelclass` | `project_id`, `name`, `subclass`, `subsubclass`, `color`, `shortcut_key`; `full_name` joins the levels with `_` |
| `sessionstate` | Per project: current frame, zoom, offsets, active class and tool |

Relationships: a project owns sequences, frames, tracks and classes; a frame owns annotations; an annotation references a class and optionally a track. Deleting a project cascades manually (annotations, frames, tracks, classes, session, then the project).

Each import appends frames after the existing ones (`frame_index` continues from `project.frame_count`) and prefixes their files with `s{seq_id:03d}_`. Frame image resolution goes through the sequence source path, with the project source path as a legacy fallback.

Connection settings: `check_same_thread=False`, a 30-second lock timeout, `PRAGMA busy_timeout=30000`, `synchronous=NORMAL`, and a pool of 20 connections plus 40 overflow with a 10-second pool timeout.

## Annotation coordinates and provenance

All annotation geometry is stored normalized to `[0, 1]` in YOLO convention: `cx`, `cy` are the box center, `width`, `height` its size, as fractions of the image. Polygon points (`points`, a JSON list of `[x, y]`) are normalized the same way. Pixel values never enter the database.

Conversions happen only at the edges:

- the canvas converts stage coordinates with `stageToImageNormalized()` in `AnnotationCanvas.tsx`, and `yoloToPixel()` / `pixelToYolo()` in `frontend/src/utils/coordinates.ts`;
- model outputs (SAM2, SAMURAI, Grounding DINO, SAM3, homography, optical flow) are normalized by the backend with the original frame size before saving;
- exports convert to pixels for COCO and `.ver`, and keep normalized values for YOLO.

Provenance fields describe how each annotation was produced: `is_auto` (model or propagation), `is_interpolated` (homography, optical flow, interpolation), `confidence` (1.0 for manual work) and `source_algorithm` (`sam_point`, `sam_auto`, `grounding_dino`, `sam3`, `samurai`, `sam2_video`, `guided_tracking`, `homography`, `optical_flow`, `imported`; legacy `sam2_tracking`). The frontend never sends `manual`: boxes and polygons drawn by hand are saved with an empty `source_algorithm`. Homography and optical flow results are always boxes, tagged `homography` or `optical_flow`. In **Sequence Image** projects, `POST /api/frames/{frame_id}/annotations` attaches every non-automatic annotation without a track to the track whose `track_uid` is the smallest free on that frame (created if needed, joined if it already exists in the sequence).

The monitoring service records annotation events (creation, rework, deletion, runs) in `<workspace>/monitoring/events.jsonl` and aggregates them with this provenance for the Monitoring page and the HTML report, which is also regenerated by the suite launcher when an annotation user disconnects.

## Background tasks and the task registry

Long operations (imports, video extraction, propagations, guided tracking, exports) run as background tasks. The endpoint creates a task, starts the work and returns a `task_id` immediately.

`backend/services/task_registry.py` keeps, per task and in memory:

- `status` (`pending`, `running`, `completed`, `error`), `progress` (0 to 100), `message`, `error`, `result`;
- `current_frame_id`, the frame being processed, used for live navigation;
- a log ring buffer of 300 lines (`append_log`), read incrementally with `GET /api/tasks/{id}/logs?since=N`, and shown in the **Logs** view of the Tracks panel (the first line, starting with `$`, summarizes the command);
- `live_frames_pending`, a bounded queue (600 entries) of per-frame previews: frame id, objects and native image path;
- stop and pause flags (`request_stop`, `request_pause`, `request_resume`).

Rules for task code:

- Heavy work (OpenCV, XFeat, PyTorch) must run in a synchronous function executed in the threadpool (`background_tasks.add_task` with a `def`, or an executor). An `async def` without `await` blocks the event loop: no request is served during the run, status polling freezes and stop is impossible.
- Every loop checks `is_stop_requested(task_id)`, including during the SAM2 preparation phase.
- Loops set `frame.is_annotated = True` on every frame where they create annotations, so that sequence statistics and exports stay correct.
- The registry is not persistent: tasks are lost when the backend restarts.

Exports keep a separate registry in `export.py`, polled by the frontend every 800 ms through `GET /api/exports/{task_id}/status` (`useTaskPolling`).

## Task progress over WebSocket

The frontend follows tasks through `WS /ws/tasks/{task_id}`, a single persistent connection per task that replaced repeated HTTP polling.

Server side, the loop reads the task every 150 ms (in-memory, under lock), drains the whole `live_frames_pending` queue with `drain_live_frames()`, and sends a message only when something changed:

```json
{"type": "update", "status": "running", "progress": 42, "message": "...",
 "error": null, "current_frame_id": 1234, "live_frame": {...}, "live_frames": [...]}
```

The loop ends on `completed` or `error`; an unknown task yields `{"type": "not_found"}`.

Draining the queue matters: the single `live_frame` field is overwritten at every propagated frame, so sampling it every 150 ms lost the intermediate frames (18 % of them at 8 frames/s). The queue delivers every frame.

Client side, `subscribeTaskProgress()` in `frontend/src/services/websocket.ts` is a broker: it keeps one physical socket per task and broadcasts every message to all local subscribers (the Tracks panel and the progress bar of the page). Two sockets on the same task would compete for the destructive drain and randomly lose previews and native paths. If the WebSocket upgrade is blocked (some SSH proxies), the Tracks panel falls back to sequential `GET /api/tasks/{id}` requests and cancels them as soon as the socket works again.

The SAM image endpoints use two other WebSockets: `/ws/sam/image` streams SAM Auto masks as they are produced, and `/ws/sam/video` supports interactive video sessions. `AnnotationWebSocket` in `websocket.ts` is the generic client with auto-reconnect.

## Live propagation pipeline (SAMURAI and SAM2)

A SAMURAI or SAM2 video run follows this sequence:

```text
1. POST /api/projects/{id}/sam2-tracking/run  -> task_id (immediate)
2. Backend prepares the range in projects/<id>/_tracking_tmp/sam2_track_*/:
   one 8-bit JPEG per frame (LUT applied, quality 95, names 000000.jpg...),
   linked without re-encoding when the source is already a suitable JPEG
3. Video session opened with async frame loading; SAMURAI for one target,
   native multi-object SAM2 for several, or one SAMURAI pass per object
4. For each propagated frame: masks -> boxes or polygons, annotations buffered
   and committed in batches of 10, live preview queued (frame_id, objects, native_path)
5. WS /ws/tasks/{id} pushes live_frames; the frontend updates the timeline for every
   frame and moves the canvas at the configured cadence
6. Final commit, session closed (VRAM released), temporary folder cleaned,
   status completed; the frontend reloads frames, tracks and the current frame once
```

Contract of the live display: a frame shown during the run gets its image through the native path (or HTTP) and its annotations from the same WebSocket batch. While the run is active, no `GET` of annotations may replace this preview with a database state not committed yet; the frontend enforces it with an explicit `hasLivePayload` flag and treats the WebSocket as the only annotation source for the canvas. A `liveAnnotationsRef` buffer keeps previews that arrive before the throttled canvas reaches their frame. The database becomes the source of truth again after the final resync.

With `interface.realtime_live_enabled` off, previews and counters still arrive, but the canvas stays on the user's frame. The canvas cadence (`interface.propagation_nav_throttle_ms`, 150 ms by default) samples only the drawn images, never the association between an image and its annotations.

Backward propagation (end frame before the reference) reverses the frame list so that SAMURAI always runs forward on the reordered frames. The backend logs `[SAM2Track]` lines, including the configuration (device, CPU offload, image size) and the chosen image route.

## Image serving tiers and disk caches

Frame images are served by `GET /api/frames/{frame_id}/image` in three tiers:

| Query | Size | JPEG quality | Used for |
|---|---|---|---|
| `preview=1` | 480 px wide | 70 (about 10 to 20 KB) | Slider scrubbing, playback, propagation |
| `display=1` | 1600 px wide | 85 | Normal canvas display |
| none | full resolution | source file (92 when re-encoded) | Zoom above 1.5x |

Reduced tiers are generated on demand and cached. With `interface.preview_downscale_enabled` off, every request returns full resolution and nothing is written. Responses carry `Cache-Control: max-age=3600, immutable`, so the browser reuses frames already seen.

Caches per project (`projects/<id>/`):

- `frames_preview/`: `<stem>_prev<width>_<sig>.jpg` reduced tiers.
- `frames_8bit/`: `<stem>_8bit_<sig>.jpg`, 8-bit versions of 16-bit sources through the effective LUT.
- `frames_ai_lut/`: LUT-applied inputs of the guided detectors, so that Grounding DINO and SAM3 see the displayed image.
- `frames_format specialise_cache/`: tiers of the optional format specialise format.

`<sig>` is the LUT signature (`lut_signature()`); a manual LUT signature is `man<lo>_<hi>` and contains an underscore, so these names must never be parsed with `rpartition("_")`. When a LUT changes, `purge_stale_lut_caches()` keeps only the signatures still in use (project LUT and each sequence LUT), which prevents dead generations from accumulating.

When a frame file is missing (broken symbolic link, frame not extracted yet), the backend returns a gray placeholder with HTTP 200, `Cache-Control: no-store` and an `X-Frame-Missing` header (`broken-symlink`, `not-extracted`), so that no client caches it as the real frame. `GET /api/frames/{id}/histogram` computes a histogram of raw values, kept in an LRU cache of 4000 frames since source pixels never change after import.

All model loaders read images through `load_image_bgr_8bit` / `load_image_rgb` in `backend/utils/image_utils.py` with the frame's effective LUT, never through a bare `cv2.imread`, so 16-bit sources are handled consistently.

## Native image path through the VisionNexus shell

In the VisionNexus Electron shell, the custom `app-image://` protocol can read frame pixels directly from the SMB share instead of downloading them over HTTP. The traffic then uses neither the SSH tunnel, nor the browser's six connections per origin, nor the backend threadpool.

Resolution for normal navigation:

1. The frontend asks `app-image://` for a frame and tier.
2. Electron calls `GET /api/frames/{frame_id}/image-path`, which returns the UNC path computed by `to_native_share_path()` (and the tiered cache file when needed) plus the HTTP fallback URL.
3. Electron reads the file with `fs.readFile`; on failure it falls back to `GET /api/frames/{frame_id}/image`.

During a propagation, the backend already writes one 8-bit JPEG per frame in `_tracking_tmp/`, so it announces that file directly in each live frame (`native_path`). The frontend passes it as `nativePath`, which saves the two HTTP requests of the normal resolution. The direct read is attempted even if the generic SMB probe of VisionNexus is inactive or uses another host name, with a 1.5-second timeout before the HTTP fallback. The temporary JPEGs only live during the run, so the HTTP fallback in the `app-image://` URL is mandatory.

`to_native_share_path()` (`backend/utils/native_share.py`) returns Windows paths unchanged (local launch), translates `/<root>/<share>/rest` to `\\<native_share_host>\<share>\rest` for roots listed in `paths.shared_roots`, and returns `None` otherwise (for example under `/tmp`, which is why the temporary folder lives in the project). `from_native_share_path()` does the reverse for paths typed by users.

Logs: the backend writes one line per run (`chemin NATIF (SMB)`, `chemin NATIF (disque local)` or `REPLI HTTP` with the reason); VisionNexus confirms the route actually used once per run (`[app-image] lecture native confirmee` or `[app-image] repli HTTP`). Electron never caches provisional images (placeholders).

## Frame navigation data flow

Moving to another frame (slider, timeline, arrow key or **go to**) triggers a short, cancellable sequence in `AnnotationPage.tsx`:

1. The target `frame_index` is resolved from the frame metadata in memory. The frame list is loaded once per project in pages of 10000 (auto-paginated until exhausted); `GET /api/projects/{id}/frames/by-index/{n}` fills gaps of a sparse window.
2. The annotations are taken from an LRU cache of 600 frames, then refreshed with a cancellable `GET /api/frames/{frame_id}/annotations`.
3. The image URL is chosen: preview tier while scrubbing, playing or propagating, display tier at rest, full resolution when zoomed above 1.5x.
4. The image is loaded (native path in VisionNexus, HTTP otherwise) and committed to the canvas together with the annotations only if both belong to the same `frame_id`.
5. At rest, a small neighborhood is prefetched. During scrubbing and propagation there is no prefetch, to keep the six connections free.

While the slider is dragged, the handle follows the pointer immediately and the image changes at most every 130 ms; the full image loads on release. The timeline never requests images: it is virtualized and shows only counters. For videos, `POST /api/projects/{id}/frames/ensure_extracted` extracts the neighborhood of the current frame first (debounced during scrubbing).

`annotationStore.loadAnnotations(frameId, annotations)` takes the frame id first and is idempotent: it publishes no new state when the frame and the array are unchanged. The canvas ignores 0 x 0 measurements from hidden Electron tabs and keeps its last valid size.

## Import pipeline and sequence storage

Every import creates a `Sequence` and appends its frames after the existing frames of the project. Imports from the frontend are serialized by `importStore.ts`: the modal closes, a queue runs one import at a time (the backend reads `project.frame_count` when creating each sequence, so two concurrent imports would collide on indices), and the page shows one progress bar per sequence.

| Source | Endpoint | Storage |
|---|---|---|
| Server image folder | `POST /api/projects/{id}/import/folder` | Symbolic links in `frames/` (copy if links are refused), inserted incrementally in batches |
| Uploaded images | `POST /api/projects/{id}/import/images` | Files in `frames/`, original format kept |
| Server video | `POST /api/projects/{id}/import/video_from_path` | Lazy scan, then background extraction to JPEG or PNG |
| Uploaded video | `POST /api/projects/{id}/import/video` | Chunked upload (8 MB chunks), then background extraction |
| Specific format | `POST /api/projects/{id}/import/specific` | Delegated to the format adapter |

Extraction keeps one decoded frame in memory at a time (about 6 MB in 1080p, 25 MB in 4K) and commits in batches. Decimation (`frame_keep`) keeps one frame out of N and records the original index in `source_frame_index`. When a project is loaded, the backend checks that image files present on disk have a `Frame` record, which repairs interrupted imports.

16-bit PNG and TIFF sources are linked unchanged; their display and model inputs go through the LUT. A sequence manifest (`POST /api/sequences/parse-manifest`, lines `path<TAB>name`) lets the import window fill all slots from the `.txt` written by the automatic backup.

## Optional format adapters

Specific sequence formats are supported through self-contained adapter modules in `backend/utils/`. The only adapter shipped is `format specialise.py`, for the format specialise raw format (128-byte header with image count, rows, columns, bit depth and type; fixed-size frames allow direct seeking).

`backend/services/format_registry.py` discovers adapters without importing them: it parses each module with `ast` and reads a literal `FORMAT_CAPABILITY` constant (label, extensions, import contract). A module is imported only when a matching file is processed. `GET /api/capabilities` returns `{"specific_formats": [...]}`; the frontend builds the label, the accepted extensions and the drag-and-drop support from this list and never hard-codes a format name.

Removing `backend/utils/format specialise.py` and restarting gives `specific_formats: []`: no format specialise option appears and standard imports keep working. The format specialise reader seeks directly to the requested frame and keeps the native bit depth; an format specialise file is never streamed at full resolution frame by frame, it is converted to PNG (next to the source file, in `<stem>_png/`, or in the project for uploads) or served through `frames_format specialise_cache/`. `POST /api/convert/video_to_format specialise`, `/api/convert/format specialise-to-png` and `/api/convert/png-to-format specialise` provide conversions.

## Export pipeline

`POST /api/projects/{id}/export` starts an export task and returns its id. The request carries `output_format` (`yolo`, `coco` or `ver`), the split ratios, `include_unannotated`, `class_filter`, `symlink_images`, an optional `export_name` and, in solo mode only, `custom_export_dir` (UNC paths are translated).

- **YOLO**: for a multi-sequence project, one `<sequence>-yolo/` folder per annotated sequence inside the export folder; a single-sequence project is exported flat. Labels are `class cx cy w h`; `data.yaml` maps class indices to full class names. When polygons exist, `seg_labels/` and `seg_data.yaml` are written in addition.
- **COCO**: `<sequence>-coco/` with `images/{train,val,test}/` and `annotations/instances_{split}.json`; boxes in pixels `[x, y, w, h]`, `category_id` = class index + 1, pixel polygons in `segmentation`, `track_id` as an extra field. Written by `dataset_service.export_coco_dataset`, which shares image placement with YOLO.
- **.ver**: one `<sequence>.ver` per sequence, ten columns `frame_id visibility x1 y1 x2 y2 track_id class subclass subsubclass`, pixel corners, 1-based frames, `track_id` = persistent `track_uid` (`-1` without track).

With `symlink_images`, the dataset links to the source images and no ZIP is produced (`GET /api/exports/{task_id}/download` then refuses); otherwise images are copied and a ZIP is built. Each exported sequence gets `last_export_at` and `last_export_format`, which the Monitoring page uses to mark sequences as finished. In orchestrator mode, the export goes to the workspace `exports/` folder; `/api/orchestrator/export-yolo` reuses an existing export whose content signature is identical instead of recomputing it.

## Frontend structure

The frontend (`Annotation_App/frontend/src/`) is a React application with five routes defined in `App.tsx`: `/` (projects), `/projects/:projectId/annotate` (annotation workspace), `/presentation` (this documentation, rendered by `components/docs/MarkdownDoc.tsx` from `GET /api/docs`, with the page and section in the URL: `?doc=<page>#h-<n>`), `/convert` and `/monitoring`.

State lives in Zustand stores (`stores/`):

| Store | Content |
|---|---|
| `annotationStore.ts` | Annotations of the current frame, active tool and class, selection, tracking targets shared by all Tracks tabs, per-frame undo/redo (50 snapshots), clipboard |
| `projectStore.ts` | Projects, current project, frames (auto-paginated), current frame index, session save |
| `samStore.ts` | SAM WebSocket state machine, streamed masks (SAM Auto proposals), pending points |
| `uiStore.ts` | Zoom and offset, active sidebar tab, modals, LUT panel, `zoomToAnnotation` |
| `settingsStore.ts` | User settings, loaded asynchronously at startup |
| `importStore.ts` | Background import queue (serial) |
| `bulkUndoStore.ts` | Undo/redo of multi-frame deletions from the timeline |

The canvas (`components/canvas/AnnotationCanvas.tsx`) is a Konva stage with three layers: the background image, the annotations (`BBoxShape` with a transformer, polygons), and an interaction overlay (drawing in progress, SAM points and masks). `services/api.ts` is the typed axios client, organized in namespaces (`projectsAPI`, `datasetAPI`, `annotationsAPI`, `samAPI`, `trackingAPI`, `taskAPI`, `exportAPI`, `settingsAPI`, `storageAPI`, `backupAPI`, `filesAPI`, `samplesAPI`, `monitoringAPI`, `appModeAPI`, `docsAPI`); its interceptor shows error toasts and stops the pollers after repeated connection failures. `hooks/` holds the keyboard shortcuts, the auto-save (session and server backup every 2 minutes, silent) and export polling. Translations are in `i18n/translate.ts` (French source strings, English dictionary).

## Remote topology and HTTP connection budget

The target remote deployment splits the application across two machines:

```text
Windows workstation: VisionNexus (Electron) + frontend
  |-- JSON API + WebSocket --> 127.0.0.1:<local port> -- SSH tunnel --> <backend-vm>:<backend port>
  `-- frame pixels ---------> \\<native_share_host>\<share>\... read by app-image://
<backend-vm>: FastAPI, SQLite, SAM2 / SAMURAI and the other models
```

`<backend-vm>` (the SSH host) and `paths.native_share_host` (the UNC host seen by Windows) can be different names. The limiting factor is not React or Vite but network latency multiplied by the number of requests. A browser opens at most six simultaneous HTTP connections per origin, all going through the tunnel; they are shared between images (most of the volume) and vital requests (annotations, stop, save).

Cost of one frame:

| Transport | Size | HTTP requests |
|---|---|---|
| WebSocket live frame message | about 415 B | 0 (socket already open) |
| Preview image (480 px) | about 9.7 KB | 1 |
| Display image (1600 px) | about 22 KB | 1 |
| Full-resolution image (640 x 512 test data) | about 35 KB | 1 |

At the measured SAMURAI rate of 8 frames/s, WebSocket announcements cost 3.2 KB/s and no request, while following the canvas frame by frame over HTTP would cost 79 KB/s and 8 requests/s, more than the six slots. Hence the design choices: native SMB reads for pixels, one WebSocket per task, GZip on JSON, preview tiers, no thumbnails, grouped server-side deletions and statistics, a Vite proxy on `127.0.0.1`, and no prefetch while scrubbing or propagating.

## Database pool and threadpool sizing

SQLAlchemy 2 uses a `QueuePool` even for a file-based SQLite database, with 5 connections plus 10 overflow by default. FastAPI endpoints declared with `def` run in the anyio threadpool. When the threadpool was larger than the pool, requests waited for a connection until the pool timeout; with a 30-second pool timeout, equal to the frontend request timeout, the whole interface froze with "The backend is not responding" while no GPU job was running. The pool filled up because `serve_frame_image` and `frame_histogram` held their connection during a `cv2.imread` of 16-bit PNG files on a network mount.

Current sizing:

- anyio threadpool: 96 tokens (set at startup);
- SQLAlchemy pool: `pool_size=20`, `max_overflow=40` (60 connections), `pool_timeout=10`, `pool_recycle=3600`;
- SQLite: WAL, `busy_timeout=30000`, `synchronous=NORMAL`.

Requests should wait only for the SQLite write lock (handled by WAL and the busy timeout), never for a pool slot; if the pool is exhausted anyway, requests fail fast after 10 seconds instead of hanging. The histogram LRU cache (computed on raw values, independent of the LUT) removes most repeated image reads: measured gain x5 for a single call and x4.5 under bursts on a local SSD, more on network storage. Keep the pool above the number of threads that can hold a session if either value changes.

## Memory footprint

Memory is spent by different processes, which must not be confused when reading a task manager:

- **Python backend**: about 1.0 GB at rest and 2.1 to 2.2 GB at peak with PyTorch, CUDA and SAM2 loaded. On a VM, this memory is on the VM, not on the workstation. GPU memory for SAMURAI depends on the range and on the fast GPU mode (all frames in VRAM) versus CPU offload.
- **Electron (VisionNexus)**: about 790 MB measured across 7 processes (renderers, GPU, main, utility); the Windows task manager adds them under one name.

A browser keeps images decoded, not compressed: a 640 x 512 frame weighs about 9.7 KB as a JPEG preview but 1.25 MB decoded as RGBA, a factor of about 135.

What the application retains does not grow with the dataset: the canvas holds a single image, prefetch creates `Image` objects that are not stored, the timeline is virtualized, the annotation cache is bounded to 600 frames, and the frame list costs about 20 MB at 20,000 frames. Going from 9,000 to 20,000 frames adds a few tens of megabytes. During extraction, the backend holds one decoded frame at a time; chunked uploads hold one chunk (8 MB) at a time.

## Reference measurements

These measurements come from a load test on a dataset of 9402 PNG frames (640 x 512, 2.6 GB), with Annotation App and Dataset Explorer running in parallel. Reuse them as a baseline after a change.

| Operation | Value |
|---|---|
| Annotation import of 9402 frames (symbolic links) | about 110 s |
| SAMURAI propagation | about 8 frames/s |
| Backend latency with two simultaneous jobs | median 8 to 16 ms, p95 30 to 59 ms, no failure |
| Live frames delivered by the WebSocket after the queue drain | 200 of 201 (the reference frame is skipped by design) |
| Live frames carrying a `native_path` | 80 of 80, 79 readable at push time (the last one is cleaned with its folder) |
| Frontend request timeout ("backend not responding") | 30,000 ms |

The WebSocket figures compare with 18 % of frames lost before the queue was introduced. To reproduce the native-path measurements, run VisionNexus on Windows against the backend on the VM: a local browser only exercises the HTTP fallback.

## Invariants that must not be broken

These rules keep Annotation App consistent; breaking one causes silent data corruption or hard-to-diagnose freezes.

1. **Normalized coordinates**: annotations are stored in `[0, 1]` (YOLO convention). Never store pixels; divide by the frame width and height before saving.
2. **One uvicorn worker per workspace**: SQLite in WAL mode is not safe for multi-process writes.
3. **Schema migrations by `ALTER TABLE ... ADD COLUMN` only** in `_run_migrations()`; never drop or recreate tables.
4. **`loadAnnotations(frameId, annotations)`**: the frame id comes first; call `clearAnnotations()` when the project changes.
5. **Settings load asynchronously**: components that initialize local state from settings must resync in an effect once `settingsStore.loaded` is true.
6. **Heavy background work runs in synchronous functions** (threadpool) and checks `is_stop_requested()` regularly; loops mark `frame.is_annotated`.
7. **One WebSocket per task** through the broker; the live queue drain is destructive.
8. **During a run, the WebSocket is the only annotation source of the canvas**; database reads resume after the final resync; image and annotations shown together must share the same `frame_id`.
9. **Tracking targets are a single shared set** (`trackingTargetIds` in `annotationStore`) for all Tracks tabs and the canvas double-click; never reintroduce per-tab sets.
10. **Files meant for native reads live under a shared root** (`home`, `mnt`, `srv`, `media`, `data`), and the HTTP fallback URL is always kept.
11. **SQL pool above the threadpool** and fail-fast pool timeout.
12. **Model inputs go through the frame's effective LUT** (`load_image_bgr_8bit` / `load_image_rgb`), never a bare `cv2.imread`.
13. **No emoji or non-encodable characters in backend `print` or logs**: the Windows console (cp1252) raises `UnicodeEncodeError` at startup.
14. **User data stays under the workspace** (`annotation_<user>`), and the `/api/orchestrator/*` endpoints remain the contract with Orchestrator App.
