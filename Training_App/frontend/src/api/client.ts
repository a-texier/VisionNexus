// ============================================================
// api/client.ts — Training_App
// ============================================================

import axios from 'axios'
import type { AppMode, Capabilities, ModelCatalog, StartTrainingRequest, TrainingEvent, TrainingRun } from '../types/api'

const http = axios.create({ baseURL: '', timeout: 30_000 })

// Backend direct (SSE bypass proxy)
const BACKEND_PORT = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_BACKEND_PORT ?? '8064'
export const SSE_BASE = `http://localhost:${BACKEND_PORT}`

// ── Training runs ─────────────────────────────────────────────────────────────

export const trainingAPI = {
  start: (body: StartTrainingRequest): Promise<{ run_name: string; run_id: number; status: string; engine: string; ignored_hyperparams: string[] }> =>
    http.post('/api/training/start', body).then(r => r.data),

  list: (): Promise<TrainingRun[]> =>
    http.get('/api/training/runs').then(r => r.data),

  status: (runName: string): Promise<TrainingRun> =>
    http.get(`/api/training/${runName}/status`).then(r => r.data),

  stop: (runName: string): Promise<{ ok: boolean }> =>
    http.post(`/api/training/${runName}/stop`).then(r => r.data),

  delete: (runName: string): Promise<{ ok: boolean }> =>
    http.delete(`/api/training/${runName}`).then(r => r.data),

  models: (engine: string): Promise<ModelCatalog> =>
    http.get('/api/training/models', { params: { engine } }).then(r => r.data),

  capabilities: (): Promise<Capabilities> =>
    http.get('/api/capabilities').then(r => r.data),

  metricsHistory: (runName: string): Promise<{ epochs: EpochMetrics[] }> =>
    http.get(`/api/training/${runName}/metrics-history`).then(r => r.data),

  artifacts: (runName: string): Promise<ArtifactList> =>
    http.get(`/api/training/${runName}/artifacts`).then(r => r.data),

  inferenceCases: (runName: string): Promise<InferenceCases> =>
    http.get(`/api/training/${runName}/inference-cases`).then(r => r.data),
}

// URL directe d'un artefact image (galerie). On encode chaque segment mais on
// conserve les '/' (la route backend est {name:path}, ex. inference_cases/best_0.jpg).
export function artifactUrl(runName: string, name: string): string {
  const path = name.split('/').map(encodeURIComponent).join('/')
  return `${SSE_BASE}/api/training/${encodeURIComponent(runName)}/artifact/${path}`
}

// Categories declarees par le moteur du run (CATALOG["artifacts"]) : les
// cles ci-dessous sont les categories connues, un moteur peut en omettre.
export interface ArtifactList {
  summary?: string[]
  confusion?: string[]
  curves?: string[]
  labels?: string[]
  train_batches?: string[]
  val_labels?: string[]
  val_predictions?: string[]
  engine: string
  engine_error?: string
  run_dir: string
}

export interface InferenceCase {
  file: string
  source: string
  detections: number
  mean_conf: number
}
export interface InferenceCases {
  run_name: string
  val_dir: string
  n_images_scored: number
  best: InferenceCase[]
  worst: InferenceCase[]
}

export interface EpochMetrics {
  epoch: number
  map50: number | null
  map5095: number | null
  precision: number | null
  recall: number | null
  box_loss: number | null
  cls_loss: number | null
}

// ── App mode ──────────────────────────────────────────────────────────────────

export const appModeAPI = {
  get: (): Promise<AppMode> =>
    http.get('/api/app-mode').then(r => r.data),
}

// ── SSE stream ────────────────────────────────────────────────────────────────

export function streamTrainingEvents(
  runName: string,
  onEvent: (evt: TrainingEvent) => void,
  onDone?: () => void,
): () => void {
  let closed = false
  const url = `${SSE_BASE}/api/training/${runName}/events`

  async function connect() {
    try {
      const response = await fetch(url)
      if (!response.body || closed) return
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (!closed) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const evt = JSON.parse(line.slice(6)) as TrainingEvent
              onEvent(evt)
              if (evt.type === 'done' || evt.type === 'error' || evt.type === 'stopped') {
                onDone?.()
                return
              }
            } catch { /* noop */ }
          }
        }
      }
    } catch {
      if (!closed) setTimeout(connect, 2000)
    }
  }

  connect()
  return () => { closed = true }
}
