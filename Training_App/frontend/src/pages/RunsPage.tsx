// ============================================================
// pages/RunsPage.tsx
// Historique des runs — tableau + detail.
// ============================================================

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  CheckCircle2, XCircle, StopCircle, Clock, Loader2,
  Trash2, FolderOpen, RefreshCw, BarChart2,
} from 'lucide-react'
import { trainingAPI, artifactUrl, type ArtifactList, type EpochMetrics, type InferenceCase } from '../api/client'
import type { TrainingRun } from '../types/api'
import { useT } from '../i18n/useLang'

// ── Galerie d'analyse : plots declares par le moteur du run ──

const ARTIFACT_SECTIONS: { key: keyof ArtifactList; title: string; desc: string }[] = [
  { key: 'summary',          title: 'Synthèse de l\'entraînement', desc: 'pertes et métriques par epoch' },
  { key: 'confusion',        title: 'Matrice de confusion',      desc: 'vrais / faux positifs par classe' },
  { key: 'curves',           title: 'Courbes PR / P / R / F1',   desc: 'précision-rappel (≈ ROC détection), F1 vs seuil' },
  { key: 'labels',           title: 'Distribution des labels',   desc: 'histogramme classes + nuage largeur/hauteur des boîtes' },
  { key: 'train_batches',    title: 'Batches d\'entraînement (augmentés)', desc: 'mosaic/mixup/HSV/flip appliqués, tel que vu par le réseau' },
  { key: 'val_labels',       title: 'Validation — vérité terrain',  desc: 'échantillon val_batch0_labels.jpg' },
  { key: 'val_predictions',  title: 'Validation — prédictions',     desc: 'val_batch0_pred.jpg, régénéré à chaque évaluation' },
]

function AnalysisGallery({ runName }: { runName: string }) {
  const t = useT()
  const { data, isLoading } = useQuery({
    queryKey: ['artifacts', runName],
    queryFn: () => trainingAPI.artifacts(runName),
  })
  if (isLoading) return <p className="text-xs text-gray-500">{t("Chargement des plots d'analyse…")}</p>
  if (!data) return null
  if (data.engine_error)
    return <p className="text-xs text-amber-400">{data.engine_error}</p>
  const sections = ARTIFACT_SECTIONS
    .map(s => ({ ...s, files: (data[s.key] as string[] | undefined) ?? [] }))
    .filter(s => s.files.length > 0)
  if (sections.length === 0)
    return <p className="text-xs text-gray-500">{t('Aucun plot d\'analyse (run non terminé ou plots désactivés).')}</p>
  return (
    <div className="space-y-4">
      {sections.map(s => (
        <div key={s.key}>
          <p className="text-xs font-medium text-gray-300">{t(s.title)}
            <span className="text-[10px] text-gray-600 ml-2">{t(s.desc)}</span></p>
          <div className="grid grid-cols-2 gap-2 mt-1.5">
            {s.files.map(f => (
              <a key={f} href={artifactUrl(runName, f)} target="_blank" rel="noreferrer"
                 className="block bg-gray-800/40 rounded-lg overflow-hidden border border-gray-800 hover:border-blue-600/50">
                <img src={artifactUrl(runName, f)} alt={f} className="w-full" loading="lazy" />
              </a>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function InferenceCasesView({ runName }: { runName: string }) {
  const t = useT()
  const [load, setLoad] = useState(false)
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['inference-cases', runName],
    queryFn: () => trainingAPI.inferenceCases(runName),
    enabled: load,
    retry: false,
  })
  const Case = ({ c }: { c: InferenceCase }) => (
    <a href={artifactUrl(runName, c.file)} target="_blank" rel="noreferrer"
       className="block bg-gray-800/40 rounded-lg overflow-hidden border border-gray-800 hover:border-blue-600/50">
      <img src={artifactUrl(runName, c.file)} alt={c.source} className="w-full" loading="lazy" />
      <p className="text-[10px] text-gray-500 px-1.5 py-1 truncate">
        {c.source} · {c.detections} det · conf {c.mean_conf}
      </p>
    </a>
  )
  if (!load)
    return (
      <button onClick={() => setLoad(true)}
        className="px-3 py-2 text-xs text-blue-300 border border-blue-700/50 hover:bg-blue-900/20 rounded-lg">
        {t('Analyser best / worst cases (inférence sur le set de validation)')}
      </button>
    )
  if (isLoading) return <p className="text-xs text-gray-500">{t('Inférence en cours sur les images de validation…')}</p>
  if (isError) return <p className="text-xs text-red-400">{t('Erreur : ')}{(error as Error & { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? t('inférence impossible')}</p>
  if (!data) return null
  return (
    <div className="space-y-3">
      <p className="text-[11px] text-gray-500">{data.n_images_scored} {t('images évaluées')}</p>
      <div>
        <p className="text-xs font-medium text-emerald-300 mb-1.5">{t('Meilleurs cas (détections nettes, haute confiance)')}</p>
        <div className="grid grid-cols-2 gap-2">{data.best.map((c, i) => <Case key={`b${i}`} c={c} />)}</div>
      </div>
      <div>
        <p className="text-xs font-medium text-red-300 mb-1.5">{t('Pires cas (rien détecté / faible confiance)')}</p>
        <div className="grid grid-cols-2 gap-2">{data.worst.map((c, i) => <Case key={`w${i}`} c={c} />)}</div>
      </div>
    </div>
  )
}

// ── Courbes d'évolution (SVG pur, sans dépendance) ───────────────────────────

function LineChartSVG({ series, height = 150, yLabel }: {
  series: { name: string; color: string; points: { x: number; y: number }[] }[]
  height?: number
  yLabel?: string
}) {
  const W = 560, H = height, PAD = { l: 44, r: 8, t: 8, b: 20 }
  const all = series.flatMap(s => s.points)
  if (all.length === 0) return null
  const xMin = Math.min(...all.map(p => p.x)), xMax = Math.max(...all.map(p => p.x))
  const yMin = Math.min(...all.map(p => p.y)), yMaxRaw = Math.max(...all.map(p => p.y))
  const yMax = yMaxRaw === yMin ? yMin + 1 : yMaxRaw
  const sx = (x: number) => PAD.l + ((x - xMin) / Math.max(xMax - xMin, 1)) * (W - PAD.l - PAD.r)
  const sy = (y: number) => H - PAD.b - ((y - yMin) / (yMax - yMin)) * (H - PAD.t - PAD.b)
  const yTicks = [yMin, (yMin + yMax) / 2, yMax]
  const xTicks = [xMin, Math.round((xMin + xMax) / 2), xMax]
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      {yTicks.map(t => (
        <g key={`y${t}`}>
          <line x1={PAD.l} x2={W - PAD.r} y1={sy(t)} y2={sy(t)} stroke="#1f2937" strokeDasharray="3 3" />
          <text x={PAD.l - 4} y={sy(t) + 3} fill="#6b7280" fontSize={9} textAnchor="end">{t.toPrecision(3)}</text>
        </g>
      ))}
      {xTicks.map(t => (
        <text key={`x${t}`} x={sx(t)} y={H - 6} fill="#6b7280" fontSize={9} textAnchor="middle">{t}</text>
      ))}
      {yLabel && <text x={8} y={12} fill="#4b5563" fontSize={9}>{yLabel}</text>}
      {series.map(s => s.points.length > 0 && (
        <polyline
          key={s.name}
          points={s.points.map(p => `${sx(p.x)},${sy(p.y)}`).join(' ')}
          fill="none" stroke={s.color} strokeWidth={1.6}
        />
      ))}
    </svg>
  )
}

function RunCurves({ runName }: { runName: string }) {
  const t = useT()
  const { data } = useQuery({
    queryKey: ['metrics-history', runName],
    queryFn: () => trainingAPI.metricsHistory(runName),
    refetchInterval: 10_000,
  })
  const epochs: EpochMetrics[] = data?.epochs ?? []
  if (epochs.length < 2) return null

  const pts = (key: keyof EpochMetrics) =>
    epochs.filter(e => e[key] != null).map(e => ({ x: e.epoch, y: e[key] as number }))

  const mapSeries = [
    { name: 'mAP50',    color: '#22c55e', points: pts('map50') },
    { name: 'mAP50-95', color: '#3b82f6', points: pts('map5095') },
  ]
  const lossSeries = [
    { name: 'box_loss', color: '#f59e0b', points: pts('box_loss') },
    { name: 'cls_loss', color: '#ef4444', points: pts('cls_loss') },
  ]
  return (
    <div className="space-y-3">
      <div>
        <div className="flex items-center gap-3 mb-1">
          <p className="text-xs text-gray-500">{t('Évolution mAP par epoch')}</p>
          <span className="text-[10px] text-green-400">— mAP50</span>
          <span className="text-[10px] text-blue-400">— mAP50-95</span>
        </div>
        <div className="bg-gray-800/40 rounded-xl p-2">
          <LineChartSVG series={mapSeries} yLabel="mAP" />
        </div>
      </div>
      <div>
        <div className="flex items-center gap-3 mb-1">
          <p className="text-xs text-gray-500">{t('Pertes (train)')}</p>
          <span className="text-[10px] text-amber-400">— box</span>
          <span className="text-[10px] text-red-400">— cls</span>
        </div>
        <div className="bg-gray-800/40 rounded-xl p-2">
          <LineChartSVG series={lossSeries} height={120} yLabel="loss" />
        </div>
      </div>
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_META: Record<TrainingRun['status'], { label: string; color: string; icon: React.ReactNode }> = {
  pending: { label: 'En attente', color: 'text-gray-400',  icon: <Clock size={13} /> },
  running: { label: 'En cours',   color: 'text-blue-400',  icon: <Loader2 size={13} className="animate-spin" /> },
  done:    { label: 'Terminé',    color: 'text-green-400', icon: <CheckCircle2 size={13} /> },
  error:   { label: 'Erreur',     color: 'text-red-400',   icon: <XCircle size={13} /> },
  stopped: { label: 'Arrêté',     color: 'text-amber-400', icon: <StopCircle size={13} /> },
}

function fmt(dt: string | null) {
  if (!dt) return '—'
  return new Date(dt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })
}

function dur(start: string | null, end: string | null) {
  if (!start || !end) return '—'
  const secs = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 1000)
  if (secs < 60) return `${secs}s`
  const m = Math.floor(secs / 60)
  const s = secs % 60
  if (m < 60) return `${m}m${s}s`
  return `${Math.floor(m / 60)}h${m % 60}m`
}

// ── Detail drawer ─────────────────────────────────────────────────────────────

function RunDetail({ run, onClose }: { run: TrainingRun; onClose: () => void }) {
  const t = useT()
  const meta = STATUS_META[run.status]
  const hp   = run.hyperparams ?? {}

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60">
      <div className="w-full sm:max-w-2xl max-h-[90vh] overflow-y-auto bg-gray-900 border border-gray-800 rounded-t-2xl sm:rounded-2xl p-6 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-white font-mono">{run.run_name}</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors text-sm">✕</button>
        </div>

        {/* Status row */}
        <div className="flex flex-wrap gap-3 text-xs">
          <span className={`flex items-center gap-1 ${meta.color}`}>{meta.icon}{t(meta.label)}</span>
          <span className="text-gray-600">·</span>
          <span className="text-gray-400">{run.engine} · {run.model_size}</span>
          <span className="text-gray-600">·</span>
          <span className="text-gray-400">{run.dataset_name || '—'}</span>
          <span className="text-gray-600">·</span>
          <span className="text-gray-400">{t('Durée: ')}{dur(run.started_at, run.finished_at)}</span>
        </div>

        {/* Metrics */}
        {(run.best_map50 !== null || run.best_map5095 !== null) && (
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-gray-800/60 rounded-xl p-3">
              <p className="text-[10px] text-gray-500 mb-1">mAP50</p>
              <p className="text-xl font-mono text-green-300">
                {run.best_map50 !== null ? run.best_map50.toFixed(4) : '—'}
              </p>
            </div>
            <div className="bg-gray-800/60 rounded-xl p-3">
              <p className="text-[10px] text-gray-500 mb-1">mAP50-95</p>
              <p className="text-xl font-mono text-blue-300">
                {run.best_map5095 !== null ? run.best_map5095.toFixed(4) : '—'}
              </p>
            </div>
          </div>
        )}

        {/* Courbes d'évolution par epoch */}
        <RunCurves runName={run.run_name} />

        {/* Analyse complète du modèle (confusion, PR/ROC, F1, results, val, augmentation) */}
        {(run.status === 'done') && (
          <div className="border-t border-gray-800 pt-3 space-y-4">
            <p className="text-sm font-semibold text-white">{t('Analyse du modèle')}</p>
            <AnalysisGallery runName={run.run_name} />
            <div>
              <p className="text-xs font-medium text-gray-300 mb-2">{t('Inférence — meilleurs / pires cas')}</p>
              <InferenceCasesView runName={run.run_name} />
            </div>
          </div>
        )}

        {/* Progress */}
        <div>
          <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
            <span>{t('Progression')}</span>
            <span>{run.current_epoch} / {run.total_epochs} epochs</span>
          </div>
          <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full ${run.status === 'done' ? 'bg-green-500' : run.status === 'error' ? 'bg-red-500' : 'bg-blue-500'}`}
              style={{ width: `${run.status === 'done' ? 100 : run.progress_pct}%` }}
            />
          </div>
        </div>

        {/* data.yaml */}
        <div>
          <p className="text-xs text-gray-500 mb-1">data.yaml</p>
          <p className="text-xs font-mono text-gray-300 break-all">{run.data_yaml || '—'}</p>
        </div>

        {/* Best model */}
        {run.best_model_path && (
          <div>
            <p className="text-xs text-gray-500 mb-1 flex items-center gap-1"><FolderOpen size={11} /> {t('Meilleur modèle')}</p>
            <p className="text-xs font-mono text-green-300 break-all">{run.best_model_path}</p>
          </div>
        )}

        {/* Error */}
        {run.error_message && (
          <div className="p-3 bg-red-900/10 border border-red-700/30 rounded-xl">
            <p className="text-xs text-red-400 font-mono whitespace-pre-wrap">{run.error_message}</p>
          </div>
        )}

        {/* Hyperparams */}
        {Object.keys(hp).length > 0 && (
          <div>
            <p className="text-xs text-gray-500 mb-2">{t('Hyperparamètres')}</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
              {Object.entries(hp).map(([k, v]) => (
                <div key={k} className="bg-gray-800/50 rounded-lg px-2.5 py-1.5">
                  <p className="text-[9px] text-gray-600 truncate">{k}</p>
                  <p className="text-xs font-mono text-gray-300">{String(v)}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Dates */}
        <div className="text-[10px] text-gray-600 space-y-0.5 border-t border-gray-800 pt-3">
          <p>{t('Créé : ')}{fmt(run.created_at)}</p>
          <p>{t('Démarré : ')}{fmt(run.started_at)}</p>
          <p>{t('Terminé : ')}{fmt(run.finished_at)}</p>
        </div>
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function RunsPage() {
  const t = useT()
  const qc = useQueryClient()
  const [selected, setSelected] = useState<TrainingRun | null>(null)
  const [deletingId, setDeletingId] = useState<number | null>(null)

  const { data: runs = [], isFetching } = useQuery<TrainingRun[]>({
    queryKey: ['runs'],
    queryFn: () => trainingAPI.list(),
    refetchInterval: 5000,
  })

  const handleDelete = async (run: TrainingRun) => {
    if (!confirm(`${t('Supprimer le run "')}${run.run_name}${t('" ?')}`)) return
    setDeletingId(run.id)
    try {
      await trainingAPI.delete(run.run_name)
      toast.success(t('Run supprimé'))
      qc.invalidateQueries({ queryKey: ['runs'] })
      if (selected?.id === run.id) setSelected(null)
    } catch {
      toast.error(t('Erreur suppression'))
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="min-h-screen p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <BarChart2 size={22} className="text-blue-400" /> {t('Historique')}
          </h1>
          <p className="text-gray-400 mt-1 text-sm">{runs.length} run{runs.length !== 1 ? 's' : ''}</p>
        </div>
        <button
          onClick={() => qc.invalidateQueries({ queryKey: ['runs'] })}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs text-gray-400 border border-gray-700 hover:border-gray-600 transition-colors"
        >
          <RefreshCw size={12} className={isFetching ? 'animate-spin' : ''} /> {t('Actualiser')}
        </button>
      </div>

      {/* Empty state */}
      {runs.length === 0 && !isFetching && (
        <div className="text-center py-20 text-gray-600">
          <BarChart2 size={40} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">{t("Aucun run pour l'instant")}</p>
          <p className="text-xs mt-1">{t("Lancez un entraînement depuis l'onglet Training")}</p>
        </div>
      )}

      {/* Table */}
      {runs.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-xs text-gray-500">
                <th className="text-left px-4 py-3 font-medium">Run</th>
                <th className="text-left px-4 py-3 font-medium">{t('Modèle')}</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="text-right px-4 py-3 font-medium">mAP50</th>
                <th className="text-right px-4 py-3 font-medium">mAP50-95</th>
                <th className="text-right px-4 py-3 font-medium">{t('Durée')}</th>
                <th className="text-right px-4 py-3 font-medium">{t('Créé')}</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/60">
              {[...runs].reverse().map(run => {
                const meta = STATUS_META[run.status]
                return (
                  <tr
                    key={run.id}
                    onClick={() => setSelected(run)}
                    className="hover:bg-gray-800/40 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3">
                      <p className="font-mono text-xs text-white truncate max-w-[180px]">{run.run_name}</p>
                      {run.dataset_name && (
                        <p className="text-[10px] text-gray-500 truncate">{run.dataset_name}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs font-mono text-gray-300">{run.model_size}</span>
                      <p className="text-[10px] text-gray-500">{run.engine}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`flex items-center gap-1 text-xs ${meta.color}`}>
                        {meta.icon} {t(meta.label)}
                      </span>
                      {run.status === 'running' && (
                        <div className="mt-1 h-1 w-20 bg-gray-800 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-blue-500 rounded-full transition-all duration-500"
                            style={{ width: `${run.progress_pct}%` }}
                          />
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-xs font-mono text-green-300">
                        {run.best_map50 !== null ? run.best_map50.toFixed(4) : '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-xs font-mono text-blue-300">
                        {run.best_map5095 !== null ? run.best_map5095.toFixed(4) : '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-xs text-gray-400">
                      {dur(run.started_at, run.finished_at)}
                    </td>
                    <td className="px-4 py-3 text-right text-xs text-gray-500">
                      {fmt(run.created_at)}
                    </td>
                    <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                      <button
                        onClick={() => void handleDelete(run)}
                        disabled={deletingId === run.id}
                        className="p-1.5 rounded-lg text-gray-600 hover:text-red-400 hover:bg-red-900/20 transition-colors"
                        title={t('Supprimer')}
                      >
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Detail drawer */}
      {selected && <RunDetail run={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}
