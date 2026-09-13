// ============================================================
// components/tour/positioning.ts
// Calcul du rectangle spotlight et du placement du tooltip.
// Fonctions pures, pas de dependance externe (pas de floating-ui --
// inutile pour le nombre de cibles connues a l'avance d'un tour).
// ============================================================

export interface Rect {
  top: number
  left: number
  width: number
  height: number
}

export interface Size {
  width: number
  height: number
}

export const computeSpotlightRect = (el: Element, padding: number): Rect => {
  const r = el.getBoundingClientRect()
  return {
    top: r.top - padding,
    left: r.left - padding,
    width: r.width + padding * 2,
    height: r.height + padding * 2,
  }
}

type Side = 'top' | 'bottom' | 'left' | 'right'

export interface TooltipPosition {
  top: number
  left: number
  placement: Side
}

export const computeTooltipPlacement = (
  target: Rect,
  tooltip: Size,
  preferred: Side | 'auto',
  viewport: Size,
  gap = 12,
): TooltipPosition => {
  const fits: Record<Side, boolean> = {
    top: target.top - gap - tooltip.height >= 0,
    bottom: target.top + target.height + gap + tooltip.height <= viewport.height,
    left: target.left - gap - tooltip.width >= 0,
    right: target.left + target.width + gap + tooltip.width <= viewport.width,
  }

  let placement: Side
  if (preferred !== 'auto' && fits[preferred]) {
    placement = preferred
  } else {
    placement = (['bottom', 'top', 'right', 'left'] as const).find((p) => fits[p]) ?? 'bottom'
  }

  let top: number
  let left: number
  switch (placement) {
    case 'top':
      top = target.top - gap - tooltip.height
      left = target.left + target.width / 2 - tooltip.width / 2
      break
    case 'left':
      top = target.top + target.height / 2 - tooltip.height / 2
      left = target.left - gap - tooltip.width
      break
    case 'right':
      top = target.top + target.height / 2 - tooltip.height / 2
      left = target.left + target.width + gap
      break
    case 'bottom':
    default:
      top = target.top + target.height + gap
      left = target.left + target.width / 2 - tooltip.width / 2
      break
  }

  left = Math.max(8, Math.min(left, viewport.width - tooltip.width - 8))
  top = Math.max(8, Math.min(top, viewport.height - tooltip.height - 8))

  return { top, left, placement }
}
