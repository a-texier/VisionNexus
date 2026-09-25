// ============================================================
// components/sidebar/XFeatDebugPanel.tsx
// Panneau de debug XFeat / SIFT : visualisation des correspondances
// de keypoints entre deux frames consecutives.
//
// Affiche :
//   - Methode utilisee (XFeat GPU ou SIFT+RANSAC CPU)
//   - Nombre de keypoints detectes sur chaque frame
//   - Nombre de matches totaux et apres filtrage
//   - Nombre d'inliers et ratio d'inliers
//   - Validite de l'homographie (>= 0.3 = valide)
//   - Visualisation image cote-a-cote avec les correspondances tracees
// ============================================================

import React, { useState } from 'react'
import { Search, AlertTriangle, CheckCircle, XCircle, Loader2 } from 'lucide-react'
import type { Frame } from '../../types/api'
import { trackingAPI } from '../../services/api'
import { useT } from '../../i18n/useLang'
import { useSettingsStore } from '../../stores/settingsStore'

interface XFeatDebugPanelProps {
  projectId: number
  currentFrame: Frame | null
  frames: Frame[]
  currentFrameIndex: number
}

interface DebugResult {
  method: string
  keypoints_a: number
  keypoints_b: number
  matches_total: number
  matches_good: number
  inliers: number
  inlier_ratio: number
  homography_valid: boolean
  visualization_b64: string | null
  frame_a_index: number
  frame_b_index: number
  error?: string
}

export const XFeatDebugPanel: React.FC<XFeatDebugPanelProps> = ({
  projectId,
  currentFrame,
  frames,
  currentFrameIndex,
}) => {
  const t = useT()
  // Meme seuil que la propagation : celui des reglages (Ratio inliers), pas 0.5 en dur
  const minInlierRatio = useSettingsStore((s) => s.settings?.algorithms?.min_inlier_ratio)
  const [frameAIndex, setFrameAIndex] = useState(currentFrameIndex)
  const [frameBIndex, setFrameBIndex] = useState(Math.min(currentFrameIndex + 1, frames.length - 1))
  const [isLoading, setIsLoading] = useState(false)
  const [result, setResult] = useState<DebugResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const lastIndex = frames.length > 0 ? frames[frames.length - 1].frame_index : 0

  const handleDebug = async () => {
    const frameA = frames.find((f) => f.frame_index === frameAIndex)
    const frameB = frames.find((f) => f.frame_index === frameBIndex)

    if (!frameA || !frameB) {
      setError(t('Frames introuvables'))
      return
    }
    if (frameA.id === frameB.id) {
      setError(t('Selectionnez deux frames differentes'))
      return
    }

    setIsLoading(true)
    setError(null)
    setResult(null)

    try {
      const data = await trackingAPI.debugHomography(projectId, frameA.id, frameB.id, minInlierRatio)
      setResult(data)
      if (data.error) setError(data.error)
    } catch (e) {
      setError(t("Erreur lors du calcul de l'homographie"))
    } finally {
      setIsLoading(false)
    }
  }

  const getInlierColor = (ratio: number) => {
    if (ratio >= 0.6) return 'text-green-400'
    if (ratio >= 0.3) return 'text-yellow-400'
    return 'text-red-400'
  }

  return (
    <div className="flex flex-col h-full">
      {/* En-tete */}
      <div className="px-2 py-2 border-b border-slate-700">
        <p className="text-xs text-slate-300 font-medium">{t('Debug Homographie')}</p>
        <p className="text-xs text-slate-500 mt-0.5">
          {t('Visualise les correspondances entre deux frames.')}
        </p>
      </div>

      {/* Selecteurs de frames */}
      <div className="px-2 py-2 border-b border-slate-700 space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400 w-16 flex-shrink-0">Frame A</span>
          <input
            type="number"
            min={0}
            max={lastIndex}
            value={frameAIndex}
            onChange={(e) => setFrameAIndex(parseInt(e.target.value) || 0)}
            className="w-16 bg-slate-700 border border-slate-600 text-white text-xs px-1.5 py-0.5 rounded outline-none"
          />
          <span className="text-xs text-slate-600">/ {lastIndex}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400 w-16 flex-shrink-0">Frame B</span>
          <input
            type="number"
            min={0}
            max={lastIndex}
            value={frameBIndex}
            onChange={(e) => setFrameBIndex(parseInt(e.target.value) || 0)}
            className="w-16 bg-slate-700 border border-slate-600 text-white text-xs px-1.5 py-0.5 rounded outline-none"
          />
          <span className="text-xs text-slate-600">/ {lastIndex}</span>
        </div>

        <button
          onClick={() => void handleDebug()}
          disabled={isLoading || frames.length < 2}
          className="w-full flex items-center justify-center gap-1.5 bg-slate-600 hover:bg-slate-500 disabled:bg-slate-700 disabled:text-slate-500 text-white text-xs py-1.5 rounded transition-colors"
        >
          {isLoading ? <Loader2 size={11} className="animate-spin" /> : <Search size={11} />}
          {isLoading ? t('Calcul...') : t('Calculer homographie')}
        </button>

        {/* Bouton raccourci : frame courante → suivante */}
        {currentFrame && (
          <button
            onClick={() => {
              setFrameAIndex(currentFrameIndex)
              setFrameBIndex(Math.min(currentFrameIndex + 1, lastIndex))
            }}
            className="w-full text-xs text-slate-500 hover:text-slate-300 transition-colors text-center"
          >
            {t('Utiliser frame courante')} ({currentFrameIndex}) → {Math.min(currentFrameIndex + 1, lastIndex)}
          </button>
        )}
      </div>

      {/* Erreur */}
      {error && (
        <div className="px-2 py-2 border-b border-slate-700">
          <p className="text-xs text-red-400 flex items-center gap-1">
            <AlertTriangle size={11} /> {error}
          </p>
        </div>
      )}

      {/* Resultats */}
      {result && !result.error && (
        <div className="flex-1 overflow-y-auto">
          {/* Methode */}
          <div className="px-2 py-2 border-b border-slate-700">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-400">{t('Methode')}</span>
              <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${
                result.method === 'xfeat'
                  ? 'bg-purple-900/40 text-purple-300'
                  : 'bg-blue-900/40 text-blue-300'
              }`}>
                {result.method === 'xfeat' ? 'XFeat (GPU)' : 'SIFT+RANSAC (CPU)'}
              </span>
            </div>
          </div>

          {/* Statistiques */}
          <div className="px-2 py-2 border-b border-slate-700 space-y-1.5">
            {[
              { label: `Keypoints A (frame ${result.frame_a_index})`, value: result.keypoints_a },
              { label: `Keypoints B (frame ${result.frame_b_index})`, value: result.keypoints_b },
              { label: t('Matches totaux'), value: result.matches_total },
              { label: t('Matches filtres'), value: result.matches_good },
              { label: t('Inliers RANSAC'), value: result.inliers },
            ].map(({ label, value }) => (
              <div key={label} className="flex justify-between items-center">
                <span className="text-xs text-slate-500">{label}</span>
                <span className="text-xs text-slate-200 font-mono">{value}</span>
              </div>
            ))}

            {/* Ratio d'inliers avec indicateur de qualite */}
            <div className="flex justify-between items-center pt-1 border-t border-slate-700/50">
              <span className="text-xs text-slate-400 font-medium">{t('Ratio inliers')}</span>
              <span className={`text-xs font-mono font-bold ${getInlierColor(result.inlier_ratio)}`}>
                {(result.inlier_ratio * 100).toFixed(1)}%
              </span>
            </div>

            {/* Validite */}
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-400">{t('Homographie valide')}</span>
              {result.homography_valid ? (
                <span className="flex items-center gap-1 text-xs text-green-400">
                  <CheckCircle size={11} /> {t('Oui')} (&ge;30%)
                </span>
              ) : (
                <span className="flex items-center gap-1 text-xs text-red-400">
                  <XCircle size={11} /> {t('Non')} (&lt;30%)
                </span>
              )}
            </div>
          </div>

          {/* Legende */}
          <div className="px-2 py-1.5 border-b border-slate-700 flex gap-3">
            <span className="flex items-center gap-1 text-xs text-slate-500">
              <span className="w-3 h-0.5 bg-green-500 inline-block" /> {t('Inliers')}
            </span>
            <span className="flex items-center gap-1 text-xs text-slate-500">
              <span className="w-3 h-0.5 bg-red-500 inline-block" /> {t('Outliers')}
            </span>
          </div>

          {/* Visualisation */}
          {result.visualization_b64 ? (
            <div className="p-2">
              <img
                src={`data:image/jpeg;base64,${result.visualization_b64}`}
                alt={t('Correspondances keypoints')}
                className="w-full rounded border border-slate-700"
              />
              <p className="text-xs text-slate-600 text-center mt-1">
                Frame {result.frame_a_index} → Frame {result.frame_b_index}
              </p>
            </div>
          ) : (
            <div className="px-2 py-3 text-xs text-slate-500 text-center">
              {t('Pas assez de matches pour la visualisation.')}
            </div>
          )}
        </div>
      )}

      {!result && !isLoading && !error && (
        <div className="flex-1 flex items-center justify-center text-xs text-slate-600 text-center px-4">
          {t('Selectionnez deux frames et cliquez "Calculer homographie" pour analyser le matching.')}
        </div>
      )}
    </div>
  )
}
