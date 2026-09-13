// ============================================================
// components/ImageCard.tsx
// Carte d'image : thumbnail, badges cluster/rareté, sélection.
// ============================================================

import { CheckSquare, Square } from 'lucide-react'
import { nativeImageUrl } from '../utils/nativeImage'

interface Props {
  id: number
  filename: string
  thumbnailUrl: string | null
  clusterid?: number | null
  rarityScore?: number | null
  score?: number | null        // score similarité cosine (recherche sémantique)
  selected?: boolean
  onToggleSelect?: (id: number) => void
  onClick?: () => void
}

function rarityColor(score: number): string {
  if (score >= 0.7) return 'bg-red-500'
  if (score >= 0.4) return 'bg-yellow-500'
  return 'bg-green-500'
}

function rarityLabel(score: number): string {
  if (score >= 0.7) return 'Rare'
  if (score >= 0.4) return 'Moyen'
  return 'Commun'
}

const CLUSTER_COLORS = [
  '#6366f1','#f59e0b','#10b981','#ef4444','#3b82f6',
  '#8b5cf6','#ec4899','#14b8a6','#f97316','#84cc16',
  '#06b6d4','#a855f7','#eab308','#22c55e','#0ea5e9',
  '#d946ef','#fb923c','#4ade80','#38bdf8','#c084fc',
]

export default function ImageCard({
  id, filename, thumbnailUrl, clusterid, rarityScore,
  score, selected = false, onToggleSelect, onClick,
}: Props) {
  // Thumbnails générés en tâche de fond (step 7) : si le thumbnail statique n'est
  // pas encore prêt (thumbnail_url vide), on passe par l'endpoint à la demande qui
  // le génère+cache à la volée.
  const thumb = thumbnailUrl || nativeImageUrl(`/api/images/${id}/thumb`, `/api/images/${id}/thumb-path`)

  return (
    <div
      className={`relative group rounded-lg overflow-hidden border-2 transition-all cursor-pointer
        ${selected ? 'border-indigo-500 ring-2 ring-indigo-500/40' : 'border-gray-700 hover:border-gray-500'}`}
      onClick={() => onClick ? onClick() : onToggleSelect?.(id)}
    >
      {/* Thumbnail */}
      <div className="aspect-video bg-gray-800 flex items-center justify-center">
        {thumb ? (
          <img
            src={thumb}
            alt={filename}
            loading="lazy"
            className="w-full h-full object-cover"
          />
        ) : (
          <span className="text-gray-600 text-xs">No preview</span>
        )}
      </div>

      {/* Overlay infos */}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-2">
        <p className="text-white text-xs truncate leading-tight">{filename}</p>
        <div className="flex items-center gap-1 mt-0.5 flex-wrap">
          {clusterid !== null && clusterid !== undefined && (
            <span
              className="px-1.5 py-0.5 rounded text-xs font-medium text-white"
              style={{ backgroundColor: CLUSTER_COLORS[clusterid % CLUSTER_COLORS.length] }}
            >
              C{clusterid}
            </span>
          )}
          {rarityScore !== null && rarityScore !== undefined && (
            <span className={`px-1.5 py-0.5 rounded text-xs font-medium text-white ${rarityColor(rarityScore)}`}>
              {rarityLabel(rarityScore)} {(rarityScore * 100).toFixed(0)}%
            </span>
          )}
          {score !== null && score !== undefined && (
            <span className="px-1.5 py-0.5 rounded text-xs font-medium text-white bg-blue-600">
              {(score * 100).toFixed(1)}%
            </span>
          )}
        </div>
      </div>

      {/* Checkbox sélection */}
      {onToggleSelect && (
        <div
          className="absolute top-1.5 left-1.5 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={e => { e.stopPropagation(); onToggleSelect(id) }}
        >
          {selected
            ? <CheckSquare size={18} className="text-indigo-400 drop-shadow" />
            : <Square size={18} className="text-gray-300 drop-shadow" />
          }
        </div>
      )}
    </div>
  )
}
