// ============================================================
// services/api.ts
// Client HTTP axios typé pour toutes les requêtes vers l'API FastAPI.
// Toutes les fonctions sont strictement typées (zéro `any`).
// ============================================================

import axios from 'axios'
import toast from 'react-hot-toast'
import type {
  Annotation,
  AnnotationCreate,
  AnnotationSummaryItem,
  AnnotationUpdate,
  ExportTask,
  Frame,
  FrameDetail,
  GroundingStatus,
  LabelClass,
  LabelClassCreate,
  OverlapPair,
  Project,
  ProjectDetail,
  ProjectStats,
  SAM3Status,
  SAMMask,
  SAMPoint,
  SessionState,
  SpecificFormatCapability,
  TextPredictResponse,
  Track,
  UserSettings,
} from '../types/api'

// URL de base de l'API (via proxy Vite en dev)
const BASE_URL = import.meta.env.VITE_API_URL ?? ''

const apiClient = axios.create({
  baseURL: BASE_URL,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
})

// Intercepteur de réponse : affiche les erreurs API via toast.
// Dédupliqué : un backend saturé (propagation GPU) fait expirer d'un coup toutes
// les requêtes en vol — sans ce garde-fou l'écran se couvrait de dizaines de
// popups identiques « timeout of 30000ms exceeded ».
const lastToastAt = new Map<string, number>()
const TOAST_DEDUPE_MS = 5000

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    const isTimeout = error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT'
    const message = isTimeout
      ? 'Le backend ne répond pas (calcul en cours ?) — requête abandonnée'
      : error.response?.data?.detail ??
        error.response?.data?.message ??
        error.message ??
        'Erreur réseau'

    const now = Date.now()
    const previous = lastToastAt.get(message) ?? 0
    if (now - previous > TOAST_DEDUPE_MS) {
      lastToastAt.set(message, now)
      toast.error(`Erreur API : ${message}`, { id: message })
    }
    return Promise.reject(error)
  }
)

// ---- Projets ----

export interface LutSettings {
  mode: 'sigma' | 'minmax' | 'manual'
  sigma: number
  lo: number | null
  hi: number | null
}

export interface Histogram {
  bins: number[]
  counts: number[]
  min: number
  max: number
  mean: number
  std: number
  dtype: string
  bit_depth: number
}

export const projectsAPI = {
  list: () =>
    apiClient.get<Project[]>('/api/projects').then((r) => r.data),

  create: (data: {
    name: string
    description?: string
    project_type?: 'image' | 'video'
    source_path?: string
    is_template?: boolean
    classes?: LabelClassCreate[]
  }) => apiClient.post<Project>('/api/projects', data).then((r) => r.data),

  get: (id: number) =>
    apiClient.get<ProjectDetail>(`/api/projects/${id}`).then((r) => r.data),

  update: (id: number, data: { name?: string; description?: string; is_template?: boolean }) =>
    apiClient.put<Project>(`/api/projects/${id}`, data).then((r) => r.data),

  delete: (id: number) =>
    apiClient.delete<{ success: boolean }>(`/api/projects/${id}`).then((r) => r.data),

  getStats: (id: number) =>
    apiClient.get<ProjectStats>(`/api/projects/${id}/stats`).then((r) => r.data),

  // ---- LUT d'affichage (remap 16/8 bits) ----
  getLut: (id: number) =>
    apiClient.get<{ lut: LutSettings | null; signature: string }>(`/api/projects/${id}/lut`).then((r) => r.data),

  setLut: (id: number, lut: LutSettings) =>
    apiClient.put<{ lut: LutSettings; signature: string }>(`/api/projects/${id}/lut`, lut).then((r) => r.data),

  getHistogram: (frameId: number) =>
    apiClient.get<Histogram>(`/api/frames/${frameId}/histogram`).then((r) => r.data),

  getSession: (id: number) =>
    apiClient.get<SessionState>(`/api/projects/${id}/session`).then((r) => r.data),

  updateSession: (id: number, data: Partial<SessionState>) =>
    apiClient.put(`/api/projects/${id}/session`, data).then((r) => r.data),

  listClasses: (id: number) =>
    apiClient.get<LabelClass[]>(`/api/projects/${id}/classes`).then((r) => r.data),

  createClass: (id: number, data: LabelClassCreate) =>
    apiClient.post<LabelClass>(`/api/projects/${id}/classes`, data).then((r) => r.data),

  updateClass: (projectId: number, classId: number, data: Partial<LabelClass>) =>
    apiClient
      .put<LabelClass>(`/api/projects/${projectId}/classes/${classId}`, data)
      .then((r) => r.data),

  deleteClass: (projectId: number, classId: number) =>
    apiClient
      .delete<{ success: boolean }>(`/api/projects/${projectId}/classes/${classId}`)
      .then((r) => r.data),
}

// ---- Dataset / Frames ----

export const datasetAPI = {
  getCapabilities: () =>
    apiClient
      .get<{ specific_formats: SpecificFormatCapability[] }>('/api/capabilities')
      .then((r) => r.data),

  // Lit un .txt de manifeste de séquences côté serveur (récupération step3b).
  parseSequenceManifest: (path: string) =>
    apiClient
      .post<{ sequences: { source_path: string; name: string }[] }>(
        '/api/sequences/parse-manifest', { path },
      )
      .then((r) => r.data),

  /**
   * Upload d'images par batchs séquentiels (évite les timeouts sur >100 images).
   * onProgress : callback (0–100) appelé après chaque batch.
   */
  importImages: async (
    projectId: number,
    files: File[],
    batchSize = 20,
    onProgress?: (pct: number) => void,
  ) => {
    let totalAdded = 0
    let totalFrames = 0
    const batches: File[][] = []
    for (let i = 0; i < files.length; i += batchSize) {
      batches.push(files.slice(i, i + batchSize))
    }
    for (let b = 0; b < batches.length; b++) {
      const formData = new FormData()
      batches[b].forEach((f) => formData.append('files', f))
      const res = await apiClient
        .post<{ success: boolean; frames_added: number; total_frames: number }>(
          `/api/projects/${projectId}/import/images`,
          formData,
          { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120000 }
        )
        .then((r) => r.data)
      totalAdded += res.frames_added
      totalFrames = res.total_frames
      onProgress?.(Math.round(((b + 1) / batches.length) * 100))
    }
    return { success: true, frames_added: totalAdded, total_frames: totalFrames }
  },

  importFolder: (projectId: number, folderPath: string, useSymlink = false, sequenceName = '') => {
    const formData = new FormData()
    formData.append('folder_path', folderPath)
    formData.append('use_symlink', String(useSymlink))
    if (sequenceName) formData.append('sequence_name', sequenceName)
    return apiClient
      .post<{ success: boolean; task_id: string | null; total_files: number; frames_added?: number }>(
        `/api/projects/${projectId}/import/folder`,
        formData,
        { headers: { 'Content-Type': 'multipart/form-data' } }
      )
      .then((r) => r.data)
  },

  importVideo: (
    projectId: number,
    file: File,
    frameKeep = 0,
    jpegQuality = 85,
    chunkSizeMb = 8,
    initialFrames = 3,
    extractionBatchSize = 10,
    sequenceName = '',
  ) => {
    const formData = new FormData()
    formData.append('video', file)
    formData.append('frame_keep', String(frameKeep))
    formData.append('jpeg_quality', String(jpegQuality))
    formData.append('chunk_size_mb', String(chunkSizeMb))
    formData.append('initial_frames', String(initialFrames))
    formData.append('extraction_batch_size', String(extractionBatchSize))
    if (sequenceName) formData.append('sequence_name', sequenceName)
    return apiClient
      .post<{ success: boolean; task_id: string; frames_registered: number; frames_extracted: number }>(
        `/api/projects/${projectId}/import/video`,
        formData,
        { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 600000 }
      )
      .then((r) => r.data)
  },

  importSpecific: (
    projectId: number,
    formatId: string,
    file: File,
    frameKeep = 0,
    chunkSizeMb = 8,
    extractionBatchSize = 10,
    sequenceName = '',
  ) => {
    const formData = new FormData()
    formData.append('format_id', formatId)
    formData.append('source_file', file)
    formData.append('frame_keep', String(frameKeep))
    formData.append('chunk_size_mb', String(chunkSizeMb))
    formData.append('extraction_batch_size', String(extractionBatchSize))
    if (sequenceName) formData.append('sequence_name', sequenceName)
    return apiClient
      .post<{ success: boolean; task_id: string; frames_registered: number; frames_extracted: number }>(
        `/api/projects/${projectId}/import/specific`,
        formData,
        { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 600000 },
      )
      .then((r) => r.data)
  },

  ensureExtracted: (
    projectId: number,
    centerFrameIndex: number,
    preload = 2,
    jpegQuality = 85,
  ) =>
    apiClient
      .post<{ extracted: number[]; message: string }>(
        `/api/projects/${projectId}/frames/ensure_extracted`,
        null,
        { params: { center_frame_index: centerFrameIndex, preload, jpeg_quality: jpegQuality } }
      )
      .then((r) => r.data),

  listFrames: (projectId: number, page = 0, limit = 50, annotatedOnly = false) =>
    apiClient
      .get<Frame[]>(`/api/projects/${projectId}/frames`, {
        params: { page, limit, annotated_only: annotatedOnly },
      })
      .then((r) => r.data),

  // Multi-séquence : liste des séquences avec stats d'annotation
  listSequences: (projectId: number) =>
    apiClient
      .get<import('../types/api').Sequence[]>(`/api/projects/${projectId}/sequences`)
      .then((r) => r.data),

  // LUT d'affichage PROPRE à une séquence (prioritaire sur la LUT projet).
  setSequenceLut: (sequenceId: number, lut: LutSettings) =>
    apiClient
      .put<{ lut: LutSettings; signature: string }>(`/api/sequences/${sequenceId}/lut`, lut)
      .then((r) => r.data),

  clearSequenceLut: (sequenceId: number) =>
    apiClient
      .delete<{ success: boolean }>(`/api/sequences/${sequenceId}/lut`)
      .then((r) => r.data),

  // Import d'annotations existantes (.ver ou dossier YOLO) sur une séquence (S9).
  importSequenceAnnotations: (
    projectId: number, sequenceId: number,
    body: { path: string; format?: 'auto' | 'ver' | 'yolo'; replace?: boolean },
  ) =>
    apiClient
      .post<{ success: boolean; format: string; annotations_created: number; frames_annotated: number }>(
        `/api/projects/${projectId}/sequences/${sequenceId}/import-annotations`,
        { format: 'auto', replace: false, ...body },
      )
      .then((r) => r.data),

  // Import d'annotations par UPLOAD (drag & drop navigateur) : un .ver OU un jeu
  // de .txt YOLO (+ data.yaml). Le backend auto-détecte le format.
  importSequenceAnnotationsUpload: (
    projectId: number, sequenceId: number, files: File[], replace = false,
  ) => {
    const form = new FormData()
    for (const f of files) form.append('files', f, f.name)
    form.append('replace', String(replace))
    return apiClient
      .post<{ success: boolean; format: string; annotations_created: number; frames_annotated: number }>(
        `/api/projects/${projectId}/sequences/${sequenceId}/import-annotations-upload`,
        form,
        // IMPORTANT : neutraliser le Content-Type par défaut (application/json) du
        // client pour que axios pose lui-même multipart/form-data + boundary.
        // Sans ça le backend reçoit du multipart étiqueté JSON → 422 Unprocessable.
        { headers: { 'Content-Type': undefined } },
      )
      .then((r) => r.data)
  },

  getFrameByIndex: (projectId: number, frameIndex: number) =>
    apiClient
      .get<Frame>(`/api/projects/${projectId}/frames/by-index/${frameIndex}`)
      .then((r) => r.data),

  getFrame: (frameId: number) =>
    apiClient.get<FrameDetail>(`/api/frames/${frameId}`).then((r) => r.data),

  markEmpty: (frameId: number, empty = true) =>
    apiClient
      .post<{ success: boolean }>(`/api/frames/${frameId}/mark-empty`, null, {
        params: { empty },
      })
      .then((r) => r.data),

  toggleKeyframe: (frameId: number, isKeyframe: boolean) =>
    apiClient
      .put<{ success: boolean }>(`/api/frames/${frameId}/keyframe`, null, {
        params: { is_keyframe: isKeyframe },
      })
      .then((r) => r.data),

  importVideoFromPath: (
    projectId: number,
    videoPath: string,
    frameKeep = 0,
    jpegQuality = 85,
    initialFrames = 3,
    extractionBatchSize = 10,
    lossless = false,
    sequenceName = '',
  ) => {
    const formData = new FormData()
    formData.append('video_path', videoPath)
    formData.append('frame_keep', String(frameKeep))
    formData.append('jpeg_quality', String(jpegQuality))
    formData.append('initial_frames', String(initialFrames))
    formData.append('extraction_batch_size', String(extractionBatchSize))
    formData.append('lossless', String(lossless))
    if (sequenceName) formData.append('sequence_name', sequenceName)
    return apiClient
      .post<{ success: boolean; task_id: string; frames_registered: number; frames_extracted: number }>(
        `/api/projects/${projectId}/import/video_from_path`,
        formData,
        { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 60000 }
      )
      .then((r) => r.data)
  },

  getImageUrl: (frameId: number) => `${BASE_URL}/api/frames/${frameId}/image`,
}

// ---- Navigateur de fichiers serveur ----

export interface FileBrowserEntry {
  name: string
  path: string
  is_dir: boolean
  size: number | null
}

export interface FileBrowserResult {
  path: string
  parent: string | null
  entries: FileBrowserEntry[]
}

export const filesAPI = {
  browse: (path = '', filterType: 'all' | 'dirs' | 'images' | 'video' = 'all') =>
    apiClient
      .get<FileBrowserResult>('/api/files/browse', { params: { path, filter_type: filterType } })
      .then((r) => r.data),

  // Historique des dossiers serveur retenus (par utilisateur, via son workspace)
  getBrowseHistory: () =>
    apiClient.get<string[]>('/api/files/browse-history').then((r) => r.data),

  addBrowseHistory: (path: string) =>
    apiClient
      .post<{ success: boolean; history: string[] }>('/api/files/browse-history', { path })
      .then((r) => r.data),
}

// ---- Monitoring ----

export interface MonitoringSequence {
  sequence_id: number | null
  sequence_name: string
  source_path: string
  by_source: Record<string, number>
  frames_annotated: number
  total: number
  /** Nombre total d'images de la séquence (pas seulement les annotées) */
  frame_count: number
  start_index: number
  /** Couverture échantillonnée : nb de frames annotées par segment */
  coverage: number[]
  last_export_at: string | null
  last_export_format: string | null
  /** Terminée = exportée (annotée ne suffit pas) */
  is_done: boolean
}

export interface MonitoringRun {
  ts?: string
  user?: string
  algorithm?: string
  mode?: string
  targets?: number
  frames?: number
  created?: number
  duration_s?: number
  stopped?: boolean
}

export interface MonitoringRework {
  dataset: string
  sequence_name: string
  project_name: string
  frames_touched: number
  frames_multi: number
  touches: number
}

export interface MonitoringWorkspace {
  workspace: string
  user: string
  snapshot: {
    projects: {
      project_id: number
      project_name: string
      project_type: string
      sequences: MonitoringSequence[]
    }[]
    totals: Record<string, number>
    timeline: { day: string; source: string; count: number }[]
  }
  summary: {
    annotations_total: number
    annotations_manual: number
    annotations_auto: number
    auto_edited: number
    auto_deleted: number
    manual_edited: number
    frames_touched: number
    frames_multi_touched: number
    by_source: Record<string, number>
    runs: number
    run_frames: number
    run_seconds: number
    first_event: string | null
    last_event: string | null
  }
  rework_by_dataset: MonitoringRework[]
  runs: MonitoringRun[]
}

/** Agrégat d'un utilisateur, tous ses workspaces confondus */
export interface MonitoringUser {
  user: string
  roots: string[]
  workspaces: string[]
  projects: number
  sequences: number
  sequences_done: number
  annotations_total: number
  annotations_manual: number
  annotations_auto: number
  auto_edited: number
  auto_deleted: number
  by_source: Record<string, number>
  runs: number
}

export interface MonitoringRoot {
  root: string
  users: MonitoringUser[]
  annotations_total: number
  annotations_manual: number
  annotations_auto: number
  sequences: number
  sequences_done: number
}

export const monitoringAPI = {
  getStats: (scope: 'me' | 'all' = 'me') =>
    apiClient
      .get<{
        scope: string
        workspaces: MonitoringWorkspace[]
        by_user: MonitoringUser[]
        by_root: MonitoringRoot[]
      }>('/api/monitoring/stats', { params: { scope } })
      .then((r) => r.data),
}

// ---- Annotations ----

export const annotationsAPI = {
  list: (frameId: number) =>
    apiClient.get<Annotation[]>(`/api/frames/${frameId}/annotations`).then((r) => r.data),

  listAll: (projectId: number) =>
    apiClient.get<Annotation[]>(`/api/projects/${projectId}/annotations/all`).then((r) => r.data),

  create: (frameId: number, data: AnnotationCreate) =>
    apiClient.post<Annotation>(`/api/frames/${frameId}/annotations`, data).then((r) => r.data),

  update: (annotationId: number, data: AnnotationUpdate) =>
    apiClient.put<Annotation>(`/api/annotations/${annotationId}`, data).then((r) => r.data),

  delete: (annotationId: number) =>
    apiClient.delete<{ success: boolean }>(`/api/annotations/${annotationId}`).then((r) => r.data),

  bulkCreate: (frameId: number, annotations: AnnotationCreate[], replace = false) =>
    apiClient
      .post<{ success: boolean; created: number }>(
        `/api/frames/${frameId}/annotations/bulk`,
        { annotations, replace }
      )
      .then((r) => r.data),

  deleteAll: (frameId: number) =>
    apiClient
      .delete<{ success: boolean; deleted_count: number }>(`/api/frames/${frameId}/annotations/all`)
      .then((r) => r.data),

  // Suppression en masse : UNE requête pour N frames (voir backend, ~50x plus
  // rapide que N appels deleteAll qui recomptaient le projet à chaque fois).
  deleteForFrames: (projectId: number, frameIds: number[]) =>
    apiClient
      .post<{ success: boolean; deleted_count: number; frames: number }>(
        `/api/projects/${projectId}/annotations/delete-frames`,
        { frame_ids: frameIds }
      )
      .then((r) => r.data),

  // Annuler / refaire la dernière suppression GROUPÉE d'annotations (timeline).
  undoBulkDelete: (projectId: number) =>
    apiClient
      .post<{ success: boolean; restored?: number; frames?: number[]; can_undo_more: boolean; can_redo_more: boolean }>(
        `/api/projects/${projectId}/annotations/undo-bulk-delete`,
      )
      .then((r) => r.data),

  redoBulkDelete: (projectId: number) =>
    apiClient
      .post<{ success: boolean; frames?: number[]; can_undo_more: boolean; can_redo_more: boolean }>(
        `/api/projects/${projectId}/annotations/redo-bulk-delete`,
      )
      .then((r) => r.data),

  copyTo: (frameId: number, targetFrameIds: number[], overwrite = false) =>
    apiClient
      .post<{ success: boolean; copied_count: number }>(`/api/frames/${frameId}/copy-to`, {
        target_frame_ids: targetFrameIds,
        overwrite,
      })
      .then((r) => r.data),

  detectOverlaps: (frameId: number, iouThreshold = 0.85) =>
    apiClient
      .get<OverlapPair[]>(`/api/frames/${frameId}/overlaps`, {
        params: { iou_threshold: iouThreshold },
      })
      .then((r) => r.data),

  applyNMS: (frameId: number, iouThreshold = 0.5, sameClassOnly = false) =>
    apiClient
      .post<{ success: boolean; deleted_count: number; remaining_count: number }>(
        `/api/frames/${frameId}/annotations/nms`,
        { iou_threshold: iouThreshold, same_class_only: sameClassOnly }
      )
      .then((r) => r.data),

  // Résumé global multi-frames
  summary: (projectId: number, minConfidence = 0, sourceFilter?: string) =>
    apiClient
      .get<AnnotationSummaryItem[]>(`/api/projects/${projectId}/annotations/summary`, {
        params: {
          min_confidence: minConfidence,
          ...(sourceFilter ? { source_filter: sourceFilter } : {}),
        },
      })
      .then((r) => r.data),

  // Suppression batch par IDs
  batchDelete: (projectId: number, annotationIds: number[]) =>
    apiClient
      .delete<{ success: boolean; deleted_count: number }>(
        `/api/projects/${projectId}/annotations/batch`,
        { data: { annotation_ids: annotationIds } }
      )
      .then((r) => r.data),

  // Suppression depuis une frame en avant
  deleteFromFrame: (projectId: number, fromFrameIndex: number, sourceFilter?: string) =>
    apiClient
      .delete<{ success: boolean; deleted_count: number; frames_cleaned: number }>(
        `/api/projects/${projectId}/annotations/from-frame`,
        {
          params: {
            from_frame_index: fromFrameIndex,
            ...(sourceFilter ? { source_filter: sourceFilter } : {}),
          },
        }
      )
      .then((r) => r.data),

  interpolate: (projectId: number, startFrameId: number, endFrameId: number, trackId?: number) =>
    apiClient
      .post<{ success: boolean; interpolated_count: number }>(
        `/api/projects/${projectId}/interpolate`,
        { start_frame_id: startFrameId, end_frame_id: endFrameId, track_id: trackId ?? null }
      )
      .then((r) => r.data),

  validate: (projectId: number) =>
    apiClient
      .get<{ valid: boolean; error_count: number; errors: unknown[] }>(
        `/api/projects/${projectId}/annotations/validate`
      )
      .then((r) => r.data),
}

// ---- SAM2 ----

export const samAPI = {
  getStatus: () =>
    apiClient
      .get<{ loaded: boolean; device: string; model: string; gpu_memory_gb: number | null }>(
        '/api/sam/status'
      )
      .then((r) => r.data),

  loadModel: (modelSize: 'tiny' | 'small' | 'base_plus' | 'large') =>
    apiClient
      .post<{ status: string; device: string; model: string }>('/api/sam/load', {
        model_size: modelSize,
      })
      .then((r) => r.data),

  predictPoints: (frameId: number, points: SAMPoint[], multimask = true) =>
    apiClient
      .post<{ masks: SAMMask[] }>('/api/sam/predict/points', {
        frame_id: frameId,
        points,
        multimask,
      })
      .then((r) => r.data.masks),

  predictText: (
    frameId: number,
    textPrompt: string,
    options?: { box_threshold?: number; text_threshold?: number; use_sam?: boolean }
  ) =>
    apiClient
      .post<TextPredictResponse>('/api/sam/predict/text', {
        frame_id: frameId,
        text_prompt: textPrompt,
        ...options,
      })
      .then((r) => r.data),

  getGroundingStatus: () =>
    apiClient.get<GroundingStatus>('/api/sam/grounding/status').then((r) => r.data),
}

// ---- SAM3 ----

export const sam3API = {
  getStatus: () =>
    apiClient.get<SAM3Status>('/api/sam3/status').then((r) => r.data),

  load: () =>
    apiClient.post<{ status: string; model: string }>('/api/sam3/load').then((r) => r.data),

  predictText: (frameId: number, textPrompt: string, boxThreshold?: number, textThreshold?: number) =>
    apiClient
      .post<{ detections: TextPredictResponse['detections']; count: number; model: string; prompt: string }>(
        '/api/sam3/predict/text',
        { frame_id: frameId, text_prompt: textPrompt, box_threshold: boxThreshold, text_threshold: textThreshold }
      )
      .then((r) => r.data),
}

// ---- Tracking ----

export const trackingAPI = {
  list: (projectId: number, activeOnly = true) =>
    apiClient
      .get<Track[]>(`/api/projects/${projectId}/tracks`, { params: { active_only: activeOnly } })
      .then((r) => r.data),

  create: (projectId: number, data: { class_id: number; color?: string; start_frame?: number }) =>
    apiClient.post<Track>(`/api/projects/${projectId}/tracks`, data).then((r) => r.data),

  update: (trackId: number, data: { class_id?: number; color?: string; is_active?: boolean }) =>
    apiClient.put<Track>(`/api/tracks/${trackId}`, data).then((r) => r.data),

  delete: (trackId: number) =>
    apiClient
      .delete<{ success: boolean; deleted_annotations: number }>(`/api/tracks/${trackId}`)
      .then((r) => r.data),

  // Supprime uniquement les annotations d'une piste sur un bloc [start, end]
  deleteBlock: (trackId: number, startFrame: number, endFrame: number) =>
    apiClient
      .post<{ success: boolean; deleted_annotations: number; track_removed: boolean }>(
        `/api/tracks/${trackId}/delete-block`,
        { start_frame: startFrame, end_frame: endFrame }
      )
      .then((r) => r.data),

  merge: (projectId: number, trackIdKeep: number, trackIdMerge: number) =>
    apiClient
      .post<{ success: boolean; merged_annotations: number }>(
        `/api/projects/${projectId}/tracks/merge`,
        { track_id_keep: trackIdKeep, track_id_merge: trackIdMerge }
      )
      .then((r) => r.data),

  runByteTrack: (
    projectId: number,
    params: {
      start_frame_index?: number
      end_frame_index?: number
      track_thresh?: number
      track_buffer?: number
      match_thresh?: number
    }
  ) =>
    apiClient
      .post<{ success: boolean; task_id: string }>(
        `/api/projects/${projectId}/bytetrack/run`,
        params
      )
      .then((r) => r.data),

  propagateHomography: (
    projectId: number,
    data: {
      keyframe_id: number
      end_frame_id: number
      annotation_ids: number[]
      min_inlier_count?: number
      min_inlier_ratio?: number
      ransac_threshold?: number
      xfeat_top_k?: number
      xfeat_min_cossim?: number
      use_optical_flow?: boolean
      optflow_win_size?: number
      optflow_max_level?: number
      optflow_min_pts?: number
    }
  ) =>
    apiClient
      .post<{ success: boolean; task_id: string }>(
        `/api/projects/${projectId}/homography/propagate`,
        data
      )
      .then((r) => r.data),

  homographyStatus: () =>
    apiClient
      .get<{ method: 'xfeat' | 'sift'; defaults: Record<string, number> }>('/api/homography/status')
      .then((r) => r.data),

  debugHomography: (
    projectId: number,
    frameAId: number,
    frameBId: number
  ) =>
    apiClient
      .get<{
        method: string
        keypoints_a: number
        keypoints_b: number
        matches_total: number
        matches_good: number
        inliers: number
        inlier_ratio: number
        homography_valid: boolean
        visualization_b64: string | null
        frame_a_index: number
        frame_b_index: number
        error?: string
      }>(`/api/projects/${projectId}/homography/debug`, {
        params: { frame_a_id: frameAId, frame_b_id: frameBId },
      })
      .then((r) => r.data),

  runGuidedTracking: (
    projectId: number,
    data: {
      reference_frame_id: number
      annotation_ids: number[]
      start_frame_index: number
      end_frame_index: number
      algorithm: 'grounding_dino' | 'sam3'
      text_prompt: string
      box_threshold?: number
      text_threshold?: number
      max_centroid_distance?: number
      size_variation_threshold?: number
      sam3_output_mode?: 'bbox' | 'segmentation'  // SAM3 uniquement
      ref_array_index?: number
      end_array_index?: number
      auto_stop_lost_ratio?: number        // 0 = désactivé; 0.5 = stop si > 50% perdus
      auto_stop_consecutive_frames?: number  // nb de frames consécutives avant arrêt
    }
  ) =>
    apiClient
      .post<{ success: boolean; task_id: string; frames_to_process: number; targets_count: number }>(
        `/api/projects/${projectId}/guided-tracking/run`,
        data,
        { timeout: 180000 }  // 3 min — modele peut mettre du temps a charger
      )
      .then((r) => r.data),

  runSam2Tracking: (
    projectId: number,
    data: {
      reference_frame_id: number
      annotation_ids: number[]
      end_frame_id: number
      output_mode?: 'bbox' | 'segmentation'
      ref_array_index?: number
      end_array_index?: number
      tracking_mode?: 'auto' | 'samurai_per_object'
    }
  ) =>
    apiClient
      .post<{ success: boolean; task_id: string; frames_to_process: number; targets_count: number }>(
        `/api/projects/${projectId}/sam2-tracking/run`,
        data,
        { timeout: 180000 }
      )
      .then((r) => r.data),

  deleteAllTracks: (projectId: number) =>
    apiClient
      .delete<{ success: boolean; deleted_count: number }>(`/api/projects/${projectId}/tracks`)
      .then((r) => r.data),

  // Assigner / créer / détacher la track d'une annotation (MOT)
  assignTrack: (annotationId: number, action: 'new' | 'assign' | 'detach', trackId?: number) =>
    apiClient
      .post<{ success: boolean; track_id: number | null; track?: Track }>(
        `/api/annotations/${annotationId}/track`,
        { action, track_id: trackId ?? null }
      )
      .then((r) => r.data),
}

// ---- Taches en arriere-plan (ByteTrack, propagation, etc.) ----

// Actions de controle (stop/pause/resume) : fetch direct, PAS apiClient.
// apiClient a un timeout de 30s — un backend sature par une propagation GPU
// fait la queue avec toutes les autres requetes et le clic sur Stop restait
// sans effet visible pendant 30s. Ces actions doivent toujours repondre vite
// (le handler cote serveur est un simple set d'un flag en memoire) ou echouer
// vite avec un message clair, jamais rester silencieuses.
async function controlAction(taskId: string, action: 'stop' | 'pause' | 'resume'): Promise<{ success: boolean }> {
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), 8000)
  try {
    const res = await fetch(`/api/tasks/${taskId}/${action}`, { method: 'POST', signal: controller.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json() as { success: boolean }
  } finally {
    clearTimeout(t)
  }
}

export const taskAPI = {
  getStatus: (taskId: string) =>
    apiClient
      .get<{
        id: string
        status: string
        progress: number
        message: string
        error: string | null
        result: {
          anomalies?: GuidedTrackingAnomaly[]
          total_annotations_created?: number
          processed_frames?: number
        } | null
      }>(`/api/tasks/${taskId}`)
      .then((r) => r.data),

  // Logs temps réel de l'algo (mêmes lignes que le terminal), incrémentiel.
  getLogs: (taskId: string, since = 0) =>
    apiClient
      .get<{ lines: string[]; next: number }>(`/api/tasks/${taskId}/logs`, { params: { since } })
      .then((r) => r.data),

  stop: (taskId: string) => controlAction(taskId, 'stop'),
  pause: (taskId: string) => controlAction(taskId, 'pause'),
  resume: (taskId: string) => controlAction(taskId, 'resume'),
}

export interface GuidedTrackingAnomaly {
  frame_index: number
  frame_id: number
  type: 'missing' | 'size_variation' | 'detection_error'
  target_annotation_id?: number
  target_class_id?: number
  variation?: number
  message?: string
}

// ---- Paramètres utilisateur ----

// ---- Sequences d'exemple livrees avec l'application ----

export interface SampleSequence {
  id: string
  path: string          // Chemin absolu TEL QUE VU PAR LE BACKEND
  exists: boolean
  frame_count: number
  first_frame: string | null
}

export const samplesAPI = {
  list: () =>
    apiClient.get<SampleSequence[]>('/api/samples/sequences').then((r) => r.data),

  get: (id: string) =>
    apiClient.get<SampleSequence>(`/api/samples/sequences/${id}`).then((r) => r.data),
}

export const settingsAPI = {
  get: () =>
    apiClient.get<UserSettings>('/api/settings').then((r) => r.data),

  update: (data: Partial<UserSettings>) =>
    apiClient.put<UserSettings>('/api/settings', data).then((r) => r.data),

  reset: () =>
    apiClient.post<UserSettings>('/api/settings/reset').then((r) => r.data),
}

// ---- Stockage disque ----

export interface StorageStats {
  backup_mb: number
  projects_mb: number
  exports_mb: number
  backup_path: string
  projects_path: string
  exports_path: string
}

export const storageAPI = {
  getStats: () =>
    apiClient.get<StorageStats>('/api/storage/stats').then((r) => r.data),

  clearBackup: () =>
    apiClient.delete<{ success: boolean }>('/api/storage/backup').then((r) => r.data),

  clearExports: () =>
    apiClient.delete<{ success: boolean }>('/api/storage/exports').then((r) => r.data),
}

// ---- Backup / Restore annotations ----

export const backupAPI = {
  get: (projectId: number) =>
    apiClient.get<Record<string, unknown>>(`/api/projects/${projectId}/backup`).then((r) => r.data),

  restore: (projectId: number, backup: Record<string, unknown>) =>
    apiClient
      .post<{ success: boolean; restored_count: number }>(`/api/projects/${projectId}/restore`, backup)
      .then((r) => r.data),
}

// ---- Export ----

export const exportAPI = {
  start: (
    projectId: number,
    options: {
      format?: string
      output_format?: 'yolo' | 'ver' | 'coco'   // yolo/coco = sous-dossier par séquence | ver = fichier .ver par séquence
      split_train?: number
      split_val?: number
      split_test?: number
      include_unannotated?: boolean
      class_filter?: number[]
      export_name?: string
      symlink_images?: boolean
      custom_export_dir?: string
    }
  ) =>
    apiClient
      .post<{ task_id: string; status: string }>(`/api/projects/${projectId}/export`, options)
      .then((r) => r.data),

  getStatus: (taskId: string) =>
    apiClient.get<ExportTask>(`/api/exports/${taskId}/status`).then((r) => r.data),

  getDownloadUrl: (taskId: string) => `${BASE_URL}/api/exports/${taskId}/download`,

  preview: (projectId: number) =>
    apiClient
      .get<{
        total_frames: number
        annotated_frames: number
        class_stats: Array<{ class_name: string; annotation_count: number }>
        ready_to_export: boolean
        preview_yaml: Record<string, unknown>
      }>(`/api/projects/${projectId}/export/preview`)
      .then((r) => r.data),
}

// ---- App mode ----

export const appModeAPI = {
  get: () =>
    apiClient
      .get<{ mode: 'orchestrator' | 'solo'; exports_dir: string; workspace: string }>('/api/app-mode')
      .then((r) => r.data),
}
