// ============================================================
// components/ImageGrid.tsx
// Grille d'images avec sélection multi.
// ============================================================

import ImageCard from './ImageCard'
import type { ImageSummary, SearchResult } from '../types/api'

type GridItem = (ImageSummary | SearchResult) & { score?: number }

interface Props {
  items: GridItem[]
  selectedIds?: Set<number>
  onToggleSelect?: (id: number) => void
  emptyMessage?: string
  columns?: number
}

function getImageId(item: GridItem): number {
  return 'id' in item ? (item as ImageSummary).id : (item as SearchResult).image_id
}

export default function ImageGrid({
  items,
  selectedIds = new Set(),
  onToggleSelect,
  emptyMessage = 'Aucune image',
  columns = 4,
}: Props) {
  if (items.length === 0) {
    return (
      <div className="flex items-center justify-center h-40 text-gray-500">
        {emptyMessage}
      </div>
    )
  }

  const gridClass = {
    2: 'grid-cols-2',
    3: 'grid-cols-3',
    4: 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4',
    5: 'grid-cols-3 md:grid-cols-5',
    6: 'grid-cols-3 md:grid-cols-6',
  }[columns] ?? 'grid-cols-4'

  return (
    <div className={`grid ${gridClass} gap-2`}>
      {items.map(item => {
        const id = getImageId(item)
        const isImg = 'filename' in item
        const filename = isImg
          ? (item as ImageSummary).filename
          : (item as SearchResult).filename
        const thumb = isImg
          ? (item as ImageSummary).thumbnail_url
          : (item as SearchResult).thumbnail_url
        const clusterId = isImg
          ? (item as ImageSummary).cluster_id
          : (item as SearchResult).cluster_id
        const rarity = isImg
          ? (item as ImageSummary).rarity_score
          : (item as SearchResult).rarity_score
        const score = 'score' in item ? (item as SearchResult).score : undefined

        return (
          <ImageCard
            key={id}
            id={id}
            filename={filename}
            thumbnailUrl={thumb}
            clusterid={clusterId}
            rarityScore={rarity}
            score={score}
            selected={selectedIds.has(id)}
            onToggleSelect={onToggleSelect}
          />
        )
      })}
    </div>
  )
}
