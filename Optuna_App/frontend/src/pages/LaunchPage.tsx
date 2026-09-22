// ============================================================
// LaunchPage.tsx
// Configure + launch an optimization run with live SSE logs.
// ============================================================

import { useState, useRef, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { studiesAPI, streamLogs } from '../api/client'
import { useInvalidateStudies } from '../hooks/useStudies'
import toast from 'react-hot-toast'
import { Play, Plus, Trash2, ArrowLeft, X } from 'lucide-react'
import type { ParamSpec, LogEvent } from '../types/api'
import EnginePreset, { type EnginePresetValue } from '../components/EnginePreset'
import { useT } from '../i18n/useLang'

type ParamType = 'float' | 'int' | 'categorical'

interface ParamRow {
  id: number
  name: string
  type: ParamType
  low: string
  high: string
  log: boolean
  choices: string
}

let _nextId = 1
function makeRow(): ParamRow {
  return { id: _nextId++, name: '', type: 'float', low: '', high: '', log: false, choices: '' }
}

function rowFromSpec(spec: ParamSpec): ParamRow {
  return {
    ...makeRow(),
    name:    spec.name,
    type:    spec.type,
    low:     spec.low !== undefined ? String(spec.low) : '',
    high:    spec.high !== undefined ? String(spec.high) : '',
    log:     Boolean(spec.log),
    choices: (spec.choices ?? []).join(', '),
  }
}

function buildParamSpec(row: ParamRow): ParamSpec | null {
  if (!row.name.trim()) return null
  if (row.type === 'categorical') {
    const choices = row.choices.split(',').map(s => s.trim()).filter(Boolean)
    if (choices.length === 0) return null
    return { name: row.name.trim(), type: 'categorical', choices }
  }
  const low  = parseFloat(row.low)
  const high = parseFloat(row.high)
  if (isNaN(low) || isNaN(high) || low >= high) return null
  return { name: row.name.trim(), type: row.type, low, high, log: row.log }
}

// Module-level cancel fn to survive re-renders
let _cancelSSE: (() => void) | null = null

export default function LaunchPage() {
  const t = useT()
  const { studyName } = useParams<{ studyName: string }>()
  const navigate      = useNavigate()
  const invalidate    = useInvalidateStudies()
  const decodedName   = studyName ? decodeURIComponent(studyName) : ''

  const [scriptPath,  setScriptPath]  = useState('')
  const [scriptArgs,  setScriptArgs]  = useState<string[]>([])
  const [nTrials,     setNTrials]     = useState(20)
  const [metricName,  setMetricName]  = useState('value')
  const [direction,   setDirection]   = useState<'minimize' | 'maximize'>('minimize')
  const [rows,        setRows]        = useState<ParamRow[]>([makeRow()])
  const [running,     setRunning]     = useState(false)
  const [logs,        setLogs]        = useState<string[]>([])
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    return () => { _cancelSSE?.(); _cancelSSE = null }
  }, [])

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [logs])

  function addRow() { setRows(r => [...r, makeRow()]) }
  function removeRow(id: number) { setRows(r => r.filter(x => x.id !== id)) }
  function updateRow(id: number, patch: Partial<ParamRow>) {
    setRows(r => r.map(x => x.id === id ? { ...x, ...patch } : x))
  }

  function applyPreset(value: EnginePresetValue) {
    setScriptPath(value.scriptPath)
    setScriptArgs(value.scriptArgs)
    setRows(value.params.length ? value.params.map(rowFromSpec) : [makeRow()])
    setMetricName(value.metricName)
    setDirection(value.direction)
  }

  async function handleLaunch() {
    const param_space: ParamSpec[] = []
    for (const row of rows) {
      const spec = buildParamSpec(row)
      if (!spec) {
        toast.error(`${t('Paramètre')} "${row.name || '?'}" ${t('invalide — vérifiez les champs')}`)
        return
      }
      param_space.push(spec)
    }

    if (!scriptPath.trim()) {
      toast.error(t('Chemin du script requis'))
      return
    }

    setLogs([])
    setRunning(true)

    try {
      await studiesAPI.start(decodedName, {
        script_path: scriptPath.trim(),
        script_args: scriptArgs,
        n_trials:    nTrials,
        metric_name: metricName.trim() || 'value',
        direction,
        param_space,
      })
    } catch (e: any) {
      const msg = e?.response?.data?.detail ?? t('Erreur au démarrage')
      toast.error(msg)
      setRunning(false)
      return
    }

    invalidate(decodedName)

    _cancelSSE?.()
    _cancelSSE = streamLogs(
      decodedName,
      (evt: LogEvent) => {
        if (evt.type === 'log' && evt.line) {
          setLogs(l => [...l, evt.line!])
        } else if (evt.type === 'status') {
          setLogs(l => [...l, `[status] ${evt.status} — completed: ${evt.completed ?? '?'}/${evt.n_trials ?? '?'}`])
        } else if (evt.type === 'done') {
          setLogs(l => [...l, `— ${t('optimisation terminée')} —`])
          setRunning(false)
          invalidate(decodedName)
        }
      },
      () => {
        setRunning(false)
        invalidate(decodedName)
      },
    )
  }

  function handleStop() {
    _cancelSSE?.(); _cancelSSE = null
    studiesAPI.stop(decodedName).catch(() => {})
    setRunning(false)
    setLogs(l => [...l, `— ${t('arrêt demandé')} —`])
    invalidate(decodedName)
  }

  return (
    <div className="p-6 space-y-5 max-w-3xl">
      {/* Back */}
      <button
        onClick={() => navigate(`/studies/${studyName}`)}
        className="flex items-center gap-2 text-gray-400 hover:text-white text-sm transition-colors"
      >
        <ArrowLeft size={16} /> {decodedName}
      </button>

      <h1 className="text-xl font-semibold text-white">{t('Lancer une optimisation')}</h1>

      <EnginePreset studyName={decodedName} onApply={applyPreset} />

      {/* Script path */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-4">
        <h2 className="text-sm font-semibold text-gray-300">{t('Script d\'objectif')}</h2>
        <div>
          <label className="block text-xs text-gray-500 mb-1">{t('Chemin absolu vers le script Python')}</label>
          <input
            value={scriptPath}
            onChange={e => setScriptPath(e.target.value)}
            placeholder="/workspace/train.py"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500"
          />
          <p className="text-xs text-gray-600 mt-1.5">
            {t('Le script reçoit les hyperparamètres comme arguments (')}<code className="text-gray-400">--param_name valeur</code>{t(') et doit imprimer la métrique en dernière ligne sur stdout.')}
          </p>
        </div>

        {scriptArgs.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-gray-500">{t('Arguments fixes (avant les hyperparamètres)')}</label>
              <button
                onClick={() => setScriptArgs([])}
                className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-red-400"
              >
                <X size={11} /> {t('Retirer')}
              </button>
            </div>
            <code className="block bg-gray-800/60 border border-gray-800 rounded-lg px-3 py-2 text-xs text-gray-400 break-all">
              {scriptArgs.join(' ')}
            </code>
          </div>
        )}

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">{t('Nombre de trials')}</label>
            <input
              type="number" min={1} max={10000}
              value={nTrials}
              onChange={e => setNTrials(Math.max(1, parseInt(e.target.value) || 1))}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">{t('Nom de la métrique')}</label>
            <input
              value={metricName}
              onChange={e => setMetricName(e.target.value)}
              placeholder="value"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">{t('Direction')}</label>
            <select
              value={direction}
              onChange={e => setDirection(e.target.value as 'minimize' | 'maximize')}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
            >
              <option value="minimize">minimize</option>
              <option value="maximize">maximize</option>
            </select>
          </div>
        </div>
      </div>

      {/* Param space */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-300">{t('Espace des hyperparamètres')}</h2>
          <button
            onClick={addRow}
            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs rounded-lg border border-gray-700 transition-colors"
          >
            <Plus size={12} /> {t('Ajouter')}
          </button>
        </div>

        {rows.map(row => (
          <div key={row.id} className="grid grid-cols-12 gap-2 items-start">
            {/* Name */}
            <div className="col-span-3">
              <input
                value={row.name}
                onChange={e => updateRow(row.id, { name: e.target.value })}
                placeholder={t('nom')}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500"
              />
            </div>

            {/* Type */}
            <div className="col-span-2">
              <select
                value={row.type}
                onChange={e => updateRow(row.id, { type: e.target.value as ParamType })}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
              >
                <option value="float">float</option>
                <option value="int">int</option>
                <option value="categorical">categorical</option>
              </select>
            </div>

            {/* Range or choices */}
            {row.type === 'categorical' ? (
              <div className="col-span-6">
                <input
                  value={row.choices}
                  onChange={e => updateRow(row.id, { choices: e.target.value })}
                  placeholder="val1, val2, val3"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500"
                />
              </div>
            ) : (
              <>
                <div className="col-span-2">
                  <input
                    value={row.low}
                    onChange={e => updateRow(row.id, { low: e.target.value })}
                    placeholder="min"
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div className="col-span-2">
                  <input
                    value={row.high}
                    onChange={e => updateRow(row.id, { high: e.target.value })}
                    placeholder="max"
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div className="col-span-2 flex items-center gap-1.5 px-1 pt-1.5">
                  <input
                    id={`log-${row.id}`}
                    type="checkbox"
                    checked={row.log}
                    onChange={e => updateRow(row.id, { log: e.target.checked })}
                    className="accent-indigo-500"
                  />
                  <label htmlFor={`log-${row.id}`} className="text-xs text-gray-400 select-none">log</label>
                </div>
              </>
            )}

            {/* Delete */}
            <div className="col-span-1 flex justify-end">
              <button
                onClick={() => removeRow(row.id)}
                className="p-1.5 text-gray-600 hover:text-red-400 hover:bg-gray-800 rounded transition-colors"
              >
                <Trash2 size={13} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Launch / Stop */}
      <div className="flex items-center gap-3">
        {!running ? (
          <button
            onClick={handleLaunch}
            className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm rounded-lg font-medium transition-colors"
          >
            <Play size={14} /> {t('Lancer')}
          </button>
        ) : (
          <button
            onClick={handleStop}
            className="flex items-center gap-2 px-4 py-2.5 bg-red-700/60 hover:bg-red-700/80 text-red-300 text-sm rounded-lg font-medium border border-red-700/30 transition-colors"
          >
            {t('Arrêter')}
          </button>
        )}
        {running && (
          <span className="text-xs text-blue-400 flex items-center gap-1.5">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
            {t('Optimisation en cours…')}
          </span>
        )}
      </div>

      {/* Logs */}
      {logs.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="px-4 py-2 border-b border-gray-800 text-xs text-gray-500 font-medium">
            {t('Sortie')}
          </div>
          <div
            ref={logRef}
            className="p-4 h-64 overflow-y-auto font-mono text-xs text-gray-300 space-y-0.5 scrollbar-thin"
          >
            {logs.map((line, i) => (
              <div
                key={i}
                className={
                  line.startsWith('[status]') ? 'text-indigo-400' :
                  line.startsWith('— ') ? 'text-emerald-400 mt-1' :
                  'text-gray-400'
                }
              >
                {line}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
