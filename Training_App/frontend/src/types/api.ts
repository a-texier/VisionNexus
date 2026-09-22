// ============================================================
// types/api.ts — Training_App
// ============================================================

export interface TrainingRun {
  id: number
  run_name: string
  yolo_version: string
  engine: string
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
  engine?: string
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

export type HyperparamValue = number | string | boolean | null | (number | string)[]

export interface HyperparamField {
  key: string
  label: string
  type: 'int' | 'float' | 'text' | 'bool'
  min?: number
  max?: number
  step?: number
  placeholder?: string
}

// Catalogue d'un moteur (GET /api/training/models?engine=...) : tout le
// formulaire en decoule, aucun nom de moteur n'est ecrit dans ce frontend.
export interface ModelCatalog {
  engine: string
  label: string
  sizes: string[]
  default_size: string
  size_prefix?: string
  weights_suffixes: string[]
  pretrained_by_default?: boolean
  defaults: Record<string, HyperparamValue>
  groups: { label: string; params: HyperparamField[] }[]
  keys: Record<string, string>
}

export interface EngineInfo {
  name: string
  label: string
  source: string
  available: boolean
  reason: string | null
}

export interface Capabilities {
  trainer_backends: EngineInfo[]
  default: string
  active: string
}

export interface AppMode {
  mode: 'solo' | 'orchestrator'
  runs_dir: string
  workspace: string
}
