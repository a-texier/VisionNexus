---
app: annotation
doc_type: api-reference
audience: dev
lang: en
title: API reference
order: 70
tags: [rest api, websocket, endpoints, fastapi, orchestrator]
sources: [Annotation_App/backend/main.py, Annotation_App/backend/models/routers/docs.py, Annotation_App/backend/models/routers/projects.py, Annotation_App/backend/models/routers/dataset.py, Annotation_App/backend/models/routers/annotation.py, Annotation_App/backend/models/routers/sam.py, Annotation_App/backend/models/routers/tracking.py, Annotation_App/backend/models/routers/export.py, Annotation_App/backend/models/routers/samples.py, Annotation_App/backend/models/routers/settings.py, Annotation_App/backend/models/routers/storage.py, Annotation_App/backend/models/routers/convert.py, Annotation_App/backend/models/routers/orchestrator.py]
---

# API reference

## Conventions of the Annotation App API

The Annotation App backend exposes a JSON REST API under `/api`, WebSockets under `/ws`, the workspace files under `/media`, and interactive documentation (Swagger) at `/docs` on the backend port (8000 by default, see [Configuration](configuration.md)). Through the Vite frontend, the same paths are proxied, so the frontend always calls relative URLs.

General rules:

- **Coordinates** in requests and responses are normalized YOLO values in `[0, 1]` (`cx`, `cy`, `width`, `height`, polygon `points`), except for the pixel-based export formats.
- **Identifiers**: `project_id`, `frame_id`, `sequence_id`, `track_id` and `annotation_id` are database ids. `frame_index` is the global index of a frame in its project; the interface shows 1-based positions inside a sequence.
- **Errors** use FastAPI's format `{"detail": "..."}` with 400 (invalid input), 404 (unknown object), 503 (model not available) or 500. Detail messages are written in French; the frontend shows them as they are.
- **Long operations** return a `task_id` immediately. Follow them with `WS /ws/tasks/{task_id}` (preferred) or `GET /api/tasks/{task_id}`; exports have their own status endpoint.
- **Paths** sent to the backend are server paths; Windows UNC paths are translated for imports, the file browser and export destinations.
- Responses above 1 KB are gzip-compressed when the client accepts it.

The endpoint tables of the section *Endpoint index* are generated from the code; the sections below explain each domain.

## Projects, classes, session and backup endpoints

The projects router (`/api/projects`) manages projects and everything attached to them as a whole.

- `GET /api/projects` lists projects with their counts and a summary of their sequences (used by the projects page); `POST /api/projects` creates one (`name`, `project_type` `image` or `video`, optional description and classes).
- `GET /api/projects/{id}` returns the project with its classes and session; `PUT` updates it; `DELETE` removes it with a manual cascade (annotations, frames, tracks, classes, session). `GET /api/projects/{id}/stats` gives counts per class and per type.
- `GET` / `PUT /api/projects/{id}/lut` read and write the project display LUT (`mode` `sigma`, `minmax` or `manual`, with `sigma`, `lo`, `hi`).
- `GET` / `PUT /api/projects/{id}/session` store the current frame, zoom, offsets, class and tool.
- Classes: `GET` / `POST /api/projects/{id}/classes`, `PUT` / `DELETE /api/projects/{id}/classes/{class_id}` (`name`, `color`, `subclass`, `subsubclass`, `shortcut_key`). The `shortcut_key` field is the only way to assign a digit shortcut to a class.
- Backup: `GET /api/projects/{id}/backup` returns all annotations grouped by sequence as JSON; `POST /api/projects/{id}/backup/save` writes `backup/p<id>_<name>/p<id>_<name>.json` and the `_sequences.txt` list in the workspace (called every two minutes by the frontend); `POST /api/projects/{id}/restore` takes such a JSON and redistributes annotations by sequence name and local frame index, falling back to sequence order, then to legacy ids.

## Dataset endpoints: imports, frames, sequences and images

The dataset router handles everything related to frames and their pixels.

**Imports** (all create a sequence and may return a `task_id` for background work): `POST /api/projects/{id}/import/images` (multipart upload), `/import/folder` (server folder, symbolic links or copy, incremental), `/import/video` (chunked upload with `frame_keep`, `jpeg_quality`, `chunk_size_mb`, `extraction_batch_size`), `/import/video_from_path` (server video), and `/import/specific` (optional format adapter). `POST /api/sequences/parse-manifest` expands a `.txt` sequence list. `POST /api/projects/{id}/frames/ensure_extracted` extracts the frames around a given index first.

**Frames and sequences**: `GET /api/projects/{id}/frames` (paginated metadata with annotation counts, optional `sequence_id`), `GET /api/projects/{id}/frames/by-index/{frame_index}`, `GET /api/frames/{frame_id}`, `POST /api/frames/{frame_id}/mark-empty`, `PUT /api/frames/{frame_id}/keyframe`, `GET /api/projects/{id}/sequences` (with annotated frames and annotation counts), and the per-sequence LUT `PUT` / `DELETE /api/sequences/{id}/lut`.

**Images**: `GET /api/frames/{frame_id}/image` with `preview=1` (480 px), `display=1` (1600 px) or full resolution; missing files give a gray placeholder with `X-Frame-Missing`. `GET /api/frames/{frame_id}/image-path` returns the native (UNC) path and the fallback URL for the VisionNexus shell. `GET /api/frames/{frame_id}/histogram` returns the raw-value histogram used by the LUT panel.

**Annotation import**: `POST /api/projects/{id}/sequences/{sequence_id}/import-annotations` (server path of a `.ver` file or a YOLO folder, `format`, `replace`) and `/import-annotations-upload` (the same with uploaded files).

**File browser**: `GET /api/files/browse` lists a server folder; `GET` / `POST /api/files/browse-history` read and record recently browsed folders.

## Annotation endpoints

The annotation router works on annotations of one frame or of a whole project.

- Per frame: `GET` / `POST /api/frames/{frame_id}/annotations` (list, create), `PUT` / `DELETE /api/annotations/{annotation_id}`, `POST /api/frames/{frame_id}/annotations/bulk` (replace or add a list in one request, used by text detection), `DELETE /api/frames/{frame_id}/annotations/all`.
- Cleanup: `POST /api/frames/{frame_id}/annotations/nms` (non-maximum suppression with an IoU threshold, keeps the most confident), `GET /api/frames/{frame_id}/overlaps` (pairs of overlapping annotations).
- Multi-frame deletion: `POST /api/projects/{id}/annotations/delete-frames` with `{"frame_ids": [...]}` deletes the annotations of many frames in a single transaction; `undo-bulk-delete` and `redo-bulk-delete` restore or replay the last bulk deletion (timeline `Ctrl+Z` / `Ctrl+Y`). `DELETE /api/projects/{id}/annotations/batch` and `/from-frame` delete by selection or from a frame index on.
- Copy and interpolation: `POST /api/frames/{frame_id}/copy-to` copies annotations to target frames; `POST /api/projects/{id}/interpolate` fills the frames between two annotated keyframes of a track (not exposed in the interface).
- Project views: `GET /api/projects/{id}/annotations/all`, `/summary` (per-frame counts) and `/validate` (consistency checks).

Creation requires a valid `class_id`; an annotation without class is refused with "class_id requis".

## SAM2, Grounding DINO and SAM3 endpoints

The SAM router exposes the segmentation and text detection models.

- **SAM2**: `GET /api/sam/status` and `GET /api/sam/ping` report whether the model is loaded, on which device and with which checkpoint; `POST /api/sam/load` loads a model size; `POST /api/sam/predict/points` takes a frame id and labeled points (1 foreground, 0 background) and returns up to three masks with scores, boxes and polygons. Requests fail with "Modèle SAM2 non chargé" when no checkpoint is loaded.
- **Grounding DINO**: `POST /api/sam/predict/text` takes `frame_id`, `text_prompt`, `box_threshold`, `text_threshold` and `use_sam` (refine each box into a mask with SAM2); it returns detections with normalized boxes, optional polygons and scores. `GET /api/sam/grounding/status` reports availability.
- **SAM3**: `POST /api/sam3/predict/text` with the same kind of prompt and thresholds returns boxes, masks and polygons in one pass; `GET /api/sam3/status` and `POST /api/sam3/load` handle the model.
- **WebSockets**: `WS /ws/sam/image` runs SAM Auto on a frame and streams one message per mask (the frontend keeps them as proposals); `WS /ws/sam/video` supports interactive video sessions.

Prediction endpoints do not save annotations; the client creates them (single or bulk) after the user's choice. The Detect. mode and the Orchestrator auto-annotation call the same models server side.

## Tracking, propagation and task endpoints

The tracking router groups tracks, propagations and the task machinery.

- **Tracks**: `GET` / `POST /api/projects/{id}/tracks`, `PUT` / `DELETE /api/tracks/{track_id}` (delete removes the track's annotations), `POST /api/tracks/{track_id}/delete-block` (remove the annotations of a frame range), `POST /api/projects/{id}/tracks/merge` (`track_id_keep`, `track_id_merge`), `DELETE /api/projects/{id}/tracks` (delete all tracks, keep annotations detached), and `POST /api/annotations/{annotation_id}/track` (`action` `new`, `assign` or `detach`).
- **SAMURAI / SAM2 video**: `POST /api/projects/{id}/sam2-tracking/run` with `reference_frame_id`, `annotation_ids`, `end_frame_id` (before the reference means backward), `output_mode` (`bbox` or `segmentation`) and `tracking_mode` (`auto` or `samurai_per_object`). `GET /api/samurai/status` reports SAMURAI availability and a GPU estimate (`est_max_frames_gpu`).
- **Guided tracking (Detect.)**: `POST /api/projects/{id}/guided-tracking/run` with the reference frame, target annotations, frame range, `algorithm` (`grounding_dino` or `sam3`), `text_prompt` (required), thresholds, `max_centroid_distance`, `size_variation_threshold`, `sam3_output_mode` and auto-stop parameters. The thresholds are used for Grounding DINO only; SAM3 detections are not filtered. Each target keeps its track or gets a new one, and annotations are saved with `source_algorithm` `guided_tracking`. The result lists anomalies (`missing`, `size_variation`).
- **Homography and optical flow**: `POST /api/projects/{id}/homography/propagate` with `keyframe_id`, `end_frame_id`, `annotation_ids`, the RANSAC and XFeat parameters and `use_optical_flow` (true for Lucas-Kanade with `optflow_*` parameters). API defaults (4096 keypoints, 3.0 px, 30 inliers, ratio 0.5) are stricter than the interface defaults taken from the settings, and `use_optical_flow` defaults to `true`: send `false` explicitly for homography. The end frame must come after the keyframe (forward only); results are saved as boxes with `is_auto` and `is_interpolated`, the source `track_id` and `source_algorithm` `homography` or `optical_flow`. `GET /api/homography/status` and `GET /api/projects/{id}/homography/debug` support the Debug tab; the debug endpoint accepts an optional `min_inlier_ratio` (0 to 1) to judge validity.
- **ByteTrack**: `POST /api/projects/{id}/bytetrack/run` remains available through the API only.
- **Tasks**: `GET /api/tasks/{task_id}` (state), `GET /api/tasks/{task_id}/logs?since=N` (incremental log lines), `POST .../stop`, `.../pause`, `.../resume`, and `WS /ws/tasks/{task_id}` (state changes and `live_frames`, see [Architecture](architecture.md)).

## Export endpoints

The export router produces datasets as background tasks.

- `POST /api/projects/{id}/export` starts an export and returns `task_id`. Body: `output_format` (`yolo`, `coco` or `ver`), `split_train`, `split_val`, `split_test` (default 0.8 / 0.1 / 0.1), `include_unannotated` (default true), `class_filter` (list of class ids, all by default), `export_name`, `symlink_images` (default true: dataset folder with links, no ZIP) and `custom_export_dir` (solo mode only).
- `GET /api/exports/{task_id}/status` returns `status`, `progress`, `message` and, when done, the output path.
- `GET /api/exports/{task_id}/download` returns the ZIP of a copy-mode export; in symbolic link mode it answers 400 because there is no ZIP.
- `GET /api/projects/{id}/export/preview` computes what an export would contain (counts per split and class) without writing anything.

Output layouts: YOLO writes `<sequence>-yolo/` folders (flat for a single sequence) with `data.yaml`, and `seg_labels/` plus `seg_data.yaml` when polygons exist; COCO writes `<sequence>-coco/` with `annotations/instances_{split}.json`; `.ver` writes one `<sequence>.ver` per sequence. Successful exports record `last_export_at` and `last_export_format` on each sequence. Format details are in [Concepts](concepts.md) and [Architecture](architecture.md).

## Samples, settings, storage and workspace endpoints

These small routers support the interface around the projects.

- **Samples** (`/api/samples`): `GET /api/samples/sequences` lists the sample sequences of the suite (`data_tuto/`, or `CV_DATA_TUTO`), `GET /api/samples/sequences/{sample_id}` describes one; the interactive tutorial imports its demo project from there.
- **Settings**: `GET /api/settings` returns the merged user settings (defaults filled in), `PUT /api/settings` merges a partial update, `POST /api/settings/reset` restores the defaults. `GET /api/workspace/info` returns the workspace paths; `POST /api/workspace/reveal` opens it on the server machine.
- **Storage**: `GET /api/storage/stats` gives the size of projects, backups and exports; `DELETE /api/storage/backup` and `DELETE /api/storage/exports` empty those folders.
- **Workspace helpers** (defined in `main.py`): `POST /api/workspace/open` opens a folder in the file explorer of the backend machine or, for a remote session, returns its UNC path; `GET /api/workspace/open-cmd` returns a one-line `.cmd` file that opens the folder in the Windows explorer; `GET /api/workspace/users` and `GET /api/workspace/history` feed the user badge.
- **Monitoring** (defined in `main.py`): `GET /api/monitoring/stats?scope=me|all` returns the aggregated statistics of the Monitoring page; `GET /api/monitoring/report?scope=...` downloads the standalone HTML report.

## Convert endpoints

The convert router provides conversions between annotation and sequence formats, independent of projects. All paths are server paths; outputs must not exist yet.

- `POST /api/convert/ver-to-yolo`: `.ver` file (pixels) to a normalized YOLO folder; needs the image width and height.
- `POST /api/convert/yolo-to-ver`: YOLO folder to a `.ver` file; the class is repeated in the three class columns and `track_id` is `-1`.
- `POST /api/convert/format specialise-to-png` and `POST /api/convert/png-to-format specialise`: conversions of the optional format specialise format.
- `POST /api/convert/video_to_format specialise` (dataset router): converts a video to format specialise as a background task.

The Convert page of the interface uses the first two. Conversions run synchronously except `video_to_format specialise`, and return counts (classes, boxes or frames written).

## Orchestrator integration endpoints

The `/api/orchestrator` router is the contract with Orchestrator App; its endpoints are designed to be called by another backend and are kept stable.

- `GET /api/orchestrator/check-source?subset_name=...` lists existing projects whose source already matches a subset, so the Orchestrator can warn before creating a duplicate.
- `POST /api/orchestrator/create-project`: `subset_name`, optional `project_name`, `label_classes`, `import_path` (explicit folder) and `mode` (`sequence` or `random`). Images are looked up in the explicit path, then in `<workspace>/imports/<subset>`; the import runs in the background.
- `GET /api/orchestrator/project-status?project_name=...` returns import progress and annotation progress (annotated frames out of total), polled by the Orchestrator to draw progress under its node.
- `POST /api/orchestrator/auto-annotate`: `project_name`, `model` (`sam3` or `grounding_dino`), `text_prompt`, `threshold` (default 0.20); runs text detection on every frame.
- `POST /api/orchestrator/export-yolo`: `project_name`, optional `export_name`, splits (default 0.8 / 0.2 / 0.0), `wait_timeout_s`, `reuse_if_exists`. An existing export with the same content signature is reused; otherwise the first free name is used, never overwriting.
- `POST /api/orchestrator/export-ver`: `.ver` export of the project, always produced with the YOLO export in Orchestrator pipelines.

`GET /api/app-mode` tells the frontend whether the app was launched by the Orchestrator (`LAUNCHED_BY_ORCHESTRATOR`) and where exports go.

## Health and application endpoints

A few endpoints defined in `main.py` describe the application itself.

- `GET /health` returns `{"status": "ok", "api": "running", "sam2": {...}, "database": "connected"}`. VisionNexus polls it before opening the Annotation tab, because loading the models takes 10 to 40 seconds.
- `GET /` returns links to `/docs`, `/redoc` and `/health`.
- `GET /api/capabilities` returns `{"specific_formats": [...]}`, the optional sequence formats found by the format registry (label, extensions, import contract). The import window builds its accepted extensions from this list.
- `GET /api/app-mode` returns `mode` (`solo` or `orchestrator`), `exports_dir` and `workspace`.
- `GET /api/sam/ping` gives a short SAM2 status for the interface.
- `GET /api/docs`, `GET /api/docs/{name}` and `GET /api/docs/assets/{path}` serve this documentation to the in-app documentation page.

Use `GET /health` and `GET /api/sam/ping` first when diagnosing an installation (see [Troubleshooting](troubleshooting.md)). The interactive Swagger documentation at `/docs` lists every endpoint with its request schema and can call them directly.

## Endpoint index

<!-- generated:start -->
### Annotations

| Method | Path | Summary | Source |
|---|---|---|---|
| DELETE | `/api/annotations/{annotation_id}` | Supprime une annotation, met à jour les compteurs et recalcule les bornes du track associé. | `Annotation_App/backend/models/routers/annotation.py:379` |
| PUT | `/api/annotations/{annotation_id}` | Met à jour partiellement une annotation (position, classe, etc.). Utilisé lors du redimensionnement ou déplacement d'une box sur le canvas. | `Annotation_App/backend/models/routers/annotation.py:332` |
| GET | `/api/frames/{frame_id}/annotations` | Retourne toutes les annotations d'une frame. | `Annotation_App/backend/models/routers/annotation.py:184` |
| POST | `/api/frames/{frame_id}/annotations` | Crée une nouvelle annotation sur une frame. Valide les coordonnées YOLO avant insertion. | `Annotation_App/backend/models/routers/annotation.py:198` |
| DELETE | `/api/frames/{frame_id}/annotations/all` | Supprime toutes les annotations d'une frame. | `Annotation_App/backend/models/routers/annotation.py:552` |
| POST | `/api/frames/{frame_id}/annotations/bulk` | Ajoute plusieurs annotations en une seule requête. Si replace=True, supprime toutes les annotations existantes avant l'insertion. Utilisé pour sauvegarder les résultats d'une auto-segmentation SAM2. | `Annotation_App/backend/models/routers/annotation.py:432` |
| POST | `/api/frames/{frame_id}/annotations/nms` | Applique le Non-Maximum Suppression (NMS) sur les annotations d'une frame. Supprime les annotations redondantes qui se chevauchent trop. Conserve l'annotation avec la meilleure confiance dans chaque groupe. | `Annotation_App/backend/models/routers/annotation.py:1041` |
| POST | `/api/frames/{frame_id}/copy-to` | Copie toutes les annotations d'une frame vers une ou plusieurs frames cibles. Utile pour propager manuellement des annotations vers la frame suivante. | `Annotation_App/backend/models/routers/annotation.py:745` |
| GET | `/api/frames/{frame_id}/overlaps` | Détecte les annotations en doublon sur une frame (IoU > seuil). Utile pour identifier les objets annotés deux fois par erreur. | `Annotation_App/backend/models/routers/annotation.py:810` |
| GET | `/api/projects/{project_id}/annotations/all` | Retourne toutes les annotations du projet en une seule requete (cache client). | `Annotation_App/backend/models/routers/annotation.py:168` |
| DELETE | `/api/projects/{project_id}/annotations/batch` | Supprime plusieurs annotations en une seule requete. Verifie que chaque annotation appartient bien au projet. Met a jour les statuts de frames et compteurs du projet. | `Annotation_App/backend/models/routers/annotation.py:1185` |
| POST | `/api/projects/{project_id}/annotations/delete-frames` | Supprime toutes les annotations de PLUSIEURS frames en UNE transaction. | `Annotation_App/backend/models/routers/annotation.py:589` |
| DELETE | `/api/projects/{project_id}/annotations/from-frame` | Supprime toutes les annotations a partir de la frame N (incluse). Utile pour repartir proprement apres un echec de tracking ou de propagation. | `Annotation_App/backend/models/routers/annotation.py:1229` |
| POST | `/api/projects/{project_id}/annotations/redo-bulk-delete` | Refait la suppression annulée : re-supprime les annotations restaurées. | `Annotation_App/backend/models/routers/annotation.py:724` |
| GET | `/api/projects/{project_id}/annotations/summary` | Retourne toutes les annotations du projet avec leur contexte de frame. Utilise pour le panneau de resume global multi-frames. | `Annotation_App/backend/models/routers/annotation.py:1120` |
| POST | `/api/projects/{project_id}/annotations/undo-bulk-delete` | Annule la dernière suppression groupée : re-crée les annotations effacées. | `Annotation_App/backend/models/routers/annotation.py:701` |
| GET | `/api/projects/{project_id}/annotations/validate` | Valide toutes les annotations du projet avant export. Vérifie que les coordonnées sont dans [0, 1] et détecte les incohérences. | `Annotation_App/backend/models/routers/annotation.py:983` |
| POST | `/api/projects/{project_id}/interpolate` | Génère des annotations interpolées entre deux frames annotées manuellement. Utile pour combler les lacunes de tracking sur de courtes séquences. | `Annotation_App/backend/models/routers/annotation.py:856` |

### Capabilities

| Method | Path | Summary | Source |
|---|---|---|---|
| GET | `/api/capabilities` | Expose optional formats without coupling the frontend to a plugin name. | `Annotation_App/backend/main.py:272` |

### Convert

| Method | Path | Summary | Source |
|---|---|---|---|
| POST | `/api/convert/format specialise-to-png` | `convert_format specialise_to_png()` | `Annotation_App/backend/models/routers/convert.py:69` |
| POST | `/api/convert/png-to-format specialise` | `convert_png_to_format specialise()` | `Annotation_App/backend/models/routers/convert.py:80` |
| POST | `/api/convert/ver-to-yolo` | `convert_ver_to_yolo()` | `Annotation_App/backend/models/routers/convert.py:91` |
| POST | `/api/convert/yolo-to-ver` | `convert_yolo_to_ver()` | `Annotation_App/backend/models/routers/convert.py:101` |

### Dataset

| Method | Path | Summary | Source |
|---|---|---|---|
| POST | `/api/convert/video_to_format specialise` | Convertit un fichier vidéo (MP4, AVI...) en format specialise par lecture séquentielle. | `Annotation_App/backend/models/routers/dataset.py:2429` |
| GET | `/api/files/browse` | Liste les fichiers et dossiers d'un chemin serveur. Permet au frontend d'explorer le filesystem pour sélectionner un dossier d'images ou un fichier vidéo sans copier-coller. | `Annotation_App/backend/models/routers/dataset.py:2086` |
| GET | `/api/files/browse-history` | Derniers dossiers serveur parcourus (le plus recent en tete). | `Annotation_App/backend/models/routers/dataset.py:2040` |
| POST | `/api/files/browse-history` | Enregistre un dossier dans l'historique de navigation de l'utilisateur. | `Annotation_App/backend/models/routers/dataset.py:2055` |
| GET | `/api/frames/{frame_id}` | Retourne le détail d'une frame avec toutes ses annotations. C'est l'endpoint principal utilisé par le canvas d'annotation. | `Annotation_App/backend/models/routers/dataset.py:1407` |
| GET | `/api/frames/{frame_id}/histogram` | Histogramme des valeurs BRUTES de la frame (avant LUT), pour l'outil LUT. Lit la source réelle : format specialise décodé à la volée, sinon le fichier image UNCHANGED (préserve le 16 bits). Retourne bins/counts/min/max/mean/std/bit_depth. | `Annotation_App/backend/models/routers/dataset.py:1941` |
| GET | `/api/frames/{frame_id}/image` | Sert le fichier image d'une frame. - Extraite dans frames_dir standard -> FileResponse. - format specialise : fichier dans {format specialise_parent}/{format specialise_stem}_png/ -> FileResponse. - Non extraite ou introuvable -> placeholder gris. - preview=1 : JPEG 480 px (scrubbing du slider). - display=1 : JPEG 1600 px (affichage canvas au zoom ajuste). Le frontend rebascule sur la source pleine resolution au zoom fort. Le traitement IA (SAMURAI) et l'export lisent TOUJOURS la source, jamais ces versions reduites. | `Annotation_App/backend/models/routers/dataset.py:1700` |
| GET | `/api/frames/{frame_id}/image-path` | Variante legere de GET /image : au lieu de streamer les octets, garantit que le fichier cache existe deja sur disque puis renvoie son chemin natif. Pensee pour la coquille Electron (plan SMB) : cet endpoint ne transite que via le tunnel SSH avec un JSON minuscule ; les pixels (10-800 Ko/image) sont ensuite lus directement via le partage reseau, en contournant le tunnel pour la partie qui coute reellement cher. | `Annotation_App/backend/models/routers/dataset.py:1897` |
| PUT | `/api/frames/{frame_id}/keyframe` | Marque/démarque une frame comme keyframe pour le tracking. | `Annotation_App/backend/models/routers/dataset.py:1490` |
| POST | `/api/frames/{frame_id}/mark-empty` | Marque une frame comme explicitement vide (aucun objet d'intérêt). Lors de l'export YOLO, génère un fichier .txt vide pour cette frame. | `Annotation_App/backend/models/routers/dataset.py:1457` |
| GET | `/api/frames/{frame_id}/thumbnail` | Sert la miniature 160x90 d'une frame. - Miniature sur disque (data/projects/{id}/thumbnails/) -> FileResponse. - Non extraite -> placeholder gris. | `Annotation_App/backend/models/routers/dataset.py:1992` |
| GET | `/api/projects/{project_id}/frames` | Liste les frames d'un projet avec pagination. Supporte le filtrage des frames annotées uniquement, et par séquence. | `Annotation_App/backend/models/routers/dataset.py:1201` |
| GET | `/api/projects/{project_id}/frames/by-index/{frame_index}` | Retourne une frame par son index logique. Utilise pour la navigation sparse: le frontend peut sauter directement a F2400 sans charger toutes les frames precedentes. NOTE: la reparation des records est intentionnellement absente ici (hot path de navigation - appele a chaque frame). La reparation se fait uniquement via list_frames (chargement initial). | `Annotation_App/backend/models/routers/dataset.py:1375` |
| POST | `/api/projects/{project_id}/frames/ensure_extracted` | Extrait à la demande les frames autour de `center_frame_index` qui ne sont pas encore extraites physiquement (is_extracted=False). | `Annotation_App/backend/models/routers/dataset.py:1112` |
| POST | `/api/projects/{project_id}/import/folder` | Importe toutes les images d'un dossier local en arrière-plan. Retourne immédiatement un task_id pour suivre la progression via GET /api/tasks/{task_id}. Supporte les grands dossiers (2000+ images) sans timeout. | `Annotation_App/backend/models/routers/dataset.py:582` |
| POST | `/api/projects/{project_id}/import/images` | Importe des images dans le projet via upload multipart. Génère les miniatures et crée les entrées en base de données. Supporte : .jpg, .jpeg, .png, .bmp, .tiff, .webp | `Annotation_App/backend/models/routers/dataset.py:486` |
| POST | `/api/projects/{project_id}/import/format specialise` | Import fichier .optional uploade - extraction complete vers PNG en arriere-plan. Le fichier format specialise est sauvegarde dans data/projects/{id}/ et converti en PNG dans data/projects/{id}/{stem}_png/ avant d'entrer dans le projet. | `Annotation_App/backend/models/routers/dataset.py:935` |
| POST | `/api/projects/{project_id}/import/specific` | Import an uploaded sequence through an optional format adapter. | `Annotation_App/backend/models/routers/dataset.py:896` |
| POST | `/api/projects/{project_id}/import/video` | Import vidéo - mode lazy : | `Annotation_App/backend/models/routers/dataset.py:713` |
| POST | `/api/projects/{project_id}/import/video_from_path` | Import vidéo depuis un chemin sur le serveur - aucun upload. Identique à import_video mais sans copier le fichier source. La vidéo n'est JAMAIS supprimée (elle n'appartient pas au projet). | `Annotation_App/backend/models/routers/dataset.py:2179` |
| GET | `/api/projects/{project_id}/sequences` | Liste les séquences d'un projet (multi-séquence) avec leurs statistiques d'annotation : nombre de frames, frames annotées, nombre d'annotations. Les frames de chaque séquence occupent la plage globale [start_index, start_index + frame_count). | `Annotation_App/backend/models/routers/dataset.py:1249` |
| POST | `/api/projects/{project_id}/sequences/{sequence_id}/import-annotations` | Importe des annotations .ver / YOLO sur une séquence (S9). Convertit vers le format interne (YOLO normalisé), crée classes/tracks manquants, et associe les détections aux frames de la séquence (.ver : frame 1-based ; YOLO : par stem sinon par ordre). `replace` remplace les annotations existantes de la séquence. | `Annotation_App/backend/models/routers/dataset.py:128` |
| POST | `/api/projects/{project_id}/sequences/{sequence_id}/import-annotations-upload` | Variante UPLOAD de l'import d'annotations (drag & drop navigateur) : reçoit un ou plusieurs fichiers (un .ver, OU un dossier YOLO de .txt + data.yaml), les écrit dans un dossier temporaire serveur, puis réutilise _do_import_annotations. Le format est auto-détecté d'après les extensions reçues. | `Annotation_App/backend/models/routers/dataset.py:246` |
| POST | `/api/sequences/parse-manifest` | Lit un .txt de manifeste de séquences côté serveur (une ligne « source_path<TAB>nom », ou séparée par espace) et retourne les entrées pour pré-remplir l'import. Généré par le backup (step3b) -> récupération de projet. | `Annotation_App/backend/models/routers/dataset.py:54` |
| DELETE | `/api/sequences/{sequence_id}/lut` | Efface la LUT propre à la séquence -> repli sur la LUT projet. | `Annotation_App/backend/models/routers/dataset.py:1362` |
| PUT | `/api/sequences/{sequence_id}/lut` | Définit la LUT d'affichage PROPRE à une séquence (persistée, prioritaire sur la LUT projet). Renvoie la signature de cache pour le cache-buster. | `Annotation_App/backend/models/routers/dataset.py:1344` |

### Docs

| Method | Path | Summary | Source |
|---|---|---|---|
| GET | `/api/docs` | Pages du jeu de docs, triees par `order`, avec les langues disponibles. | `Annotation_App/backend/models/routers/docs.py:163` |
| GET | `/api/docs/assets/{asset_path:path}` | `get_doc_asset()` | `Annotation_App/backend/models/routers/docs.py:187` |
| GET | `/api/docs/{name}` | Une page : frontmatter + corps markdown, avec repli de langue. | `Annotation_App/backend/models/routers/docs.py:197` |

### Export

| Method | Path | Summary | Source |
|---|---|---|---|
| GET | `/api/exports/{task_id}/download` | Télécharge le fichier ZIP de l'export YOLO. N'est disponible qu'une fois la tâche terminée (status=completed). | `Annotation_App/backend/models/routers/export.py:542` |
| GET | `/api/exports/{task_id}/status` | Retourne le statut d'une tâche d'export. Utilisé par le frontend pour poller la progression. | `Annotation_App/backend/models/routers/export.py:521` |
| POST | `/api/projects/{project_id}/export` | Lance l'export du dataset en arrière-plan. Retourne un task_id pour suivre la progression et télécharger le fichier. | `Annotation_App/backend/models/routers/export.py:81` |
| GET | `/api/projects/{project_id}/export/preview` | Génère un aperçu de ce qui sera exporté : statistiques par classe, distribution des splits, validation des coordonnées. Utilisé par le modal d'export pour informer l'utilisateur avant le lancement. | `Annotation_App/backend/models/routers/export.py:576` |

### main

| Method | Path | Summary | Source |
|---|---|---|---|
| GET | `/api/app-mode` | Retourne si l'app est lancée par l'Orchestrateur ou en mode solo. | `Annotation_App/backend/main.py:259` |

### Monitoring

| Method | Path | Summary | Source |
|---|---|---|---|
| GET | `/api/monitoring/report` | Genere et renvoie le rapport HTML autonome (meme sortie que l'outil CLI). | `Annotation_App/backend/main.py:430` |
| GET | `/api/monitoring/stats` | Statistiques d'usage. | `Annotation_App/backend/main.py:393` |

### orchestrator

| Method | Path | Summary | Source |
|---|---|---|---|
| POST | `/api/orchestrator/auto-annotate` | `auto_annotate()` | `Annotation_App/backend/models/routers/orchestrator.py:622` |
| GET | `/api/orchestrator/check-source` | `check_source()` | `Annotation_App/backend/models/routers/orchestrator.py:102` |
| POST | `/api/orchestrator/create-project` | `create_project()` | `Annotation_App/backend/models/routers/orchestrator.py:119` |
| POST | `/api/orchestrator/export-ver` | `export_ver_orchestrator()` | `Annotation_App/backend/models/routers/orchestrator.py:547` |
| POST | `/api/orchestrator/export-yolo` | `export_yolo_orchestrator()` | `Annotation_App/backend/models/routers/orchestrator.py:398` |
| GET | `/api/orchestrator/project-status` | `project_status()` | `Annotation_App/backend/models/routers/orchestrator.py:261` |

### Projets

| Method | Path | Summary | Source |
|---|---|---|---|
| GET | `/api/projects` | Liste tous les projets avec leurs statistiques de base, ainsi qu'un résumé par séquence (multi-séquence) pour l'affichage de la page d'accueil. Retourne un résumé sans les données volumineuses (frames, annotations). | `Annotation_App/backend/models/routers/projects.py:74` |
| POST | `/api/projects` | Crée un nouveau projet d'annotation avec ses classes initiales. Génère automatiquement le fichier classes.yaml et initialise la session. | `Annotation_App/backend/models/routers/projects.py:133` |
| DELETE | `/api/projects/{project_id}` | Supprime un projet et TOUTES ses données associées (en cascade manuelle). Ordre imposé par les FK : annotations -> frames -> tracks -> sequences -> classes -> session -> projet. Bulk DELETE (rapide + fiable même sur gros projets). Supprime aussi le dossier physique data/projects/{project_id}/. | `Annotation_App/backend/models/routers/projects.py:353` |
| GET | `/api/projects/{project_id}` | Retourne le détail d'un projet incluant ses classes et sa session sauvegardée. | `Annotation_App/backend/models/routers/projects.py:245` |
| PUT | `/api/projects/{project_id}` | Met à jour les métadonnées d'un projet existant. | `Annotation_App/backend/models/routers/projects.py:325` |
| GET | `/api/projects/{project_id}/backup` | Exporte toutes les annotations du projet en JSON. Utile pour la sauvegarde automatique et le rechargement de session. | `Annotation_App/backend/models/routers/projects.py:707` |
| POST | `/api/projects/{project_id}/backup/save` | Sauvegarde les annotations du projet dans un fichier JSON sur le serveur. Cree un dossier backup/project_name_date/ contenant project_name_date.json. Appele automatiquement toutes les 2 minutes par le frontend. | `Annotation_App/backend/models/routers/projects.py:729` |
| GET | `/api/projects/{project_id}/classes` | Liste toutes les classes d'un projet dans l'ordre. | `Annotation_App/backend/models/routers/projects.py:522` |
| POST | `/api/projects/{project_id}/classes` | Ajoute une nouvelle classe au projet. | `Annotation_App/backend/models/routers/projects.py:555` |
| DELETE | `/api/projects/{project_id}/classes/{class_id}` | Supprime une classe. Attention : les annotations liées conservent la référence. | `Annotation_App/backend/models/routers/projects.py:629` |
| PUT | `/api/projects/{project_id}/classes/{class_id}` | Met à jour une classe existante (nom, couleur, raccourci). | `Annotation_App/backend/models/routers/projects.py:597` |
| GET | `/api/projects/{project_id}/lut` | `get_project_lut()` | `Annotation_App/backend/models/routers/projects.py:216` |
| PUT | `/api/projects/{project_id}/lut` | Définit la LUT d'affichage du projet (persistée). Renvoie la signature de cache. | `Annotation_App/backend/models/routers/projects.py:226` |
| POST | `/api/projects/{project_id}/restore` | Restaure les annotations depuis un JSON de sauvegarde, en REDISPATCHANT par SÉQUENCE (résilient aux ids DB différents après recréation du projet, aux séquences manquantes et à l'ordre différent). | `Annotation_App/backend/models/routers/projects.py:788` |
| GET | `/api/projects/{project_id}/session` | Récupère l'état de session sauvegardé pour un projet. | `Annotation_App/backend/models/routers/projects.py:451` |
| PUT | `/api/projects/{project_id}/session` | Met à jour l'état de session (sauvegarde automatique toutes les 30s). Crée la session si elle n'existe pas encore. | `Annotation_App/backend/models/routers/projects.py:474` |
| GET | `/api/projects/{project_id}/stats` | Statistiques détaillées du projet : distribution par classe, taux d'annotation, nombre de pistes, etc. | `Annotation_App/backend/models/routers/projects.py:407` |

### SAM2

| Method | Path | Summary | Source |
|---|---|---|---|
| GET | `/api/sam/grounding/status` | Retourne le statut du service Grounding DINO. | `Annotation_App/backend/models/routers/sam.py:225` |
| POST | `/api/sam/load` | Charge ou recharge le modèle SAM2 avec la taille spécifiée. Sur CPU, force automatiquement le modèle 'tiny'. | `Annotation_App/backend/models/routers/sam.py:76` |
| GET | `/api/sam/ping` | Endpoint de test rapide pour vérifier que SAM2 est chargé et opérationnel. Utilisé par le frontend pour afficher l'état du modèle dans les paramètres. | `Annotation_App/backend/main.py:524` |
| POST | `/api/sam/predict/points` | Segmentation interactive SAM2 par points de prompt. Retourne jusqu'à 3 masques candidats triés par score décroissant. | `Annotation_App/backend/models/routers/sam.py:86` |
| POST | `/api/sam/predict/text` | Segmentation guidée par texte : Grounding DINO -> boîtes -> SAM2 -> masques. | `Annotation_App/backend/models/routers/sam.py:152` |
| GET | `/api/sam/status` | Retourne l'état du service SAM2 : - Modèle chargé ou non - Dispositif (CPU/GPU) - Mémoire GPU utilisée - Sessions vidéo actives | `Annotation_App/backend/models/routers/sam.py:64` |
| POST | `/api/sam3/load` | Charge le modèle SAM3.1 en mémoire. Nécessite le checkpoint dans backend/checkpoints/sam3.1_hiera_large.pt (téléchargeable avec python backend/tests/download_sam3.py après accès HF) | `Annotation_App/backend/models/routers/sam.py:525` |
| POST | `/api/sam3/predict/text` | Détection et segmentation par texte open-vocabulary avec SAM3.1. Supporte 4M+ concepts sans training supplémentaire. | `Annotation_App/backend/models/routers/sam.py:547` |
| GET | `/api/sam3/status` | Statut du service SAM3 : - installed: SAM3 est installé dans l'environnement - checkpoint_exists: checkpoint disponible sur le disque - loaded: modèle chargé en mémoire GPU/CPU | `Annotation_App/backend/models/routers/sam.py:513` |
| WS | `/ws/sam/image` | WebSocket pour la segmentation automatique d'images avec streaming des résultats. | `Annotation_App/backend/models/routers/sam.py:234` |
| WS | `/ws/sam/video` | WebSocket pour la session de propagation vidéo SAM2. | `Annotation_App/backend/models/routers/sam.py:339` |

### Samples

| Method | Path | Summary | Source |
|---|---|---|---|
| GET | `/api/samples/sequences` | Liste les sequences d'exemple embarquees (chemin absolu cote backend). | `Annotation_App/backend/models/routers/samples.py:43` |
| GET | `/api/samples/sequences/{sample_id}` | Detail d'une sequence d'exemple. 404 si le dossier livre est absent. | `Annotation_App/backend/models/routers/samples.py:55` |

### Santé

| Method | Path | Summary | Source |
|---|---|---|---|
| GET | `/` | Page d'accueil de l'API avec liens utiles. | `Annotation_App/backend/main.py:282` |
| GET | `/api/workspace/history` | Retourne l'historique des workspaces (seulement les dossiers encore existants). Chaque entree: {"path": str, "user": str}. | `Annotation_App/backend/main.py:492` |
| POST | `/api/workspace/open` | Ouvre un dossier dans l'explorateur de fichiers. | `Annotation_App/backend/main.py:340` |
| GET | `/api/workspace/open-cmd` | Renvoie un petit script .cmd qui ouvre le dossier dans l'Explorateur Windows. | `Annotation_App/backend/main.py:459` |
| GET | `/api/workspace/users` | `workspace_users()` | `Annotation_App/backend/main.py:310` |
| GET | `/health` | Vérification de l'état de l'application : - API FastAPI opérationnelle - État du modèle SAM2 (chargé, dispositif, mémoire GPU) | `Annotation_App/backend/main.py:294` |

### Settings

| Method | Path | Summary | Source |
|---|---|---|---|
| GET | `/api/settings` | Retourne les paramètres utilisateur courants. Fusionne avec les valeurs par défaut si des clés sont manquantes. | `Annotation_App/backend/models/routers/settings.py:22` |
| PUT | `/api/settings` | Met à jour les paramètres utilisateur (fusion partielle profonde). Seules les sections envoyées sont mises à jour. | `Annotation_App/backend/models/routers/settings.py:31` |
| POST | `/api/settings/reset` | Remet tous les paramètres aux valeurs par défaut. Écrase le fichier user_settings.json avec les defaults. | `Annotation_App/backend/models/routers/settings.py:43` |
| GET | `/api/workspace/info` | Retourne le chemin du dossier de données du workspace. | `Annotation_App/backend/models/routers/settings.py:52` |
| POST | `/api/workspace/reveal` | Ouvre le dossier workspace dans l'explorateur de fichiers du serveur. Fonctionne sur Windows (Explorer), macOS (Finder), Linux (xdg-open). path optionnel : sous-dossier à ouvrir (relatif à DATA_DIR ou absolu). | `Annotation_App/backend/models/routers/settings.py:58` |

### Stockage

| Method | Path | Summary | Source |
|---|---|---|---|
| DELETE | `/api/storage/backup` | Vide le dossier backup (JSON de sauvegarde d'annotations). | `Annotation_App/backend/models/routers/storage.py:62` |
| DELETE | `/api/storage/exports` | Vide le dossier exports (ZIP YOLO générés). | `Annotation_App/backend/models/routers/storage.py:71` |
| GET | `/api/storage/stats` | Retourne la taille en Mo de chaque dossier du workspace. | `Annotation_App/backend/models/routers/storage.py:47` |

### Tracking

| Method | Path | Summary | Source |
|---|---|---|---|
| POST | `/api/annotations/{annotation_id}/track` | Assigne une track à une annotation (suivi objet / MOT) : - action="new" : crée une nouvelle track (uid incrémental, couleur, classe de l'annotation) et l'assigne ; - action="assign" : assigne une track existante (track_id) ; - action="detach" : détache (track_id = None). Met à jour la plage [start_frame, end_frame] de la track pour inclure la frame. | `Annotation_App/backend/models/routers/tracking.py:344` |
| GET | `/api/homography/status` | Retourne la methode de matching active (xfeat ou sift) et les parametres courants. | `Annotation_App/backend/models/routers/tracking.py:1581` |
| POST | `/api/projects/{project_id}/bytetrack/run` | Lance ByteTrack sur une plage de frames avec les annotations existantes comme détections. Génère des IDs de piste stables et met à jour les annotations en base de données. Exécuté en arrière-plan pour ne pas bloquer l'API. | `Annotation_App/backend/models/routers/tracking.py:728` |
| POST | `/api/projects/{project_id}/guided-tracking/run` | Tracking Guide : selectionner N cibles sur une frame de reference, puis les suivre sur une plage de frames via Grounding DINO ou SAM3 avec matching par distance de centroide. | `Annotation_App/backend/models/routers/tracking.py:1172` |
| GET | `/api/projects/{project_id}/homography/debug` | Retourne les informations de debug de l'homographie entre deux frames : methode utilisee, nb keypoints, matches, inliers, ratio, et visualisation base64. Utile pour evaluer la qualite du matching XFeat / SIFT entre deux frames consecutives. | `Annotation_App/backend/models/routers/tracking.py:2360` |
| POST | `/api/projects/{project_id}/homography/propagate` | Propage des annotations depuis une keyframe vers les frames suivantes en utilisant l'homographie (compensation du mouvement de caméra). Les frames avec faible score homographique sont marquées en orange. | `Annotation_App/backend/models/routers/tracking.py:891` |
| POST | `/api/projects/{project_id}/sam2-tracking/run` | Tracking video SAM2 (style SAMURAI) : - Utilise les boxes annotees sur la frame de reference comme prompts SAM2 - Propage les masques sur les frames suivantes - Cree des annotations bbox ou polygone selon output_mode | `Annotation_App/backend/models/routers/tracking.py:1638` |
| DELETE | `/api/projects/{project_id}/tracks` | Supprime toutes les pistes de tracking d'un projet et detache les annotations associees. | `Annotation_App/backend/models/routers/tracking.py:1597` |
| GET | `/api/projects/{project_id}/tracks` | Liste toutes les pistes de tracking d'un projet (avec segments réels). | `Annotation_App/backend/models/routers/tracking.py:297` |
| POST | `/api/projects/{project_id}/tracks` | Crée une nouvelle piste manuellement. | `Annotation_App/backend/models/routers/tracking.py:317` |
| POST | `/api/projects/{project_id}/tracks/merge` | Fusionne deux pistes en une seule. Toutes les annotations de track_id_merge sont réassignées à track_id_keep. Utile quand un objet est perdu puis réidentifié avec un nouvel ID. | `Annotation_App/backend/models/routers/tracking.py:549` |
| GET | `/api/samurai/status` | Retourne si SAMURAI est disponible comme prédicteur vidéo. SAMURAI = fork de SAM2 avec filtre de Kalman, repo cloné dans backend/ext/samurai_repo/sam2. Installé via : pip install -e backend/ext/samurai_repo/sam2 Détection : présence du dossier ext/samurai_repo + _samurai_loaded=True sur le service. | `Annotation_App/backend/models/routers/tracking.py:2305` |
| GET | `/api/tasks/{task_id}` | Retourne le statut d'une tache en arriere-plan (ByteTrack, propagation, etc.) Statuts possibles : pending \| running \| completed \| error | `Annotation_App/backend/models/routers/tracking.py:597` |
| GET | `/api/tasks/{task_id}/logs` | Retourne les lignes de log de l'algo depuis l'index `since` (incrementiel). Alimente le panneau de logs temps reel du TrackPanel (memes lignes que le terminal serveur). Renvoie {"lines": [...], "next": <index a renvoyer>}. | `Annotation_App/backend/models/routers/tracking.py:610` |
| POST | `/api/tasks/{task_id}/pause` | Met une tache en pause (la boucle de traitement attend la reprise). | `Annotation_App/backend/models/routers/tracking.py:635` |
| POST | `/api/tasks/{task_id}/resume` | Reprend une tache en pause. | `Annotation_App/backend/models/routers/tracking.py:646` |
| POST | `/api/tasks/{task_id}/stop` | Demande l'arret propre d'une tache en cours (verifie le flag a la prochaine iteration). | `Annotation_App/backend/models/routers/tracking.py:624` |
| DELETE | `/api/tracks/{track_id}` | Supprime une piste et toutes ses annotations associées. | `Annotation_App/backend/models/routers/tracking.py:443` |
| PUT | `/api/tracks/{track_id}` | Met à jour les métadonnées d'une piste (classe, couleur, statut). | `Annotation_App/backend/models/routers/tracking.py:411` |
| POST | `/api/tracks/{track_id}/delete-block` | Supprime les annotations d'une piste sur une plage de frames (un 'bloc' de la timeline), sans toucher au reste de la piste. Si la piste devient vide, elle est supprimée aussi. | `Annotation_App/backend/models/routers/tracking.py:484` |
| WS | `/ws/tasks/{task_id}` | Pousse l'etat d'une tache en arriere-plan (statut, progression, current_frame_id, live_frame) au client DES QU'IL CHANGE, sur UNE seule connexion persistante. | `Annotation_App/backend/models/routers/tracking.py:657` |
<!-- generated:end -->
