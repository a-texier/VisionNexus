// ============================================================
// desktop/src/sshLauncher.ts
// Reproduit la commande de lancement de VisionNexus (AppRunner.cs,
// TryLaunch) -- meme forme, meme options -- en Node plutot qu'en C#, pour
// que ce lanceur soit un exe totalement independant (zero appel a
// VisionNexus.exe, zero code partage).
//
// OUI, Electron lance bien `python launcher.py` cote distant -- exactement
// comme VisionNexus. Ce n'est QUE le geste "ouvrir la fenetre qui affiche
// l'app ensuite" qui differe (VisionNexus s'arrete a l'ouverture d'un
// terminal, ici on va plus loin).
//
// Ports DYNAMIQUES (pas de defaut fige) : _lib/launcher_engine.py alloue les
// ports via find_free_port() sauf si --backend-port/--frontend-port sont
// passes explicitement -- et dans ce cas AUCUNE verification de collision
// n'est faite (lignes 745-747 de launcher_engine.py). Donc : ne JAMAIS forcer
// de port fixe (ça casserait le support multi-instances) -- on laisse
// launcher.py choisir, et on LIT les vrais ports qu'il annonce sur stdout :
//   [config] backend   = http://localhost:XXXX
//   [config] frontend  = http://localhost:XXXX
// exactement ce qu'un humain lirait dans le terminal VisionNexus avant
// d'ouvrir son navigateur. Une fois ces ports connus, un DEUXIEME ssh (pur
// tunnel, -N -L) est ouvert pour le forward -- on ne peut pas ajouter un -L
// a une connexion ssh deja etablie.
// ============================================================

import { spawn, ChildProcess } from 'child_process'
import * as net from 'net'
import type { LauncherSettings } from './settings'
import type { AppDef } from './catalog'
import { classifyTunnelLine } from './tunnelClassify'

export interface LaunchHandle {
  /** Process qui fait tourner `python launcher.py` (a distance ou en local). Le garder en vie = l'app reste up. */
  launchProcess: ChildProcess
  /** Process de tunnel pur (ssh -N -L), uniquement si une VM est selectionnee. */
  tunnelProcess: ChildProcess | null
}

const CONFIG_LINE_RE = {
  backend: /\[config\]\s*backend\s*=\s*http:\/\/localhost:(\d+)/i,
  // "none" : un service backend seul n'a pas de frontend (launcher_engine.py).
  frontend: /\[config\]\s*frontend\s*=\s*(?:http:\/\/localhost:(\d+)|(none))/i,
}

/** `token` : jeton de session de l'instance (_lib/session_auth.py), absent si l'auth est coupee. */
export interface AppPorts { backendPort: number; frontendPort: number; token?: string }
export interface ServicePorts { backendPort: number; frontendPort: number | null; token?: string }

// Annonces du lanceur qui portent un secret : jamais ecrites telles quelles
// dans le journal (fichier de log, panneau des lancements).
const TOKEN_LINE_RE = /^\s*\[token\]\s+(\S+)\s*$/
const AUTH_LINK_RE = /^\s*\[auth\]\s+navigateur/i

/** Version affichable d'une ligne du lanceur : le jeton et le lien d'amorcage sont masques. */
export function redactLauncherLine(line: string): string {
  if (TOKEN_LINE_RE.test(line)) return '[auth] jeton de session recu (masque)'
  if (AUTH_LINK_RE.test(line)) return '[auth] lien navigateur a usage unique emis (masque)'
  return line
}

/**
 * Accumule les lignes "[config] ..." et rend les ports des qu'ils sont tous
 * connus. `allowNoFrontend` n'est vrai que pour un service : pour une app
 * normale, "frontend = none" est ignore (on attend le vrai port, comme avant).
 * Le jeton est annonce avant les ports : il est deja la quand ils sont complets.
 */
export function createPortsCollector(allowNoFrontend: boolean): (line: string) => ServicePorts | null {
  let backendPort: number | null = null
  let frontendPort: number | null = null
  let frontendNone = false
  let token: string | undefined
  return (line) => {
    const tMatch = line.match(TOKEN_LINE_RE)
    if (tMatch) token = tMatch[1]
    const bMatch = line.match(CONFIG_LINE_RE.backend)
    if (bMatch) backendPort = parseInt(bMatch[1], 10)
    const fMatch = line.match(CONFIG_LINE_RE.frontend)
    if (fMatch) {
      if (fMatch[1]) frontendPort = parseInt(fMatch[1], 10)
      else if (allowNoFrontend) frontendNone = true
    }
    if (!backendPort || !(frontendPort || frontendNone)) return null
    return token ? { backendPort, frontendPort, token } : { backendPort, frontendPort }
  }
}

/**
 * Enleve un / ou \ final. Cosmetique/robustesse (chemin colle depuis
 * l'explorateur Windows, trailing slash sur un chemin Linux) -- N'EST PAS
 * la cause du bug "La syntaxe du nom de fichier ... est incorrecte" (cause
 * reelle : cf. windowsVerbatimArguments plus bas). Garde quand meme, evite
 * les doubles slashs dans les chemins construits.
 */
function stripTrailingSlash(p: string): string {
  return p.trim().replace(/[\\/]+$/, '')
}

/** `backendOnly` : service sans frontend (le moteur le force deja, l'option le rend explicite). */
export function launchApp(
  appDef: Pick<AppDef, 'id'>,
  settings: LauncherSettings,
  opts: { backendOnly?: boolean } = {},
): LaunchHandle {
  const username = settings.username.trim()
  const workspace = stripTrailingSlash(settings.workspace)
  const cvRoot = stripTrailingSlash(settings.cvRoot)
  const condaPath = stripTrailingSlash(settings.condaPath)
  const selectedVm = settings.selectedVm.trim()
  const nativeShareArg = settings.nativeMountHost.trim()
    ? ` --native-share-host '${settings.nativeMountHost.trim().replace(/'/g, "'\\''")}'`
    : ''
  const backendOnlyArg = opts.backendOnly ? ' --backend-only' : ''

  let launchProcess: ChildProcess
  if (selectedVm) {
    // Pas de -L ici : les vrais ports ne sont pas encore connus (allocation
    // dynamique cote launcher.py). Le tunnel est ouvert separement une fois
    // qu'on les a lus sur stdout (cf. waitForPorts + openTunnel plus bas).
    const remoteCmd = `cd '${cvRoot}' && python launcher.py --app ${appDef.id} ` +
      `--user ${username} --workspace '${workspace}' --conda-path '${condaPath}'${nativeShareArg}${backendOnlyArg}`
    launchProcess = spawn('ssh', ['-t', selectedVm, remoteCmd], { windowsHide: true })
  } else {
    const localNativeShareArg = settings.nativeMountHost.trim()
      ? ` --native-share-host "${settings.nativeMountHost.trim().replace(/"/g, '')}"`
      : ''
    const local = `cd /d "${cvRoot}" && python launcher.py --app ${appDef.id} ` +
      `--user ${username} --workspace "${workspace}" --conda-path "${condaPath}"${localNativeShareArg}${backendOnlyArg}`
    // windowsVerbatimArguments:true est OBLIGATOIRE ici. Sans lui, Node
    // ré-échappe les guillemets internes de `local` a la maniere MSVCRT
    // (\") avant de les passer a cmd.exe -- mais cmd.exe a son PROPRE
    // parseur d'arguments, incompatible, qui ne comprend pas \" comme un
    // guillemet echappe. Resultat : la ligne de commande recue par cmd.exe
    // est mal coupee et `cd /d` echoue immediatement avec "La syntaxe du
    // nom de fichier, de repertoire ou de volume est incorrecte" -- meme
    // avec un chemin 100% valide et existant (reproduit et confirme).
    // Avec verbatim:true, Node transmet `local` tel quel, sans y toucher.
    launchProcess = spawn('cmd.exe', ['/c', local], { windowsHide: true, windowsVerbatimArguments: true })
  }

  return { launchProcess, tunnelProcess: null }
}

/**
 * Ecoute stdout/stderr du process de lancement jusqu'a trouver les deux
 * lignes "[config] backend/frontend = http://localhost:PORT" que
 * launcher_engine.py imprime toujours (port fixe ou alloue dynamiquement --
 * ce sont les VRAIS ports dans les deux cas). Retourne null si rien trouve
 * avant le timeout (VM injoignable, launcher.py plante avant d'imprimer...).
 */
export function waitForPorts(
  proc: ChildProcess,
  onLine: (line: string) => void,
  timeoutMs?: number,
): Promise<AppPorts | null>
export function waitForPorts(
  proc: ChildProcess,
  onLine: (line: string) => void,
  timeoutMs: number,
  allowNoFrontend: true,
): Promise<ServicePorts | null>
export function waitForPorts(
  proc: ChildProcess,
  onLine: (line: string) => void,
  timeoutMs = 60000,
  allowNoFrontend = false,
): Promise<ServicePorts | null> {
  return new Promise((resolve) => {
    const collect = createPortsCollector(allowNoFrontend)
    let settled = false

    const finish = (result: ServicePorts | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }

    const timer = setTimeout(() => finish(null), timeoutMs)

    // Ce listener reste le SEUL relais de la sortie du lanceur pendant toute la
    // vie de l'app : il ne doit jamais s'arreter au milieu d'un paquet. L'ancien
    // `return` apres les ports jetait le reste de chaque paquet (le collecteur
    // renvoie les ports a chaque ligne une fois connus) : une trace Python
    // n'apparaissait que par sa premiere ligne (rapport 2026-09-25, Docs Assistant).
    const onData = (buf: Buffer) => {
      const text = buf.toString()
      for (const line of text.split(/\r?\n/)) {
        if (!line) continue
        onLine(redactLauncherLine(line))
        if (settled) continue
        const ports = collect(line)
        if (ports) finish(ports)
      }
    }

    proc.stdout?.on('data', onData)
    proc.stderr?.on('data', onData)
    proc.on('exit', (code) => {
      if (!settled) {
        onLine(`[launcher.py] termine prematurement (code ${code}) avant d'annoncer ses ports`)
        finish(null)
      }
    })
    proc.on('error', () => finish(null))
  })
}

/**
 * Tunnel pur (aucune commande distante) une fois les vrais ports connus.
 *
 * ExitOnForwardFailure=yes est ESSENTIEL et pas un detail de confort. Par
 * defaut, quand le port local est deja pris (tunnel orphelin d'une session
 * precedente -- typiquement apres un crash du process principal, ou une autre
 * instance de VisionNexus), ssh se contente d'ecrire "bind: Address already in
 * use" sur stderr et CONTINUE de tourner : le forward n'existe pas, mais
 * 127.0.0.1:<port> repond quand meme... via l'ANCIEN tunnel, qui pointe vers un
 * serveur distant sans rapport (souvent mort ou appartenant a une autre app).
 * L'onglet s'ouvrait donc sur un contenu incoherent alors que la meme URL
 * marchait dans un navigateur pointe directement sur la VM. Avec cette option,
 * ssh sort en erreur : on peut le detecter (cf. watchTunnel) et le dire.
 */
export function openTunnel(vm: string, backendPort: number, frontendPort: number): ChildProcess {
  return openTunnelPorts(vm, [backendPort, frontendPort])
}

/** Arguments ssh d'un tunnel pur : un `-L` par port distinct. */
export function tunnelArgs(vm: string, ports: number[]): string[] {
  return [
    '-N',
    '-o', 'ExitOnForwardFailure=yes',
    '-o', 'ServerAliveInterval=30',
    '-o', 'ServerAliveCountMax=3',
    ...[...new Set(ports)].flatMap((p) => ['-L', `${p}:localhost:${p}`]),
    vm,
  ]
}

/** Tunnel sur une liste de ports quelconque : un service n'en forwarde qu'un (backend). */
export function openTunnelPorts(vm: string, ports: number[]): ChildProcess {
  return spawn('ssh', tunnelArgs(vm, ports), { windowsHide: true })
}

/**
 * Teste si un port LOCAL est libre, en s'y liant exactement comme ssh le fera
 * (127.0.0.1, pas 0.0.0.0 : sans GatewayPorts, `-L` n'ecoute que sur la loopback,
 * donc tester 0.0.0.0 donnerait des faux positifs et des faux negatifs).
 */
function isLocalPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer()
    srv.once('error', () => resolve(false))
    srv.once('listening', () => srv.close(() => resolve(true)))
    srv.listen(port, '127.0.0.1')
  })
}

/**
 * Ports deja occupes cote Windows parmi ceux qu'on s'apprete a forwarder.
 *
 * POURQUOI en amont et pas juste en lisant l'echec de ssh : les ports sont
 * alloues par launcher_engine.py sur la VM (find_free_port), puis recopies TELS
 * QUELS en local par openTunnel. Rien ne garantit que le meme numero soit libre
 * sur le poste Windows -- un tunnel orphelin d'une session precedente, une autre
 * instance du lanceur, ou n'importe quelle appli Windows sans rapport suffit.
 * Dans ce cas ExitOnForwardFailure=yes tue ssh, et le seul symptome remonte
 * jusqu'ici etait un code de sortie nu, sans indiquer QUEL port etait en cause.
 */
export async function findBusyLocalPorts(ports: number[]): Promise<number[]> {
  const busy: number[] = []
  for (const port of new Set(ports)) {
    if (!(await isLocalPortFree(port))) busy.push(port)
  }
  return busy
}

/**
 * Surveille un tunnel fraichement ouvert : remonte la 1re ligne d'erreur ssh
 * (bind refuse, hote injoignable, cle refusee) et sa sortie prematuree. Sans
 * ca l'echec etait totalement silencieux -- le seul symptome visible etait un
 * onglet au contenu aberrant, impossible a rattacher a sa cause.
 */
export function watchTunnel(
  tunnel: ChildProcess,
  onEvent: (message: string, fatal: boolean) => void,
): void {
  let fatalReported = false
  // Dernieres lignes stderr NON reconnues (ni bruit benin, ni echec de forward
  // transitoire). Sans ce tampon, une erreur ssh dont le texte ne tombe pas dans
  // FATAL etait classee benigne, puis la sortie du process ne remontait qu'un
  // code nu ("code 4 : forward non etabli") sans jamais redire POURQUOI -- alors
  // que la cause etait juste au dessus dans le log. On la rejoue ici.
  const recent: string[] = []
  const onErrData = (buf: Buffer) => {
    for (const raw of buf.toString().split(/\r?\n/)) {
      const text = raw.trim()
      if (!text) continue
      const { benign, transient, fatal } = classifyTunnelLine(text)
      if (!benign && !transient) {
        recent.push(text)
        if (recent.length > 5) recent.shift()
      }
      if (!fatal) { onEvent(`[tunnel] ${text}`, false); continue }
      if (fatalReported) continue
      fatalReported = true
      const extra = /address already in use|cannot listen|bind:/i.test(text)
        ? " Un port local est deja pris par un tunnel orphelin (session precedente non fermee)"
          + " ou par une autre instance de VisionNexus : l'onglet afficherait le serveur de"
          + " CETTE autre session. Fermez l'autre instance ou tuez le ssh.exe restant, puis relancez."
        : ''
      onEvent(`Tunnel SSH en echec : ${text}.${extra}`, true)
    }
  }
  tunnel.stderr?.on('data', onErrData)
  tunnel.on('exit', (code) => {
    // ExitOnForwardFailure=yes : une sortie non nulle signifie que le forward
    // n'a pas pu etre etabli. Le code seul est trompeur -- ssh reserve 255 a SES
    // propres erreurs (resolution, auth, forward refuse), donc tout autre code
    // ne vient PAS du transport ssh : il est relaye par un ProxyCommand/ProxyJump
    // du ~/.ssh/config, un wrapper ssh du poste, ou une terminaison externe du
    // process. Le dire evite de chercher la panne du mauvais cote.
    if (code === 0 || code === null || fatalReported) return
    fatalReported = true
    const origin = code === 255
      ? 'erreur ssh (resolution, authentification ou forward refuse)'
      : `code inhabituel pour ssh, qui n'utilise que 255 pour ses propres erreurs :`
        + ` il vient d'un ProxyCommand/ProxyJump du ~/.ssh/config, d'un wrapper ssh`
        + ` du poste, ou d'une terminaison externe du process`
    const cause = recent.length ? ` Derniere(s) sortie(s) ssh : ${recent.join(' | ')}` : ''
    onEvent(`Tunnel SSH termine prematurement (code ${code}) : forward non etabli -- ${origin}.${cause}`, true)
  })
}

/**
 * Version de ssh reellement invoquee (celle du PATH), tracee une fois par
 * lancement. `spawn('ssh', ...)` resout par le PATH : selon le poste ca peut
 * etre l'OpenSSH de Windows, celui de Git, celui d'un outil VPN... et leurs
 * comportements sur les forwards et les codes de sortie diffèrent. Savoir
 * lequel a tourne evite de diagnostiquer sur la mauvaise implementation.
 */
export function describeSshClient(): Promise<string> {
  return new Promise((resolve) => {
    // ssh -V ecrit sa banniere sur stderr, jamais stdout.
    const proc = spawn('ssh', ['-V'], { windowsHide: true })
    let out = ''
    proc.stderr?.on('data', (b: Buffer) => { out += b.toString() })
    proc.on('error', () => resolve('ssh introuvable dans le PATH'))
    proc.on('close', () => resolve(out.trim().split(/\r?\n/)[0] || 'version ssh inconnue'))
  })
}

/**
 * Sonde http://127.0.0.1:{frontendPort} jusqu'a une reponse (ou timeout).
 *
 * `signal` (optionnel) : sans lui, un clic sur "Stop" pendant CETTE phase
 * (ports deja annonces, process deja tue par cv:stop-app) ne change RIEN a
 * cette boucle -- elle continue de retenter en aveugle, un fetch echouant
 * juste plus vite (ECONNREFUSED au lieu d'un timeout), jusqu'a epuiser tout
 * son PROPRE timeoutMs (60s par defaut) avant que l'appelant ne sache que
 * l'utilisateur a demande l'arret. Cause reelle du delai de ~1min observe
 * entre un clic Stop et le message d'erreur "Arrete par l'utilisateur" --
 * rien n'a plante, la boucle attendait juste betement sa propre fin.
 */
export async function waitUntilReady(frontendPort: number, timeoutMs = 60000, signal?: AbortSignal): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (signal?.aborted) return false
    try {
      const res = await fetch(`http://127.0.0.1:${frontendPort}`, { signal: AbortSignal.timeout(1500) })
      if (res.status < 500) return true
    } catch {
      // pas encore pret -- on reessaie
    }
    if (signal?.aborted) return false
    await new Promise((r) => setTimeout(r, 800))
  }
  return false
}

/**
 * Sonde le BACKEND (et pas seulement Vite) avant d'ouvrir l'onglet.
 *
 * Vite repond en ~800 ms ; le backend, lui, importe torch + CUDA, instancie
 * SAMService puis charge les poids XFeat -- 10 a 40 s selon la VM. Sonder le
 * seul port frontend declarait donc "Pret" bien trop tot : l'onglet s'ouvrait,
 * le frontend tirait ses requetes d'amorcage (/api/projects, /api/settings,
 * /api/workspace/info) et Vite ne pouvait que les refuser en ECONNREFUSED
 * ("[vite] http proxy error" visible dans tous les logs de lancement). Comme
 * ces appels ne sont jamais rejoues, l'app restait affichee vide -- "plus aucun
 * projet", "backend non disponible" -- alors que le backend finissait de
 * demarrer normalement 20 s plus tard.
 *
 * On tolere n'importe quelle reponse HTTP : ce qui compte est qu'uvicorn ait
 * fini son startup et accepte la connexion, pas le contenu de /health.
 */
export async function waitUntilBackendReady(
  backendPort: number,
  timeoutMs = 120000,
  signal?: AbortSignal,
  onWait?: (elapsedMs: number) => void,
): Promise<boolean> {
  const start = Date.now()
  let notified = false
  while (Date.now() - start < timeoutMs) {
    if (signal?.aborted) return false
    try {
      const res = await fetch(`http://127.0.0.1:${backendPort}/health`, { signal: AbortSignal.timeout(2000) })
      if (res.status < 500) return true
    } catch {
      // uvicorn pas encore en ecoute -- on reessaie
    }
    if (signal?.aborted) return false
    // Un seul message, apres 3 s : en dessous le backend demarre si vite que
    // l'annonce serait du bruit ; au-dela l'utilisateur doit savoir POURQUOI
    // l'onglet ne s'ouvre pas encore (chargement des modeles, pas un blocage).
    if (!notified && Date.now() - start > 3000) {
      notified = true
      onWait?.(Date.now() - start)
    }
    await new Promise((r) => setTimeout(r, 800))
  }
  return false
}
