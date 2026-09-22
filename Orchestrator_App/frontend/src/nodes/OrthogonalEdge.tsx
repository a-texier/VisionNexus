// ============================================================
// nodes/OrthogonalEdge.tsx — arête unique « Blueprint style » utilisée pour
// TOUTES les connexions (remplace le fallback smoothstep + l'ancien
// DetourEdge). Tracé orthogonal (voir routing.ts) recalculé automatiquement
// tant que l'arête n'a pas été éditée à la main ; dès qu'un waypoint est
// glissé/ajouté, l'arête passe en routeMode='manual' et garde son tracé.
import { useCallback, useRef } from 'react'
import { BaseEdge, EdgeLabelRenderer, useReactFlow, type EdgeProps } from '@xyflow/react'
import {
  buildPoints, svgPathFromPoints, stableLabelAnchor, nearestSegment,
  CORNER_RADIUS, type Point, type RouteMode,
} from './routing'

interface RouteHint { mode: RouteMode; corridorY?: number }

export default function OrthogonalEdge({
  id, sourceX, sourceY, targetX, targetY, data, markerEnd, style, selected,
  label, labelStyle, labelBgStyle, labelBgPadding, labelBgBorderRadius,
}: EdgeProps) {
  const { setEdges, screenToFlowPosition } = useReactFlow()
  const draggingIndex = useRef<number | null>(null)

  const hint = data?.routeHint as RouteHint | undefined
  const isManual = data?.routeMode === 'manual'
  const savedWaypoints = data?.waypoints as Point[] | undefined

  const points: Point[] = isManual && savedWaypoints
    ? [{ x: sourceX, y: sourceY }, ...savedWaypoints, { x: targetX, y: targetY }]
    : buildPoints(hint?.mode ?? 'zbend', hint?.corridorY, sourceX, sourceY, targetX, targetY)
  const interior = points.slice(1, -1)

  const path = svgPathFromPoints(points, CORNER_RADIUS)
  // Position du label DÉCOUPLÉE du tracé routé (voir stableLabelAnchor) : ne
  // dépend que des 4 coordonnées de port de cette arête + son adjacence i→i+1
  // + son propre texte (anti-chevauchement avec les deux nodes), jamais des
  // obstacles/mode qui, eux, peuvent changer à chaque frame de drag — SAUF en
  // mode couloir (câble qui saute au-dessus d'un node intermédiaire), où le
  // label DOIT suivre `corridorY` sous peine de rester flottant loin du trait
  // réel (cf. commentaire dans routing.ts). Pas de couloir en mode manuel :
  // l'utilisateur a fixé ses propres waypoints, la forme "couloir" ne s'applique
  // plus forcément.
  const corridorY = !isManual && hint?.mode === 'corridor' ? hint.corridorY : undefined
  const anchor = stableLabelAnchor(!!data?.labelAdjacent, sourceX, sourceY, targetX, targetY, typeof label === 'string' ? label : '', corridorY)

  // Applique un nouveau tableau de waypoints intermédiaires à CETTE arête et
  // la fige en mode manuel (le tracé auto ne sera plus recalculé au render).
  const applyWaypoints = useCallback((next: Point[]) => {
    setEdges(es => es.map(e => e.id === id
      ? { ...e, data: { ...e.data, waypoints: next, routeMode: 'manual' } }
      : e))
  }, [id, setEdges])

  const handlePointerDown = useCallback((index: number) => (e: React.PointerEvent<SVGCircleElement>) => {
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    draggingIndex.current = index
  }, [])

  const handlePointerMove = useCallback((e: React.PointerEvent<SVGCircleElement>) => {
    if (draggingIndex.current === null) return
    const p = screenToFlowPosition({ x: e.clientX, y: e.clientY })
    const next = interior.slice()
    next[draggingIndex.current] = p
    applyWaypoints(next)
  }, [interior, screenToFlowPosition, applyWaypoints])

  const handlePointerUp = useCallback((e: React.PointerEvent<SVGCircleElement>) => {
    draggingIndex.current = null
    e.currentTarget.releasePointerCapture(e.pointerId)
  }, [])

  const removeWaypoint = useCallback((index: number) => (e: React.MouseEvent) => {
    e.stopPropagation()
    applyWaypoints(interior.filter((_, i) => i !== index))
  }, [interior, applyWaypoints])

  const addWaypoint = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    const click = screenToFlowPosition({ x: e.clientX, y: e.clientY })
    const { index, point } = nearestSegment(points, click)
    applyWaypoints([...interior.slice(0, index), point, ...interior.slice(index)])
  }, [points, interior, screenToFlowPosition, applyWaypoints])

  const resetAuto = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    setEdges(es => es.map(e2 => e2.id === id
      ? { ...e2, data: { ...e2.data, routeMode: 'auto', waypoints: undefined } }
      : e2))
  }, [id, setEdges])

  const [padX, padY] = (labelBgPadding as [number, number] | undefined) ?? [6, 3]
  const _txt = labelStyle as { fill?: string } | undefined
  const _bg = labelBgStyle as { fill?: string; stroke?: string; strokeWidth?: number } | undefined
  const stroke = (style as { stroke?: string } | undefined)?.stroke ?? '#6366f1'

  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />
      {/* Piste de survol élargie et invisible : double-clic = ajoute un waypoint. */}
      <path
        d={path} fill="none" stroke="transparent" strokeWidth={14}
        style={{ pointerEvents: 'stroke', cursor: 'crosshair' }}
        onDoubleClick={addWaypoint}
      />
      {selected && interior.map((p, i) => (
        <circle
          key={i} cx={p.x} cy={p.y} r={4.5}
          fill="#0f172a" stroke={stroke} strokeWidth={2}
          style={{ cursor: 'grab', pointerEvents: 'all' }}
          onPointerDown={handlePointerDown(i)}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onDoubleClick={removeWaypoint(i)}
        >
          <title>Glisser pour déplacer · double-clic pour supprimer</title>
        </circle>
      ))}
      {label != null && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${anchor.x}px, ${anchor.y}px)`,
              pointerEvents: 'all',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: `${padY}px ${padX}px`,
              borderRadius: (labelBgBorderRadius as number | undefined) ?? 4,
              fontSize: 10,
              fontWeight: 600,
              color: _txt?.fill ?? '#94a3b8',
              background: _bg?.fill ?? '#0f172a',
              border: _bg?.stroke ? `${_bg.strokeWidth ?? 1}px solid ${_bg.stroke}` : undefined,
            }}
            className="nodrag nopan"
          >
            <span>{label as string}</span>
            {isManual && (
              <button
                onClick={resetAuto}
                title="Revenir au routage automatique"
                className="text-gray-500 hover:text-white leading-none"
              >
                ↺
              </button>
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}
