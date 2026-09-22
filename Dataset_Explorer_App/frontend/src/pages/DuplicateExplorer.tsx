// ============================================================
// pages/DuplicateExplorer.tsx
// Exploration et résolution des doublons du dataset complet.
// Fix : keepN range [0, N] (0 = tout rejeter, N = tout garder).
// Ajouts : reset all, champ numérique pour seuil et keepN.
// ============================================================

import { useState } from 'react'
import { useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { GitMerge, CheckCircle, XCircle, Info, ZoomIn, ShieldCheck, Zap, RefreshCw, Activity } from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { datasetsAPI, startRebuildWithoutDuplicates } from '../api/client'
import { useDataset } from '../hooks/useDataset'
import ImageModal from '../components/ImageModal'
import type { DuplicateGroup, DuplicateImageInfo, EmbedEvent } from '../types/api'
import { useT } from '../i18n/useLang'

export default function DuplicateExplorer() {
  const t = useT()
  const { id } = useParams<{ id: string }>()
  const datasetId = Number(id)
  const qc = useQueryClient()

  const [threshold, setThreshold] = useState(0.97)
  const [pendingThreshold, setPendingThreshold] = useState(0.97)
  const [decisions, setDecisions] = useState<Record<number, boolean>>({})
  const [keepN, setKeepN] = useState<Record<number, number>>({})
  const [saving, setSaving] = useState(false)
  const [modalImg, setModalImg] = useState<{ url: string; filename: string; sim: number } | null>(null)
  const [rebuildProgress, setRebuildProgress] = useState<EmbedEvent | null>(null)
  const [isRebuilding, setIsRebuilding] = useState(false)

  const { data: dataset } = useDataset(datasetId)

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['duplicates', datasetId, threshold],
    queryFn: () => datasetsAPI.getDuplicates(datasetId, threshold),
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
    toast.success(`${t('Auto-sélection :')} ${data.groups.length} ${t('groupe(s) traité(s)')}`)
  }

  const handleResetAll = () => {
    setDecisions({})
    setKeepN({})
    toast.success(t('Toutes les décisions réinitialisées'))
  }

  const handleSaveDecisions = async () => {
    if (Object.keys(decisions).length === 0) return
    setSaving(true)
    try {
      const dec = Object.entries(decisions).map(([imgId, keep]) => ({
        image_id: Number(imgId),
        keep,
      }))
      await datasetsAPI.patchDuplicateDecision(datasetId, dec)
      toast.success(t('Décisions sauvegardées'))
      setDecisions({})
      refetch()
    } catch {
      toast.error(t('Erreur sauvegarde'))
    } finally {
      setSaving(false)
    }
  }

  const handleThresholdInput = (val: string) => {
    const n = Number(val)
    if (!isNaN(n) && n >= 80 && n <= 100) {
      setPendingThreshold(n / 100)
    }
  }

  const handleRebuild = () => {
    if (!dataset?.rejected_count) return toast.error(t('Aucune image rejetée à exclure'))
    setIsRebuilding(true)
    setRebuildProgress(null)
    const stop = startRebuildWithoutDuplicates(
      datasetId,
      (evt: EmbedEvent) => {
        setRebuildProgress(evt)
        if (evt.type === 'done') {
          toast.success(t('UMAP + KMeans recalculés sans les doublons rejetés'))
          qc.invalidateQueries({ queryKey: ['datasets'] })
          qc.invalidateQueries({ queryKey: ['dataset', datasetId] })
          qc.invalidateQueries({ queryKey: ['dataset-map', datasetId] })
          qc.invalidateQueries({ queryKey: ['dataset-clusters', datasetId] })
        }
        if (evt.type === 'error') {
          toast.error(`${t('Erreur :')} ${(evt as { message: string }).message}`)
        }
      },
      () => setIsRebuilding(false),
    )
    void stop
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <GitMerge size={22} /> {t('Explorateur de doublons')}
        </h1>
        {data && (
          <p className="text-gray-400 mt-1">
            <span className="text-white">{data.group_count}</span> {t('groupe(s)')} ·{' '}
            <span className="text-white">{data.duplicate_count}</span> {t('image(s) concernées')}
          </p>
        )}
        {/* Stats avant/après */}
        {dataset && (dataset.rejected_count > 0) && (
          <div className="flex items-center gap-4 mt-2 px-3 py-2 bg-orange-900/20 border border-orange-600/30 rounded-lg">
            <Activity size={14} className="text-orange-400 flex-shrink-0" />
            <span className="text-gray-400 text-sm">
              {t('Base :')} <span className="text-white font-medium">{dataset.image_count}</span>
            </span>
            <span className="text-red-400 text-sm">
              {t('Jetés :')} <span className="font-medium">{dataset.rejected_count}</span>
            </span>
            <span className="text-green-400 text-sm">
              {t('Utilisé :')} <span className="font-medium">{dataset.image_count - dataset.rejected_count}</span>
            </span>
          </div>
        )}
      </div>

      {/* Explication sémantique */}
      <div className="bg-gray-800 rounded-xl border border-gray-700 p-4">
        <div className="flex items-start gap-2">
          <Info size={15} className="text-indigo-400 flex-shrink-0 mt-0.5" />
          <div className="space-y-2 text-sm">
            <p className="font-medium text-white">{t('Principe — jamais de suppression physique')}</p>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="flex gap-2 bg-green-900/15 border border-green-700/30 rounded-lg p-2.5">
                <CheckCircle size={13} className="text-green-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-green-300 font-medium">{t('Garder')}</p>
                  <p className="text-gray-400">{t('Inclus dans les exports et subsets futurs')}</p>
                </div>
              </div>
              <div className="flex gap-2 bg-red-900/15 border border-red-700/30 rounded-lg p-2.5">
                <XCircle size={13} className="text-red-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-red-300 font-medium">{t('Rejeter')}</p>
                  <p className="text-gray-400">{t('Exclu des exports — fichier jamais effacé')}</p>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <ShieldCheck size={12} className="text-green-500" />
              <span>{t('Les fichiers originaux ne sont')} <strong className="text-gray-400">{t('jamais supprimés')}</strong>.</span>
            </div>
          </div>
        </div>
      </div>

      {/* Contrôles */}
      <div className="bg-gray-800 rounded-xl p-4 border border-gray-700 flex flex-wrap items-center gap-3">
        {/* Seuil avec slider + champ numérique */}
        <div className="flex items-center gap-2">
          <label className="text-gray-400 text-sm whitespace-nowrap">{t('Seuil :')}</label>
          <input
            type="range" min={80} max={100} step={1}
            value={Math.round(pendingThreshold * 100)}
            onChange={e => setPendingThreshold(Number(e.target.value) / 100)}
            className="w-28 accent-indigo-500"
          />
          <input
            type="number" min={80} max={100} step={1}
            value={Math.round(pendingThreshold * 100)}
            onChange={e => handleThresholdInput(e.target.value)}
            className="w-16 bg-gray-900 border border-gray-600 rounded px-2 py-1 text-sm text-gray-200 text-center focus:ring-1 focus:ring-indigo-500"
          />
          <span className="text-gray-500 text-xs">%</span>
          <button onClick={() => setThreshold(pendingThreshold)}
            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm rounded-lg">
            {t('Appliquer')}
          </button>
        </div>

        <span className="text-gray-600 text-xs">{t('80% ≈ approx · 97% = quasi-identiques · 100% = exactement identiques')}</span>

        {data && data.group_count > 0 && (
          <button onClick={handleAutoAll}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-600/20 text-amber-300 border border-amber-600/40 text-sm rounded-lg hover:bg-amber-600/30 transition-colors">
            <Zap size={14} /> {t('Auto-sélectionner tous')}
          </button>
        )}

        {(Object.keys(decisions).length > 0 || Object.keys(keepN).length > 0) && (
          <button onClick={handleResetAll}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-700 text-gray-400 text-sm rounded-lg hover:bg-gray-600 transition-colors">
            <RefreshCw size={13} /> {t('Reset tout')}
          </button>
        )}

        {Object.keys(decisions).length > 0 && (
          <button onClick={handleSaveDecisions} disabled={saving}
            className="px-4 py-1.5 bg-green-600 hover:bg-green-500 text-white text-sm rounded-lg disabled:opacity-50 ml-auto">
            {saving ? t('Sauvegarde...') : `${t('Sauvegarder')} (${Object.keys(decisions).length} ${t('décisions')})`}
          </button>
        )}

        {/* Bouton rebuild UMAP sans doublons */}
        {dataset && dataset.rejected_count > 0 && (
          <button
            onClick={handleRebuild}
            disabled={isRebuilding}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-600/20 text-orange-300 border border-orange-600/40 text-sm rounded-lg hover:bg-orange-600/30 transition-colors disabled:opacity-50 ml-auto"
            title={t('Recalculer UMAP + KMeans en excluant les images rejetées')}
          >
            <RefreshCw size={14} className={isRebuilding ? 'animate-spin' : ''} />
            {isRebuilding ? t('Rebuild en cours...') : `${t('Rebuild UMAP sans doublons')} (${dataset.rejected_count} ${t('exclus')})`}
          </button>
        )}
      </div>

      {/* Barre de progression rebuild */}
      {isRebuilding && rebuildProgress?.type === 'progress' && (
        <div className="bg-gray-800 rounded-xl p-3 border border-orange-600/30">
          <div className="flex justify-between text-xs text-gray-400 mb-1.5">
            <span>{t('Phase :')} {rebuildProgress.phase}</span>
            <span>{rebuildProgress.current}/{rebuildProgress.total}</span>
          </div>
          <div className="w-full bg-gray-700 rounded-full h-1.5">
            <div
              className="bg-orange-500 h-1.5 rounded-full transition-all"
              style={{ width: `${Math.round((rebuildProgress.current / Math.max(rebuildProgress.total, 1)) * 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Groupes */}
      {isLoading && <p className="text-gray-500">{t('Analyse en cours...')}</p>}
      {!isLoading && data?.group_count === 0 && (
        <div className="text-center py-16 text-gray-500">
          <GitMerge size={48} className="mx-auto mb-3 opacity-30" />
          <p>{t('Aucun doublon trouvé avec ce seuil.')}</p>
          <p className="text-sm mt-1">{t('Réduisez le seuil pour des similitudes moins strictes.')}</p>
        </div>
      )}

      <div className="space-y-6">
        {data?.groups.map(group => (
          <DuplicateGroupCard
            key={group.group_id}
            group={group}
            decisions={decisions}
            keepN={getKeepN(group.group_id, group.images.length)}
            onKeepNChange={n => setKeepN(prev => ({ ...prev, [group.group_id]: n }))}
            onDecision={(id, keep) => setDecisions(prev => ({ ...prev, [id]: keep }))}
            onAuto={() => autoSelectGroup(group, getKeepN(group.group_id, group.images.length))}
            onReset={() => resetGroup(group)}
            onZoom={(url, filename, sim) => setModalImg({ url, filename, sim })}
          />
        ))}
      </div>

      {modalImg && (
        <ImageModal
          imageUrl={modalImg.url}
          filename={modalImg.filename}
          info={{ score: modalImg.sim }}
          onClose={() => setModalImg(null)}
        />
      )}
    </div>
  )
}

// ---- Carte groupe ----
function DuplicateGroupCard({
  group, decisions, keepN, onKeepNChange, onDecision, onAuto, onReset, onZoom,
}: {
  group: DuplicateGroup
  decisions: Record<number, boolean>
  keepN: number
  onKeepNChange: (n: number) => void
  onDecision: (id: number, keep: boolean) => void
  onAuto: () => void
  onReset: () => void
  onZoom: (url: string, filename: string, sim: number) => void
}) {
  const t = useT()
  // Range complet [0, N] : 0 = tout rejeter, N = tout garder
  const maxN = group.images.length

  const keptCount = group.images.filter(img =>
    decisions[img.image_id] === true || (decisions[img.image_id] === undefined && img.is_kept === true)
  ).length
  const rejCount = group.images.filter(img =>
    decisions[img.image_id] === false || (decisions[img.image_id] === undefined && img.is_kept === false)
  ).length

  const handleKeepNInput = (val: string) => {
    const n = Number(val)
    if (!isNaN(n)) onKeepNChange(Math.max(0, Math.min(maxN, n)))
  }

  return (
    <div className="bg-gray-800 rounded-xl border border-gray-700 p-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-3">
          <span className="text-gray-400 text-sm">
            {t('Groupe')} #{group.group_id} · <strong className="text-white">{group.images.length} images</strong>
            · {t('sim max :')} <span className="text-yellow-400">{(group.max_sim * 100).toFixed(1)}%</span>
          </span>
          <div className="flex gap-1.5">
            {keptCount > 0 && <span className="px-2 py-0.5 bg-green-600/20 text-green-400 rounded-full text-xs">{keptCount} {t('à garder')}</span>}
            {rejCount > 0 && <span className="px-2 py-0.5 bg-red-600/20 text-red-400 rounded-full text-xs">{rejCount} {t('à rejeter')}</span>}
          </div>
        </div>

        {/* Keep-N controls — slider + champ numérique, range [0, N] */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 bg-gray-900 rounded-lg px-2.5 py-1 border border-gray-700">
            <span className="text-gray-500 text-xs">{t('Garder')}</span>
            <input
              type="range"
              min={0}
              max={maxN}
              step={1}
              value={keepN}
              onChange={e => onKeepNChange(Number(e.target.value))}
              className="w-20 accent-indigo-500"
            />
            <input
              type="number"
              min={0}
              max={maxN}
              value={keepN}
              onChange={e => handleKeepNInput(e.target.value)}
              className="w-10 bg-transparent text-white text-sm text-center focus:outline-none font-medium"
            />
            <span className="text-gray-500 text-xs">/ {maxN}</span>
          </div>
          <button onClick={onAuto}
            className="flex items-center gap-1.5 px-2.5 py-1 bg-amber-600/20 text-amber-300 border border-amber-600/40 text-xs rounded-lg hover:bg-amber-600/30 transition-colors"
            title={t('Sélectionner automatiquement les N meilleures images')}>
            <Zap size={12} /> Auto
          </button>
          <button onClick={onReset}
            className="flex items-center gap-1.5 px-2.5 py-1 bg-gray-700 text-gray-400 text-xs rounded-lg hover:bg-gray-600 transition-colors"
            title={t('Réinitialiser les décisions de ce groupe')}>
            <RefreshCw size={12} /> Reset
          </button>
        </div>
      </div>

      {/* Images */}
      <div className="flex gap-3 overflow-x-auto pb-2">
        {group.images.map(img => (
          <DuplicateImageCard
            key={img.image_id}
            img={img}
            decision={decisions[img.image_id]}
            onKeep={() => onDecision(img.image_id, true)}
            onReject={() => onDecision(img.image_id, false)}
            onZoom={() => img.thumbnail_url && onZoom(img.thumbnail_url, img.filename, img.similarity_to_representative)}
          />
        ))}
      </div>
    </div>
  )
}

// ---- Carte image doublon ----
function DuplicateImageCard({ img, decision, onKeep, onReject, onZoom }: {
  img: DuplicateImageInfo
  decision: boolean | undefined
  onKeep: () => void
  onReject: () => void
  onZoom: () => void
}) {
  const t = useT()
  const isRef = img.similarity_to_representative === 1.0
  const borderColor = decision === true ? 'border-green-500'
    : decision === false ? 'border-red-500'
    : img.is_kept === true ? 'border-green-500/50'
    : img.is_kept === false ? 'border-red-500/50'
    : 'border-gray-600'

  return (
    <div className={`flex-shrink-0 w-44 rounded-xl border-2 overflow-hidden ${borderColor} bg-gray-900`}>
      <div className="aspect-video relative group cursor-pointer" onClick={onZoom}>
        {img.thumbnail_url
          ? <img src={img.thumbnail_url} alt={img.filename} className="w-full h-full object-cover" loading="lazy" />
          : <div className="w-full h-full flex items-center justify-center text-gray-600 text-xs">No preview</div>
        }
        {isRef && <div className="absolute top-1 left-1 px-1.5 py-0.5 bg-yellow-500/90 text-black text-xs font-bold rounded">Ref</div>}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 flex items-center justify-center transition-colors">
          <ZoomIn size={18} className="text-white opacity-0 group-hover:opacity-80 transition-opacity" />
        </div>
      </div>
      <div className="p-2">
        <p className="text-white text-xs truncate font-medium">{img.filename}</p>
        <p className="text-gray-500 text-xs mt-0.5">
          {isRef ? <span className="text-yellow-400">{t('Référence')}</span> : `${t('Sim :')} ${(img.similarity_to_representative * 100).toFixed(1)}%`}
        </p>
        {img.is_kept !== null && decision === undefined && (
          <p className="text-xs mt-0.5">
            {img.is_kept ? <span className="text-green-500">{t('Décision :')} {t('Garder')}</span> : <span className="text-red-500">{t('Décision :')} {t('Rejeter')}</span>}
          </p>
        )}
        <div className="flex gap-1.5 mt-2">
          <button onClick={onKeep}
            className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-xs font-medium transition-colors
              ${decision === true ? 'bg-green-600 text-white' : 'bg-gray-700 text-gray-400 hover:bg-green-700 hover:text-white'}`}>
            <CheckCircle size={12} /> {t('Garder')}
          </button>
          <button onClick={onReject}
            className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-xs font-medium transition-colors
              ${decision === false ? 'bg-red-600 text-white' : 'bg-gray-700 text-gray-400 hover:bg-red-700 hover:text-white'}`}>
            <XCircle size={12} /> {t('Rejeter')}
          </button>
        </div>
      </div>
    </div>
  )
}
