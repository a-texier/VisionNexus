// ============================================================
// i18n/translate.ts
// Traduction FR -> EN a l'affichage. Le francais reste la source de
// verite dans le code : on enveloppe le texte francais existant avec
// t(...) et ce module fournit la variante anglaise. EN est la langue
// par defaut.
//
// Resolution de la langue, par ordre de priorite :
//   1. ?lang=en|fr dans l'URL : impose par VisionNexus au lancement.
//   2. Langue persistee dans les settings du workspace (repli hors
//      lanceur, cf. initWorkspaceLanguage plus bas).
//   3. Preference locale (localStorage), pour une reactivite immediate
//      avant que le fetch des settings du workspace ne resolve.
//   4. Anglais par defaut.
// ============================================================

export type Lang = 'en' | 'fr'

const STORAGE_KEY = 'cv-ui-language'
const SUPPORTED: readonly Lang[] = ['en', 'fr']

function isLang(value: string | null | undefined): value is Lang {
  return value != null && (SUPPORTED as readonly string[]).includes(value)
}

function readQueryLang(): Lang | null {
  if (typeof window === 'undefined') return null
  try {
    const value = new URLSearchParams(window.location.search).get('lang')
    return isLang(value) ? value : null
  } catch { return null }
}

function readStoredLang(): Lang | null {
  if (typeof window === 'undefined') return null
  try {
    const value = window.localStorage.getItem(STORAGE_KEY)
    return isLang(value) ? value : null
  } catch { return null }
}

const desktopPiloted = readQueryLang() !== null

let currentLang: Lang = readQueryLang() ?? readStoredLang() ?? 'en'
const listeners = new Set<(lang: Lang) => void>()

export function isDesktopPiloted(): boolean {
  return desktopPiloted
}

export function getLang(): Lang {
  return currentLang
}

export function setLang(lang: Lang): void {
  if (lang === currentLang) return
  currentLang = lang
  try { window.localStorage.setItem(STORAGE_KEY, lang) } catch { /* stockage indisponible */ }
  listeners.forEach((listener) => listener(lang))
}

export function subscribeLang(listener: (lang: Lang) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * A appeler une fois au demarrage (hors mode pilote par VisionNexus) :
 * recupere la langue persistee dans les settings du workspace et l'applique.
 */
export async function initWorkspaceLanguage(fetchSettingsLang: () => Promise<Lang | null | undefined>): Promise<void> {
  if (desktopPiloted) return
  try {
    const fromWorkspace = await fetchSettingsLang()
    if (isLang(fromWorkspace)) setLang(fromWorkspace)
  } catch {
    // Pas de backend joignable au boot : repli localStorage/anglais.
  }
}

/**
 * A appeler dans le onClick du bouton FR/EN : persiste dans les settings du
 * workspace UNIQUEMENT hors mode pilote (sinon ecraserait le reglage
 * VisionNexus au prochain lancement).
 */
export function setLangAndMaybePersist(lang: Lang, persistToWorkspace: (lang: Lang) => void): void {
  setLang(lang)
  if (!desktopPiloted) persistToWorkspace(lang)
}

const EXACT_EN: Record<string, string> = {
  'média · YOLO · tracking': 'media · YOLO · tracking',
  'Inférence': 'Inference',
  'Évaluation': 'Evaluation',
  'Config YAML': 'YAML Config',
  'Entrées': 'Inputs',
  'Source image, vidéo ou dossier': 'Image, video or folder source',
  'Lire le média': 'Read media',
  'Fichier de poids': 'Weights file',
  'Moteur': 'Engine',
  'Architecture': 'Architecture',
  'Confiance': 'Confidence',
  'NMS IoU': 'NMS IoU',
  'Inférence pure': 'Pure inference',
  'YOLO uniquement': 'YOLO only',
  'Multi-objet': 'Multi-object',
  'YOLO + tracker optionnel': 'YOLO + optional tracker',
  'SOT par clic': 'Click SOT',
  'YOLO initialise CSRT': 'YOLO initializes CSRT',
  'Tracker': 'Tracker',
  'Aucun': 'None',
  'ByteTrack': 'ByteTrack',
  'Indique une source puis clique « Lire le média ».': 'Enter a source then click "Read media".',
  'Traitement…': 'Processing...',
  'Lancer': 'Run',
  'frames': 'frames',
  'fps global': 'overall fps',
  'détecteur': 'detector',
  'tracker': 'tracker',
  'Évaluation détection': 'Detection evaluation',
  'Validation YOLO sur le split ': 'YOLO validation on the ',
  ', avec mAP50, mAP50–95, PR, F1 et matrice de confusion.': ' split, with mAP50, mAP50-95, PR, F1 and confusion matrix.',
  'data.yaml': 'data.yaml',
  'Évaluation…': 'Evaluating...',
  'Évaluer': 'Evaluate',
  'mAP50': 'mAP50',
  'mAP50–95': 'mAP50-95',
  'images': 'images',
  'fps': 'fps',
  'Configuration YAML': 'YAML configuration',
  "Cette copie est enregistrée dans le workspace utilisateur. Après enregistrement, ses valeurs sont appliquées aux prochains runs lancés depuis cette interface.":
    "This copy is saved in the user workspace. After saving, its values are applied to the next runs started from this interface.",
  'Enregistrer et appliquer': 'Save and apply',
}

const PHRASE_EN: ReadonlyArray<readonly [string, string]> = []

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
