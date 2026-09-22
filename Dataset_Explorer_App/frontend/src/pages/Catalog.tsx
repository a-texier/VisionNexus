// ============================================================
// pages/Catalog.tsx
// Le catalogue vu comme UN SEUL ensemble, pas comme N datasets isolés :
//   - recherche visuelle CLIP à travers tous les datasets indexés ;
//   - recherche par métadonnées CSV (colonnes hétérogènes incluses) ;
//   - doublons présents dans PLUSIEURS datasets à la fois.
// Chaque onglet sait créer un subset depuis sa sélection.
// ============================================================

import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  Search, Database, Copy, Loader2, Filter, Layers,
  AlertTriangle, RefreshCw, Check, X,
} from 'lucide-react'

import { catalogAPI, datasetsAPI, metadataAPI, subsetsAPI } from '../api/client'
import type {
  GlobalDuplicatesResponse, GlobalSearchResponse, MetadataSearchResponse,
} from '../types/api'
import { useT } from '../i18n/useLang'

type Tab = 'visual' | 'metadata' | 'duplicates'

const TABS: { id: Tab; label: string; icon: JSX.Element }[] = [
  { id: 'visual', label: 'Recherche visuelle', icon: <Search size={15} /> },
  { id: 'metadata', label: 'Métadonnées', icon: <Filter size={15} /> },
  { id: 'duplicates', label: 'Doublons cross-dataset', icon: <Copy size={15} /> },
]

// ------------------------------------------------------------------ //
// Sélecteur de datasets (partagé par les onglets)                     //
// ------------------------------------------------------------------ //

function DatasetPicker({
  datasets, selected, onChange,
}: {
  datasets: { id: number; name: string }[]
  selected: number[]
  onChange: (ids: number[]) => void
}) {
  const t = useT()
  if (!datasets.length) return null
  const toggle = (id: number) =>
    onChange(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id])

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs text-gray-500">{t('Restreindre à :')}</span>
      <button
        onClick={() => onChange([])}
        className={`px-2 py-0.5 rounded text-xs border ${
          selected.length === 0
            ? 'bg-indigo-600 text-white border-indigo-500'
            : 'bg-gray-800 text-gray-400 border-gray-700 hover:text-white'
        }`}
      >
        {t('tous')}
      </button>
      {datasets.map(d => (
        <button
          key={d.id}
          onClick={() => toggle(d.id)}
          className={`px-2 py-0.5 rounded text-xs border ${
            selected.includes(d.id)
              ? 'bg-indigo-600 text-white border-indigo-500'
              : 'bg-gray-800 text-gray-400 border-gray-700 hover:text-white'
          }`}
        >
          {d.name}
        </button>
      ))}
    </div>
  )
}

// ------------------------------------------------------------------ //
// Vignette de résultat (commune recherche visuelle / métadonnées)      //
// ------------------------------------------------------------------ //

function ResultCard({
  imageId, datasetName, filename, thumb, badge, selected, onToggle, subtitle,
}: {
  imageId: number
  datasetName: string
  filename: string
  thumb: string | null
  badge?: string
  selected: boolean
  onToggle: () => void
  subtitle?: string
}) {
  const t = useT()
  return (
    <div
      onClick={onToggle}
      className={`relative bg-gray-900 rounded-lg overflow-hidden border cursor-pointer transition-colors ${
        selected ? 'border-indigo-500' : 'border-gray-800 hover:border-gray-700'
      }`}
      title={`${filename} — ${datasetName}`}
    >
      <div className="aspect-square bg-gray-950 flex items-center justify-center">
        {thumb
          ? <img src={thumb} alt={filename} loading="lazy" className="w-full h-full object-cover" />
          : <span className="text-gray-700 text-xs">{t('pas de miniature')}</span>}
      </div>
      {selected && (
        <div className="absolute top-1 right-1 bg-indigo-600 rounded-full p-0.5">
          <Check size={12} className="text-white" />
        </div>
      )}
      {badge && (
        <span className="absolute top-1 left-1 px-1.5 py-0.5 bg-black/70 text-indigo-300 text-[10px] rounded">
          {badge}
        </span>
      )}
      <div className="p-1.5">
        <p className="text-[11px] text-gray-300 truncate">{filename}</p>
        <p className="text-[10px] text-gray-500 truncate">{datasetName}</p>
        {subtitle && <p className="text-[10px] text-teal-400 truncate">{subtitle}</p>}
      </div>
      <span className="hidden">{imageId}</span>
    </div>
  )
}

// ------------------------------------------------------------------ //
// Barre "créer un subset depuis la sélection"                          //
// ------------------------------------------------------------------ //

function SelectionBar({
  selection, onClear,
}: {
  selection: Map<number, number>   // image_id -> dataset_id
  onClear: () => void
}) {
  const t = useT()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  const byDataset = useMemo(() => {
    const m = new Map<number, number[]>()
    selection.forEach((dsId, imgId) => {
      m.set(dsId, [...(m.get(dsId) ?? []), imgId])
    })
    return m
  }, [selection])

  if (selection.size === 0) return null

  const create = async () => {
    const base = name.trim()
    if (!base) return toast.error(t('Nom de subset requis'))
    setBusy(true)
    try {
      // Un subset appartient à un dataset : une sélection couvrant plusieurs
      // datasets produit un subset par dataset, suffixé par son nom.
      const entries = [...byDataset.entries()]
      for (const [dsId, ids] of entries) {
        const suffix = entries.length > 1 ? `_ds${dsId}` : ''
        await subsetsAPI.create({ dataset_id: dsId, name: base + suffix, image_ids: ids })
      }
      toast.success(
        entries.length > 1
          ? `${entries.length} ${t('subsets créés (un par dataset)')}`
          : `Subset "${base}" ${t('créé')}`,
      )
      onClear()
      setName('')
    } catch (e: any) {
      toast.error(e?.response?.data?.detail ?? t('Création échouée'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="sticky bottom-0 mt-4 bg-gray-900 border border-indigo-600/40 rounded-lg p-3 flex items-center gap-3 flex-wrap">
      <Layers size={16} className="text-indigo-400" />
      <span className="text-sm text-indigo-300">
        {selection.size} image(s) — {byDataset.size} dataset(s)
      </span>
      <input
        value={name}
        onChange={e => setName(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && create()}
        placeholder={t('nom du subset')}
        className="flex-1 min-w-[160px] bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-white"
      />
      <button
        onClick={create}
        disabled={busy}
        className="px-3 py-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm rounded"
      >
        {busy ? t('Création…') : t('Créer subset')}
      </button>
      <button onClick={onClear} className="text-gray-400 hover:text-white" title={t('Vider la sélection')}>
        <X size={16} />
      </button>
    </div>
  )
}

// ------------------------------------------------------------------ //
// Onglet 1 — recherche visuelle globale                                //
// ------------------------------------------------------------------ //

function VisualTab({ datasets }: { datasets: { id: number; name: string }[] }) {
  const t = useT()
  const [query, setQuery] = useState('')
  const [topK, setTopK] = useState(60)
  const [useThreshold, setUseThreshold] = useState(false)
  const [threshold, setThreshold] = useState(28)
  const [dsFilter, setDsFilter] = useState<number[]>([])
  const [res, setRes] = useState<GlobalSearchResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [selection, setSelection] = useState<Map<number, number>>(new Map())

  const run = async () => {
    if (!query.trim()) return toast.error(t('Saisir une requête'))
    setLoading(true)
    try {
      const r = await catalogAPI.searchGlobal({
        query: query.trim(),
        top_k: topK,
        min_score: useThreshold ? threshold / 100 : null,
        dataset_ids: dsFilter.length ? dsFilter : null,
      })
      setRes(r)
      if (!r.results.length) toast(t('Aucun résultat'), { icon: 'ℹ️' })
    } catch (e: any) {
      toast.error(e?.response?.data?.detail ?? t('Recherche échouée'))
    } finally {
      setLoading(false)
    }
  }

  const toggle = (imageId: number, datasetId: number) => {
    setSelection(prev => {
      const next = new Map(prev)
      if (next.has(imageId)) next.delete(imageId)
      else next.set(imageId, datasetId)
      return next
    })
  }

  return (
    <div>
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-3">
        <div className="flex gap-2">
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && run()}
            placeholder={t('ex : drone au-dessus de la forêt, véhicule rouge, ciel nuageux…')}
            className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-white"
          />
          <button
            onClick={run}
            disabled={loading}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm rounded flex items-center gap-2"
          >
            {loading ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
            {t('Rechercher')}
          </button>
        </div>

        <div className="flex items-center gap-4 flex-wrap text-sm">
          <label className="flex items-center gap-2 text-gray-400">
            <input type="checkbox" checked={!useThreshold} onChange={() => setUseThreshold(false)} />
            Top-K
            <input
              type="number" min={1} max={500} value={topK} disabled={useThreshold}
              onChange={e => setTopK(Math.max(1, Math.min(500, Number(e.target.value))))}
              className="w-16 bg-gray-800 border border-gray-700 rounded px-1.5 py-0.5 text-white disabled:opacity-40"
            />
          </label>
          <label className="flex items-center gap-2 text-gray-400">
            <input type="checkbox" checked={useThreshold} onChange={() => setUseThreshold(true)} />
            {t('Seuil')}
            <input
              type="number" min={1} max={99} value={threshold} disabled={!useThreshold}
              onChange={e => setThreshold(Math.max(1, Math.min(99, Number(e.target.value))))}
              className="w-16 bg-gray-800 border border-gray-700 rounded px-1.5 py-0.5 text-white disabled:opacity-40"
            />
            %
          </label>
        </div>

        <DatasetPicker datasets={datasets} selected={dsFilter} onChange={setDsFilter} />
      </div>

      {res && (
        <div className="mt-4">
          <div className="flex items-center gap-3 flex-wrap text-xs text-gray-400 mb-2">
            <span className="text-gray-300">{res.results.length} {t('résultat(s)')}</span>
            <span>{t('index global :')} {res.indexed_vectors.toLocaleString('fr-FR')} {t('vecteurs sur')} {res.indexed_datasets.length} {t('dataset(s)')}</span>
            {Object.entries(res.dataset_counts).map(([id, n]) => (
              <span key={id} className="px-1.5 py-0.5 bg-gray-800 rounded border border-gray-700">
                {res.results.find(r => String(r.dataset_id) === id)?.dataset_name ?? `#${id}`} : {n}
              </span>
            ))}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-2">
            {res.results.map(r => (
              <ResultCard
                key={`${r.dataset_id}-${r.image_id}`}
                imageId={r.image_id}
                datasetName={r.dataset_name}
                filename={r.filename}
                thumb={r.thumbnail_url}
                badge={`${(r.score * 100).toFixed(1)}%`}
                selected={selection.has(r.image_id)}
                onToggle={() => toggle(r.image_id, r.dataset_id)}
              />
            ))}
          </div>
        </div>
      )}

      <SelectionBar selection={selection} onClear={() => setSelection(new Map())} />
    </div>
  )
}

// ------------------------------------------------------------------ //
// Onglet 2 — métadonnées CSV                                           //
// ------------------------------------------------------------------ //

function MetadataTab({ datasets }: { datasets: { id: number; name: string }[] }) {
  const t = useT()
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState<'and' | 'or'>('and')
  const [dsFilter, setDsFilter] = useState<number[]>([])
  const [res, setRes] = useState<MetadataSearchResponse | null>(null)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(false)
  const [selection, setSelection] = useState<Map<number, number>>(new Map())
  const [facetColumn, setFacetColumn] = useState<string>('')
  const LIMIT = 60

  const { data: columns } = useQuery({
    queryKey: ['metadata-columns'],
    queryFn: () => metadataAPI.columns(),
  })

  const { data: facets, isFetching: facetsLoading } = useQuery({
    queryKey: ['metadata-facets', facetColumn, dsFilter],
    queryFn: () => metadataAPI.facets(facetColumn, dsFilter.length ? dsFilter : undefined),
    enabled: !!facetColumn,
  })

  const run = async (targetPage = 0, q = query) => {
    if (!q.trim()) return toast.error(t('Saisir un mot-clé'))
    setLoading(true)
    try {
      const r = await metadataAPI.search({
        query: q.trim(),
        mode,
        dataset_ids: dsFilter.length ? dsFilter : null,
        limit: LIMIT,
        offset: targetPage * LIMIT,
      })
      setRes(r)
      setPage(targetPage)
      if (!r.total) toast(t('Aucun résultat'), { icon: 'ℹ️' })
    } catch (e: any) {
      toast.error(e?.response?.data?.detail ?? t('Recherche échouée'))
    } finally {
      setLoading(false)
    }
  }

  const toggle = (imageId: number, datasetId: number) => {
    setSelection(prev => {
      const next = new Map(prev)
      if (next.has(imageId)) next.delete(imageId)
      else next.set(imageId, datasetId)
      return next
    })
  }

  const totalPages = res ? Math.ceil(res.total / LIMIT) : 0
  const hasColumns = (columns?.columns.length ?? 0) > 0

  return (
    <div>
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-3">
        {!hasColumns && (
          <p className="text-xs text-amber-400 flex items-center gap-2">
            <AlertTriangle size={13} />
            {t("Aucun dataset n'a de métadonnées CSV/Excel associées — associez un fichier à l'import pour rendre ces colonnes cherchables ici.")}
          </p>
        )}

        <div className="flex gap-2">
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && run(0)}
            placeholder={t('mot-clé, valeur ou nom de colonne (ex : zone_forestiere brouillard)')}
            className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-white"
          />
          <select
            value={mode}
            onChange={e => setMode(e.target.value as 'and' | 'or')}
            className="bg-gray-800 border border-gray-700 rounded px-2 text-sm text-white"
            title={t('AND : tous les mots. OR : au moins un.')}
          >
            <option value="and">{t('tous les mots')}</option>
            <option value="or">{t('au moins un')}</option>
          </select>
          <button
            onClick={() => run(0)}
            disabled={loading}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm rounded flex items-center gap-2"
          >
            {loading ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
            {t('Chercher')}
          </button>
        </div>

        <DatasetPicker datasets={datasets} selected={dsFilter} onChange={setDsFilter} />

        {hasColumns && (
          <div className="border-t border-gray-800 pt-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-gray-500">{t('Explorer une colonne :')}</span>
              {columns!.columns.map(c => (
                <button
                  key={c.column}
                  onClick={() => setFacetColumn(facetColumn === c.column ? '' : c.column)}
                  className={`px-2 py-0.5 rounded text-xs border ${
                    facetColumn === c.column
                      ? 'bg-teal-600 text-white border-teal-500'
                      : 'bg-gray-800 text-gray-400 border-gray-700 hover:text-white'
                  }`}
                  title={`${t('présente dans :')} ${c.dataset_names.join(', ')}`}
                >
                  {c.column}
                  <span className="text-[10px] opacity-60 ml-1">({c.datasets.length})</span>
                </button>
              ))}
            </div>

            {Object.keys(columns!.groups).length > 0 && (
              <p className="text-[11px] text-gray-500 mt-2">
                {t('Colonnes rapprochées automatiquement :')}{' '}
                {Object.entries(columns!.groups).map(([pivot, variants]) => (
                  <span key={pivot} className="mr-2">
                    <span className="text-gray-300">{pivot}</span> ≈ {variants.join(', ')}
                  </span>
                ))}
              </p>
            )}

            {facetColumn && (
              <div className="mt-2 flex items-center gap-2 flex-wrap">
                {facetsLoading && <Loader2 size={13} className="animate-spin text-gray-500" />}
                {facets?.values.map(v => (
                  <button
                    key={v.value}
                    onClick={() => { setQuery(v.value); run(0, v.value) }}
                    className="px-2 py-0.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded text-xs text-gray-300"
                  >
                    {v.value} <span className="text-teal-400">{v.count}</span>
                  </button>
                ))}
                {facets && facets.values.length === 0 && (
                  <span className="text-xs text-gray-600">{t('aucune valeur')}</span>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {res && (
        <div className="mt-4">
          <div className="flex items-center gap-3 flex-wrap text-xs text-gray-400 mb-2">
            <span className="text-gray-300">{res.total} {t('résultat(s)')}</span>
            {totalPages > 1 && (
              <span className="flex items-center gap-1">
                {t('page')} {page + 1}/{totalPages}
                <button
                  disabled={page === 0 || loading}
                  onClick={() => run(page - 1)}
                  className="px-1.5 py-0.5 bg-gray-800 border border-gray-700 rounded disabled:opacity-30"
                >{t('précédent')}</button>
                <button
                  disabled={page + 1 >= totalPages || loading}
                  onClick={() => run(page + 1)}
                  className="px-1.5 py-0.5 bg-gray-800 border border-gray-700 rounded disabled:opacity-30"
                >{t('suivant')}</button>
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-2">
            {res.items.map(it => (
              <ResultCard
                key={`${it.dataset_id}-${it.image_id}`}
                imageId={it.image_id}
                datasetName={it.dataset_name}
                filename={it.filename}
                thumb={it.thumbnail_url}
                subtitle={Object.entries(it.metadata).slice(0, 2).map(([k, v]) => `${k}: ${v}`).join(' · ')}
                selected={selection.has(it.image_id)}
                onToggle={() => toggle(it.image_id, it.dataset_id)}
              />
            ))}
          </div>
        </div>
      )}

      <SelectionBar selection={selection} onClear={() => setSelection(new Map())} />
    </div>
  )
}

// ------------------------------------------------------------------ //
// Onglet 3 — doublons cross-dataset                                    //
// ------------------------------------------------------------------ //

function DuplicatesTab() {
  const t = useT()
  const [threshold, setThreshold] = useState(99)
  const [pending, setPending] = useState(99)
  const [crossOnly, setCrossOnly] = useState(true)
  const [res, setRes] = useState<GlobalDuplicatesResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [decisions, setDecisions] = useState<Record<number, boolean>>({})
  const [elapsed, setElapsed] = useState(0)

  // Le calcul peut durer sur un gros catalogue : afficher le temps écoulé
  // vaut mieux qu'un spinner muet (on ne connaît pas la durée à l'avance).
  useEffect(() => {
    if (!loading) return
    setElapsed(0)
    const t = setInterval(() => setElapsed(e => e + 1), 1000)
    return () => clearInterval(t)
  }, [loading])

  const run = async () => {
    setLoading(true)
    try {
      const r = await catalogAPI.globalDuplicates({
        threshold: threshold / 100,
        cross_only: crossOnly,
        max_groups: 50,
      })
      setRes(r)
      setDecisions({})
      if (!r.group_count) {
        toast(crossOnly
          ? t('Aucun doublon présent dans plusieurs datasets à ce seuil')
          : t('Aucun doublon à ce seuil'), { icon: 'ℹ️' })
      }
    } catch (e: any) {
      toast.error(e?.response?.data?.detail ?? t('Analyse échouée'))
    } finally {
      setLoading(false)
    }
  }

  const save = async () => {
    const entries = Object.entries(decisions)
    if (!entries.length) return toast.error(t('Aucune décision à enregistrer'))
    try {
      const r = await catalogAPI.patchGlobalDuplicateDecision(
        entries.map(([id, keep]) => ({ image_id: Number(id), keep })),
      )
      toast.success(`${r.updated} ${t('décision(s) enregistrée(s)')}`)
    } catch (e: any) {
      toast.error(e?.response?.data?.detail ?? t('Enregistrement échoué'))
    }
  }

  return (
    <div>
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <label className="text-sm text-gray-400 flex items-center gap-2">
            {t('Seuil de similarité')}
            <input
              type="range" min={80} max={100} step={0.5} value={pending}
              onChange={e => setPending(Number(e.target.value))}
              className="w-48"
            />
            <input
              type="number" min={80} max={100} step={0.5} value={pending}
              onChange={e => setPending(Number(e.target.value))}
              className="w-16 bg-gray-800 border border-gray-700 rounded px-1.5 py-0.5 text-white text-sm"
            />%
          </label>
          <label className="text-sm text-gray-400 flex items-center gap-2">
            <input type="checkbox" checked={crossOnly} onChange={e => setCrossOnly(e.target.checked)} />
            {t('uniquement les groupes couvrant plusieurs datasets')}
          </label>
          <button
            onClick={() => { setThreshold(pending); setTimeout(run, 0) }}
            disabled={loading}
            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm rounded flex items-center gap-2"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            {t('Analyser')}
          </button>
          {loading && <span className="text-xs text-gray-500">{t('calcul en cours…')} {elapsed}s</span>}
        </div>
        <p className="text-[11px] text-gray-500">
          {t("Rien n'est supprimé sur le disque : « rejeter » pose seulement un marqueur, exploité ensuite par les cartes et les subsets.")}
        </p>
      </div>

      {res && (
        <div className="mt-4 space-y-3">
          <div className="flex items-center gap-3 flex-wrap text-xs text-gray-400">
            <span className="text-gray-300">{res.group_count} {t('groupe(s) affiché(s)')}</span>
            <span>{t('sur')} {res.total_group_count} {t('détecté(s)')}</span>
            <span>{res.indexed_vectors.toLocaleString('fr-FR')} {t('vecteurs indexés')}</span>
            {Object.keys(decisions).length > 0 && (
              <button
                onClick={save}
                className="px-2 py-0.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded"
              >
                {t('Enregistrer')} {Object.keys(decisions).length} {t('décision(s)')}
              </button>
            )}
          </div>

          {res.groups.map(g => (
            <div key={g.group_id} className="bg-gray-900 border border-gray-800 rounded-lg p-3">
              <div className="flex items-center gap-2 flex-wrap mb-2 text-xs">
                <span className="text-gray-300">{t('Groupe')} #{g.group_id}</span>
                <span className="px-1.5 py-0.5 bg-purple-600/20 text-purple-300 rounded border border-purple-600/30">
                  {g.dataset_ids.length} datasets
                </span>
                <span className="text-gray-500">{g.size} image(s)</span>
                {g.truncated && (
                  <span className="px-1.5 py-0.5 bg-amber-600/20 text-amber-300 rounded border border-amber-600/30 flex items-center gap-1">
                    <AlertTriangle size={10} />
                    {t('affichage tronqué')} ({g.images.length}/{g.size})
                  </span>
                )}
              </div>
              <div className="flex gap-3 overflow-x-auto pb-1">
                {g.images.map(im => {
                  const decided = decisions[im.image_id]
                  return (
                    <div key={im.image_id} className="flex-shrink-0 w-28">
                      <div className="aspect-square bg-gray-950 rounded overflow-hidden border border-gray-800">
                        {im.thumbnail_url
                          ? <img src={im.thumbnail_url} alt={im.filename} loading="lazy" className="w-full h-full object-cover" />
                          : <div className="w-full h-full flex items-center justify-center text-gray-700 text-[10px]">—</div>}
                      </div>
                      <p className="text-[10px] text-gray-400 truncate mt-1" title={im.filename}>{im.filename}</p>
                      <p className="text-[10px] text-indigo-400 truncate" title={im.dataset_name}>{im.dataset_name}</p>
                      <p className="text-[10px] text-gray-600">
                        {(im.similarity_to_representative * 100).toFixed(2)}%
                      </p>
                      <div className="flex gap-1 mt-1">
                        <button
                          onClick={() => setDecisions(d => ({ ...d, [im.image_id]: true }))}
                          className={`flex-1 text-[10px] py-0.5 rounded ${
                            decided === true ? 'bg-emerald-600 text-white' : 'bg-gray-800 text-gray-400'
                          }`}
                        >{t('garder')}</button>
                        <button
                          onClick={() => setDecisions(d => ({ ...d, [im.image_id]: false }))}
                          className={`flex-1 text-[10px] py-0.5 rounded ${
                            decided === false ? 'bg-red-600 text-white' : 'bg-gray-800 text-gray-400'
                          }`}
                        >{t('rejeter')}</button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ //
// Page                                                                 //
// ------------------------------------------------------------------ //

export default function Catalog() {
  const t = useT()
  const [tab, setTab] = useState<Tab>('visual')

  const { data: datasets } = useQuery({
    queryKey: ['datasets'],
    queryFn: () => datasetsAPI.list(),
  })

  // Seuls les datasets embeddés du workspace ont un index FAISS exploitable.
  const searchable = useMemo(
    () => (datasets ?? [])
      .filter(d => d.in_workspace && d.status === 'ready')
      .map(d => ({ id: d.id, name: d.name })),
    [datasets],
  )

  return (
    <div className="p-6">
      <div className="mb-5">
        <h1 className="text-xl font-bold text-white flex items-center gap-2">
          <Database size={20} className="text-indigo-400" />
          {t('Catalogue')}
        </h1>
        <p className="text-gray-500 text-sm mt-0.5">
          {t('Interroger tous les datasets comme un seul ensemble — sans fusion préalable.')}
          {searchable.length > 0 && ` ${searchable.length} ${t('dataset(s) prêt(s).')}`}
        </p>
      </div>

      <div className="flex gap-1 border-b border-gray-800 mb-4">
        {TABS.map(tabDef => (
          <button
            key={tabDef.id}
            onClick={() => setTab(tabDef.id)}
            className={`px-3 py-2 text-sm flex items-center gap-2 border-b-2 -mb-px transition-colors ${
              tab === tabDef.id
                ? 'border-indigo-500 text-white'
                : 'border-transparent text-gray-500 hover:text-gray-300'
            }`}
          >
            {tabDef.icon}
            {t(tabDef.label)}
          </button>
        ))}
      </div>

      {searchable.length === 0 && tab !== 'metadata' && (
        <div className="bg-amber-900/20 border border-amber-700/40 rounded-lg p-3 mb-4 text-sm text-amber-300 flex items-center gap-2">
          <AlertTriangle size={15} />
          {t("Aucun dataset prêt : lancez les embeddings depuis le Playground pour alimenter l'index global.")}
        </div>
      )}

      {tab === 'visual' && <VisualTab datasets={searchable} />}
      {tab === 'metadata' && <MetadataTab datasets={searchable} />}
      {tab === 'duplicates' && <DuplicatesTab />}
    </div>
  )
}
