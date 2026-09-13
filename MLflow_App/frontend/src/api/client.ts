// ============================================================
// api/client.ts
// Client API typé — axios.
// ============================================================

import axios from 'axios'
import type {
  AppSettings,
  CompareResult,
  Experiment,
  MLflowStatus,
  ModelVersion,
  RegisteredModel,
  RunDetail,
  RunSummary,
} from '../types/api'

const http = axios.create({ baseURL: '', timeout: 30_000 })

// ------------------------------------------------------------------ //
// MLflow status                                                       //
// ------------------------------------------------------------------ //

export const mlflowAPI = {
  status: (): Promise<MLflowStatus> =>
    http.get('/api/mlflow-status').then(r => r.data),
}

// ------------------------------------------------------------------ //
// Experiments                                                         //
// ------------------------------------------------------------------ //

export const experimentsAPI = {
  list: (): Promise<Experiment[]> =>
    http.get('/api/experiments').then(r => r.data),

  create: (name: string, tags?: Record<string, string>): Promise<Experiment> =>
    http.post('/api/experiments', { name, tags: tags ?? {} }).then(r => r.data),

  delete: (experiment_id: string): Promise<{ ok: boolean }> =>
    http.delete(`/api/experiments/${experiment_id}`).then(r => r.data),
}

// ------------------------------------------------------------------ //
// Runs                                                                //
// ------------------------------------------------------------------ //

export const runsAPI = {
  list: (experiment_id: string, max_results = 200): Promise<RunSummary[]> =>
    http.get('/api/runs', { params: { experiment_id, max_results } }).then(r => r.data),

  get: (run_id: string): Promise<RunDetail> =>
    http.get(`/api/runs/${run_id}`).then(r => r.data),
}

// ------------------------------------------------------------------ //
// Models                                                              //
// ------------------------------------------------------------------ //

export const modelsAPI = {
  list: (): Promise<RegisteredModel[]> =>
    http.get('/api/models').then(r => r.data),

  listVersions: (model_name: string): Promise<ModelVersion[]> =>
    http.get(`/api/models/${encodeURIComponent(model_name)}/versions`).then(r => r.data),

  transition: (
    model_name: string,
    version: string,
    stage: string,
    archive_existing = false,
  ): Promise<ModelVersion> =>
    http
      .post(`/api/models/${encodeURIComponent(model_name)}/versions/${version}/transition`, {
        stage,
        archive_existing_versions: archive_existing,
      })
      .then(r => r.data),
}

// ------------------------------------------------------------------ //
// Compare                                                             //
// ------------------------------------------------------------------ //

export const compareAPI = {
  compare: (run_ids: string[]): Promise<CompareResult> =>
    http.post('/api/compare', { run_ids }).then(r => r.data),
}

// ------------------------------------------------------------------ //
// Settings                                                            //
// ------------------------------------------------------------------ //

export const settingsAPI = {
  get: (): Promise<AppSettings> =>
    http.get('/api/settings').then(r => r.data),

  update: (data: Partial<AppSettings>): Promise<AppSettings> =>
    http.put('/api/settings', data).then(r => r.data),
}
