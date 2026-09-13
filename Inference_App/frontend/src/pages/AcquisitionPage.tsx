import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Radio, Play, Square, FolderInput, Images, ArrowRight } from 'lucide-react'
import { acqAPI, type AcqInfo } from '../api/client'

// MODE FREE : capture un flux ou une séquence -> dataset d'images à annoter.
export default function AcquisitionPage() {
  const { data: datasets = [], refetch: refetchDs } = useQuery({
    queryKey: ['acq-datasets'], queryFn: acqAPI.datasets, refetchInterval: 5000 })

  const [source, setSource] = useState('')
  const [name, setName] = useState('')
  const [maxFrames, setMaxFrames] = useState('200')
  const [every, setEvery] = useState('1')
  const [camera, setCamera] = useState('')
  const [aid, setAid] = useState('')
  const [acq, setAcq] = useState<AcqInfo | null>(null)
  const timer = useRef<number | null>(null)

  useEffect(() => {
    if (!aid) return
    const t = window.setInterval(async () => {
      try {
        const s = await acqAPI.status(aid)
        setAcq(s)
        if (s.status !== 'running') { window.clearInterval(t); refetchDs() }
      } catch { /* ignore */ }
    }, 1500)
    timer.current = t
    return () => window.clearInterval(t)
  }, [aid, refetchDs])

  const running = acq?.status === 'running'

  async function launch() {
    if (!source) { toast.error('source (flux / séquence / vidéo) requise'); return }
    try {
      const r = await acqAPI.start({
        source, name: name || undefined, max_frames: Number(maxFrames), every: Number(every),
        camera_name: camera || undefined,
      })
      setAid(r.acq_id); setAcq(null); toast(`Acquisition « ${r.name} » lancée`)
    } catch (e) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(msg || 'Échec')
    }
  }
  async function stop() { if (aid) { await acqAPI.stop(aid); toast('Arrêt demandé') } }

  return (
    <div className="grid grid-cols-[400px_1fr] gap-4 p-4 max-w-[1400px] mx-auto">
      <div className="space-y-3">
        <Section icon={<Radio size={14} />} title="Capture d'un flux → dataset (mode FREE)">
          <p className="text-[11px] text-gray-500 mb-2">
            Sauve les images brutes d'un flux dans <code>acquisitions/&lt;nom&gt;/</code> —
            un dataset prêt à importer dans Dataset Explorer / Annotation pour le fine-tuning.
          </p>
          <Field label="Source (flux / séquence)" value={source} onChange={setSource}
            placeholder="http://host/stream · tcp · vidéo · dossier · format optionnel" />
          <div className="grid grid-cols-2 gap-2">
            <Field label="Nom du dataset" value={name} onChange={setName} placeholder="auto (horodaté)" />
            <Enum label="camera_name" value={camera} onChange={setCamera} options={['', 'multi_csv', 'single_csv']} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Nb images max (0 = flux)" value={maxFrames} onChange={setMaxFrames} placeholder="200" />
            <Field label="1 image sur N" value={every} onChange={setEvery} placeholder="1" />
          </div>
          {!running ? (
            <button onClick={launch}
              className="w-full mt-2 flex items-center justify-center gap-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded px-3 py-2 text-sm">
              <Play size={14} /> Capturer
            </button>
          ) : (
            <button onClick={stop}
              className="w-full mt-2 flex items-center justify-center gap-1.5 bg-red-600 hover:bg-red-500 text-white rounded px-3 py-2 text-sm">
              <Square size={14} /> Arrêter
            </button>
          )}
          {acq && (
            <div className="mt-2 text-[11px]">
              <StatusPill status={acq.status} /> <span className="ml-1">{acq.n_saved} image{acq.n_saved > 1 ? 's' : ''} sauvée{acq.n_saved > 1 ? 's' : ''}</span>
              {acq.error && <p className="text-red-400 mt-1">{acq.error}</p>}
              {acq.status === 'done' && <p className="text-gray-500 mt-1 break-all">→ {acq.out_dir}</p>}
            </div>
          )}
        </Section>
      </div>

      <Section icon={<Images size={14} />} title="Datasets capturés">
        {datasets.length === 0 ? (
          <div className="h-48 flex flex-col items-center justify-center text-gray-600 gap-2">
            <FolderInput size={26} /><span className="text-sm">Aucun dataset — lancez une capture</span>
          </div>
        ) : (
          <div className="space-y-1.5">
            {datasets.map(d => (
              <div key={d.path} className="bg-[#161b22] border border-[#30363d] rounded-lg px-3 py-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-200 font-medium">{d.name}</span>
                  <span className="text-[11px] text-cyan-300">{d.n_images} images</span>
                </div>
                <div className="flex items-center gap-1 text-[10px] text-gray-500 mt-0.5">
                  <span className="font-mono break-all">{d.path}</span>
                </div>
                <div className="flex items-center gap-1 text-[10px] text-emerald-400/80 mt-1">
                  <ArrowRight size={10} /> importable dans Dataset Explorer / Annotation (chemin serveur)
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>
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
function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <>
      <label className="block text-[11px] text-gray-400 mt-1.5">{label}</label>
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="w-full bg-[#161b22] border border-[#30363d] rounded px-2 py-1 text-xs" />
    </>
  )
}
function Enum({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <div>
      <label className="block text-[11px] text-gray-400 mt-1.5">{label}</label>
      <select value={value} onChange={e => onChange(e.target.value)}
        className="w-full bg-[#161b22] border border-[#30363d] rounded px-2 py-1 text-xs">
        {options.map(o => <option key={o} value={o}>{o || '—'}</option>)}
      </select>
    </div>
  )
}
function StatusPill({ status }: { status?: string }) {
  const map: Record<string, string> = {
    running: 'bg-blue-900/40 text-blue-300', done: 'bg-emerald-900/40 text-emerald-300',
    error: 'bg-red-900/40 text-red-300', stopped: 'bg-gray-800 text-gray-400',
  }
  return <span className={`text-[11px] px-2 py-0.5 rounded ${map[status ?? ''] ?? 'bg-gray-800 text-gray-500'}`}>{status ?? 'idle'}</span>
}
