// ============================================================
// types/api.ts — miroir exact des schémas Pydantic backend
// ============================================================

export type TrialState = 'COMPLETE' | 'PRUNED' | 'FAIL' | 'RUNNING' | 'WAITING'
export type StudyStatus = 'idle' | 'running' | 'finished' | 'stopped' | 'error'
export type Direction = 'minimize' | 'maximize'

export interface StudySummary {
  study_id:      number
  study_name:    string
  direction:     string
  n_trials:      number
  best_value:    number | null
  datetime_start: string | null
  status:         StudyStatus
  counts:         { complete: number; failed: number; pruned: number; running: number; waiting: number; interrupted: number; planned?: number; finalized?: number; succeeded?: number }
  graph_id?:      string | null
  run_id?:        string | null
  node_label?:    string | null
  metric?:        string | null
  stop_on_failure?: boolean | null
  attempt_id?:    string | null
}

export interface Trial {
  number:            number
  state:             TrialState
  effective_state?:  string
  value:             number | null
  params:            Record<string, number | string | boolean>
  duration_s:        number | null
  datetime_start:    string | null
  datetime_complete: string | null
  failure_code?:   string | null
  failure_title?:  string | null
  failure_reason?: string | null
  failure_action?: string | null
  return_code?:    number | null
  artifact_dir?:   string | null
  results_csv?:    string | null
  best_weights?:   string | null
  metrics?:        Record<string, number | null>
  metric_source?:  string | null
  recovery_status?: string | null
}

export interface StudyDiagnostic {
  trial: number
  state: string
  code?: string | null
  title: string
  reason: string
  action: string
}

export interface StudyDiagnosticGroup extends StudyDiagnostic {
  trials: number[]
  count: number
}

export interface StudyStatus_API {
  study_name:   string
  status:       StudyStatus
  n_trials:     number
  completed:    number
  best_value:   number | null
  error_msg:    string | null
  progress_pct: number
  direction?: string | null
  counts: { complete: number; failed: number; pruned: number; running: number; waiting: number; interrupted: number; planned?: number; finalized?: number; succeeded?: number }
  context: Record<string, unknown>
  diagnostics: StudyDiagnostic[]
  diagnostic_groups: StudyDiagnosticGroup[]
  sampler_phase: 'startup' | 'adaptive' | 'unknown'
  adaptive_decisions: number
  pruner_status: string
  recovered_candidate?: {
    trial: number
    metric: string
    value: number
    metrics: Record<string, number | null>
    params: Record<string, number | string | boolean>
    artifact_dir?: string | null
    best_weights?: string | null
    status: 'informative_not_optuna_complete'
    tied_trials?: number[]
  } | null
}

export interface ParamSpec {
  name:     string
  type:     'float' | 'int' | 'categorical'
  low?:     number
  high?:    number
  log?:     boolean
  choices?: (string | number)[]
}

export interface StudySearchSpaceParam extends ParamSpec {
  step?: number | null
  distribution?: string
  best_value?: number | string | boolean | null
}

export interface StudyAnalysis {
  configuration: {
    dataset: string | null
    n_trials: number
    direction: string
    objective_metric: string | null
    sampler: string
    pruner: string
  }
  search_space: StudySearchSpaceParam[]
  parameter_importances: Record<string, number> | null
  importance_error?: string | null
  importance_method?: string
  importance_trial_count?: number
  importance_warning?: string | null
}

export interface StartBody {
  script_path: string
  n_trials:    number
  metric_name: string
  direction:   Direction
  param_space: ParamSpec[]
}

export interface LogEvent {
  type:       'log' | 'status' | 'done'
  line?:      string
  status?:    StudyStatus
  completed?: number
  n_trials?:  number
  best_value?: number | null
}

export interface AppSettings {
  workspace_path: string
  user_name:      string
  theme:          string
}
