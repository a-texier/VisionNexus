// ============================================================
// App.tsx
// Routing principal + layout avec sidebar.
// ============================================================

import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, NavLink, useNavigate } from 'react-router-dom'
import { Image as ImageIcon, LayoutDashboard, Layers, BookOpen, Settings, Database } from 'lucide-react'
import { UserBadge } from './components/UserBadge'
import { TourProvider, TourOverlay, TourLaunchButton, useTour } from './components/tour'
import { buildDatasetTourSteps, type DatasetTourContext } from './components/help/datasetTourSteps'
import { readTutorialState, writeTutorialState, type TutorialState } from './utils/tutorialState'
import { useT } from './i18n/useLang'

import Gallery from './pages/Gallery'
import Catalog from './pages/Catalog'
import Dashboard from './pages/Dashboard'
import DatasetMap from './pages/DatasetMap'
import SemanticSearch from './pages/SemanticSearch'
import DuplicateExplorer from './pages/DuplicateExplorer'
import SubsetManager from './pages/SubsetManager'
import HelpPage from './pages/HelpPage'
import SettingsPage from './pages/SettingsPage'
import ThemeProvider from './components/ThemeProvider'
import { useSelectionStore } from './hooks/useSubset'

const NAV_ITEMS = [
  { to: '/', icon: <ImageIcon size={18} />, label: 'Dataset Gallery', exact: true, tour: 'nav-gallery' },
  { to: '/catalog', icon: <Database size={18} />, label: 'Catalogue', exact: true, tour: 'nav-catalog' },
  { to: '/playground', icon: <LayoutDashboard size={18} />, label: 'Playground', exact: true, tour: 'nav-playground' },
  { to: '/subsets', icon: <Layers size={18} />, label: 'Subsets', exact: true, tour: 'nav-subsets' },
  { to: '/help', icon: <BookOpen size={18} />, label: 'Documentation', exact: true, tour: 'nav-help' },
  { to: '/settings', icon: <Settings size={18} />, label: 'Paramètres', exact: true, tour: 'nav-settings' },
]

function Sidebar({ onStartTour, tourGlow }: { onStartTour: () => void; tourGlow: boolean }) {
  const t = useT()
  const { selectedIds } = useSelectionStore()

  return (
    <aside className="w-56 bg-gray-900 border-r border-gray-800 flex flex-col" data-tour="sidebar">
      <div className="px-4 py-5 border-b border-gray-800">
        <div className="flex items-center gap-2.5">
          {/* Logo Dataset Explorer — scatter UMAP, même style qu'AnnotationApp */}
          <div className="flex-shrink-0 w-8 h-8">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">
              <rect width="32" height="32" rx="7" fill="#0f172a"/>
              <line x1="5.5" y1="26.5" x2="27" y2="26.5" stroke="#1e293b" strokeWidth="1.2"/>
              <line x1="5.5" y1="5"    x2="5.5" y2="26.5" stroke="#1e293b" strokeWidth="1.2"/>
              {/* Cluster indigo */}
              <circle cx="10.5" cy="21.5" r="2.8" fill="#4f46e5"/>
              <circle cx="13.5" cy="19.5" r="2"   fill="#6366f1" opacity="0.85"/>
              <circle cx="9"    cy="18.5" r="1.6" fill="#818cf8" opacity="0.7"/>
              {/* Cluster violet */}
              <circle cx="17.5" cy="10"   r="2.8" fill="#7c3aed"/>
              <circle cx="20.5" cy="12.5" r="2"   fill="#8b5cf6" opacity="0.85"/>
              <circle cx="15"   cy="13"   r="1.6" fill="#a78bfa" opacity="0.7"/>
              {/* Cluster teal */}
              <circle cx="23.5" cy="20"   r="2.8" fill="#0d9488"/>
              <circle cx="22"   cy="16.5" r="2"   fill="#14b8a6" opacity="0.85"/>
              <circle cx="25.5" cy="17"   r="1.6" fill="#2dd4bf" opacity="0.7"/>
              {/* Outliers */}
              <circle cx="15"   cy="22.5" r="1.1" fill="#475569" opacity="0.55"/>
              <circle cx="19.5" cy="21"   r="1"   fill="#475569" opacity="0.45"/>
              <circle cx="11"   cy="15"   r="0.9" fill="#334155" opacity="0.5"/>
            </svg>
          </div>
          <div>
            <h1 className="text-white font-bold text-sm leading-tight">Dataset Explorer</h1>
            <p className="text-gray-500 text-xs mt-0.5">{t('Dataset Intelligence')}</p>
          </div>
        </div>
        {/* Tutoriel interactif : halo orange tant qu'il n'a jamais ete lance
            par cet utilisateur (etat porte par VisionNexus). */}
        <div className="mt-3">
          <TourLaunchButton onClick={onStartTour} glow={tourGlow} label={t('Tutoriel')} />
        </div>
      </div>

      <nav className="flex-1 p-3 space-y-1">
        {NAV_ITEMS.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.exact}
            data-tour={item.tour}
            className={({ isActive }) =>
              `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                isActive
                  ? 'bg-indigo-600 text-white'
                  : 'text-gray-400 hover:text-white hover:bg-gray-800'
              }`
            }
          >
            {item.icon}
            {t(item.label)}
          </NavLink>
        ))}
      </nav>

      {selectedIds.size > 0 && (
        <div className="p-3 border-t border-gray-800">
          <div className="bg-indigo-900/30 border border-indigo-600/30 rounded-lg px-3 py-2">
            <p className="text-indigo-300 text-xs font-medium">
              {selectedIds.size} {t('image(s) sélectionnée(s)')}
            </p>
            <NavLink
              to="/subsets"
              className="text-indigo-400 text-xs underline mt-0.5 block"
            >
              {t('Créer subset')}
            </NavLink>
          </div>
        </div>
      )}

      <div className="p-3 border-t border-gray-800">
        <UserBadge />
      </div>
    </aside>
  )
}

// Corps de l'app : a l'interieur du routeur ET du TourProvider, pour pouvoir
// injecter la navigation dans le contexte du tour.
function AppShell() {
  const navigate = useNavigate()
  const { start: startTour } = useTour()
  const [tourState, setTourState] = useState<TutorialState | null>(null)
  useEffect(() => { void readTutorialState().then(setTourState) }, [])

  const handleStartTour = () => {
    setTourState((prev) => ({ completed: prev?.completed ?? false, launchedOnce: true }))
    void writeTutorialState({ launchedOnce: true })
    const ctx: DatasetTourContext = { navigate, samplePath: null, datasetName: null }
    startTour(buildDatasetTourSteps(), ctx, {
      onFinish: () => { void writeTutorialState({ completed: true }) },
    })
  }

  return (
    <>
      <div className="flex h-screen overflow-hidden bg-gray-950">
        <Sidebar onStartTour={handleStartTour} tourGlow={tourState ? !tourState.launchedOnce : false} />
        <main className="flex-1 overflow-y-auto scrollbar-thin">
          <Routes>
            <Route path="/" element={<Gallery />} />
            <Route path="/catalog" element={<Catalog />} />
            <Route path="/playground" element={<Dashboard />} />
            <Route path="/datasets/:id/map" element={<DatasetMap />} />
            <Route path="/datasets/:id/search" element={<SemanticSearch />} />
            <Route path="/datasets/:id/duplicates" element={<DuplicateExplorer />} />
            <Route path="/subsets" element={<SubsetManager />} />
            <Route path="/help" element={<HelpPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </main>
      </div>
      {/* Tour guide -- hors des routes pour survivre a la navigation */}
      <TourOverlay />
    </>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <ThemeProvider />
      <TourProvider>
        <AppShell />
      </TourProvider>
    </BrowserRouter>
  )
}
