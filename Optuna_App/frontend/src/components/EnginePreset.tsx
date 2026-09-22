// ============================================================
// EnginePreset.tsx
// Preremplit une etude manuelle pour entrainer un moteur de Training_App
// (script hpo_trial.py, arguments fixes, plages HPO du moteur). Les moteurs,
// leurs tailles et leurs plages viennent de /api/orchestrator/engines : sans
// plugin, seul YOLOX est propose et aucun selecteur n'apparait.
// ============================================================

import { useEffect, useState } from 'react'
import { Cpu } from 'lucide-react'
import { enginesAPI } from '../api/client'
import type { EngineInfo, EnginesResponse, ParamSpec } from '../types/api'

export interface EnginePresetValue {
  scriptPath: string
  scriptArgs: string[]
  params:     ParamSpec[]
  metricName: string
  direction:  'maximize'
}

interface Props {
  studyName: string
  onApply:   (value: EnginePresetValue) => void
}

const inputCls =
  'w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500'

export default function EnginePreset({ studyName, onApply }: Props) {
  const [info, setInfo]         = useState<EnginesResponse | null>(null)
  const [engineName, setEngine] = useState('')
  const [modelSize, setSize]    = useState('')
  const [dataYaml, setDataYaml] = useState('')
  const [epochs, setEpochs]     = useState(10)

  useEffect(() => {
    enginesAPI.list().then(setInfo).catch(() => setInfo(null))
  }, [])

  const usable: EngineInfo[] = (info?.engines ?? []).filter(e => e.available && e.catalog)
  const engine = usable.find(e => e.name === engineName) ?? usable[0]
  const catalog = engine?.catalog

  useEffect(() => {
    if (catalog && !catalog.sizes.includes(modelSize)) setSize(catalog.default_size)
  }, [catalog, modelSize])

  if (!info || !engine || !catalog) return null

  const apply = () => {
    const params: ParamSpec[] = catalog.hpo_default_optimize
      .filter(name => catalog.hpo_ranges[name])
      .map(name => {
        const { label: _label, ...range } = catalog.hpo_ranges[name]
        return { name, ...range }
      })
    onApply({
      scriptPath: info.trial_script,
      scriptArgs: [
        '--data_yaml', dataYaml.trim(),
        '--engine', engine.name,
        '--model_size', modelSize,
        '--epochs', String(epochs),
        '--metric', 'map50',
        '--runs_dir', `${info.runs_dir}/${studyName}`,
      ],
      params,
      metricName: 'map50',
      direction:  'maximize',
    })
  }

  const prefix = catalog.size_prefix ?? ''
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
      <h2 className="text-sm font-semibold text-gray-300 flex items-center gap-1.5">
        <Cpu size={14} className="text-indigo-400" /> Optimiser un entraînement de détection
      </h2>
      <p className="text-xs text-gray-500">
        Préremplit le script, ses arguments et l'espace de recherche pour entraîner le moteur choisi
        à chaque trial (métrique mAP50, à maximiser). Tout reste modifiable ensuite.
      </p>
      <div className="grid grid-cols-2 gap-3">
        {usable.length > 1 && (
          <div>
            <label className="block text-xs text-gray-500 mb-1">Moteur</label>
            <select value={engine.name} onChange={e => setEngine(e.target.value)} className={inputCls}>
              {usable.map(e => <option key={e.name} value={e.name}>{e.label}</option>)}
            </select>
          </div>
        )}
        <div>
          <label className="block text-xs text-gray-500 mb-1">Modèle {catalog.label}</label>
          <select value={modelSize} onChange={e => setSize(e.target.value)} className={inputCls}>
            {catalog.sizes.map(s => <option key={s} value={s}>{prefix ? s.replace(prefix, '') : s}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Epochs par trial</label>
          <input
            type="number" min={1} max={1000} value={epochs}
            onChange={e => setEpochs(Math.max(1, parseInt(e.target.value) || 1))}
            className={inputCls}
          />
        </div>
        <div className="col-span-2">
          <label className="block text-xs text-gray-500 mb-1">Chemin data.yaml</label>
          <input
            value={dataYaml} onChange={e => setDataYaml(e.target.value)}
            placeholder="C:/data/dataset/data.yaml" className={inputCls}
          />
        </div>
      </div>
      <button
        onClick={apply}
        disabled={!dataYaml.trim()}
        className="px-3 py-2 bg-gray-800 hover:bg-gray-700 disabled:text-gray-600 text-gray-200 text-xs rounded-lg border border-gray-700 transition-colors"
      >
        Préremplir l'étude
      </button>
    </div>
  )
}
