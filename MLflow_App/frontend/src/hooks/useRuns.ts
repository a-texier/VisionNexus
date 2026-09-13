import { useQuery, useQueryClient } from '@tanstack/react-query'
import { runsAPI } from '../api/client'

export function useRuns(experiment_id: string | null) {
  return useQuery({
    queryKey: ['runs', experiment_id],
    queryFn:  () => runsAPI.list(experiment_id!),
    enabled:  !!experiment_id,
    staleTime: 10_000,
  })
}

export function useRun(run_id: string | null) {
  return useQuery({
    queryKey: ['run', run_id],
    queryFn:  () => runsAPI.get(run_id!),
    enabled:  !!run_id,
    staleTime: 10_000,
  })
}

export function useInvalidateRuns() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: ['runs'] })
}
