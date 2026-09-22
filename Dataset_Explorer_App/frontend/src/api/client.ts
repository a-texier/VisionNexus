// ============================================================
// api/client.ts
// Client API typé — axios + fetch SSE.
// ============================================================

import axios from 'axios'
import type {
  AppSettings,
  AuditEntry,
  ClusterData,
  DatasetCreate,
  DatasetDetail,
  FilterByTextResponse,
  GlobalDuplicatesResponse,
  GlobalSearchResponse,
  MetadataColumnsResponse,
  MetadataFacetsResponse,
  MetadataPreview,
  MetadataSearchResponse,
  DatasetStats,
  DatasetSummary,
  DuplicatesResponse,
  EmbedEvent,
  Folder,
  ImagePage,
  MapData,
  SampleDataset,
  SearchResponse,
  SubsetCreate,
  SubsetExportInfo,
  SubsetSummary,
} from '../types/api'

const BASE = ''  // proxy Vite redirige /api → backend

const http = axios.create({ baseURL: BASE, timeout: 30_000 })

// Les requêtes SSE passent par le proxy Vite (même origine, URL relative).
// IMPORTANT : ne PAS pointer en direct sur http://localhost:BACKEND_PORT —
// en accès distant (SSH), seul le port frontend est forwardé, donc une
// connexion directe au backend échoue ("Failed to fetch"). Le proxy Vite
// (et un reverse-proxy en prod) relaie le flux SSE sans buffering.
const SSE_BASE = ''

// ------------------------------------------------------------------ //
// Datasets                                                            //
// ------------------------------------------------------------------ //

export const datasetsAPI = {
  list: (): Promise<DatasetSummary[]> =>
    http.get('/api/datasets').then(r => r.data),

  create: (data: DatasetCreate): Promise<DatasetSummary> =>
    http.post('/api/datasets', data).then(r => r.data),

  checkPath: (rootPath: string): Promise<{ id: number; name: string; image_count: number; status: string }[]> =>
    http.get('/api/datasets/check-path', { params: { root_path: rootPath } }).then(r => r.data),

  get: (id: number): Promise<DatasetDetail> =>
    http.get(`/api/datasets/${id}`).then(r => r.data),

  delete: (id: number): Promise<{ success: boolean }> =>
    http.delete(`/api/datasets/${id}`).then(r => r.data),

  getImages: (
    id: number,
    params: {
      page?: number
      limit?: number
      cluster_id?: number | null
      min_rarity?: number | null
      max_rarity?: number | null
      duplicate_only?: boolean
    } = {}
  ): Promise<ImagePage> =>
    http.get(`/api/datasets/${id}/images`, { params }).then(r => r.data),

  getMap: (id: number): Promise<MapData> =>
    http.get(`/api/datasets/${id}/map`).then(r => r.data),

  getClusters: (id: number): Promise<ClusterData> =>
    http.get(`/api/datasets/${id}/clusters`).then(r => r.data),

  getDuplicates: (
    id: number,
    threshold = 0.97
  ): Promise<DuplicatesResponse> =>
    http.get(`/api/datasets/${id}/duplicates`, { params: { threshold } }).then(r => r.data),

  patchDuplicateDecision: (
    id: number,
    decisions: { image_id: number; keep: boolean }[]
  ) => http.patch(`/api/datasets/${id}/duplicates/decision`, { decisions }).then(r => r.data),

  semanticSearch: (
    id: number,
    query: string,
    top_k: number,
    min_score?: number,
  ): Promise<SearchResponse> =>
    http.post(`/api/datasets/${id}/semantic-search`, { query, top_k, min_score }).then(r => r.data),

  // Lance le pipeline d'embedding en tâche de fond (non bloquant).
  // La progression se suit via le poll de list() (embed_progress/embed_total/embed_phase).
  embed: (id: number): Promise<{ status: string; dataset_id: number }> =>
    http.post(`/api/datasets/${id}/embed`).then(r => r.data),

  // Relance le clustering en tâche de fond (non bloquant). Progression via le
  // poll de list() (recluster_progress/recluster_total/recluster_phase).
  recluster: (
    id: number,
    opts: { method?: 'kmeans' | 'hdbscan'; n_clusters?: number; min_cluster_size?: number }
  ): Promise<{ status: string; dataset_id: number; method?: string }> =>
    http.post(`/api/datasets/${id}/recluster`, opts).then(r => r.data),

  // Relance la réduction dimensionnelle 2D (indépendante du clustering) en fond.
  // Progression via le poll de list() (reduce_progress/reduce_total/reduce_phase).
  reduce: (
    id: number,
    opts: {
      method?: 'umap' | 'tsne' | 'pca'
      umap_n_neighbors?: number
      umap_min_dist?: number
      tsne_perplexity?: number
      tsne_learning_rate?: number
    }
  ): Promise<{ status: string; dataset_id: number; method?: string }> =>
    http.post(`/api/datasets/${id}/reduce`, opts).then(r => r.data),

  excludeImages: (
    id: number,
    image_ids: number[]
  ): Promise<{ excluded: number; dataset_id: number }> =>
    http.post(`/api/datasets/${id}/exclude-images`, { image_ids }).then(r => r.data),

  getStats: (id: number): Promise<DatasetStats> =>
    http.get(`/api/datasets/${id}/stats`).then(r => r.data),

  refreshGallery: (id: number): Promise<{ gallery_thumb_urls: string[]; basic_stats: Record<string, unknown>; thumb_count: number }> =>
    http.post(`/api/datasets/${id}/refresh-gallery`).then(r => r.data),

  deleteGlobal: (root_path: string): Promise<{ success: boolean }> =>
    http.delete('/api/datasets/global', { params: { root_path } }).then(r => r.data),

  // Déplace un dataset dans un dossier (folder_id null = racine).
  moveToFolder: (id: number, folder_id: number | null): Promise<{ success: boolean; folder_id: number | null }> =>
    http.patch(`/api/datasets/${id}/folder`, { folder_id }).then(r => r.data),

  // Aperçu colonnes d'un CSV/Excel avant import (mapping métadonnées).
  metadataPreview: (path: string): Promise<MetadataPreview> =>
    http.post('/api/metadata/preview', { path }).then(r => r.data),

  // Filtrage CLIP : classe les datasets embeddés par pertinence (refonte step 4).
  filterByText: (opts: {
    queries: string[]
    threshold: number
    mode: 'union' | 'intersection'
    top_thumbs?: number
  }): Promise<FilterByTextResponse> =>
    http.post('/api/datasets/filter-by-text', { top_thumbs: 5, ...opts }).then(r => r.data),
}

// ------------------------------------------------------------------ //
// Folders (step 3 — arborescence)                                     //
// ------------------------------------------------------------------ //

export const foldersAPI = {
  list: (): Promise<Folder[]> =>
    http.get('/api/folders').then(r => r.data),

  create: (data: { name: string; parent_id?: number | null; is_global?: boolean }): Promise<Folder> =>
    http.post('/api/folders', data).then(r => r.data),

  update: (id: number, data: { name?: string; parent_id?: number | null }): Promise<Folder> =>
    http.patch(`/api/folders/${id}`, data).then(r => r.data),

  delete: (id: number): Promise<{ success: boolean }> =>
    http.delete(`/api/folders/${id}`).then(r => r.data),
}

// ------------------------------------------------------------------ //
// Subsets                                                             //
// ------------------------------------------------------------------ //

export const subsetsAPI = {
  list: (dataset_id?: number): Promise<SubsetSummary[]> =>
    http.get('/api/subsets', { params: { dataset_id } }).then(r => r.data),

  create: (data: SubsetCreate): Promise<SubsetSummary> =>
    http.post('/api/subsets', data).then(r => r.data),

  delete: (id: number) => http.delete(`/api/subsets/${id}`).then(r => r.data),

  exportToAnnotationApp: (id: number, customExportPath?: string) =>
    http.post(`/api/subsets/${id}/export-to-annotation-app`, customExportPath ? { custom_export_path: customExportPath } : {}).then(r => r.data),

  getDuplicates: (id: number, threshold = 0.97): Promise<DuplicatesResponse> =>
    http.get(`/api/subsets/${id}/duplicates`, { params: { threshold } }).then(r => r.data),

  applyDuplicateFilter: (id: number): Promise<{ removed: number; subset_id: number; image_count: number }> =>
    http.post(`/api/subsets/${id}/apply-duplicate-filter`).then(r => r.data),

  duplicate: (id: number, name?: string): Promise<SubsetSummary> =>
    http.post(`/api/subsets/${id}/duplicate`, name ? { name } : {}).then(r => r.data),

  getExports: (id: number): Promise<SubsetExportInfo[]> =>
    http.get(`/api/subsets/${id}/exports`).then(r => r.data),

  setLock: (id: number, locked: boolean): Promise<SubsetSummary> =>
    http.patch(`/api/subsets/${id}/lock`, { locked }).then(r => r.data),
}

// ------------------------------------------------------------------ //
// Catalogue — recherche/doublons a travers TOUS les datasets          //
// ------------------------------------------------------------------ //

export const catalogAPI = {
  searchGlobal: (params: {
    query: string
    top_k?: number
    min_score?: number | null
    dataset_ids?: number[] | null
  }): Promise<GlobalSearchResponse> =>
    // Recherche CLIP sur tout le catalogue : timeout large, l'index global peut
    // etre reconstruit a la volee au premier appel apres un embed.
    http.post('/api/search/global', params, { timeout: 120_000 }).then(r => r.data),

  globalDuplicates: (params: {
    threshold?: number
    cross_only?: boolean
    max_groups?: number
    max_images_per_group?: number
  } = {}): Promise<GlobalDuplicatesResponse> =>
    http.get('/api/duplicates/global', { params, timeout: 300_000 }).then(r => r.data),

  patchGlobalDuplicateDecision: (
    decisions: { image_id: number; keep: boolean }[]
  ): Promise<{ updated: number }> =>
    http.patch('/api/duplicates/global/decision', { decisions }).then(r => r.data),
}

// ------------------------------------------------------------------ //
// Metadonnees (CSV/Excel) — catalogue interrogeable                   //
// ------------------------------------------------------------------ //

export const metadataAPI = {
  search: (params: {
    query: string
    dataset_ids?: number[] | null
    mode?: 'and' | 'or'
    limit?: number
    offset?: number
  }): Promise<MetadataSearchResponse> =>
    http.post('/api/metadata/search', params, { timeout: 120_000 }).then(r => r.data),

  columns: (): Promise<MetadataColumnsResponse> =>
    http.get('/api/metadata/columns').then(r => r.data),

  facets: (column: string, datasetIds?: number[]): Promise<MetadataFacetsResponse> =>
    http.get('/api/metadata/facets', {
      params: { column, dataset_ids: datasetIds },
      paramsSerializer: { indexes: null },   // dataset_ids=1&dataset_ids=2
    }).then(r => r.data),

  suggestMapping: (columns: string[], excludeDatasetId?: number): Promise<{
    known_columns: string[]
    suggested_key_column: string | null
    mapping: Record<string, { suggested: string; score: number }>
  }> =>
    http.post('/api/metadata/suggest-mapping', {
      columns, exclude_dataset_id: excludeDatasetId,
    }).then(r => r.data),

  reindex: (datasetId?: number): Promise<{ indexed: Record<string, number>; total_rows: number }> =>
    http.post('/api/metadata/reindex', null, { params: { dataset_id: datasetId }, timeout: 300_000 })
      .then(r => r.data),
}

// ------------------------------------------------------------------ //
// Journal d'audit                                                     //
// ------------------------------------------------------------------ //

export const auditAPI = {
  recent: (limit = 100, action?: string): Promise<{ entries: AuditEntry[] }> =>
    http.get('/api/audit', { params: { limit, action } }).then(r => r.data),
}

// ------------------------------------------------------------------ //
// Settings                                                            //
// ------------------------------------------------------------------ //

export const samplesAPI = {
  list: (): Promise<SampleDataset[]> =>
    http.get('/api/samples/datasets').then(r => r.data),

  get: (id: string): Promise<SampleDataset> =>
    http.get(`/api/samples/datasets/${id}`).then(r => r.data),
}

export const settingsAPI = {
  get: (): Promise<AppSettings> =>
    http.get('/api/settings').then(r => r.data),

  update: (data: Partial<AppSettings>): Promise<AppSettings> =>
    http.put('/api/settings', data).then(r => r.data),
}

// ------------------------------------------------------------------ //
// App mode                                                            //
// ------------------------------------------------------------------ //

export const appModeAPI = {
  get: (): Promise<{ mode: 'orchestrator' | 'solo'; subsets_dir: string; annotation_imports_dir: string; workspace: string }> =>
    http.get('/api/app-mode').then(r => r.data),
}

// ------------------------------------------------------------------ //
// SSE embed (POST → ReadableStream)                                   //
// ------------------------------------------------------------------ //

export function startRemap(
  datasetId: number,
  onEvent: (event: EmbedEvent) => void,
  onDone?: () => void
): () => void {
  return _startSSE(`${SSE_BASE}/api/datasets/${datasetId}/remap`, 'POST', onEvent, onDone)
}

export function startRebuildWithoutDuplicates(
  datasetId: number,
  onEvent: (event: EmbedEvent) => void,
  onDone?: () => void
): () => void {
  return _startSSE(`${SSE_BASE}/api/datasets/${datasetId}/rebuild-without-duplicates`, 'POST', onEvent, onDone)
}

export function startResetDuplicateFilter(
  datasetId: number,
  onEvent: (event: EmbedEvent) => void,
  onDone?: () => void
): () => void {
  return _startSSE(`${SSE_BASE}/api/datasets/${datasetId}/reset-duplicate-filter`, 'POST', onEvent, onDone)
}

export function startMerge(
  sourceIds: number[],
  name: string,
  nClusters: number,
  onEvent: (event: EmbedEvent) => void,
  onDone?: () => void
): () => void {
  return _startSSE(
    `${SSE_BASE}/api/datasets/merge`,
    'POST',
    onEvent,
    onDone,
    JSON.stringify({ source_ids: sourceIds, name, n_clusters: nClusters }),
  )
}

// Merge filtré (step 6) : ne fusionne que les images dont le score CLIP > seuil.
export function startMergeFiltered(
  opts: {
    sourceIds: number[]
    name: string
    queries: string[]
    threshold: number
    mode: 'union' | 'intersection'
    nClusters: number
  },
  onEvent: (event: EmbedEvent) => void,
  onDone?: () => void
): () => void {
  return _startSSE(
    `${SSE_BASE}/api/datasets/merge-filtered`,
    'POST',
    onEvent,
    onDone,
    JSON.stringify({
      source_ids: opts.sourceIds,
      name: opts.name,
      queries: opts.queries,
      threshold: opts.threshold,
      mode: opts.mode,
      n_clusters: opts.nClusters,
    }),
  )
}

function _startSSE(
  url: string,
  method: string,
  onEvent: (event: EmbedEvent) => void,
  onDone?: () => void,
  body?: string,
): () => void {
  let cancelled = false
  const controller = new AbortController()

  const headers: Record<string, string> = {}
  if (body) headers['Content-Type'] = 'application/json'

  fetch(url, {
    method,
    headers,
    body,
    signal: controller.signal,
  }).then(async response => {
    if (!response.ok || !response.body) {
      onEvent({ type: 'error', message: `HTTP ${response.status}` })
      return
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (!cancelled) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const parts = buffer.split('\n\n')
      buffer = parts.pop() ?? ''

      for (const part of parts) {
        const line = part.trim()
        if (line.startsWith('data: ')) {
          try {
            const evt: EmbedEvent = JSON.parse(line.slice(6))
            onEvent(evt)
            if (evt.type === 'done' || evt.type === 'error') {
              onDone?.()
              return
            }
          } catch {
            // ignorer les lignes malformées
          }
        }
      }
    }
    onDone?.()
  }).catch(err => {
    if (!cancelled) {
      onEvent({ type: 'error', message: String(err) })
    }
  })

  return () => {
    cancelled = true
    controller.abort()
  }
}
