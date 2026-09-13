// ============================================================
// stores/uiStore.ts
// Store Zustand pour l'état de l'interface utilisateur.
// Gère : zoom canvas, onglet sidebar, modals, mode review.
// ============================================================

import { create } from 'zustand'
import type { Point, TimelineFilter } from '../types/api'

type SidebarTab = 'classes' | 'annotations' | 'tracks' | 'debug' | 'settings' | 'help' | 'anomalies'
type ModalType = 'create_project' | 'import' | 'export' | 'shortcuts' | 'interpolate' | null

interface UIStore {
  // ---- Layout ----
  sidebarTab: SidebarTab
  isSidebarOpen: boolean
  isTimelineVisible: boolean

  // ---- Canvas ----
  canvasZoom: number
  canvasOffset: Point

  // ---- Modals ----
  activeModal: ModalType

  // ---- Mode review rapide ----
  isReviewMode: boolean
  reviewFilter: TimelineFilter

  // ---- LUT d'affichage (remap 16/8 bits) ----
  isLutOpen: boolean
  lutSignature: string          // cache-buster de l'URL image (change quand la LUT change)
  toggleLut: () => void
  setLutSignature: (sig: string) => void

  // ---- Actions ----
  setSidebarTab: (tab: SidebarTab) => void
  toggleSidebar: () => void
  toggleTimeline: () => void
  setCanvasZoom: (zoom: number) => void
  adjustZoom: (delta: number) => void
  resetZoom: () => void
  setCanvasOffset: (offset: Point) => void
  // Zoom vers une annotation (cx/cy/w/h normalisés, dimensions image)
  zoomToAnnotation: (cx: number, cy: number, w: number, h: number, imgW: number, imgH: number, containerW: number, containerH: number) => void
  openModal: (modal: NonNullable<ModalType>) => void
  closeModal: () => void
  toggleReviewMode: () => void
  setReviewFilter: (filter: TimelineFilter) => void
}

const MIN_ZOOM = 0.1
const MAX_ZOOM = 10.0

export const useUIStore = create<UIStore>((set, get) => ({
  // ---- État initial ----
  sidebarTab: 'classes',
  isSidebarOpen: true,
  isTimelineVisible: true,
  canvasZoom: 1.0,
  canvasOffset: { x: 0, y: 0 },
  activeModal: null,
  isReviewMode: false,
  reviewFilter: 'all',
  isLutOpen: false,
  lutSignature: 'sig3',

  toggleLut: () => set((state) => ({ isLutOpen: !state.isLutOpen })),
  setLutSignature: (sig) => set({ lutSignature: sig }),

  // ---- Actions ----

  setSidebarTab: (tab) => set({ sidebarTab: tab }),

  toggleSidebar: () => set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),

  toggleTimeline: () => set((state) => ({ isTimelineVisible: !state.isTimelineVisible })),

  setCanvasZoom: (zoom) => {
    set({ canvasZoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom)) })
  },

  adjustZoom: (delta) => {
    const { canvasZoom } = get()
    const newZoom = canvasZoom + delta
    set({ canvasZoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newZoom)) })
  },

  resetZoom: () => set({ canvasZoom: 1.0, canvasOffset: { x: 0, y: 0 } }),

  setCanvasOffset: (offset) => set({ canvasOffset: offset }),

  zoomToAnnotation: (cx, cy, w, h, imgW, imgH, containerW, containerH) => {
    // Calcule un zoom pour que l'annotation occupe ~60% du canvas, puis centre dessus
    const scaleToFit = Math.min(containerW / imgW, containerH / imgH, 1)
    const targetZoom = Math.min(MAX_ZOOM, Math.max(1.5, 0.6 / Math.max(w, h)))
    const displayW = imgW * scaleToFit * targetZoom
    const displayH = imgH * scaleToFit * targetZoom
    // Offset pour centrer l'annotation
    const offsetX = containerW / 2 - cx * displayW
    const offsetY = containerH / 2 - cy * displayH
    set({ canvasZoom: targetZoom, canvasOffset: { x: offsetX, y: offsetY } })
  },

  openModal: (modal) => set({ activeModal: modal }),

  closeModal: () => set({ activeModal: null }),

  toggleReviewMode: () => set((state) => ({ isReviewMode: !state.isReviewMode })),

  setReviewFilter: (filter) => set({ reviewFilter: filter }),
}))
