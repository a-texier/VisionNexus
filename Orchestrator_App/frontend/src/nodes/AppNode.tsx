// AppNode — nœud générique pour chaque sous-app CV
import { memo, useState, useEffect } from 'react'
import { NodeProps } from '@xyflow/react'
import {
  Eye, Tag, GitBranch, TrendingUp, Settings2, Zap,
  ExternalLink, ChevronDown, ChevronUp, AlertTriangle, CheckCircle2,
  Loader2, Unlock, Lock, XCircle, Crosshair, ListChecks,
  Activity, Check, Circle, Clock, X as XIcon,
} from 'lucide-react'
import type { NodeExecStatus } from './shared'
import { STATUS_DOT, STATUS_RING } from './shared'
import NodePorts from './NodePorts'

export type AppNodeType = 'explorer' | 'annotation' | 'dvc' | 'mlflow' | 'optuna' | 'training' | 'inference'

export interface AppNodeData {
  node_type: AppNodeType
  label: string
  frontend_url?: string
  exec_status?: NodeExecStatus
  waiting_hint?: string
  has_input?: boolean   // calculé depuis les arêtes — true = LOCKED, false = FREE
  exec_order?: number   // ordre d'exécution logique (badge en haut à droite)
  // Node DVC seulement : dernier run termine mais pas encore versionne. Pose par
  // SandgraphPage (jamais persiste) -> halo orange clignotant, eteint des que le
  // commit est fait. C'est le seul "il reste quelque chose a faire" du graphe.
  dvc_pending?: boolean
  // explorer-specific
  dataset_name?: string
  subset_name?: string
  query?: string
  top_k?: number
  // Annotation-specific
  label_classes?: { name: string; color: string }[]
  split_train?: number
  split_val?: number
  // Annotation : doublon détecté (même subset déjà annoté ailleurs, cf. NodeConfigPanel)
  duplicate_matches?: { id: number; name: string; frame_count: number; annotated_count: number }[]
  // Suivi live (step 4) — barre d'avancement relayée par la sous-app pendant l'étape.
  progress?: { current: number; total: number; phase: string }
  // Suivi live (step 4) — tray sous le node : timeline des sous-étapes + résultats.
  activity_steps?: ActivityStep[]
  result_summary?: ResultItem[]
  // DVC-specific
  commit_message?: string
  [key: string]: unknown
}

// ── Suivi live sous le node (step 4) ─────────────────────────────────────────
export type SubStatus = 'pending' | 'running' | 'done' | 'warning' | 'failed' | 'waiting'
// progress = barre RÉSIDUELLE de la sous-étape (bleue pendant, verte 100% terminée).
export interface ActivityStep { key: string; label: string; status: SubStatus; progress?: { current: number; total: number; phase: string } }
export interface ResultItem { label: string; value: string }

// Pastille d'état d'une sous-étape dans la timeline du tray.
function SubStepDot({ status }: { status: SubStatus }) {
  if (status === 'running') return <Loader2 size={11} className="text-blue-400 animate-spin shrink-0" />
  if (status === 'done')    return <Check size={11} className="text-green-400 shrink-0" />
  if (status === 'warning') return <AlertTriangle size={11} className="text-amber-400 shrink-0" />
  if (status === 'failed')  return <XIcon size={11} className="text-red-400 shrink-0" />
  if (status === 'waiting') return <Clock size={11} className="text-orange-400 shrink-0" />
  return <Circle size={9} className="text-gray-600 shrink-0" strokeWidth={2.5} />
}

// Tray « suivi live » attaché SOUS le node — extension visuelle sur fond gris léger.
// Affiche la timeline des sous-étapes (scan → embedding → subset…), la barre
// d'avancement temps réel de l'étape en cours, et les résultats produits
// (best params Optuna, mAP Training, frames annotées…). Rendu par AppNode ET
// DatasetNode. Reste visible après la fin du run pour garder les résultats à l'écran.
export function NodeActivity({
  steps, progress, results,
}: {
  steps?: ActivityStep[]
  progress?: { current: number; total: number; phase: string }
  results?: ResultItem[]
}) {
  const hasSteps = (steps?.length ?? 0) > 0
  const hasResults = (results?.length ?? 0) > 0
  if (!hasSteps && !hasResults) return null
  const activeStep = steps?.find(s => s.status === 'running' || s.status === 'waiting')
  const runningKey = steps?.find(s => s.status === 'running')?.key
  // step3 : tray HIGHLIGHT quand le node est en cours de traitement (sous-étape active).
  const active = !!activeStep
  const shell = active
    ? 'bg-blue-950/50 border-blue-600/60 ring-1 ring-blue-500/50 shadow-blue-900/30'
    : 'bg-gray-800/70 border-gray-700/50'
  return (
    <div className="relative mx-2 -mt-0.5">
      {/* petit trait de raccord node → tray */}
      <div className={`mx-auto w-px h-1.5 ${active ? 'bg-blue-500/70' : 'bg-gray-700/70'}`} />
      <div className={`rounded-lg border shadow-inner px-2 py-1.5 space-y-1 transition-colors ${shell}`}>
        <div className={`flex items-center gap-1 text-[8px] uppercase tracking-wider font-bold ${active ? 'text-blue-300' : 'text-gray-500'}`}>
          <Activity size={9} className={active ? 'text-blue-400 animate-pulse' : 'text-gray-400'} /> Suivi live
        </div>

        {hasSteps && (
          <div className="space-y-0.5">
            {steps!.map(s => {
              const isRunning = s.status === 'running'
              const color =
                s.status === 'done' ? 'text-gray-400'
                : isRunning ? 'text-blue-100 font-semibold'
                : s.status === 'warning' ? 'text-amber-300'
                : s.status === 'failed' ? 'text-red-300'
                : s.status === 'waiting' ? 'text-orange-200 font-medium'
                : 'text-gray-600'
              // step3 : la zone EN COURS de traitement est marquée (fond + accent gauche).
              const rowMark = isRunning
                ? 'bg-blue-500/15 border-l-2 border-blue-400 pl-1 -ml-0.5 rounded-sm'
                : s.status === 'waiting'
                ? 'bg-orange-500/15 border-l-2 border-orange-400 pl-1 -ml-0.5 rounded-sm'
                : ''
              // step2 : barre RÉSIDUELLE par sous-étape — préférer la progress live du node
              // pour la sous-étape en cours (fluide), sinon la progress figée sur la sous-étape.
              const stepProg = (s.key === runningKey ? progress : undefined) ?? s.progress
              return (
                <div key={s.key} className={rowMark}>
                  <div className="flex items-center gap-1.5">
                    <SubStepDot status={s.status} />
                    <span className={`text-[10px] truncate ${color}`}>{s.label}</span>
                  </div>
                  {/* barre sous CHAQUE sous-étape mesurée : bleue (running) / verte (done, 100%) / rouge (failed) */}
                  {stepProg && (
                    <div className="ml-[18px] mt-0.5 mb-0.5">
                      <MiniProgress progress={stepProg} status={s.status} />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {hasResults && (
          <div className="pt-1 mt-0.5 border-t border-gray-700/50 flex flex-wrap gap-1">
            {results!.map((r, i) => (
              <span key={i} className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded bg-gray-900/70 border border-gray-700/50">
                <span className="text-gray-500">{r.label}</span>
                <span className="text-emerald-300 font-mono">{r.value}</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// Barre compacte (phase + current/total + %) — reste affichée en résidu :
// bleue pendant (running), VERTE à 100% une fois terminée (done), rouge si échec.
function MiniProgress({ progress, status = 'running' }: {
  progress: { current: number; total: number; phase: string }; status?: SubStatus
}) {
  const { current, total, phase } = progress
  const pct = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0
  const done = status === 'done'
  const failed = status === 'failed'
  const barCls = done ? 'bg-green-400' : failed ? 'bg-red-400' : 'bg-blue-400'
  const txtCls = done ? 'text-green-300/80' : failed ? 'text-red-300/80' : 'text-blue-200/80'
  const trackCls = done ? 'bg-green-950' : failed ? 'bg-red-950' : 'bg-blue-950'
  return (
    <div>
      <div className={`flex items-center justify-between text-[8px] mb-0.5 ${txtCls}`}>
        <span className="truncate">{phase}</span>
        <span className="tabular-nums shrink-0 ml-1">{current}/{total} · {pct}%</span>
      </div>
      <div className={`h-1 rounded-full overflow-hidden ${trackCls}`}>
        <div className={`h-full ${barCls} transition-all duration-300`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

// Barre d'avancement live sous un node (step 4) — partagée par AppNode et DatasetNode.
export function NodeProgress({ progress }: { progress: { current: number; total: number; phase: string } }) {
  const { current, total, phase } = progress
  const pct = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0
  return (
    <div className="mt-1 mb-0.5 px-1.5 py-1 rounded bg-blue-950/40 border border-blue-800/40">
      <div className="flex items-center justify-between text-[9px] text-blue-200/90 mb-1">
        <span className="truncate capitalize">{phase}</span>
        <span className="tabular-nums shrink-0 ml-1">{current}/{total} · {pct}%</span>
      </div>
      <div className="h-1 rounded-full bg-blue-950 overflow-hidden">
        <div className="h-full bg-blue-400 transition-all duration-300" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

const APP_META: Record<AppNodeType, { icon: React.ReactNode; color: string; bg: string; title: string }> = {
  explorer: {
    icon: <Eye size={14} />,
    color: 'text-violet-400',
    bg: 'bg-violet-900/30 border-violet-700/30',
    title: 'Dataset Explorer',
  },
  annotation: {
    icon: <Tag size={14} />,
    color: 'text-rose-400',
    bg: 'bg-rose-900/30 border-rose-700/30',
    title: 'Annotation App',
  },
  dvc: {
    icon: <GitBranch size={14} />,
    color: 'text-amber-400',
    bg: 'bg-amber-900/30 border-amber-700/30',
    title: 'DVC App',
  },
  mlflow: {
    icon: <TrendingUp size={14} />,
    color: 'text-emerald-400',
    bg: 'bg-emerald-900/30 border-emerald-700/30',
    title: 'MLflow App',
  },
  optuna: {
    icon: <Settings2 size={14} />,
    color: 'text-cyan-400',
    bg: 'bg-cyan-900/30 border-cyan-700/30',
    title: 'Optuna App',
  },
  training: {
    icon: <Zap size={14} />,
    color: 'text-blue-400',
    bg: 'bg-blue-900/30 border-blue-700/30',
    title: 'Training App',
  },
  inference: {
    icon: <Crosshair size={14} />,
    color: 'text-cyan-400',
    bg: 'bg-cyan-900/30 border-cyan-700/30',
    title: 'Inference / Eval',
  },
}

// Émet un événement global pour mettre à jour les données d'un nœud (ex: toggle full_auto)
function dispatchUpdateNodeData(nodeId: string, data: Record<string, unknown>) {
  window.dispatchEvent(new CustomEvent('orch:update-node-data', {
    detail: { nodeId, data },
  }))
}

// Bouton « Choisir un subset/export existant » (mode FREE) — sélectionne le
// node (ouvre NodeConfigPanel, le vrai panneau de settings) et lui demande de
// se faire remarquer (scroll + halo 3s) au lieu d'afficher la liste directement
// sur le node (lourd — cf. Bob juillet 2026 : « je veux juste le bouton »).
function dispatchOpenPicker(nodeId: string) {
  window.dispatchEvent(new CustomEvent('orch:open-node-picker', {
    detail: { nodeId },
  }))
}

// Bouton compact partagé explorer/Annotation (FREE uniquement — LOCKED n'affiche
// plus rien de tout ça, ni sur le node ni dans les settings).
function PickerButton({ nodeId, label, color }: { nodeId: string; label: string; color: 'violet' | 'rose' }) {
  const cls = color === 'violet'
    ? 'border-violet-700/40 bg-violet-900/20 text-violet-300 hover:bg-violet-900/40 hover:border-violet-600/60'
    : 'border-rose-700/40 bg-rose-900/20 text-rose-300 hover:bg-rose-900/40 hover:border-rose-600/60'
  return (
    <button
      onClick={e => { e.stopPropagation(); dispatchOpenPicker(nodeId) }}
      className={`mt-1 flex items-center justify-center gap-1.5 w-full text-[10px] px-2 py-1 rounded border transition-colors ${cls}`}
    >
      <ListChecks size={11} />
      {label}
    </button>
  )
}

// Toggle réutilisable visible sur le nœud lui-même
function FullAutoToggle({ nodeId, value, color = 'indigo' }: { nodeId: string; value: boolean; color?: string }) {
  const on  = color === 'violet'
    ? 'bg-violet-900/50 text-violet-300 border-violet-700/40'
    : 'bg-indigo-900/50 text-indigo-300 border-indigo-700/40'
  const off = 'bg-gray-800 text-gray-500 border-gray-700'
  return (
    <button
      onClick={e => { e.stopPropagation(); dispatchUpdateNodeData(nodeId, { full_auto: !value }) }}
      className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border transition-colors ${value ? on : off}`}
    >
      {value ? 'Full Auto' : 'Manuel'}
    </button>
  )
}

function AppNode({ id, data, selected }: NodeProps) {
  const d = data as AppNodeData
  const [expanded, setExpanded] = useState(false)
  const inputHandles = (d.input_handles as string[] | undefined) ?? []

  const meta = APP_META[d.node_type] ?? APP_META.explorer
  const status = d.exec_status ?? 'idle'
  const ringCls = STATUS_RING[status]
  const isWaiting = status === 'waiting'
  const isFreeMode = (d.node_type === 'explorer' || d.node_type === 'annotation') && d.has_input === false

  const dvcPending = d.node_type === 'dvc' && Boolean(d.dvc_pending)

  return (
    <div className="relative">
      {/* Halo « à versionner » : large, orange, clignotant — visible sans zoomer. */}
      {dvcPending && (
        <div className="pointer-events-none absolute -inset-3 rounded-2xl bg-amber-500/20 blur-md animate-pulse" />
      )}
      <ExecOrderBadge order={d.exec_order} />
      <div className={`relative min-w-[248px] max-w-[300px] bg-gray-900 border border-gray-700 rounded-xl shadow-lg overflow-hidden ring-2 ${ringCls} transition-all ${selected ? 'ring-offset-1 ring-offset-gray-950' : ''} ${isWaiting ? 'shadow-orange-900/40 shadow-lg' : ''} ${dvcPending ? 'ring-amber-400/80 shadow-[0_0_28px_6px_rgba(245,158,11,0.35)]' : ''}`}>
      {/* Header */}
      <div className={`flex items-center gap-2 px-3 py-2.5 border-b ${meta.bg}`}>
        <span className={meta.color}>{meta.icon}</span>
        <span className={`text-xs font-semibold ${meta.color} flex-1`}>{meta.title}</span>

        {/* Badge FREE / LOCKED pour explorer, annotation et inference */}
        {(d.node_type === 'explorer' || d.node_type === 'annotation' || d.node_type === 'inference') && d.has_input !== undefined && (
          d.has_input === false
            ? <span title={d.node_type === 'inference'
                ? 'Mode FREE : ouvre Inference App pour choisir un fichier et un modèle'
                : 'Mode FREE : utilise des outputs existants du workspace'}
                className="flex items-center gap-0.5 text-[9px] px-1 py-0.5 rounded bg-emerald-900/50 text-emerald-400 border border-emerald-700/40 font-bold tracking-wide shrink-0">
                <Unlock size={8} />FREE
              </span>
            : <span title={d.node_type === 'inference'
                ? 'Mode LOCKED : reçoit un modèle/flux → éval / inférence'
                : 'Mode LOCKED : exécute un nouveau pipeline'}
                className="flex items-center gap-0.5 text-[9px] px-1 py-0.5 rounded bg-amber-900/40 text-amber-400 border border-amber-700/30 font-bold tracking-wide shrink-0">
                <Lock size={8} />LOCKED
              </span>
        )}

        <StatusIcon status={status} />
        {d.frontend_url && (
          <a
            href={d.frontend_url}
            target="_blank"
            rel="noreferrer"
            onClick={e => e.stopPropagation()}
            className={`${meta.color} hover:opacity-80 transition-opacity`}
            title="Ouvrir l'application"
          >
            <ExternalLink size={12} />
          </a>
        )}
        <button onClick={() => setExpanded(e => !e)} className="text-gray-500 hover:text-white ml-1">
          {expanded ? <ChevronUp size={12}/> : <ChevronDown size={12}/>}
        </button>
      </div>

      {/* Failed step banner — affiche le détail de l'erreur sur le node */}
      {status === 'failed' && d.waiting_hint && (
        <div className="px-3 py-2.5 bg-red-950/60 border-b border-red-700/30">
          <div className="flex items-start gap-2">
            <XCircle size={12} className="text-red-400 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-[10px] font-semibold text-red-300">Étape échouée</p>
              <p className="text-[10px] text-red-400/80 mt-0.5 leading-tight break-words">{d.waiting_hint}</p>
            </div>
          </div>
        </div>
      )}
      {status === 'warning' && d.waiting_hint && (
        <div className="mx-2 mb-2 rounded-lg border border-amber-700/50 bg-amber-950/30 px-2 py-1.5 text-[10px] text-amber-200 whitespace-pre-wrap">
          <b>HPO échoué — fallback Training activé</b><br/>{d.waiting_hint}
        </div>
      )}

      {/* Doublon annotation : ce subset a déjà été annoté ailleurs (cf. check auto
          dans NodeConfigPanel) — visible sans ouvrir le panneau de config. */}
      {d.node_type === 'annotation' && (d.duplicate_matches?.length ?? 0) > 0 && (
        <div className="px-3 py-2.5 bg-amber-950/60 border-b border-amber-700/30">
          <div className="flex items-start gap-2">
            <AlertTriangle size={12} className="text-amber-400 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-[10px] font-semibold text-amber-300">Déjà annoté ailleurs</p>
              <p className="text-[10px] text-amber-400/80 mt-0.5 leading-tight break-words">
                {d.duplicate_matches!.map(p => p.name).join(', ')}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Waiting gate banner */}
      {isWaiting && (
        <div className="px-3 py-2.5 bg-orange-950/60 border-b border-orange-700/30">
          <div className="flex items-start gap-2">
            <AlertTriangle size={13} className="text-orange-400 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-[11px] font-semibold text-orange-300">Action requise</p>
              {d.waiting_hint && (
                <p className="text-[10px] text-orange-400/80 mt-0.5 leading-tight">{String(d.waiting_hint)}</p>
              )}
              {d.frontend_url && (
                <a
                  href={d.frontend_url}
                  target="_blank"
                  rel="noreferrer"
                  onClick={e => e.stopPropagation()}
                  className={`mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium ${meta.color} hover:opacity-80`}
                >
                  <ExternalLink size={10} />
                  Ouvrir {meta.title} →
                </a>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Body — node label / summary */}
      <div className="px-3 py-2">
        <p className="text-sm font-medium text-white truncate">{d.label || meta.title}</p>
        {/* Ligne LIVE (step 5) : action en cours affichée sur le nœud pendant un run. */}
        {status === 'running' && Boolean(d.current_step) && (
          <div className="flex items-center gap-1.5 mt-1 mb-0.5 px-1.5 py-1 rounded bg-blue-950/50 border border-blue-800/40">
            <Loader2 size={11} className="animate-spin text-blue-400 shrink-0" />
            <span className="text-[10px] text-blue-200 truncate">{d.current_step as string}</span>
          </div>
        )}
        <NodeSummary nodeId={id} data={d} isFreeMode={isFreeMode} />
      </div>

      {/* Config panel (expanded) */}
      {expanded && <NodeConfig data={d} isFreeMode={isFreeMode} />}

      {/* Blueprint — ENTRÉES (gauche) / SORTIES (droite) en lignes, handles typés
          posés sur le bord de chaque ligne. MLflow = superviseur : aucun port. */}
      <NodePorts nodeType={d.node_type} inputHandles={inputHandles} status={status} />
      </div>

      {/* Tray « suivi live » (step 4) — extension SOUS le node : timeline des
          sous-étapes + barre temps réel + résultats produits (best params, mAP…). */}
      <NodeActivity
        steps={d.activity_steps}
        progress={d.progress}
        results={d.result_summary}
      />
    </div>
  )
}

// Badge « ordre d'exécution logique » — petit numéro léger en haut à droite du node.
// Deux nodes avec le même numéro s'exécutent en parallèle (aucun ordre garanti entre eux).
function ExecOrderBadge({ order }: { order?: number }) {
  if (typeof order !== 'number') return null
  return (
    <div
      title={`Ordre d'exécution logique : étape ${order}`}
      className="absolute -top-2 -right-2 z-10 min-w-[18px] h-[18px] px-1 rounded-full bg-gray-950/90 border border-gray-600 text-gray-400 text-[10px] font-semibold flex items-center justify-center shadow-sm pointer-events-none"
    >
      {order}
    </div>
  )
}

function VisuNodeSummary({ nodeId, data: d, isFreeMode }: { nodeId: string; data: AppNodeData; isFreeMode: boolean }) {
  const fullAuto = d.full_auto === undefined ? true : Boolean(d.full_auto)
  return (
    <div className="text-[11px] text-gray-500 mt-0.5 space-y-0.5">
      {!isFreeMode && <FullAutoToggle nodeId={nodeId} value={fullAuto} color="violet" />}
      {d.subset_name && <p>subset: <span className="text-gray-400">{d.subset_name as string}</span></p>}
      {d.query && !isFreeMode && fullAuto && <p className="truncate">query: <span className="text-gray-400 italic">{d.query as string}</span></p>}
      {/* step 7 (puis refonte juillet 2026) : le choix d'un subset existant ne
          s'affiche DANS LE GRAPH qu'en mode FREE — un node LOCKED (Auto ou
          Manuel) ne montre plus rien ici (Manuel : le choix se fait à
          l'exécution, cf. VisuWaitingChoice dans SandgraphPage.tsx). Plus de
          liste toujours affichée directement sur le node (lourd, coûteux à
          chaque changement FREE/LOCKED) : un seul bouton ouvre le vrai panneau
          de settings et y fait défiler/briller la liste (orch:open-node-picker). */}
      {isFreeMode && (
        <PickerButton nodeId={nodeId} color="violet"
          label={d.subset_name ? `Subset : ${d.subset_name as string}` : 'Choisir un subset existant'} />
      )}
    </div>
  )
}

function AnnotationNodeSummary({ nodeId, data: d, isFreeMode }: { nodeId: string; data: AppNodeData; isFreeMode: boolean }) {
  const cls = (d.label_classes ?? []) as { name: string }[]
  const mode = (d.annotation_mode as string) === 'random' ? 'Aléatoire' : 'Séquentiel'
  const fullAuto = Boolean(d.full_auto)
  return (
    <div className="text-[11px] text-gray-500 mt-0.5 space-y-0.5">
      {!isFreeMode && (d.project_name || d.subset_name) && (
        <p>projet: <span className="text-gray-400">{(d.project_name as string) || (d.subset_name as string)}</span></p>
      )}
      {!isFreeMode && <FullAutoToggle nodeId={nodeId} value={fullAuto} />}
      {!isFreeMode && fullAuto && (
        <p>
          mode: <span className="text-gray-400">{mode}</span>
          <span className="ml-1.5 px-1 py-0.5 rounded text-[10px] bg-indigo-900/50 text-indigo-300">
            {`Auto IA · ${d.ai_model ?? 'sam3'}`}
          </span>
        </p>
      )}
      {!isFreeMode && cls.length > 0 && (
        <p className="truncate">classes: <span className="text-gray-400">{cls.map(c => c.name).join(', ')}</span></p>
      )}
      {/* step 6 (puis refonte juillet 2026) : les 3 modes restent bien distincts
          DANS LE GRAPH (canvas) — FREE = bouton qui ouvre le panneau de settings
          (.ver → Inference, YOLO → Training/Optuna, choix dans NodeConfigPanel) ;
          LOCKED (Auto OU Manuel) = RIEN ici (Auto : "masquer complètement" ;
          Manuel : le choix se fait à l'étape d'exécution — cf.
          AnnotationWaitingChoice, SandgraphPage.tsx). Plus de liste directement
          sur le node (lourd, coûteux à chaque changement FREE/LOCKED). */}
      {isFreeMode && (
        <PickerButton nodeId={nodeId} color="rose"
          label={d.export_name ? `Export : ${d.export_name as string}` : 'Choisir une annotation existante'} />
      )}
    </div>
  )
}

// step6 (Bob 2026-07-25) : DVC = OBSERVATEUR (comme MLflow). Plus branché. Il observe
// TOUT le graphe et liste les artefacts récupérables/versionnables (présents ○/✓). Le
// détail (chemins, download, choix de ce qui va dedans, commit) est dans le hub du
// panneau de config (DvcConfig). Ici : vue compacte sur le nœud.
function DvcNodeSummary({ data: d }: { data: AppNodeData }) {
  const arts = (d.dvc_artifacts as { kind: string; present: boolean; label: string }[] | undefined) ?? []
  const n = arts.filter(a => a.present).length
  return (
    <div className="text-[11px] text-gray-500 mt-0.5 space-y-0.5">
      <span className="inline-block text-[10px] px-1.5 py-0.5 rounded bg-amber-900/40 text-amber-300 border border-amber-700/40">
        Observateur · versionne / télécharge à la demande
      </span>
      <p className="text-[10px] text-gray-600 mt-0.5">Artefacts du graphe ({n}) :</p>
      <div className="space-y-0.5">
        {arts.map(a => (
          <p key={a.kind} className={`text-[10px] leading-tight ${a.present ? 'text-amber-300/80' : 'text-gray-600 italic'}`}>
            {a.present ? '✓' : '○'} {a.label}
          </p>
        ))}
      </div>
      <p className="text-[10px] text-gray-600 italic">→ ouvrir le node : hub récup + download + commit</p>
    </div>
  )
}

interface MlflowExp { name: string; n_runs: number; latest: { run_name: string; metrics: Record<string, number> }[] }
function MLflowNodeSummary({ data: d }: { nodeId: string; data: AppNodeData }) {
  // SUPERVISOR : observe le store MLflow du workspace (aucun branchement).
  const planned = (d.planned_runs as { label: string; kind: string; run: string }[] | undefined) ?? []
  const [exps, setExps] = useState<MlflowExp[] | null>(null)
  const [err, setErr] = useState(false)
  useEffect(() => {
    let alive = true
    const fetchSummary = () => {
      fetch('/api/graphs/meta/mlflow-summary')
        .then(r => r.json())
        .then(d => { if (alive) { setExps(d.available ? d.experiments : []); setErr(!d.available) } })
        .catch(() => { if (alive) setErr(true) })
    }
    fetchSummary()
    const t = setInterval(fetchSummary, 5000)   // observateur : rafraichit en continu
    return () => { alive = false; clearInterval(t) }
  }, [])

  return (
    <div className="text-[11px] text-gray-500 mt-0.5 space-y-0.5">
      <span className="inline-block text-[10px] px-1.5 py-0.5 rounded bg-amber-900/40 text-amber-300 border border-amber-700/40">
        Superviseur · observe le store (pas de branchement)
      </span>
      {planned.length > 0 && (
        <div className="mt-0.5 border-l border-emerald-800/40 pl-1.5 space-y-0.5">
          <p className="text-[10px] text-emerald-400/80">À logger ({planned.length}) :</p>
          {planned.map((p, i) => (
            <p key={i} className="text-[10px] text-gray-400 break-all leading-tight">
              <span className="text-gray-500">{p.kind === 'training' ? '⚙' : '◎'}</span> {p.run}
            </p>
          ))}
        </div>
      )}
      <p className="text-[10px] text-gray-600 mt-0.5">Store (live) :</p>
      {err && <p className="text-[10px] text-gray-600 italic mt-0.5">MLflow_App non lancée</p>}
      {exps && exps.length === 0 && !err && <p className="text-[10px] text-gray-600 italic mt-0.5">aucun run encore</p>}
      {exps && exps.slice(0, 3).map(e => (
        <p key={e.name} className="text-[10px] break-all leading-tight">
          <span className="text-gray-400">{e.name}</span> · {e.n_runs} run{e.n_runs > 1 ? 's' : ''}
        </p>
      ))}
    </div>
  )
}

const INFER_TASKS = ['tracking', 'detection'] as const
const TASK_LABEL: Record<string, string> = {
  tracking: 'Tracking', detection: 'Détection (YOLO)',
}
function InferenceNodeSummary({ nodeId, data: d }: { nodeId: string; data: AppNodeData }) {
  // FREE = ouverture manuelle de l'app ; LOCKED = évaluation ou inférence.
  if (d.has_input === false) {
    return (
      <div className="text-[11px] text-gray-500 mt-0.5 space-y-0.5">
        <span className="inline-block text-[10px] px-1.5 py-0.5 rounded bg-emerald-900/50 text-emerald-300 border border-emerald-700/40">
          Session fichier manuelle
        </span>
        <p className="text-[10px] text-gray-600">image, vidéo ou dossier · YOLO / MOT / SOT clic</p>
      </div>
    )
  }
  const fullAuto = d.full_auto === undefined ? true : Boolean(d.full_auto)
  const task = (d.task as string) ?? 'tracking'
  const cycleTask = () => {
    const i = INFER_TASKS.indexOf(task as typeof INFER_TASKS[number])
    dispatchUpdateNodeData(nodeId, { task: INFER_TASKS[(i + 1) % INFER_TASKS.length] })
  }
  return (
    <div className="text-[11px] text-gray-500 mt-0.5 space-y-0.5">
      <button onClick={e => { e.stopPropagation(); dispatchUpdateNodeData(nodeId, { full_auto: !fullAuto }) }}
        className={`text-[10px] px-1.5 py-0.5 rounded border ${fullAuto
          ? 'bg-gray-800 text-gray-400 border-gray-700/40' : 'bg-amber-900/50 text-amber-300 border-amber-700/40'}`}>
        {fullAuto ? 'Auto (headless)' : 'Manuel (app)'}
      </button>
      {fullAuto ? (
        <>
          <button onClick={e => { e.stopPropagation(); cycleTask() }}
            className="ml-1 text-[10px] px-1.5 py-0.5 rounded border bg-cyan-900/50 text-cyan-300 border-cyan-700/40">
            {TASK_LABEL[task] ?? task}
          </button>
          {task === 'tracking' && <span className="ml-1 text-[10px] text-amber-400">{d.tracker_mot === 'none' ? 'YOLO pur' : 'ByteTrack'}</span>}
          <p className="text-[10px]">modèle : <span className="text-gray-400">{(d.model_path as string) || 'best.pt amont'}</span></p>
        </>
      ) : (
        <p className="text-[10px] text-amber-400/80 italic">SOT/MOT dans l'app</p>
      )}
    </div>
  )
}

function OptunaNodeSummary({ nodeId, data: d }: { nodeId: string; data: AppNodeData }) {
  const fullAuto = d.full_auto === undefined ? true : Boolean(d.full_auto)
  const optimize = (d.optimize as string[]) ?? []
  const nTrials  = (d.n_trials as number) ?? 20
  return (
    <div className="text-[11px] text-gray-500 mt-0.5 space-y-0.5">
      <FullAutoToggle nodeId={nodeId} value={fullAuto} />
      {fullAuto ? (
        <>
          <p className="text-[10px]">optimise : <span className="text-cyan-300">{optimize.length ? optimize.join(', ') : 'à définir (config)'}</span></p>
          <p className={`text-[10px] ${d.stop_on_failure === false ? 'text-amber-300' : 'text-red-300'}`}>{d.stop_on_failure === false ? 'échec → paramètres Training' : 'échec → arrêt pipeline'}</p>
          <p className="text-[10px]">trials : <span className="text-gray-400">{nTrials}</span> · TPE + pruning</p>
          <p className="text-[10px] text-gray-600">→ best params auto → Training aval</p>
        </>
      ) : (
        <>
          <p className="text-[10px] text-amber-400 italic">Gate — ouvrir Optuna App, puis inscrire les best params</p>
          {d.best_params ? <p className="text-[10px]">params : <span className="text-cyan-300 font-mono">{String(d.best_params)}</span></p> : null}
        </>
      )}
    </div>
  )
}

function NodeSummary({ nodeId, data: d, isFreeMode }: { nodeId: string; data: AppNodeData; isFreeMode: boolean }) {
  if (d.node_type === 'explorer') return <VisuNodeSummary nodeId={nodeId} data={d} isFreeMode={isFreeMode} />
  if (d.node_type === 'annotation') return <AnnotationNodeSummary nodeId={nodeId} data={d} isFreeMode={isFreeMode} />
  if (d.node_type === 'mlflow') return <MLflowNodeSummary nodeId={nodeId} data={d} />
  if (d.node_type === 'optuna') return <OptunaNodeSummary nodeId={nodeId} data={d} />
  if (d.node_type === 'inference') return <InferenceNodeSummary nodeId={nodeId} data={d} />
  if (d.node_type === 'dvc') return <DvcNodeSummary data={d} />
  if (d.node_type === 'training') {
    const fullAuto = d.full_auto === undefined ? true : Boolean(d.full_auto)
    const size = [d.engine, d.model_size].filter(Boolean).join(' ') || 'taille par défaut'
    const ep   = (d.epochs as number) ?? 300
    return (
      <div className="text-[11px] text-gray-500 mt-0.5 space-y-0.5">
        <FullAutoToggle nodeId={nodeId} value={fullAuto} />
        <p>modèle : <span className="text-blue-400 font-mono">{size}</span></p>
        <p>epochs : <span className="text-gray-400">{ep}</span></p>
        {!fullAuto && (
          <p className="text-[10px] text-amber-400 italic">Manuel — ouvrir Training App</p>
        )}
      </div>
    )
  }
  return null
}

function NodeConfig({ data: d, isFreeMode }: { data: AppNodeData; isFreeMode: boolean }) {
  return (
    <div className="px-3 pb-3 pt-2 border-t border-gray-800 space-y-1.5">
      {d.node_type === 'explorer' && (
        <>
          {!isFreeMode && <Field label="dataset" value={d.dataset_name ?? '—'} />}
          <Field label="subset"  value={d.subset_name ?? '—'} />
          {!isFreeMode && <Field label="query"   value={d.query ?? '—'} />}
          {!isFreeMode && <Field label="top_k"   value={String(d.top_k ?? 50)} />}
        </>
      )}
      {d.node_type === 'annotation' && (
          <>
            <Field label="subset"  value={d.subset_name ?? '—'} />
            <Field label="projet"  value={(d.project_name as string) || (d.subset_name ?? '—')} />
            {!isFreeMode && <Field label="mode"    value={(d.annotation_mode as string) === 'random' ? 'Aléatoire' : 'Séquentiel'} />}
            {!isFreeMode && <Field label="train"   value={`${((d.split_train ?? 0.8) * 100).toFixed(0)}%`} />}
            {!isFreeMode && <Field label="val"     value={`${((d.split_val ?? 0.2) * 100).toFixed(0)}%`} />}
            {!isFreeMode && Boolean(d.full_auto) && (
              <Field label="IA" value={`${d.ai_model ?? 'sam3'} @ ${d.ai_threshold ?? 0.5}`} />
            )}
            {!isFreeMode && (d.label_classes as { name: string; color: string }[] ?? []).map(lc => (
              <div key={lc.name} className="flex items-center gap-1.5 text-[11px]">
                <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: lc.color }} />
                <span className="text-gray-300">{lc.name}</span>
              </div>
            ))}
          </>
      )}
      {d.node_type === 'dvc' && (
        <Field label="message" value={d.commit_message ?? '—'} />
      )}
      {(d.node_type === 'mlflow' || d.node_type === 'optuna') && (
        <p className="text-[11px] text-gray-500 italic">Étape manuelle</p>
      )}
      {d.node_type === 'training' && (
        <>
          <Field label="moteur"   value={(d.engine as string) || 'par défaut'} />
          <Field label="taille"   value={(d.model_size   as string) || 'par défaut'} />
          <Field label="epochs"   value={String((d.epochs as number) ?? 300)} />
          <Field label="batch"    value={String((d.batch  as number) ?? 16)} />
          <Field label="imgsz"    value={String((d.imgsz  as number) ?? 640)} />
        </>
      )}
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="text-gray-500 w-16 shrink-0">{label}</span>
      <span className="text-gray-300 font-mono truncate">{value}</span>
    </div>
  )
}

function StatusIcon({ status }: { status: NodeExecStatus }) {
  if (status === 'running') return <Loader2 size={12} className="text-blue-400 animate-spin shrink-0" />
  if (status === 'waiting') return <AlertTriangle size={12} className="text-orange-400 shrink-0" />
  if (status === 'done')    return <CheckCircle2 size={12} className="text-green-400 shrink-0" />
  if (status === 'warning') return <AlertTriangle size={12} className="text-amber-400 shrink-0" />
  if (status === 'failed')  return <span className="w-2.5 h-2.5 rounded-full bg-red-500 shrink-0" />
  return <span className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[status]}`} />
}

export default memo(AppNode)
