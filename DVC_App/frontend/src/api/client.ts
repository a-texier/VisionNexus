// ============================================================
// api/client.ts — axios + SSE helper
// ============================================================

import axios from 'axios'
import type {
  AppSettings, BranchInfo, Commit, DVCDiff, DVCRemote, DVCStatus,
  RepoStatusInfo, SyncEvent, TrackedFile,
} from '../types/api'

const http = axios.create({ baseURL: '', timeout: 30_000 })

const _backendPort = import.meta.env.VITE_BACKEND_PORT ?? '8002'
export const BACKEND_BASE = import.meta.env.DEV ? `http://localhost:${_backendPort}` : ''

// ------------------------------------------------------------------ //
// Datasets                                                            //
// ------------------------------------------------------------------ //
export const datasetsAPI = {
  list:   (): Promise<TrackedFile[]> => http.get('/api/datasets').then(r => r.data),
  status: (): Promise<DVCStatus>     => http.get('/api/status').then(r => r.data),
  branch: (): Promise<BranchInfo>    => http.get('/api/branch').then(r => r.data),
}

// ------------------------------------------------------------------ //
// Repo / remotes (état réel : chemin repo, remotes configurés)        //
// ------------------------------------------------------------------ //
export const repoAPI = {
  status:  (): Promise<RepoStatusInfo> => http.get('/api/orchestrator/status').then(r => r.data),
  remotes: (): Promise<{ remotes: DVCRemote[]; repo_path: string; repo_exists: boolean }> =>
    http.get('/api/remotes').then(r => r.data),
  diskUsage: (): Promise<{
    repo_exists: boolean; repo_path: string
    cache_bytes?: number; working_bytes?: number; cache_type?: string; linked?: boolean
  }> => http.get('/api/disk-usage').then(r => r.data),
  relink: (): Promise<{ ok: boolean; output?: string; error?: string }> =>
    http.post('/api/relink').then(r => r.data),
  addRemote: (name: string, url: string, def = true): Promise<{ ok: boolean; name?: string; url?: string; error?: string }> =>
    http.post('/api/remotes', { name, url, default: def }).then(r => r.data),
}

// ------------------------------------------------------------------ //
// Commits / Diff / Checkout                                           //
// ------------------------------------------------------------------ //
export const commitsAPI = {
  list:     (n = 50): Promise<Commit[]> =>
    http.get('/api/commits', { params: { n } }).then(r => r.data),

  diff:     (rev_a: string, rev_b: string): Promise<DVCDiff> =>
    http.get('/api/diff', { params: { rev_a, rev_b } }).then(r => r.data),

  checkout: (rev: string): Promise<{ ok: boolean; rev: string }> =>
    http.post('/api/checkout', { rev }).then(r => r.data),
}

// ------------------------------------------------------------------ //
// Settings                                                            //
// ------------------------------------------------------------------ //
export const settingsAPI = {
  get:    (): Promise<AppSettings>           => http.get('/api/settings').then(r => r.data),
  update: (data: Partial<AppSettings>): Promise<AppSettings> =>
    http.put('/api/settings', data).then(r => r.data),
}

// ------------------------------------------------------------------ //
// SSE sync (POST → ReadableStream, connexion directe backend)        //
// ------------------------------------------------------------------ //
export function startSync(
  action: 'push' | 'pull',
  onEvent: (e: SyncEvent) => void,
  onDone: () => void,
): () => void {
  let cancelled = false
  const controller = new AbortController()

  fetch(`${BACKEND_BASE}/api/${action}`, {
    method: 'POST',
    signal: controller.signal,
  })
    .then(async response => {
      if (!response.ok || !response.body) {
        onEvent({ type: 'error', message: `HTTP ${response.status}` })
        onDone()
        return
      }
      const reader  = response.body.getReader()
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
              const evt: SyncEvent = JSON.parse(line.slice(6))
              onEvent(evt)
              if (evt.type === 'done' || evt.type === 'error') {
                onDone()
                return
              }
            } catch { /* ignorer JSON malformé */ }
          }
        }
      }
      onDone()
    })
    .catch(err => {
      if (!cancelled) onEvent({ type: 'error', message: String(err) })
      onDone()
    })

  return () => {
    cancelled = true
    controller.abort()
  }
}
