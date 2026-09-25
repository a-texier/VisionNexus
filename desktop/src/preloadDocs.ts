// ============================================================
// desktop/src/preloadDocs.ts
// Preload de la fenetre Documentation -- surface separee du catalogue et
// des fenetres d'app, sandboxee, contextIsolation on.
// ============================================================

import { contextBridge, ipcRenderer } from 'electron'
import type { ServiceStatus, ServiceError, IndexSummary, SearchResult } from './services'

export interface AppDocFile {
  file: string            // nom de base sans .md/.fr.md, ex. 'user-guide' (cible des liens entre pages)
  lang: 'fr' | 'en'       // langue du fichier reellement charge (repli possible sur l'autre)
  title: string           // frontmatter `title`, sinon `file`
  content: string         // corps markdown, frontmatter retire
  baseUrl: string         // file:// du dossier du fichier, pour resoudre les images relatives
  order?: number
  docType?: string
  audience?: string
}

export interface AppDocEntry {
  appId: string
  /** Dossier de l'app dans le depot ("Orchestrator_App"), cible des liens entre apps. */
  dir: string
  label: string
  icon: string
  files: AppDocFile[]
}

export interface DocsSearchRequest {
  q: string
  lang?: 'fr' | 'en' | 'both'
  apps?: string[]
  audience?: 'user' | 'dev' | 'all'
  k?: number
  prefer?: 'fr' | 'en'
}

// Le renderer ne parle jamais au service : tout passe par ces appels IPC, qui
// valident les entrees et renvoient {ok:false, error, message} au lieu de lever.
contextBridge.exposeInMainWorld('cvDocs', {
  listAppDocs: (lang?: 'fr' | 'en'): Promise<AppDocEntry[]> => ipcRenderer.invoke('cv:list-app-docs', lang),
  docsServiceStatus: (): Promise<ServiceStatus> => ipcRenderer.invoke('cv:docs-service-status'),
  startDocsService: (): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('cv:docs-service-start'),
  stopDocsService: (): Promise<void> => ipcRenderer.invoke('cv:docs-service-stop'),
  onDocsServiceStatus: (cb: (status: ServiceStatus) => void): void => {
    ipcRenderer.on('cv:docs-service-status', (_e, status: ServiceStatus) => cb(status))
  },
  docsSearch: (request: DocsSearchRequest): Promise<{ ok: true; result: SearchResult } | ServiceError> =>
    ipcRenderer.invoke('cv:docs-search', request),
  docsIndexStatus: (): Promise<{ ok: true; index: IndexSummary } | ServiceError> =>
    ipcRenderer.invoke('cv:docs-index-status'),
  docsSync: (): Promise<{ ok: true; started: boolean } | ServiceError> => ipcRenderer.invoke('cv:docs-sync'),
  onShowTab: (cb: (tab: string) => void): void => {
    ipcRenderer.on('cv:docs-show-tab', (_e, tab: string) => cb(tab))
  },
})
