---
app: explorer
doc_type: concepts
audience: user
lang: fr
title: Concepts
order: 30
tags: [clip, embeddings, faiss, umap, kmeans, hdbscan, rareté, doublons]
sources: [Dataset_Explorer_App/backend/core/embedder.py, Dataset_Explorer_App/backend/core/indexer.py, Dataset_Explorer_App/backend/core/reducer.py, Dataset_Explorer_App/backend/core/clusterer.py, Dataset_Explorer_App/backend/core/image_io.py, Dataset_Explorer_App/backend/core/subset_manager.py, Dataset_Explorer_App/backend/core/metadata_loader.py, Dataset_Explorer_App/backend/core/annotation_ref.py, Dataset_Explorer_App/backend/core/format_registry.py, Dataset_Explorer_App/backend/api/datasets.py, Dataset_Explorer_App/backend/db/models.py]
---

# Concepts

## Datasets, workspaces et galerie globale

Un dataset de Dataset Explorer est un dossier d'images scanné : une fiche par image (chemin, nom de fichier, taille, dimensions, empreinte MD5), plus tout ce qui est calculé ensuite (embedding, position sur la carte, cluster, rareté, décision garder ou rejeter). Les images elles-mêmes ne sont jamais copiées ni modifiées ; si un fichier est déplacé ou supprimé du disque, le dataset garde une fiche périmée.

Chaque dataset vit dans un workspace, un dossier qui appartient à un utilisateur (`explorer_<utilisateur>` quand l'application est lancée depuis la suite). Deux utilisateurs qui travaillent sur le même dossier ont chacun leur dataset et leur analyse.

La galerie globale est partagée par tous les workspaces d'une même installation. Publier un dataset (**Partager : ON**) enregistre dans la galerie son chemin, ses compteurs, des statistiques de base et cinq miniatures fixes, pour que les autres utilisateurs le voient avant même de l'importer. Importer un dataset global scanne le même dossier dans le workspace qui l'importe. Les dossiers créés dans la section globale sont partagés de la même façon ; les dossiers personnels restent dans un seul workspace.

Limites : la galerie globale se trouve dans le dossier de l'application (`data/dataset_gallery/`), pas dans les workspaces ; elle n'est donc partagée qu'entre utilisateurs de la même installation. Seul l'utilisateur qui a publié un dataset peut le retirer de la galerie. Deux datasets peuvent pointer sur le même dossier ; la Gallery affiche alors un badge **doublon de**, et chacun est scanné et encodé séparément.

## Statuts d'un dataset et tâches de fond

Le statut d'un dataset de Dataset Explorer indique ce qu'on peut en faire :

- `scanning` : le dossier est parcouru et les fiches d'images créées. Un compteur montre la progression.
- `pending` : les fiches existent ; le dataset peut être épinglé et ses embeddings lancés. Les miniatures peuvent encore être en cours de génération.
- `embedding` : le pipeline d'embeddings tourne.
- `ready` : les embeddings, l'index, la carte et les clusters existent. Carte, recherche et doublons sont disponibles.
- `error` : le scan ou le pipeline a échoué. Survolez le statut dans la Gallery pour lire la raison quand elle a été enregistrée.

Les traitements lourds (scan, embeddings, reclustering, réduction 2D) tournent dans un pool de tâches de fond sur le serveur, trois à la fois par défaut. Lancer deux fois la même tâche sur le même dataset est ignoré. L'interface rafraîchit la liste des datasets toutes les deux secondes tant qu'une tâche tourne, ce qui alimente les barres de progression : vous pouvez quitter la page et revenir. Quelques opérations (fusion, rebuild sans doublons, reset des décisions, recalcul de carte) transmettent plutôt leur progression à la page qui les a lancées ; elles se terminent quand même sur le serveur si la page est fermée.

Si le backend s'arrête pendant un calcul d'embeddings, le dataset repasse en `pending` au démarrage suivant ; relancez **Embeddings**.

## Datasets épinglés et Playground

L'épinglage décide quels datasets apparaissent dans le Playground, la page de traitement de Dataset Explorer. Il ne déplace, ne copie et ne calcule rien. Les identifiants des datasets épinglés sont stockés dans les paramètres du workspace et survivent à un redémarrage.

La Gallery gère les datasets (ajout, partage, rangement, suppression) ; le Playground les traite (embeddings, carte, recherche, doublons, clustering, fusion). Désépingler un dataset dans le Playground le masque seulement à cet endroit. Les nouveaux datasets créés par une fusion ou une fusion filtrée ne sont pas épinglés automatiquement ; ceux chargés par l'Orchestrateur le sont.

## Embeddings CLIP

CLIP est un réseau de neurones entraîné sur des centaines de millions de paires image et légende, de sorte qu'une image et un texte qui la décrit produisent des vecteurs proches. Dataset Explorer utilise la variante ViT-B/32 : chaque image est redimensionnée à 224 x 224 pixels et transformée en un vecteur de 512 nombres, son embedding. Les textes saisis dans les champs de recherche sont transformés en vecteurs dans le même espace, ce qui rend la recherche par texte possible.

Les embeddings sont calculés sur le fichier image original, jamais sur la miniature. Ils sont normalisés à la longueur 1 : la similarité de deux images est donc simplement le produit scalaire de leurs vecteurs (similarité cosinus).

Seules les images sans embedding sont encodées quand **Embeddings** est relancé. Les poids du modèle sont lus dans un fichier local et jamais téléchargés (voir [Configuration](configuration.fr.md)).

Limites : CLIP capte le contenu global et le style d'une image, pas les petits détails : deux images qui ne diffèrent que par un petit objet lointain obtiennent presque le même vecteur. Il connaît bien les objets et scènes courants, moins bien les images spécialisées (infrarouge, médical, aérien sous des angles inhabituels). Une image illisible reçoit un vecteur entièrement nul : elle ne correspond à rien et se retrouve à l'écart sur la carte.

## Score de similarité et requêtes texte

Le score affiché par les pages de recherche, le filtre CLIP de la Gallery et les pages de doublons est la similarité cosinus entre deux vecteurs CLIP, affichée en pourcentage.

Entre deux images, le score est élevé : des images quasi identiques dépassent 95 %, des prises très proches tournent autour de 90 %. Entre un texte et une image, les scores sont bien plus bas : avec CLIP ViT-B/32 une bonne correspondance texte se situe typiquement entre 25 et 35 %, et 20 % est déjà faible. C'est pourquoi les seuils texte valent par défaut 25 % (filtre de la Gallery), 28 % (Catalogue) et 35 % (recherche dans un dataset), alors que les seuils de doublons valent 97 ou 99 %.

Conseils pour les requêtes : écrivez en anglais ; décrivez la scène plutôt qu'un mot isolé (`red car on a highway at night` marche mieux que `red`) ; dans le filtre de la Gallery, utilisez plusieurs termes séparés par des virgules avec **OR** pour réunir des variantes et **AND** pour les exiger tous. En mode **Top-K** vous obtenez toujours K résultats, même faibles ; en mode seuil, toutes les images au-dessus du score, éventuellement aucune.

## Index de similarité FAISS et index global

FAISS est la bibliothèque qui retrouve rapidement les vecteurs les plus proches. Dataset Explorer construit un index exact par dataset (produit scalaire sur vecteurs normalisés, égal à la similarité cosinus), l'enregistre dans le workspace (`faiss/<id du dataset>/index.faiss`) et le recharge au démarrage. La recherche dans un dataset et la détection de doublons l'utilisent.

Le **Catalogue** utilise un index global construit en mémoire à la demande en concaténant les index de tous les datasets prêts. Il est reconstruit automatiquement quand l'index d'un dataset change. Jusqu'à 200 000 images il est exact ; au-delà, il bascule vers un index approché HNSW, beaucoup plus rapide mais qui peut manquer quelques voisins.

Limite : un index décrit les images présentes lors de sa construction. Après avoir ajouté des images dans un dossier, relancez **Embeddings** pour que l'index, la carte et les clusters les incluent.

## Carte 2D : UMAP, t-SNE et PCA

La carte d'un dataset projette les embeddings à 512 dimensions sur un plan pour voir le dataset d'un coup d'œil : les images semblables se retrouvent proches, les groupes forment des nuages et les images atypiques restent isolées. Trois méthodes sont disponibles, choisies dans **Paramètres** ou dans le panneau **Réduc.** :

- **UMAP** (par défaut) : conserve assez bien à la fois les voisinages locaux et l'organisation générale. `n_neighbors` (15 par défaut) fixe combien de voisins chaque point considère : petit, il met en avant les petits groupes ; grand, la structure globale. `min_dist` (0.1 par défaut) règle la compacité des points dans un groupe.
- **t-SNE** : sépare très nettement les groupes, mais les distances entre groupes et leurs tailles ont peu de sens. `perplexity` (30 par défaut) joue un rôle proche de `n_neighbors` ; `learning_rate` (200 par défaut) la vitesse d'optimisation.
- **PCA** : projection linéaire sur les deux directions principales, rapide et déterministe, mais qui montre souvent un seul nuage confus sur les grands datasets.

UMAP et t-SNE utilisent la métrique cosinus et une graine aléatoire fixe : mêmes données et mêmes paramètres donnent la même carte. Replis automatiques : UMAP se replie sur t-SNE en cas d'échec ; moins de 4 images donnent une carte PCA.

Limites : une carte 2D déforme toujours les distances. Deux points proches sur la carte sont en général semblables, mais deux points éloignés ne sont pas forcément très différents. C'est pourquoi le clustering est calculé sur les embeddings complets, jamais sur la carte.

## Clustering : KMeans et HDBSCAN

Le clustering regroupe les images d'un dataset par ressemblance visuelle. Il est toujours calculé sur les embeddings à 512 dimensions, pas sur la carte 2D, et la carte ne fait qu'afficher le résultat en couleurs.

- **KMeans** découpe le dataset en exactement le nombre de clusters demandé (`n_clusters`, 20 par défaut). Chaque image appartient à un cluster. Rapide et reproductible. Ordre de grandeur : 10 à 30 clusters pour quelques milliers d'images, davantage pour de plus grands ensembles ; trop peu mélange des contenus différents, trop découpe un même contenu et transforme le bruit en groupes.
- **HDBSCAN** trouve lui-même le nombre de clusters à partir de la densité des données. `min_cluster_size` (5 par défaut) est la taille minimale d'un groupe ; les images qui n'appartiennent à aucun groupe dense sont étiquetées bruit et dessinées en gris sur la carte.

Recalculez les clusters à tout moment avec **Cluster** dans le Playground ou **Clustering** sur la carte ; les embeddings ne sont pas recalculés.

Limites : les clusters sont des groupes d'images d'aspect proche, pas des classes : un cluster peut mêler voitures et camions sur la même route, et une classe d'objet peut se répartir sur plusieurs clusters (jour et nuit). **Rebuild** et **Reset** recalculent toujours un KMeans avec le nombre de clusters courant du dataset, même si HDBSCAN était utilisé ; relancez le clustering HDBSCAN ensuite si besoin.

## Score de rareté

Le score de rareté indique à quel point une image est atypique dans son propre cluster. C'est la distance entre l'embedding de l'image et le centre de son cluster, remise à l'échelle dans chaque cluster de 0 (l'image la plus centrale) à 1 (la plus éloignée). Il est affiché en pourcentage avec trois bandes : commun (sous 33 %, vert), moyen, et rare (à partir de 66 %, rouge).

Servez-vous-en pour passer en revue les bords de chaque groupe : les images les plus rares d'un cluster sont souvent des conditions inhabituelles, des angles rares, des images mal classées ou corrompues, ou simplement des cas difficiles intéressants. Une image rare n'est pas une mauvaise image ; la rareté est un signal d'intérêt, pas de qualité.

Limites : le score est relatif à son cluster, donc chaque cluster a des images proches de 0 et de 1, même s'il est très homogène. Il change quand les clusters changent. Les images de bruit HDBSCAN reçoivent toutes 50 %.

## Groupes de doublons et seuil de similarité

Deux images sont considérées comme doublons quand la similarité cosinus de leurs embeddings atteint le seuil. Dataset Explorer relie chaque paire au-dessus du seuil (en examinant les 50 plus proches voisins de chaque image) et forme des groupes à partir des paires reliées. La première image d'un groupe (plus petit identifiant) est sa référence ; chaque image affiche sa similarité avec la référence.

Choisir le seuil :

- 99 % et plus : copies d'une même image, redimensionnées, recompressées ou renommées.
- environ 97 % (par défaut) : images quasi identiques, comme des images vidéo consécutives avec peu de mouvement.
- 90 à 95 % : prises très proches d'une même scène.
- sous 90 % : images qui partagent seulement un thème ; les groupes deviennent grands et peu utiles.

Les paires étant chaînées, un groupe peut contenir deux images moins semblables que le seuil si d'autres les relient. Dans une très longue rafale d'images identiques, un groupe de plus de 50 images peut être coupé en deux. Le **Catalogue** applique la même méthode entre datasets, sur l'index global.

## Décisions garder et rejeter

Une décision garder ou rejeter est un marqueur posé sur une image d'un dataset. Rien n'est jamais supprimé du disque. Une image peut être non décidée, gardée ou rejetée ; le rejet se fait dans les pages de doublons, dans la fenêtre des doublons d'un subset, dans l'onglet doublons du Catalogue, ou avec **Exclure du dataset** sur la carte.

Une image rejetée :

- disparaît immédiatement de la carte et des statistiques de clusters ;
- garde son ancienne position dans les clusters jusqu'à ce que **Rebuild** recalcule la carte et les clusters sans elle ;
- n'est retirée d'un subset que si vous utilisez **Appliquer au subset** dans la fenêtre des doublons de ce subset.

Les décisions appartiennent au dataset, pas à un subset : enregistrer des décisions depuis la fenêtre d'un subset modifie le dataset source pour toute la suite. **Reset** sur la carte du Playground efface toutes les décisions d'un dataset et recalcule sa carte sur toutes les images.

Effets : une image rejetée est écartée de la carte, des clusters, des recherches par texte d'un dataset et du Catalogue, et de l'export d'un subset. Un subset garde son lien vers une image rejetée, sans l'exporter, jusqu'à ce que **Appliquer au subset** la retire. Rien n'est supprimé sur le disque.

## Subsets et exports

Un subset est une collection nommée d'images d'un dataset, stockée sous forme de fiches en base et d'un dossier `subsets/<nom>/` dans le workspace contenant un lien par image. Les subsets se créent depuis une sélection sur la carte, des résultats de recherche, le Catalogue (un subset par dataset) ou en dupliquant un autre subset.

Les liens suivent la **Stratégie de liens** de la page **Paramètres** : liens symboliques (par défaut ; aucune copie, instantané, mais sous Windows ils demandent le Mode développeur ou les droits administrateur) ou copies physiques (plus lentes et plus lourdes, mais qui marchent partout). Un lien garde le nom de fichier d'origine : deux images de même nom venant de sous-dossiers différents entrent en collision et la seconde remplace la première.

Exporter un subset crée un autre dossier de liens (ou de copies) au nom du subset, par défaut dans le dossier `imports` d'Annotation App, et enregistre l'export. Un subset peut être exporté vers plusieurs destinations. Le bouton **Doublons** d'un subset est désactivé après son premier export : nettoyez un subset avant de l'exporter. Un verrou empêche la suppression d'un subset.

## Datasets fusionnés et filtrés

Un dataset fusionné combine les images de plusieurs datasets en un nouveau sans relancer CLIP : les fiches d'images et les embeddings sont copiés, puis un nouvel index, une carte, des clusters et des scores de rareté sont calculés. Son chemin est affiché comme la liste de ses sources et il porte le badge `merged`.

Deux façons d'en créer un :

- **Fusionner datasets** dans le Playground prend toutes les images calculées des datasets choisis et les regroupe avec KMeans.
- **Merge filtré -> Playground** dans la Gallery ne prend que les images dont le score CLIP pour les termes de la requête atteint le seuil, et les regroupe avec la méthode par défaut des **Paramètres**.

Limites : un dataset fusionné est un instantané. Les changements ultérieurs des sources (nouvelles images, décisions) n'y sont pas reportés, et les décisions prises sur le dataset fusionné ne remontent pas aux sources. Supprimer une source ne supprime pas le dataset fusionné, qui pointe toujours vers les mêmes fichiers image.

## Annotations et métadonnées d'un dataset

Deux fichiers optionnels peuvent être associés à un dataset lors de son ajout.

Un **fichier d'annotations** (`.ver`, dossier de labels YOLO ou fichier `.txt` YOLO, tels que produits par Annotation App) est seulement décrit : l'application détecte son format, compte frames et boîtes, et affiche un badge. Il sert à filtrer les datasets avec **Avec annotations** ; les boîtes ne sont pas dessinées sur les images.

Un **tableau de métadonnées** (CSV, TSV, TXT ou Excel) ajoute des informations libres à chaque image : météo, zone, capteur, campagne. Une colonne clé est comparée aux noms de fichiers image (nom complet ou sans extension, sans tenir compte de la casse) ; la ligne correspondante est rattachée à l'image. Les valeurs apparaissent alors dans la vue agrandie d'une image et deviennent cherchables dans l'onglet **Métadonnées** du Catalogue, où des colonnes de noms différents mais de sens proche (`scene` et `scene_name`) sont proposées comme équivalentes. Rien n'est renommé automatiquement.

Limites : une image dont le nom ne correspond à aucune ligne n'a simplement pas de métadonnées. La recherche par métadonnées nécessite l'extension SQLite FTS5, présente dans les distributions Python standard.

## Images 16 bits, infrarouges et formats optionnels

Dataset Explorer lit les images standard (`.jpg`, `.jpeg`, `.png`, `.bmp`, `.tif`, `.tiff`, `.webp`). Les images stockées sur plus de 8 bits par canal (PNG ou TIFF 16 bits, infrarouge, virgule flottante) sont ramenées à 8 bits par une fenêtre de trois écarts-types autour de la moyenne avant l'encodage et avant la fabrication des miniatures. Sans cela, ces images paraîtraient noires et donneraient des embeddings sans valeur.

Les autres formats sont pris en charge par des adaptateurs optionnels placés dans le backend (`backend/utils/`). L'adaptateur format specialise convertit les fichiers de séquence `.optional` (un fichier peut contenir de nombreuses images) en images PNG dans un dossier `<nom>_to_png/` à côté de la source. Quand un dossier scanné ne contient aucune image standard mais des fichiers au format d'un adaptateur, ou quand le chemin est un fichier `.optional` seul, ils sont d'abord convertis puis le dossier PNG est scanné. Retirer le fichier de l'adaptateur et redémarrer supprime cette capacité sans toucher aux images standard.

## Architecture et fonctionnement du modèle CLIP ViT-B/32

Dataset Explorer repose sur un seul modèle neuronal, CLIP ViT-B/32 avec les poids OpenAI d'origine (environ 151 millions de paramètres). Il est formé de deux réseaux entraînés ensemble, un pour les images et un pour le texte, qui projettent tous deux dans le même espace de 512 nombres.

### Tour image de CLIP : des pixels à un vecteur de 512 nombres

La tour image est un Vision Transformer. Avant lui, le prétraitement redimensionne l'image pour que son petit côté fasse 224 pixels, puis recadre le carré central de 224 x 224 : sur une image large, les bords gauche et droit ne sont pas vus par le modèle, ce qui est une raison pour laquelle un petit objet en bordure peut échapper à une recherche. Le carré est découpé en patchs de 32 x 32 pixels, soit 7 x 7 = 49 patchs ; chaque patch devient un jeton, et un jeton de classe spécial s'y ajoute, pour 50 jetons. Douze couches de transformer de largeur 768 et 12 têtes d'attention font échanger les jetons, et le jeton de classe final est projeté sur 512 nombres, puis normalisé à la longueur 1. Ce vecteur est l'embedding stocké dans le dataset et dans l'index FAISS.

La taille des patchs explique le niveau de détail : avec des patchs de 32 pixels, le modèle voit une disposition grossière, pas des textures fines. Il est rapide (peu de jetons) et capte la scène, les objets et le style, ce dont la recherche par similarité et la détection de doublons ont besoin.

### Tour texte de CLIP et entraînement contrastif : pourquoi le texte peut chercher des images

La tour texte est un transformer de 12 couches et de largeur 512 qui lit un prompt de 77 jetons au plus (les mots sont découpés en morceaux par un tokenizer à paires d'octets, donc une longue requête est tronquée). Le vecteur du dernier jeton est projeté sur les mêmes 512 nombres et normalisé.

Les deux tours ont été entraînées sur des centaines de millions de paires image et légende avec un objectif contrastif : dans un lot, chaque image doit être plus proche de sa propre légende que de toutes les autres, et chaque légende plus proche de sa propre image. Rien n'oblige les tours à s'accorder sur un sens exact ; elles apprennent seulement que les paires qui correspondent doivent pointer dans la même direction. Cela a deux conséquences pour Dataset Explorer. Une requête texte peut retrouver des images sans liste de classes, puisque le texte est placé dans le même espace que les images. Et la similarité entre un texte et une image reste basse, autour de 25 à 35 % pour une bonne correspondance, parce que les vecteurs de texte et d'image occupent des régions légèrement différentes de l'espace même quand ils correspondent ; la similarité image à image ne souffre pas de cet écart et atteint 90 % ou plus pour des images quasi identiques.

Le modèle n'a pas de notion de position ni de nombre : `three cars` et `one car` donnent des vecteurs proches, et son vocabulaire est surtout anglais.
