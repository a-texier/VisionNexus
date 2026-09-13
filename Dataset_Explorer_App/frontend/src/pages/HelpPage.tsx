// ============================================================
// pages/HelpPage.tsx
// Documentation in-app — guide complet des fonctionnalités.
// ============================================================

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  BookOpen, Database, Map, Search, GitMerge, Layers,
  Play, ChevronDown, ChevronRight, Terminal, Zap,
  FolderOpen, Upload, Eye, MousePointer, Filter, Star,
  Globe, FileCode2, AlertTriangle, Pin,
} from 'lucide-react'

interface Section {
  id: string
  icon: React.ReactNode
  title: string
  content: React.ReactNode
}

import { useTour } from '../components/tour'
import { buildDatasetTourSteps, type DatasetTourContext } from '../components/help/datasetTourSteps'
import { writeTutorialState } from '../utils/tutorialState'

interface SpecificFormatCapability {
  id: string
  label: string
  extensions: string[]
}

export default function HelpPage() {
  const navigate = useNavigate()
  const { start: startTour } = useTour()
  const [open, setOpen] = useState<string>('quickstart')
  const [specificFormats, setSpecificFormats] = useState<SpecificFormatCapability[]>([])

  useEffect(() => {
    fetch('/api/capabilities')
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((data: { specific_formats?: SpecificFormatCapability[] }) => setSpecificFormats(data.specific_formats ?? []))
      .catch(() => setSpecificFormats([]))
  }, [])

  const toggle = (id: string) => setOpen(prev => prev === id ? '' : id)

  const handleStartTour = () => {
    void writeTutorialState({ launchedOnce: true })
    const ctx: DatasetTourContext = { navigate, samplePath: null, datasetName: null }
    startTour(buildDatasetTourSteps(), ctx, {
      onFinish: () => { void writeTutorialState({ completed: true }) },
    })
  }

  const sections: Section[] = [
    {
      id: 'quickstart',
      icon: <Zap size={18} className="text-yellow-400" />,
      title: 'Démarrage rapide',
      content: <QuickStart />,
    },
    {
      id: 'dataset',
      icon: <Database size={18} className="text-indigo-400" />,
      title: 'Ajouter et indexer un dataset',
      content: <DatasetHelp />,
    },
    {
      id: 'map',
      icon: <Map size={18} className="text-blue-400" />,
      title: 'Carte UMAP — Exploration visuelle',
      content: <MapHelp />,
    },
    {
      id: 'search',
      icon: <Search size={18} className="text-green-400" />,
      title: 'Recherche sémantique',
      content: <SearchHelp />,
    },
    {
      id: 'duplicates',
      icon: <GitMerge size={18} className="text-yellow-400" />,
      title: 'Détection de doublons',
      content: <DuplicatesHelp />,
    },
    {
      id: 'subsets',
      icon: <Layers size={18} className="text-purple-400" />,
      title: 'Subsets et export',
      content: <SubsetsHelp />,
    },
    {
      id: 'gallery',
      icon: <Globe size={18} className="text-purple-400" />,
      title: 'Dataset Gallery et datasets globaux',
      content: <GalleryHelp />,
    },
    ...(specificFormats.length > 0 ? [{
      id: 'specific-formats',
      icon: <FileCode2 size={18} className="text-teal-400" />,
      title: 'Formats optionnels détectés',
      content: <SpecificFormatsHelp formats={specificFormats} />,
    }] : []),
    {
      id: 'concepts',
      icon: <BookOpen size={18} className="text-pink-400" />,
      title: 'Concepts ML (CLIP, UMAP, FAISS)',
      content: <ConceptsHelp />,
    },
    {
      id: 'cli',
      icon: <Terminal size={18} className="text-gray-400" />,
      title: 'API & ligne de commande',
      content: <CLIHelp />,
    },
  ]

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-2">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <BookOpen size={24} /> Documentation
        </h1>
        <p className="text-gray-400 mt-1">Guide complet de Dataset Explorer</p>
        {/* Relance du tutoriel interactif (aussi accessible depuis la sidebar) */}
        <button
          onClick={handleStartTour}
          className="mt-3 flex flex-col items-start gap-0.5 px-3.5 py-2 rounded-lg bg-orange-600 hover:bg-orange-500 text-white text-sm font-medium transition-colors"
        >
          <span className="flex items-center gap-1.5"><Play size={13} /> Lancer le tutoriel interactif</span>
          <span className="text-[11px] font-normal text-orange-100/80">
            Crée un dataset démo « Tuto Cars 10 » et déroule tout le parcours
          </span>
        </button>
      </div>

      {/* Résumé des capacités */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
        {[
          { icon: <Database size={16}/>, label: 'Scan récursif', desc: 'JPG, PNG, BMP, TIFF, WebP' },
          { icon: <Zap size={16}/>, label: 'CLIP ViT-B-32', desc: 'Embeddings 512D sur GPU' },
          { icon: <Map size={16}/>, label: 'UMAP 2D', desc: 'Visualisation interactive + lasso' },
          { icon: <Search size={16}/>, label: 'Recherche texte', desc: 'Top-K par similarité cosine' },
          { icon: <GitMerge size={16}/>, label: 'Doublons', desc: 'Détection par seuil cosine' },
          { icon: <Globe size={16}/>, label: 'Gallery globale', desc: 'Datasets partagés entre workspaces' },
          { icon: <Upload size={16}/>, label: 'Export multi', desc: 'Symlinks ou copie physique' },
          ...specificFormats.map((format) => ({
            icon: <FileCode2 size={16}/>,
            label: format.label,
            desc: `${format.extensions.join(', ')} via adaptateur optionnel`,
          })),
        ].map(c => (
          <div key={c.label} className="bg-gray-800 rounded-lg p-3 border border-gray-700 flex items-start gap-2">
            <span className="text-indigo-400 mt-0.5">{c.icon}</span>
            <div>
              <p className="text-white text-sm font-medium">{c.label}</p>
              <p className="text-gray-500 text-xs">{c.desc}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Sections accordéon */}
      {sections.map(s => (
        <div key={s.id} className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
          <button
            onClick={() => toggle(s.id)}
            className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-gray-750 transition-colors"
          >
            <span className="flex items-center gap-3 font-semibold text-white">
              {s.icon} {s.title}
            </span>
            {open === s.id
              ? <ChevronDown size={18} className="text-gray-400" />
              : <ChevronRight size={18} className="text-gray-400" />
            }
          </button>
          {open === s.id && (
            <div className="px-5 pb-5 pt-1 border-t border-gray-700">
              {s.content}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ------------------------------------------------------------------ //
// Sections de contenu                                                 //
// ------------------------------------------------------------------ //

function QuickStart() {
  return (
    <div className="space-y-4 text-sm text-gray-300">
      <p className="text-gray-400">En 5 étapes, votre dataset est explorable :</p>
      <ol className="space-y-3">
        <Step n={1} title="Ajouter un dataset (Dataset Gallery)">
          Depuis la <b>Dataset Gallery</b>, collez le chemin absolu de votre dossier d'images
          (ex: <code className="bg-gray-900 px-1 rounded">C:\data\images</code>) et cliquez <b>Scanner</b>.
          Formats supportés : JPG, PNG, BMP, TIFF et WebP. Les formats optionnels
          installés côté backend sont ajoutés automatiquement.
          Les miniatures 256px sont générées en arrière-plan.
        </Step>
        <Step n={2} title="Épingler dans le Playground">
          Cliquez l'icône <b>Pin</b> à côté du dataset pour l'épingler dans le <b>Dashboard Playground</b>.
          Seuls les datasets épinglés apparaissent dans le Playground.
        </Step>
        <Step n={3} title="Lancer les embeddings (Playground)">
          Dans le Playground, cliquez <b>Embeddings</b> sur le dataset.
          Une barre SSE suit les 5 phases : embedding → indexing → umap → clustering → scoring.
        </Step>
        <Step n={4} title="Explorer la carte">
          Cliquez <b>Carte</b> — scatter plot UMAP interactif.
          Utilisez le lasso Plotly pour sélectionner une zone, puis créez un subset
          ou excluez les images du dataset.
        </Step>
        <Step n={5} title="Créer un subset et exporter">
          Depuis la page <b>Subsets</b> : gérez vos collections, dupliquez-les,
          exportez vers Annotation App (symlinks ou copie physique configurable dans Paramètres).
          Chaque subset peut être exporté plusieurs fois vers des destinations différentes.
        </Step>
      </ol>
    </div>
  )
}

function DatasetHelp() {
  return (
    <div className="space-y-4 text-sm text-gray-300">
      <HelpBlock icon={<FolderOpen size={15}/>} title="Formats supportés">
        <code className="text-indigo-300">.jpg .jpeg .png .bmp .tiff .tif .webp</code>
        <p className="mt-1 text-gray-400">Le scan récursif parcourt tous les sous-dossiers.</p>
      </HelpBlock>

      <HelpBlock icon={<Database size={15}/>} title="Workspace et cache">
        <p>Toutes les données sont dans le workspace (<code className="bg-gray-900 px-1 rounded">EXPLORER_WORKSPACE</code>) :</p>
        <pre className="mt-2 bg-gray-900 rounded p-3 text-xs text-gray-300 overflow-x-auto">{
`data/
├── dataset_explorer.db       ← base SQLite
├── thumbs/           ← miniatures 256px (nommées par MD5)
├── faiss/
│   └── {id}/         ← index FAISS par dataset
└── subsets/          ← symlinks`
        }</pre>
        <p className="mt-2 text-gray-400">
          Le MD5 de chaque fichier évite de recalculer les embeddings existants.
          Modifier le <b>contenu</b> d'une image → nouveau MD5 → nouvel embedding.
        </p>
      </HelpBlock>

      <HelpBlock icon={<Play size={15}/>} title="Nombre de clusters">
        <p>
          Choisissez <b>n_clusters</b> avant de scanner (défaut : 20).
          Règle empirique : <code className="bg-gray-900 px-1 rounded">n_clusters ≈ √N/2</code> (N = nb d'images).
          Pour 1000 images → 15–25 clusters. Pour 10 000 images → 50–80.
        </p>
      </HelpBlock>

      <HelpBlock icon={<Zap size={15}/>} title="Scan non-bloquant et barre de progression">
        <p>
          Le scan d'un grand dossier (des milliers d'images) est <b>non-bloquant</b> :
          l'application retourne immédiatement et le scan s'effectue en arrière-plan.
          Vous pouvez naviguer librement sans risque de timeout.
        </p>
        <ul className="mt-2 ml-4 list-disc text-gray-400 space-y-1">
          <li>
            Le dataset apparaît avec le statut <span className="text-teal-400 font-medium">scanning</span> (clignotant)
            pendant le scan. La progression <b>X/N images</b> s'affiche en temps réel.
          </li>
          <li>
            Une barre de progression horizontale montre l'avancement.
            La page se rafraîchit automatiquement toutes les 2 secondes.
          </li>
          <li>
            Une fois terminé, le statut passe à <span className="text-yellow-400 font-medium">pending</span> —
            le dataset est prêt pour les embeddings.
          </li>
        </ul>
      </HelpBlock>

      <HelpBlock icon={<Terminal size={15}/>} title="Via curl">
        <pre className="bg-gray-900 rounded p-3 text-xs text-gray-300 overflow-x-auto">{
`# Scanner
curl -X POST http://localhost:8001/api/datasets \\
  -H "Content-Type: application/json" \\
  -d '{"root_path":"C:/data/images","n_clusters":20}'

# Lancer embeddings (SSE — Ctrl+C pour arrêter)
curl -X POST http://localhost:8001/api/datasets/1/embed`
        }</pre>
      </HelpBlock>
    </div>
  )
}

function MapHelp() {
  return (
    <div className="space-y-4 text-sm text-gray-300">
      <p className="text-gray-400">
        La carte UMAP projette les 512 dimensions CLIP en 2D.
        Les images visuellement similaires sont proches sur la carte.
      </p>

      <HelpBlock icon={<MousePointer size={15}/>} title="Interactions Plotly">
        <ul className="space-y-1 list-disc ml-4 text-gray-400">
          <li><b>Lasso</b> (icône lasso dans la barre) — sélectionner une zone d'images</li>
          <li><b>Scroll</b> — zoom avant/arrière</li>
          <li><b>Drag</b> — pan sur la carte</li>
          <li><b>Hover</b> — affiche le nom du fichier</li>
          <li><b>Double-clic</b> — réinitialiser le zoom</li>
        </ul>
      </HelpBlock>

      <HelpBlock icon={<Filter size={15}/>} title="Modes de couleur">
        <ul className="space-y-2 ml-2">
          <li><span className="text-indigo-400 font-medium">Cluster</span> — chaque couleur = un cluster KMeans. Révèle les groupes sémantiques.</li>
          <li><span className="text-yellow-400 font-medium">Rareté</span> — gradient viridis : violet=commun, jaune=rare. Les images rares sont éloignées du centre de leur cluster.</li>
          <li><span className="text-gray-400 font-medium">Uniforme</span> — couleur unique, utile avec le lasso.</li>
        </ul>
      </HelpBlock>

      <HelpBlock icon={<Star size={15}/>} title="Score de rareté">
        <p>
          Le score de rareté [0–1] mesure la distance euclidienne de l'image au centroïde
          de son cluster, normalisée au sein du cluster.
        </p>
        <ul className="mt-2 ml-4 list-disc text-gray-400">
          <li><span className="text-green-400">0% — Commun</span> : image très représentative du cluster</li>
          <li><span className="text-yellow-400">40–70% — Moyen</span> : cas intermédiaire</li>
          <li><span className="text-red-400">70–100% — Rare</span> : cas atypique, à la limite du cluster</li>
        </ul>
        <p className="mt-2 text-gray-500">
          Utilisez "Rareté min : 70%" dans FilterBar pour isoler les images rares
          et vérifier si ce sont des anomalies ou des cas intéressants.
        </p>
      </HelpBlock>
    </div>
  )
}

function SearchHelp() {
  return (
    <div className="space-y-4 text-sm text-gray-300">
      <p className="text-gray-400">
        La recherche sémantique encode votre texte avec CLIP et trouve les images
        dont les features sont les plus proches dans l'espace 512D.
      </p>

      <HelpBlock icon={<Search size={15}/>} title="Exemples de requêtes efficaces">
        <div className="grid grid-cols-2 gap-2 mt-2">
          {[
            'car driving on highway',
            'person walking on sidewalk',
            'traffic jam',
            'rainy weather',
            'night scene with lights',
            'bicycle',
            'intersection with pedestrians',
            'empty road',
          ].map(q => (
            <code key={q} className="bg-gray-900 px-2 py-1 rounded text-xs text-indigo-300">{q}</code>
          ))}
        </div>
        <p className="mt-2 text-gray-500">
          CLIP comprend les descriptions en anglais. Les requêtes descriptives
          ("rainy night street") donnent de meilleurs résultats que les mots seuls ("rain").
        </p>
      </HelpBlock>

      <HelpBlock icon={<Filter size={15}/>} title="Modes de filtrage : Top-K vs Seuil %">
        <p>Deux modes disponibles via le toggle <b>Top-K / Seuil %</b> :</p>
        <ul className="mt-2 ml-4 list-disc text-gray-400 space-y-1">
          <li>
            <b>Top-K</b> : retourne les <em>N</em> images les plus similaires (1–500).
            Utile quand vous voulez un nombre fixe de résultats.
          </li>
          <li>
            <b>Seuil %</b> : retourne <em>toutes</em> les images avec un score ≥ au seuil choisi.
            Entrez "35%" → toutes les images avec ≥ 35% de correspondance sont retournées.
            Utile pour récupérer tout ce qui correspond vraiment, sans limite arbitraire.
          </li>
        </ul>
        <p className="mt-2 text-gray-400">
          Le score affiché est la similarité cosine [0–1]. Typiquement, les scores {'>'} 0.25
          sont pertinents pour des images de trafic routier avec CLIP ViT-B-32.
        </p>
      </HelpBlock>

      <HelpBlock icon={<Layers size={15}/>} title="Sauvegarder les résultats">
        <p>
          Sélectionnez des images (checkbox hover) puis cliquez <b>Sauver (N)</b>
          pour créer un subset avec uniquement la sélection.
          Sans sélection, <b>Tout sauver</b> crée un subset avec tous les résultats.
        </p>
      </HelpBlock>
    </div>
  )
}

function DuplicatesHelp() {
  return (
    <div className="space-y-4 text-sm text-gray-300">
      <p className="text-gray-400">
        La détection de doublons identifie les images quasi-identiques en comparant
        leurs embeddings CLIP par similarité cosine.
      </p>

      <HelpBlock icon={<GitMerge size={15}/>} title="Comment ça fonctionne">
        <ol className="space-y-2 ml-4 list-decimal text-gray-400">
          <li>Chaque embedding est comparé aux 50 voisins les plus proches (FAISS)</li>
          <li>Les paires avec similarité {'≥'} seuil forment un graphe</li>
          <li>Les composantes connexes (BFS) = groupes de doublons</li>
        </ol>
      </HelpBlock>

      <HelpBlock icon={<Filter size={15}/>} title="Choisir le seuil">
        <ul className="space-y-1 ml-4 list-disc text-gray-400">
          <li><b>0.99+</b> — copies quasi-exactes (même image resizée, recadrée légèrement)</li>
          <li><b>0.97</b> (défaut) — duplicates avec compression différente, renommage</li>
          <li><b>0.90–0.95</b> — images très similaires (même scène, angle légèrement différent)</li>
          <li><b>{'<'} 0.90</b> — peut regrouper des images juste similaires thématiquement</li>
        </ul>
      </HelpBlock>

      <HelpBlock icon={<Eye size={15}/>} title="Workflow de nettoyage">
        <ol className="space-y-2 ml-4 list-decimal text-gray-400">
          <li>Ajuster le seuil et cliquer <b>Appliquer</b></li>
          <li>Pour chaque groupe : identifier l'image de meilleure qualité</li>
          <li>Cocher <b>Garder</b> sur l'image choisie, <b>Rejeter</b> sur les autres</li>
          <li>Cliquer <b>Sauvegarder</b> — les décisions sont persistées en DB</li>
          <li>Créer un subset avec uniquement les images "Gardées" depuis la carte UMAP
            (filtrer par <code className="bg-gray-900 px-1 rounded">is_duplicate_kept=true</code>)</li>
        </ol>
      </HelpBlock>
    </div>
  )
}

function SubsetsHelp() {
  return (
    <div className="space-y-4 text-sm text-gray-300">
      <p className="text-gray-400">
        Un subset est une collection d'images représentée par un dossier de symlinks
        — les fichiers originaux ne sont pas copiés.
      </p>

      <HelpBlock icon={<Layers size={15}/>} title="Créer un subset">
        <p>Trois façons :</p>
        <ul className="mt-2 ml-4 space-y-1 list-disc text-gray-400">
          <li><b>Lasso UMAP</b> → sélectionner une zone → "Créer subset"</li>
          <li><b>Recherche sémantique</b> → sélectionner des résultats → "Sauver"</li>
          <li><b>Page Subsets</b> → avec la sélection courante (badge en sidebar)</li>
        </ul>
        <p className="mt-2 text-gray-500">
          La sélection d'images (set d'image_ids) est globale et persiste entre les pages.
        </p>
      </HelpBlock>

      <HelpBlock icon={<FolderOpen size={15}/>} title="Structure des symlinks">
        <pre className="bg-gray-900 rounded p-3 text-xs text-gray-300">{
`WORKSPACE/subsets/{nom_subset}/
├── image1.jpg  →  C:/data/images/image1.jpg
├── image2.jpg  →  C:/data/images/image2.jpg
└── ...`
        }</pre>
        <p className="mt-2 text-gray-500">
          Mode symlink ou copie physique configurable dans <b>Paramètres → Subsets & liens</b>.
          Sur Windows, les symlinks nécessitent le <b>mode Développeur</b>.
        </p>
      </HelpBlock>

      <HelpBlock icon={<Upload size={15}/>} title="Export vers Annotation App (multi-export)">
        <p>
          Chaque subset peut être exporté <b>plusieurs fois</b> vers des destinations différentes.
          Chaque export crée une ligne verte avec le chemin et le type (symlink / copie).
          Le même chemin ne peut pas être exporté deux fois (vérification d'unicité).
        </p>
        <code className="block mt-2 bg-gray-900 px-2 py-1 rounded text-xs text-indigo-300">
          Annotation_App/data/imports/{'{nom_subset}'}/
        </code>
      </HelpBlock>

      <HelpBlock icon={<Pin size={15}/>} title="Dupliquer un subset">
        <p>
          Le bouton <b>Dupliquer</b> crée une copie du subset avec un nom auto-numéroté
          (<code className="bg-gray-900 px-1 rounded">nom_1</code>, <code className="bg-gray-900 px-1 rounded">nom_2</code>…).
          La duplication fonctionne même si le subset a déjà été exporté.
        </p>
      </HelpBlock>

      <HelpBlock icon={<Map size={15} className="text-indigo-400" />} title="Bouton Carte">
        <p>
          Chaque subset dispose d'un bouton <b>Carte</b> qui ouvre directement la carte UMAP du
          dataset source. Cela permet de visualiser les images du subset sur la carte globale du
          dataset, d'y sélectionner de nouvelles images et de créer d'autres subsets.
        </p>
      </HelpBlock>

      <HelpBlock icon={<AlertTriangle size={15} className="text-orange-400" />} title="Doublons dans un subset — impact sur le dataset">
        <p className="font-medium text-orange-300 mb-2">Important : les décisions de doublons dans un subset affectent le dataset principal.</p>
        <ul className="ml-4 list-disc text-gray-400 space-y-1">
          <li>
            <b>Sauvegarder</b> les décisions (Garder/Rejeter) → met à jour{' '}
            <code className="bg-gray-900 px-1 rounded">Image.is_duplicate_kept</code> dans le dataset.
            Ces images sont alors comptées comme "rejetées" dans tout le Playground.
          </li>
          <li>
            <b>Appliquer au subset</b> → retire uniquement les images rejetées <em>du subset</em>
            (supprime les liens SubsetImage). Le dataset principal n'est <em>pas</em> modifié physiquement.
          </li>
          <li>
            Pour <b>annuler</b> les décisions sur le dataset principal, utilisez
            <b> Reset</b> dans le Playground (efface tous les <code>is_duplicate_kept</code>).
          </li>
        </ul>
      </HelpBlock>
    </div>
  )
}

function GalleryHelp() {
  return (
    <div className="space-y-4 text-sm text-gray-300">
      <p className="text-gray-400">
        La Gallery est le point d'entrée principal. Elle affiche <b>tous</b> les datasets :
        ceux du workspace actuel et les datasets globaux partagés entre tous les workspaces.
      </p>

      <HelpBlock icon={<Globe size={15}/>} title="Datasets globaux">
        <ul className="ml-4 list-disc text-gray-400 space-y-1">
          <li>
            <b>Créer un dataset global</b> : cochez "Partager" lors du scan.
            5 miniatures sont copiées dans{' '}
            <code className="bg-gray-900 px-1 rounded">data/dataset_gallery/{'<'}nom{'>/'}</code>{' '}
            (répertoire fixe, indépendant du workspace), et le dataset est enregistré
            dans un <b>registre JSON global</b>.
          </li>
          <li>
            <b>Changer de workspace</b> : les datasets globaux restent visibles dans la section
            "Galerie globale". Cliquez <b>Importer</b> pour les ajouter au workspace courant.
            Ils apparaissent alors dans la section <b>Mon workspace</b> avec un badge "global".
          </li>
          <li>
            L'app stocke dans le registre : chemin, nombre d'images, clusters, stats de base
            et 5 miniatures fixes pour la prévisualisation sans workspace.
          </li>
        </ul>
        <pre className="mt-3 bg-gray-900 rounded p-3 text-xs text-gray-300">{
`data/dataset_gallery/          ← chemin FIXE, indépendant de EXPLORER_WORKSPACE
├── registry.json              ← index minimal (path + stats + 5 thumb paths)
├── mon_dataset/               ← dossier réel (PAS un symlink)
│   └── thumbs/
│       ├── 0.jpg  ← miniature fixe (toujours accessible)
│       └── ...
└── dataset_train/
    └── thumbs/`
        }</pre>
      </HelpBlock>

      <HelpBlock icon={<Pin size={15}/>} title="Épingler dans le Playground">
        <p>
          Une fois un dataset dans votre workspace ("Mon workspace"), cliquez l'icône <b>Pin</b>
          pour l'ajouter au Dashboard Playground. L'icône <b>PinOff</b> dans le Playground le
          retire sans supprimer le dataset. L'ajout/retrait du Playground est mémorisé dans{' '}
          <code className="bg-gray-900 px-1 rounded">settings.json</code>.
        </p>
      </HelpBlock>

      <HelpBlock icon={<Database size={15}/>} title="Statistiques et aperçu">
        <p>Dépliez une card (bouton ▼) pour voir :</p>
        <ul className="mt-2 ml-4 list-disc text-gray-400 space-y-1">
          <li>Dimensions moyennes, min/max des images</li>
          <li>Distribution des formats (.jpg, .png…)</li>
          <li>Mode couleur (RGB, niveaux de gris…) — échantillonné sur 20 images</li>
          <li>Poids moyen et total des fichiers</li>
          <li>5 thumbnails aléatoires (workspace) ou miniatures fixes (dataset global non importé)</li>
        </ul>
      </HelpBlock>
    </div>
  )
}

function SpecificFormatsHelp({ formats }: { formats: SpecificFormatCapability[] }) {
  return (
    <div className="space-y-4 text-sm text-gray-300">
      <p className="text-gray-400">
        Ces formats sont publiés par les adaptateurs Python présents côté backend.
        La section disparaît entièrement si aucun adaptateur n'est installé.
      </p>
      <HelpBlock icon={<FileCode2 size={15}/>} title="Adaptateurs disponibles">
        <ul className="ml-4 list-disc text-gray-400 space-y-1">
          {formats.map((format) => (
            <li key={format.id}><b>{format.label}</b> : {format.extensions.join(', ')}</li>
          ))}
        </ul>
      </HelpBlock>
      <HelpBlock icon={<Zap size={15}/>} title="Découverte et retrait">
        <p>
          Les métadonnées sont découvertes sans importer les modules. Seul l'adaptateur
          correspondant à un fichier traité est ensuite chargé.
        </p>
        <p className="mt-2 text-gray-500">
          Retirer son fichier supprime la capacité au prochain démarrage, sans modifier
          le frontend ni empêcher les formats d'image standards de fonctionner.
        </p>
      </HelpBlock>
    </div>
  )
}

function LegacySpecificFormatHelp() {
  return (
    <div className="space-y-4 text-sm text-gray-300">
      <p className="text-gray-400">
        Un adaptateur de format optionnel peut publier une sequence binaire que Dataset
        Explorer lira et convertira en images standards.
      </p>

      <HelpBlock icon={<FileCode2 size={15}/>} title="Structure du format specifique">
        <pre className="bg-gray-900 rounded p-3 text-xs text-gray-300 overflow-x-auto">{
`Octets 0-47  : Header (big-endian)
  0-3   : Magic (4 octets fixes)
  28-31 : n_img    — nombre d'images dans la séquence
  32-33 : deg_mult — canaux (1=gris, 3=RGB)
  34-35 : n_row    — hauteur
  36-37 : n_col    — largeur
  44-45 : type_img — dtype (1=uint8, 3=uint16, 7=float32…)
Octets 48-127 : padding zéros
Octets 128+   : données images [n_img, deg_mult, n_row, n_col]`
        }</pre>
      </HelpBlock>

      <HelpBlock icon={<Play size={15}/>} title="Conversion via la Gallery">
        <p>Dans la section de conversion du format publie :</p>
        <ul className="mt-2 ml-4 list-disc text-gray-400 space-y-1">
          <li>Entrez le chemin d'un fichier supporte pour convertir uniquement ce fichier</li>
          <li>Entrez le chemin d'un dossier pour convertir les formats detectes recursivement</li>
          <li>Les PNG sont crees dans un dossier derive au meme niveau</li>
        </ul>
      </HelpBlock>

      <HelpBlock icon={<Zap size={15}/>} title="Conversion automatique au scan">
        <p>
          Si vous scannez un dossier contenant uniquement un format optionnel,
          la conversion se déclenche automatiquement avant le scan.
          Les PNG créés sont ensuite indexés comme un dataset normal.
        </p>
        <p className="mt-2 text-gray-500">
          Un fichier de sequence peut contenir <em>plusieurs images</em>.
          Chaque frame génère un PNG numéroté : <code className="bg-gray-900 px-1 rounded">nom_0000.png</code>,{' '}
          <code className="bg-gray-900 px-1 rounded">nom_0001.png</code>…
        </p>
        <p className="mt-2 text-gray-500">
          Les types float32/float64 sont normalisés automatiquement en [0-255] avant export PNG.
        </p>
      </HelpBlock>

      <HelpBlock icon={<Terminal size={15}/>} title="Via API">
        <pre className="bg-gray-900 rounded p-3 text-xs text-gray-300">{
`# Convertir un fichier de format optionnel
curl -X POST http://localhost:8001/api/convert-specific \\
  -H "Content-Type: application/json" \\
  -d '{"path":"C:/data/images/sequence.ext"}'

# Convertir tous les formats supportes d'un dossier
curl -X POST http://localhost:8001/api/convert-specific \\
  -H "Content-Type: application/json" \\
  -d '{"path":"C:/data/images/"}'`
        }</pre>
      </HelpBlock>
    </div>
  )
}

function ConceptsHelp() {
  return (
    <div className="space-y-4 text-sm text-gray-300">
      <HelpBlock icon={<Zap size={15}/>} title="CLIP — Contrastive Language-Image Pre-training">
        <p>
          CLIP (OpenAI, 2021) est un modèle entraîné sur 400M paires (image, texte)
          pour aligner les représentations visuelles et textuelles dans un espace commun.
        </p>
        <ul className="mt-2 ml-4 list-disc text-gray-400 space-y-1">
          <li>Architecture : ViT-B/32 (Vision Transformer, patch 32×32)</li>
          <li>Dimension de sortie : 512 floats L2-normalisés</li>
          <li>Propriété clé : <b>similarité cosine = produit scalaire</b> (vecteurs normalisés)</li>
          <li>Traite images ET texte → recherche cross-modale</li>
        </ul>
      </HelpBlock>

      <HelpBlock icon={<Map size={15}/>} title="Réduction dimensionnelle (UMAP / t-SNE / PCA)">
        <p>
          La méthode de projection 512D → 2D est configurable dans <b>Paramètres → Réduction dimensionnelle</b>.
          Les hyperparamètres sont sauvegardés et s'appliquent à tous les prochains pipelines.
        </p>
        <div className="mt-2 space-y-2">
          <div className="bg-gray-900 rounded p-2">
            <p className="text-white text-xs font-medium mb-1">UMAP (défaut — recommandé)</p>
            <ul className="ml-3 list-disc text-gray-400 text-xs space-y-1">
              <li>Préserve structure locale ET globale — meilleurs clusters visuels</li>
              <li><code>n_neighbors</code> (défaut 15) : voisins considérés par point</li>
              <li><code>min_dist</code> (défaut 0.1) : compacité des clusters</li>
            </ul>
          </div>
          <div className="bg-gray-900 rounded p-2">
            <p className="text-white text-xs font-medium mb-1">t-SNE</p>
            <ul className="ml-3 list-disc text-gray-400 text-xs space-y-1">
              <li>Clusters bien séparés visuellement, mais distances inter-clusters peu fiables</li>
              <li><code>perplexity</code> (défaut 30) : balance local/global</li>
              <li><code>learning_rate</code> (défaut 200) : vitesse d'apprentissage</li>
            </ul>
          </div>
          <div className="bg-gray-900 rounded p-2">
            <p className="text-white text-xs font-medium mb-1">PCA</p>
            <ul className="ml-3 list-disc text-gray-400 text-xs space-y-1">
              <li>Déterministe et rapide, mais moins expressif sur grands datasets</li>
              <li>Utilisé en fallback automatique si {'<'}4 points</li>
            </ul>
          </div>
        </div>
        <p className="mt-2 text-gray-500 text-xs">
          Fallback automatique : UMAP → t-SNE si UMAP échoue → PCA si {'<'}4 images.
          Tous utilisent la métrique cosine (cohérente avec CLIP) et random_state=42 (reproductible).
        </p>
      </HelpBlock>

      <HelpBlock icon={<Database size={15}/>} title="FAISS — Facebook AI Similarity Search">
        <p>
          FAISS gère l'index de recherche vectorielle. On utilise <code>IndexFlatIP</code>
          (Inner Product exact) — adapté car les vecteurs sont L2-normalisés.
        </p>
        <ul className="mt-2 ml-4 list-disc text-gray-400 space-y-1">
          <li>Complexité : O(N) par requête (recherche exacte, pas approchée)</li>
          <li>Persisté sur disque : rechargé au démarrage, jamais recalculé inutilement</li>
          <li>Invariant : position i dans FAISS = Image.id ordonnée par ascendant</li>
        </ul>
      </HelpBlock>

      <HelpBlock icon={<Filter size={15}/>} title="KMeans et rareté">
        <p>
          KMeans partitionne les embeddings en N clusters sphériques.
          Le score de rareté mesure l'éloignement au centroïde du cluster.
        </p>
        <p className="mt-2 text-gray-500">
          Une image "rare" n'est pas nécessairement mauvaise — elle peut représenter
          un cas difficile, une condition météo inhabituelle, ou simplement un angle unique.
          C'est un signal d'intérêt, pas de qualité.
        </p>
      </HelpBlock>
    </div>
  )
}

function CLIHelp() {
  return (
    <div className="space-y-4 text-sm text-gray-300">
      <HelpBlock icon={<Terminal size={15}/>} title="Lancement">
        <pre className="bg-gray-900 rounded p-3 text-xs text-gray-300 overflow-x-auto">{
`# Via launcher.py (recommandé)
python launcher.py

# Manuel
conda activate IA_env
uvicorn backend.main:app --host 0.0.0.0 --port 8001 --reload
cd frontend && npm run dev

# Workspace personnalisé
EXPLORER_WORKSPACE=D:/data/explorer python launcher.py`
        }</pre>
      </HelpBlock>

      <HelpBlock icon={<Database size={15}/>} title="Endpoints API principaux">
        <div className="space-y-2">
          {[
            ['POST', '/api/datasets', 'Scanner un dossier (adaptateurs optionnels auto-détectés)', '{"root_path":"...","n_clusters":20,"share_dataset":false}'],
            ['GET', '/api/datasets', 'Lister datasets (workspace + globaux)', ''],
            ['GET', '/api/datasets/{id}/stats', 'Stats descriptives + thumbnails', ''],
            ['POST', '/api/datasets/{id}/embed', 'Lancer pipeline (SSE)', ''],
            ['POST', '/api/datasets/{id}/rebuild-without-duplicates', 'Rebuild UMAP sans rejetés (SSE)', ''],
            ['POST', '/api/datasets/{id}/exclude-images', 'Exclure images du dataset', '{"image_ids":[1,2,3]}'],
            ['POST', '/api/datasets/{id}/recluster', 'Relancer KMeans', '{"n_clusters":30}'],
            ['GET', '/api/datasets/{id}/duplicates', 'Groupes doublons', '?threshold=0.97'],
            ['POST', '/api/subsets', 'Créer subset', '{"dataset_id":1,"name":"...","image_ids":[...]}'],
            ['POST', '/api/subsets/{id}/duplicate', 'Dupliquer subset', '{"name":"optionnel"}'],
            ['POST', '/api/subsets/{id}/export-to-annotation-app', 'Exporter (multi-export)', ''],
            ['GET', '/health', 'Statut backend', ''],
          ].map(([method, path, desc, body]) => (
            <div key={path} className="flex gap-2 items-start">
              <span className={`text-xs font-mono px-1.5 py-0.5 rounded flex-shrink-0 ${
                method === 'GET' ? 'bg-blue-900 text-blue-300' :
                method === 'POST' ? 'bg-green-900 text-green-300' :
                'bg-yellow-900 text-yellow-300'
              }`}>{method}</span>
              <span className="font-mono text-indigo-300 text-xs flex-shrink-0">{path}</span>
              <span className="text-gray-500 text-xs">{desc} {body && <code className="text-gray-600">{body}</code>}</span>
            </div>
          ))}
        </div>
        <p className="mt-3 text-gray-500 text-xs">
          Documentation interactive : <a href="http://localhost:8001/docs" target="_blank" rel="noreferrer"
            className="text-indigo-400 underline">http://localhost:8001/docs</a>
        </p>
      </HelpBlock>

      <HelpBlock icon={<Terminal size={15}/>} title="Tests">
        <pre className="bg-gray-900 rounded p-3 text-xs text-gray-300">{
`# Depuis Dataset_Explorer_App/
conda activate IA_env
python -m pytest backend/tests/ -v

# Avec dataset réel
$env:TEST_DATASET_DIR="C:\\data\\images"
python -m pytest backend/tests/ -v`
        }</pre>
      </HelpBlock>
    </div>
  )
}

// ------------------------------------------------------------------ //
// Composants utilitaires                                              //
// ------------------------------------------------------------------ //

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-indigo-600 text-white text-xs font-bold flex items-center justify-center mt-0.5">
        {n}
      </span>
      <div>
        <p className="font-semibold text-white">{title}</p>
        <div className="text-gray-400 mt-1">{children}</div>
      </div>
    </li>
  )
}

function HelpBlock({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-gray-900/60 border border-gray-700 p-4">
      <h4 className="font-semibold text-white flex items-center gap-2 mb-2">
        <span className="text-indigo-400">{icon}</span> {title}
      </h4>
      <div className="text-gray-300">{children}</div>
    </div>
  )
}
