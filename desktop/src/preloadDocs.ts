// ============================================================
// desktop/src/preloadDocs.ts
// Preload de la fenetre Documentation -- surface separee du catalogue et
// des fenetres d'app, sandboxee, contextIsolation on.
// ============================================================

import { contextBridge, ipcRenderer } from 'electron'

export interface AppDocFile {
  title: string
  content: string
}

export interface AppDocEntry {
  appId: string
  label: string
  icon: string
  files: AppDocFile[]
}

contextBridge.exposeInMainWorld('cvDocs', {
  listAppDocs: (): Promise<AppDocEntry[]> => ipcRenderer.invoke('cv:list-app-docs'),
})
