// ============================================================
// desktop/src/services.ts
// Logique pure des ressources de calcul (services backend seul, cf. catalog.ts
// SERVICES) : machine a etats, validation des entrees IPC, mapping des
// reponses du service, appel HTTP vers son port local. Aucune dependance a
// Electron : testable sous node:test (services.test.ts). Le pilotage des
// process (lancement, tunnel, arret) reste dans main.ts.
// ============================================================

import { authFetch } from './sessionTokens'

// ---- Machine a etats : off -> starting -> ready -> stopping -> off ----

export type ServiceState = 'off' | 'starting' | 'ready' | 'stopping' | 'error'
export type ServiceEvent = 'start' | 'ready' | 'fail' | 'stop' | 'stopped'

/**
 * Transition sans effet de bord. Un evenement sans sens dans l'etat courant
 * laisse l'etat inchange (double clic sur l'interrupteur, echec qui arrive
 * pendant l'arret...) : l'appelant n'a pas a filtrer.
 */
export function nextServiceState(state: ServiceState, event: ServiceEvent): ServiceState {
  switch (event) {
    case 'start': return state === 'off' || state === 'error' ? 'starting' : state
    case 'ready': return state === 'starting' ? 'ready' : state
    case 'fail': return state === 'starting' || state === 'ready' ? 'error' : state
    case 'stop':
      if (state === 'starting' || state === 'ready') return 'stopping'
      return state === 'error' ? 'off' : state
    case 'stopped': return state === 'stopping' ? 'off' : state
  }
}

export function canStart(state: ServiceState): boolean {
  return state === 'off' || state === 'error'
}

// ---- Etat de l'index (GET /index/status) ----

export interface IndexSummary {
  syncing: boolean
  /** Avancement n/N de la synchro en cours (0/0 hors synchro). */
  done: number
  total: number
  chunks: number
  embedded: number
  /** Passages indexes par app : sert a n'offrir en filtre que les apps qui ont du contenu. */
  perApp: Record<string, number>
  modelAvailable: boolean
  modelLoaded: boolean
  lastError: string | null
}

export type MessageParams = Record<string, string | number>

export interface ServiceStatus {
  id: string
  state: ServiceState
  /** Detail lisible : cause de l'erreur, sinon vide. Toujours en francais (journal, panneau des lancements). */
  message: string
  /** Cle i18n du message pour l'interface (ui/i18n.js) ; null = afficher `message` tel quel. */
  messageKey: string | null
  messageParams: MessageParams | null
  /** Fin de la sortie du launcher : explique un echec, jamais traduit. */
  detail: string
  /** Cible sur laquelle le service tourne (ou tournerait) : '' = local, sinon nom de la VM. */
  target: string
  /** Cible actuellement choisie dans les reglages (differe de `target` si la VM a change en cours de route). */
  selected: string
  index: IndexSummary | null
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null
}

function asCounts(v: unknown): Record<string, number> {
  const r = asRecord(v) ?? {}
  return Object.fromEntries(Object.entries(r).filter(([, n]) => asCount(n) > 0).map(([app, n]) => [app, asCount(n)]))
}

function asCount(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0
}

export function summarizeIndexStatus(raw: unknown): IndexSummary | null {
  const r = asRecord(raw)
  if (!r) return null
  const progress = asRecord(r.progress) ?? {}
  const toEmbed = asCount(progress.chunks_to_embed)
  // Pendant l'embedding le compteur utile est en chunks ; avant (lecture des
  // fichiers) on n'a que les fichiers.
  const byChunks = toEmbed > 0
  return {
    syncing: r.syncing === true,
    done: byChunks ? asCount(progress.chunks_embedded) : asCount(progress.files_done),
    total: byChunks ? toEmbed : asCount(progress.files_total),
    chunks: asCount(r.chunks),
    embedded: asCount(r.embedded),
    perApp: asCounts(r.per_app),
    modelAvailable: r.model_available === true,
    modelLoaded: r.model_loaded === true,
    lastError: typeof r.last_error === 'string' && r.last_error ? r.last_error.slice(0, 300) : null,
  }
}

// ---- Erreurs renvoyees au renderer (jamais d'exception a travers l'IPC) ----

export type ServiceErrorCode =
  | 'off' | 'starting' | 'stopping' | 'error'   // service pas pret
  | 'unreachable' | 'timeout' | 'http' | 'invalid'

export interface ServiceError {
  ok: false
  error: ServiceErrorCode
  message: string
  /** Cle i18n + parametres pour l'interface ; `message` (francais) sert de repli et au journal. */
  key?: string
  params?: MessageParams
}

export function serviceError(error: ServiceErrorCode, message: string, key?: string, params?: MessageParams): ServiceError {
  return key ? { ok: false, error, message, key, params } : { ok: false, error, message }
}

/** Refus d'un appel pont quand le service n'est pas pret ; null = on peut appeler. */
export function serviceGuard(status: Pick<ServiceStatus, 'state' | 'message'>): ServiceError | null {
  switch (status.state) {
    case 'ready': return null
    case 'off': return serviceError('off', 'Docs Assistant est eteint.')
    case 'starting': return serviceError('starting', 'Docs Assistant demarre.')
    case 'stopping': return serviceError('stopping', 'Docs Assistant s\'arrete.')
    case 'error': return serviceError('error', status.message || 'Docs Assistant est en erreur.')
  }
}

export type StartFailure =
  | { kind: 'settings' }
  | { kind: 'no-ports' }
  | { kind: 'busy-port'; ports: number[] }
  | { kind: 'tunnel'; detail: string }
  | { kind: 'not-ready' }
  | { kind: 'exited'; code: number | null }
  | { kind: 'exception'; detail: string }

/** Cle i18n (+ parametres) de chaque echec de demarrage ; le texte francais reste celui de startFailureMessage. */
export function startFailureKey(f: StartFailure): { key: string; params?: MessageParams } {
  switch (f.kind) {
    case 'settings': return { key: 'svcErrSettings' }
    case 'no-ports': return { key: 'svcErrNoPorts' }
    case 'busy-port': return { key: 'svcErrBusyPort', params: { ports: f.ports.join(', ') } }
    case 'not-ready': return { key: 'svcErrNotReady', params: { seconds: 90 } }
    case 'exited': return { key: 'svcErrExited', params: { code: f.code ?? '?' } }
    case 'tunnel': return { key: 'svcErrDetail', params: { detail: f.detail } }
    case 'exception': return { key: 'svcErrDetail', params: { detail: f.detail } }
  }
}

/** Message d'erreur lisible pour chaque echec possible du demarrage. */
export function startFailureMessage(f: StartFailure): string {
  switch (f.kind) {
    case 'settings':
      return 'Renseigne Utilisateur / Workspace / Racine / Conda dans Parametres avant de lancer une ressource.'
    case 'no-ports':
      return 'launcher.py n\'a jamais annonce son port (verifie la connexion/les identifiants).'
    case 'busy-port':
      return `Port local deja occupe sur ce poste : ${f.ports.join(', ')}. Le tunnel ne peut pas le forwarder.`
        + ' Cause habituelle : un tunnel orphelin d\'une session precedente ou une autre instance du lanceur.'
    case 'tunnel':
      return f.detail
    case 'not-ready':
      return 'Le service ne repond pas apres 90 s.'
    case 'exited':
      return `Le service s'est arrete (code ${f.code ?? 'inconnu'}). Voir le journal du lancement.`
    case 'exception':
      return f.detail
  }
}

// ---- Validation des entrees IPC de la fenetre Documentation ----

export const MAX_QUERY_CHARS = 500
export const DEFAULT_K = 8
export const MAX_K = 30
const MAX_APPS = 20

export interface SearchRequest {
  q: string
  lang: 'fr' | 'en' | 'both'
  apps: string[]
  audience: 'user' | 'dev' | 'all'
  k: number
  /** Langue gardee quand une section existe dans les deux ; auto = langue de la question. */
  prefer: 'fr' | 'en' | 'auto'
  /** Langue de l'interface : depart quand la question ne permet pas de trancher. */
  uiLang: 'fr' | 'en'
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T | null {
  if (v === undefined || v === null) return fallback
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? v as T : null
}

/** Valide et normalise la requete venue du renderer avant de la relayer au service. */
export function validateSearchRequest(raw: unknown): { ok: true; value: SearchRequest } | ServiceError {
  const r = asRecord(raw)
  if (!r) return serviceError('invalid', 'Requete de recherche invalide.')
  if (typeof r.q !== 'string') return serviceError('invalid', 'La question doit etre une chaine.')
  const q = r.q.trim()
  if (!q) return serviceError('invalid', 'Question vide.', 'askErrEmpty')
  if (q.length > MAX_QUERY_CHARS) {
    return serviceError('invalid', `Question trop longue (${MAX_QUERY_CHARS} caracteres max).`, 'askErrTooLong', { max: MAX_QUERY_CHARS })
  }

  const lang = oneOf(r.lang, ['fr', 'en', 'both'] as const, 'both')
  const audience = oneOf(r.audience, ['user', 'dev', 'all'] as const, 'all')
  const prefer = oneOf(r.prefer, ['fr', 'en', 'auto'] as const, 'auto')
  const uiLang = oneOf(r.uiLang, ['fr', 'en'] as const, 'en')
  if (!lang) return serviceError('invalid', 'Langue invalide (fr, en ou both).')
  if (!audience) return serviceError('invalid', 'Public invalide (user, dev ou all).')
  if (!prefer || !uiLang) return serviceError('invalid', 'Langue preferee invalide (fr, en ou auto).')

  const k = r.k === undefined || r.k === null ? DEFAULT_K : r.k
  if (typeof k !== 'number' || !Number.isInteger(k) || k < 1 || k > MAX_K) {
    return serviceError('invalid', `k doit etre un entier entre 1 et ${MAX_K}.`)
  }

  let apps: string[] = []
  if (r.apps !== undefined && r.apps !== null) {
    if (!Array.isArray(r.apps) || r.apps.length > MAX_APPS
      || !r.apps.every((a) => typeof a === 'string' && /^[a-z0-9_-]{1,32}$/i.test(a))) {
      return serviceError('invalid', 'Liste d\'apps invalide.')
    }
    apps = [...new Set(r.apps as string[])]
  }
  return { ok: true, value: { q, lang, apps, audience, k, prefer, uiLang } }
}

// ---- Mapping de la reponse de POST /search ----

export interface OtherLang { lang: 'fr' | 'en'; doc: string; headingIdx: number }

export interface SearchHit {
  app: string
  doc: string
  docType: string
  audience: string
  lang: 'fr' | 'en'
  title: string
  headingPath: string[]
  headingIdx: number
  snippet: string
  /** 0..1, relatif au meilleur resultat de la requete (classement, pas pertinence). */
  score: number
  /** 0..1, pertinence d'apres le cosinus du modele ; null si le modele n'est pas calibre ou hors candidats vectoriels. */
  relevance: number | null
  otherLang: OtherLang | null
}

export interface SearchResult {
  mode: 'hybrid' | 'keyword'
  tookMs: number
  terms: string[]
  notice: string | null
  /** low : aucun passage ne ressemble vraiment a la question ; null = non evalue. */
  confidence: 'high' | 'low' | null
  langDetected: 'fr' | 'en' | null
  hits: SearchHit[]
}

function asLang(v: unknown): 'fr' | 'en' | null {
  return v === 'fr' || v === 'en' ? v : null
}

function asIndex(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null
}

function asText(v: unknown, max: number): string {
  return typeof v === 'string' ? v.slice(0, max) : ''
}

function mapHit(raw: unknown): SearchHit | null {
  const h = asRecord(raw)
  if (!h) return null
  const app = asText(h.app, 64)
  const doc = asText(h.doc, 128)
  const lang = asLang(h.lang)
  const headingIdx = asIndex(h.heading_idx)
  // Sans app/doc/langue/ancre, le clic ne saurait pas ouvrir la bonne section.
  if (!app || !doc || !lang || headingIdx === null) return null
  const other = asRecord(h.other_lang)
  const otherLang = other && asLang(other.lang) && asText(other.doc, 128) && asIndex(other.heading_idx) !== null
    ? { lang: asLang(other.lang)!, doc: asText(other.doc, 128), headingIdx: asIndex(other.heading_idx)! }
    : null
  const score = typeof h.score === 'number' && Number.isFinite(h.score) ? Math.min(1, Math.max(0, h.score)) : 0
  const relevance = typeof h.relevance === 'number' && Number.isFinite(h.relevance) ? Math.min(1, Math.max(0, h.relevance)) : null
  return {
    app, doc, lang, headingIdx, otherLang, score, relevance,
    docType: asText(h.doc_type, 64),
    audience: asText(h.audience, 16),
    title: asText(h.title, 200) || doc,
    headingPath: Array.isArray(h.heading_path)
      ? h.heading_path.filter((p): p is string => typeof p === 'string').slice(0, 8).map((p) => p.slice(0, 200))
      : [],
    snippet: asText(h.snippet, 1200),
  }
}

/** Corps JSON de POST /search : le service nomme la langue de repli `ui_lang`. */
export function toServiceBody(request: SearchRequest): Record<string, unknown> {
  const { uiLang, ...rest } = request
  return { ...rest, ui_lang: uiLang }
}

export function mapSearchResponse(raw: unknown): SearchResult | null {
  const r = asRecord(raw)
  if (!r || !Array.isArray(r.hits)) return null
  return {
    mode: r.mode === 'keyword' ? 'keyword' : 'hybrid',
    tookMs: typeof r.took_ms === 'number' && Number.isFinite(r.took_ms) ? r.took_ms : 0,
    terms: Array.isArray(r.terms)
      ? r.terms.filter((t): t is string => typeof t === 'string' && t.length > 0).slice(0, 20).map((t) => t.slice(0, 64))
      : [],
    notice: typeof r.notice === 'string' && r.notice ? r.notice.slice(0, 300) : null,
    confidence: r.confidence === 'low' || r.confidence === 'high' ? r.confidence : null,
    langDetected: asLang(r.lang_detected),
    hits: r.hits.slice(0, MAX_K).map(mapHit).filter((h): h is SearchHit => h !== null),
  }
}

// ---- Appel HTTP vers le service (127.0.0.1:<port local>, tunnel SSH sur VM) ----

export const SEARCH_TIMEOUT_MS = 10000
export const STATUS_TIMEOUT_MS = 5000

export async function forwardToService(
  port: number,
  path: string,
  opts: { method?: 'GET' | 'POST'; body?: unknown; timeoutMs: number },
): Promise<{ ok: true; data: unknown } | ServiceError> {
  let res: Response
  try {
    res = await authFetch(`http://127.0.0.1:${port}${path}`, {
      method: opts.method ?? 'GET',
      headers: opts.body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: AbortSignal.timeout(opts.timeoutMs),
    })
  } catch (err) {
    if ((err as Error).name === 'TimeoutError') {
      return serviceError('timeout', `Pas de reponse du service apres ${Math.round(opts.timeoutMs / 1000)} s.`)
    }
    return serviceError('unreachable', 'Service injoignable (arrete, ou tunnel coupe).')
  }
  let data: unknown = null
  try {
    data = await res.json()
  } catch {
    // Corps absent ou non JSON : le statut HTTP suffit a decider.
  }
  if (!res.ok) {
    const detail = asRecord(data)?.detail
    return serviceError('http', `HTTP ${res.status}${typeof detail === 'string' ? ` : ${detail.slice(0, 200)}` : ''}`)
  }
  return { ok: true, data }
}
