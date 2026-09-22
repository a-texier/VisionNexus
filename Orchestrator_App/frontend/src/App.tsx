// ============================================================
// App.tsx — layout principal avec sidebar
// ============================================================

import { BrowserRouter, Routes, Route, NavLink, Navigate } from 'react-router-dom'
import { Network, Settings, Workflow, FlaskConical, Info, Rocket, LayoutDashboard } from 'lucide-react'
import { UserBadge } from './components/UserBadge'
import { LanguageToggle } from './components/common/LanguageToggle'
import { useT } from './i18n/useLang'
import SandgraphPage   from './pages/SandgraphPage'
import DashboardPage   from './pages/DashboardPage'
import PipelinePage    from './pages/PipelinePage'
import LibraryPage     from './pages/LibraryPage'
import ActivityPage    from './pages/ActivityPage'
import ExperimentsPage from './pages/ExperimentsPage'
import InsightsPage    from './pages/InsightsPage'
import PlansPage       from './pages/PlansPage'
import LineageGraphPage from './pages/LineageGraphPage'
import GuidePage       from './pages/GuidePage'
import MLOpsPage       from './pages/MLOpsPage'
import AppsPage        from './pages/AppsPage'
import AboutPage       from './pages/AboutPage'

const NAV = [
  { to: '/',            label: 'Sandgraph',    icon: Network,          end: true },
  { to: '/experiments', label: 'Expériences',  icon: FlaskConical,     end: false },
  { to: '/mlops',       label: 'MLOps',        icon: LayoutDashboard,  end: false },
  { to: '/about',       label: 'À propos',     icon: Info,             end: false },
  { to: '/settings',    label: 'Paramètres',   icon: Settings,         end: false },
  { to: '/apps',        label: 'Applications', icon: Rocket,           end: false },
]

function SettingsPlaceholder() {
  const t = useT()
  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold text-white mb-2">{t('Paramètres')}</h1>
      <p className="text-sm text-gray-500">{t("Configuration de l'espace de travail.")}</p>
    </div>
  )
}

export default function App() {
  const t = useT()
  return (
    <BrowserRouter>
      <div className="flex h-screen overflow-hidden bg-gray-950">
        {/* Sidebar */}
        <aside className="w-52 flex-shrink-0 bg-gray-900 border-r border-gray-800 flex flex-col">
          {/* Logo */}
          <div className="px-4 py-4 flex items-center gap-2.5 border-b border-gray-800">
            <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center flex-shrink-0">
              <Workflow size={14} className="text-white" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white leading-tight">Orchestrator</p>
              <p className="text-[10px] text-gray-500 leading-tight">{t('IA Pipeline Hub')}</p>
            </div>
          </div>

          {/* Nav */}
          <nav className="flex-1 px-2 py-3 space-y-0.5">
            {NAV.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                    isActive
                      ? 'bg-indigo-600 text-white'
                      : 'text-gray-400 hover:text-white hover:bg-gray-800'
                  }`
                }
              >
                <Icon size={15} />
                {t(label)}
              </NavLink>
            ))}
          </nav>

          {/* Footer */}
          <div className="px-3 py-3 border-t border-gray-800 flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <UserBadge />
            </div>
            <LanguageToggle />
          </div>
        </aside>

        {/* Main — Sandgraph needs full height (no overflow-y-auto) */}
        <main className="flex-1 overflow-hidden">
          <Routes>
            <Route path="/"                element={<SandgraphPage />} />
            <Route path="/dashboard"       element={<DashboardPage />} />
            <Route path="/apps"            element={<AppsPage />} />
            <Route path="/library"         element={<LibraryPage />} />
            <Route path="/pipeline/:id"    element={<PipelinePage />} />
            <Route path="/experiments"     element={<ExperimentsPage />} />

            {/* Groupe MLOps : monitoring + tracabilite (sous-onglets) */}
            <Route path="/mlops"           element={<MLOpsPage />}>
              <Route index                 element={<Navigate to="insights" replace />} />
              <Route path="insights"       element={<InsightsPage />} />
              <Route path="plans"          element={<PlansPage />} />
              <Route path="activity"       element={<ActivityPage />} />
              <Route path="lineage"        element={<LineageGraphPage />} />
              <Route path="guide"          element={<GuidePage />} />
            </Route>
            {/* Redirections des anciennes routes (liens/marque-pages existants) */}
            <Route path="/insights"        element={<Navigate to="/mlops/insights" replace />} />
            <Route path="/activity"        element={<Navigate to="/mlops/activity" replace />} />
            <Route path="/lineage"         element={<Navigate to="/mlops/lineage" replace />} />
            <Route path="/guide"           element={<Navigate to="/mlops/guide" replace />} />

            <Route path="/about"           element={<AboutPage />} />
            <Route path="/settings"        element={<SettingsPlaceholder />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}
