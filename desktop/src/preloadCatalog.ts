// ============================================================
// desktop/src/preloadCatalog.ts
// Surface exposee a l'UI catalogue (ui/catalog.html) -- sandboxee,
// contextIsolation on. Uniquement des appels IPC typés, jamais d'acces
// direct a fs/child_process depuis le renderer.
// ============================================================

import { contextBridge, ipcRenderer } from 'electron'
import type { AppDef } from './catalog'
import type { LauncherSettings, TutorialState } from './settings'

contextBridge.exposeInMainWorld('cvLauncher', {
  listApps: (): Promise<AppDef[]> => ipcRenderer.invoke('cv:list-apps'),
  getSettings: (): Promise<LauncherSettings> => ipcRenderer.invoke('cv:get-settings'),
  saveSettings: (s: LauncherSettings): Promise<void> => ipcRenderer.invoke('cv:save-settings', s),
  launch: (appId: string): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('cv:launch', appId),
  // Tutoriel interactif : etat persiste dans les reglages du lanceur (Roaming).
  getTutorial: (key: string): Promise<TutorialState> => ipcRenderer.invoke('cv:get-tutorial', key),
  setTutorial: (key: string, patch: Partial<TutorialState>): Promise<TutorialState> =>
    ipcRenderer.invoke('cv:set-tutorial', key, patch),
  openDocs: (): Promise<void> => ipcRenderer.invoke('cv:open-docs'),
  openLogsFolder: (): Promise<void> => ipcRenderer.invoke('cv:open-logs-folder'),
  quit: (): Promise<void> => ipcRenderer.invoke('cv:quit'),
  toggleDevTools: (): Promise<void> => ipcRenderer.invoke('cv:toggle-devtools'),
  checkMount: (host: string): Promise<{ ok: boolean; shares: string[]; error?: string }> =>
    ipcRenderer.invoke('cv:check-mount', host),
  onLog: (cb: (appId: string, line: string) => void): void => {
    ipcRenderer.on('cv:log', (_e, appId: string, line: string) => cb(appId, line))
  },
  onStatus: (cb: (appId: string, status: string, detail: string) => void): void => {
    ipcRenderer.on('cv:app-status', (_e, appId: string, status: string, detail: string) => cb(appId, status, detail))
  },
  switchTab: (appId: string | null): Promise<void> => ipcRenderer.invoke('cv:switch-tab', appId),
  closeTab: (appId: string): Promise<void> => ipcRenderer.invoke('cv:close-tab', appId),
  stopApp: (appId: string): Promise<void> => ipcRenderer.invoke('cv:stop-app', appId),
  detachTab: (appId: string, screenX: number, screenY: number): Promise<void> =>
    ipcRenderer.invoke('cv:detach-tab', appId, screenX, screenY),
  dockTab: (appId: string): Promise<void> => ipcRenderer.invoke('cv:dock-tab', appId),
  reorderTabs: (order: string[]): Promise<void> => ipcRenderer.invoke('cv:reorder-tabs', order),
  setSubAppsFlyout: (open: boolean): Promise<void> => ipcRenderer.invoke('cv:set-subapps-flyout', open),
  showSubAppsMenu: (): Promise<void> => ipcRenderer.invoke('cv:show-subapps-menu'),
  reportContentBounds: (bounds: { x: number; y: number; width: number; height: number }): Promise<void> =>
    ipcRenderer.invoke('cv:report-content-bounds', bounds),
  setShellOverlay: (open: boolean): Promise<void> => ipcRenderer.invoke('cv:set-shell-overlay', open),
  onTabs: (cb: (tabs: TabInfo[], activeId: string | null, layout?: LayoutInfo) => void): void => {
    ipcRenderer.on('cv:tabs', (_e, tabs, activeId, layout) => cb(tabs, activeId, layout))
  },
  // Dock / split (2 ou 4 vues in-window) -- mode composition guide
  setLayoutMode: (mode: 'single' | 'v2' | 'h2' | 'grid4'): Promise<void> => ipcRenderer.invoke('cv:set-layout-mode', mode),
  beginDockCompose: (mode: 'v2' | 'h2' | 'grid4'): Promise<Array<{ x: number; y: number; width: number; height: number }>> =>
    ipcRenderer.invoke('cv:begin-dock-compose', mode),
  applyDock: (mode: 'single' | 'v2' | 'h2' | 'grid4', panes: (string | null)[]): Promise<void> =>
    ipcRenderer.invoke('cv:apply-dock', mode, panes),
  resizeDock: (axis: 'x' | 'y', ratio: number): Promise<void> =>
    ipcRenderer.invoke('cv:resize-dock', axis, ratio),
  toggleActiveSidebar: (): Promise<boolean> => ipcRenderer.invoke('cv:toggle-active-sidebar'),
  cancelDock: (): Promise<void> => ipcRenderer.invoke('cv:cancel-dock'),
  onDockHint: (cb: (appId: string | null) => void): void => {
    ipcRenderer.on('cv:dock-hint', (_e, appId) => cb(appId))
  },
  openOrchestratorSubApp: (subAppId: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('cv:open-orchestrator-subapp', subAppId),
  openOrchestratorSubAppInBrowser: (subAppId: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('cv:open-orchestrator-subapp-browser', subAppId),
  launchOrchestratorSubApp: (subAppId: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('cv:launch-orchestrator-subapp', subAppId),
  launchAllOrchestratorSubApps: (): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('cv:launch-all-orchestrator-subapps'),
  onOrchestratorSubApps: (cb: (apps: OrchestratorSubApp[]) => void): void => {
    ipcRenderer.on('cv:orchestrator-subapps', (_e, apps) => cb(apps))
  },
  getTabUrl: (appId: string): Promise<string | null> => ipcRenderer.invoke('cv:get-tab-url', appId),
  copyTabUrl: (appId: string): Promise<boolean> => ipcRenderer.invoke('cv:copy-tab-url', appId),
  openTabInBrowser: (appId: string): Promise<boolean> => ipcRenderer.invoke('cv:open-tab-in-browser', appId),
  scanPorts: (): Promise<PortScanResult> => ipcRenderer.invoke('cv:scan-ports'),
  killPort: (target: 'local' | 'remote', port: number): Promise<boolean> =>
    ipcRenderer.invoke('cv:kill-port', target, port),
  killAll: (): Promise<{ stopped: number; ports: number }> => ipcRenderer.invoke('cv:kill-all'),
})

interface TabInfo {
  appId: string
  label: string
  icon: string
  location: 'docked' | 'detached'
  native: { supported: boolean; active: boolean; reason: string }
}

interface LayoutInfo {
  mode: 'single' | 'v2' | 'h2' | 'grid4'
  panes: (string | null)[]
  ratioX?: number
  ratioY?: number
}

interface PortRow { port: number; pid: number; process: string }
interface PortScanResult {
  local: PortRow[]
  remote: { vm: string; rows: PortRow[] } | null
  known: { port: number; label: string }[]
}

interface OrchestratorSubApp {
  app_id: string
  label: string
  launched: boolean
  status: string
  backend_url: string | null
  frontend_url: string | null
}
