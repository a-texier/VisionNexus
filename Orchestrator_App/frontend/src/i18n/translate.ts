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

// Pilotage desktop : quand ?lang= est present, VisionNexus impose la langue et
// cette app ne doit ni lire ni ecrire le repli workspace (settings backend).
const desktopPiloted = readQueryLang() !== null

export function isDesktopPiloted(): boolean {
  return desktopPiloted
}

// Repli workspace, hors lanceur uniquement : va chercher ui_language dans les
// settings de cette app au boot. Silencieux si le backend n'est pas joignable
// (mode dev sans serveur, premier chargement) : on reste sur localStorage/EN.
export async function initWorkspaceLanguage(
  fetchSettingsLang: () => Promise<Lang | null | undefined>
): Promise<void> {
  if (desktopPiloted) return
  try {
    const fromWorkspace = await fetchSettingsLang()
    if (isLang(fromWorkspace ?? null)) setLang(fromWorkspace as Lang)
  } catch {
    // Pas de backend joignable au boot : repli localStorage/anglais.
  }
}

// Change la langue localement, et ne persiste vers le workspace que hors
// pilotage desktop (VisionNexus reste alors la seule source de verite).
export function setLangAndMaybePersist(lang: Lang, persistToWorkspace: (lang: Lang) => void): void {
  setLang(lang)
  if (!desktopPiloted) persistToWorkspace(lang)
}

// Dictionnaire de correspondance exacte FR -> EN, complete au fil de la
// couverture de l'app. Une chaine absente du dictionnaire reste affichee
// en francais meme en mode EN (degradation silencieuse, jamais de texte
// casse ou de cle brute visible).
const EXACT_EN: Record<string, string> = {
  // Shell (App.tsx / UserBadge.tsx)
  'Expériences': 'Experiments',
  'À propos': 'About',
  'Paramètres': 'Settings',
  "Configuration de l'espace de travail.": 'Workspace configuration.',
  'IA Pipeline Hub': 'AI Pipeline Hub',
  'Ouvrir workspace': 'Open workspace',
  'Historique des workspaces': 'Workspace history',
  'Utilisateurs connectes': 'Connected users',
  'Workspaces recents': 'Recent workspaces',
  'Chargement…': 'Loading…',
  'Aucun utilisateur trouve.': 'No user found.',
  'vous': 'you',
  'Ouvrir ce workspace': 'Open this workspace',
  'Aucun workspace utilise recemment.': 'No recently used workspace.',

  // SandgraphPage — toolbox + top bar
  'Nœuds': 'Nodes',
  'Glisser sur le canvas': 'Drag onto canvas',
  'Entrées (inputs)': 'Inputs',
  'Suppr = effacer · F = vue · Ctrl+Z/Y = annuler/rétablir': 'Delete = clear · F = fit view · Ctrl+Z/Y = undo/redo',
  'Cliquer pour renommer': 'Click to rename',
  'Ce graphe est suivi : DVC + MLflow presents. Chaque run est versionnable et tracé dans Insight / Lineage.':
    'This graph is tracked: DVC + MLflow present. Every run is versionable and traced in Insight / Lineage.',
  'Suivi incomplet : il manque': 'Incomplete tracking: missing',
  'le node DVC': 'the DVC node',
  'le node MLflow': 'the MLflow node',
  'MLflow et DVC vont ensemble (versionner + tracer). Cliquer pour ajouter le node manquant.':
    'MLflow and DVC go together (version + trace). Click to add the missing node.',
  'Suivi incomplet — compléter': 'Incomplete tracking — complete it',
  'Graphe experimental (jetable). Cliquer pour activer le suivi MLOps : ajoute la paire MLflow + DVC (versioning + tracabilite + Insight + Lineage).':
    'Experimental graph (disposable). Click to enable MLOps tracking: adds the MLflow + DVC pair (versioning + traceability + Insight + Lineage).',
  'Annuler (Ctrl+Z)': 'Undo (Ctrl+Z)',
  'Rétablir (Ctrl+Y)': 'Redo (Ctrl+Y)',
  'Auto Save : sauvegarde automatique après chaque édition (fonctionne seul, mêmes erreurs que Sauvegarder)':
    'Auto Save: automatic save after every edit (works standalone, same errors as Save)',
  'Auto Check : aligne/espace automatiquement les nodes Application (fonctionne seul — activez aussi Auto Save pour persister)':
    'Auto Check: automatically aligns/spaces Application nodes (works standalone — also enable Auto Save to persist)',
  'Sauvegarder': 'Save',
  'Terminé → Continuer': 'Done → Continue',
  'Arrêter le pipeline': 'Stop the pipeline',
  'Réinitialiser': 'Reset',
  'Plots et journal du dernier run': 'Plots and log of the last run',
  'Lancer': 'Run',
  'Nouvelle expérience': 'New experiment',
  'Journal des événements': 'Event log',

  // SandgraphPage — canvas empty state / fit view
  'Aucune expérience': 'No experiment',
  'Créez votre premier sandgraph ou utilisez un template dans Expériences':
    'Create your first sandgraph or use a template in Experiments',
  'Créer une expérience': 'Create an experiment',
  'Ajuster la vue (F)': 'Fit view (F)',

  // SandgraphPage — "chain complete" modal
  'Chaîne terminée': 'Chain complete',
  'Toutes les étapes du graphe sont passées. Les sorties (dataset, annotations, modèle, métriques) sont prêtes.':
    'All steps of the graph have completed. The outputs (dataset, annotations, model, metrics) are ready.',
  "Ce run n'est": 'This run is',
  'pas encore versionné': 'not yet versioned',
  'Le nœud': 'The',
  "clignote tant que ce n'est pas fait :": 'node blinks until this is done:',
  'cochez les artefacts à garder, puis créez la version.': 'check the artifacts to keep, then create the version.',
  "Ce run est déjà versionné dans DVC — rien d'autre à faire.": 'This run is already versioned in DVC — nothing else to do.',
  'Ouvrir le nœud DVC': 'Open the DVC node',
  'Plus tard': 'Later',

  // SandgraphPage — connect-node popup
  'Rechercher un nœud compatible…': 'Search a compatible node…',
  'Aucun nœud compatible': 'No compatible node',

  // SandgraphPage — toasts
  'Suivi MLOps activé : MLflow + DVC ajoutés': 'MLOps tracking enabled: MLflow + DVC added',
  'ajouté — suivi MLOps complet': 'added — MLOps tracking complete',
  "Entrées exclusives : débranchez d'abord l'autre port.": "Exclusive inputs: unplug the other port first.",
  'Erreur lors de la sauvegarde': 'Error while saving',
  'Expérience créée': 'Experiment created',
  'Dupliquée': 'Duplicated',
  'Supprimée': 'Deleted',
  'Pipeline lancé': 'Pipeline started',
  'Pipeline terminé — les sorties sont prêtes dans le node DVC.': 'Pipeline finished — outputs are ready in the DVC node.',
  'Pipeline repris': 'Pipeline resumed',

  // DashboardPage
  'Étapes': 'Steps',
  'Aucune exécution récente': 'No recent execution',
  'Ouvrir': 'Open',
  'Pipeline actif': 'Active pipeline',
  "Aucun pipeline en cours d'exécution": 'No pipeline currently running',
  'Activité récente': 'Recent activity',

  // ExperimentsPage
  'nœud': 'node',
  'connexion': 'connection',
  'terminé': 'done',
  'Modifié': 'Modified',
  'Dupliquer': 'Duplicate',
  'Supprimer': 'Delete',
  'Utiliser ce template': 'Use this template',
  'Sandgraphs enregistrés — chaque expérience est un pipeline visuel': 'Saved sandgraphs — each experiment is a visual pipeline',
  'Nouvelle': 'New',
  'Templates prédéfinis': 'Predefined templates',
  '(lecture seule — utiliser pour créer une expérience)': '(read-only — use it to create an experiment)',
  'Scénarios mainstream': 'Mainstream scenarios',
  'les chaînes recommandées au quotidien': 'the chains recommended for everyday use',
  'Scénarios exemple / use case': 'Example scenarios / use case',
  'briques isolées et cas particuliers': 'isolated building blocks and special cases',
  'Mes expériences': 'My experiments',
  'sandgraphs nommés, état persisté, dupliable': 'named sandgraphs, persisted state, duplicable',
  'Activité': 'Activity',
  'journal brut de chaque exécution (append-only)': 'raw log of every execution (append-only)',
  'Utilisez un template ci-dessus ou créez votre premier sandgraph': 'Use a template above or create your first sandgraph',
  'Créer une expérience vide': 'Create an empty experiment',
  'Graphe introuvable': 'Graph not found',
  'Template chargé — ouvrez le sandgraph pour le configurer': 'Template loaded — open the sandgraph to configure it',
  'Erreur lors de la création depuis template': 'Error creating from template',
  'Dupliqué': 'Duplicated',
  'Supprimé': 'Deleted',
  'Exécution réinitialisée': 'Execution reset',

  // InsightsPage — analysisMeta
  "Synthèse de l'entraînement": 'Training summary',
  'pertes et métriques par epoch': 'losses and metrics per epoch',
  'Matrice de confusion': 'Confusion matrix',
  'taux vrais/faux par classe': 'true/false rate per class',
  'Courbe Précision-Rappel': 'Precision-Recall curve',
  '≈ ROC pour la détection': '≈ ROC for detection',
  'Courbe F1 vs seuil': 'F1 curve vs threshold',
  'seuil de confiance optimal': 'optimal confidence threshold',
  'Distribution des labels': 'Label distribution',
  'histogramme classes + tailles des boîtes': 'class histogram + box sizes',
  'Validation — vérité terrain': 'Validation — ground truth',
  'échantillon de validation annoté': 'annotated validation sample',
  'Validation — prédictions': 'Validation — predictions',
  'sortie du modèle sur le même échantillon': 'model output on the same sample',

  // InsightsPage — LineageField / LineageHeader
  'non relié': 'not linked',
  'Fork créé': 'Fork created',
  'Suivi MLOps activé': 'MLOps tracking enabled',
  'ajoutés': 'added',
  'Déjà suivi MLOps': 'Already tracked in MLOps',
  'Identité du run': 'Run identity',
  'ID unifié (orch_run_id) : la clé qui relie ce run à Git, DVC et MLflow (tag + trailer commit).':
    'Unified ID (orch_run_id): the key linking this run to Git, DVC and MLflow (tag + commit trailer).',
  'Ce graphe est un fork. Ouvrir le graphe parent.': 'This graph is a fork. Open the parent graph.',
  'fork de': 'fork of',
  'versionné': 'versioned',
  'non versionné (pas de commit DVC)': 'not versioned (no DVC commit)',
  'aucun commit DVC': 'no DVC commit',
  'dataset inconnu': 'unknown dataset',
  'non versionné DVC': 'not versioned in DVC',
  'aucun run MLflow lié': 'no linked MLflow run',
  'modèle absent': 'model missing',
  'Aucun run MLflow lié à ce run': 'No MLflow run linked to this run',
  'Ouvrir le Sandgraph qui a produit ce run': 'Open the Sandgraph that produced this run',
  "Voir ce run dans l'arbre de lineage complet": 'View this run in the full lineage tree',
  'Ce run est experimental : activer le suivi MLOps ajoute la paire MLflow + DVC au graphe, puis committez pour versionner.':
    'This run is experimental: enabling MLOps tracking adds the MLflow + DVC pair to the graph, then commit to version it.',
  'Duplique ce graphe en figeant le même dataset et les mêmes annotations, et enregistre la provenance du run. Ajustez ensuite les params puis relancez.':
    "Duplicates this graph, freezing the same dataset and annotations, and records the run's provenance. Then adjust the params and rerun.",
  'Lineage incomplet — voir la checklist ci-dessous': 'Incomplete lineage — see the checklist below',
  'Reproduire ce run, sans ligne de commande :': 'Reproduce this run, with no command line:',
  'Restaurer la version des données': 'Restore the data version',
  "dans l'app DVC, onglet Historique, cliquer « Restaurer cette version » sur le commit":
    'in the DVC app, History tab, click "Restore this version" on commit',
  "Ouvrir l'historique": 'Open history',
  'Récupérer les fichiers': 'Retrieve the files',
  'si un remote est configuré, onglet Sync → Pull (récupère le contenu exact du dataset':
    'if a remote is configured, Sync tab → Pull (retrieves the exact content of the dataset',
  'Ouvrir Sync': 'Open Sync',
  "Re-lancer à l'identique": 'Rerun identically',
  'bouton': 'button',
  'ci-dessus (fige le même dataset + annotations), puis « Lancer » dans le Sandgraph.':
    'above (freezes the same dataset + annotations), then "Run" in the Sandgraph.',
  'Comparer le résultat': 'Compare the result',
  "au run MLflow d'origine": 'to the original MLflow run',
  'mAP50 attendue': 'expected mAP50',
  'Incomplet': 'Incomplete',

  // InsightsPage — SourceGraphPreview / InsightDetail / export report
  'Sandgraph source': 'Source Sandgraph',
  'Insight régénéré': 'Insight regenerated',
  'Entraînement': 'Training',
  'Étude': 'Study',
  'Sujet': 'Subject',
  'Rapport Insights': 'Insights Report',
  'généré': 'generated',
  'Métriques et pertes par epoch (toutes les runs superposées).': 'Metrics and losses per epoch (all runs overlaid).',
  'mAP par epoch': 'mAP per epoch',
  'Pertes par epoch': 'Losses per epoch',
  'mAP50 finale par entraînement': 'final mAP50 per training run',
  "Étude d'hyperparamètres.": 'Hyperparameter study.',
  'Valeur par trial': 'Value per trial',
  'versions': 'versions',
  'Rapport HTML exporté': 'HTML report exported',
  'Export échoué': 'Export failed',
  'Logique du run': 'Run logic',
  'le pipeline produit des données (dataset → subset → annotation),': 'the pipeline produces data (dataset → subset → annotation),',
  'optimise': 'optimizes',
  'les hyperparamètres (Optuna),': 'the hyperparameters (Optuna),',
  'entraîne': 'trains',
  "le modèle final, puis l'": 'the final model, then it ',
  'évalue': 'evaluates',
  'Les blocs ci-dessous suivent cet ordre — courbes interactives (zoom, survol, toggle légende) construites depuis':
    'The blocks below follow this order — interactive charts (zoom, hover, toggle legend) built from',
  "Recollecte l'état réel (DVC / MLflow / modèle) et régénère cet insight. À utiliser si le versioning vient de changer.":
    'Recollects the real state (DVC / MLflow / model) and regenerates this insight. Use it if versioning has just changed.',
  'Régénérer': 'Regenerate',
  'Exporter rapport HTML': 'Export HTML report',
  'Résultats — modèles entraînés': 'Results — trained models',
  'runs tracés': 'tracked runs',
  'Entraînement — courbes par epoch': 'Training — curves per epoch',
  'Interactif : zoom, survol pour les valeurs, clic sur la légende pour isoler une run.':
    'Interactive: zoom, hover for values, click the legend to isolate a run.',
  'Pertes par epoch (box · cls)': 'Losses per epoch (box · cls)',
  'Précision / Rappel par epoch': 'Precision / Recall per epoch',
  "Optuna — historique de l'étude": 'Optuna — study history',
  'Valeur de la métrique par trial (TPE + pruning).': 'Metric value per trial (TPE + pruning).',
  'Analyse détaillée du modèle': 'Detailed model analysis',
  'matrices, PR, F1, prédictions': 'matrices, PR, F1, predictions',
  'Journal des étapes': 'Step log',
  'outputs bruts': 'raw outputs',
  'Logs complets': 'Full logs',
  'blocs colorés par node': 'color-coded blocks per node',
  'Dernier run de ce graphe (identiques au journal du Sandgraph).': 'Last run of this graph (identical to the Sandgraph log).',
  'Fichiers persistés dans le workspace': 'Files persisted in the workspace',

  // InsightsPage — main list
  'Insights générés': 'Insights generated',
  'Insight supprimé': 'Insight deleted',
  "Plots d'évolution + journal de compréhension pour chaque run de template": 'Evolution plots + understanding log for each template run',
  'Les insights sont (re)générés automatiquement au fur et à mesure : après chaque étape significative (training, export, commit, HPO) ET à la fin du run. Régénérables/supprimables à la main.':
    'Insights are (re)generated automatically along the way: after every significant step (training, export, commit, HPO) AND at the end of the run. Can be regenerated/deleted manually.',
  'générés au fil du pipeline': 'generated as the pipeline runs',
  'Générer les insights du dernier run de': 'Generate insights for the last run of',
  'Aucun insight généré': 'No insight generated',
  'Lancez un template dans le Sandgraph — les insights sont générés automatiquement à la fin du run.':
    'Launch a template in the Sandgraph — insights are generated automatically at the end of the run.',
  'Vous pouvez aussi les générer manuellement avec les boutons ci-dessus.': 'You can also generate them manually with the buttons above.',
  'Supprimer cet insight ?\n\nC\'est seulement un cache d\'affichage (plots + journal). Le lineage du run, les versions DVC et les runs MLflow sont conservés — tu peux régénérer l\'insight ensuite avec le bouton "Régénérer".':
    'Delete this insight?\n\nThis is only a display cache (plots + journal). The run\'s lineage, DVC versions and MLflow runs are kept — you can regenerate the insight afterwards with the "Regenerate" button.',
  'Supprimer cet insight': 'Delete this insight',

  // ActivityPage
  'étapes': 'steps',
  'Ouvrir le graphe': 'Open the graph',
  'Voir les logs': 'View logs',
  'Arrêter ce run': 'Stop this run',
  'Dupliquer et refaire': 'Duplicate and redo',
  'Refaire': 'Redo',
  'Logs complets (dernier run)': 'Full logs (last run)',
  'Aucun détail disponible': 'No detail available',
  'Graphe dupliqué — prêt à relancer': 'Graph duplicated — ready to run',
  'Erreur lors de la duplication': 'Error while duplicating',
  'Run arrêté': 'Run stopped',
  "Erreur lors de l'arrêt": 'Error while stopping',
  'Filtrer par nom…': 'Filter by name…',
  'Tous les statuts': 'All statuses',
  'Aucune exécution trouvée': 'No execution found',
  'Statut': 'Status',
  'Expérience': 'Experiment',
  'Démarré': 'Started',
  'Durée': 'Duration',
  'Actions': 'Actions',
  'Affichage': 'Showing',

  // PlansPage
  "Plans d'expériences": 'Experiment Plans',
  "planifier une suite d'expériences et la lancer d'un clic": 'plan a suite of experiments and launch it in one click',
  'Nouveau plan': 'New plan',
  'Chaque étape': 'Each step',
  'duplique un graphe de base': 'duplicates a base graph',
  '(que vous avez construit dans le Sandgraph : pipeline complet, ou graphe « réutilisation » annotation FREE → training) et applique des':
    '(that you built in the Sandgraph: full pipeline, or a "reuse" graph — FREE annotation → training) and applies',
  ', puis lance le run et commit dans DVC. Le résultat apparaît dans le graphe de Lineage.':
    ', then runs it and commits to DVC. The result appears in the Lineage graph.',
  'Aucun plan. Créez-en un.': 'No plan. Create one.',
  'étape(s)': 'step(s)',
  'Sélectionnez ou créez un plan.': 'Select or create a plan.',
  'Enregistrer': 'Save',
  'Lancer le plan': 'Run the plan',
  'Supprimer ce plan ?': 'Delete this plan?',
  "libellé de l'étape (ex. baseline)": 'step label (e.g. baseline)',
  'graphe de base…': 'base graph…',
  'Ajouter une étape': 'Add a step',
  'Exécution': 'Execution',
  'étape': 'step',
  'Plan enregistré': 'Plan saved',
  'Plan lancé': 'Plan started',
  'Déjà en cours': 'Already running',
  "Les résultats sont navigables dans l'onglet Lineage.": 'The results are browsable in the Lineage tab.',
  'Projet annot.': 'Annot. project',
  'Nb images': 'Nb images',
  'Seuil annot.': 'Annot. threshold',
  'LR par image': 'LR per image',

  // AboutPage — hero + key points
  'Plateforme MLOps Computer Vision': 'Computer Vision MLOps Platform',
  "Suite intégrée d'outils pour construire des pipelines de Computer Vision complets : de l'exploration de datasets jusqu'à la validation de modèles, avec supervision humaine à chaque étape critique.":
    'An integrated suite of tools for building complete Computer Vision pipelines: from dataset exploration to model validation, with human oversight at every critical step.',
  '6 applications spécialisées': '6 specialized applications',
  'Pipelines DAG orchestrés': 'Orchestrated DAG pipelines',
  'Expériences versionnées': 'Versioned experiments',

  // AboutPage — APPS
  'Orchestrateur': 'Orchestrator',
  'Exploration et gestion de datasets images. Embedding CLIP, carte UMAP interactive, subsets sémantiques.':
    'Explore and manage image datasets. CLIP embedding, interactive UMAP map, semantic subsets.',
  "Annotation d'images et vidéos. SAM2 interactif, ByteTrack, propagation par homographie.":
    'Image and video annotation. Interactive SAM2, ByteTrack, homography-based propagation.',
  'Versionnage des datasets avec DVC + Git. Historique des commits, diff entre versions.':
    'Dataset versioning with DVC + Git. Commit history, diff between versions.',
  'Suivi des expériences ML. Paramètres, métriques, modèles enregistrés, comparaison de runs.':
    'ML experiment tracking. Parameters, metrics, registered models, run comparison.',
  'Optimisation des hyperparamètres. Études Optuna, visualisation des essais, meilleurs paramètres.':
    'Hyperparameter optimization. Optuna studies, trial visualization, best parameters.',
  "Coordonne toutes les apps dans des pipelines DAG avec human-in-the-loop et suivi d'expériences.":
    'Coordinates all apps in DAG pipelines with human-in-the-loop and experiment tracking.',
  'Embedding CLIP ViT-B-32': 'CLIP ViT-B-32 embedding',
  'Carte UMAP / t-SNE / PCA': 'UMAP / t-SNE / PCA map',
  'Recherche sémantique texte→image': 'Text→image semantic search',
  'Déduplication automatique': 'Automatic deduplication',
  'Subsets + export annotation': 'Subsets + annotation export',
  'SAM2 point/texte interactif': 'Interactive SAM2 point/text',
  'ByteTrack vidéo': 'ByteTrack video',
  'Undo/redo + raccourcis': 'Undo/redo + shortcuts',
  'Git + DVC intégrés': 'Integrated Git + DVC',
  'Historique des versions': 'Version history',
  'Diff entre commits': 'Diff between commits',
  'Checkout de versions': 'Version checkout',
  'Suivi runs YOLO/custom': 'YOLO/custom run tracking',
  'Comparaison multi-runs': 'Multi-run comparison',
  'Registry modèles': 'Model registry',
  'Charts métriques': 'Metric charts',
  'Études Bayésiennes': 'Bayesian studies',
  'Visualisation trials': 'Trial visualization',
  'Export meilleurs params': 'Best params export',
  'Intégration MLflow': 'MLflow integration',
  'Pipelines DAG visuels': 'Visual DAG pipelines',
  'Suivi expériences': 'Experiment tracking',
  'Bibliothèque de templates': 'Template library',
  'Monitoring santé': 'Health monitoring',

  // AboutPage — WORKFLOW_STEPS
  'Pipeline CV Training Loop — 13 étapes, 5 validations humaines': 'CV Training Loop Pipeline — 13 steps, 5 human validations',
  'Charger dataset': 'Load dataset',
  'Embedding CLIP': 'CLIP embedding',
  'Valider embedding': 'Validate embedding',
  'Créer subset sémantique': 'Create semantic subset',
  'Valider subset': 'Validate subset',
  'Exporter vers Annotation': 'Export to Annotation',
  'Créer projet annotation': 'Create annotation project',
  'Annoter les images': 'Annotate images',
  'Optimisation HPO': 'HPO optimization',
  'Valider les perfs': 'Validate performance',
  'Vérifier la carte': 'Check the map',
  'Requête texte→images': 'Text→images query',
  'Confirmer la sélection': 'Confirm the selection',
  'SAM2 + manuel': 'SAM2 + manual',
  'Versionner le dataset': 'Version the dataset',
  'Lancer manuellement': 'Run manually',
  'Métriques finales': 'Final metrics',
  'Automatique': 'Automatic',
  'Validation humaine': 'Human validation',

  // AboutPage — Architecture / Quick start / shortcuts
  'FastAPI + SQLite par app': 'FastAPI + SQLite per app',
  'SSE temps réel': 'Real-time SSE',
  'Démarrage rapide': 'Quick start',
  "Lancer les apps via l'onglet Applications de l'Orchestrateur": "Launch the apps via the Orchestrator's Applications tab",
  "Dans l'onglet Applications, démarrer Dataset Explorer, Annotation, DVC, MLflow, Optuna":
    'In the Applications tab, start Dataset Explorer, Annotation, DVC, MLflow, Optuna',
  'Aller dans Expériences → choisir un template « CV Training Loop » et le dupliquer':
    'Go to Experiments → choose a "CV Training Loop" template and duplicate it',
  'Ouvrir le sandgraph, configurer les nœuds, puis cliquer Lancer': 'Open the sandgraph, configure the nodes, then click Run',
  "À chaque ⏸ human gate, ouvrir l'app correspondante, valider, puis cliquer « Terminé → Continuer »":
    'At each ⏸ human gate, open the corresponding app, validate, then click "Done → Continue"',
  'Raccourcis clavier — Sandgraph': 'Keyboard shortcuts — Sandgraph',
  'Glisser-déposer': 'Drag and drop',
  'Clic sur nom': 'Click on name',
  'Supprimer nœud(s) ou connexion(s) sélectionné(s)': 'Delete selected node(s) or connection(s)',
  'Ajuster la vue (fit view)': 'Fit the view',
  'Sauvegarder le graphe (via bouton Sauvegarder)': 'Save the graph (via the Save button)',
  'Ajouter un nœud depuis la barre latérale gauche': 'Add a node from the left sidebar',
  "Renommer l'expérience en ligne": 'Rename the experiment inline',
  'Zoomer / dézoomer le canvas': 'Zoom in / out on the canvas',
  'Plateforme MLOps CV — Orchestrateur v2': 'CV MLOps Platform — Orchestrator v2',

  // GuidePage
  'Guide MLOps': 'MLOps Guide',
  'monitoring + traçabilité de tes expériences': 'monitoring + traceability of your experiments',
  "L'onglet MLOps en bref": 'The MLOps tab in brief',
  'Cet onglet regroupe tout ce qui sert à': 'This tab groups everything used to',
  'comprendre, comparer et reproduire': 'understand, compare and reproduce',
  'une expérience ML. Quatre sous-onglets :': 'an ML experiment. Four sub-tabs:',
  'Le reste de cette page explique le socle commun :': 'The rest of this page explains the common foundation:',
  'comment ils se relient, et quand utiliser chaque action.': 'how they connect, and when to use each action.',
  "Résultats d'un run : métriques, courbes, lineage cliquable (Git/DVC/MLflow) et checklist de reproductibilité.":
    "A run's results: metrics, charts, clickable lineage (Git/DVC/MLflow) and reproducibility checklist.",
  'Journal des runs : historique, statut, durée — le monitoring de ce qui a tourné.':
    'Run journal: history, status, duration — monitoring of what has run.',
  "Graphe interactif des expériences : datasets, runs, modèles et leurs forks, navigables vers l'objet réel.":
    'Interactive graph of experiments: datasets, runs, models and their forks, navigable to the real object.',
  'Cette page : le modèle mental Git/DVC/MLflow et quand utiliser quoi.': 'This page: the Git/DVC/MLflow mental model and when to use what.',
  'Le modèle mental': 'The mental model',
  "Trois outils répondent chacun à UNE question ; l'Orchestrator les relie. Chaque run devient traçable et reproductible.":
    'Three tools each answer ONE question; the Orchestrator links them together. Every run becomes traceable and reproducible.',
  'Outil': 'Tool',
  'Exemple réel': 'Real example',
  'Quel code / quelle configuration ?': 'Which code / which configuration?',
  'Quelles données / quelle version ?': 'Which data / which version?',
  'Quelle expérience / quel résultat ?': 'Which experiment / which result?',
  'Comment tout est relié ?': 'How is everything connected?',
  "Le lineage d'un run réel": 'The lineage of a real run',
  'Exemple du projet (run': 'Example from the project (run',
  'Depuis un Run Insight, on navigue vers chaque objet réel :': 'From a Run Insight, you navigate to each real object:',
  'code + snapshot du graphe': 'code + graph snapshot',
  'fichiers': 'files',
  'métriques': 'metrics',
  'matrice de confusion, courbe PR…': 'confusion matrix, PR curve…',
  'Ce lien est réel : le run MLflow porte le tag': 'This link is real: the MLflow run carries the tag',
  'le commit DVC porte des trailers': 'the DVC commit carries trailers',
  "et le Run Insight expose une checklist de reproductibilité calculée sur l'état réel.":
    'and the Run Insight exposes a reproducibility checklist computed from the real state.',
  'Reproduire une expérience — sans ligne de commande': 'Reproduce an experiment — without a command line',
  'Tout se fait à la souris. Depuis un run (onglet': 'Everything is done with the mouse. From a run (tab',
  'le bloc': 'the',
  "te donne l'accès à chaque objet, et le bouton": 'block gives you access to each object, and the button',
  'déroule ces étapes :': 'walks through these steps:',
  'app': 'app',
  'Historique': 'History',
  'Restaurer': 'Restore',
  'sur le commit du run (ramène le dataset + modèle exactement à cet état).': "on the run's commit (brings the dataset + model back to exactly that state).",
  '(si remote configuré)': '(if a remote is configured)',
  'dans le Run Insight, bouton': 'in the Run Insight, button',
  '(fige le même dataset + annotations), puis': '(freezes the same dataset + annotations), then',
  'dans le Sandgraph.': 'in the Sandgraph.',
  'Comparer': 'Compare',
  'depuis le graphe': 'from the',
  'ou MLflow, sélectionner deux runs →': 'graph or MLflow, select two runs →',
  'La checklist': 'The',
  "du Run Insight indique, en vert/rouge, ce qui est réellement présent (code, dataset DVC, run MLflow, modèle, remote) — si un élément manque, il est nommé précisément plutôt qu'affiché « Reproducible » à tort.":
    'checklist of the Run Insight shows, in green/red, what is actually present (code, DVC dataset, MLflow run, model, remote) — if something is missing, it is named precisely rather than shown as "Reproducible" incorrectly.',
  'Quand et pourquoi utiliser chaque action': 'When and why to use each action',
  'Automatique au commit DVC : fige le code + la config (snapshot du graphe) qui ont produit le run.':
    'Automatic on DVC commit: freezes the code + config (graph snapshot) that produced the run.',
  'DVC (versionner)': 'DVC (version)',
  'Depuis le nœud DVC après un run : copie + suit le dataset / best.pt lourds, hors de git.':
    'From the DVC node after a run: copies + tracks the heavy dataset / best.pt, outside of git.',
  'Envoyer le contenu versionné vers le remote, pour le récupérer sur une autre machine (VM GPU, collègue).':
    'Send the versioned content to the remote, to retrieve it on another machine (GPU VM, colleague).',
  "Après un checkout d'une version : rapatrier le contenu exact correspondant (reproduire un run).":
    'After checking out a version: fetch the exact matching content (reproduce a run).',
  "La page Push + Pull DVC. Rien n'est synchronisé sans clic ; sans remote configuré, l'action est bloquée avec un message clair.":
    'The DVC Push + Pull page. Nothing is synced without a click; without a configured remote, the action is blocked with a clear message.',
  "Comparer deux versions d'un dataset : combien d'images ajoutées/supprimées, quelles annotations, quel run a utilisé la version.":
    'Compare two versions of a dataset: how many images added/removed, which annotations, which run used the version.',
  'Consulter/comparer les runs (params, métriques, artifacts) et remonter au code + données via les tags de lineage.':
    'View/compare runs (params, metrics, artifacts) and trace back to the code + data via lineage tags.',
  'Prérequis': 'Prerequisites',
  "git et dvc installés (env conda IA_env) — l'app initialise le repo au 1er commit.":
    'git and dvc installed (IA_env conda env) — the app initializes the repo on the first commit.',
  "Un run complet depuis le Sandgraph : c'est lui qui PRODUIT les artefacts (dataset, modèle) à versionner.":
    'A full run from the Sandgraph: it is what PRODUCES the artifacts (dataset, model) to version.',
  'Depuis le nœud DVC : sélectionner les artefacts et committer (ils reçoivent les trailers de lineage).':
    'From the DVC node: select the artifacts and commit (they receive the lineage trailers).',
  'Optionnel mais recommandé pour Push/Pull : un remote DVC (onglet Sync → « Ajouter le remote », un dossier local suffit).':
    'Optional but recommended for Push/Pull: a DVC remote (Sync tab → "Add remote", a local folder is enough).',
  'Où vit quoi (fichiers du workspace)': 'Where things live (workspace files)',
  'Tout est isolé par workspace/utilisateur sous': 'Everything is isolated per workspace/user under',
  "Rien n'écrase l'original : les datasets sont exportés puis versionnés.": 'Nothing overwrites the original: datasets are exported then versioned.',
  'Repo git + DVC : datasets/*.dvc, models/*.dvc (pointeurs), graphs/{id}.json (snapshot config), .dvc/cache (contenu dé-dupliqué), .dvc/config (remote).':
    'Git + DVC repo: datasets/*.dvc, models/*.dvc (pointers), graphs/{id}.json (config snapshot), .dvc/cache (de-duplicated content), .dvc/config (remote).',
  'Store MLflow SQLite (serverless, aucun serveur). Runs, params, métriques, tags de lineage.':
    'MLflow SQLite store (serverless, no server). Runs, params, metrics, lineage tags.',
  'insights.json (lineage + reproductibilité) + plots. Généré à chaque run.': 'insights.json (lineage + reproducibility) + plots. Generated on every run.',
  'Datasets YOLO exportés (ce qui est versionné dans DVC).': 'Exported YOLO datasets (what is versioned in DVC).',
  'Modèles entraînés (versionnés dans DVC au commit).': 'Trained models (versioned in DVC at commit).',
  'Ce qui se passe pendant un run': 'What happens during a run',
  'Le pipeline produit un': 'The pipeline produces a',
  'et un': 'and a',
  "Chaque run d'entraînement/éval ouvre un": 'Each training/eval run opens a',
  'tagué': 'tagged',
  'lien exact': 'exact link',
  'Au': 'On',
  'nœud DVC': 'DVC node',
  'dataset + modèle + snapshot du graphe sont versionnés ; le message porte des': 'dataset + model + graph snapshot are versioned; the message carries',
  'et les runs MLflow reçoivent en retour': 'and MLflow runs receive back',
  'Les': 'The',
  'assemblent le lineage réel et la checklist de reproductibilité.': 'assemble the real lineage and the reproducibility checklist.',
  'Doc applicative détaillée : ouvrez la page « Doc » dans l\'app DVC et l\'app MLflow (bouton « Ouvrir » depuis Applications, ou le nœud correspondant du Sandgraph).':
    'Detailed app documentation: open the "Doc" page in the DVC app and the MLflow app (the "Open" button from Applications, or the corresponding Sandgraph node).',

  // AppsPage
  "Annotation d'images avec SAM2, Grounding DINO, ByteTrack. Export YOLO.": 'Image annotation with SAM2, Grounding DINO, ByteTrack. YOLO export.',
  'Exploration de datasets, embedding CLIP, subsets sémantiques, carte UMAP.': 'Dataset exploration, CLIP embedding, semantic subsets, UMAP map.',
  'Entraînement YOLO (v8/v9/v10/11), suivi SSE temps réel, métriques mAP50/95.': 'YOLO training (v8/v9/v10/11), real-time SSE tracking, mAP50/95 metrics.',
  'Inférence fichier, suivi multi-objet, SOT par clic et évaluation des modèles.': 'File inference, multi-object tracking, click-SOT and model evaluation.',
  'Versionnage de datasets avec DVC + Git. Historique des commits.': 'Dataset versioning with DVC + Git. Commit history.',
  "Tracking des expériences d'entraînement, métriques, artefacts.": 'Training experiment tracking, metrics, artifacts.',
  'Optimisation bayésienne des hyperparamètres avec Optuna.': 'Bayesian hyperparameter optimization with Optuna.',
  'Workspace de base': 'Base workspace',
  "Laissez vide = auto (à côté de l'orchestrateur)": 'Leave empty = auto (next to the orchestrator)',
  'Utilisateur': 'User',
  'Laissez vide = user courant': 'Leave empty = current user',
  'Env conda': 'Conda env',
  'Annuler': 'Cancel',
  'Application lancée': 'Application started',
  'Application arrêtée': 'Application stopped',
  'app(s) lancée(s)': 'app(s) started',
  'Toutes les apps sont déjà actives': 'All apps are already active',
  'app(s) arrêtée(s)': 'app(s) stopped',
  'Démarrage en cours…': 'Starting…',
  'Échec du démarrage': 'Startup failed',
  'Le backend ne répond pas. Consultez le journal de lancement.': 'The backend is not responding. Check the launch log.',
  'Arrêter': 'Stop',
  'Mode indépendant': 'Standalone mode',
  'vous pouvez aussi lancer chaque app manuellement depuis son launcher :': 'you can also launch each app manually from its launcher:',

  // LibraryPage
  'Nom requis': 'Name required',
  'Params JSON invalide pour': 'Invalid params JSON for',
  'Pipeline mis à jour': 'Pipeline updated',
  'Pipeline créé': 'Pipeline created',
  'Modifier': 'Edit',
  'Nouveau': 'New',
  'Nom': 'Name',
  'mon-pipeline': 'my-pipeline',
  'Ajouter': 'Add',
  'Étape': 'Step',
  'dépend de (ids)': 'depends on (ids)',
  'Params (JSON)': 'Params (JSON)',
  'Sauvegarde…': 'Saving…',
  'Exécuter': 'Run',
  'Bibliothèque': 'Library',
  'Nouveau pipeline': 'New pipeline',
  'Aucun pipeline — créez-en un ou dupliquez un template': 'No pipeline — create one or duplicate a template',
  '(lecture seule — dupliquer pour modifier)': '(read-only — duplicate to edit)',
  'Pipeline démarré': 'Pipeline started',
  'Erreur au démarrage': 'Error on startup',
  'Erreur': 'Error',
  'Template dupliqué dans votre bibliothèque': 'Template duplicated into your library',

  // LineageGraphPage
  'Run fork': 'Fork run',
  'Run mère': 'Parent run',
  'retirer': 'remove',
  'déposez le jeton': 'drop the token',
  'Comparaison de runs': 'Run comparison',
  'Glissez deux jetons ici. Les éléments identiques restent discrets ; seules les différences sont accentuées.':
    'Drag two tokens here. Identical elements stay subtle; only differences are highlighted.',
  'Différences détectées': 'Differences detected',
  'section(s)': 'section(s)',
  'identique': 'identical',
  'modifié': 'modified',
  'ajouté': 'added',
  'supprimé': 'removed',
  'Une sortie absente dans le fork n’est jamais remplacée par celle du parent.':
    "An output missing in the fork is never replaced by the parent's.",
  'Dataset source commun': 'Shared source dataset',
  'Source non identifiée': 'Unidentified source',
  'chemin non renseigné': 'path not provided',
  'Détails': 'Details',
  'Inputs consommés': 'Consumed inputs',
  'Outputs produits': 'Produced outputs',
  'Aucune production pour ce run interrompu.': 'No output for this interrupted run.',
  'Fork impossible': 'Fork failed',
  'Comparer ce run': 'Compare this run',
  'Duplique le graphe de ce run (meme dataset, memes annotations) et enregistre sa provenance, puis ouvre le fork.':
    "Duplicates this run's graph (same dataset, same annotations) and records its provenance, then opens the fork.",
  'Forker ce run': 'Fork this run',
  'Chargement échoué': 'Loading failed',
  'Erreur lineage': 'Lineage error',
  'Lineage des expériences': 'Experiment lineage',
  'Run parent → fork → différences introduites → conséquences sur les sorties':
    'Parent run → fork → introduced differences → consequences on outputs',
  'Liste': 'List',
  'Graphe': 'Graph',
  'Décompact': 'Expand',

  // PipelinePage
  'Dépendances': 'Dependencies',
  'Sortie': 'Output',
  'Aucune étape — éditez le pipeline dans la bibliothèque': 'No step — edit the pipeline in the library',
  'Démarrage…': 'Starting…',
  'En attente': 'Waiting',
  'Succès': 'Success',
  'Échoué': 'Failed',
  'Arrêté': 'Stopped',
  'Exécution interrompue': 'Execution interrupted',
  'Pipeline introuvable': 'Pipeline not found',
  'Éditer': 'Edit',

  // NodeConfigPanel.tsx (panneau de config des noeuds du sandgraph)
  'Aide — explication des paramètres': 'Help — parameter explanations',
  'Supprimer (Suppr)': 'Delete (Del)',
  'Tirer pour redimensionner': 'Drag to resize',
  'Aide': 'Help',
  'Options': 'Options',
  'Effet': 'Effect',
  'Aucune aide définie pour ce nœud.': 'No help defined for this node.',
  'Nom du nœud (affiché)': 'Node name (displayed)',
  'Nom du dataset': 'Dataset name',
  'Chemin (dossier)': 'Path (folder)',
  'C:/data/images ou \\\\serveur\\partage\\images': 'C:/data/images or \\\\server\\share\\images',
  'Vérification doublon…': 'Checking for duplicate…',
  'Ce chemin existe déjà dans Dataset Explorer sous': 'This path already exists in Dataset Explorer under',
  'ces noms': 'these names',
  'ce nom': 'this name',
  'Créer quand même un dataset séparé (nouveau scan + ré-embedding CLIP)': 'Create a separate dataset anyway (new scan + re-embedding CLIP)',
  'embeddings CLIP': 'CLIP embeddings',
  'Chemin du modèle': 'Model path',
  'Extension inattendue pour': 'Unexpected extension for',
  'ces poids ne se chargeront pas.': 'these weights will not load.',
  'Taille (fige le Training)': 'Size (locks Training)',
  'Nœud d\'entrée': 'Input node',
  'branché sur un': 'connected to a',
  'poids de départ / fine-tuning — le moteur': 'starting weights / fine-tuning — the engine',
  'et la taille': 'and the size',
  'figent ceux du training': 'lock those of the training',
  'ou une': 'or an',
  'modèle à tester': 'model to test',
  'Moteur (figé par': 'Engine (locked by',
  'le nœud branché': 'the connected node',
  'Moteur d\'entraînement': 'Training engine',
  'indisponible': 'unavailable',
  'oui': 'yes',
  'non': 'no',
  'Dataset source (branché · figé)': 'Dataset source (connected · locked)',
  'Dataset source': 'Dataset source',
  'auto depuis nœud source': 'auto from source node',
  'Nom du subset (sortie)': 'Subset name (output)',
  'Charger les subsets depuis le workspace': 'Load subsets from the workspace',
  'Parcourir': 'Browse',
  'Full Auto : calculé automatiquement (requête CLIP), rien à choisir.': 'Full Auto: computed automatically (CLIP query), nothing to choose.',
  'Mode FREE : choisissez un subset déjà produit (aucun pipeline ne sera relancé).': 'FREE mode: choose an already produced subset (no pipeline will be restarted).',
  'Subsets existants': 'Existing subsets',
  'Aucun subset dans le workspace (explorer_{user}/subsets/)': 'No subset in the workspace (explorer_{user}/subsets/)',
  'Full Automatique (CLIP)': 'Full Automatic (CLIP)',
  'Requête sémantique': 'Semantic query',
  'Subset source (branché · figé)': 'Subset source (connected · locked)',
  'Subset source': 'Subset source',
  'auto depuis explorer': 'auto from explorer',
  'Nom du projet (à annoter)': 'Project name (to annotate)',
  'Ce subset a déjà été annoté dans': 'This subset has already been annotated in',
  'ces projets': 'these projects',
  'ce projet': 'this project',
  'annotées': 'annotated',
  'Est-ce voulu (nouveau jeu de classes) ?': 'Is this intended (new class set)?',
  'Mode': 'Mode',
  'Séquentiel (frame par frame)': 'Sequential (frame by frame)',
  'Aléatoire': 'Random',
  'Train': 'Train',
  'Val': 'Val',
  'Test': 'Test',
  'Full Automatique (IA)': 'Full Automatic (AI)',
  'Manuel (annoter dans l\'app)': 'Manual (annotate in the app)',
  'Tous les paramètres d\'auto-annotation (rien de caché — c\'est ce qui est envoyé) :': 'All auto-annotation parameters (nothing hidden — this is what is sent):',
  'Modèle IA': 'AI model',
  'Prompt texte (open-vocab)': 'Text prompt (open-vocab)',
  'Seuil box (box_threshold)': 'Box threshold (box_threshold)',
  'Seuil de confiance': 'Confidence threshold',
  'Le prompt définit les classes détectées. Le seuil = score min des boîtes (backend :': 'The prompt defines the detected classes. The threshold = min score of the boxes (backend:',
  'Valider les annotations avant export (Continuer)': 'Review annotations before export (Continue)',
  'Ajoute un point d\'arrêt après l\'annotation auto : la chaîne attend votre « Continuer » pour exporter.': 'Adds a checkpoint after auto-annotation: the chain waits for your "Continue" to export.',
  'Export à utiliser (aval)': 'Export to use (downstream)',
  'Parcourir les exports existants du workspace': 'Browse existing exports of the workspace',
  'Mode FREE : choisissez un export déjà produit (aucun pipeline ne sera relancé).': 'FREE mode: choose an already produced export (no pipeline will be restarted).',
  'actuel': 'current',
  '.ver (→ Inference/Éval)': '.ver (→ Inference/Eval)',
  'YOLO (→ Training/Optuna)': 'YOLO (→ Training/Optuna)',
  'Aucun export dans le workspace (annotation_{user}/exports/)': 'No export in the workspace (annotation_{user}/exports/)',
  'Export': 'Export',
  'automatique': 'automatic',
  'après l\'annotation IA — pas de choix ici : le dataset': 'after AI annotation — no choice here: the',
  'se crée tout seul.': 'dataset creates itself.',
  'Classes (labels)': 'Classes (labels)',
  'Deux sorties distinctes': 'Two distinct outputs',
  'dataset YOLO': 'YOLO dataset',
  'GT natif': 'native GT',
  'DVC verse le dossier YOLO tel quel.': 'DVC versions the YOLO folder as is.',
  'aucun': 'none',
  'commité dans DVC': 'committed to DVC',
  'échec commit': 'commit failed',
  'Versioning manuel, à la demande.': 'Manual versioning, on demand.',
  'Rien n\'est versionné automatiquement au lancement': 'Nothing is versioned automatically when',
  'du graphe : tant que vous ne cliquez pas, ce run n\'est': 'the graph runs: until you click, this run is',
  'pas': 'not',
  'tracé.': 'tracked.',
  '« Créer une version » fait exactement 3 choses :': '"Create a version" does exactly 3 things:',
  'un commit du snapshot (fichiers': 'a commit of the snapshot (files',
  '+ graphe) avec les métadonnées du run (Run-Id, dataset, mAP50).': '+ graph) with the run metadata (Run-Id, dataset, mAP50).',
  'le contenu réel des artefacts cochés (dataset / modèle) est enregistré dans DVC.': 'the actual content of the checked artifacts (dataset / model) is recorded in DVC.',
  'poussé vers le stockage distant': 'pushed to the remote storage',
  'si': 'if',
  'un remote est configuré (sinon local uniquement).': 'a remote is configured (otherwise local only).',
  'Pipeline en cours — les artefacts seront proposés après sa réussite.': 'Pipeline running — artifacts will be offered once it succeeds.',
  'Lancez le pipeline pour produire les artefacts de ce run.': 'Run the pipeline to produce this run\u2019s artifacts.',
  'Versionné': 'Versioned',
  'Non versionné — aucun commit DVC pour ce run': 'Not versioned — no DVC commit for this run',
  'Message de commit': 'Commit message',
  'Artefacts du graphe': 'Graph artifacts',
  'rafraîchir': 'refresh',
  'graphe non sauvegardé': 'graph not saved',
  'chargement…': 'loading…',
  'télécharger': 'download',
  'pas encore produit — lancez le pipeline': 'not produced yet — run the pipeline',
  'Ce run est déjà versionné — relancez le pipeline pour produire un nouveau run à versionner.': 'This run is already versioned — restart the pipeline to produce a new run to version.',
  'Crée un commit Git du snapshot + enregistre le contenu des artefacts cochés dans DVC (et le pousse si un remote est configuré).': 'Creates a Git commit of the snapshot + records the content of the checked artifacts in DVC (and pushes it if a remote is configured).',
  'Création de la version en cours…': 'Creating the version…',
  'Run déjà versionné': 'Run already versioned',
  'Créer une version DVC (Git + cache DVC)': 'Create a DVC version (Git + DVC cache)',
  'Ouvrir ce run dans DVC App': 'Open this run in DVC App',
  'Lancez d\'abord le pipeline pour ouvrir son espace DVC.': 'Run the pipeline first to open its DVC space.',
  'Nom du run / modèle (sortie)': 'Run / model name (output)',
  'le modèle': 'the model',
  'L\'étude Optuna amont optimise': 'The upstream Optuna study optimizes',
  'choisissez le même moteur, sinon le lancement sera refusé.': 'use the same engine, otherwise the launch will be refused.',
  'Taille': 'Size',
  'figée par le modèle': 'locked by the model',
  'Full Automatique (REST)': 'Full Automatic (REST)',
  'Manuel (lancer dans l\'app)': 'Manual (start in the app)',
  'Branché à': 'Connected to',
  'les hyperparamètres ci-dessous seront': 'the hyperparameters below will be',
  'remplacés par les best params': 'replaced by the best params',
  'trouvés par l\'étude au lancement — figés ici pour éviter toute confusion.': 'found by the study at launch — locked here to avoid confusion.',
  'Tous les hyperparamètres': 'All hyperparameters',
  'figés (Optuna)': 'locked (Optuna)',
  'Rien de magique : ces valeurs sont exactement ce qui est envoyé au moteur': 'Nothing magic: these values are exactly what is sent to the',
  'poids': 'weights',
  'du moteur': 'engine',
  'dans le run': 'in the run',
  'Mode Manuel : ouvrez Training App, lancez l\'entraînement, puis revenez et cliquez': 'Manual mode: open Training App, start training, then come back and click',
  'Ouvrir Training App': 'Open Training App',
  '(best.pt du training amont)': '(best.pt from the upstream training)',
  '(séquence branchée)': '(connected sequence)',
  '(GT branché)': '(connected GT)',
  'revenir au template': 'revert to template',
  'branché': 'connected',
  '(vide)': '(empty)',
  'config.yaml complet (tous les params, prérempli)': 'full config.yaml (all params, pre-filled)',
  'config.yaml introuvable côté Inference_App': 'config.yaml not found on the Inference_App side',
  'Prérempli du template ; seuls les champs': 'Pre-filled from the template; only the',
  'modifiés •': 'modified •',
  'sont envoyés (override). Branchés = verrouillés.': 'fields are sent (override). Connected = locked.',
  'tout réinit': 'reset all',
  'ouvrez Inference App, choisissez un fichier image/vidéo, un fichier de poids et le mode YOLO, MOT ou SOT.': 'open Inference App, choose an image/video file, a weights file and the YOLO, MOT or SOT mode.',
  'Ouvrir Inference App': 'Open Inference App',
  'Auto (headless)': 'Auto (headless)',
  'Manuel (interactif)': 'Manual (interactive)',
  '« GT (.ver) » est branché mais aucun': '"GT (.ver)" is connected but no',
  'images': 'images',
  'ne l\'est — branchez aussi': 'is — also connect',
  'un dataset (ou un dataset YOLO) pour que ce GT serve à quelque chose.': 'a dataset (or a YOLO dataset) for this GT to be of any use.',
  'Manuel': 'Manual',
  'interactif': 'interactive',
  'ouvrez l\'Inference App, lancez l\'inférence YOLO/MOT ou cliquez une cible pour le': 'open the Inference App, run YOLO/MOT inference or click a target for the',
  'Aucune option ici — tout se': 'No option here — everything is',
  'pilote dans l\'app. Puis revenez et cliquez': 'controlled in the app. Then come back and click',
  'Tâche': 'Task',
  'Tracking (tracker)': 'Tracking (tracker)',
  'Détection (YOLO only)': 'Detection (YOLO only)',
  'le modèle amont': 'the upstream model',
  'Architecture': 'Architecture',
  'figée par l\'amont': 'locked by the upstream node',
  'Pré-contrôle bloquant : ce nœud est configuré en': 'Blocking pre-check: this node is configured with',
  'mais le modèle amont est en': 'but the upstream model is',
  'Pré-contrôle bloquant : ce nœud déclare': 'Blocking pre-check: this node declares',
  'mais le checkpoint amont est en': 'but the upstream checkpoint is',
  'Modèle (branché · figé)': 'Model (connected · locked)',
  'Modèle (best.pt)': 'Model (best.pt)',
  '(vide = best.pt du training amont)': '(empty = best.pt from the upstream training)',
  'Séquence (branchée · figée)': 'Sequence (connected · locked)',
  'Séquence (source)': 'Sequence (source)',
  '(vide = images du split Annotation ci-dessous)': '(empty = images of the Annotation split below)',
  'Split Annotation (train/val/test)': 'Annotation split (train/val/test)',
  'GT (dossier .txt YOLO / .ver — vide = split ci-dessus)': 'GT (YOLO .txt folder / .ver — empty = split above)',
  'GT (dossier .txt YOLO / .ver)': 'GT (YOLO .txt folder / .ver)',
  '(vide = labels/ du split Annotation)': '(empty = labels/ of the Annotation split)',
  '(pas de data.yaml — réservé au Training)': '(no data.yaml — reserved for Training)',
  'Détection YOLO par frame vs GT →': 'Per-frame YOLO detection vs GT →',
  'précision / rappel / tp-fp-fn': 'precision / recall / tp-fp-fn',
  'Tracker multi-objet': 'Multi-object tracker',
  'Aucun — YOLO pur': 'None — YOLO only',
  'Track high': 'Track high',
  'Match IoU': 'Match IoU',
  'Rendu & sauvegarde': 'Rendering & saving',
  'Sauver le média annoté': 'Save the annotated media',
  'Frames max (0 = toutes)': 'Max frames (0 = all)',
  'Fenêtre & système': 'Window & system',
  'Auto': 'Auto',
  'Buffer ByteTrack': 'ByteTrack buffer',
  'yaml brut (tous les params)': 'raw yaml (all params)',
  'Toute clé du config.yaml, en JSON. Fusionnée par-dessus (sans oubli).': 'Any config.yaml key, in JSON. Merged on top (nothing lost).',
  'Nb trials': 'Nb trials',
  'Direction': 'Direction',
  'Maximiser': 'Maximize',
  'Minimiser': 'Minimize',
  'Métrique objectif': 'Objective metric',
  'Taille entraînée par les trials': 'Size trained by the trials',
  'Sampler': 'Sampler',
  'pruning désactivé. Chaque trial entraîne un': 'pruning disabled. Each trial trains a',
  'modèle': 'model',
  'moteur': 'engine',
  'le Training aval doit utiliser le même moteur.': 'the downstream Training must use the same engine.',
  'Arrêter le pipeline si aucun trial n\'aboutit': 'Stop the pipeline if no trial succeeds',
  'recommandé et activé par défaut.': 'recommended and enabled by default.',
  'Si décoché, le Training continue sans paramètres Optuna, avec ses paramètres configurés puis ses défauts.': 'If unchecked, Training continues without Optuna parameters, using its configured parameters then its defaults.',
  'Full Automatique (étude auto)': 'Full Automatic (auto study)',
  'Manuel (gate — étude dans l\'app)': 'Manual (gate — study in the app)',
  'Espace de recherche': 'Search space',
  'sélectionné': 'selected',
  'Cochez les hyperparamètres à optimiser (les autres = défauts).': 'Check the hyperparameters to optimize (the others = defaults).',
  'best params': 'best params',
  'fallback Training': 'Training fallback',
  'arrêt du pipeline': 'pipeline stop',
  'Mode Manuel : ouvrez Optuna App, lancez l\'étude, récupérez les meilleurs params, puis': 'Manual mode: open Optuna App, run the study, get the best params, then',
  'inscrivez-les ci-dessous': 'enter them below',
  'ils transitent par la flèche vers le Training aval, qui les fusionne.': 'they travel through the edge to the downstream Training, which merges them.',
  'Format': 'Format',
  'clé=valeur': 'key=value',
  'séparés par des virgules, ou JSON.': 'separated by commas, or JSON.',
  'Ouvrir Optuna App': 'Open Optuna App',
  'Nœud': 'Node',
  'SUPERVISEUR': 'SUPERVISOR',
  'aucun branchement, aucun paramètre. Il observe en continu le store': 'no connection, no parameter. It continuously observes the',
  'MLflow du workspace. Chaque Training / Inference / Éval y logue un run': 'workspace\'s MLflow store. Every Training / Inference / Eval logs a run there',
  'Ce qui sera loggé': 'What will be logged',
  'Aucun nœud Training / Inference dans ce graphe.': 'No Training / Inference node in this graph.',
  'params (hyperparamètres, epochs…) + mAP + plots + poids (registry)': 'params (hyperparameters, epochs…) + mAP + plots + weights (registry)',
  'métriques mAP / MOTA / IDF1 + benchmark': 'mAP / MOTA / IDF1 metrics + benchmark',
  'Nom de run déterministe': 'Deterministic run name',
  'Ouvrir ce run dans MLflow App': 'Open this run in MLflow App',
  'Lancez d\'abord le pipeline pour ouvrir son espace MLflow.': 'Run the pipeline first to open its MLflow space.',
  'Fourni par un nœud branché (figé)': 'Provided by a connected node (locked)',
  'Fourni par un noeud branche (fige)': 'Provided by a connected node (locked)',
  'Glissez un dossier depuis l\'explorateur Windows, ou collez un chemin (partage reseau accepte)': 'Drag a folder from Windows Explorer, or paste a path (network share accepted)',
  'Parcourir…': 'Browse…',

  // nodeHelp.ts (contenu du panneau d'AIDE, affiche via t() dans HelpPanel)
  "Nœud léger : inférence YOLO pure, détection multi-objet avec ByteTrack optionnel, ou SOT interactif par clic avec CSRT.":
    'Lightweight node: pure YOLO inference, multi-object detection with optional ByteTrack, or interactive click-based SOT with CSRT.',
  "Mode d'exécution du nœud.": "The node's execution mode.",
  'Auto (inférence/MOT sans écran) · Manuel (ouvre l\'app pour choisir le média et cliquer une cible SOT)':
    'Auto (inference/MOT headless) · Manual (opens the app to choose the media and click a SOT target)',
  'Manuel = human_gate (le pipeline attend que vous validiez dans l\'app).': 'Manual = human_gate (the pipeline waits for you to validate in the app).',
  'Détection YOLO seule sur une SÉQUENCE, comparée à un GT (.ver ou dossier .txt YOLO). Pas de data.yaml (réservé au Training).':
    'YOLO-only detection on a SEQUENCE, compared to a GT (.ver or YOLO .txt folder). No data.yaml (reserved for Training).',
  'GT : fichier .ver OU dossier de .txt YOLO par frame': 'GT: .ver file OR folder of per-frame YOLO .txt',
  'Sortie : précision / rappel / tp-fp-fn → MLflow.': 'Output: precision / recall / tp-fp-fn → MLflow.',
  'Détection multi-objet YOLO, avec association ByteTrack optionnelle.': 'Multi-object YOLO detection, with optional ByteTrack association.',
  'Sortie : média annoté + temps détecteur, temps tracker et FPS bout en bout.': 'Output: annotated media + detector time, tracker time and end-to-end FPS.',
  'Fichier de poids produit par le moteur choisi. Vide = modèle du Training amont ou d\'un nœud Modèle.':
    'Weights file produced by the chosen engine. Empty = model from the upstream Training or a Model node.',
  'Le moteur voyage avec le checkpoint et peut être fourni par un plugin.': 'The engine travels with the checkpoint and can be provided by a plugin.',
  'Tracker multi-objets (plein cadre).': 'Multi-object tracker (full frame).',
  'none (inférence YOLO pure) · bytetrack (identités multi-objets)': 'none (pure YOLO inference) · bytetrack (multi-object identities)',
  'ByteTrack fonctionne après le détecteur natif ou un détecteur de plugin.': 'ByteTrack runs after the native detector or a plugin detector.',
  'Tracker mono-objet déclenché au clic.': 'Single-object tracker triggered by a click.',
  'csrt (OpenCV, CPU)': 'csrt (OpenCV, CPU)',
  'Le clic choisit une détection YOLO sur la première frame, puis CSRT suit cette boîte.': 'The click picks a YOLO detection on the first frame, then CSRT tracks that box.',
  'Nombre de cibles SOT simultanées.': 'Number of simultaneous SOT targets.',
  '1 (clic gauche) · 2 (clic gauche = cible 1 magenta, clic droit = cible 2 orange)': '1 (left click) · 2 (left click = target 1 magenta, right click = target 2 orange)',
  'Vérité terrain (.ver ou YOLO .txt) pour calculer les métriques. Si un nœud Annotation est branché directement sur ce port (au lieu de Training), laissez ce champ vide : il est dérivé automatiquement du split choisi ci-dessous (labels/).':
    'Ground truth (.ver or YOLO .txt) to compute metrics. If an Annotation node is connected directly to this port (instead of Training), leave this field empty: it is automatically derived from the split chosen below (labels/).',
  'Sans GT : benchmark de vitesse seul. Avec GT : MOTA/IDF1 (tracking) ou précision/rappel (détection).':
    'Without GT: speed benchmark only. With GT: MOTA/IDF1 (tracking) or precision/recall (detection).',
  'Annotation exporte un data.yaml COMPLET (train + val + test) — le Training consomme les 3 splits, mais Inference évalue sur UN SEUL split à la fois (séquence + GT ponctuels). Ce sélecteur choisit lequel des 3 dossiers ({export}/train|val|test/{images,labels}) alimente la séquence et le GT.':
    'Annotation exports a COMPLETE data.yaml (train + val + test) — Training consumes all 3 splits, but Inference evaluates on ONE split at a time (single sequence + GT). This selector picks which of the 3 folders ({export}/train|val|test/{images,labels}) feeds the sequence and GT.',
  'train (voir le sur-apprentissage) · val (défaut, éval standard) · test (jeu jamais vu par le training)':
    'train (check overfitting) · val (default, standard eval) · test (set never seen by training)',
  'Sans nœud Annotation branché ici, ce sélecteur n\'apparaît pas (séquence/GT restent manuels ou hérités d\'un dataset_source).':
    'Without an Annotation node connected here, this selector does not appear (sequence/GT stay manual or inherited from a dataset_source).',
  'Active le calcul MOTA/IDF1 (nécessite un GT).': 'Enables MOTA/IDF1 computation (requires a GT).',
  'Rendu ultra-rapide (bboxes seules, zéro texte/traîne).': 'Ultra-fast rendering (boxes only, zero text/trail).',
  'true (défaut, bench/stream) · false (complet : légende, IDs, traîne, HUD)': 'true (default, bench/stream) · false (full: legend, IDs, trail, HUD)',
  'true économise ~3–5 ms/frame ; false pour l\'analyse visuelle.': 'true saves ~3-5 ms/frame; false for visual analysis.',
  'Sauver la vidéo MP4 / chaque frame annotée.': 'Save the MP4 video / every annotated frame.',
  'save_frames = écriture disque lourde (~500 Ko/frame PNG).': 'save_frames = heavy disk writes (~500 KB/frame PNG).',
  'Format des frames sauvées.': 'Format of the saved frames.',
  'png (sans perte) · jpg (compressé, bande passante)': 'png (lossless) · jpg (compressed, bandwidth)',
  'Longueur de la traîne de trajectoire (frames). 0 = désactivé.': 'Length of the trajectory trail (frames). 0 = disabled.',
  'Fenêtre de frames traitées (retest sur une zone). -1 = jusqu\'à la fin.': 'Window of processed frames (retest on a zone). -1 = until the end.',
  'Périphérique PyTorch pour les trackers GPU.': 'PyTorch device for GPU trackers.',
  'cuda · cpu': 'cuda · cpu',
  'Fréquence cible (Hz) — pilote le temps d\'attente du loader.': "Target rate (Hz) — drives the loader's wait time.",
  'Détection : seuil de confiance, seuil NMS, taille réseau.': 'Detection: confidence threshold, NMS threshold, network size.',
  'conf bas = plus de détections (et de faux positifs). imgsz haut = plus précis, plus lent.':
    'low conf = more detections (and false positives). high imgsz = more accurate, slower.',
  "Entraîne un modèle avec le moteur choisi (Training_App, YOLOX par défaut). Auto = REST bloquant ; Manuel = gate (lancez dans l'app).":
    'Trains a model with the chosen engine (Training_App, YOLOX by default). Auto = blocking REST; Manual = gate (start in the app).',
  'Moteur d\'entraînement (Training_App). YOLOX par défaut ; le sélecteur n\'apparaît que si un plugin en fournit d\'autres.':
    "Training engine (Training_App). YOLOX by default; the selector only appears if a plugin provides others.",
  'Les poids produits ne se rechargent qu\'avec leur moteur : il voyage avec eux (nœud Modèle, Training, MLflow).':
    'The produced weights only reload with their engine: it travels with them (Model node, Training, MLflow).',
  'Taille du modèle, dans le catalogue du moteur. Moteur et taille sont figés si un nœud Modèle est branché.':
    "Model size, from the engine's catalog. Engine and size are locked if a Model node is connected.",
  'YOLOX : yolox-nano < tiny < s < m < l < x (petit→grand, rapide→précis)': 'YOLOX: yolox-nano < tiny < s < m < l < x (small→large, fast→accurate)',
  'Nombre de passes sur le dataset (max_epoch).': 'Number of passes over the dataset (max_epoch).',
  'Plus = meilleure convergence mais surapprentissage possible.': 'More = better convergence but possible overfitting.',
  'Nombre d\'images par pas.': 'Number of images per step.',
  'Limité par la VRAM. Trop grand = OOM.': 'Limited by VRAM. Too large = OOM.',
  'Taille d\'entrée (px, carré).': 'Input size (px, square).',
  '640 standard · 1280 petits objets (plus lent)': '640 standard · 1280 small objects (slower)',
  'Formulaire propre au moteur choisi (ses clés et ses défauts).': "Form specific to the chosen engine (its keys and defaults).",
  'Changer de moteur repart de ses défauts : les clés d\'un moteur n\'ont pas de sens pour un autre.':
    "Switching engine resets to its defaults: one engine's keys have no meaning for another.",
  'Learning rate par image (lr réel = valeur × batch_size).': 'Learning rate per image (actual lr = value x batch_size).',
  'Trop haut = divergence ; trop bas = lent.': 'Too high = divergence; too low = slow.',
  'Derniers epochs sans mosaic/mixup, pour finir sur des images non déformées.': 'Last epochs without mosaic/mixup, to finish on undistorted images.',
  'Augmentations de données.': 'Data augmentations.',
  'Renforcent la généralisation ; trop = artefacts.': 'Strengthen generalization; too much = artifacts.',
  'Nom du run (dossier + poids finaux). Ton nom custom pour la sortie.': 'Run name (folder + final weights). Your custom name for the output.',
  "Crée un projet d'annotation et exporte au format YOLO (train/val/test). Full Auto = IA (SAM3/GDINO). Une SEULE sortie physique (le dossier YOLO exporté), mais DEUX usages en aval selon le nœud branché : vers Training → tout le data.yaml (3 splits) sert à l'entraînement. Vers Inference/Éval → un split unique (choisi sur le nœud Inference) sert de séquence + GT pour l'évaluation. Rien à configurer ici pour ça, c'est le nœud AVAL (Inference) qui choisit son split.":
    'Creates an annotation project and exports in YOLO format (train/val/test). Full Auto = AI (SAM3/GDINO). ONE physical output (the exported YOLO folder), but TWO downstream uses depending on the connected node: to Training → the whole data.yaml (3 splits) is used for training. To Inference/Eval → a single split (chosen on the Inference node) is used as sequence + GT for evaluation. Nothing to configure here for that, it is the DOWNSTREAM node (Inference) that chooses its split.',
  'Type de projet.': 'Project type.',
  'sequence (vidéo/optional_format, onglet Tracks) · random (images indépendantes)': 'sequence (video/optional_format, Tracks tab) · random (independent images)',
  'Annote sans intervention via un modèle open-vocabulary.': 'Annotates without intervention via an open-vocabulary model.',
  'false = gate humaine (vous annotez dans l\'app).': 'false = human gate (you annotate in the app).',
  'Modèle d\'auto-annotation.': 'Auto-annotation model.',
  'sam3 (masques) · grounding_dino (boîtes texte)': 'sam3 (masks) · grounding_dino (text boxes)',
  'Classes à détecter en langage naturel.': 'Classes to detect, in natural language.',
  'ex: "car. person. tree."': 'e.g.: "car. person. tree."',
  'Score minimum des boîtes retenues.': 'Minimum score of the kept boxes.',
  'Bas = plus de détections + faux positifs ; haut = plus strict.': 'Low = more detections + false positives; high = stricter.',
  'Répartition de l\'export YOLO (dossiers {export}/train|val|test/{images,labels}).':
    'Split of the YOLO export (folders {export}/train|val|test/{images,labels}).',
  'Somme = 1.0 (test optionnel). Training lit les 3 ; Inference/Éval n\'en lit qu\'un (gt_split).':
    'Sum = 1.0 (test optional). Training reads all 3; Inference/Eval reads only one (gt_split).',
  'Étude d\'optimisation d\'hyperparamètres (TPE, pruning désactivé). Entraîne un modèle par trial avec le moteur choisi (Training_App).':
    'Hyperparameter optimization study (TPE, pruning disabled). Trains one model per trial with the chosen engine (Training_App).',
  'Moteur entraîné par chaque trial : le même que celui du Training aval, sinon le lancement est refusé. YOLOX par défaut ; le sélecteur n\'apparaît que si un plugin en fournit d\'autres.':
    'Engine trained by each trial: the same as the downstream Training, otherwise the launch is refused. YOLOX by default; the selector only appears if a plugin provides others.',
  'Nombre d\'essais (chaque essai = un entraînement).': 'Number of trials (each trial = one training run).',
  'Plus = meilleure recherche mais coûteux (N trainings).': 'More = better search but costly (N training runs).',
  'Sens d\'optimisation de la métrique.': 'Optimization direction of the metric.',
  'maximize (mAP) · minimize (loss)': 'maximize (mAP) · minimize (loss)',
  'Objectif optimisé.': 'Optimized objective.',
  'map50 · map5095 · recall · precision': 'map50 · map5095 · recall · precision',
  'Hyperparamètres explorés (cochés).': 'Explored hyperparameters (checked).',
  'Non cochés = valeurs par défaut. TPE échantillonne les cochés dans des plages FIXES, déclarées par le moteur (catalogue hpo_ranges) — il n\'y a PAS de champ min/max ici, seulement le choix binaire "optimisé ou non". Exemples ci-dessous pour YOLOX.':
    'Unchecked = default values. TPE samples the checked ones within FIXED ranges, declared by the engine (hpo_ranges catalog) — there is NO min/max field here, only the binary choice "optimized or not". Examples below for YOLOX.',
  'Politique appliquée si aucun trial ne termine avec une métrique exploitable.': 'Policy applied if no trial finishes with a usable metric.',
  'coché (défaut) = Training ne démarre pas · décoché = Training démarre sans best_params Optuna':
    'checked (default) = Training does not start · unchecked = Training starts without Optuna best_params',
  'En fallback, Training conserve exactement les hyperparamètres configurés dans son propre nœud, puis les valeurs par défaut de Training pour les champs absents.':
    'As a fallback, Training keeps exactly the hyperparameters configured on its own node, then the Training defaults for missing fields.',
  'Le plus influent en général — vitesse d\'apprentissage au 1er epoch.': 'The most influential in general — learning speed at the 1st epoch.',
  'LR minimal en fin de scheduler (fraction du LR de base).': 'Minimum LR at the end of the scheduler (fraction of the base LR).',
  'Contrôle la décroissance du LR en fin d\'entraînement.': 'Controls the LR decay at the end of training.',
  'Momentum SGD.': 'SGD momentum.',
  'Lisse les mises à jour de gradient — trop haut = oscillations.': 'Smooths gradient updates — too high = oscillations.',
  'Régularisation L2 des poids.': 'L2 weight regularization.',
  'Trop haut = sous-apprentissage ; trop bas = surapprentissage.': 'Too high = underfitting; too low = overfitting.',
  'Probabilité d\'augmentation mosaïque (4 images combinées).': 'Probability of mosaic augmentation (4 combined images).',
  'Aide la généralisation, surtout sur petits datasets.': 'Helps generalization, especially on small datasets.',
  'Probabilité d\'augmentation mixup (mélange linéaire de 2 images).': 'Probability of mixup augmentation (linear blend of 2 images).',
  'Régularisation supplémentaire, utile si peu de données.': 'Additional regularization, useful with little data.',
  'Probabilité de jitter HSV (teinte/saturation/valeur).': 'Probability of HSV jitter (hue/saturation/value).',
  'Robustesse aux variations d\'éclairage et de couleur.': 'Robustness to lighting and color variations.',
  'Probabilité de flip horizontal.': 'Probability of horizontal flip.',
  'Robustesse à l\'orientation gauche/droite des objets.': "Robustness to objects' left/right orientation.",
  'Amplitude de rotation aléatoire (degrés).': 'Amplitude of random rotation (degrees).',
  'Utile si les objets peuvent apparaître sous différents angles.': 'Useful if objects can appear at different angles.',
  'Amplitude de translation aléatoire (fraction de l\'image).': 'Amplitude of random translation (fraction of the image).',
  'Aide à la robustesse au cadrage.': 'Helps with robustness to framing.',
  'Amplitude de cisaillement aléatoire (degrés, augmentation affine).': 'Amplitude of random shear (degrees, affine augmentation).',
  'Aide à généraliser sur des perspectives variées.': 'Helps generalize across varied perspectives.',
  'Params saisis à la main après une étude dans l\'app.': 'Parameters entered by hand after a study in the app.',
  'format clé=valeur, séparés par virgules, ou JSON': 'key=value format, comma-separated, or JSON',
  'Transitent par l\'arête → fusionnés dans le Training aval.': 'Travel through the edge → merged into the downstream Training.',
  'Crée un subset sémantique par requête CLIP, ou expose un subset existant (FREE).': 'Creates a semantic subset via a CLIP query, or exposes an existing subset (FREE).',
  'Texte décrivant les images voulues (embeddings CLIP).': 'Text describing the wanted images (CLIP embeddings).',
  'ex: "night dark road car headlight"': 'e.g.: "night dark road car headlight"',
  'Nombre d\'images sélectionnées (les plus proches de la requête).': 'Number of selected images (closest to the query).',
  'true = sélection auto par requête ; false = sélection manuelle dans le Playground.': 'true = auto selection by query; false = manual selection in the Playground.',
  'Nœud d\'ENTRÉE : un dossier d\'images source. Alimente explorer, Annotation ou Inference.':
    'INPUT node: a source image folder. Feeds explorer, Annotation or Inference.',
  'Identifiant du dataset (repris comme subset/projet en aval).': 'Dataset identifier (reused as subset/project downstream).',
  'Chemin absolu vers le dossier d\'images (zéro copie).': 'Absolute path to the image folder (zero copy).',
  'Nombre de clusters CLIP pour la visualisation (explorer).': 'Number of CLIP clusters for visualization (explorer).',
  'Nœud d\'ENTRÉE : des poids fournis manuellement (YOLOX .pth par défaut).': 'INPUT node: manually provided weights (YOLOX .pth by default).',
  'Moteur qui a produit ces poids. YOLOX par défaut ; le sélecteur n\'apparaît que si un plugin en fournit d\'autres.':
    'Engine that produced these weights. YOLOX by default; the selector only appears if a plugin provides others.',
  'Chemin du fichier de poids, à l\'extension du moteur (YOLOX : .pth).': "Path to the weights file, with the engine's extension (YOLOX: .pth).",
  'Taille du modèle associée aux poids. Branché sur un Training, FIGE son moteur et sa taille.':
    "Model size associated with the weights. When connected to a Training, LOCKS its engine and size.",
  'Un best_ckpt.pth yolox-nano ne peut être fine-tuné qu\'en yolox-nano, et par YOLOX — d\'où le gel (les poids ne sont compatibles ni entre tailles ni entre moteurs).':
    'A best_ckpt.pth yolox-nano can only be fine-tuned as yolox-nano, and by YOLOX — hence the lock (weights are compatible neither across sizes nor across engines).',
  'Versionne un run reproductible : dataset + best model + snapshot du graphe, en un seul commit git/DVC.':
    'Versions a reproducible run: dataset + best model + graph snapshot, in a single git/DVC commit.',
  '« artefact » (port d\'entrée)': '"artifact" (input port)',
  'DVC ne verse PAS un type de donnée unique — le port accepte n\'importe quel résultat produit en amont (Annotation = dataset YOLO, explorer = subset, Training = modèle .pth, Inference/Éval = métriques, Optuna = best params). Peu importe le nœud branché, DVC commite TOUJOURS la même chose : le dataset YOLO (dérivé en remontant jusqu\'à l\'ancêtre Annotation) + le modèle .pth (dérivé en remontant jusqu\'à l\'ancêtre Training, s\'il y en a un) + un snapshot JSON du graphe entier (nodes+edges) pour pouvoir tout rejouer plus tard.':
    'DVC does NOT version a single data type — the port accepts any result produced upstream (Annotation = YOLO dataset, explorer = subset, Training = .pth model, Inference/Eval = metrics, Optuna = best params). Whatever node is connected, DVC ALWAYS commits the same thing: the YOLO dataset (derived by walking up to the Annotation ancestor) + the .pth model (derived by walking up to the Training ancestor, if any) + a JSON snapshot of the whole graph (nodes+edges) to be able to replay everything later.',
  'Le TYPE du nœud branché ne change rien au comportement — il sert juste à fixer où DVC se place dans la chaîne (généralement en bout, après Inference/Éval).':
    "The connected node's TYPE does not change the behavior — it only fixes where DVC sits in the chain (usually at the end, after Inference/Eval).",
  'Message du commit git/DVC.': 'git/DVC commit message.',
  'Nœud SUPERVISEUR : aucun branchement. Observe le store MLflow du workspace.': "SUPERVISOR node: no connection. Observes the workspace's MLflow store.",
  '(aucun paramètre)': '(no parameter)',
  'Chaque Training/Inference logue un run {graphe}/{nœud} automatiquement.': 'Every Training/Inference automatically logs a run {graph}/{node}.',

  // AppNode.tsx (carte de nœud sur le canvas du sandgraph)
  'Suivi live': 'Live tracking',
  "Ouvrir l'application": 'Open the application',
  'Mode FREE : ouvre Inference App pour choisir un fichier et un modèle': 'FREE mode: opens Inference App to choose a file and a model',
  'Mode FREE : utilise des outputs existants du workspace': 'FREE mode: uses existing outputs of the workspace',
  'Mode LOCKED : reçoit un modèle/flux → éval / inférence': 'LOCKED mode: receives a model/stream → eval / inference',
  'Mode LOCKED : exécute un nouveau pipeline': 'LOCKED mode: runs a new pipeline',
  'Étape échouée': 'Step failed',
  'HPO échoué — fallback Training activé': 'HPO failed — Training fallback active',
  'Déjà annoté ailleurs': 'Already annotated elsewhere',
  'Action requise': 'Action required',
  "Ordre d'exécution logique : étape": 'Logical execution order: step',
  'Subset': 'Subset',
  'Choisir un subset existant': 'Choose an existing subset',
  'projet': 'project',
  'Séquentiel': 'Sequential',
  'Auto IA': 'Auto AI',
  'Choisir une annotation existante': 'Choose an existing annotation',
  'Observateur · versionne / télécharge à la demande': 'Observer · version / download on demand',
  '→ ouvrir le node : hub récup + download + commit': '→ open the node: retrieve + download + commit hub',
  'À logger': 'To log',
  'Store (live)': 'Store (live)',
  'MLflow_App non lancée': 'MLflow_App not started',
  'aucun run encore': 'no run yet',
  'Superviseur · observe le store (pas de branchement)': 'Supervisor · observes the store (no connection)',
  'Session fichier manuelle': 'Manual file session',
  'image, vidéo ou dossier · YOLO / MOT / SOT clic': 'image, video or folder · YOLO / MOT / SOT click',
  'Manuel (app)': 'Manual (app)',
  'Détection (YOLO)': 'Detection (YOLO)',
  'YOLO pur': 'YOLO only',
  'best.pt amont': 'upstream best.pt',
  "SOT/MOT dans l'app": 'SOT/MOT in the app',
  'à définir (config)': 'to be defined (config)',
  'échec → paramètres Training': 'failure → Training parameters',
  'échec → arrêt pipeline': 'failure → pipeline stop',
  'trials': 'trials',
  '→ best params auto → Training aval': '→ auto best params → downstream Training',
  'Gate — ouvrir Optuna App, puis inscrire les best params': 'Gate — open Optuna App, then enter the best params',
  'params': 'params',
  'taille par défaut': 'default size',
  'Manuel — ouvrir Training App': 'Manual — open Training App',
  'Étape manuelle': 'Manual step',
  'par défaut': 'default',

  // DatasetNode.tsx
  'Non nommé': 'Unnamed',
  'Doublon de': 'Duplicate of',
  'créera un dataset séparé': 'will create a separate dataset',

  // ExperimentsPage.tsx — SANDGRAPH_TEMPLATES (name / description / tags)
  'Entraînement rapide': 'Quick training',
  'La chaîne la plus courte, sans éval ni HPO : Dataset → Dataset Explorer → Annotation auto → Training → DVC. MLflow supervise (isolé).':
    'The shortest chain, without eval or HPO: Dataset → Dataset Explorer → Auto annotation → Training → DVC. MLflow supervises (isolated).',
  'courant': 'common',
  'minimal': 'minimal',
  'Chaîne standard': 'Standard chain',
  'La chaîne recommandée, de la donnée au modèle versionné : Dataset → Dataset Explorer → Annotation auto → Training → Inference/Éval (retest mAP) → DVC. MLflow supervise automatiquement (nœud isolé, aucun branchement).':
    'The recommended chain, from data to versioned model: Dataset → Dataset Explorer → Auto annotation → Training → Inference/Eval (mAP retest) → DVC. MLflow supervises automatically (isolated node, no connection).',
  'recommandé': 'recommended',
  'complet': 'complete',
  'éval': 'eval',
  'Chaîne + HPO Optuna': 'Chain + Optuna HPO',
  'La chaîne standard avec optimisation d\'hyperparamètres : Dataset → Dataset Explorer → Annotation → Optuna (étude TPE, entraîne les trials) → best params → Training final → Inference/Éval → DVC. Un seul training « propre » en aval. MLflow supervise (isolé).':
    'The standard chain with hyperparameter optimization: Dataset → Dataset Explorer → Annotation → Optuna (TPE study, trains the trials) → best params → final Training → Inference/Eval → DVC. A single "clean" downstream training. MLflow supervises (isolated).',
  'HPO': 'HPO',
  'optuna': 'optuna',
  'Exploration dataset': 'Dataset exploration',
  'Brique isolée : Dataset → Dataset Explorer en mode manuel (scan + embeddings CLIP), puis création du subset à la main dans le Playground (gate humaine).':
    'Isolated block: Dataset → Dataset Explorer in manual mode (scan + CLIP embeddings), then manual subset creation in the Playground (human gate).',
  'exploration': 'exploration',
  '2 nœuds': '2 nodes',
  'manuel': 'manual',
  'Re-train depuis annotation existante': 'Re-train from existing annotation',
  'Annotation FREE (sélectionner un export YOLO existant) → Training → Inference/Éval → DVC. Ré-entraînement sans refaire la chaîne data (aucun Dataset Explorer requis).':
    'FREE Annotation (select an existing YOLO export) → Training → Inference/Eval → DVC. Re-training without redoing the data chain (no Dataset Explorer required).',
  'ré-entraînement': 're-training',
  'mode free': 'free mode',
  'Annotation depuis subset existant': 'Annotation from existing subset',
  'Mode FREE : Dataset Explorer expose un subset déjà créé → Annotation LOCKED → DVC. Aucun dataset ni scan requis.':
    'FREE mode: Dataset Explorer exposes an already created subset → LOCKED Annotation → DVC. No dataset or scan required.',
  'sans dataset': 'no dataset',
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
