// ============================================================
// stores/bulkUndoStore.ts
// Coordination "dernière action gagne" entre le undo/redo PER-FRAME
// (annotationStore) et le undo/redo des suppressions GROUPÉES d'annotations
// via la timeline du bas (historique côté serveur).
//
// - noteBulkDelete() : appelé après une suppression groupée → la prochaine
//   pression Ctrl+Z doit annuler CETTE suppression.
// - noteFrameAction() : appelé par annotationStore.pushUndoSnapshot à chaque
//   édition canvas → Ctrl+Z repasse sur le undo per-frame.
// - canUndo/canRedo : reflètent l'historique serveur (retourné par les endpoints).
// ============================================================

import { create } from 'zustand'

interface BulkUndoState {
  canUndo: boolean
  canRedo: boolean
  lastActionWasBulk: boolean
  noteBulkDelete: () => void
  noteFrameAction: () => void
  setFlags: (canUndo: boolean, canRedo: boolean) => void
}

export const useBulkUndoStore = create<BulkUndoState>((set) => ({
  canUndo: false,
  canRedo: false,
  lastActionWasBulk: false,
  // Une suppression groupée devient la dernière action et rend le undo dispo ;
  // elle invalide le redo (nouvelle branche d'historique).
  noteBulkDelete: () => set({ lastActionWasBulk: true, canUndo: true, canRedo: false }),
  // Toute édition canvas redonne la priorité au undo per-frame.
  noteFrameAction: () => set({ lastActionWasBulk: false }),
  setFlags: (canUndo, canRedo) => set({ canUndo, canRedo }),
}))
