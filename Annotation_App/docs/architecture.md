*[Lire en francais](architecture.fr.md)*

# Architecture

Overview of the backend, the frontend, and the data flows of the Annotation App.
For launch commands and the list of invariants that must never be broken, see the
[README.md](../README.md) at the app root. For file-by-file navigation
and debugging, see [code-navigation.md](code-navigation.md).

---

## Domain

### Project types

| DB value  | UI label         | Description                                     |
|-----------|------------------|--------------------------------------------------|
| `image`   | Image Random     | Set of non-sequential images                      |
| `video`   | Sequence Image   | .mp4 video, image folder, or .optional file            |

The **Tracks** tab is only visible in `video` mode (Sequence Image).

### Multi-sequence

A project can contain **several sequences** (image folders, MP4, format specialise, mixed).

- `sequence` table (`backend/models/sequence.py`): one sequence = one imported source.
  Fields: `name`, `source_type` ('images'|'video'|'format specialise'), `source_path`,
  `start_index` (global frame_index of the 1st frame), `frame_count`, `fps`.
- `Frame.sequence_id` (nullable, NULL = frames imported before multi-sequence support,
  exposed as a pseudo-sequence "Main sequence").
- Each import **appends** its frames at the end (`frame_index += project.frame_count`)
  with a unique file prefix `s{seq_id:03d}_` (avoids
  `frame_000000.jpg` collisions between imports).
- Source resolution (on-demand extraction, format specialise PNG, tracking) goes through
  `frame.sequence.source_path` with a fallback to `project.source_path` (legacy):
  `_resolve_sequence_source()` in dataset.py, `_resolve_frame_image_path()` in tracking.py.
- `GET /api/projects/{id}/sequences`: list with stats (annotated frames, annotation count).
- `GET /api/projects` also includes a `sequences[]` summary per project (home page).
- Frontend: sequence dropdown to the left of the slider (AnnotationPage), selecting
  one navigates to the sequence's `start_index`.
- The slider and the prev/next buttons are **relative to the active sequence**: when a
  project has sequences, they only cover the range `[start_index, start_index+count)`
  of the active sequence (displays `local frame / count`), not the global space. Without this,
  choosing seq2 looked "stuck" because the slider stayed on 0 -> total.

### Import (ImportModal) - supported sources

**ImportModal = unified multi-sequence panel**: a list of "slots", each slot
accepts EITHER a drag-and-drop (files/folder -> browser upload, the browser
never transmits a path, only content), OR a server path typed directly
or chosen via FileBrowserModal (zero copy). A filled slot makes a new empty slot appear.
Type auto-detected from the extension: image folder / `.mp4 .avi .mov .mkv` / `.optional`.
Each slot has a **Sequence name** field (auto = folder/file name; this name becomes
`Sequence.name` and is used AS-IS on export: subfolder `{name}-yolo/` or
file `{name}.ver`).

**Non-blocking import** (`stores/importStore.ts`): "Import in background" stacks the slots
in `importStore.startImport()` then closes the modal, the user annotates while
the sequences load. The loop is **serial** (the backend reads `project.frame_count` when
creating each sequence, two concurrent imports would collide on
index) but detached from the modal's lifecycle. AnnotationPage shows a
per-sequence progress bar (blue banner) from `importStore.jobs` and refreshes
frames/sequences after each one (`onSequenceDone`).

**Physical frame storage**: `data/projects/{id}/frames/` with prefix
`s{seq_id:03d}_` per sequence (anti-collision). Files stay in a flat layout, but
`Frame.sequence_id` + `Sequence.name` carry the ownership. It is the sequence name
(not the file prefix) that structures the export into per-sequence subfolders/files.

**`frames_preview/`**: cache of 480 px JPEG thumbnails (quality 70, ~15 KB) generated
on the fly by `serve_frame_image(preview=1)`. Only used during slider scrubbing and
propagation (lightweight images = smooth scrolling over SSH), never for
fine-grained annotation (the canvas switches back to full resolution when the slider is released). Purging
this folder is safe (regenerated as needed). Same for `frames_8bit/` (8-bit cache
of 16-bit sources).

#### Server-side provenance (zero-copy source)

- **Server MP4**: lazy scan (metadata) + full background extraction -> JPEG
  into `data/projects/{id}/frames/`. Progress bar, redirect after "MP4 to
  frames converted - OK".
- **Server format specialise**: full format specialise -> PNG conversion in `{format specialise_dir}/{format specialise_stem}_png/` (next
  to the .optional file, never in data/). Progress bar, same behavior as MP4.
  Export can symlink directly to these PNGs.
- **Server image folder**: symlink by default (zero copy), or copy. Incremental
  batch import. No thumbnail generated (concept removed).
- Every import creates a **Sequence**; frames are appended after the project's
  existing frames (multi-sequence).

#### Local provenance (upload)

- **MP4 upload**: HTTP chunks -> JPEG extraction. Same progress bar.
- **format specialise upload**: saved to `data/projects/{id}/`, converted to PNG in
  `data/projects/{id}/{stem}_png/`.
- **Images upload**: multipart batch.

#### format specialise format

- 128-byte header: `n_img`, `n_row`, `n_col`, `n_bits_pix`, `type_img`. Fixed-size
  frames -> O(1) seek.
- `load_format specialise(path, seq_range=(i, i+1))` in `backend/utils/format specialise.py`.
- Never serve on the fly (too slow at 4K): always convert to PNG first.
- The PNG folder is created next to the format specialise file: `{parent}/{stem}_png/frame_000000.png`.
- `dataset_service.scan_format specialise_for_png_extraction()` prepares the records (all `is_extracted=False`).
- Background PNG extraction no longer generates any thumbnail (concept removed).
- `_format specialise_png_dir(format specialise_path)` in `dataset.py` computes the PNG folder path.
- `serve_frame_image`: if `is_extracted=True` and the frame is absent from the standard frames folder,
  looks in `_format specialise_png_dir(source_path)`.
- **MP4 -> format specialise conversion tool**: `POST /api/convert/video_to_format specialise` (async task).
  Available in the UI as an optional "Convert to format specialise" button on server MP4 paths.

### 16-bit images (RGB or IR)

- Native support for 16-bit image folders (PNG/TIFF): **3-sigma -> 8-bit** conversion
  centralized in `backend/utils/image_utils.py` (`to_8bit_3sigma`, `load_image_bgr_8bit`,
  `load_image_rgb`).
- Display: `serve_frame_image` serves an 8-bit JPEG version cached in
  `data/projects/{id}/frames_8bit/` (16-bit source never modified).
- Tracking/AI: all loaders (SAM2, SAM3, Grounding DINO, homography, optical flow,
  SAMURAI temp frames) go through `load_image_bgr_8bit`/`load_image_rgb`, never a direct
  `cv2.imread`.
- 16-bit format specialise: `_format specialise_frame_to_bgr` also applies the 3-sigma stretch.
- **Adjustable display LUT** (`image_utils.apply_lut`, modes `sigma`/`minmax`/`manual`):
  persisted PER PROJECT (`project.lut_json`) AND PER SEQUENCE (`sequence.lut_json`, takes priority,
  IR vs RGB within the same project). Per-frame resolution: `dataset._frame_lut` (sequence -> project).
  Endpoints: `GET/PUT /api/projects/{id}/lut`, `PUT/DELETE /api/sequences/{id}/lut`,
  raw histogram `GET /api/frames/{id}/histogram`. The LUT signature (`lut_signature`) is
  included in cache names (`frames_8bit/`, `frames_preview/`, `frames_format specialise_cache/`)
  for clean invalidation.
- **LUT on the AI path**: guided tracking bakes the frame's effective LUT into the detector's
  input (`_ai_input_path` -> `ensure_8bit_cached`, `frames_ai_lut/` cache) -> GD/SAM3/YOLO
  see the SAME image as the user. UI: `LutPanel` (floating button) with a Project/Sequence
  scope selector.

---

## Backend (FastAPI + SQLite)

`backend/main.py` orchestrates everything: lifespan creates the tables, migrates the schema, loads SAM2.
CORS allows `:5173`. Static files served at `/media`.

**Routers** (`backend/models/routers/`), one file per domain, all routes prefixed
`/api/`:

- `projects.py`: project CRUD + classes + session. **Manual cascade delete**
  (annotations -> frames -> tracks -> classes -> session -> project).
- `dataset.py`: multipart image upload / video import / format specialise + incremental folder import +
  sparse frames + sequences (multi-sequence). No more thumbnail generation.
- `annotation.py`: annotation CRUD, bulk replace, NMS (`POST /api/frames/{id}/annotations/nms`),
  cross-frame copy, overlap detection, interpolation.
- `tracking.py`: ByteTrack run, track CRUD, merge tracks, homography and optical-flow
  propagation. Guided tracking (`guided-tracking/run`): `algorithm` among `grounding_dino | sam3 | yolo`.
  **Custom YOLO** = local `.pt` model (path `settings.algorithms.yolo_model_path`, resolved against
  the workspace) used as a detector in tracking mode: LOW confidence + centroid matching to the
  targets -> false alarms with no nearby target are discarded. Service `yolo_service.py`
  (ultralytics, model cached by path). Status: `GET /api/yolo/status`. No text prompt
  for YOLO.
- `sam.py`: SAM2 point prediction, text prediction (Grounding DINO), SAM3 text prediction,
  WebSocket streaming.
- `export.py`: export as an async task. Three formats (`output_format`):
  - `yolo`: multi-sequence -> one `{sequence}-yolo/` subfolder per annotated sequence in the
    project folder (single ZIP of the parent if copied); single-sequence project -> flat YOLO.
    YOLO-seg (`seg_labels/` + `seg_data.yaml`) generated IN ADDITION as soon as polygons exist.
  - `coco`: standard COCO layout `{sequence}-coco/` (single-seq flat): `images/{train,val,test}/`
    + `annotations/instances_{split}.json`. PIXEL bbox `[x,y,w,h]`, `category_id` 1-based
    (= class_index+1), `segmentation` (pixel polygons) included, `track_id` as an extra field.
    Implemented by `dataset_service.export_coco_dataset` (shares `_place_image` with YOLO).
  - `ver`: one `{sequence}.ver` file per sequence, native 10-column text format:
    `frame_id(1-based) visibility x1 y1 x2 y2 track_id class subclass name`
    (pixel coordinates, track_id = persistent track_uid).

**Services** (`backend/services/`), all singletons:

- `sam_service.py`: SAM2 image/video predictor + auto mask generator. GPU detected on import;
  `tiny` fallback on CPU. Required checkpoint: `backend/checkpoints/sam2.1_hiera_small.pt`
  (or tiny).
- `grounding_service.py`: Grounding DINO (`IDEA-Research/grounding-dino-tiny`) + SAM2 pipeline.
  Auto HuggingFace download (~340 MB). Graceful fallback if transformers is missing.
- `sam3_service.py`: SAM3 (standalone text -> masks model).
- `tracker_service.py`: ByteTrack with a stable `bytetrack_id -> project_track_id` mapping.
- `homography_service.py`: XFeat (GPU) or SIFT+RANSAC (CPU) via `compute_homography()`. Lucas-Kanade
  optical flow via `track_bboxes_optical_flow()` (params: `win_size`, `max_level`,
  `min_tracked_pts`). Returns `None` if the inlier ratio < 0.3.
- `dataset_service.py`: video frame extraction, lazy folder import, YOLO/COCO export. Per-sequence
  file prefix (`filename_prefix`). No thumbnail generation.
- `settings_service.py`: reading/writing `data/settings.json` (user settings).
- `interpolation_service.py`: linear interpolation between keyframes.
- `yolo_service.py`: loading/caching a custom YOLO `.pt` model for guided tracking.
- `task_registry.py`: registry of async tasks (export, import, tracking) + per-task logs.

**Models** (`backend/models/`): SQLModel (Pydantic + SQLAlchemy).

- Central invariant: **all coordinates normalized to `[0, 1]`** (YOLO format:
  `cx cy w h`). Pixel conversion only happens on the frontend canvas side.
- `Annotation.points`: polygon serialized as a JSON string.
- `Annotation.source_algorithm`: `'manual' | 'sam_point' | 'sam_auto' | 'grounding_dino' |
  'guided_tracking' | 'sam2_tracking' | 'interpolation' | null`.
- `LabelClass`: 3-level hierarchy: `name` (class/detection, required), `subclass`
  (recognition), `subsubclass` (identification). E.g.: drone > quadcopter > mavic.
  `full_name` (property) = `_`-joined, used in data.yaml on YOLO export.
- `Sequence`: import source (multi-sequence), see the dedicated section above.

**`annotation` table, key fields:**

| Column               | Type   | Description                                                     |
|----------------------|--------|-------------------------------------------------------------------|
| `cx, cy, w, h`       | float  | Normalized YOLO coordinates [0,1]. Never pixels in the DB.       |
| `points`             | string | JSON `[[x1,y1],[x2,y2],...]` (polygon). Null for bbox.            |
| `is_auto`            | bool   | AI-generated (SAM, GD, SAM3, guided tracking, ...)                |
| `source_algorithm`   | string | See list above.                                                    |
| `confidence`         | float  | Score [0,1]. 1.0 = manual annotation.                             |
| `track_id`           | int    | FK to Track (nullable, null = no tracking).                        |

**Database**: SQLite at `data/annotation.db`, WAL mode, foreign keys ON.

**Migrations**: `_run_migrations()` in `main.py` adds missing columns via
`ALTER TABLE` without recreating the tables.

---

## Frontend (React + TypeScript + Konva.js)

**Routing**: React Router v6, two main routes: `/` (ProjectsPage) and
`/projects/:projectId/annotate` (AnnotationPage).

**State management**: Zustand stores:

- `annotationStore.ts`: current annotations, active tool, undo/redo (50 JSON snapshots),
  clipboard, drawing in progress. `loadAnnotations(frameId, annotations)`: `frameId` as the
  **first** argument. `clearAnnotations()`: must be called on project change to isolate data.
  `deleteAllAnnotations()`: deletes all annotations of the current frame via
  `DELETE /api/frames/{id}/annotations/all`.
- `projectStore.ts`: project list, frames, `currentFrameIndex`, session persistence.
- `samStore.ts`: WebSocket state machine (DISCONNECTED -> CONNECTING -> SESSION_READY ->
  PROPAGATING), streamed masks, pending SAM points.
- `uiStore.ts`: canvas zoom/offset, active sidebar tab, modals, review mode.
  `zoomToAnnotation(cx, cy, w, h, imgW, imgH, containerW, containerH)`: zooms and centers the canvas
  on an annotation.
- `settingsStore.ts`: user settings, loaded async at startup (see the async pattern
  in [code-navigation.md](code-navigation.md)).
- `importStore.ts`: background import queue (multi-sequence), see the Import section above.

**Timeline** (`components/timeline/Timeline.tsx`), **with no thumbnails** (removed, too
costly):

- Virtualized compact cells: green = annotated frame (with a counter), red = empty frame.
- The current frame's counter is wired live to `annotationStore`
  (`currentFrameId` + `annotations.length`): instant update with no reload.
- Ctrl/click selection, Shift/click range, **Ctrl+A** (when the timeline is hovered) selects
  everything, Esc deselects, Delete clears the selected annotations.
- Multi-frame deletion goes through `POST /api/projects/{id}/annotations/delete-frames`
  (body `{frame_ids}`): ONE transaction (one bulk DELETE + one recount + one commit) instead
  of N calls to `DELETE /frames/{id}/annotations/all` (each one recounted the whole project + fsync,
  ~0.5 s/frame). The timeline passes **frame_index** values (not array positions) ->
  `handleDeleteAnnotationsForFrames` resolves via `frame.frame_index`.

**Auto-save** (`hooks/useAutoSave.ts`): session + JSON backup every 2 min, completely
silent (no toast, no log).

**GZip**: `GZipMiddleware` in `backend/main.py` (min 1 KB): JSON responses compressed
~10x, essential for remote SSH usage.

**Navigation performance:**

- `vite.config.ts`: proxy to `127.0.0.1` and never `localhost`, on Windows Node first tries
  ::1 (IPv6) while uvicorn only listens on IPv4, hence a ~200 ms penalty on every
  proxied request.
- `GET /api/frames/{id}/image?preview=1`: 480 px quality-70 JPEG (~15 KB), generated on the fly
  and cached in `data/projects/{id}/frames_preview/`. Used by AnnotationPage during
  slider scrubbing (`isScrubbing`) + +-6 frame prefetch.
- `projectStore.fetchFrames` auto-paginates (loops while the page is full, limit 10000):
  without this, a 21000-frame project only loaded 10000 of them.
- SQLite: `busy_timeout=30000` + `timeout=30` connect_arg + `synchronous=NORMAL` (otherwise
  "database is locked" when an import writes while a `get_project` is running).

**Background tasks:** a task launched via `background_tasks.add_task` that does heavy
computation (OpenCV, XFeat, torch) must be a **synchronous** function (`def`, run in the
threadpool) or make regular `await` calls. An `async def` with no `await` blocks the event
loop: no request gets served during the run (polling freezes, timeouts, cannot
stop). All tracking loops check `is_stop_requested(task_id)`, including
during the SAM2 preparation phase, and mark `frame.is_annotated = True` on every frame
where they create annotations (sequence stats, exports).

**Canvas** (`components/canvas/`): Konva.js Stage with three layers:

1. Background image (KonvaImage)
2. Annotations (BBoxShape with Transformer, PolygonShape)
3. Interaction overlay (drawing in progress, SAM points, streamed masks)

Coordinate conversion: `stageToImageNormalized()` in AnnotationCanvas -> `[0,1]`.
`yoloToPixel()` / `pixelToYolo()` in `utils/coordinates.ts`.

**API client** (`services/api.ts`): typed axios with a toast interceptor. Namespaces:
`projectsAPI`, `datasetAPI`, `annotationsAPI`, `samAPI`, `trackingAPI`, `exportAPI`, `taskAPI`,
`backupAPI`. `annotationsAPI.applyNMS(frameId, iouThreshold)` -> `POST /api/frames/{id}/annotations/nms`.

**WebSocket** (`services/websocket.ts`): generic `AnnotationWebSocket<TMessage>` class with
auto-reconnect. Used by samStore for image auto-segmentation and video propagation.

**Sidebar** (`components/sidebar/Sidebar.tsx`):

- Receives a `projectType` prop, shows the Tracks tab only if `projectType === 'video'`.
- Passes `onDeleteAllAnnotations` and `onApplyNMS` to `AnnotationList`.

**Shared tracking targets**: the 4 tabs (SAMURAI, Detect, Homogr., Optical flow)
use the SAME `trackingTargetIds` set (annotationStore). Double-clicking a bbox in the
canvas (`onDblClick={toggleTrackingTarget}`) therefore checks/unchecks the target in all tabs at
once. Never reintroduce per-tab local sets.

**Algo log console** (bottom of TrackPanel, replaces the old visual track list):

- `task_registry.append_log(task_id, line)` accumulates lines (300-entry ring buffer, defensive
  cp1252-safe print); `GET /api/tasks/{id}/logs?since=N` returns `{lines, next}` incrementally.
- TrackPanel polls these logs (700 ms) and displays them: a `$ ...` line = synthetic command
  (algo, targets, frames, device), the rest = real-time progress (same lines as the terminal).

**TrackPanel** (`components/sidebar/TrackPanel.tsx`), 4 tabs + anomaly queue:

- **SAMURAI** (default tab, listed first): SAM2 video tracking. SAMURAI only tracks **one**
  target (single-state Kalman filter held by the model): with >1 target,
  `sam_service.configure_video_tracking(n)` switches to **native multi-object SAM2**
  (`samurai_mode=False`) and resets the Kalman state; otherwise single-target SAMURAI. Without this:
  `RuntimeError: Boolean value of Tensor with more than one value is ambiguous`. Prompt = **bounding
  box** of each target via `add_video_prompt(box=...)`. Video session
  `init_state(async_loading_frames=True)`: propagation starts without waiting for the full
  load; PNG->JPEG preparation is parallelized (ThreadPoolExecutor). Session closed in `finally`
  (`close_video_session`), otherwise a VRAM leak. Server logs `[SAM2Track]`.
- **Detect.**: GD/SAM3 guided tracking + centroid matching.
- **Homogr.**: Propagation via XFeat/SIFT homography through `compute_homography()`. Params:
  `xfeat_top_k`, `xfeat_min_cossim`, `ransac_threshold`, `min_inlier_count`, `min_inlier_ratio`.
  Passes `use_optical_flow: false`.
- **Optical flow**: Propagation via Lucas-Kanade optical flow through `track_bboxes_optical_flow()`.
  Params: `optflow_win_size`, `optflow_max_level`, `optflow_min_pts`. Passes
  `use_optical_flow: true`. Ideal for moving objects (vehicles, people).
- **Anomaly queue**: visible directly in Tracks after a guided run, with navigation,
  `Resolved frame` button and `R` key.
- ReID ResNet removed (UI + backend endpoints + service). ByteTrack removed from the UI (backend
  API kept for compatibility).
- The Homogr. and Optical flow tabs call the same endpoint
  `POST /api/projects/{id}/homography/propagate` with the `use_optical_flow` param.
- Propagation tasks show a green bar in AnnotationPage via the
  `onPropagationStarted(taskId, label)` callback.
- The task registry exposes `current_frame_id` for real-time navigation during
  propagation.

**AnnotationList** (`components/sidebar/AnnotationList.tsx`):

- Auto-scrolls to the annotation selected from the canvas.
- Shift+click for multi-selection; Delete key to delete.
- Double-click -> canvas zoom on the annotation via `uiStore.zoomToAnnotation`.
- AI provenance badge (SAM Point, SAM Auto, Grounding DINO, guided tracking, interpolation).
- NMS button with adjustable IoU threshold (expandable panel).
- "Delete all" button with inline confirmation.

**Key hooks:**

- `useKeyboardShortcuts(classes?)`: global shortcuts; ignores inputs.
- `useAutoSave(projectId)`: saves the session every 2 min.
- `useTaskPolling(taskId)`: polls `exportAPI.getStatus()` every 800 ms. Statuses:
  `'pending' | 'running' | 'completed' | 'error'`.

---

## Data flows

### Adding a manual annotation

1. The user draws on the canvas -> `AnnotationCanvas` calls
   `addAnnotation(AnnotationCreate)` on `annotationStore`.
2. The store calls `annotationsAPI.create(frameId, data)` -> `POST /api/frames/{id}/annotations`.
3. Response added to `store.annotations`, undo snapshot saved.
4. Canvas re-renders from the store's state.

### Text annotation (Grounding DINO)

1. The user types a prompt in the toolbar -> `samAPI.predictText(frameId, prompt)`.
2. Backend: Grounding DINO finds the boxes -> SAM2 refines them into masks.
3. Detections added via `addAnnotation()` with `is_auto: true, source_algorithm: 'grounding_dino'`.

### NMS (Non-Maximum Suppression)

1. NMS button in AnnotationList -> `onApplyNMS(iouThreshold)`.
2. `AnnotationPage.handleApplyNMS` -> `annotationsAPI.applyNMS(frameId, threshold)` ->
   `POST /api/frames/{id}/annotations/nms`.
3. Backend: sort by confidence, pairwise IoU computation, duplicate removal.
4. Frontend: reload the frame's annotations.

### YOLO export

1. `POST /api/projects/{id}/export` -> async task -> returns `task_id`.
2. Frontend polls `GET /api/exports/{task_id}/status` via `useTaskPolling`.
3. On `completed`: download via `GET /api/exports/{task_id}/download` (ZIP).

---

## Production deployment

```bash
# Build the frontend
cd frontend && npm run build  # -> frontend/dist/

# Add to backend/main.py after the routers:
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

app.mount("/assets", StaticFiles(directory="frontend/dist/assets"), name="assets")

@app.get("/{full_path:path}")
async def serve_frontend(full_path: str):
    return FileResponse("frontend/dist/index.html")

# Launch without --reload
uvicorn backend.main:app --host 0.0.0.0 --port 8000 --workers 1
```

A single uvicorn worker: SQLite (WAL mode) is not designed for multi-process writes.
