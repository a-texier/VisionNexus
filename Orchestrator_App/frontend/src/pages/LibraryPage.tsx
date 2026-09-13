// ============================================================
// LibraryPage.tsx
// Grille des pipelines sauvegardés + templates prédéfinis.
// ============================================================

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import {
  Plus, Play, Trash2, Copy, Edit2, GitBranch,
  CheckCircle2, XCircle, Clock, Lock,
} from 'lucide-react'
import { usePipelines, useInvalidatePipelines } from '../hooks/usePipelines'
import { pipelinesAPI } from '../api/client'
import type { PipelineDef, PipelineStep, AppName, HttpMethod } from '../types/api'
import { formatDistanceToNow } from '../utils/time'

// ------------------------------------------------------------------ //
// Templates prédéfinis (lecture seule)                                //
// ------------------------------------------------------------------ //

const TEMPLATES: Array<{ name: string; description: string; steps: Omit<PipelineStep, never>[] }> = [
  {
    name: 'Full training loop',
    description: 'Extract → Version → Annotate → Push → HPO → Track',
    steps: [
      { id: 's1', label: 'Extract dataset',    app: 'Dataset_Explorer_App'  as AppName, endpoint: '/datasets',   method: 'GET'  as HttpMethod, params: {}, depends_on: []      },
      { id: 's2', label: 'Version dataset',    app: 'dvc-app'       as AppName, endpoint: '/push',       method: 'POST' as HttpMethod, params: {}, depends_on: ['s1']  },
      { id: 's3', label: 'Annotate',           app: 'Annotation_App'as AppName, endpoint: '/projects',   method: 'GET'  as HttpMethod, params: {}, depends_on: ['s1']  },
      { id: 's4', label: 'Push annotations',   app: 'dvc-app'       as AppName, endpoint: '/push',       method: 'POST' as HttpMethod, params: {}, depends_on: ['s3']  },
      { id: 's5', label: 'Launch HPO',         app: 'optuna-app'    as AppName, endpoint: '/studies',    method: 'GET'  as HttpMethod, params: {}, depends_on: ['s4']  },
      { id: 's6', label: 'Track best run',     app: 'mlflow-app'    as AppName, endpoint: '/experiments',method: 'GET'  as HttpMethod, params: {}, depends_on: ['s5']  },
    ],
  },
  {
    name: 'Re-train with HPO',
    description: 'DVC pull → Optuna study → MLflow compare best run',
    steps: [
      { id: 's1', label: 'DVC pull',           app: 'dvc-app'       as AppName, endpoint: '/pull',       method: 'POST' as HttpMethod, params: {}, depends_on: []      },
      { id: 's2', label: 'Optuna study',       app: 'optuna-app'    as AppName, endpoint: '/studies',    method: 'GET'  as HttpMethod, params: {}, depends_on: ['s1']  },
      { id: 's3', label: 'Compare best run',   app: 'mlflow-app'    as AppName, endpoint: '/experiments',method: 'GET'  as HttpMethod, params: {}, depends_on: ['s2']  },
    ],
  },
  {
    name: 'Annotation only',
    description: 'Extract → Annotate → Push annotations',
    steps: [
      { id: 's1', label: 'Extract dataset',    app: 'Dataset_Explorer_App'  as AppName, endpoint: '/datasets',   method: 'GET'  as HttpMethod, params: {}, depends_on: []      },
      { id: 's2', label: 'Annotate',           app: 'Annotation_App'as AppName, endpoint: '/projects',   method: 'GET'  as HttpMethod, params: {}, depends_on: ['s1']  },
      { id: 's3', label: 'Push annotations',   app: 'dvc-app'       as AppName, endpoint: '/push',       method: 'POST' as HttpMethod, params: {}, depends_on: ['s2']  },
    ],
  },
  {
    name: 'CV Training Loop (11 steps)',
    description: 'Load → Embed → Subset ⏸ → Annotate ⏸ → YOLO → DVC → Train → HPO → Validate ⏸',
    steps: [
      { id: 's1',  label: 'Load dataset',           type: 'task'       as const, app: 'Dataset_Explorer_App'   as AppName, endpoint: '/api/datasets',     method: 'GET'  as HttpMethod, params: {}, depends_on: []       },
      { id: 's2',  label: 'Embed images',           type: 'task'       as const, app: 'Dataset_Explorer_App'   as AppName, endpoint: '/api/embed',         method: 'POST' as HttpMethod, params: {}, depends_on: ['s1']   },
      { id: 's3',  label: 'Create subset',          type: 'task'       as const, app: 'Dataset_Explorer_App'   as AppName, endpoint: '/api/subset',        method: 'POST' as HttpMethod, params: {}, depends_on: ['s2']   },
      { id: 's4',  label: 'Validate subset',        type: 'human_gate' as const, app: 'Dataset_Explorer_App'   as AppName, endpoint: '/api/subset',        method: 'GET'  as HttpMethod, params: {}, depends_on: ['s3']   },
      { id: 's5',  label: 'Export annotation proj', type: 'task'       as const, app: 'Annotation_App' as AppName, endpoint: '/api/projects',      method: 'POST' as HttpMethod, params: {}, depends_on: ['s4']   },
      { id: 's6',  label: 'Annotate',               type: 'human_gate' as const, app: 'Annotation_App' as AppName, endpoint: '/api/projects',      method: 'GET'  as HttpMethod, params: {}, depends_on: ['s5']   },
      { id: 's7',  label: 'Export YOLO format',     type: 'task'       as const, app: 'Annotation_App' as AppName, endpoint: '/api/export/yolo',   method: 'POST' as HttpMethod, params: {}, depends_on: ['s6']   },
      { id: 's8',  label: 'DVC commit',             type: 'task'       as const, app: 'dvc-app'        as AppName, endpoint: '/api/commit',        method: 'POST' as HttpMethod, params: {}, depends_on: ['s7']   },
      { id: 's9',  label: 'Train model',            type: 'task'       as const, app: 'mlflow-app'     as AppName, endpoint: '/api/train',         method: 'POST' as HttpMethod, params: {}, depends_on: ['s8']   },
      { id: 's10', label: 'Optuna HPO',             type: 'task'       as const, app: 'optuna-app'     as AppName, endpoint: '/api/studies',       method: 'POST' as HttpMethod, params: {}, depends_on: ['s9']   },
      { id: 's11', label: 'Validate model',         type: 'human_gate' as const, app: 'mlflow-app'     as AppName, endpoint: '/api/runs',          method: 'GET'  as HttpMethod, params: {}, depends_on: ['s10']  },
    ],
  },
]

// ------------------------------------------------------------------ //
// Status badge                                                        //
// ------------------------------------------------------------------ //

const STATUS_STYLE: Record<string, string> = {
  success: 'bg-emerald-900/40 text-emerald-400 border-emerald-700/40',
  failed:  'bg-red-900/40 text-red-400 border-red-700/40',
  running: 'bg-blue-900/40 text-blue-400 border-blue-700/40',
}

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return null
  return (
    <span className={`px-2 py-0.5 rounded text-xs border font-medium ${STATUS_STYLE[status] ?? 'bg-gray-800 text-gray-400 border-gray-700'}`}>
      {status}
    </span>
  )
}

function StatusIcon({ status }: { status: string | null }) {
  if (status === 'success') return <CheckCircle2 size={13} className="text-emerald-400" />
  if (status === 'failed')  return <XCircle size={13} className="text-red-400" />
  return null
}

// ------------------------------------------------------------------ //
// Create / Edit modal                                                  //
// ------------------------------------------------------------------ //

interface ModalProps {
  initial?: PipelineDef
  onClose: () => void
  onSaved: (p: PipelineDef) => void
}

const APP_NAMES: AppName[] = [
  'Annotation_App', 'Dataset_Explorer_App', 'dvc-app', 'mlflow-app', 'optuna-app',
]

const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'DELETE']

let _nextStepId = 1
function freshStep(): PipelineStep {
  return {
    id: `s${_nextStepId++}`,
    label: '',
    app: 'Dataset_Explorer_App',
    endpoint: '/',
    method: 'GET',
    params: {},
    depends_on: [],
  }
}

function PipelineModal({ initial, onClose, onSaved }: ModalProps) {
  const [name, setName]   = useState(initial?.name ?? '')
  const [steps, setSteps] = useState<PipelineStep[]>(initial?.steps ?? [freshStep()])
  const [saving, setSaving] = useState(false)
  const [paramsRaw, setParamsRaw] = useState<Record<string, string>>(
    Object.fromEntries((initial?.steps ?? []).map(s => [s.id, JSON.stringify(s.params, null, 2)]))
  )

  function addStep() { setSteps(s => [...s, freshStep()]) }
  function removeStep(id: string) { setSteps(s => s.filter(x => x.id !== id)) }
  function updateStep(id: string, patch: Partial<PipelineStep>) {
    setSteps(s => s.map(x => x.id === id ? { ...x, ...patch } : x))
  }

  async function handleSave() {
    if (!name.trim()) { toast.error('Nom requis'); return }

    // Parse params JSON for each step
    const finalSteps: PipelineStep[] = []
    for (const s of steps) {
      let params: Record<string, unknown> = {}
      try {
        const raw = paramsRaw[s.id] ?? '{}'
        params = raw.trim() ? JSON.parse(raw) : {}
      } catch {
        toast.error(`Params JSON invalide pour "${s.label || s.id}"`)
        return
      }
      finalSteps.push({ ...s, params })
    }

    setSaving(true)
    try {
      let saved: PipelineDef
      if (initial) {
        saved = await pipelinesAPI.update(initial.id, name.trim(), finalSteps)
      } else {
        saved = await pipelinesAPI.create(name.trim(), finalSteps)
      }
      toast.success(initial ? 'Pipeline mis à jour' : 'Pipeline créé')
      onSaved(saved)
      onClose()
    } catch {
      toast.error('Erreur lors de la sauvegarde')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 overflow-y-auto py-8">
      <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-2xl mx-4 shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
          <h2 className="text-white font-semibold">{initial ? 'Modifier' : 'Nouveau'} pipeline</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300">✕</button>
        </div>

        <div className="p-6 space-y-4">
          {/* Name */}
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Nom</label>
            <input
              value={name} onChange={e => setName(e.target.value)}
              placeholder="mon-pipeline"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
            />
          </div>

          {/* Steps */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs text-gray-400">Étapes ({steps.length})</label>
              <button
                onClick={addStep}
                className="flex items-center gap-1.5 px-2 py-1 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs rounded-lg border border-gray-700 transition-colors"
              >
                <Plus size={11} /> Ajouter
              </button>
            </div>
            <div className="space-y-2 max-h-96 overflow-y-auto scrollbar-thin pr-1">
              {steps.map((step, idx) => (
                <div key={step.id} className="bg-gray-800 border border-gray-700 rounded-lg p-3 space-y-2">
                  <div className="grid grid-cols-12 gap-2">
                    <div className="col-span-1">
                      <input
                        value={step.id}
                        onChange={e => updateStep(step.id, { id: e.target.value })}
                        className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1.5 text-xs text-gray-300 font-mono focus:outline-none focus:border-indigo-500"
                        placeholder="id"
                      />
                    </div>
                    <div className="col-span-5">
                      <input
                        value={step.label}
                        onChange={e => updateStep(step.id, { label: e.target.value })}
                        placeholder={`Étape ${idx + 1}`}
                        className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                    <div className="col-span-4">
                      <select
                        value={step.app}
                        onChange={e => updateStep(step.id, { app: e.target.value as AppName })}
                        className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                      >
                        {APP_NAMES.map(a => <option key={a} value={a}>{a}</option>)}
                      </select>
                    </div>
                    <div className="col-span-2 flex justify-end">
                      <button
                        onClick={() => removeStep(step.id)}
                        className="p-1.5 text-gray-600 hover:text-red-400 transition-colors"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-12 gap-2">
                    <div className="col-span-2">
                      <select
                        value={step.method}
                        onChange={e => updateStep(step.id, { method: e.target.value as HttpMethod })}
                        className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                      >
                        {METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </div>
                    <div className="col-span-6">
                      <input
                        value={step.endpoint}
                        onChange={e => updateStep(step.id, { endpoint: e.target.value })}
                        placeholder="/endpoint"
                        className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1.5 text-xs text-white font-mono placeholder-gray-500 focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                    <div className="col-span-4">
                      <input
                        value={step.depends_on.join(', ')}
                        onChange={e => updateStep(step.id, {
                          depends_on: e.target.value.split(',').map(s => s.trim()).filter(Boolean)
                        })}
                        placeholder="dépend de (ids)"
                        className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1.5 text-xs text-gray-300 placeholder-gray-500 focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                  </div>
                  <div>
                    <p className="text-[10px] text-gray-600 mb-1">Params (JSON)</p>
                    <textarea
                      value={paramsRaw[step.id] ?? '{}'}
                      onChange={e => setParamsRaw(r => ({ ...r, [step.id]: e.target.value }))}
                      rows={2}
                      className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1.5 text-xs text-gray-300 font-mono placeholder-gray-500 focus:outline-none focus:border-indigo-500 resize-none"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-800">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-400 hover:text-white rounded-lg hover:bg-gray-800 transition-colors">
            Annuler
          </button>
          <button
            onClick={handleSave} disabled={saving || !name.trim()}
            className="px-4 py-2 text-sm bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg transition-colors"
          >
            {saving ? 'Sauvegarde…' : 'Sauvegarder'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ //
// Pipeline card                                                       //
// ------------------------------------------------------------------ //

function PipelineCard({
  pipeline, onRun, onEdit, onDuplicate, onDelete,
}: {
  pipeline: PipelineDef
  onRun: () => void
  onEdit: () => void
  onDuplicate: () => void
  onDelete: () => void
}) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex flex-col gap-3 hover:border-gray-700 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-white text-sm truncate">{pipeline.name}</p>
          <p className="text-xs text-gray-500 mt-0.5">{pipeline.steps.length} étape{pipeline.steps.length !== 1 ? 's' : ''}</p>
        </div>
        <StatusIcon status={pipeline.last_run_status ?? null} />
      </div>

      {pipeline.last_run && (
        <div className="flex items-center gap-2 text-xs text-gray-600">
          <Clock size={11} />
          <span>{formatDistanceToNow(pipeline.last_run)}</span>
          <StatusBadge status={pipeline.last_run_status ?? null} />
        </div>
      )}

      <div className="flex items-center gap-1.5 pt-1 border-t border-gray-800">
        <button
          onClick={onRun}
          className="flex items-center gap-1.5 px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs rounded-lg transition-colors"
        >
          <Play size={11} /> Exécuter
        </button>
        <button
          onClick={onEdit}
          className="flex items-center gap-1.5 px-2 py-1.5 text-gray-400 hover:text-white hover:bg-gray-800 text-xs rounded-lg transition-colors"
        >
          <Edit2 size={11} />
        </button>
        <button
          onClick={onDuplicate}
          className="flex items-center gap-1.5 px-2 py-1.5 text-gray-400 hover:text-white hover:bg-gray-800 text-xs rounded-lg transition-colors"
        >
          <Copy size={11} />
        </button>
        <button
          onClick={onDelete}
          className="flex items-center gap-1.5 px-2 py-1.5 text-gray-600 hover:text-red-400 hover:bg-red-900/20 text-xs rounded-lg transition-colors ml-auto"
        >
          <Trash2 size={11} />
        </button>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ //
// Main page                                                           //
// ------------------------------------------------------------------ //

export default function LibraryPage() {
  const navigate = useNavigate()
  const { data: pipelines = [], isLoading } = usePipelines()
  const invalidate = useInvalidatePipelines()

  const [showCreate, setShowCreate] = useState(false)
  const [editPipeline, setEditPipeline] = useState<PipelineDef | null>(null)

  async function handleRun(p: PipelineDef) {
    try {
      const { run_id } = await pipelinesAPI.startRun(p.id)
      toast.success(`Pipeline démarré — ${run_id}`)
      navigate(`/pipeline/${p.id}`)
    } catch {
      toast.error('Erreur au démarrage')
    }
  }

  async function handleDelete(p: PipelineDef) {
    if (!window.confirm(`Supprimer "${p.name}" ?`)) return
    try {
      await pipelinesAPI.delete(p.id)
      toast.success('Supprimé')
      invalidate()
    } catch {
      toast.error('Erreur')
    }
  }

  async function handleDuplicate(p: PipelineDef) {
    try {
      await pipelinesAPI.create(`${p.name} (copie)`, p.steps)
      toast.success('Dupliqué')
      invalidate()
    } catch {
      toast.error('Erreur')
    }
  }

  async function duplicateTemplate(tpl: typeof TEMPLATES[0]) {
    try {
      await pipelinesAPI.create(tpl.name, tpl.steps)
      toast.success('Template dupliqué dans votre bibliothèque')
      invalidate()
    } catch {
      toast.error('Erreur')
    }
  }

  return (
    <div className="p-6 space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <GitBranch size={22} className="text-indigo-400" />
          <h1 className="text-xl font-semibold text-white">Bibliothèque</h1>
          {pipelines.length > 0 && (
            <span className="text-xs bg-gray-800 text-gray-400 border border-gray-700 rounded-full px-2 py-0.5">
              {pipelines.length}
            </span>
          )}
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm rounded-lg transition-colors"
        >
          <Plus size={15} /> Nouveau pipeline
        </button>
      </div>

      {/* User pipelines */}
      {isLoading ? (
        <div className="flex items-center justify-center h-32 text-gray-500 text-sm">Chargement…</div>
      ) : pipelines.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-32 gap-2 text-gray-600">
          <GitBranch size={32} className="text-gray-800" />
          <p className="text-sm">Aucun pipeline — créez-en un ou dupliquez un template</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {pipelines.map(p => (
            <PipelineCard
              key={p.id}
              pipeline={p}
              onRun={() => handleRun(p)}
              onEdit={() => setEditPipeline(p)}
              onDuplicate={() => handleDuplicate(p)}
              onDelete={() => handleDelete(p)}
            />
          ))}
        </div>
      )}

      {/* Templates */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <Lock size={13} className="text-gray-500" />
          <h2 className="text-sm font-semibold text-gray-400">Templates prédéfinis</h2>
          <span className="text-xs text-gray-600">(lecture seule — dupliquer pour modifier)</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {TEMPLATES.map(tpl => (
            <div
              key={tpl.name}
              className="bg-gray-900/60 border border-gray-800 border-dashed rounded-xl p-4 flex flex-col gap-3"
            >
              <div>
                <p className="font-semibold text-gray-300 text-sm">{tpl.name}</p>
                <p className="text-xs text-gray-600 mt-0.5">{tpl.description}</p>
                <p className="text-xs text-gray-600 mt-1">{tpl.steps.length} étapes</p>
              </div>
              <button
                onClick={() => duplicateTemplate(tpl)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs rounded-lg border border-gray-700 transition-colors w-fit"
              >
                <Copy size={11} /> Dupliquer
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Modals */}
      {showCreate && (
        <PipelineModal
          onClose={() => setShowCreate(false)}
          onSaved={() => invalidate()}
        />
      )}
      {editPipeline && (
        <PipelineModal
          initial={editPipeline}
          onClose={() => setEditPipeline(null)}
          onSaved={() => { invalidate(editPipeline.id); setEditPipeline(null) }}
        />
      )}
    </div>
  )
}
