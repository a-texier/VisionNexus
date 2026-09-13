// ============================================================
// utils/tutorialState.ts
// Etat du tutoriel interactif ("deja lance", "termine").
//
// Source de verite : les reglages de VisionNexus, cote lanceur Electron
// (%APPDATA%\VisionNexusElectron\settings.json, champ tutorials.<cle>). Ce
// fichier vit dans le profil Windows de l'utilisateur : le "j'ai deja vu ce
// tutoriel" est ainsi lie a la PERSONNE et a SON poste, et non au workspace
// (qui peut etre partage, deplace ou recree) ni au navigateur (localStorage
// perdu au moindre nettoyage).
//
// Repli quand le pont Electron est absent (app ouverte dans un navigateur,
// dev en local) : la section `tutorial` des reglages du backend, dans le
// workspace. Moins juste, mais jamais bloquant.
// ============================================================

import { settingsAPI } from '../services/api'

export interface TutorialState {
  launchedOnce: boolean
  completed: boolean
}

interface TutorialBridge {
  getTutorial?: (key: string) => Promise<TutorialState>
  setTutorial?: (key: string, patch: Partial<TutorialState>) => Promise<TutorialState>
}

const DEFAULT_STATE: TutorialState = { launchedOnce: false, completed: false }

const bridge = (): TutorialBridge | null => {
  const native = (window as typeof window & { __CV_NATIVE_MOUNT__?: TutorialBridge }).__CV_NATIVE_MOUNT__
  return native?.getTutorial && native.setTutorial ? native : null
}

/** True si l'etat est porte par VisionNexus (et non par le workspace). */
export const isTutorialStateNative = (): boolean => bridge() !== null

export const readTutorialState = async (key: string): Promise<TutorialState> => {
  const native = bridge()
  if (native?.getTutorial) {
    try {
      return { ...DEFAULT_STATE, ...(await native.getTutorial(key)) }
    } catch {
      // Pont present mais injoignable : on retombe sur le backend.
    }
  }
  try {
    const settings = await settingsAPI.get()
    const stored = settings.tutorial
    return {
      launchedOnce: Boolean(stored?.launched_once),
      completed: Boolean(stored?.completed),
    }
  } catch {
    return { ...DEFAULT_STATE }
  }
}

export const writeTutorialState = async (key: string, patch: Partial<TutorialState>): Promise<void> => {
  const native = bridge()
  if (native?.setTutorial) {
    try {
      await native.setTutorial(key, patch)
      return
    } catch {
      // Idem : on persiste au moins cote workspace.
    }
  }
  try {
    const payload: Record<string, boolean> = {}
    if (patch.launchedOnce !== undefined) payload.launched_once = patch.launchedOnce
    if (patch.completed !== undefined) payload.completed = patch.completed
    await settingsAPI.update({ tutorial: payload } as never)
  } catch {
    // Un reglage cosmetique non persiste ne doit pas casser l'action en cours.
  }
}
