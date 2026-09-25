// ============================================================
// components/sidebar/TrackPanel.tsx
// Panneau de tracking sequence.
//
// Onglets :
//   - SAMURAI  : SAM2 video tracking
//   - Detect.  : GD/SAM3 frame-par-frame + matching centroide
//   - Homogr.  : propagation geometrique XFeat/SIFT
//   - Flux opt.: Lucas-Kanade par objet
// ============================================================

import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Layers,
  Pause,
  Play,
  Square,
  Trash2,
  Wind,
  Zap,
} from 'lucide-react'
import type { Annotation, Frame, LabelClass, Track, TaskLiveFrameObject } from '../../types/api'
import { datasetAPI, taskAPI, trackingAPI } from '../../services/api'
import { subscribeTaskProgress } from '../../services/websocket'
import { useAnnotationStore } from '../../stores/annotationStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useT } from '../../i18n/useLang'

interface TrackPanelProps {
  projectId: number
  tracks: Track[]
  classes: LabelClass[]
  currentFrameIndex: number
  currentFrame: Frame | null
  annotations: Annotation[]
  frames: Frame[]
  // Bornes (frame_index global) de la séquence courante — la propagation reste
  // DANS la séquence (décorrélation, S2b/c). Repli sur tout le projet si absent.
  seqStart?: number
  seqEnd?: number
  onTracksUpdated: () => void
  onPropagationStarted: (taskId: string, label: string) => void
  onFrameNavigate: (frameIndex: number) => void
  onForceAnnotationRefresh?: (frameArrIdx: number) => Promise<void>
  // Apercu instantane depuis le message WS (SAM2/SAMURAI) : pas de GET, pas
  // de dependance au commit DB (ecritures groupees par lots cote backend).
  onLiveFramePreview?: (frameArrIdx: number, objects: TaskLiveFrameObject[],
                        nativePath?: string | null) => void
}

type PanelTab = 'samurai' | 'guided' | 'xfeat' | 'optflow'

// Label d'une cible : classe (gros) + sous-classe/sous-sous-classe (petit, à côté)
// pour distinguer d'un coup d'œil deux objets de même classe.
const TargetClassLabel: React.FC<{ cls?: LabelClass; classId: number }> = ({ cls, classId }) => {
  const sub = [cls?.subclass, cls?.subsubclass].filter(Boolean).join(' › ')
  return (
    <span className="text-xs text-slate-300 truncate flex items-baseline gap-1 min-w-0">
      <span className="truncate">{cls?.name ?? `cls_${classId}`}</span>
      {sub && <span className="text-[9px] text-slate-500 truncate flex-shrink" title={sub}>{sub}</span>}
    </span>
  )
}

export const TrackPanel: React.FC<TrackPanelProps> = ({
  projectId,
  tracks,
  classes,
  currentFrameIndex,
  currentFrame,
  annotations,
  frames,
  seqStart,
  seqEnd,
  onTracksUpdated,
  onPropagationStarted,
  onFrameNavigate,
  onForceAnnotationRefresh,
  onLiveFramePreview,
}) => {
  const t = useT()
  const algo = useSettingsStore((s) => s.settings?.algorithms)
  // Cadence minimale entre deux sauts du canvas (Parametres > Interface).
  // 150 ms par defaut pour suivre la boucle WebSocket via SMB. Un client en
  // repli HTTP peut augmenter cette valeur pour reduire le trafic image.
  const navThrottleMs = useSettingsStore(
    (st) => st.settings?.interface?.propagation_nav_throttle_ms ?? 150)
  const realtimeLiveDefault = useSettingsStore(
    (st) => st.settings?.interface?.realtime_live_enabled ?? true)
  // Fin de plage par défaut = fin de la séquence courante (pas la fin du projet).
  const seqLastIndex = seqEnd ?? (frames.length > 0 ? frames.length - 1 : 0)
  const seqFirstIndex = seqStart ?? 0

  const [tab, setTab] = useState<PanelTab>('samurai')

  // --- Guided tracking state ---
  // Cibles de tracking : synchronisées avec le store global (double-clic canvas ↔ checkboxes)
  const { trackingTargetIds, toggleTrackingTarget, setTrackingTargets } = useAnnotationStore()
  const selectedAnnotationIds = trackingTargetIds
  const [startFrameIndex, setStartFrameIndex] = useState<number>(currentFrameIndex + 1)
  const [endFrameIndex, setEndFrameIndex] = useState<number>(seqLastIndex)
  const [algorithm, setAlgorithm] = useState<'grounding_dino' | 'sam3'>('grounding_dino')
  const [textPrompt, setTextPrompt] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [boxThreshold, setBoxThreshold] = useState(algo?.grounding_dino_box_threshold ?? 0.30)
  const [textThreshold, setTextThreshold] = useState(algo?.grounding_dino_text_threshold ?? 0.25)
  const [maxCentroidDist, setMaxCentroidDist] = useState(algo?.guided_max_centroid_dist ?? 0.15)
  const [sizeVarThreshold, setSizeVarThreshold] = useState(algo?.guided_size_variation ?? 0.5)
  // Auto-stop
  const [autoStopEnabled, setAutoStopEnabled] = useState(false)
  const [autoStopLostRatio, setAutoStopLostRatio] = useState(0.5)
  const [autoStopConsecutiveFrames, setAutoStopConsecutiveFrames] = useState(5)

  // --- XFeat / Homographie state ---
  const [xfeatEndFrameIndex, setXfeatEndFrameIndex] = useState<number>(seqLastIndex)
  const [minInlierCount, setMinInlierCount] = useState<number>(algo?.min_inlier_count ?? 30)
  const [minInlierRatio, setMinInlierRatio] = useState<number>(algo?.min_inlier_ratio ?? 0.5)
  const [ransacThreshold, setRansacThreshold] = useState<number>(algo?.ransac_threshold ?? 3.0)
  const [xfeatTopK, setXfeatTopK] = useState<number>(algo?.xfeat_top_k ?? 4096)
  const [xfeatMinCossim, setXfeatMinCossim] = useState<number>(algo?.xfeat_min_cossim ?? 0.82)
  const [homographyMethod, setHomographyMethod] = useState<'xfeat' | 'sift' | null>(null)

  // --- Optical Flow tab state ---
  const [optflowEndFrameIndex, setOptflowEndFrameIndex] = useState<number>(seqLastIndex)
  const [optflowWinSize, setOptflowWinSize] = useState<number>(algo?.optflow_win_size ?? 21)
  const [optflowMaxLevel, setOptflowMaxLevel] = useState<number>(algo?.optflow_max_level ?? 3)
  const [optflowMinPts, setOptflowMinPts] = useState<number>(algo?.optflow_min_pts ?? 4)

  // --- SAMURAI (SAM2 video tracking) tab state ---
  const [sam2EndFrameIndex, setSam2EndFrameIndex] = useState<number>(seqLastIndex)
  const [sam2OutputMode, setSam2OutputMode] = useState<'bbox' | 'segmentation'>('bbox')
  // 'auto' : SAMURAI si 1 cible, sinon SAM2 multi-objets (1 passe, rapide).
  // 'samurai_per_object' : 1 passe SAMURAI par cible (Kalman par objet, plus lent).
  const [sam2TrackingMode, setSam2TrackingMode] = useState<'auto' | 'samurai_per_object'>('auto')

  // Cibles à suivre PARTAGÉES par tous les modes de tracking (SAMURAI, Detect,
  // Homogr., Flux opt.). Branchées sur le store → le double-clic sur une bbox
  // dans le canvas coche/décoche directement la cible ici, quel que soit l'onglet.
  const trackingTargetSet = trackingTargetIds
  const [samuraiStatus, setSamuraiStatus] = useState<{
    installed: boolean
    loaded: boolean
    gpu?: {
      cuda: boolean
      name: string | null
      vram_total_gb: number | null
      vram_free_gb: number | null
      vram_used_gb: number | null
      image_size: number | null
      bytes_per_frame: number | null
      est_max_frames_gpu: number | null
    }
  } | null>(null)

  // Resync si settings chargés après le mount (async fetch)
  const algoLoaded = useSettingsStore((s) => s.loaded)
  useEffect(() => {
    if (!algoLoaded || !algo) return
    setBoxThreshold(algorithm === 'sam3' ? algo.sam3_box_threshold : algo.grounding_dino_box_threshold)
    setTextThreshold(algorithm === 'sam3' ? algo.sam3_text_threshold : algo.grounding_dino_text_threshold)
    setMaxCentroidDist(algo.guided_max_centroid_dist)
    setSizeVarThreshold(algo.guided_size_variation)
    setMinInlierCount(algo.min_inlier_count)
    setMinInlierRatio(algo.min_inlier_ratio)
    setRansacThreshold(algo.ransac_threshold)
    setXfeatTopK(algo.xfeat_top_k)
    setXfeatMinCossim(algo.xfeat_min_cossim)
    setOptflowWinSize(algo.optflow_win_size)
    setOptflowMaxLevel(algo.optflow_max_level)
    setOptflowMinPts(algo.optflow_min_pts)
    // Auto-stop depuis settings
    if (algo.auto_stop_enabled !== undefined) setAutoStopEnabled(algo.auto_stop_enabled)
    if (algo.auto_stop_lost_ratio) setAutoStopLostRatio(algo.auto_stop_lost_ratio)
    if (algo.auto_stop_consecutive_frames) setAutoStopConsecutiveFrames(algo.auto_stop_consecutive_frames)
  }, [algoLoaded]) // eslint-disable-line

  // Resync thresholds quand l'algo change
  useEffect(() => {
    if (!algo) return
    setBoxThreshold(algorithm === 'sam3' ? algo.sam3_box_threshold : algo.grounding_dino_box_threshold)
    setTextThreshold(algorithm === 'sam3' ? algo.sam3_text_threshold : algo.grounding_dino_text_threshold)
  }, [algorithm]) // eslint-disable-line

  // --- SAM3 output mode ---
  const [sam3OutputMode, setSam3OutputMode] = useState<'bbox' | 'segmentation'>('bbox')

  // --- Run state ---
  const [isRunning, setIsRunning] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [isGuidedTask, setIsGuidedTask] = useState(false)  // true = tâche guidée (pause dispo)
  const [runStatus, setRunStatus] = useState('')
  const [taskProgress, setTaskProgress] = useState(0)   // 0-100
  const [taskId, setTaskId] = useState<string | null>(null)
  // Suivi temps reel : un seul point de controle, dans Parametres > Interface.
  // Quand il est actif, le canvas suit les frames poussees par le WebSocket et,
  // sous Electron avec montage natif, lit les JPEG temporaires via app-image
  // / nativePath au lieu de saturer HTTP.
  const realtimeNav = realtimeLiveDefault
  // AbortController pour la boucle de polling séquentielle
  const pollAbortRef = useRef<AbortController | null>(null)
  const networkErrorCountRef = useRef(0)
  // Dernier frame_id reçu du backend — évite de re-naviguer sur le même frame
  const lastNavFidRef = useRef<number | null>(null)
  // Horodatage de la dernière navigation — throttle de l'aperçu temps réel
  const lastNavAtRef = useRef(0)
  const realtimeNavRef = useRef(realtimeNav)
  realtimeNavRef.current = realtimeNav
  // Ref plutot que valeur capturee : applyUpdate vit dans un effet monte une
  // seule fois par run, changer le reglage doit prendre effet immediatement.
  const navThrottleRef = useRef(navThrottleMs)
  navThrottleRef.current = navThrottleMs

  // --- Console de logs algo (mêmes lignes que le terminal) ---
  const [algoLogs, setAlgoLogs] = useState<string[]>([])
  const logSinceRef = useRef(0)
  const logEndRef = useRef<HTMLDivElement | null>(null)
  // Vue du panneau du bas : logs de l'algo OU liste des tracks (#uid)
  const [bottomView, setBottomView] = useState<'logs' | 'tracks'>('logs')

  // Refs mis a jour a chaque render pour eviter les stale closures dans setInterval
  const framesRef = useRef(frames)
  framesRef.current = frames
  const onFrameNavigateRef = useRef(onFrameNavigate)
  onFrameNavigateRef.current = onFrameNavigate
  const onTracksUpdatedRef = useRef(onTracksUpdated)
  onTracksUpdatedRef.current = onTracksUpdated
  // isPausedRef : permet de vérifier l'état pause DANS setInterval (évite stale closure)
  const isPausedRef = useRef(isPaused)
  isPausedRef.current = isPaused
  const onForceAnnotationRefreshRef = useRef(onForceAnnotationRefresh)
  onForceAnnotationRefreshRef.current = onForceAnnotationRefresh
  const onLiveFramePreviewRef = useRef(onLiveFramePreview)
  onLiveFramePreviewRef.current = onLiveFramePreview

  // Utiliser la position dans le tableau (array index), pas frame.frame_index DB
  // (frame_index en DB peut être non-séquentiel après import vidéo)
  const lastFrameIndex = seqLastIndex   // borne = fin de la séquence courante (S2b/c)
  // --- Numérotation LOCALE à la séquence (affichage uniquement) ---
  // Les states de plage (startFrameIndex, sam2EndFrameIndex, …) restent en index
  // GLOBAL (frame_index projet) car le backend de tracking en dépend. Mais on
  // AFFICHE des numéros 1-based relatifs à la séquence courante (« Frame 1 / N »
  // au lieu de « 180 / 358 ») pour que chaque séquence soit indépendante.
  const seqFrameCount = lastFrameIndex - seqFirstIndex + 1
  const toLocal = (g: number) => g - seqFirstIndex + 1   // global → local 1-based
  const fromLocal = (l: number) => l - 1 + seqFirstIndex // local 1-based → global

  // Résout une frame par son frame_index RÉEL. Le tableau `frames` est chargé
  // paresseusement (fenêtres + sauts) : la position tableau ne correspond plus
  // au frame_index dès que l'utilisateur a navigué loin. Résoudre par position
  // pouvait renvoyer une frame AVANT la frame courante → 400 "Aucune frame
  // dans la plage" côté backend.
  const resolveFrameByIndex = async (frameIndex: number): Promise<Frame | null> => {
    const local = frames.find((f) => f.frame_index === frameIndex)
    if (local) return local
    try {
      return await datasetAPI.getFrameByIndex(projectId, frameIndex)
    } catch {
      return frames.length > 0 ? frames[frames.length - 1] : null
    }
  }

  // Extrait le message d'erreur renvoyé par le backend (detail FastAPI)
  const apiErrorDetail = (e: unknown): string | null => {
    const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
    return typeof detail === 'string' ? detail : null
  }

  // Nombre de cibles cochées SUR LA FRAME COURANTE uniquement (pas toutes les frames)
  const currentFrameTargetCount = annotations.filter((a) => selectedAnnotationIds.has(a.id)).length

  const getClassName = (classId: number) =>
    classes.find((c) => c.id === classId)?.name ?? `classe_${classId}`

  // Les tracks guidés stockent désormais des positions tableau directement (voir backend).
  // Pas besoin de conversion : start_frame/end_frame = array index.

  // Chargement de la méthode de matching (xfeat ou sift) + statut SAMURAI au montage
  useEffect(() => {
    trackingAPI.homographyStatus()
      .then((s) => setHomographyMethod(s.method))
      .catch(() => {/* backend non démarré */})
    fetch('/api/samurai/status')
      .then((r) => r.json())
      .then((s) => setSamuraiStatus(s))
      .catch(() => { /* silencieux */ })
  }, [])

  // Rafraîchir la VRAM libre à l'ouverture de l'onglet SAMURAI (estimation à jour)
  useEffect(() => {
    if (tab !== 'samurai') return
    fetch('/api/samurai/status')
      .then((r) => r.json())
      .then((s) => setSamuraiStatus(s))
      .catch(() => { /* silencieux */ })
  }, [tab])

  // Mise a jour de la plage de frames quand la frame courante change
  useEffect(() => {
    setStartFrameIndex(Math.min(currentFrameIndex + 1, lastFrameIndex))
  }, [currentFrameIndex, lastFrameIndex])

  // Changement de séquence → borner la plage de propagation À LA SÉQUENCE (S2b/c) :
  // la fin par défaut redevient la dernière frame de la séquence courante, jamais
  // la fin du projet (on ne propage pas d'une séquence à l'autre).
  useEffect(() => {
    setEndFrameIndex(seqLastIndex)
    setXfeatEndFrameIndex(seqLastIndex)
    setOptflowEndFrameIndex(seqLastIndex)
    setSam2EndFrameIndex(seqLastIndex)
  }, [seqFirstIndex, seqLastIndex])

  // -------------------------------------------------------------------
  // Suivi de la tache en arriere-plan : WebSocket en priorite (une seule
  // connexion poussee, /ws/tasks/{id} — voir tracking.py), avec repli sur le
  // polling HTTP sequentiel (AbortController, jamais de requetes concurrentes)
  // si le WS ne s'etablit pas sous 2,5 s (proxy SSH qui bloque l'upgrade, etc.)
  // ou echoue a se reconnecter. Le repli s'auto-annule des qu'un message WS
  // arrive : jamais les deux canaux actifs en meme temps.
  // -------------------------------------------------------------------
  const stopPolling = useCallback(() => {
    if (pollAbortRef.current) {
      pollAbortRef.current.abort()
      pollAbortRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!taskId) return
    stopPolling()
    lastNavFidRef.current = null  // reset au demarrage d'une nouvelle tache
    lastNavAtRef.current = 0

    let stopped = false
    let gotWsUpdate = false
    let httpFallbackStarted = false
    const httpController = new AbortController()
    pollAbortRef.current = httpController

    const finish = () => {
      stopped = true
      httpController.abort()
    }

    // Traite une mise a jour de statut, quelle que soit sa source (WS ou HTTP).
    const applyUpdate = (
      status: string, progress: number, message: string, error: string | null,
      fid: number | null,
      liveFrame: { frame_id: number; native_path?: string | null; objects: TaskLiveFrameObject[] } | null,
      hasLivePayload: boolean = liveFrame != null,
    ) => {
      setRunStatus(message ?? '')
      setTaskProgress(progress ?? 0)

      // Indicateur "annotee" de la timeline (pastille rouge/verte) : mis a
      // jour a CHAQUE message live_frame, DECOUPLE du throttle de nav
      // ci-dessous. SAMURAI tourne a 5-15 fps mais la nav etait auparavant
      // plafonnee a ~1,4/s (700ms) -- sans ce decouplage, ~3/4 des frames traitees
      // entre deux nav ne recevaient jamais leur mise a jour d'indicateur et
      // restaient visuellement "non annotees" jusqu'au flush DB suivant (par
      // lots de 10) ou la toute fin du run (symptome : "reste rouge pendant
      // le run, tout devient vert d'un coup a la fin"). Sans risque pour le
      // canvas : handleLiveFramePreview ne touche l'overlay QUE si arrIdx
      // correspond a la frame actuellement affichee (guard cote appelant),
      // donc appeler ceci plus souvent ne fait pas clignoter la vue.
      if (liveFrame && onLiveFramePreviewRef.current) {
        const previewFrame = framesRef.current.find((f) => f.id === liveFrame.frame_id)
        if (previewFrame) onLiveFramePreviewRef.current(previewFrame.frame_index, liveFrame.objects,
                                                        liveFrame.native_path)
      }

      // Navigation du canvas : 150 ms par defaut, soit la cadence de vidage du
      // WebSocket. Les profils peuvent choisir 0 pour suivre chaque resultat
      // GPU ou augmenter la valeur quand le chemin natif n'est pas disponible.
      const sinceLastNav = Date.now() - lastNavAtRef.current
      if (realtimeNavRef.current && fid != null && fid !== lastNavFidRef.current
          && !isPausedRef.current && sinceLastNav >= navThrottleRef.current) {
        lastNavFidRef.current = fid
        lastNavAtRef.current = Date.now()
        const targetFrame = framesRef.current.find((f) => f.id === fid)
        if (targetFrame) {
          // `frames` est une fenetre sparse sur les gros datasets. Sa position
          // locale n'est pas le numero de frame attendu par la navigation.
          onFrameNavigateRef.current(targetFrame.frame_index)
          // `liveFrame` peut etre null parce que le lot `live_frames` a deja
          // ete traite juste avant. Cela ne signifie PAS qu'il faut relire la
          // DB : SAMURAI commit par lots de 10 et ce GET renverrait alors [] en
          // ecrasant l'overlay WS. `hasLivePayload` distingue explicitement un
          // lot live deja applique du vrai repli HTTP sans donnees d'apercu.
          if (!hasLivePayload && onForceAnnotationRefreshRef.current) {
            void onForceAnnotationRefreshRef.current(targetFrame.frame_index)
          }
        }
      }

      if (status === 'completed') {
        setIsRunning(false)
        setIsPaused(false)
        setIsGuidedTask(false)
        setTaskId(null)
        setTaskProgress(100)
        onTracksUpdatedRef.current()
        setTimeout(() => setRunStatus(''), 3000)
        finish()
      } else if (status === 'error') {
        setIsRunning(false)
        setIsPaused(false)
        setIsGuidedTask(false)
        setTaskId(null)
        setRunStatus(`${t('Erreur')} : ${error ?? t('inconnue')}`)
        setTimeout(() => setRunStatus(''), 5000)
        finish()
      }
    }

    // ---- Repli HTTP (boucle sequentielle, jamais de requetes concurrentes) ----
    const startHttpFallback = () => {
      if (httpFallbackStarted || stopped) return
      httpFallbackStarted = true
      const run = async () => {
        while (!httpController.signal.aborted) {
          if (gotWsUpdate) break  // le WS a fini par repondre entre-temps
          try {
            const res = await fetch(`/api/tasks/${taskId}`, { signal: httpController.signal })
            if (res.ok) {
              networkErrorCountRef.current = 0
              const task = await res.json() as {
                status: string; progress: number; message: string
                error: string | null; current_frame_id?: number
              }
              applyUpdate(task.status, task.progress ?? 0, task.message ?? '',
                          task.error ?? null, task.current_frame_id ?? null, null, false)
            }
          } catch (e) {
            if (e instanceof DOMException && e.name === 'AbortError') break
            networkErrorCountRef.current += 1
            if (networkErrorCountRef.current >= 10) {
              setIsRunning(false); setIsPaused(false); setIsGuidedTask(false); setTaskId(null)
              setRunStatus(t('Connexion backend perdue : polling arrete.'))
              setTimeout(() => setRunStatus(''), 5000)
              break
            }
          }
          const delay = isPausedRef.current ? 1000 : (realtimeNavRef.current ? 600 : 1200)
          try {
            await new Promise<void>((resolve, reject) => {
              const t = setTimeout(resolve, delay)
              httpController.signal.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('Aborted', 'AbortError')) })
            })
          } catch { break }
        }
      }
      void run()
    }

    // ---- WebSocket (canal principal) ----
    const wsFallbackTimer = setTimeout(() => {
      if (!gotWsUpdate && !stopped) startHttpFallback()
    }, 2500)
    const subscription = subscribeTaskProgress(taskId, {
      update: (msg) => {
        if (stopped) return
        gotWsUpdate = true
        clearTimeout(wsFallbackTimer)
        // `live_frames` porte TOUTES les frames propagees depuis le message
        // precedent, pas seulement la derniere. Le serveur echantillonnait un
        // slot unique toutes les 150 ms alors que la propagation tourne a
        // 5-15 f/s : les frames intercalees n'etaient jamais annoncees et leur
        // pastille de timeline restait rouge jusqu'au flush DB ou la fin du run.
        const batch = msg.live_frames ?? []
        for (const lf of batch) {
          if (!lf || onLiveFramePreviewRef.current == null) continue
          const previewFrame = framesRef.current.find((f) => f.id === lf.frame_id)
          if (previewFrame) {
            onLiveFramePreviewRef.current(previewFrame.frame_index, lf.objects, lf.native_path)
          }
        }
        applyUpdate(msg.status, msg.progress, msg.message, msg.error, msg.current_frame_id,
                    batch.length > 0 ? null : msg.live_frame,
                    batch.length > 0 || msg.live_frame != null)
      },
      notFound: () => {
        if (stopped) return
        setIsRunning(false); setIsPaused(false); setIsGuidedTask(false); setTaskId(null)
        finish()
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
  }, [taskId, stopPolling])

  // Reinitialise la console au demarrage d'une NOUVELLE tache uniquement
  // (pas a chaque bascule d'onglet Logs/Tracks, cf. effet de polling ci-dessous).
  useEffect(() => {
    if (!taskId) return
    setAlgoLogs([])
    logSinceRef.current = 0
  }, [taskId])

  // -------------------------------------------------------------------
  // Polling des LOGS de l'algo (incrémentiel, 700 ms — léger même en SSH).
  // Récupère les lignes depuis le dernier index reçu et les ajoute à la console.
  // ACTIF UNIQUEMENT quand l'onglet "Logs" est effectivement affiche
  // (bottomView === 'logs') -- avant, ce polling tournait meme onglet
  // "Tracks" affiche, consommant en continu une connexion HTTP/1.1 pour un
  // panneau que personne ne regardait. Pendant un run SAMURAI actif, chaque
  // connexion compte : le WebSocket mutualise + ce polling + les GET
  // annotations/image-path se partagent le budget de 6
  // connexions simultanees par origine du navigateur -- liberer celle-ci
  // quand elle est inutile allege directement la contention.
  // -------------------------------------------------------------------
  useEffect(() => {
    if (!taskId || bottomView !== 'logs') return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const poll = async () => {
      if (cancelled) return
      try {
        const res = await taskAPI.getLogs(taskId, logSinceRef.current)
        if (!cancelled && res.lines.length > 0) {
          logSinceRef.current = res.next
          setAlgoLogs((prev) => {
            const merged = [...prev, ...res.lines]
            return merged.length > 400 ? merged.slice(merged.length - 400) : merged
          })
        }
      } catch { /* transitoire — on réessaie */ }
      if (!cancelled) timer = setTimeout(poll, 700)
    }
    void poll()
    return () => { cancelled = true; if (timer) clearTimeout(timer) }
  }, [taskId, bottomView])

  // Auto-scroll de la console vers le bas à chaque nouvelle ligne
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ block: 'end' })
  }, [algoLogs])

  // -------------------------------------------------------------------
  // Guided Tracking
  // -------------------------------------------------------------------
  const toggleAnnotation = (id: number) => toggleTrackingTarget(id)

  const handleRunGuidedTracking = async () => {
    if (!currentFrame) return
    if (selectedAnnotationIds.size === 0) {
      setRunStatus(t('Selectionnez au moins une annotation cible'))
      setTimeout(() => setRunStatus(''), 3000)
      return
    }
    if (!textPrompt.trim()) {
      setRunStatus(t('Le prompt texte est obligatoire'))
      setTimeout(() => setRunStatus(''), 3000)
      return
    }
    setIsRunning(true)
    setIsPaused(false)
    setIsGuidedTask(true)
    setTaskProgress(0)
    setRunStatus(t('Lancement detection + association...'))

    // Résolution par frame_index réel (le tableau frames peut être creux)
    const startFrameObj = await resolveFrameByIndex(startFrameIndex)
    const endFrameObj   = await resolveFrameByIndex(endFrameIndex)
    // Stocker la position tableau de départ pour la navigation temps réel
    try {
      const result = await trackingAPI.runGuidedTracking(projectId, {
        reference_frame_id: currentFrame.id,
        annotation_ids: Array.from(selectedAnnotationIds),
        start_frame_index: startFrameObj?.frame_index ?? startFrameIndex,
        end_frame_index:   endFrameObj?.frame_index   ?? endFrameIndex,
        // Positions tableau envoyées pour que le backend stocke les bons indices dans le Track
        ref_array_index: currentFrameIndex,
        end_array_index: endFrameIndex,
        algorithm,
        text_prompt: textPrompt,
        box_threshold: boxThreshold,
        text_threshold: textThreshold,
        max_centroid_distance: maxCentroidDist,
        size_variation_threshold: sizeVarThreshold,
        ...(algorithm === 'sam3' ? { sam3_output_mode: sam3OutputMode } : {}),
        auto_stop_lost_ratio: autoStopEnabled ? autoStopLostRatio : 0.0,
        auto_stop_consecutive_frames: autoStopConsecutiveFrames,
      })
      setTaskId(result.task_id)
      onPropagationStarted(result.task_id, t('Detection + association'))
      setRunStatus(`${t('En cours')} (${result.targets_count} ${t('cibles')}, ${result.frames_to_process} frames)...`)
    } catch (e) {
      setIsRunning(false)
      setRunStatus(apiErrorDetail(e) ?? t('Erreur lancement tracking'))
      console.error('Erreur guided tracking:', e)
      setTimeout(() => setRunStatus(''), 4000)
    }
  }

  // -------------------------------------------------------------------
  // XFeat / Homographie
  // -------------------------------------------------------------------
  const handleRunXFeat = async () => {
    if (!currentFrame) return
    const annotationIds = trackingTargetSet.size > 0
      ? annotations.filter((a) => trackingTargetSet.has(a.id)).map((a) => a.id)
      : annotations.map((a) => a.id)
    if (annotationIds.length === 0) {
      setRunStatus(t('Aucune annotation sur cette frame'))
      setTimeout(() => setRunStatus(''), 3000)
      return
    }
    const endFrame = await resolveFrameByIndex(xfeatEndFrameIndex)
    if (!endFrame) {
      setRunStatus(t('Frame de fin introuvable'))
      setTimeout(() => setRunStatus(''), 3000)
      return
    }
    if (endFrame.frame_index <= currentFrame.frame_index) {
      setRunStatus(`${t('La frame de fin')} (${endFrame.frame_index}) ${t('doit être après la frame courante')} (${currentFrame.frame_index})`)
      setTimeout(() => setRunStatus(''), 4000)
      return
    }
    setIsRunning(true)
    setTaskProgress(0)
    setRunStatus(t('Lancement propagation homographique...'))
    try {
      const result = await trackingAPI.propagateHomography(projectId, {
        keyframe_id: currentFrame.id,
        end_frame_id: endFrame.id,
        annotation_ids: annotationIds,
        min_inlier_count: minInlierCount,
        min_inlier_ratio: minInlierRatio,
        ransac_threshold: ransacThreshold,
        xfeat_top_k: xfeatTopK,
        xfeat_min_cossim: xfeatMinCossim,
        use_optical_flow: false,
      })
      // Déléguer polling + navigation + top bar à AnnotationPage
      onPropagationStarted(result.task_id, t('Propagation homographie'))
      setTaskId(result.task_id)
    } catch (e) {
      setIsRunning(false)
      setRunStatus(apiErrorDetail(e) ?? t('Erreur propagation'))
      console.error('Erreur XFeat:', e)
      setTimeout(() => setRunStatus(''), 3000)
    }
  }

  // -------------------------------------------------------------------
  // Flux Optique Lucas-Kanade
  // -------------------------------------------------------------------
  const handleRunOptflow = async () => {
    if (!currentFrame) return
    const annotationIds = trackingTargetSet.size > 0
      ? annotations.filter((a) => trackingTargetSet.has(a.id)).map((a) => a.id)
      : annotations.map((a) => a.id)
    if (annotationIds.length === 0) {
      setRunStatus(t('Aucune annotation sur cette frame'))
      setTimeout(() => setRunStatus(''), 3000)
      return
    }
    const endFrame = await resolveFrameByIndex(optflowEndFrameIndex)
    if (!endFrame) {
      setRunStatus(t('Frame de fin introuvable'))
      setTimeout(() => setRunStatus(''), 3000)
      return
    }
    if (endFrame.frame_index <= currentFrame.frame_index) {
      setRunStatus(`${t('La frame de fin')} (${endFrame.frame_index}) ${t('doit être après la frame courante')} (${currentFrame.frame_index})`)
      setTimeout(() => setRunStatus(''), 4000)
      return
    }
    setIsRunning(true)
    setTaskProgress(0)
    setRunStatus(t('Lancement flux optique...'))
    try {
      const result = await trackingAPI.propagateHomography(projectId, {
        keyframe_id: currentFrame.id,
        end_frame_id: endFrame.id,
        annotation_ids: annotationIds,
        use_optical_flow: true,
        optflow_win_size: optflowWinSize,
        optflow_max_level: optflowMaxLevel,
        optflow_min_pts: optflowMinPts,
      })
      onPropagationStarted(result.task_id, t('Flux optique LK'))
      setTaskId(result.task_id)
    } catch (e) {
      setIsRunning(false)
      setRunStatus(apiErrorDetail(e) ?? t('Erreur flux optique'))
      console.error('Erreur optflow:', e)
      setTimeout(() => setRunStatus(''), 3000)
    }
  }

  // -------------------------------------------------------------------
  // SAM2 Video Tracking (SAMURAI-style)
  // -------------------------------------------------------------------
  const handleRunSam2Tracking = async () => {
    if (!currentFrame) return
    const annotationIds = trackingTargetSet.size > 0
      ? annotations.filter((a) => trackingTargetSet.has(a.id)).map((a) => a.id)
      : annotations.map((a) => a.id)
    if (annotationIds.length === 0) {
      setRunStatus(t('Aucune annotation sur cette frame')); setTimeout(() => setRunStatus(''), 3000); return
    }
    const endFrame = await resolveFrameByIndex(sam2EndFrameIndex)
    if (!endFrame) { setRunStatus(t('Frame de fin introuvable')); setTimeout(() => setRunStatus(''), 3000); return }
    if (endFrame.frame_index === currentFrame.frame_index) {
      setRunStatus(t('La frame de fin doit être différente de la frame courante'))
      setTimeout(() => setRunStatus(''), 4000); return
    }
    // Frame de fin AVANT la frame courante = propagation inverse : SAM2 remonte
    // le temps depuis la référence. Le backend déduit le sens de la plage.
    const isReverse = endFrame.frame_index < currentFrame.frame_index
    const samuraiLabel = samuraiStatus?.loaded ? 'SAMURAI' : 'SAM2'
    setIsRunning(true); setTaskProgress(0)
    setRunStatus(`${t('Lancement')} ${samuraiLabel} video tracking${isReverse ? ` (${t('sens inverse')})` : ''}...`)
    try {
      const result = await trackingAPI.runSam2Tracking(projectId, {
        reference_frame_id: currentFrame.id,
        annotation_ids: annotationIds,
        end_frame_id: endFrame.id,
        output_mode: sam2OutputMode,
        ref_array_index: currentFrameIndex,
        end_array_index: sam2EndFrameIndex,
        tracking_mode: sam2TrackingMode,
      })
      onPropagationStarted(result.task_id,
        `${samuraiLabel} video tracking${isReverse ? ` (${t('inverse')})` : ''}`)
      setTaskId(result.task_id)
    } catch (e) {
      setIsRunning(false); setRunStatus(apiErrorDetail(e) ?? t('Erreur SAM2 tracking'))
      console.error('Erreur SAM2:', e); setTimeout(() => setRunStatus(''), 5000)
    }
  }

  // -------------------------------------------------------------------
  // Track management
  // -------------------------------------------------------------------
  const handleDeleteAllTracks = async () => {
    if (!window.confirm(t('Supprimer tous les tracks de ce projet ? Les annotations restent mais seront détachées.'))) return
    try {
      await trackingAPI.deleteAllTracks(projectId)
      onTracksUpdated()
    } catch (e) {
      console.error('Erreur suppression tous les tracks:', e)
    }
  }

  const handleDeleteTrack = async (trackId: number) => {
    const trk = tracks.find((tk) => tk.id === trackId)
    const uid = trk ? trk.track_uid : trackId
    if (!window.confirm(
      `${t('Supprimer le track')} #${uid} ?\n\n` +
      `⚠ ${t('Cette action supprime AUSSI toutes les annotations liées à ce track. Irréversible.')}`,
    )) return
    try {
      // delete_track supprime le track ET ses annotations ; onTracksUpdated
      // (AnnotationPage) recharge tracks + frames + frame courante.
      await trackingAPI.delete(trackId)
      onTracksUpdated()
    } catch (e) {
      console.error('Erreur suppression track:', e)
    }
  }

  // start_frame/end_frame sont des positions tableau — comparer directement avec currentFrameIndex
  return (
    <div className="flex flex-col h-full">
      {/* Frame de reference */}
      <div className="px-2 py-2 border-b border-slate-700 bg-slate-800/50">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-slate-300">{t('Frame courante')}</span>
          <span className="text-xs font-mono text-blue-400 bg-blue-900/30 px-2 py-0.5 rounded">
            #{currentFrameIndex}
          </span>
        </div>
        <p className="text-xs text-slate-500 mt-0.5">
          {annotations.length} {t('annotation')}{annotations.length !== 1 ? 's' : ''} {t('disponible')}{annotations.length !== 1 ? 's' : ''}
        </p>
      </div>

      {/* Onglets — scrollable horizontalement si l'espace manque */}
      <div className="flex border-b border-slate-700 flex-shrink-0 overflow-x-auto scrollbar-none">
        {(
          [
            { id: 'samurai', label: 'SAMURAI',  icon: <Layers size={10} />,      activeColor: 'text-teal-400 border-teal-400 bg-teal-900/10',     title: t('SAMURAI local si disponible, fallback SAM2') },
            { id: 'guided',  label: t('Detect.'),  icon: <Zap size={10} />,         activeColor: 'text-blue-400 border-blue-400 bg-blue-900/10',    title: t('GD/SAM3 + matching centroide') },
            { id: 'xfeat',   label: t('Homogr.'),  icon: <ArrowRight size={10} />,  activeColor: 'text-purple-400 border-purple-400 bg-purple-900/10', title: t('Propagation par homographie XFeat/SIFT') },
            { id: 'optflow', label: t('Flux opt.'), icon: <Wind size={10} />,        activeColor: 'text-green-400 border-green-400 bg-green-900/10',  title: t('Flux optique Lucas-Kanade') },
          ] as { id: PanelTab; label: string; icon: React.ReactNode; activeColor: string; title: string }[]
        ).map(({ id, label, icon, activeColor, title }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            data-tour={id === 'samurai' ? 'tab-samurai' : id === 'guided' ? 'tab-guided' : undefined}
            className={`flex-none flex items-center justify-center gap-1 px-2.5 py-1.5 text-xs transition-colors whitespace-nowrap border-b-2 ${
              tab === id
                ? `border-current ${activeColor}`
                : 'border-transparent text-slate-500 hover:text-slate-300'
            }`}
            title={title}
          >
            {icon}
            {label}
          </button>
        ))}
      </div>

      {/* ---- Onglet Detection + association ---- */}
      {tab === 'guided' && (
        <div className="flex-1 overflow-y-auto">
          <div className="p-2 space-y-3">
            <p className="text-xs text-slate-400 leading-relaxed">
              {t("Lance GD ou SAM3 sur les frames suivantes, puis associe chaque detection a la cible la plus proche.")}
              {' '}{t("Mode utile quand l'objet reste proche de sa position attendue.")}
            </p>

            {/* Selection des annotations cibles */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-slate-300">{t('Cibles a suivre')}</span>
                {annotations.length > 0 && (
                  <button
                    onClick={() =>
                      selectedAnnotationIds.size === annotations.length
                        ? setTrackingTargets([])
                        : setTrackingTargets(annotations.map((a) => a.id))
                    }
                    className="text-xs text-slate-500 hover:text-slate-300"
                  >
                    {selectedAnnotationIds.size === annotations.length ? t('Tout désel.') : t('Tout sél.')}
                  </button>
                )}
              </div>
              {annotations.length === 0 && !isRunning ? (
                <p className="text-xs text-amber-400 bg-amber-900/20 px-2 py-1.5 rounded border border-amber-700/30">
                  {t("Annotez d'abord la frame")} #{currentFrameIndex}.
                </p>
              ) : (
                <div className="space-y-0.5 max-h-28 overflow-y-auto">
                  {annotations.map((ann) => {
                    const cls = classes.find((c) => c.id === ann.class_id)
                    return (
                      <label
                        key={ann.id}
                        className="flex items-center gap-2 px-2 py-1 rounded hover:bg-slate-700/50 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={selectedAnnotationIds.has(ann.id)}
                          onChange={() => toggleAnnotation(ann.id)}
                          className="w-3 h-3 rounded border-slate-600 bg-slate-700 accent-blue-500 flex-shrink-0"
                        />
                        <span
                          className="w-2 h-2 rounded-full flex-shrink-0"
                          style={{ backgroundColor: cls?.color ?? '#888' }}
                        />
                        <TargetClassLabel cls={cls} classId={ann.class_id} />
                        <span className="text-xs text-slate-600 font-mono ml-auto flex-shrink-0">
                          #{ann.id}
                        </span>
                      </label>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Plage de frames */}
            <div>
              <span className="text-xs font-medium text-slate-300 block mb-1">{t('Plage de frames')}</span>
              <div className="flex items-center gap-2">
                <div className="flex flex-col gap-0.5 flex-1">
                  <span className="text-xs text-slate-500">{t('De')}</span>
                  <input
                    type="number"
                    min={toLocal(currentFrameIndex)}
                    max={seqFrameCount}
                    value={toLocal(startFrameIndex)}
                    onChange={(e) => setStartFrameIndex(fromLocal(parseInt(e.target.value) || toLocal(currentFrameIndex)))}
                    className="w-full bg-slate-700 border border-slate-600 text-white text-xs px-1.5 py-0.5 rounded outline-none"
                  />
                </div>
                <ArrowRight size={10} className="text-slate-600 mt-4 flex-shrink-0" />
                <div className="flex flex-col gap-0.5 flex-1">
                  <span className="text-xs text-slate-500">{t('A')}</span>
                  <input
                    type="number"
                    min={toLocal(startFrameIndex)}
                    max={seqFrameCount}
                    value={toLocal(endFrameIndex)}
                    onChange={(e) => setEndFrameIndex(fromLocal(parseInt(e.target.value) || seqFrameCount))}
                    className="w-full bg-slate-700 border border-slate-600 text-white text-xs px-1.5 py-0.5 rounded outline-none"
                  />
                </div>
                <span className="text-xs text-slate-600 mt-4 flex-shrink-0">/{seqFrameCount}</span>
              </div>
            </div>

            {/* Algorithme */}
            <div>
              <span className="text-xs font-medium text-slate-300 block mb-1">{t('Algorithme')}</span>
              <div className="flex gap-1">
                {(['grounding_dino', 'sam3'] as const).map((alg) => (
                  <button
                    key={alg}
                    onClick={() => setAlgorithm(alg)}
                    className={`flex-1 py-1 text-xs rounded transition-colors ${
                      algorithm === alg
                        ? 'bg-blue-600 text-white'
                        : 'bg-slate-700 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {alg === 'grounding_dino' ? 'GDINO' : 'SAM3.1'}
                  </button>
                ))}
              </div>
            </div>

            {/* Mode de sortie SAM3 (visible seulement quand algo = sam3) */}
            {algorithm === 'sam3' && (
              <div>
                <span className="text-xs font-medium text-slate-300 block mb-1">{t('Mode de sortie')}</span>
                <div className="flex gap-1">
                  {(['bbox', 'segmentation'] as const).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => setSam3OutputMode(mode)}
                      className={`flex-1 py-1 text-xs rounded transition-colors ${
                        sam3OutputMode === mode
                          ? 'bg-violet-600 text-white'
                          : 'bg-slate-700 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {mode === 'bbox' ? 'BBox' : t('Segmentation')}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Prompt texte : requis par les deux detecteurs guides par texte */}
            <div>
              <span className="text-xs font-medium text-slate-300 block mb-1">{t('Prompt de detection')}</span>
              <textarea
                value={textPrompt}
                onChange={(e) => setTextPrompt(e.target.value)}
                data-tour="guided-prompt"
                placeholder={t('ex: "voiture. personne. velo."')}
                rows={2}
                className="w-full bg-slate-700 border border-slate-600 text-white text-xs px-2 py-1 rounded outline-none resize-none placeholder-slate-500"
              />
              <p className="text-xs text-slate-600 mt-0.5">{t('Separez les classes par des points.')}</p>
            </div>

            {/* Parametres avances */}
            <button
              onClick={() => setShowAdvanced((v) => !v)}
              className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
            >
              {showAdvanced ? '▾' : '▸'} {t('Parametres avances')}
            </button>
            {showAdvanced && (
              <div className="space-y-1.5 pl-2 border-l border-slate-700">
                {[
                  { label: t('Seuil boite'), value: boxThreshold, set: setBoxThreshold, min: 0.05, max: 0.9, step: 0.05,
                    hint: t('Confiance minimale des détections. ↑ = moins de boîtes, plus fiables.') },
                  { label: t('Seuil texte'), value: textThreshold, set: setTextThreshold, min: 0.05, max: 0.9, step: 0.05,
                    hint: t('Correspondance prompt ↔ boîte (Grounding DINO). ↑ = plus strict sur le mot.') },
                  { label: t('Dist. centroide'), value: maxCentroidDist, set: setMaxCentroidDist, min: 0.01, max: 0.5, step: 0.01,
                    hint: t('Écart max cible ↔ détection pour les apparier, en fraction de l\'image (0 = même point, 1 ≈ un bord à l\'autre). 0.15 = 15 % de l\'image.') },
                  { label: t('Var. taille max'), value: sizeVarThreshold, set: setSizeVarThreshold, min: 0.1, max: 2.0, step: 0.1,
                    hint: t('Variation de SURFACE tolérée entre 2 frames avant de signaler une anomalie. 0.5 = ±50 %, 1.0 = ×2.') },
                ].filter((row) => !(algorithm === 'sam3' && row.set === setTextThreshold))  // SAM3 n'a pas de seuil texte
                  .map(({ label, value, set, min, max, step, hint }) => (
                  <div key={label} className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-500 w-28 flex-shrink-0">{label}</span>
                      <input
                        type="number" min={min} max={max} step={step}
                        value={value}
                        onChange={(e) => set(parseFloat(e.target.value))}
                        className="w-16 bg-slate-700 border border-slate-600 text-white text-xs px-1.5 py-0.5 rounded outline-none"
                      />
                      <span className="text-[10px] text-slate-600 flex-shrink-0">{min}–{max}</span>
                    </div>
                    <p className="text-[10px] text-slate-600 leading-snug">{hint}</p>
                  </div>
                ))}

                {/* Auto-stop */}
                <div className="pt-1 border-t border-slate-700/50">
                  <label className="flex items-center gap-2 cursor-pointer mb-1.5">
                    <input
                      type="checkbox"
                      checked={autoStopEnabled}
                      onChange={(e) => setAutoStopEnabled(e.target.checked)}
                      className="w-3 h-3 accent-orange-500"
                    />
                    <span className="text-xs text-slate-400">{t('Auto-stop si objets perdus')}</span>
                  </label>
                  {autoStopEnabled && (
                    <div className="space-y-1 pl-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-500 w-28 flex-shrink-0">{t('% perdu max')}</span>
                        <input
                          type="number" min={0.1} max={1.0} step={0.1}
                          value={autoStopLostRatio}
                          onChange={(e) => setAutoStopLostRatio(parseFloat(e.target.value))}
                          className="w-16 bg-slate-700 border border-slate-600 text-white text-xs px-1.5 py-0.5 rounded outline-none"
                        />
                        <span className="text-xs text-slate-600">{Math.round(autoStopLostRatio * 100)}%</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-500 w-28 flex-shrink-0">{t('Frames consec.')}</span>
                        <input
                          type="number" min={1} max={50} step={1}
                          value={autoStopConsecutiveFrames}
                          onChange={(e) => setAutoStopConsecutiveFrames(parseInt(e.target.value) || 5)}
                          className="w-16 bg-slate-700 border border-slate-600 text-white text-xs px-1.5 py-0.5 rounded outline-none"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Bouton propager */}
            <button
              onClick={() => void handleRunGuidedTracking()}
              data-tour="guided-run-btn"
              disabled={isRunning || currentFrameTargetCount === 0 || !textPrompt.trim()}
              className="w-full flex items-center justify-center gap-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-500 text-white text-xs py-1.5 rounded transition-colors"
            >
              <Play size={11} />
              {isRunning ? t('Propagation en cours...') : `${t('Detecter + associer')} (${currentFrameTargetCount} ${t('cible')}${currentFrameTargetCount !== 1 ? 's' : ''})`}
            </button>
          </div>
        </div>
      )}

      {/* ---- Onglet Homographie ---- */}
      {tab === 'xfeat' && (
        <div className="p-2 border-b border-slate-700 space-y-2">
          <p className="text-xs text-slate-400 leading-relaxed">
            {t('Propage les annotations de la frame')} #{currentFrameIndex} {t('vers les suivantes par matching de keypoints (XFeat GPU ou SIFT+RANSAC).')}
          </p>

          <div className="p-2 bg-slate-800/60 rounded border border-slate-700/50 space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-slate-500">{t('Annotations source')}</span>
              <span className="text-slate-200">{annotations.length}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-slate-500">{t('Frame source')}</span>
              <span className="text-blue-400">#{currentFrameIndex}</span>
            </div>
          </div>

          {/* Sélection des annotations à propager */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-slate-300">{t('Annotations à propager')}</span>
              {annotations.length > 0 && (
                <button
                  onClick={() =>
                    trackingTargetSet.size === annotations.length
                      ? setTrackingTargets([])
                      : setTrackingTargets(annotations.map((a) => a.id))
                  }
                  className="text-xs text-slate-500 hover:text-slate-300"
                >
                  {trackingTargetSet.size === annotations.length ? t('Tout désel.') : t('Tout sél.')}
                </button>
              )}
            </div>
            {annotations.length === 0 && !isRunning ? (
              <p className="text-xs text-amber-400 bg-amber-900/20 px-2 py-1.5 rounded border border-amber-700/30">
                {t("Annotez d'abord la frame")} #{currentFrameIndex}.
              </p>
            ) : (
              <div className="space-y-0.5 max-h-28 overflow-y-auto">
                {annotations.map((ann) => {
                  const cls = classes.find((c) => c.id === ann.class_id)
                  return (
                    <label
                      key={ann.id}
                      className="flex items-center gap-2 px-2 py-1 rounded hover:bg-slate-700/50 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={trackingTargetSet.has(ann.id)}
                        onChange={() => toggleTrackingTarget(ann.id)}
                        className="w-3 h-3 rounded border-slate-600 bg-slate-700 accent-purple-500 flex-shrink-0"
                      />
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: cls?.color ?? '#888' }} />
                      <TargetClassLabel cls={cls} classId={ann.class_id} />
                      <span className="text-xs text-slate-600 font-mono ml-auto flex-shrink-0">#{ann.id}</span>
                    </label>
                  )
                })}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400 flex-shrink-0">{t("Jusqu'a la frame")}</span>
            <input
              type="number"
              min={toLocal(currentFrameIndex + 1)}
              max={seqFrameCount}
              value={toLocal(xfeatEndFrameIndex)}
              onChange={(e) => setXfeatEndFrameIndex(fromLocal(parseInt(e.target.value) || seqFrameCount))}
              className="w-16 bg-slate-700 border border-slate-600 text-white text-xs px-1.5 py-0.5 rounded outline-none"
            />
            <span className="text-xs text-slate-600">/ {seqFrameCount}</span>
          </div>

          {/* Badge méthode active */}
          {homographyMethod && (
            <div className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium w-fit ${
              homographyMethod === 'xfeat'
                ? 'bg-purple-900/40 text-purple-300 border border-purple-700/40'
                : 'bg-slate-700/60 text-slate-300 border border-slate-600/40'
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${homographyMethod === 'xfeat' ? 'bg-purple-400' : 'bg-slate-400'}`} />
              {homographyMethod === 'xfeat' ? 'XFeat GPU' : 'SIFT CPU'}
            </div>
          )}

          {/* Paramètres RANSAC (communs) */}
          <div className="space-y-1">
            <span className="text-xs font-medium text-slate-400 block">RANSAC</span>
            {[
              { label: t('Inliers min.'), value: minInlierCount, set: (v: number) => setMinInlierCount(v), min: 5, max: 500, step: 5, hint: t('pts — augmenter si dérive') },
              { label: t('Ratio inliers'), value: minInlierRatio, set: (v: number) => setMinInlierRatio(v), min: 0.1, max: 0.95, step: 0.05, hint: t('0-1 — 0.5 = 50% min.') },
              { label: t('Seuil reproj.'), value: ransacThreshold, set: (v: number) => setRansacThreshold(v), min: 0.5, max: 10, step: 0.5, hint: t('px — + strict = moins de bruit') },
            ].map(({ label, value, set, min, max, step, hint }) => (
              <div key={label} className="flex items-center gap-2">
                <span className="text-xs text-slate-500 w-24 flex-shrink-0">{label}</span>
                <input
                  type="number" min={min} max={max} step={step}
                  value={value}
                  onChange={(e) => set(parseFloat(e.target.value) || min)}
                  className="w-16 bg-slate-700 border border-slate-600 text-white text-xs px-1.5 py-0.5 rounded outline-none"
                />
                <span className="text-xs text-slate-600 truncate">{hint}</span>
              </div>
            ))}
          </div>

          {/* Paramètres XFeat (masqués en mode SIFT) */}
          {homographyMethod === 'xfeat' && (
            <div className="space-y-1">
              <span className="text-xs font-medium text-purple-400 block">XFeat GPU</span>
              {[
                { label: t('Top-K pts'), value: xfeatTopK, set: (v: number) => setXfeatTopK(v), min: 512, max: 8192, step: 512, hint: t('keypoints/image') },
                { label: t('Min cossim'), value: xfeatMinCossim, set: (v: number) => setXfeatMinCossim(v), min: 0.5, max: 0.99, step: 0.02, hint: t('0.82 = strict') },
              ].map(({ label, value, set, min, max, step, hint }) => (
                <div key={label} className="flex items-center gap-2">
                  <span className="text-xs text-slate-500 w-24 flex-shrink-0">{label}</span>
                  <input
                    type="number" min={min} max={max} step={step}
                    value={value}
                    onChange={(e) => set(parseFloat(e.target.value) || min)}
                    className="w-16 bg-slate-700 border border-slate-600 text-white text-xs px-1.5 py-0.5 rounded outline-none"
                  />
                  <span className="text-xs text-slate-600 truncate">{hint}</span>
                </div>
              ))}
            </div>
          )}

          <button
            onClick={() => void handleRunXFeat()}
            disabled={isRunning || annotations.length === 0}
            className="w-full flex items-center justify-center gap-1.5 bg-purple-600 hover:bg-purple-500 disabled:bg-slate-700 disabled:text-slate-500 text-white text-xs py-1.5 rounded transition-colors"
          >
            <ArrowRight size={11} />
            {isRunning ? t('Propagation...') : t('Propager par homographie')}
          </button>
        </div>
      )}

      {/* ---- Onglet Flux Optique ---- */}
      {tab === 'optflow' && (
        <div className="flex-1 overflow-y-auto">
          <div className="p-2 space-y-3">
            <p className="text-xs text-slate-400 leading-relaxed">
              {t('Suivi par')} <span className="text-green-400 font-medium">{t('flux optique Lucas-Kanade')}</span> —
              {' '}{t('suit le mouvement réel de chaque objet (pas seulement la caméra).')}
              {' '}{t('Idéal pour objets en mouvement (véhicules, personnes).')}
            </p>

            {/* Sélection annotations */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-slate-300">{t('Cibles à suivre')}</span>
                {annotations.length > 0 && (
                  <button
                    onClick={() =>
                      trackingTargetSet.size === annotations.length
                        ? setTrackingTargets([])
                        : setTrackingTargets(annotations.map((a) => a.id))
                    }
                    className="text-xs text-slate-500 hover:text-slate-300"
                  >
                    {trackingTargetSet.size === annotations.length ? t('Tout désel.') : t('Tout sél.')}
                  </button>
                )}
              </div>
              {annotations.length === 0 && !isRunning ? (
                <p className="text-xs text-amber-400 bg-amber-900/20 px-2 py-1.5 rounded border border-amber-700/30">
                  {t("Annotez d'abord la frame")} #{currentFrameIndex}.
                </p>
              ) : (
                <div className="space-y-0.5 max-h-24 overflow-y-auto">
                  {annotations.map((ann) => {
                    const cls = classes.find((c) => c.id === ann.class_id)
                    return (
                      <label key={ann.id} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-slate-700/50 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={trackingTargetSet.has(ann.id)}
                          onChange={() => toggleTrackingTarget(ann.id)}
                          className="w-3 h-3 rounded border-slate-600 bg-slate-700 accent-green-500 flex-shrink-0"
                        />
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: cls?.color ?? '#888' }} />
                        <TargetClassLabel cls={cls} classId={ann.class_id} />
                        <span className="text-xs text-slate-600 font-mono ml-auto flex-shrink-0">#{ann.id}</span>
                      </label>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Frame de fin */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400 flex-shrink-0">{t("Jusqu'à la frame")}</span>
              <input
                type="number"
                min={toLocal(currentFrameIndex + 1)}
                max={seqFrameCount}
                value={toLocal(optflowEndFrameIndex)}
                onChange={(e) => setOptflowEndFrameIndex(fromLocal(parseInt(e.target.value) || seqFrameCount))}
                className="w-16 bg-slate-700 border border-slate-600 text-white text-xs px-1.5 py-0.5 rounded outline-none"
              />
              <span className="text-xs text-slate-600">/ {seqFrameCount}</span>
            </div>

            {/* Paramètres LK */}
            <div className="space-y-1">
              <span className="text-xs font-medium text-green-400 block">Lucas-Kanade</span>
              {[
                { label: t('Fenêtre (px)'), value: optflowWinSize, set: setOptflowWinSize, min: 5, max: 63, step: 2, hint: t('21 — plus grand = + robuste') },
                { label: t('Niveaux pyra.'), value: optflowMaxLevel, set: setOptflowMaxLevel, min: 1, max: 6, step: 1, hint: t('3 — + niveaux = gds dépl.') },
                { label: t('Pts min.'), value: optflowMinPts, set: setOptflowMinPts, min: 1, max: 25, step: 1, hint: t('4 — si < → bbox copiée') },
              ].map(({ label, value, set, min, max, step, hint }) => (
                <div key={label} className="flex items-center gap-2">
                  <span className="text-xs text-slate-500 w-24 flex-shrink-0">{label}</span>
                  <input
                    type="number" min={min} max={max} step={step}
                    value={value}
                    onChange={(e) => set(Math.max(min, parseInt(e.target.value) || min))}
                    className="w-16 bg-slate-700 border border-slate-600 text-white text-xs px-1.5 py-0.5 rounded outline-none"
                  />
                  <span className="text-xs text-slate-600 truncate">{hint}</span>
                </div>
              ))}
            </div>

            <div className="p-2 bg-green-900/10 rounded border border-green-800/30 text-xs text-green-300 leading-relaxed">
              {t('Suit 29 points par bbox (4 coins + grille 5×5) et estime une transformation affine partielle : translation, rotation et échelle, robuste aux outliers.')}
              {' '}{t('Ne compense')} <strong>{t('pas')}</strong> {t('la perspective — utiliser Homographie pour ça.')}
            </div>

            <button
              onClick={() => void handleRunOptflow()}
              disabled={isRunning || annotations.length === 0}
              className="w-full flex items-center justify-center gap-1.5 bg-green-700 hover:bg-green-600 disabled:bg-slate-700 disabled:text-slate-500 text-white text-xs py-1.5 rounded transition-colors"
            >
              <Wind size={11} />
              {isRunning ? t('Suivi en cours...') : t('Suivre par flux optique')}
            </button>
          </div>
        </div>
      )}

      {/* ---- Onglet SAMURAI (SAM2 video tracking) ---- */}
      {tab === 'samurai' && (
        <div className="flex-1 overflow-y-auto">
          <div className="p-2 space-y-3">
            <p className="text-xs text-slate-400 leading-relaxed">
              <span className="text-teal-400 font-medium">SAMURAI</span> (SAM2 video tracking) —
              {' '}{t('propage les masques de segmentation frame par frame via mémoire temporelle adaptative.')}
              {' '}{t('Robuste aux occlusions partielles et changements de pose.')}
            </p>

            {/* Badge statut SAMURAI/SAM2 */}
            {samuraiStatus !== null && (
              <div className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium w-fit ${
                samuraiStatus.loaded
                  ? 'bg-teal-900/40 text-teal-300 border border-teal-700/40'
                  : samuraiStatus.installed
                  ? 'bg-yellow-900/30 text-yellow-300 border border-yellow-700/40'
                  : 'bg-slate-700/60 text-slate-300 border border-slate-600/40'
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${
                  samuraiStatus.loaded ? 'bg-teal-400' : samuraiStatus.installed ? 'bg-yellow-400' : 'bg-slate-400'
                }`} />
                {samuraiStatus.loaded ? t('SAMURAI actif (Kalman)') : samuraiStatus.installed ? t('SAMURAI installé, SAM2 en cours') : t('SAM2 standard (SAMURAI absent)')}
              </div>
            )}
            {samuraiStatus === null || (!samuraiStatus.installed) ? (
              <p className="text-xs text-slate-600">
                {t('Installer SAMURAI : exécuter')} <code className="text-teal-500">install_samurai.bat</code>
              </p>
            ) : null}

            {/* Sélection annotations */}
            <div data-tour="samurai-targets">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-slate-300">{t('Cibles à suivre')}</span>
                {annotations.length > 0 && (
                  <button
                    onClick={() => trackingTargetSet.size === annotations.length
                      ? setTrackingTargets([])
                      : setTrackingTargets(annotations.map((a) => a.id))}
                    className="text-xs text-slate-500 hover:text-slate-300"
                  >{trackingTargetSet.size === annotations.length ? t('Tout désel.') : t('Tout sél.')}</button>
                )}
              </div>
              {annotations.length > 1 && (
                <p className="text-[10px] text-slate-500 mb-1 leading-snug">
                  {t('Double-clic sur une boîte du canvas = cocher/décocher cette cible (anneau pointillé autour de l\'objet).')}
                </p>
              )}
              {annotations.length === 0 && !isRunning ? (
                <p className="text-xs text-amber-400 bg-amber-900/20 px-2 py-1.5 rounded border border-amber-700/30">
                  {t("Annotez d'abord la frame")} #{currentFrameIndex}.
                </p>
              ) : (
                <div className="space-y-0.5 max-h-24 overflow-y-auto">
                  {annotations.map((ann) => {
                    const cls = classes.find((c) => c.id === ann.class_id)
                    return (
                      <label key={ann.id} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-slate-700/50 cursor-pointer">
                        <input type="checkbox" checked={trackingTargetSet.has(ann.id)}
                          onChange={() => toggleTrackingTarget(ann.id)}
                          className="w-3 h-3 rounded border-slate-600 bg-slate-700 accent-teal-500 flex-shrink-0" />
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: cls?.color ?? '#888' }} />
                        <TargetClassLabel cls={cls} classId={ann.class_id} />
                        <span className="text-xs text-slate-600 font-mono ml-auto flex-shrink-0">#{ann.id}</span>
                      </label>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Frame de fin — peut être AVANT la frame courante : SAM2 propage
                alors à rebours (utile quand l'objet est déjà entré en scène). */}
            <div className="flex items-center gap-2" data-tour="samurai-end-frame">
              <span className="text-xs text-slate-400 flex-shrink-0">{t("Jusqu'à la frame")}</span>
              <input type="number" min={1} max={seqFrameCount}
                value={toLocal(sam2EndFrameIndex)}
                onChange={(e) => setSam2EndFrameIndex(fromLocal(parseInt(e.target.value) || seqFrameCount))}
                className="w-16 bg-slate-700 border border-slate-600 text-white text-xs px-1.5 py-0.5 rounded outline-none" />
              <span className="text-xs text-slate-600">/ {seqFrameCount}</span>
              {sam2EndFrameIndex < currentFrameIndex && (
                <span className="text-[10px] text-amber-400 flex items-center gap-1 flex-shrink-0"
                      title={t('La frame de fin est avant la frame courante : la propagation remonte le temps')}>
                  <ArrowLeft size={10} /> {t('sens inverse')}
                </span>
              )}
            </div>

            {/* Jauge « frames max estimées » — capacité VRAM en mode GPU rapide */}
            {samuraiStatus?.gpu && (() => {
              const g = samuraiStatus.gpu!
              // offload OFF (défaut) = mode GPU rapide → la limite VRAM s'applique
              const offloadCpu = algo?.sam2_offload_video_to_cpu ?? false
              if (!g.cuda) {
                return (
                  <div className="text-xs text-slate-500 bg-slate-800/60 rounded px-2 py-1.5 border border-slate-700/50">
                    {t('GPU non détecté (exécution CPU) — pas de limite VRAM, mais tracking très lent.')}
                  </div>
                )
              }
              const framesToTrack = Math.max(1, sam2EndFrameIndex - currentFrameIndex + 1)
              const estMax = g.est_max_frames_gpu ?? 0
              if (offloadCpu) {
                return (
                  <div className="text-xs bg-slate-800/60 rounded px-2 py-1.5 border border-slate-700/50 space-y-0.5">
                    <div className="flex justify-between text-slate-400">
                      <span className="font-medium">{t('Offload CPU actif')}</span>
                      <span className="text-slate-500">{g.name} · {g.vram_free_gb}/{g.vram_total_gb} Go</span>
                    </div>
                    <p className="text-slate-600 leading-snug">
                      {t('Frames en RAM → aucune limite VRAM, mais ~1.5–3× plus lent. Coche « Mode GPU rapide » dans les paramètres pour repasser sur le GPU.')}
                    </p>
                  </div>
                )
              }
              const ratio = estMax > 0 ? framesToTrack / estMax : 2
              const over = ratio > 1
              const pct = Math.min(100, Math.round(ratio * 100))
              return (
                <div className="text-xs bg-slate-800/60 rounded px-2 py-1.5 border border-slate-700/50 space-y-1"
                     data-tour="samurai-gpu-gauge">
                  <div className="flex justify-between items-center">
                    <span className="font-medium text-slate-300">{t('Frames max estimées (GPU rapide)')}</span>
                    <span className={over ? 'text-red-400 font-semibold' : 'text-teal-300 font-semibold'}>
                      {framesToTrack} / ~{estMax}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-slate-700 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${over ? 'bg-red-500' : 'bg-teal-500'}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-slate-500">
                    <span>{g.name}</span>
                    <span>{g.vram_free_gb}/{g.vram_total_gb} Go libre · {g.image_size}²</span>
                  </div>
                  {over && (
                    <p className="text-red-400/90 leading-snug">
                      {t("Plage > capacité VRAM → risque d'OOM. Réduis la plage, décime à l'import, ou décoche « Mode GPU rapide » dans les paramètres.")}
                    </p>
                  )}
                </div>
              )
            })()}

            {/* Mode de sortie */}
            <div data-tour="samurai-output-mode">
              <span className="text-xs font-medium text-slate-300 block mb-1">{t('Mode de sortie')}</span>
              <div className="flex gap-1">
                {(['bbox', 'segmentation'] as const).map((m) => (
                  <button key={m} onClick={() => setSam2OutputMode(m)}
                    data-tour={`samurai-output-${m}`}
                    className={`flex-1 py-1 text-xs rounded transition-colors ${
                      sam2OutputMode === m ? 'bg-teal-700/70 text-white' : 'bg-slate-700 text-slate-400 hover:text-slate-200'
                    }`}>{m === 'bbox' ? 'BBox' : t('Segmentation')}</button>
                ))}
              </div>
            </div>

            {/* Mode multi-cible : SAM2 multi-objets (1 passe) vs SAMURAI par objet (N passes) */}
            <div data-tour="samurai-strategy">
              <span className="text-xs font-medium text-slate-300 block mb-1">{t('Stratégie multi-cible')}</span>
              <div className="flex gap-1">
                <button onClick={() => setSam2TrackingMode('auto')}
                  data-tour="samurai-strategy-auto"
                  className={`flex-1 py-1 text-xs rounded transition-colors ${
                    sam2TrackingMode === 'auto' ? 'bg-teal-700/70 text-white' : 'bg-slate-700 text-slate-400 hover:text-slate-200'
                  }`}>{t('Auto (rapide)')}</button>
                <button onClick={() => setSam2TrackingMode('samurai_per_object')}
                  disabled={!samuraiStatus?.loaded}
                  title={samuraiStatus?.loaded ? '' : t('Nécessite SAMURAI chargé')}
                  className={`flex-1 py-1 text-xs rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                    sam2TrackingMode === 'samurai_per_object' ? 'bg-teal-700/70 text-white' : 'bg-slate-700 text-slate-400 hover:text-slate-200'
                  }`}>{t('SAMURAI / objet')}</button>
              </div>
            </div>

            <div className="p-2 bg-teal-900/10 rounded border border-teal-800/30 text-xs text-teal-300 leading-relaxed space-y-1">
              <p>
                <strong>SAMURAI</strong> {t("(filtre de Kalman) ne suit qu'")}<strong>{t('une')}</strong> {t('cible :')}
                {' '}{t('son état de mouvement est unique. Pour')} <strong>{t('plusieurs')}</strong> {t('cibles :')}
              </p>
              <p>
                • <strong>{t('Auto')}</strong> = <strong>{t('SAM2 multi-objets')}</strong> {t('natif — 1 seule passe, rapide, mais sans Kalman.')}
              </p>
              <p>
                • <strong>{t('SAMURAI / objet')}</strong> = {t('1 passe SAMURAI (Kalman) par cible — meilleur suivi MOT (occlusions, objets similaires), mais ~N× plus lent.')}
              </p>
              <p className="text-teal-400/70">
                {t('Prompt = box de référence. Nécessite')} <strong>sam2.1_hiera_small.pt</strong> ({t('présent')}).
                {' '}{t('Officiel')} : <em>yangchris11/samurai</em>.
              </p>
            </div>

            <button onClick={() => void handleRunSam2Tracking()}
              disabled={isRunning || annotations.length === 0}
              data-tour="propagate-btn"
              className="w-full flex items-center justify-center gap-1.5 bg-teal-700 hover:bg-teal-600 disabled:bg-slate-700 disabled:text-slate-500 text-white text-xs py-1.5 rounded transition-colors">
              <Layers size={11} />
              {isRunning
                ? `${t('Propagation')} ${samuraiStatus?.loaded ? 'SAMURAI' : 'SAM2'} ${t('en cours...')}`
                : `${t('Propager par')} ${samuraiStatus?.loaded ? 'SAMURAI' : 'SAM2'}`}
            </button>
          </div>
        </div>
      )}

      {/* Statut d'execution + barre de progression */}
      {(isRunning || runStatus) && (
        <div className="px-2 py-2 border-t border-b border-slate-700 bg-slate-800/50 flex-shrink-0 space-y-1.5">
          {isRunning && (
            <div className="space-y-1">
              {/* Barre de progression */}
              <div className="w-full bg-slate-700 rounded-full h-2 overflow-hidden">
                <div
                  className={`h-2 rounded-full transition-all duration-300 ${isPaused ? 'bg-amber-500' : 'bg-blue-500'}`}
                  style={{ width: `${taskProgress}%` }}
                />
              </div>
              {/* Pourcentage + message + boutons pause/stop */}
              <div className="flex items-center gap-1">
                <span className="text-xs font-mono flex-shrink-0 w-8 text-right">
                  <span className={isPaused ? 'text-amber-400' : 'text-blue-400'}>{taskProgress}%</span>
                </span>
                <span className="text-xs text-slate-400 truncate flex-1 ml-1">{runStatus}</span>
                {/* Boutons Pause + Stop */}
                {taskId && (
                  <div className="flex gap-1 flex-shrink-0">
                    {/* Pause/Reprendre : disponible sur la detection sequentielle pausable cote backend */}
                    {isGuidedTask && (
                      <button
                        onClick={() => {
                          if (isPaused) {
                            void taskAPI.resume(taskId).then(() => setIsPaused(false))
                          } else {
                            void taskAPI.pause(taskId).then(() => setIsPaused(true))
                          }
                        }}
                        title={isPaused ? t('Reprendre') : t('Pause')}
                        className="p-1 rounded bg-amber-700/50 hover:bg-amber-600/60 text-amber-300 transition-colors"
                      >
                        {isPaused ? <Play size={11} /> : <Pause size={11} />}
                      </button>
                    )}
                    {/* Stop — toujours disponible quel que soit le mode */}
                    <button
                      onClick={() => {
                        void taskAPI.stop(taskId).then(() => {
                          setIsPaused(false)
                          setRunStatus(t('Arrêt en cours...'))
                        })
                      }}
                      title={t('Arrêter')}
                      className="p-1 rounded bg-red-800/50 hover:bg-red-700/60 text-red-400 transition-colors"
                    >
                      <Square size={11} />
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
          {!isRunning && runStatus && (
            <p className="text-xs text-center text-slate-400">{runStatus}</p>
          )}
        </div>
      )}

      {/* En-tête du panneau bas : bascule Logs / Tracks */}
      <div className="px-2 py-1 border-t border-slate-700 flex-shrink-0 flex items-center justify-between gap-1">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setBottomView('logs')}
            className={`text-xs px-1.5 py-0.5 rounded flex items-center gap-1 transition-colors ${
              bottomView === 'logs' ? 'bg-slate-700 text-slate-200' : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${isRunning ? 'bg-green-400 animate-pulse' : 'bg-slate-600'}`} />
            Logs
          </button>
          <button
            onClick={() => setBottomView('tracks')}
            className={`text-xs px-1.5 py-0.5 rounded transition-colors ${
              bottomView === 'tracks' ? 'bg-slate-700 text-slate-200' : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            Tracks ({tracks.length})
          </button>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {bottomView === 'logs' && algoLogs.length > 0 && (
            <button
              onClick={() => { setAlgoLogs([]); logSinceRef.current = 0 }}
              className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
            >
              {t('Effacer')}
            </button>
          )}
          {bottomView === 'tracks' && tracks.length > 0 && (
            <button
              onClick={() => void handleDeleteAllTracks()}
              title={t('Supprimer tous les tracks (annotations conservées)')}
              className="flex items-center gap-0.5 text-xs text-red-400/70 hover:text-red-400 transition-colors"
            >
              <Trash2 size={10} />
              {t('Tout suppr.')}
            </button>
          )}
        </div>
      </div>

      {/* Vue Logs : console temps réel (mêmes lignes que le terminal serveur) */}
      {bottomView === 'logs' && (
        <div
          className="flex-1 overflow-y-auto min-h-0 border-t border-slate-700 bg-slate-950 font-mono"
          style={{ maxHeight: '220px' }}
        >
          {algoLogs.length === 0 ? (
            <div className="text-xs text-slate-600 text-center py-6 px-4 font-sans">
              {t("Aucun log. Lancez SAMURAI, Detect, Homogr. ou Flux opt. — la commande et l'avancement de l'algo s'afficheront ici en temps réel.")}
            </div>
          ) : (
            <div className="px-2 py-1.5 space-y-0.5">
              {algoLogs.map((line, i) => {
                const isCmd = line.includes('$ ')
                const isErr = line.toLowerCase().includes('erreur') || line.toLowerCase().includes('error')
                return (
                  <div
                    key={i}
                    className={`text-[10.5px] leading-snug whitespace-pre-wrap break-words ${
                      isErr ? 'text-red-400' : isCmd ? 'text-emerald-300' : 'text-slate-400'
                    }`}
                  >
                    {line}
                  </div>
                )
              })}
              <div ref={logEndRef} />
            </div>
          )}
        </div>
      )}

      {/* Vue Tracks : liste compacte avec #uid en tête, clic = début, ×2 = fin */}
      {bottomView === 'tracks' && (
        <div
          className="flex-1 overflow-y-auto min-h-0 border-t border-slate-700"
          style={{ maxHeight: '220px' }}
        >
          {tracks.length === 0 ? (
            <div className="text-xs text-slate-600 text-center py-6 px-4">
              {t('Aucune track. Assignez une track à une annotation (onglet Annots) ou lancez un suivi.')}
            </div>
          ) : (
            tracks.map((track) => {
              const isActive = track.start_frame <= currentFrameIndex && track.end_frame >= currentFrameIndex
              const duration = track.end_frame - track.start_frame + 1
              return (
                <div
                  key={track.id}
                  className={`flex items-center gap-2 px-2 py-1 border-b border-slate-800 group cursor-pointer ${isActive ? 'bg-slate-800/50' : 'hover:bg-slate-700/40'}`}
                  title={`Track #${track.track_uid} — ${t('clic = début (frame')} ${track.start_frame}${t('), double-clic = fin (frame')} ${track.end_frame})`}
                  onClick={() => onFrameNavigate(track.start_frame)}
                  onDoubleClick={() => onFrameNavigate(track.end_frame)}
                >
                  <span className="w-2.5 h-6 rounded-sm flex-shrink-0" style={{ backgroundColor: track.color }} />
                  <span className="text-xs font-bold font-mono flex-shrink-0" style={{ color: track.color }}>
                    #{track.track_uid}
                  </span>
                  <span className="text-xs text-slate-300 truncate flex-1">{getClassName(track.class_id)}</span>
                  {isActive && <span className="w-1.5 h-1.5 rounded-full bg-green-400 flex-shrink-0" />}
                  <span className="text-xs text-slate-600 font-mono flex-shrink-0">
                    [{track.start_frame}–{track.end_frame}] · {duration}f
                  </span>
                  <button
                    onClick={(e) => { e.stopPropagation(); void handleDeleteTrack(track.id) }}
                    className="p-0.5 opacity-0 group-hover:opacity-100 hover:text-red-400 text-slate-500 transition-all flex-shrink-0"
                    title={t('Supprimer cette track')}
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
