// ============================================================
// components/modals/CreateProjectModal.tsx
// Modal de création d'un nouveau projet (image ou vidéo).
// ============================================================

import React, { useState } from 'react'
import { X, Image, Film } from 'lucide-react'
import { useT } from '../../i18n/useLang'

interface CreateProjectModalProps {
  isOpen: boolean
  onCreate: (name: string, type: 'image' | 'video') => Promise<void>
  onClose: () => void
}

export const CreateProjectModal: React.FC<CreateProjectModalProps> = ({
  isOpen,
  onCreate,
  onClose,
}) => {
  const t = useT()
  const [name, setName] = useState('')
  const [type, setType] = useState<'image' | 'video'>('image')
  const [loading, setLoading] = useState(false)

  if (!isOpen) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setLoading(true)
    try {
      await onCreate(name.trim(), type)
      setName('')
      setType('image')
      onClose()
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-slate-800 border border-slate-700 rounded-xl p-6 w-96 shadow-2xl">
        {/* En-tête */}
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-slate-100">{t('Nouveau projet')}</h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          {/* Nom du projet */}
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">{t('Nom du projet')}</label>
            <input
              autoFocus
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('Mon dataset...')}
              data-tour="create-project-name"
              className="w-full bg-slate-700 border border-slate-600 focus:border-blue-500 text-white text-sm px-3 py-2 rounded-lg outline-none transition-colors"
            />
          </div>

          {/* Type de projet */}
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">{t('Type')}</label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { value: 'image', label: t('Image Random'), Icon: Image, desc: t("Jeu d'images non-séquentielles") },
                { value: 'video', label: t('Séquence Image'), Icon: Film, desc: t("Vidéo .mp4 ou dossier d'images") },
              ].map(({ value, label, Icon, desc }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setType(value as 'image' | 'video')}
                  data-tour={`create-project-type-${value}`}
                  className={`flex flex-col items-center gap-1.5 p-3 rounded-lg border transition-all ${
                    type === value
                      ? 'border-blue-500 bg-blue-600/20 text-blue-300'
                      : 'border-slate-600 hover:border-slate-500 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Icon size={20} />
                  <span className="text-sm font-medium">{label}</span>
                  <span className="text-xs opacity-70 text-center">{desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              data-tour="create-project-cancel"
              className="flex-1 py-2 text-sm text-slate-300 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors"
            >
              {t('Annuler')}
            </button>
            <button
              type="submit"
              disabled={!name.trim() || loading}
              data-tour="create-project-submit"
              className="flex-1 py-2 text-sm text-white bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-500 rounded-lg transition-colors"
            >
              {loading ? t('Création...') : t('Créer')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
