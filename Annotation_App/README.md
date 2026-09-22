*[Lire en francais](README.fr.md)*

# Annotation App

FastAPI + React application for annotating images and video sequences with AI assistance.
Additional sequence formats can be added through an optional Python adapter.

State of this rework: the isolated workspace architecture and the orchestrator endpoints are kept, but media loading has been made sparse and lazy for large datasets.

## Purpose

The app is designed for heavy datasets (e.g. 4000 images at 3000 x 3000) and
remote usage (backend on a VM via SSH, web UI on Windows):

- no thumbnails: the timeline shows annotation counters (green/red);
- smooth slider navigation, prefetch of adjacent frames, gzipped API responses;
- **multi-sequence** projects: image folders, videos, and optional formats mixed within a single project;
- **16-bit** images (RGB or IR) read natively (3-sigma -> 8-bit conversion);
- hierarchical classes: class (detection) > subclass (recognition) > sub-subclass (identification);
- real-time frame-by-frame display of tracking processing;
- tracking anomalies exposed for manual correction;
- YOLO export per sequence or .ver files (native text format) per sequence.

## Launching

From the global launcher:

```bash
cd <suite-root>
python launcher.py --app annotation --workspace <workspaces-root> --user <user>
```

Direct launch:

```bash
cd <suite-root>/Annotation_App
python launcher.py --workspace <workspaces-root> --user <user>
```

Default ports:

- backend: `http://localhost:8000`
- frontend: `http://localhost:5173`
- API docs: `http://localhost:8000/docs`

On a Linux VM reachable from Windows via VS Code SSH, launch the same launcher inside the VM with `--host 0.0.0.0` if the launcher exposes it, then open the forwarded port `5173` on the Windows side. The frontend proxies `/api` to the backend; if the backend stops, the pollers cut off after several failures to avoid `ECONNREFUSED` spam.

By default, the launcher starts uvicorn with access logs disabled to avoid console spam. Add `--access-log` to the launcher if you want to see every HTTP request during a diagnostic.

The global launcher accepts `--conda-path <path>` (conda env root, `bin/activate`,
or python executable) -- takes priority over `--conda-env`. This path is filled in the
VisionNexus Settings (required field) and passed automatically to the SSH command.

## Preserved Invariants

- User data stays under `WORKSPACE/annotation_<user>/`.
- The `/api/orchestrator/*` endpoints remain the contract with Orchestrator App.
- Annotation coordinates remain normalized YOLO `[0, 1]` in the database.
- SQLite stays in WAL mode, with a single uvicorn worker.
- Project files remain under `projects/{project_id}/frames`, `frames_8bit` (16-bit cache), `exports`.

## Optional Format Adapter

format specialise support is contained in a single removable file: `backend/utils/format specialise.py`.
`GET /api/capabilities` reads only the `FORMAT_CAPABILITY` constant via AST; the module
is imported only when a matching file is processed. The frontend then dynamically
builds the label, accepted extensions, drag-and-drop, and import.

Removing `backend/utils/format specialise.py`, then restarting the app, produces `specific_formats: []`: no
format specialise option appears in the frontend and standard image/video imports keep
working. The reader seeks directly to the requested frame and keeps the native dtype;
the 1.8 GB validation file was read on its last frame without loading the whole sequence.

## Media And Performance

### Frames

`GET /api/projects/{id}/frames` returns frame metadata (with `annotation_count`). The timeline is virtualized: only the cells visible around the scroll position are mounted in the DOM. Optional filter `?sequence_id=` for a given sequence.

The frontend store no longer does recursive auto-pagination. For typical datasets, it loads the metadata in one broad pass, then lets the timeline handle sparse rendering.

Folder import is now incremental: the task inserts frames into the database in batches while the folder is being scanned. The page can therefore start showing already-imported frames without waiting for all 4000 images to finish.

When loading an existing project, the backend checks that image files present on disk actually have a `Frame` record in the database. This repairs interrupted imports or old projects where only a few thumbnails were navigable even though `frame_count` announced several thousand frames.

### Multi-sequence

Each import (image folder, video, or optional format, via upload or server path) creates a **Sequence**
in the project. Frames are appended in sequence (contiguous global frame_index) with a
unique file prefix per sequence (`s001_frame_000000.jpg`).

- `GET /api/projects/{id}/sequences`: list + stats (annotated frames, annotation count).
- The UI shows a sequence dropdown to the left of the slider: selecting one
  jumps to the start of the sequence, the label shows `annotated/total` and the annotation count.

### 16-bit Images (RGB / IR)

16-bit image folders (PNG/TIFF) are imported as-is (zero-copy symlink).
For display, `GET /api/frames/{id}/image` serves an 8-bit version (3-sigma stretch)
cached in `frames_8bit/`. All algorithms (SAM2/SAM3/GD/homography/optical flow/
SAMURAI) load via `load_image_bgr_8bit` -- same rendering as the display.

### Lazy Extraction

For videos, the app still extracts in the background, but the canvas also requests local extraction around the active frame:

```text
POST /api/projects/{project_id}/frames/ensure_extracted
```

During scrubbing, the request is debounced and throttled to avoid a cascade of seeks. Outside scrubbing, a small neighborhood is preloaded.

## Timeline

The timeline is a sparse bar **with no thumbnails at all** (the concept was removed -- too
costly performance-wise, especially over SSH):

- virtualized compact cells: **green** = annotated frame with the annotation count,
  **red** = empty frame;
- the current frame's counter is updated **live** on every annotation add/remove
  (wired to the store), without a web reload;
- horizontal scroll across the whole sequence, current frame counter;
- track lanes kept above;
- batch selection: `Ctrl`/`Cmd` + click adds/removes a frame, `Shift` + click
  selects a range, **`Ctrl+A`** (timeline hovered) selects all, `Esc`
  deselects, `Delete` clears annotations of the selected frames;
- multi-frame deletion happens in **a single server-side request** (fast even
  on thousands of frames), not one call per frame.

The main slider under the canvas is **relative to the active sequence** in multi-sequence mode
(it only covers the frames of that sequence): switching sequences via the
dropdown resets the slider to `0 -> N` for the new sequence.

## Real-time Performance Over SSH

The target workflow is: FastAPI/SAMURAI backend on a remote Linux VM, frontend in
VisionNexus Electron on Windows, API and WebSocket via SSH port-forward to a local port.
Pixels follow a different route: direct UNC read via `app-image://` and
`paths.native_share_host` (DNS name or IP of the share), with automatic HTTP fallback. The name of the SSH
VM and that of the native network share host can be different.
The limiting factor is NOT React/Vite but **network latency x number of requests**.
Design choices to stay responsive:

- **Vite proxy on `127.0.0.1`** (never `localhost`): avoids ~200 ms of IPv6
  attempt per request on the Windows side.
- **GZip** on JSON responses (~10x) -- frame lists, annotations.
- **Scrubbing**: the slider loads 480 px JPEG previews (~15 KB) instead of
  full-resolution images (several MB), with prefetch of a neighborhood; the full
  resolution image is only loaded once the slider stops.
- **Browser cache** (`Cache-Control: max-age`) on extracted images + memory
  cache of adjacent annotations -> navigation <- -> near-instant.
- **Real-time live** (`interface.realtime_live_enabled`, ON by default): during
  SAMURAI/SAM2, annotations arrive over WebSocket and the image uses
  `nativePath`/`app-image://` under Electron when the native path is available. A
  direct path provided by the backend is attempted even if the launcher's generic SMB probe is
  inactive; short timeout then automatic HTTP fallback on failure. The Tracks panel
  and the top bar share a single WebSocket connection, so that no `native_path`
  is consumed by the wrong component.
- **Live cadence**: `interface.propagation_nav_throttle_ms` defaults to 150 ms, which is
  the WebSocket loop cadence. `0` follows every GPU result; `700` throttles
  decoding if the client mostly relies on the HTTP fallback. This cadence samples the
  drawn images, never the image/annotation association. Profiles that still had
  the old default of 700 ms are migrated once to 150 ms; custom values are
  preserved.
- **Canvas protection during a propagation**: the cache and DB reads are
  suspended as long as the WebSocket is supplying previews. This avoids alternating between a
  not-yet-committed cache and the live state, which used to cause `Maximum update depth exceeded`
  followed by a gray screen. Temporary `0x0` measurements from a hidden Electron tab are also
  ignored so that Konva doesn't destroy its buffers during a deferred draw.
- **Deletion / stats** grouped into a single request rather than N.
- **No thumbnails** (no image request for the timeline).

Still costly and unavoidable: the **first** load of a full-resolution image
not yet cached (file size x latency). If a dataset is very heavy (4K PNG),
prefer extracting to JPEG on import. In practice, with these optimizations, browsing
a sequence over SSH is smooth; latency spikes come from a heavy
image never seen before, not from excessive requests.

## AI Annotation

Main features:

- SAM2 point and SAM auto;
- Grounding DINO text to bbox;
- SAM3 text to bbox or segmentation;
- batch text over a range of frames;
- per-frame NMS;
- hierarchical classes: class (required) > subclass > sub-subclass
  (e.g. drone > quadcopter > mavic);
- **YOLO** export (one `{sequence}-yolo/` subfolder per annotated sequence) or
  **.ver** (one file per sequence, native text format:
  `frame_id vis x1 y1 x2 y2 track_id class subclass name`, pixels, 1-based).

The text/GD/SAM3 button in the top bar remains the recommended path for interactive detection on the current frame, since it renders results directly and visibly.

## Tracking

Available modes (in tab order):

- `SAMURAI/SAM2` (default): video propagation from reference annotations,
  **bounding-box prompt**. If the local fork `backend/ext/samurai_repo/sam2` and the
  `configs/samurai/*.yaml` configs are loaded, the UI shows SAMURAI; otherwise it explicitly
  announces the SAM2 fallback. Server logs prefixed `[SAM2Track]`, video
  session closed after each run (no VRAM leak).
- `Detect.`: Grounding DINO or SAM3 + centroid matching. This mode detects on the following frames and matches detections to the selected targets; it works well if the target stays close by and the text prompt is reliable.
- `Homography`: XFeat/SIFT, mainly useful when camera motion dominates.
- `Optical flow`: Lucas-Kanade, useful for small local displacements.

(ReID ResNet and ByteTrack removed.)

For a real video sequence, the recommended workflow is:

1. annotate a key frame cleanly;
2. run SAMURAI if the target must be propagated from a single frame, especially with occlusions;
3. use Detect. if the text prompt is reliable and motion is gradual;
4. inspect the `Anom.` dock, correct manually, then rerun from a new key frame if needed.

Detect. mode and long propagations feed the `Anom.` dock to the right of `Help`:

- missing target;
- excessive size variation;
- detection error;
- auto-stop if too many targets are lost over several frames.

Each history entry is grouped by frame, clickable, and shows a clear reason for the anomaly. The current frame can be marked resolved with the `Resolved frame` button or the `R` key.

The frontend tracks the task over WebSocket (`/ws/tasks/{id}`) and navigates to
`current_frame_id` when `interface.realtime_live_enabled` is active. Annotation
previews are pushed into `live_frames`, without waiting for the SQLite flush, and propagation
images go through `nativePath`/SMB under Electron when available. Aggressive
preloading of several full-resolution images was removed to avoid saturating
memory and the image decoder.

With live disabled, the canvas stays on the chosen frame during computation; progress
and counters keep arriving over WebSocket, then a single DB
resync reloads the final result. With live enabled, the canvas
follows the propagation at the configured cadence and the WebSocket remains its sole
source of annotations until the end. No error boundary is used to hide a crash:
state conflicts and zero canvas sizes are blocked at the source.

The "annotations visible one frame out of ten" symptom used to come from a DB re-read triggered
after each `live_frames` batch. Since SAMURAI commits to SQLite in batches of 10, this re-read
returned an empty list and wiped the WebSocket overlay. An explicit `hasLivePayload` marker now
blocks any annotations GET while a live batch has been received; each displayed frame therefore
keeps its image and annotations from the same `frame_id`.

In the VisionNexus log, `[SAM2Track] ... NATIVE (SMB)` confirms the path computed by the
backend; `[app-image] native read confirmed` confirms the actual SMB read by
Electron. A line `[app-image] HTTP fallback: ...` instead gives the reason for the fallback.

## Architecture

```text
Annotation_App/
  backend/
    main.py
    config.py
    database.py
    models/
      project.py
      frame.py
      annotation.py
      track.py
      routers/
        projects.py
        dataset.py
        annotation.py
        tracking.py
        sam.py
        export.py
        orchestrator.py
    services/
      dataset_service.py
      task_registry.py
      sam_service.py
      sam3_service.py
      grounding_service.py
      homography_service.py
      tracker_service.py
  frontend/
    src/
      pages/AnnotationPage.tsx
      components/timeline/Timeline.tsx
      components/sidebar/TrackPanel.tsx
      components/canvas/AnnotationCanvas.tsx
      stores/projectStore.ts
      services/api.ts
```

## Key Endpoints

```text
GET  /health
GET  /api/projects
POST /api/projects
GET  /api/projects/{id}
GET  /api/projects/{id}/frames
GET  /api/projects/{id}/sequences
POST /api/projects/{id}/frames/ensure_extracted
GET  /api/frames/{id}/image

GET  /api/frames/{id}/annotations
POST /api/frames/{id}/annotations
POST /api/frames/{id}/annotations/bulk
POST /api/frames/{id}/annotations/nms

POST /api/sam/predict/points
POST /api/sam/predict/text
POST /api/sam3/predict/text

POST /api/projects/{id}/guided-tracking/run
POST /api/projects/{id}/sam2-tracking/run
POST /api/projects/{id}/homography/propagate
GET  /api/tasks/{task_id}

POST /api/projects/{id}/export
POST /api/orchestrator/create-project
POST /api/orchestrator/export-yolo
```

## Dev Validation

Backend:

```bash
python -m py_compile backend\services\dataset_service.py backend\models\routers\dataset.py backend\models\routers\tracking.py
```

Frontend:

```bash
cd frontend
npm run build
```

## Linux Packaging (offline target machine)

From `App/Vision/`:

```bash
# Standalone zip of the Annotation App alone (models included -- checkpoints in-tree):
python zip_all_apps.py --annotation

# Replacement in the Computer_Vision_App bundle on the target machine:
#   (the zip contains Annotation_App/ at the root, same structure as the bundle)
rm -rf /path/Computer_Vision_App/Annotation_App
unzip Annotation_App_linux_x64.zip -d /path/Computer_Vision_App/
chmod +x /path/Computer_Vision_App/Annotation_App/setup_linux.sh
/path/Computer_Vision_App/Annotation_App/setup_linux.sh
```

No other change required: the bundle's global launcher finds the app in place.

## Notes

- No thumbnail is generated (timeline = annotation counters).
- 3000 x 3000 images remain heavy: the canvas must not preload several full-resolution frames.
- The Homography and Optical flow modes are kept, but should be considered specialized tools, not the main universal tracking method.
- For a heavy sequential image dataset on local/VM disk, use folder import with symlink when possible.
- Auto-save is completely silent (session + JSON backup every 2 min, no toast).

## Documentation

- [docs/README.md](docs/README.md): topic index (architecture, code navigation,
  frame loading, step-by-step installation).
