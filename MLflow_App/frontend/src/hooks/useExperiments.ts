import { useQuery, useQueryClient } from '@tanstack/react-query'
import { experimentsAPI } from '../api/client'

export function useExperiments() {
  return useQuery({
    queryKey: ['experiments'],
    queryFn:  experimentsAPI.list,
    staleTime: 10_000,
  })
}

export function useInvalidateExperiments() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: ['experiments'] })
}
