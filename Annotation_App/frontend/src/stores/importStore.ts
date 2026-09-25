// ============================================================
// stores/importStore.ts
// Orchestration des imports de séquences EN TÂCHE DE FOND.
//
// Le modal d'import se contente d'empiler des "jobs" ici puis se ferme :
// l'utilisateur peut continuer à annoter pendant que les séquences se
// chargent. Les jobs sont traités EN SÉRIE (le backend lit project.frame_count
// à la création de chaque séquence → deux imports concurrents entreraient en
// collision d'index). Une barre de progression par séquence est exposée.
// ============================================================

import { create } from 'zustand'
import { datasetAPI, taskAPI } from '../services/api'
import { useProjectStore } from './projectStore'
import { useSettingsStore } from './settingsStore'
import { t } from '../i18n/translate'

// Rafraîchissement LÉGER pendant l'import : frames (previews live) + séquences
// (met à jour frameFloor pour pouvoir switcher). N'appelle PAS fetchProject, qui
// restaurerait l'index de session → repousserait l'utilisateur hors de sa séquence.
async function lightRefresh(projectId: number) {
  const ps = useProjectStore.getState()
  void ps.fetchFrames(projectId)
  try {
    const seqs = await datasetAPI.listSequences(projectId)
    const floor = seqs.reduce((m, s) => Math.max(m, s.start_index + Math.max(s.frame_count, 1)), 0)
    ps.setFrameFloor(floor)
  } catch { /* ignore */ }
}

const VIDEO_EXTS = ['mp4', 'avi', 'mov', 'mkv', 'webm']

export interface ImportJobSpec {
  id: string
  label: string
  files: File[]        // upload navigateur (vide si chemin serveur)
  serverPath: string   // chemin serveur (vide si upload)
  formatId?: string    // fourni par /api/capabilities pour un adaptateur optionnel
}

export interface ImportOptions {
  frameKeep: number
  jpegQuality: number
  extractionBatchSize: number
  lossless: boolean
  useSymlink: number | boolean
}

export interface ImportJob {
  id: string
  label: string
  status: 'pending' | 'running' | 'done' | 'error'
  progress: number
  message: string
}

interface ImportStore {
  jobs: ImportJob[]
  running: boolean
  projectId: number | null
  // Callback appelé après CHAQUE séquence terminée (refresh frames/séquences)
  onSequenceDone: (() => void) | null
  startImport: (
    projectId: number,
    specs: ImportJobSpec[],
    options: ImportOptions,
    onSequenceDone: () => void,
  ) => void
  // Reprend les séquences (chemin serveur) non encore démarrées après un reload.
  resumePending: (projectId: number, onSequenceDone: () => void) => void
  dismiss: () => void
}

const patchJob = (jobs: ImportJob[], id: string, patch: Partial<ImportJob>): ImportJob[] =>
  jobs.map((j) => (j.id === id ? { ...j, ...patch } : j))

// ---- Persistance de la file (résistance au reload) --------------------------
// Seuls les jobs "chemin serveur" sont resérialisables (les uploads navigateur
// perdent leurs File au reload). On persiste le statut de chaque spec pour
// reprendre UNIQUEMENT ceux jamais démarrés (status 'pending').
interface PersistedSpec { id: string; label: string; serverPath: string; formatId?: string; status: ImportJob['status'] }
interface PersistedQueue { projectId: number; options: ImportOptions; specs: PersistedSpec[] }

const queueKey = (projectId: number) => `annot_import_queue_${projectId}`

function saveQueue(projectId: number, options: ImportOptions, specs: ImportJobSpec[], jobs: ImportJob[]) {
  const serverSpecs = specs.filter((s) => s.serverPath.trim())
  if (serverSpecs.length === 0) { localStorage.removeItem(queueKey(projectId)); return }
  const statusById = new Map(jobs.map((j) => [j.id, j.status]))
  const q: PersistedQueue = {
    projectId, options,
    specs: serverSpecs.map((s) => ({
      id: s.id, label: s.label, serverPath: s.serverPath, formatId: s.formatId, status: statusById.get(s.id) ?? 'pending',
    })),
  }
  localStorage.setItem(queueKey(projectId), JSON.stringify(q))
}

function markPersisted(projectId: number, specId: string, status: ImportJob['status']) {
  try {
    const raw = localStorage.getItem(queueKey(projectId))
    if (!raw) return
    const q = JSON.parse(raw) as PersistedQueue
    const spec = q.specs.find((s) => s.id === specId)
    if (spec) spec.status = status
    // Nettoyer si tout est terminé/en erreur (plus rien à reprendre)
    if (q.specs.every((s) => s.status === 'done' || s.status === 'error')) {
      localStorage.removeItem(queueKey(projectId))
    } else {
      localStorage.setItem(queueKey(projectId), JSON.stringify(q))
    }
  } catch { /* ignore */ }
}

export const useImportStore = create<ImportStore>((set, get) => ({
  jobs: [],
  running: false,
  projectId: null,
  onSequenceDone: null,

  startImport: (projectId, specs, options, onSequenceDone) => {
    if (specs.length === 0) return
    const jobs: ImportJob[] = specs.map((s) => ({
      id: s.id, label: s.label, status: 'pending', progress: 0, message: 'En attente…',
    }))
    set({ jobs, running: true, projectId, onSequenceDone })
    saveQueue(projectId, options, specs, jobs)

    const waitForTask = async (taskId: string, jobId: string): Promise<void> => {
      let lastRefresh = 0
      for (;;) {
        await new Promise((r) => setTimeout(r, 700))
        try {
          const task = await taskAPI.getStatus(taskId)
          set((st) => ({ jobs: patchJob(st.jobs, jobId, { progress: task.progress, message: task.message }) }))
          // Rafraîchissement INCRÉMENTAL LÉGER (throttlé ~2.5 s) pendant l'import : les
          // frames déjà importées apparaissent au fur et à mesure (pas besoin de reload
          // manuel), et frameFloor se met à jour → on peut naviguer/switcher de séquence.
          const now = Date.now()
          if (now - lastRefresh >= 2500) {
            lastRefresh = now
            void lightRefresh(projectId)
          }
          if (task.status === 'completed') return
          if (task.status === 'error') throw new Error(task.error || 'Erreur extraction')
        } catch (e) {
          if (e instanceof Error && e.message !== 'Failed to fetch') throw e
        }
      }
    }

    const importOne = async (spec: ImportJobSpec): Promise<void> => {
      set((st) => ({ jobs: patchJob(st.jobs, spec.id, { status: 'running', message: t('Démarrage…') }) }))
      markPersisted(projectId, spec.id, 'running')
      const { frameKeep, jpegQuality, extractionBatchSize, lossless, useSymlink } = options
      // Parametres > Import : taille des morceaux d'une source monofichier et des lots d'images
      const importSettings = useSettingsStore.getState().settings?.import
      const chunkMb = importSettings?.chunk_size_mb ?? 8
      const imageBatch = Math.max(1, importSettings?.batch_size_images ?? 20)

      if (spec.serverPath.trim()) {
        const p = spec.serverPath.trim()
        const lower = p.toLowerCase()
        if (spec.formatId || VIDEO_EXTS.some((e) => lower.endsWith(`.${e}`))) {
          const r = await datasetAPI.importVideoFromPath(projectId, p, frameKeep, jpegQuality, 3, extractionBatchSize, lossless, spec.label)
          if (r.task_id) await waitForTask(r.task_id, spec.id)
        } else {
          const r = await datasetAPI.importFolder(projectId, p, Boolean(useSymlink), spec.label)
          if (r.task_id) await waitForTask(r.task_id, spec.id)
        }
      } else if (spec.files.length > 0) {
        const first = spec.files[0]
        const name = first.name.toLowerCase()
        if (spec.formatId) {
          const r = await datasetAPI.importSpecific(projectId, spec.formatId, first, frameKeep, chunkMb, extractionBatchSize, spec.label)
          await waitForTask(r.task_id, spec.id)
        } else if (VIDEO_EXTS.some((e) => name.endsWith(`.${e}`))) {
          const r = await datasetAPI.importVideo(projectId, first, frameKeep, jpegQuality, chunkMb, 3, extractionBatchSize, spec.label)
          await waitForTask(r.task_id, spec.id)
        } else {
          const files = spec.files
          for (let i = 0; i < files.length; i += imageBatch) {
            const fd = new FormData()
            files.slice(i, i + imageBatch).forEach((f) => fd.append('files', f))
            if (spec.label) fd.append('sequence_name', spec.label)
            const res = await fetch(`/api/projects/${projectId}/import/images`, { method: 'POST', body: fd })
            if (!res.ok) throw new Error(`${t('Upload images batch')} ${i / imageBatch + 1} ${t('échoué')}`)
            set((st) => ({ jobs: patchJob(st.jobs, spec.id, {
              progress: Math.round(Math.min(100, ((i + imageBatch) / files.length) * 100)),
              message: `${Math.min(i + imageBatch, files.length)}/${files.length} images`,
            }) }))
          }
        }
      }
      set((st) => ({ jobs: patchJob(st.jobs, spec.id, { status: 'done', progress: 100, message: t('Terminé') }) }))
      markPersisted(projectId, spec.id, 'done')
      get().onSequenceDone?.()
    }

    // Boucle série détachée du cycle de vie du modal
    void (async () => {
      for (const spec of specs) {
        try {
          await importOne(spec)
        } catch (e) {
          set((st) => ({ jobs: patchJob(st.jobs, spec.id, {
            status: 'error', message: e instanceof Error ? e.message : 'Erreur',
          }) }))
          markPersisted(projectId, spec.id, 'error')
        }
      }
      set({ running: false })
      get().onSequenceDone?.()
    })()
  },

  resumePending: (projectId, onSequenceDone) => {
    // Après un reload : relance UNIQUEMENT les séquences chemin-serveur jamais
    // démarrées (status 'pending'). Les jobs déjà 'running' continuent côté backend
    // (tâche indépendante) ; les uploads navigateur ne sont pas resérialisables.
    if (get().running) return
    let q: PersistedQueue | null = null
    try {
      const raw = localStorage.getItem(queueKey(projectId))
      if (raw) q = JSON.parse(raw) as PersistedQueue
    } catch { q = null }
    if (!q) return
    const pending = q.specs.filter((s) => s.status === 'pending' && s.serverPath.trim())
    if (pending.length === 0) {
      // Rien à reprendre — nettoyer si tout est fini.
      if (q.specs.every((s) => s.status !== 'pending')) localStorage.removeItem(queueKey(projectId))
      return
    }
    const specs: ImportJobSpec[] = pending.map((s) => ({
      id: s.id, label: s.label, serverPath: s.serverPath, files: [], formatId: s.formatId,
    }))
    get().startImport(projectId, specs, q.options, onSequenceDone)
  },

  dismiss: () => set({ jobs: [], running: false }),
}))
