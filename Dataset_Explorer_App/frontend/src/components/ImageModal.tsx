// ============================================================
// components/ImageModal.tsx
// Modal plein écran pour inspecter une image en détail.
// ============================================================

import { X, ExternalLink } from 'lucide-react'
import { useEffect } from 'react'

interface ImageInfo {
  cluster_id?: number | null
  rarity_score?: number | null
  score?: number       // score de matching CLIP [0,1]
  width?: number
  height?: number
  metadata?: Record<string, string>   // métadonnées tabulaires liées (CSV/Excel)
}

interface Props {
  /** URL de l'image complète (endpoint /full) ou miniature */
  imageUrl: string
  /** URL optionnelle vers l'image pleine résolution */
  fullUrl?: string
  filename: string
  info?: ImageInfo
  onClose: () => void
}

export default function ImageModal({ imageUrl, fullUrl, filename, info, onClose }: Props) {
  // Fermer sur Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative flex flex-col bg-gray-900 rounded-2xl overflow-hidden shadow-2xl border border-gray-700 max-w-5xl max-h-[92vh] w-full mx-4"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 flex-shrink-0">
          <span className="text-white text-sm font-medium truncate max-w-xs">{filename}</span>

          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Badges infos */}
            {info?.cluster_id != null && (
              <span className="px-2 py-0.5 rounded-full text-xs bg-indigo-600/20 text-indigo-300 border border-indigo-600/40">
                Cluster {info.cluster_id}
              </span>
            )}
            {info?.rarity_score != null && (
              <span
                className="px-2 py-0.5 rounded-full text-xs border"
                style={{
                  backgroundColor: rarityBg(info.rarity_score),
                  color: rarityText(info.rarity_score),
                  borderColor: rarityBorder(info.rarity_score),
                }}
              >
                Rareté {Math.round(info.rarity_score * 100)}%
              </span>
            )}
            {info?.score != null && (
              <span className="px-2 py-0.5 rounded-full text-xs bg-green-600/20 text-green-300 border border-green-600/40">
                Matching {Math.round(info.score * 100)}%
              </span>
            )}
            {info?.width && info?.height && (
              <span className="px-2 py-0.5 rounded-full text-xs bg-gray-700 text-gray-400">
                {info.width}×{info.height}
              </span>
            )}

            {/* Ouvrir pleine résolution */}
            {fullUrl && (
              <a
                href={fullUrl}
                target="_blank"
                rel="noreferrer"
                className="p-1.5 text-gray-500 hover:text-indigo-400 transition-colors"
                title="Ouvrir l'image originale"
              >
                <ExternalLink size={16} />
              </a>
            )}

            <button
              onClick={onClose}
              className="p-1.5 text-gray-500 hover:text-white transition-colors"
              title="Fermer (Échap)"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Image */}
        <div className="flex-1 overflow-hidden flex items-center justify-center bg-gray-950 min-h-0">
          <img
            src={imageUrl}
            alt={filename}
            className="max-w-full max-h-full object-contain"
          />
        </div>

        {/* Métadonnées tabulaires liées (CSV/Excel) */}
        {info?.metadata && Object.keys(info.metadata).length > 0 && (
          <div className="flex-shrink-0 border-t border-gray-700 px-4 py-3 max-h-40 overflow-y-auto">
            <p className="text-gray-500 text-xs mb-2">Métadonnées associées</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {Object.entries(info.metadata).map(([k, v]) => (
                <div key={k} className="bg-gray-800/60 rounded-lg px-2.5 py-1.5">
                  <p className="text-gray-500 text-[10px] leading-none mb-0.5 truncate" title={k}>{k}</p>
                  <p className="text-gray-200 text-xs font-medium break-words">{v || '—'}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// Helpers couleur rareté
function rarityBg(v: number): string {
  if (v < 0.33) return 'rgba(34,197,94,0.15)'
  if (v < 0.66) return 'rgba(234,179,8,0.15)'
  return 'rgba(239,68,68,0.15)'
}
function rarityText(v: number): string {
  if (v < 0.33) return '#86efac'
  if (v < 0.66) return '#fde047'
  return '#fca5a5'
}
function rarityBorder(v: number): string {
  if (v < 0.33) return 'rgba(34,197,94,0.4)'
  if (v < 0.66) return 'rgba(234,179,8,0.4)'
  return 'rgba(239,68,68,0.4)'
}
