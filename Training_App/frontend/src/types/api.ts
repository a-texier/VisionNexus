// ============================================================
// types/api.ts — Training_App
// ============================================================

export interface TrainingRun {
  id: number
  run_name: string
  yolo_version: string
  model_size: string
  model_weights: string
  data_yaml: string
  dataset_name: string
  hyperparams: Record<string, number | string | boolean>
  status: 'pending' | 'running' | 'done' | 'error' | 'stopped'
  progress_pct: number
  current_epoch: number
  total_epochs: number
  best_map50: number | null
  best_map5095: number | null
  best_model_path: string | null
  error_message: string | null
  created_at: string
  started_at: string | null
  finished_at: string | null
}

export interface StartTrainingRequest {
  yolo_version: string
  model_size: string
  model_weights?: string
  data_yaml: string
  dataset_name?: string
  hyperparams: Record<string, number | string | boolean>
}

export interface TrainingEvent {
  type: 'epoch' | 'val_metrics' | 'done' | 'error' | 'stopped' | 'status'
  epoch?: number
  total_epochs?: number
  progress_pct?: number
  metrics?: Record<string, number>
  best_model_path?: string
  map50?: number
  map5095?: number
  message?: string
  status?: string
}

export interface ModelCatalog {
  versions: string[]
  sizes: Record<string, string[]>
  defaults: Record<string, number | string | boolean>
}

export interface AppMode {
  mode: 'solo' | 'orchestrator'
  runs_dir: string
  workspace: string
}
