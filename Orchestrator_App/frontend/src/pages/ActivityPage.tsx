// ============================================================
// ActivityPage.tsx
// Timeline complète des exécutions passées.
// ============================================================

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ChevronDown, ChevronRight, CheckCircle2, XCircle,
  Loader2, Clock, Filter, Copy, Network, ScrollText, Square,
} from 'lucide-react'
import { useActivity } from '../hooks/useActivity'
import type { ActivityRun, StepStatus } from '../types/api'
import { formatDateTime, formatDuration } from '../utils/time'
import { graphsAPI } from '../api/client'
import type { LogEntry } from './SandgraphPage'
import { LogBlocks } from './SandgraphPage'
import toast from 'react-hot-toast'
import { useWorkspaceStorageScope, workspaceStorageKey } from '../utils/workspaceStorage'
import { useT } from '../i18n/useLang'

// ------------------------------------------------------------------ //
// Badges                                                              //
// ------------------------------------------------------------------ //

const STATUS_STYLE: Record<string, string> = {
  success: 'bg-emerald-900/40 text-emerald-400 border-emerald-700/40',
  failed:  'bg-red-900/40 text-red-400 border-red-700/40',
  running: 'bg-blue-900/40 text-blue-400 border-blue-700/40',
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`px-2 py-0.5 rounded text-xs border font-medium ${STATUS_STYLE[status] ?? 'bg-gray-800 text-gray-400 border-gray-700'}`}>
      {status}
    </span>
  )
}

function StepStatusIcon({ status }: { status: StepStatus }) {
  if (status === 'running') return <Loader2 size={12} className="text-blue-400 animate-spin" />
  if (status === 'success') return <CheckCircle2 size={12} className="text-emerald-400" />
  if (status === 'failed')  return <XCircle size={12} className="text-red-400" />
  return <span className="w-3 h-3 rounded-full border border-gray-600 inline-block" />
}

// ------------------------------------------------------------------ //
// Helpers                                                             //
// ------------------------------------------------------------------ //

function _stepLabel(stepId: string): string {
  const parts = stepId.split('__')
  return parts.length === 2 ? parts[1] : stepId
}

function _extractGraphId(pipelineId: string): string | null {
  return pipelineId.startsWith('graph__') ? pipelineId.slice(7) : null
}

function _loadSavedLogs(graphId: string, workspaceScope: string | null): LogEntry[] {
  if (!workspaceScope) return []
  try {
    const raw = localStorage.getItem(workspaceStorageKey(workspaceScope, `logs_${graphId}`))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return parsed.map((e: Record<string, unknown>) => ({ ...e, ts: new Date(e.ts as string) }))
  } catch {
    return []
  }
}

// ------------------------------------------------------------------ //
// Run row                                                             //
// ------------------------------------------------------------------ //

function RunRow({
  run,
  onRefaire,
  onOpenGraph,
  onStop,
  isRefairePending,
  isStopPending,
  workspaceScope,
}: {
  run: ActivityRun
  onRefaire: () => void
  onOpenGraph: () => void
  onStop: () => void
  isRefairePending: boolean
  isStopPending: boolean
  workspaceScope: string | null
}) {
  const t = useT()
  const [expanded, setExpanded] = useState(false)
  const [showLogs, setShowLogs] = useState(false)
  const stepEntries = Object.entries(run.step_results ?? {})
  const successCount = stepEntries.filter(([, s]) => s.status === 'success').length
  const totalCount = stepEntries.length
  const graphId = _extractGraphId(run.pipeline_id)
  const savedLogs = graphId ? _loadSavedLogs(graphId, workspaceScope) : []

  return (
    <div className="border-b border-gray-800/60 last:border-0">
      {/* Main row */}
      <div className="flex items-center gap-3 px-4 py-3 hover:bg-gray-800/20 transition-colors">
        <button onClick={() => setExpanded(e => !e)} className="text-gray-600 shrink-0">
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <StatusBadge status={run.status} />
        <span className="flex-1 text-sm text-gray-200 font-medium truncate">
          {run.pipeline_name}
        </span>
        {totalCount > 0 && (
          <span className="text-xs text-gray-600 shrink-0">
            {successCount}/{totalCount} {t('étapes')}
          </span>
        )}
        <span className="flex items-center gap-1 text-xs text-gray-500 shrink-0">
          <Clock size={11} />
          {formatDateTime(run.start_time)}
        </span>
        <span className="text-xs text-gray-600 shrink-0 w-16 text-right">
          {formatDuration(run.duration_s)}
        </span>

        {/* Action buttons */}
        {graphId && (
          <div className="flex items-center gap-1 shrink-0 ml-1">
            <button
              onClick={onOpenGraph}
              title={t('Ouvrir le graphe')}
              className="p-1.5 text-gray-600 hover:text-indigo-400 hover:bg-gray-800 rounded transition-colors"
            >
              <Network size={12} />
            </button>
            {savedLogs.length > 0 && (
              <button
                onClick={() => setShowLogs(v => !v)}
                title={t('Voir les logs')}
                className={`p-1.5 rounded transition-colors ${showLogs ? 'text-indigo-400 bg-indigo-900/30' : 'text-gray-600 hover:text-indigo-400 hover:bg-gray-800'}`}
              >
                <ScrollText size={12} />
              </button>
            )}
            {run.status === 'running' && (
              <button
                onClick={onStop}
                disabled={isStopPending}
                title={t('Arrêter ce run')}
                className="flex items-center gap-1 px-2 py-1 text-[11px] text-red-400 border border-red-700/50 hover:bg-red-900/20 disabled:opacity-40 rounded transition-colors"
              >
                {isStopPending ? <Loader2 size={10} className="animate-spin" /> : <Square size={10} />}
                Stop
              </button>
            )}
            <button
              onClick={onRefaire}
              disabled={isRefairePending}
              title={t('Dupliquer et refaire')}
              className="flex items-center gap-1 px-2 py-1 text-[11px] text-indigo-400 border border-indigo-700/50 hover:bg-indigo-900/20 disabled:opacity-40 rounded transition-colors"
            >
              {isRefairePending ? <Loader2 size={10} className="animate-spin" /> : <Copy size={10} />}
              {t('Refaire')}
            </button>
          </div>
        )}
      </div>

      {/* Logs panel */}
      {/* step3 : logs COMPLETS identiques au Sandgraph — blocs colorés par node,
          DÉPLIABLES (repliés par défaut ici). */}
      {showLogs && savedLogs.length > 0 && (
        <div className="bg-gray-950 border-t border-gray-800/60 px-12 py-2 max-h-72 overflow-y-auto text-[11px]">
          <p className="text-[10px] text-gray-600 mb-1.5 uppercase tracking-wide">{t('Logs complets (dernier run)')}</p>
          <LogBlocks logs={savedLogs} defaultCollapsed />
        </div>
      )}

      {/* Step detail */}
      {expanded && (
        <div className="bg-gray-950 border-t border-gray-800/60">
          {stepEntries.length === 0 ? (
            <p className="px-12 py-3 text-xs text-gray-600">{t('Aucun détail disponible')}</p>
          ) : (
            stepEntries.map(([stepId, stepResult]) => (
              <div key={stepId} className="border-b border-gray-800/40 last:border-0">
                <div className="flex items-center gap-3 px-12 py-2">
                  <StepStatusIcon status={stepResult.status as StepStatus} />
                  <span className="text-xs text-gray-300 font-medium flex-1">{_stepLabel(stepId)}</span>
                  <span className="text-[10px] text-gray-600 font-mono">{stepId.split('__')[0]}</span>
                  <StatusBadge status={stepResult.status} />
                </div>
                {stepResult.output && (
                  <pre className="mx-12 mb-2 bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-[11px] text-gray-400 font-mono overflow-x-auto max-h-40 overflow-y-auto whitespace-pre-wrap">
                    {stepResult.output}
                  </pre>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ //
// Main page                                                           //
// ------------------------------------------------------------------ //

export default function ActivityPage() {
  const t = useT()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const workspaceScope = useWorkspaceStorageScope()
  const { data: activity = [], isLoading } = useActivity(200, 15_000)
  const [filterName,   setFilterName]   = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterDate,   setFilterDate]   = useState('')
  const [pendingRefaire, setPendingRefaire] = useState<string | null>(null)
  const [pendingStop, setPendingStop] = useState<string | null>(null)

  const filtered = activity.filter(run => {
    if (filterName   && !run.pipeline_name.toLowerCase().includes(filterName.toLowerCase())) return false
    if (filterStatus && run.status !== filterStatus) return false
    if (filterDate) {
      const runDate = new Date(run.start_time).toISOString().slice(0, 10)
      if (runDate !== filterDate) return false
    }
    return true
  })

  const refaireMut = useMutation({
    mutationFn: async (graphId: string) => {
      const dup = await graphsAPI.duplicate(graphId)
      await graphsAPI.reset(dup.graph_id)
      return dup.graph_id
    },
    onSuccess: (newId) => {
      qc.invalidateQueries({ queryKey: ['graphs'] })
      navigate(`/?graph_id=${encodeURIComponent(newId)}`)
      toast.success(t('Graphe dupliqué — prêt à relancer'))
    },
    onError: () => toast.error(t('Erreur lors de la duplication')),
    onSettled: () => setPendingRefaire(null),
  })

  function handleRefaire(pipelineId: string) {
    const graphId = _extractGraphId(pipelineId)
    if (!graphId) return
    setPendingRefaire(pipelineId)
    refaireMut.mutate(graphId)
  }

  const stopMut = useMutation({
    mutationFn: (graphId: string) => graphsAPI.stop(graphId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['activity'] })
      qc.invalidateQueries({ queryKey: ['graphs'] })
      toast(t('Run arrêté'))
    },
    onError: () => toast.error(t("Erreur lors de l'arrêt")),
    onSettled: () => setPendingStop(null),
  })

  function handleStop(pipelineId: string) {
    const graphId = _extractGraphId(pipelineId)
    if (!graphId) return
    setPendingStop(pipelineId)
    stopMut.mutate(graphId)
  }

  function handleOpenGraph(pipelineId: string) {
    const graphId = _extractGraphId(pipelineId)
    if (!graphId) return
    navigate(`/?graph_id=${encodeURIComponent(graphId)}`)
  }

  return (
    <div className="p-6 space-y-5 h-full overflow-y-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Clock size={22} className="text-indigo-400" />
        <h1 className="text-xl font-semibold text-white">{t('Activité')}</h1>
        {activity.length > 0 && (
          <span className="text-xs bg-gray-800 text-gray-400 border border-gray-700 rounded-full px-2 py-0.5">
            {activity.length}
          </span>
        )}
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-3 bg-gray-900 border border-gray-800 rounded-xl px-4 py-3">
        <Filter size={14} className="text-gray-500 shrink-0" />
        <input
          value={filterName}
          onChange={e => setFilterName(e.target.value)}
          placeholder={t('Filtrer par nom…')}
          className="flex-1 bg-transparent text-sm text-white placeholder-gray-600 focus:outline-none"
        />
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-xs text-gray-300 focus:outline-none focus:border-indigo-500"
        >
          <option value="">{t('Tous les statuts')}</option>
          <option value="success">success</option>
          <option value="failed">failed</option>
          <option value="running">running</option>
        </select>
        <input
          type="date"
          value={filterDate}
          onChange={e => setFilterDate(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-xs text-gray-300 focus:outline-none focus:border-indigo-500"
        />
        {(filterName || filterStatus || filterDate) && (
          <button
            onClick={() => { setFilterName(''); setFilterStatus(''); setFilterDate('') }}
            className="text-xs text-gray-500 hover:text-white transition-colors"
          >
            {t('Réinitialiser')}
          </button>
        )}
      </div>

      {/* Timeline */}
      {isLoading ? (
        <div className="flex items-center justify-center h-40 text-gray-500 text-sm">{t('Chargement…')}</div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-40 gap-2 text-gray-600">
          <Clock size={32} className="text-gray-800" />
          <p className="text-sm">{t('Aucune exécution trouvée')}</p>
        </div>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 border-b border-gray-800 grid grid-cols-[20px_80px_1fr_80px_140px_64px_120px] gap-3">
            {['', t('Statut'), t('Expérience'), t('Étapes'), t('Démarré'), t('Durée'), t('Actions')].map((h, i) => (
              <span key={i} className="text-xs font-medium text-gray-500 uppercase">{h}</span>
            ))}
          </div>
          {filtered.map(run => (
            <RunRow
              key={run.run_id}
              run={run}
              onRefaire={() => handleRefaire(run.pipeline_id)}
              onOpenGraph={() => handleOpenGraph(run.pipeline_id)}
              onStop={() => handleStop(run.pipeline_id)}
              isRefairePending={pendingRefaire === run.pipeline_id}
              isStopPending={pendingStop === run.pipeline_id}
              workspaceScope={workspaceScope}
            />
          ))}
        </div>
      )}

      {filtered.length > 0 && filtered.length < activity.length && (
        <p className="text-xs text-gray-600 text-right">
          {t('Affichage')} {filtered.length} / {activity.length}
        </p>
      )}
    </div>
  )
}
