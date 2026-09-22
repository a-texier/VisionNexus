// ============================================================
// components/ThemeProvider.tsx
// Injecte des variables CSS dans <head> selon les préférences
// utilisateur (background + accent).
// Usage : <ThemeProvider /> monté une fois dans App.tsx.
// ============================================================

import { useEffect } from 'react'
import { settingsAPI } from '../api/client'

// ---- Palettes disponibles ----

export const BG_THEMES: Record<string, { label: string; preview: string; vars: Record<string, string> }> = {
  'dark-gray': {
    label: 'Gris sombre (défaut)',
    preview: '#1f2937',
    vars: {
      '--explorer-950': '#030712',
      '--explorer-900': '#111827',
      '--explorer-800': '#1f2937',
      '--explorer-700': '#374151',
    },
  },
  'dark-slate': {
    label: 'Bleu nuit',
    preview: '#162742',
    vars: {
      '--explorer-950': '#020b18',
      '--explorer-900': '#0c1a2e',
      '--explorer-800': '#162742',
      '--explorer-700': '#1e3456',
    },
  },
  'dark-purple': {
    label: 'Violet sombre',
    preview: '#1e1340',
    vars: {
      '--explorer-950': '#0d0618',
      '--explorer-900': '#160d2a',
      '--explorer-800': '#1e1340',
      '--explorer-700': '#271855',
    },
  },
  'dark-teal': {
    label: 'Teal profond',
    preview: '#0f2a29',
    vars: {
      '--explorer-950': '#010e0e',
      '--explorer-900': '#091e1d',
      '--explorer-800': '#0f2a29',
      '--explorer-700': '#153836',
    },
  },
  'dark-zinc': {
    label: 'Zinc chaud',
    preview: '#27272f',
    vars: {
      '--explorer-950': '#0f0f12',
      '--explorer-900': '#1a1a22',
      '--explorer-800': '#27272f',
      '--explorer-700': '#3f3f47',
    },
  },
}

export const ACCENT_THEMES: Record<string, { label: string; color: string; vars: Record<string, string> }> = {
  'indigo': {
    label: 'Indigo (défaut)',
    color: '#6366f1',
    vars: {
      '--explorer-accent': '#4f46e5',
      '--explorer-accent-light': '#6366f1',
      '--explorer-accent-text': '#818cf8',
      '--explorer-accent-muted': 'rgba(79,70,229,0.2)',
      '--explorer-accent-border': 'rgba(99,102,241,0.4)',
    },
  },
  'blue': {
    label: 'Bleu',
    color: '#3b82f6',
    vars: {
      '--explorer-accent': '#2563eb',
      '--explorer-accent-light': '#3b82f6',
      '--explorer-accent-text': '#60a5fa',
      '--explorer-accent-muted': 'rgba(37,99,235,0.2)',
      '--explorer-accent-border': 'rgba(59,130,246,0.4)',
    },
  },
  'violet': {
    label: 'Violet',
    color: '#8b5cf6',
    vars: {
      '--explorer-accent': '#7c3aed',
      '--explorer-accent-light': '#8b5cf6',
      '--explorer-accent-text': '#a78bfa',
      '--explorer-accent-muted': 'rgba(124,58,237,0.2)',
      '--explorer-accent-border': 'rgba(139,92,246,0.4)',
    },
  },
  'emerald': {
    label: 'Émeraude',
    color: '#10b981',
    vars: {
      '--explorer-accent': '#059669',
      '--explorer-accent-light': '#10b981',
      '--explorer-accent-text': '#34d399',
      '--explorer-accent-muted': 'rgba(5,150,105,0.2)',
      '--explorer-accent-border': 'rgba(16,185,129,0.4)',
    },
  },
  'rose': {
    label: 'Rose',
    color: '#f43f5e',
    vars: {
      '--explorer-accent': '#e11d48',
      '--explorer-accent-light': '#f43f5e',
      '--explorer-accent-text': '#fb7185',
      '--explorer-accent-muted': 'rgba(225,29,72,0.2)',
      '--explorer-accent-border': 'rgba(244,63,94,0.4)',
    },
  },
  'amber': {
    label: 'Ambre',
    color: '#f59e0b',
    vars: {
      '--explorer-accent': '#d97706',
      '--explorer-accent-light': '#f59e0b',
      '--explorer-accent-text': '#fbbf24',
      '--explorer-accent-muted': 'rgba(217,119,6,0.2)',
      '--explorer-accent-border': 'rgba(245,158,11,0.4)',
    },
  },
}

function buildCSS(bgKey: string, accentKey: string): string {
  const bg = BG_THEMES[bgKey] ?? BG_THEMES['dark-gray']
  const acc = ACCENT_THEMES[accentKey] ?? ACCENT_THEMES['indigo']

  const vars = { ...bg.vars, ...acc.vars }
  const rootVars = Object.entries(vars).map(([k, v]) => `  ${k}: ${v};`).join('\n')

  // Override des classes Tailwind bg-gray-* et indigo (principales)
  return `
:root {
${rootVars}
}

/* ---- Backgrounds ---- */
.bg-gray-950 { background-color: var(--explorer-950) !important; }
.bg-gray-900, .plot_bgcolor { background-color: var(--explorer-900) !important; }
.bg-gray-800 { background-color: var(--explorer-800) !important; }
.bg-gray-700 { background-color: var(--explorer-700) !important; }

/* ---- Borders ---- */
.border-gray-700 { border-color: color-mix(in srgb, var(--explorer-700) 60%, transparent) !important; }
.border-gray-800 { border-color: color-mix(in srgb, var(--explorer-800) 80%, transparent) !important; }

/* ---- Accent: boutons principaux ---- */
.bg-indigo-600, button.bg-indigo-600 { background-color: var(--explorer-accent) !important; }
.hover\\:bg-indigo-500:hover { background-color: var(--explorer-accent-light) !important; }
.hover\\:bg-indigo-500:hover, a.hover\\:bg-indigo-500:hover { background-color: var(--explorer-accent-light) !important; }

/* ---- Accent: textes ---- */
.text-indigo-400 { color: var(--explorer-accent-text) !important; }
.text-indigo-300 { color: var(--explorer-accent-light) !important; }

/* ---- Accent: sidebar active ---- */
.sidebar-active { background-color: var(--explorer-accent) !important; }

/* ---- Accent: progress / rings ---- */
.bg-indigo-500 { background-color: var(--explorer-accent-light) !important; }
.accent-indigo-500 { accent-color: var(--explorer-accent-light) !important; }
`.trim()
}

// ---- Composant ----

export default function ThemeProvider() {
  useEffect(() => {
    settingsAPI.get().then(settings => {
      applyTheme(settings.theme_bg ?? 'dark-gray', settings.theme_accent ?? 'indigo')
    }).catch(() => {
      // settings non disponibles — thème par défaut
      applyTheme('dark-gray', 'indigo')
    })
  }, [])

  return null
}

export function applyTheme(bgKey: string, accentKey: string) {
  const styleId = 'explorer-theme-style'
  let el = document.getElementById(styleId) as HTMLStyleElement | null
  if (!el) {
    el = document.createElement('style')
    el.id = styleId
    document.head.appendChild(el)
  }
  el.textContent = buildCSS(bgKey, accentKey)

  // Mémoriser dans data attrs pour les composants qui en ont besoin
  document.documentElement.setAttribute('data-bg', bgKey)
  document.documentElement.setAttribute('data-accent', accentKey)
}
