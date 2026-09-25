// ============================================================
// types/api.ts
// Définitions TypeScript strictes pour toutes les réponses de l'API.
// Aucun usage de `any` — tous les types doivent être explicites.
// ============================================================

// ---- Projets ----

export type ProjectType = 'image' | 'video'

export interface SpecificFormatCapability {
  id: string
  label: string
  extensions: string[]
  kind: 'sequence'
  supports_upload: boolean
  supports_server_path: boolean
}

export interface ProjectSequenceSummary {
  id: number
  name: string
  source_type: string
  start_index: number
  frame_count: number
  annotated_frames: number
  annotation_count: number
}

export interface Project {
  id: number
  name: string
  description: string | null
  project_type: ProjectType
  source_path: string | null
  // Projet demo cree par le tutoriel interactif (affiche en orange).
  is_template?: boolean
  frame_count: number
  annotated_count: number
  created_at: string
  updated_at: string
  // Résumé des séquences (multi-séquence) — page d'accueil
  sequences?: ProjectSequenceSummary[]
}

export interface SessionState {
  current_frame_index: number
  zoom_level: number
  canvas_offset_x: number
  canvas_offset_y: number
  selected_class_id: number | null
  selected_tool: ToolType
  timeline_filter: TimelineFilter
  undo_stack_snapshot: string | null
  last_saved: string | null
}

export interface ProjectDetail extends Project {
  classes: LabelClass[]
  session: SessionState | null
}

// ---- Frames ----

export interface Frame {
  id: number
  project_id: number
  frame_index: number
  filename: string
  image_url: string | null
  width: number
  height: number
  timestamp_ms: number | null
  is_keyframe: boolean
  is_annotated: boolean
  is_empty: boolean
  propagation_confidence: number | null
  is_extracted: boolean        // True = fichier physique présent sur disque
  annotation_count?: number  // Retourné par list_frames uniquement
}

export interface FrameDetail extends Frame {
  image_url: string
  annotations: Annotation[]
}

// ---- Séquences (multi-séquence) ----

export interface Sequence {
  id: number | null               // null = frames legacy (avant multi-séquence)
  project_id: number
  name: string
  source_type: string
  source_path: string | null
  start_index: number             // frame_index global de la 1re frame
  frame_count: number
  fps: number | null
  created_at: string | null
  annotated_frames: number
  annotation_count: number
  lut?: {
    mode: 'sigma' | 'minmax' | 'manual'
    sigma: number
    lo: number | null
    hi: number | null
  } | null                          // LUT propre à la séquence (null = repli projet)
}

// ---- Annotations ----

export type AnnotationType = 'bbox' | 'polygon'

// Algorithme ayant généré l'annotation (null = manuel)
export type SourceAlgorithm = 'manual' | 'sam_point' | 'sam_auto' | 'grounding_dino' | 'sam3' | 'samurai' | 'sam2_video' | 'bytetrack' | 'yolo' | 'interpolation' | 'guided_tracking' | 'resnet_tracking' | 'sam2_tracking' | 'homography' | 'optical_flow' | null

export interface Annotation {
  id: number
  frame_id: number
  track_id: number | null
  class_id: number
  annotation_type: AnnotationType
  cx: number    // Centre X normalisé [0, 1]
  cy: number    // Centre Y normalisé [0, 1]
  width: number // Largeur normalisée [0, 1]
  height: number // Hauteur normalisée [0, 1]
  points: [number, number][] | null  // Polygone normalisé
  confidence: number  // [0, 1]
  is_auto: boolean
  is_interpolated: boolean
  source_algorithm: SourceAlgorithm  // Algorithme source
  created_at: string
}

export interface AnnotationCreate {
  class_id: number
  annotation_type?: AnnotationType
  cx: number
  cy: number
  width: number
  height: number
  points?: [number, number][] | null
  track_id?: number | null
  confidence?: number
  is_auto?: boolean
  is_interpolated?: boolean
  source_algorithm?: SourceAlgorithm
}

export interface AnnotationUpdate {
  class_id?: number
  cx?: number
  cy?: number
  width?: number
  height?: number
  points?: [number, number][] | null
  track_id?: number | null
  confidence?: number
}

// ---- Classes d'objets ----

export interface LabelClass {
  id: number
  project_id: number
  name: string                    // Classe (détection) — obligatoire
  color: string   // Hexadécimal, ex: "#3B82F6"
  class_index: number
  supercategory: string | null
  subclass?: string | null        // Sous-classe (reconnaissance)
  subsubclass?: string | null     // Sous-sous-classe (identification)
  shortcut_key: string | null
}

export interface LabelClassCreate {
  name: string
  color?: string
  supercategory?: string | null
  subclass?: string | null
  subsubclass?: string | null
  shortcut_key?: string | null
}

// ---- Pistes de tracking ----

export interface Track {
  id: number
  project_id: number
  sequence_id: number | null   // séquence propriétaire (décorrélation S2b/c)
  track_uid: number
  class_id: number
  color: string
  start_frame: number   // début de la plage EXPLORÉE (tracker lancé)
  end_frame: number     // fin de la plage explorée
  is_active: boolean
  interpolated_frames: number
  // Blocs RÉELS où l'objet a été trouvé (annotation présente), bornes incluses.
  // Plusieurs segments possibles ; les trous dans [start,end] = exploré mais rien vu.
  // Absent sur d'anciennes réponses → traiter comme [[start_frame, end_frame]].
  segments?: [number, number][]
}

// ---- SAM2 ----

export interface SAMMask {
  bbox_yolo: [number, number, number, number]  // [cx, cy, w, h]
  bbox_pixel: [number, number, number, number] // [x1, y1, x2, y2]
  polygon: [number, number][]
  score: number
  area: number
  index?: number  // Indice dans la liste des masques streamés
}

export interface SAMPoint {
  x: number   // [0, 1]
  y: number   // [0, 1]
  label: 0 | 1  // 0=background, 1=foreground
}

export interface SAMParams {
  points_per_side?: number
  pred_iou_thresh?: number
  stability_score_thresh?: number
  min_mask_area?: number
  box_nms_thresh?: number
}

// ---- Export ----

export interface ExportTask {
  task_id: string
  status: 'pending' | 'running' | 'completed' | 'error'
  progress: number
  error: string | null
  ready: boolean
  zip_path?: string | null
  folder_path?: string | null
}

// ---- Statistiques ----

export interface ProjectStats {
  total_frames: number
  annotated_frames: number
  annotation_rate: number
  classes_distribution: Array<{
    class_id: number
    class_name: string
    color: string
    count: number
  }>
}

export interface OverlapPair {
  ann_id_1: number
  ann_id_2: number
  iou: number
  class_id_1: number
  class_id_2: number
  same_class: boolean
}

// ---- Canvas & UI ----

export type ToolType =
  | 'select'
  | 'bbox'
  | 'polygon'
  | 'sam_point'
  | 'sam_auto'
  | 'pan'

export type TimelineFilter = 'all' | 'unannotated' | 'flagged'

export interface Point {
  x: number
  y: number
}

// Coordonnées pixel d'une boîte (non normalisées)
export interface PixelBBox {
  x: number       // Coin supérieur gauche
  y: number       // Coin supérieur gauche
  width: number
  height: number
}

// Snapshot pour le système undo/redo
export interface AnnotationSnapshot {
  frameId: number
  annotations: Annotation[]
  timestamp: number
  action: string   // Description lisible : "Ajout bbox", "Suppression", etc.
}

// État du dessin en cours sur le canvas
export interface DrawingState {
  tool: ToolType
  startPoint: Point
  currentPoint: Point
  points: Point[]  // Pour le polygone
}

// Message WebSocket SAM2 image
export type WSSAMImageMessage =
  | { type: 'mask_result'; index: number; mask: SAMMask }
  | { type: 'complete'; total_masks: number }
  | { type: 'error'; message: string }
  | { type: 'pong' }

// Message WebSocket SAM2 vidéo
export type WSSAMVideoMessage =
  | { type: 'session_ready'; session_id: string }
  | { type: 'prompt_result'; object_id: number; mask: Pick<SAMMask, 'bbox_yolo' | 'polygon' | 'score'> }
  | { type: 'propagation_frame'; frame_index: number; progress: number; objects: Record<string, Pick<SAMMask, 'bbox_yolo' | 'polygon' | 'score'>> }
  | { type: 'propagation_complete'; total_frames: number }
  | { type: 'session_closed' }
  | { type: 'error'; message: string }
  | { type: 'pong' }

// Message WebSocket de progression de tache (/ws/tasks/{id}) — remplace le
// polling HTTP repete de GET /api/tasks/{id} par une seule connexion poussee.
export interface TaskLiveFrameObject {
  class_id: number
  bbox: [number, number, number, number]   // [cx, cy, w, h] normalisé YOLO
  polygon: [number, number][] | null
  score: number
}
export type TaskWSMessage =
  | {
      type: 'update'
      status: string
      progress: number
      message: string
      error: string | null
      current_frame_id: number | null
      live_frame: { frame_id: number; native_path?: string | null;
                    objects: TaskLiveFrameObject[] } | null
      // Toutes les frames propagees depuis le message precedent (le champ
      // live_frame ci-dessus n'en porte qu'une seule, la derniere).
      live_frames?: { frame_id: number; native_path?: string | null;
                      objects: TaskLiveFrameObject[] }[]
    }
  | { type: 'not_found' }

// ---- Grounding DINO (texte → boîtes → masques) ----

export interface GroundingDetection {
  bbox_yolo: [number, number, number, number]  // [cx, cy, w, h] normalisé
  bbox_pixel: [number, number, number, number] // [x1, y1, x2, y2]
  polygon: [number, number][]
  label: string
  score: number
}

export interface TextPredictResponse {
  detections: GroundingDetection[]
  grounding_available: boolean
  sam_used: boolean
  count: number
}

export interface GroundingStatus {
  available: boolean
  loaded: boolean
  model: string | null
  device: string
}

// ---- Résumé global des annotations (multi-frames) ----

export interface AnnotationSummaryItem {
  annotation_id: number
  frame_id: number
  frame_index: number
  class_id: number
  class_name: string
  annotation_type: AnnotationType
  confidence: number
  is_auto: boolean
  is_interpolated: boolean
  source_algorithm: SourceAlgorithm
  cx: number
  cy: number
  width: number
  height: number
}

// ---- SAM3 ----

export interface SAM3Status {
  installed: boolean
  checkpoint_exists: boolean
  loaded: boolean
  device: string
}

// Notification toast
export interface AppNotification {
  id: string
  type: 'success' | 'error' | 'warning' | 'info'
  message: string
  duration?: number
}

// ---- Paramètres utilisateur ----

export interface UserSettingsInterface {
  background_color: string          // Couleur de fond canvas (hex)
  default_tool: string              // Outil actif au démarrage
  tracks_panel_height: number       // Hauteur zone tracks (redimensionnable) en px
  annotation_opacity: number        // Opacité annotations [0,1]
  show_labels: boolean              // Afficher étiquettes de classe sur les annotations
  show_confidence: boolean          // Afficher score de confiance sur les annotations
  annotation_border_width: number   // Épaisseur bordures annotations (1-4 px)
  preview_downscale_enabled: boolean  // Réduction 480/1600px des images servies (scrub/zoom)
  realtime_live_enabled: boolean    // Live temps réel par défaut, ON par défaut
  // Cadence minimale entre deux sauts du canvas pendant une propagation (ms).
  // N'affecte QUE l'image : timeline et annotations d'apercu suivent chaque frame.
  propagation_nav_throttle_ms: number
}

export interface UserSettingsImport {
  jpeg_quality: number              // Qualité JPEG miniatures/frames (50–95)
  chunk_size_mb: number             // Taille chunk upload vidéo (MB)
  frame_keep: number                // 0=tout, 2=1/2, 3=1/3... (décimation frames)
  batch_size_images: number         // Nb images par batch upload
}

export interface UserSettingsAlgorithms {
  nms_iou_threshold: number
  grounding_dino_box_threshold: number
  grounding_dino_text_threshold: number
  // Valeur de départ du sélecteur BBox / Seg de la barre d'outils (true = Seg).
  // Pour GD, « Seg » implique le raffinement SAM2, seul chemin qui produit un contour.
  grounding_dino_use_sam_refine: boolean
  sam_points_per_side: number
  sam_pred_iou_thresh: number
  sam_stability_score_thresh: number
  xfeat_top_k: number
  xfeat_min_cossim: number
  ransac_threshold: number
  min_inlier_count: number
  min_inlier_ratio: number
  optflow_win_size: number
  optflow_max_level: number
  optflow_min_pts: number
  sam3_box_threshold: number
  sam3_text_threshold: number
  guided_max_centroid_dist: number
  guided_size_variation: number
  // Critère de correspondance par défaut pour le tracking
  tracking_match_criterion: 'geometric' | 'appearance'
  // SAMURAI/SAM2 vidéo : offload des frames sur le CPU (VRAM mini) vs GPU (rapide)
  sam2_offload_video_to_cpu: boolean
  // Auto-stop
  auto_stop_enabled: boolean
  auto_stop_lost_ratio: number
  auto_stop_consecutive_frames: number
}

export interface UserSettingsExport {
  train_ratio: number
  val_ratio: number
  test_ratio: number
  include_unannotated: boolean
  symlink_images: boolean               // True = liens symboliques (dataset local, pas de ZIP)
}

// Repli de l'etat du tutoriel quand le pont VisionNexus est absent
// (cf. utils/tutorialState.ts) : la source de verite reste le lanceur.
export interface UserSettingsTutorial {
  launched_once: boolean            // Bouton Tutoriel deja clique (halo orange eteint)
  completed: boolean                // Tour mene jusqu'a la derniere etape
}

export interface UserSettingsPaths {
  native_share_host: string                     // hôte partage réseau natif pour mapper les chemins Linux (S8)
  shared_roots: string[]
}

export interface UserSettings {
  interface: UserSettingsInterface
  import: UserSettingsImport
  algorithms: UserSettingsAlgorithms
  export: UserSettingsExport
  paths: UserSettingsPaths
  tutorial: UserSettingsTutorial
}
