// ============================================================
// api/client.ts
// ============================================================

import axios from 'axios'
import type {
  AppSettings, EnginesResponse, LogEvent, StartBody, StudyAnalysis, StudySummary, StudyStatus_API, Trial,
} from '../types/api'

const http = axios.create({ baseURL: '', timeout: 30_000 })

const _backendPort = import.meta.env.VITE_BACKEND_PORT ?? '8003'
export const BACKEND_BASE = import.meta.env.DEV ? `http://localhost:${_backendPort}` : ''

// ------------------------------------------------------------------ //
// Studies                                                             //
// ------------------------------------------------------------------ //
export const studiesAPI = {
  list: (): Promise<StudySummary[]> =>
    http.get('/api/studies').then(r => r.data),

  create: (study_name: string, direction: string): Promise<{ study_name: string; direction: string }> =>
    http.post('/api/studies', { study_name, direction }).then(r => r.data),

  delete: (study_name: string): Promise<{ ok: boolean }> =>
    http.delete(`/api/studies/${encodeURIComponent(study_name)}`).then(r => r.data),

  trials: (study_name: string): Promise<Trial[]> =>
    http.get(`/api/studies/${encodeURIComponent(study_name)}/trials`).then(r => r.data),

  best: (study_name: string): Promise<Trial> =>
    http.get(`/api/studies/${encodeURIComponent(study_name)}/best`).then(r => r.data),

  start: (study_name: string, body: StartBody): Promise<{ ok: boolean }> =>
    http.post(`/api/studies/${encodeURIComponent(study_name)}/start`, body).then(r => r.data),

  stop: (study_name: string): Promise<{ ok: boolean }> =>
    http.post(`/api/studies/${encodeURIComponent(study_name)}/stop`).then(r => r.data),

  status: (study_name: string): Promise<StudyStatus_API> =>
    http.get(`/api/studies/${encodeURIComponent(study_name)}/status`).then(r => r.data),

  analysis: (study_name: string): Promise<StudyAnalysis> =>
    http.get(`/api/studies/${encodeURIComponent(study_name)}/analysis`).then(r => r.data),
}

// ------------------------------------------------------------------ //
// Moteurs d'entrainement (preremplissage d'une etude)                 //
// ------------------------------------------------------------------ //
export const enginesAPI = {
  list: (): Promise<EnginesResponse> =>
    http.get('/api/orchestrator/engines').then(r => r.data),
}

// ------------------------------------------------------------------ //
// Settings                                                            //
// ------------------------------------------------------------------ //
export const settingsAPI = {
  get:    (): Promise<AppSettings> => http.get('/api/settings').then(r => r.data),
  update: (d: Partial<AppSettings>): Promise<AppSettings> =>
    http.put('/api/settings', d).then(r => r.data),
}

// ------------------------------------------------------------------ //
// SSE logs (connexion directe backend pour éviter buffering proxy)   //
// ------------------------------------------------------------------ //
export function streamLogs(
  study_name: string,
  onEvent: (e: LogEvent) => void,
  onDone:  () => void,
): () => void {
  let cancelled = false
  const controller = new AbortController()

  fetch(`${BACKEND_BASE}/api/studies/${encodeURIComponent(study_name)}/logs`, {
    signal: controller.signal,
  })
    .then(async res => {
      if (!res.ok || !res.body) { onDone(); return }
      const reader  = res.body.getReader()
      const decoder = new TextDecoder()
      let   buf     = ''

      while (!cancelled) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const parts = buf.split('\n\n')
        buf = parts.pop() ?? ''
        for (const part of parts) {
          const line = part.trim()
          if (line.startsWith('data: ')) {
            try {
              const evt: LogEvent = JSON.parse(line.slice(6))
              onEvent(evt)
              if (evt.type === 'done') { onDone(); return }
            } catch { /* ignorer */ }
          }
        }
      }
      onDone()
    })
    .catch(() => { if (!cancelled) onDone() })

  return () => { cancelled = true; controller.abort() }
}
