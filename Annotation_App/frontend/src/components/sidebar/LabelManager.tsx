// ============================================================
// components/sidebar/LabelManager.tsx
// Gestionnaire des classes d'objets dans la sidebar.
// Hiérarchie : classe (détection, obligatoire) > sous-classe
// (reconnaissance) > sous-sous-classe (identification).
// Exemple : drone > quadcoptere > mavic.
// ============================================================

import React, { useState } from 'react'
import { Plus, Trash2, Edit2 } from 'lucide-react'
import type { LabelClass } from '../../types/api'
import { useAnnotationStore } from '../../stores/annotationStore'

interface LabelManagerProps {
  classes: LabelClass[]
  onCreateClass: (name: string, color: string, subclass?: string, subsubclass?: string) => Promise<void>
  onUpdateClass: (id: number, name: string, color: string, subclass?: string, subsubclass?: string) => Promise<void>
  onDeleteClass: (id: number) => Promise<void>
}

/** Libellé hiérarchique complet, ex : "drone / quadcoptere / mavic". */
export const classFullLabel = (cls: LabelClass): string =>
  [cls.name, cls.subclass, cls.subsubclass].filter(Boolean).join(' / ')

export const LabelManager: React.FC<LabelManagerProps> = ({
  classes,
  onCreateClass,
  onUpdateClass,
  onDeleteClass,
}) => {
  const { activeClassId, setActiveClassId } = useAnnotationStore()
  const [isCreating, setIsCreating] = useState(false)
  const [newClassName, setNewClassName] = useState('')
  const [newSubclass, setNewSubclass] = useState('')
  const [newSubsubclass, setNewSubsubclass] = useState('')
  const [newClassColor, setNewClassColor] = useState('#3B82F6')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editName, setEditName] = useState('')
  const [editSubclass, setEditSubclass] = useState('')
  const [editSubsubclass, setEditSubsubclass] = useState('')
  const [editColor, setEditColor] = useState('')

  const handleCreate = async () => {
    if (!newClassName.trim()) return
    await onCreateClass(
      newClassName.trim(),
      newClassColor,
      newSubclass.trim() || undefined,
      newSubsubclass.trim() || undefined,
    )
    setNewClassName('')
    setNewSubclass('')
    setNewSubsubclass('')
    setNewClassColor('#3B82F6')
    setIsCreating(false)
  }

  const handleEditStart = (cls: LabelClass) => {
    setEditingId(cls.id)
    setEditName(cls.name)
    setEditSubclass(cls.subclass ?? '')
    setEditSubsubclass(cls.subsubclass ?? '')
    setEditColor(cls.color)
  }

  const handleEditSave = async () => {
    if (!editingId || !editName.trim()) return
    await onUpdateClass(
      editingId,
      editName.trim(),
      editColor,
      editSubclass.trim(),
      editSubsubclass.trim(),
    )
    setEditingId(null)
  }

  return (
    <div className="flex flex-col gap-1 p-2 overflow-y-auto">
      <div className="flex justify-between items-center mb-2">
        <span className="text-xs text-slate-400 uppercase tracking-wide">Classes</span>
        <button
          onClick={() => setIsCreating(true)}
          data-tour="add-class-btn"
          className="p-1 rounded hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
          title="Ajouter une classe"
        >
          <Plus size={14} />
        </button>
      </div>

      {/* Formulaire de création */}
      {isCreating && (
        <div className="bg-slate-700 rounded p-2 mb-2 flex flex-col gap-1.5">
          <input
            autoFocus
            type="text"
            placeholder="Classe (détection) * — ex : drone"
            value={newClassName}
            onChange={(e) => setNewClassName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void handleCreate()}
            data-tour="class-name-input"
            className="bg-slate-600 text-white text-sm px-2 py-1 rounded outline-none border border-slate-500"
          />
          <input
            type="text"
            placeholder="Sous-classe (reconnaissance) — ex : quadcoptere"
            value={newSubclass}
            onChange={(e) => setNewSubclass(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void handleCreate()}
            className="bg-slate-600 text-slate-200 text-xs px-2 py-1 rounded outline-none border border-slate-500/60"
          />
          <input
            type="text"
            placeholder="Sous-sous-classe (identification) — ex : mavic"
            value={newSubsubclass}
            onChange={(e) => setNewSubsubclass(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void handleCreate()}
            disabled={!newSubclass.trim()}
            className="bg-slate-600 text-slate-200 text-xs px-2 py-1 rounded outline-none border border-slate-500/60 disabled:opacity-40"
          />
          <div className="flex gap-2 items-center">
            <input
              type="color"
              value={newClassColor}
              onChange={(e) => setNewClassColor(e.target.value)}
              data-tour="class-color-input"
              className="w-8 h-8 rounded cursor-pointer border-0"
            />
            <button
              onClick={() => void handleCreate()}
              disabled={!newClassName.trim()}
              data-tour="class-create-submit"
              className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-600 disabled:text-slate-400 text-white text-xs py-1 rounded"
            >
              Créer
            </button>
            <button
              onClick={() => setIsCreating(false)}
              data-tour="class-cancel"
              className="text-slate-400 hover:text-white text-xs"
            >
              Annuler
            </button>
          </div>
          <p className="text-[10px] text-slate-400 leading-tight">
            Seule la classe de base est obligatoire.
          </p>
        </div>
      )}

      {/* Liste des classes */}
      {classes.map((cls, clsIndex) => (
        <div
          key={cls.id}
          onClick={() => setActiveClassId(cls.id === activeClassId ? null : cls.id)}
          data-tour={clsIndex === 0 ? 'class-row-first' : undefined}
          className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer transition-colors group ${
            cls.id === activeClassId
              ? 'bg-blue-600/30 border border-blue-500/50'
              : 'hover:bg-slate-700 border border-transparent'
          }`}
        >
          {/* Swatch couleur */}
          <div
            className="w-3 h-3 rounded-sm flex-shrink-0"
            style={{ backgroundColor: cls.color }}
          />

          {/* Édition inline */}
          {editingId === cls.id ? (
            <div className="flex-1 flex flex-col gap-1" onClick={(e) => e.stopPropagation()}>
              <div className="flex gap-1 items-center">
                <input
                  autoFocus
                  type="text"
                  value={editName}
                  placeholder="Classe *"
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void handleEditSave()}
                  className="flex-1 bg-slate-600 text-white text-xs px-1 rounded outline-none"
                />
                <input
                  type="color"
                  value={editColor}
                  onChange={(e) => setEditColor(e.target.value)}
                  className="w-6 h-5 cursor-pointer border-0 rounded"
                />
                <button
                  onClick={() => void handleEditSave()}
                  className="text-green-400 text-xs"
                >
                  ✓
                </button>
              </div>
              <input
                type="text"
                value={editSubclass}
                placeholder="Sous-classe"
                onChange={(e) => setEditSubclass(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void handleEditSave()}
                className="bg-slate-600 text-slate-200 text-xs px-1 py-0.5 rounded outline-none"
              />
              <input
                type="text"
                value={editSubsubclass}
                placeholder="Sous-sous-classe"
                onChange={(e) => setEditSubsubclass(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void handleEditSave()}
                disabled={!editSubclass.trim()}
                className="bg-slate-600 text-slate-200 text-xs px-1 py-0.5 rounded outline-none disabled:opacity-40"
              />
            </div>
          ) : (
            <>
              <div className="flex-1 min-w-0">
                <span className="block text-sm text-slate-200 truncate">{cls.name}</span>
                {(cls.subclass || cls.subsubclass) && (
                  <span className="block text-[10px] text-slate-400 truncate">
                    {[cls.subclass, cls.subsubclass].filter(Boolean).join(' / ')}
                  </span>
                )}
              </div>

              {/* Raccourci clavier */}
              {cls.shortcut_key && (
                <span className="text-xs text-slate-500 font-mono bg-slate-700 px-1 rounded">
                  {cls.shortcut_key}
                </span>
              )}

              {/* Actions (visibles au hover) */}
              <div className="hidden group-hover:flex gap-1">
                <button
                  onClick={(e) => { e.stopPropagation(); handleEditStart(cls) }}
                  className="p-0.5 hover:text-blue-400 text-slate-500 transition-colors"
                >
                  <Edit2 size={11} />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); void onDeleteClass(cls.id) }}
                  className="p-0.5 hover:text-red-400 text-slate-500 transition-colors"
                >
                  <Trash2 size={11} />
                </button>
              </div>
            </>
          )}
        </div>
      ))}

      {classes.length === 0 && !isCreating && (
        <p className="text-xs text-slate-500 text-center py-4">
          Aucune classe définie. Cliquez sur + pour créer.
        </p>
      )}
    </div>
  )
}
