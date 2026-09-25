// ============================================================
// i18n/translate.ts
// Traduction FR -> EN a l'affichage. Le francais reste la source de
// verite dans le code (comme dans FrameViewer/frameviewer/ui/i18n.py) :
// on n'introduit pas de cles semantiques, on enveloppe le texte francais
// existant avec t(...) et ce module fournit la variante anglaise.
//
// Resolution de la langue, par ordre de priorite :
//   1. Parametre ?lang=en|fr dans l'URL : injecte par VisionNexus au
//      lancement quand l'app est pilotee depuis le launcher desktop.
//   2. Preference locale sauvegardee par cette app (mode autonome/modulaire,
//      utile quand l'app tourne hors VisionNexus).
//   3. Anglais par defaut.
// ============================================================

export type Lang = 'en' | 'fr'

const STORAGE_KEY = 'cv-ui-language'
const SUPPORTED: readonly Lang[] = ['en', 'fr']

function isLang(value: string | null): value is Lang {
  return value !== null && (SUPPORTED as readonly string[]).includes(value)
}

function readQueryLang(): Lang | null {
  if (typeof window === 'undefined') return null
  try {
    const value = new URLSearchParams(window.location.search).get('lang')
    return isLang(value) ? value : null
  } catch {
    return null
  }
}

function readStoredLang(): Lang | null {
  if (typeof window === 'undefined') return null
  try {
    const value = window.localStorage.getItem(STORAGE_KEY)
    return isLang(value) ? value : null
  } catch {
    return null
  }
}

let currentLang: Lang = readQueryLang() ?? readStoredLang() ?? 'en'
const listeners = new Set<(lang: Lang) => void>()

export function getLang(): Lang {
  return currentLang
}

export function setLang(lang: Lang): void {
  if (lang === currentLang) return
  currentLang = lang
  try {
    window.localStorage.setItem(STORAGE_KEY, lang)
  } catch {
    // Stockage indisponible (navigation privee) : la preference ne persiste
    // pas entre sessions mais le changement s'applique quand meme.
  }
  listeners.forEach((listener) => listener(lang))
}

export function subscribeLang(listener: (lang: Lang) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// Dictionnaire de correspondance exacte FR -> EN, complete au fil de la
// couverture de l'app. Une chaine absente du dictionnaire reste affichee
// en francais meme en mode EN (degradation silencieuse, jamais de texte
// casse ou de cle brute visible).
const EXACT_EN: Record<string, string> = {
  // App.tsx / nav
  'Historique': 'History',

  // TrainingPage.tsx
  'Entrainement': 'Training',
  'Poids des pertes': 'Loss weights',
  'Entrainement ': 'Training ',
  'mode orchestrateur': 'orchestrator mode',
  'mode solo': 'solo mode',
  'Modele': 'Model',
  'Moteur': 'Engine',
  'indisponible : ': 'unavailable: ',
  "Les poids produits ne se rechargent qu'avec le moteur qui les a crees.": 'Weights can only be reloaded by the engine that produced them.',
  'Parametres ignores par ce moteur : ': 'Parameters ignored by this engine: ',
  'vide = poids pre-entraines': 'empty = pretrained weights',
  'Taille image': 'Image size',
  'Pertes': 'Losses',
  'Taille': 'Size',
  'Modele : ': 'Model: ',
  'Poids de depart (optionnel)': 'Starting weights (optional)',
  'vide = entrainement depuis zero': 'empty = train from scratch',
  'Dataset YOLO': 'YOLO Dataset',
  'Chemin data.yaml': 'data.yaml path',
  'Nom du dataset (optionnel)': 'Dataset name (optional)',
  'Mode orchestrateur — chemin fourni automatiquement.': 'Orchestrator mode - path provided automatically.',
  'En cours...': 'Running...',
  'Lancer': 'Start',
  'Progression': 'Progress',
  'Termine': 'Done',
  'Erreur': 'Error',
  'En cours': 'Running',
  'Arrete': 'Stopped',
  'Modele sauvegarde :': 'Model saved:',
  'mAP50 : ': 'mAP50: ',
  'mAP50-95 : ': 'mAP50-95: ',
  'Hyperparametres': 'Hyperparameters',
  'Sans mosaic/mixup (fin, ép.)': 'No mosaic/mixup (final, ep.)',
  'Chemin data.yaml requis': 'data.yaml path required',
  'Run demarre : ': 'Run started: ',
  'Erreur demarrage': 'Start error',
  'Run arrete': 'Run stopped',

  // Libelles des catalogues moteur (groupes et champs du formulaire)
  'Optimiseur': 'Optimizer',
  'Intervalle eval (ép.)': 'Eval interval (ep.)',
  'Intervalle log (iter.)': 'Log interval (iter.)',
  'LR par image': 'LR per image',
  'LR min (ratio)': 'Min LR (ratio)',
  'Proba HSV jitter': 'HSV jitter prob.',
  'Proba flip': 'Flip prob.',
  'Proba mosaic': 'Mosaic prob.',
  'Proba mixup': 'Mixup prob.',
  'Mixup active': 'Mixup enabled',
  'Sans mosaic (fin, ép.)': 'No mosaic (final, ep.)',
  'LR initial': 'Initial LR',
  'LR final (ratio)': 'Final LR (ratio)',
  'Poids box': 'Box weight',
  'Poids cls': 'Cls weight',
  'Poids dfl': 'DFL weight',
  'HSV teinte': 'HSV hue',
  'HSV valeur': 'HSV value',
  'Echelle': 'Scale',
  'Proba flip vertical': 'Vertical flip prob.',
  'Proba flip horizontal': 'Horizontal flip prob.',
  'Proba copy-paste': 'Copy-paste prob.',
  'Proba erasing': 'Erasing prob.',

  // RunsPage.tsx - AnalysisGallery
  'Matrice de confusion': 'Confusion matrix',
  "Synthèse de l'entraînement": 'Training summary',
  'pertes et métriques par epoch': 'losses and metrics per epoch',
  'vrais / faux positifs par classe': 'true / false positives per class',
  'Courbes PR / P / R / F1': 'PR / P / R / F1 curves',
  'précision-rappel (≈ ROC détection), F1 vs seuil': 'precision-recall (approx. detection ROC), F1 vs threshold',
  'Distribution des labels': 'Label distribution',
  'histogramme classes + nuage largeur/hauteur des boîtes': 'class histogram + box width/height scatter',
  "Batches d'entraînement (augmentés)": 'Training batches (augmented)',
  'mosaic/mixup/HSV/flip appliqués, tel que vu par le réseau': 'mosaic/mixup/HSV/flip applied, as seen by the network',
  "Chargement des plots d'analyse…": 'Loading analysis plots...',
  "Aucun plot d'analyse (run non terminé ou plots désactivés).": 'No analysis plot (run not finished or plots disabled).',
  'Validation — vérité terrain': 'Validation - ground truth',
  'échantillon val_batch0_labels.jpg': 'sample val_batch0_labels.jpg',
  'Validation — prédictions': 'Validation - predictions',
  'val_batch0_pred.jpg, régénéré à chaque évaluation': 'val_batch0_pred.jpg, regenerated on every evaluation',

  // RunsPage.tsx - InferenceCasesView
  'Analyser best / worst cases (inférence sur le set de validation)': 'Analyze best / worst cases (inference on the validation set)',
  'Inférence en cours sur les images de validation…': 'Inference in progress on validation images...',
  'Erreur : ': 'Error: ',
  'inférence impossible': 'inference failed',
  'images évaluées': 'images evaluated',
  'Meilleurs cas (détections nettes, haute confiance)': 'Best cases (clean detections, high confidence)',
  'Pires cas (rien détecté / faible confiance)': 'Worst cases (nothing detected / low confidence)',

  // RunsPage.tsx - RunCurves
  'Évolution mAP par epoch': 'mAP evolution per epoch',
  'Pertes (train)': 'Losses (train)',

  // RunsPage.tsx - STATUS_META
  'En attente': 'Pending',
  'Terminé': 'Done',
  'Arrêté': 'Stopped',

  // RunsPage.tsx - RunDetail
  'Durée: ': 'Duration: ',
  'Analyse du modèle': 'Model analysis',
  'Inférence — meilleurs / pires cas': 'Inference - best / worst cases',
  'Meilleur modèle': 'Best model',
  'Hyperparamètres': 'Hyperparameters',
  'Créé : ': 'Created: ',
  'Démarré : ': 'Started: ',
  'Terminé : ': 'Finished: ',

  // RunsPage.tsx - main list
  'Actualiser': 'Refresh',
  "Aucun run pour l'instant": 'No runs yet',
  "Lancez un entraînement depuis l'onglet Training": 'Start a training run from the Training tab',
  'Modèle': 'Model',
  'Durée': 'Duration',
  'Créé': 'Created',
  'Supprimer': 'Delete',
  'Supprimer le run "': 'Delete run "',
  '" ?': '"?',
  'Run supprimé': 'Run deleted',
  'Erreur suppression': 'Deletion error',
}

const PHRASE_EN: ReadonlyArray<readonly [string, string]> = [
  // Fallback pour les chaines construites dynamiquement (concatenation,
  // template literals avec variables). Paires de sous-chaines seulement.
]

export function t(fr: string): string {
  if (currentLang !== 'en' || !fr) return fr
  const exact = EXACT_EN[fr]
  if (exact !== undefined) return exact
  const trimmed = fr.trim()
  if (trimmed !== fr) {
    const exactTrimmed = EXACT_EN[trimmed]
    if (exactTrimmed !== undefined) {
      const start = fr.indexOf(trimmed)
      return fr.slice(0, start) + exactTrimmed + fr.slice(start + trimmed.length)
    }
  }
  let out = fr
  for (const [source, target] of PHRASE_EN) {
    if (out.includes(source)) out = out.split(source).join(target)
  }
  return out
}

// ── Pilotage depuis VisionNexus vs autonome ─────────────────────────────────
// Quand l'app est lancee par le launcher, ?lang= est la source de verite et
// rien n'est lu ni ecrit dans le workspace. Hors lanceur (navigateur, dev),
// la langue se lit/ecrit dans le settings.json du workspace via le backend.

const desktopPiloted = readQueryLang() !== null

export function isDesktopPiloted(): boolean {
  return desktopPiloted
}

export async function initWorkspaceLanguage(fetchSettingsLang: () => Promise<Lang | null | undefined>): Promise<void> {
  if (desktopPiloted) return
  try {
    const fromWorkspace = await fetchSettingsLang()
    if (isLang(fromWorkspace ?? null)) setLang(fromWorkspace as Lang)
  } catch {
    // Pas de backend joignable au boot : repli localStorage/anglais.
  }
}

export function setLangAndMaybePersist(lang: Lang, persistToWorkspace: (lang: Lang) => void): void {
  setLang(lang)
  if (!desktopPiloted) persistToWorkspace(lang)
}
