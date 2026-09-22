// ============================================================
// api/client.ts
// ============================================================

import axios from 'axios'
import type {
  AppSettings, ActivityRun, PipelineDef, RunEvent,
  RunStartResponse, RunStatusResponse, Experiment,
  SandGraph, GraphRunResponse, AppLaunchStatus, EnginesResponse,
} from '../types/api'

const http = axios.create({ baseURL: '', timeout: 30_000 })

// BACKEND_BASE = '' TOUJOURS → URL relative, passe par le proxy Vite (même origine),
// comme axios ci-dessus. AVANT : en DEV c'était `http://localhost:${port}` (URL ABSOLUE)
// → quand l'app est ouverte via l'IP réseau (ex. http://192.168.1.89:3000, accès LAN),
// le fetch SSE devenait CROSS-ORIGIN (192.168.1.89 ≠ localhost) → bloqué CORS → AUCUN
// event de progression ne remontait → nodes figés « tout gris » + logs vides pendant un
// run (bug remonté par Bob 2026-07). Le SSE doit rester même-origine comme le reste.
export const BACKEND_BASE = ''

// ------------------------------------------------------------------ //
// Health                                                              //
// ------------------------------------------------------------------ //
export const healthAPI = {
  get: () => http.get('/api/health').then(r => r.data),
}

// ------------------------------------------------------------------ //
// Pipelines                                                           //
// ------------------------------------------------------------------ //
export const pipelinesAPI = {
  list: (): Promise<PipelineDef[]> =>
    http.get('/api/pipelines').then(r => r.data),

  get: (id: string): Promise<PipelineDef> =>
    http.get(`/api/pipelines/${id}`).then(r => r.data),

  create: (name: string, steps: object[]): Promise<PipelineDef> =>
    http.post('/api/pipelines', { name, steps }).then(r => r.data),

  update: (id: string, name: string, steps: object[]): Promise<PipelineDef> =>
    http.put(`/api/pipelines/${id}`, { name, steps }).then(r => r.data),

  delete: (id: string): Promise<{ ok: boolean }> =>
    http.delete(`/api/pipelines/${id}`).then(r => r.data),

  startRun: (id: string): Promise<RunStartResponse> =>
    http.post(`/api/pipelines/${id}/run`).then(r => r.data),

  getStatus: (id: string, runId: string): Promise<RunStatusResponse> =>
    http.get(`/api/pipelines/${id}/status/${runId}`).then(r => r.data),
}

// ------------------------------------------------------------------ //
// Activity                                                            //
// ------------------------------------------------------------------ //
export const activityAPI = {
  get: (limit = 50): Promise<ActivityRun[]> =>
    http.get('/api/activity', { params: { limit } }).then(r => r.data),
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
// Experiments                                                        //
// ------------------------------------------------------------------ //
export const experimentsAPI = {
  list: (): Promise<Experiment[]> =>
    http.get('/api/experiments').then(r => r.data),

  get: (id: string): Promise<Experiment> =>
    http.get(`/api/experiments/${id}`).then(r => r.data),

  resume: (id: string): Promise<{ ok: boolean; run_id: string }> =>
    http.post(`/api/experiments/${id}/resume`).then(r => r.data),
}

// ------------------------------------------------------------------ //
// Moteurs d'entrainement (catalogues de Training_App)                //
// ------------------------------------------------------------------ //
export const enginesAPI = {
  list: (): Promise<EnginesResponse> =>
    http.get('/api/engines').then(r => r.data),
}

// ------------------------------------------------------------------ //
// Sandgraph                                                          //
// ------------------------------------------------------------------ //
export const graphsAPI = {
  list: (): Promise<SandGraph[]> =>
    http.get('/api/graphs').then(r => r.data),

  create: (name: string, nodes: object[], edges: object[]): Promise<SandGraph> =>
    http.post('/api/graphs', { name, nodes, edges }).then(r => r.data),

  get: (id: string): Promise<SandGraph> =>
    http.get(`/api/graphs/${id}`).then(r => r.data),

  update: (id: string, body: { name?: string; nodes?: object[]; edges?: object[] }): Promise<SandGraph> =>
    http.put(`/api/graphs/${id}`, body).then(r => r.data),

  delete: (id: string): Promise<void> =>
    http.delete(`/api/graphs/${id}`).then(() => {}),

  duplicate: (id: string): Promise<SandGraph> =>
    http.post(`/api/graphs/${id}/duplicate`).then(r => r.data),

  forkRun: (graphId: string, runId: string): Promise<{ graph_id: string; name: string }> =>
    http.post(`/api/graphs/${graphId}/fork-run`, { run_id: runId }).then(r => r.data),

  // Promeut un graphe en MLOps : injecte la paire couplee MLflow + DVC manquante.
  trackMlops: (graphId: string): Promise<SandGraph & { added: string[] }> =>
    http.post(`/api/graphs/${graphId}/track-mlops`).then(r => r.data),

  reset: (id: string): Promise<{ ok: boolean }> =>
    http.post(`/api/graphs/${id}/reset`).then(r => r.data),

  stop: (id: string): Promise<{ ok: boolean; stopped: boolean; run_id: string | null }> =>
    http.post(`/api/graphs/${id}/stop`).then(r => r.data),

  run: (id: string): Promise<GraphRunResponse> =>
    http.post(`/api/graphs/${id}/run`).then(r => r.data),

  resume: (id: string): Promise<{ ok: boolean; run_id: string; step_node_map: Record<string, string> }> =>
    http.post(`/api/graphs/${id}/resume`).then(r => r.data),

  getAppUrls: (): Promise<Record<string, string>> =>
    http.get('/api/graphs/meta/app-urls').then(r => r.data),

  getVisuSubsets: (): Promise<{ id: number; name: string; image_count: number }[]> =>
    http.get('/api/graphs/meta/explorer-subsets').then(r => r.data),

  getAnnotationExports: (projectName: string): Promise<{ id: number; project_name: string; format: string; created_at: string; path?: string }[]> =>
    http.get('/api/graphs/meta/annotation-exports', { params: { project_name: projectName } }).then(r => r.data),

  checkDatasetPath: (path: string): Promise<{ id: number; name: string; image_count: number; status: string }[]> =>
    http.get('/api/graphs/meta/check-dataset-path', { params: { path } }).then(r => r.data),

  checkAnnotationSource: (subsetName: string, projectName = ''): Promise<{ id: number; name: string; frame_count: number; annotated_count: number }[]> =>
    http.get('/api/graphs/meta/check-annotation-source', { params: { subset_name: subsetName, project_name: projectName } }).then(r => r.data),

  getWorkspaceOutputs: (): Promise<{
    subsets: { name: string; image_count: number }[]
    exports: { name: string; format: 'yolo' | 'ver'; created_at: string }[]
  }> =>
    http.get('/api/graphs/meta/workspace-outputs').then(r => r.data),
}

// ------------------------------------------------------------------ //
// Insights                                                            //
// ------------------------------------------------------------------ //
export const insightsAPI = {
  list: (): Promise<{ graph_id: string; graph_name: string; run_id: string; generated_at: string; plots: string[] }[]> =>
    http.get('/api/insights').then(r => r.data),

  get: (graphId: string, runId: string): Promise<{
    trainings?: unknown[]; optuna?: unknown[]; steps?: unknown[]
    mlflow?: { runs?: unknown[]; experiments?: unknown[] }
    dvc?: { commits?: unknown[] }
    lineage?: Record<string, unknown>
    reproducibility?: { reproducible: boolean; checks: { key: string; label: string; ok: boolean; detail: string }[] }
  }> =>
    http.get(`/api/insights/${graphId}/${runId}`).then(r => r.data),

  generate: (graphId: string, runId?: string): Promise<{ ok: boolean; run_id: string; plots: string[] }> =>
    http.post(`/api/insights/${graphId}/generate`, { run_id: runId ?? null }).then(r => r.data),

  delete: (graphId: string, runId: string): Promise<void> =>
    http.delete(`/api/insights/${graphId}/${runId}`).then(() => {}),
}

// ------------------------------------------------------------------ //
// Experiment Plans                                                    //
// ------------------------------------------------------------------ //
export interface PlanStep { id: string; label: string; base_graph_id: string; overrides: Record<string, unknown> }
export interface PlanRunResult { step_id: string; label: string; status: string; graph_id?: string; run_id?: string; dvc_version?: string; git_commit?: string; map50?: number; error?: string }
export interface PlanRunState { status: string; started_at?: string; finished_at?: string | null; current?: number; total?: number; results?: PlanRunResult[] }
export interface Plan { plan_id: string; name: string; created_at: string; updated_at: string; steps: PlanStep[]; last_run?: PlanRunState | null }

export const plansAPI = {
  list: (): Promise<Plan[]> => http.get('/api/plans').then(r => r.data),
  get: (id: string): Promise<Plan> => http.get(`/api/plans/${id}`).then(r => r.data),
  create: (name: string, steps: Omit<PlanStep, 'id'>[]): Promise<Plan> =>
    http.post('/api/plans', { name, steps }).then(r => r.data),
  update: (id: string, name: string, steps: PlanStep[]): Promise<Plan> =>
    http.put(`/api/plans/${id}`, { name, steps }).then(r => r.data),
  delete: (id: string): Promise<void> => http.delete(`/api/plans/${id}`).then(() => {}),
  run: (id: string): Promise<{ ok: boolean; message?: string }> =>
    http.post(`/api/plans/${id}/run`).then(r => r.data),
  status: (id: string): Promise<PlanRunState> => http.get(`/api/plans/${id}/status`).then(r => r.data),
}

// ------------------------------------------------------------------ //
// App launcher                                                        //
// ------------------------------------------------------------------ //
export const launcherAPI = {
  list: (): Promise<Record<string, AppLaunchStatus>> =>
    http.get('/api/apps').then(r => r.data),

  launch: (app_id: string, opts?: { base_workspace?: string; user?: string; conda_env?: string }): Promise<{ ok: boolean; frontend_url: string }> =>
    http.post('/api/apps/launch', { app_id, ...opts }).then(r => r.data),

  stop: (app_id: string): Promise<{ ok: boolean }> =>
    http.post(`/api/apps/${app_id}/stop`).then(r => r.data),

  launchAll: (opts?: { conda_env?: string }): Promise<{ launched: string[]; errors: object[] }> =>
    http.post('/api/apps/launch-all', { app_id: '__all__', ...opts }).then(r => r.data),

  stopAll: (): Promise<{ stopped: string[] }> =>
    http.post('/api/apps/stop-all').then(r => r.data),
}

// ------------------------------------------------------------------ //
// SSE — connexion directe backend (bypass Vite proxy buffering)      //
// ------------------------------------------------------------------ //
export function streamRun(
  pipelineId: string,
  runId: string,
  onEvent: (e: RunEvent) => void,
  onDone: () => void,
): () => void {
  let cancelled = false
  const controller = new AbortController()

  fetch(`${BACKEND_BASE}/api/pipelines/${pipelineId}/run/${runId}/stream`, {
    signal: controller.signal,
  })
    .then(async res => {
      if (!res.ok || !res.body) { onDone(); return }
      const reader  = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''

      while (!cancelled) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const parts = buf.split('\n\n')
        buf = parts.pop() ?? ''
        for (const part of parts) {
          const line = part.trim()
          if (!line.startsWith('data: ')) continue
          try {
            const evt: RunEvent = JSON.parse(line.slice(6))
            onEvent(evt)
            if (evt.type === 'done' || evt.type === 'end') {
              onDone()
              return
            }
          } catch { /* malformed */ }
        }
      }
      onDone()
    })
    .catch(() => { if (!cancelled) onDone() })

  return () => { cancelled = true; controller.abort() }
}
