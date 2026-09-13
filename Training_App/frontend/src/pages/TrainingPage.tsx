// ============================================================
// pages/TrainingPage.tsx
// Interface principale — lancement + suivi temps reel.
// ============================================================

import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  Play, Square, FolderOpen, Cpu, Zap, ChevronDown, ChevronUp,
  BarChart2, RefreshCw,
} from 'lucide-react'
import { appModeAPI, streamTrainingEvents, trainingAPI } from '../api/client'
import type { ModelCatalog, TrainingEvent } from '../types/api'

// ── Hyperparams definition ────────────────────────────────────────────────────

const HYPERPARAM_GROUPS = [
  {
    label: 'Entrainement',
    params: [
      { key: 'epochs',       label: 'Epochs',          type: 'int',   min: 1,   max: 1000, step: 1 },
      { key: 'patience',     label: 'Patience',         type: 'int',   min: 0,   max: 300,  step: 1 },
      { key: 'batch',        label: 'Batch size',       type: 'int',   min: 1,   max: 512,  step: 1 },
      { key: 'imgsz',        label: 'Image size',       type: 'int',   min: 32,  max: 1920, step: 32 },
      { key: 'workers',      label: 'Workers',          type: 'int',   min: 0,   max: 32,   step: 1 },
      { key: 'device',       label: 'Device',           type: 'text', placeholder: 'auto / cpu / 0 / 0,1' },
    ],
  },
  {
    label: 'Learning rate',
    params: [
      { key: 'lr0',             label: 'LR initial',       type: 'float', min: 0,   max: 1, step: 0.0001 },
      { key: 'lrf',             label: 'LR final (×lr0)',  type: 'float', min: 0,   max: 1, step: 0.0001 },
      { key: 'momentum',        label: 'Momentum',         type: 'float', min: 0,   max: 1, step: 0.001 },
      { key: 'weight_decay',    label: 'Weight decay',     type: 'float', min: 0,   max: 1, step: 0.00001 },
      { key: 'warmup_epochs',   label: 'Warmup epochs',    type: 'float', min: 0,   max: 10, step: 0.5 },
      { key: 'warmup_momentum', label: 'Warmup momentum',  type: 'float', min: 0,   max: 1, step: 0.01 },
      { key: 'warmup_bias_lr',  label: 'Warmup bias LR',   type: 'float', min: 0,   max: 1, step: 0.01 },
    ],
  },
  {
    label: 'Poids des pertes',
    params: [
      { key: 'box', label: 'Box loss',  type: 'float', min: 0, max: 20, step: 0.1 },
      { key: 'cls', label: 'Cls loss',  type: 'float', min: 0, max: 5,  step: 0.1 },
      { key: 'dfl', label: 'DFL loss',  type: 'float', min: 0, max: 5,  step: 0.1 },
    ],
  },
  {
    label: 'Data augmentation',
    params: [
      { key: 'hsv_h',        label: 'HSV Hue',        type: 'float', min: 0, max: 1,   step: 0.005 },
      { key: 'hsv_s',        label: 'HSV Saturation', type: 'float', min: 0, max: 1,   step: 0.05 },
      { key: 'hsv_v',        label: 'HSV Value',      type: 'float', min: 0, max: 1,   step: 0.05 },
      { key: 'degrees',      label: 'Rotation (°)',   type: 'float', min: 0, max: 180, step: 1 },
      { key: 'translate',    label: 'Translation',    type: 'float', min: 0, max: 1,   step: 0.05 },
      { key: 'scale',        label: 'Scale',          type: 'float', min: 0, max: 1,   step: 0.05 },
      { key: 'shear',        label: 'Shear (°)',      type: 'float', min: 0, max: 45,  step: 0.5 },
      { key: 'perspective',  label: 'Perspective',    type: 'float', min: 0, max: 0.001, step: 0.0001 },
      { key: 'flipud',       label: 'Flip vertical',  type: 'float', min: 0, max: 1,   step: 0.05 },
      { key: 'fliplr',       label: 'Flip horizontal',type: 'float', min: 0, max: 1,   step: 0.05 },
      { key: 'mosaic',       label: 'Mosaic',         type: 'float', min: 0, max: 1,   step: 0.05 },
      { key: 'mixup',        label: 'Mixup',          type: 'float', min: 0, max: 1,   step: 0.05 },
      { key: 'copy_paste',   label: 'Copy-paste',     type: 'float', min: 0, max: 1,   step: 0.05 },
      { key: 'erasing',      label: 'Random erasing', type: 'float', min: 0, max: 1,   step: 0.05 },
      { key: 'close_mosaic', label: 'Close mosaic (ép.)', type: 'int', min: 0, max: 50, step: 1 },
    ],
  },
]

// ── Component ─────────────────────────────────────────────────────────────────

export default function TrainingPage() {
  const qc = useQueryClient()

  // App mode
  const [appMode, setAppMode] = useState<'solo' | 'orchestrator' | null>(null)
  const [runsDir, setRunsDir] = useState('')

  // Model selection
  const [yoloVersion, setYoloVersion] = useState('yolov8')
  const [modelSize, setModelSize]     = useState('n')

  // Dataset
  const [dataYaml, setDataYaml]         = useState('')
  const [datasetName, setDatasetName]   = useState('')

  // Hyperparams state
  const [hyperparams, setHyperparams] = useState<Record<string, string>>({})
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(['Entrainement', 'Learning rate', 'Data augmentation']))

  // Active run
  const [runName, setRunName]     = useState<string | null>(null)
  const [running, setRunning]     = useState(false)
  const [events, setEvents]       = useState<TrainingEvent[]>([])
  const stopSSE = useRef<(() => void) | null>(null)

  const { data: catalog } = useQuery<ModelCatalog>({
    queryKey: ['models'],
    queryFn: () => trainingAPI.models(),
    staleTime: Infinity,
  })

  // Init defaults
  useEffect(() => {
    if (catalog) {
      const d: Record<string, string> = {}
      Object.entries(catalog.defaults).forEach(([k, v]) => {
        d[k] = String(v)
      })
      setHyperparams(d)
    }
  }, [catalog])

  useEffect(() => {
    appModeAPI.get().then(data => {
      setAppMode(data.mode)
      setRunsDir(data.runs_dir)
    }).catch(() => setAppMode('solo'))
  }, [])

  // Reset size when version changes
  useEffect(() => {
    const sizes = catalog?.sizes[yoloVersion] ?? []
    if (sizes.length && !sizes.includes(modelSize)) setModelSize(sizes[0])
  }, [yoloVersion, catalog, modelSize])

  const sizes = catalog?.sizes[yoloVersion] ?? ['n', 's', 'm', 'l', 'x']

  const setParam = (key: string, value: string) =>
    setHyperparams(p => ({ ...p, [key]: value }))

  const toggleGroup = (label: string) =>
    setExpandedGroups(prev => {
      const next = new Set(prev)
      next.has(label) ? next.delete(label) : next.add(label)
      return next
    })

  // Latest epoch event
  const lastEpochEvt = [...events].reverse().find(e => e.type === 'epoch')
  const lastDoneEvt  = events.find(e => e.type === 'done')
  const lastErrorEvt = events.find(e => e.type === 'error')

  const handleStart = async () => {
    if (!dataYaml.trim()) return toast.error('Chemin data.yaml requis')

    const parsed: Record<string, number | string | boolean> = {}
    HYPERPARAM_GROUPS.forEach(g => g.params.forEach(p => {
      const raw = hyperparams[p.key]
      if (raw === undefined || raw === '') return
      if (p.type === 'int')   parsed[p.key] = parseInt(raw) || 0
      else if (p.type === 'float') parsed[p.key] = parseFloat(raw) || 0
      else parsed[p.key] = raw
    }))

    setRunning(true)
    setEvents([])
    try {
      const res = await trainingAPI.start({
        yolo_version:  yoloVersion,
        model_size:    modelSize,
        data_yaml:     dataYaml.trim(),
        dataset_name:  datasetName.trim() || undefined as unknown as string,
        hyperparams:   parsed,
      })
      setRunName(res.run_name)
      toast.success(`Run demarre : ${res.run_name}`)

      stopSSE.current = streamTrainingEvents(
        res.run_name,
        evt => setEvents(prev => [...prev, evt]),
        () => {
          setRunning(false)
          qc.invalidateQueries({ queryKey: ['runs'] })
        },
      )
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Erreur demarrage'
      toast.error(msg)
      setRunning(false)
    }
  }

  const handleStop = async () => {
    if (!runName) return
    stopSSE.current?.()
    await trainingAPI.stop(runName)
    setRunning(false)
    toast('Run arrete')
    qc.invalidateQueries({ queryKey: ['runs'] })
  }

  const progress = lastEpochEvt?.progress_pct ?? 0
  const epoch    = lastEpochEvt?.epoch ?? 0
  const total    = lastEpochEvt?.total_epochs ?? (parseInt(hyperparams.epochs ?? '100') || 100)
  const metrics  = lastEpochEvt?.metrics ?? {}

  return (
    <div className="min-h-screen p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Zap size={22} className="text-blue-400" /> Training App
        </h1>
        <p className="text-gray-400 mt-1 text-sm">
          Entrainement YOLO via Ultralytics — {appMode === 'orchestrator' ? 'mode orchestrateur' : 'mode solo'}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ── Left: config ─────────────────────────────────────────────── */}
        <div className="lg:col-span-1 space-y-4">

          {/* Model selector */}
          <section className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
            <h2 className="text-sm font-semibold text-white flex items-center gap-1.5">
              <Cpu size={14} className="text-blue-400" /> Modele YOLO
            </h2>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Version</label>
              <select
                value={yoloVersion}
                onChange={e => setYoloVersion(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-2 text-sm text-white"
              >
                {(catalog?.versions ?? ['yolov8', 'yolov9', 'yolov10', 'yolo11']).map(v => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Taille</label>
              <div className="flex gap-1 flex-wrap">
                {sizes.map(s => (
                  <button
                    key={s}
                    onClick={() => setModelSize(s)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-mono transition-colors border ${
                      modelSize === s
                        ? 'bg-blue-600/30 border-blue-500/60 text-blue-300'
                        : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600'
                    }`}
                  >
                    {s.toUpperCase()}
                  </button>
                ))}
              </div>
              <p className="text-xs text-gray-600 mt-1.5">
                Modele : <span className="font-mono text-gray-500">{yoloVersion}{modelSize}.pt</span>
              </p>
            </div>
          </section>

          {/* Dataset */}
          <section className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
            <h2 className="text-sm font-semibold text-white flex items-center gap-1.5">
              <FolderOpen size={14} className="text-amber-400" /> Dataset YOLO
            </h2>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Chemin data.yaml</label>
              <input
                type="text"
                value={dataYaml}
                onChange={e => setDataYaml(e.target.value)}
                placeholder="C:/data/dataset/data.yaml"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-2 text-xs text-white font-mono placeholder-gray-600 focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Nom du run (optionnel)</label>
              <input
                type="text"
                value={datasetName}
                onChange={e => setDatasetName(e.target.value)}
                placeholder="mon_dataset_v1"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-2 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-blue-500"
              />
            </div>
            {appMode === 'orchestrator' && (
              <div className="p-2 rounded-lg border border-blue-700/40 bg-blue-900/10">
                <p className="text-xs text-blue-300">Mode orchestrateur — chemin fourni automatiquement.</p>
                <p className="text-xs text-gray-600 mt-0.5 font-mono break-all">{runsDir}</p>
              </div>
            )}
          </section>

          {/* Actions */}
          <div className="flex gap-2">
            <button
              onClick={() => void handleStart()}
              disabled={running || !dataYaml.trim()}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium text-white bg-blue-600 hover:bg-blue-500 disabled:bg-gray-800 disabled:text-gray-600 transition-colors"
            >
              <Play size={15} />
              {running ? 'En cours...' : 'Lancer'}
            </button>
            {running && (
              <button
                onClick={() => void handleStop()}
                className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-sm text-red-400 border border-red-700/40 hover:bg-red-900/20 transition-colors"
              >
                <Square size={14} /> Stop
              </button>
            )}
          </div>
        </div>

        {/* ── Right: hyperparams + progress ──────────────────────────── */}
        <div className="lg:col-span-2 space-y-4">

          {/* Progress */}
          {runName && (
            <section className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
              <h2 className="text-sm font-semibold text-white flex items-center gap-1.5">
                <BarChart2 size={14} className="text-green-400" /> Progression
                {running && <RefreshCw size={12} className="text-gray-500 animate-spin ml-auto" />}
              </h2>

              <div className="flex items-center gap-3 text-xs text-gray-400">
                <span className="font-mono text-gray-300">{runName}</span>
                <span>·</span>
                <span>Epoch {epoch} / {total}</span>
                <span className={`ml-auto font-medium ${
                  lastDoneEvt  ? 'text-green-400' :
                  lastErrorEvt ? 'text-red-400'   :
                  running      ? 'text-blue-400'  : 'text-gray-500'
                }`}>
                  {lastDoneEvt ? 'Termine' : lastErrorEvt ? 'Erreur' : running ? 'En cours' : 'Arrete'}
                </span>
              </div>

              {/* Progress bar */}
              <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    lastDoneEvt ? 'bg-green-500' : lastErrorEvt ? 'bg-red-500' : 'bg-blue-500'
                  }`}
                  style={{ width: `${lastDoneEvt ? 100 : progress}%` }}
                />
              </div>

              {/* Metrics grid */}
              {Object.keys(metrics).length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {Object.entries(metrics).map(([k, v]) => (
                    <div key={k} className="bg-gray-800/60 rounded-lg px-2.5 py-2">
                      <p className="text-[10px] text-gray-500 truncate">{k}</p>
                      <p className="text-sm font-mono text-white mt-0.5">{typeof v === 'number' ? v.toFixed(4) : v}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Done summary */}
              {lastDoneEvt && lastDoneEvt.best_model_path && (
                <div className="p-2.5 bg-green-900/10 border border-green-700/30 rounded-lg">
                  <p className="text-xs text-green-300 font-medium mb-1">Modele sauvegarde :</p>
                  <p className="text-xs text-gray-300 font-mono break-all">{lastDoneEvt.best_model_path}</p>
                  <div className="flex gap-4 mt-2 text-xs text-gray-400">
                    {lastDoneEvt.map50    !== undefined && <span>mAP50 : <b className="text-white">{lastDoneEvt.map50?.toFixed(4)}</b></span>}
                    {lastDoneEvt.map5095  !== undefined && <span>mAP50-95 : <b className="text-white">{lastDoneEvt.map5095?.toFixed(4)}</b></span>}
                  </div>
                </div>
              )}

              {/* Error */}
              {lastErrorEvt && (
                <div className="p-2.5 bg-red-900/10 border border-red-700/30 rounded-lg">
                  <p className="text-xs text-red-400">{lastErrorEvt.message}</p>
                </div>
              )}
            </section>
          )}

          {/* Hyperparams */}
          <section className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <h2 className="text-sm font-semibold text-white px-4 py-3 border-b border-gray-800">
              Hyperparametres
            </h2>
            <div className="divide-y divide-gray-800">
              {HYPERPARAM_GROUPS.map(group => (
                <div key={group.label}>
                  <button
                    onClick={() => toggleGroup(group.label)}
                    className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-medium text-gray-300 hover:bg-gray-800/50 transition-colors"
                  >
                    {group.label}
                    {expandedGroups.has(group.label) ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                  </button>
                  {expandedGroups.has(group.label) && (
                    <div className="px-4 pb-3 grid grid-cols-2 gap-x-4 gap-y-2">
                      {group.params.map(p => (
                        <div key={p.key}>
                          <label className="text-[10px] text-gray-500 block mb-0.5">{p.label}</label>
                          <input
                            type={p.type === 'text' ? 'text' : 'number'}
                            value={hyperparams[p.key] ?? ''}
                            onChange={e => setParam(p.key, e.target.value)}
                            step={p.step}
                            min={p.min}
                            max={p.max}
                            placeholder={p.placeholder ?? ''}
                            className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-white font-mono focus:outline-none focus:border-blue-500"
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
