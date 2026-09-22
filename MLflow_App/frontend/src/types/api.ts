// ============================================================
// types/api.ts
// Interfaces TypeScript — miroir exact des schémas Pydantic.
// ============================================================

export interface Experiment {
  experiment_id:    string
  name:             string
  artifact_location: string
  lifecycle_stage:  string
  creation_time:    number | null
  last_update_time: number | null
  tags:             Record<string, string>
}

export interface RunParam {
  key:   string
  value: string
}

export interface MetricPoint {
  step:      number
  value:     number
  timestamp: number
}

export interface Artifact {
  path:      string
  is_dir:    boolean
  file_size: number | null
}

export interface RunSummary {
  run_id:        string
  run_name:      string
  experiment_id: string
  status:        'RUNNING' | 'SCHEDULED' | 'FINISHED' | 'FAILED' | 'KILLED'
  start_time:    number | null
  end_time:      number | null
  artifact_uri:  string
  params:        Record<string, string>
  metrics:       Record<string, number>
  tags:          Record<string, string>
  duration_ms:   number | null
}

export interface RunDetail extends RunSummary {
  metric_history: Record<string, MetricPoint[]>
  artifacts:      Artifact[]
}

export interface ArtifactListing {
  path:      string
  artifacts: Artifact[]
}

export interface ModelVersion {
  name:                    string
  version:                 string
  current_stage:           'None' | 'Staging' | 'Production' | 'Archived'
  status:                  string
  source:                  string
  run_id:                  string
  description:             string | null
  creation_timestamp:      number | null
  last_updated_timestamp:  number | null
  tags?:                   Record<string, string>
}

export interface RegisteredModel {
  name:                    string
  description:             string | null
  creation_timestamp:      number | null
  last_updated_timestamp:  number | null
  latest_versions:         ModelVersion[]
  tags:                    Record<string, string>
}

export interface CompareResult {
  run_ids:        string[]
  runs:           Record<string, RunDetail>
  common_metrics: string[]
  common_params:  string[]
  all_metrics:    string[]
  all_params:     string[]
}

export interface MLflowStatus {
  running: boolean
  version: string | null
}

export interface AppSettings {
  workspace_path:      string
  user_name:           string
  mlflow_tracking_uri: string
  theme:               string
  auto_refresh_ms:     number
}
