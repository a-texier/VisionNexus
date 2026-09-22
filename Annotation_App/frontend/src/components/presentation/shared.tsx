// ============================================================
// components/presentation/shared.tsx
// Composants partagés entre tous les onglets de la doc.
// ============================================================

import React, { useRef } from 'react'
import { motion, useInView } from 'framer-motion'
import type { Variants } from 'framer-motion'
import {
  ChevronRight,
  AlertTriangle,
  CheckCircle2,
  Lightbulb,
  Info,
} from 'lucide-react'

// ---- Types ----
export type MainTab = 'overview' | 'usage' | 'algorithms' | 'technical' | 'developer' | 'optimisations'
export type SubTab = 'random' | 'sequence'

// ---- Variants d'animation ----
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 28 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' as const } },
}
export const stagger: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.1 } },
}

// ---- Animation au scroll ----
export const AnimatedSection: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, margin: '-60px' })
  return (
    <motion.div ref={ref} variants={stagger} initial="hidden" animate={inView ? 'visible' : 'hidden'} className={className}>
      {children}
    </motion.div>
  )
}

// ---- Badge technologie ----
export const TechBadge: React.FC<{ label: string; color: string }> = ({ label, color }) => (
  <motion.span variants={fadeUp} className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold border ${color}`}>
    {label}
  </motion.span>
)

// ---- Card fonctionnalité ----
export const FeatureCard: React.FC<{ icon: React.ReactNode; title: string; desc: string; color: string }> = ({ icon, title, desc, color }) => (
  <motion.div variants={fadeUp} className="bg-slate-800/60 border border-slate-700 rounded-xl p-5 flex flex-col gap-3 hover:border-slate-500 transition-colors">
    <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${color}`}>{icon}</div>
    <div>
      <h3 className="text-sm font-semibold text-white mb-1">{title}</h3>
      <p className="text-xs text-slate-400 leading-relaxed">{desc}</p>
    </div>
  </motion.div>
)

// ---- Flèche de pipeline ----
export const Arrow: React.FC = () => <ChevronRight className="text-slate-500 flex-shrink-0" size={20} />

// ---- Étape de pipeline ----
export const PipelineStep: React.FC<{ label: string; sub?: string; color: string }> = ({ label, sub, color }) => (
  <motion.div variants={fadeUp} className={`flex flex-col items-center gap-1 px-4 py-2.5 rounded-xl border ${color} min-w-[100px]`}>
    <span className="text-xs font-semibold text-white text-center leading-tight">{label}</span>
    {sub && <span className="text-[10px] text-slate-400 text-center">{sub}</span>}
  </motion.div>
)

// ---- Sous-onglets (Random / Sequence) ----
export const SubTabBar: React.FC<{
  active: SubTab
  onChange: (t: SubTab) => void
  labels?: [string, string]
}> = ({ active, onChange, labels = ['Random Image', 'Séquence Image'] }) => (
  <div className="flex gap-2 mb-6">
    {(['random', 'sequence'] as SubTab[]).map((id, i) => (
      <button
        key={id}
        onClick={() => onChange(id)}
        className={`px-5 py-2 rounded-lg border text-xs font-semibold transition-colors ${
          active === id
            ? id === 'random'
              ? 'bg-blue-500/20 border-blue-500/60 text-blue-300'
              : 'bg-purple-500/20 border-purple-500/60 text-purple-300'
            : 'border-slate-700 bg-slate-800/40 text-slate-400 hover:text-slate-200'
        }`}
      >
        {labels[i]}
      </button>
    ))}
  </div>
)

// ---- Boite info / warning / success / tip ----
type InfoType = 'info' | 'warn' | 'success' | 'tip'
export const InfoBox: React.FC<{ type: InfoType; title: string; children: React.ReactNode }> = ({ type, title, children }) => {
  const styles: Record<InfoType, { box: string; icon: React.ReactNode; text: string }> = {
    info:    { box: 'bg-blue-900/20 border-blue-700/40',    icon: <Info size={14} className="text-blue-400" />,         text: 'text-blue-300'   },
    warn:    { box: 'bg-yellow-900/20 border-yellow-700/40', icon: <AlertTriangle size={14} className="text-yellow-400" />, text: 'text-yellow-300' },
    success: { box: 'bg-green-900/20 border-green-700/40',   icon: <CheckCircle2 size={14} className="text-green-400" />, text: 'text-green-300'  },
    tip:     { box: 'bg-purple-900/20 border-purple-700/40', icon: <Lightbulb size={14} className="text-purple-400" />,   text: 'text-purple-300' },
  }
  const s = styles[type]
  return (
    <div className={`rounded-xl p-4 border ${s.box}`}>
      <div className="flex items-center gap-2 mb-1.5">{s.icon}<span className={`font-semibold text-xs ${s.text}`}>{title}</span></div>
      <div className="text-xs text-slate-400 leading-relaxed">{children}</div>
    </div>
  )
}

// ---- Bloc de code ----
export const CodeBlock: React.FC<{ code: string; color?: string; label?: string }> = ({ code, color = 'text-emerald-300', label }) => (
  <div className="bg-slate-900/80 border border-slate-700 rounded-xl overflow-hidden">
    {label && (
      <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-700 bg-slate-800/60">
        <div className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
        <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/60" />
        <div className="w-2.5 h-2.5 rounded-full bg-green-500/60" />
        <span className="ml-2 text-xs text-slate-500 font-mono">{label}</span>
      </div>
    )}
    <pre className={`p-4 text-[11px] font-mono leading-relaxed overflow-x-auto ${color}`}>{code}</pre>
  </div>
)

// ---- Ligne de paramètre documenté ----
export const ParamRow: React.FC<{ name: string; default_?: string; desc: string }> = ({ name, default_, desc }) => (
  <div className="flex items-start gap-3 py-2 border-b border-slate-800 last:border-0">
    <code className="flex-shrink-0 px-2 py-0.5 bg-slate-700 rounded text-[11px] text-white font-mono min-w-[120px]">{name}</code>
    {default_ && <span className="flex-shrink-0 text-[10px] text-slate-500 mt-0.5 min-w-[60px]">défaut: {default_}</span>}
    <span className="text-xs text-slate-400 leading-relaxed">{desc}</span>
  </div>
)
