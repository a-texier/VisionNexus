---
app: annotation
doc_type: code-map
audience: dev
lang: fr
title: Carte du code
order: 80
tags: [navigation dans le code, backend, frontend, extension, débogage]
sources: [Annotation_App/backend/main.py, Annotation_App/backend/database.py, Annotation_App/backend/models, Annotation_App/backend/services, Annotation_App/backend/utils, Annotation_App/frontend/src/App.tsx, Annotation_App/frontend/src/pages/AnnotationPage.tsx, Annotation_App/frontend/src/stores, Annotation_App/frontend/src/services/api.ts, Annotation_App/frontend/src/components]
---

# Carte du code

## Par où commencer la lecture du code backend

Le backend d'Annotation App se trouve dans `Annotation_App/backend/`. Lisez ces fichiers dans cet ordre pour le comprendre :

1. `main.py` : le point d'entrée. Le lifespan relève la limite du threadpool, crée les tables, exécute `_run_migrations()` et charge SAM2 ; les routers y sont montés ; les endpoints de niveau application (`/health`, `/api/capabilities`, `/api/app-mode`, utilitaires de workspace, monitoring) y sont définis.
2. `config.py` : le workspace (`ANNOTATION_WORKSPACE`), le chemin de la base, le fichier de réglages, les ports et les origines CORS.
3. `database.py` : le moteur SQLAlchemy (WAL, clés étrangères, attente de verrou, dimensionnement du pool) et `get_session()`, injecté dans chaque route.
4. `models/*.py` : les tables SQLModel `Project`, `Sequence`, `Frame`, `Annotation`, `Track`, `LabelClass`, `SessionState`.
5. `models/routers/*.py` : les gestionnaires HTTP, un fichier par domaine (`projects`, `dataset`, `annotation`, `sam`, `tracking`, `export`, `orchestrator`, `samples`, `settings`, `storage`, `convert`, `docs`).
6. `services/*.py` : logique métier et singletons des modèles (`sam_service`, `grounding_service`, `sam3_service`, `homography_service`, `dataset_service`, `task_registry`, `settings_service`, `monitoring_service`...).
7. `utils/` : `image_utils.py` (LUT, conversion 8 bits, masque vers polygone, caches), `native_share.py` (chemin serveur vers UNC et retour), `format specialise.py` (adaptateur de format optionnel), `yolo_utils.py`, `color_utils.py`.

Autres dossiers : `checkpoints/` (poids des modèles), `ext/samurai_repo/` (fork SAMURAI), `models/xfeat/` (XFeat), `tests/` (tests unitaires, d'API et d'intégration, scripts de téléchargement des modèles). `tasks/` contient des définitions de tâches Celery qui ne sont pas branchées dans l'application en fonctionnement.

Les plus gros fichiers sont `models/routers/dataset.py` et `models/routers/tracking.py` (plus de 2000 lignes chacun) : cherchez-y par chemin d'endpoint plutôt que de les lire linéairement.

## Par où commencer la lecture du code frontend

Le frontend d'Annotation App se trouve dans `Annotation_App/frontend/src/`. Lisez ces fichiers dans cet ordre :

1. `App.tsx` : les routes (`/`, `/projects/:projectId/annotate`, `/presentation`, `/convert`, `/monitoring`) et l'initialisation de la langue.
2. `pages/AnnotationPage.tsx` : le fichier central (environ 2600 lignes). Il orchestre la barre d'outils, le canvas, les barres latérales, la timeline, les fenêtres, la détection par texte et SAM Auto, la navigation entre frames, l'affichage live des propagations et les barres de progression.
3. `stores/annotationStore.ts` : annotations de la frame courante, outil, classe, sélection, cibles de suivi partagées, annuler/rétablir, presse-papier. `loadAnnotations(frameId, annotations)` prend l'identifiant de frame en premier.
4. `services/api.ts` : tous les appels HTTP, en espaces de noms typés ; `types/api.ts` contient les équivalents TypeScript des schémas du backend.
5. `components/canvas/AnnotationCanvas.tsx` : la scène Konva, les outils de tracé, les points SAM, la conversion de coordonnées avec `stageToImageNormalized()`.
6. `components/sidebar/TrackPanel.tsx` : le panneau Tracks (SAMURAI, Detect., Homogr., Flux opt., logs et liste des pistes).

Autres points d'entrée : `pages/ProjectsPage.tsx` (accueil), `pages/PresentationPage.tsx` avec `components/docs/` (documentation intégrée), `components/timeline/Timeline.tsx` et `TrackLane.tsx`, `components/modals/` (import, export, paramètres, aide, navigateur de fichiers, création de projet), `components/sidebar/` (panneau de droite, classes, liste d'annotations, aide), `components/panels/LutPanel.tsx`, `services/websocket.ts` (client WebSocket et broker de tâches), `hooks/` (raccourcis clavier, sauvegarde automatique, suivi des exports). `components/panels/FramesPanel.tsx` et `components/sidebar/GlobalAnnotationsPanel.tsx` ne sont pas utilisés par les pages actuelles.

## Où modifier les outils d'annotation et le canvas

Les modifications du tracé, de la sélection et de l'affichage des annotations touchent ces fichiers :

| Pour modifier | Éditer |
|---|---|
| Liste des outils et boutons de la barre d'outils | `TOOLS` et l'en-tête de `pages/AnnotationPage.tsx` |
| Raccourcis clavier | `hooks/useKeyboardShortcuts.ts` (et les textes d'aide de `components/help/helpContent.ts`) ; la liste des classes des touches chiffres est passée par `useKeyboardShortcuts(...)` dans `pages/AnnotationPage.tsx`, actuellement avec `undefined` |
| Gestion de la souris, tracé, points SAM, zoom et déplacement | `components/canvas/AnnotationCanvas.tsx` |
| Rendu des boîtes, poignées, double-clic pour basculer une cible de suivi | `components/canvas/BBoxShape.tsx` |
| Coordonnées pixels et normalisées | `utils/coordinates.ts` |
| Liste d'annotations, filtres, NMS, propositions SAM Auto, sélecteur de piste | `components/sidebar/AnnotationList.tsx` |
| Classes et hiérarchie | `components/sidebar/LabelManager.tsx`, backend `models/label_class.py` et `routers/projects.py` |
| Annuler / rétablir | `stores/annotationStore.ts` (par frame), `stores/bulkUndoStore.ts` (suppressions depuis la timeline) |
| Cellules de la timeline et pistes | `components/timeline/Timeline.tsx`, `components/timeline/TrackLane.tsx` |

Ajouter un type d'annotation exige : étendre `AnnotationType` dans `frontend/src/types/api.ts`, mettre à jour la validation dans `backend/models/annotation.py`, le dessiner dans `AnnotationCanvas.tsx`, et le traiter dans les écrivains d'export de `backend/services/dataset_service.py` et `routers/export.py`.

Gardez les coordonnées normalisées dans `[0, 1]` à chaque frontière : convertissez dans le canvas, ne stockez jamais de pixels.

## Où modifier un algorithme de suivi ou de propagation

Chaque mode de propagation a un endpoint dans `backend/models/routers/tracking.py`, un service, et un onglet dans `frontend/src/components/sidebar/TrackPanel.tsx`.

| Mode | Gestionnaire d'endpoint | Service | Frontend |
|---|---|---|---|
| SAMURAI / SAM2 vidéo | `run_sam2_tracking` (`/sam2-tracking/run`) | `sam_service.py` (`configure_video_tracking`, sessions vidéo) | Onglet SAMURAI, `handleRunSam2Tracking` |
| Detect. (tracking guidé) | `/guided-tracking/run`, `_greedy_match`, `_centroid_dist_yolo`, `_size_variation` | `grounding_service.py`, `sam3_service.py` | Onglet Detect., `handleRunGuidedTracking` |
| Homographie | `propagate_homography` (`/homography/propagate`, `use_optical_flow=false`) | `homography_service.compute_homography`, `warp_bbox_yolo` | Onglet Homogr., `handleRunXFeat` |
| Flux optique | même endpoint avec `use_optical_flow=true` | `homography_service.track_bboxes_optical_flow` | Onglet Flux opt., `handleRunOptflow` |
| Debug d'homographie | `/homography/debug` | `compute_homography_debug` | `components/sidebar/XFeatDebugPanel.tsx` |

Les paramètres de SAMURAI (taille de mémoire, poids du Kalman, seuils) viennent des fichiers de configuration de `backend/ext/samurai_repo/sam2/sam2/configs/samurai/` ; le modèle est choisi dans `sam_service.py` (`MODEL_CONFIGS`, `SAMURAI_CONFIGS`). Les valeurs par défaut affichées dans l'interface viennent de `DEFAULT_SETTINGS` dans `backend/services/settings_service.py`.

L'affichage live pendant un passage implique `task_registry.py` (file, logs), le gestionnaire WebSocket de `tracking.py`, `subscribeTaskProgress` dans `services/websocket.ts`, et `handleLiveFramePreview` dans `AnnotationPage.tsx`. Respectez les invariants listés dans [Architecture](architecture.fr.md) : une socket par tâche, la WebSocket comme unique source d'annotations pendant un passage, des vérifications d'arrêt dans chaque boucle.

## Où ajouter un nouvel algorithme

Un nouvel algorithme (un détecteur, une méthode de propagation) suit le même schéma que les existants : un service singleton côté backend, un endpoint, une fonction client typée et une commande dans l'interface.

1. **Service** : créez `backend/services/my_algo_service.py` avec une classe exposant `load()`, `is_available()` et une méthode de prédiction qui renvoie des boîtes normalisées (`cx`, `cy`, `w`, `h`, `confidence`, classe), et une instance singleton au niveau du module. Chargez les modèles lourds à la demande ou dans le lifespan de `main.py`.
2. **Endpoint** : ajoutez une route au router du bon domaine dans `backend/models/routers/` (ou un nouveau router monté dans `main.py`). Récupérez la frame avec la session injectée, lisez son image avec `load_image_bgr_8bit(path, lut)` pour que la LUT d'affichage s'applique, levez `HTTPException(503)` quand le service est indisponible, et enregistrez des lignes `Annotation` en coordonnées normalisées, avec `is_auto=True` et une nouvelle valeur de `source_algorithm`. Ajoutez cette valeur à `AUTO_SOURCES` dans `services/monitoring_service.py` pour que la page Monitoring la nomme.
3. **Passages longs** : pour une propagation sur de nombreuses frames, créez une tâche avec `task_registry.create_task`, exécutez une fonction synchrone en fond, appelez `update_task(..., current_frame_id=...)` à chaque frame, `append_log()` pour la vue Logs, vérifiez `is_stop_requested()` dans la boucle, positionnez `frame.is_annotated`, et renvoyez tout de suite le `task_id`. Poussez des aperçus par frame dans la file live si le canvas doit suivre.
4. **Client** : ajoutez une fonction au bon espace de noms de `frontend/src/services/api.ts` et ses types dans `frontend/src/types/api.ts`. L'intercepteur axios affiche déjà les toasts d'erreur.
5. **Interface** : ajoutez la commande (un bouton de barre d'outils dans `AnnotationPage.tsx`, ou un onglet dans `TrackPanel.tsx`). Après l'enregistrement, rechargez les annotations de la frame avec `loadAnnotations(frameId, annotations)` ; pour les tâches, abonnez-vous avec `subscribeTaskProgress(taskId, ...)`.
6. **Textes** : enveloppez les chaînes françaises avec `t()` et ajoutez la traduction anglaise dans `EXACT_EN` de `frontend/src/i18n/translate.ts`.

## Où ajouter un réglage

Un réglage utilisateur vit à quatre endroits, dans cet ordre :

1. `backend/services/settings_service.py` : ajoutez la clé et sa valeur par défaut au bon groupe de `DEFAULT_SETTINGS` (`interface`, `paths`, `import`, `algorithms`, `export`). Les fichiers enregistrés sont fusionnés en profondeur avec les valeurs par défaut : les utilisateurs existants reçoivent automatiquement la nouvelle clé. Si une valeur par défaut existante change de sens, incrémentez `SETTINGS_SCHEMA_VERSION` et ajoutez une migration unique dans `_migrate()`.
2. `frontend/src/types/api.ts` : ajoutez le champ à l'interface correspondante (par exemple `UserSettingsAlgorithms`).
3. `frontend/src/components/modals/SettingsModal.tsx` : ajoutez la commande dans la bonne section, avec un libellé français enveloppé dans `t()` et sa traduction anglaise dans `i18n/translate.ts`.
4. Le composant ou l'endpoint qui l'utilise. Les réglages se chargent de façon asynchrone : initialisez l'état local avec une valeur de repli et resynchronisez-le quand ils arrivent.

```ts
const algoLoaded = useSettingsStore((s) => s.loaded)
const algoSettings = useSettingsStore((s) => s.settings?.algorithms)
const [boxThr, setBoxThr] = useState(algoSettings?.grounding_dino_box_threshold ?? 0.3)

useEffect(() => {
  if (!algoLoaded || !algoSettings) return
  setBoxThr(algoSettings.grounding_dino_box_threshold)
}, [algoLoaded]) // eslint-disable-line
```

Le code backend lit les réglages avec `settings_service.load()` au moment de l'usage : les changements s'appliquent sans redémarrage. Documentez la nouvelle option dans [Configuration](configuration.fr.md).

## Où modifier l'import, l'export et les formats de fichiers

Le code d'import et d'export est réparti entre les routers du dataset et de l'export et leurs services.

| Pour modifier | Éditer |
|---|---|
| Fenêtre d'import, emplacements, options | `frontend/src/components/modals/ImportModal.tsx`, file dans `stores/importStore.ts` |
| Endpoints d'import de dossiers, images, vidéos et création des séquences | `backend/models/routers/dataset.py` (`import_*`, `_seq_prefix`) |
| Extraction des frames, parcours des dossiers | `backend/services/dataset_service.py` |
| Import d'annotations existantes (`.ver`, YOLO) | `backend/services/annotation_import_service.py`, `dataset.py` (`import-annotations`) |
| Formats de séquence optionnels | un nouveau module adaptateur dans `backend/utils/` exposant une constante littérale `FORMAT_CAPABILITY`, découvert par `backend/services/format_registry.py` (voir `utils/format specialise.py`) |
| Fenêtre d'export | `frontend/src/components/modals/ExportModal.tsx` |
| Tâche d'export, écriture `.ver`, organisation par séquence | `backend/models/routers/export.py` |
| Écrivains YOLO et COCO | `backend/services/dataset_service.py` (organisation du dataset YOLO, `export_coco_dataset`) et `backend/utils/yolo_utils.py` (`write_yolo_label_file`, `write_yolo_segmentation_label_file`, `write_data_yaml`) |
| Conversions autonomes | `backend/services/convert_service.py`, `routers/convert.py`, `pages/ConvertPage.tsx` |
| Contrat avec l'Orchestrator | `backend/models/routers/orchestrator.py` |
| Sauvegarde, restauration, manifeste de séquences | `routers/projects.py` (`backup`, `backup/save`, `restore`), `routers/dataset.py` (`parse-manifest`), `hooks/useAutoSave.ts` |

Pour ajouter un format d'export, ajoutez sa valeur à `output_format`, écrivez-le par séquence comme les existants, enregistrez `last_export_format`, et ajoutez un bouton dans `ExportModal.tsx`.

## Où modifier le chargement des images et les caches

Le service et le cache des images sont critiques pour les performances, surtout en SSH ; lisez les sections correspondantes d'[Architecture](architecture.fr.md) avant de les modifier.

| Pour modifier | Éditer |
|---|---|
| Niveaux d'image (480 / 1600 / pleine), images de remplacement, en-têtes de cache | `serve_frame_image`, `_ensure_preview_cached`, `_serve_preview` dans `backend/models/routers/dataset.py` |
| Chemin natif pour la coquille Electron | `/api/frames/{id}/image-path` dans `dataset.py`, `backend/utils/native_share.py` |
| Calcul de la LUT, conversion 8 bits, signatures et purge des caches | `backend/utils/image_utils.py` (`apply_lut`, `lut_signature`, `purge_stale_lut_caches`, `load_image_bgr_8bit`, `ensure_8bit_cached`) |
| Cache des histogrammes | `_HIST_CACHE` dans `dataset.py` |
| Panneau LUT | `frontend/src/components/panels/LutPanel.tsx` |
| Navigation entre frames, préchargement, cadence du défilement, LRU des annotations | `pages/AnnotationPage.tsx` (`handleFrameSelect`, `annotationsCacheRef`, `liveFrameImageUrl`) |
| Pagination de la liste des frames | `stores/projectStore.ts` (`fetchFrames`) |
| Pool de la base, threadpool | `backend/database.py`, lifespan de `backend/main.py` |
| Proxy Vite | `frontend/vite.config.ts` |

Gardez les règles : jamais de préchargement pendant le défilement ou la propagation, conserver le repli HTTP des lectures natives, garder le pool SQL au-dessus du threadpool, et faire passer chaque entrée de modèle par la LUT effective.

## Où modifier l'aide, le tutoriel et les traductions

L'aide intégrée et le tutoriel sont du code, séparé de cette documentation.

- `frontend/src/components/help/helpContent.ts` : la source unique de l'onglet **Aide** et de la fenêtre d'aide (raccourcis, modes, fonctions, modèles, workflow). Mettez-la à jour quand les raccourcis ou les modes changent, avec `hooks/useKeyboardShortcuts.ts`.
- `frontend/src/components/sidebar/HelpPanel.tsx` et `components/modals/HelpModal.tsx` : leur mise en page.
- `frontend/src/components/help/annotationTourSteps.ts` : le script du tutoriel interactif (projets de démonstration, étapes, cibles). Les étapes désignent des éléments par des attributs `data-tour` ; conservez ces attributs lors des refontes de composants. Le moteur de visite générique est dans `components/tour/`, l'état « déjà vu » dans `utils/tutorialState.ts` (stocké par VisionNexus, avec un repli dans les réglages).
- `frontend/src/i18n/translate.ts` : le français est la langue source dans le code ; `t('texte')` consulte `EXACT_EN` pour l'anglais. La langue vient du paramètre `?lang=` fourni par VisionNexus, sinon d'une préférence locale, sinon l'anglais. Chaque nouvelle chaîne visible a besoin d'une entrée.
- Documentation produit : `Annotation_App/docs/` (ce jeu de pages), servie par `backend/models/routers/docs.py` (`/api/docs`) à `pages/PresentationPage.tsx`, qui la rend avec `components/docs/MarkdownDoc.tsx` et `markdown.ts` (ancres de titres `h-<n>`, liens entre pages). Rédigez-la selon `tools/docs/DOC_STYLE.md` et vérifiez-la avec `python tools/docs/lint_docs.py --app annotation`.

## Outils de débogage : base, réseau et état

Outils utiles pour inspecter une Annotation App en fonctionnement :

**État du backend** : `curl http://localhost:8000/health`, `/api/sam/ping`, `/api/sam/grounding/status`, `/api/sam3/status`, `/api/samurai/status`, `/api/homography/status`. L'interface Swagger sur `/docs` appelle n'importe quel endpoint. Lancez le lanceur avec `--access-log` pour afficher chaque requête.

**Base de données** : ouvrez `<workspace>/annotation.db` avec `sqlite3` ou DB Browser for SQLite (en lecture seule tant que l'application tourne, c'est plus sûr) :

```sql
.tables
SELECT id, name, project_type, frame_count FROM project;
SELECT id, name, start_index, frame_count FROM sequence WHERE project_id = 1;
SELECT COUNT(*) FROM annotation WHERE frame_id = 42;
SELECT source_algorithm, COUNT(*) FROM annotation GROUP BY source_algorithm;
```

**Fichiers** : listez `projects/<id>/frames/` pour vérifier que les frames existent et que les liens symboliques ne sont pas cassés (`ls -la`) ; les dossiers de cache peuvent être supprimés sans risque.

**Tâches** : la vue **Logs** du panneau Tracks affiche le journal de la tâche ; `GET /api/tasks/{id}` et `/logs?since=0` donnent la même information en HTTP.

**Frontend** : outils de développement du navigateur (`F12`), onglet **Network** filtré sur `api` pour le HTTP et `WS` pour les messages WebSocket (regardez `live_frames` pendant un passage). Lisez un store avec un `console.log(useAnnotationStore.getState())` temporaire, ou l'extension Zustand devtools. Vérifiez le TypeScript avec `npx tsc --noEmit` et construisez avec `npm run build` dans `frontend/`.

Signaux courants : un 503 sur `/api/sam/...` signale un checkpoint manquant ; des annotations qui fuient d'un projet à l'autre signalent un `clearAnnotations()` oublié ; des réglages ignorés au démarrage signalent l'absence du schéma de resynchronisation asynchrone ; une `UnicodeEncodeError` au démarrage signale un caractère non encodable dans un `print` du backend. D'autres cas sont dans [Dépannage](troubleshooting.fr.md).

## Carte des modules

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
