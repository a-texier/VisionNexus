// ============================================================
// desktop/src/catalog.ts
// Catalogue des apps Computer_Vision_App -- ports par defaut portes depuis
// zip_all_apps.py (ports dict, _make_setup_sh) + README.md (inference).
// Positions x/y/color reprises telles quelles de VisionNexus/AppCatalog.cs
// (AppTile) pour reproduire le meme diagramme de flux (chaine pipeline en
// serpentin) dans l'UI de ce lanceur.
// "compare" volontairement exclu, comme dans package_cv_bundle.py
// (BUNDLE_APPS) et son commentaire "Autre/Compare_BDD_App est IGNORE".
//
// Note : les ports sont des DEFAUTS, jamais forces au lancement (voir
// sshLauncher.ts) -- le launcher.py distant alloue dynamiquement et les
// annonce sur stdout, seule source de verite.
// ============================================================

export interface AppDef {
  id: string
  label: string
  icon: string
  backendPort: number
  frontendPort: number
  x: number
  y: number
  color: string
  // L'app sait construire une url image-path + lire un chemin natif quand un
  // partage reseau est configure et joignable (Parametres > Partage reseau
  // natif) -- sinon HTTP normal, comme toutes les autres. Volontairement
  // explicite (pas un "toutes les apps essaient" implicite) : chaque app doit
  // avoir reellement l'endpoint backend + le hook frontend correspondants.
  supportsNativeMount?: boolean
  /** Application autonome, visuellement separee de la suite Orchestrator. */
  standalone?: boolean
}

export const APPS: AppDef[] = [
  { id: 'orchestrator', label: 'Orchestrator', icon: 'icon_orchestrator.png', backendPort: 8060, frontendPort: 3000, x: 365, y: 8,   color: '#7C3AED' },
  { id: 'explorer',         label: 'Dataset Explorer',      icon: 'icon_dataset_explorer.png',       backendPort: 8001, frontendPort: 5174, x: 40,  y: 150, color: '#0891B2', supportsNativeMount: true },
  { id: 'annotation',   label: 'Annotation',    icon: 'icon_annotation.png',  backendPort: 8000, frontendPort: 5173, x: 240, y: 150, color: '#2563EB', supportsNativeMount: true },
  { id: 'optuna',       label: 'Optuna',        icon: 'icon_optuna.png',     backendPort: 8063, frontendPort: 3003, x: 440, y: 150, color: '#DC2626' },
  { id: 'training',     label: 'Training',      icon: 'icon_training.png',   backendPort: 8064, frontendPort: 5176, x: 640, y: 150, color: '#DB2777' },
  { id: 'inference',    label: 'Inference',     icon: 'icon_inference.png',  backendPort: 8065, frontendPort: 5177, x: 640, y: 298, color: '#0EA5E9' },
  { id: 'mlflow',       label: 'MLflow',        icon: 'icon_mlflow.png',     backendPort: 8062, frontendPort: 3001, x: 390, y: 298, color: '#D97706' },
  { id: 'dvc',          label: 'DVC',           icon: 'icon_dvc.png',        backendPort: 8061, frontendPort: 3002, x: 140, y: 298, color: '#059669' },
]

export function findApp(id: string): AppDef | undefined {
  return APPS.find((a) => a.id === id)
}
