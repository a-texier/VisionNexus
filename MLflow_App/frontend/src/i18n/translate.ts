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

// Pilotage desktop : ?lang= est present quand VisionNexus a lance l'app et
// impose la langue. Dans ce cas, le workspace backend ne doit ni fournir ni
// recevoir de preference -- VisionNexus reste l'unique source de verite.
const desktopPiloted = readQueryLang() !== null

export function isDesktopPiloted(): boolean {
  return desktopPiloted
}

// Repli hors lanceur : au boot, si l'app n'est pas pilotee par VisionNexus,
// on interroge le workspace backend (settings.json) pour la derniere langue
// choisie en mode autonome. Echoue silencieusement (pas de backend joignable
// au demarrage) -> repli localStorage/anglais deja gere par currentLang.
export async function initWorkspaceLanguage(fetchSettingsLang: () => Promise<Lang | null | undefined>): Promise<void> {
  if (desktopPiloted) return
  try {
    const fromWorkspace = await fetchSettingsLang()
    if (isLang(fromWorkspace ?? null)) setLang(fromWorkspace as Lang)
  } catch {
    // Pas de backend joignable au boot : repli localStorage/anglais.
  }
}

// Change la langue et, hors pilotage desktop, persiste le choix dans le
// workspace backend (repli). Sous VisionNexus, on change juste l'affichage
// local sans rien ecrire cote workspace.
export function setLangAndMaybePersist(lang: Lang, persistToWorkspace: (lang: Lang) => void): void {
  setLang(lang)
  if (!desktopPiloted) persistToWorkspace(lang)
}

// Dictionnaire de correspondance exacte FR -> EN, complete au fil de la
// couverture de l'app. Une chaine absente du dictionnaire reste affichee
// en francais meme en mode EN (degradation silencieuse, jamais de texte
// casse ou de cle brute visible).
const EXACT_EN: Record<string, string> = {
  // LineagePage.tsx
  'Dataset source commun': 'Common source dataset',
  'Subset utilisé': 'Subset used',
  'Run pipeline unifié': 'Unified pipeline run',
  'Étape MLflow': 'MLflow stage',
  'Artefact': 'Artifact',
  'Modèle': 'Model',
  'Déplier': 'Expand',
  'Replier': 'Collapse',
  'Run fork': 'Fork run',
  'Run mère': 'Parent run',
  ' · vue MLflow': ' · MLflow view',
  'Expérience complète · source commune, runs pipeline et étapes MLflow':
    'Complete experiment · common source, pipeline runs and MLflow stages',
  'Lineage MLflow': 'MLflow lineage',
  'Source commune → run pipeline → étapes, métriques et artefacts MLflow':
    'Common source -> pipeline run -> MLflow stages, metrics and artifacts',
  'Comparer les runs': 'Compare runs',
  'Afficher la liste': 'Show list',
  'Afficher le graphe': 'Show graph',
  'Décompact': 'Expand all',
  'Compact': 'Collapse all',
  'Expérience, Run ID, dataset…': 'Experiment, Run ID, dataset...',
  'Chargement…': 'Loading...',
  'Orchestrator indisponible : lineage canonique inaccessible.':
    'Orchestrator unavailable: canonical lineage unreachable.',
  'Source inconnue': 'Unknown source',
  'étape(s)': 'stage(s)',
  'Étapes MLflow et métriques': 'MLflow stages and metrics',
  'Aucune métrique': 'No metrics',
  'Aucune étape MLflow : le fork s’est interrompu avant Training.':
    'No MLflow stage: the fork stopped before Training.',
  'Run ID MLOps · orch_run_id': 'MLOps Run ID · orch_run_id',
  'Ouvrir le run MLflow détaillé': 'Open the detailed MLflow run',

  // CompareRunsPage.tsx
  'Sélectionnez au moins 2 runs': 'Select at least 2 runs',
  'Erreur lors de la comparaison': 'Error during comparison',
  'Comparer des runs': 'Compare runs',
  '1. Sélectionner une expérience': '1. Select an experiment',
  '— Choisir une expérience —': '-- Select an experiment --',
  '2. Sélectionner les runs à comparer': '2. Select the runs to compare',
  'sélectionné(s)': 'selected',
  'Aucun run dans cette expérience': 'No run in this experiment',
  'Nom': 'Name',
  'Statut': 'Status',
  'Comparaison…': 'Comparing...',
  'Comparer': 'Compare',
  'run(s)': 'run(s)',
  '3. Résultats de comparaison': '3. Comparison results',
  'Paramètres comparés': 'Compared parameters',
  'Paramètre': 'Parameter',

  // ExperimentsPage.tsx
  'Expérience créée': 'Experiment created',
  'Erreur lors de la création': 'Error during creation',
  'Nouvelle expérience': 'New experiment',
  'mon-expérience': 'my-experiment',
  'Annuler': 'Cancel',
  'Création…': 'Creating...',
  'Créer': 'Create',
  'Chargement des runs…': 'Loading runs...',
  'Rôle': 'Role',
  "orch_run_id : la clé unique qui relie ce run à Git, DVC et l'orchestrateur":
    'orch_run_id: the unique key that links this run to Git, DVC and the orchestrator',
  'ID unifié': 'Unified ID',
  'Début': 'Start',
  'Métriques finales': 'Final metrics',
  'fork de': 'fork of',
  "Supprimer l'expérience": 'Delete experiment',
  'Expérience supprimée': 'Experiment deleted',
  'Erreur lors de la suppression': 'Error during deletion',
  'Expériences': 'Experiments',
  'Une': 'A',
  'expérience': 'experiment',
  '= un projet (graphe MLOps) qui regroupe tous ses runs.':
    '= a project (MLOps graph) that groups all its runs.',
  'Le': 'The',
  'rôle': 'role',
  "distingue chaque étape ; l'": 'distinguishes each stage; the',
  '(orch_run_id)': '(orch_run_id)',
  'relie chaque run à Git/DVC/orchestrateur ; les': 'links each run to Git/DVC/orchestrator; the',
  'sont indentés sous leur parent.': 'are indented under their parent.',
  'Aucune expérience trouvée': 'No experiment found',
  'Créez votre première expérience ou vérifiez que MLflow est actif':
    'Create your first experiment or check that MLflow is active',

  // ModelRegistryPage.tsx
  'Version': 'Version',
  'Erreur lors de la transition': 'Error during transition',
  'Mis à jour': 'Updated',
  'Chaque': 'Each',
  'version': 'version',
  "= un entraînement successif du même modèle (même projet). Le dataset et la mAP50 relient la version à son run d'origine.":
    '= a successive training run of the same model (same project). The dataset and mAP50 link the version to its source run.',
  'Aucune version enregistrée': 'No version registered',
  'Créé le': 'Created on',
  'Aucun modèle enregistré': 'No model registered',

  // RunDetailPage.tsx
  'Chargement du run…': 'Loading run...',
  'Retour': 'Back',
  'Run introuvable ou serveur MLflow non disponible.': 'Run not found or MLflow server unavailable.',
  'Run orchestrateur': 'Orchestrator run',
  'Graphe': 'Graph',
  'Nœud': 'Node',
  'Étape': 'Stage',
  'Durée': 'Duration',
  'quel code / quelles données ont produit ce run': 'which code / which data produced this run',
  'Historique métriques': 'Metrics history',
  'Paramètres': 'Parameters',
  'Valeur': 'Value',
  'Chemin': 'Path',
  'Taille': 'Size',
  'Dossier': 'Folder',
  'Fichier': 'File',

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
