// ============================================================
// desktop/src/tunnelClassify.ts
// Classification d'une ligne stderr d'un tunnel `ssh -N -L`. Isole ici, sans
// aucune dependance Electron/Node lourde, pour etre teste unitairement
// (tunnelClassify.test.ts) : c'est le garde-fou qui empeche de re-livrer un exe
// ou un simple "backend pas encore pret" ferait avorter un lancement.
// watchTunnel (sshLauncher.ts) applique le verdict.
// ============================================================

export interface TunnelLineVerdict {
  /** Bruit ssh normal, a tracer sans plus (cle ajoutee, pseudo-terminal, debug). */
  benign: boolean
  /** Echec d'UN forward, pas du tunnel : la cible distante a refuse la connexion
   *  (typiquement le backend charge encore ses modeles et n'ecoute pas encore).
   *  Le tunnel reste ouvert -- transitoire, jamais fatal. */
  transient: boolean
  /** Panne reelle : le forward LOCAL n'a pas pu etre etabli, ou l'hote est
   *  injoignable / la cle refusee. La le lancement doit s'arreter. */
  fatal: boolean
}

const BENIGN = /permanently added|pseudo-terminal|warning: remote host identification|debug[0-9]/i

// "channel N: open failed: connect failed: ..." vient d'UNE connexion forwardee
// qui a echoue (client local connecte, cible distante indisponible), pas du
// tunnel : ExitOnForwardFailure ne couvre que la mise en place initiale du
// forward local, pas ces echecs par canal. Au demarrage c'est le cas normal --
// le backend distant n'ecoute pas encore. La sonde de readiness tranche ensuite
// si le backend finit par repondre.
const TRANSIENT = /channel \d+: open failed|connect failed/i

const FATAL = /address already in use|cannot listen|bind:|permission denied|could not resolve|connection (refused|closed|timed out)|host key verification failed/i

/**
 * Classe une ligne stderr ssh. L'ordre compte : une ligne transitoire contient
 * "connection refused" (donc matche FATAL) mais ne doit JAMAIS etre fatale --
 * sinon elle fait avorter un lancement qui aboutit une fois les modeles charges.
 */
export function classifyTunnelLine(text: string): TunnelLineVerdict {
  const benign = BENIGN.test(text)
  const transient = !benign && TRANSIENT.test(text)
  const fatal = !benign && !transient && FATAL.test(text)
  return { benign, transient, fatal }
}
