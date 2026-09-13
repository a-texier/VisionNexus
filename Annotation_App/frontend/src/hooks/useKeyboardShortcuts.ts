// ============================================================
// hooks/useKeyboardShortcuts.ts
// Raccourcis clavier globaux pour l'interface d'annotation.
// S'active uniquement quand le focus n'est pas sur un champ de texte.
// ============================================================

import { useEffect } from 'react'
import { useAnnotationStore } from '../stores/annotationStore'
import { useProjectStore } from '../stores/projectStore'
import { useUIStore } from '../stores/uiStore'

/**
 * Hook qui enregistre les raccourcis clavier globaux.
 * Doit être utilisé dans le composant AnnotationPage.
 *
 * Raccourcis :
 *   R          → Outil Rectangle (bbox)
 *   P          → Outil Polygone
 *   S          → Outil Point SAM
 *   Escape     → Annuler dessin / Désélectionner
 *   Delete     → Supprimer annotation sélectionnée
 *   Ctrl+Z     → Undo
 *   Ctrl+Y     → Redo
 *   Ctrl+C     → Copier annotations sélectionnées
 *   Ctrl+V     → Coller annotations
 *   ← / →     → Frame précédente / suivante
 *   1-9        → Sélectionner classe correspondante
 *   V          → Mode review rapide
 *   A          → Accept (mode review)
 *   D          → Delete all (mode review)
 */
interface BulkUndoHandlers {
  onBulkUndo?: () => void
  onBulkRedo?: () => void
  preferBulkUndo?: () => boolean  // true → Ctrl+Z annule une suppression groupée
  preferBulkRedo?: () => boolean  // true → Ctrl+Y refait une suppression groupée
}

export function useKeyboardShortcuts(
  classes: Array<{ id: number; shortcut_key: string | null }> = [],
  bulk?: BulkUndoHandlers,
) {
  const {
    setActiveTool,
    setActiveClassId,
    deselectAll,
    cancelDrawing,
    deleteSelected,
    copySelected,
    pasteToFrame,
    undo,
    redo,
    currentFrameId,
  } = useAnnotationStore()

  const { setCurrentFrameIndex, currentFrameIndex } = useProjectStore()
  const { toggleReviewMode } = useUIStore()

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignorer si le focus est sur un input, textarea ou select
      const target = e.target as HTMLElement
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable
      ) {
        return
      }

      const ctrl = e.ctrlKey || e.metaKey

      // ---- Undo / Redo ("dernière action gagne" : suppression groupée vs per-frame) ----
      if (ctrl && e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        if (bulk?.preferBulkUndo?.() && bulk.onBulkUndo) void bulk.onBulkUndo()
        else void undo()
        return
      }
      if (ctrl && (e.key === 'y' || (e.shiftKey && (e.key === 'Z' || e.key === 'z')))) {
        e.preventDefault()
        if (bulk?.preferBulkRedo?.() && bulk.onBulkRedo) void bulk.onBulkRedo()
        else void redo()
        return
      }

      // ---- Copier / Coller ----
      if (ctrl && e.key === 'c') {
        e.preventDefault()
        copySelected()
        return
      }
      if (ctrl && e.key === 'v') {
        e.preventDefault()
        if (currentFrameId) void pasteToFrame(currentFrameId)
        return
      }

      // ---- Navigation frames ----
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        setCurrentFrameIndex(currentFrameIndex - 1)
        return
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        setCurrentFrameIndex(currentFrameIndex + 1)
        return
      }

      // ---- Outils ----
      switch (e.key) {
        case 'r': case 'R':
          setActiveTool('bbox')
          break
        case 'p': case 'P':
          setActiveTool('polygon')
          break
        case 's': case 'S':
          setActiveTool('sam_point')
          break
        case 'Escape':
          cancelDrawing()
          deselectAll()
          setActiveTool('select')
          break
        case 'Delete': case 'Backspace':
          e.preventDefault()
          void deleteSelected()
          break
        case 'v': case 'V':
          toggleReviewMode()
          break
        case 'a': case 'A':
          setActiveTool('select')
          break
        default:
          // Touches 1-9 pour sélectionner les classes par raccourci
          if (/^[1-9]$/.test(e.key)) {
            const shortcutClass = classes.find((c) => c.shortcut_key === e.key)
            if (shortcutClass) {
              setActiveClassId(shortcutClass.id)
            }
          }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    classes,
    currentFrameId,
    currentFrameIndex,
    setActiveTool,
    setActiveClassId,
    deselectAll,
    cancelDrawing,
    deleteSelected,
    copySelected,
    pasteToFrame,
    undo,
    redo,
    setCurrentFrameIndex,
    toggleReviewMode,
    bulk,
  ])
}
