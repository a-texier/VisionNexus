// ============================================================
// components/tour/TourProvider.tsx
// Moteur de tour guide generique et portable : aucune dependance a
// une lib d'etat (zustand...) ou de routage -- la navigation est
// injectee via le TourRuntimeContext passe a start().
// ============================================================

import React, { useCallback, useEffect, useReducer, useRef } from 'react'
import type { TourOptions, TourRuntimeContext, TourStep } from './types'
import { TourContext, type TourState } from './TourContext'

type TourAction =
  | { type: 'START'; steps: TourStep[]; ctx: TourRuntimeContext }
  | { type: 'GOTO'; index: number }
  | { type: 'STOP' }
  | { type: 'BUSY'; busy: boolean }
  | { type: 'TICK' }

const initialState: TourState = { steps: [], index: 0, isOpen: false, busy: false, ctx: {} }

const reducer = (state: TourState, action: TourAction): TourState => {
  switch (action.type) {
    case 'START':
      return {
        steps: action.steps,
        ctx: action.ctx,
        index: 0,
        isOpen: action.steps.length > 0,
        busy: false,
      }
    case 'GOTO':
      return { ...state, index: action.index, busy: false }
    case 'STOP':
      return { ...state, isOpen: false, busy: false }
    case 'BUSY':
      return { ...state, busy: action.busy }
    case 'TICK':
      // Le contexte runtime est mute en place par les etapes : on force un
      // rendu pour que les consommateurs relisent sa valeur.
      return { ...state }
    default:
      return state
  }
}

export const TourProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, dispatch] = useReducer(reducer, initialState)
  const optionsRef = useRef<TourOptions>({})
  // Jeton de generation : invalide les beforeShow/onNext encore en vol quand
  // l'utilisateur avance ou ferme le tour entre-temps.
  const runTokenRef = useRef(0)
  const prevStepRef = useRef<TourStep | null>(null)

  const start = useCallback((steps: TourStep[], ctx: TourRuntimeContext, options?: TourOptions) => {
    optionsRef.current = options ?? {}
    runTokenRef.current += 1
    prevStepRef.current = null
    dispatch({ type: 'START', steps, ctx })
  }, [])

  const patchContext = useCallback((patch: Partial<TourRuntimeContext>) => {
    dispatch({ type: 'TICK' })
    Object.assign(state.ctx, patch)
  }, [state.ctx])

  const stop = useCallback(() => {
    runTokenRef.current += 1
    dispatch({ type: 'STOP' })
  }, [])

  // next/prev sont recrees a chaque rendu : ils closent sur l'etat courant,
  // sans passer par une ref lue pendant le rendu.
  const next = () => {
    const { steps, index, isOpen, busy, ctx } = state
    if (!isOpen || busy) return
    const step = steps[index]
    const token = ++runTokenRef.current
    const advance = () => {
      if (runTokenRef.current !== token) return
      if (index >= steps.length - 1) {
        optionsRef.current.onFinish?.(ctx)
        dispatch({ type: 'STOP' })
      } else {
        dispatch({ type: 'GOTO', index: index + 1 })
      }
    }
    const result = step?.onNext?.(ctx)
    if (result && typeof (result as Promise<void>).then === 'function') {
      dispatch({ type: 'BUSY', busy: true })
      void (result as Promise<void>)
        .catch((e) => console.error('[tour] onNext', step?.id, e))
        .finally(advance)
    } else {
      advance()
    }
  }

  const prev = () => {
    if (!state.isOpen || state.busy || state.index === 0) return
    runTokenRef.current += 1
    dispatch({ type: 'GOTO', index: state.index - 1 })
  }

  // Cycle de vie d'une etape : afterHide de la precedente, puis beforeShow de
  // la courante (le bouton d'avancement reste desactive si elle est async).
  const { isOpen, index, steps, ctx } = state
  useEffect(() => {
    const previous = prevStepRef.current
    const step = isOpen ? steps[index] : null
    prevStepRef.current = step

    if (previous && previous !== step) void previous.afterHide?.(ctx)
    if (!step) {
      if (previous) optionsRef.current.onExit?.(ctx)
      return
    }

    const token = runTokenRef.current
    const result = step.beforeShow?.(ctx)
    if (result && typeof (result as Promise<void>).then === 'function') {
      dispatch({ type: 'BUSY', busy: true })
      void (result as Promise<void>)
        .catch((e) => console.error('[tour] beforeShow', step.id, e))
        .finally(() => {
          if (runTokenRef.current === token) dispatch({ type: 'BUSY', busy: false })
        })
    }
    // ctx est mute en place par les etapes : le reinclure relancerait
    // inutilement beforeShow.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, index, steps])

  useEffect(() => {
    if (!isOpen) return undefined
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') stop()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isOpen, stop])

  return (
    <TourContext.Provider value={{ state, start, next, prev, stop, patchContext }}>
      {children}
    </TourContext.Provider>
  )
}
