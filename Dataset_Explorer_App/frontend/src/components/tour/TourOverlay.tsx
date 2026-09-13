// ============================================================
// components/tour/TourOverlay.tsx
// Rendu visuel du tour : spotlight (trou dans un fond sombre) autour
// de la cible + bulle d'explication. Styles inline volontairement
// (portable quelle que soit la version de Tailwind -- ou son absence --
// de l'app hote).
//
// L'overlay ne capte PAS les clics (pointerEvents: none) sauf sur la
// bulle : l'utilisateur doit pouvoir agir dans l'app pendant le tour
// (dessiner une bbox, cliquer un bouton mis en surbrillance).
// ============================================================

import React, { useEffect, useRef, useState } from 'react'
import { useTour } from './TourContext'
import { useTourTarget } from './useTourTarget'
import { computeTooltipPlacement } from './positioning'

const DEFAULT_SPOTLIGHT_PADDING = 6
const DEFAULT_WAIT_TIMEOUT_MS = 8000
const TOOLTIP_WIDTH = 360

const ACCENT = '#f97316'          // orange 500 -- identite visuelle du tutoriel
const ACCENT_SOFT = 'rgba(249,115,22,0.18)'
// Assombrissement du fond : assez pour porter l'attention sur la cible, assez
// leger pour que le reste de l'interface reste lisible pendant l'explication.
const BACKDROP = 'rgba(2,6,23,0.45)'

export const TourOverlay: React.FC = () => {
  const { state, next, prev, stop } = useTour()
  const step = state.isOpen ? state.steps[state.index] : null
  const tooltipRef = useRef<HTMLDivElement>(null)
  const [tooltipSize, setTooltipSize] = useState({ width: TOOLTIP_WIDTH, height: 200 })
  // Re-render periodique : sonde canAdvance et suit une cible qui bouge.
  const [, forceTick] = useState(0)

  const { rect, found, timedOut } = useTourTarget(
    step?.target?.selector ?? null,
    state.isOpen,
    step?.spotlightPadding ?? DEFAULT_SPOTLIGHT_PADDING,
    step?.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS,
  )

  // La taille reelle de la bulle conditionne son placement : on la mesure par
  // observation (le contenu change a chaque etape).
  useEffect(() => {
    const el = tooltipRef.current
    if (!el) return undefined
    const observer = new ResizeObserver(() => {
      const { width, height } = el.getBoundingClientRect()
      if (width && height) {
        setTooltipSize((prev) =>
          prev.width === width && prev.height === height ? prev : { width, height })
      }
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [state.isOpen])

  // Sonde periodique : evalue canAdvance et suit les cibles secondaires,
  // qui peuvent apparaitre ou se deplacer comme la cible principale.
  const needsPolling = Boolean(step?.canAdvance) || Boolean(step?.alsoTargets?.length)
  useEffect(() => {
    if (!needsPolling) return undefined
    const timer = setInterval(() => forceTick((v) => v + 1), 200)
    return () => clearInterval(timer)
  }, [needsPolling, state.index])

  // Fleches gauche/droite = precedent/suivant, comme dans un diaporama.
  // Ignorees quand la frappe vise un champ de saisie de l'app.
  //
  // Phase de CAPTURE + stopImmediatePropagation : l'app hote peut ecouter les
  // memes touches sur window (AnnotationApp y navigue entre frames).
  // preventDefault ne suffit pas -- il n'empeche pas les AUTRES ecouteurs. Sans
  // ce blocage, une fleche avancait le tour ET changeait de frame : on quittait
  // silencieusement la frame qu'on venait d'annoter, et l'etape suivante
  // trouvait un bouton grise (propagation impossible, aucune annotation ici).
  useEffect(() => {
    if (!state.isOpen) return undefined
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
      const el = e.target as HTMLElement | null
      const tag = el?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return
      e.preventDefault()
      e.stopImmediatePropagation()
      if (e.key === 'ArrowRight') next()
      else prev()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [state.isOpen, next, prev])

  if (!state.isOpen || !step) return null

  const viewport = { width: window.innerWidth, height: window.innerHeight }
  const centered = step.placement === 'center' || !step.target
  const tooltipPos = !centered && rect
    ? computeTooltipPlacement(
        rect,
        tooltipSize,
        step.placement && step.placement !== 'center' ? step.placement : 'auto',
        viewport,
      )
    : null

  const isLast = state.index === state.steps.length - 1
  const isFirst = state.index === 0
  const blocked = Boolean(step.canAdvance && !step.canAdvance(state.ctx))
  const disabled = state.busy || blocked
  const paragraphs = Array.isArray(step.body) ? step.body : [step.body]
  const progress = ((state.index + 1) / state.steps.length) * 100

  const spotlightStyle: React.CSSProperties = rect && !centered
    ? {
        position: 'fixed',
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
        borderRadius: 10,
        boxShadow: `0 0 0 9999px ${BACKDROP}, 0 0 0 3px ${ACCENT}, 0 0 22px 4px ${ACCENT_SOFT}`,
        background: 'transparent',
        transition: 'top 220ms ease, left 220ms ease, width 220ms ease, height 220ms ease',
        pointerEvents: 'none',
      }
    : {
        position: 'fixed',
        inset: 0,
        background: BACKDROP,
        pointerEvents: 'none',
      }

  const btnBase: React.CSSProperties = {
    border: 'none',
    cursor: 'pointer',
    fontSize: 12,
    padding: '7px 14px',
    borderRadius: 7,
    fontFamily: 'inherit',
  }

  // Anneaux secondaires : mesures a chaque rendu (la sonde ci-dessus en
  // declenche un regulierement), sans trou dans le fond sombre.
  const secondaryRects = (step.alsoTargets ?? [])
    .map(({ selector }) => document.querySelector(selector))
    .filter((el): el is Element => el !== null)
    .map((el) => el.getBoundingClientRect())

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 2147483000, pointerEvents: 'none' }}>
      <div style={spotlightStyle} />

      {secondaryRects.map((r, i) => (
        <div
          key={i}
          style={{
            position: 'fixed',
            top: r.top - 3,
            left: r.left - 3,
            width: r.width + 6,
            height: r.height + 6,
            borderRadius: 10,
            boxShadow: `0 0 0 2px ${ACCENT}, 0 0 18px 3px ${ACCENT_SOFT}`,
            pointerEvents: 'none',
          }}
        />
      ))}

      <div
        ref={tooltipRef}
        style={{
          position: 'fixed',
          top: tooltipPos ? tooltipPos.top : Math.max(16, viewport.height / 2 - tooltipSize.height / 2),
          left: tooltipPos ? tooltipPos.left : viewport.width / 2 - TOOLTIP_WIDTH / 2,
          width: TOOLTIP_WIDTH,
          maxWidth: '92vw',
          maxHeight: '82vh',
          overflowY: 'auto',
          background: '#0f172a',
          color: '#e2e8f0',
          border: '1px solid #334155',
          borderTop: `3px solid ${ACCENT}`,
          borderRadius: 12,
          boxShadow: '0 24px 48px rgba(0,0,0,0.6)',
          padding: '14px 18px 16px',
          fontSize: 13,
          lineHeight: 1.55,
          fontFamily: 'inherit',
          pointerEvents: 'auto',
          transition: 'top 220ms ease, left 220ms ease',
        }}
      >
        {/* Ligne de progression */}
        <div style={{ height: 3, background: '#1e293b', borderRadius: 2, marginBottom: 10 }}>
          <div style={{ height: 3, width: `${progress}%`, background: ACCENT, borderRadius: 2, transition: 'width 220ms ease' }} />
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, gap: 8 }}>
          <span style={{ fontSize: 10, color: ACCENT, textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {step.chapter ?? 'Tutoriel'}
          </span>
          <span style={{ fontSize: 10, color: '#64748b', flexShrink: 0 }}>
            {state.index + 1} / {state.steps.length}
          </span>
          <button
            onClick={stop}
            aria-label="Fermer le tutoriel"
            style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 17, lineHeight: 1, padding: 0, flexShrink: 0 }}
          >
            &times;
          </button>
        </div>

        <h3 style={{ margin: '0 0 8px', fontSize: 15, fontWeight: 600, color: '#f8fafc' }}>{step.title}</h3>

        {paragraphs.map((text, i) => (
          <p key={i} style={{ margin: '0 0 8px', color: '#cbd5e1' }}>{text}</p>
        ))}

        {step.hint && (
          <div style={{
            margin: '10px 0 4px',
            padding: '8px 10px',
            background: ACCENT_SOFT,
            border: `1px solid rgba(249,115,22,0.35)`,
            borderRadius: 8,
            color: '#fdba74',
            fontSize: 12,
          }}>
            <strong style={{ color: '#fb923c' }}>A vous de jouer : </strong>{step.hint}
          </div>
        )}

        <div style={{ minHeight: 18, margin: '8px 0 10px' }}>
          {state.busy && (
            <span style={{ fontSize: 11, color: ACCENT }}>Mise en place de l'etape...</span>
          )}
          {!state.busy && blocked && (
            <span style={{ fontSize: 11, color: '#fbbf24' }}>
              {step.waitingLabel ?? 'En attente de votre action...'}
            </span>
          )}
          {!state.busy && !blocked && step.target && !found && !timedOut && (
            <span style={{ fontSize: 11, color: '#64748b' }}>Recherche de l'element...</span>
          )}
          {!state.busy && step.target && timedOut && !found && (
            <span style={{ fontSize: 11, color: '#f59e0b' }}>
              Element introuvable a l'ecran -- continuez manuellement puis avancez.
            </span>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <button
            onClick={stop}
            style={{ ...btnBase, background: 'none', color: '#64748b', padding: '7px 0' }}
          >
            Quitter
          </button>
          <div style={{ display: 'flex', gap: 6 }}>
            {!isFirst && (
              <button
                onClick={prev}
                disabled={state.busy}
                style={{ ...btnBase, background: '#1e293b', color: '#cbd5e1', opacity: state.busy ? 0.4 : 1 }}
              >
                Precedent
              </button>
            )}
            <button
              onClick={next}
              disabled={disabled}
              style={{
                ...btnBase,
                background: disabled ? '#334155' : ACCENT,
                color: disabled ? '#64748b' : '#0f172a',
                fontWeight: 600,
                cursor: disabled ? 'default' : 'pointer',
              }}
            >
              {isLast ? 'Terminer' : (step.nextLabel ?? 'Suivant')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
