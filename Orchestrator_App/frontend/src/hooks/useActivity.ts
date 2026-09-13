import { useQuery, useQueryClient } from '@tanstack/react-query'
import { activityAPI } from '../api/client'

export function useActivity(limit = 50, refetchMs = 10_000) {
  return useQuery({
    queryKey: ['activity', limit],
    queryFn:  () => activityAPI.get(limit),
    refetchInterval: refetchMs,
    staleTime: 5_000,
  })
}

export function useInvalidateActivity() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: ['activity'] })
}
