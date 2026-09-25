// ============================================================
// hooks/useAutoSave.ts
// Sauvegarde automatique de la session toutes les 2 minutes.
// Sauvegarde aussi un backup JSON des annotations du projet.
// ============================================================

import { useEffect, useRef } from 'react'
import { useProjectStore } from '../stores/projectStore'
import { useAnnotationStore } from '../stores/annotationStore'
import { useUIStore } from '../stores/uiStore'
import toast from 'react-hot-toast'
import { t } from '../i18n/translate'

// 2 minutes entre chaque sauvegarde automatique
const AUTO_SAVE_INTERVAL_MS = 120_000

/**
 * Hook d'auto-save qui :
 * 1. Sauvegarde la session (frame, zoom, outil) en BDD toutes les 2 min
 * 2. Télécharge un backup JSON des annotations (optionnel, déclenché manuellement ou auto)
 */
export function useAutoSave(projectId: number | null) {
  const { saveSession, currentFrameIndex } = useProjectStore()
  const { activeClassId, activeTool } = useAnnotationStore()
  const { canvasZoom, canvasOffset } = useUIStore()
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastBackupRef = useRef<number>(0)

  useEffect(() => {
    if (!projectId) return

    const saveSessionState = async () => {
      try {
        await saveSession(projectId, {
          current_frame_index: currentFrameIndex,
          zoom_level: canvasZoom,
          canvas_offset_x: canvasOffset.x,
          canvas_offset_y: canvasOffset.y,
          selected_class_id: activeClassId ?? undefined,
          selected_tool: activeTool,
        })
      } catch {
        // Silencieux — pas de toast pour la sauvegarde auto
      }
    }

    const exportBackup = async () => {
      try {
        // Sauvegarde côté serveur dans data/backup/ — silencieuse (pas de toast)
        const res = await fetch(`/api/projects/${projectId}/backup/save`, { method: 'POST' })
        if (!res.ok) return
        lastBackupRef.current = Date.now()
      } catch {
        // Silencieux — ne pas perturber l'utilisateur si le backup echoue
      }
    }

    // Première sauvegarde après 5s, puis toutes les 2 minutes
    const timeout = setTimeout(async () => {
      await saveSessionState()
      await exportBackup()

      intervalRef.current = setInterval(async () => {
        await saveSessionState()
        await exportBackup()
      }, AUTO_SAVE_INTERVAL_MS)
    }, 5000)

    return () => {
      clearTimeout(timeout)
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [
    projectId,
    currentFrameIndex,
    canvasZoom,
    canvasOffset,
    activeClassId,
    activeTool,
    saveSession,
  ])
}

/**
 * Déclenche le téléchargement du backup JSON des annotations d'un projet.
 * Peut être appelé manuellement depuis l'UI.
 */
export async function downloadAnnotationBackup(projectId: number): Promise<void> {
  try {
    const res = await fetch(`/api/projects/${projectId}/backup`)
    if (!res.ok) throw new Error(t('Erreur réseau'))
    const backup = await res.json()
    const json = JSON.stringify(backup, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `annotations_backup_project${projectId}_${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    toast.success(t('Backup téléchargé'))
  } catch {
    toast.error(t('Erreur lors du backup'))
  }
}

/**
 * Récupère le backup JSON stocké dans localStorage (dernier auto-backup).
 */
export function getLocalBackup(projectId: number): { data: string | null; date: string | null } {
  const key = `annotation_backup_${projectId}`
  return {
    data: localStorage.getItem(key),
    date: localStorage.getItem(`${key}_date`),
  }
}
