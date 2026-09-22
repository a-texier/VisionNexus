// ============================================================
// components/modals/ExportModal.tsx
// Modal d'export du dataset au format YOLO.
// Permet de configurer le split train/val/test et de lancer l'export.
// Mode symlink (défaut) : crée un dossier avec liens symboliques, pas de ZIP.
// Mode copie : copie les images et crée un ZIP téléchargeable.
// Mode solo : l'utilisateur choisit le dossier de destination.
// Mode orchestrateur : le dossier est géré automatiquement par le workspace.
// ============================================================

import React, { useEffect, useState } from 'react'
import { X, Download, Package, Link, FolderOpen } from 'lucide-react'
import { appModeAPI, exportAPI } from '../../services/api'
import { useTaskPolling } from '../../hooks/useTaskPolling'
import { useT } from '../../i18n/useLang'

interface ExportModalProps {
  isOpen: boolean
  projectId: number
  projectName?: string
  onClose: () => void
}

export const ExportModal: React.FC<ExportModalProps> = ({
  isOpen,
  projectId,
  projectName,
  onClose,
}) => {
  const t = useT()
  const [trainRatio, setTrainRatio] = useState(80)
  const [valRatio, setValRatio] = useState(10)
  const [symlinkImages, setSymlinkImages] = useState(true)
  // Format de sortie : YOLO (sous-dossier yolo par séquence) ou .ver (fichier par séquence)
  const [outputFormat, setOutputFormat] = useState<'yolo' | 'ver' | 'coco'>('yolo')
  const [taskId, setTaskId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Mode solo vs orchestrateur
  const [appMode, setAppMode] = useState<'orchestrator' | 'solo' | null>(null)
  const [defaultExportsDir, setDefaultExportsDir] = useState('')
  const [customExportDir, setCustomExportDir] = useState('')

  useEffect(() => {
    if (!isOpen) return
    appModeAPI.get().then((data) => {
      setAppMode(data.mode)
      setDefaultExportsDir(data.exports_dir)
      if (data.mode === 'solo') {
        setCustomExportDir(data.exports_dir)
      }
    }).catch(() => {
      setAppMode('solo') // fallback
    })
  }, [isOpen])

  // test = reste après train + val (min 0)
  const testRatio = Math.max(0, 100 - trainRatio - valRatio)

  const { taskStatus } = useTaskPolling(taskId)

  if (!isOpen) return null

  const handleTrainChange = (v: number) => {
    setTrainRatio(v)
    if (v + valRatio > 100) setValRatio(100 - v)
  }

  const handleValChange = (v: number) => {
    setValRatio(v)
    if (trainRatio + v > 100) setTrainRatio(100 - v)
  }

  const handleExport = async () => {
    setLoading(true)
    setError(null)
    try {
      const payload: Parameters<typeof exportAPI.start>[1] = {
        format: 'yolo',
        output_format: outputFormat,
        split_train: trainRatio / 100,
        split_val: valRatio / 100,
        split_test: testRatio / 100,
        symlink_images: symlinkImages,
      }
      // En mode solo, transmettre le dossier de destination si renseigné
      if (appMode === 'solo' && customExportDir.trim()) {
        payload.custom_export_dir = customExportDir.trim()
      }
      const result = await exportAPI.start(projectId, payload)
      setTaskId(result.task_id)
    } catch {
      setError(t("Impossible de lancer l'export."))
    } finally {
      setLoading(false)
    }
  }

  const handleDownload = () => {
    if (!taskId) return
    const url = exportAPI.getDownloadUrl(taskId)
    const a = document.createElement('a')
    a.href = url
    a.download = projectName ? `${projectName}_export.zip` : `export_${projectId}.zip`
    a.click()
  }

  const isCompleted = taskStatus?.status === 'completed'
  const isFailed = taskStatus?.status === 'error'
  const progress = taskStatus?.progress ?? 0
  const folderPath = taskStatus?.folder_path
  const hasZip = isCompleted && !folderPath && taskStatus?.zip_path

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={!taskId ? onClose : undefined} />

      <div className="relative bg-slate-800 border border-slate-700 rounded-xl p-6 w-[420px] shadow-2xl">
        {/* En-tête */}
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-slate-100">
            {t('Exporter le dataset')}
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {!taskId ? (
          <>
            <p className="text-[11px] text-slate-400 mb-3 bg-slate-800/60 border border-slate-700 rounded px-2.5 py-1.5 leading-relaxed">
              {t('Exporte')} <strong>{t('tout le projet en une fois')}</strong> — {t('toutes les séquences, chacune dans son propre sous-dossier (YOLO) ou fichier')} <code className="text-orange-400">.ver</code>,
              {' '}{t("nommé d'après la séquence.")}
            </p>

            {/* Format de sortie */}
            <div className="mb-4">
              <span className="text-xs font-medium text-slate-300 block mb-1.5">{t('Format de sortie')}</span>
              <div className="flex gap-1" data-tour="export-formats">
                <button
                  onClick={() => setOutputFormat('yolo')}
                  data-tour="export-format-yolo"
                  className={`flex-1 py-1.5 text-xs rounded transition-colors ${
                    outputFormat === 'yolo' ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  YOLO
                </button>
                <button
                  onClick={() => setOutputFormat('coco')}
                  className={`flex-1 py-1.5 text-xs rounded transition-colors ${
                    outputFormat === 'coco' ? 'bg-emerald-600 text-white' : 'bg-slate-700 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  COCO JSON
                </button>
                <button
                  onClick={() => setOutputFormat('ver')}
                  data-tour="export-format-ver"
                  className={`flex-1 py-1.5 text-xs rounded transition-colors ${
                    outputFormat === 'ver' ? 'bg-orange-600 text-white' : 'bg-slate-700 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  .ver
                </button>
              </div>
              {outputFormat === 'ver' && (
                <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
                  {t('Format .ver')} : <code className="text-orange-400">frame_id vis x1 y1 x2 y2 track_id classe sous-classe sous-sous-classe</code> —
                  {' '}{t('un fichier .ver par séquence annotée, coordonnées')} <strong>{t('absolues (pixels)')}</strong>, {t('frames 1-based.')}
                </p>
              )}
              {outputFormat === 'coco' && (
                <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
                  {t('Format COCO')} : <code className="text-emerald-400">annotations/instances_&#123;train,val,test&#125;.json</code> +
                  {' '}images/. {t('bbox en')} <strong>{t('pixels')}</strong>, <code>category_id</code> {t('1-based, segmentation incluse pour les polygones (masques SAM). Splits ci-dessous appliqués.')}
                </p>
              )}
            </div>

            {/* Configuration du split (YOLO uniquement) */}
            <div className={`space-y-4 mb-5 ${outputFormat === 'ver' ? 'hidden' : ''}`}>
              <div>
                <div className="flex justify-between text-xs text-slate-400 mb-1.5">
                  <span>{t('Train')}</span>
                  <span className="font-mono text-slate-200">{trainRatio}%</span>
                </div>
                <input
                  type="range"
                  min={0} max={100} step={5}
                  value={trainRatio}
                  onChange={(e) => handleTrainChange(parseInt(e.target.value))}
                  className="w-full accent-blue-500"
                />
              </div>

              <div>
                <div className="flex justify-between text-xs text-slate-400 mb-1.5">
                  <span>{t('Validation')}</span>
                  <span className="font-mono text-slate-200">{valRatio}%</span>
                </div>
                <input
                  type="range"
                  min={0} max={100} step={5}
                  value={valRatio}
                  onChange={(e) => handleValChange(parseInt(e.target.value))}
                  className="w-full accent-purple-500"
                />
              </div>

              {/* Résumé visuel */}
              <div className="flex rounded-lg overflow-hidden h-3">
                <div className="bg-blue-500 transition-all" style={{ width: `${trainRatio}%` }} title={`Train: ${trainRatio}%`} />
                <div className="bg-purple-500 transition-all" style={{ width: `${valRatio}%` }} title={`Val: ${valRatio}%`} />
                {testRatio > 0 && (
                  <div className="bg-orange-500 flex-1 transition-all" title={`Test: ${testRatio}%`} />
                )}
              </div>
              <div className="flex gap-3 text-xs text-slate-400 justify-center">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-sm bg-blue-500 inline-block" /> Train {trainRatio}%
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-sm bg-purple-500 inline-block" /> Val {valRatio}%
                </span>
                <span className="flex items-center gap-1">
                  <span className={`w-2 h-2 rounded-sm inline-block ${testRatio > 0 ? 'bg-orange-500' : 'bg-slate-600'}`} />
                  Test {testRatio}%
                </span>
              </div>

              {(valRatio === 0 || testRatio === 0) && (
                <p className="text-xs text-yellow-400/80 text-center">
                  {valRatio === 0 && testRatio === 0
                    ? t('Export 100% train — aucun split val/test')
                    : valRatio === 0 ? t('Aucun split validation')
                    : t('Aucun split test')}
                </p>
              )}
            </div>

            {/* Options communes aux DEUX formats (YOLO et .ver) : symlink/zip +
                dossier de destination. Auparavant dans la section masquée en .ver
                → impossible de choisir le dossier pour un export .ver. */}
            <div className="space-y-4 mb-5">
              {/* Option symlink */}
              <label className="flex items-start gap-2 cursor-pointer p-2 rounded-lg border border-slate-700 hover:border-slate-600 transition-colors">
                <input
                  type="checkbox"
                  checked={symlinkImages}
                  onChange={(e) => setSymlinkImages(e.target.checked)}
                  className="accent-blue-500 mt-0.5"
                />
                <div>
                  <span className="text-xs text-slate-200 flex items-center gap-1">
                    <Link size={11} className="text-blue-400" />
                    {t('Liens symboliques pour les images')}
                  </span>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {symlinkImages
                      ? t('Crée un dossier dataset avec symlinks — usage direct sur ce serveur, pas de ZIP.')
                      : t('Copie les images et génère un ZIP téléchargeable.')}
                  </p>
                </div>
              </label>

              {/* Dossier de destination — mode solo uniquement */}
              {appMode === 'solo' && (
                <div className="p-2 rounded-lg border border-amber-700/40 bg-amber-900/10">
                  <label className="flex items-center gap-1 text-xs text-amber-300 mb-1.5">
                    <FolderOpen size={11} />
                    {t('Dossier de destination')}
                  </label>
                  <input
                    type="text"
                    value={customExportDir}
                    onChange={(e) => setCustomExportDir(e.target.value)}
                    placeholder={defaultExportsDir || t('Chemin du dossier de sortie...')}
                    className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-amber-500 placeholder-slate-600"
                  />
                  <p className="text-xs text-slate-500 mt-1">
                    {t('Laissez vide pour utiliser le dossier par défaut.')}
                  </p>
                </div>
              )}

              {/* Mode orchestrateur — info dossier auto */}
              {appMode === 'orchestrator' && (
                <div className="p-2 rounded-lg border border-blue-700/40 bg-blue-900/10">
                  <p className="text-xs text-blue-300 flex items-center gap-1">
                    <FolderOpen size={11} />
                    {t('Export automatiquement enregistré dans le workspace orchestrateur.')}
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5 font-mono break-all">{defaultExportsDir}</p>
                </div>
              )}
            </div>

            {error && <p className="text-xs text-red-400 mb-3 text-center">{error}</p>}

            {/* Actions */}
            <div className="flex gap-2">
              <button
                onClick={onClose}
                data-tour="export-cancel"
                className="flex-1 py-2 text-sm text-slate-300 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors"
              >
                {t('Annuler')}
              </button>
              <button
                onClick={() => void handleExport()}
                disabled={loading || appMode === null}
                data-tour="export-submit"
                className="flex-1 flex items-center justify-center gap-2 py-2 text-sm text-white bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-500 rounded-lg transition-colors"
              >
                <Package size={14} />
                {loading ? t('Lancement...') : t('Exporter')}
              </button>
            </div>
          </>
        ) : (
          // Progression de l'export
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm text-slate-300">
              {isCompleted ? (
                <span className="text-green-400">{t('Export terminé !')}</span>
              ) : isFailed ? (
                <span className="text-red-400">{t("Erreur lors de l'export")}</span>
              ) : (
                <span>{t('Export en cours...')} {Math.round(progress * 100)}%</span>
              )}
            </div>

            <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  isCompleted ? 'bg-green-400' : isFailed ? 'bg-red-400' : 'bg-blue-400'
                }`}
                style={{ width: `${isCompleted ? 100 : progress * 100}%` }}
              />
            </div>

            {/* Chemin dossier (mode symlink) */}
            {isCompleted && folderPath && (
              <div className="p-2 bg-slate-900/60 rounded-lg border border-slate-700">
                <p className="text-xs text-slate-400 mb-1 flex items-center gap-1">
                  <Link size={11} className="text-blue-400" /> {t('Dataset créé avec symlinks')} :
                </p>
                <p className="text-xs text-slate-200 font-mono break-all">{folderPath}</p>
                <p className="text-xs text-slate-500 mt-1">
                  {t('Utilisez ce chemin directement avec YOLOv8 sur ce serveur.')}
                </p>
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="flex-1 py-2 text-sm text-slate-300 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors"
              >
                {t('Fermer')}
              </button>
              {/* Retour au formulaire pour relancer un export sans fermer le modal
                  (ex : autre format / autre dossier). Réactivé dès qu'un export
                  est terminé ou en échec. */}
              {(isCompleted || isFailed) && (
                <button
                  onClick={() => { setTaskId(null); setError(null) }}
                  className="flex-1 flex items-center justify-center gap-2 py-2 text-sm text-white bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors"
                >
                  <Package size={14} />
                  {t('Nouvel export')}
                </button>
              )}
              {hasZip && (
                <button
                  onClick={handleDownload}
                  className="flex-1 flex items-center justify-center gap-2 py-2 text-sm text-white bg-green-600 hover:bg-green-500 rounded-lg transition-colors"
                >
                  <Download size={14} />
                  {t('Télécharger ZIP')}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
