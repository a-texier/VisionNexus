// ============================================================
// components/modals/ImportModal.tsx
// Panneau d'import UNIFIÉ multi-séquences.
//
// Un projet = plusieurs séquences (dossiers d'images et vidéos mélangés).
// Chaque "slot" de la liste accepte :
//   - un glisser-déposer depuis l'explorateur (fichiers/dossier → UPLOAD
//     via le navigateur — le navigateur ne peut pas transmettre un chemin,
//     seulement le contenu des fichiers) ;
//   - OU un chemin serveur tapé en dur / choisi au navigateur de fichiers
//     (zéro copie : symlink côté backend — recommandé pour les gros
//     datasets et les disques montés sur la VM).
// Dès qu'un slot est rempli, un slot vierge apparaît en dessous.
// "Tout importer" traite les slots EN SÉRIE : chaque import crée une
// séquence, avec barre de progression par slot.
// ============================================================

import React, { useEffect, useRef, useState } from 'react'
import {
  X, Upload, Film, Image, FolderOpen, Loader2, Trash2,
  Settings2, Search, Server, CheckCircle2, AlertCircle, Plus,
} from 'lucide-react'
import { useImportStore } from '../../stores/importStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { datasetAPI } from '../../services/api'
import type { SpecificFormatCapability } from '../../types/api'
import { FileBrowserModal } from './FileBrowserModal'
import { useT } from '../../i18n/useLang'

interface ImportModalProps {
  isOpen: boolean
  projectId: number
  projectType: 'image' | 'video'
  onImported: (extractionTaskId?: string) => void
  onClose: () => void
}

const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'bmp', 'tiff', 'tif', 'webp']
const VIDEO_EXTS = ['mp4', 'avi', 'mov', 'mkv', 'webm']

// ---- Lecture récursive d'un dossier droppé (webkitGetAsEntry) ----
const readFolderFiles = (dirEntry: unknown): Promise<File[]> => {
  return new Promise((resolve) => {
    const entry = dirEntry as { createReader: () => { readEntries: (cb: (entries: unknown[]) => void) => void } }
    const reader = entry.createReader()
    const allFiles: File[] = []
    const readBatch = () => {
      reader.readEntries((entries: unknown[]) => {
        if (entries.length === 0) { resolve(allFiles.sort((a, b) => a.name.localeCompare(b.name))); return }
        Promise.all(entries.map((e) => {
          const ent = e as { isFile: boolean; file: (cb: (f: File) => void) => void }
          if (!ent.isFile) return Promise.resolve()
          return new Promise<void>((res) => {
            ent.file((f: File) => {
              const ext = f.name.toLowerCase().split('.').pop() || ''
              if (IMAGE_EXTS.includes(ext)) allFiles.push(f)
              res()
            })
          })
        })).then(readBatch)
      })
    }
    readBatch()
  })
}

// ---- Slot d'import (une future séquence) ----
type SlotStatus = 'empty' | 'ready' | 'running' | 'done' | 'error'

interface ImportSlot {
  id: number
  files: File[]        // rempli par drag & drop / sélecteur → upload
  serverPath: string   // rempli à la main / navigateur serveur → zéro copie
  name: string         // nom de séquence (vide = auto d'après le dossier/fichier)
  status: SlotStatus
  progress: number
  message: string
}

let _slotId = 0
const newSlot = (): ImportSlot => ({
  id: ++_slotId, files: [], serverPath: '', name: '', status: 'empty', progress: 0, message: '',
})

// Nom auto d'une séquence = nom du dossier/fichier source
const autoName = (slot: ImportSlot): string => {
  if (slot.serverPath.trim()) return slot.serverPath.trim().split(/[\\/]/).pop() || slot.serverPath.trim()
  if (slot.files.length === 1) return slot.files[0].name.replace(/\.[^.]+$/, '')
  return `sequence_${slot.id}`
}

// Description lisible du contenu d'un slot
const findSpecificFormat = (name: string, formats: SpecificFormatCapability[]) => {
  const lower = name.toLowerCase()
  return formats.find((format) => format.extensions.some((ext) => lower.endsWith(ext.toLowerCase())))
}

const slotKind = (
  slot: ImportSlot, formats: SpecificFormatCapability[], t: (fr: string) => string,
): { icon: React.ReactNode; label: string } | null => {
  if (slot.serverPath.trim()) {
    const p = slot.serverPath.trim().toLowerCase()
    const specific = findSpecificFormat(p, formats)
    if (specific) return { icon: <Film size={14} className="text-violet-400" />, label: `${specific.label} ${t('serveur')}` }
    if (VIDEO_EXTS.some((e) => p.endsWith(`.${e}`))) return { icon: <Film size={14} className="text-emerald-400" />, label: t('Vidéo serveur') }
    return { icon: <FolderOpen size={14} className="text-emerald-400" />, label: t('Dossier images serveur (symlink)') }
  }
  if (slot.files.length > 0) {
    const first = slot.files[0].name.toLowerCase()
    const specific = findSpecificFormat(first, formats)
    if (specific) return { icon: <Film size={14} className="text-violet-400" />, label: `${specific.label} (${t('upload')})` }
    if (VIDEO_EXTS.some((e) => first.endsWith(`.${e}`))) return { icon: <Film size={14} className="text-blue-400" />, label: t('Vidéo (upload)') }
    return { icon: <Image size={14} className="text-blue-400" />, label: `${slot.files.length} ${t('image')}${slot.files.length > 1 ? 's' : ''} (${t('upload')})` }
  }
  return null
}

export const ImportModal: React.FC<ImportModalProps> = ({
  isOpen, projectId, projectType, onImported, onClose,
}) => {
  const t = useT()
  // ---- Slots ----
  const [slots, setSlots] = useState<ImportSlot[]>([newSlot()])
  const [specificFormats, setSpecificFormats] = useState<SpecificFormatCapability[]>([])
  const [dragOverSlotId, setDragOverSlotId] = useState<number | null>(null)
  const fileInputRefs = useRef<Map<number, HTMLInputElement>>(new Map())

  // ---- Paramètres globaux (appliqués à chaque séquence importée) ----
  const [frameKeep, setFrameKeep] = useState<number>(0)
  const [customFrameKeep, setCustomFrameKeep] = useState('')
  const [showCustomInput, setShowCustomInput] = useState(false)
  const [jpegQuality, setJpegQuality] = useState(85)
  const [extractionBatchSize, setExtractionBatchSize] = useState(50)
  const [lossless, setLossless] = useState(false)
  const [useSymlink, setUseSymlink] = useState(true)
  const [showAdvanced, setShowAdvanced] = useState(false)

  // ---- État global d'import ----
  const [isImporting, setIsImporting] = useState(false)
  const [, setAllDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef(false)

  // ---- Navigateur de fichiers serveur ----
  const [showBrowser, setShowBrowser] = useState(false)
  const [browserSlotId, setBrowserSlotId] = useState<number | null>(null)

  const importDefaults = useSettingsStore((s) => s.settings?.import)

  useEffect(() => {
    if (isOpen) {
      // Depart des curseurs = Parametres > Import (modifiables ici pour cet import seulement)
      if (importDefaults) {
        setJpegQuality(importDefaults.jpeg_quality)
        setFrameKeep(importDefaults.frame_keep)
      }
      datasetAPI.getCapabilities()
        .then((result) => setSpecificFormats(result.specific_formats))
        .catch(() => setSpecificFormats([]))
    }
    if (!isOpen) {
      setSlots([newSlot()])
      setIsImporting(false)
      setAllDone(false)
      setError(null)
      abortRef.current = false
      setSpecificFormats([])
    }
  }, [isOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!isOpen) return null

  // Garantit qu'il reste toujours exactement un slot vierge en fin de liste
  const ensureTrailingEmpty = (list: ImportSlot[]): ImportSlot[] => {
    const filled = list.filter((s) => s.status !== 'empty' || s.files.length > 0 || s.serverPath.trim())
    return [...filled, newSlot()]
  }

  const fillSlotFiles = (id: number, files: File[]) => {
    setSlots((prev) => ensureTrailingEmpty(
      prev.map((s) => (s.id === id ? { ...s, files, serverPath: '', status: 'ready' as SlotStatus } : s))
    ))
    setError(null)
  }

  const fillSlotPath = (id: number, path: string) => {
    // Chemin d'un .txt de manifeste → expansion en toutes les séquences (step3b).
    if (path.trim().toLowerCase().endsWith('.txt')) {
      datasetAPI.parseSequenceManifest(path.trim())
        .then((res) => {
          if (res.sequences.length === 0) { setError(t('Manifeste .txt vide.')); return }
          setSlots(() => [
            ...res.sequences.map((s) => ({
              ...newSlot(), serverPath: s.source_path, name: s.name, status: 'ready' as SlotStatus,
            })),
            newSlot(),
          ])
          setError(null)
        })
        .catch(() => setError(t('Manifeste .txt introuvable ou illisible côté serveur.')))
      return
    }
    setSlots((prev) => {
      const next = prev.map((s) =>
        s.id === id ? { ...s, serverPath: path, files: [], status: (path.trim() ? 'ready' : 'empty') as SlotStatus } : s)
      // Nouveau slot vierge dès qu'un chemin non vide est saisi
      const hasTrailingEmpty = next[next.length - 1] && !next[next.length - 1].serverPath.trim() && next[next.length - 1].files.length === 0
      return hasTrailingEmpty ? next : [...next, newSlot()]
    })
    setError(null)
  }

  const removeSlot = (id: number) => {
    setSlots((prev) => {
      const next = prev.filter((s) => s.id !== id)
      return next.length === 0 ? [newSlot()] : next
    })
  }

  // ---- Manifeste de séquences (.txt) : « source_path<TAB>nom » par ligne ----
  // Généré par le backup (step3b) : le glisser sur un slot pré-remplit TOUTES les
  // séquences d'un coup (récupération après perte de projet).
  const applySequenceManifest = (text: string) => {
    const rows = text.split(/\r?\n/).map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
      .map((line) => {
        const tab = line.indexOf('\t')
        if (tab >= 0) return { path: line.slice(0, tab).trim(), name: line.slice(tab + 1).trim() }
        const sp = line.lastIndexOf(' ')   // repli : le nom est le dernier token
        return sp >= 0 ? { path: line.slice(0, sp).trim(), name: line.slice(sp + 1).trim() } : { path: line, name: '' }
      })
      .filter((r) => r.path)
    if (rows.length === 0) { setError(t('Fichier .txt de séquences vide ou invalide.')); return }
    setSlots(() => [
      ...rows.map((r) => ({ ...newSlot(), serverPath: r.path, name: r.name, status: 'ready' as SlotStatus })),
      newSlot(),
    ])
    setError(null)
  }

  // ---- Drag & drop sur un slot ----
  const handleDrop = async (e: React.DragEvent, slotId: number) => {
    e.preventDefault()
    setDragOverSlotId(null)
    // Un .txt de manifeste pré-remplit toutes les séquences (pas un seul slot).
    const dropped = e.dataTransfer.files
    if (dropped.length === 1 && dropped[0].name.toLowerCase().endsWith('.txt')) {
      applySequenceManifest(await dropped[0].text())
      return
    }
    // Coquille Electron : on tente d'abord le vrai chemin OS du dossier/fichier
    // déposé (webUtils.getPathForFile côté preload) plutôt que de lire son
    // contenu - indispensable pour un dossier sur un partage SMB (\\<share-host>\...),
    // sinon on tombe dans la branche upload plus bas qui COPIE tout localement.
    // Passe aussi par le chemin zéro-copie existant (serverPath/import_folder).
    const nativeGetPath = (window as unknown as {
      __CV_NATIVE_MOUNT__?: { getPathForFile?: (f: File) => string }
    }).__CV_NATIVE_MOUNT__?.getPathForFile
    if (nativeGetPath && dropped[0]) {
      const realPath = nativeGetPath(dropped[0])
      if (realPath) { fillSlotPath(slotId, realPath); return }
    }
    const items = e.dataTransfer.items
    if (items?.length > 0) {
      const item = items[0] as DataTransferItem & { webkitGetAsEntry?: () => unknown }
      const entry = item.webkitGetAsEntry?.()
      if (entry && (entry as { isDirectory?: boolean }).isDirectory) {
        const imgs = await readFolderFiles(entry)
        if (imgs.length > 0) fillSlotFiles(slotId, imgs)
        else setError(t('Aucune image dans ce dossier.'))
        return
      }
    }
    if (e.dataTransfer.files.length > 0) {
      fillSlotFiles(slotId, Array.from(e.dataTransfer.files))
    }
  }

  // ---- Lancer l'import EN TÂCHE DE FOND, puis fermer le modal ----
  // On délègue à importStore : la boucle série (indispensable — le backend lit
  // project.frame_count à la création de chaque séquence) survit à la fermeture
  // du modal. L'utilisateur peut annoter pendant que les séquences se chargent.
  const handleImportAll = () => {
    const readySlots = slots.filter((s) => s.status === 'ready')
    if (readySlots.length === 0) { setError(t('Ajoutez au moins une séquence (glisser-déposer ou chemin serveur).')); return }
    const specs = readySlots.map((s) => ({
      id: `spec_${s.id}`,
      label: s.name.trim() || autoName(s),  // nom séquence (custom ou auto)
      files: s.files,
      serverPath: s.serverPath,
      formatId: findSpecificFormat(s.serverPath || s.files[0]?.name || '', specificFormats)?.id,
    }))
    useImportStore.getState().startImport(
      projectId,
      specs,
      { frameKeep, jpegQuality, extractionBatchSize, lossless, useSymlink },
      () => onImported(),  // refresh frames/séquences après chaque séquence
    )
    onClose()
  }

  const readyCount = slots.filter((s) => s.status === 'ready').length
  const isVideoProject = projectType === 'video'

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={isImporting ? undefined : onClose} />

        <div className="relative bg-slate-800 border border-slate-700 rounded-xl p-5 w-[640px] max-h-[90vh] overflow-y-auto shadow-2xl">
          {/* En-tête */}
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold text-slate-100">
              {t('Importer des séquences')} — {isVideoProject ? t('Séquence Image') : t('Image Random')}
            </h2>
            <button onClick={onClose} disabled={isImporting} data-tour="import-modal-close"
              className="p-1 rounded hover:bg-slate-700 text-slate-400 hover:text-white transition-colors disabled:opacity-40">
              <X size={16} />
            </button>
          </div>

          {/* Bandeau explicatif provenances */}
          <div className="mb-4 rounded-lg border border-slate-700 bg-slate-900/40 px-3 py-2.5 space-y-1.5">
            <p className="text-xs text-slate-300 leading-relaxed">
              <Server size={11} className="inline mr-1 text-emerald-400" />
              <strong className="text-emerald-300">{t('Chemin serveur')}</strong> = {t('zéro copie (symlink) — recommandé pour les gros datasets et les disques')} <strong>{t('montés sur la machine du backend')}</strong>.
            </p>
            <p className="text-xs text-slate-400 leading-relaxed">
              <Upload size={11} className="inline mr-1 text-blue-400" />
              <strong className="text-blue-300">{t('Glisser-déposer')}</strong> = {t('upload via le navigateur.')}
              {' '}{t('Un dossier glissé depuis un montage réseau Windows est bien lu, mais son')} <em>{t('contenu est uploadé')}</em> {t('(le navigateur ne transmet jamais un chemin). Pour référencer les fichiers sans copie, utilisez le chemin tel que vu par le serveur (ex :')} <code className="text-slate-300">/mnt/…</code>).
            </p>
            <p className="text-xs text-slate-500 leading-relaxed">
              {t('Chaque ajout crée une')} <strong>{t('séquence')}</strong> {t('du projet (formats mélangeables). Import en série, une barre de progression par séquence.')}
            </p>
          </div>

          {/* ===== FORMATS SUPPORTÉS (toujours visible) ===== */}
          <div className="rounded-lg border border-slate-700 bg-slate-800/40 px-3 py-2 text-[11px] leading-relaxed text-slate-400">
            <span className="font-semibold text-slate-300">{t('Formats importables')}</span>
            <ul className="mt-1 space-y-0.5">
              <li>
                <span className="text-emerald-400 font-medium">{t("Dossier d'images")}</span> —
                {' '}JPG · PNG · BMP · WebP · <strong>TIFF/TIF</strong>. {t('8 bits, ou')}{' '}
                <strong className="text-slate-300">{t('16 bits (PNG/TIFF, RGB ou IR mono)')}</strong> :
                {' '}{t("source 16 bits conservée, seul l'affichage est remappé par la LUT (réglable par séquence).")}
              </li>
              <li>
                <span className="text-blue-400 font-medium">{t('Vidéo')}</span> —
                {' '}MP4 · AVI · MOV · MKV · WebM ({t('extraction en JPEG, décimation possible')}).
              </li>
              {specificFormats.map((format) => (
                <li key={format.id}>
                  <span className="text-violet-400 font-medium">{format.label}</span> —{' '}
                  {format.extensions.join(' · ')} ({t('adaptateur optionnel détecté côté backend')}).
                </li>
              ))}
              <li className="text-slate-500">
                {t('Source')} : <strong className="text-slate-400">{t('chemin serveur')}</strong> ({t('zéro copie / symlink')})
                {' '}{t('ou')} <strong className="text-slate-400">{t('glisser-déposer')}</strong> {t('local (upload navigateur).')}
              </li>
            </ul>
          </div>

          {/* ===== SLOTS ===== */}
          <div className="space-y-2.5">
            {slots.map((slot, i) => {
              const kind = slotKind(slot, specificFormats, t)
              const isDragOver = dragOverSlotId === slot.id
              const locked = slot.status === 'running' || slot.status === 'done'
              return (
                <div key={slot.id}
                  className={`rounded-lg border transition-colors ${
                    slot.status === 'done' ? 'border-green-600/50 bg-green-900/10'
                    : slot.status === 'error' ? 'border-red-600/50 bg-red-900/10'
                    : slot.status === 'running' ? 'border-blue-500/60 bg-blue-900/10'
                    : isDragOver ? 'border-blue-400 bg-blue-900/20 border-dashed'
                    : kind ? 'border-slate-600 bg-slate-700/20'
                    : 'border-slate-600 border-dashed hover:border-slate-500'
                  }`}
                  onDrop={(e) => { if (!locked && !isImporting) void handleDrop(e, slot.id) }}
                  onDragOver={(e) => { e.preventDefault(); if (!locked && !isImporting) setDragOverSlotId(slot.id) }}
                  onDragLeave={() => setDragOverSlotId(null)}
                >
                  <div className="px-3 py-2.5">
                    {/* Ligne principale du slot */}
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-semibold text-slate-500 w-8 flex-shrink-0">
                        {t('SÉQ')} {i + 1}
                      </span>

                      {kind ? (
                        <div className="flex items-center gap-1.5 min-w-0 flex-1">
                          {slot.status === 'done' ? <CheckCircle2 size={14} className="text-green-400" />
                            : slot.status === 'error' ? <AlertCircle size={14} className="text-red-400" />
                            : slot.status === 'running' ? <Loader2 size={14} className="text-blue-400 animate-spin" />
                            : kind.icon}
                          <span className="text-xs text-slate-200 truncate" title={slot.serverPath || slot.files[0]?.name}>
                            {slot.serverPath.trim() || (slot.files.length === 1 ? slot.files[0].name : kind.label)}
                          </span>
                          <span className="text-[10px] text-slate-500 flex-shrink-0">{kind.label}</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 flex-1 text-slate-500">
                          <Plus size={13} />
                          <span className="text-xs">
                            {t("Glissez un dossier d'images, une vidéo")}
                            {specificFormats.length > 0 ? ` ${t('ou un format spécifique détecté')}` : ''} {t('ici…')}
                          </span>
                          <button
                            onClick={() => fileInputRefs.current.get(slot.id)?.click()}
                            className="text-[11px] text-blue-400 hover:text-blue-300 underline flex-shrink-0"
                          >{t('parcourir local')}</button>
                        </div>
                      )}

                      {!locked && !isImporting && (kind || slots.length > 1) && (
                        <button onClick={() => removeSlot(slot.id)}
                          className="p-1 rounded hover:bg-slate-600/50 text-slate-500 hover:text-red-400 flex-shrink-0 transition-colors">
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>

                    {/* Champ chemin serveur (slot non verrouillé) */}
                    {!locked && (
                      <div className="flex gap-1.5 mt-2">
                        <input
                          type="text"
                          value={slot.serverPath}
                          disabled={isImporting}
                          onChange={(e) => fillSlotPath(slot.id, e.target.value)}
                          placeholder={t('…ou chemin serveur : /mnt/datasets/frames · /data/video.mp4')}
                          data-tour="import-server-path"
                          className="flex-1 bg-slate-900/60 border border-slate-600 focus:border-emerald-500 text-slate-200 text-xs px-2.5 py-1.5 rounded outline-none placeholder:text-slate-600"
                        />
                        <button
                          onClick={() => { setBrowserSlotId(slot.id); setShowBrowser(true) }}
                          disabled={isImporting}
                          className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-slate-300 bg-slate-700 hover:bg-slate-600 border border-slate-600 rounded transition-colors disabled:opacity-40">
                          <Search size={11} /> {t('Serveur')}
                        </button>
                        <input
                          ref={(el) => { if (el) fileInputRefs.current.set(slot.id, el) }}
                          type="file" multiple
                          accept={`image/*,${VIDEO_EXTS.map((e) => `.${e}`).join(',')},${specificFormats.flatMap((f) => f.extensions).join(',')}`}
                          onChange={(e) => { if (e.target.files?.length) fillSlotFiles(slot.id, Array.from(e.target.files)) }}
                          className="hidden"
                        />
                      </div>
                    )}

                    {/* Nom de séquence (repris tel quel à l'export : sous-dossier
                        YOLO / fichier .ver). Vide = auto d'après le dossier/fichier. */}
                    {!locked && kind && (
                      <div className="flex items-center gap-1.5 mt-1.5">
                        <span className="text-[10px] text-slate-500 flex-shrink-0">{t('Nom séquence')}</span>
                        <input
                          type="text"
                          value={slot.name}
                          onChange={(e) => setSlots((prev) => prev.map((s) => s.id === slot.id ? { ...s, name: e.target.value } : s))}
                          placeholder={autoName(slot)}
                          data-tour="import-seq-name"
                          className="flex-1 bg-slate-900/60 border border-slate-700 focus:border-blue-500 text-slate-300 text-[11px] px-2 py-1 rounded outline-none placeholder:text-slate-600"
                        />
                      </div>
                    )}

                    {/* Progression du slot */}
                    {(slot.status === 'running' || slot.status === 'done' || slot.status === 'error') && (
                      <div className="mt-2">
                        <div className="w-full bg-slate-700 rounded-full h-1">
                          <div className={`h-1 rounded-full transition-all ${
                            slot.status === 'done' ? 'bg-green-500' : slot.status === 'error' ? 'bg-red-500' : 'bg-blue-500'
                          }`} style={{ width: `${slot.progress}%` }} />
                        </div>
                        <p className={`text-[11px] mt-1 ${slot.status === 'error' ? 'text-red-400' : 'text-slate-500'}`}>
                          {slot.message}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {/* ===== OPTIONS D'OPTIMISATION ===== */}
          <div className="mt-3 border border-slate-700 rounded-lg overflow-hidden">
            <button onClick={() => setShowAdvanced(!showAdvanced)}
              className="w-full flex items-center justify-between px-3 py-2 text-xs text-slate-400 hover:bg-slate-700/40 transition-colors">
              <span className="flex items-center gap-1.5"><Settings2 size={11} /> {t("Options d'optimisation (appliquées à chaque séquence)")}</span>
              <span className="text-slate-600">{showAdvanced ? '▲' : '▼'}</span>
            </button>
            {showAdvanced && (
              <div className="px-3 pb-3 pt-1 bg-slate-900/30 space-y-3">
                <div className="rounded border border-slate-700/70 bg-slate-800/40 px-2 py-1.5 text-xs text-slate-500 leading-relaxed">
                  <strong className="text-slate-400">{t('Dossiers images serveur')}</strong> : {t('symlink = zéro copie, démarrage immédiat.')}<br />
                  <strong className="text-slate-400">MP4</strong> : {t("décimation 1/N + qualité JPEG = volume disque et vitesse d'extraction.")}<br />
                  <strong className="text-slate-400">16-bit</strong> : {t("PNG/TIFF 16 bits — source conservée en 16 bits ; l'affichage ET l'IA passent par la LUT (défaut 3-sigma, réglable par séquence via le bouton LUT).")}
                </div>

                {/* Décimation vidéo */}
                <div>
                  <label className="text-xs text-slate-400 block mb-1.5">{t('Décimation des frames vidéo')}</label>
                  <div className="flex gap-1.5 flex-wrap items-center">
                    {([0, 2, 3, 4, 5] as const).map((v) => (
                      <button key={v}
                        onClick={() => { setFrameKeep(v); setShowCustomInput(false) }}
                        className={`px-2.5 py-1 text-xs rounded border transition-colors ${
                          frameKeep === v && !showCustomInput ? 'border-blue-500 bg-blue-900/40 text-blue-300' : 'border-slate-600 text-slate-400 hover:border-slate-500'
                        }`}>{v === 0 ? t('Tout') : `1/${v}`}</button>
                    ))}
                    {!showCustomInput
                      ? <button onClick={() => setShowCustomInput(true)}
                          className="px-2.5 py-1 text-xs rounded border border-slate-600 text-slate-400 hover:border-blue-500 hover:text-blue-300 transition-colors">1/N</button>
                      : <div className="flex items-center gap-1">
                          <span className="text-xs text-slate-400">1/</span>
                          <input autoFocus type="number" min="2" max="999" value={customFrameKeep}
                            onChange={(e) => { setCustomFrameKeep(e.target.value); const n = parseInt(e.target.value); if (!isNaN(n) && n >= 2) setFrameKeep(n) }}
                            placeholder="N"
                            className="w-14 bg-slate-700 border border-blue-500 text-blue-300 text-xs px-2 py-1 rounded outline-none" />
                          <button onClick={() => { setShowCustomInput(false); setCustomFrameKeep('') }}
                            className="text-xs text-slate-500 hover:text-slate-300 px-1">✕</button>
                        </div>
                    }
                  </div>
                </div>

                {/* Qualité JPEG extraction MP4 */}
                <label className="block">
                  <div className="flex justify-between text-xs text-slate-400 mb-1">
                    <span>{t('Qualité JPEG frames extraites (MP4)')}</span>
                    <span className="text-slate-300 font-medium">{jpegQuality}</span>
                  </div>
                  <input type="range" min="50" max="95" step="5" value={jpegQuality}
                    onChange={(e) => setJpegQuality(parseInt(e.target.value))}
                    className="w-full accent-blue-500" />
                </label>

                <label className="flex items-start gap-2 cursor-pointer">
                  <input type="checkbox" checked={lossless} onChange={(e) => setLossless(e.target.checked)} className="accent-blue-500 mt-0.5" />
                  <div>
                    <span className="text-xs text-slate-300">{t('PNG sans perte pour les MP4 (ignore la qualité JPEG)')}</span>
                    <p className="text-xs text-slate-600 mt-0.5">{t('Idéal pour XFeat et flux optique. Plus lourd sur disque.')}</p>
                  </div>
                </label>

                <label className="flex items-start gap-2 cursor-pointer">
                  <input type="checkbox" checked={useSymlink} onChange={(e) => setUseSymlink(e.target.checked)} className="accent-emerald-500 mt-0.5" />
                  <div>
                    <span className="text-xs text-slate-300">{t('Liens symboliques pour les dossiers serveur (recommandé)')}</span>
                    <p className="text-xs text-slate-600 mt-0.5">{t("Aucune copie des images. Si les symlinks sont interdits, l'app copie automatiquement.")}</p>
                  </div>
                </label>

                {/* Batch extraction */}
                <label className="block">
                  <div className="flex justify-between text-xs text-slate-400 mb-1">
                    <span>{t('Frames par batch (extraction arrière-plan)')}</span>
                    <span className="text-slate-300 font-medium">{extractionBatchSize}</span>
                  </div>
                  <input type="range" min="1" max="200" step="1" value={extractionBatchSize}
                    onChange={(e) => setExtractionBatchSize(parseInt(e.target.value))}
                    className="w-full accent-blue-500" />
                </label>
              </div>
            )}
          </div>

          <p className="mt-3 text-xs text-slate-500 text-center">
            {t("L'import se fait en tâche de fond : le modal se ferme et vous pouvez annoter pendant le chargement (barre de progression par séquence en bas d'écran).")}
          </p>

          {error && <p className="text-xs text-red-400 mt-2 text-center">{error}</p>}

          {/* Actions */}
          <div className="flex gap-2 mt-4">
            <button
              onClick={onClose}
              className="flex-1 py-2 text-sm text-slate-300 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors">
              {t('Fermer')}
            </button>
            <button onClick={handleImportAll} disabled={readyCount === 0}
              data-tour="import-submit"
              className="flex-1 py-2 text-sm text-white bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-500 rounded-lg transition-colors">
              {t('Importer')} {readyCount > 0 ? `${readyCount} ${t('séquence')}${readyCount > 1 ? 's' : ''}` : ''} {t('en fond')}
            </button>
          </div>
        </div>
      </div>

      {browserSlotId !== null && (
        <FileBrowserModal
          isOpen={showBrowser}
          title={t("Choisir un dossier d'images ou une vidéo (serveur)")}
          filterType="all"
          selectDir={true}
          onSelect={(p) => { fillSlotPath(browserSlotId, p); setShowBrowser(false); setBrowserSlotId(null) }}
          onClose={() => { setShowBrowser(false); setBrowserSlotId(null) }}
        />
      )}
    </>
  )
}
