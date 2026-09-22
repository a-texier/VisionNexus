// ============================================================
// stores/samStore.ts
// Store Zustand pour les interactions avec SAM2.
// Gère les sessions WebSocket, les masques streamés, et les points de prompt.
// ============================================================

import { create } from 'zustand'
import { samImageWS, samVideoWS, WS_URLS } from '../services/websocket'
import type { SAMMask, SAMParams, SAMPoint } from '../types/api'

type SAMStatus = 'idle' | 'connecting' | 'ready' | 'processing' | 'error'

interface SAMStore {
  // ---- État ----
  imageStatus: SAMStatus
  videoStatus: SAMStatus
  streamedMasks: SAMMask[]     // Masques reçus en streaming (SAM image auto)
  pendingPoints: SAMPoint[]    // Points de prompt en attente d'envoi
  videoSessionId: string | null
  isModelLoaded: boolean
  modelInfo: { device: string; model: string; gpu_memory_gb: number | null } | null

  // ---- Actions : Connexions WebSocket ----
  connectImageWS: () => Promise<void>
  connectVideoWS: () => Promise<void>
  disconnectAll: () => void

  // ---- Actions : SAM Image ----
  startAutoSegment: (frameId: number, params?: SAMParams) => void
  clearStreamedMasks: () => void
  removeMask: (index: number) => void

  // ---- Actions : Points de prompt ----
  addPoint: (point: SAMPoint) => void
  removeLastPoint: () => void
  clearPoints: () => void

  // ---- Actions : SAM Vidéo ----
  initVideoSession: (framesDir: string, frameCount: number) => Promise<void>
  addVideoPrompt: (params: {
    frameIndex: number
    objectId: number
    points: SAMPoint[]
    imageWidth: number
    imageHeight: number
  }) => void
  propagateVideo: (imageWidth: number, imageHeight: number) => void
  closeVideoSession: () => void

  // ---- Callbacks de résultats (abonnés par les composants) ----
  onMaskResult: ((mask: SAMMask) => void) | null
  onPropagationFrame: ((frameIndex: number, progress: number, objects: Record<string, Pick<SAMMask, 'bbox_yolo' | 'polygon' | 'score'>>) => void) | null
  setOnMaskResult: (cb: ((mask: SAMMask) => void) | null) => void
  setOnPropagationFrame: (cb: ((frameIndex: number, progress: number, objects: Record<string, Pick<SAMMask, 'bbox_yolo' | 'polygon' | 'score'>>) => void) | null) => void
}

export const useSAMStore = create<SAMStore>((set, get) => ({
  // ---- État initial ----
  imageStatus: 'idle',
  videoStatus: 'idle',
  streamedMasks: [],
  pendingPoints: [],
  videoSessionId: null,
  isModelLoaded: false,
  modelInfo: null,
  onMaskResult: null,
  onPropagationFrame: null,

  // ---- WebSocket Image ----

  connectImageWS: async () => {
    set({ imageStatus: 'connecting' })
    try {
      await samImageWS.connect(WS_URLS.SAM_IMAGE)
      set({ imageStatus: 'ready' })

      // Abonnement aux événements WebSocket
      samImageWS.on('mask_result', (msg) => {
        const mask: SAMMask = { ...msg.mask, index: msg.index }
        set((state) => ({
          streamedMasks: [...state.streamedMasks, mask],
        }))
        get().onMaskResult?.(mask)
      })

      samImageWS.on('complete', () => {
        set({ imageStatus: 'ready' })
      })

      samImageWS.on('error', (msg) => {
        console.error('[SAMStore] Erreur WebSocket image :', msg.message)
        set({ imageStatus: 'error' })
      })
    } catch (e) {
      set({ imageStatus: 'error' })
    }
  },

  connectVideoWS: async () => {
    set({ videoStatus: 'connecting' })
    try {
      await samVideoWS.connect(WS_URLS.SAM_VIDEO)
      set({ videoStatus: 'ready' })

      // Abonnements
      samVideoWS.on('propagation_frame', (msg) => {
        get().onPropagationFrame?.(msg.frame_index, msg.progress, msg.objects)
      })

      samVideoWS.on('propagation_complete', () => {
        set({ videoStatus: 'ready' })
      })

      samVideoWS.on('error', (msg) => {
        console.error('[SAMStore] Erreur WebSocket vidéo :', msg.message)
        set({ videoStatus: 'error' })
      })
    } catch (e) {
      set({ videoStatus: 'error' })
    }
  },

  disconnectAll: () => {
    samImageWS.disconnect()
    samVideoWS.disconnect()
    set({ imageStatus: 'idle', videoStatus: 'idle' })
  },

  // ---- SAM Image ----

  startAutoSegment: (frameId, params = {}) => {
    if (!samImageWS.isConnected) {
      console.warn('[SAMStore] WebSocket image non connecté')
      return
    }

    set({ streamedMasks: [], imageStatus: 'processing' })

    samImageWS.send({
      type: 'start_auto_segment',
      frame_id: frameId,
      params: {
        points_per_side: params.points_per_side ?? 32,
        pred_iou_thresh: params.pred_iou_thresh ?? 0.88,
        stability_score_thresh: params.stability_score_thresh ?? 0.95,
        min_mask_area: params.min_mask_area ?? 100,
        box_nms_thresh: params.box_nms_thresh ?? 0.7,
      },
    })
  },

  clearStreamedMasks: () => {
    set({ streamedMasks: [] })
  },

  removeMask: (index) => {
    set((state) => ({
      streamedMasks: state.streamedMasks.filter((_, i) => i !== index),
    }))
  },

  // ---- Points de prompt ----

  addPoint: (point) => {
    set((state) => ({ pendingPoints: [...state.pendingPoints, point] }))
  },

  removeLastPoint: () => {
    set((state) => ({ pendingPoints: state.pendingPoints.slice(0, -1) }))
  },

  clearPoints: () => {
    set({ pendingPoints: [] })
  },

  // ---- SAM Vidéo ----

  initVideoSession: async (framesDir, frameCount) => {
    if (!samVideoWS.isConnected) {
      await get().connectVideoWS()
    }

    set({ videoStatus: 'processing' })

    return new Promise<void>((resolve) => {
      const unsubscribe = samVideoWS.on('session_ready', (msg) => {
        set({ videoSessionId: msg.session_id, videoStatus: 'ready' })
        unsubscribe()
        resolve()
      })

      samVideoWS.send({
        type: 'init_session',
        frames_dir: framesDir,
        frame_count: frameCount,
      })
    })
  },

  addVideoPrompt: (params) => {
    const { videoSessionId } = get()
    if (!videoSessionId) return

    samVideoWS.send({
      type: 'add_prompt',
      session_id: videoSessionId,
      frame_index: params.frameIndex,
      object_id: params.objectId,
      points: params.points.map((p) => [p.x, p.y]),
      labels: params.points.map((p) => p.label),
      image_width: params.imageWidth,
      image_height: params.imageHeight,
    })
  },

  propagateVideo: (imageWidth, imageHeight) => {
    const { videoSessionId } = get()
    if (!videoSessionId) return

    set({ videoStatus: 'processing' })

    samVideoWS.send({
      type: 'propagate',
      session_id: videoSessionId,
      image_width: imageWidth,
      image_height: imageHeight,
    })
  },

  closeVideoSession: () => {
    const { videoSessionId } = get()
    if (videoSessionId) {
      samVideoWS.send({ type: 'close_session', session_id: videoSessionId })
    }
    set({ videoSessionId: null, videoStatus: 'idle' })
  },

  // ---- Callbacks ----
  setOnMaskResult: (cb) => set({ onMaskResult: cb }),
  setOnPropagationFrame: (cb) => set({ onPropagationFrame: cb }),
}))
