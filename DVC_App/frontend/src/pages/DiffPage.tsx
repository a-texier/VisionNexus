// ============================================================
// DiffPage.tsx
// Sélection de 2 versions, diff DVC affiché.
// ============================================================

import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { GitCompare, Plus, Minus, RefreshCw, AlertCircle, Image, FileText, Boxes } from 'lucide-react'
import { commitsAPI } from '../api/client'
import { useCommits } from '../hooks/useCommits'
import type { DVCDiff, DiffEntry } from '../types/api'
import { useT } from '../i18n/useLang'

const _isImage = (p: string) => /\.(png|jpe?g|bmp|webp)$/i.test(p)
const _isLabel = (p: string) => /\.txt$/i.test(p)
const _countImg = (l: DiffEntry[]) => l.filter(e => _isImage(e.path)).length

export default function DiffPage() {
  const t = useT()
  const [searchParams] = useSearchParams()
  const [revA, setRevA] = useState(searchParams.get('rev_a') ?? '')
  const [revB, setRevB] = useState(searchParams.get('rev_b') ?? '')
  const [diff, setDiff]   = useState<DVCDiff | null>(null)
  const [loading, setLoading] = useState(false)

  const { data: commits } = useCommits(50)

  const handleDiff = async () => {
    if (!revA.trim() || !revB.trim()) {
      toast.error(t('Entrez deux révisions'))
      return
    }
    setLoading(true)
    try {
      const result = await commitsAPI.diff(revA.trim(), revB.trim())
      setDiff(result)
    } catch {
      toast.error(t('Erreur lors du diff'))
    } finally {
      setLoading(false)
    }
  }

  const added    = diff?.added    ?? []
  const deleted  = diff?.deleted  ?? []
  const modified = diff?.modified ?? []
  const renamed  = diff?.renamed  ?? []

  // Résumé métier : ce que le diff signifie côté données (pas juste des fichiers).
  const imgAdded   = _countImg(added)
  const imgDeleted = _countImg(deleted)
  const lblChanged = modified.filter(e => _isLabel(e.path)).length + added.filter(e => _isLabel(e.path)).length
  const hasSummary = !!diff && !diff.error && (added.length + deleted.length + modified.length + renamed.length) > 0
  // « Utilisé par » : trailers du commit cible (rev_b).
  const targetCommit = commits?.find(c => c.hash === revB.trim() || c.short === revB.trim())
  const usedByRun = targetCommit?.lineage?.run_id
  const usedByMlflow = targetCommit?.lineage?.mlflow_runs ?? []

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center gap-3">
        <GitCompare size={22} className="text-indigo-400" />
        <h1 className="text-xl font-semibold text-white">{t('Diff de versions')}</h1>
      </div>

      {/* Selector */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">{t('Révision A (base)')}</label>
            <div className="flex gap-2">
              <input
                value={revA}
                onChange={e => setRevA(e.target.value)}
                placeholder={t('hash, HEAD~1, tag…')}
                className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 font-mono"
              />
              {commits && commits.length > 0 && (
                <select
                  value=""
                  onChange={e => setRevA(e.target.value)}
                  className="bg-gray-800 border border-gray-700 text-gray-400 text-sm rounded-lg px-2 focus:outline-none focus:border-indigo-500">
                  <option value="">{t('Choisir…')}</option>
                  {commits.map(c => (
                    <option key={c.hash} value={c.hash}>
                      {c.short} — {c.subject.slice(0, 40)}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">{t('Révision B (cible)')}</label>
            <div className="flex gap-2">
              <input
                value={revB}
                onChange={e => setRevB(e.target.value)}
                placeholder={t('hash, HEAD, tag…')}
                className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 font-mono"
              />
              {commits && commits.length > 0 && (
                <select
                  value=""
                  onChange={e => setRevB(e.target.value)}
                  className="bg-gray-800 border border-gray-700 text-gray-400 text-sm rounded-lg px-2 focus:outline-none focus:border-indigo-500">
                  <option value="">{t('Choisir…')}</option>
                  {commits.map(c => (
                    <option key={c.hash} value={c.hash}>
                      {c.short} — {c.subject.slice(0, 40)}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>
        </div>
        <div className="flex justify-end">
          <button
            onClick={handleDiff}
            disabled={!revA.trim() || !revB.trim() || loading}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            {loading ? t('Calcul…') : t('Calculer le diff')}
          </button>
        </div>
      </div>

      {/* Error */}
      {diff?.error && (
        <div className="flex items-center gap-2 bg-red-900/20 border border-red-700/30 rounded-xl px-4 py-3 text-sm text-red-400">
          <AlertCircle size={16} />
          {diff.error}
        </div>
      )}

      {/* Résumé métier (avant le détail fichier par fichier) */}
      {hasSummary && (
        <div className="bg-gray-900 border border-indigo-800/40 rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Boxes size={16} className="text-indigo-300" />
            <h2 className="text-sm font-semibold text-white">{t('Résumé métier')}</h2>
            <span className="text-[11px] text-gray-500 font-mono ml-1">
              {revA.trim()} → {revB.trim()}
            </span>
          </div>
          <div className="flex flex-wrap gap-2 text-sm">
            <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-900/30 border border-emerald-700/30 text-emerald-300">
              <Image size={13} /> + {imgAdded} {t('image(s)')}
            </span>
            <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-900/30 border border-red-700/30 text-red-300">
              <Image size={13} /> − {imgDeleted} {t('image(s)')}
            </span>
            <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-900/30 border border-amber-700/30 text-amber-300">
              <FileText size={13} /> ~ {lblChanged} {t('annotation(s)')}
            </span>
          </div>
          {(imgAdded + imgDeleted + lblChanged) === 0 && (
            <p className="text-[11px] text-gray-500">
              {t("Ce diff ne touche pas d'images/annotations directement (le contenu est agrégé dans un dossier DVC — voir le détail fichier ci-dessous).")}
            </p>
          )}
          {/* Used by (trailers du commit cible) */}
          <div className="border-t border-gray-800 pt-2.5 text-[11px] text-gray-400">
            {usedByRun ? (
              <p>
                {t('Utilisé par')} : <span className="font-mono text-amber-300">Run {usedByRun}</span>
                {usedByMlflow.length > 0 && (
                  <> · {t('run(s) MLflow')} <span className="font-mono text-purple-300">{usedByMlflow.join(', ')}</span></>
                )}
                <span className="text-gray-600"> — {t("détails et liens dans le Run Insight de l'Orchestrator.")}</span>
              </p>
            ) : (
              <p className="text-gray-500">
                {t('Aucun run associé à cette version dans les trailers du commit (info non disponible — non inventée).')}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Results (détail fichier par fichier) */}
      {diff && !diff.error && (
        <div className="space-y-4">
          {/* Summary */}
          <div className="flex flex-wrap gap-3">
            <span className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-900/30 text-emerald-400 border border-emerald-700/30 rounded-lg text-sm">
              <Plus size={13} /> {added.length} {t('ajouté(s)')}
            </span>
            <span className="flex items-center gap-1.5 px-3 py-1.5 bg-red-900/30 text-red-400 border border-red-700/30 rounded-lg text-sm">
              <Minus size={13} /> {deleted.length} {t('supprimé(s)')}
            </span>
            <span className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-900/30 text-amber-400 border border-amber-700/30 rounded-lg text-sm">
              <RefreshCw size={13} /> {modified.length} {t('modifié(s)')}
            </span>
            {renamed.length > 0 && (
              <span className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-900/30 text-blue-400 border border-blue-700/30 rounded-lg text-sm">
                {renamed.length} {t('renommé(s)')}
              </span>
            )}
          </div>

          {added.length + deleted.length + modified.length + renamed.length === 0 ? (
            <div className="text-center py-8 text-gray-500 text-sm">
              {t('Aucune différence DVC entre ces deux révisions')}
            </div>
          ) : (
            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800">
                    <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium uppercase">{t('Changement')}</th>
                    <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium uppercase">{t('Chemin')}</th>
                    <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium uppercase">Hash</th>
                  </tr>
                </thead>
                <tbody>
                  {added.map((f, i) => (
                    <tr key={`add-${i}`} className={i > 0 ? 'border-t border-gray-800/40' : ''}>
                      <td className="px-4 py-2.5"><span className="text-emerald-400 text-xs font-medium">+ {t('ajouté')}</span></td>
                      <td className="px-4 py-2.5 font-mono text-xs text-gray-200">{f.path}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-gray-500">{f.hash?.slice(0, 10)}</td>
                    </tr>
                  ))}
                  {deleted.map((f, i) => (
                    <tr key={`del-${i}`} className="border-t border-gray-800/40">
                      <td className="px-4 py-2.5"><span className="text-red-400 text-xs font-medium">− {t('supprimé')}</span></td>
                      <td className="px-4 py-2.5 font-mono text-xs text-gray-200">{f.path}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-gray-500">{f.hash?.slice(0, 10)}</td>
                    </tr>
                  ))}
                  {modified.map((f, i) => (
                    <tr key={`mod-${i}`} className="border-t border-gray-800/40">
                      <td className="px-4 py-2.5"><span className="text-amber-400 text-xs font-medium">~ {t('modifié')}</span></td>
                      <td className="px-4 py-2.5 font-mono text-xs text-gray-200">{f.path}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-gray-500">{f.hash?.slice(0, 10)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
