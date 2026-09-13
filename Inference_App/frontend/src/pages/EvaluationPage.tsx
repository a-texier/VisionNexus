import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  Play, Crosshair, ScanSearch, Activity, FileBarChart, Image as ImageIcon, Database,
} from 'lucide-react'
import { evalAPI, artifactUrl, type EvalInfo, type Weight } from '../api/client'

type Kind = 'detection' | 'tracker'

export default function EvaluationPage() {
  const { data: sources } = useQuery({ queryKey: ['sources'], queryFn: evalAPI.sources, refetchInterval: 15_000 })
  const [kind, setKind] = useState<Kind>('tracker')
  const [eid, setEid] = useState('')
  const [ev, setEv] = useState<EvalInfo | null>(null)

  // detection form
  const [modelD, setModelD] = useState('')
  const [dataYaml, setDataYaml] = useState('')
  // tracker form
  const [modelT, setModelT] = useState('')
  const [seq, setSeq] = useState('')
  const [gt, setGt] = useState('')
  const [trackerMot, setTrackerMot] = useState('botsort')
  const [trackerSot, setTrackerSot] = useState('tracking_tophat')
  const [startFrame, setStartFrame] = useState('')
  const [stopFrame, setStopFrame] = useState('')

  useEffect(() => {
    if (!eid) return
    const t = setInterval(async () => {
      try {
        const s = await evalAPI.status(eid)
        setEv(s)
        if (s.status !== 'running') clearInterval(t)
      } catch { /* ignore */ }
    }, 2000)
    return () => clearInterval(t)
  }, [eid])

  const running = ev?.status === 'running'
  const weights = sources?.weights ?? []

  async function launch() {
    try {
      if (kind === 'detection') {
        if (!modelD || !dataYaml) { toast.error('modèle + data.yaml requis'); return }
        const r = await evalAPI.startDetection({ model_path: modelD, data_yaml: dataYaml })
        setEid(r.eval_id); setEv(null); toast('Évaluation détection lancée')
      } else {
        if (!seq) { toast.error('séquence requise'); return }
        const overrides: Record<string, unknown> = { tracker_mot: trackerMot, tracker_sot: trackerSot }
        if (startFrame) overrides.start_frame = Number(startFrame)
        if (stopFrame) overrides.stop_frame = Number(stopFrame)
        const r = await evalAPI.startTracker({ model_path: modelT, sequence_dir: seq, annotation_file: gt || undefined, overrides })
        setEid(r.eval_id); setEv(null); toast('Évaluation tracker lancée')
      }
    } catch (e) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(msg || 'Échec du lancement')
    }
  }

  return (
    <div className="grid grid-cols-[380px_1fr] gap-4 p-4 max-w-[1400px] mx-auto">
      {/* ── Config ─────────────────────────────────────────── */}
      <div className="space-y-3">
        <Section title="Type d'évaluation">
          <div className="flex gap-2">
            <KindBtn active={kind === 'tracker'} onClick={() => setKind('tracker')} icon={<Crosshair size={13} />} label="Tracker (MOT/SOT)" />
            <KindBtn active={kind === 'detection'} onClick={() => setKind('detection')} icon={<ScanSearch size={13} />} label="Détection (YOLO)" />
          </div>
        </Section>

        {kind === 'detection' ? (
          <Section title="Détection — model.val()" icon={<ScanSearch size={14} />}>
            <WeightSelect label="Modèle .pt" value={modelD} onChange={setModelD} weights={weights} />
            <Field label="data.yaml (val split)" value={dataYaml} onChange={setDataYaml}
              placeholder="chemin data.yaml" list={sources?.data_yamls?.map(d => d.path)} />
            <p className="text-[10px] text-gray-600 mt-1">mAP50 / mAP50-95 / P / R + matrice de confusion, courbes PR.</p>
          </Section>
        ) : (
          <Section title="Tracker — MOTA / IDF1" icon={<Crosshair size={14} />}>
            <WeightSelect label="Modèle YOLO (vide = Dummy)" value={modelT} onChange={setModelT} weights={weights} allowEmpty />
            <Field label="Séquence (dossier images / vidéo / format optionnel)" value={seq} onChange={setSeq} placeholder="chemin de la séquence" />
            <Field label="Vérité terrain .ver / YOLO (MOTA/IDF1)" value={gt} onChange={setGt} placeholder="chemin GT (optionnel)" />
            <div className="grid grid-cols-2 gap-2">
              <Enum label="tracker_mot" value={trackerMot} onChange={setTrackerMot}
                options={['custom_kalman', 'bytetrack', 'botsort', 'boosttrack', 'none']} />
              <Enum label="tracker_sot" value={trackerSot} onChange={setTrackerSot}
                options={['dummy', 'csrt', 'tracking_tophat', 'dimp', 'ostrack', 'sam2']} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Zone : frame début" value={startFrame} onChange={setStartFrame} placeholder="ex 230" />
              <Field label="Zone : frame fin" value={stopFrame} onChange={setStopFrame} placeholder="ex 300" />
            </div>
            <p className="text-[10px] text-gray-600 mt-1">Fenêtre = « retest sur la zone » (vide = toute la séquence, plafonnée par les réglages).</p>
          </Section>
        )}

        <button onClick={launch} disabled={running}
          className="w-full flex items-center justify-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded px-3 py-2 text-sm">
          <Play size={14} /> {running ? 'Évaluation en cours…' : 'Lancer l\'évaluation'}
        </button>
      </div>

      {/* ── Résultats ──────────────────────────────────────── */}
      <Results ev={ev} eid={eid} />
    </div>
  )
}

function Results({ ev, eid }: { ev: EvalInfo | null; eid: string }) {
  const { data: art } = useQuery({
    queryKey: ['eval-artifacts', eid, ev?.status],
    queryFn: () => evalAPI.artifacts(eid),
    enabled: !!eid && ev?.status === 'done',
  })

  if (!eid) return (
    <Section title="Résultats" icon={<Activity size={14} />}>
      <div className="h-64 flex flex-col items-center justify-center text-gray-600 gap-2">
        <Database size={28} /><span className="text-sm">Lancez une évaluation</span>
      </div>
    </Section>
  )

  const m = ev?.metrics ?? {}
  const entries = Object.entries(m)
  return (
    <div className="space-y-3">
      <Section title="Résultats" icon={<Activity size={14} />}>
        <div className="flex items-center gap-2 mb-2">
          <StatusPill status={ev?.status} />
          {ev?.mlflow_run_id && (
            <span className="text-[10px] text-gray-500 font-mono">MLflow run : {ev.mlflow_run_id.slice(0, 12)}…</span>
          )}
        </div>
        {ev?.status === 'error' && <p className="text-xs text-red-400">{ev.error}</p>}
        {ev?.status === 'running' && <p className="text-xs text-gray-500">Évaluation en cours…</p>}
        {entries.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mt-1">
            {entries.map(([k, v]) => <Metric key={k} name={k} value={v} />)}
          </div>
        )}
      </Section>

      {art && (art.plots.length > 0 || art.benchmark) && (
        <Section title="Artefacts" icon={<FileBarChart size={14} />}>
          {art.benchmark && (
            <a href={artifactUrl(eid, 'benchmark.json')} target="_blank" rel="noreferrer"
              className="flex items-center gap-1.5 text-[11px] text-emerald-400 hover:underline mb-2">
              <FileBarChart size={12} /> benchmark.json
            </a>
          )}
          {art.plots.length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              {art.plots.map(p => (
                <a key={p} href={artifactUrl(eid, p)} target="_blank" rel="noreferrer" className="block group">
                  <img src={artifactUrl(eid, p)} alt={p}
                    className="w-full rounded border border-[#30363d] bg-white/5 group-hover:border-emerald-600" />
                  <span className="flex items-center gap-1 text-[10px] text-gray-500 mt-0.5"><ImageIcon size={9} /> {p}</span>
                </a>
              ))}
            </div>
          )}
        </Section>
      )}
    </div>
  )
}

// ── UI helpers ──────────────────────────────────────────────────────────────
function Metric({ name, value }: { name: string; value: number }) {
  const pct = ['mota', 'idf1', 'mot_mota', 'mot_idf1', 'sot_mota', 'sot_idf1'].includes(name)
  const disp = Number.isInteger(value) ? value : value.toFixed(pct ? 4 : 2)
  return (
    <div className="bg-[#161b22] border border-[#30363d] rounded-lg px-2.5 py-1.5">
      <div className="text-[10px] text-gray-500 font-mono truncate" title={name}>{name}</div>
      <div className="text-sm font-semibold text-emerald-300">{disp}</div>
    </div>
  )
}
function Section({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-[#0d1117] border border-[#30363d] rounded-lg p-3">
      <div className="flex items-center gap-1.5 mb-2 text-xs font-semibold text-gray-300">{icon}{title}</div>
      {children}
    </div>
  )
}
function KindBtn({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button onClick={onClick}
      className={`flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded text-[11px] border ${active
        ? 'bg-emerald-900/30 text-emerald-300 border-emerald-800/40'
        : 'text-gray-400 border-[#30363d] hover:bg-[#21262d]'}`}>{icon}{label}</button>
  )
}
function WeightSelect({ label, value, onChange, weights, allowEmpty }:
  { label: string; value: string; onChange: (v: string) => void; weights: Weight[]; allowEmpty?: boolean }) {
  return (
    <>
      <label className="block text-[11px] text-gray-400 mt-1">{label}</label>
      <select value={value} onChange={e => onChange(e.target.value)}
        className="w-full bg-[#161b22] border border-[#30363d] rounded px-2 py-1 text-xs">
        <option value="">{allowEmpty ? '— (Dummy) —' : '—'}</option>
        {weights.map(w => <option key={w.path} value={w.path}>{w.name} · {w.source}</option>)}
      </select>
    </>
  )
}
function Field({ label, value, onChange, placeholder, list }:
  { label: string; value: string; onChange: (v: string) => void; placeholder?: string; list?: string[] }) {
  const id = `dl_${label.replace(/\W/g, '')}`
  return (
    <>
      <label className="block text-[11px] text-gray-400 mt-1.5">{label}</label>
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} list={list ? id : undefined}
        className="w-full bg-[#161b22] border border-[#30363d] rounded px-2 py-1 text-xs" />
      {list && <datalist id={id}>{list.map(o => <option key={o} value={o} />)}</datalist>}
    </>
  )
}
function Enum({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <div>
      <label className="block text-[11px] text-gray-400 mt-1.5">{label}</label>
      <select value={value} onChange={e => onChange(e.target.value)}
        className="w-full bg-[#161b22] border border-[#30363d] rounded px-2 py-1 text-xs">
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  )
}
function StatusPill({ status }: { status?: string }) {
  const map: Record<string, string> = {
    running: 'bg-blue-900/40 text-blue-300', done: 'bg-emerald-900/40 text-emerald-300',
    error: 'bg-red-900/40 text-red-300',
  }
  return <span className={`text-[11px] px-2 py-0.5 rounded ${map[status ?? ''] ?? 'bg-gray-800 text-gray-500'}`}>{status ?? 'idle'}</span>
}
