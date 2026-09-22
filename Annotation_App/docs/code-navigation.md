*[Lire en francais](code-navigation.fr.md)*

# Getting Started With The Code — Navigation & Debugging

Guide to understanding the code structure, knowing where to look, and debugging offline.

---

## The guiding thread (where to start)

### Backend — 5 key files, in order

```
1. backend/main.py            <- Entry point. Lifespan = starts services + DB migrations.
                                All routers are mounted here under /api/.

2. backend/database.py        <- get_session() = SQLite generator injected into every route.
                                WAL mode + foreign keys ON enabled here.

3. backend/models/*.py        <- SQLModel ORM definitions (= Pydantic + SQLAlchemy).
                                Project -> Frame -> Annotation, LabelClass, Track, SessionState.

4. backend/models/routers/*.py <- HTTP handlers. One file = one domain.
                                 Each route receives get_session() by injection.

5. backend/services/*.py      <- Business logic. Singletons instantiated in main.py's lifespan.
                                 sam_service, grounding_service, sam3_service = never recreated.
```

### Frontend — 5 key files, in order

```
1. frontend/src/App.tsx                  <- Two routes: "/" and "/projects/:id/annotate".

2. frontend/src/pages/AnnotationPage.tsx <- Central file (~900 lines).
                                           Orchestrates toolbar, canvas, sidebar, modals.
                                           Contains all the AI detection logic.

3. frontend/src/stores/annotationStore.ts <- Annotation state + undo/redo + clipboard.
                                            loadAnnotations(frameId, anns) <- frameId FIRST.

4. frontend/src/services/api.ts           <- All HTTP calls. Typed axios client.
                                            Namespaces: projectsAPI, annotationsAPI, samAPI...

5. frontend/src/components/canvas/
   AnnotationCanvas.tsx                   <- 3-layer Konva.js Stage.
                                            Coordinate conversion: stageToImageNormalized() -> [0,1].
```

---

## Who talks to whom

```
+---------------------------------------------------------------------+
|  FRONTEND                                                           |
|                                                                       |
|  AnnotationPage.tsx                                                  |
|    |  reads/writes to                                                |
|    +-> annotationStore   --> api.ts --> POST /api/frames/{id}/annotations
|    +-> projectStore      --> api.ts --> GET  /api/projects/{id}
|    +-> samStore          --> api.ts --> POST /api/sam/predict/points
|    |                      +-> websocket.ts --> WS /ws/sam/image
|    +-> uiStore           (zoom, active tab, modals)
|    +-> settingsStore     (loaded async -- see the useEffect[algoLoaded] pattern)
|                                                                       |
|  AnnotationCanvas.tsx                                                 |
|    +-- reads annotationStore.annotations -> KonvaImage + shapes       |
|    +-- mousedown/up/move -> addAnnotation() in annotationStore        |
+---------------------------------------------------------------------+
             | axios HTTP
             v
+---------------------------------------------------------------------+
|  BACKEND                                                             |
|                                                                       |
|  main.py                                                              |
|    +-> routers/annotation.py   -> get_session() -> SQLite            |
|    +-> routers/sam.py          -> sam_service / grounding_service    |
|    +-> routers/tracking.py     -> tracker_service / homography       |
|    +-> routers/dataset.py      -> dataset_service (ffmpeg)           |
|    +-> routers/export.py       -> dataset_service (YOLO zip)         |
+---------------------------------------------------------------------+
```

---

## Data flows — concrete cases

### Manually adding a bbox

```
1. AnnotationCanvas.tsx     mousedown -> startDrawing({tool:'bbox', startPoint})
2. AnnotationCanvas.tsx     mouseup   -> buildAnnotationCreate() -> annotationStore.addAnnotation()
3. annotationStore.ts       addAnnotation(frameId, data)
                             -> api.ts POST /api/frames/{frameId}/annotations
                             -> adds to store.annotations + undo snapshot
4. AnnotationCanvas.tsx     re-renders from the store (useSyncExternalStore via Zustand)
```

### Text detection (Grounding DINO)

```
1. AnnotationPage.tsx       submit textPrompt -> samAPI.predictText(frameId, prompt, boxThr, textThr)
2. api.ts                   POST /api/sam/predict/text  {frame_id, text_prompt, box_threshold, ...}
3. routers/sam.py           predict_text() -> grounding_service.predict()
4. grounding_service.py     DINO -> boxes -> SAM2 refinement -> returns TextPredictResponse
5. AnnotationPage.tsx       loops over detections -> annotationStore.addAnnotation() for each
```

### Text detection (SAM3)

```
1. AnnotationPage.tsx       submit textPrompt -> sam3API.predictText(frameId, prompt, boxThr, textThr)
2. routers/sam.py           predict_text_sam3() -> sam3_service.predict()
3. sam3_service.py          processor.set_image(img) + processor.set_text_prompt(state, prompt)
                             -> returns masks/boxes/scores in a single pass
4. AnnotationPage.tsx       same loop as GD -> addAnnotation()
```

### Loading a project (navigating to /projects/:id/annotate)

```
1. AnnotationPage.tsx       useEffect([projectId]) -> projectsAPI.getDetail(id)
2. projectStore.ts          setCurrentProject(detail) -> classes + session restored
3. projectStore.ts          loadFrames(id) -> GET /api/projects/{id}/frames
4. AnnotationPage.tsx       navigate to session.current_frame_index -> loadFrame(index)
5. api.ts                   GET /api/frames/{frameId}/annotations
6. annotationStore.ts       loadAnnotations(frameId, annotations)
```

### YOLO export

```
1. ExportModal.tsx          submit -> exportAPI.start(projectId, config)
2. api.ts                   POST /api/projects/{id}/export -> {task_id}
3. useTaskPolling.ts        GET /api/exports/{task_id}/status every 800ms
4. ExportModal.tsx          status === 'completed' -> exportAPI.download(task_id)
5. backend/services/
   dataset_service.py       write_yolo_label_file()     -> labels/
                             write_yolo_seg_label_file() -> seg_labels/ (if polygons)
```

---

## Settings — async pattern

Settings load asynchronously at startup. **Never** initialize state directly from settings without a resync:

```ts
// BAD -- value frozen at undefined on the first render
const [boxThr, setBoxThr] = useState(settings?.algorithms?.grounding_dino_box_threshold ?? 0.3)

// GOOD -- resync when settings arrive
const algoLoaded = useSettingsStore((s) => s.loaded)
const algoSettings = useSettingsStore((s) => s.settings?.algorithms)
const [boxThr, setBoxThr] = useState(algoSettings?.grounding_dino_box_threshold ?? 0.3)

useEffect(() => {
  if (!algoLoaded || !algoSettings) return
  setBoxThr(algoSettings.grounding_dino_box_threshold)
}, [algoLoaded]) // eslint-disable-line
```

---

## Debugging offline

### Check the backend state

```bash
# Overall health (SAM2 loaded? DINO available?)
curl http://localhost:8000/health | python3 -m json.tool

# Grounding DINO status
curl http://localhost:8000/api/sam/grounding/status | python3 -m json.tool

# Full Swagger UI
open http://localhost:8000/docs
```

### Inspecting the SQLite database directly

```bash
# Open the DB on the command line
sqlite3 data/annotation.db

# Useful queries:
.tables                                        -- list all tables
SELECT id, name, project_type FROM project;    -- list projects
SELECT COUNT(*) FROM annotation WHERE frame_id = 42;  -- annotation count for frame 42
SELECT * FROM annotation WHERE frame_id = 42 LIMIT 5;
SELECT * FROM sessionstate WHERE project_id = 1;
.quit

# Or use DB Browser for SQLite (GUI)
```

### Checking files on disk

```bash
# Frames extracted for a project
ls data/projects/1/frames/ | head -20
ls data/projects/1/thumbnails/ | head -5

# format specialise -> PNG (stored next to the .optional file, not in data/)
ls /path/to/png_file/

# Check that a frame actually has its image file
ls -la data/projects/1/frames/frame_000042.jpg
```

### Frontend — inspecting Zustand state

In Chrome devtools (F12) -> Console:

```js
// Read the annotations store state
window.__annotationStore = window.__annotationStore ||
  // inject via the zustand devtools extension
```

Simpler method: temporarily add `console.log(useAnnotationStore.getState())` in the component.

Or use the **Zustand DevTools** Chrome extension (if installed).

### Frontend — inspecting network calls

- F12 -> **Network** tab -> filter by `api`
- View HTTP requests, bodies, responses
- WS: filter by `WS` to see WebSocket messages

### Common errors

| Symptom | Likely cause | Where to look |
|----------|---------------|-------------|
| `503 Service Unavailable` on /api/sam/... | Missing SAM2 checkpoint | `backend/checkpoints/` -- missing .pt file |
| `503` on /api/sam/predict/text | Grounding DINO not loaded | `GET /health` -> `grounding.loaded` |
| Annotations disappear on project change | `clearAnnotations()` not called | `annotationStore.ts` + `AnnotationPage.tsx` |
| Settings not applied at startup | Missing async pattern | `useEffect([algoLoaded])` absent |
| `UnicodeEncodeError` on uvicorn startup | Emoji in a Python `print()` | Backend -- remove all emojis from logs |
| TypeScript build fails | Missing type | `npx tsc --noEmit` in `frontend/` |

---

## Adding a feature — checklist

### New backend endpoint

1. `backend/models/routers/` -- add the route to the right domain file
2. `backend/main.py` -- the router is already mounted (nothing to do if same domain)
3. `frontend/src/services/api.ts` -- add the function to the right namespace
4. `frontend/src/types/api.ts` -- add the return type if new

### New settings parameter

1. `backend/services/settings_service.py` -- add key + default value in `DEFAULT_SETTINGS`
2. `frontend/src/types/api.ts` -- add to `UserSettingsAlgorithms` (or another sub-interface)
3. `frontend/src/components/modals/SettingsModal.tsx` -- add the UI control
4. The component that uses it -- add the `useState` + `useEffect([algoLoaded])` pattern

### New annotation type

1. `frontend/src/types/api.ts` -- extend `AnnotationType`
2. `backend/models/annotation.py` -- update validation
3. `frontend/src/components/canvas/AnnotationCanvas.tsx` -- handle rendering
4. `backend/services/dataset_service.py` -- handle the export
