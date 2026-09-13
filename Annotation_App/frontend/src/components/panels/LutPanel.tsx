// ============================================================
// LutPanel — outil LUT d'affichage (remap 16/8 bits).
// Histogramme des valeurs brutes + 3 modes : Auto (Nσ) / Min-Max / Manuel.
// PORTÉE réglable : Projet (toutes les séquences) OU Séquence courante
// (prioritaire — utile IR vs RGB dans un même projet). La LUT séquence
// s'applique aussi au chemin IA (GD/SAM3/YOLO voient la même image).
// Change la signature de cache (uiStore) -> l'image se recharge avec la LUT.
// ============================================================
import { useCallback, useEffect, useRef, useState } from 'react'
import { X, Wand2, Maximize, SlidersHorizontal, RotateCcw } from 'lucide-react'
import { projectsAPI, datasetAPI, type LutSettings, type Histogram } from '../../services/api'
import { useUIStore } from '../../stores/uiStore'

interface Props {
  projectId: number
  frameId: number | null
  sequenceId: number | null      // null = séquence "principale" (legacy) → portée projet only
  sequenceName: string | null
}

type Mode = 'sigma' | 'minmax' | 'manual'
type Scope = 'project' | 'sequence'

export default function LutPanel({ projectId, frameId, sequenceId, sequenceName }: Props) {
  const toggleLut = useUIStore((s) => s.toggleLut)
  const setLutSignature = useUIStore((s) => s.setLutSignature)

  const [hist, setHist] = useState<Histogram | null>(null)
  const [mode, setMode] = useState<Mode>('sigma')
  const [sigma, setSigma] = useState(3)
  const [lo, setLo] = useState<number | null>(null)
  const [hi, setHi] = useState<number | null>(null)
  // Portée : par défaut la séquence courante si disponible, sinon le projet.
  const [scope, setScope] = useState<Scope>(sequenceId != null ? 'sequence' : 'project')
  const applyTimer = useRef<number | null>(null)

  const canScopeSequence = sequenceId != null

  // (Re)charge la LUT persistée selon la portée courante.
  const loadLut = useCallback((sc: Scope) => {
    const applyLoaded = (lut: LutSettings | null) => {
      setMode(lut?.mode ?? 'sigma')
      setSigma(lut?.sigma ?? 3)
      setLo(lut?.lo ?? null)
      setHi(lut?.hi ?? null)
    }
    if (sc === 'sequence' && sequenceId != null) {
      // Pas de GET dédié : on lit la LUT séquence depuis la liste des séquences.
      datasetAPI.listSequences(projectId)
        .then((seqs) => {
          const s = seqs.find((x) => x.id === sequenceId)
          applyLoaded((s?.lut as LutSettings | undefined) ?? null)
        })
        .catch(() => applyLoaded(null))
    } else {
      projectsAPI.getLut(projectId).then((r) => applyLoaded(r.lut)).catch(() => applyLoaded(null))
    }
  }, [projectId, sequenceId])

  useEffect(() => { loadLut(scope) }, [scope, loadLut])

  useEffect(() => {
    if (frameId == null) return
    projectsAPI.getHistogram(frameId)
      .then((h) => {
        setHist(h)
        setLo((v) => (v == null ? Math.round(h.min) : v))
        setHi((v) => (v == null ? Math.round(h.max) : v))
      })
      .catch(() => setHist(null))
  }, [frameId])

  // Applique la LUT (debounce) -> persiste (projet OU séquence) + signature de cache.
  const apply = useCallback((next: Partial<LutSettings> & { mode: Mode }) => {
    const lut: LutSettings = {
      mode: next.mode,
      sigma: next.sigma ?? sigma,
      lo: next.lo !== undefined ? next.lo : lo,
      hi: next.hi !== undefined ? next.hi : hi,
    }
    if (applyTimer.current) window.clearTimeout(applyTimer.current)
    applyTimer.current = window.setTimeout(() => {
      const req = scope === 'sequence' && sequenceId != null
        ? datasetAPI.setSequenceLut(sequenceId, lut)
        : projectsAPI.setLut(projectId, lut)
      req.then((r) => setLutSignature(r.signature)).catch(() => {})
    }, 180)
  }, [projectId, sequenceId, scope, sigma, lo, hi, setLutSignature])

  // Efface la LUT propre à la séquence → repli sur la LUT projet.
  const resetSequenceLut = () => {
    if (sequenceId == null) return
    datasetAPI.clearSequenceLut(sequenceId)
      .then(() => {
        // Cache-bust + recharge l'affichage projet
        setLutSignature(`seqreset${Date.now()}`)
        loadLut('sequence')
      })
      .catch(() => {})
  }

  const chooseMode = (m: Mode) => {
    setMode(m)
    if (m === 'manual' && hist) {
      const l = lo ?? Math.round(hist.min)
      const h = hi ?? Math.round(hist.max)
      setLo(l); setHi(h)
      apply({ mode: m, lo: l, hi: h })
    } else {
      apply({ mode: m })
    }
  }

  // ── Rendu histogramme (SVG, échelle log pour la lisibilité) ──
  const W = 240, H = 90
  const counts = hist?.counts ?? []
  const maxC = Math.max(1, ...counts)
  const path = counts.map((c, i) => {
    const x = (i / Math.max(1, counts.length - 1)) * W
    const y = H - (Math.log1p(c) / Math.log1p(maxC)) * H
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
  const range = hist ? Math.max(1e-6, hist.max - hist.min) : 1
  const xOf = (v: number) => hist ? ((v - hist.min) / range) * W : 0
  const loX = lo != null ? xOf(lo) : 0
  const hiX = hi != null ? xOf(hi) : W

  return (
    <div data-tour="lut-panel"
         className="absolute top-14 right-4 z-30 w-72 bg-gray-900/95 border border-gray-700 rounded-xl shadow-2xl backdrop-blur">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-800">
        <SlidersHorizontal size={14} className="text-cyan-400" />
        <span className="text-sm font-semibold text-white flex-1">LUT / Affichage</span>
        <button onClick={toggleLut} className="text-gray-500 hover:text-white"><X size={15} /></button>
      </div>

      <div className="p-3 space-y-2.5">
        {/* Portée : projet vs séquence courante */}
        <div>
          <div className="flex rounded-lg border border-gray-700 overflow-hidden text-[11px] font-medium">
            <button onClick={() => setScope('project')}
              className={`flex-1 px-2 py-1.5 ${scope === 'project' ? 'bg-cyan-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200'}`}>
              Projet
            </button>
            <button onClick={() => canScopeSequence && setScope('sequence')}
              disabled={!canScopeSequence}
              title={canScopeSequence ? '' : 'Séquence principale : réglez la LUT au niveau projet'}
              className={`flex-1 px-2 py-1.5 border-l border-gray-700 ${scope === 'sequence' ? 'bg-cyan-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200'} disabled:opacity-40 disabled:cursor-not-allowed`}>
              Séquence
            </button>
          </div>
          {scope === 'sequence' && (
            <div className="flex items-center justify-between mt-1">
              <span className="text-[10px] text-gray-500 truncate" title={sequenceName ?? ''}>
                ▸ {sequenceName ?? `Séquence ${sequenceId}`}
              </span>
              <button onClick={resetSequenceLut}
                className="flex items-center gap-1 text-[10px] text-gray-500 hover:text-cyan-300">
                <RotateCcw size={10} /> repli projet
              </button>
            </div>
          )}
        </div>

        {/* Histogramme */}
        <div className="rounded-lg bg-gray-950 border border-gray-800 p-1.5">
          <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block">
            {path && <path d={path} fill="none" stroke="#22d3ee" strokeWidth={1} opacity={0.9} />}
            {path && <path d={`${path} L${W},${H} L0,${H} Z`} fill="#22d3ee" opacity={0.12} />}
            <rect x={0} y={0} width={Math.max(0, loX)} height={H} fill="#000" opacity={0.45} />
            <rect x={Math.min(W, hiX)} y={0} width={Math.max(0, W - hiX)} height={H} fill="#000" opacity={0.45} />
            <line x1={loX} y1={0} x2={loX} y2={H} stroke="#f472b6" strokeWidth={1.2} />
            <line x1={hiX} y1={0} x2={hiX} y2={H} stroke="#f59e0b" strokeWidth={1.2} />
          </svg>
          <div className="flex justify-between text-[9px] text-gray-500 mt-0.5 font-mono">
            <span>{hist ? hist.min.toFixed(0) : '—'}</span>
            <span>{hist ? `${hist.bit_depth} bits · ${hist.dtype}` : ''}</span>
            <span>{hist ? hist.max.toFixed(0) : '—'}</span>
          </div>
        </div>

        {/* Modes */}
        <div className="flex rounded-lg border border-gray-700 overflow-hidden text-[11px] font-medium">
          <button onClick={() => chooseMode('sigma')} className={`flex-1 flex items-center justify-center gap-1 px-2 py-1.5 ${mode === 'sigma' ? 'bg-cyan-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200'}`}><Wand2 size={11} />Auto σ</button>
          <button onClick={() => chooseMode('minmax')} className={`flex-1 flex items-center justify-center gap-1 px-2 py-1.5 border-l border-gray-700 ${mode === 'minmax' ? 'bg-cyan-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200'}`}><Maximize size={11} />Min-Max</button>
          <button onClick={() => chooseMode('manual')} className={`flex-1 flex items-center justify-center gap-1 px-2 py-1.5 border-l border-gray-700 ${mode === 'manual' ? 'bg-cyan-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200'}`}><SlidersHorizontal size={11} />Manuel</button>
        </div>

        {/* Contrôles selon le mode */}
        {mode === 'sigma' && (
          <div>
            <div className="flex justify-between text-[11px] text-gray-400"><span>Sigma (N)</span><span className="text-cyan-300 font-mono">{sigma.toFixed(1)}σ</span></div>
            <input type="range" min={0.5} max={6} step={0.1} value={sigma}
              onChange={(e) => { const v = parseFloat(e.target.value); setSigma(v); apply({ mode: 'sigma', sigma: v }) }}
              className="w-full accent-cyan-500" />
            <p className="text-[10px] text-gray-600">Étire [moy − Nσ, moy + Nσ] → 0-255. Défaut 3σ.</p>
          </div>
        )}
        {mode === 'minmax' && (
          <p className="text-[10px] text-gray-500">Étire [min, max] réels de la frame → 0-255 (contraste maximal).</p>
        )}
        {mode === 'manual' && (
          <div className="space-y-1.5">
            <div className="grid grid-cols-2 gap-2">
              <label className="text-[11px] text-gray-400">Bas (lo)
                <input type="number" value={lo ?? ''} onChange={(e) => { const v = e.target.value === '' ? null : parseFloat(e.target.value); setLo(v); apply({ mode: 'manual', lo: v }) }}
                  className="w-full mt-0.5 bg-gray-800 border border-gray-700 rounded px-1.5 py-1 text-xs text-white font-mono" />
              </label>
              <label className="text-[11px] text-gray-400">Haut (hi)
                <input type="number" value={hi ?? ''} onChange={(e) => { const v = e.target.value === '' ? null : parseFloat(e.target.value); setHi(v); apply({ mode: 'manual', hi: v }) }}
                  className="w-full mt-0.5 bg-gray-800 border border-gray-700 rounded px-1.5 py-1 text-xs text-white font-mono" />
              </label>
            </div>
            {hist && (
              <>
                <input type="range" min={hist.min} max={hist.max} step={Math.max(1, (hist.max - hist.min) / 1000)} value={lo ?? hist.min}
                  onChange={(e) => { const v = parseFloat(e.target.value); setLo(v); apply({ mode: 'manual', lo: v }) }} className="w-full accent-pink-500" />
                <input type="range" min={hist.min} max={hist.max} step={Math.max(1, (hist.max - hist.min) / 1000)} value={hi ?? hist.max}
                  onChange={(e) => { const v = parseFloat(e.target.value); setHi(v); apply({ mode: 'manual', hi: v }) }} className="w-full accent-amber-500" />
              </>
            )}
          </div>
        )}
        <p className="text-[10px] text-gray-600">
          {scope === 'sequence'
            ? 'Mémorisé pour cette séquence (prioritaire sur le projet) et appliqué à l’IA.'
            : 'Mémorisé pour tout le projet.'}
        </p>
      </div>
    </div>
  )
}
