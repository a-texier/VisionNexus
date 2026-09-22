// ============================================================
// hooks/useTaskPolling.ts
// Poll le statut d'une tâche async (export, ByteTrack, etc.)
// toutes les 500ms jusqu'à completion ou erreur.
// ============================================================

import { useEffect, useRef, useState } from 'react'
import { exportAPI } from '../services/api'
import type { ExportTask } from '../types/api'

// ---- Hook générique de polling de tâche ----

export function useTaskPolling(taskId: string | null, intervalMs = 800) {
  const [taskStatus, setTaskStatus] = useState<ExportTask | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!taskId) {
      setTaskStatus(null)
      return
    }

    const poll = async () => {
      try {
        const status = await exportAPI.getStatus(taskId)
        setTaskStatus(status)
        if (status.status === 'completed' || status.status === 'error') {
          if (intervalRef.current) {
            clearInterval(intervalRef.current)
            intervalRef.current = null
          }
        }
      } catch {
        // Silencieux : on continue de polling
      }
    }

    void poll()
    intervalRef.current = setInterval(poll, intervalMs)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [taskId, intervalMs])

  return { taskStatus }
}

interface UseTaskPollingResult {
  task: ExportTask | null
  isPolling: boolean
  error: string | null
}

/**
 * Hook pour suivre la progression d'une tâche async de l'API.
 * Arrête le polling dès que la tâche est terminée (completed ou error).
 *
 * @param taskId - ID de la tâche, ou null pour désactiver le polling
 * @param intervalMs - Intervalle de polling en ms (défaut: 500)
 */
export function useExportTaskPolling(
  taskId: string | null,
  intervalMs = 500
): UseTaskPollingResult {
  const [task, setTask] = useState<ExportTask | null>(null)
  const [isPolling, setIsPolling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!taskId) {
      setTask(null)
      setIsPolling(false)
      return
    }

    setIsPolling(true)
    setError(null)

    const poll = async () => {
      try {
        const status = await exportAPI.getStatus(taskId)
        setTask(status)

        // Arrêt du polling si la tâche est terminée
        if (status.status === 'completed' || status.status === 'error') {
          setIsPolling(false)
          if (intervalRef.current) {
            clearInterval(intervalRef.current)
            intervalRef.current = null
          }
          if (status.status === 'error') {
            setError(status.error ?? 'Erreur inconnue')
          }
        }
      } catch (e) {
        setError('Erreur de communication avec le serveur')
        setIsPolling(false)
        if (intervalRef.current) {
          clearInterval(intervalRef.current)
          intervalRef.current = null
        }
      }
    }

    // Première vérification immédiate
    void poll()
    intervalRef.current = setInterval(poll, intervalMs)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [taskId, intervalMs])

  return { task, isPolling, error }
}
