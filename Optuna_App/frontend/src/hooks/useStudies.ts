import { useQuery, useQueryClient } from '@tanstack/react-query'
import { studiesAPI } from '../api/client'

export function useStudies() {
  return useQuery({
    queryKey: ['studies'],
    queryFn:  studiesAPI.list,
    staleTime: 10_000,
    refetchInterval: 15_000,
  })
}

export function useTrials(study_name: string | null) {
  return useQuery({
    queryKey: ['trials', study_name],
    queryFn:  () => studiesAPI.trials(study_name!),
    enabled:  !!study_name,
    staleTime: 5_000,
  })
}

export function useStudyStatus(study_name: string | null, active: boolean) {
  return useQuery({
    queryKey: ['study-status', study_name],
    queryFn:  () => studiesAPI.status(study_name!),
    enabled:  !!study_name,
    refetchInterval: active ? 2_000 : 10_000,
    staleTime: 1_000,
  })
}

export function useInvalidateStudies() {
  const qc = useQueryClient()
  return (study_name?: string) => {
    qc.invalidateQueries({ queryKey: ['studies'] })
    if (study_name) {
      qc.invalidateQueries({ queryKey: ['trials', study_name] })
      qc.invalidateQueries({ queryKey: ['study-status', study_name] })
    }
  }
}
