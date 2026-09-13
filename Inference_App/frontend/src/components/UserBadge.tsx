import { useState, useRef } from 'react'
import { Users, FolderOpen, History } from 'lucide-react'

interface WorkspaceUser { user: string; workspace: string }
interface WorkspaceHistory { path: string; user: string }

const IA_USER = (import.meta as { env?: Record<string, string> }).env?.VITE_IA_USER || 'anonymous'

function initials(name: string) { return name.slice(0, 2).toUpperCase() }

type PanelMode = 'users' | 'history' | null

export function UserBadge() {
  const [panel, setPanel]     = useState<PanelMode>(null)
  const [users, setUsers]     = useState<WorkspaceUser[]>([])
  const [history, setHistory] = useState<WorkspaceHistory[]>([])
  const [loading, setLoading] = useState(false)
  const [pos, setPos]         = useState({ top: 0, left: 0 })
  const [opening, setOpening] = useState<string | null>(null)
  const usersRef   = useRef<HTMLButtonElement>(null)
  const historyRef = useRef<HTMLButtonElement>(null)

  function calcPos(ref: React.RefObject<HTMLButtonElement | null>) {
    if (!ref.current) return
    const r = ref.current.getBoundingClientRect()
    setPos({ top: r.bottom + 8, left: Math.min(r.left, window.innerWidth - 280) })
  }

  const openUsers = async () => {
    if (panel === 'users') { setPanel(null); return }
    calcPos(usersRef); setPanel('users'); setLoading(true)
    try { setUsers(await (await fetch('/api/workspace/users')).json()) }
    catch { setUsers([]) } finally { setLoading(false) }
  }
  const openHistory = async () => {
    if (panel === 'history') { setPanel(null); return }
    calcPos(historyRef); setPanel('history'); setLoading(true)
    try { setHistory(await (await fetch('/api/workspace/history')).json()) }
    catch { setHistory([]) } finally { setLoading(false) }
  }
  const openFolder = async (path?: string) => {
    setOpening(path ?? '__ws__')
    try {
      const q = path ? `?path=${encodeURIComponent(path)}` : ''
      await fetch(`/api/workspace/open${q}`, { method: 'POST' })
    } catch { /* ignore */ }
    finally { setTimeout(() => setOpening(null), 1200) }
  }

  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <div className="w-6 h-6 rounded-full bg-cyan-600 flex items-center justify-center flex-shrink-0">
        <span className="text-[10px] font-bold text-white select-none">{initials(IA_USER)}</span>
      </div>
      <span className="text-xs text-gray-300 truncate max-w-[120px]" title={IA_USER}>{IA_USER}</span>

      <button onClick={() => openFolder()} title="Ouvrir le workspace" disabled={opening === '__ws__'}
        className="p-1 rounded hover:bg-gray-700 transition-colors flex-shrink-0">
        <FolderOpen size={13} className={opening === '__ws__' ? 'text-cyan-400' : 'text-gray-500 hover:text-white'} />
      </button>
      <button ref={historyRef} onClick={openHistory} title="Historique des workspaces"
        className="p-1 rounded hover:bg-gray-700 transition-colors flex-shrink-0">
        <History size={13} className={panel === 'history' ? 'text-cyan-400' : 'text-gray-500 hover:text-white'} />
      </button>
      <button ref={usersRef} onClick={openUsers} title="Utilisateurs connectes"
        className="p-1 rounded hover:bg-gray-700 transition-colors flex-shrink-0">
        <Users size={13} className={panel === 'users' ? 'text-cyan-400' : 'text-gray-500 hover:text-white'} />
      </button>

      {panel && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setPanel(null)} />
          <div className="fixed z-50 bg-gray-800 border border-gray-700 rounded-xl shadow-2xl p-3"
            style={{ top: pos.top, left: pos.left, width: 272 }}>
            <div className="flex items-center justify-between mb-2.5">
              <span className="text-xs font-semibold text-gray-200">
                {panel === 'users' ? 'Utilisateurs connectes' : 'Workspaces recents'}
              </span>
              <button onClick={() => setPanel(null)} className="text-gray-500 hover:text-white text-xs leading-none">✕</button>
            </div>
            {loading ? <p className="text-xs text-gray-500 py-1">Chargement…</p>
              : panel === 'users' ? (
                users.length === 0 ? <p className="text-xs text-gray-500 py-1">Aucun utilisateur.</p> : (
                  <div className="space-y-1.5 max-h-72 overflow-y-auto">
                    {users.map(u => (
                      <div key={u.workspace} className={`rounded-lg px-2.5 py-2 ${u.user === IA_USER
                        ? 'bg-cyan-900/40 border border-cyan-600/30' : 'bg-gray-900/60 border border-gray-700/40'}`}>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs text-gray-200 font-medium truncate">
                            {u.user}{u.user === IA_USER && <span className="ml-1 text-cyan-400 text-[10px]">(vous)</span>}
                          </span>
                          <button title="Ouvrir" onClick={() => openFolder(u.workspace)} className="p-0.5 rounded hover:bg-gray-600">
                            <FolderOpen size={11} className="text-gray-500 hover:text-white" />
                          </button>
                        </div>
                        <p className="text-[10px] text-gray-500 font-mono truncate mt-0.5" title={u.workspace}>{u.workspace}</p>
                      </div>
                    ))}
                  </div>
                )
              ) : (
                history.length === 0 ? <p className="text-xs text-gray-500 py-1">Aucun workspace recent.</p> : (
                  <div className="space-y-1 overflow-y-auto" style={{ maxHeight: '50vh' }}>
                    {history.map((e, i) => (
                      <button key={i} onClick={() => openFolder(e.path)} disabled={opening === e.path}
                        title={`[${e.user}] ${e.path}`}
                        className={`w-full text-left rounded-lg px-2.5 py-1.5 border transition-colors ${opening === e.path
                          ? 'bg-cyan-900/30 border-cyan-600/30'
                          : 'bg-gray-900/60 border-gray-700/40 hover:bg-gray-700/60'}`}>
                        <span className="text-[11px] text-gray-300 font-mono truncate block" title={e.path}>{e.path}</span>
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
