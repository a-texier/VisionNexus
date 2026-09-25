// ============================================================
// components/timeline/TrackLane.tsx
// Une ligne de track dans la timeline :
//   [ #uid + classe/sous/sous-sous ]  |  [ barre segmentée ]
//
// La barre est relative à la FENÊTRE affichée (séquence courante) :
//   - segments RÉELS (objet trouvé) = blocs colorés,
//   - plage explorée SANS détection = bande grise (passé dessus, rien vu),
//   - hors plage explorée = rail vide (pas encore exploré).
// Clic sur un BLOC (segment coloré) = sélectionne ce bloc (glow) + va à son
//   début ; double-clic = va à sa fin. Suppr efface UNIQUEMENT ce bloc.
// Clic sur le gris (bande explorée / rail) = sélectionne toute la piste ;
//   Suppr (ou bouton global) efface toute la piste.
// ============================================================

import React from 'react'
import { useT } from '../../i18n/useLang'
import type { Track } from '../../types/api'

interface TrackLaneProps {
  track: Track
  windowStart: number
  windowCount: number
  currentFrameIndex: number
  label: string
  selected: boolean                          // cette piste est sélectionnée
  selectedBlock: [number, number] | null     // bloc sélectionné sur CETTE piste
  onSelectTrack: (e: React.MouseEvent) => void  // clic gris/label → piste (Ctrl/Shift = multi)
  onSelectBlock: (s: number, e: number) => void
  onFrameClick: (frameIndex: number) => void
}

const LABEL_WIDTH = 150

export const TrackLane: React.FC<TrackLaneProps> = ({
  track,
  windowStart,
  windowCount,
  currentFrameIndex,
  label,
  selected,
  selectedBlock,
  onSelectTrack,
  onSelectBlock,
  onFrameClick,
}) => {
  const t = useT()
  if (windowCount <= 0) return null

  // Position en % relative à la fenêtre (séquence). Bornée à [0, 100].
  const pct = (x: number) => {
    const p = ((x - windowStart) / windowCount) * 100
    return Math.max(0, Math.min(100, p))
  }

  // Segments réels (repli sur la plage explorée si l'API ne les fournit pas).
  const segments: [number, number][] =
    track.segments && track.segments.length > 0
      ? track.segments
      : [[track.start_frame, track.end_frame]]

  const exploredLeft = pct(track.start_frame)
  const exploredWidth = pct(track.end_frame + 1) - exploredLeft

  const winEnd = windowStart + windowCount
  const activeInWindow =
    currentFrameIndex >= windowStart && currentFrameIndex < winEnd
  const isActive = track.start_frame <= currentFrameIndex && track.end_frame >= currentFrameIndex

  // % de frames de la séquence courante déjà explorées par le tracker sur cette piste
  const exploredFrames = Math.max(
    0,
    Math.min(track.end_frame, winEnd - 1) - Math.max(track.start_frame, windowStart) + 1,
  )
  const donePct = windowCount > 0 ? Math.round((exploredFrames / windowCount) * 100) : 0

  return (
    <div
      className={`flex items-center gap-1.5 rounded cursor-pointer ${selected ? 'ring-1 ring-amber-300 bg-amber-400/5' : ''}`}
      onClick={(e) => onSelectTrack(e)}
      title={t('Clic = sélectionner la piste · Ctrl/Shift+clic = plusieurs (Suppr efface)')}
    >
      {/* Colonne label : #uid (gros) + classe/sous/sous-sous (petit) */}
      <div className="flex items-center gap-1 flex-shrink-0" style={{ width: LABEL_WIDTH }}>
        <span
          className="w-2 h-2 rounded-full flex-shrink-0"
          style={{ backgroundColor: track.color }}
        />
        <span
          className="font-bold font-mono text-[13px] leading-none flex-shrink-0"
          style={{ color: track.color }}
          title={`Track #${track.track_uid}`}
        >
          #{track.track_uid}
        </span>
        <span className="text-[9px] text-slate-400 leading-none truncate" title={label}>
          {label}
        </span>
      </div>

      {/* Barre segmentée */}
      <div
        className="relative h-3.5 flex-1 group cursor-pointer"
        title={`Track #${track.track_uid} — ${t('exploré')} ${track.start_frame}–${track.end_frame}, ${segments.length} ${t('bloc(s) détecté(s).')}`}
      >
        {/* Rail de fond (non exploré = normal) */}
        <div className="absolute inset-0 bg-slate-800 rounded" />

        {/* Plage explorée : bande grise = "passé dessus" (les trous restent gris).
            Plus marquée (le tracker est passé là mais n'a rien trouvé). */}
        {exploredWidth > 0 && (
          <div
            className="absolute top-0 h-full bg-slate-400/45 border-y border-slate-300/25 rounded"
            style={{ left: `${exploredLeft}%`, width: `${exploredWidth}%` }}
          />
        )}

        {/* Segments réels détectés = blocs colorés (cliquables, avec glow si sélectionné) */}
        {segments.map(([s, e], i) => {
          const left = pct(s)
          const width = pct(e + 1) - left
          if (width <= 0) return null
          const isSelBlock = !!selectedBlock && selectedBlock[0] === s && selectedBlock[1] === e
          return (
            <div
              key={i}
              className={`absolute top-0 h-full rounded transition-all cursor-pointer ${
                isSelBlock
                  ? 'opacity-100 ring-2 ring-amber-300 shadow-[0_0_8px_rgba(252,211,77,0.7)] z-10'
                  : isActive
                  ? 'opacity-100 hover:ring-1 hover:ring-white/50'
                  : 'opacity-70 group-hover:opacity-90 hover:ring-1 hover:ring-white/50'
              }`}
              style={{ left: `${left}%`, width: `${width}%`, backgroundColor: track.color, minWidth: '2px' }}
              onClick={(ev) => { ev.stopPropagation(); onSelectBlock(s, e); onFrameClick(s) }}
              onDoubleClick={(ev) => { ev.stopPropagation(); onSelectBlock(s, e); onFrameClick(e) }}
              title={`${t('Bloc')} ${s}–${e} — ${t('clic pour sélectionner (Suppr efface CE bloc uniquement)')}`}
            />
          )
        })}

        {/* Barre blanche de la frame courante — sur CHAQUE piste, TOUJOURS au-dessus
            du bloc sélectionné (z-20 > z-10 du glow), jamais cachée dessous. */}
        {activeInWindow && (
          <div
            className={`absolute -top-0.5 w-0.5 pointer-events-none z-20 ${isActive ? 'bg-white' : 'bg-white/80'}`}
            style={{ left: `${pct(currentFrameIndex)}%`, height: 'calc(100% + 4px)' }}
          />
        )}
      </div>

      {/* % de frames explorées par le tracker sur cette piste (ex : 10/100 → 10%) */}
      <span
        className="text-[9px] font-mono text-slate-400 w-8 text-right flex-shrink-0"
        title={`${exploredFrames}/${windowCount} ${t('frames explorées')}`}
      >
        {donePct}%
      </span>
    </div>
  )
}
