// ============================================================
// App.tsx — Routing + sidebar avec indicateur repo + branche
// ============================================================

import { useState } from 'react'
import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Database, GitCompare, RefreshCw, GitBranch, CheckCircle, XCircle, Info, BookOpen, Workflow } from 'lucide-react'
import { UserBadge } from './components/UserBadge'

import DatasetsPage from './pages/DatasetsPage'
import HistoryPage  from './pages/HistoryPage'
import DiffPage     from './pages/DiffPage'
import SyncPage     from './pages/SyncPage'
import DocPage      from './pages/DocPage'
import LineagePage  from './pages/LineagePage'
import { datasetsAPI, repoAPI } from './api/client'

const NAV_ITEMS = [
  { to: '/',        icon: <Workflow   size={18} />, label: 'Lineage',     exact: true },
  { to: '/diff',    icon: <GitCompare size={18} />, label: 'Diff',        exact: true },
  { to: '/sync',    icon: <RefreshCw  size={18} />, label: 'Sync',        exact: true },
  { to: '/doc',     icon: <BookOpen   size={18} />, label: 'Doc',         exact: true },
]

function RepoBadge() {
  const { data } = useQuery({
    queryKey: ['branch'],
    queryFn:  datasetsAPI.branch,
    refetchInterval: 30_000,
    staleTime: 15_000,
  })

  if (!data) return null

  return (
    <div className="flex items-center gap-1.5 mt-2">
      <GitBranch size={12} className="text-gray-500" />
      <span className="text-xs text-gray-500 font-mono truncate">{data.branch}</span>
    </div>
  )
}

function RepoStatus() {
  const [open, setOpen] = useState(false)
  const { data } = useQuery({
    queryKey: ['repo-status'],
    queryFn:  repoAPI.status,
    refetchInterval: 20_000,
    staleTime: 15_000,
  })

  const ok = data?.repo_exists ?? false
  const remotes = data?.remotes ?? []
  return (
    <div className="mt-0.5">
      <button onClick={() => setOpen(v => !v)} className="flex items-center gap-1.5 w-full text-left">
        {ok
          ? <CheckCircle size={13} className="text-emerald-400" />
          : <XCircle     size={13} className="text-red-500" />
        }
        <span className="text-xs text-gray-500">{ok ? 'Repo OK' : 'Repo introuvable'}</span>
        <Info size={11} className="text-gray-600 ml-auto" />
      </button>

      {open && (
        <div className="mt-2 bg-gray-950 border border-gray-800 rounded-lg p-2.5 space-y-1.5 text-[11px] leading-relaxed">
          <p className="text-gray-500">Repo git + DVC recherché ici :</p>
          <p className="font-mono text-gray-300 break-all">{data?.repo_path ?? '—'}</p>
          {!ok ? (
            <p className="text-gray-500">
              Absent = ce dossier n'est pas encore un repo git+DVC. Il est créé et
              rempli automatiquement au 1er commit depuis le nœud DVC de l'Orchestrator,
              après un run. Ce n'est pas une erreur tant qu'aucun run n'a versionné d'artefact.
            </p>
          ) : (
            <div className="text-gray-500 space-y-0.5">
              <p>git {data?.git_initialized ? 'initialisé' : 'absent'} · dvc {data?.dvc_initialized ? 'initialisé' : 'absent'}</p>
              <p>Remote(s) : {remotes.length ? remotes.map(r => r.name).join(', ') : 'aucun (push/pull impossibles)'}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Sidebar() {
  return (
    <aside className="w-56 bg-gray-900 border-r border-gray-800 flex flex-col">
      <div className="px-4 py-5 border-b border-gray-800">
        <div className="flex items-center gap-2.5 mb-1">
          <div className="w-7 h-7 bg-indigo-600 rounded-lg flex items-center justify-center flex-shrink-0">
            <Database size={14} className="text-white" />
          </div>
          <div>
            <h1 className="text-white font-bold text-sm leading-tight">DVC App</h1>
            <p className="text-gray-500 text-xs mt-0.5">Dataset Versioning</p>
          </div>
        </div>
        <RepoStatus />
        <RepoBadge />
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
            <Route path="/"        element={<LineagePage />} />
            <Route path="/lineage" element={<LineagePage />} />
            <Route path="/datasets" element={<DatasetsPage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/diff"    element={<DiffPage />} />
            <Route path="/sync"    element={<SyncPage />} />
            <Route path="/doc"     element={<DocPage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}
