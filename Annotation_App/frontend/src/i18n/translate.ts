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

// True quand VisionNexus a impose la langue au lancement (?lang= present dans
// l'URL) : dans ce mode, le bouton reste utilisable pour la session en cours,
// mais rien n'est ecrit dans les settings du workspace -- au prochain
// lancement depuis le launcher, c'est de nouveau son reglage qui s'applique.
const desktopPiloted = readQueryLang() !== null

export function isDesktopPiloted(): boolean {
  return desktopPiloted
}

/**
 * A appeler une fois au demarrage de l'app (hors mode pilote par VisionNexus) :
 * recupere la langue persistee dans les settings du workspace et l'applique.
 * Ne fait rien si VisionNexus a deja impose la langue via ?lang=.
 */
export async function initWorkspaceLanguage(fetchSettingsLang: () => Promise<Lang | null | undefined>): Promise<void> {
  if (desktopPiloted) return
  try {
    const fromWorkspace = await fetchSettingsLang()
    if (isLang(fromWorkspace ?? null)) setLang(fromWorkspace as Lang)
  } catch {
    // Pas de backend joignable au boot (cas rare) : repli localStorage/anglais.
  }
}

/**
 * A appeler dans le onClick du bouton FR/EN : persiste dans les settings du
 * workspace UNIQUEMENT hors mode pilote (sinon ecraserait a tort le reglage
 * VisionNexus au prochain lancement).
 */
export function setLangAndMaybePersist(lang: Lang, persistToWorkspace: (lang: Lang) => void): void {
  setLang(lang)
  if (!desktopPiloted) persistToWorkspace(lang)
}

// Dictionnaire de correspondance exacte FR -> EN, complete au fil de la
// couverture de l'app. Une chaine absente du dictionnaire reste affichee
// en francais meme en mode EN (degradation silencieuse, jamais de texte
// casse ou de cle brute visible).
const EXACT_EN: Record<string, string> = {
  'Présentation': 'Presentation',
  'Convert': 'Convert',
  "Convertir les formats d'annotations (.ver ↔ YOLO)": 'Convert annotation formats (.ver <-> YOLO)',
  'Paramètres': 'Settings',
  'Monitoring': 'Monitoring',
  'Usage : automatique vs manuel, reprise humaine': 'Usage: automatic vs manual, human takeover',
  'Nouveau projet': 'New project',
  'Projets': 'Projects',
  'projet': 'project',
  'projets': 'projects',
  'Chargement des projets...': 'Loading projects...',
  'Aucun projet.': 'No project yet.',
  "Créez votre premier projet d'annotation.": 'Create your first annotation project.',
  'Créer un projet': 'Create a project',
  'Supprimer le projet': 'Delete project',
  'Supprimer': 'Delete',
  'et toutes ses annotations ?': 'and all its annotations?',
  'Workspace': 'Workspace',

  // pages/AnnotationPage.tsx
  'Sélection': 'Selection',
  'Panorama': 'Pan',
  'Rectangle': 'Rectangle',
  'Polygone': 'Polygon',
  'SAM Point': 'SAM Point',
  'SAM Auto': 'SAM Auto',
  'Déposer des annotations': 'Drop annotations',
  '.ver ou dossier YOLO (.txt) → séquence courante · .json → restauration': '.ver or YOLO folder (.txt) -> current sequence . .json -> restore',
  'Retour aux projets': 'Back to projects',
  'Mode de sortie des annotations automatiques (SAM Auto, Grounding DINO, SAM3)': 'Output mode for automatic annotations (SAM Auto, Grounding DINO, SAM3)',
  'Boîtes englobantes (SAM Auto, Grounding DINO, SAM3)': 'Bounding boxes (SAM Auto, Grounding DINO, SAM3)',
  'Polygones de segmentation (SAM Auto, Grounding DINO avec raffinement SAM2, SAM3)': 'Segmentation polygons (SAM Auto, Grounding DINO with SAM2 refinement, SAM3)',
  'Annoter par texte (GD / SAM3)': 'Annotate by text (GD / SAM3)',
  'SAM3 — détection par texte open-vocabulary': 'SAM3 -- open-vocabulary text detection',
  'Seuil boîte GD': 'GD box threshold',
  'Seuil texte GD': 'GD text threshold',
  'Seuil score SAM3': 'SAM3 score threshold',
  'Seuil texte SAM3': 'SAM3 text threshold',
  'voiture. personne. vélo.': 'car. person. bike.',
  'Configurer la plage de frames': 'Configure the frame range',
  'Lancer le batch sur la plage sélectionnée': 'Run the batch on the selected range',
  'Pause': 'Pause',
  'Reprendre': 'Resume',
  'Stopper le batch': 'Stop the batch',
  'Créez une classe avant de lancer GD ou SAM3.': 'Create a class before running GD or SAM3.',
  'Indices de frame du projet entier, à partir de 0 (toutes séquences confondues).': 'Frame indices of the whole project, starting at 0 (all sequences combined).',
  'De F': 'From F',
  'à F': 'to F',
  'Annuler (Ctrl+Z)': 'Undo (Ctrl+Z)',
  'Rétablir (Ctrl+Y)': 'Redo (Ctrl+Y)',
  'Dézoomer': 'Zoom out',
  'Réinitialiser zoom et position': 'Reset zoom and position',
  'Zoomer': 'Zoom in',
  'Centrer la vue (reset zoom + pan)': 'Center the view (reset zoom + pan)',
  'Importer': 'Import',
  'Télécharger un backup JSON des annotations (glissez-déposez pour restaurer)': 'Download a JSON backup of the annotations (drag and drop to restore)',
  'Aide — raccourcis & modes': 'Help -- shortcuts & modes',
  'Exporter': 'Export',
  'Extraction frames': 'Extracting frames',
  'En cours...': 'In progress...',
  'Démarrage...': 'Starting...',
  'Arrêter le process': 'Stop the process',
  'Import de': 'Importing',
  'séquence': 'sequence',
  'en cours…': 'in progress…',
  'terminé': 'done',
  'Masquer': 'Hide',
  'pausé': 'paused',
  'frame': 'frame',
  'Connexion SAM...': 'Connecting to SAM...',
  'SAM Auto en cours': 'SAM Auto running',
  'masque': 'mask',
  'SAM Auto terminé': 'SAM Auto done',
  'LUT / Affichage (remap 16/8 bits, histogramme)': 'LUT / Display (16/8-bit remap, histogram)',
  'Aucune frame disponible': 'No frame available',
  'Importer des images ou une vidéo': 'Import images or a video',
  'frames annotées': 'annotated frames',
  'Séquences du projet': 'Project sequences',
  'Séquence…': 'Sequence…',
  'annotées': 'annotated',
  'annot.': 'annot.',
  'Importer des annotations (.ver ou dossier YOLO) sur cette séquence': 'Import annotations (.ver or YOLO folder) onto this sequence',
  'Frame': 'Frame',
  'Aller à la frame': 'Go to frame',
  'aller à': 'go to',
  'Retour au début': 'Back to start',
  'Lecture': 'Play',
  'Chargement du projet...': 'Loading project...',
  'Extraction en cours...': 'Extraction in progress...',
  'Sélectionnez une séquence': 'Select a sequence',
  'Importer des annotations sur': 'Import annotations onto',
  "Chemin serveur d'un fichier .ver OU d'un dossier YOLO (.txt) :": "Server path to a .ver file OR a YOLO folder (.txt):",
  'Remplacer les annotations existantes de cette séquence ?\n(OK = remplacer, Annuler = ajouter)': "Replace this sequence's existing annotations?\n(OK = replace, Cancel = add)",
  'annotations importées': 'annotations imported',
  'sur': 'over',
  'Erreur': 'Error',
  'Import annotations': 'Import annotations',
  'Traitement': 'Processing',
  'Arrêt demandé…': 'Stop requested…',
  'Arrêt du process demandé': 'Process stop requested',
  'Impossible d\'arrêter le process': 'Unable to stop the process',
  'terminé !': 'done!',
  'Erreur propagation': 'Propagation error',
  'Aucune frame sélectionnée': 'No frame selected',
  'Erreur lors du NMS': 'Error during NMS',
  'Erreur assignation de track': 'Error assigning track',
  'Erreur suppression des annotations': 'Error deleting annotations',
  'Annotations supprimées sur': 'Annotations deleted on',
  'Ctrl+Z pour annuler': 'Ctrl+Z to undo',
  'Suppression annulée': 'Deletion undone',
  'annotations restaurées': 'annotations restored',
  "Impossible d'annuler la suppression": 'Unable to undo the deletion',
  'Suppression refaite': 'Deletion redone',
  'Impossible de refaire la suppression': 'Unable to redo the deletion',
  'Track supprimé': 'Track deleted',
  'Erreur suppression du track': 'Error deleting the track',
  'Bloc supprimé — piste vidée': 'Block deleted -- track emptied',
  'Bloc supprimé': 'Block deleted',
  'Erreur suppression du bloc': 'Error deleting the block',
  'Créez d abord une classe dans le panneau Classes avant de lancer GD ou SAM3.': 'Create a class first in the Classes panel before running GD or SAM3.',
  'Sélectionnez une classe active avant de lancer GD ou SAM3.': 'Select an active class before running GD or SAM3.',
  'Aucun objet détecté avec SAM3.': 'No object detected with SAM3.',
  'objet': 'object',
  'détecté': 'detected',
  'Aucun objet détecté avec ce prompt.': 'No object detected with this prompt.',
  'Detection par texte': 'Text detection',
  'Erreur lors de la segmentation par texte': 'Error during text segmentation',
  'Erreur SAM Auto': 'SAM Auto error',
  'Sélectionnez une classe avant de valider': 'Select a class before validating',
  'Entrez un prompt texte pour le mode auto': 'Enter a text prompt for auto mode',
  'echec de la detection': 'detection failed',
  'batch terminé': 'batch done',
  'traitée': 'processed',
  'erreur': 'error',
  'Aucun fichier détecté': 'No file detected',
  'Erreur lors de la restauration': 'Error during restore',
  'Fichier JSON invalide ou erreur réseau': 'Invalid JSON file or network error',
  'Glissez un fichier .ver, un dossier YOLO (.txt), ou un backup .json': 'Drop a .ver file, a YOLO folder (.txt), or a .json backup',
  "Sélectionnez une séquence pour l'import": 'Select a sequence for the import',
  'Importer sur': 'Import onto',
  'doublon': 'duplicate',
  'supprimé': 'deleted',

  // pages/ConvertPage.tsx
  'Chemin .ver et dossier de sortie requis': '.ver path and output folder required',
  'YOLO écrit': 'YOLO written',
  'classes': 'classes',
  'Dossier YOLO et fichier .ver de sortie requis': 'YOLO folder and output .ver file required',
  '.ver écrit': '.ver written',
  'boîtes': 'boxes',
  'Convert — conversions rapides': 'Convert — quick conversions',
  'Utilitaire indépendant des projets. Tous les chemins sont des': 'A utility independent of projects. All paths are',
  'chemins serveur': 'server paths',
  'Convertit un .ver (pixels) en dossier YOLO normalisé. La résolution image est requise (pixels → [0,1]).': 'Converts a .ver (pixels) into a normalized YOLO folder. The image resolution is required (pixels -> [0,1]).',
  'Chemin du fichier .ver': '.ver file path',
  'Dossier YOLO de sortie': 'Output YOLO folder',
  'Convertir': 'Convert',
  "Convertit un dossier YOLO en .ver. YOLO n'a pas de sous-classe ni de track : classe = sous-classe = sous-sous-classe, track_id = -1.": 'Converts a YOLO folder into .ver. YOLO has no subclass or track: class = subclass = sub-subclass, track_id = -1.',
  'Dossier YOLO (.txt)': 'YOLO folder (.txt)',
  'Fichier .ver de sortie': 'Output .ver file',

  // pages/MonitoringPage.tsx
  'Manuel': 'Manual',
  'Tracking guide': 'Guided tracking',
  'YOLO custom': 'Custom YOLO',
  'Interpolation': 'Interpolation',
  'Homographie': 'Homography',
  'Flux optique': 'Optical flow',
  'Aucune annotation': 'No annotation',
  'Repartition automatique / manuel et reprise humaine': 'Automatic / manual split and human rework',
  'Moi': 'Me',
  'Tous les utilisateurs': 'All users',
  'Repartition entre utilisateurs, tous projets sommes': 'Split between users, all projects summed',
  'Detail par sequence et par provenance': 'Detail by sequence and by source',
  'Detail': 'Detail',
  'Global': 'Global',
  'Tous les projets': 'All projects',
  'Exporter ce rapport en HTML autonome (ouvrable hors ligne)': 'Export this report as a standalone HTML file (can be opened offline)',
  'Exporter HTML': 'Export HTML',
  'Rafraichir': 'Refresh',
  'Aucune annotation dans ce perimetre.': 'No annotation in this scope.',
  'Utilisateurs': 'Users',
  'Racines de workspace': 'Workspace roots',
  'Annotations': 'Annotations',
  'Automatiques': 'Automatic',
  'Manuelles': 'Manual',
  'Sequences exportees': 'Sequences exported',
  'Part de chaque utilisateur (toutes annotations)': "Each user's share (all annotations)",
  'manuel': 'manual',
  'retouchees': 'reworked',
  'supprimees': 'deleted',
  'Part de chaque utilisateur (annotations manuelles)': "Each user's share (manual annotations)",
  'manuelles sur': 'manual out of',
  'au total': 'total',
  'Detail par utilisateur': 'Detail by user',
  'Utilisateur': 'User',
  'Racines': 'Roots',
  'Sequences': 'Sequences',
  'Exportees': 'Exported',
  'Total': 'Total',
  'Auto': 'Auto',
  'Retouchees': 'Reworked',
  'Supprimees': 'Deleted',
  'Runs': 'Runs',
  'Par racine de workspace': 'By workspace root',
  'Racine': 'Root',
  'Auto retouchees': 'Auto reworked',
  'Auto supprimees': 'Auto deleted',
  'Frames reprises 2 fois+': 'Frames reworked 2+ times',
  'Repartition par provenance': 'Split by source',
  'Devenir des sorties automatiques': 'Fate of automatic outputs',
  'Aucune sortie automatique': 'No automatic output',
  'Conservees': 'Kept',
  'Retouchees a la main': 'Manually reworked',
  "Le journal d'evenements est vide : retouches et suppressions ne sont comptees que depuis l'activation du monitoring. Les annotations deja presentes apparaissent comme conservees.": 'The event log is empty: reworks and deletions are only counted since monitoring was enabled. Annotations already present show up as kept.',
  'Conservees telles quelles': 'Kept as-is',
  'Sequences (dataset)': 'Sequences (dataset)',
  'annotations sur': 'annotations over',
  'Séquence': 'Sequence',
  'images': 'images',
  'couvertes': 'covered',
  'Exporté': 'Exported',
  'le': 'on',
  'Jamais exporté': 'Never exported',
  "Coche verte = séquence exportée (YOLO, COCO ou .ver). Une séquence annotée mais jamais exportée n'est pas considérée terminée.": "Green check = exported sequence (YOLO, COCO or .ver). A sequence that's annotated but never exported is not considered done.",
  'Reprise humaine par dataset': 'Human rework by dataset',
  'Projet': 'Project',
  'Frames touchees': 'Frames touched',
  'Reprises 2 fois+': 'Reworked 2+ times',
  'Interventions': 'Interventions',
  'Runs automatiques': 'Automatic runs',
  "Aucun run enregistre. Le journal se remplit a partir du prochain lancement d'algorithme.": 'No run recorded. The log fills in starting with the next algorithm run.',
  'arrete': 'stopped',
  'complet': 'complete',
  'Rapport hors ligne multi-workspaces': 'Offline multi-workspace report',
  'dossier': 'folder',

  // pages/PresentationPage.tsx
  'Généralités': 'Overview',
  'Utilisation': 'Usage',
  'Algorithmes': 'Algorithms',
  'Technique & Méthodes': 'Technical & Methods',
  'Mode Développeur': 'Developer Mode',
  'Optimisations': 'Optimizations',
  "Utilisation de l'Application": 'Using the Application',
  'Technique & Méthodologie': 'Technical & Methodology',
  'Documentation intégrée': 'Built-in documentation',

  // components/modals/CreateProjectModal.tsx
  'Nom du projet': 'Project name',
  'Mon dataset...': 'My dataset...',
  'Type': 'Type',
  'Image Random': 'Image Random',
  "Jeu d'images non-séquentielles": 'Set of non-sequential images',
  'Séquence Image': 'Sequence Image',
  "Vidéo .mp4 ou dossier d'images": 'Video .mp4 or image folder',
  'Annuler': 'Cancel',
  'Création...': 'Creating...',
  'Créer': 'Create',

  // components/modals/ExportModal.tsx
  "Impossible de lancer l'export.": 'Unable to start the export.',
  'Exporter le dataset': 'Export the dataset',
  'Exporte': 'Exports',
  'tout le projet en une fois': 'the whole project at once',
  'toutes les séquences, chacune dans son propre sous-dossier (YOLO) ou fichier': 'all sequences, each in its own subfolder (YOLO) or file',
  "nommé d'après la séquence.": 'named after the sequence.',
  'Format de sortie': 'Output format',
  'Format .ver': '.ver format',
  'un fichier .ver par séquence annotée, coordonnées': '.ver file per annotated sequence, coordinates',
  'absolues (pixels)': 'absolute (pixels)',
  'frames 1-based.': '1-based frames.',
  'Format COCO': 'COCO format',
  'bbox en': 'bbox in',
  'pixels': 'pixels',
  '1-based, segmentation incluse pour les polygones (masques SAM). Splits ci-dessous appliqués.': '1-based, segmentation included for polygons (SAM masks). Splits below applied.',
  'Train': 'Train',
  'Validation': 'Validation',
  'Export 100% train — aucun split val/test': 'Export 100% train — no val/test split',
  'Aucun split validation': 'No validation split',
  'Aucun split test': 'No test split',
  'Liens symboliques pour les images': 'Symbolic links for images',
  'Crée un dossier dataset avec symlinks — usage direct sur ce serveur, pas de ZIP.': 'Creates a dataset folder with symlinks — used directly on this server, no ZIP.',
  'Copie les images et génère un ZIP téléchargeable.': 'Copies the images and generates a downloadable ZIP.',
  'Dossier de destination': 'Destination folder',
  'Chemin du dossier de sortie...': 'Output folder path...',
  'Laissez vide pour utiliser le dossier par défaut.': 'Leave empty to use the default folder.',
  'Export automatiquement enregistré dans le workspace orchestrateur.': 'Export automatically saved in the orchestrator workspace.',
  'Lancement...': 'Starting...',
  'Export terminé !': 'Export complete!',
  "Erreur lors de l'export": 'Error during export',
  'Export en cours...': 'Export in progress...',
  'Dataset créé avec symlinks': 'Dataset created with symlinks',
  'Utilisez ce chemin directement avec YOLOv8 sur ce serveur.': 'Use this path directly with YOLOv8 on this server.',
  'Fermer': 'Close',
  'Nouvel export': 'New export',
  'Télécharger ZIP': 'Download ZIP',

  // components/modals/FileBrowserModal.tsx
  'o': 'B',
  'Ko': 'KB',
  'Mo': 'MB',
  'Go': 'GB',
  'Impossible de lire ce dossier.': 'Unable to read this folder.',
  'Dossier parent': 'Parent folder',
  'Chargement...': 'Loading...',
  'Dossier vide': 'Empty folder',
  'Dossier': 'Folder',
  'Fichier': 'File',
  'Double-clic sur un fichier pour sélectionner': 'Double-click a file to select it',
  'Choisir ce dossier': 'Choose this folder',
  'Sélectionner': 'Select',

  // components/modals/HelpModal.tsx
  'Raccourcis': 'Shortcuts',
  'Modes & Fonctions': 'Modes & Features',
  'Modèles': 'Models',
  'Workflow': 'Workflow',
  "Modes d'annotation": 'Annotation modes',
  'Modes de suivi (Tracks)': 'Tracking modes (Tracks)',
  'Fonctions': 'Features',
  'Lancer le tutoriel interactif': 'Start the interactive tutorial',
  'Crée un projet démo « Template Cars Annotation » et déroule tout le workflow': 'Creates a "Template Cars Annotation" demo project and walks through the whole workflow',
  'Flux recommandé pour annoter une séquence :': 'Recommended flow for annotating a sequence:',

  // components/modals/ImportModal.tsx
  'serveur': 'server',
  'Vidéo serveur': 'Server video',
  'Dossier images serveur (symlink)': 'Server image folder (symlink)',
  'upload': 'upload',
  'Vidéo (upload)': 'Video (upload)',
  'image': 'image',
  'Manifeste .txt vide.': 'Empty .txt manifest.',
  'Manifeste .txt introuvable ou illisible côté serveur.': 'The .txt manifest could not be found or read on the server.',
  'Fichier .txt de séquences vide ou invalide.': 'The sequence .txt file is empty or invalid.',
  'Aucune image dans ce dossier.': 'No images in this folder.',
  'Ajoutez au moins une séquence (glisser-déposer ou chemin serveur).': 'Add at least one sequence (drag and drop or server path).',
  'Importer des séquences': 'Import sequences',
  'Chemin serveur': 'Server path',
  'zéro copie (symlink) — recommandé pour les gros datasets et les disques': 'zero copy (symlink) — recommended for large datasets and disks',
  'montés sur la machine du backend': 'mounted on the backend machine',
  'Glisser-déposer': 'Drag and drop',
  'upload via le navigateur.': 'upload via the browser.',
  'Un dossier glissé depuis un montage réseau Windows est bien lu, mais son': 'A folder dragged from a Windows network mount is read correctly, but its',
  'contenu est uploadé': 'content is uploaded',
  '(le navigateur ne transmet jamais un chemin). Pour référencer les fichiers sans copie, utilisez le chemin tel que vu par le serveur (ex :': '(the browser never transmits a path). To reference files without copying, use the path as seen by the server (e.g.:',
  'Chaque ajout crée une': 'Each addition creates a',
  'du projet (formats mélangeables). Import en série, une barre de progression par séquence.': 'in the project (formats can be mixed). Import runs serially, one progress bar per sequence.',
  'Formats importables': 'Importable formats',
  "Dossier d'images": 'Image folder',
  '8 bits, ou': '8-bit, or',
  '16 bits (PNG/TIFF, RGB ou IR mono)': '16-bit (PNG/TIFF, RGB or mono IR)',
  "source 16 bits conservée, seul l'affichage est remappé par la LUT (réglable par séquence).": 'the 16-bit source is kept as-is, only the display is remapped via the LUT (adjustable per sequence).',
  'Vidéo': 'Video',
  'extraction en JPEG, décimation possible': 'extracted to JPEG, decimation possible',
  'adaptateur optionnel détecté côté backend': 'optional adapter detected on the backend',
  'Source': 'Source',
  'chemin serveur': 'server path',
  'zéro copie / symlink': 'zero copy / symlink',
  'ou': 'or',
  'local (upload navigateur).': 'local (browser upload).',
  'SÉQ': 'SEQ',
  "Glissez un dossier d'images, une vidéo": 'Drag an image folder, a video',
  'ou un format spécifique détecté': 'or a detected specific format',
  'ici…': 'here…',
  'parcourir local': 'browse locally',
  '…ou chemin serveur : /mnt/datasets/frames · /data/video.mp4': '…or server path: /mnt/datasets/frames · /data/video.mp4',
  'Serveur': 'Server',
  'Nom séquence': 'Sequence name',
  "Options d'optimisation (appliquées à chaque séquence)": 'Optimization options (applied to each sequence)',
  'Dossiers images serveur': 'Server image folders',
  'symlink = zéro copie, démarrage immédiat.': 'symlink = zero copy, instant start.',
  "décimation 1/N + qualité JPEG = volume disque et vitesse d'extraction.": 'decimation 1/N + JPEG quality = disk usage and extraction speed.',
  "PNG/TIFF 16 bits — source conservée en 16 bits ; l'affichage ET l'IA passent par la LUT (défaut 3-sigma, réglable par séquence via le bouton LUT).": '16-bit PNG/TIFF — source kept as 16-bit; both the display AND the AI go through the LUT (3-sigma default, adjustable per sequence via the LUT button).',
  'Décimation des frames vidéo': 'Video frame decimation',
  'Tout': 'All',
  'Qualité JPEG frames extraites (MP4)': 'JPEG quality of extracted frames (MP4)',
  'PNG sans perte pour les MP4 (ignore la qualité JPEG)': 'Lossless PNG for MP4 (ignores JPEG quality)',
  'Idéal pour XFeat et flux optique. Plus lourd sur disque.': 'Ideal for XFeat and optical flow. Heavier on disk.',
  'Liens symboliques pour les dossiers serveur (recommandé)': 'Symbolic links for server folders (recommended)',
  "Aucune copie des images. Si les symlinks sont interdits, l'app copie automatiquement.": 'No image copying. If symlinks are not allowed, the app copies automatically.',
  'Frames par batch (extraction arrière-plan)': 'Frames per batch (background extraction)',
  "L'import se fait en tâche de fond : le modal se ferme et vous pouvez annoter pendant le chargement (barre de progression par séquence en bas d'écran).": 'The import runs in the background: the modal closes and you can keep annotating while it loads (a progress bar per sequence appears at the bottom of the screen).',
  'en fond': 'in the background',
  "Choisir un dossier d'images ou une vidéo (serveur)": 'Choose an image folder or a video (server)',

  // components/modals/SettingsModal.tsx
  'Interface': 'Interface',
  'Couleur de fond canvas': 'Canvas background color',
  'Hex ou nom CSS': 'Hex or CSS name',
  'Outil par défaut': 'Default tool',
  'Astuce : clic molette = auto-ajustement (fit), molette = zoom': 'Tip: middle-click = auto-fit, scroll wheel = zoom',
  'Déplacement': 'Pan',
  'Opacité des annotations': 'Annotation opacity',
  '[0 = invisible, 1 = plein]': '[0 = invisible, 1 = opaque]',
  'Afficher les étiquettes': 'Show labels',
  'Nom de classe sur chaque annotation': 'Class name on every annotation',
  'Oui': 'Yes',
  'Non': 'No',
  'Afficher le score': 'Show confidence score',
  'Confiance en % sur les annotations IA': 'Confidence in % on AI annotations',
  'Épaisseur des bordures': 'Border thickness',
  'Épaisseur du contour des annotations (1–4 px)': 'Outline thickness of annotations (1-4 px)',
  'Réduction preview (480/1600px)': 'Preview downscale (480/1600px)',
  "Désactiver si votre connexion est bonne : sert la source pleine résolution pour le scrub/l'affichage, sans écriture disque à résolution réduite": 'Disable if your connection is good: serves the full-resolution source for scrubbing/display, with no reduced-resolution disk write',
  'Activée': 'Enabled',
  'Désactivée (pleine résolution)': 'Disabled (full resolution)',
  'Live temps réel par défaut': 'Real-time live by default',
  "Activé : pendant SAMURAI/SAM2, le canvas suit la propagation, lit l'image via le chemin natif SMB/app-image quand il est disponible et applique les annotations poussées par WebSocket.": 'Enabled: during SAMURAI/SAM2, the canvas follows the propagation, reads the image via the native SMB/app-image path when available, and applies the annotations pushed over WebSocket.',
  'Suivi propagation : cadence du canvas': 'Propagation tracking: canvas cadence',
  "Intervalle minimal entre deux sauts d'image pendant une propagation. 150 ms suit la boucle WebSocket et convient au chemin SMB natif ; 700 ms économise le réseau en repli HTTP ; 0 suit chaque résultat GPU. Chaque image affichée reçoit toujours les annotations de la même frame.": 'Minimum interval between two image jumps during a propagation. 150 ms follows the WebSocket loop and suits the native SMB path; 700 ms saves network traffic on HTTP fallback; 0 follows every GPU result. Every displayed image always receives the annotations of the same frame.',
  'Import': 'Import',
  "Ces réglages s'appliquent selon le TYPE d'import :": 'These settings apply depending on the import TYPE:',
  'Vidéo / format spécifique': 'Video / specific format',
  "décimation et upload par chunks si l'adaptateur le permet.": 'decimation and chunked upload if the adapter allows it.',
  'copie/symlink sans ré-encodage (qualité source préservée).': 'copy/symlink with no re-encoding (source quality preserved).',
  'Le': 'The',
  'nom de séquence': 'sequence name',
  "par défaut = nom du dossier/fichier, modifiable dans la fenêtre d'import.": "defaults to the folder/file name, editable in the import window.",
  'Qualité JPEG': 'JPEG quality',
  "Extraction vidéo uniquement (50–95). Dossiers d'images : non ré-encodés": '50-95, video extraction only. Image folders are not re-encoded',
  'Chunk source (MB)': 'Source chunk (MB)',
  "Upload d'une source monofichier — RAM max pendant l'envoi": 'Upload of a single-file source — max RAM during the transfer',
  'Décimation frames (frame_keep)': 'Frame decimation (frame_keep)',
  'Vidéo ou format séquentiel — 0=tout, 2=1/2, 3=1/3, 4=1/4...': 'Video or sequential format — 0=all, 2=1/2, 3=1/3, 4=1/4...',
  'Taille batch images': 'Image batch size',
  'Upload dossier d\'images — envoi séquentiel par batchs': 'Image folder upload — sent sequentially in batches',
  'Seuil IoU NMS': 'NMS IoU threshold',
  '[0–1] — plus bas = plus agressif': '[0-1] — lower = more aggressive',
  'Sortie segmentation par défaut': 'Default segmentation output',
  "Valeur de départ du sélecteur BBox / Seg de la barre d'outils. Seg = polygones (GD raffiné par SAM2, SAM3, SAM Auto) ; BBox = boîtes brutes.": 'Starting value of the toolbar BBox / Seg selector. Seg = polygons (GD refined by SAM2, SAM3, SAM Auto); BBox = raw boxes.',
  'Points par côté': 'Points per side',
  'Grille de points SAM2 auto': 'SAM2 auto point grid',
  'Homographie (XFeat / SIFT)': 'Homography (XFeat / SIFT)',
  'Flux optique (Lucas-Kanade)': 'Optical flow (Lucas-Kanade)',
  'Fenêtre win_size (px)': 'win_size window (px)',
  'Niveaux pyramide max_level': 'max_level pyramid levels',
  'Points min trackés': 'Min tracked points',
  "Toolbar SAM3 et tracking guidé utilisent les mêmes valeurs. La sortie (boîtes ou polygones) suit le sélecteur BBox / Seg de la barre d'outils.": "The SAM3 toolbar and guided tracking use the same values. The output (boxes or polygons) follows the toolbar's BBox / Seg selector.",
  'Detect. — Matching géométrique': 'Detect. — Geometric matching',
  'Max distance centroïde': 'Max centroid distance',
  'Normalisée [0–1]': 'Normalized [0-1]',
  'Variation de taille max': 'Max size variation',
  'Ratio relatif [0–1]': 'Relative ratio [0-1]',
  'vidéo': 'video',
  'Mode GPU rapide': 'Fast GPU mode',
  'Coché (défaut) = frames sur le GPU → 1.5–3x plus rapide, mais limité par la VRAM (~350–450 frames @1024² sur 10 Go). Décoché = offload CPU : VRAM mini, séquences longues, mais plus lent': 'Checked (default) = frames on the GPU -> 1.5-3x faster, but limited by VRAM (~350-450 frames @1024² on 10 GB). Unchecked = CPU offload: minimal VRAM, long sequences, but slower',
  'GPU (rapide)': 'GPU (fast)',
  'CPU (VRAM mini)': 'CPU (minimal VRAM)',
  'Auto-stop global (tous les trackers)': 'Global auto-stop (all trackers)',
  'Activer auto-stop': 'Enable auto-stop',
  "Arrêt si trop d'objets perdus": 'Stop if too many objects are lost',
  'Activé': 'Enabled',
  'Désactivé': 'Disabled',
  "% d'objets perdus max": 'Max % of lost objects',
  '0.5 = stop si > 50% perdus': '0.5 = stop if > 50% lost',
  'Frames consécutives': 'Consecutive frames',
  'Nb frames avant arrêt': 'Number of frames before stopping',
  'Stockage workspace': 'Workspace storage',
  'Calcul en cours…': 'Calculating…',
  'Projets (frames + thumbnails)': 'Projects (frames + thumbnails)',
  'Sauvegardes JSON': 'JSON backups',
  'Exports YOLO (ZIP)': 'YOLO exports (ZIP)',
  'Actualiser': 'Refresh',
  'Impossible de lire les tailles.': 'Unable to read the sizes.',
  'Vider ce dossier': 'Empty this folder',
  'Export YOLO': 'YOLO export',
  'Somme': 'Sum',
  'doit valoir 1.0': 'must equal 1.0',
  'Ratio Train': 'Train ratio',
  'Ratio Val': 'Val ratio',
  'Ratio Test': 'Test ratio',
  'Inclure non-annotées': 'Include unannotated',
  'Liens symboliques images': 'Symbolic links for images',
  'Dossier local (pas de ZIP) si actif': 'Local folder (no ZIP) if enabled',
  'Réinitialiser': 'Reset',
  'Sauvegardé !': 'Saved!',
  'Sauvegarde...': 'Saving...',
  'Sauvegarder': 'Save',

  // components/modals/TaskProgressModal.tsx
  'Traitement...': 'Processing...',
  'Initialisation...': 'Initializing...',
  'Terminé': 'Done',

  // components/panels/FramesPanel.tsx
  'N°': 'No.',
  'Entrée pour valider': 'Enter to confirm',
  'Frames': 'Frames',
  'Supprimer les annotations sur': 'Delete annotations on',
  'frame(s) sélectionnée(s)': 'selected frame(s)',
  'vide': 'empty',
  'Suppr. pour effacer': 'Del to clear',

  // components/panels/LutPanel.tsx
  'LUT / Affichage': 'LUT / Display',
  'Séquence principale : réglez la LUT au niveau projet': 'Main sequence: set the LUT at the project level',
  'repli projet': 'fall back to project',
  'Auto σ': 'Auto σ',
  'Sigma (N)': 'Sigma (N)',
  'Étire [moy − Nσ, moy + Nσ] → 0-255. Défaut 3σ.': 'Stretches [mean − Nσ, mean + Nσ] -> 0-255. Default 3σ.',
  'Étire [min, max] réels de la frame → 0-255 (contraste maximal).': 'Stretches the frame\'s real [min, max] -> 0-255 (maximum contrast).',
  'Bas (lo)': 'Low (lo)',
  'Haut (hi)': 'High (hi)',
  'Mémorisé pour cette séquence (prioritaire sur le projet) et appliqué à l’IA.': 'Saved for this sequence (takes priority over the project) and applied to the AI.',
  'Mémorisé pour tout le projet.': 'Saved for the whole project.',

  // components/sidebar/RightPanel.tsx
  'Glisser pour redimensionner (largeur non sauvegardée)': 'Drag to resize (width is not saved)',
  'Annots': 'Annots',
  'Aide': 'Help',

  // components/sidebar/LabelManager.tsx
  'Ajouter une classe': 'Add a class',
  'Classe (détection) * — ex : drone': 'Class (detection) * — e.g. drone',
  'Sous-classe (reconnaissance) — ex : quadcoptere': 'Subclass (recognition) — e.g. quadcopter',
  'Sous-sous-classe (identification) — ex : mavic': 'Sub-subclass (identification) — e.g. mavic',
  'Seule la classe de base est obligatoire.': 'Only the base class is required.',
  'Classe *': 'Class *',
  'Sous-classe': 'Subclass',
  'Sous-sous-classe': 'Sub-subclass',
  'Aucune classe définie. Cliquez sur + pour créer.': 'No class defined yet. Click + to create one.',

  // components/sidebar/XFeatDebugPanel.tsx
  'Frames introuvables': 'Frames not found',
  'Selectionnez deux frames differentes': 'Select two different frames',
  "Erreur lors du calcul de l'homographie": 'Error computing the homography',
  'Debug Homographie': 'Homography Debug',
  'Visualise les correspondances entre deux frames.': 'Visualizes the correspondences between two frames.',
  'Calcul...': 'Computing...',
  'Calculer homographie': 'Compute homography',
  'Utiliser frame courante': 'Use current frame',
  'Methode': 'Method',
  'Matches totaux': 'Total matches',
  'Matches filtres': 'Filtered matches',
  'Inliers RANSAC': 'RANSAC inliers',
  'Ratio inliers': 'Inlier ratio',
  'Homographie valide': 'Valid homography',
  'Inliers': 'Inliers',
  'Outliers': 'Outliers',
  'Correspondances keypoints': 'Keypoint correspondences',
  'Pas assez de matches pour la visualisation.': 'Not enough matches for visualization.',
  'Selectionnez deux frames et cliquez "Calculer homographie" pour analyser le matching.': 'Select two frames and click "Compute homography" to analyze the matching.',

  // components/sidebar/AnnotationList.tsx
  'Afficher annotations IA uniquement': 'Show AI annotations only',
  'Filtrer par score de confiance': 'Filter by confidence score',
  'Non-Maximum Suppression — supprimer les doublons': 'Non-Maximum Suppression — remove duplicates',
  'Effacer filtre classe': 'Clear class filter',
  'NMS — Supprimer chevauchements': 'NMS — Remove overlaps',
  "Garde l'annotation avec la meilleure confiance.": 'Keeps the annotation with the best confidence.',
  'Appliquer NMS': 'Apply NMS',
  'Score min de confiance': 'Minimum confidence score',
  'Aucune annotation sur cette frame.': 'No annotation on this frame.',
  'Aucune annotation pour ce filtre.': 'No annotation for this filter.',
  'Clic = sélection | Shift+clic = sélection intervalle | Double-clic = zoom': 'Click = select | Shift+click = range select | Double-click = zoom',
  'IA': 'AI',
  'Interp.': 'Interp.',
  'Track (suivi objet)': 'Track (object tracking)',
  'nouvelle': 'new',
  'Supprimer cette annotation': 'Delete this annotation',
  'proposition': 'proposal',
  'non validées': 'not validated',
  'Validation…': 'Validating…',
  'Valider tout': 'Validate all',
  'Rejeter tout': 'Reject all',
  'Proposition': 'Proposal',
  'Valider → ajouter comme annotation': 'Validate -> add as an annotation',
  'Rejeter cette proposition': 'Reject this proposal',
  'Désélectionner': 'Deselect',
  'sél.': 'sel.',
  'Confirmer ?': 'Confirm?',
  'Supprimer toutes les annotations de cette frame': 'Delete all annotations on this frame',

  // components/sidebar/GlobalAnnotationsPanel.tsx
  'Erreur inconnue': 'Unknown error',
  'Impossible de charger le résumé.': 'Unable to load the summary.',
  'Erreur lors de la suppression batch': 'Error during batch deletion',
  'Erreur lors de la suppression': 'Error during deletion',
  'Résumé': 'Summary',
  'IA uniquement': 'AI only',
  'Score min': 'Min score',
  'Tout sél.': 'Select all',
  'Désél.': 'Deselect',
  'Réessayer': 'Retry',
  'Résumé indisponible': 'Summary unavailable',
  'Vérifiez que le serveur backend est démarré.': 'Check that the backend server is running.',
  'Aucune annotation dans ce projet.': 'No annotation in this project.',
  'Supprimer depuis frame N…': 'Delete from frame N…',
  "Supprime toutes les annotations à partir de la frame d'index :": 'Deletes all annotations from the frame at index:',
  'Ex: 50': 'e.g. 50',
  'Toutes': 'All',
  'IA seulement': 'AI only',

  // components/UserBadge.tsx
  'Ouvrir workspace': 'Open workspace',
  'Historique des workspaces': 'Workspace history',
  'Utilisateurs connectes': 'Connected users',
  'Workspaces recents': 'Recent workspaces',
  'Chargement…': 'Loading…',
  'Aucun utilisateur trouve.': 'No user found.',
  '(vous)': '(you)',
  'Ouvrir ce workspace': 'Open this workspace',
  'Aucun workspace utilise recemment.': 'No recently used workspace.',
  "Impossible d'ouvrir le dossier": 'Unable to open the folder',
  'Ouvrir le dossier': 'Open the folder',
  "L'application tourne sur le serveur distant : elle ne peut pas piloter l'Explorateur de votre poste. Le dossier reste accessible via le montage reseau.":
    "The application runs on the remote server: it cannot control your computer's file explorer. The folder remains accessible via the network share.",
  'Telecharger le raccourci .cmd': 'Download the .cmd shortcut',
  'Chemin copie': 'Path copied',
  'Copier': 'Copy',
  'Le .cmd contient une seule ligne (': 'The .cmd contains a single line (',
  " sur ce chemin) ; votre navigateur le telecharge, a vous de l'executer.":
    ' on this path); your browser downloads it, then you run it yourself.',

  // components/help/annotationTourSteps.ts
  'Bienvenue': 'Welcome',
  'Le tour complet en une dizaine de minutes': 'The full tour, about ten minutes',
  "Ce tutoriel construit avec vous un vrai projet, de la page d'accueil jusqu'a l'export : creation du projet, import d'images, classe d'objet, premiere boite, propagation automatique, nettoyage, export.":
    "This tutorial builds a real project with you, from the home page all the way to export: project creation, image import, object class, first box, automatic propagation, cleanup, export.",
  "Il utilise les 10 images de circulation livrees avec l'application : rien a telecharger, rien a preparer.":
    "It uses the 10 traffic images shipped with the application: nothing to download, nothing to prepare.",
  'Le projet s\'appellera "Template Cars Annotation". Il est supprimable a tout moment depuis l\'accueil (icone corbeille au survol de sa carte).':
    'The project will be called "Template Cars Annotation". It can be deleted at any time from the home page (trash icon when hovering its card).',
  "Echap ferme le tutoriel a tout moment. La page reste utilisable pendant le tour : vous pouvez cliquer et dessiner normalement.":
    "Escape closes the tutorial at any time. The page stays usable during the tour: you can click and draw normally.",
  'Ou vivent vos donnees': 'Where your data lives',
  "En bas a gauche : votre identifiant, et le bouton Workspace. Le workspace est le dossier qui contient TOUT -- projets, images importees, annotations, reglages. Un utilisateur, un workspace.":
    "Bottom left: your username, and the Workspace button. The workspace is the folder that holds EVERYTHING -- projects, imported images, annotations, settings. One user, one workspace.",
  "Ce menu ouvre le dossier, copie son chemin serveur, et quand l'application tourne sur une VM, traduit ce chemin en chemin reseau Windows.":
    "This menu opens the folder, copies its server path, and when the application runs on a VM, translates that path into a Windows network path.",
  'Les deux icones a cote listent les utilisateurs connectes et les workspaces recents.':
    'The two icons next to it list connected users and recent workspaces.',
  '1. Creer le projet': '1. Create the project',
  "Tout part d'ici. Un projet regroupe ses images, ses classes d'objets, ses annotations et ses pistes de suivi, dans son propre dossier du workspace.":
    "Everything starts here. A project groups its images, its object classes, its annotations and its tracking tracks, in its own folder of the workspace.",
  "Cliquez sur Suivant : le tutoriel ouvre la fenetre de creation pour vous.":
    "Click Next: the tutorial opens the creation window for you.",
  'Le nom du projet': 'The project name',
  "Le nom est repris partout : carte d'accueil, en-tete de la page d'annotation, et dossier de sortie a l'export. Choisissez-le parlant.":
    "The name is used everywhere: home page card, annotation page header, and output folder on export. Choose something meaningful.",
  'Le tutoriel a saisi "Template Cars Annotation" pour vous.': 'The tutorial has typed "Template Cars Annotation" for you.',
  'Image Random ou Sequence Image ?': 'Image Random or Sequence Image?',
  "Image Random : des images independantes, sans ordre. Pas de timeline, pas de suivi -- pour un dataset de detection classique.":
    "Image Random: independent images, with no order. No timeline, no tracking -- for a classic detection dataset.",
  "Sequence Image : des frames ordonnees (dossier d'images ou video). Debloque la timeline, les pistes de suivi et toute la propagation automatique.":
    "Sequence Image: ordered frames (image folder or video). Unlocks the timeline, tracking tracks and all automatic propagation.",
  "Notre demo suit des voitures d'une frame a l'autre : c'est donc Sequence Image. Suivant selectionne ce type.":
    "Our demo follows cars from one frame to the next: so it's Sequence Image. Next selects this type.",
  'Creer': 'Create',
  "A la creation, l'application prepare le dossier du projet, son fichier de classes et son etat de session (frame courante, zoom, outil actif) -- tout est restaure au prochain lancement.":
    "On creation, the application prepares the project folder, its class file and its session state (current frame, zoom, active tool) -- everything is restored on the next launch.",
  "Suivant cree reellement le projet.": "Next actually creates the project.",
  'Votre projet demo': 'Your demo project',
  "La carte orange signale un projet cree par le tutoriel. Elle affiche la progression d'annotation, le detail par sequence, et se supprime par l'icone corbeille qui apparait au survol.":
    "The orange card marks a project created by the tutorial. It shows annotation progress, detail per sequence, and can be deleted via the trash icon that appears on hover.",
  "Suivant ouvre le projet.": "Next opens the project.",
  '2. Importer les images': '2. Import the images',
  'Le projet est vide : importons des frames': 'The project is empty: time to import frames',
  "Un projet peut contenir plusieurs sequences (dossiers d'images et videos melanges). Chaque import en cree une.":
    "A project can contain several sequences (image folders and videos mixed together). Each import creates one.",
  "Suivant ouvre la fenetre d'import.": "Next opens the import window.",
  'Chemin serveur ou glisser-deposer ?': 'Server path or drag and drop?',
  "Chemin serveur : l'application pose un lien symbolique vers les images la ou elles sont deja. Zero copie, demarrage immediat -- la bonne methode pour un gros dataset ou un disque monte sur la machine du backend.":
    "Server path: the application creates a symbolic link to the images where they already are. Zero copy, instant start -- the right method for a large dataset or a disk mounted on the backend machine.",
  "Glisser-deposer : le navigateur televerse le contenu des fichiers (il ne peut jamais transmettre un chemin). Pratique pour quelques images locales, lourd au-dela.":
    "Drag and drop: the browser uploads the actual file contents (it can never transmit a path). Handy for a few local images, heavy beyond that.",
  "Le tutoriel a saisi le chemin des 10 images d'exemple livrees avec l'application.":
    "The tutorial has typed the path to the 10 sample images shipped with the application.",
  "Les 10 images d'exemple sont introuvables sur cette installation (dossier data_tuto a la racine de Computer_Vision_App) : saisissez vous-meme un chemin, ou utilisez le bouton Serveur pour parcourir les dossiers.":
    "The 10 sample images cannot be found on this installation (data_tuto folder at the root of Computer_Vision_App): type a path yourself, or use the Server button to browse folders.",
  'Nommer la sequence': 'Name the sequence',
  "Ce nom identifie la sequence dans le selecteur au-dessus de la timeline, et devient le sous-dossier YOLO ou le fichier .ver a l'export. Laisse vide, il reprend le nom du dossier source.":
    "This name identifies the sequence in the selector above the timeline, and becomes the YOLO subfolder or the .ver file on export. Left empty, it defaults to the source folder's name.",
  "Plus bas, les options d'optimisation reglent la decimation des videos (1 frame sur N), la qualite JPEG et les liens symboliques.":
    "Below, the optimization options control video decimation (1 frame out of N), JPEG quality and symbolic links.",
  'Importer en tache de fond': 'Import in the background',
  "L'import ne bloque pas : la fenetre se ferme et une barre de progression par sequence s'affiche en haut de l'ecran. Vous pouvez deja annoter les frames chargees.":
    "The import does not block: the window closes and a progress bar per sequence appears at the top of the screen. You can already annotate the frames that have loaded.",
  "Suivant lance l'import des 10 images.": "Next starts importing the 10 images.",
  "3. Reperage de l'ecran": "3. Finding your way around the screen",
  'A gauche : le suivi (tracking)': 'On the left: tracking',
  "Ce panneau porte tous les moteurs de propagation, un onglet chacun : SAMURAI (SAM2 + filtre de Kalman), Detect. (Grounding DINO / SAM3 / YOLO + appariement), Homogr. (XFeat/SIFT, camera mobile sur scene plane), Flux opt. (Lucas-Kanade, objet mobile devant camera fixe).":
    "This panel carries all the propagation engines, one tab each: SAMURAI (SAM2 + Kalman filter), Detect. (Grounding DINO / SAM3 / YOLO + matching), Homogr. (XFeat/SIFT, moving camera over a flat scene), Optical flow (Lucas-Kanade, moving object in front of a fixed camera).",
  "Une piste (track) relie les boites d'un meme objet a travers les frames. C'est elle qui porte l'identite de l'objet a l'export.":
    "A track links the boxes of a single object across frames. It's what carries the object's identity on export.",
  'En haut : annoter par texte (Grounding DINO / SAM3)': 'At the top: annotate by text (Grounding DINO / SAM3)',
  'Ce bouton ouvre un champ ou l\'on decrit ce qu\'on cherche en langage naturel : "voiture. personne. velo." Grounding DINO ou SAM3 detectent alors ces objets sans modele entraine sur votre dataset.':
    'This button opens a field where you describe what you are looking for in natural language: "car. person. bike." Grounding DINO or SAM3 then detect these objects with no model trained on your dataset.',
  "Les seuils Box et Txt arbitrent rappel et precision : bas = plus de detections et plus de faux positifs. Un bouton Batch applique le prompt a une plage de frames entiere.":
    "The Box and Txt thresholds balance recall and precision: low = more detections and more false positives. A Batch button applies the prompt to a whole range of frames.",
  "Attention : ces modeles ecrivent dans la classe active -- il faut donc avoir cree ET selectionne une classe avant, ce que nous faisons a l'etape suivante.":
    "Careful: these models write into the active class -- so you need to have created AND selected a class beforehand, which is what we do in the next step.",
  'A droite : classes, annotations, aide': 'On the right: classes, annotations, help',
  "Classes gere le vocabulaire du projet. Annots liste les boites de la frame courante (suppression, NMS, rattachement a une piste). Aide rappelle les raccourcis.":
    "Classes manages the project's vocabulary. Annots lists the boxes on the current frame (deletion, NMS, reattaching to a track). Help recalls the shortcuts.",
  'La largeur du panneau se regle en glissant son bord gauche.': "The panel's width is adjusted by dragging its left edge.",
  'En bas : la timeline': 'At the bottom: the timeline',
  "Une case par frame. Sa couleur dit si la frame est annotee, et le compteur combien d'objets elle porte. Cliquer une case y saute.":
    "One cell per frame. Its color says whether the frame is annotated, and the counter how many objects it carries. Clicking a cell jumps to it.",
  "Juste au-dessus apparaitront les pistes, sous forme de blocs horizontaux couvrant les frames ou l'objet est suivi.":
    "Just above, tracks will appear as horizontal blocks covering the frames where the object is tracked.",
  '4. Creer une classe': '4. Create a class',
  "Sans classe, pas d'annotation": "No class, no annotation",
  "Toute boite appartient a une classe. C'est la premiere chose a definir dans un nouveau projet.":
    "Every box belongs to a class. It's the first thing to define in a new project.",
  "AnnotationApp gere trois niveaux : classe (detection, obligatoire), sous-classe (reconnaissance), sous-sous-classe (identification). Exemple : voiture / berline / clio.":
    "AnnotationApp handles three levels: class (detection, mandatory), subclass (recognition), sub-subclass (identification). Example: car / sedan / clio.",
  "Suivant ouvre le formulaire de creation.": "Next opens the creation form.",
  'Nom de la classe': 'Class name',
  "Seul ce champ est obligatoire : il donne l'index de classe utilise a l'export YOLO. Les deux champs en dessous affinent la hierarchie et restent facultatifs.":
    "Only this field is required: it gives the class index used on YOLO export. The two fields below refine the hierarchy and remain optional.",
  'Le tutoriel a saisi "voiture".': 'The tutorial has typed "voiture".',
  'La couleur de la classe': 'The class color',
  "Elle sert partout : contour des boites sur le canvas, pastilles de la timeline, blocs de pistes. Prenez des couleurs franchement differentes si vous avez plusieurs classes.":
    "It's used everywhere: box outlines on the canvas, timeline dots, track blocks. Pick clearly different colors if you have several classes.",
  'Creer la classe': 'Create the class',
  "Suivant valide la creation.": "Next confirms the creation.",
  'Selectionner la classe active': 'Select the active class',
  "Creer une classe ne suffit pas : il faut cliquer dessus pour la rendre ACTIVE (elle se surligne en bleu). Toute nouvelle boite -- dessinee a la main, produite par Grounding DINO, SAM3 ou une propagation -- recoit cette classe.":
    "Creating a class is not enough: you need to click it to make it ACTIVE (it highlights in blue). Every new box -- drawn by hand, produced by Grounding DINO, SAM3 or a propagation -- gets this class.",
  "C'est l'oubli le plus frequent : sans classe active, les detections par texte refusent de se lancer.":
    "It's the most common thing people forget: without an active class, text detections refuse to run.",
  "Suivant selectionne la classe pour vous.": "Next selects the class for you.",
  '5. Annoter la premiere frame': '5. Annotate the first frame',
  'Se placer sur la bonne frame': 'Getting to the right frame',
  'Le curseur parcourt la sequence, les fleches gauche/droite avancent d\'une frame, et le champ "aller a" saute directement a un numero. Le selecteur a gauche bascule entre les sequences du projet.':
    'The slider moves through the sequence, the left/right arrow keys advance one frame, and the "go to" field jumps straight to a number. The selector on the left switches between the project\'s sequences.',
  "Nous restons sur la frame 1 : c'est de la premiere frame que partira la propagation.":
    "We stay on frame 1: propagation will start from the first frame.",
  'Se deplacer dans l\'image': 'Moving around the image',
  "Molette : zoom centre sur le curseur. Clic du milieu maintenu : deplacement (pan). Les commandes de zoom en haut a droite de la barre d'outils font la meme chose, et l'icone d'expansion recentre l'image.":
    "Scroll wheel: zoom centered on the cursor. Middle-click held down: pan. The zoom controls at the top right of the toolbar do the same thing, and the expand icon recenters the image.",
  "Au-dela de 150 % de zoom, l'application sert automatiquement l'image pleine resolution au lieu de l'apercu reduit.":
    "Beyond 150% zoom, the application automatically serves the full-resolution image instead of the reduced preview.",
  "Essayez la molette sur l'image, puis l'icone d'expansion pour recentrer.":
    "Try the scroll wheel over the image, then the expand icon to recenter.",
  "L'outil rectangle": "The rectangle tool",
  "Les outils, de gauche a droite : Selection (A) pour deplacer et redimensionner, Rectangle (R) pour une boite, Polygone (P) pour un contour, SAM Point (S) pour segmenter d'un clic, SAM Auto pour segmenter toute la frame.":
    "The tools, left to right: Selection (A) to move and resize, Rectangle (R) for a box, Polygon (P) for an outline, SAM Point (S) to segment with a click, SAM Auto to segment the whole frame.",
  "Suivant active l'outil Rectangle.": "Next activates the Rectangle tool.",
  'A vous : dessinez la premiere boite': 'Your turn: draw the first box',
  "Cliquez-glissez sur une voiture bien visible de la scene pour l'entourer. Une boite trop large fait deriver le suivi : serrez-la sur l'objet.":
    "Click and drag over a clearly visible car in the scene to surround it. A box that's too loose makes the tracking drift: keep it tight on the object.",
  "La boite est enregistree tout de suite, dans la classe active. Ctrl+Z annule, la touche Suppr efface la selection.":
    "The box is saved immediately, in the active class. Ctrl+Z undoes it, the Delete key erases the selection.",
  "Dessinez sur la frame affichee, celle que montre le curseur encadre en bas : c'est de CETTE frame que partira la propagation.":
    "Draw on the displayed frame, the one shown by the framed slider at the bottom: propagation will start from THIS frame.",
  "Dessinez une boite autour d'une voiture, puis cliquez sur Fait.": "Draw a box around a car, then click Done.",
  'Fait': 'Done',
  "En attente de votre premiere boite sur la frame affichee...": "Waiting for your first box on the displayed frame...",
  '6. Propager le suivi': '6. Propagate the tracking',
  'SAMURAI : une boite suffit': 'SAMURAI: one box is enough',
  "Le principe du logiciel est la : vous annotez UNE frame, le modele propage sur les suivantes. SAMURAI est SAM2 augmente d'un filtre de Kalman, qui arbitre entre les masques candidats en retenant celui qui colle au mouvement -- pas seulement au score.":
    "This is the software's core idea: you annotate ONE frame, the model propagates to the following ones. SAMURAI is SAM2 enhanced with a Kalman filter, which arbitrates between candidate masks by keeping the one that matches the motion -- not just the score.",
  "Il ne suit qu'une cible a la fois. Pour plusieurs objets : Auto bascule sur SAM2 multi-objets (une passe, rapide), ou SAMURAI / objet fait une passe Kalman par cible (meilleur, N fois plus lent).":
    "It only tracks one target at a time. For several objects: Auto switches to multi-object SAM2 (one pass, fast), or SAMURAI / object runs one Kalman pass per target (better, N times slower).",
  'Choisir la cible a suivre': 'Choosing the target to track',
  "La liste reprend les boites de la frame courante. Cochez celle qui servira de point de depart : c'est elle qui sert de prompt au modele.":
    "The list shows the boxes on the current frame. Check the one that will serve as the starting point: it's used as the prompt for the model.",
  "Deuxieme facon de cocher, souvent plus sure quand il y a du monde a l'ecran : DOUBLE-CLIQUER la boite sur le canvas. Les deux restent synchronises.":
    "A second way to check it, often more reliable when the screen is crowded: DOUBLE-CLICK the box on the canvas. The two stay in sync.",
  "Suivant coche votre boite.": "Next checks your box.",
  'Jusqu\'ou propager': 'How far to propagate',
  "Ce champ fixe la derniere frame traitee. Il peut etre INFERIEUR a la frame courante : la propagation remonte alors le temps, utile quand l'objet est deja entre en scene.":
    "This field sets the last frame processed. It can be LOWER than the current frame: propagation then goes back in time, useful when the object has already entered the scene.",
  'Le tutoriel a mis ': 'The tutorial has set ',
  ' : huit frames sur les dix importees, assez pour voir le suivi travailler sans monopoliser le GPU.':
    ': eight of the ten imported frames, enough to see the tracking work without hogging the GPU.',
  'Le nombre de frames pese sur le GPU': 'The number of frames weighs on the GPU',
  "En mode GPU rapide, SAM2 garde toutes les frames de la plage en memoire video : la jauge compare la plage demandee a la capacite estimee de votre carte. Au rouge, c'est le risque de saturation memoire.":
    "In fast GPU mode, SAM2 keeps every frame of the range in video memory: the gauge compares the requested range to your card's estimated capacity. In the red, that's the risk of memory saturation.",
  "Trois leviers quand la plage est trop longue : la reduire, decimer a l'import (1 frame sur N), ou activer l'offload CPU dans les parametres -- les frames passent alors en RAM, sans limite memoire mais 1,5 a 3 fois plus lent.":
    "Three levers when the range is too long: shorten it, decimate on import (1 frame out of N), or enable CPU offload in the settings -- the frames then move to RAM, with no memory limit but 1.5 to 3 times slower.",
  'Lancer la propagation': 'Launch the propagation',
  "Suivant lance le suivi ET attend sa fin : le tutoriel ne reprend qu'une fois la propagation terminee.":
    "Next starts the tracking AND waits for it to finish: the tutorial only resumes once propagation is complete.",
  "Une barre de progression apparait en haut de l'ecran avec un bouton d'arret carre rouge : la tache reste interruptible a tout instant. Pendant le calcul, le canvas suit la frame en cours et la timeline se remplit en direct (reglable dans Parametres > Interface).":
    "A progress bar appears at the top of the screen with a red square stop button: the task stays interruptible at any moment. While it runs, the canvas follows the current frame and the timeline fills in live (adjustable in Settings > Interface).",
  "Si SAMURAI n'est pas installe, le bouton bascule automatiquement sur SAM2 standard : le resultat est un peu moins robuste en occlusion, le workflow est identique.":
    "If SAMURAI is not installed, the button automatically falls back to standard SAM2: the result is slightly less robust under occlusion, the workflow is identical.",
  "Revenez sur la frame que vous avez annotee (curseur encadre en bas) et cochez une cible : le bouton reste grise sans cela.":
    "Go back to the frame you annotated (framed slider at the bottom) and check a target: the button stays grayed out without that.",
  "Regardez le resultat avant d'aller plus loin": "Check the result before moving on",
  "La propagation est terminee. Parcourez les frames avec le curseur, ou les fleches du clavier, et regardez la boite suivre la voiture toute seule.":
    "Propagation is complete. Scrub through the frames with the slider, or the arrow keys, and watch the box follow the car on its own.",
  "C'est le moment de juger : la boite colle-t-elle a l'objet ? derive-t-elle ? saute-t-elle sur un vehicule voisin ? Une passe ratee se voit en trois secondes ici, et se refait pour presque rien.":
    "This is the moment to judge: does the box stick to the object? does it drift? does it jump onto a neighboring vehicle? A failed pass shows up in three seconds here, and costs almost nothing to redo.",
  "Si les frames suivantes sont restees VIDES, la propagation n'a pas demarre (modele indisponible, ou bouton refuse) : revenez d'une etape avec Precedent et relancez-la.":
    "If the following frames stayed EMPTY, propagation did not start (model unavailable, or the button refused): go back a step with Previous and run it again.",
  "Faites defiler les frames et verifiez le suivi, puis cliquez sur Suivant.": "Scroll through the frames and check the tracking, then click Next.",
  'La zone des pistes': 'The tracks area',
  "Chaque ligne est une piste, chaque bloc colore la plage de frames ou l'objet est suivi. C'est la representation directe de ce que la propagation vient d'ecrire.":
    "Each row is a track, each colored block the range of frames where the object is tracked. It's the direct representation of what the propagation just wrote.",
  "Cliquer un bloc le selectionne et saute a son debut ; double-cliquer va a sa fin ; cliquer la zone grise selectionne la piste entiere. La poignee horizontale au-dessus agrandit cette zone.":
    "Clicking a block selects it and jumps to its start; double-clicking goes to its end; clicking the gray area selects the whole track. The horizontal handle above resizes this area.",
  'Corriger ce que le modele a rate': 'Fixing what the model missed',
  "Aucun suivi n'est parfait : il faut pouvoir effacer vite. Dans la timeline, Ctrl+clic ajoute ou retire une frame de la selection, Shift+clic selectionne toute une plage, Ctrl+A prend tout ; la touche Suppr vide alors les annotations des frames selectionnees.":
    "No tracking is perfect: you need to be able to clear things fast. In the timeline, Ctrl+click adds or removes a frame from the selection, Shift+click selects a whole range, Ctrl+A selects everything; the Delete key then clears the annotations of the selected frames.",
  "Sur les pistes : un bloc selectionne, Suppr efface ce seul bloc ; une piste selectionnee, Suppr efface la piste entiere et ses annotations.":
    "On tracks: with a block selected, Delete erases just that block; with a whole track selected, Delete erases the entire track and its annotations.",
  "Et sur le canvas, l'outil Selection (A) permet de reprendre une boite a la main, ou de l'effacer avec Suppr.":
    "And on the canvas, the Selection tool (A) lets you adjust a box by hand, or erase it with Delete.",
  "Essayez : Ctrl+clic sur deux cases de la timeline, puis Suppr pour vider ces deux frames.":
    "Try it: Ctrl+click two cells in the timeline, then Delete to clear those two frames.",
  '7. Suivre deux objets': '7. Tracking two objects',
  'Et quand il y a plusieurs objets ?': 'And when there are several objects?',
  "Une seule cible, c'etait le cas facile. Dans une scene reelle il y en a plusieurs, et c'est la que le choix de la strategie compte.":
    "A single target was the easy case. In a real scene there are several, and that's where the choice of strategy matters.",
  "On repart de la premiere frame et on y ajoute DEUX vehicules de plus. La boite du chapitre precedent reste : la frame en comptera donc trois, et c'est justement l'occasion de voir comment on designe precisement celles qu'on veut suivre.":
    "We go back to the first frame and add TWO more vehicles to it. The box from the previous chapter stays: the frame will therefore have three, and that's exactly the chance to see how to precisely pick the ones you want to track.",
  "Dessinez deux nouvelles boites, sur deux vehicules encore libres, puis cliquez sur Fait.":
    "Draw two new boxes, on two vehicles that are still free, then click Done.",
  'En attente de deux NOUVELLES boites sur cette frame...': 'Waiting for two NEW boxes on this frame...',
  'Designer les deux cibles : double-clic sur le canvas': 'Picking the two targets: double-click on the canvas',
  "DOUBLE-CLIQUEZ une boite sur l'image : elle devient cible de suivi. Un anneau pointille l'entoure aussitot, et sa case se coche dans la liste a gauche. Re-double-cliquer la retire.":
    "DOUBLE-CLICK a box on the image: it becomes a tracking target. A dotted ring immediately surrounds it, and its checkbox ticks in the list on the left. Double-clicking again removes it.",
  'C\'est plus sur que la liste quand la frame porte plusieurs objets : sur la liste, rien ne dit laquelle des lignes "voiture #12 / #13 / #14" est la voiture qui vous interesse.':
    'It\'s more reliable than the list when the frame carries several objects: on the list, nothing tells you which of the rows "car #12 / #13 / #14" is the car you are interested in.',
  "Choisissez DEUX cibles, et deux seulement. Le tutoriel a decoche celle du chapitre precedent.":
    "Pick TWO targets, and only two. The tutorial has unchecked the one from the previous chapter.",
  "Double-cliquez les deux vehicules a suivre, puis cliquez sur Fait.": "Double-click the two vehicles to track, then click Done.",
  "Double-cliquez exactement deux boites sur l'image...": "Double-click exactly two boxes on the image...",
  'Ce que la liste confirme': 'What the list confirms',
  "Vos deux double-clics ont coche exactement deux lignes ici : la liste et le canvas sont la meme selection, vue de deux endroits. Le numero en fin de ligne est l'identifiant de l'annotation, celui de l'anneau que vous venez de voir.":
    "Your two double-clicks checked exactly two rows here: the list and the canvas are the same selection, seen from two places. The number at the end of the row is the annotation's identifier, the one on the ring you just saw.",
  "Chaque cible cochee deviendra sa propre piste, avec son propre identifiant. Tout ce qui n'est PAS coche est ignore par la propagation -- la boite du chapitre precedent, par exemple, restera seule sur cette frame.":
    "Each checked target will become its own track, with its own identifier. Anything that is NOT checked is ignored by the propagation -- the box from the previous chapter, for example, will stay alone on this frame.",
  "Le tutoriel zoome sur la premiere cible pour que l'anneau soit bien visible.":
    "The tutorial zooms in on the first target so the ring is clearly visible.",
  'Cette fois : Segmentation': 'This time: Segmentation',
  "Meme propagation, autre sortie. BBox enregistre une boite englobante par frame ; Segmentation enregistre le contour exact du masque -- plus lourd, mais c'est ce qu'il faut pour entrainer un modele de segmentation, ou simplement pour mesurer une surface.":
    "Same propagation, different output. BBox saves a bounding box per frame; Segmentation saves the exact outline of the mask -- heavier, but it's what you need to train a segmentation model, or simply to measure an area.",
  "SAM2 travaille de toute facon sur des masques : le mode BBox ne fait que les resumer en rectangle. Passer en Segmentation ne coute donc aucun calcul supplementaire.":
    "SAM2 works on masks anyway: BBox mode just summarizes them as a rectangle. Switching to Segmentation therefore costs no extra computation.",
  "Suivant choisit Segmentation.": "Next selects Segmentation.",
  'Auto (rapide) : SAM2 multi-objets': 'Auto (fast): multi-object SAM2',
  "SAMURAI ne suit qu'une cible : son filtre de Kalman porte UN etat de mouvement. Avec deux cibles, il faut choisir.":
    "SAMURAI only tracks one target: its Kalman filter carries ONE motion state. With two targets, you have to choose.",
  "Auto (rapide) bascule sur SAM2 multi-objets : une seule passe video, les deux objets suivis ensemble, sans modele de mouvement. C'est le bon choix par defaut.":
    "Auto (fast) switches to multi-object SAM2: a single video pass, both objects tracked together, with no motion model. It's the right default choice.",
  "SAMURAI / objet refait une passe Kalman complete par cible : meilleur quand deux objets similaires se croisent ou s'occultent, mais deux fois plus long ici, N fois plus long avec N cibles.":
    "SAMURAI / object runs a full Kalman pass per target: better when two similar objects cross paths or occlude each other, but twice as long here, N times longer with N targets.",
  "Suivant selectionne Auto (rapide).": "Next selects Auto (fast).",
  'Propager les deux cibles': 'Propagate both targets',
  "Suivant relance la propagation -- sur vos DEUX cibles cochees, et sur elles seules -- en sortie segmentation et en une seule passe SAM2. Le tutoriel attend la fin avant de continuer.":
    "Next runs the propagation again -- on your TWO checked targets, and only them -- with segmentation output and in a single SAM2 pass. The tutorial waits for it to finish before continuing.",
  "Les annotations produites sont des polygones : sur le canvas, le contour colle a la carrosserie au lieu de l'encadrer.":
    "The annotations produced are polygons: on the canvas, the outline hugs the car body instead of framing it.",
  "Il faut exactement deux cibles cochees (double-clic sur le canvas), et aucune propagation en cours.":
    "You need exactly two checked targets (double-click on the canvas), and no propagation running.",
  'Deux contours qui se suivent': 'Two outlines tracking together',
  "Refaites defiler la sequence. Deux polygones progressent maintenant en parallele, chacun de la couleur de sa piste, et chacun colle a sa carrosserie au lieu de l'encadrer.":
    "Scroll through the sequence again. Two polygons now progress in parallel, each in its track's color, and each hugging its car body instead of framing it.",
  "Verifiez surtout les croisements : c'est la que SAM2 sans Kalman peut confondre deux vehicules. Si ca arrive sur vos donnees, c'est l'argument pour passer en SAMURAI / objet.":
    "Pay special attention to crossings: that's where SAM2 without Kalman can mix up two vehicles. If that happens on your data, it's the argument for switching to SAMURAI / object.",
  "Et s'il restait une boite non cochee sur la premiere frame, elle y est restee seule : la preuve que seules les cibles cochees partent en propagation.":
    "And if a box was left unchecked on the first frame, it stayed there alone: proof that only checked targets go into propagation.",
  "Parcourez les frames et comparez les deux pistes, puis cliquez sur Suivant.": "Scroll through the frames and compare the two tracks, then click Next.",
  'Deux pistes de plus': 'Two more tracks',
  "Deux nouvelles lignes sont apparues dans la zone des pistes : une par objet suivi, chacune avec son identifiant. C'est cet identifiant qui dit que c'est le meme vehicule d'une frame a l'autre, et c'est lui qui part a l'export .ver.":
    "Two new rows appeared in the tracks area: one per tracked object, each with its own identifier. It's this identifier that says it's the same vehicle from one frame to the next, and it's the one that goes into the .ver export.",
  "Chaque piste se selectionne et s'efface independamment : si le suivi a confondu deux vehicules, on supprime la piste fautive sans toucher a l'autre.":
    "Each track can be selected and erased independently: if tracking mixed up two vehicles, you can delete the faulty track without touching the other.",
  '8. Detecter par texte': '8. Detect by text',
  "L'onglet Detect. : la troisieme facon d'annoter": "The Detect. tab: the third way to annotate",
  "Jusqu'ici on a dessine a la main, puis propage un masque. Troisieme voie : laisser un detecteur trouver les objets par leur NOM, frame par frame.":
    "So far we have drawn by hand, then propagated a mask. Third way: let a detector find objects by their NAME, frame by frame.",
  "Deux endroits pour cela, et ils ne font pas la meme chose. En haut de l'ecran, le bouton Texte annote la frame courante (ou un lot de frames) sans aucune notion de piste. Ici, dans Detect., la detection est mise au service du SUIVI.":
    "There are two places for this, and they do not do the same thing. At the top of the screen, the Text button annotates the current frame (or a batch of frames) with no notion of track at all. Here, in Detect., detection is put to work for TRACKING.",
  "Suivant ouvre l'onglet.": "Next opens the tab.",
  'Le prompt de detection': 'The detection prompt',
  "On decrit les objets a trouver, separes par des points : voiture. camion. Grounding DINO ou SAM3 les cherchent alors dans TOUTE l'image, a chaque frame de la plage -- sans savoir ou etait l'objet avant.":
    "You describe the objects to find, separated by periods: car. truck. Grounding DINO or SAM3 then search for them across the WHOLE image, at every frame of the range -- with no idea where the object was before.",
  "Le modele est LE MEME que celui du bouton Texte de la barre du haut : meme appel, memes poids, memes seuils. Ce qui change, c'est la logique appliquee au resultat.":
    "The model is THE SAME as the one behind the Text button in the top bar: same call, same weights, same thresholds. What changes is the logic applied to the result.",
  "En haut : tout ce qui est trouve est conserve, sans aucune notion de piste. Ici : il FAUT des cibles cochees sur la frame courante, et seules les detections rattachees a une cible sont gardees -- tout le reste est jete. Meme detecteur, deux usages opposes.":
    "At the top: everything found is kept, with no notion of track at all. Here: you NEED checked targets on the current frame, and only detections attached to a target are kept -- everything else is discarded. Same detector, two opposite uses.",
  "L'algorithme se choisit juste au-dessus : GDINO, SAM3.1, ou un YOLO maison si un modele est configure dans les parametres.":
    "The algorithm is chosen just above: GDINO, SAM3.1, or a custom YOLO if a model is configured in the settings.",
  "Le tutoriel a saisi le prompt pour vous.": "The tutorial has typed the prompt for you.",
  'Detecter puis associer : distance au centroide': 'Detect then match: centroid distance',
  "Comme SAMURAI, ce mode part de vos boites de reference : il faut des cibles cochees sur la frame courante, sinon il ne saurait pas quelle piste continuer. C'est la difference majeure avec le bouton Texte du haut.":
    "Like SAMURAI, this mode starts from your reference boxes: it needs checked targets on the current frame, otherwise it would not know which track to continue. That's the major difference with the Text button at the top.",
  "A chaque frame, le detecteur rend un paquet de boites ANONYMES -- tous les objets qui repondent au nom. L'association se fait ensuite cible par cible : pour chacune, la detection la plus proche en distance de centroide, et seulement si elle tombe sous le seuil (Dist. max, 0,15 en coordonnees normalisees par defaut). Une detection deja prise n'est plus disponible pour une autre cible.":
    "At every frame, the detector returns a batch of ANONYMOUS boxes -- every object matching the name. Matching is then done target by target: for each one, the closest detection by centroid distance, and only if it falls under the threshold (Max dist., 0.15 in normalized coordinates by default). A detection already taken is no longer available for another target.",
  "La reference se deplace : c'est la boite de la frame PRECEDENTE qui sert de point de comparaison, pas celle du depart. Un objet rapide sort donc du seuil meme s'il reste dans l'image -- d'ou le reglage Dist. max, a monter pour du mouvement vif, a baisser quand plusieurs objets identiques se cotoient.":
    "The reference moves: it's the box from the PREVIOUS frame that serves as the comparison point, not the starting one. A fast object can therefore fall outside the threshold even while staying in the image -- hence the Max dist. setting, to raise for brisk motion, to lower when several identical objects are close together.",
  "Deux anomalies sont journalisees : aucune detection sous le seuil (la piste a un trou sur cette frame), et variation de surface superieure au seuil (l'annotation est quand meme creee, mais signalee : c'est le symptome d'une boite qui a saute sur un autre objet). L'auto-stop, plus bas, arrete la tache quand trop de cibles sont perdues plusieurs frames de suite.":
    "Two anomalies are logged: no detection under the threshold (the track has a gap on this frame), and a size variation above the threshold (the annotation is created anyway, but flagged: it's the symptom of a box that jumped onto another object). Auto-stop, further down, stops the task when too many targets are lost several frames in a row.",
  "Interet par rapport a SAMURAI : l'objet peut disparaitre puis revenir, ou changer d'echelle brutalement -- le detecteur le retrouve par son nom et la piste continue. Faiblesse : l'appariement est glouton, pris cible par cible dans l'ordre ; deux objets identiques et proches peuvent voir leurs identifiants echanges.":
    "Advantage over SAMURAI: the object can disappear then come back, or change scale abruptly -- the detector finds it again by its name and the track continues. Weakness: the matching is greedy, done target by target in order; two identical, nearby objects can have their identifiers swapped.",
  "Rien n'est lance ici : ce serait une troisieme passe sur la meme sequence.": "Nothing is run here: that would be a third pass over the same sequence.",
  "Cochez une cible puis cliquez sur ce bouton quand vous voudrez l'essayer.": "Check a target then click this button whenever you want to try it.",
  '9. Affichage et export': '9. Display and export',
  'La LUT : images 16 bits et contraste': 'The LUT: 16-bit images and contrast',
  "Ce bouton ouvre l'histogramme et le remappage d'affichage. Suivant l'ouvre pour de vrai.":
    "This button opens the histogram and the display remapping. Next actually opens it.",
  'Ce que la LUT change vraiment': 'What the LUT actually changes',
  "L'histogramme montre la distribution reelle des intensites de la frame. Sur une source 16 bits (PNG/TIFF, visible ou infrarouge), l'image reste 16 bits sur le disque : la LUT decide seulement quelle plage de valeurs devient le 0-255 affiche -- ET ce qui est envoye aux modeles.":
    "The histogram shows the frame's real intensity distribution. On a 16-bit source (PNG/TIFF, visible or infrared), the image stays 16-bit on disk: the LUT only decides which range of values becomes the displayed 0-255 -- AND what is sent to the models.",
  "Trois modes : 3-sigma par defaut (robuste au bruit), min/max (toute la dynamique), ou bornes manuelles quand on sait ou regarder. Le reglage se memorise par sequence.":
    "Three modes: 3-sigma by default (robust to noise), min/max (full dynamic range), or manual bounds when you know where to look. The setting is remembered per sequence.",
  "C'est l'outil qui rend exploitable une scene de nuit ecrasee dans les noirs, comme celle de ce tutoriel, sans jamais toucher aux fichiers d'origine.":
    "It's the tool that makes a night scene crushed into the blacks usable, like the one in this tutorial, without ever touching the original files.",
  "YOLO, COCO ou .ver": "YOLO, COCO or .ver",
  "YOLO : un fichier .txt par image, coordonnees normalisees, avec les splits train/val/test regles juste en dessous. Le format d'entrainement direct.":
    "YOLO: one .txt file per image, normalized coordinates, with the train/val/test splits set just below. The direct training format.",
  "COCO : un unique JSON par split, bbox en pixels, segmentation incluse pour les polygones issus de SAM.":
    "COCO: a single JSON per split, bbox in pixels, segmentation included for polygons coming from SAM.",
  ".ver : un fichier par sequence, une ligne par objet et par frame, coordonnees absolues en pixels avec l'identifiant de piste et la hierarchie de classes. C'est le format qui conserve le suivi.":
    ".ver: one file per sequence, one line per object and per frame, absolute pixel coordinates with the track identifier and the class hierarchy. It's the format that preserves the tracking.",
  "La page Convert, depuis l'accueil, retraduit ces formats entre eux apres coup.":
    "The Convert page, from the home screen, translates between these formats afterward.",
  "Lancer l'export": "Launch the export",
  "L'export ecrit dans le dossier choisi plus bas. En mode local, l'option liens symboliques evite de dupliquer les images ; sinon un ZIP est produit.":
    "The export writes into the folder chosen below. In local mode, the symbolic links option avoids duplicating the images; otherwise a ZIP is produced.",
  "Nous n'exportons rien maintenant : Suivant referme simplement la fenetre.":
    "We are not exporting anything right now: Next simply closes the window.",
  '10. Pour aller plus loin': '10. Going further',
  'Les parametres': 'The settings',
  "Tout ce que le tutoriel a effleure s'y regle et s'y memorise : seuils des modeles, offload CPU de SAM2, auto-stop du suivi, qualite des apercus, opacite des annotations, ratios d'export.":
    "Everything the tutorial touched on is set and remembered here: model thresholds, SAM2 CPU offload, tracking auto-stop, preview quality, annotation opacity, export ratios.",
  "Les valeurs vivent dans votre workspace : elles vous suivent d'une session a l'autre.":
    "The values live in your workspace: they follow you from one session to the next.",
  "L'aide, et comment relancer ce tutoriel": "Help, and how to relaunch this tutorial",
  "Cette fenetre rassemble tout ce que le tutoriel a survole : la liste complete des raccourcis clavier, la description de chaque outil, de chaque mode et de chaque modele, et le workflow recommande. C'est la ou revenir quand un geste s'oublie.":
    "This window gathers everything the tutorial skimmed over: the full list of keyboard shortcuts, the description of every tool, every mode and every model, and the recommended workflow. This is the place to come back to when a gesture is forgotten.",
  "Son onglet Workflow porte aussi un bouton qui relance ce tutoriel depuis le debut. Et c'est exactement le meme bouton orange que celui par lequel vous l'avez lance, sur la page d'accueil : le tour est rejouable autant de fois que vous voulez, sans rien casser.":
    "Its Workflow tab also carries a button that relaunches this tutorial from the start. And it's exactly the same orange button you used to launch it, on the home page: the tour can be replayed as many times as you want, without breaking anything.",
  '11. Un projet Image Random': '11. An Image Random project',
  'Retour a l\'accueil': 'Back to the home page',
  "Cette fleche ramene a la liste des projets, sans rien perdre : la frame courante, le zoom et l'outil actif du projet sont memorises et restaures au prochain passage.":
    "This arrow takes you back to the project list, without losing anything: the project's current frame, zoom and active tool are remembered and restored next time.",
  "On va creer un SECOND projet, de l'autre type, pour voir ce qui change.": "We are going to create a SECOND project, of the other type, to see what changes.",
  "Suivant retourne a l'accueil.": "Next goes back to the home page.",
  'Nouveau projet, deuxieme type': 'New project, second type',
  "Suivant rouvre la fenetre de creation.": "Next reopens the creation window.",
  'Un nom, et surtout un autre type': 'A name, and above all a different type',
  'Le tutoriel a saisi "Template Traffic Lights".': 'The tutorial has typed "Template Traffic Lights".',
  "Cette fois on choisit Image Random : un jeu d'images INDEPENDANTES, sans ordre temporel.":
    "This time we choose Image Random: a set of INDEPENDENT images, with no temporal order.",
  'Image Random : ce que ca retire': 'Image Random: what it removes',
  "Pas de timeline, pas de pistes, pas de propagation : deux images voisines n'ont aucune raison d'etre liees. Le panneau de suivi a gauche disparait purement et simplement.":
    "No timeline, no tracks, no propagation: two neighboring images have no reason to be linked. The tracking panel on the left simply disappears.",
  "C'est le mode a prendre pour un dataset de detection classique -- des images sans continuite, annotees une par une ou en lot.":
    "It's the mode to use for a classic detection dataset -- images with no continuity, annotated one by one or in batch.",
  "Suivant selectionne ce type, puis cree le projet.": "Next selects this type, then creates the project.",
  'Les memes images, en vrac': 'The same images, in bulk',
  "On reimporte le meme dossier d'exemple : cette fois l'application n'y verra qu'un lot de 10 images sans ordre.":
    "We reimport the same sample folder: this time the application will see it only as a batch of 10 unordered images.",
  "Suivant ouvre l'import, remplit le chemin et lance.": "Next opens the import, fills in the path and starts it.",
  'Une classe pour ce projet': 'A class for this project',
  'Les classes appartiennent au PROJET : ce nouveau projet repart d\'une liste vide, la classe "voiture" du precedent n\'existe pas ici.':
    'Classes belong to the PROJECT: this new project starts from an empty list, the "voiture" (car) class from the previous one does not exist here.',
  'Le tutoriel cree "traffic light" et la selectionne comme classe active.':
    'The tutorial creates "traffic light" and selects it as the active class.',
  'Classe active : obligatoire pour le texte': 'Active class: required for text',
  "La classe est surlignee en bleu : elle est active. Grounding DINO et SAM3 refusent de se lancer sans cela -- ils doivent savoir dans quelle classe ranger ce qu'ils trouvent.":
    "The class is highlighted in blue: it's active. Grounding DINO and SAM3 refuse to run without this -- they need to know which class to file their findings under.",
  "C'est l'erreur numero un sur l'annotation par texte.": "It's the number one mistake with text annotation.",
  'Annoter par texte, pour de vrai': 'Annotate by text, for real',
  "Ce bouton ouvre la zone de detection par texte. Suivant l'ouvre.": "This button opens the text detection area. Next opens it.",
  'Decrire ce qu\'on cherche': "Describe what you're looking for",
  "GD est selectionne a gauche : Grounding DINO, un detecteur open-vocabulary -- il n'a jamais ete entraine sur VOS classes, il comprend la description.":
    "GD is selected on the left: Grounding DINO, an open-vocabulary detector -- it was never trained on YOUR classes, it understands the description.",
  'Le tutoriel a saisi "traffic light" (ces modeles sont entraines en anglais : les termes anglais marchent nettement mieux).':
    'The tutorial has typed "traffic light" (these models are trained in English: English terms work noticeably better).',
  "Box et Txt a cote sont les seuils : les baisser ramene plus de detections et plus de faux positifs.":
    "Box and Txt next to it are the thresholds: lowering them brings back more detections and more false positives.",
  'Tout le lot, pas seulement cette image': 'The whole batch, not just this image',
  "Ce bouton affiche la plage de frames traitees : par defaut, de l'image courante a la derniere -- donc les 10 images.":
    "This button shows the range of frames processed: by default, from the current image to the last -- so all 10 images.",
  "A cote, Batch lance la detection sur toute cette plage, image par image, avec pause et arret possibles. Sans lui, la baguette magique n'annote que l'image affichee.":
    "Next to it, Batch runs detection over that whole range, image by image, with pause and stop available. Without it, the magic wand only annotates the displayed image.",
  'Lancer le lot': 'Run the batch',
  "Suivant lance la detection sur les 10 images. Une barre de progression apparait en haut, les pastilles de la timeline se remplissent au fur et a mesure.":
    "Next runs detection on the 10 images. A progress bar appears at the top, the timeline dots fill in as it goes.",
  "Si Grounding DINO n'est pas installe cote serveur, un message d'erreur s'affiche a la place : le reste du tutoriel n'en depend pas.":
    "If Grounding DINO is not installed server-side, an error message appears instead: the rest of the tutorial does not depend on it.",
  'Regardez ce que le detecteur a trouve': 'Check what the detector found',
  'Parcourez les 10 images. Chaque feu tricolore reconnu porte une boite dans la classe "traffic light", avec son score de confiance.':
    'Scroll through the 10 images. Every recognized traffic light carries a box in the "traffic light" class, with its confidence score.',
  "Regardez aussi ce qui MANQUE, et ce qui est en trop : un feu de dos, un feu lointain, un phare arriere pris pour un feu. C'est exactement le travail qui reste -- corriger a la main ce que le detecteur a rate, puis baisser ou remonter les seuils Box et Txt en consequence.":
    "Also look at what's MISSING, and what's extra: a light seen from behind, a distant light, a taillight mistaken for a traffic light. That's exactly the work that remains -- fixing by hand what the detector missed, then lowering or raising the Box and Txt thresholds accordingly.",
  "Si rien n'apparait, Grounding DINO n'est probablement pas installe cote serveur : le reste du tutoriel n'en depend pas.":
    "If nothing appears, Grounding DINO is probably not installed server-side: the rest of the tutorial does not depend on it.",
  "Faites defiler les images et jugez les detections, puis cliquez sur Suivant.": "Scroll through the images and judge the detections, then click Next.",
  'Aucune piste, et c\'est voulu': "No tracks, and that's intentional",
  "Regardez a gauche : pas de panneau de suivi. Les detections de l'image 3 n'ont aucun lien avec celles de l'image 4 -- rien ne dit que c'est le meme feu tricolore, et en Image Random la question ne se pose pas.":
    "Look on the left: no tracking panel. The detections on image 3 have no link to those on image 4 -- nothing says it's the same traffic light, and in Image Random the question doesn't even arise.",
  "L'export reflete cela : des boites par image, sans identifiant de piste. C'est exactement ce qu'attend un entrainement de detection.":
    "The export reflects this: boxes per image, with no track identifier. It's exactly what a detection training run expects.",
  "Resume des deux types : Sequence Image quand le temps compte (suivi, propagation, pistes), Image Random quand chaque image est un cas independant.":
    "Summary of the two types: Sequence Image when time matters (tracking, propagation, tracks), Image Random when every image is an independent case.",
  '12. Pour finir': '12. To finish',
  "Suivant revient a la liste des projets : vos deux projets de demonstration y sont, en orange.":
    "Next goes back to the project list: your two demo projects are there, in orange.",
  "Les outils de l\'accueil": "The home page tools",
  "Presentation : la documentation de fond de l'application. On y entre dans un instant.":
    "Presentation: the application's in-depth documentation. We'll go in shortly.",
  "Convert : traduire des annotations existantes entre .ver, YOLO et COCO, sans passer par un projet.":
    "Convert: translate existing annotations between .ver, YOLO and COCO, without going through a project.",
  "Parametres : tous les reglages, memorises dans votre workspace.": "Settings: all the settings, remembered in your workspace.",
  "Monitoring : la part d'automatique et de manuel dans vos annotations, et les reprises humaines. On commence par celui-la.":
    "Monitoring: the share of automatic and manual work in your annotations, and human reworks. We'll start with this one.",
  'Monitoring : mesurer ce que l\'automatique a fait': 'Monitoring: measuring what automation has done',
  "La question que pose toute equipe d'annotation : qu'est-ce que le suivi automatique nous a REELLEMENT fait gagner ? Cette page y repond avec les chiffres de votre workspace.":
    "The question every annotation team asks: what has automatic tracking REALLY saved us? This page answers it with your workspace's numbers.",
  "Suivant y entre.": "Next goes in.",
  'Automatique, manuel, retouche': 'Automatic, manual, reworked',
  "Trois chiffres portent tout le sens de la page. Automatique : ce qu'un modele a produit (propagation, detection par texte, SAM). Manuel : ce que vous avez dessine vous-meme. Retouchees : les annotations automatiques qu'un humain a reprises a la main.":
    "Three numbers carry the whole point of this page. Automatic: what a model produced (propagation, text detection, SAM). Manual: what you drew yourself. Reworked: automatic annotations that a human corrected by hand.",
  "Le rapport retouchees / automatiques est la vraie mesure de qualite d'un modele sur VOS donnees : beaucoup d'automatique jamais retouche, c'est du temps gagne ; beaucoup d'automatique retouche, c'est un modele ou des seuils a revoir.":
    "The ratio of reworked to automatic is the real quality measure of a model on YOUR data: a lot of automatic work never reworked means time saved; a lot of automatic work reworked means a model or thresholds worth reviewing.",
  "Les annotations de ce tutoriel y figurent deja : vos boites dessinees a la main en manuel, celles de la propagation et du batch en automatique.":
    "This tutorial's annotations already show up here: the boxes you drew by hand under manual, the ones from propagation and batch under automatic.",
  'Moi, ou tous les utilisateurs': 'Me, or all users',
  "Moi ne lit que votre workspace. Tous les utilisateurs balaye les workspaces voisins sur la meme machine : utile quand plusieurs personnes annotent le meme lot et qu'il faut savoir ou en est le travail.":
    "Me only reads your workspace. All users scans neighboring workspaces on the same machine: useful when several people are annotating the same batch and you need to know how the work is progressing.",
  "Aucune ecriture n'a lieu ici : la page ne fait que lire les bases des projets.": "No writing happens here: the page only reads the projects' databases.",
  'Detail par sequence, ou vue globale': 'Detail per sequence, or global view',
  "Detail descend a la sequence et a la provenance : quelle sequence est finie, laquelle est a moitie annotee, quelle part vient de quel modele.":
    "Detail drills down to the sequence and its source: which sequence is finished, which is half-annotated, which share comes from which model.",
  "Global somme tout et compare les utilisateurs entre eux -- c'est la vue de suivi d'equipe.":
    "Global sums everything up and compares users against each other -- it's the team tracking view.",
  'Emporter le rapport': 'Taking the report with you',
  "Ce bouton produit un HTML autonome, graphiques compris : lisible hors ligne, joignable a un point d'avancement, sans donner acces a l'application.":
    "This button produces a standalone HTML file, charts included: readable offline, attachable to a status update, without giving access to the application.",
  'Presentation : le pourquoi': 'Presentation: the why',
  "Une visite NON interactive de l'application : les algorithmes employes, les choix techniques, les optimisations, le detail de chaque mode.":
    "A NON-interactive tour of the application: the algorithms used, the technical choices, the optimizations, the detail of every mode.",
  "Ce tutoriel-ci montrait le geste ; la Presentation explique le pourquoi. Suivant y entre.":
    "This tutorial showed the how; the Presentation explains the why. Next goes in.",
  'La documentation complete': 'The full documentation',
  "Pour l'utilisateur : Guide utilisateur (chaque ecran et chaque bouton), Procedures (les taches pas a pas), Concepts (SAM2, SAMURAI, Grounding DINO, XFeat, flux optique : ce que chacun fait et quand le prendre).":
    'For users: User guide (every screen and button), Workflows (step-by-step tasks), Concepts (SAM2, SAMURAI, Grounding DINO, XFeat, optical flow: what each one does and when to use it).',
  "Installation et depannage : Configuration (installation, poids des modeles, workspace) et Depannage (symptome, cause, solution). Pour le developpeur : Architecture, Reference API et Carte du code.":
    'Setup and troubleshooting: Configuration (installation, model weights, workspace) and Troubleshooting (symptom, cause, solution). For developers: Architecture, API reference and Code map.',
  "Chaque page a son sommaire a gauche : quand une question reste apres ce tutoriel, la reponse est dans l'une de ces pages.":
    'Each page has its table of contents on the left: when a question remains after this tutorial, the answer is in one of these pages.',
  "Ouvrez une page ou deux si vous voulez jeter un oeil, puis cliquez sur Suivant.": 'Open a page or two if you want to take a look, then click Next.',
  'Termine': 'Done',
  'Vous avez fait le tour': "You've completed the tour",
  "Deux projets, les deux types, les trois facons d'annoter : a la main, par propagation SAMURAI/SAM2, et par texte avec Grounding DINO. Plus le nettoyage, les pistes multiples, la LUT et l'export.":
    "Two projects, both types, the three ways to annotate: by hand, by SAMURAI/SAM2 propagation, and by text with Grounding DINO. Plus cleanup, multiple tracks, the LUT and export.",
  'Les projets "Template Cars Annotation" et "Template Traffic Lights" vous appartiennent : continuez a jouer avec, ou supprimez-les depuis l\'accueil par l\'icone corbeille de leur carte.':
    'The "Template Cars Annotation" and "Template Traffic Lights" projects are yours: keep playing with them, or delete them from the home page via their card\'s trash icon.',
  "Ce tutoriel se relance a tout moment par le bouton orange de l'accueil, ou depuis Aide > Workflow.":
    "This tutorial can be relaunched at any time from the orange button on the home page, or from Help > Workflow.",
  'Bon annotage.': 'Happy annotating.',

  // ---- TabOverview.tsx ----
  'Canvas interactif 3 couches': '3-layer interactive canvas',
  'Konva.js : image de fond, annotations (BBox + polygones), overlay interactif (SAM points, masques streamés).':
    'Konva.js: background image, annotations (BBox + polygons), interactive overlay (SAM points, streamed masks).',
  'Timeline sparse': 'Sparse timeline',
  'Cellules virtualisees vert/rouge avec compteur d annotations en direct, selection batch Ctrl/Shift + Suppr.':
    'Virtualized green/red cells with a live annotation counter, batch selection with Ctrl/Shift + Delete.',
  'Propagation multi-méthodes': 'Multi-method propagation',
  'SAMURAI, Detect. GD/SAM3, homographie XFeat/SIFT et flux optique.':
    'SAMURAI, GD/SAM3 detection, XFeat/SIFT homography and optical flow.',
  'Annotation par texte': 'Text-based annotation',
  'Grounding DINO détecte les objets par description textuelle, SAM2 raffine en masques précis.':
    'Grounding DINO detects objects from a text description, SAM2 refines them into precise masks.',
  'Format YOLO v8 avec split train/val/test configurable, data.yaml généré, coordonnées normalisées [0,1].':
    'YOLO v8 format with a configurable train/val/test split, generated data.yaml, coordinates normalized to [0,1].',
  'Undo / Redo (50 niveaux)': 'Undo / Redo (50 levels)',
  'Snapshots JSON complets par frame, restauration instantanée, persistance de session toutes les 2 minutes.':
    'Full JSON snapshots per frame, instant restore, session persisted every 2 minutes.',
  'Copier / Coller': 'Copy / Paste',
  "Copie des annotations entre frames, presse-papier persistant dans la session d'annotation.":
    'Copies annotations between frames, clipboard persists across the annotation session.',
  'NMS & détection doublons': 'NMS & duplicate detection',
  "Non-Maximum Suppression configurable (seuil IoU) et détection d'overlaps entre annotations.":
    'Configurable Non-Maximum Suppression (IoU threshold) and overlap detection between annotations.',
  'Outil Sélection': 'Selection tool',
  'Outil Rectangle (bounding box)': 'Rectangle tool (bounding box)',
  'Outil Polygone (segmentation)': 'Polygon tool (segmentation)',
  'Outil Point SAM': 'SAM point tool',
  'Bascule le mode review rapide': 'Toggles quick review mode',
  'Clic milieu': 'Middle click',
  'Panorama (pan) de la vue': 'Pan the view',
  'Frame précédente / suivante': 'Previous / next frame',
  'Sélectionner une classe (si une touche lui est assignée)': 'Select a class (if a key is assigned to it)',
  'Supprimer annotation(s) sélectionnée(s)': 'Delete selected annotation(s)',
  'Annuler / Rétablir (50 niveaux)': 'Undo / Redo (50 levels)',
  'Copier / Coller annotations': 'Copy / Paste annotations',
  'Échap': 'Esc',
  'Annuler dessin en cours / Désélectionner': 'Cancel current drawing / Deselect',
  'Shift+clic': 'Shift+click',
  'Multi-sélection dans la liste': 'Multi-select in the list',
  'Double-clic box': 'Double-click box',
  '(Dé)marquer la box comme cible de tracking': '(Un)mark the box as a tracking target',
  [`dataset/
├── train/
│   ├── images/
│   │   └── frame_0001.jpg
│   └── labels/           # Bounding box
│       └── frame_0001.txt
├── val/   └── test/
└── data.yaml

# data.yaml
path: /dataset
train: train/images
val:   val/images
nc: 3
names: [voiture, personne, velo]

# labels/frame_0001.txt — une ligne par objet
# class_id  cx    cy    w     h      (coords normalisées [0,1])
0           0.512 0.438 0.234 0.312
1           0.210 0.680 0.115 0.220`]: `dataset/
├── train/
│   ├── images/
│   │   └── frame_0001.jpg
│   └── labels/           # Bounding box
│       └── frame_0001.txt
├── val/   └── test/
└── data.yaml

# data.yaml
path: /dataset
train: train/images
val:   val/images
nc: 3
names: [car, person, bike]

# labels/frame_0001.txt -- one line per object
# class_id  cx    cy    w     h      (coordinates normalized to [0,1])
0           0.512 0.438 0.234 0.312
1           0.210 0.680 0.115 0.220`,
  [`dataset/
├── train/
│   ├── images/
│   │   └── frame_0001.jpg
│   └── seg_labels/       # Segmentation (polygones)
│       └── frame_0001.txt
└── seg_data.yaml

# seg_data.yaml — même format que data.yaml

# seg_labels/frame_0001.txt — une ligne par objet
# class_id  x1    y1    x2    y2    x3    y3    ...  (polygone normalisé)
0           0.51  0.42  0.54  0.40  0.58  0.43  0.55 0.47
1           0.21  0.67  0.25  0.65  0.28  0.70  ...`]: `dataset/
├── train/
│   ├── images/
│   │   └── frame_0001.jpg
│   └── seg_labels/       # Segmentation (polygons)
│       └── frame_0001.txt
└── seg_data.yaml

# seg_data.yaml -- same format as data.yaml

# seg_labels/frame_0001.txt -- one line per object
# class_id  x1    y1    x2    y2    x3    y3    ...  (normalized polygon)
0           0.51  0.42  0.54  0.40  0.58  0.43  0.55 0.47
1           0.21  0.67  0.25  0.65  0.28  0.70  ...`,
  'Liste des projets': 'List projects',
  'Import vidéo → frames (ffmpeg)': 'Import video → frames (ffmpeg)',
  "Annotations d'une frame": 'Annotations for a frame',
  'Créer une annotation': 'Create an annotation',
  'Remplacer toutes les annotations': 'Replace all annotations',
  'SAM2 — prédiction par points': 'SAM2: point-based prediction',
  'WebSocket — auto-segmentation streamée': 'WebSocket: streamed auto-segmentation',
  'Propagation homographie / flux optique': 'Homography / optical flow propagation',
  'Export YOLO (tâche async)': 'YOLO export (async task)',
  'Statut tâche export': 'Export task status',
  'Télécharger le ZIP export': 'Download the export ZIP',
  'Santé du serveur + état SAM/DINO': 'Server health + SAM/DINO status',
  "Application web d'annotation semi-automatique de datasets visuels avec assistance IA.":
    'Web application for semi-automatic annotation of visual datasets with AI assistance.',
  'Deux modes :': 'Two modes:',
  'pour les jeux de données non-séquentiels,': 'for non-sequential datasets,',
  'pour les vidéos avec propagation automatique des labels.': 'for videos with automatic label propagation.',
  'Fonctionnalités Clés': 'Key Features',
  'Raccourcis Clavier': 'Keyboard Shortcuts',
  'Touche': 'Key',
  'Format de Sortie — YOLO v8': 'Output Format: YOLO v8',
  'Detection — Bounding Box': 'Detection: Bounding Box',
  'Chaque ligne de label =': 'Each label line =',
  'avec toutes les coordonnées normalisées dans': 'with all coordinates normalized to',
  'Le centre': 'The center',
  "est relatif à la largeur/hauteur de l'image.": 'is relative to the image width/height.',
  'Compatible directement avec': 'Directly compatible with',
  'Segmentation — Polygones': 'Segmentation: Polygons',
  'Chaque ligne =': 'Each line =',
  "Les points du polygone sont les contours de l'objet normalisés dans": "The polygon points are the object's contours, normalized to",
  'Généré automatiquement quand des annotations de type': 'Automatically generated when annotations of type',
  'polygone': 'polygon',
  'sont présentes.': 'are present.',
  'Compatible avec': 'Compatible with',
  'Coordonnées normalisées': 'Normalized coordinates',
  'cx cy w h dans [0,1] pour bbox. x1 y1 … xN yN pour polygones. Jamais de pixels en base.':
    'cx cy w h in [0,1] for bbox. x1 y1 ... xN yN for polygons. Never raw pixels.',
  'Split configurable': 'Configurable split',
  'Ratio train/val/test personnalisable. Stratification par projet pour un split équilibré.':
    'Customizable train/val/test ratio. Per-project stratification for a balanced split.',
  'data.yaml auto': 'Auto data.yaml',
  'Généré avec mapping classe_index → nom de classe. Un fichier par format (bbox et seg).':
    'Generated with a class_index -> class name mapping. One file per format (bbox and seg).',
  'Import des Sources — Architecture de Stockage': 'Source Import: Storage Architecture',
  'Provenance serveur (zéro copie)': 'Server-side source (zero copy)',
  'MP4 serveur : scan lazy des métadonnées → extraction JPEG en arrière-plan dans data/projects/{id}/frames/.':
    'Server MP4: lazy metadata scan, JPEG extraction in the background into data/projects/{id}/frames/.',
  'Dossier images serveur : lien symbolique par défaut (aucune copie), ou copie optionnelle.':
    'Server image folder: symbolic link by default (no copy), or optional copy.',
  'Format optionnel serveur : traitement délégué à l’adaptateur détecté, sans logique propriétaire dans le frontend.':
    'Optional server format: processing delegated to the detected adapter, with no format-specific logic in the frontend.',
  'Barre de progression commune à toutes les sources séquentielles.': 'Progress bar shared by all sequential sources.',
  'Upload local (réseau → disque)': 'Local upload (network -> disk)',
  'MP4 upload : envoi par chunks de N MB (défaut 8 MB). RAM Python max = N MB, même pour 10 Go.':
    'MP4 upload: sent in N MB chunks (default 8 MB). Max Python RAM = N MB, even for 10 GB.',
  'Format optionnel : upload par chunks, puis traitement défini par son adaptateur backend.':
    'Optional format: chunked upload, then processing defined by its backend adapter.',
  "Images upload : batch multipart, format d'origine préservé (PNG → PNG, JPG → JPG, aucune recompression).":
    'Image upload: multipart batch, original format preserved (PNG → PNG, JPG → JPG, no recompression).',
  'Aucune miniature generee : la timeline affiche des compteurs d annotations (vert/rouge), zero cout d extraction.':
    'No thumbnails generated: the timeline shows annotation counters (green/red), zero extraction cost.',
  'Adaptateurs de format optionnels': 'Optional format adapters',
  'Chaque adaptateur est un fichier Python autonome avec métadonnées et fonctions de lecture.':
    'Each adapter is a standalone Python file with metadata and reader functions.',
  'Le frontend interroge /api/capabilities et ne connaît aucun nom de format en dur.':
    'The frontend queries /api/capabilities and has no hardcoded format names.',
  'Supprimer un adaptateur retire son extension du glisser-déposer sans bloquer le démarrage.':
    'Removing an adapter drops its extension from drag-and-drop without blocking startup.',
  'Les formats présents restent compatibles avec le chemin serveur et l’upload navigateur.':
    'Existing formats remain compatible with both the server path and browser upload.',
  'Navigation et RAM — 0 octet conservé': 'Navigation and RAM: 0 bytes retained',
  'Navigateur web : image HTTP à la volée. VisionNexus Electron : app-image tente le chemin natif local/SMB, puis replie automatiquement sur HTTP. Aucune frame pré-chargée en RAM Python.':
    'Web browser: HTTP image on the fly. VisionNexus Electron: app-image tries the native local/SMB path first, then automatically falls back to HTTP. No frame is preloaded into Python RAM.',
  'RAM extraction : 1 frame décodée à la fois (~6 MB pour 1080p, ~25 MB pour 4K). Libérée après écriture.':
    'Extraction RAM: 1 frame decoded at a time (~6 MB for 1080p, ~25 MB for 4K). Freed after writing.',
  'Metadonnees chargees en une passe large, timeline virtualisee sans vignettes : seules les cellules visibles sont rendues.':
    'Metadata loaded in one broad pass, virtualized timeline with no thumbnails: only visible cells are rendered.',
  "Export symlink (défaut) : dossier YOLO avec liens, 0 copie d'image. Export copie → ZIP téléchargeable.":
    'Symlink export (default): YOLO folder with links, 0 image copies. Copy export → downloadable ZIP.',
  'API REST — Résumé des Endpoints': 'REST API: Endpoint Summary',

  // ---- TabUsage.tsx ----
  "1. Import d'images": '1. Importing images',
  'Depuis la page des projets, créez un projet de type': 'From the projects page, create a project of type',
  "puis accédez à l'annotation. Cliquez sur": 'then open the annotation view. Click',
  'Importer des images': 'Import images',
  'dans la barre latérale.': 'in the sidebar.',
  'Formats supportés :': 'Supported formats:',
  'Upload multipart en lot — plusieurs fichiers sélectionnables en une fois': 'Batch multipart upload: select several files at once',
  'Miniatures (160×90) générées automatiquement côté serveur': 'Thumbnails (160×90) generated automatically server-side',
  'Les images sont servies à': 'Images are served at',
  'Astuce organisation': 'Organization tip',
  'Créez autant de classes que nécessaire via le bouton': 'Create as many classes as needed via the',
  'Classe': 'Class',
  "avant de commencer l'annotation. Les classes sont associées au projet et numérotées 0…N-1 pour le format YOLO.":
    'button before starting annotation. Classes belong to the project and are numbered 0...N-1 for the YOLO format.',
  '2. Annotation manuelle': '2. Manual annotation',
  'Activez l\'outil Rectangle (': 'Enable the Rectangle tool (',
  '), puis': '), then',
  'cliquez-glissez': 'click and drag',
  'sur le canvas pour dessiner une bbox. Relâchez pour valider. La bbox est sauvegardée automatiquement en YOLO normalisé (cx cy w h).':
    'on the canvas to draw a bbox. Release to confirm. The bbox is saved automatically in normalized YOLO format (cx cy w h).',
  'Pour modifier :': 'To edit:',
  'sélectionnez': 'select',
  '→ poignées de redimensionnement + déplacement.': '→ resize handles + move.',
  'pour supprimer.': 'to delete.',
  "Activez l'outil Polygone (": 'Enable the Polygon tool (',
  'cliquez': 'click',
  'pour ajouter des sommets.': 'to add vertices.',
  'Double-clic': 'Double-click',
  'ou clic sur le premier point pour fermer le polygone.': 'or click the first point to close the polygon.',
  'Utile pour la segmentation précise. Les points du polygone sont sérialisés en JSON dans la DB (coordonnées normalisées).':
    'Useful for precise segmentation. The polygon points are serialized as JSON in the DB (normalized coordinates).',
  '3. Annotation assistée par IA': '3. AI-assisted annotation',
  'Tapez un prompt textuel dans la toolbar (ex:': 'Type a text prompt in the toolbar (e.g.',
  ') et appuyez sur Entrée. DINO détecte les bounding boxes, SAM2 les raffine en masques.':
    ') and press Enter. DINO detects the bounding boxes, SAM2 refines them into masks.',
  'Paramètres :': 'Parameters:',
  '(confiance détection, 0.3–0.5) et': '(detection confidence, 0.3–0.5) and',
  '(lien texte-objet, 0.2–0.4).': '(text-to-object link, 0.2–0.4).',
  'Clic gauche': 'Left click',
  "point foreground (l'objet est ici).": 'foreground point (the object is here).',
  'Clic droit': 'Right click',
  'point background (pas ici). SAM2 génère le masque en temps réel et le convertit en bbox ou polygone selon le mode.':
    'background point (not here). SAM2 generates the mask in real time and converts it to a bbox or polygon depending on the mode.',
  'Ajoutez plusieurs points pour affiner le masque avant validation.': 'Add several points to refine the mask before confirming.',
  "Segmente l'intégralité de l'image sans aucun prompt. Les masques sont streamés via WebSocket et affichés progressivement. Passez en mode review pour filtrer les résultats.":
    'Segments the entire image with no prompt at all. Masks are streamed over WebSocket and displayed progressively. Switch to review mode to filter the results.',
  'Idéal pour démarrer rapidement sur des images denses.': 'Ideal for a quick start on dense images.',
  '4. Interactions et gestion des annotations': '4. Interactions and annotation management',
  'Dans la liste sidebar': 'In the sidebar list',
  'Clic': 'Click',
  'sur une annotation → sélection + mise en évidence canvas': 'on an annotation → selects it and highlights it on the canvas',
  '→ multi-sélection': '→ multi-select',
  'Double-clic (sur une box du canvas)': 'Double-click (on a canvas box)',
  '→ (dé)marque la box comme cible de tracking, partagée entre tous les onglets Tracks. Pas de zoom automatique.':
    '→ (un)marks the box as a tracking target, shared across all Tracks tabs. No automatic zoom.',
  'Clic sur la pastille de classe': 'Click on the class swatch',
  '→ changement de classe': '→ changes the class',
  '→ suppression des annotations sélectionnées': '→ deletes the selected annotations',
  'Boutons de la sidebar': 'Sidebar buttons',
  'Non-Maximum Suppression, supprime les doublons selon un seuil IoU (0.0–1.0).':
    'Non-Maximum Suppression, removes duplicates based on an IoU threshold (0.0–1.0).',
  'Tout supprimer': 'Delete all',
  'supprime toutes les annotations de la frame courante (confirmation inline requise).':
    'deletes all annotations on the current frame (requires inline confirmation).',
  'Copier frame': 'Copy frame',
  'Coller': 'Paste',

  // ---- TabTechnical.tsx ----
  'Grounding DINO — Détection par texte': 'Grounding DINO: Text-based detection',
  'Grounding DINO (': 'Grounding DINO (',
  ', ~340 MB) est un modèle de détection open-vocabulary basé sur DINO (DETR amélioré). Il prend une image et un':
    ', ~340 MB) is an open-vocabulary detection model based on DINO (an improved DETR). It takes an image and a',
  'prompt textuel': 'text prompt',
  'en entrée, et retourne des bounding boxes avec scores pour chaque objet correspondant au texte.':
    'as input, and returns bounding boxes with scores for each object matching the text.',
  'Architecture': 'Architecture',
  'Encodeur image : Swin Transformer': 'Image encoder: Swin Transformer',
  'Encodeur texte : BERT': 'Text encoder: BERT',
  'Cross-attention image ↔ texte dans le décodeur': 'Image <-> text cross-attention in the decoder',
  'Sortie : N boxes avec scores de confiance': 'Output: N boxes with confidence scores',
  'Hyperparamètres': 'Hyperparameters',
  'Seuil de confiance pour conserver une détection. Baisser pour détecter plus (plus de faux positifs). Monter pour filtrer les détections faibles.':
    'Confidence threshold for keeping a detection. Lower it to detect more (more false positives). Raise it to filter out weak detections.',
  "Seuil de cohérence texte-boîte. Contrôle l'alignement entre le prompt et la région détectée. Généralement légèrement inférieur à box_threshold.":
    'Text-box coherence threshold. Controls the alignment between the prompt and the detected region. Usually slightly lower than box_threshold.',
  'Rédaction du prompt': 'Writing the prompt',
  'Séparez les classes par des points :': 'Separate classes with periods:',
  'voiture. camion. moto.': 'car. truck. motorbike.',
  'le point est le séparateur de classe dans Grounding DINO. Évitez les phrases longues. Les noms communs donnent de meilleurs résultats que les descriptions.':
    'the period is the class separator in Grounding DINO. Avoid long sentences. Common nouns give better results than descriptions.',
  'Disponibilité': 'Availability',
  'Le service Grounding DINO est optionnel. Si': 'The Grounding DINO service is optional. If',
  "n'est pas installé, tous les endpoints retournent": 'is not installed, all endpoints return',
  'Vérifiez': 'Check',
  'Segment Anything Model 2': 'Segment Anything Model 2',
  'SAM2 (Meta, 2024) est un modèle de segmentation universel. Il accepte des': 'SAM2 (Meta, 2024) is a universal segmentation model. It accepts',
  'points': 'points',
  "ou aucun prompt (auto) et génère un masque binaire précis. La variante utilisée est": 'or no prompt at all (auto) and generates a precise binary mask. The variant used is',
  'fallback': 'fallback',
  'sur CPU).': 'on CPU).',
  'Mode Points (interactif)': 'Points mode (interactive)',
  'Points foreground (': 'Foreground points (',
  ') : inclus dans le masque': '): included in the mask',
  'Points background (': 'Background points (',
  ') : exclus': '): excluded',
  'Masque recalculé à chaque ajout de point': 'Mask recomputed on every point added',
  'Résultat validé → annotation créée (bbox ou polygone)': 'Once confirmed, the result becomes an annotation (bbox or polygon)',
  'Mode Auto-segmentation': 'Auto-segmentation mode',
  "Grille de points automatique sur toute l'image": 'Automatic point grid over the whole image',
  'Masques streamés via WebSocket en temps réel': 'Masks streamed over WebSocket in real time',
  'NMS appliqué pour supprimer les doublons': 'NMS applied to remove duplicates',
  'Filtrage par taille minimale de masque': 'Filtering by minimum mask size',
  'Pipeline DINO → SAM2': 'DINO -> SAM2 pipeline',
  'DINO fournit des boxes grossières': 'DINO provides coarse boxes',
  'SAM2 raffine chaque box en masque précis': 'SAM2 refines each box into a precise mask',
  'Masque converti en polygone (Douglas-Peucker) ou bbox': 'Mask converted to a polygon (Douglas-Peucker) or a bbox',
  'Source :': 'Source:',
  'Checkpoint requis': 'Checkpoint required',
  'Le fichier': 'The file',
  'est nécessaire. Sans lui, le serveur démarre mais les endpoints SAM retournent 503.':
    'is required. Without it, the server starts but the SAM endpoints return 503.',
  'SAM3.1 — Modèle de segmentation texte-guidée': 'SAM3.1: Text-guided segmentation model',
  'SAM3.1 est un modèle': 'SAM3.1 is a',
  'autonome': 'standalone',
  'de segmentation guidée par texte — il ne': 'text-guided segmentation model, it does',
  "s'appuie pas": 'not rely',
  "sur Grounding DINO ni sur SAM2. C'est un modèle unifié qui prend une image + un prompt texte en entrée et retourne directement des masques de segmentation et des bounding boxes en une seule passe.":
    'on Grounding DINO or SAM2. It is a unified model that takes an image + a text prompt as input and directly returns segmentation masks and bounding boxes in a single pass.',
  'Architecture & API interne': 'Architecture & internal API',
  'Checkpoint :': 'Checkpoint:',
  'encodage image une fois': 'image encoding, done once',
  'segmentation par prompt': 'prompt-based segmentation',
  'Retourne :': 'Returns:',
  'directement': 'directly',
  'Supporte 4M+ concepts open-vocabulary sans fine-tuning': 'Supports 4M+ open-vocabulary concepts with no fine-tuning',
  'Comparaison avec GD + SAM2': 'Comparison with GD + SAM2',
  'deux modèles en pipeline : DINO détecte les boxes, SAM2 raffine en masques': 'two models in a pipeline: DINO detects the boxes, SAM2 refines them into masks',
  'un seul modèle, détection ET segmentation en une passe': 'a single model, detection AND segmentation in one pass',
  'SAM3.1 : plus compact, pas besoin de Grounding DINO installé': 'SAM3.1: more compact, no need for Grounding DINO to be installed',
  'côté backend avant retour': 'on the backend side before returning',
  'Utilisations': 'Uses',
  'Toolbar SAM3 — annotation frame courante par texte': 'SAM3 toolbar: annotate the current frame by text',
  'Batch auto-vidéo sur plage de frames': 'Auto-video batch over a frame range',
  'Detect. (onglet Tracks → Detect., algo GD ou SAM3)': 'Detect. (Tracks -> Detect. tab, GD or SAM3 algorithm)',
  'Ré-initialisation automatique après perte de track': 'Automatic reinitialization after a track loss',
  'Detect. — DINO/SAM3 + Matching': 'Detect.: DINO/SAM3 + Matching',
  "Le mode Detect. fait tourner Grounding DINO ou SAM3 sur les frames suivantes, puis associe les nouvelles détections aux cibles sélectionnées par distance de centroïde. C'est":
    'Detect. mode runs Grounding DINO or SAM3 on the following frames, then matches the new detections to the selected targets by centroid distance. This is',
  'le même modèle et le même appel': 'the same model and the same call',
  "que le bouton Texte de la barre d'outils : seule la logique qui suit la détection change — là-bas tout ce qui est trouvé est conservé sans notion de piste, ici seules les détections rattachées à une cible sont gardées.":
    'as the toolbar Text button: only the logic that follows the detection differs. There, everything found is kept with no notion of a track; here, only detections tied to a target are kept.',
  'Principe de matching': 'Matching principle',
  'Le détecteur génère N boîtes': 'The detector generates N boxes',
  'anonymes': 'anonymous',
  'sur la frame': 'on the frame',
  'Distance de centroïde (coords normalisées) entre chaque cible et ces boîtes — la référence est la boîte de la frame':
    'Centroid distance (normalized coords) between each target and these boxes: the reference is the box from the',
  'précédente': 'previous',
  'pas celle du départ': 'frame, not the starting one',
  'Appariement': 'Matching',
  'glouton': 'greedy',
  "cible par cible dans l'ordre : la plus proche encore libre, retenue seulement sous":
    'target by target, in order: the closest one still free, kept only under',
  'par défaut': 'by default',
  'Cible sans détection sous le seuil → anomalie': 'Target with no detection under the threshold -> anomaly',
  'trou dans la piste': 'a gap in the track',
  'Variation de surface': 'Area variation',
  'seuil → annotation créée mais signalée': 'threshold -> annotation created but flagged',
  'Détections non appariées': 'Unmatched detections',
  'jetées': 'discarded',
  'ce mode ne crée jamais de piste, il ne fait que continuer les vôtres': 'this mode never creates a track, it only continues your own',
  'Auto-stop optionnel : arrêt si trop de cibles perdues N frames de suite': 'Optional auto-stop: stops if too many targets are lost N frames in a row',
  'À ne pas confondre avec ByteTrack (endpoint séparé, badge': 'Not to be confused with ByteTrack (separate endpoint, badge',
  "sur les annotations) : celui-là fait bien une assignation hongroise sur IoU, avec buffer de pistes perdues et création de nouvelles pistes. Le mode Detect. ne crée jamais de piste.":
    'on the annotations): that one does perform a Hungarian assignment on IoU, with a lost-track buffer and creation of new tracks. Detect. mode never creates a track.',
  'Dock Anom.': 'Anom. dock',
  'Après chaque run, les frames problématiques sont stockées dans le registre de tâches. Le dock Anom. les liste pour une correction manuelle rapide :':
    'After each run, problematic frames are stored in the task registry. The Anom. dock lists them for a quick manual fix:',
  'Cible perdue sur la frame (aucune détection sous': 'Target lost on the frame (no detection under',
  'Variation de surface excessive — souvent une boîte passée sur un objet voisin': 'Excessive area variation, often a box that jumped onto a neighboring object',
  'Échec du détecteur sur la frame': 'Detector failure on the frame',
  'Homographie XFeat / SIFT — Compensation caméra': 'XFeat / SIFT Homography: Camera Compensation',
  "L'homographie estime la": 'Homography estimates the',
  'matrice 3×3': '3x3 matrix',
  "qui minimise l'erreur de reprojection des keypoints matchés entre deux frames. Elle modélise exclusivement le":
    'that minimizes the reprojection error of matched keypoints between two frames. It exclusively models the',
  'mouvement global de la caméra': "camera's global motion",
  '(panoramique, zoom, rotation).': '(panning, zoom, rotation).',
  'XFeat (GPU — recommandé)': 'XFeat (GPU, recommended)',
  'Nombre de keypoints CNN extraits par image. Plus élevé = meilleure robustesse, plus lent.':
    'Number of CNN keypoints extracted per image. Higher = more robust, slower.',
  'Seuil de similarité cosinus pour filtrer les faux matchs. Critique : une valeur trop basse provoque des homographies erronées.':
    'Cosine similarity threshold for filtering out false matches. Critical: too low a value causes incorrect homographies.',
  'RANSAC (commun XFeat & SIFT)': 'RANSAC (shared by XFeat & SIFT)',
  "Tolérance en pixels pour qu'un match soit considéré inlier. Augmenter pour des vidéos compressées.":
    'Pixel tolerance for a match to be considered an inlier. Increase it for compressed videos.',
  "Ratio minimum d'inliers pour accepter l'homographie.": 'Minimum inlier ratio to accept the homography.',
  "Plancher absolu d'inliers. En dessous, la frame est ignorée.": 'Absolute inlier floor. Below it, the frame is skipped.',
  'Limitation fondamentale': 'Fundamental limitation',
  "L'homographie ne modélise que la caméra. Les objets en": 'Homography only models the camera. Objects with their',
  'mouvement propre': 'own motion',
  '(véhicules, piétons) dérivent progressivement. Pour ces cas, utilisez le': '(vehicles, pedestrians) drift progressively. For these cases, use',
  'Flux Optique': 'Optical Flow',
  'SAMURAI — SAM2 + Filtre de Kalman (tracking vidéo robuste)': 'SAMURAI: SAM2 + Kalman Filter (robust video tracking)',
  'SAMURAI (': 'SAMURAI (',
  ") est une extension officielle de SAM2 pour le suivi vidéo. Il conserve": 'is an official SAM2 extension for video tracking. It keeps',
  'exactement la même API': 'exactly the same API',
  'que le video predictor de SAM2 et ajoute un': "as SAM2's video predictor and adds a",
  'filtre de Kalman': 'Kalman filter',
  "pour prédire la position de la cible entre les frames — ce qui le rend nettement plus robuste en présence d'occlusions partielles, de changements d'aspect ou de mouvements rapides.":
    "to predict the target's position between frames, which makes it noticeably more robust to partial occlusions, appearance changes, or fast motion.",
  'Base : SAM2 video predictor (Meta, 2024)': 'Base: SAM2 video predictor (Meta, 2024)',
  'Ajout : filtre de Kalman sur les états de mémoire': 'Added: Kalman filter over the memory states',
  'Prédit la position frame suivante même sans observation fiable': 'Predicts the next frame position even without a reliable observation',
  'Réduit les dérives et les pertes de cible lors des occlusions': 'Reduces drift and target loss during occlusions',
  'Compatible avec tous les checkpoints SAM2 (tiny, small, large)': 'Compatible with all SAM2 checkpoints (tiny, small, large)',
  "Workflow dans l'app": 'Workflow in the app',
  'sur la cible dans le canvas → marque la frame de départ': 'on the target in the canvas -> marks the starting frame',
  'Onglet': 'Tab',
  'bouton': 'button',
  'Propager': 'Propagate',
  'Les frames défilent une par une : les boxes apparaissent en temps réel': 'Frames play one by one: boxes appear in real time',
  'pour inspecter une frame,': 'to inspect a frame,',
  'Stop': 'Stop',
  '(carré rouge, toujours visible sur la barre de progression) pour arrêter': '(red square, always visible on the progress bar) to stop',
  '1 seule cible': 'Single target',
  'SAMURAI (Kalman mono-cible).': 'SAMURAI (single-target Kalman).',
  'Plusieurs cibles': 'Multiple targets',
  'bascule automatique en': 'switches automatically to',
  'SAM2 multi-objets natif': "SAM2's native multi-object mode",
  "(le filtre de Kalman mono-état de SAMURAI ne gère qu'une cible).": "(SAMURAI's single-state Kalman filter only handles one target).",
  'SAMURAI inclus (aucune installation)': 'SAMURAI included (no installation)',
  'SAMURAI est': 'SAMURAI is',
  "fourni avec l'application": 'bundled with the application',
  "et chargé automatiquement avec SAM2 — rien à installer. C'est le mode de suivi vidéo par défaut de l'onglet Tracks.":
    'and loaded automatically with SAM2, nothing to install. It is the default video tracking mode in the Tracks tab.',
  'Gestion VRAM / GPU automatique': 'Automatic VRAM / GPU management',
  "Le device (CUDA/CPU) est détecté à l'import ; la session vidéo est ouverte puis fermée automatiquement après chaque propagation (":
    'The device (CUDA/CPU) is detected on import; the video session is opened then closed automatically after each propagation (',
  'en': 'in',
  'finally': 'finally',
  ") pour éviter toute fuite de VRAM. Sur GPU sans SAM2, l'app bascule sur le checkpoint": ') to avoid any VRAM leak. On a GPU without SAM2, the app falls back to the',
  'Flux Optique Lucas-Kanade — Suivi objet-par-objet avec adaptation de taille': 'Lucas-Kanade Optical Flow: Object-by-Object Tracking with Size Adaptation',
  "Contrairement à l'homographie, le flux optique LK suit le": 'Unlike homography, LK optical flow follows the',
  'mouvement réel de chaque pixel': 'actual motion of each pixel',
  'entre deux frames. Chaque bbox est traquée indépendamment.': 'between two frames. Each bbox is tracked independently.',
  'Problème : translation naïve = taille figée': 'Problem: naive translation = fixed size',
  'Une implémentation naïve calcule la médiane (dx, dy) des déplacements LK et translate le centre de la bbox. La taille reste':
    'A naive implementation computes the median (dx, dy) of the LK displacements and translates the bbox center. The size stays',
  'constante': 'constant',
  "— si l'objet se rapproche ou s'éloigne, la bbox ne suit pas le changement d'échelle.":
    ': if the object gets closer or farther away, the bbox does not follow the scale change.',
  '// Naïf : dx/dy médian → translate seulement\ndx = median(pts_next - pts_prev)\nnew_bbox = (cx + dx, cy + dy, w_inchangé, h_inchangé)  // MAUVAIS':
    '// Naive: median dx/dy -> translate only\ndx = median(pts_next - pts_prev)\nnew_bbox = (cx + dx, cy + dy, w_unchanged, h_unchanged)  // BAD',
  'Solution : 4 coins + transformation affine partielle': 'Solution: 4 corners + partial affine transform',
  '29 points trackés': '29 tracked points',
  'les 4 coins de la bbox + une grille 5×5 intérieure (marge 15%)': "the bbox's 4 corners + an inner 5x5 grid (15% margin)",
  'Estimation affine partielle': 'Partial affine estimation',
  'Encode': 'Encodes',
  "translation + rotation + facteur d'échelle": 'translation + rotation + scale factor',
  'Application aux coins': 'Applying it to the corners',
  'la matrice 2×3 transforme les 4 coins originaux. La nouvelle bbox = rectangle englobant des coins transformés →':
    'the 2x3 matrix transforms the 4 original corners. The new bbox = bounding rectangle of the transformed corners ->',
  'taille adaptative': 'adaptive size',
  'Fallback': 'Fallback',
  "si trop peu d'inliers, retour à la translation médiane": 'if there are too few inliers, falls back to the median translation',
  '// Corrigé : affine partielle → taille adaptative\npts = [4 coins + grille 5x5]           # 29 points\nM, mask = estimateAffinePartial2D(src, dst, RANSAC)  # scale + rot + transl\nnew_corners = (M @ corners_h.T).T       # coins transformés (4, 2)\nnew_bbox = bounding_box(new_corners)    # taille change naturellement':
    '// Fixed: partial affine -> adaptive size\npts = [4 corners + 5x5 grid]           # 29 points\nM, mask = estimateAffinePartial2D(src, dst, RANSAC)  # scale + rot + transl\nnew_corners = (M @ corners_h.T).T       # transformed corners (4, 2)\nnew_bbox = bounding_box(new_corners)    # size changes naturally',
  'Fenêtre de recherche LK (défaut': 'LK search window (default',
  'robuste au bruit.': 'more robust to noise.',
  'précis petits objets.': 'more precise on small objects.',
  'Réglage :': 'Tuning:',
  '15–21 scènes nettes, 25–31 vidéo compressée.': '15-21 for sharp scenes, 25-31 for compressed video.',
  'Niveaux pyramidaux LK (défaut': 'LK pyramid levels (default',
  'captures grands déplacements.': 'captures large displacements.',
  'plus rapide.': 'faster.',
  '2 pour': '2 for',
  '4 pour timelapse.': '4 for timelapse.',
  'Points min. de validation (défaut': 'Min. validation points (default',
  'Si': 'If',
  'N points bien suivis → bbox inchangée.': 'well-tracked N points -> bbox unchanged.',
  '2–3 petits objets, 8+ zones sans texture.': '2-3 for small objects, 8+ for textureless areas.',
  'Quand utiliser flux optique vs homographie': 'When to use optical flow vs. homography',
  'Flux optique si :': 'Optical flow if:',
  'Objets en mouvement propre (véhicules, piétons)': 'Objects with their own motion (vehicles, pedestrians)',
  'Caméra statique ou quasi-statique': 'Static or near-static camera',
  'Objets qui changent de taille (se rapprochent)': 'Objects that change size (getting closer)',
  'Homographie si :': 'Homography if:',
  'Caméra en mouvement (panoramique, zoom)': 'Moving camera (panning, zoom)',
  'Objets quasi-statiques dans la scène': 'Near-static objects in the scene',
  'Compensation de stabilisation vidéo': 'Video stabilization compensation',
  'Interpolation linéaire — Complétion entre deux keyframes': 'Linear Interpolation: Filling in Between Two Keyframes',
  "L'interpolation génère des annotations intermédiaires entre deux frames annotées pour un même track. Les coordonnées YOLO (cx, cy, w, h) sont interpolées linéairement.":
    'Interpolation generates in-between annotations between two annotated frames for the same track. The YOLO coordinates (cx, cy, w, h) are interpolated linearly.',
  't = (frame_i - frame_start) / (frame_end - frame_start)  # [0, 1]\nbbox_i = lerp(bbox_start, bbox_end, t)\nconfidence_i = lerp(conf_start, conf_end, t)  # decay progressif':
    't = (frame_i - frame_start) / (frame_end - frame_start)  # [0, 1]\nbbox_i = lerp(bbox_start, bbox_end, t)\nconfidence_i = lerp(conf_start, conf_end, t)  # progressive decay',
  'Limitation': 'Limitation',
  'Suppose un mouvement': 'Assumes',
  'uniforme': 'uniform motion',
  'Pour des trajectoires courbes ou des changements de vitesse, préférez le flux optique. Idéale pour combler 5–20 frames entre deux annotations manuelles.':
    'For curved trajectories or speed changes, prefer optical flow. Ideal for filling in 5-20 frames between two manual annotations.',

  // ---- TabDeveloper.tsx ----
  [`# backend/services/mon_algo_service.py
import numpy as np

class MonAlgoService:
    """Singleton — instancié une seule fois dans main.py lifespan."""

    def __init__(self):
        self._ready = False

    def load(self):
        # charger modèle, vérifier GPU...
        self._ready = True

    def is_available(self) -> bool:
        return self._ready

    def predict(self, image: np.ndarray, params: dict) -> list[dict]:
        """Retourne une liste {cx, cy, w, h, confidence, class_id} (normalisé)."""
        return []

mon_algo_service = MonAlgoService()  # singleton exporté`]: `# backend/services/mon_algo_service.py
import numpy as np

class MonAlgoService:
    """Singleton -- instantiated once in main.py's lifespan."""

    def __init__(self):
        self._ready = False

    def load(self):
        # load model, check GPU...
        self._ready = True

    def is_available(self) -> bool:
        return self._ready

    def predict(self, image: np.ndarray, params: dict) -> list[dict]:
        """Returns a list of {cx, cy, w, h, confidence, class_id} (normalized)."""
        return []

mon_algo_service = MonAlgoService()  # exported singleton`,
  [`# backend/main.py — dans la fonction lifespan()
from backend.services.mon_algo_service import mon_algo_service
mon_algo_service.load()  # chargement au démarrage`]: `# backend/main.py -- inside the lifespan() function
from backend.services.mon_algo_service import mon_algo_service
mon_algo_service.load()  # load at startup`,
  [`# backend/models/routers/annotation.py  (ou nouveau router)
from fastapi import APIRouter, HTTPException, Depends
from backend.services.mon_algo_service import mon_algo_service

@router.post("/frames/{frame_id}/mon-algo")
async def run_mon_algo(frame_id: int, params: MonAlgoParams, session=Depends(get_session)):
    if not mon_algo_service.is_available():
        raise HTTPException(503, "MonAlgo non disponible")
    frame = session.get(Frame, frame_id)
    if not frame:
        raise HTTPException(404, "Frame introuvable")
    img = load_image(frame.image_path)
    results = mon_algo_service.predict(img, params.dict())
    for r in results:
        ann = Annotation(
            frame_id=frame_id,
            cx=r["cx"], cy=r["cy"], w=r["w"], h=r["h"],  # YOLO normalisé !
            class_id=r["class_id"],
            confidence=r["confidence"],
            source_algorithm="mon_algo",
        )
        session.add(ann)
    session.commit()
    return {"created": len(results)}`]: `# backend/models/routers/annotation.py  (or a new router)
from fastapi import APIRouter, HTTPException, Depends
from backend.services.mon_algo_service import mon_algo_service

@router.post("/frames/{frame_id}/mon-algo")
async def run_mon_algo(frame_id: int, params: MonAlgoParams, session=Depends(get_session)):
    if not mon_algo_service.is_available():
        raise HTTPException(503, "MonAlgo unavailable")
    frame = session.get(Frame, frame_id)
    if not frame:
        raise HTTPException(404, "Frame not found")
    img = load_image(frame.image_path)
    results = mon_algo_service.predict(img, params.dict())
    for r in results:
        ann = Annotation(
            frame_id=frame_id,
            cx=r["cx"], cy=r["cy"], w=r["w"], h=r["h"],  # normalized YOLO!
            class_id=r["class_id"],
            confidence=r["confidence"],
            source_algorithm="mon_algo",
        )
        session.add(ann)
    session.commit()
    return {"created": len(results)}`,
  [`// frontend/src/services/api.ts  — ajouter dans le namespace annotations
export const annotationsAPI = {
  // ... endpoints existants ...
  runMonAlgo: (frameId: number, params: MonAlgoParams) =>
    api.post<Annotation[]>(\`/frames/\${frameId}/mon-algo\`, params),
}`]: `// frontend/src/services/api.ts  -- add inside the annotations namespace
export const annotationsAPI = {
  // ... existing endpoints ...
  runMonAlgo: (frameId: number, params: MonAlgoParams) =>
    api.post<Annotation[]>(\`/frames/\${frameId}/mon-algo\`, params),
}`,
  [`// frontend/src/components/toolbar/Toolbar.tsx
const handleRunMonAlgo = async () => {
  if (!currentFrame) return
  setLoading(true)
  try {
    await annotationsAPI.runMonAlgo(currentFrame.id, { param1: value1 })
    const updated = await annotationsAPI.getByFrame(currentFrame.id)
    loadAnnotations(currentFrame.id, updated)  // frameId EN PREMIER !
  } catch (err) {
    toast.error("Erreur MonAlgo")
  } finally {
    setLoading(false)
  }
}`]: `// frontend/src/components/toolbar/Toolbar.tsx
const handleRunMonAlgo = async () => {
  if (!currentFrame) return
  setLoading(true)
  try {
    await annotationsAPI.runMonAlgo(currentFrame.id, { param1: value1 })
    const updated = await annotationsAPI.getByFrame(currentFrame.id)
    loadAnnotations(currentFrame.id, updated)  // frameId FIRST!
  } catch (err) {
    toast.error("MonAlgo error")
  } finally {
    setLoading(false)
  }
}`,
  [`# Pour un algo long (propagation vidéo), utiliser le task registry
import uuid
from backend.services.task_registry import create_task, update_task, set_task_result
from concurrent.futures import ThreadPoolExecutor
executor = ThreadPoolExecutor(max_workers=2)

@router.post("/projects/{project_id}/mon-algo/propagate")
async def propagate_mon_algo(project_id: int, ...):
    task_id = str(uuid.uuid4())
    create_task(task_id, "Propagation MonAlgo")

    def run():
        try:
            update_task(task_id, "running", 0, "Demarrage...")
            for i, frame in enumerate(frames):
                update_task(task_id, "running",
                    progress=int(i / len(frames) * 100),
                    message=f"Frame {i+1}/{len(frames)}",
                    current_frame_id=frame.id)  # navigation temps reel
                # ... traitement ...
            update_task(task_id, "completed", 100, "Termine")
        except Exception as e:
            update_task(task_id, "error", 0, str(e), error=str(e))

    executor.submit(run)
    return {"task_id": task_id}`]: `# For a long-running algo (video propagation), use the task registry
import uuid
from backend.services.task_registry import create_task, update_task, set_task_result
from concurrent.futures import ThreadPoolExecutor
executor = ThreadPoolExecutor(max_workers=2)

@router.post("/projects/{project_id}/mon-algo/propagate")
async def propagate_mon_algo(project_id: int, ...):
    task_id = str(uuid.uuid4())
    create_task(task_id, "MonAlgo propagation")

    def run():
        try:
            update_task(task_id, "running", 0, "Starting...")
            for i, frame in enumerate(frames):
                update_task(task_id, "running",
                    progress=int(i / len(frames) * 100),
                    message=f"Frame {i+1}/{len(frames)}",
                    current_frame_id=frame.id)  # real-time navigation
                # ... processing ...
            update_task(task_id, "completed", 100, "Done")
        except Exception as e:
            update_task(task_id, "error", 0, str(e), error=str(e))

    executor.submit(run)
    return {"task_id": task_id}`,
  [`// frontend — WebSocket principal, polling HTTP en secours seulement
const [taskId, setTaskId] = useState<string | null>(null)

// Lancer la propagation :
const res = await trackingAPI.propagate(projectId, params)
setTaskId(res.task_id)

const socket = new AnnotationWebSocket()
socket.on('update', ({ current_frame_id, live_frames }) => {
  // live_frames : annotations de CHAQUE frame, jamais throttlees
  // current_frame_id : navigation du canvas, cadencee par le reglage Interface
})
socket.connect(\`/ws/tasks/\${res.task_id}\`)

// Si l'upgrade WebSocket est bloque par le proxy SSH, TrackPanel bascule vers
// GET /api/tasks/{id} en boucle sequentielle et l'annule des que le WS revient.`]: `// frontend -- WebSocket is primary, HTTP polling only as a fallback
const [taskId, setTaskId] = useState<string | null>(null)

// Start the propagation:
const res = await trackingAPI.propagate(projectId, params)
setTaskId(res.task_id)

const socket = new AnnotationWebSocket()
socket.on('update', ({ current_frame_id, live_frames }) => {
  // live_frames: annotations for EVERY frame, never throttled
  // current_frame_id: canvas navigation, paced by the Interface setting
})
socket.connect(\`/ws/tasks/\${res.task_id}\`)

// If the WebSocket upgrade is blocked by the SSH proxy, TrackPanel falls back to
// GET /api/tasks/{id} in a sequential loop and cancels it as soon as the WS comes back.`,
  [`// Invariants CRITIQUES à ne jamais violer :

// 1. Coordonnées TOUJOURS normalisées [0,1] en DB (format YOLO)
const cx_norm = cx_pixel / image_width  // jamais stocker des pixels

// 2. loadAnnotations(frameId, annotations) — frameId EN PREMIER
loadAnnotations(frame.id, annotations)  // OK
loadAnnotations(annotations, frame.id)  // BUG silencieux

// 3. clearAnnotations() obligatoire au changement de projet
useEffect(() => { clearAnnotations() }, [projectId])

// 4. Pas d'emoji dans print() / logging Python (Windows cp1252)
print("OK")      // OK
print("OK")   // UnicodeEncodeError au demarrage uvicorn

// 5. Singleton sam_service — checkpoint requis
//    Si absent : serveur demarre, endpoints SAM retournent 503

// 6. Migrations : ALTER TABLE uniquement, jamais DROP TABLE`]: `// CRITICAL invariants, never violate them:

// 1. Coordinates ALWAYS normalized [0,1] in the DB (YOLO format)
const cx_norm = cx_pixel / image_width  // never store pixels

// 2. loadAnnotations(frameId, annotations) -- frameId FIRST
loadAnnotations(frame.id, annotations)  // OK
loadAnnotations(annotations, frame.id)  // silent BUG

// 3. clearAnnotations() required on project change
useEffect(() => { clearAnnotations() }, [projectId])

// 4. No emoji in Python print() / logging (Windows cp1252)
print("OK")      // OK
print("OK")   // UnicodeEncodeError at uvicorn startup

// 5. sam_service singleton -- checkpoint required
//    If missing: server starts, SAM endpoints return 503

// 6. Migrations: ALTER TABLE only, never DROP TABLE`,
  'Cette section explique comment intégrer un': 'This section explains how to integrate a',
  'nouvel algorithme': 'new algorithm',
  "(backend + frontend) sans casser l'existant. L'architecture est modulaire : chaque domaine a son service + son router.":
    "(backend + frontend) without breaking what's there. The architecture is modular: each domain has its own service and its own router.",
  'Service singleton + router FastAPI': 'Singleton service + FastAPI router',
  'API client typé + store Zustand + composant': 'Typed API client + Zustand store + component',
  'Task registry pour algos longs (propagation)': 'Task registry for long-running algorithms (propagation)',
  'Créer le service backend (singleton)': 'Create the backend service (singleton)',
  'Créez': 'Create',
  'en suivant le pattern singleton :': 'following the singleton pattern:',
  'Enregistrez-le dans le lifespan de': 'Register it in the lifespan of',
  "Ajouter l'endpoint FastAPI": 'Add the FastAPI endpoint',
  "Ajoutez l'endpoint dans un router existant (": 'Add the endpoint to an existing router (',
  ') ou créez un nouveau fichier dans': ') or create a new file in',
  'Coordonnées YOLO normalisées': 'Normalized YOLO coordinates',
  'Toutes les coordonnées en DB doivent être dans': 'All coordinates in the DB must be within',
  'Si votre algo retourne des pixels, divisez par': 'If your algorithm returns pixels, divide by',
  "avant de créer l'annotation.": 'before creating the annotation.',
  'Exposer dans le client API TypeScript': 'Expose it in the TypeScript API client',
  "L'intercepteur axios gère les toasts d'erreur automatiquement. Ajoutez le type": 'The axios interceptor handles error toasts automatically. Add the',
  'dans le fichier': 'type in the file',
  'si nécessaire.': 'if needed.',
  'Ajouter le bouton / composant frontend': 'Add the frontend button / component',
  'loadAnnotations — ordre des arguments': 'loadAnnotations: argument order',
  'le frameId est toujours en premier': 'the frameId always comes first',
  "C'est l'erreur la plus courante.": 'This is the most common mistake.',
  'Pour un algo long : task registry asynchrone': 'For a long-running algorithm: asynchronous task registry',
  "Pour les propagations sur toute une vidéo, utilisez le registre de tâches. L'endpoint retourne immédiatement un":
    'For propagations across an entire video, use the task registry. The endpoint immediately returns a',
  "et le frontend suit son état par WebSocket. Le polling HTTP n'est qu'un repli si l'upgrade est bloqué.":
    'and the frontend follows its status over WebSocket. HTTP polling is only a fallback if the upgrade is blocked.',
  'backend — propagation async avec task registry': 'backend: async propagation with the task registry',
  'frontend — WebSocket et repli HTTP': 'frontend: WebSocket and HTTP fallback',
  'En mettant à jour': 'By updating',
  'le WebSocket pilote la barre de progression et la navigation. La cadence du canvas est reglable ; les':
    'the WebSocket drives the progress bar and navigation. The canvas refresh rate is adjustable; the',
  "et les indicateurs d'annotation ne sont pas throttles.": 'and the annotation indicators are never throttled.',
  'Invariants critiques à ne pas violer': 'Critical invariants, do not violate them',
  'Invariants — à lire avant tout développement': 'Invariants: read before any development',
  'Résumé Architecture': 'Architecture Summary',
  'Backend (FastAPI + SQLite)': 'Backend (FastAPI + SQLite)',
  'lifespan, migrations, CORS': 'lifespan, migrations, CORS',
  '1 fichier par domaine': '1 file per domain',
  'singletons métier': 'business-logic singletons',
  'SQLite WAL, foreign keys ON': 'SQLite WAL, foreign keys ON',
  'Frontend (React + TypeScript + Konva.js)': 'Frontend (React + TypeScript + Konva.js)',
  'annotations, undo/redo, clipboard': 'annotations, undo/redo, clipboard',
  'projets, frames, session': 'projects, frames, session',
  'WebSocket SAM, masques streamés': 'SAM WebSocket, streamed masks',
  'zoom, onglets, modals': 'zoom, tabs, modals',
  'axios typé, namespaces API': 'typed axios, API namespaces',
  'Migrations de schéma': 'Schema migrations',
  'Ajoutez les nouvelles colonnes via': 'Add new columns via',
  'de': 'in',
  "Les colonnes manquantes sont ajoutées silencieusement au démarrage sans perte de données. N'utilisez jamais":
    'Missing columns are added silently at startup with no data loss. Never use',

  // ---- TabOptimisations.tsx ----
  'Message WebSocket (annonce)': 'WebSocket message (announcement)',
  'Image preview 480 px': 'Preview image 480 px',
  'Image display 1600 px': 'Display image 1600 px',
  'Image pleine resolution': 'Full-resolution image',
  'Selection 50 % des points': 'Selecting 50% of the points',
  'Deselection': 'Deselection',
  'Dezoom': 'Zoom out',
  'Re-render complet': 'Full re-render',
  'Embedding 9402 images (Dataset Explorer)': 'Embedding 9402 images (Dataset Explorer)',
  'Import Annotation 9402 frames (symlink)': 'Annotation import, 9402 frames (symlink)',
  'Latence backend, 2 jobs simultanes': 'Backend latency, 2 simultaneous jobs',
  '~47 img/s — 238 s au total': '~47 img/s, 238 s total',
  'mediane 8-16 ms, p95 30-59 ms, 0 echec': 'median 8-16 ms, p95 30-59 ms, 0 failures',
  'Seuil du popup "backend ne repond pas"': 'Threshold for the "backend not responding" popup',
  [`# backend/utils/native_share.py — traduction serveur -> client
/srv/datasets/.../projects/1/frames/f_000042.png
        -> \\\\<share-host>\\datasets\\...\\projects\\1\\frames\\f_000042.png

# Ne traduit QUE les chemins sous une racine partagee :
#   home, mnt, srv, media, data
# /tmp/... -> None  (d'ou le deplacement du dossier temporaire)`]: `# backend/utils/native_share.py -- server -> client translation
/srv/datasets/.../projects/1/frames/f_000042.png
        -> \\\\<share-host>\\datasets\\...\\projects\\1\\frames\\f_000042.png

# Only translates paths under a shared root:
#   home, mnt, srv, media, data
# /tmp/... -> None  (hence moving the temp folder)`,
  [`[SAM2Track] apercu temps reel : chemin NATIF (SMB) -> \\\\<share-host>\\...
            -- lecture directe par le client, hors tunnel, 0 requete HTTP par frame

# Route calculee par le backend, UNE seule ligne par run :
#   NATIF (SMB)           lecture directe sur le partage
#   NATIF (disque local)  lancement local, lecture disque
#   REPLI HTTP            + la raison (aucun partage ne couvre le chemin)

# Confirmation de la lecture REELLE par Electron :
[app-image] lecture native confirmee: \\\\<share-host>\\.../_tracking_tmp/.../000042.jpg
# ou : [app-image] repli HTTP: <raison> (...)`]: `[SAM2Track] real-time preview: NATIVE path (SMB) -> \\\\<share-host>\\...
            -- read directly by the client, outside the tunnel, 0 HTTP requests per frame

# Route computed by the backend, ONE line per run:
#   NATIVE (SMB)           direct read on the share
#   NATIVE (local disk)    local launch, disk read
#   HTTP FALLBACK          + the reason (no share covers the path)

# Confirmation of the ACTUAL read by Electron:
[app-image] native read confirmed: \\\\<share-host>\\.../_tracking_tmp/.../000042.jpg
# or: [app-image] HTTP fallback: <reason> (...)`,
  [`# backend/database.py
# SQLAlchemy 2.x utilise un QueuePool MEME pour un SQLite fichier.
# Defaut : pool_size 5 + max_overflow 10 = 15 connexions, pool_timeout 30 s
# Or les endpoints "def" tournent dans le threadpool anyio : 40 threads.
# 40 demandeurs pour 15 places -> attente de 30 s = le timeout axios.

_POOL_SIZE    = 20
_MAX_OVERFLOW = 40   # 60 connexions > 40 threads : plus aucune attente`]: `# backend/database.py
# SQLAlchemy 2.x uses a QueuePool EVEN for a file-based SQLite.
# Default: pool_size 5 + max_overflow 10 = 15 connections, pool_timeout 30 s
# But "def" endpoints run in the anyio threadpool: 40 threads.
# 40 requesters for 15 slots -> a 30 s wait = the axios timeout.

_POOL_SIZE    = 20
_MAX_OVERFLOW = 40   # 60 connections > 40 threads: no more waiting`,
  [`POSTE WINDOWS (VisionNexus Electron + frontend)
  |-- API JSON + WebSocket --> 127.0.0.1:<port local>
  |                           tunnel SSH -> <backend-vm>:<port backend>
  |
  \\\\-- pixels des frames ----> \\\\<native_share_host>\\<partage>\\...
                              lecture directe app-image://, hors tunnel SSH

# backend-vm = VM qui execute FastAPI, SAMURAI/SAM2 et SQLite
# native_share_host = hote UNC joignable depuis Windows
# Les deux noms peuvent etre differents.`]: `WINDOWS MACHINE (VisionNexus Electron + frontend)
  |-- JSON API + WebSocket --> 127.0.0.1:<local port>
  |                           SSH tunnel -> <backend-vm>:<backend port>
  |
  \\\\-- frame pixels ----------> \\\\<native_share_host>\\<share>\\...
                              direct app-image:// read, outside the SSH tunnel

# backend-vm = VM running FastAPI, SAMURAI/SAM2 and SQLite
# native_share_host = UNC host reachable from Windows
# The two names can be different.`,
  'Action utilisateur': 'User action',
  'Slider, timeline ou fleche change frame_index.': 'Slider, timeline, or arrow key changes frame_index.',
  'Metadonnees frame': 'Frame metadata',
  'Store memoire ; GET by-index uniquement si la fenetre sparse manque.': 'In-memory store; GET by-index only if the sparse window is missing it.',
  'LRU immediat, puis un GET annulable pour rafraichir la frame.': 'Immediate LRU, then a cancelable GET to refresh the frame.',
  'URL image': 'Image URL',
  'Preview pendant scrub, display a l’arret, full au zoom.': 'Preview while scrubbing, display size at rest, full size on zoom.',
  'Resolution native': 'Native resolution',
  'Electron resout le chemin partage ; le navigateur utilise le repli.': 'Electron resolves the shared path; the browser uses the fallback.',
  'Lecture pixels': 'Pixel read',
  'fs.readFile sur UNC hors tunnel ; sinon un GET /image.': 'fs.readFile over UNC outside the tunnel; otherwise a GET /image.',
  'Commit canvas': 'Canvas commit',
  'Konva affiche seulement image et annotations de la meme frame.': 'Konva only displays the image and annotations of the same frame.',
  'Prefetch borne': 'Bounded prefetch',
  'Voisins seulement au repos ; aucune vignette ni balayage complet.': 'Neighbors only at rest; no thumbnails, no full sweep.',
  'Demarrage': 'Startup',
  'POST /sam2-tracking/run renvoie immediatement task_id.': 'POST /sam2-tracking/run immediately returns a task_id.',
  'Preparation VM': 'VM preparation',
  'Le backend produit les JPEG dans projet/_tracking_tmp.': 'The backend produces the JPEGs in project/_tracking_tmp.',
  'Calcul GPU': 'GPU compute',
  'SAMURAI/SAM2 propage et met les ecritures DB en lots.': 'SAMURAI/SAM2 propagates and batches the DB writes.',
  'File live': 'Live queue',
  'Chaque resultat garde frame_id, native_path et objets.': 'Each result keeps frame_id, native_path and objects.',
  'Socket unique': 'Single socket',
  'Un broker vide toute la file et diffuse live_frames.': 'A broker drains the whole queue and broadcasts live_frames.',
  'Navigation cadencee': 'Paced navigation',
  'Live ON : 150 ms par defaut. Live OFF : canvas immobile.': 'Live ON: 150 ms by default. Live OFF: canvas stays still.',
  'Image + overlay': 'Image + overlay',
  'JPEG par SMB ; annotations du meme message WS, sans GET DB.': 'JPEG over SMB; annotations from the same WS message, no DB GET.',
  'Fin atomique': 'Atomic end',
  'Flush DB, recharge unique, purge des tampons temporaires.': 'DB flush, single reload, temporary buffer purge.',
  'Toutes les optimisations ci-dessous partent d\'un': 'Every optimization below starts from an',
  'symptome observe': 'observed symptom',
  "d'une cause etablie par la mesure, et d'un gain constate. Les chiffres viennent d'un test de charge reel :":
    'a cause established by measurement, and a confirmed gain. The numbers come from a real load test:',
  '9402 images 640x512 (2,6 Go)': '9402 images at 640x512 (2.6 GB)',
  'Annotation App et Dataset Explorer lances en parallele.': 'Annotation App and Dataset Explorer running in parallel.',
  'requete HTTP par frame en chemin natif': 'HTTP request per frame on the native path',
  'frames perdues par le WebSocket': 'frames lost by the WebSocket',
  'carte Dataset Explorer (SVG -> WebGL)': 'Dataset Explorer map (SVG -> WebGL)',
  'histogrammes (cache LRU)': 'histograms (LRU cache)',
  'Topologie distante cible': 'Target remote topology',
  'Les tests locaux valident les contrats et le repli HTTP. La validation distante doit etre faite depuis VisionNexus sur Windows avec FastAPI sur la':
    'Local tests validate the contracts and the HTTP fallback. Remote validation must be done from VisionNexus on Windows with FastAPI on the',
  'VM distante': 'remote VM',
  'la trace': 'the',
  'confirme que les pixels ne traversent pas le tunnel SSH.': 'trace confirms the pixels never go through the SSH tunnel.',
  'Flux de communication pas a pas': 'Step-by-Step Communication Flow',
  'Navigation normale': 'Normal navigation',
  'Ce qui ne part pas sur le reseau': 'What never goes over the network',
  'La timeline est virtualisee et sans vignette. Deplacer le slider ne parcourt pas le dataset et ne demande pas les frames precedentes : seule la frame cible, puis quelques voisines au repos, sont concernees.':
    'The timeline is virtualized and has no thumbnails. Moving the slider does not scan the dataset and does not request preceding frames: only the target frame, then a few neighbors at rest, are involved.',
  'Propagation SAMURAI / SAM2': 'SAMURAI / SAM2 Propagation',
  'Contrat du vrai live': 'The Real-Live Contract',
  'Une frame affichee recoit son image par': 'A displayed frame receives its image over',
  'et ses annotations par le': 'and its annotations over the',
  'meme lot WebSocket': 'same WebSocket batch',
  'Tant que le run est actif, aucun GET annotations ne peut remplacer cet apercu par une version SQLite non encore commitee.':
    'As long as the run is active, no annotations GET can replace this preview with a not-yet-committed SQLite version.',
  '1. La contrainte : 6 connexions par origine': '1. The Constraint: 6 Connections per Origin',
  'Un navigateur ouvre au maximum': 'A browser opens at most',
  '6 connexions HTTP simultanees par origine': '6 simultaneous HTTP connections per origin',
  'Quand le backend est sur une': 'When the backend is on a',
  'ce trafic traverse en plus un': 'this traffic also goes through an',
  'tunnel SSH': 'SSH tunnel',
  'Ces 6 creneaux sont donc partages entre les images de frames (le gros du volume) et les requetes vitales (annotations, stop, sauvegarde). Toute optimisation qui suit revient a la meme idee : ne pas depenser un creneau pour quelque chose qui peut passer autrement.':
    'These 6 slots are therefore shared between frame images (the bulk of the volume) and vital requests (annotations, stop, save). Every optimization below comes down to the same idea: do not spend a slot on something that can go another way.',
  'Ce que coute une frame': 'What a frame costs',
  'Transport': 'Transport',
  'Poids': 'Size',
  'Requetes HTTP': 'HTTP requests',
  'A 8 frames/s, la cadence SAMURAI mesuree': 'At 8 frames/s, the measured SAMURAI rate',
  'Les annonces WebSocket coutent': 'WebSocket announcements cost',
  '3,2 Ko/s et zero requete': '3.2 KB/s and zero requests',
  'Faire suivre le canvas image par image en HTTP couterait': 'Following the canvas frame by frame over HTTP would cost',
  '79 Ko/s et 8 requetes/s': '79 KB/s and 8 requests/s',
  'soit plus que les 6 creneaux disponibles.': 'that is more than the 6 available slots.',
  '2. Chemin natif (SMB) : zero requete par frame': '2. Native Path (SMB): Zero Requests per Frame',
  'En coquille Electron, le protocole': 'Inside the Electron shell, the',
  'lit les pixels': 'protocol reads the pixels',
  'directement sur le partage reseau': 'directly from the network share',
  'au lieu de les demander en HTTP. Le trafic ne passe alors ni par le tunnel SSH, ni par les 6 creneaux, ni par le threadpool du backend.':
    'instead of requesting them over HTTP. The traffic then goes through neither the SSH tunnel, the 6 slots, nor the backend threadpool.',
  'Pendant une propagation': 'During a propagation',
  'la preparation ecrit deja un JPEG 8 bits par frame (LUT appliquee) : celui que SAM2 consomme. Le backend annonce donc simplement ce fichier dans le message WebSocket via le champ':
    'the preparation step already writes an 8-bit JPEG per frame (with the LUT applied), the same one SAM2 consumes. The backend therefore simply announces this file in the WebSocket message via the',
  '— rien a re-encoder. Cote client, un parametre': 'field, nothing to re-encode. On the client side, a',
  'court-circuite la resolution :': 'parameter short-circuits the resolution:',
  'deux requetes HTTP economisees par frame': 'two HTTP requests saved per frame',
  'Piege corrige : le dossier temporaire etait sous /tmp': 'Fixed pitfall: the temp folder was under /tmp',
  'renvoie': 'returns',
  'aucune racine de partage ne couvre': 'no share root covers',
  "Le chemin natif n'aurait donc jamais fonctionne en SMB. Le dossier vit desormais dans":
    'The native path would therefore never have worked over SMB. The folder now lives in',
  'Mesure': 'Measurement',
  '80/80 messages portent un': '80/80 messages carry a',
  "79/80 fichiers reellement lisibles au moment du push. Le seul absent est la derniere frame, dont le dossier temporaire etait deja en cours de nettoyage — le repli HTTP prend le relais.":
    '79/80 files actually readable at push time. The only one missing is the last frame, whose temp folder was already being cleaned up: the HTTP fallback takes over.',
  'Trace dans les logs': 'Trace in the Logs',
  'log du run': 'run log',
  '3. Le WebSocket perdait 18 % des frames': '3. The WebSocket Was Losing 18% of Frames',
  'Symptome': 'Symptom',
  "Pendant une propagation, les pastilles de la timeline restaient rouges puis viraient au vert d'un coup a la fin.":
    'During a propagation, the timeline dots stayed red then turned green all at once at the end.',
  'Cause': 'Cause',
  'Le socket': 'The socket',
  'echantillonnait': 'was sampling',
  "l'etat toutes les 150 ms (6,7/s) alors que le backend": 'the state every 150 ms (6.7/s) while the backend',
  'ecrase un slot unique': 'overwrites a single slot',
  "a chaque frame. SAMURAI tourne a 8 f/s : les frames intercalees etaient ecrasees avant d'etre lues.":
    'on every frame. SAMURAI runs at 8 f/s: the in-between frames were overwritten before being read.',
  'Correctif et mesure': 'Fix and Measurement',
  'Une file bornee remplie a chaque frame, videe integralement par la boucle WebSocket et envoyee dans un tableau':
    'A bounded queue filled on every frame, fully drained by the WebSocket loop and sent in a',
  'Avant :': 'Before:',
  '18 % des frames jamais annoncees': '18% of frames never announced',
  'sur 201. Apres :': 'out of 201. After:',
  '200/201 poussees, 0 % de perte': '200/201 pushed, 0% loss',
  'la seule absente est la frame de reference, sautee par conception car deja annotee).':
    'the only one missing is the reference frame, skipped by design since it is already annotated).',
  'Une seule connexion physique par tache': 'A Single Physical Connection per Task',
  'Le panneau Tracks et la barre du haut ouvraient deux sockets concurrents. Comme la file':
    'The Tracks panel and the top bar were opening two concurrent sockets. Since the',
  'est videe a la lecture, le mauvais socket pouvait consommer les': 'queue is drained on read, the wrong socket could consume the',
  'avant le canvas. Un broker partage maintenant un seul WebSocket et diffuse localement les messages aux deux composants.':
    'before the canvas did. A shared broker now owns a single WebSocket and dispatches the messages locally to both components.',
  "4. Annotations d'apercu et cadence du canvas": '4. Preview Annotations and Canvas Rate',
  "Meme apres le correctif precedent, les boites n'apparaissaient pas tout de suite sur l'image : l'apercu n'etait applique que si le canvas etait":
    'Even after the previous fix, boxes did not appear right away on the image: the preview was only applied if the canvas was',
  'deja': 'already',
  "sur la frame concernee. Or la navigation est throttlee, donc l'apercu arrivait presque toujours":
    'on the frame in question. But navigation is throttled, so the preview almost always arrived',
  'avant': 'before',
  "que le canvas n'y aille — et etait jete. Un tampon conserve desormais les apercus recus et les applique des que le canvas arrive, sans attendre le flush en base.":
    'the canvas got there, and was discarded. A buffer now holds the received previews and applies them as soon as the canvas arrives, without waiting for the DB flush.',
  'Reglage': 'Setting',
  'Cadence du canvas pendant une propagation. 150 ms suit la boucle WebSocket ; 700 ms economise le repli HTTP ; 0 suit chaque resultat GPU.':
    'Canvas rate during a propagation. 150 ms follows the WebSocket loop; 700 ms saves the HTTP fallback; 0 follows every GPU result.',
  'Active par defaut le suivi live pendant les propagations : annotations par WebSocket et images via nativePath/app-image quand Electron dispose du chemin natif.':
    'Enables live tracking by default during propagations: annotations over WebSocket and images via nativePath/app-image when Electron has the native path.',
  'La cadence echantillonne le flux, pas les annotations': 'The Rate Samples the Stream, Not the Annotations',
  'Le WebSocket conserve': 'The WebSocket keeps',
  "resultat et met a jour la timeline. Le canvas affiche au plus une frame par intervalle, mais chaque frame retenue recoit toujours son overlay correspondant. Le defaut passe de 700 a 150 ms grace au chemin natif SMB. Les profils restes sur l'ancien defaut 700 ms sont migres une fois ; les autres valeurs personnalisees sont conservees.":
    'result and updates the timeline. The canvas shows at most one frame per interval, but every retained frame still gets its matching overlay. The default moves from 700 to 150 ms thanks to the native SMB path. Profiles still on the old 700 ms default are migrated once; other customized values are kept.',
  'Pourquoi toutes les frames GPU ne sont pas necessairement dessinees': 'Why Not Every GPU Frame Is Necessarily Drawn',
  'Le WebSocket continue a recevoir': 'The WebSocket keeps receiving',
  'a la cadence du GPU. Le tampon associe chaque apercu au vrai': 'at the GPU rate. The buffer ties each preview to the real',
  ', y compris sur un dataset charge par fenetres. Si le GPU va plus vite que 150 ms, le canvas echantillonne le mouvement pour ne pas empiler les decodages, mais la timeline et la base conservent tous les resultats.':
    ', including on a dataset loaded in windows. If the GPU runs faster than 150 ms, the canvas samples the motion to avoid stacking decodes, but the timeline and the database keep every result.',
  'Bug une annotation sur dix corrige': 'Fixed: One Annotation in Ten',
  'Un lot': 'A batch of',
  'etait traite, puis transmis comme': 'was processed, then passed on as',
  'a la navigation. Ce': 'to navigation. This',
  "declenchait un GET annotations ; SAMURAI ne commitant que par lots de 10, la reponse vide effacait aussitot l'overlay live. Un indicateur explicite":
    'triggered an annotations GET; since SAMURAI only commits in batches of 10, the empty response immediately wiped the live overlay. An explicit',
  "interdit maintenant cette relecture des qu'un lot WS existe.": 'flag now blocks this re-read as soon as a WS batch exists.',
  'Ecran gris corrige a la source': 'Gray Screen Fixed at the Source',
  "Pendant une propagation, le cache DB et le tampon WebSocket pouvaient alterner deux versions d'une meme frame jusqu'a":
    'During a propagation, the DB cache and the WebSocket buffer could alternate between two versions of the same frame until',
  "Le WebSocket est maintenant l'unique source du canvas pendant la tache ; le cache et la DB reprennent apres la resynchronisation finale. Les mesures Electron temporaires a":
    'The WebSocket is now the sole source for the canvas during the task; the cache and the DB resume after the final resync. Temporary Electron measurements at',
  'sont aussi ignorees pour que Konva ne dessine jamais dans un buffer detruit. Aucun error boundary ne masque ces erreurs.':
    'are also ignored so Konva never draws into a destroyed buffer. No error boundary hides these errors.',
  'Comportement live ON / OFF': 'Live ON / OFF Behavior',
  'ON :': 'ON:',
  'le canvas suit les frames a la cadence configuree, utilise le chemin natif SMB sous Electron et applique les boites du WebSocket.':
    'the canvas follows frames at the configured rate, uses the native SMB path under Electron, and applies the boxes from the WebSocket.',
  'OFF :': 'OFF:',
  'le canvas reste sur la frame choisie, tandis que progression et compteurs continuent ; le resultat final est recharge depuis la base en une seule passe.':
    'the canvas stays on the chosen frame while progress and counters keep going; the final result is reloaded from the database in a single pass.',
  'Chemin direct independant de la sonde generique': 'Direct Path Independent of the Generic Probe',
  'Quand Annotation App fournit': 'When Annotation App provides',
  "Electron tente directement la lecture de ce chemin, meme si la sonde SMB globale utilise un autre hostname. Un timeout de 1,5 s protege la navigation et declenche automatiquement le repli HTTP en cas d'echec.":
    'Electron directly attempts to read this path, even if the global SMB probe uses a different hostname. A 1.5 s timeout protects navigation and automatically triggers the HTTP fallback on failure.',
  '5. Saturation du pool de connexions SQL': '5. SQL Connection Pool Saturation',
  'Symptome : application entierement figee, popup « Le backend ne repond pas »,': 'Symptom: the application entirely frozen, "Backend not responding" popup,',
  'sans aucun calcul GPU en cours': 'with no GPU computation running',
  'Ce qui remplissait le pool :': 'What was filling up the pool:',
  'et': 'and',
  'gardent leur connexion pendant un': 'hold their connection during a',
  "d'un PNG 16 bits situe sur un": 'of a 16-bit PNG located on a',
  'montage reseau': 'network mount',
  'Quelques frames en vol suffisaient.': 'A few in-flight frames were enough.',
  'Second correctif : cache LRU des histogrammes': 'Second Fix: LRU Cache for Histograms',
  'Un histogramme porte sur les valeurs': 'A histogram is computed on the',
  'brutes': 'raw values',
  "il ne depend ni de la LUT ni d'aucun reglage d'affichage, et les pixels sources ne changent jamais apres l'import. Il est donc calculable une seule fois. Mesure :":
    'it depends neither on the LUT nor on any display setting, and the source pixels never change after import. It can therefore be computed once. Measured:',
  'x5 en unitaire, x4,5 en rafale': 'x5 single, x4.5 in bursts',
  'sur SSD local — le gain est bien superieur sur montage reseau.': 'on local SSD, the gain is much larger over a network mount.',
  'A retenir pour la suite': 'To Remember Going Forward',
  'Le dimensionnement du pool est relatif au threadpool anyio par defaut (40 threads). Si ce reglage change, le pool doit rester au-dessus.':
    'The pool size is relative to the default anyio threadpool (40 threads). If that setting changes, the pool must stay above it.',
  '6. Cote frontend': '6. On the Frontend Side',
  'La carte Dataset Explorer utilisait Plotly en': 'The Dataset Explorer map used Plotly in',
  ' qui rend en': ', which renders in',
  'un noeud': 'a',
  'par point. Sur 9402 points cela faisait 9402 noeuds, soit': 'node per point. Over 9402 points that made 9402 nodes, i.e.',
  '96 % du DOM de la page': '96% of the page DOM',
  'Chaque selection, zoom ou survol devait retoucher ces milliers de noeuds sur le thread principal.':
    'Every selection, zoom, or hover had to touch these thousands of nodes on the main thread.',
  'Passage en scattergl (WebGL, meme bundle, aucune dependance ajoutee)': 'Switching to scattergl (WebGL, same bundle, no dependency added)',
  'Operation': 'Operation',
  'Gain': 'Gain',
  'DOM total de la page : 9798 -> 392 noeuds.': 'Total page DOM: 9798 -> 392 nodes.',
  "C'est un gain de latence, pas de memoire": 'This Is a Latency Gain, Not a Memory One',
  'Le heap JS ne bouge que de 3 Mo : les noeuds SVG vivent en memoire native, hors': 'The JS heap only moves by 3 MB: SVG nodes live in native memory, outside',
  'Ne pas presenter ce correctif comme une optimisation memoire.': 'Do not present this fix as a memory optimization.',
  'Autres correctifs': 'Other Fixes',
  "Cache d'annotations": 'Annotation cache',
  "c'etait une": 'it used to be an',
  'sans limite, videe uniquement au changement de projet. Bornee a 600 entrees (LRU).':
    'unbounded, cleared only on project change. Now capped at 600 entries (LRU).',
  "Remanence d'image": 'Image remanence',
  'le hook de chargement annulable ne remettait jamais son etat a': 'the cancelable loading hook never reset its state to',
  "et gardait indefiniment sa derniere image. En navigation normale, le repli faisait reapparaitre une image d'une":
    'and kept its last image indefinitely. During normal navigation, the fallback would bring back an image from',
  'autre frame': 'another frame',
  "Corrige en retenant l'URL associee et en ne rendant l'image que si elle correspond encore.":
    'Fixed by keeping track of the associated URL and only rendering the image if it still matches.',
  '7. Ou passe la memoire': '7. Where the Memory Goes',
  'Backend Python': 'Python Backend',
  '~1,0 Go au repos, ~2,1-2,2 Go en pic (torch/CUDA/SAM2 charges a la demande). Sur une VM, cette memoire est':
    '~1.0 GB at rest, ~2.1-2.2 GB at peak (torch/CUDA/SAM2 loaded on demand). On a VM, this memory is',
  'sur la VM': 'on the VM',
  'pas sur le poste client.': 'not on the client machine.',
  '787 Mo mesures sur 7 process (3 renderers, GPU, main, utility). Le Gestionnaire des taches Windows les':
    '787 MB measured across 7 processes (3 renderers, GPU, main, utility). Windows Task Manager',
  'additionne': 'adds them up',
  'sous un seul nom.': 'under a single name.',
  "Facteur 135 entre le JPEG et l'image decodee": 'Factor of 135 Between the JPEG and the Decoded Image',
  "Un navigateur garde l'image": 'A browser keeps the',
  'decodee': 'decoded image',
  'pas le JPEG : une frame 640x512 pese': 'not the JPEG: a 640x512 frame weighs',
  '9,7 Ko en preview mais': '9.7 KB as a preview but',
  '1,25 Mo decodee en RGBA': '1.25 MB decoded as RGBA',
  "Ce que l'application retient ne croit PAS avec le dataset": 'What the Application Retains Does NOT Grow With the Dataset',
  "Le canvas ne garde qu'une image, le prefetch cree des": 'The canvas only keeps one image, the prefetch creates',
  "jamais stockees, la timeline est virtualisee, et la liste de frames coute ~20 Mo a 20 000 frames. Passer de 9 000 a 20 000 frames n'ajoute que quelques dizaines de megaoctets.":
    'objects that are never stored, the timeline is virtualized, and the frame list costs ~20 MB at 20,000 frames. Going from 9,000 to 20,000 frames only adds a few tens of megabytes.',
  'Mesures de reference': 'Reference Measurements',
  'A reutiliser pour comparer apres une modification.': 'Reuse this to compare after a change.',
  'Valeur': 'Value',
  'Points de vigilance': 'Points of Caution',
  'Les JPEG de': 'The JPEGs in',
  "ne vivent que pendant le run : le repli HTTP dans l'URL": 'only live during the run: the HTTP fallback in the',
  'est obligatoire.': 'URL is mandatory.',
  'Le pool SQL est dimensionne par rapport au threadpool anyio (40 threads).': 'The SQL pool is sized relative to the anyio threadpool (40 threads).',
  "ne traduit que les chemins sous une racine partagee : tout fichier destine a une lecture native doit vivre sous l'une d'elles.":
    'only translates paths under a shared root: any file meant for native reading must live under one of them.',
  'designe le backend SSH ;': 'designates the SSH backend;',
  "designe l'hote UNC vu par Windows. Ne pas supposer que ces deux noms sont identiques.":
    'designates the UNC host as seen by Windows. Do not assume these two names are identical.',
  "Le throttle de navigation ne concerne que l'image : ne pas l'invoquer pour expliquer un retard d'annotations.":
    'The navigation throttle only concerns the image: do not use it to explain an annotation delay.',
  'Detail complet et historique des mesures :': 'Full detail and measurement history:',

  // ---- TabAlgorithms.tsx ----
  'si faux :': 'if false:',
  '16 bits PNG/TIFF\nou 8 bits JPEG\nou format optionnel': '16-bit PNG/TIFF\nor 8-bit JPEG\nor optional format',
  '3-sigma / minmax\n/ manuel\n(sequence > projet)': '3-sigma / minmax\n/ manual\n(sequence > project)',
  '8 bits': '8-bit',
  'JPEG qualite 95\ndans un dossier\ntemporaire': 'JPEG quality 95\nin a temp\nfolder',
  'Resize': 'Resize',
  '1024 x 1024\nsans preserver\nle ratio': '1024 x 1024\nwithout preserving\nthe aspect ratio',
  'Tenseur': 'Tensor',
  'normalise ImageNet\nbfloat16 sur GPU': 'ImageNet normalized\nbfloat16 on GPU',
  'Pipeline image source vers tenseur modele': 'Pipeline from source image to model tensor',
  "Le modele voit exactement l'image que vous voyez : la LUT d'affichage est bakee dans l'entree.":
    'The model sees exactly the image you see: the display LUT is baked into the input.',
  'Boucle de selection de masque motion-aware de SAMURAI': "SAMURAI's motion-aware mask selection loop",
  'frame t': 'frame t',
  'propose plusieurs masques': 'proposes several masks',
  'chacun avec son IoU predit': 'each with its predicted IoU',
  'Kalman — prediction': 'Kalman: prediction',
  'etat 8D : x, y, ratio, hauteur': '8D state: x, y, ratio, height',
  '+ leurs 4 vitesses': '+ their 4 velocities',
  'donne une boite attendue': 'gives an expected box',
  'Score combine': 'Combined score',
  'correction du filtre avec la boite retenue (si le score depasse le seuil)':
    'filter correction using the retained box (if the score exceeds the threshold)',
  'Masque retenu': 'Retained mask',
  'le mieux note, pas': 'the highest scoring, not',
  'seulement le plus sur': 'just the most confident',
  'Sous le seuil : le compteur stable_frames retombe a 0, le filtre repart en prediction pure.':
    'Below the threshold: the stable_frames counter drops back to 0, the filter goes back to pure prediction.',
  'Il faut 15 frames consecutives correctes (stable_frames_threshold) pour le considerer reverrouille.':
    'It takes 15 consecutive correct frames (stable_frames_threshold) to consider it relocked.',
  "Fonctionnement reel de chaque methode disponible dans l'onglet Tracks, avec ses paramètres effectifs et les hypotheses qu'elle pose. Les valeurs citees sont celles du code, pas celles des articles d'origine.":
    'How each method available in the Tracks tab actually behaves, with its real parameters and the assumptions it makes. The values quoted come from the code, not from the original papers.',
  "Chaine d'entree commune a tous les modeles": 'Input Chain Common to All Models',
  "Consequence pratique : regler la LUT change ce que le modele recoit. Sur de l'imagerie 16 bits, un mauvais reglage donne une image ecrasee, et le modele travaille alors sur la meme bouillie que celle affichee a l'ecran.":
    'Practical consequence: adjusting the LUT changes what the model receives. On 16-bit imagery, a bad setting produces a crushed image, and the model then works on the same mush that is displayed on screen.',
  'SAMURAI — suivi video mono-cible': 'SAMURAI: Single-Target Video Tracking',
  "SAM2 augmente d'un filtre de Kalman qui arbitre le choix du masque": 'SAM2 augmented with a Kalman filter that arbitrates the mask choice',
  'SAMURAI est un fork de SAM2, pas un modele different : memes poids': 'SAMURAI is a fork of SAM2, not a different model: the same weights',
  "meme architecture. Ce qu'il ajoute est une regle de decision. A chaque frame, SAM2 propose plusieurs masques candidats avec un score de confiance ; SAM2 seul prend le plus sur, SAMURAI prend celui qui concilie confiance et coherence de mouvement.":
    'the same architecture. What it adds is a decision rule. On every frame, SAM2 proposes several candidate masks with a confidence score; SAM2 alone picks the most confident one, SAMURAI picks the one that reconciles confidence with motion consistency.',
  'La boucle de decision': 'The decision loop',
  'Le filtre de Kalman en detail': 'The Kalman Filter in Detail',
  "Etat a 8 dimensions dans l'espace": '8-dimensional state in',
  "centre x, centre y, ratio d'aspect, hauteur, plus les quatre vitesses associees. Modele a vitesse constante":
    'space: center x, center y, aspect ratio, height, plus the four associated velocities. Constant-velocity model',
  'frame). Le bruit est proportionnel a la hauteur de la boite': 'frame). The noise is proportional to the box height',
  "un objet qui occupe beaucoup de pixels a droit a plus d'incertitude absolue qu'un objet lointain. Le melange des scores est fixe a":
    'an object that occupies many pixels has more absolute uncertainty than a distant object. The score blend is fixed at',
  'le Kalman departage, il ne decide pas.': 'Kalman breaks ties, it does not decide.',
  "Pourquoi SAMURAI ne suit qu'UNE cible": 'Why SAMURAI Only Tracks ONE Target',
  'sont des attributs du': 'are attributes of the',
  'modele': 'model',
  "pas d'un objet suivi. Il n'existe donc qu'un seul etat de Kalman en memoire, quel que soit le nombre de cibles. Avec deux objets, la comparaison de scores porte sur un tenseur a plusieurs elements et leve":
    'not of a tracked object. So there is only a single Kalman state in memory, no matter how many targets there are. With two objects, the score comparison operates on a multi-element tensor and raises',
  "L'application gere ce cas au lieu de planter : des la 2e cible,": 'The application handles this case instead of crashing: from the 2nd target onward,',
  'met': 'sets',
  'et bascule sur': 'and switches to',
  "qui suit N objets sans Kalman. L'etat est aussi remis a zero a chaque run — le modele est un singleton partage, un reliquat corromprait le run suivant.":
    'which tracks N objects without Kalman. The state is also reset to zero on every run: the model is a shared singleton, and a leftover would corrupt the next run.',
  'Le mode': 'The',
  'SAMURAI par objet': 'per-object SAMURAI mode',
  "contourne la limite autrement : N passes independantes, une session et un filtre par cible. Suivi de meilleure qualite, cout environ N fois le temps de calcul.":
    'works around the limit differently: N independent passes, one session and one filter per target. Better-quality tracking, at roughly N times the compute cost.',
  'Banque de memoire': 'Memory Bank',
  "l'attention croisee ne regarde que les 7 dernieres frames memorisees, plus la frame de reference (celle que vous avez annotee). Le cout par frame est donc constant, il n'augmente pas avec la longueur de la sequence. SAMURAI filtre en plus ce qui entre dans cette banque":
    'cross-attention only looks at the last 7 memorized frames, plus the reference frame (the one you annotated). The cost per frame is therefore constant and does not grow with sequence length. SAMURAI also filters what enters this bank',
  "une frame ou le suivi est douteux n'est pas memorisee, ce qui evite d'empoisonner les frames suivantes.":
    'a frame where tracking is doubtful is not memorized, which avoids poisoning the following frames.',
  'Preparation des images': 'Image Preparation',
  'Les frames sont converties en JPEG qualite 95 numerotes': 'Frames are converted to quality-95 JPEGs numbered',
  "dans un dossier temporaire — SAMURAI exige des noms qui soient des entiers purs. Un JPEG 8 bits deja conforme est symlinke sans recodage ; sinon la LUT est appliquee puis l'image reencodee. Chaque frame est ensuite redimensionnee en":
    'in a temp folder, SAMURAI requires names that are plain integers. An 8-bit JPEG that already qualifies is symlinked with no re-encoding; otherwise the LUT is applied and the image is re-encoded. Each frame is then resized to',
  '1024 x 1024 sans preservation du ratio': '1024 x 1024 without preserving the aspect ratio',
  "une image 16:9 est donc deformee, de maniere identique a l'entrainement, ce qui est sans effet sur la qualite. Les coordonnees reviennent en normalise via la taille d'origine.":
    'a 16:9 image is therefore distorted, the same way it was during training, which has no effect on quality. Coordinates are converted back to normalized form via the original size.',
  'Precision numerique': 'Numerical Precision',
  "L'inference tourne sous": 'Inference runs under',
  "Sans cela, PyTorch refuse les noyaux Flash et memory-efficient de l'attention et retombe sur une implementation naive, 3 a 5 fois plus lente. Le meme contexte enveloppe l'initialisation, le prompt et la propagation : un dtype different entre ces etapes corromprait la banque de memoire.":
    'Without it, PyTorch refuses the Flash and memory-efficient attention kernels and falls back to a naive implementation, 3 to 5 times slower. The same context wraps initialization, the prompt, and propagation: a different dtype between these steps would corrupt the memory bank.',
  'Parametres': 'Parameters',
  'Resolution interne, appliquee a chaque frame.': 'Internal resolution, applied to every frame.',
  'Frames conservees dans la banque de memoire.': 'Frames kept in the memory bank.',
  'Frames consecutives correctes avant de considerer le suivi reverrouille.': 'Consecutive correct frames before considering tracking relocked.',
  'Poids du Kalman dans le score de selection du masque.': 'Weight of Kalman in the mask selection score.',
  "IoU minimum pour qu'une frame entre en memoire.": 'Minimum IoU for a frame to enter memory.',
  "Frames en RAM plutot qu'en VRAM. Plus lent, indispensable sur petit GPU.": 'Frames in RAM instead of VRAM. Slower, essential on a small GPU.',
  'Hypotheses': 'Assumptions',
  'Le mouvement est lisse a vitesse quasi constante': 'Motion is smooth at a near-constant speed',
  'un changement brutal de direction fait diverger la prediction, le suivi decroche': 'a sudden change of direction makes the prediction diverge, tracking drops',
  "La cible reste visible ou n'est occultee que brievement": 'The target stays visible or is only briefly occluded',
  'apres une longue occultation le filtre a trop derive pour reverrouiller': 'after a long occlusion the filter has drifted too much to relock',
  "Le ratio d'aspect varie peu": 'The aspect ratio barely changes',
  'une rotation dans le plan image fait de la boite un mauvais descripteur': 'a rotation in the image plane makes the box a poor descriptor',
  "La boite de depart cadre bien l'objet": 'The starting box frames the object well',
  'un prompt approximatif fixe une cible ambigue pour toute la sequence': 'an approximate prompt locks in an ambiguous target for the whole sequence',
  "L'apparence reste comparable sur 7 frames": 'Appearance stays comparable over 7 frames',
  "un changement rapide d'echelle ou d'eclairage vide la memoire de son utilite": 'a rapid change of scale or lighting empties the memory of its usefulness',
  'SAM2 video — suivi multi-objets': 'SAM2 Video: Multi-Object Tracking',
  "Memoire d'attention seule, sans modele de mouvement": 'Attention memory alone, with no motion model',
  "Utilise automatiquement des que plusieurs cibles sont demandees, et disponible seul si SAMURAI n'est pas installe. Chaque objet recoit un identifiant et son propre jeu de masques ; la propagation est mutualisee, il n'y a donc pas de surcout proportionnel au nombre d'objets comme dans le mode par objet.":
    'Used automatically as soon as several targets are requested, and available on its own if SAMURAI is not installed. Each object gets an ID and its own set of masks; propagation is shared, so there is no cost that scales with the number of objects the way there is in per-object mode.',
  "La difference avec SAMURAI tient en une phrase : SAM2 choisit le masque dont il est le plus sur, sans jamais se demander si ce masque est plausible compte tenu du deplacement precedent. Sur des objets bien contrastes et isolees, la difference est nulle. Sur deux objets similaires qui se croisent, SAM2 peut sauter de l'un a l'autre la ou le Kalman de SAMURAI aurait rejete le saut.":
    "The difference with SAMURAI comes down to one sentence: SAM2 picks the mask it is most confident about, without ever asking whether that mask is plausible given the previous motion. On well-contrasted, isolated objects, the difference is nil. On two similar objects that cross paths, SAM2 can jump from one to the other where SAMURAI's Kalman filter would have rejected the jump.",
  'Provenance distincte en base': 'Distinct Provenance in the Database',
  'Depuis la separation, les annotations portent': 'Since the split, annotations carry',
  'selon le tracker reellement actif. Les runs anterieurs conservent': 'depending on which tracker was actually active. Earlier runs keep',
  'qui ne permettait pas de les distinguer.': 'which made them indistinguishable.',
  'Les objets restent distinguables par leur apparence': 'Objects stay distinguishable by their appearance',
  'deux objets identiques qui se croisent echangent leurs identifiants': 'two identical objects that cross paths swap their IDs',
  'Les identites sont fixees par le prompt initial': 'Identities are fixed by the initial prompt',
  "un objet qui entre en cours de sequence ne sera jamais suivi": 'an object that enters partway through the sequence will never be tracked',
  "La memoire de 7 frames suffit a maintenir l'identite": 'The 7-frame memory is enough to maintain identity',
  "une occultation plus longue casse la piste sans possibilite de rattrapage": 'a longer occlusion breaks the track with no way to recover it',
  'Grounding DINO — detection par texte': 'Grounding DINO: Text-based Detection',
  'Detecteur ouvert pilote par un prompt, sans notion de temps': 'Open detector driven by a prompt, with no notion of time',
  'Modele': 'Model',
  "telecharge automatiquement depuis HuggingFace au premier usage (environ 340 Mo). Il associe un encodeur texte et un encodeur image et retourne les boites dont la representation correspond au prompt. Vocabulaire ouvert : le prompt n'a pas besoin d'appartenir a une liste de classes predefinies.":
    'automatically downloaded from HuggingFace on first use (about 340 MB). It pairs a text encoder and an image encoder and returns the boxes whose representation matches the prompt. Open vocabulary: the prompt does not need to belong to a predefined list of classes.',
  'Deux seuils, deux roles': 'Two Thresholds, Two Roles',
  'filtre sur la confiance de la boite ;': 'filters on box confidence;',
  "filtre sur la force de l'association entre la boite et les mots du prompt. En tracking guide les deux sont volontairement bas (0.20 et 0.15) : l'objectif est de maximiser le rappel, le tri est ensuite fait par l'appariement geometrique aux cibles.":
    "filters on the strength of the association between the box and the prompt's words. In guided tracking, both are deliberately kept low (0.20 and 0.15): the goal is to maximize recall, sorting is then done by geometric matching to the targets.",
  'Redaction du prompt': 'Writing the Prompt',
  'Les termes doivent etre separes par des points, en minuscules, au singulier :': 'Terms must be separated by periods, lowercase, singular:',
  "Une phrase entiere degrade la detection — le modele attend des concepts, pas une description.":
    'A full sentence degrades detection: the model expects concepts, not a description.',
  "L'objet appartient au vocabulaire visuel appris": 'The object belongs to the learned visual vocabulary',
  "une cible tres specifique (piece industrielle, signature infrarouge) n'est pas trouvee, quel que soit le prompt":
    'a very specific target (an industrial part, an infrared signature) will not be found, no matter the prompt',
  'Chaque frame est independante': 'Each frame is independent',
  "aucune coherence temporelle : les identites viennent uniquement de l'appariement par centroide": 'no temporal coherence: identities come solely from centroid matching',
  "Le domaine visuel est proche des donnees d'entrainement": 'The visual domain is close to the training data',
  "sur de l'infrarouge ou du 16 bits mal remappe, les scores s'effondrent": 'on infrared or badly remapped 16-bit imagery, scores collapse',
  'SAM3 — detection et segmentation par concept': 'SAM3: Concept-based Detection and Segmentation',
  'Alternative a Grounding DINO, sortie boite ou masque': 'Alternative to Grounding DINO, box or mask output',
  'Egalement pilote par texte, mais capable de produire directement des masques de segmentation en plus des boites — reglable par':
    'Also text-driven, but able to directly produce segmentation masks in addition to boxes, configurable via',
  'Poids locaux dans': 'Local weights in',
  'Dans le tracking guide, il occupe exactement la meme place que Grounding DINO : un detecteur applique frame par frame, dont les sorties sont ensuite appariees aux cibles. Le choix entre les deux est empirique — SAM3 se comporte generalement mieux sur les objets aux contours nets, Grounding DINO sur les concepts plus abstraits.':
    'In guided tracking, it occupies exactly the same place as Grounding DINO: a detector applied frame by frame, whose outputs are then matched to the targets. The choice between the two is empirical: SAM3 generally does better on objects with sharp edges, Grounding DINO on more abstract concepts.',
  'Le concept est exprimable en langue naturelle': 'The concept can be expressed in natural language',
  'une distinction purement visuelle sans mot pour la nommer reste hors de portee': 'a purely visual distinction with no word to name it stays out of reach',
  'Frames independantes': 'Independent frames',
  'meme absence de continuite temporelle que Grounding DINO': 'the same lack of temporal continuity as Grounding DINO',
  'Homographie XFeat / SIFT': 'XFeat / SIFT Homography',
  "Propagation geometrique quand c'est la camera qui bouge": 'Geometric propagation for when the camera is the one moving',
  'Aucun reseau de detection : on estime la transformation entre deux frames et on y transporte les boites. Appariement par XFeat sur GPU, repli SIFT sur CPU, puis RANSAC pour estimer une matrice 3x3.':
    'No detection network: the transformation between two frames is estimated and the boxes are carried across it. Matching via XFeat on GPU, SIFT fallback on CPU, then RANSAC to estimate a 3x3 matrix.',
  "Points d'interet extraits par image.": 'Interest points extracted per image.',
  'Similarite cosinus minimale pour valider un appariement.': 'Minimum cosine similarity to validate a match.',
  'Erreur de reprojection toleree, en pixels.': 'Tolerated reprojection error, in pixels.',
  "Nombre absolu d'inliers requis.": 'Absolute number of inliers required.',
  "Proportion d'inliers requise.": 'Required inlier proportion.',
  'Refus explicite plutot que resultat faux': 'Explicit Refusal Rather Than a Wrong Result',
  "Sous 30 % d'inliers,": 'Below 30% inliers,',
  'retourne': 'returns',
  "et la propagation s'arrete. Une homographie estimee sur trop peu de correspondances produit des boites aberrantes ; mieux vaut ne rien ecrire.":
    'and propagation stops. A homography estimated from too few correspondences produces wildly wrong boxes; better to write nothing at all.',
  'La scene est plane ou la camera tourne autour de son centre optique': 'The scene is planar, or the camera rotates around its optical center',
  'en presence de parallaxe une seule matrice ne peut pas decrire la scene': 'in the presence of parallax, a single matrix cannot describe the scene',
  "L'objet est immobile par rapport a la scene": 'The object is stationary relative to the scene',
  "un objet qui se deplace en propre ne suit pas la transformation globale — utiliser le flux optique":
    'an object with its own motion does not follow the global transform, use optical flow instead',
  'La texture est suffisante': 'There is enough texture',
  "ciel, mer, mur uniforme : pas de points d'interet, pas d'homographie": 'sky, sea, a plain wall: no interest points, no homography',
  'Le recouvrement entre frames est important': 'Overlap between frames is significant',
  "un mouvement trop rapide ne laisse pas assez de correspondances": 'motion that is too fast leaves too few correspondences',
  'Flux optique Lucas-Kanade': 'Lucas-Kanade Optical Flow',
  "Propagation par objet, quand c'est la cible qui bouge": 'Per-object propagation, for when the target is the one moving',
  "Complementaire de l'homographie. Des points sont semes dans chaque boite puis suivis individuellement d'une frame a l'autre par Lucas-Kanade pyramidal. Le deplacement median des points survivants translate la boite. Chaque objet est traite separement, donc plusieurs objets peuvent partir dans des directions differentes.":
    'A complement to homography. Points are seeded inside each box then tracked individually from one frame to the next by pyramidal Lucas-Kanade. The median displacement of the surviving points translates the box. Each object is handled separately, so several objects can move in different directions.',
  'Fenetre de recherche, en pixels. Plus grand = mouvements rapides mais moins precis.': 'Search window, in pixels. Bigger = handles fast motion but less precise.',
  "Niveaux de pyramide. Chaque niveau double l'amplitude gerable.": 'Pyramid levels. Each level doubles the manageable displacement.',
  'Points suivis minimum pour valider le deplacement.': 'Minimum tracked points to validate the displacement.',
  'Constance de la luminance : un point garde son intensite': 'Brightness constancy: a point keeps its intensity',
  "un changement d'eclairage ou un reflet fait perdre les points": 'a lighting change or a reflection causes points to be lost',
  'Le deplacement reste dans la fenetre de recherche': 'The displacement stays within the search window',
  'trop rapide pour 21 px sur 3 niveaux : le suivi decroche — augmenter max_level': 'too fast for 21 px over 3 levels: tracking drops, increase max_level',
  'Les points voisins bougent ensemble': 'Neighboring points move together',
  "sur un objet deformable, le deplacement median n'a plus de sens": 'on a deformable object, the median displacement no longer makes sense',
  "L'objet est texture": 'The object has texture',
  'une surface uniforme ne fournit aucun point suivable': 'a uniform surface provides no trackable points',
  'Comment choisir': 'How to Choose',
  'Une cible, sequence longue': 'One target, long sequence',
  'SAMURAI, le meilleur compromis.': 'SAMURAI, the best tradeoff.',
  'SAM2 multi-objets ; passer en SAMURAI par objet si la qualite ne suffit pas et que le temps de calcul est acceptable.':
    'SAM2 multi-object; switch to per-object SAMURAI if quality is not enough and the compute time is acceptable.',
  'Objets nombreux et nommables': 'Many, nameable objects',
  'Grounding DINO ou SAM3 en tracking guide.': 'Grounding DINO or SAM3 in guided tracking.',
  'Detecteur deja entraine sur le domaine': 'A detector already trained on the domain',
  'YOLO custom, sans hesiter.': 'A custom YOLO, without hesitation.',
  'Camera qui bouge, scene fixe': 'Moving camera, static scene',
  'homographie.': 'homography.',
  'Camera fixe, objets qui bougent': 'Static camera, moving objects',
  'flux optique.': 'optical flow.',

  // ---- helpContent.ts (rendered via HelpModal.tsx / HelpPanel.tsx) ----
  'Outils': 'Tools',
  'Rectangle (bbox)': 'Rectangle (bbox)',
  'Mode review rapide (bascule)': 'Quick review mode (toggle)',
  'Annuler le dessin / désélectionner / revenir à Sélection': 'Cancel drawing / deselect / return to Selection',
  'Édition': 'Editing',
  'Suppr': 'Delete',
  'Supprimer les annotations sélectionnées': 'Delete the selected annotations',
  'Annuler la dernière action': 'Undo',
  'Rétablir (aussi Ctrl+Shift+Z)': 'Redo (also Ctrl+Shift+Z)',
  'Copier les annotations sélectionnées': 'Copy the selected annotations',
  'Coller sur la frame courante': 'Paste onto the current frame',
  'Sélectionner une classe — uniquement si cette touche a été assignée à une classe dans le gestionnaire de classes (sans effet sinon)':
    'Select a class, only if this key has been assigned to a class in the class manager (no effect otherwise)',
  'Molette': 'Wheel',
  'Zoom centré sur le curseur': 'Zoom centered on the cursor',
  'Pan (panoramique) en maintenant': 'Pan by holding',
  'Ferme le polygone (mode Polygone) ou accepte le masque SAM (mode SAM Point, SAM2 chargé). Sur le canvas hors de ces modes : sans effet.':
    'Closes the polygon (Polygon mode) or accepts the SAM mask (SAM Point mode, SAM2 loaded). On the canvas outside these modes: no effect.',
  "SAM Point : point d'arrière-plan (background)": 'SAM Point: background point',
  'Timeline & pistes': 'Timeline & tracks',
  'Ctrl+clic': 'Ctrl+click',
  'Ajouter/retirer une frame à la sélection': 'Add/remove a frame from the selection',
  'Sélectionner une plage de frames': 'Select a range of frames',
  'Tout sélectionner (quand la timeline est survolée)': 'Select all (when hovering the timeline)',
  'Vider les annotations des frames sélectionnées': 'Clear the annotations of the selected frames',
  'Clic bloc': 'Block click',
  'Sélectionner ce bloc de piste (glow) + aller à son début — Suppr efface CE bloc':
    'Selects this track block (glow) + jumps to its start; Delete clears THIS block',
  'Double-clic bloc': 'Double-click block',
  'Aller à la fin du bloc de piste': 'Go to the end of the track block',
  'Clic gris': 'Gray click',
  'Sélectionner toute la piste — Suppr efface la piste entière': 'Selects the whole track; Delete clears the entire track',
  'Aller à': 'Go to',
  'Champ numérique sous la timeline : taper un numéro de frame pour y sauter': 'Numeric field below the timeline: type a frame number to jump to it',
  'Sélection (A)': 'Selection (A)',
  'Déplacer / redimensionner / sélectionner des annotations existantes.': 'Move / resize / select existing annotations.',
  'Rectangle (R)': 'Rectangle (R)',
  'Dessiner une bbox. Coordonnées stockées en YOLO normalisé [0,1].': 'Draw a bbox. Coordinates stored in normalized YOLO format [0,1].',
  'Polygone (P)': 'Polygon (P)',
  'Cliquer les sommets, double-clic pour fermer.': 'Click the vertices, double-click to close.',
  'SAM Point (S)': 'SAM Point (S)',
  'Clic = point objet (foreground), clic droit = arrière-plan. Double-clic accepte le meilleur des 3 masques. Échap annule.':
    'Click = object point (foreground), right click = background. Double-click accepts the best of the 3 masks. Esc cancels.',
  'Bouton dédié : auto-segmente toute la frame (grid sampling). Utiliser NMS pour dédupliquer.':
    'Dedicated button: auto-segments the whole frame (grid sampling). Use NMS to deduplicate.',
  'Texte (Grounding DINO)': 'Text (Grounding DINO)',
  'Prompt « voiture. personne. » → détection par description. Box/Text threshold : bas = plus de détections (faux positifs), haut = plus sûr.':
    'Prompt "car. person." -> detection by description. Box/Text threshold: low = more detections (false positives), high = safer.',
  'Review rapide (V)': 'Quick Review (V)',
  'Bascule le mode revue pour valider/supprimer vite frame par frame.': 'Toggles review mode to quickly accept/delete frame by frame.',
  "Propage UNE cible (prompt = boîte englobante). Le filtre de Kalman arbitre entre les masques candidats de SAM2 : il retient le plus cohérent avec le mouvement, pas seulement le plus sûr. Mono-cible car l'état du filtre est porté par le modèle, pas par objet.":
    "Propagates ONE target (prompt = bounding box). The Kalman filter arbitrates between SAM2's candidate masks: it keeps the one most consistent with the motion, not just the most confident. Single-target because the filter's state is carried by the model, not per object.",
  'SAM2 vidéo (multi-objets)': 'SAM2 video (multi-object)',
  "Activé automatiquement dès 2 cibles : SAMURAI est désactivé et SAM2 suit N objets nativement, sans modèle de mouvement. Plus rapide que N passes, mais peut confondre deux objets similaires qui se croisent.":
    'Enabled automatically from 2 targets onward: SAMURAI is disabled and SAM2 tracks N objects natively, with no motion model. Faster than N passes, but can confuse two similar objects that cross paths.',
  'N passes indépendantes, un filtre de Kalman par cible. Meilleure qualité sur plusieurs objets, coût ≈ N fois le temps de calcul.':
    'N independent passes, one Kalman filter per target. Better quality on multiple objects, cost approx. N times the compute time.',
  'Detect. (GD / SAM3)': 'Detect. (GD / SAM3)',
  "Détecteur appliqué frame par frame, puis appariement au centroïde des cibles. Seuils volontairement bas : le tracking écarte les fausses alarmes éloignées de toute cible.":
    "Detector applied frame by frame, then matched to the targets' centroids. Thresholds are deliberately low: tracking discards false alarms that are far from any target.",
  'Homographie (XFeat/SIFT)': 'Homography (XFeat/SIFT)',
  "Propage une keyframe en compensant le mouvement caméra. Suppose une scène plane et un objet immobile par rapport au décor. Refuse d'écrire sous 30 % d'inliers.":
    'Propagates a keyframe by compensating for camera motion. Assumes a planar scene and an object stationary relative to the background. Refuses to write below 30% inliers.',
  "Suit chaque bbox par points caractéristiques. Pour les objets en mouvement propre devant une caméra fixe — le cas inverse de l'homographie.":
    'Tracks each bbox via characteristic points. For objects with their own motion in front of a static camera, the opposite case from homography.',
  'Multi-séquence': 'Multi-sequence',
  "Un projet peut contenir plusieurs séquences (dossiers, vidéos et formats optionnels détectés). Le slider et la timeline sont relatifs à la séquence courante.":
    'A project can contain several sequences (folders, videos, and detected optional formats). The slider and timeline are relative to the current sequence.',
  'Cibles de tracking partagées': 'Shared Tracking Targets',
  "Double-clic sur une bbox coche/décoche la cible pour TOUS les onglets de suivi (SAMURAI, Detect, Homogr., Flux opt.).":
    'Double-clicking a bbox checks/unchecks the target for ALL tracking tabs (SAMURAI, Detect, Homogr., Optical flow).',
  'Suppression de blocs de piste': 'Deleting Track Blocks',
  "Sur la timeline : clic sur un bloc coloré le sélectionne (glow) → Suppr efface uniquement ce bloc ; clic sur le gris / bouton global efface toute la piste.":
    'On the timeline: clicking a colored block selects it (glow) -> Delete clears only that block; clicking the gray area / global button clears the entire track.',
  "Cellules virtualisées : vert = frame annotée (avec compteur), rouge = vide. Sélection multi (Ctrl/Shift) et Suppr pour vider. Barre blanche = frame courante sur chaque piste ; % à droite = frames explorées par le tracker.":
    'Virtualized cells: green = annotated frame (with counter), red = empty. Multi-select (Ctrl/Shift) and Delete to clear. White bar = current frame on each track; % on the right = frames explored by the tracker.',
  "Bouton NMS (seuil IoU réglable) dans la liste d'annotations : supprime les doublons après SAM Auto / détection.":
    'NMS button (adjustable IoU threshold) in the annotation list: removes duplicates after SAM Auto / detection.',
  'YOLO, COCO ou .ver (natif 10 colonnes). Un sous-dossier ou un fichier par séquence. Bouton « Exporter » en haut à droite.':
    'YOLO, COCO or .ver (native 10-column format). One subfolder or file per sequence. "Export" button at the top right.',
  'Sauvegarde auto': 'Auto-save',
  'Session + backup JSON toutes les 2 min, silencieux. Glisser-déposer un JSON pour restaurer.':
    'Session + JSON backup every 2 min, silent. Drag and drop a JSON to restore.',
  "LUT d'affichage (16 bits)": 'Display LUT (16-bit)',
  "Bouton LUT flottant : remap 3-sigma / min-max / manuel, réglable par projet OU par séquence (IR et RGB dans le même projet). La LUT est aussi appliquée à l'entrée des modèles — ils voient exactement votre image.":
    "Floating LUT button: 3-sigma / min-max / manual remap, adjustable per project OR per sequence (IR and RGB in the same project). The LUT is also applied to the models' input, they see exactly your image.",
  "Bouton Monitoring sur la page d'accueil : part de l'automatique et du manuel, sorties IA conservées / retouchées / supprimées, frames reprises plusieurs fois, historique des runs.":
    'Monitoring button on the home page: share of automatic vs. manual work, AI outputs kept / edited / deleted, frames revisited several times, run history.',
  'sam2.1_hiera_small.pt (~46 MB). Résolution interne 1024×1024, inférence en bfloat16 sur GPU.':
    'sam2.1_hiera_small.pt (~46 MB). Internal resolution 1024x1024, bfloat16 inference on GPU.',
  'Configuré': 'Configured',
  'sam2.1_hiera_tiny.pt (~38 MB). Repli automatique sur CPU.': 'sam2.1_hiera_tiny.pt (~38 MB). Automatic fallback to CPU.',
  'Disponible': 'Available',
  'Fork de SAM2 (mêmes poids) ajoutant un filtre de Kalman 8D et une mémoire filtrée sur 7 frames. Mono-cible par construction.':
    'Fork of SAM2 (same weights) adding an 8D Kalman filter and a memory filtered over 7 frames. Single-target by design.',
  'Inclus': 'Included',
  'IDEA-Research/grounding-dino-tiny. Téléchargement auto HuggingFace (~340 MB). Prompt : concepts séparés par des points.':
    'IDEA-Research/grounding-dino-tiny. Automatic download from HuggingFace (~340 MB). Prompt: concepts separated by periods.',
  'Détection et segmentation par concept, sortie bbox ou masque. Poids locaux dans backend/checkpoints/sam3.1/.':
    'Concept-based detection and segmentation, bbox or mask output. Local weights in backend/checkpoints/sam3.1/.',
  "Appariement GPU pour l'homographie. Repli SIFT+RANSAC sur CPU.": 'GPU matching for homography. SIFT+RANSAC fallback on CPU.',
  'Créer un projet « Séquence Image » et importer une ou plusieurs séquences (dossier, vidéo ou format optionnel détecté).':
    'Create a "Sequence Image" project and import one or more sequences (folder, video, or a detected optional format).',
  'Sur une frame de référence : annoter les objets (manuel, SAM Point, ou Grounding DINO).':
    'On a reference frame: annotate the objects (manually, SAM Point, or Grounding DINO).',
  'Onglet Tracks → double-clic sur les bbox pour désigner les cibles (partagées entre onglets).':
    'Tracks tab -> double-click the bboxes to designate the targets (shared across tabs).',
  'SAMURAI : propage UNE cible avec filtre de Kalman (boxes en temps réel, stop/pause). Plusieurs cibles → SAM2 multi-objets automatiquement.':
    'SAMURAI: propagates ONE target with a Kalman filter (real-time boxes, stop/pause). Multiple targets -> SAM2 multi-object automatically.',
  'Homographie (caméra qui bouge, scène fixe) ou Flux optique (caméra fixe, objets qui bougent) : choisir selon ce qui bouge.':
    'Homography (moving camera, static scene) or Optical flow (static camera, moving objects): choose based on what is moving.',
  'Detect. : GD / SAM3 sur les frames suivantes, avec appariement par distance de centroïde.':
    'Detect.: GD / SAM3 on the following frames, with matching by centroid distance.',
  "Corriger : re-annoter sur n'importe quelle frame (breakpoint) puis relancer depuis là.":
    'Fix: re-annotate on any frame (a breakpoint) then restart from there.',
  'Nettoyer la timeline : supprimer un bloc précis (clic bloc + Suppr) ou une piste entière (clic gris + Suppr).':
    'Clean up the timeline: delete a specific block (click block + Delete) or an entire track (click gray + Delete).',
  'Exporter en YOLO, COCO ou .ver.': 'Export as YOLO, COCO or .ver.',

  'copie les annotations dans le presse-papier de session.': 'copies the annotations to the session clipboard.',
  'colle les annotations copiées sur la frame courante.': 'pastes the copied annotations onto the current frame.',
  "50 niveaux d'historique via": '50 levels of history via',
  'La molette de souris zoome sur le canvas.': 'The mouse wheel zooms the canvas.',
  '+ glisser pour se deplacer. Les miniatures du bas sont sparse : Ctrl/clic selectionne, Shift/clic selectionne une plage, Suppr vide les annotations selectionnees.':
    '+ drag to pan. The thumbnails at the bottom are sparse: Ctrl/click selects, Shift/click selects a range, Delete clears the selected annotations.',
  "1. Import vidéo ou dossier d'images": '1. Importing a video or image folder',
  'Import vidéo MP4': 'MP4 video import',
  'Drag & drop ou chemin serveur': 'Drag & drop or server path',
  'OpenCV extrait les frames une par une (jamais la vidéo entière en RAM)': 'OpenCV extracts frames one at a time (the whole video is never held in RAM)',
  'Frames stockées en': 'Frames stored as',
  'dans': 'in',
  'Miniatures 160x90 generees a la demande pour la timeline': 'Thumbnails 160x90 generated on demand for the timeline',
  'Params :': 'Params:',
  "Import dossier d'images": 'Image folder import',
  'Sélection multiple de fichiers images': 'Multiple selection of image files',
  'Triés par nom de fichier (ordre alphabétique)': 'Sorted by file name (alphabetical order)',
  'Même pipeline que la vidéo ensuite': 'Same pipeline as video from there on',
  'Formats séquentiels optionnels': 'Optional sequential formats',
  'Découverts automatiquement au démarrage du backend': 'Automatically discovered at backend startup',
  'Extensions et libellés ajoutés dynamiquement au glisser-déposer': 'Extensions and labels added dynamically to drag-and-drop',
  "Import immédiat ou conversion selon le contrat de l'adaptateur": "Immediate import or conversion depending on the adapter's contract",
  "Absents de l'interface si aucun adaptateur n'est installé": 'Absent from the interface if no adapter is installed',
  'Gestion mémoire — comment fonctionne le chargement': 'Memory management: how loading works',
  'Upload (réseau → disque)': 'Upload (network → disk)',
  'La vidéo est reçue par': 'The video is received in',
  'chunks de': 'chunks of',
  '(défaut 8 MB) et écrite directement sur disque. Pour un MP4 de 10 Go :': '(default 8 MB) and written straight to disk. For a 10 GB MP4:',
  'max 8 MB en RAM': 'max 8 MB in RAM',
  'jamais le fichier entier.': 'never the whole file.',
  'Extraction (disque → frames)': 'Extraction (disk → frames)',
  'décode': 'decodes',
  '1 frame à la fois': '1 frame at a time',
  'La RAM utilisée = 1 frame décodée =': 'The RAM used = 1 decoded frame =',
  'octets (~6 MB pour 1080p, ~25 MB pour 4K). Libérée immédiatement après écriture JPEG.':
    'bytes (~6 MB for 1080p, ~25 MB for 4K). Freed immediately after the JPEG write.',
  'Navigation frontend': 'Frontend navigation',
  "Les metadonnees des frames sont chargees en une passe large (pagination automatique jusqu'a epuisement), mais la timeline ne rend que les cellules visibles. Elle n'affiche AUCUNE vignette : vert = frame annotee avec son compteur, rouge = frame vide. Pendant le scrubbing et la propagation, le canvas bascule sur des previews JPEG 480 px (~15 Ko) — indispensable en acces distant SSH.":
    "Frame metadata is loaded in one broad pass (automatic pagination until exhausted), but the timeline only renders visible cells. It shows NO thumbnails at all: green = annotated frame with its counter, red = empty frame. During scrubbing and propagation, the canvas switches to 480 px JPEG previews (~15 KB), essential for remote SSH access.",
  "Hyperparamètres d'extraction": 'Extraction hyperparameters',
  "FPS d'extraction.": 'Extraction FPS.',
  'Ex: 1.0 sur une vidéo 30fps → 30× moins de frames.': 'E.g.: 1.0 on a 30fps video → 30x fewer frames.',
  'Réduire pour économiser disque et annotation.': 'Lower it to save disk space and annotation effort.',
  'Plafond absolu (défaut 10 000). Protection contre les vidéos très longues.': 'Hard cap (default 10,000). Protects against very long videos.',
  "Qualité JPEG des frames (50–95, défaut 85). N'affecte pas la RAM, seulement la taille disque. 85 = bon compromis. 95 = fidélité maximale pour les annotations précises.":
    "JPEG quality of the frames (50–95, default 85). Does not affect RAM, only disk size. 85 = good tradeoff. 95 = maximum fidelity for precise annotations.",
  "Taille des chunks d'upload (défaut 8 MB). Uniquement pour l'upload réseau.": 'Upload chunk size (default 8 MB). Only relevant for network upload.',
  'Estimation rapide de la taille disque': 'Quick disk-size estimate',
  '1 frame 1080p JPEG q=85 ≈': '1 frame 1080p JPEG q=85 ≈',
  '1000 frames ≈': '1000 frames ≈',
  'Vidéo 60s à 30fps = 1800 frames → ~500 MB': 'Video 60s at 30fps = 1800 frames → ~500 MB',
  'Avec': 'With',
  '→ 300 frames → ~80 MB': '→ 300 frames → ~80 MB',
  'Les miniatures (160×90) ajoutent ~5 KB/frame': 'Thumbnails (160×90) add ~5 KB/frame',
  'Différence avec Random Image': 'Difference with Random Image',
  "Le mode Séquence Image active l'onglet": 'Sequence Image mode enables the',
  'dans la sidebar, la timeline de frames en bas du canvas, et les outils de propagation. Ces fonctionnalités sont cachées en mode Random Image.':
    'tab in the sidebar, the frame timeline below the canvas, and the propagation tools. These features are hidden in Random Image mode.',
  '2. Navigation entre frames': '2. Navigating between frames',
  'frame précédente / suivante (raccourcis clavier)': 'previous / next frame (keyboard shortcuts)',
  'Clic sur une miniature dans la': 'Click a thumbnail in the',
  'timeline': 'timeline',
  'en bas du canvas pour naviguer directement': 'below the canvas to jump directly',
  "Les miniatures annotees affichent un badge vert avec le nombre d'annotations": 'Annotated thumbnails show a green badge with the annotation count',
  'Pendant une propagation, la': 'During propagation, the',
  'barre verte en haut de la page': 'green bar at the top of the page',
  'indique la frame en cours de traitement en temps réel': 'shows in real time which frame is being processed',
  '3. Workflow : Annoter → Propager': '3. Workflow: Annotate → Propagate',
  'Frame de référence': 'Reference frame',
  '1ère ou keyframe': '1st or keyframe',
  'Annotation': 'Annotation',
  'Propagation': 'Propagation',
  'Vérification': 'Verification',
  'Review + correction': 'Review + correction',
  'split par frame': 'per-frame split',
  'Detect. + association': 'Detect. + association',
  'Annotez une frame de référence, puis lancez': 'Annotate a reference frame, then run',
  "L'algorithme utilise Grounding DINO ou SAM3 sur les frames suivantes et associe les détections par distance minimale / IoU.":
    'The algorithm runs Grounding DINO or SAM3 on the following frames and matches detections by minimal distance / IoU.',
  'Propagation Homographie': 'Homography Propagation',
  'warpe les annotations de la frame courante vers les suivantes en estimant le mouvement global de la caméra (XFeat GPU ou SIFT CPU).':
    'warps the current frame\'s annotations onto the following ones by estimating the camera\'s global motion (XFeat GPU or SIFT CPU).',
  'Propagation Flux Optique': 'Optical Flow Propagation',
  "suit chaque bbox individuellement via Lucas-Kanade. Adapte la taille des boxes si l'objet s'approche ou s'éloigne. Idéal pour véhicules, piétons.":
    "tracks each bbox individually via Lucas-Kanade. Adjusts box size as the object gets closer or farther away. Ideal for vehicles, pedestrians.",
  'double-clic sur la cible pour la marquer, puis lancez la propagation. Les boxes apparaissent': 'double-click the target to mark it, then start the propagation. Boxes appear',
  'frame par frame en temps réel': 'frame by frame in real time',
  'Boutons Stop et Pause disponibles à tout moment. SAMURAI résiste aux occlusions grâce au filtre de Kalman.':
    'Stop and Pause buttons available at any time. SAMURAI withstands occlusions thanks to the Kalman filter.',
  '4. Gestion des Tracks': '4. Track Management',
  "L'onglet": 'The',
  "(sidebar) liste tous les tracks du projet. Un track regroupe les annotations d'un même objet à travers les frames.":
    "(sidebar) tab lists every track in the project. A track groups the annotations of a single object across frames.",
  'Actions disponibles': 'Available actions',
  'Renommer un track': 'Rename a track',
  'Fusionner deux tracks (opération par paire)': 'Merge two tracks (pairwise operation)',
  'Supprimer un track (et toutes ses annotations)': 'Delete a track (and all its annotations)',
  '"Tout suppr."': '"Delete all"',
  "supprime tous les tracks d'un coup": 'deletes all tracks at once',
  "Naviguer vers la frame d'une annotation de track": "Jump to the frame of a track's annotation",
  'Stop/Pause pendant la propagation SAMURAI': 'Stop/Pause during SAMURAI propagation',
  'Nettoyage timeline': 'Timeline cleanup',
  'Barre blanche = frame courante sur chaque piste ; % à droite = frames explorées par le tracker':
    'White bar = current frame on each track; % on the right = frames explored by the tracker',
  'Clic sur un bloc coloré → le sélectionne (Suppr efface ce bloc) ; double-clic → fin du bloc':
    'Click a colored block → selects it (Delete clears that block); double-click → ends the block',
  'Clic sur le gris / bouton global → supprime toute la piste (les uids restants sont renumérotés)':
    'Click the gray area / global button → deletes the whole track (remaining uids are renumbered)',
  'Workflow recommandé': 'Recommended workflow',
  '1. Annotez 1-3 frames de reference reparties dans la video. 2. Lancez SAMURAI ou Detect. selon le cas. 3. Utilisez Homographie ou Flux optique pour compenser le mouvement camera. 4. Corrigez et nettoyez la timeline (blocs / pistes). 5. Exportez.':
    '1. Annotate 1-3 reference frames spread across the video. 2. Run SAMURAI or Detect. as appropriate. 3. Use Homography or Optical flow to compensate for camera motion. 4. Fix and clean up the timeline (blocks / tracks). 5. Export.',

  // components/tour/TourLaunchButton.tsx
  'Tutoriel interactif': 'Interactive tutorial',
  "Demarrer le tutoriel : creation d'un projet demo guidee de bout en bout":
    'Start the tutorial: guided end-to-end demo project creation',
  'Relancer le tutoriel interactif': 'Restart the interactive tutorial',

  // components/sidebar/TrackPanel.tsx
  'inconnue': 'unknown',
  'Connexion backend perdue : polling arrete.': 'Backend connection lost: polling stopped.',
  'Selectionnez au moins une annotation cible': 'Select at least one target annotation',
  'Le prompt texte est obligatoire': 'The text prompt is required',
  'Lancement detection + association...': 'Starting detection + association...',
  'Detection + association': 'Detection + association',
  'En cours': 'In progress',
  'cibles': 'targets',
  'Erreur lancement tracking': 'Error starting tracking',
  'Aucune annotation sur cette frame': 'No annotation on this frame',
  'Frame de fin introuvable': 'End frame not found',
  'La frame de fin': 'The end frame',
  'doit être après la frame courante': 'must be after the current frame',
  'Lancement propagation homographique...': 'Starting homography propagation...',
  'Propagation homographie': 'Homography propagation',
  'Lancement flux optique...': 'Starting optical flow...',
  'Flux optique LK': 'LK optical flow',
  'Erreur flux optique': 'Optical flow error',
  'La frame de fin doit être différente de la frame courante': 'The end frame must be different from the current frame',
  'Lancement': 'Starting',
  'sens inverse': 'reverse direction',
  'inverse': 'reverse',
  'Erreur SAM2 tracking': 'SAM2 tracking error',
  'Supprimer tous les tracks de ce projet ? Les annotations restent mais seront détachées.':
    'Delete all tracks in this project? Annotations remain but will be detached.',
  'Supprimer le track': 'Delete track',
  'Cette action supprime AUSSI toutes les annotations liées à ce track. Irréversible.':
    'This action ALSO deletes all annotations linked to this track. Irreversible.',
  'Frame courante': 'Current frame',
  'annotation': 'annotation',
  'disponible': 'available',
  'SAMURAI local si disponible, fallback SAM2': 'Local SAMURAI if available, fallback to SAM2',
  'GD/SAM3 + matching centroide': 'GD/SAM3 + centroid matching',
  'Propagation par homographie XFeat/SIFT': 'Homography propagation via XFeat/SIFT',
  "Lance GD ou SAM3 sur les frames suivantes, puis associe chaque detection a la cible la plus proche.":
    'Runs GD or SAM3 on the following frames, then matches each detection to the nearest target.',
  "Mode utile quand l'objet reste proche de sa position attendue.": 'Useful when the object stays close to its expected position.',
  'Cibles a suivre': 'Targets to track',
  'Tout désel.': 'Deselect all',
  "Annotez d'abord la frame": 'First annotate frame',
  'Plage de frames': 'Frame range',
  'De': 'From',
  'A': 'To',
  'Algorithme': 'Algorithm',
  'Mode de sortie': 'Output mode',
  'Segmentation': 'Segmentation',
  'Prompt de detection': 'Detection prompt',
  'ex: "voiture. personne. velo."': 'e.g.: "car. person. bike."',
  'Separez les classes par des points.': 'Separate classes with periods.',
  'Parametres avances': 'Advanced settings',
  'Seuil boite': 'Box threshold',
  'Confiance minimale des détections. ↑ = moins de boîtes, plus fiables.':
    'Minimum detection confidence. Higher = fewer boxes, more reliable.',
  'Seuil texte': 'Text threshold',
  'Correspondance prompt ↔ boîte (Grounding DINO). ↑ = plus strict sur le mot.':
    'Prompt <-> box match (Grounding DINO). Higher = stricter on the word.',
  'Dist. centroide': 'Centroid dist.',
  "Écart max cible ↔ détection pour les apparier, en fraction de l'image (0 = même point, 1 ≈ un bord à l'autre). 0.15 = 15 % de l'image.":
    'Max target <-> detection gap to match them, as a fraction of the image (0 = same point, 1 = roughly edge to edge). 0.15 = 15% of the image.',
  'Var. taille max': 'Max size var.',
  'Variation de SURFACE tolérée entre 2 frames avant de signaler une anomalie. 0.5 = ±50 %, 1.0 = ×2.':
    'AREA variation tolerated between 2 frames before flagging an anomaly. 0.5 = +/-50%, 1.0 = x2.',
  'Auto-stop si objets perdus': 'Auto-stop if objects lost',
  '% perdu max': 'Max % lost',
  'Frames consec.': 'Consec. frames',
  'Propagation en cours...': 'Propagation in progress...',
  'Detecter + associer': 'Detect + match',
  'cible': 'target',
  'Propage les annotations de la frame': 'Propagates annotations from frame',
  'vers les suivantes par matching de keypoints (XFeat GPU ou SIFT+RANSAC).':
    'to the following ones via keypoint matching (XFeat GPU or SIFT+RANSAC).',
  'Annotations source': 'Source annotations',
  'Frame source': 'Source frame',
  'Annotations à propager': 'Annotations to propagate',
  "Jusqu'a la frame": 'Up to frame',
  'Inliers min.': 'Min inliers',
  'pts — augmenter si dérive': 'pts -- increase if drifting',
  '0-1 — 0.5 = 50% min.': '0-1 -- 0.5 = 50% min.',
  'Seuil reproj.': 'Reproj. threshold',
  'px — + strict = moins de bruit': 'px -- stricter = less noise',
  'Top-K pts': 'Top-K pts',
  'keypoints/image': 'keypoints/image',
  'Min cossim': 'Min cossim',
  '0.82 = strict': '0.82 = strict',
  'Propagation...': 'Propagating...',
  'Propager par homographie': 'Propagate via homography',
  'Suivi par': 'Tracking via',
  'flux optique Lucas-Kanade': 'Lucas-Kanade optical flow',
  "suit le mouvement réel de chaque objet (pas seulement la caméra).":
    "follows each object's actual motion (not just the camera).",
  'Idéal pour objets en mouvement (véhicules, personnes).': 'Ideal for moving objects (vehicles, people).',
  'Cibles à suivre': 'Targets to track',
  "Jusqu'à la frame": 'Up to frame',
  'Fenêtre (px)': 'Window (px)',
  '21 — plus grand = + robuste': '21 -- larger = more robust',
  'Niveaux pyra.': 'Pyramid levels',
  '3 — + niveaux = gds dépl.': '3 -- more levels = larger displacements',
  'Pts min.': 'Min pts',
  '4 — si < → bbox copiée': '4 -- if fewer, bbox is copied',
  'Suit 29 points par bbox (4 coins + grille 5×5) et estime une transformation affine partielle : translation, rotation et échelle, robuste aux outliers.':
    'Tracks 29 points per bbox (4 corners + a 5x5 grid) and fits a partial affine transform: translation, rotation and scale, robust to outliers.',
  'Ne compense': 'Does',
  'pas': 'not',
  'la perspective — utiliser Homographie pour ça.': 'compensate for perspective -- use Homography for that.',
  'Suivi en cours...': 'Tracking in progress...',
  'Suivre par flux optique': 'Track via optical flow',
  'propage les masques de segmentation frame par frame via mémoire temporelle adaptative.':
    'propagates segmentation masks frame by frame via adaptive temporal memory.',
  'Robuste aux occlusions partielles et changements de pose.': 'Robust to partial occlusions and pose changes.',
  'SAMURAI actif (Kalman)': 'SAMURAI active (Kalman)',
  'SAMURAI installé, SAM2 en cours': 'SAMURAI installed, SAM2 running',
  'SAM2 standard (SAMURAI absent)': 'Standard SAM2 (SAMURAI absent)',
  'Installer SAMURAI : exécuter': 'To install SAMURAI: run',
  "Double-clic sur une boîte du canvas = cocher/décocher cette cible (anneau pointillé autour de l'objet).":
    'Double-click a box on the canvas to check/uncheck this target (dashed ring around the object).',
  'La frame de fin est avant la frame courante : la propagation remonte le temps':
    'The end frame is before the current frame: propagation runs backward in time',
  'GPU non détecté (exécution CPU) — pas de limite VRAM, mais tracking très lent.':
    'No GPU detected (running on CPU) -- no VRAM limit, but tracking is very slow.',
  'Offload CPU actif': 'CPU offload active',
  'Frames en RAM → aucune limite VRAM, mais ~1.5–3× plus lent. Coche « Mode GPU rapide » dans les paramètres pour repasser sur le GPU.':
    'Frames kept in RAM -> no VRAM limit, but ~1.5-3x slower. Check "Fast GPU mode" in settings to move back to the GPU.',
  'Frames max estimées (GPU rapide)': 'Estimated max frames (fast GPU)',
  "Plage > capacité VRAM → risque d'OOM. Réduis la plage, décime à l'import, ou décoche « Mode GPU rapide » dans les paramètres.":
    'Range exceeds VRAM capacity -> risk of OOM. Reduce the range, decimate on import, or uncheck "Fast GPU mode" in settings.',
  'Stratégie multi-cible': 'Multi-target strategy',
  'Auto (rapide)': 'Auto (fast)',
  'Nécessite SAMURAI chargé': 'Requires SAMURAI loaded',
  'SAMURAI / objet': 'SAMURAI / object',
  "(filtre de Kalman) ne suit qu'": '(Kalman filter) only tracks',
  'une': 'one',
  'cible :': 'target:',
  'son état de mouvement est unique. Pour': 'its motion state is unique. For',
  'plusieurs': 'several',
  'cibles :': 'targets:',
  'SAM2 multi-objets': 'multi-object SAM2',
  'natif — 1 seule passe, rapide, mais sans Kalman.': 'native -- a single pass, fast, but without Kalman.',
  '1 passe SAMURAI (Kalman) par cible — meilleur suivi MOT (occlusions, objets similaires), mais ~N× plus lent.':
    'one SAMURAI (Kalman) pass per target -- better MOT tracking (occlusions, similar objects), but ~Nx slower.',
  'Prompt = box de référence. Nécessite': 'Prompt = reference box. Requires',
  'présent': 'present',
  'Officiel': 'Official',
  'en cours...': 'in progress...',
  'Propager par': 'Propagate via',
  'Detect.': 'Detect.',
  'Homogr.': 'Homog.',
  'Flux opt.': 'Opt. flow',
  'Arrêt en cours...': 'Stopping...',
  'Arrêter': 'Stop',
  'Effacer': 'Clear',
  'Supprimer tous les tracks (annotations conservées)': 'Delete all tracks (annotations kept)',
  'Tout suppr.': 'Clear all',
  "Aucun log. Lancez SAMURAI, Detect, Homogr. ou Flux opt. — la commande et l'avancement de l'algo s'afficheront ici en temps réel.":
    "No log. Run SAMURAI, Detect, Homogr. or Opt. flow -- the command and the algo's progress will appear here in real time.",
  'Aucune track. Assignez une track à une annotation (onglet Annots) ou lancez un suivi.':
    'No track. Assign a track to an annotation (Annots tab) or start a tracking run.',
  'clic = début (frame': 'click = start (frame',
  '), double-clic = fin (frame': '), double-click = end (frame',
  'Supprimer cette track': 'Delete this track',

  // -- Timeline.tsx / TrackLane.tsx --
  'le track': 'the track',
  'pistes': 'tracks',
  'Cette action supprime AUSSI toutes les annotations liées. Irréversible.':
    'This action ALSO deletes all linked annotations. Irreversible.',
  'Glisser (haut/bas) pour agrandir / réduire la zone des tracks': 'Drag (up/down) to expand / shrink the tracks area',
  'bloc': 'block',
  'Suppr efface CE bloc': 'Del deletes THIS block',
  'piste': 'track',
  'sélectionnée': 'selected',
  'Ctrl/Shift + clic': 'Ctrl/Shift + click',
  'Suppr efface': 'Del deletes',
  'clic = piste · Ctrl/Shift+clic = plusieurs · clic sur un bloc = ce bloc':
    'click = track · Ctrl/Shift+click = multiple · click a block = this block',
  'Supprimer uniquement ce bloc (annotations de la piste sur cette plage)':
    'Delete only this block (track annotations on this range)',
  'Supprimer ce bloc': 'Delete this block',
  'Supprimer la (les) piste(s) sélectionnée(s) et leurs annotations': 'Delete the selected track(s) and their annotations',
  'la piste': 'the track',
  'Ctrl/clic selection, Shift/clic plage, Suppr efface les annotations selectionnees.':
    'Ctrl/click select, Shift/click range, Del deletes the selected annotations.',
  'Sélectionner toutes les frames de la séquence (Ctrl+A quand la timeline est survolée)':
    'Select all frames in the sequence (Ctrl+A while hovering the timeline)',
  'Tout sélectionner': 'Select all',
  'suppression…': 'deleting…',
  'Suppr pour vider': 'Del to clear',
  'annuler': 'cancel',
  'Clic = sélectionner la piste · Ctrl/Shift+clic = plusieurs (Suppr efface)':
    'Click = select the track · Ctrl/Shift+click = multiple (Del deletes)',
  'exploré': 'explored',
  'bloc(s) détecté(s).': 'block(s) detected.',
  'Bloc': 'Block',
  'clic pour sélectionner (Suppr efface CE bloc uniquement)': 'click to select (Del deletes ONLY this block)',
  'frames explorées': 'frames explored',

  // -- ProjectsPage.tsx --
  'copié': 'copied',
  'Hôte du partage enregistré': 'Share host saved',
  'Lecture réseau native désactivée': 'Native network reading disabled',
  "Échec de l'enregistrement de l'hôte du partage": 'Failed to save the share host',
  'Démo tutoriel': 'Tutorial demo',
  'Réduire': 'Collapse',
  'autre': 'other',
  'Chemin inconnu': 'Unknown path',
  'Ouvrir sur le serveur (app locale uniquement)': 'Open on the server (local app only)',
  'Copier le chemin serveur': 'Copy the server path',
  'Chemin Windows': 'Windows path',
  'Copier le chemin Windows (montage)': 'Copy the Windows path (mount)',
  'Montage Windows - hôte du partage': 'Windows mount - share host',
  'Exemple': 'Example',
  'devient': 'becomes',
  "Enregistrer l'hôte du partage": 'Save the share host',

  // -- AnnotationCanvas.tsx --
  "Créez d'abord une classe (onglet Classes, bouton +) pour pouvoir annoter.":
    'First create a class (Classes tab, + button) before you can annotate.',
  'Sélectionnez une classe (onglet Classes) avant de dessiner.': 'Select a class (Classes tab) before drawing.',
  'Erreur SAM point — vérifiez que SAM2 est chargé': 'SAM point error - check that SAM2 is loaded',
  'Masque SAM accepté': 'SAM mask accepted',
  'Prédiction SAM en cours...': 'SAM prediction in progress...',
  'prédit': 'predicted',
  'pour accepter le meilleur': 'to accept the best one',
  'pour annuler': 'to cancel',

  // -- presentation/shared.tsx --
  'Random Image': 'Random Image',
  'défaut': 'default',

  // -- PresentationPage.tsx (docs markdown) --
  'Installation et reglages': 'Setup and settings',
  'Developpeur': 'Developer',
  'Liste des pages indisponible': 'Page list unavailable',
  'Aucune page de documentation.': 'No documentation pages.',
  'Chargement de la documentation...': 'Loading documentation...',
  'Documentation non disponible': 'Documentation not available',
  "Cette page n'est pas encore ecrite dans le dossier docs/ de l'application.":
    "This page has not been written yet in the app's docs/ folder.",
  "Le backend ne repond pas. Verifiez qu'il est demarre puis rechargez la page.":
    'The backend is not responding. Check that it is running, then reload the page.',
  "Cette page n'est pas encore traduite : version dans l'autre langue.":
    'This page is not translated yet: showing the other language.',

  // -- useAutoSave.ts / services/api.ts --
  'Erreur réseau': 'Network error',
  'Backup téléchargé': 'Backup downloaded',
  'Erreur lors du backup': 'Error during backup',
  'Le backend ne répond pas (calcul en cours ?) — requête abandonnée':
    'The backend is not responding (calculation in progress?) - request aborted',

  // -- stores/importStore.ts --
  'Démarrage…': 'Starting…',
  'Upload images batch': 'Upload images batch',
  'échoué': 'failed',
}

const PHRASE_EN: ReadonlyArray<readonly [string, string]> = [
  ['Workspace : ', 'Workspace: '],
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
