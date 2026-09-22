import { useQuery } from '@tanstack/react-query'

import { settingsAPI } from '../api/client'
import type { AppSettings } from '../types/api'

/**
 * Browser persistence must be isolated like backend persistence.
 *
 * All Orchestrator workspaces share the same frontend origin (usually
 * localhost:3000), so a graph id alone is not a safe localStorage namespace.
 * The backend workspace path + user form the stable local identity.
 */
export function workspaceStorageScope(
  settings: Pick<AppSettings, 'workspace_path' | 'user_name'> | undefined,
): string | null {
  if (!settings?.workspace_path || !settings.user_name) return null

  const identity = `${settings.user_name.trim().toLowerCase()}|${settings.workspace_path
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
    .toLowerCase()}`

  // FNV-1a: compact deterministic key; this is namespacing, not security.
  let hash = 0x811c9dc5
  for (let i = 0; i < identity.length; i += 1) {
    hash ^= identity.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return `${settings.user_name.trim().toLowerCase()}:${(hash >>> 0).toString(16).padStart(8, '0')}`
}

export function workspaceStorageKey(scope: string, key: string): string {
  return `orch:${scope}:${key}`
}

/** Polling also detects a workspace restart/switch without requiring a page reload. */
export function useWorkspaceStorageScope(): string | null {
  const { data } = useQuery({
    queryKey: ['settings'],
    queryFn: settingsAPI.get,
    refetchInterval: 2_000,
  })
  return workspaceStorageScope(data)
}
