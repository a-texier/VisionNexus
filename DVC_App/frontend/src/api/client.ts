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
// 127.0.0.1 et pas localhost : le cookie de session est pose pour 127.0.0.1,
// et un navigateur traite ces deux noms comme deux sites distincts.
export const BACKEND_BASE = import.meta.env.DEV ? `http://127.0.0.1:${_backendPort}` : ''

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
    // Autre port que la page : sans ca le navigateur n'envoie pas le cookie de session.
    credentials: 'include',
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

// ------------------------------------------------------------------ //
// Documentation (pages markdown de DVC_App/docs/)                    //
// ------------------------------------------------------------------ //
export type DocLang = 'en' | 'fr'

export interface DocPageInfo {
  name: string
  title: string
  order: number
  audience: string
  doc_type: string
  langs: DocLang[]
}

export interface DocPage {
  name: string
  lang: DocLang
  title: string
  frontmatter: Record<string, unknown>
  body: string
}

export const docsAPI = {
  list: (lang: DocLang): Promise<DocPageInfo[]> =>
    http.get('/api/docs', { params: { lang } }).then(r => r.data),
  get: (name: string, lang: DocLang): Promise<DocPage> =>
    http.get(`/api/docs/${encodeURIComponent(name)}`, { params: { lang } }).then(r => r.data),
  // Chemin relatif au dossier docs/assets/, tel qu'ecrit dans le markdown.
  getAssetUrl: (path: string): string => `/api/docs/assets/${path}`,
}
