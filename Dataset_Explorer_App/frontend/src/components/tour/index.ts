// ============================================================
// components/tour/index.ts
// Moteur de tour guide generique -- 100% portable (React seul, aucune
// dependance a zustand/lucide/une version de Tailwind particuliere).
//
// Checklist pour reutiliser ce dossier dans une autre app de la suite :
//   1. Copier ce dossier tel quel dans src/components/tour/ de l'app cible.
//   2. Ecrire un fichier de steps propre a cette app (voir
//      components/help/annotationTourSteps.ts pour l'exemple d'AnnotationApp) :
//      liste de TourStep avec id/title/body/target/beforeShow/onNext/afterHide.
//   3. Ajouter un attribut data-tour="..." sur les elements DOM cibles par
//      ces steps (additif, aucune restructuration necessaire).
//   4. Monter <TourProvider> autour de la racine (au-dessus du routeur s'il
//      y en a un) et rendre <TourOverlay/> a cote, pour que le tour survive
//      a la navigation entre pages.
//   5. Brancher un bouton d'entree -- <TourLaunchButton/> fait deja le halo
//      "jamais lance" -- qui appelle useTour().start(steps, ctx, options) avec
//      ctx.navigate fourni par le routeur de cette app (ou omis si l'app n'en
//      a pas). Persister soi-meme le "deja lance" dans les reglages de l'app.
//   6. Aucune nouvelle dependance npm requise.
//
// Utilitaires d'ecriture de steps : voir domUtils.ts (clic simule, saisie
// dans un input controle par React, attente d'une condition).
// ============================================================

export { TourProvider } from './TourProvider'
export { useTour } from './TourContext'
export { TourOverlay } from './TourOverlay'
export { TourLaunchButton } from './TourLaunchButton'
export {
  clickEnabledWhenReady, clickWhenReady, isDisabled, setReactInputValue, typeWhenReady,
  waitFor, waitForElement, sleep,
} from './domUtils'
export type { TourStep, TourRuntimeContext, TourPlacement, TourOptions } from './types'
