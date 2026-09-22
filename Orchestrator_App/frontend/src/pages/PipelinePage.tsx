// ============================================================
// PipelinePage.tsx
// Éditeur de pipeline + DAG SVG + exécution avec SSE.
// ============================================================

import { useState, useRef, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import {
  Play, Square, Save, ArrowLeft, ChevronDown, ChevronRight,
  CheckCircle2, XCircle, Loader2, Circle, Clock,
} from 'lucide-react'
import { usePipeline, useInvalidatePipelines } from '../hooks/usePipelines'
import { useInvalidateActivity } from '../hooks/useActivity'
import { pipelinesAPI, streamRun } from '../api/client'
import type { PipelineStep, StepStatus, AppName, RunEvent } from '../types/api'
import { useT } from '../i18n/useLang'

// ------------------------------------------------------------------ //
// Constants                                                           //
// ------------------------------------------------------------------ //

const APP_COLORS: Record<AppName, string> = {
  Annotation_App: 'bg-violet-900/50 text-violet-300 border-violet-700/40',
  Dataset_Explorer_App:   'bg-cyan-900/50 text-cyan-300 border-cyan-700/40',
  'dvc-app':      'bg-amber-900/50 text-amber-300 border-amber-700/40',
  'mlflow-app':   'bg-emerald-900/50 text-emerald-300 border-emerald-700/40',
  'optuna-app':   'bg-indigo-900/50 text-indigo-300 border-indigo-700/40',
}

const STATUS_NODE_COLOR: Record<StepStatus, string> = {
  pending: 'border-gray-600 bg-gray-900',
  running: 'border-blue-500 bg-blue-900/20',
  success: 'border-emerald-500 bg-emerald-900/20',
  failed:  'border-red-500 bg-red-900/20',
  waiting: 'border-orange-500 bg-orange-900/20',
}

const NODE_W = 180
const NODE_H = 64
const COL_GAP = 220
const ROW_GAP = 90
const PAD_X   = 24
const PAD_Y   = 24

// ------------------------------------------------------------------ //
// DAG layout                                                          //
// ------------------------------------------------------------------ //

function computePositions(steps: PipelineStep[]): Record<string, { x: number; y: number }> {
  const stepById = Object.fromEntries(steps.map(s => [s.id, s]))
  const depths: Record<string, number> = {}

  function getDepth(id: string): number {
    if (id in depths) return depths[id]
    const s = stepById[id]
    if (!s || s.depends_on.length === 0) { depths[id] = 0; return 0 }
    depths[id] = Math.max(...s.depends_on.map(getDepth)) + 1
    return depths[id]
  }
  steps.forEach(s => getDepth(s.id))

  const byDepth: Record<number, string[]> = {}
  for (const [id, d] of Object.entries(depths)) {
    if (!byDepth[d]) byDepth[d] = []
    byDepth[d].push(id)
  }

  const positions: Record<string, { x: number; y: number }> = {}
  for (const [depthStr, ids] of Object.entries(byDepth)) {
    const col = parseInt(depthStr)
    ids.forEach((id, row) => {
      positions[id] = {
        x: PAD_X + col * COL_GAP,
        y: PAD_Y + row * ROW_GAP,
      }
    })
  }
  return positions
}

function svgArrow(
  from: { x: number; y: number },
  to:   { x: number; y: number },
  key: string,
) {
  const x1 = from.x + NODE_W
  const y1 = from.y + NODE_H / 2
  const x2 = to.x
  const y2 = to.y + NODE_H / 2
  const cx = (x1 + x2) / 2
  return (
    <g key={key}>
      <path
        d={`M${x1},${y1} C${cx},${y1} ${cx},${y2} ${x2},${y2}`}
        fill="none" stroke="#374151" strokeWidth={1.5}
        markerEnd="url(#arrow)"
      />
    </g>
  )
}

// ------------------------------------------------------------------ //
// Step status icon                                                    //
// ------------------------------------------------------------------ //

function StepIcon({ status }: { status: StepStatus }) {
  if (status === 'running') return <Loader2 size={13} className="text-blue-400 animate-spin" />
  if (status === 'waiting') return <Clock size={13} className="text-orange-400 animate-pulse" />
  if (status === 'success') return <CheckCircle2 size={13} className="text-emerald-400" />
  if (status === 'failed')  return <XCircle size={13} className="text-red-400" />
  return <Circle size={13} className="text-gray-600" />
}

// ------------------------------------------------------------------ //
// Step inspector (right panel)                                        //
// ------------------------------------------------------------------ //

function StepInspector({
  step, stepStatus, onClose,
}: {
  step: PipelineStep
  stepStatus: { status: StepStatus; output: string } | null
  onClose: () => void
}) {
  const t = useT()
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="w-80 bg-gray-900 border-l border-gray-800 flex flex-col overflow-hidden shrink-0">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <span className="text-sm font-semibold text-white truncate">{step.label}</span>
        <button onClick={onClose} className="text-gray-500 hover:text-white text-xs">✕</button>
      </div>
      <div className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-3 text-xs">
        <div>
          <p className="text-gray-500 mb-1">App</p>
          <span className={`px-2 py-0.5 rounded border text-xs font-medium ${APP_COLORS[step.app] ?? 'bg-gray-800 text-gray-400 border-gray-700'}`}>
            {step.app}
          </span>
        </div>
        <div>
          <p className="text-gray-500 mb-1">Endpoint</p>
          <code className="text-gray-300 bg-gray-800 px-2 py-1 rounded block">
            {step.method} {step.endpoint}
          </code>
        </div>
        {step.depends_on.length > 0 && (
          <div>
            <p className="text-gray-500 mb-1">{t('Dépendances')}</p>
            <div className="flex flex-wrap gap-1">
              {step.depends_on.map(d => (
                <span key={d} className="bg-gray-800 text-gray-400 px-1.5 py-0.5 rounded font-mono">{d}</span>
              ))}
            </div>
          </div>
        )}
        <div>
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 text-gray-500 hover:text-gray-300 transition-colors"
          >
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            Params
          </button>
          {expanded && (
            <pre className="mt-1.5 bg-gray-800 p-2 rounded text-gray-300 overflow-x-auto text-[11px] whitespace-pre-wrap">
              {JSON.stringify(step.params, null, 2)}
            </pre>
          )}
        </div>
        {stepStatus && (
          <div>
            <p className="text-gray-500 mb-1 flex items-center gap-1.5">
              <StepIcon status={stepStatus.status} />
              {t('Sortie')}
            </p>
            {stepStatus.output ? (
              <pre className="bg-gray-950 border border-gray-800 p-2 rounded text-gray-300 overflow-x-auto text-[11px] whitespace-pre-wrap max-h-48 overflow-y-auto scrollbar-thin">
                {stepStatus.output}
              </pre>
            ) : (
              <span className="text-gray-600">—</span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ //
// DAG canvas                                                          //
// ------------------------------------------------------------------ //

function DagCanvas({
  steps,
  stepStatuses,
  selectedId,
  onSelect,
}: {
  steps: PipelineStep[]
  stepStatuses: Record<string, { status: StepStatus; output: string }>
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const t = useT()
  if (steps.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-600 text-sm">
        {t('Aucune étape — éditez le pipeline dans la bibliothèque')}
      </div>
    )
  }

  const positions = computePositions(steps)
  const maxX = Math.max(...Object.values(positions).map(p => p.x)) + NODE_W + PAD_X
  const maxY = Math.max(...Object.values(positions).map(p => p.y)) + NODE_H + PAD_Y

  return (
    <div className="overflow-auto scrollbar-thin flex-1">
      <svg
        width={Math.max(maxX, 400)}
        height={Math.max(maxY, 200)}
        className="block"
      >
        <defs>
          <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
            <path d="M0,0 L0,6 L8,3 z" fill="#374151" />
          </marker>
        </defs>

        {/* Arrows */}
        {steps.flatMap(step =>
          step.depends_on.map(dep => {
            const from = positions[dep]
            const to   = positions[step.id]
            if (!from || !to) return null
            return svgArrow(from, to, `${dep}->${step.id}`)
          })
        )}

        {/* Nodes */}
        {steps.map(step => {
          const pos    = positions[step.id]
          const status: StepStatus = stepStatuses[step.id]?.status ?? 'pending'
          const isSelected = selectedId === step.id

          return (
            <g
              key={step.id}
              transform={`translate(${pos.x},${pos.y})`}
              className="cursor-pointer"
              onClick={() => onSelect(step.id)}
            >
              <rect
                width={NODE_W} height={NODE_H} rx={8}
                className={`transition-all duration-300 ${STATUS_NODE_COLOR[status]}`}
                style={{
                  fill: status === 'running' ? 'rgba(30,64,175,0.2)' :
                        status === 'success' ? 'rgba(6,78,59,0.2)' :
                        status === 'failed'  ? 'rgba(127,29,29,0.2)' : '#111827',
                  stroke: status === 'running' ? '#3b82f6' :
                          status === 'success' ? '#10b981' :
                          status === 'failed'  ? '#ef4444' :
                          isSelected ? '#6366f1' : '#374151',
                  strokeWidth: isSelected ? 2 : 1.5,
                }}
              />
              {/* App badge */}
              <foreignObject x={8} y={6} width={NODE_W - 16} height={18}>
                <div className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium border ${APP_COLORS[step.app] ?? 'bg-gray-800 text-gray-400 border-gray-700'}`}>
                  {step.app}
                </div>
              </foreignObject>
              {/* Label */}
              <text
                x={NODE_W / 2} y={40}
                textAnchor="middle"
                className="text-[12px] font-medium select-none"
                style={{ fill: '#e5e7eb', fontSize: 12, fontWeight: 500 }}
              >
                {step.label.length > 20 ? step.label.slice(0, 18) + '…' : step.label}
              </text>
              {/* Status icon (top-right) */}
              <foreignObject x={NODE_W - 22} y={4} width={18} height={18}>
                <StepIcon status={status} />
              </foreignObject>
              {/* Step id */}
              <text
                x={10} y={NODE_H - 6}
                className="select-none"
                style={{ fill: '#6b7280', fontSize: 9 }}
              >
                {step.id}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

// ------------------------------------------------------------------ //
// Main page                                                           //
// ------------------------------------------------------------------ //

let _cancelSSE: (() => void) | null = null

export default function PipelinePage() {
  const t = useT()
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const invalidate = useInvalidatePipelines()
  const invalidateActivity = useInvalidateActivity()

  const { data: pipeline, isLoading } = usePipeline(id)

  const [selectedStepId, setSelectedStepId] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [runId, setRunId] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [statusLabel, setStatusLabel] = useState<string>('')
  const [stepStatuses, setStepStatuses] = useState<Record<string, { status: StepStatus; output: string }>>({})
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => () => {
    _cancelSSE?.(); _cancelSSE = null
    if (timerRef.current) clearInterval(timerRef.current)
  }, [])

  const resetRunState = useCallback(() => {
    setRunning(false)
    setElapsed(0)
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
  }, [])

  const handleRun = async () => {
    if (!id || !pipeline) return
    setStepStatuses({})
    setElapsed(0)
    setStatusLabel(t('Démarrage…'))

    try {
      const { run_id } = await pipelinesAPI.startRun(id)
      setRunId(run_id)
      setRunning(true)
      invalidateActivity()

      timerRef.current = setInterval(() => setElapsed(e => e + 1), 1000)

      _cancelSSE?.()
      _cancelSSE = streamRun(
        id,
        run_id,
        (evt: RunEvent) => {
          if (evt.step_id) {
            setStepStatuses(prev => ({
              ...prev,
              [evt.step_id!]: {
                status: (evt.status as StepStatus) ?? 'pending',
                output: evt.output ?? prev[evt.step_id!]?.output ?? '',
              },
            }))
            const lbl = evt.status === 'running' ? '▶' : evt.status === 'success' ? '✓' : evt.status === 'waiting' ? '⏸' : '✗'
            setStatusLabel(`${lbl} ${evt.step_id}`)
          }
          if (evt.type === 'waiting') {
            setStatusLabel(`⏸ ${t('En attente')} — ${evt.step_id}`)
            // Ne pas réinitialiser — pipeline en pause, pas terminé
          }
          if (evt.type === 'done') {
            setStatusLabel(evt.status === 'success' ? `✓ ${t('Succès')}` : `✗ ${t('Échoué')}`)
            resetRunState()
            invalidate(id)
            invalidateActivity()
          }
        },
        () => {
          resetRunState()
          invalidate(id)
          invalidateActivity()
        },
      )
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? t('Erreur au démarrage')
      toast.error(msg)
    }
  }

  const handleStop = async () => {
    _cancelSSE?.(); _cancelSSE = null
    resetRunState()
    setStatusLabel(t('Arrêté'))
    toast(t('Exécution interrompue'))
  }

  const steps = pipeline?.steps ?? []
  const selectedStep = steps.find(s => s.id === selectedStepId) ?? null
  const selectedStepStatus = selectedStepId ? (stepStatuses[selectedStepId] ?? null) : null

  if (isLoading) {
    return <div className="flex items-center justify-center h-full text-gray-500 text-sm">{t('Chargement…')}</div>
  }
  if (!pipeline) {
    return <div className="p-6 text-gray-500">{t('Pipeline introuvable')}</div>
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-800 shrink-0">
        <button
          onClick={() => navigate('/library')}
          className="flex items-center gap-1.5 text-gray-400 hover:text-white text-sm transition-colors"
        >
          <ArrowLeft size={15} /> {t('Bibliothèque')}
        </button>
        <span className="text-gray-700">|</span>
        <span className="text-sm font-semibold text-white truncate">{pipeline.name}</span>
        <span className="text-xs text-gray-600 font-mono">{steps.length} {t('étapes')}</span>
      </div>

      {/* Canvas + Inspector */}
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 flex flex-col overflow-hidden bg-gray-950">
          <DagCanvas
            steps={steps}
            stepStatuses={stepStatuses}
            selectedId={selectedStepId}
            onSelect={id => setSelectedStepId(prev => prev === id ? null : id)}
          />
        </div>
        {selectedStep && (
          <StepInspector
            step={selectedStep}
            stepStatus={selectedStepStatus}
            onClose={() => setSelectedStepId(null)}
          />
        )}
      </div>

      {/* Bottom bar */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-t border-gray-800 bg-gray-900 shrink-0">
        {!running ? (
          <button
            onClick={handleRun}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm rounded-lg font-medium transition-colors"
          >
            <Play size={13} /> {t('Exécuter')}
          </button>
        ) : (
          <button
            onClick={handleStop}
            className="flex items-center gap-2 px-4 py-2 bg-red-700/60 hover:bg-red-700/80 text-red-300 text-sm rounded-lg border border-red-700/30 transition-colors"
          >
            <Square size={13} /> {t('Arrêter')}
          </button>
        )}
        {statusLabel && (
          <span className={`text-xs font-medium ${
            statusLabel.startsWith('✓') ? 'text-emerald-400' :
            statusLabel.startsWith('✗') ? 'text-red-400' :
            'text-blue-400'
          }`}>
            {statusLabel}
          </span>
        )}
        {running && (
          <span className="ml-auto text-xs text-gray-500 font-mono">
            {Math.floor(elapsed / 60).toString().padStart(2, '0')}:{(elapsed % 60).toString().padStart(2, '0')}
          </span>
        )}
        {runId && !running && (
          <span className="ml-auto text-xs text-gray-700 font-mono">{runId}</span>
        )}
        <button
          onClick={() => navigate(`/library`)}
          className="ml-auto flex items-center gap-1.5 px-3 py-2 text-gray-400 hover:text-white hover:bg-gray-800 text-xs rounded-lg transition-colors"
        >
          <Save size={13} /> {t('Éditer')}
        </button>
      </div>
    </div>
  )
}
