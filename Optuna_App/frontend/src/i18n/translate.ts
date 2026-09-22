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

  // GuidePage.tsx
  'Optuna HPO — guide de référence': 'Optuna HPO - reference guide',
  'Fonctionnement réel, états, métriques, reprise, artefacts et relation avec Orchestrator.': 'How it actually works: states, metrics, resume, artifacts, and the relationship with Orchestrator.',
  'Vocabulaire': 'Vocabulary',
  'Sampler TPE : startup puis apprentissage adaptatif': 'TPE sampler: startup then adaptive learning',
  'TPESampler ne comprend pas les bons paramètres dès le premier trial. Par défaut, les dix premiers résultats exploitables forment la phase': 'TPESampler does not know the right parameters from the very first trial. By default, the first ten usable results form the',
  '. Avant ce seuil, l’étude explore.': '. Before that threshold, the study is exploring.',
  'Après suffisamment de COMPLETE, TPE modélise les régions prometteuses. FAIL, interruptions et anciens PRUNED sans valeur n’alimentent pas cet apprentissage. La page affiche la phase et le nombre réel de décisions adaptatives.': 'Once there are enough COMPLETE trials, TPE models the promising regions. FAIL, interruptions and old valueless PRUNED trials do not feed this learning. The page shows the phase and the real number of adaptive decisions.',
  'Construire une étude interprétable': 'Building an interpretable study',
  'Espace de recherche': 'Search space',
  'Float définit un intervalle continu ; float logarithmique convient aux ordres de grandeur comme basic_lr_per_img ; int choisit un entier ; categorical choisit une valeur fermée. Des bornes trop larges gaspillent le budget et peuvent produire des configurations invalides.': 'Float defines a continuous interval; logarithmic float suits orders of magnitude such as basic_lr_per_img; int picks an integer; categorical picks a closed value. Bounds that are too wide waste the budget and can produce invalid configurations.',
  'Maximize convient à mAP, précision et rappel. Minimize convient à une loss ou une latence. Changer la direction change le best trial sans changer les mesures.': 'Maximize suits mAP, precision and recall. Minimize suits a loss or a latency. Changing the direction changes the best trial without changing the measurements.',
  'Le nombre de trials, les epochs par trial, imgsz, batch et la taille de modèle déterminent le coût. Cinq trials avec un startup TPE de dix restent une exploration initiale.': 'The number of trials, the epochs per trial, imgsz, batch and model size determine the cost. Five trials with a TPE startup of ten remain an initial exploration.',
  'Reproductibilité': 'Reproducibility',
  'Conserver seed, versions Python/Optuna/YOLOX/PyTorch/CUDA, modèle initial, dataset exact et split. Sans ces éléments, une relance comparable n’est pas nécessairement reproductible.': 'Keep the seed, the Python/Optuna/YOLOX/PyTorch/CUDA versions, the initial model, the exact dataset and split. Without these, a comparable rerun is not necessarily reproducible.',
  'Pruning : condition nécessaire et état actuel': 'Pruning: necessary condition and current state',
  'Le pruning automatique est désactivé dans le moteur YOLO actuel.': 'Automatic pruning is disabled in the current YOLO engine.',
  'Un vrai pruner exige une métrique par epoch, trial.report(value, step), puis trial.should_prune(). Tant que ce flux n’existe pas, activer MedianPruner serait décoratif. Crash dataset, erreur CUDA et arrêt utilisateur ne sont jamais des prunings.': 'A real pruner needs a per-epoch metric, trial.report(value, step), then trial.should_prune(). Until that flow exists, enabling MedianPruner would be purely cosmetic. A dataset crash, a CUDA error and a user stop are never prunings.',
  'États d’un trial': 'Trial states',
  'Métriques YOLO': 'YOLO metrics',
  'Average Precision à IoU=0,50, plus tolérante.': 'Average Precision at IoU=0.50, more tolerant.',
  'Moyenne de 0,50 à 0,95, plus exigeante sur la localisation.': 'Average from 0.50 to 0.95, stricter on localization.',
  'Précision / rappel': 'Precision / recall',
  'La précision pénalise les faux positifs ; le rappel les objets manqués.': 'Precision penalizes false positives; recall penalizes missed objects.',
  'Objectif vs secondaire': 'Objective vs secondary',
  'Si l’objectif est mAP50, mAP50-95 ne départage pas officiellement deux mAP50 égales.': 'If the objective is mAP50, mAP50-95 does not officially break a tie between two equal mAP50 values.',
  'Trial court vs Training final': 'Short trial vs final Training',
  'Le meilleur jeu doit être réentraîné avec le split, le seed et le budget final documentés.': 'The best set must be retrained with the split, seed and final budget documented.',
  'Best value, best params et absence de gagnant': 'Best value, best params, and no winner',
  'est la valeur objectif du meilleur trial COMPLETE.': 'is the objective value of the best COMPLETE trial.',
  'ne contient que les paramètres suggérés dans ce trial : ni best_ckpt.pth, ni les paramètres fixes, ni les métriques secondaires.': 'contains only the parameters suggested in that trial: not best_ckpt.pth, not the fixed parameters, not the secondary metrics.',
  'Zéro COMPLETE signifie qu’Optuna ne peut sélectionner aucun gagnant officiel. Il faut alors distinguer : aucun trial lancé, erreurs techniques, vrais prunings, interruption, ou trainings terminés dont le résultat n’a pas été transporté. Les métriques récupérées depuis results.csv restent informatives et ne modifient pas la DB.': 'Zero COMPLETE means Optuna cannot select any official winner. You then need to distinguish between: no trial launched, technical errors, real prunings, interruption, or finished trainings whose result was not carried over. Metrics recovered from results.csv remain informative and do not modify the DB.',
  'Contrat de résultat et artefacts': 'Result contract and artifacts',
  'Chaque trial écrit atomiquement result.json. Stdout n’est plus la source de vérité, ce qui évite les pertes dues à l’encodage Windows.': 'Each trial writes result.json atomically. Stdout is no longer the source of truth, which avoids losses caused by Windows encoding.',
  'L’interface distingue état Optuna, processus et artefacts. Un ancien FAIL récupérable n’est jamais transformé silencieusement en COMPLETE.': 'The interface distinguishes the Optuna state, the process and the artifacts. An old recoverable FAIL is never silently turned into COMPLETE.',
  'Runs, forks et reprise': 'Runs, forks, and resume',
  'Une étude Orchestrator est identifiée par graph_id / run_id / node_id / attempt_id. Un fork reprend la configuration et ses entrées déclarées, jamais les productions du parent.': "An Orchestrator study is identified by graph_id / run_id / node_id / attempt_id. A fork resumes the configuration and its declared inputs, never the parent's outputs.",
  'Relancer crée un nouvel attempt. Une future reprise devra être explicite et ne jamais fusionner silencieusement deux runs.': 'Relaunching creates a new attempt. A future resume feature must be explicit and must never silently merge two runs.',
  'Reprise, comparaison et lineage': 'Resume, comparison, and lineage',
  'Reprendre la même étude ajoute des trials et permet au sampler de réutiliser son historique. Cela n’est valide que si objectif, direction, dataset et distributions restent compatibles. Une nouvelle tentative indépendante doit créer un nouvel attempt.': 'Resuming the same study adds trials and lets the sampler reuse its history. This is only valid if the objective, direction, dataset and distributions remain compatible. A new independent attempt must create a new attempt.',
  'Comparer des attempts exige d’afficher leur dataset, budget, seed et version logicielle. Un fork Orchestrator doit pointer vers son propre run_id ; le nom humain seul ne constitue pas une identité de lineage.': 'Comparing attempts requires showing their dataset, budget, seed and software version. An Orchestrator fork must point to its own run_id; the human name alone is not a lineage identity.',
  'La suppression d’une étude efface son index Optuna mais ne doit jamais supprimer implicitement les artefacts d’un autre run.': "Deleting a study erases its Optuna index but must never implicitly delete another run's artifacts.",
  'Méthode de diagnostic': 'Diagnostic method',
  'Lire le verdict global et séparer état Optuna, état du processus et présence d’artefacts.': 'Read the overall verdict and separate the Optuna state, the process state and the presence of artifacts.',
  'Ouvrir la cause racine agrégée : une panne commune à cinq trials ne doit être corrigée qu’une fois.': 'Open the aggregated root cause: a failure shared by five trials should only be fixed once.',
  'Vérifier data.yaml, dataset réel, modèle, GPU et code retour avant les hyperparamètres.': 'Check data.yaml, the actual dataset, model, GPU and return code before the hyperparameters.',
  'Contrôler result.json puis stdout.log/stderr.log ; pour l’historique, comparer results.csv et best_ckpt.pth.': 'Check result.json then stdout.log/stderr.log; for history, compare results.csv and best_ckpt.pth.',
  'Relancer un nouvel attempt seulement après correction et conserver l’ancien comme preuve auditable.': 'Relaunch a new attempt only after fixing the issue, and keep the old one as auditable evidence.',
  'Quand le pipeline continue-t-il ?': 'When does the pipeline continue?',
  'Au moins un COMPLETE': 'At least one COMPLETE',
  'Optuna fournit best_params au Training final.': 'Optuna provides best_params to the final Training.',
  'Zéro COMPLETE': 'Zero COMPLETE',
  'Le pipeline s’arrête ou continue explicitement avec les paramètres configurés/défauts et un warning.': 'The pipeline stops, or explicitly continues with the configured/default parameters and a warning.',
  'Diagnostic des causes courantes': 'Diagnosis of common causes',
  'Cause :': 'Cause:',
  'Sélection': 'Selection',
  'Le même snapshot YOLO est utilisé dans un attempt.': 'The same YOLO snapshot is used within an attempt.',
  'Propose les paramètres ; TPE commence par une phase startup.': 'Proposes the parameters; TPE starts with a startup phase.',
  'Produit un résultat et des artefacts indépendants.': 'Produces an independent result and artifacts.',
  'Seuls les COMPLETE participent au best trial.': 'Only COMPLETE trials count toward the best trial.',
  'Étude': 'Study',
  'Objectif': 'Objective',
  'Artefacts': 'Artifacts',
  'Campagne définie par une métrique, une direction, un sampler, un espace de recherche et un stockage.': 'A campaign defined by a metric, a direction, a sampler, a search space and a storage backend.',
  'Exécution immuable d’un nœud HPO pour un run Orchestrator précis. Relancer crée un nouvel attempt.': 'Immutable execution of an HPO node for one specific Orchestrator run. Relaunching creates a new attempt.',
  'Une combinaison d’hyperparamètres et une exécution de la fonction objectif.': 'A combination of hyperparameters and one execution of the objective function.',
  'Valeur numérique utilisée pour classer les trials, généralement mAP50 ou mAP50-95.': 'The numeric value used to rank trials, typically mAP50 or mAP50-95.',
  'Paramètres du meilleur trial COMPLETE. Ce ne sont ni des poids, ni un modèle.': 'Parameters of the best COMPLETE trial. Not weights, and not a model.',
  'result.json, results.csv, logs, configuration et poids produits par le trial.': 'result.json, results.csv, logs, configuration and weights produced by the trial.',
  'Planifié, pas encore exécuté.': 'Scheduled, not yet run.',
  'Processus actif dans cette instance de l’application.': 'Active process in this instance of the application.',
  'Résultat JSON valide et objectif numérique enregistré.': 'Valid JSON result and numeric objective recorded.',
  'Erreur technique ou contrat de résultat invalide.': 'Technical error or invalid result contract.',
  'Arrêt algorithmique avec métrique intermédiaire et décision du pruner.': "Algorithmic stop with an intermediate metric and the pruner's decision.",
  'Processus disparu ou application arrêtée ; ce n’est ni un résultat ni un pruning.': 'Process gone missing or application stopped; neither a result nor a pruning.',
  'Ancien PRUNED sans valeur intermédiaire : la cause réelle est indéterminée.': 'Old PRUNED without an intermediate value: the real cause is undetermined.',
  'Dataset introuvable': 'Dataset not found',
  'data.yaml ou images/labels incorrects': 'data.yaml or images/labels incorrect',
  'Contrôler le YAML absolu et les dossiers réels.': 'Check the absolute YAML path and the actual folders.',
  'Mémoire GPU': 'GPU memory',
  'Réduire batch/imgsz ou libérer la VRAM.': 'Reduce batch/imgsz or free up VRAM.',
  'Modèle absent': 'Model missing',
  'Poids .pth ou taille de modèle YOLOX introuvable': '.pth weights or YOLOX model size not found',
  'Corriger le modèle et le cache.': 'Fix the model and the cache.',
  'Training bloqué ou trop long': 'Training stuck or taking too long',
  'Vérifier results.csv avant d’augmenter le délai.': 'Check results.csv before increasing the timeout.',
  'Résultat invalide': 'Invalid result',
  'result.json absent ou non numérique': 'result.json missing or not numeric',
  'Consulter stdout.log, stderr.log et result.json.': 'Check stdout.log, stderr.log and result.json.',
  'PID disparu après redémarrage': 'PID gone after restart',
  'Conserver les artefacts partiels puis créer un nouvel attempt.': 'Keep the partial artifacts then create a new attempt.',
  'objectif + métriques + chemins': 'objective + metrics + paths',
  'sortie UTF-8 normalisée': 'normalized UTF-8 output',
  'erreur UTF-8 normalisée': 'normalized UTF-8 error output',
  'métriques par epoch': 'metrics per epoch',
  'meilleur poids du trial (si mAP > 0)': 'best weights of the trial (if mAP > 0)',
  'poids de la dernière epoch (toujours écrit)': 'weights of the last epoch (always written)',

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
