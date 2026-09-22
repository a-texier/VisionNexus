// ============================================================
// components/sidebar/AnnotationList.tsx
// Liste scrollable des annotations de la frame courante.
//
// Fonctionnalités :
//   - Filtre par classe et filtre IA uniquement
//   - Sélection simple et Shift+clic multi-sélection
//   - Surlignage auto + scroll quand une annotation est sélectionnée depuis le canvas
//   - Double-clic → zoom canvas sur l'annotation
//   - Badge de provenance IA (SAM Point, SAM Auto, Grounding DINO, ByteTrack, Interpolation)
//   - Bouton supprimer toutes les annotations de la frame (avec confirmation)
//   - Bouton NMS (Non-Maximum Suppression) avec seuil IoU réglable
//   - Touche Suppr pour supprimer les annotations sélectionnées
// ============================================================

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Filter, Trash2, Layers, Cpu, Zap, SlidersHorizontal, CheckCircle, XCircle, ChevronDown, ChevronUp } from 'lucide-react'
import type { Annotation, LabelClass, SAMMask, SourceAlgorithm, Track } from '../../types/api'
import { useAnnotationStore } from '../../stores/annotationStore'
import { useUIStore } from '../../stores/uiStore'
import { useProjectStore } from '../../stores/projectStore'
import { useSAMStore } from '../../stores/samStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useT } from '../../i18n/useLang'

interface AnnotationListProps {
  annotations: Annotation[]
  classes: LabelClass[]
  tracks?: Track[]
  onDeleteAnnotation: (id: number) => Promise<void>
  onDeleteAllAnnotations: () => Promise<void>
  onApplyNMS: (iouThreshold: number) => Promise<void>
  // Assigner (ou créer/détacher) la track d'une annotation — MOT
  onAssignTrack?: (annotationId: number, action: 'new' | 'assign' | 'detach', trackId?: number) => Promise<void>
}

// Labels lisibles pour chaque algorithme source
const ALGO_LABEL: Record<NonNullable<SourceAlgorithm>, string> = {
  manual: 'Manuel',
  sam_point: 'SAM Point',
  sam_auto: 'SAM Auto',
  grounding_dino: 'Grounding DINO',
  sam3: 'SAM3',
  // SAMURAI et SAM2 video sont deux trackers distincts. 'sam2_tracking' est la
  // valeur historique des runs anterieurs a leur separation.
  samurai: 'SAMURAI',
  sam2_video: 'SAM2 video',
  sam2_tracking: 'SAMURAI/SAM2',
  bytetrack: 'ByteTrack',
  yolo: 'YOLO',
  interpolation: 'Interpolation',
  guided_tracking: 'Guided',
  resnet_tracking: 'ResNet',
}

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
}

export const AnnotationList: React.FC<AnnotationListProps> = ({
  annotations,
  classes,
  tracks = [],
  onDeleteAnnotation,
  onDeleteAllAnnotations,
  onApplyNMS,
  onAssignTrack,
}) => {
  const t = useT()
  // track.id → track (pour afficher #uid + couleur)
  const trackById = React.useMemo(() => {
    const m = new Map<number, Track>()
    for (const t of tracks) m.set(t.id, t)
    return m
  }, [tracks])
  const { selectedAnnotationIds, selectAnnotation, selectAnnotations, deselectAll, deleteSelected, addAnnotation, activeClassId } = useAnnotationStore()
  const { zoomToAnnotation } = useUIStore()
  const { getCurrentFrame } = useProjectStore()
  const { streamedMasks, removeMask, clearStreamedMasks } = useSAMStore()

  const [filterClassId, setFilterClassId] = useState<number | null>(null)
  const [showAutoOnly, setShowAutoOnly] = useState(false)
  const [minConfidence, setMinConfidence] = useState(0)
  const [showConfidenceSlider, setShowConfidenceSlider] = useState(false)
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false)
  const [showNMS, setShowNMS] = useState(false)
  const nmsDefault = useSettingsStore((s) => s.settings?.algorithms?.nms_iou_threshold ?? 0.5)
  const nmsLoaded = useSettingsStore((s) => s.loaded)
  const [nmsThreshold, setNmsThreshold] = useState(nmsDefault)
  useEffect(() => { setNmsThreshold(nmsDefault) }, [nmsLoaded]) // eslint-disable-line
  const [isNMSRunning, setIsNMSRunning] = useState(false)
  const [showProposals, setShowProposals] = useState(true)
  const [isValidatingAll, setIsValidatingAll] = useState(false)

  // Refs pour le scroll automatique et l'ancre de sélection intervalle
  const listRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<Map<number, HTMLDivElement>>(new Map())
  const anchorIndexRef = useRef<number | null>(null)  // Ancre shift+clic

  // Filtre les annotations selon les critères actifs
  const filteredAnnotations = annotations.filter((ann) => {
    if (filterClassId !== null && ann.class_id !== filterClassId) return false
    if (showAutoOnly && !ann.is_auto) return false
    if (minConfidence > 0 && ann.confidence < minConfidence / 100) return false
    return true
  })

  const getClassName = (classId: number) =>
    classes.find((c) => c.id === classId)?.name ?? `classe_${classId}`

  const getClassColor = (classId: number) =>
    classes.find((c) => c.id === classId)?.color ?? '#3B82F6'

  const getTypeLabel = (ann: Annotation) =>
    ann.annotation_type === 'polygon' ? 'Poly' : 'BBox'

  const formatConfidence = (conf: number) => `${(conf * 100).toFixed(0)}%`

  // Scroll automatique vers l'annotation sélectionnée (depuis le canvas)
  useEffect(() => {
    if (selectedAnnotationIds.size === 1) {
      const [id] = selectedAnnotationIds
      const el = itemRefs.current.get(id)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      }
    }
  }, [selectedAnnotationIds])

  // Suppression au clavier (Suppr/Backspace) depuis la sidebar
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedAnnotationIds.size > 0) {
        e.preventDefault()
        void deleteSelected()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [selectedAnnotationIds, deleteSelected])

  // Clic sur annotation : sélection simple ou Shift+clic sélection d'intervalle (style explorateur)
  const handleItemClick = useCallback(
    (e: React.MouseEvent, annId: number, index: number) => {
      if (e.shiftKey && anchorIndexRef.current !== null) {
        // Sélection de la plage entre l'ancre et l'index courant
        const start = Math.min(anchorIndexRef.current, index)
        const end = Math.max(anchorIndexRef.current, index)
        const rangeIds = filteredAnnotations.slice(start, end + 1).map((a) => a.id)
        selectAnnotations(rangeIds)
      } else {
        // Clic simple : sélection unique + mise à jour de l'ancre
        selectAnnotation(annId, false)
        anchorIndexRef.current = index
      }
    },
    [selectAnnotation, selectAnnotations, filteredAnnotations]
  )

  // Double-clic : zoom canvas sur l'annotation
  const handleItemDoubleClick = useCallback(
    (ann: Annotation) => {
      const frame = getCurrentFrame()
      if (!frame) return
      // Estimation de la taille du container canvas (~viewport - sidebar - toolbar)
      const containerW = window.innerWidth - 256 - 16
      const containerH = window.innerHeight - 80
      zoomToAnnotation(ann.cx, ann.cy, ann.width, ann.height, frame.width, frame.height, containerW, containerH)
    },
    [getCurrentFrame, zoomToAnnotation]
  )

  const handleNMS = async () => {
    setIsNMSRunning(true)
    try {
      await onApplyNMS(nmsThreshold)
      setShowNMS(false)
    } finally {
      setIsNMSRunning(false)
    }
  }

  // ---- Gestion propositions SAM Auto ----

  const maskToAnnotation = useCallback((mask: SAMMask) => {
    const [cx, cy, w, h] = mask.bbox_yolo
    const classId = activeClassId ?? classes[0]?.id ?? 0
    return {
      class_id: classId,
      annotation_type: (mask.polygon.length > 0 ? 'polygon' : 'bbox') as 'polygon' | 'bbox',
      cx, cy, width: w, height: h,
      points: mask.polygon.length > 0 ? mask.polygon : null,
      confidence: mask.score,
      is_auto: true,
      source_algorithm: 'sam_auto' as const,
    }
  }, [activeClassId, classes])

  const handleValidateMask = useCallback(async (mask: SAMMask, index: number) => {
    await addAnnotation(maskToAnnotation(mask))
    removeMask(index)
  }, [addAnnotation, maskToAnnotation, removeMask])

  const handleValidateAllMasks = async () => {
    if (streamedMasks.length === 0) return
    setIsValidatingAll(true)
    try {
      const masksSnapshot = [...streamedMasks]
      for (const mask of masksSnapshot) {
        await addAnnotation(maskToAnnotation(mask))
      }
      clearStreamedMasks()
    } finally {
      setIsValidatingAll(false)
    }
  }

  const algoLabel = (src: SourceAlgorithm): string | null => {
    if (!src || src === 'manual') return null
    return ALGO_LABEL[src] ?? src
  }

  const algoColor = (src: SourceAlgorithm): string => {
    if (!src || src === 'manual') return ALGO_COLOR.manual
    return ALGO_COLOR[src] ?? 'bg-blue-900/40 text-blue-400'
  }

  return (
    <div className="flex flex-col h-full">
      {/* En-tête avec filtres */}
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-slate-700">
        <span className="text-xs text-slate-400 uppercase tracking-wide">
          Annotations ({filteredAnnotations.length})
        </span>

        <div className="flex gap-1">
          {/* Filtre IA seulement */}
          <button
            onClick={() => setShowAutoOnly((v) => !v)}
            className={`p-1 rounded text-xs transition-colors font-medium ${
              showAutoOnly
                ? 'bg-blue-600/30 text-blue-400'
                : 'text-slate-500 hover:text-slate-300'
            }`}
            title={t('Afficher annotations IA uniquement')}
          >
            IA
          </button>

          {/* Filtre score confiance */}
          <button
            onClick={() => setShowConfidenceSlider((v) => !v)}
            className={`p-1 rounded transition-colors text-xs font-medium ${
              showConfidenceSlider || minConfidence > 0
                ? 'bg-indigo-600/30 text-indigo-400'
                : 'text-slate-500 hover:text-slate-300'
            }`}
            title={t('Filtrer par score de confiance')}
          >
            <SlidersHorizontal size={12} />
          </button>

          {/* Bouton NMS */}
          <button
            onClick={() => setShowNMS((v) => !v)}
            className={`p-1 rounded transition-colors ${
              showNMS ? 'bg-orange-600/30 text-orange-400' : 'text-slate-500 hover:text-slate-300'
            }`}
            title={t('Non-Maximum Suppression — supprimer les doublons')}
          >
            <Layers size={12} />
          </button>

          {/* Filtre classe : effacer */}
          <button
            onClick={() => setFilterClassId(null)}
            className={`p-1 rounded transition-colors ${
              filterClassId === null
                ? 'text-slate-300'
                : 'text-slate-500 hover:text-slate-300'
            }`}
            title={t('Effacer filtre classe')}
          >
            <Filter size={12} />
          </button>
        </div>
      </div>

      {/* Panneau NMS (visible quand showNMS) */}
      {showNMS && (
        <div className="px-2 py-2 bg-orange-900/10 border-b border-orange-800/30">
          <p className="text-xs text-orange-300 mb-1.5 font-medium flex items-center gap-1">
            <Zap size={11} /> {t('NMS — Supprimer chevauchements')}
          </p>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400">IoU &gt;</span>
            <input
              type="number" min="0.1" max="0.99" step="0.05"
              value={nmsThreshold}
              onChange={(e) => setNmsThreshold(parseFloat(e.target.value))}
              className="w-14 bg-slate-700 border border-slate-600 text-white text-xs px-1.5 py-0.5 rounded outline-none"
            />
            <span className="text-xs text-slate-500">(0.5 = 50%)</span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            {t("Garde l'annotation avec la meilleure confiance.")}
          </p>
          <button
            onClick={() => void handleNMS()}
            disabled={isNMSRunning}
            className="mt-1.5 w-full py-1 text-xs bg-orange-700 hover:bg-orange-600 disabled:bg-slate-700 text-white rounded transition-colors"
          >
            {isNMSRunning ? t('Traitement...') : t('Appliquer NMS')}
          </button>
        </div>
      )}

      {/* Panneau filtre confiance */}
      {showConfidenceSlider && (
        <div className="px-2 py-2 bg-indigo-900/10 border-b border-indigo-800/30">
          <p className="text-xs text-indigo-300 mb-1.5 font-medium flex items-center gap-1">
            <SlidersHorizontal size={11} /> {t('Score min de confiance')}
          </p>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={minConfidence}
              onChange={(e) => setMinConfidence(parseInt(e.target.value))}
              className="flex-1 accent-indigo-500"
            />
            <span
              className={`text-xs font-mono w-8 text-right ${
                minConfidence >= 80
                  ? 'text-green-400'
                  : minConfidence >= 50
                  ? 'text-yellow-400'
                  : 'text-slate-300'
              }`}
            >
              {minConfidence}%
            </span>
          </div>
          {minConfidence > 0 && (
            <button
              onClick={() => setMinConfidence(0)}
              className="mt-1 text-xs text-slate-500 hover:text-slate-300 transition-colors"
            >
              {t('Réinitialiser')}
            </button>
          )}
        </div>
      )}

      {/* Filtre par classe */}
      {classes.length > 0 && (
        <div className="flex gap-1 px-2 py-1.5 flex-wrap border-b border-slate-700">
          {classes.map((cls) => (
            <button
              key={cls.id}
              onClick={() => setFilterClassId(filterClassId === cls.id ? null : cls.id)}
              className={`px-1.5 py-0.5 rounded text-xs transition-colors ${
                filterClassId === cls.id
                  ? 'opacity-100 text-white'
                  : 'opacity-50 hover:opacity-75 text-slate-300'
              }`}
              style={{
                backgroundColor: filterClassId === cls.id ? cls.color + '44' : cls.color + '22',
                border: `1px solid ${cls.color}66`,
              }}
            >
              {cls.name}
            </button>
          ))}
        </div>
      )}

      {/* Liste des annotations */}
      <div className="flex-1 overflow-y-auto" ref={listRef}>
        {filteredAnnotations.length === 0 ? (
          <p className="text-xs text-slate-500 text-center py-6">
            {annotations.length === 0
              ? t('Aucune annotation sur cette frame.')
              : t('Aucune annotation pour ce filtre.')}
          </p>
        ) : (
          filteredAnnotations.map((ann, idx) => {
            const isSelected = selectedAnnotationIds.has(ann.id)
            const color = getClassColor(ann.class_id)
            const label = algoLabel(ann.source_algorithm)

            return (
              <div
                key={ann.id}
                ref={(el) => {
                  if (el) itemRefs.current.set(ann.id, el)
                  else itemRefs.current.delete(ann.id)
                }}
                onClick={(e) => handleItemClick(e, ann.id, idx)}
                onDoubleClick={() => handleItemDoubleClick(ann)}
                className={`flex items-center gap-2 px-2 py-1.5 cursor-pointer transition-colors group border-b border-slate-800 select-none ${
                  isSelected
                    ? 'bg-blue-600/20 border-l-2 border-l-blue-500'
                    : 'hover:bg-slate-700/50'
                }`}
                title={t('Clic = sélection | Shift+clic = sélection intervalle | Double-clic = zoom')}
              >
                {/* Indicateur couleur */}
                <div
                  className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                  style={{ backgroundColor: color }}
                />

                {/* Infos annotation */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-slate-200 truncate font-medium">
                      {getClassName(ann.class_id)}
                    </span>
                    <span className="text-xs text-slate-500 font-mono flex-shrink-0">
                      [{getTypeLabel(ann)}]
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                    {/* Score de confiance */}
                    <span
                      className={`text-xs font-mono ${
                        ann.confidence >= 0.8
                          ? 'text-green-400'
                          : ann.confidence >= 0.5
                          ? 'text-yellow-400'
                          : 'text-red-400'
                      }`}
                    >
                      {formatConfidence(ann.confidence)}
                    </span>

                    {/* Badge IA avec provenance */}
                    {ann.is_auto && (
                      <span className={`text-xs px-1 rounded flex items-center gap-0.5 ${algoColor(ann.source_algorithm)}`}>
                        <Cpu size={9} />
                        {label ?? t('IA')}
                      </span>
                    )}

                    {/* Badge interpolation */}
                    {ann.is_interpolated && !ann.is_auto && (
                      <span className="text-xs text-yellow-400 bg-yellow-900/30 px-1 rounded">
                        {t('Interp.')}
                      </span>
                    )}

                    {/* Track : sélecteur MOT (badge coloré + liste déroulante) */}
                    {onAssignTrack ? (
                      <select
                        value={ann.track_id ?? ''}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => {
                          e.stopPropagation()
                          const v = e.target.value
                          if (v === '') void onAssignTrack(ann.id, 'detach')
                          else if (v === 'new') void onAssignTrack(ann.id, 'new')
                          else void onAssignTrack(ann.id, 'assign', parseInt(v))
                        }}
                        title={t('Track (suivi objet)')}
                        className="text-xs font-mono bg-slate-700/70 border border-slate-600 rounded px-1 py-0 outline-none focus:border-blue-500 max-w-24"
                        style={ann.track_id ? { color: trackById.get(ann.track_id)?.color ?? '#94a3b8' } : undefined}
                      >
                        <option value="" style={{ backgroundColor: '#1e293b', color: '#e2e8f0' }}>— track</option>
                        <option value="new" style={{ backgroundColor: '#1e293b', color: '#e2e8f0' }}>+ {t('nouvelle')}</option>
                        {tracks.map((t) => (
                          <option key={t.id} value={t.id} style={{ backgroundColor: '#1e293b', color: '#e2e8f0' }}>
                            #{t.track_uid} ({getClassName(t.class_id)})
                          </option>
                        ))}
                      </select>
                    ) : ann.track_id ? (
                      // Afficher le track_uid réel (pas le PK track_id) ; « … » tant qu'il
                      // n'est pas encore chargé (évite un numéro erroné qui « corrige » après).
                      <span className="text-xs text-slate-500 font-mono">
                        #{trackById.get(ann.track_id)?.track_uid ?? '…'}
                      </span>
                    ) : null}
                  </div>
                </div>

                {/* Bouton supprimer (visible au hover) */}
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    void onDeleteAnnotation(ann.id)
                  }}
                  className="p-0.5 opacity-0 group-hover:opacity-100 hover:text-red-400 text-slate-500 transition-all flex-shrink-0"
                  title={t('Supprimer cette annotation')}
                >
                  <Trash2 size={11} />
                </button>
              </div>
            )
          })
        )}
      </div>

      {/* ---- Section Propositions SAM Auto ---- */}
      {streamedMasks.length > 0 && (
        <div className="flex-shrink-0 border-t-2 border-teal-700/60 bg-teal-950/20">
          {/* En-tête */}
          <div
            className="flex items-center justify-between px-2 py-1.5 cursor-pointer hover:bg-teal-900/20 transition-colors"
            onClick={() => setShowProposals((v) => !v)}
          >
            <span className="text-xs text-teal-400 font-medium flex items-center gap-1">
              <Cpu size={11} />
              SAM Auto — {streamedMasks.length} {t('proposition')}{streamedMasks.length !== 1 ? 's' : ''}
            </span>
            <div className="flex items-center gap-1">
              <span className="text-xs text-slate-500 italic">{t('non validées')}</span>
              {showProposals ? <ChevronUp size={11} className="text-teal-500" /> : <ChevronDown size={11} className="text-teal-500" />}
            </div>
          </div>

          {showProposals && (
            <>
              {/* Actions globales */}
              <div className="flex items-center gap-1 px-2 pb-1">
                <button
                  onClick={() => void handleValidateAllMasks()}
                  disabled={isValidatingAll}
                  className="flex items-center gap-1 px-2 py-0.5 text-xs bg-teal-700 hover:bg-teal-600 disabled:bg-slate-700 text-white rounded transition-colors"
                >
                  <CheckCircle size={10} />
                  {isValidatingAll ? t('Validation…') : `${t('Valider tout')} (${streamedMasks.length})`}
                </button>
                <button
                  onClick={clearStreamedMasks}
                  className="flex items-center gap-1 px-2 py-0.5 text-xs bg-slate-700 hover:bg-red-800 text-slate-300 hover:text-white rounded transition-colors"
                >
                  <XCircle size={10} />
                  {t('Rejeter tout')}
                </button>
              </div>

              {/* Liste des propositions */}
              <div className="max-h-36 overflow-y-auto">
                {streamedMasks.map((mask, idx) => {
                  const confColor = mask.score >= 0.8 ? 'text-green-400' : mask.score >= 0.5 ? 'text-yellow-400' : 'text-red-400'
                  const classId = activeClassId ?? classes[0]?.id ?? 0
                  const classColor = classes.find((c) => c.id === classId)?.color ?? '#10B981'

                  return (
                    <div
                      key={idx}
                      className="flex items-center gap-2 px-2 py-1 hover:bg-teal-900/20 border-b border-slate-800 group"
                    >
                      <div className="w-2 h-2 rounded-sm flex-shrink-0" style={{ backgroundColor: classColor }} />
                      <div className="flex-1 min-w-0 text-xs">
                        <span className="text-slate-400">{t('Proposition')} {idx + 1}</span>
                        <span className={`ml-1.5 font-mono ${confColor}`}>{(mask.score * 100).toFixed(0)}%</span>
                        <span className="ml-1 text-slate-600">{mask.polygon.length > 0 ? 'Poly' : 'BBox'}</span>
                      </div>
                      <button
                        onClick={() => void handleValidateMask(mask, idx)}
                        className="p-0.5 text-teal-500 hover:text-teal-300 transition-colors flex-shrink-0"
                        title={t('Valider → ajouter comme annotation')}
                      >
                        <CheckCircle size={13} />
                      </button>
                      <button
                        onClick={() => removeMask(idx)}
                        className="p-0.5 opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-400 transition-all flex-shrink-0"
                        title={t('Rejeter cette proposition')}
                      >
                        <XCircle size={11} />
                      </button>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>
      )}

      {/* Pied de page : actions globales */}
      <div className="flex items-center justify-between px-2 py-1.5 border-t border-slate-700 gap-1">
        <button
          onClick={deselectAll}
          className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
        >
          {t('Désélectionner')}
        </button>

        <span className="text-xs text-slate-600 flex-1 text-center">
          {selectedAnnotationIds.size > 0 ? `${selectedAnnotationIds.size} ${t('sél.')}` : ''}
        </span>

        {/* Supprimer tout */}
        {annotations.length > 0 && (
          confirmDeleteAll ? (
            <div className="flex items-center gap-1">
              <span className="text-xs text-red-400">{t('Confirmer ?')}</span>
              <button
                onClick={() => {
                  setConfirmDeleteAll(false)
                  void onDeleteAllAnnotations()
                }}
                className="text-xs bg-red-700 hover:bg-red-600 text-white px-1.5 py-0.5 rounded transition-colors"
              >
                {t('Oui')}
              </button>
              <button
                onClick={() => setConfirmDeleteAll(false)}
                className="text-xs text-slate-400 hover:text-white transition-colors"
              >
                {t('Non')}
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDeleteAll(true)}
              className="text-xs text-red-500 hover:text-red-400 transition-colors flex items-center gap-0.5"
              title={t('Supprimer toutes les annotations de cette frame')}
            >
              <Trash2 size={11} />
              {t('Tout')}
            </button>
          )
        )}
      </div>
    </div>
  )
}
