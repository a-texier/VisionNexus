import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { X, Save, FolderOpen } from 'lucide-react'
import { trackerAPI, type AppSettings } from '../api/client'

export default function SettingsModal({ onClose }: { onClose: () => void }) {
  const { data, refetch } = useQuery({ queryKey: ['settings'], queryFn: trackerAPI.getSettings })
  const [s, setS] = useState<AppSettings | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => { if (data) setS(data.settings) }, [data])

  const set = <K extends keyof AppSettings>(grp: K, key: keyof AppSettings[K], val: unknown) =>
    setS(prev => prev ? { ...prev, [grp]: { ...prev[grp], [key]: val } } : prev)

  async function save() {
    if (!s) return
    setSaving(true)
    try { await trackerAPI.putSettings(s as unknown as Record<string, unknown>); await refetch(); toast.success('Réglages enregistrés') }
    catch { toast.error('Échec de l\'enregistrement') }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="bg-[#0d1117] border border-[#30363d] rounded-xl shadow-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-[#30363d] sticky top-0 bg-[#0d1117]">
          <h2 className="text-sm font-semibold text-gray-100">Réglages</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white"><X size={16} /></button>
        </div>

        {!s ? <p className="p-5 text-sm text-gray-500">Chargement…</p> : (
          <div className="p-5 space-y-5">
            <Group title="Métriques">
              <Check label="Calculer MOTA/IDF1 (si vérité terrain fournie)"
                checked={s.metrics.compute_metrics} onChange={v => set('metrics', 'compute_metrics', v)} />
              <Num label="Seuil IoU pred↔GT (IR minuscule → 0.1)" step={0.05} min={0} max={1}
                value={s.metrics.iou_threshold} onChange={v => set('metrics', 'iou_threshold', v)} />
              <Txt label="Vérité terrain par défaut (.ver / YOLO, optionnel)"
                value={s.metrics.default_annotation_file} onChange={v => set('metrics', 'default_annotation_file', v)} />
            </Group>

            <Group title="Export & déploiement">
              <Num label="Taille d'entrée export (imgsz ONNX/TensorRT)" step={32} min={64}
                value={s.export.onnx_imgsz} onChange={v => set('export', 'onnx_imgsz', v)} />
              <Sel label="Cible de déploiement par défaut" value={s.export.default_deploy_target}
                options={['standalone', 'container']} onChange={v => set('export', 'default_deploy_target', v)} />
              <Sel label="Builder TensorRT" value={s.export.trt_builder}
                options={['python', 'trtexec']} onChange={v => set('export', 'trt_builder', v)} />
            </Group>

            <Group title="Rendu">
              <Check label="Rendu léger (bboxes seules, ultra-rapide)"
                checked={s.render.light_render} onChange={v => set('render', 'light_render', v)} />
              <Num label="Trace de trajectoire (frames, 0 = off)" step={1} min={0}
                value={s.render.trail} onChange={v => set('render', 'trail', v)} />
              <Num label="Qualité JPEG du flux MJPEG" step={5} min={10} max={100}
                value={s.render.stream_quality} onChange={v => set('render', 'stream_quality', v)} />
            </Group>

            <Group title="Chemins réseau">
              <Txt label="Hôte du partage (nom DNS ou IP)"
                value={s.paths.native_share_host} onChange={v => set('paths', 'native_share_host', v)} />
            </Group>

            {data && (
              <div className="text-[11px] text-gray-500 space-y-1 border-t border-[#21262d] pt-3">
                <div className="flex items-center gap-1.5">
                  <FolderOpen size={11} /> Fichier de réglages :
                  <code className="text-gray-400 break-all">{data.settings_file}</code>
                </div>
                {Object.entries(data.paths).map(([k, v]) => (
                  <div key={k} className="font-mono break-all"><span className="text-gray-600">{k}</span> = {v}</div>
                ))}
              </div>
            )}

            <div className="flex justify-end">
              <button onClick={save} disabled={saving}
                className="flex items-center gap-1.5 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white rounded px-4 py-2 text-sm">
                <Save size={14} /> {saving ? 'Enregistrement…' : 'Enregistrer'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-semibold text-gray-300 mb-2">{title}</div>
      <div className="space-y-2">{children}</div>
    </div>
  )
}
function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return <label className="flex items-center gap-2 text-[12px] text-gray-300">
    <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} /> {label}
  </label>
}
function Num({ label, value, onChange, step, min, max }:
  { label: string; value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number }) {
  return <label className="block text-[12px] text-gray-400">{label}
    <input type="number" value={value} step={step} min={min} max={max}
      onChange={e => onChange(Number(e.target.value))}
      className="w-full mt-1 bg-[#161b22] border border-[#30363d] rounded px-2 py-1 text-xs text-gray-200" />
  </label>
}
function Txt({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return <label className="block text-[12px] text-gray-400">{label}
    <input value={value} onChange={e => onChange(e.target.value)}
      className="w-full mt-1 bg-[#161b22] border border-[#30363d] rounded px-2 py-1 text-xs text-gray-200" />
  </label>
}
function Sel({ label, value, options, onChange }:
  { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return <label className="block text-[12px] text-gray-400">{label}
    <select value={value} onChange={e => onChange(e.target.value)}
      className="w-full mt-1 bg-[#161b22] border border-[#30363d] rounded px-2 py-1 text-xs text-gray-200">
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  </label>
}
