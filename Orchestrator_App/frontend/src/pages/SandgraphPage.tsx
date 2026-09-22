// ============================================================
// SandgraphPage.tsx — Éditeur de graphe interactif (ReactFlow)
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ReactFlow, ReactFlowProvider, Background, Controls, MiniMap,
  BackgroundVariant, addEdge, applyNodeChanges, applyEdgeChanges,
  useReactFlow,
  type Node, type Edge, type OnConnect, type OnNodesChange,
  type OnEdgesChange, MarkerType,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import { Link, useSearchParams } from 'react-router-dom'
import {
  Plus, Play, RotateCcw, Copy, Trash2, Database,
  Eye, Tag, GitBranch, TrendingUp, Settings2, Zap, Save, Crosshair,
  Loader2, ChevronDown, ChevronRight, Maximize2, ScrollText, X, Box, Square, Search,
  CheckCircle2, XCircle, Undo2, Redo2, BarChart3, ShieldCheck, FlaskConical, Link2,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

import { nodeTypes } from '../nodes'
import type { NodeExecStatus } from '../nodes'
import { resolveHandles, inputAccepts, compatibleNodeTypes, PORT_STROKE, wouldViolateExclusivity, validatePortRules, NODE_PORTS } from '../nodes/ports'
import OrthogonalEdge from '../nodes/OrthogonalEdge'
import { decideMode, assignLanes, LANE_SPACING, estimatePillWidth, LABEL_EDGE_MARGIN, type Rect, type ChainAdjacency } from '../nodes/routing'

const edgeTypes = { orthogonal: OrthogonalEdge }
import { graphsAPI, launcherAPI, BACKEND_BASE } from '../api/client'
import type { SandGraph, RunEvent, ForkProvenance } from '../types/api'
import { deriveMlops } from '../types/api'
import NodeConfigPanel from '../components/NodeConfigPanel'
import { useWorkspaceStorageScope, workspaceStorageKey } from '../utils/workspaceStorage'
import { useT } from '../i18n/useLang'

// ── Toolbox ───────────────────────────────────────────────────────────────────

const TOOLBOX_NODES = [
  // ── Catégorie APPLICATIONS (les 7 apps du pipeline) ──
  { type: 'explorer',       category: 'app', label: 'Dataset Explorer',       icon: Eye,      color: 'text-violet-400 border-violet-700/50 hover:bg-violet-900/20', defaults: { node_type: 'explorer', label: 'Dataset Explorer', dataset_name: '', subset_name: 'subset', query: '', top_k: 50, full_auto: true } },
  { type: 'annotation', category: 'app', label: 'Annotation',     icon: Tag,      color: 'text-rose-400 border-rose-700/50 hover:bg-rose-900/20',     defaults: { node_type: 'annotation', label: 'Annotation', subset_name: '', project_name: '', annotation_mode: 'sequence', full_auto: false, ai_model: 'sam3', ai_text: '', ai_threshold: 0.5, label_classes: [{ name: 'objet', color: '#FF6B6B' }], split_train: 0.8, split_val: 0.2 } },
  { type: 'training',   category: 'app', label: 'Training',       icon: Zap,      color: 'text-blue-400 border-blue-700/50 hover:bg-blue-900/20',     defaults: { node_type: 'training', label: 'Training', engine: 'yolox', model_size: '', epochs: 300, batch: 16, imgsz: 640 } },
  { type: 'inference',  category: 'app', label: 'Inference / Eval', icon: Crosshair,color: 'text-cyan-400 border-cyan-700/50 hover:bg-cyan-900/20',   defaults: { node_type: 'inference', label: 'Inference / Eval', engine: 'yolox', model_size: '', full_auto: true, task: 'tracking', tracker_mot: 'bytetrack', tracker_sot: 'csrt', n_targets: 1, sequence_dir: '', model_path: '', data_yaml: '', annotation_file: '', compute_metrics: false, save_video: true } },
  { type: 'dvc',        category: 'app', label: 'DVC Commit',     icon: GitBranch,color: 'text-amber-400 border-amber-700/50 hover:bg-amber-900/20',   defaults: { node_type: 'dvc', label: 'DVC Commit', commit_message: 'feat: add dataset v1' } },
  { type: 'mlflow',     category: 'app', label: 'MLflow (superviseur)', icon: TrendingUp,color:'text-amber-400 border-amber-700/50 hover:bg-amber-900/20', defaults: { node_type: 'mlflow', label: 'MLflow' } },
  { type: 'optuna',     category: 'app', label: 'Optuna HPO',     icon: Settings2,color: 'text-cyan-400 border-cyan-700/50 hover:bg-cyan-900/20',     defaults: { node_type: 'optuna', label: 'Optuna HPO', engine: 'yolox', model_size: '', full_auto: true, n_trials: 20, optimize: [], best_params: '', stop_on_failure: true } },
  // ── Catégorie ENTRÉES (inputs manuels : comblent l'entrée d'un nœud) ──
  { type: 'dataset_source', category: 'input', label: 'Dataset Source', icon: Database, color: 'text-amber-400 border-amber-700/50 hover:bg-amber-900/20', defaults: { node_type: 'dataset_source', label: 'Dataset Source', dataset_name: 'mon-dataset', dataset_path: '', n_clusters: 15 } },
  { type: 'model',      category: 'input', label: 'Modèle',    icon: Box,      color: 'text-blue-400 border-blue-700/50 hover:bg-blue-900/20',     defaults: { node_type: 'model', label: 'Modèle', engine: 'yolox', model_size: '', model_path: '' } },
]

// Descriptions courtes (popup « nœud compatible »).
const NODE_DESC: Record<string, string> = {
  dataset_source: 'Charge un dataset depuis un dossier / fichier.',
  model:          'Sélectionne un modèle YOLO (.pt) existant.',
  explorer:           'Explore la BDD, crée un subset (CLIP).',
  annotation:     'Annote les images → dataset YOLO.',
  training:       'Entraîne un modèle YOLO.',
  inference:      'Inférence / évaluation / tracking.',
  optuna:         'Optimise les hyperparamètres (HPO).',
  dvc:            'Versionne le dataset + modèle (DVC).',
  mlflow:         'Superviseur MLflow (observe le store).',
}

// Libellés FR des actions de pipeline (step 5 — monitoring live sur le sandgraph).
// La clé = suffixe du step_id ({node}__{action}).
const STEP_ACTION_LABEL: Record<string, string> = {
  load: 'Chargement du dataset…', embed: 'Embedding CLIP…',
  verifyembed: 'En attente : vérifier les clusters', subset: 'Création du subset…',
  validatesubset: 'En attente : valider le subset', export: 'Export vers Annotation…',
  manual_create: 'En attente : créer le subset', project: 'Création du projet…',
  auto_annotate: 'Annotation auto (IA)…', annotate: 'En attente : annoter',
  exportyolo: 'Export YOLO…', train: 'Entraînement…', hpo: 'Étude Optuna (HPO)…',
  commit: 'Commit DVC…', infer: 'Tracking…', evaluate: 'Détection / évaluation…',
  acquire: 'Session fichier…', track: 'En attente : session interactive',
}

// ── Suivi live sous le node (step 4) ─────────────────────────────────────────
// Libellés COURTS pour la timeline du tray (sans « … » ni « En attente : »).
const SUBSTEP_LABEL: Record<string, string> = {
  load: 'Scan du dataset', embed: 'Embedding CLIP',
  verifyembed: 'Vérifier clusters', subset: 'Création subset',
  validatesubset: 'Valider subset', export: 'Export → Annotation',
  manual_create: 'Créer subset (manuel)', project: 'Création projet',
  auto_annotate: 'Annotation auto (IA)', annotate: 'Annotation (manuel)',
  exportyolo: 'Export YOLO', train: 'Entraînement', hpo: 'Étude Optuna',
  commit: 'Commit DVC', infer: 'Tracking', evaluate: 'Détection / éval',
  acquire: 'Session fichier', track: 'Session interactive',
}
// Ordre visuel canonique des sous-étapes (indépendant de l'ordre d'insertion du map).
const SUBSTEP_ORDER = [
  'load', 'embed', 'verifyembed', 'subset', 'manual_create', 'validatesubset',
  'export', 'project', 'auto_annotate', 'annotate', 'exportyolo',
  'hpo', 'train', 'commit', 'acquire', 'evaluate', 'infer', 'track',
]
type SubStatus = 'pending' | 'running' | 'done' | 'warning' | 'failed' | 'waiting'
// step2 : chaque sous-étape porte SA barre résiduelle (progress) → bleue pendant,
// verte à 100% une fois terminée (reste affichée). phase = libellé mesuré (ex.
// "epoch 25/60 · mAP50 0.493", "embedding").
interface ActivityStep { key: string; label: string; status: SubStatus; progress?: { current: number; total: number; phase: string } }
interface ResultItem { label: string; value: string }

// step2 : settings clés d'une étape (loggés au démarrage) — « aucun oubli ».
function stepSettings(action: string, d: Record<string, unknown>): string {
  const g = (k: string, def?: unknown) => d[k] ?? def
  if (action === 'train') {
    const parts = [`${g('engine', '')} ${g('model_size', '')}`.trim() || 'taille par défaut',
      `${g('epochs', 300)} epochs`, `batch ${g('batch', 16)}`, `imgsz ${g('imgsz', 640)}`]
    if (d.basic_lr_per_img != null) parts.push(`basic_lr_per_img=${d.basic_lr_per_img}`)
    return parts.join(' · ')
  }
  if (action === 'hpo') {
    const opt = (d.optimize as string[] | undefined) ?? []
    return `${g('n_trials', 20)} trials · TPE${opt.length ? ' · ' + opt.join(',') : ''}`
  }
  if (action === 'auto_annotate') return `${g('ai_model', 'sam3')} @ ${g('ai_threshold', 0.5)}`
  if (action === 'subset') return `query "${g('query', '')}" · top_k ${g('top_k', 50)}`
  return ''
}

// step1 : le node auquel une sous-étape est RATTACHÉE VISUELLEMENT (tray), qui peut
// différer du node d'exécution. Le SCAN (`__load`) et l'EMBEDDING (`__embed`) du
// dataset_source sont des traitements Dataset Explorer → on les affiche sous le node explorer
// enfant (Dataset Source = simple pointeur vers le dossier), pas sous Dataset Source.
type MiniEdge = { source: string; target: string }
type MiniNode = { id: string; data?: Record<string, unknown> }
function resolveDisplayNode(stepId: string, baseNodeId: string, edges: MiniEdge[], nodes: MiniNode[]): string {
  const action = stepId.split('__')[1] ?? ''
  if (action !== 'load' && action !== 'embed') return baseNodeId
  const child = edges.find(e => e.source === baseNodeId &&
    (nodes.find(n => n.id === e.target)?.data?.node_type as string) === 'explorer')
  return child ? child.target : baseNodeId
}

// Construit le plan des sous-étapes par node depuis le step_node_map (tous « pending »),
// pré-rempli au lancement → le tray montre des blocs vides qui se remplissent au fil du run.
function buildActivityPlan(snm: Record<string, string>, edges: MiniEdge[], nodes: MiniNode[]): Record<string, ActivityStep[]> {
  const out: Record<string, ActivityStep[]> = {}
  for (const [stepId, baseNodeId] of Object.entries(snm)) {
    const nodeId = resolveDisplayNode(stepId, baseNodeId, edges, nodes)
    const action = stepId.split('__')[1] ?? stepId
    ;(out[nodeId] ??= []).push({ key: action, label: SUBSTEP_LABEL[action] ?? action, status: 'pending' })
  }
  for (const nid of Object.keys(out)) {
    out[nid].sort((a, b) => {
      const ia = SUBSTEP_ORDER.indexOf(a.key), ib = SUBSTEP_ORDER.indexOf(b.key)
      return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib)
    })
  }
  return out
}

// Parse le résultat JSON d'une sous-étape → chips affichées sous le node (best params,
// mAP, frames annotées, taille subset, hash DVC…). Best-effort : tout échec → [].
function parseStepResult(action: string, output: unknown): ResultItem[] {
  let d: Record<string, unknown> = {}
  try { d = typeof output === 'string' ? JSON.parse(output) : (output as Record<string, unknown>) } catch { return [] }
  if (!d || typeof d !== 'object') return []
  const num = (v: unknown, dp = 3) => (typeof v === 'number' ? v.toFixed(dp) : String(v))
  const out: ResultItem[] = []
  if (action === 'train') {
    if (d.best_map50 != null) out.push({ label: 'mAP50', value: num(d.best_map50) })
    if (d.best_map5095 != null) out.push({ label: 'mAP50-95', value: num(d.best_map5095) })
  } else if (action === 'hpo') {
    // step1 : TOUJOURS surfacer les infos de l'étude Optuna (étude, trials, best value,
    // best params) — et l'erreur si l'étude n'a produit aucun best param (trials prunés).
    if (d.n_trials != null) out.push({ label: 'trials', value: String(d.n_trials) })
    if (d.best_value != null) out.push({ label: 'best ' + (d.metric ? String(d.metric) : 'val'), value: num(d.best_value) })
    const bp = d.best_params as Record<string, unknown> | undefined
    if (bp && typeof bp === 'object' && Object.keys(bp).length) {
      Object.entries(bp).slice(0, 6).forEach(([k, v]) =>
        out.push({ label: k, value: typeof v === 'number' ? (v as number).toFixed(4) : String(v) }))
    } else if (d.ok === false || d.error) {
      out.push({ label: 'erreur', value: String(d.error || 'HPO échoué').slice(0, 40) })
    } else if (d.best_value == null) {
      out.push({ label: 'best params', value: 'aucun (trials prunés ?)' })
    }
  } else if (action === 'subset' || action === 'export') {
    const c = d.count ?? d.n_images ?? d.image_count ?? d.size
    if (c != null) out.push({ label: 'images', value: String(c) })
    if (d.subset_name) out.push({ label: 'subset', value: String(d.subset_name) })
  } else if (action === 'auto_annotate' || action === 'annotate') {
    const b = d.annotation_count ?? d.boxes ?? d.n_annotations
    if (b != null) out.push({ label: 'boîtes', value: String(b) })
    const f = d.annotated_count ?? d.frames
    if (f != null) out.push({ label: 'frames', value: String(f) })
  } else if (action === 'exportyolo') {
    const c = d.n_images ?? d.count ?? d.total
    if (c != null) out.push({ label: 'images', value: String(c) })
  } else if (action === 'embed' || action === 'load') {
    const c = d.embed_total ?? d.n_images ?? d.image_count
    if (c != null) out.push({ label: 'images', value: String(c) })
  } else if (action === 'commit') {
    const h = d.commit ?? d.hash ?? d.rev
    if (h != null) out.push({ label: 'commit', value: String(h).slice(0, 8) })
  } else if (action === 'evaluate' || action === 'infer') {
    if (d.map50 != null) out.push({ label: 'mAP50', value: num(d.map50) })
    if (d.mota != null) out.push({ label: 'MOTA', value: num(d.mota) })
    if (d.precision != null) out.push({ label: 'P', value: num(d.precision) })
    if (d.recall != null) out.push({ label: 'R', value: num(d.recall) })
  }
  return out
}

// ── Node ID counter ───────────────────────────────────────────────────────────
let _nodeCounter = 0
function nextNodeId(type: string) { return `${type}_${++_nodeCounter}_${Date.now()}` }

// Dimensions de repli tant qu'un nœud n'a pas encore été mesuré par ReactFlow
// (1er render). Remonté ici (avant _nodeRect plus bas) car aussi utilisé par
// alignApplicationNodes/spaceApplicationNodes.
const _NODE_W = 260, _NODE_H = 140

// ── Catégorie ENTRÉE (dataset_source / model) vs APPLICATION (les 7 apps) ──
// Reprend la même distinction que TOOLBOX_NODES (category: 'input' | 'app'),
// mais utilisable sans dépendre du toolbox (nodes chargés depuis le backend).
const INPUT_NODE_TYPES = new Set(['dataset_source', 'model'])
function isInputNode(n: Node): boolean {
  return INPUT_NODE_TYPES.has(n.data?.node_type as string)
}

// Node ISOLÉ (ex: mlflow — superviseur, AUCUN port entrée/sortie, jamais branché,
// cf. NODE_PORTS.mlflow = {inputs:[],outputs:[]}) : n'a JAMAIS d'arête entrante,
// donc computeExecOrder lui donnait systématiquement exec_order=1 (profondeur 0,
// comme une vraie racine) — un node isolé N'EST PAS un maillon de la chaîne
// séquentielle et ne doit jamais servir de référence d'alignement/espacement.
// Bug corrigé : alignApplicationNodes/spaceApplicationNodes traitaient MLflow
// comme le "premier node Application" (plus petit exec_order) → tout le reste
// de la chaîne était aligné/espacé par rapport à sa position (hors-chaîne, ex.
// y=320 loin du y=120 de la vraie séquence) → cascade d'écarts énormes.
function isIsolatedNode(n: Node): boolean {
  const ports = NODE_PORTS[n.data?.node_type as string]
  return !!ports && ports.inputs.length === 0 && ports.outputs.length === 0
}
function isChainNode(n: Node): boolean {
  return !isInputNode(n) && !isIsolatedNode(n)
}

// ── Ordre d'exécution logique (numéro affiché en haut à droite de chaque node) ──
// Profondeur = plus long chemin depuis une racine (aucune arête entrante).
// 1-indexé pour l'affichage. Deux nodes au MÊME niveau tournent en parallèle
// (asyncio.gather côté backend) → ils partagent le même numéro.
// Les nodes ENTRÉE (dataset_source, model) participent au calcul de profondeur
// (un node Application juste après une Entrée démarre bien à l'étape 1) mais ne
// reçoivent JAMAIS eux-mêmes de numéro affiché (step 2 du cahier des charges).
// Les nodes ISOLÉS (mlflow) n'en reçoivent pas non plus — un superviseur jamais
// branché n'appartient pas à la séquence, lui attribuer "1" (profondeur 0, comme
// une racine) était trompeur ET dangereux (cf. isIsolatedNode ci-dessus).
function computeExecOrder(nodes: Node[], edges: Edge[]): Record<string, number> {
  const incoming: Record<string, string[]> = {}
  nodes.forEach(n => { incoming[n.id] = [] })
  edges.forEach(e => { if (incoming[e.target]) incoming[e.target].push(e.source) })

  const depth: Record<string, number> = {}
  const visiting = new Set<string>()
  const compute = (id: string): number => {
    if (depth[id] !== undefined) return depth[id]
    if (visiting.has(id)) return 0        // garde-fou anti-cycle
    visiting.add(id)
    const parents = incoming[id] ?? []
    const d = parents.length === 0 ? 0 : Math.max(...parents.map(compute)) + 1
    visiting.delete(id)
    depth[id] = d
    return d
  }
  const order: Record<string, number> = {}
  nodes.forEach(n => { if (isChainNode(n)) order[n.id] = compute(n.id) + 1 })
  return order
}

// ── Alignement automatique des nodes Application (step 2 — Auto Save + Auto
// Check) ── Le premier node Application (le plus petit exec_order ; à égalité,
// le plus à gauche) sert de référence, garde toujours sa position. Les nodes
// Entrée ET les nodes isolés (mlflow) ne sont eux non plus jamais déplacés ni
// utilisés comme référence.
//
// Aligné sur le BRANCHEMENT RÉEL, pas sur la bounding-box du node (bug corrigé
// — cf. _handleOffset ci-dessus) : pour chaque node de la chaîne, on retrouve
// l'arête qui le connecte à SON prédécesseur immédiat (exec_order - 1) et on
// décale le node en Y pour que le CENTRE EXACT du port cible (mesuré par
// ReactFlow) tombe exactement à la même hauteur que le centre exact du port
// source déjà positionné. Le câble de cette arête devient alors rigoureusement
// horizontal, quel que soit le contenu (donc la hauteur) de chacun des deux
// nodes. Tant qu'un node n'a pas encore été mesuré par ReactFlow (1er render),
// on retombe sur l'ancien repli bas-de-node — corrigé dès la mesure disponible
// (l'effet Auto Check qui appelle cette fonction est de toute façon débounced).
// Pour les nodes multi-ports (Training, Inference), seul le port utilisé par
// CETTE arête (i→i+1) est aligné — les autres entrées (ex. best_params venant
// d'Optuna) gardent un léger coude, ce qui est attendu (pas un bug) : on ne
// peut aligner qu'UN SEUL port par translation Y du node.
function alignApplicationNodes(nodes: Node[], edges: Edge[], getInternalNode: GetInternalNode): Node[] {
  const chainNodes = nodes.filter(isChainNode)
  if (chainNodes.length < 2) return nodes
  const byId = new Map(nodes.map(n => [n.id, n]))
  const sorted = [...chainNodes].sort((a, b) => {
    const oa = (a.data?.exec_order as number) ?? Infinity
    const ob = (b.data?.exec_order as number) ?? Infinity
    if (oa !== ob) return oa - ob
    return a.position.x - b.position.x
  })
  const first = sorted[0]
  const posY = new Map<string, number>([[first.id, first.position.y]])

  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i]
    const curOrder = cur.data?.exec_order as number | undefined
    // L'arête i→i+1 : source déjà repositionnée (posY la connaît) ET d'ordre
    // exactement -1 par rapport à `cur` — c'est CETTE connexion, et aucune
    // autre, que l'alignement doit rendre droite (cf. commentaire ci-dessus).
    const inEdge = curOrder == null ? undefined : edges.find(e => {
      if (e.target !== cur.id || !posY.has(e.source)) return false
      const src = byId.get(e.source)
      return (src?.data?.exec_order as number | undefined) === curOrder - 1
    })
    if (!inEdge) { posY.set(cur.id, cur.position.y); continue }

    const srcOff = _handleOffset(getInternalNode, inEdge.source, inEdge.sourceHandle, 'source')
    const tgtOff = _handleOffset(getInternalNode, cur.id, inEdge.targetHandle, 'target')
    if (srcOff == null || tgtOff == null) {
      const srcNode = byId.get(inEdge.source)!
      const refBottom = posY.get(inEdge.source)! + (srcNode.measured?.height ?? _NODE_H)
      posY.set(cur.id, refBottom - (cur.measured?.height ?? _NODE_H))
      continue
    }
    posY.set(cur.id, posY.get(inEdge.source)! + srcOff - tgtOff)
  }

  return nodes.map(n => (posY.has(n.id) && n.id !== first.id)
    ? { ...n, position: { ...n.position, y: posY.get(n.id)! } }
    : n)
}

// ── Espacement horizontal automatique (step 3 — Auto Save + Auto Check) ──
// Pour deux nodes Application ADJACENTS dans l'ordre d'exécution (i → i+1),
// garantit assez de place entre eux pour que le label de la connexion (step 1)
// ne chevauche jamais les nodes. N'AUGMENTE que l'écart (jamais ne le réduit) :
// si les deux nodes sont déjà assez espacés, on n'y touche pas. Les nodes au
// MÊME rang (parallèles, même exec_order) ne sont jamais forcés l'un vers
// l'autre. Ne modifie jamais les connexions longues (i→i+2+, step 4) : on ne
// déplace que du X, le routage (routing.ts) recalcule leur tracé tout seul.
// Marge au-delà du bord DROIT RÉEL du node précédent (mesuré par ReactFlow, pas
// un fallback fixe — un node réel peut dépasser 260px de large). Plancher
// générique (label vide/court) : > STUB*4=96 (seuil de stableLabelAnchor pour
// la position "près du départ"). Volontairement modeste par défaut — une marge
// excessive cascaderait sur toute la chaîne (chaque écart ajouté au suivant) et
// finirait par éloigner visuellement les nodes Application des nodes Entrée,
// qui eux ne bougent jamais (cf. alignApplicationNodes ci-dessus) — c'était la
// cause du bug rapporté (chaîne éloignée de 3000px+ de sa source).
//
// step 5 (Bob, juillet 2026) : ce plancher fixe ne réservait PAS assez de place
// pour un label RÉEL long (ex. "dataset YOLO : subset-1-yolo") → le texte
// collait aux nodes voisins, sans espace avant/après. La marge est maintenant
// le MAX du plancher générique et de la largeur ESTIMÉE du label de CETTE
// connexion (edgeTransit, même fonction que decorateEdges) + 2×LABEL_EDGE_MARGIN
// (avant ET après le texte) — cohérent avec le clamp anti-chevauchement de
// stableLabelAnchor (routing.ts), qui se rabat sur cette place déjà réservée.
const APP_GAP_MARGIN_MIN = 140
function spaceApplicationNodes(nodes: Node[], edges: Edge[]): Node[] {
  const chainNodes = nodes.filter(isChainNode)
  if (chainNodes.length < 2) return nodes
  const sorted = [...chainNodes].sort((a, b) => {
    const oa = (a.data?.exec_order as number) ?? Infinity
    const ob = (b.data?.exec_order as number) ?? Infinity
    if (oa !== ob) return oa - ob
    return a.position.x - b.position.x
  })
  const newX = new Map<string, number>()
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1], cur = sorted[i]
    const prevOrder = prev.data?.exec_order as number | undefined
    const curOrder = cur.data?.exec_order as number | undefined
    if (prevOrder == null || curOrder == null || curOrder !== prevOrder + 1) continue // pas i→i+1
    const prevX = newX.get(prev.id) ?? prev.position.x
    const prevWidth = prev.measured?.width ?? _NODE_W
    const isConnected = edges.some(e => e.source === prev.id && e.target === cur.id)
    const label = isConnected ? edgeTransit(prev, cur) : ''
    const labelRoom = label ? estimatePillWidth(label) + LABEL_EDGE_MARGIN * 2 : 0
    const minX = prevX + prevWidth + Math.max(APP_GAP_MARGIN_MIN, labelRoom)
    if (cur.position.x < minX) newX.set(cur.id, minX)
  }
  if (newX.size === 0) return nodes
  return nodes.map(n => newX.has(n.id) ? { ...n, position: { ...n.position, x: newX.get(n.id)! } } : n)
}

// Align + espace en un seul appel — utilisé par l'effet Auto Check (sur édition)
// ET par le redressement automatique au premier chargement d'un graphe (voir
// plus bas), pour ne jamais dupliquer l'ordre des deux passes (aligner le Y
// AVANT d'espacer le X : l'espacement lit `edgeTransit`, qui ne dépend pas du
// Y, donc l'ordre inverse serait sans risque, mais un seul appel évite tout
// oubli si l'un des deux passes évolue plus tard).
function normalizeLayout(nodes: Node[], edges: Edge[], getInternalNode: GetInternalNode): Node[] {
  return spaceApplicationNodes(alignApplicationNodes(nodes, edges, getInternalNode), edges)
}

// ── Validation stricte du graphe entier (step 5) ────────────────────────────
// « Impossible de créer un workflow invalide » : entrées obligatoires manquantes
// (sauf mode FREE — explorer/annotation sans arête entrante) et paires exclusives
// violées bloquent la sauvegarde/le lancement (errors) ; les paires
// `requiresPeer` manquantes (ex: GT sans Dataset sur Inference) ne bloquent
// pas mais s'affichent en warning. Résolution par PORT (targetHandle), pas
// juste par type de node source — cohérent avec ports.ts.
// Résout le targetHandle RÉEL d'une arête : `e.targetHandle` n'est souvent JAMAIS
// posé sur les arêtes venant d'un template (ExperimentsPage.tsx) ou d'un vieux
// graphe sauvegardé — seul `decorateEdges` le résolvait, mais UNIQUEMENT pour
// l'affichage (jamais réécrit dans l'état `edges`). Sans ce fallback, la
// validation (ci-dessous) et `isValidConnection` retombaient sur le literal
// `'in'` pour CHAQUE arête non résolue → un node à plusieurs ports (ex: Training
// dataset/model/hpo) voyait TOUJOURS `'in'` comme seul port "branché", jamais
// `'dataset'` → "entrée obligatoire manquante" même quand l'arête existait bel
// et bien (bug remonté : Training final d'une chaîne HPO, dataset via Annotation
// directe + best params via Optuna).
function _resolvedTargetHandle(e: Edge, byId: Map<string, Node>): string {
  if (e.targetHandle) return e.targetHandle
  const src = byId.get(e.source), tgt = byId.get(e.target)
  return resolveHandles(src?.data?.node_type as string, tgt?.data?.node_type as string).targetHandle
}

function validateGraph(nodes: Node[], edges: Edge[]): { errors: string[]; warnings: string[] } {
  const byId = new Map(nodes.map(n => [n.id, n]))
  const errors: string[] = [], warnings: string[] = []
  for (const n of nodes) {
    const ntype = n.data?.node_type as string
    const label = (n.data?.label as string) || ntype
    const incoming = edges.filter(e => e.target === n.id)
    const connectedHandleIds = new Set(incoming.map(e => _resolvedTargetHandle(e, byId)))
    const isFreeMode = (ntype === 'explorer' || ntype === 'annotation') && incoming.length === 0
    const { errors: nErr, warnings: nWarn } = validatePortRules(ntype, label, connectedHandleIds, isFreeMode)
    errors.push(...nErr)
    warnings.push(...nWarn)
  }

  // Pré-contrôle du contrat modèle sur chaque liaison : un checkpoint doit
  // conserver son moteur et son architecture de Model/Optuna à Training puis
  // à Inference. Le backend répète ce contrôle pour les appels hors UI.
  const modelNodes = new Set(['model', 'optuna', 'training', 'inference'])
  for (const e of edges) {
    const src = byId.get(e.source), tgt = byId.get(e.target)
    const st = src?.data?.node_type as string, tt = tgt?.data?.node_type as string
    if (!src || !tgt || !modelNodes.has(st) || !modelNodes.has(tt)) continue
    const sl = (src.data?.label as string) || st, tl = (tgt.data?.label as string) || tt
    const se = String(src.data?.engine || 'yolox').trim().toLowerCase()
    const te = String(tgt.data?.engine || 'yolox').trim().toLowerCase()
    if (se !== te) {
      errors.push(`Pré-contrôle bloquant : « ${sl} » utilise ${se}, mais « ${tl} » utilise ${te}. Alignez le moteur sur les deux nœuds.`)
    }
    const ss = String(src.data?.model_size || '').trim().toLowerCase()
    const ts = String(tgt.data?.model_size || '').trim().toLowerCase()
    if (ss && ts && ss !== ts) {
      errors.push(`Pré-contrôle bloquant : « ${sl} » utilise ${ss}, mais « ${tl} » utilise ${ts}. Un checkpoint doit garder son architecture d'origine.`)
    }
  }
  return { errors, warnings }
}

// ── Étiquette d'arête : ce qui TRANSITE d'un nœud à l'autre ─────────────────────
// Chaque arête affiche la donnée transmise. Tant que la source n'a rien de concret,
// on montre « None » (gris). Dès que la valeur existe (nœud LOCKED résolu), on l'affiche
// (emerald). Purement dérivé du graphe — jamais persisté.
const _base = (p: unknown) => { const s = String(p ?? ''); const m = s.replace(/\\/g, '/').split('/').filter(Boolean); return m.length ? m[m.length - 1] : '' }
const _has  = (p: unknown) => !!(p && String(p).trim())
// Préremplissage auto « suit l'input » (vérifié à chaque save) : re-dérive un champ OUTPUT
// (ex. subset_name, project_name, run_label) depuis la valeur d'un champ INPUT amont —
// UNIQUEMENT si cet input a CHANGÉ depuis la dernière dérivation (mémorisée dans le marqueur
// `mk`, un champ caché de data). Conséquence voulue :
//   • l'input change  → l'output se met à jour tout seul (écrase, même une valeur existante) ;
//   • l'input inchangé → l'output reste éditable À LA MAIN (jamais écrasé, le marqueur == input).
// Retourne un patch { [out]: <dérivé>, [mk]: <input> } à fusionner dans data — ou {} si rien
// à faire (source vide, ou input inchangé depuis la dernière dérivation).
// Règle (voulue par l'utilisateur) : brancher/changer un input COMPTE comme un changement
// d'input → l'output suit (dérive). L'édition manuelle n'est protégée qu'APRÈS coup, tant que
// l'input ne rebouge pas (marqueur == input courant). Sur un graphe legacy (pas de marqueur),
// le 1er save re-dérive donc les noms depuis les inputs courants (migration one-shot), puis le
// marqueur est posé et les éditions manuelles tiennent.
function _rederive(
  data: Record<string, unknown> | undefined,
  out: string,
  mk: string,
  srcVal: string | undefined,
  derive: (s: string) => string,
): Record<string, unknown> {
  const s = (srcVal ?? '').trim()
  if (!s) return {}                                          // pas de source → ne touche à rien
  if ((data?.[mk] as string | undefined) === s) return {}    // input inchangé → garde l'édition manuelle
  return { [out]: derive(s), [mk]: s }                       // pas de marqueur OU input changé → dérive
}
// Nom du dataset YOLO exporté par un nœud Annotation source (step 4 : prefill du nom de
// sortie Training) — même calcul que `yoloName` dans edgeTransit ci-dessous (FREE mode :
// export_name déjà exact ; LOCKED : `${project}-yolo` prédictif, pas encore exporté).
function _yoloNameFromAnnotation(d: Record<string, unknown>): string | undefined {
  const proj = (d.project_name || d.subset_name) as string
  const exportName = _has(d.export_name) ? (d.export_name as string) : undefined
  return exportName ?? (_has(proj) ? `${proj}-yolo` : undefined)
}
// Nom de fichier sans extension (pour dériver un nom de run depuis un chemin de modèle).
function _baseNoExt(p: unknown): string { return _base(p).replace(/\.[^./\\]+$/, '') }

function edgeTransit(src: Node | undefined, tgt: Node | undefined): string {
  if (!src || !tgt) return 'None'
  const s = src.data?.node_type as string, t = tgt.data?.node_type as string
  const d = (src.data ?? {}) as Record<string, unknown>
  const proj = (d.project_name || d.subset_name) as string
  // Mode FREE (Annotation sans arête entrante) : la sélection d'un export déjà
  // produit (bouton sur le node → NodeConfigPanel, cf. AppNode.tsx/
  // NodeConfigPanel.tsx) pose `export_name`, JAMAIS `project_name` — que ce
  // bloc ne lisait pas du tout (bug rapporté :
  // le câble restait bloqué sur "annotations : None" après sélection en FREE,
  // et le port GT (.ver) semblait pourtant "branché" par ailleurs). En mode
  // FREE, `export_name` est déjà le nom EXACT de l'artefact existant → pas de
  // suffixe "-yolo" à lui recoller (contrairement au mode LOCKED, où `proj` ne
  // prédit qu'un nom FUTUR, pas encore exporté).
  const exportName = _has(d.export_name) ? (d.export_name as string) : undefined
  const yoloName = exportName ?? (_has(proj) ? `${proj}-yolo` : undefined)
  const annotDisplayName = exportName ?? proj
  if (s === 'model')                                return _has(d.model_path) ? `modèle : ${_base(d.model_path)}` : 'modèle : à définir'
  if (s === 'dataset_source' && t === 'explorer')       return _has(d.dataset_name) ? `dataset : ${d.dataset_name}` : 'dataset : None'
  if (s === 'dataset_source' && t === 'inference')  return _has(d.dataset_name) ? `séquence : ${d.dataset_name}` : 'séquence : None'
  if (s === 'explorer' && t === 'explorer')                 return _has(d.dataset_name) ? `dataset : ${d.dataset_name}` : 'dataset : None'
  if (s === 'explorer' && t === 'annotation')           return _has(d.subset_name)  ? `subset : ${d.subset_name}`   : 'subset : None'
  if (s === 'dataset_source' && t === 'annotation') return _has(d.dataset_name) ? `images : ${d.dataset_name}`  : 'images : None'
  if (s === 'annotation' && t === 'training')       return yoloName ? `dataset YOLO : ${yoloName}` : 'annotations : None'
  if (s === 'annotation' && t === 'optuna')         return yoloName ? `dataset YOLO : ${yoloName}` : 'annotations : None'
  if (s === 'annotation' && t === 'inference')      return _has(annotDisplayName) ? `images + GT : ${annotDisplayName}` : 'images + GT : None'
  if (s === 'annotation' && t === 'dvc')            return yoloName ? `dataset YOLO : ${yoloName}` : 'dataset : None'
  if (s === 'training'   && t === 'inference')      return _has(d.model_path) ? `modèle : ${_base(d.model_path)}` : 'modèle : best.pt'
  if (s === 'training'   && t === 'dvc')            return _has(d.model_path) ? `modèle : ${_base(d.model_path)}` : 'modèle : best.pt'
  if (s === 'training'   && t === 'optuna')         return 'baseline (référence)'
  if (s === 'optuna'     && t === 'training') {
    if (_has(d.best_params))       return `best params : ${d.best_params}`
    if (Array.isArray(d.optimize) && d.optimize.length) return `optimise : ${(d.optimize as string[]).join(', ')} → best params`
    return 'best params : à définir'
  }
  if (s === 'inference' && (t === 'annotation' || t === 'explorer')) return _has(d.acq_name) ? `images acquises : ${d.acq_name}` : 'images acquises : None'
  if (t === 'dvc') return 'dataset + modèle'
  return 'None'
}

// Injecte dans le nœud MLflow (superviseur) la liste des runs QUI SERONT loggés,
// dérivée du graphe : chaque Training + chaque Inference/Éval LOCKED logue un run
// déterministe {graphe}/{label}. Calcul dérivé, appliqué au rendu seulement (step 1-D).
function injectMlflowPreview(nodes: Node[], edges: Edge[], graphName: string): Node[] {
  const hasMlflow = nodes.some(n => (n.data?.node_type as string) === 'mlflow')
  if (!hasMlflow) return nodes
  const planned = nodes
    .filter(n => {
      const t = n.data?.node_type as string
      if (t === 'training') return true
      if (t === 'inference') return edges.some(e => e.target === n.id) // LOCKED = eval/infer -> logue
      return false
    })
    .map(n => ({
      label: (n.data?.label as string) || (n.data?.node_type as string),
      kind: n.data?.node_type as string,
      run: `${graphName || 'graphe'}/${(n.data?.label as string) || (n.data?.node_type as string)}`,
    }))
  return nodes.map(n => (n.data?.node_type as string) === 'mlflow'
    ? { ...n, data: { ...n.data, planned_runs: planned } }
    : n)
}

// Injecte dans le(s) nœud(s) DVC l'aperçu de ce qui sera RÉELLEMENT commité. Le port
// "artefact" accepte n'importe quel type de nœud amont (training/inference/explorer/optuna/
// annotation) — mais quel que soit le nœud branché DIRECTEMENT, DVC commite TOUJOURS le
// même triplet, dérivé en remontant TOUS les ancêtres (comme le backend) : le dataset
// YOLO (ancêtre annotation), le modèle .pt (ancêtre training, s'il y en a un) et un
// snapshot JSON du graphe entier. Le nœud branché directement ne fixe QUE l'ordre
// d'exécution (DVC doit s'exécuter après lui), pas le contenu du commit.
// step6 : DVC = OBSERVATEUR. Il n'est plus branché — il OBSERVE tout le graphe et
// liste les artefacts récupérables/versionnables selon les nodes PRÉSENTS (peu importe
// les arêtes). Le hub (DvcConfig, panneau) résout les vrais chemins + download + commit.
function injectDvcPreview(nodes: Node[], _edges: Edge[]): Node[] {
  const hasDvc = nodes.some(n => (n.data?.node_type as string) === 'dvc')
  if (!hasDvc) return nodes
  const has = (t: string) => nodes.some(n => (n.data?.node_type as string) === t)
  const artifacts = [
    { kind: 'dataset',     present: has('annotation') || has('explorer') || has('dataset_source'), label: 'Dataset (subset / images)' },
    { kind: 'annotations', present: has('annotation'), label: 'Annotations (YOLO + .ver)' },
    { kind: 'model',       present: has('training'),   label: 'Best model (.pt)' },
    { kind: 'optuna',      present: has('optuna'),     label: 'Meilleurs params Optuna' },
    { kind: 'metrics',     present: has('inference'),  label: 'Métriques Inférence / Éval' },
    { kind: 'graph',       present: true,              label: 'Snapshot du graphe' },
  ]
  return nodes.map(n => (n.data?.node_type as string) === 'dvc'
    ? { ...n, data: { ...n.data, dvc_artifacts: artifacts } } : n)
}

// Bounding-box approximative d'un nœud (position + dimensions mesurées par
// ReactFlow, avec fallback tant que le nœud n'a pas encore été mesuré au 1er
// render) — sert d'obstacle au moteur de routage (routing.ts). _NODE_W/_NODE_H
// remontés plus haut dans le fichier (voir commentaire là-bas).
function _nodeRect(n: Node): Rect {
  return {
    id: n.id, x: n.position.x, y: n.position.y,
    width: n.measured?.width ?? _NODE_W, height: n.measured?.height ?? _NODE_H,
  }
}

// ── Position RÉELLE des ports (branchements) ────────────────────────────────
// NodePorts.tsx rend ses ports dans une section de hauteur VARIABLE selon le
// contenu du node (header, champs de config…) et selon le nombre de ports —
// aucune formule géométrique fiable ne peut donc prédire où tombe un port
// donné à partir de la seule bounding-box du node. `getInternalNode(id).
// internals.handleBounds` expose la mesure RÉELLE (DOM) de chaque Handle,
// faite par ReactFlow lui-même — la MÊME donnée qui alimente sourceX/sourceY/
// targetX/targetY reçus par OrthogonalEdge. En s'alignant dessus (au lieu
// d'une approximation bas-de-node ou centre-de-node), le "branchement" utilisé
// pour aligner deux nœuds ou décider du mode de tracé (direct/zbend/couloir)
// est EXACTEMENT celui qui sera dessiné — plus aucun écart possible entre la
// décision et le rendu réel.
type HandleBoundsEntry = { id?: string | null; y: number; height: number }
type GetInternalNode = (id: string) => {
  internals?: { handleBounds?: { source: HandleBoundsEntry[] | null; target: HandleBoundsEntry[] | null } | null }
} | undefined

// Décalage vertical (repère du node, avant translation) du CENTRE d'un port
// précis. `null` tant que le node n'a pas encore été mesuré (1er render) ou si
// aucun Handle ne porte cet id — l'appelant doit alors se rabattre sur une
// approximation géométrique.
function _handleOffset(
  getInternalNode: GetInternalNode, nodeId: string, handleId: string | null | undefined, kind: 'source' | 'target',
): number | null {
  const list = getInternalNode(nodeId)?.internals?.handleBounds?.[kind]
  if (!list || !list.length) return null
  const h = list.find(b => b.id === handleId) ?? (list.length === 1 ? list[0] : undefined)
  return h ? h.y + h.height / 2 : null
}

// Décore les arêtes : résout les handles source/cible (les nœuds ont plusieurs
// ports maintenant) + label lisible + couleur DÉRIVÉE du type de port réel (plus de
// couleur codée en dur par template — source unique de vérité = PORT_STROKE, donc la
// ligne matche TOUJOURS le point coloré du port sur lequel elle est branchée).
// Les arêtes legacy ont sourceHandle/targetHandle = null → on les résout ici pour
// qu'elles s'attachent au bon port. Le calcul GÉOMÉTRIQUE du tracé (direct / Z-bend /
// couloir orthogonal + empilement des couloirs qui se chevauchent) est délégué à
// routing.ts sur la base des bounding-box des nœuds ; le résultat (routeHint) est
// éphémère (recalculé à chaque render, jamais persisté) — OrthogonalEdge s'en sert
// pour construire son tracé réel à partir des coordonnées EXACTES des ports, sauf en
// routeMode='manual' où data.waypoints (fixé par l'utilisateur) prend le dessus et
// n'est jamais écrasé ici.
function decorateEdges(edges: Edge[], nodes: Node[], getInternalNode: GetInternalNode): Edge[] {
  const byId = new Map(nodes.map(n => [n.id, n]))
  const rects = nodes.map(_nodeRect)
  const rectById = new Map(rects.map(r => [r.id, r]))

  const resolved = edges.map(e => {
    const src = byId.get(e.source), tgt = byId.get(e.target)
    const sType = src?.data?.node_type as string, tType = tgt?.data?.node_type as string
    const h = resolveHandles(sType, tType)
    const srcRect = src && rectById.get(src.id), tgtRect = tgt && rectById.get(tgt.id)
    // step 4 : position dans la chaîne d'exécution (adjacent i→i+1 / long i→i+2+
    // / unordered si un des deux nœuds n'a pas de rang, ex. Entrée ou MLflow) —
    // pilote le mode de routage forcé dans decideMode (voir routing.ts).
    const srcOrder0 = src?.data?.exec_order as number | undefined
    const tgtOrder0 = tgt?.data?.exec_order as number | undefined
    const chain: ChainAdjacency =
      srcOrder0 == null || tgtOrder0 == null ? 'unordered'
      : tgtOrder0 === srcOrder0 + 1 ? 'adjacent'
      : 'long'
    // Hauteur du port RÉEL sur lequel cette arête est branchée (cf. _handleOffset
    // ci-dessus) — repli sur le centre du node tant qu'il n'est pas encore mesuré.
    // Décide si direct/zbend/couloir en se basant sur le MÊME point que celui
    // réellement dessiné (sourceX/sourceY côté OrthogonalEdge) : sans ça, un mode
    // "direct" choisi sur une approximation pouvait dessiner une ligne EN DIAGONALE
    // entre deux ports en réalité pas alignés (bug : câble "droit" en apparence dans
    // la logique mais visuellement penché au rendu).
    const srcHandleId = e.sourceHandle ?? h.sourceHandle
    const tgtHandleId = e.targetHandle ?? h.targetHandle
    const srcOff = src ? _handleOffset(getInternalNode, src.id, srcHandleId, 'source') : null
    const tgtOff = tgt ? _handleOffset(getInternalNode, tgt.id, tgtHandleId, 'target') : null
    const sourceY = srcRect ? srcRect.y + (srcOff ?? srcRect.height / 2) : 0
    const targetY = tgtRect ? tgtRect.y + (tgtOff ?? tgtRect.height / 2) : 0
    const decision = srcRect && tgtRect
      ? decideMode(srcRect, tgtRect, rects, srcRect.x + srcRect.width, sourceY, tgtRect.x, targetY, chain)
      : null
    return { e, src, tgt, h, decision, chain }
  })

  // Empile les couloirs dont les plages X se chevauchent (routing.assignLanes),
  // vers le HAUT (chaque niveau soustrait de corridorTopY ci-dessous).
  const corridors = resolved.filter(r => r.decision?.mode === 'corridor')
  const laneOf = assignLanes(corridors.map(r => ({ id: r.e.id, xRange: r.decision!.xRange })))

  return resolved.map(({ e, src, tgt, h, decision, chain }) => {
    const label = edgeTransit(src, tgt)
    const empty = label === 'None' || /: None$|à définir$/.test(label)
    const stroke = h.portType ? PORT_STROKE[h.portType] : '#6366f1'
    const routeHint = decision && {
      mode: decision.mode,
      corridorY: decision.mode === 'corridor'
        ? (decision.corridorTopY ?? 0) - (laneOf.get(e.id) ?? 0) * LANE_SPACING
        : undefined,
    }
    // Adjacence (pour le LABEL uniquement, indépendant du routing `chain` ci-dessus) :
    // i→i+1 classique, MAIS AUSSI Entrée→Application (dataset_source/model n'ont
    // jamais de exec_order → `chain` serait 'unordered' et le label retombait
    // TOUJOURS sur la position secondaire/flottante, même quand Entrée et
    // Application sont posées juste à côté l'une de l'autre — le cas le plus
    // courant). Une Entrée n'alimente jamais qu'UN SEUL node directement en
    // pratique, donc la traiter comme "premier hop" pour le label est toujours
    // correct visuellement, même si elle ne compte pas dans l'ordre d'exécution.
    const labelAdjacent = chain === 'adjacent' || (!!src && isInputNode(src) && (tgt?.data?.exec_order as number | undefined) != null)
    return {
      ...e,
      sourceHandle: e.sourceHandle ?? h.sourceHandle,
      targetHandle: e.targetHandle ?? h.targetHandle,
      type: 'orthogonal',
      data: { ...e.data, routeHint, labelAdjacent },
      style: { stroke, strokeWidth: 2 },
      markerEnd: { type: MarkerType.ArrowClosed, color: stroke },
      label,
      labelShowBg: true,
      labelBgPadding: [6, 3] as [number, number],
      labelBgBorderRadius: 4,
      labelStyle: { fill: empty ? '#94a3b8' : '#6ee7b7', fontSize: 10, fontWeight: 600 },
      labelBgStyle: { fill: '#0f172a', stroke: empty ? '#334155' : '#065f46', strokeWidth: 1, fillOpacity: 0.95 },
    }
  })
}

// ── Status dot ────────────────────────────────────────────────────────────────
function StatusDot({ status }: { status: string }) {
  const cls: Record<string, string> = { idle: 'bg-gray-600', running: 'bg-blue-500 animate-pulse', waiting: 'bg-orange-500 animate-pulse', done: 'bg-green-500', success: 'bg-green-500', failed: 'bg-red-500' }
  return <span className={`w-2 h-2 rounded-full shrink-0 ${cls[status] ?? 'bg-gray-600'}`} />
}

// ── Log panel ─────────────────────────────────────────────────────────────────

export interface LogEntry {
  id: string
  ts: Date
  type: 'info' | 'success' | 'error' | 'warning' | 'human'
  message: string
  detail?: string
  // step2 : rattachement au node (bloc coloré par node dans le panneau de logs).
  node?: string          // id du node
  nodeLabel?: string     // libellé affiché du node
  nodeType?: string      // type du node → couleur du bloc
}

// step2 : couleur du bloc de logs par type de node (barre latérale + titre).
const NODE_LOG_COLOR: Record<string, { bar: string; text: string }> = {
  dataset_source: { bar: 'bg-amber-500',   text: 'text-amber-300' },
  model:          { bar: 'bg-blue-500',    text: 'text-blue-300' },
  explorer:           { bar: 'bg-violet-500',  text: 'text-violet-300' },
  annotation:     { bar: 'bg-rose-500',    text: 'text-rose-300' },
  optuna:         { bar: 'bg-cyan-500',    text: 'text-cyan-300' },
  training:       { bar: 'bg-blue-500',    text: 'text-blue-300' },
  inference:      { bar: 'bg-cyan-500',    text: 'text-cyan-300' },
  dvc:            { bar: 'bg-amber-500',   text: 'text-amber-300' },
  mlflow:         { bar: 'bg-emerald-500', text: 'text-emerald-300' },
}

function logIcon(type: LogEntry['type']) {
  if (type === 'success') return <CheckCircle2 size={11} className="text-emerald-400 shrink-0 mt-0.5" />
  if (type === 'error')   return <XCircle      size={11} className="text-red-400 shrink-0 mt-0.5" />
  if (type === 'warning') return <XCircle      size={11} className="text-orange-400 shrink-0 mt-0.5" />
  if (type === 'human')   return <span className="shrink-0 mt-0.5 text-orange-400 text-[11px] leading-none">⏸</span>
  return <span className="w-1.5 h-1.5 rounded-full bg-gray-500 shrink-0 mt-1.5" />
}

function LogPanel({ logs, onClose }: { logs: LogEntry[]; onClose: () => void }) {
  const bottomRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs.length])

  return (
    <aside className="w-60 xl:w-72 shrink-0 bg-gray-900 border-l border-gray-800 flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-gray-800 shrink-0">
        <ScrollText size={13} className="text-indigo-400" />
        <span className="text-xs font-semibold text-white flex-1">Logs</span>
        <span className="text-[10px] text-gray-600">{logs.length} entrées</span>
        <button onClick={onClose} className="p-0.5 text-gray-600 hover:text-white ml-1"><X size={13} /></button>
      </div>
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-2 text-[11px]">
        {logs.length === 0 && (
          <p className="text-gray-700 text-center py-8">Aucun log — lancez un pipeline</p>
        )}
        <LogBlocks logs={logs} />
        <div ref={bottomRef} />
      </div>
    </aside>
  )
}

// step2/3 : blocs de logs par node, DÉPLIABLES (liste déroulante), code couleur par node.
// Composant PARTAGÉ — réutilisé dans Insights (journal) et Activité (cf. step3) via
// export. `defaultCollapsed` : replie tout par défaut (utile hors du run live).
export function LogBlocks({ logs, defaultCollapsed = false }: { logs: LogEntry[]; defaultCollapsed?: boolean }) {
  // collapsed = set des blocs REPLIÉS (par clé). On mémorise l'inverse selon le défaut.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const toggle = (k: string) => setCollapsed(s => {
    const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n
  })
  const groups = _groupLogsByNode(logs)
  return (
    <div className="space-y-2">
      {groups.map(g => {
        const col = (g.nodeType && NODE_LOG_COLOR[g.nodeType]) || { bar: 'bg-gray-600', text: 'text-gray-400' }
        const isOpen = defaultCollapsed ? collapsed.has(g.key) : !collapsed.has(g.key)
        const nErr = g.entries.filter(e => e.type === 'error').length
        return (
          <div key={g.key} className="rounded-lg overflow-hidden border border-gray-800/80">
            {/* En-tête cliquable = déplie/replie le bloc */}
            <button
              onClick={() => toggle(g.key)}
              className="w-full flex items-center gap-1.5 px-2 py-1 bg-gray-800/60 hover:bg-gray-800 transition-colors"
            >
              {isOpen ? <ChevronDown size={11} className="text-gray-500 shrink-0" /> : <ChevronRight size={11} className="text-gray-500 shrink-0" />}
              <span className={`w-1.5 h-3.5 rounded-sm shrink-0 ${col.bar}`} />
              <span className={`text-[10px] font-semibold truncate ${col.text}`}>{g.title}</span>
              {nErr > 0 && <span className="text-[9px] px-1 rounded bg-red-900/50 text-red-300 shrink-0">{nErr}✕</span>}
              <span className="text-[9px] text-gray-600 ml-auto shrink-0">{g.entries.length}</span>
            </button>
            {isOpen && (
              <div className="px-1.5 py-1 space-y-1 bg-gray-900/40">
                {g.entries.map(e => (
                  <div key={e.id} className={`flex items-start gap-1.5 px-1.5 py-1 rounded ${
                    e.type === 'error'   ? 'bg-red-900/20' :
                    e.type === 'human'   ? 'bg-orange-900/20' :
                    e.type === 'success' ? 'bg-emerald-900/15' : 'bg-gray-800/30'
                  }`}>
                    {logIcon(e.type)}
                    <div className="flex-1 min-w-0">
                      <span className="text-gray-300 leading-snug">{e.message}</span>
                      {e.detail && <p className="text-gray-600 mt-0.5 leading-snug break-words">{e.detail}</p>}
                    </div>
                    <span className="text-gray-700 text-[10px] shrink-0 tabular-nums">
                      {e.ts.toLocaleTimeString('fr', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// step2 : regroupe les entrées de log par node (bloc), en conservant l'ordre de 1re
// apparition pour les blocs et l'ordre chronologique dans chaque bloc. Les entrées
// sans node vont dans un bloc « Pipeline ».
function _groupLogsByNode(logs: LogEntry[]): { key: string; title: string; nodeType?: string; entries: LogEntry[] }[] {
  const order: string[] = []
  const map: Record<string, { key: string; title: string; nodeType?: string; entries: LogEntry[] }> = {}
  for (const e of logs) {
    const key = e.node || '_pipeline'
    if (!map[key]) {
      map[key] = { key, title: e.nodeLabel || (key === '_pipeline' ? 'Pipeline' : key), nodeType: e.nodeType, entries: [] }
      order.push(key)
    }
    map[key].entries.push(e)
  }
  return order.map(k => map[k])
}

let _logId = 0
function makeLog(type: LogEntry['type'], message: string, detail?: string,
                meta?: { node?: string; nodeLabel?: string; nodeType?: string }): LogEntry {
  return { id: String(++_logId), ts: new Date(), type, message, detail, ...meta }
}

function _axiosMessage(e: unknown): string {
  if (e && typeof e === 'object') {
    const resp = (e as Record<string, unknown>).response as Record<string, unknown> | undefined
    if (resp?.data && typeof resp.data === 'object') {
      const detail = (resp.data as Record<string, unknown>).detail
      if (typeof detail === 'string') return detail
    }
    const msg = (e as Record<string, unknown>).message
    if (typeof msg === 'string') return msg
  }
  return String(e)
}

// ── Edge propagation ──────────────────────────────────────────────────────────
// Propagates data along edges (2 passes to handle chains like dataset→explorer→annotation)
function _propagateAllEdges(currentNodes: Node[], currentEdges: Edge[]): Node[] {
  let updated = currentNodes.slice()
  for (let pass = 0; pass < 2; pass++) {
    for (const edge of currentEdges) {
      const src = updated.find(n => n.id === edge.source)
      const tgt = updated.find(n => n.id === edge.target)
      if (!src || !tgt) continue
      const sType = src.data?.node_type as string
      const tType = tgt.data?.node_type as string
      if (sType === 'dataset_source' && tType === 'explorer' && src.data?.dataset_name) {
        const dn = src.data.dataset_name as string
        updated = updated.map(n => n.id === tgt.id ? { ...n, data: { ...n.data, dataset_name: dn, ..._rederive(n.data, 'subset_name', '_subset_src', dn, s => `subset_${s}`) } } : n)
      } else if (sType === 'explorer' && tType === 'explorer' && src.data?.dataset_name) {
        const dn = src.data.dataset_name as string, ps = src.data.subset_name as string
        updated = updated.map(n => n.id === tgt.id ? { ...n, data: { ...n.data, dataset_name: dn, ..._rederive(n.data, 'subset_name', '_subset_src', ps, s => `subset_${s}`) } } : n)
      } else if (sType === 'explorer' && tType === 'annotation' && src.data?.subset_name) {
        const ss = src.data.subset_name as string
        updated = updated.map(n => n.id === tgt.id ? { ...n, data: { ...n.data, subset_name: ss, ..._rederive(n.data, 'project_name', '_project_src', ss, s => `Annot_${s}`) } } : n)
      } else if (sType === 'dataset_source' && tType === 'annotation' && src.data?.dataset_name) {
        const dn = src.data.dataset_name as string
        updated = updated.map(n => n.id === tgt.id ? { ...n, data: { ...n.data, subset_name: dn, ..._rederive(n.data, 'project_name', '_project_src', dn, s => `Annot_${s}`) } } : n)
      } else if (sType === 'dataset_source' && tType === 'inference' && src.data?.dataset_path) {
        updated = updated.map(n => n.id === tgt.id ? { ...n, data: { ...n.data, sequence_dir: src.data.dataset_path } } : n)
      } else if (sType === 'annotation' && tType === 'training') {
        const yn = _yoloNameFromAnnotation(src.data as Record<string, unknown>)
        if (yn) {
          updated = updated.map(n => n.id === tgt.id ? { ...n, data: { ...n.data, ..._rederive(n.data, 'run_label', '_run_label_src', yn, s => `best_${s}`) } } : n)
        }
      } else if (sType === 'optuna' && tType === 'training') {
        updated = updated.map(n => n.id === src.id
          ? { ...n, data: { ...n.data, engine: tgt.data?.engine } } : n)
      } else if (sType === 'model' && tType === 'training') {
        const mn = _has(src.data?.model_path) ? _baseNoExt(src.data.model_path) : undefined
        updated = updated.map(n => n.id === tgt.id ? { ...n, data: { ...n.data, engine: src.data.engine, model_size: src.data.model_size,..._rederive(n.data, 'run_label', '_run_label_src', mn, s => `best_${s}`) } } : n)
      } else if (sType === 'model' && tType === 'inference' && src.data?.model_path) {
        updated = updated.map(n => n.id === tgt.id ? { ...n, data: { ...n.data, model_path: src.data.model_path, engine: src.data.engine || 'yolox', model_size: src.data.model_size || '' } } : n)
      } else if (sType === 'training' && tType === 'inference') {
        updated = updated.map(n => n.id === tgt.id ? { ...n, data: { ...n.data, engine: src.data.engine || 'yolox', model_size: src.data.model_size || '' } } : n)
      }
    }
  }
  return updated
}

// ── Graph selector ────────────────────────────────────────────────────────────
function GraphSelector({ graphs, activeId, onSelect, onCreate, onDuplicate, onDelete }: {
  graphs: SandGraph[]; activeId: string | null
  onSelect: (id: string) => void; onCreate: () => void
  onDuplicate: (id: string) => void; onDelete: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const active = graphs.find(g => g.graph_id === activeId)
  return (
    <div className="relative">
      <button onClick={() => setOpen(o => !o)} className="flex items-center gap-2 px-3 py-1.5 bg-gray-800 hover:bg-gray-750 border border-gray-700 rounded-lg text-sm text-white min-w-[160px]">
        <span className="flex-1 text-left truncate">{active?.name ?? 'Aucun graphe'}</span>
        <ChevronDown size={13} className="text-gray-400 shrink-0" />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 w-64 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl z-50 overflow-hidden">
          <button onClick={() => { onCreate(); setOpen(false) }} className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-indigo-400 hover:bg-indigo-900/20 border-b border-gray-800">
            <Plus size={14} /> Nouvelle expérience
          </button>
          <div className="max-h-72 overflow-y-auto">
            {graphs.length === 0 ? (
              <p className="px-3 py-4 text-xs text-gray-600 text-center">Aucune expérience</p>
            ) : (
              graphs.map(g => (
                <div key={g.graph_id} className={`flex items-center gap-2 px-3 py-2 hover:bg-gray-800/60 cursor-pointer group ${g.graph_id === activeId ? 'bg-indigo-900/20' : ''}`} onClick={() => { onSelect(g.graph_id); setOpen(false) }}>
                  <StatusDot status={g.status} />
                  <span className="flex-1 text-sm text-gray-200 truncate">{g.name}</span>
                  <button onClick={e => { e.stopPropagation(); onDuplicate(g.graph_id) }} className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-white p-0.5" title="Dupliquer"><Copy size={11} /></button>
                  <button onClick={e => { e.stopPropagation(); onDelete(g.graph_id) }} className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400 p-0.5" title="Supprimer"><Trash2 size={11} /></button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Écran de lancement des apps (step 3) ──────────────────────────────────────
// Quand un run auto-lance des apps hors-ligne (séquentiellement), on affiche une
// carte flottante qui liste chaque app et son état (démarrage → prête), en pollant
// /api/apps. Auto-disparaît quand tout est prêt. Le graphe reste visible dessous.
const _LAUNCH_KEY_TO_ID: Record<string, string> = {
  'Dataset_Explorer_App': 'explorer', 'Annotation_App': 'annotation', 'Training_App': 'training',
  'Inference_App': 'inference', 'dvc-app': 'dvc', 'mlflow-app': 'mlflow', 'optuna-app': 'optuna',
}
const _LAUNCH_META: Record<string, { label: string; Icon: typeof Eye; color: string }> = {
  'Dataset_Explorer_App':   { label: 'Dataset Explorer',    Icon: Eye,       color: 'text-violet-400' },
  'Annotation_App': { label: 'Annotation App',  Icon: Tag,       color: 'text-rose-400' },
  'Training_App':   { label: 'Training App',    Icon: Zap,       color: 'text-blue-400' },
  'Inference_App':  { label: 'Inference App',   Icon: Crosshair, color: 'text-cyan-400' },
  'dvc-app':        { label: 'DVC App',         Icon: GitBranch, color: 'text-amber-400' },
  'mlflow-app':     { label: 'MLflow App',      Icon: TrendingUp,color: 'text-emerald-400' },
  'optuna-app':     { label: 'Optuna App',      Icon: Settings2, color: 'text-cyan-400' },
}
function LaunchOverlay({ appKeys, onClose }: { appKeys: string[]; onClose: () => void }) {
  const { data: apps = {} } = useQuery({ queryKey: ['apps'], queryFn: launcherAPI.list, refetchInterval: 3000 })
  const rows = appKeys.map(k => {
    const meta = _LAUNCH_META[k] ?? { label: k, Icon: Zap, color: 'text-gray-400' }
    const status = apps[_LAUNCH_KEY_TO_ID[k]]?.status ?? 'starting'
    return { k, ...meta, status }
  })
  const allUp = rows.length > 0 && rows.every(r => r.status === 'running')
  useEffect(() => {
    if (allUp) { const t = setTimeout(onClose, 1200); return () => clearTimeout(t) }
  }, [allUp, onClose])

  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 w-80 bg-gray-900/95 backdrop-blur border border-gray-700 rounded-2xl shadow-2xl p-4">
      <div className="flex items-center gap-2 mb-1">
        {allUp
          ? <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />
          : <Loader2 size={16} className="animate-spin text-indigo-400 shrink-0" />}
        <h3 className="text-sm font-semibold text-white flex-1">
          {allUp ? 'Applications prêtes' : 'Démarrage des applications…'}
        </h3>
        <button onClick={onClose} className="text-gray-600 hover:text-white shrink-0"><X size={14} /></button>
      </div>
      <p className="text-[11px] text-gray-500 mb-3 leading-relaxed">
        Les apps hors-ligne se lancent une par une. Le pipeline démarre dès qu'elles répondent.
      </p>
      <div className="space-y-1.5">
        {rows.map(r => {
          const Icon = r.Icon
          const done = r.status === 'running'
          const err = r.status === 'error'
          return (
            <div key={r.k} className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg bg-gray-800/50 border border-gray-800">
              <span className={`shrink-0 ${r.color}`}><Icon size={14} /></span>
              <span className="flex-1 text-xs text-gray-200 truncate">{r.label}</span>
              {done
                ? <span className="flex items-center gap-1 text-[10px] text-emerald-400"><CheckCircle2 size={12} /> prête</span>
                : err
                  ? <span className="flex items-center gap-1 text-[10px] text-red-400"><XCircle size={12} /> erreur</span>
                  : <span className="flex items-center gap-1 text-[10px] text-amber-400"><Loader2 size={11} className="animate-spin" /> démarrage…</span>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Waiting banner ────────────────────────────────────────────────────────────
function WaitingBanner({ hint, nextLabel, appUrl, appLabel, onResume, isPending, blocked, blockedReason, children }: {
  hint: string; nextLabel?: string; appUrl: string; appLabel: string; onResume: () => void; isPending: boolean
  blocked?: boolean; blockedReason?: string; children?: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-3 p-3 bg-orange-950/60 border border-orange-500/30 rounded-xl">
      <span className="text-orange-400 mt-0.5">⏸</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-orange-300">Intervention requise</p>
        {hint && <p className="text-xs text-orange-400/80 mt-1 leading-relaxed">{hint}</p>}
        {children}
        {blocked && blockedReason && <p className="text-xs text-orange-300 mt-1.5 font-medium">{blockedReason}</p>}
        <div className="flex items-center gap-3 mt-2">
          {appUrl && <a href={appUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs font-medium text-indigo-400 hover:text-indigo-300">Ouvrir {appLabel} →</a>}
          <button onClick={onResume} disabled={isPending || blocked} className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-500 hover:bg-orange-400 disabled:opacity-50 text-white text-xs font-semibold rounded-lg">
            {isPending ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}
            Terminé → Continuer
          </button>
          {/* step1 : aperçu de ce qui se passe après avoir cliqué Continuer. */}
          {nextLabel && <span className="text-[11px] text-orange-300/70 truncate">→ ensuite : <span className="font-medium text-orange-200">{nextLabel}</span></span>}
        </div>
      </div>
    </div>
  )
}

// ── Choix d'annotation à l'exécution (step 6 — Annotation Locked + Manuel) ────
// Contrairement au mode FREE (choix cosmétique avant même de lancer), ici le
// choix se fait PENDANT la pause du gate "annoter" : liste les exports déjà
// produits pour CE projet (.ver / YOLO, 2 couleurs distinctes), et bloque le
// bouton Continuer tant qu'aucun n'est sélectionné.
type ExportItem = { name: string; format: 'yolo' | 'ver'; created_at: string }
function AnnotationWaitingChoice({ node, onPick }: { node: Node; onPick: (name: string) => void }) {
  const d = node.data as Record<string, unknown>
  const proj = (((d.project_name as string) || (d.subset_name as string)) ?? '').trim().toLowerCase()
  const all = (d.available_exports ?? []) as ExportItem[]
  const items = proj ? all.filter(e => e.name.toLowerCase().startsWith(proj)) : all
  const verItems = items.filter(e => e.format === 'ver')
  const yoloItems = items.filter(e => e.format === 'yolo')
  const current = d.export_name as string | undefined
  return (
    <div className="mt-2 space-y-1.5">
      <p className="text-xs font-semibold text-orange-300">Choisissez votre annotation avant de continuer.</p>
      {items.length === 0 ? (
        <p className="text-[11px] text-orange-400/70 italic">Aucun export encore disponible pour « {(d.project_name as string) || (d.subset_name as string) || 'ce projet'} » — annotez puis exportez depuis Annotation_App, la liste se mettra à jour.</p>
      ) : (
        <div className="space-y-1">
          {[{ label: '.ver (GT natif)', dot: 'bg-teal-400', list: verItems }, { label: 'Dataset YOLO', dot: 'bg-rose-400', list: yoloItems }].map(group => (
            group.list.length > 0 && (
              <div key={group.label} className="space-y-0.5">
                <p className="text-[10px] text-gray-500">{group.label}</p>
                {group.list.map(it => (
                  <button key={it.name} onClick={() => onPick(it.name)}
                    className={`w-full flex items-center gap-1.5 px-2 py-1 rounded text-left border ${it.name === current ? 'border-emerald-600/60 bg-emerald-950/30' : 'border-gray-800 bg-gray-900/60 hover:bg-gray-800/60'}`}>
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${group.dot}`} />
                    <span className="flex-1 text-xs text-gray-200 truncate">{it.name}</span>
                    {it.name === current && <CheckCircle2 size={12} className="text-emerald-400 shrink-0" />}
                  </button>
                ))}
              </div>
            )
          ))}
        </div>
      )}
    </div>
  )
}

// ── Choix de subset à l'exécution (step 7 — explorer Locked + Manuel) ─────────────
// MÊME logique que AnnotationWaitingChoice (step 6), réappliquée à explorer : un
// seul format (subset), donc une seule couleur (violet, cohérente avec le port
// "subset" — cf. PORT_STROKE/ports.ts) au lieu de deux groupes.
type SubsetItem = { name: string; image_count: number }
function VisuWaitingChoice({ node, onPick }: { node: Node; onPick: (name: string) => void }) {
  const d = node.data as Record<string, unknown>
  const items = (d.available_subsets ?? []) as SubsetItem[]
  const current = d.subset_name as string | undefined
  return (
    <div className="mt-2 space-y-1.5">
      <p className="text-xs font-semibold text-orange-300">Choisissez votre subset avant de continuer.</p>
      {items.length === 0 ? (
        <p className="text-[11px] text-orange-400/70 italic">Aucun subset encore disponible — créez-le dans Dataset_Explorer_App, la liste se mettra à jour.</p>
      ) : (
        <div className="space-y-0.5">
          {items.map(it => (
            <button key={it.name} onClick={() => onPick(it.name)}
              className={`w-full flex items-center gap-1.5 px-2 py-1 rounded text-left border ${it.name === current ? 'border-emerald-600/60 bg-emerald-950/30' : 'border-gray-800 bg-gray-900/60 hover:bg-gray-800/60'}`}>
              <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-violet-400" />
              <span className="flex-1 text-xs text-gray-200 truncate">{it.name}</span>
              <span className="text-[10px] text-gray-500 shrink-0">{it.image_count} img</span>
              {it.name === current && <CheckCircle2 size={12} className="text-emerald-400 shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Bandeau de fork : montre la DIVERGENCE avant relance ──────────────────────
// Compare les params du graphe courant au snapshot du parent (fige au fork). Rend
// explicite "ce qui reste identique" vs "ce qui change" — repond au besoin de voir
// la divergence AVANT de lancer.
function ForkDivergenceBanner({ fork, nodes }: { fork: ForkProvenance; nodes: Node[] }) {
  // Ouvert d'office seulement s'il y a la place : sur un portable, deplie il
  // occupait la moitie de la hauteur utile du canvas.
  const [open, setOpen] = useState(() => typeof window === 'undefined' || window.innerHeight >= 900)
  const byId = new Map(nodes.map(n => [n.id, n]))
  const rows: { label: string; key: string; base: unknown; now: unknown; changed: boolean }[] = []
  for (const sn of fork.snapshot ?? []) {
    const curData = (byId.get(sn.node_id)?.data ?? {}) as Record<string, unknown>
    for (const [k, base] of Object.entries(sn.params ?? {})) {
      const now = curData[k]
      rows.push({ label: sn.label, key: k, base, now, changed: JSON.stringify(now ?? '') !== JSON.stringify(base ?? '') })
    }
  }
  const changed = rows.filter(r => r.changed)
  const same = rows.filter(r => !r.changed)
  const fmt = (v: unknown) => (v === undefined || v === '' || v === null) ? '—' : (typeof v === 'object' ? JSON.stringify(v) : String(v))

  // Precheck du piege de reutilisation : un node explorer/annotation dont un param a
  // change MAIS dont le nom de sortie (subset_name/project_name) est INCHANGE ->
  // au lancement l'artefact existant sera reutilise/ecrase, pas regenere proprement.
  const NAME_KEY: Record<string, string> = { explorer: 'subset_name', annotation: 'project_name' }
  const risks: { label: string; nameKey: string; name: string }[] = []
  for (const sn of fork.snapshot ?? []) {
    const nk = NAME_KEY[sn.node_type]
    if (!nk) continue
    const cur = (byId.get(sn.node_id)?.data ?? {}) as Record<string, unknown>
    const nameUnchanged = JSON.stringify(cur[nk] ?? '') === JSON.stringify(sn.params?.[nk] ?? '')
    const otherChanged = Object.entries(sn.params ?? {}).some(
      ([k, v]) => k !== nk && JSON.stringify(cur[k] ?? '') !== JSON.stringify(v ?? ''))
    if (nameUnchanged && otherChanged) risks.push({ label: sn.label, nameKey: nk, name: String(cur[nk] ?? '') })
  }

  return (
    <div className="px-4 py-2 border-b border-indigo-800/30 bg-indigo-950/20 shrink-0 text-xs">
      <button onClick={() => setOpen(v => !v)} className="flex flex-wrap items-center gap-x-2 gap-y-1 w-full text-left">
        <GitBranch size={13} className="text-indigo-300 shrink-0" />
        <span className="font-semibold text-indigo-200 shrink-0">Fork de {fork.run_id?.slice(0, 6) ?? '?'}</span>
        <span className="text-gray-400 min-w-0 truncate">
          base figée : dataset <span className="font-mono text-gray-300">{fork.dataset ?? '—'}</span>
          {fork.git_commit ? <> @ <span className="font-mono text-gray-300">{fork.git_commit.slice(0, 8)}</span></> : null}
          {typeof fork.map50 === 'number' ? <> · mAP50 parent <span className="font-mono text-emerald-300">{fork.map50.toFixed(4)}</span></> : null}
        </span>
        <span className={`ml-auto shrink-0 px-2 py-0.5 rounded-full border font-semibold ${
          changed.length ? 'bg-amber-900/30 text-amber-300 border-amber-700/40' : 'bg-gray-800 text-gray-400 border-gray-700'
        }`}>
          {changed.length ? `${changed.length} paramètre(s) divergent(s)` : 'identique au parent'}
        </span>
        <span className="text-gray-600">{open ? '▲' : '▼'}</span>
      </button>

      {/* Precheck : piege de reutilisation (param change mais nom de sortie identique) */}
      {risks.length > 0 && (
        <div className="mt-2 bg-red-950/40 border border-red-700/50 rounded-lg px-3 py-2 text-red-200">
          <div className="flex items-center gap-1.5 font-semibold text-red-300">
            <XCircle size={13} /> Attention : la modification ne sera pas prise en compte
          </div>
          <ul className="mt-1 space-y-0.5 text-[11px] text-red-200/90 list-disc list-inside">
            {risks.map((r, i) => (
              <li key={i}>
                <b>{r.label}</b> : des params ont changé mais <span className="font-mono">{r.nameKey}</span> =
                <span className="font-mono"> {r.name}</span> est inchangé. Le run va <b>réutiliser/écraser</b> l'artefact
                existant au lieu d'en créer un nouveau. Renomme <span className="font-mono">{r.nameKey}</span> pour forcer une nouvelle version.
              </li>
            ))}
          </ul>
        </div>
      )}

      {open && rows.length > 0 && (
        <div className="mt-2 grid grid-cols-1 xl:grid-cols-2 gap-1.5 max-h-40 overflow-y-auto pr-1">
          {changed.map((r, i) => (
            <div key={`c${i}`} className="min-w-0 bg-amber-950/20 border border-amber-800/30 rounded px-2 py-1" title={`${r.label} · ${r.key} : ${fmt(r.base)} -> ${fmt(r.now)}`}>
              <div className="flex items-baseline gap-2 min-w-0">
                <span className="text-amber-300 font-medium truncate max-w-[45%]">{r.label}</span>
                <span className="text-gray-500 font-mono truncate">{r.key}</span>
              </div>
              <div className="flex items-baseline gap-1.5 min-w-0">
                <span className="font-mono text-gray-400 truncate max-w-[45%]">{fmt(r.base)}</span>
                <span className="text-amber-400 shrink-0">{'->'}</span>
                <span className="font-mono text-amber-200 truncate">{fmt(r.now)}</span>
              </div>
            </div>
          ))}
          {same.map((r, i) => (
            <div key={`s${i}`} className="flex items-baseline gap-2 min-w-0 bg-gray-900/40 border border-gray-800 rounded px-2 py-1 opacity-70" title={`${r.label} · ${r.key} : ${fmt(r.base)}`}>
              <span className="text-gray-400 truncate max-w-[40%]">{r.label}</span>
              <span className="text-gray-600 font-mono truncate">{r.key}</span>
              <span className="ml-auto font-mono text-gray-500 truncate max-w-[40%]">{fmt(r.base)}</span>
              <span className="text-gray-700 text-[10px] shrink-0">inchangé</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Outer wrapper (provides ReactFlowProvider) ────────────────────────────────
export default function SandgraphPage() {
  return (
    <ReactFlowProvider>
      <SandgraphInner />
    </ReactFlowProvider>
  )
}

// ── Inner component (has access to useReactFlow) ──────────────────────────────
function SandgraphInner() {
  const t = useT()
  const qc = useQueryClient()
  const { screenToFlowPosition, fitView, getInternalNode } = useReactFlow()
  const [routeParams] = useSearchParams()
  const routedGraphId = routeParams.get('graph_id')

  const workspaceScope = useWorkspaceStorageScope()
  const { data: graphs = [] } = useQuery({
    queryKey: ['graphs', workspaceScope],
    queryFn: graphsAPI.list,
    enabled: Boolean(workspaceScope),
    refetchInterval: 5000,
  })
  // Never bootstrap from the old origin-global key. The remembered graph is
  // loaded only after /api/settings identifies the current workspace.
  const [activeId, setActiveId] = useState<string | null>(() => routedGraphId)
  const activeScopeHydrated = useRef<string | null>(null)
  const activeGraph = graphs.find(g => g.graph_id === activeId) ?? null
  const isRunning = activeGraph?.status === 'running'
  const isWaiting = activeGraph?.status === 'waiting'

  const [nodes, setNodes] = useState<Node[]>([])
  const [edges, setEdges] = useState<Edge[]>([])
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  // Bouton « Choisir un subset/export » sur le node (AppNode.tsx) : sélectionne
  // le node (ouvre NodeConfigPanel) ET demande au bloc concerné (VisuConfig/
  // AnnotationConfig) de se faire remarquer — scroll + halo 3s — au lieu de
  // forcer l'utilisateur à chercher la bonne section dans le panneau. `ts`
  // change à CHAQUE clic (même node déjà sélectionné) pour redéclencher l'effet.
  const [pickerFocus, setPickerFocus] = useState<{ nodeId: string; ts: number } | null>(null)
  const [dirty, setDirty] = useState(false)
  const [logs, setLogs] = useState<LogEntry[]>([])
  // Empêche les effets de persistance d'écraser les caches avec les états vides
  // du tout premier render quand la page Sandgraph est remontée après navigation.
  const logsHydratedGraph = useRef<string | null>(null)
  const skipNextLogPersist = useRef(false)
  const runtimeHydratedGraph = useRef<string | null>(null)
  const [showLogs, setShowLogs] = useState(() => localStorage.getItem('orch_show_logs') === '1')

  // Auto Save + Auto Check (step 2/3) — DEUX toggles INDÉPENDANTS (voir les deux
  // useEffect dédiés plus bas) : Auto Save sauvegarde seul (mêmes erreurs de
  // validation que le bouton manuel) ; Auto Check normalise seul la mise en page
  // (alignApplicationNodes/spaceApplicationNodes). Activer les deux = comportement
  // complet du cahier des charges (normalise PUIS sauvegarde). Persisté
  // globalement (préférence d'usage, pas propre à un graphe).
  const [autoSave, setAutoSave] = useState(() => localStorage.getItem('orch_auto_save') === '1')
  const [autoCheck, setAutoCheck] = useState(() => localStorage.getItem('orch_auto_check') === '1')
  useEffect(() => { localStorage.setItem('orch_auto_save', autoSave ? '1' : '0') }, [autoSave])
  useEffect(() => { localStorage.setItem('orch_auto_check', autoCheck ? '1' : '0') }, [autoCheck])

  function addLog(type: LogEntry['type'], message: string, detail?: string,
                  meta?: { node?: string; nodeLabel?: string; nodeType?: string }) {
    setLogs(ls => [...ls.slice(-199), makeLog(type, message, detail, meta)])
  }

  // ── Type MLOps derive EN DIRECT des nodes locaux (avant meme un save) ─────────
  // mlops = un node MLflow ET un node DVC (paire couplee). On derive du live pour
  // reagir a l'edition immediate ; la verite backend (activeGraph.mlops) est
  // identique une fois sauvegarde.
  const mlops = useMemo(
    () => deriveMlops(nodes as { data?: { node_type?: string }; type?: string }[]),
    [nodes],
  )

  // Couplage MLflow/DVC : ajoute la paire manquante (nodes FREE superviseurs) pour
  // faire passer un graphe "experimental" en "mlops" en un clic.
  const addMlopsPair = useCallback(() => {
    const have = new Set(nodes.map(n => (n.data as { node_type?: string })?.node_type || n.type || ''))
    const missing = (['mlflow', 'dvc'] as const).filter(t => !have.has(t))
    if (missing.length === 0) return
    const baseY = nodes.reduce((m, n) => Math.max(m, n.position?.y ?? 0), 0) + 160
    const minX = nodes.reduce((m, n) => Math.min(m, n.position?.x ?? 0), 0)
    const created: Node[] = missing.map((t, i) => {
      const tb = TOOLBOX_NODES.find(x => x.type === t)!
      return { id: nextNodeId(t), type: t, position: { x: minX + i * 240, y: baseY }, data: { ...tb.defaults } }
    })
    setNodes(ns => [...ns, ...created])
    setDirty(true)
    toast.success(missing.length === 2
      ? t('Suivi MLOps activé : MLflow + DVC ajoutés')
      : `${missing[0] === 'mlflow' ? 'MLflow' : 'DVC'} ${t('ajouté — suivi MLOps complet')}`)
  }, [nodes, setNodes])

  const [, setRunId] = useState<string | null>(null)
  // step 6/7 : le user a-t-il explicitement cliqué un item dans AnnotationWaitingChoice
  // / VisuWaitingChoice PENDANT la pause en cours ? Reset dès qu'un NOUVEAU gate
  // apparaît (cf. useEffect([waitingNodeId]) plus bas).
  const [gateChoicePicked, setGateChoicePicked] = useState(false)
  const [launchingApps, setLaunchingApps] = useState<string[] | null>(null)
  const [, setStepNodeMap] = useState<Record<string, string>>({})
  const [elapsed, setElapsed] = useState(0)
  const elapsedRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const sseCleanup = useRef<(() => void) | null>(null)
  const reconnectedRun = useRef<string | null>(null)   // reconnexion SSE au reload (1 fois/run)

  // Track which graph we've loaded layout for (to avoid overwriting positions on refetch)
  const layoutGraphId = useRef<string | null>(null)
  // Redressement automatique UNE FOIS par graphe chargé (voir l'effet dédié plus
  // bas) — indépendant du toggle Auto Check (§ layoutGraphId ci-dessus).
  const straightenGraphId = useRef<string | null>(null)

  // ── Undo / Redo ────────────────────────────────────────────────────────────
  const historyRef = useRef<{ nodes: Node[]; edges: Edge[] }[]>([])
  const futureRef  = useRef<{ nodes: Node[]; edges: Edge[] }[]>([])
  const nodesRef   = useRef<Node[]>([])
  const edgesRef   = useRef<Edge[]>([])
  // step2 : timing (durée) + dernière phase loggée par étape (dédup des logs epoch/trial).
  const stepTiming = useRef<Record<string, { startTs?: number; lastPhase?: string }>>({})
  useEffect(() => { nodesRef.current = nodes }, [nodes])
  useEffect(() => { edgesRef.current = edges }, [edges])

  const pushHistory = useCallback(() => {
    historyRef.current = [...historyRef.current.slice(-49), { nodes: nodesRef.current, edges: edgesRef.current }]
    futureRef.current = []
  }, [])

  const undo = useCallback(() => {
    if (!historyRef.current.length) return
    const prev = historyRef.current[historyRef.current.length - 1]
    futureRef.current = [{ nodes: nodesRef.current, edges: edgesRef.current }, ...futureRef.current.slice(0, 49)]
    historyRef.current = historyRef.current.slice(0, -1)
    setNodes(prev.nodes); setEdges(prev.edges); setDirty(true)
  }, [])

  const redo = useCallback(() => {
    if (!futureRef.current.length) return
    const next = futureRef.current[0]
    historyRef.current = [...historyRef.current, { nodes: nodesRef.current, edges: edgesRef.current }]
    futureRef.current = futureRef.current.slice(1)
    setNodes(next.nodes); setEdges(next.edges); setDirty(true)
  }, [])

  const { data: appUrls = {} } = useQuery({ queryKey: ['app-urls'], queryFn: graphsAPI.getAppUrls })

  // A workspace can be restarted behind the same localhost origin while this
  // SPA remains mounted in VisionNexus. Reset transient state at the boundary,
  // then restore only this workspace's remembered graph.
  useEffect(() => {
    if (!workspaceScope || activeScopeHydrated.current === workspaceScope) return
    activeScopeHydrated.current = workspaceScope
    const remembered = localStorage.getItem(workspaceStorageKey(workspaceScope, 'active_graph_id'))
    setActiveId(routedGraphId || remembered)
    setNodes([]); setEdges([]); setLogs([])
    layoutGraphId.current = null
    logsHydratedGraph.current = null
    runtimeHydratedGraph.current = null
  }, [workspaceScope, routedGraphId])

  // Persist active graph ID inside the workspace/user namespace.
  useEffect(() => {
    if (activeId && workspaceScope) {
      localStorage.setItem(workspaceStorageKey(workspaceScope, 'active_graph_id'), activeId)
    }
  }, [activeId, workspaceScope])
  // Les liens du Lineage ciblent le Sandgraph exact. Le paramètre prime sur le
  // dernier graphe mémorisé, y compris quand la page est déjà montée.
  useEffect(() => { if (routedGraphId && routedGraphId !== activeId) setActiveId(routedGraphId) }, [routedGraphId, activeId])

  // Load logs from localStorage when switching graphs
  useEffect(() => {
    if (!activeId || !workspaceScope) return
    skipNextLogPersist.current = true
    try {
      const raw = localStorage.getItem(workspaceStorageKey(workspaceScope, `logs_${activeId}`))
      logsHydratedGraph.current = activeId
      if (!raw) { setLogs([]); return }
      const parsed = JSON.parse(raw)
      setLogs(parsed.map((e: Record<string, unknown>) => ({ ...e, ts: new Date(e.ts as string) })))
    } catch { logsHydratedGraph.current = activeId; setLogs([]) }
  }, [activeId, workspaceScope])

  // Persist logs to localStorage
  useEffect(() => {
    if (!activeId || !workspaceScope || logsHydratedGraph.current !== activeId) return
    if (skipNextLogPersist.current) { skipNextLogPersist.current = false; return }
    try {
      const toSave = logs.slice(-200).map(e => ({ ...e, ts: e.ts.toISOString() }))
      localStorage.setItem(workspaceStorageKey(workspaceScope, `logs_${activeId}`), JSON.stringify(toSave))
    } catch { }
  }, [logs, activeId, workspaceScope])

  // Etat du panneau de logs conserve entre changements d'onglet / reload : sans ca
  // le panneau se refermait a chaque retour meme quand les logs etaient bien la.
  useEffect(() => { localStorage.setItem('orch_show_logs', showLogs ? '1' : '0') }, [showLogs])

  // Persiste l'overlay runtime des nodes (timeline sous chaque node) par graphe.
  // activity_steps / result_summary / current_step / progress ne sont JAMAIS
  // persistes cote backend (champs strippes avant save) ni rejoues pour un run
  // TERMINE (active_run_id vide -> pas de reconnexion SSE) : sans ce cache local,
  // changer d'onglet ou recharger vidait la timeline detaillee sous chaque node.
  // Rechargee au montage du graphe (cf. effet de load, branche isFirstLoad).
  useEffect(() => {
    if (!activeId || !workspaceScope || runtimeHydratedGraph.current !== activeId) return
    try {
      const overlay: Record<string, unknown> = {}
      for (const n of nodes) {
        const d = n.data as Record<string, unknown>
        if (d.activity_steps || d.result_summary || d.current_step || d.progress) {
          overlay[n.id] = {
            activity_steps: d.activity_steps,
            result_summary: d.result_summary,
            current_step: d.current_step,
            progress: d.progress,
          }
        }
      }
      const key = workspaceStorageKey(workspaceScope, `nodert_${activeId}`)
      if (Object.keys(overlay).length) localStorage.setItem(key, JSON.stringify(overlay))
      else localStorage.removeItem(key)
    } catch { }
  }, [nodes, activeId, workspaceScope])

  // Scan workspace for existing subsets + exports and inject into nodes
  const refreshWorkspaceOutputs = useCallback(() => {
    graphsAPI.getWorkspaceOutputs().then(({ subsets, exports: exps }) => {
      setNodes(prev => prev.map(n => {
        const ntype = n.data?.node_type as string
        const hasInput = edgesRef.current.some(e => e.target === n.id)
        if (ntype === 'explorer') return { ...n, data: { ...n.data, available_subsets: subsets, has_input: hasInput } }
        if (ntype === 'annotation') return { ...n, data: { ...n.data, available_exports: exps, has_input: hasInput } }
        return { ...n, data: { ...n.data, has_input: hasInput } }
      }))
    }).catch(() => {})
  }, [])

  // On graph load (and when activeId changes)
  useEffect(() => {
    if (!activeId) return
    const timer = setTimeout(() => refreshWorkspaceOutputs(), 500)
    return () => clearTimeout(timer)
  }, [activeId, refreshWorkspaceOutputs])

  // Periodic refresh every 30s — shows new outputs without requiring a run
  useEffect(() => {
    if (!activeId) return
    const interval = setInterval(() => refreshWorkspaceOutputs(), 30_000)
    return () => clearInterval(interval)
  }, [activeId, refreshWorkspaceOutputs])

  // Signature des moteurs portes par les noeuds source (Modele / Optuna).
  const enginesSig = nodes
    .filter(n => ['model', 'optuna', 'training', 'inference'].includes(n.data?.node_type as string))
    .map(n => `${n.id}:${(n.data?.engine as string) ?? ''}:${(n.data?.model_size as string) ?? ''}`)
    .join('|')

  // Sync has_input + input_types + input_handles + exec_order sur tous les nodes
  // quand la topologie change. input_handles (step 5) = ids des ports d'entrée
  // BRANCHÉS sur ce node — nécessaire pour distinguer, ex., "dataset YOLO" de
  // "dataset" sur Inference (les deux ont potentiellement une source de type
  // 'annotation', mais sur des ports différents avec des règles différentes).
  useEffect(() => {
    setNodes(ns => {
      const order = computeExecOrder(ns, edges)
      const typeOf = new Map(ns.map(n => [n.id, n.data?.node_type as string]))
      const engineOf = new Map(ns.map(n => [n.id, n.data?.engine as string | undefined]))
      const sizeOf = new Map(ns.map(n => [n.id, n.data?.model_size as string | undefined]))
      return ns.map(n => {
        const incoming = edges.filter(e => e.target === n.id)
        const parentTypes = incoming.map(e => typeOf.get(e.source)).filter(Boolean) as string[]
        const inputHandles = incoming.map(e => e.targetHandle ?? 'in')
        // Contrat modèle des parents : fige ou contrôle moteur + architecture
        // jusque dans Inference, sans dépendre du nom d'un plugin particulier.
        const inputEngines: Record<string, string> = {}
        const inputModelSizes: Record<string, string> = {}
        for (const e of incoming) {
          const t = typeOf.get(e.source)
          if (t && ['model', 'optuna', 'training', 'inference'].includes(t)) {
            inputEngines[t] = engineOf.get(e.source) || 'yolox'
            inputModelSizes[t] = sizeOf.get(e.source) ?? ''
          }
        }
        return {
          ...n,
          data: { ...n.data, has_input: parentTypes.length > 0, input_types: parentTypes, input_handles: inputHandles, input_engines: inputEngines, input_model_sizes: inputModelSizes, exec_order: order[n.id] },
        }
      })
    })
    // `enginesSig` en dep : moteur/taille peuvent changer sans que la
    // topologie bouge, et figent le consommateur branché.
  }, [edges, enginesSig]) // pas besoin de nodes en dep — functional updater lit le latest state

  // Écoute les mises à jour de données node depuis les nœuds eux-mêmes (ex: toggle full_auto)
  useEffect(() => {
    const handler = (ev: Event) => {
      const { nodeId, data } = (ev as CustomEvent<{ nodeId: string; data: Record<string, unknown> }>).detail
      setNodes(ns => ns.map(n => n.id === nodeId ? { ...n, data: { ...n.data, ...data } } : n))
      setDirty(true)
    }
    window.addEventListener('orch:update-node-data', handler)
    return () => window.removeEventListener('orch:update-node-data', handler)
  }, [])

  // Bouton « Choisir un subset/export existant » sur le node (mode FREE) —
  // sélectionne le node (ouvre NodeConfigPanel) au lieu de la vieille liste
  // toujours affichée directement sur le node (lourd, cf. Bob juillet 2026).
  useEffect(() => {
    const handler = (ev: Event) => {
      const { nodeId } = (ev as CustomEvent<{ nodeId: string }>).detail
      setSelectedNodeId(nodeId)
      setPickerFocus({ nodeId, ts: Date.now() })
    }
    window.addEventListener('orch:open-node-picker', handler)
    return () => window.removeEventListener('orch:open-node-picker', handler)
  }, [])

  // Reset layout tracker when switching graphs
  useEffect(() => { layoutGraphId.current = null }, [activeId])

  // Load / refresh graph data
  useEffect(() => {
    const g = graphs.find(g => g.graph_id === activeId)
    if (!g) return

    const isFirstLoad = layoutGraphId.current !== activeId

    const enrich = (n: Node): Node => ({
      ...n,
      data: {
        ...n.data,
        exec_status: g.execution?.[n.id]?.status ?? 'idle',
        frontend_url: _frontendUrl(n.data?.node_type as string, appUrls),
        waiting_hint: (g.execution?.[n.id]?.result?.['hint'] as string) ?? undefined,
        waiting_next: (g.execution?.[n.id]?.result?.['next_label'] as string) ?? undefined,
        has_input: (g.edges as Edge[]).some(e => e.target === n.id),
      },
    })

    if (isFirstLoad) {
      layoutGraphId.current = activeId
      // Recharge l'overlay runtime (timeline sous les nodes) cache localement au
      // changement d'onglet / reload. Fusionne APRES enrich() pour ne pas ecraser
      // l'exec_status / waiting_hint qui, eux, viennent de la verite backend.
      let rtOverlay: Record<string, Record<string, unknown>> = {}
      try {
        rtOverlay = workspaceScope
          ? JSON.parse(localStorage.getItem(workspaceStorageKey(workspaceScope, `nodert_${activeId}`)) || '{}')
          : {}
      } catch { rtOverlay = {} }
      runtimeHydratedGraph.current = activeId
      const loadedNodes = (g.nodes as Node[]).map(n => {
        const e = enrich(n)
        const rt = rtOverlay[n.id]
        return rt ? { ...e, data: { ...e.data, ...rt } } : e
      })
      const nodeById = new Map(loadedNodes.map(n => [n.id, n]))
      // Backfill sourceHandle/targetHandle une bonne fois pour toutes au chargement
      // (les arêtes de template — ExperimentsPage.tsx — et les vieux graphes
      // sauvegardés n'ont jamais ces champs posés ; decorateEdges les résolvait
      // uniquement pour l'AFFICHAGE, jamais réécrits dans l'état → la validation
      // et isValidConnection lisaient un targetHandle absent). Une fois backfillé
      // ici, tout le reste du code peut faire confiance à e.targetHandle.
      setNodes(loadedNodes)
      setEdges((g.edges as Edge[]).map(e => {
        if (e.sourceHandle && e.targetHandle) return e
        const src = nodeById.get(e.source), tgt = nodeById.get(e.target)
        const h = resolveHandles(src?.data?.node_type as string, tgt?.data?.node_type as string)
        return { ...e, sourceHandle: e.sourceHandle ?? h.sourceHandle, targetHandle: e.targetHandle ?? h.targetHandle }
      }))
      setDirty(false)
    } else {
      // Refetch: only update exec state, preserve local positions/layout
      setNodes(prev => prev.map(n => {
        const execStatus = g.execution?.[n.id]?.status ?? 'idle'
        const hint = (g.execution?.[n.id]?.result?.['hint'] as string) ?? n.data.waiting_hint
        const nextL = (g.execution?.[n.id]?.result?.['next_label'] as string) ?? n.data.waiting_next
        return { ...n, data: { ...n.data, exec_status: execStatus, frontend_url: _frontendUrl(n.data?.node_type as string, appUrls), waiting_hint: hint, waiting_next: nextL } }
      }))
    }
  }, [activeId, graphs, appUrls, workspaceScope])

  // Reconnexion SSE au RECHARGEMENT de page (Bob 2026-07-25) : si on (re)charge un
  // graphe dont le run est TOUJOURS actif (running/waiting) — le backend auto-reset
  // les runs morts, donc ici le run est bien vivant en mémoire — on rebranche le SSE.
  // Le backend rejoue tous les events depuis le début → tray + logs + barres se
  // reconstruisent. Sans ça, recharger pendant un run laissait l'UI figée jusqu'à reprise.
  useEffect(() => {
    const g = graphs.find(gg => gg.graph_id === activeId)
    if (!g) return
    const rid = (g as unknown as Record<string, unknown>).active_run_id as string | undefined
    const snm = (g as unknown as Record<string, unknown>).step_node_map as Record<string, string> | undefined
    const live = g.status === 'running' || g.status === 'waiting'
    if (!rid || !snm || !live) return
    // Attendre que la topologie du graphe courant soit réellement hydratée.
    // Au retour d'un autre onglet, `graphs` arrivait avant les nodes : le flux
    // SSE était marqué reconnecté puis son replay s'appliquait à un tableau vide.
    if (layoutGraphId.current !== activeId || runtimeHydratedGraph.current !== activeId || nodesRef.current.length === 0) return
    if (sseCleanup.current || reconnectedRun.current === rid) return   // déjà branché
    reconnectedRun.current = rid
    // Le cache reste visible pendant la reconnexion. Le replay reconstruit les
    // barres/timelines sans créer un écran vide entre la navigation et le flux.
    setRunId(rid); setStepNodeMap(snm); _applyActivityPlan(snm); setShowLogs(true)
    if (!elapsedRef.current) elapsedRef.current = setInterval(() => setElapsed(e => e + 1), 1000)
    _openSSE(activeId!, rid, snm)
  }, [activeId, graphs, nodes.length, edges.length])

  useEffect(() => { straightenGraphId.current = null }, [activeId])

  // Redressement automatique au premier chargement d'un graphe (step 4 — Bob,
  // juillet 2026) : "le check permet que ça soit droit mais le template importé
  // ne l'est pas". Un graphe créé depuis un template (ExperimentsPage.tsx) hérite
  // des positions Y FIGÉES dans le template — jamais garanties justes, puisque
  // seule la mesure RÉELLE des ports (ci-dessus, _handleOffset) fait foi, et
  // celle-ci évolue avec le contenu affiché par chaque node. Avant ce fix, la
  // chaîne ne devenait droite qu'après une édition + Auto Check actif — jamais
  // à l'ouverture. Indépendant du toggle Auto Check (qui ne régit que les
  // éditions SUIVANTES) : ce passage est la mise en page de BASE, pas une
  // préférence utilisateur. Attend que tous les nodes de la chaîne soient
  // MESURÉS par ReactFlow (measured posé) avant de lancer l'alignement, sinon
  // _handleOffset retomberait sur le repli bas-de-node pour un état qui ne sera
  // jamais recalculé ensuite (le ref garde qu'on ne le fait qu'une fois/graphe).
  useEffect(() => {
    if (!activeId || straightenGraphId.current === activeId) return
    const chainNodes = nodes.filter(isChainNode)
    if (chainNodes.length < 2) return
    if (!chainNodes.every(n => n.measured?.width != null && n.measured?.height != null)) return
    straightenGraphId.current = activeId
    const normalized = normalizeLayout(nodes, edges, getInternalNode)
    const moved = normalized.some((n, i) => n.position.x !== nodes[i].position.x || n.position.y !== nodes[i].position.y)
    if (moved) {
      nodesRef.current = normalized
      setNodes(normalized)
      setDirty(true)
    }
  }, [activeId, nodes, edges, getInternalNode])

  // ── Validation de connexion (par PORT) ─────────────────────────────────────
  // Chaque entrée d'un nœud (NODE_PORTS) déclare les types de source acceptés.
  // On valide le port cible précis (targetHandle) — sinon on accepte si AU MOINS
  // un port de la cible accepte la source.
  const isValidConnection = useCallback((conn: {
    source: string | null; target: string | null; targetHandle?: string | null
  }) => {
    if (!conn.source || !conn.target || conn.source === conn.target) return false
    const srcNode = nodesRef.current.find(n => n.id === conn.source)
    const tgtNode = nodesRef.current.find(n => n.id === conn.target)
    if (!srcNode || !tgtNode) return true
    const src = srcNode.data?.node_type as string
    const tgt = tgtNode.data?.node_type as string
    if (!inputAccepts(tgt, conn.targetHandle, src)) return false
    // step 5 : bloque à la connexion une entrée EXCLUSIVE avec une autre déjà
    // branchée sur ce node (ex: "dataset YOLO" vs "dataset" sur Inference).
    // _resolvedTargetHandle (pas juste `e.targetHandle ?? 'in'`) : les arêtes de
    // template n'ont jamais de targetHandle persisté, donc sans résolution via
    // resolveHandles() elles retombaient TOUTES sur 'in' — faux positifs/négatifs.
    const already = new Set(edgesRef.current.filter(e => e.target === conn.target)
      .map(e => _resolvedTargetHandle(e, new Map(nodesRef.current.map(n => [n.id, n])))))
    const targetHandle = conn.targetHandle ?? resolveHandles(src, tgt).targetHandle
    if (wouldViolateExclusivity(tgt, targetHandle, already)) {
      toast.error(t('Entrées exclusives : débranchez d\'abord l\'autre port.'))
      return false
    }
    return true
  }, [])

  // ── ReactFlow handlers ─────────────────────────────────────────────────────
  const onNodesChange: OnNodesChange = useCallback(changes => {
    // Save history when a drag starts (before position changes)
    if (changes.some(c => c.type === 'position' && (c as { dragging?: boolean }).dragging === true)) pushHistory()
    setNodes(ns => applyNodeChanges(changes, ns))
    if (changes.some(c => c.type === 'position' && (c as { dragging?: boolean }).dragging === false)) setDirty(true)
  }, [pushHistory])

  const onEdgesChange: OnEdgesChange = useCallback(changes => {
    setEdges(es => applyEdgeChanges(changes, es))
  }, [])

  const onConnect: OnConnect = useCallback(conn => {
    pushHistory()
    const _src = nodesRef.current.find(n => n.id === conn.source)
    const _tgt = nodesRef.current.find(n => n.id === conn.target)
    const _h = resolveHandles(_src?.data?.node_type as string, _tgt?.data?.node_type as string)
    setEdges(es => addEdge({
      ...conn,
      sourceHandle: conn.sourceHandle ?? _h.sourceHandle,
      targetHandle: conn.targetHandle ?? _h.targetHandle,
      markerEnd: { type: MarkerType.ArrowClosed },
    }, es))
    setDirty(true)
    // Auto-propagate params from source → target node
    if (conn.source && conn.target) {
      setNodes(ns => {
        const src = ns.find(n => n.id === conn.source)
        const tgt = ns.find(n => n.id === conn.target)
        if (!src || !tgt) return ns
        const sType = src.data?.node_type as string
        const tType = tgt.data?.node_type as string
        if (sType === 'dataset_source' && tType === 'explorer' && src.data?.dataset_name) {
          const dn = src.data.dataset_name as string
          return ns.map(n => n.id === conn.target
            ? { ...n, data: { ...n.data, dataset_name: dn, ..._rederive(n.data, 'subset_name', '_subset_src', dn, s => `subset_${s}`) } } : n)
        }
        if (sType === 'explorer' && tType === 'explorer' && src.data?.dataset_name) {
          const dn = src.data.dataset_name as string, ps = src.data.subset_name as string
          return ns.map(n => n.id === conn.target
            ? { ...n, data: { ...n.data, dataset_name: dn, ..._rederive(n.data, 'subset_name', '_subset_src', ps, s => `subset_${s}`) } } : n)
        }
        if (sType === 'explorer' && tType === 'annotation' && src.data?.subset_name) {
          const ss = src.data.subset_name as string
          return ns.map(n => n.id === conn.target
            ? { ...n, data: { ...n.data, subset_name: ss, ..._rederive(n.data, 'project_name', '_project_src', ss, s => `Annot_${s}`) } } : n)
        }
        if (sType === 'dataset_source' && tType === 'annotation' && src.data?.dataset_name) {
          const dn = src.data.dataset_name as string
          return ns.map(n => n.id === conn.target
            ? { ...n, data: { ...n.data, subset_name: dn, ..._rederive(n.data, 'project_name', '_project_src', dn, s => `Annot_${s}`) } } : n)
        }
        if (sType === 'dataset_source' && tType === 'inference' && src.data?.dataset_path) {
          return ns.map(n => n.id === conn.target
            ? { ...n, data: { ...n.data, sequence_dir: src.data.dataset_path } } : n)
        }
        if (sType === 'annotation' && tType === 'training') {
          const yn = _yoloNameFromAnnotation(src.data as Record<string, unknown>)
          if (yn) {
            return ns.map(n => n.id === conn.target
              ? { ...n, data: { ...n.data, ..._rederive(n.data, 'run_label', '_run_label_src', yn, s => `best_${s}`) } } : n)
          }
          return ns
        }
        if (sType === 'optuna' && tType === 'training') {
          // L'etude sert ce Training : elle doit optimiser SON moteur, sinon le
          // lancement est refuse (les best params d'un moteur n'ont pas de sens
          // pour un autre).
          return ns.map(n => n.id === conn.source
            ? { ...n, data: { ...n.data, engine: tgt.data?.engine, optimize: [], model_size: '' } } : n)
        }
        if (sType === 'model' && tType === 'training') {
          const mn = _has(src.data?.model_path) ? _baseNoExt(src.data.model_path) : undefined
          return ns.map(n => n.id === conn.target
            ? { ...n, data: { ...n.data, engine: src.data.engine, model_size: src.data.model_size,..._rederive(n.data, 'run_label', '_run_label_src', mn, s => `best_${s}`) } } : n)
        }
        if (sType === 'model' && tType === 'inference' && src.data?.model_path) {
          return ns.map(n => n.id === conn.target
            ? { ...n, data: { ...n.data, model_path: src.data.model_path, engine: src.data.engine || 'yolox', model_size: src.data.model_size || '' } } : n)
        }
        if (sType === 'training' && tType === 'inference') {
          return ns.map(n => n.id === conn.target
            ? { ...n, data: { ...n.data, engine: src.data.engine || 'yolox', model_size: src.data.model_size || '' } } : n)
        }
        return ns
      })
    }
  }, [pushHistory])

  const onNodesDelete = useCallback(() => { pushHistory(); setDirty(true) }, [pushHistory])
  const onEdgesDelete = useCallback(() => { pushHistory(); setDirty(true) }, [pushHistory])

  // Drag-and-drop from toolbox — uses screenToFlowPosition for correct positioning
  const onDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }, [])
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const raw = e.dataTransfer.getData('application/reactflow')
    if (!raw) return
    pushHistory()
    const { type, defaults } = JSON.parse(raw)
    const position = screenToFlowPosition({ x: e.clientX, y: e.clientY })
    const id = nextNodeId(type)
    setNodes(ns => [...ns, { id, type, position, data: { ...defaults } }])
    setDirty(true)
  }, [screenToFlowPosition, pushHistory])

  // ── Drag-to-create (façon Unreal Blueprint) ────────────────────────────────
  // On tire un fil depuis un port et on le lâche dans le vide → popup listant les
  // nœuds COMPATIBLES ; en choisir un le crée et le branche automatiquement.
  const connectingRef = useRef<{ nodeId: string; handleId: string | null; handleType: 'source' | 'target'; nodeType: string } | null>(null)
  const [connectMenu, setConnectMenu] = useState<
    { x: number; y: number; flow: { x: number; y: number }; types: string[]
      from: { nodeId: string; handleId: string | null; handleType: 'source' | 'target'; nodeType: string } } | null
  >(null)
  const [connectSearch, setConnectSearch] = useState('')

  const onConnectStart = useCallback((_e: unknown, params: { nodeId?: string | null; handleId?: string | null; handleType?: 'source' | 'target' | null }) => {
    const node = nodesRef.current.find(n => n.id === params.nodeId)
    if (!node || !params.handleType) { connectingRef.current = null; return }
    connectingRef.current = {
      nodeId: params.nodeId as string,
      handleId: params.handleId ?? null,
      handleType: params.handleType,
      nodeType: node.data?.node_type as string,
    }
  }, [])

  const onConnectEnd = useCallback((event: MouseEvent | TouchEvent) => {
    const info = connectingRef.current
    connectingRef.current = null
    if (!info) return
    const target = event.target as Element | null
    // Lâché dans le vide (le pane) → ouvre le menu de création.
    if (!target || !target.classList?.contains('react-flow__pane')) return
    const pt = 'clientX' in event ? event : (event as TouchEvent).changedTouches?.[0]
    const cx = (pt as MouseEvent | Touch)?.clientX, cy = (pt as MouseEvent | Touch)?.clientY
    if (cx == null || cy == null) return
    const types = compatibleNodeTypes(info.nodeType, info.handleType, info.handleId)
    if (!types.length) return
    setConnectSearch('')
    setConnectMenu({ x: cx, y: cy, flow: screenToFlowPosition({ x: cx, y: cy }), types, from: info })
  }, [screenToFlowPosition])

  const createConnectedNode = useCallback((type: string) => {
    setConnectMenu(menu => {
      if (!menu) return null
      const { flow, from } = menu
      const tb = TOOLBOX_NODES.find(t => t.type === type)
      if (!tb) return null
      pushHistory()
      const id = nextNodeId(type)
      setNodes(ns => [...ns, { id, type, position: flow, data: { ...tb.defaults } }])
      setEdges(es => {
        const edge = from.handleType === 'source'
          ? (() => { const h = resolveHandles(from.nodeType, type)
              return { source: from.nodeId, target: id,
                sourceHandle: from.handleId ?? h.sourceHandle, targetHandle: h.targetHandle,
                markerEnd: { type: MarkerType.ArrowClosed } } })()
          : (() => { const h = resolveHandles(type, from.nodeType)
              return { source: id, target: from.nodeId,
                sourceHandle: h.sourceHandle, targetHandle: from.handleId ?? h.targetHandle,
                markerEnd: { type: MarkerType.ArrowClosed } } })()
        return addEdge(edge, es)
      })
      setDirty(true)
      return null
    })
  }, [pushHistory])

  // Keyboard: F = fit view, Ctrl+Z = undo, Ctrl+Y / Ctrl+Shift+Z = redo
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const active = document.activeElement
      const inInput = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')
      if (e.key === 'f' || e.key === 'F') {
        if (!inInput) fitView({ padding: 0.15, duration: 300 })
      }
      const ctrl = e.ctrlKey || e.metaKey
      if (ctrl && !inInput) {
        if (!e.shiftKey && e.key === 'z') { e.preventDefault(); undo() }
        if (e.key === 'y' || (e.shiftKey && e.key === 'Z')) { e.preventDefault(); redo() }
        if (e.key === 's') { e.preventDefault(); if (activeId) saveMut.mutate() }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [fitView, undo, redo])

  // Save
  // step 5 : « Impossible de créer un workflow invalide » — bloque la sauvegarde
  // (et donc le lancement, qui sauvegarde d'abord) si validateGraph relève des
  // erreurs. Les warnings n'empêchent rien, juste un toast informatif.
  function _guardValidOrThrow() {
    const { errors, warnings } = validateGraph(nodesRef.current, edgesRef.current)
    if (warnings.length) toast(warnings[0], { icon: '⚠️', duration: 5000 })
    if (errors.length) throw new Error(errors[0] + (errors.length > 1 ? ` (+${errors.length - 1} autre${errors.length > 2 ? 's' : ''})` : ''))
  }

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!activeId) return
      _guardValidOrThrow()
      // Propagate data along connected edges before saving
      const propagated = _propagateAllEdges(nodesRef.current, edgesRef.current)
      setNodes(propagated)
    const stripped = propagated.map(n => ({ id: n.id, type: n.type, position: n.position, data: { ...n.data, exec_status: undefined, frontend_url: undefined, waiting_hint: undefined, waiting_next: undefined, has_input: undefined, input_types: undefined, input_handles: undefined, input_engines: undefined, input_model_sizes: undefined, exec_order: undefined, current_step: undefined, progress: undefined, activity_steps: undefined, result_summary: undefined, dvc_pending: undefined } }))
      return graphsAPI.update(activeId, { nodes: stripped, edges })
    },
    onSuccess: () => {
      setDirty(false)
      qc.invalidateQueries({ queryKey: ['graphs'] })
      addLog('info', 'Graphe sauvegardé')
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : t('Erreur lors de la sauvegarde'), { duration: 6000 }),
  })

  // Auto Save + Auto Check (step 2/3) — DÉCOUPLÉS (correctif) : chaque toggle a un
  // effet PROPRE, indépendant de l'autre. Avant : le tout était derrière un SEUL
  // `if (!autoSave || !autoCheck) return` — activer Auto Save SEUL (le cas le plus
  // naturel) ne déclenchait RIEN du tout (ni sauvegarde, ni la même erreur de
  // validation que le bouton manuel, ni l'alignement/espacement). Maintenant :
  // - Auto Save seul  → sauvegarde debounced à chaque `dirty`, MÊME comportement/
  //   erreurs que le bouton "Sauvegarder" (saveMut appelle _guardValidOrThrow()).
  // - Auto Check seul → normalise juste la mise en page (align + espace), sans
  //   sauvegarder automatiquement (il faudra sauvegarder à la main, ou activer
  //   Auto Save aussi pour le combo complet du cahier des charges).
  useEffect(() => {
    if (!autoCheck || !dirty || !activeId) return
    const t = setTimeout(() => {
      const normalized = normalizeLayout(nodesRef.current, edgesRef.current, getInternalNode)
      nodesRef.current = normalized
      setNodes(normalized)
    }, 700)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, autoCheck, activeId])

  useEffect(() => {
    if (!autoSave || !dirty || !activeId) return
    // Délai VOLONTAIREMENT plus long que l'effet Auto Check ci-dessus (700ms) :
    // si les deux sont actifs, la sauvegarde doit toujours partir APRÈS que la
    // normalisation ait mis à jour nodesRef.current, jamais avant (par construction
    // du délai, pas par hasard d'ordre de scheduling des deux setTimeout).
    const t = setTimeout(() => { saveMut.mutate() }, 1000)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, autoSave, activeId])

  // Create
  const createMut = useMutation({
    mutationFn: () => graphsAPI.create('Nouvelle expérience', [], []),
    onSuccess: g => { qc.invalidateQueries({ queryKey: ['graphs'] }); setActiveId(g.graph_id); toast.success(t('Expérience créée')) },
  })

  // Duplicate
  const dupMut = useMutation({
    mutationFn: (id: string) => graphsAPI.duplicate(id),
    onSuccess: g => { qc.invalidateQueries({ queryKey: ['graphs'] }); setActiveId(g.graph_id); toast.success(t('Dupliquée')) },
  })

  // Delete
  const delMut = useMutation({
    mutationFn: (id: string) => graphsAPI.delete(id),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['graphs'] })
      if (activeId === id) setActiveId(graphs.find(g => g.graph_id !== id)?.graph_id ?? null)
      toast.success(t('Supprimée'))
    },
  })

  // Run
  const runMut = useMutation({
    mutationFn: async () => {
      if (!activeId) throw new Error('Aucun graphe actif')
      _guardValidOrThrow()
      const stripped = nodes.map(n => ({ id: n.id, type: n.type, position: n.position, data: { ...n.data, exec_status: undefined, frontend_url: undefined, waiting_hint: undefined, waiting_next: undefined, has_input: undefined, input_types: undefined, input_handles: undefined, input_engines: undefined, input_model_sizes: undefined, exec_order: undefined, current_step: undefined, progress: undefined, activity_steps: undefined, result_summary: undefined, dvc_pending: undefined } }))
      await graphsAPI.update(activeId, { nodes: stripped, edges })
      return graphsAPI.run(activeId)
    },
    onSuccess: ({ run_id, step_node_map: snm, launching }) => {
      if (activeId && workspaceScope) {
        localStorage.setItem(workspaceStorageKey(workspaceScope, `run_pending_completion_${activeId}`), run_id)
      }
      setRunId(run_id); setStepNodeMap(snm); setElapsed(0)
      _applyActivityPlan(snm)   // step 4 : pré-remplit la timeline sous chaque node
      elapsedRef.current = setInterval(() => setElapsed(e => e + 1), 1000)
      qc.invalidateQueries({ queryKey: ['graphs'] })
      _openSSE(activeId!, run_id, snm)
      if (launching && launching.length) {
        setLaunchingApps(launching)
        addLog('info', `Démarrage des apps : ${launching.join(', ')}`)
      }
      addLog('info', `Pipeline lancé — ${activeGraph?.name ?? ''}`, `run_id: ${run_id}`)
      setShowLogs(true)
      toast.success(t('Pipeline lancé'))
    },
    onError: (e: Error) => {
      addLog('error', 'Échec du lancement', e.message)
      toast.error(e.message)
    },
  })

  // SSE stream
  function _openSSE(graphId: string, rid: string, snm: Record<string, string>) {
    if (sseCleanup.current) sseCleanup.current()
    let cancelled = false
    const ctrl = new AbortController()
    fetch(`${BACKEND_BASE}/api/graphs/${graphId}/run/${rid}/stream`, { signal: ctrl.signal })
      .then(async res => {
        if (!res.ok || !res.body) return
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buf = ''
        while (!cancelled) {
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          const parts = buf.split('\n\n')
          buf = parts.pop() ?? ''
          for (const part of parts) {
            const line = part.trim()
            if (!line.startsWith('data: ')) continue
            try {
              const evt: RunEvent = JSON.parse(line.slice(6))
              _handleSSEEvent(evt, snm)
              if (evt.type === 'done') {
                const st = (evt as Record<string, unknown>).status as string
                if (st === 'stopped')      addLog('warning', 'Pipeline arrêté')
                else if (st === 'failed')  addLog('error', 'Pipeline terminé en échec')
                else                       addLog('success', 'Pipeline terminé avec succès')
                if (st !== 'failed' && st !== 'stopped') {
                  if (workspaceScope) {
                    localStorage.removeItem(workspaceStorageKey(workspaceScope, `run_pending_completion_${graphId}`))
                  }
                  const dvcNode = nodesRef.current.find(n => n.data?.node_type === 'dvc')
                  if (dvcNode) setSelectedNodeId(dvcNode.id)
                  setShowDoneModal(true)
                  toast.success(t('Pipeline terminé — les sorties sont prêtes dans le node DVC.'), { duration: 9000 })
                }
                _stopElapsed(); qc.invalidateQueries({ queryKey: ['graphs'] }); return
              }
              if (evt.type === 'end') {
                _stopElapsed(); qc.invalidateQueries({ queryKey: ['graphs'] }); return
              }
              // 'waiting' events: stop elapsed + refresh graph state, but do NOT return
              // so that on SSE reconnect/replay we keep processing subsequent events
              if (evt.type === 'waiting') { _stopElapsed(); qc.invalidateQueries({ queryKey: ['graphs'] }) }
            } catch { /* malformed */ }
          }
        }
      })
      .catch(() => { if (!cancelled) _stopElapsed() })
    sseCleanup.current = () => { cancelled = true; ctrl.abort() }
  }

  // step 4 : injecte le plan des sous-étapes sous chaque node. Fusionne avec
  // l'existant (préserve les statuts done/failed déjà obtenus lors d'une reprise).
  function _applyActivityPlan(snm: Record<string, string>) {
    stepTiming.current = {}   // step2 : reset des chronos/phases loggées pour ce run
    const plan = buildActivityPlan(snm, edgesRef.current as MiniEdge[], nodesRef.current as MiniNode[])
    setNodes(ns => ns.map(n => {
      const planned = plan[n.id]
      if (!planned) return n
      const existing = (n.data.activity_steps as ActivityStep[] | undefined) ?? []
      const byKey = new Map(existing.map(s => [s.key, s]))
      const merged = planned.map(p => byKey.get(p.key) ?? p)
      return { ...n, data: { ...n.data, activity_steps: merged } }
    }))
  }

  function _handleSSEEvent(evt: RunEvent, snm: Record<string, string>) {
    const stepId = evt.step_id; const status = evt.status as NodeExecStatus | 'success' | 'warning' | undefined
    if (!stepId || !status) return
    // step1 : rattache la sous-étape au node d'AFFICHAGE (embed → node explorer enfant).
    const nodeId = resolveDisplayNode(stepId, snm[stepId], edgesRef.current as MiniEdge[], nodesRef.current as MiniNode[])
    if (!nodeId) return
    const hint = (evt as Record<string, unknown>).hint as string ?? ''
    const nextLabel = (evt as Record<string, unknown>).next_label as string ?? ''   // step1
    const action = stepId.split('__')[1] ?? stepId
    const stepLabel = action
    const nodeLabel = stepId.split('__')[0]
    // step2 : méta du node pour colorer/regrouper le log par bloc.
    const _nm = nodesRef.current.find(n => n.id === nodeId)
    const nodeMeta = { node: nodeId, nodeLabel: (_nm?.data?.label as string) || nodeLabel, nodeType: _nm?.data?.node_type as string | undefined }
    const progressMsg = (evt as Record<string, unknown>).message as string | undefined
    // Suivi live (step 4) : barre d'avancement relayée par la sous-app {current,total,phase}.
    const progress = (evt as Record<string, unknown>).progress as { current: number; total: number; phase: string } | undefined
    // Libellé live montré SUR le nœud (step 5) : message de progression sinon action FR.
    const liveLabel = progressMsg || STEP_ACTION_LABEL[action] || action

    setNodes(ns => ns.map(n => {
      if (n.id !== nodeId) return n
      const current_step =
        status === 'running' ? liveLabel
        : status === 'waiting' ? (STEP_ACTION_LABEL[action] || undefined)
        : undefined   // success / failed → on efface la ligne live
      // Barre : on la pose/actualise pendant "running" avec progress ; un event running
      // SANS progress (ex. ping de démarrage d'app) NE l'efface PAS (garde l'existante) ;
      // tout event non-running (success/failed/waiting) l'efface.
      const nextProgress = status === 'running' ? (progress ?? n.data.progress) : undefined
      // step 4/2 : MAJ statut + barre RÉSIDUELLE de la sous-étape. La barre reste :
      // bleue pendant (running, X%), verte à 100% une fois done (on force current=total).
      const subStatus: SubStatus | undefined =
        status === 'success' ? 'done'
        : status === 'running' ? 'running'
        : status === 'failed' ? 'failed'
        : status === 'warning' ? 'warning'
        : status === 'waiting' ? 'waiting' : undefined
      const prevSteps = (n.data.activity_steps as ActivityStep[] | undefined) ?? []
      const nextSteps = (subStatus || progress)
        ? prevSteps.map(s => {
            if (s.key !== action) return s
            const st: ActivityStep = { ...s, status: subStatus ?? s.status }
            if (progress) st.progress = progress                              // tick live → barre bleue
            if (subStatus === 'done' && st.progress)                          // terminé → barre verte 100%
              st.progress = { ...st.progress, current: st.progress.total }
            return st
          })
        : prevSteps
      // step 4 : à la réussite d'une sous-étape, parse son résultat → chips sous le node.
      const prevResults = (n.data.result_summary as ResultItem[] | undefined) ?? []
      const newResults = status === 'success'
        ? parseStepResult(action, (evt as Record<string, unknown>).output)
        : []
      const nextResults = newResults.length
        ? [...prevResults.filter(r => !newResults.some(nr => nr.label === r.label)), ...newResults]
        : prevResults
      // step6 : remonte les best_params de l'auto-HPO sur le node Optuna → visibles sur
      // le node ET récupérables dans le hub DVC (l'auto-HPO ne les écrivait pas avant).
      let hpoBest: Record<string, unknown> | undefined
      if (status === 'success' && action === 'hpo') {
        try {
          const out = (evt as Record<string, unknown>).output
          const parsed = (typeof out === 'string' ? JSON.parse(out) : out) as Record<string, unknown> | null
          const bp = parsed?.best_params
          if (bp && typeof bp === 'object') hpoBest = bp as Record<string, unknown>
        } catch { /* output non-JSON — ignore */ }
      }
      return { ...n, data: {
        ...n.data,
        exec_status: status === 'success' ? 'done' : status,
        activity_steps: nextSteps,
        result_summary: nextResults,
        ...(hpoBest ? { best_params: hpoBest } : {}),
        // 'failed' doit aussi poser waiting_hint : c'est ce champ que le banner
        // "Étape échouée" du node (AppNode.tsx) affiche — sinon il reste vide ou
        // montre le hint d'un ANCIEN palier "waiting", pas l'erreur réelle.
        waiting_hint: (status === 'waiting' || status === 'failed' || status === 'warning') ? hint : n.data.waiting_hint,
        waiting_next: status === 'waiting' ? nextLabel : (status === 'running' ? n.data.waiting_next : undefined),
        current_step,
        progress: nextProgress,
      } }
    }))

    // After explorer export or annotation exportyolo, rescan workspace
    if (status === 'success' && (stepId.endsWith('__export') || stepId.endsWith('__exportyolo'))) {
      refreshWorkspaceOutputs()
    }

    // Append to log — libellés FR clairs + couleurs (step 5) + mesures (step2 : « aucun oubli »).
    const doneLabel = (STEP_ACTION_LABEL[action] || stepLabel).replace('…', '').replace('En attente : ', '')
    const ts = (evt as Record<string, unknown>).ts as number | undefined
    const timing = (stepTiming.current[stepId] ??= {})
    if (status === 'running') {
      if (progress) {
        // Ticks MESURÉS dans les logs : epochs (training) et trials (Optuna) — une ligne
        // par palier (dédup via lastPhase). Les ticks par image (embed/scan/annotation)
        // restent HORS logs (la barre sous le node suffit, sinon spam).
        if ((action === 'train' || action === 'hpo') && progress.phase && timing.lastPhase !== progress.phase) {
          timing.lastPhase = progress.phase
          addLog('info', `   ${progress.phase}`, undefined, nodeMeta)
        }
      } else if (progressMsg) {
        addLog('info', progressMsg, undefined, nodeMeta)
      } else {
        // Démarrage d'étape : on loggue AUSSI les settings (yolo/epochs/batch, trials, seuil IA…).
        if (timing.startTs == null) timing.startTs = ts
        const setg = stepSettings(action, (_nm?.data as Record<string, unknown>) ?? {})
        addLog('info', `▶ ${STEP_ACTION_LABEL[action] || stepLabel}${setg ? ' · ' + setg : ''}`, undefined, nodeMeta)
      }
    } else if (status === 'success') {
      // Terminé : durée + mesures parsées (images, mAP, best params…) — rien d'oublié.
      const dur = ts != null && timing.startTs != null ? Math.round(ts - timing.startTs) : null
      const res = parseStepResult(action, (evt as Record<string, unknown>).output)
        .map(r => `${r.label} ${r.value}`).join(' · ')
      const extra = [dur != null ? `${dur}s` : '', res].filter(Boolean).join(' · ')
      addLog('success', `✓ ${doneLabel} — terminé${extra ? ' · ' + extra : ''}`, undefined, nodeMeta)
    } else if (status === 'failed') {
      // pipeline_runner n'émet jamais de clé "error" — le détail complet (app/endpoint/
      // message + suggestion de correction) est porté par "hint" sur l'event failed
      // (voir pipeline_runner._run_step). Lire evt.error ici retournait toujours vide.
      addLog('error', `Étape échouée : ${stepLabel}`, hint || undefined, nodeMeta)
    } else if (status === 'warning') {
      addLog('warning', `HPO échoué — Training continue avec ses paramètres`, hint || undefined, nodeMeta)
    } else if (status === 'waiting') {
      addLog('human', `Intervention requise : ${stepLabel}`, hint, nodeMeta)
    } else if (evt.type === 'done' || evt.type === 'end') {
      addLog('success', 'Pipeline terminé')
    }
  }

  function _stopElapsed() {
    if (elapsedRef.current) { clearInterval(elapsedRef.current); elapsedRef.current = null }
  }

  // Resume
  const resumeMut = useMutation({
    mutationFn: async () => {
      if (!activeId) throw new Error('Aucun graphe actif')
      const stripped = nodes.map(n => ({
        id: n.id, type: n.type, position: n.position,
        data: { ...n.data, exec_status: undefined, frontend_url: undefined, waiting_hint: undefined, waiting_next: undefined, has_input: undefined, input_types: undefined, input_handles: undefined, input_engines: undefined, input_model_sizes: undefined, exec_order: undefined, current_step: undefined, progress: undefined, activity_steps: undefined, result_summary: undefined, dvc_pending: undefined },
      }))
      await graphsAPI.update(activeId, { nodes: stripped, edges })
      return graphsAPI.resume(activeId)
    },
    onSuccess: ({ run_id, step_node_map: snm }) => {
      setStepNodeMap(snm)
      _applyActivityPlan(snm)   // step 4 : conserve les sous-étapes faites, ajoute les nouvelles
      setElapsed(0)
      elapsedRef.current = setInterval(() => setElapsed(e => e + 1), 1000)
      _openSSE(activeId!, run_id, snm)
      qc.invalidateQueries({ queryKey: ['graphs'] })
      addLog('info', 'Pipeline repris après intervention')
      toast.success(t('Pipeline repris'))
    },
    onError: (e: unknown) => {
      // Always refresh graph state — server may have auto-reset it (e.g. restart-loss)
      qc.invalidateQueries({ queryKey: ['graphs'] })
      const msg = _axiosMessage(e)
      addLog('error', 'Reprise échouée', msg)
      toast.error(msg, { duration: 6000 })
    },
  })

  // Stop — arrête un run en cours ou coincé (garde-fou anti-blocage)
  const stopMut = useMutation({
    mutationFn: () => graphsAPI.stop(activeId!),
    onSuccess: () => {
      sseCleanup.current?.()
      _stopElapsed()
      setLaunchingApps(null)
      setNodes(ns => ns.map(n => {
        const st = n.data?.exec_status as string
        return (st === 'running' || st === 'waiting')
          ? { ...n, data: { ...n.data, exec_status: 'idle' } } : n
      }))
      qc.invalidateQueries({ queryKey: ['graphs'] })
      addLog('warning', 'Pipeline arrêté par l\'utilisateur')
      toast('Pipeline arrêté')
    },
    onError: (e: unknown) => {
      qc.invalidateQueries({ queryKey: ['graphs'] })
      toast.error(_axiosMessage(e))
    },
  })

  // Reset
  const resetMut = useMutation({
    mutationFn: () => graphsAPI.reset(activeId!),
    onSuccess: () => {
      setLaunchingApps(null)
      setNodes(ns => ns.map(n => ({ ...n, data: { ...n.data, exec_status: 'idle' } })))
      qc.invalidateQueries({ queryKey: ['graphs'] })
      addLog('info', 'Pipeline réinitialisé')
      toast('Réinitialisé')
    },
  })

  useEffect(() => () => { sseCleanup.current?.(); _stopElapsed() }, [])

  // Si le run se termine pendant que l'utilisateur consulte MLOps/Expériences,
  // le composant SSE est démonté. Au retour, l'historique backend déclenche la
  // même notification et ouvre le node DVC une seule fois.
  useEffect(() => {
    if (!activeId || !activeGraph) return
    if (!workspaceScope) return
    const pendingKey = workspaceStorageKey(workspaceScope, `run_pending_completion_${activeId}`)
    const pending = localStorage.getItem(pendingKey)
    const latest = activeGraph.run_history?.[0]
    if (!pending || latest?.run_id !== pending || !['done', 'success'].includes(latest.status)) return
    localStorage.removeItem(pendingKey)
    const dvcNode = nodes.find(n => n.data?.node_type === 'dvc')
    if (dvcNode) setSelectedNodeId(dvcNode.id)
    setShowLogs(true)
    setShowDoneModal(true)
    toast.success(t('Pipeline terminé — les sorties sont prêtes dans le node DVC.'), { duration: 9000 })
  }, [activeId, activeGraph, nodes, workspaceScope])

  // ── Fin de chaine : popup + halo DVC tant que le run n'est pas versionne ─────
  // Un run termine mais non commite est la seule chose qui reste a faire : le node
  // DVC le signale (halo orange clignotant) jusqu'au commit, et une popup l'annonce
  // en fin de chaine (le toast passait inapercu).
  const lastRun = activeGraph?.run_history?.[0]
  const lastRunDone = Boolean(lastRun && ['done', 'success'].includes(lastRun.status))
  const lastRunId = lastRunDone ? (lastRun?.run_id ?? '') : ''
  const dvcPending = Boolean(lastRunId && !activeGraph?.run_lineage?.[lastRunId]?.committed_at)
  const [showDoneModal, setShowDoneModal] = useState(false)

  // Marque le node DVC (halo) — champ runtime, jamais persiste (cf. saveMut).
  useEffect(() => {
    setNodes(ns => {
      let changed = false
      const next = ns.map(n => {
        if ((n.data as Record<string, unknown>)?.node_type !== 'dvc') return n
        if (Boolean((n.data as Record<string, unknown>).dvc_pending) === dvcPending) return n
        changed = true
        return { ...n, data: { ...n.data, dvc_pending: dvcPending } }
      })
      return changed ? next : ns
    })
  }, [dvcPending, setNodes])

  // Le commit se fait dans le panneau du node DVC (NodeConfigPanel) : il previent
  // par un event, on rafraichit le graphe -> committed_at present -> halo eteint.
  useEffect(() => {
    const onCommitted = () => qc.invalidateQueries({ queryKey: ['graphs'] })
    window.addEventListener('orch:dvc-committed', onCommitted)
    return () => window.removeEventListener('orch:dvc-committed', onCommitted)
  }, [qc])

  function _openDvcNode() {
    const dvcNode = nodesRef.current.find(n => (n.data as Record<string, unknown>)?.node_type === 'dvc')
    if (dvcNode) setSelectedNodeId(dvcNode.id)
    setShowDoneModal(false)
  }

  // Rename
  const [renaming, setRenaming] = useState(false)
  const [newName, setNewName] = useState('')
  function startRename() { setNewName(activeGraph?.name ?? ''); setRenaming(true) }
  function commitRename() {
    if (activeId && newName.trim()) {
      graphsAPI.update(activeId, { name: newName.trim() }).then(() => { qc.invalidateQueries({ queryKey: ['graphs'] }); setRenaming(false) })
    } else { setRenaming(false) }
  }

  // Waiting state info
  const waitingNode = isWaiting ? nodes.find(n => (n.data?.exec_status as string) === 'waiting') : null
  const waitingHint = waitingNode?.data?.waiting_hint as string | undefined
  const waitingNext = waitingNode?.data?.waiting_next as string | undefined   // step1
  const waitingAppKey = _nodeToAppKey(waitingNode?.data?.node_type as string)
  const waitingUrl = waitingAppKey ? (appUrls[waitingAppKey] ?? '') : ''
  const waitingLabel = waitingAppKey ? _labelFor(waitingAppKey) : ''
  // step 6/7 : Annotation/explorer LOCKED + Manuel — le gate ("annoter" / "manual_create")
  // exige un choix EXPLICITE dans la liste avant de pouvoir continuer. On ne peut pas
  // se fier à export_name/subset_name eux-mêmes (subset_name a une valeur par défaut
  // non vide dès la création du node, export_name peut trainer d'un run précédent) —
  // gateChoicePicked (état local, reset à chaque nouveau gate) capture le vrai geste
  // de clic dans AnnotationWaitingChoice/VisuWaitingChoice PENDANT cette pause.
  const waitingIsAnnotationManual = waitingNode?.data?.node_type === 'annotation'
    && waitingNode?.data?.full_auto === false && waitingNode?.data?.has_input !== false
  const waitingIsVisuManual = waitingNode?.data?.node_type === 'explorer'
    && waitingNode?.data?.full_auto === false && waitingNode?.data?.has_input !== false
  useEffect(() => { setGateChoicePicked(false) }, [waitingNode?.id])

  // Mémoïsé sur [edges, nodes] : évite de re-décorer (et donc de re-décider un
  // mode de routage) à chaque re-render sans rapport (tick `elapsed`, toggle
  // logs, renaming…) — ne recalcule que quand la topologie ou les positions
  // changent réellement (step 1 — labels d'arêtes stables).
  const decoratedEdges = useMemo(() => decorateEdges(edges, nodes, getInternalNode), [edges, nodes, getInternalNode])

  return (
    <div className="flex h-full">
      {/* ── Left toolbox ── */}
      <aside className="w-40 shrink-0 bg-gray-900 border-r border-gray-800 flex flex-col">
        <div className="px-3 py-2.5 border-b border-gray-800">
          <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">{t('Nœuds')}</p>
          <p className="text-[10px] text-gray-600 mt-0.5">{t('Glisser sur le canvas')}</p>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {([
            { cat: 'app', title: t('Applications') },
            { cat: 'input', title: t('Entrées (inputs)') },
          ] as const).map(section => (
            <div key={section.cat} className="space-y-1">
              <p className="text-[9px] font-semibold text-gray-600 uppercase tracking-wider px-0.5 pt-1.5 first:pt-0">{section.title}</p>
              {TOOLBOX_NODES.filter(t => t.category === section.cat).map(t => {
                const Icon = t.icon
                return (
                  <div key={t.type} draggable
                    onDragStart={e => { e.dataTransfer.setData('application/reactflow', JSON.stringify({ type: t.type, defaults: t.defaults })); e.dataTransfer.effectAllowed = 'move' }}
                    className={`flex items-center gap-2 px-2.5 py-2 rounded-lg border bg-gray-900 cursor-grab text-xs font-medium ${t.color} select-none`}
                  >
                    <Icon size={12} />{t.label}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
        <div className="px-2 py-2 border-t border-gray-800">
          <p className="text-[9px] text-gray-700 leading-relaxed">{t('Suppr = effacer · F = vue · Ctrl+Z/Y = annuler/rétablir')}</p>
        </div>
      </aside>

      {/* ── Main area ── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <div className="flex items-center gap-2 px-4 py-2 bg-gray-900 border-b border-gray-800 shrink-0">
          <GraphSelector graphs={graphs} activeId={activeId}
            onSelect={id => { setActiveId(id); layoutGraphId.current = null }}
            onCreate={() => createMut.mutate()}
            onDuplicate={id => dupMut.mutate(id)}
            onDelete={id => delMut.mutate(id)}
          />

          {/* Graph name — click to rename */}
          {activeGraph && (
            renaming ? (
              <input autoFocus value={newName} onChange={e => setNewName(e.target.value)}
                onBlur={commitRename}
                onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenaming(false) }}
                className="text-sm font-medium text-white bg-gray-800 border border-indigo-500 rounded px-2 py-0.5 focus:outline-none max-w-[200px]"
              />
            ) : (
              <button onClick={startRename} title={t('Cliquer pour renommer')} className="text-sm font-medium text-white hover:text-indigo-300 truncate max-w-[200px] border-b border-transparent hover:border-indigo-500 transition-colors">
                {activeGraph.name}
              </button>
            )
          )}

          {/* Badge type MLOps derive (mlops = MLflow + DVC) + couplage en 1 clic.
              Experimental = jetable ; MLOps = suivi DVC+MLflow+Insight+Lineage ;
              Partiel = un seul des deux -> suivi incomplet, on propose de completer. */}
          {activeGraph && (
            mlops.tracking_complete ? (
              <span title={t('Ce graphe est suivi : DVC + MLflow presents. Chaque run est versionnable et tracé dans Insight / Lineage.')}
                className="flex items-center gap-1.5 px-2 py-1 text-[11px] font-semibold rounded-lg bg-emerald-900/30 text-emerald-300 border border-emerald-700/50">
                <ShieldCheck size={12} /> MLOps
              </span>
            ) : mlops.tracking_partial ? (
              <button onClick={addMlopsPair}
                title={`${t('Suivi incomplet : il manque')} ${mlops.has_mlflow ? t('le node DVC') : t('le node MLflow')}. ${t('MLflow et DVC vont ensemble (versionner + tracer). Cliquer pour ajouter le node manquant.')}`}
                className="flex items-center gap-1.5 px-2 py-1 text-[11px] font-semibold rounded-lg bg-amber-900/30 text-amber-300 border border-amber-700/50 hover:bg-amber-900/50 transition-colors">
                <Link2 size={12} /> {t('Suivi incomplet — compléter')}
              </button>
            ) : (
              <button onClick={addMlopsPair}
                title={t('Graphe experimental (jetable). Cliquer pour activer le suivi MLOps : ajoute la paire MLflow + DVC (versioning + tracabilite + Insight + Lineage).')}
                className="flex items-center gap-1.5 px-2 py-1 text-[11px] font-medium rounded-lg bg-gray-800 text-gray-400 border border-gray-700 hover:text-indigo-300 hover:border-indigo-700/50 transition-colors">
                <FlaskConical size={12} /> {t('Experimental')}
                <span className="text-gray-600">·</span>
                <span className="text-indigo-300">{t('Track in MLOps')}</span>
              </button>
            )
          )}

          {/* Undo / Redo */}
          {activeId && (
            <div className="flex items-center gap-0.5">
              <button onClick={undo} title={t('Annuler (Ctrl+Z)')} className="p-1.5 text-gray-500 hover:text-white rounded transition-colors disabled:opacity-30" disabled={historyRef.current.length === 0}>
                <Undo2 size={13} />
              </button>
              <button onClick={redo} title={t('Rétablir (Ctrl+Y)')} className="p-1.5 text-gray-500 hover:text-white rounded transition-colors disabled:opacity-30" disabled={futureRef.current.length === 0}>
                <Redo2 size={13} />
              </button>
            </div>
          )}

          <div className="flex-1" />

          {activeId && (
            <>
              {/* Auto Save + Auto Check (step 2/3) — indépendants : Auto Save sauvegarde
                  seul (mêmes erreurs de validation que "Sauvegarder") ; Auto Check
                  normalise seul l'alignement/espacement. Les deux ensemble = combo complet. */}
              <button
                onClick={() => setAutoSave(v => !v)}
                title={t('Auto Save : sauvegarde automatique après chaque édition (fonctionne seul, mêmes erreurs que Sauvegarder)')}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border transition-colors ${
                  autoSave ? 'bg-indigo-900/40 text-indigo-300 border-indigo-700/60' : 'text-gray-500 border-gray-700 hover:text-gray-300 hover:border-gray-600'
                }`}
              >
                <Save size={12} /> Auto Save
              </button>
              <button
                onClick={() => setAutoCheck(v => !v)}
                title={t('Auto Check : aligne/espace automatiquement les nodes Application (fonctionne seul — activez aussi Auto Save pour persister)')}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border transition-colors ${
                  autoCheck ? 'bg-emerald-900/40 text-emerald-300 border-emerald-700/60' : 'text-gray-500 border-gray-700 hover:text-gray-300 hover:border-gray-600'
                }`}
              >
                <CheckCircle2 size={12} /> Auto Check
              </button>

              {dirty && (
                <button onClick={() => saveMut.mutate()} disabled={saveMut.isPending} className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-gray-400 hover:text-white border border-gray-700 hover:border-gray-600 rounded-lg">
                  {saveMut.isPending ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                  {t('Sauvegarder')}
                </button>
              )}

              {(isRunning || isWaiting) ? (
                <>
                  {isWaiting && (
                    <button onClick={() => resumeMut.mutate()} disabled={resumeMut.isPending} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-orange-500 hover:bg-orange-400 rounded-lg">
                      {resumeMut.isPending ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
                      {t('Terminé → Continuer')}
                    </button>
                  )}
                  {isRunning && (
                    <span className="flex items-center gap-1.5 text-xs text-blue-400">
                      <Loader2 size={12} className="animate-spin" />{elapsed}s
                    </span>
                  )}
                  <button onClick={() => stopMut.mutate()} disabled={stopMut.isPending}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-red-600 hover:bg-red-500 disabled:opacity-50 rounded-lg" title={t('Arrêter le pipeline')}>
                    {stopMut.isPending ? <Loader2 size={12} className="animate-spin" /> : <Square size={12} />}
                    Stop
                  </button>
                  <button onClick={() => resetMut.mutate()} className="p-1.5 text-gray-500 hover:text-white hover:bg-gray-800 rounded-lg" title={t('Réinitialiser')}>
                    <RotateCcw size={14} />
                  </button>
                </>
              ) : (
                <>
                  {activeGraph?.status === 'done' && (
                    <Link to="/mlops/insights" className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-emerald-300 border border-emerald-700/50 hover:bg-emerald-900/20 rounded-lg" title={t('Plots et journal du dernier run')}>
                      <BarChart3 size={12} />
                      Insights
                    </Link>
                  )}
                  <button onClick={() => runMut.mutate()} disabled={runMut.isPending || nodes.length === 0} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 rounded-lg">
                    {runMut.isPending ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
                    {t('Lancer')}
                  </button>
                </>
              )}
            </>
          )}

          {!activeId && (
            <button onClick={() => createMut.mutate()} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg">
              <Plus size={12} /> {t('Nouvelle expérience')}
            </button>
          )}

          {/* Logs toggle */}
          <button
            onClick={() => setShowLogs(v => !v)}
            title={t('Journal des événements')}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border transition-colors ${
              showLogs
                ? 'bg-indigo-900/40 text-indigo-300 border-indigo-700/60'
                : 'text-gray-500 border-gray-700 hover:text-gray-300 hover:border-gray-600'
            }`}
          >
            <ScrollText size={12} />
            {logs.length > 0 && <span className="text-[10px] tabular-nums">{logs.length}</span>}
          </button>
        </div>

        {/* Bandeau de fork : divergence vs parent (avant relance) */}
        {activeGraph?.forked_from && (
          <ForkDivergenceBanner fork={activeGraph.forked_from} nodes={nodes} />
        )}

        {/* Waiting banner */}
        {isWaiting && waitingNode && (
          <div className="px-4 py-2 border-b border-orange-800/30 bg-orange-950/20 shrink-0">
            <WaitingBanner hint={waitingHint ?? ''} nextLabel={waitingNext ?? ''} appUrl={waitingUrl} appLabel={waitingLabel}
              onResume={() => resumeMut.mutate()} isPending={resumeMut.isPending}
              blocked={(waitingIsAnnotationManual || waitingIsVisuManual) && !gateChoicePicked}
              blockedReason={(waitingIsAnnotationManual || waitingIsVisuManual) && !gateChoicePicked
                ? `Sélectionnez ${waitingIsAnnotationManual ? 'une annotation' : 'un subset'} ci-dessus pour activer Continuer.` : undefined}
            >
              {waitingIsAnnotationManual && (
                <AnnotationWaitingChoice node={waitingNode} onPick={name => {
                  setNodes(ns => ns.map(n => n.id === waitingNode.id ? { ...n, data: { ...n.data, export_name: name } } : n))
                  setGateChoicePicked(true)
                }} />
              )}
              {waitingIsVisuManual && (
                <VisuWaitingChoice node={waitingNode} onPick={name => {
                  setNodes(ns => ns.map(n => n.id === waitingNode.id ? { ...n, data: { ...n.data, subset_name: name } } : n))
                  setGateChoicePicked(true)
                }} />
              )}
            </WaitingBanner>
          </div>
        )}

        {/* ReactFlow Controls dark-theme override */}
        <style>{`
          .react-flow__controls-button { background: #1f2937 !important; border-color: #374151 !important; }
          .react-flow__controls-button svg { fill: #9ca3af !important; max-width: 14px; max-height: 14px; }
          .react-flow__controls-button:hover { background: #374151 !important; }
          .react-flow__controls-button:hover svg { fill: #f9fafb !important; }
          /* Blueprint : port branché / prêt = « brille » (halo emerald cohérent). */
          .react-flow__handle { transition: box-shadow .15s ease; }
          .react-flow__handle.bp-glow { box-shadow: 0 0 7px 1.5px rgba(52,211,153,.6); }
          .react-flow__handle:hover { box-shadow: 0 0 0 3px rgba(99,102,241,.35); }
          /* Halo 3s sur la zone du panneau visée par le bouton « Choisir un
             subset/export existant » du node (AppNode.tsx → orch:open-node-picker). */
          @keyframes bpFocusGlow {
            0%, 12% { box-shadow: 0 0 0 3px rgba(99,102,241,.85), 0 0 22px 5px rgba(99,102,241,.5); }
            100%    { box-shadow: 0 0 0 0 rgba(99,102,241,0); }
          }
          .bp-focus-glow { animation: bpFocusGlow 3s ease-out; border-radius: 0.5rem; }
        `}</style>

        {/* Canvas */}
        <div className="flex-1 relative" onDragOver={onDragOver} onDrop={onDrop}>
          {!activeId ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-center">
              <div className="w-16 h-16 rounded-2xl bg-indigo-600/20 border border-indigo-600/30 flex items-center justify-center">
                <Plus size={28} className="text-indigo-400" />
              </div>
              <div>
                <p className="text-white font-semibold">{t('Aucune expérience')}</p>
                <p className="text-gray-500 text-sm mt-1">{t('Créez votre premier sandgraph ou utilisez un template dans Expériences')}</p>
              </div>
              <button onClick={() => createMut.mutate()} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-lg">
                {t('Créer une expérience')}
              </button>
            </div>
          ) : (
            <ReactFlow
              nodes={injectDvcPreview(injectMlflowPreview(nodes, edges, activeGraph?.name ?? ''), edges)}
              edges={decoratedEdges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onConnectStart={onConnectStart}
              onConnectEnd={onConnectEnd}
              isValidConnection={isValidConnection}
              onNodesDelete={onNodesDelete}
              onEdgesDelete={onEdgesDelete}
              onNodeClick={(_, n) => setSelectedNodeId(n.id)}
              onPaneClick={() => setSelectedNodeId(null)}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              // Canvas JAMAIS figé (Bob 2026-07-24) : déplacer/pan/zoom reste
              // TOUJOURS possible, même pendant un run (déplacement = cosmétique,
              // n'affecte pas le pipeline). Seules la CONNEXION et la SUPPRESSION
              // restent bloquées pendant un run (elles casseraient le step_node_map).
              nodesDraggable
              nodesConnectable={!isRunning}
              deleteKeyCode={isRunning ? null : ['Delete', 'Backspace']}
              fitView
              fitViewOptions={{ padding: 0.2 }}
              minZoom={0.1}
              maxZoom={2}
              defaultViewport={{ x: 0, y: 0, zoom: 0.75 }}
              className="bg-gray-950"
              defaultEdgeOptions={{
                markerEnd: { type: MarkerType.ArrowClosed, color: '#6366f1' },
                style: { stroke: '#6366f1', strokeWidth: 2 },
              }}
            >
              <Background variant={BackgroundVariant.Lines} color="#1e293b" gap={32} size={1} />
              <Controls
                className="!bottom-4 !left-4"
                showInteractive={false}
                style={{ backgroundColor: '#1f2937', border: '1px solid #374151' }}
              />
              <MiniMap
                className="!bg-gray-900 !border-gray-700 !bottom-4"
                nodeColor={n => _nodeColor(n.data?.exec_status as string)}
              />

              {/* Écran de lancement des apps (step 3) */}
              {launchingApps && launchingApps.length > 0 && (
                <LaunchOverlay appKeys={launchingApps} onClose={() => setLaunchingApps(null)} />
              )}

              {/* Fit view shortcut hint */}
              <div className="absolute top-3 right-3 z-10">
                <button
                  onClick={() => fitView({ padding: 0.15, duration: 300 })}
                  title={t('Ajuster la vue (F)')}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-600 rounded-lg text-xs text-gray-300 hover:text-white transition-colors"
                >
                  <Maximize2 size={12} />
                  <kbd className="text-[10px] text-gray-500">F</kbd>
                </button>
              </div>
            </ReactFlow>
          )}
        </div>
      </div>

      {/* ── Right config panel ── */}
      {selectedNodeId && activeId && (
        <NodeConfigPanel
          node={injectDvcPreview(injectMlflowPreview(nodes, edges, activeGraph?.name ?? ''), edges).find(n => n.id === selectedNodeId) ?? null}
          appUrls={appUrls}
          graphId={activeId}
          pickerFocus={pickerFocus}
          onUpdate={(nodeId, newData) => {
            setNodes(ns => ns.map(n => n.id === nodeId ? { ...n, data: { ...n.data, ...newData } } : n))
            setDirty(true)
          }}
          onClose={() => setSelectedNodeId(null)}
          onDelete={nodeId => {
            setNodes(ns => ns.filter(n => n.id !== nodeId))
            setEdges(es => es.filter(e => e.source !== nodeId && e.target !== nodeId))
            setSelectedNodeId(null)
            setDirty(true)
          }}
        />
      )}

      {/* ── Log panel ── */}
      {showLogs && <LogPanel logs={logs} onClose={() => setShowLogs(false)} />}

      {/* ── Fin de chaine : ce qui reste a faire, dit clairement ── */}
      {showDoneModal && (
        <>
          <div className="fixed inset-0 z-40 bg-black/50" onClick={() => setShowDoneModal(false)} />
          <div className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(92vw,460px)]
                          bg-gray-900 border border-amber-700/50 rounded-2xl shadow-2xl overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-800 bg-amber-950/30">
              <CheckCircle2 size={16} className="text-emerald-400" />
              <h3 className="text-sm font-semibold text-white flex-1">{t('Chaîne terminée')}</h3>
              <button onClick={() => setShowDoneModal(false)} className="text-gray-500 hover:text-white"><X size={15} /></button>
            </div>
            <div className="p-4 space-y-3 text-xs text-gray-300">
              <p>{t('Toutes les étapes du graphe sont passées. Les sorties (dataset, annotations, modèle, métriques) sont prêtes.')}</p>
              {dvcPending ? (
                <p className="rounded-lg border border-amber-700/50 bg-amber-950/30 px-3 py-2 text-amber-200">
                  {t("Ce run n'est")} <b>{t('pas encore versionné')}</b>. {t('Le nœud')} <b>DVC Commit</b> {t("clignote tant que ce n'est pas fait :")}
                  {' '}{t('cochez les artefacts à garder, puis créez la version.')}
                </p>
              ) : (
                <p className="rounded-lg border border-emerald-700/50 bg-emerald-950/30 px-3 py-2 text-emerald-200">
                  {t("Ce run est déjà versionné dans DVC — rien d'autre à faire.")}
                </p>
              )}
              <div className="flex gap-2 pt-1">
                <button onClick={_openDvcNode}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-500 rounded-lg">
                  <GitBranch size={13} /> {t('Ouvrir le nœud DVC')}
                </button>
                <button onClick={() => setShowDoneModal(false)}
                  className="px-3 py-2 text-xs font-medium text-gray-400 border border-gray-700 hover:text-white hover:border-gray-600 rounded-lg">
                  {t('Plus tard')}
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── Popup « nœud compatible » (drag-to-create façon Unreal) ── */}
      {connectMenu && (() => {
        const items = TOOLBOX_NODES
          .filter(t => connectMenu.types.includes(t.type))
          .filter(t => {
            const q = connectSearch.toLowerCase()
            return !q || t.label.toLowerCase().includes(q) || (NODE_DESC[t.type] ?? '').toLowerCase().includes(q)
          })
        return (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setConnectMenu(null)} />
            <div
              className="fixed z-50 w-72 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl overflow-hidden"
              style={{ left: Math.min(connectMenu.x, window.innerWidth - 300), top: Math.min(connectMenu.y, window.innerHeight - 340) }}
            >
              <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-800">
                <Search size={13} className="text-gray-500 shrink-0" />
                <input
                  autoFocus value={connectSearch}
                  onChange={e => setConnectSearch(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Escape') setConnectMenu(null)
                    if (e.key === 'Enter' && items.length) createConnectedNode(items[0].type)
                  }}
                  placeholder={t('Rechercher un nœud compatible…')}
                  className="flex-1 bg-transparent text-sm text-white placeholder-gray-600 focus:outline-none"
                />
                <button onClick={() => setConnectMenu(null)} className="text-gray-600 hover:text-white shrink-0"><X size={13} /></button>
              </div>
              <div className="max-h-72 overflow-y-auto py-1">
                {items.length === 0 ? (
                  <p className="px-3 py-4 text-xs text-gray-600 text-center">{t('Aucun nœud compatible')}</p>
                ) : items.map(t => {
                  const Icon = t.icon
                  return (
                    <button
                      key={t.type} onClick={() => createConnectedNode(t.type)}
                      className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-gray-800/60 text-left transition-colors"
                    >
                      <span className={`w-7 h-7 rounded-lg border flex items-center justify-center shrink-0 bg-gray-900 ${t.color}`}><Icon size={13} /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm text-gray-100 font-medium truncate">{t.label}</span>
                        <span className="block text-[11px] text-gray-500 truncate">{NODE_DESC[t.type]}</span>
                      </span>
                      <Plus size={13} className="text-gray-600 shrink-0" />
                    </button>
                  )
                })}
              </div>
            </div>
          </>
        )
      })()}
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _frontendUrl(nodeType: string, appUrls: Record<string, string>): string {
  const map: Record<string, string> = {
    dataset_source: appUrls['Dataset_Explorer_App']   ?? '',
    explorer:           appUrls['Dataset_Explorer_App']   ?? '',
    annotation:     appUrls['Annotation_App'] ?? '',
    dvc:            appUrls['dvc-app']        ?? '',
    mlflow:         appUrls['mlflow-app']     ?? '',
    optuna:         appUrls['optuna-app']     ?? '',
    training:       appUrls['Training_App']   ?? '',
    inference:      appUrls['Inference_App']  ?? '',
  }
  return map[nodeType] ?? ''
}

function _nodeToAppKey(nodeType: string): string {
  const map: Record<string, string> = {
    dataset_source: 'Dataset_Explorer_App',
    explorer:           'Dataset_Explorer_App',
    annotation:     'Annotation_App',
    dvc:            'dvc-app',
    mlflow:         'mlflow-app',
    optuna:         'optuna-app',
    training:       'Training_App',
    inference:      'Inference_App',
  }
  return map[nodeType] ?? ''
}

function _labelFor(appKey: string): string {
  const map: Record<string, string> = {
    'Dataset_Explorer_App':   'Dataset Explorer',
    'Annotation_App': 'Annotation App',
    'dvc-app':        'DVC App',
    'mlflow-app':     'MLflow App',
    'optuna-app':     'Optuna App',
    'Training_App':   'Training App',
    'Inference_App':  'Inference App',
  }
  return map[appKey] ?? appKey
}

function _nodeColor(execStatus: string): string {
  const m: Record<string, string> = { idle: '#374151', running: '#3b82f6', waiting: '#f97316', done: '#22c55e', success: '#22c55e', failed: '#ef4444' }
  return m[execStatus] ?? '#374151'
}
