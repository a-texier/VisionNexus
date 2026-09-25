// ============================================================
// components/tour/TourLaunchButton.tsx
// Bouton d'entree du tutoriel. Halo orange pulsant tant que l'utilisateur
// ne l'a jamais lance (glow), neutre ensuite.
//
// Styles inline + keyframes injectees : portable tel quel (aucune classe
// Tailwind, aucune icone externe).
// ============================================================

import React from 'react'
import { useT } from '../../i18n/useLang'

const KEYFRAMES = `
@keyframes tour-launch-glow {
  0%, 100% { box-shadow: 0 0 0 0 rgba(249,115,22,0.55), 0 0 14px 2px rgba(249,115,22,0.45); }
  50%      { box-shadow: 0 0 0 7px rgba(249,115,22,0), 0 0 24px 6px rgba(249,115,22,0.7); }
}
@keyframes tour-launch-sheen {
  0%   { transform: translateX(-120%); }
  60%  { transform: translateX(240%); }
  100% { transform: translateX(240%); }
}
`

interface TourLaunchButtonProps {
  onClick: () => void
  // True = jamais lance : halo orange pulsant pour attirer l'oeil.
  glow?: boolean
  label?: string
  title?: string
}

export const TourLaunchButton: React.FC<TourLaunchButtonProps> = ({
  onClick,
  glow = false,
  label,
  title,
}) => {
  const t = useT()
  const resolvedLabel = label ?? t('Tutoriel interactif')
  const resolvedTitle = title ?? (glow
    ? t("Demarrer le tutoriel : creation d'un projet demo guidee de bout en bout")
    : t('Relancer le tutoriel interactif'))
  return (
  <>
    <style>{KEYFRAMES}</style>
    <button
      onClick={onClick}
      title={resolvedTitle}
      style={{
        position: 'relative',
        overflow: 'hidden',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 7,
        padding: '6px 13px',
        borderRadius: 999,
        fontSize: 12.5,
        fontWeight: 600,
        fontFamily: 'inherit',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        transition: 'filter 150ms ease, border-color 150ms ease',
        border: glow ? '1px solid #fb923c' : '1px solid #475569',
        color: glow ? '#0f172a' : '#cbd5e1',
        background: glow
          ? 'linear-gradient(135deg, #fb923c 0%, #f97316 55%, #ea580c 100%)'
          : 'rgba(30,41,59,0.9)',
        animation: glow ? 'tour-launch-glow 2.1s ease-in-out infinite' : undefined,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.filter = 'brightness(1.12)' }}
      onMouseLeave={(e) => { e.currentTarget.style.filter = 'none' }}
    >
      {/* Reflet qui balaie le bouton tant qu'il n'a jamais ete clique */}
      {glow && (
        <span
          aria-hidden
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: 0,
            width: '35%',
            background: 'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.55) 50%, rgba(255,255,255,0) 100%)',
            animation: 'tour-launch-sheen 2.8s ease-in-out infinite',
            pointerEvents: 'none',
          }}
        />
      )}
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
        <path d="M12 3 3 8l9 5 9-5-9-5Z" />
        <path d="M7 10.5V15c0 1.4 2.2 2.5 5 2.5s5-1.1 5-2.5v-4.5" />
        <path d="M21 8v5" />
      </svg>
      <span style={{ position: 'relative' }}>{resolvedLabel}</span>
    </button>
  </>
  )
}
