// ============================================================
// components/common/LoadingSpinner.tsx
// Spinner de chargement générique.
// ============================================================

import React from 'react'

interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg'
  label?: string
}

const SIZE_MAP = {
  sm: 'w-4 h-4 border-2',
  md: 'w-8 h-8 border-2',
  lg: 'w-12 h-12 border-3',
}

export const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({
  size = 'md',
  label,
}) => (
  <div className="flex flex-col items-center gap-2">
    <div
      className={`${SIZE_MAP[size]} rounded-full border-slate-600 border-t-blue-400 animate-spin`}
    />
    {label && <span className="text-xs text-slate-400">{label}</span>}
  </div>
)
