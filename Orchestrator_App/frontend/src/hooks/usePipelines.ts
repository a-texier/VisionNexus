import { useQuery, useQueryClient } from '@tanstack/react-query'
import { pipelinesAPI } from '../api/client'

export function usePipelines() {
  return useQuery({
    queryKey: ['pipelines'],
    queryFn:  pipelinesAPI.list,
    staleTime: 10_000,
  })
}

export function usePipeline(id: string | undefined) {
  return useQuery({
    queryKey: ['pipeline', id],
    queryFn:  () => pipelinesAPI.get(id!),
    enabled:  !!id,
    staleTime: 10_000,
  })
}

export function useInvalidatePipelines() {
  const qc = useQueryClient()
  return (id?: string) => {
    qc.invalidateQueries({ queryKey: ['pipelines'] })
    if (id) qc.invalidateQueries({ queryKey: ['pipeline', id] })
  }
}
