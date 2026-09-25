// ============================================================
// i18n/translate.ts
// Traduction FR -> EN a l'affichage. Le francais reste la source de
// verite dans le code (comme dans FrameViewer/frameviewer/ui/i18n.py) :
// on n'introduit pas de cles semantiques, on enveloppe le texte francais
// existant avec t(...) et ce module fournit la variante anglaise.
//
// Resolution de la langue, par ordre de priorite :
//   1. Parametre ?lang=en|fr dans l'URL : injecte par VisionNexus au
//      lancement quand l'app est pilotee depuis le launcher desktop.
//   2. Preference locale sauvegardee par cette app (mode autonome/modulaire,
//      utile quand l'app tourne hors VisionNexus).
//   3. Anglais par defaut.
// ============================================================

export type Lang = 'en' | 'fr'

const STORAGE_KEY = 'cv-ui-language'
const SUPPORTED: readonly Lang[] = ['en', 'fr']

function isLang(value: string | null): value is Lang {
  return value !== null && (SUPPORTED as readonly string[]).includes(value)
}

function readQueryLang(): Lang | null {
  if (typeof window === 'undefined') return null
  try {
    const value = new URLSearchParams(window.location.search).get('lang')
    return isLang(value) ? value : null
  } catch {
    return null
  }
}

function readStoredLang(): Lang | null {
  if (typeof window === 'undefined') return null
  try {
    const value = window.localStorage.getItem(STORAGE_KEY)
    return isLang(value) ? value : null
  } catch {
    return null
  }
}

let currentLang: Lang = readQueryLang() ?? readStoredLang() ?? 'en'
const listeners = new Set<(lang: Lang) => void>()

export function getLang(): Lang {
  return currentLang
}

export function setLang(lang: Lang): void {
  if (lang === currentLang) return
  currentLang = lang
  try {
    window.localStorage.setItem(STORAGE_KEY, lang)
  } catch {
    // Stockage indisponible (navigation privee) : la preference ne persiste
    // pas entre sessions mais le changement s'applique quand meme.
  }
  listeners.forEach((listener) => listener(lang))
}

export function subscribeLang(listener: (lang: Lang) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// Pilotage desktop : si ?lang= est present au chargement, VisionNexus impose la
// langue et cette app ne doit ni lire ni ecrire la preference workspace.
const desktopPiloted = readQueryLang() !== null

export function isDesktopPiloted(): boolean {
  return desktopPiloted
}

// Repli hors lanceur : au boot, si l'app n'est pas pilotee par VisionNexus, on va
// lire la preference persistee cote workspace (settings.json) et on l'applique.
export async function initWorkspaceLanguage(fetchSettingsLang: () => Promise<Lang | null | undefined>): Promise<void> {
  if (desktopPiloted) return
  try {
    const fromWorkspace = await fetchSettingsLang()
    if (isLang(fromWorkspace ?? null)) setLang(fromWorkspace as Lang)
  } catch {
    // Pas de backend joignable au boot : repli localStorage/anglais.
  }
}

// Change la langue locale, et ne persiste cote workspace que si l'app n'est pas
// pilotee par VisionNexus (sinon ?lang= resterait la source de verite au reload).
export function setLangAndMaybePersist(lang: Lang, persistToWorkspace: (lang: Lang) => void): void {
  setLang(lang)
  if (!desktopPiloted) persistToWorkspace(lang)
}

// Dictionnaire de correspondance exacte FR -> EN, complete au fil de la
// couverture de l'app. Une chaine absente du dictionnaire reste affichee
// en francais meme en mode EN (degradation silencieuse, jamais de texte
// casse ou de cle brute visible).
const EXACT_EN: Record<string, string> = {
  'Dataset source commun': 'Common source dataset',
  'Dataset / subset': 'Dataset / subset',
  'Run MLOps': 'MLOps run',
  'Version DVC': 'DVC version',
  'Artefact': 'Artifact',
  'Run MLflow': 'MLflow run',
  'Modèle': 'Model',
  'Déplier': 'Expand',
  'Replier': 'Collapse',
  'non versionné': 'not versioned',
  'objet suivi par DVC': 'object tracked by DVC',
  'Run fork': 'Fork run',
  'Run mère': 'Parent run',
  ' · vue DVC': ' - DVC view',
  'Expérience complète · source commune, versions Git/DVC et objets suivis':
    'Complete experiment - common source, Git/DVC versions and tracked objects',
  'subset extrait': 'extracted subset',
  'Lineage DVC': 'DVC Lineage',
  'Source commune → run → versions Git/DVC et objets suivis':
    'Common source -> run -> Git/DVC versions and tracked objects',
  'Comparer les runs': 'Compare runs',
  'Afficher la liste': 'Show list',
  'Afficher le graphe': 'Show graph',
  'Décompact': 'Expand all',
  'Compact': 'Compact',
  'Nom, Run ID, dataset…': 'Name, Run ID, dataset...',
  'Chargement…': 'Loading...',
  'Orchestrator indisponible : lineage canonique inaccessible.':
    'Orchestrator unavailable: canonical lineage inaccessible.',
  'Source inconnue': 'Unknown source',
  'versionné': 'versioned',
  'Subset utilisé': 'Subset used',
  'non committé': 'not committed',
  'Commit Git/DVC': 'Git/DVC commit',
  'Aucun commit produit': 'No commit produced',
  'Objets suivis': 'Tracked objects',
  'Aucun objet DVC pour ce run.': 'No DVC object for this run.',
  'Run ID MLOps': 'MLOps Run ID',
  'Historique': 'History',
  'Le lineage n’a pas pu être affiché.': 'The lineage could not be displayed.',
  'Réessayer': 'Retry',

  // --- DatasetsPage ---
  'fichier(s) modifié(s)': 'file(s) modified',
  'fichier(s) manquant(s)': 'file(s) missing',
  'Tous les datasets sont synchronisés': 'All datasets are synchronized',
  'Erreur de chargement. Vérifiez que DVC_REPO_PATH est configuré.':
    'Loading error. Check that DVC_REPO_PATH is configured.',
  'Aucun fichier DVC trouvé': 'No DVC file found',
  'Configurez DVC_REPO_PATH vers un repo git+dvc': 'Configure DVC_REPO_PATH to point to a git+dvc repo',
  'Chemin': 'Path',
  'Fichier DVC': 'DVC file',
  'Taille': 'Size',
  'Statut': 'Status',

  // --- DiffPage ---
  'Entrez deux révisions': 'Enter two revisions',
  'Erreur lors du diff': 'Error while computing the diff',
  'Diff de versions': 'Version diff',
  'Révision A (base)': 'Revision A (base)',
  'hash, HEAD~1, tag…': 'hash, HEAD~1, tag...',
  'Choisir…': 'Choose...',
  'Révision B (cible)': 'Revision B (target)',
  'hash, HEAD, tag…': 'hash, HEAD, tag...',
  'Calcul…': 'Computing...',
  'Calculer le diff': 'Compute diff',
  'Résumé métier': 'Business summary',
  'image(s)': 'image(s)',
  'annotation(s)': 'annotation(s)',
  "Ce diff ne touche pas d'images/annotations directement (le contenu est agrégé dans un dossier DVC — voir le détail fichier ci-dessous).":
    'This diff does not directly affect images/annotations (the content is aggregated in a DVC folder — see the file-by-file detail below).',
  'Utilisé par': 'Used by',
  'run(s) MLflow': 'MLflow run(s)',
  "détails et liens dans le Run Insight de l'Orchestrator.":
    "details and links in the Orchestrator's Run Insight.",
  'Aucun run associé à cette version dans les trailers du commit (info non disponible — non inventée).':
    'No run associated with this version in the commit trailers (information not available — never invented).',
  'ajouté(s)': 'added',
  'supprimé(s)': 'deleted',
  'modifié(s)': 'modified',
  'renommé(s)': 'renamed',
  'Aucune différence DVC entre ces deux révisions': 'No DVC difference between these two revisions',
  'Changement': 'Change',
  'ajouté': 'added',
  'supprimé': 'deleted',
  'modifié': 'modified',

  // DocPage.tsx (pages markdown de docs/)
  'Documentation': 'Documentation',
  'Utilisateur': 'User',
  'Installation et réglages': 'Setup and settings',
  'Développeur': 'Developer',
  'Liste des pages indisponible': 'Page list unavailable',
  'Aucune page de documentation.': 'No documentation page.',
  'Chargement de la documentation…': 'Loading documentation...',
  'Documentation non disponible': 'Documentation unavailable',
  "Cette page n'est pas encore écrite dans le dossier docs/ de l'application.": "This page is not written yet in the app's docs/ folder.",
  "Le backend ne répond pas. Vérifiez qu'il est démarré puis rechargez la page.": 'The backend is not responding. Check that it is running, then reload the page.',
  "Cette page n'est pas encore traduite : version dans l'autre langue.": 'This page is not translated yet: showing the other language.',

  // --- HistoryPage ---
  'Version': 'Version',
  'restaurée': 'restored',
  'Restauration échouée': 'Restore failed',
  'Restaurer cette version ?': 'Restore this version?',
  "Le dossier de travail reviendra exactement à l'état de ce commit (dataset + modèle). Réversible en restaurant une version plus récente.":
    'The working directory will return exactly to the state of this commit (dataset + model). Reversible by restoring a more recent version.',
  'Historique des versions': 'Version history',
  'Chaque commit est': 'Each commit is',
  'une version': 'a version',
  'de vos données/modèles. Le hash (ex.': 'of your data/models. The hash (e.g.',
  ') identifie la version du code + config. Un fichier': ') identifies the code + config version. A',
  "modifié = nouvelle version du dataset ou du modèle qu'il pointe. Les puces":
    'file modified = new version of the dataset or model it points to. The chips',
  "proviennent des trailers posés par l'Orchestrator.": 'come from the trailers set by the Orchestrator.',
  'Aucun commit DVC trouvé': 'No DVC commit found',
  'fichier(s) DVC': 'DVC file(s)',
  "Restaurer cette version (checkout) — ramène le dossier de travail à cet état, sans ligne de commande":
    'Restore this version (checkout) — brings the working directory back to this state, no command line needed',
  'Restaurer': 'Restore',
  'Fichiers DVC modifiés (chacun = une nouvelle version du dataset/modèle pointé) :':
    'Modified DVC files (each one = a new version of the dataset/model it points to):',

  // --- SyncPage ---
  'Working dir re-lié au cache': 'Working dir re-linked to the cache',
  'Relink échoué': 'Relink failed',
  'Remote': 'Remote',
  'Ajout du remote échoué': 'Adding the remote failed',
  'Erreur': 'Error',
  'Terminé': 'Done',
  'terminé': 'done',
  'échoué': 'failed',
  'Envoyer les fichiers trackés vers le remote': 'Send tracked files to the remote',
  'Récupérer les fichiers trackés depuis le remote': 'Fetch tracked files from the remote',
  'Annuler': 'Cancel',
  'Synchronisation': 'Synchronization',
  "= j'envoie les données versionnées (contenu réel pointé par les":
    '= I send the versioned data (actual content pointed to by the',
  ") vers le remote, pour qu'elles soient récupérables ailleurs.": ') to the remote, so it can be retrieved elsewhere.',
  '= je récupère depuis le remote le contenu des versions suivies par le repo.':
    '= I fetch from the remote the content of the versions tracked by the repo.',
  "ici = cette page (Push et Pull DVC) — pas d'abstraction cachée : rien n'est envoyé ni récupéré sans que vous cliquiez.":
    'here = this page (DVC Push and Pull) — no hidden abstraction: nothing is sent or fetched without you clicking.',
  'Remote :': 'Remote:',
  "Aucun remote DVC configuré : Push/Pull n'ont aucune destination. Ajoutez-en un ci-dessous (0 CLI).":
    'No DVC remote configured: Push/Pull have no destination. Add one below (0 CLI).',
  'Nom': 'Name',
  'Destination (dossier local ou url s3://, ssh://…)': 'Destination (local folder or s3://, ssh://... URL)',
  'ex. D:\\dvc_remote  ou  s3://bucket/path': 'e.g. D:\\dvc_remote  or  s3://bucket/path',
  'Ajouter le remote': 'Add remote',
  'Stockage (dé-duplication)': 'Storage (de-duplication)',
  "Calculer l'usage disque": 'Calculate disk usage',
  'Recalculer': 'Recalculate',
  "Le cache DVC stocke chaque fichier une fois (par empreinte md5) : deux versions qui partagent des images ne les stockent qu'une fois. Avec le cache":
    'The DVC cache stores each file once (by md5 fingerprint): two versions that share images only store them once. With the cache',
  'en liens': 'in linked mode',
  '(hardlink/reflink), le working dir ne fait que pointer vers le cache — pas de 2e copie physique.':
    '(hardlink/reflink), the working dir just points to the cache — no 2nd physical copy.',
  'Type cache': 'Cache type',
  'liens': 'linked',
  ' — working dir partagé avec le cache (pas de doublon)': ' — working dir shared with the cache (no duplicate)',
  ' — le working dir est une 2e copie ; relie-le au cache :': ' — the working dir is a 2nd copy; link it to the cache:',
  'Re-lier au cache': 'Re-link to cache',
  'Repo DVC introuvable — rien à mesurer.': 'DVC repo not found — nothing to measure.',

  // components/UserBadge.tsx
  'Ouvrir workspace': 'Open workspace',
  'Historique des workspaces': 'Workspace history',
  'Utilisateurs connectes': 'Connected users',
  'Workspaces recents': 'Recent workspaces',
  'Aucun utilisateur trouve.': 'No user found.',
  '(vous)': '(you)',
  'Ouvrir ce workspace': 'Open this workspace',
  'Aucun workspace utilise recemment.': 'No recently used workspace.',
}

const PHRASE_EN: ReadonlyArray<readonly [string, string]> = [
  // Fallback pour les chaines construites dynamiquement (concatenation,
  // template literals avec variables). Paires de sous-chaines seulement.
]

export function t(fr: string): string {
  if (currentLang !== 'en' || !fr) return fr
  const exact = EXACT_EN[fr]
  if (exact !== undefined) return exact
  const trimmed = fr.trim()
  if (trimmed !== fr) {
    const exactTrimmed = EXACT_EN[trimmed]
    if (exactTrimmed !== undefined) {
      const start = fr.indexOf(trimmed)
      return fr.slice(0, start) + exactTrimmed + fr.slice(start + trimmed.length)
    }
  }
  let out = fr
  for (const [source, target] of PHRASE_EN) {
    if (out.includes(source)) out = out.split(source).join(target)
  }
  return out
}
