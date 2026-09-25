// ============================================================
// pages/DatasetMap.tsx
// Carte UMAP : lasso, filtres, cluster panel, galerie sélection.
//
// Fix lasso "Tous les clusters" :
//   useCallback sur handleLassoSelect → référence stable → ScatterPlot
//   (React.memo) ne re-render pas quand selectedIds change.
// ============================================================

import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Map, Save, X, MousePointer2, Layers, ChevronRight, ZoomIn, Ban, RefreshCw, Play, RotateCcw, ChevronUp, ChevronDown } from 'lucide-react'
import { subsetsAPI, datasetsAPI, settingsAPI } from '../api/client'
import { useDataset, useDatasets, useDatasetClusters, useDatasetMap } from '../hooks/useDataset'
import { useSelectionStore } from '../hooks/useSubset'
import { useSettings } from '../hooks/useSettings'
import { useQueryClient } from '@tanstack/react-query'
import ScatterPlot, { type ColorMode, CLUSTER_COLORS } from '../components/ScatterPlot'
import FilterBar from '../components/FilterBar'
import ImageModal from '../components/ImageModal'
import { nativeImageUrl } from '../utils/nativeImage'
import type { MapPoint } from '../types/api'
import { useT } from '../i18n/useLang'

export default function DatasetMap() {
  const t = useT()
  const { id } = useParams<{ id: string }>()
  const datasetId = Number(id)

  const { data: dataset } = useDataset(datasetId)
  const { data: allDatasets } = useDatasets()          // pour la progression du recluster (poll)
  const { data: mapData, isLoading: mapLoading } = useDatasetMap(datasetId, true)
  const { data: clusterData } = useDatasetClusters(datasetId)
  const { settings } = useSettings()

  // Résumé "live" (polled) : porte recluster_progress/total/phase + cluster_method.
  const summary = allDatasets?.find(d => d.id === datasetId)

  const qc = useQueryClient()
  const { selectedIds, toggle, addMany, clear } = useSelectionStore()

  const [colorMode, setColorMode] = useState<ColorMode>('cluster')
  // Depart = Parametres > couleur par defaut de la carte ; modifiable ici sans toucher au reglage
  useEffect(() => {
    settingsAPI.get()
      .then(s => { if (s.scatter_default_color === 'cluster' || s.scatter_default_color === 'rarity' || s.scatter_default_color === 'uniform') setColorMode(s.scatter_default_color) })
      .catch(() => {})
  }, [])
  const [selectedCluster, setSelectedCluster] = useState<number | null>(null)
  const [minRarity, setMinRarity] = useState(0)
  const [maxRarity, setMaxRarity] = useState(1)
  const [subsetName, setSubsetName] = useState('')
  const [saving, setSaving] = useState(false)
  const [modalImage, setModalImage] = useState<MapPoint | null>(null)

  // ---- Recluster (depuis la carte, à droite du slider rareté) ----
  const [showRecluster, setShowRecluster] = useState(false)
  const [rMethod, setRMethod] = useState<'kmeans' | 'hdbscan'>('kmeans')
  const [rN, setRN] = useState<number>(20)
  const [rMin, setRMin] = useState<number>(5)
  const rInit = useRef(false)
  const isReclustering = (summary?.recluster_total ?? 0) > 0

  // ---- Réduction dimensionnelle (bloc indépendant du clustering) ----
  const [showReduce, setShowReduce] = useState(false)
  const [redMethod, setRedMethod] = useState<'umap' | 'tsne' | 'pca'>('umap')
  const [redNN, setRedNN] = useState<number>(15)
  const [redMinDist, setRedMinDist] = useState<number>(0.1)
  const [redPerp, setRedPerp] = useState<number>(30)
  const [redLR, setRedLR] = useState<number>(200)
  const redInit = useRef(false)
  const isReducing = (summary?.reduce_total ?? 0) > 0

  // Pré-remplir le panneau depuis la config courante (une seule fois quand connue)
  useEffect(() => {
    if (!rInit.current && summary) {
      setRMethod((summary.cluster_method as 'kmeans' | 'hdbscan') ?? 'kmeans')
      setRN(summary.n_clusters)
      setRMin(Number(summary.cluster_params?.min_cluster_size ?? 5))
      rInit.current = true
    }
  }, [summary])

  useEffect(() => {
    if (!redInit.current && summary) {
      const m = (summary.reduction_method as 'umap' | 'tsne' | 'pca') ?? (settings?.reduction_method ?? 'umap')
      setRedMethod(m)
      const p = summary.reduction_params ?? {}
      setRedNN(Number(p.n_neighbors ?? settings?.umap_n_neighbors ?? 15))
      setRedMinDist(Number(p.min_dist ?? settings?.umap_min_dist ?? 0.1))
      setRedPerp(Number(p.perplexity ?? settings?.tsne_perplexity ?? 30))
      setRedLR(Number(p.learning_rate ?? settings?.tsne_learning_rate ?? 200))
      redInit.current = true
    }
  }, [summary, settings])

  // À la fin du recluster (transition true→false), rafraîchir carte + clusters.
  const wasReclustering = useRef(false)
  useEffect(() => {
    if (wasReclustering.current && !isReclustering) {
      qc.invalidateQueries({ queryKey: ['dataset', datasetId] })
      qc.invalidateQueries({ queryKey: ['dataset-map', datasetId] })
      qc.invalidateQueries({ queryKey: ['dataset-clusters', datasetId] })
      toast.success(t('Clustering mis à jour'))
    }
    wasReclustering.current = isReclustering
  }, [isReclustering, datasetId, qc])

  // À la fin de la réduction (transition true→false), rafraîchir la carte 2D.
  const wasReducing = useRef(false)
  useEffect(() => {
    if (wasReducing.current && !isReducing) {
      qc.invalidateQueries({ queryKey: ['dataset', datasetId] })
      qc.invalidateQueries({ queryKey: ['dataset-map', datasetId] })
      toast.success(t('Carte 2D mise à jour'))
    }
    wasReducing.current = isReducing
  }, [isReducing, datasetId, qc])

  const handleReclusterMap = async () => {
    const opts = rMethod === 'hdbscan'
      ? { method: rMethod, min_cluster_size: rMin }
      : { method: rMethod, n_clusters: rN }
    try {
      const res = await datasetsAPI.recluster(datasetId, opts)
      if (res.status === 'already_running') toast(t('Clustering déjà en cours'))
      else toast.success(t('Clustering relancé'))
      qc.invalidateQueries({ queryKey: ['datasets'] })
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? String(e)
      toast.error(`${t('Erreur recluster :')} ${msg}`)
    }
  }

  const resetReclusterMap = () => {
    setRMethod((settings?.cluster_method as 'kmeans' | 'hdbscan') ?? 'kmeans')
    setRN(settings?.default_n_clusters ?? 20)
    setRMin(settings?.hdbscan_min_cluster_size ?? 5)
  }

  const handleReduceMap = async () => {
    try {
      const res = await datasetsAPI.reduce(datasetId, {
        method: redMethod,
        umap_n_neighbors: redNN,
        umap_min_dist: redMinDist,
        tsne_perplexity: redPerp,
        tsne_learning_rate: redLR,
      })
      if (res.status === 'already_running') toast(t('Réduction déjà en cours'))
      else toast.success(`${t('Réduction')} ${t('relancée')}`)
      qc.invalidateQueries({ queryKey: ['datasets'] })
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? String(e)
      toast.error(`${t('Erreur réduction :')} ${msg}`)
    }
  }

  const resetReduceMap = () => {
    setRedMethod((settings?.reduction_method as 'umap' | 'tsne' | 'pca') ?? 'umap')
    setRedNN(settings?.umap_n_neighbors ?? 15)
    setRedMinDist(settings?.umap_min_dist ?? 0.1)
    setRedPerp(settings?.tsne_perplexity ?? 30)
    setRedLR(settings?.tsne_learning_rate ?? 200)
  }

  const filteredPoints = useMemo<MapPoint[]>(() => {
    if (!mapData) return []
    return mapData.points.filter(p => {
      if (selectedCluster !== null && p.cluster_id !== selectedCluster) return false
      if (p.rarity_score !== null) {
        if (p.rarity_score < minRarity || p.rarity_score > maxRarity) return false
      }
      return true
    })
  }, [mapData, selectedCluster, minRarity, maxRarity])

  const selectedPoints = useMemo(
    () => filteredPoints.filter(p => selectedIds.has(p.image_id)),
    [filteredPoints, selectedIds]
  )

  const clusterInfo = useMemo(
    () => clusterData?.clusters.find(c => c.cluster_id === selectedCluster) ?? null,
    [clusterData, selectedCluster]
  )
  const clusterPoints = useMemo(
    () => selectedCluster !== null ? filteredPoints.slice(0, 24) : [],
    [filteredPoints, selectedCluster]
  )

  // uirevision : stable pendant la sélection, change seulement sur changement de filtre
  const uirevision = `${colorMode}-${selectedCluster ?? 'all'}-${minRarity.toFixed(2)}-${maxRarity.toFixed(2)}`

  // useCallback : référence stable → ScatterPlot (React.memo) ne re-render pas
  // quand selectedIds change → Plotly.react() n'est pas appelé → lasso préservé
  const handleLassoSelect = useCallback((imageIds: number[]) => {
    clear()
    if (imageIds.length > 0) addMany(imageIds)
  }, [clear, addMany])

  const handleSelectAllCluster = () => {
    addMany(filteredPoints.map(p => p.image_id))
    toast.success(`${filteredPoints.length} ${t('images sélectionnées')}`)
  }

  const handleUnselectAllCluster = () => {
    const clusterIds = new Set(filteredPoints.map(p => p.image_id))
    const toKeep = Array.from(selectedIds).filter(id => !clusterIds.has(id))
    clear()
    if (toKeep.length > 0) addMany(toKeep)
  }

  const [excluding, setExcluding] = useState(false)

  const handleExcludeImages = async () => {
    if (selectedIds.size === 0) return
    if (!confirm(`${t('Exclure')} ${selectedIds.size} ${t("image(s) du dataset ? Elles seront traitées comme des rejets (is_duplicate_kept=False).")}`)) return
    setExcluding(true)
    try {
      const res = await datasetsAPI.excludeImages(datasetId, Array.from(selectedIds))
      toast.success(`${res.excluded} ${t('image(s) exclues du dataset')}`)
      clear()
      qc.invalidateQueries({ queryKey: ['dataset-map', datasetId] })
      qc.invalidateQueries({ queryKey: ['datasets'] })
    } catch {
      toast.error(t("Erreur lors de l'exclusion des images"))
    } finally {
      setExcluding(false)
    }
  }

  const handleCreateSubset = async () => {
    if (!subsetName.trim()) return toast.error(t('Nom du subset requis'))
    if (selectedIds.size === 0) return toast.error(t("Sélectionnez des images d'abord"))
    setSaving(true)
    try {
      await subsetsAPI.create({
        dataset_id: datasetId,
        name: subsetName.trim(),
        image_ids: Array.from(selectedIds),
      })
      toast.success(`Subset "${subsetName}" ${t('créé')} — ${selectedIds.size} images`)
      setSubsetName('')
      clear()
    } catch {
      toast.error(t('Erreur lors de la création du subset'))
    } finally {
      setSaving(false)
    }
  }

  if (!dataset?.umap_cached) {
    return (
      <div className="p-6 flex items-center justify-center h-64 text-gray-500">
        <div className="text-center">
          <Map size={48} className="mx-auto mb-3 opacity-30" />
          <p>{t('Carte non calculée pour ce dataset.')}</p>
          <p className="text-sm mt-1">{t('Lancez les embeddings depuis le Dashboard.')}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen p-4 gap-3">
      {/* Header */}
      <div className="flex-shrink-0 flex items-center justify-between">
        <h1 className="text-xl font-bold text-white flex items-center gap-2">
          <Map size={20} /> {dataset?.name} — {t('Carte')} {(summary?.reduction_method ?? dataset?.reduction_method ?? settings?.reduction_method ?? 'umap').toUpperCase()}
        </h1>
        <div className="flex items-center gap-3">
          {selectedIds.size > 0 && (
            <span className="px-3 py-1 rounded-full text-sm bg-amber-600/20 text-amber-300 border border-amber-600/40 font-medium">
              {selectedIds.size} {t('sélectionnée(s)')}
            </span>
          )}
          <span className="text-gray-500 text-xs">{filteredPoints.length} points</span>
        </div>
      </div>

      {/* Filtres */}
      <div className="flex-shrink-0 space-y-2">
        <div className="flex items-center gap-2 text-xs text-gray-500 bg-gray-900/60 px-3 py-1.5 rounded-lg border border-gray-800">
          <MousePointer2 size={12} className="flex-shrink-0" />
          <span>{t('Utilisez le')} <strong className="text-gray-400">lasso Plotly</strong> {t('pour sélectionner des points, puis nommez et créez le subset ci-dessous.')}</span>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <FilterBar
            colorMode={colorMode}
            onColorModeChange={setColorMode}
            clusters={clusterData?.clusters ?? []}
            selectedCluster={selectedCluster}
            onClusterChange={c => { setSelectedCluster(c); clear() }}
            minRarity={minRarity}
            maxRarity={maxRarity}
            onRarityChange={(min, max) => { setMinRarity(min); setMaxRarity(max) }}
          />
          {/* Relancer le clustering — à droite du slider rareté */}
          <div className="flex items-center gap-2">
            <span className="text-gray-500 text-xs whitespace-nowrap">
              {summary ? clusterLabelOf(summary.cluster_method, summary.cluster_params, summary.n_clusters) : `${dataset?.n_clusters ?? ''} clusters`}
            </span>
            <button
              onClick={() => setShowRecluster(s => !s)}
              className={`flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-lg transition-colors
                ${showRecluster ? 'bg-teal-600/30 text-teal-300 border border-teal-600/40' : 'bg-teal-600/15 text-teal-400 border border-teal-600/30 hover:bg-teal-600/25'}`}
              title={t('Relancer le clustering (sur les embeddings CLIP 512D)')}>
              <RefreshCw size={12} /> Clustering {showRecluster ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
            </button>
          </div>
          {/* Relancer la réduction 2D — bloc indépendant */}
          <div className="flex items-center gap-2">
            <span className="text-gray-500 text-xs whitespace-nowrap">
              {reductionLabelOf(summary?.reduction_method ?? settings?.reduction_method ?? null, summary?.reduction_params)}
            </span>
            <button
              onClick={() => setShowReduce(s => !s)}
              className={`flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-lg transition-colors
                ${showReduce ? 'bg-indigo-600/30 text-indigo-300 border border-indigo-600/40' : 'bg-indigo-600/15 text-indigo-400 border border-indigo-600/30 hover:bg-indigo-600/25'}`}
              title={t('Relancer la réduction 2D (UMAP / t-SNE / PCA)')}>
              <RefreshCw size={12} /> {t('Réduction')} {showReduce ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
            </button>
          </div>
        </div>

        {/* Panneau recluster */}
        {showRecluster && (
          <div className="flex items-center gap-3 flex-wrap bg-gray-900/60 rounded-lg px-3 py-2 border border-teal-600/20">
            <div className="flex rounded-lg overflow-hidden border border-gray-600">
              {(['kmeans', 'hdbscan'] as const).map(m => (
                <button key={m} onClick={() => setRMethod(m)}
                  className={`px-2.5 py-1 text-xs font-mono transition-colors
                    ${rMethod === m ? 'bg-teal-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}>
                  {m === 'kmeans' ? 'KMeans' : 'HDBSCAN'}
                </button>
              ))}
            </div>
            {rMethod === 'kmeans' ? (
              <>
                <input type="range" min={2} max={100} value={rN}
                  onChange={e => setRN(Number(e.target.value))} className="w-28 accent-teal-500" />
                <input type="number" min={2} max={200} value={rN}
                  onChange={e => setRN(Math.max(2, Number(e.target.value)))}
                  className="w-16 bg-gray-900 border border-gray-600 rounded px-2 py-1 text-xs text-gray-200 text-center" />
                <span className="text-gray-500 text-xs">clusters</span>
              </>
            ) : (
              <>
                <span className="text-gray-400 text-xs whitespace-nowrap">min_cluster_size</span>
                <input type="number" min={2} max={200} value={rMin}
                  onChange={e => setRMin(Math.max(2, Number(e.target.value)))}
                  className="w-16 bg-gray-900 border border-gray-600 rounded px-2 py-1 text-xs text-gray-200 text-center" />
              </>
            )}
            <button onClick={handleReclusterMap} disabled={isReclustering}
              className="flex items-center gap-1 px-3 py-1 bg-teal-600 hover:bg-teal-500 text-white text-xs rounded-lg disabled:opacity-50 whitespace-nowrap">
              {isReclustering ? <><RefreshCw size={11} className="animate-spin" /> {t('En cours...')}</> : <><Play size={11} /> {t('Relancer')}</>}
            </button>
            <button onClick={resetReclusterMap}
              className="flex items-center gap-1 px-2 py-1 text-xs text-gray-400 hover:text-white border border-gray-600 rounded-lg">
              <RotateCcw size={11} /> {t('Défaut')}
            </button>
          </div>
        )}

        {/* Barre de progression du recluster */}
        {isReclustering && (
          <div>
            <div className="flex justify-between text-xs text-gray-400 mb-1">
              <span>{t('Clustering :')} {summary?.recluster_phase || 'clustering'}</span>
              <span>{summary?.recluster_progress}/{summary?.recluster_total}</span>
            </div>
            <div className="w-full bg-gray-700 rounded-full h-1.5">
              <div className="bg-teal-500 h-1.5 rounded-full transition-all"
                style={{ width: `${Math.round(((summary?.recluster_progress ?? 0) / Math.max(summary?.recluster_total ?? 1, 1)) * 100)}%` }} />
            </div>
          </div>
        )}

        {/* Panneau réduction dimensionnelle */}
        {showReduce && (
          <div className="flex items-center gap-3 flex-wrap bg-gray-900/60 rounded-lg px-3 py-2 border border-indigo-600/20">
            <div className="flex rounded-lg overflow-hidden border border-gray-600">
              {(['umap', 'tsne', 'pca'] as const).map(m => (
                <button key={m} onClick={() => setRedMethod(m)}
                  className={`px-2.5 py-1 text-xs font-mono transition-colors uppercase
                    ${redMethod === m ? 'bg-indigo-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}>
                  {m}
                </button>
              ))}
            </div>
            {redMethod === 'umap' && (
              <>
                <span className="text-gray-400 text-xs whitespace-nowrap">n_neighbors</span>
                <input type="number" min={2} max={200} value={redNN}
                  onChange={e => setRedNN(Math.max(2, Number(e.target.value)))}
                  className="w-16 bg-gray-900 border border-gray-600 rounded px-2 py-1 text-xs text-gray-200 text-center" />
                <span className="text-gray-400 text-xs whitespace-nowrap">min_dist</span>
                <input type="number" min={0} max={1} step={0.05} value={redMinDist}
                  onChange={e => setRedMinDist(Math.max(0, Number(e.target.value)))}
                  className="w-16 bg-gray-900 border border-gray-600 rounded px-2 py-1 text-xs text-gray-200 text-center" />
              </>
            )}
            {redMethod === 'tsne' && (
              <>
                <span className="text-gray-400 text-xs whitespace-nowrap">perplexity</span>
                <input type="number" min={2} max={100} value={redPerp}
                  onChange={e => setRedPerp(Math.max(2, Number(e.target.value)))}
                  className="w-16 bg-gray-900 border border-gray-600 rounded px-2 py-1 text-xs text-gray-200 text-center" />
                <span className="text-gray-400 text-xs whitespace-nowrap">learning_rate</span>
                <input type="number" min={1} max={1000} step={10} value={redLR}
                  onChange={e => setRedLR(Math.max(1, Number(e.target.value)))}
                  className="w-20 bg-gray-900 border border-gray-600 rounded px-2 py-1 text-xs text-gray-200 text-center" />
              </>
            )}
            {redMethod === 'pca' && (
              <span className="text-gray-500 text-xs">{t('Aucun hyperparamètre (2 composantes)')}</span>
            )}
            <button onClick={handleReduceMap} disabled={isReducing}
              className="flex items-center gap-1 px-3 py-1 bg-indigo-600 hover:bg-indigo-500 text-white text-xs rounded-lg disabled:opacity-50 whitespace-nowrap">
              {isReducing ? <><RefreshCw size={11} className="animate-spin" /> {t('En cours...')}</> : <><Play size={11} /> {t('Relancer')}</>}
            </button>
            <button onClick={resetReduceMap}
              className="flex items-center gap-1 px-2 py-1 text-xs text-gray-400 hover:text-white border border-gray-600 rounded-lg">
              <RotateCcw size={11} /> {t('Défaut')}
            </button>
          </div>
        )}

        {/* Barre de progression de la réduction */}
        {isReducing && (
          <div>
            <div className="flex justify-between text-xs text-gray-400 mb-1">
              <span>{t('Réduction :')} {summary?.reduce_phase || 'umap'}</span>
              <span>{summary?.reduce_progress}/{summary?.reduce_total}</span>
            </div>
            <div className="w-full bg-gray-700 rounded-full h-1.5">
              <div className="bg-indigo-500 h-1.5 rounded-full transition-all"
                style={{ width: `${Math.round(((summary?.reduce_progress ?? 0) / Math.max(summary?.reduce_total ?? 1, 1)) * 100)}%` }} />
            </div>
          </div>
        )}
      </div>

      {/* Panel cluster */}
      {selectedCluster !== null && clusterInfo && (
        <div className="flex-shrink-0 bg-gray-800 rounded-xl border border-gray-700 p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: CLUSTER_COLORS[selectedCluster % CLUSTER_COLORS.length] }} />
              <span className="text-white text-sm font-medium">
                Cluster {selectedCluster} — <span className="text-gray-400">{clusterInfo.count} images</span>
                {clusterInfo.avg_rarity != null && (
                  <span className="text-gray-500 ml-2 text-xs">{t('rareté moy.')} {Math.round(clusterInfo.avg_rarity * 100)}%</span>
                )}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={handleSelectAllCluster}
                className="flex items-center gap-1.5 px-3 py-1 bg-indigo-600/20 text-indigo-400 border border-indigo-600/40 text-xs rounded-lg hover:bg-indigo-600/30 transition-colors">
                <Layers size={12} /> {t('Tout sélectionner')} ({filteredPoints.length})
              </button>
              <button onClick={handleUnselectAllCluster}
                className="flex items-center gap-1.5 px-3 py-1 bg-gray-700 text-gray-400 text-xs rounded-lg hover:bg-gray-600 transition-colors">
                <X size={12} /> {t('Tout désélectionner')}
              </button>
              <button onClick={() => setSelectedCluster(null)} className="text-gray-500 hover:text-white p-1">
                <X size={14} />
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <div className="flex gap-2 pb-1" style={{ minWidth: 'max-content' }}>
              {clusterPoints.map(p => (
                <ClusterThumb key={p.image_id} point={p} selected={selectedIds.has(p.image_id)}
                  onToggle={() => toggle(p.image_id)} onZoom={() => setModalImage(p)} />
              ))}
              {filteredPoints.length > 24 && (
                <div className="flex-shrink-0 w-16 h-14 rounded border border-gray-700 flex items-center justify-center text-gray-500 text-xs">
                  +{filteredPoints.length - 24}<ChevronRight size={10} />
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Zone principale */}
      <div className="flex-1 min-h-0 flex flex-col gap-3">
        <div className="flex-1 min-h-[300px] bg-gray-900 rounded-xl border border-gray-700 overflow-hidden">
          {mapLoading ? (
            <div className="flex items-center justify-center h-full text-gray-500">{t('Chargement de la carte...')}</div>
          ) : (
            <ScatterPlot
              points={filteredPoints}
              colorMode={colorMode}
              uirevision={uirevision}
              onSelected={handleLassoSelect}
              height={undefined}
            />
          )}
        </div>

        {/* Panel sélection */}
        {selectedIds.size > 0 && (
          <div className="flex-shrink-0 bg-gray-800 rounded-xl border border-amber-600/30 p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-amber-300 font-medium text-sm">{selectedIds.size} {t('image(s) sélectionnée(s)')}</span>
              <div className="flex items-center gap-2">
                <input type="text" placeholder={t('Nom du subset...')} value={subsetName}
                  onChange={e => setSubsetName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleCreateSubset()}
                  className="bg-gray-900 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-gray-200 placeholder-gray-500 focus:ring-2 focus:ring-indigo-500 w-48" />
                <button onClick={handleCreateSubset} disabled={saving}
                  className="flex items-center gap-1.5 px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm rounded-lg transition-colors disabled:opacity-50 font-medium whitespace-nowrap">
                  <Save size={14} /> {t('Créer subset')}
                </button>
                <button
                  onClick={handleExcludeImages}
                  disabled={excluding}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600/20 text-red-400 border border-red-600/40 text-sm rounded-lg hover:bg-red-600/30 transition-colors disabled:opacity-50 whitespace-nowrap"
                  title={t('Exclure ces images du dataset (traitées comme des rejets)')}
                >
                  <Ban size={14} /> {t('Exclure du dataset')}
                </button>
                <button onClick={clear} className="p-1.5 text-gray-500 hover:text-white" title={t('Effacer sélection')}>
                  <X size={16} />
                </button>
              </div>
            </div>
            {selectedPoints.length > 0 && (
              <div className="overflow-x-auto">
                <div className="flex gap-2 pb-1" style={{ minWidth: 'max-content' }}>
                  {selectedPoints.map(p => (
                    <SelCard key={p.image_id} point={p} onZoom={() => setModalImage(p)} onDeselect={() => toggle(p.image_id)} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {modalImage && (
        <ImageModal
          imageUrl={modalImage.thumbnail_url ?? ''}
          fullUrl={nativeImageUrl(
            `/api/datasets/${datasetId}/images/${modalImage.image_id}/full`,
            `/api/datasets/${datasetId}/images/${modalImage.image_id}/full-path`,
          )}
          filename={modalImage.filename}
          info={{ cluster_id: modalImage.cluster_id, rarity_score: modalImage.rarity_score, metadata: modalImage.metadata }}
          onClose={() => setModalImage(null)}
        />
      )}
    </div>
  )
}

function clusterLabelOf(method: string | null, params: Record<string, number> | undefined, nClusters: number): string {
  if (!method) return `${nClusters} clusters`
  if (method === 'hdbscan') return `HDBSCAN (min ${params?.min_cluster_size ?? 5}) · ${nClusters} clusters`
  return `KMeans k=${params?.n_clusters ?? nClusters}`
}

function reductionLabelOf(method: string | null, params: Record<string, number> | undefined): string {
  const m = (method ?? 'umap').toLowerCase()
  if (m === 'tsne') return `t-SNE (perp ${params?.perplexity ?? 30})`
  if (m === 'pca') return 'PCA'
  return `UMAP (nn ${params?.n_neighbors ?? 15}, d ${params?.min_dist ?? 0.1})`
}

function ClusterThumb({ point, selected, onToggle, onZoom }: {
  point: MapPoint; selected: boolean; onToggle: () => void; onZoom: () => void
}) {
  return (
    <div onClick={onToggle} title={point.filename}
      className={`flex-shrink-0 w-16 h-14 rounded overflow-hidden border-2 transition-colors relative group cursor-pointer
        ${selected ? 'border-amber-400' : 'border-gray-600 hover:border-gray-400'}`}>
      {point.thumbnail_url
        ? <img src={point.thumbnail_url} alt={point.filename} className="w-full h-full object-cover" loading="lazy" />
        : <div className="w-full h-full bg-gray-700" />}
      {selected && (
        <div className="absolute top-0.5 right-0.5 w-4 h-4 bg-amber-400 rounded-sm flex items-center justify-center">
          <span className="text-black text-xs font-bold leading-none">✓</span>
        </div>
      )}
      <button className="absolute bottom-0.5 right-0.5 bg-black/60 rounded p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={e => { e.stopPropagation(); onZoom() }}>
        <ZoomIn size={10} className="text-white" />
      </button>
    </div>
  )
}

function SelCard({ point, onZoom, onDeselect }: {
  point: MapPoint; onZoom: () => void; onDeselect: () => void
}) {
  const t = useT()
  return (
    <div className="flex-shrink-0 w-24 rounded-lg overflow-hidden border-2 border-amber-500 group">
      <div className="aspect-video bg-gray-900 relative cursor-pointer" onClick={onZoom}>
        {point.thumbnail_url
          ? <img src={point.thumbnail_url} alt={point.filename} className="w-full h-full object-cover" loading="lazy" />
          : <div className="w-full h-full bg-gray-800" />}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/25 transition-colors" />
      </div>
      <div className="px-1 py-0.5 bg-gray-900 cursor-pointer" onClick={onDeselect} title={t('Désélectionner')}>
        <p className="text-white text-xs truncate leading-tight">{point.filename}</p>
        <div className="flex gap-1 flex-wrap">
          {point.cluster_id !== null && <span className="text-indigo-400 text-xs">C{point.cluster_id}</span>}
          {point.rarity_score !== null && <span className="text-amber-400 text-xs">{Math.round((point.rarity_score ?? 0) * 100)}%</span>}
        </div>
      </div>
    </div>
  )
}
