// ============================================================
// components/help/annotationTourSteps.ts
// Script du tutoriel interactif d'AnnotationApp (moteur generique dans
// components/tour/). C'est la seule partie a reecrire pour reutiliser le
// moteur dans une autre app -- voir components/tour/index.ts.
//
// Le tour cree lui-meme un projet demo "Template Cars Annotation" a partir
// des 10 images livrees avec la suite (data_tuto/ a la racine du depot,
// partage par tous les tutoriels), puis deroule le workflow complet : import,
// classe, bbox, propagation SAMURAI, nettoyage, export. Le projet reste
// supprimable comme n'importe quel autre.
// ============================================================

import { t } from '../../i18n/translate'
import { projectsAPI, samplesAPI } from '../../services/api'
import { useAnnotationStore } from '../../stores/annotationStore'
import { useProjectStore } from '../../stores/projectStore'
import { useUIStore } from '../../stores/uiStore'
import {
  clickEnabledWhenReady, clickWhenReady, setReactInputValue, sleep,
  typeWhenReady, waitFor,
} from '../tour/domUtils'
import type { TourRuntimeContext, TourStep } from '../tour/types'

// Cle de cet app dans les reglages de tutoriels de VisionNexus
// (tutorials.annotation) -- cf. utils/tutorialState.ts.
export const TUTORIAL_KEY = 'annotation'

// ---- Constantes du projet demo ----
export const TEMPLATE_PROJECT_NAME = 'Template Cars Annotation'
// Second projet du tutoriel : mode Image Random, annote uniquement par texte.
export const TEMPLATE2_PROJECT_NAME = 'Template Traffic Lights'
const TEMPLATE2_CLASS_NAME = 'traffic light'
const TEMPLATE_SAMPLE_ID = 'cars_10_frames'
const TEMPLATE_SEQUENCE_NAME = 'cars_10_frames'
const TEMPLATE_CLASS_NAME = 'voiture'
// 8 frames sur 10 : assez pour voir le suivi, assez court pour rester rapide
// meme sur un GPU modeste.
const TEMPLATE_END_FRAME = 8

export interface AnnotationTourContext extends TourRuntimeContext {
  navigate: (path: string) => void
  // Rempli par l'etape de creation, lu par toutes les etapes suivantes.
  projectId: number | null
  // Second projet (Image Random), cree au dernier chapitre.
  project2Id: number | null
  // Chemin serveur de la sequence d'exemple (resolu par le backend).
  samplePath: string | null
}

const findProjectByName = (name: string) =>
  useProjectStore.getState().projects.find((p) => p.name === name) ?? null

const annotationCount = () => useAnnotationStore.getState().annotations.length

const projectClasses = () => useProjectStore.getState().currentProject?.classes ?? []

const classExists = (name: string) =>
  projectClasses().some((c) => c.name.trim().toLowerCase() === name.trim().toLowerCase())

// Cibles de suivi cochees ET encore presentes sur la frame courante : le store
// garde les identifiants meme apres suppression d'une annotation, un compte brut
// donnerait donc une cible fantome.
const activeTargets = () => {
  const { trackingTargetIds, annotations } = useAnnotationStore.getState()
  return annotations.filter((a) => trackingTargetIds.has(a.id))
}

// Frame sur laquelle l'utilisateur a REELLEMENT dessine sa premiere boite. Les
// etapes de propagation y reviennent : la propagation part de la frame courante,
// et se retrouver ailleurs qu'a l'endroit annote grise le bouton sans explication.
let refFrameIndex = 0

const goToRefFrame = async (): Promise<void> => {
  const { frames, currentFrameIndex, setCurrentFrameIndex } = useProjectStore.getState()
  if (frames.length === 0 || currentFrameIndex === refFrameIndex) return
  setCurrentFrameIndex(refFrameIndex)
  // Laisse les annotations de cette frame revenir avant que l'etape ne juge
  // l'etat du panneau (bouton actif ou non).
  await sleep(500)
}

// Nombre d'annotations presentes sur la frame AVANT le chapitre multi-objets :
// le chapitre precedent en a deja laisse une, exiger ">= 2" laissait passer
// l'etape sans que l'utilisateur ait rien dessine. -1 = pas encore mesure.
let multiBaseline = -1

// Taches longues deja lancees par le tour : un aller-retour Precedent/Suivant
// ne doit pas relancer une propagation (elle creerait des pistes en double).
const launchedTasks = new Set<string>()

/**
 * Lance une tache longue et NE REND LA MAIN QU'A LA FIN. Le tour enchainait
 * auparavant sur un simple sleep : quand le bouton etait grise (aucune cible,
 * aucune annotation sur la frame), le clic ne faisait rien et l'etape suivante
 * commentait une timeline restee vide.
 *
 * `barSelector` designe la barre de progression en haut de l'ecran, qui vit
 * exactement le temps de la tache : c'est elle qui sert de temoin.
 */
const runLongTask = async (
  key: string,
  buttonSelector: string,
  barSelector: string,
  timeoutMs = 600000,
): Promise<void> => {
  const running = () => document.querySelector(barSelector) !== null
  if (launchedTasks.has(key)) return
  // Tache heritee (relance du tour, tache restauree au chargement de la page) :
  // la laisser finir avant de lancer la notre.
  if (running()) await waitFor(() => !running(), timeoutMs)
  if (!await clickEnabledWhenReady(buttonSelector, 15000)) return
  // Echec immediat (modele absent, erreur backend) : la barre n'apparait pas,
  // on rend la main au lieu de bloquer le tutoriel.
  if (!await waitFor(running, 12000)) return
  launchedTasks.add(key)
  await waitFor(() => !running(), timeoutMs)
  await sleep(600)
}

const runPropagation = (key: string): Promise<void> => runLongTask(
  key, '[data-tour="propagate-btn"]', '[data-tour="propagation-bar"]')

const propagationBusy = () =>
  document.querySelector('[data-tour="propagation-bar"]') !== null

// Zoom le canvas sur une annotation : l'anneau pointille d'une cible cochee
// est invisible quand la voiture fait 40 px a l'ecran.
const zoomOnAnnotation = (annotationId: number): void => {
  const ann = useAnnotationStore.getState().annotations.find((a) => a.id === annotationId)
  const frame = useProjectStore.getState().getCurrentFrame()
  if (!ann || !frame) return
  useUIStore.getState().zoomToAnnotation(
    ann.cx, ann.cy, ann.width, ann.height, frame.width, frame.height,
    window.innerWidth - 256 - 16, window.innerHeight - 80,
  )
}

// Le formulaire de creation de classe peut etre ferme (retour arriere dans le
// tour, ou creation deja validee) : on le rouvre avant d'ecrire dedans.
const ensureClassForm = async (): Promise<void> => {
  if (document.querySelector('[data-tour="class-name-input"]')) return
  await clickWhenReady('[data-tour="add-class-btn"]', 2000)
  await waitFor(() => document.querySelector('[data-tour="class-name-input"]') !== null, 2000)
}

// Cree le projet mis en forme par les etapes precedentes, sauf s'il existe
// deja (relance du tutoriel, ou aller-retour Precedent/Suivant).
const submitProjectOnce = async (name: string): Promise<number | null> => {
  const existing = findProjectByName(name)
  if (existing) {
    await clickWhenReady('[data-tour="create-project-cancel"]', 1500)
    return existing.id
  }
  await clickWhenReady('[data-tour="create-project-submit"]')
  await waitFor(() => findProjectByName(name) !== null, 15000)
  const created = findProjectByName(name)
  if (!created) return null
  if (!created.is_template) {
    // Marque le projet comme demo : carte orange a l'accueil, et le tutoriel
    // le retrouve a la prochaine execution.
    try {
      await projectsAPI.update(created.id, { is_template: true })
      await useProjectStore.getState().fetchProjects()
    } catch { /* cosmetique : un echec ne bloque pas le tour */ }
  }
  return created.id
}

// Dit la verite quand les images d'exemple ne sont pas la (installation
// partielle, dossier data_tuto absent du deploiement) : sans ca l'etape
// annoncerait un champ prerempli qui ne l'est pas.
const MISSING_SAMPLE_NOTE =
  "Les 10 images d'exemple sont introuvables sur cette installation (dossier data_tuto"
  + " a la racine de Computer_Vision_App) : saisissez vous-meme un chemin, ou utilisez"
  + " le bouton Serveur pour parcourir les dossiers."

export const buildAnnotationTourSteps = (): TourStep[] => {
  const steps: TourStep[] = [
  // ============================================================
  // Bienvenue
  // ============================================================
  {
    id: 'welcome',
    chapter: t('Bienvenue'),
    title: t('Le tour complet en une dizaine de minutes'),
    body: [
      t("Ce tutoriel construit avec vous un vrai projet, de la page d'accueil jusqu'a l'export : "
      + "creation du projet, import d'images, classe d'objet, premiere boite, propagation automatique, nettoyage, export."),
      t("Il utilise les 10 images de circulation livrees avec l'application : rien a telecharger, rien a preparer."),
      t("Le projet s'appellera \"Template Cars Annotation\". Il est supprimable a tout moment depuis l'accueil (icone corbeille au survol de sa carte)."),
    ],
    hint: t("Echap ferme le tutoriel a tout moment. La page reste utilisable pendant le tour : vous pouvez cliquer et dessiner normalement."),
    placement: 'center',
    beforeShow: async (ctx) => {
      const c = ctx as AnnotationTourContext
      // Chemin de la sequence d'exemple TEL QUE VU PAR LE BACKEND (en session
      // SSH le frontend ne peut pas le deviner).
      try {
        const sample = await samplesAPI.get(TEMPLATE_SAMPLE_ID)
        c.samplePath = sample.exists ? sample.path : null
      } catch {
        c.samplePath = null
      }
      if (!c.samplePath) {
        const step = steps.find((s) => s.id === 'import-server-path')
        const missingSampleNote = t(MISSING_SAMPLE_NOTE)
        if (step && Array.isArray(step.body) && !step.body.includes(missingSampleNote)) {
          step.body = [...step.body.slice(0, -1), missingSampleNote]
        }
      }
      multiBaseline = -1
      refFrameIndex = 0
      launchedTasks.clear()
      c.navigate('/')
    },
  },

  {
    id: 'workspace-badge',
    chapter: t('Bienvenue'),
    title: t('Ou vivent vos donnees'),
    body: [
      t("En bas a gauche : votre identifiant, et le bouton Workspace. Le workspace est le dossier qui contient TOUT -- projets, images importees, annotations, reglages. Un utilisateur, un workspace."),
      t("Ce menu ouvre le dossier, copie son chemin serveur, et quand l'application tourne sur une VM, traduit ce chemin en chemin reseau Windows."),
      t("Les deux icones a cote listent les utilisateurs connectes et les workspaces recents."),
    ],
    target: { selector: '[data-tour="workspace-badge"]' },
    placement: 'right',
    waitTimeoutMs: 8000,
    beforeShow: (ctx) => { (ctx as AnnotationTourContext).navigate('/') },
  },

  // ============================================================
  // 1. Creer le projet
  // ============================================================
  {
    id: 'new-project-btn',
    chapter: t('1. Creer le projet'),
    title: t('Nouveau projet'),
    body: [
      t("Tout part d'ici. Un projet regroupe ses images, ses classes d'objets, ses annotations et ses pistes de suivi, dans son propre dossier du workspace."),
      t("Cliquez sur Suivant : le tutoriel ouvre la fenetre de creation pour vous."),
    ],
    target: { selector: '[data-tour="new-project-btn"]' },
    placement: 'bottom',
    beforeShow: (ctx) => { (ctx as AnnotationTourContext).navigate('/') },
    onNext: async () => { await clickWhenReady('[data-tour="new-project-btn"]') },
  },
  {
    id: 'create-project-name',
    chapter: t('1. Creer le projet'),
    title: t('Le nom du projet'),
    body: [
      t("Le nom est repris partout : carte d'accueil, en-tete de la page d'annotation, et dossier de sortie a l'export. Choisissez-le parlant."),
      t('Le tutoriel a saisi "Template Cars Annotation" pour vous.'),
    ],
    target: { selector: '[data-tour="create-project-name"]' },
    placement: 'right',
    beforeShow: async () => {
      if (!document.querySelector('[data-tour="create-project-name"]')) return
      await typeWhenReady('[data-tour="create-project-name"]', TEMPLATE_PROJECT_NAME)
    },
  },
  {
    id: 'create-project-type',
    chapter: t('1. Creer le projet'),
    title: t('Image Random ou Sequence Image ?'),
    body: [
      t("Image Random : des images independantes, sans ordre. Pas de timeline, pas de suivi -- pour un dataset de detection classique."),
      t("Sequence Image : des frames ordonnees (dossier d'images ou video). Debloque la timeline, les pistes de suivi et toute la propagation automatique."),
      t("Notre demo suit des voitures d'une frame a l'autre : c'est donc Sequence Image. Suivant selectionne ce type."),
    ],
    target: { selector: '[data-tour="create-project-type-video"]' },
    placement: 'right',
    onNext: async () => { await clickWhenReady('[data-tour="create-project-type-video"]') },
  },
  {
    id: 'create-project-submit',
    chapter: t('1. Creer le projet'),
    title: t('Creer'),
    body: [
      t("A la creation, l'application prepare le dossier du projet, son fichier de classes et son etat de session (frame courante, zoom, outil actif) -- tout est restaure au prochain lancement."),
      t("Suivant cree reellement le projet."),
    ],
    target: { selector: '[data-tour="create-project-submit"]' },
    placement: 'top',
    onNext: async (ctx) => {
      const c = ctx as AnnotationTourContext
      c.projectId = (await submitProjectOnce(TEMPLATE_PROJECT_NAME)) ?? c.projectId
    },
  },
  {
    id: 'project-card',
    chapter: t('1. Creer le projet'),
    title: t('Votre projet demo'),
    body: [
      t("La carte orange signale un projet cree par le tutoriel. Elle affiche la progression d'annotation, le detail par sequence, et se supprime par l'icone corbeille qui apparait au survol."),
      t("Suivant ouvre le projet."),
    ],
    target: { selector: '[data-tour="project-card-template"]' },
    placement: 'right',
    waitTimeoutMs: 10000,
    onNext: async (ctx) => {
      const c = ctx as AnnotationTourContext
      if (c.projectId) c.navigate(`/projects/${c.projectId}/annotate`)
      await waitFor(() => window.location.pathname.includes('/annotate'), 8000)
    },
  },

  // ============================================================
  // 2. Importer les images
  // ============================================================
  {
    id: 'import-btn',
    chapter: t('2. Importer les images'),
    title: t('Le projet est vide : importons des frames'),
    body: [
      t("Un projet peut contenir plusieurs sequences (dossiers d'images et videos melanges). Chaque import en cree une."),
      t("Suivant ouvre la fenetre d'import."),
    ],
    target: { selector: '[data-tour="import-btn"]' },
    placement: 'bottom',
    onNext: async () => { await clickWhenReady('[data-tour="import-btn"]') },
  },
  {
    id: 'import-server-path',
    chapter: t('2. Importer les images'),
    title: t('Chemin serveur ou glisser-deposer ?'),
    body: [
      t("Chemin serveur : l'application pose un lien symbolique vers les images la ou elles sont deja. Zero copie, demarrage immediat -- la bonne methode pour un gros dataset ou un disque monte sur la machine du backend."),
      t("Glisser-deposer : le navigateur televerse le contenu des fichiers (il ne peut jamais transmettre un chemin). Pratique pour quelques images locales, lourd au-dela."),
      t("Le tutoriel a saisi le chemin des 10 images d'exemple livrees avec l'application."),
    ],
    target: { selector: '[data-tour="import-server-path"]' },
    placement: 'bottom',
    beforeShow: async (ctx) => {
      const c = ctx as AnnotationTourContext
      // Modale fermee (retour arriere apres un import) ou images d'exemple
      // absentes : rien a remplir.
      if (!c.samplePath || !document.querySelector('[data-tour="import-server-path"]')) return
      await typeWhenReady('[data-tour="import-server-path"]', c.samplePath)
    },
  },
  {
    id: 'import-seq-name',
    chapter: t('2. Importer les images'),
    title: t('Nommer la sequence'),
    body: [
      t("Ce nom identifie la sequence dans le selecteur au-dessus de la timeline, et devient le sous-dossier YOLO ou le fichier .ver a l'export. Laisse vide, il reprend le nom du dossier source."),
      t("Plus bas, les options d'optimisation reglent la decimation des videos (1 frame sur N), la qualite JPEG et les liens symboliques."),
    ],
    target: { selector: '[data-tour="import-seq-name"]' },
    placement: 'bottom',
    beforeShow: async () => {
      if (!document.querySelector('[data-tour="import-seq-name"]')) return
      await typeWhenReady('[data-tour="import-seq-name"]', TEMPLATE_SEQUENCE_NAME)
    },
  },
  {
    id: 'import-submit',
    chapter: t('2. Importer les images'),
    title: t('Importer en tache de fond'),
    body: [
      t("L'import ne bloque pas : la fenetre se ferme et une barre de progression par sequence s'affiche en haut de l'ecran. Vous pouvez deja annoter les frames chargees."),
      t("Suivant lance l'import des 10 images."),
    ],
    target: { selector: '[data-tour="import-submit"]' },
    placement: 'top',
    onNext: async () => {
      // Relance du tutoriel : le projet demo a deja ses frames, un second
      // import creerait une sequence en double.
      if (useProjectStore.getState().frames.length > 0) {
        await clickWhenReady('[data-tour="import-modal-close"]', 1500)
        return
      }
      await clickWhenReady('[data-tour="import-submit"]')
      // L'import est serie et asynchrone : on attend que des frames existent.
      await waitFor(() => useProjectStore.getState().frames.length > 0, 60000)
      await sleep(400)
    },
  },

  // ============================================================
  // 3. Reperage de l'ecran
  // ============================================================
  {
    id: 'tour-left-panel',
    chapter: t("3. Reperage de l'ecran"),
    title: t('A gauche : le suivi (tracking)'),
    body: [
      t("Ce panneau porte tous les moteurs de propagation, un onglet chacun : SAMURAI (SAM2 + filtre de Kalman), Detect. (Grounding DINO / SAM3 / YOLO + appariement), Homogr. (XFeat/SIFT, camera mobile sur scene plane), Flux opt. (Lucas-Kanade, objet mobile devant camera fixe)."),
      t("Une piste (track) relie les boites d'un meme objet a travers les frames. C'est elle qui porte l'identite de l'objet a l'export."),
    ],
    target: { selector: '[data-tour="left-sidebar"]' },
    placement: 'right',
    waitTimeoutMs: 15000,
  },
  {
    id: 'tour-text-prompt',
    chapter: t("3. Reperage de l'ecran"),
    title: t('En haut : annoter par texte (Grounding DINO / SAM3)'),
    body: [
      t('Ce bouton ouvre un champ ou l\'on decrit ce qu\'on cherche en langage naturel : "voiture. personne. velo." Grounding DINO ou SAM3 detectent alors ces objets sans modele entraine sur votre dataset.'),
      t("Les seuils Box et Txt arbitrent rappel et precision : bas = plus de detections et plus de faux positifs. Un bouton Batch applique le prompt a une plage de frames entiere."),
      t("Attention : ces modeles ecrivent dans la classe active -- il faut donc avoir cree ET selectionne une classe avant, ce que nous faisons a l'etape suivante."),
    ],
    target: { selector: '[data-tour="text-prompt-btn"]' },
    placement: 'bottom',
  },
  {
    id: 'tour-right-panel',
    chapter: t("3. Reperage de l'ecran"),
    title: t('A droite : classes, annotations, aide'),
    body: [
      t("Classes gere le vocabulaire du projet. Annots liste les boites de la frame courante (suppression, NMS, rattachement a une piste). Aide rappelle les raccourcis."),
      t("La largeur du panneau se regle en glissant son bord gauche."),
    ],
    target: { selector: '[data-tour="right-panel"]' },
    placement: 'left',
  },
  {
    id: 'tour-timeline',
    chapter: t("3. Reperage de l'ecran"),
    title: t('En bas : la timeline'),
    body: [
      t("Une case par frame. Sa couleur dit si la frame est annotee, et le compteur combien d'objets elle porte. Cliquer une case y saute."),
      t("Juste au-dessus apparaitront les pistes, sous forme de blocs horizontaux couvrant les frames ou l'objet est suivi."),
    ],
    target: { selector: '[data-tour="timeline"]' },
    placement: 'top',
  },

  // ============================================================
  // 4. Creer une classe
  // ============================================================
  {
    id: 'tab-classes',
    chapter: t('4. Creer une classe'),
    title: t("Sans classe, pas d'annotation"),
    body: [
      t("Toute boite appartient a une classe. C'est la premiere chose a definir dans un nouveau projet."),
      t("AnnotationApp gere trois niveaux : classe (detection, obligatoire), sous-classe (reconnaissance), sous-sous-classe (identification). Exemple : voiture / berline / clio."),
    ],
    target: { selector: '[data-tour="tab-classes"]' },
    placement: 'left',
    beforeShow: async () => { await clickWhenReady('[data-tour="tab-classes"]') },
  },
  {
    id: 'add-class-btn',
    chapter: t('4. Creer une classe'),
    title: t('Ajouter une classe'),
    body: t("Suivant ouvre le formulaire de creation."),
    target: { selector: '[data-tour="add-class-btn"]' },
    placement: 'left',
    onNext: async () => { if (!classExists(TEMPLATE_CLASS_NAME)) await ensureClassForm() },
  },
  {
    id: 'class-name-input',
    chapter: t('4. Creer une classe'),
    title: t('Nom de la classe'),
    body: [
      t("Seul ce champ est obligatoire : il donne l'index de classe utilise a l'export YOLO. Les deux champs en dessous affinent la hierarchie et restent facultatifs."),
      t('Le tutoriel a saisi "voiture".'),
    ],
    target: { selector: '[data-tour="class-name-input"]' },
    placement: 'left',
    beforeShow: async () => {
      // La classe peut deja exister (retour arriere) : on n'ouvre le
      // formulaire que s'il y a encore quelque chose a creer.
      if (classExists(TEMPLATE_CLASS_NAME)) return
      await ensureClassForm()
      await typeWhenReady('[data-tour="class-name-input"]', TEMPLATE_CLASS_NAME)
    },
  },
  {
    id: 'class-color-input',
    chapter: t('4. Creer une classe'),
    title: t('La couleur de la classe'),
    body: t("Elle sert partout : contour des boites sur le canvas, pastilles de la timeline, blocs de pistes. Prenez des couleurs franchement differentes si vous avez plusieurs classes."),
    target: { selector: '[data-tour="class-color-input"]' },
    placement: 'left',
    beforeShow: async () => { if (!classExists(TEMPLATE_CLASS_NAME)) await ensureClassForm() },
  },
  {
    id: 'class-create-submit',
    chapter: t('4. Creer une classe'),
    title: t('Creer la classe'),
    body: t("Suivant valide la creation."),
    target: { selector: '[data-tour="class-create-submit"]' },
    placement: 'left',
    onNext: async () => {
      // Idempotent : un aller-retour Precedent/Suivant ne doit pas creer la
      // meme classe deux fois.
      if (classExists(TEMPLATE_CLASS_NAME)) {
        await clickWhenReady('[data-tour="class-cancel"]', 1000)
        return
      }
      await clickWhenReady('[data-tour="class-create-submit"]')
      await waitFor(() => classExists(TEMPLATE_CLASS_NAME), 8000)
      await waitFor(() => document.querySelector('[data-tour="class-row-first"]') !== null, 8000)
      await sleep(250)
    },
  },
  {
    id: 'class-row-first',
    chapter: t('4. Creer une classe'),
    title: t('Selectionner la classe active'),
    body: [
      t("Creer une classe ne suffit pas : il faut cliquer dessus pour la rendre ACTIVE (elle se surligne en bleu). Toute nouvelle boite -- dessinee a la main, produite par Grounding DINO, SAM3 ou une propagation -- recoit cette classe."),
      t("C'est l'oubli le plus frequent : sans classe active, les detections par texte refusent de se lancer."),
      t("Suivant selectionne la classe pour vous."),
    ],
    target: { selector: '[data-tour="class-row-first"]' },
    placement: 'left',
    onNext: async () => {
      if (useAnnotationStore.getState().activeClassId == null) {
        await clickWhenReady('[data-tour="class-row-first"]')
      }
    },
  },

  // ============================================================
  // 5. Annoter la premiere frame
  // ============================================================
  {
    id: 'frame-nav',
    chapter: t('5. Annoter la premiere frame'),
    title: t('Se placer sur la bonne frame'),
    body: [
      t("Le curseur parcourt la sequence, les fleches gauche/droite avancent d'une frame, et le champ \"aller a\" saute directement a un numero. Le selecteur a gauche bascule entre les sequences du projet."),
      t("Nous restons sur la frame 1 : c'est de la premiere frame que partira la propagation."),
    ],
    target: { selector: '[data-tour="frame-nav"]' },
    placement: 'top',
    beforeShow: () => {
      const { frames, setCurrentFrameIndex } = useProjectStore.getState()
      if (frames.length > 0) setCurrentFrameIndex(0)
    },
  },
  {
    id: 'canvas-nav',
    chapter: t('5. Annoter la premiere frame'),
    title: t('Se deplacer dans l\'image'),
    body: [
      t("Molette : zoom centre sur le curseur. Clic du milieu maintenu : deplacement (pan). Les commandes de zoom en haut a droite de la barre d'outils font la meme chose, et l'icone d'expansion recentre l'image."),
      t("Au-dela de 150 % de zoom, l'application sert automatiquement l'image pleine resolution au lieu de l'apercu reduit."),
    ],
    target: { selector: '[data-tour="zoom-controls"]' },
    // Le canvas est encadre en meme temps : l'etape parle des deux zones.
    alsoTargets: [{ selector: '[data-tour="canvas-area"]' }],
    placement: 'bottom',
    hint: t("Essayez la molette sur l'image, puis l'icone d'expansion pour recentrer."),
  },
  {
    id: 'tool-bbox',
    chapter: t('5. Annoter la premiere frame'),
    title: t("L'outil rectangle"),
    body: [
      t("Les outils, de gauche a droite : Selection (A) pour deplacer et redimensionner, Rectangle (R) pour une boite, Polygone (P) pour un contour, SAM Point (S) pour segmenter d'un clic, SAM Auto pour segmenter toute la frame."),
      t("Suivant active l'outil Rectangle."),
    ],
    target: { selector: '[data-tour="tool-bbox"]' },
    placement: 'bottom',
    onNext: async () => {
      useAnnotationStore.getState().setActiveTool('bbox')
      await clickWhenReady('[data-tour="tool-bbox"]', 1500)
    },
  },
  {
    id: 'draw-bbox',
    chapter: t('5. Annoter la premiere frame'),
    title: t('A vous : dessinez la premiere boite'),
    body: [
      t("Cliquez-glissez sur une voiture bien visible de la scene pour l'entourer. Une boite trop large fait deriver le suivi : serrez-la sur l'objet."),
      t("La boite est enregistree tout de suite, dans la classe active. Ctrl+Z annule, la touche Suppr efface la selection."),
      t("Dessinez sur la frame affichee, celle que montre le curseur encadre en bas : c'est de CETTE frame que partira la propagation."),
    ],
    hint: t("Dessinez une boite autour d'une voiture, puis cliquez sur Fait."),
    target: { selector: '[data-tour="canvas-area"]' },
    alsoTargets: [{ selector: '[data-tour="frame-nav"]' }],
    placement: 'left',
    spotlightPadding: 0,
    nextLabel: t('Fait'),
    waitingLabel: t("En attente de votre premiere boite sur la frame affichee..."),
    canAdvance: () => annotationCount() > 0,
    beforeShow: async () => {
      const { frames, setCurrentFrameIndex } = useProjectStore.getState()
      if (frames.length > 0) setCurrentFrameIndex(0)
      await sleep(300)
    },
    onNext: () => {
      // La frame reellement annotee, pas celle qu'on avait prevue : c'est elle
      // que les etapes de propagation devront retrouver.
      refFrameIndex = useProjectStore.getState().currentFrameIndex
    },
  },

  // ============================================================
  // 6. Propager avec SAMURAI
  // ============================================================
  {
    id: 'tab-samurai',
    chapter: t('6. Propager le suivi'),
    title: t('SAMURAI : une boite suffit'),
    body: [
      t("Le principe du logiciel est la : vous annotez UNE frame, le modele propage sur les suivantes. SAMURAI est SAM2 augmente d'un filtre de Kalman, qui arbitre entre les masques candidats en retenant celui qui colle au mouvement -- pas seulement au score."),
      t("Il ne suit qu'une cible a la fois. Pour plusieurs objets : Auto bascule sur SAM2 multi-objets (une passe, rapide), ou SAMURAI / objet fait une passe Kalman par cible (meilleur, N fois plus lent)."),
    ],
    target: { selector: '[data-tour="tab-samurai"]' },
    placement: 'right',
    beforeShow: async () => {
      await goToRefFrame()
      useUIStore.getState().setSidebarTab('tracks')
      await clickWhenReady('[data-tour="tab-samurai"]')
    },
  },
  {
    id: 'samurai-targets',
    chapter: t('6. Propager le suivi'),
    title: t('Choisir la cible a suivre'),
    body: [
      t("La liste reprend les boites de la frame courante. Cochez celle qui servira de point de depart : c'est elle qui sert de prompt au modele."),
      t("Deuxieme facon de cocher, souvent plus sure quand il y a du monde a l'ecran : DOUBLE-CLIQUER la boite sur le canvas. Les deux restent synchronises."),
      t("Suivant coche votre boite."),
    ],
    target: { selector: '[data-tour="samurai-targets"]' },
    alsoTargets: [{ selector: '[data-tour="frame-nav"]' }],
    placement: 'right',
    beforeShow: async () => { await goToRefFrame() },
    onNext: async () => {
      // Selection par le store, pas par le DOM : une seule cible, quelles que
      // soient les cases laissees cochees par un aller-retour dans le tour.
      const first = useAnnotationStore.getState().annotations[0]
      if (first) useAnnotationStore.getState().setTrackingTargets([first.id])
      await sleep(150)
    },
  },
  {
    id: 'samurai-end-frame',
    chapter: t('6. Propager le suivi'),
    title: t('Jusqu\'ou propager'),
    body: [
      t("Ce champ fixe la derniere frame traitee. Il peut etre INFERIEUR a la frame courante : la propagation remonte alors le temps, utile quand l'objet est deja entre en scene."),
      `${t('Le tutoriel a mis ')}${TEMPLATE_END_FRAME}${t(' : huit frames sur les dix importees, assez pour voir le suivi travailler sans monopoliser le GPU.')}`,
    ],
    target: { selector: '[data-tour="samurai-end-frame"]' },
    placement: 'right',
    beforeShow: async () => {
      const input = document.querySelector<HTMLInputElement>('[data-tour="samurai-end-frame"] input')
      setReactInputValue(input, String(TEMPLATE_END_FRAME))
      await sleep(150)
    },
  },
  {
    id: 'samurai-gpu-gauge',
    chapter: t('6. Propager le suivi'),
    title: t('Le nombre de frames pese sur le GPU'),
    body: [
      t("En mode GPU rapide, SAM2 garde toutes les frames de la plage en memoire video : la jauge compare la plage demandee a la capacite estimee de votre carte. Au rouge, c'est le risque de saturation memoire."),
      t("Trois leviers quand la plage est trop longue : la reduire, decimer a l'import (1 frame sur N), ou activer l'offload CPU dans les parametres -- les frames passent alors en RAM, sans limite memoire mais 1,5 a 3 fois plus lent."),
    ],
    target: { selector: '[data-tour="samurai-gpu-gauge"]' },
    placement: 'right',
    waitTimeoutMs: 4000,
  },
  {
    id: 'propagate-btn',
    chapter: t('6. Propager le suivi'),
    title: t('Lancer la propagation'),
    body: [
      t("Suivant lance le suivi ET attend sa fin : le tutoriel ne reprend qu'une fois la propagation terminee."),
      t("Une barre de progression apparait en haut de l'ecran avec un bouton d'arret carre rouge : la tache reste interruptible a tout instant. Pendant le calcul, le canvas suit la frame en cours et la timeline se remplit en direct (reglable dans Parametres > Interface)."),
      t("Si SAMURAI n'est pas installe, le bouton bascule automatiquement sur SAM2 standard : le resultat est un peu moins robuste en occlusion, le workflow est identique."),
    ],
    target: { selector: '[data-tour="propagate-btn"]' },
    alsoTargets: [{ selector: '[data-tour="frame-nav"]' }],
    placement: 'right',
    beforeShow: async () => { await goToRefFrame() },
    canAdvance: () => annotationCount() > 0 && activeTargets().length > 0 && !propagationBusy(),
    waitingLabel: t("Revenez sur la frame que vous avez annotee (curseur encadre en bas) et cochez une cible : le bouton reste grise sans cela."),
    onNext: async () => { await runPropagation('samurai') },
  },
  {
    id: 'samurai-review',
    chapter: t('6. Propager le suivi'),
    title: t("Regardez le resultat avant d'aller plus loin"),
    body: [
      t("La propagation est terminee. Parcourez les frames avec le curseur, ou les fleches du clavier, et regardez la boite suivre la voiture toute seule."),
      t("C'est le moment de juger : la boite colle-t-elle a l'objet ? derive-t-elle ? saute-t-elle sur un vehicule voisin ? Une passe ratee se voit en trois secondes ici, et se refait pour presque rien."),
      t("Si les frames suivantes sont restees VIDES, la propagation n'a pas demarre (modele indisponible, ou bouton refuse) : revenez d'une etape avec Precedent et relancez-la."),
    ],
    hint: t("Faites defiler les frames et verifiez le suivi, puis cliquez sur Suivant."),
    target: { selector: '[data-tour="canvas-area"]' },
    alsoTargets: [{ selector: '[data-tour="frame-nav"]' }],
    placement: 'left',
    spotlightPadding: 0,
    beforeShow: () => {
      const { frames, setCurrentFrameIndex } = useProjectStore.getState()
      if (frames.length > 0) setCurrentFrameIndex(0)
      useUIStore.getState().resetZoom()
    },
  },
  {
    id: 'timeline-tracks',
    chapter: t('6. Propager le suivi'),
    title: t('La zone des pistes'),
    body: [
      t("Chaque ligne est une piste, chaque bloc colore la plage de frames ou l'objet est suivi. C'est la representation directe de ce que la propagation vient d'ecrire."),
      t("Cliquer un bloc le selectionne et saute a son debut ; double-cliquer va a sa fin ; cliquer la zone grise selectionne la piste entiere. La poignee horizontale au-dessus agrandit cette zone."),
    ],
    target: { selector: '[data-tour="timeline-tracks"]' },
    placement: 'top',
    waitTimeoutMs: 25000,
  },
  {
    id: 'timeline-cleanup',
    chapter: t('6. Propager le suivi'),
    title: t('Corriger ce que le modele a rate'),
    body: [
      t("Aucun suivi n'est parfait : il faut pouvoir effacer vite. Dans la timeline, Ctrl+clic ajoute ou retire une frame de la selection, Shift+clic selectionne toute une plage, Ctrl+A prend tout ; la touche Suppr vide alors les annotations des frames selectionnees."),
      t("Sur les pistes : un bloc selectionne, Suppr efface ce seul bloc ; une piste selectionnee, Suppr efface la piste entiere et ses annotations."),
      t("Et sur le canvas, l'outil Selection (A) permet de reprendre une boite a la main, ou de l'effacer avec Suppr."),
    ],
    target: { selector: '[data-tour="timeline"]' },
    placement: 'top',
    hint: t("Essayez : Ctrl+clic sur deux cases de la timeline, puis Suppr pour vider ces deux frames."),
  },

  // ============================================================
  // 7. Suivre deux objets a la fois
  // ============================================================
  {
    id: 'multi-intro',
    chapter: t('7. Suivre deux objets'),
    title: t('Et quand il y a plusieurs objets ?'),
    body: [
      t("Une seule cible, c'etait le cas facile. Dans une scene reelle il y en a plusieurs, et c'est la que le choix de la strategie compte."),
      t("On repart de la premiere frame et on y ajoute DEUX vehicules de plus. La boite du chapitre precedent reste : la frame en comptera donc trois, et c'est justement l'occasion de voir comment on designe precisement celles qu'on veut suivre."),
    ],
    hint: t("Dessinez deux nouvelles boites, sur deux vehicules encore libres, puis cliquez sur Fait."),
    target: { selector: '[data-tour="canvas-area"]' },
    alsoTargets: [{ selector: '[data-tour="tool-bbox"]' }],
    placement: 'left',
    spotlightPadding: 0,
    nextLabel: t('Fait'),
    waitingLabel: t('En attente de deux NOUVELLES boites sur cette frame...'),
    canAdvance: () => annotationCount() >= multiBaseline + 2,
    beforeShow: async () => {
      // Retour sur la frame de depart : les deux boites doivent partir de la
      // meme image pour que la comparaison avec la passe precedente parle.
      await goToRefFrame()
      useUIStore.getState().resetZoom()
      useAnnotationStore.getState().setActiveTool('bbox')
      await sleep(400)
      // Reference comptee APRES le retour sur la frame (les annotations viennent
      // d'etre rechargees), et UNE SEULE fois : un retour arriere sur cette
      // etape ne doit pas redemander deux boites de plus.
      if (multiBaseline < 0) multiBaseline = annotationCount()
    },
  },
  {
    id: 'multi-pick',
    chapter: t('7. Suivre deux objets'),
    title: t('Designer les deux cibles : double-clic sur le canvas'),
    body: [
      t("DOUBLE-CLIQUEZ une boite sur l'image : elle devient cible de suivi. Un anneau pointille l'entoure aussitot, et sa case se coche dans la liste a gauche. Re-double-cliquer la retire."),
      t('C\'est plus sur que la liste quand la frame porte plusieurs objets : sur la liste, rien ne dit laquelle des lignes "voiture #12 / #13 / #14" est la voiture qui vous interesse.'),
      t("Choisissez DEUX cibles, et deux seulement. Le tutoriel a decoche celle du chapitre precedent."),
    ],
    hint: t("Double-cliquez les deux vehicules a suivre, puis cliquez sur Fait."),
    target: { selector: '[data-tour="canvas-area"]' },
    alsoTargets: [{ selector: '[data-tour="samurai-targets"]' }],
    placement: 'left',
    spotlightPadding: 0,
    nextLabel: t('Fait'),
    waitingLabel: t("Double-cliquez exactement deux boites sur l'image..."),
    canAdvance: () => activeTargets().length === 2,
    beforeShow: async () => {
      // Sans ce nettoyage, la cible du chapitre 6 restait cochee : trois cibles
      // partaient en propagation alors que l'utilisateur en avait designe deux.
      useAnnotationStore.getState().clearTrackingTargets()
      useAnnotationStore.getState().setActiveTool('select')
      useUIStore.getState().setSidebarTab('tracks')
      await clickWhenReady('[data-tour="tab-samurai"]')
      await sleep(200)
    },
  },
  {
    id: 'multi-targets',
    chapter: t('7. Suivre deux objets'),
    title: t('Ce que la liste confirme'),
    body: [
      t("Vos deux double-clics ont coche exactement deux lignes ici : la liste et le canvas sont la meme selection, vue de deux endroits. Le numero en fin de ligne est l'identifiant de l'annotation, celui de l'anneau que vous venez de voir."),
      t("Chaque cible cochee deviendra sa propre piste, avec son propre identifiant. Tout ce qui n'est PAS coche est ignore par la propagation -- la boite du chapitre precedent, par exemple, restera seule sur cette frame."),
      t("Le tutoriel zoome sur la premiere cible pour que l'anneau soit bien visible."),
    ],
    target: { selector: '[data-tour="samurai-targets"]' },
    placement: 'right',
    beforeShow: async () => {
      const first = activeTargets()[0]
      if (first) zoomOnAnnotation(first.id)
      await sleep(200)
    },
    afterHide: () => { useUIStore.getState().resetZoom() },
  },
  {
    id: 'multi-output-seg',
    chapter: t('7. Suivre deux objets'),
    title: t('Cette fois : Segmentation'),
    body: [
      t("Meme propagation, autre sortie. BBox enregistre une boite englobante par frame ; Segmentation enregistre le contour exact du masque -- plus lourd, mais c'est ce qu'il faut pour entrainer un modele de segmentation, ou simplement pour mesurer une surface."),
      t("SAM2 travaille de toute facon sur des masques : le mode BBox ne fait que les resumer en rectangle. Passer en Segmentation ne coute donc aucun calcul supplementaire."),
      t("Suivant choisit Segmentation."),
    ],
    target: { selector: '[data-tour="samurai-output-mode"]' },
    placement: 'right',
    onNext: async () => { await clickWhenReady('[data-tour="samurai-output-segmentation"]', 2000) },
  },
  {
    id: 'multi-strategy-auto',
    chapter: t('7. Suivre deux objets'),
    title: t('Auto (rapide) : SAM2 multi-objets'),
    body: [
      t("SAMURAI ne suit qu'une cible : son filtre de Kalman porte UN etat de mouvement. Avec deux cibles, il faut choisir."),
      t("Auto (rapide) bascule sur SAM2 multi-objets : une seule passe video, les deux objets suivis ensemble, sans modele de mouvement. C'est le bon choix par defaut."),
      t("SAMURAI / objet refait une passe Kalman complete par cible : meilleur quand deux objets similaires se croisent ou s'occultent, mais deux fois plus long ici, N fois plus long avec N cibles."),
      t("Suivant selectionne Auto (rapide)."),
    ],
    target: { selector: '[data-tour="samurai-strategy"]' },
    placement: 'right',
    onNext: async () => { await clickWhenReady('[data-tour="samurai-strategy-auto"]', 2000) },
  },
  {
    id: 'multi-propagate',
    chapter: t('7. Suivre deux objets'),
    title: t('Propager les deux cibles'),
    body: [
      t("Suivant relance la propagation -- sur vos DEUX cibles cochees, et sur elles seules -- en sortie segmentation et en une seule passe SAM2. Le tutoriel attend la fin avant de continuer."),
      t("Les annotations produites sont des polygones : sur le canvas, le contour colle a la carrosserie au lieu de l'encadrer."),
    ],
    target: { selector: '[data-tour="propagate-btn"]' },
    placement: 'right',
    canAdvance: () => activeTargets().length === 2 && !propagationBusy(),
    waitingLabel: t("Il faut exactement deux cibles cochees (double-clic sur le canvas), et aucune propagation en cours."),
    onNext: async () => { await runPropagation('multi') },
  },
  {
    id: 'multi-review',
    chapter: t('7. Suivre deux objets'),
    title: t('Deux contours qui se suivent'),
    body: [
      t("Refaites defiler la sequence. Deux polygones progressent maintenant en parallele, chacun de la couleur de sa piste, et chacun colle a sa carrosserie au lieu de l'encadrer."),
      t("Verifiez surtout les croisements : c'est la que SAM2 sans Kalman peut confondre deux vehicules. Si ca arrive sur vos donnees, c'est l'argument pour passer en SAMURAI / objet."),
      t("Et s'il restait une boite non cochee sur la premiere frame, elle y est restee seule : la preuve que seules les cibles cochees partent en propagation."),
    ],
    hint: t("Parcourez les frames et comparez les deux pistes, puis cliquez sur Suivant."),
    target: { selector: '[data-tour="canvas-area"]' },
    alsoTargets: [{ selector: '[data-tour="frame-nav"]' }],
    placement: 'left',
    spotlightPadding: 0,
    beforeShow: () => {
      const { frames, setCurrentFrameIndex } = useProjectStore.getState()
      if (frames.length > 0) setCurrentFrameIndex(0)
      useUIStore.getState().resetZoom()
    },
  },
  {
    id: 'multi-tracks',
    chapter: t('7. Suivre deux objets'),
    title: t('Deux pistes de plus'),
    body: [
      t("Deux nouvelles lignes sont apparues dans la zone des pistes : une par objet suivi, chacune avec son identifiant. C'est cet identifiant qui dit que c'est le meme vehicule d'une frame a l'autre, et c'est lui qui part a l'export .ver."),
      t("Chaque piste se selectionne et s'efface independamment : si le suivi a confondu deux vehicules, on supprime la piste fautive sans toucher a l'autre."),
    ],
    target: { selector: '[data-tour="timeline-tracks"]' },
    placement: 'top',
    waitTimeoutMs: 25000,
  },

  // ============================================================
  // 8. Detecter par texte pendant le suivi
  // ============================================================
  {
    id: 'tab-guided',
    chapter: t('8. Detecter par texte'),
    title: t("L'onglet Detect. : la troisieme facon d'annoter"),
    body: [
      t("Jusqu'ici on a dessine a la main, puis propage un masque. Troisieme voie : laisser un detecteur trouver les objets par leur NOM, frame par frame."),
      t("Deux endroits pour cela, et ils ne font pas la meme chose. En haut de l'ecran, le bouton Texte annote la frame courante (ou un lot de frames) sans aucune notion de piste. Ici, dans Detect., la detection est mise au service du SUIVI."),
      t("Suivant ouvre l'onglet."),
    ],
    target: { selector: '[data-tour="tab-guided"]' },
    placement: 'right',
    beforeShow: () => { useUIStore.getState().setSidebarTab('tracks') },
    onNext: async () => { await clickWhenReady('[data-tour="tab-guided"]') },
  },
  {
    id: 'guided-prompt',
    chapter: t('8. Detecter par texte'),
    title: t('Le prompt de detection'),
    body: [
      t("On decrit les objets a trouver, separes par des points : voiture. camion. Grounding DINO ou SAM3 les cherchent alors dans TOUTE l'image, a chaque frame de la plage -- sans savoir ou etait l'objet avant."),
      t("Le modele est LE MEME que celui du bouton Texte de la barre du haut : meme appel, memes poids, memes seuils. Ce qui change, c'est la logique appliquee au resultat."),
      t("En haut : tout ce qui est trouve est conserve, sans aucune notion de piste. Ici : il FAUT des cibles cochees sur la frame courante, et seules les detections rattachees a une cible sont gardees -- tout le reste est jete. Meme detecteur, deux usages opposes."),
      t("L'algorithme se choisit juste au-dessus : GDINO, SAM3.1, ou un YOLO maison si un modele est configure dans les parametres."),
      t("Le tutoriel a saisi le prompt pour vous."),
    ],
    target: { selector: '[data-tour="guided-prompt"]' },
    placement: 'right',
    beforeShow: async () => {
      await typeWhenReady('[data-tour="guided-prompt"]', 'voiture.')
    },
  },
  {
    id: 'guided-run',
    chapter: t('8. Detecter par texte'),
    title: t('Detecter puis associer : distance au centroide'),
    body: [
      t("Comme SAMURAI, ce mode part de vos boites de reference : il faut des cibles cochees sur la frame courante, sinon il ne saurait pas quelle piste continuer. C'est la difference majeure avec le bouton Texte du haut."),
      t("A chaque frame, le detecteur rend un paquet de boites ANONYMES -- tous les objets qui repondent au nom. L'association se fait ensuite cible par cible : pour chacune, la detection la plus proche en distance de centroide, et seulement si elle tombe sous le seuil (Dist. max, 0,15 en coordonnees normalisees par defaut). Une detection deja prise n'est plus disponible pour une autre cible."),
      t("La reference se deplace : c'est la boite de la frame PRECEDENTE qui sert de point de comparaison, pas celle du depart. Un objet rapide sort donc du seuil meme s'il reste dans l'image -- d'ou le reglage Dist. max, a monter pour du mouvement vif, a baisser quand plusieurs objets identiques se cotoient."),
      t("Deux anomalies sont journalisees : aucune detection sous le seuil (la piste a un trou sur cette frame), et variation de surface superieure au seuil (l'annotation est quand meme creee, mais signalee : c'est le symptome d'une boite qui a saute sur un autre objet). L'auto-stop, plus bas, arrete la tache quand trop de cibles sont perdues plusieurs frames de suite."),
      t("Interet par rapport a SAMURAI : l'objet peut disparaitre puis revenir, ou changer d'echelle brutalement -- le detecteur le retrouve par son nom et la piste continue. Faiblesse : l'appariement est glouton, pris cible par cible dans l'ordre ; deux objets identiques et proches peuvent voir leurs identifiants echanges."),
      t("Rien n'est lance ici : ce serait une troisieme passe sur la meme sequence."),
    ],
    hint: t("Cochez une cible puis cliquez sur ce bouton quand vous voudrez l'essayer."),
    target: { selector: '[data-tour="guided-run-btn"]' },
    placement: 'right',
  },

  // ============================================================
  // 9. Affichage et export
  // ============================================================
  {
    id: 'lut-btn',
    chapter: t('9. Affichage et export'),
    title: t('La LUT : images 16 bits et contraste'),
    body: t("Ce bouton ouvre l'histogramme et le remappage d'affichage. Suivant l'ouvre pour de vrai."),
    target: { selector: '[data-tour="lut-btn"]' },
    placement: 'left',
    onNext: async () => {
      if (!document.querySelector('[data-tour="lut-panel"]')) {
        await clickWhenReady('[data-tour="lut-btn"]')
        await waitFor(() => document.querySelector('[data-tour="lut-panel"]') !== null, 3000)
      }
    },
  },
  {
    id: 'lut-panel',
    chapter: t('9. Affichage et export'),
    title: t('Ce que la LUT change vraiment'),
    body: [
      t("L'histogramme montre la distribution reelle des intensites de la frame. Sur une source 16 bits (PNG/TIFF, visible ou infrarouge), l'image reste 16 bits sur le disque : la LUT decide seulement quelle plage de valeurs devient le 0-255 affiche -- ET ce qui est envoye aux modeles."),
      t("Trois modes : 3-sigma par defaut (robuste au bruit), min/max (toute la dynamique), ou bornes manuelles quand on sait ou regarder. Le reglage se memorise par sequence."),
      t("C'est l'outil qui rend exploitable une scene de nuit ecrasee dans les noirs, comme celle de ce tutoriel, sans jamais toucher aux fichiers d'origine."),
    ],
    target: { selector: '[data-tour="lut-panel"]' },
    placement: 'left',
    waitTimeoutMs: 6000,
    afterHide: async () => {
      // On referme le panneau : il recouvre le coin haut-droit du canvas.
      if (document.querySelector('[data-tour="lut-panel"]')) {
        await clickWhenReady('[data-tour="lut-btn"]', 1000)
      }
    },
  },
  {
    id: 'export-btn',
    chapter: t('9. Affichage et export'),
    title: t('Exporter le dataset'),
    body: t("Suivant ouvre la fenetre d'export."),
    target: { selector: '[data-tour="export-btn"]' },
    placement: 'bottom',
    onNext: async () => { await clickWhenReady('[data-tour="export-btn"]') },
  },
  {
    id: 'export-formats',
    chapter: t('9. Affichage et export'),
    title: t('YOLO, COCO ou .ver'),
    body: [
      t("YOLO : un fichier .txt par image, coordonnees normalisees, avec les splits train/val/test regles juste en dessous. Le format d'entrainement direct."),
      t("COCO : un unique JSON par split, bbox en pixels, segmentation incluse pour les polygones issus de SAM."),
      t(".ver : un fichier par sequence, une ligne par objet et par frame, coordonnees absolues en pixels avec l'identifiant de piste et la hierarchie de classes. C'est le format qui conserve le suivi."),
      t("La page Convert, depuis l'accueil, retraduit ces formats entre eux apres coup."),
    ],
    target: { selector: '[data-tour="export-formats"]' },
    placement: 'bottom',
  },
  {
    id: 'export-submit',
    chapter: t('9. Affichage et export'),
    title: t("Lancer l'export"),
    body: [
      t("L'export ecrit dans le dossier choisi plus bas. En mode local, l'option liens symboliques evite de dupliquer les images ; sinon un ZIP est produit."),
      t("Nous n'exportons rien maintenant : Suivant referme simplement la fenetre."),
    ],
    target: { selector: '[data-tour="export-submit"]' },
    placement: 'top',
    onNext: async () => { await clickWhenReady('[data-tour="export-cancel"]', 1500) },
  },

  // ============================================================
  // 8. Pour aller plus loin
  // ============================================================
  {
    id: 'settings-btn',
    chapter: t('10. Pour aller plus loin'),
    title: t('Les parametres'),
    body: [
      t("Tout ce que le tutoriel a effleure s'y regle et s'y memorise : seuils des modeles, offload CPU de SAM2, auto-stop du suivi, qualite des apercus, opacite des annotations, ratios d'export."),
      t("Les valeurs vivent dans votre workspace : elles vous suivent d'une session a l'autre."),
    ],
    target: { selector: '[data-tour="settings-btn"]' },
    placement: 'bottom',
  },
  {
    id: 'help-btn',
    chapter: t('10. Pour aller plus loin'),
    title: t("L'aide, et comment relancer ce tutoriel"),
    body: [
      t("Cette fenetre rassemble tout ce que le tutoriel a survole : la liste complete des raccourcis clavier, la description de chaque outil, de chaque mode et de chaque modele, et le workflow recommande. C'est la ou revenir quand un geste s'oublie."),
      t("Son onglet Workflow porte aussi un bouton qui relance ce tutoriel depuis le debut. Et c'est exactement le meme bouton orange que celui par lequel vous l'avez lance, sur la page d'accueil : le tour est rejouable autant de fois que vous voulez, sans rien casser."),
    ],
    target: { selector: '[data-tour="help-btn"]' },
    placement: 'bottom',
  },

  // ============================================================
  // 11. Un second projet, sans suivi : Image Random
  // ============================================================
  {
    id: 'back-home',
    chapter: t('11. Un projet Image Random'),
    title: t('Retour a l\'accueil'),
    body: [
      t("Cette fleche ramene a la liste des projets, sans rien perdre : la frame courante, le zoom et l'outil actif du projet sont memorises et restaures au prochain passage."),
      t("On va creer un SECOND projet, de l'autre type, pour voir ce qui change."),
      t("Suivant retourne a l'accueil."),
    ],
    target: { selector: '[data-tour="back-home"]' },
    placement: 'bottom',
    onNext: async (ctx) => {
      (ctx as AnnotationTourContext).navigate('/')
      await waitFor(() => document.querySelector('[data-tour="new-project-btn"]') !== null, 8000)
    },
  },
  {
    id: 'second-project-btn',
    chapter: t('11. Un projet Image Random'),
    title: t('Nouveau projet, deuxieme type'),
    body: t("Suivant rouvre la fenetre de creation."),
    target: { selector: '[data-tour="new-project-btn"]' },
    placement: 'bottom',
    onNext: async () => { await clickWhenReady('[data-tour="new-project-btn"]') },
  },
  {
    id: 'second-project-name',
    chapter: t('11. Un projet Image Random'),
    title: t('Un nom, et surtout un autre type'),
    body: [
      t('Le tutoriel a saisi "Template Traffic Lights".'),
      t("Cette fois on choisit Image Random : un jeu d'images INDEPENDANTES, sans ordre temporel."),
    ],
    target: { selector: '[data-tour="create-project-name"]' },
    placement: 'right',
    beforeShow: async () => {
      if (!document.querySelector('[data-tour="create-project-name"]')) return
      await typeWhenReady('[data-tour="create-project-name"]', TEMPLATE2_PROJECT_NAME)
    },
  },
  {
    id: 'second-project-type',
    chapter: t('11. Un projet Image Random'),
    title: t('Image Random : ce que ca retire'),
    body: [
      t("Pas de timeline, pas de pistes, pas de propagation : deux images voisines n'ont aucune raison d'etre liees. Le panneau de suivi a gauche disparait purement et simplement."),
      t("C'est le mode a prendre pour un dataset de detection classique -- des images sans continuite, annotees une par une ou en lot."),
      t("Suivant selectionne ce type, puis cree le projet."),
    ],
    target: { selector: '[data-tour="create-project-type-image"]' },
    placement: 'right',
    onNext: async (ctx) => {
      const c = ctx as AnnotationTourContext
      await clickWhenReady('[data-tour="create-project-type-image"]')
      await sleep(150)
      c.project2Id = (await submitProjectOnce(TEMPLATE2_PROJECT_NAME)) ?? c.project2Id
      if (c.project2Id) {
        c.navigate(`/projects/${c.project2Id}/annotate`)
        await waitFor(() => document.querySelector('[data-tour="import-btn"]') !== null, 10000)
      }
    },
  },
  {
    id: 'second-import',
    chapter: t('11. Un projet Image Random'),
    title: t('Les memes images, en vrac'),
    body: [
      t("On reimporte le meme dossier d'exemple : cette fois l'application n'y verra qu'un lot de 10 images sans ordre."),
      t("Suivant ouvre l'import, remplit le chemin et lance."),
    ],
    target: { selector: '[data-tour="import-btn"]' },
    placement: 'bottom',
    waitTimeoutMs: 15000,
    onNext: async (ctx) => {
      const c = ctx as AnnotationTourContext
      if (useProjectStore.getState().frames.length > 0) return
      await clickWhenReady('[data-tour="import-btn"]')
      if (c.samplePath) {
        await typeWhenReady('[data-tour="import-server-path"]', c.samplePath)
        await typeWhenReady('[data-tour="import-seq-name"]', 'traffic_lights_10')
        await sleep(250)
        await clickWhenReady('[data-tour="import-submit"]')
        await waitFor(() => useProjectStore.getState().frames.length > 0, 60000)
        await sleep(400)
      }
    },
  },
  {
    id: 'second-class',
    chapter: t('11. Un projet Image Random'),
    title: t('Une classe pour ce projet'),
    body: [
      t('Les classes appartiennent au PROJET : ce nouveau projet repart d\'une liste vide, la classe "voiture" du precedent n\'existe pas ici.'),
      t('Le tutoriel cree "traffic light" et la selectionne comme classe active.'),
    ],
    target: { selector: '[data-tour="tab-classes"]' },
    placement: 'left',
    beforeShow: async () => { await clickWhenReady('[data-tour="tab-classes"]') },
    onNext: async () => {
      if (!classExists(TEMPLATE2_CLASS_NAME)) {
        await ensureClassForm()
        await typeWhenReady('[data-tour="class-name-input"]', TEMPLATE2_CLASS_NAME)
        await sleep(150)
        await clickWhenReady('[data-tour="class-create-submit"]')
        await waitFor(() => classExists(TEMPLATE2_CLASS_NAME), 8000)
      }
      await sleep(250)
      if (useAnnotationStore.getState().activeClassId == null) {
        await clickWhenReady('[data-tour="class-row-first"]', 3000)
      }
    },
  },
  {
    id: 'second-class-active',
    chapter: t('11. Un projet Image Random'),
    title: t('Classe active : obligatoire pour le texte'),
    body: [
      t("La classe est surlignee en bleu : elle est active. Grounding DINO et SAM3 refusent de se lancer sans cela -- ils doivent savoir dans quelle classe ranger ce qu'ils trouvent."),
      t("C'est l'erreur numero un sur l'annotation par texte."),
    ],
    target: { selector: '[data-tour="class-row-first"]' },
    placement: 'left',
    waitTimeoutMs: 8000,
  },
  {
    id: 'second-text-open',
    chapter: t('11. Un projet Image Random'),
    title: t('Annoter par texte, pour de vrai'),
    body: [
      t("Ce bouton ouvre la zone de detection par texte. Suivant l'ouvre."),
    ],
    target: { selector: '[data-tour="text-prompt-btn"]' },
    placement: 'bottom',
    onNext: async () => {
      if (!document.querySelector('[data-tour="text-prompt-input"]')) {
        await clickWhenReady('[data-tour="text-prompt-btn"]')
        await waitFor(() => document.querySelector('[data-tour="text-prompt-input"]') !== null, 3000)
      }
    },
  },
  {
    id: 'second-text-prompt',
    chapter: t('11. Un projet Image Random'),
    title: t('Decrire ce qu\'on cherche'),
    body: [
      t("GD est selectionne a gauche : Grounding DINO, un detecteur open-vocabulary -- il n'a jamais ete entraine sur VOS classes, il comprend la description."),
      t('Le tutoriel a saisi "traffic light" (ces modeles sont entraines en anglais : les termes anglais marchent nettement mieux).'),
      t("Box et Txt a cote sont les seuils : les baisser ramene plus de detections et plus de faux positifs."),
    ],
    target: { selector: '[data-tour="text-prompt-input"]' },
    placement: 'bottom',
    beforeShow: async () => {
      await typeWhenReady('[data-tour="text-prompt-input"]', 'traffic light')
    },
  },
  {
    id: 'second-text-batch',
    chapter: t('11. Un projet Image Random'),
    title: t('Tout le lot, pas seulement cette image'),
    body: [
      t("Ce bouton affiche la plage de frames traitees : par defaut, de l'image courante a la derniere -- donc les 10 images."),
      t("A cote, Batch lance la detection sur toute cette plage, image par image, avec pause et arret possibles. Sans lui, la baguette magique n'annote que l'image affichee."),
    ],
    target: { selector: '[data-tour="text-batch-range"]' },
    placement: 'bottom',
    waitTimeoutMs: 8000,
  },
  {
    id: 'second-text-run',
    chapter: t('11. Un projet Image Random'),
    title: t('Lancer le lot'),
    body: [
      t("Suivant lance la detection sur les 10 images. Une barre de progression apparait en haut, les pastilles de la timeline se remplissent au fur et a mesure."),
      t("Si Grounding DINO n'est pas installe cote serveur, un message d'erreur s'affiche a la place : le reste du tutoriel n'en depend pas."),
    ],
    target: { selector: '[data-tour="text-batch-btn"]' },
    placement: 'bottom',
    waitTimeoutMs: 8000,
    onNext: async () => {
      await runLongTask('text-batch', '[data-tour="text-batch-btn"]',
        '[data-tour="batch-bar"]', 300000)
    },
  },
  {
    id: 'second-review',
    chapter: t('11. Un projet Image Random'),
    title: t('Regardez ce que le detecteur a trouve'),
    body: [
      t('Parcourez les 10 images. Chaque feu tricolore reconnu porte une boite dans la classe "traffic light", avec son score de confiance.'),
      t("Regardez aussi ce qui MANQUE, et ce qui est en trop : un feu de dos, un feu lointain, un phare arriere pris pour un feu. C'est exactement le travail qui reste -- corriger a la main ce que le detecteur a rate, puis baisser ou remonter les seuils Box et Txt en consequence."),
      t("Si rien n'apparait, Grounding DINO n'est probablement pas installe cote serveur : le reste du tutoriel n'en depend pas."),
    ],
    hint: t("Faites defiler les images et jugez les detections, puis cliquez sur Suivant."),
    target: { selector: '[data-tour="canvas-area"]' },
    alsoTargets: [{ selector: '[data-tour="frame-nav"]' }],
    placement: 'left',
    spotlightPadding: 0,
    beforeShow: () => {
      const { frames, setCurrentFrameIndex } = useProjectStore.getState()
      if (frames.length > 0) setCurrentFrameIndex(0)
      useUIStore.getState().resetZoom()
    },
  },
  {
    id: 'second-no-tracks',
    chapter: t('11. Un projet Image Random'),
    title: t('Aucune piste, et c\'est voulu'),
    body: [
      t("Regardez a gauche : pas de panneau de suivi. Les detections de l'image 3 n'ont aucun lien avec celles de l'image 4 -- rien ne dit que c'est le meme feu tricolore, et en Image Random la question ne se pose pas."),
      t("L'export reflete cela : des boites par image, sans identifiant de piste. C'est exactement ce qu'attend un entrainement de detection."),
      t("Resume des deux types : Sequence Image quand le temps compte (suivi, propagation, pistes), Image Random quand chaque image est un cas independant."),
    ],
    target: { selector: '[data-tour="timeline"]' },
    placement: 'top',
    waitTimeoutMs: 8000,
  },

  // ============================================================
  // 12. Le reste de l'application
  // ============================================================
  {
    id: 'home-again',
    chapter: t('12. Pour finir'),
    title: t('Retour a l\'accueil'),
    body: t("Suivant revient a la liste des projets : vos deux projets de demonstration y sont, en orange."),
    target: { selector: '[data-tour="back-home"]' },
    placement: 'bottom',
    onNext: async (ctx) => {
      (ctx as AnnotationTourContext).navigate('/')
      await waitFor(() => document.querySelector('[data-tour="home-tools"]') !== null, 8000)
    },
  },
  {
    id: 'home-tools',
    chapter: t('12. Pour finir'),
    title: t('Les outils de l\'accueil'),
    body: [
      t("Presentation : la documentation de fond de l'application. On y entre dans un instant."),
      t("Convert : traduire des annotations existantes entre .ver, YOLO et COCO, sans passer par un projet."),
      t("Parametres : tous les reglages, memorises dans votre workspace."),
      t("Monitoring : la part d'automatique et de manuel dans vos annotations, et les reprises humaines. On commence par celui-la."),
    ],
    target: { selector: '[data-tour="home-tools"]' },
    placement: 'bottom',
    waitTimeoutMs: 8000,
  },

  // ---- Monitoring : on y entre pour de vrai ----
  {
    id: 'monitoring-enter',
    chapter: t('12. Pour finir'),
    title: t('Monitoring : mesurer ce que l\'automatique a fait'),
    body: [
      t("La question que pose toute equipe d'annotation : qu'est-ce que le suivi automatique nous a REELLEMENT fait gagner ? Cette page y repond avec les chiffres de votre workspace."),
      t("Suivant y entre."),
    ],
    target: { selector: '[data-tour="monitoring-btn"]' },
    placement: 'bottom',
    waitTimeoutMs: 8000,
    onNext: async (ctx) => {
      (ctx as AnnotationTourContext).navigate('/monitoring')
      await waitFor(() => document.querySelector('[data-tour="monitoring-main"]') !== null, 10000)
      await sleep(400)
    },
  },
  {
    id: 'monitoring-numbers',
    chapter: t('12. Pour finir'),
    title: t('Automatique, manuel, retouche'),
    body: [
      t("Trois chiffres portent tout le sens de la page. Automatique : ce qu'un modele a produit (propagation, detection par texte, SAM). Manuel : ce que vous avez dessine vous-meme. Retouchees : les annotations automatiques qu'un humain a reprises a la main."),
      t("Le rapport retouchees / automatiques est la vraie mesure de qualite d'un modele sur VOS donnees : beaucoup d'automatique jamais retouche, c'est du temps gagne ; beaucoup d'automatique retouche, c'est un modele ou des seuils a revoir."),
      t("Les annotations de ce tutoriel y figurent deja : vos boites dessinees a la main en manuel, celles de la propagation et du batch en automatique."),
    ],
    target: { selector: '[data-tour="monitoring-main"]' },
    placement: 'top',
    waitTimeoutMs: 10000,
  },
  {
    id: 'monitoring-scope',
    chapter: t('12. Pour finir'),
    title: t('Moi, ou tous les utilisateurs'),
    body: [
      t("Moi ne lit que votre workspace. Tous les utilisateurs balaye les workspaces voisins sur la meme machine : utile quand plusieurs personnes annotent le meme lot et qu'il faut savoir ou en est le travail."),
      t("Aucune ecriture n'a lieu ici : la page ne fait que lire les bases des projets."),
    ],
    target: { selector: '[data-tour="monitoring-scope"]' },
    placement: 'bottom',
    waitTimeoutMs: 8000,
  },
  {
    id: 'monitoring-view',
    chapter: t('12. Pour finir'),
    title: t('Detail par sequence, ou vue globale'),
    body: [
      t("Detail descend a la sequence et a la provenance : quelle sequence est finie, laquelle est a moitie annotee, quelle part vient de quel modele."),
      t("Global somme tout et compare les utilisateurs entre eux -- c'est la vue de suivi d'equipe."),
    ],
    target: { selector: '[data-tour="monitoring-view"]' },
    placement: 'bottom',
    waitTimeoutMs: 8000,
  },
  {
    id: 'monitoring-export',
    chapter: t('12. Pour finir'),
    title: t('Emporter le rapport'),
    body: [
      t("Ce bouton produit un HTML autonome, graphiques compris : lisible hors ligne, joignable a un point d'avancement, sans donner acces a l'application."),
      t("Suivant revient a l'accueil."),
    ],
    target: { selector: '[data-tour="monitoring-export"]' },
    placement: 'bottom',
    waitTimeoutMs: 8000,
    onNext: async (ctx) => {
      (ctx as AnnotationTourContext).navigate('/')
      await waitFor(() => document.querySelector('[data-tour="presentation-btn"]') !== null, 10000)
      await sleep(300)
    },
  },

  // ---- Presentation : la doc de fond ----
  {
    id: 'presentation-btn',
    chapter: t('12. Pour finir'),
    title: t('Presentation : le pourquoi'),
    body: [
      t("Une visite NON interactive de l'application : les algorithmes employes, les choix techniques, les optimisations, le detail de chaque mode."),
      t("Ce tutoriel-ci montrait le geste ; la Presentation explique le pourquoi. Suivant y entre."),
    ],
    target: { selector: '[data-tour="presentation-btn"]' },
    placement: 'bottom',
    waitTimeoutMs: 8000,
    onNext: async (ctx) => {
      (ctx as AnnotationTourContext).navigate('/presentation')
      await waitFor(() => document.querySelector('[data-tour="presentation-tabs"]') !== null, 10000)
      await sleep(300)
    },
  },
  {
    id: 'presentation-tabs',
    chapter: t('12. Pour finir'),
    title: t('La documentation complete'),
    body: [
      t("Pour l'utilisateur : Guide utilisateur (chaque ecran et chaque bouton), Procedures (les taches pas a pas), Concepts (SAM2, SAMURAI, Grounding DINO, XFeat, flux optique : ce que chacun fait et quand le prendre)."),
      t("Installation et depannage : Configuration (installation, poids des modeles, workspace) et Depannage (symptome, cause, solution). Pour le developpeur : Architecture, Reference API et Carte du code."),
      t("Chaque page a son sommaire a gauche : quand une question reste apres ce tutoriel, la reponse est dans l'une de ces pages."),
    ],
    hint: t("Ouvrez une page ou deux si vous voulez jeter un oeil, puis cliquez sur Suivant."),
    target: { selector: '[data-tour="presentation-tabs"]' },
    placement: 'bottom',
    waitTimeoutMs: 10000,
    onNext: async (ctx) => {
      (ctx as AnnotationTourContext).navigate('/')
      await waitFor(() => document.querySelector('[data-tour="home-tools"]') !== null, 10000)
      await sleep(300)
    },
  },
  {
    id: 'done',
    chapter: t('Termine'),
    title: t('Vous avez fait le tour'),
    body: [
      t("Deux projets, les deux types, les trois facons d'annoter : a la main, par propagation SAMURAI/SAM2, et par texte avec Grounding DINO. Plus le nettoyage, les pistes multiples, la LUT et l'export."),
      t('Les projets "Template Cars Annotation" et "Template Traffic Lights" vous appartiennent : continuez a jouer avec, ou supprimez-les depuis l\'accueil par l\'icone corbeille de leur carte.'),
      t("Ce tutoriel se relance a tout moment par le bouton orange de l'accueil, ou depuis Aide > Workflow."),
      t("Bon annotage."),
    ],
    placement: 'center',
  },
  ]
  return steps
}
