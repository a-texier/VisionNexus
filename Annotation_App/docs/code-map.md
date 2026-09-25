---
app: annotation
doc_type: code-map
audience: dev
lang: en
title: Code map
order: 80
tags: [code navigation, backend, frontend, extension, debugging]
sources: [Annotation_App/backend/main.py, Annotation_App/backend/database.py, Annotation_App/backend/models, Annotation_App/backend/services, Annotation_App/backend/utils, Annotation_App/frontend/src/App.tsx, Annotation_App/frontend/src/pages/AnnotationPage.tsx, Annotation_App/frontend/src/stores, Annotation_App/frontend/src/services/api.ts, Annotation_App/frontend/src/components]
---

# Code map

## Where to start reading the backend code

The backend of Annotation App is in `Annotation_App/backend/`. Read these files in this order to understand it:

1. `main.py`: the entry point. The lifespan raises the threadpool limit, creates the tables, runs `_run_migrations()` and loads SAM2; the routers are mounted here; application endpoints (`/health`, `/api/capabilities`, `/api/app-mode`, workspace helpers, monitoring) are defined here.
2. `config.py`: the workspace (`ANNOTATION_WORKSPACE`), the database path, the settings file, the ports and the CORS origins.
3. `database.py`: the SQLAlchemy engine (WAL, foreign keys, busy timeout, pool sizing) and `get_session()`, injected into every route.
4. `models/*.py`: the SQLModel tables `Project`, `Sequence`, `Frame`, `Annotation`, `Track`, `LabelClass`, `SessionState`.
5. `models/routers/*.py`: the HTTP handlers, one file per domain (`projects`, `dataset`, `annotation`, `sam`, `tracking`, `export`, `orchestrator`, `samples`, `settings`, `storage`, `convert`, `docs`).
6. `services/*.py`: business logic and model singletons (`sam_service`, `grounding_service`, `sam3_service`, `homography_service`, `dataset_service`, `task_registry`, `settings_service`, `monitoring_service`...).
7. `utils/`: `image_utils.py` (LUT, 8-bit conversion, mask to polygon, caches), `native_share.py` (server path to UNC and back), `format specialise.py` (optional format adapter), `yolo_utils.py`, `color_utils.py`.

Other folders: `checkpoints/` (model weights), `ext/samurai_repo/` (SAMURAI fork), `models/xfeat/` (XFeat), `tests/` (unit, API and integration tests, model download scripts). `tasks/` holds Celery task definitions that are not wired into the running application.

The biggest files are `models/routers/dataset.py` and `models/routers/tracking.py` (more than 2000 lines each): search them by endpoint path rather than reading them linearly.

## Where to start reading the frontend code

The frontend of Annotation App is in `Annotation_App/frontend/src/`. Read these files in this order:

1. `App.tsx`: the routes (`/`, `/projects/:projectId/annotate`, `/presentation`, `/convert`, `/monitoring`) and the language initialization.
2. `pages/AnnotationPage.tsx`: the central file (about 2600 lines). It orchestrates the toolbar, the canvas, the sidebars, the timeline, the modals, text detection and SAM Auto, frame navigation, the live propagation display and the progress bars.
3. `stores/annotationStore.ts`: annotations of the current frame, tool, class, selection, shared tracking targets, undo/redo, clipboard. `loadAnnotations(frameId, annotations)` takes the frame id first.
4. `services/api.ts`: all HTTP calls, in typed namespaces; `types/api.ts` holds the TypeScript mirrors of the backend schemas.
5. `components/canvas/AnnotationCanvas.tsx`: the Konva stage, drawing tools, SAM points, coordinate conversion with `stageToImageNormalized()`.
6. `components/sidebar/TrackPanel.tsx`: the Tracks panel (SAMURAI, Detect., Homogr., Opt. flow, logs and tracks list).

Other entry points: `pages/ProjectsPage.tsx` (home), `pages/PresentationPage.tsx` with `components/docs/` (built-in documentation), `components/timeline/Timeline.tsx` and `TrackLane.tsx`, `components/modals/` (import, export, settings, help, file browser, project creation), `components/sidebar/` (right panel, classes, annotation list, help), `components/panels/LutPanel.tsx`, `services/websocket.ts` (WebSocket client and task broker), `hooks/` (keyboard shortcuts, auto-save, export polling). `components/panels/FramesPanel.tsx` and `components/sidebar/GlobalAnnotationsPanel.tsx` are not used by the current pages.

## Where to change the annotation tools and the canvas

Changes to drawing, selection and display of annotations touch these files:

| To change | Edit |
|---|---|
| Tool list and toolbar buttons | `TOOLS` and the header of `pages/AnnotationPage.tsx` |
| Keyboard shortcuts | `hooks/useKeyboardShortcuts.ts` (and the help texts in `components/help/helpContent.ts`); the class list for digit keys is passed by `useKeyboardShortcuts(...)` in `pages/AnnotationPage.tsx`, currently with `undefined` |
| Mouse handling, drawing, SAM points, zoom and pan | `components/canvas/AnnotationCanvas.tsx` |
| Box rendering, handles, double-click to toggle a tracking target | `components/canvas/BBoxShape.tsx` |
| Pixel and normalized coordinates | `utils/coordinates.ts` |
| Annotation list, filters, NMS, SAM Auto proposals, track selector | `components/sidebar/AnnotationList.tsx` |
| Classes and hierarchy | `components/sidebar/LabelManager.tsx`, backend `models/label_class.py` and `routers/projects.py` |
| Undo / redo | `stores/annotationStore.ts` (per frame), `stores/bulkUndoStore.ts` (timeline deletions) |
| Timeline cells and track lanes | `components/timeline/Timeline.tsx`, `components/timeline/TrackLane.tsx` |

Adding an annotation type requires: extending `AnnotationType` in `frontend/src/types/api.ts`, updating validation in `backend/models/annotation.py`, rendering it in `AnnotationCanvas.tsx`, and handling it in the export writers of `backend/services/dataset_service.py` and `routers/export.py`.

Keep coordinates normalized in `[0, 1]` at every boundary: convert in the canvas, never store pixels.

## Where to change a tracking or propagation algorithm

Each propagation mode has an endpoint in `backend/models/routers/tracking.py`, a service, and a tab in `frontend/src/components/sidebar/TrackPanel.tsx`.

| Mode | Endpoint handler | Service | Frontend |
|---|---|---|---|
| SAMURAI / SAM2 video | `run_sam2_tracking` (`/sam2-tracking/run`) | `sam_service.py` (`configure_video_tracking`, video sessions) | SAMURAI tab, `handleRunSam2Tracking` |
| Detect. (guided tracking) | `/guided-tracking/run`, `_greedy_match`, `_centroid_dist_yolo`, `_size_variation` | `grounding_service.py`, `sam3_service.py` | Detect. tab, `handleRunGuidedTracking` |
| Homography | `propagate_homography` (`/homography/propagate`, `use_optical_flow=false`) | `homography_service.compute_homography`, `warp_bbox_yolo` | Homogr. tab, `handleRunXFeat` |
| Optical flow | same endpoint with `use_optical_flow=true` | `homography_service.track_bboxes_optical_flow` | Opt. flow tab, `handleRunOptflow` |
| Homography debug | `/homography/debug` | `compute_homography_debug` | `components/sidebar/XFeatDebugPanel.tsx` |

SAMURAI parameters (memory size, Kalman weight, thresholds) come from the configuration files in `backend/ext/samurai_repo/sam2/sam2/configs/samurai/`; the model is chosen in `sam_service.py` (`MODEL_CONFIGS`, `SAMURAI_CONFIGS`). Default values shown in the interface come from `DEFAULT_SETTINGS` in `backend/services/settings_service.py`.

The live display during a run involves `task_registry.py` (queue, logs), the WebSocket handler in `tracking.py`, `subscribeTaskProgress` in `services/websocket.ts`, and `handleLiveFramePreview` in `AnnotationPage.tsx`. Respect the invariants listed in [Architecture](architecture.md): one socket per task, WebSocket as the only annotation source during a run, stop checks in every loop.

## Where to add a new algorithm

A new algorithm (a detector, a propagation method) follows the same pattern as the existing ones: a backend singleton service, an endpoint, a typed client function and an interface control.

1. **Service**: create `backend/services/my_algo_service.py` with a class exposing `load()`, `is_available()` and a prediction method that returns normalized boxes (`cx`, `cy`, `w`, `h`, `confidence`, class), and a module-level singleton instance. Load heavy models lazily or in the lifespan of `main.py`.
2. **Endpoint**: add a route to the router of the right domain in `backend/models/routers/` (or a new router mounted in `main.py`). Get the frame with the injected session, read its image with `load_image_bgr_8bit(path, lut)` so the display LUT applies, raise `HTTPException(503)` when the service is unavailable, and save `Annotation` rows with normalized coordinates, `is_auto=True` and a new `source_algorithm` value. Add that value to `AUTO_SOURCES` in `services/monitoring_service.py` so the Monitoring page labels it.
3. **Long runs**: for a propagation over many frames, create a task with `task_registry.create_task`, run a synchronous function in the background, call `update_task(..., current_frame_id=...)` per frame, `append_log()` for the Logs view, check `is_stop_requested()` in the loop, set `frame.is_annotated`, and return the `task_id` at once. Push per-frame previews to the live queue if the canvas should follow.
4. **Client**: add a function to the right namespace of `frontend/src/services/api.ts` and its types to `frontend/src/types/api.ts`. The axios interceptor already shows error toasts.
5. **Interface**: add the control (a toolbar button in `AnnotationPage.tsx`, or a tab in `TrackPanel.tsx`). After saving, reload the frame annotations with `loadAnnotations(frameId, annotations)`; for tasks, subscribe with `subscribeTaskProgress(taskId, ...)`.
6. **Texts**: wrap French strings with `t()` and add the English translation to `EXACT_EN` in `frontend/src/i18n/translate.ts`.

## Where to add a setting

A user setting lives in four places, in this order:

1. `backend/services/settings_service.py`: add the key and its default value to the right group of `DEFAULT_SETTINGS` (`interface`, `paths`, `import`, `algorithms`, `export`). Saved files are deep-merged with the defaults, so existing users get the new key automatically. If an existing default changes meaning, bump `SETTINGS_SCHEMA_VERSION` and add a one-time migration in `_migrate()`.
2. `frontend/src/types/api.ts`: add the field to the matching interface (for example `UserSettingsAlgorithms`).
3. `frontend/src/components/modals/SettingsModal.tsx`: add the control in the right section, with a French label wrapped in `t()` and its English translation in `i18n/translate.ts`.
4. The component or endpoint that uses it. Settings load asynchronously: initialize local state with a fallback and resynchronize when they arrive.

```ts
const algoLoaded = useSettingsStore((s) => s.loaded)
const algoSettings = useSettingsStore((s) => s.settings?.algorithms)
const [boxThr, setBoxThr] = useState(algoSettings?.grounding_dino_box_threshold ?? 0.3)

useEffect(() => {
  if (!algoLoaded || !algoSettings) return
  setBoxThr(algoSettings.grounding_dino_box_threshold)
}, [algoLoaded]) // eslint-disable-line
```

Backend code reads settings with `settings_service.load()` at the time of use, so changes apply without restart. Document the new option in [Configuration](configuration.md).

## Where to change import, export and file formats

Import and export code is spread over the dataset and export routers and their services.

| To change | Edit |
|---|---|
| Import window, slots, options | `frontend/src/components/modals/ImportModal.tsx`, queue in `stores/importStore.ts` |
| Folder, image, video import endpoints and sequence creation | `backend/models/routers/dataset.py` (`import_*`, `_seq_prefix`) |
| Frame extraction, folder scanning | `backend/services/dataset_service.py` |
| Import of existing annotations (`.ver`, YOLO) | `backend/services/annotation_import_service.py`, `dataset.py` (`import-annotations`) |
| Optional sequence formats | a new adapter module in `backend/utils/` exposing a literal `FORMAT_CAPABILITY`, discovered by `backend/services/format_registry.py` (see `utils/format specialise.py`) |
| Export window | `frontend/src/components/modals/ExportModal.tsx` |
| Export task, `.ver` writer, sequence layout | `backend/models/routers/export.py` |
| YOLO and COCO writers | `backend/services/dataset_service.py` (YOLO dataset layout, `export_coco_dataset`) and `backend/utils/yolo_utils.py` (`write_yolo_label_file`, `write_yolo_segmentation_label_file`, `write_data_yaml`) |
| Stand-alone conversions | `backend/services/convert_service.py`, `routers/convert.py`, `pages/ConvertPage.tsx` |
| Orchestrator contract | `backend/models/routers/orchestrator.py` |
| Backup, restore, sequence manifest | `routers/projects.py` (`backup`, `backup/save`, `restore`), `routers/dataset.py` (`parse-manifest`), `hooks/useAutoSave.ts` |

When adding an export format, add its value to `output_format`, write it per sequence like the existing ones, record `last_export_format`, and add a button to `ExportModal.tsx`.

## Where to change image loading and caches

Image serving and caching are performance-critical, especially over SSH; read the related sections of [Architecture](architecture.md) before changing them.

| To change | Edit |
|---|---|
| Image tiers (480 / 1600 / full), placeholders, cache headers | `serve_frame_image`, `_ensure_preview_cached`, `_serve_preview` in `backend/models/routers/dataset.py` |
| Native path for the Electron shell | `/api/frames/{id}/image-path` in `dataset.py`, `backend/utils/native_share.py` |
| LUT computation, 8-bit conversion, cache signatures and purge | `backend/utils/image_utils.py` (`apply_lut`, `lut_signature`, `purge_stale_lut_caches`, `load_image_bgr_8bit`, `ensure_8bit_cached`) |
| Histogram cache | `_HIST_CACHE` in `dataset.py` |
| LUT panel | `frontend/src/components/panels/LutPanel.tsx` |
| Frame navigation, prefetch, scrubbing throttle, annotations LRU | `pages/AnnotationPage.tsx` (`handleFrameSelect`, `annotationsCacheRef`, `liveFrameImageUrl`) |
| Frame list pagination | `stores/projectStore.ts` (`fetchFrames`) |
| Database pool, threadpool | `backend/database.py`, lifespan of `backend/main.py` |
| Vite proxy | `frontend/vite.config.ts` |

Keep the rules: never prefetch during scrubbing or propagation, keep the HTTP fallback of native reads, keep the SQL pool above the threadpool, and route every model input through the effective LUT.

## Where to change help, tutorial and translations

Built-in help and the tutorial are code, separate from this documentation.

- `frontend/src/components/help/helpContent.ts`: the single source of the **Help** tab and the help window (shortcuts, modes, features, models, workflow). Update it when shortcuts or modes change, together with `hooks/useKeyboardShortcuts.ts`.
- `frontend/src/components/sidebar/HelpPanel.tsx` and `components/modals/HelpModal.tsx`: their layout.
- `frontend/src/components/help/annotationTourSteps.ts`: the script of the interactive tutorial (demo projects, steps, targets). Steps point at elements through `data-tour` attributes; keep those attributes when refactoring components. The generic tour engine is in `components/tour/`, the "already seen" state in `utils/tutorialState.ts` (stored by VisionNexus, with a fallback in the settings).
- `frontend/src/i18n/translate.ts`: French is the source language in the code; `t('texte')` looks up `EXACT_EN` for English. The language comes from the `?lang=` parameter set by VisionNexus, else a local preference, else English. Every new visible string needs an entry.
- Product documentation: `Annotation_App/docs/` (this page set), served by `backend/models/routers/docs.py` (`/api/docs`) to `pages/PresentationPage.tsx`, which renders it with `components/docs/MarkdownDoc.tsx` and `markdown.ts` (heading anchors `h-<n>`, links between pages). Write it following `tools/docs/DOC_STYLE.md` and check it with `python tools/docs/lint_docs.py --app annotation`.

## Debugging tools: database, network and state

Useful tools to inspect a running Annotation App:

**Backend state**: `curl http://localhost:8000/health`, `/api/sam/ping`, `/api/sam/grounding/status`, `/api/sam3/status`, `/api/samurai/status`, `/api/homography/status`. The Swagger interface at `/docs` calls any endpoint. Start the launcher with `--access-log` to print every request.

**Database**: open `<workspace>/annotation.db` with `sqlite3` or DB Browser for SQLite (read-only while the app runs is safest):

```sql
.tables
SELECT id, name, project_type, frame_count FROM project;
SELECT id, name, start_index, frame_count FROM sequence WHERE project_id = 1;
SELECT COUNT(*) FROM annotation WHERE frame_id = 42;
SELECT source_algorithm, COUNT(*) FROM annotation GROUP BY source_algorithm;
```

**Files**: list `projects/<id>/frames/` to check that frames exist and that symbolic links are not broken (`ls -la`); cache folders can be deleted safely.

**Tasks**: the **Logs** view of the Tracks panel shows the task log; `GET /api/tasks/{id}` and `/logs?since=0` give the same information over HTTP.

**Frontend**: browser devtools (`F12`), **Network** tab filtered on `api` for HTTP and `WS` for WebSocket messages (look at `live_frames` during a run). Read a store with a temporary `console.log(useAnnotationStore.getState())`, or the Zustand devtools extension. Check TypeScript with `npx tsc --noEmit` and build with `npm run build` in `frontend/`.

Common signals: a 503 on `/api/sam/...` means a missing checkpoint; annotations leaking between projects mean `clearAnnotations()` was not called; settings ignored at startup mean the async resync pattern is missing; a `UnicodeEncodeError` at startup means a non-encodable character in a backend `print`. More cases are in [Troubleshooting](troubleshooting.md).

## Module map

<!-- generated:start -->
### backend

| File | Description | Exports |
|---|---|---|
| `config.py` |  |  |
| `database.py` |  | `set_sqlite_pragma`, `create_db_and_tables`, `get_session` |
| `main.py` |  | `lifespan`, `get_app_mode`, `get_capabilities`, `root`, `health_check`, `workspace_users`, `workspace_open`, `monitoring_stats`, `monitoring_report`, `workspace_open_cmd`, `workspace_history`, `sam_ping` |

### backend/models

| File | Description | Exports |
|---|---|---|
| `annotation.py` |  | `AnnotationType`, `Annotation` |
| `frame.py` |  | `Frame` |
| `label_class.py` |  | `LabelClass` |
| `project.py` |  | `ProjectType`, `Project` |
| `sequence.py` |  | `Sequence` |
| `session_state.py` |  | `SessionState` |
| `track.py` |  | `Track` |

### backend/models/routers

| File | Description | Exports |
|---|---|---|
| `annotation.py` |  | `AnnotationCreate`, `AnnotationUpdate`, `BulkAnnotationsCreate`, `CopyToFramesRequest`, `InterpolateRequest`, `list_all_project_annotations`, `list_annotations`, `create_annotation`, `update_annotation`, `delete_annotation`, `bulk_create_annotations`, `delete_all_frame_annotations` (+14) |
| `convert.py` |  | `OtiToPngRequest`, `PngToOtiRequest`, `VerToYoloRequest`, `YoloToVerRequest`, `convert_format specialise_to_png`, `convert_png_to_format specialise`, `convert_ver_to_yolo`, `convert_yolo_to_ver` |
| `dataset.py` |  | `ImportAnnotationsRequest`, `ManifestPathRequest`, `parse_sequence_manifest`, `import_sequence_annotations`, `import_sequence_annotations_upload`, `datetime_now_label`, `import_images`, `import_folder`, `import_video`, `import_specific_format`, `import_format specialise`, `ensure_frames_extracted` (+21) |
| `docs.py` |  | `parse_frontmatter`, `load_doc_set`, `doc_path`, `read_doc`, `safe_asset_path`, `list_docs`, `get_doc_asset`, `get_doc` |
| `export.py` |  | `ExportRequest`, `start_export`, `get_export_status`, `download_export`, `preview_export` |
| `orchestrator.py` |  | `LabelClassInput`, `CreateProjectRequest`, `ExportYoloRequest`, `ExportVerRequest`, `AutoAnnotateRequest`, `check_source`, `create_project`, `project_status`, `export_yolo_orchestrator`, `export_ver_orchestrator`, `auto_annotate` |
| `projects.py` |  | `LabelClassCreate`, `ProjectCreate`, `ProjectUpdate`, `SessionStateUpdate`, `list_projects`, `create_project`, `LutUpdate`, `get_project_lut`, `set_project_lut`, `get_project`, `update_project`, `delete_project` (+11) |
| `sam.py` |  | `SAMPoint`, `PredictPointsRequest`, `AutoSegmentRequest`, `LoadModelRequest`, `get_sam_status`, `load_sam_model`, `predict_with_points`, `TextPredictRequest`, `predict_with_text`, `get_grounding_status`, `websocket_sam_image`, `websocket_sam_video` (+4) |
| `samples.py` |  | `list_sample_sequences`, `get_sample_sequence` |
| `settings.py` |  | `get_settings`, `update_settings`, `reset_settings`, `workspace_info`, `reveal_workspace` |
| `storage.py` |  | `storage_stats`, `clear_backup`, `clear_exports` |
| `tracking.py` |  | `TrackCreate`, `TrackUpdate`, `ByteTrackRunRequest`, `HomographyPropagateRequest`, `MergeTracksRequest`, `GuidedTrackingRequest`, `AssignTrackRequest`, `list_tracks`, `create_track`, `assign_annotation_track`, `update_track`, `delete_track` (+18) |

### backend/models/sam3/sam3

| File | Description | Exports |
|---|---|---|
| `logger.py` |  | `ColoredFormatter`, `get_logger` |
| `model_builder.py` |  | `build_tracker`, `build_sam3_image_model`, `download_ckpt_from_hf`, `build_sam3_video_model`, `build_sam3_video_predictor`, `build_sam3_multiplex_video_model`, `build_sam3_multiplex_video_predictor`, `build_sam3_predictor` |
| `visualization_utils.py` |  | `generate_colors`, `show_img_tensor`, `draw_box_on_image`, `plot_bbox`, `plot_mask`, `normalize_bbox`, `visualize_frame_output`, `visualize_formatted_frame_output`, `render_masklet_frame`, `save_masklet_video`, `save_masklet_image`, `prepare_masks_for_visualization` (+16) |

### backend/models/sam3/sam3/agent

| File | Description | Exports |
|---|---|---|
| `agent_core.py` |  | `save_debug_messages`, `cleanup_debug_files`, `count_images`, `agent_inference` |
| `client_llm.py` |  | `get_image_base64_and_mime`, `send_generate_request`, `send_direct_request` |
| `client_sam3.py` |  | `sam3_inference`, `call_sam_service` |
| `inference.py` |  | `run_single_image_inference` |
| `viz.py` |  | `visualize` |

### backend/models/sam3/sam3/agent/helpers

| File | Description | Exports |
|---|---|---|
| `boxes.py` |  | `BoxMode`, `Boxes`, `pairwise_intersection`, `pairwise_iou`, `pairwise_ioa`, `pairwise_point_box_distance`, `matched_pairwise_iou` |
| `color_map.py` | An awesome colormap for really neat visualizations. | `colormap`, `random_color`, `random_colors` |
| `keypoints.py` |  | `Keypoints`, `heatmaps_to_keypoints` |
| `mask_overlap_removal.py` |  | `mask_intersection`, `mask_iom`, `remove_overlapping_masks` |
| `masks.py` |  | `polygon_area`, `polygons_to_bitmask`, `rasterize_polygons_within_box`, `BitMasks`, `PolygonMasks`, `ROIMasks` |
| `memory.py` |  | `retry_if_cuda_oom` |
| `rle.py` | Some utilities for RLE encoding that doesn't require downloading the masks to the cpu | `rle_encode`, `robust_rle_encode`, `ann_to_rle` |
| `roi_align.py` |  | `ROIAlign` |
| `rotated_boxes.py` |  | `pairwise_iou_rotated`, `RotatedBoxes`, `pairwise_iou` |
| `som_utils.py` |  | `rgb_to_hex`, `Color`, `ColorPalette`, `draw_box`, `draw_text`, `draw_mask` |
| `visualizer.py` |  | `ColorMode`, `GenericMask`, `VisImage`, `Visualizer` |
| `zoom_in.py` |  | `render_zoom_in` |

### backend/models/sam3/sam3/eval

| File | Description | Exports |
|---|---|---|
| `cgf1_eval.py` |  | `Metric`, `COCOCustom`, `CGF1Eval`, `CGF1Evaluator` |
| `coco_eval.py` | COCO evaluator that works in distributed mode. | `CocoEvaluator`, `convert_to_xywh`, `merge`, `create_common_coco_eval`, `segmentation_prepare`, `evaluate`, `loadRes`, `summarize`, `accumulate` |
| `coco_eval_offline.py` | This evaluator is meant for regular COCO mAP evaluation, for example on the COCO val set. | `convert_to_xywh`, `HeapElement`, `COCOevalCustom`, `CocoEvaluatorOfflineWithPredFileEvaluators` |
| `coco_reindex.py` | Self-contained COCO JSON re-indexing function that creates temporary files. | `reindex_coco_to_temp`, `test_reindex_function` |
| `coco_writer.py` | COCO prediction dumper for distributed training. | `HeapElement`, `PredictionDumper` |
| `conversion_util.py` |  | `convert_ytbvis_to_cocovid_gt`, `convert_ytbvis_to_cocovid_pred` |
| `demo_eval.py` | This evaluator is based upon COCO evaluation, but evaluates the model in a "demo" setting. | `DemoEval`, `DemoEvaluator` |
| `postprocessors.py` | Postprocessors class to transform MDETR output according to the downstream task | `PostProcessNullOp`, `PostProcessImage`, `PostProcessAPIVideo`, `PostProcessTracking`, `PostProcessCounting` |
| `saco_veval_eval.py` |  | `VEvalEvaluator`, `run_main_all`, `main_all`, `main_one`, `main` |
| `saco_veval_evaluators.py` |  | `BasePredFileEvaluator`, `YTVISPredFileEvaluator`, `VideoPhraseApEvaluator`, `VideoCGF1Evaluator`, `VideoTetaEvaluator`, `VideoPhraseHotaEvaluator`, `VideoClassBasedHotaEvaluator`, `remap_video_category_pairs_to_unique_video_ids`, `remap_gt_dt_class_agnostic` |
| `ytvis_coco_wrapper.py` |  | `YTVIS` |
| `ytvis_eval.py` |  | `YTVISevalMixin`, `YTVISeval`, `VideoDemoF1Eval`, `YTVISResultsWriter` |

### backend/models/sam3/sam3/eval/hota_eval_toolkit

| File | Description | Exports |
|---|---|---|
| `run_ytvis_eval.py` | run_youtube_vis.py | `run_ytvis_eval` |

### backend/models/sam3/sam3/eval/hota_eval_toolkit/trackeval

| File | Description | Exports |
|---|---|---|
| `_timing.py` |  | `time` |
| `eval.py` |  | `Evaluator`, `eval_sequence` |
| `utils.py` |  | `init_config`, `update_config`, `get_code_path`, `validate_metrics_list`, `write_summary_results`, `write_detailed_results`, `load_detail`, `TrackEvalException` |

### backend/models/sam3/sam3/eval/hota_eval_toolkit/trackeval/datasets

| File | Description | Exports |
|---|---|---|
| `_base_dataset.py` |  |  |
| `tao_ow.py` |  | `TAO_OW` |
| `youtube_vis.py` |  | `YouTubeVIS` |

### backend/models/sam3/sam3/eval/hota_eval_toolkit/trackeval/metrics

| File | Description | Exports |
|---|---|---|
| `_base_metric.py` |  |  |
| `count.py` |  | `Count` |
| `hota.py` |  | `HOTA` |

### backend/models/sam3/sam3/eval/teta_eval_toolkit

| File | Description | Exports |
|---|---|---|
| `_timing.py` |  | `time` |
| `config.py` | Config. | `parse_configs`, `get_default_eval_config`, `get_default_dataset_config`, `init_config`, `update_config`, `get_code_path` |
| `eval.py` |  | `Evaluator`, `eval_sequence` |
| `utils.py` |  | `validate_metrics_list`, `get_track_id_str`, `TrackEvalException` |

### backend/models/sam3/sam3/eval/teta_eval_toolkit/datasets

| File | Description | Exports |
|---|---|---|
| `__init__.py` | Datasets. |  |
| `_base_dataset.py` |  |  |
| `coco.py` | COCO Dataset. | `COCO` |
| `tao.py` | TAO Dataset. | `TAO` |

### backend/models/sam3/sam3/eval/teta_eval_toolkit/metrics

| File | Description | Exports |
|---|---|---|
| `_base_metric.py` |  |  |
| `teta.py` | Track Every Thing Accuracy metric. | `TETA` |

### backend/models/sam3/sam3/model

| File | Description | Exports |
|---|---|---|
| `act_ckpt_utils.py` |  | `activation_ckpt_wrapper`, `clone_output_wrapper` |
| `box_ops.py` | Utilities for bounding box manipulation and GIoU. | `box_cxcywh_to_xyxy`, `box_cxcywh_to_xywh`, `box_xywh_to_xyxy`, `box_xywh_to_cxcywh`, `box_xyxy_to_xywh`, `box_xyxy_to_cxcywh`, `box_area`, `masks_to_boxes`, `box_iou`, `generalized_box_iou`, `fast_diag_generalized_box_iou`, `fast_diag_box_iou` (+1) |
| `data_misc.py` | Misc functions, including distributed helpers. | `NestedTensor`, `interpolate`, `BatchedPointer`, `FindStage`, `BatchedFindTarget`, `BatchedInferenceMetadata`, `BatchedDatapoint`, `convert_my_tensors` |
| `decoder.py` | Transformer decoder. | `TransformerDecoderLayer`, `TransformerDecoder`, `TransformerEncoderCrossAttention`, `TransformerDecoderLayerv1`, `TransformerDecoderLayerv2`, `functional_attention`, `SimpleRoPEAttention`, `DecoupledTransformerDecoderLayerv2`, `TransformerEncoderDecoupledCrossAttention` |
| `edt.py` | Triton kernel for euclidean distance transform (EDT) | `edt_kernel`, `edt_triton` |
| `encoder.py` |  | `TransformerEncoderLayer`, `TransformerEncoder`, `TransformerEncoderFusion`, `pool_text_feat` |
| `geometry_encoders.py` |  | `is_right_padded`, `concat_padded_sequences`, `Prompt`, `MaskEncoder`, `FusedMaskEncoder`, `SequenceGeometryEncoder` |
| `io_utils.py` |  | `load_resource_as_video_frames`, `load_image_as_single_frame_video`, `load_video_frames`, `load_video_frames_from_image_folder`, `load_video_frames_from_video_file`, `load_video_frames_from_video_file_using_cv2`, `load_dummy_video`, `AsyncImageFrameLoader`, `TorchCodecDecoder`, `FIFOLock`, `AsyncVideoFileLoaderWithTorchCodec` |
| `maskformer_segmentation.py` |  | `LinearPresenceHead`, `MaskPredictor`, `SegmentationHead`, `PixelDecoder`, `UniversalSegmentationHead` |
| `memory.py` |  | `SimpleMaskDownSampler`, `CXBlock`, `SimpleFuser`, `SimpleMaskEncoder` |
| `model_misc.py` | Various utility models | `inverse_sigmoid`, `get_sdpa_settings`, `AttentionType`, `multi_head_attention_forward`, `MultiheadAttention`, `DotProductScoring`, `LayerScale`, `LayerNorm2d`, `TransformerWrapper`, `MLP`, `get_clones`, `get_clones_seq` (+5) |
| `multiplex_mask_decoder.py` |  | `MultiplexMaskDecoder`, `MLP` |
| `multiplex_utils.py` |  | `MultiplexState`, `MultiplexController` |
| `necks.py` | Necks are the interface between a vision backbone and the rest of the detection model | `Sam3DualViTDetNeck`, `Sam3TriViTDetNeck` |
| `position_encoding.py` |  | `PositionEmbeddingSine` |
| `sam1_task_predictor.py` |  | `SAM3InteractiveImagePredictor` |
| `sam3_base_predictor.py` | Base predictor class shared by SAM3 and SAM3.1 (multiplex) video predictors. | `Sam3BasePredictor` |
| `sam3_image.py` |  | `Sam3Image`, `Sam3ImageOnVideoMultiGPU` |
| `sam3_image_processor.py` |  | `Sam3Processor` |
| `sam3_multiplex_base.py` |  | `Sam3MultiplexTrackerPredictor`, `Sam3MultiplexBase`, `Sam3MultiplexPredictorWrapper` |
| `sam3_multiplex_detector.py` |  | `Sam3MultiplexImageBase`, `Sam3MultiplexDetector` |
| `sam3_multiplex_detector_utils.py` |  | `nms_masks`, `generic_nms_cpu`, `generic_nms_mask`, `perf_mask_iou`, `perf_mask_iom` |
| `sam3_multiplex_tracking.py` |  | `recursive_to`, `Sam3MultiplexTracking`, `Sam3MultiplexTrackingProd`, `Sam3MultiplexTrackingWithInteractivity` |
| `sam3_multiplex_video_predictor.py` | Sam3MultiplexVideoPredictor - user-facing entry point for SAM 3.1 multiplex. | `Sam3MultiplexVideoPredictor` |
| `sam3_tracker_base.py` |  | `Sam3TrackerBase`, `concat_points` |
| `sam3_tracker_utils.py` |  | `sample_box_points`, `mask_to_box`, `sample_random_points_from_errors`, `sample_one_point_from_error_center`, `sample_one_point_from_error_center_slow`, `get_next_point`, `select_closest_cond_frames`, `get_1d_sine_pe`, `get_best_gt_match_from_multimasks`, `fill_holes_in_mask_scores` |
| `sam3_tracking_predictor.py` |  | `Sam3TrackerPredictor` |
| `sam3_video_base.py` |  | `MaskletConfirmationStatus`, `RealizedAssociateDetTrkresult`, `realize_adt_result`, `LazyAssociateDetTrkResult`, `Sam3VideoBase` |
| `sam3_video_inference.py` |  | `Sam3VideoInference`, `Sam3VideoInferenceWithInstanceInteractivity`, `is_image_type` |
| `sam3_video_predictor.py` |  | `Sam3VideoPredictor`, `Sam3VideoPredictorMultiGPU` |
| `text_encoder_ve.py` |  | `ResidualAttentionBlock`, `Transformer`, `text_global_pool`, `TextTransformer`, `VETextEncoder` |
| `tokenizer_ve.py` | Text Tokenizer. | `bytes_to_unicode`, `get_pairs`, `basic_clean`, `whitespace_clean`, `get_clean_fn`, `canonicalize_text`, `SimpleTokenizer` |
| `video_tracking_multiplex.py` |  | `SAMOutput`, `StageOutput`, `VideoTrackingMultiplex`, `concat_points`, `VideoTrackingDynamicMultiplex` |
| `video_tracking_multiplex_demo.py` |  | `VideoTrackingMultiplexDemo`, `Sam3VideoTrackingMultiplexDemo` |
| `vitdet.py` | ViTDet backbone adapted from Detectron2. | `Mlp`, `init_t_xy`, `compute_axial_cis`, `reshape_for_broadcast`, `apply_rotary_enc`, `window_partition`, `window_unpartition`, `get_rel_pos`, `get_abs_pos`, `concat_rel_pos`, `PatchEmbed`, `Attention` (+2) |
| `vl_combiner.py` | Provides utility to combine a vision backbone with a language backbone. | `SAM3VLBackbone`, `SAM3VLBackboneTri`, `VisionOnly`, `TriHeadVisionOnly` |

### backend/models/sam3/sam3/model/utils

| File | Description | Exports |
|---|---|---|
| `misc.py` |  | `copy_data_to_device` |
| `sam1_utils.py` |  | `SAM2Transforms` |
| `sam2_utils.py` |  | `AsyncVideoFrameLoader`, `load_video_frames`, `load_video_frames_from_jpg_images`, `load_video_frames_from_video_file` |

### backend/models/sam3/sam3/perflib

| File | Description | Exports |
|---|---|---|
| `associate_det_trk.py` |  | `associate_det_trk` |
| `compile.py` |  | `recursive_fn_factory`, `clone_output_wrapper`, `compile_wrapper`, `shape_logging_wrapper` |
| `connected_components.py` |  | `connected_components_cpu_single`, `connected_components_cpu`, `connected_components` |
| `fa3.py` |  | `flash_attn_func_op`, `flash_attn_func` |
| `fused.py` |  | `addmm_act` |
| `iou.py` |  | `pairwise_iou`, `pairwise_iom` |
| `masks_ops.py` |  | `masks_to_boxes`, `mask_iou` |
| `nms.py` |  | `nms_masks`, `generic_nms`, `generic_nms_cpu` |

### backend/models/sam3/sam3/perflib/triton

| File | Description | Exports |
|---|---|---|
| `connected_components.py` |  | `tl_any`, `find`, `union`, `connected_components_triton` |
| `nms.py` |  | `nms_triton` |

### backend/models/sam3/sam3/sam

| File | Description | Exports |
|---|---|---|
| `common.py` |  | `MLPBlock`, `LayerNorm2d` |
| `mask_decoder.py` |  | `MaskDecoder`, `MLP` |
| `prompt_encoder.py` |  | `PromptEncoder`, `PositionEmbeddingRandom` |
| `rope.py` | Adapted from: | `init_t_xy`, `compute_axial_cis`, `reshape_for_broadcast`, `apply_rotary_enc`, `complex_mult`, `apply_rotary_enc_real`, `broadcat`, `rotate_half`, `VisionRotaryEmbeddingVE` |
| `transformer.py` |  | `TwoWayTransformer`, `TwoWayAttentionBlock`, `Attention`, `RoPEAttention` |

### backend/models/sam3/sam3/train

| File | Description | Exports |
|---|---|---|
| `masks_ops.py` | Utilities for masks manipulation | `instance_masks_to_semantic_masks`, `mask_intersection_vectorized`, `mask_intersection`, `mask_iom`, `compute_boundary`, `dilation`, `compute_F_measure`, `rle_encode`, `robust_rle_encode`, `ann_to_rle` |
| `matcher.py` | Modules to compute the matching cost and solve the corresponding LSAP. | `HungarianMatcher`, `BinaryHungarianMatcher`, `BinaryFocalHungarianMatcher`, `BinaryHungarianMatcherV2`, `BinaryOneToManyMatcher` |
| `nms_helper.py` |  | `is_zero_box`, `convert_bbox_format`, `process_track_level_nms`, `process_frame_level_nms`, `compute_track_iou_matrix`, `apply_track_nms`, `compute_frame_ious`, `apply_frame_nms` |
| `train.py` |  | `SlurmEvent`, `handle_custom_resolving`, `single_proc_run`, `single_node_runner`, `format_exception`, `SubmititRunner`, `add_pythonpath_to_sys_path`, `main` |
| `trainer.py` |  | `unwrap_ddp_if_wrapped`, `OptimAMPConf`, `OptimConf`, `DistributedConf`, `CudaConf`, `CheckpointConf`, `LoggingConf`, `Trainer`, `print_model_summary`, `get_human_readable_count` |

### backend/models/sam3/sam3/train/data

| File | Description | Exports |
|---|---|---|
| `coco_json_loaders.py` |  | `convert_boxlist_to_normalized_tensor`, `load_coco_and_group_by_image`, `ann_to_rle`, `COCO_FROM_JSON`, `SAM3_EVAL_API_FROM_JSON_NP`, `SAM3_VEVAL_API_FROM_JSON_NP` |
| `collator.py` |  | `convert_my_tensors`, `packed_to_padded_naive`, `pad_tensor_list_to_longest`, `collate_fn_api_with_chunking`, `collate_fn_api` |
| `sam3_image_dataset.py` | Dataset class for modulated detection | `InferenceMetadata`, `FindQuery`, `FindQueryLoaded`, `Object`, `Image`, `Datapoint`, `CustomCocoDetectionAPI`, `Sam3ImageDataset` |
| `sam3_video_dataset.py` |  | `VideoGroundingDataset` |
| `torch_dataset.py` |  | `TorchDataset` |

### backend/models/sam3/sam3/train/loss

| File | Description | Exports |
|---|---|---|
| `loss_fns.py` |  | `instance_masks_to_semantic_masks`, `accuracy`, `dice_loss`, `sigmoid_focal_loss`, `iou_loss`, `LossWithWeights`, `IABCEMdetr`, `Boxes`, `Masks`, `segment_miou`, `SemanticSegCriterion`, `Det2TrkAssoc` (+1) |
| `mask_sampling.py` |  | `point_sample`, `get_uncertain_point_coords_with_randomness`, `calculate_uncertainty` |
| `sam3_loss.py` |  | `DummyLoss`, `Sam3LossWrapper` |
| `sigmoid_focal_loss.py` | Triton kernel for faster and memory efficient sigmoid focal loss | `sigmoid_focal_loss_fwd_kernel`, `sigmoid_focal_loss_fwd_kernel_reduce`, `sigmoid_focal_loss_bwd_kernel`, `sigmoid_focal_loss_bwd_kernel_reduce`, `SigmoidFocalLoss`, `SigmoidFocalLossReduced` |

### backend/models/sam3/sam3/train/optim

| File | Description | Exports |
|---|---|---|
| `optimizer.py` |  | `Optimizer`, `set_default_parameters`, `name_constraints_to_parameters`, `map_scheduler_cfgs_to_param_groups`, `validate_param_group_params`, `unix_module_cls_pattern_to_parameter_names`, `unix_param_pattern_to_parameter_names`, `get_module_cls_to_param_names`, `construct_optimizer`, `get_full_parameter_name`, `GradientClipper`, `ValueScaler` (+2) |
| `schedulers.py` |  | `InverseSquareRootParamScheduler` |

### backend/models/sam3/sam3/train/transforms

| File | Description | Exports |
|---|---|---|
| `basic.py` | Transforms and data augmentation for both image + bbox. | `crop`, `hflip`, `resize`, `pad`, `RandomCrop`, `RandomSizeCrop`, `CenterCrop`, `RandomHorizontalFlip`, `RandomResize`, `RandomPad`, `PadToSize`, `Identity` (+8) |
| `basic_for_api.py` | Transforms and data augmentation for both image + bbox. | `crop`, `hflip`, `get_size_with_aspect_ratio`, `resize`, `pad`, `RandomSizeCropAPI`, `CenterCropAPI`, `RandomHorizontalFlip`, `RandomResizeAPI`, `ScheduledRandomResizeAPI`, `RandomPadAPI`, `PadToSizeAPI` (+16) |
| `filter_query_transforms.py` |  | `FilterDataPointQueries`, `FilterQueryWithText`, `KeepMaxNumFindQueries`, `KeepMaxNumFindQueriesVideo`, `KeepSemanticFindQueriesOnly`, `KeepUnaryFindQueriesOnly`, `FilterZeroBoxQueries`, `FilterFindQueriesWithTooManyOut`, `FilterEmptyTargets`, `FilterNonExhaustiveFindQueries`, `FilterInvalidGeometricQueries`, `FlexibleFilterFindGetQueries` (+5) |
| `point_sampling.py` |  | `sample_points_from_rle`, `sample_points_from_mask`, `uniform_positive_sample`, `center_positive_sample`, `uniform_sample_from_box`, `rescale_box_xyxy`, `noise_box`, `RandomGeometricInputsAPI`, `RandomizeInputBbox` |
| `segmentation.py` |  | `InstanceToSemantic`, `RecomputeBoxesFromMasks`, `DecodeRle` |

### backend/models/sam3/sam3/train/utils

| File | Description | Exports |
|---|---|---|
| `checkpoint_utils.py` |  | `unix_pattern_to_parameter_names`, `filter_params_matching_unix_pattern`, `exclude_params_matching_unix_pattern`, `assert_skipped_parameters_are_frozen`, `with_check_parameter_frozen`, `CkptExcludeKernel`, `load_checkpoint`, `get_state_dict`, `load_checkpoint_and_apply_kernels`, `check_load_state_dict_errors`, `load_state_dict_into_model` |
| `distributed.py` |  | `is_main_process`, `all_gather_via_filesys`, `all_gather`, `convert_to_distributed_tensor`, `convert_to_normal_tensor`, `is_distributed_training_run`, `is_primary`, `all_reduce_mean`, `all_reduce_sum`, `all_reduce_min`, `all_reduce_max`, `all_reduce_op` (+20) |
| `logger.py` |  | `make_tensorboard_logger`, `TensorBoardWriterWrapper`, `TensorBoardLogger`, `Logger`, `setup_logging`, `shutdown_logging` |
| `train_utils.py` |  | `multiply_all`, `collect_dict_keys`, `Phase`, `register_omegaconf_resolvers`, `setup_distributed_backend`, `get_machine_local_and_dist_rank`, `print_cfg`, `set_seeds`, `makedir`, `is_dist_avail_and_initialized`, `get_amp_type`, `log_env_variables` (+6) |

### backend/models/sam3/scripts

| File | Description | Exports |
|---|---|---|
| `extract_odinw_results.py` | This script summarizes odinw results | `parse_args`, `main` |
| `extract_roboflow_vl100_results.py` | Script to extract and analyze training results from Roboflow VL100 experiments. | `load_jsonl_last_row`, `find_config_files`, `extract_config_parameters`, `calculate_average`, `extract_category_results`, `analyze_experiment_results`, `print_results_table`, `main` |
| `measure_speed.py` | SAM3 Speed Test - supports both SAM3 and SAM3.1 (multiplex). | `max_memory_allocated`, `synthesize_video_data`, `profiler_runner`, `main_loop`, `run_test` |
| `qualitative_test.py` | SAM3 Qualitative Test - supports both SAM3 and SAM3.1. | `extract_frames`, `synthesize_video`, `load_frame`, `render_overlay`, `save_overlay`, `collect_propagation`, `main` |

### backend/models/sam3/scripts/eval

| File | Description | Exports |
|---|---|---|
| `standalone_cgf1.py` | Simple script to run the CGF1 evaluator given a prediction file and GT file(s). | `main` |

### backend/models/sam3/scripts/eval/gold

| File | Description | Exports |
|---|---|---|
| `eval_sam3.py` | Script to run the evaluator offline given the GTs for SAC-Gold test set and SAM3 model prediction files. | `main` |

### backend/models/sam3/scripts/eval/silver

| File | Description | Exports |
|---|---|---|
| `download_fathomnet.py` |  | `download_imgs`, `main` |
| `download_inaturalist.py` |  | `download_archive`, `extract_archive`, `copy_images`, `main` |
| `download_preprocess_nga.py` |  | `download_metadata`, `download_url`, `download_item`, `remove_non_compliant_image`, `reshape_image`, `main` |
| `download_videos.py` |  | `construct_gcs_path`, `download_video`, `download_youtube_video`, `download_youtube`, `download_droid`, `download_ego4d`, `download_sav`, `main` |
| `extract_frames.py` | This file extracts the frames for the frame datasets in SA-CO/Gold and Silver. | `extract_frame`, `process_image`, `main` |
| `preprocess_silver_geode_bdd100k_food_rec.py` |  | `main` |
| `utils.py` |  | `load_yaml`, `load_json`, `save_json`, `run_command`, `is_valid_image`, `get_frame_from_video`, `update_annotations`, `get_filename_size_map`, `get_filenames`, `get_image_ids`, `setup`, `copy_file` |

### backend/models/sam3/scripts/eval/veval

| File | Description | Exports |
|---|---|---|
| `saco_yt1b_annot_update.py` |  | `get_available_saco_yt1b_ids`, `update_yt1b_annot_per_field`, `update_yt1b_annot`, `main` |
| `saco_yt1b_downloader.py` |  | `download_and_extract_frames`, `main` |
| `saco_yt1b_frame_prep_util.py` |  | `YtVideoPrep`, `main` |

### backend/models/xfeat

| File | Description | Exports |
|---|---|---|
| `hubconf.py` |  | `XFeat` |
| `minimal_example.py` | "XFeat: Accelerated Features for Lightweight Image Matching, CVPR 2024." |  |
| `realtime_demo.py` | "XFeat: Accelerated Features for Lightweight Image Matching, CVPR 2024." | `argparser`, `FrameGrabber`, `CVWrapper`, `Method`, `init_method`, `MatchingDemo` |

### backend/models/xfeat/modules

| File | Description | Exports |
|---|---|---|
| `__init__.py` | "XFeat: Accelerated Features for Lightweight Image Matching, CVPR 2024." |  |
| `interpolator.py` | "XFeat: Accelerated Features for Lightweight Image Matching, CVPR 2024." | `InterpolateSparse2d` |
| `lighterglue.py` |  | `LighterGlue` |
| `model.py` | "XFeat: Accelerated Features for Lightweight Image Matching, CVPR 2024." | `BasicLayer`, `XFeatModel` |
| `xfeat.py` | "XFeat: Accelerated Features for Lightweight Image Matching, CVPR 2024." | `XFeat` |

### backend/models/xfeat/modules/dataset

| File | Description | Exports |
|---|---|---|
| `__init__.py` | "XFeat: Accelerated Features for Lightweight Image Matching, CVPR 2024." |  |
| `augmentation.py` | "XFeat: Accelerated Features for Lightweight Image Matching, CVPR 2024." | `generateRandomTPS`, `generateRandomHomography`, `AugmentationPipe` |
| `download.py` | "XFeat: Accelerated Features for Lightweight Image Matching, CVPR 2024." | `download_megadepth_1500`, `download_scannet_1500`, `download_megadepth`, `main` |

### backend/models/xfeat/modules/dataset/megadepth

| File | Description | Exports |
|---|---|---|
| `__init__.py` | "XFeat: Accelerated Features for Lightweight Image Matching, CVPR 2024." |  |
| `megadepth.py` | "XFeat: Accelerated Features for Lightweight Image Matching, CVPR 2024." | `MegaDepthDataset` |
| `megadepth_warper.py` | "XFeat: Accelerated Features for Lightweight Image Matching, CVPR 2024." | `warp_kpts`, `spvs_coarse`, `get_correspondences` |
| `utils.py` | "XFeat: Accelerated Features for Lightweight Image Matching, CVPR 2024." | `load_array_from_s3`, `imread_gray`, `get_resized_wh`, `get_divisible_wh`, `pad_bottom_right`, `fix_path_from_d2net`, `read_megadepth_gray`, `read_megadepth_depth` |

### backend/models/xfeat/modules/eval

| File | Description | Exports |
|---|---|---|
| `__init__.py` | "XFeat: Accelerated Features for Lightweight Image Matching, CVPR 2024." |  |
| `megadepth1500.py` | "XFeat: Accelerated Features for Lightweight Image Matching, CVPR 2024." | `MegaDepth1500`, `relative_pose_error`, `intrinsics_to_camera`, `estimate_pose_poselib`, `tensor2bgr`, `compute_pose_error`, `error_auc`, `compute_maa`, `run_pose_benchmark`, `parse_args` |
| `scannet1500.py` | "XFeat: Accelerated Features for Lightweight Image Matching, CVPR 2024." | `intrinsics_to_camera`, `angle_error_vec`, `angle_error_mat`, `compute_pose_error`, `estimate_pose`, `estimate_pose_parallel`, `pose_auc`, `pose_accuracy`, `get_relative_transform`, `Scannet1500`, `get_xfeat`, `get_xfeat_star` (+3) |

### backend/models/xfeat/modules/training

| File | Description | Exports |
|---|---|---|
| `__init__.py` | "XFeat: Accelerated Features for Lightweight Image Matching, CVPR 2024." |  |
| `losses.py` |  | `dual_softmax_loss`, `smooth_l1_loss`, `fine_loss`, `alike_distill_loss`, `keypoint_position_loss`, `coordinate_classification_loss`, `keypoint_loss`, `hard_triplet_loss` |
| `train.py` | "XFeat: Accelerated Features for Lightweight Image Matching, CVPR 2024." | `parse_arguments`, `Trainer` |
| `utils.py` |  | `make_batch`, `plot_corrs`, `get_corresponding_pts`, `crop_patches`, `subpix_softmax2d`, `check_accuracy`, `get_nb_trainable_params` |

### backend/models/xfeat/third_party

| File | Description | Exports |
|---|---|---|
| `__init__.py` | "XFeat: Accelerated Features for Lightweight Image Matching, CVPR 2024." |  |
| `alike_wrapper.py` | "XFeat: Accelerated Features for Lightweight Image Matching, CVPR 2024." | `extract_alike_kpts`, `detectAndCompute`, `match_alike`, `create_xy`, `match_alike_customkp` |

### backend/services

| File | Description | Exports |
|---|---|---|
| `annotation_import_service.py` |  | `parse_ver`, `parse_yolo_folder`, `detect_format` |
| `convert_service.py` |  | `format specialise_to_png_folder`, `png_folder_to_format specialise`, `ver_to_yolo`, `yolo_to_ver` |
| `dataset_service.py` |  | `natural_sort_key`, `FrameExtractionProgress`, `DatasetService` |
| `format_registry.py` | Discovery of optional, self-contained sequence format adapters. | `available_formats`, `get_format`, `get_format_for_filename`, `invoke_for_filename`, `supports_filename`, `preferred_extension` |
| `grounding_service.py` |  | `GroundingService`, `get_grounding_service` |
| `homography_service.py` |  | `HomographyService` |
| `interpolation_service.py` |  | `lerp`, `InterpolationService` |
| `monitoring_service.py` |  | `monitoring_dir`, `events_file`, `record`, `record_edit`, `record_delete`, `record_bulk_delete`, `record_run`, `read_events`, `snapshot_from_db`, `aggregate_workspace`, `group_by_user`, `group_by_root` (+1) |
| `sam3_service.py` |  | `SAM3Service`, `get_sam3_service` |
| `sam_service.py` |  | `MaskResult`, `VideoPropagationResult`, `SAMService` |
| `settings_service.py` |  | `SettingsService` |
| `task_registry.py` |  | `create_task`, `append_log`, `format_progress_bar`, `append_progress`, `update_task`, `drain_live_frames`, `set_task_result`, `get_task`, `get_task_logs`, `delete_task`, `request_stop`, `request_pause` (+3) |
| `tracker_service.py` |  | `Detection`, `TrackedObject`, `KalmanBoxTracker`, `compute_iou_matrix`, `TrackerService` |

### backend/tasks

| File | Description | Exports |
|---|---|---|
| `celery_app.py` |  |  |
| `export_tasks.py` |  | `export_yolo_task` |
| `sam_tasks.py` |  | `auto_segment_image_task`, `auto_segment_all_frames_task` |

### backend/utils

| File | Description | Exports |
|---|---|---|
| `color_utils.py` |  | `get_class_color`, `get_track_color`, `hex_to_rgb`, `rgb_to_hex`, `generate_distinct_colors` |
| `image_utils.py` |  | `generate_thumbnail`, `mask_to_bbox_yolo`, `mask_to_polygon`, `image_to_base64`, `apply_lut`, `to_8bit_3sigma`, `lut_signature`, `purge_stale_lut_caches`, `compute_histogram`, `load_image_bgr_8bit`, `load_image_rgb`, `is_high_bitdepth_image` (+2) |
| `native_share.py` |  | `to_native_share_path`, `from_native_share_path` |
| `format specialise.py` | Adaptateur format specialise optionnel de l'application Annotation. | `OtiHeader`, `is_available`, `write_format specialise`, `load_format specialise` |
| `yolo_utils.py` |  | `write_yolo_label_file`, `write_yolo_segmentation_label_file`, `read_yolo_label_file`, `write_data_yaml`, `validate_yolo_coordinates`, `compute_iou` |

### frontend/src

| File | Description | Exports |
|---|---|---|
| `App.tsx` | Entrée principale de l'application React. |  |
| `main.tsx` |  |  |

### frontend/src/components

| File | Description | Exports |
|---|---|---|
| `UserBadge.tsx` |  | `UserBadge` |

### frontend/src/components/canvas

| File | Description | Exports |
|---|---|---|
| `AnnotationCanvas.tsx` | Canvas principal d'annotation basé sur Konva.js. | `AnnotationCanvas` |
| `BBoxShape.tsx` | Composant Konva.js pour une boîte englobante annotée. | `BBoxShape` |

### frontend/src/components/common

| File | Description | Exports |
|---|---|---|
| `ConfirmDialog.tsx` | Dialogue de confirmation modal générique. | `ConfirmDialog` |
| `LanguageToggle.tsx` |  | `LanguageToggle` |
| `LoadingSpinner.tsx` | Spinner de chargement générique. | `LoadingSpinner` |

### frontend/src/components/docs

| File | Description | Exports |
|---|---|---|
| `markdown.ts` | Rendu markdown -> HTML des pages de docs/ et liens vers la page d'aide. | `docLink`, `renderMarkdown` |
| `MarkdownDoc.tsx` | Affiche un corps markdown de docs/ (sans frontmatter) avec les ancres | `MarkdownDoc` |

### frontend/src/components/help

| File | Description | Exports |
|---|---|---|
| `annotationTourSteps.ts` | Script du tutoriel interactif d'AnnotationApp (moteur generique dans | `TUTORIAL_KEY`, `TEMPLATE_PROJECT_NAME`, `TEMPLATE2_PROJECT_NAME`, `buildAnnotationTourSteps` |
| `helpContent.ts` | Source unique de vérité pour l'aide (Aide sidebar + popup Help). | `SHORTCUT_GROUPS`, `TOOL_MODES`, `TRACKING_MODES`, `FEATURES`, `MODELS`, `VIDEO_STEPS` |

### frontend/src/components/modals

| File | Description | Exports |
|---|---|---|
| `CreateProjectModal.tsx` | Modal de création d'un nouveau projet (image ou vidéo). | `CreateProjectModal` |
| `ExportModal.tsx` | Modal d'export du dataset au format YOLO. | `ExportModal` |
| `FileBrowserModal.tsx` | Navigateur de fichiers serveur - permet de choisir un dossier | `FileBrowserModal` |
| `HelpModal.tsx` | Popup d'aide (comme SettingsModal) : raccourcis, modes, fonctions, | `HelpModal` |
| `ImportModal.tsx` | Panneau d'import UNIFIÉ multi-séquences. | `ImportModal` |
| `SettingsModal.tsx` | Panneau de paramètres utilisateur : interface, import, algos, export. | `SettingsModal` |
| `TaskProgressModal.tsx` | Modal générique d'affichage de progression d'une tâche async. | `TaskProgressModal` |

### frontend/src/components/panels

| File | Description | Exports |
|---|---|---|
| `FramesPanel.tsx` | Panneau droit : liste des frames avec navigation rapide, | `FramesPanel` |
| `LutPanel.tsx` | LutPanel - outil LUT d'affichage (remap 16/8 bits). | `LutPanel` |

### frontend/src/components/sidebar

| File | Description | Exports |
|---|---|---|
| `AnnotationList.tsx` | Liste scrollable des annotations de la frame courante. | `AnnotationList` |
| `GlobalAnnotationsPanel.tsx` | Résumé global multi-frames des annotations du projet. | `GlobalAnnotationsPanel` |
| `HelpPanel.tsx` | Panneau d'aide (sidebar) : raccourcis, modes, fonctions, modèles, workflow. | `HelpPanel` |
| `LabelManager.tsx` | Gestionnaire des classes d'objets dans la sidebar. | `classFullLabel`, `LabelManager` |
| `RightPanel.tsx` | Panneau DROIT (au-dessus de la zone canvas) : Classes, Annots, Aide. | `RightPanel` |
| `Sidebar.tsx` | Panneau GAUCHE d'annotation - mode Séquence Image (video) uniquement. | `Sidebar` |
| `TrackPanel.tsx` | Panneau de tracking sequence. | `TrackPanel` |
| `XFeatDebugPanel.tsx` | Panneau de debug XFeat / SIFT : visualisation des correspondances | `XFeatDebugPanel` |

### frontend/src/components/timeline

| File | Description | Exports |
|---|---|---|
| `Timeline.tsx` | Timeline virtualisee SANS vignettes : cellules compactes | `Timeline` |
| `TrackLane.tsx` | Une ligne de track dans la timeline : | `TrackLane` |

### frontend/src/components/tour

| File | Description | Exports |
|---|---|---|
| `domUtils.ts` | Outils DOM pour ecrire des etapes qui pilotent reellement l'UI | `sleep`, `waitFor`, `waitForElement`, `clickWhenReady`, `setReactInputValue`, `typeWhenReady`, `isDisabled`, `clickEnabledWhenReady` |
| `index.ts` | Moteur de tour guide generique -- 100% portable (React seul, aucune |  |
| `positioning.ts` | Calcul du rectangle spotlight et du placement du tooltip. | `computeSpotlightRect`, `computeTooltipPlacement` |
| `TourContext.ts` | Contexte + hook useTour, separes de TourProvider.tsx (qui n'exporte | `TourContext`, `useTour` |
| `TourLaunchButton.tsx` | Bouton d'entree du tutoriel. Halo orange pulsant tant que l'utilisateur | `TourLaunchButton` |
| `TourOverlay.tsx` | Rendu visuel du tour : spotlight (trou dans un fond sombre) autour | `TourOverlay` |
| `TourProvider.tsx` | Moteur de tour guide generique et portable : aucune dependance a | `TourProvider` |
| `types.ts` | Types du moteur de tour guide generique (voir index.ts pour le |  |
| `useTourTarget.ts` | Resout un selecteur CSS en element DOM et suit sa position/taille. | `useTourTarget` |

### frontend/src/hooks

| File | Description | Exports |
|---|---|---|
| `useAutoSave.ts` | Sauvegarde automatique de la session toutes les 2 minutes. | `useAutoSave`, `downloadAnnotationBackup`, `getLocalBackup` |
| `useKeyboardShortcuts.ts` | Raccourcis clavier globaux pour l'interface d'annotation. | `useKeyboardShortcuts` |
| `useTaskPolling.ts` | Poll le statut d'une tâche async (export, ByteTrack, etc.) | `useTaskPolling`, `useExportTaskPolling` |

### frontend/src/i18n

| File | Description | Exports |
|---|---|---|
| `translate.ts` | Traduction FR -> EN a l'affichage. Le francais reste la source de | `getLang`, `setLang`, `subscribeLang`, `isDesktopPiloted`, `initWorkspaceLanguage`, `setLangAndMaybePersist`, `annotationsAPI`, `t` |
| `useLang.ts` |  | `useLang`, `useT` |

### frontend/src/pages

| File | Description | Exports |
|---|---|---|
| `AnnotationPage.tsx` | Page principale d'annotation : canvas + sidebar + timeline. | `AnnotationPage` |
| `ConvertPage.tsx` | Page utilitaire « Convert » (S10) : conversions rapides d'images | `ConvertPage` |
| `MonitoringPage.tsx` | Usage reel de l'application : ce qui a ete produit automatiquement, | `MonitoringPage` |
| `PresentationPage.tsx` | Aide integree : rend les pages markdown de Annotation_App/docs/ servies | `PresentationPage` |
| `ProjectsPage.tsx` | Page d'accueil : liste des projets, création, suppression. | `ProjectsPage` |

### frontend/src/services

| File | Description | Exports |
|---|---|---|
| `api.ts` | Client HTTP axios typé pour toutes les requêtes vers l'API FastAPI. | `projectsAPI`, `datasetAPI`, `filesAPI`, `monitoringAPI`, `annotationsAPI`, `samAPI`, `sam3API`, `trackingAPI`, `taskAPI`, `samplesAPI`, `docsAPI`, `settingsAPI` (+4) |
| `websocket.ts` | Client WebSocket typé avec reconnexion automatique. | `AnnotationWebSocket`, `samImageWS`, `samVideoWS`, `subscribeTaskProgress`, `WS_URLS` |

### frontend/src/stores

| File | Description | Exports |
|---|---|---|
| `annotationStore.ts` | Store Zustand central pour la gestion des annotations. | `useAnnotationStore` |
| `bulkUndoStore.ts` | Coordination "dernière action gagne" entre le undo/redo PER-FRAME | `useBulkUndoStore` |
| `importStore.ts` | Orchestration des imports de séquences EN TÂCHE DE FOND. | `useImportStore` |
| `projectStore.ts` | Store Zustand pour la gestion des projets et des frames. | `useProjectStore` |
| `samStore.ts` | Store Zustand pour les interactions avec SAM2. | `useSAMStore` |
| `settingsStore.ts` | Store Zustand des paramètres utilisateur. | `useSettingsStore` |
| `uiStore.ts` | Store Zustand pour l'état de l'interface utilisateur. | `useUIStore` |

### frontend/src/types

| File | Description | Exports |
|---|---|---|
| `api.ts` | Définitions TypeScript strictes pour toutes les réponses de l'API. |  |

### frontend/src/utils

| File | Description | Exports |
|---|---|---|
| `coordinates.ts` | Conversion entre coordonnées YOLO normalisées et coordonnées pixel. | `yoloToPixel`, `pixelToYolo`, `normalizedToPixel`, `pixelToNormalized`, `normalizedPolygonToPixel`, `clampYoloBBox`, `computeIoU` |
| `nativeWorkspace.ts` |  | `openInNativeFileManager` |
| `tutorialState.ts` | Etat du tutoriel interactif ("deja lance", "termine"). | `isTutorialStateNative`, `readTutorialState`, `writeTutorialState` |
<!-- generated:end -->
