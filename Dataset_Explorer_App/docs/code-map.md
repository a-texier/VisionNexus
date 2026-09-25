---
app: explorer
doc_type: code-map
audience: dev
lang: en
title: Code map
order: 80
tags: [code, modules, backend, frontend, tests, translations]
sources: [Dataset_Explorer_App/backend/main.py, Dataset_Explorer_App/backend/config.py, Dataset_Explorer_App/backend/api/datasets.py, Dataset_Explorer_App/backend/core/embedder.py, Dataset_Explorer_App/frontend/src/App.tsx, Dataset_Explorer_App/frontend/src/api/client.ts, Dataset_Explorer_App/frontend/src/i18n/translate.ts, Dataset_Explorer_App/backend/tests/conftest.py, Dataset_Explorer_App/pytest.ini]
---

# Code map

## Where to start reading the backend code

The Dataset Explorer backend lives in `Dataset_Explorer_App/backend/` and follows a three-layer layout: routers, core logic, database.

1. `config.py`: every path and constant (workspace, gallery folder, CLIP model and weights, batch size, supported extensions, ports and CORS). Read it first; it is evaluated before anything else and creates the workspace folders.
2. `main.py`: the lifespan (migrations, crash recovery, CLIP and FAISS loading), the router list, the static mounts and the small application endpoints.
3. `db/models.py` and `db/database.py`: the tables and the SQLite engine with its pragmas.
4. `api/datasets.py`: the heart of the app. Its first part holds helpers (global registry, settings readers, embedding loaders, `_apply_clustering`), then the request schemas, the in-memory progress dictionaries, and the endpoints in the order scan, merges, CLIP filter, list, details, images, embeddings, recluster, reduce, remap, rebuild, reset, exclusion, conversion, gallery and deletion.
5. `core/`: one module per algorithm, each with a module-level singleton (`clip_embedder`, `faiss_indexer`, `umap_reducer`, `clusterer`).

The architecture and its invariants are described in [Architecture](architecture.md); the endpoints in [API reference](api-reference.md).

## Where to start reading the frontend code

The Dataset Explorer frontend lives in `Dataset_Explorer_App/frontend/src/`.

1. `App.tsx`: the sidebar (`NAV_ITEMS`), the routes and the tutorial start.
2. `api/client.ts`: every backend call, grouped by domain (`datasetsAPI`, `foldersAPI`, `subsetsAPI`, `catalogAPI`, `metadataAPI`, `settingsAPI`, `docsAPI`...), and `_startSSE` for streamed operations. `types/api.ts` holds the response types.
3. `hooks/useDataset.ts` (TanStack Query hooks and the polling rule) and `hooks/useSubset.ts` (global selection store).
4. `pages/`: one file per route. `Gallery.tsx` and `Dashboard.tsx` (the Playground) are the largest; `DatasetMap.tsx` uses `components/ScatterPlot.tsx` and `components/FilterBar.tsx`.
5. `components/`: shared UI (image modal, confirm dialog, user badge, theme, subset duplicates window), the tour engine in `tour/`, the tutorial script in `help/` and the Markdown renderer in `docs/`.

## Where to change the embeddings pipeline or the CLIP model

The embeddings pipeline of Dataset Explorer is split between the endpoint and the model wrapper.

- Pipeline steps, incremental encoding, progress phases and final dataset fields: `_run_embed_pipeline` and `start_embedding` in `backend/api/datasets.py`. The batch size of the pipeline is written there (64); `BATCH_SIZE` of `config.py` is only the default of `embed_images`.
- Model loading, image and text encoding, parallel decoding (`IO_WORKERS`), thumbnails: `backend/core/embedder.py`.
- Weights resolution and offline mode: `CLIP_MODEL`, `CLIP_PRETRAINED`, `CLIP_WEIGHTS` and the `HF_HUB_OFFLINE` defaults in `backend/config.py`.
- Reading of 16-bit and infrared images: `backend/core/image_io.py`.
- Scan (file listing, MD5, headers, thumbnails, metadata association): `_scan_dataset` and `_generate_remaining_thumbnails` in `backend/api/datasets.py`.

Changing the CLIP model or its dimension breaks compatibility with stored embeddings and FAISS indexes: update `EMBED_DIM`, the fallback shapes (`np.zeros((0, 512))` in `_load_dataset_embeddings`), and re-encode with `force=true`.

## Where to change the map, the clustering and the rarity

These algorithms are isolated in `backend/core/` and called from several endpoints.

- 2D reduction methods, fallbacks and default parameters: `backend/core/reducer.py`.
- KMeans, HDBSCAN and rarity: `backend/core/clusterer.py`.
- Application of a clustering to a dataset (labels, centroids, rarity, stored configuration): `_apply_clustering` in `backend/api/datasets.py`. Note that `rebuild_without_duplicates`, `reset_duplicate_filter` and `merge_datasets` still call `clusterer.kmeans` directly instead of this helper.
- Reading the reduction and clustering settings, and the outdated-map hash: `_load_reduction_settings_full`, `_load_cluster_settings` and `_compute_reduction_hash` in the same file.
- Map points and cluster summaries sent to the frontend: `backend/api/explore.py`.
- Map display, colors and legends: `frontend/src/components/ScatterPlot.tsx`; filters: `components/FilterBar.tsx`; panels and selection: `pages/DatasetMap.tsx`; the equivalent panels of the Playground: `pages/Dashboard.tsx`.

## Where to change the duplicate detection and the decisions

Duplicate logic has three entry points sharing one graph algorithm.

- Neighbor graph and connected components: `_build_adjacency` and `_connected_components` in `backend/core/indexer.py` (50 neighbors, batches of 256).
- Per-dataset groups and decisions: `backend/api/duplicates.py` (`get_duplicates`, `patch_duplicate_decision`); cross-dataset groups: `get_global_duplicates` in the same file.
- Per-subset groups (NumPy, no FAISS) and removal of rejected images: `get_subset_duplicates` and `apply_duplicate_filter` in `backend/api/export.py`.
- Exclusion from the map, rebuild and reset: `exclude_images`, `rebuild_without_duplicates`, `reset_duplicate_filter` in `backend/api/datasets.py`.
- Interfaces: `pages/DuplicateExplorer.tsx`, `components/SubsetDuplicatesModal.tsx` (French strings not translated yet) and the `DuplicatesTab` of `pages/Catalog.tsx`.

To make rejected images disappear from search results or exports, filter `is_duplicate_kept is False` in `core/semantic_filter.py` and in `export_subset` of `api/export.py`.

## Where to change subsets, links and exports

Subsets and exports are handled by one router and one helper module.

- Link or copy strategy, subset and export folders: `backend/core/subset_manager.py` (`_make_symlink` reads `use_symlinks` at each call).
- Subset endpoints and export records: `backend/api/export.py`.
- Default export folder: `ANNOTATION_APP_IMPORTS` in `backend/config.py`; the `annotation_app_imports_path` setting would have to be read in `export_subset` (and returned by `/api/app-mode`) to become effective.
- Orchestrator subset creation and export: `backend/api/orchestrator.py`.
- Interface: `pages/SubsetManager.tsx`; subset creation from other pages is in `pages/DatasetMap.tsx`, `pages/SemanticSearch.tsx` and the `SelectionBar` of `pages/Catalog.tsx`.

## Where to change the Gallery, the global registry and the folders

The Gallery combines workspace data and shared files.

- Registry reading and atomic writing, registry entries, gallery thumbnails and basic statistics: the helpers at the top of `backend/api/datasets.py` (`_load_global_registry`, `_save_global_registry`, `_upsert_global_registry`, `_copy_gallery_thumbnails`, `_compute_basic_gallery_stats`) and the merge of workspace and registry in `list_datasets`.
- Global deletion and ownership: `delete_global_registry_entry` in the same file.
- Folder tree and shared folder synchronization: `backend/api/folders.py`.
- Paths of the shared files: `DATASET_GALLERY_DIR` and `GLOBAL_REGISTRY_FILE` in `backend/config.py`, `FOLDERS_REGISTRY_FILE` in `api/folders.py`.
- Interface: `pages/Gallery.tsx` (add form, CLIP filter and filtered merge, sections, folder tree, cards and details panel).

## Where to change the metadata and the Catalog

The metadata features and the Catalog rely on three backend modules. The Catalog itself has no endpoint of its own: it reuses the global search, the global duplicates and the metadata routes.

- File reading, key matching and column suggestions: `backend/core/metadata_loader.py`.
- FTS5 table, query building and facets: `backend/core/metadata_index.py`.
- Metadata endpoints: `backend/api/metadata.py`; preview endpoint: `metadata_preview` in `api/datasets.py`.
- Global index and cross-dataset search: `ensure_global`, `search_global` and `find_duplicates_global` in `backend/core/indexer.py`, `semantic_search_global` in `core/semantic_filter.py`, `do_global_search` in `api/filter.py`.
- Interface: `pages/Catalog.tsx` (three tabs, shared `DatasetPicker`, `ResultCard` and `SelectionBar`), and the metadata fields of the add form in `pages/Gallery.tsx` (`handleAnalyzeMeta`).

## Where to add an endpoint or a setting

Adding an endpoint:

1. Add the route to the router of its domain in `backend/api/`, or create a router and include it in `backend/main.py`. Declare routes with a fixed segment under `/datasets/` before `/datasets/{dataset_id}`.
2. Long work goes through `submit_job` (`core/job_runner.py`) with a key per dataset, and publishes progress in a dictionary returned by `list_datasets`, rather than in a new stream.
3. Add the function to `frontend/src/api/client.ts` and the response type to `frontend/src/types/api.ts`.
4. Regenerate the endpoint tables of [API reference](api-reference.md) with `python tools/docs/gen_api_docs.py --app explorer --static` and describe the endpoint in the prose.

Adding a setting:

1. Add the field with its default to `AppSettings` in `backend/api/settings.py`; older `settings.json` files are completed with the defaults.
2. Read it where needed with `load_settings()` (it is read at each call, no restart needed).
3. Add the control to `pages/SettingsPage.tsx` and the field to `AppSettings` in `types/api.ts`. `PUT /api/settings` replaces the whole object: always send the complete settings.
4. Document it in the settings table of [Configuration](configuration.md).

A new database column must be added both to the model in `db/models.py` and to the migration list of the lifespan in `main.py`.

## Where to change the help, the tutorial and the translations

- The help page renders the Markdown files of `Dataset_Explorer_App/docs/`: edit the `.md` and `.fr.md` pages, never the page code, to change documentation. Rules are in `tools/docs/DOC_STYLE.md`; check with `python tools/docs/lint_docs.py --app explorer`.
- Help page and navigation: `frontend/src/pages/HelpPage.tsx`; Markdown rendering, heading anchors and link rewriting: `components/docs/markdown.ts` and `MarkdownDoc.tsx`; served by `backend/api/docs.py` (tests in `backend/tests/test_docs_router.py`).
- Tutorial script: `components/help/datasetTourSteps.ts` (targets are `data-tour` attributes in the pages); generic engine: `components/tour/`; state: `utils/tutorialState.ts`; sample folder: `backend/api/samples.py`.
- Translations: the French text is written in the code and wrapped in `t()`; add its English version to `EXACT_EN` in `frontend/src/i18n/translate.ts`. Texts not wrapped (map filter bar, legends, subset duplicates window, image modal, theme names) stay in French.
- Short contextual help stays in the code: tooltips (`title`) and inline explanations of each page.

## Tests and debugging tools

Backend tests live in `backend/tests/` and run from `Dataset_Explorer_App/` (configuration in `pytest.ini`, markers `unit`, `integration`, `multiuser`, `slow`):

```bash
python -m pytest backend/tests -m "not integration"
python -m pytest backend/tests/test_docs_router.py
```

`backend/tests/conftest.py` points `EXPLORER_WORKSPACE` to a temporary folder before any import of `backend.config`, so tests never touch a real workspace; the `api_client` fixture starts the full app (CLIP included). `TEST_DATASET_DIR` gives a folder of real images to the tests that need one.

The multi-user integration tests start several backends at once and check workspace isolation, shared global datasets and concurrent access: `python backend/tests/integration/run_tests.py` (options `--fast`, `--keep-ws`, `--dataset <folder>`; variables `MULTIUSER_N_USERS`, `MULTIUSER_BASE_PORT`, `MULTIUSER_TIMEOUT`, `MULTIUSER_KEEP_WS`). `python backend/tests/smoke_test.py` is a standalone end-to-end check: it starts the app on a temporary workspace, calls the main read endpoints, scans a temporary dataset and deletes it.

Useful debugging entry points: `GET /health` (CLIP state and active jobs), `GET /api/audit` (who deleted, locked or exported what), the FastAPI documentation at `/docs` on the backend port, the SQLite database `dataset_explorer.db` (readable with any SQLite client while the app runs, thanks to WAL), and the backend log, which reports every scan, pipeline phase, migration and index reload.

## Module map

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
