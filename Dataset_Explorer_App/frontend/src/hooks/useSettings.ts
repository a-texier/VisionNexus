// ============================================================
// hooks/useSettings.ts
// Accès aux paramètres utilisateur (TanStack Query).
// ============================================================

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { settingsAPI } from '../api/client'

export function useSettings() {
  const qc = useQueryClient()

  const { data: settings, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: settingsAPI.get,
    staleTime: 30_000,
  })

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['settings'] })
  }

  return { settings, isLoading, refresh }
}
