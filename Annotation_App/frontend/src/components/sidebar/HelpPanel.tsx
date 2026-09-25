// ============================================================
// components/sidebar/HelpPanel.tsx
// Panneau d'aide (sidebar) : raccourcis, modes, fonctions, modèles, workflow.
// Contenu partagé avec le popup Help (components/help/helpContent.ts).
// ============================================================

import React, { useState } from 'react'
import { Keyboard, Info, Cpu, Video } from 'lucide-react'
import {
  SHORTCUT_GROUPS, TOOL_MODES, TRACKING_MODES, FEATURES, MODELS, VIDEO_STEPS,
} from '../help/helpContent'
import { useT } from '../../i18n/useLang'

type Section = 'shortcuts' | 'features' | 'models' | 'video'

export const HelpPanel: React.FC = () => {
  const t = useT()
  const [section, setSection] = useState<Section>('shortcuts')

  const SECTIONS: { id: Section; label: string; Icon: React.FC<{ size: number }> }[] = [
    { id: 'shortcuts', label: t('Raccourcis'), Icon: Keyboard },
    { id: 'features', label: t('Modes & Fonctions'), Icon: Info },
    { id: 'models', label: t('Modèles'), Icon: Cpu },
    { id: 'video', label: t('Workflow'), Icon: Video },
  ]

  return (
    <div className="flex flex-col h-full">
      <div className="flex border-b border-slate-700 bg-slate-800/50">
        {SECTIONS.map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => setSection(id)}
            className={`flex-1 flex flex-col items-center py-1.5 text-xs transition-colors gap-0.5 ${
              section === id ? 'text-blue-400 border-b border-blue-400' : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            <Icon size={12} />
            <span>{label}</span>
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {section === 'shortcuts' && (
          <div className="space-y-3">
            {SHORTCUT_GROUPS.map(({ group, items }) => (
              <div key={group}>
                <p className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">{t(group)}</p>
                <div className="space-y-0.5">
                  {items.map(({ key, desc }, i) => (
                    <div key={`${key}-${i}`} className="flex items-center gap-2 py-1 border-b border-slate-800/50 last:border-0">
                      <kbd className="bg-slate-700 text-slate-200 text-xs px-1.5 py-0.5 rounded font-mono min-w-[62px] text-center flex-shrink-0">
                        {t(key)}
                      </kbd>
                      <span className="text-xs text-slate-400">{t(desc)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {section === 'features' && (
          <div className="space-y-4">
            <div>
              <p className="text-[10px] uppercase tracking-wide text-slate-500 mb-1.5">{t("Modes d'annotation")}</p>
              <div className="space-y-2">
                {TOOL_MODES.map(({ name, desc }) => (
                  <div key={name} className="p-2 bg-slate-800/50 rounded border border-slate-700/50">
                    <p className="text-xs font-medium text-slate-200 mb-0.5">{t(name)}</p>
                    <p className="text-xs text-slate-400 leading-relaxed">{t(desc)}</p>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-slate-500 mb-1.5">{t('Modes de suivi (Tracks)')}</p>
              <div className="space-y-2">
                {TRACKING_MODES.map(({ name, desc }) => (
                  <div key={name} className="p-2 bg-slate-800/50 rounded border border-slate-700/50">
                    <p className="text-xs font-medium text-slate-200 mb-0.5">{t(name)}</p>
                    <p className="text-xs text-slate-400 leading-relaxed">{t(desc)}</p>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-slate-500 mb-1.5">{t('Fonctions')}</p>
              <div className="space-y-2">
                {FEATURES.map(({ name, desc }) => (
                  <div key={name} className="p-2 bg-slate-800/50 rounded border border-slate-700/50">
                    <p className="text-xs font-medium text-slate-200 mb-0.5">{t(name)}</p>
                    <p className="text-xs text-slate-400 leading-relaxed">{t(desc)}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {section === 'models' && (
          <div className="space-y-2">
            {MODELS.map(({ name, desc, status }) => (
              <div key={name} className="p-2 bg-slate-800/50 rounded border border-slate-700/50">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs font-medium text-slate-200">{name}</p>
                  <span className={`text-xs px-1.5 py-0.5 rounded ${
                    status === 'Configuré' ? 'bg-green-900/50 text-green-400'
                    : status === 'Auto' ? 'bg-blue-900/50 text-blue-400'
                    : status === 'Inclus' ? 'bg-emerald-900/50 text-emerald-400'
                    : 'bg-yellow-900/50 text-yellow-400'
                  }`}>{t(status)}</span>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">{t(desc)}</p>
              </div>
            ))}
          </div>
        )}

        {section === 'video' && (
          <div className="space-y-2">
            <p className="text-xs text-slate-400 mb-3">{t('Flux recommandé pour annoter une séquence :')}</p>
            {VIDEO_STEPS.map((step, i) => (
              <div key={i} className="flex gap-2 items-start">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-600/30 text-blue-400 text-xs flex items-center justify-center font-medium">
                  {i + 1}
                </span>
                <p className="text-xs text-slate-300 leading-relaxed">{t(step)}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="px-3 py-2 border-t border-slate-700 text-xs text-slate-600 text-center">
        Annotation App · SAM2 · SAMURAI · Grounding DINO · XFeat
      </div>
    </div>
  )
}
