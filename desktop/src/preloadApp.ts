// ============================================================
// desktop/src/preloadApp.ts
// Preload de la fenetre affichant une app CHARGEE (Annotation App, explorer
// BDD App, etc.), distinct du preload du catalogue.
//
// Flag(s) exposes au frontend pour savoir si le chemin natif app-image://
// peut etre tente (__ANNOTATION_APP_NATIVE__ garde tel quel pour ne pas
// casser AnnotationPage.tsx deja en prod ; __CV_NATIVE_MOUNT__ generique,
// a utiliser par les prochaines apps -- Dataset Explorer notamment).
//
// PAS de badge visuel injecte dans la page ici (ancienne version) : il
// finissait par recouvrir des boutons de l'app (ex. "Export" dans Annotation
// App -- coin haut-droit dispute par les deux). Le statut natif/HTTP et
// online/offline est maintenant affiche cote lanceur (barre d'onglets de
// catalog.html pour un onglet docke, titre de fenetre pour un onglet
// detache) -- jamais superpose au contenu de l'app elle-meme.
// ============================================================

import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { TutorialState } from './settings'

interface NativeStatus {
  supported: boolean
  active: boolean
  reason: string
}

function readNativeStatus(): NativeStatus {
  const arg = process.argv.find((a) => a.startsWith('--cv-native-status='))
  if (!arg) return { supported: false, active: false, reason: 'statut inconnu' }
  try {
    return JSON.parse(arg.slice('--cv-native-status='.length)) as NativeStatus
  } catch {
    return { supported: false, active: false, reason: 'statut illisible' }
  }
}

const status = readNativeStatus()

// Backward compat : AnnotationPage.tsx lit deja ce flag precis (contextBridge,
// donc pas d'acces direct a `status` cote page -- juste un booleen). Le
// gating reel (natif vs repli) se fait deja dans imageProtocol.ts a chaque
// requete -- ce flag dit seulement "tente le chemin app-image://", pas
// "le montage est actif la maintenant" (qui peut changer en cours de session).
contextBridge.exposeInMainWorld('__ANNOTATION_APP_NATIVE__', status.supported)

// Generique, pour les apps suivantes (Dataset Explorer, etc.) : meme logique,
// nom pas fige a Annotation. getPathForFile() remplace l'ancien file.path
// (deprecie) : seul moyen pour le renderer (sandboxe, sans acces Node) de
// recuperer le vrai chemin OS d'un fichier/dossier depose au drag-and-drop --
// indispensable pour eviter qu'un drop SMB (\\<share-host>\...) se transforme en
// upload/copie locale faute de pouvoir transmettre autre chose que les
// octets du fichier.
contextBridge.exposeInMainWorld('__CV_NATIVE_MOUNT__', {
  supported: status.supported,
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  openInNativeFileManager: (
    path: string,
    mappings: Array<{ backendRoot: string; clientRoot: string }> = [],
  ): Promise<{ ok: boolean; path?: string; error?: string }> =>
    ipcRenderer.invoke('cv:open-native-path', path, mappings),
  selectDirectory: (): Promise<string | null> => ipcRenderer.invoke('cv:select-native-directory'),
  // Etat du tutoriel interactif de l'app affichee. Stocke cote lanceur
  // (%APPDATA%\VisionNexusElectron\settings.json), pas dans le workspace de
  // l'app : le "deja vu ce tuto" appartient a l'utilisateur et a son poste.
  // Les frontends doivent traiter l'absence de ce pont (lancement hors
  // Electron, dans un navigateur) comme un repli, jamais comme une erreur.
  getTutorial: (key: string): Promise<TutorialState> => ipcRenderer.invoke('cv:get-tutorial', key),
  setTutorial: (key: string, patch: Partial<TutorialState>): Promise<TutorialState> =>
    ipcRenderer.invoke('cv:set-tutorial', key, patch),
})
