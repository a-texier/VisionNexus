---
app: explorer
doc_type: architecture
audience: dev
lang: en
title: Architecture
order: 60
tags: [fastapi, sqlite, faiss, job runner, sse, react, global registry]
sources: [Dataset_Explorer_App/backend/main.py, Dataset_Explorer_App/backend/config.py, Dataset_Explorer_App/backend/db/models.py, Dataset_Explorer_App/backend/db/database.py, Dataset_Explorer_App/backend/api/datasets.py, Dataset_Explorer_App/backend/api/folders.py, Dataset_Explorer_App/backend/api/export.py, Dataset_Explorer_App/backend/api/orchestrator.py, Dataset_Explorer_App/backend/core/job_runner.py, Dataset_Explorer_App/backend/core/indexer.py, Dataset_Explorer_App/backend/core/metadata_index.py, Dataset_Explorer_App/backend/core/subset_manager.py, Dataset_Explorer_App/frontend/src/App.tsx, Dataset_Explorer_App/frontend/src/api/client.ts, Dataset_Explorer_App/frontend/src/hooks/useDataset.ts, Dataset_Explorer_App/frontend/vite.config.ts]
---

# Architecture

## Components overview of Dataset Explorer

Dataset Explorer is a two-tier web application: a FastAPI backend that owns the data, the models and the computations, and a React frontend that runs in a browser or in the VisionNexus Electron shell.

```text
Frontend (React 18 + TypeScript + Vite 6 + Tailwind + TanStack Query + Zustand + Plotly)
  |-- HTTP /api (axios, 30 s timeout; longer for Catalog calls)  --+
  |-- progress streams: fetch POST + ReadableStream (SSE format)  --+--> Vite proxy --> FastAPI backend
  `-- images: /thumbs, /gallery-thumbs, /api/images/*; app-image:// native read in VisionNexus

Backend (FastAPI + SQLModel + SQLite, one uvicorn process per workspace)
  |-- api/     one router per domain
  |-- core/    ML and business logic without FastAPI: CLIP, FAISS, reduction, clustering, jobs
  |-- db/      SQLModel tables and the SQLite engine
  |-- utils/   Windows share paths and optional format adapters
  `-- storage: workspace (database, thumbnails, indexes, subsets, settings) + shared gallery folder
```

Main technologies: FastAPI and uvicorn, SQLModel on SQLAlchemy with SQLite in WAL mode, PyTorch with `open_clip` (ViT-B/32), FAISS, `umap-learn`, scikit-learn (t-SNE, PCA, KMeans), `hdbscan`, Pillow and OpenCV, pandas for metadata tables. On the frontend: React 18, React Router 6, TanStack Query 5, Zustand 5, `react-plotly.js`, `react-hot-toast` and `marked` for the in-app documentation.

State shared between requests lives in SQLite (persistent) or in module-level singletons (CLIP model, FAISS indexes, job pool, progress dictionaries). This is why exactly one backend process must serve a workspace.

## Backend application startup

`backend/config.py` is evaluated first: it sets `HF_HUB_OFFLINE` and `TRANSFORMERS_OFFLINE`, resolves the workspace from `EXPLORER_WORKSPACE` and creates `thumbs/`, `faiss/`, `subsets/` and `data/dataset_gallery/` at import time, because the static mounts need them.

The lifespan in `backend/main.py` then:

1. Creates the SQLite tables (`create_db_and_tables`).
2. Runs the column migrations with `ALTER TABLE ... ADD COLUMN` for columns added over time: on `dataset` the reduction and clustering configuration, `folder_id`, the mean embedding, the annotation reference, the metadata reference and `error_message`; `subset.locked`; `image.metadata_json`. They must run before any ORM query on `Dataset`, which selects every mapped column. Tables are never dropped.
3. Resets datasets left in `embedding` by a crash to `pending`.
4. Loads CLIP (`clip_embedder.load()`); a failure is logged and the app starts without the model.
5. Reloads the FAISS index file of every `ready` dataset into memory.

Routers are included in `main.py`, then two static mounts are declared after them: `/thumbs` on the workspace `thumbs/` folder and `/gallery-thumbs` on `data/dataset_gallery/`. CORS allows the frontend origins computed in `config.py`.

Application-level endpoints of `main.py`: `/health` (CLIP state, device, active jobs), `/api/capabilities` (optional format adapters), `/api/audit` (recent audit entries), `/api/workspace/users`, `/api/workspace/open`, `/api/workspace/history` and `/api/app-mode` (standalone or Orchestrator, with the export folder).

## Routers and core modules

Routers live in `backend/api/`, one file per domain:

| Router | Domain |
|---|---|
| `datasets.py` | Dataset creation and scan, list with progress, details, statistics, images and thumbnails, embeddings pipeline, recluster, reduce, remap, rebuild and reset of decisions, exclusion, merges, CLIP filter of the Gallery, global registry, deletion, format specialise conversion, metadata preview |
| `folders.py` | Personal and shared folder tree |
| `explore.py` | Map points and cluster summary |
| `filter.py` | Text search in one dataset and in the global index |
| `duplicates.py` | Duplicate groups per dataset and across datasets, keep or reject decisions |
| `export.py` | Subsets: create, duplicate, lock, delete, export, per-subset duplicates |
| `metadata.py` | Metadata search, columns, facets, column mapping suggestions, reindex |
| `settings.py` | Workspace settings (`settings.json`) |
| `orchestrator.py` | Contract with the Orchestrator App |
| `samples.py` | Tutorial sample folders |
| `docs.py` | Markdown documentation of the in-app help page |

Modules in `backend/core/` have no FastAPI dependency:

| Module | Role |
|---|---|
| `embedder.py` | `clip_embedder`: CLIP loading, image and text embeddings, MD5, thumbnails |
| `indexer.py` | `faiss_indexer`: per-dataset indexes, global index, duplicate graph |
| `reducer.py` | `umap_reducer`: UMAP, t-SNE, PCA with fallbacks |
| `clusterer.py`, `scorer.py` | `clusterer`: KMeans, HDBSCAN, rarity scores |
| `semantic_filter.py` | Text search and FAISS position to image id mapping |
| `job_runner.py` | Bounded, deduplicated pool of background jobs |
| `subset_manager.py` | Subset and export folders, link or copy |
| `metadata_loader.py`, `metadata_index.py` | CSV and Excel reading, key matching, column mapping, FTS5 index |
| `annotation_ref.py` | Format detection and counting of `.ver` and YOLO files |
| `image_io.py` | 8-bit conversion of 16-bit, infrared and float images |
| `audit.py` | JSONL audit log |
| `format_registry.py` | Discovery of optional format adapters in `backend/utils/` |

## Data model and database

The database is SQLite at `<workspace>/dataset_explorer.db`, opened with `check_same_thread=False` and, on every connection, `journal_mode=WAL`, `busy_timeout=10000` and `synchronous=NORMAL`, so that background jobs can write while requests read. Models are SQLModel classes in `backend/db/models.py`.

| Table | Key fields |
|---|---|
| `folder` | `name`, `parent_id`, `is_global`, `uid` (stable id of a shared folder), `added_by` |
| `dataset` | `name`, `root_path` (resolved path, or `merged:<ids>`), `status`, `error_message`, `image_count`, `embedded_count`, `n_clusters`, `umap_cached`, `faiss_index_path`, `is_global`, `added_by`, `folder_id`, `cluster_method`, `cluster_params_json`, `reduction_method`, `reduction_params_json`, `reduction_settings_hash`, `mean_embedding_blob`, `annotation_*`, `metadata_path`, `metadata_key_column`, `metadata_columns_json` |
| `image` | `dataset_id`, `file_path`, `filename`, `md5`, `width`, `height`, `file_size_bytes`, `thumbnail_path`, `umap_x`, `umap_y`, `cluster_id`, `rarity_score`, `duplicate_group_id`, `is_duplicate_kept`, `metadata_json` |
| `embedding` | `image_id` (unique), `vector_blob` (512 float32, normalized), `dim`, `model_name` |
| `cluster_centroid` | `dataset_id`, `cluster_id`, `centroid_blob`, `size` |
| `subset` | `dataset_id`, `name`, `symlink_dir`, `image_count`, `exported_to_annotation_app`, `export_path` (first export), `locked` |
| `subset_image` | `subset_id`, `image_id` |
| `subset_export` | `subset_id`, `export_path`, `export_type` (`symlink` or `copy`) |

`is_duplicate_kept` is `None` (undecided), `True` or `False` (rejected). `umap_cached` means "the pipeline completed and a map exists"; `reduction_settings_hash` is the MD5 of the reduction settings at the last map computation and drives `map_method_outdated`. The virtual table `image_metadata_fts` (FTS5) is created on demand by `metadata_index.py`.

Deletion is a manual cascade in `_delete_dataset_from_session`: FAISS index in memory and on disk, FTS rows, subset links, embeddings, images, subsets and their exports, centroids, the dataset, then thumbnails no other image references. Subset folders on disk are not removed.

## Embeddings pipeline

`POST /api/datasets/{id}/embed` sets the status to `embedding`, takes the in-memory lock `_embedding_ids` and submits `_run_embed_pipeline` to the job pool; a second call while it runs returns `already_running`. The pipeline:

1. Loads the images ordered by `Image.id`.
2. Encodes, by batches of 64, only the images without an embedding (all of them with `force=true`), reading the original files with six parallel decoding threads, and stores the normalized vectors.
3. Assembles the full matrix in id order and builds the FAISS index (phase `indexing`).
4. Computes the 2D coordinates with the reduction settings (phase `umap`) and stores the applied configuration.
5. Runs the clustering of the settings on the 512-dimension matrix, stores centroids and rarity scores (phases `clustering`, `scoring`).
6. Stores the normalized mean vector, sets `ready`, `umap_cached`, the index path and the settings hash; for a global dataset, adds the mean vector and the annotation summary to the registry.

Progress is written to `_embed_progress[dataset_id]` and returned by `GET /api/datasets`; any exception sets the status to `error` and the lock is released in a `finally`.

The scan (`_scan_dataset`, submitted by `POST /api/datasets`) creates image records with MD5 and header-only dimensions by batches of 100, sets `pending`, attaches metadata rows and indexes them, generates five thumbnails immediately (copied to the gallery for a shared dataset), then the remaining thumbnails with six threads. Optional formats are converted before listing.

## Background jobs and progress reporting

Heavy work runs in `core/job_runner.py`: a `ThreadPoolExecutor` of `EXPLORER_JOB_WORKERS` threads (3 by default), separate from the threadpool that serves synchronous endpoints, with deduplication by key (`scan:<id>`, `embed:<id>`, `recluster:<id>`, `reduce:<id>`). `active_jobs()` feeds `/health`.

Progress of these jobs lives in module-level dictionaries of `api/datasets.py` (`_scan_progress_map`, `_embed_progress`, `_thumb_progress`, `_recluster_progress`, `_reduce_progress`) and is merged into every `DatasetSummary` of `GET /api/datasets`. The frontend hook `useDatasets` polls that list every 2 seconds while a dataset is `scanning` or `embedding` or has thumbnails, reclustering or reduction in progress. Polling needs no direct connection to the backend, which keeps it working over SSH through the Vite proxy.

Five operations still stream their progress as `data: {json}` events on a `POST` response: `/api/datasets/merge`, `/api/datasets/merge-filtered`, `/{id}/remap`, `/{id}/rebuild-without-duplicates` and `/{id}/reset-duplicate-filter`. `EventSource` cannot send a POST, so the client reads them with `fetch` and a `ReadableStream` (`_startSSE` in `api/client.ts`), always through the same-origin proxy. The Playground keeps their last event in module-level maps so that a bar survives navigation. These generators run inside the request, not in the job pool.

## FAISS indexes and the position invariant

Each dataset has an exact `IndexFlatIP` over its normalized vectors, saved as `<workspace>/faiss/<id>/index.faiss`. The index stores no image id: position `i` is the image of rank `i` when the dataset images are sorted by `Image.id` ascending at build time. Every consumer (`semantic_filter.py`, `duplicates.py`, the global duplicates) rebuilds the ordered id list to translate positions.

The global index (`ensure_global`) concatenates the vectors of every loaded index with a table `global position -> (dataset id, local position)`. It is cached by a signature of dataset ids and sizes, invalidated by every `build`, `load` and `remove`, never persisted, and switches from `IndexFlatIP` to `IndexHNSWFlat` above 200,000 vectors. It serves `POST /api/search/global` and `GET /api/duplicates/global`; with a dataset filter the search over-samples five times before filtering.

Duplicate detection searches the 50 nearest neighbors of every vector by batches of 256, links pairs above the threshold and returns the connected components with at least two members. The per-dataset endpoint also writes `duplicate_group_id` (id of the representative) on the images.

## Recomputation paths of maps and clusters

Several endpoints recompute part of the analysis; they differ in what they read and store:

| Operation | Images used | Reduction | Clustering | Stored configuration |
|---|---|---|---|---|
| `embed` | all | settings | settings method | reduction and clustering config, settings hash |
| `recluster` | all with an embedding | unchanged | requested method | clustering config |
| `reduce` | not rejected | requested parameters | unchanged | reduction config, hash of the current settings |
| `remap` | not rejected | settings | unchanged | reduction config, settings hash |
| `rebuild-without-duplicates` | not rejected; rejected lose coordinates, cluster and rarity | settings | the dataset's own method (KMeans with `n_clusters`, or HDBSCAN) | settings hash only |
| `reset-duplicate-filter` | all, decisions cleared | settings | the dataset's own method (KMeans with `n_clusters`, or HDBSCAN) | none |
| `merge` | all embedded images of the sources | settings | settings method | none |
| `merge-filtered` | images above the CLIP threshold | settings | settings method | reduction and clustering config, settings hash |

Consequences to keep in mind: `reduce` stores the hash of the settings rather than of the parameters it used, and `recluster` and `rebuild` do not handle rejected images the same way. The map endpoint, the text searches (dataset and Catalog) and the subset export always skip rejected images: the similarity index still holds them, so a search asks the index for a few more results and filters them out.

## Global gallery and shared folders

The global gallery is file-based so that it survives workspace changes and is visible to every workspace of the installation: `data/dataset_gallery/registry.json` (datasets) and `folders_registry.json` (shared folders), in the application folder. Both are written atomically (temporary file then `replace`) because the dataset list is polled every 2 seconds.

`GET /api/datasets` merges the workspace datasets with the registry entries that have no global copy in the workspace; those are returned with `id = -1` and `in_workspace = false`. For global datasets of the workspace that are `ready` or `error`, missing gallery thumbnails and basic statistics are regenerated during the listing. The gallery folder of a dataset must be a real folder: an old symbolic link at that place is removed before thumbnails are copied.

Ownership is the `added_by` field (the `EXPLORER_USER` of the publisher). `DELETE /api/datasets/global` checks it, removes the registry entry and the gallery folder, and deletes the dataset from the current workspace only.

Shared folders carry a stable `uid`. `sync_shared_folders`, called by the folder and dataset lists, materializes the registry folders missing from the workspace database, parents first. A shared dataset records the `uid` of its folder in the registry so that importing it files it in the same folder.

## Subsets, exports and links

A subset is created in the database first, then its folder `<workspace>/subsets/<name>/` is filled by `create_subset_symlinks`; a link failure is logged and leaves `symlink_dir` empty. `_make_symlink` reads `use_symlinks` from the settings at each call: a relative symbolic link, then an absolute one, or `shutil.copy2` when copies are chosen. Links are named after the file name, so equal names overwrite each other.

`export_to_annotation_app` writes `<base>/<subset name>/`, where the base is the custom path of the request (standalone only), otherwise the `annotation_app_imports_path` setting (initially `ANNOTATION_APP_IMPORTS`). Images marked as rejected are never copied. The endpoint then refuses (409) a second export record with the same path and records the export type from the current settings.

The subset duplicates endpoint computes the similarity matrix of the subset embeddings directly in NumPy (no FAISS), which is fine for subsets of a few thousand images. `apply-duplicate-filter` removes the links of rejected images from the database and the folder.

## Metadata tables and the FTS5 index

A metadata table is attached at dataset creation: `metadata_loader.build_key_map` reads the file with pandas (separator and encoding sniffing for text files), indexes each row under the key value, its base name and its stem, and `match_image` finds the row of each image name. The row is stored as JSON in `image.metadata_json` and the column list in `dataset.metadata_columns_json`.

`metadata_index.py` keeps a standalone FTS5 table `image_metadata_fts(content, image_id, dataset_id)` where `content` concatenates the file name and `column value` pairs, so that both column names and values are searchable. User input is split into tokens, each token quoted, the last one with a prefix `*`, joined with `AND` or `OR`. Facets use `json_extract` on `metadata_json` for exact counts. The search endpoint indexes on the fly any dataset that has metadata but no FTS rows. Column mapping suggestions combine a canonical form, `difflib` and an inclusion rule; they are never applied automatically.

## Images, thumbnails and native paths

Thumbnails are 256-pixel JPEG files named `<md5>.jpg` in the workspace, served statically under `/thumbs`. `generate_thumbnail` uses `PIL.Image.draft` for fast JPEG decoding and the 3-sigma conversion of `image_io.py` for high bit-depth files. `GET /api/images/{id}/thumb` generates a missing thumbnail on demand.

Embeddings always read `Image.file_path`, never a thumbnail. `image_io.load_pil_rgb` reads through OpenCV (`IMREAD_UNCHANGED`) when available, with a PIL fallback.

In VisionNexus, `utils/nativeImage.ts` rewrites the costly image URLs (on-demand thumbnail, full resolution) to the `app-image://` protocol of the shell, which asks the twin endpoints `.../thumb-path` and `.../full-path` for a native path and reads the file directly from the Windows share; the HTTP endpoint stays as fallback. `utils/native_share.py` translates server paths to UNC paths with the configured share host, and UNC paths typed by the user back to server paths.

## Orchestrator integration

`api/orchestrator.py` exposes the contract used by the Orchestrator App; it does not change standalone behavior.

- `load-dataset` reuses the first dataset with the same resolved path (unless `allow_duplicate`), otherwise calls `create_dataset` with `allow_duplicate=True`, waits for the end of the scan when asked, and pins the dataset in the settings.
- `start-embed` returns `already_ready` for a ready dataset, otherwise triggers `/embed` on its own port with `httpx` and waits for `ready` or `error` (timeout 1800 s by default).
- `create-subset` runs a text search (Top-K or threshold), optionally restricted to a source subset, replaces a subset with the same name and creates the links.
- `export-subset` removes a previous export folder of the same name, then writes the export into the given path or `ANNOTATION_APP_IMPORTS`. It does not create a `subset_export` record.
- `status` reports a dataset status by name.

Ids take priority over names everywhere, because dataset and subset names are not unique; ambiguous names return 409. When `LAUNCHED_BY_ORCHESTRATOR` is set, the normal export endpoint ignores custom paths.

## Frontend structure and state

The frontend is a single-page application (`frontend/src/App.tsx`) with a sidebar and nine routes: `/` (Gallery), `/catalog`, `/playground`, `/datasets/:id/map`, `/datasets/:id/search`, `/datasets/:id/duplicates`, `/subsets`, `/help` and `/settings`.

- Server state goes through TanStack Query (`hooks/useDataset.ts`, keys `datasets`, `dataset`, `dataset-map`, `dataset-clusters`, `subsets`...), with the 2-second polling of the dataset list described above.
- The image selection is a global Zustand store (`useSelectionStore` in `hooks/useSubset.ts`), shared by the map, the search page and the Subsets page; the Catalog keeps its own local selection.
- The API client (`api/client.ts`) uses relative URLs only, so everything goes through the Vite proxy.
- Texts are French in the code and translated at display time by `i18n/translate.ts` (`t()`); the language comes from `?lang=` given by VisionNexus, then the browser storage, then the workspace settings.
- The theme is applied by `ThemeProvider` as a generated style element from the settings.
- The help page renders the Markdown files of `docs/` served by `/api/docs` (`components/docs/`), with heading anchors `h-<n>` shared with the suite documentation viewer.
- The interactive tutorial uses the generic tour engine of `components/tour/` and the script `components/help/datasetTourSteps.ts`; its state is stored by VisionNexus, with the workspace settings as fallback.

## Invariants that must not be broken

- FAISS position `i` equals the image of rank `i` sorted by `Image.id` at build time. Always order by `Image.id` when building an index or reading its results; rebuild the index (run `/embed`) after adding images.
- Embeddings are float32, 512 values, normalized: cosine similarity equals the dot product, and `IndexFlatIP` relies on it. Keep `CLIP_MODEL = "ViT-B-32"` to stay compatible with stored vectors.
- Embeddings are computed from the original file, never from a thumbnail.
- Clustering runs on the 512-dimension embeddings, never on the 2D coordinates; reduction and clustering stay independent operations.
- Heavy jobs go through `submit_job`, not FastAPI `BackgroundTasks`, so they are bounded and deduplicated.
- The column migrations of the lifespan run before any ORM query on `Dataset`; add a new column to the model and to the migration list together.
- Routes with a fixed segment (`/datasets/merge`, `/datasets/filter-by-text`, `/datasets/check-path`, `/datasets/global`) are declared before `/datasets/{dataset_id}`.
- The static mounts are declared after the routers; the gallery folder of a dataset is a real folder, never a link.
- Writes to `registry.json` and `folders_registry.json` stay atomic.
- Audit writes never raise: an audit failure must not fail the audited operation.
- `POST /api/datasets` answers 409 for a known path unless `allow_duplicate` is true; the Orchestrator arbitrates duplicates itself.
- A locked subset is refused by `DELETE /api/subsets/{id}` on the server side.

## Performance notes

- Scans read only file headers and MD5; thumbnails come afterwards with six threads, and image decoding before CLIP uses six threads too, because network shares are I/O-bound.
- Embedding lookups are done in one query per 900 ids (SQLite parameter limit) rather than one query per image.
- `GET /api/datasets` aggregates rejected counts in one query; it is polled every 2 seconds only while something runs.
- The global index is rebuilt only when the signature of loaded indexes changes; over 200,000 vectors it uses HNSW.
- `GET /api/datasets/{id}/images` paginates in SQL (500 images per page at most).
- UMAP on tens of thousands of images and HDBSCAN on 512 dimensions can take minutes; they run in the job pool without blocking requests.
- The production build of the frontend is a single large bundle (Plotly); code splitting has not been done.
