---
app: explorer
doc_type: workflows
audience: user
lang: fr
title: Procédures
order: 20
tags: [scan, embeddings, subset, doublons, catalogue, export, orchestrateur]
sources: [Dataset_Explorer_App/frontend/src/pages/Gallery.tsx, Dataset_Explorer_App/frontend/src/pages/Dashboard.tsx, Dataset_Explorer_App/frontend/src/pages/DatasetMap.tsx, Dataset_Explorer_App/frontend/src/pages/SemanticSearch.tsx, Dataset_Explorer_App/frontend/src/pages/DuplicateExplorer.tsx, Dataset_Explorer_App/frontend/src/pages/Catalog.tsx, Dataset_Explorer_App/frontend/src/pages/SubsetManager.tsx, Dataset_Explorer_App/frontend/src/components/SubsetDuplicatesModal.tsx, Dataset_Explorer_App/backend/api/orchestrator.py, Dataset_Explorer_App/backend/utils/native_share.py]
---

# Procédures

## Ajouter un dataset depuis un dossier local ou serveur

Cette procédure crée un dataset dans Dataset Explorer à partir d'un dossier d'images lisible par le backend.

*Prérequis* : Dataset Explorer est ouvert sur la page **Dataset Gallery** ; le dossier contient des images `.jpg`, `.jpeg`, `.png`, `.bmp`, `.tif`, `.tiff` ou `.webp` (les sous-dossiers sont aussi parcourus).

1. Dans **Ajouter un dataset**, saisissez le chemin du dossier tel que vu par le backend : `D:\data\run01` pour un backend local, `/srv/datasets/run01` pour un backend sur une VM Linux. Dans VisionNexus, vous pouvez aussi glisser le dossier sur le champ.
2. Saisissez éventuellement un **Nom (optionnel)** ; sinon le nom du dossier est utilisé.
3. Réglez **Clusters :** selon le dataset (par exemple 10 à 30 pour quelques milliers d'images ; voir [Concepts](concepts.fr.md)).
4. Choisissez éventuellement un dossier de destination dans la liste voisine.
5. Cliquez sur **Scanner** ou appuyez sur `Entrée`. Si la fenêtre **Chemin déjà connu** apparaît, le dossier est déjà un dataset : cliquez sur **Annuler** pour réutiliser l'existant, ou sur **Continuer quand même** pour en créer un second.
6. Suivez la carte dans **Mon workspace** : statut `scanning` avec un compteur `X/N images`, puis `pending`. Les miniatures continuent d'être générées en tâche de fond (barre **Miniatures**) ; vous pouvez continuer à travailler.

*Résultat* : un dataset au statut `pending`, une fiche par image (chemin, taille, MD5) et des miniatures dans le workspace. Aucune image n'est copiée. Si le statut passe à `error`, survolez-le pour lire la raison et consultez [Dépannage](troubleshooting.fr.md).

## Ajouter un dataset depuis un partage réseau Windows avec un backend distant

Cette procédure indexe des images stockées sur un partage réseau quand le backend de Dataset Explorer tourne sur une VM Linux et l'interface sur un poste Windows.

*Prérequis* : le partage est monté sur la VM sous `/home`, `/mnt`, `/srv`, `/media` ou `/data` avec le nom du partage en deuxième segment (par exemple `\\share-host\datasets` monté en `/srv/datasets`) ; VisionNexus a lancé l'application avec l'hôte de partage renseigné.

1. Dans l'explorateur Windows, ouvrez le dossier sur le partage.
2. Glissez le dossier sur le champ de chemin de **Ajouter un dataset**, ou collez son chemin Windows, par exemple `\\share-host\datasets\run01`.
3. Cliquez sur **Scanner**. Le backend traduit le chemin vers le premier candidat existant parmi `/home/datasets/run01`, `/mnt/datasets/run01`, `/srv/datasets/run01`, `/media/datasets/run01` et `/data/datasets/run01`.
4. Attendez le statut `pending` comme dans la procédure précédente.

*Résultat* : le dataset référence les images côté serveur. Dans VisionNexus, les miniatures et les images en pleine résolution peuvent alors être lues directement sur le partage par la coquille Windows au lieu de transiter par le backend. Si le scan échoue avec "Chemin introuvable", le point de montage ne suit pas cette convention ; saisissez plutôt le chemin serveur.

## Associer des annotations et un tableau de métadonnées à l'ajout d'un dataset

Cette procédure relie un fichier d'annotations existant et un tableau CSV ou Excel à un dataset pendant son import, pour les rendre visibles et cherchables.

*Prérequis* : le formulaire **Ajouter un dataset** contient un chemin de dossier ; le fichier d'annotations et le tableau sont lisibles par le backend.

1. Dans **Annotations (optionnel)**, saisissez le chemin d'un fichier `.ver`, d'un dossier de labels YOLO ou d'un fichier `.txt` YOLO. Renseignez éventuellement **Nom des annotations (optionnel)**.
2. Dans **Métadonnées (optionnel)**, saisissez le chemin du fichier `.csv`, `.tsv`, `.txt`, `.xlsx`, `.xlsm` ou `.xls`.
3. Cliquez sur **Analyser colonnes**. Un message indique le nombre de colonnes et de lignes.
4. Vérifiez la **Colonne clé :** choisie automatiquement (une colonne nommée comme `filename`, `image`, `path`, `id`...) et changez-la si besoin. Ses valeurs doivent correspondre aux noms de fichiers image, avec ou sans extension, sans tenir compte de la casse.
5. Lisez l'encadré bleu s'il apparaît : il liste les colonnes équivalentes à des colonnes déjà présentes dans le catalogue.
6. Cliquez sur **Scanner**.

*Résultat* : la carte affiche un badge d'annotations (`VER` ou `YOLO`, avec le nombre de boîtes) et un badge **métadonnées**. Chaque image reçoit la ligne du tableau qui correspond à son nom ; les colonnes sont cherchables dans l'onglet **Métadonnées** du **Catalogue** et affichées dans la vue agrandie d'une image sur la carte. Les annotations sont seulement comptées, pas dessinées sur les images.

## Calculer les embeddings d'un dataset

Cette procédure lance le pipeline d'analyse de Dataset Explorer sur un dataset : embeddings CLIP, index de similarité, carte 2D, clusters et scores de rareté.

*Prérequis* : le dataset est dans votre workspace au statut `pending` (ou `ready` après ajout d'images) ; le modèle CLIP est chargé (sinon voir [Dépannage](troubleshooting.fr.md)).

1. Sur la page **Dataset Gallery**, cliquez sur l'icône d'épingle de la carte du dataset dans **Mon workspace** (**Épingler dans le Playground**).
2. Ouvrez **Playground** dans la barre latérale.
3. Sur la carte du dataset, cliquez sur **Embeddings**. Le bouton devient **En cours...** et une barre de progression montre les phases : `embedding` (avec un compteur d'images), `indexing`, `umap`, `clustering`, `scoring`.
4. Vous pouvez quitter la page : le calcul tourne sur le serveur et la barre réapparaît à votre retour.
5. Quand le statut passe à `ready`, les boutons **Carte**, **Recherche**, **Doublons**, **Cluster** et **Réduc.** apparaissent.

*Résultat* : chaque image a un vecteur CLIP de 512 valeurs, une position sur la carte 2D, un cluster et un score de rareté. Relancer **Embeddings** plus tard n'encode que les images qui n'ont pas encore d'embedding, puis reconstruit l'index, la carte et les clusters.

## Sélectionner des images sur la carte et créer un subset

Cette procédure utilise la carte 2D d'un dataset pour sélectionner un groupe visuel d'images et l'enregistrer comme subset.

*Prérequis* : le dataset est au statut `ready`.

1. Dans le **Playground**, cliquez sur **Carte** sur la carte du dataset.
2. Restreignez éventuellement l'affichage : choisissez un cluster dans **Cluster :**, ou déplacez les curseurs **Rareté :** (par exemple 70 à 100 % pour ne voir que les images atypiques).
3. Tracez un lasso autour des points voulus. Le panneau de sélection affiche les miniatures sélectionnées ; un clic sur l'une d'elles l'ouvre en grand.
4. Pour ajouter tout un cluster, choisissez-le dans **Cluster :** et cliquez sur **Tout sélectionner (N)** dans le panneau de cluster.
5. Saisissez un nom dans **Nom du subset...** et cliquez sur **Créer subset**.

*Résultat* : un subset apparaît sur la page **Subsets** avec un dossier de liens `subsets/<nom>/` dans le workspace. La sélection est vidée. Si vous préférez retirer les images sélectionnées du dataset plutôt que les extraire, utilisez **Exclure du dataset** (voir *Exclure des images et recalculer la carte*).

## Créer un subset à partir d'une recherche par texte

Cette procédure trouve les images d'un dataset qui correspondent à une description et les enregistre comme subset.

*Prérequis* : le dataset est au statut `ready`.

1. Dans le **Playground**, cliquez sur **Recherche** sur la carte du dataset.
2. Saisissez une description en anglais, par exemple `pedestrian crossing at night`, et appuyez sur `Entrée`.
3. Choisissez combien de résultats garder : **Top-K** avec un nombre d'images, ou **Seuil %** pour obtenir toutes les images au-dessus d'un score (commencez vers 25 à 30 % et ajustez).
4. Parcourez les résultats. Un clic sur une miniature l'agrandit ; cliquez sur la légende ou la case des images à garder, ou utilisez **Tout sélectionner**.
5. Saisissez un nom dans **Nom du subset...** et cliquez sur **Sauver sélection (N)**, ou sur **Tout sauver (N)** pour garder tous les résultats.

*Résultat* : un subset sur la page **Subsets** avec les images choisies. Les phrases descriptives donnent de meilleurs résultats que les mots isolés ; voir la section sur le score de similarité dans [Concepts](concepts.fr.md).

## Trouver et rejeter les doublons d'un dataset

Cette procédure regroupe les images quasi identiques d'un dataset et marque les redondantes comme rejetées, sans supprimer aucun fichier.

*Prérequis* : le dataset est au statut `ready`.

1. Dans le **Playground**, cliquez sur **Doublons** sur la carte du dataset.
2. Ajustez **Seuil :** si besoin (97 % par défaut ; 99 % pour des copies strictes, 90 à 95 % pour des prises très proches) et cliquez sur **Appliquer**.
3. Pour chaque groupe, choisissez combien d'images garder avec **Garder**, puis cliquez sur **Auto** pour garder les images les plus proches de la référence, ou cliquez sur **Garder** / **Rejeter** sur chaque image. **Auto-sélectionner tous** applique la règle à tous les groupes.
4. Cliquez sur **Sauvegarder (N décisions)**.
5. Cliquez sur **Rebuild UMAP sans doublons (N exclus)** pour recalculer la carte et les clusters sans les images rejetées.

*Résultat* : les images rejetées disparaissent de la carte et, après le rebuild, des clusters ; elles ne sont plus sélectionnables sur la carte. La carte du Playground affiche les nombres **Init**, **Jetés** et **Utilisé**. Pour tout annuler, cliquez sur **Reset** sur la carte : toutes les décisions sont effacées et la carte est recalculée sur toutes les images.

## Exclure des images et recalculer la carte

Cette procédure retire de l'analyse d'un dataset des images indésirables (images floues, prises de calibration, hors sujet) sans les supprimer.

*Prérequis* : le dataset est au statut `ready`.

1. Dans le **Playground**, cliquez sur **Carte** sur la carte du dataset.
2. Sélectionnez les images à retirer au lasso ou avec le panneau de cluster. Les curseurs **Rareté :** aident à passer d'abord en revue les images atypiques.
3. Cliquez sur **Exclure du dataset** et confirmez.
4. De retour dans le **Playground**, cliquez sur **Rebuild** sur la carte (il clignote tant que des images exclues sont encore sur la carte).

*Résultat* : les images exclues sont marquées comme rejetées, comme les rejets de doublons. La carte, les clusters et les scores de rareté sont recalculés sur les images restantes ; les fichiers ne sont pas touchés. **Reset** sur la carte restaure toutes les images.

## Recalculer les clusters ou la carte 2D d'un dataset

Cette procédure change le clustering ou la projection 2D d'un dataset sans réencoder les images.

*Prérequis* : le dataset est au statut `ready`.

1. Dans le **Playground**, cliquez sur **Cluster** sur la carte du dataset (ou sur **Clustering** sur sa carte 2D).
2. Choisissez **KMeans** et un nombre de clusters, ou **HDBSCAN** et `min_cluster_size`, puis cliquez sur **Relancer**. Attendez la fin de la barre **Clustering :**.
3. Pour changer la projection, cliquez sur **Réduc.** (ou **Réduction** sur la carte 2D), choisissez **UMAP**, **TSNE** ou **PCA** et ses paramètres, puis cliquez sur **Relancer**.
4. **Défaut** recharge les valeurs de la page **Paramètres**.

*Résultat* : la carte du Playground et la carte 2D affichent la nouvelle configuration (par exemple `HDBSCAN (min 5) - 12 clusters`). Les scores de rareté sont recalculés avec les clusters. Changer plutôt la réduction dans **Paramètres** agit sur les calculs suivants et signale les cartes existantes avec **Recalculer carte**.

## Chercher dans tous les datasets à la fois avec le Catalogue

Cette procédure trouve des images par description ou par métadonnées dans tous les datasets prêts, et les extrait en subsets.

*Prérequis* : au moins un dataset de votre workspace est au statut `ready` (pour la recherche visuelle) ou possède un tableau de métadonnées (pour la recherche par métadonnées).

1. Ouvrez **Catalogue** dans la barre latérale.
2. Dans **Recherche visuelle**, saisissez une description, choisissez **Top-K** ou **Seuil**, restreignez éventuellement à certains datasets avec **Restreindre à :**, et cliquez sur **Rechercher**.
3. Ou ouvrez **Métadonnées**, cliquez sur une colonne dans **Explorer une colonne :** pour voir ses valeurs, cliquez sur une valeur (ou saisissez des mots-clés) et choisissez **tous les mots** ou **au moins un**.
4. Cliquez sur les cartes de résultats pour les sélectionner.
5. Saisissez un **nom du subset** dans la barre du bas et cliquez sur **Créer subset**.

*Résultat* : un subset par dataset représenté dans la sélection, nommé `<nom>` pour un seul dataset ou `<nom>_ds<id>` quand plusieurs datasets sont concernés.

## Trouver les images communes à plusieurs datasets

Cette procédure détecte les mêmes images stockées dans plusieurs datasets, par exemple deux campagnes qui se recouvrent.

*Prérequis* : au moins deux datasets de votre workspace sont au statut `ready`.

1. Ouvrez **Catalogue**, onglet **Doublons cross-dataset**.
2. Gardez le **Seuil de similarité** à 99 % pour de vraies copies, ou baissez-le pour des quasi-copies.
3. Laissez cochée la case **uniquement les groupes couvrant plusieurs datasets**.
4. Cliquez sur **Analyser** et patientez ; le temps écoulé s'affiche.
5. Passez les groupes en revue (ceux qui couvrent le plus de datasets en premier). Marquez les images avec **garder** ou **rejeter**.
6. Cliquez sur **Enregistrer N décision(s)**.

*Résultat* : les images rejetées sont marquées dans leur propre dataset et masquées sur sa carte (et écartées de ses clusters après **Rebuild**). Aucun fichier n'est supprimé.

## Construire un dataset filtré à partir de plusieurs datasets avec une requête texte

Cette procédure crée un nouveau dataset qui ne contient que les images correspondant à un ou plusieurs concepts, prises dans plusieurs datasets existants.

*Prérequis* : les datasets sources sont dans votre workspace avec leurs embeddings calculés.

1. Sur la page **Dataset Gallery**, saisissez les concepts dans la barre de filtrage CLIP, séparés par des virgules, par exemple `drone, night`.
2. Choisissez **OR** ou **AND**, réglez le **Seuil de matching** et cliquez sur **Filtrer**.
3. Examinez les datasets classés et leurs cinq meilleures images ; ajustez le seuil jusqu'à ce que **Total retenu** paraisse juste.
4. Saisissez un nom dans **Nom du dataset filtré...** et cliquez sur **Merge filtré -> Playground**.
5. Attendez la fin de la barre de progression, puis cliquez sur **Effacer** et épinglez le nouveau dataset depuis **Mon workspace**.

*Résultat* : un dataset `merged` déjà calculé, avec sa propre carte, ses clusters (méthode des **Paramètres**) et son index, qui ne contient que les images retenues de chaque dataset listé. Les images d'origine sont référencées, pas copiées.

## Fusionner plusieurs datasets en un seul

Cette procédure combine des datasets complets en un seul pour les analyser ensemble, sans relancer CLIP.

*Prérequis* : au moins deux datasets sont épinglés dans le Playground et ont une carte.

1. Dans le **Playground**, cliquez sur **Fusionner datasets**.
2. Cochez les datasets à fusionner sur leurs cartes.
3. Réglez **Nom** (ou gardez `merged_<noms>`) et **Clusters**.
4. Cliquez sur **Fusionner (N sources)** et attendez la fin des phases.
5. Épinglez le nouveau dataset depuis **Mon workspace** dans la Gallery.

*Résultat* : un dataset `ready` contenant toutes les images calculées des sources, avec son propre index, sa carte et ses clusters KMeans. Le **Catalogue** est souvent un meilleur choix pour chercher dans plusieurs datasets sans en créer un nouveau.

## Partager un dataset avec les autres utilisateurs

Cette procédure publie un dataset dans la galerie globale et permet à un autre utilisateur de l'importer dans son propre workspace.

*Prérequis* : tous les utilisateurs lancent Dataset Explorer depuis la même installation (la galerie globale vit dans le dossier de l'application) ; le dossier d'images est lisible par le backend de chaque utilisateur.

1. À l'ajout du dataset, cliquez sur **Partager** pour afficher **Partager : ON** (choisissez éventuellement un dossier partagé), puis cliquez sur **Scanner**.
2. Vérifiez que la carte apparaît dans **Galerie globale** avec ses cinq miniatures.
3. Côté autre utilisateur, ouvrez la **Dataset Gallery** : le dataset est listé dans **Galerie globale** avec le badge `disponible` et compté dans **Globaux disponibles**.
4. Cet utilisateur clique sur **Importer dans ce workspace** (icône de téléchargement). Le dossier est scanné dans son workspace.
5. Le dataset apparaît alors dans son **Mon workspace**, où il l'épingle et lance **Embeddings**.

*Résultat* : chaque utilisateur a sa propre analyse (embeddings, carte, décisions, subsets) sur les mêmes fichiers image. Seul l'auteur de la publication peut supprimer le dataset de la galerie globale. Les dossiers partagés créés dans la section globale sont visibles dans tous les workspaces.

## Nettoyer les doublons d'un subset

Cette procédure retire les quasi-doublons d'un subset avant son export.

*Prérequis* : le subset n'a pas encore été exporté (le bouton **Doublons** est désactivé après un export) ; son dataset source a ses embeddings.

1. Sur la page **Subsets**, cliquez sur **Doublons** sur la carte du subset.
2. Ajustez **Seuil** et cliquez sur **Appliquer** si besoin.
3. Posez les décisions avec **Auto-sélectionner tous**, l'**Auto** de chaque groupe, ou **Garder** / **Rejeter** sur chaque image.
4. Cliquez sur **Appliquer au subset**. Les décisions en attente sont enregistrées, puis les images rejetées sont retirées du subset.

*Résultat* : le subset perd ses images rejetées (liens et fiches). Attention, les décisions sont aussi écrites dans le dataset source : les images rejetées sont masquées sur sa carte et écartées de ses clusters après **Rebuild**. Utilisez **Reset** sur la carte du Playground pour les annuler.

## Exporter un subset vers Annotation App

Cette procédure envoie les images d'un subset à Annotation App pour les annoter.

*Prérequis* : le subset existe sur la page **Subsets** ; sous Windows avec des liens symboliques, le Mode développeur est activé (voir [Configuration](configuration.fr.md)).

1. Sur la page **Subsets**, cliquez sur **Exporter** sur la carte du subset.
2. En mode autonome, vérifiez le **Dossier de destination** (par défaut le dossier `imports` d'Annotation App) et cliquez sur **Exporter**. Quand l'application a été lancée par l'Orchestrateur, l'export démarre directement.
3. Lisez le chemin dans le message de confirmation ; la carte affiche maintenant le badge **Exporté** et une ligne d'export.
4. Dans Annotation App, créez un projet et importez ce dossier comme chemin serveur (voir la documentation d'Annotation App).

*Résultat* : un dossier `<destination>/<nom du subset>/` contenant des liens vers (ou des copies de) les images originales. Vous pouvez exporter à nouveau le même subset vers un autre dossier ; un second export vers le même dossier est refusé.

## Piloter Dataset Explorer depuis un pipeline de l'Orchestrateur

Cette procédure décrit ce que fait Dataset Explorer quand un pipeline de l'Orchestrateur le pilote, pour suivre et vérifier les étapes.

*Prérequis* : l'Orchestrator App a lancé Dataset Explorer et Annotation App pour le même utilisateur.

1. L'Orchestrateur charge la source du dataset : si le dossier est déjà un dataset, il est réutilisé (sauf si le pipeline a choisi de créer un doublon) ; sinon il est scanné. Le dataset est épinglé automatiquement dans le Playground.
2. Il lance les embeddings et attend le statut `ready` (vous pouvez suivre la progression dans le Playground).
3. Il crée un subset à partir d'une requête texte (Top-K ou seuil), éventuellement restreint aux images d'un autre subset. Un subset de même nom dans le dataset est remplacé.
4. Il exporte le subset dans le dossier `imports` du workspace d'Annotation App, en remplaçant un export précédent de même nom.
5. Dans ce mode, le bouton **Exporter** de la page Subsets ne demande jamais de dossier.

*Résultat* : le subset est prêt dans les imports d'Annotation App. Vous pouvez ouvrir Dataset Explorer à tout moment pendant l'exécution pour vérifier les clusters ou le subset avant l'étape suivante du pipeline.
