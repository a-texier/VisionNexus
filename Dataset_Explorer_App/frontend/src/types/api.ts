// ============================================================
// types/api.ts
// Interfaces TypeScript pour toutes les réponses API.
// ============================================================

export interface DatasetSummary {
  id: number
  name: string
  root_path: string
  image_count: number
  embedded_count: number
  status: 'scanning' | 'pending' | 'embedding' | 'ready' | 'error'
  error_message: string | null   // detail reel si status === 'error' (permission refusee, chemin...)
  umap_cached: boolean
  n_clusters: number
  is_global: boolean
  in_workspace: boolean   // false = dataset global visible depuis le registre, pas encore dans ce workspace
  created_at: string
  updated_at: string
  rejected_count: number
  map_needs_rebuild: boolean    // images rejetées encore dans UMAP → rebuild needed
  map_method_outdated: boolean  // params réduction changés depuis le build → re-embed needed
  gallery_thumb_urls: string[]  // miniatures fixes gallery (toujours accessibles, même hors workspace)
  registry_stats: {             // stats légères stockées dans registry (pour non-workspace globals)
    avg_width?: number
    avg_height?: number
    format_distribution?: Record<string, number>
  } | null
  scan_progress: number   // images scannées (0 hors état scanning)
  scan_total: number      // total images à scanner
  added_by: string | null

  // Progression du pipeline d'embedding (background task — poll, robuste SSH)
  embed_progress: number
  embed_total: number
  embed_phase: string     // '' | embedding | indexing | umap | clustering | scoring

  // Progression des thumbnails asynchrones
  thumb_progress: number
  thumb_total: number

  // Progression du reclustering
  recluster_progress: number
  recluster_total: number
  recluster_phase: string

  // Progression de la réduction dimensionnelle (relance UMAP/t-SNE/PCA)
  reduce_progress: number
  reduce_total: number
  reduce_phase: string

  // Config de clustering effectivement appliquée
  cluster_method: string | null           // kmeans | hdbscan
  cluster_params: Record<string, number>  // ex : { n_clusters: 20 } ou { min_cluster_size: 5 }

  // Config de réduction 2D effectivement appliquée
  reduction_method: string | null         // umap | tsne | pca
  reduction_params: Record<string, number> // ex : { n_neighbors: 15, min_dist: 0.1 }

  // Dossier (step 3)
  folder_id: number | null

  // Métadonnées tabulaires liées (CSV/Excel)
  metadata_columns: string[]
  metadata_key_column: string | null

  // Annotation (step 6)
  has_annotations: boolean
  annotation_name: string | null
  annotation_format: string | null   // ver | yolo_folder | yolo_txt
  annotation_frames: number | null
  annotation_boxes: number | null

  // Doublons — autres datasets pointant sur le même root_path sous un autre nom
  duplicate_of: { id: number; name: string }[]
}

// ---- Filtrage CLIP par mot-clé (refonte step 4) ----
export interface FilterTopImage {
  image_id: number
  score: number
}

export interface FilterDatasetResult {
  dataset_id: number
  name: string
  root_path: string
  matched_count: number
  total_count: number
  percent: number
  top_images: FilterTopImage[]
}

export interface FilterByTextResponse {
  terms: string[]
  threshold?: number
  mode?: 'union' | 'intersection'
  results: FilterDatasetResult[]
}

// ---- Dossiers (step 3) ----
export interface Folder {
  id: number
  name: string
  parent_id: number | null
  is_global: boolean
  uid: string | null
  added_by: string | null
  dataset_count: number
}

export interface DatasetStats {
  image_count: number
  avg_width: number
  avg_height: number
  min_width: number
  max_width: number
  min_height: number
  max_height: number
  format_distribution: Record<string, number>
  color_modes: Record<string, number>
  avg_file_size_bytes: number
  total_size_bytes: number
  thumbnails: { url: string; filename: string; width: number; height: number }[]
}

export interface DatasetDetail extends DatasetSummary {
  cluster_distribution: { cluster_id: number; count: number }[]
  duplicate_count: number
  rejected_count: number
  map_needs_rebuild: boolean
}

export interface DatasetCreate {
  root_path: string
  name?: string
  recursive?: boolean
  n_clusters?: number
  share_dataset?: boolean
  folder_id?: number | null
  annotation_path?: string | null
  annotation_name?: string | null
  metadata_path?: string | null
  metadata_key_column?: string | null
  allow_duplicate?: boolean   // true = creer meme si le dossier est deja indexe (409 sinon)
}

// ---- Aperçu métadonnées CSV/Excel ----
export interface MetadataPreview {
  columns: string[]
  sample_rows: Record<string, string>[]
  n_rows: number
  format: 'csv' | 'excel'
}

export interface ImageSummary {
  id: number
  filename: string
  file_path: string
  thumbnail_url: string | null
  width: number
  height: number
  cluster_id: number | null
  rarity_score: number | null
  umap_x: number | null
  umap_y: number | null
  duplicate_group_id: number | null
  is_duplicate_kept: boolean | null
  metadata?: Record<string, string>
}

export interface ImagePage {
  total: number
  page: number
  limit: number
  items: ImageSummary[]
}

export interface MapPoint {
  image_id: number
  x: number
  y: number
  cluster_id: number | null
  rarity_score: number | null
  filename: string
  thumbnail_url: string | null
  duplicate_group_id: number | null
  metadata?: Record<string, string>
}

export interface MapData {
  dataset_id: number
  points: MapPoint[]
}

export interface ClusterSample {
  image_id: number
  thumbnail_url: string | null
}

export interface ClusterInfo {
  cluster_id: number
  count: number
  avg_rarity: number | null
  sample_images: ClusterSample[]
}

export interface ClusterData {
  dataset_id: number
  n_clusters: number
  clusters: ClusterInfo[]
}

export interface SearchResult {
  image_id: number
  score: number
  rank: number
  filename: string
  thumbnail_url: string | null
  cluster_id: number | null
  rarity_score: number | null
  umap_x: number | null
  umap_y: number | null
}

export interface SearchResponse {
  query: string
  top_k: number
  min_score: number | null
  results: SearchResult[]
}

export interface DuplicateImageInfo {
  image_id: number
  filename: string
  thumbnail_url: string | null
  similarity_to_representative: number
  is_kept: boolean | null
}

export interface DuplicateGroup {
  group_id: number
  representative_image_id: number
  images: DuplicateImageInfo[]
  max_sim: number
}

export interface DuplicatesResponse {
  dataset_id: number
  threshold: number
  group_count: number
  duplicate_count: number
  groups: DuplicateGroup[]
}

// ---- Paramètres utilisateur ----
export interface AppSettings {
  workspace_path: string
  user_name: string
  annotation_app_imports_path: string
  default_n_clusters: number
  default_top_k: number
  theme: string
  scatter_default_color: string
  theme_bg: string       // 'dark-gray' | 'dark-slate' | 'dark-purple' | 'dark-teal' | 'dark-zinc'
  theme_accent: string   // 'indigo' | 'blue' | 'violet' | 'emerald' | 'rose' | 'amber'
  use_symlinks: boolean  // true = symlinks (défaut), false = copie physique
  playground_dataset_ids: number[]  // datasets épinglés dans le Playground
  // ---- Réduction dimensionnelle ----
  reduction_method: 'umap' | 'tsne' | 'pca'
  umap_n_neighbors: number
  umap_min_dist: number
  tsne_perplexity: number
  tsne_learning_rate: number
  // ---- Clustering ----
  cluster_method: 'kmeans' | 'hdbscan'
  hdbscan_min_cluster_size: number
  // ---- Tutoriel interactif (repli hors VisionNexus, cf. utils/tutorialState.ts) ----
  tutorial_launched_once: boolean
  tutorial_completed: boolean
}

// ---- Datasets d'exemple livres avec la suite (data_tuto/) ----
export interface SampleDataset {
  id: string
  path: string          // chemin absolu TEL QUE VU PAR LE BACKEND
  exists: boolean
  image_count: number
  first_image: string | null
}

// ---- Export d'un subset ----
export interface SubsetExportInfo {
  id: number
  export_path: string
  export_type: 'symlink' | 'copy'
  created_at: string
}

export interface SubsetSummary {
  id: number
  dataset_id: number
  name: string
  image_count: number
  symlink_dir: string | null
  exported_to_annotation_app: boolean
  export_path: string | null
  locked: boolean          // verrou anti-suppression, persiste cote serveur
  exports: SubsetExportInfo[]
  created_at: string
}

// ------------------------------------------------------------------ //
// Catalogue : recherche et doublons a travers TOUS les datasets       //
// ------------------------------------------------------------------ //

export interface GlobalSearchResult {
  image_id: number
  dataset_id: number
  dataset_name: string
  score: number
  rank: number
  filename: string
  thumbnail_url: string | null
  cluster_id: number | null
  rarity_score: number | null
}

export interface GlobalSearchResponse {
  query: string
  top_k: number
  min_score: number | null
  indexed_datasets: number[]
  indexed_vectors: number
  dataset_counts: Record<string, number>
  results: GlobalSearchResult[]
}

export interface GlobalDuplicateImage {
  image_id: number
  dataset_id: number
  dataset_name: string
  filename: string
  thumbnail_url: string | null
  similarity_to_representative: number
  is_kept: boolean | null
}

export interface GlobalDuplicateGroup {
  group_id: number
  representative_image_id: number
  dataset_ids: number[]
  size: number
  truncated: boolean
  images: GlobalDuplicateImage[]
}

export interface GlobalDuplicatesResponse {
  threshold: number
  cross_only: boolean
  indexed_datasets: number[]
  indexed_vectors: number
  group_count: number
  total_group_count: number
  duplicate_count: number
  groups: GlobalDuplicateGroup[]
}

export interface MetadataHit {
  image_id: number
  dataset_id: number
  dataset_name: string
  filename: string
  thumbnail_url: string | null
  cluster_id: number | null
  rarity_score: number | null
  metadata: Record<string, string>
}

export interface MetadataSearchResponse {
  query: string
  mode: string
  total: number
  limit: number
  offset: number
  dataset_counts: Record<string, number>
  indexed_datasets: number[]
  items: MetadataHit[]
}

export interface MetadataColumnInfo {
  column: string
  datasets: number[]
  dataset_names: string[]
}

export interface MetadataColumnsResponse {
  columns: MetadataColumnInfo[]
  groups: Record<string, string[]>   // colonne pivot -> variantes rapprochees
}

export interface MetadataFacetsResponse {
  column: string
  dataset_ids: number[]
  values: { value: string; count: number }[]
  distinct_shown: number
}

export interface AuditEntry {
  ts: string
  user: string
  action: string
  [key: string]: unknown
}

export interface SubsetCreate {
  dataset_id: number
  name: string
  image_ids: number[]
}

// SSE events
export type EmbedEventType = 'progress' | 'done' | 'error'

export interface EmbedProgressEvent {
  type: 'progress'
  current: number
  total: number
  phase: 'embedding' | 'indexing' | 'umap' | 'clustering' | 'scoring' | 'loading'
}

export interface EmbedDoneEvent {
  type: 'done'
  dataset_id: number
  status: string
}

export interface EmbedErrorEvent {
  type: 'error'
  message: string
}

export type EmbedEvent = EmbedProgressEvent | EmbedDoneEvent | EmbedErrorEvent
