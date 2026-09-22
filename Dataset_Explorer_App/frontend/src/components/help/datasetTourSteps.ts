// ============================================================
// components/help/datasetTourSteps.ts
// Script du tutoriel interactif de Dataset Explorer (moteur generique dans
// components/tour/, copie telle quelle depuis Annotation App). C'est la
// seule partie propre a cette app -- voir components/tour/index.ts.
//
// Le tour cree un dataset demo a partir des 10 images livrees avec la suite
// (data_tuto/ a la racine du depot, partage par tous les tutoriels), puis
// deroule le parcours : scan, epinglage, embeddings CLIP, carte, recherche,
// doublons, subsets, catalogue. Le dataset reste supprimable.
// ============================================================

import { samplesAPI } from '../../api/client'
import { clickWhenReady, sleep, typeWhenReady, waitFor } from '../tour/domUtils'
import type { TourRuntimeContext, TourStep } from '../tour/types'

const TUTO_SAMPLE_ID = 'cars_10_frames'
export const TUTO_DATASET_NAME = 'Tuto Cars 10'
const TUTO_CLUSTERS = '3'

// La carte demo se reconnait par son nom : l'attribut data-tour-name est pose
// sur chaque carte de dataset de la Gallery.
const CARD = `[data-tour-name="${TUTO_DATASET_NAME}"]`

export interface DatasetTourContext extends TourRuntimeContext {
  navigate: (path: string) => void
  // Chemin du dossier d'exemple, resolu par le backend.
  samplePath: string | null
  datasetName: string | null
}

// Dit la verite quand les images d'exemple ne sont pas la (installation
// partielle, dossier data_tuto absent du deploiement).
const MISSING_SAMPLE_NOTE =
  "Les 10 images d'exemple sont introuvables sur cette installation (dossier data_tuto"
  + " a la racine de Computer_Vision_App) : saisissez vous-meme le chemin d'un dossier"
  + " d'images, ou glissez-le dans le champ."

export const buildDatasetTourSteps = (): TourStep[] => {
  const steps: TourStep[] = [
  {
    id: 'welcome',
    chapter: 'Bienvenue',
    title: 'Dataset Explorer en quelques minutes',
    body: [
      "Cette application repond a une question simple : qu'y a-t-il vraiment dans mon dataset ? Elle encode chaque image avec CLIP, puis permet de la cartographier, d'y chercher en langage naturel, d'y traquer les doublons et d'en extraire des sous-ensembles.",
      "Le tour cree un dataset demo a partir des 10 images de circulation livrees avec la suite : rien a telecharger, rien a preparer.",
      "Ce dataset s'appellera \"Tuto Cars 10\" et reste supprimable a tout moment.",
    ],
    hint: "Echap ferme le tutoriel a tout moment. La page reste utilisable pendant le tour.",
    placement: 'center',
    beforeShow: async (ctx) => {
      const c = ctx as DatasetTourContext
      // Chemin TEL QUE VU PAR LE BACKEND : c'est lui qui scanne le dossier.
      try {
        const sample = await samplesAPI.get(TUTO_SAMPLE_ID)
        c.samplePath = sample.exists ? sample.path : null
      } catch {
        c.samplePath = null
      }
      if (!c.samplePath) {
        const step = steps.find((s) => s.id === 'dataset-path')
        if (step && Array.isArray(step.body) && !step.body.includes(MISSING_SAMPLE_NOTE)) {
          step.body = [...step.body.slice(0, -1), MISSING_SAMPLE_NOTE]
        }
      }
      c.navigate('/')
    },
  },

  // ============================================================
  // 1. Se reperer
  // ============================================================
  {
    id: 'sidebar',
    chapter: '1. Se reperer',
    title: 'Les six espaces de l\'application',
    body: [
      "Dataset Gallery : ajouter, organiser et epingler les datasets. Catalogue : interroger TOUS les datasets d'un coup, sans les fusionner. Playground : l'espace de calcul, ou l'on lance les embeddings et ou l'on ouvre carte, recherche et doublons.",
      "Subsets : les sous-ensembles extraits, exportables vers Annotation App. Documentation et Parametres completent le tout.",
      "Le parcours normal va de haut en bas : Gallery, puis Playground, puis Subsets.",
    ],
    target: { selector: '[data-tour="sidebar"]' },
    placement: 'right',
  },
  {
    id: 'gallery-stats',
    chapter: '1. Se reperer',
    title: 'Trois compteurs, trois notions',
    body: [
      "Dans ce workspace : les datasets qui vous appartiennent. Globaux disponibles : ceux partages par vos collegues, importables en un clic. Epingles dans Playground : ceux sur lesquels vous travaillez en ce moment.",
      "Un dataset global n'est pas copie : il est reference. L'importer dans votre workspace le rend analysable sans dupliquer les images.",
    ],
    target: { selector: '[data-tour="gallery-stats"]' },
    placement: 'bottom',
  },

  // ============================================================
  // 2. Ajouter le dataset demo
  // ============================================================
  {
    id: 'add-dataset',
    chapter: '2. Ajouter un dataset',
    title: 'Ajouter un dataset = scanner un dossier',
    body: [
      "Rien n'est copie : vous donnez le chemin d'un dossier d'images, l'application le scanne, indexe les fichiers et fabrique des miniatures.",
      "Les champs suivants se remplissent de haut en bas ; seul le premier est obligatoire.",
    ],
    target: { selector: '[data-tour="add-dataset"]' },
    placement: 'bottom',
  },
  {
    id: 'dataset-path',
    chapter: '2. Ajouter un dataset',
    title: 'Le chemin du dossier d\'images',
    body: [
      "Chemin vu par le SERVEUR qui execute l'application : chemin Windows en local, chemin Linux si le backend tourne sur une VM. Un dossier peut aussi y etre glisse-depose.",
      "Le tutoriel a saisi le chemin des 10 images d'exemple livrees avec la suite.",
    ],
    target: { selector: '[data-tour="dataset-path"]' },
    placement: 'bottom',
    beforeShow: async (ctx) => {
      const c = ctx as DatasetTourContext
      if (!c.samplePath) return
      await typeWhenReady('[data-tour="dataset-path"]', c.samplePath)
    },
  },
  {
    id: 'dataset-name',
    chapter: '2. Ajouter un dataset',
    title: 'Le nom du dataset',
    body: [
      "Laisse vide, il reprend le nom du dossier. C'est ce nom qui apparait dans la Gallery, le Playground, le Catalogue et les exports.",
      "Le tutoriel a saisi \"Tuto Cars 10\".",
    ],
    target: { selector: '[data-tour="dataset-name"]' },
    placement: 'bottom',
    beforeShow: async () => {
      await typeWhenReady('[data-tour="dataset-name"]', TUTO_DATASET_NAME)
    },
  },
  {
    id: 'dataset-clusters',
    chapter: '2. Ajouter un dataset',
    title: 'Le nombre de clusters',
    body: [
      "Combien de groupes le clustering doit-il former sur les embeddings CLIP. Trop peu : tout se melange ; trop : le bruit devient des groupes.",
      "Sur 10 images, 3 suffisent -- le tutoriel l'a regle. Ce choix se refait a tout moment depuis le Playground, sans re-encoder les images.",
    ],
    target: { selector: '[data-tour="dataset-clusters"]' },
    placement: 'bottom',
    beforeShow: async () => {
      await typeWhenReady('[data-tour="dataset-clusters"] input', TUTO_CLUSTERS)
    },
  },
  {
    id: 'dataset-share',
    chapter: '2. Ajouter un dataset',
    title: 'Partager, et le dossier de destination',
    body: [
      "Partager : ON publie le dataset dans la galerie globale -- vos collegues le voient depuis leur propre workspace, par lien symbolique, sans copie des images.",
      "Le menu deroulant a cote range le dataset dans un dossier de la Gallery ; les dossiers se creent depuis les sections du bas.",
    ],
    target: { selector: '[data-tour="dataset-share"]' },
    placement: 'bottom',
  },
  {
    id: 'dataset-annotations',
    chapter: '2. Ajouter un dataset',
    title: 'Associer des annotations (optionnel)',
    body: [
      "Un fichier .ver, un dossier YOLO ou un .txt produit par Annotation App : les boites sont alors lues et affichees sur les images, et deviennent filtrables.",
      "C'est ce qui ferme la boucle entre les deux applications : on annote d'un cote, on verifie la qualite du dataset de l'autre.",
    ],
    target: { selector: '[data-tour="dataset-annotations"]' },
    placement: 'bottom',
  },
  {
    id: 'dataset-metadata',
    chapter: '2. Ajouter un dataset',
    title: 'Associer des metadonnees (optionnel)',
    body: [
      "Un .csv ou .xlsx dont une colonne identifie l'image (nom de fichier). \"Analyser colonnes\" lit l'en-tete et vous fait choisir cette colonne cle.",
      "Les colonnes restantes deviennent des filtres et des facettes dans le Catalogue : meteo, zone, capteur, campagne... tout ce que votre tableau contient.",
    ],
    target: { selector: '[data-tour="dataset-metadata"]' },
    placement: 'bottom',
  },
  {
    id: 'dataset-scan',
    chapter: '2. Ajouter un dataset',
    title: 'Scanner',
    body: [
      "Le scan liste les images, calcule leurs empreintes et genere les miniatures. Il tourne en tache de fond : la carte du dataset affiche sa progression.",
      "Suivant lance le scan des 10 images.",
    ],
    target: { selector: '[data-tour="dataset-scan"]' },
    placement: 'bottom',
    onNext: async () => {
      // Relance du tutoriel : le dataset demo existe deja. Re-scanner le meme
      // dossier ouvrirait la fenetre "chemin deja connu" -- on saute l'etape.
      if (document.querySelector(CARD)) return
      await clickWhenReady('[data-tour="dataset-scan"]')
      await waitFor(() => document.querySelector(CARD) !== null, 30000)
      await sleep(300)
    },
  },

  // ============================================================
  // 3. Epingler et calculer
  // ============================================================
  {
    id: 'pin',
    chapter: '3. Epingler et calculer',
    title: 'Epingler dans le Playground',
    body: [
      "La Gallery gere les datasets ; le Playground les traite. L'epingle decide de ce sur quoi vous travaillez, sans rien deplacer sur le disque.",
      "Suivant epingle le dataset demo.",
    ],
    target: { selector: `${CARD} [data-tour="dataset-pin"]` },
    placement: 'right',
    waitTimeoutMs: 20000,
    onNext: async () => {
      await clickWhenReady(`${CARD} [data-tour="dataset-pin"]`, 5000)
      await sleep(400)
    },
  },
  {
    id: 'goto-playground',
    chapter: '3. Epingler et calculer',
    title: 'Direction le Playground',
    body: "Suivant ouvre le Playground, ou le dataset epingle nous attend.",
    target: { selector: '[data-tour="nav-playground"]' },
    placement: 'right',
    onNext: async (ctx) => {
      (ctx as DatasetTourContext).navigate('/playground')
      await waitFor(() => document.querySelector('[data-tour="pg-dataset-card"]') !== null, 8000)
    },
  },
  {
    id: 'pg-card',
    chapter: '3. Epingler et calculer',
    title: 'La fiche du dataset',
    body: [
      "Tout l'etat du dataset tient sur cette ligne : statut, nombre d'images, nombre d'embeddings deja calcules, nombre de clusters, et les methodes utilisees pour le clustering et la reduction 2D.",
      "\"0 embeddings\" signifie simplement que le pipeline CLIP n'a pas encore tourne : c'est l'etape suivante.",
    ],
    target: { selector: '[data-tour="pg-dataset-card"]' },
    placement: 'bottom',
    waitTimeoutMs: 15000,
  },
  {
    id: 'pg-embed',
    chapter: '3. Epingler et calculer',
    title: 'Embeddings : le calcul qui debloque tout',
    body: [
      "Ce bouton lance le pipeline complet : CLIP encode chaque image en un vecteur de 512 dimensions, l'index de recherche est construit, la carte 2D est projetee et les clusters sont formes.",
      "Tout ce qui suit en depend : sans embeddings, ni carte, ni recherche par texte, ni detection de doublons. Le calcul tourne cote serveur avec une barre de progression, et 10 images sont l'affaire de quelques secondes.",
      "Le tutoriel ne le declenche pas a votre place : lancez-le quand vous voulez, il n'y a rien a attendre pour continuer le tour.",
    ],
    hint: "Cliquez sur Embeddings pour voir le pipeline tourner sur les 10 images.",
    target: { selector: '[data-tour="pg-embed-btn"]' },
    placement: 'bottom',
    waitTimeoutMs: 10000,
  },
  {
    id: 'pg-actions',
    chapter: '3. Epingler et calculer',
    title: 'Ce qui apparait apres le calcul',
    body: [
      "Carte : la projection 2D (UMAP, t-SNE ou PCA) ou chaque point est une image -- on y voit les groupes, les trous et les images aberrantes, et on peut y selectionner une zone entiere.",
      "Recherche : une requete en langage naturel (\"voiture rouge de nuit\") classee par similarite CLIP. Doublons : les paires trop semblables, a arbitrer une par une.",
      "Cluster et Reduc. rejouent le regroupement ou la projection avec d'autres reglages, sans re-encoder les images. Les deux icones a gauche desepinglent le dataset ou le suppriment definitivement.",
    ],
    target: { selector: '[data-tour="pg-dataset-actions"]' },
    placement: 'left',
    waitTimeoutMs: 10000,
  },

  // ============================================================
  // 4. Exploiter
  // ============================================================
  {
    id: 'clip-filter',
    chapter: '4. Exploiter',
    title: 'Filtrer la Gallery par texte',
    body: [
      "Depuis la Gallery, ce champ interroge CLIP sur plusieurs termes a la fois (\"voiture, nuit, pluie\") et ne garde que les images correspondantes -- de quoi fabriquer un dataset filtre en une requete.",
      "Suivant y retourne.",
    ],
    target: { selector: '[data-tour="nav-gallery"]' },
    placement: 'right',
    onNext: async (ctx) => {
      (ctx as DatasetTourContext).navigate('/')
      await waitFor(() => document.querySelector('[data-tour="gallery-clip-search"]') !== null, 8000)
    },
  },
  {
    id: 'clip-field',
    chapter: '4. Exploiter',
    title: 'La recherche CLIP de la Gallery',
    body: [
      "Plusieurs termes separes par des virgules : chacun devient un filtre, et le resultat peut etre enregistre comme un nouveau dataset filtre.",
      "Cette recherche ne fonctionne que sur les datasets dont les embeddings sont calcules.",
    ],
    target: { selector: '[data-tour="gallery-clip-search"]' },
    placement: 'bottom',
    waitTimeoutMs: 10000,
  },
  {
    id: 'subsets',
    chapter: '4. Exploiter',
    title: 'Subsets : extraire pour annoter',
    body: [
      "Une selection faite sur la carte, dans la recherche ou dans les doublons devient un subset : un dossier de liens symboliques (ou de copies) vers les images retenues.",
      "Un subset s'exporte vers Annotation App : on part d'un gros dataset brut, on en extrait les images qui valent la peine, on les annote. C'est le circuit complet de la suite.",
    ],
    target: { selector: '[data-tour="nav-subsets"]' },
    placement: 'right',
  },
  {
    id: 'catalog',
    chapter: '4. Exploiter',
    title: 'Catalogue : tous les datasets a la fois',
    body: [
      "Meme recherche visuelle, meme recherche par metadonnees et meme detection de doublons, mais appliquees a TOUS les datasets prets en meme temps -- sans avoir a les fusionner.",
      "C'est la vue a utiliser quand on ne sait plus dans quel dataset se trouve telle image, ou pour reperer les recouvrements entre campagnes.",
    ],
    target: { selector: '[data-tour="nav-catalog"]' },
    placement: 'right',
  },

  // ============================================================
  // 5. Reglages et aide
  // ============================================================
  {
    id: 'settings',
    chapter: '5. Reglages et aide',
    title: 'Les parametres',
    body: [
      "Valeurs par defaut du pipeline (nombre de clusters, taille des resultats), methode de reduction et ses hyperparametres, methode de clustering, chemin d'export vers Annotation App, liens symboliques ou copies physiques, et theme de l'interface.",
      "Ces reglages vivent dans le workspace : ils suivent le contexte de travail, pas la machine.",
    ],
    target: { selector: '[data-tour="nav-settings"]' },
    placement: 'right',
  },
  {
    id: 'help',
    chapter: '5. Reglages et aide',
    title: 'La documentation',
    body: "Le detail de chaque brique : ce que CLIP encode vraiment, comment lire une projection UMAP, ce que mesurent les scores de doublon, et le format des exports. C'est aussi la que ce tutoriel se relance.",
    target: { selector: '[data-tour="nav-help"]' },
    placement: 'right',
  },
  {
    id: 'done',
    chapter: 'Termine',
    title: 'Le circuit est boucle',
    body: [
      "Dossier scanne, dataset epingle, embeddings calcules, carte et recherche disponibles, subset exportable vers l'annotation : c'est tout le cycle de Dataset Explorer.",
      "Le dataset \"Tuto Cars 10\" vous appartient : gardez-le pour experimenter, ou supprimez-le depuis le Playground.",
      "Bonne exploration.",
    ],
    placement: 'center',
  },
  ]
  return steps
}
