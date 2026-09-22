// ============================================================
// App.tsx — Training_App
// ============================================================

import { Routes, Route, NavLink, Navigate } from 'react-router-dom'
import { Zap, BarChart2 } from 'lucide-react'
import TrainingPage from './pages/TrainingPage'
import RunsPage     from './pages/RunsPage'
import { LanguageToggle } from './components/common/LanguageToggle'
import { useT } from './i18n/useLang'

const NAV = [
  { to: '/training', label: 'Training',   icon: <Zap size={15} /> },
  { to: '/runs',     label: 'Historique', icon: <BarChart2 size={15} /> },
]

export default function App() {
  const t = useT()
  return (
    <div className="min-h-screen bg-[#0d1117] text-[#e6edf3]">
      {/* Top nav */}
      <nav className="sticky top-0 z-40 border-b border-gray-800 bg-[#0d1117]/90 backdrop-blur-sm">
        <div className="max-w-5xl mx-auto px-6 flex items-center h-12 gap-6">
          <span className="flex items-center gap-2 font-semibold text-sm text-white">
            <Zap size={16} className="text-blue-400" /> Training App
          </span>
          <div className="flex gap-1 ml-2">
            {NAV.map(({ to, label, icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  `flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                    isActive
                      ? 'bg-gray-800 text-white'
                      : 'text-gray-400 hover:text-white hover:bg-gray-800/50'
                  }`
                }
              >
                {icon}{t(label)}
              </NavLink>
            ))}
          </div>
          <LanguageToggle className="ml-auto" />
        </div>
      </nav>

      {/* Pages */}
      <Routes>
        <Route path="/" element={<Navigate to="/training" replace />} />
        <Route path="/training" element={<TrainingPage />} />
        <Route path="/runs"     element={<RunsPage />} />
      </Routes>
    </div>
  )
}
