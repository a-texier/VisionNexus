// ============================================================
// AppsPage.tsx — Lancement et statut des sous-apps CV
// ============================================================

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { launcherAPI, healthAPI } from '../api/client'
import {
  Eye, Tag, GitBranch, TrendingUp, Settings2, Zap,
  Crosshair, Play, Square, ExternalLink, Rocket, Loader2, CheckCircle2, XCircle,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { useT } from '../i18n/useLang'

const APP_META: Record<string, { icon: React.ReactNode; color: string; desc: string }> = {
  annotation: {
    icon: <Tag size={18} />,
    color: 'text-rose-400',
    desc: 'Annotation d\'images avec SAM2, Grounding DINO, ByteTrack. Export YOLO.',
  },
  explorer: {
    icon: <Eye size={18} />,
    color: 'text-violet-400',
    desc: 'Exploration de datasets, embedding CLIP, subsets sémantiques, carte UMAP.',
  },
  training: {
    icon: <Zap size={18} />,
    color: 'text-blue-400',
    desc: 'Entraînement YOLO (v8/v9/v10/11), suivi SSE temps réel, métriques mAP50/95.',
  },
  inference: {
    icon: <Crosshair size={18} />,
    color: 'text-sky-400',
    desc: 'Inférence fichier, suivi multi-objet, SOT par clic et évaluation des modèles.',
  },
  dvc: {
    icon: <GitBranch size={18} />,
    color: 'text-amber-400',
    desc: 'Versionnage de datasets avec DVC + Git. Historique des commits.',
  },
  mlflow: {
    icon: <TrendingUp size={18} />,
    color: 'text-emerald-400',
    desc: 'Tracking des expériences d\'entraînement, métriques, artefacts.',
  },
  optuna: {
    icon: <Settings2 size={18} />,
    color: 'text-cyan-400',
    desc: 'Optimisation bayésienne des hyperparamètres avec Optuna.',
  },
}

interface LaunchModalProps {
  appId: string
  onLaunch: (opts: { base_workspace?: string; user?: string; conda_env?: string }) => void
  onClose: () => void
  isPending: boolean
}

function LaunchModal({ appId, onLaunch, onClose, isPending }: LaunchModalProps) {
  const t = useT()
  const [ws, setWs] = useState('')
  const [user, setUser] = useState('')
  const [env, setEnv] = useState('IA_env')

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-96 shadow-2xl" onClick={e => e.stopPropagation()}>
        <h3 className="text-white font-semibold mb-4">{t('Lancer')} {appId}</h3>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-gray-400 block mb-1">{t('Workspace de base')}</label>
            <input value={ws} onChange={e => setWs(e.target.value)} placeholder={t("Laissez vide = auto (à côté de l'orchestrateur)")}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500" />
          </div>
          <div>
            <label className="text-xs text-gray-400 block mb-1">{t('Utilisateur')}</label>
            <input value={user} onChange={e => setUser(e.target.value)} placeholder={t('Laissez vide = user courant')}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500" />
          </div>
          <div>
            <label className="text-xs text-gray-400 block mb-1">{t('Env conda')}</label>
            <input value={env} onChange={e => setEnv(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500" />
          </div>
        </div>
        <div className="flex gap-3 mt-5">
          <button onClick={onClose} className="flex-1 px-4 py-2 border border-gray-700 rounded-lg text-sm text-gray-400 hover:text-white transition-colors">
            {t('Annuler')}
          </button>
          <button
            onClick={() => onLaunch({ base_workspace: ws || undefined, user: user || undefined, conda_env: env })}
            disabled={isPending}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {isPending ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            {t('Lancer')}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function AppsPage() {
  const t = useT()
  const qc = useQueryClient()
  const [launchingApp, setLaunchingApp] = useState<string | null>(null)

  const { data: health = {} } = useQuery({
    queryKey: ['health'],
    queryFn: healthAPI.get,
    refetchInterval: 5000,
  })

  const { data: sessions = {} } = useQuery({
    queryKey: ['launcher-sessions'],
    queryFn: launcherAPI.list,
    refetchInterval: 3000,
  })

  const launchMut = useMutation({
    mutationFn: ({ app_id, ...opts }: { app_id: string; base_workspace?: string; user?: string; conda_env?: string }) =>
      launcherAPI.launch(app_id, opts),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['launcher-sessions'] })
      toast.success(t('Application lancée'))
      setLaunchingApp(null)
      if (data.frontend_url) setTimeout(() => window.open(data.frontend_url, '_blank'), 2000)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const stopMut = useMutation({
    mutationFn: (app_id: string) => launcherAPI.stop(app_id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['launcher-sessions'] }); toast(t('Application arrêtée')) },
    onError: (e: Error) => toast.error(e.message),
  })

  const launchAllMut = useMutation({
    mutationFn: () => launcherAPI.launchAll(),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['launcher-sessions'] })
      const n = data.launched.length
      if (n > 0) toast.success(`${n} ${t('app(s) lancée(s)')}`)
      else toast(t('Toutes les apps sont déjà actives'))
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const stopAllMut = useMutation({
    mutationFn: () => launcherAPI.stopAll(),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['launcher-sessions'] })
      toast(`${data.stopped.length} ${t('app(s) arrêtée(s)')}`)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  // Map health keys to app_ids
  const healthByAppId: Record<string, { status: string; latency_ms: number | null }> = {
    annotation: health['Annotation_App'] ?? { status: 'down', latency_ms: null },
    explorer:       health['Dataset_Explorer_App']   ?? { status: 'down', latency_ms: null },
    training:   health['Training_App']   ?? { status: 'down', latency_ms: null },
    inference:  health['Inference_App']  ?? { status: 'down', latency_ms: null },
    dvc:        health['dvc-app']        ?? { status: 'down', latency_ms: null },
    mlflow:     health['mlflow-app']     ?? { status: 'down', latency_ms: null },
    optuna:     health['optuna-app']     ?? { status: 'down', latency_ms: null },
  }

  return (
    <div className="p-6 overflow-y-auto h-full space-y-6">
      <div className="flex items-center gap-3">
        <Rocket size={20} className="text-indigo-400" />
        <h1 className="text-xl font-semibold text-white">Applications</h1>
        <div className="flex-1" />
        <button
          onClick={() => stopAllMut.mutate()}
          disabled={stopAllMut.isPending}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-red-400 border border-red-800/50 hover:bg-red-900/20 rounded-lg transition-colors disabled:opacity-50"
        >
          {stopAllMut.isPending ? <Loader2 size={12} className="animate-spin" /> : <Square size={12} />}
          Kill All
        </button>
        <button
          onClick={() => launchAllMut.mutate()}
          disabled={launchAllMut.isPending}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-emerald-400 border border-emerald-800/50 hover:bg-emerald-900/20 rounded-lg transition-colors disabled:opacity-50"
        >
          {launchAllMut.isPending ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
          Launch All
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {Object.entries(APP_META).map(([appId, meta]) => {
          const h = healthByAppId[appId]
          const session = sessions[appId]
          const isOnline = h?.status === 'ok'
          const isFailed = session?.status === 'error'
          const isStarting = session?.status === 'starting'
          const isLaunched = session?.launched && !['stopped', 'error', 'failed'].includes(session?.status)

          return (
            <div key={appId} className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
              {/* Header */}
              <div className="flex items-start gap-3">
                <div className={`p-2 rounded-lg bg-gray-800 ${meta.color}`}>{meta.icon}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-white">{appId}</h3>
                    {isOnline ? (
                      <span className="flex items-center gap-1 text-[10px] text-emerald-400">
                        <CheckCircle2 size={10} />{h.latency_ms}ms
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-[10px] text-gray-600">
                        <XCircle size={10} />offline
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-gray-500 mt-0.5 leading-relaxed">{t(meta.desc)}</p>
                </div>
              </div>

              {/* Workspace info if running */}
              {isLaunched && session.workspace && (
                <p className="text-[10px] text-gray-600 truncate">
                  ws: {session.workspace}
                </p>
              )}
              {isStarting && (
                <p className="flex items-center gap-1 text-[10px] text-amber-300">
                  <Loader2 size={10} className="animate-spin" /> {t('Démarrage en cours…')}
                </p>
              )}
              {isFailed && (
                <div className="rounded-lg border border-red-900/70 bg-red-950/30 p-2 text-[10px] text-red-300">
                  <p className="font-semibold">{t('Échec du démarrage')}</p>
                  <p className="mt-1 whitespace-pre-wrap break-words text-red-300/80">
                    {session.failure_reason || t('Le backend ne répond pas. Consultez le journal de lancement.')}
                  </p>
                  {session.backend_log && <p className="mt-1 break-all font-mono text-gray-500">{session.backend_log}</p>}
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center gap-2">
                {isOnline && session?.frontend_url && (
                  <a
                    href={session.frontend_url}
                    target="_blank"
                    rel="noreferrer"
                    className={`flex items-center gap-1 text-xs ${meta.color} hover:opacity-80`}
                  >
                    <ExternalLink size={11} />
                    {t('Ouvrir')}
                  </a>
                )}
                <div className="flex-1" />
                {isLaunched ? (
                  <button
                    onClick={() => stopMut.mutate(appId)}
                    disabled={stopMut.isPending}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-red-400 border border-red-800/50 hover:bg-red-900/20 rounded-lg transition-colors"
                  >
                    <Square size={11} />
                    {t('Arrêter')}
                  </button>
                ) : (
                  <button
                    onClick={() => setLaunchingApp(appId)}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-indigo-400 border border-indigo-700/50 hover:bg-indigo-900/20 rounded-lg transition-colors"
                  >
                    <Play size={11} />
                    {t('Lancer')}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
        <p className="text-xs text-gray-500">
          <span className="text-gray-400 font-medium">{t('Mode indépendant')}</span> — {t('vous pouvez aussi lancer chaque app manuellement depuis son launcher :')}
          <code className="ml-1 text-gray-400 bg-gray-800 px-1 rounded">
            python launcher.py --app explorer --workspace D:/ws --user alice
          </code>
        </p>
      </div>

      {launchingApp && (
        <LaunchModal
          appId={launchingApp}
          onLaunch={opts => launchMut.mutate({ app_id: launchingApp, ...opts })}
          onClose={() => setLaunchingApp(null)}
          isPending={launchMut.isPending}
        />
      )}
    </div>
  )
}
