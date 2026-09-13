// ============================================================
// pages/Dashboard.tsx — Dashboard Playground
// Affiche uniquement les datasets épinglés depuis la Gallery.
// Toutes les opérations workspace : embed, recluster, merge,
// rebuild, subsets, etc.
// ============================================================

import { useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import {
  Layers, GitMerge, Play, RefreshCw, Merge,
  ChevronDown, ChevronUp, CheckSquare, Square, RotateCcw,
  Pin, PinOff, AlertTriangle, ImageIcon, Trash2,
} from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import {
  datasetsAPI, settingsAPI, startRemap, startMerge,
  startRebuildWithoutDuplicates, startResetDuplicateFilter,
} from '../api/client'
import { useDatasets } from '../hooks/useDataset'
import { useSettings } from '../hooks/useSettings'
import type { DatasetSummary, EmbedEvent } from '../types/api'

// ── Module-level SSE state ──────────────────────────────────────────────────
// Stocké en dehors du composant React pour survivre à la navigation (démontage
// et remontage du composant). En React 18, setState sur un composant démonté
// est un no-op, donc aucun risque de warning.
// ─────────────────────────────────────────────────────────────────────────────
// NB : l'embedding n'utilise plus de flux SSE. Il tourne en tâche de fond côté
// serveur ; la progression est lue via le poll de list() (ds.embed_progress/…),
// ce qui est robuste en accès distant (SSH). Les autres opérations gardent le SSE
// (via proxy même-origine).
const _remap:    Record<number, EmbedEvent | null> = {}
const _rebuild:  Record<number, EmbedEvent | null> = {}
const _reset:    Record<number, EmbedEvent | null> = {}
const _sseCancels = new Map<string, () => void>()

const STATUS_COLOR: Record<string, string> = {
  scanning:  'text-teal-400 bg-teal-400/10 animate-pulse',
  pending:   'text-yellow-400 bg-yellow-400/10',
  embedding: 'text-blue-400 bg-blue-400/10 animate-pulse',
  ready:     'text-green-400 bg-green-400/10',
  error:     'text-red-400 bg-red-400/10',
}

export default function Dashboard() {
  const { data: allDatasets = [], isLoading } = useDatasets()
  const { settings } = useSettings()
  const qc = useQueryClient()

  // Filtrer sur les datasets épinglés dans le Playground
  const pinnedIds = new Set(settings?.playground_dataset_ids ?? [])
  const datasets = allDatasets.filter(d => pinnedIds.has(d.id))

  // ---- SSE progress — initialisé depuis le store module-level pour survie navigation ----
  // Les états sont persistés dans _remap/_rebuild/_reset (module-level) entre navigations.
  const [remapping,  setRemapping]  = useState<Record<number, EmbedEvent | null>>(() => ({ ..._remap }))
  const [rebuilding, setRebuilding] = useState<Record<number, EmbedEvent | null>>(() => ({ ..._rebuild }))
  const [resetting,  setResetting]  = useState<Record<number, EmbedEvent | null>>(() => ({ ..._reset }))

  // ---- Recluster ----
  const [reclusterN, setReclusterN] = useState<Record<number, number>>({})
  const [reclusterMethod, setReclusterMethod] = useState<Record<number, 'kmeans' | 'hdbscan'>>({})
  const [reclusterMin, setReclusterMin] = useState<Record<number, number>>({})   // HDBSCAN min_cluster_size
  const [showRecluster, setShowRecluster] = useState<Set<number>>(new Set())

  // ---- Réduction dimensionnelle (bloc indépendant du clustering) ----
  const [reduceMethod, setReduceMethod] = useState<Record<number, 'umap' | 'tsne' | 'pca'>>({})
  const [reduceNN, setReduceNN] = useState<Record<number, number>>({})
  const [reduceMinDist, setReduceMinDist] = useState<Record<number, number>>({})
  const [reducePerp, setReducePerp] = useState<Record<number, number>>({})
  const [reduceLR, setReduceLR] = useState<Record<number, number>>({})
  const [showReduce, setShowReduce] = useState<Set<number>>(new Set())

  // ---- Fusion de datasets ----
  const [mergeMode, setMergeMode] = useState(false)
  const [mergeSelected, setMergeSelected] = useState<Set<number>>(new Set())
  const [mergeName, setMergeName] = useState('')
  const [mergeNClusters, setMergeNClusters] = useState(20)
  const [mergeProgress, setMergeProgress] = useState<EmbedEvent | null>(null)
  const [merging, setMerging] = useState(false)

  const autoMergeName = mergeSelected.size >= 2
    ? 'merged_' + datasets
        .filter(d => mergeSelected.has(d.id))
        .map(d => d.name.replace(/\s+/g, '_'))
        .join('_')
    : ''

  const handleEmbed = async (ds: DatasetSummary) => {
    // Lancement non bloquant en tâche de fond. La barre de progression est
    // pilotée par le poll de useDatasets (ds.embed_progress/…), donc robuste en
    // SSH et à la navigation. Un re-clic pendant le run est un no-op côté serveur.
    if (ds.status === 'embedding') return
    try {
      const res = await datasetsAPI.embed(ds.id)
      if (res.status === 'already_running') {
        toast('Embedding déjà en cours')
      } else {
        toast.success(`Embedding lancé pour "${ds.name}"`)
      }
      qc.invalidateQueries({ queryKey: ['datasets'] })
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? String(e)
      toast.error(`Erreur : ${msg}`)
    }
  }

  const handleRecluster = async (ds: DatasetSummary) => {
    const method = reclusterMethod[ds.id] ?? (ds.cluster_method as 'kmeans' | 'hdbscan') ?? 'kmeans'
    const opts = method === 'hdbscan'
      ? { method, min_cluster_size: reclusterMin[ds.id] ?? 5 }
      : { method, n_clusters: reclusterN[ds.id] ?? ds.n_clusters }
    try {
      const res = await datasetsAPI.recluster(ds.id, opts)
      if (res.status === 'already_running') {
        toast('Clustering déjà en cours')
      } else {
        toast.success(method === 'hdbscan' ? 'Clustering HDBSCAN relancé' : `Clustering KMeans relancé`)
      }
      // Le poll (recluster_total>0) affiche la progression ; on rafraîchit les vues au done.
      qc.invalidateQueries({ queryKey: ['datasets'] })
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? String(e)
      toast.error(`Erreur recluster : ${msg}`)
    }
  }

  const handleRemap = (ds: DatasetSummary) => {
    const key = `remap-${ds.id}`
    if (_sseCancels.has(key)) return
    _remap[ds.id] = null
    setRemapping({ ..._remap })
    const cancel = startRemap(
      ds.id,
      (evt: EmbedEvent) => {
        _remap[ds.id] = evt
        setRemapping({ ..._remap })
        if (evt.type === 'done') {
          toast.success(`Carte recalculée pour "${ds.name}" !`)
          delete _remap[ds.id]
          setRemapping({ ..._remap })
          qc.invalidateQueries({ queryKey: ['datasets'] })
          qc.invalidateQueries({ queryKey: ['dataset-map', ds.id] })
          _sseCancels.delete(key)
        }
        if (evt.type === 'error') {
          toast.error(`Erreur remap : ${(evt as { message: string }).message}`)
          delete _remap[ds.id]
          setRemapping({ ..._remap })
          _sseCancels.delete(key)
        }
      },
      () => {
        delete _remap[ds.id]
        setRemapping({ ..._remap })
        _sseCancels.delete(key)
      }
    )
    _sseCancels.set(key, cancel)
  }

  const handleRebuild = (ds: DatasetSummary) => {
    const key = `rebuild-${ds.id}`
    if (_sseCancels.has(key)) return
    _rebuild[ds.id] = null
    setRebuilding({ ..._rebuild })
    const cancel = startRebuildWithoutDuplicates(
      ds.id,
      (evt: EmbedEvent) => {
        _rebuild[ds.id] = evt
        setRebuilding({ ..._rebuild })
        if (evt.type === 'done') {
          toast.success(`Rebuild terminé — ${ds.rejected_count} images exclues`)
          delete _rebuild[ds.id]
          setRebuilding({ ..._rebuild })
          qc.invalidateQueries({ queryKey: ['datasets'] })
          qc.invalidateQueries({ queryKey: ['dataset-map', ds.id] })
          qc.invalidateQueries({ queryKey: ['dataset-clusters', ds.id] })
          _sseCancels.delete(key)
        }
        if (evt.type === 'error') {
          toast.error(`Erreur rebuild : ${(evt as { message: string }).message}`)
          delete _rebuild[ds.id]
          setRebuilding({ ..._rebuild })
          _sseCancels.delete(key)
        }
      },
      () => {
        delete _rebuild[ds.id]
        setRebuilding({ ..._rebuild })
        _sseCancels.delete(key)
      }
    )
    _sseCancels.set(key, cancel)
  }

  const handleReset = (ds: DatasetSummary) => {
    if (!confirm(`Réinitialiser le filtre doublon de "${ds.name}" ? Toutes les décisions seront effacées.`)) return
    const key = `reset-${ds.id}`
    if (_sseCancels.has(key)) return
    _reset[ds.id] = null
    setResetting({ ..._reset })
    const cancel = startResetDuplicateFilter(
      ds.id,
      (evt: EmbedEvent) => {
        _reset[ds.id] = evt
        setResetting({ ..._reset })
        if (evt.type === 'done') {
          toast.success('Filtre réinitialisé — toutes les images restaurées')
          delete _reset[ds.id]
          setResetting({ ..._reset })
          qc.invalidateQueries({ queryKey: ['datasets'] })
          qc.invalidateQueries({ queryKey: ['dataset-map', ds.id] })
          qc.invalidateQueries({ queryKey: ['dataset-clusters', ds.id] })
          _sseCancels.delete(key)
        }
        if (evt.type === 'error') {
          toast.error(`Erreur reset : ${(evt as { message: string }).message}`)
          delete _reset[ds.id]
          setResetting({ ..._reset })
          _sseCancels.delete(key)
        }
      },
      () => {
        delete _reset[ds.id]
        setResetting({ ..._reset })
        _sseCancels.delete(key)
      }
    )
    _sseCancels.set(key, cancel)
  }

  const toggleRecluster = (ds: DatasetSummary) => {
    setShowRecluster(prev => {
      const next = new Set(prev)
      if (next.has(ds.id)) next.delete(ds.id)
      else {
        next.add(ds.id)
        // Pré-remplir depuis la config courante du dataset
        if (reclusterN[ds.id] === undefined) setReclusterN(p => ({ ...p, [ds.id]: ds.n_clusters }))
        if (reclusterMethod[ds.id] === undefined)
          setReclusterMethod(p => ({ ...p, [ds.id]: (ds.cluster_method as 'kmeans' | 'hdbscan') ?? 'kmeans' }))
        if (reclusterMin[ds.id] === undefined)
          setReclusterMin(p => ({ ...p, [ds.id]: Number(ds.cluster_params?.min_cluster_size ?? 5) }))
      }
      return next
    })
  }

  // Réinitialise le panneau recluster aux valeurs par défaut (settings user)
  const resetReclusterDefaults = (id: number) => {
    setReclusterMethod(p => ({ ...p, [id]: (settings?.cluster_method as 'kmeans' | 'hdbscan') ?? 'kmeans' }))
    setReclusterN(p => ({ ...p, [id]: settings?.default_n_clusters ?? 20 }))
    setReclusterMin(p => ({ ...p, [id]: settings?.hdbscan_min_cluster_size ?? 5 }))
  }

  const handleReduce = async (ds: DatasetSummary) => {
    const method = reduceMethod[ds.id] ?? (ds.reduction_method as 'umap' | 'tsne' | 'pca') ?? 'umap'
    try {
      const res = await datasetsAPI.reduce(ds.id, {
        method,
        umap_n_neighbors: reduceNN[ds.id] ?? 15,
        umap_min_dist: reduceMinDist[ds.id] ?? 0.1,
        tsne_perplexity: reducePerp[ds.id] ?? 30,
        tsne_learning_rate: reduceLR[ds.id] ?? 200,
      })
      if (res.status === 'already_running') toast('Réduction déjà en cours')
      else toast.success(`Réduction ${method.toUpperCase()} relancée`)
      qc.invalidateQueries({ queryKey: ['datasets'] })
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? String(e)
      toast.error(`Erreur réduction : ${msg}`)
    }
  }

  const toggleReduce = (ds: DatasetSummary) => {
    setShowReduce(prev => {
      const next = new Set(prev)
      if (next.has(ds.id)) next.delete(ds.id)
      else {
        next.add(ds.id)
        const p = ds.reduction_params ?? {}
        if (reduceMethod[ds.id] === undefined)
          setReduceMethod(s => ({ ...s, [ds.id]: (ds.reduction_method as 'umap' | 'tsne' | 'pca') ?? (settings?.reduction_method ?? 'umap') }))
        if (reduceNN[ds.id] === undefined)
          setReduceNN(s => ({ ...s, [ds.id]: Number(p.n_neighbors ?? settings?.umap_n_neighbors ?? 15) }))
        if (reduceMinDist[ds.id] === undefined)
          setReduceMinDist(s => ({ ...s, [ds.id]: Number(p.min_dist ?? settings?.umap_min_dist ?? 0.1) }))
        if (reducePerp[ds.id] === undefined)
          setReducePerp(s => ({ ...s, [ds.id]: Number(p.perplexity ?? settings?.tsne_perplexity ?? 30) }))
        if (reduceLR[ds.id] === undefined)
          setReduceLR(s => ({ ...s, [ds.id]: Number(p.learning_rate ?? settings?.tsne_learning_rate ?? 200) }))
      }
      return next
    })
  }

  const resetReduceDefaults = (id: number) => {
    setReduceMethod(p => ({ ...p, [id]: (settings?.reduction_method as 'umap' | 'tsne' | 'pca') ?? 'umap' }))
    setReduceNN(p => ({ ...p, [id]: settings?.umap_n_neighbors ?? 15 }))
    setReduceMinDist(p => ({ ...p, [id]: settings?.umap_min_dist ?? 0.1 }))
    setReducePerp(p => ({ ...p, [id]: settings?.tsne_perplexity ?? 30 }))
    setReduceLR(p => ({ ...p, [id]: settings?.tsne_learning_rate ?? 200 }))
  }

  const reductionLabel = (ds: DatasetSummary): string => {
    const m = (ds.reduction_method ?? 'umap').toLowerCase()
    const p = ds.reduction_params ?? {}
    if (m === 'tsne') return `t-SNE (perp ${p.perplexity ?? 30})`
    if (m === 'pca') return 'PCA'
    return `UMAP (nn ${p.n_neighbors ?? 15}, d ${p.min_dist ?? 0.1})`
  }

  // Libellé compact de la config de clustering courante (affichage carte info)
  const clusterLabel = (ds: DatasetSummary): string => {
    if (!ds.cluster_method) return `${ds.n_clusters} clusters`
    if (ds.cluster_method === 'hdbscan')
      return `HDBSCAN (min ${ds.cluster_params?.min_cluster_size ?? 5}) · ${ds.n_clusters} clusters`
    return `KMeans k=${ds.cluster_params?.n_clusters ?? ds.n_clusters}`
  }

  const toggleMergeSelect = (id: number) => {
    setMergeSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const handleMerge = () => {
    if (mergeSelected.size < 2) return toast.error('Sélectionnez au moins 2 datasets')
    const name = mergeName.trim() || autoMergeName
    if (!name) return toast.error('Nom requis')
    const key = 'merge'
    if (_sseCancels.has(key)) return
    setMerging(true)
    setMergeProgress(null)
    const cancel = startMerge(
      Array.from(mergeSelected), name, mergeNClusters,
      (evt: EmbedEvent) => {
        setMergeProgress(evt)
        if (evt.type === 'done') {
          toast.success(`Dataset fusionné "${name}" créé !`)
          qc.invalidateQueries({ queryKey: ['datasets'] })
          setMergeMode(false); setMergeSelected(new Set()); setMergeName('')
          setMerging(false)
          _sseCancels.delete(key)
        }
        if (evt.type === 'error') {
          toast.error(`Erreur merge : ${(evt as { message: string }).message}`)
          setMerging(false)
          _sseCancels.delete(key)
        }
      },
      () => {
        setMerging(false)
        _sseCancels.delete(key)
      },
    )
    _sseCancels.set(key, cancel)
  }

  const handleUnpin = async (ds: DatasetSummary) => {
    if (!settings) return
    const next = settings.playground_dataset_ids.filter(id => id !== ds.id)
    try {
      await settingsAPI.update({ ...settings, playground_dataset_ids: next })
      qc.invalidateQueries({ queryKey: ['settings'] })
      toast.success(`"${ds.name}" retiré du Playground`)
    } catch {
      toast.error('Erreur mise à jour Playground')
    }
  }

  const handleDelete = async (ds: DatasetSummary) => {
    if (!confirm(`Supprimer définitivement "${ds.name}" ?\n\nToutes les images, embeddings et subsets associés seront supprimés.`)) return
    try {
      await datasetsAPI.delete(ds.id)
      // Retirer aussi des IDs épinglés
      if (settings) {
        const next = settings.playground_dataset_ids.filter(id => id !== ds.id)
        await settingsAPI.update({ ...settings, playground_dataset_ids: next })
        qc.invalidateQueries({ queryKey: ['settings'] })
      }
      toast.success(`"${ds.name}" supprimé`)
      qc.invalidateQueries({ queryKey: ['datasets'] })
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? String(e)
      toast.error(`Erreur suppression : ${msg}`)
    }
  }

  const getMergedSourceNames = (rootPath: string): string => {
    const ids = rootPath.replace('merged:', '').split(',').map(Number)
    const names = allDatasets.filter(d => ids.includes(d.id)).map(d => d.name)
    return names.length > 0 ? names.join(', ') : ids.join(', ')
  }

  const mergeProgressInfo = mergeProgress?.type === 'progress' ? mergeProgress : null

  if (isLoading) {
    return <div className="p-6 text-gray-500">Chargement...</div>
  }

  if (datasets.length === 0) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Layers size={22} /> Dashboard Playground
          </h1>
          <p className="text-gray-400 mt-1">Espace de traitement et d'analyse des datasets.</p>
        </div>
        <div className="mt-12 flex flex-col items-center text-center text-gray-600">
          <Pin size={48} className="mb-4 opacity-30" />
          <p className="text-lg font-medium text-gray-400">Aucun dataset épinglé</p>
          <p className="text-sm mt-2 max-w-sm">
            Allez dans la <strong className="text-indigo-400">Gallery</strong> pour ajouter des datasets
            et les épingler dans le Playground.
          </p>
          <Link
            to="/"
            className="mt-4 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition-colors"
          >
            Aller à la Gallery
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Layers size={22} /> Dashboard Playground
          </h1>
          <p className="text-gray-400 mt-1">
            {datasets.length} dataset(s) épinglé(s) ·{' '}
            {datasets.reduce((s, d) => s + d.image_count, 0)} images totales
          </p>
        </div>
        <Link
          to="/"
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-400 hover:text-white bg-gray-800 border border-gray-700 rounded-lg hover:bg-gray-700 transition-colors flex-shrink-0"
          title="Retour à la Gallery pour gérer les datasets"
        >
          <ImageIcon size={13} /> Gallery
        </Link>
      </div>

      {/* Bouton fusion */}
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-300">Datasets</h2>
        {datasets.filter(d => d.umap_cached).length >= 2 && (
          <button
            onClick={() => { setMergeMode(m => !m); setMergeSelected(new Set()) }}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors
              ${mergeMode
                ? 'bg-purple-600 text-white'
                : 'bg-purple-600/20 text-purple-400 border border-purple-600/40 hover:bg-purple-600/30'}`}
          >
            <Merge size={14} /> {mergeMode ? 'Annuler' : 'Fusionner datasets'}
          </button>
        )}
      </div>

      {/* Panel fusion */}
      {mergeMode && (
        <div className="bg-purple-900/20 border border-purple-600/40 rounded-xl p-4 space-y-3">
          <p className="text-purple-300 text-sm font-medium">Sélectionnez les datasets à fusionner</p>
          {mergeSelected.size >= 2 && (
            <div className="flex flex-wrap gap-2 items-end">
              <div className="flex-1 min-w-48">
                <label className="text-gray-400 text-xs block mb-1">Nom</label>
                <input type="text" placeholder={autoMergeName || 'Nom...'} value={mergeName}
                  onChange={e => setMergeName(e.target.value)}
                  className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-500" />
              </div>
              <div>
                <label className="text-gray-400 text-xs block mb-1">Clusters</label>
                <input type="number" min={2} max={200} value={mergeNClusters}
                  onChange={e => setMergeNClusters(Number(e.target.value))}
                  className="w-20 bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-200" />
              </div>
              <button onClick={handleMerge} disabled={merging}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-sm rounded-lg disabled:opacity-50 font-medium whitespace-nowrap">
                {merging ? 'Fusion...' : `Fusionner (${mergeSelected.size} sources)`}
              </button>
            </div>
          )}
          {merging && mergeProgressInfo && (
            <div>
              <div className="flex justify-between text-xs text-gray-400 mb-1">
                <span>Phase : {mergeProgressInfo.phase}</span>
                <span>{mergeProgressInfo.current}/{mergeProgressInfo.total}</span>
              </div>
              <div className="w-full bg-gray-700 rounded-full h-1.5">
                <div className="bg-purple-500 h-1.5 rounded-full transition-all"
                  style={{ width: `${Math.round((mergeProgressInfo.current / Math.max(mergeProgressInfo.total, 1)) * 100)}%` }} />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Liste datasets */}
      <div className="space-y-3">
        {datasets.map((ds, i) => {
          // L'embedding est piloté par le poll (statut serveur + ds.embed_*).
          const isEmb = ds.status === 'embedding'
          const remapEvt = remapping[ds.id]
          const isRemapping = ds.id in remapping
          const rebuildEvt = rebuilding[ds.id]
          const isRebuilding = ds.id in rebuilding
          const resetEvt = resetting[ds.id]
          const isResetting = ds.id in resetting
          const isReclustering = ds.recluster_total > 0
          const showR = showRecluster.has(ds.id)
          const isReducing = ds.reduce_total > 0
          const showRed = showReduce.has(ds.id)
          const isMergeSource = mergeMode && mergeSelected.has(ds.id)
          const isMerged = ds.root_path.startsWith('merged:')

          // Glow si la carte est obsolète (des rejetées ont encore des coords)
          const rebuildGlow = ds.map_needs_rebuild && !isRebuilding
          // Glow si la méthode de réduction a changé depuis le dernier embed
          const methodOutdated = !!ds.map_method_outdated && !isRemapping && !isEmb

          return (
            <div key={ds.id}
              data-tour={i === 0 ? 'pg-dataset-card' : undefined}
              className={`bg-gray-800 rounded-xl p-4 border transition-colors
              ${isMergeSource ? 'border-purple-500' : 'border-gray-700'}`}>
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  {mergeMode && ds.umap_cached && (
                    <button onClick={() => toggleMergeSelect(ds.id)}
                      className="flex-shrink-0 text-purple-400 hover:text-purple-300">
                      {isMergeSource ? <CheckSquare size={18} /> : <Square size={18} />}
                    </button>
                  )}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-gray-600 text-xs font-mono">#{ds.id}</span>
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLOR[ds.status] ?? 'text-gray-400 bg-gray-700'}`}
                        title={ds.status === 'error' && ds.error_message ? ds.error_message : undefined}
                      >
                        {ds.status}
                      </span>
                      <h3 className="font-semibold text-white truncate">{ds.name}</h3>
                      {isMerged && <span className="px-1.5 py-0.5 bg-purple-600/20 text-purple-400 text-xs rounded border border-purple-600/30 flex-shrink-0">merged</span>}
                    </div>
                    {isMerged && (
                      <p className="text-purple-400/60 text-xs mt-0.5">Fusion de : {getMergedSourceNames(ds.root_path)}</p>
                    )}
                    {!isMerged && (
                      <p className="text-gray-500 text-xs mt-0.5 truncate">{ds.root_path}</p>
                    )}
                    <p className="text-gray-400 text-xs mt-0.5">
                      {ds.image_count} images · {ds.embedded_count} embeddings · {ds.n_clusters} clusters
                      {ds.umap_cached && (
                        <>
                          <span className="text-teal-400/80"> · Clustering : {clusterLabel(ds)}</span>
                          <span className="text-indigo-400/80"> · Réduction : {reductionLabel(ds)}</span>
                        </>
                      )}
                    </p>
                    {methodOutdated && (
                      <p className="flex items-center gap-1 text-xs text-amber-400/80 mt-0.5">
                        <AlertTriangle size={10} />
                        Méthode de réduction modifiée — carte à recalculer
                      </p>
                    )}
                    {ds.rejected_count > 0 && (
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-orange-400/80">
                          Init:{ds.image_count} · Jetés:{ds.rejected_count} · Utilisé:{ds.image_count - ds.rejected_count}
                        </span>
                        {!isResetting && !isRebuilding && (
                          <button onClick={() => handleReset(ds)}
                            className="flex items-center gap-1 px-1.5 py-0.5 bg-gray-700 text-gray-400 text-xs rounded hover:bg-gray-600 hover:text-white transition-colors">
                            <RotateCcw size={10} /> Reset
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0"
                     data-tour={i === 0 ? 'pg-dataset-actions' : undefined}>
                  {/* Retirer du Playground */}
                  <button
                    onClick={() => handleUnpin(ds)}
                    className="p-1.5 text-gray-600 hover:text-amber-400 transition-colors"
                    title="Retirer du Playground (ne supprime pas le dataset)"
                  >
                    <PinOff size={14} />
                  </button>

                  {/* Supprimer définitivement le dataset */}
                  <button
                    onClick={() => handleDelete(ds)}
                    className="p-1.5 text-gray-700 hover:text-red-400 transition-colors"
                    title="Supprimer définitivement le dataset et toutes ses données"
                  >
                    <Trash2 size={14} />
                  </button>

                  {ds.umap_cached && (
                    <>
                      <Link
                        to={`/datasets/${ds.id}/map`}
                        title={methodOutdated ? 'Carte construite avec une méthode différente — utilisez "Recalculer carte"' : 'Ouvrir la carte'}
                        className="px-3 py-1.5 text-xs bg-indigo-600/20 text-indigo-400 border border-indigo-600/40 rounded-lg hover:bg-indigo-600/30 transition-colors"
                      >
                        Carte
                      </Link>
                      <Link to={`/datasets/${ds.id}/search`}
                        className="px-3 py-1.5 text-xs bg-blue-600/20 text-blue-400 border border-blue-600/40 rounded-lg hover:bg-blue-600/30 transition-colors">
                        Recherche
                      </Link>
                      <Link to={`/datasets/${ds.id}/duplicates`}
                        className="px-3 py-1.5 text-xs bg-yellow-600/20 text-yellow-400 border border-yellow-600/40 rounded-lg hover:bg-yellow-600/30 transition-colors">
                        Doublons
                      </Link>
                      {/* Rebuild — glow si carte obsolète */}
                      {ds.rejected_count > 0 && !isResetting && (
                        <button
                          onClick={() => handleRebuild(ds)}
                          disabled={isRebuilding}
                          className={`flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-lg transition-all
                            ${isRebuilding
                              ? 'bg-orange-600/30 text-orange-300 border border-orange-600/40'
                              : rebuildGlow
                                ? 'bg-orange-600/25 text-orange-300 border border-orange-500 shadow-orange-500/40 shadow-md animate-pulse'
                                : 'bg-orange-600/15 text-orange-400 border border-orange-600/30 hover:bg-orange-600/25'}`}
                          title={rebuildGlow ? 'Carte obsolète — recalculer UMAP sans les images rejetées' : 'Recalculer UMAP sans les images rejetées'}
                        >
                          <RefreshCw size={11} className={isRebuilding ? 'animate-spin' : ''} />
                          {isRebuilding ? 'Rebuild...' : 'Rebuild'}
                        </button>
                      )}
                      {/* Recluster toggle */}
                      <button
                        onClick={() => toggleRecluster(ds)}
                        className={`flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-lg transition-colors
                          ${showR ? 'bg-teal-600/30 text-teal-300 border border-teal-600/40' : 'bg-teal-600/15 text-teal-400 border border-teal-600/30 hover:bg-teal-600/25'}`}
                        title="Relancer le clustering (sur les embeddings CLIP 512D)">
                        <RefreshCw size={11} /> Cluster
                        {showR ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                      </button>
                      {/* Réduction toggle */}
                      <button
                        onClick={() => toggleReduce(ds)}
                        className={`flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-lg transition-colors
                          ${showRed ? 'bg-indigo-600/30 text-indigo-300 border border-indigo-600/40' : 'bg-indigo-600/15 text-indigo-400 border border-indigo-600/30 hover:bg-indigo-600/25'}`}
                        title="Relancer la réduction 2D (UMAP / t-SNE / PCA)">
                        <RefreshCw size={11} /> Réduc.
                        {showRed ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                      </button>
                    </>
                  )}
                  {/* Recalculer carte — uniquement la réduction 2D, sans CLIP */}
                  {ds.umap_cached && methodOutdated && !isRemapping && (
                    <button
                      onClick={() => handleRemap(ds)}
                      title="Méthode de réduction modifiée — recalcule uniquement la carte 2D, sans re-embedder CLIP"
                      className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg transition-all bg-amber-600/25 text-amber-300 border border-amber-500 shadow-amber-500/40 shadow-md animate-pulse"
                    >
                      <RefreshCw size={12} /> Recalculer carte
                    </button>
                  )}
                  {isRemapping && (
                    <span className="text-xs text-amber-400 animate-pulse flex items-center gap-1">
                      <RefreshCw size={11} className="animate-spin" /> Remap...
                    </span>
                  )}
                  {/* Embedding en cours côté serveur (background task) — bouton désactivé,
                      la progression apparaît via le poll (barre plus bas). */}
                  {isEmb && (
                    <span
                      title="Calcul en cours sur le serveur — progression ci-dessous"
                      className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg bg-blue-600/20 text-blue-400 border border-blue-600/40 animate-pulse"
                    >
                      <RefreshCw size={12} className="animate-spin" /> En cours...
                    </span>
                  )}
                  {!isEmb && (
                    <button
                      onClick={() => handleEmbed(ds)}
                      data-tour={i === 0 ? 'pg-embed-btn' : undefined}
                      title="Lancer le pipeline complet : CLIP + indexation + carte + clustering"
                      className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg transition-all bg-green-600/20 text-green-400 border border-green-600/40 hover:bg-green-600/30"
                    >
                      <Play size={12} /> Embeddings
                    </button>
                  )}
                </div>
              </div>

              {/* Panel recluster */}
              {showR && ds.umap_cached && (
                <div className="mt-3 flex items-center gap-3 flex-wrap bg-gray-900/60 rounded-lg px-3 py-2 border border-teal-600/20">
                  <RefreshCw size={13} className="text-teal-400 flex-shrink-0" />
                  {/* Méthode */}
                  <div className="flex rounded-lg overflow-hidden border border-gray-600">
                    {(['kmeans', 'hdbscan'] as const).map(m => (
                      <button key={m}
                        onClick={() => setReclusterMethod(p => ({ ...p, [ds.id]: m }))}
                        className={`px-2.5 py-1 text-xs font-mono transition-colors
                          ${(reclusterMethod[ds.id] ?? ds.cluster_method ?? 'kmeans') === m
                            ? 'bg-teal-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}>
                        {m === 'kmeans' ? 'KMeans' : 'HDBSCAN'}
                      </button>
                    ))}
                  </div>
                  {/* Params selon la méthode */}
                  {(reclusterMethod[ds.id] ?? ds.cluster_method ?? 'kmeans') === 'kmeans' ? (
                    <>
                      <input type="range" min={2} max={100}
                        value={reclusterN[ds.id] ?? ds.n_clusters}
                        onChange={e => setReclusterN(p => ({ ...p, [ds.id]: Number(e.target.value) }))}
                        className="w-28 accent-teal-500" />
                      <input type="number" min={2} max={200}
                        value={reclusterN[ds.id] ?? ds.n_clusters}
                        onChange={e => setReclusterN(p => ({ ...p, [ds.id]: Math.max(2, Number(e.target.value)) }))}
                        className="w-16 bg-gray-900 border border-gray-600 rounded px-2 py-1 text-xs text-gray-200 text-center" />
                      <span className="text-gray-500 text-xs">clusters</span>
                    </>
                  ) : (
                    <>
                      <span className="text-gray-400 text-xs whitespace-nowrap">min_cluster_size</span>
                      <input type="number" min={2} max={200}
                        value={reclusterMin[ds.id] ?? 5}
                        onChange={e => setReclusterMin(p => ({ ...p, [ds.id]: Math.max(2, Number(e.target.value)) }))}
                        className="w-16 bg-gray-900 border border-gray-600 rounded px-2 py-1 text-xs text-gray-200 text-center" />
                    </>
                  )}
                  <button onClick={() => handleRecluster(ds)} disabled={isReclustering}
                    className="flex items-center gap-1 px-3 py-1 bg-teal-600 hover:bg-teal-500 text-white text-xs rounded-lg disabled:opacity-50 whitespace-nowrap">
                    {isReclustering ? <><RefreshCw size={11} className="animate-spin" /> En cours...</> : <><Play size={11} /> Relancer</>}
                  </button>
                  <button onClick={() => resetReclusterDefaults(ds.id)}
                    title="Réinitialiser aux valeurs par défaut (Paramètres)"
                    className="flex items-center gap-1 px-2 py-1 text-xs text-gray-400 hover:text-white border border-gray-600 rounded-lg">
                    <RotateCcw size={11} /> Défaut
                  </button>
                  <span className="text-gray-600 text-xs">actuel : {clusterLabel(ds)}</span>
                </div>
              )}

              {/* Panel réduction dimensionnelle */}
              {showRed && ds.umap_cached && (
                <div className="mt-3 flex items-center gap-3 flex-wrap bg-gray-900/60 rounded-lg px-3 py-2 border border-indigo-600/20">
                  <RefreshCw size={13} className="text-indigo-400 flex-shrink-0" />
                  <div className="flex rounded-lg overflow-hidden border border-gray-600">
                    {(['umap', 'tsne', 'pca'] as const).map(m => (
                      <button key={m}
                        onClick={() => setReduceMethod(p => ({ ...p, [ds.id]: m }))}
                        className={`px-2.5 py-1 text-xs font-mono uppercase transition-colors
                          ${(reduceMethod[ds.id] ?? ds.reduction_method ?? 'umap') === m
                            ? 'bg-indigo-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}>
                        {m}
                      </button>
                    ))}
                  </div>
                  {(reduceMethod[ds.id] ?? ds.reduction_method ?? 'umap') === 'umap' && (
                    <>
                      <span className="text-gray-400 text-xs">n_neighbors</span>
                      <input type="number" min={2} max={200} value={reduceNN[ds.id] ?? 15}
                        onChange={e => setReduceNN(p => ({ ...p, [ds.id]: Math.max(2, Number(e.target.value)) }))}
                        className="w-16 bg-gray-900 border border-gray-600 rounded px-2 py-1 text-xs text-gray-200 text-center" />
                      <span className="text-gray-400 text-xs">min_dist</span>
                      <input type="number" min={0} max={1} step={0.05} value={reduceMinDist[ds.id] ?? 0.1}
                        onChange={e => setReduceMinDist(p => ({ ...p, [ds.id]: Math.max(0, Number(e.target.value)) }))}
                        className="w-16 bg-gray-900 border border-gray-600 rounded px-2 py-1 text-xs text-gray-200 text-center" />
                    </>
                  )}
                  {(reduceMethod[ds.id] ?? ds.reduction_method ?? 'umap') === 'tsne' && (
                    <>
                      <span className="text-gray-400 text-xs">perplexity</span>
                      <input type="number" min={2} max={100} value={reducePerp[ds.id] ?? 30}
                        onChange={e => setReducePerp(p => ({ ...p, [ds.id]: Math.max(2, Number(e.target.value)) }))}
                        className="w-16 bg-gray-900 border border-gray-600 rounded px-2 py-1 text-xs text-gray-200 text-center" />
                      <span className="text-gray-400 text-xs">learning_rate</span>
                      <input type="number" min={1} max={1000} step={10} value={reduceLR[ds.id] ?? 200}
                        onChange={e => setReduceLR(p => ({ ...p, [ds.id]: Math.max(1, Number(e.target.value)) }))}
                        className="w-20 bg-gray-900 border border-gray-600 rounded px-2 py-1 text-xs text-gray-200 text-center" />
                    </>
                  )}
                  {(reduceMethod[ds.id] ?? ds.reduction_method ?? 'umap') === 'pca' && (
                    <span className="text-gray-500 text-xs">Aucun hyperparamètre (2 composantes)</span>
                  )}
                  <button onClick={() => handleReduce(ds)} disabled={isReducing}
                    className="flex items-center gap-1 px-3 py-1 bg-indigo-600 hover:bg-indigo-500 text-white text-xs rounded-lg disabled:opacity-50 whitespace-nowrap">
                    {isReducing ? <><RefreshCw size={11} className="animate-spin" /> En cours...</> : <><Play size={11} /> Relancer</>}
                  </button>
                  <button onClick={() => resetReduceDefaults(ds.id)}
                    title="Réinitialiser aux valeurs par défaut (Paramètres)"
                    className="flex items-center gap-1 px-2 py-1 text-xs text-gray-400 hover:text-white border border-gray-600 rounded-lg">
                    <RotateCcw size={11} /> Défaut
                  </button>
                  <span className="text-gray-600 text-xs">actuel : {reductionLabel(ds)}</span>
                </div>
              )}

              {/* Barres de progression */}
              {isEmb && ds.embed_total > 0 && (
                <ProgressBar phase={ds.embed_phase || 'embedding'} current={ds.embed_progress} total={ds.embed_total} color="bg-indigo-500" />
              )}
              {isReclustering && (
                <ProgressBar phase={ds.recluster_phase || 'clustering'} current={ds.recluster_progress} total={ds.recluster_total} color="bg-teal-500" label="Clustering :" />
              )}
              {isReducing && (
                <ProgressBar phase={ds.reduce_phase || 'umap'} current={ds.reduce_progress} total={ds.reduce_total} color="bg-indigo-500" label="Réduction :" />
              )}
              {ds.thumb_total > 0 && ds.thumb_progress < ds.thumb_total && (
                <ProgressBar phase="miniatures" current={ds.thumb_progress} total={ds.thumb_total} color="bg-cyan-500" label="Thumbnails :" />
              )}
              {isRemapping && remapEvt?.type === 'progress' && (
                <ProgressBar phase={remapEvt.phase} current={remapEvt.current} total={remapEvt.total} color="bg-amber-500" label="Carte :" />
              )}
              {isRebuilding && rebuildEvt?.type === 'progress' && (
                <ProgressBar phase={rebuildEvt.phase} current={rebuildEvt.current} total={rebuildEvt.total} color="bg-orange-500" />
              )}
              {isResetting && resetEvt?.type === 'progress' && (
                <ProgressBar phase={resetEvt.phase} current={resetEvt.current} total={resetEvt.total} color="bg-red-500" label="Reset :" />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ProgressBar({ phase, current, total, color, label = 'Phase :' }: {
  phase: string; current: number; total: number; color: string; label?: string
}) {
  return (
    <div className="mt-3">
      <div className="flex justify-between text-xs text-gray-400 mb-1">
        <span>{label} {phase}</span>
        <span>{current}/{total}</span>
      </div>
      <div className="w-full bg-gray-700 rounded-full h-1.5">
        <div className={`${color} h-1.5 rounded-full transition-all`}
          style={{ width: `${Math.round((current / Math.max(total, 1)) * 100)}%` }} />
      </div>
    </div>
  )
}
