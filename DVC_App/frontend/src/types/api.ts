// ============================================================
// types/api.ts — miroir exact des schémas Pydantic backend
// ============================================================

export type FileStatus = 'unchanged' | 'modified' | 'missing' | 'new'

export interface TrackedFile {
  path:           string
  dvc_file:       string
  md5:            string | null
  size_bytes:     number
  is_dir:         boolean
  status:         FileStatus
  exists_locally: boolean
}

export interface DVCStatusChange {
  [dvcFile: string]: unknown
}

export interface DVCStatus {
  changes:   DVCStatusChange
  repo_path: string
  error?:    string
}

// Lineage porte par les trailers du commit (posés par l'Orchestrateur).
export interface CommitLineage {
  run_id?:      string
  graph_id?:    string
  graph_name?:  string
  dataset?:     string
  map50?:       string
  mlflow_runs?: string[]
  parent_run_id?: string
}

export interface Commit {
  hash:       string
  short:      string
  author:     string
  email:      string
  timestamp:  number
  subject:    string
  dvc_files:  string[]
  lineage?:   CommitLineage
}

export interface DVCRemote {
  name:    string
  url:     string
  default: boolean
}

export interface RepoStatusInfo {
  repo_exists:     boolean
  repo_path:       string
  git_initialized: boolean
  dvc_initialized: boolean
  remotes:         DVCRemote[]
}

export interface DiffEntry {
  path: string
  hash: string
}

export interface DVCDiff {
  added?:    DiffEntry[]
  deleted?:  DiffEntry[]
  modified?: DiffEntry[]
  renamed?:  DiffEntry[]
  error?:    string
}

export interface SyncEvent {
  type:       'start' | 'log' | 'done' | 'error'
  cmd?:       string
  line?:      string
  returncode?: number
  message?:   string
}

export interface AppSettings {
  workspace_path: string
  user_name:      string
  dvc_repo_path:  string
  theme:          string
  ui_language:    string
}

export interface BranchInfo {
  branch:    string
  repo_path: string
}
