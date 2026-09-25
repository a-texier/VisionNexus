---
app: explorer
doc_type: code-map
audience: dev
lang: fr
title: Carte du code
order: 80
tags: [code, modules, backend, frontend, tests, traductions]
sources: [Dataset_Explorer_App/backend/main.py, Dataset_Explorer_App/backend/config.py, Dataset_Explorer_App/backend/api/datasets.py, Dataset_Explorer_App/backend/core/embedder.py, Dataset_Explorer_App/frontend/src/App.tsx, Dataset_Explorer_App/frontend/src/api/client.ts, Dataset_Explorer_App/frontend/src/i18n/translate.ts, Dataset_Explorer_App/backend/tests/conftest.py, Dataset_Explorer_App/pytest.ini]
---

# Carte du code

## Par où commencer la lecture du backend

Le backend de Dataset Explorer vit dans `Dataset_Explorer_App/backend/` et suit une organisation en trois couches : routers, logique core, base de données.

1. `config.py` : tous les chemins et constantes (workspace, dossier de galerie, modèle et poids CLIP, taille de lot, extensions supportées, ports et CORS). À lire en premier ; il est évalué avant tout le reste et crée les dossiers du workspace.
2. `main.py` : le lifespan (migrations, reprise après plantage, chargement de CLIP et de FAISS), la liste des routers, les montages statiques et les petits endpoints applicatifs.
3. `db/models.py` et `db/database.py` : les tables et le moteur SQLite avec ses pragmas.
4. `api/datasets.py` : le cœur de l'application. Sa première partie contient les helpers (registre global, lecture des réglages, chargement des embeddings, `_apply_clustering`), puis les schémas de requête, les dictionnaires de progression en mémoire, et les endpoints dans l'ordre scan, fusions, filtre CLIP, liste, détails, images, embeddings, recluster, reduce, remap, rebuild, reset, exclusion, conversion, galerie et suppression.
5. `core/` : un module par algorithme, chacun avec un singleton de module (`clip_embedder`, `faiss_indexer`, `umap_reducer`, `clusterer`).

L'architecture et ses invariants sont décrits dans [Architecture](architecture.fr.md) ; les endpoints dans [Référence API](api-reference.fr.md).

## Par où commencer la lecture du frontend

Le frontend de Dataset Explorer vit dans `Dataset_Explorer_App/frontend/src/`.

1. `App.tsx` : la barre latérale (`NAV_ITEMS`), les routes et le lancement du tutoriel.
2. `api/client.ts` : tous les appels au backend, groupés par domaine (`datasetsAPI`, `foldersAPI`, `subsetsAPI`, `catalogAPI`, `metadataAPI`, `settingsAPI`, `docsAPI`...), et `_startSSE` pour les opérations diffusées. `types/api.ts` contient les types des réponses.
3. `hooks/useDataset.ts` (hooks TanStack Query et règle de polling) et `hooks/useSubset.ts` (store de sélection global).
4. `pages/` : un fichier par route. `Gallery.tsx` et `Dashboard.tsx` (le Playground) sont les plus gros ; `DatasetMap.tsx` utilise `components/ScatterPlot.tsx` et `components/FilterBar.tsx`.
5. `components/` : interface partagée (fenêtre d'image, dialogue de confirmation, badge utilisateur, thème, fenêtre des doublons d'un subset), le moteur de visite dans `tour/`, le script du tutoriel dans `help/` et le rendu markdown dans `docs/`.

## Où modifier le pipeline d'embeddings ou le modèle CLIP

Le pipeline d'embeddings de Dataset Explorer est réparti entre l'endpoint et l'enveloppe du modèle.

- Étapes du pipeline, encodage incrémental, phases de progression et champs finaux du dataset : `_run_embed_pipeline` et `start_embedding` dans `backend/api/datasets.py`. La taille de lot du pipeline y est écrite (64) ; le `BATCH_SIZE` de `config.py` n'est que la valeur par défaut de `embed_images`.
- Chargement du modèle, encodage d'images et de textes, décodage parallèle (`IO_WORKERS`), miniatures : `backend/core/embedder.py`.
- Résolution des poids et mode hors ligne : `CLIP_MODEL`, `CLIP_PRETRAINED`, `CLIP_WEIGHTS` et les valeurs par défaut de `HF_HUB_OFFLINE` dans `backend/config.py`.
- Lecture des images 16 bits et infrarouges : `backend/core/image_io.py`.
- Scan (listage des fichiers, MD5, en-têtes, miniatures, association des métadonnées) : `_scan_dataset` et `_generate_remaining_thumbnails` dans `backend/api/datasets.py`.

Changer le modèle CLIP ou sa dimension casse la compatibilité avec les embeddings et index FAISS stockés : mettez à jour `EMBED_DIM`, les formes de repli (`np.zeros((0, 512))` dans `_load_dataset_embeddings`), et réencodez avec `force=true`.

## Où modifier la carte, le clustering et la rareté

Ces algorithmes sont isolés dans `backend/core/` et appelés depuis plusieurs endpoints.

- Méthodes de réduction 2D, replis et paramètres par défaut : `backend/core/reducer.py`.
- KMeans, HDBSCAN et rareté : `backend/core/clusterer.py`.
- Application d'un clustering à un dataset (labels, centroïdes, rareté, configuration stockée) : `_apply_clustering` dans `backend/api/datasets.py`. Attention, `rebuild_without_duplicates`, `reset_duplicate_filter` et `merge_datasets` appellent encore directement `clusterer.kmeans` au lieu de ce helper.
- Lecture des réglages de réduction et de clustering, et hash de carte obsolète : `_load_reduction_settings_full`, `_load_cluster_settings` et `_compute_reduction_hash` dans le même fichier.
- Points de la carte et synthèses de clusters envoyés au frontend : `backend/api/explore.py`.
- Affichage de la carte, couleurs et légendes : `frontend/src/components/ScatterPlot.tsx` ; filtres : `components/FilterBar.tsx` ; panneaux et sélection : `pages/DatasetMap.tsx` ; panneaux équivalents du Playground : `pages/Dashboard.tsx`.

## Où modifier la détection de doublons et les décisions

La logique des doublons a trois points d'entrée qui partagent un algorithme de graphe.

- Graphe de voisins et composantes connexes : `_build_adjacency` et `_connected_components` dans `backend/core/indexer.py` (50 voisins, lots de 256).
- Groupes et décisions par dataset : `backend/api/duplicates.py` (`get_duplicates`, `patch_duplicate_decision`) ; groupes entre datasets : `get_global_duplicates` dans le même fichier.
- Groupes par subset (NumPy, sans FAISS) et retrait des images rejetées : `get_subset_duplicates` et `apply_duplicate_filter` dans `backend/api/export.py`.
- Exclusion de la carte, rebuild et reset : `exclude_images`, `rebuild_without_duplicates`, `reset_duplicate_filter` dans `backend/api/datasets.py`.
- Interfaces : `pages/DuplicateExplorer.tsx`, `components/SubsetDuplicatesModal.tsx` (textes français pas encore traduits) et le `DuplicatesTab` de `pages/Catalog.tsx`.

Pour faire disparaître les images rejetées des résultats de recherche ou des exports, filtrez `is_duplicate_kept is False` dans `core/semantic_filter.py` et dans `export_subset` de `api/export.py`.

## Où modifier les subsets, les liens et les exports

Les subsets et les exports sont gérés par un router et un module d'aide.

- Stratégie lien ou copie, dossiers de subsets et d'exports : `backend/core/subset_manager.py` (`_make_symlink` lit `use_symlinks` à chaque appel).
- Endpoints de subsets et enregistrements d'export : `backend/api/export.py`.
- Dossier d'export par défaut : `ANNOTATION_APP_IMPORTS` dans `backend/config.py` ; le réglage `annotation_app_imports_path` devrait être lu dans `export_subset` (et renvoyé par `/api/app-mode`) pour prendre effet.
- Création et export de subset par l'Orchestrateur : `backend/api/orchestrator.py`.
- Interface : `pages/SubsetManager.tsx` ; la création de subset depuis les autres pages est dans `pages/DatasetMap.tsx`, `pages/SemanticSearch.tsx` et la `SelectionBar` de `pages/Catalog.tsx`.

## Où modifier la Gallery, le registre global et les dossiers

La Gallery combine les données du workspace et des fichiers partagés.

- Lecture et écriture atomique du registre, entrées du registre, miniatures de galerie et statistiques de base : les helpers en tête de `backend/api/datasets.py` (`_load_global_registry`, `_save_global_registry`, `_upsert_global_registry`, `_copy_gallery_thumbnails`, `_compute_basic_gallery_stats`) et la fusion workspace plus registre dans `list_datasets`.
- Suppression globale et propriété : `delete_global_registry_entry` dans le même fichier.
- Arborescence de dossiers et synchronisation des dossiers partagés : `backend/api/folders.py`.
- Chemins des fichiers partagés : `DATASET_GALLERY_DIR` et `GLOBAL_REGISTRY_FILE` dans `backend/config.py`, `FOLDERS_REGISTRY_FILE` dans `api/folders.py`.
- Interface : `pages/Gallery.tsx` (formulaire d'ajout, filtre CLIP et fusion filtrée, sections, arborescence de dossiers, cartes et panneau de détails).

## Où modifier les métadonnées et le Catalogue

Les fonctions de métadonnées et le Catalogue s'appuient sur trois modules backend. Le Catalogue n'a pas d'endpoint propre : il réutilise la recherche globale, les doublons globaux et les routes de métadonnées.

- Lecture des fichiers, correspondance de clé et suggestions de colonnes : `backend/core/metadata_loader.py`.
- Table FTS5, construction des requêtes et facettes : `backend/core/metadata_index.py`.
- Endpoints de métadonnées : `backend/api/metadata.py` ; endpoint d'aperçu : `metadata_preview` dans `api/datasets.py`.
- Index global et recherche entre datasets : `ensure_global`, `search_global` et `find_duplicates_global` dans `backend/core/indexer.py`, `semantic_search_global` dans `core/semantic_filter.py`, `do_global_search` dans `api/filter.py`.
- Interface : `pages/Catalog.tsx` (trois onglets, `DatasetPicker`, `ResultCard` et `SelectionBar` partagés), et les champs de métadonnées du formulaire d'ajout dans `pages/Gallery.tsx` (`handleAnalyzeMeta`).

## Où ajouter un endpoint ou un réglage

Ajouter un endpoint :

1. Ajoutez la route au router de son domaine dans `backend/api/`, ou créez un router et incluez-le dans `backend/main.py`. Déclarez les routes à segment fixe sous `/datasets/` avant `/datasets/{dataset_id}`.
2. Un traitement long passe par `submit_job` (`core/job_runner.py`) avec une clé par dataset, et publie sa progression dans un dictionnaire renvoyé par `list_datasets`, plutôt que dans un nouveau flux.
3. Ajoutez la fonction dans `frontend/src/api/client.ts` et le type de réponse dans `frontend/src/types/api.ts`.
4. Régénérez les tableaux d'endpoints de [Référence API](api-reference.fr.md) avec `python tools/docs/gen_api_docs.py --app explorer --static` et décrivez l'endpoint dans la prose.

Ajouter un réglage :

1. Ajoutez le champ avec sa valeur par défaut à `AppSettings` dans `backend/api/settings.py` ; les anciens `settings.json` sont complétés avec les valeurs par défaut.
2. Lisez-le là où il sert avec `load_settings()` (relu à chaque appel, sans redémarrage).
3. Ajoutez la commande dans `pages/SettingsPage.tsx` et le champ à `AppSettings` dans `types/api.ts`. `PUT /api/settings` remplace l'objet entier : envoyez toujours les réglages complets.
4. Documentez-le dans le tableau des réglages de [Configuration](configuration.fr.md).

Une nouvelle colonne de base doit être ajoutée à la fois au modèle dans `db/models.py` et à la liste de migrations du lifespan dans `main.py`.

## Où modifier l'aide, le tutoriel et les traductions

- La page d'aide affiche les fichiers markdown de `Dataset_Explorer_App/docs/` : pour changer la documentation, modifiez les pages `.md` et `.fr.md`, jamais le code de la page. Les règles sont dans `tools/docs/DOC_STYLE.md` ; vérifiez avec `python tools/docs/lint_docs.py --app explorer`.
- Page d'aide et navigation : `frontend/src/pages/HelpPage.tsx` ; rendu markdown, ancres de titres et réécriture des liens : `components/docs/markdown.ts` et `MarkdownDoc.tsx` ; servi par `backend/api/docs.py` (tests dans `backend/tests/test_docs_router.py`).
- Script du tutoriel : `components/help/datasetTourSteps.ts` (les cibles sont des attributs `data-tour` dans les pages) ; moteur générique : `components/tour/` ; état : `utils/tutorialState.ts` ; dossier d'exemple : `backend/api/samples.py`.
- Traductions : le texte français est écrit dans le code et enveloppé dans `t()` ; ajoutez sa version anglaise dans `EXACT_EN` de `frontend/src/i18n/translate.ts`. Les textes non enveloppés (barre de filtres de la carte, légendes, fenêtre des doublons d'un subset, fenêtre d'image, noms de thèmes) restent en français.
- L'aide contextuelle courte reste dans le code : infobulles (`title`) et explications intégrées à chaque page.

## Tests et outils de débogage

Les tests backend sont dans `backend/tests/` et se lancent depuis `Dataset_Explorer_App/` (configuration dans `pytest.ini`, marqueurs `unit`, `integration`, `multiuser`, `slow`) :

```bash
python -m pytest backend/tests -m "not integration"
python -m pytest backend/tests/test_docs_router.py
```

`backend/tests/conftest.py` pointe `EXPLORER_WORKSPACE` vers un dossier temporaire avant tout import de `backend.config`, pour que les tests ne touchent jamais un vrai workspace ; la fixture `api_client` démarre l'application complète (CLIP compris). `TEST_DATASET_DIR` fournit un dossier de vraies images aux tests qui en ont besoin.

Les tests d'intégration multi-utilisateurs démarrent plusieurs backends à la fois et vérifient l'isolation des workspaces, le partage des datasets globaux et l'accès concurrent : `python backend/tests/integration/run_tests.py` (options `--fast`, `--keep-ws`, `--dataset <dossier>` ; variables `MULTIUSER_N_USERS`, `MULTIUSER_BASE_PORT`, `MULTIUSER_TIMEOUT`, `MULTIUSER_KEEP_WS`). `python backend/tests/smoke_test.py` est une vérification de bout en bout autonome : il démarre l'application sur un workspace temporaire, appelle les principaux endpoints de lecture, scanne un dataset temporaire puis le supprime.

Points d'entrée utiles pour déboguer : `GET /health` (état de CLIP et tâches actives), `GET /api/audit` (qui a supprimé, verrouillé ou exporté quoi), la documentation FastAPI sur `/docs` au port du backend, la base SQLite `dataset_explorer.db` (lisible avec tout client SQLite pendant que l'application tourne, grâce au WAL), et le journal du backend, qui trace chaque scan, phase de pipeline, migration et rechargement d'index.

## Carte des modules

<!-- generated:start -->
### backend

| File | Description | Exports |
|---|---|---|
| `config.py` |  |  |
| `main.py` |  | `lifespan`, `capabilities`, `health`, `get_audit`, `workspace_users`, `workspace_open`, `workspace_history`, `get_app_mode` |

### backend/api

| File | Description | Exports |
|---|---|---|
| `datasets.py` |  | `DatasetCreate`, `DatasetSummary`, `ImageSummary`, `ImagePage`, `ReclusterRequest`, `ReduceRequest`, `ExcludeImagesRequest`, `MoveDatasetRequest`, `MergeRequest`, `MetadataPreviewRequest`, `metadata_preview`, `create_dataset` (+27) |
| `docs.py` |  | `parse_frontmatter`, `load_doc_set`, `doc_path`, `read_doc`, `safe_asset_path`, `list_docs`, `get_doc_asset`, `get_doc` |
| `duplicates.py` |  | `DuplicateImageInfo`, `DuplicateGroup`, `DuplicatesResponse`, `Decision`, `DecisionRequest`, `get_duplicates`, `patch_duplicate_decision`, `GlobalDuplicateImage`, `GlobalDuplicateGroup`, `GlobalDuplicatesResponse`, `get_global_duplicates`, `patch_global_duplicate_decision` |
| `explore.py` |  | `MapPoint`, `MapData`, `ClusterSample`, `ClusterInfo`, `ClusterData`, `get_map`, `get_clusters` |
| `export.py` |  | `SubsetCreate`, `DuplicateSubsetRequest`, `ExportToAnnotationRequest`, `SubsetExportInfo`, `SubsetSummary`, `create_subset`, `duplicate_subset`, `list_subsets`, `SubsetLockRequest`, `set_subset_lock`, `delete_subset`, `export_subset` (+3) |
| `filter.py` |  | `SearchRequest`, `SearchResult`, `SearchResponse`, `do_semantic_search`, `GlobalSearchRequest`, `GlobalSearchResult`, `GlobalSearchResponse`, `do_global_search` |
| `folders.py` |  | `load_folders_registry`, `sync_shared_folders`, `FolderCreate`, `FolderUpdate`, `FolderOut`, `list_folders`, `create_folder`, `update_folder`, `delete_folder` |
| `metadata.py` |  | `MetadataSearchRequest`, `MetadataHit`, `MetadataSearchResponse`, `ColumnInfo`, `ColumnsResponse`, `MappingRequest`, `search_metadata`, `list_columns`, `get_facets`, `suggest_mapping`, `reindex` |
| `orchestrator.py` |  | `LoadDatasetRequest`, `StartEmbedRequest`, `CreateSubsetRequest`, `ExportSubsetRequest`, `load_dataset`, `start_embed`, `create_subset_orchestrator`, `export_subset_orchestrator`, `get_status` |
| `samples.py` |  | `SampleDataset`, `list_sample_datasets`, `get_sample_dataset` |
| `settings.py` |  | `AppSettings`, `load_settings`, `get_settings`, `update_settings` |

### backend/core

| File | Description | Exports |
|---|---|---|
| `annotation_ref.py` |  | `describe_annotations` |
| `audit.py` |  | `record`, `read_recent` |
| `clusterer.py` |  | `Clusterer` |
| `embedder.py` |  | `CLIPEmbedder` |
| `format_registry.py` | Discovery for optional dataset format adapters. | `available_formats`, `get_format_for_filename`, `invoke_for_filename`, `supports_filename` |
| `image_io.py` |  | `to_8bit_3sigma`, `load_pil_rgb`, `is_high_bitdepth` |
| `indexer.py` |  | `FAISSIndexer` |
| `job_runner.py` |  | `submit_job`, `active_jobs`, `is_active`, `wait_idle`, `shutdown` |
| `metadata_index.py` |  | `ensure_fts`, `fts_available`, `reindex_dataset`, `delete_dataset`, `indexed_dataset_ids`, `build_match_query`, `search`, `facet_values` |
| `metadata_loader.py` |  | `preview`, `build_key_map`, `match_image`, `suggest_key_column`, `suggest_column_mapping` |
| `reducer.py` |  | `UMAPReducer` |
| `scorer.py` |  |  |
| `semantic_filter.py` |  | `ordered_image_ids`, `semantic_search`, `semantic_search_global` |
| `subset_manager.py` |  | `create_subset_symlinks`, `delete_subset_dir`, `remove_from_subset_dir`, `export_to_annotation_app` |

### backend/db

| File | Description | Exports |
|---|---|---|
| `database.py` |  | `create_db_and_tables`, `get_session` |
| `models.py` |  | `Folder`, `Dataset`, `Image`, `Embedding`, `ClusterCentroid`, `Subset`, `SubsetImage`, `SubsetExport` |

### backend/utils

| File | Description | Exports |
|---|---|---|
| `native_share.py` |  | `to_native_share_path`, `from_native_share_path` |
| `format specialise.py` |  | `OtiHeader`, `read_format specialise`, `convert_format specialise_to_png`, `find_format specialise_files`, `convert_path` |

### frontend/src

| File | Description | Exports |
|---|---|---|
| `App.tsx` | Routing principal + layout avec sidebar. | `App` |
| `main.tsx` |  |  |

### frontend/src/api

| File | Description | Exports |
|---|---|---|
| `client.ts` | Client API typé - axios + fetch SSE. | `datasetsAPI`, `foldersAPI`, `subsetsAPI`, `catalogAPI`, `metadataAPI`, `auditAPI`, `samplesAPI`, `settingsAPI`, `docsAPI`, `appModeAPI`, `startRemap`, `startRebuildWithoutDuplicates` (+3) |

### frontend/src/components

| File | Description | Exports |
|---|---|---|
| `ConfirmDialog.tsx` | Confirmation d'action destructive, au style de l'application. | `ConfirmDialog` |
| `FilterBar.tsx` | Barre de filtres : mode couleur, cluster, rareté. | `FilterBar` |
| `ImageModal.tsx` | Modal plein écran pour inspecter une image en détail. | `ImageModal` |
| `LanguageToggle.tsx` |  | `LanguageToggle` |
| `ScatterPlot.tsx` | Scatter Plotly avec lasso select + coloration configurable + légende. | `CLUSTER_COLORS` |
| `SubsetDuplicatesModal.tsx` | Modal : doublons locaux d'un subset. | `SubsetDuplicatesModal` |
| `ThemeProvider.tsx` | Injecte des variables CSS dans <head> selon les préférences | `BG_THEMES`, `ACCENT_THEMES`, `ThemeProvider`, `applyTheme` |
| `UserBadge.tsx` |  | `UserBadge` |

### frontend/src/components/docs

| File | Description | Exports |
|---|---|---|
| `markdown.ts` | Rendu markdown -> HTML des pages de docs/ et liens vers la page d'aide. | `docLink`, `renderMarkdown` |
| `MarkdownDoc.tsx` | Affiche un corps markdown de docs/ (sans frontmatter) avec les ancres | `MarkdownDoc` |

### frontend/src/components/help

| File | Description | Exports |
|---|---|---|
| `datasetTourSteps.ts` | Script du tutoriel interactif de Dataset Explorer (moteur generique dans | `TUTO_DATASET_NAME`, `buildDatasetTourSteps` |

### frontend/src/components/tour

| File | Description | Exports |
|---|---|---|
| `domUtils.ts` | Outils DOM pour ecrire des etapes qui pilotent reellement l'UI | `sleep`, `waitFor`, `waitForElement`, `clickWhenReady`, `setReactInputValue`, `typeWhenReady`, `isDisabled`, `clickEnabledWhenReady` |
| `index.ts` | Moteur de tour guide generique -- 100% portable (React seul, aucune |  |
| `positioning.ts` | Calcul du rectangle spotlight et du placement du tooltip. | `computeSpotlightRect`, `computeTooltipPlacement` |
| `TourContext.ts` | Contexte + hook useTour, separes de TourProvider.tsx (qui n'exporte | `TourContext`, `useTour` |
| `TourLaunchButton.tsx` | Bouton d'entree du tutoriel. Halo orange pulsant tant que l'utilisateur | `TourLaunchButton` |
| `TourOverlay.tsx` | Rendu visuel du tour : spotlight (trou dans un fond sombre) autour | `TourOverlay` |
| `TourProvider.tsx` | Moteur de tour guide generique et portable : aucune dependance a | `TourProvider` |
| `types.ts` | Types du moteur de tour guide generique (voir index.ts pour le |  |
| `useTourTarget.ts` | Resout un selecteur CSS en element DOM et suit sa position/taille. | `useTourTarget` |

### frontend/src/hooks

| File | Description | Exports |
|---|---|---|
| `useDataset.ts` | Accès aux données d'un dataset (TanStack Query). | `useDatasets`, `useDataset`, `useDatasetImages`, `useDatasetMap`, `useDatasetClusters`, `useInvalidateDataset` |
| `useSettings.ts` | Accès aux paramètres utilisateur (TanStack Query). | `useSettings` |
| `useSubset.ts` | Sélection globale d'images + gestion des subsets. | `useSelectionStore`, `useCreateSubset` |

### frontend/src/i18n

| File | Description | Exports |
|---|---|---|
| `translate.ts` | Traduction FR -> EN a l'affichage. Le francais reste la source de | `getLang`, `setLang`, `subscribeLang`, `isDesktopPiloted`, `initWorkspaceLanguage`, `setLangAndMaybePersist`, `t` |
| `useLang.ts` |  | `useLang`, `useT` |

### frontend/src/pages

| File | Description | Exports |
|---|---|---|
| `Catalog.tsx` | Le catalogue vu comme UN SEUL ensemble, pas comme N datasets isolés : | `Catalog` |
| `Dashboard.tsx` | pages/Dashboard.tsx - Dashboard Playground | `Dashboard` |
| `DatasetMap.tsx` | Carte UMAP : lasso, filtres, cluster panel, galerie sélection. | `DatasetMap` |
| `DuplicateExplorer.tsx` | Exploration et résolution des doublons du dataset complet. | `DuplicateExplorer` |
| `Gallery.tsx` | Dataset Gallery - point d'entrée principal. | `Gallery` |
| `HelpPage.tsx` | Aide integree : rend les pages markdown de Dataset_Explorer_App/docs/ | `HelpPage` |
| `SemanticSearch.tsx` | Recherche sémantique texte -> images CLIP. | `SemanticSearch` |
| `SettingsPage.tsx` | Paramètres utilisateur persistants dans le workspace. | `SettingsPage` |
| `SubsetManager.tsx` | Gestion des subsets + export + doublons locaux. | `SubsetManager` |

### frontend/src/types

| File | Description | Exports |
|---|---|---|
| `api.ts` | Interfaces TypeScript pour toutes les réponses API. |  |

### frontend/src/utils

| File | Description | Exports |
|---|---|---|
| `nativeImage.ts` | Chemin natif (coquille Electron, desktop/src/imageProtocol.ts) pour les | `nativeImageUrl` |
| `nativeWorkspace.ts` |  | `openInNativeFileManager` |
| `tutorialState.ts` | Etat du tutoriel interactif ("deja lance", "termine"). | `TUTORIAL_KEY`, `readTutorialState`, `writeTutorialState` |
<!-- generated:end -->
