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
import type { Capabilities, HyperparamValue, ModelCatalog, TrainingEvent } from '../types/api'
import { useT } from '../i18n/useLang'

// Formulaire, tailles et defauts viennent du catalogue du moteur choisi
// (GET /api/training/models?engine=...). Les valeurs non scalaires d'un
// catalogue (tuples) ne sont pas editables ici et gardent leur defaut.

function toField(value: HyperparamValue): string {
  return value === null || Array.isArray(value) ? '' : String(value)
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function TrainingPage() {
  const qc = useQueryClient()
  const t = useT()

  // App mode
  const [appMode, setAppMode] = useState<'solo' | 'orchestrator' | null>(null)
  const [runsDir, setRunsDir] = useState('')

  // Model selection
  const [engine, setEngine]             = useState('')
  const [modelSize, setModelSize]       = useState('')
  const [modelWeights, setModelWeights] = useState('')

  // Dataset
  const [dataYaml, setDataYaml]         = useState('')
  const [datasetName, setDatasetName]   = useState('')

  // Hyperparams state
  const [hyperparams, setHyperparams] = useState<Record<string, string>>({})
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(['Entrainement', 'Data augmentation']))

  // Active run
  const [runName, setRunName]     = useState<string | null>(null)
  const [running, setRunning]     = useState(false)
  const [events, setEvents]       = useState<TrainingEvent[]>([])
  const stopSSE = useRef<(() => void) | null>(null)

  const { data: caps } = useQuery<Capabilities>({
    queryKey: ['capabilities'],
    queryFn: () => trainingAPI.capabilities(),
    staleTime: Infinity,
  })
  const engines = (caps?.trainer_backends ?? []).filter(e => e.available)
  const unavailable = (caps?.trainer_backends ?? []).filter(e => !e.available)

  // Moteur par defaut de l'instance des que les capacites sont connues
  useEffect(() => {
    if (caps && !engine) setEngine(caps.active || caps.default)
  }, [caps, engine])

  const { data: catalog } = useQuery<ModelCatalog>({
    queryKey: ['models', engine],
    queryFn: () => trainingAPI.models(engine),
    enabled: Boolean(engine),
    staleTime: Infinity,
  })

  // Changement de moteur : defauts et taille de CE moteur (les cles d'un
  // moteur n'ont pas de sens pour un autre).
  useEffect(() => {
    if (!catalog) return
    const d: Record<string, string> = {}
    Object.entries(catalog.defaults).forEach(([k, v]) => { d[k] = toField(v) })
    setHyperparams(d)
    setModelSize(catalog.default_size)
  }, [catalog])

  useEffect(() => {
    appModeAPI.get().then(data => {
      setAppMode(data.mode)
      setRunsDir(data.runs_dir)
    }).catch(() => setAppMode('solo'))
  }, [])

  const sizes = catalog?.sizes ?? []
  const groups = catalog?.groups ?? []
  const sizePrefix = catalog?.size_prefix ?? ''
  const epochsKey = catalog?.keys.epochs ?? ''

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
    if (!dataYaml.trim()) return toast.error(t('Chemin data.yaml requis'))

    if (!catalog) return
    const parsed: Record<string, number | string | boolean> = {}
    groups.forEach(g => g.params.forEach(p => {
      const raw = hyperparams[p.key]
      if (raw === undefined || raw === '') return
      if (p.type === 'int')   parsed[p.key] = parseInt(raw) || 0
      else if (p.type === 'float') parsed[p.key] = parseFloat(raw) || 0
      else if (p.type === 'bool')  parsed[p.key] = raw === 'true'
      else parsed[p.key] = raw
    }))

    setRunning(true)
    setEvents([])
    try {
      const res = await trainingAPI.start({
        engine:        catalog.engine,
        model_size:    modelSize,
        model_weights: modelWeights.trim() || undefined,
        data_yaml:     dataYaml.trim(),
        dataset_name:  datasetName.trim() || undefined as unknown as string,
        hyperparams:   parsed,
      })
      setRunName(res.run_name)
      toast.success(`${t('Run demarre : ')}${res.run_name}`)
      if (res.ignored_hyperparams?.length)
        toast(`${t('Parametres ignores par ce moteur : ')}${res.ignored_hyperparams.join(', ')}`)

      stopSSE.current = streamTrainingEvents(
        res.run_name,
        evt => setEvents(prev => [...prev, evt]),
        () => {
          setRunning(false)
          qc.invalidateQueries({ queryKey: ['runs'] })
        },
      )
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? t('Erreur demarrage')
      toast.error(msg)
      setRunning(false)
    }
  }

  const handleStop = async () => {
    if (!runName) return
    stopSSE.current?.()
    await trainingAPI.stop(runName)
    setRunning(false)
    toast(t('Run arrete'))
    qc.invalidateQueries({ queryKey: ['runs'] })
  }

  const progress = lastEpochEvt?.progress_pct ?? 0
  const epoch    = lastEpochEvt?.epoch ?? 0
  const total    = lastEpochEvt?.total_epochs ?? (parseInt(hyperparams[epochsKey] ?? '') || 0)
  const metrics  = lastEpochEvt?.metrics ?? {}

  return (
    <div className="min-h-screen p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Zap size={22} className="text-blue-400" /> Training App
        </h1>
        <p className="text-gray-400 mt-1 text-sm">
          {t('Entrainement ')}{catalog?.label ?? ''} — {appMode === 'orchestrator' ? t('mode orchestrateur') : t('mode solo')}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ── Left: config ─────────────────────────────────────────────── */}
        <div className="lg:col-span-1 space-y-4">

          {/* Model selector */}
          <section className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
            <h2 className="text-sm font-semibold text-white flex items-center gap-1.5">
              <Cpu size={14} className="text-blue-400" /> {t('Modele')} {catalog?.label ?? ''}
            </h2>
            {engines.length > 1 && (
              <div>
                <label className="text-xs text-gray-400 mb-1 block">{t('Moteur')}</label>
                <div className="flex gap-1 flex-wrap">
                  {engines.map(e => (
                    <button
                      key={e.name}
                      onClick={() => { setEngine(e.name); setModelWeights('') }}
                      disabled={running}
                      className={`px-3 py-1.5 rounded-lg text-xs transition-colors border ${
                        engine === e.name
                          ? 'bg-blue-600/30 border-blue-500/60 text-blue-300'
                          : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600'
                      }`}
                    >
                      {e.label}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-gray-600 mt-1">
                  {t('Les poids produits ne se rechargent qu\'avec le moteur qui les a crees.')}
                </p>
              </div>
            )}
            {unavailable.map(e => (
              <p key={e.name} className="text-[10px] text-amber-500/80">
                {e.label} {t('indisponible : ')}{e.reason}
              </p>
            ))}
            <div>
              <label className="text-xs text-gray-400 mb-1 block">{t('Taille')}</label>
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
                    {sizePrefix ? s.replace(sizePrefix, '') : s}
                  </button>
                ))}
              </div>
              <p className="text-xs text-gray-600 mt-1.5">
                {t('Modele : ')}<span className="font-mono text-gray-500">{modelSize}</span>
              </p>
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">{t('Poids de depart (optionnel)')}</label>
              <input
                type="text"
                value={modelWeights}
                onChange={e => setModelWeights(e.target.value)}
                placeholder={catalog?.pretrained_by_default
                  ? `${t('vide = poids pre-entraines')} (${catalog.weights_suffixes.join(', ')})`
                  : `${t('vide = entrainement depuis zero')} (${catalog?.weights_suffixes.join(', ') ?? ''})`}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-2 text-xs text-white font-mono placeholder-gray-600 focus:outline-none focus:border-blue-500"
              />
            </div>
          </section>

          {/* Dataset */}
          <section className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
            <h2 className="text-sm font-semibold text-white flex items-center gap-1.5">
              <FolderOpen size={14} className="text-amber-400" /> {t('Dataset YOLO')}
            </h2>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">{t('Chemin data.yaml')}</label>
              <input
                type="text"
                value={dataYaml}
                onChange={e => setDataYaml(e.target.value)}
                placeholder="C:/data/dataset/data.yaml"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-2 text-xs text-white font-mono placeholder-gray-600 focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">{t('Nom du dataset (optionnel)')}</label>
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
                <p className="text-xs text-blue-300">{t('Mode orchestrateur — chemin fourni automatiquement.')}</p>
                <p className="text-xs text-gray-600 mt-0.5 font-mono break-all">{runsDir}</p>
              </div>
            )}
          </section>

          {/* Actions */}
          <div className="flex gap-2">
            <button
              onClick={() => void handleStart()}
              disabled={running || !dataYaml.trim() || !catalog}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium text-white bg-blue-600 hover:bg-blue-500 disabled:bg-gray-800 disabled:text-gray-600 transition-colors"
            >
              <Play size={15} />
              {running ? t('En cours...') : t('Lancer')}
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
                <BarChart2 size={14} className="text-green-400" /> {t('Progression')}
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
                  {lastDoneEvt ? t('Termine') : lastErrorEvt ? t('Erreur') : running ? t('En cours') : t('Arrete')}
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
                  <p className="text-xs text-green-300 font-medium mb-1">{t('Modele sauvegarde :')}</p>
                  <p className="text-xs text-gray-300 font-mono break-all">{lastDoneEvt.best_model_path}</p>
                  <div className="flex gap-4 mt-2 text-xs text-gray-400">
                    {lastDoneEvt.map50    !== undefined && <span>{t('mAP50 : ')}<b className="text-white">{lastDoneEvt.map50?.toFixed(4)}</b></span>}
                    {lastDoneEvt.map5095  !== undefined && <span>{t('mAP50-95 : ')}<b className="text-white">{lastDoneEvt.map5095?.toFixed(4)}</b></span>}
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
              {t('Hyperparametres')}
            </h2>
            <div className="divide-y divide-gray-800">
              {groups.map(group => (
                <div key={group.label}>
                  <button
                    onClick={() => toggleGroup(group.label)}
                    className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-medium text-gray-300 hover:bg-gray-800/50 transition-colors"
                  >
                    {t(group.label)}
                    {expandedGroups.has(group.label) ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                  </button>
                  {expandedGroups.has(group.label) && (
                    <div className="px-4 pb-3 grid grid-cols-2 gap-x-4 gap-y-2">
                      {group.params.map(p => (
                        <div key={p.key}>
                          <label className="text-[10px] text-gray-500 block mb-0.5">{t(p.label)}</label>
                          {p.type === 'bool' ? (
                            <select
                              value={hyperparams[p.key] ?? ''}
                              onChange={e => setParam(p.key, e.target.value)}
                              className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-white font-mono focus:outline-none focus:border-blue-500"
                            >
                              <option value="true">true</option>
                              <option value="false">false</option>
                            </select>
                          ) : (
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
                          )}
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
