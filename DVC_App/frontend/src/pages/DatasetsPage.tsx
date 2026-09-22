// ============================================================
// DatasetsPage.tsx
// Fichiers DVC trackés avec taille, statut badge.
// ============================================================

import { useDatasets, useDVCStatus } from '../hooks/useDatasets'
import { Database, RefreshCw, AlertCircle, Folder, FileText } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import type { FileStatus } from '../types/api'
import { useT } from '../i18n/useLang'

const STATUS_STYLE: Record<FileStatus, string> = {
  unchanged: 'bg-gray-800 text-gray-400 border-gray-700',
  modified:  'bg-amber-900/40 text-amber-400 border-amber-700/40',
  missing:   'bg-red-900/40 text-red-400 border-red-700/40',
  new:       'bg-emerald-900/40 text-emerald-400 border-emerald-700/40',
}

function StatusBadge({ status }: { status: FileStatus }) {
  return (
    <span className={`px-2 py-0.5 rounded text-xs border font-medium ${STATUS_STYLE[status]}`}>
      {status}
    </span>
  )
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

export default function DatasetsPage() {
  const t = useT()
  const qc = useQueryClient()
  const { data: files, isLoading, error } = useDatasets()
  const { data: statusData } = useDVCStatus()

  const modifiedCount = files?.filter(f => f.status === 'modified').length ?? 0
  const missingCount  = files?.filter(f => f.status === 'missing').length  ?? 0

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Database size={22} className="text-indigo-400" />
          <h1 className="text-xl font-semibold text-white">Datasets</h1>
          {files && (
            <span className="text-xs bg-gray-800 text-gray-400 border border-gray-700 rounded-full px-2 py-0.5">
              {files.length}
            </span>
          )}
        </div>
        <button
          onClick={() => {
            qc.invalidateQueries({ queryKey: ['datasets'] })
            qc.invalidateQueries({ queryKey: ['dvc-status'] })
          }}
          className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors">
          <RefreshCw size={16} />
        </button>
      </div>

      {/* Status summary */}
      {statusData?.error ? (
        <div className="flex items-center gap-2 bg-red-900/20 border border-red-700/30 rounded-xl px-4 py-3 text-sm text-red-400">
          <AlertCircle size={16} className="flex-shrink-0" />
          {statusData.error}
        </div>
      ) : (modifiedCount > 0 || missingCount > 0) ? (
        <div className="flex items-center gap-3 bg-amber-900/20 border border-amber-700/30 rounded-xl px-4 py-3 text-sm text-amber-400">
          <AlertCircle size={16} className="flex-shrink-0" />
          <span>
            {modifiedCount > 0 && `${modifiedCount} ${t('fichier(s) modifié(s)')}`}
            {modifiedCount > 0 && missingCount > 0 && ' · '}
            {missingCount > 0 && `${missingCount} ${t('fichier(s) manquant(s)')}`}
          </span>
        </div>
      ) : files && files.length > 0 ? (
        <div className="flex items-center gap-2 bg-emerald-900/20 border border-emerald-700/30 rounded-xl px-4 py-3 text-sm text-emerald-400">
          {t('Tous les datasets sont synchronisés')}
        </div>
      ) : null}

      {isLoading ? (
        <div className="flex items-center justify-center h-40 text-gray-500 text-sm">
          {t('Chargement…')}
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center h-40 gap-2 text-red-400 text-sm">
          <AlertCircle size={32} className="text-red-700" />
          {t('Erreur de chargement. Vérifiez que DVC_REPO_PATH est configuré.')}
        </div>
      ) : !files || files.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-40 gap-2 text-gray-500">
          <Database size={32} className="text-gray-700" />
          <p className="text-sm">{t('Aucun fichier DVC trouvé')}</p>
          <p className="text-xs text-gray-600">{t('Configurez DVC_REPO_PATH vers un repo git+dvc')}</p>
        </div>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800">
                <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium uppercase">Type</th>
                <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium uppercase">{t('Chemin')}</th>
                <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium uppercase">{t('Fichier DVC')}</th>
                <th className="text-right px-4 py-2.5 text-xs text-gray-500 font-medium uppercase">{t('Taille')}</th>
                <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium uppercase">Hash</th>
                <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium uppercase">{t('Statut')}</th>
              </tr>
            </thead>
            <tbody>
              {files.map((f, i) => (
                <tr key={f.path} className={`${i > 0 ? 'border-t border-gray-800/60' : ''} transition-colors hover:bg-gray-800/30`}>
                  <td className="px-4 py-3 text-gray-500">
                    {f.is_dir
                      ? <Folder size={15} className="text-blue-400" />
                      : <FileText size={15} className="text-gray-500" />
                    }
                  </td>
                  <td className="px-4 py-3 text-gray-200 font-mono text-xs">{f.path}</td>
                  <td className="px-4 py-3 text-gray-500 font-mono text-xs">{f.dvc_file}</td>
                  <td className="px-4 py-3 text-right text-gray-400 text-xs font-mono">{formatSize(f.size_bytes)}</td>
                  <td className="px-4 py-3 text-gray-500 font-mono text-xs">{f.md5 ?? '—'}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={f.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
