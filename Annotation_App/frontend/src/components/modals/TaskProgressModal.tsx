// ============================================================
// components/modals/TaskProgressModal.tsx
// Modal générique d'affichage de progression d'une tâche async.
// Utilisé pour ByteTrack, homographie, SAM auto-segment.
// ============================================================

import React from 'react'
import { X, CheckCircle, XCircle, Loader2 } from 'lucide-react'
import { useTaskPolling } from '../../hooks/useTaskPolling'
import { useT } from '../../i18n/useLang'

interface TaskProgressModalProps {
  taskId: string | null
  title: string
  onClose: () => void
  onSuccess?: () => void
}

export const TaskProgressModal: React.FC<TaskProgressModalProps> = ({
  taskId,
  title,
  onClose,
  onSuccess,
}) => {
  const t = useT()
  const { taskStatus } = useTaskPolling(taskId)

  if (!taskId) return null

  const isCompleted = taskStatus?.status === 'completed'
  const isFailed = taskStatus?.status === 'error'
  const isPending = !taskStatus || taskStatus.status === 'pending'
  const progress = taskStatus?.progress ?? 0
  const message = taskStatus?.status === 'running' ? `${t('Traitement...')} ${progress}%` : t('Initialisation...')

  // Appel du callback onSuccess une seule fois quand la tâche réussit
  React.useEffect(() => {
    if (isCompleted && onSuccess) onSuccess()
  }, [isCompleted, onSuccess])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      <div className="relative bg-slate-800 border border-slate-700 rounded-xl p-6 w-80 shadow-2xl">
        {/* En-tête */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-slate-100">{title}</h2>
          {(isCompleted || isFailed) && (
            <button
              onClick={onClose}
              className="p-1 rounded hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
            >
              <X size={16} />
            </button>
          )}
        </div>

        {/* Icône d'état */}
        <div className="flex justify-center mb-4">
          {isPending && (
            <Loader2 size={32} className="text-blue-400 animate-spin" />
          )}
          {isCompleted && (
            <CheckCircle size={32} className="text-green-400" />
          )}
          {isFailed && (
            <XCircle size={32} className="text-red-400" />
          )}
          {!isPending && !isCompleted && !isFailed && (
            <Loader2 size={32} className="text-blue-400 animate-spin" />
          )}
        </div>

        {/* Message */}
        <p className="text-xs text-slate-400 text-center mb-3">{message}</p>

        {/* Barre de progression */}
        {!isFailed && (
          <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden mb-3">
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                isCompleted ? 'bg-green-400' : 'bg-blue-400'
              }`}
              style={{ width: `${isCompleted ? 100 : progress}%` }}
            />
          </div>
        )}

        {/* Progression numérique */}
        {!isCompleted && !isFailed && (
          <p className="text-xs text-slate-600 text-center">{progress}%</p>
        )}

        {/* Bouton fermer si terminé */}
        {(isCompleted || isFailed) && (
          <button
            onClick={onClose}
            className={`w-full mt-2 py-1.5 text-sm rounded-lg transition-colors ${
              isCompleted
                ? 'bg-green-600/20 text-green-400 hover:bg-green-600/30'
                : 'bg-red-600/20 text-red-400 hover:bg-red-600/30'
            }`}
          >
            {isCompleted ? t('Terminé') : t('Fermer')}
          </button>
        )}
      </div>
    </div>
  )
}
