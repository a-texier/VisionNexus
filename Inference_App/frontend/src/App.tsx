import { useState } from 'react'
import { Crosshair, BookOpen, MonitorPlay, Settings, Gauge, Radio } from 'lucide-react'
import TrackerPage from './pages/TrackerPage'
import EvaluationPage from './pages/EvaluationPage'
import AcquisitionPage from './pages/AcquisitionPage'
import DocsPage from './pages/DocsPage'
import SettingsModal from './components/SettingsModal'
import { UserBadge } from './components/UserBadge'

type Tab = 'tracker' | 'eval' | 'acq' | 'docs'

export default function App() {
  const [tab, setTab] = useState<Tab>('tracker')
  const [settingsOpen, setSettingsOpen] = useState(false)

  return (
    <div className="min-h-screen flex flex-col bg-[#0d1117] text-[#e6edf3]">
      <header className="flex items-center gap-3 px-5 py-2.5 border-b border-[#30363d] bg-[#0d1117]/90 sticky top-0 z-20">
        <Crosshair size={18} className="text-cyan-400" />
        <h1 className="text-sm font-semibold">
          Inference App <span className="text-gray-500 font-normal">— tracker générique MOT/SOT</span>
        </h1>

        <nav className="ml-4 flex items-center gap-1">
          <TabBtn active={tab === 'tracker'} onClick={() => setTab('tracker')} icon={<MonitorPlay size={13} />} label="Tracker" />
          <TabBtn active={tab === 'eval'} onClick={() => setTab('eval')} icon={<Gauge size={13} />} label="Évaluation" />
          <TabBtn active={tab === 'acq'} onClick={() => setTab('acq')} icon={<Radio size={13} />} label="Acquisition" />
          <TabBtn active={tab === 'docs'} onClick={() => setTab('docs')} icon={<BookOpen size={13} />} label="Documentation" />
        </nav>

        <button onClick={() => setSettingsOpen(true)} title="Réglages"
          className="ml-auto p-1.5 rounded hover:bg-[#21262d] text-gray-400 hover:text-white">
          <Settings size={15} />
        </button>
      </header>

      <main className="flex-1">
        {tab === 'tracker' ? <TrackerPage />
          : tab === 'eval' ? <EvaluationPage />
          : tab === 'acq' ? <AcquisitionPage />
          : <DocsPage />}
      </main>

      <footer className="border-t border-[#30363d] px-4 py-1.5 bg-[#0d1117]">
        <UserBadge />
      </footer>

      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}

function TabBtn({ active, onClick, icon, label }:
  { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button onClick={onClick}
      className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs transition-colors ${active
        ? 'bg-cyan-900/30 text-cyan-300 border border-cyan-800/40'
        : 'text-gray-400 hover:text-white hover:bg-[#21262d] border border-transparent'}`}>
      {icon}{label}
    </button>
  )
}
