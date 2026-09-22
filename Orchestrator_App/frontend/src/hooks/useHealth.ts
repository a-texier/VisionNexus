import { useQuery } from '@tanstack/react-query'
import { healthAPI } from '../api/client'
import type { HealthResult } from '../types/api'

export function useHealth(refetchMs = 10_000) {
  return useQuery<HealthResult>({
    queryKey: ['health'],
    queryFn:  healthAPI.get,
    refetchInterval: refetchMs,
    staleTime: 5_000,
  })
}
