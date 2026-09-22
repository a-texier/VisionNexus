// ============================================================
// pages/PresentationPage.tsx
// Documentation intégrée de l'application AnnotationApp.
// 4 onglets principaux — contenu dans components/presentation/
// ============================================================

import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BookOpen, PlayCircle, Settings, Code2, ArrowLeft, Brain, Gauge } from 'lucide-react'
import type { MainTab, SubTab } from '../components/presentation/shared'
import { TabOverview } from '../components/presentation/TabOverview'
import { TabUsage } from '../components/presentation/TabUsage'
import { TabAlgorithms } from '../components/presentation/TabAlgorithms'
import { TabTechnical } from '../components/presentation/TabTechnical'
import { TabDeveloper } from '../components/presentation/TabDeveloper'
import { TabOptimisations } from '../components/presentation/TabOptimisations'
import { useT } from '../i18n/useLang'

// ---- Config des onglets principaux ----
const MAIN_TABS: {
  id: MainTab
  label: string
  icon: React.ReactNode
  active: string
  inactive: string
}[] = [
  {
    id: 'overview',
    label: 'Généralités',
    icon: <BookOpen size={14} />,
    active: 'bg-blue-500/20 border-blue-500/60 text-blue-300',
    inactive: 'border-slate-700 bg-slate-800/40 text-slate-400 hover:text-slate-200',
  },
  {
    id: 'usage',
    label: 'Utilisation',
    icon: <PlayCircle size={14} />,
    active: 'bg-green-500/20 border-green-500/60 text-green-300',
    inactive: 'border-slate-700 bg-slate-800/40 text-slate-400 hover:text-slate-200',
  },
  {
    id: 'algorithms',
    label: 'Algorithmes',
    icon: <Brain size={14} />,
    active: 'bg-violet-500/20 border-violet-500/60 text-violet-300',
    inactive: 'border-slate-700 bg-slate-800/40 text-slate-400 hover:text-slate-200',
  },
  {
    id: 'technical',
    label: 'Technique & Méthodes',
    icon: <Settings size={14} />,
    active: 'bg-orange-500/20 border-orange-500/60 text-orange-300',
    inactive: 'border-slate-700 bg-slate-800/40 text-slate-400 hover:text-slate-200',
  },
  {
    id: 'developer',
    label: 'Mode Développeur',
    icon: <Code2 size={14} />,
    active: 'bg-purple-500/20 border-purple-500/60 text-purple-300',
    inactive: 'border-slate-700 bg-slate-800/40 text-slate-400 hover:text-slate-200',
  },
  {
    id: 'optimisations',
    label: 'Optimisations',
    icon: <Gauge size={14} />,
    active: 'bg-cyan-500/20 border-cyan-500/60 text-cyan-300',
    inactive: 'border-slate-700 bg-slate-800/40 text-slate-400 hover:text-slate-200',
  },
]

export const PresentationPage: React.FC = () => {
  const navigate = useNavigate()
  const t = useT()
  const [mainTab, setMainTab] = useState<MainTab>('overview')
  const [usageSubTab, setUsageSubTab] = useState<SubTab>('random')
  const [techSubTab, setTechSubTab] = useState<SubTab>('random')

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 overflow-x-hidden">
      {/* ---- Navbar avec onglets ---- */}
      <nav className="sticky top-0 z-50 bg-slate-950/95 backdrop-blur border-b border-slate-800 px-6 py-3 flex items-center gap-4 flex-wrap">
        <button
          onClick={() => navigate('/')}
          data-tour="presentation-back"
          className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors text-sm flex-shrink-0"
        >
          <ArrowLeft size={16} />
          {t('Retour aux projets')}
        </button>
        <div className="flex-1 min-w-0" />
        <div className="flex gap-2 flex-wrap" data-tour="presentation-tabs">
          {MAIN_TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setMainTab(tab.id)}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg border text-xs font-semibold transition-colors ${
                mainTab === tab.id ? tab.active : tab.inactive
              }`}
            >
              {tab.icon}
              {t(tab.label)}
            </button>
          ))}
        </div>
      </nav>

      {/* ---- Contenu par onglet ---- */}
      {mainTab === 'overview' && <TabOverview />}

      {mainTab === 'usage' && (
        <div className="px-6 py-8 max-w-5xl mx-auto">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-8 h-8 rounded-lg bg-green-500/20 flex items-center justify-center">
              <PlayCircle size={16} className="text-green-400" />
            </div>
            <h2 className="text-xl font-bold text-white">{t("Utilisation de l'Application")}</h2>
          </div>
          <TabUsage subTab={usageSubTab} onSubTabChange={setUsageSubTab} />
        </div>
      )}

      {mainTab === 'algorithms' && (
        <div className="px-6 py-8 max-w-5xl mx-auto">
          <TabAlgorithms />
        </div>
      )}

      {mainTab === 'technical' && (
        <div className="px-6 py-8 max-w-5xl mx-auto">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-8 h-8 rounded-lg bg-orange-500/20 flex items-center justify-center">
              <Settings size={16} className="text-orange-400" />
            </div>
            <h2 className="text-xl font-bold text-white">{t('Technique & Méthodologie')}</h2>
          </div>
          <TabTechnical subTab={techSubTab} onSubTabChange={setTechSubTab} />
        </div>
      )}

      {mainTab === 'developer' && <TabDeveloper />}
      {mainTab === 'optimisations' && <TabOptimisations />}

      {/* ---- Footer ---- */}
      <div className="border-t border-slate-800 px-6 py-8 text-center text-xs text-slate-600">
        AnnotationApp — {t('Documentation intégrée')} — FastAPI · React · Konva.js · SAM2 · SAMURAI · Grounding DINO · XFeat
      </div>
    </div>
  )
}
