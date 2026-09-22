import { useQuery, useQueryClient } from '@tanstack/react-query'
import { modelsAPI } from '../api/client'

export function useModels() {
  return useQuery({
    queryKey: ['models'],
    queryFn:  modelsAPI.list,
    staleTime: 10_000,
  })
}

export function useModelVersions(model_name: string | null) {
  return useQuery({
    queryKey: ['model-versions', model_name],
    queryFn:  () => modelsAPI.listVersions(model_name!),
    enabled:  !!model_name,
    staleTime: 10_000,
  })
}

export function useInvalidateModels() {
  const qc = useQueryClient()
  return () => {
    qc.invalidateQueries({ queryKey: ['models'] })
    qc.invalidateQueries({ queryKey: ['model-versions'] })
  }
}
