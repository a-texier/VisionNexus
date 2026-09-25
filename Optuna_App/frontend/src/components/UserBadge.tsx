import { useState, useRef } from 'react'
import { Users, FolderOpen, History } from 'lucide-react'
import { LanguageToggle } from './common/LanguageToggle'
import { useT } from '../i18n/useLang'

interface WorkspaceUser {
  user: string
  workspace: string
}

interface WorkspaceHistory {
  path: string
  user: string
}

const IA_USER = import.meta.env.VITE_IA_USER || 'anonymous'

function initials(name: string) {
  return name.slice(0, 2).toUpperCase()
}

type PanelMode = 'users' | 'history' | null

export function UserBadge() {
  const t = useT()
  const [panel, setPanel]       = useState<PanelMode>(null)
  const [users, setUsers]       = useState<WorkspaceUser[]>([])
  const [history, setHistory]   = useState<WorkspaceHistory[]>([])
  const [loading, setLoading]   = useState(false)
  const [pos, setPos]           = useState({ bottom: 0, left: 0 })
  const [openingFolder, setOpeningFolder] = useState(false)
  const [openingPath, setOpeningPath]     = useState<string | null>(null)
  const usersRef   = useRef<HTMLButtonElement>(null)
  const historyRef = useRef<HTMLButtonElement>(null)

  function calcPos(ref: React.RefObject<HTMLButtonElement>) {
    if (!ref.current) return
    const r = ref.current.getBoundingClientRect()
    setPos({
      bottom: window.innerHeight - r.top + 8,
      left:   Math.min(r.left, window.innerWidth - 272 - 8),
    })
  }

  const openUsers = async () => {
    if (panel === 'users') { setPanel(null); return }
    calcPos(usersRef)
    setPanel('users')
    setLoading(true)
    try {
      const res = await fetch('/api/workspace/users')
      setUsers(await res.json())
    } catch { setUsers([]) }
    finally { setLoading(false) }
  }

  const openHistory = async () => {
    if (panel === 'history') { setPanel(null); return }
    calcPos(historyRef)
    setPanel('history')
    setLoading(true)
    try {
      const res = await fetch('/api/workspace/history')
      setHistory(await res.json())
    } catch { setHistory([]) }
    finally { setLoading(false) }
  }

  const openFolder = async () => {
    setOpeningFolder(true)
    try { await fetch('/api/workspace/open', { method: 'POST' }) }
    catch { /* ignore */ }
    finally { setTimeout(() => setOpeningFolder(false), 1500) }
  }

  const openHistoryPath = async (path: string) => {
    setOpeningPath(path)
    try {
      await fetch(`/api/workspace/open?path=${encodeURIComponent(path)}`, { method: 'POST' })
    } catch { /* ignore */ }
    finally { setTimeout(() => setOpeningPath(null), 1500) }
  }

  return (
    <div className="flex items-center gap-1.5 min-w-0">
      {/* Avatar */}
      <div className="w-6 h-6 rounded-full bg-indigo-600 flex items-center justify-center flex-shrink-0">
        <span className="text-[10px] font-bold text-white select-none">{initials(IA_USER)}</span>
      </div>

      {/* Username */}
      <span className="text-xs text-gray-300 truncate flex-1 min-w-0" title={IA_USER}>
        {IA_USER}
      </span>

      {/* Open Folder button */}
      <button
        onClick={openFolder}
        title={t('Ouvrir workspace')}
        disabled={openingFolder}
        className="p-1 rounded hover:bg-gray-700 transition-colors flex-shrink-0"
      >
        <FolderOpen size={13} className={openingFolder ? 'text-indigo-400' : 'text-gray-500 hover:text-white'} />
      </button>

      {/* History button */}
      <button
        ref={historyRef}
        onClick={openHistory}
        title={t('Historique des workspaces')}
        className="p-1 rounded hover:bg-gray-700 transition-colors flex-shrink-0"
      >
        <History size={13} className={panel === 'history' ? 'text-indigo-400' : 'text-gray-500 hover:text-white'} />
      </button>

      {/* Users button */}
      <button
        ref={usersRef}
        onClick={openUsers}
        title={t('Utilisateurs connectes')}
        className="p-1 rounded hover:bg-gray-700 transition-colors flex-shrink-0"
      >
        <Users size={13} className={panel === 'users' ? 'text-indigo-400' : 'text-gray-500 hover:text-white'} />
      </button>

      {/* Language toggle */}
      <LanguageToggle />

      {/* Panel — fixed, opens upward */}
      {panel && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setPanel(null)} />
          <div
            className="fixed z-50 bg-gray-800 border border-gray-700 rounded-xl shadow-2xl p-3"
            style={{ bottom: pos.bottom, left: pos.left, width: 272 }}
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-2.5">
              <div className="flex items-center gap-1.5">
                {panel === 'users'   && <Users   size={12} className="text-gray-400" />}
                {panel === 'history' && <History size={12} className="text-gray-400" />}
                <span className="text-xs font-semibold text-gray-200">
                  {panel === 'users' ? t('Utilisateurs connectes') : t('Workspaces recents')}
                </span>
              </div>
              <button onClick={() => setPanel(null)} className="text-gray-500 hover:text-white text-xs leading-none">
                ✕
              </button>
            </div>

            {loading ? (
              <p className="text-xs text-gray-500 py-1">{t('Chargement…')}</p>

            ) : panel === 'users' ? (
              users.length === 0 ? (
                <p className="text-xs text-gray-500 py-1">{t('Aucun utilisateur trouve.')}</p>
              ) : (
                <div className="space-y-1.5 max-h-72 overflow-y-auto">
                  {users.map(u => (
                    <div
                      key={u.workspace}
                      className={`rounded-lg px-2.5 py-2 ${
                        u.user === IA_USER
                          ? 'bg-indigo-900/40 border border-indigo-600/30'
                          : 'bg-gray-900/60 border border-gray-700/40'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="w-5 h-5 rounded-full bg-indigo-700/70 flex items-center justify-center flex-shrink-0">
                            <span className="text-[9px] font-bold text-white">{initials(u.user)}</span>
                          </div>
                          <span className="text-xs text-gray-200 font-medium truncate">
                            {u.user}
                            {u.user === IA_USER && <span className="ml-1 text-indigo-400 text-[10px]">{t('(vous)')}</span>}
                          </span>
                        </div>
                        <button
                          title={t('Ouvrir ce workspace')}
                          onClick={async (e) => {
                            e.stopPropagation()
                            await fetch(`/api/workspace/open?path=${encodeURIComponent(u.workspace)}`, { method: 'POST' })
                          }}
                          className="p-0.5 rounded hover:bg-gray-600 flex-shrink-0"
                        >
                          <FolderOpen size={11} className="text-gray-500 hover:text-white" />
                        </button>
                      </div>
                      <p className="text-[10px] text-gray-500 font-mono truncate mt-0.5 ml-7" title={u.workspace}>
                        {u.workspace}
                      </p>
                    </div>
                  ))}
                </div>
              )

            ) : (
              history.length === 0 ? (
                <p className="text-xs text-gray-500 py-1">{t('Aucun workspace utilise recemment.')}</p>
              ) : (
                <div className="space-y-1 overflow-y-auto" style={{ maxHeight: '50vh' }}>
                  {history.map((entry, i) => (
                    <button
                      key={i}
                      onClick={() => openHistoryPath(entry.path)}
                      disabled={openingPath === entry.path}
                      title={`[${entry.user}] ${entry.path}`}
                      className={`w-full text-left rounded-lg px-2.5 py-1.5 border transition-colors ${
                        openingPath === entry.path
                          ? 'bg-indigo-900/30 border-indigo-600/30'
                          : 'bg-gray-900/60 border-gray-700/40 hover:bg-gray-700/60 hover:border-gray-600/60'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        <div className="w-4 h-4 rounded-full bg-indigo-900/70 border border-indigo-700/50 flex items-center justify-center flex-shrink-0">
                          <span className="text-[8px] font-bold text-indigo-300 leading-none">{initials(entry.user)}</span>
                        </div>
                        <span className="text-[11px] text-gray-300 font-mono truncate" title={entry.path}>{entry.path}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )
            )}
          </div>
        </>
      )}
    </div>
  )
}
