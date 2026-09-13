// ============================================================
// StudiesPage.tsx — liste des études + modal création
// ============================================================

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Beaker, Plus, Trash2, ChevronRight, RefreshCw, X, TrendingUp, TrendingDown, AlertTriangle, CheckCircle2, LoaderCircle } from 'lucide-react'
import { useStudies } from '../hooks/useStudies'
import { studiesAPI } from '../api/client'
import type { StudySummary } from '../types/api'

function CreateModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('')
  const [direction, setDirection] = useState<'minimize' | 'maximize'>('minimize')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setLoading(true)
    try {
      await studiesAPI.create(name.trim(), direction)
      toast.success('Étude créée')
      onCreated()
      onClose()
    } catch {
      toast.error("Erreur lors de la création (nom déjà utilisé ?)")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-md p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-white font-semibold text-base">Nouvelle étude</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300">
            <X size={18} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Nom</label>
            <input
              autoFocus value={name} onChange={e => setName(e.target.value)}
              placeholder="mon-étude-hpo"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Direction</label>
            <div className="flex gap-3">
              {(['minimize', 'maximize'] as const).map(d => (
                <label key={d} className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" value={d} checked={direction === d}
                    onChange={() => setDirection(d)} className="accent-indigo-500" />
                  <span className="text-sm text-gray-300 flex items-center gap-1.5">
                    {d === 'minimize' ? <TrendingDown size={14} className="text-blue-400" /> : <TrendingUp size={14} className="text-emerald-400" />}
                    {d}
                  </span>
                </label>
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose}
              className="px-4 py-2 text-sm text-gray-400 hover:text-white rounded-lg hover:bg-gray-800 transition-colors">
              Annuler
            </button>
            <button type="submit" disabled={!name.trim() || loading}
              className="px-4 py-2 text-sm bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg transition-colors">
              {loading ? 'Création…' : 'Créer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function StudyState({ study }: { study: StudySummary }) {
  if (study.status === 'running') return <span className="inline-flex items-center gap-1 rounded border border-blue-800/50 bg-blue-950/30 px-2 py-1 text-xs font-semibold text-blue-300"><LoaderCircle size={12} className="animate-spin"/> En cours</span>
  if (study.status === 'finished') return <span className="inline-flex items-center gap-1 rounded border border-emerald-800/50 bg-emerald-950/30 px-2 py-1 text-xs font-semibold text-emerald-300"><CheckCircle2 size={12}/> Terminé</span>
  if (study.status === 'error') return <span className="inline-flex items-center gap-1 rounded border border-red-800/50 bg-red-950/30 px-2 py-1 text-xs font-semibold text-red-300"><AlertTriangle size={12}/> Échec HPO</span>
  return <span className="rounded border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-gray-400">Vide</span>
}

export default function StudiesPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { data: studies, isLoading, refetch } = useStudies()
  const [showCreate, setShowCreate] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)

  const handleDelete = async (s: StudySummary, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!window.confirm(`Supprimer l'étude "${s.study_name}" et tous ses trials ?`)) return
    setDeleting(s.study_name)
    try {
      await studiesAPI.delete(s.study_name)
      toast.success('Étude supprimée')
      qc.invalidateQueries({ queryKey: ['studies'] })
    } catch {
      toast.error('Erreur lors de la suppression')
    } finally {
      setDeleting(null)
    }
  }

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Beaker size={22} className="text-indigo-400" />
          <h1 className="text-xl font-semibold text-white">Études</h1>
          {studies && (
            <span className="text-xs bg-gray-800 text-gray-400 border border-gray-700 rounded-full px-2 py-0.5">
              {studies.length}
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
            <Plus size={16} /> Nouvelle étude
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-40 text-gray-500 text-sm">Chargement…</div>
      ) : !studies || studies.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-40 gap-2 text-gray-500">
          <Beaker size={32} className="text-gray-700" />
          <p className="text-sm">Aucune étude Optuna trouvée</p>
        </div>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800">
                <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium uppercase">Nom</th>
                <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium uppercase">Statut</th>
                <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium uppercase">Direction</th>
                <th className="text-right px-4 py-2.5 text-xs text-gray-500 font-medium uppercase">Trials C/F/P</th>
                <th className="text-right px-4 py-2.5 text-xs text-gray-500 font-medium uppercase">Meilleure val.</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {studies.map((s, i) => (
                <tr key={s.study_name}
                  onClick={() => navigate(`/studies/${encodeURIComponent(s.study_name)}`)}
                  className={`${i > 0 ? 'border-t border-gray-800/60' : ''} cursor-pointer hover:bg-gray-800/50 transition-colors`}>
                  <td className="px-4 py-3"><p className="font-medium text-gray-200">{s.study_name}</p>{(s.graph_id || s.run_id || s.metric) && <p className="mt-1 max-w-xs truncate font-mono text-[10px] text-gray-500" title={`graph=${s.graph_id || '—'} · run=${s.run_id || '—'} · metric=${s.metric || '—'}`}>{s.metric || 'objectif —'} · graph {s.graph_id || '—'} · run {s.run_id || '—'}</p>}</td>
                  <td className="px-4 py-3"><StudyState study={s}/></td>
                  <td className="px-4 py-3">
                    <span className={`flex items-center gap-1.5 text-xs ${
                      s.direction === 'MINIMIZE' ? 'text-blue-400' : 'text-emerald-400'
                    }`}>
                      {s.direction === 'MINIMIZE'
                        ? <TrendingDown size={13} />
                        : <TrendingUp size={13} />
                      }
                      {s.direction.toLowerCase()}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-xs"><span className="text-emerald-400">{s.counts.complete}</span><span className="text-gray-600"> / </span><span className="text-red-400">{s.counts.failed}</span><span className="text-gray-600"> / </span><span className="text-gray-400">{s.counts.pruned}</span></td>
                  <td className="px-4 py-3 text-right font-mono text-xs text-white">
                    {s.best_value != null ? Number(s.best_value).toPrecision(5) : '—'}
                  </td>
                  <td className="px-4 py-3 text-right flex items-center justify-end gap-2">
                    <button
                      onClick={e => handleDelete(s, e)}
                      disabled={deleting === s.study_name}
                      className="p-1.5 text-gray-600 hover:text-red-400 hover:bg-red-900/20 rounded-lg transition-colors disabled:opacity-50">
                      <Trash2 size={14} />
                    </button>
                    <ChevronRight size={14} className="text-gray-600" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <CreateModal
          onClose={() => setShowCreate(false)}
          onCreated={() => qc.invalidateQueries({ queryKey: ['studies'] })}
        />
      )}
    </div>
  )
}
