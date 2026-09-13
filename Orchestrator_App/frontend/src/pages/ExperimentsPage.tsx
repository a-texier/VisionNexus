// ============================================================
// ExperimentsPage.tsx
// Liste des expériences sandgraph + templates prédéfinis.
// ============================================================

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { graphsAPI } from '../api/client'
import type { SandGraph } from '../types/api'
import {
  FlaskConical, Play, Copy, Trash2, Network,
  CheckCircle2, XCircle, Clock, Loader2, Plus,
  RotateCcw, ChevronRight, Lock, Database,
  TrendingUp, Radio, Unlock, GitBranch, Zap,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { formatDistanceToNow } from '../utils/time'

// ── Sandgraph templates ────────────────────────────────────────────────────────

type TemplateCategory = 'mainstream' | 'usecase'

interface SandgraphTemplate {
  name: string
  category: TemplateCategory
  description: string
  tags: string[]
  nodes: object[]
  edges: object[]
}

// Flèche standard réutilisée par toutes les arêtes (couleur = type de donnée qui transite)
const EDGE = (id: string, source: string, target: string, stroke = '#6366f1') =>
  ({ id, source, target, markerEnd: { type: 'arrowclosed' }, style: { stroke, strokeWidth: 2 } })

// Palette d'arêtes par étage du pipeline (couleur = type de donnée qui transite).
// NB : plus d'arête "mlflow" — MLflow est un nœud SUPERVISEUR isolé, jamais branché.
const C = {
  data:   '#6366f1', // dataset / subset (data prep)
  model:  '#3b82f6', // dataset YOLO → training
  hpo:    '#8b5cf6', // optuna
  infer:  '#06b6d4', // inférence / évaluation
  dvc:    '#f59e0b', // versionnage
}

// Nœud MLflow SUPERVISEUR — isolé, AUCUNE arête. Posé à côté de la chaîne pour
// rappeler qu'il observe automatiquement les runs du workspace (rien à brancher).
const MLFLOW_SUP = (x: number, y: number) =>
  ({ id: 'sup', type: 'mlflow', position: { x, y },
     data: { node_type: 'mlflow', label: 'MLflow — superviseur (auto)' } })

const SANDGRAPH_TEMPLATES: SandgraphTemplate[] = [
  // ════════════════════════════════════════════════════════════════════════
  // MAINSTREAM — les chaînes recommandées au quotidien, du plus simple au plus avancé
  // ════════════════════════════════════════════════════════════════════════
  {
    name: 'Entraînement rapide',
    category: 'mainstream',
    description: 'La chaîne la plus courte, sans éval ni HPO : Dataset → Dataset Explorer → Annotation auto → Training → DVC. MLflow supervise (isolé).',
    tags: ['courant', 'minimal'],
    nodes: [
      { id: 'ds1', type: 'dataset_source', position: { x: 0,   y: 100 }, data: { node_type: 'dataset_source', label: 'Dataset', dataset_name: 'mon-dataset', dataset_path: '', n_clusters: 15 } },
      { id: 'v1',  type: 'explorer',           position: { x: 300, y: 100 }, data: { node_type: 'explorer',           label: 'Dataset Explorer', dataset_name: 'mon-dataset', subset_name: 'subset-1', query: 'object', top_k: 50, full_auto: true } },
      { id: 'a1',  type: 'annotation',     position: { x: 600, y: 100 }, data: { node_type: 'annotation',     label: 'Annotation', subset_name: 'subset-1', project_name: 'subset-1', annotation_mode: 'sequence', full_auto: true, ai_model: 'grounding_dino', ai_text: 'object', ai_threshold: 0.3, label_classes: [{ name: 'objet', color: '#FF6B6B' }], split_train: 0.8, split_val: 0.2 } },
      { id: 't1',  type: 'training',       position: { x: 900, y: 100 }, data: { node_type: 'training',       label: 'Training YOLO', run_label: 'yolov8n', yolo_version: 'yolov8', model_size: 'n', epochs: 50, batch: 16, imgsz: 640, full_auto: true } },
      { id: 'd1',  type: 'dvc',            position: { x: 1200, y: 100 }, data: { node_type: 'dvc',            label: 'DVC Commit', commit_message: 'feat: add annotated dataset' } },
      MLFLOW_SUP(600, 300),
    ],
    edges: [
      EDGE('e1', 'ds1', 'v1', C.data),
      EDGE('e2', 'v1',  'a1', C.data),
      EDGE('e3', 'a1',  't1', C.model),
    ],
  },
  {
    name: 'Chaîne standard',
    category: 'mainstream',
    description: 'La chaîne recommandée, de la donnée au modèle versionné : Dataset → Dataset Explorer → Annotation auto → Training → Inference/Éval (retest mAP) → DVC. MLflow supervise automatiquement (nœud isolé, aucun branchement).',
    tags: ['recommandé', 'complet', 'éval'],
    nodes: [
      { id: 'ds1', type: 'dataset_source', position: { x: 0, y: 120 },
        data: { node_type: 'dataset_source', label: 'Dataset', dataset_name: 'mon-dataset', dataset_path: '', n_clusters: 15 } },
      { id: 'v1', type: 'explorer', position: { x: 280, y: 120 },
        data: { node_type: 'explorer', label: 'Dataset Explorer — subset', dataset_name: 'mon-dataset', subset_name: 'subset-1', query: 'object', top_k: 150, full_auto: true } },
      { id: 'a1', type: 'annotation', position: { x: 560, y: 120 },
        data: { node_type: 'annotation', label: 'Annotation auto', subset_name: 'subset-1', project_name: 'subset-1',
                annotation_mode: 'sequence', full_auto: true, ai_model: 'grounding_dino', ai_text: 'object', ai_threshold: 0.25,
                label_classes: [{ name: 'objet', color: '#EF4444' }], split_train: 0.8, split_val: 0.2 } },
      { id: 't1', type: 'training', position: { x: 840, y: 120 },
        data: { node_type: 'training', label: 'Training YOLO', run_label: 'yolov8n', yolo_version: 'yolov8', model_size: 'n', epochs: 50, batch: 16, imgsz: 640, full_auto: true } },
      { id: 'i1', type: 'inference', position: { x: 1120, y: 120 },
        data: { node_type: 'inference', label: 'Inference / Éval — mAP', full_auto: true, task: 'detection', model_path: '', gt_split: 'val' } },
      { id: 'd1', type: 'dvc', position: { x: 1400, y: 120 },
        data: { node_type: 'dvc', label: 'DVC — dataset + modèle', commit_message: 'feat: dataset + modele evalue' } },
      MLFLOW_SUP(660, 320),
    ],
    edges: [
      EDGE('e1', 'ds1', 'v1', C.data),
      EDGE('e2', 'v1',  'a1', C.data),
      EDGE('e3', 'a1',  't1', C.model),
      EDGE('e4', 't1',  'i1', C.infer),
      // GT : Annotation branchée aussi sur Inference (port "données/GT") — l'export
      // YOLO complet (train+val+test) est déjà consommé par Training ; Inference
      // n'en prend qu'un split (gt_split, "val" par défaut) pour évaluer le mAP.
      EDGE('e4b', 'a1', 'i1', C.data),
    ],
  },
  {
    name: 'Chaîne + HPO Optuna',
    category: 'mainstream',
    description: 'La chaîne standard avec optimisation d\'hyperparamètres : Dataset → Dataset Explorer → Annotation → Optuna (étude TPE+pruning, entraîne les trials) → best params → Training final → Inference/Éval → DVC. Un seul training « propre » en aval. MLflow supervise (isolé).',
    tags: ['HPO', 'optuna', 'éval'],
    nodes: [
      { id: 'ds1', type: 'dataset_source', position: { x: 0, y: 120 },
        data: { node_type: 'dataset_source', label: 'Dataset', dataset_name: 'mon-dataset', dataset_path: '', n_clusters: 15 } },
      { id: 'v1', type: 'explorer', position: { x: 280, y: 120 },
        data: { node_type: 'explorer', label: 'Dataset Explorer — subset', dataset_name: 'mon-dataset', subset_name: 'subset-1', query: 'object', top_k: 150, full_auto: true } },
      { id: 'a1', type: 'annotation', position: { x: 560, y: 120 },
        data: { node_type: 'annotation', label: 'Annotation auto', subset_name: 'subset-1', project_name: 'subset-1',
                annotation_mode: 'sequence', full_auto: true, ai_model: 'grounding_dino', ai_text: 'object', ai_threshold: 0.25,
                label_classes: [{ name: 'objet', color: '#EF4444' }], split_train: 0.8, split_val: 0.2 } },
      { id: 'o1', type: 'optuna', position: { x: 840, y: 120 },
        data: { node_type: 'optuna', label: 'Optuna — étude', full_auto: true, n_trials: 20, optimize: ['lr0', 'mosaic', 'scale'], best_params: '', stop_on_failure: true } },
      { id: 't1', type: 'training', position: { x: 1120, y: 120 },
        data: { node_type: 'training', label: 'Training final (best params)', run_label: 'yolov8n · best HPO', yolo_version: 'yolov8', model_size: 'n', epochs: 60, batch: 16, imgsz: 640, full_auto: true } },
      { id: 'i1', type: 'inference', position: { x: 1400, y: 120 },
        data: { node_type: 'inference', label: 'Inference / Éval — mAP', full_auto: true, task: 'detection', model_path: '', gt_split: 'val' } },
      { id: 'd1', type: 'dvc', position: { x: 1680, y: 120 },
        data: { node_type: 'dvc', label: 'DVC — dataset + modèle', commit_message: 'feat: modele best HPO evalue' } },
      MLFLOW_SUP(840, 320),
    ],
    edges: [
      EDGE('e1', 'ds1', 'v1', C.data),
      EDGE('e2', 'v1',  'a1', C.data),
      EDGE('e3', 'a1',  'o1', C.model),
      // Training a DEUX entrées distinctes ici : le dataset YOLO (directement depuis
      // Annotation, port "dataset") ET les best params (depuis Optuna, port "hpo").
      // Optuna ne fait QUE l'étude (chaque trial entraîne déjà un YOLO en interne sur
      // ce même dataset) — il ne "transmet" pas le dataset à Training, donc l'arête
      // Annotation→Training doit être explicite, pas seulement via Optuna.
      EDGE('e3b', 'a1', 't1', C.model),
      EDGE('e4', 'o1',  't1', C.hpo),
      EDGE('e5', 't1',  'i1', C.infer),
      // GT (voir "Chaîne standard") : Annotation → Inference, split "val" pour le mAP.
      EDGE('e5b', 'a1', 'i1', C.data),
    ],
  },

  // ════════════════════════════════════════════════════════════════════════
  // USE CASE — briques isolées et cas particuliers
  // ════════════════════════════════════════════════════════════════════════
  {
    name: 'Acquisition terrain → annotation',
    category: 'usecase',
    description: 'Boucle terrain (nœud Inference en mode FREE = acquisition) : capture un flux (MJPEG / ZMQ / optional_format / vidéo) → produit un dataset d\'images → Annotation → DVC. À rebrancher ensuite sur un Training pour du fine-tuning.',
    tags: ['acquisition', 'mode free', 'flux'],
    nodes: [
      { id: 'i1', type: 'inference', position: { x: 0, y: 100 },
        data: { node_type: 'inference', label: 'Acquisition (FREE)',
                sequence_dir: '', acq_name: 'capture_terrain', max_frames: 200, every: 1, camera_name: 'cam1' } },
      { id: 'a1', type: 'annotation', position: { x: 320, y: 100 },
        data: { node_type: 'annotation', label: 'Annotation', subset_name: 'capture_terrain', project_name: 'capture_terrain',
                annotation_mode: 'sequence', full_auto: false, ai_model: 'sam3', ai_text: '', ai_threshold: 0.5,
                label_classes: [{ name: 'objet', color: '#FF6B6B' }], split_train: 0.8, split_val: 0.2 } },
      { id: 'd1', type: 'dvc', position: { x: 640, y: 100 },
        data: { node_type: 'dvc', label: 'DVC Commit', commit_message: 'feat: dataset acquis sur le terrain' } },
    ],
    edges: [
      EDGE('e1', 'i1', 'a1', C.infer),
    ],
  },
  {
    name: 'Exploration dataset',
    category: 'usecase',
    description: 'Brique isolée : Dataset → Dataset Explorer en mode manuel (scan + embeddings CLIP), puis création du subset à la main dans le Playground (gate humaine).',
    tags: ['exploration', '2 nœuds', 'manuel'],
    nodes: [
      { id: 'ds1', type: 'dataset_source', position: { x: 0,   y: 100 }, data: { node_type: 'dataset_source', label: 'Dataset Source', dataset_name: 'mon-dataset', dataset_path: '', n_clusters: 15 } },
      { id: 'v1',  type: 'explorer',           position: { x: 350, y: 100 }, data: { node_type: 'explorer',           label: 'Dataset Explorer', dataset_name: 'mon-dataset', subset_name: 'exploration', query: '', top_k: 100, full_auto: false } },
    ],
    edges: [
      EDGE('e1', 'ds1', 'v1', C.data),
    ],
  },
  {
    name: 'Re-train depuis annotation existante',
    category: 'usecase',
    description: 'Annotation FREE (sélectionner un export YOLO existant) → Training → Inference/Éval → DVC. Ré-entraînement sans refaire la chaîne data (aucun Dataset Explorer requis).',
    tags: ['ré-entraînement', 'mode free', 'éval'],
    nodes: [
      { id: 'a1', type: 'annotation', position: { x: 0,   y: 100 }, data: { node_type: 'annotation', label: 'Annotation (FREE)', project_name: '', subset_name: '', annotation_mode: 'sequence', full_auto: false, label_classes: [{ name: 'objet', color: '#FF6B6B' }], split_train: 0.8, split_val: 0.2 } },
      { id: 't1', type: 'training',   position: { x: 320, y: 100 }, data: { node_type: 'training',   label: 'Training YOLO', run_label: 'yolov8n · retrain', yolo_version: 'yolov8', model_size: 'n', epochs: 50, batch: 16, imgsz: 640, full_auto: true } },
      { id: 'i1', type: 'inference',  position: { x: 640, y: 100 }, data: { node_type: 'inference',  label: 'Inference / Éval — mAP', full_auto: true, task: 'detection', model_path: '', gt_split: 'val' } },
      { id: 'd1', type: 'dvc',        position: { x: 960, y: 100 }, data: { node_type: 'dvc',        label: 'DVC Commit', commit_message: 'feat: retrain evalue' } },
    ],
    edges: [
      EDGE('e1', 'a1', 't1', C.model),
      EDGE('e2', 't1', 'i1', C.infer),
      // GT (voir "Chaîne standard") : le même export Annotation FREE alimente aussi le mAP.
      EDGE('e2b', 'a1', 'i1', C.data),
    ],
  },
  {
    name: 'Annotation depuis subset existant',
    category: 'usecase',
    description: 'Mode FREE : Dataset Explorer expose un subset déjà créé → Annotation LOCKED → DVC. Aucun dataset ni scan requis.',
    tags: ['mode free', 'sans dataset'],
    nodes: [
      { id: 'v1', type: 'explorer', position: { x: 0, y: 100 },
        data: { node_type: 'explorer', label: 'Dataset Explorer (FREE)', subset_name: 'night_dark' } },
      { id: 'a1', type: 'annotation', position: { x: 320, y: 100 },
        data: { node_type: 'annotation', label: 'Annotation', subset_name: 'night_dark',
                project_name: 'night_dark', annotation_mode: 'sequence', full_auto: false,
                ai_model: 'sam3', ai_text: '', ai_threshold: 0.5,
                label_classes: [{ name: 'objet', color: '#FF6B6B' }], split_train: 0.8, split_val: 0.2 } },
      { id: 'd1', type: 'dvc', position: { x: 640, y: 100 },
        data: { node_type: 'dvc', label: 'DVC Commit', commit_message: 'feat: annotation depuis subset existant' } },
    ],
    edges: [
      EDGE('e1', 'v1', 'a1', C.data),
    ],
  },
]

const TEMPLATE_ICONS: Record<string, React.ReactNode> = {
  // Mainstream
  'Chaîne standard':                     <Zap        size={16} />,
  'Chaîne + HPO Optuna':                 <GitBranch  size={16} />,
  'Entraînement rapide':                 <Network    size={16} />,
  // Use case
  'Acquisition terrain → annotation':    <Radio      size={16} />,
  'Exploration dataset':                 <Database   size={16} />,
  'Re-train depuis annotation existante':<TrendingUp size={16} />,
  'Annotation depuis subset existant':   <Unlock     size={16} />,
}

// ── Status badge ──────────────────────────────────────────────────────────────
const STATUS_STYLE: Record<string, string> = {
  idle:    'bg-gray-800 text-gray-400 border-gray-700',
  running: 'bg-blue-900/40 text-blue-400 border-blue-700/40',
  waiting: 'bg-orange-900/40 text-orange-400 border-orange-700/40',
  done:    'bg-emerald-900/40 text-emerald-400 border-emerald-700/40',
  failed:  'bg-red-900/40 text-red-400 border-red-700/40',
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_STYLE[status] ?? STATUS_STYLE.idle}`}>
      {status === 'running' && <Loader2 size={10} className="animate-spin" />}
      {status === 'waiting' && <Clock size={10} />}
      {status === 'done'    && <CheckCircle2 size={10} />}
      {status === 'failed'  && <XCircle size={10} />}
      {status}
    </span>
  )
}

// ── Graph card ────────────────────────────────────────────────────────────────
function GraphCard({
  graph,
  onOpen,
  onDuplicate,
  onDelete,
  onRun,
  onReset,
}: {
  graph: SandGraph
  onOpen: () => void
  onDuplicate: () => void
  onDelete: () => void
  onRun: () => void
  onReset: () => void
}) {
  const nodeCount = graph.nodes?.length ?? 0
  const edgeCount = graph.edges?.length ?? 0
  const doneCount = Object.values(graph.execution ?? {}).filter(e => e.status === 'done').length
  const isActive  = graph.status === 'running' || graph.status === 'waiting'

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3 hover:border-gray-700 transition-colors">
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-lg bg-indigo-900/30 text-indigo-400 shrink-0">
          <Network size={16} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-white truncate">{graph.name}</h3>
            <StatusBadge status={graph.status} />
          </div>
          <p className="text-[11px] text-gray-500 mt-0.5">
            {nodeCount} nœud{nodeCount !== 1 ? 's' : ''} · {edgeCount} connexion{edgeCount !== 1 ? 's' : ''}
            {doneCount > 0 && ` · ${doneCount}/${nodeCount} terminé${doneCount !== 1 ? 's' : ''}`}
          </p>
        </div>
      </div>

      {/* Progress bar */}
      {nodeCount > 0 && (
        <div className="h-1 bg-gray-800 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${graph.status === 'failed' ? 'bg-red-500' : graph.status === 'waiting' ? 'bg-orange-500' : 'bg-indigo-500'}`}
            style={{ width: `${Math.round((doneCount / nodeCount) * 100)}%` }}
          />
        </div>
      )}

      {/* Meta */}
      <p className="text-[11px] text-gray-600">
        Modifié {formatDistanceToNow(graph.updated_at)}
        {graph.run_history?.length > 0 && ` · ${graph.run_history.length} run${graph.run_history.length !== 1 ? 's' : ''}`}
      </p>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={onOpen}
          className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
        >
          <ChevronRight size={12} />
          Ouvrir
        </button>
        <div className="flex-1" />

        {!isActive ? (
          <button
            onClick={onRun}
            disabled={nodeCount === 0}
            className="flex items-center gap-1 px-2 py-1 text-[11px] text-indigo-400 border border-indigo-700/50 hover:bg-indigo-900/20 disabled:opacity-40 rounded-md transition-colors"
            title="Lancer"
          >
            <Play size={10} />
            Lancer
          </button>
        ) : (
          <button
            onClick={onReset}
            className="flex items-center gap-1 px-2 py-1 text-[11px] text-gray-400 border border-gray-700 hover:bg-gray-800 rounded-md transition-colors"
            title="Réinitialiser"
          >
            <RotateCcw size={10} />
            Reset
          </button>
        )}

        <button
          onClick={onDuplicate}
          className="p-1.5 text-gray-600 hover:text-white hover:bg-gray-800 rounded-md transition-colors"
          title="Dupliquer"
        >
          <Copy size={12} />
        </button>
        <button
          onClick={onDelete}
          className="p-1.5 text-gray-600 hover:text-red-400 hover:bg-gray-800 rounded-md transition-colors"
          title="Supprimer"
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  )
}

// ── Template card ─────────────────────────────────────────────────────────────
function TemplateCard({ tpl, onUse }: { tpl: SandgraphTemplate; onUse: () => void }) {
  const icon = TEMPLATE_ICONS[tpl.name] ?? <Network size={16} />
  return (
    <div className="bg-gray-900/60 border border-gray-800 border-dashed rounded-xl p-4 flex flex-col gap-3 hover:border-gray-700 transition-colors">
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-lg bg-gray-800 text-gray-400 shrink-0">{icon}</div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-200 truncate">{tpl.name}</p>
          <p className="text-[11px] text-gray-500 mt-0.5 leading-snug">{tpl.description}</p>
        </div>
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        {tpl.tags.map(t => (
          <span key={t} className="px-1.5 py-0.5 bg-gray-800 border border-gray-700 rounded text-[10px] text-gray-500">{t}</span>
        ))}
      </div>
      <button
        onClick={onUse}
        className="flex items-center gap-1.5 px-2.5 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white text-xs rounded-lg border border-gray-700 transition-colors w-fit"
      >
        <Copy size={11} /> Utiliser ce template
      </button>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function ExperimentsPage() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [showTemplates, setShowTemplates] = useState(true)

  const { data: graphs = [], isLoading } = useQuery({
    queryKey: ['graphs'],
    queryFn: graphsAPI.list,
    refetchInterval: 5000,
  })

  const createMut = useMutation({
    mutationFn: () => graphsAPI.create('Nouvelle expérience', [], []),
    onSuccess: g => {
      qc.invalidateQueries({ queryKey: ['graphs'] })
      navigate(`/?graph_id=${encodeURIComponent(g.graph_id)}`)
    },
  })

  const createFromTemplateMut = useMutation({
    mutationFn: (tpl: SandgraphTemplate) => {
      // Espace les nœuds horizontalement (×1.45) pour dégager la place aux
      // étiquettes d'arêtes (« ce qui transite »), sinon elles chevauchent les nœuds.
      const spaced = (tpl.nodes as { position: { x: number; y: number } }[]).map(n => ({
        ...n, position: { x: Math.round(n.position.x * 1.45), y: n.position.y },
      }))
      return graphsAPI.create(tpl.name, spaced as never[], tpl.edges as never[])
    },
    onSuccess: g => {
      qc.invalidateQueries({ queryKey: ['graphs'] })
      toast.success('Template chargé — ouvrez le sandgraph pour le configurer')
      navigate(`/?graph_id=${encodeURIComponent(g.graph_id)}`)
    },
    onError: () => toast.error('Erreur lors de la création depuis template'),
  })

  const dupMut = useMutation({
    mutationFn: (id: string) => graphsAPI.duplicate(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['graphs'] }); toast.success('Dupliqué') },
  })

  const delMut = useMutation({
    mutationFn: (id: string) => graphsAPI.delete(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['graphs'] }); toast.success('Supprimé') },
  })

  const runMut = useMutation({
    mutationFn: async (id: string) => {
      const g = await graphsAPI.get(id)
      if (!g) throw new Error('Graphe introuvable')
      return graphsAPI.run(id)
    },
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['graphs'] })
      navigate(`/?graph_id=${encodeURIComponent(id)}`)
      toast.success('Pipeline lancé')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const resetMut = useMutation({
    mutationFn: (id: string) => graphsAPI.reset(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['graphs'] }); toast('Exécution réinitialisée') },
  })

  return (
    <div className="p-6 h-full overflow-y-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <FlaskConical size={20} className="text-indigo-400" />
        <h1 className="text-xl font-semibold text-white">Expériences</h1>
        <span className="text-xs text-gray-500 ml-2">
          Sandgraphs enregistrés — chaque expérience est un pipeline visuel
        </span>
        <div className="flex-1" />
        <button
          onClick={() => createMut.mutate()}
          disabled={createMut.isPending}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors"
        >
          <Plus size={12} />
          Nouvelle
        </button>
      </div>

      {/* Templates section */}
      <div>
        <button
          onClick={() => setShowTemplates(o => !o)}
          className="flex items-center gap-2 mb-3 group"
        >
          <Lock size={13} className="text-gray-500" />
          <h2 className="text-sm font-semibold text-gray-400 group-hover:text-gray-300 transition-colors">Templates prédéfinis</h2>
          <span className="text-xs text-gray-600">(lecture seule — utiliser pour créer une expérience)</span>
          <span className="text-xs text-gray-600 ml-auto">{showTemplates ? '▲' : '▼'}</span>
        </button>
        {showTemplates && (
          <div className="space-y-5">
            {([
              { cat: 'mainstream' as const, title: 'Scénarios mainstream', hint: 'les chaînes recommandées au quotidien' },
              { cat: 'usecase' as const,    title: 'Scénarios exemple / use case', hint: 'briques isolées et cas particuliers' },
            ]).map(section => (
              <div key={section.cat}>
                <div className="flex items-center gap-2 mb-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">{section.title}</h3>
                  <span className="text-[11px] text-gray-600">— {section.hint}</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                  {SANDGRAPH_TEMPLATES.filter(t => t.category === section.cat).map(tpl => (
                    <TemplateCard
                      key={tpl.name}
                      tpl={tpl}
                      onUse={() => createFromTemplateMut.mutate(tpl)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Separator */}
      <div className="flex items-center gap-3">
        <div className="flex-1 h-px bg-gray-800" />
        <span className="text-xs text-gray-600">Mes expériences</span>
        <div className="flex-1 h-px bg-gray-800" />
      </div>

      {/* Distinction */}
      <div className="flex gap-4 text-xs text-gray-500">
        <div className="flex items-center gap-1.5">
          <Network size={12} className="text-indigo-400" />
          <span><span className="text-white">Expériences</span> = sandgraphs nommés, état persisté, dupliable</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Clock size={12} className="text-gray-400" />
          <span><span className="text-white">Activité</span> = journal brut de chaque exécution (append-only)</span>
        </div>
      </div>

      {/* Experiments grid */}
      {isLoading ? (
        <div className="flex items-center justify-center h-40 text-gray-500 text-sm">
          <Loader2 size={16} className="animate-spin mr-2" />Chargement…
        </div>
      ) : graphs.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 gap-3 text-center">
          <Network size={40} className="text-gray-800" />
          <div>
            <p className="text-white font-medium">Aucune expérience</p>
            <p className="text-gray-500 text-sm mt-1">Utilisez un template ci-dessus ou créez votre premier sandgraph</p>
          </div>
          <button
            onClick={() => createMut.mutate()}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-lg transition-colors"
          >
            Créer une expérience vide
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {graphs.map(g => (
            <GraphCard
              key={g.graph_id}
              graph={g}
              onOpen={() => {
                navigate(`/?graph_id=${encodeURIComponent(g.graph_id)}`)
              }}
              onDuplicate={() => dupMut.mutate(g.graph_id)}
              onDelete={() => { if (confirm(`Supprimer "${g.name}" ?`)) delMut.mutate(g.graph_id) }}
              onRun={() => runMut.mutate(g.graph_id)}
              onReset={() => resetMut.mutate(g.graph_id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
