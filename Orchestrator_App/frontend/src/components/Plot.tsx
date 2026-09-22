// Plot.tsx — wrapper React minimal autour de plotly.js (bundle min).
// Rendu interactif (zoom, hover, pan, toggle légende) + thème sombre cohérent.
// On évite react-plotly.js (soucis de build Vite) : Plotly.react dans un useEffect.
import { useEffect, useRef } from 'react'
// @ts-expect-error — pas de types pour le bundle dist-min
import Plotly from 'plotly.js-dist-min'

export interface PlotProps {
  data: Record<string, unknown>[]
  layout?: Record<string, unknown>
  height?: number
  className?: string
}

// Layout sombre par défaut (fond transparent, grille discrète, police claire).
const DARK_LAYOUT: Record<string, unknown> = {
  paper_bgcolor: 'rgba(0,0,0,0)',
  plot_bgcolor: 'rgba(0,0,0,0)',
  font: { color: '#cbd5e1', size: 11, family: 'ui-sans-serif, system-ui' },
  margin: { l: 48, r: 16, t: 28, b: 40 },
  xaxis: { gridcolor: 'rgba(148,163,184,0.12)', zerolinecolor: 'rgba(148,163,184,0.2)' },
  yaxis: { gridcolor: 'rgba(148,163,184,0.12)', zerolinecolor: 'rgba(148,163,184,0.2)' },
  legend: { orientation: 'h', y: -0.2, font: { size: 10 } },
  hovermode: 'closest',
  colorway: ['#60a5fa', '#a78bfa', '#34d399', '#fbbf24', '#f472b6', '#22d3ee', '#f87171', '#a3e635'],
}

const CONFIG = { displayModeBar: true, displaylogo: false, responsive: true,
  modeBarButtonsToRemove: ['lasso2d', 'select2d'] }

export default function Plot({ data, layout, height = 260, className }: PlotProps) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!ref.current) return
    const merged = {
      ...DARK_LAYOUT, ...layout, height,
      xaxis: { ...(DARK_LAYOUT.xaxis as object), ...((layout?.xaxis as object) ?? {}) },
      yaxis: { ...(DARK_LAYOUT.yaxis as object), ...((layout?.yaxis as object) ?? {}) },
    }
    Plotly.react(ref.current, data, merged, CONFIG)
  }, [data, layout, height])
  useEffect(() => {
    const el = ref.current
    return () => { if (el) Plotly.purge(el) }
  }, [])
  return <div ref={ref} className={className} style={{ width: '100%', height }} />
}

// Helper : exporte un ensemble de figures + tableaux en RAPPORT HTML autonome
// (Plotly embarqué inline → interactif hors-ligne). `plotlyJs` = source de
// plotly.min.js (chargé en import dynamique ?raw par l'appelant → chunk séparé).
export function buildHtmlReport(opts: {
  title: string
  subtitle?: string
  plotlyJs: string
  sections: { heading: string; note?: string; figures?: { title: string; data: unknown[]; layout?: unknown }[]; html?: string }[]
}): string {
  const plotlyJs = opts.plotlyJs
  const figScripts: string[] = []
  const body = opts.sections.map((s, si) => {
    const figs = (s.figures ?? []).map((f, fi) => {
      const id = `fig_${si}_${fi}`
      figScripts.push(`Plotly.newPlot(${JSON.stringify(id)}, ${JSON.stringify(f.data)}, Object.assign(${JSON.stringify(DARK_LAYOUT)}, ${JSON.stringify(f.layout ?? {})}), {displaylogo:false,responsive:true});`)
      return `<h3>${f.title}</h3><div id="${id}" class="plot"></div>`
    }).join('\n')
    return `<section><h2>${s.heading}</h2>${s.note ? `<p class="note">${s.note}</p>` : ''}${s.html ?? ''}${figs}</section>`
  }).join('\n')
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${opts.title}</title>
<script>${plotlyJs}</script>
<style>
body{background:#0b0f17;color:#e2e8f0;font-family:ui-sans-serif,system-ui;max-width:1000px;margin:0 auto;padding:24px}
h1{font-size:20px} h2{font-size:15px;border-bottom:1px solid #1e293b;padding-bottom:6px;margin-top:28px}
h3{font-size:12px;color:#94a3b8;margin:14px 0 4px} .note{color:#94a3b8;font-size:12px}
table{width:100%;border-collapse:collapse;font-size:12px;margin:8px 0} td,th{border:1px solid #1e293b;padding:4px 8px;text-align:left}
th{color:#94a3b8;font-weight:600} .plot{height:300px;margin-bottom:8px} .sub{color:#64748b;font-size:12px}
</style></head><body>
<h1>${opts.title}</h1>${opts.subtitle ? `<p class="sub">${opts.subtitle}</p>` : ''}
${body}
<script>${figScripts.join('\n')}</script>
</body></html>`
}
