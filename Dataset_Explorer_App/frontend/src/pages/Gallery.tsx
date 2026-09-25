// ============================================================
// pages/Gallery.tsx
// Dataset Gallery — point d'entrée principal.
//
// Deux sections :
//   - Datasets globaux (is_global=True) — visibles dans TOUS les workspaces,
//     stockés dans data/dataset_gallery/, miniatures fixes.
//   - Mon workspace (is_global=False) — propres à ce workspace.
//
// Datasets globaux :
//   - in_workspace=True  → déjà importé, peut être épinglé directement.
//   - in_workspace=False → pas encore dans ce workspace → bouton "Utiliser ici"
//     qui re-scanne le chemin et importe automatiquement.
// ============================================================

import { useState } from 'react'
import toast from 'react-hot-toast'
import {
  Image as ImageIcon, Plus, Trash2, Globe, HardDrive, Share2,
  ChevronDown, ChevronUp, Pin, PinOff, Loader2,
  Download, RefreshCw, Folder as FolderIcon, FolderOpen, FolderPlus,
  Search, X, FileText, ArrowDownWideNarrow, Percent, Hash, Merge,
  AlertTriangle,
} from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { datasetsAPI, foldersAPI, metadataAPI, settingsAPI, startMergeFiltered } from '../api/client'
import { useDatasets } from '../hooks/useDataset'
import type { DatasetStats, DatasetSummary, Folder, FilterDatasetResult, EmbedEvent } from '../types/api'
import { useSettings } from '../hooks/useSettings'
import { nativeImageUrl } from '../utils/nativeImage'
import { useT } from '../i18n/useLang'

const STATUS_COLOR: Record<string, string> = {
  scanning:  'text-teal-400 bg-teal-400/10 animate-pulse',
  pending:   'text-yellow-400 bg-yellow-400/10',
  embedding: 'text-blue-400 bg-blue-400/10 animate-pulse',
  ready:     'text-green-400 bg-green-400/10',
  error:     'text-red-400 bg-red-400/10',
}

function fmt_bytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}

export default function Gallery() {
  const t = useT()
  const qc = useQueryClient()
  const { data: datasets = [], isLoading } = useDatasets()
  const { settings, refresh: refreshSettings } = useSettings()

  const pinnedIds = new Set(settings?.playground_dataset_ids ?? [])

  // ---- Dossiers (step 3) ----
  const { data: folders = [] } = useQuery({ queryKey: ['folders'], queryFn: foldersAPI.list })
  const [expandedFolders, setExpandedFolders] = useState<Set<number>>(new Set())

  // ---- Formulaire d'ajout ----
  const [rootPath, setRootPath] = useState('')
  const [datasetName, setDatasetName] = useState('')
  const [nClusters, setNClusters] = useState(20)
  const [shareDataset, setShareDataset] = useState(false)
  const [creating, setCreating] = useState(false)
  const [targetFolderId, setTargetFolderId] = useState<number | null>(null)
  const [annotationPath, setAnnotationPath] = useState('')
  const [annotationName, setAnnotationName] = useState('')

  // ---- Métadonnées CSV/Excel (associées à l'import) ----
  const [metadataPath, setMetadataPath] = useState('')
  const [metaColumns, setMetaColumns] = useState<string[]>([])
  // Colonnes de ce CSV rapprochées de colonnes déjà utilisées ailleurs
  const [metaMapping, setMetaMapping] = useState<
    { column: string; suggested: string; score: number }[]
  >([])
  const [metaKeyColumn, setMetaKeyColumn] = useState('')
  const [analyzingMeta, setAnalyzingMeta] = useState(false)

  // ---- Filtrage CLIP (refonte : classement des datasets par pertinence) ----
  const [filterKeyword, setFilterKeyword] = useState('')
  const [threshold, setThreshold] = useState(0.25)          // seuil de matching [0,1]
  const [mode, setMode] = useState<'union' | 'intersection'>('union')
  const [ranking, setRanking] = useState<'absolute' | 'relative'>('absolute')
  const [clipResults, setClipResults] = useState<FilterDatasetResult[] | null>(null)
  const [clipTerms, setClipTerms] = useState<string[]>([])
  const [filtering, setFiltering] = useState(false)
  const [annotationsOnly, setAnnotationsOnly] = useState(false)

  // ---- Merge filtré vers le Playground (step 6) ----
  const [mergeName, setMergeName] = useState('')
  const [mergeProgress, setMergeProgress] = useState<EmbedEvent | null>(null)
  const [merging, setMerging] = useState(false)


  // ---- Dépliage des cards ----
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  // ---- Import en cours (global → workspace) ----
  const [importing, setImporting] = useState<Set<string>>(new Set())

  // ---- Avertissement doublon (même root_path déjà connu sous un autre nom) ----
  const [duplicateWarning, setDuplicateWarning] = useState<
    { id: number; name: string; image_count: number; status: string }[] | null
  >(null)

  // Tous les datasets globaux → section "Galerie globale" (même si déjà importés)
  const globalDatasets = datasets.filter(d => d.is_global)
  // Tous les datasets présents dans ce workspace (locaux + globaux importés) → section "Mon workspace"
  const workspaceDatasets = datasets.filter(d => d.in_workspace)

  // `allowDuplicate` : le serveur refuse desormais (409) un dossier deja indexe.
  // On ne repasse en force que depuis la boite d'avertissement, quand
  // l'utilisateur a vu sous quel nom ce dossier existe deja.
  const doCreate = async (allowDuplicate = false) => {
    setCreating(true)
    try {
      await datasetsAPI.create({
        root_path: rootPath.trim(),
        name: datasetName.trim() || undefined,
        n_clusters: nClusters,
        share_dataset: shareDataset,
        folder_id: targetFolderId,
        annotation_path: annotationPath.trim() || null,
        annotation_name: annotationName.trim() || null,
        metadata_path: metadataPath.trim() || null,
        metadata_key_column: metaKeyColumn || null,
        allow_duplicate: allowDuplicate,
      })
      toast.success(shareDataset
        ? t('Dataset partagé créé dans la galerie globale')
        : t('Dataset créé — scan en cours...'))
      setRootPath('')
      setDatasetName('')
      setShareDataset(false)
      setAnnotationPath('')
      setAnnotationName('')
      setMetadataPath('')
      setMetaColumns([])
      setMetaKeyColumn('')
      qc.invalidateQueries({ queryKey: ['datasets'] })
    } catch (e: unknown) {
      const err = e as { response?: { status?: number; data?: { detail?: unknown } } }
      const detail = err?.response?.data?.detail
      // 409 = meme root_path deja indexe : on reaffiche l'avertissement plutot
      // qu'un toast d'erreur, l'utilisateur peut alors confirmer sciemment.
      if (err?.response?.status === 409 && detail && typeof detail === 'object') {
        const d = detail as { existing_dataset_id?: number; existing_dataset_name?: string }
        setDuplicateWarning([{
          id: d.existing_dataset_id ?? 0,
          name: d.existing_dataset_name ?? '(inconnu)',
          image_count: 0,
          status: 'existant',
        }])
        setCreating(false)
        return
      }
      const msg = typeof detail === 'string' ? detail : String(e)
      toast.error(`${t('Erreur')} : ${msg}`)
    } finally {
      setCreating(false)
      setDuplicateWarning(null)
    }
  }

  const handleCreate = async () => {
    if (!rootPath.trim()) return toast.error(t('Chemin requis'))
    // Avertir si ce chemin est déjà connu sous un autre nom (même dossier importé
    // deux fois) — l'utilisateur choisit de continuer ou d'annuler avant de créer
    // un 2e dataset qui rescannerait/ré-embedderait les mêmes images.
    try {
      const matches = await datasetsAPI.checkPath(rootPath.trim())
      if (matches.length > 0) {
        setDuplicateWarning(matches)
        return
      }
    } catch {
      // Check best-effort : si l'appel échoue, ne bloque pas la création.
    }
    await doCreate()
  }

  // Drag & drop d'un dossier depuis l'Explorateur -> chemin OS réel via le
  // pont Electron (webUtils.getPathForFile côté preload), pas de lecture de
  // fichier : indispensable pour un dossier sur un partage SMB (\\<share-host>\...)
  // qu'aucune autre UI (pas de sélecteur de fichiers ici) ne permettait de
  // saisir autrement qu'en tapant le chemin à la main.
  const handleDropRootPath = (e: React.DragEvent<HTMLInputElement>) => {
    e.preventDefault()
    const nativeGetPath = (window as unknown as {
      __CV_NATIVE_MOUNT__?: { getPathForFile?: (f: File) => string }
    }).__CV_NATIVE_MOUNT__?.getPathForFile
    const dropped = e.dataTransfer.files[0]
    const realPath = dropped && nativeGetPath?.(dropped)
    if (realPath) setRootPath(realPath)
  }

  const handleAnalyzeMeta = async () => {
    if (!metadataPath.trim()) return toast.error(t('Chemin du fichier requis'))
    setAnalyzingMeta(true)
    try {
      const res = await datasetsAPI.metadataPreview(metadataPath.trim())
      setMetaColumns(res.columns)

      // Colonne clé + rapprochement avec les colonnes déjà présentes dans le
      // catalogue : c'est ici que se joue le cas "deux CSV décrivant la même
      // chose avec des en-têtes différents".
      let guess = res.columns.find(c => /file|image|nom|name|path/i.test(c)) ?? res.columns[0] ?? ''
      let mappingNote = ''
      try {
        const sug = await metadataAPI.suggestMapping(res.columns)
        if (sug.suggested_key_column) guess = sug.suggested_key_column
        const pairs = Object.entries(sug.mapping)
        setMetaMapping(pairs.map(([col, m]) => ({ column: col, suggested: m.suggested, score: m.score })))
        if (pairs.length) {
          mappingNote = ` · ${pairs.length} ${t('colonne(s) rapprochée(s) du catalogue')}`
        }
      } catch {
        // Suggestion best-effort : sans elle on garde la devinette locale.
        setMetaMapping([])
      }

      setMetaKeyColumn(guess)
      toast.success(`${res.columns.length} ${t('colonnes')} · ${res.n_rows} ${t('lignes')}${mappingNote}`)
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? String(e)
      toast.error(`${t('Erreur lecture')} : ${msg}`)
      setMetaColumns([])
    } finally {
      setAnalyzingMeta(false)
    }
  }

  // ---- Handlers dossiers (step 3) ----
  const handleCreateFolder = async (parentId: number | null, isGlobal: boolean) => {
    const name = window.prompt(isGlobal ? t('Nom du dossier partagé :') : t('Nom du dossier :'))
    if (!name || !name.trim()) return
    try {
      await foldersAPI.create({ name: name.trim(), parent_id: parentId, is_global: isGlobal })
      qc.invalidateQueries({ queryKey: ['folders'] })
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? String(e)
      toast.error(`${t('Erreur dossier')} : ${msg}`)
    }
  }

  const handleDeleteFolder = async (folder: Folder) => {
    if (!confirm(`${t('Supprimer le dossier')} "${folder.name}" ?\n${t('Les sous-dossiers et datasets sont remontés au parent.')}`)) return
    try {
      await foldersAPI.delete(folder.id)
      qc.invalidateQueries({ queryKey: ['folders'] })
      qc.invalidateQueries({ queryKey: ['datasets'] })
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? String(e)
      toast.error(`${t('Erreur')} : ${msg}`)
    }
  }

  const handleMoveDataset = async (ds: DatasetSummary, folderId: number | null) => {
    if (ds.id < 0) return toast.error(t('Importez ce dataset avant de le ranger'))
    try {
      await datasetsAPI.moveToFolder(ds.id, folderId)
      qc.invalidateQueries({ queryKey: ['datasets'] })
      qc.invalidateQueries({ queryKey: ['folders'] })
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? String(e)
      toast.error(`${t('Erreur déplacement')} : ${msg}`)
    }
  }

  const toggleFolder = (id: number) =>
    setExpandedFolders(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })

  // ---- Filtrage CLIP : classe les datasets embeddés par pertinence ----
  const parseTerms = (raw: string) => raw.split(',').map(t => t.trim()).filter(Boolean)

  const handleFilter = async () => {
    const terms = parseTerms(filterKeyword)
    if (terms.length === 0) { setClipResults(null); setClipTerms([]); return }
    setFiltering(true)
    try {
      const res = await datasetsAPI.filterByText({ queries: terms, threshold, mode, top_thumbs: 5 })
      setClipResults(res.results)
      setClipTerms(res.terms)
      if (res.results.length === 0) toast(t('Aucun dataset ne correspond au-dessus du seuil'))
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? String(e)
      toast.error(`${t('Erreur filtrage')} : ${msg}`)
    } finally {
      setFiltering(false)
    }
  }
  const clearFilter = () => { setFilterKeyword(''); setClipResults(null); setClipTerms([]); setMergeProgress(null) }

  // Résultats triés selon le mode de ranking choisi (absolu vs relatif)
  const rankedResults = clipResults
    ? [...clipResults].sort((a, b) =>
        ranking === 'relative' ? b.percent - a.percent : b.matched_count - a.matched_count)
    : []
  const totalRetained = rankedResults.reduce((s, r) => s + r.matched_count, 0)

  const handleMergeFiltered = () => {
    if (!clipResults || clipResults.length === 0) return
    const name = mergeName.trim() || `filtered_${clipTerms.join('_')}`
    setMerging(true)
    setMergeProgress(null)
    startMergeFiltered(
      {
        sourceIds: clipResults.map(r => r.dataset_id).filter(id => id > 0),
        name,
        queries: clipTerms,
        threshold,
        mode,
        nClusters: 20,
      },
      (evt) => {
        setMergeProgress(evt)
        if (evt.type === 'done') {
          toast.success(`${t('Dataset filtré')} "${name}" ${t('créé dans le workspace')}`)
          qc.invalidateQueries({ queryKey: ['datasets'] })
          setMerging(false)
          setMergeName('')
        }
        if (evt.type === 'error') {
          toast.error(`${t('Erreur merge')} : ${(evt as { message: string }).message}`)
          setMerging(false)
        }
      },
      () => setMerging(false),
    )
  }

  const filtersActive = annotationsOnly

  // Filtre "avec annotations" pour les sections de navigation classiques
  const applyFilters = (list: DatasetSummary[]): DatasetSummary[] =>
    annotationsOnly ? list.filter(d => d.has_annotations) : list

  const handleDelete = async (ds: DatasetSummary) => {
    if (!ds.in_workspace) return toast.error(t('Ce dataset n\'est pas encore dans votre workspace'))
    const msg = ds.is_global
      ? `${t('Retirer')} "${ds.name}" ${t('de ce workspace ?')}\n${t('(Le dataset restera visible dans la galerie globale.)')}`
      : `${t('Supprimer définitivement')} "${ds.name}" ?`
    if (!confirm(msg)) return
    await datasetsAPI.delete(ds.id)
    if (pinnedIds.has(ds.id) && settings) {
      const next = settings.playground_dataset_ids.filter(id => id !== ds.id)
      await settingsAPI.update({ ...settings, playground_dataset_ids: next })
      refreshSettings()
    }
    toast.success(t('Dataset supprimé'))
    qc.invalidateQueries({ queryKey: ['datasets'] })
  }

  const handleDeleteGlobal = async (ds: DatasetSummary) => {
    if (!confirm(`${t('Supprimer définitivement')} "${ds.name}" ${t('de la galerie globale ?')}\n${t('Cette action est irréversible.')}`)) return
    try {
      await datasetsAPI.deleteGlobal(ds.root_path)
      toast.success(`"${ds.name}" ${t('supprimé de la galerie globale')}`)
      qc.invalidateQueries({ queryKey: ['datasets'] })
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? String(e)
      toast.error(`${t('Erreur')} : ${msg}`)
    }
  }

  const togglePin = async (ds: DatasetSummary) => {
    if (!settings) return
    if (!ds.in_workspace) return  // ne devrait pas arriver, utiliser handleImport
    const current = settings.playground_dataset_ids
    const next = pinnedIds.has(ds.id)
      ? current.filter(id => id !== ds.id)
      : [...current, ds.id]
    try {
      await settingsAPI.update({ ...settings, playground_dataset_ids: next })
      refreshSettings()
      toast.success(pinnedIds.has(ds.id)
        ? `"${ds.name}" ${t('retiré du Playground')}`
        : `"${ds.name}" ${t('ajouté au Playground')}`)
    } catch {
      toast.error(t('Erreur mise à jour playground'))
    }
  }

  /** Importe un dataset global dans le workspace courant (sans épingler automatiquement). */
  const handleImport = async (ds: DatasetSummary) => {
    const key = ds.root_path
    setImporting(prev => new Set([...prev, key]))
    try {
      await datasetsAPI.create({
        root_path: ds.root_path,
        name: ds.name,
        n_clusters: ds.n_clusters,
        share_dataset: true,   // reste global
      })
      toast.success(`"${ds.name}" ${t('importé dans ce workspace — il apparaît maintenant dans "Mon workspace"')}`)
      qc.invalidateQueries({ queryKey: ['datasets'] })
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? String(e)
      toast.error(`${t('Erreur import')} : ${msg}`)
    } finally {
      setImporting(prev => { const n = new Set(prev); n.delete(key); return n })
    }
  }

  const cardKey = (ds: DatasetSummary) => ds.in_workspace ? `ws-${ds.id}` : `global-${ds.root_path}`

  const toggleExpand = (key: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <div className={`p-6 space-y-8 transition-all ${clipResults !== null ? 'max-w-6xl ml-6 mr-auto' : 'max-w-5xl mx-auto'}`}>
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <ImageIcon size={22} /> Dataset Gallery
        </h1>
        <p className="text-gray-400 mt-1">
          {t('Parcourez et gérez vos datasets. Épinglez-les dans le')}{' '}
          <strong className="text-indigo-400">Dashboard Playground</strong> {t('pour les analyser.')}
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4" data-tour="gallery-stats">
        <StatCard label={t('Dans ce workspace')} value={workspaceDatasets.length} color="text-indigo-400" />
        <StatCard label={t('Globaux disponibles')} value={globalDatasets.filter(d => !d.in_workspace).length} color="text-purple-400" />
        <StatCard label={t('Épinglés dans Playground')} value={pinnedIds.size} color="text-amber-400" />
      </div>

      {/* Ajouter un dataset */}
      <div className="bg-gray-800 rounded-xl p-5 border border-gray-700" data-tour="add-dataset">
        <h2 className="text-base font-semibold text-white mb-4 flex items-center gap-2">
          <Plus size={16} /> {t('Ajouter un dataset')}
        </h2>
        <div className="space-y-3">
          <input
            type="text"
            placeholder={t("Chemin du dossier d'images (ex: C:\\data\\images)")}
            data-tour="dataset-path"
            value={rootPath}
            onChange={e => setRootPath(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleCreate()}
            onDrop={handleDropRootPath}
            onDragOver={e => e.preventDefault()}
            className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:ring-2 focus:ring-indigo-500"
          />
          <div className="flex gap-2 flex-wrap">
            <input
              type="text"
              placeholder={t('Nom (optionnel)')}
              data-tour="dataset-name"
              value={datasetName}
              onChange={e => setDatasetName(e.target.value)}
              className="flex-1 min-w-32 bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:ring-2 focus:ring-indigo-500"
            />
            <div className="flex items-center gap-2 bg-gray-900 border border-gray-600 rounded-lg px-3 py-2"
                 data-tour="dataset-clusters">
              <span className="text-gray-400 text-sm whitespace-nowrap">{t('Clusters :')}</span>
              <input
                type="number" min={2} max={200}
                value={nClusters}
                onChange={e => setNClusters(Number(e.target.value))}
                className="w-16 bg-transparent text-gray-200 text-sm focus:outline-none"
              />
            </div>
            {/* Dossier de destination (step 3) — filtré selon la portée partagé/perso */}
            <select
              value={targetFolderId ?? ''}
              onChange={e => setTargetFolderId(e.target.value === '' ? null : Number(e.target.value))}
              title={t('Dossier de destination')}
              className="bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-300 focus:ring-2 focus:ring-indigo-500 max-w-48"
            >
              <option value="">{t('Racine (aucun dossier)')}</option>
              {folderOptions(folders, shareDataset).map(o => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </select>
            {/* SHARE_DATASET toggle */}
            <button
              onClick={() => setShareDataset(s => !s)}
              data-tour="dataset-share"
              className={`flex items-center gap-2 px-3 py-2 rounded-lg border-2 text-sm transition-all ${
                shareDataset
                  ? 'border-purple-500 bg-purple-600/20 text-purple-300 font-medium'
                  : 'border-gray-600 text-gray-500 hover:border-gray-500'
              }`}
              title={t('Partager ce dataset dans la galerie globale (dossier dans data/dataset_gallery/)')}
            >
              <Share2 size={14} />
              {shareDataset ? t('Partager : ON') : t('Partager')}
            </button>
            <button
              onClick={handleCreate}
              disabled={creating}
              data-tour="dataset-scan"
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors whitespace-nowrap"
            >
              {creating ? t('Scan...') : t('Scanner')}
            </button>
          </div>
          {/* Annotation optionnelle (step 6) */}
          <div className="flex gap-2 flex-wrap">
            <input
              type="text"
              placeholder={t('Annotations (optionnel) : .ver, dossier YOLO, ou .txt')}
              data-tour="dataset-annotations"
              value={annotationPath}
              onChange={e => setAnnotationPath(e.target.value)}
              className="flex-1 min-w-48 bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:ring-2 focus:ring-indigo-500"
            />
            <input
              type="text"
              placeholder={t('Nom des annotations (optionnel)')}
              value={annotationName}
              onChange={e => setAnnotationName(e.target.value)}
              className="w-56 bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          {/* Métadonnées CSV/Excel (optionnel) */}
          <div className="flex gap-2 flex-wrap items-center">
            <input
              type="text"
              placeholder={t('Métadonnées (optionnel) : fichier .csv / .xlsx à associer')}
              data-tour="dataset-metadata"
              value={metadataPath}
              onChange={e => { setMetadataPath(e.target.value); setMetaColumns([]); setMetaKeyColumn('') }}
              className="flex-1 min-w-48 bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:ring-2 focus:ring-indigo-500"
            />
            <button
              onClick={handleAnalyzeMeta}
              disabled={analyzingMeta || !metadataPath.trim()}
              className="flex items-center gap-1.5 px-3 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-gray-200 text-sm rounded-lg whitespace-nowrap"
              title={t('Lire les colonnes du fichier')}
            >
              {analyzingMeta ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
              {t('Analyser colonnes')}
            </button>
            {metaColumns.length > 0 && (
              <div className="flex items-center gap-2 bg-gray-900 border border-gray-600 rounded-lg px-3 py-2">
                <span className="text-gray-400 text-sm whitespace-nowrap">{t('Colonne clé :')}</span>
                <select
                  value={metaKeyColumn}
                  onChange={e => setMetaKeyColumn(e.target.value)}
                  title={t('Colonne dont la valeur correspond au nom de fichier image')}
                  className="bg-transparent text-gray-200 text-sm focus:outline-none max-w-40"
                >
                  {metaColumns.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            )}
          </div>
          {metaColumns.length > 0 && (
            <p className="text-gray-500 text-xs">
              {metaColumns.length} {t('colonnes détectées — la')} <strong className="text-gray-300">{t('colonne clé')}</strong>
              {' '}{t('est rapprochée du nom de fichier de chaque image ; les autres colonnes deviennent des métadonnées consultables depuis le')}
              {' '}<strong className="text-gray-300">Catalogue</strong>.
            </p>
          )}
          {metaMapping.length > 0 && (
            <div className="text-xs bg-sky-900/20 border border-sky-700/40 rounded-lg px-3 py-2">
              <p className="text-sky-300">
                {t('Colonnes équivalentes à des colonnes déjà présentes dans le catalogue :')}
              </p>
              <ul className="mt-1 space-y-0.5">
                {metaMapping.map(m => (
                  <li key={m.column} className="text-gray-400">
                    <span className="text-gray-200 font-mono">{m.column}</span>
                    {' ≈ '}
                    <span className="text-sky-300 font-mono">{m.suggested}</span>
                    <span className="text-gray-600"> ({Math.round(m.score * 100)}%)</span>
                  </li>
                ))}
              </ul>
              <p className="text-gray-600 mt-1">
                {t("Information seulement : aucune colonne n'est renommée. Le rapprochement sert à")}
                {' '}{t('retrouver ces images dans le Catalogue même si l\'en-tête diffère.')}
              </p>
            </div>
          )}
          {shareDataset && (
            <p className="text-purple-400/70 text-xs flex items-center gap-1.5">
              <Globe size={11} />
              {t('Un dossier sera créé dans')} <code className="text-purple-300/80">data/dataset_gallery/{datasetName || t('nom')}/</code>.
              {' '}{t('5 miniatures seront copiées pour la prévisualisation dans tous les workspaces.')}
            </p>
          )}
        </div>
      </div>

      {/* Filtrage CLIP — classe les datasets embeddés par pertinence */}
      <div className="bg-gray-800 rounded-xl p-4 border border-gray-700 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Search size={16} className="text-indigo-400" />
          <input
            type="text"
            placeholder={t('Requête CLIP — plusieurs termes séparés par des virgules (ex : drone, forest, night, car)…')}
            data-tour="gallery-clip-search"
            value={filterKeyword}
            onChange={e => setFilterKeyword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleFilter()}
            className="flex-1 min-w-64 bg-gray-900 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-gray-200 placeholder-gray-500 focus:ring-2 focus:ring-indigo-500"
          />
          {/* Mode OR / AND */}
          <div className="flex rounded-lg overflow-hidden border border-gray-600">
            <button onClick={() => setMode('union')}
              className={`px-2.5 py-1.5 text-xs font-medium transition-colors ${mode === 'union' ? 'bg-indigo-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
              title={t("Union : image proche d'AU MOINS un terme")}>OR</button>
            <button onClick={() => setMode('intersection')}
              className={`px-2.5 py-1.5 text-xs font-medium transition-colors ${mode === 'intersection' ? 'bg-indigo-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
              title={t('Intersection : image proche de TOUS les termes')}>AND</button>
          </div>
          <button onClick={handleFilter} disabled={filtering}
            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm rounded-lg whitespace-nowrap">
            {filtering ? '…' : t('Filtrer')}
          </button>
          {clipResults !== null && (
            <button onClick={clearFilter}
              className="flex items-center gap-1 px-2 py-1.5 text-xs text-gray-400 hover:text-white border border-gray-600 rounded-lg">
              <X size={12} /> {t('Effacer')}
            </button>
          )}
          <button onClick={() => setAnnotationsOnly(a => !a)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border transition-colors ${
              annotationsOnly ? 'bg-emerald-600/20 text-emerald-300 border-emerald-600/40' : 'text-gray-400 border-gray-600 hover:border-gray-500'
            }`}>
            <FileText size={13} /> {t('Avec annotations')}
          </button>
        </div>
        {/* Seuil de matching CLIP */}
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-gray-400 text-xs whitespace-nowrap">{t('Seuil de matching')}</span>
          <input type="range" min={0} max={1} step={0.01} value={threshold}
            onChange={e => setThreshold(Number(e.target.value))}
            className="w-48 accent-indigo-500" />
          <span className="text-indigo-300 text-xs font-mono w-12">{Math.round(threshold * 100)}%</span>
          <span className="text-gray-600 text-xs">
            {t('Une image compte si son score CLIP dépasse ce seuil.')}
          </span>
        </div>
      </div>

      {isLoading && <p className="text-gray-500">{t('Chargement...')}</p>}

      {/* Résultats du filtrage CLIP — remplace les sections tant qu'un filtre est actif */}
      {clipResults !== null && (
        <ClipResults
          results={rankedResults}
          terms={clipTerms}
          ranking={ranking}
          onRankingChange={setRanking}
          totalRetained={totalRetained}
          mergeName={mergeName}
          onMergeNameChange={setMergeName}
          onMerge={handleMergeFiltered}
          merging={merging}
          mergeProgress={mergeProgress}
        />
      )}

      {/* Sections de navigation classiques — masquées pendant un filtrage CLIP */}
      {clipResults === null && (
      <>
      {/* Section galerie globale — toujours visible, même si les datasets sont dans le workspace */}
      <DatasetSection
        title={t('Galerie globale')}
        subtitle={t('Datasets partagés (data/dataset_gallery) — indépendants du workspace, toujours visibles')}
        icon={<Globe size={16} className="text-purple-400" />}
        datasets={applyFilters(globalDatasets)}
        pinnedIds={pinnedIds}
        expanded={expanded}
        importing={importing}
        currentUser={settings?.user_name ?? null}
        isGlobalSection
        cardKey={cardKey}
        onTogglePin={togglePin}
        onToggleExpand={toggleExpand}
        onDelete={handleDelete}
        onDeleteGlobal={handleDeleteGlobal}
        onImport={handleImport}
        folders={filtersActive ? [] : folders.filter(f => f.is_global)}
        expandedFolders={expandedFolders}
        onToggleFolder={toggleFolder}
        onCreateFolder={handleCreateFolder}
        onDeleteFolder={handleDeleteFolder}
        onMoveDataset={handleMoveDataset}
        emptyMessage={t("Aucun dataset global. Créez-en un avec 'Partager : ON' pour qu'il soit visible dans tous les workspaces.")}
      />

      {/* Section workspace utilisateur — tous les datasets présents dans ce workspace */}
      <DatasetSection
        title={t('Mon workspace')}
        subtitle={t('Tous vos datasets locaux — épinglez-les dans le Playground pour les analyser')}
        icon={<HardDrive size={16} className="text-indigo-400" />}
        datasets={applyFilters(workspaceDatasets)}
        pinnedIds={pinnedIds}
        expanded={expanded}
        importing={importing}
        currentUser={settings?.user_name ?? null}
        cardKey={cardKey}
        onTogglePin={togglePin}
        onToggleExpand={toggleExpand}
        onDelete={handleDelete}
        onDeleteGlobal={handleDeleteGlobal}
        onImport={handleImport}
        folders={filtersActive ? [] : folders.filter(f => !f.is_global)}
        expandedFolders={expandedFolders}
        onToggleFolder={toggleFolder}
        onCreateFolder={handleCreateFolder}
        onDeleteFolder={handleDeleteFolder}
        onMoveDataset={handleMoveDataset}
        emptyMessage={t('Aucun dataset dans votre workspace. Ajoutez-en un ci-dessus ou importez un dataset global.')}
      />
      </>
      )}

      {duplicateWarning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-lg shadow-2xl">
            <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-700">
              <AlertTriangle size={18} className="text-amber-400 shrink-0" />
              <h2 className="text-base font-bold text-white flex-1">{t('Chemin déjà connu')}</h2>
              <button onClick={() => setDuplicateWarning(null)} className="text-gray-500 hover:text-white">
                <X size={16} />
              </button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <p className="text-sm text-gray-300">
                {t('Ce dossier est déjà enregistré sous')} {duplicateWarning.length > 1 ? t('ces noms') : t('ce nom')} :
              </p>
              <ul className="space-y-1.5">
                {duplicateWarning.map(d => (
                  <li key={d.id} className="flex items-center justify-between bg-gray-800 rounded-lg px-3 py-2 text-sm">
                    <span className="text-white font-medium">{d.name}</span>
                    <span className="text-gray-500 text-xs">#{d.id} · {d.image_count} img · {d.status}</span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-gray-500">
                {t('Continuer créera un dataset séparé (nouveau scan + ré-embedding CLIP complet des mêmes images).')}
              </p>
            </div>
            <div className="flex justify-end gap-2 px-5 py-4 border-t border-gray-700">
              <button
                onClick={() => setDuplicateWarning(null)}
                className="px-3 py-1.5 rounded-lg text-sm text-gray-300 hover:bg-gray-800"
              >
                {t('Annuler')}
              </button>
              <button
                onClick={() => doCreate(true)}
                disabled={creating}
                className="px-3 py-1.5 rounded-lg text-sm bg-amber-600 hover:bg-amber-500 text-white font-medium disabled:opacity-50"
              >
                {creating ? t('Création…') : t('Continuer quand même')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ---- Panneau de résultats du filtrage CLIP ----
function ClipResults({
  results, terms, ranking, onRankingChange, totalRetained,
  mergeName, onMergeNameChange, onMerge, merging, mergeProgress,
}: {
  results: FilterDatasetResult[]
  terms: string[]
  ranking: 'absolute' | 'relative'
  onRankingChange: (r: 'absolute' | 'relative') => void
  totalRetained: number
  mergeName: string
  onMergeNameChange: (v: string) => void
  onMerge: () => void
  merging: boolean
  mergeProgress: EmbedEvent | null
}) {
  const t = useT()
  const progressInfo = mergeProgress?.type === 'progress' ? mergeProgress : null
  return (
    <div className="space-y-3">
      {/* En-tête : ranking + merge filtré */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <ArrowDownWideNarrow size={16} className="text-indigo-400" />
          <span className="text-white text-sm font-semibold">
            {results.length} {t('dataset(s) pertinent(s)')}
          </span>
          <span className="text-gray-500 text-xs">· {t('termes')} : {terms.join(', ')}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-gray-500 text-xs">{t('Trier par')}</span>
          <div className="flex rounded-lg overflow-hidden border border-gray-600">
            <button onClick={() => onRankingChange('absolute')}
              className={`flex items-center gap-1 px-2.5 py-1.5 text-xs transition-colors ${ranking === 'absolute' ? 'bg-indigo-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
              title={t("Nombre d'images matchées")}>
              <Hash size={12} /> {t('Absolu')}
            </button>
            <button onClick={() => onRankingChange('relative')}
              className={`flex items-center gap-1 px-2.5 py-1.5 text-xs transition-colors ${ranking === 'relative' ? 'bg-indigo-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
              title={t("Pourcentage d'images matchées")}>
              <Percent size={12} /> {t('Relatif')}
            </button>
          </div>
        </div>
      </div>

      {/* Merge filtré vers le Playground */}
      {results.length > 0 && (
        <div className="bg-purple-900/20 border border-purple-600/40 rounded-xl p-3 flex items-center gap-3 flex-wrap">
          <Merge size={15} className="text-purple-300 flex-shrink-0" />
          <span className="text-purple-200 text-sm">
            {t('Total retenu')} : <strong>{totalRetained}</strong> {t('images (score > seuil)')}
          </span>
          <input type="text" placeholder={t('Nom du dataset filtré…')} value={mergeName}
            onChange={e => onMergeNameChange(e.target.value)}
            className="flex-1 min-w-40 bg-gray-900 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-gray-200 placeholder-gray-500" />
          <button onClick={onMerge} disabled={merging || totalRetained === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-sm rounded-lg whitespace-nowrap">
            {merging ? <Loader2 size={14} className="animate-spin" /> : <Merge size={14} />}
            {merging ? t('Fusion...') : t('Merge filtré → Playground')}
          </button>
          {progressInfo && (
            <div className="w-full">
              <div className="flex justify-between text-xs text-purple-300/80 mb-1">
                <span>{t('Phase')} : {progressInfo.phase}</span>
                <span>{progressInfo.current}/{progressInfo.total}</span>
              </div>
              <div className="w-full bg-gray-700 rounded-full h-1.5">
                <div className="bg-purple-500 h-1.5 rounded-full transition-all"
                  style={{ width: `${Math.round((progressInfo.current / Math.max(progressInfo.total, 1)) * 100)}%` }} />
              </div>
            </div>
          )}
        </div>
      )}

      {results.length === 0 && (
        <p className="text-gray-500 text-sm py-6 text-center">
          {t('Aucun dataset ne dépasse le seuil. Baissez le seuil ou changez de mode (OR/AND).')}
        </p>
      )}

      {/* Cartes de résultats — comptes à gauche, 5 meilleures images à droite */}
      {results.map((r, i) => (
        <div key={r.dataset_id} className="bg-gray-800 rounded-xl border border-gray-700 p-4 flex items-center gap-4">
          <div className="flex-shrink-0 w-44">
            <div className="flex items-center gap-2">
              <span className="text-indigo-400 font-bold text-lg">#{i + 1}</span>
              <span className="text-white font-semibold truncate" title={r.name}>{r.name}</span>
            </div>
            <p className="text-gray-300 text-sm mt-1">
              <strong>{r.matched_count}</strong> / {r.total_count} images
            </p>
            <p className="text-2xl font-bold text-indigo-300">{r.percent}%</p>
            <div className="w-full bg-gray-700 rounded-full h-1.5 mt-1">
              <div className="bg-indigo-500 h-1.5 rounded-full" style={{ width: `${r.percent}%` }} />
            </div>
          </div>
          {/* 5 meilleures images (scores CLIP les plus hauts) */}
          <div className="flex gap-2 flex-1 overflow-hidden">
            {r.top_images.map(img => (
              <div key={img.image_id} className="relative flex-shrink-0">
                <img
                  src={nativeImageUrl(`/api/images/${img.image_id}/thumb`, `/api/images/${img.image_id}/thumb-path`)}
                  alt={`score ${img.score}`}
                  className="w-24 h-20 rounded-lg object-cover border border-gray-700"
                  loading="lazy"
                  onError={e => { (e.target as HTMLImageElement).style.visibility = 'hidden' }}
                />
                <span className="absolute bottom-0.5 right-0.5 px-1 py-0.5 bg-black/70 text-indigo-200 text-[10px] rounded font-mono">
                  {Math.round(img.score * 100)}%
                </span>
              </div>
            ))}
            {r.top_images.length === 0 && (
              <span className="text-gray-600 text-xs self-center">{t('Aperçu indisponible')}</span>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

// ---- Helpers dossiers ----
type FolderOpt = { id: number; label: string }

/** Options aplaties (indentées par profondeur) filtrées par portée. */
function folderOptions(folders: Folder[], isGlobal: boolean): FolderOpt[] {
  const scoped = folders.filter(f => f.is_global === isGlobal)
  const byParent = new Map<number | null, Folder[]>()
  for (const f of scoped) {
    const k = f.parent_id ?? null
    if (!byParent.has(k)) byParent.set(k, [])
    byParent.get(k)!.push(f)
  }
  const out: FolderOpt[] = []
  const walk = (parent: number | null, depth: number) => {
    for (const f of (byParent.get(parent) ?? []).sort((a, b) => a.name.localeCompare(b.name))) {
      out.push({ id: f.id, label: `${'  '.repeat(depth)}${depth ? '└ ' : ''}${f.name}` })
      walk(f.id, depth + 1)
    }
  }
  walk(null, 0)
  return out
}

// ---- Section de datasets (avec arborescence de dossiers, step 3) ----
function DatasetSection(props: {
  title: string
  subtitle: string
  icon: React.ReactNode
  datasets: DatasetSummary[]
  pinnedIds: Set<number>
  expanded: Set<string>
  importing: Set<string>
  currentUser: string | null
  isGlobalSection?: boolean
  cardKey: (ds: DatasetSummary) => string
  onTogglePin: (ds: DatasetSummary) => void
  onToggleExpand: (key: string) => void
  onDelete: (ds: DatasetSummary) => void
  onDeleteGlobal: (ds: DatasetSummary) => void
  onImport: (ds: DatasetSummary) => void
  folders: Folder[]
  expandedFolders: Set<number>
  onToggleFolder: (id: number) => void
  onCreateFolder: (parentId: number | null, isGlobal: boolean) => void
  onDeleteFolder: (folder: Folder) => void
  onMoveDataset: (ds: DatasetSummary, folderId: number | null) => void
  emptyMessage?: string
}) {
  const t = useT()
  const { title, subtitle, icon, datasets, folders, isGlobalSection, emptyMessage } = props
  const isGlobal = !!isGlobalSection

  const folderIds = new Set(folders.map(f => f.id))
  const datasetsByFolder = new Map<number, DatasetSummary[]>()
  const rootDatasets: DatasetSummary[] = []
  for (const ds of datasets) {
    if (ds.folder_id != null && folderIds.has(ds.folder_id)) {
      if (!datasetsByFolder.has(ds.folder_id)) datasetsByFolder.set(ds.folder_id, [])
      datasetsByFolder.get(ds.folder_id)!.push(ds)
    } else {
      rootDatasets.push(ds)
    }
  }
  const childFolders = (parentId: number | null) =>
    folders.filter(f => (f.parent_id ?? null) === parentId).sort((a, b) => a.name.localeCompare(b.name))

  const cardProps = {
    ...props, isGlobal,
    folderOpts: folderOptions(folders, isGlobal),
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-white flex items-center gap-2">
            {icon} {title}
          </h2>
          <p className="text-gray-500 text-xs mt-0.5">{subtitle}</p>
        </div>
        <button
          onClick={() => props.onCreateFolder(null, isGlobal)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-gray-700/60 text-gray-300 border border-gray-600 rounded-lg hover:bg-gray-700 transition-colors whitespace-nowrap"
          title={isGlobal ? t('Nouveau dossier partagé (visible dans tous les workspaces)') : t('Nouveau dossier')}
        >
          <FolderPlus size={14} /> {t('Nouveau dossier')}
        </button>
      </div>

      {datasets.length === 0 && folders.length === 0 && emptyMessage && (
        <p className="text-gray-600 text-sm py-4">{emptyMessage}</p>
      )}

      {/* Arborescence de dossiers */}
      {childFolders(null).map(f => (
        <FolderNode key={f.id} folder={f} childFolders={childFolders}
          datasetsByFolder={datasetsByFolder} depth={0} cardProps={cardProps} />
      ))}

      {/* Datasets à la racine de la section */}
      {rootDatasets.map(ds => (
        <DatasetCard key={cardProps.cardKey(ds)} ds={ds} {...cardProps} />
      ))}
    </div>
  )
}

// ---- Noeud de dossier (récursif, dépliable) ----
function FolderNode({ folder, childFolders, datasetsByFolder, depth, cardProps }: {
  folder: Folder
  childFolders: (parentId: number | null) => Folder[]
  datasetsByFolder: Map<number, DatasetSummary[]>
  depth: number
  cardProps: DatasetCardShared
}) {
  const t = useT()
  const expanded = cardProps.expandedFolders.has(folder.id)
  const kids = childFolders(folder.id)
  const dsInside = datasetsByFolder.get(folder.id) ?? []
  const count = dsInside.length
  return (
    <div style={{ marginLeft: depth ? 16 : 0 }} className="space-y-2">
      <div className="flex items-center gap-2 bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2">
        <button onClick={() => cardProps.onToggleFolder(folder.id)}
          className="flex items-center gap-2 text-gray-200 hover:text-white min-w-0">
          {expanded ? <FolderOpen size={16} className="text-amber-400 flex-shrink-0" /> : <FolderIcon size={16} className="text-amber-400 flex-shrink-0" />}
          <span className="font-medium truncate">{folder.name}</span>
          <span className="text-gray-500 text-xs">({count})</span>
          {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>
        <div className="flex-1" />
        <button onClick={() => cardProps.onCreateFolder(folder.id, folder.is_global)}
          className="p-1 text-gray-500 hover:text-gray-200" title={t('Nouveau sous-dossier')}>
          <FolderPlus size={14} />
        </button>
        <button onClick={() => cardProps.onDeleteFolder(folder)}
          className="p-1 text-gray-600 hover:text-red-400" title={t('Supprimer le dossier')}>
          <Trash2 size={14} />
        </button>
      </div>
      {expanded && (
        <div className="space-y-2">
          {kids.map(k => (
            <FolderNode key={k.id} folder={k} childFolders={childFolders}
              datasetsByFolder={datasetsByFolder} depth={depth + 1} cardProps={cardProps} />
          ))}
          <div style={{ marginLeft: 16 }} className="space-y-2">
            {dsInside.map(ds => (
              <DatasetCard key={cardProps.cardKey(ds)} ds={ds} {...cardProps} />
            ))}
            {kids.length === 0 && dsInside.length === 0 && (
              <p className="text-gray-600 text-xs italic py-1">{t('Dossier vide')}</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// Props partagées passées à chaque DatasetCard
type DatasetCardShared = {
  pinnedIds: Set<number>
  expanded: Set<string>
  importing: Set<string>
  currentUser: string | null
  isGlobal: boolean
  cardKey: (ds: DatasetSummary) => string
  onTogglePin: (ds: DatasetSummary) => void
  onToggleExpand: (key: string) => void
  onDelete: (ds: DatasetSummary) => void
  onDeleteGlobal: (ds: DatasetSummary) => void
  onImport: (ds: DatasetSummary) => void
  onMoveDataset: (ds: DatasetSummary, folderId: number | null) => void
  onCreateFolder: (parentId: number | null, isGlobal: boolean) => void
  onDeleteFolder: (folder: Folder) => void
  onToggleFolder: (id: number) => void
  expandedFolders: Set<number>
  folderOpts: FolderOpt[]
}

// ---- Carte d'un dataset ----
function DatasetCard({ ds, pinnedIds, expanded, importing, currentUser, isGlobal,
  cardKey, onTogglePin, onToggleExpand, onDelete, onDeleteGlobal, onImport,
  onMoveDataset, folderOpts,
}: DatasetCardShared & { ds: DatasetSummary }) {
  const t = useT()
  const isGlobalSection = isGlobal
  {
        const key = cardKey(ds)
        const pinned = pinnedIds.has(ds.id)
        const isExp = expanded.has(key)
        const isMerged = ds.root_path.startsWith('merged:')
        const isImporting = importing.has(ds.root_path)

        return (
          <div key={key}
            data-tour-name={ds.name}
            className={`bg-gray-800 rounded-xl border transition-colors ${
              pinned ? 'border-amber-600/40' : 'border-gray-700'
            }`}
          >
            <div className="flex items-center gap-3 p-4">
              {/* Bouton gauche : pin (workspace) ou import/badge (section globale) */}
              {isGlobalSection ? (
                ds.in_workspace ? (
                  /* Déjà dans le workspace — icône check */
                  <span className="flex-shrink-0 text-green-500" title={t('Dans votre workspace')}>
                    <HardDrive size={16} />
                  </span>
                ) : (
                  <button
                    onClick={() => onImport(ds)}
                    disabled={isImporting}
                    className="flex-shrink-0 text-purple-400 hover:text-purple-300 disabled:opacity-50 transition-colors"
                    title={t('Importer dans ce workspace')}
                  >
                    {isImporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                  </button>
                )
              ) : (
                <button
                  onClick={() => onTogglePin(ds)}
                  data-tour="dataset-pin"
                  className={`flex-shrink-0 transition-colors ${
                    pinned ? 'text-amber-400 hover:text-amber-300' : 'text-gray-600 hover:text-amber-400'
                  }`}
                  title={pinned ? t('Retirer du Playground') : t('Épingler dans le Playground')}
                >
                  {pinned ? <Pin size={16} /> : <PinOff size={16} />}
                </button>
              )}

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  {ds.in_workspace && (
                    <span className="text-gray-600 text-xs font-mono">#{ds.id}</span>
                  )}
                  {ds.in_workspace && (
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLOR[ds.status] ?? 'text-gray-400 bg-gray-700'}`}
                      title={ds.status === 'error' && ds.error_message ? ds.error_message : undefined}
                    >
                      {ds.status}
                    </span>
                  )}
                  <h3 className="font-semibold text-white">{ds.name}</h3>
                  {ds.is_global && (
                    <span className="px-1.5 py-0.5 bg-purple-600/20 text-purple-400 text-xs rounded border border-purple-600/30 flex-shrink-0">global</span>
                  )}
                  {isGlobalSection && ds.in_workspace && (
                    <span className="px-1.5 py-0.5 bg-green-600/20 text-green-400 text-xs rounded border border-green-600/30 flex-shrink-0">
                      dans workspace
                    </span>
                  )}
                  {isGlobalSection && !ds.in_workspace && (
                    <span className="px-1.5 py-0.5 bg-blue-600/20 text-blue-400 text-xs rounded border border-blue-600/30 flex-shrink-0">
                      disponible
                    </span>
                  )}
                  {isMerged && (
                    <span className="px-1.5 py-0.5 bg-purple-600/20 text-purple-400 text-xs rounded border border-purple-600/30 flex-shrink-0">merged</span>
                  )}
                  {pinned && (
                    <span className="px-1.5 py-0.5 bg-amber-600/20 text-amber-400 text-xs rounded border border-amber-600/30 flex-shrink-0">Playground</span>
                  )}
                  {ds.duplicate_of.length > 0 && (
                    <span
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-amber-600/20 text-amber-400 text-xs rounded border border-amber-600/30 flex-shrink-0"
                      title={`${t('Même dossier')} (${ds.root_path}) ${t('que')} : ${ds.duplicate_of.map(d => `${d.name} (#${d.id})`).join(', ')}`}
                    >
                      <AlertTriangle size={11} /> {t('doublon de')} {ds.duplicate_of.map(d => d.name).join(', ')}
                    </span>
                  )}
                </div>
                {ds.is_global && ds.added_by && (
                  <span className="text-xs text-gray-500">{t('par')} {ds.added_by}</span>
                )}
                <p className="text-gray-400 text-xs mt-0.5">
                  {ds.status === 'scanning'
                    ? ds.scan_total > 0
                      ? `${t('Scan en cours')} : ${ds.scan_progress}/${ds.scan_total} ${t('images')}`
                      : t('Scan en cours...')
                    : `${ds.image_count} images${ds.in_workspace ? ` · ${ds.embedded_count} embeddings · ${ds.n_clusters} clusters` : ''}`
                  }
                  {ds.rejected_count > 0 && (
                    <span className="text-orange-400 ml-2">· {ds.rejected_count} {t('rejetées')}</span>
                  )}
                </p>
                {/* Badges annotation (step 6) + métadonnées CSV/Excel */}
                {(ds.has_annotations || (ds.metadata_columns?.length ?? 0) > 0) && (
                  <div className="flex items-center gap-1 flex-wrap mt-1">
                    {ds.has_annotations && (
                      <span className="px-1.5 py-0.5 bg-emerald-600/20 text-emerald-300 text-xs rounded border border-emerald-600/30 flex items-center gap-1">
                        <FileText size={10} />
                        {ds.annotation_format === 'ver' ? 'VER' : 'YOLO'}
                        {ds.annotation_name ? ` · ${ds.annotation_name}` : ''}
                        {ds.annotation_boxes != null ? ` · ${ds.annotation_boxes} boxes` : ''}
                      </span>
                    )}
                    {(ds.metadata_columns?.length ?? 0) > 0 && (
                      <span className="px-1.5 py-0.5 bg-sky-600/20 text-sky-300 text-xs rounded border border-sky-600/30 flex items-center gap-1"
                        title={ds.metadata_columns.join(', ')}>
                        <FileText size={10} /> {ds.metadata_columns.length} {t('métadonnées')}
                      </span>
                    )}
                  </div>
                )}
                {ds.status === 'scanning' && ds.scan_total > 0 && (
                  <div className="mt-1.5 w-full bg-gray-700 rounded-full h-1">
                    <div className="bg-teal-500 h-1 rounded-full transition-all"
                      style={{ width: `${Math.round((ds.scan_progress / ds.scan_total) * 100)}%` }} />
                  </div>
                )}
                {/* Génération des thumbnails en tâche de fond (step 7) */}
                {ds.thumb_total > 0 && ds.thumb_progress < ds.thumb_total && (
                  <div className="mt-1.5">
                    <p className="text-cyan-400/80 text-xs">{t('Miniatures')} : {ds.thumb_progress}/{ds.thumb_total}</p>
                    <div className="w-full bg-gray-700 rounded-full h-1 mt-0.5">
                      <div className="bg-cyan-500 h-1 rounded-full transition-all"
                        style={{ width: `${Math.round((ds.thumb_progress / ds.thumb_total) * 100)}%` }} />
                    </div>
                  </div>
                )}
                {/* Miniatures gallery fixes — toujours visibles pour les datasets globaux */}
                {ds.is_global && ds.gallery_thumb_urls && ds.gallery_thumb_urls.length > 0 && (
                  <div className="flex gap-1.5 mt-2">
                    {ds.gallery_thumb_urls.map((url, i) => (
                      <img
                        key={i}
                        src={url}
                        alt={`${t('aperçu')} ${i + 1}`}
                        className="w-10 h-8 rounded object-cover border border-gray-700 flex-shrink-0"
                        loading="lazy"
                      />
                    ))}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                {/* Ranger dans un dossier (step 3) — datasets présents dans ce workspace */}
                {ds.in_workspace && ds.id > 0 && (
                  <select
                    value={ds.folder_id ?? ''}
                    onChange={e => onMoveDataset(ds, e.target.value === '' ? null : Number(e.target.value))}
                    title={t('Ranger dans un dossier')}
                    className="bg-gray-900 border border-gray-600 rounded-lg px-2 py-1 text-xs text-gray-300 focus:ring-1 focus:ring-indigo-500 max-w-36"
                  >
                    <option value="">{t('Racine')}</option>
                    {folderOpts.map(o => (
                      <option key={o.id} value={o.id}>{o.label}</option>
                    ))}
                  </select>
                )}
                {/* Expand */}
                <button
                  onClick={() => onToggleExpand(key)}
                  className="p-1.5 text-gray-500 hover:text-white transition-colors"
                  title={t('Voir les détails')}
                >
                  {isExp ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </button>

                {/* Supprimer */}
                {isGlobalSection ? (
                  /* Section globale : owner peut supprimer, autres voient warning */
                  ds.added_by === currentUser ? (
                    <button
                      onClick={() => onDeleteGlobal(ds)}
                      className="p-1.5 text-gray-600 hover:text-red-400 transition-colors"
                      title={t('Supprimer définitivement de la galerie globale')}
                    >
                      <Trash2 size={15} />
                    </button>
                  ) : (
                    <span
                      className="p-1.5 text-gray-700 cursor-not-allowed"
                      title={ds.added_by ? `${t('Appartient à')} "${ds.added_by}" — ${t('vous ne pouvez pas supprimer ce dataset global')}` : t('Vous ne pouvez pas supprimer ce dataset global')}
                    >
                      <Trash2 size={15} />
                    </span>
                  )
                ) : (
                  /* Section workspace : tout utilisateur peut retirer de son workspace */
                  <button
                    onClick={() => onDelete(ds)}
                    className="p-1.5 text-gray-600 hover:text-red-400 transition-colors"
                    title={ds.is_global ? t('Retirer de ce workspace (reste dans la galerie globale)') : t('Supprimer le dataset')}
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
            </div>

            {/* Détails dépliés */}
            {isExp && (
              <DatasetDetailPanel
                ds={ds}
                pinned={pinned}
                isImporting={importing.has(ds.root_path)}
                onTogglePin={() => ds.in_workspace ? onTogglePin(ds) : onImport(ds)}
              />
            )}
          </div>
        )
  }
}

// ---- Panel de détails avec chargement lazy des stats ----
function DatasetDetailPanel({ ds, pinned, isImporting, onTogglePin }: {
  ds: DatasetSummary
  pinned: boolean
  isImporting: boolean
  onTogglePin: () => void
}) {
  const t = useT()
  const qc = useQueryClient()
  const [refreshing, setRefreshing] = useState(false)

  // Stats complètes — workspace seulement, chargement lazy
  const { data: stats, isLoading: statsLoading } = useQuery<DatasetStats>({
    queryKey: ['dataset-stats', ds.id],
    queryFn: () => datasetsAPI.getStats(ds.id),
    enabled: ds.in_workspace && ds.id > 0,
    staleTime: 60_000,
  })

  const handleRefreshGallery = async () => {
    if (ds.id < 0) return
    setRefreshing(true)
    try {
      await datasetsAPI.refreshGallery(ds.id)
      qc.invalidateQueries({ queryKey: ['datasets'] })
    } catch {
      // silencieux — l'auto-refresh au prochain list_datasets suffira
    } finally {
      setRefreshing(false)
    }
  }

  // Stats de base à afficher pour tous les datasets globaux (workspace ou pas)
  const basicStats = ds.registry_stats
  const thumbs = ds.gallery_thumb_urls ?? []

  return (
    <div className="border-t border-gray-700 px-4 py-3 space-y-4">
      {/* Infos de base */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="col-span-2">
          <span className="text-gray-500">{t('Chemin')} :</span>{' '}
          <span className="text-gray-300 font-mono break-all">{ds.root_path}</span>
        </div>
        <div>
          <span className="text-gray-500">{t('Ajouté')} :</span>{' '}
          <span className="text-gray-400">{new Date(ds.created_at).toLocaleDateString('fr-FR')}</span>
        </div>
        <div>
          <span className="text-gray-500">{t('Images')} :</span>{' '}
          <span className="text-gray-300">{ds.image_count}</span>
        </div>
        {ds.in_workspace && ds.umap_cached && (
          <div>
            <span className="text-gray-500">{t('Carte')} :</span>{' '}
            <span className="text-green-400">{t('calculée')}</span>
          </div>
        )}
        {ds.rejected_count > 0 && (
          <div>
            <span className="text-gray-500">{t('Exclusions')} :</span>{' '}
            <span className="text-orange-400">
              {ds.rejected_count} {t('rejetées')} · {ds.image_count - ds.rejected_count} {t('actives')}
            </span>
          </div>
        )}
      </div>

      {/* Miniatures gallery fixes — toujours disponibles pour les datasets globaux */}
      {ds.is_global && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-gray-500 text-xs">
              {thumbs.length > 0 ? `${t('Aperçu')} (${thumbs.length} ${t('miniatures fixes')})` : t('Aucune miniature disponible')}
            </p>
            {ds.in_workspace && ds.id > 0 && (
              <button
                onClick={handleRefreshGallery}
                disabled={refreshing}
                className="flex items-center gap-1 px-2 py-0.5 text-xs text-gray-500 hover:text-gray-300 transition-colors"
                title={t('Régénérer les miniatures gallery')}
              >
                <RefreshCw size={10} className={refreshing ? 'animate-spin' : ''} />
                {refreshing ? t('Génération...') : t('Rafraîchir')}
              </button>
            )}
          </div>
          {thumbs.length > 0 ? (
            <div className="flex gap-2 flex-wrap">
              {thumbs.map((url, i) => (
                <div key={i} className="flex-shrink-0 w-28 rounded-lg overflow-hidden border border-gray-700">
                  <div className="aspect-video bg-gray-900">
                    <img src={url} alt={`${t('aperçu')} ${i + 1}`} className="w-full h-full object-cover" loading="lazy"
                      onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            ds.in_workspace && ds.id > 0 && (
              <button
                onClick={handleRefreshGallery}
                disabled={refreshing}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-700/50 text-gray-400 border border-gray-600 text-xs rounded-lg hover:bg-gray-700 transition-colors disabled:opacity-50"
              >
                {refreshing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                {refreshing ? t('Génération...') : t('Générer les miniatures gallery')}
              </button>
            )
          )}
        </div>
      )}

      {/* Stats de base du registre — disponibles même hors workspace */}
      {ds.is_global && basicStats && (basicStats.avg_width || basicStats.format_distribution) && (
        <div className="space-y-2">
          <p className="text-gray-500 text-xs font-medium">{t('Statistiques de base')}</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
            {basicStats.avg_width && basicStats.avg_height && (
              <StatMini label={t('Dim. moyenne')} value={`${basicStats.avg_width} × ${basicStats.avg_height} px`} />
            )}
            {basicStats.format_distribution && Object.entries(basicStats.format_distribution).map(([fmt, cnt]) => (
              <StatMini key={fmt} label={fmt || '?'} value={`${cnt} img`} />
            ))}
          </div>
          {!ds.in_workspace && (
            <p className="text-gray-600 text-xs italic">
              {t('Stats complètes disponibles après import dans ce workspace.')}
            </p>
          )}
        </div>
      )}

      {/* Stats complètes workspace */}
      {ds.in_workspace && statsLoading && (
        <div className="flex items-center gap-2 text-gray-500 text-xs">
          <Loader2 size={12} className="animate-spin" /> {t('Chargement des statistiques...')}
        </div>
      )}

      {stats && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            <StatMini label={t('Dim. moyenne')} value={`${stats.avg_width} × ${stats.avg_height} px`} />
            <StatMini label="Min/Max W" value={`${stats.min_width} – ${stats.max_width}`} />
            <StatMini label="Min/Max H" value={`${stats.min_height} – ${stats.max_height}`} />
            <StatMini label={t('Poids moyen')} value={fmt_bytes(stats.avg_file_size_bytes)} />
            <StatMini label={t('Poids total')} value={fmt_bytes(stats.total_size_bytes)} />
            {Object.entries(stats.color_modes).map(([mode, cnt]) => (
              <StatMini key={mode} label={`${t('Mode')} ${mode}`} value={`${cnt} img`} />
            ))}
            {Object.entries(stats.format_distribution).map(([fmt, cnt]) => (
              <StatMini key={fmt} label={fmt || '?'} value={`${cnt} img`} />
            ))}
          </div>
          {/* Thumbnails workspace (plus précis que les fixes) */}
          {!ds.is_global && stats.thumbnails.length > 0 && (
            <div>
              <p className="text-gray-500 text-xs mb-2">{t('Aperçu')} ({stats.thumbnails.length} {t('images aléatoires')})</p>
              <div className="flex gap-2">
                {stats.thumbnails.map((t, i) => (
                  <div key={i} className="flex-shrink-0 w-24 rounded-lg overflow-hidden border border-gray-700">
                    <div className="aspect-video bg-gray-900">
                      <img src={t.url} alt={t.filename} className="w-full h-full object-cover" loading="lazy" />
                    </div>
                    <p className="text-gray-500 text-xs truncate px-1 py-0.5">{t.filename}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Action principale */}
      {ds.in_workspace && !pinned && (
        <button
          onClick={onTogglePin}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-600/20 text-amber-400 border border-amber-600/40 text-xs rounded-lg hover:bg-amber-600/30 transition-colors"
        >
          <Pin size={12} /> {t('Épingler dans le Dashboard Playground')}
        </button>
      )}
      {ds.in_workspace && pinned && (
        <p className="text-amber-400/60 text-xs flex items-center gap-1">
          <Pin size={11} /> {t('Épinglé dans le Playground')}
        </p>
      )}
      {!ds.in_workspace && (
        <button
          onClick={onTogglePin}
          disabled={isImporting}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600/20 text-purple-400 border border-purple-600/40 text-xs rounded-lg hover:bg-purple-600/30 transition-colors disabled:opacity-50"
        >
          {isImporting
            ? <><Loader2 size={12} className="animate-spin" /> {t('Importation en cours...')}</>
            : <><Download size={12} /> {t('Importer dans ce workspace')}</>
          }
        </button>
      )}
    </div>
  )
}

function StatMini({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-900/60 rounded-lg px-2.5 py-1.5">
      <p className="text-gray-500 text-xs leading-none mb-0.5">{label}</p>
      <p className="text-gray-200 text-xs font-medium">{value}</p>
    </div>
  )
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      <p className="text-gray-400 text-sm mt-0.5">{label}</p>
    </div>
  )
}
