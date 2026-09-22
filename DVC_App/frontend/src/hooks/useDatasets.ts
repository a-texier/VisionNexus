import { useQuery, useQueryClient } from '@tanstack/react-query'
import { datasetsAPI } from '../api/client'

export function useDatasets() {
  return useQuery({
    queryKey: ['datasets'],
    queryFn:  datasetsAPI.list,
    staleTime: 10_000,
  })
}

export function useDVCStatus() {
  return useQuery({
    queryKey: ['dvc-status'],
    queryFn:  datasetsAPI.status,
    staleTime: 10_000,
  })
}

export function useBranch() {
  return useQuery({
    queryKey: ['branch'],
    queryFn:  datasetsAPI.branch,
    staleTime: 15_000,
    refetchInterval: 30_000,
  })
}

export function useInvalidateDatasets() {
  const qc = useQueryClient()
  return () => {
    qc.invalidateQueries({ queryKey: ['datasets'] })
    qc.invalidateQueries({ queryKey: ['dvc-status'] })
    qc.invalidateQueries({ queryKey: ['branch'] })
  }
}
