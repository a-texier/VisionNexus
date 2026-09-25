// ============================================================
// components/canvas/AnnotationCanvas.tsx
// Canvas principal d'annotation basé sur Konva.js.
//
// Couches (layers) :
//   1. Background : image de la frame
//   2. Annotations : boîtes, polygones (groupés avec canvasOffset)
//   3. Interaction : dessin en cours, points SAM, masques SAM
//
// Corrections :
//   - BBox/polygon suivent le zoom ET le pan (Group avec canvasOffset)
//   - SAM point → appel auto predict avec feedback visuel
//   - SAM auto → déclenchement via bouton (pas de clic canvas)
//   - Rendu des polygones (Line Konva)
// ============================================================

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Circle, Group, Image as KonvaImage, Layer, Line, Rect, Stage, Text } from 'react-konva'
import type Konva from 'konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import useImage from 'use-image'
import toast from 'react-hot-toast'
import { useAnnotationStore } from '../../stores/annotationStore'
import { useUIStore } from '../../stores/uiStore'
import { useSAMStore } from '../../stores/samStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { BBoxShape } from './BBoxShape'
import { samAPI } from '../../services/api'
import { normalizedPolygonToPixel } from '../../utils/coordinates'
import { useT } from '../../i18n/useLang'
import type { Annotation, LabelClass, Point, SAMMask, Track } from '../../types/api'

interface AnnotationCanvasProps {
  imageUrl: string
  imageWidth: number
  imageHeight: number
  classes: LabelClass[]
  tracks?: Track[]        // Pour le badge de track (couleur + numéro) sur les bbox
  frameId: number
  /** Appelé quand l'utilisateur clique sur une proposition SAM Auto (index dans streamedMasks) */
  onSAMMaskClick?: (maskIndex: number) => void
  /** Mode de sortie SAM : 'bbox' = boite, 'segmentation' = polygone */
  samOutputMode?: 'bbox' | 'segmentation'
  /**
   * Mode live (propagation / batch en cours) :
   * - false (défaut) : commit atomique image+annotations → zéro flash sur navigation manuelle
   * - true            : affiche l'image dès qu'elle est chargée, sans attendre la sync annotations
   *                     (les tokens d'annulation empêcheraient de toute façon le commit atomique
   *                      lors de navigations rapides)
   */
  liveMode?: boolean
}

// ---- Chargement d'image ANNULABLE (scrub / lecture / propagation) --------------------------
// `useImage` (lib use-image) ne fournit aucun moyen d'annuler une requête en cours : à chaque
// changement d'URL elle crée un nouvel `Image()` et met juste `.src` à jour, sans jamais faire
// `img.src = ''` sur l'ancien. Le navigateur continue donc de télécharger les images abandonnées
// en arrière-plan. En local ça ne se voit jamais (LAN = quasi instantané), mais via un tunnel SSH
// à latence/bande passante limitées, chaque tick de scrub (throttlé à 130ms cote AnnotationPage)
// lance une requête qui vient s'ajouter à la file au lieu de remplacer la précédente : le budget
// de 6 connexions/origine du navigateur se remplit de téléchargements devenus inutiles, et l'image
// réellement demandée doit attendre son tour derrière eux — d'où l'impression que "ça ne suit
// jamais" et qu'il faut s'arrêter puis attendre pour voir le bon resultat.
// Pour HTTP, ce hook utilise fetch()+AbortController : la requête précédente est RÉELLEMENT
// annulée dès qu'une nouvelle URL est demandée. Pour app-image://, il utilise directement
// HTMLImageElement : Electron résout alors le protocole natif (disque/SMB) sans passer par le
// pipeline fetch/blob du renderer, qui pouvait échouer silencieusement dans la vue embarquée.
function useCancellableLiveImage(url: string, active: boolean): HTMLImageElement | null {
  // On retient l'URL a laquelle appartient l'image, et on ne la rend QUE si elle
  // correspond encore a l'URL demandee. Sans ce garde-fou, ce hook gardait
  // indefiniment sa derniere image (il ne remet jamais son etat a null quand il
  // devient inactif) : en navigation normale, `useImage` repasse a undefined le
  // temps de charger la frame suivante, le `?? liveImage` de l'appelant prenait
  // alors le relais et faisait reapparaitre une image d'une TOUTE AUTRE frame,
  // heritee de la derniere propagation ou du dernier scrub. C'est la remanence
  // vue en avancant aux fleches, et au zoom quand le franchissement du seuil 1.5
  // change le palier donc l'URL.
  const [loaded, setLoaded] = useState<{ url: string; img: HTMLImageElement } | null>(null)
  const objectUrlRef = useRef<string | null>(null)

  useEffect(() => {
    if (!active || !url) {
      setLoaded(null)
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current)
        objectUrlRef.current = null
      }
      return
    }
    const controller = new AbortController()
    let cancelled = false

    if (url.startsWith('app-image://')) {
      const img = new window.Image()
      img.onload = () => {
        if (cancelled) return
        if (objectUrlRef.current) {
          URL.revokeObjectURL(objectUrlRef.current)
          objectUrlRef.current = null
        }
        setLoaded({ url, img })
      }
      img.onerror = () => {
        if (!cancelled) console.error(`[LiveImage] echec du chargement natif: ${url}`)
      }
      img.src = url
      return () => {
        cancelled = true
        img.onload = null
        img.onerror = null
        img.removeAttribute('src')
      }
    }

    fetch(url, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.blob()
      })
      .then((blob) => {
        if (cancelled) return
        const objUrl = URL.createObjectURL(blob)
        const img = new window.Image()
        img.onload = () => {
          if (cancelled) { URL.revokeObjectURL(objUrl); return }
          if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
          objectUrlRef.current = objUrl
          setLoaded({ url, img })
        }
        img.onerror = () => {
          URL.revokeObjectURL(objUrl)
          if (!cancelled) console.error(`[LiveImage] blob image invalide: ${url}`)
        }
        img.src = objUrl
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        console.error(`[LiveImage] echec HTTP: ${url}`, error)
      })

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [url, active])

  // Libère le dernier object URL au démontage complet du canvas.
  useEffect(() => () => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
  }, [])

  // Jamais l'image d'une autre URL : mieux vaut rendre null (l'appelant affiche
  // alors la derniere frame VALIDEE via prevImageRef) qu'une image sans rapport.
  return loaded && loaded.url === url ? loaded.img : null
}

export const AnnotationCanvas: React.FC<AnnotationCanvasProps> = ({
  imageUrl,
  imageWidth,
  imageHeight,
  classes,
  tracks = [],
  frameId,
  onSAMMaskClick,
  samOutputMode = 'bbox',
  liveMode = false,
}) => {
  const t = useT()
  const stageRef = useRef<Konva.Stage>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  // Lookup track.id → {color, uid} pour le badge des bbox
  const trackInfoById = React.useMemo(() => {
    const m = new Map<number, { color: string; uid: number }>()
    for (const t of tracks) m.set(t.id, { color: t.color, uid: t.track_uid })
    return m
  }, [tracks])

  // Dimensions du conteneur (responsive)
  const [containerSize, setContainerSize] = useState({ width: 800, height: 600 })

  // Chargement image : useImage (lib, non-annulable) en navigation normale, hook maison
  // annulable (fetch+AbortController) en mode live (scrub/lecture/propagation) — voir
  // useCancellableLiveImage ci-dessus. Les deux hooks sont toujours appelés (règles des
  // hooks) mais un seul travaille vraiment à la fois : l'autre reçoit une URL vide / active=false.
  const [staticImage] = useImage(liveMode ? '' : imageUrl, 'anonymous')
  const liveImage = useCancellableLiveImage(imageUrl, liveMode)
  const image = liveMode ? (liveImage ?? staticImage) : (staticImage ?? liveImage)

  // Stores
  const {
    annotations,
    currentFrameId: storeFrameId,
    selectedAnnotationIds,
    activeTool,
    activeClassId,
    drawingState,
    selectAnnotation,
    deselectAll,
    addAnnotation,
    updateAnnotation,
    startDrawing,
    updateDrawing,
    addPolygonPoint,
    finishDrawing,
    cancelDrawing,
    trackingTargetIds,
    toggleTrackingTarget,
  } = useAnnotationStore()

  const { canvasZoom, canvasOffset, setCanvasZoom, setCanvasOffset, resetZoom } = useUIStore()
  const { pendingPoints, streamedMasks, addPoint, clearPoints } = useSAMStore()

  // Dessin sans classe → l'annotation ne peut pas être créée. On prévient (au lieu
  // du silence actuel où la box tracée disparaît sans explication). Anti-spam : un
  // seul toast à la fois (id fixe).
  const warnNoClass = useCallback(() => {
    if (classes.length === 0) {
      toast.error(t("Créez d'abord une classe (onglet Classes, bouton +) pour pouvoir annoter."),
        { id: 'no-class', duration: 4000 })
    } else {
      toast(t('Sélectionnez une classe (onglet Classes) avant de dessiner.'),
        { id: 'no-class', icon: '🏷️', duration: 3000 })
    }
  }, [classes.length])

  // ---- Commit image + annotations ----------------------------------------------------------
  // Deux modes :
  //
  // liveMode = false (navigation manuelle) :
  //   Commit atomique — on n'affiche la nouvelle image QUE quand les annotations du store
  //   correspondent aussi à cette frame (storeFrameId === frameId).
  //   Évite le flash "image N+1 + annotations N" quand l'image est en cache mais l'API tarde.
  //
  // liveMode = true (propagation / batch rapide en cours) :
  //   Affichage immédiat dès que l'image est chargée. Les requêtes annotations sont de toute
  //   façon annulées par le token lors de navigations rapides, donc frameCommitted serait
  //   toujours faux → canvas gelé. On accepte un éventuel bref décalage annotation/image
  //   pour montrer la progression en temps réel.
  // -----------------------------------------------------------------------------------------
  const prevImageRef = useRef<HTMLImageElement | null>(null)
  const prevAnnotationsRef = useRef<Annotation[]>([])

  const frameCommitted = liveMode
    ? image != null   // mode live : commit dès que l'image est là
    : image != null && storeFrameId === frameId  // mode normal : sync image + annotations

  if (frameCommitted) {
    prevImageRef.current = image ?? null
    prevAnnotationsRef.current = annotations
  }

  const displayImage = (frameCommitted ? image : prevImageRef.current) ?? null
  const displayAnnotations = frameCommitted ? annotations : prevAnnotationsRef.current
  // -----------------------------------------------------------------------------------------

  // Paramètres d'affichage depuis les settings utilisateur
  const interfaceSettings = useSettingsStore((s) => s.settings?.interface)
  const showLabels = interfaceSettings?.show_labels ?? true
  const showConfidence = interfaceSettings?.show_confidence ?? false
  const borderWidth = interfaceSettings?.annotation_border_width ?? 2
  const fillOpacity = interfaceSettings?.annotation_opacity ?? 0.2
  // Meme opacite pour les polygones (hex sur 2 chiffres, comme BBoxShape)
  const fillAlpha = Math.round(Math.min(1, Math.max(0, fillOpacity)) * 255).toString(16).padStart(2, '0')

  // Etat de la prédiction SAM point (loading)
  const [isSAMPredicting, setIsSAMPredicting] = useState(false)
  const [samPredictedMasks, setSamPredictedMasks] = useState<SAMMask[]>([])

  // Ratio image/canvas pour le rendu adaptatif
  const scaleToFit = Math.min(
    containerSize.width / imageWidth,
    containerSize.height / imageHeight,
    1
  )

  // Mise à jour de la taille du conteneur (responsive)
  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        const width = containerRef.current.offsetWidth
        const height = containerRef.current.offsetHeight

        // Un onglet Electron masque peut etre mesure temporairement a 0x0.
        // Propager cette taille a Konva met aussi ses canvases internes a zero ;
        // un batchDraw deja planifie tente alors de les reutiliser et leve une
        // InvalidStateError qui demonte toute la page React. Conserver la
        // derniere taille valide rend le masquage/reaffichage atomique pour Stage.
        if (width <= 0 || height <= 0) return

        setContainerSize((previous) =>
          previous.width === width && previous.height === height
            ? previous
            : { width, height }
        )
      }
    }
    updateSize()
    const observer = new ResizeObserver(updateSize)
    if (containerRef.current) observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [])

  // ---- SAM Point : prédiction automatique à chaque ajout de point ----
  useEffect(() => {
    if (activeTool !== 'sam_point' || pendingPoints.length === 0) return

    const predict = async () => {
      setIsSAMPredicting(true)
      try {
        const masks = await samAPI.predictPoints(
          frameId,
          pendingPoints.map((p) => ({ x: p.x, y: p.y, label: p.label })),
          true
        )
        setSamPredictedMasks(masks)
      } catch {
        toast.error(t('Erreur SAM point — vérifiez que SAM2 est chargé'))
      } finally {
        setIsSAMPredicting(false)
      }
    }

    void predict()
  }, [pendingPoints, frameId, activeTool])

  // Nettoyer les masques prédits quand on change d'outil
  useEffect(() => {
    if (activeTool !== 'sam_point') {
      setSamPredictedMasks([])
      clearPoints()
    }
  }, [activeTool, clearPoints])

  // Conversion coordonnées stage → coordonnées image normalisées
  const stageToImageNormalized = useCallback(
    (stageX: number, stageY: number): Point => {
      const pixelX = (stageX - canvasOffset.x) / (scaleToFit * canvasZoom)
      const pixelY = (stageY - canvasOffset.y) / (scaleToFit * canvasZoom)
      return {
        x: Math.max(0, Math.min(1, pixelX / imageWidth)),
        y: Math.max(0, Math.min(1, pixelY / imageHeight)),
      }
    },
    [canvasOffset, scaleToFit, canvasZoom, imageWidth, imageHeight]
  )

  // ---- Gestion du zoom molette ----
  const handleWheel = useCallback(
    (e: KonvaEventObject<WheelEvent>) => {
      e.evt.preventDefault()
      const stage = stageRef.current
      if (!stage) return

      const scaleFactor = e.evt.deltaY < 0 ? 1.1 : 0.9
      const newZoom = Math.max(0.1, Math.min(10, canvasZoom * scaleFactor))

      const pointer = stage.getPointerPosition()
      if (pointer) {
        const mouseXRelative = pointer.x - canvasOffset.x
        const mouseYRelative = pointer.y - canvasOffset.y
        const newOffsetX = pointer.x - (mouseXRelative * newZoom) / canvasZoom
        const newOffsetY = pointer.y - (mouseYRelative * newZoom) / canvasZoom
        setCanvasOffset({ x: newOffsetX, y: newOffsetY })
      }

      setCanvasZoom(newZoom)
    },
    [canvasZoom, canvasOffset, setCanvasZoom, setCanvasOffset]
  )

  // ---- Pan au clic milieu ----
  const isPanning = useRef(false)
  const lastPanPos = useRef({ x: 0, y: 0 })
  const middlePan = useRef(false)   // le pan courant vient-il du clic molette ?
  const panMoved = useRef(false)    // a-t-on réellement bougé (drag) vs simple clic ?

  const handleStageMouseDown = useCallback(
    (e: KonvaEventObject<MouseEvent>) => {
      const stage = stageRef.current
      if (!stage) return

      // Clic milieu (molette) OU outil main : début du pan.
      // Un clic molette SANS déplacement = auto-ajustement (fit) au relâché.
      if (e.evt.button === 1 || activeTool === 'pan') {
        e.evt.preventDefault()
        isPanning.current = true
        middlePan.current = e.evt.button === 1
        panMoved.current = false
        lastPanPos.current = { x: e.evt.clientX, y: e.evt.clientY }
        return
      }

      // Clic gauche sur le fond : désélection
      if (e.target === stage || e.target.name() === 'background-image') {
        if (activeTool === 'select') {
          deselectAll()
          return
        }
      }

      const pointer = stage.getPointerPosition()
      if (!pointer) return

      const normalizedPoint = stageToImageNormalized(pointer.x, pointer.y)

      // ---- Outil Rectangle ----
      if (activeTool === 'bbox') {
        startDrawing('bbox', normalizedPoint)
        return
      }

      // ---- Outil Polygone ----
      if (activeTool === 'polygon') {
        if (!drawingState) {
          startDrawing('polygon', normalizedPoint)
        } else {
          addPolygonPoint(normalizedPoint)
        }
        return
      }

      // ---- Outil Point SAM ----
      if (activeTool === 'sam_point') {
        const isBackground = e.evt.button === 2
        addPoint({
          x: normalizedPoint.x,
          y: normalizedPoint.y,
          label: isBackground ? 0 : 1,
        })
        return
      }

    },
    [activeTool, drawingState, stageToImageNormalized, startDrawing,
     addPolygonPoint, addPoint, deselectAll, samPredictedMasks]
  )

  const handleStageMouseMove = useCallback(
    (e: KonvaEventObject<MouseEvent>) => {
      // Pan
      if (isPanning.current) {
        const dx = e.evt.clientX - lastPanPos.current.x
        const dy = e.evt.clientY - lastPanPos.current.y
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) panMoved.current = true
        lastPanPos.current = { x: e.evt.clientX, y: e.evt.clientY }
        setCanvasOffset({ x: canvasOffset.x + dx, y: canvasOffset.y + dy })
        return
      }

      if (!drawingState) return

      const stage = stageRef.current
      if (!stage) return

      const pointer = stage.getPointerPosition()
      if (!pointer) return

      const normalizedPoint = stageToImageNormalized(pointer.x, pointer.y)
      updateDrawing(normalizedPoint)
    },
    [drawingState, stageToImageNormalized, updateDrawing, canvasOffset, setCanvasOffset]
  )

  const handleStageMouseUp = useCallback(
    async () => {
      // Fin du pan. Clic molette sans déplacement → auto-ajustement (fit + centre).
      if (isPanning.current) {
        isPanning.current = false
        if (middlePan.current && !panMoved.current) resetZoom()
        middlePan.current = false
        return
      }

      if (!drawingState || activeTool !== 'bbox') return

      const { startPoint, currentPoint } = drawingState

      const minX = Math.min(startPoint.x, currentPoint.x)
      const maxX = Math.max(startPoint.x, currentPoint.x)
      const minY = Math.min(startPoint.y, currentPoint.y)
      const maxY = Math.max(startPoint.y, currentPoint.y)

      const w = maxX - minX
      const h = maxY - minY

      if (w < 0.005 || h < 0.005) {
        cancelDrawing()
        return
      }

      const cx = minX + w / 2
      const cy = minY + h / 2

      finishDrawing()

      if (activeClassId !== null) {
        await addAnnotation({
          class_id: activeClassId,
          annotation_type: 'bbox',
          cx,
          cy,
          width: w,
          height: h,
          confidence: 1.0,
          is_auto: false,
        })
      } else {
        warnNoClass()
      }
    },
    [drawingState, activeTool, activeClassId, addAnnotation, finishDrawing, cancelDrawing, resetZoom, warnNoClass]
  )

  // Double-clic : fermer un polygone OU accepter le meilleur masque SAM
  const handleStageDblClick = useCallback(async () => {
    // Accepter le meilleur masque SAM en double-cliquant
    if (activeTool === 'sam_point' && samPredictedMasks.length > 0 && activeClassId !== null) {
      const bestMask = samPredictedMasks[0]
      const [cx, cy, w, h] = bestMask.bbox_yolo
      const usePolygon = samOutputMode === 'segmentation' && bestMask.polygon.length > 0
      await addAnnotation({
        class_id: activeClassId,
        annotation_type: usePolygon ? 'polygon' : 'bbox',
        cx, cy, width: w, height: h,
        points: usePolygon ? bestMask.polygon : null,
        confidence: bestMask.score,
        is_auto: true,
        source_algorithm: 'sam_point',
      })
      setSamPredictedMasks([])
      clearPoints()
      toast.success(t('Masque SAM accepté'))
      return
    }

    // Fermer polygone
    if (activeTool !== 'polygon' || !drawingState) return

    const { points } = drawingState
    if (points.length < 3) {
      cancelDrawing()
      return
    }

    const xs = points.map((p) => p.x)
    const ys = points.map((p) => p.y)
    const minX = Math.min(...xs)
    const maxX = Math.max(...xs)
    const minY = Math.min(...ys)
    const maxY = Math.max(...ys)
    const cx = (minX + maxX) / 2
    const cy = (minY + maxY) / 2
    const w = maxX - minX
    const h = maxY - minY

    finishDrawing()

    if (activeClassId !== null) {
      await addAnnotation({
        class_id: activeClassId,
        annotation_type: 'polygon',
        cx, cy, width: w, height: h,
        points: points.map((p) => [p.x, p.y]),
        confidence: 1.0,
        is_auto: false,
      })
    } else {
      warnNoClass()
    }
  }, [activeTool, drawingState, activeClassId, addAnnotation, finishDrawing,
      cancelDrawing, samPredictedMasks, clearPoints, warnNoClass])

  // ---- Rendu du dessin en cours ----
  const renderDrawingPreview = () => {
    if (!drawingState) return null

    const scale = scaleToFit * canvasZoom
    const offsetX = canvasOffset.x
    const offsetY = canvasOffset.y

    if (activeTool === 'bbox') {
      const { startPoint, currentPoint } = drawingState
      const x1 = Math.min(startPoint.x, currentPoint.x) * imageWidth * scale + offsetX
      const y1 = Math.min(startPoint.y, currentPoint.y) * imageHeight * scale + offsetY
      const w = Math.abs(currentPoint.x - startPoint.x) * imageWidth * scale
      const h = Math.abs(currentPoint.y - startPoint.y) * imageHeight * scale

      const previewColor = classes.find((c) => c.id === activeClassId)?.color ?? '#3B82F6'

      return (
        <Rect
          x={x1} y={y1} width={w} height={h}
          stroke={previewColor} strokeWidth={2}
          fill={`${previewColor}22`} dash={[8, 4]}
          listening={false}
        />
      )
    }

    if (activeTool === 'polygon' && drawingState.points.length > 0) {
      const flatPoints = drawingState.points.flatMap((p) => [
        p.x * imageWidth * scale + offsetX,
        p.y * imageHeight * scale + offsetY,
      ])

      return (
        <Line
          points={flatPoints}
          stroke="#3B82F6" strokeWidth={2}
          fill="#3B82F622" closed={false}
          listening={false}
        />
      )
    }

    return null
  }

  // ---- Rendu des masques SAM streamés (SAM auto — propositions non validées) ----
  const [hoveredMaskIndex, setHoveredMaskIndex] = useState<number | null>(null)

  const renderSAMMasks = () => {
    const scale = scaleToFit * canvasZoom
    const clickable = !!onSAMMaskClick

    return streamedMasks.map((mask: SAMMask, i: number) => {
      const bbox = mask.bbox_yolo
      const x = (bbox[0] - bbox[2] / 2) * imageWidth * scale + canvasOffset.x
      const y = (bbox[1] - bbox[3] / 2) * imageHeight * scale + canvasOffset.y
      const w = bbox[2] * imageWidth * scale
      const h = bbox[3] * imageHeight * scale
      const isHovered = hoveredMaskIndex === i

      return (
        <Rect
          key={`auto-${i}`}
          x={x} y={y} width={w} height={h}
          stroke="#10B981" strokeWidth={isHovered ? 2.5 : 1.5}
          fill={isHovered ? '#10B98166' : '#10B98133'} dash={[6, 3]}
          listening={clickable}
          onClick={clickable ? () => onSAMMaskClick(i) : undefined}
          onTap={clickable ? () => onSAMMaskClick(i) : undefined}
          onMouseEnter={clickable ? () => setHoveredMaskIndex(i) : undefined}
          onMouseLeave={clickable ? () => setHoveredMaskIndex(null) : undefined}
        />
      )
    })
  }

  // ---- Rendu des masques prédits SAM point ----
  const renderSAMPointMasks = () => {
    if (activeTool !== 'sam_point') return null
    const scale = scaleToFit * canvasZoom

    return samPredictedMasks.map((mask, i) => {
      const bbox = mask.bbox_yolo
      const x = (bbox[0] - bbox[2] / 2) * imageWidth * scale + canvasOffset.x
      const y = (bbox[1] - bbox[3] / 2) * imageHeight * scale + canvasOffset.y
      const w = bbox[2] * imageWidth * scale
      const h = bbox[3] * imageHeight * scale
      const isFirst = i === 0

      // Si polygone disponible, le rendre
      if (mask.polygon.length > 2) {
        const flatPoints = normalizedPolygonToPixel(mask.polygon, imageWidth * scale, imageHeight * scale)
        const offsetFlat = flatPoints.map((v, idx) => idx % 2 === 0 ? v + canvasOffset.x : v + canvasOffset.y)
        return (
          <Line
            key={`sam-mask-${i}`}
            points={offsetFlat}
            closed stroke={isFirst ? '#10B981' : '#F59E0B'}
            strokeWidth={isFirst ? 2 : 1.5}
            fill={isFirst ? '#10B98133' : '#F59E0B22'}
            listening={false}
          />
        )
      }

      return (
        <Rect
          key={`sam-mask-${i}`}
          x={x} y={y} width={w} height={h}
          stroke={isFirst ? '#10B981' : '#F59E0B'}
          strokeWidth={isFirst ? 2 : 1.5}
          fill={isFirst ? '#10B98133' : '#F59E0B22'}
          dash={isFirst ? undefined : [5, 3]}
          listening={false}
        />
      )
    })
  }

  // Dimensions réelles de l'image affichée
  const displayWidth = imageWidth * scaleToFit * canvasZoom
  const displayHeight = imageHeight * scaleToFit * canvasZoom

  return (
    <div
      ref={containerRef}
      className="flex-1 relative overflow-hidden bg-slate-900"
      style={{
        backgroundColor: interfaceSettings?.background_color || undefined,
        cursor: activeTool === 'pan' ? 'grab'
          : activeTool === 'bbox' ? 'crosshair'
          : activeTool === 'sam_point' ? 'cell'
          : 'default'
      }}
    >
      {/* Indicateur SAM point prédit */}
      {isSAMPredicting && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20 bg-slate-800/90 text-green-400 text-xs px-3 py-1 rounded-full border border-green-500/30">
          {t('Prédiction SAM en cours...')}
        </div>
      )}
      {samPredictedMasks.length > 0 && activeTool === 'sam_point' && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 bg-slate-800/90 text-xs px-4 py-2 rounded-lg border border-slate-600 text-slate-200 shadow-lg">
          <span className="text-green-400 font-medium">{samPredictedMasks.length} {t('masque')}{samPredictedMasks.length > 1 ? 's' : ''}</span>
          {' '}{t('prédit')}{samPredictedMasks.length > 1 ? 's' : ''} — <kbd className="bg-slate-700 px-1 rounded">{t('Double-clic')}</kbd> {t('pour accepter le meilleur')}
          {' '}· <kbd className="bg-slate-700 px-1 rounded">{t('Échap')}</kbd> {t('pour annuler')}
        </div>
      )}

      <Stage
        ref={stageRef}
        width={containerSize.width}
        height={containerSize.height}
        onWheel={handleWheel}
        onMouseDown={handleStageMouseDown}
        onMouseMove={handleStageMouseMove}
        onMouseUp={handleStageMouseUp}
        onDblClick={handleStageDblClick}
      >
        {/* Layer 1 : Image de fond — displayImage = nouvelle frame ou ancienne si pas encore chargée */}
        <Layer>
          {displayImage && (
            <KonvaImage
              name="background-image"
              image={displayImage}
              x={canvasOffset.x}
              y={canvasOffset.y}
              width={displayWidth}
              height={displayHeight}
            />
          )}
        </Layer>

        {/* Layer 2 : Annotations — Group avec offset pour suivre le pan/zoom */}
        <Layer>
          <Group x={canvasOffset.x} y={canvasOffset.y}>
            {/* Boîtes englobantes */}
            {displayAnnotations
              .filter((a) => a.annotation_type === 'bbox')
              .map((ann) => (
                <BBoxShape
                  key={ann.id}
                  annotation={ann}
                  isSelected={selectedAnnotationIds.has(ann.id)}
                  isTrackingTarget={trackingTargetIds.has(ann.id)}
                  labelClass={classes.find((c) => c.id === ann.class_id)}
                  imageWidth={displayWidth}
                  imageHeight={displayHeight}
                  canvasScale={canvasZoom}
                  showLabel={showLabels}
                  showConfidence={showConfidence}
                  borderWidth={borderWidth}
                  fillOpacity={fillOpacity}
                  trackColor={ann.track_id ? trackInfoById.get(ann.track_id)?.color : undefined}
                  trackUid={ann.track_id ? trackInfoById.get(ann.track_id)?.uid ?? null : null}
                  onSelect={(id, multiSelect) => selectAnnotation(id, multiSelect)}
                  onUpdate={(id, cx, cy, w, h) => void updateAnnotation(id, { cx, cy, width: w, height: h })}
                  onDblClick={toggleTrackingTarget}
                />
              ))}

            {/* Polygones */}
            {displayAnnotations
              .filter((a) => a.annotation_type === 'polygon' && a.points && a.points.length > 2)
              .map((ann) => {
                const labelClass = classes.find((c) => c.id === ann.class_id)
                const color = labelClass?.color ?? '#3B82F6'
                const isSelected = selectedAnnotationIds.has(ann.id)
                const flatPoints = normalizedPolygonToPixel(
                  ann.points as [number, number][],
                  displayWidth,
                  displayHeight
                )
                const labelX = flatPoints[0] ?? 0
                // Coords déjà en pixels écran (Group non scalé) : pas de division
                // par canvasZoom, sinon tout enfle au dézoom.
                const labelY = (flatPoints[1] ?? 0) - 18
                const className = labelClass?.name ?? `class_${ann.class_id}`
                const confidenceText = showConfidence && ann.is_auto
                  ? ` ${(ann.confidence * 100).toFixed(0)}%`
                  : ''
                return (
                  <Group key={ann.id}>
                    <Line
                      points={flatPoints}
                      closed
                      stroke={color}
                      strokeWidth={isSelected ? borderWidth + 0.5 : borderWidth - 0.5}
                      fill={`${color}${fillAlpha}`}
                      onClick={() => selectAnnotation(ann.id, false)}
                      onTap={() => selectAnnotation(ann.id, false)}
                    />
                    {showLabels && (
                      <Text
                        x={labelX}
                        y={labelY}
                        text={`${className}${confidenceText}`}
                        fontSize={12}
                        fill="white"
                        padding={2}
                        background={color}
                        listening={false}
                      />
                    )}
                  </Group>
                )
              })}
          </Group>
        </Layer>

        {/* Layer 3 : Interaction (dessin, SAM) */}
        <Layer>
          {renderDrawingPreview()}
          {renderSAMMasks()}
          {renderSAMPointMasks()}

          {/* Points de prompt SAM */}
          {pendingPoints.map((pt, i) => {
            const px = pt.x * displayWidth + canvasOffset.x
            const py = pt.y * displayHeight + canvasOffset.y
            return (
              <Circle
                key={i}
                x={px} y={py} radius={6}
                fill={pt.label === 1 ? '#10B981' : '#EF4444'}
                stroke="white" strokeWidth={1.5}
                listening={false}
              />
            )
          })}
        </Layer>
      </Stage>
    </div>
  )
}
