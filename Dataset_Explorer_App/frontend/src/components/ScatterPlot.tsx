// ============================================================
// components/ScatterPlot.tsx
// Scatter Plotly avec lasso select + coloration configurable + légende.
//
// Fix lasso "Tous" :
//   - React.memo évite tout re-render du composant quand selectedIds
//     change dans le parent (les props sont stables).
//   - layout est mémoïsé : Plot ne reçoit pas de nouveaux objets
//     → Plotly.react() n'est jamais appelé durant la sélection.
//   - selectedIds n'est plus une prop (plus de boucle onDeselect).
//
// Le parent doit passer onSelected via useCallback pour garantir
// la stabilité de la référence.
// ============================================================

import React, { useMemo } from 'react'
import Plot from 'react-plotly.js'
import type { MapPoint } from '../types/api'

export type ColorMode = 'cluster' | 'rarity' | 'uniform'

export const CLUSTER_COLORS = [
  '#6366f1','#f59e0b','#10b981','#ef4444','#3b82f6',
  '#8b5cf6','#ec4899','#14b8a6','#f97316','#84cc16',
  '#06b6d4','#a855f7','#eab308','#22c55e','#0ea5e9',
  '#d946ef','#fb923c','#4ade80','#38bdf8','#c084fc',
]

function rarityToColor(score: number): string {
  if (score < 0.33) {
    const t = score / 0.33
    return `rgb(${Math.round(34 + t * 200)},${Math.round(197 - t * 18)},${Math.round(94 - t * 86)})`
  } else if (score < 0.66) {
    const t = (score - 0.33) / 0.33
    return `rgb(${Math.round(234 + t * 5)},${Math.round(179 - t * 111)},${Math.round(8 - t * 8)})`
  } else {
    const t = (score - 0.66) / 0.34
    return `rgb(239,${Math.round(68 - t * 68)},0)`
  }
}

interface Props {
  points: MapPoint[]
  colorMode: ColorMode
  onSelected?: (imageIds: number[]) => void
  uirevision?: string
  height?: number
}

function ClusterLegend({ clusters }: { clusters: number[] }) {
  if (clusters.length === 0) return null
  return (
    <div className="absolute bottom-12 right-3 bg-gray-900/92 border border-gray-700 rounded-lg p-2.5 max-h-56 overflow-y-auto shadow-lg">
      <p className="text-gray-500 text-xs font-semibold mb-1.5 uppercase tracking-wide">Clusters</p>
      <div className="space-y-1">
        {clusters.map(c => (
          <div key={c} className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full flex-shrink-0 ring-1 ring-white/10"
              style={{ backgroundColor: CLUSTER_COLORS[c % CLUSTER_COLORS.length] }} />
            <span className="text-gray-300 text-xs">Cluster {c}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function RarityLegend() {
  return (
    <div className="absolute bottom-12 right-3 bg-gray-900/92 border border-gray-700 rounded-lg p-2.5 shadow-lg w-44">
      <p className="text-gray-500 text-xs font-semibold mb-1.5 uppercase tracking-wide">Rareté</p>
      <div className="space-y-1 mb-2">
        {[['bg-green-500','Commun (0–33%)'],['bg-yellow-500','Moyen (33–66%)'],['bg-red-500','Rare (66–100%)']].map(([cls, label]) => (
          <div key={label} className="flex items-center gap-1.5">
            <div className={`w-2.5 h-2.5 rounded-full ${cls} flex-shrink-0`} />
            <span className="text-gray-300 text-xs">{label}</span>
          </div>
        ))}
      </div>
      <div className="h-2 rounded-full" style={{ background: 'linear-gradient(to right, #22c55e, #eab308, #ef4444)' }} />
      <div className="flex justify-between text-gray-600 text-xs mt-0.5">
        <span>0%</span><span>50%</span><span>100%</span>
      </div>
    </div>
  )
}

// React.memo : le composant ne se re-rende PAS quand selectedIds change
// dans le parent (puisque selectedIds n'est plus une prop).
const ScatterPlot = React.memo(function ScatterPlot({
  points,
  colorMode,
  onSelected,
  uirevision = 'static',
  height = 500,
}: Props) {
  const { x, y, colors, text, customdata, uniqueClusters } = useMemo(() => {
    const x = points.map(p => p.x)
    const y = points.map(p => p.y)
    const text = points.map(p => p.filename)
    const customdata = points.map(p => [p.image_id, p.thumbnail_url ?? ''])
    const clusterSet = new Set<number>()
    const colors = points.map(p => {
      if (colorMode === 'cluster') {
        const c = p.cluster_id ?? -1
        if (c >= 0) clusterSet.add(c)
        return c >= 0 ? CLUSTER_COLORS[c % CLUSTER_COLORS.length] : '#4b5563'
      }
      if (colorMode === 'rarity') return p.rarity_score !== null ? rarityToColor(p.rarity_score ?? 0) : '#4b5563'
      return '#4f46e5'
    })
    return { x, y, colors, text, customdata, uniqueClusters: Array.from(clusterSet).sort((a, b) => a - b) }
  }, [points, colorMode])

  // Layout mémoïsé : stable tant que uirevision/height ne changent pas
  // → Plot ne reçoit pas de nouveaux objets → Plotly.react() pas appelé
  // → la sélection lasso est préservée après re-render du parent.
  const layout = useMemo<Partial<Plotly.Layout>>(() => ({
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: '#111827',
    font: { color: '#9ca3af' },
    margin: { t: 10, r: 10, b: 40, l: 40 },
    height,
    uirevision,
    xaxis: { title: 'UMAP-1', gridcolor: '#1f2937', zerolinecolor: '#374151' },
    yaxis: { title: 'UMAP-2', gridcolor: '#1f2937', zerolinecolor: '#374151' },
    dragmode: 'lasso',
    hovermode: 'closest',
  }), [uirevision, height])

  // scattergl (WebGL) et NON scatter (SVG). Mesure sur ce dataset de 9402
  // points, avant/apres : Plotly en mode 'scatter' cree UN NOEUD SVG <path>
  // PAR POINT -- 9402 noeuds, soit 96% du DOM de la page entiere. Chaque
  // selection, zoom ou survol doit alors retoucher ces milliers de noeuds sur
  // le thread principal :
  //     selection lasso  354 ms      zoom  246 ms      deselection  335 ms
  // Pendant le GLISSEMENT du lasso, Plotly repete cette mise a jour en
  // continu : environ 3 images/s, d'ou la selection qui "rame".
  // 'scattergl' rend la meme trace en WebGL sur un canvas, avec les memes
  // options (lasso, selected/unselected, hovertemplate, customdata) -- aucune
  // dependance a ajouter, regl est deja dans plotly.js-dist-min.
  //
  // Memoisation : `data` doit etre un tableau STABLE. Recree a chaque rendu,
  // il declenchait un Plotly.react() complet a chaque re-rendu du parent, ce
  // qui annulait en partie l'effort de React.memo/uirevision decrit plus haut.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = useMemo<any[]>(() => ([{
    type: 'scattergl',
    mode: 'markers',
    x, y, text, customdata,
    marker: { color: colors, size: 6, opacity: 0.85 },
    hovertemplate: '<b>%{text}</b><br>x: %{x:.2f}, y: %{y:.2f}<extra></extra>',
    selected: { marker: { color: '#f59e0b', size: 9 } },
    unselected: { marker: { opacity: 0.35 } },
  }]), [x, y, text, customdata, colors])

  const handleSelected = (event: Plotly.PlotSelectionEvent) => {
    if (!event?.points) return
    const ids = event.points
      .map(p => Array.isArray(p.customdata) ? p.customdata[0] as number : null)
      .filter((id): id is number => typeof id === 'number')
    onSelected?.(ids)
  }

  return (
    <div className="relative w-full h-full">
      <Plot
        data={data}
        layout={layout}
        config={{ displayModeBar: true, scrollZoom: true, displaylogo: false }}
        style={{ width: '100%', height: '100%' }}
        onSelected={handleSelected}
        onDeselect={() => onSelected?.([])}
        useResizeHandler
      />
      {colorMode === 'cluster' && <ClusterLegend clusters={uniqueClusters} />}
      {colorMode === 'rarity' && <RarityLegend />}
    </div>
  )
})

export default ScatterPlot
