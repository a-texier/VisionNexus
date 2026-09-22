// ============================================================
// components/common/ConfirmDialog.tsx
// Dialogue de confirmation modal générique.
// ============================================================

import React from 'react'
import { AlertTriangle } from 'lucide-react'
import { useT } from '../../i18n/useLang'

interface ConfirmDialogProps {
  isOpen: boolean
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  title,
  message,
  confirmLabel = 'Confirmer',
  cancelLabel = 'Annuler',
  danger = false,
  onConfirm,
  onCancel,
}) => {
  const t = useT()
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onCancel}
      />

      {/* Dialogue */}
      <div className="relative bg-slate-800 border border-slate-700 rounded-lg p-6 w-80 shadow-xl">
        <div className="flex items-start gap-3 mb-4">
          <AlertTriangle
            size={20}
            className={danger ? 'text-red-400 flex-shrink-0 mt-0.5' : 'text-yellow-400 flex-shrink-0 mt-0.5'}
          />
          <div>
            <h3 className="text-sm font-semibold text-slate-100">{t(title)}</h3>
            <p className="text-sm text-slate-400 mt-1">{t(message)}</p>
          </div>
        </div>

        <div className="flex gap-2 justify-end">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-sm text-slate-300 hover:text-white bg-slate-700 hover:bg-slate-600 rounded transition-colors"
          >
            {t(cancelLabel)}
          </button>
          <button
            onClick={onConfirm}
            className={`px-3 py-1.5 text-sm text-white rounded transition-colors ${
              danger
                ? 'bg-red-600 hover:bg-red-500'
                : 'bg-blue-600 hover:bg-blue-500'
            }`}
          >
            {t(confirmLabel)}
          </button>
        </div>
      </div>
    </div>
  )
}
