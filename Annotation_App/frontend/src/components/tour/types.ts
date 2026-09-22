// ============================================================
// components/tour/types.ts
// Types du moteur de tour guide generique (voir index.ts pour le
// mode d'emploi et le portage vers une autre app).
// ============================================================

export interface TourRuntimeContext {
  navigate?: (path: string) => void
  [key: string]: unknown
}

export type TourPlacement = 'top' | 'bottom' | 'left' | 'right' | 'center' | 'auto'

export interface TourStep {
  id: string
  // Titre court de l'etape.
  title: string
  // Corps du texte : une chaine, ou plusieurs paragraphes.
  body: string | string[]
  // Chapitre affiche au-dessus du titre (regroupe les etapes en phases).
  chapter?: string
  // Encart "a vous de jouer" : action que l'UTILISATEUR doit faire lui-meme.
  hint?: string
  // Cible a mettre en surbrillance. Absente = popup centree, page assombrie.
  target?: { selector: string }
  // Cibles SECONDAIRES : simple anneau orange, sans trou dans le fond sombre.
  // Pour une etape qui parle de deux zones a la fois (ex : la barre de zoom
  // ET le canvas). Ignorees si introuvables.
  alsoTargets?: { selector: string }[]
  placement?: TourPlacement
  spotlightPadding?: number
  // Libelle du bouton d'avancement ("Suivant" par defaut, "Fait" pour une
  // etape ou l'utilisateur agit lui-meme).
  nextLabel?: string
  // Delai max d'attente de la cible avant d'afficher "element introuvable".
  waitTimeoutMs?: number
  // Prepare l'etape (navigation, ouverture de modal, remplissage d'un champ...).
  // Si elle renvoie une promesse, le bouton d'avancement reste desactive
  // pendant son execution. N'a pas besoin d'attendre que la cible existe :
  // useTourTarget s'en charge.
  beforeShow?: (ctx: TourRuntimeContext) => void | Promise<void>
  // Executee au clic sur le bouton d'avancement, AVANT de passer a l'etape
  // suivante (ex : cliquer reellement le bouton mis en surbrillance).
  onNext?: (ctx: TourRuntimeContext) => void | Promise<void>
  // Nettoyage quand on quitte l'etape (ex: refermer une modal ouverte par beforeShow).
  afterHide?: (ctx: TourRuntimeContext) => void | Promise<void>
  // Tant que False, le bouton d'avancement reste desactive (l'etape attend
  // une action reelle de l'utilisateur). Sonde toutes les 300 ms.
  canAdvance?: (ctx: TourRuntimeContext) => boolean
  // Message affiche quand canAdvance renvoie False.
  waitingLabel?: string
}

export interface TourOptions {
  // Appelee quand le tour atteint la fin de la derniere etape.
  onFinish?: (ctx: TourRuntimeContext) => void
  // Appelee a chaque sortie du tour, abandon compris (apres onFinish).
  onExit?: (ctx: TourRuntimeContext) => void
}
