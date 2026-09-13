// ============================================================
// pages/SemanticSearch.tsx
// Recherche sémantique texte → images CLIP.
// Affiche : score matching, cluster, rareté. Zoom modal disponible.
// ============================================================

import { useState } from 'react'
import { useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Search, Save, ZoomIn, CheckSquare, Square } from 'lucide-react'
import { datasetsAPI, subsetsAPI } from '../api/client'
import { useDataset } from '../hooks/useDataset'
import { useSelectionStore } from '../hooks/useSubset'
import ImageModal from '../components/ImageModal'
import { nativeImageUrl } from '../utils/nativeImage'
import type { SearchResult } from '../types/api'

export default function SemanticSearch() {
  const { id } = useParams<{ id: string }>()
  const datasetId = Number(id)
  const { data: dataset } = useDataset(datasetId)

  const [query, setQuery] = useState('')
  const [topK, setTopK] = useState(20)
  const [useThreshold, setUseThreshold] = useState(false)
  const [thresholdPct, setThresholdPct] = useState(35)  // en %
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [modalResult, setModalResult] = useState<SearchResult | null>(null)

  const { selectedIds, toggle, clear } = useSelectionStore()
  const [subsetName, setSubsetName] = useState('')
  const [saving, setSaving] = useState(false)

  const handleSearch = async () => {
    if (!query.trim()) return toast.error('Entrez une requête')
    setLoading(true)
    clear()
    try {
      const minScore = useThreshold ? thresholdPct / 100 : undefined
      const res = await datasetsAPI.semanticSearch(datasetId, query.trim(), topK, minScore)
      setResults(res.results)
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Erreur serveur'
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  const handleSaveSubset = async () => {
    if (!subsetName.trim()) return toast.error('Nom requis')
    const ids = selectedIds.size > 0
      ? Array.from(selectedIds)
      : results.map(r => r.image_id)
    if (ids.length === 0) return toast.error('Aucune image')
    setSaving(true)
    try {
      await subsetsAPI.create({ dataset_id: datasetId, name: subsetName, image_ids: ids })
      toast.success(`Subset "${subsetName}" créé (${ids.length} images)`)
      setSubsetName('')
      clear()
    } catch {
      toast.error('Erreur création subset')
    } finally {
      setSaving(false)
    }
  }

  const handleToggleAll = () => {
    if (selectedIds.size === results.length) {
      clear()
    } else {
      results.forEach(r => { if (!selectedIds.has(r.image_id)) toggle(r.image_id) })
    }
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Search size={22} /> Recherche sémantique
        </h1>
        {dataset && <p className="text-gray-400 mt-1">{dataset.name}</p>}
      </div>

      {/* Légende des badges */}
      <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500">
        <span className="font-medium text-gray-400">Légende :</span>
        <span className="px-2 py-0.5 rounded-full bg-green-600/15 text-green-400 border border-green-600/30">Match 87%</span>
        <span>= score de similarité CLIP (plus élevé = meilleure correspondance)</span>
        <span className="px-2 py-0.5 rounded-full bg-indigo-600/15 text-indigo-400 border border-indigo-600/30">C3</span>
        <span>= cluster UMAP</span>
        <span className="px-2 py-0.5 rounded-full bg-amber-600/15 text-amber-400 border border-amber-600/30">Rareté 72%</span>
        <span>= rareté dans le dataset (score élevé = image atypique)</span>
      </div>

      {/* Barre de recherche */}
      <div className="bg-gray-800 rounded-xl p-4 border border-gray-700 space-y-3">
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Ex: person walking, red car, intersection at night..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
            className="flex-1 bg-gray-900 border border-gray-600 rounded-lg px-4 py-2.5 text-gray-200 placeholder-gray-500 focus:ring-2 focus:ring-indigo-500"
          />
          <button
            onClick={handleSearch}
            disabled={loading}
            className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
          >
            {loading ? 'Recherche...' : 'Rechercher'}
          </button>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {/* Toggle mode : Top-K vs Seuil */}
          <div className="flex rounded-lg overflow-hidden border border-gray-600 text-xs">
            <button
              onClick={() => setUseThreshold(false)}
              className={`px-3 py-1.5 transition-colors ${!useThreshold ? 'bg-indigo-600 text-white' : 'bg-gray-900 text-gray-400 hover:text-white'}`}
            >
              Top-K
            </button>
            <button
              onClick={() => setUseThreshold(true)}
              className={`px-3 py-1.5 transition-colors ${useThreshold ? 'bg-indigo-600 text-white' : 'bg-gray-900 text-gray-400 hover:text-white'}`}
            >
              Seuil %
            </button>
          </div>

          {!useThreshold ? (
            <>
              <input
                type="range"
                min={5} max={100} step={5}
                value={topK}
                onChange={e => setTopK(Number(e.target.value))}
                className="w-36 accent-indigo-500"
              />
              <input
                type="number"
                min={1} max={500}
                value={topK}
                onChange={e => {
                  const n = Number(e.target.value)
                  if (!isNaN(n) && n >= 1) setTopK(Math.min(500, n))
                }}
                className="w-20 bg-gray-900 border border-gray-600 rounded px-2 py-1 text-sm text-gray-200 text-center focus:ring-1 focus:ring-indigo-500"
              />
              <span className="text-gray-600 text-xs">résultats à retourner</span>
            </>
          ) : (
            <>
              <input
                type="range"
                min={1} max={99} step={1}
                value={thresholdPct}
                onChange={e => setThresholdPct(Number(e.target.value))}
                className="w-36 accent-indigo-500"
              />
              <div className="flex items-center gap-1 bg-gray-900 border border-gray-600 rounded px-2 py-1">
                <input
                  type="number"
                  min={1} max={99}
                  value={thresholdPct}
                  onChange={e => {
                    const n = Number(e.target.value)
                    if (!isNaN(n) && n >= 1 && n <= 99) setThresholdPct(n)
                  }}
                  className="w-12 bg-transparent text-sm text-gray-200 text-center focus:outline-none"
                />
                <span className="text-gray-400 text-sm">%</span>
              </div>
              <span className="text-gray-600 text-xs">toutes les images ≥ ce score de match</span>
            </>
          )}
        </div>
      </div>

      {/* Résultats */}
      {results.length > 0 && (
        <div className="space-y-3">
          {/* Barre d'actions résultats */}
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-3">
              <p className="text-gray-400 text-sm">
                <span className="text-white font-medium">{results.length}</span> résultats pour{' '}
                <span className="text-indigo-300 italic">"{query}"</span>
                {selectedIds.size > 0 && (
                  <span className="ml-2 text-amber-400 font-medium">· {selectedIds.size} sélectionnée(s)</span>
                )}
              </p>
              <button
                onClick={handleToggleAll}
                className="flex items-center gap-1 text-xs text-gray-500 hover:text-white transition-colors"
                title="Tout sélectionner / désélectionner"
              >
                {selectedIds.size === results.length
                  ? <><CheckSquare size={13} /> Tout désélectionner</>
                  : <><Square size={13} /> Tout sélectionner</>
                }
              </button>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                placeholder="Nom du subset..."
                value={subsetName}
                onChange={e => setSubsetName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSaveSubset()}
                className="bg-gray-800 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-gray-200 placeholder-gray-500 w-44 focus:ring-2 focus:ring-indigo-500"
              />
              <button
                onClick={handleSaveSubset}
                disabled={saving}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm rounded-lg transition-colors disabled:opacity-50 font-medium"
              >
                <Save size={14} />
                {selectedIds.size > 0 ? `Sauver sélection (${selectedIds.size})` : `Tout sauver (${results.length})`}
              </button>
            </div>
          </div>

          {/* Grille résultats */}
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-3">
            {results.map((r, idx) => (
              <SearchResultCard
                key={r.image_id}
                result={r}
                rank={idx + 1}
                selected={selectedIds.has(r.image_id)}
                onToggle={() => toggle(r.image_id)}
                onZoom={() => setModalResult(r)}
                datasetId={datasetId}
              />
            ))}
          </div>
        </div>
      )}

      {!loading && results.length === 0 && query && (
        <p className="text-gray-500 text-center py-12">Aucun résultat pour cette recherche.</p>
      )}

      {/* Modal zoom */}
      {modalResult && (
        <ImageModal
          imageUrl={modalResult.thumbnail_url ?? ''}
          fullUrl={nativeImageUrl(
            `/api/datasets/${datasetId}/images/${modalResult.image_id}/full`,
            `/api/datasets/${datasetId}/images/${modalResult.image_id}/full-path`,
          )}
          filename={modalResult.filename}
          info={{
            cluster_id: modalResult.cluster_id,
            rarity_score: modalResult.rarity_score,
            score: modalResult.score,
          }}
          onClose={() => setModalResult(null)}
        />
      )}
    </div>
  )
}

// ---- Carte résultat de recherche ----
function SearchResultCard({
  result,
  rank,
  selected,
  onToggle,
  onZoom,
}: {
  result: SearchResult
  rank: number
  selected: boolean
  onToggle: () => void
  onZoom: () => void
  datasetId: number
}) {
  const matchPct = Math.round(result.score * 100)
  const rarityPct = result.rarity_score !== null ? Math.round((result.rarity_score ?? 0) * 100) : null

  return (
    <div
      className={`rounded-xl overflow-hidden border-2 transition-all cursor-pointer group
        ${selected ? 'border-indigo-500 ring-2 ring-indigo-500/30' : 'border-gray-700 hover:border-gray-500'}`}
    >
      {/* Thumbnail */}
      <div className="aspect-video bg-gray-900 relative" onClick={onZoom}>
        {result.thumbnail_url ? (
          <img
            src={result.thumbnail_url}
            alt={result.filename}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-600 text-xs">No img</div>
        )}

        {/* Rank badge */}
        <div className="absolute top-1 left-1 px-1.5 py-0.5 bg-black/70 rounded text-xs text-gray-300 font-mono">
          #{rank}
        </div>

        {/* Checkbox overlay */}
        <div
          className="absolute top-1 right-1 cursor-pointer"
          onClick={e => { e.stopPropagation(); onToggle() }}
        >
          <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors
            ${selected ? 'bg-indigo-600 border-indigo-500' : 'bg-black/50 border-gray-400 opacity-0 group-hover:opacity-100'}`}
          >
            {selected && <span className="text-white text-xs">✓</span>}
          </div>
        </div>

        {/* Zoom hint */}
        <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/20 transition-colors">
          <ZoomIn size={20} className="text-white opacity-0 group-hover:opacity-70 transition-opacity" />
        </div>
      </div>

      {/* Footer avec badges */}
      <div className="p-1.5 bg-gray-800" onClick={onToggle}>
        <p className="text-white text-xs truncate mb-1">{result.filename}</p>
        <div className="flex flex-wrap gap-1">
          {/* Score matching */}
          <span
            className="px-1.5 py-0.5 rounded text-xs font-medium"
            style={{
              backgroundColor: matchBg(matchPct),
              color: matchText(matchPct),
            }}
            title={`Score de similarité CLIP : ${matchPct}%`}
          >
            {matchPct}%
          </span>

          {/* Cluster */}
          {result.cluster_id !== null && (
            <span
              className="px-1.5 py-0.5 rounded text-xs bg-indigo-600/20 text-indigo-400"
              title={`Cluster UMAP : ${result.cluster_id}`}
            >
              C{result.cluster_id}
            </span>
          )}

          {/* Rareté */}
          {rarityPct !== null && (
            <span
              className="px-1.5 py-0.5 rounded text-xs"
              style={{
                backgroundColor: rarityBg(rarityPct / 100),
                color: rarityText(rarityPct / 100),
              }}
              title={`Rareté dans le dataset : ${rarityPct}%`}
            >
              R{rarityPct}%
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

// Couleur selon score matching
function matchBg(pct: number): string {
  if (pct >= 70) return 'rgba(34,197,94,0.2)'
  if (pct >= 50) return 'rgba(234,179,8,0.2)'
  return 'rgba(239,68,68,0.15)'
}
function matchText(pct: number): string {
  if (pct >= 70) return '#86efac'
  if (pct >= 50) return '#fde047'
  return '#fca5a5'
}
function rarityBg(v: number): string {
  if (v < 0.33) return 'rgba(34,197,94,0.12)'
  if (v < 0.66) return 'rgba(234,179,8,0.12)'
  return 'rgba(239,68,68,0.12)'
}
function rarityText(v: number): string {
  if (v < 0.33) return '#86efac'
  if (v < 0.66) return '#fde047'
  return '#fca5a5'
}
