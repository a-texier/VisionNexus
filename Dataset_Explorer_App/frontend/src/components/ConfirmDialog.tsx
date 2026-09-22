// ============================================================
// components/ConfirmDialog.tsx
// Confirmation d'action destructive, au style de l'application.
//
// Remplace window.confirm() : la boîte native ignore le thème, bloque le
// thread de rendu, et ne peut ni détailler la conséquence ni distinguer
// visuellement une suppression d'un simple avertissement.
// ============================================================

import { useEffect } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import { useT } from '../i18n/useLang'

export interface ConfirmDialogProps {
  open: boolean
  title: string
  message: string
  details?: string[]
  confirmLabel?: string
  cancelLabel?: string
  tone?: 'danger' | 'warning'
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmDialog({
  open, title, message, details = [],
  confirmLabel, cancelLabel,
  tone = 'danger', busy = false, onConfirm, onCancel,
}: ConfirmDialogProps) {
  const t = useT()
  const resolvedConfirmLabel = confirmLabel ?? t('Confirmer')
  const resolvedCancelLabel = cancelLabel ?? t('Annuler')
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
      if (e.key === 'Enter') onConfirm()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onCancel, onConfirm])

  if (!open) return null

  const accent = tone === 'danger'
    ? { border: 'border-red-600/40', icon: 'text-red-400', btn: 'bg-red-600 hover:bg-red-500' }
    : { border: 'border-amber-600/40', icon: 'text-amber-400', btn: 'bg-amber-600 hover:bg-amber-500' }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onClick={onCancel}
    >
      <div
        onClick={e => e.stopPropagation()}
        className={`bg-gray-900 border ${accent.border} rounded-xl max-w-md w-full p-5 shadow-xl`}
      >
        <div className="flex items-start gap-3">
          <AlertTriangle size={20} className={`${accent.icon} flex-shrink-0 mt-0.5`} />
          <div className="flex-1 min-w-0">
            <h3 className="text-white font-semibold">{title}</h3>
            <p className="text-gray-400 text-sm mt-1 whitespace-pre-line">{message}</p>
            {details.length > 0 && (
              <ul className="mt-2 space-y-0.5">
                {details.map((d, i) => (
                  <li key={i} className="text-xs text-gray-500 flex gap-1.5">
                    <span className="text-gray-600">•</span>{d}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button onClick={onCancel} className="text-gray-500 hover:text-white" aria-label={t('Fermer')}>
            <X size={16} />
          </button>
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button
            onClick={onCancel}
            disabled={busy}
            className="px-3 py-1.5 text-sm text-gray-300 bg-gray-800 hover:bg-gray-700 rounded-lg disabled:opacity-50"
          >
            {resolvedCancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className={`px-3 py-1.5 text-sm text-white ${accent.btn} rounded-lg disabled:opacity-50`}
          >
            {busy ? t('En cours…') : resolvedConfirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
