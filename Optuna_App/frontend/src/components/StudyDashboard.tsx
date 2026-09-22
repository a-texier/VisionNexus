import { useEffect, useMemo, useState } from 'react'
import {
  AreaChart, Area, BarChart, Bar, CartesianGrid, ComposedChart, Line,
  ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis,
} from 'recharts'
import {
  ArrowRight, BrainCircuit, CircleDot, Database, Gauge,
  Pause, Play, Scissors, Search, SlidersHorizontal, Sparkles,
} from 'lucide-react'

import type { StudyAnalysis, StudySearchSpaceParam, StudyStatus_API, Trial } from '../types/api'

const CARD = 'rounded-xl border border-gray-800 bg-gray-900 p-4'
const GRID = '#1f2937'
const TICK = { fill: '#6b7280', fontSize: 10 }

function fmt(value: unknown, digits = 5): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return value == null ? '—' : String(value)
  if (value === 0) return '0'
  return Math.abs(value) < 0.001 || Math.abs(value) >= 10_000
    ? value.toExponential(2)
    : Number(value.toPrecision(digits)).toString()
}

function isBetter(a: number, b: number, direction: string): boolean {
  return direction.toUpperCase() === 'MINIMIZE' ? a < b : a > b
}

function completed(trials: Trial[]): Trial[] {
  return trials.filter(t => t.state === 'COMPLETE' && t.value != null).sort((a, b) => a.number - b.number)
}

function inferSpace(trials: Trial[]): StudySearchSpaceParam[] {
  const keys = Array.from(new Set(trials.flatMap(t => Object.keys(t.params))))
  return keys.map(name => {
    const values = trials.map(t => t.params[name]).filter(v => v !== undefined)
    const numeric = values.filter(v => typeof v === 'number') as number[]
    if (numeric.length === values.length && numeric.length) {
      return { name, type: 'float', low: Math.min(...numeric), high: Math.max(...numeric), log: false, distribution: 'observée dans les trials' }
    }
    return { name, type: 'categorical', choices: Array.from(new Set(values.map(String))), distribution: 'catégorielle observée' }
  })
}

function normalize(value: number, spec: StudySearchSpaceParam): number {
  const low = Number(spec.low)
  const high = Number(spec.high)
  if (!Number.isFinite(low) || !Number.isFinite(high) || high === low) return 0.5
  if (spec.log && value > 0 && low > 0 && high > 0) {
    return Math.max(0, Math.min(1, (Math.log(value) - Math.log(low)) / (Math.log(high) - Math.log(low))))
  }
  return Math.max(0, Math.min(1, (value - low) / (high - low)))
}

function SectionTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return <div className="mb-3"><h2 className="text-sm font-semibold text-white">{title}</h2><p className="mt-1 text-xs leading-relaxed text-gray-500">{subtitle}</p></div>
}

export function OptunaOptimizationOverview({ analysis, status }: { analysis?: StudyAnalysis; status?: StudyStatus_API }) {
  const cfg = analysis?.configuration
  const context = status?.context ?? {}
  const steps = [
    [Database, 'Dataset'], [SlidersHorizontal, 'Espace de recherche'], [CircleDot, 'Trial'],
    [Gauge, 'Training'], [Sparkles, 'Objectif'], [BrainCircuit, 'Apprentissage TPE'], [Search, 'Trial suivant'],
  ] as const
  const cells: Array<[string, string | number]> = [
    ['Dataset', String(cfg?.dataset || context.data_yaml || context.script_path || '—')],
    ['Nombre de trials', cfg?.n_trials ?? status?.n_trials ?? '—'],
    ['Direction', String(cfg?.direction || status?.direction || context.direction || '—').toLowerCase()],
    ['Métrique objectif', String(cfg?.objective_metric || context.metric || '—')],
    ['Sampler', cfg?.sampler || 'TPESampler'],
    ['Pruner', cfg?.pruner || status?.pruner_status || '—'],
  ]
  const startup = Number(context.n_startup_trials ?? 10)
  const requested = Number(context.requested_n_trials ?? cfg?.n_trials ?? status?.n_trials ?? 0)
  const adaptive = status?.adaptive_decisions ?? 0
  const samplerPhase = status?.sampler_phase ?? 'unknown'
  return <section className={`${CARD} border-indigo-800/40 bg-gradient-to-br from-indigo-950/25 to-gray-900`}>
    <SectionTitle title="Comment cette étude Optuna fonctionne" subtitle="Le cycle réel : proposer une configuration, l’entraîner, mesurer l’objectif, puis utiliser les observations disponibles pour proposer la suite." />
    <div className="flex flex-wrap items-center gap-2">
      {steps.map(([Icon, label], index) => <div className="contents" key={label}>
        <div className="flex min-w-[120px] flex-1 items-center gap-2 rounded-lg border border-gray-700 bg-gray-950/70 px-3 py-2 text-xs text-gray-200"><Icon size={14} className="text-indigo-300"/><span>{label}</span></div>
        {index < steps.length - 1 && <ArrowRight size={14} className="shrink-0 text-gray-600"/>}
      </div>)}
    </div>
    <p className="mt-3 rounded-lg border border-blue-900/50 bg-blue-950/20 px-3 py-2 text-[11px] leading-relaxed text-blue-200/80">
      <b>TPE</b> signifie <b>Tree-structured Parzen Estimator</b>. Il ne « comprend » pas causalement le modèle : il construit des distributions probabilistes à partir des essais observés et favorise ensuite des propositions jugées prometteuses, tout en conservant de l’exploration.
    </p>
    <p className={`mt-2 rounded-lg border px-3 py-2 text-[11px] leading-relaxed ${samplerPhase === 'adaptive' ? 'border-emerald-900/50 bg-emerald-950/20 text-emerald-200/80' : 'border-amber-900/50 bg-amber-950/15 text-amber-100/75'}`}>
      <b>Phase du sampler : {samplerPhase === 'adaptive' ? 'TPE adaptatif' : samplerPhase === 'startup' ? 'démarrage / exploration initiale' : 'non déterminée'}.</b>{' '}
      {adaptive} décision(s) adaptative(s) observée(s) ; le seuil configuré est {startup} trials COMPLETE.
      {requested > 0 && requested <= startup ? ` Avec un budget demandé de ${requested} trials, cette étude ne peut pas dépasser la phase startup.` : ''}
    </p>
    <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
      {cells.map(([label, value]) => <div key={label} className="rounded-lg bg-gray-800/70 p-2"><p className="text-[10px] uppercase tracking-wide text-gray-500">{label}</p><p className="mt-1 truncate font-mono text-xs text-white" title={String(value)}>{String(value)}</p></div>)}
    </div>
  </section>
}

export function SearchSpacePanel({ space, best }: { space: StudySearchSpaceParam[]; best: Trial | null }) {
  if (!space.length) return <section className={CARD}><SectionTitle title="Espace de recherche" subtitle="Aucune distribution n’est encore enregistrée pour cette étude." /></section>
  return <section className={CARD}>
    <SectionTitle title="Espace de recherche" subtitle="Ce qu’Optuna avait le droit d’explorer. Le repère doré indique la valeur du meilleur trial officiel." />
    <div className="grid gap-3 md:grid-cols-2">
      {space.map(spec => {
        const bestValue = best?.params[spec.name] ?? spec.best_value
        const numeric = typeof bestValue === 'number' && spec.low != null && spec.high != null
        const pct = numeric ? normalize(bestValue, spec) * 100 : 0
        const distribution = spec.distribution || (spec.type === 'categorical' ? 'CategoricalDistribution' : `${spec.type === 'int' ? 'Int' : 'Float'}Distribution${spec.log ? ' (log)' : ''}`)
        return <div key={spec.name} className="rounded-lg border border-gray-800 bg-gray-950/60 p-3">
          <div className="flex items-start justify-between gap-3"><div><p className="font-mono text-sm text-cyan-300">{spec.name}</p><p className="text-[10px] text-gray-500">{spec.type} · {distribution}</p></div><span className="rounded bg-amber-950/40 px-2 py-1 font-mono text-[11px] text-amber-300">best: {fmt(bestValue)}</span></div>
          {spec.type === 'categorical' ? <div className="mt-3 flex flex-wrap gap-1">{spec.choices?.map(v => <span key={String(v)} className={`rounded border px-2 py-1 text-[10px] ${String(v) === String(bestValue) ? 'border-amber-500 bg-amber-950/30 text-amber-200' : 'border-gray-700 text-gray-400'}`}>{String(v)}</span>)}</div> : <>
            <div className="relative mt-5 h-2 rounded-full bg-gradient-to-r from-indigo-950 via-indigo-600 to-cyan-500"><span className="absolute -top-1.5 h-5 w-1 rounded bg-amber-300 shadow-[0_0_8px_#f59e0b]" style={{ left: `calc(${pct}% - 2px)` }}/></div>
            <div className="mt-2 flex justify-between font-mono text-[10px] text-gray-500"><span>{fmt(spec.low)}</span><span>{spec.log ? 'échelle logarithmique' : 'échelle linéaire'}</span><span>{fmt(spec.high)}</span></div>
          </>}
        </div>
      })}
    </div>
  </section>
}

export function OptimizationHistoryChart({ trials, direction }: { trials: Trial[]; direction: string }) {
  let best = direction.toUpperCase() === 'MINIMIZE' ? Infinity : -Infinity
  const data = completed(trials).map(t => {
    const value = t.value as number
    if (isBetter(value, best, direction)) best = value
    return { trial: t.number, objective: value, best }
  })
  return <section className={CARD}><SectionTitle title="Historique de l’optimisation" subtitle="Points = scores individuels observés · ligne verte = meilleur score obtenu jusque-là." />
    {data.length ? <ResponsiveContainer width="100%" height={250}><ComposedChart data={data}><CartesianGrid strokeDasharray="3 3" stroke={GRID}/><XAxis dataKey="trial" tick={TICK}/><YAxis tick={TICK} width={58} tickFormatter={v => fmt(Number(v), 4)}/><Tooltip contentStyle={{background:'#111827',border:'1px solid #374151',borderRadius:8,fontSize:11}}/><Scatter dataKey="objective" fill="#818cf8" name="Objectif"/><Line type="stepAfter" dataKey="best" stroke="#34d399" strokeWidth={2} dot={false} name="Meilleur jusque-là"/></ComposedChart></ResponsiveContainer> : <p className="py-16 text-center text-xs text-gray-600">Aucun trial COMPLETE avec objectif numérique.</p>}
  </section>
}

export function ParameterInteractionHeatmap({ trials, space, direction }: { trials: Trial[]; space: StudySearchSpaceParam[]; direction: string }) {
  const numeric = space.filter(s => s.type !== 'categorical' && s.low != null && s.high != null)
  const [xName, setXName] = useState(numeric[0]?.name ?? '')
  const [yName, setYName] = useState(numeric[1]?.name ?? numeric[0]?.name ?? '')
  useEffect(() => { if (!numeric.some(s => s.name === xName)) setXName(numeric[0]?.name ?? '') }, [numeric, xName])
  useEffect(() => { if (!numeric.some(s => s.name === yName)) setYName(numeric[1]?.name ?? numeric[0]?.name ?? '') }, [numeric, yName])
  const bins = 7
  const cells = useMemo(() => {
    const xSpec = numeric.find(s => s.name === xName), ySpec = numeric.find(s => s.name === yName)
    const buckets = Array.from({ length: bins * bins }, () => [] as number[])
    if (xSpec && ySpec) completed(trials).forEach(t => {
      const xv = t.params[xName], yv = t.params[yName]
      if (typeof xv !== 'number' || typeof yv !== 'number') return
      const x = Math.min(bins - 1, Math.floor(normalize(xv, xSpec) * bins))
      const y = Math.min(bins - 1, Math.floor(normalize(yv, ySpec) * bins))
      buckets[(bins - 1 - y) * bins + x].push(t.value as number)
    })
    return buckets.map(values => values.length ? values.reduce((a,b) => a+b,0) / values.length : null)
  }, [trials, xName, yName, numeric])
  const finite = cells.filter((v): v is number => v != null)
  const min = finite.length ? Math.min(...finite) : 0, max = finite.length ? Math.max(...finite) : 1
  return <section className={CARD}><SectionTitle title="Interaction entre paramètres" subtitle="Chaque case regroupe les trials de la zone ; sa valeur est la moyenne de l’objectif. Une case vide reste vide : aucune interpolation n’est inventée." />
    <div className="mb-3 flex gap-2">{[['X',xName,setXName],['Y',yName,setYName]].map(([label,value,setter]) => <label key={String(label)} className="flex flex-1 items-center gap-2 text-xs text-gray-500"><span>{String(label)}</span><select className="w-full rounded border border-gray-700 bg-gray-950 px-2 py-1.5 text-gray-200" value={String(value)} onChange={e => (setter as (v:string)=>void)(e.target.value)}>{numeric.map(s => <option key={s.name}>{s.name}</option>)}</select></label>)}</div>
    {numeric.length >= 2 ? <div><div className="grid aspect-[1.7] max-h-72 gap-1" style={{gridTemplateColumns:`repeat(${bins},minmax(0,1fr))`}}>{cells.map((v,i) => {
      const quality = v == null || max === min ? .5 : (v-min)/(max-min)
      const good = direction.toUpperCase() === 'MINIMIZE' ? 1-quality : quality
      return <div key={i} title={v == null ? 'Aucun trial dans cette zone' : `Objectif moyen : ${fmt(v)}`} className="flex items-center justify-center rounded text-[9px]" style={{background:v==null?'#111827':`rgba(16,185,129,${.18+good*.75})`,border:'1px solid #1f2937',color:v==null?'#374151':'#ecfdf5'}}>{v == null ? '·' : fmt(v,3)}</div>
    })}</div><div className="mt-2 flex justify-between text-[10px] text-gray-600"><span>{xName} faible</span><span>{xName} fort · axe Y : {yName}{numeric.find(s=>s.name===xName)?.log || numeric.find(s=>s.name===yName)?.log ? ' · transformation log respectée' : ''}</span></div></div> : <p className="py-14 text-center text-xs text-gray-600">Deux paramètres numériques sont nécessaires.</p>}
  </section>
}

export function TPEEvolutionView({ trials, space }: { trials: Trial[]; space: StudySearchSpaceParam[] }) {
  const usable = completed(trials)
  const numeric = space.filter(s => s.type !== 'categorical')
  const [param, setParam] = useState(numeric[0]?.name ?? '')
  const [limit, setLimit] = useState(Math.max(1, usable.length))
  const [playing, setPlaying] = useState(false)
  useEffect(() => { setLimit(Math.max(1, usable.length)) }, [usable.length])
  useEffect(() => {
    if (!playing) return
    const id = window.setInterval(() => setLimit(v => v >= usable.length ? 1 : v + 1), 800)
    return () => window.clearInterval(id)
  }, [playing, usable.length])
  const visible = usable.slice(0, limit).filter(t => typeof t.params[param] === 'number').map(t => ({ x: t.params[param] as number, y: t.number, value: t.value }))
  return <section className={CARD}><SectionTitle title="Évolution de l’exploration TPE" subtitle="Lecture factuelle des propositions observées au fil des trials. Les regroupements suggèrent une concentration ; ils ne prouvent pas pourquoi TPE a choisi un point précis." />
    <div className="mb-2 flex items-center gap-2"><select value={param} onChange={e=>setParam(e.target.value)} className="rounded border border-gray-700 bg-gray-950 px-2 py-1.5 text-xs text-gray-200">{numeric.map(s=><option key={s.name}>{s.name}</option>)}</select><button onClick={()=>setPlaying(v=>!v)} className="flex items-center gap-1 rounded border border-indigo-700/50 bg-indigo-950/30 px-2 py-1.5 text-xs text-indigo-200">{playing?<Pause size={12}/>:<Play size={12}/>} {playing?'Pause':'Lecture'}</button><span className="ml-auto text-xs text-gray-500">jusqu’au trial #{usable[Math.max(0,limit-1)]?.number ?? '—'}</span></div>
    <ResponsiveContainer width="100%" height={220}><ScatterChart><CartesianGrid strokeDasharray="3 3" stroke={GRID}/><XAxis dataKey="x" type="number" scale={numeric.find(s=>s.name===param)?.log?'log':'auto'} domain={['auto','auto']} tick={TICK} name={param}/><YAxis dataKey="y" type="number" tick={TICK} name="Trial"/><ZAxis range={[55,55]}/><Tooltip contentStyle={{background:'#111827',border:'1px solid #374151',borderRadius:8,fontSize:11}}/><Scatter data={visible} fill="#818cf8"/></ScatterChart></ResponsiveContainer>
    <input aria-label="Trial affiché" className="w-full accent-indigo-500" type="range" min={1} max={Math.max(1,usable.length)} value={Math.min(limit,Math.max(1,usable.length))} onChange={e=>{setPlaying(false);setLimit(Number(e.target.value))}}/>
  </section>
}

export function ParameterImportanceChart({ importances, error, warning }: { importances?: Record<string, number> | null; error?: string | null; warning?: string | null }) {
  const data = Object.entries(importances ?? {}).sort((a,b)=>b[1]-a[1]).map(([name,value])=>({name,value}))
  return <section className={CARD}><SectionTitle title="Importance des paramètres" subtitle="L’importance indique combien un paramètre explique les variations observées de l’objectif. Elle ne dit pas que des valeurs plus grandes sont meilleures." />
    {data.length ? <><ResponsiveContainer width="100%" height={220}><BarChart data={data} layout="vertical" margin={{left:15}}><CartesianGrid strokeDasharray="3 3" stroke={GRID}/><XAxis type="number" domain={[0,1]} tick={TICK}/><YAxis type="category" dataKey="name" width={85} tick={TICK}/><Tooltip contentStyle={{background:'#111827',border:'1px solid #374151',borderRadius:8,fontSize:11}}/><Bar dataKey="value" fill="#22d3ee" radius={[0,4,4,0]}/></BarChart></ResponsiveContainer>{warning && <p className="rounded-lg border border-amber-900/50 bg-amber-950/15 p-2 text-[10px] leading-relaxed text-amber-200/70">{warning}</p>}</> : <div className="rounded-lg border border-gray-800 bg-gray-950/50 p-4 text-xs leading-relaxed text-gray-500">Importance indisponible : elle nécessite plusieurs trials COMPLETE comparables et des paramètres variables.{error ? <p className="mt-2 text-amber-300">Backend : {error}</p> : null}</div>}
  </section>
}

export function ParallelCoordinatesChart({ trials, space, direction }: { trials: Trial[]; space: StudySearchSpaceParam[]; direction: string }) {
  const rows = completed(trials).slice(-80)
  const axes = [...space.filter(s=>s.type!=='categorical').slice(0,6).map(s=>s.name), 'objectif']
  const W=760,H=250,pad=35
  const values = (t:Trial,key:string) => key==='objectif' ? t.value as number : Number(t.params[key])
  const domains = axes.map(key => { const vs=rows.map(t=>values(t,key)).filter(Number.isFinite); return [Math.min(...vs),Math.max(...vs)] })
  const objectives=rows.map(t=>t.value as number), lo=Math.min(...objectives), hi=Math.max(...objectives)
  return <section className={CARD}><SectionTitle title="Coordonnées parallèles" subtitle="Une ligne = un trial COMPLETE. Suivez une ligne pour relier sa configuration à son objectif." />
    {rows.length && axes.length>1 ? <div className="overflow-x-auto"><svg viewBox={`0 0 ${W} ${H}`} className="min-w-[680px] w-full h-[250px]">
      {axes.map((a,i)=>{const x=pad+i*(W-2*pad)/(axes.length-1);return <g key={a}><line x1={x} x2={x} y1={25} y2={H-35} stroke="#374151"/><text x={x} y={14} fill="#9ca3af" fontSize="10" textAnchor="middle">{a}</text><text x={x} y={H-18} fill="#4b5563" fontSize="9" textAnchor="middle">{fmt(domains[i][0],3)} → {fmt(domains[i][1],3)}</text></g>})}
      {rows.map(t => {
        const q = hi === lo ? 0.5 : ((t.value as number) - lo) / (hi - lo)
        const good = direction.toUpperCase() === 'MINIMIZE' ? 1 - q : q
        const points = axes.map((a, i) => {
          const [mn, mx] = domains[i]
          const v = values(t, a)
          const norm = mx === mn ? 0.5 : (v - mn) / (mx - mn)
          return `${pad + i * (W - 2 * pad) / (axes.length - 1)},${H - 35 - norm * (H - 60)}`
        }).join(' ')
        return <polyline key={t.number} points={points} fill="none" stroke={`rgba(${Math.round(129-80*good)},${Math.round(140+70*good)},${Math.round(248-50*good)},.42)`} strokeWidth="1"/>
      })}
    </svg></div> : <p className="py-14 text-center text-xs text-gray-600">Pas assez de données numériques COMPLETE.</p>}
  </section>
}

export function ObjectiveDistributionChart({ trials, direction }: { trials: Trial[]; direction: string }) {
  const values=completed(trials).map(t=>t.value as number)
  const sorted=[...values].sort((a,b)=>a-b), mean=values.length?values.reduce((a,b)=>a+b,0)/values.length:null, median=values.length?(sorted[Math.floor((sorted.length-1)/2)]+sorted[Math.ceil((sorted.length-1)/2)])/2:null
  const bins=10, lo=values.length?Math.min(...values):0, hi=values.length?Math.max(...values):1, width=(hi-lo||1)/bins
  const hist=Array.from({length:bins},(_,i)=>({x:lo+(i+.5)*width,count:0})); values.forEach(v=>hist[Math.min(bins-1,Math.floor((v-lo)/(width||1)))].count++)
  return <section className={CARD}><SectionTitle title="Distribution de l’objectif" subtitle="Répartition des scores officiels COMPLETE : dispersion, centre et extrêmes." />
    <div className="mb-2 grid grid-cols-4 gap-2">{[['Meilleur',values.length?(direction.toUpperCase()==='MINIMIZE'?Math.min(...values):Math.max(...values)):null],['Moyenne',mean],['Médiane',median],['Pire',values.length?(direction.toUpperCase()==='MINIMIZE'?Math.max(...values):Math.min(...values)):null]].map(([k,v])=><div key={String(k)} className="rounded bg-gray-800 p-2 text-center"><p className="text-[10px] text-gray-500">{k}</p><p className="font-mono text-xs text-white">{fmt(v)}</p></div>)}</div>
    <ResponsiveContainer width="100%" height={190}><AreaChart data={hist}><CartesianGrid strokeDasharray="3 3" stroke={GRID}/><XAxis dataKey="x" tick={TICK} tickFormatter={v=>fmt(Number(v),3)}/><YAxis allowDecimals={false} tick={TICK}/><Tooltip contentStyle={{background:'#111827',border:'1px solid #374151',borderRadius:8,fontSize:11}}/><Area type="step" dataKey="count" stroke="#a78bfa" fill="#7c3aed" fillOpacity={.35}/></AreaChart></ResponsiveContainer>
  </section>
}

export function PruningSummary({ status }: { status?: StudyStatus_API }) {
  const c=status?.counts ?? {complete:0,pruned:0,running:0,failed:0,waiting:0,interrupted:0}
  const items=[['COMPLETE',c.complete,'text-emerald-300','bg-emerald-500'],['PRUNED',c.pruned,'text-violet-300','bg-violet-500'],['RUNNING',c.running,'text-blue-300','bg-blue-500'],['FAILED',c.failed,'text-red-300','bg-red-500']]
  const total=Math.max(1,items.reduce((n,x)=>n+Number(x[1]),0))
  return <section className={CARD}><SectionTitle title="Trials et pruning" subtitle="Le pruning arrête tôt un trial peu prometteur à partir de métriques intermédiaires, afin d’économiser du calcul." />
    <div className="flex h-2 overflow-hidden rounded-full bg-gray-800">{items.map(([label,n,,bg])=><div key={String(label)} className={String(bg)} style={{width:`${Number(n)/total*100}%`}}/>)}</div>
    <div className="mt-3 grid grid-cols-4 gap-2">{items.map(([label,n,color])=><div key={String(label)} className="rounded bg-gray-950/60 p-2 text-center"><p className={`text-lg font-semibold ${color}`}>{n}</p><p className="text-[9px] text-gray-500">{label}</p></div>)}</div>
    <div className="mt-3 flex gap-2 rounded-lg border border-gray-800 bg-gray-950/50 p-3 text-xs text-gray-400"><Scissors size={15} className="shrink-0 text-violet-300"/><p><b className="text-indigo-200">TPE</b> décide quoi essayer ensuite. <b className="text-violet-200">Le pruner</b> décide s’il faut continuer le trial en cours. Ici : {status?.pruner_status ?? 'état inconnu'}.</p></div>
  </section>
}

export function StudyDashboard({ trials, status, analysis, best, direction }: { trials:Trial[]; status?:StudyStatus_API; analysis?:StudyAnalysis; best:Trial|null; direction:string }) {
  const space=analysis?.search_space?.length ? analysis.search_space : inferSpace(trials)
  return <div className="space-y-4">
    <OptunaOptimizationOverview analysis={analysis} status={status}/>
    <SearchSpacePanel space={space} best={best}/>
    <div className="grid gap-4 xl:grid-cols-2"><OptimizationHistoryChart trials={trials} direction={direction}/><ObjectiveDistributionChart trials={trials} direction={direction}/></div>
    <div className="grid gap-4 xl:grid-cols-2"><ParameterInteractionHeatmap trials={trials} space={space} direction={direction}/><TPEEvolutionView trials={trials} space={space}/></div>
    <div className="grid gap-4 xl:grid-cols-2"><ParameterImportanceChart importances={analysis?.parameter_importances} error={analysis?.importance_error} warning={analysis?.importance_warning}/><PruningSummary status={status}/></div>
    <ParallelCoordinatesChart trials={trials} space={space} direction={direction}/>
  </div>
}
