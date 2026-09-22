import { useQuery, useQueryClient } from '@tanstack/react-query'
import { runsAPI } from '../api/client'
import type { ArtifactListing } from '../types/api'

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

// Contenu d'un sous-dossier d'artifacts (ex. "plots" joint par Training_App).
export function useRunArtifacts(run_id: string | null, path: string, enabled = true) {
  return useQuery<ArtifactListing>({
    queryKey: ['run-artifacts', run_id, path],
    queryFn: () => runsAPI.artifacts(run_id!, path),
    enabled: Boolean(run_id) && enabled,
    staleTime: 60_000,
  })
}
