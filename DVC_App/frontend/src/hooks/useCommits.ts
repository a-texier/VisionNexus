import { useQuery, useQueryClient } from '@tanstack/react-query'
import { commitsAPI } from '../api/client'

export function useCommits(n = 50) {
  return useQuery({
    queryKey: ['commits', n],
    queryFn:  () => commitsAPI.list(n),
    staleTime: 15_000,
  })
}

export function useInvalidateCommits() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: ['commits'] })
}
