// ============================================================
// StudyDetailPage.tsx
// Progression, meilleur trial, table trials, graphiques.
// ============================================================

import { useParams, useNavigate, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTrials, useStudyStatus, useInvalidateStudies } from '../hooks/useStudies'
import { studiesAPI } from '../api/client'
import toast from 'react-hot-toast'
import {
  ArrowLeft, Square, Trophy,
  RefreshCw, AlertTriangle, CheckCircle2, Cpu,
} from 'lucide-react'
import type { Trial } from '../types/api'
import { StudyDashboard } from '../components/StudyDashboard'
import { useT } from '../i18n/useLang'

const TRIAL_STATE_STYLE: Record<string, string> = {
  COMPLETE: 'bg-emerald-900/40 text-emerald-400 border-emerald-700/40',
  PRUNED:   'bg-gray-800 text-gray-500 border-gray-700',
  FAIL:     'bg-red-900/40 text-red-400 border-red-700/40',
  RUNNING:  'bg-blue-900/40 text-blue-400 border-blue-700/40',
  WAITING:  'bg-gray-800 text-gray-400 border-gray-700',
  INTERRUPTED: 'bg-amber-900/40 text-amber-300 border-amber-700/40',
  LEGACY_PRUNED_UNKNOWN: 'bg-orange-950/40 text-orange-300 border-orange-800/40',
  LEGACY_FAILURE_RECOVERED: 'bg-red-950/40 text-red-300 border-red-800/40',
}

function TrialStateBadge({ state }: { state: string }) {
  return (
    <span className={`px-2 py-0.5 rounded text-xs border font-medium ${TRIAL_STATE_STYLE[state] ?? TRIAL_STATE_STYLE.FAIL}`}>
      {state}
    </span>
  )
}

function formatDuration(s: number | null): string {
  if (!s) return '—'
  if (s < 60) return `${s.toFixed(1)}s`
  return `${Math.floor(s / 60)}m ${(s % 60).toFixed(0)}s`
}

export default function StudyDetailPage() {
  const t = useT()
  const { studyName } = useParams<{ studyName: string }>()
  const navigate = useNavigate()
  const invalidate = useInvalidateStudies()
  const decodedName = studyName ? decodeURIComponent(studyName) : ''

  const { data: statusData } = useStudyStatus(
    decodedName,
    true,
  )
  const { data: trials, isLoading: trialsLoading, refetch: refetchTrials } = useTrials(decodedName)
  const isRunning = statusData?.status === 'running'
  const { data: analysis } = useQuery({
    queryKey: ['study-analysis', decodedName],
    queryFn: () => studiesAPI.analysis(decodedName),
    enabled: Boolean(decodedName),
    refetchInterval: isRunning ? 5_000 : 30_000,
    retry: false,
  })

  const handleStop = async () => {
    try {
      await studiesAPI.stop(decodedName)
      toast.success(t('Arrêt demandé'))
      invalidate(decodedName)
    } catch {
      toast.error(t("Erreur lors de l'arrêt"))
    }
  }

  const completedTrials = trials?.filter(t => t.state === 'COMPLETE') ?? []
  // Direction fournie par le backend (lue dans la DB de l'étude)
  const direction = (statusData as { direction?: string } | undefined)?.direction ?? 'MINIMIZE'
  const bestTrial = completedTrials.reduce<Trial | null>((best, t) => {
    if (t.value == null) return best
    if (!best || best.value == null) return t
    return (direction === 'MAXIMIZE' ? t.value > best.value : t.value < best.value) ? t : best
  }, null)
  const counts = statusData?.counts ?? { complete: completedTrials.length, failed: 0, pruned: 0, running: 0, waiting: 0, interrupted: 0 }
  const context = statusData?.context ?? {}
  const diagnostics = statusData?.diagnostics ?? []
  const diagnosticGroups = statusData?.diagnostic_groups ?? []
  const failedStudy = statusData?.status === 'error' || ((trials?.length ?? 0) > 0 && completedTrials.length === 0 && !isRunning)
  const planned = counts.planned ?? statusData?.n_trials ?? trials?.length ?? 0
  const finalized = counts.finalized ?? counts.complete + counts.failed + counts.pruned + counts.interrupted

  return (
    <div className="p-6 space-y-5">
      {/* Back */}
      <div className="flex items-center justify-between">
        <button onClick={() => navigate('/')}
          className="flex items-center gap-2 text-gray-400 hover:text-white text-sm transition-colors">
          <ArrowLeft size={16} /> {t('Retour aux études')}
        </button>
        <div className="flex items-center gap-2">
          <button onClick={() => { refetchTrials(); invalidate(decodedName) }}
            className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors">
            <RefreshCw size={15} />
          </button>
          {isRunning && (
            <button onClick={handleStop}
              className="flex items-center gap-2 px-3 py-2 bg-red-700/50 hover:bg-red-700/80 text-red-300 text-sm rounded-lg border border-red-700/30 transition-colors">
              <Square size={13} /> {t('Arrêter')}
            </button>
          )}
          <Link to={`/studies/${studyName}/launch`}
            className="flex items-center gap-2 px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm rounded-lg transition-colors">
            {t('Lancer une optimisation')}
          </Link>
        </div>
      </div>

      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold text-white">{decodedName}</h1>
        <p className="text-xs text-gray-500 mt-1">{context.source === 'orchestrator' ? t('Étude lancée depuis un nœud Sandgraph') : t('Étude lancée depuis Optuna App')}</p>
      </div>

      <StudyDashboard
        trials={trials ?? []}
        status={statusData}
        analysis={analysis}
        best={bestTrial}
        direction={direction}
      />

      {failedStudy && <div className="rounded-xl border border-red-700/50 bg-red-950/25 p-4">
        <div className="flex items-start gap-3"><AlertTriangle size={19} className="text-red-400 shrink-0 mt-0.5"/><div><h2 className="text-sm font-bold text-red-200">{t('ÉCHEC HPO officiel — aucun best_params Optuna')}</h2><p className="text-xs text-red-200/75 mt-1">{statusData?.error_msg || `${counts.failed} trial(s) FAIL, ${counts.pruned} PRUNED ${t('et')} 0 COMPLETE.`}</p><p className="text-xs text-gray-400 mt-2">{t('Les résultats physiques récupérés restent affichés ci-dessous, mais ils ne sont pas promus rétroactivement en trials COMPLETE.')}</p></div></div>
        {statusData?.recovered_candidate && <div className="mt-3 rounded-lg border border-amber-700/50 bg-amber-950/20 p-3 text-xs"><p className="font-semibold text-amber-200">{(statusData.recovered_candidate.tied_trials?.length ?? 0) > 1 ? `${t('Co-meilleurs candidats historiques récupérés · trials')} ${statusData.recovered_candidate.tied_trials?.map(n => `#${n}`).join(', ')}` : `${t('Meilleur candidat historique récupéré · trial #')}${statusData.recovered_candidate.trial}`}</p><p className="mt-1 text-gray-300"><span className="font-mono">{statusData.recovered_candidate.metric} = {Number(statusData.recovered_candidate.value).toPrecision(6)}</span> · {t('informatif, non COMPLETE')}</p><p className="mt-1 text-gray-400">{t('Le CSV historique peut avoir arrondi la métrique : aucun vainqueur officiel n’est inventé en cas d’égalité.')}</p><p className="mt-1 text-gray-400 font-mono break-words">{Object.entries(statusData.recovered_candidate.params).map(([k,v]) => `${k}=${v}`).join(' · ')}</p>{statusData.recovered_candidate.best_weights && <p className="mt-1 text-cyan-300 break-all">{t('Poids :')} {statusData.recovered_candidate.best_weights}</p>}</div>}
        {diagnosticGroups.length > 0 && <div className="mt-3 space-y-2">{diagnosticGroups.map(d => <div key={`${d.code}-${d.trials.join('-')}`} className="rounded-lg border border-red-900/50 bg-gray-950/50 p-3 text-xs"><p className="font-semibold text-red-300">{d.title} · {d.count}/{trials?.length ?? d.count} trial(s)</p><p className="text-[10px] text-gray-500">{t('Trials :')} {d.trials.map(n => `#${n}`).join(', ')}</p><p className="mt-1 text-gray-300 whitespace-pre-wrap break-words">{t('Cause :')} {d.reason}</p><p className="mt-1 text-emerald-300">{t('À faire :')} {d.action}</p></div>)}</div>}
      </div>}

      {!failedStudy && statusData && <div className={`rounded-xl border p-4 ${bestTrial ? 'border-emerald-700/50 bg-emerald-950/20' : 'border-blue-700/40 bg-blue-950/20'}`}>
        <div className="flex items-start gap-3">{bestTrial ? <CheckCircle2 size={19} className="text-emerald-400 shrink-0 mt-0.5"/> : <Cpu size={19} className="text-blue-400 shrink-0 mt-0.5"/>}<div><h2 className="text-sm font-bold text-white">{bestTrial ? `${t('HPO exploitable — meilleur trial officiel #')}${bestTrial.number}` : t('Étude en cours — aucun résultat officiel sélectionnable pour le moment')}</h2><p className="mt-1 text-xs text-gray-400">{finalized}/{planned} {t('trials finalisés')} · {counts.complete} COMPLETE · {counts.running} {t('actif(s)')} · {counts.waiting} {t('en attente')}</p></div></div>
      </div>}

      {/* Progress + stats */}
      {statusData && (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 text-center">
            <p className="text-xs text-gray-500 mb-1">{t('Planifiés')}</p><p className="text-lg font-semibold text-white">{planned}</p>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 text-center">
            <p className="text-xs text-gray-500 mb-1">{t('Finalisés')}</p><p className="text-lg font-semibold text-white">{finalized}</p>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 text-center">
            <p className="text-xs text-gray-500 mb-1">{t('Réussis')}</p><p className="text-lg font-semibold text-emerald-400">{counts.complete}</p>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 text-center">
            <p className="text-xs text-gray-500 mb-1">{t('Échoués')}</p><p className="text-lg font-semibold text-red-400">{counts.failed}</p>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 text-center"><p className="text-xs text-gray-500 mb-1">{t('Prunés')}</p><p className="text-lg font-semibold text-violet-300">{counts.pruned}</p></div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 text-center"><p className="text-xs text-gray-500 mb-1">{t('Interrompus')}</p><p className="text-lg font-semibold text-amber-300">{counts.interrupted}</p></div>
        </div>
      )}

      {/* Progress bar (si running) */}
      {isRunning && statusData && statusData.n_trials > 0 && (
        <div>
          <div className="flex items-center justify-between text-xs text-gray-400 mb-1.5">
            <span>{t('Progression')}</span>
            <span>{statusData.progress_pct}%</span>
          </div>
          <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-indigo-500 rounded-full transition-all duration-500"
              style={{ width: `${statusData.progress_pct}%` }}
            />
          </div>
        </div>
      )}

      {/* Best trial card */}
      {bestTrial && (
        <div className="bg-gray-900 border border-emerald-800/40 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Trophy size={16} className="text-amber-400" />
            <h2 className="text-sm font-semibold text-white">{t('Meilleur trial #')}{bestTrial.number}</h2>
            <span className="ml-auto font-mono text-emerald-400 text-sm font-semibold">
              {bestTrial.value != null ? Number(bestTrial.value).toPrecision(6) : '—'}
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {Object.entries(bestTrial.params).map(([k, v]) => (
              <div key={k} className="bg-gray-800 rounded-lg px-3 py-2">
                <p className="text-xs text-gray-500 truncate">{k}</p>
                <p className="text-xs font-mono text-white mt-0.5 truncate">{String(v)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Trials table */}
      <div>
        <h2 className="text-sm font-semibold text-white mb-3">{t('Tous les trials')}</h2>
        {trialsLoading ? (
          <div className="flex items-center justify-center h-20 text-gray-500 text-sm">{t('Chargement…')}</div>
        ) : !trials || trials.length === 0 ? (
          <div className="text-center py-8 text-gray-500 text-sm">
            {t('Aucun trial — lancez une optimisation')}
          </div>
        ) : (
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800">
                    <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium uppercase">#</th>
                    <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium uppercase">{t('État')}</th>
                    <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium uppercase">{t('Résultat observé')}</th>
                    <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium uppercase">{t('Paramètres')}</th>
                    <th className="text-right px-4 py-2.5 text-xs text-gray-500 font-medium uppercase">{t('Durée')}</th>
                  </tr>
                </thead>
                <tbody>
                  {[...trials].reverse().map((t2, i) => (
                    <tr key={t2.number} className={i > 0 ? 'border-t border-gray-800/60' : ''}>
                      <td className="px-4 py-2.5 text-gray-400 font-mono text-xs">{t2.number}</td>
                      <td className="px-4 py-2.5"><TrialStateBadge state={t2.effective_state || t2.state} /></td>
                      <td className="px-4 py-2.5 text-xs">
                        {t2.value != null ? <p className="font-mono text-emerald-300">{t('objectif officiel =')} {Number(t2.value).toPrecision(5)}</p> : t2.recovery_status ? <div><p className="font-medium text-amber-300">{t('training récupéré · non officiel')}</p>{Object.entries(t2.metrics || {}).map(([k,v]) => <p className="font-mono text-gray-300" key={k}>{k} = {v == null ? '—' : Number(v).toPrecision(5)}</p>)}</div> : <span className="text-gray-600">{t('aucune métrique')}</span>}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-gray-400 font-mono">
                        {Object.entries(t2.params).slice(0, 4).map(([k, v]) => (
                          <span key={k} className="mr-3">{k}={String(v).slice(0, 8)}</span>
                        ))}
                        {diagnostics.some(d => d.trial === t2.number) && <p className="mt-1 font-sans text-[10px] text-red-400">{t('Cause regroupée dans le verdict de l’étude')}</p>}
                        {(t2.artifact_dir || Object.keys(t2.metrics || {}).length > 0) && <details className="mt-1 font-sans"><summary className="cursor-pointer text-cyan-400">{t('Résultats et artefacts')}</summary><div className="mt-1 max-w-xl rounded border border-cyan-900/40 bg-cyan-950/20 p-2 text-[11px] break-all">{t2.recovery_status && <p className="mb-1 text-amber-300">{t('Métriques récupérées depuis le CSV historique — informatives, état Optuna inchangé.')}</p>}<p>{t('Source métrique :')} {t2.metric_source || t('non enregistrée')}</p>{Object.entries(t2.metrics || {}).map(([k,v]) => <p key={k}>{k} = {v ?? '—'}</p>)}<p>{t2.artifact_dir || t('Aucun dossier')}</p></div></details>}
                      </td>
                      <td className="px-4 py-2.5 text-right text-xs text-gray-500">
                        {formatDuration(t2.duration_s)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
