// ============================================================
// HistoryPage.tsx
// Historique git-style des commits touchant des fichiers DVC.
// ============================================================

import { useState } from 'react'
import { useCommits } from '../hooks/useCommits'
import { useNavigate } from 'react-router-dom'
import { GitCommit, RefreshCw, ChevronRight, Clock, Database, FlaskConical, TrendingUp, Info, RotateCcw, Loader2 } from 'lucide-react'
import { useQueryClient, useMutation } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { commitsAPI } from '../api/client'

function formatTs(ts: number): string {
  const d = new Date(ts * 1000)
  return d.toLocaleString('fr-FR', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function timeAgo(ts: number): string {
  const diff = Math.floor(Date.now() / 1000 - ts)
  if (diff < 60)       return `il y a ${diff}s`
  if (diff < 3600)     return `il y a ${Math.floor(diff / 60)}min`
  if (diff < 86400)    return `il y a ${Math.floor(diff / 3600)}h`
  if (diff < 2592000)  return `il y a ${Math.floor(diff / 86400)}j`
  return formatTs(ts)
}

export default function HistoryPage() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { data: commits, isLoading } = useCommits(50)
  const [expanded, setExpanded] = useState<string | null>(null)

  // Restauration d'une version = git checkout <rev> + dvc checkout, piloté depuis
  // l'UI (0 CLI). Ramène le working dir exactement à l'état de ce commit.
  const restoreMut = useMutation({
    mutationFn: (rev: string) => commitsAPI.checkout(rev),
    onSuccess: r => {
      toast.success(`Version ${r.rev?.slice(0, 8) ?? ''} restaurée`)
      qc.invalidateQueries({ queryKey: ['commits'] })
      qc.invalidateQueries({ queryKey: ['datasets'] })
    },
    onError: (e: Error) => toast.error(`Restauration échouée : ${e.message}`),
  })
  const restore = (rev: string, subject: string) => {
    if (confirm(`Restaurer cette version ?\n\n"${subject}"\n\nLe dossier de travail reviendra exactement à l'état de ce commit (dataset + modèle). Réversible en restaurant une version plus récente.`))
      restoreMut.mutate(rev)
  }

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <GitCommit size={22} className="text-indigo-400" />
          <h1 className="text-xl font-semibold text-white">Historique des versions</h1>
          {commits && (
            <span className="text-xs bg-gray-800 text-gray-400 border border-gray-700 rounded-full px-2 py-0.5">
              {commits.length}
            </span>
          )}
        </div>
        <button onClick={() => qc.invalidateQueries({ queryKey: ['commits'] })}
          className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors">
          <RefreshCw size={16} />
        </button>
      </div>

      {/* Traduction MLOps : ce que represente reellement cet historique */}
      <div className="flex items-start gap-2 bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2.5 text-[11px] text-gray-400 leading-relaxed">
        <Info size={13} className="text-indigo-400 mt-0.5 shrink-0" />
        <p>
          Chaque commit est <b className="text-gray-300">une version</b> de vos données/modèles.
          Le hash (ex. <span className="font-mono text-indigo-300">41ef68b3</span>) identifie
          la version du code + config. Un fichier <span className="font-mono">.dvc</span> modifié =
          nouvelle version du dataset ou du modèle qu'il pointe. Les puces
          <span className="text-emerald-300"> Dataset</span> /
          <span className="text-amber-300"> Run</span> /
          <span className="text-blue-300"> mAP</span> proviennent des trailers posés par l'Orchestrator.
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-40 text-gray-500 text-sm">Chargement…</div>
      ) : !commits || commits.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-40 gap-2 text-gray-500">
          <GitCommit size={32} className="text-gray-700" />
          <p className="text-sm">Aucun commit DVC trouvé</p>
        </div>
      ) : (
        <div className="relative">
          {/* Timeline line */}
          <div className="absolute left-[1.85rem] top-0 bottom-0 w-px bg-gray-800" />

          <div className="space-y-1">
            {commits.map(commit => (
              <div key={commit.hash} className="relative">
                {/* Dot */}
                <div className="absolute left-6 top-4 w-3.5 h-3.5 rounded-full border-2 border-indigo-500 bg-gray-950 z-10" />

                <div className="ml-14 bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                  <div
                    onClick={() => setExpanded(p => p === commit.hash ? null : commit.hash)}
                    className="flex items-start gap-3 px-4 py-3.5 cursor-pointer hover:bg-gray-800/40 transition-colors select-none">
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-sm font-medium truncate">{commit.subject}</p>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-xs font-mono text-indigo-400">{commit.short}</span>
                        <span className="text-xs text-gray-500">{commit.author}</span>
                        <span className="flex items-center gap-1 text-xs text-gray-500">
                          <Clock size={11} />
                          {timeAgo(commit.timestamp)}
                        </span>
                      </div>
                      {/* Lineage MLOps (trailers) */}
                      {commit.lineage && (commit.lineage.dataset || commit.lineage.run_id || commit.lineage.map50) && (
                        <div className="flex flex-wrap items-center gap-1.5 mt-2">
                          {commit.lineage.dataset && (
                            <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-emerald-900/30 border border-emerald-700/30 text-emerald-300">
                              <Database size={10} />{commit.lineage.dataset}
                            </span>
                          )}
                          {commit.lineage.run_id && (
                            <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-amber-900/30 border border-amber-700/30 text-amber-300 font-mono">
                              Run {commit.lineage.run_id}
                            </span>
                          )}
                          {commit.lineage.map50 && (
                            <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-blue-900/30 border border-blue-700/30 text-blue-300">
                              <TrendingUp size={10} />mAP50 {commit.lineage.map50}
                            </span>
                          )}
                          {(commit.lineage.mlflow_runs?.length ?? 0) > 0 && (
                            <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-purple-900/30 border border-purple-700/30 text-purple-300 font-mono">
                              <FlaskConical size={10} />{commit.lineage.mlflow_runs!.length} run MLflow
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {commit.dvc_files.length > 0 && (
                        <span className="text-xs text-indigo-300 bg-indigo-900/30 border border-indigo-700/30 px-2 py-0.5 rounded">
                          {commit.dvc_files.length} fichier(s) DVC
                        </span>
                      )}
                      <button
                        onClick={e => {
                          e.stopPropagation()
                          navigate(`/diff?rev_a=${commit.hash}~1&rev_b=${commit.hash}`)
                        }}
                        className="text-xs text-gray-500 hover:text-indigo-400 px-2 py-1 rounded hover:bg-indigo-900/20 transition-colors">
                        Diff
                      </button>
                      <button
                        onClick={e => { e.stopPropagation(); restore(commit.hash, commit.subject) }}
                        disabled={restoreMut.isPending}
                        title="Restaurer cette version (checkout) — ramène le dossier de travail à cet état, sans ligne de commande"
                        className="flex items-center gap-1 text-xs text-gray-500 hover:text-emerald-400 px-2 py-1 rounded hover:bg-emerald-900/20 transition-colors disabled:opacity-50">
                        {restoreMut.isPending && restoreMut.variables === commit.hash
                          ? <Loader2 size={11} className="animate-spin" />
                          : <RotateCcw size={11} />}
                        Restaurer
                      </button>
                      <ChevronRight size={14} className={`text-gray-600 transition-transform ${
                        expanded === commit.hash ? 'rotate-90' : ''
                      }`} />
                    </div>
                  </div>

                  {/* DVC files list */}
                  {expanded === commit.hash && commit.dvc_files.length > 0 && (
                    <div className="border-t border-gray-800 px-4 py-3 bg-gray-950/50">
                      <p className="text-xs text-gray-500 mb-2">
                        Fichiers DVC modifiés (chacun = une nouvelle version du dataset/modèle pointé) :
                      </p>
                      <ul className="space-y-1">
                        {commit.dvc_files.map(f => (
                          <li key={f} className="text-xs font-mono text-gray-300 flex items-center gap-2">
                            <span className="text-emerald-500">+</span>{f}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
