// ============================================================
// ExperimentsPage.tsx
// Liste des expériences + drill-down runs par expérience.
// ============================================================

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { FlaskConical, Plus, Trash2, ChevronRight, RefreshCw, X, GitFork } from 'lucide-react'
import { experimentsAPI, runsAPI } from '../api/client'
import type { Experiment, RunSummary } from '../types/api'
import { useT } from '../i18n/useLang'

function formatTs(ms: number | null): string {
  if (!ms) return '—'
  return new Date(ms).toLocaleDateString('fr-FR', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

// Code couleur par ROLE du run (tag `run_type`, fallback `stage`) — pose par
// l'orchestrateur. Rend le pipeline lisible d'un coup d'oeil sans lire les logs.
const RUN_TYPE_META: Record<string, { label: string; cls: string }> = {
  training:   { label: 'Training',   cls: 'bg-blue-900/40 text-blue-300 border-blue-700/40' },
  evaluation: { label: 'Evaluation', cls: 'bg-amber-900/40 text-amber-300 border-amber-700/40' },
  inference:  { label: 'Inference',  cls: 'bg-cyan-900/40 text-cyan-300 border-cyan-700/40' },
  hpo:        { label: 'HPO',        cls: 'bg-violet-900/40 text-violet-300 border-violet-700/40' },
}
function runType(tags: Record<string, string>): string {
  return tags['run_type'] || tags['stage'] || ''
}
function RunTypeBadge({ tags }: { tags: Record<string, string> }) {
  const t = runType(tags)
  const m = RUN_TYPE_META[t]
  if (!m) return <span className="text-[10px] text-gray-600">—</span>
  return <span className={`px-2 py-0.5 rounded text-[11px] border font-medium ${m.cls}`}>{m.label}</span>
}

function StatusBadge({ status }: { status: RunSummary['status'] }) {
  const map: Record<string, string> = {
    FINISHED:  'bg-emerald-900/40 text-emerald-400 border-emerald-700/40',
    RUNNING:   'bg-blue-900/40 text-blue-400 border-blue-700/40',
    FAILED:    'bg-red-900/40 text-red-400 border-red-700/40',
    KILLED:    'bg-orange-900/40 text-orange-400 border-orange-700/40',
    SCHEDULED: 'bg-gray-800 text-gray-400 border-gray-700',
  }
  return (
    <span className={`px-2 py-0.5 rounded text-xs border font-medium ${map[status] ?? 'bg-gray-800 text-gray-400 border-gray-700'}`}>
      {status}
    </span>
  )
}

function CreateModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const t = useT()
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setLoading(true)
    try {
      await experimentsAPI.create(name.trim())
      toast.success(t('Expérience créée'))
      onCreated()
      onClose()
    } catch {
      toast.error(t('Erreur lors de la création'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-md p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-white font-semibold text-base">{t('Nouvelle expérience')}</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300">
            <X size={18} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">{t('Nom')}</label>
            <input
              autoFocus
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder={t('mon-expérience')}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose}
              className="px-4 py-2 text-sm text-gray-400 hover:text-white rounded-lg hover:bg-gray-800 transition-colors">
              {t('Annuler')}
            </button>
            <button type="submit" disabled={!name.trim() || loading}
              className="px-4 py-2 text-sm bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg transition-colors">
              {loading ? t('Création…') : t('Créer')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// Ordonne les runs en arbre de fork : parent puis enfants indentes. La cle qui unit
// tout le monde = orch_run_id (tag pose par l'orchestrateur, aussi dans le trailer git
// et le run_lineage). fork_parent_run pointe le orch_run_id du run parent.
function orderRunsByFork(runs: RunSummary[]): { run: RunSummary; depth: number }[] {
  const orchId = (r: RunSummary) => r.tags['orch_run_id'] || ''
  const byOrch = new Map(runs.map(r => [orchId(r), r]))
  const childrenOf = new Map<string, RunSummary[]>()
  const roots: RunSummary[] = []
  for (const r of runs) {
    const parent = r.tags['fork_parent_run'] || ''
    if (parent && byOrch.has(parent)) (childrenOf.get(parent) ?? childrenOf.set(parent, []).get(parent)!).push(r)
    else roots.push(r)
  }
  const out: { run: RunSummary; depth: number }[] = []
  const walk = (r: RunSummary, depth: number) => {
    out.push({ run: r, depth })
    for (const c of childrenOf.get(orchId(r)) ?? []) walk(c, depth + 1)
  }
  for (const r of roots) walk(r, 0)
  return out
}

function RunsPanel({ experiment }: { experiment: Experiment }) {
  const t = useT()
  const navigate = useNavigate()
  const { data: runs, isLoading, refetch } = useQuery({
    queryKey: ['runs', experiment.experiment_id],
    queryFn:  () => runsAPI.list(experiment.experiment_id),
    staleTime: 10_000,
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-20 text-gray-500 text-sm">
        {t('Chargement des runs…')}
      </div>
    )
  }

  if (!runs || runs.length === 0) {
    return (
      <div className="flex items-center justify-center h-16 text-gray-500 text-sm">
        {t('Aucun run dans cette expérience')}
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800">
        <span className="text-xs text-gray-400">{runs.length} {t('run(s)')}</span>
        <button onClick={() => refetch()} className="text-gray-500 hover:text-gray-300 p-1 rounded">
          <RefreshCw size={13} />
        </button>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-gray-500 uppercase">
            <th className="text-left px-4 py-2 font-medium">{t('Nom')}</th>
            <th className="text-left px-4 py-2 font-medium">{t('Rôle')}</th>
            <th className="text-left px-4 py-2 font-medium" title={t("orch_run_id : la clé unique qui relie ce run à Git, DVC et l'orchestrateur")}>{t('ID unifié')}</th>
            <th className="text-left px-4 py-2 font-medium">{t('Statut')}</th>
            <th className="text-left px-4 py-2 font-medium">{t('Début')}</th>
            <th className="text-left px-4 py-2 font-medium">{t('Métriques finales')}</th>
            <th className="px-4 py-2" />
          </tr>
        </thead>
        <tbody>
          {orderRunsByFork(runs).map(({ run, depth }) => {
            const orchId = run.tags['orch_run_id'] || ''
            const forkParent = run.tags['fork_parent_run'] || ''
            return (
              <tr key={run.run_id}
                onClick={() => navigate(`/runs/${run.run_id}`)}
                className="border-t border-gray-800/60 hover:bg-gray-800/50 cursor-pointer transition-colors">
                <td className="px-4 py-2.5 text-gray-200 font-medium">
                  <div className="flex items-center gap-2" style={{ paddingLeft: depth * 18 }}>
                    {depth > 0 && <GitFork size={12} className="text-indigo-400 shrink-0" />}
                    <span className="truncate">{run.run_name || run.run_id.slice(0, 8)}</span>
                    {forkParent && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-900/30 text-indigo-300 border border-indigo-700/40 shrink-0">
                        {t('fork de')} {forkParent.slice(0, 6)}
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-2.5"><RunTypeBadge tags={run.tags} /></td>
                <td className="px-4 py-2.5 font-mono text-xs text-amber-300">{orchId ? orchId.slice(0, 8) : '—'}</td>
                <td className="px-4 py-2.5"><StatusBadge status={run.status} /></td>
                <td className="px-4 py-2.5 text-gray-400 text-xs">{formatTs(run.start_time)}</td>
                <td className="px-4 py-2.5 text-gray-400 text-xs font-mono">
                  {Object.entries(run.metrics).slice(0, 3).map(([k, v]) => (
                    <span key={k} className="mr-3">{k}: {Number(v).toFixed(4)}</span>
                  ))}
                </td>
                <td className="px-4 py-2.5 text-right">
                  <ChevronRight size={14} className="text-gray-600 ml-auto" />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export default function ExperimentsPage() {
  const t = useT()
  const qc = useQueryClient()
  const { data: experiments, isLoading, refetch } = useQuery({
    queryKey: ['experiments'],
    queryFn:  experimentsAPI.list,
    staleTime: 10_000,
  })
  const [expanded, setExpanded] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)

  const handleDelete = async (exp: Experiment, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!window.confirm(`${t("Supprimer l'expérience")} "${exp.name}" ?`)) return
    setDeleting(exp.experiment_id)
    try {
      await experimentsAPI.delete(exp.experiment_id)
      toast.success(t('Expérience supprimée'))
      qc.invalidateQueries({ queryKey: ['experiments'] })
      if (expanded === exp.experiment_id) setExpanded(null)
    } catch {
      toast.error(t('Erreur lors de la suppression'))
    } finally {
      setDeleting(null)
    }
  }

  const handleToggle = (id: string) => setExpanded(prev => prev === id ? null : id)

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <FlaskConical size={22} className="text-indigo-400" />
          <h1 className="text-xl font-semibold text-white">{t('Expériences')}</h1>
          {experiments && (
            <span className="text-xs bg-gray-800 text-gray-400 border border-gray-700 rounded-full px-2 py-0.5">
              {experiments.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => refetch()}
            className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors">
            <RefreshCw size={16} />
          </button>
          <button onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm rounded-lg transition-colors">
            <Plus size={16} />
            {t('Nouvelle expérience')}
          </button>
        </div>
      </div>

      {/* Legende : lecture d'une experience + code couleur des roles */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-gray-400 bg-gray-900/50 border border-gray-800 rounded-lg px-4 py-2.5">
        <span className="text-gray-500">
          {t('Une')} <b className="text-gray-300">{t('expérience')}</b> {t('= un projet (graphe MLOps) qui regroupe tous ses runs.')}
          {' '}{t('Le')} <b className="text-gray-300">{t('rôle')}</b> {t("distingue chaque étape ; l'")}<b className="text-amber-300">{t('ID unifié')}</b> {t('(orch_run_id)')}
          {' '}{t('relie chaque run à Git/DVC/orchestrateur ; les')} <b className="text-indigo-300">forks</b> {t('sont indentés sous leur parent.')}
        </span>
        {Object.values(RUN_TYPE_META).map(m => (
          <span key={m.label} className={`px-2 py-0.5 rounded text-[11px] border font-medium ${m.cls}`}>{m.label}</span>
        ))}
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center h-40 text-gray-500 text-sm">
          {t('Chargement…')}
        </div>
      ) : !experiments || experiments.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-40 gap-2 text-gray-500">
          <FlaskConical size={32} className="text-gray-700" />
          <p className="text-sm">{t('Aucune expérience trouvée')}</p>
          <p className="text-xs text-gray-600">{t('Créez votre première expérience ou vérifiez que MLflow est actif')}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {experiments.map(exp => (
            <div key={exp.experiment_id}
              className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              {/* Experiment row */}
              <div
                onClick={() => handleToggle(exp.experiment_id)}
                className="flex items-center gap-3 px-4 py-3.5 cursor-pointer hover:bg-gray-800/50 transition-colors select-none">
                <ChevronRight size={16}
                  className={`text-gray-500 transition-transform flex-shrink-0 ${expanded === exp.experiment_id ? 'rotate-90' : ''}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-white font-medium text-sm truncate">{exp.name}</span>
                    {exp.lifecycle_stage !== 'active' && (
                      <span className="text-xs text-orange-400 bg-orange-900/30 px-1.5 py-0.5 rounded border border-orange-700/30">
                        {exp.lifecycle_stage}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5 font-mono">
                    ID: {exp.experiment_id}
                  </p>
                </div>
                <div className="text-xs text-gray-500 flex-shrink-0 mr-4">
                  {formatTs(exp.creation_time)}
                </div>
                <button
                  onClick={e => handleDelete(exp, e)}
                  disabled={deleting === exp.experiment_id}
                  className="p-1.5 text-gray-600 hover:text-red-400 hover:bg-red-900/20 rounded-lg transition-colors disabled:opacity-50">
                  <Trash2 size={14} />
                </button>
              </div>

              {/* Runs panel */}
              {expanded === exp.experiment_id && (
                <div className="border-t border-gray-800 bg-gray-950/50">
                  <RunsPanel experiment={exp} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <CreateModal
          onClose={() => setShowCreate(false)}
          onCreated={() => qc.invalidateQueries({ queryKey: ['experiments'] })}
        />
      )}
    </div>
  )
}
