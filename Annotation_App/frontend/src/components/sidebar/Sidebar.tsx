// ============================================================
// components/sidebar/Sidebar.tsx
// Panneau GAUCHE d'annotation — mode Séquence Image (video) uniquement.
// Onglets : Tracks (suivi + console de logs) et Debug (XFeat).
// Classes / Annots / Aide sont dans le panneau DROIT (RightPanel).
// (Anomalies supprimées.)
// ============================================================

import React, { useCallback, useRef, useState } from 'react'
import { Activity, Bug } from 'lucide-react'
import { TrackPanel } from './TrackPanel'
import { XFeatDebugPanel } from './XFeatDebugPanel'
import { useUIStore } from '../../stores/uiStore'
import type { Annotation, Frame, LabelClass, Track, TaskLiveFrameObject } from '../../types/api'
import { useT } from '../../i18n/useLang'

type LeftTab = 'tracks' | 'debug'

const DEFAULT_WIDTH = 256   // px (w-64) — largeur par défaut au lancement (non persistée)
const MIN_WIDTH = 200
const MAX_WIDTH = 620

interface SidebarProps {
  projectId: number
  classes: LabelClass[]
  annotations: Annotation[]
  tracks: Track[]
  currentFrameIndex: number
  currentFrame: Frame | null
  frames: Frame[]
  seqStart?: number
  seqEnd?: number
  onTracksUpdated: () => void
  onPropagationStarted: (taskId: string, label: string) => void
  onFrameSelect: (frameIndex: number) => void
  onForceAnnotationRefresh?: (frameArrIdx: number) => Promise<void>
  onLiveFramePreview?: (frameArrIdx: number, objects: TaskLiveFrameObject[],
                        nativePath?: string | null) => void
}

const TABS: { id: LeftTab; label: string; Icon: React.FC<{ size: number }> }[] = [
  { id: 'tracks', label: 'Tracks', Icon: Activity },
  { id: 'debug', label: 'Debug', Icon: Bug },
]

export const Sidebar: React.FC<SidebarProps> = ({
  projectId,
  classes,
  annotations,
  tracks,
  currentFrameIndex,
  currentFrame,
  frames,
  seqStart,
  seqEnd,
  onTracksUpdated,
  onPropagationStarted,
  onFrameSelect,
  onForceAnnotationRefresh,
  onLiveFramePreview,
}) => {
  const t = useT()
  const { sidebarTab, setSidebarTab } = useUIStore()
  // Le panneau gauche ne gère que 'tracks' | 'debug' ; repli sur 'tracks'.
  const tab: LeftTab = sidebarTab === 'debug' ? 'debug' : 'tracks'

  // Largeur redimensionnable (poignée sur le bord droit), NON persistée.
  const [width, setWidth] = useState(DEFAULT_WIDTH)
  const dragRef = useRef<{ startX: number; startW: number } | null>(null)
  const onResizeDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    dragRef.current = { startX: e.clientX, startW: width }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }, [width])
  const onResizeMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return
    const dx = e.clientX - dragRef.current.startX   // poignée à droite : →  élargit
    setWidth(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, dragRef.current.startW + dx)))
  }, [])
  const onResizeUp = useCallback((e: React.PointerEvent) => {
    dragRef.current = null
    ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
  }, [])

  return (
    <div className="flex h-full flex-shrink-0" style={{ width }}>
      <div data-tour="left-sidebar" className="flex flex-col flex-1 bg-slate-800 border-r border-slate-700 h-full min-w-0">
      <div className="flex border-b border-slate-700">
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => setSidebarTab(id as Parameters<typeof setSidebarTab>[0])}
            data-tour={id === 'tracks' ? 'tab-tracks' : undefined}
            className={`relative flex-1 flex flex-col items-center gap-0.5 py-2 text-xs transition-colors ${
              tab === id ? 'text-blue-400 border-b-2 border-blue-400' : 'text-slate-500 hover:text-slate-300'
            }`}
            title={label}
          >
            <Icon size={14} />
            <span className="hidden sm:block">{label}</span>
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-hidden flex flex-col min-h-0">
        {tab === 'tracks' && (
          <TrackPanel
            projectId={projectId}
            tracks={tracks}
            classes={classes}
            currentFrameIndex={currentFrameIndex}
            currentFrame={currentFrame}
            annotations={annotations}
            frames={frames}
            seqStart={seqStart}
            seqEnd={seqEnd}
            onTracksUpdated={onTracksUpdated}
            onPropagationStarted={onPropagationStarted}
            onFrameNavigate={onFrameSelect}
            onForceAnnotationRefresh={onForceAnnotationRefresh}
            onLiveFramePreview={onLiveFramePreview}
          />
        )}

        {tab === 'debug' && (
          <XFeatDebugPanel
            projectId={projectId}
            currentFrame={currentFrame}
            frames={frames}
            currentFrameIndex={currentFrameIndex}
          />
        )}
      </div>
      </div>

      {/* Poignée de redimensionnement (bord droit) — largeur non sauvegardée */}
      <div
        onPointerDown={onResizeDown}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeUp}
        className="w-1.5 cursor-ew-resize bg-slate-700 hover:bg-blue-500 transition-colors flex-shrink-0"
        title={t('Glisser pour redimensionner (largeur non sauvegardée)')}
      />
    </div>
  )
}
