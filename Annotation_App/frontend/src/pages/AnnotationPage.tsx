// ============================================================
// pages/AnnotationPage.tsx
// Page principale d'annotation : canvas + sidebar + timeline.
// Orchestre tous les composants et stores pour l'annotation.
// ============================================================

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  Download,
  MousePointer,
  RectangleHorizontal,
  Hexagon,
  Crosshair,
  Wand2,
  Hand,
  Type,
  Undo2,
  Redo2,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Loader2,
  Square,
  StopCircle,
  Play,
  Pause,
  RotateCcw,
  Upload,
  ChevronLeft,
  ChevronRight,
  Settings2,
  HelpCircle,
  SlidersHorizontal as LutIcon,
} from 'lucide-react'
import toast from 'react-hot-toast'

import { AnnotationCanvas } from '../components/canvas/AnnotationCanvas'
import LutPanel from '../components/panels/LutPanel'
import { Sidebar } from '../components/sidebar/Sidebar'
import { RightPanel } from '../components/sidebar/RightPanel'
import { UserBadge } from '../components/UserBadge'
import { Timeline } from '../components/timeline/Timeline'
import { ExportModal } from '../components/modals/ExportModal'
import { ImportModal } from '../components/modals/ImportModal'
import { SettingsModal } from '../components/modals/SettingsModal'
import { HelpModal } from '../components/modals/HelpModal'
import { useTour } from '../components/tour'
import {
  buildAnnotationTourSteps, TUTORIAL_KEY, type AnnotationTourContext,
} from '../components/help/annotationTourSteps'
import { LoadingSpinner } from '../components/common/LoadingSpinner'
import { useT } from '../i18n/useLang'

import { useProjectStore } from '../stores/projectStore'
import { useAnnotationStore } from '../stores/annotationStore'
import { useUIStore } from '../stores/uiStore'
import { useSAMStore } from '../stores/samStore'
import { useImportStore } from '../stores/importStore'
import { useSettingsStore } from '../stores/settingsStore'
import { writeTutorialState } from '../utils/tutorialState'
import { useBulkUndoStore } from '../stores/bulkUndoStore'
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts'
import { useAutoSave, downloadAnnotationBackup } from '../hooks/useAutoSave'

import { annotationsAPI, datasetAPI, projectsAPI, samAPI, sam3API, settingsAPI, taskAPI, trackingAPI } from '../services/api'
import { subscribeTaskProgress } from '../services/websocket'
import type { Frame, Sequence, TaskLiveFrameObject, ToolType } from '../types/api'

// ---- Map bornée (LRU) ----
// Même surface que Map pour les appelants (get/set/has/delete/clear), avec une
// éviction du plus ancien accès au-delà de `limit`. Une Map JS ordonne déjà ses
// clés par insertion : re-`set` après `delete` suffit à remonter une entrée en
// tête, pas besoin de structure chaînée.
class LruMap<K, V> {
  m = new Map<K, V>()
  limit: number
  constructor(limit: number) { this.limit = limit }
  get(k: K): V | undefined {
    const v = this.m.get(k)
    if (v !== undefined) { this.m.delete(k); this.m.set(k, v) }
    return v
  }
  has(k: K): boolean { return this.m.has(k) }
  set(k: K, v: V): this {
    this.m.delete(k)
    this.m.set(k, v)
    while (this.m.size > this.limit) this.m.delete(this.m.keys().next().value as K)
    return this
  }
  delete(k: K): boolean { return this.m.delete(k) }
  clear(): void { this.m.clear() }
  get size(): number { return this.m.size }
}

// ---- Lecture récursive d'un dossier d'annotations droppé (webkitGetAsEntry) ----
// Collecte les fichiers .txt (YOLO), .ver et data.yaml pour un import par upload.
const _entryToFile = (fileEntry: { file: (ok: (f: File) => void, err: (e: unknown) => void) => void }): Promise<File> =>
  new Promise((resolve, reject) => fileEntry.file(resolve, reject))

const readAnnotationFolder = async (dirEntry: unknown): Promise<File[]> => {
  const entry = dirEntry as { createReader: () => { readEntries: (cb: (entries: unknown[]) => void) => void } }
  const reader = entry.createReader()
  const out: File[] = []
  const readBatch = (): Promise<void> => new Promise((resolve) => {
    reader.readEntries(async (entries: unknown[]) => {
      if (entries.length === 0) { resolve(); return }
      for (const e of entries) {
        const en = e as { isFile: boolean; isDirectory: boolean; file: (ok: (f: File) => void, err: (e: unknown) => void) => void }
        if (en.isFile) {
          const f = await _entryToFile(en)
          if (/\.(txt|ver|ya?ml)$/i.test(f.name)) out.push(f)
        } else if (en.isDirectory) {
          out.push(...await readAnnotationFolder(e))
        }
      }
      await readBatch()   // readEntries se lit par lots → rappeler jusqu'à vide
      resolve()
    })
  })
  await readBatch()
  return out
}

// ---- Définition des outils ----

const TOOLS: { id: ToolType; label: string; icon: React.ReactNode; shortcut: string }[] = [
  { id: 'select', label: 'Sélection', icon: <MousePointer size={15} />, shortcut: 'V' },
  { id: 'pan', label: 'Panorama', icon: <Hand size={15} />, shortcut: 'Space' },
  { id: 'bbox', label: 'Rectangle', icon: <RectangleHorizontal size={15} />, shortcut: 'R' },
  { id: 'polygon', label: 'Polygone', icon: <Hexagon size={15} />, shortcut: 'P' },
  { id: 'sam_point', label: 'SAM Point', icon: <Crosshair size={15} />, shortcut: 'S' },
  { id: 'sam_auto', label: 'SAM Auto', icon: <Wand2 size={15} />, shortcut: 'A' },
]

export const AnnotationPage: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const numericProjectId = parseInt(projectId ?? '0')
  const { start: startTour } = useTour()
  const t = useT()

  // ---- Stores ----
  const {
    currentProject,
    frames,
    totalFrames,
    frameFloor,
    currentFrameIndex,
    fetchProject,
    fetchFrames,
    ensureFrameLoaded,
    setCurrentFrameIndex,
    getCurrentFrame,
    markFramesAsExtracted,
    setFrameAnnotationCount,
    markFrameRangeAnnotated,
    saveSession,
  } = useProjectStore()

  const {
    annotations,
    activeTool,
    setActiveTool,
    undo,
    redo,
    undoStack,
    redoStack,
    loadAnnotations,
    clearAnnotations,
    addAnnotation,
    bulkAddAnnotations,
    deleteAnnotation,
    deleteAllAnnotations,
  } = useAnnotationStore()

  const { canvasZoom, setCanvasZoom, setCanvasOffset } = useUIStore()
  const isLutOpen = useUIStore((s) => s.isLutOpen)
  const toggleLut = useUIStore((s) => s.toggleLut)
  const lutSignature = useUIStore((s) => s.lutSignature)
  const withLut = (url: string) => `${url}${url.includes('?') ? '&' : '?'}lut=${lutSignature}`
  // Coquille Electron (chemin natif) : window.__ANNOTATION_APP_NATIVE__ n'existe que dans
  // ce shell (expose via preloadApp.ts, contextBridge). En page web classique, ce flag est
  // absent -> comportement HTTP inchange, aucune difference de trafic.
  const isNativeShell = typeof window !== 'undefined' && !!(window as unknown as { __ANNOTATION_APP_NATIVE__?: boolean }).__ANNOTATION_APP_NATIVE__
  const frameImageUrl = (id: number, tier: 'preview' | 'display' | 'full') => {
    const suffix = tier === 'preview' ? '?preview=1' : tier === 'display' ? '?display=1' : ''
    if (isNativeShell) {
      // app-image:// generique (desktop/src/imageProtocol.ts) : c'est CE frontend qui
      // fournit les deux urls absolues (son propre backend, port connu via
      // VITE_BACKEND_PORT injecte par launcher.py) -- Electron ne connait ni cette app
      // ni ses routes, il fait juste imagePath -> chemin natif -> repli fallback.
      // withLut() ICI AUSSI (pas juste sur la branche web plus bas) : le cache
      // memoire d'imageProtocol.ts indexe par l'URL app-image:// complete --
      // sans le parametre lut dedans, changer la LUT ne change pas cette URL,
      // donc le cache sert indefiniment le premier rendu (LUT par defaut),
      // meme si le backend regenere bien un fichier a jour de son cote (verifie
      // dans dataset.py: resolve_frame_image_path calcule la LUT effective a
      // chaque appel). Repere sur des sources 8/16 bits ou la LUT n'est pas
      // cosmetique -- bouger le curseur n'avait plus aucun effet visible.
      const backendBase = `http://127.0.0.1:${import.meta.env.VITE_BACKEND_PORT ?? 8000}`
      const imagePath = withLut(`${backendBase}/api/frames/${id}/image-path${suffix}`)
      const fallback = withLut(`${backendBase}/api/frames/${id}/image${suffix}`)
      return `app-image://native/?imagePath=${encodeURIComponent(imagePath)}&fallback=${encodeURIComponent(fallback)}`
    }
    return withLut(`/api/frames/${id}/image${suffix}`)
  }

  // Variante utilisee par le canvas. Pendant une propagation, le backend pousse
  // dans chaque message WebSocket le chemin natif du JPEG qu'il vient d'ecrire
  // pour cette frame (8 bits, LUT deja appliquee -- l'image que SAM2 consomme).
  // Le passer directement a app-image:// evite les DEUX requetes HTTP habituelles
  // (GET /image-path puis GET /image) : Electron lit le fichier par SMB, hors
  // tunnel SSH et sans consommer un des 6 creneaux de connexion par origine.
  // C'est exactement ce trafic-la qui entrait en concurrence avec les requetes
  // vitales (stop, annotations) et rendait le suivi temps reel intenable.
  // Hors propagation, ou si aucun chemin natif n'est connu (montage indisponible,
  // page web classique), on retombe sur frameImageUrl() sans rien changer.
  const liveFrameImageUrl = (id: number, tier: 'preview' | 'display' | 'full') => {
    const nativePath = liveNativePathRef.current.get(id)
    if (!isNativeShell || !nativePath || propagationTaskId == null) {
      return frameImageUrl(id, tier)
    }
    const backendBase = `http://127.0.0.1:${import.meta.env.VITE_BACKEND_PORT ?? 8000}`
    const suffix = tier === 'preview' ? '?preview=1' : tier === 'display' ? '?display=1' : ''
    // Le repli reste une vraie url HTTP : si le fichier temporaire a deja ete
    // nettoye (fin de run), imageProtocol.ts bascule dessus tout seul.
    const fallback = withLut(`${backendBase}/api/frames/${id}/image${suffix}`)
    return `app-image://native/?nativePath=${encodeURIComponent(nativePath)}`
      + `&fallback=${encodeURIComponent(fallback)}`
  }

  const activeClassId = useAnnotationStore((s) => s.activeClassId)
  const samStore = useSAMStore()
  // Imports de séquences en tâche de fond (survivent à la fermeture du modal)
  const importJobs = useImportStore((s) => s.jobs)
  const importRunning = useImportStore((s) => s.running)

  // ---- État local ----
  const [tracks, setTracks] = useState<import('../types/api').Track[]>([])
  // Multi-séquence : liste des séquences du projet.
  const [sequences, setSequences] = useState<Sequence[]>([])
  // ---- Propagation (guided + homographie) — barre top bar ----
  // Lazy-init depuis localStorage : si une tâche tournait avant un reload web, la
  // barre + le bouton Stop réapparaissent immédiatement (le poller reprend le suivi).
  const [propagationTaskId, setPropagationTaskId] = useState<string | null>(
    () => localStorage.getItem(`annot_prop_task_${numericProjectId}`) || null
  )
  const [propagationProgress, setPropagationProgress] = useState(0)
  const [propagationLabel, setPropagationLabel] = useState(
    () => localStorage.getItem(`annot_prop_label_${numericProjectId}`) || ''
  )
  const [frameJumpInput, setFrameJumpInput] = useState('')   // saut direct à une frame (S7)
  const [propagationStatus, setPropagationStatus] = useState('')
  const [showExport, setShowExport] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [isLoadingFrame, setIsLoadingFrame] = useState(false)

  // ---- Texte / Grounding DINO / SAM3 ----
  const [textPrompt, setTextPrompt] = useState('')
  const [showTextPrompt, setShowTextPrompt] = useState(false)
  const [isRunningText, setIsRunningText] = useState(false)
  const algoSettings = useSettingsStore((s) => s.settings?.algorithms)
  const algoLoaded = useSettingsStore((s) => s.loaded)
  const [boxThreshold, setBoxThreshold] = useState(algoSettings?.grounding_dino_box_threshold ?? 0.35)
  const [textThreshold, setTextThreshold] = useState(algoSettings?.grounding_dino_text_threshold ?? 0.25)
  const [sam3BoxThreshold, setSam3BoxThreshold] = useState(algoSettings?.sam3_box_threshold ?? 0.25)
  const [sam3TextThreshold, setSam3TextThreshold] = useState(algoSettings?.sam3_text_threshold ?? 0.20)
  useEffect(() => {
    if (!algoLoaded || !algoSettings) return
    setBoxThreshold(algoSettings.grounding_dino_box_threshold ?? 0.30)
    setTextThreshold(algoSettings.grounding_dino_text_threshold ?? 0.25)
    setSam3BoxThreshold(algoSettings.sam3_box_threshold ?? 0.25)
    setSam3TextThreshold(algoSettings.sam3_text_threshold ?? 0.20)
    setSamOutputMode(algoSettings.grounding_dino_use_sam_refine ? 'segmentation' : 'bbox')
  }, [algoLoaded]) // eslint-disable-line

  // Applique l'OUTIL PAR DÉFAUT des paramètres au premier chargement des settings.
  // Sans ça, activeTool restait sur 'select' (valeur initiale du store) quel que
  // soit le réglage « Outil par défaut » → l'utilisateur n'arrivait jamais sur bbox.
  // Guard par ref : une seule application au démarrage (ne réécrase pas un choix
  // manuel ultérieur, ni à chaque re-render).
  const defaultToolAppliedRef = useRef(false)
  const defaultTool = useSettingsStore((s) => s.settings?.interface?.default_tool)
  useEffect(() => {
    if (!algoLoaded || defaultToolAppliedRef.current) return
    defaultToolAppliedRef.current = true
    if (defaultTool) setActiveTool(defaultTool as ToolType)
  }, [algoLoaded, defaultTool, setActiveTool])
  // Sélection du modèle de détection texte : 'gd' = Grounding DINO, 'sam3' = SAM3
  const [textModel, setTextModel] = useState<'gd' | 'sam3'>('gd')

  // Mode de sortie COMMUN a tout ce qui produit des annotations automatiques
  // depuis la barre d'outils : SAM Auto, Grounding DINO et SAM3.
  // 'segmentation' = on veut un polygone (GD passe alors par un raffinement
  // SAM2, seul chemin qui produit reellement un contour) ; 'bbox' = boites
  // brutes. Deux cases "Poly" separees doublonnaient auparavant ce choix.
  const [samOutputMode, setSamOutputMode] = useState<'bbox' | 'segmentation'>('bbox')
  const wantPolygon = samOutputMode === 'segmentation'

  // ---- SAM Auto popup ----
  const [samAutoStatus, setSamAutoStatus] = useState<'idle' | 'connecting' | 'running' | 'done'>('idle')
  const [samAutoCount, setSamAutoCount] = useState(0)

  // ---- Mode Auto Vidéo (batch texte sur plage de frames) ----
  const [autoModeRunning, setAutoModeRunning] = useState(false)
  const [autoModePaused, setAutoModePaused] = useState(false)
  const autoModeStopRef = useRef(false)
  const autoModePauseRef = useRef(false)
  const [autoModeProgress, setAutoModeProgress] = useState({ current: 0, total: 0 })
  // Plage de frames pour le batch (indices inclusifs)
  const [batchStartIndex, setBatchStartIndex] = useState<number | string>('')
  const [batchEndIndex, setBatchEndIndex] = useState<number | string>('')
  const [showBatchRange, setShowBatchRange] = useState(false)

  // ---- Scrubbing slider (défilement rapide sans charger les annotations) ----
  const [isScrubbing, setIsScrubbing] = useState(false)
  // Position VISUELLE du curseur pendant le drag (mise à jour à chaque pixel,
  // sans coût réseau). L'index réel (qui déclenche le chargement d'image) est
  // throttlé → une image toutes les ~130 ms au lieu d'une par frame survolée.
  const [dragValue, setDragValue] = useState<number | null>(null)
  const scrubThrottleRef = useRef<{ last: number; timer: ReturnType<typeof setTimeout> | null }>({ last: 0, timer: null })

  // ---- Lecture vidéo (debug review) ----
  const [isPlaying, setIsPlaying] = useState(false)
  const [playFps, setPlayFps] = useState(3)
  const playIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const playFrameRef = useRef(0)  // index courant pendant la lecture (évite la closure stale)

  // ---- Extraction vidéo en arrière-plan (après import) ----
  const [extractionTaskId, setExtractionTaskId] = useState<string | null>(null)
  const [extractionProgress, setExtractionProgress] = useState(0)
  const [extractionMessage, setExtractionMessage] = useState('')

  // ---- Drag & Drop pour restaurer annotations ----
  const [isDragOver, setIsDragOver] = useState(false)

  // Debounce session save — évite un appel API à chaque touche de navigation
  const sessionSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Prefetch images — AbortController pour le prefetch annotations
  const imgPrefetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const annPrefetchAbortRef = useRef<AbortController | null>(null)

  // Cache mémoire des annotations par frame_id — chargé lazily à chaque frame.
  // Borné (LRU) : c'était une Map nue, jamais purgée en dehors d'un changement
  // de projet. Sur une séquence de plusieurs milliers de frames, naviguer +
  // prefetcher les voisines finissait par retenir les annotations de TOUTES les
  // frames visitées — une part directe des 1 à 2 Go de RAM observés en fin de
  // session. 600 frames couvrent très largement le voisinage utile (prefetch +
  // aller-retours), les entrées évincées se rechargent en une requête.
  const annotationsCacheRef = useRef(new LruMap<number, import('../types/api').Annotation[]>(600))
  // Dernier frame_index vu pendant une propagation (remplissage timeline par plage)
  const lastPropagatedIndexRef = useRef<number | null>(null)
  const totalFrameCount = Math.max(totalFrames, currentProject?.frame_count ?? 0, frames.length, frameFloor)

  // ---- Chargement initial : isolation stricte entre projets ----
  useEffect(() => {
    // On efface les annotations du projet précédent AVANT de charger le nouveau
    clearAnnotations()
    useProjectStore.getState().setFrameFloor(0)   // reset plancher séquences (nouveau projet)
    annotationsCacheRef.current.clear()  // vider le cache de l'ancien projet
    void fetchProject(numericProjectId)
    void fetchFrames(numericProjectId)
    void loadTracks()
    void loadSequences()
    // Reprise des séquences (chemin serveur) laissées en attente avant un reload (step 1)
    useImportStore.getState().resumePending(numericProjectId, () => {
      void fetchFrames(numericProjectId)
      void fetchProject(numericProjectId)
      void loadSequences()
    })
  }, [numericProjectId])

  // Rattrapage au montage (S2a) : si un import tournait encore côté backend au
  // moment d'un reload web, ses frames continuent d'arriver mais le frontend ne les
  // suit plus. On resynchronise séquences (→ frameFloor, donc switch possible) toutes
  // les 3 s pendant ~24 s ; on ne recharge les frames QUE si le total a grandi (projet
  // stable = quasi aucun coût). Robuste même si on reload avant la fin de l'import.
  useEffect(() => {
    let prevFloor = -1
    let ticks = 0
    const iv = setInterval(async () => {
      ticks += 1
      await loadSequences()
      const floor = useProjectStore.getState().frameFloor
      if (floor !== prevFloor) { prevFloor = floor; void fetchFrames(numericProjectId) }
      if (ticks >= 8) clearInterval(iv)
    }, 3000)
    return () => clearInterval(iv)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numericProjectId])

  // Rafraîchir les tracks quand une suppression (undo, deleteSelected, bulk-replace)
  // a pu vider une piste : le backend l'a supprimée + renuméroté les uids (step 3).
  const tracksDirty = useAnnotationStore((s) => s.tracksDirty)
  useEffect(() => {
    if (tracksDirty > 0) void loadTracks()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracksDirty])

  // Navigation sparse : si l'utilisateur saute a F2400 alors que seule une
  // fenetre de frames est en memoire, on charge la frame exacte par index.
  useEffect(() => {
    if (!numericProjectId || totalFrameCount <= 0) return
    if (frames.some((frame) => frame.frame_index === currentFrameIndex)) return
    void ensureFrameLoaded(numericProjectId, currentFrameIndex)
  }, [currentFrameIndex, ensureFrameLoaded, frames, numericProjectId, totalFrameCount])

  // ---- Chargement des annotations à chaque changement de frame ----
  // Fetch ANNULABLE (fetch()+AbortController), y compris pendant le scrub/lecture : même
  // gabarit que useCancellableLiveImage pour les images. Avant, le scrub coupait purement
  // et simplement cet appel (pour ne pas saturer les 6 connexions du navigateur) — mais ça
  // gelait le compteur de la timeline ET les annotations affichées sur des frames jamais
  // visitées pendant le scrub. Avec l'annulation reelle de la requete precedente a chaque
  // nouvelle frame (au lieu d'un simple skip), aucune requete ne s'empile — meme garantie
  // que pour les images, pour un payload JSON bien plus leger.
  useEffect(() => {
    const frame = getCurrentFrame()
    if (!frame) return

    // Pendant une propagation, le buffer WebSocket ci-dessous est l'unique
    // source du canvas. Ce garde doit preceder MEME le cache hit : une frame
    // live pas encore commitee peut avoir 1 bbox alors que le cache DB en a 0.
    // Alterner cache(0) et live(1) modifiait `frames` a chaque passage et faisait
    // reboucler les deux effets jusqu'a "Maximum update depth exceeded".
    if (propagationTaskId != null) return

    // Cache hit : affichage instantané depuis le cache mémoire (sans attendre l'API)
    const cached = annotationsCacheRef.current.get(frame.id)
    if (cached !== undefined) {
      loadAnnotations(frame.id, cached)
      setIsLoadingFrame(false)
    }

    // Refresh API en arrière-plan — maintient le cache à jour et corrige les miss.
    // fetch() direct (pas axios) : annulation réelle de la requête réseau précédente,
    // pas juste ignorée à l'arrivée.
    const controller = new AbortController()
    const frameId = frame.id
    const arrIdxAtRequest = currentFrameIndex
    samStore.clearStreamedMasks()
    fetch(`/api/frames/${frameId}/annotations`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json() as Promise<import('../types/api').Annotation[]>
      })
      .then((anns) => {
        // Le batch texte a deja publie cette frame : sa liste est plus fraiche
        // que cette reponse, partie avant la detection.
        if (batchCommittedRef.current.has(frameId)) return
        annotationsCacheRef.current.set(frameId, anns)  // mettre le cache à jour
        // Timeline : compteur toujours synchronisé avec la DB, meme si on a deja quitte
        // cette frame (scrub rapide) — c'est ce qui manquait pour que la timeline suive
        // vraiment le scrub au lieu de rester figee sur les dernieres frames visitees.
        setFrameAnnotationCount(frameId, anns.length)
        // Canvas : n'afficher que si l'utilisateur est encore sur cette frame (garde deja
        // utilisee ailleurs, ex. handleForceAnnotationRefresh) — evite qu'une reponse
        // tardive n'ecrase le canvas avec les annotations de la mauvaise frame.
        if (useProjectStore.getState().currentFrameIndex === arrIdxAtRequest) {
          loadAnnotations(frameId, anns)
          setIsLoadingFrame(false)
        }
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return
        console.error(err)
        if (useProjectStore.getState().currentFrameIndex === arrIdxAtRequest) setIsLoadingFrame(false)
      })

    return () => controller.abort()
  }, [currentFrameIndex, frames, propagationTaskId])

  // ---- Prefetch images des frames adjacentes (réchauffe le cache navigateur) ----
  // Déclenché 120 ms après chaque navigation pour ne pas concurrencer le chargement courant.
  // Avec Cache-Control: max-age=3600 côté backend, le navigateur servira les frames suivantes
  // depuis son cache disque — latence quasi nulle même sur SSH/port-forward.
  useEffect(() => {
    // Pendant le scrubbing : AUCUN prefetch. La limite de 6 connexions du
    // navigateur ferait passer l'image de la frame ciblée DERRIÈRE des dizaines
    // de requêtes de voisinage → 10 s d'attente + mauvaise frame affichée.
    // Le scrub charge uniquement la preview de la position courante (throttlée).
    if (isScrubbing) return
    // Pendant la propagation (SAMURAI/SAM2, détection, homographie) : le canvas
    // affiche déjà la preview 480px (~15 Ko). Prefetcher des images display 1600px
    // à chaque frame propagée saturerait l'event loop backend (contention threadpool
    // avec le worker GPU → pics à 10-13 s/it + timeouts). On coupe donc le prefetch.
    if (propagationTaskId != null) return
    if (imgPrefetchTimerRef.current) clearTimeout(imgPrefetchTimerRef.current)

    // Lecture (play) : le canvas affiche le palier preview (480px, ~3 Ko) qui se
    // charge en <50 ms → la frame suit vraiment le rythme fps. On réchauffe DE
    // SUITE les prochaines frames en preview (pas de setTimeout : à 5 fps il n'aurait
    // pas le temps de se déclencher) pour que chacune soit déjà en cache navigateur.
    if (isPlaying) {
      for (const offset of [1, 2, 3, 4]) {
        const adj = frames.find((f) => f.frame_index === currentFrameIndex + offset)
        if (adj && adj.is_extracted !== false) {
          const img = new window.Image()
          img.src = frameImageUrl(adj.id, 'preview')
        }
      }
      return
    }

    imgPrefetchTimerRef.current = setTimeout(() => {
      // Réchauffe le MÊME palier que le canvas affichera (display 1600px au zoom
      // ajusté, source pleine résolution au zoom fort) — sinon on charge en pure
      // perte une version que le canvas ne demandera pas.
      const tier = canvasZoom > 1.5 ? 'full' : 'display'
      for (const offset of [1, -1]) {
        const adj = frames.find((f) => f.frame_index === currentFrameIndex + offset)
        if (adj && adj.is_extracted !== false) {
          const img = new window.Image()
          img.src = frameImageUrl(adj.id, tier)
        }
      }
    }, 200)
    return () => { if (imgPrefetchTimerRef.current) clearTimeout(imgPrefetchTimerRef.current) }
  }, [currentFrameIndex, frames, isScrubbing, isPlaying, propagationTaskId])

  // ---- Prefetch annotations des frames adjacentes (cache mémoire) ----
  // Rend la navigation instantanée : quand on appuie sur →, les annotations de la frame
  // suivante sont déjà dans annotationsCacheRef → affichage immédiat sans attente API.
  useEffect(() => {
    if (annPrefetchAbortRef.current) annPrefetchAbortRef.current.abort()
    // Pas de prefetch d'annotations pendant le scrub (on ne fait que défiler)
    if (isScrubbing) return
    // Pendant la propagation : handleForceAnnotationRefresh charge déjà les
    // annotations de la frame courante. Prefetcher les voisines ajouterait des
    // requêtes concurrentes qui affament l'event loop backend pendant le run GPU.
    if (propagationTaskId != null) return
    const ctrl = new AbortController()
    annPrefetchAbortRef.current = ctrl
    const run = async () => {
      // Délai court pour laisser la frame courante charger en priorité
      await new Promise((r) => setTimeout(r, 180))
      for (const offset of [1, 2, -1]) {
        if (ctrl.signal.aborted) break
        const adj = frames.find((f) => f.frame_index === currentFrameIndex + offset)
        if (!adj || annotationsCacheRef.current.has(adj.id)) continue
        try {
          const res = await fetch(`/api/frames/${adj.id}/annotations`, { signal: ctrl.signal })
          if (!res.ok || ctrl.signal.aborted) break
          const anns: import('../types/api').Annotation[] = await res.json()
          annotationsCacheRef.current.set(adj.id, anns)
        } catch { /* abort ou réseau — silencieux */ }
      }
    }
    void run()
    return () => ctrl.abort()
  }, [currentFrameIndex, frames, isScrubbing, propagationTaskId])

  // Extraction paresseuse autour de la frame active. La timeline peut scrubber vite :
  // le timeout annule les anciennes demandes et evite de chercher toutes les frames.
  useEffect(() => {
    const frame = getCurrentFrame()
    if (!frame || frame.is_extracted) return
    const timer = window.setTimeout(() => {
      void datasetAPI
        .ensureExtracted(numericProjectId, frame.frame_index, isScrubbing ? 0 : 2)
        .then((res) => {
          if (res.extracted.length > 0) markFramesAsExtracted(res.extracted)
        })
        .catch(() => { /* silencieux : l'image placeholder reste visible */ })
    }, isScrubbing ? 250 : 80)
    return () => window.clearTimeout(timer)
  }, [currentFrameIndex, frames, isScrubbing, numericProjectId, getCurrentFrame, markFramesAsExtracted])

  // ---- Reset isScrubbing si le pointeur est relâché n'importe où ----
  useEffect(() => {
    if (!isScrubbing) return
    const reset = () => setIsScrubbing(false)
    window.addEventListener('pointerup', reset)
    window.addEventListener('pointercancel', reset)
    return () => {
      window.removeEventListener('pointerup', reset)
      window.removeEventListener('pointercancel', reset)
    }
  }, [isScrubbing])

  // ---- Lecture automatique frame par frame ----
  useEffect(() => {
    if (playIntervalRef.current) {
      clearInterval(playIntervalRef.current)
      playIntervalRef.current = null
    }
    if (!isPlaying || totalFrameCount === 0) return

    playFrameRef.current = currentFrameIndex
    playIntervalRef.current = setInterval(() => {
      playFrameRef.current += 1
      if (playFrameRef.current >= totalFrameCount) {
        // Fin de séquence : stop
        setIsPlaying(false)
        return
      }
      setCurrentFrameIndex(playFrameRef.current)
    }, 1000 / playFps)

    return () => {
      if (playIntervalRef.current) clearInterval(playIntervalRef.current)
    }
  }, [isPlaying, playFps, totalFrameCount])  // eslint-disable-line react-hooks/exhaustive-deps

  const handlePlayPause = () => {
    if (currentFrameIndex >= totalFrameCount - 1 && !isPlaying) {
      // Restart si on est à la fin
      setCurrentFrameIndex(0)
      playFrameRef.current = 0
    }
    setIsPlaying((p) => !p)
  }

  const handleRestart = () => {
    setIsPlaying(false)
    setCurrentFrameIndex(0)
    playFrameRef.current = 0
  }

  const loadTracks = async () => {
    try {
      const t = await trackingAPI.list(numericProjectId, false)
      setTracks(t)
    } catch (e) {
      console.error('[AnnotationPage] Erreur chargement tracks:', e)
    }
  }

  // Multi-séquence : liste des séquences avec stats d'annotation
  const loadSequences = async () => {
    try {
      const seqs = await datasetAPI.listSequences(numericProjectId)
      setSequences(seqs)
      // Plancher de navigation = extent max des séquences connues. Permet de switcher
      // vers une séquence même si ses frames ne sont pas encore chargées/importées
      // (sinon le clamp ramène dans la 1re séquence). Math.max(frame_count,1) autorise
      // déjà l'accès au start_index d'une séquence en cours d'import (frame_count=0).
      const floor = seqs.reduce((m, s) => Math.max(m, s.start_index + Math.max(s.frame_count, 1)), 0)
      useProjectStore.getState().setFrameFloor(floor)
    } catch (e) {
      console.error('[AnnotationPage] Erreur chargement séquences:', e)
    }
  }

  // Séquence courante = celle dont la plage contient la frame courante
  const currentSequence = sequences.find(
    (s) => currentFrameIndex >= s.start_index && currentFrameIndex < s.start_index + s.frame_count
  ) ?? null

  // Import d'annotations .ver / YOLO sur la séquence courante (S9)
  const handleImportSeqAnnotations = async () => {
    const seq = sequences.find(
      (s) => currentFrameIndex >= s.start_index && currentFrameIndex < s.start_index + s.frame_count
    )
    if (!seq || seq.id == null) { toast.error(t('Sélectionnez une séquence')); return }
    const path = window.prompt(
      `${t('Importer des annotations sur')} « ${seq.name} »\n\n` +
      `${t("Chemin serveur d'un fichier .ver OU d'un dossier YOLO (.txt) :")}`
    )
    if (!path || !path.trim()) return
    const replace = window.confirm(t('Remplacer les annotations existantes de cette séquence ?\n(OK = remplacer, Annuler = ajouter)'))
    try {
      const res = await datasetAPI.importSequenceAnnotations(numericProjectId, seq.id, { path: path.trim(), replace })
      toast.success(`${res.annotations_created} ${t('annotations importées')} (${res.format}) ${t('sur')} ${res.frames_annotated} frames`)
      await refreshTracksAndFrame()
      const frame = getCurrentFrame()
      if (frame) {
        const anns = await annotationsAPI.list(frame.id)
        annotationsCacheRef.current.set(frame.id, anns)
        loadAnnotations(frame.id, anns)
      }
      void loadSequences()
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? t('Erreur')
      toast.error(`${t('Import annotations')} : ${msg}`)
    }
  }

  // Pistes DÉCORRÉLÉES : on ne montre que celles de la séquence courante (timeline,
  // liste d'annotations, onglet Tracks). Une nouvelle séquence est vierge. (S2b/c)
  const currentSeqId = currentSequence?.id ?? null
  const sequenceTracks = useMemo(
    () => tracks.filter((t) => (t.sequence_id ?? null) === currentSeqId),
    [tracks, currentSeqId],
  )

  // Bornes du slider : RELATIVES à la séquence courante quand il y en a
  // (sinon on affichait 0→2894 alors que seq2 fait 100 frames → confus).
  // La navigation reste dans la séquence ; le dropdown change de séquence.
  const sliderMin = currentSequence ? currentSequence.start_index : 0
  const sliderMax = currentSequence
    ? currentSequence.start_index + currentSequence.frame_count - 1
    : Math.max(0, totalFrameCount - 1)
  const seqLocalIndex = currentFrameIndex - sliderMin
  const seqLocalCount = currentSequence ? currentSequence.frame_count : totalFrameCount

  // Auto-track : en projet VIDÉO, le backend crée une piste pour chaque annotation
  // manuelle. Dès qu'une annotation référence une piste inconnue, on recharge la
  // liste des tracks pour l'afficher dans la timeline et la liste.
  const liveAnnotations = useAnnotationStore((s) => s.annotations)
  const loadedUnknownTracksRef = useRef<string>('')
  useEffect(() => {
    const known = new Set(tracks.map((t) => t.id))
    const unknown = liveAnnotations
      .map((a) => a.track_id)
      .filter((id): id is number => id != null && !known.has(id))
    if (unknown.length === 0) return
    // Ne recharger qu'UNE fois par ensemble d'ids inconnus : si loadTracks ne les
    // renvoie pas (annotation orpheline), on ne reboucle pas indéfiniment.
    const key = [...new Set(unknown)].sort((a, b) => a - b).join(',')
    if (key === loadedUnknownTracksRef.current) return
    loadedUnknownTracksRef.current = key
    void loadTracks()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveAnnotations, tracks])

  // ---- Rafraîchissement forcé des annotations (depuis TrackPanel pendant le tracking) ----
  // - fetch() direct : pas d'intercepteur axios (pas de toast d'erreur, pas de timeout 30s)
  // - Chemin dédié, distinct de l'effet de chargement par frame (celui-ci se coupe pendant
  //   une propagation, cf. `if (propagationTaskId != null) return` plus haut)
  // - Appelé par TrackPanel après chaque navigation : le polling ATTEND cette promesse
  //   avant de passer à la frame suivante → même expérience que le mode batch
  const handleForceAnnotationRefresh = useCallback(async (arrIdx: number) => {
    const frame = frames.find((f) => f.frame_index === arrIdx) ?? frames[arrIdx]
    if (!frame) return
    try {
      const res = await fetch(`/api/frames/${frame.id}/annotations`)
      if (!res.ok) return
      const anns: import('../types/api').Annotation[] = await res.json()
      // Toujours mettre à jour le cache (utile pour les navigations futures)
      annotationsCacheRef.current.set(frame.id, anns)
      // Timeline live : refléter le nouveau compteur dans le tableau frames
      // (sinon la case reste à son ancienne valeur dès qu'on quitte la frame)
      setFrameAnnotationCount(frame.id, anns.length)
      // Le polling est throttlé : il saute des frames que la propagation a bel et
      // bien annotées. Sans ça leurs cases restent rouges jusqu'à la fin de tâche.
      const prev = lastPropagatedIndexRef.current
      if (anns.length > 0 && prev !== null && arrIdx > prev && arrIdx - prev <= 500) {
        markFrameRangeAnnotated(prev, arrIdx, anns.length)
      }
      lastPropagatedIndexRef.current = arrIdx
      // N'afficher sur le canvas que si l'utilisateur est encore sur cette frame.
      // Guard critique : évite que des réponses en retard écrasent le store avec
      // des annotations de la mauvaise frame (notamment en mode fire-and-forget).
      const currentIdx = useProjectStore.getState().currentFrameIndex
      if (currentIdx === arrIdx) {
        loadAnnotations(frame.id, anns)
      }
    } catch { /* silencieux */ }
  }, [frames, loadAnnotations, setFrameAnnotationCount, markFrameRangeAnnotated])

  // ---- Apercu live SAM2/SAMURAI (depuis le WS, sans GET) ----
  // Meme role que handleForceAnnotationRefresh ci-dessus, mais les donnees
  // viennent directement du message WS (live_frame, deja calcule cote serveur
  // pendant la propagation) au lieu d'un GET /annotations. Necessaire car les
  // ecritures DB de la propagation SAM2/SAMURAI sont groupees par lots de 10
  // frames (backend) : un GET juste apres avoir navigue sur une frame fraiche
  // pourrait la trouver vide/perimee tant que son lot n'est pas flush.
  // Les annotations affichees ont un id NEGATIF synthetique — jamais ecrites
  // dans annotationsCacheRef (qui doit rester fidele a la DB) : des qu'on
  // quitte puis revient sur la frame normalement, le chargement standard
  // reprend la main et affiche les vraies annotations commitees.
  // Chemins natifs des frames en cours de propagation, pousses par le WS.
  // Borne volontairement petit : seule la frame affichee sert, et ces fichiers
  // vivent dans le dossier temporaire du run (supprime a la fin) -- garder plus
  // ne servirait qu'a pointer vers des fichiers disparus.
  const liveNativePathRef = useRef<Map<number, string>>(new Map())
  // Annotations d'apercu recues par le WS, en attente que le canvas arrive sur
  // leur frame. Sans ce tampon elles etaient PERDUES : handleLiveFramePreview ne
  // les appliquait que si le canvas etait DEJA sur la frame concernee, alors que
  // la navigation est throttlee (cf. propagation_nav_throttle_ms) et arrive donc
  // presque toujours APRES. Resultat : l'image avancait mais les boites
  // n'apparaissaient qu'au flush DB suivant. Meme bornage que les chemins natifs.
  const liveAnnotationsRef = useRef<Map<number, import('../types/api').Annotation[]>>(new Map())

  const handleLiveFramePreview = useCallback((arrIdx: number, objects: TaskLiveFrameObject[],
                                              nativePath?: string | null) => {
    const frame = frames.find((f) => f.frame_index === arrIdx) ?? frames[arrIdx]
    if (!frame) return
    if (nativePath) {
      const m = liveNativePathRef.current
      m.set(frame.id, nativePath)
      if (m.size > 64) m.delete(m.keys().next().value as number)
    }
    const nowIso = new Date().toISOString()
    const anns: import('../types/api').Annotation[] = objects.map((o, i) => ({
      id: -1_000_000 - frame.id * 1000 - i,
      frame_id: frame.id,
      track_id: null,
      class_id: o.class_id,
      annotation_type: o.polygon && o.polygon.length > 0 ? 'polygon' : 'bbox',
      cx: o.bbox[0], cy: o.bbox[1], width: o.bbox[2], height: o.bbox[3],
      points: o.polygon && o.polygon.length > 0 ? o.polygon : null,
      confidence: o.score,
      is_auto: true,
      is_interpolated: false,
      source_algorithm: 'sam2_tracking',
      created_at: nowIso,
    }))
    setFrameAnnotationCount(frame.id, anns.length)
    const prev = lastPropagatedIndexRef.current
    if (anns.length > 0 && prev !== null && arrIdx > prev && arrIdx - prev <= 500) {
      markFrameRangeAnnotated(prev, arrIdx, anns.length)
    }
    lastPropagatedIndexRef.current = arrIdx
    const buf = liveAnnotationsRef.current
    buf.set(frame.id, anns)
    if (buf.size > 64) buf.delete(buf.keys().next().value as number)
    const currentIdx = useProjectStore.getState().currentFrameIndex
    if (currentIdx === arrIdx) {
      loadAnnotations(frame.id, anns)
    }
  }, [frames, loadAnnotations, setFrameAnnotationCount, markFrameRangeAnnotated])

  // Quand le canvas arrive (enfin) sur une frame propagee, applique l'apercu
  // deja recu pour elle. C'est le pendant du tampon ci-dessus : les annotations
  // n'attendent plus le flush DB pour s'afficher, elles sont la des le premier
  // rendu de la frame.
  useEffect(() => {
    if (propagationTaskId == null) return
    // `getCurrentFrame` lit le store courant sans rendre cet effet dependant du
    // tableau `frames`. La timeline remplace ce tableau pour chaque compteur
    // live ; cela ne doit jamais reappliquer l'overlay de la frame courante.
    const frame = getCurrentFrame()
    if (!frame) return
    const anns = liveAnnotationsRef.current.get(frame.id)
    if (!anns) return
    const current = useAnnotationStore.getState()
    if (current.currentFrameId !== frame.id || current.annotations !== anns) {
      loadAnnotations(frame.id, anns)
    }
  }, [currentFrameIndex, propagationTaskId, getCurrentFrame, loadAnnotations])

  // Fin de run : on vide les deux tampons. La DB fait desormais foi pour les
  // annotations, et les chemins natifs pointent vers un dossier temporaire qui
  // vient d'etre supprime cote serveur.
  useEffect(() => {
    if (propagationTaskId != null) return
    liveAnnotationsRef.current.clear()
    liveNativePathRef.current.clear()
  }, [propagationTaskId])

  // ---- Auto-save (toutes les 2min) ----
  useAutoSave(numericProjectId)

  // ---- Raccourcis clavier ----
  // Handlers bulk (undo/redo suppression groupée timeline) passés via une ref
  // stable : les vrais handlers sont définis plus bas (ordre du composant), la ref
  // est synchronisée par un effet. preferBulk* arbitre "dernière action gagne".
  const bulkHandlersRef = useRef<{ undo: () => void; redo: () => void }>({ undo: () => {}, redo: () => {} })
  const bulkKbd = useMemo(() => ({
    onBulkUndo: () => bulkHandlersRef.current.undo(),
    onBulkRedo: () => bulkHandlersRef.current.redo(),
    preferBulkUndo: () => { const b = useBulkUndoStore.getState(); return b.lastActionWasBulk && b.canUndo },
    preferBulkRedo: () => { const b = useBulkUndoStore.getState(); return b.lastActionWasBulk && b.canRedo },
  }), [])
  useKeyboardShortcuts(undefined, bulkKbd)

  // ---- Touche Echap : annuler SAM point ----
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && activeTool === 'sam_point') {
        samStore.clearPoints()
        setActiveTool('select')
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [activeTool, samStore, setActiveTool])

  // Persiste l'id + le label de la tâche de propagation → survivent au reload web.
  const propTaskKey = `annot_prop_task_${numericProjectId}`
  const propLabelKey = `annot_prop_label_${numericProjectId}`
  useEffect(() => {
    if (propagationTaskId) {
      localStorage.setItem(propTaskKey, propagationTaskId)
      localStorage.setItem(propLabelKey, propagationLabel || t('Traitement'))
    } else {
      localStorage.removeItem(propTaskKey)
      localStorage.removeItem(propLabelKey)
    }
  }, [propagationTaskId, propagationLabel, propTaskKey, propLabelKey])

  // Arrêt manuel du process (SAMURAI, détection, propagation…) depuis la barre.
  const handleStopPropagation = useCallback(async () => {
    if (!propagationTaskId) return
    try {
      await taskAPI.stop(propagationTaskId)
      setPropagationStatus(t('Arrêt demandé…'))
      toast(t('Arrêt du process demandé'))
    } catch {
      toast.error(t('Impossible d\'arrêter le process'))
    }
  }, [propagationTaskId])

  // ---- Suivi propagation (guided/homographie/SAM2) — top bar uniquement ----
  // La navigation temps réel elle-même est gérée par TrackPanel (source unique
  // de vérité pour la nav) ; ce poller ne met à jour que la barre du haut.
  //
  // WebSocket en priorite (/ws/tasks/{id}, une seule connexion poussee par le
  // serveur — voir tracking.py), avec repli sur une boucle HTTP sequentielle
  // (jamais deux requetes en vol, jamais de reponses traitees dans le desordre)
  // si le WS ne s'etablit pas sous 2,5 s. Meme pattern que TrackPanel.
  useEffect(() => {
    if (!propagationTaskId) return
    lastPropagatedIndexRef.current = null

    let stopped = false
    let gotWsUpdate = false
    let httpFallbackStarted = false
    const httpController = new AbortController()

    const finishRun = async (status: 'completed' | 'error' | 'gone', message: string) => {
      stopped = true
      httpController.abort()
      if (status === 'completed') {
        void loadTracks()
        // Rafraîchir TOUS les compteurs de la timeline + stats séquences
        // (le tracking a créé des annotations sur des dizaines de frames)
        void fetchFrames(numericProjectId)
        void loadSequences()
        const frame = getCurrentFrame()
        if (frame) {
          const anns = await annotationsAPI.list(frame.id)
          annotationsCacheRef.current.set(frame.id, anns)
          loadAnnotations(frame.id, anns)
        }
        // Pas de popup de fin pour la détection + association (S4) — la barre suffit.
        if (!propagationLabel.toLowerCase().includes('detection')) {
          toast.success(`${propagationLabel} ${t('terminé !')}`)
        }
        setTimeout(() => {
          setPropagationTaskId(null)
          setPropagationProgress(0)
          setPropagationStatus('')
        }, 2000)
      } else if (status === 'error') {
        toast.error(`${t('Erreur propagation')} : ${message}`)
        setTimeout(() => setPropagationTaskId(null), 3000)
      } else {
        // Tâche disparue (terminée pendant l'absence) → nettoyer la barre.
        setPropagationTaskId(null)
        setPropagationProgress(0)
        setPropagationStatus('')
      }
    }

    const applyUpdate = (status: string, progress: number, message: string) => {
      setPropagationProgress(progress ?? 0)
      setPropagationStatus(message ?? '')
      if (status === 'completed') void finishRun('completed', message)
      else if (status === 'error') void finishRun('error', message)
    }

    const startHttpFallback = () => {
      if (httpFallbackStarted || stopped) return
      httpFallbackStarted = true
      let networkErrors = 0
      const run = async () => {
        while (!httpController.signal.aborted) {
          if (gotWsUpdate) break  // le WS a fini par repondre entre-temps
          try {
            const res = await fetch(`/api/tasks/${propagationTaskId}`, { signal: httpController.signal })
            if (res.status === 404) { void finishRun('gone', ''); break }
            if (res.ok) {
              networkErrors = 0
              const task = await res.json() as { status: string; progress: number; message: string }
              applyUpdate(task.status, task.progress, task.message)
              if (task.status === 'completed' || task.status === 'error') break
            }
          } catch (e) {
            if (e instanceof DOMException && e.name === 'AbortError') break
            networkErrors += 1
            if (networkErrors >= 10) {
              setPropagationStatus('Backend indisponible')
              setTimeout(() => setPropagationTaskId(null), 3000)
              break
            }
          }
          try {
            await new Promise<void>((resolve, reject) => {
              const t = setTimeout(resolve, 1500)
              httpController.signal.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('Aborted', 'AbortError')) })
            })
          } catch { break }
        }
      }
      void run()
    }

    const wsFallbackTimer = setTimeout(() => {
      if (!gotWsUpdate && !stopped) startHttpFallback()
    }, 2500)
    const subscription = subscribeTaskProgress(propagationTaskId, {
      update: (msg) => {
        if (stopped) return
        gotWsUpdate = true
        clearTimeout(wsFallbackTimer)
        applyUpdate(msg.status, msg.progress, msg.message)
      },
      notFound: () => {
        if (stopped) return
        void finishRun('gone', '')
      },
    })
    subscription.connected.catch(() => {
      if (!gotWsUpdate && !stopped) startHttpFallback()
    })

    return () => {
      stopped = true
      clearTimeout(wsFallbackTimer)
      httpController.abort()
      subscription.disconnect()
    }
  }, [propagationTaskId])

  // ---- Poll extraction vidéo en arrière-plan ----
  useEffect(() => {
    if (!extractionTaskId) return
    let lastRefreshProgress = -10
    let networkErrors = 0
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/tasks/${extractionTaskId}`)
        if (!res.ok) return
        networkErrors = 0
        const task = await res.json() as { status: string; progress: number; message: string }
        setExtractionProgress(task.progress)
        setExtractionMessage(task.message)
        // Rafraîchir les frames quand la progression avance
        if (task.progress - lastRefreshProgress >= 10) {
          lastRefreshProgress = task.progress
          void fetchFrames(numericProjectId)
        }
        if (task.status === 'completed' || task.status === 'error') {
          clearInterval(interval)
          await fetchFrames(numericProjectId)
          void loadSequences()
          setTimeout(() => {
            setExtractionTaskId(null)
            setExtractionProgress(0)
            setExtractionMessage('')
          }, 2000)
        }
      } catch {
        networkErrors += 1
        if (networkErrors >= 10) {
          clearInterval(interval)
          setExtractionMessage('Backend indisponible')
          setTimeout(() => setExtractionTaskId(null), 3000)
        }
      }
    }, 2000)
    return () => clearInterval(interval)
  }, [extractionTaskId, numericProjectId])

  // ---- Handlers frames ----
  const handleFrameSelect = useCallback(
    (frameIndex: number) => {
      setCurrentFrameIndex(frameIndex)
      // Debounce : ne sauvegarder la session qu'1.5 s après la dernière navigation
      // (évite N appels API lors d'un appui long sur ← →)
      if (sessionSaveTimerRef.current) clearTimeout(sessionSaveTimerRef.current)
      sessionSaveTimerRef.current = setTimeout(
        () => void saveSession(numericProjectId, { current_frame_index: frameIndex }),
        1500
      )
    },
    [setCurrentFrameIndex, saveSession, numericProjectId]
  )

  // Prev/next restent DANS la séquence courante (bornes sliderMin/sliderMax).
  const handlePrevFrame = () => {
    if (currentFrameIndex > sliderMin) handleFrameSelect(currentFrameIndex - 1)
  }
  const handleNextFrame = () => {
    if (currentFrameIndex < sliderMax) handleFrameSelect(currentFrameIndex + 1)
  }

  // ---- Handlers annotations ----
  const handleDeleteAnnotation = async (id: number) => {
    await deleteAnnotation(id)
    // fire-and-forget : le badge de la timeline se met à jour en arrière-plan
    void loadTracks()
    void fetchFrames(numericProjectId)
  }

  const handleDeleteAllAnnotations = async () => {
    await deleteAllAnnotations()
    void loadTracks()
    void fetchFrames(numericProjectId)
  }

  const handleApplyNMS = async (iouThreshold: number) => {
    const frame = getCurrentFrame()
    if (!frame) { toast.error(t('Aucune frame sélectionnée')); return }
    try {
      const result = await annotationsAPI.applyNMS(frame.id, iouThreshold)
      toast.success(`NMS : ${result.deleted_count} ${t('doublon')}${result.deleted_count !== 1 ? 's' : ''} ${t('supprimé')}${result.deleted_count !== 1 ? 's' : ''}`)
      const anns = await annotationsAPI.list(frame.id)
      annotationsCacheRef.current.set(frame.id, anns)
      loadAnnotations(frame.id, anns)
    } catch {
      toast.error(t('Erreur lors du NMS'))
    }
  }

  // ---- Assignation de track à une annotation (MOT) ----
  const handleAssignTrack = useCallback(async (
    annotationId: number,
    action: 'new' | 'assign' | 'detach',
    trackId?: number,
  ) => {
    try {
      // Snapshot AVANT : sans lui, créer ou changer une piste à la main n'entrait
      // pas dans la pile undo et Ctrl+Z sautait à l'action d'avant (ou ne faisait
      // rien). Le snapshot porte le track_id de chaque annotation, que le
      // bulk-replace de l'undo restaure tel quel.
      useAnnotationStore.getState().pushUndoSnapshot(`Track ${action}`)
      await trackingAPI.assignTrack(annotationId, action, trackId)
      await loadTracks()  // rafraîchir la liste des tracks (nouvelle track / plage)
      const frame = getCurrentFrame()
      if (frame) {
        const anns = await annotationsAPI.list(frame.id)
        annotationsCacheRef.current.set(frame.id, anns)
        loadAnnotations(frame.id, anns)
      }
    } catch (e) {
      console.error('[AnnotationPage] Erreur assignation track:', e)
      toast.error(t('Erreur assignation de track'))
    }
  }, [loadTracks, getCurrentFrame, loadAnnotations])

  // ---- Suppression annotations multi-frames (depuis la timeline) ----
  const handleDeleteAnnotationsForFrames = async (frameIndices: number[]) => {
    // frameIndices = frame_index réels (pas positions tableau). On résout via
    // le tableau frames (chargé complet grâce à l'auto-pagination).
    const idxSet = new Set(frameIndices)
    const selectedFrames = frames.filter((f) => idxSet.has(f.frame_index))
    if (selectedFrames.length === 0) return
    const ids = selectedFrames.map((f) => f.id)
    try {
      // UNE requête pour toutes les frames (au lieu de N appels séquentiels)
      await annotationsAPI.deleteForFrames(numericProjectId, ids)
      for (const f of selectedFrames) annotationsCacheRef.current.set(f.id, [])
      // Historique : cette suppression devient la dernière action → Ctrl+Z l'annule.
      useBulkUndoStore.getState().noteBulkDelete()
    } catch (e) {
      console.error('[AnnotationPage] Erreur suppression multi-frames:', e)
      toast.error(t('Erreur suppression des annotations'))
      return
    }
    await fetchFrames(numericProjectId)
    await loadTracks()
    void loadSequences()
    if (frameIndices.includes(currentFrameIndex)) {
      const current = getCurrentFrame()
      if (current) {
        const anns = await annotationsAPI.list(current.id)
        annotationsCacheRef.current.set(current.id, anns)
        loadAnnotations(current.id, anns)
      }
    }
    toast.success(
      `${t('Annotations supprimées sur')} ${selectedFrames.length} frame${selectedFrames.length > 1 ? 's' : ''} — ${t('Ctrl+Z pour annuler')}`
    )
  }

  // ---- Undo / Redo des suppressions GROUPÉES (timeline) ----
  const refreshAfterBulk = useCallback(async () => {
    await fetchFrames(numericProjectId)
    await loadTracks()
    void loadSequences()
    const current = getCurrentFrame()
    if (current) {
      const anns = await annotationsAPI.list(current.id)
      annotationsCacheRef.current.set(current.id, anns)
      loadAnnotations(current.id, anns)
    }
  }, [numericProjectId, fetchFrames, loadTracks, loadSequences, getCurrentFrame, loadAnnotations])

  const handleBulkUndo = useCallback(async () => {
    try {
      const res = await annotationsAPI.undoBulkDelete(numericProjectId)
      if (!res.success) return
      await refreshAfterBulk()
      useBulkUndoStore.getState().setFlags(res.can_undo_more, res.can_redo_more)
      if (!res.can_undo_more) useBulkUndoStore.setState({ lastActionWasBulk: false })
      toast.success(`${t('Suppression annulée')} (${res.restored ?? 0} ${t('annotations restaurées')})`)
    } catch {
      toast.error(t('Impossible d\'annuler la suppression'))
    }
  }, [numericProjectId, refreshAfterBulk])

  const handleBulkRedo = useCallback(async () => {
    try {
      const res = await annotationsAPI.redoBulkDelete(numericProjectId)
      if (!res.success) return
      await refreshAfterBulk()
      useBulkUndoStore.getState().setFlags(res.can_undo_more, res.can_redo_more)
      toast.success(t('Suppression refaite'))
    } catch {
      toast.error(t('Impossible de refaire la suppression'))
    }
  }, [numericProjectId, refreshAfterBulk])

  useEffect(() => {
    bulkHandlersRef.current = { undo: handleBulkUndo, redo: handleBulkRedo }
  }, [handleBulkUndo, handleBulkRedo])

  // ---- Rafraîchissement complet après un changement de tracks ----
  // Recharge tracks + frames (compteurs timeline) + séquences + annotations de la
  // frame courante. Utilisé après suppression/fusion de track ET fin de tracking,
  // pour que les annotations supprimées disparaissent immédiatement du canvas.
  const refreshTracksAndFrame = useCallback(async () => {
    await loadTracks()
    await fetchFrames(numericProjectId)
    void loadSequences()
    const current = getCurrentFrame()
    if (current) {
      const anns = await annotationsAPI.list(current.id)
      annotationsCacheRef.current.set(current.id, anns)
      loadAnnotations(current.id, anns)
      setFrameAnnotationCount(current.id, anns.length)
    }
  }, [loadTracks, fetchFrames, numericProjectId, getCurrentFrame, loadAnnotations, setFrameAnnotationCount])

  // ---- Suppression d'un track (depuis la timeline) ----
  // Supprime le track ET toutes ses annotations (backend delete_track), puis
  // rafraîchit tracks + compteurs timeline + frame courante.
  const handleDeleteTrack = useCallback(async (trackId: number) => {
    try {
      const res = await trackingAPI.delete(trackId)
      toast.success(`${t('Track supprimé')} (${res.deleted_annotations} annotation${res.deleted_annotations !== 1 ? 's' : ''})`)
    } catch (e) {
      console.error('[AnnotationPage] Erreur suppression track:', e)
      toast.error(t('Erreur suppression du track'))
      return
    }
    await refreshTracksAndFrame()
  }, [refreshTracksAndFrame])

  // Supprime UNIQUEMENT le bloc [s, e] d'une piste (pas le reste de la track)
  const handleDeleteTrackBlock = useCallback(async (trackId: number, startFrame: number, endFrame: number) => {
    try {
      const res = await trackingAPI.deleteBlock(trackId, startFrame, endFrame)
      toast.success(
        res.track_removed
          ? `${t('Bloc supprimé — piste vidée')} (${res.deleted_annotations} annotation${res.deleted_annotations !== 1 ? 's' : ''})`
          : `${t('Bloc supprimé')} (${res.deleted_annotations} annotation${res.deleted_annotations !== 1 ? 's' : ''})`
      )
    } catch (e) {
      console.error('[AnnotationPage] Erreur suppression bloc:', e)
      toast.error(t('Erreur suppression du bloc'))
      return
    }
    await refreshTracksAndFrame()
  }, [refreshTracksAndFrame])

  // ---- Hauteur de la zone tracks (persistée dans les settings du workspace) ----
  const tracksPanelHeight = useSettingsStore((s) => s.settings?.interface?.tracks_panel_height) ?? 92
  const handleTracksHeightChange = useCallback((h: number) => {
    // Optimiste : mettre à jour le store local puis persister côté backend
    const st = useSettingsStore.getState()
    if (st.settings) {
      useSettingsStore.setState({
        settings: { ...st.settings, interface: { ...st.settings.interface, tracks_panel_height: h } },
      })
    }
    void settingsAPI.update({ interface: { tracks_panel_height: h } as never })
  }, [])

  // ---- Handlers classes ----
  const handleCreateClass = async (name: string, color: string, subclass?: string, subsubclass?: string) => {
    const created = await projectsAPI.createClass(numericProjectId, {
      name, color,
      subclass: subclass || null,
      subsubclass: subsubclass || null,
    })
    await fetchProject(numericProjectId)
    // On cree une classe pour s'en servir tout de suite : la selectionner evite
    // le dessin fait avec l'ancienne classe active (ou sans classe du tout).
    if (created?.id != null) useAnnotationStore.getState().setActiveClassId(created.id)
  }
  const handleUpdateClass = async (id: number, name: string, color: string, subclass?: string, subsubclass?: string) => {
    await projectsAPI.updateClass(numericProjectId, id, {
      name, color,
      // '' explicite = effacer le niveau côté backend
      subclass: subclass ?? '',
      subsubclass: subsubclass ?? '',
    })
    await fetchProject(numericProjectId)
  }
  const handleDeleteClass = async (id: number) => {
    await projectsAPI.deleteClass(numericProjectId, id)
    await fetchProject(numericProjectId)
  }

  // ---- Prompt texte (Grounding DINO ou SAM3) ----
  const handleTextSegment = async (frameId?: number, silent = false) => {
    if (!textPrompt.trim()) return
    const frame = frameId !== undefined ? frames.find((f) => f.id === frameId) ?? getCurrentFrame() : getCurrentFrame()
    if (!frame) return

    if (!silent) setIsRunningText(true)
    try {
      const { activeClassId } = useAnnotationStore.getState()
      if (!currentProject?.classes?.length) {
        if (!silent) toast.error(t('Créez d abord une classe dans le panneau Classes avant de lancer GD ou SAM3.'))
        return 0
      }
      const classId = activeClassId
      if (!classId) {
        if (!silent) toast.error(t('Sélectionnez une classe active avant de lancer GD ou SAM3.'))
        return 0
      }

      if (textModel === 'sam3') {
        // SAM3 : détection texte via SAM3
        const result = await sam3API.predictText(frame.id, textPrompt, sam3BoxThreshold, sam3TextThreshold)
        if (result.count === 0) {
          if (!silent) toast(t('Aucun objet détecté avec SAM3.'), { icon: '🔍' })
          return 0
        }
        // Bulk create : 1 appel réseau au lieu de result.count appels séquentiels
        const bulk = result.detections.map((det) => {
          const [cx, cy, w, h] = det.bbox_yolo
          const usePolygon = wantPolygon && det.polygon.length > 0
          return {
            class_id: classId,
            annotation_type: (usePolygon ? 'polygon' : 'bbox') as 'polygon' | 'bbox',
            cx, cy, width: w, height: h,
            points: usePolygon ? det.polygon : null,
            confidence: det.score,
            is_auto: true as const,
            source_algorithm: 'sam3' as const,
          }
        })
        await bulkAddAnnotations(frame.id, bulk)
        if (!silent) toast.success(`SAM3 : ${result.count} ${t('objet')}${result.count > 1 ? 's' : ''} ${t('détecté')}${result.count > 1 ? 's' : ''}`)
        return result.count
      } else {
        // Grounding DINO
        const result = await samAPI.predictText(frame.id, textPrompt, {
          box_threshold: boxThreshold,
          text_threshold: textThreshold,
          use_sam: wantPolygon,
        })
        if (result.count === 0) {
          if (!silent) toast(t('Aucun objet détecté avec ce prompt.'), { icon: '🔍' })
          return 0
        }
        // Bulk create : 1 appel réseau au lieu de result.count appels séquentiels
        const bulk = result.detections.map((det) => {
          const [cx, cy, w, h] = det.bbox_yolo
          const usePolygon = wantPolygon && det.polygon.length > 0
          return {
            class_id: classId,
            annotation_type: (usePolygon ? 'polygon' : 'bbox') as 'polygon' | 'bbox',
            cx, cy, width: w, height: h,
            points: usePolygon ? det.polygon : null,
            confidence: det.score,
            is_auto: true as const,
            source_algorithm: 'grounding_dino' as const,
          }
        })
        await bulkAddAnnotations(frame.id, bulk)
        if (!silent) toast.success(`${result.count} ${t('objet')}${result.count > 1 ? 's' : ''} ${t('détecté')}${result.count > 1 ? 's' : ''}`)
        return result.count
      }
    } catch (e) {
      // Le detail FastAPI dit la vraie raison ("SAM3 non installe", "Checkpoint
      // absent...") : la masquer derriere un message generique laissait croire a
      // un bug de l'application.
      const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
      if (!silent) {
        toast.error(typeof detail === 'string'
          ? `${t('Detection par texte')} : ${detail}`
          : t('Erreur lors de la segmentation par texte'), { duration: 8000 })
      }
      return 0
    } finally {
      if (!silent) setIsRunningText(false)
    }
  }

  // ---- SAM Auto (auto-segmentation de la frame courante) ----
  const handleSAMAuto = async () => {
    const frame = getCurrentFrame()
    if (!frame) { toast.error(t('Aucune frame sélectionnée')); return }

    setSamAutoStatus('connecting')
    setSamAutoCount(0)

    try {
      await samStore.connectImageWS()
      setSamAutoStatus('running')
      samStore.clearStreamedMasks()

      // Abonnement aux masques reçus en streaming
      // Les masques ne sont PAS persistés automatiquement : ils restent en propositions
      // dans samStore.streamedMasks jusqu'à validation manuelle par l'utilisateur
      const autoCountRef = { value: 0 }
      samStore.setOnMaskResult(() => {
        autoCountRef.value += 1
        setSamAutoCount(autoCountRef.value)
        // Pas d'addAnnotation ici : masque stocké dans streamedMasks uniquement
        // La validation se fait via clic canvas ou via la sidebar
      })

      samStore.startAutoSegment(frame.id, {
        points_per_side: 32,
        pred_iou_thresh: 0.88,
        stability_score_thresh: 0.95,
        min_mask_area: 100,
      })

      // Attendre completion via poll de status (getState() pour éviter closure stale)
      await new Promise<void>((resolve) => {
        const check = setInterval(() => {
          if (useSAMStore.getState().imageStatus !== 'processing') {
            clearInterval(check)
            resolve()
          }
        }, 500)
        setTimeout(() => { clearInterval(check); resolve() }, 120000)
      })

      samStore.setOnMaskResult(null)
      setSamAutoStatus('done')
      toast.success(`${t('SAM Auto terminé')} : ${autoCountRef.value} ${t('objet')}${autoCountRef.value !== 1 ? 's' : ''}`)
    } catch {
      toast.error(t('Erreur SAM Auto'))
      setSamAutoStatus('idle')
    } finally {
      setTimeout(() => setSamAutoStatus('idle'), 3000)
    }
  }

  // ---- Validation d'une proposition SAM Auto depuis le canvas ----
  const handleValidateSAMMask = useCallback((maskIndex: number) => {
    const masks = useSAMStore.getState().streamedMasks
    const mask = masks[maskIndex]
    if (!mask) return

    const { activeClassId: classId } = useAnnotationStore.getState()
    const resolvedClassId = classId ?? currentProject?.classes[0]?.id ?? 0
    if (!resolvedClassId) { toast.error(t('Sélectionnez une classe avant de valider')); return }

    const [cx, cy, w, h] = mask.bbox_yolo
    const usePolygon = samOutputMode === 'segmentation' && mask.polygon.length > 0
    void addAnnotation({
      class_id: resolvedClassId,
      annotation_type: usePolygon ? 'polygon' : 'bbox',
      cx, cy, width: w, height: h,
      points: usePolygon ? mask.polygon : null,
      confidence: mask.score,
      is_auto: true,
      source_algorithm: 'sam_auto',
    }).then(() => {
      useSAMStore.getState().removeMask(maskIndex)
    })
  }, [addAnnotation, currentProject, samOutputMode])

  // ---- Mode Auto Vidéo (batch texte sur plage de frames) ----
  // Frames dont le batch texte a deja publie le resultat. La requete
  // d'annotations lancee a la navigation peut repondre APRES la detection : sans
  // ce garde, sa liste vide ecraserait les boites qu'on vient d'inserer.
  const batchCommittedRef = useRef<Set<number>>(new Set())

  // Batch texte (GD / SAM3) : publier le resultat d'une frame DES qu'il arrive.
  // La requete d'annotations partie a la navigation a repondu avant la detection
  // (liste vide) et rien ne relisait ensuite : le canvas restait vide et la case
  // de timeline a 0 jusqu'a ce qu'on reclique la frame. C'est le pendant, pour le
  // batch, de ce que handleForceAnnotationRefresh fait pour la propagation.
  const commitBatchFrame = useCallback(
    (frameId: number, arrIdx: number, anns: import('../types/api').Annotation[]) => {
      batchCommittedRef.current.add(frameId)
      setFrameAnnotationCount(frameId, anns.length)
      if (useProjectStore.getState().currentFrameIndex === arrIdx) {
        loadAnnotations(frameId, anns)
      }
    },
    [setFrameAnnotationCount, loadAnnotations],
  )

  const handleAutoModeStart = async () => {
    if (!textPrompt.trim()) {
      toast.error(t('Entrez un prompt texte pour le mode auto'))
      setShowTextPrompt(true)
      return
    }

    const initialClassId = useAnnotationStore.getState().activeClassId
    if (!currentProject?.classes?.length) {
      toast.error(t('Créez d abord une classe dans le panneau Classes avant de lancer GD ou SAM3.'))
      return
    }
    if (!initialClassId) {
      toast.error(t('Sélectionnez une classe active avant de lancer GD ou SAM3.'))
      return
    }

    // Déterminer la plage de frames
    const startIdx = batchStartIndex !== '' ? parseInt(String(batchStartIndex)) : currentFrameIndex
    const endIdx = batchEndIndex !== '' ? parseInt(String(batchEndIndex)) : totalFrameCount - 1
    const clampedStart = Math.max(0, Math.min(startIdx, totalFrameCount - 1))
    const clampedEnd = Math.max(clampedStart, Math.min(endIdx, totalFrameCount - 1))
    const total = clampedEnd - clampedStart + 1

    autoModeStopRef.current = false
    autoModePauseRef.current = false
    batchCommittedRef.current.clear()
    setAutoModeRunning(true)
    setAutoModePaused(false)
    setAutoModeProgress({ current: 0, total })

    const modelLabel = textModel === 'sam3' ? 'SAM3' : 'Grounding DINO'
    let successCount = 0
    let errorCount = 0
    let firstError: string | null = null

    for (let i = clampedStart; i <= clampedEnd; i++) {
      if (autoModeStopRef.current) break

      // Gestion pause : attendre que autoModePauseRef soit false
      while (autoModePauseRef.current) {
        await new Promise((r) => setTimeout(r, 300))
        if (autoModeStopRef.current) break
      }
      if (autoModeStopRef.current) break

      setAutoModeProgress({ current: i - clampedStart + 1, total })

      // Obtenir la frame AVANT de naviguer (plus de setTimeout(250) nécessaire)
      let frame: Frame | undefined = frames.find((f) => f.frame_index === i) ?? frames[i]
      if (!frame) {
        await ensureFrameLoaded(numericProjectId, i)
        frame = useProjectStore.getState().frames.find((f) => f.frame_index === i)
      }
      if (!frame) continue

      // La navigation a lieu APRES la detection (voir plus bas) : naviguer avant
      // affichait la frame VIDE pendant toute l'inference, puis ses boites ne
      // restaient a l'ecran que le temps d'un battement avant le saut a la frame
      // suivante. D'ou l'impression que le lot n'annotait rien jusqu'a la fin.
      try {
        const classId = initialClassId
        let saved: import('../types/api').Annotation[] | null = null

        if (textModel === 'sam3') {
          const result = await sam3API.predictText(frame.id, textPrompt, sam3BoxThreshold, sam3TextThreshold)
          if (result.detections.length > 0) {
            const bulk = result.detections.map((det) => {
              const [cx, cy, w, h] = det.bbox_yolo
              const usePolygon = wantPolygon && det.polygon.length > 0
              return {
                class_id: classId,
                annotation_type: (usePolygon ? 'polygon' : 'bbox') as 'polygon' | 'bbox',
                cx, cy, width: w, height: h,
                points: usePolygon ? det.polygon : null,
                confidence: det.score,
                is_auto: true as const,
                source_algorithm: 'sam3' as const,
              }
            })
            saved = await bulkAddAnnotations(frame.id, bulk)
          }
        } else {
          const result = await samAPI.predictText(frame.id, textPrompt, {
            box_threshold: boxThreshold,
            text_threshold: textThreshold,
            use_sam: wantPolygon,
          })
          if (result.detections.length > 0) {
            const bulk = result.detections.map((det) => {
              const [cx, cy, w, h] = det.bbox_yolo
              const usePolygon = wantPolygon && det.polygon.length > 0
              return {
                class_id: classId,
                annotation_type: (usePolygon ? 'polygon' : 'bbox') as 'polygon' | 'bbox',
                cx, cy, width: w, height: h,
                points: usePolygon ? det.polygon : null,
                confidence: det.score,
                is_auto: true as const,
                source_algorithm: 'grounding_dino' as const,
              }
            })
            saved = await bulkAddAnnotations(frame.id, bulk)
          }
        }
        // Cache rempli AVANT la navigation : l'effet de chargement par frame
        // trouve alors la bonne liste des son premier passage, sans aller-retour
        // reseau ni affichage vide intermediaire.
        if (saved) annotationsCacheRef.current.set(frame.id, saved)
        handleFrameSelect(i)
        if (saved) commitBatchFrame(frame.id, i, saved)
        successCount++
      } catch (e) {
        errorCount++
        // Le lot continue (une erreur peut etre passagere : chargement du
        // checkpoint plus long que le timeout HTTP sur la 1re frame, puis tout
        // passe). Mais on garde la RAISON de la premiere erreur : elle etait
        // avalee, et un lot qui echouait partout se terminait si vite que la
        // barre de progression et les boutons pause/stop semblaient disparaitre
        // d'eux-memes sans qu'aucun message ne dise pourquoi.
        if (firstError === null) {
          const detail = (e as { response?: { data?: { detail?: unknown } } })
            ?.response?.data?.detail
          firstError = typeof detail === 'string'
            ? detail
            : (e as Error)?.message ?? t('echec de la detection')
        }
        handleFrameSelect(i)
      }
      // Pas de setTimeout artificiel : la prochaine itération commence immédiatement
    }

    setAutoModeRunning(false)
    setAutoModePaused(false)
    // Le garde anti-ecrasement ne doit pas survivre au batch : sinon ces frames
    // ne seraient plus jamais relues depuis la base. Le delai laisse retomber
    // les requetes encore en vol.
    setTimeout(() => batchCommittedRef.current.clear(), 2000)
    if (firstError) {
      toast.error(`${modelLabel} : ${firstError}`, { duration: 8000 })
    }
    if (successCount === 0 && errorCount > 0) return
    toast.success(
      `${modelLabel} ${t('batch terminé')} : ${successCount} frame${successCount !== 1 ? 's' : ''} ${t('traitée')}${successCount !== 1 ? 's' : ''}${errorCount > 0 ? ` (${errorCount} ${t('erreur')}${errorCount !== 1 ? 's' : ''})` : ''}`
    )
  }

  const handleAutoModeStop = () => {
    autoModeStopRef.current = true
    autoModePauseRef.current = false
    setAutoModeRunning(false)
    setAutoModePaused(false)
  }

  const handleAutoModePause = () => {
    autoModePauseRef.current = true
    setAutoModePaused(true)
  }

  const handleAutoModeResume = () => {
    autoModePauseRef.current = false
    setAutoModePaused(false)
  }

  // ---- Drag & Drop : restaurer annotations depuis JSON ----
  const handleDropAnnotations = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragOver(false)

      // Rassembler les fichiers droppés (gère aussi le drop d'un DOSSIER YOLO)
      const dt = e.dataTransfer
      const dirEntries = (dt.items ? Array.from(dt.items) : [])
        .map((it) => (it as DataTransferItem & { webkitGetAsEntry?: () => unknown }).webkitGetAsEntry?.())
        .filter((en) => Boolean(en))
      let files: File[] = []
      if (dirEntries.some((en) => (en as { isDirectory: boolean }).isDirectory)) {
        for (const en of dirEntries) {
          if ((en as { isDirectory: boolean }).isDirectory) files.push(...await readAnnotationFolder(en))
        }
      } else {
        files = Array.from(dt.files)
      }
      if (files.length === 0) { toast.error(t('Aucun fichier détecté')); return }

      // 1) Backup JSON isolé → restauration (comportement historique)
      const jsonFile = files.find((f) => f.name.toLowerCase().endsWith('.json'))
      if (jsonFile && files.length === 1) {
        try {
          const backup = JSON.parse(await jsonFile.text()) as { project_id: number; frames: unknown[] }
          const res = await fetch(`/api/projects/${numericProjectId}/restore`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(backup),
          })
          const data = await res.json() as { success: boolean; restored_count: number }
          if (data.success) {
            toast.success(`${data.restored_count} ${t('annotations restaurées')}`)
            const frame = getCurrentFrame()
            if (frame) loadAnnotations(frame.id, await annotationsAPI.list(frame.id))
          } else {
            toast.error(t('Erreur lors de la restauration'))
          }
        } catch {
          toast.error(t('Fichier JSON invalide ou erreur réseau'))
        }
        return
      }

      // 2) Import d'annotations .ver / YOLO (.txt) par upload → sur la séquence courante
      const verFiles = files.filter((f) => f.name.toLowerCase().endsWith('.ver'))
      const txtFiles = files.filter((f) => f.name.toLowerCase().endsWith('.txt'))
      const yamlFiles = files.filter((f) => /\.ya?ml$/i.test(f.name))
      if (verFiles.length === 0 && txtFiles.length === 0) {
        toast.error(t('Glissez un fichier .ver, un dossier YOLO (.txt), ou un backup .json'))
        return
      }
      const seq = sequences.find(
        (s) => currentFrameIndex >= s.start_index && currentFrameIndex < s.start_index + s.frame_count
      )
      if (!seq || seq.id == null) { toast.error(t('Sélectionnez une séquence pour l\'import')); return }
      const replace = window.confirm(
        `${t('Importer sur')} « ${seq.name} ».\n${t('Remplacer les annotations existantes de cette séquence ?\n(OK = remplacer, Annuler = ajouter)')}`
      )
      // .ver : un seul fichier ; YOLO : les .txt (+ data.yaml pour les noms de classes)
      const uploadFiles = verFiles.length > 0 ? [verFiles[0]] : [...txtFiles, ...yamlFiles]
      try {
        const res = await datasetAPI.importSequenceAnnotationsUpload(numericProjectId, seq.id, uploadFiles, replace)
        toast.success(`${res.annotations_created} ${t('annotations importées')} (${res.format}) ${t('sur')} ${res.frames_annotated} frames`)
        await refreshTracksAndFrame()
        const frame = getCurrentFrame()
        if (frame) {
          const anns = await annotationsAPI.list(frame.id)
          annotationsCacheRef.current.set(frame.id, anns)
          loadAnnotations(frame.id, anns)
        }
        void loadSequences()
      } catch (err: unknown) {
        const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? t('Erreur')
        toast.error(`${t('Import annotations')} : ${msg}`)
      }
    },
    [numericProjectId, sequences, currentFrameIndex, getCurrentFrame, loadAnnotations, refreshTracksAndFrame, loadSequences]
  )

  // ---- Zoom ----
  const handleZoomIn = () => setCanvasZoom(Math.min(10, canvasZoom * 1.25))
  const handleZoomOut = () => setCanvasZoom(Math.max(0.1, canvasZoom / 1.25))
  const handleZoomReset = () => {
    setCanvasZoom(1)
    setCanvasOffset({ x: 0, y: 0 })
  }

  const currentFrame = getCurrentFrame()
  const classes = currentProject?.classes ?? []
  const textDetectionWarning = classes.length === 0
    ? 'Creez une classe avant de lancer GD ou SAM3.'
    : !activeClassId
      ? 'Selectionnez une classe active avant de lancer GD ou SAM3.'
      : null

  if (!currentProject) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <LoadingSpinner size="lg" label={t('Chargement du projet...')} />
      </div>
    )
  }

  return (
    <div
      className="flex flex-col h-screen bg-slate-900 text-slate-100 overflow-hidden"
      onDragOver={(e) => { e.preventDefault(); setIsDragOver(true) }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDropAnnotations}
    >
      {/* Overlay drag & drop */}
      {isDragOver && (
        <div className="fixed inset-0 z-50 bg-blue-900/60 border-2 border-blue-400 border-dashed flex items-center justify-center pointer-events-none">
          <div className="text-center text-blue-200">
            <Upload size={48} className="mx-auto mb-3 opacity-80" />
            <p className="text-lg font-semibold">{t('Déposer des annotations')}</p>
            <p className="text-sm opacity-70">{t('.ver ou dossier YOLO (.txt) → séquence courante · .json → restauration')}</p>
          </div>
        </div>
      )}

      {/* ---- Toolbar principal ---- */}
      <header className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 border-b border-slate-700 flex-shrink-0 overflow-x-auto">
        {/* Retour */}
        <button
          onClick={() => navigate('/')}
          data-tour="back-home"
          className="p-1.5 rounded hover:bg-slate-700 text-slate-400 hover:text-white transition-colors flex-shrink-0"
          title={t('Retour aux projets')}
        >
          <ArrowLeft size={15} />
        </button>

        <div className="w-px h-5 bg-slate-700 flex-shrink-0" />

        {/* Nom du projet */}
        <span className="text-sm text-slate-300 font-medium mr-1 truncate max-w-[120px] flex-shrink-0">
          {currentProject.name}
        </span>

        <div className="w-px h-5 bg-slate-700 flex-shrink-0" />

        {/* Outils d'annotation */}
        <div className="flex gap-0.5 flex-shrink-0" data-tour="toolbar-tools">
          {TOOLS.map(({ id, label, icon, shortcut }) => (
            <button
              key={id}
              onClick={() => {
                setActiveTool(id)
                if (id === 'sam_auto') void handleSAMAuto()
              }}
              data-tour={id === 'bbox' ? 'tool-bbox' : undefined}
              className={`p-1.5 rounded text-xs transition-colors flex items-center gap-1 ${
                activeTool === id
                  ? 'bg-blue-600 text-white'
                  : 'hover:bg-slate-700 text-slate-400 hover:text-white'
              }`}
              title={`${t(label)} (${shortcut})`}
            >
              {icon}
            </button>
          ))}
        </div>

        {/* Mode sortie SAM Auto : BBox ou Segmentation */}
        <div className="flex items-center gap-0.5 bg-slate-800 border border-slate-600 rounded p-0.5 flex-shrink-0"
             data-tour="output-mode"
             title={t('Mode de sortie des annotations automatiques (SAM Auto, Grounding DINO, SAM3)')}>
          <button
            onClick={() => setSamOutputMode('bbox')}
            className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${samOutputMode === 'bbox' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}
            data-tour="output-mode-bbox"
            title={t('Boîtes englobantes (SAM Auto, Grounding DINO, SAM3)')}
          >
            BBox
          </button>
          <button
            onClick={() => setSamOutputMode('segmentation')}
            className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${samOutputMode === 'segmentation' ? 'bg-purple-600 text-white' : 'text-slate-400 hover:text-white'}`}
            data-tour="output-mode-seg"
            title={t('Polygones de segmentation (SAM Auto, Grounding DINO avec raffinement SAM2, SAM3)')}
          >
            Seg
          </button>
        </div>

        <div className="w-px h-5 bg-slate-700 flex-shrink-0" />

        {/* Bouton T — affiche/masque la zone texte GD/SAM3 */}
        <button
          onClick={() => {
            if (!showTextPrompt && textDetectionWarning) toast.error(textDetectionWarning)
            setShowTextPrompt((v) => !v)
          }}
          className={`p-1.5 rounded text-xs transition-colors flex items-center gap-1 flex-shrink-0 ${
            showTextPrompt ? 'bg-purple-600 text-white' : 'hover:bg-slate-700 text-slate-400 hover:text-white'
          }`}
          title={t('Annoter par texte (GD / SAM3)')}
          data-tour="text-prompt-btn"
        >
          <Type size={15} />
        </button>

        {/* ---- GD | SAM3 toggle + params : visible seulement si T actif ---- */}
        {showTextPrompt && (
          <>
            {/* Toggle GD / SAM3 côte à côte */}
            <div className="flex rounded overflow-hidden border border-slate-600 flex-shrink-0">
              <button
                onClick={() => setTextModel('gd')}
                className={`px-2 py-0.5 text-xs transition-colors ${textModel === 'gd' ? 'bg-purple-700 text-white' : 'bg-slate-700 text-slate-400 hover:text-white'}`}
                title="Grounding DINO"
              >GD</button>
              <button
                onClick={() => setTextModel('sam3')}
                className={`px-2 py-0.5 text-xs transition-colors ${textModel === 'sam3' ? 'bg-pink-700 text-white' : 'bg-slate-700 text-slate-400 hover:text-white'}`}
                title={t('SAM3 — détection par texte open-vocabulary')}
              >SAM3</button>
            </div>

            {/* Params GD */}
            {textModel === 'gd' && (
              <div className="flex items-center gap-1 bg-slate-700 rounded px-2 py-0.5 flex-shrink-0">
                <span className="text-slate-400 text-xs">Box:</span>
                <input type="number" min="0.05" max="0.95" step="0.05" value={boxThreshold}
                  onChange={(e) => setBoxThreshold(parseFloat(e.target.value))}
                  className="w-12 bg-transparent text-white text-xs outline-none" title={t('Seuil boîte GD')} />
                <span className="text-slate-400 text-xs">Txt:</span>
                <input type="number" min="0.05" max="0.95" step="0.05" value={textThreshold}
                  onChange={(e) => setTextThreshold(parseFloat(e.target.value))}
                  className="w-12 bg-transparent text-white text-xs outline-none" title={t('Seuil texte GD')} />
              </div>
            )}

            {/* Params SAM3 */}
            {textModel === 'sam3' && (
              <div className="flex items-center gap-1 bg-slate-700 rounded px-2 py-0.5 flex-shrink-0">
                <span className="text-slate-400 text-xs">Box:</span>
                <input type="number" min="0.05" max="0.95" step="0.05" value={sam3BoxThreshold}
                  onChange={(e) => setSam3BoxThreshold(parseFloat(e.target.value))}
                  className="w-12 bg-transparent text-white text-xs outline-none" title={t('Seuil score SAM3')} />
                <span className="text-slate-400 text-xs">Txt:</span>
                <input type="number" min="0.05" max="0.95" step="0.05" value={sam3TextThreshold}
                  onChange={(e) => setSam3TextThreshold(parseFloat(e.target.value))}
                  className="w-12 bg-transparent text-white text-xs outline-none" title={t('Seuil texte SAM3')} />
              </div>
            )}
          </>
        )}

        {/* Champ texte + bouton run (commun GD/SAM3) */}
        {showTextPrompt && (
          <div className="flex items-center gap-1.5 flex-shrink-0 flex-wrap">
            {textDetectionWarning && (
              <span className="text-xs text-amber-300 bg-amber-950/40 border border-amber-800/50 rounded px-2 py-1">
                {textDetectionWarning}
              </span>
            )}
            <input
              autoFocus
              type="text"
              value={textPrompt}
              onChange={(e) => setTextPrompt(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void handleTextSegment()}
              data-tour="text-prompt-input"
              placeholder={t('voiture. personne. vélo.')}
              className="bg-slate-700 border border-slate-600 focus:border-purple-500 text-white text-xs px-2 py-1 rounded outline-none w-40"
            />
            <button
              onClick={() => void handleTextSegment()}
              data-tour="text-run-btn"
              disabled={isRunningText || !textPrompt.trim() || !!textDetectionWarning}
              className={`p-1 disabled:bg-slate-700 text-white rounded transition-colors ${
                textModel === 'sam3' ? 'bg-pink-700 hover:bg-pink-600' : 'bg-purple-600 hover:bg-purple-500'
              }`}
            >
              {isRunningText ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />}
            </button>

            {/* Bouton mode auto vidéo + plage de frames */}
            {totalFrameCount > 1 && (
              <div className="flex items-center gap-1 flex-shrink-0">
                {/* Bouton plage */}
                <button
                  onClick={() => setShowBatchRange((v) => !v)}
                  data-tour="text-batch-range"
                  className={`px-1.5 py-1 rounded text-xs transition-colors ${
                    showBatchRange ? 'bg-slate-600 text-white' : 'bg-slate-700 text-slate-400 hover:text-white'
                  }`}
                  title={t('Configurer la plage de frames')}
                >
                  [F{batchStartIndex !== '' ? batchStartIndex : currentFrameIndex}…F{batchEndIndex !== '' ? batchEndIndex : totalFrameCount - 1}]
                </button>

                {!autoModeRunning ? (
                  <button
                    onClick={() => void handleAutoModeStart()}
                    data-tour="text-batch-btn"
                    className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-green-700 hover:bg-green-600 text-white transition-colors"
                    title={t('Lancer le batch sur la plage sélectionnée')}
                  >
                    <Play size={11} /> Batch
                  </button>
                ) : (
                  <>
                    {!autoModePaused ? (
                      <button
                        onClick={handleAutoModePause}
                        className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-yellow-700 hover:bg-yellow-600 text-white transition-colors"
                        title={t('Pause')}
                      >
                        ⏸
                      </button>
                    ) : (
                      <button
                        onClick={handleAutoModeResume}
                        className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-green-700 hover:bg-green-600 text-white transition-colors"
                        title={t('Reprendre')}
                      >
                        <Play size={11} />
                      </button>
                    )}
                    <button
                      onClick={handleAutoModeStop}
                      className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-red-600 hover:bg-red-500 text-white transition-colors"
                      title={t('Stopper le batch')}
                    >
                      <StopCircle size={11} /> Stop
                    </button>
                  </>
                )}
              </div>
            )}

            {/* Panneau plage de frames */}
            {showBatchRange && (
              <div className="flex items-center gap-1.5 bg-slate-700/80 rounded px-2 py-1 flex-shrink-0">
                <span className="text-slate-400 text-xs">{t('De F')}</span>
                <input
                  type="number" min={0} max={totalFrameCount - 1}
                  value={batchStartIndex}
                  onChange={(e) => setBatchStartIndex(e.target.value)}
                  placeholder={String(currentFrameIndex)}
                  className="w-14 bg-slate-600 border border-slate-500 text-white text-xs px-1 py-0.5 rounded outline-none"
                />
                <span className="text-slate-400 text-xs">{t('à F')}</span>
                <input
                  type="number" min={0} max={totalFrameCount - 1}
                  value={batchEndIndex}
                  onChange={(e) => setBatchEndIndex(e.target.value)}
                  placeholder={String(totalFrameCount - 1)}
                  className="w-14 bg-slate-600 border border-slate-500 text-white text-xs px-1 py-0.5 rounded outline-none"
                />
              </div>
            )}
          </div>
        )}

        <div className="w-px h-5 bg-slate-700 flex-shrink-0" />

        {/* Undo/Redo */}
        <button
          onClick={undo}
          disabled={undoStack.length === 0}
          className="p-1.5 rounded hover:bg-slate-700 text-slate-400 hover:text-white disabled:opacity-30 transition-colors flex-shrink-0"
          title={t('Annuler (Ctrl+Z)')}
        >
          <Undo2 size={14} />
        </button>
        <button
          onClick={redo}
          disabled={redoStack.length === 0}
          className="p-1.5 rounded hover:bg-slate-700 text-slate-400 hover:text-white disabled:opacity-30 transition-colors flex-shrink-0"
          title={t('Rétablir (Ctrl+Y)')}
        >
          <Redo2 size={14} />
        </button>

        <div className="flex-1" />

        {/* Zoom */}
        <div className="flex items-center gap-1 flex-shrink-0" data-tour="zoom-controls">
          <button onClick={handleZoomOut} className="p-1.5 rounded hover:bg-slate-700 text-slate-400 hover:text-white transition-colors" title={t('Dézoomer')}>
            <ZoomOut size={13} />
          </button>
          <button
            onClick={handleZoomReset}
            className="px-2 py-1 rounded hover:bg-slate-700 text-slate-400 hover:text-white transition-colors text-xs font-mono"
            title={t('Réinitialiser zoom et position')}
          >
            {Math.round(canvasZoom * 100)}%
          </button>
          <button onClick={handleZoomIn} className="p-1.5 rounded hover:bg-slate-700 text-slate-400 hover:text-white transition-colors" title={t('Zoomer')}>
            <ZoomIn size={13} />
          </button>
          <button
            onClick={handleZoomReset}
            className="p-1.5 rounded hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
            title={t('Centrer la vue (reset zoom + pan)')}
          >
            <Maximize2 size={13} />
          </button>
        </div>

        <div className="w-px h-5 bg-slate-700 flex-shrink-0" />

        {/* Import / Export / Backup */}
        <button
          onClick={() => setShowImport(true)}
          data-tour="import-btn"
          className="px-3 py-1 text-xs text-slate-300 hover:text-white bg-slate-700 hover:bg-slate-600 rounded transition-colors flex-shrink-0"
        >
          {t('Importer')}
        </button>
        <button
          onClick={() => void downloadAnnotationBackup(numericProjectId)}
          className="px-2 py-1 text-xs text-slate-300 hover:text-white bg-slate-700 hover:bg-slate-600 rounded transition-colors flex-shrink-0"
          title={t('Télécharger un backup JSON des annotations (glissez-déposez pour restaurer)')}
        >
          <Upload size={12} />
        </button>
        <button
          onClick={() => setShowSettings(true)}
          data-tour="settings-btn"
          className="p-1.5 rounded hover:bg-slate-700 text-slate-400 hover:text-white transition-colors flex-shrink-0"
          title={t('Paramètres')}
        >
          <Settings2 size={15} />
        </button>
        <button
          onClick={() => setShowHelp(true)}
          data-tour="help-btn"
          className="p-1.5 rounded hover:bg-slate-700 text-slate-400 hover:text-white transition-colors flex-shrink-0"
          title={t('Aide — raccourcis & modes')}
        >
          <HelpCircle size={15} />
        </button>
        <button
          onClick={() => setShowExport(true)}
          data-tour="export-btn"
          className="flex items-center gap-1.5 px-3 py-1 text-xs text-white bg-blue-600 hover:bg-blue-500 rounded transition-colors flex-shrink-0"
        >
          <Download size={12} />
          {t('Exporter')}
        </button>
      </header>

      {/* ---- Barre de progression Extraction vidéo (import arrière-plan) ---- */}
      {extractionTaskId && (
        <div className="flex items-center gap-3 px-4 py-1.5 bg-orange-900/40 border-b border-orange-800/50 text-xs text-orange-200 flex-shrink-0">
          <Loader2 size={12} className="animate-spin text-orange-400" />
          <span className="truncate max-w-xs">{t('Extraction frames')} — {extractionMessage || t('En cours...')}</span>
          <div className="flex-1 h-1 bg-slate-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-orange-400 rounded-full transition-all duration-500"
              style={{ width: `${extractionProgress}%` }}
            />
          </div>
          <span className="text-orange-400 font-mono">{extractionProgress}%</span>
        </div>
      )}

      {/* ---- Barre de progression Propagation (guided / homographie / SAMURAI) ---- */}
      {propagationTaskId && (
        <div data-tour="propagation-bar"
             className="flex items-center gap-3 px-4 py-1.5 bg-green-900/40 border-b border-green-800/50 text-xs text-green-200 flex-shrink-0">
          <Loader2 size={12} className="animate-spin text-green-400" />
          <span className="truncate max-w-xs">{propagationLabel} — {propagationStatus || t('Démarrage...')}</span>
          <div className="flex-1 h-1 bg-slate-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-green-400 rounded-full transition-all duration-300"
              style={{ width: `${propagationProgress}%` }}
            />
          </div>
          <span className="text-green-400 font-mono">{propagationProgress}%</span>
          {/* Bouton Stop (carré rouge) toujours visible à droite de la barre */}
          <button
            onClick={handleStopPropagation}
            title={t('Arrêter le process')}
            className="flex items-center justify-center w-6 h-6 rounded bg-red-600 hover:bg-red-500 text-white flex-shrink-0 transition-colors"
          >
            <Square size={11} fill="currentColor" />
          </button>
        </div>
      )}

      {/* ---- Import de séquences en tâche de fond (non-bloquant) ---- */}
      {importJobs.length > 0 && (
        <div className="px-4 py-1.5 bg-blue-900/30 border-b border-blue-800/40 flex-shrink-0 space-y-1">
          <div className="flex items-center gap-2 text-xs text-blue-200">
            {importRunning
              ? <Loader2 size={12} className="animate-spin text-blue-400" />
              : <span className="text-green-400">✓</span>}
            <span className="font-medium">
              {t('Import de')} {importJobs.length} {t('séquence')}{importJobs.length > 1 ? 's' : ''}
              {importRunning ? ` ${t('en cours…')}` : ` ${t('terminé')}`}
            </span>
            {!importRunning && (
              <button
                onClick={() => useImportStore.getState().dismiss()}
                className="ml-auto text-blue-300 hover:text-blue-100"
              >
                {t('Masquer')}
              </button>
            )}
          </div>
          {importJobs.map((job) => (
            <div key={job.id} className="flex items-center gap-2 text-xs">
              <span className="w-40 truncate text-slate-300" title={job.label}>{job.label}</span>
              <div className="flex-1 h-1 bg-slate-700 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    job.status === 'done' ? 'bg-green-500'
                    : job.status === 'error' ? 'bg-red-500' : 'bg-blue-400'
                  }`}
                  style={{ width: `${job.progress}%` }}
                />
              </div>
              <span className={`w-28 truncate ${job.status === 'error' ? 'text-red-400' : 'text-slate-500'}`}>
                {job.message}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* ---- Barre de progression Mode Auto Batch ---- */}
      {autoModeRunning && (
        <div data-tour="batch-bar"
             className={`flex items-center gap-3 px-4 py-1.5 border-b text-xs flex-shrink-0 ${
          autoModePaused
            ? 'bg-yellow-900/40 border-yellow-800/50 text-yellow-200'
            : 'bg-green-900/40 border-green-800/50 text-green-200'
        }`}>
          {autoModePaused
            ? <span className="text-yellow-400">⏸</span>
            : <Loader2 size={12} className="animate-spin text-green-400" />
          }
          <span>
            {textModel === 'sam3' ? 'SAM3' : 'GD'} Batch
            {autoModePaused ? ` (${t('pausé')})` : ''} : {t('frame')} {autoModeProgress.current}/{autoModeProgress.total}
          </span>
          <div className="flex-1 h-1 bg-slate-700 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-300 ${autoModePaused ? 'bg-yellow-400' : 'bg-green-400'}`}
              style={{ width: `${autoModeProgress.total > 0 ? (autoModeProgress.current / autoModeProgress.total) * 100 : 0}%` }}
            />
          </div>
          {!autoModePaused ? (
            <button
              onClick={handleAutoModePause}
              className="flex items-center gap-1 px-2 py-0.5 bg-yellow-700 hover:bg-yellow-600 text-white rounded transition-colors"
            >
              ⏸ {t('Pause')}
            </button>
          ) : (
            <button
              onClick={handleAutoModeResume}
              className="flex items-center gap-1 px-2 py-0.5 bg-green-700 hover:bg-green-600 text-white rounded transition-colors"
            >
              <Play size={10} /> {t('Reprendre')}
            </button>
          )}
          <button
            onClick={handleAutoModeStop}
            className="flex items-center gap-1 px-2 py-0.5 bg-red-700 hover:bg-red-600 text-white rounded transition-colors"
          >
            <StopCircle size={10} /> Stop
          </button>
        </div>
      )}

      {/* ---- Barre de progression SAM Auto ---- */}
      {samAutoStatus !== 'idle' && (
        <div className="flex items-center gap-3 px-4 py-1.5 bg-emerald-900/40 border-b border-emerald-800/50 text-xs text-emerald-200 flex-shrink-0">
          {samAutoStatus === 'done'
            ? <Square size={12} className="text-emerald-400" />
            : <Loader2 size={12} className="animate-spin text-emerald-400" />}
          <span>
            {samAutoStatus === 'connecting' ? t('Connexion SAM...')
              : samAutoStatus === 'running' ? `${t('SAM Auto en cours')} — ${samAutoCount} ${t('masque')}${samAutoCount !== 1 ? 's' : ''}`
              : `${t('SAM Auto terminé')} — ${samAutoCount} ${t('masque')}${samAutoCount !== 1 ? 's' : ''}`}
          </span>
        </div>
      )}

      {/* ---- Corps principal ---- */}
      <div className="flex flex-1 overflow-hidden">
        {/* Panneau gauche : Tracks + Debug (mode Séquence Image uniquement) */}
        {currentProject.project_type === 'video' && (
          <Sidebar
            projectId={numericProjectId}
            classes={classes}
            annotations={annotations}
            tracks={sequenceTracks}
            currentFrameIndex={currentFrameIndex}
            currentFrame={currentFrame}
            frames={frames}
            seqStart={sliderMin}
            seqEnd={sliderMax}
            onTracksUpdated={() => void refreshTracksAndFrame()}
            onPropagationStarted={(taskId, label) => {
              setPropagationTaskId(taskId)
              setPropagationProgress(0)
              setPropagationLabel(label)
              setPropagationStatus(t('Démarrage...'))
            }}
            onFrameSelect={handleFrameSelect}
            onForceAnnotationRefresh={handleForceAnnotationRefresh}
            onLiveFramePreview={handleLiveFramePreview}
          />
        )}

        {/* Canvas central */}
        <div className="flex-1 relative overflow-hidden flex flex-col min-w-0" data-tour="canvas-area">
          {isLoadingFrame && (
            <div className="absolute inset-0 bg-slate-900/50 flex items-center justify-center z-10">
              <LoadingSpinner size="md" />
            </div>
          )}

          {/* Outil LUT (remap 16/8 bits) : bouton flottant + panneau */}
          <button onClick={toggleLut} title={t('LUT / Affichage (remap 16/8 bits, histogramme)')}
            data-tour="lut-btn"
            className={`absolute top-3 right-4 z-30 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors ${isLutOpen ? 'bg-cyan-600 border-cyan-500 text-white' : 'bg-gray-800/90 border-gray-700 text-gray-300 hover:text-white'}`}>
            <LutIcon size={13} /> LUT
          </button>
          {isLutOpen && (
            <LutPanel
              projectId={numericProjectId}
              frameId={currentFrame?.id ?? null}
              sequenceId={currentSeqId}
              sequenceName={currentSequence?.name ?? null}
            />
          )}

          {currentFrame ? (
            <AnnotationCanvas
              key={numericProjectId}
              imageUrl={liveFrameImageUrl(
                currentFrame.id,
                (isScrubbing || isPlaying || propagationTaskId != null)
                  ? 'preview'
                  : (canvasZoom > 1.5 ? 'full' : 'display')
              )}
              imageWidth={currentFrame.width}
              imageHeight={currentFrame.height}
              classes={classes}
              tracks={sequenceTracks}
              frameId={currentFrame.id}
              onSAMMaskClick={handleValidateSAMMask}
              samOutputMode={samOutputMode}
              liveMode={isScrubbing || isPlaying || propagationTaskId != null || autoModeRunning}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center h-full text-slate-600">
              <div className="text-center">
                <p className="text-sm">{t('Aucune frame disponible')}</p>
                <button
                  onClick={() => setShowImport(true)}
                  className="mt-3 text-xs text-blue-400 hover:text-blue-300 underline"
                >
                  {t('Importer des images ou une vidéo')}
                </button>
              </div>
            </div>
          )}

          {/* ---- Contrôles de navigation frame (slider + lecture) ---- */}
          {totalFrameCount > 1 && (
            <div className="bg-slate-800/90 border-t border-slate-700 flex-shrink-0">
              {/* Slider navigation */}
              <div className="flex items-center gap-2 px-3 pt-1.5 pb-1" data-tour="frame-nav">
                {/* Sélecteur de séquence (multi-séquence) */}
                {sequences.length > 0 && (
                  <select
                    value={currentSequence ? String(currentSequence.id ?? 'legacy') : ''}
                    onChange={(e) => {
                      const v = e.target.value
                      const seq = sequences.find((s) => String(s.id ?? 'legacy') === v)
                      if (seq) handleFrameSelect(seq.start_index)
                    }}
                    title={currentSequence
                      ? `${currentSequence.name} — ${currentSequence.annotated_frames}/${currentSequence.frame_count} ${t('frames annotées')} · ${currentSequence.annotation_count} annotations`
                      : t('Séquences du projet')}
                    className="flex-shrink-0 max-w-56 bg-slate-700 border border-slate-600 text-slate-200 text-xs px-1.5 py-0.5 rounded outline-none focus:border-blue-500"
                  >
                    {!currentSequence && <option value="">{t('Séquence…')}</option>}
                    {sequences.map((s) => (
                      <option key={String(s.id ?? 'legacy')} value={String(s.id ?? 'legacy')}>
                        {s.source_type === 'video' ? '🎬' : s.source_type === 'images' ? '🖼' : '📦'} {s.name} · {s.annotated_frames}/{s.frame_count} {t('annotées')} · {s.annotation_count} {t('annot.')}
                      </option>
                    ))}
                  </select>
                )}

                {/* Import annotations (.ver / YOLO) sur la séquence courante — S9 */}
                {currentSequence && (
                  <button
                    onClick={handleImportSeqAnnotations}
                    title={t('Importer des annotations (.ver ou dossier YOLO) sur cette séquence')}
                    className="flex-shrink-0 p-1 rounded hover:bg-slate-700 text-slate-400 hover:text-emerald-400 transition-colors"
                  >
                    <Upload size={14} />
                  </button>
                )}

                <button
                  onClick={handlePrevFrame}
                  disabled={currentFrameIndex <= sliderMin || isPlaying}
                  className="p-1 rounded hover:bg-slate-700 text-slate-400 hover:text-white disabled:opacity-30 transition-colors"
                >
                  <ChevronLeft size={14} />
                </button>

                <input
                  type="range"
                  min={sliderMin}
                  max={sliderMax}
                  value={dragValue ?? currentFrameIndex}
                  onPointerDown={() => { setIsPlaying(false); setIsScrubbing(true) }}
                  onChange={(e) => {
                    const idx = parseInt(e.target.value)
                    // Le curseur suit le doigt immédiatement (dragValue, 0 réseau)
                    setDragValue(idx)
                    // L'image ne se recharge qu'au plus toutes les ~130 ms
                    const st = scrubThrottleRef.current
                    const now = Date.now()
                    if (st.timer) { clearTimeout(st.timer); st.timer = null }
                    if (now - st.last >= 130) {
                      st.last = now
                      setCurrentFrameIndex(idx)
                    } else {
                      st.timer = setTimeout(() => {
                        st.last = Date.now()
                        setCurrentFrameIndex(idx)
                      }, 130)
                    }
                  }}
                  onPointerUp={(e) => {
                    const idx = parseInt((e.target as HTMLInputElement).value)
                    const st = scrubThrottleRef.current
                    if (st.timer) { clearTimeout(st.timer); st.timer = null }
                    setIsScrubbing(false)
                    setDragValue(null)
                    handleFrameSelect(idx)  // charge la full-res de la frame finale
                  }}
                  className="flex-1 h-1.5 accent-blue-500 cursor-pointer"
                  title={currentSequence
                    ? `${currentSequence.name} — ${t('frame')} ${seqLocalIndex + 1} / ${seqLocalCount}`
                    : `${t('Frame')} ${currentFrameIndex + 1} / ${totalFrameCount}`}
                />

                <button
                  onClick={handleNextFrame}
                  disabled={currentFrameIndex >= sliderMax || isPlaying}
                  className="p-1 rounded hover:bg-slate-700 text-slate-400 hover:text-white disabled:opacity-30 transition-colors"
                >
                  <ChevronRight size={14} />
                </button>

                <div className="flex flex-col items-end flex-shrink-0 w-24">
                  <span className="text-xs text-slate-500 font-mono">
                    {(dragValue !== null ? dragValue - sliderMin : seqLocalIndex) + 1} / {seqLocalCount}
                  </span>
                  {/* Saut direct à une frame précise (numéro relatif à la séquence) — S7 */}
                  <form
                    onSubmit={(e) => {
                      e.preventDefault()
                      const v = parseInt(frameJumpInput, 10)
                      if (!Number.isNaN(v)) {
                        // Numéro affiché = 1-based local → index global
                        const target = sliderMin + Math.max(0, Math.min(seqLocalCount - 1, v - 1))
                        handleFrameSelect(target)
                      }
                      setFrameJumpInput('')
                    }}
                    className="flex items-center gap-1 mt-0.5"
                  >
                    <span className="text-[10px] text-slate-600">{t('aller à')}</span>
                    <input
                      type="number" min={1} max={seqLocalCount}
                      value={frameJumpInput}
                      onChange={(e) => setFrameJumpInput(e.target.value)}
                      placeholder="…"
                      className="w-12 bg-slate-800 border border-slate-700 rounded px-1 py-0 text-[10px] text-slate-200 text-center focus:outline-none focus:ring-1 focus:ring-blue-500"
                      title={`${t('Aller à la frame')} (1–${seqLocalCount})`}
                    />
                  </form>
                </div>
              </div>

              {/* Barre de lecture */}
              <div className="flex items-center justify-center gap-3 pb-2">
                {/* Restart */}
                <button
                  onClick={handleRestart}
                  title={t('Retour au début')}
                  className="p-1.5 rounded-full hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
                >
                  <RotateCcw size={13} />
                </button>

                {/* Play / Pause */}
                <button
                  onClick={handlePlayPause}
                  title={isPlaying ? t('Pause') : t('Lecture')}
                  className={[
                    'flex items-center justify-center w-8 h-8 rounded-full transition-colors',
                    isPlaying
                      ? 'bg-blue-600 hover:bg-blue-500 text-white'
                      : 'bg-slate-700 hover:bg-slate-600 text-slate-200',
                  ].join(' ')}
                >
                  {isPlaying ? <Pause size={15} /> : <Play size={15} />}
                </button>

                {/* FPS selector */}
                <div className="flex items-center gap-1.5 ml-1">
                  <span className="text-xs text-slate-500">FPS</span>
                  <div className="flex gap-0.5">
                    {[1, 2, 3, 4, 5].map((fps) => (
                      <button
                        key={fps}
                        onClick={() => setPlayFps(fps)}
                        className={[
                          'text-xs px-1.5 py-0.5 rounded transition-colors font-mono',
                          playFps === fps
                            ? 'bg-blue-600 text-white'
                            : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700',
                        ].join(' ')}
                      >
                        {fps}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Panneau droit : Classes / Annots / Aide (largeur redimensionnable, non persistée) */}
        <RightPanel
          classes={classes}
          annotations={annotations}
          tracks={sequenceTracks}
          onCreateClass={handleCreateClass}
          onUpdateClass={handleUpdateClass}
          onDeleteClass={handleDeleteClass}
          onDeleteAnnotation={handleDeleteAnnotation}
          onDeleteAllAnnotations={handleDeleteAllAnnotations}
          onApplyNMS={handleApplyNMS}
          onAssignTrack={handleAssignTrack}
        />
      </div>

      {/* ---- Timeline ---- */}
      {totalFrameCount > 0 && (
        <Timeline
          frames={frames}
          tracks={sequenceTracks}
          classes={classes}
          currentFrameIndex={currentFrameIndex}
          totalFrames={totalFrameCount}
          windowStart={sliderMin}
          windowCount={seqLocalCount}
          onFrameSelect={handleFrameSelect}
          onDeleteAnnotationsForFrames={handleDeleteAnnotationsForFrames}
          onDeleteTrack={handleDeleteTrack}
          onDeleteTrackBlock={handleDeleteTrackBlock}
          tracksHeight={tracksPanelHeight}
          onTracksHeightChange={handleTracksHeightChange}
          leftSlot={<UserBadge />}
        />
      )}

      {/* ---- Modals ---- */}
      <SettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
      />
      <HelpModal
        isOpen={showHelp}
        onClose={() => setShowHelp(false)}
        onStartTour={() => {
          setShowHelp(false)
          const tourCtx: AnnotationTourContext = {
            navigate, projectId: null, project2Id: null, samplePath: null,
          }
          void writeTutorialState(TUTORIAL_KEY, { launchedOnce: true })
          startTour(buildAnnotationTourSteps(), tourCtx, {
            onFinish: () => { void writeTutorialState(TUTORIAL_KEY, { completed: true }) },
          })
        }}
      />
      <ExportModal
        isOpen={showExport}
        projectId={numericProjectId}
        projectName={currentProject?.name}
        onClose={() => setShowExport(false)}
      />

      <ImportModal
        isOpen={showImport}
        projectId={numericProjectId}
        projectType={currentProject.project_type}
        onImported={async (taskId?: string) => {
          await fetchFrames(numericProjectId)
          await fetchProject(numericProjectId)
          void loadSequences()
          if (taskId) {
            setExtractionTaskId(taskId)
            setExtractionProgress(0)
            setExtractionMessage(t('Extraction en cours...'))
          }
        }}
        onClose={() => setShowImport(false)}
      />
    </div>
  )
}
