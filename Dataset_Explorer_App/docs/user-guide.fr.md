---
app: explorer
doc_type: user-guide
audience: user
lang: fr
title: Guide utilisateur
order: 10
tags: [interface, galerie, playground, carte, catalogue, subsets, paramètres]
sources: [Dataset_Explorer_App/frontend/src/App.tsx, Dataset_Explorer_App/frontend/src/pages/Gallery.tsx, Dataset_Explorer_App/frontend/src/pages/Dashboard.tsx, Dataset_Explorer_App/frontend/src/pages/DatasetMap.tsx, Dataset_Explorer_App/frontend/src/pages/SemanticSearch.tsx, Dataset_Explorer_App/frontend/src/pages/DuplicateExplorer.tsx, Dataset_Explorer_App/frontend/src/pages/Catalog.tsx, Dataset_Explorer_App/frontend/src/pages/SubsetManager.tsx, Dataset_Explorer_App/frontend/src/pages/SettingsPage.tsx, Dataset_Explorer_App/frontend/src/pages/HelpPage.tsx, Dataset_Explorer_App/frontend/src/components/FilterBar.tsx, Dataset_Explorer_App/frontend/src/components/SubsetDuplicatesModal.tsx, Dataset_Explorer_App/frontend/src/components/UserBadge.tsx, Dataset_Explorer_App/frontend/src/components/help/datasetTourSteps.ts]
---

# Guide utilisateur

## Barre latérale et navigation de Dataset Explorer

La barre latérale à gauche de chaque page de Dataset Explorer donne accès aux six espaces de l'application. De haut en bas :

- Le nom de l'application et le bouton orange **Tutoriel**, qui lance le tutoriel interactif. Il brille tant que vous ne l'avez jamais lancé.
- **Dataset Gallery** : ajouter, ranger, partager et épingler les datasets. C'est la page d'accueil.
- **Catalogue** : interroger tous les datasets prêts à la fois, par contenu d'image ou par métadonnées, et trouver les doublons entre datasets.
- **Playground** : l'espace de traitement. Seuls les datasets épinglés y apparaissent ; c'est là qu'on lance les embeddings et qu'on ouvre la carte, la recherche et les doublons d'un dataset.
- **Subsets** : les collections d'images extraites, prêtes à être exportées vers Annotation App.
- **Documentation** : cette documentation.
- **Paramètres** : valeurs par défaut du pipeline, stratégie de liens, thème.

Le parcours normal va de haut en bas : Gallery, puis Playground, puis Subsets.

Quand des images sont sélectionnées sur la carte ou dans les résultats de recherche, un encadré sous le menu affiche **N image(s) sélectionnée(s)** avec un lien **Créer subset** vers la page Subsets. La sélection est conservée quand vous changez de page.

Le badge utilisateur en bas affiche les initiales et le nom de l'utilisateur courant, puis quatre petits boutons : **Ouvrir workspace** (ouvre le dossier du workspace dans l'explorateur Windows ; ne fonctionne que dans VisionNexus), **Historique des workspaces** (workspaces récents de cette application, un clic en ouvre un), **Utilisateurs connectes** (autres utilisateurs qui font tourner Dataset Explorer sur la même installation, avec leur workspace) et le bouton de langue **FR** / **EN**.

## Page Dataset Gallery

La page Dataset Gallery est l'écran d'accueil de Dataset Explorer. Elle liste tous les datasets accessibles et c'est le seul endroit où l'on ajoute des datasets.

Trois compteurs sont affichés en haut :

- **Dans ce workspace** : datasets présents dans votre workspace, locaux ou importés depuis la galerie globale.
- **Globaux disponibles** : datasets partagés publiés par d'autres utilisateurs et pas encore présents dans votre workspace.
- **Épinglés dans Playground** : datasets affichés actuellement dans le Playground.

Viennent ensuite le formulaire **Ajouter un dataset**, la barre de filtrage CLIP et deux sections de cartes de datasets : **Galerie globale** et **Mon workspace**. Tant qu'un filtre CLIP est actif, les deux sections sont remplacées par les résultats du filtre. Chaque partie est décrite dans sa propre section de ce guide.

Un dataset de la galerie globale n'est pas copié : il référence le même dossier d'images. L'importer dans votre workspace le rend analysable (embeddings, carte, subsets) sans dupliquer les images.

## Formulaire d'ajout de dataset de la Gallery

Le formulaire **Ajouter un dataset** de la page Dataset Gallery scanne un dossier et crée un dataset. Seul le premier champ est obligatoire.

- **Chemin du dossier d'images** : le chemin tel que vu par la machine du backend. Avec un backend local, un chemin Windows comme `D:\data\images` ; avec un backend sur une VM Linux, un chemin serveur comme `/srv/datasets/run01`. Les chemins réseau Windows comme `\\share-host\datasets\run01` sont traduits en chemin serveur. Dans VisionNexus, vous pouvez aussi glisser un dossier depuis l'explorateur de fichiers sur le champ. Appuyez sur `Entrée` ou cliquez sur **Scanner**.
- **Nom (optionnel)** : par défaut le nom du dossier. C'est le nom affiché partout, y compris dans les dossiers de subsets et d'export.
- **Clusters :** le nombre de clusters KMeans (2 à 200, 20 par défaut). Il se change plus tard sans réencoder les images.
- Liste **Dossier de destination** : range le nouveau dataset dans un de vos dossiers (ou **Racine (aucun dossier)**). Quand le partage est activé, seuls les dossiers partagés sont proposés.
- **Partager** / **Partager : ON** : publie le dataset dans la galerie globale pour que tous les utilisateurs de l'installation le voient. Cinq miniatures sont copiées dans la galerie pour les aperçus.
- **Scanner** : lance le scan. La carte apparaît immédiatement avec le statut `scanning` et une barre de progression.

Associations optionnelles, sur les lignes suivantes :

- **Annotations (optionnel)** : un fichier `.ver`, un dossier de labels YOLO ou un fichier `.txt` YOLO. L'application compte les frames et les boîtes et affiche un badge sur la carte ; le filtre **Avec annotations** s'en sert. **Nom des annotations (optionnel)** étiquette ce badge.
- **Métadonnées (optionnel)** : un fichier `.csv`, `.tsv`, `.txt` ou Excel avec une ligne par image. Cliquez sur **Analyser colonnes** pour lire son en-tête, puis choisissez la **Colonne clé :** dont les valeurs correspondent aux noms de fichiers image (avec ou sans extension). Les autres colonnes deviennent cherchables dans le **Catalogue**. Quand des colonnes ressemblent à des colonnes déjà connues du catalogue, un encadré bleu liste les rapprochements ; c'est une information seulement, rien n'est renommé.

Si le dossier est déjà indexé, la fenêtre **Chemin déjà connu** liste le dataset existant. **Continuer quand même** crée un second dataset sur le même dossier (nouveau scan et réencodage complet) ; **Annuler** arrête.

## Barre de filtrage CLIP de la Gallery

La barre de filtrage CLIP de la page Dataset Gallery classe vos datasets selon le nombre de leurs images qui correspondent à une description textuelle. Elle ne prend en compte que les datasets de votre workspace dont les embeddings sont calculés.

Commandes :

- **Champ de requête** : un ou plusieurs termes séparés par des virgules, par exemple `drone, forest, night`. Appuyez sur `Entrée` ou cliquez sur **Filtrer**.
- **OR** / **AND** : une image compte si elle correspond à au moins un terme (OR) ou à tous les termes (AND).
- **Seuil de matching** : curseur de 0 à 100 %, 25 % par défaut. Une image compte si son score CLIP pour un terme atteint cette valeur.
- **Effacer** : retire le filtre et réaffiche les sections de datasets.
- **Avec annotations** : un bouton séparé qui masque, dans les sections normales, les datasets sans fichier d'annotations.

Les résultats remplacent les sections de datasets. L'en-tête affiche **N dataset(s) pertinent(s)** et les termes utilisés, avec **Trier par** **Absolu** (nombre d'images correspondantes) ou **Relatif** (pourcentage du dataset). Chaque carte de résultat montre le rang, le nom, le nombre d'images correspondantes sur le total, le pourcentage et les cinq meilleures images avec leur score.

Au-dessus des résultats, la barre violette affiche **Total retenu** et permet de construire un nouveau dataset à partir des seules images retenues : saisissez un nom dans **Nom du dataset filtré...** (par défaut `filtered_<termes>`) et cliquez sur **Merge filtré -> Playground** (le bouton affiche une flèche). Une barre de progression suit les phases. Le nouveau dataset apparaît dans **Mon workspace** avec le badge `merged`, déjà calculé ; épinglez-le pour l'utiliser dans le Playground.

## Sections Galerie globale et Mon workspace

La page Dataset Gallery présente les datasets dans deux sections de cartes. **Galerie globale** liste tous les datasets partagés de l'installation, qu'ils soient ou non dans votre workspace. **Mon workspace** liste tous les datasets de votre workspace, locaux ou importés.

Chaque carte affiche l'identifiant du dataset, un statut coloré (`scanning`, `pending`, `embedding`, `ready`, `error` ; survolez un statut `error` pour lire le message), le nom et des badges : `global`, `dans workspace` ou `disponible` dans la section globale, `merged` pour un dataset fusionné, `Playground` quand il est épinglé, et un badge orange **doublon de** quand un autre dataset utilise le même dossier. La ligne suivante donne le nombre d'images, d'embeddings et de clusters, et le nombre d'images **rejetées**. Les badges d'annotations et de métadonnées, la progression du scan et celle des **Miniatures** apparaissent quand c'est utile ; les datasets globaux montrent aussi leurs cinq miniatures fixes.

Boutons à gauche d'une carte :

- Dans **Mon workspace** : l'icône d'épingle, **Épingler dans le Playground** ou **Retirer du Playground**.
- Dans **Galerie globale** : une icône de disque verte quand le dataset est déjà dans votre workspace, ou l'icône de téléchargement **Importer dans ce workspace**, qui scanne le dossier partagé dans votre workspace sans l'épingler.

Boutons à droite : la liste **Ranger dans un dossier**, la flèche **Voir les détails** et la corbeille. Dans **Mon workspace**, la corbeille supprime le dataset de votre workspace (**Supprimer le dataset**), ou le retire seulement de votre workspace s'il est global. Dans **Galerie globale**, seul l'utilisateur qui a publié le dataset peut utiliser **Supprimer définitivement de la galerie globale** ; pour les autres, l'icône est désactivée.

Chaque section a un bouton **Nouveau dossier**. Les dossiers se replient ; survolez un dossier pour afficher **Nouveau sous-dossier** et **Supprimer le dossier** (ses datasets et sous-dossiers remontent au parent). Les dossiers créés dans la section globale sont partagés avec tous les workspaces.

## Panneau de détails d'un dataset de la Gallery

Le panneau de détails s'ouvre sous une carte de dataset de la page Dataset Gallery quand vous cliquez sur la flèche **Voir les détails**. Les statistiques ne sont chargées qu'à l'ouverture du panneau.

Il affiche :

- **Chemin**, **Ajouté** (date), **Images**, **Carte** (**calculée** quand les embeddings ont tourné) et **Exclusions** (nombres d'images rejetées et actives) quand des images sont rejetées.
- Pour un dataset global : l'**Aperçu** des cinq miniatures fixes de la galerie avec un bouton **Rafraîchir** qui les régénère, ou **Générer les miniatures gallery** quand il n'y en a aucune, et les **Statistiques de base** stockées dans le registre partagé (taille moyenne et formats), disponibles avant même l'import.
- Pour un dataset de votre workspace : les dimensions moyennes (**Dim. moyenne**), les largeurs et hauteurs minimales et maximales, **Poids moyen**, **Poids total**, les modes couleur échantillonnés sur 20 images et la répartition des formats, plus cinq miniatures aléatoires pour un dataset local.

En bas, **Épingler dans le Dashboard Playground** épingle le dataset, **Épinglé dans le Playground** confirme qu'il l'est, et pour un dataset global pas encore importé le bouton **Importer dans ce workspace** l'importe.

## Page Playground

La page Playground (**Dashboard Playground**) est l'endroit où les datasets sont traités. Elle n'affiche que les datasets épinglés depuis la Gallery ; sans dataset épinglé, elle affiche **Aucun dataset épinglé** et un lien **Aller à la Gallery**. L'en-tête donne le nombre de datasets épinglés et d'images, et un lien **Gallery**.

Chaque carte de dataset affiche l'identifiant, le statut, le nom, le chemin du dossier (ou **Fusion de :** et les datasets sources pour un dataset fusionné), les nombres d'images, d'embeddings et de clusters et, une fois la carte calculée, le **Clustering** et la **Réduction** appliqués (par exemple `KMeans k=20` et `UMAP (nn 15, d 0.1)`). Une ligne orange **Méthode de réduction modifiée - carte à recalculer** apparaît quand les réglages de réduction ont changé depuis le calcul de la carte. Quand des images sont rejetées, une ligne affiche les nombres **Init**, **Jetés** et **Utilisé** avec un bouton **Reset** qui efface toutes les décisions garder ou rejeter du dataset et recalcule sa carte.

Boutons à droite d'une carte :

- **Retirer du Playground (ne supprime pas le dataset)** (icône d'épingle) et la corbeille, qui supprime définitivement le dataset avec ses fiches d'images, ses embeddings et ses subsets après confirmation.
- **Embeddings** : lance le pipeline complet (CLIP, index, carte, clustering, rareté). Pendant le calcul, le bouton est remplacé par **En cours...** et une barre de progression montre la phase. Un second clic ne lance jamais un second calcul ; seules les images sans embedding sont réencodées.
- Une fois la carte calculée : **Carte**, **Recherche**, **Doublons**, **Rebuild** (orange, seulement quand des images sont rejetées ; il clignote quand des images rejetées sont encore sur la carte), **Cluster** et **Réduc.**, décrits dans la section suivante.
- **Recalculer carte** : affiché quand les réglages de réduction ont changé ; recalcule seulement la carte 2D avec les réglages courants.

Quand au moins deux datasets épinglés ont une carte, **Fusionner datasets** ouvre le panneau de fusion, décrit dans sa propre section.

### Panneaux Cluster et Réduc. du Playground

Les boutons **Cluster** et **Réduc.** d'une carte du Playground ouvrent des panneaux intégrés qui recalculent une partie de l'analyse sans réencoder les images.

Le panneau **Cluster** recalcule les clusters et les scores de rareté sur les embeddings CLIP à 512 dimensions :

- **KMeans** avec un curseur et un champ pour le nombre de clusters (2 à 200), ou **HDBSCAN** avec `min_cluster_size`.
- **Relancer** l'exécute en tâche de fond ; une barre de progression **Clustering :** apparaît.
- **Défaut** charge la méthode et les valeurs par défaut de la page **Paramètres** ; **actuel :** rappelle la configuration appliquée.

Le panneau **Réduc.** recalcule seulement la carte 2D :

- **UMAP** avec `n_neighbors` et `min_dist`, **TSNE** avec `perplexity` et `learning_rate`, ou **PCA** (**Aucun hyperparamètre (2 composantes)**).
- **Relancer** l'exécute en tâche de fond avec une barre **Réduction :** ; **Défaut** et **actuel :** fonctionnent comme dans le panneau Cluster.

Aucun des deux panneaux ne modifie les embeddings. Les mêmes panneaux existent sur la page de la carte. Le sens de chaque paramètre est expliqué dans [Concepts](concepts.fr.md).

### Panneau de fusion de datasets du Playground

Le panneau de fusion du Playground combine plusieurs datasets épinglés en un nouveau sans relancer CLIP. Il s'ouvre avec **Fusionner datasets**, affiché quand au moins deux datasets épinglés ont une carte.

1. Cochez les datasets sources avec les cases qui apparaissent sur leurs cartes (**Sélectionnez les datasets à fusionner**).
2. Dès que deux sont cochés, réglez **Nom** (par défaut `merged_<noms>`) et **Clusters** (20 par défaut).
3. Cliquez sur **Fusionner (N sources)**. Une barre de progression suit les phases.

Le dataset fusionné réutilise les embeddings stockés, puis reconstruit son propre index, sa carte (avec les réglages de réduction courants), ses clusters KMeans et ses scores de rareté. Il apparaît dans **Mon workspace** avec le badge `merged` et doit être épinglé pour apparaître dans le Playground. **Annuler** ferme le panneau.

## Page Carte

La page Carte montre un dataset sous forme de nuage de points où chaque point est une image et où les images semblables sont proches. Ouvrez-la avec **Carte** sur une carte du Playground ou sur un subset. Si la carte n'a pas encore été calculée, la page affiche **Carte non calculée pour ce dataset.**

Le titre indique le nom du dataset et la méthode de réduction. Les compteurs indiquent le nombre d'images sélectionnées et de points affichés. Les images rejetées comme doublons ou exclues ne sont pas affichées.

Interactions avec le nuage (barre d'outils Plotly en haut à droite du graphique) :

- Le lasso est actif par défaut : entourez des points pour les sélectionner. Un nouveau lasso remplace la sélection ; un double-clic dans une zone vide l'efface.
- La molette zoome, la barre d'outils passe en déplacement ou en zoom rectangle, et le survol d'un point affiche son nom de fichier.
- Les couleurs suivent le mode couleur, avec une légende : une couleur par cluster (les points de bruit HDBSCAN sont gris), ou une échelle vert, jaune, rouge pour la rareté.

La ligne de filtres au-dessus du graphique, décrite dans la section suivante, filtre les points et donne accès aux panneaux de clustering et de réduction.

### Filtres, clustering et réduction sur la carte

La ligne de filtres de la page Carte change ce que montre le nuage de points.

- **Couleur :** mode couleur, **Cluster**, **Rareté** ou **Uniforme** (couleur unique).
- **Cluster :** n'affiche qu'un cluster (**Tous** les affiche tous), avec le nombre d'images de chaque cluster.
- **Rareté :** deux curseurs ne gardent que les points dont la rareté est comprise entre un pourcentage minimal et maximal.

À droite, le clustering et la réduction courants sont rappelés à côté des boutons **Clustering** et **Réduction**. Ils ouvrent les mêmes panneaux que **Cluster** et **Réduc.** dans le Playground (voir *Panneaux Cluster et Réduc. du Playground*), avec leurs barres de progression ; la carte se rafraîchit automatiquement à la fin du calcul.

### Panneau de cluster et panneau de sélection de la carte

Quand un seul cluster est choisi dans la ligne de filtres de la page Carte, un panneau de cluster apparaît au-dessus du graphique. Il affiche la couleur et le numéro du cluster, son nombre d'images et sa rareté moyenne (**rareté moy.**), les 24 premières miniatures (un clic en sélectionne ou désélectionne une, la loupe l'agrandit), **Tout sélectionner (N)** pour ajouter toutes les images affichées du cluster à la sélection et **Tout désélectionner** pour les retirer.

Quand des images sont sélectionnées, un panneau de sélection apparaît sous le graphique avec **N image(s) sélectionnée(s)** :

- **Nom du subset...** et **Créer subset** : crée un subset à partir de la sélection dans ce dataset.
- **Exclure du dataset** : marque les images sélectionnées comme rejetées, comme un rejet de doublon. Elles disparaissent de la carte et n'y sont plus sélectionnables ; utilisez **Rebuild** pour recalculer la carte sans elles et **Reset** dans le Playground pour les restaurer.
- **Effacer sélection** (icône en croix).

Une bande affiche les miniatures sélectionnées avec leur cluster et leur rareté ; un clic sur une miniature l'ouvre en grand (avec le lien vers l'image en pleine résolution, le cluster, la rareté et ses métadonnées éventuelles), un clic sur sa légende la désélectionne.

## Page Recherche sémantique

La page Recherche sémantique trouve les images d'un dataset qui correspondent à une description textuelle. Ouvrez-la avec **Recherche** sur une carte du Playground. Elle nécessite les embeddings.

Commandes :

- **Champ de requête** : une description, par exemple `person walking` ou `red car at night`. CLIP comprend mieux l'anglais. Appuyez sur `Entrée` ou cliquez sur **Rechercher**.
- Mode **Top-K** : renvoie les N meilleures images, avec un curseur de 5 à 100 et un champ jusqu'à 500 (20 par défaut, **résultats à retourner**).
- Mode **Seuil %** : renvoie toutes les images dont le score atteint le seuil (1 à 99 %, 35 % par défaut), sans limite.

La ligne de légende explique les badges. Les résultats sont des cartes classées par score, avec un badge de rang, le nom de fichier et trois badges : le pourcentage de correspondance (vert à partir de 70 %, jaune à partir de 50 %, rouge en dessous), le cluster `C<n>` et la rareté `R<n>%`. Un clic sur une miniature l'ouvre en grand avec un lien vers l'image en pleine résolution ; un clic sur la légende ou la case la sélectionne.

La barre d'actions affiche **N résultats pour "requête"**, un bouton **Tout sélectionner** / **Tout désélectionner**, le champ **Nom du subset...** et un bouton d'enregistrement : **Sauver sélection (N)** quand des images sont sélectionnées, sinon **Tout sauver (N)**, qui crée un subset avec tous les résultats. Une nouvelle recherche vide la sélection.

## Page Explorateur de doublons

La page Explorateur de doublons (**Explorateur de doublons**) regroupe les images quasi identiques d'un dataset pour décider lesquelles garder. Ouvrez-la avec **Doublons** sur une carte du Playground. Rien n'est jamais supprimé du disque : une image rejetée est seulement masquée sur la carte et écartée des clusters après un rebuild (voir *Décisions garder et rejeter* dans [Concepts](concepts.fr.md)).

L'en-tête affiche le nombre de groupes et d'images concernées et, quand des images sont rejetées, les nombres **Base :**, **Jetés :** et **Utilisé :**. Un encadré rappelle le sens de **Garder** et **Rejeter**.

Commandes :

- **Seuil :** curseur et champ de 80 à 100 % (97 % par défaut), puis **Appliquer**. L'indication rappelle 80 % approximatif, 97 % quasi identiques, 100 % exactement identiques.
- **Auto-sélectionner tous** : dans chaque groupe, garde les N images les plus proches de la référence (N réglé par le **Garder** du groupe, 1 par défaut) et rejette les autres.
- **Reset tout** : efface les décisions en attente.
- **Sauvegarder (N décisions)** : écrit les décisions dans le dataset.
- **Rebuild UMAP sans doublons (N exclus)** : recalcule la carte et les clusters sans les images rejetées.

Chaque carte de groupe affiche **Groupe #id**, sa taille, **sim max :**, les nombres **à garder** et **à rejeter**, un curseur et un champ **Garder** (de 0 à la taille du groupe) avec **Auto** et **Reset** pour ce groupe. Chaque image affiche sa similarité avec la référence (**Référence** pour la première, marquée `Ref`), la décision enregistrée s'il y en a une, et les boutons **Garder** / **Rejeter**. Un clic sur une miniature l'agrandit.

## Page Catalogue

La page Catalogue (**Catalogue**) interroge tous les datasets prêts de votre workspace comme un seul ensemble, sans les fusionner au préalable. Elle a trois onglets, décrits ci-dessous. Un avertissement s'affiche quand aucun dataset n'est encore prêt. Dans les deux premiers onglets, un clic sur une carte de résultat la sélectionne ; une barre apparaît alors en bas avec le nombre, un champ **nom du subset** et **Créer subset**. Une sélection qui couvre plusieurs datasets crée un subset par dataset, suffixé `_ds<id>`. Seuls les datasets de votre workspace au statut `ready` participent à la recherche visuelle et à l'analyse des doublons ; la recherche par métadonnées couvre aussi les datasets dont les embeddings ne sont pas encore calculés.

### Onglet Recherche visuelle du Catalogue

L'onglet **Recherche visuelle** de la page Catalogue lance une recherche CLIP par texte sur tous les datasets prêts à la fois. Saisissez une description (par exemple `drone above the forest`), choisissez **Top-K** (1 à 500, 60 par défaut) ou **Seuil** (1 à 99 %, 28 % par défaut) et cliquez sur **Rechercher**. **Restreindre à :** limite la recherche à certains datasets (**tous** par défaut).

La ligne de synthèse donne le nombre de résultats, la taille de l'index global (**index global :** vecteurs et datasets) et le nombre de résultats par dataset. Chaque carte montre la miniature, le nom de fichier, le dataset et le score. Utilisez cet onglet quand vous ne savez plus quel dataset contient une image, ou pour repérer les recouvrements entre campagnes.

### Onglet Métadonnées du Catalogue

L'onglet **Métadonnées** de la page Catalogue cherche dans les métadonnées CSV ou Excel associées aux datasets à l'import. Si aucun dataset n'a de métadonnées, un avertissement explique comment associer un fichier.

- **Champ de recherche** : mots-clés, valeurs ou noms de colonnes, par exemple `zone_forestiere brouillard`. Le dernier mot est aussi cherché comme préfixe. Choisissez **tous les mots** ou **au moins un**, puis cliquez sur **Chercher**.
- **Restreindre à :** limite la recherche à certains datasets.
- **Explorer une colonne :** liste toutes les colonnes de métadonnées avec le nombre de datasets qui les possèdent. Un clic affiche ses valeurs avec leur nombre d'images ; un clic sur une valeur la recherche.
- **Colonnes rapprochées automatiquement :** montre les colonnes de noms différents qui semblent équivalentes d'un dataset à l'autre.

Les résultats arrivent par pages de 60 avec **précédent** et **suivant** ; chaque carte affiche les deux premiers champs de métadonnées.

### Onglet Doublons cross-dataset du Catalogue

L'onglet **Doublons cross-dataset** de la page Catalogue retrouve une même image stockée dans plusieurs datasets. Réglez le **Seuil de similarité** (80 à 100 %, 99 % par défaut), laissez cochée la case **uniquement les groupes couvrant plusieurs datasets** pour ignorer les doublons internes à un dataset, et cliquez sur **Analyser**. Le temps écoulé s'affiche pendant la recherche.

La synthèse donne les groupes affichés (50 au plus, ceux qui couvrent le plus de datasets en premier), le total détecté et le nombre de vecteurs indexés. Chaque groupe affiche ses datasets, sa taille et, au-delà de 24 images, un badge **affichage tronqué**. Marquez les images avec **garder** ou **rejeter**, puis cliquez sur **Enregistrer N décision(s)**. Comme partout, rejeter pose seulement un marqueur sur l'image dans son propre dataset ; aucun fichier n'est supprimé.

## Page Subsets

La page Subsets (**Gestion des subsets**) liste les collections d'images extraites de vos datasets. Chaque subset est un dossier de liens symboliques (ou de copies) sous `subsets/` dans le workspace.

Quand des images sont sélectionnées ailleurs dans l'application, un encadré en haut propose de **créer un subset :** choisissez le dataset source, saisissez un nom et cliquez sur **Créer**. **Filtrer par dataset :** restreint la liste.

Chaque carte de subset affiche son nom, les badges **Exporté** et **Verrouillé**, le nombre d'images et le dataset, le dossier de liens, et une ligne par export avec son chemin et un badge `symlink` ou **copie**. Boutons :

- **Carte** : ouvre la carte du dataset source (quand il en a une).
- **Dupliquer** : copie le subset sous un nom numéroté (`nom_1`, `nom_2`...) modifiable ; fonctionne même après export.
- **Doublons** : ouvre la fenêtre des doublons du subset. Désactivé une fois le subset exporté.
- **Exporter** : exporte vers Annotation App (voir la fenêtre d'export plus bas).
- Icône de cadenas : **Verrouiller (empêche suppression accidentelle)** / **Déverrouiller**. Un subset verrouillé ne peut pas être supprimé, même par l'API.
- Corbeille : demande confirmation, puis supprime le subset et son dossier de liens. Les images originales et les exports déjà réalisés ne sont jamais retirés.

### Fenêtre des doublons d'un subset

La fenêtre des doublons d'un subset s'ouvre avec **Doublons** sur une carte de subset de la page Subsets. Elle cherche les quasi-doublons parmi les seules images de ce subset.

Elle fonctionne comme la page Explorateur de doublons : **Seuil** avec **Appliquer**, **Auto-sélectionner tous**, **Reset tout**, nombre **Garder** par groupe avec **Auto** et **Reset**, et **Garder** / **Rejeter** sur chaque image.

Deux actions ont des portées différentes, rappelées par un encadré d'avertissement :

- **Sauvegarder** écrit les décisions dans le dataset source. Les images rejetées sont alors masquées sur sa carte, écartées de son rebuild dans le Playground, de ses recherches et de tous les exports, et ne sont plus sélectionnables sur sa carte.
- **Appliquer au subset** enregistre les décisions en attente, puis retire les images rejetées de ce subset seulement (liens et base) et ferme la fenêtre.

Pour annuler les décisions sur le dataset, utilisez **Reset** sur sa carte du Playground.

### Fenêtre d'export vers Annotation App

L'export d'un subset commence avec **Exporter** sur sa carte de la page Subsets. Ce qui se passe dépend du mode de lancement de l'application.

- **Autonome** : la fenêtre **Exporter vers Annotation App** demande le **Dossier de destination**, prérempli avec le dossier d'imports par défaut. Le sous-dossier au nom du subset est créé à l'intérieur. Laissez le champ vide pour utiliser le chemin par défaut. Cliquez sur **Exporter**.
- **Lancée par l'Orchestrateur** : pas de fenêtre ; l'export va directement dans le dossier d'imports du workspace d'Annotation App.

Les images sont liées (ou copiées, selon la stratégie de liens de la page **Paramètres**) dans `<dossier>/<nom du subset>/`. Un subset peut être exporté plusieurs fois vers des dossiers différents ; un second export vers le même dossier est refusé. La notification indique le chemin d'export, à importer ensuite dans Annotation App.

## Page Paramètres

La page Paramètres (**Paramètres**) regroupe les préférences du workspace ; son en-tête indique le fichier `settings.json` où elles sont stockées. Les modifications ne sont écrites que quand vous cliquez sur **Sauvegarder les modifications** en bas (**Aucune modification** quand rien n'a changé). Chaque option est détaillée dans [Configuration](configuration.fr.md).

Sections :

- **Workspace** : chemins en lecture seule du workspace, de la base, des miniatures et des index FAISS.
- **Export Annotation App** : **Dossier d'imports**.
- **Subsets & liens** : **Stratégie de liens**, **Symlinks (recommandé)** ou **Copie physique**.
- **Réduction dimensionnelle** : **Méthode** (UMAP, t-SNE ou PCA) et ses hyperparamètres.
- **Clustering** : **Méthode par défaut** (KMeans ou HDBSCAN) et `min_cluster_size`.
- **Valeurs par défaut** : **Clusters KMeans**, **Top-K recherche** et **Mode couleur carte UMAP (défaut)**.
- **Thème visuel** : **Fond de l'application** et **Couleur d'accent**. Un clic sur un thème le prévisualise immédiatement ; sauvegardez pour le garder.
- **Guide technique** : rappels courts pour les développeurs. Les ports affichés sont ceux par défaut d'un lancement manuel, pas ceux de l'instance en cours.

## Page Documentation

La page Documentation (**Documentation** dans la barre latérale) affiche cette documentation dans l'application. La colonne de gauche liste les pages en trois groupes, **Utilisateur**, **Installation et reglages** et **Developpeur** ; sous la page ouverte, elle affiche la table des matières de ses sections. Les liens entre pages restent dans l'application, et l'adresse de la page (`/help?doc=<page>#<section>`) peut être mise en favori.

Les pages suivent la langue de l'interface choisie avec le bouton **FR** / **EN**. Le bouton orange **Lancer le tutoriel interactif** en haut relance le tutoriel.

## Tutoriel interactif

Le tutoriel interactif est une visite guidée de Dataset Explorer sur de vraies données. Lancez-le avec **Tutoriel** en haut de la barre latérale ou avec **Lancer le tutoriel interactif** sur la page Documentation. `Échap` le ferme à tout moment, et la page reste utilisable pendant la visite.

La visite remplit le formulaire **Ajouter un dataset** avec les dix images de circulation livrées avec la suite (`data_tuto/cars_10_frames` à la racine de la suite), nomme le dataset **Tuto Cars 10**, règle 3 clusters et le scanne. Elle épingle ensuite le dataset, ouvre le Playground, montre **Embeddings** (vous le lancez vous-même), et présente la carte, la recherche, les doublons, le filtre CLIP de la Gallery, les pages Subsets et Catalogue, les paramètres et la documentation. Si les images d'exemple manquent dans l'installation, la visite vous demande de saisir le chemin de votre propre dossier.

Le dataset de démonstration vous appartient et se supprime comme les autres. Le fait d'avoir lancé ou terminé le tutoriel est mémorisé par VisionNexus pour votre utilisateur (ou dans les paramètres du workspace hors de VisionNexus).
