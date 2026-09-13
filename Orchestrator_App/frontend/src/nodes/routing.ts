// ============================================================
// nodes/routing.ts — moteur de routage orthogonal « Blueprint style ».
// Module pur (aucun JSX, aucune dépendance à React/xyflow) : détection
// d'obstacles, décision du mode de tracé, empilement des couloirs (lanes),
// génération du path SVG et projection point→segment pour l'édition manuelle.
//
// Convention de ports (cf. nodes/NodePorts.tsx) : une SORTIE quitte toujours
// son nœud vers la DROITE, une ENTRÉE reçoit toujours depuis la GAUCHE — donc
// tout tracé doit partir horizontalement vers +x et arriver horizontalement
// depuis -x, quelle que soit la position relative réelle des deux nœuds.
// ============================================================

export interface Point { x: number; y: number }
export interface Rect { id: string; x: number; y: number; width: number; height: number }
export type RouteMode = 'direct' | 'zbend' | 'corridor'

export const ROW_BAND = 160        // demi-hauteur de la bande "même rangée" (repris de l'ancien _detourFor)
export const CORRIDOR_MARGIN = 36  // marge au-dessus du nœud le plus haut à contourner
export const LANE_SPACING = 18     // espacement vertical entre deux couloirs empilés
export const STUB = 24             // longueur du segment horizontal de départ/arrivée
export const CORNER_RADIUS = 10    // rayon des coins arrondis (cosmétique)

function overlaps1D(aMin: number, aMax: number, bMin: number, bMax: number): boolean {
  return aMin < bMax && aMax > bMin
}

export function xRangeOf(ax: number, bx: number): [number, number] {
  return ax < bx ? [ax, bx] : [bx, ax]
}

// Position de l'arête dans la chaîne d'exécution (step 4) :
// - 'adjacent' : connexion i→i+1 entre deux nœuds Application consécutifs ->
//   DOIT rester horizontale (direct/zbend), jamais de couloir.
// - 'long'     : connexion i→i+2, i→i+3… -> DOIT systématiquement monter dans
//   un couloir supérieur, même si rien ne l'obstrue géométriquement.
// - 'unordered': un des deux nœuds n'a pas de rang (Entrée, MLflow…) -> le
//   comportement géométrique historique (obstacle-based) s'applique tel quel.
export type ChainAdjacency = 'adjacent' | 'long' | 'unordered'

// ── Décision du mode de routage ────────────────────────────────────────────
// Basée sur les bounding-box des nœuds (position + dimensions mesurées), PAS
// sur les coordonnées exactes des ports (calculées plus tard par ReactFlow au
// rendu) — même approximation que l'ancien _detourFor, suffisante pour décider
// entre direct / Z-bend / couloir.
export function decideMode(
  srcRect: Rect, tgtRect: Rect, allRects: Rect[],
  sourceX: number, sourceY: number, targetX: number, targetY: number,
  chain: ChainAdjacency = 'unordered',
): { mode: RouteMode; corridorTopY?: number; xRange: [number, number] } {
  const [xMin, xMax] = xRangeOf(sourceX, targetX)
  const others = allRects.filter(r => r.id !== srcRect.id && r.id !== tgtRect.id)
  const forward = targetX - sourceX >= STUB * 2

  // step 4 : une connexion LONGUE (i→i+2+) monte TOUJOURS dans un couloir —
  // on saute directement le bloc direct/zbend, quelle que soit la géométrie.
  if (chain !== 'long') {
    // Une sortie ne peut techniquement quitter que vers la droite : si la cible
    // n'est pas assez "devant", direct/Z-bend produiraient un segment de sortie
    // vers la gauche (visuellement faux) → on force le couloir (boucle propre).
    if (forward) {
      const rowY = (sourceY + targetY) / 2
      const rowObstacles = others.filter(r =>
        overlaps1D(r.x, r.x + r.width, xMin, xMax) &&
        overlaps1D(r.y, r.y + r.height, rowY - ROW_BAND, rowY + ROW_BAND))

      if (rowObstacles.length === 0 && Math.abs(sourceY - targetY) < 2) {
        return { mode: 'direct', xRange: [xMin, xMax] }
      }

      const midX = (sourceX + targetX) / 2
      const [yLo, yHi] = xRangeOf(sourceY, targetY)
      const blocksZbend = others.some(r =>
        overlaps1D(r.x, r.x + r.width, midX, midX) &&
        overlaps1D(r.y, r.y + r.height, yLo, yHi))

      if (rowObstacles.length === 0 && !blocksZbend) {
        return { mode: 'zbend', xRange: [xMin, xMax] }
      }
    }

    // step 4 : une connexion ADJACENTE (i→i+1) reste horizontale — jamais de
    // couloir, même si un obstacle tiers (node Entrée déplacé librement, par
    // exemple) traînait dans la bande de la rangée. En pratique alignApplication-
    // Nodes/spaceApplicationNodes (steps 2-3) garantissent déjà qu'aucun autre
    // node Application ne peut s'y trouver.
    if (chain === 'adjacent') return { mode: 'zbend', xRange: [xMin, xMax] }
  }

  const wideObstacles = others.filter(r => overlaps1D(r.x, r.x + r.width, xMin, xMax))
  const clearTop = wideObstacles.length
    ? Math.min(...wideObstacles.map(r => r.y))
    : Math.min(sourceY, targetY)
  return { mode: 'corridor', corridorTopY: clearTop - CORRIDOR_MARGIN, xRange: [xMin, xMax] }
}

// ── Empilement des couloirs (lanes) ────────────────────────────────────────
// Les arêtes "couloir" dont les plages X se chevauchent prennent un niveau
// (0, 1, 2…) au lieu de partager le même Y. Contrairement à l'ancien laneOf,
// les niveaux s'empilent vers le HAUT (soustraits de corridorTopY par
// l'appelant), pas vers le bas.
export function assignLanes(items: { id: string; xRange: [number, number] }[]): Map<string, number> {
  const laneOf = new Map<string, number>()
  items.forEach((r, i) => {
    let lane = 0
    for (let j = 0; j < i; j++) {
      const other = items[j]
      if (overlaps1D(r.xRange[0], r.xRange[1], other.xRange[0], other.xRange[1])) {
        lane = Math.max(lane, (laneOf.get(other.id) ?? 0) + 1)
      }
    }
    laneOf.set(r.id, lane)
  })
  return laneOf
}

// ── Construction des points (mode auto) ────────────────────────────────────
// Retourne la polyligne COMPLÈTE (extrémités incluses). `corridorY` doit déjà
// inclure le décalage de lane (corridorTopY - lane*LANE_SPACING).
export function buildPoints(
  mode: RouteMode, corridorY: number | undefined,
  sourceX: number, sourceY: number, targetX: number, targetY: number,
): Point[] {
  const S: Point = { x: sourceX, y: sourceY }
  const T: Point = { x: targetX, y: targetY }
  if (mode === 'direct') return [S, T]
  if (mode === 'zbend') {
    const midX = (sourceX + targetX) / 2
    return [S, { x: midX, y: sourceY }, { x: midX, y: targetY }, T]
  }
  const y = corridorY ?? Math.min(sourceY, targetY) - CORRIDOR_MARGIN
  const stubOutX = sourceX + STUB
  const stubInX = targetX - STUB
  return [
    S,
    { x: stubOutX, y: sourceY },
    { x: stubOutX, y },
    { x: stubInX, y },
    { x: stubInX, y: targetY },
    T,
  ]
}

// ── Rendu SVG ───────────────────────────────────────────────────────────────
// Path orthogonal avec coins arrondis cosmétiques, valable pour n'importe
// quelle polyligne (auto ou éditée à la main) : chaque virage entre segments
// consécutifs non alignés devient un coin arrondi, jamais une diagonale.
export function svgPathFromPoints(points: Point[], r: number = CORNER_RADIUS): string {
  if (points.length < 2) return ''
  if (points.length === 2) {
    return `M ${points[0].x},${points[0].y} L ${points[1].x},${points[1].y}`
  }
  const parts: string[] = [`M ${points[0].x},${points[0].y}`]
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1], curr = points[i], next = points[i + 1]
    const segIn = Math.hypot(curr.x - prev.x, curr.y - prev.y)
    const segOut = Math.hypot(next.x - curr.x, next.y - curr.y)
    const rr = Math.min(r, segIn / 2, segOut / 2)
    const inDx = segIn ? (curr.x - prev.x) / segIn : 0
    const inDy = segIn ? (curr.y - prev.y) / segIn : 0
    const outDx = segOut ? (next.x - curr.x) / segOut : 0
    const outDy = segOut ? (next.y - curr.y) / segOut : 0
    const p1 = { x: curr.x - inDx * rr, y: curr.y - inDy * rr }
    const p2 = { x: curr.x + outDx * rr, y: curr.y + outDy * rr }
    parts.push(`L ${p1.x},${p1.y}`, `Q ${curr.x},${curr.y} ${p2.x},${p2.y}`)
  }
  const last = points[points.length - 1]
  parts.push(`L ${last.x},${last.y}`)
  return parts.join(' ')
}

// Largeur de pilule ESTIMÉE pour un label (police 10px/600, cf. OrthogonalEdge)
// — pas de round-trip DOM (mesure réelle indisponible avant peinture, et le
// but est un anti-chevauchement STABLE, jamais recalculé différemment d'une
// frame à l'autre). CHAR_W est une moyenne large exprès (légèrement surestimée)
// pour ne jamais SOUS-estimer l'espace nécessaire.
const CHAR_W = 6
const PILL_PAD = 12 // padding horizontal total de la pilule (labelBgPadding)
export function estimatePillWidth(label: string): number {
  return label.length * CHAR_W + PILL_PAD
}

// Marge minimale entre le bord de la pilule et le port (avant ET après le
// texte) — c'est CE gap que step 4/5 (Bob, juillet 2026) demande de respecter :
// le texte ne doit jamais coller ni au node source ni au node cible. Élargi
// (step 6, Bob) : la marge d'origine (14) laissait un couloir de câble "avant"
// le texte trop discret — on veut une zone visible et nette avant le texte
// (les "étoiles" de son schéma node(i) ******texte-----------node(i+1)).
export const LABEL_EDGE_MARGIN = 22

// Point d'ancrage STABLE du label (step 1 — refonte labels d'arêtes).
// Contrairement à l'ancien `labelAnchor(points)` (retiré), qui dérivait la
// position du plus long segment HORIZONTAL de la polyligne ROUTÉE — donc du
// `mode` (direct/zbend/corridor) décidé par `decideMode()` en fonction des
// bounding-box de TOUS les autres nœuds — cette fonction ne dépend QUE des 4
// coordonnées de port de CETTE arête (source/cible) + le texte du label lui-
// même. Un nœud tiers qui se déplace pendant un drag ne peut donc jamais faire
// sauter ce label : aucun obstacle tiers n'entre dans le calcul.
//
// EXCEPTION volontaire (step 6, Bob juillet 2026) : `corridorY`, si fourni.
// Un câble en mode COULOIR (connexion longue i→i+2+, cf. decideMode/chain
// 'long') "saute" DÉJÀ au-dessus d'un ou plusieurs nodes intermédiaires — sa
// hauteur dépend nécessairement de ces obstacles tiers (ce n'est pas un choix,
// c'est ainsi que le tracé lui-même est calculé). Ignorer cette hauteur pour le
// label produisait un texte "flottant dans les airs", visuellement détaché du
// trait réel (bug rapporté : "dataset YOLO" posé à l'ancienne hauteur des deux
// nodes pendant que le câble, lui, était monté au-dessus d'un node intermédiaire).
// Puisque le CÂBLE bouge déjà avec les obstacles tiers, faire suivre le LABEL
// n'introduit aucune instabilité nouvelle — il ne fait que rester collé au trait
// qu'il annote.
//
// `adjacent` = connexion i→i+1 (deux nœuds consécutifs dans l'ordre d'exécution,
// cf. computeExecOrder côté SandgraphPage) → cas normal, connexion horizontale
// courte. Sinon (connexion longue i→i+2+, ou pas assez de place) → position
// secondaire, tout aussi stable, jamais recalculée différemment tant que les
// deux nœuds eux-mêmes (et, en mode couloir, les obstacles) ne bougent pas.
export function stableLabelAnchor(
  adjacent: boolean, sourceX: number, sourceY: number, targetX: number, targetY: number,
  label: string = '', corridorY?: number,
): Point {
  const halfPill = estimatePillWidth(label) / 2

  if (corridorY != null) {
    // Le label suit le SEGMENT PLAT réel du couloir (mêmes bornes stubOutX/
    // stubInX que buildPoints ci-dessous), positionné près du départ — même
    // logique de clamp anti-chevauchement que le cas "adjacent" plus bas.
    const stubOutX = sourceX + STUB
    const stubInX = targetX - STUB
    const desiredX = stubOutX + LABEL_EDGE_MARGIN * 2
    const minX = stubOutX + LABEL_EDGE_MARGIN + halfPill
    const maxX = stubInX - LABEL_EDGE_MARGIN - halfPill
    const x = minX <= maxX ? Math.min(Math.max(desiredX, minX), maxX) : (stubOutX + stubInX) / 2
    return { x, y: corridorY }
  }

  const gap = targetX - sourceX
  if (adjacent && gap > STUB * 4) {
    // Position par défaut : après un vrai segment de câble VISIBLE au départ du
    // node source (jamais sur une pente). CLAMPÉE ensuite pour garantir
    // LABEL_EDGE_MARGIN de chaque côté de la pilule (anti-chevauchement avec
    // les DEUX nodes, pas seulement la source) — sans ce clamp, un texte long
    // (ex. "dataset YOLO : subset-1-yolo") pouvait déborder sur le node cible.
    const desiredX = sourceX + STUB * 2.5
    const minX = sourceX + LABEL_EDGE_MARGIN + halfPill
    const maxX = targetX - LABEL_EDGE_MARGIN - halfPill
    const x = minX <= maxX ? Math.min(Math.max(desiredX, minX), maxX) : (sourceX + targetX) / 2
    return { x, y: sourceY }
  }
  // Position secondaire stable : centre horizontal, légèrement au-dessus de la
  // rangée la plus haute des deux nœuds — ne dépend d'aucun obstacle tiers.
  return { x: (sourceX + targetX) / 2, y: Math.min(sourceY, targetY) - 16 }
}

// ── Édition manuelle ────────────────────────────────────────────────────────
// Projette `click` sur le segment orthogonal [a,b] le plus proche (clampé aux
// bornes du segment, jamais en diagonale).
function projectOntoSegment(a: Point, b: Point, p: Point): Point {
  if (Math.abs(a.y - b.y) < 0.5) {
    const [lo, hi] = xRangeOf(a.x, b.x)
    return { x: Math.min(Math.max(p.x, lo), hi), y: a.y }
  }
  if (Math.abs(a.x - b.x) < 0.5) {
    const [lo, hi] = xRangeOf(a.y, b.y)
    return { x: a.x, y: Math.min(Math.max(p.y, lo), hi) }
  }
  const da = Math.hypot(p.x - a.x, p.y - a.y)
  const db = Math.hypot(p.x - b.x, p.y - b.y)
  return da < db ? a : b
}

// Segment le plus proche du clic dans la polyligne COMPLÈTE (extrémités
// incluses). `index` = position du segment (points[index] → points[index+1]),
// directement réutilisable comme index d'insertion dans le tableau des
// waypoints intermédiaires (points.slice(1, -1)).
export function nearestSegment(points: Point[], click: Point): { index: number; point: Point } {
  let best = { index: 0, point: points[0], dist: Infinity }
  for (let i = 0; i < points.length - 1; i++) {
    const proj = projectOntoSegment(points[i], points[i + 1], click)
    const d = Math.hypot(proj.x - click.x, proj.y - click.y)
    if (d < best.dist) best = { index: i, point: proj, dist: d }
  }
  return { index: best.index, point: best.point }
}
