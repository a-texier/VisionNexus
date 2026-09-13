// ============================================================
// components/modals/HelpModal.tsx
// Popup d'aide (comme SettingsModal) : raccourcis, modes, fonctions,
// modèles, workflow. Contenu partagé avec HelpPanel (help/helpContent.ts).
// ============================================================

import React, { useState } from 'react'
import { X, Keyboard, Info, Cpu, Video } from 'lucide-react'
import {
  SHORTCUT_GROUPS, TOOL_MODES, TRACKING_MODES, FEATURES, MODELS, VIDEO_STEPS,
} from '../help/helpContent'

interface HelpModalProps {
  isOpen: boolean
  onClose: () => void
  onStartTour?: () => void
}

type Tab = 'shortcuts' | 'modes' | 'models' | 'workflow'

const TABS: { id: Tab; label: string; Icon: React.FC<{ size: number }> }[] = [
  { id: 'shortcuts', label: 'Raccourcis', Icon: Keyboard },
  { id: 'modes', label: 'Modes & Fonctions', Icon: Info },
  { id: 'models', label: 'Modèles', Icon: Cpu },
  { id: 'workflow', label: 'Workflow', Icon: Video },
]

export const HelpModal: React.FC<HelpModalProps> = ({ isOpen, onClose, onStartTour }) => {
  const [tab, setTab] = useState<Tab>('shortcuts')
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-slate-800 border border-slate-700 rounded-xl shadow-2xl w-[680px] max-h-[90vh] flex flex-col">
        {/* En-tête */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700">
          <h2 className="text-base font-semibold text-slate-100 flex items-center gap-2">
            <Keyboard size={16} className="text-blue-400" /> Aide — raccourcis & modes
          </h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-700 text-slate-400 hover:text-white">
            <X size={16} />
          </button>
        </div>

        {/* Onglets */}
        <div className="flex border-b border-slate-700 bg-slate-800/50 px-2">
          {TABS.map(({ id, label, Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex items-center gap-1.5 px-4 py-2 text-xs transition-colors ${
                tab === id ? 'text-blue-400 border-b-2 border-blue-400' : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              <Icon size={13} /> {label}
            </button>
          ))}
        </div>

        {/* Corps défilant */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {tab === 'shortcuts' && (
            <div className="grid grid-cols-2 gap-x-6 gap-y-4">
              {SHORTCUT_GROUPS.map(({ group, items }) => (
                <div key={group}>
                  <p className="text-[10px] uppercase tracking-wide text-slate-500 mb-1.5">{group}</p>
                  <div className="space-y-1">
                    {items.map(({ key, desc }, i) => (
                      <div key={`${key}-${i}`} className="flex items-center gap-2">
                        <kbd className="bg-slate-700 text-slate-200 text-xs px-1.5 py-0.5 rounded font-mono min-w-[66px] text-center flex-shrink-0">
                          {key}
                        </kbd>
                        <span className="text-xs text-slate-400">{desc}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === 'modes' && (
            <div className="space-y-5">
              <ModeGrid title="Modes d'annotation" items={TOOL_MODES} />
              <ModeGrid title="Modes de suivi (Tracks)" items={TRACKING_MODES} />
              <ModeGrid title="Fonctions" items={FEATURES} />
            </div>
          )}

          {tab === 'models' && (
            <div className="grid grid-cols-2 gap-2">
              {MODELS.map(({ name, desc, status }) => (
                <div key={name} className="p-2.5 bg-slate-800/60 rounded border border-slate-700/50">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-xs font-medium text-slate-200">{name}</p>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                      status === 'Configuré' ? 'bg-green-900/50 text-green-400'
                      : status === 'Auto' ? 'bg-blue-900/50 text-blue-400'
                      : status === 'Inclus' ? 'bg-emerald-900/50 text-emerald-400'
                      : 'bg-yellow-900/50 text-yellow-400'
                    }`}>{status}</span>
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">{desc}</p>
                </div>
              ))}
            </div>
          )}

          {tab === 'workflow' && (
            <div className="space-y-2">
              {onStartTour && (
                <button
                  onClick={onStartTour}
                  data-tour="start-tour-btn"
                  className="w-full flex flex-col items-center gap-0.5 bg-orange-600 hover:bg-orange-500 text-white text-xs font-medium py-2 rounded-lg transition-colors mb-3"
                >
                  <span className="flex items-center gap-1.5"><Video size={13} /> Lancer le tutoriel interactif</span>
                  <span className="text-[10px] font-normal text-orange-100/80">
                    Crée un projet démo « Template Cars Annotation » et déroule tout le workflow
                  </span>
                </button>
              )}
              <p className="text-xs text-slate-400 mb-3">Flux recommandé pour annoter une séquence :</p>
              {VIDEO_STEPS.map((step, i) => (
                <div key={i} className="flex gap-2 items-start">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-600/30 text-blue-400 text-xs flex items-center justify-center font-medium">
                    {i + 1}
                  </span>
                  <p className="text-xs text-slate-300 leading-relaxed">{step}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const ModeGrid: React.FC<{ title: string; items: { name: string; desc: string }[] }> = ({ title, items }) => (
  <div>
    <p className="text-[10px] uppercase tracking-wide text-slate-500 mb-1.5">{title}</p>
    <div className="grid grid-cols-2 gap-2">
      {items.map(({ name, desc }) => (
        <div key={name} className="p-2 bg-slate-800/60 rounded border border-slate-700/50">
          <p className="text-xs font-medium text-slate-200 mb-0.5">{name}</p>
          <p className="text-xs text-slate-400 leading-relaxed">{desc}</p>
        </div>
      ))}
    </div>
  </div>
)
