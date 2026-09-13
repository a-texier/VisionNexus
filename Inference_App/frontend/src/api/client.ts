import axios from 'axios'

const api = axios.create({ baseURL: '/api' })

export interface Scenario {
  id: string; file: string; mode: string
  tracker_mot: string; tracker_sot: string; n_targets: number; sequence_dir: string
}
export interface SchemaField { key: string; type: string; choices?: (string | number)[]; help?: string }
export interface SchemaGroup { title: string; fields: SchemaField[] }
export interface SessionInfo {
  id: string; status: string; mode: string; stream_port: number
  run_dir: string; started_at: string; error: string
  benchmark_summary: Record<string, unknown>
}
export interface Weight { name: string; path: string; source: string }
export interface Sequence { name: string; path: string; type: string }
export interface TaskInfo {
  id: string; label: string; status: string; returncode: number | null
  artifact: string | null; started_at: string; log: string[]
}
export interface Replay { name: string; path: string; lines: number }
export interface AppSettings {
  metrics: { compute_metrics: boolean; iou_threshold: number; default_annotation_file: string }
  export:  { onnx_imgsz: number; default_deploy_target: string; trt_builder: string }
  render:  { light_render: boolean; trail: number; stream_quality: number }
  paths:   { native_share_host: string }
}
export interface SettingsResponse {
  settings: AppSettings
  settings_file: string
  paths: Record<string, string>
}
export interface ExportInfo {
  model_export: { dir: string; tool: string; note: string }
  tracker_zip:  { dir: string; tool: string; note: string }
  deploy: Record<string, unknown>
  runs_dir: string
}

export const trackerAPI = {
  scenarios: () => api.get<Scenario[]>('/scenarios').then(r => r.data),
  configSchema: () => api.get<{ schema: { groups: SchemaGroup[] }; defaults: Record<string, unknown> }>('/config-schema').then(r => r.data),
  sources: () => api.get<{ sequences: Sequence[]; weights: Weight[] }>('/sources').then(r => r.data),
  start: (body: { scenario?: string; mode: string; overrides: Record<string, unknown> }) =>
    api.post<{ session_id: string; stream_port: number; status: string }>('/session/start', body).then(r => r.data),
  stop: (sid: string) => api.post(`/session/${sid}/stop`).then(r => r.data),
  status: (sid: string) => api.get<SessionInfo>(`/session/${sid}/status`).then(r => r.data),
  sessions: () => api.get<SessionInfo[]>('/sessions').then(r => r.data),
  click: (sid: string, x: number, y: number, button: number) =>
    api.post(`/session/${sid}/click`, { x, y, button }).then(r => r.data),
  key: (sid: string, key: string) => api.post(`/session/${sid}/key`, { key }).then(r => r.data),
  record: (sid: string) => api.post(`/session/${sid}/record`).then(r => r.data),
  replays: () => api.get<{ name: string; path: string; lines: number }[]>('/replays').then(r => r.data),
  artifacts: (sid: string) => api.get<{ run_dir: string; artifacts: Record<string, boolean>; videos: string[] }>(`/session/${sid}/artifacts`).then(r => r.data),
  // export / deploy
  exportModel: (body: { weights_path: string; fmt: string; imgsz?: number }) =>
    api.post<{ task_id: string }>('/export/model', body).then(r => r.data),
  deployBuild: (body: { target: string }) =>
    api.post<{ task_id: string; note: string }>('/deploy/build', body).then(r => r.data),
  trackerZip: () => api.post<{ task_id: string; output: string }>('/export/tracker-zip').then(r => r.data),
  exportInfo: () => api.get<ExportInfo>('/export/info').then(r => r.data),
  task: (tid: string) => api.get<TaskInfo>(`/tasks/${tid}`).then(r => r.data),
  // rejeu / mode command
  replaysUpload: (file: File, name?: string) => {
    const fd = new FormData()
    fd.append('file', file)
    if (name) fd.append('name', name)
    return api.post<Replay>('/replays/upload', fd, { headers: { 'Content-Type': undefined } }).then(r => r.data)
  },
  // reglages (workspace)
  getSettings: () => api.get<SettingsResponse>('/settings').then(r => r.data),
  putSettings: (patch: Record<string, unknown>) =>
    api.put<{ settings: AppSettings }>('/settings', { patch }).then(r => r.data),
}

// ── Evaluation (app unifiee : detection model.val + tracker MOTA/IDF1) ────────
export interface DataYaml { name: string; path: string }
export interface EvalInfo {
  id: string; kind: string; status: string
  run_dir: string | null; metrics: Record<string, number>
  error: string; params: Record<string, unknown>; mlflow_run_id: string; started_at: string
}
export interface EvalArtifacts { run_dir: string; plots: string[]; benchmark: boolean }

export const evalAPI = {
  sources: () => api.get<{ weights: Weight[]; data_yamls: DataYaml[] }>('/eval/sources').then(r => r.data),
  startDetection: (body: { model_path: string; data_yaml: string; overrides?: Record<string, unknown> }) =>
    api.post<{ eval_id: string; status: string }>('/eval/detection', body).then(r => r.data),
  startTracker: (body: { model_path?: string; sequence_dir: string; annotation_file?: string; overrides?: Record<string, unknown> }) =>
    api.post<{ eval_id: string; status: string }>('/eval/tracker', body).then(r => r.data),
  status: (eid: string) => api.get<EvalInfo>(`/eval/${eid}`).then(r => r.data),
  list: () => api.get<EvalInfo[]>('/evals').then(r => r.data),
  artifacts: (eid: string) => api.get<EvalArtifacts>(`/eval/${eid}/artifacts`).then(r => r.data),
}
export const artifactUrl = (eid: string, name: string) => `/api/eval/${eid}/artifact/${name}`

// ── Acquisition (mode FREE : capture un flux -> dataset d'images) ─────────────
export interface AcqInfo {
  id: string; name: string; source: string; out_dir: string
  status: string; n_saved: number; target: number; error: string; started_at: string
}
export interface AcqDataset { name: string; path: string; n_images: number }

export const acqAPI = {
  start: (body: { source: string; name?: string; max_frames?: number; every?: number; fmt?: string; camera_name?: string; start_frame?: number }) =>
    api.post<{ acq_id: string; name: string; out_dir: string; status: string }>('/acquire', body).then(r => r.data),
  stop: (aid: string) => api.post(`/acquire/${aid}/stop`).then(r => r.data),
  status: (aid: string) => api.get<AcqInfo>(`/acquire/${aid}`).then(r => r.data),
  datasets: () => api.get<AcqDataset[]>('/acquisitions/datasets').then(r => r.data),
}

export const streamUrl = (sid: string) => `/api/session/${sid}/stream`
export const infoUrl = (sid: string) => `/api/session/${sid}/info`
