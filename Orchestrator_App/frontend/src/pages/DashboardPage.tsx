// ============================================================
// DashboardPage.tsx
// Cards de statut des 5 apps + widget run actif + feed activité.
// ============================================================

import { ExternalLink, CheckCircle2, XCircle, RefreshCw, Clock } from 'lucide-react'
import { useHealth } from '../hooks/useHealth'
import { useActivity } from '../hooks/useActivity'
import { useQuery } from '@tanstack/react-query'
import { pipelinesAPI } from '../api/client'
import type { AppName, ActivityRun } from '../types/api'
import { formatDistanceToNow } from '../utils/time'
import { useT } from '../i18n/useLang'

const APP_ORDER: AppName[] = [
  'Annotation_App',
  'Dataset_Explorer_App',
  'dvc-app',
  'mlflow-app',
  'optuna-app',
]

const APP_LABELS: Record<AppName, string> = {
  Annotation_App: 'Annotation',
  Dataset_Explorer_App:   'Dataset Explorer',
  'dvc-app':      'DVC',
  'mlflow-app':   'MLflow',
  'optuna-app':   'Optuna',
}

const STATUS_COLOR: Record<string, string> = {
  success: 'bg-emerald-900/40 text-emerald-400 border-emerald-700/40',
  failed:  'bg-red-900/40 text-red-400 border-red-700/40',
  running: 'bg-blue-900/40 text-blue-400 border-blue-700/40',
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`px-2 py-0.5 rounded text-xs border font-medium ${STATUS_COLOR[status] ?? 'bg-gray-800 text-gray-400 border-gray-700'}`}>
      {status}
    </span>
  )
}

function ActiveRunWidget() {
  const t = useT()
  const { data: activity } = useActivity(10, 3_000)
  const { data: pipelines } = useQuery({
    queryKey: ['pipelines'],
    queryFn:  pipelinesAPI.list,
    staleTime: 10_000,
  })

  const running = activity?.find(r => r.status === 'running')
  if (!running) return null

  const pipeline = pipelines?.find(p => p.id === running.pipeline_id)
  const done  = Object.values(running.step_results ?? {}).filter(s => s.status !== 'running' && s.status !== 'pending').length
  const total = running.step_count
  const pct   = total > 0 ? Math.round((done / total) * 100) : 0

  return (
    <div className="bg-gray-900 border border-blue-800/40 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-2">
        <span className="inline-block w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
        <span className="text-sm font-semibold text-white">{pipeline?.name ?? running.pipeline_name}</span>
        <span className="ml-auto text-xs text-gray-500 font-mono">{running.run_id}</span>
      </div>
      <div className="flex items-center justify-between text-xs text-gray-400 mb-1.5">
        <span>{t('Étapes')} {done}/{total}</span>
        <span>{pct}%</span>
      </div>
      <div className="w-full h-1.5 bg-gray-800 rounded-full overflow-hidden">
        <div className="h-full bg-blue-500 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function ActivityFeed({ runs }: { runs: ActivityRun[] }) {
  const t = useT()
  if (runs.length === 0) {
    return (
      <div className="text-center py-6 text-gray-600 text-sm">
        {t('Aucune exécution récente')}
      </div>
    )
  }
  return (
    <div className="space-y-1">
      {runs.map(run => (
        <div key={run.run_id} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-800/50 transition-colors">
          <StatusBadge status={run.status} />
          <span className="flex-1 text-sm text-gray-300 truncate">{run.pipeline_name}</span>
          <span className="text-xs text-gray-600 flex items-center gap-1 shrink-0">
            <Clock size={11} />
            {formatDistanceToNow(run.start_time)}
          </span>
        </div>
      ))}
    </div>
  )
}

export default function DashboardPage() {
  const t = useT()
  const { data: health, isLoading, refetch } = useHealth(10_000)
  const { data: activity = [] } = useActivity(10, 10_000)

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-white">Dashboard</h1>
        <button
          onClick={() => refetch()}
          className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
        >
          <RefreshCw size={15} />
        </button>
      </div>

      {/* App status cards */}
      <div>
        <h2 className="text-xs font-medium text-gray-500 uppercase mb-3">Applications</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          {APP_ORDER.map(name => {
            const info = health?.[name]
            const isOk = info?.status === 'ok'
            return (
              <div
                key={name}
                className={`bg-gray-900 border rounded-xl p-4 flex flex-col gap-2 transition-colors ${
                  isLoading ? 'border-gray-800' :
                  isOk      ? 'border-emerald-800/40' : 'border-red-800/30'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-gray-400">{APP_LABELS[name]}</span>
                  {isLoading ? (
                    <span className="w-2 h-2 rounded-full bg-gray-600" />
                  ) : isOk ? (
                    <CheckCircle2 size={14} className="text-emerald-400" />
                  ) : (
                    <XCircle size={14} className="text-red-400" />
                  )}
                </div>
                <div className="text-base font-semibold text-white">
                  {isLoading ? '…' : isOk ? (
                    <span className="text-emerald-400">online</span>
                  ) : (
                    <span className="text-red-400">offline</span>
                  )}
                </div>
                {info?.latency_ms != null && (
                  <p className="text-xs text-gray-600">{info.latency_ms} ms</p>
                )}
                {info?.frontend_url && (
                  <a
                    href={info.frontend_url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 transition-colors mt-auto"
                  >
                    <ExternalLink size={11} /> {t('Ouvrir')}
                  </a>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Active run widget */}
      <div>
        <h2 className="text-xs font-medium text-gray-500 uppercase mb-3">{t('Pipeline actif')}</h2>
        <ActiveRunWidget />
        {!activity.some(r => r.status === 'running') && (
          <p className="text-sm text-gray-600 py-2">{t("Aucun pipeline en cours d'exécution")}</p>
        )}
      </div>

      {/* Activity feed */}
      <div>
        <h2 className="text-xs font-medium text-gray-500 uppercase mb-3">{t('Activité récente')}</h2>
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <ActivityFeed runs={activity.slice(0, 10)} />
        </div>
      </div>
    </div>
  )
}
