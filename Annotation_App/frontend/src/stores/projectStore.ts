// ============================================================
// stores/projectStore.ts
// Store Zustand pour la gestion des projets et des frames.
// ============================================================

import { create } from 'zustand'
import { projectsAPI, datasetAPI } from '../services/api'
import type { Frame, Project, ProjectDetail, SessionState } from '../types/api'

// Token de génération : incrémenté à chaque fetchFrames(page=0).
// Permet d'annuler les pages en vol si un nouvel appel démarre.
let _framesToken = 0

interface ProjectStore {
  // ---- État ----
  projects: Project[]
  currentProject: ProjectDetail | null
  currentFrameIndex: number
  frames: Frame[]
  totalFrames: number
  // Plancher de comptage issu des séquences connues (max start_index + frame_count).
  // Indispensable pour pouvoir naviguer vers une séquence dont les frames ne sont pas
  // encore chargées / pas encore toutes importées (sinon le clamp bloque sur la 1re).
  frameFloor: number
  isLoading: boolean
  error: string | null

  // ---- Actions : Projets ----
  fetchProjects: () => Promise<void>
  fetchProject: (id: number) => Promise<void>
  setCurrentProject: (project: ProjectDetail | null) => void
  deleteProject: (id: number) => Promise<void>

  // ---- Actions : Frames ----
  fetchFrames: (projectId: number, page?: number, limit?: number) => Promise<void>
  ensureFrameLoaded: (projectId: number, frameIndex: number) => Promise<void>
  setCurrentFrameIndex: (index: number) => void
  setFrameFloor: (floor: number) => void
  getCurrentFrame: () => Frame | null

  // ---- Actions : Frames ----
  markFramesAsExtracted: (frameIds: number[]) => void
  // Met à jour le compteur d'annotations d'une frame dans le tableau (timeline live)
  setFrameAnnotationCount: (frameId: number, count: number) => void
  // Marque une plage de frame_index comme annotée (timeline pendant la propagation :
  // le polling ne repasse pas par chaque frame, les cases intermédiaires restaient
  // rouges jusqu'au rechargement de fin de tâche)
  markFrameRangeAnnotated: (fromIndex: number, toIndex: number, count: number) => void

  // ---- Actions : Session ----
  saveSession: (projectId: number, data: Partial<SessionState>) => Promise<void>
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  // ---- État initial ----
  projects: [],
  currentProject: null,
  currentFrameIndex: 0,
  frames: [],
  totalFrames: 0,
  frameFloor: 0,
  isLoading: false,
  error: null,

  // ---- Projets ----

  fetchProjects: async () => {
    set({ isLoading: true, error: null })
    try {
      const projects = await projectsAPI.list()
      set({ projects, isLoading: false })
    } catch (e) {
      set({ error: 'Erreur chargement projets', isLoading: false })
    }
  },

  fetchProject: async (id) => {
    set({ isLoading: true, error: null })
    try {
      const project = await projectsAPI.get(id)
      set({ currentProject: project, totalFrames: project.frame_count, isLoading: false })

      // Restaurer l'index de frame depuis la session sauvegardée
      if (project.session?.current_frame_index !== undefined) {
        set({ currentFrameIndex: project.session.current_frame_index })
      }
    } catch (e) {
      set({ error: 'Erreur chargement projet', isLoading: false })
    }
  },

  setCurrentProject: (project) => {
    set({ currentProject: project })
  },

  deleteProject: async (id) => {
    try {
      await projectsAPI.delete(id)
      set((state) => ({
        projects: state.projects.filter((p) => p.id !== id),
        currentProject: state.currentProject?.id === id ? null : state.currentProject,
      }))
    } catch (e) {
      console.error('[projectStore] Erreur suppression projet :', e)
    }
  },

  // ---- Frames ----

  fetchFrames: async (projectId, page = 0, limit = 10000) => {
    // Chaque nouveau départ (page 0) incrémente le token → annule les séries précédentes en vol
    const myToken = page === 0 ? ++_framesToken : _framesToken

    if (page === 0 && get().currentProject?.id !== projectId) {
      set({ frames: [] })
    }
    try {
      // Auto-pagination : boucle tant que la page revient pleine, en mettant
      // l'état à jour à chaque page (la timeline se remplit progressivement).
      // Sans cette boucle, seules les `limit` premières frames étaient chargées
      // (projet 21000 frames → timeline et navigation amputées au-delà de 10000).
      let currentPage = page
      for (;;) {
        const frames = await datasetAPI.listFrames(projectId, currentPage, limit)
        // Si un appel plus récent a démarré, on abandonne silencieusement
        if (_framesToken !== myToken) return
        set((state) => {
          const merged = currentPage === 0 ? frames : [...state.frames, ...frames]
          const byIndex = new Map<number, Frame>()
          for (const frame of merged) byIndex.set(frame.frame_index, frame)
          const sorted = [...byIndex.values()].sort((a, b) => a.frame_index - b.frame_index)
          const lastIndex = sorted.length > 0 ? sorted[sorted.length - 1].frame_index + 1 : 0
          return {
            frames: sorted,
            // Le vrai total est le max de toutes les sources : frame_count projet
            // (peut être obsolète), frames réellement chargées, dernier index.
            totalFrames: Math.max(
              state.currentProject?.frame_count ?? 0,
              sorted.length,
              lastIndex,
              state.totalFrames,
            ),
          }
        })
        if (frames.length < limit) break
        currentPage += 1
      }
    } catch (e) {
      if (_framesToken === myToken) {
        console.error('[projectStore] Erreur chargement frames :', e)
      }
    }
  },

  ensureFrameLoaded: async (projectId, frameIndex) => {
    const { frames } = get()
    if (frames.some((frame) => frame.frame_index === frameIndex)) return

    try {
      const frame = await datasetAPI.getFrameByIndex(projectId, frameIndex)
      set((state) => {
        const byIndex = new Map<number, Frame>()
        for (const existing of state.frames) byIndex.set(existing.frame_index, existing)
        byIndex.set(frame.frame_index, frame)
        return {
          frames: [...byIndex.values()].sort((a, b) => a.frame_index - b.frame_index),
          totalFrames: Math.max(state.totalFrames, state.currentProject?.frame_count ?? 0, frame.frame_index + 1),
        }
      })
    } catch (e) {
      console.error('[projectStore] Erreur chargement frame par index :', e)
    }
  },

  setFrameFloor: (floor) => set({ frameFloor: Math.max(0, floor) }),

  setCurrentFrameIndex: (index) => {
    const { frames, totalFrames, currentProject, frameFloor } = get()
    // Le clamp doit couvrir TOUTES les sources de vérité : frame_count projet (peut
    // être obsolète en DB), totalFrames, nombre de frames chargées, dernier frame_index
    // réel, ET le plancher des séquences connues (frameFloor). Sans frameFloor, cliquer
    // sur une séquence dont les frames ne sont pas encore chargées/importées ramène
    // l'index dans la 1re séquence (« bloqué sur la séquence 1 »).
    const lastLoadedIndex = frames.length > 0 ? frames[frames.length - 1].frame_index + 1 : 0
    const knownCount = Math.max(
      currentProject?.frame_count ?? 0,
      totalFrames,
      frames.length,
      lastLoadedIndex,
      frameFloor,
    )
    const maxIndex = Math.max(0, knownCount - 1)
    const clampedIndex = Math.max(0, Math.min(index, maxIndex))
    set({ currentFrameIndex: clampedIndex })
  },

  getCurrentFrame: () => {
    const { frames, currentFrameIndex } = get()
    return frames.find((frame) => frame.frame_index === currentFrameIndex) ?? frames[currentFrameIndex] ?? null
  },

  markFramesAsExtracted: (frameIds) => {
    set((state) => ({
      frames: state.frames.map((f) =>
        frameIds.includes(f.id) ? { ...f, is_extracted: true } : f
      ),
    }))
  },

  setFrameAnnotationCount: (frameId, count) => {
    set((state) => {
      const idx = state.frames.findIndex((f) => f.id === frameId)
      if (idx === -1) return state
      const f = state.frames[idx]
      const nextAnnotated = count > 0
      // IDEMPOTENT : si rien ne change, renvoyer le MÊME state (même référence du
      // tableau frames). Sinon on recréerait un tableau à chaque appel → l'effet de
      // chargement d'annotations (dép. `frames`) se re-déclencherait → boucle infinie
      // de GET /frames/{id}/annotations (et canvas inannotable).
      if (f.annotation_count === count && f.is_annotated === nextAnnotated) {
        return state
      }
      const frames = state.frames.slice()
      frames[idx] = { ...f, annotation_count: count, is_annotated: nextAnnotated }
      return { frames }
    })
  },

  markFrameRangeAnnotated: (fromIndex, toIndex, count) => {
    set((state) => {
      const lo = Math.min(fromIndex, toIndex)
      const hi = Math.max(fromIndex, toIndex)
      let changed = false
      const frames = state.frames.map((f) => {
        if (f.frame_index < lo || f.frame_index > hi) return f
        if (f.is_annotated && f.annotation_count === count) return f
        changed = true
        return { ...f, annotation_count: count, is_annotated: count > 0 }
      })
      return changed ? { frames } : state
    })
  },

  // ---- Session ----

  saveSession: async (projectId, data) => {
    try {
      await projectsAPI.updateSession(projectId, data)
    } catch (e) {
      // Silencieux : l'auto-save ne doit pas perturber l'expérience
      console.warn('[projectStore] Erreur sauvegarde session :', e)
    }
  },
}))
