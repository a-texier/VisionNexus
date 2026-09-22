// ============================================================
// App.tsx
// Routing + sidebar avec indicateur de statut MLflow.
// ============================================================

import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { FlaskConical, GitBranch, BarChart2, BookOpen, Workflow } from 'lucide-react'
import { UserBadge } from './components/UserBadge'

import ExperimentsPage  from './pages/ExperimentsPage'
import RunDetailPage    from './pages/RunDetailPage'
import ModelRegistryPage from './pages/ModelRegistryPage'
import CompareRunsPage  from './pages/CompareRunsPage'
import DocPage          from './pages/DocPage'
import LineagePage      from './pages/LineagePage'
import { mlflowAPI } from './api/client'

const NAV_ITEMS = [
  { to: '/',        icon: <Workflow size={18} />,     label: 'Lineage',        exact: true },
  { to: '/models',  icon: <GitBranch size={18} />,    label: 'Model Registry', exact: true },
  { to: '/compare', icon: <BarChart2 size={18} />,    label: 'Comparer',       exact: true },
  { to: '/doc',     icon: <BookOpen size={18} />,     label: 'Doc',            exact: true },
]

function StatusDot() {
  const { data } = useQuery({
    queryKey: ['mlflow-status'],
    queryFn:  mlflowAPI.status,
    refetchInterval: 15_000,
    staleTime: 10_000,
  })
  const running = data?.running ?? false
  return (
    <div className="flex items-center gap-1.5">
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${running ? 'bg-emerald-400' : 'bg-red-500'}`} />
      <span className="text-xs text-gray-500">
        {running ? `MLflow ${data?.version ?? ''}` : 'MLflow off'}
      </span>
    </div>
  )
}

function Sidebar() {
  return (
    <aside className="w-56 bg-gray-900 border-r border-gray-800 flex flex-col">
      <div className="px-4 py-5 border-b border-gray-800">
        <div className="flex items-center gap-2.5 mb-2">
          <div className="w-7 h-7 bg-indigo-600 rounded-lg flex items-center justify-center flex-shrink-0">
            <FlaskConical size={14} className="text-white" />
          </div>
          <div>
            <h1 className="text-white font-bold text-sm leading-tight">MLflow App</h1>
            <p className="text-gray-500 text-xs mt-0.5">Experiment Tracking</p>
          </div>
        </div>
        <StatusDot />
      </div>

      <nav className="flex-1 p-3 space-y-1">
        {NAV_ITEMS.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.exact}
            className={({ isActive }) =>
              `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                isActive
                  ? 'bg-indigo-600 text-white'
                  : 'text-gray-400 hover:text-white hover:bg-gray-800'
              }`
            }
          >
            {item.icon}
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="p-3 border-t border-gray-800">
        <UserBadge />
      </div>
    </aside>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <div className="flex h-screen overflow-hidden bg-gray-950">
        <Sidebar />
        <main className="flex-1 overflow-y-auto scrollbar-thin">
          <Routes>
            <Route path="/"           element={<LineagePage />} />
            <Route path="/lineage"    element={<LineagePage />} />
            <Route path="/experiments" element={<ExperimentsPage />} />
            <Route path="/runs/:runId" element={<RunDetailPage />} />
            <Route path="/models"     element={<ModelRegistryPage />} />
            <Route path="/compare"    element={<CompareRunsPage />} />
            <Route path="/doc"        element={<DocPage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}
