// ============================================================
// MLOpsPage.tsx — onglet parent "MLOps" : monitoring + tracabilite.
// Regroupe Insights, Activite, Lineage et Guide en sous-onglets
// (routing imbrique : /mlops/insights, /mlops/activity, ...).
// ============================================================

import { NavLink, Outlet } from 'react-router-dom'
import { BarChart3, Clock, GitFork, BookOpen, ListChecks } from 'lucide-react'
import { useT } from '../i18n/useLang'

const SUB_TABS = [
  { to: '/mlops/insights', label: 'Insights', icon: BarChart3 },
  { to: '/mlops/plans',    label: 'Plans',    icon: ListChecks },
  { to: '/mlops/activity', label: 'Activité', icon: Clock },
  { to: '/mlops/lineage',  label: 'Lineage',  icon: GitFork },
  { to: '/mlops/guide',    label: 'Guide',    icon: BookOpen },
]

export default function MLOpsPage() {
  const t = useT()
  return (
    <div className="flex flex-col h-full">
      {/* Barre de sous-onglets */}
      <div className="shrink-0 border-b border-gray-800 bg-gray-900/60 px-4">
        <nav className="flex items-center gap-1">
          {SUB_TABS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-2 px-3 py-2.5 text-sm border-b-2 -mb-px transition-colors ${
                  isActive
                    ? 'border-indigo-500 text-white'
                    : 'border-transparent text-gray-400 hover:text-white'
                }`
              }
            >
              <Icon size={15} />
              {t(label)}
            </NavLink>
          ))}
        </nav>
      </div>

      {/* Contenu du sous-onglet actif */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <Outlet />
      </div>
    </div>
  )
}
