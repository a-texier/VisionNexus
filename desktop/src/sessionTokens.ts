// ============================================================
// desktop/src/sessionTokens.ts
// Jetons de session des instances lancees (cf. _lib/session_auth.py).
//
// Chaque backend refuse les requetes sans le jeton de SON instance. Le
// lanceur l'annonce une fois (ligne "[token]"), les sous-apps de
// l'Orchestrator le recoivent via /api/apps. On le range ici par port --
// frontend ET backend, car les requetes d'un onglet passent par le proxy
// Vite (port frontend) avant d'atteindre le backend -- et on l'ajoute en
// en-tete a tout appel vers 127.0.0.1/localhost sur ces ports.
//
// Aucune dependance a Electron : testable sous node:test.
// ============================================================

export const TOKEN_HEADER = 'X-VN-Token'
export const BOOTSTRAP_PATH = '/api/_auth/bootstrap'
export const BOOTSTRAP_CODE_PATH = '/api/_auth/bootstrap-code'

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])

interface Instance { token: string; backendPort: number }

// Cle = port frontend OU backend d'une instance.
const instancesByPort = new Map<number, Instance>()

export function rememberToken(
  token: string | undefined | null,
  backendPort: number | null | undefined,
  frontendPort?: number | null,
): void {
  if (!token || !backendPort) return
  const instance = { token, backendPort }
  instancesByPort.set(backendPort, instance)
  if (frontendPort) instancesByPort.set(frontendPort, instance)
}

export function forgetPorts(ports: Array<number | null | undefined>): void {
  for (const p of ports) if (p) instancesByPort.delete(p)
}

export function tokenForPort(port: number | null | undefined): string | undefined {
  return port ? instancesByPort.get(port)?.token : undefined
}

/** Port backend de l'instance qui possede ce port (frontend ou backend). */
export function backendPortFor(port: number | null | undefined): number | undefined {
  return port ? instancesByPort.get(port)?.backendPort : undefined
}

/** Jeton pour une URL locale vers une de nos instances, sinon undefined (jamais vers un hote distant). */
export function tokenForUrl(url: string): string | undefined {
  let parsed: URL
  try { parsed = new URL(url) } catch { return undefined }
  if (!LOOPBACK_HOSTS.has(parsed.hostname) || !parsed.port) return undefined
  return tokenForPort(parseInt(parsed.port, 10))
}

export function authHeaders(url: string): Record<string, string> {
  const token = tokenForUrl(url)
  return token ? { [TOKEN_HEADER]: token } : {}
}

/** fetch() avec le jeton de l'instance visee ajoute si on le connait. */
export function authFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const extra = authHeaders(url)
  if (!Object.keys(extra).length) return fetch(url, init)
  const headers = new Headers(init.headers)
  for (const [k, v] of Object.entries(extra)) headers.set(k, v)
  return fetch(url, { ...init, headers })
}

/** Chemin relatif sur a transmettre en `next` (meme origine uniquement). */
export function safeNextPath(path: string): string {
  return path.startsWith('/') && !path.startsWith('//') && !path.includes('\\') ? path : '/'
}

/**
 * Lien a usage unique qui ouvre `url` dans un navigateur externe. Le backend
 * delivre un code (valable ~2 min) contre notre jeton ; le lien pose ensuite
 * le cookie de session dans CE navigateur et redirige vers la page demandee.
 * null si l'URL ne vise pas une instance dont on connait le jeton : le lien
 * nu suffit alors.
 */
export async function bootstrapUrl(url: string): Promise<string | null> {
  let parsed: URL
  try { parsed = new URL(url) } catch { return null }
  if (!LOOPBACK_HOSTS.has(parsed.hostname) || !parsed.port) return null
  const port = parseInt(parsed.port, 10)
  const backendPort = backendPortFor(port)
  const token = tokenForPort(port)
  if (!backendPort || !token) return null
  const res = await fetch(`http://127.0.0.1:${backendPort}${BOOTSTRAP_CODE_PATH}`, {
    method: 'POST',
    headers: { [TOKEN_HEADER]: token },
    signal: AbortSignal.timeout(5000),
  })
  if (!res.ok) throw new Error(`code d'amorcage refuse (HTTP ${res.status})`)
  const { code } = await res.json() as { code: string }
  const next = safeNextPath(`${parsed.pathname}${parsed.search}${parsed.hash}`)
  const params = new URLSearchParams({ code, next })
  // Meme origine que la page demandee : le cookie est pose pour 127.0.0.1, et
  // le lien passe par le proxy Vite quand c'est le port frontend.
  return `http://127.0.0.1:${port}${BOOTSTRAP_PATH}?${params.toString()}`
}

/** Reinitialise l'etat (tests). */
export function clearTokens(): void {
  instancesByPort.clear()
}
