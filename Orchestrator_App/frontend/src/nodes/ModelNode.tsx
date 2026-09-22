// ModelNode — nœud d'ENTRÉE : des poids d'un moteur d'entraînement, fournis manuellement.
// Sert à combler l'entrée « modèle » d'un Training (poids de départ / fine-tuning)
// ou d'une Inference/Éval (modèle à tester) sans passer par un Training amont.
import { memo, useState } from 'react'
import { NodeProps } from '@xyflow/react'
import { Box, ChevronDown, ChevronUp } from 'lucide-react'
import { NodeExecStatus } from './shared'
import NodePorts from './NodePorts'
import { useEngines } from '../hooks/useEngines'

export interface ModelNodeData {
  node_type: 'model'
  label: string
  model_path: string
  exec_status?: NodeExecStatus
  exec_order?: number
  [key: string]: unknown
}

const STATUS_DOT: Record<string, string> = {
  idle: 'bg-gray-600', running: 'bg-blue-500 animate-pulse',
  waiting: 'bg-orange-500 animate-pulse', done: 'bg-green-500', failed: 'bg-red-500',
}
const STATUS_RING: Record<string, string> = {
  idle: 'ring-gray-700', running: 'ring-blue-500',
  waiting: 'ring-orange-500 ring-2', done: 'ring-green-600', failed: 'ring-red-600',
}

function ModelNode({ data, selected }: NodeProps) {
  const d = data as ModelNodeData
  const [expanded, setExpanded] = useState(false)
  const status = d.exec_status ?? 'idle'
  const base = (d.model_path || '').replace(/\\/g, '/').split('/').filter(Boolean).pop() || '—'
  const eng = useEngines()

  return (
    <div className="relative">
      {typeof d.exec_order === 'number' && (
        <div title={`Ordre d'exécution logique : étape ${d.exec_order}`}
          className="absolute -top-2 -right-2 z-10 min-w-[18px] h-[18px] px-1 rounded-full bg-gray-950/90 border border-gray-600 text-gray-400 text-[10px] font-semibold flex items-center justify-center shadow-sm pointer-events-none">
          {d.exec_order}
        </div>
      )}
      <div className={`min-w-[200px] bg-gray-900 border border-gray-700 rounded-xl shadow-lg overflow-hidden ring-2 ${STATUS_RING[status] ?? 'ring-gray-700'} ${selected ? 'ring-offset-1 ring-offset-gray-950' : ''}`}>
        <div className="flex items-center gap-2 px-3 py-2.5 bg-blue-900/30 border-b border-blue-700/30">
          <Box size={14} className="text-blue-400 shrink-0" />
          <span className="text-xs font-semibold text-blue-300 flex-1 truncate">Modèle {eng.labelOf(d.engine)}</span>
          <span className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[status] ?? 'bg-gray-600'}`} />
          <button onClick={() => setExpanded(e => !e)} className="text-gray-500 hover:text-white">
            {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
        </div>
        <div className="px-3 py-2 space-y-1">
          <p className="text-sm font-medium text-white truncate">{d.label || 'Modèle'}</p>
          <p className="text-[11px] text-gray-500 font-mono truncate">{base}</p>
          {(d.model_size as string) && (
            <span className="inline-block text-[10px] px-1.5 py-0.5 rounded bg-blue-900/40 text-blue-300 border border-blue-700/40 font-mono">
              {d.model_size as string}
            </span>
          )}
        </div>
        {expanded && (
          <div className="px-3 pb-3 pt-2 border-t border-gray-800">
            <p className="text-[11px] text-gray-500 break-all font-mono">{d.model_path || '(chemin des poids à définir)'}</p>
          </div>
        )}
        {/* Sortie « modèle » (nœud d'entrée : aucune arête entrante). */}
        <NodePorts nodeType="model" inputHandles={[]} status={status} />
      </div>
    </div>
  )
}

export default memo(ModelNode)
