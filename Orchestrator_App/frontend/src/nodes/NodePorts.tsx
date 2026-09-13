// ============================================================
// nodes/NodePorts.tsx — section « blueprint » partagée par tous les nœuds.
// Entrées (gauche) et sorties (droite) en lignes, chacune avec son handle
// posé sur le bord de SA ligne (chaque ligne est `relative` → le handle
// ReactFlow se positionne au bord de la ligne, empilé verticalement proprement).
// ============================================================
import { Handle, Position } from '@xyflow/react'
import { NODE_PORTS, PORT_COLOR, PORT_EMPTY_HANDLE } from './ports'
import type { NodeExecStatus } from './shared'

export default function NodePorts({
  nodeType, inputHandles, status,
}: {
  nodeType: string
  inputHandles: string[]
  status: NodeExecStatus
}) {
  const ports = NODE_PORTS[nodeType]
  if (!ports || (!ports.inputs.length && !ports.outputs.length)) return null
  const ready = status === 'done'

  return (
    <div className="border-t border-gray-800/70 bg-gray-950/50 px-1.5 py-1.5">
      <div className="grid grid-cols-2 gap-x-2">
        {/* ── Entrées (gauche) ── */}
        <div className="space-y-0.5">
          {ports.inputs.length > 0 && (
            <p className="text-[8px] font-semibold uppercase tracking-wider text-gray-600 pl-2 mb-0.5">Entrées</p>
          )}
          {ports.inputs.map(p => {
            // Branché = CE port précis reçoit une arête (input_handles, résolu
            // par targetHandle côté SandgraphPage) — PAS "un node d'un type que
            // ce port accepterait est connecté quelque part sur le node" (bug :
            // sur Inference, `dataset_yolo` et `gt` acceptent tous deux
            // 'annotation' → l'ancien check par TYPE allumait `GT (.ver)` dès
            // qu'Annotation était branché sur `dataset_yolo`, même si `gt`
            // lui-même n'avait aucune arête).
            const filled = inputHandles.includes(p.id)
            const c = PORT_COLOR[p.type]
            return (
              <div key={p.id} className="relative flex items-center gap-1.5 h-[18px] pl-2">
                <Handle
                  type="target" position={Position.Left} id={p.id}
                  title={filled ? `${p.label} : branché` : `${p.label} : en attente (accepte ${p.accepts?.join(', ')})`}
                  className={`!w-2.5 !h-2.5 !border-2 ${filled ? `${c.handle} bp-glow` : PORT_EMPTY_HANDLE}`}
                />
                <span className={`text-[10px] leading-none truncate ${filled ? c.text : 'text-gray-500'}`}>{p.label}</span>
              </div>
            )
          })}
        </div>

        {/* ── Sorties (droite) ── */}
        <div className="space-y-0.5">
          {ports.outputs.length > 0 && (
            <p className="text-[8px] font-semibold uppercase tracking-wider text-gray-600 text-right pr-2 mb-0.5">Sorties</p>
          )}
          {ports.outputs.map(p => {
            const c = PORT_COLOR[p.type]
            return (
              <div key={p.id} className="relative flex items-center justify-end gap-1.5 h-[18px] pr-2">
                {ready && <span className="text-[8px] text-emerald-400 leading-none">✓ prêt</span>}
                <span className={`text-[10px] leading-none truncate ${c.text}`}>{p.label}</span>
                <Handle
                  type="source" position={Position.Right} id={p.id}
                  title={`Sortie : ${p.label}`}
                  className={`!w-2.5 !h-2.5 !border-2 ${c.handle} ${ready ? 'bp-glow' : ''}`}
                />
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
