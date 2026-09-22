// ============================================================
// pages/SubsetManager.tsx
// Gestion des subsets + export + doublons locaux.
// Ajouts :
//   - verrou par subset (empêche suppression accidentelle)
//   - bouton doublon désactivé après export
//   - callback onApplied pour rafraîchir la liste après filtre
//   - mode solo : saisie du chemin de destination avant export
// ============================================================

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Layers, Upload, Trash2, FolderOpen, Plus, GitMerge, Lock, Unlock, Copy, Map, X } from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { appModeAPI, subsetsAPI } from '../api/client'
import { useDatasets } from '../hooks/useDataset'
import { useSelectionStore } from '../hooks/useSubset'
import SubsetDuplicatesModal from '../components/SubsetDuplicatesModal'
import ConfirmDialog from '../components/ConfirmDialog'
import type { SubsetSummary } from '../types/api'
import { useT } from '../i18n/useLang'

export default function SubsetManager() {
  const t = useT()
  const qc = useQueryClient()
  const { data: datasets = [] } = useDatasets()
  const { selectedIds, clear } = useSelectionStore()

  const [filterDataset, setFilterDataset] = useState<number | null>(null)
  const [newName, setNewName] = useState('')
  const [newDatasetId, setNewDatasetId] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)
  const [dupSubset, setDupSubset] = useState<SubsetSummary | null>(null)

  // Verrou : persisté en base (`Subset.locked`) et vérifié par le serveur.
  // Il était auparavant local au composant, donc perdu au rechargement et
  // sans effet sur un DELETE lancé depuis ailleurs.
  const [pendingDelete, setPendingDelete] = useState<SubsetSummary | null>(null)

  // Mode app (solo vs orchestrateur)
  const [appMode, setAppMode] = useState<'orchestrator' | 'solo' | null>(null)
  const [defaultAnnotationDir, setDefaultAnnotationDir] = useState('')

  // Export dialog (mode solo)
  const [exportSubset, setExportSubset] = useState<SubsetSummary | null>(null)
  const [exportPath, setExportPath] = useState('')
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    appModeAPI.get().then((data) => {
      setAppMode(data.mode)
      setDefaultAnnotationDir(data.annotation_imports_dir)
    }).catch(() => {
      setAppMode('solo')
    })
  }, [])

  const { data: subsets = [], isLoading } = useQuery({
    queryKey: ['subsets', filterDataset],
    queryFn: () => subsetsAPI.list(filterDataset ?? undefined),
  })

  const toggleLock = async (subset: SubsetSummary) => {
    try {
      await subsetsAPI.setLock(subset.id, !subset.locked)
      qc.invalidateQueries({ queryKey: ['subsets'] })
      toast.success(subset.locked ? t('Subset déverrouillé') : t('Subset verrouillé'))
    } catch (e: any) {
      toast.error(e?.response?.data?.detail ?? t('Changement de verrou échoué'))
    }
  }

  const handleCreate = async () => {
    if (!newName.trim()) return toast.error(t('Nom requis'))
    if (!newDatasetId) return toast.error(t('Sélectionnez un dataset'))
    if (selectedIds.size === 0) return toast.error(t('Aucune image sélectionnée'))
    setCreating(true)
    try {
      await subsetsAPI.create({
        dataset_id: newDatasetId,
        name: newName.trim(),
        image_ids: Array.from(selectedIds),
      })
      toast.success(`Subset "${newName}" ${t('créé')}`)
      setNewName('')
      clear()
      qc.invalidateQueries({ queryKey: ['subsets'] })
    } catch {
      toast.error(t('Erreur création'))
    } finally {
      setCreating(false)
    }
  }

  // Déclencher le flow d'export selon le mode
  const handleExportClick = (subset: SubsetSummary) => {
    if (appMode === 'solo') {
      // Ouvrir le dialog de saisie de chemin
      setExportPath(defaultAnnotationDir)
      setExportSubset(subset)
    } else {
      // Mode orchestrateur : export direct sans demander de chemin
      void doExport(subset, undefined)
    }
  }

  const doExport = async (subset: SubsetSummary, customPath: string | undefined) => {
    setExporting(true)
    try {
      const res = await subsetsAPI.exportToAnnotationApp(subset.id, customPath)
      toast.success(`${t('Exporté vers :')} ${(res as { export_path: string }).export_path}`)
      qc.invalidateQueries({ queryKey: ['subsets'] })
      setExportSubset(null)
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? t('Erreur export')
      toast.error(msg)
    } finally {
      setExporting(false)
    }
  }

  const handleExportConfirm = () => {
    if (!exportSubset) return
    void doExport(exportSubset, exportPath.trim() || undefined)
  }

  const handleDuplicate = async (subset: SubsetSummary) => {
    const baseName = subset.name.replace(/_\d+$/, '')
    const existingNames = subsets.map(s => s.name)
    let n = 1
    while (existingNames.includes(`${baseName}_${n}`)) n++
    const defaultName = `${baseName}_${n}`
    const name = window.prompt(t('Nom du subset dupliqué :'), defaultName)
    if (name === null) return  // annulé
    try {
      await subsetsAPI.duplicate(subset.id, name.trim() || defaultName)
      toast.success(`Subset "${name.trim() || defaultName}" ${t('créé')}`)
      qc.invalidateQueries({ queryKey: ['subsets'] })
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? t('Erreur duplication')
      toast.error(msg)
    }
  }

  const handleDelete = (subset: SubsetSummary) => {
    if (subset.locked) {
      return toast.error(t("Subset verrouillé — déverrouillez d'abord"))
    }
    setPendingDelete(subset)
  }

  const confirmDelete = async () => {
    if (!pendingDelete) return
    try {
      await subsetsAPI.delete(pendingDelete.id)
      toast.success(t('Subset supprimé'))
      qc.invalidateQueries({ queryKey: ['subsets'] })
    } catch (e: any) {
      toast.error(e?.response?.data?.detail ?? t('Suppression échouée'))
    } finally {
      setPendingDelete(null)
    }
  }

  const handleApplied = () => {
    qc.invalidateQueries({ queryKey: ['subsets'] })
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Layers size={22} /> {t('Gestion des subsets')}
        </h1>
        <p className="text-gray-400 mt-1">{t("Collections d'images avec symlinks vers le dataset source")}</p>
      </div>

      {/* Créer depuis sélection courante */}
      {selectedIds.size > 0 && (
        <div className="bg-indigo-900/20 border border-indigo-600/40 rounded-xl p-4">
          <p className="text-indigo-300 text-sm mb-3 flex items-center gap-1">
            <Plus size={14} />
            {selectedIds.size} {t('image(s) sélectionnée(s)')} — {t('créer un subset :')}
          </p>
          <div className="flex gap-2">
            <select
              value={newDatasetId ?? ''}
              onChange={e => setNewDatasetId(e.target.value ? Number(e.target.value) : null)}
              className="bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-200"
            >
              <option value="">{t('Dataset...')}</option>
              {datasets.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <input
              type="text"
              placeholder={t('Nom du subset...')}
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreate()}
              className="flex-1 bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:ring-2 focus:ring-indigo-500"
            />
            <button
              onClick={handleCreate}
              disabled={creating}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm rounded-lg disabled:opacity-50 font-medium"
            >
              {creating ? '...' : t('Créer')}
            </button>
          </div>
        </div>
      )}

      {/* Filtre */}
      <div className="flex items-center gap-3">
        <span className="text-gray-400 text-sm">{t('Filtrer par dataset :')}</span>
        <select
          value={filterDataset ?? ''}
          onChange={e => setFilterDataset(e.target.value ? Number(e.target.value) : null)}
          className="bg-gray-800 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-gray-200"
        >
          <option value="">{t('Tous')}</option>
          {datasets.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </div>

      {/* Liste */}
      {isLoading && <p className="text-gray-500">{t('Chargement...')}</p>}
      {!isLoading && subsets.length === 0 && (
        <div className="text-center py-16 text-gray-500">
          <Layers size={48} className="mx-auto mb-3 opacity-30" />
          <p>{t('Aucun subset. Sélectionnez des images sur la carte ou en recherche sémantique.')}</p>
        </div>
      )}

      <div className="space-y-3">
        {subsets.map(subset => {
          const ds = datasets.find(d => d.id === subset.dataset_id)
          const locked = subset.locked
          return (
            <div key={subset.id} className="bg-gray-800 rounded-xl border border-gray-700 p-4">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold text-white">{subset.name}</h3>
                    {subset.exported_to_annotation_app && (
                      <span className="px-2 py-0.5 rounded-full text-xs bg-green-600/20 text-green-400 border border-green-600/40">
                        {t('Exporté')}
                      </span>
                    )}
                    {locked && (
                      <span className="px-2 py-0.5 rounded-full text-xs bg-amber-600/20 text-amber-400 border border-amber-600/40">
                        {t('Verrouillé')}
                      </span>
                    )}
                  </div>
                  <p className="text-gray-400 text-sm mt-0.5">
                    {subset.image_count} images · {ds?.name ?? `Dataset #${subset.dataset_id}`}
                  </p>
                  {subset.symlink_dir && (
                    <p className="text-gray-600 text-xs mt-0.5 font-mono truncate max-w-lg">
                      <FolderOpen size={11} className="inline mr-1" />{subset.symlink_dir}
                    </p>
                  )}
                  {/* Exports multiples */}
                  {subset.exports && subset.exports.length > 0 && (
                    <div className="space-y-0.5 mt-1">
                      {subset.exports.map(exp => (
                        <p key={exp.id} className="text-green-700 text-xs font-mono truncate max-w-lg flex items-center gap-1.5">
                          <Upload size={11} className="flex-shrink-0" />
                          <span className="truncate">{exp.export_path}</span>
                          <span className={`flex-shrink-0 px-1.5 py-0 rounded text-xs border ${
                            exp.export_type === 'symlink'
                              ? 'bg-blue-600/15 text-blue-400 border-blue-600/30'
                              : 'bg-purple-600/15 text-purple-400 border-purple-600/30'
                          }`}>
                            {exp.export_type === 'symlink' ? 'symlink' : t('copie')}
                          </span>
                        </p>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  {/* Carte UMAP du dataset source — visible uniquement si UMAP calculé */}
                  {ds?.umap_cached && (
                    <Link
                      to={`/datasets/${subset.dataset_id}/map`}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs bg-indigo-600/20 text-indigo-400 border border-indigo-600/40 rounded-lg hover:bg-indigo-600/30 transition-colors"
                      title={t('Voir la carte UMAP du dataset source')}
                    >
                      <Map size={13} /> {t('Carte')}
                    </Link>
                  )}

                  {/* Dupliquer le subset */}
                  <button
                    onClick={() => handleDuplicate(subset)}
                    className="flex items-center gap-1 px-3 py-1.5 text-xs bg-gray-700/50 text-gray-300 border border-gray-600 rounded-lg hover:bg-gray-700 transition-colors"
                    title={t('Dupliquer ce subset')}
                  >
                    <Copy size={13} /> {t('Dupliquer')}
                  </button>

                  {/* Bouton doublons — actif seulement si non exporté */}
                  {!subset.exported_to_annotation_app ? (
                    <button
                      onClick={() => setDupSubset(subset)}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs bg-yellow-600/15 text-yellow-400 border border-yellow-600/30 rounded-lg hover:bg-yellow-600/25 transition-colors"
                      title={t('Détecter et gérer les doublons dans ce subset')}
                    >
                      <GitMerge size={13} /> {t('Doublons')}
                    </button>
                  ) : (
                    <button
                      disabled
                      className="flex items-center gap-1 px-3 py-1.5 text-xs bg-gray-700/30 text-gray-600 border border-gray-700 rounded-lg cursor-not-allowed"
                      title={t('Doublons désactivés après export')}
                    >
                      <GitMerge size={13} /> {t('Doublons')}
                    </button>
                  )}

                  <button
                    onClick={() => handleExportClick(subset)}
                    className="flex items-center gap-1 px-3 py-1.5 text-xs bg-blue-600/20 text-blue-400 border border-blue-600/40 rounded-lg hover:bg-blue-600/30 transition-colors"
                    title={t('Exporter vers Annotation App (plusieurs exports possibles)')}
                  >
                    <Upload size={13} /> {t('Exporter')}
                  </button>

                  {/* Verrou */}
                  <button
                    onClick={() => toggleLock(subset)}
                    className={`p-1.5 transition-colors ${locked ? 'text-amber-400 hover:text-amber-300' : 'text-gray-500 hover:text-amber-400'}`}
                    title={locked ? t('Déverrouiller') : t('Verrouiller (empêche suppression accidentelle)')}
                  >
                    {locked ? <Lock size={15} /> : <Unlock size={15} />}
                  </button>

                  {/* Suppression — bloquée si verrouillé */}
                  <button
                    onClick={() => handleDelete(subset)}
                    disabled={locked}
                    className={`p-1.5 transition-colors ${locked ? 'text-gray-700 cursor-not-allowed' : 'text-gray-500 hover:text-red-400'}`}
                    title={locked ? t('Subset verrouillé') : t('Supprimer le subset et son dossier')}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Modal doublons subset */}
      {dupSubset && (
        <SubsetDuplicatesModal
          subset={dupSubset}
          onClose={() => setDupSubset(null)}
          onApplied={handleApplied}
        />
      )}

      {/* Dialog export — mode solo : saisie du chemin de destination */}
      {exportSubset && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => !exporting && setExportSubset(null)} />
          <div className="relative bg-gray-800 border border-gray-700 rounded-xl p-5 w-[440px] shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <Upload size={14} className="text-blue-400" />
                {t('Exporter vers Annotation App')}
              </h3>
              <button
                onClick={() => setExportSubset(null)}
                disabled={exporting}
                className="p-1 rounded hover:bg-gray-700 text-gray-400 hover:text-white transition-colors"
              >
                <X size={14} />
              </button>
            </div>

            <p className="text-xs text-gray-400 mb-3">
              Subset <span className="text-white font-medium">{exportSubset.name}</span> ({exportSubset.image_count} images)
            </p>

            <div className="mb-4">
              <label className="text-xs text-amber-300 mb-1.5 flex items-center gap-1">
                <FolderOpen size={11} /> {t('Dossier de destination')}
              </label>
              <input
                type="text"
                value={exportPath}
                onChange={e => setExportPath(e.target.value)}
                placeholder={defaultAnnotationDir || t('Chemin du dossier...')}
                className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1.5 text-xs text-gray-200 font-mono focus:outline-none focus:border-amber-500 placeholder-gray-600"
              />
              <p className="text-xs text-gray-500 mt-1">
                {t('Le sous-dossier')} <span className="font-mono text-gray-400">{exportSubset.name}</span> {t("sera créé à l'intérieur.")}
                {' '}{t('Laissez vide pour utiliser le chemin par défaut.')}
              </p>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setExportSubset(null)}
                disabled={exporting}
                className="flex-1 py-2 text-sm text-gray-300 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors"
              >
                {t('Annuler')}
              </button>
              <button
                onClick={handleExportConfirm}
                disabled={exporting}
                className="flex-1 flex items-center justify-center gap-2 py-2 text-sm text-white bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 rounded-lg transition-colors"
              >
                <Upload size={14} />
                {exporting ? t('Export...') : t('Exporter')}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!pendingDelete}
        title={`${t('Supprimer le subset')} "${pendingDelete?.name ?? ''}" ?`}
        message={t('Cette action retire le subset de la base et supprime son dossier de liens.')}
        details={[
          `${pendingDelete?.image_count ?? 0} ${t('image(s) référencée(s)')}`,
          t('Les images originales ne sont jamais supprimées du disque.'),
          ...(pendingDelete?.exported_to_annotation_app
            ? [t('Les exports déjà réalisés vers Annotation App ne sont pas retirés.')]
            : []),
        ]}
        confirmLabel={t('Supprimer')}
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  )
}
