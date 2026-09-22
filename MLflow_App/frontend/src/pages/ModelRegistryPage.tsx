// ============================================================
// ModelRegistryPage.tsx
// Modèles enregistrés, versions, transition de stage.
// ============================================================

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Package, ChevronRight, RefreshCw, GitBranch } from 'lucide-react'
import { useModels, useModelVersions } from '../hooks/useModels'
import { modelsAPI } from '../api/client'
import type { ModelVersion, RegisteredModel } from '../types/api'
import { useT } from '../i18n/useLang'

const STAGES: ModelVersion['current_stage'][] = ['None', 'Staging', 'Production', 'Archived']

const STAGE_STYLE: Record<string, string> = {
  Production: 'bg-emerald-900/40 text-emerald-400 border-emerald-700/40',
  Staging:    'bg-blue-900/40 text-blue-400 border-blue-700/40',
  Archived:   'bg-gray-800 text-gray-500 border-gray-700',
  None:       'bg-gray-800 text-gray-400 border-gray-700',
}

function StageBadge({ stage }: { stage: string }) {
  return (
    <span className={`px-2 py-0.5 rounded text-xs border font-medium ${STAGE_STYLE[stage] ?? STAGE_STYLE.None}`}>
      {stage}
    </span>
  )
}

function formatTs(ms: number | null): string {
  if (!ms) return '—'
  return new Date(ms).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
}

function TransitionMenu({
  model_name, version, current_stage, onDone,
}: {
  model_name: string
  version: string
  current_stage: string
  onDone: () => void
}) {
  const t = useT()
  const [loading, setLoading] = useState<string | null>(null)

  const handleTransition = async (stage: string) => {
    if (stage === current_stage) return
    setLoading(stage)
    try {
      await modelsAPI.transition(model_name, version, stage)
      toast.success(`${t('Version')} ${version} → ${stage}`)
      onDone()
    } catch {
      toast.error(t('Erreur lors de la transition'))
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {STAGES.map(s => (
        <button
          key={s}
          onClick={() => handleTransition(s)}
          disabled={s === current_stage || !!loading}
          className={`px-2 py-0.5 rounded text-xs border transition-colors disabled:opacity-50 ${
            s === current_stage
              ? `${STAGE_STYLE[s]} cursor-default`
              : 'bg-gray-800 text-gray-400 border-gray-700 hover:border-gray-500 hover:text-gray-200'
          }`}
        >
          {loading === s ? '…' : s}
        </button>
      ))}
    </div>
  )
}

const _map50 = (t?: Record<string, string>) => {
  const v = t?.['mAP50']
  return v != null && v !== '' && !isNaN(Number(v)) ? Number(v).toFixed(4) : '—'
}

function ModelCard({ model }: { model: RegisteredModel }) {
  const t = useT()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [expanded, setExpanded] = useState(false)
  // Toutes les versions (pas seulement latest_versions = derniere par stage, qui
  // masquait les v1..vN quand tout est en stage "None").
  const { data: allVersions } = useModelVersions(expanded ? model.name : null)
  const versions = allVersions ?? model.latest_versions

  const onVersionUpdated = () => {
    qc.invalidateQueries({ queryKey: ['models'] })
    qc.invalidateQueries({ queryKey: ['model-versions', model.name] })
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
      {/* Model header */}
      <div
        onClick={() => setExpanded(p => !p)}
        className="flex items-center gap-3 px-4 py-4 cursor-pointer hover:bg-gray-800/50 transition-colors select-none">
        <ChevronRight size={16}
          className={`text-gray-500 transition-transform flex-shrink-0 ${expanded ? 'rotate-90' : ''}`} />
        <Package size={18} className="text-indigo-400 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-white font-medium text-sm">{model.name}</p>
          {model.description && (
            <p className="text-xs text-gray-500 mt-0.5 truncate">{model.description}</p>
          )}
        </div>
        {/* Latest versions badges */}
        <div className="flex gap-1.5 flex-shrink-0">
          {model.latest_versions.map(v => (
            <StageBadge key={`${v.version}-${v.current_stage}`} stage={v.current_stage} />
          ))}
        </div>
        <span className="text-xs text-gray-500 flex-shrink-0 ml-2">
          {t('Mis à jour')} : {formatTs(model.last_updated_timestamp)}
        </span>
      </div>

      {/* Versions table */}
      {expanded && (
        <div className="border-t border-gray-800">
          <p className="px-4 py-2 text-[11px] text-gray-500 bg-gray-950/40 border-b border-gray-800/60">
            {t('Chaque')} <b className="text-gray-400">{t('version')}</b> {t("= un entraînement successif du même modèle (même projet). Le dataset et la mAP50 relient la version à son run d'origine.")}
          </p>
          {versions.length === 0 ? (
            <div className="px-4 py-4 text-xs text-gray-500">{t('Aucune version enregistrée')}</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium uppercase">Version</th>
                  <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium uppercase">Dataset</th>
                  <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium uppercase">mAP50</th>
                  <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium uppercase">Stage</th>
                  <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium uppercase">Run</th>
                  <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium uppercase">{t('Créé le')}</th>
                  <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium uppercase">Transition</th>
                </tr>
              </thead>
              <tbody>
                {versions.map((v, i) => (
                    <tr key={v.version} className={i > 0 ? 'border-t border-gray-800/60' : ''}>
                      <td className="px-4 py-3 font-mono text-xs text-indigo-300">v{v.version}</td>
                      <td className="px-4 py-3 text-xs text-gray-300">{v.tags?.['dataset'] || '—'}</td>
                      <td className="px-4 py-3 font-mono text-xs text-emerald-300">{_map50(v.tags)}</td>
                      <td className="px-4 py-3"><StageBadge stage={v.current_stage} /></td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-500">
                        {v.run_id
                          ? <button onClick={() => navigate(`/runs/${v.run_id}`)} className="text-indigo-400 hover:text-indigo-300">{v.run_id.slice(0, 10)}</button>
                          : '—'}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-400">{formatTs(v.creation_timestamp)}</td>
                      <td className="px-4 py-3">
                        <TransitionMenu
                          model_name={model.name}
                          version={v.version}
                          current_stage={v.current_stage}
                          onDone={onVersionUpdated}
                        />
                      </td>
                    </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}

export default function ModelRegistryPage() {
  const t = useT()
  const { data: models, isLoading, refetch } = useModels()

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <GitBranch size={22} className="text-indigo-400" />
          <h1 className="text-xl font-semibold text-white">Model Registry</h1>
          {models && (
            <span className="text-xs bg-gray-800 text-gray-400 border border-gray-700 rounded-full px-2 py-0.5">
              {models.length}
            </span>
          )}
        </div>
        <button onClick={() => refetch()}
          className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors">
          <RefreshCw size={16} />
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-40 text-gray-500 text-sm">{t('Chargement…')}</div>
      ) : !models || models.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-40 gap-2 text-gray-500">
          <Package size={32} className="text-gray-700" />
          <p className="text-sm">{t('Aucun modèle enregistré')}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {models.map(m => <ModelCard key={m.name} model={m} />)}
        </div>
      )}
    </div>
  )
}
