// ============================================================
// stores/settingsStore.ts
// Store Zustand des paramètres utilisateur.
// Chargé une seule fois au démarrage, accessible partout.
// ============================================================

import { create } from 'zustand'
import { settingsAPI } from '../services/api'
import type { UserSettings } from '../types/api'

interface SettingsStore {
  settings: UserSettings | null
  loaded: boolean
  fetch: () => Promise<void>
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  settings: null,
  loaded: false,

  fetch: async () => {
    try {
      const s = await settingsAPI.get()
      set({ settings: s, loaded: true })
    } catch {
      set({ loaded: true }) // silencieux — on utilisera les defaults locaux
    }
  },
}))
