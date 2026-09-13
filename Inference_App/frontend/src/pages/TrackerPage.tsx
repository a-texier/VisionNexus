import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  Play, Square, Circle, Move, Crosshair, Rocket, Package,
  FileBarChart, Activity, ChevronRight, Upload, FileText, FileArchive, FolderOpen,
} from 'lucide-react'
import {
  trackerAPI, streamUrl, infoUrl,
  type SchemaField, type SessionInfo, type TaskInfo,
} from '../api/client'

// ── Config form state (overrides sent to the tracker) ──────────────────────
type Overrides = Record<string, string | number | boolean>

export default function TrackerPage() {
  const { data: scenarios = [] } = useQuery({ queryKey: ['scenarios'], queryFn: trackerAPI.scenarios })
  const { data: schema } = useQuery({ queryKey: ['schema'], queryFn: trackerAPI.configSchema })
  const { data: sources } = useQuery({ queryKey: ['sources'], queryFn: trackerAPI.sources, refetchInterval: 10_000 })

  const [scenario, setScenario] = useState<string>('')
  const [mode, setMode] = useState<string>('interactive')
  const [overrides, setOverrides] = useState<Overrides>({})
  const [sid, setSid] = useState<string>('')
  const [session, setSession] = useState<SessionInfo | null>(null)

  const setOv = (k: string, v: string | number | boolean) =>
    setOverrides(o => ({ ...o, [k]: v }))

  // poll session status while active
  useEffect(() => {
    if (!sid) return
    const t = setInterval(async () => {
      try { setSession(await trackerAPI.status(sid)) } catch { /* ignore */ }
    }, 1500)
    return () => clearInterval(t)
  }, [sid])

  const running = session?.status === 'running' || session?.status === 'starting'

  async function start() {
    try {
      const r = await trackerAPI.start({ scenario: scenario || undefined, mode, overrides })
      setSid(r.session_id)
      setSession(null)
      toast.success(`Session ${r.session_id} — port ${r.stream_port}`)
    } catch (e) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(msg || 'Echec du demarrage')
    }
  }
  async function stop() { if (sid) { await trackerAPI.stop(sid); toast('Arret demande') } }

  return (
    <div className="grid grid-cols-[320px_1fr_340px] gap-4 p-4 max-w-[1700px] mx-auto">
      {/* ── Config panel ─────────────────────────────────────────── */}
      <div className="space-y-3">
        <Section icon={<ChevronRight size={14} />} title="Scenario (preset)">
          <select value={scenario} onChange={e => setScenario(e.target.value)}
            className="w-full bg-[#161b22] border border-[#30363d] rounded px-2 py-1.5 text-xs">
            <option value="">— config par defaut —</option>
            {scenarios.map(s => (
              <option key={s.id} value={s.id}>{s.id} · {s.tracker_mot}/{s.tracker_sot}</option>
            ))}
          </select>
          <label className="block mt-2 text-[11px] text-gray-400">Mode</label>
          <select value={mode} onChange={e => setMode(e.target.value)}
            className="w-full bg-[#161b22] border border-[#30363d] rounded px-2 py-1.5 text-xs">
            {['interactive', 'command', 'headless'].map(m => <option key={m}>{m}</option>)}
          </select>
          {mode === 'command' && (
            <CommandFilePicker value={String(overrides.clicks ?? '')} onPick={p => setOv('clicks', p)} />
          )}
        </Section>

        {schema?.schema.groups.map(g => (
          <Section key={g.title} title={g.title}>
            {g.fields.map(f => (
              <Field key={f.key} f={f} value={overrides[f.key]} onChange={v => setOv(f.key, v)}
                weights={f.key === 'weights_yolo' ? sources?.weights : undefined} />
            ))}
          </Section>
        ))}

        <div className="flex gap-2">
          {!running ? (
            <button onClick={start}
              className="flex-1 flex items-center justify-center gap-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded px-3 py-2 text-sm">
              <Play size={14} /> Lancer
            </button>
          ) : (
            <button onClick={stop}
              className="flex-1 flex items-center justify-center gap-1.5 bg-red-600 hover:bg-red-500 text-white rounded px-3 py-2 text-sm">
              <Square size={14} /> Arreter
            </button>
          )}
        </div>
      </div>

      {/* ── Live view ────────────────────────────────────────────── */}
      <LiveView sid={sid} session={session} running={!!running} mode={mode} />

      {/* ── Results + deploy ─────────────────────────────────────── */}
      <div className="space-y-3">
        <Results sid={sid} session={session} />
        <DeployPanel weights={sources?.weights ?? []} />
      </div>
    </div>
  )
}

// ── Command-file picker (headless mode command / rejeu cmd_send) ─────────────
function CommandFilePicker({ value, onPick }: { value: string; onPick: (path: string) => void }) {
  const { data: replays = [], refetch } = useQuery({ queryKey: ['replays'], queryFn: trackerAPI.replays })
  const fileRef = useRef<HTMLInputElement>(null)

  async function upload(f: File) {
    try {
      const r = await trackerAPI.replaysUpload(f)
      await refetch()
      onPick(r.path)
      toast.success(`${r.name} — ${r.lines} lignes`)
    } catch { toast.error('Echec de l\'upload') }
  }

  return (
    <div className="mt-2 border-t border-[#21262d] pt-2">
      <label className="flex items-center gap-1 text-[11px] text-gray-400 mb-1">
        <FileText size={11} /> Fichier de commandes (.txt)
      </label>
      <select value={value} onChange={e => onPick(e.target.value)}
        className="w-full bg-[#161b22] border border-[#30363d] rounded px-2 py-1 text-xs">
        <option value="">— choisir un rejeu —</option>
        {replays.map(r => <option key={r.path} value={r.path}>{r.name} ({r.lines} l.)</option>)}
      </select>
      <input ref={fileRef} type="file" accept=".txt" hidden
        onChange={e => { const f = e.target.files?.[0]; if (f) upload(f) }} />
      <button onClick={() => fileRef.current?.click()}
        className="mt-1.5 w-full flex items-center justify-center gap-1 text-[11px] py-1 border border-[#30363d] rounded bg-[#161b22] hover:bg-[#21262d]">
        <Upload size={11} /> Déposer un .txt (cmd_send)
      </button>
      <p className="mt-1 text-[10px] text-gray-600 leading-tight">
        Clic SOT : <code>frame_emit frame_click x y</code> · MOT : <code>frame_emit frame_real 0|1</code>
      </p>
    </div>
  )
}

// ── Live view with click-to-SOT canvas ──────────────────────────────────────
function LiveView({ sid, session, running, mode }:
  { sid: string; session: SessionInfo | null; running: boolean; mode: string }) {
  const imgRef = useRef<HTMLImageElement>(null)
  const dims = useRef<{ w: number; h: number }>({ w: 0, h: 0 })
  const interactive = running && mode === 'interactive'

  useEffect(() => {
    if (!sid || !running) return
    fetch(infoUrl(sid)).then(r => r.json()).then(d => { dims.current = { w: d.width, h: d.height } }).catch(() => {})
  }, [sid, running])

  function sendClick(e: React.MouseEvent, button: number) {
    if (!interactive || !imgRef.current) return
    const rect = imgRef.current.getBoundingClientRect()
    const { w, h } = dims.current
    if (!w || !h) return
    const x = Math.round((e.clientX - rect.left) * (w / rect.width))
    const y = Math.round((e.clientY - rect.top) * (h / rect.height))
    trackerAPI.click(sid, x, y, button).catch(() => {})
  }

  return (
    <div className="space-y-2">
      <div className="relative bg-black rounded-lg overflow-hidden border border-[#30363d] aspect-video flex items-center justify-center">
        {sid && running ? (
          <img ref={imgRef} src={streamUrl(sid)} alt="flux"
            className={interactive ? 'w-full h-full object-contain cursor-crosshair' : 'w-full h-full object-contain'}
            onMouseDown={e => sendClick(e, e.button === 2 ? 2 : e.button === 1 ? 1 : 0)}
            onContextMenu={e => { e.preventDefault(); sendClick(e, 2) }} />
        ) : (
          <div className="text-gray-600 text-sm flex flex-col items-center gap-2">
            <Crosshair size={28} />
            {session?.status === 'error'
              ? <span className="text-red-400 text-xs px-6 text-center">{session.error}</span>
              : <span>Aucun flux — lancez une session</span>}
          </div>
        )}
      </div>

      {/* controls */}
      <div className="flex items-center gap-2">
        <StatusPill status={session?.status} />
        {interactive && <>
          <Hint icon={<Crosshair size={12} />} text="clic G = cible 1" />
          <Hint icon={<Crosshair size={12} className="text-orange-400" />} text="clic D = cible 2" />
          <Hint icon={<Move size={12} />} text="clic molette = kill" />
          <button onClick={() => trackerAPI.key(sid, 'm')} className="ctl">M · MOT bg</button>
          <button onClick={() => trackerAPI.record(sid)} className="ctl flex items-center gap-1"><Circle size={11} className="text-red-500" /> Record</button>
        </>}
      </div>
      <style>{`.ctl{font-size:11px;padding:2px 8px;border:1px solid #30363d;border-radius:4px;background:#161b22}.ctl:hover{background:#21262d}`}</style>
    </div>
  )
}

function Results({ sid, session }: { sid: string; session: SessionInfo | null }) {
  const { data: art } = useQuery({
    queryKey: ['artifacts', sid, session?.status],
    queryFn: () => trackerAPI.artifacts(sid),
    enabled: !!sid && (session?.status === 'done' || session?.status === 'stopped'),
  })
  const bs = session?.benchmark_summary as Record<string, { MOTA?: number; IDF1?: number }> | undefined
  return (
    <Section icon={<Activity size={14} />} title="Resultats">
      {session?.benchmark_summary && Object.keys(session.benchmark_summary).length > 0 ? (
        <div className="text-[11px] space-y-0.5">
          {'fps_proc' in (session.benchmark_summary as object) &&
            <div>FPS proc : <b>{String((session.benchmark_summary as Record<string, unknown>).fps_proc)}</b></div>}
          {bs && ['mot', 'sot', 'global'].map(k => bs[k] && (
            <div key={k}>{k} : MOTA {bs[k].MOTA ?? '—'} · IDF1 {bs[k].IDF1 ?? '—'}</div>
          ))}
        </div>
      ) : <p className="text-[11px] text-gray-600">Les metriques apparaissent en fin de session.</p>}

      {art && (
        <div className="mt-2 space-y-1">
          {Object.entries(art.artifacts).filter(([, v]) => v).map(([k]) => (
            <a key={k} href={`/api/session/${sid}/artifact/${k}`} target="_blank" rel="noreferrer"
              className="flex items-center gap-1.5 text-[11px] text-cyan-400 hover:underline">
              <FileBarChart size={12} /> {k === 'profiling' ? 'profiling.html' : k === 'dashboard' ? 'metrics_dashboard.html' : 'benchmark.json'}
            </a>
          ))}
          {art.videos.map(v => (
            <div key={v} className="text-[11px] text-gray-400">🎬 {v}</div>
          ))}
        </div>
      )}
    </Section>
  )
}

function DeployPanel({ weights }: { weights: { name: string; path: string }[] }) {
  const [wp, setWp] = useState('')
  const [task, setTask] = useState<TaskInfo | null>(null)
  const [tid, setTid] = useState('')
  const [showPaths, setShowPaths] = useState(false)
  const { data: info } = useQuery({ queryKey: ['export-info'], queryFn: trackerAPI.exportInfo })

  useEffect(() => {
    if (!tid) return
    const t = setInterval(async () => {
      const i = await trackerAPI.task(tid)
      setTask(i)
      if (i.status !== 'running') clearInterval(t)
    }, 1500)
    return () => clearInterval(t)
  }, [tid])

  async function exportModel(fmt: string) {
    if (!wp) { toast.error('choisir des poids'); return }
    const r = await trackerAPI.exportModel({ weights_path: wp, fmt }); setTid(r.task_id); setTask(null)
    toast(`export ${fmt} → ${info?.model_export.dir ?? 'exports/'}`)
  }
  async function deploy(target: string) {
    const r = await trackerAPI.deployBuild({ target }); setTid(r.task_id); setTask(null); toast(r.note)
  }
  async function trackerZip() {
    const r = await trackerAPI.trackerZip(); setTid(r.task_id); setTask(null)
    toast(`ZIP tracker → ${r.output}`)
  }

  return (
    <Section icon={<Rocket size={14} />} title="Export & déploiement">
      <label className="block text-[11px] text-gray-400">Poids à exporter</label>
      <select value={wp} onChange={e => setWp(e.target.value)}
        className="w-full bg-[#161b22] border border-[#30363d] rounded px-2 py-1.5 text-xs mb-2">
        <option value="">—</option>
        {weights.map(w => <option key={w.path} value={w.path}>{w.name}</option>)}
      </select>
      <div className="flex gap-2 mb-2">
        <button onClick={() => exportModel('onnx')} className="ctl2">→ ONNX</button>
        <button onClick={() => exportModel('engine')} className="ctl2">→ TensorRT</button>
      </div>
      <div className="flex gap-2 mb-2">
        <button onClick={() => deploy('standalone')} className="ctl2 flex items-center gap-1"><Package size={12} /> Standalone</button>
        <button onClick={() => deploy('container')} className="ctl2 flex items-center gap-1"><Package size={12} /> Conteneur</button>
      </div>
      <button onClick={trackerZip} className="ctl2 w-full flex items-center justify-center gap-1 mb-1">
        <FileArchive size={12} /> ZIP autonome du tracker (rapide)
      </button>

      <button onClick={() => setShowPaths(v => !v)}
        className="mt-1 flex items-center gap-1 text-[10px] text-gray-500 hover:text-gray-300">
        <FolderOpen size={10} /> {showPaths ? 'masquer' : 'où vont les fichiers ?'}
      </button>
      {showPaths && info && (
        <div className="mt-1 space-y-1 text-[10px] text-gray-500 font-mono">
          <div>ONNX/TRT · ZIP → <span className="text-cyan-400 break-all">{info.model_export.dir}</span></div>
          <div>runs (vidéo/bench) → <span className="text-cyan-400 break-all">{info.runs_dir}</span></div>
          <div className="text-gray-600 font-sans">Cible : x86_64 + GPU NVIDIA recent (Ubuntu 22.04, via WSL).</div>
        </div>
      )}

      {task && (
        <div className="mt-2">
          <div className="text-[11px]">tâche <b>{task.status}</b>{task.artifact && <> · <a className="text-cyan-400" href={`/api/tasks/${task.id}/download`}>télécharger</a></>}</div>
          <pre className="mt-1 max-h-32 overflow-auto bg-black/60 text-[10px] text-gray-400 p-2 rounded">{task.log.slice(-20).join('\n')}</pre>
        </div>
      )}
      <style>{`.ctl2{flex:1;font-size:11px;padding:4px 6px;border:1px solid #30363d;border-radius:4px;background:#161b22}.ctl2:hover{background:#21262d}`}</style>
    </Section>
  )
}

// ── small UI helpers ────────────────────────────────────────────────────────
function Section({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-[#0d1117] border border-[#30363d] rounded-lg p-3">
      <div className="flex items-center gap-1.5 mb-2 text-xs font-semibold text-gray-300">{icon}{title}</div>
      {children}
    </div>
  )
}

function Field({ f, value, onChange, weights }:
  { f: SchemaField; value: unknown; onChange: (v: string | number | boolean) => void; weights?: { name: string; path: string }[] }) {
  const label = <label className="block text-[11px] text-gray-400 mt-1.5" title={f.help}>{f.key}</label>
  if (weights) {
    return <>{label}<select value={String(value ?? '')} onChange={e => onChange(e.target.value)}
      className="w-full bg-[#161b22] border border-[#30363d] rounded px-2 py-1 text-xs">
      <option value="">— (Dummy) —</option>
      {weights.map(w => <option key={w.path} value={w.path}>{w.name}</option>)}
    </select></>
  }
  if (f.type === 'enum') {
    return <>{label}<select value={String(value ?? '')} onChange={e => onChange(e.target.value)}
      className="w-full bg-[#161b22] border border-[#30363d] rounded px-2 py-1 text-xs">
      {f.choices?.map(c => <option key={String(c)} value={String(c)}>{String(c) || '—'}</option>)}
    </select></>
  }
  if (f.type === 'bool') {
    return <label className="flex items-center gap-2 mt-1.5 text-[11px] text-gray-400">
      <input type="checkbox" checked={!!value} onChange={e => onChange(e.target.checked)} /> {f.key}
    </label>
  }
  return <>{label}<input value={String(value ?? '')} onChange={e => onChange(f.type === 'number' ? Number(e.target.value) : e.target.value)}
    placeholder={f.help} className="w-full bg-[#161b22] border border-[#30363d] rounded px-2 py-1 text-xs" /></>
}

function StatusPill({ status }: { status?: string }) {
  const map: Record<string, string> = {
    running: 'bg-blue-900/40 text-blue-300', starting: 'bg-blue-900/40 text-blue-300',
    done: 'bg-emerald-900/40 text-emerald-300', stopped: 'bg-gray-800 text-gray-400',
    error: 'bg-red-900/40 text-red-300',
  }
  return <span className={`text-[11px] px-2 py-0.5 rounded ${map[status ?? ''] ?? 'bg-gray-800 text-gray-500'}`}>{status ?? 'idle'}</span>
}

function Hint({ icon, text }: { icon: React.ReactNode; text: string }) {
  return <span className="flex items-center gap-1 text-[11px] text-gray-500">{icon}{text}</span>
}
