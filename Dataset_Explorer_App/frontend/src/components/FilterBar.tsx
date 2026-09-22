// ============================================================
// components/FilterBar.tsx
// Barre de filtres : mode couleur, cluster, rareté.
// ============================================================

import type { ClusterInfo } from '../types/api'
import type { ColorMode } from './ScatterPlot'

interface Props {
  colorMode: ColorMode
  onColorModeChange: (mode: ColorMode) => void
  clusters: ClusterInfo[]
  selectedCluster: number | null
  onClusterChange: (id: number | null) => void
  minRarity: number
  maxRarity: number
  onRarityChange: (min: number, max: number) => void
}

const COLOR_MODES: { value: ColorMode; label: string }[] = [
  { value: 'cluster', label: 'Cluster' },
  { value: 'rarity', label: 'Rareté' },
  { value: 'uniform', label: 'Uniforme' },
]

export default function FilterBar({
  colorMode, onColorModeChange,
  clusters, selectedCluster, onClusterChange,
  minRarity, maxRarity, onRarityChange,
}: Props) {
  return (
    <div className="flex flex-wrap items-center gap-4 p-3 bg-gray-800 rounded-lg border border-gray-700">
      {/* Mode couleur */}
      <div className="flex items-center gap-2">
        <span className="text-gray-400 text-sm">Couleur :</span>
        <div className="flex rounded-lg overflow-hidden border border-gray-600">
          {COLOR_MODES.map(m => (
            <button
              key={m.value}
              onClick={() => onColorModeChange(m.value)}
              className={`px-3 py-1 text-sm transition-colors
                ${colorMode === m.value
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* Filtre cluster */}
      <div className="flex items-center gap-2">
        <span className="text-gray-400 text-sm">Cluster :</span>
        <select
          value={selectedCluster ?? ''}
          onChange={e => onClusterChange(e.target.value === '' ? null : Number(e.target.value))}
          className="bg-gray-700 border border-gray-600 text-gray-200 text-sm rounded px-2 py-1 focus:ring-1 focus:ring-indigo-500"
        >
          <option value="">Tous</option>
          {clusters.map(c => (
            <option key={c.cluster_id} value={c.cluster_id}>
              C{c.cluster_id} ({c.count})
            </option>
          ))}
        </select>
      </div>

      {/* Filtre rareté */}
      <div className="flex items-center gap-2">
        <span className="text-gray-400 text-sm">Rareté :</span>
        <input
          type="range"
          min={0} max={100}
          value={Math.round(minRarity * 100)}
          onChange={e => onRarityChange(Number(e.target.value) / 100, maxRarity)}
          className="w-20 accent-indigo-500"
          title={`Min: ${(minRarity * 100).toFixed(0)}%`}
        />
        <span className="text-gray-500 text-xs">–</span>
        <input
          type="range"
          min={0} max={100}
          value={Math.round(maxRarity * 100)}
          onChange={e => onRarityChange(minRarity, Number(e.target.value) / 100)}
          className="w-20 accent-indigo-500"
          title={`Max: ${(maxRarity * 100).toFixed(0)}%`}
        />
        <span className="text-gray-400 text-xs">
          {(minRarity * 100).toFixed(0)}–{(maxRarity * 100).toFixed(0)}%
        </span>
      </div>
    </div>
  )
}
