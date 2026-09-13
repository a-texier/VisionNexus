// ============================================================
// stores/annotationStore.ts
// Store Zustand central pour la gestion des annotations.
// Gère : annotations courantes, undo/redo, clipboard, dessin en cours.
// Auto-save : debounce 2s sur les mutations → API bulk save.
// ============================================================

import { create } from 'zustand'
import { annotationsAPI } from '../services/api'
import { useBulkUndoStore } from './bulkUndoStore'
import { useProjectStore } from './projectStore'
import type {
  Annotation,
  AnnotationCreate,
  AnnotationSnapshot,
  AnnotationUpdate,
  DrawingState,
  Point,
  ToolType,
} from '../types/api'

const MAX_UNDO_HISTORY = 50  // Nombre maximum d'entrées dans la pile undo

interface AnnotationStore {
  // ---- État ----
  currentFrameId: number | null
  annotations: Annotation[]
  selectedAnnotationIds: Set<number>
  activeTool: ToolType
  activeClassId: number | null
  drawingState: DrawingState | null
  clipboard: Annotation[] | null

  // Undo/Redo
  undoStack: AnnotationSnapshot[]
  redoStack: AnnotationSnapshot[]

  // Chargement
  isLoading: boolean
  isDirty: boolean

  // Compteur incrémenté quand une suppression peut avoir vidé une piste (undo,
  // deleteSelected, bulk-replace) → AnnotationPage recharge alors la liste des tracks.
  tracksDirty: number
  bumpTracksDirty: () => void

  // ---- Actions : Chargement ----
  loadAnnotations: (frameId: number, annotations: Annotation[]) => void
  clearAnnotations: () => void

  // ---- Actions : CRUD ----
  addAnnotation: (ann: AnnotationCreate) => Promise<Annotation | null>
  /** Création en lot (1 API call) — beaucoup plus rapide que N×addAnnotation.
   *  Met à jour le store si la frame est courante. Retourne la liste fraîche. */
  bulkAddAnnotations: (frameId: number, anns: AnnotationCreate[]) => Promise<Annotation[]>
  updateAnnotation: (id: number, update: AnnotationUpdate) => Promise<void>
  deleteAnnotation: (id: number) => Promise<void>
  deleteSelected: () => Promise<void>
  deleteAllAnnotations: () => Promise<void>
  bulkSetAnnotations: (annotations: AnnotationCreate[], replace?: boolean) => Promise<void>

  // ---- Actions : Sélection ----
  selectAnnotation: (id: number, multiSelect?: boolean) => void
  selectAnnotations: (ids: number[]) => void   // Sélection par plage (shift+clic explorateur)
  deselectAll: () => void
  selectAll: () => void

  // ---- Actions : Undo/Redo ----
  pushUndoSnapshot: (action: string) => void
  undo: () => Promise<void>
  redo: () => Promise<void>

  // ---- Actions : Clipboard ----
  copySelected: () => void
  pasteToFrame: (targetFrameId: number) => Promise<void>

  // ---- Actions : Dessin ----
  setActiveTool: (tool: ToolType) => void
  setActiveClassId: (classId: number | null) => void
  startDrawing: (tool: ToolType, startPoint: Point) => void
  updateDrawing: (point: Point) => void
  addPolygonPoint: (point: Point) => void
  finishDrawing: () => void
  cancelDrawing: () => void

  // ---- Actions : Label rapide ----
  relabelSelected: (classId: number) => Promise<void>

  // ---- Tracking : cibles guidées ----
  trackingTargetIds: Set<number>       // Annotations sélectionnées comme cibles de tracking
  toggleTrackingTarget: (id: number) => void
  setTrackingTargets: (ids: number[]) => void
  clearTrackingTargets: () => void
}

export const useAnnotationStore = create<AnnotationStore>((set, get) => ({
  // ---- État initial ----
  currentFrameId: null,
  annotations: [],
  selectedAnnotationIds: new Set(),
  activeTool: 'select',
  activeClassId: null,
  drawingState: null,
  clipboard: null,
  undoStack: [],
  redoStack: [],
  isLoading: false,
  isDirty: false,
  tracksDirty: 0,
  trackingTargetIds: new Set(),

  bumpTracksDirty: () => set((state) => ({ tracksDirty: state.tracksDirty + 1 })),

  // ---- Chargement ----

  loadAnnotations: (frameId, annotations) => {
    set((state) => {
      // Les effets de navigation/live peuvent recevoir deux fois exactement le
      // meme snapshot. Ne pas recreer Sets et piles dans ce cas : cela evite un
      // commit React inutile et preserve aussi la selection de l'utilisateur.
      if (state.currentFrameId === frameId && state.annotations === annotations) return state
      return {
        currentFrameId: frameId,
        annotations,
        selectedAnnotationIds: new Set(),
        drawingState: null,
        undoStack: [],
        redoStack: [],
        isDirty: false,
      }
    })
  },

  clearAnnotations: () => {
    set({
      currentFrameId: null,
      annotations: [],
      selectedAnnotationIds: new Set(),
      drawingState: null,
    })
  },

  // ---- CRUD ----

  addAnnotation: async (annData) => {
    const { currentFrameId } = get()
    if (!currentFrameId) return null

    // Snapshot avant modification (pour undo)
    get().pushUndoSnapshot('Ajout annotation')

    try {
      const newAnn = await annotationsAPI.create(currentFrameId, annData)
      set((state) => ({
        annotations: [...state.annotations, newAnn],
        isDirty: true,
      }))
      return newAnn
    } catch (e) {
      console.error('[annotationStore] Erreur création :', e)
      return null
    }
  },

  bulkAddAnnotations: async (frameId, annsData) => {
    if (!annsData.length) return []
    get().pushUndoSnapshot(`Ajout ${annsData.length} annotation${annsData.length > 1 ? 's' : ''} (bulk)`)
    try {
      // 1 appel réseau pour créer toutes les annotations en base
      await annotationsAPI.bulkCreate(frameId, annsData, false)
      // 1 appel réseau pour récupérer la liste fraîche avec les vrais IDs
      const freshAnns = await annotationsAPI.list(frameId)
      // Mettre à jour le store seulement si la frame est toujours courante
      const { currentFrameId } = get()
      if (currentFrameId === frameId) {
        set({ annotations: freshAnns, isDirty: true })
      }
      return freshAnns
    } catch (e) {
      console.error('[annotationStore] Erreur bulk création :', e)
      return []
    }
  },

  updateAnnotation: async (id, update) => {
    get().pushUndoSnapshot('Modification annotation')

    try {
      const updated = await annotationsAPI.update(id, update)
      set((state) => ({
        annotations: state.annotations.map((a) => (a.id === id ? updated : a)),
        isDirty: true,
      }))
    } catch (e) {
      console.error('[annotationStore] Erreur modification :', e)
    }
  },

  deleteAnnotation: async (id) => {
    get().pushUndoSnapshot('Suppression annotation')

    try {
      await annotationsAPI.delete(id)
      set((state) => ({
        annotations: state.annotations.filter((a) => a.id !== id),
        selectedAnnotationIds: new Set(
          [...state.selectedAnnotationIds].filter((sid) => sid !== id)
        ),
        isDirty: true,
      }))
    } catch (e) {
      console.error('[annotationStore] Erreur suppression :', e)
    }
  },

  deleteSelected: async () => {
    const { selectedAnnotationIds } = get()
    if (selectedAnnotationIds.size === 0) return

    get().pushUndoSnapshot(`Suppression de ${selectedAnnotationIds.size} annotation(s)`)

    const idsToDelete = [...selectedAnnotationIds]
    try {
      await Promise.all(idsToDelete.map((id) => annotationsAPI.delete(id)))
      set((state) => ({
        annotations: state.annotations.filter((a) => !idsToDelete.includes(a.id)),
        selectedAnnotationIds: new Set(),
        isDirty: true,
      }))
      get().bumpTracksDirty()   // une piste a pu devenir vide → refresh timeline
    } catch (e) {
      console.error('[annotationStore] Erreur suppression multiple :', e)
    }
  },

  deleteAllAnnotations: async () => {
    const { currentFrameId } = get()
    if (!currentFrameId) return

    get().pushUndoSnapshot('Suppression de toutes les annotations')

    try {
      await annotationsAPI.deleteAll(currentFrameId)
      set({
        annotations: [],
        selectedAnnotationIds: new Set(),
        isDirty: false,
      })
    } catch (e) {
      console.error('[annotationStore] Erreur suppression totale :', e)
    }
  },

  bulkSetAnnotations: async (anns, replace = true) => {
    const { currentFrameId } = get()
    if (!currentFrameId) return

    get().pushUndoSnapshot('Import batch annotations')

    try {
      await annotationsAPI.bulkCreate(currentFrameId, anns, replace)
      // Rechargement des annotations depuis l'API
      const updated = await annotationsAPI.list(currentFrameId)
      set({ annotations: updated, isDirty: false })
    } catch (e) {
      console.error('[annotationStore] Erreur bulk create :', e)
    }
  },

  // ---- Sélection ----

  selectAnnotation: (id, multiSelect = false) => {
    set((state) => {
      if (multiSelect) {
        const newSelected = new Set(state.selectedAnnotationIds)
        if (newSelected.has(id)) {
          newSelected.delete(id)
        } else {
          newSelected.add(id)
        }
        return { selectedAnnotationIds: newSelected }
      } else {
        return { selectedAnnotationIds: new Set([id]) }
      }
    })
  },

  selectAnnotations: (ids) => {
    set({ selectedAnnotationIds: new Set(ids) })
  },

  deselectAll: () => {
    set({ selectedAnnotationIds: new Set() })
  },

  selectAll: () => {
    set((state) => ({
      selectedAnnotationIds: new Set(state.annotations.map((a) => a.id)),
    }))
  },

  // ---- Undo / Redo ----

  pushUndoSnapshot: (action) => {
    // Édition canvas → "dernière action" = per-frame (arbitrage Ctrl+Z, cf. bulkUndoStore)
    useBulkUndoStore.getState().noteFrameAction()
    set((state) => {
      const snapshot: AnnotationSnapshot = {
        frameId: state.currentFrameId ?? 0,
        annotations: JSON.parse(JSON.stringify(state.annotations)) as Annotation[],
        timestamp: Date.now(),
        action,
      }
      // Limiter la pile à MAX_UNDO_HISTORY entrées
      const newStack = [...state.undoStack, snapshot].slice(-MAX_UNDO_HISTORY)
      return {
        undoStack: newStack,
        redoStack: [],  // Toute nouvelle action efface le redo
      }
    })
  },

  undo: async () => {
    const { undoStack, annotations, currentFrameId } = get()
    if (undoStack.length === 0 || !currentFrameId) return

    const prevSnapshot = undoStack[undoStack.length - 1]

    // Sauvegarder l'état actuel dans la pile redo
    set((state) => ({
      redoStack: [
        ...state.redoStack,
        {
          frameId: currentFrameId,
          annotations: JSON.parse(JSON.stringify(annotations)) as Annotation[],
          timestamp: Date.now(),
          action: 'redo',
        },
      ],
      undoStack: state.undoStack.slice(0, -1),
    }))

    // Restaurer l'état précédent via l'API (bulk replace)
    try {
      await annotationsAPI.bulkCreate(
        currentFrameId,
        prevSnapshot.annotations.map((a) => ({
          class_id: a.class_id,
          annotation_type: a.annotation_type,
          cx: a.cx,
          cy: a.cy,
          width: a.width,
          height: a.height,
          points: a.points,
          track_id: a.track_id,
          confidence: a.confidence,
          is_auto: a.is_auto,
          is_interpolated: a.is_interpolated,
        })),
        true  // replace=true
      )
      // Recharger depuis la BDD pour obtenir les vrais IDs
      const updated = await annotationsAPI.list(currentFrameId)
      set({ annotations: updated, selectedAnnotationIds: new Set() })
      get().bumpTracksDirty()   // undo a pu vider une piste (backend la supprime) → refresh
    } catch (e) {
      console.error('[annotationStore] Erreur undo :', e)
    }
  },

  redo: async () => {
    const { redoStack, annotations, currentFrameId } = get()
    if (redoStack.length === 0 || !currentFrameId) return

    const nextSnapshot = redoStack[redoStack.length - 1]

    set((state) => ({
      undoStack: [
        ...state.undoStack,
        {
          frameId: currentFrameId,
          annotations: JSON.parse(JSON.stringify(annotations)) as Annotation[],
          timestamp: Date.now(),
          action: 'undo',
        },
      ],
      redoStack: state.redoStack.slice(0, -1),
    }))

    try {
      await annotationsAPI.bulkCreate(
        currentFrameId,
        nextSnapshot.annotations.map((a) => ({
          class_id: a.class_id,
          annotation_type: a.annotation_type,
          cx: a.cx,
          cy: a.cy,
          width: a.width,
          height: a.height,
          points: a.points,
          track_id: a.track_id,
          confidence: a.confidence,
          is_auto: a.is_auto,
          is_interpolated: a.is_interpolated,
        })),
        true
      )
      const updated = await annotationsAPI.list(currentFrameId)
      set({ annotations: updated, selectedAnnotationIds: new Set() })
      get().bumpTracksDirty()
    } catch (e) {
      console.error('[annotationStore] Erreur redo :', e)
    }
  },

  // ---- Clipboard ----

  copySelected: () => {
    const { annotations, selectedAnnotationIds } = get()
    const selected = annotations.filter((a) => selectedAnnotationIds.has(a.id))
    if (selected.length > 0) {
      set({ clipboard: selected })
    }
  },

  pasteToFrame: async (targetFrameId) => {
    const { clipboard, currentFrameId } = get()
    if (!clipboard || clipboard.length === 0) return

    get().pushUndoSnapshot('Collage annotations')

    try {
      await annotationsAPI.bulkCreate(
        targetFrameId,
        clipboard.map((a) => ({
          class_id: a.class_id,
          annotation_type: a.annotation_type,
          cx: a.cx,
          cy: a.cy,
          width: a.width,
          height: a.height,
          points: a.points,
          track_id: a.track_id,
          confidence: a.confidence,
          is_auto: true,
          is_interpolated: true,
        })),
        false  // Ne pas remplacer, ajouter
      )

      // Si on colle sur la frame courante, recharger
      if (targetFrameId === currentFrameId) {
        const updated = await annotationsAPI.list(targetFrameId)
        set({ annotations: updated })
      }
    } catch (e) {
      console.error('[annotationStore] Erreur paste :', e)
    }
  },

  // ---- Dessin ----

  setActiveTool: (tool) => {
    set({ activeTool: tool, drawingState: null, selectedAnnotationIds: new Set() })
  },

  setActiveClassId: (classId) => {
    set({ activeClassId: classId })
  },

  startDrawing: (tool, startPoint) => {
    set({
      drawingState: {
        tool,
        startPoint,
        currentPoint: startPoint,
        points: [startPoint],
      },
    })
  },

  updateDrawing: (point) => {
    set((state) => {
      if (!state.drawingState) return state
      return {
        drawingState: {
          ...state.drawingState,
          currentPoint: point,
        },
      }
    })
  },

  addPolygonPoint: (point) => {
    set((state) => {
      if (!state.drawingState) return state
      return {
        drawingState: {
          ...state.drawingState,
          points: [...state.drawingState.points, point],
          currentPoint: point,
        },
      }
    })
  },

  finishDrawing: () => {
    set({ drawingState: null })
  },

  cancelDrawing: () => {
    set({ drawingState: null })
  },

  // ---- Label rapide ----

  relabelSelected: async (classId) => {
    const { selectedAnnotationIds } = get()
    if (selectedAnnotationIds.size === 0) return

    get().pushUndoSnapshot('Relabellisation')

    try {
      await Promise.all(
        [...selectedAnnotationIds].map((id) => annotationsAPI.update(id, { class_id: classId }))
      )
      set((state) => ({
        annotations: state.annotations.map((a) =>
          state.selectedAnnotationIds.has(a.id) ? { ...a, class_id: classId } : a
        ),
      }))
    } catch (e) {
      console.error('[annotationStore] Erreur relabellisation :', e)
    }
  },

  // ---- Tracking : cibles guidées ----

  toggleTrackingTarget: (id) => {
    set((state) => {
      const next = new Set(state.trackingTargetIds)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return { trackingTargetIds: next }
    })
  },

  setTrackingTargets: (ids) => {
    set({ trackingTargetIds: new Set(ids) })
  },

  clearTrackingTargets: () => {
    set({ trackingTargetIds: new Set() })
  },
}))

// ---- Synchro compteur timeline (projectStore.frames) ----
// A CHAQUE changement d'annotations (add/update/delete/undo/redo/paste/bulk/loadAnnotations,
// quelle que soit l'action), on repousse le compteur reel dans projectStore. Un seul point de
// verite plutot qu'un appel a caser dans chaque action individuellement — ne peut pas oublier
// une action future, et couvre aussi la frame active pendant un scrub (Fix 1, AnnotationPage).
useAnnotationStore.subscribe((state, prevState) => {
  if (state.currentFrameId == null) return
  if (state.annotations === prevState.annotations && state.currentFrameId === prevState.currentFrameId) return
  useProjectStore.getState().setFrameAnnotationCount(state.currentFrameId, state.annotations.length)
})
