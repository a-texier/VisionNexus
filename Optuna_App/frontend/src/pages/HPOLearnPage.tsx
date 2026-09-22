import { useEffect, useState } from 'react'
import {
  ArrowRight, BookOpen, BrainCircuit, CheckCircle2, Database, Gauge,
  Grid3X3, Pause, Play, RefreshCw, Scissors, Shuffle, SlidersHorizontal,
  Sparkles, Target, Trophy,
} from 'lucide-react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useT } from '../i18n/useLang'

const CARD = 'rounded-xl border border-gray-800 bg-gray-900 p-5'
const trials = [
  {n:1,lr:0.00018,mosaic:.91,scale:.73,score:.612},{n:2,lr:0.0072,mosaic:.12,scale:.19,score:.654},
  {n:3,lr:0.0011,mosaic:.55,scale:.82,score:.701},{n:4,lr:0.00045,mosaic:.32,scale:.41,score:.677},
  {n:5,lr:0.0041,mosaic:.73,scale:.57,score:.716},{n:6,lr:0.00009,mosaic:.18,scale:.92,score:.603},
  {n:7,lr:0.0023,mosaic:.44,scale:.35,score:.735},{n:8,lr:0.0088,mosaic:.64,scale:.68,score:.661},
  {n:9,lr:0.0017,mosaic:.27,scale:.54,score:.728},{n:10,lr:0.00031,mosaic:.84,scale:.24,score:.642},
  {n:11,lr:0.0028,mosaic:.42,scale:.49,score:.741},{n:12,lr:0.0019,mosaic:.51,scale:.46,score:.748},
  {n:13,lr:0.0034,mosaic:.37,scale:.58,score:.739},{n:14,lr:0.0015,mosaic:.47,scale:.52,score:.752},
  {n:15,lr:0.0021,mosaic:.56,scale:.39,score:.746},{n:16,lr:0.0018,mosaic:.45,scale:.57,score:.755},
  {n:17,lr:0.0025,mosaic:.49,scale:.51,score:.751},{n:18,lr:0.00165,mosaic:.43,scale:.48,score:.758},
]

function Section({ title, eyebrow, children }: { title:string; eyebrow?:string; children:React.ReactNode }) {
  return <section className={CARD}>{eyebrow && <p className="mb-1 text-[10px] font-semibold uppercase tracking-[.18em] text-indigo-400">{eyebrow}</p>}<h2 className="text-base font-semibold text-white">{title}</h2><div className="mt-3 text-sm leading-relaxed text-gray-400">{children}</div></section>
}

function Term({ icon:Icon, name, children }: { icon:typeof Database; name:string; children:React.ReactNode }) {
  return <div className="rounded-lg border border-gray-800 bg-gray-950/60 p-3"><div className="flex items-center gap-2 text-cyan-300"><Icon size={15}/><b className="text-xs">{name}</b></div><p className="mt-2 text-xs leading-relaxed text-gray-400">{children}</p></div>
}

function SearchSpaceExample() {
  const t = useT()
  const [lr,setLr]=useState(.001),[mosaic,setMosaic]=useState(.5),[scale,setScale]=useState(.5)
  return <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
    <div className="space-y-4">
      <label className="block text-xs"><span className="flex justify-between"><b className="text-white">lr — learning rate</b><code className="text-cyan-300">{lr.toExponential(2)}</code></span><input className="mt-2 w-full accent-indigo-500" type="range" min={-5} max={-1} step={.05} value={Math.log10(lr)} onChange={e=>setLr(10**Number(e.target.value))}/><span className="flex justify-between text-[10px] text-gray-600"><i>10⁻⁵</i><i>{t('distribution logarithmique')}</i><i>10⁻¹</i></span></label>
      {[['mosaic',mosaic,setMosaic],['scale',scale,setScale]].map(([name,value,setter])=><label key={String(name)} className="block text-xs"><span className="flex justify-between"><b className="text-white">{String(name)}</b><code className="text-cyan-300">{Number(value).toFixed(2)}</code></span><input className="mt-2 w-full accent-indigo-500" type="range" min={0} max={1} step={.01} value={Number(value)} onChange={e=>(setter as (v:number)=>void)(Number(e.target.value))}/><span className="flex justify-between text-[10px] text-gray-600"><i>0</i><i>{t('distribution linéaire')}</i><i>1</i></span></label>)}
    </div>
    <div className="rounded-lg border border-indigo-900/50 bg-indigo-950/20 p-3"><p className="text-xs font-semibold text-indigo-200">{t('Une configuration possible')}</p><pre className="mt-3 text-[11px] leading-6 text-cyan-200">{`lr: ${lr.toExponential(3)}\nmosaic: ${mosaic.toFixed(2)}\nscale: ${scale.toFixed(2)}`}</pre><p className="mt-3 text-[11px] text-gray-500">{t('Déplacer les curseurs ne lance rien : vous construisez simplement un exemple de trial.')}</p></div>
  </div>
}

function StrategyComparison() {
  const t = useT()
  const methods=[
    [Grid3X3,'Grid Search','Teste une grille prédéfinie. Exhaustif sur la grille, mais le coût explose avec le nombre de paramètres.'],
    [Shuffle,'Random Search','Tire indépendamment dans l’espace. Bon socle, simple et souvent plus efficace qu’une grande grille.'],
    [BrainCircuit,'TPE','Utilise les essais observés pour favoriser probabilistiquement des régions prometteuses sans abandonner toute exploration.'],
  ] as const
  return <div className="grid gap-3 md:grid-cols-3">{methods.map(([Icon,name,text],i)=><div key={name} className={`rounded-xl border p-4 ${i===2?'border-indigo-600/60 bg-indigo-950/25':'border-gray-800 bg-gray-950/50'}`}><Icon size={20} className={i===2?'text-indigo-300':'text-gray-500'}/><h3 className="mt-3 text-sm font-semibold text-white">{name}</h3><p className="mt-2 text-xs leading-relaxed text-gray-400">{t(text)}</p></div>)}</div>
}

function TPEDemo() {
  const t = useT()
  const [limit,setLimit]=useState(1),[playing,setPlaying]=useState(false)
  useEffect(()=>{if(!playing)return;const id=window.setInterval(()=>setLimit(v=>v>=trials.length?1:v+1),700);return()=>clearInterval(id)},[playing])
  const visible=trials.slice(0,limit)
  const split=Math.max(1,Math.ceil(visible.length*.25))
  const good=[...visible].sort((a,b)=>b.score-a.score).slice(0,split)
  const center=good.reduce((s,t)=>s+Math.log10(t.lr),0)/good.length
  return <div>
    <div className="flex flex-wrap items-center gap-2"><button onClick={()=>setPlaying(v=>!v)} className="flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-medium text-white">{playing?<Pause size={13}/>:<Play size={13}/>} {playing?'Pause':t('Animer')}</button><button onClick={()=>{setPlaying(false);setLimit(1)}} className="rounded-lg border border-gray-700 p-2 text-gray-400"><RefreshCw size={13}/></button><span className="ml-auto text-xs text-gray-500">{t('Trials observés :')} {limit}/{trials.length}</span></div>
    <div className="mt-4 rounded-lg border border-gray-800 bg-gray-950/50 p-3"><div className="relative h-24"><div className="absolute left-2 right-2 top-12 h-1 rounded bg-gradient-to-r from-gray-800 via-indigo-800 to-gray-800"/>{visible.map(t2=>{const x=(Math.log10(t2.lr)+5)/4*96+2;return <div key={t2.n} title={`Trial #${t2.n} · lr=${t2.lr} · score=${t2.score}`} className={`absolute h-3 w-3 -translate-x-1/2 rounded-full border ${good.some(g=>g.n===t2.n)?'border-emerald-200 bg-emerald-400':'border-indigo-200 bg-indigo-500'}`} style={{left:`${x}%`,top:`${18+(t2.n%4)*13}px`}}/>})}<div className="absolute bottom-0 left-2 right-2 flex justify-between text-[10px] text-gray-600"><span>lr 10⁻⁵</span><span>{t('zone centrale des meilleurs observés')} ≈ 10<sup>{center.toFixed(2)}</sup></span><span>lr 10⁻¹</span></div></div></div>
    <input aria-label={t('Nombre de trials simulés')} className="mt-3 w-full accent-indigo-500" type="range" min={1} max={trials.length} value={limit} onChange={e=>{setPlaying(false);setLimit(Number(e.target.value))}}/>
    <div className="mt-3 grid gap-2 md:grid-cols-3 text-xs"><div className="rounded bg-gray-950/60 p-3"><b className="text-amber-300">1. Startup</b><p className="mt-1 text-gray-500">{t('Les premiers points explorent. Il n’y a pas encore assez d’observations pour une adaptation solide.')}</p></div><div className="rounded bg-gray-950/60 p-3"><b className="text-indigo-300">2. {t('Deux groupes')}</b><p className="mt-1 text-gray-500">{t('TPE sépare schématiquement les bons résultats observés du reste et estime des densités.')}</p></div><div className="rounded bg-gray-950/60 p-3"><b className="text-emerald-300">3. {t('Proposition')}</b><p className="mt-1 text-gray-500">{t('Il favorise des valeurs plausibles dans les zones prometteuses, avec une part d’exploration.')}</p></div></div>
    <p className="mt-3 rounded-lg border border-amber-900/50 bg-amber-950/15 p-3 text-xs text-amber-100/70"><b>{t('Important :')}</b> {t('cette animation est une illustration TPE simplifiée et déterministe, pas le journal interne d’un sampler Optuna. Elle montre une interprétation probabiliste, jamais une cause certaine pour un trial précis.')}</p>
  </div>
}

function SimulatedStudy() {
  const t = useT()
  const [limit,setLimit]=useState(1),[playing,setPlaying]=useState(false)
  useEffect(()=>{if(!playing)return;const id=window.setInterval(()=>setLimit(v=>v>=trials.length?(setPlaying(false),v):v+1),600);return()=>clearInterval(id)},[playing])
  const shown=trials.slice(0,limit)
  let best=-Infinity
  const history=shown.map(t=>{best=Math.max(best,t.score);return{...t,best}})
  const winner=[...shown].sort((a,b)=>b.score-a.score)[0]
  return <div>
    <div className="flex items-center gap-2"><button onClick={()=>setPlaying(v=>!v)} className="flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white">{playing?<Pause size={13}/>:<Play size={13}/>} {playing?'Pause':t('Lancer la simulation')}</button><button onClick={()=>{setPlaying(false);setLimit(1)}} className="rounded-lg border border-gray-700 p-2 text-gray-400"><RefreshCw size={13}/></button><span className="ml-auto font-mono text-xs text-gray-500">trial #{limit}</span></div>
    <ResponsiveContainer width="100%" height={230}><LineChart data={history}><CartesianGrid strokeDasharray="3 3" stroke="#1f2937"/><XAxis dataKey="n" tick={{fill:'#6b7280',fontSize:10}}/><YAxis domain={[.58,.78]} tick={{fill:'#6b7280',fontSize:10}}/><Tooltip contentStyle={{background:'#111827',border:'1px solid #374151',borderRadius:8,fontSize:11}}/><Line dataKey="score" stroke="#818cf8" dot={{r:3}} name={t('Objectif')}/><Line dataKey="best" type="stepAfter" stroke="#34d399" dot={false} strokeWidth={2} name={t('Meilleur jusque-là')}/></LineChart></ResponsiveContainer>
    <input className="w-full accent-emerald-500" type="range" min={1} max={trials.length} value={limit} onChange={e=>{setPlaying(false);setLimit(Number(e.target.value))}}/>
    <div className="mt-3 rounded-xl border border-emerald-800/50 bg-emerald-950/20 p-4"><div className="flex items-center gap-2 text-emerald-300"><Trophy size={16}/><b className="text-sm">{t('Meilleur observé à ce stade : trial #')}{winner.n}</b><span className="ml-auto font-mono">{winner.score.toFixed(3)}</span></div><p className="mt-2 font-mono text-xs text-gray-300">lr={winner.lr} · mosaic={winner.mosaic} · scale={winner.scale}</p><p className="mt-2 text-xs text-gray-500">{t('C’est un fait de la simulation : ce trial a le score maximal parmi ceux déjà affichés. Cela ne prouve pas que chaque paramètre pris isolément cause ce score.')}</p></div>
  </div>
}

export default function HPOLearnPage(){
  const t = useT()
  const trialExampleRows: Array<[string,string]> = [
    ['paramètres', 'lr=0.0019, mosaic=0.51, scale=0.46'],
    ['training', t('modèle entraîné sur le dataset déclaré')],
    ['objectif', 'mAP50 = 0.748'],
    ['état', 'COMPLETE'],
  ]
  const trialExampleText = `trial #12\n${trialExampleRows.map(([k,v]) => `  ${t(k).padEnd(11)}→ ${v}`).join('\n')}`
  return <div className="mx-auto max-w-6xl space-y-5 p-6 pb-16">
    <header className="rounded-2xl border border-indigo-800/50 bg-gradient-to-br from-indigo-950/60 via-gray-900 to-gray-950 p-6"><div className="flex items-center gap-2 text-indigo-300"><BookOpen size={18}/><span className="text-xs font-semibold uppercase tracking-[.2em]">{t('Comprendre HPO')}</span></div><h1 className="mt-3 text-2xl font-semibold text-white">{t('De l’espace de recherche au meilleur trial')}</h1><p className="mt-2 max-w-3xl text-sm leading-relaxed text-gray-400">{t('Une introduction interactive à l’optimisation d’hyperparamètres, à Optuna, au sampler TPE et au pruning — sans supposer que vous connaissez déjà le machine learning.')}</p></header>

    <Section eyebrow={t('1 · L’idée')} title={t('Qu’est-ce que l’optimisation d’hyperparamètres ?')}><p>{t('Un modèle possède des paramètres appris pendant le training, mais aussi des')} <b className="text-white">{t('hyperparamètres')}</b> {t('choisis avant ou autour du training : learning rate, augmentation mosaic, échelle, batch, etc. HPO organise plusieurs entraînements pour comparer automatiquement différentes configurations selon une métrique.')}</p><div className="mt-4 flex flex-wrap items-center gap-2 text-xs">{['Choisir une configuration','Entraîner','Mesurer','Comparer','Proposer la suivante'].map((x,i)=><div className="contents" key={x}><span className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-gray-200">{t(x)}</span>{i<4&&<ArrowRight size={13} className="text-gray-600"/>}</div>)}</div></Section>

    <Section eyebrow={t('2 · Les briques')} title={t('Dataset, objectif, direction, espace et trials')}><div className="grid gap-3 md:grid-cols-5"><Term icon={Database} name="Dataset">{t('Les données et leur split utilisés par chaque entraînement comparable.')}</Term><Term icon={Target} name={t('Objectif')}>{t('La métrique numérique qui classe les essais, par exemple mAP50.')}</Term><Term icon={Gauge} name={t('Direction')}>{t('Maximiser une mAP ; minimiser une loss ou une latence.')}</Term><Term icon={SlidersHorizontal} name={t('Espace de recherche')}>{t('Les paramètres autorisés, leurs types, bornes et distributions.')}</Term><Term icon={Sparkles} name="Trial">{t('Une configuration proposée, son exécution et son résultat.')}</Term></div></Section>

    <Section eyebrow={t('3 · Une unité de travail')} title={t('Qu’est-ce qu’un trial ?')}><p>{t('Un trial est')} <b className="text-white">{t('un essai complet et traçable')}</b> {t(': Optuna propose des valeurs, votre fonction objectif lance le training, puis renvoie une valeur numérique. `COMPLETE` signifie que cette valeur est exploitable ; `FAIL` signale une erreur ; `PRUNED` un arrêt algorithmique anticipé.')}</p><pre className="mt-4 overflow-x-auto rounded-lg bg-gray-950 p-4 text-xs leading-6 text-cyan-200">{trialExampleText}</pre></Section>

    <Section eyebrow={t('4 · Manipuler')} title={t('Exemple d’espace : lr, mosaic et scale')}><SearchSpaceExample/></Section>
    <Section eyebrow={t('5 · Trois stratégies')} title="Grid Search vs Random Search vs TPE"><StrategyComparison/></Section>

    <Section eyebrow={t('6–8 · Le cœur d’Optuna')} title="TPE = Tree-structured Parzen Estimator"><p className="mb-4"><b className="text-white">{t('Intuition d’abord :')}</b> {t('TPE regarde les configurations déjà essayées et leurs scores. Il distingue un groupe de résultats prometteurs du reste, estime où ces groupes sont denses, puis propose plus souvent des valeurs plausibles dans les régions prometteuses. Il continue néanmoins à explorer.')}</p><TPEDemo/><details className="mt-4 rounded-lg border border-gray-800 bg-gray-950/50 p-3"><summary className="cursor-pointer text-xs font-semibold text-gray-300">{t('Puis, une formulation un peu plus mathématique')}</summary><p className="mt-2 text-xs text-gray-500">{t('TPE modélise des densités de paramètres conditionnées par la qualité observée, souvent notées ℓ(x) pour le groupe prometteur et g(x) pour le reste. Le choix cherche des candidats au rapport favorable. L’implémentation réelle gère distributions, paramètres conditionnels et échantillonnage ; l’interface ne prétend pas reconstruire une décision interne exacte.')}</p></details></Section>

    <Section eyebrow={t('9–10 · Économiser le calcul')} title={t('Pruning : faut-il continuer ce trial ?')}><div className="grid gap-3 md:grid-cols-2"><div className="rounded-xl border border-indigo-800/50 bg-indigo-950/20 p-4"><BrainCircuit size={18} className="text-indigo-300"/><h3 className="mt-2 text-sm font-semibold text-white">TPE</h3><p className="mt-1 text-xs text-gray-400">{t('« Que devrions-nous essayer ensuite ? » Il propose la prochaine configuration.')}</p></div><div className="rounded-xl border border-violet-800/50 bg-violet-950/20 p-4"><Scissors size={18} className="text-violet-300"/><h3 className="mt-2 text-sm font-semibold text-white">Pruner</h3><p className="mt-1 text-xs text-gray-400">{t('« Faut-il continuer ce trial ? » Il utilise des métriques intermédiaires pour arrêter tôt, si le moteur les publie.')}</p></div></div><p className="mt-4 flex gap-2 rounded-lg border border-amber-900/50 bg-amber-950/15 p-3 text-xs text-amber-100/70"><CheckCircle2 size={15} className="shrink-0"/>{t('Une erreur dataset, CUDA ou modèle n’est jamais un pruning. Sans métriques intermédiaires et décision explicite du pruner, l’interface doit parler d’échec ou d’interruption.')}</p></Section>

    <Section eyebrow={t('Final · À vous de jouer')} title={t('Étude Optuna simulée : du trial #1 au gagnant')}><p className="mb-4">{t('Faites avancer l’étude. Les valeurs sont un jeu pédagogique fixe : les points montrent des faits simulés, pas une prédiction sur votre propre dataset.')}</p><SimulatedStudy/></Section>
  </div>
}
