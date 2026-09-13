// ============================================================
// components/tour/TourContext.ts
// Contexte + hook useTour, separes de TourProvider.tsx (qui n'exporte
// que le composant Provider) pour rester compatible avec le fast
// refresh de Vite.
// ============================================================

import { createContext, useContext } from 'react'
import type { TourOptions, TourRuntimeContext, TourStep } from './types'

export interface TourState {
  steps: TourStep[]
  index: number
  isOpen: boolean
  // True pendant l'execution d'un beforeShow/onNext asynchrone : l'etape se
  // met en place (navigation, ouverture de modal, import...).
  busy: boolean
  ctx: TourRuntimeContext
}

export interface TourContextValue {
  state: TourState
  start: (steps: TourStep[], ctx: TourRuntimeContext, options?: TourOptions) => void
  next: () => void
  prev: () => void
  stop: () => void
  // Met a jour le contexte runtime en cours de tour (ex : id du projet cree
  // a l'etape 3, lu par les etapes suivantes).
  patchContext: (patch: Partial<TourRuntimeContext>) => void
}

export const TourContext = createContext<TourContextValue | null>(null)

export const useTour = (): TourContextValue => {
  const ctx = useContext(TourContext)
  if (!ctx) throw new Error('useTour must be used within a TourProvider')
  return ctx
}
