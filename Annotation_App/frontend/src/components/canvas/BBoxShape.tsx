// ============================================================
// components/canvas/BBoxShape.tsx
// Composant Konva.js pour une boîte englobante annotée.
// Supporte la sélection, le redimensionnement (8 handles),
// et le déplacement contraints aux limites de l'image.
// ============================================================

import React, { useRef } from 'react'
import { Group, Rect, Text, Transformer } from 'react-konva'
import type Konva from 'konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import type { Annotation, LabelClass } from '../../types/api'
import { pixelToYolo, yoloToPixel } from '../../utils/coordinates'

interface BBoxShapeProps {
  annotation: Annotation
  isSelected: boolean
  isTrackingTarget?: boolean  // Annotation sélectionnée comme cible de tracking guidé
  labelClass: LabelClass | undefined
  imageWidth: number    // Largeur AFFICHÉE de l'image (déjà × zoom) en pixels écran
  imageHeight: number   // Hauteur AFFICHÉE de l'image (déjà × zoom) en pixels écran
  canvasScale: number   // Facteur de zoom du canvas (pour épaisseurs de trait)
  showLabel?: boolean         // Afficher l'étiquette de classe (depuis settings)
  showConfidence?: boolean    // Afficher le score de confiance (depuis settings)
  borderWidth?: number        // Épaisseur des bordures (depuis settings)
  fillOpacity?: number        // Opacité du remplissage 0-1 (depuis settings)
  trackColor?: string         // Couleur de la track associée (badge coin haut-droit)
  trackUid?: number | null    // Numéro de track affiché dans le badge
  onSelect: (id: number, multiSelect: boolean) => void
  onUpdate: (id: number, cx: number, cy: number, w: number, h: number) => void
  onDblClick?: (id: number) => void  // Double-clic pour basculer cible tracking
}

export const BBoxShape: React.FC<BBoxShapeProps> = ({
  annotation,
  isSelected,
  isTrackingTarget = false,
  labelClass,
  imageWidth,
  imageHeight,
  showLabel = true,
  showConfidence = false,
  borderWidth = 2,
  fillOpacity = 0.2,
  trackColor,
  trackUid,
  onSelect,
  onUpdate,
  onDblClick,
}) => {
  const rectRef = useRef<Konva.Rect>(null)
  const transformerRef = useRef<Konva.Transformer>(null)

  // Conversion YOLO → pixel pour l'affichage
  const pixelBBox = yoloToPixel(
    annotation.cx,
    annotation.cy,
    annotation.width,
    annotation.height,
    imageWidth,
    imageHeight
  )

  // Couleur de la classe (défaut bleu si classe inconnue)
  const color = labelClass?.color ?? '#3B82F6'
  const strokeColor = color

  // Couleur de fond selon le score de confiance
  const alpha = Math.round(Math.min(1, Math.max(0, fillOpacity)) * 255).toString(16).padStart(2, '0')
  const getConfidenceColor = () => {
    if (annotation.confidence >= 0.8) return `${color}${alpha}`  // Vert = haute confiance
    if (annotation.confidence >= 0.5) return `#F59E0B${alpha}`   // Orange = confiance moyenne
    return `#EF4444${alpha}`                                      // Rouge = basse confiance
  }

  // Attacher le transformer quand sélectionné
  React.useEffect(() => {
    if (isSelected && rectRef.current && transformerRef.current) {
      transformerRef.current.nodes([rectRef.current])
      transformerRef.current.getLayer()?.batchDraw()
    }
  }, [isSelected])

  // Gestion du clic pour la sélection
  const handleClick = (e: KonvaEventObject<MouseEvent | TouchEvent>) => {
    const ctrlKey = 'ctrlKey' in e.evt ? e.evt.ctrlKey : false
    const metaKey = 'metaKey' in e.evt ? e.evt.metaKey : false
    onSelect(annotation.id, ctrlKey || metaKey)
  }

  // Double-clic : bascule la cible de tracking guidé
  const handleDblClick = (e: KonvaEventObject<MouseEvent>) => {
    e.cancelBubble = true  // Empêche la propagation au stage
    onDblClick?.(annotation.id)
  }

  // Mise à jour des coordonnées après déplacement (drag)
  const handleDragEnd = (e: KonvaEventObject<DragEvent>) => {
    const node = e.target
    const newX = node.x()
    const newY = node.y()

    // Conversion pixel → YOLO normalisé
    const [cx, cy, w, h] = pixelToYolo(newX, newY, pixelBBox.width, pixelBBox.height, imageWidth, imageHeight)
    onUpdate(annotation.id, cx, cy, w, h)
  }

  // Mise à jour des coordonnées après redimensionnement (transform)
  const handleTransformEnd = () => {
    const node = rectRef.current
    if (!node) return

    // Calcul de la nouvelle taille en prenant en compte le scale du transformer
    const scaleX = node.scaleX()
    const scaleY = node.scaleY()
    node.scaleX(1)
    node.scaleY(1)

    const newX = node.x()
    const newY = node.y()
    const newW = Math.max(5, node.width() * scaleX)
    const newH = Math.max(5, node.height() * scaleY)

    const [cx, cy, w, h] = pixelToYolo(newX, newY, newW, newH, imageWidth, imageHeight)
    onUpdate(annotation.id, cx, cy, w, h)
  }

  // Contrainte de déplacement dans les limites de l'image
  const dragBoundFunc = (pos: { x: number; y: number }) => ({
    x: Math.max(0, Math.min(imageWidth - pixelBBox.width, pos.x)),
    y: Math.max(0, Math.min(imageHeight - pixelBBox.height, pos.y)),
  })

  // Label à afficher selon les settings
  const className = labelClass?.name ?? `class_${annotation.class_id}`
  const confidenceText = showConfidence && annotation.is_auto
    ? ` ${(annotation.confidence * 100).toFixed(0)}%`
    : ''
  const labelText = `${className}${confidenceText}`

  return (
    <>
      <Group>
        {/* Halo de sélection tracking (anneau derrière la boîte) — taille écran
            CONSTANTE. Les coords du layer sont déjà en pixels écran (displayWidth
            = imageWidth × scaleToFit × canvasZoom, Group seulement translaté) :
            diviser par canvasScale donnait un halo de 25 px avec des pointillés
            de 30 px au dézoom (zoom 0,2) et invisible au zoom fort. */}
        {isTrackingTarget && (
          <Rect
            x={pixelBBox.x - 5}
            y={pixelBBox.y - 5}
            width={pixelBBox.width + 10}
            height={pixelBBox.height + 10}
            stroke={color}
            strokeWidth={2}
            dash={[6, 3]}
            fill={`${color}18`}
            listening={false}
            opacity={0.85}
          />
        )}

        {/* Rectangle principal */}
        <Rect
          ref={rectRef}
          x={pixelBBox.x}
          y={pixelBBox.y}
          width={pixelBBox.width}
          height={pixelBBox.height}
          stroke={strokeColor}
          strokeWidth={isSelected ? borderWidth + 0.5 : isTrackingTarget ? borderWidth : borderWidth - 0.5}
          fill={getConfidenceColor()}
          draggable
          onClick={handleClick}
          onTap={handleClick}
          onDblClick={handleDblClick}
          onDragEnd={handleDragEnd}
          onTransformEnd={handleTransformEnd}
          dragBoundFunc={dragBoundFunc}
        />

        {/* Étiquette de classe — taille écran CONSTANTE (les coords sont déjà
            en pixels écran : diviser par canvasScale rendait le texte minuscule
            au zoom et énorme au dézoom). */}
        {showLabel && (
          <Text
            x={pixelBBox.x}
            y={pixelBBox.y - 15}
            text={labelText}
            fontSize={12}
            fontStyle="bold"
            fill="white"
            padding={2}
            background={strokeColor}
            listening={false}
          />
        )}

        {/* Badge de track (coin haut-droit) : rond de la couleur de la track +
            numéro de track. On n'affiche le badge QUE si le track_uid réel est connu
            (sinon on montrait le PK track_id → « flash » 7 puis 6 le temps que la
            liste des tracks se recharge). */}
        {annotation.track_id != null && trackUid != null && (
          <>
            <Rect
              x={pixelBBox.x + pixelBBox.width - 15}
              y={pixelBBox.y + 1}
              width={14}
              height={14}
              cornerRadius={7}
              fill={trackColor ?? strokeColor}
              stroke="white"
              strokeWidth={1}
              listening={false}
            />
            <Text
              x={pixelBBox.x + pixelBBox.width - 15}
              y={pixelBBox.y + 1}
              width={14}
              height={14}
              text={`${trackUid}`}
              fontSize={9}
              fontStyle="bold"
              fill="white"
              align="center"
              verticalAlign="middle"
              listening={false}
            />
          </>
        )}
      </Group>

      {/* Transformer pour le redimensionnement (8 handles) */}
      {isSelected && (
        <Transformer
          ref={transformerRef}
          boundBoxFunc={(oldBox, newBox) => {
            // Empêcher les boîtes de taille nulle
            if (newBox.width < 5 || newBox.height < 5) return oldBox
            return newBox
          }}
          // Poignées à taille écran CONSTANTE. Les coords du layer sont déjà en
          // pixels écran (displayWidth = imageWidth × scaleToFit × canvasZoom, layer
          // NON scalé) : diviser par canvasScale rendait les poignées minuscules au
          // zoom fort (8/5 = 1.6 px) et énormes au dézoom (8/0.2 = 40 px).
          anchorSize={10}
          anchorStrokeWidth={1.5}
          borderStroke={strokeColor}
          borderStrokeWidth={1}
          borderDash={[4, 4]}
        />
      )}
    </>
  )
}
