// ============================================================
// components/timeline/Timeline.tsx
// Timeline virtualisee SANS vignettes : cellules compactes
// vert = frame annotee (avec compteur), rouge = frame vide.
//
// - Fenêtrée sur la SÉQUENCE courante (windowStart / windowCount) : changer de
//   séquence remet à jour frames ET tracks affichés.
// - Bandeau de tracks au-dessus : label (#uid + classe) à gauche, barre segmentée
//   à droite ; zone scrollable verticalement et redimensionnable (hauteur sauvée
//   dans les settings du workspace via onTracksHeightChange).
// - Sélectionner un track (clic) puis Suppr : supprime le track ET ses annotations.
// ============================================================

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Trash2 } from 'lucide-react'
import { TrackLane } from './TrackLane'
import { useAnnotationStore } from '../../stores/annotationStore'
import type { Frame, Track, LabelClass } from '../../types/api'

interface TimelineProps {
  frames: Frame[]
  tracks: Track[]
  classes?: LabelClass[]
  currentFrameIndex: number
  windowStart?: number   // index global de la 1ère frame de la fenêtre (séquence)
  windowCount?: number   // nombre de frames de la fenêtre
  totalFrames?: number
  onFrameSelect: (frameIndex: number) => void
  onDeleteAnnotationsForFrames?: (frameIndices: number[]) => Promise<void>
  onDeleteTrack?: (trackId: number) => Promise<void> | void
  onDeleteTrackBlock?: (trackId: number, startFrame: number, endFrame: number) => Promise<void> | void
  tracksHeight?: number
  onTracksHeightChange?: (h: number) => void
  leftSlot?: React.ReactNode   // badge user + explorateur workspace (bas-gauche, S8)
}

const CELL_WIDTH = 34
const CELL_HEIGHT = 34
const GAP = 2
const ITEM_WIDTH = CELL_WIDTH + GAP
const OVERSCAN = 8
const TRACKS_MIN_H = 44
const TRACKS_MAX_H = 360

export const Timeline: React.FC<TimelineProps> = ({
  frames,
  tracks,
  classes,
  currentFrameIndex,
  windowStart,
  windowCount,
  totalFrames: totalFramesProp,
  onFrameSelect,
  onDeleteAnnotationsForFrames,
  onDeleteTrack,
  onDeleteTrackBlock,
  tracksHeight,
  onTracksHeightChange,
  leftSlot,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null)
  const anchorIndexRef = useRef<number | null>(null)
  const isHoveredRef = useRef(false)
  const [scrollLeft, setScrollLeft] = useState(0)
  const [viewportWidth, setViewportWidth] = useState(1)
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set())
  // Pistes sélectionnées (multi via Ctrl/Shift, S5). Set → suppression multiple.
  const [selectedTrackIds, setSelectedTrackIds] = useState<Set<number>>(new Set())
  const lastTrackAnchorRef = useRef<number | null>(null)
  // Bloc (segment) sélectionné : { trackId, s, e } — mutuellement exclusif avec la piste
  const [selectedBlock, setSelectedBlock] = useState<{ trackId: number; s: number; e: number } | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  const liveFrameId = useAnnotationStore((s) => s.currentFrameId)
  const liveCount = useAnnotationStore((s) => s.annotations.length)

  const projectTotal = Math.max(totalFramesProp ?? frames.length, frames.length)
  // Fenêtre = séquence courante (par défaut, tout le projet)
  const winStart = windowStart ?? 0
  const winCount = windowCount ?? projectTotal
  const winEnd = winStart + winCount  // exclusif

  // Résolution du label classe/sous/sous-sous par track
  const classById = useMemo(() => {
    const m = new Map<number, LabelClass>()
    for (const c of classes ?? []) m.set(c.id, c)
    return m
  }, [classes])
  const trackLabel = useCallback((t: Track): string => {
    const c = classById.get(t.class_id)
    if (!c) return `cls_${t.class_id}`
    return [c.name, c.subclass, c.subsubclass].filter(Boolean).join(' › ')
  }, [classById])

  // Tracks visibles = ceux qui chevauchent la fenêtre de la séquence
  const visibleTracks = useMemo(
    () => tracks.filter((t) => t.end_frame >= winStart && t.start_frame < winEnd),
    [tracks, winStart, winEnd],
  )

  // Sélectionner une (ou plusieurs) piste(s) — Ctrl = toggle, Shift = plage, sinon unique.
  // Efface la sélection de bloc, et inversement. (S5)
  const selectTrack = useCallback((trackId: number, e?: React.MouseEvent) => {
    setSelectedBlock(null)
    setSelectedTrackIds((prev) => {
      const next = new Set(prev)
      if (e && (e.ctrlKey || e.metaKey)) {
        if (next.has(trackId)) next.delete(trackId); else next.add(trackId)
      } else if (e && e.shiftKey && lastTrackAnchorRef.current != null) {
        const ids = visibleTracks.map((t) => t.id)
        const a = ids.indexOf(lastTrackAnchorRef.current)
        const b = ids.indexOf(trackId)
        if (a >= 0 && b >= 0) {
          for (let i = Math.min(a, b); i <= Math.max(a, b); i++) next.add(ids[i])
        } else next.add(trackId)
      } else {
        next.clear(); next.add(trackId)
      }
      return next
    })
    lastTrackAnchorRef.current = trackId
  }, [visibleTracks])
  const selectBlock = useCallback((trackId: number, s: number, e: number) => {
    setSelectedBlock({ trackId, s, e })
    setSelectedTrackIds(new Set())
  }, [])

  // Réinitialiser la sélection (track ou bloc) si elle disparaît (changement séquence/suppression)
  useEffect(() => {
    setSelectedTrackIds((prev) => {
      const visible = new Set(visibleTracks.map((t) => t.id))
      const next = new Set([...prev].filter((id) => visible.has(id)))
      return next.size === prev.size ? prev : next
    })
    if (selectedBlock != null && !visibleTracks.some((t) => t.id === selectedBlock.trackId)) {
      setSelectedBlock(null)
    }
  }, [visibleTracks, selectedBlock])

  // ---- Redimensionnement de la zone tracks (drag du handle) ----
  const [dragH, setDragH] = useState<number | null>(null)
  const effectiveTracksH = dragH ?? tracksHeight ?? 92
  const resizeRef = useRef<{ startY: number; startH: number } | null>(null)
  const onResizeDown = (e: React.PointerEvent) => {
    e.preventDefault()
    resizeRef.current = { startY: e.clientY, startH: effectiveTracksH }
    // currentTarget (le handle) et non target (qui peut être la petite poignée enfant)
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onResizeMove = (e: React.PointerEvent) => {
    if (!resizeRef.current) return
    // Poignée en HAUT du panneau : glisser vers le haut (clientY diminue) agrandit.
    const dy = resizeRef.current.startY - e.clientY
    const h = Math.max(TRACKS_MIN_H, Math.min(TRACKS_MAX_H, resizeRef.current.startH + dy))
    setDragH(h)
  }
  const onResizeUp = (e: React.PointerEvent) => {
    if (!resizeRef.current) return
    const final = effectiveTracksH
    resizeRef.current = null
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* déjà relâché */ }
    setDragH(null)
    onTracksHeightChange?.(final)
  }

  useEffect(() => {
    const container = scrollRef.current
    if (!container) return
    const sync = () => {
      setScrollLeft(container.scrollLeft)
      setViewportWidth(container.clientWidth || 1)
    }
    sync()
    const resizeObserver = new ResizeObserver(sync)
    resizeObserver.observe(container)
    container.addEventListener('scroll', sync, { passive: true })
    return () => {
      resizeObserver.disconnect()
      container.removeEventListener('scroll', sync)
    }
  }, [])

  useEffect(() => {
    const container = scrollRef.current
    if (!container) return
    const local = currentFrameIndex - winStart
    const targetScroll = local * ITEM_WIDTH - container.clientWidth / 2 + CELL_WIDTH / 2
    container.scrollTo({ left: Math.max(0, targetScroll), behavior: 'auto' })
  }, [currentFrameIndex, winStart])

  const deleteSelectedTrack = useCallback(() => {
    if (selectedTrackIds.size === 0 || !onDeleteTrack || isDeleting) return
    const ids = [...selectedTrackIds]
    const sel = tracks.filter((tk) => selectedTrackIds.has(tk.id))
    if (sel.length === 0) return
    const label = sel.length === 1
      ? `le track #${sel[0].track_uid} (${trackLabel(sel[0])})`
      : `${sel.length} pistes (#${sel.map((t) => t.track_uid).join(', #')})`
    const ok = window.confirm(
      `Supprimer ${label} ?\n\n` +
      `⚠ Cette action supprime AUSSI toutes les annotations liées. Irréversible.`,
    )
    if (!ok) return
    setIsDeleting(true)
    // Suppression séquentielle (la renumérotation des uids se fait à chaque delete).
    ;(async () => {
      for (const id of ids) { await Promise.resolve(onDeleteTrack(id)) }
    })()
      .then(() => setSelectedTrackIds(new Set()))
      .finally(() => setIsDeleting(false))
  }, [selectedTrackIds, onDeleteTrack, isDeleting, tracks, trackLabel])

  const deleteSelectedBlock = useCallback(() => {
    if (selectedBlock == null || !onDeleteTrackBlock || isDeleting) return
    const { trackId, s, e } = selectedBlock
    setIsDeleting(true)
    Promise.resolve(onDeleteTrackBlock(trackId, s, e))
      .then(() => setSelectedBlock(null))
      .finally(() => setIsDeleting(false))
  }, [selectedBlock, onDeleteTrackBlock, isDeleting])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const el = document.activeElement
      const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || (el as HTMLElement).isContentEditable)
      if (typing) return

      if ((event.ctrlKey || event.metaKey) && (event.key === 'a' || event.key === 'A')) {
        if (!isHoveredRef.current) return
        event.preventDefault()
        setSelectedIndices(new Set(Array.from({ length: winCount }, (_, i) => winStart + i)))
        return
      }

      if (event.key === 'Escape') {
        if (selectedIndices.size > 0) setSelectedIndices(new Set())
        if (selectedTrackIds.size > 0) setSelectedTrackIds(new Set())
        if (selectedBlock != null) setSelectedBlock(null)
        return
      }

      if (event.key !== 'Delete' && event.key !== 'Backspace') return

      // Priorité 1 : un BLOC sélectionné → suppression de ce bloc uniquement
      if (selectedBlock != null && isHoveredRef.current) {
        event.preventDefault()
        deleteSelectedBlock()
        return
      }

      // Priorité 2 : une ou plusieurs pistes sélectionnées → suppression track + annots
      if (selectedTrackIds.size > 0 && isHoveredRef.current) {
        event.preventDefault()
        deleteSelectedTrack()
        return
      }

      if (!onDeleteAnnotationsForFrames || selectedIndices.size === 0 || isDeleting) return
      event.preventDefault()
      const targets = [...selectedIndices].sort((a, b) => a - b)
      setIsDeleting(true)
      void onDeleteAnnotationsForFrames(targets)
        .then(() => setSelectedIndices(new Set()))
        .finally(() => setIsDeleting(false))
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isDeleting, onDeleteAnnotationsForFrames, selectedIndices, selectedTrackIds, selectedBlock, deleteSelectedTrack, deleteSelectedBlock, winCount, winStart])

  const handlePrev = useCallback(() => {
    if (currentFrameIndex > winStart) onFrameSelect(currentFrameIndex - 1)
  }, [currentFrameIndex, onFrameSelect, winStart])

  const handleNext = useCallback(() => {
    if (currentFrameIndex < winEnd - 1) onFrameSelect(currentFrameIndex + 1)
  }, [currentFrameIndex, onFrameSelect, winEnd])

  const visibleRange = useMemo(() => {
    const start = Math.max(0, Math.floor(scrollLeft / ITEM_WIDTH) - OVERSCAN)
    const visibleCount = Math.ceil(viewportWidth / ITEM_WIDTH) + OVERSCAN * 2
    const end = Math.min(winCount, start + visibleCount)
    return { start, end }
  }, [scrollLeft, winCount, viewportWidth])

  const handleFrameClick = useCallback((event: React.MouseEvent, idx: number) => {
    if (event.shiftKey) {
      const anchor = anchorIndexRef.current ?? currentFrameIndex
      const from = Math.min(anchor, idx)
      const to = Math.max(anchor, idx)
      const next = new Set(selectedIndices)
      for (let i = from; i <= to; i += 1) next.add(i)
      setSelectedIndices(next)
      return
    }
    if (event.ctrlKey || event.metaKey) {
      const next = new Set(selectedIndices)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      setSelectedIndices(next)
      anchorIndexRef.current = idx
      return
    }
    setSelectedIndices(new Set())
    anchorIndexRef.current = idx
    onFrameSelect(idx)
  }, [currentFrameIndex, onFrameSelect, selectedIndices])

  const framesByIndex = useMemo(() => {
    const map = new Map<number, Frame>()
    for (const frame of frames) map.set(frame.frame_index, frame)
    return map
  }, [frames])

  if (winCount === 0) return null

  const selectAll = () => setSelectedIndices(new Set(Array.from({ length: winCount }, (_, i) => winStart + i)))

  return (
    <div
      data-tour="timeline"
      className="flex flex-col bg-slate-900 border-t border-slate-700 select-none"
      onMouseEnter={() => { isHoveredRef.current = true }}
      onMouseLeave={() => { isHoveredRef.current = false }}
    >
      {/* Poignée de redimensionnement — sur la grande barre qui sépare le canvas du
          panneau timeline. Glisser vers le HAUT agrandit la zone des tracks. (S1) */}
      {visibleTracks.length > 0 && (
        <div
          onPointerDown={onResizeDown}
          onPointerMove={onResizeMove}
          onPointerUp={onResizeUp}
          className="group h-2 -mt-px cursor-ns-resize bg-slate-800 hover:bg-blue-600/50 transition-colors flex items-center justify-center flex-shrink-0"
          title="Glisser (haut/bas) pour agrandir / réduire la zone des tracks"
        >
          <div className="w-12 h-0.5 rounded-full bg-slate-600 group-hover:bg-blue-300 transition-colors" />
        </div>
      )}
      {visibleTracks.length > 0 && (
        <>
          <div className="flex items-center justify-between px-3 pt-1">
            <span className="text-[10px] text-slate-500">
              {visibleTracks.length} track{visibleTracks.length > 1 ? 's' : ''}
              {selectedBlock != null ? (
                <span className="text-amber-300"> · bloc #{tracks.find((t) => t.id === selectedBlock.trackId)?.track_uid} [{selectedBlock.s}–{selectedBlock.e}] — Suppr efface CE bloc</span>
              ) : selectedTrackIds.size > 0 ? (
                <span className="text-amber-300"> · {selectedTrackIds.size} piste{selectedTrackIds.size > 1 ? 's' : ''} sélectionnée{selectedTrackIds.size > 1 ? 's' : ''} (Ctrl/Shift + clic) — Suppr efface</span>
              ) : (
                <span className="text-slate-600"> · clic = piste · Ctrl/Shift+clic = plusieurs · clic sur un bloc = ce bloc</span>
              )}
            </span>
            {selectedBlock != null && onDeleteTrackBlock ? (
              <button
                onClick={deleteSelectedBlock}
                disabled={isDeleting}
                className="flex items-center gap-1 text-[10px] text-amber-400 hover:text-amber-300 disabled:opacity-50"
                title="Supprimer uniquement ce bloc (annotations de la piste sur cette plage)"
              >
                <Trash2 size={11} /> Supprimer ce bloc
              </button>
            ) : selectedTrackIds.size > 0 && onDeleteTrack ? (
              <button
                onClick={deleteSelectedTrack}
                disabled={isDeleting}
                className="flex items-center gap-1 text-[10px] text-red-400 hover:text-red-300 disabled:opacity-50"
                title="Supprimer la (les) piste(s) sélectionnée(s) et leurs annotations"
              >
                <Trash2 size={11} /> Supprimer {selectedTrackIds.size > 1 ? `${selectedTrackIds.size} pistes` : 'la piste'}
              </button>
            ) : null}
          </div>
          <div
            data-tour="timeline-tracks"
            className="px-3 py-1 space-y-1 overflow-y-auto border-b border-slate-800"
            style={{ height: effectiveTracksH }}
          >
            {visibleTracks.map((track) => (
              <TrackLane
                key={track.id}
                track={track}
                windowStart={winStart}
                windowCount={winCount}
                currentFrameIndex={currentFrameIndex}
                label={trackLabel(track)}
                selected={selectedTrackIds.has(track.id)}
                selectedBlock={selectedBlock?.trackId === track.id ? [selectedBlock.s, selectedBlock.e] : null}
                onSelectTrack={(e) => selectTrack(track.id, e)}
                onSelectBlock={(s, e) => selectBlock(track.id, s, e)}
                onFrameClick={onFrameSelect}
              />
            ))}
          </div>
        </>
      )}

      <div className="flex items-center h-12">
        <button
          onClick={handlePrev}
          disabled={currentFrameIndex <= winStart}
          className="flex-shrink-0 w-8 h-full flex items-center justify-center text-slate-500 hover:text-slate-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <ChevronLeft size={16} />
        </button>

        <div
          ref={scrollRef}
          className="flex-1 overflow-x-auto overflow-y-hidden scrollbar-none"
          style={{ scrollbarWidth: 'none' }}
        >
          <div
            className="relative py-1"
            style={{ width: `${winCount * ITEM_WIDTH}px`, height: CELL_HEIGHT + 8 }}
          >
            {Array.from({ length: visibleRange.end - visibleRange.start }, (_, offset) => {
              const local = visibleRange.start + offset
              const idx = winStart + local
              const frame = framesByIndex.get(idx)
              const isActive = idx === currentFrameIndex
              const isSelected = selectedIndices.has(idx)
              const annotationCount =
                frame && frame.id === liveFrameId
                  ? liveCount
                  : frame?.annotation_count ?? (frame?.is_annotated ? 1 : 0)
              const hasAnnotations = annotationCount > 0
              return (
                <button
                  key={frame?.id ?? `idx-${idx}`}
                  onClick={(event) => handleFrameClick(event, idx)}
                  className={`absolute top-1 rounded border flex flex-col items-center justify-center transition-colors ${
                    hasAnnotations
                      ? 'bg-green-900/50 hover:bg-green-800/60'
                      : 'bg-red-950/40 hover:bg-red-900/40'
                  } ${
                    isSelected
                      ? 'border-amber-300 ring-1 ring-amber-300/70'
                      : isActive
                      ? 'border-blue-400 ring-1 ring-blue-400/60'
                      : hasAnnotations
                      ? 'border-green-700/60'
                      : 'border-red-900/50'
                  }`}
                  style={{ left: local * ITEM_WIDTH, width: CELL_WIDTH, height: CELL_HEIGHT }}
                  title={`Frame ${local} (séquence) — ${annotationCount} annotation${annotationCount !== 1 ? 's' : ''}. Ctrl/clic selection, Shift/clic plage, Suppr efface les annotations selectionnees.`}
                >
                  <span
                    className={`leading-none font-mono ${isActive ? 'text-blue-300' : 'text-slate-500'}`}
                    style={{ fontSize: 8 }}
                  >
                    {local}
                  </span>
                  <span
                    className={`leading-none font-semibold mt-0.5 ${
                      hasAnnotations ? 'text-green-300' : 'text-red-400/80'
                    }`}
                    style={{ fontSize: 11 }}
                  >
                    {annotationCount}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        <button
          onClick={handleNext}
          disabled={currentFrameIndex >= winEnd - 1}
          className="flex-shrink-0 w-8 h-full flex items-center justify-center text-slate-500 hover:text-slate-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      <div className="pl-2 pr-10 pb-1.5 flex items-center gap-2 text-xs text-slate-600">
        {/* Badge user + explorateur workspace (bas-gauche) — S8 */}
        {leftSlot && <div className="flex-shrink-0 max-w-[220px] min-w-0 mr-2">{leftSlot}</div>}
        <div className="flex-1 flex items-center justify-center gap-2 min-w-0">
        <span>Frame {currentFrameIndex - winStart + 1} / {winCount}</span>
        <button
          onClick={selectAll}
          className="text-slate-500 hover:text-amber-300 transition-colors"
          title="Sélectionner toutes les frames de la séquence (Ctrl+A quand la timeline est survolée)"
        >
          · Tout sélectionner
        </button>
        {selectedIndices.size > 0 && (
          <>
            <span className="text-amber-300">
              {selectedIndices.size} sélectionnée{selectedIndices.size > 1 ? 's' : ''}
              {isDeleting ? ' — suppression…' : ', Suppr pour vider'}
            </span>
            <button
              onClick={() => setSelectedIndices(new Set())}
              className="text-slate-500 hover:text-slate-300 transition-colors"
            >
              (annuler)
            </button>
          </>
        )}
        </div>
      </div>
    </div>
  )
}
