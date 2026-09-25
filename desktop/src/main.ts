// ============================================================
// desktop/src/main.ts
// Lanceur generique Computer_Vision_App -- exe independant de VisionNexus.exe
// (zero code partage, zero settings partagees -- decision explicite).
//
// Flux :
//   1. Fenetre catalogue (ui/catalog.html) -- reglages + grille d'apps.
//   2. Clic sur une app -> lancement SSH (sshLauncher.ts, reproduit la
//      commande de VisionNexus/AppRunner.cs : ssh -t <vm> "... python
//      launcher.py --app <id> ..." -- OUI, Electron lance bien launcher.py,
//      pas de raccourci) SANS ports fixes.
//   3. Lecture des VRAIS ports sur stdout ("[config] backend/frontend = ..."),
//      alloues dynamiquement par launcher_engine.py -- jamais de defaut fige.
//   4. Tunnel ouvert (2e connexion ssh, -N -L) une fois ces ports connus.
//   5. Une fois le serveur pret (polling), fenetre dediee pour l'app -- avec
//      le protocole app-image:// (chemin SMB) pour Annotation App
//      specifiquement, HTTP simple pour les autres.
// ============================================================

import { app, BrowserWindow, WebContentsView, ipcMain, protocol, session, shell, Menu, clipboard, dialog, type WebContents } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import * as fsp from 'fs/promises'
import { spawn, spawnSync, type ChildProcess } from 'child_process'
import * as net from 'net'
import { APPS, SERVICES, findApp, findService } from './catalog'
import {
  loadSettings, saveSettings, isValid, getTutorialState, setTutorialState,
  type LauncherSettings, type TutorialState,
} from './settings'
import {
  launchApp, waitForPorts, openTunnel, openTunnelPorts, watchTunnel, waitUntilReady, waitUntilBackendReady,
  findBusyLocalPorts, describeSshClient,
} from './sshLauncher'
import {
  nextServiceState, canStart, serviceGuard, serviceError, startFailureMessage, startFailureKey, validateSearchRequest, toServiceBody,
  mapSearchResponse, summarizeIndexStatus, forwardToService, SEARCH_TIMEOUT_MS, STATUS_TIMEOUT_MS,
  type ServiceState, type ServiceStatus, type StartFailure, type IndexSummary, type ServiceError, type MessageParams,
} from './services'
import { registerImageProtocol, setNativeMountAvailable } from './imageProtocol'
import {
  TOKEN_HEADER, authFetch, bootstrapUrl, forgetPorts, rememberToken, tokenForPort, tokenForUrl,
} from './sessionTokens'
import { resolveClientWorkspacePath, type WorkspacePathMapping } from './workspacePaths'
import { loadManifest, readDocDir, readDocFile, sortDocFiles, sourceBundleDir, sourceDocsPath } from './docFiles'
import type { DocSource } from './docFiles'
import type { AppDocEntry, AppDocFile } from './preloadDocs'

// Utilise par app.getPath('userData') (settings.ts) -- en dev, Electron ne
// reprend pas toujours fiablement le "name" de package.json pour ce chemin.
// Garantit %APPDATA%\VisionNexusElectron\..., un dossier DIFFERENT de
// %APPDATA%\VisionNexus\ (nom proche volontaire, donnees separees).
app.setName('VisionNexusElectron')

// Un seul lanceur a la fois : sans ce verrou, un double-clic accidentel (ou
// un raccourci + l'icone deja dans la barre des taches) ouvre une DEUXIEME
// fenetre catalogue independante, qui peut relancer la meme app par-dessus
// elle-meme (memes ports SSH/local potentiellement en collision) -- confusion
// totale entre les deux instances. requestSingleInstanceLock() echoue pour
// la 2e instance -> elle se quitte immediatement ; la 1ere est notifiee
// (second-instance) et remonte au premier plan a la place d'ouvrir quoi que
// ce soit de nouveau.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!catalogWindow) return
    if (catalogWindow.isMinimized()) catalogWindow.restore()
    if (!catalogWindow.isVisible()) catalogWindow.show()
    catalogWindow.focus()
  })
}

// Doit etre appele AVANT app.whenReady() (contrainte Electron).
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app-image',
    privileges: { standard: false, supportFetchAPI: true, corsEnabled: true, bypassCSP: true },
  },
])

let catalogWindow: BrowserWindow | null = null

// A la fermeture (croix/Alt+F4 -> window-all-closed -> app.quit() ->
// before-quit), catalogWindow n'est pas encore remis a null mais son
// webContents, lui, est deja detruit -- .send() y jette alors une exception
// synchrone ("Object has been destroyed") qui remonte comme une popup
// JavaScript error non attrapee (vu en prod : stopOrchestratorPolling(),
// appele depuis before-quit, en etait la 1ere victime). Tous les envois vers
// catalogWindow passent par ce garde plutot que par .webContents.send direct.
function safeSend(channel: string, ...args: unknown[]): void {
  if (catalogWindow && !catalogWindow.isDestroyed()) catalogWindow.webContents.send(channel, ...args)
}

// Etat de lancement transmis au catalogue pour l'indicateur par app (tuile +
// onglet de log) -- 'launching' (clic -> ports pas encore connus), 'running'
// (fenetre ouverte), 'error' (echec, avec message), 'closed' (fenetre de
// l'app fermee par l'utilisateur, process tues).
type AppRunStatus = 'launching' | 'running' | 'error' | 'closed'
function notifyStatus(appId: string, status: AppRunStatus, detail?: string): void {
  safeSend('cv:app-status', appId, status, detail ?? '')
}

// Logs COMPLETS de chaque lancement (stdout+stderr bruts de launcher.py,
// jamais tronques) -- le panneau catalogue n'affiche que les lignes recentes
// en memoire, ces fichiers restent apres fermeture de la fenetre/l'app pour
// pouvoir etre relus ou envoyes en support.
function logsDir(): string {
  const dir = path.join(app.getPath('userData'), 'logs')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

// Sans purge, un fichier .log s'accumule a CHAQUE lancement, pour toujours
// (openLogFile ci-dessous, flags 'a' mais un nouveau fichier par lancement
// via le timestamp dans son nom) -- sur des mois d'usage quotidien, ca finit
// par peser lourd sans jamais se nettoyer tout seul. Purge par age d'abord
// (14 jours -- au-dela, plus personne ne va relire un log de lancement precis),
// plus un garde-fou par nombre de fichiers (200) au cas ou l'age seul ne
// suffise pas (usage tres intensif en peu de jours).
const LOG_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000
const LOG_MAX_FILES = 200

function pruneOldLogs(): void {
  const dir = logsDir()
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  const files = entries
    .filter((e) => e.isFile() && e.name.endsWith('.log'))
    .map((e) => {
      const full = path.join(dir, e.name)
      let mtime = 0
      try { mtime = fs.statSync(full).mtimeMs } catch { /* fichier disparu entre-temps -- ignore */ }
      return { full, mtime }
    })
    .sort((a, b) => b.mtime - a.mtime) // plus recent d'abord

  const now = Date.now()
  for (const [i, f] of files.entries()) {
    const tooOld = now - f.mtime > LOG_MAX_AGE_MS
    const tooMany = i >= LOG_MAX_FILES
    if (tooOld || tooMany) {
      try { fs.unlinkSync(f.full) } catch { /* deja supprime -- ignore */ }
    }
  }
}

function openLogFile(appId: string): { stream: fs.WriteStream; filePath: string } {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const filePath = path.join(logsDir(), `${appId}_${stamp}.log`)
  const stream = fs.createWriteStream(filePath, { flags: 'a' })
  // Un flux de log ne doit JAMAIS pouvoir tuer le process principal. Sans ce
  // handler, la moindre erreur d'ecriture (disque plein, dossier de logs
  // supprime pendant la session, et surtout ERR_STREAM_WRITE_AFTER_END) remonte
  // en exception non capturee -> boite "A JavaScript error occurred in the main
  // process" et arret brutal d'Electron, donc AUCUN nettoyage : tunnels ssh et
  // sous-apps distantes restaient orphelins (constate le 2026-09-10).
  stream.on('error', (err) => {
    console.error(`[logs] ecriture impossible pour ${appId}:`, err)
  })
  return { stream, filePath }
}

// Vite/uvicorn colorent leur sortie pour un vrai terminal (codes ANSI,
// \x1b[32m...\x1b[39m) -- illisibles tels quels dans le panneau catalogue
// (rendu en texte brut) ou dans un fichier .log ouvert avec un editeur
// classique. Retire ces codes avant tout affichage/ecriture.
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]/g
function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '')
}

// Ecrit une ligne dans le panneau de logs catalogue ET dans le fichier .log
// de l'app -- utilise a la fois par le flux de lancement (cv:launch) et par
// les fermetures (closeTab, fenetre detachee fermee) : sans ca, fermer une
// app qui tournait deja (Stop, ou croix de l'onglet) ne laissait AUCUNE
// trace dans le panneau -- ca semblait juste disparaitre sans preuve d'un
// arret propre, alors que les process etaient bien tues.
function appendLog(appId: string, logStream: fs.WriteStream, line: string): void {
  const clean = stripAnsi(line)
  safeSend('cv:log', appId, clean)
  // Le flux peut deja etre ferme : un tail de log, un handler stdout ou un
  // second passage de fermeture arrivent apres logStream.end(). Ecrire dessus
  // leve ERR_STREAM_WRITE_AFTER_END -- le panneau, lui, garde la ligne.
  if (logStream.writableEnded || logStream.destroyed) return
  logStream.write(clean + '\n')
}

// IMPORTANT : p.kill() seul ne suffit PAS a arreter reellement un lancement
// local. `launchProcess` est `cmd.exe /c "cd /d ... && python launcher.py ..."`
// (sshLauncher.ts) -- tuer cmd.exe ne tue PAS ses enfants (python.exe, puis
// le process "reloader" + le vrai serveur qu'uvicorn --reload spawne lui-meme,
// plus node.exe/vite) : Windows ne les rattache pas automatiquement, ce sont
// des process orphelins qui CONTINUENT de tourner et de tenir leurs ports en
// arriere-plan, invisibles dans l'UI. `taskkill /T` tue tout l'arbre. Cote SSH
// (launchProcess distant, ou le tunnel -N -L), le process local (ssh.exe) n'a
// pas d'enfant local a se soucier -- fermer le canal SSH suffit a arreter le
// job distant (meme mecanique qu'un terminal SSH ferme), taskkill /T y est
// juste un no-op inoffensif.
function killProcessTree(p: ChildProcess): void {
  if (!p.pid || p.killed) return
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(p.pid), '/T', '/F'], { windowsHide: true })
  } else {
    p.kill()
  }
}

// Variante BLOQUANTE pour le chemin de fermeture (before-quit) : la version async
// ci-dessus (spawn fire-and-forget) etait abandonnee par app.quit() qui suit
// immediatement -- Electron sortait avant que taskkill ait tue l'arbre, laissant
// le backend + frontend d'Orchestrator (launcher.py -> uvicorn --reload -> vite)
// orphelins et tenant leurs ports (bug ferme-la-croix, 2026-08-22). spawnSync
// attend la fin de taskkill avant qu'on quitte.
function killProcessTreeSync(p: ChildProcess): void {
  if (!p.pid) return
  if (process.platform === 'win32') {
    try {
      spawnSync('taskkill', ['/pid', String(p.pid), '/T', '/F'], { windowsHide: true, timeout: 5000 })
    } catch { /* process deja mort */ }
  } else {
    try { p.kill() } catch { /* process deja mort */ }
  }
}

// ---- Ports en cours d'utilisation (panneau de debug + filet anti-orphelins) ----
// Sert a deux choses : (1) forcer la fermeture d'un port precis quand on ne
// tient PAS le process localement -- cas d'une sous-app Orchestrator, spawnee
// par SON PROPRE backend (jamais un enfant de ce process Electron), donc
// invisible a killProcessTree(Sync). Filet de securite si l'appel HTTP
// "stop-all" echoue, timeout, ou est interrompu en cours de route (avant-quit
// tue le process Orchestrator juste apres) ; (2) alimenter le panneau "Ports"
// du catalogue -- visuel debug pour reperer un process qui traine (local ou
// sur la VM), avant que ca ne s'accumule au fil des sessions multi-utilisateurs.

function runCapture(cmd: string, args: string[], timeoutMs = 8000): Promise<string> {
  return new Promise((resolve) => {
    let out = ''
    let p: ChildProcess
    try {
      p = spawn(cmd, args, { windowsHide: true })
    } catch {
      resolve('')
      return
    }
    const timer = setTimeout(() => { p.kill(); resolve(out) }, timeoutMs)
    p.stdout?.on('data', (d: Buffer) => { out += d.toString() })
    p.on('close', () => { clearTimeout(timer); resolve(out) })
    p.on('error', () => { clearTimeout(timer); resolve(out) })
  })
}

interface PortRow { port: number; pid: number; process: string; user?: string }

function parseNetstatListening(out: string): { port: number; pid: number }[] {
  const rows: { port: number; pid: number }[] = []
  for (const line of out.split(/\r?\n/)) {
    const m = line.trim().match(/^TCP\s+\S*:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i)
    if (m) rows.push({ port: parseInt(m[1], 10), pid: parseInt(m[2], 10) })
  }
  return rows
}

/** Ports TCP en ecoute sur CETTE machine Windows, avec le nom du process proprietaire. */
async function scanLocalPorts(): Promise<PortRow[]> {
  const [netstatOut, tasklistOut] = await Promise.all([
    runCapture('netstat', ['-ano', '-p', 'TCP']),
    runCapture('tasklist', ['/fo', 'csv', '/nh']),
  ])
  const nameByPid = new Map<number, string>()
  for (const line of tasklistOut.split(/\r?\n/)) {
    const cols = line.split('","').map((c) => c.replace(/(^"|"$)/g, ''))
    const pid = parseInt(cols[1], 10)
    if (cols[0] && !Number.isNaN(pid)) nameByPid.set(pid, cols[0])
  }
  return parseNetstatListening(netstatOut).map(({ port, pid }) => ({
    port, pid, process: nameByPid.get(pid) ?? `pid ${pid}`,
  }))
}

/** Meme chose sur une VM Linux -- `ss` est present par defaut sur toute distro recente.
 * Un seul aller-retour SSH fait aussi le lien pid -> utilisateur systeme (`ps`) : sur une
 * VM partagee entre plusieurs personnes, savoir QUI a un port ouvert est ce qui compte le
 * plus pour reperer un process a soi vs. celui d'un collegue avant de le tuer. */
// Dernier registre lu sur la VM -- rempli par scanRemotePorts, consomme par
// cv:scan-ports juste apres (meme tick, pas de peremption a gerer).
let remoteRegistryPorts: RegistryPort[] = []

async function scanRemotePorts(vm: string): Promise<PortRow[]> {
  const marker = '###PS###'
  const regMarker = '###REG###'
  // Le registre partage de la VM voyage dans le MEME aller-retour : c'est lui
  // qui permet d'attribuer un port a une app apres la fermeture de son lanceur
  // (cf. localRegistryPorts pour l'equivalent local).
  const cvRoot = loadSettings().cvRoot.trim().replace(/\/+$/, '')
  const regCat = cvRoot ? `cat '${cvRoot}/.run/.instances.json' 2>/dev/null` : 'true'
  const script = `ss -H -tlnp 2>/dev/null; printf '\\n%s\\n' '${marker}'; ps -eo pid=,user= 2>/dev/null; printf '\\n%s\\n' '${regMarker}'; ${regCat}`
  // BatchMode : jamais d'invite interactive (mot de passe / confirmation de
  // cle) -- une invite bloquerait le scan jusqu'au timeout en laissant un
  // ssh.exe suspendu a chaque tick. ConnectTimeout borne le handshake pour
  // que l'echec soit franc et rapide plutot qu'un blocage silencieux.
  const out = await runCapture(
    'ssh',
    ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', vm, script],
    8000,
  )
  const [ssOut, rest] = out.split(marker)
  const [psOut, regOut] = (rest ?? '').split(regMarker)
  const userByPid = new Map<number, string>()
  for (const line of (psOut ?? '').split(/\r?\n/)) {
    const m = line.trim().match(/^(\d+)\s+(\S+)$/)
    if (m) userByPid.set(parseInt(m[1], 10), m[2])
  }
  // ps vide = sortie tronquee : on ne filtre pas plutot que de tout effacer.
  const remoteAlive = userByPid.size ? (pid: number) => userByPid.has(pid) : undefined
  remoteRegistryPorts = registryPorts(parseInstancesRegistry(regOut ?? '', remoteAlive), ', registre VM')
  const rows: PortRow[] = []
  for (const line of (ssOut ?? '').split(/\r?\n/)) {
    const addrMatch = line.match(/(?:\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}|\[?::\]?|\*):(\d+)\s/)
    if (!addrMatch) continue
    const procMatch = line.match(/users:\(\("([^"]+)",pid=(\d+)/)
    const pid = procMatch ? parseInt(procMatch[2], 10) : 0
    rows.push({
      port: parseInt(addrMatch[1], 10),
      pid,
      process: procMatch ? procMatch[1] : '? (droits insuffisants sur la VM)',
      user: pid ? userByPid.get(pid) : undefined,
    })
  }
  return rows
}

/**
 * Instances declarees dans le registre partage du repo
 * (Computer_Vision_App/.run/.instances.json), alimente par tous les
 * launcher.py ET, depuis maintenant, par l'orchestrateur.
 *
 * C'est la seule source qui survit a la mort de son lanceur : quand on ferme
 * l'onglet Orchestrator, `lastSubApps` est vide et `dockedTabs` aussi, donc
 * tout process encore debout apparaissait en "a verifier" sans qu'on puisse
 * dire a QUELLE app il appartenait. Le registre, lui, garde app + user +
 * workspace tant que le process proprietaire vit.
 */
interface RegistryInstance {
  key?: string; app?: string; user?: string; pid?: number
  backend_port?: number; frontend_port?: number; workspace?: string
}
/** `isAlive` ecarte les entrees dont le lanceur est mort : le fichier n'est
 * nettoye que par launcher.py, et une entree perimee etiquetait "app active"
 * n'importe quel process qui reprenait le port. */
function parseInstancesRegistry(raw: string, isAlive?: (pid: number) => boolean): RegistryInstance[] {
  try {
    const data = JSON.parse(raw) as unknown
    const entries = Array.isArray(data) ? data as RegistryInstance[] : []
    return isAlive ? entries.filter((e) => !e.pid || isAlive(e.pid)) : entries
  } catch { return [] }
}
interface RegistryPort { port: number; label: string; user?: string }
function registryPorts(entries: RegistryInstance[], suffix: string): RegistryPort[] {
  const out: RegistryPort[] = []
  for (const e of entries) {
    const who = e.user ? `${e.app ?? '?'} - ${e.user}` : (e.app ?? '?')
    if (e.frontend_port) out.push({ port: e.frontend_port, label: `${who} (frontend${suffix})`, user: e.user })
    if (e.backend_port) out.push({ port: e.backend_port, label: `${who} (backend${suffix})`, user: e.user })
  }
  return out
}
function localPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    // EPERM = le process existe mais appartient a quelqu'un d'autre.
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}
function localRegistryPorts(): { port: number; label: string }[] {
  const cvRoot = loadSettings().cvRoot.trim()
  if (!cvRoot) return []
  try {
    return registryPorts(
      parseInstancesRegistry(fs.readFileSync(path.join(cvRoot, '.run', '.instances.json'), 'utf-8'), localPidAlive),
      ', registre',
    )
  } catch { return [] }   // fichier absent = aucune instance enregistree
}

/** Libelle de chaque port qu'on SAIT legitime -- tout le reste affiche dans le
 * panneau "Ports" sans correspondance ici est suspect (orphelin potentiel). */
function knownPorts(): { port: number; label: string }[] {
  const out: { port: number; label: string }[] = []
  for (const tab of dockedTabs.values()) {
    out.push({ port: tab.frontendPort, label: `${tab.label} (frontend)` })
    if (tab.backendPort) out.push({ port: tab.backendPort, label: `${tab.label} (backend)` })
  }
  for (const tab of detachedTabs.values()) {
    out.push({ port: tab.frontendPort, label: `${tab.label} (frontend, detache)` })
    if (tab.backendPort) out.push({ port: tab.backendPort, label: `${tab.label} (backend, detache)` })
  }
  for (const h of services.values()) {
    if (h.port) out.push({ port: h.port, label: `${findService(h.id)?.label ?? h.id} (backend, service)` })
  }
  for (const info of Object.values(lastSubApps)) {
    const fp = portFromUrl(info.frontend_url)
    const bp = portFromUrl(info.backend_url)
    if (fp) out.push({ port: fp, label: `${info.label} (frontend, Orchestrator)` })
    if (bp) out.push({ port: bp, label: `${info.label} (backend, Orchestrator)` })
  }
  // En dernier : nos onglets vivants ont la priorite sur l'entree de registre
  // du meme port (libelle plus precis), mais le registre rattrape tout ce que
  // nous ne pilotons plus -- typiquement les sous-apps d'un Orchestrator ferme.
  out.push(...localRegistryPorts())
  return out
}

/** Resultat d'un kill par port : `failed` = ports encore en ecoute apres coup. */
interface KillResult { ok: boolean; failed: number[]; error?: string }

/** Comme runCapture, mais garde stderr et le code de sortie : un kill qui
 * echoue doit pouvoir le dire au lieu de ressembler a un kill qui a marche. */
function runDetailed(cmd: string, args: string[], timeoutMs: number): Promise<{ out: string; err: string; code: number | null }> {
  return new Promise((resolve) => {
    let out = ''
    let err = ''
    let p: ChildProcess
    try {
      p = spawn(cmd, args, { windowsHide: true })
    } catch (e) {
      resolve({ out, err: String(e), code: null })
      return
    }
    const timer = setTimeout(() => { p.kill(); resolve({ out, err: err || 'timeout', code: null }) }, timeoutMs)
    p.stdout?.on('data', (d: Buffer) => { out += d.toString() })
    p.stderr?.on('data', (d: Buffer) => { err += d.toString() })
    p.on('close', (code) => { clearTimeout(timer); resolve({ out, err, code }) })
    p.on('error', (e) => { clearTimeout(timer); resolve({ out, err: String(e), code: null }) })
  })
}

async function killPortsLocal(ports: number[]): Promise<KillResult> {
  if (!ports.length) return { ok: true, failed: [] }
  const wanted = new Set(ports)
  const before = parseNetstatListening(await runCapture('netstat', ['-ano', '-p', 'TCP']))
  const pids = new Set(before.filter((r) => wanted.has(r.port) && r.pid > 0).map((r) => r.pid))
  const errors: string[] = []
  for (const pid of pids) {
    const r = await runDetailed('taskkill', ['/F', '/T', '/PID', String(pid)], 8000)
    // 128 = process deja mort entre netstat et taskkill : pas une erreur.
    if (r.code !== 0 && r.code !== 128) errors.push(`pid ${pid} : ${r.err.trim() || `code ${r.code}`}`)
  }
  const after = parseNetstatListening(await runCapture('netstat', ['-ano', '-p', 'TCP']))
  const failed = [...new Set(after.filter((r) => wanted.has(r.port)).map((r) => r.port))]
  return {
    ok: failed.length === 0,
    failed,
    error: failed.length ? (errors.join(' ; ') || 'port toujours en ecoute') : undefined,
  }
}

function killPortLocal(port: number): Promise<KillResult> {
  return killPortsLocal([port])
}

/**
 * Tue le process qui tient le port ET tout son groupe.
 *
 * L'ancienne version faisait `fuser -k` + `kill -9 <pid du listener>`, ce qui
 * ne tue QUE le process ayant ouvert la socket. Or une sous-app, c'est un
 * arbre : `npm run dev` -> `node vite` (seul a tenir le port) -> service
 * esbuild ; et cote Python, un uvicorn --reload a un parent reloader qui ne
 * tient pas le port non plus (et qui peut meme respawner un worker apres coup).
 * Resultat : des node/python orphelins survivaient a chaque fermeture.
 *
 * Les sous-apps etant lancees avec start_new_session (app_launcher.py,
 * launcher_engine.py), chacune est leader de sa propre session : son pgid
 * designe exactement son arbre, rien d'autre. On refuse quand meme de tirer
 * sur le groupe 1 ou sur notre propre groupe ssh -- une garde peu couteuse
 * contre un process qui n'aurait pas ete isole.
 *
 * SIGTERM d'abord (uvicorn et vite le gerent proprement), SIGKILL ensuite pour
 * ceux qui l'ignorent.
 *
 * Le pid vient de `ss -tlnp` (celui-la meme qui alimente le panneau) : lsof et
 * fuser manquent sur bien des VM, et l'ancienne version, qui ne comptait que
 * sur eux, ne tuait alors rien sans le dire (rapport 2026-09-24). Tous les
 * ports passent dans UNE session ssh (MaxStartups du serveur), et on termine
 * par une verification : un port encore en ecoute remonte en echec.
 */
async function killPortsRemote(vm: string, ports: number[]): Promise<KillResult> {
  if (!ports.length) return { ok: true, failed: [] }
  const list = ports.join(' ')
  const cmd = [
    `mypgid=$(ps -o pgid= -p $$ 2>/dev/null | tr -d " ")`,
    `all=""`,
    `for port in ${list}; do`,
    `  pids=$(ss -H -tlnp "sport = :$port" 2>/dev/null | grep -o "pid=[0-9]*" | cut -d= -f2 | sort -u)`,
    `  [ -z "$pids" ] && pids=$(lsof -ti:$port 2>/dev/null)`,
    `  [ -z "$pids" ] && pids=$(fuser $port/tcp 2>/dev/null | tr -d " ")`,
    `  all="$all $pids"`,
    `done`,
    `groups=""`,
    `for pid in $all; do`,
    `  pgid=$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d " ")`,
    `  if [ -n "$pgid" ] && [ "$pgid" != "1" ] && [ "$pgid" != "$mypgid" ]; then`,
    `    groups="$groups $pgid"`,
    `  else`,
    `    kill -TERM "$pid" 2>/dev/null`,
    `  fi`,
    `done`,
    `for g in $groups; do kill -TERM -"$g" 2>/dev/null; done`,
    `[ -n "$all" ] && sleep 1`,
    `for g in $groups; do kill -KILL -"$g" 2>/dev/null; done`,
    `for pid in $all; do kill -KILL "$pid" 2>/dev/null; done`,
    `sleep 0.3`,
    `for port in ${list}; do`,
    `  [ -n "$(ss -H -tln "sport = :$port" 2>/dev/null)" ] && echo "STILL $port"`,
    `done`,
    `echo "###DONE###"`,
  ].join('\n')
  // BatchMode/ConnectTimeout comme le scan : sans eux, une invite ssh
  // bloquait le kill jusqu'au timeout, bouton "Tuer" qui tourne dans le vide.
  const r = await runDetailed('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', vm, cmd], 20000)
  if (!r.out.includes('###DONE###')) {
    return { ok: false, failed: ports, error: `ssh ${vm} : ${r.err.trim() || 'pas de reponse'}` }
  }
  const failed = [...r.out.matchAll(/^STILL (\d+)/gm)].map((m) => parseInt(m[1], 10))
  return {
    ok: failed.length === 0,
    failed,
    error: failed.length
      ? 'port toujours en ecoute (process d\'un autre utilisateur, ou relance par son parent)'
      : undefined,
  }
}

function killPortRemote(vm: string, port: number): Promise<KillResult> {
  return killPortsRemote(vm, [port])
}

/**
 * Filet "Nettoyer la VM" : tue les node/python de NOTRE user qui tournent
 * dans la racine Computer_Vision_App ET dont la ligne de commande est celle
 * d'un serveur de la suite (vite, uvicorn, launcher.py, esbuild, workers
 * multiprocessing). On filtre sur le dossier de travail parce qu'uvicorn est
 * lance en `python -m uvicorn` : sa ligne de commande ne contient pas le
 * chemin du repo. La double condition epargne VS Code Remote (tsserver,
 * extension host), meme ouvert sur le repo, et Jupyter.
 */
async function cleanupRemoteSuite(vm: string, cvRoot: string): Promise<{ ok: boolean; killed: number; error?: string }> {
  const root = cvRoot.trim().replace(/\/+$/, '')
  if (!root) return { ok: false, killed: 0, error: 'Racine Computer_Vision_App non configuree' }
  const q = `'${root.replace(/'/g, `'\\''`)}'`
  const cmd = [
    `list=""`,
    `for pid in $(pgrep -u "$(id -u)" '^(node|python[0-9.]*|esbuild)$'); do`,
    `  cwd=$(readlink /proc/$pid/cwd 2>/dev/null)`,
    `  case "$cwd" in ${q}|${q}/*) ;; *) continue ;; esac`,
    `  tr '\\0' ' ' < /proc/$pid/cmdline 2>/dev/null | grep -qE 'vite|uvicorn|launcher\\.py|esbuild|multiprocessing' && list="$list $pid"`,
    `done`,
    `n=$(echo $list | wc -w)`,
    `if [ "$n" -gt 0 ]; then kill -TERM $list 2>/dev/null; sleep 2; kill -KILL $list 2>/dev/null; fi`,
    `echo "KILLED $n"`,
  ].join('\n')
  const r = await runDetailed('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', vm, cmd], 20000)
  const m = r.out.match(/KILLED (\d+)/)
  if (!m) return { ok: false, killed: 0, error: `ssh ${vm} : ${r.err.trim() || 'pas de reponse'}` }
  return { ok: true, killed: parseInt(m[1], 10) }
}

// ---- Partage reseau natif (generique, sans nom d'hote impose) ----
// Racines de partage connues -- reprises de la valeur par defaut deja
// utilisee cote backend Annotation App (utils/native_share.py: shared_roots).
// NE SERT PLUS A DECIDER joignable/injoignable (cf. checkNativeMount) --
// un partage reel est souvent nomme d'apres un sous-dossier (ex: un serveur
// expose /home/<partage> sous \\<share-host>\<partage>, jamais sous un
// partage litteralement appele "home"), donc ces noms generiques ne
// matchent quasiment jamais. Garde uniquement pour peupler l'affichage
// "shares" en best-effort quand l'enumeration de \\host\ est autorisee.
const KNOWN_SHARE_ROOTS = ['home', 'mnt', 'srv', 'media', 'data']

const SMB_PORT = 445
function probeSmbPort(host: string, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port: SMB_PORT, timeout: ms })
    const done = (ok: boolean) => { socket.destroy(); resolve(ok) }
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
  })
}

// Dernier resultat connu du test de joignabilite -- lu par nativeBadgeStatus()
// et par imageProtocol.ts (setNativeMountAvailable) sans re-tester a chaque
// requete image (couteux, inutile : le reseau ne change pas frame par frame).
let lastMountCheck: { host: string; ok: boolean; shares: string[] } = { host: '', ok: false, shares: [] }

async function refreshMountStatus(host: string): Promise<{ ok: boolean; shares: string[]; error?: string }> {
  const result = await checkNativeMount(host)
  lastMountCheck = { host: host.trim(), ok: result.ok, shares: result.shares }
  setNativeMountAvailable(result.ok)
  return result
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout ${ms}ms`)), ms)
    p.then((v) => { clearTimeout(t); resolve(v) }, (e) => { clearTimeout(t); reject(e) })
  })
}

// Etat transmis a la fenetre de l'app pour le badge "Natif" / "HTTP (repli)"
// -- cf. preloadApp.ts, qui l'injecte dans la top bar sans toucher au code
// React de l'app elle-meme (generique, marche pour n'importe quelle app).
export interface NativeBadgeStatus {
  supported: boolean   // cette app sait construire un chemin natif (catalog.ts)
  active: boolean      // ET le montage est configure + joignable a cet instant
  reason: string        // libelle court affiche en tooltip
}

// isLocal (pas de VM selectionnee) : le backend tourne sur la MEME machine
// Windows que ce lanceur -- to_native_share_path() (backend/utils/native_share.py, chaque
// app) detecte que le chemin est deja natif (C:\...) et le renvoie tel quel,
// AUCUN hote SMB requis. Sans ce cas particulier, une session locale restait
// bloquee en HTTP faute d'hote configure -- le pire cas, alors que c'est
// justement celui ou le chemin natif est le plus simple (lecture disque
// directe, zero reseau, meme pas de tunnel a traverser).
function nativeBadgeStatus(appId: string, isLocal: boolean): NativeBadgeStatus {
  const supported = !!findApp(appId)?.supportsNativeMount
  if (!supported) return { supported, active: false, reason: 'Cette app ne gere pas encore le chemin natif' }
  if (isLocal) return { supported, active: true, reason: 'Lancement local -- lecture disque directe, aucun reseau' }
  if (!lastMountCheck.host) return { supported, active: false, reason: 'Aucun hote de partage reseau configure (Parametres)' }
  if (!lastMountCheck.ok) return { supported, active: false, reason: `Hote "${lastMountCheck.host}" injoignable -- repli HTTP` }
  return { supported, active: true, reason: `Chemin natif actif via "${lastMountCheck.host}"` }
}

async function checkNativeMount(host: string): Promise<{ ok: boolean; shares: string[]; error?: string }> {
  const h = host.trim()
  if (!h) return { ok: false, shares: [], error: 'Aucun hote configure' }
  const base = `\\\\${h}\\`

  // Joignabilite REELLE = le port SMB (445) repond. Ne depend d'aucun nom de
  // partage devine -- indispensable des que les partages ne portent pas les
  // noms generiques de KNOWN_SHARE_ROOTS (cas courant : /home/<partage>
  // cote VM est expose sous \\<share-host>\<partage>, jamais sous un partage
  // appele "home"). L'enumeration \\host\ (ci-dessous) reste tentee en plus,
  // en best-effort, seulement pour peupler l'affichage -- mais son echec ou
  // sa reussite a vide (partages non listables, tres courant en SMB/NAS) ne
  // doit plus jamais faire echouer le test : le port ouvert est la seule
  // preuve fiable. La vraie lecture, elle, se fait chemin par chemin dans
  // imageProtocol.ts (fs.readFile) et retombe sur HTTP au cas par cas si un
  // chemin precis s'avere finalement inaccessible.
  const reachable = await probeSmbPort(h, 3000)
  if (!reachable) {
    return { ok: false, shares: [], error: `Port SMB ${SMB_PORT} injoignable sur "${h}" (verifie le nom, le VPN/reseau)` }
  }

  try {
    const entries = await withTimeout(fsp.readdir(base), 2000)
    return { ok: true, shares: entries }
  } catch {
    // Enumeration refusee/non supportee -- sans importance, le port repond.
  }
  const found: string[] = []
  await Promise.all(KNOWN_SHARE_ROOTS.map(async (root) => {
    try {
      await withTimeout(fsp.access(base + root), 2000)
      found.push(root)
    } catch {
      // ni generique ni dans la liste fournie -- normal, ignore.
    }
  }))
  return { ok: true, shares: found }
}

// ui/ et assets/ vivent a cote de dist/ en dev (electron .), mais sont copies
// dans resourcesPath/ une fois empaquete (electron-builder, extraResources) --
// __dirname pointe alors dans l'asar, ".." n'y mene plus au bon endroit.
const resourceBase = app.isPackaged ? process.resourcesPath : path.join(__dirname, '..')

function createCatalogWindow(): void {
  catalogWindow = new BrowserWindow({
    width: 1260,
    height: 720,
    minWidth: 980,
    minHeight: 560,
    title: 'VisionNexus',
    icon: path.join(resourceBase, 'assets', 'app.ico'),
    backgroundColor: '#0a0e14',
    // Barre de titre native Windows = toujours blanche/claire, aucune prise
    // CSS dessus (rendue par l'OS, pas par Chromium) -- 'hidden' + un overlay
    // colore la remplace par les VRAIS boutons systeme (min/max/close, snap
    // layouts inclus) mais peints dans notre theme sombre. Le reste de la
    // bande (logo/menu/onglets) devient un vrai contenu HTML -- catalog.html
    // le rend draggable via -webkit-app-region:drag sur <header>. Seulement
    // sur Windows : les fenetres detachees (detachTab plus bas) affichent le
    // contenu BRUT d'une autre app React (Annotation App, etc.) qu'on ne
    // maitrise pas -- lui appliquer 'hidden' la rendrait indeplaçable (aucune
    // zone drag definie dans son propre HTML), donc volontairement laissees
    // avec la barre native standard.
    ...(process.platform === 'win32'
      ? { titleBarStyle: 'hidden' as const, titleBarOverlay: { color: '#0a0e14', symbolColor: '#dbe4f0', height: 36 } }
      : {}),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preloadCatalog.js'),
    },
  })
  void catalogWindow.loadFile(path.join(resourceBase, 'ui', 'catalog.html'))
}

// ---- Apps ouvertes "en onglet" dans la fenetre catalogue ----
// Chaque app lancee devient un WebContentsView (pas une BrowserWindow tant
// qu'elle est "dockee") -- une seule fenetre OS (catalogWindow), plusieurs
// vues empilees dedans, une seule affichee a la fois (bounds pleine
// grandeur = active, retiree du contentView = masquee). L'onglet "VisionNexus"
// (accueil) n'est PAS une vue : c'est simplement l'etat "aucune vue active",
// qui laisse voir le contenu propre de catalog.html (#body) en dessous.
interface DockedTab {
  appId: string
  label: string
  icon: string
  view: InstanceType<typeof WebContentsView>
  procs: ChildProcess[]
  logStream: fs.WriteStream
  nativeStatus: NativeBadgeStatus
  frontendPort: number
  backendPort?: number
}
const dockedTabs = new Map<string, DockedTab>()
// Onglets detaches (glisses hors de la barre) -- fenetre OS separee, mais
// encore "connus" du lanceur (process/log toujours suivis) pour pouvoir les
// re-docker. Un onglet qui n'est ni dans dockedTabs ni dans detachedTabs
// n'existe plus (ferme, process tues).
interface DetachedTab extends DockedTab { win: BrowserWindow }
const detachedTabs = new Map<string, DetachedTab>()
// Process en vol pendant la phase 'launching' (avant que createAppTab() ne
// les transfere dans dockedTabs) -- permet au bouton "Stop" du panneau de
// logs de tuer un lancement AVANT que la fenetre de l'app n'existe meme.
// Vide des que le lancement finit (succes -> dockedTabs, echec -> deja
// nettoye par le handler cv:launch lui-meme).
const launchingProcs = new Map<string, ChildProcess[]>()
// Marque un appId dont l'utilisateur a explicitement demande l'arret pendant
// la phase 'launching' -- distingue "j'ai clique Stop" (statut 'closed') de
// "launcher.py a vraiment plante avant d'annoncer ses ports" (statut 'error'),
// deux causes bien differentes qui aboutissent au meme symptome technique
// (le process meurt avant waitForPorts).
const userStoppedLaunch = new Set<string>()
// Signal d'annulation de la phase waitUntilReady (cf. sshLauncher.ts) -- sans
// ca, "Stop" pendant cette phase precise tuait bien le process mais laissait
// la boucle de sonde tourner en aveugle jusqu'a SON propre timeout (60s),
// d'ou le delai avant "Arrete par l'utilisateur" observe cote UI.
const launchAbort = new Map<string, AbortController>()

// ---- Sous-apps lancees DEPUIS Orchestrator App (bandeau deroulant) ----
// Orchestrator lance ses sous-apps lui-meme (backend/core/app_launcher.py,
// subprocess.Popen cote VM/local), completement HORS de notre launchApp()/SSH
// habituel -- on n'a jamais demande ces process, jamais ouvert de tunnel pour
// leurs ports. Orchestrator expose deja GET /api/apps (backend/api/
// launcher_api.py) qui liste chaque sous-app connue avec son frontend_url --
// on interroge CET endpoint (sur le backend d'Orchestrator, deja tunnelise
// comme n'importe quel autre lancement) pendant que son onglet est ouvert,
// pour peupler le bandeau. Un seul Orchestrator peut tourner a la fois (cf.
// garde dockedTabs.has() dans cv:launch) -- pas besoin de Map, une variable
// suffit.
interface OrchestratorSubAppInfo {
  app_id: string
  label: string
  launched: boolean
  status: string
  backend_url: string | null
  frontend_url: string | null
  backend_log: string | null
  frontend_log: string | null
  /** Jeton de session de la sous-app (relu par Orchestrator dans le fichier prive de l'utilisateur). */
  session_token?: string | null
}
// Dernier probleme de tunnel SSH par onglet (cle = appId / tabId). Rempli par
// watchTunnel ; consulte juste avant d'ouvrir la vue : mieux vaut refuser
// l'onglet avec un message clair que l'ouvrir sur le serveur de quelqu'un
// d'autre (port local capte par un tunnel orphelin).
const tunnelProblems = new Map<string, string>()

// Tails actifs (fichier log de sous-app -> panneau log de l'onglet). Cle = tabId
// orch_. Arretes a la fermeture de l'onglet.
const subAppLogTails = new Map<string, () => void>()

/** Tail simple d'un fichier: relit les octets ajoutes toutes les 1s et les
 *  pousse dans le logStream de l'onglet. Renvoie une fonction d'arret. */
function tailFileInto(filePath: string, tabId: string, logStream: fs.WriteStream): () => void {
  let pos = 0
  let stopped = false
  const tick = () => {
    if (stopped) return
    fs.stat(filePath, (err, st) => {
      if (err || stopped) return
      if (st.size < pos) pos = 0        // fichier tronque/recree
      if (st.size <= pos) return
      const stream = fs.createReadStream(filePath, { start: pos, end: st.size - 1, encoding: 'utf8' })
      let buf = ''
      stream.on('data', (d) => { buf += d })
      stream.on('end', () => {
        pos = st.size
        for (const line of buf.split(/\r?\n/)) {
          if (line.trim()) appendLog(tabId, logStream, line)
        }
      })
      stream.on('error', () => { /* fichier temporairement verrouille */ })
    })
  }
  const timer = setInterval(tick, 1000)
  tick()
  return () => { stopped = true; clearInterval(timer) }
}
let orchestratorInfo: { backendPort: number; isLocal: boolean; vm: string } | null = null
let orchestratorPollTimer: ReturnType<typeof setInterval> | null = null
// Dernier etat connu -- pas que pousse au renderer, aussi lu par
// cv:open-orchestrator-subapp pour savoir sur quel port ouvrir le tunnel.
let lastSubApps: Record<string, OrchestratorSubAppInfo> = {}
// Sous-apps deja ouvertes ICI via le bandeau -- prefixees pour ne jamais
// entrer en collision avec un lancement standalone du meme catalog id (ex.
// "annotation" lancee normalement ET via Orchestrator en meme temps).
// PAS de ":" -- ce prefixe sert aussi de base au nom de fichier .log
// (openLogFile plus bas), et ":" est un caractere interdit dans un chemin
// Windows (reserve aux lettres de lecteur -- C:\...).
const ORCH_TAB_PREFIX = 'orch_'

function portFromUrl(url: string | null): number | null {
  if (!url) return null
  // Ancre sur ":port" suivi de fin de chaine, "/", "?" ou "#" -- PAS juste
  // fin de chaine ($) : le port choisi ici doit matcher aussi bien
  // "http://localhost:5174" (format stocke cote session Orchestrator) que
  // "http://localhost:5174/" (Vite/le lien reellement ouvert par la page,
  // avec un slash final) -- l'ancien /:(\d+)$/ ratait ce 2e cas et cassait
  // silencieusement toute la correspondance port -> sous-app.
  const m = url.match(/:(\d+)(?:[/?#]|$)/)
  return m ? parseInt(m[1], 10) : null
}

let orchestratorPollInFlight = false

async function pollOrchestratorSubApps(): Promise<void> {
  if (!orchestratorInfo || orchestratorPollInFlight) return
  orchestratorPollInFlight = true
  try {
    // Timeout < intervalle du setInterval (1s, cf. site d'appel) : sur VM/SSH
    // une reponse peut mettre plus d'1s, le flag ci-dessus evite alors
    // d'empiler des requetes concurrentes plutot que de les enchainer.
    const res = await authFetch(`http://127.0.0.1:${orchestratorInfo.backendPort}/api/apps`, { signal: AbortSignal.timeout(3000) })
    if (!res.ok) return
    const data = await res.json() as Record<string, OrchestratorSubAppInfo>
    lastSubApps = data
    for (const info of Object.values(data)) {
      const backendPort = portFromUrl(info.backend_url)
      if (!info.session_token || !backendPort || tokenForPort(backendPort) === info.session_token) continue
      rememberToken(info.session_token, backendPort, portFromUrl(info.frontend_url))
      void setSessionCookie(backendPort, info.session_token)
    }
    // Le jeton ne part pas au renderer : il n'en a pas besoin, l'injection se fait ici.
    safeSend('cv:orchestrator-subapps', Object.values(data).map(({ session_token: _t, ...rest }) => rest))
  } catch {
    // Orchestrator pas encore pret / VM temporairement injoignable -- retente au prochain tick, silencieux.
  } finally {
    orchestratorPollInFlight = false
  }
}

// Orchestrator lance ses propres sous-apps (Orchestrator_App/backend/core/
// app_launcher.py) avec CREATE_NEW_PROCESS_GROUP sur Windows -- volontaire,
// pour qu'elles survivent a un reload d'Orchestrator -- mais ca les rend
// aussi PAS TOUJOURS atteignables de facon fiable par un taskkill /T lance
// depuis notre cote sur le process racine d'Orchestrator (constate : explorer
// BDD App restait en vie apres fermeture complete de VisionNexus). Seul
// Orchestrator connait les vrais PID de ce qu'il a lui-meme lance -- on lui
// demande donc de les arreter proprement en 1er, via son propre endpoint,
// AVANT de tuer son arbre de process. Best-effort, timeout court : ne doit
// jamais bloquer indefiniment une fermeture si son backend ne repond plus.
async function stopAllOrchestratorSubApps(): Promise<void> {
  if (!orchestratorInfo) return
  const info = orchestratorInfo
  // Snapshot AVANT l'appel (et avant que stopOrchestratorPolling() ne vide
  // lastSubApps juste apres) -- sinon plus aucun moyen de savoir quels ports
  // forcer si le fetch echoue ou que la boucle serveur n'a pas fini a temps.
  const ports = Object.values(lastSubApps)
    .flatMap((a) => [portFromUrl(a.backend_url), portFromUrl(a.frontend_url)])
    .filter((p): p is number => p !== null)
  try {
    // stop-all (Orchestrator_App/backend/api/launcher_api.py) tue chaque
    // sous-app en SEQUENCE (taskkill/killpg synchrone par app_id) -- generuex
    // exprès (15s) pour laisser le temps a plusieurs sous-apps lourdes de
    // finir avant qu'on abandonne. Un timeout trop court ici tuait avant
    // avant-quit le process Orchestrator EN PLEIN MILIEU de cette boucle
    // (killProcessTreeSync juste apres), abandonnant toute sous-app pas
    // encore atteinte -- orpheline pour toujours (node.exe constate le
    // 2026-08-23). Le filet de securite par port ci-dessous couvre le reste.
    await authFetch(`http://127.0.0.1:${info.backendPort}/api/apps/stop-all`, {
      method: 'POST',
      signal: AbortSignal.timeout(15000),
    })
  } catch {
    // Orchestrator deja mort / injoignable / timeout -- le filet par port ci-dessous prend le relai.
  }
  // Filet de securite inconditionnel : meme si stop-all a "reussi" cote HTTP,
  // rien ne garantit que CHAQUE sous-app a vraiment ete jointe (VM lente,
  // process qui ignore SIGTERM...). Tuer un port deja libre est un no-op
  // silencieux -- ce n'est jamais plus couteux qu'inutile de le refaire ici.
  await (info.isLocal ? killPortsLocal(ports) : killPortsRemote(info.vm, ports))
}

function stopOrchestratorPolling(): void {
  if (orchestratorPollTimer) clearInterval(orchestratorPollTimer)
  orchestratorPollTimer = null
  orchestratorInfo = null
  lastSubApps = {}
  safeSend('cv:orchestrator-subapps', [])
}

/** Ouvre (ou refocalise si deja ouverte) un onglet natif pour une sous-app decouverte via Orchestrator. */
async function openOrchestratorSubApp(subAppId: string): Promise<{ ok: boolean; error?: string }> {
  const tabId = ORCH_TAB_PREFIX + subAppId
  if (dockedTabs.has(tabId)) { activateTab(tabId); return { ok: true } }
  const detached = detachedTabs.get(tabId)
  if (detached) { detached.win.focus(); return { ok: true } }
  if (!orchestratorInfo) return { ok: false, error: 'Orchestrator n\'est plus lance.' }
  const info = lastSubApps[subAppId]
  const frontendPort = portFromUrl(info?.frontend_url ?? null)
  const backendPort = portFromUrl(info?.backend_url ?? null)
  // Gate sur le STATUT REEL (running = /health OK, verifie par l'orchestrator),
  // pas sur `launched` qui reste vrai pour une session morte persistee dans
  // launcher_state.json -> c'etait la cause de l'onglet blanc (URL morte).
  if (!frontendPort) return { ok: false, error: `${subAppId} n'a pas d'URL frontend.` }
  if (info?.status !== 'running') {
    return { ok: false, error: `${subAppId} n'est pas prete (statut : ${info?.status ?? 'inconnu'}). Lance-la d'abord depuis le bandeau.` }
  }

  const { stream: logStream, filePath: logPath } = openLogFile(tabId)
  const procs: ChildProcess[] = []
  appendLog(tabId, logStream, `Ouverture depuis Orchestrator (frontend port ${frontendPort}).`)
  appendLog(tabId, logStream, `Log VisionNexus de cet onglet : ${logPath}`)
  // Tail du vrai log de la sous-app (spawnee par l'orchestrator) -> visible ici.
  // Uniquement en local : sur VM le fichier est distant (non monte).
  if (orchestratorInfo.isLocal && info.backend_log) {
    appendLog(tabId, logStream, `--- Logs backend de ${subAppId} (${info.backend_log}) ---`)
    subAppLogTails.set(tabId, tailFileInto(info.backend_log, tabId, logStream))
  }
  if (!orchestratorInfo.isLocal && backendPort) {
    // Ces ports tournent sur la VM d'Orchestrator, jamais tunnelises pour
    // nous (on ne les a pas lances nous-memes) -- meme mecanisme que pour un
    // lancement normal (sshLauncher.ts: openTunnel), juste declenche ici a
    // la demande plutot qu'au lancement.
    // Meme verification prealable que pour un lancement normal : ici le risque
    // est plus eleve encore, les ports sont choisis par Orchestrator sur la VM
    // sans aucune vue sur ce qui tourne deja sur le poste Windows.
    const busy = await findBusyLocalPorts([backendPort, frontendPort])
    if (busy.length) {
      const msg = `Port(s) local/locaux deja occupe(s) sur ce poste : ${busy.join(', ')}.`
        + ` Impossible de tunneliser la sous-app ${subAppId} : fermez le tunnel orphelin`
        + ' ou l\'autre instance du lanceur qui les retient, puis reouvrez l\'onglet.'
      appendLog(tabId, logStream, `[erreur] ${msg}`)
      logStream.end()
      notifyStatus(tabId, 'error', msg)
      return { ok: false, error: msg }
    }
    const tunnel = openTunnel(orchestratorInfo.vm, backendPort, frontendPort)
    procs.push(tunnel)
    // Un forward refuse (port local deja pris par un tunnel orphelin) faisait
    // pointer l'onglet sur un serveur qui n'est pas celui de cette sous-app.
    watchTunnel(tunnel, (msg, fatal) => {
      // Onglet deja ferme (son flux est clos) : c'est NOUS qui venons de tuer ce
      // tunnel, pas une panne -- ne pas repeindre l'onglet en erreur.
      if (logStream.writableEnded) return
      appendLog(tabId, logStream, msg)
      if (!fatal) return
      tunnelProblems.set(tabId, msg)
      notifyStatus(tabId, 'error', msg)
    })
    appendLog(tabId, logStream, `Tunnel ouvert vers ${orchestratorInfo.vm}.`)
  }
  // Attendre que VITE reponde vraiment avant d'ouvrir l'onglet.
  // `status === 'running'` cote Orchestrator ne prouve QUE le backend : c'est
  // /health sur backend_url qui promeut starting -> running (launcher_api.py),
  // le serveur de dev frontend n'est jamais sonde. Or Orchestrator spawn les
  // deux en meme temps et uvicorn repond souvent avant Vite -- surtout apres un
  // fork de run, ou Vite doit re-pre-bundler ses deps. On ouvrait donc l'onglet
  // sur un port qui ne repondait pas encore, avec un unique loadURL sans reprise
  // -> onglet mort/illisible definitivement, alors que la meme URL marchait
  // dans un navigateur ouvert quelques secondes plus tard.
  // Meme garantie que le chemin de lancement normal (cf. sshLauncher.ts).
  notifyStatus(tabId, 'launching')   // l'attente peut durer : l'UI doit le montrer
  appendLog(tabId, logStream, 'Attente du serveur frontend...')
  if (!await waitUntilReady(frontendPort, 90000)) {
    appendLog(tabId, logStream, `Frontend injoignable sur le port ${frontendPort}.`)
    logStream.end()
    for (const p of procs) killProcessTree(p)
    const stop = subAppLogTails.get(tabId)
    if (stop) { stop(); subAppLogTails.delete(tabId) }
    notifyStatus(tabId, 'error', 'frontend injoignable')
    return { ok: false, error: `Le frontend de ${subAppId} n'a pas repondu (port ${frontendPort}). Il est peut-etre encore en cours de demarrage : reessaie dans quelques secondes.` }
  }
  const tunnelProblem = tunnelProblems.get(tabId)
  if (tunnelProblem) {
    // Le port local repond, mais pas grace a NOTRE tunnel : ce qu'on afficherait
    // n'est pas garanti etre cette sous-app.
    tunnelProblems.delete(tabId)
    appendLog(tabId, logStream, "Ouverture annulee : le tunnel de cet onglet n'a pas pu etre etabli.")
    logStream.end()
    for (const p of procs) killProcessTree(p)
    const stopTail = subAppLogTails.get(tabId)
    if (stopTail) { stopTail(); subAppLogTails.delete(tabId) }
    notifyStatus(tabId, 'error', tunnelProblem)
    return { ok: false, error: tunnelProblem }
  }
  await logServedPage(tabId, logStream, frontendPort)
  appendLog(tabId, logStream, "Frontend pret -- ouverture de l'onglet.")
  if (orchestratorInfo.isLocal) setNativeMountAvailable(true)
  const badgeStatus = nativeBadgeStatus(subAppId, orchestratorInfo.isLocal)
  const appDef = findApp(subAppId)
  createAppTab(tabId, frontendPort, procs, logStream, badgeStatus, {
    label: `${appDef?.label ?? info.label} (Orchestrator)`,
    icon: appDef?.icon ?? 'app.ico',
    backendPort: backendPort ?? undefined,
  })
  notifyStatus(tabId, 'running')
  return { ok: true }
}

/**
 * Trace ce que le port local sert VRAIMENT juste avant d'y pointer une vue :
 * statut, content-type, et le debut du corps. Quand un onglet affiche autre
 * chose que son app (page en texte brut, contenu d'une autre app), c'est la
 * seule facon de savoir si le probleme vient du serveur distant ou de ce qui
 * repond en local -- une page correcte dans un navigateur pointe sur la VM ne
 * prouve rien sur ce que le tunnel, lui, ramene. Best-effort et silencieux en
 * cas d'echec : purement informatif.
 */
async function logServedPage(tabId: string, logStream: fs.WriteStream, port: number): Promise<void> {
  try {
    const res = await authFetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(3000) })
    const ctype = res.headers.get('content-type') ?? '(aucun content-type)'
    const head = (await res.text()).slice(0, 120).replace(/\s+/g, ' ')
    appendLog(tabId, logStream, `[diag] 127.0.0.1:${port} -> HTTP ${res.status}, ${ctype} | ${head}`)
  } catch {
    /* sonde informative uniquement */
  }
}

/** Ouvre la sous-app dans le navigateur systeme (alternative a l'onglet natif). */
async function openOrchestratorSubAppInBrowser(subAppId: string): Promise<{ ok: boolean; error?: string }> {
  const info = lastSubApps[subAppId]
  const frontendPort = portFromUrl(info?.frontend_url ?? null)
  if (info?.status !== 'running' || !frontendPort) {
    return { ok: false, error: `${subAppId} n'est pas prete (statut : ${info?.status ?? 'inconnu'}).` }
  }
  return openInExternalBrowser(`http://127.0.0.1:${frontendPort}/`)
}

/** Demande a Orchestrator de lancer UNE sous-app pas encore active (bouton "Lancer" du bandeau). */
async function launchOrchestratorSubApp(subAppId: string): Promise<{ ok: boolean; error?: string }> {
  if (!orchestratorInfo) return { ok: false, error: 'Orchestrator n\'est plus lance.' }
  try {
    const res = await authFetch(`http://127.0.0.1:${orchestratorInfo.backendPort}/api/apps/launch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: subAppId }),
      signal: AbortSignal.timeout(6000),
    })
    if (!res.ok) return { ok: false, error: `Orchestrator a refuse le lancement (${res.status}).` }
    void pollOrchestratorSubApps() // rafraichit le bandeau tout de suite plutot que d'attendre le prochain tick
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

/** Demande a Orchestrator de lancer toutes les sous-apps pas encore actives (bouton "Lancer tout"). */
async function launchAllOrchestratorSubApps(): Promise<{ ok: boolean; error?: string }> {
  if (!orchestratorInfo) return { ok: false, error: 'Orchestrator n\'est plus lance.' }
  try {
    // app_id requis par le schema LaunchBody mais ignore par /launch-all -- valeur factice.
    const res = await authFetch(`http://127.0.0.1:${orchestratorInfo.backendPort}/api/apps/launch-all`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: 'all' }),
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) return { ok: false, error: `Orchestrator a refuse le lancement (${res.status}).` }
    const result = await res.json() as { errors?: Array<{ app_id?: string; error?: string }> }
    await pollOrchestratorSubApps()
    if (result.errors?.length) {
      const details = result.errors
        .map(item => `${item.app_id ?? 'application'} : ${item.error ?? 'échec du lancement'}`)
        .join(' · ')
      return { ok: false, error: details }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}
let activeTabId: string | null = null // null = onglet "VisionNexus" (accueil)
// Ordre d'affichage des onglets dockes -- purement visuel, modifie par
// glisser-deposer d'un onglet sur un autre (catalog.html). Un Map preserve
// deja l'ordre d'insertion mais ne permet pas de reordonner sans supprimer
// puis reinserer -- plus simple de garder cet ordre a part et de l'appliquer
// au moment de construire la liste envoyee au renderer.
let tabOrder: string[] = []
function sortByTabOrder(appIds: string[]): string[] {
  const known = appIds.filter((id) => tabOrder.includes(id))
  const unknown = appIds.filter((id) => !tabOrder.includes(id)) // jamais glisses -- a la fin, dans leur ordre d'apparition
  known.sort((a, b) => tabOrder.indexOf(a) - tabOrder.indexOf(b))
  return [...known, ...unknown]
}
// Rectangle (relatif a la fenetre) ou une vue active doit s'afficher --
// rapporte par catalog.html (ResizeObserver sur #body) des que la mise en
// page change (barre d'onglets ajoutee/retiree, redimensionnement...).
const SHELL_HEADER_HEIGHT = 36
let contentBounds = { x: 0, y: SHELL_HEADER_HEIGHT, width: 1260, height: 684 }
let shellOverlayOpen = false

function sanitizeContentBounds(bounds: { x: number; y: number; width: number; height: number }) {
  const [windowWidth, windowHeight] = catalogWindow?.getContentSize() ?? [1260, 720]
  const finite = (value: number, fallback: number) => Number.isFinite(value) ? Math.round(value) : fallback
  const x = Math.max(0, Math.min(windowWidth, finite(bounds.x, 0)))
  // Garde native : même si ResizeObserver remonte transitoirement y=0 pendant
  // un reflow/maximize, une vue enfant ne peut jamais recouvrir la top bar.
  const y = Math.max(SHELL_HEADER_HEIGHT, Math.min(windowHeight, finite(bounds.y, SHELL_HEADER_HEIGHT)))
  const width = Math.max(0, Math.min(windowWidth - x, finite(bounds.width, windowWidth - x)))
  const height = Math.max(0, Math.min(windowHeight - y, finite(bounds.height, windowHeight - y)))
  return { x, y, width, height }
}

function tabTitle(t: DockedTab): string {
  const nat = t.nativeStatus.supported ? (t.nativeStatus.active ? 'Natif' : 'HTTP (repli)') : null
  return nat ? `${t.label} — ${nat}` : t.label
}

function broadcastTabs(): void {
  const dockedIds = sortByTabOrder([...dockedTabs.keys()])
  const tabs = [
    ...dockedIds.map((id) => {
      const t = dockedTabs.get(id)!
      return {
        appId: t.appId, label: t.label, icon: t.icon, location: 'docked' as const,
        native: { supported: t.nativeStatus.supported, active: t.nativeStatus.active, reason: t.nativeStatus.reason },
      }
    }),
    ...[...detachedTabs.values()].map((t) => ({
      appId: t.appId, label: t.label, icon: t.icon, location: 'detached' as const,
      native: { supported: t.nativeStatus.supported, active: t.nativeStatus.active, reason: t.nativeStatus.reason },
    })),
  ]
  safeSend('cv:tabs', tabs, activeTabId, { mode: layoutMode, panes: paneTabs, ratioX: splitRatioX, ratioY: splitRatioY })
}

// ── Dock / split (2 ou 4 vues in-window, facon VSCode) ────────────────────────
// single = comportement historique (1 vue plein cadre). v2 = gauche/droite,
// h2 = haut/bas, grid4 = 2x2. paneTabs[i] = appId affiche dans le volet i (ou null).
type LayoutMode = 'single' | 'v2' | 'h2' | 'grid4'
let layoutMode: LayoutMode = 'single'
let paneTabs: (string | null)[] = [null]
let splitRatioX = 0.5
let splitRatioY = 0.5
const SPLIT_GAP = 8

function paneCount(m: LayoutMode): number { return m === 'grid4' ? 4 : m === 'single' ? 1 : 2 }

function slotBoundsFor(mode: LayoutMode): Array<{ x: number; y: number; width: number; height: number }> {
  const { x, y, width, height } = contentBounds
  const usableW = Math.max(0, width - SPLIT_GAP)
  const usableH = Math.max(0, height - SPLIT_GAP)
  const w2 = Math.floor(usableW * splitRatioX), h2 = Math.floor(usableH * splitRatioY)
  switch (mode) {
    case 'v2': return [{ x, y, width: w2, height }, { x: x + w2 + SPLIT_GAP, y, width: usableW - w2, height }]
    case 'h2': return [{ x, y, width, height: h2 }, { x, y: y + h2 + SPLIT_GAP, width, height: usableH - h2 }]
    case 'grid4': return [
      { x, y, width: w2, height: h2 }, { x: x + w2 + SPLIT_GAP, y, width: usableW - w2, height: h2 },
      { x, y: y + h2 + SPLIT_GAP, width: w2, height: usableH - h2 }, { x: x + w2 + SPLIT_GAP, y: y + h2 + SPLIT_GAP, width: usableW - w2, height: usableH - h2 },
    ]
    default: return [{ x, y, width, height }]
  }
}

const hiddenAppSidebars = new Set<string>()
async function setAppSidebarHidden(appId: string, hidden: boolean): Promise<boolean> {
  const tab = dockedTabs.get(appId) ?? detachedTabs.get(appId)
  if (!tab) return false
  hidden ? hiddenAppSidebars.add(appId) : hiddenAppSidebars.delete(appId)
  const script = `(() => {
    const hidden = ${hidden ? 'true' : 'false'};
    let style = document.getElementById('visionnexus-sidebar-style');
    if (!style) { style = document.createElement('style'); style.id = 'visionnexus-sidebar-style';
      style.textContent = 'html.visionnexus-sidebar-hidden #root > div > aside:first-child, html.visionnexus-sidebar-hidden #root > div > div > aside:first-child { display:none !important; }';
      document.head.appendChild(style); }
    document.documentElement.classList.toggle('visionnexus-sidebar-hidden', hidden);
    let toast = document.getElementById('visionnexus-sidebar-toast');
    if (!toast) { toast = document.createElement('div'); toast.id='visionnexus-sidebar-toast'; Object.assign(toast.style,{position:'fixed',right:'12px',top:'12px',zIndex:'2147483647',padding:'7px 10px',borderRadius:'7px',background:'#111827',border:'1px solid #374151',color:'#e5e7eb',font:'12px Segoe UI',boxShadow:'0 8px 24px #0008',transition:'opacity .2s'}); document.body.appendChild(toast); }
    toast.textContent = hidden ? 'Bandeau masqué · Ctrl+B pour restaurer' : 'Bandeau restauré'; toast.style.opacity='1'; clearTimeout(window.__cvSidebarToastTimer); window.__cvSidebarToastTimer=setTimeout(()=>toast.style.opacity='0',1600);
    return hidden;
  })()`
  try { await tab.view.webContents.executeJavaScript(script); return true } catch { return false }
}

async function toggleAppSidebar(appId: string): Promise<boolean> {
  return setAppSidebarHidden(appId, !hiddenAppSidebars.has(appId))
}

function installAppViewShortcuts(view: WebContentsView, appId: string, logStream: fs.WriteStream): void {
  view.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.control && !input.alt && !input.meta && input.key.toLowerCase() === 'b') {
      event.preventDefault()
      void toggleAppSidebar(appId)
    }
  })
  view.webContents.on('did-finish-load', () => {
    if (hiddenAppSidebars.has(appId)) void setAppSidebarHidden(appId, true)
  })
  // Un onglet n'est charge qu'une fois (createAppTab -> loadURL). Sans reprise,
  // le moindre refus au premier essai (Vite pas encore a l'ecoute, redemarrage
  // du serveur de dev pendant un run Orchestrator) laissait un onglet mort
  // pour de bon : la page d'erreur Chromium restait affichee meme une fois le
  // serveur revenu. On retente quelques fois, en espacant.
  let reloadAttempts = 0
  view.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    if (!isMainFrame) return
    appendLog(appId, logStream, `[renderer] chargement echoue ${code}: ${description} (${url})`)
    if (code === -3) return   // ABORTED : navigation remplacee par une autre, pas une panne
    if (reloadAttempts >= 5) return
    reloadAttempts += 1
    const delay = 1500 * reloadAttempts
    appendLog(appId, logStream, `[renderer] nouvelle tentative ${reloadAttempts}/5 dans ${delay} ms`)
    setTimeout(() => {
      if (view.webContents.isDestroyed()) return
      void view.webContents.loadURL(url)
    }, delay)
  })
  view.webContents.on('did-finish-load', () => { reloadAttempts = 0 })
  view.webContents.on('render-process-gone', (_event, details) => {
    appendLog(appId, logStream,
      `[renderer] process termine: reason=${details.reason}, exitCode=${details.exitCode}`)
  })
  view.webContents.on('unresponsive', () => {
    appendLog(appId, logStream, '[renderer] interface non reactive')
  })
  view.webContents.on('responsive', () => {
    appendLog(appId, logStream, '[renderer] interface de nouveau reactive')
  })
  // Filet de securite pour le cache de deps Vite : si le serveur de dev
  // repre-bundle (nouvelle dependance decouverte, ou seconde instance sur le
  // meme dossier), le browserHash change et la page deja chargee reclame des
  // modules qui n'existent plus -> 504 "Outdated Optimize Dep" et overlay
  // d'erreur Vite plein ecran (fond noir, texte brut) a la place de l'app.
  // Recharger suffit : index.html repart avec les hash a jour. La cause de
  // fond est traitee cote Orchestrator (VITE_CACHE_DIR par instance) ; ceci
  // couvre le repre-bundling legitime d'une instance seule.
  let staleDepsReloadedAt = 0
  view.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    // warning/error uniquement : les console.log du frontend (dont chaque WS)
    // rendraient le journal aussi bruyant que les anciens GET de thumbnails.
    if (level < 2) return
    const source = sourceId ? `${path.basename(sourceId)}:${line}` : `ligne ${line}`
    appendLog(appId, logStream, `[renderer console] ${source} ${message}`)
    if (!/Outdated Optimize Dep|outdated optimize dep/.test(message)) return
    if (Date.now() - staleDepsReloadedAt < 10000) return   // un seul rechargement par salve de 504
    staleDepsReloadedAt = Date.now()
    appendLog(appId, logStream, "[renderer] cache de deps Vite perime -- rechargement de l'onglet.")
    if (!view.webContents.isDestroyed()) view.webContents.reload()
  })
}

function slotBounds() { return slotBoundsFor(layoutMode) }

// Applique le layout : detache toutes les vues puis (re)pose celles assignees aux
// volets. Tolerant : un paneTabs pointant un onglet ferme/detache est ignore.
function hideDockedViews(): void {
  if (!catalogWindow) return
  for (const { view } of dockedTabs.values()) {
    // setVisible(false) est volontairement fait AVANT removeChildView. Sur
    // certaines séquences Electron (reload/detach/renderer relancé), le retrait
    // peut échouer ou devenir un no-op ; sans ce filet la dernière app reste
    // au-dessus du catalogue et donne l'impression que tous les onglets sont morts.
    try { view.setVisible(false) } catch { /* vue déjà détruite */ }
    try { catalogWindow.contentView.removeChildView(view) } catch { /* déjà retirée */ }
  }
}

/**
 * Rafraichit le cache avant une action utilisateur. Le polling alimente le
 * badge, mais juste apres un reload il peut encore etre vide pendant une
 * seconde : le menu annonçait alors a tort qu'aucune sous-app n'etait connue
 * et un window.open() pouvait rater la creation de son onglet natif.
 */
async function refreshOrchestratorSubApps(): Promise<Record<string, OrchestratorSubAppInfo>> {
  if (!orchestratorInfo) return lastSubApps
  try {
    const res = await authFetch(`http://127.0.0.1:${orchestratorInfo.backendPort}/api/apps`, {
      signal: AbortSignal.timeout(3000),
    })
    if (res.ok) {
      lastSubApps = await res.json() as Record<string, OrchestratorSubAppInfo>
      safeSend('cv:orchestrator-subapps', Object.values(lastSubApps))
    }
  } catch {
    // Conserve le dernier snapshot si le backend est momentanement occupe.
  }
  return lastSubApps
}

function applyLayout(shouldBroadcast = true): void {
  if (!catalogWindow) return
  hideDockedViews()
  if (activeTabId === null || shellOverlayOpen) {
    catalogWindow.webContents.focus()
    if (shouldBroadcast) broadcastTabs()
    return
  }
  const bounds = slotBounds()
  paneTabs.forEach((id, i) => {
    if (!id || i >= bounds.length) return
    const tab = dockedTabs.get(id)
    if (!tab) return
    try {
      catalogWindow!.contentView.addChildView(tab.view)
      tab.view.setBounds(bounds[i])
      tab.view.setVisible(true)
    } catch { /* vue indisponible */ }
  })
  if (shouldBroadcast) broadcastTabs()
}

function resizeLayoutViews(): void {
  const bounds = slotBounds()
  paneTabs.forEach((id, i) => {
    if (!id || i >= bounds.length) return
    try { dockedTabs.get(id)?.view.setBounds(bounds[i]) } catch { /* vue fermée pendant le drag */ }
  })
}

/** Bascule l'onglet actif -- appId=null revient a l'accueil "VisionNexus". */
function activateTab(appId: string | null): void {
  if (!catalogWindow) return
  activeTabId = appId
  // En mode split, un onglet clique qui n'est dans aucun volet prend le volet 0.
  if (appId && !paneTabs.includes(appId)) paneTabs[0] = appId
  applyLayout()
}

// Retire un onglet (ferme/detache) des volets pour ne pas laisser un volet fantome.
function forgetTabInPanes(appId: string): void {
  let touched = false
  paneTabs = paneTabs.map((id) => { if (id === appId) { touched = true; return null } ; return id })
  if (touched && activeTabId === appId) activeTabId = paneTabs.find((id) => id) ?? null
}

function setLayoutMode(mode: LayoutMode): void {
  layoutMode = mode
  const n = paneCount(mode)
  const next: (string | null)[] = []
  for (let i = 0; i < n; i++) next.push(paneTabs[i] ?? null)
  // Remplit les volets vides avec les onglets ouverts non deja places.
  const placed = new Set(next.filter(Boolean) as string[])
  const avail = sortByTabOrder([...dockedTabs.keys()]).filter((id) => !placed.has(id))
  for (let i = 0; i < n; i++) { if (!next[i]) { const id = avail.shift(); if (id) { next[i] = id; placed.add(id) } } }
  paneTabs = next
  if (activeTabId === null && next[0]) activeTabId = next[0]
  applyLayout()
}


/** Cree l'onglet dockee pour une app tout juste lancee, et l'active. */
// Un lien target="_blank" (ou window.open) dans une page chargee ici --
// app React ou markdown rendu dans docs.html -- ouvrirait par defaut une
// fenetre Electron NUE (sans barre d'adresse ni navigation), potentiellement
// vide/blanche si l'url ne mene nulle part (ex. lien relatif vers un autre
// .md du depot, cf. inlineMd dans docs.html). On refuse systematiquement la
// creation d'une nouvelle fenetre Electron ; un vrai lien http(s) part dans
// le navigateur par defaut a la place.
// Tout lien localhost pointant vers une app déjà connue est routé dans son
// onglet VisionNexus, quelle que soit l'app source. C'est indispensable pour
// les sauts DVC <-> MLflow <-> Insight : auparavant seul Orchestrator pouvait
// ouvrir une sous-app nativement et les liens retour partaient dans Chrome.
async function openLocalUrlInVisionNexus(url: string): Promise<boolean> {
  let parsed: URL
  try { parsed = new URL(url) } catch { return false }
  if (!['127.0.0.1', 'localhost'].includes(parsed.hostname)) return false
  const port = portFromUrl(url)
  if (port === null) return false

  const docked = [...dockedTabs.values()].find((tab) => tab.frontendPort === port)
  if (docked) {
    activateTab(docked.appId)
    await docked.view.webContents.loadURL(url)
    return true
  }
  const detached = [...detachedTabs.values()].find((tab) => tab.frontendPort === port)
  if (detached) {
    detached.win.focus()
    await detached.view.webContents.loadURL(url)
    return true
  }

  // Un lien ouvert juste apres un lancement (ou apres un reload d'Orchestrator)
  // peut arriver avant le prochain poll : sans ce rafraichissement, la sous-app
  // n'est pas dans le cache et le lien fuit vers le navigateur systeme.
  await refreshOrchestratorSubApps()
  const subAppId = Object.keys(lastSubApps).find((id) => portFromUrl(lastSubApps[id].frontend_url) === port)
  if (!subAppId) return false
  const opened = await openOrchestratorSubApp(subAppId)
  if (!opened.ok) return false
  const nativeTab = dockedTabs.get(ORCH_TAB_PREFIX + subAppId)
  if (!nativeTab) return false
  await nativeTab.view.webContents.loadURL(url)
  return true
}

/**
 * Un lien vers l'IP LAN de la VM (http://10.x:5174) ou vers son nom d'hote
 * contourne le tunnel ssh : il ne marche que si l'app ecoute sur le reseau, et
 * dans ce cas il l'ouvrait a tout le monde (rapport 2026-09-24). On le ramene
 * sur 127.0.0.1, ou arrivent nos tunnels. Renvoie null si l'URL n'est pas concernee.
 */
function lanUrlToLoopback(url: string): string | null {
  let parsed: URL
  try { parsed = new URL(url) } catch { return null }
  const host = parsed.hostname.toLowerCase()
  const vmHost = loadSettings().selectedVm.trim().toLowerCase().replace(/^.*@/, '')
  const isVmName = !!vmHost && (host === vmHost || host.startsWith(`${vmHost}.`))
  // Une IP privee n'est traitee que si son port est celui d'une de nos apps :
  // les autres liens intranet (wiki, gitlab...) doivent rester ouvrables.
  const port = portFromUrl(url)
  const privateIp = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)
    && port !== null && knownPorts().some((k) => k.port === port)
  if (!privateIp && !isVmName) return null
  parsed.hostname = '127.0.0.1'
  return parsed.toString()
}

function denyPopupsOpenExternal(webContents: WebContents, appId?: string): void {
  webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) {
      const loopback = lanUrlToLoopback(url)
      void openLocalUrlInVisionNexus(loopback ?? url).then((handled) => {
        if (handled) return
        // Jamais de navigateur externe vers l'IP de la VM : ce serait le
        // chemin non chiffre et non authentifie que le tunnel remplace.
        if (loopback) console.warn(`[popup] lien LAN refuse (aucun onglet sur ce port) : ${url}`)
        else void openInExternalBrowser(url)
      }).catch(() => { if (!loopback) void openInExternalBrowser(url) })
    }
    return { action: 'deny' }
  })
}

// ---- Jeton de session (cf. sessionTokens.ts, _lib/session_auth.py) ----

/**
 * Ajoute le jeton a toute requete des onglets vers une de nos instances :
 * API via le proxy Vite, appels directs au port backend (SSE), images,
 * WebSocket. Un seul point pour tous les onglets (session par defaut), et
 * aucun frontend a modifier. Jamais pose vers un hote non local.
 */
function installRendererAuth(): void {
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    const token = tokenForUrl(details.url)
    if (token) details.requestHeaders[TOKEN_HEADER] = token
    callback({ requestHeaders: details.requestHeaders })
  })
}

/**
 * Double de l'en-tete : cookie `vn_<port backend>` dans la session des
 * onglets. Il couvre ce que l'en-tete ne peut pas porter : l'appel d'une app
 * vers une AUTRE instance par son propre proxy (DVC/MLflow -> Orchestrator),
 * ou l'en-tete injecte est celui de l'app appelante.
 */
async function setSessionCookie(backendPort: number | null, token: string | null | undefined): Promise<void> {
  if (!backendPort || !token) return
  try {
    await session.defaultSession.cookies.set({
      url: 'http://127.0.0.1/',
      name: `vn_${backendPort}`,
      value: token,
      httpOnly: true,
      sameSite: 'strict',
    })
  } catch (err) {
    console.warn(`[auth] cookie de session non pose pour le port ${backendPort} : ${(err as Error).message}`)
  }
}

async function clearSessionCookie(backendPort: number | null | undefined): Promise<void> {
  if (!backendPort) return
  try {
    await session.defaultSession.cookies.remove('http://127.0.0.1/', `vn_${backendPort}`)
  } catch { /* deja absent */ }
}

/** App arretee : son jeton est mort avec elle, et ses ports pourront servir a une autre instance. */
function forgetTabAuth(tab: { frontendPort: number; backendPort?: number }): void {
  forgetPorts([tab.frontendPort, tab.backendPort])
  void clearSessionCookie(tab.backendPort)
}

/**
 * Ouvre une de nos pages dans le navigateur systeme. Ce navigateur n'a pas
 * le jeton : on passe par un lien d'amorcage a usage unique qui lui pose le
 * cookie puis redirige vers la page. Une URL qui ne vise pas une de nos
 * instances part telle quelle.
 */
async function openInExternalBrowser(url: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await shell.openExternal((await bootstrapUrl(url)) ?? url)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: `Ouverture dans le navigateur impossible : ${(err as Error).message}` }
  }
}

function createAppTab(
  appId: string, frontendPort: number, procs: ChildProcess[], logStream: fs.WriteStream, nativeStatus: NativeBadgeStatus,
  opts?: { label?: string; icon?: string; backendPort?: number },
): void {
  const appDef = findApp(appId)
  const view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preloadApp.js'),
      // Seule facon de faire arriver une donnee au preload AVANT le chargement
      // de la page (pas d'IPC possible a ce stade) -- lu via process.argv
      // cote preload. Sert uniquement a afficher le badge natif/HTTP.
      additionalArguments: [`--cv-native-status=${JSON.stringify(nativeStatus)}`],
    },
  })
  denyPopupsOpenExternal(view.webContents, appId)
  installAppViewShortcuts(view, appId, logStream)
  // ?lang= pilote la langue de DEPART de l'app (cf. i18n/translate.ts cote
  // frontend) -- chaque app reste ensuite libre de la changer localement,
  // ce parametre ne fixe que l'etat au premier chargement de l'onglet.
  const uiLanguage = loadSettings().uiLanguage
  void view.webContents.loadURL(`http://127.0.0.1:${frontendPort}?lang=${uiLanguage}`)
  dockedTabs.set(appId, {
    appId,
    label: opts?.label ?? appDef?.label ?? appId,
    icon: opts?.icon ?? appDef?.icon ?? 'app.ico',
    view, procs, logStream, nativeStatus, frontendPort,
    backendPort: opts?.backendPort,
  })
  activateTab(appId)
}

/**
 * URL reelle servie par un onglet (docke ou detache) -- un onglet n'est rien
 * de plus qu'une vue pointee sur ce port local (cf. createAppTab), tunnel SSH
 * deja etabli ou non : la meme URL fonctionne dans n'importe quel navigateur
 * tant que ce process (et son eventuel tunnel) tourne encore.
 */
function getTabUrl(appId: string): string | null {
  const tab = dockedTabs.get(appId) ?? detachedTabs.get(appId)
  return tab ? `http://127.0.0.1:${tab.frontendPort}` : null
}

// Onglets dont la fermeture est EN COURS. closeTab est async et ne retire son
// onglet de dockedTabs qu'a la fin : pendant l'`await stopAllOrchestratorSubApps()`
// (jusqu'a 15 s), un second appel -- deuxieme clic sur la croix, fermeture de la
// fenetre, Stop, ou la boucle qui ferme les onglets orch_* -- repassait dans le
// meme corps et refermait un flux deja ferme (ERR_STREAM_WRITE_AFTER_END, cf.
// appendLog) : Electron mourait sans nettoyer ses tunnels ni ses sous-apps.
const closingTabs = new Set<string>()

/** Ferme un onglet docke. Les sous-apps Orchestrator sont seulement masquées. */
async function closeTab(appId: string): Promise<void> {
  const tab = dockedTabs.get(appId)
  if (!tab) return
  if (closingTabs.has(appId)) return
  closingTabs.add(appId)
  try {
    await closeTabInner(appId, tab)
  } finally {
    closingTabs.delete(appId)
  }
}

async function closeTabInner(appId: string, tab: DockedTab): Promise<void> {
  // Stoppe le tail de log si c'est un onglet de sous-app Orchestrator.
  const stopTail = subAppLogTails.get(appId)
  if (stopTail) { stopTail(); subAppLogTails.delete(appId) }
  if (appId === 'orchestrator') {
    await stopAllOrchestratorSubApps()
    stopOrchestratorPolling()
    // Les onglets orch_* pointent des sous-apps que l'orchestrator vient d'arreter
    // (et que son arret d'arbre va tuer) -> on ferme leurs onglets pour ne pas
    // laisser d'onglet blanc/mort (bug : onglet sous-app survivait a l'orchestrator).
    for (const id of [...dockedTabs.keys(), ...detachedTabs.keys()]) {
      if (id.startsWith(ORCH_TAB_PREFIX)) {
        if (dockedTabs.has(id)) void closeTab(id)
        else detachedTabs.get(id)?.win.close()
      }
    }
  }
  const orchestratorSubApp = appId.startsWith(ORCH_TAB_PREFIX)
  appendLog(appId, tab.logStream, orchestratorSubApp
    ? 'Onglet masque -- application Orchestrator conservee en arriere-plan.'
    : 'Fermeture demandee -- process arretes.')
  for (const p of tab.procs) killProcessTree(p)
  if (!orchestratorSubApp) forgetTabAuth(tab)
  tab.logStream.end()
  try { catalogWindow?.contentView.removeChildView(tab.view) } catch { /* deja retiree */ }
  forgetTabInPanes(appId)   // retire des volets (met a jour activeTabId au besoin)
  dockedTabs.delete(appId)
  tunnelProblems.delete(appId)
  try { tab.view.webContents.close() } catch { /* vue deja detruite */ }
  notifyStatus(appId, 'closed')
  applyLayout()   // re-tuile les vues restantes
}

/**
 * Detache un onglet docke vers une vraie fenetre OS independante (glisser-
 * deposer hors de la barre d'onglets, cf. catalog.html) -- meme mecanique
 * qu'avant (une fenetre par app), MAIS sans recharger la page : le
 * WebContentsView (donc son process/etat React) est simplement deplace vers
 * la nouvelle fenetre, pas recree.
 */
function detachTab(appId: string, screenX: number, screenY: number): void {
  const tab = dockedTabs.get(appId)
  if (!tab || !catalogWindow) return
  catalogWindow.contentView.removeChildView(tab.view)
  forgetTabInPanes(appId)   // un onglet detache quitte les volets du split
  dockedTabs.delete(appId)
  if (activeTabId === appId) activeTabId = null

  const width = 1600
  const height = 1000
  const win = new BrowserWindow({
    x: Math.max(0, Math.round(screenX - width / 2)),
    y: Math.max(0, Math.round(screenY - 40)),
    width,
    height,
    // icon: PNG ok ici (options natives de fenetre, converties via NativeImage) --
    // contrairement a setAppDetails plus bas, qui lui a besoin d'un vrai .ico.
    icon: path.join(resourceBase, 'assets', tab.icon),
    show: false,
  })
  win.setTitle(tabTitle(tab))
  // Sans ca, Windows regroupe cette fenetre sous l'icone de VisionNexusElectron
  // dans la barre des taches (meme AppUserModelID de process par defaut) --
  // avec un appId distinct par app, elle apparait comme son propre bouton.
  // PAS de appIconPath ici : cette option Windows attend un .ico (ressource
  // shell), un .png y produit une icone blanche/vide dans la barre des
  // taches -- sans appIconPath, Windows retombe sur l'icone de la fenetre
  // (icon: ci-dessus, qui elle accepte le PNG tel quel).
  if (process.platform === 'win32') {
    win.setAppDetails({ appId: `VisionNexusElectron.${appId}` })
  }
  win.contentView.addChildView(tab.view)
  const syncBounds = (): void => {
    const cb = win.getContentBounds()
    tab.view.setBounds({ x: 0, y: 0, width: cb.width, height: cb.height })
  }
  syncBounds()
  win.on('resize', syncBounds)

  // ---- Re-dock par glisser-deposer (best-effort) ----
  // Electron n'a pas d'API "dragend" pour un deplacement de fenetre OS (pas
  // de mouseup expose, contrairement a un <div draggable> en HTML) -- 'move'
  // se declenche en continu tant que la fenetre bouge et s'arrete des que le
  // bouton de souris est relache. On approxime donc le "lacher" par une
  // pause de mouvement (aucun 'move' pendant DOCK_SETTLE_MS) alors que le
  // CENTRE de la fenetre survole la fenetre catalogue -- des le cas, on
  // redocke automatiquement. Limite connue et acceptee : une pause volontaire
  // en gardant le bouton enfonce (survol sans lacher) declenche aussi le
  // redock -- pas de vrai mouseup disponible sans module natif. Le bouton
  // dedie (dockBtn, dans la barre d'onglets une fois detache) reste le
  // moyen fiable a 100% si ce heuristique surprend.
  const DOCK_SETTLE_MS = 220
  let overlapping = false
  let settleTimer: ReturnType<typeof setTimeout> | null = null
  win.on('move', () => {
    if (!catalogWindow || !detachedTabs.has(appId)) return
    const wb = win.getBounds()
    // Zone de redock = UNIQUEMENT la bande header+onglets en haut de la
    // fenetre catalogue (contentBounds.y = hauteur de cette bande, rapportee
    // par catalog.html via cv:report-content-bounds), pas toute la fenetre.
    // Avant ce fix, survoler N'IMPORTE QUEL point de VisionNexus (y compris
    // le corps de la page juste sous les onglets) declenchait le redock --
    // au moment meme ou on detache un onglet, la nouvelle fenetre nait
    // encore quasi superposee au catalogue (spawn pres du point de clic),
    // donc une micro-pause pendant le debut du drag la redockait aussitot :
    // "elle sort et revient direct".
    const cc = catalogWindow.getContentBounds()
    const stripBottom = cc.y + contentBounds.y
    // Point de reference = pres du HAUT de la fenetre glissee (~titlebar, la
    // ou l'utilisateur la tient reellement), PAS son centre vertical. Une
    // fenetre detachee fait ~1000px de haut -- avec le centre, il fallait la
    // faire disparaitre presque entierement au-dessus du catalogue pour que
    // son milieu touche la bande d'onglets (~40px de haut) : quasi impossible
    // en glissant naturellement par-dessus les onglets, d'ou "je vois rien".
    const cx = wb.x + wb.width / 2
    const cy = wb.y + 18
    const isOver = cx >= cc.x && cx <= cc.x + cc.width && cy >= cc.y && cy <= stripBottom
    if (isOver !== overlapping) {
      overlapping = isOver
      safeSend('cv:dock-hint', isOver ? appId : null)
    }
    if (settleTimer) clearTimeout(settleTimer)
    if (isOver) {
      settleTimer = setTimeout(() => {
        safeSend('cv:dock-hint', null)
        if (detachedTabs.has(appId)) dockTab(appId)
      }, DOCK_SETTLE_MS)
    }
  })

  // IMPORTANT : detacher explicitement la vue AVANT que la fenetre ne se
  // detruise. Fermer une BrowserWindow qui a encore un WebContentsView
  // attache (contentView.addChildView) sans le retirer proprement au
  // prealable peut planter Electron -- 'close' (annulable, avant 'closed')
  // est le seul moment sur pour le faire. dockTab() fait deja ce retrait
  // explicitement pour le re-dock ; ce handler couvre la fermeture normale
  // (croix native de la fenetre).
  win.on('close', () => {
    try { win.contentView.removeChildView(tab.view) } catch { /* deja retiree (ex: dockTab) */ }
  })
  win.on('closed', () => {
    // N'entre PAS en jeu lors d'un re-dock : dockTab() retire ce listener
    // avant d'appeler win.close() (sinon on tuerait les process d'une app
    // qu'on est juste en train de rapatrier dans la fenetre catalogue).
    if (appId === 'orchestrator') stopOrchestratorPolling()
    const stopTail = subAppLogTails.get(appId)
    if (stopTail) { stopTail(); subAppLogTails.delete(appId) }
    appendLog(appId, tab.logStream, 'Fenetre fermee -- process arretes.')
    for (const p of tab.procs) killProcessTree(p)
    if (!appId.startsWith(ORCH_TAB_PREFIX)) forgetTabAuth(tab)
    tab.logStream.end()
    detachedTabs.delete(appId)
    try { tab.view.webContents.close() } catch { /* deja fermee */ }
    notifyStatus(appId, 'closed')
    broadcastTabs()
  })
  detachedTabs.set(appId, { ...tab, win })
  broadcastTabs()
  win.show()
}

/** Re-attache un onglet detache (fenetre separee) dans la fenetre catalogue. */
function dockTab(appId: string): void {
  const detached = detachedTabs.get(appId)
  if (!detached || !catalogWindow) return
  detached.win.removeAllListeners('closed') // cf. commentaire dans detachTab
  detached.win.contentView.removeChildView(detached.view)
  detachedTabs.delete(appId)
  detached.win.close()
  dockedTabs.set(appId, {
    appId: detached.appId, label: detached.label, icon: detached.icon,
    view: detached.view, procs: detached.procs, logStream: detached.logStream, nativeStatus: detached.nativeStatus,
    frontendPort: detached.frontendPort, backendPort: detached.backendPort,
  })
  activateTab(appId)
}

function openDocsWindow(tab?: 'ask'): void {
  // Un lien vers l'assistant reutilise la fenetre deja ouverte plutot que d'en empiler une autre.
  if (tab === 'ask') {
    const open = [...docsWindows].find((w) => !w.isDestroyed())
    if (open) {
      if (open.isMinimized()) open.restore()
      open.focus()
      open.webContents.send('cv:docs-show-tab', 'ask')
      return
    }
  }
  const win = new BrowserWindow({
    width: 1100,
    height: 800,
    title: 'Documentation - VisionNexus',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preloadDocs.js'),
    },
  })
  denyPopupsOpenExternal(win.webContents)
  // Suivies pour leur pousser l'etat du service (cf. broadcastService).
  docsWindows.add(win)
  win.on('closed', () => docsWindows.delete(win))
  // Ouvre dans la langue courante de VisionNexus (reglage Parametres) --
  // la fenetre garde ensuite son propre bouton FR/EN local, comme les apps.
  void win.loadFile(path.join(resourceBase, 'ui', 'docs.html'), { query: tab ? { lang: loadSettings().uiLanguage, tab } : { lang: loadSettings().uiLanguage } })
}

// ---- Doc par app (onglet "Docs par app" de la Documentation) ----
// Le disque live (depot a cote du lanceur, via cvRoot) reste prioritaire --
// toujours plus a jour que ce qui a ete fige au build. Repli GARANTI sur
// docs-bundle/ (resourcesPath/appdocs/ une fois empaquete -- cf.
// scripts/copy-docs.js + extraResources dans package.json) quand le depot
// live n'est pas trouve : machine qui n'a que l'exe portable, sans le
// depot complet a cote. Avant ce repli, l'onglet restait vide dans ce cas
// (seul message d'erreur, jamais de contenu).
// La liste des sources (id, dossier, dossier des pages) vient de
// docs/docs_manifest.json (source unique, partagee avec scripts/copy-docs.js
// et tools/docs/) : celui du depot live d'abord, sinon la copie figee au build
// dans appdocs/.
function loadDocSources(repoRoot: string | null): Map<string, DocSource> {
  const manifest = (repoRoot && loadManifest(path.join(repoRoot, 'docs', 'docs_manifest.json')))
    || loadManifest(path.join(resourceBase, 'appdocs', 'docs_manifest.json'))
  return new Map((manifest?.sources ?? []).map((s) => [s.id, s]))
}

function findRepoRoot(): string | null {
  const settings = loadSettings()
  const candidates: string[] = []
  // Source la plus fiable, en premier : le champ "Racine" deja renseigne par
  // l'utilisateur dans Parametres pour LANCER les apps -- reutilise tel quel
  // ici, aucune configuration supplementaire a faire. Valable seulement en
  // local (pas de VM selectionnee) : sinon cvRoot est un chemin Linux, illisible
  // depuis ce process Windows.
  if (!settings.selectedVm && settings.cvRoot.trim()) candidates.push(settings.cvRoot.trim())
  // Repli best-effort si Parametres n'est pas encore rempli : marche en dev
  // (electron .), pas fiable pour un exe "portable" empaquete (electron-builder
  // l'extrait dans un dossier temporaire au lancement -- app.getPath('exe') ne
  // pointe alors plus vers desktop/release/).
  candidates.push(path.join(__dirname, '..', '..'))
  candidates.push(path.join(path.dirname(app.getPath('exe')), '..'))
  candidates.push(path.join(path.dirname(app.getPath('exe')), '..', '..'))
  for (const c of candidates) {
    if (c && fs.existsSync(path.join(c, '_lib')) && fs.existsSync(path.join(c, 'Annotation_App'))) return c
  }
  return null
}

// Pages qu'un plugin ajoute a la doc d'une app : plugins/<plugin>/docs/<AppDir>/*.md.
// Presentes seulement la ou le plugin l'est (branche Git, bundle) : la doc du
// coeur ne decrit que ce que le coeur fournit.
function readPluginDocs(repoRoot: string, appDirName: string, lang: 'fr' | 'en'): AppDocFile[] {
  const pluginsDir = path.join(repoRoot, 'plugins')
  if (!fs.existsSync(pluginsDir)) return []
  const files: AppDocFile[] = []
  for (const plugin of fs.readdirSync(pluginsDir).sort()) {
    files.push(...readDocDir(path.join(pluginsDir, plugin, 'docs', appDirName), lang))
  }
  return files
}

function readAppDocs(source: DocSource, repoRoot: string, lang: 'fr' | 'en'): AppDocFile[] {
  const docsDir = path.join(repoRoot, sourceDocsPath(source))
  const files: AppDocFile[] = []
  if (fs.existsSync(docsDir)) {
    files.push(...readDocDir(docsDir, lang))
  } else {
    const candidates = lang === 'fr' ? ['README.fr.md', 'README.md'] : ['README.md', 'README.fr.md']
    const readme = candidates.map((c) => path.join(repoRoot, source.dir, c)).find((p) => fs.existsSync(p))
    const doc = readme ? readDocFile(readme) : null
    if (doc) files.push(doc)
  }
  return sortDocFiles(files.concat(readPluginDocs(repoRoot, source.dir, lang)))
}

function readBundledDocs(source: DocSource, lang: 'fr' | 'en'): AppDocFile[] {
  return sortDocFiles(readDocDir(path.join(resourceBase, 'appdocs', sourceBundleDir(source)), lang))
}

// Ordre de la liste : la suite (VisionNexus) d'abord, puis les apps du
// diagramme, puis les ressources de calcul qui ont une doc (Docs Assistant).
function docEntryDefs(): { id: string; label: string; icon: string }[] {
  return [
    { id: 'suite', label: 'VisionNexus', icon: 'logo.png' },
    ...APPS.map((a) => ({ id: a.id, label: a.label, icon: a.icon })),
    ...SERVICES.map((s) => ({ id: s.id, label: s.label, icon: s.icon })),
  ]
}

ipcMain.handle('cv:list-app-docs', (_evt, lang?: 'fr' | 'en'): AppDocEntry[] => {
  const docLang: 'fr' | 'en' = lang === 'fr' ? 'fr' : 'en'
  const repoRoot = findRepoRoot()
  const sources = loadDocSources(repoRoot)
  return docEntryDefs().map((def) => {
    const source = sources.get(def.id)
    const live = repoRoot && source ? readAppDocs(source, repoRoot, docLang) : []
    return {
      appId: def.id,
      dir: source ? source.dir : '',
      label: def.label,
      icon: def.icon,
      files: live.length ? live : (source ? readBundledDocs(source, docLang) : []),
    }
  })
})

// ---- Ressources de calcul (services backend seul, cf. services.ts) ----
// Un service n'ouvre jamais d'onglet : meme chaine de lancement qu'une app
// (launchApp -> waitForPorts -> tunnel sur VM -> sonde /health) mais sans
// frontend, donc UN seul port a forwarder. L'etat est unique et partage entre
// la carte du catalogue et l'onglet "Demander a la doc" : les deux ne font
// que demander start/stop ici et ecouter cv:service-status.
//
// Changement de VM pendant qu'un service tourne : il reste sur la cible ou il
// a ete lance (h.target) jusqu'a son extinction, sans redemarrage surprise. Les
// deux UI comparent `target` et `selected` pour le signaler.
interface ServiceHandle {
  id: string
  state: ServiceState
  message: string
  messageKey: string | null      // cle i18n du message (ui/i18n.js), null = afficher `message`
  messageParams: MessageParams | null
  detail: string                 // fin de la sortie du launcher, jamais traduite
  target: string          // '' = local, sinon nom de la VM
  port: number | null     // port backend annonce ; identique en local et cote tunnel
  procs: ChildProcess[]   // launcher.py (+ tunnel ssh sur VM)
  logStream: fs.WriteStream
  logTail: string[]       // dernieres lignes, pour expliquer un echec
  abort: AbortController  // coupe la sonde /health quand on arrete pendant le demarrage
  index: IndexSummary | null
  pollTimer: ReturnType<typeof setTimeout> | null
}
const services = new Map<string, ServiceHandle>()
const docsWindows = new Set<BrowserWindow>()

const SERVICE_START_TIMEOUT_MS = 90000
const INDEX_POLL_SYNCING_MS = 1500
const INDEX_POLL_IDLE_MS = 15000
const SERVICE_EXIT_WAIT_MS = 5000

const SERVICE_RUN_STATUS: Record<ServiceState, AppRunStatus> = {
  off: 'closed', starting: 'launching', ready: 'running', stopping: 'launching', error: 'error',
}

function serviceStatus(id: string): ServiceStatus {
  const h = services.get(id)
  const selected = loadSettings().selectedVm.trim()
  return {
    id,
    state: h?.state ?? 'off',
    message: h?.message ?? '',
    messageKey: h?.messageKey ?? null,
    messageParams: h?.messageParams ?? null,
    detail: h?.detail ?? '',
    target: h ? h.target : selected,
    selected,
    index: h?.state === 'ready' ? h.index : null,
  }
}

function broadcastService(id: string): void {
  const status = serviceStatus(id)
  safeSend('cv:service-status', status)
  for (const win of docsWindows) {
    if (!win.isDestroyed()) win.webContents.send('cv:docs-service-status', status)
  }
  // Meme canal que les apps : alimente l'onglet de log et son bouton Stop.
  notifyStatus(id, SERVICE_RUN_STATUS[status.state], status.state === 'error' ? status.message + status.detail : '')
}

// `fromLauncher` : sortie brute de launcher.py, seule gardee pour expliquer un echec.
function serviceLog(h: ServiceHandle, line: string, fromLauncher = false): void {
  appendLog(h.id, h.logStream, line)
  if (!fromLauncher) return
  h.logTail.push(stripAnsi(line))
  if (h.logTail.length > 6) h.logTail.shift()
}

/** Coupe sonde, process et flux de log de ce lancement (idempotent). */
function releaseService(h: ServiceHandle): void {
  if (h.pollTimer) clearTimeout(h.pollTimer)
  h.pollTimer = null
  h.abort.abort()
  for (const p of h.procs) killProcessTree(p)
  if (!h.logStream.writableEnded) h.logStream.end()
}

function failService(h: ServiceHandle, failure: StartFailure): void {
  if (services.get(h.id) !== h) return
  const next = nextServiceState(h.state, 'fail')
  if (next === h.state) return   // arret demande ou deja en erreur : rien a corriger
  const last = h.logTail.filter(Boolean).slice(-2).join(' | ')
  const tail = (failure.kind === 'no-ports' || failure.kind === 'exited') && last
    ? ` Derniere sortie : ${last}`
    : ''
  const info = startFailureKey(failure)
  h.state = next
  h.message = startFailureMessage(failure)
  h.messageKey = info.key
  h.messageParams = info.params ?? null
  h.detail = tail
  serviceLog(h, `[erreur] ${h.message}${h.detail}`)
  releaseService(h)
  broadcastService(h.id)
}

// Plantage Python pendant le demarrage. Avec --reload, seul le worker uvicorn
// meurt : le process parent (reloader) reste en vie a attendre un changement
// de fichier, launcher.py ne sort donc jamais et on attendait les 90 s pleines
// avant d'afficher un "ne repond pas" sans cause (rapport 2026-09-25). On
// repere la trace dans la sortie, on laisse 2 s pour qu'elle arrive en entier,
// puis on echoue tout de suite avec la ligne d'exception.
const CRASH_GRACE_MS = 2000
const crashWatch = new WeakMap<ServiceHandle, { lines: string[]; timer: ReturnType<typeof setTimeout> | null }>()

function watchStartupCrash(h: ServiceHandle, line: string): void {
  if (h.state !== 'starting') return
  let w = crashWatch.get(h)
  if (!w) {
    if (!/Traceback \(most recent call last\)/.test(line)) return
    w = { lines: [], timer: null }
    crashWatch.set(h, w)
    const watch = w
    watch.timer = setTimeout(() => {
      if (h.state !== 'starting') return
      failService(h, { kind: 'exception', detail: `Le backend a plante au demarrage : ${crashSummary(watch.lines)}` })
    }, CRASH_GRACE_MS)
  }
  w.lines.push(stripAnsi(line).trim())
  if (w.lines.length > 60) w.lines.shift()
}

/** Derniere ligne d'exception d'une trace Python ("ModuleNotFoundError: ..."). */
function crashSummary(lines: string[]): string {
  const exc = [...lines].reverse().find((l) => /^[A-Za-z_][\w.]*(Error|Exception|Exit|Interrupt)\b/.test(l))
  return exc ?? lines.filter(Boolean).slice(-1)[0] ?? 'trace Python (voir le journal)'
}

/** Resultat d'un demarrage interrompu : arret utilisateur ou echec deja consigne. */
function startOutcome(h: ServiceHandle): { ok: boolean; error?: string } {
  return h.state === 'ready' ? { ok: true } : { ok: false, error: (h.message + h.detail) || 'Arrete par l\'utilisateur' }
}

async function startService(id: string): Promise<{ ok: boolean; error?: string }> {
  const def = findService(id)
  if (!def) return { ok: false, error: 'Ressource inconnue' }
  const existing = services.get(id)
  if (existing && !canStart(existing.state)) {
    // Deja en marche (ou en train de demarrer) : un 2e clic ne relance rien.
    return existing.state === 'stopping'
      ? { ok: false, error: 'Arret en cours, reessaie dans un instant.' }
      : { ok: true }
  }
  const settings = loadSettings()
  const { stream, filePath } = openLogFile(id)
  const h: ServiceHandle = {
    id, state: nextServiceState('off', 'start'), message: '', messageKey: null, messageParams: null, detail: '',
    target: settings.selectedVm.trim(), port: null,
    procs: [], logStream: stream, logTail: [], abort: new AbortController(), index: null, pollTimer: null,
  }
  services.set(id, h)
  broadcastService(id)

  if (!isValid(settings)) {
    failService(h, { kind: 'settings' })
    return startOutcome(h)
  }
  if (placeholderUsername(settings.username)) {
    failService(h, { kind: 'exception', detail: `Identifiant "${settings.username}" non nominatif -- change-le dans Parametres.` })
    return startOutcome(h)
  }

  try {
    serviceLog(h, `Lancement de ${def.label}${h.target ? ` sur ${h.target}` : ' (local)'}...`)
    serviceLog(h, `Log complet : ${filePath}`)
    const { launchProcess } = launchApp(def, settings, { backendOnly: true })
    h.procs.push(launchProcess)
    // Sortie non demandee (plantage pendant le demarrage ou en marche) : failService
    // ignore les sorties provoquees par notre propre arret.
    launchProcess.on('exit', (code) => failService(h, { kind: 'exited', code }))

    const ports = await waitForPorts(launchProcess, (line) => {
      serviceLog(h, line, true)
      watchStartupCrash(h, line)
    }, 60000, true)
    if (h.state !== 'starting') return startOutcome(h)
    if (!ports) {
      failService(h, { kind: 'no-ports' })
      return startOutcome(h)
    }
    h.port = ports.backendPort
    serviceLog(h, `Port reel : backend=${ports.backendPort} (pas de frontend)`)
    rememberToken(ports.token, ports.backendPort)

    if (h.target) {
      const busy = await findBusyLocalPorts([ports.backendPort])
      if (h.state !== 'starting') return startOutcome(h)
      if (busy.length) {
        failService(h, { kind: 'busy-port', ports: busy })
        return startOutcome(h)
      }
      serviceLog(h, `Client ssh : ${await describeSshClient()}`)
      const tunnel = openTunnelPorts(h.target, [ports.backendPort])
      h.procs.push(tunnel)
      tunnel.on('error', (err) => failService(h, { kind: 'tunnel', detail: `ssh impossible a lancer : ${err.message}` }))
      watchTunnel(tunnel, (msg, fatal) => {
        if (h.logStream.writableEnded) return   // service deja arrete : tunnel tue par nous
        serviceLog(h, msg)
        if (fatal) failService(h, { kind: 'tunnel', detail: msg })
      })
      serviceLog(h, `Tunnel ouvert (local ${ports.backendPort} -> ${h.target}).`)
    }

    // /health seulement : le modele se charge a la demande et l'index a son
    // propre etat (cf. pollServiceIndex), ils ne conditionnent pas "pret".
    const ready = await waitUntilBackendReady(
      ports.backendPort, SERVICE_START_TIMEOUT_MS, h.abort.signal,
      () => serviceLog(h, 'Service en cours de demarrage...'),
    )
    if (h.state !== 'starting') return startOutcome(h)
    if (!ready) {
      failService(h, { kind: 'not-ready' })
      return startOutcome(h)
    }
    h.state = nextServiceState(h.state, 'ready')
    serviceLog(h, 'Pret.')
    broadcastService(id)
    void pollServiceIndex(h)
    return { ok: true }
  } catch (e) {
    failService(h, { kind: 'exception', detail: (e as Error).message })
    return startOutcome(h)
  }
}

/** Attend la fin d'un process, au plus SERVICE_EXIT_WAIT_MS (taskkill est asynchrone). */
function waitProcessExit(p: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (p.exitCode !== null || p.signalCode !== null) { resolve(); return }
    const timer = setTimeout(resolve, SERVICE_EXIT_WAIT_MS)
    p.once('exit', () => { clearTimeout(timer); resolve() })
  })
}

async function stopService(id: string): Promise<void> {
  const h = services.get(id)
  if (!h || h.state === 'stopping') return
  const next = nextServiceState(h.state, 'stop')
  h.state = next
  h.message = ''
  if (next === 'off') {
    // Etait en erreur : plus rien ne tourne, on efface juste l'etat.
    services.delete(id)
    broadcastService(id)
    return
  }
  broadcastService(id)
  serviceLog(h, 'Arret demande -- process arretes.')
  const procs = [...h.procs]
  releaseService(h)
  await Promise.all(procs.map(waitProcessExit))
  h.state = nextServiceState(h.state, 'stopped')
  if (services.get(id) === h) services.delete(id)
  broadcastService(id)
}

// ---- Etat de l'index : sonde periodique tant que le service est pret ----

function guardHandle(h: ServiceHandle | undefined): ServiceError | null {
  return serviceGuard({ state: h?.state ?? 'off', message: h?.message ?? '' })
}

async function refreshServiceIndex(h: ServiceHandle): Promise<{ ok: true; index: IndexSummary } | ServiceError> {
  const refused = guardHandle(h)
  if (refused || h.port === null) return refused ?? serviceError('unreachable', 'Service indisponible.')
  const r = await forwardToService(h.port, '/index/status', { timeoutMs: STATUS_TIMEOUT_MS })
  if (!r.ok) return r
  const index = summarizeIndexStatus(r.data)
  if (!index) return serviceError('http', 'Etat de l\'index illisible.')
  if (h.state === 'ready' && JSON.stringify(index) !== JSON.stringify(h.index)) {
    h.index = index
    broadcastService(h.id)
  }
  return { ok: true, index }
}

async function pollServiceIndex(h: ServiceHandle): Promise<void> {
  if (h.pollTimer) clearTimeout(h.pollTimer)
  h.pollTimer = null
  await refreshServiceIndex(h)
  if (h.state !== 'ready') return
  const busy = h.index?.syncing || (h.index?.modelAvailable && !h.index.modelLoaded)
  h.pollTimer = setTimeout(() => void pollServiceIndex(h), busy ? INDEX_POLL_SYNCING_MS : INDEX_POLL_IDLE_MS)
}

// ---- Pont de la fenetre Documentation (le renderer n'atteint jamais le port) ----

function readyDocsService(): { h: ServiceHandle; port: number } | ServiceError {
  const h = services.get('docs')
  const refused = guardHandle(h)
  if (refused || !h || h.port === null) return refused ?? serviceError('off', 'Docs Assistant est eteint.')
  return { h, port: h.port }
}

async function docsSearch(raw: unknown): Promise<{ ok: true; result: NonNullable<ReturnType<typeof mapSearchResponse>> } | ServiceError> {
  const request = validateSearchRequest(raw)
  if (!request.ok) return request
  const target = readyDocsService()
  if ('ok' in target) return target
  const r = await forwardToService(target.port, '/search', { method: 'POST', body: toServiceBody(request.value), timeoutMs: SEARCH_TIMEOUT_MS })
  if (!r.ok) return r
  const result = mapSearchResponse(r.data)
  return result ? { ok: true, result } : serviceError('http', 'Reponse du service illisible.')
}

async function docsIndexStatus(): Promise<{ ok: true; index: IndexSummary } | ServiceError> {
  const target = readyDocsService()
  return 'ok' in target ? target : refreshServiceIndex(target.h)
}

async function docsSync(): Promise<{ ok: true; started: boolean } | ServiceError> {
  const target = readyDocsService()
  if ('ok' in target) return target
  const r = await forwardToService(target.port, '/index/sync', { method: 'POST', timeoutMs: STATUS_TIMEOUT_MS })
  if (!r.ok) return r
  // Affiche l'avancement tout de suite plutot qu'au prochain tick de la sonde.
  void pollServiceIndex(target.h)
  return { ok: true, started: (r.data as { started?: unknown } | null)?.started === true }
}

// ---- IPC : catalogue + reglages + lancement ----

ipcMain.handle('cv:list-apps', () => APPS)
ipcMain.handle('cv:list-services', () => SERVICES)
ipcMain.handle('cv:get-service-status', (_e, id: unknown) => serviceStatus(String(id)))
ipcMain.handle('cv:start-service', (_e, id: unknown) => startService(String(id)))
ipcMain.handle('cv:stop-service', (_e, id: unknown) => stopService(String(id)))
// Fenetre Documentation : memes actions, limitees au service "docs" -- pas
// d'id venu du renderer, pas de port expose.
ipcMain.handle('cv:docs-service-status', () => serviceStatus('docs'))
ipcMain.handle('cv:docs-service-start', () => startService('docs'))
ipcMain.handle('cv:docs-service-stop', () => stopService('docs'))
ipcMain.handle('cv:docs-search', (_e, request: unknown) => docsSearch(request))
ipcMain.handle('cv:docs-index-status', () => docsIndexStatus())
ipcMain.handle('cv:docs-sync', () => docsSync())
ipcMain.handle('cv:open-docs', (_e, tab?: unknown) => openDocsWindow(tab === 'ask' ? 'ask' : undefined))
ipcMain.handle('cv:get-settings', () => loadSettings())
ipcMain.handle('cv:save-settings', (_e, s: LauncherSettings) => saveSettings(s))
ipcMain.handle('cv:check-mount', (_e, host: string) => refreshMountStatus(host))
// Etat des tutoriels interactifs -- lisible/ecrivable AUSSI par les frontends
// des apps chargees dans un onglet (cf. preloadApp.ts) : c'est le lanceur qui
// detient le "deja vu", pas le workspace de chaque app.
ipcMain.handle('cv:get-tutorial', (_e, key: string) => getTutorialState(key))
ipcMain.handle('cv:set-tutorial', (_e, key: string, patch: Partial<TutorialState>) =>
  setTutorialState(key, patch))
ipcMain.handle('cv:switch-tab', (_e, appId: string | null) => {
  // Un onglet detache n'est pas "activable" (pas dans dockedTabs) -- on
  // ramene juste sa fenetre au premier plan, cf. step "jongler facilement".
  if (appId && detachedTabs.has(appId)) {
    detachedTabs.get(appId)!.win.focus()
    return
  }
  activateTab(appId)
})
ipcMain.handle('cv:close-tab', (_e, appId: string) => closeTab(appId))
// Bouton "Stop" du panneau de logs -- couvre les 3 etats possibles d'un
// appId : onglet docke (closeTab), onglet detache (meme mecanique que
// fermer sa fenetre), ou encore en phase 'launching' (aucun onglet/vue
// n'existe encore -- on tue directement les process suivis dans
// launchingProcs ; userStoppedLaunch permet a cv:launch de rapporter
// 'closed' plutot que 'error' une fois le process mort constate).
ipcMain.handle('cv:stop-app', (_e, appId: string) => {
  if (findService(appId)) { void stopService(appId); return }
  if (dockedTabs.has(appId)) { closeTab(appId); return }
  const detached = detachedTabs.get(appId)
  if (detached) { detached.win.close(); return }
  const procs = launchingProcs.get(appId)
  if (procs) {
    userStoppedLaunch.add(appId)
    for (const p of procs) killProcessTree(p)
    launchAbort.get(appId)?.abort()
  }
})
// "Tout arreter" -- filet de securite explicite. En theorie chaque app se
// ferme deja proprement avec son onglet, mais trois cas y echappent : une
// sous-app Orchestrator (spawnee par SON backend, jamais un enfant de ce
// process), un lancement encore en phase 'launching' sans onglet, et surtout
// tout process d'une session PRECEDENTE reste orphelin sur la VM partagee
// (crash, cable debranche) -- invisible dans l'UI mais tenant toujours son
// port. On enchaine donc les trois niveaux : arret propre des onglets,
// stop-all Orchestrator, puis kill par port sur tout ce qui reste et qu'on
// sait etre a nous (knownPorts).
ipcMain.handle('cv:kill-all', async () => {
  const settings = loadSettings()
  const vm = settings.selectedVm.trim()
  // Registre VM relu a l'instant : il est la seule trace des sous-apps d'un
  // Orchestrator deja ferme. Sans lui, "Tout arreter" apres fermeture de
  // l'onglet Orchestrator partait avec 0 port (rapport 2026-09-24).
  if (vm) await scanRemotePorts(vm).catch(() => [])
  // Snapshot AVANT de fermer quoi que ce soit : closeTab/stopOrchestratorPolling
  // vident dockedTabs et lastSubApps, on n'aurait plus les ports ensuite.
  const localPorts = [...new Set(knownPorts().map((k) => k.port))]
  // Registre VM partage : seulement NOS instances, pas celles des collegues.
  const me = settings.username.trim()
  const remotePorts = [...new Set([
    ...localPorts,
    ...remoteRegistryPorts.filter((r) => r.user === me).map((r) => r.port),
  ])]
  let stopped = 0

  await stopAllOrchestratorSubApps()
  for (const id of [...services.keys()]) { await stopService(id); stopped++ }
  for (const appId of [...dockedTabs.keys()]) { closeTab(appId); stopped++ }
  for (const tab of [...detachedTabs.values()]) { tab.win.close(); stopped++ }
  for (const [appId, procs] of [...launchingProcs.entries()]) {
    userStoppedLaunch.add(appId)
    for (const p of procs) killProcessTree(p)
    launchAbort.get(appId)?.abort()
    stopped++
  }

  // Kill par port en dernier : ce qui a repondu au-dessus est deja mort, tuer
  // un port libre est un no-op silencieux. C'est ce passage qui recupere les
  // orphelins qu'aucune structure en memoire ne connait plus.
  const [local, remote] = await Promise.all([
    killPortsLocal(localPorts),
    vm ? killPortsRemote(vm, remotePorts) : Promise.resolve<KillResult>({ ok: true, failed: [] }),
  ])
  const errors = [
    ...(local.ok ? [] : [`local ${local.failed.join(',')} : ${local.error}`]),
    ...(remote.ok ? [] : [`${vm} ${remote.failed.join(',')} : ${remote.error}`]),
  ]
  return {
    stopped,
    ports: new Set([...localPorts, ...remotePorts]).size,
    failed: local.failed.length + remote.failed.length,
    error: errors.join('\n') || undefined,
  }
})
ipcMain.handle('cv:cleanup-vm', async () => {
  const s = loadSettings()
  const vm = s.selectedVm.trim()
  if (!vm) return { ok: false, killed: 0, error: 'Aucune VM selectionnee' }
  return cleanupRemoteSuite(vm, s.cvRoot)
})
ipcMain.handle('cv:detach-tab', (_e, appId: string, screenX: number, screenY: number) => detachTab(appId, screenX, screenY))
ipcMain.handle('cv:dock-tab', (_e, appId: string) => dockTab(appId))
ipcMain.handle('cv:report-content-bounds', (_e, bounds: { x: number; y: number; width: number; height: number }) => {
  contentBounds = sanitizeContentBounds(bounds)
  applyLayout()   // re-tuile toutes les vues (auto-rescale du split au resize)
})
ipcMain.handle('cv:set-shell-overlay', (_e, open: boolean) => {
  shellOverlayOpen = Boolean(open)
  if (shellOverlayOpen) hideDockedViews()
  else applyLayout()
})

// ── Dock / split : mode composition guide ─────────────────────────────────────
// Le renderer pilote une UI de composition (overlay bleu + vignettes). Le main
// se contente de : masquer les vues natives pendant la composition (pour que
// l'overlay HTML soit visible/interactif), fournir la geometrie des volets, et
// appliquer le layout final choisi.
ipcMain.handle('cv:set-layout-mode', (_e, mode: LayoutMode) => {
  if (mode === 'single' || mode === 'v2' || mode === 'h2' || mode === 'grid4') setLayoutMode(mode)
})
// Entre en composition pour `mode` : masque toutes les vues natives et renvoie la
// geometrie des volets (pour dessiner les carres bleus au bon endroit).
ipcMain.handle('cv:begin-dock-compose', (_e, mode: LayoutMode) => {
  for (const { view } of dockedTabs.values()) { try { view.setVisible(false) } catch { /* */ } }
  return slotBoundsFor(mode === 'v2' || mode === 'h2' || mode === 'grid4' ? mode : 'single')
})
// Applique le layout final (mode + affectation des volets) puis tuile les vues.
ipcMain.handle('cv:apply-dock', (_e, mode: LayoutMode, panes: (string | null)[]) => {
  if (!(mode === 'single' || mode === 'v2' || mode === 'h2' || mode === 'grid4')) return
  const n = paneCount(mode)
  const next: (string | null)[] = []
  for (let i = 0; i < n; i++) {
    const id = panes && panes[i]
    next.push(id && dockedTabs.has(id) ? id : null)
  }
  layoutMode = mode
  paneTabs = next
  if (activeTabId === null) activeTabId = next.find((id) => id) ?? null
  applyLayout()
})
ipcMain.handle('cv:resize-dock', (_e, axis: 'x' | 'y', ratio: number) => {
  const safe = Math.max(0.2, Math.min(0.8, Number(ratio) || 0.5))
  if (axis === 'x') splitRatioX = safe
  if (axis === 'y') splitRatioY = safe
  resizeLayoutViews()
})
ipcMain.handle('cv:toggle-active-sidebar', () => activeTabId ? toggleAppSidebar(activeTabId) : false)
// Annule la composition : restaure le layout committe (re-affiche les vues).
ipcMain.handle('cv:cancel-dock', () => { applyLayout() })
ipcMain.handle('cv:reorder-tabs', (_e, order: string[]) => {
  tabOrder = order
  broadcastTabs()
})
// Le flyout des sous-apps (#subAppsFlyout, HTML de la fenetre catalog) est
// TOUJOURS rendu SOUS la WebContentsView de l'app active (limitation Electron :
// une vue enfant se composite au-dessus du webContents de la fenetre, sans
// relation de z-index avec le HTML). Plutot que de MASQUER toute la vue (ce qui
// revelait le catalog VisionNexus derriere -> l'utilisateur se croyait projete
// hors de l'onglet), on ROGNE la vue par le haut jusqu'au bas du flyout
// (`clipBottom`, coord fenetre) : l'app reste visible dessous, seul le fin bandeau
// du flyout est libere. Fermeture (open=false) -> restauration des bounds pleins.
// Conserve pour compat (plus appele par le nouveau menu natif) : garantit juste
// que la vue active est pleine et visible, ne masque/rogne JAMAIS.
ipcMain.handle('cv:set-subapps-flyout', (_e, _open?: boolean) => {
  if (!activeTabId || shellOverlayOpen) return
  const tab = dockedTabs.get(activeTabId)
  try { tab?.view.setBounds(slotBounds()[0]); tab?.view.setVisible(true) } catch { /* vue deja retiree */ }
})

// Menu NATIF des sous-apps Orchestrator (remplace le flyout HTML) : un menu
// natif se rend au niveau OS, TOUJOURS au-dessus des WebContentsView -- fini le
// probleme de z-index qui masquait/splittait la vue (une vue enfant Electron se
// composite toujours au-dessus du HTML de la fenetre, donc un menu HTML debordant
// sur l'onglet actif etait cache derriere ou obligeait a masquer la vue).
ipcMain.handle('cv:show-subapps-menu', async () => {
  if (!catalogWindow) return
  // Rafraichit le cache juste avant de construire le menu : apres un reload
  // d'Orchestrator, le premier poll peut ne pas encore avoir repondu et le
  // menu annoncait alors a tort qu'aucune sous-app n'etait connue.
  await refreshOrchestratorSubApps()
  const apps = Object.values(lastSubApps)
  const fr = loadSettings().uiLanguage === 'fr'
  // `launched` signifie seulement qu'une session a deja ete enregistree. Les
  // sessions stopped/error doivent rester relancables depuis le menu natif.
  const launched = apps.filter((a) => a.status === 'starting' || a.status === 'running').length
  const template: Electron.MenuItemConstructorOptions[] = [
    { label: `${fr ? 'Lancer tout' : 'Launch all'}  (${launched}/${apps.length})`,
      enabled: apps.length > 0 && launched < apps.length,
      click: () => void launchAllOrchestratorSubApps() },
    { type: 'separator' },
  ]
  if (apps.length === 0) {
    template.push({ label: fr ? 'Orchestrator ne connait aucune sous-app' : 'Orchestrator knows no sub-app', enabled: false })
  }
  for (const a of apps) {
    if (a.status === 'running') {
      template.push({ label: `● ${a.label}`, submenu: [
        { label: fr ? 'Ouvrir (onglet)' : 'Open (tab)', click: () => void openOrchestratorSubApp(a.app_id) },
        { label: fr ? 'Ouvrir (navigateur)' : 'Open (browser)', click: () => void openOrchestratorSubAppInBrowser(a.app_id) },
      ] })
    } else if (a.launched && a.status === 'starting') {
      template.push({ label: `○ ${a.label}  (${fr ? 'demarrage...' : 'starting...'})`, enabled: false })
    } else {
      template.push({ label: `○ ${a.label}  --  ${fr ? 'Lancer' : 'Launch'}`, click: () => void launchOrchestratorSubApp(a.app_id) })
    }
  }
  Menu.buildFromTemplate(template).popup({ window: catalogWindow })
})
ipcMain.handle('cv:open-orchestrator-subapp', (_e, subAppId: string) => openOrchestratorSubApp(subAppId))
ipcMain.handle('cv:open-orchestrator-subapp-browser', (_e, subAppId: string) => openOrchestratorSubAppInBrowser(subAppId))
ipcMain.handle('cv:launch-orchestrator-subapp', (_e, subAppId: string) => launchOrchestratorSubApp(subAppId))
ipcMain.handle('cv:launch-all-orchestrator-subapps', () => launchAllOrchestratorSubApps())
ipcMain.handle('cv:get-tab-url', (_e, appId: string) => getTabUrl(appId))
// L'URL copiee est un lien d'amorcage (usage unique, ~2 min) : l'URL nue
// ouvrirait l'app sans jeton dans un autre navigateur, donc vide.
ipcMain.handle('cv:copy-tab-url', async (_e, appId: string) => {
  const url = getTabUrl(appId)
  if (!url) return false
  try {
    clipboard.writeText((await bootstrapUrl(url)) ?? url)
  } catch {
    clipboard.writeText(url)
  }
  return true
})
ipcMain.handle('cv:open-tab-in-browser', async (_e, appId: string) => {
  const url = getTabUrl(appId)
  if (!url) return false
  return (await openInExternalBrowser(url)).ok
})
ipcMain.handle('cv:scan-ports', async () => {
  const vm = loadSettings().selectedVm.trim()
  const [local, remote] = await Promise.all([
    scanLocalPorts().catch(() => [] as PortRow[]),
    vm ? scanRemotePorts(vm).catch(() => [] as PortRow[]) : Promise.resolve(null),
  ])
  const known = [...knownPorts(), ...(vm ? remoteRegistryPorts : [])]
  if (!vm) remoteRegistryPorts = []
  return { local, remote: vm ? { vm, rows: remote ?? [] } : null, known }
})
ipcMain.handle('cv:kill-port', async (_e, target: 'local' | 'remote', port: number): Promise<KillResult> => {
  if (target === 'remote') {
    const vm = loadSettings().selectedVm.trim()
    if (!vm) return { ok: false, failed: [port], error: 'Aucune VM selectionnee' }
    return killPortRemote(vm, port)
  }
  return killPortLocal(port)
})

// Toute la separation multi-utilisateur (workspaces <app>_<user>, cles du
// registre de ports partage "<app>:<user>") repose sur cet identifiant. Un nom
// generique fait silencieusement retomber deux personnes sur le MEME workspace
// et la MEME base SQLite. Le backend Orchestrator refuse desormais de demarrer
// dans ce cas (backend/config.py) ; on l'attrape ici, avant le lancement, pour
// expliquer le probleme au lieu d'un traceback Python dans le journal.
const PLACEHOLDER_USERNAMES = ['unknown', 'user', 'default', 'none', 'null', 'admin', 'test']
function placeholderUsername(username: string): boolean {
  return PLACEHOLDER_USERNAMES.includes(username.trim().toLowerCase())
}

async function showPlaceholderUserDialog(username: string): Promise<void> {
  const opts = {
    type: 'warning' as const,
    title: 'Identifiant utilisateur non valable',
    message: `L'identifiant "${username}" n'est pas nominatif.`,
    detail: [
      'VisionNexus separe chaque utilisateur par cet identifiant : workspace'
      + ' (<app>_<identifiant>), base de donnees, caches et reservation des ports.',
      'Avec un nom generique, deux personnes sur la meme machine ou la meme VM'
      + ' partageraient sans avertissement le meme workspace et la meme base SQLite'
      + ' -- projets melanges, annotations ecrasees, ports revendiques en double.',
      'Ouvre Parametres et mets ton identifiant reel (ton login), puis relance.',
    ].join(`

`),
    buttons: ['Compris'],
    noLink: true,
  }
  if (catalogWindow) await dialog.showMessageBox(catalogWindow, opts)
  else await dialog.showMessageBox(opts)
}

ipcMain.handle('cv:launch', async (_e, appId: string) => {
  const appDef = findApp(appId)
  if (!appDef) return { ok: false, error: 'App inconnue' }
  // Deja lancee (onglet docke OU detache existant) : reclic sur la tuile =
  // juste y basculer/re-focaliser, pas de 2e lancement par-dessus (evite un
  // doublon de process). notifyStatus('running') corrige l'etat 'launching'
  // que catalog.html affiche de façon optimiste au clic, avant meme de savoir
  // si c'est un vrai lancement ou juste un changement d'onglet.
  if (dockedTabs.has(appId)) {
    activateTab(appId)
    notifyStatus(appId, 'running')
    return { ok: true }
  }
  if (detachedTabs.has(appId)) {
    detachedTabs.get(appId)!.win.focus()
    notifyStatus(appId, 'running')
    return { ok: true }
  }
  const settings = loadSettings()
  // Garde cote main process : ne JAMAIS spawner avec des champs vides (ex.
  // cvRoot="" -> `cd /d ""` fait planter cmd.exe avec une erreur cryptique).
  // La grille catalogue desactive deja les tuiles si invalide (catalog.html),
  // mais cette verification cote serveur est la vraie garantie -- l'UI seule
  // peut rater un cas (ordre d'init, appel direct...).
  if (!isValid(settings)) {
    return { ok: false, error: 'Renseigne Utilisateur / Workspace / Racine / Conda dans Parametres avant de lancer une app.' }
  }
  const badUser = placeholderUsername(settings.username)
  if (badUser) {
    await showPlaceholderUserDialog(settings.username)
    return { ok: false, error: `Identifiant "${settings.username}" non nominatif -- change-le dans Parametres.` }
  }

  const { stream: logStream, filePath: logPath } = openLogFile(appId)
  const send = (line: string): void => {
    const clean = stripAnsi(line)
    safeSend('cv:log', appId, clean)
    logStream.write(clean + '\n')
  }

  notifyStatus(appId, 'launching')

  try {
    send(`Lancement de ${appDef.label}${settings.selectedVm ? ` sur ${settings.selectedVm}` : ' (local)'}...`)
    send(`Log complet : ${logPath}`)
    const { launchProcess } = launchApp(appDef, settings)
    const procs: ChildProcess[] = [launchProcess]
    launchingProcs.set(appId, procs)
    const abortCtrl = new AbortController()
    launchAbort.set(appId, abortCtrl)

    // Ports REELS annonces par launcher.py -- jamais les defauts du catalogue
    // (allocation dynamique cote launcher_engine.py, cf. sshLauncher.ts).
    const ports = await waitForPorts(launchProcess, send)
    if (!ports) {
      launchingProcs.delete(appId)
      launchAbort.delete(appId)
      const stopped = userStoppedLaunch.delete(appId)
      const msg = stopped
        ? 'Lancement arrete par l\'utilisateur.'
        : 'launcher.py n\'a jamais annonce ses ports (verifie la connexion/les identifiants).'
      send(stopped ? msg : `[erreur] ${msg}`)
      killProcessTree(launchProcess)
      logStream.end()
      notifyStatus(appId, stopped ? 'closed' : 'error', stopped ? '' : msg)
      return { ok: false, error: stopped ? 'Arrete par l\'utilisateur' : 'Ports jamais annonces' }
    }
    send(`Ports reels : backend=${ports.backendPort} frontend=${ports.frontendPort}`)
    if (ports.token) {
      rememberToken(ports.token, ports.backendPort, ports.frontendPort)
      await setSessionCookie(ports.backendPort, ports.token)
    } else {
      send('[auth] aucun jeton annonce : backend sans protection (lanceur ancien ou CV_AUTH=0).')
    }

    if (settings.selectedVm) {
      // Verification AVANT de lancer ssh : les ports viennent d'etre alloues sur
      // la VM et sont recopies tels quels en local. S'ils sont deja pris ici,
      // ExitOnForwardFailure=yes tue ssh et on ne recoltait qu'un code de sortie
      // nu, sans savoir quel port bloquait ni que le probleme etait local.
      const busy = await findBusyLocalPorts([ports.backendPort, ports.frontendPort])
      if (busy.length) {
        const msg = `Port(s) local/locaux deja occupe(s) sur ce poste : ${busy.join(', ')}.`
          + ' Le tunnel ne peut pas les forwarder (ExitOnForwardFailure). Cause habituelle :'
          + ' un tunnel orphelin d\'une session precedente, ou une autre instance du lanceur.'
          + ' Fermez l\'autre instance ou tuez les ssh.exe restants, puis relancez.'
        launchingProcs.delete(appId)
        launchAbort.delete(appId)
        userStoppedLaunch.delete(appId)
        send(`[erreur] ${msg}`)
        killProcessTree(launchProcess)
        logStream.end()
        notifyStatus(appId, 'error', msg)
        return { ok: false, error: msg }
      }
      // Quel client ssh a reellement tourne : determinant pour lire un code de
      // sortie inhabituel (cf. watchTunnel), et invisible autrement.
      send(`Client ssh : ${await describeSshClient()}`)
      const tunnel = openTunnel(settings.selectedVm, ports.backendPort, ports.frontendPort)
      procs.push(tunnel)
      watchTunnel(tunnel, (msg, fatal) => {
        if (logStream.writableEnded) return   // app deja arretee : tunnel tue par nous
        send(msg)
        if (fatal) tunnelProblems.set(appId, msg)
      })
      send(`Tunnel ouvert (local ${ports.backendPort} + ${ports.frontendPort} -> ${settings.selectedVm}).`)
    }

    const ready = await waitUntilReady(ports.frontendPort, 60000, abortCtrl.signal)
    // Vite pret ne veut PAS dire application prete : le backend (torch/CUDA,
    // SAM2, XFeat) met encore 10 a 40 s. Ouvrir l'onglet des maintenant fait
    // partir les requetes d'amorcage du frontend dans le vide -- l'app
    // s'affiche alors vide et sans projet, definitivement (cf.
    // waitUntilBackendReady). On attend donc les DEUX.
    const backendReady = ready && await waitUntilBackendReady(
      ports.backendPort,
      120000,
      abortCtrl.signal,
      () => send('Backend en cours de demarrage (chargement des modeles)...'),
    )
    // Un port qui repond alors que NOTRE forward a echoue = ce n'est pas notre
    // app au bout du fil (tunnel orphelin d'une session precedente).
    const tunnelProblem = tunnelProblems.get(appId)
    if (tunnelProblem) {
      tunnelProblems.delete(appId)
      launchingProcs.delete(appId)
      launchAbort.delete(appId)
      userStoppedLaunch.delete(appId)
      send(`[erreur] ${tunnelProblem}`)
      for (const p of procs) killProcessTree(p)
      killProcessTree(launchProcess)
      logStream.end()
      notifyStatus(appId, 'error', tunnelProblem)
      return { ok: false, error: tunnelProblem }
    }
    if (!ready || !backendReady) {
      launchingProcs.delete(appId)
      launchAbort.delete(appId)
      const stopped = userStoppedLaunch.delete(appId)
      const what = ready ? 'le backend ne repond pas apres 120s' : 'le serveur ne repond pas apres 60s'
      const msg = stopped ? 'Lancement arrete par l\'utilisateur.' : `${what}.`
      send(stopped ? msg : `[timeout] ${msg}`)
      for (const p of procs) killProcessTree(p)
      logStream.end()
      notifyStatus(appId, stopped ? 'closed' : 'error', stopped ? '' : msg)
      return { ok: false, error: stopped ? 'Arrete par l\'utilisateur' : `Timeout : ${what}` }
    }
    launchingProcs.delete(appId)
    launchAbort.delete(appId)

    // Lancement local (pas de VM) : force le chemin natif dispo pour TOUTE
    // requete image.ts, meme si aucun hote SMB n'a jamais ete configure --
    // to_native_share_path() gere deja ce cas cote backend (chemin C:\... renvoye tel
    // quel). Limite connue : ce flag est global (pas par-app), donc si un
    // onglet local ET un onglet VM tournent en meme temps, l'onglet VM tente
    // aussi le chemin natif -- sans risque, il retombe juste en HTTP comme
    // avant si son hote n'est pas joignable (le repli reste automatique).
    if (!settings.selectedVm) setNativeMountAvailable(true)
    const badgeStatus = nativeBadgeStatus(appId, !settings.selectedVm)
    send(badgeStatus.supported
      ? `Chemin natif : ${badgeStatus.active ? 'actif' : 'repli HTTP'} (${badgeStatus.reason})`
      : 'Chemin natif : non supporte par cette app, HTTP normal.')

    send('Pret -- ouverture de l\'onglet.')
    // logStream reste ouvert : closeTab/detachTab le ferment a la fermeture
    // de l'onglet/fenetre -- les logs continuent d'etre captures tant que
    // l'app tourne, pas seulement pendant la phase de lancement.
    createAppTab(appId, ports.frontendPort, procs, logStream, badgeStatus, { backendPort: ports.backendPort })
    notifyStatus(appId, 'running')

    if (appId === 'orchestrator') {
      orchestratorInfo = { backendPort: ports.backendPort, isLocal: !settings.selectedVm, vm: settings.selectedVm }
      if (orchestratorPollTimer) clearInterval(orchestratorPollTimer)
      void pollOrchestratorSubApps()
      // 1s (pas 4s) : denyPopupsOpenExternal() decide en synchrone, a partir
      // de ce cache, si un lien ouvert DANS la page Orchestrator correspond a
      // une sous-app connue (voir commentaire la-bas). Une sous-app tout
      // juste lancee depuis "Launch"/"Launch All" n'apparait dans ce cache
      // qu'au poll suivant -- 4s de decalage possible faisait rater la
      // fenetre du setTimeout(2000ms) cote AppsPage.tsx avant l'ouverture du
      // lien, et le clic fuyait vers le navigateur systeme.
      orchestratorPollTimer = setInterval(() => void pollOrchestratorSubApps(), 1000)
    }
    return { ok: true }
  } catch (e) {
    launchingProcs.delete(appId)
    launchAbort.delete(appId)
    userStoppedLaunch.delete(appId)
    const msg = (e as Error).message
    send(`[erreur] ${msg}`)
    logStream.end()
    notifyStatus(appId, 'error', msg)
    return { ok: false, error: msg }
  }
})

ipcMain.handle('cv:open-logs-folder', () => shell.openPath(logsDir()))
ipcMain.handle('cv:open-native-path', async (_event, rawPath: string, mappings: WorkspacePathMapping[] = []) => {
  const resolved = resolveClientWorkspacePath(rawPath, Array.isArray(mappings) ? mappings : [])
  if (!resolved.ok) return resolved
  const error = await shell.openPath(resolved.path)
  return error ? { ok: false, path: resolved.path, error } : { ok: true, path: resolved.path }
})

ipcMain.handle('cv:select-native-directory', async () => {
  const owner = BrowserWindow.getFocusedWindow() ?? catalogWindow ?? undefined
  const result = owner
    ? await dialog.showOpenDialog(owner, { properties: ['openDirectory', 'createDirectory'] })
    : await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
  return result.canceled ? null : (result.filePaths[0] ?? null)
})
ipcMain.handle('cv:quit', () => app.quit())
ipcMain.handle('cv:toggle-devtools', () => BrowserWindow.getFocusedWindow()?.webContents.toggleDevTools())

app.whenReady().then(() => {
  // PAS de Menu.setApplicationMenu ici : la barre native Windows (File/Edit/
  // View/Window/Help) est rendue par l'OS, impossible a re-styliser en CSS --
  // reste blanche meme sur un theme sombre. Remplacee par une VRAIE barre
  // HTML custom (catalog.html, header) qui appelle cv:quit/cv:open-docs/
  // cv:open-logs-folder/cv:toggle-devtools ci-dessus. Volontairement AUCUN
  // role d'edition ('undo'/'redo'/'cut'/'copy'/'paste') nulle part dans ce
  // remplacement : le menu natif par defaut les mappait globalement sur la
  // fenetre (Ctrl+Z/Ctrl+Y), interceptant la frappe AVANT qu'elle n'atteigne
  // le listener keydown propre a la page (ex. Undo/Redo custom d'Annotation
  // App sur un canvas Konva, sans champ texte editable a annuler -- le role
  // par defaut n'y faisait donc rien, silencieusement, tout en empechant le
  // handler de l'app de recevoir l'evenement).
  Menu.setApplicationMenu(null)
  pruneOldLogs()
  installRendererAuth()

  registerImageProtocol((event) => {
    const detail = event.mode === 'native'
      ? `lecture native confirmee: ${event.nativePath}`
      : `repli HTTP: ${event.reason ?? 'raison inconnue'} (${event.nativePath})`
    // Le protocole est global, mais seul Annotation App emet actuellement des
    // nativePath de _tracking_tmp. Journaliser dans tous ses onglets ouverts
    // couvre aussi le cas d'une sous-app lancee depuis Orchestrator.
    for (const [id, tab] of [...dockedTabs, ...detachedTabs]) {
      if (id === 'annotation' || id.endsWith('_annotation')) {
        appendLog(id, tab.logStream, `[app-image] ${detail}`)
      }
    }
  })
  createCatalogWindow()

  // Amorce l'etat du montage natif au demarrage (si un hote est deja
  // enregistre) -- sans ca, le tout premier lancement d'une app apres
  // ouverture du catalogue partirait toujours en HTTP (etat initial false)
  // meme si le partage est en realite joignable.
  const initialHost = loadSettings().nativeMountHost
  if (initialHost.trim()) void refreshMountStatus(initialHost)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createCatalogWindow()
  })
})

// Filet de securite ultime avant extinction : que la fermeture vienne de la
// croix OS, d'Alt+F4, ou du menu custom "Quitter" (cv:quit -> app.quit()),
// AUCUN process enfant ne doit survivre au lanceur -- backend/frontend d'une
// app lancee, tunnel SSH -- un "fantome" qui continue de tenir un port en
// arriere-plan, invisible, et qui bloquerait un futur relancement sur ce
// meme port. closeTab()/le handler de fermeture d'une fenetre detachee ne
// couvrent que UN onglet a la fois quand l'utilisateur clique explicitement
// dessus ; ici on tue tout ce qui est encore trace au moment de quitter --
// onglets dockes, onglets detaches, ET un lancement encore 'launching' (pas
// encore promu dans dockedTabs, donc invisible des deux Maps precedentes).
// event.preventDefault() + re-declenchement manuel : stopAllOrchestratorSubApps()
// doit etre ATTENDU avant de tuer l'arbre de process d'Orchestrator (sinon
// on tue le backend qui devait justement transmettre l'ordre d'arret a ses
// propres sous-apps -- l'ordre inverse ne fonctionnerait pas). before-quit
// tel quel est synchrone ; on l'intercepte donc une 1ere fois pour faire le
// nettoyage async, puis on laisse la 2e occurrence (quittingCleanupDone)
// suivre son cours normalement.
let quittingCleanupDone = false
app.on('before-quit', (event) => {
  if (quittingCleanupDone) return
  event.preventDefault()
  void (async () => {
    await stopAllOrchestratorSubApps()
    stopOrchestratorPolling()
    // BLOQUANT ici (killProcessTreeSync) : sinon app.quit() ci-dessous abandonne
    // les taskkill async et l'arbre d'Orchestrator survit (cf. killProcessTreeSync).
    for (const tab of dockedTabs.values()) for (const p of tab.procs) killProcessTreeSync(p)
    for (const tab of detachedTabs.values()) for (const p of tab.procs) killProcessTreeSync(p)
    for (const procs of launchingProcs.values()) for (const p of procs) killProcessTreeSync(p)
    // Aucune ressource de calcul ne survit a la fermeture du lanceur.
    for (const h of services.values()) {
      if (h.pollTimer) clearTimeout(h.pollTimer)
      for (const p of h.procs) killProcessTreeSync(p)
    }
    quittingCleanupDone = true
    app.quit()
  })()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
