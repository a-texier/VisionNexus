// ============================================================
// components/SubsetDuplicatesModal.tsx
// Modal : doublons locaux d'un subset.
// Ajouts : champ numérique pour seuil, bouton "Appliquer au subset"
//          (supprime les images rejetées du subset).
// ============================================================

import { useState } from 'react'
import toast from 'react-hot-toast'
import { X, GitMerge, CheckCircle, XCircle, RefreshCw, Zap, ZoomIn, ShieldCheck, Filter, AlertTriangle } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { subsetsAPI, datasetsAPI } from '../api/client'
import ImageModal from './ImageModal'
import type { DuplicateGroup, DuplicateImageInfo, SubsetSummary } from '../types/api'

interface Props {
  subset: SubsetSummary
  onClose: () => void
  onApplied?: () => void  // appelé après application du filtre
}

export default function SubsetDuplicatesModal({ subset, onClose, onApplied }: Props) {
  const [threshold, setThreshold] = useState(0.97)
  const [pendingThreshold, setPendingThreshold] = useState(0.97)
  const [decisions, setDecisions] = useState<Record<number, boolean>>({})
  const [keepN, setKeepN] = useState<Record<number, number>>({})
  const [saving, setSaving] = useState(false)
  const [applying, setApplying] = useState(false)
  const [modalImg, setModalImg] = useState<{ url: string; filename: string } | null>(null)

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['subset-duplicates', subset.id, threshold],
    queryFn: () => subsetsAPI.getDuplicates(subset.id, threshold),
  })

  const getKeepN = (groupId: number, groupSize: number) => {
    const v = keepN[groupId]
    return v !== undefined ? v : Math.min(1, groupSize)
  }

  const autoSelectGroup = (group: DuplicateGroup, n: number) => {
    const sorted = [...group.images].sort((a, b) => b.similarity_to_representative - a.similarity_to_representative)
    const updates: Record<number, boolean> = {}
    sorted.forEach((img, idx) => { updates[img.image_id] = idx < n })
    setDecisions(prev => ({ ...prev, ...updates }))
    toast(`Groupe #${group.group_id} : ${n} gardée(s), ${sorted.length - n} rejetée(s)`, { duration: 2000 })
  }

  const resetGroup = (group: DuplicateGroup) => {
    setDecisions(prev => {
      const updated = { ...prev }
      group.images.forEach(img => delete updated[img.image_id])
      return updated
    })
  }

  const handleAutoAll = () => {
    if (!data?.groups) return
    const updates: Record<number, boolean> = {}
    data.groups.forEach(group => {
      const n = getKeepN(group.group_id, group.images.length)
      const sorted = [...group.images].sort((a, b) => b.similarity_to_representative - a.similarity_to_representative)
      sorted.forEach((img, idx) => { updates[img.image_id] = idx < n })
    })
    setDecisions(prev => ({ ...prev, ...updates }))
    toast.success(`Auto-sélection appliquée sur ${data.groups.length} groupe(s)`)
  }

  const handleResetAll = () => {
    setDecisions({})
    setKeepN({})
    toast.success('Toutes les décisions réinitialisées')
  }

  const handleSave = async () => {
    if (Object.keys(decisions).length === 0) return
    setSaving(true)
    try {
      const dec = Object.entries(decisions).map(([imgId, keep]) => ({
        image_id: Number(imgId),
        keep,
      }))
      await datasetsAPI.patchDuplicateDecision(subset.dataset_id, dec)
      toast.success('Décisions sauvegardées')
      setDecisions({})
      refetch()
    } catch {
      toast.error('Erreur sauvegarde')
    } finally {
      setSaving(false)
    }
  }

  const handleApplyFilter = async () => {
    // Sauvegarder les décisions en attente si nécessaire
    if (Object.keys(decisions).length > 0) {
      await handleSave()
    }
    setApplying(true)
    try {
      const res = await subsetsAPI.applyDuplicateFilter(subset.id)
      toast.success(`Filtre appliqué : ${res.removed} image(s) retirée(s) du subset`)
      onApplied?.()
      onClose()
    } catch {
      toast.error('Erreur lors de l\'application du filtre')
    } finally {
      setApplying(false)
    }
  }

  const handleThresholdInput = (val: string) => {
    const n = Number(val)
    if (!isNaN(n) && n >= 80 && n <= 100) {
      setPendingThreshold(n / 100)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-5xl max-h-[90vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700 flex-shrink-0">
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <GitMerge size={18} /> Doublons — {subset.name}
            </h2>
            <p className="text-gray-500 text-xs mt-0.5">
              Analyse locale au subset ({subset.image_count} images) · ne modifie pas les autres subsets
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 text-gray-500 hover:text-white">
            <X size={20} />
          </button>
        </div>

        {/* Contenu scrollable */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Avertissement IMPORTANT : Sauvegarder touche le dataset principal */}
          <div className="flex items-start gap-2 bg-orange-900/30 rounded-lg p-3 border border-orange-600/40">
            <AlertTriangle size={14} className="text-orange-400 flex-shrink-0 mt-0.5" />
            <div className="text-xs text-orange-200 space-y-0.5">
              <p><strong className="text-orange-300">ATTENTION — Sauvegarder</strong> écrit les décisions doublon dans le <strong className="text-orange-300">dataset principal</strong> (flag <code className="text-orange-400">is_duplicate_kept</code>). Les images rejetées seront exclues de la carte UMAP et du rebuild dans le <strong>Playground</strong>.</p>
              <p className="text-orange-400/80"><strong>Appliquer au subset</strong> = retire les images uniquement de <em>ce</em> subset, sans toucher le dataset.</p>
            </div>
          </div>

          {/* Rappel sémantique */}
          <div className="flex items-start gap-2 bg-gray-800 rounded-lg p-3 border border-gray-700">
            <ShieldCheck size={14} className="text-green-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-gray-400">
              <strong className="text-green-400">Garder</strong> = inclus dans les exports ·
              <strong className="text-red-400 ml-1">Rejeter</strong> = exclu des exports ·
              <strong className="text-gray-300 ml-1">Aucune suppression physique</strong>.
            </p>
          </div>

          {/* Contrôles */}
          <div className="flex flex-wrap items-center gap-3 bg-gray-800 rounded-xl p-3 border border-gray-700">
            {/* Seuil slider + numérique */}
            <div className="flex items-center gap-2">
              <label className="text-gray-400 text-sm whitespace-nowrap">Seuil :</label>
              <input
                type="range" min={80} max={100} step={1}
                value={Math.round(pendingThreshold * 100)}
                onChange={e => setPendingThreshold(Number(e.target.value) / 100)}
                className="w-24 accent-indigo-500"
              />
              <input
                type="number" min={80} max={100} step={1}
                value={Math.round(pendingThreshold * 100)}
                onChange={e => handleThresholdInput(e.target.value)}
                className="w-14 bg-gray-900 border border-gray-600 rounded px-2 py-0.5 text-xs text-gray-200 text-center focus:ring-1 focus:ring-indigo-500"
              />
              <span className="text-gray-500 text-xs">%</span>
              <button
                onClick={() => setThreshold(pendingThreshold)}
                className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-500 text-white text-xs rounded-lg"
              >
                Appliquer
              </button>
            </div>

            {data && data.group_count > 0 && (
              <button
                onClick={handleAutoAll}
                className="flex items-center gap-1.5 px-3 py-1 bg-amber-600/20 text-amber-300 border border-amber-600/40 text-xs rounded-lg hover:bg-amber-600/30 transition-colors"
              >
                <Zap size={13} /> Auto-sélectionner tous
              </button>
            )}

            {(Object.keys(decisions).length > 0 || Object.keys(keepN).length > 0) && (
              <button
                onClick={handleResetAll}
                className="flex items-center gap-1.5 px-3 py-1 bg-gray-700 text-gray-400 text-xs rounded-lg hover:bg-gray-600 transition-colors"
              >
                <RefreshCw size={12} /> Reset tout
              </button>
            )}

            <div className="ml-auto flex items-center gap-2">
              {Object.keys(decisions).length > 0 && (
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex items-center gap-1.5 px-3 py-1 bg-green-600 hover:bg-green-500 text-white text-xs rounded-lg disabled:opacity-50"
                >
                  {saving ? 'Sauvegarde...' : `Sauvegarder (${Object.keys(decisions).length})`}
                </button>
              )}
              {/* Bouton appliquer — retire les images rejetées du subset */}
              <button
                onClick={handleApplyFilter}
                disabled={applying}
                className="flex items-center gap-1.5 px-3 py-1 bg-orange-600/20 text-orange-300 border border-orange-600/40 text-xs rounded-lg hover:bg-orange-600/30 transition-colors disabled:opacity-50"
                title="Retire définitivement les images 'Rejeter' de ce subset"
              >
                <Filter size={12} /> {applying ? 'Application...' : 'Appliquer au subset'}
              </button>
            </div>
          </div>

          {/* Stats */}
          {data && (
            <p className="text-gray-400 text-sm">
              <span className="text-white font-medium">{data.group_count}</span> groupe(s) ·{' '}
              <span className="text-white font-medium">{data.duplicate_count}</span> image(s) concernées
            </p>
          )}

          {isLoading && <p className="text-gray-500">Analyse des embeddings en cours...</p>}

          {!isLoading && data?.group_count === 0 && (
            <div className="text-center py-12 text-gray-500">
              <GitMerge size={40} className="mx-auto mb-3 opacity-30" />
              <p>Aucun doublon dans ce subset avec ce seuil.</p>
            </div>
          )}

          <div className="space-y-5">
            {data?.groups.map(group => (
              <SubsetGroupCard
                key={group.group_id}
                group={group}
                decisions={decisions}
                keepN={getKeepN(group.group_id, group.images.length)}
                onKeepNChange={n => setKeepN(prev => ({ ...prev, [group.group_id]: n }))}
                onDecision={(id, keep) => setDecisions(prev => ({ ...prev, [id]: keep }))}
                onAuto={() => autoSelectGroup(group, getKeepN(group.group_id, group.images.length))}
                onReset={() => resetGroup(group)}
                onZoom={(url, filename) => setModalImg({ url, filename })}
              />
            ))}
          </div>
        </div>
      </div>

      {modalImg && (
        <ImageModal
          imageUrl={modalImg.url}
          filename={modalImg.filename}
          onClose={() => setModalImg(null)}
        />
      )}
    </div>
  )
}

// ---- Carte groupe ----
function SubsetGroupCard({
  group, decisions, keepN, onKeepNChange, onDecision, onAuto, onReset, onZoom,
}: {
  group: DuplicateGroup
  decisions: Record<number, boolean>
  keepN: number
  onKeepNChange: (n: number) => void
  onDecision: (id: number, keep: boolean) => void
  onAuto: () => void
  onReset: () => void
  onZoom: (url: string, filename: string) => void
}) {
  const maxN = group.images.length

  return (
    <div className="bg-gray-800 rounded-xl border border-gray-700 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <span className="text-gray-400 text-sm">
          Groupe #{group.group_id} · <strong className="text-white">{group.images.length} images</strong>
          · sim max : <span className="text-yellow-400">{(group.max_sim * 100).toFixed(1)}%</span>
        </span>
        <div className="flex items-center gap-2">
          {/* Keep N slider + numérique, range [0, N] */}
          <div className="flex items-center gap-1.5 bg-gray-900 rounded-lg px-2 py-1 border border-gray-700">
            <span className="text-gray-500 text-xs">Garder</span>
            <input
              type="range"
              min={0}
              max={maxN}
              step={1}
              value={keepN}
              onChange={e => onKeepNChange(Number(e.target.value))}
              className="w-16 accent-indigo-500"
            />
            <input
              type="number"
              min={0}
              max={maxN}
              value={keepN}
              onChange={e => {
                const n = Number(e.target.value)
                if (!isNaN(n)) onKeepNChange(Math.max(0, Math.min(maxN, n)))
              }}
              className="w-10 bg-transparent text-white text-xs text-center focus:outline-none"
            />
            <span className="text-gray-500 text-xs">/{maxN}</span>
          </div>
          <button
            onClick={onAuto}
            className="flex items-center gap-1 px-2.5 py-1 bg-amber-600/20 text-amber-300 border border-amber-600/40 text-xs rounded-lg hover:bg-amber-600/30"
          >
            <Zap size={11} /> Auto
          </button>
          <button
            onClick={onReset}
            className="flex items-center gap-1 px-2.5 py-1 bg-gray-700 text-gray-400 text-xs rounded-lg hover:bg-gray-600"
          >
            <RefreshCw size={11} /> Reset
          </button>
        </div>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-1">
        {group.images.map(img => (
          <SubsetDupCard
            key={img.image_id}
            img={img}
            decision={decisions[img.image_id]}
            onKeep={() => onDecision(img.image_id, true)}
            onReject={() => onDecision(img.image_id, false)}
            onZoom={() => img.thumbnail_url && onZoom(img.thumbnail_url, img.filename)}
          />
        ))}
      </div>
    </div>
  )
}

function SubsetDupCard({ img, decision, onKeep, onReject, onZoom }: {
  img: DuplicateImageInfo
  decision: boolean | undefined
  onKeep: () => void
  onReject: () => void
  onZoom: () => void
}) {
  const isRef = img.similarity_to_representative === 1.0
  const borderColor = decision === true ? 'border-green-500'
    : decision === false ? 'border-red-500'
    : img.is_kept === true ? 'border-green-500/50'
    : img.is_kept === false ? 'border-red-500/50'
    : 'border-gray-600'

  return (
    <div className={`flex-shrink-0 w-40 rounded-xl border-2 overflow-hidden ${borderColor} bg-gray-900`}>
      <div className="aspect-video relative group cursor-pointer" onClick={onZoom}>
        {img.thumbnail_url
          ? <img src={img.thumbnail_url} alt={img.filename} className="w-full h-full object-cover" loading="lazy" />
          : <div className="w-full h-full flex items-center justify-center text-gray-600 text-xs">No img</div>
        }
        {isRef && <div className="absolute top-1 left-1 px-1.5 py-0.5 bg-yellow-500/90 text-black text-xs font-bold rounded">Ref</div>}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 flex items-center justify-center transition-colors">
          <ZoomIn size={16} className="text-white opacity-0 group-hover:opacity-80 transition-opacity" />
        </div>
      </div>
      <div className="p-2">
        <p className="text-white text-xs truncate">{img.filename}</p>
        <p className="text-gray-500 text-xs mt-0.5">
          {isRef ? <span className="text-yellow-400">Référence</span> : `${(img.similarity_to_representative * 100).toFixed(1)}%`}
        </p>
        <div className="flex gap-1 mt-1.5">
          <button onClick={onKeep}
            className={`flex-1 flex items-center justify-center gap-1 py-1 rounded text-xs transition-colors
              ${decision === true ? 'bg-green-600 text-white' : 'bg-gray-700 text-gray-400 hover:bg-green-700 hover:text-white'}`}>
            <CheckCircle size={11} /> Garder
          </button>
          <button onClick={onReject}
            className={`flex-1 flex items-center justify-center gap-1 py-1 rounded text-xs transition-colors
              ${decision === false ? 'bg-red-600 text-white' : 'bg-gray-700 text-gray-400 hover:bg-red-700 hover:text-white'}`}>
            <XCircle size={11} /> Rejeter
          </button>
        </div>
      </div>
    </div>
  )
}
