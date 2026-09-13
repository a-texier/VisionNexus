// ============================================================
// components/sidebar/RightPanel.tsx
// Panneau DROIT (au-dessus de la zone canvas) : Classes, Annots, Aide.
// Même thème que la sidebar gauche. Largeur redimensionnable à la souris
// (poignée sur le bord gauche) — NON persistée : revient au défaut à chaque
// relancement (state local uniquement).
// ============================================================

import React, { useCallback, useRef, useState } from 'react'
import { Tag, List, HelpCircle } from 'lucide-react'
import { LabelManager } from './LabelManager'
import { AnnotationList } from './AnnotationList'
import { HelpPanel } from './HelpPanel'
import type { Annotation, LabelClass, Track } from '../../types/api'

type RightTab = 'classes' | 'annotations' | 'help'

const TABS: { id: RightTab; label: string; Icon: React.FC<{ size: number }> }[] = [
  { id: 'classes', label: 'Classes', Icon: Tag },
  { id: 'annotations', label: 'Annots', Icon: List },
  { id: 'help', label: 'Aide', Icon: HelpCircle },
]

const DEFAULT_WIDTH = 288   // px (≈ w-72) — largeur par défaut au lancement
const MIN_WIDTH = 220
const MAX_WIDTH = 560

interface RightPanelProps {
  classes: LabelClass[]
  annotations: Annotation[]
  tracks: Track[]
  onCreateClass: (name: string, color: string, subclass?: string, subsubclass?: string) => Promise<void>
  onUpdateClass: (id: number, name: string, color: string, subclass?: string, subsubclass?: string) => Promise<void>
  onDeleteClass: (id: number) => Promise<void>
  onDeleteAnnotation: (id: number) => Promise<void>
  onDeleteAllAnnotations: () => Promise<void>
  onApplyNMS: (iouThreshold: number) => Promise<void>
  onAssignTrack?: (annotationId: number, action: 'new' | 'assign' | 'detach', trackId?: number) => Promise<void>
}

export const RightPanel: React.FC<RightPanelProps> = ({
  classes,
  annotations,
  tracks,
  onCreateClass,
  onUpdateClass,
  onDeleteClass,
  onDeleteAnnotation,
  onDeleteAllAnnotations,
  onApplyNMS,
  onAssignTrack,
}) => {
  const [tab, setTab] = useState<RightTab>('classes')
  const [width, setWidth] = useState(DEFAULT_WIDTH)   // non persisté → défaut à chaque relaunch
  const dragRef = useRef<{ startX: number; startW: number } | null>(null)

  const onResizeDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    dragRef.current = { startX: e.clientX, startW: width }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }, [width])
  const onResizeMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return
    // Poignée à gauche : glisser vers la gauche élargit le panneau.
    const dx = dragRef.current.startX - e.clientX
    setWidth(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, dragRef.current.startW + dx)))
  }, [])
  const onResizeUp = useCallback((e: React.PointerEvent) => {
    dragRef.current = null
    ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
  }, [])

  return (
    <div className="relative flex h-full flex-shrink-0" style={{ width }}>
      {/* Poignée de redimensionnement (bord gauche) */}
      <div
        onPointerDown={onResizeDown}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeUp}
        className="w-1.5 cursor-ew-resize bg-slate-700 hover:bg-blue-500 transition-colors flex-shrink-0"
        title="Glisser pour redimensionner (largeur non sauvegardée)"
      />

      <div data-tour="right-panel" className="flex flex-col flex-1 bg-slate-800 border-l border-slate-700 h-full min-w-0">
        <div className="flex border-b border-slate-700">
          {TABS.map(({ id, label, Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              data-tour={id === 'classes' ? 'tab-classes' : undefined}
              className={`flex-1 flex flex-col items-center gap-0.5 py-2 text-xs transition-colors ${
                tab === id ? 'text-blue-400 border-b-2 border-blue-400' : 'text-slate-500 hover:text-slate-300'
              }`}
              title={label}
            >
              <Icon size={14} />
              <span>{label}</span>
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-hidden flex flex-col min-h-0">
          {tab === 'classes' && (
            <LabelManager
              classes={classes}
              onCreateClass={onCreateClass}
              onUpdateClass={onUpdateClass}
              onDeleteClass={onDeleteClass}
            />
          )}
          {tab === 'annotations' && (
            <AnnotationList
              annotations={annotations}
              classes={classes}
              tracks={tracks}
              onDeleteAnnotation={onDeleteAnnotation}
              onDeleteAllAnnotations={onDeleteAllAnnotations}
              onApplyNMS={onApplyNMS}
              onAssignTrack={onAssignTrack}
            />
          )}
          {tab === 'help' && <HelpPanel />}
        </div>
      </div>
    </div>
  )
}
