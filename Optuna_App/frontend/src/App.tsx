// ============================================================
// App.tsx — sidebar layout + routes
// ============================================================

import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { LayoutList, Rocket, Settings, BookOpen, LifeBuoy } from 'lucide-react'
import { UserBadge } from './components/UserBadge'
import StudiesPage     from './pages/StudiesPage'
import StudyDetailPage from './pages/StudyDetailPage'
import LaunchPage      from './pages/LaunchPage'
import GuidePage       from './pages/GuidePage'
import HPOLearnPage    from './pages/HPOLearnPage'
import { studiesAPI, settingsAPI } from './api/client'
import { initWorkspaceLanguage } from './i18n/translate'

function RunningBadge() {
  const { data } = useQuery({
    queryKey: ['studies-running-count'],
    queryFn:  async () => {
      const studies = await studiesAPI.list()
      // Fetch statuses in parallel to count running ones
      const statuses = await Promise.allSettled(
        studies.map(s => studiesAPI.status(s.study_name))
      )
      return statuses.filter(
        r => r.status === 'fulfilled' && r.value.status === 'running'
      ).length
    },
    refetchInterval: 5_000,
    staleTime: 3_000,
  })

  if (!data || data === 0) return null
  return (
    <span className="ml-auto flex-shrink-0 min-w-[18px] h-[18px] px-1 rounded-full bg-indigo-600 text-white text-[10px] font-semibold flex items-center justify-center">
      {data}
    </span>
  )
}

function SettingsPlaceholder() {
  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold text-white mb-2">Paramètres</h1>
      <p className="text-sm text-gray-500">Configuration de l'espace de travail.</p>
    </div>
  )
}

const NAV = [
  { to: '/',         label: 'Études',         icon: LayoutList },
  { to: '/learn/hpo', label: 'Comprendre HPO', icon: BookOpen   },
  { to: '/guide',    label: 'Documentation',   icon: LifeBuoy   },
  { to: '/settings', label: 'Paramètres',      icon: Settings   },
]

export default function App() {
  useEffect(() => {
    void initWorkspaceLanguage(() => settingsAPI.get().then((s) => (s as any).ui_language))
  }, [])

  return (
    <BrowserRouter>
      <div className="flex h-screen overflow-hidden bg-gray-950">
        {/* Sidebar */}
        <aside className="w-52 flex-shrink-0 bg-gray-900 border-r border-gray-800 flex flex-col">
          {/* Logo */}
          <div className="px-4 py-4 flex items-center gap-2.5 border-b border-gray-800">
            <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center flex-shrink-0">
              <Rocket size={14} className="text-white" />
            </div>
            <span className="text-sm font-semibold text-white leading-tight">Optuna App</span>
          </div>

          {/* Nav */}
          <nav className="flex-1 px-2 py-3 space-y-0.5">
            {NAV.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                className={({ isActive }) =>
                  `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                    isActive
                      ? 'bg-indigo-600 text-white'
                      : 'text-gray-400 hover:text-white hover:bg-gray-800'
                  }`
                }
              >
                <Icon size={15} />
                <span className="flex-1">{label}</span>
                {to === '/' && <RunningBadge />}
              </NavLink>
            ))}
          </nav>

          {/* Footer */}
          <div className="px-3 py-3 border-t border-gray-800">
            <UserBadge />
          </div>
        </aside>

        {/* Main */}
        <main className="flex-1 overflow-y-auto scrollbar-thin">
          <Routes>
            <Route path="/"                              element={<StudiesPage />} />
            <Route path="/studies/:studyName"            element={<StudyDetailPage />} />
            <Route path="/studies/:studyName/launch"     element={<LaunchPage />} />
            <Route path="/settings"                      element={<SettingsPlaceholder />} />
            <Route path="/guide"                         element={<GuidePage />} />
            <Route path="/learn/hpo"                     element={<HPOLearnPage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}
