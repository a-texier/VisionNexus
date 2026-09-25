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

// Pilotage desktop : ?lang= present au chargement -> VisionNexus impose la
// langue, l'app ne doit jamais ecrire dans les settings du workspace.
const desktopPiloted = readQueryLang() !== null

export function isDesktopPiloted(): boolean {
  return desktopPiloted
}

// Repli workspace hors lanceur : au boot, si aucun ?lang= n'a ete impose,
// on interroge les settings du workspace (utile navigateur/dev/CLI).
export async function initWorkspaceLanguage(fetchSettingsLang: () => Promise<Lang | null | undefined>): Promise<void> {
  if (desktopPiloted) return
  try {
    const fromWorkspace = await fetchSettingsLang()
    if (isLang(fromWorkspace ?? null)) setLang(fromWorkspace as Lang)
  } catch {
    // Pas de backend joignable au boot : repli localStorage/anglais.
  }
}

// Change la langue et, hors pilotage desktop, persiste le choix dans le
// workspace (repli pour retrouver la langue au prochain lancement standalone).
export function setLangAndMaybePersist(lang: Lang, persistToWorkspace: (lang: Lang) => void): void {
  setLang(lang)
  if (!desktopPiloted) persistToWorkspace(lang)
}

// Dictionnaire de correspondance exacte FR -> EN, complete au fil de la
// couverture de l'app. Une chaine absente du dictionnaire reste affichee
// en francais meme en mode EN (degradation silencieuse, jamais de texte
// casse ou de cle brute visible).
const EXACT_EN: Record<string, string> = {
  // -- App.tsx (sidebar / header) --
  'Catalogue': 'Catalog',
  'Paramètres': 'Settings',
  'Tutoriel': 'Tutorial',
  'image(s) sélectionnée(s)': 'image(s) selected',
  'Créer subset': 'Create subset',

  // -- components/UserBadge.tsx --
  'Le backend n’a retourné aucun chemin Workspace.': 'The backend did not return a Workspace path.',
  'Ouvrir workspace': 'Open workspace',
  'Historique des workspaces': 'Workspace history',
  'Utilisateurs connectes': 'Connected users',
  'Workspaces recents': 'Recent workspaces',
  'Chargement…': 'Loading…',
  'Aucun utilisateur trouve.': 'No users found.',
  '(vous)': '(you)',
  'Ouvrir ce workspace': 'Open this workspace',
  'Aucun workspace utilise recemment.': 'No recently used workspace.',

  // -- components/ConfirmDialog.tsx --
  'Confirmer': 'Confirm',
  'Annuler': 'Cancel',
  'Fermer': 'Close',
  'En cours…': 'In progress…',

  // -- pages/Gallery.tsx --
  "Chemin du dossier d'images (ex: C:\\data\\images)": 'Image folder path (e.g.: C:\\data\\images)',
  'Nom (optionnel)': 'Name (optional)',
  'Clusters :': 'Clusters:',
  'Dossier de destination': 'Destination folder',
  'Racine (aucun dossier)': 'Root (no folder)',
  'Partager ce dataset dans la galerie globale (dossier dans data/dataset_gallery/)':
    'Share this dataset in the global gallery (folder in data/dataset_gallery/)',
  'Partager : ON': 'Share: ON',
  'Partager': 'Share',
  'Scan...': 'Scan...',
  'Scanner': 'Scan',
  'Annotations (optionnel) : .ver, dossier YOLO, ou .txt': 'Annotations (optional): .ver, YOLO folder, or .txt',
  'Nom des annotations (optionnel)': 'Annotation name (optional)',
  'Métadonnées (optionnel) : fichier .csv / .xlsx à associer': 'Metadata (optional): .csv / .xlsx file to associate',
  'Lire les colonnes du fichier': 'Read the file columns',
  'Analyser colonnes': 'Analyze columns',
  'Colonne clé :': 'Key column:',
  'Colonne dont la valeur correspond au nom de fichier image': 'Column whose value matches the image file name',
  'colonnes détectées — la': 'columns detected — the',
  'colonne clé': 'key column',
  'est rapprochée du nom de fichier de chaque image ; les autres colonnes deviennent des métadonnées consultables depuis le':
    'is matched against each image file name; the other columns become metadata browsable from the',
  'Colonnes équivalentes à des colonnes déjà présentes dans le catalogue :':
    'Columns equivalent to columns already present in the catalog:',
  "Information seulement : aucune colonne n'est renommée. Le rapprochement sert à":
    'Information only: no column is renamed. The matching is used to',
  "retrouver ces images dans le Catalogue même si l'en-tête diffère.":
    'find these images in the Catalog even if the header differs.',
  'Un dossier sera créé dans': 'A folder will be created in',
  'nom': 'name',
  '5 miniatures seront copiées pour la prévisualisation dans tous les workspaces.':
    '5 thumbnails will be copied for preview in all workspaces.',
  'Requête CLIP — plusieurs termes séparés par des virgules (ex : drone, forest, night, car)…':
    'CLIP query — multiple terms separated by commas (e.g.: drone, forest, night, car)…',
  "Union : image proche d'AU MOINS un terme": 'Union: image close to AT LEAST one term',
  'Intersection : image proche de TOUS les termes': 'Intersection: image close to ALL terms',
  'Filtrer': 'Filter',
  'Effacer': 'Clear',
  'Avec annotations': 'With annotations',
  'Seuil de matching': 'Matching threshold',
  'Une image compte si son score CLIP dépasse ce seuil.': 'An image counts if its CLIP score exceeds this threshold.',
  'Chargement...': 'Loading...',
  'Dataset partagé créé dans la galerie globale': 'Shared dataset created in the global gallery',
  'Dataset créé — scan en cours...': 'Dataset created — scan in progress...',
  'Erreur': 'Error',
  'Chemin requis': 'Path required',
  'Chemin du fichier requis': 'File path required',
  'colonne(s) rapprochée(s) du catalogue': 'column(s) matched from the catalog',
  'colonnes': 'columns',
  'lignes': 'rows',
  'Erreur lecture': 'Read error',
  'Nom du dossier partagé :': 'Shared folder name:',
  'Nom du dossier :': 'Folder name:',
  'Erreur dossier': 'Folder error',
  'Supprimer le dossier': 'Delete folder',
  'Les sous-dossiers et datasets sont remontés au parent.': 'Subfolders and datasets are moved up to the parent.',
  'Importez ce dataset avant de le ranger': 'Import this dataset before filing it',
  'Erreur déplacement': 'Move error',
  "Ce dataset n'est pas encore dans votre workspace": 'This dataset is not in your workspace yet',
  'Retirer': 'Remove',
  'de ce workspace ?': 'from this workspace?',
  '(Le dataset restera visible dans la galerie globale.)': '(The dataset will remain visible in the global gallery.)',
  'Supprimer définitivement': 'Permanently delete',
  'Dataset supprimé': 'Dataset deleted',
  'de la galerie globale ?': 'from the global gallery?',
  'Cette action est irréversible.': 'This action is irreversible.',
  'supprimé de la galerie globale': 'deleted from the global gallery',
  'retiré du Playground': 'removed from the Playground',
  'ajouté au Playground': 'added to the Playground',
  'Erreur mise à jour playground': 'Playground update error',
  'importé dans ce workspace — il apparaît maintenant dans "Mon workspace"':
    'imported into this workspace — it now appears in "My workspace"',
  'Erreur import': 'Import error',
  'Aucun dataset ne correspond au-dessus du seuil': 'No dataset matches above the threshold',
  'Erreur filtrage': 'Filtering error',
  'Dataset filtré': 'Filtered dataset',
  'créé dans le workspace': 'created in the workspace',
  'Erreur merge': 'Merge error',
  'Chemin déjà connu': 'Path already known',
  'Ce dossier est déjà enregistré sous': 'This folder is already registered under',
  'ces noms': 'these names',
  'ce nom': 'this name',
  'Continuer créera un dataset séparé (nouveau scan + ré-embedding CLIP complet des mêmes images).':
    'Continuing will create a separate dataset (new scan + full CLIP re-embedding of the same images).',
  'Création…': 'Creating…',
  'Continuer quand même': 'Continue anyway',
  'Parcourez et gérez vos datasets. Épinglez-les dans le': 'Browse and manage your datasets. Pin them in the',
  'pour les analyser.': 'to analyze them.',
  'Dans ce workspace': 'In this workspace',
  'Globaux disponibles': 'Global available',
  'Épinglés dans Playground': 'Pinned in Playground',
  'Ajouter un dataset': 'Add a dataset',
  'Galerie globale': 'Global gallery',
  'Datasets partagés (data/dataset_gallery) — indépendants du workspace, toujours visibles':
    'Shared datasets (data/dataset_gallery) — independent of the workspace, always visible',
  "Aucun dataset global. Créez-en un avec 'Partager : ON' pour qu'il soit visible dans tous les workspaces.":
    "No global dataset. Create one with 'Share: ON' so it is visible in every workspace.",
  'Mon workspace': 'My workspace',
  'Tous vos datasets locaux — épinglez-les dans le Playground pour les analyser':
    'All your local datasets — pin them in the Playground to analyze them',
  'Aucun dataset dans votre workspace. Ajoutez-en un ci-dessus ou importez un dataset global.':
    'No dataset in your workspace. Add one above or import a global dataset.',
  'dataset(s) pertinent(s)': 'relevant dataset(s)',
  'termes': 'terms',
  'Trier par': 'Sort by',
  "Nombre d'images matchées": 'Number of matched images',
  'Absolu': 'Absolute',
  "Pourcentage d'images matchées": 'Percentage of matched images',
  'Relatif': 'Relative',
  'Total retenu': 'Total retained',
  'images (score > seuil)': 'images (score > threshold)',
  'Nom du dataset filtré…': 'Filtered dataset name…',
  'Fusion...': 'Merging...',
  'Merge filtré → Playground': 'Merge filtered → Playground',
  'Phase': 'Phase',
  'Aucun dataset ne dépasse le seuil. Baissez le seuil ou changez de mode (OR/AND).':
    'No dataset exceeds the threshold. Lower the threshold or change mode (OR/AND).',
  'Aperçu indisponible': 'Preview unavailable',
  'Nouveau dossier partagé (visible dans tous les workspaces)': 'New shared folder (visible in every workspace)',
  'Nouveau dossier': 'New folder',
  'Nouveau sous-dossier': 'New subfolder',
  'Dossier vide': 'Empty folder',
  'Dans votre workspace': 'In your workspace',
  'Importer dans ce workspace': 'Import into this workspace',
  'Retirer du Playground': 'Remove from Playground',
  'Épingler dans le Playground': 'Pin in the Playground',
  'Même dossier': 'Same folder',
  'que': 'as',
  'doublon de': 'duplicate of',
  'par': 'by',
  'Scan en cours': 'Scan in progress',
  'images': 'images',
  'Scan en cours...': 'Scan in progress...',
  'rejetées': 'rejected',
  'métadonnées': 'metadata',
  'Miniatures': 'Thumbnails',
  'Ranger dans un dossier': 'File into a folder',
  'Racine': 'Root',
  'Voir les détails': 'View details',
  'Supprimer définitivement de la galerie globale': 'Permanently delete from the global gallery',
  'Appartient à': 'Belongs to',
  'vous ne pouvez pas supprimer ce dataset global': 'you cannot delete this global dataset',
  'Vous ne pouvez pas supprimer ce dataset global': 'You cannot delete this global dataset',
  'Retirer de ce workspace (reste dans la galerie globale)': 'Remove from this workspace (stays in the global gallery)',
  'Supprimer le dataset': 'Delete dataset',
  'Chemin': 'Path',
  'Ajouté': 'Added',
  'Images': 'Images',
  'Carte': 'Map',
  'calculée': 'computed',
  'Exclusions': 'Exclusions',
  'actives': 'active',
  'Aperçu': 'Preview',
  'miniatures fixes': 'fixed thumbnails',
  'Aucune miniature disponible': 'No thumbnail available',
  'Régénérer les miniatures gallery': 'Regenerate gallery thumbnails',
  'Génération...': 'Generating...',
  'Rafraîchir': 'Refresh',
  'Générer les miniatures gallery': 'Generate gallery thumbnails',
  'Statistiques de base': 'Basic statistics',
  'Dim. moyenne': 'Avg. dim.',
  'Stats complètes disponibles après import dans ce workspace.': 'Full stats available after import into this workspace.',
  'Chargement des statistiques...': 'Loading statistics...',
  'Poids moyen': 'Avg. size',
  'Poids total': 'Total size',
  'Mode': 'Mode',
  'images aléatoires': 'random images',
  'Épingler dans le Dashboard Playground': 'Pin in the Dashboard Playground',
  'Épinglé dans le Playground': 'Pinned in the Playground',
  'Importation en cours...': 'Importing...',
  'aperçu': 'preview',

  // -- pages/Catalog.tsx --
  'Recherche visuelle': 'Visual search',
  'Métadonnées': 'Metadata',
  'Doublons cross-dataset': 'Cross-dataset duplicates',
  'Restreindre à :': 'Restrict to:',
  'tous': 'all',
  'pas de miniature': 'no thumbnail',
  'Nom de subset requis': 'Subset name required',
  'subsets créés (un par dataset)': 'subsets created (one per dataset)',
  'créé': 'created',
  'Création échouée': 'Creation failed',
  'nom du subset': 'subset name',
  'Vider la sélection': 'Clear selection',
  'Saisir une requête': 'Enter a query',
  'Aucun résultat': 'No result',
  'Recherche échouée': 'Search failed',
  'ex : drone au-dessus de la forêt, véhicule rouge, ciel nuageux…':
    'e.g.: drone above the forest, red vehicle, cloudy sky…',
  'Seuil': 'Threshold',
  'résultat(s)': 'result(s)',
  'index global :': 'global index:',
  'vecteurs sur': 'vectors across',
  'dataset(s)': 'dataset(s)',
  'Saisir un mot-clé': 'Enter a keyword',
  "Aucun dataset n'a de métadonnées CSV/Excel associées — associez un fichier à l'import pour rendre ces colonnes cherchables ici.":
    'No dataset has associated CSV/Excel metadata — attach a file on import to make these columns searchable here.',
  'mot-clé, valeur ou nom de colonne (ex : zone_forestiere brouillard)':
    'keyword, value or column name (e.g.: zone_forestiere brouillard)',
  'AND : tous les mots. OR : au moins un.': 'AND: all words. OR: at least one.',
  'tous les mots': 'all words',
  'au moins un': 'at least one',
  'Chercher': 'Search',
  'Explorer une colonne :': 'Explore a column:',
  'présente dans :': 'present in:',
  'Colonnes rapprochées automatiquement :': 'Automatically matched columns:',
  'aucune valeur': 'no value',
  'page': 'page',
  'précédent': 'previous',
  'suivant': 'next',
  'Aucun doublon présent dans plusieurs datasets à ce seuil':
    'No duplicate present across multiple datasets at this threshold',
  'Aucun doublon à ce seuil': 'No duplicate at this threshold',
  'Analyse échouée': 'Analysis failed',
  'Aucune décision à enregistrer': 'No decision to save',
  'décision(s) enregistrée(s)': 'decision(s) saved',
  'Enregistrement échoué': 'Save failed',
  'Seuil de similarité': 'Similarity threshold',
  'uniquement les groupes couvrant plusieurs datasets': 'only groups spanning multiple datasets',
  'Analyser': 'Analyze',
  'calcul en cours…': 'computing…',
  "Rien n'est supprimé sur le disque : « rejeter » pose seulement un marqueur, exploité ensuite par les cartes et les subsets.":
    "Nothing is deleted from disk: 'reject' only sets a marker, used afterwards by cards and subsets.",
  'groupe(s) affiché(s)': 'group(s) displayed',
  'sur': 'out of',
  'détecté(s)': 'detected',
  'vecteurs indexés': 'indexed vectors',
  'Enregistrer': 'Save',
  'décision(s)': 'decision(s)',
  'Groupe': 'Group',
  'affichage tronqué': 'truncated display',
  'garder': 'keep',
  'rejeter': 'reject',
  'Interroger tous les datasets comme un seul ensemble — sans fusion préalable.':
    'Query all datasets as a single set — without merging beforehand.',
  'dataset(s) prêt(s).': 'dataset(s) ready.',
  "Aucun dataset prêt : lancez les embeddings depuis le Playground pour alimenter l'index global.":
    'No dataset ready: launch the embeddings from the Playground to feed the global index.',

  // -- pages/Dashboard.tsx --
  'Embedding déjà en cours': 'Embedding already in progress',
  'Embedding lancé pour': 'Embedding started for',
  'Erreur :': 'Error:',
  'Clustering déjà en cours': 'Clustering already in progress',
  'Clustering HDBSCAN relancé': 'HDBSCAN clustering restarted',
  'Clustering KMeans relancé': 'KMeans clustering restarted',
  'Erreur recluster :': 'Recluster error:',
  'Carte recalculée pour': 'Map recomputed for',
  'Erreur remap :': 'Remap error:',
  'Rebuild terminé —': 'Rebuild complete —',
  'images exclues': 'images excluded',
  'Erreur rebuild :': 'Rebuild error:',
  'Réinitialiser le filtre doublon de': 'Reset the duplicate filter for',
  'Toutes les décisions seront effacées.': 'All decisions will be cleared.',
  'Filtre réinitialisé — toutes les images restaurées': 'Filter reset — all images restored',
  'Erreur reset :': 'Reset error:',
  'Réduction déjà en cours': 'Reduction already in progress',
  'Réduction': 'Reduction',
  'relancée': 'restarted',
  'Erreur réduction :': 'Reduction error:',
  'Sélectionnez au moins 2 datasets': 'Select at least 2 datasets',
  'Nom requis': 'Name required',
  'Dataset fusionné': 'Merged dataset',
  'créé !': 'created!',
  'Erreur merge :': 'Merge error:',
  'Erreur mise à jour Playground': 'Playground update error',
  'supprimé': 'deleted',
  'Erreur suppression :': 'Deletion error:',
  'Dashboard Playground': 'Dashboard Playground',
  "Espace de traitement et d'analyse des datasets.": 'Workspace for processing and analyzing datasets.',
  'Aucun dataset épinglé': 'No pinned dataset',
  'Allez dans la': 'Go to the',
  'pour ajouter des datasets et les épingler dans le Playground.': 'to add datasets and pin them in the Playground.',
  'Aller à la Gallery': 'Go to the Gallery',
  'dataset(s) épinglé(s)': 'dataset(s) pinned',
  'images totales': 'total images',
  'Retour à la Gallery pour gérer les datasets': 'Back to the Gallery to manage datasets',
  'Datasets': 'Datasets',
  'Fusionner datasets': 'Merge datasets',
  'Sélectionnez les datasets à fusionner': 'Select the datasets to merge',
  'Nom': 'Name',
  'Nom...': 'Name...',
  'Clusters': 'Clusters',
  'Fusionner': 'Merge',
  'sources': 'sources',
  'Fusion de :': 'Merge of:',
  'Méthode de réduction modifiée — carte à recalculer': 'Reduction method changed — map needs recomputing',
  'Jetés': 'Discarded',
  'Utilisé': 'Used',
  'Retirer du Playground (ne supprime pas le dataset)': 'Remove from the Playground (does not delete the dataset)',
  'Supprimer définitivement le dataset et toutes ses données': 'Permanently delete the dataset and all its data',
  'Carte construite avec une méthode différente — utilisez "Recalculer carte"':
    'Map built with a different method — use "Recompute map"',
  'Ouvrir la carte': 'Open the map',
  'Recherche': 'Search',
  'Doublons': 'Duplicates',
  'Carte obsolète — recalculer UMAP sans les images rejetées': 'Map outdated — recompute UMAP without rejected images',
  'Recalculer UMAP sans les images rejetées': 'Recompute UMAP without rejected images',
  'Relancer la réduction 2D (UMAP / t-SNE / PCA)': 'Restart the 2D reduction (UMAP / t-SNE / PCA)',
  'Réduc.': 'Reduc.',
  'Méthode de réduction modifiée — recalcule uniquement la carte 2D, sans re-embedder CLIP':
    'Reduction method changed — recomputes only the 2D map, without re-embedding CLIP',
  'Recalculer carte': 'Recompute map',
  'Calcul en cours sur le serveur — progression ci-dessous': 'Computation in progress on the server — progress below',
  'En cours...': 'In progress...',
  'Lancer le pipeline complet : CLIP + indexation + carte + clustering':
    'Run the full pipeline: CLIP + indexing + map + clustering',
  'Relancer': 'Restart',
  'Réinitialiser aux valeurs par défaut (Paramètres)': 'Reset to default values (Settings)',
  'Défaut': 'Default',
  'actuel :': 'current:',
  'Aucun hyperparamètre (2 composantes)': 'No hyperparameter (2 components)',
  'miniatures': 'thumbnails',
  'Phase :': 'Phase:',
  'Clustering :': 'Clustering:',
  'Réduction :': 'Reduction:',
  'Thumbnails :': 'Thumbnails:',
  'Carte :': 'Map:',
  'Reset :': 'Reset:',

  // -- pages/DatasetMap.tsx --
  'Clustering mis à jour': 'Clustering updated',
  'Carte 2D mise à jour': '2D map updated',
  'Clustering relancé': 'Clustering restarted',
  'images sélectionnées': 'images selected',
  "image(s) du dataset ? Elles seront traitées comme des rejets (is_duplicate_kept=False).":
    'image(s) from the dataset? They will be treated as rejects (is_duplicate_kept=False).',
  'Exclure': 'Exclude',
  'image(s) exclues du dataset': 'image(s) excluded from the dataset',
  "Erreur lors de l'exclusion des images": 'Error excluding images',
  'Nom du subset requis': 'Subset name required',
  "Sélectionnez des images d'abord": 'Select images first',
  'Erreur lors de la création du subset': 'Error creating the subset',
  'Carte non calculée pour ce dataset.': 'Map not computed for this dataset.',
  'Lancez les embeddings depuis le Dashboard.': 'Launch the embeddings from the Dashboard.',
  'sélectionnée(s)': 'selected',
  'Utilisez le': 'Use the',
  'pour sélectionner des points, puis nommez et créez le subset ci-dessous.':
    'to select points, then name and create the subset below.',
  'rareté moy.': 'avg. rarity',
  'Tout sélectionner': 'Select all',
  'Tout désélectionner': 'Deselect all',
  'Chargement de la carte...': 'Loading the map...',
  'Nom du subset...': 'Subset name...',
  'Exclure ces images du dataset (traitées comme des rejets)': 'Exclude these images from the dataset (treated as rejects)',
  'Exclure du dataset': 'Exclude from dataset',
  'Effacer sélection': 'Clear selection',
  'Désélectionner': 'Deselect',

  // -- pages/DuplicateExplorer.tsx --
  'Auto-sélection :': 'Auto-selection:',
  'groupe(s) traité(s)': 'group(s) processed',
  'Toutes les décisions réinitialisées': 'All decisions reset',
  'Décisions sauvegardées': 'Decisions saved',
  'Erreur sauvegarde': 'Save error',
  'Aucune image rejetée à exclure': 'No rejected image to exclude',
  'UMAP + KMeans recalculés sans les doublons rejetés': 'UMAP + KMeans recomputed without the rejected duplicates',
  'Explorateur de doublons': 'Duplicate explorer',
  'groupe(s)': 'group(s)',
  'image(s) concernées': 'image(s) affected',
  'Base :': 'Base:',
  'Jetés :': 'Discarded:',
  'Utilisé :': 'Used:',
  'Principe — jamais de suppression physique': 'Principle — never a physical deletion',
  'Garder': 'Keep',
  'Inclus dans les exports et subsets futurs': 'Included in future exports and subsets',
  'Rejeter': 'Reject',
  'Exclu des exports — fichier jamais effacé': 'Excluded from exports — file never erased',
  'Les fichiers originaux ne sont': 'The original files are',
  'jamais supprimés': 'never deleted',
  'Seuil :': 'Threshold:',
  '80% ≈ approx · 97% = quasi-identiques · 100% = exactement identiques':
    '80% ~ approximate · 97% = near-identical · 100% = exactly identical',
  'Appliquer': 'Apply',
  'Auto-sélectionner tous': 'Auto-select all',
  'Reset tout': 'Reset all',
  'Sauvegarde...': 'Saving...',
  'Sauvegarder': 'Save',
  'décisions': 'decisions',
  'Recalculer UMAP + KMeans en excluant les images rejetées': 'Recompute UMAP + KMeans excluding rejected images',
  'Rebuild en cours...': 'Rebuild in progress...',
  'Rebuild UMAP sans doublons': 'Rebuild UMAP without duplicates',
  'exclus': 'excluded',
  'Analyse en cours...': 'Analysis in progress...',
  'Aucun doublon trouvé avec ce seuil.': 'No duplicate found at this threshold.',
  'Réduisez le seuil pour des similitudes moins strictes.': 'Lower the threshold for less strict similarities.',
  'sim max :': 'max sim:',
  'à garder': 'to keep',
  'à rejeter': 'to reject',
  'Sélectionner automatiquement les N meilleures images': 'Automatically select the N best images',
  'Réinitialiser les décisions de ce groupe': 'Reset this group\'s decisions',
  'Référence': 'Reference',
  'Sim :': 'Sim:',
  'Décision :': 'Decision:',

  // -- pages/HelpPage.tsx --
  'Documentation': 'Documentation',
  'Lancer le tutoriel interactif': 'Start the interactive tutorial',
  'Rareté': 'Rarity',
  'Couleur :': 'Color:',
  'Cluster :': 'Cluster:',
  'Rareté :': 'Rarity:',
  'gardée(s)': 'kept',
  'rejetée(s)': 'rejected',
  'Auto-sélection appliquée sur': 'Auto-selection applied to',
  'Filtre appliqué :': 'Filter applied:',
  'image(s) retirée(s) du subset': 'image(s) removed from the subset',
  "Erreur lors de l'application du filtre": 'Error while applying the filter',
  'Analyse locale au subset': 'Analysis local to the subset',
  'ne modifie pas les autres subsets': 'does not change the other subsets',
  'ATTENTION — Sauvegarder': 'WARNING — Save',
  'écrit les décisions doublon dans le': 'writes the duplicate decisions to the',
  'dataset principal': 'main dataset',
  'flag': 'flag',
  'Les images rejetées seront exclues de la carte UMAP et du rebuild dans le': 'Rejected images will be excluded from the UMAP map and from the rebuild in the',
  '= retire les images uniquement de ce subset, sans toucher le dataset.': '= removes the images from this subset only, without touching the dataset.',
  '= inclus dans les exports': '= included in exports',
  '= exclu des exports et des recherches': '= excluded from exports and searches',
  'Aucune suppression physique': 'No file is ever deleted',
  "Retire définitivement les images 'Rejeter' de ce subset": "Permanently removes the 'Reject' images from this subset",
  'Application...': 'Applying...',
  'Analyse des embeddings en cours...': 'Analyzing embeddings...',
  'Aucun doublon dans ce subset avec ce seuil.': 'No duplicates in this subset at this threshold.',
  "Pas d'image": 'No image',
  'Uniforme': 'Uniform',
  'Commun': 'Common',
  'Moyen': 'Medium',
  'Rare': 'Rare',
  'Seuil %': 'Threshold %',
  'Tout sauver': 'Save all',
  'Dupliquer': 'Duplicate',
  'Appliquer au subset': 'Apply to the subset',
  'Utilisateur': 'User',
  'Installation et reglages': 'Setup and settings',
  'Developpeur': 'Developer',
  'Liste des pages indisponible': 'Page list unavailable',
  'Aucune page de documentation.': 'No documentation page.',
  'Chargement de la documentation...': 'Loading the documentation...',
  'Documentation non disponible': 'Documentation not available',
  "Cette page n'est pas encore ecrite dans le dossier docs/ de l'application.":
    "This page is not written yet in the application's docs/ folder.",
  "Le backend ne repond pas. Verifiez qu'il est demarre puis rechargez la page.":
    'The backend is not responding. Check that it is running, then reload the page.',
  "Cette page n'est pas encore traduite : version dans l'autre langue.":
    'This page is not translated yet: showing the other language.',
  'Recherche sémantique': 'Semantic search',
  'Rechercher': 'Search',

  // -- pages/SemanticSearch.tsx --
  'Entrez une requête': 'Enter a query',
  'Erreur serveur': 'Server error',
  'Aucune image': 'No image',
  'Erreur création subset': 'Subset creation error',
  'Légende :': 'Legend:',
  'score de similarité CLIP (plus élevé = meilleure correspondance)': 'CLIP similarity score (higher = better match)',
  'cluster UMAP': 'UMAP cluster',
  'rareté dans le dataset (score élevé = image atypique)': 'rarity within the dataset (higher score = atypical image)',
  'Recherche...': 'Searching...',
  'résultats à retourner': 'results to return',
  'toutes les images ≥ ce score de match': 'all images ≥ this match score',
  'résultats pour': 'results for',
  'Tout sélectionner / désélectionner': 'Select all / deselect all',
  'Sauver sélection': 'Save selection',
  'Aucun résultat pour cette recherche.': 'No result for this search.',
  'Score de similarité CLIP :': 'CLIP similarity score:',
  'Cluster UMAP :': 'UMAP cluster:',
  'Rareté dans le dataset :': 'Rarity within the dataset:',

  // -- pages/SettingsPage.tsx --
  'Impossible de charger les paramètres': 'Unable to load settings',
  'Paramètres sauvegardés — thème appliqué': 'Settings saved — theme applied',
  'Impossible de charger les paramètres.': 'Unable to load settings.',
  'Stockés dans': 'Stored in',
  'Chemin workspace': 'Workspace path',
  'Configurable via EXPLORER_WORKSPACE dans launcher.py': 'Configurable via EXPLORER_WORKSPACE in launcher.py',
  'Base de données': 'Database',
  'Index FAISS': 'FAISS index',
  "Dossier d'imports": 'Imports folder',
  'Les subsets exportés créeront un sous-dossier ici.': 'Exported subsets will create a subfolder here.',
  'Configurable aussi via': 'Also configurable via',
  'dans launcher.py.': 'in launcher.py.',
  'Subsets & liens': 'Subsets & links',
  'Stratégie de liens': 'Link strategy',
  'Définit comment les fichiers sont référencés dans les subsets et exports.': 'Defines how files are referenced in subsets and exports.',
  'lien symbolique (aucune copie, rapide, recommandé).': 'symbolic link (no copy, fast, recommended).',
  'Copie': 'Copy',
  "copie physique (lent, consomme de l'espace, mais universel).": 'physical copy (slow, uses disk space, but universal).',
  '(recommandé)': '(recommended)',
  'Copie physique': 'Physical copy',
  'Windows : nécessite le': 'Windows: requires',
  'Mode Développeur': 'Developer mode',
  '(Paramètres → Pour les développeurs → Mode développeur : ON) ou droits admin.':
    '(Settings → For developers → Developer mode: ON) or admin rights.',
  'Réduction dimensionnelle': 'Dimensionality reduction',
  'Méthode utilisée pour projeter les embeddings CLIP (512D) en 2D sur la Carte.': 'Method used to project the CLIP embeddings (512D) into 2D on the Map.',
  "Appliquée à chaque pipeline d'embedding. Les hyperparamètres sont sauvegardés et utilisés pour toutes les nouvelles exécutions.":
    'Applied to every embedding pipeline. The hyperparameters are saved and used for all future runs.',
  'Méthode': 'Method',
  'UMAP : recommandé, meilleure préservation de la structure locale et globale.': 'UMAP: recommended, best preservation of local and global structure.',
  't-SNE : clusters bien séparés, mais distances inter-clusters peu fiables.': 't-SNE: well-separated clusters, but unreliable inter-cluster distances.',
  'PCA : déterministe et rapide, moins expressif sur les grands datasets.': 'PCA: deterministic and fast, less expressive on large datasets.',
  'Voisins locaux considérés (défaut : 15)': 'Local neighbors considered (default: 15)',
  'Distance minimale entre points (défaut : 0.1)': 'Minimum distance between points (default: 0.1)',
  'Perplexité': 'Perplexity',
  'Balance local/global (défaut : 30)': 'Local/global balance (default: 30)',
  "Vitesse d'apprentissage (défaut : 200)": 'Learning speed (default: 200)',
  'PCA : pas de paramètre spécifique. Toujours 2 composantes principales.': 'PCA: no specific parameter. Always 2 principal components.',
  'Méthode par défaut': 'Default method',
  'KMeans : nombre de clusters fixé (n_clusters), rapide et déterministe.': 'KMeans: fixed number of clusters (n_clusters), fast and deterministic.',
  'HDBSCAN : détecte automatiquement le nombre de clusters + le bruit (min_cluster_size).':
    'HDBSCAN: automatically detects the number of clusters + noise (min_cluster_size).',
  "Taille minimale d'un cluster (défaut : 5)": 'Minimum size of a cluster (default: 5)',
  'Valeurs par défaut': 'Default values',
  'Par défaut à la création de dataset': 'Default when creating a dataset',
  'Top-K recherche': 'Search Top-K',
  'Résultats par défaut en recherche sémantique': 'Default results in semantic search',
  'Mode couleur carte UMAP (défaut)': 'UMAP map color mode (default)',
  'Par cluster': 'By cluster',
  'Par rareté': 'By rarity',
  'Thème visuel': 'Visual theme',
  "Choisissez un fond et une couleur d'accent pour personnaliser l'atmosphère de l'app.":
    "Choose a background and an accent color to customize the app's atmosphere.",
  'Cliquez sur un thème pour le prévisualiser instantanément — sauvegardez pour le conserver.':
    'Click a theme to preview it instantly — save to keep it.',
  "Fond de l'application": 'Application background',
  "Couleur d'accent": 'Accent color',
  'Aperçu des éléments interactifs :': 'Preview of interactive elements:',
  'Bouton principal': 'Primary button',
  'Badge accent': 'Accent badge',
  'Guide technique': 'Technical guide',
  'Position': 'Position',
  "dans l'index = Image rang": "in the index = Image ranked",
  'triée par': 'sorted by',
  "ascendant. Ne jamais ajouter d'images sans reconstruire l'index.": "ascending. Never add images without rebuilding the index.",
  'Tous les embeddings CLIP sont L2-normalisés. Similarité cosinus = produit scalaire (dot product) → FAISS IndexFlatIP.':
    'All CLIP embeddings are L2-normalized. Cosine similarity = dot product → FAISS IndexFlatIP.',
  'Nécessitent le Mode Développeur ou droits admin. Configurable ci-dessus : activez "Copie physique" pour éviter cette restriction.':
    'Require Developer mode or admin rights. Configurable above: enable "Physical copy" to avoid this restriction.',
  'Sauvegarder les modifications': 'Save changes',
  'Aucune modification': 'No changes',
  'lecture seule': 'read-only',

  // -- pages/SubsetManager.tsx --
  'Subset déverrouillé': 'Subset unlocked',
  'Subset verrouillé': 'Subset locked',
  'Changement de verrou échoué': 'Lock change failed',
  'Sélectionnez un dataset': 'Select a dataset',
  'Aucune image sélectionnée': 'No image selected',
  'Erreur création': 'Creation error',
  'Exporté vers :': 'Exported to:',
  'Erreur export': 'Export error',
  'Nom du subset dupliqué :': 'Duplicated subset name:',
  'Erreur duplication': 'Duplication error',
  "Subset verrouillé — déverrouillez d'abord": 'Subset locked — unlock it first',
  'Subset supprimé': 'Subset deleted',
  'Suppression échouée': 'Deletion failed',
  'Gestion des subsets': 'Subset management',
  "Collections d'images avec symlinks vers le dataset source": 'Image collections with symlinks to the source dataset',
  'créer un subset :': 'create a subset:',
  'Dataset...': 'Dataset...',
  'Créer': 'Create',
  'Filtrer par dataset :': 'Filter by dataset:',
  'Tous': 'All',
  'Aucun subset. Sélectionnez des images sur la carte ou en recherche sémantique.':
    'No subset. Select images on the map or in semantic search.',
  'Exporté': 'Exported',
  'Verrouillé': 'Locked',
  'copie': 'copy',
  'Voir la carte UMAP du dataset source': "View the source dataset's UMAP map",
  'Dupliquer ce subset': 'Duplicate this subset',
  'Détecter et gérer les doublons dans ce subset': 'Detect and manage duplicates in this subset',
  'Doublons désactivés après export': 'Duplicates disabled after export',
  'Exporter vers Annotation App (plusieurs exports possibles)': 'Export to Annotation App (multiple exports possible)',
  'Exporter': 'Export',
  'Déverrouiller': 'Unlock',
  'Verrouiller (empêche suppression accidentelle)': 'Lock (prevents accidental deletion)',
  'Supprimer le subset et son dossier': 'Delete the subset and its folder',
  'Exporter vers Annotation App': 'Export to Annotation App',
  'Chemin du dossier...': 'Folder path...',
  'Le sous-dossier': 'The subfolder',
  "sera créé à l'intérieur.": 'will be created inside.',
  'Laissez vide pour utiliser le chemin par défaut.': 'Leave empty to use the default path.',
  'Export...': 'Exporting...',
  'Supprimer le subset': 'Delete the subset',
  'Cette action retire le subset de la base et supprime son dossier de liens.':
    'This action removes the subset from the database and deletes its links folder.',
  'image(s) référencée(s)': 'referenced image(s)',
  'Les images originales ne sont jamais supprimées du disque.': 'The original images are never deleted from disk.',
  'Les exports déjà réalisés vers Annotation App ne sont pas retirés.': 'Exports already made to Annotation App are not removed.',
  'Supprimer': 'Delete',

  // -- components/help/datasetTourSteps.ts --
  'Bienvenue': 'Welcome',
  'Dataset Explorer en quelques minutes': 'Dataset Explorer in a few minutes',
  "Cette application repond a une question simple : qu'y a-t-il vraiment dans mon dataset ? Elle encode chaque image avec CLIP, puis permet de la cartographier, d'y chercher en langage naturel, d'y traquer les doublons et d'en extraire des sous-ensembles.":
    "This application answers a simple question: what's really in my dataset? It encodes each image with CLIP, then lets you map it, search it in natural language, track duplicates in it, and extract subsets from it.",
  "Le tour cree un dataset demo a partir des 10 images de circulation livrees avec la suite : rien a telecharger, rien a preparer.":
    'The tour creates a demo dataset from the 10 traffic images shipped with the suite: nothing to download, nothing to prepare.',
  'Ce dataset s\'appellera "Tuto Cars 10" et reste supprimable a tout moment.':
    'This dataset will be called "Tuto Cars 10" and can be deleted at any time.',
  'Echap ferme le tutoriel a tout moment. La page reste utilisable pendant le tour.':
    'Escape closes the tutorial at any time. The page remains usable during the tour.',
  "Les 10 images d'exemple sont introuvables sur cette installation (dossier data_tuto a la racine de Computer_Vision_App) : saisissez vous-meme le chemin d'un dossier d'images, ou glissez-le dans le champ.":
    'The 10 sample images cannot be found on this installation (data_tuto folder missing at the root of Computer_Vision_App): enter the path of an image folder yourself, or drag it into the field.',
  '1. Se reperer': '1. Getting your bearings',
  "Les six espaces de l'application": 'The six areas of the application',
  "Dataset Gallery : ajouter, organiser et epingler les datasets. Catalogue : interroger TOUS les datasets d'un coup, sans les fusionner. Playground : l'espace de calcul, ou l'on lance les embeddings et ou l'on ouvre carte, recherche et doublons.":
    'Dataset Gallery: add, organize, and pin datasets. Catalog: query ALL datasets at once, without merging them. Playground: the computation space, where you run the embeddings and open the map, search, and duplicates.',
  'Subsets : les sous-ensembles extraits, exportables vers Annotation App. Documentation et Parametres completent le tout.':
    'Subsets: the extracted subsets, exportable to Annotation App. Documentation and Settings complete the picture.',
  'Le parcours normal va de haut en bas : Gallery, puis Playground, puis Subsets.':
    'The normal path goes top to bottom: Gallery, then Playground, then Subsets.',
  'Trois compteurs, trois notions': 'Three counters, three concepts',
  'Dans ce workspace : les datasets qui vous appartiennent. Globaux disponibles : ceux partages par vos collegues, importables en un clic. Epingles dans Playground : ceux sur lesquels vous travaillez en ce moment.':
    'In this workspace: the datasets you own. Global available: those shared by your colleagues, importable in one click. Pinned in Playground: the ones you are currently working on.',
  "Un dataset global n'est pas copie : il est reference. L'importer dans votre workspace le rend analysable sans dupliquer les images.":
    'A global dataset is not copied: it is referenced. Importing it into your workspace makes it analyzable without duplicating the images.',
  '2. Ajouter un dataset': '2. Add a dataset',
  'Ajouter un dataset = scanner un dossier': 'Adding a dataset = scanning a folder',
  "Rien n'est copie : vous donnez le chemin d'un dossier d'images, l'application le scanne, indexe les fichiers et fabrique des miniatures.":
    'Nothing is copied: you give the path of an image folder, the application scans it, indexes the files, and generates thumbnails.',
  'Les champs suivants se remplissent de haut en bas ; seul le premier est obligatoire.':
    'The following fields fill in from top to bottom; only the first one is required.',
  "Le chemin du dossier d'images": 'The image folder path',
  "Chemin vu par le SERVEUR qui execute l'application : chemin Windows en local, chemin Linux si le backend tourne sur une VM. Un dossier peut aussi y etre glisse-depose.":
    'Path as seen by the SERVER running the application: a Windows path locally, a Linux path if the backend runs on a VM. A folder can also be dragged and dropped there.',
  "Le tutoriel a saisi le chemin des 10 images d'exemple livrees avec la suite.":
    'The tutorial entered the path of the 10 sample images shipped with the suite.',
  'Le nom du dataset': 'The dataset name',
  "Laisse vide, il reprend le nom du dossier. C'est ce nom qui apparait dans la Gallery, le Playground, le Catalogue et les exports.":
    "Left empty, it takes the folder's name. This is the name that appears in the Gallery, the Playground, the Catalog, and the exports.",
  'Le tutoriel a saisi "Tuto Cars 10".': 'The tutorial entered "Tuto Cars 10".',
  'Le nombre de clusters': 'The number of clusters',
  'Combien de groupes le clustering doit-il former sur les embeddings CLIP. Trop peu : tout se melange ; trop : le bruit devient des groupes.':
    'How many groups should clustering form on the CLIP embeddings. Too few: everything blends together; too many: noise becomes groups.',
  "Sur 10 images, 3 suffisent -- le tutoriel l'a regle. Ce choix se refait a tout moment depuis le Playground, sans re-encoder les images.":
    "For 10 images, 3 is enough -- the tutorial has set it. This choice can be redone at any time from the Playground, without re-encoding the images.",
  'Partager, et le dossier de destination': 'Sharing, and the destination folder',
  "Partager : ON publie le dataset dans la galerie globale -- vos collegues le voient depuis leur propre workspace, par lien symbolique, sans copie des images.":
    'Share: ON publishes the dataset in the global gallery -- your colleagues see it from their own workspace, via symbolic link, without copying the images.',
  'Le menu deroulant a cote range le dataset dans un dossier de la Gallery ; les dossiers se creent depuis les sections du bas.':
    'The dropdown next to it files the dataset into a Gallery folder; folders are created from the sections below.',
  'Associer des annotations (optionnel)': 'Attach annotations (optional)',
  "Un fichier .ver, un dossier YOLO ou un .txt produit par Annotation App : les boites sont alors lues et affichees sur les images, et deviennent filtrables.":
    'A .ver file, a YOLO folder, or a .txt produced by Annotation App: the boxes are then read and displayed on the images, and become filterable.',
  "C'est ce qui ferme la boucle entre les deux applications : on annote d'un cote, on verifie la qualite du dataset de l'autre.":
    "This is what closes the loop between the two applications: you annotate on one side, you check the dataset's quality on the other.",
  'Associer des metadonnees (optionnel)': 'Attach metadata (optional)',
  'Un .csv ou .xlsx dont une colonne identifie l\'image (nom de fichier). "Analyser colonnes" lit l\'en-tete et vous fait choisir cette colonne cle.':
    'A .csv or .xlsx file with a column identifying the image (file name). "Analyze columns" reads the header and lets you choose this key column.',
  'Les colonnes restantes deviennent des filtres et des facettes dans le Catalogue : meteo, zone, capteur, campagne... tout ce que votre tableau contient.':
    'The remaining columns become filters and facets in the Catalog: weather, zone, sensor, campaign... whatever your table contains.',
  'Le scan liste les images, calcule leurs empreintes et genere les miniatures. Il tourne en tache de fond : la carte du dataset affiche sa progression.':
    "The scan lists the images, computes their fingerprints, and generates thumbnails. It runs in the background: the dataset's card shows its progress.",
  'Suivant lance le scan des 10 images.': 'Next launches the scan of the 10 images.',
  '3. Epingler et calculer': '3. Pin and compute',
  'Epingler dans le Playground': 'Pin in the Playground',
  "La Gallery gere les datasets ; le Playground les traite. L'epingle decide de ce sur quoi vous travaillez, sans rien deplacer sur le disque.":
    'The Gallery manages the datasets; the Playground processes them. Pinning decides what you are working on, without moving anything on disk.',
  'Suivant epingle le dataset demo.': 'Next pins the demo dataset.',
  'Direction le Playground': 'Off to the Playground',
  'Suivant ouvre le Playground, ou le dataset epingle nous attend.': 'Next opens the Playground, where the pinned dataset awaits us.',
  'La fiche du dataset': "The dataset's card",
  "Tout l'etat du dataset tient sur cette ligne : statut, nombre d'images, nombre d'embeddings deja calcules, nombre de clusters, et les methodes utilisees pour le clustering et la reduction 2D.":
    "The dataset's entire state fits on this line: status, number of images, number of embeddings already computed, number of clusters, and the methods used for clustering and 2D reduction.",
  '"0 embeddings" signifie simplement que le pipeline CLIP n\'a pas encore tourne : c\'est l\'etape suivante.':
    '"0 embeddings" simply means the CLIP pipeline has not run yet: that is the next step.',
  'Embeddings : le calcul qui debloque tout': 'Embeddings: the computation that unlocks everything',
  "Ce bouton lance le pipeline complet : CLIP encode chaque image en un vecteur de 512 dimensions, l'index de recherche est construit, la carte 2D est projetee et les clusters sont formes.":
    'This button launches the full pipeline: CLIP encodes each image into a 512-dimension vector, the search index is built, the 2D map is projected, and the clusters are formed.',
  "Tout ce qui suit en depend : sans embeddings, ni carte, ni recherche par texte, ni detection de doublons. Le calcul tourne cote serveur avec une barre de progression, et 10 images sont l'affaire de quelques secondes.":
    'Everything that follows depends on it: without embeddings, no map, no text search, no duplicate detection. The computation runs server-side with a progress bar, and 10 images take just a few seconds.',
  "Le tutoriel ne le declenche pas a votre place : lancez-le quand vous voulez, il n'y a rien a attendre pour continuer le tour.":
    'The tutorial does not trigger it on your behalf: run it whenever you want, there is nothing to wait for to continue the tour.',
  'Cliquez sur Embeddings pour voir le pipeline tourner sur les 10 images.': 'Click Embeddings to see the pipeline run on the 10 images.',
  'Ce qui apparait apres le calcul': 'What appears after the computation',
  "Carte : la projection 2D (UMAP, t-SNE ou PCA) ou chaque point est une image -- on y voit les groupes, les trous et les images aberrantes, et on peut y selectionner une zone entiere.":
    'Map: the 2D projection (UMAP, t-SNE, or PCA) where each point is an image -- you can see the groups, the gaps, and the outlier images, and you can select an entire area.',
  'Recherche : une requete en langage naturel ("voiture rouge de nuit") classee par similarite CLIP. Doublons : les paires trop semblables, a arbitrer une par une.':
    'Search: a natural-language query ("red car at night") ranked by CLIP similarity. Duplicates: pairs that are too similar, to be arbitrated one by one.',
  "Cluster et Reduc. rejouent le regroupement ou la projection avec d'autres reglages, sans re-encoder les images. Les deux icones a gauche desepinglent le dataset ou le suppriment definitivement.":
    'Cluster and Reduc. replay the grouping or the projection with different settings, without re-encoding the images. The two icons on the left unpin the dataset or permanently delete it.',
  '4. Exploiter': '4. Put it to work',
  'Filtrer la Gallery par texte': 'Filter the Gallery by text',
  'Depuis la Gallery, ce champ interroge CLIP sur plusieurs termes a la fois ("voiture, nuit, pluie") et ne garde que les images correspondantes -- de quoi fabriquer un dataset filtre en une requete.':
    'From the Gallery, this field queries CLIP on several terms at once ("car, night, rain") and keeps only the matching images -- enough to build a filtered dataset in one query.',
  'Suivant y retourne.': 'Next goes back there.',
  'La recherche CLIP de la Gallery': "The Gallery's CLIP search",
  'Plusieurs termes separes par des virgules : chacun devient un filtre, et le resultat peut etre enregistre comme un nouveau dataset filtre.':
    'Several terms separated by commas: each becomes a filter, and the result can be saved as a new filtered dataset.',
  'Cette recherche ne fonctionne que sur les datasets dont les embeddings sont calcules.':
    'This search only works on datasets whose embeddings have been computed.',
  'Subsets : extraire pour annoter': 'Subsets: extracting to annotate',
  'Une selection faite sur la carte, dans la recherche ou dans les doublons devient un subset : un dossier de liens symboliques (ou de copies) vers les images retenues.':
    'A selection made on the map, in search, or in duplicates becomes a subset: a folder of symbolic links (or copies) to the retained images.',
  "Un subset s'exporte vers Annotation App : on part d'un gros dataset brut, on en extrait les images qui valent la peine, on les annote. C'est le circuit complet de la suite.":
    "A subset is exported to Annotation App: you start from a large raw dataset, extract the images worth keeping, and annotate them. This is the suite's full circuit.",
  'Catalogue : tous les datasets a la fois': 'Catalog: all datasets at once',
  "Meme recherche visuelle, meme recherche par metadonnees et meme detection de doublons, mais appliquees a TOUS les datasets prets en meme temps -- sans avoir a les fusionner.":
    'The same visual search, the same metadata search, and the same duplicate detection, but applied to ALL ready datasets at the same time -- without having to merge them.',
  "C'est la vue a utiliser quand on ne sait plus dans quel dataset se trouve telle image, ou pour reperer les recouvrements entre campagnes.":
    'This is the view to use when you no longer know which dataset an image is in, or to spot overlaps between campaigns.',
  '5. Reglages et aide': '5. Settings and help',
  'Les parametres': 'The settings',
  "Valeurs par defaut du pipeline (nombre de clusters, taille des resultats), methode de reduction et ses hyperparametres, methode de clustering, chemin d'export vers Annotation App, liens symboliques ou copies physiques, et theme de l'interface.":
    'Default pipeline values (number of clusters, result size), reduction method and its hyperparameters, clustering method, export path to Annotation App, symbolic links or physical copies, and the interface theme.',
  'Ces reglages vivent dans le workspace : ils suivent le contexte de travail, pas la machine.':
    'These settings live in the workspace: they follow the work context, not the machine.',
  'La documentation': 'The documentation',
  "Le manuel complet de l'application, en pages : guide ecran par ecran, procedures pas a pas, concepts (CLIP, carte 2D, clustering, doublons), configuration et depannage, puis les pages developpeur. Le bouton en haut de la page relance ce tutoriel.":
    'The complete manual of the application, split into pages: screen-by-screen guide, step-by-step procedures, concepts (CLIP, 2D map, clustering, duplicates), configuration and troubleshooting, then the developer pages. The button at the top of the page restarts this tutorial.',
  'Termine': 'Done',
  'Le circuit est boucle': 'The circuit is complete',
  "Dossier scanne, dataset epingle, embeddings calcules, carte et recherche disponibles, subset exportable vers l'annotation : c'est tout le cycle de Dataset Explorer.":
    "Folder scanned, dataset pinned, embeddings computed, map and search available, subset exportable for annotation: that's the whole Dataset Explorer cycle.",
  'Le dataset "Tuto Cars 10" vous appartient : gardez-le pour experimenter, ou supprimez-le depuis le Playground.':
    'The "Tuto Cars 10" dataset belongs to you: keep it to experiment, or delete it from the Playground.',
  'Bonne exploration.': 'Happy exploring.',
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
