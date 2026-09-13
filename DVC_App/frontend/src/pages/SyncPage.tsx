// ============================================================
// SyncPage.tsx
// Push/pull DVC avec log SSE en temps réel.
// ============================================================

import { useCallback, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Upload, Download, Square, Terminal, CheckCircle, XCircle, AlertTriangle, Server, ArrowRight, HardDrive, Link2, Loader2 } from 'lucide-react'
import { startSync, repoAPI } from '../api/client'
import { useInvalidateDatasets } from '../hooks/useDatasets'
import type { SyncEvent } from '../types/api'

const _fmtMB = (b?: number) => b == null ? '—' : `${(b / 1e6).toFixed(0)} Mo`

type SyncState = 'idle' | 'running' | 'done' | 'error'

interface LogLine {
  text:  string
  type:  'info' | 'success' | 'error'
}

// Module-level — survit à la navigation React
const _cancelFns = new Map<string, () => void>()

export default function SyncPage() {
  const invalidate = useInvalidateDatasets()
  const { data: remoteInfo } = useQuery({
    queryKey: ['remotes'],
    queryFn: repoAPI.remotes,
    refetchInterval: 30_000,
    staleTime: 15_000,
  })
  const remotes = remoteInfo?.remotes ?? []
  const remote = remotes.find(r => r.default) ?? remotes[0]
  const hasRemote = remotes.length > 0

  // Usage disque : à la demande (peut être lent sur gros datasets).
  const [showDisk, setShowDisk] = useState(false)
  const { data: disk, isFetching: diskLoading, refetch: refetchDisk } = useQuery({
    queryKey: ['disk-usage'],
    queryFn: repoAPI.diskUsage,
    enabled: showDisk,
    staleTime: 60_000,
  })
  const relinkMut = useMutation({
    mutationFn: repoAPI.relink,
    onSuccess: r => {
      if (r.ok) { toast.success('Working dir re-lié au cache'); refetchDisk() }
      else toast.error(r.error ?? 'Relink échoué')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  // Ajout d'un remote depuis l'UI (0 CLI) : chemin de dossier = remote local.
  const qc = useQueryClient()
  const [remoteName, setRemoteName] = useState('storage')
  const [remoteUrl, setRemoteUrl] = useState('')
  const addRemoteMut = useMutation({
    mutationFn: () => repoAPI.addRemote(remoteName.trim(), remoteUrl.trim()),
    onSuccess: r => {
      if (r.ok) { toast.success(`Remote « ${r.name} » ajouté`); setRemoteUrl(''); qc.invalidateQueries({ queryKey: ['remotes'] }) }
      else toast.error(r.error ?? 'Ajout du remote échoué')
    },
    onError: (e: Error) => toast.error(e.message),
  })
  const [pushState, setPushState] = useState<SyncState>('idle')
  const [pullState, setPullState] = useState<SyncState>('idle')
  const [pushLogs,  setPushLogs]  = useState<LogLine[]>([])
  const [pullLogs,  setPullLogs]  = useState<LogLine[]>([])
  const pushEndRef = useRef<HTMLDivElement>(null)
  const pullEndRef = useRef<HTMLDivElement>(null)

  const handleAction = useCallback((action: 'push' | 'pull') => {
    const setLogs  = action === 'push' ? setPushLogs  : setPullLogs
    const setState = action === 'push' ? setPushState : setPullState
    const endRef   = action === 'push' ? pushEndRef   : pullEndRef

    setLogs([])
    setState('running')

    const cancel = startSync(
      action,
      (evt: SyncEvent) => {
        if (evt.type === 'start') {
          setLogs(p => [...p, { text: `$ ${evt.cmd}`, type: 'info' }])
        } else if (evt.type === 'log' && evt.line) {
          setLogs(p => [...p, { text: evt.line!, type: 'info' }])
          setTimeout(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
        } else if (evt.type === 'error') {
          setLogs(p => [...p, { text: `Erreur: ${evt.message}`, type: 'error' }])
          setState('error')
        } else if (evt.type === 'done') {
          setLogs(p => [...p, { text: `Terminé (code ${evt.returncode})`, type: evt.returncode === 0 ? 'success' : 'error' }])
          setState(evt.returncode === 0 ? 'done' : 'error')
          if (evt.returncode === 0) {
            toast.success(`DVC ${action} terminé`)
            invalidate()
          } else {
            toast.error(`DVC ${action} échoué`)
          }
        }
      },
      () => {
        _cancelFns.delete(action)
        setState(s => s === 'running' ? 'done' : s)
      },
    )
    _cancelFns.set(action, cancel)
  }, [invalidate])

  const handleCancel = (action: 'push' | 'pull') => {
    const cancel = _cancelFns.get(action)
    if (cancel) {
      cancel()
      _cancelFns.delete(action)
    }
    const setState = action === 'push' ? setPushState : setPullState
    setState('idle')
  }

  function ActionCard({
    action, state, logs, endRef,
  }: {
    action: 'push' | 'pull'
    state:  SyncState
    logs:   LogLine[]
    endRef: React.MutableRefObject<HTMLDivElement | null>
  }) {
    const isPush = action === 'push'
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-4 border-b border-gray-800">
          <div className="flex items-center gap-3">
            {isPush
              ? <Upload size={20} className="text-blue-400" />
              : <Download size={20} className="text-emerald-400" />
            }
            <div>
              <h2 className="text-white font-semibold text-sm">
                {isPush ? 'DVC Push' : 'DVC Pull'}
              </h2>
              <p className="text-xs text-gray-500 mt-0.5">
                {isPush
                  ? 'Envoyer les fichiers trackés vers le remote'
                  : 'Récupérer les fichiers trackés depuis le remote'
                }
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {state === 'done'  && <CheckCircle size={16} className="text-emerald-400" />}
            {state === 'error' && <XCircle     size={16} className="text-red-400" />}
            {state === 'running' ? (
              <button
                onClick={() => handleCancel(action)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-red-900/40 hover:bg-red-900/70 text-red-400 text-sm rounded-lg border border-red-700/40 transition-colors">
                <Square size={12} /> Annuler
              </button>
            ) : (
              <button
                onClick={() => handleAction(action)}
                className={`flex items-center gap-2 px-4 py-2 text-white text-sm rounded-lg transition-colors ${
                  isPush
                    ? 'bg-blue-600 hover:bg-blue-500'
                    : 'bg-emerald-700 hover:bg-emerald-600'
                }`}>
                {isPush ? <Upload size={14} /> : <Download size={14} />}
                {isPush ? 'Push' : 'Pull'}
              </button>
            )}
          </div>
        </div>

        {/* Log terminal */}
        {logs.length > 0 && (
          <div className="bg-gray-950 font-mono text-xs p-4 max-h-56 overflow-y-auto scrollbar-thin">
            <div className="flex items-center gap-2 text-gray-600 mb-3">
              <Terminal size={11} />
              <span>Output</span>
            </div>
            {logs.map((line, i) => (
              <div key={i} className={`leading-relaxed ${
                line.type === 'error'   ? 'text-red-400' :
                line.type === 'success' ? 'text-emerald-400' :
                'text-gray-300'
              }`}>
                {line.text}
              </div>
            ))}
            <div ref={node => { endRef.current = node }} />
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center gap-3">
        <Terminal size={22} className="text-indigo-400" />
        <h1 className="text-xl font-semibold text-white">Synchronisation</h1>
      </div>

      {/* Explication : ce que Push / Pull / Sync font vraiment */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-2 text-[12px] text-gray-400 leading-relaxed">
        <p>
          <b className="text-blue-300">Push</b> = j'envoie les données versionnées (contenu réel
          pointé par les <span className="font-mono">.dvc</span>) vers le remote, pour qu'elles
          soient récupérables ailleurs. <b className="text-emerald-300">Pull</b> = je récupère
          depuis le remote le contenu des versions suivies par le repo.
        </p>
        <p>
          « <b className="text-gray-200">Sync</b> » ici = cette page (Push et Pull DVC) — pas
          d'abstraction cachée : rien n'est envoyé ni récupéré sans que vous cliquiez.
        </p>
        {/* Source -> destination reelle */}
        {hasRemote ? (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Server size={13} className="text-gray-500" />
            <span className="text-gray-300">Remote :</span>
            <span className="font-mono text-indigo-300">{remote?.name}</span>
            {remote?.url && (
              <span className="flex items-center gap-1 text-gray-500 font-mono text-[11px]">
                <ArrowRight size={11} /> {remote.url}
              </span>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-start gap-2 bg-amber-900/20 border border-amber-700/30 rounded-lg px-3 py-2 text-amber-300">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>Aucun remote DVC configuré : Push/Pull n'ont aucune destination. Ajoutez-en un ci-dessous (0 CLI).</span>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-[11px] text-gray-400">
                Nom
                <input value={remoteName} onChange={e => setRemoteName(e.target.value)}
                  className="block mt-0.5 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-sm text-white w-28" />
              </label>
              <label className="text-[11px] text-gray-400 flex-1 min-w-[220px]">
                Destination (dossier local ou url s3://, ssh://…)
                <input value={remoteUrl} onChange={e => setRemoteUrl(e.target.value)}
                  placeholder="ex. D:\dvc_remote  ou  s3://bucket/path"
                  className="block mt-0.5 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-sm text-white w-full font-mono" />
              </label>
              <button onClick={() => addRemoteMut.mutate()} disabled={!remoteUrl.trim() || addRemoteMut.isPending}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg disabled:opacity-50">
                {addRemoteMut.isPending ? <Loader2 size={13} className="animate-spin" /> : <Server size={13} />}
                Ajouter le remote
              </button>
            </div>
          </div>
        )}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ActionCard action="push" state={pushState} logs={pushLogs} endRef={pushEndRef} />
        <ActionCard action="pull" state={pullState} logs={pullLogs} endRef={pullEndRef} />
      </div>

      {/* Usage disque + dé-duplication par liens */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-2">
          <HardDrive size={16} className="text-indigo-400" />
          <h2 className="text-sm font-semibold text-white">Stockage (dé-duplication)</h2>
          {!showDisk && (
            <button onClick={() => setShowDisk(true)}
              className="ml-auto text-xs px-2.5 py-1 rounded-lg border border-gray-700 text-gray-300 hover:bg-gray-800">
              Calculer l'usage disque
            </button>
          )}
          {showDisk && (
            <button onClick={() => refetchDisk()} disabled={diskLoading}
              className="ml-auto text-xs px-2.5 py-1 rounded-lg border border-gray-700 text-gray-300 hover:bg-gray-800">
              {diskLoading ? <Loader2 size={12} className="animate-spin inline" /> : 'Recalculer'}
            </button>
          )}
        </div>
        <p className="text-[11px] text-gray-500 leading-relaxed">
          Le cache DVC stocke chaque fichier une fois (par empreinte md5) : deux versions qui
          partagent des images ne les stockent qu'une fois. Avec le cache <b className="text-gray-300">en
          liens</b> (hardlink/reflink), le working dir ne fait que pointer vers le cache — pas de
          2e copie physique.
        </p>
        {showDisk && (
          diskLoading && !disk ? (
            <div className="text-xs text-gray-500 flex items-center gap-2"><Loader2 size={13} className="animate-spin" /> Calcul…</div>
          ) : disk?.repo_exists ? (
            <div className="space-y-2">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="bg-gray-950 border border-gray-800 rounded-lg p-2.5">
                  <p className="text-[10px] text-gray-500 uppercase">Cache</p>
                  <p className="text-sm font-mono text-gray-100 mt-0.5">{_fmtMB(disk.cache_bytes)}</p>
                </div>
                <div className="bg-gray-950 border border-gray-800 rounded-lg p-2.5">
                  <p className="text-[10px] text-gray-500 uppercase">Working dir</p>
                  <p className="text-sm font-mono text-gray-100 mt-0.5">{_fmtMB(disk.working_bytes)}</p>
                </div>
                <div className="bg-gray-950 border border-gray-800 rounded-lg p-2.5">
                  <p className="text-[10px] text-gray-500 uppercase">Type cache</p>
                  <p className={`text-sm font-mono mt-0.5 ${disk.linked ? 'text-emerald-300' : 'text-amber-300'}`}>
                    {disk.linked ? 'liens' : 'copy'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-gray-500">
                  {disk.cache_type}
                  {disk.linked
                    ? ' — working dir partagé avec le cache (pas de doublon)'
                    : ' — le working dir est une 2e copie ; relie-le au cache :'}
                </span>
                {!disk.linked && (
                  <button onClick={() => relinkMut.mutate()} disabled={relinkMut.isPending}
                    className="ml-auto flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border border-indigo-700/50 text-indigo-300 hover:bg-indigo-900/20 disabled:opacity-50">
                    {relinkMut.isPending ? <Loader2 size={12} className="animate-spin" /> : <Link2 size={12} />}
                    Re-lier au cache
                  </button>
                )}
              </div>
            </div>
          ) : (
            <p className="text-xs text-gray-500">Repo DVC introuvable — rien à mesurer.</p>
          )
        )}
      </div>
    </div>
  )
}
