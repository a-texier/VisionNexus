// ============================================================
// components/modals/SettingsModal.tsx
// Panneau de paramètres utilisateur : interface, import, algos, export.
// Paramètres chargés depuis le backend (workspace/user_settings.json).
// ============================================================

import React, { useEffect, useState } from 'react'
import { X, RotateCcw, Save, ChevronDown, ChevronRight, Monitor, Upload, Cpu, Download, HardDrive, Trash2, RefreshCw } from 'lucide-react'
import { settingsAPI, storageAPI } from '../../services/api'
import type { StorageStats } from '../../services/api'
import type { UserSettings } from '../../types/api'
import { useT } from '../../i18n/useLang'

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
}

type SectionKey = 'interface' | 'import' | 'algorithms' | 'export' | 'storage'

const SECTION_ICONS: Record<SectionKey, React.ReactNode> = {
  interface: <Monitor size={13} className="text-blue-400" />,
  import: <Upload size={13} className="text-green-400" />,
  algorithms: <Cpu size={13} className="text-purple-400" />,
  export: <Download size={13} className="text-cyan-400" />,
  storage: <HardDrive size={13} className="text-orange-400" />,
}

// ---- Sous-composant : rangée paramètre ----

interface ParamRowProps {
  label: string
  hint?: string
  children: React.ReactNode
}
const ParamRow: React.FC<ParamRowProps> = ({ label, hint, children }) => (
  <div className="flex items-center justify-between gap-4 py-2 border-b border-slate-700/50 last:border-0">
    <div className="min-w-0 flex-1">
      <span className="text-xs text-slate-300">{label}</span>
      {hint && <p className="text-xs text-slate-600 mt-0.5">{hint}</p>}
    </div>
    <div className="flex-shrink-0 w-36">{children}</div>
  </div>
)

// ---- Sous-composant : section pliable ----

interface SectionProps {
  title: string
  id: SectionKey
  open: boolean
  onToggle: (id: SectionKey) => void
  children: React.ReactNode
}
const Section: React.FC<SectionProps> = ({ title, id, open, onToggle, children }) => (
  <div className="border border-slate-700 rounded-lg overflow-hidden">
    <button
      onClick={() => onToggle(id)}
      className="w-full flex items-center justify-between px-4 py-2.5 bg-slate-750 hover:bg-slate-700/50 transition-colors"
    >
      <div className="flex items-center gap-2">
        {SECTION_ICONS[id]}
        <span className="text-sm font-medium text-slate-200">{title}</span>
      </div>
      {open ? <ChevronDown size={14} className="text-slate-400" /> : <ChevronRight size={14} className="text-slate-400" />}
    </button>
    {open && <div className="px-4 pb-3 pt-1 bg-slate-800/60">{children}</div>}
  </div>
)

// ---- Inputs utilitaires ----

const NumberInput: React.FC<{
  value: number
  min?: number
  max?: number
  step?: number
  onChange: (v: number) => void
}> = ({ value, min, max, step = 1, onChange }) => (
  <input
    type="number"
    value={value}
    min={min}
    max={max}
    step={step}
    onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
    className="w-full bg-slate-700 border border-slate-600 text-white text-xs px-2 py-1 rounded outline-none focus:border-blue-500"
  />
)

const SliderInput: React.FC<{
  value: number
  min: number
  max: number
  step?: number
  onChange: (v: number) => void
}> = ({ value, min, max, step = 1, onChange }) => (
  <div className="flex items-center gap-2">
    <input
      type="range"
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      className="flex-1 accent-blue-500"
    />
    <span className="text-xs text-slate-300 w-8 text-right">{value}</span>
  </div>
)


// ---- Sous-composant : ligne de stockage ----
interface StorageRowProps {
  label: string
  mb: number
  path: string
  onClear?: () => void
  clearing?: boolean
}
const StorageRow: React.FC<StorageRowProps> = ({ label, mb, path, onClear, clearing }) => {
  const t = useT()
  const color = mb > 500 ? 'text-red-400' : mb > 100 ? 'text-amber-400' : 'text-slate-300'
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 border-b border-slate-700/50 last:border-0">
      <div className="min-w-0 flex-1">
        <p className="text-xs text-slate-300">{label}</p>
        <p className="text-xs text-slate-600 truncate mt-0.5" title={path}>{path}</p>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className={`text-xs font-semibold ${color}`}>{mb.toFixed(1)} {t('Mo')}</span>
        {onClear && (
          <button
            onClick={onClear}
            disabled={clearing || mb === 0}
            title={t('Vider ce dossier')}
            className="p-1 text-slate-500 hover:text-red-400 disabled:opacity-30 transition-colors rounded hover:bg-red-900/20"
          >
            {clearing ? <RefreshCw size={12} className="animate-spin" /> : <Trash2 size={12} />}
          </button>
        )}
      </div>
    </div>
  )
}

// ============================================================
// Composant principal
// ============================================================

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  const t = useT()
  const [settings, setSettings] = useState<UserSettings | null>(null)
  const [original, setOriginal] = useState<UserSettings | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [openSections, setOpenSections] = useState<Set<SectionKey>>(
    new Set(['interface', 'import'])
  )
  const [storageStats, setStorageStats] = useState<StorageStats | null>(null)
  const [storageLoading, setStorageLoading] = useState(false)
  const [clearingBackup, setClearingBackup] = useState(false)
  const [clearingExports, setClearingExports] = useState(false)
  // Vérification du modèle YOLO configuré (bouton "Vérifier")

  // Chargement initial (settings + stats disque)
  useEffect(() => {
    if (!isOpen) return
    settingsAPI.get().then((s) => {
      setSettings(s)
      setOriginal(s)
      setSaved(false)
    }).catch(() => {/* silencieux */})
    setStorageLoading(true)
    storageAPI.getStats().then(setStorageStats).catch(() => {/* silencieux */}).finally(() => setStorageLoading(false))
  }, [isOpen])

  if (!isOpen || !settings) return null

  const toggleSection = (id: SectionKey) => {
    setOpenSections((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  // Mise à jour d'une sous-section
  const patch = <K extends keyof UserSettings>(section: K, key: keyof UserSettings[K], value: UserSettings[K][keyof UserSettings[K]]) => {
    setSettings((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        [section]: { ...prev[section], [key]: value },
      }
    })
    setSaved(false)
  }

  const handleSave = async () => {
    if (!settings) return
    setSaving(true)
    try {
      await settingsAPI.update(settings)
      setSaved(true)
      // Rechargement de la page pour appliquer tous les paramètres
      setTimeout(() => window.location.reload(), 800)
    } catch {/* toast géré par l'intercepteur */}
    finally { setSaving(false) }
  }

  const handleReset = async () => {
    setResetting(true)
    try {
      const defaults = await settingsAPI.reset()
      setSettings(defaults)
      setOriginal(defaults)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch {/* */}
    finally { setResetting(false) }
  }

  const isDirty = JSON.stringify(settings) !== JSON.stringify(original)

  const refreshStorageStats = () => {
    storageAPI.getStats().then(setStorageStats).catch(() => {/* silencieux */})
  }

  const handleClearBackup = async () => {
    setClearingBackup(true)
    try {
      await storageAPI.clearBackup()
      refreshStorageStats()
    } catch {/* toast géré */}
    finally { setClearingBackup(false) }
  }

  const handleClearExports = async () => {
    setClearingExports(true)
    try {
      await storageAPI.clearExports()
      refreshStorageStats()
    } catch {/* toast géré */}
    finally { setClearingExports(false) }
  }

  // Ratios export : forcer somme = 1
  const patchExportRatio = (key: 'train_ratio' | 'val_ratio' | 'test_ratio', v: number) => {
    const val = Math.min(1, Math.max(0, parseFloat(v.toFixed(2))))
    patch('export', key, val)
  }
  const exportSum = +(settings.export.train_ratio + settings.export.val_ratio + settings.export.test_ratio).toFixed(2)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-slate-800 border border-slate-700 rounded-xl shadow-2xl w-[580px] max-h-[90vh] flex flex-col">

        {/* En-tête */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700">
          <h2 className="text-base font-semibold text-slate-100">{t('Paramètres')}</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-700 text-slate-400 hover:text-white">
            <X size={16} />
          </button>
        </div>

        {/* Corps défilant */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">

          {/* ---- Interface ---- */}
          <Section title={t('Interface')} id="interface" open={openSections.has('interface')} onToggle={toggleSection}>
            <ParamRow label={t('Couleur de fond canvas')} hint={t('Hex ou nom CSS')}>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={settings.interface.background_color}
                  onChange={(e) => patch('interface', 'background_color', e.target.value)}
                  className="w-8 h-8 rounded cursor-pointer border-0 bg-transparent"
                />
                <input
                  type="text"
                  value={settings.interface.background_color}
                  onChange={(e) => patch('interface', 'background_color', e.target.value)}
                  className="flex-1 bg-slate-700 border border-slate-600 text-white text-xs px-2 py-1 rounded outline-none focus:border-blue-500"
                />
              </div>
            </ParamRow>

            <ParamRow label={t('Outil par défaut')} hint={t('Astuce : clic molette = auto-ajustement (fit), molette = zoom')}>
              <select
                value={settings.interface.default_tool}
                onChange={(e) => patch('interface', 'default_tool', e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 text-white text-xs px-2 py-1 rounded outline-none focus:border-blue-500"
              >
                <option value="select">{t('Sélection')}</option>
                <option value="bbox">Bounding Box</option>
                <option value="polygon">{t('Polygone')}</option>
                <option value="sam_point">SAM Point</option>
                <option value="pan">{t('Déplacement')}</option>
              </select>
            </ParamRow>

            <ParamRow label={t('Opacité des annotations')} hint={t('[0 = invisible, 1 = plein]')}>
              <SliderInput
                value={settings.interface.annotation_opacity}
                min={0} max={1} step={0.05}
                onChange={(v) => patch('interface', 'annotation_opacity', v)}
              />
            </ParamRow>

            <ParamRow label={t('Afficher les étiquettes')} hint={t('Nom de classe sur chaque annotation')}>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.interface.show_labels}
                  onChange={(e) => patch('interface', 'show_labels', e.target.checked)}
                  className="accent-blue-500"
                />
                <span className="text-xs text-slate-400">{settings.interface.show_labels ? t('Oui') : t('Non')}</span>
              </label>
            </ParamRow>

            <ParamRow label={t('Afficher le score')} hint={t('Confiance en % sur les annotations IA')}>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.interface.show_confidence}
                  onChange={(e) => patch('interface', 'show_confidence', e.target.checked)}
                  className="accent-blue-500"
                />
                <span className="text-xs text-slate-400">{settings.interface.show_confidence ? t('Oui') : t('Non')}</span>
              </label>
            </ParamRow>

            <ParamRow label={t('Épaisseur des bordures')} hint={t('Épaisseur du contour des annotations (1–4 px)')}>
              <SliderInput
                value={settings.interface.annotation_border_width}
                min={1} max={4} step={0.5}
                onChange={(v) => patch('interface', 'annotation_border_width', v)}
              />
            </ParamRow>

            <ParamRow label={t('Réduction preview (480/1600px)')} hint={t("Désactiver si votre connexion est bonne : sert la source pleine résolution pour le scrub/l'affichage, sans écriture disque à résolution réduite")}>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.interface.preview_downscale_enabled}
                  onChange={(e) => patch('interface', 'preview_downscale_enabled', e.target.checked)}
                  className="accent-blue-500"
                />
                <span className="text-xs text-slate-400">{settings.interface.preview_downscale_enabled ? t('Activée') : t('Désactivée (pleine résolution)')}</span>
              </label>
            </ParamRow>

            <ParamRow
              label={t('Live temps réel par défaut')}
              hint={t("Activé : pendant SAMURAI/SAM2, le canvas suit la propagation, lit l'image via le chemin natif SMB/app-image quand il est disponible et applique les annotations poussées par WebSocket.")}
            >
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.interface.realtime_live_enabled}
                  onChange={(e) => patch('interface', 'realtime_live_enabled', e.target.checked)}
                  className="accent-teal-500"
                />
                <span className="text-xs text-slate-400">{settings.interface.realtime_live_enabled ? 'ON' : 'OFF'}</span>
              </label>
            </ParamRow>

            <ParamRow
              label={t('Suivi propagation : cadence du canvas')}
              hint={t("Intervalle minimal entre deux sauts d'image pendant une propagation. 150 ms suit la boucle WebSocket et convient au chemin SMB natif ; 700 ms économise le réseau en repli HTTP ; 0 suit chaque résultat GPU. Chaque image affichée reçoit toujours les annotations de la même frame.")}
            >
              <SliderInput
                value={settings.interface.propagation_nav_throttle_ms}
                min={0} max={2000} step={50}
                onChange={(v) => patch('interface', 'propagation_nav_throttle_ms', v)}
              />
            </ParamRow>
          </Section>

          {/* ---- Import ---- */}
          <Section title={t('Import')} id="import" open={openSections.has('import')} onToggle={toggleSection}>
            <p className="text-[11px] text-slate-500 pb-2 leading-relaxed border-b border-slate-700/50 mb-1">
              {t("Ces réglages s'appliquent selon le TYPE d'import :")}
              <br />• <strong className="text-slate-400">{t('Vidéo / format spécifique')}</strong> : {t("décimation et upload par chunks si l'adaptateur le permet.")}
              <br />• <strong className="text-slate-400">{t("Dossier d'images")}</strong> : {t('copie/symlink sans ré-encodage (qualité source préservée).')}
              <br />{t('Le')} <strong className="text-slate-400">{t('nom de séquence')}</strong> {t("par défaut = nom du dossier/fichier, modifiable dans la fenêtre d'import.")}
            </p>
            <ParamRow label={t('Qualité JPEG')} hint={t("Extraction vidéo uniquement (50–95). Dossiers d'images : non ré-encodés")}>
              <SliderInput
                value={settings.import.jpeg_quality}
                min={50} max={95} step={5}
                onChange={(v) => patch('import', 'jpeg_quality', v)}
              />
            </ParamRow>

            <ParamRow label={t('Chunk source (MB)')} hint={t("Upload d'une source monofichier — RAM max pendant l'envoi")}>
              <SliderInput
                value={settings.import.chunk_size_mb}
                min={1} max={64} step={1}
                onChange={(v) => patch('import', 'chunk_size_mb', v)}
              />
            </ParamRow>

            <ParamRow label={t('Décimation frames (frame_keep)')} hint={t('Vidéo ou format séquentiel — 0=tout, 2=1/2, 3=1/3, 4=1/4...')}>
              <NumberInput
                value={settings.import.frame_keep}
                min={0} max={10} step={1}
                onChange={(v) => patch('import', 'frame_keep', v)}
              />
            </ParamRow>

            <ParamRow label={t('Taille batch images')} hint={t('Upload dossier d\'images — envoi séquentiel par batchs')}>
              <NumberInput
                value={settings.import.batch_size_images}
                min={1} max={100}
                onChange={(v) => patch('import', 'batch_size_images', v)}
              />
            </ParamRow>
          </Section>

          {/* ---- Algorithmes ---- */}
          <Section title={t('Algorithmes')} id="algorithms" open={openSections.has('algorithms')} onToggle={toggleSection}>
            <p className="text-xs text-slate-500 pb-2">NMS</p>
            <ParamRow label={t('Seuil IoU NMS')} hint={t('[0–1] — plus bas = plus agressif')}>
              <SliderInput
                value={settings.algorithms.nms_iou_threshold}
                min={0.1} max={0.9} step={0.05}
                onChange={(v) => patch('algorithms', 'nms_iou_threshold', v)}
              />
            </ParamRow>

            <p className="text-xs text-slate-500 pb-2 pt-3">Grounding DINO</p>
            <ParamRow label="Box threshold">
              <SliderInput
                value={settings.algorithms.grounding_dino_box_threshold}
                min={0.1} max={0.9} step={0.05}
                onChange={(v) => patch('algorithms', 'grounding_dino_box_threshold', v)}
              />
            </ParamRow>
            <ParamRow label="Text threshold">
              <SliderInput
                value={settings.algorithms.grounding_dino_text_threshold}
                min={0.1} max={0.9} step={0.05}
                onChange={(v) => patch('algorithms', 'grounding_dino_text_threshold', v)}
              />
            </ParamRow>
            <ParamRow
              label={t('Sortie segmentation par défaut')}
              hint={t("Valeur de départ du sélecteur BBox / Seg de la barre d'outils. Seg = polygones (GD raffiné par SAM2, SAM3, SAM Auto) ; BBox = boîtes brutes.")}
            >
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.algorithms.grounding_dino_use_sam_refine}
                  onChange={(e) => patch('algorithms', 'grounding_dino_use_sam_refine', e.target.checked)}
                  className="accent-blue-500"
                />
                <span className="text-xs text-slate-400">
                  {settings.algorithms.grounding_dino_use_sam_refine ? t('Oui') : t('Non')}
                </span>
              </label>
            </ParamRow>

            <p className="text-xs text-slate-500 pb-2 pt-3">SAM2 Auto</p>
            <ParamRow label={t('Points par côté')} hint={t('Grille de points SAM2 auto')}>
              <NumberInput
                value={settings.algorithms.sam_points_per_side}
                min={4} max={128}
                onChange={(v) => patch('algorithms', 'sam_points_per_side', v)}
              />
            </ParamRow>
            <ParamRow label="IoU threshold SAM">
              <SliderInput
                value={settings.algorithms.sam_pred_iou_thresh}
                min={0.5} max={1.0} step={0.01}
                onChange={(v) => patch('algorithms', 'sam_pred_iou_thresh', v)}
              />
            </ParamRow>

            <p className="text-xs text-slate-500 pb-2 pt-3">{t('Homographie (XFeat / SIFT)')}</p>
            <ParamRow label="XFeat top-k keypoints">
              <NumberInput
                value={settings.algorithms.xfeat_top_k}
                min={256} max={8192} step={256}
                onChange={(v) => patch('algorithms', 'xfeat_top_k', v)}
              />
            </ParamRow>
            <ParamRow label="XFeat min cossim">
              <SliderInput
                value={settings.algorithms.xfeat_min_cossim}
                min={0.5} max={0.99} step={0.01}
                onChange={(v) => patch('algorithms', 'xfeat_min_cossim', v)}
              />
            </ParamRow>
            <ParamRow label="RANSAC threshold (px)">
              <NumberInput
                value={settings.algorithms.ransac_threshold}
                min={0.5} max={20} step={0.5}
                onChange={(v) => patch('algorithms', 'ransac_threshold', v)}
              />
            </ParamRow>
            <ParamRow label={t('Min inliers')}>
              <NumberInput
                value={settings.algorithms.min_inlier_count}
                min={4} max={100}
                onChange={(v) => patch('algorithms', 'min_inlier_count', v)}
              />
            </ParamRow>
            <ParamRow label={t('Min ratio inliers')}>
              <SliderInput
                value={settings.algorithms.min_inlier_ratio}
                min={0.1} max={0.9} step={0.05}
                onChange={(v) => patch('algorithms', 'min_inlier_ratio', v)}
              />
            </ParamRow>

            <p className="text-xs text-slate-500 pb-2 pt-3">{t('Flux optique (Lucas-Kanade)')}</p>
            <ParamRow label={t('Fenêtre win_size (px)')}>
              <NumberInput
                value={settings.algorithms.optflow_win_size}
                min={5} max={63} step={2}
                onChange={(v) => patch('algorithms', 'optflow_win_size', v)}
              />
            </ParamRow>
            <ParamRow label={t('Niveaux pyramide max_level')}>
              <NumberInput
                value={settings.algorithms.optflow_max_level}
                min={1} max={8}
                onChange={(v) => patch('algorithms', 'optflow_max_level', v)}
              />
            </ParamRow>
            <ParamRow label={t('Points min trackés')}>
              <NumberInput
                value={settings.algorithms.optflow_min_pts}
                min={1} max={20}
                onChange={(v) => patch('algorithms', 'optflow_min_pts', v)}
              />
            </ParamRow>

            <p className="text-xs text-slate-500 pb-2 pt-3">SAM3</p>
            <p className="text-xs text-slate-600 pb-2">
              {t("Toolbar SAM3 et tracking guidé utilisent les mêmes valeurs. La sortie (boîtes ou polygones) suit le sélecteur BBox / Seg de la barre d'outils.")}
            </p>
            <ParamRow label="Box threshold">
              <SliderInput
                value={settings.algorithms.sam3_box_threshold}
                min={0.05} max={0.9} step={0.05}
                onChange={(v) => patch('algorithms', 'sam3_box_threshold', v)}
              />
            </ParamRow>
            <ParamRow label="Text threshold">
              <SliderInput
                value={settings.algorithms.sam3_text_threshold}
                min={0.05} max={0.9} step={0.05}
                onChange={(v) => patch('algorithms', 'sam3_text_threshold', v)}
              />
            </ParamRow>

            <p className="text-xs text-slate-500 pb-2 pt-3">{t('Detect. — Matching géométrique')}</p>
            <ParamRow label={t('Max distance centroïde')} hint={t('Normalisée [0–1]')}>
              <SliderInput
                value={settings.algorithms.guided_max_centroid_dist}
                min={0.01} max={0.5} step={0.01}
                onChange={(v) => patch('algorithms', 'guided_max_centroid_dist', v)}
              />
            </ParamRow>
            <ParamRow label={t('Variation de taille max')} hint={t('Ratio relatif [0–1]')}>
              <SliderInput
                value={settings.algorithms.guided_size_variation}
                min={0.05} max={2.0} step={0.05}
                onChange={(v) => patch('algorithms', 'guided_size_variation', v)}
              />
            </ParamRow>

            <p className="text-xs text-slate-500 pb-2 pt-3">SAMURAI / SAM2 {t('vidéo')}</p>
            <ParamRow
              label={t('Mode GPU rapide')}
              hint={t('Coché (défaut) = frames sur le GPU → 1.5–3x plus rapide, mais limité par la VRAM (~350–450 frames @1024² sur 10 Go). Décoché = offload CPU : VRAM mini, séquences longues, mais plus lent')}
            >
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!(settings.algorithms.sam2_offload_video_to_cpu ?? false)}
                  onChange={(e) => patch('algorithms', 'sam2_offload_video_to_cpu', !e.target.checked)}
                  className="w-3.5 h-3.5 accent-purple-500"
                />
                <span className="text-xs text-slate-400">
                  {!(settings.algorithms.sam2_offload_video_to_cpu ?? false) ? t('GPU (rapide)') : t('CPU (VRAM mini)')}
                </span>
              </label>
            </ParamRow>

            <p className="text-xs text-slate-500 pb-2 pt-3">{t('Auto-stop global (tous les trackers)')}</p>
            <ParamRow label={t('Activer auto-stop')} hint={t("Arrêt si trop d'objets perdus")}>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.algorithms.auto_stop_enabled ?? false}
                  onChange={(e) => patch('algorithms', 'auto_stop_enabled', e.target.checked)}
                  className="w-3.5 h-3.5 accent-orange-500"
                />
                <span className="text-xs text-slate-400">
                  {settings.algorithms.auto_stop_enabled ? t('Activé') : t('Désactivé')}
                </span>
              </label>
            </ParamRow>
            {settings.algorithms.auto_stop_enabled && (<>
              <ParamRow label={t("% d'objets perdus max")} hint={t('0.5 = stop si > 50% perdus')}>
                <SliderInput
                  value={settings.algorithms.auto_stop_lost_ratio ?? 0.5}
                  min={0.1} max={1.0} step={0.1}
                  onChange={(v) => patch('algorithms', 'auto_stop_lost_ratio', v)}
                />
              </ParamRow>
              <ParamRow label={t('Frames consécutives')} hint={t('Nb frames avant arrêt')}>
                <SliderInput
                  value={settings.algorithms.auto_stop_consecutive_frames ?? 5}
                  min={1} max={30} step={1}
                  onChange={(v) => patch('algorithms', 'auto_stop_consecutive_frames', v)}
                />
              </ParamRow>
            </>)}
          </Section>

          {/* ---- Stockage ---- */}
          <Section title={t('Stockage workspace')} id="storage" open={openSections.has('storage')} onToggle={toggleSection}>
            {storageLoading ? (
              <p className="text-xs text-slate-500 py-2">{t('Calcul en cours…')}</p>
            ) : storageStats ? (
              <div className="space-y-2 py-1">
                {/* Projets (lecture seule) */}
                <StorageRow
                  label={t('Projets (frames + thumbnails)')}
                  mb={storageStats.projects_mb}
                  path={storageStats.projects_path}
                />
                {/* Backup */}
                <StorageRow
                  label={t('Sauvegardes JSON')}
                  mb={storageStats.backup_mb}
                  path={storageStats.backup_path}
                  onClear={() => void handleClearBackup()}
                  clearing={clearingBackup}
                />
                {/* Exports */}
                <StorageRow
                  label={t('Exports YOLO (ZIP)')}
                  mb={storageStats.exports_mb}
                  path={storageStats.exports_path}
                  onClear={() => void handleClearExports()}
                  clearing={clearingExports}
                />
                <button
                  onClick={refreshStorageStats}
                  className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 transition-colors mt-1"
                >
                  <RefreshCw size={11} /> {t('Actualiser')}
                </button>
              </div>
            ) : (
              <p className="text-xs text-slate-500 py-2">{t('Impossible de lire les tailles.')}</p>
            )}
          </Section>

          {/* ---- Export ---- */}
          <Section title={t('Export YOLO')} id="export" open={openSections.has('export')} onToggle={toggleSection}>
            <ParamRow label={t('Ratio Train')} hint={`${t('Somme')} : ${exportSum}${exportSum !== 1 ? ` ⚠ ${t('doit valoir 1.0')}` : ' ✓'}`}>
              <SliderInput
                value={settings.export.train_ratio}
                min={0} max={1} step={0.05}
                onChange={(v) => patchExportRatio('train_ratio', v)}
              />
            </ParamRow>
            <ParamRow label={t('Ratio Val')}>
              <SliderInput
                value={settings.export.val_ratio}
                min={0} max={1} step={0.05}
                onChange={(v) => patchExportRatio('val_ratio', v)}
              />
            </ParamRow>
            <ParamRow label={t('Ratio Test')}>
              <SliderInput
                value={settings.export.test_ratio}
                min={0} max={1} step={0.05}
                onChange={(v) => patchExportRatio('test_ratio', v)}
              />
            </ParamRow>
            <ParamRow label={t('Inclure non-annotées')}>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.export.include_unannotated}
                  onChange={(e) => patch('export', 'include_unannotated', e.target.checked)}
                  className="accent-blue-500"
                />
                <span className="text-xs text-slate-400">{settings.export.include_unannotated ? t('Oui') : t('Non')}</span>
              </label>
            </ParamRow>
            <ParamRow label={t('Liens symboliques images')} hint={t('Dossier local (pas de ZIP) si actif')}>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.export.symlink_images}
                  onChange={(e) => patch('export', 'symlink_images', e.target.checked)}
                  className="accent-blue-500"
                />
                <span className="text-xs text-slate-400">{settings.export.symlink_images ? t('Oui') : t('Non')}</span>
              </label>
            </ParamRow>
            {/* Hôte partage réseau natif retiré d'ici (step3a) : configuré UNIQUEMENT depuis le
                menu « Workspace » de la page d'accueil (source unique, persistée
                dans les settings et lue par le backend pour l'ouverture de dossier). */}
          </Section>

        </div>

        {/* Pied de page */}
        <div className="px-6 py-4 border-t border-slate-700 flex items-center justify-between gap-3">
          <button
            onClick={() => void handleReset()}
            disabled={resetting}
            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-red-400 transition-colors disabled:opacity-50"
          >
            <RotateCcw size={12} className={resetting ? 'animate-spin' : ''} />
            {t('Réinitialiser')}
          </button>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-1.5 text-sm text-slate-300 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors"
            >
              {t('Fermer')}
            </button>
            <button
              onClick={() => void handleSave()}
              disabled={!isDirty || saving}
              className={`flex items-center gap-1.5 px-4 py-1.5 text-sm rounded-lg transition-colors disabled:opacity-50 ${
                saved
                  ? 'bg-green-600 text-white'
                  : 'bg-blue-600 hover:bg-blue-500 text-white disabled:bg-slate-700 disabled:text-slate-500'
              }`}
            >
              <Save size={13} />
              {saved ? t('Sauvegardé !') : saving ? t('Sauvegarde...') : t('Sauvegarder')}
            </button>
          </div>
        </div>

      </div>
    </div>
  )
}
