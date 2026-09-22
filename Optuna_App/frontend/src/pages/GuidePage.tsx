import { AlertTriangle, ArrowRight, CheckCircle2, Cpu, Database, Gauge, GitFork, SlidersHorizontal } from 'lucide-react'
import { useT } from '../i18n/useLang'

const vocabulary = [
  ['Étude', 'Campagne définie par une métrique, une direction, un sampler, un espace de recherche et un stockage.'],
  ['Attempt', 'Exécution immuable d’un nœud HPO pour un run Orchestrator précis. Relancer crée un nouvel attempt.'],
  ['Trial', 'Une combinaison d’hyperparamètres et une exécution de la fonction objectif.'],
  ['Objectif', 'Valeur numérique utilisée pour classer les trials, généralement mAP50 ou mAP50-95.'],
  ['Best params', 'Paramètres du meilleur trial COMPLETE. Ce ne sont ni des poids, ni un modèle.'],
  ['Artefacts', 'result.json, results.csv, logs, configuration et poids produits par le trial.'],
]

const states = [
  ['WAITING', 'Planifié, pas encore exécuté.', 'text-gray-300'],
  ['RUNNING', 'Processus actif dans cette instance de l’application.', 'text-blue-300'],
  ['COMPLETE', 'Résultat JSON valide et objectif numérique enregistré.', 'text-emerald-300'],
  ['FAIL', 'Erreur technique ou contrat de résultat invalide.', 'text-red-300'],
  ['PRUNED', 'Arrêt algorithmique avec métrique intermédiaire et décision du pruner.', 'text-violet-300'],
  ['INTERRUPTED', 'Processus disparu ou application arrêtée ; ce n’est ni un résultat ni un pruning.', 'text-amber-300'],
  ['LEGACY_PRUNED_UNKNOWN', 'Ancien PRUNED sans valeur intermédiaire : la cause réelle est indéterminée.', 'text-orange-300'],
]

const failures = [
  ['Dataset introuvable', 'data.yaml ou images/labels incorrects', 'Contrôler le YAML absolu et les dossiers réels.'],
  ['Mémoire GPU', 'CUDA out of memory', 'Réduire batch/imgsz ou libérer la VRAM.'],
  ['Modèle absent', 'Poids .pth ou taille de modèle YOLOX introuvable', 'Corriger le modèle et le cache.'],
  ['Timeout', 'Training bloqué ou trop long', 'Vérifier results.csv avant d’augmenter le délai.'],
  ['Résultat invalide', 'result.json absent ou non numérique', 'Consulter stdout.log, stderr.log et result.json.'],
  ['Interruption', 'PID disparu après redémarrage', 'Conserver les artefacts partiels puis créer un nouvel attempt.'],
]

const artifactTree: Array<[string, string]> = [
  ['hpo_runs/<study>/trial_0002/', ''],
  ['  result.json', 'objectif + métriques + chemins'],
  ['  stdout.log', 'sortie UTF-8 normalisée'],
  ['  stderr.log', 'erreur UTF-8 normalisée'],
  ['  results.csv', 'métriques par epoch'],
  ['  best_ckpt.pth', 'meilleur poids du trial (si mAP > 0)'],
  ['  last_epoch_ckpt.pth', 'poids de la dernière epoch (toujours écrit)'],
]

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="rounded-xl border border-gray-800 bg-gray-900 p-4"><h2 className="text-sm font-semibold text-white mb-3">{title}</h2>{children}</section>
}

export default function GuidePage() {
  const t = useT()
  const overview: Array<[typeof Database, string, string]> = [
    [Database, 'Dataset', 'Le même snapshot YOLO est utilisé dans un attempt.'],
    [SlidersHorizontal, 'Sampler', 'Propose les paramètres ; TPE commence par une phase startup.'],
    [Cpu, 'Trial YOLO', 'Produit un résultat et des artefacts indépendants.'],
    [Gauge, 'Sélection', 'Seuls les COMPLETE participent au best trial.'],
  ]
  const artifactTreeText = artifactTree.map(([path, desc]) => desc ? `${path.padEnd(24)}${t(desc)}` : path).join('\n')
  return <div className="p-6 space-y-5 max-w-6xl">
    <div><h1 className="text-xl font-semibold text-white">{t('Optuna HPO — guide de référence')}</h1><p className="text-sm text-gray-500 mt-1">{t('Fonctionnement réel, états, métriques, reprise, artefacts et relation avec Orchestrator.')}</p></div>
    <div className="grid gap-3 md:grid-cols-4">
      {overview.map(([Icon,title,text],i) => { const I=Icon as typeof Database; return <div key={String(title)} className="rounded-xl border border-gray-800 bg-gray-900 p-4"><div className="flex items-center gap-2 text-indigo-300"><I size={16}/><b className="text-sm">{i+1}. {t(String(title))}</b></div><p className="text-xs text-gray-400 mt-2 leading-relaxed">{t(String(text))}</p></div> })}
    </div>
    <Section title={t('Vocabulaire')}><div className="grid gap-2 md:grid-cols-2">{vocabulary.map(([name,desc]) => <div key={name} className="rounded-lg bg-gray-800 p-3 text-xs"><b className="text-cyan-300">{t(name)}</b><p className="text-gray-400 mt-1 leading-relaxed">{t(desc)}</p></div>)}</div></Section>
    <Section title={t('Sampler TPE : startup puis apprentissage adaptatif')}><div className="space-y-2 text-xs text-gray-400 leading-relaxed"><p>{t('TPESampler ne comprend pas les bons paramètres dès le premier trial. Par défaut, les dix premiers résultats exploitables forment la phase')} <b className="text-amber-300">startup</b>{t('. Avant ce seuil, l’étude explore.')}</p><p>{t('Après suffisamment de COMPLETE, TPE modélise les régions prometteuses. FAIL, interruptions et anciens PRUNED sans valeur n’alimentent pas cet apprentissage. La page affiche la phase et le nombre réel de décisions adaptatives.')}</p></div></Section>
    <Section title={t('Construire une étude interprétable')}><div className="grid gap-3 md:grid-cols-2 text-xs text-gray-400 leading-relaxed"><div><b className="text-white">{t('Espace de recherche')}</b><p>{t('Float définit un intervalle continu ; float logarithmique convient aux ordres de grandeur comme basic_lr_per_img ; int choisit un entier ; categorical choisit une valeur fermée. Des bornes trop larges gaspillent le budget et peuvent produire des configurations invalides.')}</p></div><div><b className="text-white">{t('Direction')}</b><p>{t('Maximize convient à mAP, précision et rappel. Minimize convient à une loss ou une latence. Changer la direction change le best trial sans changer les mesures.')}</p></div><div><b className="text-white">{t('Budget')}</b><p>{t('Le nombre de trials, les epochs par trial, imgsz, batch et la taille de modèle déterminent le coût. Cinq trials avec un startup TPE de dix restent une exploration initiale.')}</p></div><div><b className="text-white">{t('Reproductibilité')}</b><p>{t('Conserver seed, versions Python/Optuna/YOLOX/PyTorch/CUDA, modèle initial, dataset exact et split. Sans ces éléments, une relance comparable n’est pas nécessairement reproductible.')}</p></div></div></Section>
    <Section title={t('Pruning : condition nécessaire et état actuel')}><div className="rounded-lg border border-amber-800/40 bg-amber-950/20 p-3 text-xs text-gray-300"><p className="font-semibold text-amber-300">{t('Le pruning automatique est désactivé dans le moteur YOLO actuel.')}</p><p className="mt-1">{t('Un vrai pruner exige une métrique par epoch, trial.report(value, step), puis trial.should_prune(). Tant que ce flux n’existe pas, activer MedianPruner serait décoratif. Crash dataset, erreur CUDA et arrêt utilisateur ne sont jamais des prunings.')}</p></div></Section>
    <Section title={t('États d’un trial')}><div className="divide-y divide-gray-800">{states.map(([name,desc,color]) => <div key={name} className="grid gap-1 py-2 md:grid-cols-[210px_1fr] text-xs"><b className={color}>{name}</b><span className="text-gray-400">{t(desc)}</span></div>)}</div></Section>
    <Section title={t('Métriques YOLO')}><div className="grid gap-3 md:grid-cols-2 text-xs text-gray-400 leading-relaxed"><div><b className="text-white">mAP50</b><p>{t('Average Precision à IoU=0,50, plus tolérante.')}</p></div><div><b className="text-white">mAP50-95</b><p>{t('Moyenne de 0,50 à 0,95, plus exigeante sur la localisation.')}</p></div><div><b className="text-white">{t('Précision / rappel')}</b><p>{t('La précision pénalise les faux positifs ; le rappel les objets manqués.')}</p></div><div><b className="text-white">{t('Objectif vs secondaire')}</b><p>{t('Si l’objectif est mAP50, mAP50-95 ne départage pas officiellement deux mAP50 égales.')}</p></div><div className="md:col-span-2"><b className="text-white">{t('Trial court vs Training final')}</b><p>{t('Le meilleur jeu doit être réentraîné avec le split, le seed et le budget final documentés.')}</p></div></div></Section>
    <Section title={t('Best value, best params et absence de gagnant')}><div className="space-y-2 text-xs text-gray-400 leading-relaxed"><p><b className="text-white">best_value</b> {t('est la valeur objectif du meilleur trial COMPLETE.')} <b className="text-white">best_params</b> {t('ne contient que les paramètres suggérés dans ce trial : ni best_ckpt.pth, ni les paramètres fixes, ni les métriques secondaires.')}</p><p>{t('Zéro COMPLETE signifie qu’Optuna ne peut sélectionner aucun gagnant officiel. Il faut alors distinguer : aucun trial lancé, erreurs techniques, vrais prunings, interruption, ou trainings terminés dont le résultat n’a pas été transporté. Les métriques récupérées depuis results.csv restent informatives et ne modifient pas la DB.')}</p></div></Section>
    <Section title={t('Contrat de résultat et artefacts')}><div className="space-y-2 text-xs text-gray-400 leading-relaxed"><p>{t('Chaque trial écrit atomiquement result.json. Stdout n’est plus la source de vérité, ce qui évite les pertes dues à l’encodage Windows.')}</p><pre className="overflow-x-auto rounded-lg bg-gray-950 p-3 text-[11px] text-cyan-200">{artifactTreeText}</pre><p>{t('L’interface distingue état Optuna, processus et artefacts. Un ancien FAIL récupérable n’est jamais transformé silencieusement en COMPLETE.')}</p></div></Section>
    <Section title={t('Runs, forks et reprise')}><div className="flex gap-3 text-xs text-gray-400 leading-relaxed"><GitFork size={18} className="text-indigo-300 shrink-0"/><div><p>{t('Une étude Orchestrator est identifiée par graph_id / run_id / node_id / attempt_id. Un fork reprend la configuration et ses entrées déclarées, jamais les productions du parent.')}</p><p className="mt-2">{t('Relancer crée un nouvel attempt. Une future reprise devra être explicite et ne jamais fusionner silencieusement deux runs.')}</p></div></div></Section>
    <Section title={t('Reprise, comparaison et lineage')}><div className="space-y-2 text-xs text-gray-400 leading-relaxed"><p>{t('Reprendre la même étude ajoute des trials et permet au sampler de réutiliser son historique. Cela n’est valide que si objectif, direction, dataset et distributions restent compatibles. Une nouvelle tentative indépendante doit créer un nouvel attempt.')}</p><p>{t('Comparer des attempts exige d’afficher leur dataset, budget, seed et version logicielle. Un fork Orchestrator doit pointer vers son propre run_id ; le nom humain seul ne constitue pas une identité de lineage.')}</p><p>{t('La suppression d’une étude efface son index Optuna mais ne doit jamais supprimer implicitement les artefacts d’un autre run.')}</p></div></Section>
    <Section title={t('Méthode de diagnostic')}><ol className="list-decimal pl-5 space-y-2 text-xs text-gray-400 leading-relaxed"><li>{t('Lire le verdict global et séparer état Optuna, état du processus et présence d’artefacts.')}</li><li>{t('Ouvrir la cause racine agrégée : une panne commune à cinq trials ne doit être corrigée qu’une fois.')}</li><li>{t('Vérifier data.yaml, dataset réel, modèle, GPU et code retour avant les hyperparamètres.')}</li><li>{t('Contrôler result.json puis stdout.log/stderr.log ; pour l’historique, comparer results.csv et best_ckpt.pth.')}</li><li>{t('Relancer un nouvel attempt seulement après correction et conserver l’ancien comme preuve auditable.')}</li></ol></Section>
    <Section title={t('Quand le pipeline continue-t-il ?')}><div className="grid gap-3 md:grid-cols-2"><div className="rounded-lg border border-emerald-800/40 bg-emerald-950/20 p-3"><p className="flex items-center gap-2 text-emerald-300 font-semibold text-sm"><CheckCircle2 size={15}/> {t('Au moins un COMPLETE')}</p><p className="text-xs text-gray-400 mt-1">{t('Optuna fournit best_params au Training final.')}</p></div><div className="rounded-lg border border-red-800/40 bg-red-950/20 p-3"><p className="flex items-center gap-2 text-red-300 font-semibold text-sm"><AlertTriangle size={15}/> {t('Zéro COMPLETE')}</p><p className="text-xs text-gray-400 mt-1">{t('Le pipeline s’arrête ou continue explicitement avec les paramètres configurés/défauts et un warning.')}</p></div></div></Section>
    <div className="rounded-xl border border-gray-800 bg-gray-900 overflow-hidden"><div className="px-4 py-3 border-b border-gray-800"><h2 className="text-sm font-semibold text-white">{t('Diagnostic des causes courantes')}</h2></div><div className="divide-y divide-gray-800">{failures.map(([title,cause,action]) => <div key={title} className="grid gap-2 px-4 py-3 md:grid-cols-[180px_1fr_1fr] text-xs"><b className="text-red-300">{t(title)}</b><span className="text-gray-400">{t('Cause :')} {t(cause)}</span><span className="text-emerald-300 flex gap-1"><ArrowRight size={13} className="shrink-0"/>{t(action)}</span></div>)}</div></div>
  </div>
}
