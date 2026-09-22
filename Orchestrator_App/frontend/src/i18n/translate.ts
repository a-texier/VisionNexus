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
