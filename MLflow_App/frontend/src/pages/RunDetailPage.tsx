// ============================================================
// RunDetailPage.tsx
// Métriques (recharts), params, artifacts d'un run MLflow.
// ============================================================

import { useParams, useNavigate } from 'react-router-dom'
import { useRun } from '../hooks/useRuns'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { ArrowLeft, Activity, FileText, Package, GitCommit, Database, Workflow, Link2 } from 'lucide-react'
import type { MetricPoint } from '../types/api'

const COLORS = [
  '#6366f1', '#10b981', '#f59e0b', '#ef4444', '#3b82f6',
  '#8b5cf6', '#14b8a6', '#f97316', '#ec4899', '#06b6d4',
]

function formatTs(ms: number | null): string {
  if (!ms) return '—'
  return new Date(ms).toLocaleString('fr-FR')
}

function formatDuration(ms: number | null): string {
  if (!ms) return '—'
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return `${m}m ${s % 60}s`
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    FINISHED:  'bg-emerald-900/40 text-emerald-400 border-emerald-700/40',
    RUNNING:   'bg-blue-900/40 text-blue-400 border-blue-700/40',
    FAILED:    'bg-red-900/40 text-red-400 border-red-700/40',
    KILLED:    'bg-orange-900/40 text-orange-400 border-orange-700/40',
    SCHEDULED: 'bg-gray-800 text-gray-400 border-gray-700',
  }
  return (
    <span className={`px-2.5 py-1 rounded-lg text-xs border font-semibold ${map[status] ?? 'bg-gray-800 text-gray-400 border-gray-700'}`}>
      {status}
    </span>
  )
}

function MetricChart({ metricKey, history, color }: {
  metricKey: string
  history: MetricPoint[]
  color: string
}) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <h3 className="text-sm font-medium text-gray-300 mb-3">{metricKey}</h3>
      <ResponsiveContainer width="100%" height={180}>
        <LineChart data={history} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
          <XAxis
            dataKey="step"
            tick={{ fill: '#6b7280', fontSize: 10 }}
            axisLine={{ stroke: '#374151' }}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: '#6b7280', fontSize: 10 }}
            axisLine={{ stroke: '#374151' }}
            tickLine={false}
            width={55}
            tickFormatter={(v: number) => Number(v).toPrecision(4)}
          />
          <Tooltip
            contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8, fontSize: 12 }}
            labelStyle={{ color: '#9ca3af' }}
            itemStyle={{ color: '#f9fafb' }}
          />
          <Line
            type="monotone"
            dataKey="value"
            stroke={color}
            dot={false}
            strokeWidth={2}
            name={metricKey}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

export default function RunDetailPage() {
  const { runId } = useParams<{ runId: string }>()
  const navigate = useNavigate()
  const { data: run, isLoading, error } = useRun(runId ?? null)

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500 text-sm">
        Chargement du run…
      </div>
    )
  }

  if (error || !run) {
    return (
      <div className="p-6">
        <button onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-gray-400 hover:text-white text-sm mb-4">
          <ArrowLeft size={16} /> Retour
        </button>
        <div className="text-red-400 text-sm">Run introuvable ou serveur MLflow non disponible.</div>
      </div>
    )
  }

  const metricKeys = Object.keys(run.metric_history ?? {})
  const hasHistory = metricKeys.length > 0

  // Lineage : tags posés par l'Orchestrator (lien exact vers Run / Git / DVC).
  const tags = run.tags ?? {}
  const lineageFields = [
    { key: 'orch_run_id', label: 'Run orchestrateur', icon: <Workflow size={12} />, val: tags['orch_run_id'] },
    { key: 'graph_id',    label: 'Graphe',            icon: <Workflow size={12} />, val: tags['graph_id'] },
    { key: 'git_commit',  label: 'Git commit',        icon: <GitCommit size={12} />, val: tags['git_commit'] },
    { key: 'dataset_version', label: 'Dataset',       icon: <Database size={12} />, val: tags['dataset_version'] },
    { key: 'node_label',  label: 'Nœud',              icon: <Workflow size={12} />, val: tags['node_label'] },
    { key: 'stage',       label: 'Étape',             icon: <Activity size={12} />, val: tags['stage'] },
  ].filter(f => f.val)

  return (
    <div className="p-6 space-y-6">
      {/* Back + header */}
      <div>
        <button onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-gray-400 hover:text-white text-sm mb-4 transition-colors">
          <ArrowLeft size={16} /> Retour
        </button>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-white">
              {run.run_name || run.run_id.slice(0, 12)}
            </h1>
            <p className="text-xs text-gray-500 font-mono mt-1">{run.run_id}</p>
          </div>
          <StatusBadge status={run.status} />
        </div>
        {/* Info pills */}
        <div className="flex flex-wrap gap-3 mt-4">
          <span className="text-xs text-gray-400 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5">
            Début : {formatTs(run.start_time)}
          </span>
          <span className="text-xs text-gray-400 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5">
            Durée : {formatDuration(run.duration_ms)}
          </span>
          <span className="text-xs text-gray-400 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5">
            Exp ID : {run.experiment_id}
          </span>
        </div>
      </div>

      {/* Lineage — rôle de ce run dans la chaîne MLOps */}
      {lineageFields.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Link2 size={16} className="text-indigo-400" />
            <h2 className="text-sm font-semibold text-white">Lineage</h2>
            <span className="text-[11px] text-gray-500">quel code / quelles données ont produit ce run</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {lineageFields.map(f => (
              <div key={f.key} className="bg-gray-900 border border-indigo-800/30 rounded-xl p-3">
                <p className="flex items-center gap-1 text-[10px] text-gray-500 uppercase tracking-wide">
                  {f.icon}{f.label}
                </p>
                <p className="text-xs text-gray-100 font-mono mt-1 truncate" title={f.val}>{f.val}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Metric charts */}
      {hasHistory && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Activity size={16} className="text-indigo-400" />
            <h2 className="text-sm font-semibold text-white">Historique métriques</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {metricKeys.map((key, i) => (
              <MetricChart
                key={key}
                metricKey={key}
                history={run.metric_history[key] ?? []}
                color={COLORS[i % COLORS.length]}
              />
            ))}
          </div>
        </section>
      )}

      {/* Final metrics */}
      {Object.keys(run.metrics).length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Activity size={16} className="text-emerald-400" />
            <h2 className="text-sm font-semibold text-white">Métriques finales</h2>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
            {Object.entries(run.metrics).map(([k, v]) => (
              <div key={k} className="bg-gray-900 border border-gray-800 rounded-xl p-3 text-center">
                <p className="text-xs text-gray-500 truncate mb-1">{k}</p>
                <p className="text-base font-semibold text-white font-mono">{Number(v).toPrecision(5)}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Params */}
      {Object.keys(run.params).length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <FileText size={16} className="text-blue-400" />
            <h2 className="text-sm font-semibold text-white">Paramètres</h2>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium uppercase w-1/3">Paramètre</th>
                  <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium uppercase">Valeur</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(run.params).map(([k, v], i) => (
                  <tr key={k} className={i > 0 ? 'border-t border-gray-800/60' : ''}>
                    <td className="px-4 py-2.5 text-gray-400 font-mono text-xs">{k}</td>
                    <td className="px-4 py-2.5 text-white font-mono text-xs">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Artifacts */}
      {run.artifacts && run.artifacts.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Package size={16} className="text-orange-400" />
            <h2 className="text-sm font-semibold text-white">Artifacts</h2>
            <span className="text-xs text-gray-500 bg-gray-800 border border-gray-700 rounded-full px-2 py-0.5">
              {run.artifacts.length}
            </span>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium uppercase">Chemin</th>
                  <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium uppercase">Type</th>
                  <th className="text-right px-4 py-2.5 text-xs text-gray-500 font-medium uppercase">Taille</th>
                </tr>
              </thead>
              <tbody>
                {run.artifacts.map((a, i) => (
                  <tr key={a.path} className={i > 0 ? 'border-t border-gray-800/60' : ''}>
                    <td className="px-4 py-2.5 text-gray-200 font-mono text-xs">{a.path}</td>
                    <td className="px-4 py-2.5 text-xs">
                      {a.is_dir ? (
                        <span className="text-blue-400">Dossier</span>
                      ) : (
                        <span className="text-gray-400">Fichier</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-400 text-xs font-mono">
                      {a.file_size != null ? `${(a.file_size / 1024).toFixed(1)} KB` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}
