// DatasetNode — nœud source de dataset
import { memo, useState } from 'react'
import { NodeProps } from '@xyflow/react'
import { Database, FolderOpen, ChevronDown, ChevronUp, Loader2, AlertTriangle } from 'lucide-react'
import { NodeExecStatus } from './shared'
import { NodeActivity, ActivityStep, ResultItem } from './AppNode'
import NodePorts from './NodePorts'

export interface DatasetNodeData {
  node_type: 'dataset_source'
  label: string
  dataset_name: string
  dataset_path: string
  n_clusters: number
  exec_status?: NodeExecStatus
  exec_order?: number
  // Doublon détecté (même root_path déjà connu dans Dataset_Explorer_App, cf. NodeConfigPanel)
  duplicate_matches?: { id: number; name: string; image_count: number; status: string }[]
  allow_duplicate?: boolean
  // Suivi live (step 4) — barre d'avancement (scan/embedding) relayée par Dataset_Explorer_App.
  progress?: { current: number; total: number; phase: string }
  // Suivi live (step 4) — tray sous le node : timeline sous-étapes + résultats.
  activity_steps?: ActivityStep[]
  result_summary?: ResultItem[]
  [key: string]: unknown
}

function DatasetNode({ data, selected }: NodeProps) {
  const d = data as DatasetNodeData
  const [expanded, setExpanded] = useState(false)

  const status = d.exec_status ?? 'idle'
  const ringCls = STATUS_RING[status] ?? 'ring-gray-700'

  return (
    <div className="relative">
      {typeof d.exec_order === 'number' && (
        <div
          title={`Ordre d'exécution logique : étape ${d.exec_order}`}
          className="absolute -top-2 -right-2 z-10 min-w-[18px] h-[18px] px-1 rounded-full bg-gray-950/90 border border-gray-600 text-gray-400 text-[10px] font-semibold flex items-center justify-center shadow-sm pointer-events-none"
        >
          {d.exec_order}
        </div>
      )}
      <div className={`min-w-[200px] bg-gray-900 border border-gray-700 rounded-xl shadow-lg overflow-hidden ring-2 ${ringCls} ${selected ? 'ring-offset-1 ring-offset-gray-950' : ''}`}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 bg-amber-900/30 border-b border-amber-700/30">
        <Database size={14} className="text-amber-400 shrink-0" />
        <span className="text-xs font-semibold text-amber-300 flex-1 truncate">Dataset Source</span>
        <StatusDot status={status} />
        <button onClick={() => setExpanded(e => !e)} className="text-gray-500 hover:text-white">
          {expanded ? <ChevronUp size={12}/> : <ChevronDown size={12}/>}
        </button>
      </div>

      {/* Body */}
      <div className="px-3 py-2 space-y-1.5">
        <p className="text-sm font-medium text-white truncate">{d.dataset_name || 'Non nommé'}</p>
        <div className="flex items-center gap-1 text-[11px] text-gray-500 truncate">
          <FolderOpen size={10} />
          <span className="truncate">{d.dataset_path || '—'}</span>
        </div>
        {/* Ligne LIVE (step 5) : chargement / embedding en cours. */}
        {status === 'running' && (d.current_step as string) && (
          <div className="flex items-center gap-1.5 px-1.5 py-1 rounded bg-blue-950/50 border border-blue-800/40">
            <Loader2 size={11} className="animate-spin text-blue-400 shrink-0" />
            <span className="text-[10px] text-blue-200 truncate">{d.current_step as string}</span>
          </div>
        )}
        {/* Doublon : ce chemin est déjà un dataset connu de Dataset_Explorer_App sous un
            autre nom (cf. check auto dans NodeConfigPanel) — visible même sans
            ouvrir le panneau de config, avant même de lancer le graphe. */}
        {(d.duplicate_matches?.length ?? 0) > 0 && (
          <div
            className="flex items-start gap-1.5 px-1.5 py-1 rounded bg-amber-950/50 border border-amber-800/40"
            title={d.duplicate_matches!.map(m => `${m.name} (#${m.id})`).join(', ')}
          >
            <AlertTriangle size={11} className="text-amber-400 shrink-0 mt-0.5" />
            <span className="text-[10px] text-amber-200 truncate">
              Doublon de {d.duplicate_matches!.map(m => m.name).join(', ')}
              {d.allow_duplicate ? ' (créera un dataset séparé)' : ''}
            </span>
          </div>
        )}
      </div>

      {/* Config (expanded) */}
      {expanded && (
        <div className="px-3 pb-3 space-y-2 border-t border-gray-800 pt-2">
          <Field label="n_clusters" value={String(d.n_clusters ?? 15)} />
        </div>
      )}

      {/* Sortie « dataset » (nœud source : aucune entrée). */}
      <NodePorts nodeType="dataset_source" inputHandles={[]} status={status} />
      </div>

      {/* Tray « suivi live » (step 4) — scan → embedding sous le node. */}
      <NodeActivity
        steps={d.activity_steps}
        progress={d.progress}
        results={d.result_summary}
      />
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="text-gray-500 w-20 shrink-0">{label}</span>
      <span className="text-gray-300 font-mono truncate">{value}</span>
    </div>
  )
}

function StatusDot({ status }: { status: NodeExecStatus }) {
  return <span className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[status] ?? 'bg-gray-600'}`} />
}

const STATUS_DOT: Record<string, string> = {
  idle:    'bg-gray-600',
  running: 'bg-blue-500 animate-pulse',
  waiting: 'bg-orange-500 animate-pulse',
  done:    'bg-green-500',
  failed:  'bg-red-500',
}

const STATUS_RING: Record<string, string> = {
  idle:    'ring-gray-700',
  running: 'ring-blue-500',
  waiting: 'ring-orange-500 ring-2',
  done:    'ring-green-600',
  failed:  'ring-red-600',
}

export default memo(DatasetNode)
