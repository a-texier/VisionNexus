---
app: explorer
doc_type: api-reference
audience: dev
lang: fr
title: Référence API
order: 70
tags: [api rest, endpoints, fastapi, sse, orchestrateur]
sources: [Dataset_Explorer_App/backend/main.py, Dataset_Explorer_App/backend/api/datasets.py, Dataset_Explorer_App/backend/api/folders.py, Dataset_Explorer_App/backend/api/explore.py, Dataset_Explorer_App/backend/api/filter.py, Dataset_Explorer_App/backend/api/duplicates.py, Dataset_Explorer_App/backend/api/export.py, Dataset_Explorer_App/backend/api/metadata.py, Dataset_Explorer_App/backend/api/settings.py, Dataset_Explorer_App/backend/api/orchestrator.py, Dataset_Explorer_App/backend/api/samples.py, Dataset_Explorer_App/backend/api/docs.py]
---

# Référence API

## Conventions de l'API de Dataset Explorer

Le backend de Dataset Explorer expose une API REST JSON sous `/api`, des fichiers statiques sous `/thumbs` et `/gallery-thumbs`, un contrôle de santé sur `/health`, et la documentation interactive FastAPI sur `/docs` au port du backend (8001 par défaut, voir [Configuration](configuration.fr.md)). À travers le frontend Vite, `/api`, `/thumbs` et `/gallery-thumbs` sont relayés : le frontend appelle toujours des URL relatives.

Règles générales :

- **Identifiants** : `dataset_id`, `image_id`, `subset_id` et `folder_id` sont des ids de la base du workspace. Les datasets globaux pas encore importés sont listés avec `id = -1` et ne sont pas utilisables par id.
- **Chemins** envoyés au backend : chemins sur la machine du backend. Le `root_path` de `POST /api/datasets`, `/api/datasets/check-path` et du `load-dataset` de l'Orchestrateur accepte aussi les chemins réseau Windows, traduits comme décrit dans [Configuration](configuration.fr.md).
- **Scores** (`score`, `threshold`, `min_score`, `similarity_to_representative`) : similarités cosinus entre 0 et 1.
- **Erreurs** au format FastAPI `{"detail": ...}` : 400 (entrée invalide), 404 (objet inconnu), 409 (conflit : chemin connu, subset verrouillé, export existant, nom ambigu), 425 (dataset pas encore calculé ou index non chargé), 503 (CLIP non chargé), 500. Les messages sont en français. Le 409 de `POST /api/datasets` a un `detail` objet avec `existing_dataset_id` et `existing_dataset_name`.
- **Opérations longues** : soit elles répondent immédiatement et publient leur progression dans `GET /api/datasets` (scan, embed, recluster, reduce), soit elles répondent par un flux de lignes `data: {json}` (merge, merge-filtered, remap, rebuild, reset). Les événements du flux ont un `type` `progress` (`current`, `total`, `phase`), `done` ou `error` (`message`).

Les tableaux d'endpoints de la section *Index des endpoints* sont générés depuis le code ; les sections ci-dessous expliquent chaque domaine.

## Endpoints de datasets : création, liste et détails

Ces endpoints de `api/datasets.py` gèrent les datasets du workspace.

- `POST /api/datasets` crée un dataset et planifie son scan ; il répond 201 immédiatement avec le statut `scanning`. Corps : `root_path` (obligatoire), `name`, `recursive` (vrai par défaut), `n_clusters` (20 par défaut), `share_dataset`, `folder_id`, `annotation_path`, `annotation_name`, `metadata_path`, `metadata_key_column`, `allow_duplicate`. 400 si le chemin n'existe pas, 409 s'il est déjà un dataset et que `allow_duplicate` est faux.
- `GET /api/datasets/check-path?root_path=` liste les datasets qui utilisent ce dossier (`id`, `name`, `image_count`, `status`).
- `GET /api/datasets` renvoie tous les datasets du workspace, puis les entrées du registre global pas encore importées. Chaque entrée porte les compteurs, le statut et `error_message`, `rejected_count`, `map_needs_rebuild`, `map_method_outdated`, les champs de progression `scan_*`, `embed_*` (avec `embed_phase`), `thumb_*`, `recluster_*`, `reduce_*`, les `cluster_method` / `cluster_params` et `reduction_method` / `reduction_params` appliqués, `folder_id`, les résumés d'annotations et de métadonnées, `gallery_thumb_urls`, `registry_stats`, `added_by` et `duplicate_of`.
- `GET /api/datasets/{id}` renvoie le détail avec `cluster_distribution`, `duplicate_count`, `rejected_count` et `map_needs_rebuild`.
- `GET /api/datasets/{id}/stats` calcule dimensions, répartition des formats, modes couleur (échantillonnés sur 20 images), tailles de fichiers et cinq miniatures aléatoires.
- `GET /api/datasets/{id}/images` pagine les images (`page`, `limit` jusqu'à 500, filtres `cluster_id`, `min_rarity`, `max_rarity`, `duplicate_only`).
- `PATCH /api/datasets/{id}/folder` range un dataset dans un dossier (`folder_id`, null pour la racine).
- `DELETE /api/datasets/{id}` supprime un dataset du workspace avec ses images, embeddings, subsets, index et miniatures orphelines ; `DELETE /api/datasets/global?root_path=` retire un dataset publié du registre (auteur seulement, 403 sinon) et du workspace courant.
- `POST /api/datasets/{id}/refresh-gallery` régénère les cinq miniatures de galerie et les statistiques de base d'un dataset global.
- `POST /api/metadata/preview` lit les colonnes et cinq lignes d'exemple d'un fichier CSV ou Excel (`path`).
- `POST /api/convert-format specialise` convertit un fichier `.optional` ou tous les `.optional` d'un dossier via l'adaptateur optionnel (`path`).

## Endpoints d'embeddings et de recalcul

Ces endpoints de `api/datasets.py` calculent ou recalculent l'analyse d'un dataset. Leurs différences sont résumées dans la section *Chemins de recalcul des cartes et des clusters* de [Architecture](architecture.fr.md).

- `POST /api/datasets/{id}/embed?force=false` répond 202 avec `status` `started` ou `already_running`, et lance le pipeline complet dans le pool de tâches. `force=true` réencode toutes les images. 503 si CLIP n'est pas chargé.
- `POST /api/datasets/{id}/recluster` (202) recalcule clusters et rareté : corps `method` (`kmeans` ou `hdbscan`), `n_clusters`, `min_cluster_size`. 400 avant les premiers embeddings.
- `POST /api/datasets/{id}/reduce` (202) recalcule la carte 2D des images non rejetées avec des paramètres explicites : `method` (`umap`, `tsne`, `pca`), `umap_n_neighbors`, `umap_min_dist`, `tsne_perplexity`, `tsne_learning_rate`.
- `POST /api/datasets/{id}/remap` diffuse un recalcul de la carte 2D avec les réglages courants.
- `POST /api/datasets/{id}/rebuild-without-duplicates` diffuse un recalcul de la carte, des clusters KMeans et de la rareté sans les images rejetées, dont les coordonnées sont effacées.
- `POST /api/datasets/{id}/reset-duplicate-filter` efface toutes les décisions garder ou rejeter et diffuse un recalcul sur toutes les images.
- `POST /api/datasets/{id}/exclude-images` marque `image_ids` comme rejetées et renvoie `excluded`.

## Endpoints d'images et de miniatures

Ces endpoints servent le contenu des images ; les miniatures citées dans les autres réponses sont des URL statiques `/thumbs/<md5>.jpg` ou `/gallery-thumbs/<nom>/thumbs/<n>.jpg`.

- `GET /api/datasets/{id}/images/{image_id}/full` renvoie le fichier image original (404 s'il manque sur le disque).
- `GET /api/images/{image_id}/thumb` renvoie la miniature, en la générant et la mettant en cache si besoin.
- `GET /api/datasets/{id}/images/{image_id}/full-path` et `GET /api/images/{image_id}/thumb-path` renvoient `{"native_path": ...}`, le chemin Windows du même fichier via l'hôte de partage (ou `null`). Ils ne servent qu'au protocole `app-image://` de VisionNexus, qui revient à l'endpoint HTTP quand `native_path` vaut `null`.

## Endpoints de carte, de clusters et de recherche

Ces endpoints de `api/explore.py` et `api/filter.py` lisent les résultats du pipeline.

- `GET /api/datasets/{id}/map` renvoie `points` avec `image_id`, `x`, `y`, `cluster_id`, `rarity_score`, `filename`, `thumbnail_url`, `duplicate_group_id` et `metadata`, pour les images qui ont des coordonnées et ne sont pas rejetées. 425 avant les premiers embeddings.
- `GET /api/datasets/{id}/clusters` renvoie par cluster son `count`, son `avg_rarity` et trois images d'exemple, images rejetées exclues.
- `POST /api/datasets/{id}/semantic-search` avec `query`, `top_k` (20 par défaut) et `min_score` optionnel : sans `min_score`, les `top_k` images les plus proches ; avec, toutes les images au-dessus du score (tout l'index est parcouru et `top_k` est ignoré). Chaque résultat a `score`, `rank`, `filename`, `thumbnail_url`, `cluster_id`, `rarity_score`, `umap_x`, `umap_y`.
- `POST /api/search/global` avec `query`, `top_k` (50 par défaut), `min_score` et `dataset_ids` cherche dans l'index global ; la réponse ajoute `dataset_id` et `dataset_name` à chaque résultat, plus `indexed_datasets`, `indexed_vectors` et `dataset_counts`. Avec `min_score`, les résultats sont coupés à `top_k`.
- `POST /api/datasets/filter-by-text` classe les datasets calculés : `queries` (liste, ou `query` en chaîne séparée par des virgules), `threshold` (0.25 par défaut), `mode` (`union` ou `intersection`), `top_thumbs`. Chaque résultat donne `matched_count`, `total_count`, `percent` et `top_images`.

## Endpoints de doublons

Ces endpoints de `api/duplicates.py` trouvent les images quasi identiques et enregistrent les décisions.

- `GET /api/datasets/{id}/duplicates?threshold=0.97` renvoie `groups` (avec `group_id` = id du représentant, `images` avec `similarity_to_representative` et `is_kept`, `max_sim`), `group_count` et `duplicate_count`. Il stocke aussi `duplicate_group_id` sur les images. 425 si l'index n'est pas chargé.
- `PATCH /api/datasets/{id}/duplicates/decision` avec `decisions` (`image_id`, `keep`) fixe `is_duplicate_kept` pour les images de ce dataset ; renvoie `updated`.
- `GET /api/duplicates/global` avec `threshold` (0.97 par défaut), `cross_only` (vrai par défaut), `max_groups` (50) et `max_images_per_group` (24) cherche dans l'index global ; les groupes qui couvrent le plus de datasets viennent en premier, avec `size`, `truncated` et `total_group_count`.
- `PATCH /api/duplicates/global/decision` fixe des décisions sans restriction de dataset.

## Endpoints de subsets et d'export

Ces endpoints de `api/export.py` gèrent les subsets.

- `POST /api/subsets` avec `dataset_id`, `name` et `image_ids` crée un subset à partir des ids qui appartiennent à ce dataset (400 pour une liste vide, 404 si aucun ne correspond) et remplit son dossier de liens.
- `GET /api/subsets?dataset_id=` liste les subsets, les plus récents en premier, chacun avec ses `exports`.
- `POST /api/subsets/{id}/duplicate` copie un subset sous `<nom>_<n>` (`name` optionnel comme base).
- `PATCH /api/subsets/{id}/lock` avec `locked` ; `DELETE /api/subsets/{id}` supprime le subset et son dossier, 409 s'il est verrouillé.
- `POST /api/subsets/{id}/export-to-annotation-app` avec `custom_export_path` optionnel (ignoré quand l'Orchestrateur a lancé l'application) écrit `<base>/<nom du subset>/` et enregistre l'export ; renvoie `export_path`, `export_type`, `image_count`. 409 si ce chemin exact a déjà été exporté.
- `GET /api/subsets/{id}/exports` liste les exports.
- `GET /api/subsets/{id}/duplicates?threshold=0.97` cherche les doublons parmi les seules images du subset ; `POST /api/subsets/{id}/apply-duplicate-filter` retire les images rejetées du subset et renvoie `removed`.

## Endpoints de fusion

Ces endpoints de `api/datasets.py` créent un nouveau dataset à partir d'embeddings existants et diffusent leur progression.

- `POST /api/datasets/merge` avec `source_ids` (au moins deux, chacun avec une carte), `name` et `n_clusters` copie toutes les images calculées et construit index, carte, clusters KMeans et rareté. L'événement `done` porte le nouveau `dataset_id`.
- `POST /api/datasets/merge-filtered` avec `source_ids`, `name`, `queries` (ou `query`), `threshold`, `mode` et `n_clusters` ne garde que les images qui correspondent aux termes, puis construit index, carte et clusters avec la méthode par défaut des réglages. 503 si CLIP n'est pas chargé.

Les datasets fusionnés ont `root_path = merged:<ids>` et ne sont pas épinglés.

## Endpoints de dossiers

Ces endpoints de `api/folders.py` gèrent l'arborescence de dossiers de la Gallery.

- `GET /api/folders` renvoie la liste à plat (`id`, `name`, `parent_id`, `is_global`, `uid`, `added_by`), après avoir matérialisé les dossiers partagés du registre.
- `POST /api/folders` avec `name`, `parent_id` et `is_global` ; un dossier partagé reçoit un `uid` et est écrit dans `folders_registry.json`.
- `PATCH /api/folders/{id}` renomme ou déplace un dossier (400 s'il deviendrait son propre parent).
- `DELETE /api/folders/{id}` supprime un dossier ; ses sous-dossiers et datasets remontent à son parent.

## Endpoints de métadonnées

Ces endpoints de `api/metadata.py` interrogent les métadonnées CSV et Excel associées aux datasets.

- `POST /api/metadata/search` avec `query`, `dataset_ids`, `mode` (`and` ou `or`), `limit` (100 par défaut) et `offset` lance une recherche plein texte ; renvoie `total`, `items` (image, dataset, miniature, cluster, rareté, `metadata`), `dataset_counts` et `indexed_datasets`. Les datasets qui ont des métadonnées mais pas d'index sont indexés à la volée.
- `GET /api/metadata/columns` liste chaque colonne avec les datasets qui la possèdent, et des `groups` de colonnes jugées équivalentes.
- `GET /api/metadata/facets?column=&dataset_ids=&limit=50` renvoie les valeurs distinctes d'une colonne avec leur nombre d'images.
- `POST /api/metadata/suggest-mapping` avec `columns` (et `exclude_dataset_id` optionnel) renvoie `suggested_key_column` et un `mapping` vers les colonnes connues avec un score.
- `POST /api/metadata/reindex?dataset_id=` reconstruit l'index d'un dataset ou de tous.

## Endpoints de paramètres, d'exemples, de documentation et d'application

Ces endpoints configurent le workspace et décrivent l'instance en cours.

- `GET /api/settings` renvoie les paramètres ; `PUT /api/settings` les remplace. Le corps doit être l'objet complet : `workspace_path` et `annotation_app_imports_path` sont obligatoires, et `workspace_path` et `user_name` sont toujours réécrits depuis l'environnement.
- `GET /api/samples/datasets` et `GET /api/samples/datasets/{sample_id}` décrivent les dossiers d'exemple du tutoriel (`path` côté backend, `exists`, `image_count`) ; 404 quand le dossier manque.
- `GET /api/docs?lang=`, `GET /api/docs/{name}?lang=` et `GET /api/docs/assets/{path}` servent les pages de cette documentation à la page d'aide, avec repli sur l'autre langue ; les noms de pages sont limités au manifeste de la suite.
- `GET /health` renvoie `status`, `clip_loaded`, `device`, `jobs` et `job_workers`.
- `GET /api/capabilities` liste les adaptateurs de formats optionnels (`specific_formats`).
- `GET /api/app-mode` renvoie `mode` (`solo` ou `orchestrator`), `subsets_dir`, `annotation_imports_dir` et `workspace`.
- `GET /api/audit?limit=100&action=` renvoie les dernières entrées d'audit (`dataset.delete`, `dataset.delete_global`, `subset.delete`, `subset.lock`, `subset.export`...).
- `GET /api/workspace/users`, `GET /api/workspace/history` et `POST /api/workspace/open` alimentent le badge utilisateur.

## Endpoints d'intégration avec l'Orchestrateur

Ces endpoints de `api/orchestrator.py` (préfixe `/api/orchestrator`) sont appelés par l'Orchestrator App. Les ids priment sur les noms ; un nom ambigu renvoie 409.

- `POST /load-dataset` avec `name`, `root_path`, `n_clusters` (15 par défaut), `wait_for_scan` (vrai par défaut), `wait_timeout_s` (180) et `allow_duplicate` : réutilise ou crée le dataset, attend le scan, l'épingle ; renvoie `dataset_id`, `status`, `image_count`, `root_path` et `duplicate_of`. 504 en cas de délai dépassé.
- `POST /start-embed` avec `dataset_name`, `dataset_id`, `wait_for_ready` (vrai par défaut) et `wait_timeout_s` (1800) : `already_ready` pour un dataset prêt, sinon lance les embeddings et attend ; 500 si le pipeline échoue, 504 en cas de délai dépassé.
- `POST /create-subset` avec `dataset_name`, `dataset_id`, `subset_name`, `query`, `top_k` (80 par défaut), `min_score` et `source_subset_name` : recherche par texte, puis un subset qui remplace tout subset de même nom ; 404 quand rien ne correspond.
- `POST /export-subset` avec `subset_name`, `subset_id`, `dataset_id` et `annotation_imports_path` : remplace le dossier d'export précédent et écrit le nouveau ; renvoie `export_path` et `image_count`.
- `GET /status?dataset_name=` renvoie le statut d'un dataset, ou la liste de tous les datasets sans nom.

## Index des endpoints

<!-- generated:start -->
### datasets

| Method | Path | Summary | Source |
|---|---|---|---|
| POST | `/api/convert-format specialise` | Lit le(s) fichier(s) .optional au chemin indiqué et convertit chaque image en PNG dans un dossier {stem}_to_png/ à côté du fichier source. | `Dataset_Explorer_App/backend/api/datasets.py:2650` |
| GET | `/api/datasets` | `list_datasets()` | `Dataset_Explorer_App/backend/api/datasets.py:1488` |
| POST | `/api/datasets` | `create_dataset()` | `Dataset_Explorer_App/backend/api/datasets.py:594` |
| GET | `/api/datasets/check-path` | `check_duplicate_path()` | `Dataset_Explorer_App/backend/api/datasets.py:1678` |
| POST | `/api/datasets/filter-by-text` | Classe les datasets DÉJÀ EMBEDDÉS par pertinence à une (ou plusieurs) requête(s). | `Dataset_Explorer_App/backend/api/datasets.py:1292` |
| DELETE | `/api/datasets/global` | Supprime un dataset du registre global ET du workspace courant s'il y est présent. Réservé au propriétaire (added_by). | `Dataset_Explorer_App/backend/api/datasets.py:2721` |
| POST | `/api/datasets/merge` | Fusionne plusieurs datasets en un seul sans relancer CLIP. Copie les Image et Embedding records, recalcule FAISS/UMAP/KMeans/rareté. Retourne un flux SSE (même format que /embed). | `Dataset_Explorer_App/backend/api/datasets.py:1083` |
| POST | `/api/datasets/merge-filtered` | Construit un dataset à partir des seules images pertinentes de plusieurs sources (score CLIP > seuil). Copie les Image/Embedding, recalcule FAISS/UMAP/clustering/rareté. Flux SSE (même format que /merge). | `Dataset_Explorer_App/backend/api/datasets.py:1355` |
| DELETE | `/api/datasets/{dataset_id}` | `delete_dataset()` | `Dataset_Explorer_App/backend/api/datasets.py:2836` |
| GET | `/api/datasets/{dataset_id}` | `get_dataset()` | `Dataset_Explorer_App/backend/api/datasets.py:1697` |
| POST | `/api/datasets/{dataset_id}/embed` | Lance le pipeline d'embedding en tâche de fond (non bloquant, poll-driven). | `Dataset_Explorer_App/backend/api/datasets.py:2143` |
| POST | `/api/datasets/{dataset_id}/exclude-images` | Exclut une liste d'images du dataset courant en les marquant comme rejetées. Ces images sont invisibles sur la carte (filtre explore.py) et exclues du rebuild. | `Dataset_Explorer_App/backend/api/datasets.py:2612` |
| PATCH | `/api/datasets/{dataset_id}/folder` | Déplace un dataset dans un dossier (ou à la racine si folder_id=None). | `Dataset_Explorer_App/backend/api/datasets.py:728` |
| GET | `/api/datasets/{dataset_id}/images` | `get_images()` | `Dataset_Explorer_App/backend/api/datasets.py:1830` |
| GET | `/api/datasets/{dataset_id}/images/{image_id}/full` | `get_image_full()` | `Dataset_Explorer_App/backend/api/datasets.py:1898` |
| GET | `/api/datasets/{dataset_id}/images/{image_id}/full-path` | `get_image_full_path()` | `Dataset_Explorer_App/backend/api/datasets.py:1918` |
| POST | `/api/datasets/{dataset_id}/rebuild-without-duplicates` | Recalcule UMAP + KMeans + rareté en excluant les images rejetées (is_duplicate_kept=False). Les rejetées voient leurs coordonnées effacées. | `Dataset_Explorer_App/backend/api/datasets.py:2425` |
| POST | `/api/datasets/{dataset_id}/recluster` | Relance le clustering (KMeans ou HDBSCAN) en tâche de fond, sans recalculer les embeddings CLIP ni l'UMAP. Progression via le poll (recluster_progress/...). | `Dataset_Explorer_App/backend/api/datasets.py:2221` |
| POST | `/api/datasets/{dataset_id}/reduce` | Relance la réduction dimensionnelle 2D (UMAP/t-SNE/PCA) en tâche de fond, sans recalculer les embeddings CLIP ni le clustering. Progression via le poll (reduce_progress/...). | `Dataset_Explorer_App/backend/api/datasets.py:2304` |
| POST | `/api/datasets/{dataset_id}/refresh-gallery` | Régénère les miniatures gallery et les stats de base pour un dataset global. | `Dataset_Explorer_App/backend/api/datasets.py:2687` |
| POST | `/api/datasets/{dataset_id}/remap` | Recalcule la réduction dimensionnelle (UMAP/t-SNE/PCA) en utilisant les embeddings existants. Ne relance pas CLIP. Ne change pas le clustering. | `Dataset_Explorer_App/backend/api/datasets.py:2346` |
| POST | `/api/datasets/{dataset_id}/reset-duplicate-filter` | Efface is_duplicate_kept pour toutes les images, puis recalcule UMAP + KMeans + rareté sur la totalité du dataset. | `Dataset_Explorer_App/backend/api/datasets.py:2527` |
| GET | `/api/datasets/{dataset_id}/stats` | Retourne des statistiques descriptives sur les images du dataset : dimensions moyennes, distribution des formats, taille fichier, mode couleur (via PIL), et 5 thumbnails aléatoires. | `Dataset_Explorer_App/backend/api/datasets.py:1751` |
| GET | `/api/images/{image_id}/thumb` | `get_image_thumb()` | `Dataset_Explorer_App/backend/api/datasets.py:1937` |
| GET | `/api/images/{image_id}/thumb-path` | `get_image_thumb_path()` | `Dataset_Explorer_App/backend/api/datasets.py:1965` |
| POST | `/api/metadata/preview` | Lit les colonnes + quelques lignes d'un CSV/Excel pour le mapping. | `Dataset_Explorer_App/backend/api/datasets.py:579` |

### docs

| Method | Path | Summary | Source |
|---|---|---|---|
| GET | `/api/docs` | Pages du jeu de docs, triees par `order`, avec les langues disponibles. | `Dataset_Explorer_App/backend/api/docs.py:163` |
| GET | `/api/docs/assets/{asset_path:path}` | `get_doc_asset()` | `Dataset_Explorer_App/backend/api/docs.py:187` |
| GET | `/api/docs/{name}` | Une page : frontmatter + corps markdown, avec repli de langue. | `Dataset_Explorer_App/backend/api/docs.py:197` |

### duplicates

| Method | Path | Summary | Source |
|---|---|---|---|
| GET | `/api/datasets/{dataset_id}/duplicates` | `get_duplicates()` | `Dataset_Explorer_App/backend/api/duplicates.py:63` |
| PATCH | `/api/datasets/{dataset_id}/duplicates/decision` | `patch_duplicate_decision()` | `Dataset_Explorer_App/backend/api/duplicates.py:160` |
| GET | `/api/duplicates/global` | Groupes de doublons a travers tous les datasets indexes. | `Dataset_Explorer_App/backend/api/duplicates.py:213` |
| PATCH | `/api/duplicates/global/decision` | `patch_global_duplicate_decision()` | `Dataset_Explorer_App/backend/api/duplicates.py:343` |

### explore

| Method | Path | Summary | Source |
|---|---|---|---|
| GET | `/api/datasets/{dataset_id}/clusters` | `get_clusters()` | `Dataset_Explorer_App/backend/api/explore.py:120` |
| GET | `/api/datasets/{dataset_id}/map` | `get_map()` | `Dataset_Explorer_App/backend/api/explore.py:81` |

### export

| Method | Path | Summary | Source |
|---|---|---|---|
| GET | `/api/subsets` | `list_subsets()` | `Dataset_Explorer_App/backend/api/export.py:188` |
| POST | `/api/subsets` | `create_subset()` | `Dataset_Explorer_App/backend/api/export.py:80` |
| DELETE | `/api/subsets/{subset_id}` | `delete_subset()` | `Dataset_Explorer_App/backend/api/export.py:225` |
| POST | `/api/subsets/{subset_id}/apply-duplicate-filter` | `apply_duplicate_filter()` | `Dataset_Explorer_App/backend/api/export.py:376` |
| POST | `/api/subsets/{subset_id}/duplicate` | Duplique un subset existant (images + liens, pas les exports). Le nom par défaut est "{nom_original}_n" (n auto-incrémenté). Fonctionne même si le subset original a été exporté. | `Dataset_Explorer_App/backend/api/export.py:123` |
| GET | `/api/subsets/{subset_id}/duplicates` | `get_subset_duplicates()` | `Dataset_Explorer_App/backend/api/export.py:429` |
| POST | `/api/subsets/{subset_id}/export-to-annotation-app` | `export_subset()` | `Dataset_Explorer_App/backend/api/export.py:264` |
| GET | `/api/subsets/{subset_id}/exports` | `get_subset_exports()` | `Dataset_Explorer_App/backend/api/export.py:350` |
| PATCH | `/api/subsets/{subset_id}/lock` | Verrouille/déverrouille un subset (protection anti-suppression). | `Dataset_Explorer_App/backend/api/export.py:208` |

### filter

| Method | Path | Summary | Source |
|---|---|---|---|
| POST | `/api/datasets/{dataset_id}/semantic-search` | `do_semantic_search()` | `Dataset_Explorer_App/backend/api/filter.py:46` |
| POST | `/api/search/global` | `do_global_search()` | `Dataset_Explorer_App/backend/api/filter.py:116` |

### folders

| Method | Path | Summary | Source |
|---|---|---|---|
| GET | `/api/folders` | `list_folders()` | `Dataset_Explorer_App/backend/api/folders.py:170` |
| POST | `/api/folders` | `create_folder()` | `Dataset_Explorer_App/backend/api/folders.py:188` |
| DELETE | `/api/folders/{folder_id}` | `delete_folder()` | `Dataset_Explorer_App/backend/api/folders.py:239` |
| PATCH | `/api/folders/{folder_id}` | `update_folder()` | `Dataset_Explorer_App/backend/api/folders.py:215` |

### main

| Method | Path | Summary | Source |
|---|---|---|---|
| GET | `/api/app-mode` | Retourne si l'app est lancee par l'Orchestrateur ou en mode solo. | `Dataset_Explorer_App/backend/main.py:311` |
| GET | `/api/audit` | `get_audit()` | `Dataset_Explorer_App/backend/main.py:220` |
| GET | `/api/capabilities` | `capabilities()` | `Dataset_Explorer_App/backend/main.py:193` |
| GET | `/api/workspace/history` | Retourne l'historique des workspaces (seulement les dossiers encore existants). Chaque entree: {"path": str, "user": str}. | `Dataset_Explorer_App/backend/main.py:279` |
| POST | `/api/workspace/open` | Ouvre un dossier dans l'explorateur de fichiers OS. Si path est fourni, ouvre ce dossier ; sinon ouvre le workspace courant. | `Dataset_Explorer_App/backend/main.py:251` |
| GET | `/api/workspace/users` | `workspace_users()` | `Dataset_Explorer_App/backend/main.py:226` |
| GET | `/health` | `health()` | `Dataset_Explorer_App/backend/main.py:204` |

### metadata

| Method | Path | Summary | Source |
|---|---|---|---|
| GET | `/api/metadata/columns` | `list_columns()` | `Dataset_Explorer_App/backend/api/metadata.py:176` |
| GET | `/api/metadata/facets` | Valeurs distinctes d'une colonne de métadonnées, tous datasets confondus. | `Dataset_Explorer_App/backend/api/metadata.py:215` |
| POST | `/api/metadata/reindex` | `reindex()` | `Dataset_Explorer_App/backend/api/metadata.py:260` |
| POST | `/api/metadata/search` | `search_metadata()` | `Dataset_Explorer_App/backend/api/metadata.py:116` |
| POST | `/api/metadata/suggest-mapping` | `suggest_mapping()` | `Dataset_Explorer_App/backend/api/metadata.py:240` |

### orchestrator

| Method | Path | Summary | Source |
|---|---|---|---|
| POST | `/api/orchestrator/create-subset` | `create_subset_orchestrator()` | `Dataset_Explorer_App/backend/api/orchestrator.py:259` |
| POST | `/api/orchestrator/export-subset` | `export_subset_orchestrator()` | `Dataset_Explorer_App/backend/api/orchestrator.py:366` |
| POST | `/api/orchestrator/load-dataset` | `load_dataset()` | `Dataset_Explorer_App/backend/api/orchestrator.py:83` |
| POST | `/api/orchestrator/start-embed` | `start_embed()` | `Dataset_Explorer_App/backend/api/orchestrator.py:180` |
| GET | `/api/orchestrator/status` | `get_status()` | `Dataset_Explorer_App/backend/api/orchestrator.py:444` |

### samples

| Method | Path | Summary | Source |
|---|---|---|---|
| GET | `/api/samples/datasets` | Liste les datasets d'exemple embarques (chemin absolu cote backend). | `Dataset_Explorer_App/backend/api/samples.py:52` |
| GET | `/api/samples/datasets/{sample_id}` | Detail d'un dataset d'exemple. 404 si le dossier livre est absent. | `Dataset_Explorer_App/backend/api/samples.py:64` |

### settings

| Method | Path | Summary | Source |
|---|---|---|---|
| GET | `/api/settings` | Retourne les paramètres actuels. | `Dataset_Explorer_App/backend/api/settings.py:142` |
| PUT | `/api/settings` | Sauvegarde les paramètres dans le workspace. | `Dataset_Explorer_App/backend/api/settings.py:148` |
<!-- generated:end -->
