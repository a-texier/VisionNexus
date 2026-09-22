// ============================================================
// hooks/useSubset.ts
// Sélection globale d'images + gestion des subsets.
// ============================================================

import { create } from 'zustand'
import { subsetsAPI } from '../api/client'
import type { SubsetSummary } from '../types/api'

interface SelectionStore {
  selectedIds: Set<number>
  toggle: (id: number) => void
  addMany: (ids: number[]) => void
  clear: () => void
  hasId: (id: number) => boolean
}

// Store Zustand global pour la sélection d'images
export const useSelectionStore = create<SelectionStore>((set, get) => ({
  selectedIds: new Set(),
  toggle: (id) =>
    set(state => {
      const next = new Set(state.selectedIds)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return { selectedIds: next }
    }),
  addMany: (ids) =>
    set(state => {
      const next = new Set(state.selectedIds)
      ids.forEach(id => next.add(id))
      return { selectedIds: next }
    }),
  clear: () => set({ selectedIds: new Set() }),
  hasId: (id) => get().selectedIds.has(id),
}))

// Hook helper pour créer un subset depuis la sélection courante
export function useCreateSubset() {
  const { selectedIds, clear } = useSelectionStore()

  const createSubset = async (
    datasetId: number,
    name: string
  ): Promise<SubsetSummary> => {
    if (selectedIds.size === 0) throw new Error('Aucune image sélectionnée')
    const subset = await subsetsAPI.create({
      dataset_id: datasetId,
      name,
      image_ids: Array.from(selectedIds),
    })
    clear()
    return subset
  }

  return { createSubset, count: selectedIds.size }
}
