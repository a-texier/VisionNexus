// ============================================================
// nodes/ports.ts — schéma de branchement « blueprint » des nœuds.
// Un nœud = des ENTRÉES (à gauche, sous le corps) et des SORTIES (à droite).
// Chaque port a un TYPE de donnée (→ couleur) et, pour les entrées, la liste
// des types de nœuds source acceptés. Les handles sont rendus par <NodePorts>.
// ============================================================

export type PortType = 'dataset' | 'subset' | 'yolo' | 'ver' | 'model' | 'params' | 'metrics' | 'any'

// Classes Tailwind EN DUR (le scanner JIT doit voir les littéraux, y compris le `!`).
export const PORT_COLOR: Record<PortType, { handle: string; text: string; label: string }> = {
  dataset: { handle: '!bg-amber-500 !border-amber-700',   text: 'text-amber-300',   label: 'dataset' },
  subset:  { handle: '!bg-violet-500 !border-violet-700', text: 'text-violet-300',  label: 'subset' },
  yolo:    { handle: '!bg-rose-500 !border-rose-700',     text: 'text-rose-300',    label: 'dataset YOLO' },
  ver:     { handle: '!bg-teal-500 !border-teal-700',     text: 'text-teal-300',    label: 'GT (.ver)' },
  model:   { handle: '!bg-blue-500 !border-blue-700',     text: 'text-blue-300',    label: 'modèle' },
  params:  { handle: '!bg-cyan-500 !border-cyan-700',     text: 'text-cyan-300',    label: 'best params' },
  metrics: { handle: '!bg-emerald-500 !border-emerald-700', text: 'text-emerald-300', label: 'métriques' },
  any:     { handle: '!bg-gray-400 !border-gray-600',     text: 'text-gray-300',    label: 'artefact' },
}
// Handle « en attente » (entrée non branchée) — gris pointillé.
export const PORT_EMPTY_HANDLE = '!bg-gray-800 !border-gray-600'

// Couleur HEX (même teinte Tailwind-500 que PORT_COLOR ci-dessus) utilisée pour la
// LIGNE de l'arête (SVG stroke, pas de classes Tailwind possibles là). Avant, chaque
// template choisissait sa propre couleur d'arête à la main (souvent incohérente avec
// le handle réellement branché) — maintenant l'arête est TOUJOURS coloriée d'après le
// type du port réel (source unique de vérité = ce tableau).
export const PORT_STROKE: Record<PortType, string> = {
  dataset: '#f59e0b', subset: '#8b5cf6', yolo: '#f43f5e', ver: '#14b8a6',
  model: '#3b82f6', params: '#06b6d4', metrics: '#10b981', any: '#9ca3af',
}

export interface Port {
  id: string
  label: string
  type: PortType
  accepts?: string[]      // entrées : types de nœuds source acceptés sur ce port
  required?: boolean      // step 5 : le node ne peut pas être sauvegardé/lancé sans cette entrée branchée (sauf mode FREE)
  exclusiveWith?: string[] // step 5 : ne peut pas être branché EN MÊME TEMPS que ces autres ports du même node
  requiresPeer?: string[]  // step 5 : n'a de sens que si au moins un de ces autres ports est AUSSI branché (sinon warning)
}

export interface NodePorts { inputs: Port[]; outputs: Port[] }

// Schéma par type de nœud. Les ids d'entrée servent de targetHandle, 'out' de sourceHandle.
// (MLflow = superviseur : aucun port → inconnectable.)
export const NODE_PORTS: Record<string, NodePorts> = {
  dataset_source: {
    inputs: [],
    outputs: [{ id: 'out', label: 'dataset', type: 'dataset' }],
  },
  model: {
    inputs: [],
    outputs: [{ id: 'out', label: 'modèle', type: 'model' }],
  },
  explorer: {
    inputs:  [{ id: 'in', label: 'dataset', type: 'dataset', accepts: ['dataset_source', 'explorer', 'inference'] }],
    outputs: [{ id: 'out', label: 'subset', type: 'subset' }],
  },
  annotation: {
    inputs:  [{ id: 'in', label: 'images', type: 'subset', accepts: ['explorer', 'inference', 'dataset_source'], required: true }],
    // DEUX sorties distinctes (un projet Annotation peut être exporté dans les deux
    // formats) : le dataset YOLO complet (data.yaml, 3 splits) → Training/Optuna, et
    // le .ver (format texte natif Inference_App) → Inference/Éval. Chaque port a son
    // propre type/couleur, donc son propre handle — plus de port générique ambigu.
    outputs: [
      { id: 'out_yolo', label: 'dataset YOLO', type: 'yolo' },
      { id: 'out_ver',  label: 'GT (.ver)',    type: 'ver' },
    ],
  },
  optuna: {
    // Chaque trial Optuna est lui-même un entraînement YOLO complet (train+val) sur
    // CE dataset — donc, comme Training, il consomme le data.yaml entier (pas un split).
    inputs:  [{ id: 'in', label: 'dataset YOLO', type: 'yolo', accepts: ['annotation'], required: true }],
    outputs: [{ id: 'out', label: 'best params', type: 'params' }],
  },
  training: {
    inputs: [
      { id: 'dataset', label: 'dataset YOLO', type: 'yolo',   accepts: ['annotation'], required: true },
      { id: 'model',   label: 'modèle',      type: 'model',  accepts: ['model'] },
      { id: 'hpo',     label: 'best params', type: 'params', accepts: ['optuna'] },
    ],
    outputs: [{ id: 'out', label: 'modèle', type: 'model' }],
  },
  // step 5 : inputs autorisés = modèle · Dataset (images, node Inputs) · Dataset
  // YOLO (GT incluse, split sélectionnable) · .ver (GT). Dataset YOLO est
  // EXCLUSIF avec Dataset (l'un ou l'autre, jamais les deux — le premier fournit
  // déjà tout, GT incluse). .ver VA AVEC Dataset (n'a de sens que si Dataset est
  // aussi branché — sinon warning, cf. validatePortRules ci-dessous).
  inference: {
    inputs: [
      { id: 'model',    label: 'modèle',    type: 'model',   accepts: ['training', 'model'] },
      { id: 'sequence', label: 'dataset (images)', type: 'dataset', accepts: ['dataset_source'], exclusiveWith: ['dataset_yolo'] },
      { id: 'dataset_yolo', label: 'dataset YOLO (GT incluse)', type: 'yolo', accepts: ['annotation'], exclusiveWith: ['sequence'] },
      { id: 'gt',       label: 'GT (.ver)',  type: 'ver',     accepts: ['annotation'], requiresPeer: ['sequence'] },
    ],
    outputs: [{ id: 'out', label: 'métriques', type: 'metrics' }],
  },
  // step6 (Bob 2026-07-25) : DVC = OBSERVATEUR, comme MLflow. Plus AUCUN port
  // (inconnectable) : on ne le branche pas à un « artefact » ambigu. Il OBSERVE tout
  // le graphe et propose de versionner/télécharger les artefacts choisis (dataset,
  // annotations, best model, params Optuna, métriques Inférence) — cf. DvcNodeSummary.
  dvc: { inputs: [], outputs: [] },
  mlflow: { inputs: [], outputs: [] },
}

// Résout les handles d'une arête src→tgt : le port d'entrée de la cible dont
// `accepts` contient le type source (sinon 1re entrée), et — si la source a
// PLUSIEURS sorties (ex: Annotation = yolo + ver) — la sortie dont le TYPE
// correspond exactement au port cible choisi (couleur cohérente bout en bout,
// sinon on tombe sur la 1re sortie).
export function resolveHandles(srcType: string, tgtType: string): { sourceHandle: string; targetHandle: string; portType?: PortType } {
  const src = NODE_PORTS[srcType]
  const tgt = NODE_PORTS[tgtType]
  let targetHandle = tgt?.inputs[0]?.id ?? 'in'
  let targetPortType = tgt?.inputs[0]?.type
  const match = tgt?.inputs.find(p => p.accepts?.includes(srcType))
  if (match) { targetHandle = match.id; targetPortType = match.type }

  let sourceHandle = src?.outputs[0]?.id ?? 'out'
  if (src && src.outputs.length > 1 && targetPortType) {
    const sMatch = src.outputs.find(o => o.type === targetPortType)
    if (sMatch) sourceHandle = sMatch.id
  }
  return { sourceHandle, targetHandle, portType: targetPortType }
}

// Le port d'entrée `handleId` de `tgtType` accepte-t-il une source de type `srcType` ?
export function inputAccepts(tgtType: string, handleId: string | null | undefined, srcType: string): boolean {
  const tgt = NODE_PORTS[tgtType]
  if (!tgt) return true
  if (!tgt.inputs.length) return false
  if (handleId) {
    const p = tgt.inputs.find(x => x.id === handleId)
    if (p) return !!p.accepts?.includes(srcType)
  }
  // Pas de handle précis : accepté si AU MOINS un port l'accepte.
  return tgt.inputs.some(p => p.accepts?.includes(srcType))
}

// ── Validation stricte des connexions (step 5) ─────────────────────────────────
// Le port cible `targetHandleId` de `tgtType` peut-il être branché alors que
// `connectedHandleIds` (les AUTRES ports déjà branchés sur ce même node) sont
// déjà connectés ? Faux si un port déjà branché est `exclusiveWith` la cible
// (ou réciproquement) — bloque la connexion AVANT qu'elle ne se crée
// (isValidConnection, SandgraphPage.tsx).
export function wouldViolateExclusivity(
  tgtType: string, targetHandleId: string | null | undefined, connectedHandleIds: Set<string>,
): boolean {
  const tgt = NODE_PORTS[tgtType]
  if (!tgt || !targetHandleId) return false
  const port = tgt.inputs.find(p => p.id === targetHandleId)
  if (!port) return false
  for (const otherId of connectedHandleIds) {
    if (otherId === targetHandleId) continue
    const other = tgt.inputs.find(p => p.id === otherId)
    if (!other) continue
    if (port.exclusiveWith?.includes(otherId) || other.exclusiveWith?.includes(targetHandleId)) return true
  }
  return false
}

export interface PortValidation { errors: string[]; warnings: string[] }

// Valide l'ensemble des entrées d'UN node : entrées obligatoires manquantes
// (`required`, sauf mode FREE — explorer/annotation sans arête entrante restent
// valides), paires exclusives violées (ne devrait plus arriver si
// wouldViolateExclusivity a fait son travail à la connexion, mais un graphe
// peut avoir été sauvegardé avant cette règle), et pairs manquants
// (`requiresPeer`, ex: GT sans Dataset) → simple warning, pas bloquant.
export function validatePortRules(
  nodeType: string, nodeLabel: string, connectedHandleIds: Set<string>, isFreeMode: boolean,
): PortValidation {
  const tgt = NODE_PORTS[nodeType]
  const errors: string[] = [], warnings: string[] = []
  if (!tgt) return { errors, warnings }

  for (const port of tgt.inputs) {
    const connected = connectedHandleIds.has(port.id)
    if (port.required && !connected && !isFreeMode) {
      errors.push(`${nodeLabel} : entrée obligatoire manquante — « ${port.label} »`)
    }
    if (connected && port.exclusiveWith?.some(id => connectedHandleIds.has(id))) {
      const otherLabel = tgt.inputs.find(p => p.id === port.exclusiveWith![0])?.label ?? port.exclusiveWith![0]
      errors.push(`${nodeLabel} : « ${port.label} » et « ${otherLabel} » sont exclusifs (l'un OU l'autre, jamais les deux)`)
    }
    if (connected && port.requiresPeer?.length && !port.requiresPeer.some(id => connectedHandleIds.has(id))) {
      const peerLabels = port.requiresPeer.map(id => tgt.inputs.find(p => p.id === id)?.label ?? id).join(' / ')
      warnings.push(`${nodeLabel} : « ${port.label} » branché sans « ${peerLabels} » — vérifiez que c'est voulu`)
    }
  }
  return { errors, warnings }
}

// ── Drag-to-create (popup « nœud compatible ») ────────────────────────────────
// Depuis une SORTIE (on tire un fil d'un output) : cibles = nœuds ayant une entrée
// qui accepte le type source. Depuis une ENTRÉE : sources = nœuds dont la sortie
// peut alimenter ce port (leur type figure dans `accepts` du port).
export function compatibleNodeTypes(
  fromType: string,
  handleType: 'source' | 'target',
  handleId?: string | null,
): string[] {
  if (handleType === 'source') {
    return Object.keys(NODE_PORTS).filter(t =>
      NODE_PORTS[t].inputs.some(p => p.accepts?.includes(fromType)))
  }
  // handleType === 'target' : quels types peuvent produire ce que ce port attend ?
  const port = handleId ? NODE_PORTS[fromType]?.inputs.find(p => p.id === handleId)
                        : NODE_PORTS[fromType]?.inputs[0]
  const accepts = port?.accepts ?? []
  // On ne propose que des types qui ONT une sortie (sinon rien à brancher).
  return accepts.filter(t => (NODE_PORTS[t]?.outputs.length ?? 0) > 0)
}
