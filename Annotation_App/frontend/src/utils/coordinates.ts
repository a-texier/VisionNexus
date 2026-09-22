// ============================================================
// utils/coordinates.ts
// Conversion entre coordonnées YOLO normalisées et coordonnées pixel.
// RÈGLE : les coordonnées sont TOUJOURS stockées en YOLO normalisé [0,1].
// La conversion vers pixel ne se fait QUE dans les composants canvas.
// ============================================================

import type { PixelBBox, Point } from '../types/api'

/**
 * Convertit des coordonnées YOLO normalisées en coordonnées pixel.
 * YOLO : (cx, cy, w, h) avec cx,cy = centre, tout normalisé dans [0,1]
 * Pixel : (x, y, width, height) avec x,y = coin supérieur gauche
 */
export function yoloToPixel(
  cx: number,
  cy: number,
  w: number,
  h: number,
  imgWidth: number,
  imgHeight: number
): PixelBBox {
  return {
    x: (cx - w / 2) * imgWidth,
    y: (cy - h / 2) * imgHeight,
    width: w * imgWidth,
    height: h * imgHeight,
  }
}

/**
 * Convertit des coordonnées pixel en coordonnées YOLO normalisées.
 * Pixel : (x, y, width, height) avec x,y = coin supérieur gauche
 * YOLO : [cx, cy, w, h] normalisé dans [0,1]
 */
export function pixelToYolo(
  x: number,
  y: number,
  width: number,
  height: number,
  imgWidth: number,
  imgHeight: number
): [number, number, number, number] {
  const cx = (x + width / 2) / imgWidth
  const cy = (y + height / 2) / imgHeight
  const w = width / imgWidth
  const h = height / imgHeight
  return [
    Math.max(0, Math.min(1, cx)),
    Math.max(0, Math.min(1, cy)),
    Math.max(0.001, Math.min(1, w)),
    Math.max(0.001, Math.min(1, h)),
  ]
}

/**
 * Convertit un point normalisé [0,1] en coordonnées pixel.
 */
export function normalizedToPixel(
  point: Point,
  imgWidth: number,
  imgHeight: number
): Point {
  return {
    x: point.x * imgWidth,
    y: point.y * imgHeight,
  }
}

/**
 * Convertit des coordonnées pixel en point normalisé [0,1].
 * Clamp dans [0,1] pour éviter les sorties de canvas.
 */
export function pixelToNormalized(
  point: Point,
  imgWidth: number,
  imgHeight: number
): Point {
  return {
    x: Math.max(0, Math.min(1, point.x / imgWidth)),
    y: Math.max(0, Math.min(1, point.y / imgHeight)),
  }
}

/**
 * Convertit un tableau de points normalisés en coordonnées pixel.
 */
export function normalizedPolygonToPixel(
  points: [number, number][],
  imgWidth: number,
  imgHeight: number
): number[] {
  // Format Konva : [x1, y1, x2, y2, ...]
  return points.flatMap(([x, y]) => [x * imgWidth, y * imgHeight])
}

/**
 * Clamp les coordonnées YOLO dans les limites valides [0,1].
 * Utilisé après une transformation (redimensionnement, homographie).
 */
export function clampYoloBBox(
  cx: number,
  cy: number,
  w: number,
  h: number
): [number, number, number, number] {
  const clampedW = Math.max(0.001, Math.min(1, w))
  const clampedH = Math.max(0.001, Math.min(1, h))
  const clampedCx = Math.max(clampedW / 2, Math.min(1 - clampedW / 2, cx))
  const clampedCy = Math.max(clampedH / 2, Math.min(1 - clampedH / 2, cy))
  return [clampedCx, clampedCy, clampedW, clampedH]
}

/**
 * Calcule l'IoU entre deux boîtes YOLO normalisées.
 * Utile côté frontend pour la détection d'overlaps en temps réel.
 */
export function computeIoU(
  box1: [number, number, number, number],
  box2: [number, number, number, number]
): number {
  const [cx1, cy1, w1, h1] = box1
  const [cx2, cy2, w2, h2] = box2

  const x1_a = cx1 - w1 / 2; const y1_a = cy1 - h1 / 2
  const x2_a = cx1 + w1 / 2; const y2_a = cy1 + h1 / 2
  const x1_b = cx2 - w2 / 2; const y1_b = cy2 - h2 / 2
  const x2_b = cx2 + w2 / 2; const y2_b = cy2 + h2 / 2

  const xi1 = Math.max(x1_a, x1_b)
  const yi1 = Math.max(y1_a, y1_b)
  const xi2 = Math.min(x2_a, x2_b)
  const yi2 = Math.min(y2_a, y2_b)

  const interW = Math.max(0, xi2 - xi1)
  const interH = Math.max(0, yi2 - yi1)
  const interArea = interW * interH

  if (interArea === 0) return 0

  const areaA = w1 * h1
  const areaB = w2 * h2
  const unionArea = areaA + areaB - interArea

  return unionArea > 0 ? interArea / unionArea : 0
}
