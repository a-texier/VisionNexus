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

// Pilotage desktop : si ?lang= etait present au chargement, VisionNexus impose
// la langue et cette app ne doit ni lire ni ecrire la preference workspace.
const desktopPiloted = readQueryLang() !== null

export function isDesktopPiloted(): boolean {
  return desktopPiloted
}

/** Repli workspace (hors lanceur) : applique la langue sauvegardee cote backend au boot. */
export async function initWorkspaceLanguage(fetchSettingsLang: () => Promise<Lang | null | undefined>): Promise<void> {
  if (desktopPiloted) return
  try {
    const fromWorkspace = await fetchSettingsLang()
    if (isLang(fromWorkspace ?? null)) setLang(fromWorkspace as Lang)
  } catch {
    // Pas de backend joignable au boot : repli localStorage/anglais.
  }
}

/** Change la langue et, hors pilotage desktop, persiste le choix cote workspace. */
export function setLangAndMaybePersist(lang: Lang, persistToWorkspace: (lang: Lang) => void): void {
  setLang(lang)
  if (!desktopPiloted) persistToWorkspace(lang)
}

// Dictionnaire de correspondance exacte FR -> EN, complete au fil de la
// couverture de l'app. Une chaine absente du dictionnaire reste affichee
// en francais meme en mode EN (degradation silencieuse, jamais de texte
// casse ou de cle brute visible).
const EXACT_EN: Record<string, string> = {
  'Études': 'Studies',
  'Nouvelle étude': 'New study',
  'Nom': 'Name',
  'Direction': 'Direction',
  'Annuler': 'Cancel',
  'Création…': 'Creating...',
  'Créer': 'Create',
  'En cours': 'Running',
  'Terminé': 'Finished',
  'Échec HPO': 'HPO failed',
  'Vide': 'Empty',
  'Chargement…': 'Loading...',
  'Aucune étude Optuna trouvée': 'No Optuna study found',
  'Statut': 'Status',
  'Meilleure val.': 'Best val.',
  "Supprimer l'étude": 'Delete study',
  'et tous ses trials ?': 'and all its trials?',
  'Étude créée': 'Study created',
  'Étude supprimée': 'Study deleted',
  'Erreur lors de la suppression': 'Error while deleting',
  "Erreur lors de la création (nom déjà utilisé ?)": 'Error while creating (name already in use?)',
  'objectif —': 'objective —',

  // GuidePage.tsx (page Documentation)
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

  // Partages (HPOLearnPage, StudyDetailPage)
  'Espace de recherche': 'Search space',
  'Objectif': 'Objective',
  'Cause :': 'Cause:',

  // HPOLearnPage.tsx
  'distribution logarithmique': 'logarithmic distribution',
  'distribution linéaire': 'linear distribution',
  'Une configuration possible': 'A possible configuration',
  'Déplacer les curseurs ne lance rien : vous construisez simplement un exemple de trial.': 'Moving the sliders does not launch anything: you are just building an example trial.',
  'Animer': 'Animate',
  'Trials observés :': 'Trials observed:',
  'zone centrale des meilleurs observés': 'center of the best observed',
  'Nombre de trials simulés': 'Number of simulated trials',
  'Les premiers points explorent. Il n’y a pas encore assez d’observations pour une adaptation solide.': 'The first points explore. There are not yet enough observations for a solid adaptation.',
  'Deux groupes': 'Two groups',
  'TPE sépare schématiquement les bons résultats observés du reste et estime des densités.': 'TPE roughly separates the good observed results from the rest and estimates densities.',
  'Proposition': 'Proposal',
  'Il favorise des valeurs plausibles dans les zones prometteuses, avec une part d’exploration.': 'It favors plausible values in the promising zones, while still exploring somewhat.',
  'Important :': 'Important:',
  'cette animation est une illustration TPE simplifiée et déterministe, pas le journal interne d’un sampler Optuna. Elle montre une interprétation probabiliste, jamais une cause certaine pour un trial précis.': 'this animation is a simplified, deterministic illustration of TPE, not the internal log of an Optuna sampler. It shows a probabilistic interpretation, never a certain cause for a specific trial.',
  'Lancer la simulation': 'Run the simulation',
  'Meilleur jusque-là': 'Best so far',
  'Meilleur observé à ce stade : trial #': 'Best observed so far: trial #',
  'C’est un fait de la simulation : ce trial a le score maximal parmi ceux déjà affichés. Cela ne prouve pas que chaque paramètre pris isolément cause ce score.': 'This is a fact of the simulation: this trial has the maximum score among those shown so far. It does not prove that any single parameter alone causes this score.',
  'modèle entraîné sur le dataset déclaré': 'model trained on the declared dataset',
  'Comprendre HPO': 'Understanding HPO',
  'De l’espace de recherche au meilleur trial': 'From the search space to the best trial',
  'Une introduction interactive à l’optimisation d’hyperparamètres, à Optuna, au sampler TPE et au pruning — sans supposer que vous connaissez déjà le machine learning.': 'An interactive introduction to hyperparameter optimization, Optuna, the TPE sampler and pruning, without assuming you already know machine learning.',
  '1 · L’idée': '1. The idea',
  'Qu’est-ce que l’optimisation d’hyperparamètres ?': 'What is hyperparameter optimization?',
  'Un modèle possède des paramètres appris pendant le training, mais aussi des': 'A model has parameters learned during training, but also',
  'hyperparamètres': 'hyperparameters',
  'choisis avant ou autour du training : learning rate, augmentation mosaic, échelle, batch, etc. HPO organise plusieurs entraînements pour comparer automatiquement différentes configurations selon une métrique.': 'chosen before or around training: learning rate, mosaic augmentation, scale, batch, etc. HPO organizes several training runs to automatically compare different configurations against a metric.',
  '2 · Les briques': '2. The building blocks',
  'Dataset, objectif, direction, espace et trials': 'Dataset, objective, direction, space and trials',
  'Les données et leur split utilisés par chaque entraînement comparable.': 'The data and its split used by each comparable training run.',
  'La métrique numérique qui classe les essais, par exemple mAP50.': 'The numeric metric that ranks the trials, for example mAP50.',
  'Maximiser une mAP ; minimiser une loss ou une latence.': 'Maximize an mAP; minimize a loss or a latency.',
  'Les paramètres autorisés, leurs types, bornes et distributions.': 'The allowed parameters, their types, bounds and distributions.',
  'Une configuration proposée, son exécution et son résultat.': 'A proposed configuration, its execution and its result.',
  '3 · Une unité de travail': '3. A unit of work',
  'Qu’est-ce qu’un trial ?': 'What is a trial?',
  'Un trial est': 'A trial is',
  'un essai complet et traçable': 'a complete, traceable attempt',
  ': Optuna propose des valeurs, votre fonction objectif lance le training, puis renvoie une valeur numérique. `COMPLETE` signifie que cette valeur est exploitable ; `FAIL` signale une erreur ; `PRUNED` un arrêt algorithmique anticipé.': ': Optuna proposes values, your objective function launches the training, then returns a numeric value. `COMPLETE` means this value is usable; `FAIL` signals an error; `PRUNED` an early algorithmic stop.',
  '4 · Manipuler': '4. Try it yourself',
  'Exemple d’espace : lr, mosaic et scale': 'Search space example: lr, mosaic and scale',
  '5 · Trois stratégies': '5. Three strategies',
  '6–8 · Le cœur d’Optuna': '6-8. The heart of Optuna',
  'Intuition d’abord :': 'Intuition first:',
  'TPE regarde les configurations déjà essayées et leurs scores. Il distingue un groupe de résultats prometteurs du reste, estime où ces groupes sont denses, puis propose plus souvent des valeurs plausibles dans les régions prometteuses. Il continue néanmoins à explorer.': 'TPE looks at the configurations already tried and their scores. It separates a group of promising results from the rest, estimates where these groups are dense, then more often proposes plausible values in the promising regions. It still keeps exploring.',
  'Puis, une formulation un peu plus mathématique': 'Then, a slightly more mathematical formulation',
  'TPE modélise des densités de paramètres conditionnées par la qualité observée, souvent notées ℓ(x) pour le groupe prometteur et g(x) pour le reste. Le choix cherche des candidats au rapport favorable. L’implémentation réelle gère distributions, paramètres conditionnels et échantillonnage ; l’interface ne prétend pas reconstruire une décision interne exacte.': 'TPE models parameter densities conditioned on the observed quality, often noted l(x) for the promising group and g(x) for the rest. The choice looks for candidates with a favorable ratio. The real implementation handles distributions, conditional parameters and sampling; the interface does not claim to reconstruct an exact internal decision.',
  '9–10 · Économiser le calcul': '9-10. Saving compute',
  'Pruning : faut-il continuer ce trial ?': 'Pruning: should this trial continue?',
  '« Que devrions-nous essayer ensuite ? » Il propose la prochaine configuration.': '"What should we try next?" It proposes the next configuration.',
  '« Faut-il continuer ce trial ? » Il utilise des métriques intermédiaires pour arrêter tôt, si le moteur les publie.': '"Should this trial continue?" It uses intermediate metrics to stop early, if the engine publishes them.',
  'Une erreur dataset, CUDA ou modèle n’est jamais un pruning. Sans métriques intermédiaires et décision explicite du pruner, l’interface doit parler d’échec ou d’interruption.': 'A dataset, CUDA or model error is never a pruning. Without intermediate metrics and an explicit pruner decision, the interface must speak of a failure or an interruption.',
  'Final · À vous de jouer': 'Final. Your turn',
  'Étude Optuna simulée : du trial #1 au gagnant': 'Simulated Optuna study: from trial #1 to the winner',
  'Faites avancer l’étude. Les valeurs sont un jeu pédagogique fixe : les points montrent des faits simulés, pas une prédiction sur votre propre dataset.': 'Advance the study. The values are a fixed teaching example: the points show simulated facts, not a prediction about your own dataset.',
  'Teste une grille prédéfinie. Exhaustif sur la grille, mais le coût explose avec le nombre de paramètres.': 'Tests a predefined grid. Exhaustive over the grid, but the cost explodes with the number of parameters.',
  'Tire indépendamment dans l’espace. Bon socle, simple et souvent plus efficace qu’une grande grille.': 'Draws independently across the space. A solid baseline, simple and often more efficient than a large grid.',
  'Utilise les essais observés pour favoriser probabilistiquement des régions prometteuses sans abandonner toute exploration.': 'Uses the observed trials to probabilistically favor promising regions without giving up all exploration.',
  'paramètres': 'parameters',
  'objectif': 'objective',
  'état': 'state',

  // LaunchPage.tsx
  'Paramètre': 'Parameter',
  'invalide — vérifiez les champs': 'invalid - check the fields',
  'Chemin du script requis': 'Script path required',
  'Erreur au démarrage': 'Error at startup',
  'optimisation terminée': 'optimization finished',
  'arrêt demandé': 'stop requested',
  'Lancer une optimisation': 'Launch an optimization',
  "Script d'objectif": 'Objective script',
  'Chemin absolu vers le script Python': 'Absolute path to the Python script',
  'Le script reçoit les hyperparamètres comme arguments (': 'The script receives the hyperparameters as arguments (',
  ') et doit imprimer la métrique en dernière ligne sur stdout.': ') and must print the metric on the last line of stdout.',
  'Arguments fixes (avant les hyperparamètres)': 'Fixed arguments (before the hyperparameters)',
  'Retirer': 'Remove',
  'Nombre de trials': 'Number of trials',
  'Nom de la métrique': 'Metric name',
  'Espace des hyperparamètres': 'Hyperparameter space',
  'Ajouter': 'Add',
  'nom': 'name',
  'Lancer': 'Launch',
  'Arrêter': 'Stop',
  'Optimisation en cours…': 'Optimization in progress...',
  'Sortie': 'Output',

  // StudyDetailPage.tsx
  'Arrêt demandé': 'Stop requested',
  "Erreur lors de l'arrêt": 'Error while stopping',
  'Retour aux études': 'Back to studies',
  'Étude lancée depuis un nœud Sandgraph': 'Study launched from a Sandgraph node',
  'Étude lancée depuis Optuna App': 'Study launched from Optuna App',
  'ÉCHEC HPO officiel — aucun best_params Optuna': 'Official HPO FAILURE - no Optuna best_params',
  'et': 'and',
  'Les résultats physiques récupérés restent affichés ci-dessous, mais ils ne sont pas promus rétroactivement en trials COMPLETE.': 'The recovered physical results are still shown below, but they are not retroactively promoted to COMPLETE trials.',
  'Co-meilleurs candidats historiques récupérés · trials': 'Co-best recovered historical candidates - trials',
  'Meilleur candidat historique récupéré · trial #': 'Best recovered historical candidate - trial #',
  'informatif, non COMPLETE': 'informative, not COMPLETE',
  'Le CSV historique peut avoir arrondi la métrique : aucun vainqueur officiel n’est inventé en cas d’égalité.': 'The historical CSV may have rounded the metric: no official winner is invented in case of a tie.',
  'Poids :': 'Weights:',
  'Trials :': 'Trials:',
  'À faire :': 'To do:',
  'HPO exploitable — meilleur trial officiel #': 'HPO usable - official best trial #',
  'Étude en cours — aucun résultat officiel sélectionnable pour le moment': 'Study in progress - no official result selectable yet',
  'trials finalisés': 'trials finalized',
  'actif(s)': 'active',
  'en attente': 'waiting',
  'Planifiés': 'Planned',
  'Finalisés': 'Finalized',
  'Réussis': 'Succeeded',
  'Échoués': 'Failed',
  'Prunés': 'Pruned',
  'Interrompus': 'Interrupted',
  'Progression': 'Progress',
  'Meilleur trial #': 'Best trial #',
  'Tous les trials': 'All trials',
  'Aucun trial — lancez une optimisation': 'No trials - launch an optimization',
  'État': 'State',
  'Résultat observé': 'Observed result',
  'Paramètres': 'Parameters',
  'Durée': 'Duration',
  'objectif officiel =': 'official objective =',
  'training récupéré · non officiel': 'training recovered - not official',
  'aucune métrique': 'no metric',
  'Cause regroupée dans le verdict de l’étude': "Cause grouped in the study's verdict",
  'Résultats et artefacts': 'Results and artifacts',
  'Métriques récupérées depuis le CSV historique — informatives, état Optuna inchangé.': 'Metrics recovered from the historical CSV - informative, Optuna state unchanged.',
  'Source métrique :': 'Metric source:',
  'non enregistrée': 'not recorded',
  'Aucun dossier': 'No folder',

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
