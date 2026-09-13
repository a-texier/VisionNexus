// ============================================================
// components/modals/FileBrowserModal.tsx
// Navigateur de fichiers serveur — permet de choisir un dossier
// ou un fichier sans copier-coller le chemin.
// ============================================================

import React, { useCallback, useEffect, useState } from 'react'
import { ChevronRight, Folder, File, ArrowLeft, X, HardDrive, Check, Clock } from 'lucide-react'
import { filesAPI, type FileBrowserEntry } from '../../services/api'

interface FileBrowserModalProps {
  isOpen: boolean
  title: string
  filterType: 'all' | 'dirs' | 'images' | 'video'
  /** Si true, seule la sélection d'un dossier est autorisée */
  selectDir?: boolean
  onSelect: (path: string) => void
  onClose: () => void
}

function formatSize(size: number | null): string {
  if (size === null) return ''
  if (size < 1024) return `${size} o`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} Ko`
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} Mo`
  return `${(size / 1024 / 1024 / 1024).toFixed(2)} Go`
}

export const FileBrowserModal: React.FC<FileBrowserModalProps> = ({
  isOpen,
  title,
  filterType,
  selectDir = false,
  onSelect,
  onClose,
}) => {
  const [currentPath, setCurrentPath] = useState('')
  const [entries, setEntries] = useState<FileBrowserEntry[]>([])
  const [parent, setParent] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<FileBrowserEntry | null>(null)
  const [history, setHistory] = useState<string[]>([])

  const navigate = useCallback(async (path: string) => {
    setLoading(true)
    setError(null)
    setSelected(null)
    try {
      const result = await filesAPI.browse(path, filterType)
      setCurrentPath(result.path)
      setParent(result.parent)
      setEntries(result.entries)
    } catch {
      setError('Impossible de lire ce dossier.')
    } finally {
      setLoading(false)
    }
  }, [filterType])

  // À l'ouverture : reprendre au dernier dossier utilisé plutôt qu'à la racine.
  // Sur un serveur Linux, repartir de "/" à chaque import imposait de redescendre
  // toute la hiérarchie ; l'historique est propre à l'utilisateur (son workspace).
  useEffect(() => {
    if (!isOpen) return
    setSelected(null)
    let cancelled = false
    void (async () => {
      let recent: string[] = []
      try {
        recent = await filesAPI.getBrowseHistory()
      } catch { /* historique indisponible : on ouvre à la racine */ }
      if (cancelled) return
      setHistory(recent)
      await navigate(recent[0] ?? '')
    })()
    return () => { cancelled = true }
  }, [isOpen, navigate])

  if (!isOpen) return null

  const handleClick = (entry: FileBrowserEntry) => {
    if (entry.is_dir) {
      void navigate(entry.path)
    } else {
      setSelected(entry)
    }
  }

  // Mémorise le dossier retenu avant de remonter le choix au parent.
  const confirmPath = (path: string) => {
    void filesAPI.addBrowseHistory(path).catch(() => { /* non bloquant */ })
    onSelect(path)
  }

  const handleSelect = () => {
    if (selectDir) {
      // Sélectionner le dossier courant
      confirmPath(currentPath)
    } else if (selected) {
      confirmPath(selected.path)
    }
  }

  const canConfirm = selectDir ? currentPath !== '' : selected !== null

  // Breadcrumb depuis le chemin courant. Chaque segment est cliquable : on
  // reconstruit le chemin absolu jusqu'à lui pour remonter d'un coup.
  const isPosix = currentPath.startsWith('/')
  const pathParts = currentPath ? currentPath.replace(/\\/g, '/').split('/').filter(Boolean) : []
  const pathAt = (index: number) => {
    const joined = pathParts.slice(0, index + 1).join('/')
    return isPosix ? `/${joined}` : joined
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-slate-800 border border-slate-700 rounded-xl shadow-2xl flex flex-col"
           style={{ width: 580, maxHeight: '80vh' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700">
          <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-700 text-slate-400 hover:text-white transition-colors">
            <X size={14} />
          </button>
        </div>

        {/* Navigation bar */}
        <div className="flex items-center gap-1 px-3 py-2 border-b border-slate-700/50 bg-slate-900/30">
          <button
            onClick={() => void navigate('')}
            className="p-1 rounded hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
            title="Racine"
          >
            <HardDrive size={13} />
          </button>
          {parent !== null && (
            <button
              onClick={() => void navigate(parent)}
              className="p-1 rounded hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
              title="Dossier parent"
            >
              <ArrowLeft size={13} />
            </button>
          )}
          {/* Breadcrumb — chaque segment remonte directement à son niveau */}
          <div className="flex items-center gap-0.5 text-xs text-slate-400 overflow-x-auto flex-1 min-w-0">
            {pathParts.length === 0 ? (
              <span className="text-slate-500 italic">Racine</span>
            ) : (
              pathParts.map((part, i) => (
                <React.Fragment key={i}>
                  <ChevronRight size={10} className="text-slate-600 flex-shrink-0" />
                  <button
                    onClick={() => void navigate(pathAt(i))}
                    title={pathAt(i)}
                    className={`px-1 rounded whitespace-nowrap transition-colors ${
                      i === pathParts.length - 1
                        ? 'text-slate-200 font-medium'
                        : 'hover:bg-slate-700 hover:text-white'
                    }`}
                  >
                    {part}
                  </button>
                </React.Fragment>
              ))
            )}
          </div>
        </div>

        {/* Dossiers récents — raccourcis vers les emplacements déjà utilisés */}
        {history.length > 0 && (
          <div className="flex items-center gap-1 px-3 py-1.5 border-b border-slate-700/50 bg-slate-900/20 overflow-x-auto">
            <Clock size={11} className="text-slate-500 flex-shrink-0" />
            {history.map((h) => (
              <button
                key={h}
                onClick={() => void navigate(h)}
                title={h}
                className={`px-2 py-0.5 text-[11px] rounded whitespace-nowrap transition-colors ${
                  h === currentPath
                    ? 'bg-blue-900/40 text-blue-200'
                    : 'bg-slate-700/50 text-slate-300 hover:bg-slate-600 hover:text-white'
                }`}
              >
                {h.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || h}
              </button>
            ))}
          </div>
        )}

        {/* File list */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {loading && (
            <div className="flex items-center justify-center h-24 text-xs text-slate-500">
              Chargement...
            </div>
          )}
          {error && !loading && (
            <div className="flex items-center justify-center h-24 text-xs text-red-400">{error}</div>
          )}
          {!loading && !error && entries.length === 0 && (
            <div className="flex items-center justify-center h-24 text-xs text-slate-500 italic">
              Dossier vide
            </div>
          )}
          {!loading && !error && entries.map((entry) => {
            const isSelected = selected?.path === entry.path
            return (
              <button
                key={entry.path}
                onClick={() => handleClick(entry)}
                onDoubleClick={() => { if (!entry.is_dir) { confirmPath(entry.path) } }}
                className={`w-full flex items-center gap-2.5 px-4 py-2 text-left transition-colors hover:bg-slate-700/50 ${
                  isSelected ? 'bg-blue-900/30 border-l-2 border-blue-500' : 'border-l-2 border-transparent'
                }`}
              >
                {entry.is_dir
                  ? <Folder size={14} className="text-yellow-400 flex-shrink-0" />
                  : <File size={14} className="text-slate-400 flex-shrink-0" />
                }
                <span className={`text-xs flex-1 truncate ${entry.is_dir ? 'text-slate-200' : 'text-slate-300'}`}>
                  {entry.name}
                </span>
                {entry.size !== null && (
                  <span className="text-xs text-slate-600 flex-shrink-0">{formatSize(entry.size)}</span>
                )}
                {isSelected && <Check size={12} className="text-blue-400 flex-shrink-0" />}
              </button>
            )
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 px-4 py-3 border-t border-slate-700 bg-slate-900/20">
          {/* Current selection display */}
          <div className="flex-1 min-w-0">
            {selectDir && currentPath && (
              <p className="text-xs text-slate-400 truncate">
                <span className="text-slate-600">Dossier : </span>{currentPath}
              </p>
            )}
            {!selectDir && selected && (
              <p className="text-xs text-slate-400 truncate">
                <span className="text-slate-600">Fichier : </span>{selected.name}
              </p>
            )}
            {!selectDir && !selected && !selectDir && (
              <p className="text-xs text-slate-600 italic">Double-clic sur un fichier pour sélectionner</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs text-slate-300 bg-slate-700 hover:bg-slate-600 rounded transition-colors"
          >
            Annuler
          </button>
          <button
            onClick={handleSelect}
            disabled={!canConfirm}
            className="px-3 py-1.5 text-xs text-white bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-500 rounded transition-colors flex items-center gap-1.5"
          >
            <Check size={11} />
            {selectDir ? 'Choisir ce dossier' : 'Sélectionner'}
          </button>
        </div>
      </div>
    </div>
  )
}
