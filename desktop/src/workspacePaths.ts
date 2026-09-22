export type WorkspacePathMapping = { backendRoot: string; clientRoot: string }
export type ResolvedWorkspacePath = { ok: true; path: string } | { ok: false; error: string }

export function resolveClientWorkspacePath(
  rawPath: string,
  mappings: WorkspacePathMapping[],
  platform: NodeJS.Platform = process.platform,
): ResolvedWorkspacePath {
  const requested = rawPath.trim()
  if (!requested) return { ok: false, error: 'Aucun chemin à ouvrir.' }
  if (/^\\\\[^\\]+\\[^\\]+/.test(requested) || /^[a-zA-Z]:[\\/]/.test(requested)) {
    return { ok: true, path: requested.replace(/\//g, '\\') }
  }
  if (platform !== 'win32') return { ok: true, path: requested }

  const normalized = requested.replace(/\\/g, '/').replace(/\/$/, '')
  const candidates = mappings
    .map((m) => ({
      backendRoot: m.backendRoot.trim().replace(/\\/g, '/').replace(/\/$/, ''),
      clientRoot: m.clientRoot.trim().replace(/[\\/]+$/, ''),
    }))
    .filter((m) => m.backendRoot.startsWith('/') && m.clientRoot.length > 0)
    .sort((a, b) => b.backendRoot.length - a.backendRoot.length)
  const mapping = candidates.find((m) => normalized === m.backendRoot || normalized.startsWith(`${m.backendRoot}/`))
  const conventionalMount = normalized.match(/^\/mnt\/([^/]+)\/([^/]+)(?:\/(.*))?$/)
  if (!mapping && conventionalMount) {
    const [, server, share, suffix = ''] = conventionalMount
    return { ok: true, path: `\\\\${server}\\${share}${suffix ? `\\${suffix.replace(/\//g, '\\')}` : ''}` }
  }
  if (!mapping) {
    return { ok: false, error: `Le chemin Linux « ${requested} » n'a aucun mapping client Windows/SMB dans les Settings Workspace.` }
  }
  const suffix = normalized.slice(mapping.backendRoot.length).replace(/^\//, '').replace(/\//g, '\\')
  return { ok: true, path: suffix ? `${mapping.clientRoot}\\${suffix}` : mapping.clientRoot }
}
