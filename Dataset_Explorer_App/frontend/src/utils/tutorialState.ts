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
// dev en local) : les reglages du workspace. Le PUT /api/settings attend
// l'objet complet, on relit donc avant d'ecrire.
// ============================================================

import { settingsAPI } from '../api/client'

export const TUTORIAL_KEY = 'dataset_explorer'

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

export const readTutorialState = async (key = TUTORIAL_KEY): Promise<TutorialState> => {
  const native = bridge()
  if (native?.getTutorial) {
    try {
      return { ...DEFAULT_STATE, ...(await native.getTutorial(key)) }
    } catch {
      // Pont present mais injoignable : on retombe sur les reglages du workspace.
    }
  }
  try {
    const settings = await settingsAPI.get()
    return {
      launchedOnce: Boolean(settings.tutorial_launched_once),
      completed: Boolean(settings.tutorial_completed),
    }
  } catch {
    return { ...DEFAULT_STATE }
  }
}

export const writeTutorialState = async (
  patch: Partial<TutorialState>,
  key = TUTORIAL_KEY,
): Promise<void> => {
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
    const current = await settingsAPI.get()
    await settingsAPI.update({
      ...current,
      ...(patch.launchedOnce !== undefined ? { tutorial_launched_once: patch.launchedOnce } : {}),
      ...(patch.completed !== undefined ? { tutorial_completed: patch.completed } : {}),
    })
  } catch {
    // Un reglage cosmetique non persiste ne doit pas casser l'action en cours.
  }
}
