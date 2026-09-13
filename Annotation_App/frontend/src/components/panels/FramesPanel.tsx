// ============================================================
// components/panels/FramesPanel.tsx
// Panneau droit : liste des frames avec navigation rapide,
// nombre d'annotations, sélection multiple et suppression.
// Redimensionnable via une poignée sur le bord gauche.
// ============================================================

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Trash2 } from 'lucide-react'
import type { Frame } from '../../types/api'

// Petit composant input pour sauter directement à un numéro de frame
const FrameJumpInput: React.FC<{ total: number; onJump: (index: number) => void }> = ({ total, onJump }) => {
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      const n = parseInt(value)
      if (!isNaN(n) && n >= 0 && n < total) {
        onJump(n)
        setValue('')
        inputRef.current?.blur()
      }
    } else if (e.key === 'Escape') {
      setValue('')
      inputRef.current?.blur()
    }
  }

  return (
    <input
      ref={inputRef}
      type="number"
      min={0}
      max={total - 1}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={handleKeyDown}
      placeholder="N°"
      title={`Aller à la frame (0–${total - 1}), Entrée pour valider`}
      className="w-14 text-xs bg-slate-700 border border-slate-600 focus:border-blue-400 text-white rounded px-1.5 py-0.5 outline-none tabular-nums"
      style={{ MozAppearance: 'textfield' } as React.CSSProperties}
    />
  )
}

interface FramesPanelProps {
  frames: Frame[]
  currentFrameIndex: number
  onFrameSelect: (index: number) => void
  onDeleteAnnotationsForFrames: (frameIndices: number[]) => Promise<void>
  width: number
  onWidthChange: (w: number) => void
}

export const FramesPanel: React.FC<FramesPanelProps> = ({
  frames,
  currentFrameIndex,
  onFrameSelect,
  onDeleteAnnotationsForFrames,
  width,
  onWidthChange,
}) => {
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set())
  const [isDeleting, setIsDeleting] = useState(false)
  const activeItemRef = useRef<HTMLDivElement | null>(null)
  const anchorIndexRef = useRef<number | null>(null)  // Ancre pour sélection intervalle (shift+clic)

  // Scroll automatique vers la frame active
  useEffect(() => {
    activeItemRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [currentFrameIndex])

  // Poignée de redimensionnement — bord gauche
  const handleResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      const startX = e.clientX
      const startWidth = width

      const onMouseMove = (ev: MouseEvent) => {
        const delta = startX - ev.clientX  // glisser à gauche = agrandir
        const newWidth = Math.max(160, Math.min(420, startWidth + delta))
        onWidthChange(newWidth)
      }

      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove)
        document.removeEventListener('mouseup', onMouseUp)
      }

      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mouseup', onMouseUp)
    },
    [width, onWidthChange]
  )

  // Clic sur une frame : sélection simple ou sélection d'intervalle (style explorateur)
  const handleItemClick = useCallback(
    (index: number, shiftKey: boolean) => {
      if (shiftKey && anchorIndexRef.current !== null) {
        // Shift+clic : sélection de la plage entre l'ancre et l'index courant
        const start = Math.min(anchorIndexRef.current, index)
        const end = Math.max(anchorIndexRef.current, index)
        const range = new Set<number>()
        for (let i = start; i <= end; i++) range.add(i)
        setSelectedIndices(range)
      } else {
        // Clic simple : naviguer + effacer sélection + mise à jour ancre
        setSelectedIndices(new Set())
        onFrameSelect(index)
        anchorIndexRef.current = index
      }
    },
    [onFrameSelect]
  )

  // Supprimer les annotations des frames sélectionnées
  const handleDeleteSelected = useCallback(async () => {
    if (selectedIndices.size === 0 || isDeleting) return
    setIsDeleting(true)
    try {
      await onDeleteAnnotationsForFrames([...selectedIndices])
      setSelectedIndices(new Set())
    } finally {
      setIsDeleting(false)
    }
  }, [selectedIndices, isDeleting, onDeleteAnnotationsForFrames])

  // Touche Delete → supprimer annotations des frames sélectionnées
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' || selectedIndices.size === 0) return
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return
      void handleDeleteSelected()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedIndices, handleDeleteSelected])

  return (
    <div
      style={{ width }}
      className="flex-shrink-0 bg-slate-800 border-l border-slate-700 h-full flex flex-col relative"
    >
      {/* Poignée de redimensionnement */}
      <div
        className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500 z-10 transition-colors"
        onMouseDown={handleResizeMouseDown}
      />

      {/* En-tête */}
      <div className="flex items-center gap-1.5 pl-3 pr-2 py-2 border-b border-slate-700 flex-shrink-0">
        <span className="text-xs font-medium text-slate-300 flex-1 min-w-0">
          Frames{' '}
          <span className="text-slate-500 font-normal">({frames.length})</span>
        </span>

        {/* Input saut direct à N° de frame */}
        <FrameJumpInput total={frames.length} onJump={onFrameSelect} />

        {selectedIndices.size > 0 && (
          <button
            onClick={() => void handleDeleteSelected()}
            disabled={isDeleting}
            className="flex items-center gap-1 text-xs text-red-400 hover:text-red-300 px-1.5 py-0.5 rounded bg-red-900/30 hover:bg-red-900/50 disabled:opacity-50 transition-colors flex-shrink-0"
            title={`Supprimer les annotations sur ${selectedIndices.size} frame(s) sélectionnée(s)`}
          >
            <Trash2 size={10} />
            {isDeleting ? '...' : selectedIndices.size}
          </button>
        )}
      </div>

      {/* Liste des frames */}
      <div className="flex-1 overflow-y-auto">
        {frames.map((frame, idx) => {
          const isCurrent = idx === currentFrameIndex
          const isSelected = selectedIndices.has(idx)
          const annotCount = frame.annotation_count ?? 0

          return (
            <div
              key={frame.id}
              ref={isCurrent ? activeItemRef : null}
              onClick={(e) => handleItemClick(idx, e.shiftKey)}
              className={[
                'flex items-center gap-2 px-2 py-1 cursor-pointer border-b border-slate-700/40 select-none transition-colors',
                isCurrent
                  ? 'bg-blue-900/40 border-l-2 border-l-blue-400'
                  : isSelected
                  ? 'bg-purple-900/40'
                  : 'hover:bg-slate-700/40',
              ].join(' ')}
            >
              {/* Pastille verte/rouge selon annotation (plus de miniature) */}
              <div
                className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                  annotCount > 0 ? 'bg-green-400' : 'bg-red-500/70'
                }`}
              />

              {/* Infos frame */}
              <div className="flex-1 min-w-0">
                <div className="text-xs text-slate-300 font-mono leading-tight truncate">
                  F{idx}
                </div>
                {frame.is_empty && (
                  <div className="text-xs text-slate-500 leading-tight">vide</div>
                )}
              </div>

              {/* Badge nombre d'annotations */}
              {annotCount > 0 && (
                <span className="text-xs bg-blue-800/60 text-blue-300 px-1.5 py-0.5 rounded-full flex-shrink-0 font-mono">
                  {annotCount}
                </span>
              )}
            </div>
          )
        })}
      </div>

      {/* Pied : indication sélection multiple */}
      {selectedIndices.size > 0 && (
        <div className="px-3 py-1.5 border-t border-slate-700 flex-shrink-0 text-xs text-slate-500">
          {selectedIndices.size} frame{selectedIndices.size > 1 ? 's' : ''} — Suppr. pour effacer
        </div>
      )}
    </div>
  )
}
