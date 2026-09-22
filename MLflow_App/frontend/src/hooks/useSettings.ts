import { useQuery, useQueryClient } from '@tanstack/react-query'
import { settingsAPI } from '../api/client'

export function useSettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn:  settingsAPI.get,
    staleTime: 30_000,
  })
}

export function useInvalidateSettings() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: ['settings'] })
}
