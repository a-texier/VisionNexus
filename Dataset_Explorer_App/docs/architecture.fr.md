---
app: explorer
doc_type: architecture
audience: dev
lang: fr
title: Architecture
order: 60
tags: [fastapi, sqlite, faiss, pool de tâches, sse, react, registre global]
sources: [Dataset_Explorer_App/backend/main.py, Dataset_Explorer_App/backend/config.py, Dataset_Explorer_App/backend/db/models.py, Dataset_Explorer_App/backend/db/database.py, Dataset_Explorer_App/backend/api/datasets.py, Dataset_Explorer_App/backend/api/folders.py, Dataset_Explorer_App/backend/api/export.py, Dataset_Explorer_App/backend/api/orchestrator.py, Dataset_Explorer_App/backend/core/job_runner.py, Dataset_Explorer_App/backend/core/indexer.py, Dataset_Explorer_App/backend/core/metadata_index.py, Dataset_Explorer_App/backend/core/subset_manager.py, Dataset_Explorer_App/frontend/src/App.tsx, Dataset_Explorer_App/frontend/src/api/client.ts, Dataset_Explorer_App/frontend/src/hooks/useDataset.ts, Dataset_Explorer_App/frontend/vite.config.ts]
---

# Architecture

## Vue d'ensemble des composants de Dataset Explorer

Dataset Explorer est une application web à deux niveaux : un backend FastAPI qui détient les données, les modèles et les calculs, et un frontend React qui tourne dans un navigateur ou dans la coquille Electron VisionNexus.

```text
Frontend (React 18 + TypeScript + Vite 6 + Tailwind + TanStack Query + Zustand + Plotly)
  |-- HTTP /api (axios, délai 30 s ; plus long pour le Catalogue)  --+
  |-- flux de progression : fetch POST + ReadableStream (format SSE) --+--> proxy Vite --> backend FastAPI
  `-- images : /thumbs, /gallery-thumbs, /api/images/* ; lecture native app-image:// dans VisionNexus

Backend (FastAPI + SQLModel + SQLite, un processus uvicorn par workspace)
  |-- api/     un router par domaine
  |-- core/    logique ML et métier sans FastAPI : CLIP, FAISS, réduction, clustering, tâches
  |-- db/      tables SQLModel et moteur SQLite
  |-- utils/   chemins de partage Windows et adaptateurs de formats optionnels
  `-- stockage : workspace (base, miniatures, index, subsets, paramètres) + dossier de galerie partagé
```

Technologies principales : FastAPI et uvicorn, SQLModel sur SQLAlchemy avec SQLite en mode WAL, PyTorch avec `open_clip` (ViT-B/32), FAISS, `umap-learn`, scikit-learn (t-SNE, PCA, KMeans), `hdbscan`, Pillow et OpenCV, pandas pour les tableaux de métadonnées. Côté frontend : React 18, React Router 6, TanStack Query 5, Zustand 5, `react-plotly.js`, `react-hot-toast` et `marked` pour la documentation intégrée.

L'état partagé entre requêtes vit dans SQLite (persistant) ou dans des singletons de module (modèle CLIP, index FAISS, pool de tâches, dictionnaires de progression). C'est pourquoi un seul processus backend doit servir un workspace.

## Démarrage de l'application backend

`backend/config.py` est évalué en premier : il fixe `HF_HUB_OFFLINE` et `TRANSFORMERS_OFFLINE`, résout le workspace depuis `EXPLORER_WORKSPACE` et crée `thumbs/`, `faiss/`, `subsets/` et `data/dataset_gallery/` dès l'import, car les montages statiques en ont besoin.

Le lifespan de `backend/main.py` ensuite :

1. Crée les tables SQLite (`create_db_and_tables`).
2. Exécute les migrations de colonnes par `ALTER TABLE ... ADD COLUMN` pour les colonnes ajoutées au fil du temps : sur `dataset` la configuration de réduction et de clustering, `folder_id`, le vecteur moyen, la référence d'annotations, la référence de métadonnées et `error_message` ; `subset.locked` ; `image.metadata_json`. Elles doivent passer avant toute requête ORM sur `Dataset`, qui sélectionne toutes les colonnes mappées. Aucune table n'est supprimée.
3. Remet en `pending` les datasets restés en `embedding` après un plantage.
4. Charge CLIP (`clip_embedder.load()`) ; un échec est journalisé et l'application démarre sans le modèle.
5. Recharge en mémoire le fichier d'index FAISS de chaque dataset `ready`.

Les routers sont inclus dans `main.py`, puis deux montages statiques sont déclarés après eux : `/thumbs` sur le dossier `thumbs/` du workspace et `/gallery-thumbs` sur `data/dataset_gallery/`. CORS autorise les origines frontend calculées dans `config.py`.

Endpoints applicatifs de `main.py` : `/health` (état de CLIP, device, tâches actives), `/api/capabilities` (adaptateurs de formats optionnels), `/api/audit` (entrées récentes du journal d'audit), `/api/workspace/users`, `/api/workspace/open`, `/api/workspace/history` et `/api/app-mode` (autonome ou Orchestrateur, avec le dossier d'export).

## Routers et modules core

Les routers sont dans `backend/api/`, un fichier par domaine :

| Router | Domaine |
|---|---|
| `datasets.py` | Création et scan des datasets, liste avec progression, détails, statistiques, images et miniatures, pipeline d'embeddings, recluster, reduce, remap, rebuild et reset des décisions, exclusion, fusions, filtre CLIP de la Gallery, registre global, suppression, conversion format specialise, aperçu de métadonnées |
| `folders.py` | Arborescence de dossiers personnels et partagés |
| `explore.py` | Points de la carte et synthèse des clusters |
| `filter.py` | Recherche par texte dans un dataset et dans l'index global |
| `duplicates.py` | Groupes de doublons par dataset et entre datasets, décisions garder ou rejeter |
| `export.py` | Subsets : création, duplication, verrou, suppression, export, doublons d'un subset |
| `metadata.py` | Recherche dans les métadonnées, colonnes, facettes, suggestions de rapprochement, réindexation |
| `settings.py` | Paramètres du workspace (`settings.json`) |
| `orchestrator.py` | Contrat avec l'Orchestrator App |
| `samples.py` | Dossiers d'exemple du tutoriel |
| `docs.py` | Documentation markdown de la page d'aide intégrée |

Les modules de `backend/core/` ne dépendent pas de FastAPI :

| Module | Rôle |
|---|---|
| `embedder.py` | `clip_embedder` : chargement de CLIP, embeddings d'images et de textes, MD5, miniatures |
| `indexer.py` | `faiss_indexer` : index par dataset, index global, graphe de doublons |
| `reducer.py` | `umap_reducer` : UMAP, t-SNE, PCA avec replis |
| `clusterer.py`, `scorer.py` | `clusterer` : KMeans, HDBSCAN, scores de rareté |
| `semantic_filter.py` | Recherche par texte et traduction position FAISS vers id d'image |
| `job_runner.py` | Pool borné et dédupliqué de tâches de fond |
| `subset_manager.py` | Dossiers de subsets et d'exports, lien ou copie |
| `metadata_loader.py`, `metadata_index.py` | Lecture CSV et Excel, correspondance de clé, rapprochement de colonnes, index FTS5 |
| `annotation_ref.py` | Détection de format et comptage des fichiers `.ver` et YOLO |
| `image_io.py` | Conversion 8 bits des images 16 bits, infrarouges et flottantes |
| `audit.py` | Journal d'audit JSONL |
| `format_registry.py` | Découverte des adaptateurs de formats optionnels dans `backend/utils/` |

## Modèle de données et base

La base est SQLite dans `<workspace>/dataset_explorer.db`, ouverte avec `check_same_thread=False` et, à chaque connexion, `journal_mode=WAL`, `busy_timeout=10000` et `synchronous=NORMAL`, pour que les tâches de fond écrivent pendant que les requêtes lisent. Les modèles sont des classes SQLModel dans `backend/db/models.py`.

| Table | Champs clés |
|---|---|
| `folder` | `name`, `parent_id`, `is_global`, `uid` (identifiant stable d'un dossier partagé), `added_by` |
| `dataset` | `name`, `root_path` (chemin résolu, ou `merged:<ids>`), `status`, `error_message`, `image_count`, `embedded_count`, `n_clusters`, `umap_cached`, `faiss_index_path`, `is_global`, `added_by`, `folder_id`, `cluster_method`, `cluster_params_json`, `reduction_method`, `reduction_params_json`, `reduction_settings_hash`, `mean_embedding_blob`, `annotation_*`, `metadata_path`, `metadata_key_column`, `metadata_columns_json` |
| `image` | `dataset_id`, `file_path`, `filename`, `md5`, `width`, `height`, `file_size_bytes`, `thumbnail_path`, `umap_x`, `umap_y`, `cluster_id`, `rarity_score`, `duplicate_group_id`, `is_duplicate_kept`, `metadata_json` |
| `embedding` | `image_id` (unique), `vector_blob` (512 float32 normalisés), `dim`, `model_name` |
| `cluster_centroid` | `dataset_id`, `cluster_id`, `centroid_blob`, `size` |
| `subset` | `dataset_id`, `name`, `symlink_dir`, `image_count`, `exported_to_annotation_app`, `export_path` (premier export), `locked` |
| `subset_image` | `subset_id`, `image_id` |
| `subset_export` | `subset_id`, `export_path`, `export_type` (`symlink` ou `copy`) |

`is_duplicate_kept` vaut `None` (non décidé), `True` ou `False` (rejeté). `umap_cached` signifie "le pipeline est allé au bout et une carte existe" ; `reduction_settings_hash` est le MD5 des réglages de réduction lors du dernier calcul de carte et pilote `map_method_outdated`. La table virtuelle `image_metadata_fts` (FTS5) est créée à la demande par `metadata_index.py`.

La suppression est une cascade manuelle dans `_delete_dataset_from_session` : index FAISS en mémoire et sur disque, lignes FTS, liens de subsets, embeddings, images, subsets et leurs exports, centroïdes, le dataset, puis les miniatures qu'aucune autre image ne référence. Les dossiers de subsets sur disque ne sont pas supprimés.

## Pipeline d'embeddings

`POST /api/datasets/{id}/embed` passe le statut à `embedding`, prend le verrou mémoire `_embedding_ids` et soumet `_run_embed_pipeline` au pool de tâches ; un second appel pendant le calcul renvoie `already_running`. Le pipeline :

1. Charge les images triées par `Image.id`.
2. Encode, par lots de 64, seulement les images sans embedding (toutes avec `force=true`), en lisant les fichiers originaux avec six threads de décodage en parallèle, et stocke les vecteurs normalisés.
3. Assemble la matrice complète dans l'ordre des ids et construit l'index FAISS (phase `indexing`).
4. Calcule les coordonnées 2D avec les réglages de réduction (phase `umap`) et stocke la configuration appliquée.
5. Lance le clustering des réglages sur la matrice à 512 dimensions, stocke centroïdes et scores de rareté (phases `clustering`, `scoring`).
6. Stocke le vecteur moyen normalisé, passe à `ready`, `umap_cached`, le chemin de l'index et le hash des réglages ; pour un dataset global, ajoute le vecteur moyen et le résumé d'annotations au registre.

La progression est écrite dans `_embed_progress[dataset_id]` et renvoyée par `GET /api/datasets` ; toute exception passe le statut à `error` et le verrou est libéré dans un `finally`.

Le scan (`_scan_dataset`, soumis par `POST /api/datasets`) crée les fiches d'images avec MD5 et dimensions lues dans l'en-tête par lots de 100, passe en `pending`, associe et indexe les lignes de métadonnées, génère cinq miniatures immédiatement (copiées dans la galerie pour un dataset partagé), puis les miniatures restantes avec six threads. Les formats optionnels sont convertis avant le listage.

## Tâches de fond et suivi de progression

Les traitements lourds passent par `core/job_runner.py` : un `ThreadPoolExecutor` de `EXPLORER_JOB_WORKERS` threads (3 par défaut), séparé du threadpool qui sert les endpoints synchrones, avec déduplication par clé (`scan:<id>`, `embed:<id>`, `recluster:<id>`, `reduce:<id>`). `active_jobs()` alimente `/health`.

La progression de ces tâches vit dans des dictionnaires de module de `api/datasets.py` (`_scan_progress_map`, `_embed_progress`, `_thumb_progress`, `_recluster_progress`, `_reduce_progress`) et est fusionnée dans chaque `DatasetSummary` de `GET /api/datasets`. Le hook frontend `useDatasets` interroge cette liste toutes les 2 secondes tant qu'un dataset est en `scanning` ou `embedding` ou a des miniatures, un reclustering ou une réduction en cours. Ce polling ne demande aucune connexion directe au backend, ce qui le fait fonctionner via SSH à travers le proxy Vite.

Cinq opérations transmettent encore leur progression sous forme d'événements `data: {json}` sur une réponse `POST` : `/api/datasets/merge`, `/api/datasets/merge-filtered`, `/{id}/remap`, `/{id}/rebuild-without-duplicates` et `/{id}/reset-duplicate-filter`. `EventSource` ne sait pas envoyer de POST : le client les lit avec `fetch` et un `ReadableStream` (`_startSSE` dans `api/client.ts`), toujours via le proxy de même origine. Le Playground garde leur dernier événement dans des maps de module pour qu'une barre survive à la navigation. Ces générateurs tournent dans la requête, pas dans le pool de tâches.

## Index FAISS et invariant de position

Chaque dataset a un `IndexFlatIP` exact sur ses vecteurs normalisés, enregistré dans `<workspace>/faiss/<id>/index.faiss`. L'index ne stocke aucun id d'image : la position `i` est l'image de rang `i` quand les images du dataset sont triées par `Image.id` croissant au moment de la construction. Chaque consommateur (`semantic_filter.py`, `duplicates.py`, les doublons globaux) reconstruit la liste ordonnée des ids pour traduire les positions.

L'index global (`ensure_global`) concatène les vecteurs de tous les index chargés avec une table `position globale -> (id du dataset, position locale)`. Il est mis en cache par une signature des ids et tailles, invalidé par chaque `build`, `load` et `remove`, jamais persisté, et bascule de `IndexFlatIP` vers `IndexHNSWFlat` au-delà de 200 000 vecteurs. Il sert `POST /api/search/global` et `GET /api/duplicates/global` ; avec un filtre de datasets, la recherche sur-échantillonne cinq fois avant de filtrer.

La détection de doublons cherche les 50 plus proches voisins de chaque vecteur par lots de 256, relie les paires au-dessus du seuil et renvoie les composantes connexes d'au moins deux membres. L'endpoint par dataset écrit aussi `duplicate_group_id` (id du représentant) sur les images.

## Chemins de recalcul des cartes et des clusters

Plusieurs endpoints recalculent une partie de l'analyse ; ils diffèrent par ce qu'ils lisent et stockent :

| Opération | Images utilisées | Réduction | Clustering | Configuration stockée |
|---|---|---|---|---|
| `embed` | toutes | réglages | méthode des réglages | config de réduction et de clustering, hash des réglages |
| `recluster` | toutes celles qui ont un embedding | inchangée | méthode demandée | config de clustering |
| `reduce` | non rejetées | paramètres demandés | inchangé | config de réduction, hash des réglages courants |
| `remap` | non rejetées | réglages | inchangé | config de réduction, hash des réglages |
| `rebuild-without-duplicates` | non rejetées ; les rejetées perdent coordonnées, cluster et rareté | réglages | la méthode propre au dataset (KMeans avec `n_clusters`, ou HDBSCAN) | hash des réglages seulement |
| `reset-duplicate-filter` | toutes, décisions effacées | réglages | la méthode propre au dataset (KMeans avec `n_clusters`, ou HDBSCAN) | aucune |
| `merge` | toutes les images calculées des sources | réglages | méthode des réglages | aucune |
| `merge-filtered` | images au-dessus du seuil CLIP | réglages | méthode des réglages | config de réduction et de clustering, hash des réglages |

Conséquences à garder en tête : `reduce` stocke le hash des réglages plutôt que celui des paramètres utilisés, et `recluster` et `rebuild` ne traitent pas les images rejetées de la même façon. L'endpoint de carte, les recherches par texte (dataset et Catalogue) et l'export d'un subset écartent toujours les images rejetées : l'index de similarité les contient encore, une recherche lui demande donc quelques résultats de plus et les filtre.

## Galerie globale et dossiers partagés

La galerie globale repose sur des fichiers pour survivre aux changements de workspace et être visible de tous les workspaces de l'installation : `data/dataset_gallery/registry.json` (datasets) et `folders_registry.json` (dossiers partagés), dans le dossier de l'application. Les deux sont écrits de façon atomique (fichier temporaire puis `replace`) car la liste des datasets est interrogée toutes les 2 secondes.

`GET /api/datasets` fusionne les datasets du workspace avec les entrées du registre qui n'ont pas de copie globale dans le workspace ; celles-ci sont renvoyées avec `id = -1` et `in_workspace = false`. Pour les datasets globaux du workspace en `ready` ou `error`, les miniatures de galerie et statistiques de base manquantes sont régénérées pendant le listage. Le dossier de galerie d'un dataset doit être un vrai dossier : un ancien lien symbolique à cet endroit est supprimé avant la copie des miniatures.

La propriété est le champ `added_by` (le `EXPLORER_USER` de l'auteur de la publication). `DELETE /api/datasets/global` la vérifie, retire l'entrée du registre et le dossier de galerie, et ne supprime le dataset que du workspace courant.

Les dossiers partagés portent un `uid` stable. `sync_shared_folders`, appelé par les listes de dossiers et de datasets, matérialise dans la base du workspace les dossiers du registre qui y manquent, parents d'abord. Un dataset partagé enregistre l'`uid` de son dossier dans le registre pour qu'à l'import il soit rangé dans le même dossier.

## Subsets, exports et liens

Un subset est d'abord créé en base, puis son dossier `<workspace>/subsets/<nom>/` est rempli par `create_subset_symlinks` ; un échec de lien est journalisé et laisse `symlink_dir` vide. `_make_symlink` lit `use_symlinks` dans les réglages à chaque appel : un lien symbolique relatif, puis absolu, ou `shutil.copy2` quand les copies sont choisies. Les liens portent le nom du fichier : des noms identiques s'écrasent.

`export_to_annotation_app` écrit `<base>/<nom du subset>/`, où la base est le chemin personnalisé de la requête (mode autonome seulement), sinon le réglage `annotation_app_imports_path` (initialement `ANNOTATION_APP_IMPORTS`). Les images marquées comme rejetées ne sont jamais copiées. L'endpoint refuse ensuite (409) un second enregistrement d'export au même chemin et enregistre le type d'export d'après les réglages courants.

L'endpoint des doublons d'un subset calcule directement en NumPy la matrice de similarité des embeddings du subset (sans FAISS), ce qui convient à des subsets de quelques milliers d'images. `apply-duplicate-filter` retire de la base et du dossier les liens des images rejetées.

## Tableaux de métadonnées et index FTS5

Un tableau de métadonnées est associé à la création du dataset : `metadata_loader.build_key_map` lit le fichier avec pandas (détection du séparateur et de l'encodage pour les fichiers texte), indexe chaque ligne sous la valeur de clé, son nom de base et son nom sans extension, et `match_image` retrouve la ligne de chaque nom d'image. La ligne est stockée en JSON dans `image.metadata_json` et la liste des colonnes dans `dataset.metadata_columns_json`.

`metadata_index.py` tient une table FTS5 autonome `image_metadata_fts(content, image_id, dataset_id)` où `content` concatène le nom de fichier et les paires `colonne valeur`, pour que noms de colonnes et valeurs soient cherchables. La saisie est découpée en tokens, chaque token entre guillemets, le dernier avec un préfixe `*`, joints par `AND` ou `OR`. Les facettes utilisent `json_extract` sur `metadata_json` pour des comptages exacts. L'endpoint de recherche indexe à la volée tout dataset qui a des métadonnées mais aucune ligne FTS. Les suggestions de rapprochement de colonnes combinent une forme canonique, `difflib` et une règle d'inclusion ; elles ne sont jamais appliquées automatiquement.

## Images, miniatures et chemins natifs

Les miniatures sont des JPEG de 256 pixels nommés `<md5>.jpg` dans le workspace, servis statiquement sous `/thumbs`. `generate_thumbnail` utilise `PIL.Image.draft` pour un décodage JPEG rapide et la conversion 3 sigma de `image_io.py` pour les fichiers à grande profondeur. `GET /api/images/{id}/thumb` génère à la demande une miniature manquante.

Les embeddings lisent toujours `Image.file_path`, jamais une miniature. `image_io.load_pil_rgb` lit via OpenCV (`IMREAD_UNCHANGED`) quand il est disponible, avec un repli PIL.

Dans VisionNexus, `utils/nativeImage.ts` réécrit les URL d'images coûteuses (miniature à la demande, pleine résolution) vers le protocole `app-image://` de la coquille, qui demande aux endpoints jumeaux `.../thumb-path` et `.../full-path` un chemin natif et lit le fichier directement sur le partage Windows ; l'endpoint HTTP reste le repli. `utils/native_share.py` traduit les chemins serveur en chemins UNC avec l'hôte de partage configuré, et les chemins UNC saisis par l'utilisateur en chemins serveur.

## Intégration avec l'Orchestrateur

`api/orchestrator.py` expose le contrat utilisé par l'Orchestrator App ; il ne change pas le comportement autonome.

- `load-dataset` réutilise le premier dataset de même chemin résolu (sauf `allow_duplicate`), sinon appelle `create_dataset` avec `allow_duplicate=True`, attend la fin du scan si demandé, et épingle le dataset dans les réglages.
- `start-embed` renvoie `already_ready` pour un dataset prêt, sinon déclenche `/embed` sur son propre port avec `httpx` et attend `ready` ou `error` (délai de 1800 s par défaut).
- `create-subset` lance une recherche par texte (Top-K ou seuil), éventuellement restreinte à un subset source, remplace un subset de même nom et crée les liens.
- `export-subset` supprime un dossier d'export précédent de même nom, puis écrit l'export dans le chemin donné ou `ANNOTATION_APP_IMPORTS`. Il ne crée pas d'enregistrement `subset_export`.
- `status` renvoie le statut d'un dataset par son nom.

Les ids priment partout sur les noms, car les noms de datasets et de subsets ne sont pas uniques ; un nom ambigu renvoie 409. Quand `LAUNCHED_BY_ORCHESTRATOR` est définie, l'endpoint d'export normal ignore les chemins personnalisés.

## Structure et état du frontend

Le frontend est une application monopage (`frontend/src/App.tsx`) avec une barre latérale et neuf routes : `/` (Gallery), `/catalog`, `/playground`, `/datasets/:id/map`, `/datasets/:id/search`, `/datasets/:id/duplicates`, `/subsets`, `/help` et `/settings`.

- L'état serveur passe par TanStack Query (`hooks/useDataset.ts`, clés `datasets`, `dataset`, `dataset-map`, `dataset-clusters`, `subsets`...), avec le polling de 2 secondes de la liste des datasets décrit plus haut.
- La sélection d'images est un store Zustand global (`useSelectionStore` dans `hooks/useSubset.ts`), partagé par la carte, la page de recherche et la page Subsets ; le Catalogue garde sa propre sélection locale.
- Le client API (`api/client.ts`) n'utilise que des URL relatives : tout passe par le proxy Vite.
- Les textes sont en français dans le code et traduits à l'affichage par `i18n/translate.ts` (`t()`) ; la langue vient du `?lang=` fourni par VisionNexus, puis du stockage du navigateur, puis des paramètres du workspace.
- Le thème est appliqué par `ThemeProvider` sous forme d'un élément de style généré à partir des réglages.
- La page d'aide affiche les fichiers markdown de `docs/` servis par `/api/docs` (`components/docs/`), avec des ancres de titres `h-<n>` communes avec le visualiseur de documentation de la suite.
- Le tutoriel interactif utilise le moteur générique de visite de `components/tour/` et le script `components/help/datasetTourSteps.ts` ; son état est stocké par VisionNexus, avec les paramètres du workspace en repli.

## Invariants à ne pas casser

- La position FAISS `i` est l'image de rang `i` triée par `Image.id` à la construction. Triez toujours par `Image.id` pour construire un index ou lire ses résultats ; reconstruisez l'index (lancez `/embed`) après ajout d'images.
- Les embeddings sont en float32, 512 valeurs, normalisés : la similarité cosinus est égale au produit scalaire, et `IndexFlatIP` s'appuie dessus. Gardez `CLIP_MODEL = "ViT-B-32"` pour rester compatible avec les vecteurs stockés.
- Les embeddings sont calculés depuis le fichier original, jamais depuis une miniature.
- Le clustering tourne sur les embeddings à 512 dimensions, jamais sur les coordonnées 2D ; réduction et clustering restent des opérations indépendantes.
- Les tâches lourdes passent par `submit_job`, pas par les `BackgroundTasks` de FastAPI, pour être bornées et dédupliquées.
- Les migrations de colonnes du lifespan passent avant toute requête ORM sur `Dataset` ; ajoutez ensemble une nouvelle colonne au modèle et à la liste de migrations.
- Les routes à segment fixe (`/datasets/merge`, `/datasets/filter-by-text`, `/datasets/check-path`, `/datasets/global`) sont déclarées avant `/datasets/{dataset_id}`.
- Les montages statiques sont déclarés après les routers ; le dossier de galerie d'un dataset est un vrai dossier, jamais un lien.
- Les écritures de `registry.json` et `folders_registry.json` restent atomiques.
- L'écriture d'audit ne lève jamais : un échec d'audit ne doit pas faire échouer l'opération auditée.
- `POST /api/datasets` répond 409 pour un chemin connu sauf si `allow_duplicate` est vrai ; l'Orchestrateur arbitre lui-même les doublons.
- Un subset verrouillé est refusé par `DELETE /api/subsets/{id}` côté serveur.

## Notes de performance

- Les scans ne lisent que l'en-tête des fichiers et leur MD5 ; les miniatures viennent ensuite avec six threads, et le décodage des images avant CLIP utilise aussi six threads, car les partages réseau sont limités par les entrées-sorties.
- Les lectures d'embeddings se font en une requête par tranche de 900 ids (limite de paramètres SQLite) plutôt qu'une requête par image.
- `GET /api/datasets` agrège les nombres d'images rejetées en une requête ; il n'est interrogé toutes les 2 secondes que pendant un traitement.
- L'index global n'est reconstruit que si la signature des index chargés change ; au-delà de 200 000 vecteurs il utilise HNSW.
- `GET /api/datasets/{id}/images` pagine en SQL (500 images par page au plus).
- UMAP sur des dizaines de milliers d'images et HDBSCAN en 512 dimensions peuvent prendre plusieurs minutes ; ils tournent dans le pool de tâches sans bloquer les requêtes.
- Le build de production du frontend est un seul gros bundle (Plotly) ; aucun découpage du code n'a été fait.
