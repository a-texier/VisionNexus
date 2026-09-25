// ============================================================
// desktop/src/imageProtocol.ts
// Protocole custom app-image:// -- coeur du plan "chemin natif" (SMB ou
// tout autre partage reseau monte, generique).
//
// URL : app-image://native/?imagePath=<url encodee>&fallback=<url encodee>
// Les DEUX urls sont FOURNIES PAR LE FRONTEND DE L'APP (deja absolues,
// deja pointees sur son propre backend -- ce module ne connait ni le nom
// de l'app, ni son port : generique par construction, n'importe quelle app
// du catalogue peut s'en servir sans que ce fichier ait besoin d'un cas
// particulier pour elle.
//
// Flux :
//   1. Si le montage natif est marque disponible (setNativeMountAvailable,
//      pilote par main.ts a partir du test cv:check-mount) : GET sur
//      `imagePath` -- petit JSON { native_path: string | null } (nom de
//      champ historique, garde tel quel cote backend -- designe le chemin
//      fichier natif quel que soit le protocole reel derriere).
//   2. Si native_path present : fs.readFile direct dessus (lecture native,
//      HORS tunnel SSH -- c'est le gain de tout ce plan).
//   3. Repli AUTOMATIQUE sur `fallback` (memes octets qu'un GET HTTP
//      classique) des qu'une etape echoue -- jamais d'image cassee.
// ============================================================

import { protocol } from 'electron'
import * as fs from 'fs/promises'
import * as path from 'path'
import { authFetch } from './sessionTokens'

const FETCH_TIMEOUT_MS = 2000
const NATIVE_READ_TIMEOUT_MS = 1500

// Cache memoire (process principal) -- INDISPENSABLE ici, pas juste une
// optimisation : protocol.handle() n'a PAS d'equivalent du cache disque HTTP
// de Chromium (verifie : Electron.Privileges n'expose aucune option "cache",
// contrairement a standard/secure/stream/codeCache). Le frontend d'Annotation
// App prefetch les frames voisines en misant sur Cache-Control + le cache
// navigateur (cf. AnnotationPage.tsx, useEffect prefetch) -- suppose vrai
// pour de vraies requetes http(s)://, FAUX pour app-image://. Sans ce cache,
// chaque prefetch ET chaque affichage reel re-declenchaient un aller-retour
// complet (JSON image-path + lecture/fetch) -- a la lecture (play) a 3+ fps,
// la file de requetes grossissait plus vite qu'elle ne se videait -> plus
// aucune image n'arrivait a temps (symptome observe : "aucune actualisation").
interface CacheEntry { buffer: Buffer; contentType: string; bytes: number }
const CACHE_MAX_BYTES = 150 * 1024 * 1024 // ~150 Mo -- large marge pour une sequence de scrub/lecture
const cache = new Map<string, CacheEntry>() // ordre d'insertion Map = ordre LRU
let cacheBytes = 0

function cacheGet(key: string): CacheEntry | undefined {
  const hit = cache.get(key)
  if (!hit) return undefined
  cache.delete(key)
  cache.set(key, hit) // le plus recemment utilise passe en fin
  return hit
}

function cacheSet(key: string, entry: CacheEntry): void {
  if (cache.has(key)) cacheBytes -= cache.get(key)!.bytes
  cache.set(key, entry)
  cacheBytes += entry.bytes
  while (cacheBytes > CACHE_MAX_BYTES && cache.size > 1) {
    const oldestKey = cache.keys().next().value
    if (oldestKey === undefined) break
    cacheBytes -= cache.get(oldestKey)!.bytes
    cache.delete(oldestKey)
  }
}

// Pilote par main.ts (resultat du dernier cv:check-mount) -- tant que ce
// n'est pas vrai, on ne tente MEME PAS le chemin natif : evite d'attendre
// un timeout par image quand on sait deja que l'hote est injoignable.
let nativeMountAvailable = false
export function setNativeMountAvailable(ok: boolean): void {
  nativeMountAvailable = ok
}
export function isNativeMountAvailable(): boolean {
  return nativeMountAvailable
}

// Log d'avertissement dedoublonne par cle (l'url imagePath elle-meme) :
// evite de spammer la console si le partage est indisponible pendant toute
// une session (repli HTTP silencieux ensuite, pas une erreur a chaque image).
const warnedOnce = new Set<string>()
function warnOnce(key: string, msg: string): void {
  if (warnedOnce.has(key)) return
  warnedOnce.add(key)
  console.warn(`[app-image] ${msg}`)
}

export type ImageTransportEvent = {
  mode: 'native' | 'http'
  nativePath: string
  reason?: string
}

let reportTransport: ((event: ImageTransportEvent) => void) | undefined
const reportedTransport = new Set<string>()

function reportDirectTransportOnce(mode: 'native' | 'http', nativePath: string, reason?: string): void {
  // Le dossier sam2_track_* identifie un run. Une ligne native et, le cas
  // echeant, une ligne de repli suffisent : jamais une ligne par frame.
  const run = nativePath.match(/sam2_track_[^\\/]+/i)?.[0] ?? nativePath
  const key = `${run}:${mode}`
  if (reportedTransport.has(key)) return
  reportedTransport.add(key)
  reportTransport?.({ mode, nativePath, reason })
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout ${ms}ms`)), ms)
    promise.then(
      (v) => { clearTimeout(t); resolve(v) },
      (e) => { clearTimeout(t); reject(e) },
    )
  })
}

const MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp', '.tif': 'image/tiff', '.tiff': 'image/tiff',
}
function guessMime(filePath: string): string {
  return MIME_BY_EXT[path.extname(filePath).toLowerCase()] ?? 'image/jpeg'
}

function toResponse(entry: CacheEntry): Response {
  return new Response(entry.buffer, { status: 200, headers: { 'Content-Type': entry.contentType } })
}

// Une reponse "provisoire" ne doit JAMAIS entrer dans le cache. Le backend
// renvoie son placeholder gris en HTTP 200 (c'est une image JPEG valide, pas
// une erreur) : sans ce garde-fou, cacheSet le stockait comme la vraie frame,
// et comme ce cache vit aussi longtemps que le process Electron, la frame
// restait grise POUR TOUJOURS -- meme une fois le backend demarre ou le
// partage source remonte. C'est ce qui donnait "plus aucune image au
// lancement, revenues seulement apres avoir relance l'app" : rien n'etait
// casse sur le disque, c'est le cache qui figeait un echec transitoire.
function isProvisional(res: Response): boolean {
  if (res.headers.get('x-frame-missing')) return true
  return (res.headers.get('cache-control') ?? '').includes('no-store')
}

async function respondFallback(fallbackUrl: string, key: string): Promise<Response> {
  try {
    const res = await authFetch(fallbackUrl)
    if (!res.ok || !res.body) return new Response('Not Found', { status: res.status || 404 })
    const buf = Buffer.from(await res.arrayBuffer())
    const contentType = res.headers.get('content-type') ?? 'image/jpeg'
    if (isProvisional(res)) {
      // Servie a l'ecran (mieux qu'une image cassee) mais pas memorisee : la
      // prochaine navigation sur cette frame retentera pour de vrai.
      warnOnce(key, `placeholder non cache (${res.headers.get('x-frame-missing') ?? 'no-store'}) pour ${key}`)
      return new Response(buf, { status: 200, headers: { 'Content-Type': contentType } })
    }
    cacheSet(key, { buffer: buf, contentType, bytes: buf.byteLength })
    return toResponse(cache.get(key)!)
  } catch (fallbackErr) {
    console.error(`[app-image] repli HTTP en echec pour ${key}:`, fallbackErr)
    return new Response('Bad Gateway', { status: 502 })
  }
}

export function registerImageProtocol(onTransport?: (event: ImageTransportEvent) => void): void {
  reportTransport = onTransport
  protocol.handle('app-image', async (request) => {
    const url = new URL(request.url)
    const imagePathUrl = url.searchParams.get('imagePath')
    const fallbackUrl = url.searchParams.get('fallback')
    // Chemin natif fourni DIRECTEMENT par l'appelant (pas a resoudre par HTTP).
    // Sert au suivi temps reel d'une propagation : le backend connait deja le
    // fichier de chaque frame et le pousse dans le message WebSocket, donc le
    // client n'a plus besoin du GET /image-path prealable. Economise une
    // requete HTTP par frame -- et surtout un des 6 creneaux de connexion par
    // origine, ceux-la memes qui entraient en concurrence avec les requetes
    // vitales (stop, annotations) pendant un run sous SSH.
    const directNativePath = url.searchParams.get('nativePath')
    if (!fallbackUrl) return new Response('Bad Request', { status: 400 })
    // Cle de cache = l'url app-image:// complete -- identique entre le
    // prefetch (new Image() en avance) et l'affichage reel de la MEME frame
    // au MEME palier (tier), donc le second hit sert instantanement, zero
    // aller-retour reseau -- exactement l'effet que le frontend attendait
    // du cache HTTP navigateur (absent pour ce protocole custom, cf. plus haut).
    const key = request.url
    const cached = cacheGet(key)
    if (cached) return toResponse(cached)

    const fetchKey = directNativePath ?? imagePathUrl ?? fallbackUrl
    // Un `nativePath` direct vient du backend Annotation App et contient deja
    // le chemin UNC exact de la frame propagee. Il doit etre tente meme si la
    // sonde SMB generique du lanceur n'a pas ete configuree ou porte un autre
    // hostname : fs.readFile est ici la verification definitive, bornee a
    // NATIVE_READ_TIMEOUT_MS puis suivie du repli HTTP. La sonde reste utile
    // pour les URLs `imagePath`, qui exigent encore une resolution HTTP.
    if ((!directNativePath && !nativeMountAvailable) || (!imagePathUrl && !directNativePath)) {
      return respondFallback(fallbackUrl, key)
    }

    try {
      let nativePath = directNativePath
      if (!nativePath) {
        const pathRes = await withTimeout(authFetch(imagePathUrl as string), FETCH_TIMEOUT_MS)
        if (!pathRes.ok) throw new Error(`image-path HTTP ${pathRes.status}`)
        const data = (await pathRes.json()) as { native_path: string | null }
        // Pas d'erreur : soit aucun partage ne couvre ce chemin, soit
        // placeholder (pas encore genere) -- repli attendu.
        if (!data.native_path) throw new Error('native_path=null')
        nativePath = data.native_path
      }

      const buffer = await withTimeout(fs.readFile(nativePath), NATIVE_READ_TIMEOUT_MS)
      const contentType = guessMime(nativePath)
      cacheSet(key, { buffer, contentType, bytes: buffer.byteLength })
      if (directNativePath) reportDirectTransportOnce('native', directNativePath)
      return toResponse(cache.get(key)!)
    } catch (err) {
      if (directNativePath) {
        reportDirectTransportOnce('http', directNativePath, (err as Error).message)
      }
      warnOnce(fetchKey, `repli HTTP (${(err as Error).message})`)
      return respondFallback(fallbackUrl, key)
    }
  })
}
