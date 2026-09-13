// ============================================================
// types/api.ts — miroir exact des schémas Pydantic backend
// ============================================================

export type AppName = 'Annotation_App' | 'Dataset_Explorer_App' | 'dvc-app' | 'mlflow-app' | 'optuna-app'
export type StepStatus = 'pending' | 'running' | 'success' | 'failed' | 'waiting'
export type RunStatus  = 'running' | 'success' | 'failed' | 'waiting'
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
export type StepType   = 'task' | 'human_gate'

// ---- Health ----

export interface AppHealth {
  status: 'ok' | 'down'
  latency_ms: number | null
  frontend_url: string
}

export type HealthResult = Record<AppName, AppHealth>

// ---- Pipeline ----

export interface PipelineStep {
  id: string
  label: string
  app: AppName
  endpoint: string
  method: HttpMethod
  params: Record<string, unknown>
  depends_on: string[]
  type?: StepType
}

// ---- Experiments ----

export type ExperimentStatus = 'running' | 'waiting' | 'done' | 'failed'

export interface StepRecord {
  status: StepStatus
  output: Record<string, unknown>
}

export interface Experiment {
  experiment_id: string
  pipeline_id: string
  run_id: string
  status: ExperimentStatus
  current_step: string
  steps: Record<string, StepRecord>
  artifacts: Record<string, string>
  metrics: Record<string, number>
  created_at: string
  updated_at: string
}

export interface PipelineDef {
  id: string
  name: string
  steps: PipelineStep[]
  created_at: string | null
  last_run: string | null
  last_run_status: string | null
}

// ---- Run ----

export interface RunStartResponse {
  run_id: string
  pipeline_id: string
}

export interface StepRunState {
  status: StepStatus
  label: string
  output: string
}

export interface RunStatusResponse {
  run_id: string
  pipeline_id: string
  status: RunStatus
  elapsed_s: number
  steps_done: number
  steps_total: number
  steps: Record<string, StepRunState>
}

export interface RunEvent {
  type?: 'done' | 'end' | 'ping' | 'error' | 'waiting'
  step_id?: string
  status?: StepStatus | RunStatus
  output?: string
  ts?: number
  message?: string
}

// ---- Activity ----

export interface StepResult {
  status: StepStatus
  output: string
}

export interface ActivityRun {
  pipeline_id: string
  pipeline_name: string
  run_id: string
  status: RunStatus
  start_time: string
  duration_s: number | null
  step_count: number
  step_results: Record<string, StepResult> | null
}

// ---- Settings ----

export interface AppSettings {
  workspace_path: string
  user_name: string
  theme: string
}

// ---- SandGraph ----

export interface NodeExecState {
  status: 'idle' | 'running' | 'waiting' | 'done' | 'failed'
  result: Record<string, unknown>
  started_at?: string
  finished_at?: string
}

// Type derive MLOps d'un graphe (calcule cote backend depuis les nodes, jamais
// persiste). mlops = presence d'un node MLflow ET d'un node DVC (paire couplee).
export interface MlopsStatus {
  graph_type: 'mlops' | 'experimental'
  is_mlops: boolean
  has_mlflow: boolean
  has_dvc: boolean
  tracking_complete: boolean
  tracking_partial: boolean   // un seul des deux -> suivi incomplet
}

// Derivation cote frontend (edition live avant save, quand on n'a que les nodes).
// Doit rester alignee sur backend graph_store.mlops_status.
export function deriveMlops(nodes: { data?: { node_type?: string }; type?: string }[]): MlopsStatus {
  const types = new Set(nodes.map(n => n.data?.node_type || n.type || '').filter(Boolean))
  const has_mlflow = types.has('mlflow')
  const has_dvc = types.has('dvc')
  const is_mlops = has_mlflow && has_dvc
  return {
    graph_type: is_mlops ? 'mlops' : 'experimental',
    is_mlops, has_mlflow, has_dvc,
    tracking_complete: is_mlops,
    tracking_partial: (has_mlflow || has_dvc) && !is_mlops,
  }
}

export interface SandGraph {
  graph_id: string
  name: string
  created_at: string
  updated_at: string
  status: 'idle' | 'running' | 'waiting' | 'done' | 'failed'
  active_run_id: string | null
  active_pipeline_id: string | null
  nodes: object[]
  edges: object[]
  execution: Record<string, NodeExecState>
  run_history: { run_id: string; started_at: string; status: string; duration_s: number | null }[]
  // Renseigne par le commit DVC (backend: set_run_lineage) — `committed_at` est la
  // preuve qu'un run est versionne : c'est ce qui eteint le halo du node DVC.
  run_lineage?: Record<string, { git_commit?: string; dataset?: string; committed_at?: string }>
  step_node_map: Record<string, string>
  mlops?: MlopsStatus   // calcule par le backend (list/get graphs)
  forked_from?: ForkProvenance
}

// Provenance d'un fork : d'ou vient ce graphe + snapshot des params du parent
// (pour montrer la divergence avant relance).
export interface ForkSnapshotNode {
  node_id: string
  node_type: string
  label: string
  params: Record<string, unknown>
}
export interface ForkProvenance {
  parent_graph_id?: string
  parent_graph_name?: string
  run_id?: string
  git_commit?: string | null
  dataset?: string | null
  dvc_version?: string | null
  map50?: number | null
  snapshot?: ForkSnapshotNode[]
}

export interface GraphRunResponse {
  run_id: string
  pipeline_id: string
  step_node_map: Record<string, string>
  launching?: string[]   // apps hors-ligne en cours de démarrage (écran de lancement)
}

// ---- App launcher ----

export interface AppLaunchStatus {
  app_id: string
  label: string
  launched: boolean
  status: 'starting' | 'running' | 'stopped' | 'error'
  backend_url: string | null
  frontend_url: string | null
  workspace: string | null
  backend_log?: string | null
  frontend_log?: string | null
  failure_reason?: string | null
  backend_exit_code?: number | null
  frontend_exit_code?: number | null
}
