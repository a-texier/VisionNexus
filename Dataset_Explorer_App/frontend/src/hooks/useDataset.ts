// ============================================================
// hooks/useDataset.ts
// Accès aux données d'un dataset (TanStack Query).
// ============================================================

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { datasetsAPI } from '../api/client'

const TRANSIENT = new Set(['scanning', 'embedding'])

// Un dataset est "actif" (→ poll 2s) s'il est en état transitoire OU si une
// tâche de fond est en cours : thumbnails, ou reclustering (statut inchangé).
function isActive(d: {
  status: string
  thumb_progress: number; thumb_total: number
  recluster_total: number
  reduce_total: number
}): boolean {
  if (TRANSIENT.has(d.status)) return true
  if (d.thumb_total > 0 && d.thumb_progress < d.thumb_total) return true
  if (d.recluster_total > 0) return true
  if (d.reduce_total > 0) return true
  return false
}

export function useDatasets() {
  return useQuery({
    queryKey: ['datasets'],
    queryFn: datasetsAPI.list,
    // Polling automatique tant qu'une opération de fond tourne (embed, scan,
    // thumbnails, recluster) — pilote toutes les barres de progression.
    refetchInterval: (query) => {
      const data = query.state.data
      if (!data) return false
      return data.some(isActive) ? 2000 : false
    },
  })
}

export function useDataset(id: number | null) {
  return useQuery({
    queryKey: ['dataset', id],
    queryFn: () => datasetsAPI.get(id!),
    enabled: id !== null,
  })
}

export function useDatasetImages(
  id: number | null,
  params: Parameters<typeof datasetsAPI.getImages>[1] = {}
) {
  return useQuery({
    queryKey: ['dataset-images', id, params],
    queryFn: () => datasetsAPI.getImages(id!, params),
    enabled: id !== null,
  })
}

export function useDatasetMap(id: number | null, enabled = true) {
  return useQuery({
    queryKey: ['dataset-map', id],
    queryFn: () => datasetsAPI.getMap(id!),
    enabled: id !== null && enabled,
    staleTime: 60_000,
  })
}

export function useDatasetClusters(id: number | null) {
  return useQuery({
    queryKey: ['dataset-clusters', id],
    queryFn: () => datasetsAPI.getClusters(id!),
    enabled: id !== null,
  })
}

export function useInvalidateDataset() {
  const qc = useQueryClient()
  return (id?: number) => {
    if (id) {
      qc.invalidateQueries({ queryKey: ['dataset', id] })
      qc.invalidateQueries({ queryKey: ['dataset-map', id] })
      qc.invalidateQueries({ queryKey: ['dataset-clusters', id] })
    }
    qc.invalidateQueries({ queryKey: ['datasets'] })
  }
}
