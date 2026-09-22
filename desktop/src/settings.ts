// ============================================================
// desktop/src/settings.ts
// Reglages du lanceur -- stockage INDEPENDANT de l'ancien VisionNexus,
// volontairement. Son propre dossier userData Electron : app.getName() suit
// "productName" du package.json, donc
// %APPDATA%\VisionNexusElectron\settings.json sous Windows -- jamais
// %APPDATA%\VisionNexus\user_settings.json (l'ancien outil).
// Decision explicite : zero couplage entre les deux outils, meme si les
// champs se ressemblent (meme reglages a ressaisir une fois cote lanceur).
//
// C'est aussi ici que vit l'etat des tutoriels interactifs de toute la suite
// (champ `tutorials`) : un dossier Roaming par utilisateur Windows et par
// poste, ce qui est exactement la portee voulue pour un "deja vu ce tuto".
// ============================================================

import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'

/** Etat d'un tutoriel interactif, une entree par app de la suite. */
export interface TutorialState {
  // Passe a true au PREMIER clic sur le bouton : le halo orange s'eteint
  // definitivement, meme si le tour est abandonne.
  launchedOnce: boolean
  // true une fois le tour arrive a sa derniere etape.
  completed: boolean
}

export interface LauncherSettings {
  username: string
  workspace: string
  cvRoot: string    // chemin de Computer_Vision_App vu par la CIBLE (VM Linux, ou local Windows)
  condaPath: string
  vms: string[]
  selectedVm: string
  // Hote du partage reseau natif (ex: "share-host.example.net") -- generique, PAS fige a
  // SMB/Annotation App. Vide par defaut : rien n'est suppose, aucune app ne
  // tente le chemin natif tant que ce champ n'est pas rempli ET verifie
  // joignable (cf. cv:check-mount dans main.ts). Chaque app qui sait servir
  // un chemin natif (Annotation, explorer...) utilise cet hote en priorite ;
  // avant, ce reglage n'existait qu'a l'interieur de chaque app (native_share_host
  // dans son propre settings_service, ex Annotation_App), invisible d'ici.
  nativeMountHost: string
  // Langue pilotee depuis VisionNexus, propagee a chaque app au lancement
  // (?lang= dans l'URL initiale, cf. createAppTab dans main.ts). Chaque app
  // reste modulaire : elle memorise sa propre preference (localStorage) et
  // peut la changer localement sans repercuter sur ce reglage ni sur les
  // autres apps -- ce champ ne fait que fixer la langue de DEPART des apps
  // lancees depuis le launcher, "connectees" au reglage central par defaut.
  uiLanguage: 'en' | 'fr'
  // Etat des tutoriels interactifs de TOUTE la suite, par cle d'app
  // ("nexus", "annotation", "dataset_explorer"...). Stocke ici, donc dans
  // le dossier userData Electron (%APPDATA%\<produit>\settings.json sous
  // Windows) : lie a l'utilisateur Windows et a SON poste, pas au workspace
  // -- un workspace peut etre partage, deplace ou recree, l'utilisateur ne
  // veut pas revoir le tutoriel pour autant.
  tutorials: Record<string, TutorialState>
}

export const DEFAULT_TUTORIAL_STATE: TutorialState = { launchedOnce: false, completed: false }

const DEFAULTS: LauncherSettings = {
  username: '',
  workspace: '',
  cvRoot: '',
  condaPath: '',
  vms: [],
  selectedVm: '',
  nativeMountHost: '',
  uiLanguage: 'en',
  tutorials: {},
}

function settingsPath(): string {
  return path.join(app.getPath('userData'), 'settings.json')
}

export function loadSettings(): LauncherSettings {
  try {
    const raw = fs.readFileSync(settingsPath(), 'utf-8')
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<LauncherSettings>) }
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveSettings(s: LauncherSettings): void {
  // Fusion avec le disque : l'UI du catalogue reconstruit un objet a partir de
  // ses champs de formulaire et n'y met pas `tutorials`. Sans cette fusion, un
  // simple "Enregistrer" effacerait l'etat des tutoriels.
  const merged: LauncherSettings = { ...loadSettings(), ...s }
  fs.mkdirSync(app.getPath('userData'), { recursive: true })
  fs.writeFileSync(settingsPath(), JSON.stringify(merged, null, 2), 'utf-8')
}

/** Etat d'un tutoriel (valeurs par defaut si la cle est inconnue). */
export function getTutorialState(key: string): TutorialState {
  const stored = loadSettings().tutorials?.[key]
  return { ...DEFAULT_TUTORIAL_STATE, ...(stored ?? {}) }
}

/** Fusion partielle de l'etat d'un tutoriel. Renvoie l'etat resultant. */
export function setTutorialState(key: string, patch: Partial<TutorialState>): TutorialState {
  const settings = loadSettings()
  const next: TutorialState = { ...DEFAULT_TUTORIAL_STATE, ...(settings.tutorials?.[key] ?? {}), ...patch }
  settings.tutorials = { ...(settings.tutorials ?? {}), [key]: next }
  saveSettings(settings)
  return next
}

export function isValid(s: LauncherSettings): boolean {
  return !!(s.username.trim() && s.workspace.trim() && s.cvRoot.trim() && s.condaPath.trim())
}
