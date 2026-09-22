// ============================================================
// CompareRunsPage.tsx
// Sélection de runs via checkboxes, métriques côte-à-côte.
// ============================================================

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  BarChart2, RefreshCw, Check,
} from 'lucide-react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer,
} from 'recharts'
import { experimentsAPI, runsAPI, compareAPI } from '../api/client'
import type { CompareResult, RunSummary } from '../types/api'
import { useT } from '../i18n/useLang'

const COLORS = [
  '#6366f1', '#10b981', '#f59e0b', '#ef4444', '#3b82f6',
  '#8b5cf6', '#14b8a6', '#f97316', '#ec4899', '#06b6d4',
]

function buildChartData(
  result: CompareResult,
  metricKey: string,
): { step: number; [runId: string]: number | undefined }[] {
  const byStep = new Map<number, Record<string, number>>()
  for (const [runId, run] of Object.entries(result.runs)) {
    const history = run.metric_history?.[metricKey] ?? []
    for (const pt of history) {
      if (!byStep.has(pt.step)) byStep.set(pt.step, {})
      byStep.get(pt.step)![runId] = pt.value
    }
  }
  return Array.from(byStep.entries())
    .sort(([a], [b]) => a - b)
    .map(([step, vals]) => ({ step, ...vals }))
}

function MetricCompareChart({
  metricKey, result,
}: { metricKey: string; result: CompareResult }) {
  const data = buildChartData(result, metricKey)
  const runIds = result.run_ids

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <h3 className="text-sm font-medium text-gray-300 mb-3">{metricKey}</h3>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
          <XAxis dataKey="step" tick={{ fill: '#6b7280', fontSize: 10 }} tickLine={false} axisLine={{ stroke: '#374151' }} />
          <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} tickLine={false} axisLine={{ stroke: '#374151' }} width={55}
            tickFormatter={(v: number) => Number(v).toPrecision(4)} />
          <Tooltip
            contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8, fontSize: 11 }}
            labelStyle={{ color: '#9ca3af' }}
          />
          <Legend wrapperStyle={{ fontSize: 11, color: '#9ca3af' }} />
          {runIds.map((runId, i) => {
            const run = result.runs[runId]
            return (
              <Line
                key={runId}
                type="monotone"
                dataKey={runId}
                name={run?.run_name || runId.slice(0, 8)}
                stroke={COLORS[i % COLORS.length]}
                dot={false}
                strokeWidth={2}
                isAnimationActive={false}
              />
            )
          })}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

export default function CompareRunsPage() {
  const t = useT()
  const [selectedExpId, setSelectedExpId] = useState<string>('')
  const [selectedRunIds, setSelectedRunIds] = useState<Set<string>>(new Set())
  const [result, setResult] = useState<CompareResult | null>(null)
  const [comparing, setComparing] = useState(false)
  const [selectedMetric, setSelectedMetric] = useState<string>('')

  const { data: experiments } = useQuery({
    queryKey: ['experiments'],
    queryFn:  experimentsAPI.list,
    staleTime: 10_000,
  })

  const { data: runs, isLoading: runsLoading, refetch: refetchRuns } = useQuery({
    queryKey: ['runs', selectedExpId],
    queryFn:  () => runsAPI.list(selectedExpId),
    enabled:  !!selectedExpId,
    staleTime: 10_000,
  })

  const toggleRun = (runId: string) => {
    setSelectedRunIds(prev => {
      const next = new Set(prev)
      if (next.has(runId)) next.delete(runId)
      else next.add(runId)
      return next
    })
    setResult(null)
  }

  const handleCompare = async () => {
    if (selectedRunIds.size < 2) {
      toast.error(t('Sélectionnez au moins 2 runs'))
      return
    }
    setComparing(true)
    try {
      const res = await compareAPI.compare(Array.from(selectedRunIds))
      setResult(res)
      if (res.all_metrics.length > 0) setSelectedMetric(res.all_metrics[0])
    } catch {
      toast.error(t('Erreur lors de la comparaison'))
    } finally {
      setComparing(false)
    }
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <BarChart2 size={22} className="text-indigo-400" />
        <h1 className="text-xl font-semibold text-white">{t('Comparer des runs')}</h1>
      </div>

      {/* Step 1 — Select experiment */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
        <h2 className="text-sm font-medium text-gray-300">{t('1. Sélectionner une expérience')}</h2>
        <select
          value={selectedExpId}
          onChange={e => { setSelectedExpId(e.target.value); setSelectedRunIds(new Set()); setResult(null) }}
          className="bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-500 w-full max-w-sm">
          <option value="">{t('— Choisir une expérience —')}</option>
          {experiments?.map(e => (
            <option key={e.experiment_id} value={e.experiment_id}>{e.name}</option>
          ))}
        </select>
      </div>

      {/* Step 2 — Select runs */}
      {selectedExpId && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
            <h2 className="text-sm font-medium text-gray-300">
              {t('2. Sélectionner les runs à comparer')}
              {selectedRunIds.size > 0 && (
                <span className="ml-2 text-xs text-indigo-400">({selectedRunIds.size} {t('sélectionné(s)')})</span>
              )}
            </h2>
            <button onClick={() => refetchRuns()}
              className="p-1.5 text-gray-500 hover:text-gray-300 rounded">
              <RefreshCw size={13} />
            </button>
          </div>
          {runsLoading ? (
            <div className="flex items-center justify-center h-20 text-gray-500 text-sm">{t('Chargement…')}</div>
          ) : !runs || runs.length === 0 ? (
            <div className="px-4 py-6 text-center text-gray-500 text-sm">{t('Aucun run dans cette expérience')}</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="w-10 px-4 py-2.5" />
                  <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium uppercase">{t('Nom')}</th>
                  <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium uppercase">{t('Statut')}</th>
                  {runs[0] && Object.keys(runs[0].metrics).slice(0, 4).map(k => (
                    <th key={k} className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium uppercase">{k}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {runs.map((run: RunSummary) => {
                  const checked = selectedRunIds.has(run.run_id)
                  return (
                    <tr key={run.run_id}
                      onClick={() => toggleRun(run.run_id)}
                      className={`border-t border-gray-800/60 cursor-pointer transition-colors ${
                        checked ? 'bg-indigo-900/20' : 'hover:bg-gray-800/40'
                      }`}>
                      <td className="px-4 py-2.5">
                        <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${
                          checked ? 'bg-indigo-600 border-indigo-500' : 'border-gray-600'
                        }`}>
                          {checked && <Check size={10} className="text-white" />}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-gray-200">{run.run_name || run.run_id.slice(0, 8)}</td>
                      <td className="px-4 py-2.5">
                        <span className={`text-xs px-1.5 py-0.5 rounded border ${
                          run.status === 'FINISHED' ? 'bg-emerald-900/40 text-emerald-400 border-emerald-700/40'
                          : run.status === 'FAILED'  ? 'bg-red-900/40 text-red-400 border-red-700/40'
                          : 'bg-gray-800 text-gray-400 border-gray-700'
                        }`}>{run.status}</span>
                      </td>
                      {Object.values(run.metrics).slice(0, 4).map((v, j) => (
                        <td key={j} className="px-4 py-2.5 text-gray-400 text-xs font-mono">
                          {Number(v).toPrecision(5)}
                        </td>
                      ))}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
          {/* Compare button */}
          <div className="flex justify-end px-4 py-3 border-t border-gray-800">
            <button
              onClick={handleCompare}
              disabled={selectedRunIds.size < 2 || comparing}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors">
              <BarChart2 size={15} />
              {comparing ? t('Comparaison…') : `${t('Comparer')} ${selectedRunIds.size} ${t('run(s)')}`}
            </button>
          </div>
        </div>
      )}

      {/* Step 3 — Results */}
      {result && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">{t('3. Résultats de comparaison')}</h2>
            {result.all_metrics.length > 1 && (
              <select
                value={selectedMetric}
                onChange={e => setSelectedMetric(e.target.value)}
                className="bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:border-indigo-500">
                {result.all_metrics.map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            )}
          </div>

          {/* Charts for each metric */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {(selectedMetric ? [selectedMetric] : result.all_metrics).map(metricKey => (
              <MetricCompareChart key={metricKey} metricKey={metricKey} result={result} />
            ))}
          </div>

          {/* Params comparison table */}
          {result.all_params.length > 0 && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-800">
                <h3 className="text-sm font-medium text-gray-300">{t('Paramètres comparés')}</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-800">
                      <th className="text-left px-4 py-2 text-gray-500 font-medium uppercase">{t('Paramètre')}</th>
                      {result.run_ids.map(runId => (
                        <th key={runId} className="text-left px-4 py-2 text-gray-500 font-medium">
                          {result.runs[runId]?.run_name || runId.slice(0, 8)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.all_params.map((param, i) => (
                      <tr key={param} className={i > 0 ? 'border-t border-gray-800/60' : ''}>
                        <td className="px-4 py-2 text-gray-400 font-mono">{param}</td>
                        {result.run_ids.map(runId => {
                          const val = result.runs[runId]?.params?.[param]
                          return (
                            <td key={runId} className="px-4 py-2 font-mono text-gray-200">
                              {val ?? <span className="text-gray-600">—</span>}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
