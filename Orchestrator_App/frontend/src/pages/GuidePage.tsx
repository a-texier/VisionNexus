// ============================================================
// GuidePage.tsx — Guide MLOps générique (théorie + modèle mental).
// C'est la doc de référence que les apps DVC et MLflow ne répètent
// pas : elles y renvoient et se concentrent sur leur usage réel.
// ============================================================

import {
  BookOpen, GitCommit, Database, FlaskConical, Workflow,
  Upload, Download, RefreshCw, GitCompare, ArrowRight,
  BarChart3, Clock, GitFork, FolderTree, ListChecks,
} from 'lucide-react'

// Où vivent les objets versionnés, dans le workspace (ex. wk_lineage/orchestrator_bob).
const FILES = [
  { path: 'dvc_bob/repo/', what: 'Repo git + DVC : datasets/*.dvc, models/*.dvc (pointeurs), graphs/{id}.json (snapshot config), .dvc/cache (contenu dé-dupliqué), .dvc/config (remote).' },
  { path: 'mlflow_bob/mlflow_data/mlflow.db', what: 'Store MLflow SQLite (serverless, aucun serveur). Runs, params, métriques, tags de lineage.' },
  { path: 'insights/{graph}/{run}/', what: 'insights.json (lineage + reproductibilité) + plots. Généré à chaque run.' },
  { path: 'annotation_bob/exports/*-yolo.zip', what: 'Datasets YOLO exportés (ce qui est versionné dans DVC).' },
  { path: 'training_bob/runs/{run}/weights/best.pt', what: 'Modèles entraînés (versionnés dans DVC au commit).' },
]

const PREREQ = [
  'git et dvc installés (env conda IA_env) — l\'app initialise le repo au 1er commit.',
  'Un run complet depuis le Sandgraph : c\'est lui qui PRODUIT les artefacts (dataset, modèle) à versionner.',
  'Depuis le nœud DVC : sélectionner les artefacts et committer (ils reçoivent les trailers de lineage).',
  'Optionnel mais recommandé pour Push/Pull : un remote DVC (onglet Sync → « Ajouter le remote », un dossier local suffit).',
]

// Les 4 sous-onglets du groupe MLOps (ce que le Guide introduit).
const GROUP = [
  { icon: <BarChart3 size={15} className="text-indigo-400" />, name: 'Insights', desc: 'Résultats d\'un run : métriques, courbes, lineage cliquable (Git/DVC/MLflow) et checklist de reproductibilité.' },
  { icon: <Clock size={15} className="text-indigo-400" />, name: 'Activité', desc: 'Journal des runs : historique, statut, durée — le monitoring de ce qui a tourné.' },
  { icon: <GitFork size={15} className="text-indigo-400" />, name: 'Lineage', desc: 'Graphe interactif des expériences : datasets, runs, modèles et leurs forks, navigables vers l\'objet réel.' },
  { icon: <BookOpen size={15} className="text-indigo-400" />, name: 'Guide', desc: 'Cette page : le modèle mental Git/DVC/MLflow et quand utiliser quoi.' },
]

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3">
      <div className="flex items-center gap-2">
        {icon}
        <h2 className="text-sm font-semibold text-white">{title}</h2>
      </div>
      {children}
    </section>
  )
}

const TOOLS = [
  { tool: 'Git', color: 'text-indigo-300', q: 'Quel code / quelle configuration ?', ex: 'commit 41ef68b3 + snapshot du graphe' },
  { tool: 'DVC', color: 'text-emerald-300', q: 'Quelles données / quelle version ?', ex: 'dataset .dvc md5 6f652d0a (401 Mo, 201 fichiers)' },
  { tool: 'MLflow', color: 'text-purple-300', q: 'Quelle expérience / quel résultat ?', ex: 'run a34bafc5, mAP50=0.70, params, artifacts' },
  { tool: 'Orchestrator', color: 'text-amber-300', q: 'Comment tout est relié ?', ex: 'le Run Insight relie Run ↔ Git ↔ DVC ↔ MLflow' },
]

const ACTIONS = [
  { icon: <GitCommit size={15} className="text-indigo-400" />, name: 'Git commit', when: 'Automatique au commit DVC : fige le code + la config (snapshot du graphe) qui ont produit le run.' },
  { icon: <Database size={15} className="text-emerald-400" />, name: 'DVC (versionner)', when: 'Depuis le nœud DVC après un run : copie + suit le dataset / best.pt lourds, hors de git.' },
  { icon: <Upload size={15} className="text-blue-400" />, name: 'DVC Push', when: 'Envoyer le contenu versionné vers le remote, pour le récupérer sur une autre machine (VM GPU, collègue).' },
  { icon: <Download size={15} className="text-emerald-400" />, name: 'DVC Pull', when: 'Après un checkout d\'une version : rapatrier le contenu exact correspondant (reproduire un run).' },
  { icon: <RefreshCw size={15} className="text-indigo-400" />, name: 'Sync', when: 'La page Push + Pull DVC. Rien n\'est synchronisé sans clic ; sans remote configuré, l\'action est bloquée avec un message clair.' },
  { icon: <GitCompare size={15} className="text-amber-400" />, name: 'Version diff', when: 'Comparer deux versions d\'un dataset : combien d\'images ajoutées/supprimées, quelles annotations, quel run a utilisé la version.' },
  { icon: <FlaskConical size={15} className="text-purple-400" />, name: 'MLflow', when: 'Consulter/comparer les runs (params, métriques, artifacts) et remonter au code + données via les tags de lineage.' },
]

export default function GuidePage() {
  return (
    <div className="p-6 h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto space-y-5">
        <div className="flex items-center gap-3">
          <BookOpen size={22} className="text-indigo-400" />
          <h1 className="text-xl font-semibold text-white">Guide MLOps</h1>
          <span className="text-xs text-gray-500">monitoring + traçabilité de tes expériences</span>
        </div>

        {/* Introduction du groupe MLOps */}
        <Section title="L'onglet MLOps en bref" icon={<Workflow size={16} className="text-indigo-400" />}>
          <p className="text-[12px] text-gray-400">
            Cet onglet regroupe tout ce qui sert à <b className="text-gray-200">comprendre, comparer
            et reproduire</b> une expérience ML. Quatre sous-onglets :
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {GROUP.map(g => (
              <div key={g.name} className="flex items-start gap-2.5 bg-gray-950 border border-gray-800 rounded-lg px-3 py-2.5">
                <div className="mt-0.5 shrink-0">{g.icon}</div>
                <div className="text-[12px]">
                  <span className="text-gray-200 font-semibold">{g.name}</span>
                  <span className="text-gray-400"> — {g.desc}</span>
                </div>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-gray-500">
            Le reste de cette page explique le socle commun : <b>Git / DVC / MLflow</b>, comment ils
            se relient, et quand utiliser chaque action.
          </p>
        </Section>

        {/* Modèle mental */}
        <Section title="Le modèle mental" icon={<Workflow size={16} className="text-indigo-400" />}>
          <p className="text-[12px] text-gray-400">
            Trois outils répondent chacun à UNE question ; l'Orchestrator les relie. Chaque run
            devient traçable et reproductible.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-left">
                  <th className="py-2 pr-4 text-xs text-gray-500 uppercase">Outil</th>
                  <th className="py-2 pr-4 text-xs text-gray-500 uppercase">Question</th>
                  <th className="py-2 text-xs text-gray-500 uppercase">Exemple réel</th>
                </tr>
              </thead>
              <tbody>
                {TOOLS.map(t => (
                  <tr key={t.tool} className="border-t border-gray-800/60">
                    <td className={`py-2 pr-4 font-semibold ${t.color}`}>{t.tool}</td>
                    <td className="py-2 pr-4 text-gray-300">{t.q}</td>
                    <td className="py-2 text-gray-500 text-xs font-mono">{t.ex}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        {/* Lineage réel */}
        <Section title="Le lineage d'un run réel" icon={<GitCommit size={16} className="text-indigo-400" />}>
          <p className="text-[12px] text-gray-400">
            Exemple du projet (run <span className="font-mono">6c94d495</span>). Depuis un Run Insight,
            on navigue vers chaque objet réel :
          </p>
          <div className="bg-gray-950 border border-gray-800 rounded-lg p-4 text-[12px] font-mono text-gray-300 space-y-1.5">
            <p><span className="text-amber-300">Run 6c94d495</span> (Orchestrator)</p>
            <p className="pl-4 flex items-center gap-1.5"><ArrowRight size={12} className="text-gray-600" /><span className="text-indigo-300">Git commit 41ef68b3</span> — code + snapshot du graphe</p>
            <p className="pl-8 flex items-center gap-1.5"><ArrowRight size={12} className="text-gray-600" /><span className="text-emerald-300">DVC dataset 6f652d0a</span> — Annot_voiture_demo-yolo (201 fichiers)</p>
            <p className="pl-12 flex items-center gap-1.5"><ArrowRight size={12} className="text-gray-600" />Training (yolov8n, 6 epochs)</p>
            <p className="pl-16 flex items-center gap-1.5"><ArrowRight size={12} className="text-gray-600" /><span className="text-purple-300">MLflow run a34bafc5</span> — params + métriques</p>
            <p className="pl-20 flex items-center gap-1.5"><ArrowRight size={12} className="text-gray-600" /><span className="text-blue-300">mAP50 = 0.70</span></p>
            <p className="pl-24 flex items-center gap-1.5"><ArrowRight size={12} className="text-gray-600" />best.pt + artifacts (matrice de confusion, courbe PR…)</p>
          </div>
          <p className="text-[11px] text-gray-500">
            Ce lien est réel : le run MLflow porte le tag <span className="font-mono">orch_run_id</span>,
            le commit DVC porte des trailers <span className="font-mono">Run-Id / Dataset / MLflow-Run</span>,
            et le Run Insight expose une checklist de reproductibilité calculée sur l'état réel.
          </p>
        </Section>

        {/* Reproduire une experience, 0 CLI */}
        <Section title="Reproduire une expérience — sans ligne de commande" icon={<RefreshCw size={16} className="text-emerald-400" />}>
          <p className="text-[12px] text-gray-400">
            Tout se fait à la souris. Depuis un run (onglet <b>Insights</b>), le bloc
            <b> Lineage</b> te donne l'accès à chaque objet, et le bouton <b>Reproduce Run</b>
            déroule ces étapes :
          </p>
          <ol className="text-[12px] text-gray-300 space-y-1.5 list-decimal list-inside">
            <li><b>Restaurer la version des données</b> : app <span className="text-indigo-300">DVC → Historique</span>,
              bouton <span className="text-emerald-300">« Restaurer »</span> sur le commit du run
              (ramène le dataset + modèle exactement à cet état).</li>
            <li><b>Récupérer les fichiers</b> (si remote configuré) : app <span className="text-indigo-300">DVC → Sync</span>,
              bouton <span className="text-emerald-300">Pull</span>.</li>
            <li><b>Re-lancer à l'identique</b> : dans le Run Insight, bouton
              <span className="text-indigo-300"> « Fork this run »</span> (fige le même dataset +
              annotations), puis <span className="text-indigo-300">« Lancer »</span> dans le Sandgraph.</li>
            <li><b>Comparer</b> : depuis le graphe <span className="text-indigo-300">Lineage</span> ou
              MLflow, sélectionner deux runs → <span className="text-emerald-300">Compare</span>.</li>
          </ol>
          <p className="text-[11px] text-gray-500">
            La checklist <b>Reproducibility</b> du Run Insight indique, en vert/rouge, ce qui est
            réellement présent (code, dataset DVC, run MLflow, modèle, remote) — si un élément
            manque, il est nommé précisément plutôt qu'affiché « Reproducible » à tort.
          </p>
        </Section>

        {/* Quand / pourquoi chaque action */}
        <Section title="Quand et pourquoi utiliser chaque action" icon={<RefreshCw size={16} className="text-indigo-400" />}>
          <div className="space-y-2">
            {ACTIONS.map(a => (
              <div key={a.name} className="flex items-start gap-2.5 bg-gray-950 border border-gray-800 rounded-lg px-3 py-2.5">
                <div className="mt-0.5 shrink-0">{a.icon}</div>
                <div className="text-[12px]">
                  <span className="text-gray-200 font-semibold">{a.name}</span>
                  <span className="text-gray-400"> — {a.when}</span>
                </div>
              </div>
            ))}
          </div>
        </Section>

        {/* Prérequis */}
        <Section title="Prérequis" icon={<ListChecks size={16} className="text-indigo-400" />}>
          <ol className="text-[12px] text-gray-400 space-y-1.5 list-decimal list-inside">
            {PREREQ.map((p, i) => <li key={i}>{p}</li>)}
          </ol>
        </Section>

        {/* Fichiers : où vit quoi */}
        <Section title="Où vit quoi (fichiers du workspace)" icon={<FolderTree size={16} className="text-indigo-400" />}>
          <p className="text-[12px] text-gray-400">
            Tout est isolé par workspace/utilisateur sous <span className="font-mono">&lt;workspace&gt;/orchestrator_&lt;user&gt;/</span>.
            Rien n'écrase l'original : les datasets sont exportés puis versionnés.
          </p>
          <div className="space-y-1.5">
            {FILES.map(f => (
              <div key={f.path} className="bg-gray-950 border border-gray-800 rounded-lg px-3 py-2">
                <p className="text-[11px] font-mono text-emerald-300 break-all">{f.path}</p>
                <p className="text-[11px] text-gray-400 mt-0.5">{f.what}</p>
              </div>
            ))}
          </div>
        </Section>

        {/* Fonctionnement d'un run */}
        <Section title="Ce qui se passe pendant un run" icon={<Workflow size={16} className="text-indigo-400" />}>
          <ol className="text-[12px] text-gray-400 space-y-1.5 list-decimal list-inside">
            <li>Le pipeline produit un <b>dataset</b> (export YOLO) et un <b>modèle</b> (best.pt).</li>
            <li>Chaque run d'entraînement/éval ouvre un <b>run MLflow</b> tagué <span className="font-mono">orch_run_id</span> (lien exact).</li>
            <li>Au <b>commit DVC</b> (nœud DVC) : dataset + modèle + snapshot du graphe sont versionnés ; le message porte des <b>trailers</b> (Run-Id, Dataset, mAP50, MLflow-Run), et les runs MLflow reçoivent en retour <span className="font-mono">git_commit</span> / <span className="font-mono">dataset_version</span>.</li>
            <li>Les <b>Insights</b> assemblent le lineage réel et la checklist de reproductibilité.</li>
          </ol>
        </Section>

        <p className="text-[11px] text-gray-600">
          Doc applicative détaillée : ouvrez la page « Doc » dans l'app DVC et l'app MLflow
          (bouton « Ouvrir » depuis Applications, ou le nœud correspondant du Sandgraph).
        </p>
      </div>
    </div>
  )
}
