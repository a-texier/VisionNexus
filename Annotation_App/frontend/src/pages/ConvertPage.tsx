// ============================================================
// pages/ConvertPage.tsx
// Page utilitaire « Convert » (S10) : conversions rapides d'images
// et d'annotations, indépendantes des projets.
//   - .ver ↔ YOLO         (synchrone)
// Tous les chemins sont des chemins SERVEUR (l'app tourne côté serveur).
// ============================================================

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { ArrowLeft, Wand2, FileText, Loader2, ArrowRight } from 'lucide-react'
import { useT } from '../i18n/useLang'

async function postJson(url: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as { detail?: string })?.detail ?? `HTTP ${res.status}`)
  return data as Record<string, unknown>
}

function Card({ icon, title, desc, children }: { icon: React.ReactNode; title: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="bg-slate-800/70 border border-slate-700 rounded-xl p-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-blue-400">{icon}</span>
        <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
      </div>
      <p className="text-xs text-slate-500">{desc}</p>
      {children}
    </div>
  )
}

function TextInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <input
      type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
      className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-1.5 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500"
    />
  )
}

function RunButton({ onClick, busy, label }: { onClick: () => void; busy: boolean; label: string }) {
  return (
    <button onClick={onClick} disabled={busy}
      className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs rounded-lg transition-colors">
      {busy ? <Loader2 size={13} className="animate-spin" /> : <ArrowRight size={13} />}
      {label}
    </button>
  )
}

export function ConvertPage() {
  const navigate = useNavigate()
  const t = useT()

  // .ver → YOLO
  const [verPath, setVerPath] = useState('')
  const [verOut, setVerOut] = useState('')
  const [verW, setVerW] = useState(1920)
  const [verH, setVerH] = useState(1080)
  const [verBusy, setVerBusy] = useState(false)

  // YOLO → .ver
  const [yoloDir, setYoloDir] = useState('')
  const [yoloOut, setYoloOut] = useState('')
  const [yoloW, setYoloW] = useState(1920)
  const [yoloH, setYoloH] = useState(1080)
  const [yoloBusy, setYoloBusy] = useState(false)

  const runVerToYolo = async () => {
    if (!verPath.trim() || !verOut.trim()) return toast.error(t('Chemin .ver et dossier de sortie requis'))
    setVerBusy(true)
    try {
      const r = await postJson('/api/convert/ver-to-yolo', { ver_path: verPath.trim(), out_dir: verOut.trim(), width: verW, height: verH })
      toast.success(`${t('YOLO écrit')} : ${r.frames} frames, ${r.classes} ${t('classes')}`)
    } catch (e) { toast.error(`${t('Erreur')} : ${e instanceof Error ? e.message : e}`) }
    finally { setVerBusy(false) }
  }

  const runYoloToVer = async () => {
    if (!yoloDir.trim() || !yoloOut.trim()) return toast.error(t('Dossier YOLO et fichier .ver de sortie requis'))
    setYoloBusy(true)
    try {
      const r = await postJson('/api/convert/yolo-to-ver', { yolo_dir: yoloDir.trim(), out_path: yoloOut.trim(), width: yoloW, height: yoloH })
      toast.success(`${t('.ver écrit')} : ${r.boxes} ${t('boîtes')}`)
    } catch (e) { toast.error(`${t('Erreur')} : ${e instanceof Error ? e.message : e}`) }
    finally { setYoloBusy(false) }
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-200">
      <div className="max-w-4xl mx-auto p-6 space-y-6">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/')} className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white">
            <ArrowLeft size={18} />
          </button>
          <Wand2 size={20} className="text-blue-400" />
          <h1 className="text-xl font-bold">{t('Convert — conversions rapides')}</h1>
        </div>
        <p className="text-xs text-slate-500">
          {t('Utilitaire indépendant des projets. Tous les chemins sont des')} <strong>{t('chemins serveur')}</strong>.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card icon={<FileText size={16} />} title=".ver → YOLO"
            desc={t('Convertit un .ver (pixels) en dossier YOLO normalisé. La résolution image est requise (pixels → [0,1]).')}>
            <TextInput value={verPath} onChange={setVerPath} placeholder={t('Chemin du fichier .ver')} />
            <TextInput value={verOut} onChange={setVerOut} placeholder={t('Dossier YOLO de sortie')} />
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500">W×H</span>
              <input type="number" value={verW} onChange={(e) => setVerW(+e.target.value)} className="w-20 bg-slate-900 border border-slate-600 rounded px-2 py-1 text-xs text-center" />
              <input type="number" value={verH} onChange={(e) => setVerH(+e.target.value)} className="w-20 bg-slate-900 border border-slate-600 rounded px-2 py-1 text-xs text-center" />
              <RunButton onClick={runVerToYolo} busy={verBusy} label={t('Convertir')} />
            </div>
          </Card>

          <Card icon={<FileText size={16} />} title="YOLO → .ver"
            desc={t("Convertit un dossier YOLO en .ver. YOLO n'a pas de sous-classe ni de track : classe = sous-classe = sous-sous-classe, track_id = -1.")}>
            <TextInput value={yoloDir} onChange={setYoloDir} placeholder={t('Dossier YOLO (.txt)')} />
            <TextInput value={yoloOut} onChange={setYoloOut} placeholder={t('Fichier .ver de sortie')} />
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500">W×H</span>
              <input type="number" value={yoloW} onChange={(e) => setYoloW(+e.target.value)} className="w-20 bg-slate-900 border border-slate-600 rounded px-2 py-1 text-xs text-center" />
              <input type="number" value={yoloH} onChange={(e) => setYoloH(+e.target.value)} className="w-20 bg-slate-900 border border-slate-600 rounded px-2 py-1 text-xs text-center" />
              <RunButton onClick={runYoloToVer} busy={yoloBusy} label={t('Convertir')} />
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
