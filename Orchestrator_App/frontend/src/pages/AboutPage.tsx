// ============================================================
// AboutPage.tsx
// Présentation de la plateforme MLOps Computer Vision.
// ============================================================

import { useState } from 'react'
import { ExternalLink, GitBranch, Eye, Tag, Database, FlaskConical, TrendingUp, Settings, Layers, Cpu, ArrowRight, CheckCircle2, ChevronDown, ChevronUp } from 'lucide-react'

// ── Collapsible section ───────────────────────────────────────────────────────

function Section({ title, children, defaultOpen = true }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border border-gray-800 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-3.5 bg-gray-900/70 hover:bg-gray-800/60 transition-colors text-left"
      >
        <span className="text-base font-semibold text-white">{title}</span>
        {open ? <ChevronUp size={16} className="text-gray-500 shrink-0" /> : <ChevronDown size={16} className="text-gray-500 shrink-0" />}
      </button>
      {open && (
        <div className="bg-gray-900/30 px-5 py-5">
          {children}
        </div>
      )}
    </div>
  )
}

// ── App cards ─────────────────────────────────────────────────────────────────

interface AppInfo {
  name: string
  icon: React.ReactNode
  color: string
  port: string
  description: string
  features: string[]
  url: string
}

const APPS: AppInfo[] = [
  {
    name: 'Dataset Explorer',
    icon: <Eye size={22} />,
    color: 'from-violet-600 to-purple-700',
    port: '5174',
    description: 'Exploration et gestion de datasets images. Embedding CLIP, carte UMAP interactive, subsets sémantiques.',
    features: ['Embedding CLIP ViT-B-32', 'Carte UMAP / t-SNE / PCA', 'Recherche sémantique texte→image', 'Déduplication automatique', 'Subsets + export annotation'],
    url: 'http://localhost:5174',
  },
  {
    name: 'Annotation App',
    icon: <Tag size={22} />,
    color: 'from-rose-600 to-pink-700',
    port: '5173',
    description: 'Annotation d\'images et vidéos. SAM2 interactif, ByteTrack, propagation par homographie.',
    features: ['SAM2 point/texte interactif', 'Grounding DINO zero-shot', 'ByteTrack vidéo', 'Export YOLO bbox/polygon', 'Undo/redo + raccourcis'],
    url: 'http://localhost:5173',
  },
  {
    name: 'DVC App',
    icon: <GitBranch size={22} />,
    color: 'from-amber-600 to-orange-700',
    port: '3002',
    description: 'Versionnage des datasets avec DVC + Git. Historique des commits, diff entre versions.',
    features: ['Git + DVC intégrés', 'Historique des versions', 'Diff entre commits', 'Push / Pull remote', 'Checkout de versions'],
    url: 'http://localhost:3002',
  },
  {
    name: 'MLflow App',
    icon: <TrendingUp size={22} />,
    color: 'from-emerald-600 to-teal-700',
    port: '3001',
    description: 'Suivi des expériences ML. Paramètres, métriques, modèles enregistrés, comparaison de runs.',
    features: ['Suivi runs YOLO/custom', 'Comparaison multi-runs', 'Registry modèles', 'Promotion staging/production', 'Charts métriques'],
    url: 'http://localhost:3001',
  },
  {
    name: 'Optuna App',
    icon: <Settings size={22} />,
    color: 'from-cyan-600 to-blue-700',
    port: '3003',
    description: 'Optimisation des hyperparamètres. Études Optuna, visualisation des essais, meilleurs paramètres.',
    features: ['Études Bayésiennes', 'TPE / CMA-ES / Grid', 'Visualisation trials', 'Export meilleurs params', 'Intégration MLflow'],
    url: 'http://localhost:3003',
  },
  {
    name: 'Orchestrateur',
    icon: <Layers size={22} />,
    color: 'from-indigo-600 to-violet-700',
    port: '3000',
    description: 'Coordonne toutes les apps dans des pipelines DAG avec human-in-the-loop et suivi d\'expériences.',
    features: ['Pipelines DAG visuels', 'Human gates ⏸', 'Suivi expériences', 'Bibliothèque de templates', 'Monitoring santé'],
    url: 'http://localhost:3000',
  },
]

// ── Workflow step ─────────────────────────────────────────────────────────────

const WORKFLOW_STEPS = [
  { id: '01', label: 'Charger dataset',        app: 'Dataset Explorer',     type: 'auto',  desc: 'Scan + thumbnails' },
  { id: '02', label: 'Embedding CLIP',          app: 'Dataset Explorer',     type: 'auto',  desc: 'UMAP + clustering' },
  { id: '03', label: 'Valider embedding',       app: 'Dataset Explorer',     type: 'human', desc: 'Vérifier la carte' },
  { id: '04', label: 'Créer subset sémantique', app: 'Dataset Explorer',     type: 'auto',  desc: 'Requête texte→images' },
  { id: '05', label: 'Valider subset',          app: 'Dataset Explorer',     type: 'human', desc: 'Confirmer la sélection' },
  { id: '06', label: 'Exporter vers Annotation',app: 'Dataset Explorer',     type: 'auto',  desc: 'Symlinks/copies' },
  { id: '07', label: 'Créer projet annotation', app: 'Annotation',   type: 'auto',  desc: 'Import + classes' },
  { id: '08', label: 'Annoter les images',      app: 'Annotation',   type: 'human', desc: 'SAM2 + manuel' },
  { id: '09', label: 'Export YOLO',             app: 'Annotation',   type: 'auto',  desc: 'train/val split' },
  { id: '10', label: 'Commit DVC',              app: 'DVC',          type: 'auto',  desc: 'Versionner le dataset' },
  { id: '11', label: 'Training YOLO',           app: 'MLflow',       type: 'human', desc: 'Lancer manuellement' },
  { id: '12', label: 'Optimisation HPO',        app: 'Optuna',       type: 'human', desc: 'Bayesian search' },
  { id: '13', label: 'Valider les perfs',       app: 'MLflow',       type: 'human', desc: 'Métriques finales' },
]

const APP_COLOR: Record<string, string> = {
  'Dataset Explorer':   'bg-violet-500/20 text-violet-300 border-violet-500/30',
  'Annotation': 'bg-rose-500/20 text-rose-300 border-rose-500/30',
  'DVC':        'bg-amber-500/20 text-amber-300 border-amber-500/30',
  'MLflow':     'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  'Optuna':     'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
}

// ── Component ────────────────────────────────────────────────────────────────

export default function AboutPage() {
  return (
    <div className="p-6 space-y-4 max-w-6xl mx-auto overflow-y-auto h-full">

      {/* Hero */}
      <div className="rounded-2xl border border-indigo-500/20 bg-gradient-to-br from-indigo-900/30 to-purple-900/20 p-8">
        <div className="flex items-start gap-4">
          <div className="p-3 rounded-xl bg-indigo-500/20 border border-indigo-500/30">
            <Cpu size={32} className="text-indigo-400" />
          </div>
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-white mb-2">
              Plateforme MLOps Computer Vision
            </h1>
            <p className="text-gray-400 leading-relaxed max-w-2xl">
              Suite intégrée d'outils pour construire des pipelines de Computer Vision complets :
              de l'exploration de datasets jusqu'à la validation de modèles, avec supervision humaine
              à chaque étape critique.
            </p>
          </div>
        </div>

        {/* Key points */}
        <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { icon: <Layers size={16} />, text: '6 applications spécialisées' },
            { icon: <GitBranch size={16} />, text: 'Pipelines DAG orchestrés' },
            { icon: <CheckCircle2 size={16} />, text: 'Human-in-the-loop' },
            { icon: <Database size={16} />, text: 'Expériences versionnées' },
          ].map((p, i) => (
            <div key={i} className="flex items-center gap-2 text-sm text-indigo-300 bg-indigo-500/10 rounded-lg px-3 py-2">
              {p.icon}
              <span>{p.text}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Applications */}
      <Section title="Applications">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {APPS.map(app => (
            <div
              key={app.name}
              className="rounded-xl border border-gray-800 bg-gray-900/50 p-5 flex flex-col gap-3 hover:border-gray-700 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg bg-gradient-to-br ${app.color} bg-opacity-20 text-white`}>
                  {app.icon}
                </div>
                <div>
                  <h3 className="font-semibold text-white text-sm">{app.name}</h3>
                  <span className="text-xs text-gray-500">:{app.port}</span>
                </div>
                <a
                  href={app.url}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-auto text-gray-600 hover:text-indigo-400 transition-colors"
                >
                  <ExternalLink size={14} />
                </a>
              </div>

              <p className="text-xs text-gray-400 leading-relaxed">{app.description}</p>

              <ul className="space-y-1">
                {app.features.map(f => (
                  <li key={f} className="flex items-center gap-1.5 text-xs text-gray-500">
                    <span className="w-1 h-1 rounded-full bg-gray-600 shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Section>

      {/* CV Training Loop */}
      <Section title="Pipeline CV Training Loop — 13 étapes, 5 validations humaines">
        <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-5 overflow-x-auto">
          <div className="flex flex-col gap-1 min-w-[480px]">
            {WORKFLOW_STEPS.map((step, idx) => (
              <div key={step.id} className="flex items-center gap-3">
                {idx > 0 && (
                  <div className="flex flex-col items-center w-6 shrink-0 -mt-1 -mb-1">
                    <div className="w-px h-2 bg-gray-700" />
                  </div>
                )}
                <div className={`flex items-center gap-3 rounded-lg px-3 py-2 border flex-1 ${
                  step.type === 'human'
                    ? 'border-orange-500/30 bg-orange-900/10'
                    : 'border-gray-700/50 bg-gray-800/30'
                }`}>
                  <span className="text-xs font-mono text-gray-600 w-5 shrink-0">{step.id}</span>
                  {step.type === 'human' ? (
                    <span className="text-orange-400 text-xs font-bold shrink-0">⏸</span>
                  ) : (
                    <span className="text-green-400 text-xs shrink-0">●</span>
                  )}
                  <span className="text-sm text-white font-medium flex-1">{step.label}</span>
                  <span className={`text-xs px-2 py-0.5 rounded border shrink-0 ${APP_COLOR[step.app] || 'bg-gray-700 text-gray-300 border-gray-600'}`}>
                    {step.app}
                  </span>
                  <span className="text-xs text-gray-600 shrink-0 hidden sm:block">{step.desc}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 flex gap-4 text-xs text-gray-500">
            <span className="flex items-center gap-1.5">
              <span className="text-green-400">●</span> Automatique
            </span>
            <span className="flex items-center gap-1.5">
              <span className="text-orange-400">⏸</span> Validation humaine
            </span>
          </div>
        </div>
      </Section>

      {/* Architecture */}
      <Section title="Architecture" defaultOpen={false}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            {
              title: 'Backend',
              icon: <Cpu size={16} />,
              items: ['FastAPI + SQLite par app', 'CLIP ViT-B-32 (512d)', 'SAM2 + Grounding DINO', 'FAISS IndexFlatIP', 'DVC + MLflow + Optuna'],
            },
            {
              title: 'Frontend',
              icon: <Layers size={16} />,
              items: ['React 18 + TypeScript', 'Vite + TailwindCSS', 'TanStack Query', '@xyflow/react (DAG)', 'SSE streaming'],
            },
            {
              title: 'Orchestrateur',
              icon: <GitBranch size={16} />,
              items: ['DAG asyncio', 'Human-in-the-loop gates', 'SSE temps réel', 'Experiment tracking JSON', 'Proxy HTTP configurable'],
            },
          ].map(section => (
            <div key={section.title} className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
              <div className="flex items-center gap-2 mb-3 text-indigo-400">
                {section.icon}
                <h3 className="font-medium text-sm text-white">{section.title}</h3>
              </div>
              <ul className="space-y-1.5">
                {section.items.map(item => (
                  <li key={item} className="flex items-center gap-2 text-xs text-gray-400">
                    <ArrowRight size={10} className="text-gray-600 shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Section>

      {/* Quick start */}
      <Section title="Démarrage rapide" defaultOpen={false}>
        <div className="space-y-3">
          {[
            { n: '1', text: 'Lancer les apps via l\'onglet Applications de l\'Orchestrateur', code: 'python launcher.py --app orchestrator --workspace D:/ws --user alice' },
            { n: '2', text: 'Dans l\'onglet Applications, démarrer Dataset Explorer, Annotation, DVC, MLflow, Optuna' },
            { n: '3', text: 'Aller dans Expériences → choisir un template « CV Training Loop » et le dupliquer' },
            { n: '4', text: 'Ouvrir le sandgraph, configurer les nœuds, puis cliquer Lancer' },
            { n: '5', text: 'À chaque ⏸ human gate, ouvrir l\'app correspondante, valider, puis cliquer « Terminé → Continuer »' },
          ].map(step => (
            <div key={step.n} className="flex gap-3 items-start">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-indigo-500/20 border border-indigo-500/30 text-indigo-400 text-xs flex items-center justify-center font-bold">
                {step.n}
              </span>
              <div className="flex-1">
                <p className="text-sm text-gray-300">{step.text}</p>
                {step.code && (
                  <code className="mt-1 block text-xs text-indigo-300 bg-gray-800 px-3 py-1.5 rounded font-mono">
                    {step.code}
                  </code>
                )}
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* Raccourcis clavier */}
      <Section title="Raccourcis clavier — Sandgraph" defaultOpen={false}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {[
            { key: 'Suppr / ⌫', desc: 'Supprimer nœud(s) ou connexion(s) sélectionné(s)' },
            { key: 'F', desc: 'Ajuster la vue (fit view)' },
            { key: 'Ctrl+S', desc: 'Sauvegarder le graphe (via bouton Sauvegarder)' },
            { key: 'Glisser-déposer', desc: 'Ajouter un nœud depuis la barre latérale gauche' },
            { key: 'Clic sur nom', desc: 'Renommer l\'expérience en ligne' },
            { key: 'Ctrl+Scroll', desc: 'Zoomer / dézoomer le canvas' },
          ].map(({ key, desc }) => (
            <div key={key} className="flex items-start gap-3 p-3 bg-gray-800/40 rounded-lg">
              <kbd className="shrink-0 px-2 py-0.5 bg-gray-700 border border-gray-600 rounded text-xs text-gray-200 font-mono whitespace-nowrap">{key}</kbd>
              <span className="text-xs text-gray-400">{desc}</span>
            </div>
          ))}
        </div>
      </Section>

      <div className="flex items-center gap-2 text-xs text-gray-700 justify-center pb-4">
        <FlaskConical size={12} />
        <span>Plateforme MLOps CV — Orchestrateur v2</span>
      </div>
    </div>
  )
}
