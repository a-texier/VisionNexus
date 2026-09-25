// ============================================================
// components/sidebar/GlobalAnnotationsPanel.tsx
// Résumé global multi-frames des annotations du projet.
//
// Fonctionnalités :
//   - Liste scrollable : frame, classe, score, modèle, type
//   - Multi-sélection par checkbox
//   - Suppression batch des sélectionnés
//   - "Supprimer depuis frame N" pour nettoyer après un échec IA
//   - Navigation vers la frame d'une annotation
//   - Filtre par source IA uniquement
// ============================================================

import React, { useCallback, useEffect, useState } from 'react'
import { Loader2, Trash2, Navigation, ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react'
import { annotationsAPI } from '../../services/api'
import type { AnnotationSummaryItem, LabelClass, SourceAlgorithm } from '../../types/api'
import { useT } from '../../i18n/useLang'

// Couleurs badge par algorithme
const ALGO_COLOR: Record<NonNullable<SourceAlgorithm>, string> = {
  manual: 'bg-slate-700 text-slate-300',
  sam_point: 'bg-emerald-900/40 text-emerald-400',
  sam_auto: 'bg-teal-900/40 text-teal-400',
  grounding_dino: 'bg-purple-900/40 text-purple-400',
  sam3: 'bg-pink-900/40 text-pink-400',
  samurai: 'bg-fuchsia-900/40 text-fuchsia-300',
  sam2_video: 'bg-teal-900/40 text-teal-300',
  bytetrack: 'bg-orange-900/40 text-orange-400',
  yolo: 'bg-blue-900/40 text-blue-300',
  interpolation: 'bg-yellow-900/40 text-yellow-400',
  guided_tracking: 'bg-blue-900/40 text-blue-400',
  resnet_tracking: 'bg-cyan-900/40 text-cyan-400',
  sam2_tracking: 'bg-teal-900/40 text-teal-300',
  homography: 'bg-lime-900/40 text-lime-400',
  optical_flow: 'bg-sky-900/40 text-sky-400',
}

const ALGO_SHORT: Record<NonNullable<SourceAlgorithm>, string> = {
  manual: 'M',
  sam_point: 'SP',
  sam_auto: 'SA',
  grounding_dino: 'GD',
  sam3: 'S3',
  samurai: 'SR',
  sam2_video: 'S2V',
  bytetrack: 'BT',
  yolo: 'YO',
  interpolation: 'IN',
  guided_tracking: 'GT',
  resnet_tracking: 'RN',
  sam2_tracking: 'S2',
  homography: 'HG',
  optical_flow: 'OF',
}

interface GlobalAnnotationsPanelProps {
  projectId: number
  classes: LabelClass[]
  onFrameSelect: (frameIndex: number) => void
}

export const GlobalAnnotationsPanel: React.FC<GlobalAnnotationsPanelProps> = ({
  projectId,
  classes,
  onFrameSelect,
}) => {
  const t = useT()
  const [items, setItems] = useState<AnnotationSummaryItem[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [showAutoOnly, setShowAutoOnly] = useState(false)
  const [minConfidence, setMinConfidence] = useState(0)
  const [deleteFromFrameIndex, setDeleteFromFrameIndex] = useState<number | string>('')
  const [deleteSourceFilter, setDeleteSourceFilter] = useState<'all' | 'ia'>('all')
  const [showDeleteFrom, setShowDeleteFrom] = useState(false)
  const [confirmDeleteFrom, setConfirmDeleteFrom] = useState(false)
  const [isBatchDeleting, setIsBatchDeleting] = useState(false)

  const getClassName = (classId: number) =>
    classes.find((c) => c.id === classId)?.name ?? `cls_${classId}`

  const getClassColor = (classId: number) =>
    classes.find((c) => c.id === classId)?.color ?? '#3B82F6'

  const loadSummary = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      // On charge toutes les annotations (le filtrage is_auto est côté client)
      const data = await annotationsAPI.summary(projectId, 0)
      setItems(data)
      setSelected(new Set())
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('Erreur inconnue')
      setError(`${t('Impossible de charger le résumé.')} ${msg}`)
    } finally {
      setIsLoading(false)
    }
  }, [projectId, t])

  useEffect(() => {
    void loadSummary()
  }, [loadSummary])

  // Filtrage côté client
  const filtered = items.filter((item) => {
    if (showAutoOnly && !item.is_auto) return false
    if (minConfidence > 0 && item.confidence < minConfidence / 100) return false
    return true
  })

  const toggleSelect = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectAll = () => {
    setSelected(new Set(filtered.map((i) => i.annotation_id)))
  }

  const deselectAll = () => setSelected(new Set())

  const handleBatchDelete = async () => {
    if (selected.size === 0) return
    setIsBatchDeleting(true)
    try {
      const ids = Array.from(selected)
      await annotationsAPI.batchDelete(projectId, ids)
      await loadSummary()
    } catch {
      setError(t('Erreur lors de la suppression batch'))
    } finally {
      setIsBatchDeleting(false)
    }
  }

  const handleDeleteFromFrame = async () => {
    const idx = parseInt(String(deleteFromFrameIndex))
    if (isNaN(idx) || idx < 0) return
    setIsBatchDeleting(true)
    setConfirmDeleteFrom(false)
    try {
      if (deleteSourceFilter === 'ia') {
        // Filtrage côté client : supprime uniquement les annotations IA depuis frame idx
        const toDelete = items
          .filter((item) => item.frame_index >= idx && item.is_auto)
          .map((item) => item.annotation_id)
        if (toDelete.length > 0) {
          await annotationsAPI.batchDelete(projectId, toDelete)
        }
      } else {
        // Supprime toutes les annotations depuis frame idx
        await annotationsAPI.deleteFromFrame(projectId, idx)
      }
      await loadSummary()
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('Erreur inconnue')
      setError(`${t('Erreur lors de la suppression')} : ${msg}`)
    } finally {
      setIsBatchDeleting(false)
      setShowDeleteFrom(false)
    }
  }

  return (
    <div className="flex flex-col h-full text-xs">
      {/* En-tête */}
      <div className="px-2 py-1.5 border-b border-slate-700 flex items-center justify-between gap-1 flex-shrink-0">
        <span className="text-slate-400 uppercase tracking-wide">
          {t('Résumé')} ({filtered.length})
        </span>
        <div className="flex gap-1 items-center">
          <button
            onClick={() => setShowAutoOnly((v) => !v)}
            className={`px-1.5 py-0.5 rounded font-medium transition-colors ${
              showAutoOnly ? 'bg-blue-600/30 text-blue-400' : 'text-slate-500 hover:text-slate-300'
            }`}
            title={t('IA uniquement')}
          >
            {t('IA')}
          </button>
          <button
            onClick={() => void loadSummary()}
            className="p-1 rounded text-slate-500 hover:text-slate-300 transition-colors"
            title={t('Actualiser')}
            disabled={isLoading}
          >
            {isLoading ? <Loader2 size={11} className="animate-spin" /> : '↻'}
          </button>
        </div>
      </div>

      {/* Filtre score */}
      <div className="px-2 py-1 border-b border-slate-700 flex items-center gap-2 flex-shrink-0">
        <span className="text-slate-500">{t('Score min')}</span>
        <input
          type="range" min={0} max={100} step={5} value={minConfidence}
          onChange={(e) => setMinConfidence(parseInt(e.target.value))}
          className="flex-1 accent-indigo-500"
        />
        <span className={`font-mono w-7 text-right ${
          minConfidence >= 80 ? 'text-green-400' : minConfidence >= 50 ? 'text-yellow-400' : 'text-slate-400'
        }`}>{minConfidence}%</span>
      </div>

      {/* Sélection rapide */}
      {filtered.length > 0 && (
        <div className="px-2 py-1 border-b border-slate-700 flex items-center gap-2 flex-shrink-0">
          <button onClick={selectAll} className="text-slate-400 hover:text-white transition-colors">
            {t('Tout sél.')}
          </button>
          <button onClick={deselectAll} className="text-slate-400 hover:text-white transition-colors">
            {t('Désél.')}
          </button>
          <span className="flex-1 text-slate-600 text-right">
            {selected.size > 0 ? `${selected.size} ${t('sél.')}` : ''}
          </span>
          {selected.size > 0 && (
            <button
              onClick={() => void handleBatchDelete()}
              disabled={isBatchDeleting}
              className="flex items-center gap-1 px-1.5 py-0.5 bg-red-700 hover:bg-red-600 disabled:bg-slate-700 text-white rounded transition-colors"
            >
              {isBatchDeleting ? <Loader2 size={10} className="animate-spin" /> : <Trash2 size={10} />}
              {t('Supprimer')} ({selected.size})
            </button>
          )}
        </div>
      )}

      {/* Erreur */}
      {error && (
        <div className="px-2 py-2 bg-red-900/20 border-b border-red-900/30 flex-shrink-0">
          <div className="flex items-start gap-1 text-red-400 mb-1">
            <AlertTriangle size={11} className="mt-0.5 flex-shrink-0" />
            <span className="break-words">{error}</span>
          </div>
          <button
            onClick={() => void loadSummary()}
            className="text-xs text-red-300 hover:text-white underline transition-colors"
          >
            {t('Réessayer')}
          </button>
        </div>
      )}

      {/* Liste annotations */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-8 text-slate-500">
            <Loader2 size={16} className="animate-spin mr-2" /> {t('Chargement...')}
          </div>
        ) : error ? (
          <div className="text-slate-600 text-center py-8 px-4">
            <p className="text-sm mb-2">{t('Résumé indisponible')}</p>
            <p className="text-xs">{t('Vérifiez que le serveur backend est démarré.')}</p>
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-slate-500 text-center py-6">
            {items.length === 0 ? t('Aucune annotation dans ce projet.') : t('Aucune annotation pour ce filtre.')}
          </p>
        ) : (
          filtered.map((item) => {
            const isSelected = selected.has(item.annotation_id)
            const color = getClassColor(item.class_id)
            const algoKey = item.source_algorithm as NonNullable<SourceAlgorithm> | null
            const badgeColor = algoKey ? (ALGO_COLOR[algoKey] ?? 'bg-slate-700 text-slate-300') : 'bg-slate-700 text-slate-300'
            const badgeShort = algoKey ? (ALGO_SHORT[algoKey] ?? '?') : 'M'
            const confColor = item.confidence >= 0.8 ? 'text-green-400' : item.confidence >= 0.5 ? 'text-yellow-400' : 'text-red-400'

            return (
              <div
                key={item.annotation_id}
                className={`flex items-center gap-1.5 px-2 py-1 border-b border-slate-800 cursor-pointer transition-colors select-none ${
                  isSelected ? 'bg-blue-600/15' : 'hover:bg-slate-700/40'
                }`}
                onClick={() => toggleSelect(item.annotation_id)}
              >
                {/* Checkbox */}
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggleSelect(item.annotation_id)}
                  onClick={(e) => e.stopPropagation()}
                  className="accent-blue-500 flex-shrink-0"
                />

                {/* Pastille couleur */}
                <div className="w-2 h-2 rounded-sm flex-shrink-0" style={{ backgroundColor: color }} />

                {/* Infos */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1">
                    <span className="font-medium text-slate-200 truncate">
                      {getClassName(item.class_id)}
                    </span>
                    <span className="text-slate-500 font-mono flex-shrink-0">
                      [{item.annotation_type === 'polygon' ? 'Poly' : 'BBox'}]
                    </span>
                  </div>
                  <div className="flex items-center gap-1 mt-0.5">
                    <span className={`font-mono ${confColor}`}>
                      {(item.confidence * 100).toFixed(0)}%
                    </span>
                    {algoKey && algoKey !== 'manual' && (
                      <span className={`px-1 rounded ${badgeColor}`}>{badgeShort}</span>
                    )}
                    <span className="text-slate-600 font-mono">F{item.frame_index}</span>
                  </div>
                </div>

                {/* Bouton naviguer */}
                <button
                  onClick={(e) => { e.stopPropagation(); onFrameSelect(item.frame_index) }}
                  className="p-0.5 text-slate-600 hover:text-blue-400 transition-colors flex-shrink-0"
                  title={`${t('Aller à la frame')} ${item.frame_index}`}
                >
                  <Navigation size={11} />
                </button>
              </div>
            )
          })
        )}
      </div>

      {/* Section "Supprimer depuis frame N" */}
      <div className="flex-shrink-0 border-t border-slate-700">
        <button
          onClick={() => setShowDeleteFrom((v) => !v)}
          className="w-full flex items-center justify-between px-2 py-1.5 text-slate-400 hover:text-slate-200 transition-colors"
        >
          <span className="flex items-center gap-1">
            <AlertTriangle size={11} className="text-yellow-500" />
            {t('Supprimer depuis frame N…')}
          </span>
          {showDeleteFrom ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
        </button>

        {showDeleteFrom && (
          <div className="px-2 pb-2 bg-red-900/10 border-t border-red-900/30">
            <p className="text-slate-500 mt-1.5 mb-1">
              {t("Supprime toutes les annotations à partir de la frame d'index :")}
            </p>
            <div className="flex items-center gap-1.5 mb-1.5">
              <input
                type="number"
                min={0}
                value={deleteFromFrameIndex}
                onChange={(e) => {
                  setDeleteFromFrameIndex(e.target.value)
                  setConfirmDeleteFrom(false)
                }}
                placeholder={t('Ex: 50')}
                className="w-20 bg-slate-700 border border-slate-600 text-white px-1.5 py-0.5 rounded outline-none"
              />
              <select
                value={deleteSourceFilter}
                onChange={(e) => setDeleteSourceFilter(e.target.value as 'all' | 'ia')}
                className="flex-1 bg-slate-700 border border-slate-600 text-white px-1 py-0.5 rounded outline-none"
              >
                <option value="all">{t('Toutes')}</option>
                <option value="ia">{t('IA seulement')}</option>
              </select>
            </div>
            {!confirmDeleteFrom ? (
              <button
                onClick={() => setConfirmDeleteFrom(true)}
                disabled={deleteFromFrameIndex === '' || isBatchDeleting}
                className="w-full py-1 bg-red-800 hover:bg-red-700 disabled:bg-slate-700 text-white rounded transition-colors"
              >
                {t('Supprimer')}
              </button>
            ) : (
              <div className="flex gap-1">
                <span className="text-red-400 flex-1">{t('Confirmer ?')}</span>
                <button
                  onClick={() => void handleDeleteFromFrame()}
                  className="px-2 py-0.5 bg-red-700 hover:bg-red-600 text-white rounded transition-colors"
                >
                  {t('Oui')}
                </button>
                <button
                  onClick={() => setConfirmDeleteFrom(false)}
                  className="px-2 py-0.5 text-slate-400 hover:text-white transition-colors"
                >
                  {t('Non')}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
