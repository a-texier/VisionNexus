---
app: explorer
doc_type: api-reference
audience: dev
lang: en
title: API reference
order: 70
tags: [rest api, endpoints, fastapi, sse, orchestrator]
sources: [Dataset_Explorer_App/backend/main.py, Dataset_Explorer_App/backend/api/datasets.py, Dataset_Explorer_App/backend/api/folders.py, Dataset_Explorer_App/backend/api/explore.py, Dataset_Explorer_App/backend/api/filter.py, Dataset_Explorer_App/backend/api/duplicates.py, Dataset_Explorer_App/backend/api/export.py, Dataset_Explorer_App/backend/api/metadata.py, Dataset_Explorer_App/backend/api/settings.py, Dataset_Explorer_App/backend/api/orchestrator.py, Dataset_Explorer_App/backend/api/samples.py, Dataset_Explorer_App/backend/api/docs.py]
---

# API reference

## Conventions of the Dataset Explorer API

The Dataset Explorer backend exposes a JSON REST API under `/api`, static files under `/thumbs` and `/gallery-thumbs`, a health check at `/health`, and the interactive FastAPI documentation at `/docs` on the backend port (8001 by default, see [Configuration](configuration.md)). Through the Vite frontend, `/api`, `/thumbs` and `/gallery-thumbs` are proxied, so the frontend always calls relative URLs.

General rules:

- **Identifiers**: `dataset_id`, `image_id`, `subset_id` and `folder_id` are database ids of the workspace. Global datasets not yet imported are listed with `id = -1` and cannot be used by id.
- **Paths** sent to the backend are paths on the backend machine. `root_path` of `POST /api/datasets`, `/api/datasets/check-path` and the Orchestrator `load-dataset` also accept Windows network paths, translated as described in [Configuration](configuration.md).
- **Scores** (`score`, `threshold`, `min_score`, `similarity_to_representative`) are cosine similarities between 0 and 1.
- **Errors** use FastAPI's format `{"detail": ...}`: 400 (invalid input), 404 (unknown object), 409 (conflict: known path, locked subset, existing export, ambiguous name), 425 (dataset not embedded yet or index not loaded), 503 (CLIP not loaded), 500. Messages are in French. The 409 of `POST /api/datasets` has an object `detail` with `existing_dataset_id` and `existing_dataset_name`.
- **Long operations** either return immediately and report progress in `GET /api/datasets` (scan, embed, recluster, reduce), or answer with a stream of `data: {json}` lines (merge, merge-filtered, remap, rebuild, reset). Stream events have `type` `progress` (`current`, `total`, `phase`), `done` or `error` (`message`).

The endpoint tables of the section *Endpoint index* are generated from the code; the sections below explain each domain.

## Dataset endpoints: creation, list and details

These endpoints of `api/datasets.py` manage the datasets of the workspace.

- `POST /api/datasets` creates a dataset and schedules its scan; it answers 201 immediately with status `scanning`. Body: `root_path` (required), `name`, `recursive` (default true), `n_clusters` (default 20), `share_dataset`, `folder_id`, `annotation_path`, `annotation_name`, `metadata_path`, `metadata_key_column`, `allow_duplicate`. 400 if the path does not exist, 409 if it is already a dataset and `allow_duplicate` is false.
- `GET /api/datasets/check-path?root_path=` lists the datasets using that folder (`id`, `name`, `image_count`, `status`).
- `GET /api/datasets` returns every dataset of the workspace, then the global registry entries not yet imported. Each entry carries the counts, status and `error_message`, `rejected_count`, `map_needs_rebuild`, `map_method_outdated`, the progress fields `scan_*`, `embed_*` (with `embed_phase`), `thumb_*`, `recluster_*`, `reduce_*`, the applied `cluster_method` / `cluster_params` and `reduction_method` / `reduction_params`, `folder_id`, annotation and metadata summaries, `gallery_thumb_urls`, `registry_stats`, `added_by` and `duplicate_of`.
- `GET /api/datasets/{id}` returns the details with `cluster_distribution`, `duplicate_count`, `rejected_count` and `map_needs_rebuild`.
- `GET /api/datasets/{id}/stats` computes dimensions, format distribution, color modes (sampled on 20 images), file sizes and five random thumbnails.
- `GET /api/datasets/{id}/images` pages through images (`page`, `limit` up to 500, filters `cluster_id`, `min_rarity`, `max_rarity`, `duplicate_only`).
- `PATCH /api/datasets/{id}/folder` moves a dataset into a folder (`folder_id`, null for the root).
- `DELETE /api/datasets/{id}` deletes a dataset from the workspace with its images, embeddings, subsets, index and orphan thumbnails; `DELETE /api/datasets/global?root_path=` removes a published dataset from the registry (owner only, 403 otherwise) and from the current workspace.
- `POST /api/datasets/{id}/refresh-gallery` regenerates the five gallery thumbnails and basic statistics of a global dataset.
- `POST /api/metadata/preview` reads the columns and five sample rows of a CSV or Excel file (`path`).
- `POST /api/convert-format specialise` converts an `.optional` file or every `.optional` of a folder through the optional adapter (`path`).

## Embeddings and recomputation endpoints

These endpoints of `api/datasets.py` compute or recompute the analysis of a dataset. The differences between them are summarized in the section *Recomputation paths of maps and clusters* of [Architecture](architecture.md).

- `POST /api/datasets/{id}/embed?force=false` answers 202 with `status` `started` or `already_running`, and runs the full pipeline in the job pool. `force=true` re-encodes every image. 503 if CLIP is not loaded.
- `POST /api/datasets/{id}/recluster` (202) recomputes the clusters and rarity: body `method` (`kmeans` or `hdbscan`), `n_clusters`, `min_cluster_size`. 400 before the first embeddings.
- `POST /api/datasets/{id}/reduce` (202) recomputes the 2D map of non-rejected images with explicit parameters: `method` (`umap`, `tsne`, `pca`), `umap_n_neighbors`, `umap_min_dist`, `tsne_perplexity`, `tsne_learning_rate`.
- `POST /api/datasets/{id}/remap` streams a recomputation of the 2D map with the current settings.
- `POST /api/datasets/{id}/rebuild-without-duplicates` streams a recomputation of map, KMeans clusters and rarity without rejected images, whose coordinates are cleared.
- `POST /api/datasets/{id}/reset-duplicate-filter` clears every keep or reject decision and streams a recomputation on all images.
- `POST /api/datasets/{id}/exclude-images` marks `image_ids` as rejected and returns `excluded`.

## Image and thumbnail endpoints

These endpoints serve image content; the thumbnails listed in other responses are static URLs `/thumbs/<md5>.jpg` or `/gallery-thumbs/<name>/thumbs/<n>.jpg`.

- `GET /api/datasets/{id}/images/{image_id}/full` returns the original image file (404 if it is missing on disk).
- `GET /api/images/{image_id}/thumb` returns the thumbnail, generating and caching it if needed.
- `GET /api/datasets/{id}/images/{image_id}/full-path` and `GET /api/images/{image_id}/thumb-path` return `{"native_path": ...}`, the Windows path of the same file through the share host (or `null`). They are only used by the `app-image://` protocol of VisionNexus, which falls back to the HTTP endpoint when `native_path` is `null`.

## Map, cluster and search endpoints

These endpoints of `api/explore.py` and `api/filter.py` read the results of the pipeline.

- `GET /api/datasets/{id}/map` returns `points` with `image_id`, `x`, `y`, `cluster_id`, `rarity_score`, `filename`, `thumbnail_url`, `duplicate_group_id` and `metadata`, for images with coordinates that are not rejected. 425 before the first embeddings.
- `GET /api/datasets/{id}/clusters` returns per cluster its `count`, `avg_rarity` and three sample images, rejected images excluded.
- `POST /api/datasets/{id}/semantic-search` with `query`, `top_k` (default 20) and optional `min_score`: without `min_score`, the `top_k` nearest images; with it, every image above the score (the whole index is scanned and `top_k` is ignored). Each result has `score`, `rank`, `filename`, `thumbnail_url`, `cluster_id`, `rarity_score`, `umap_x`, `umap_y`.
- `POST /api/search/global` with `query`, `top_k` (default 50), `min_score` and `dataset_ids` searches the global index; the response adds `dataset_id` and `dataset_name` to each result, plus `indexed_datasets`, `indexed_vectors` and `dataset_counts`. With `min_score`, results are cut to `top_k`.
- `POST /api/datasets/filter-by-text` ranks embedded datasets: `queries` (list, or `query` as a comma-separated string), `threshold` (default 0.25), `mode` (`union` or `intersection`), `top_thumbs`. Each result gives `matched_count`, `total_count`, `percent` and `top_images`.

## Duplicate endpoints

These endpoints of `api/duplicates.py` find near-identical images and record decisions.

- `GET /api/datasets/{id}/duplicates?threshold=0.97` returns `groups` (with `group_id` = id of the representative, `images` with `similarity_to_representative` and `is_kept`, `max_sim`), `group_count` and `duplicate_count`. It also stores `duplicate_group_id` on the images. 425 if the index is not loaded.
- `PATCH /api/datasets/{id}/duplicates/decision` with `decisions` (`image_id`, `keep`) sets `is_duplicate_kept` for images of that dataset; returns `updated`.
- `GET /api/duplicates/global` with `threshold` (default 0.97), `cross_only` (default true), `max_groups` (50) and `max_images_per_group` (24) searches the global index; groups spanning the most datasets come first, with `size`, `truncated` and `total_group_count`.
- `PATCH /api/duplicates/global/decision` sets decisions without dataset restriction.

## Subset and export endpoints

These endpoints of `api/export.py` manage subsets.

- `POST /api/subsets` with `dataset_id`, `name` and `image_ids` creates a subset from the ids that belong to that dataset (400 for an empty list, 404 if none matches) and fills its link folder.
- `GET /api/subsets?dataset_id=` lists subsets, newest first, each with its `exports`.
- `POST /api/subsets/{id}/duplicate` copies a subset under `<name>_<n>` (optional `name` as base).
- `PATCH /api/subsets/{id}/lock` with `locked`; `DELETE /api/subsets/{id}` deletes the subset and its folder, 409 if locked.
- `POST /api/subsets/{id}/export-to-annotation-app` with optional `custom_export_path` (ignored when launched by the Orchestrator) writes `<base>/<subset name>/` and records the export; returns `export_path`, `export_type`, `image_count`. 409 if this exact path was already exported.
- `GET /api/subsets/{id}/exports` lists the exports.
- `GET /api/subsets/{id}/duplicates?threshold=0.97` finds duplicates among the subset images only; `POST /api/subsets/{id}/apply-duplicate-filter` removes rejected images from the subset and returns `removed`.

## Merge endpoints

These endpoints of `api/datasets.py` create a new dataset from existing embeddings and stream their progress.

- `POST /api/datasets/merge` with `source_ids` (at least two, each with a map), `name` and `n_clusters` copies every embedded image and builds index, map, KMeans clusters and rarity. The `done` event carries the new `dataset_id`.
- `POST /api/datasets/merge-filtered` with `source_ids`, `name`, `queries` (or `query`), `threshold`, `mode` and `n_clusters` keeps only the images matching the terms, then builds index, map and clusters with the default method of the settings. 503 if CLIP is not loaded.

Merged datasets have `root_path = merged:<ids>` and are not pinned.

## Folder endpoints

These endpoints of `api/folders.py` manage the folder tree of the Gallery.

- `GET /api/folders` returns the flat list (`id`, `name`, `parent_id`, `is_global`, `uid`, `added_by`), after materializing shared folders of the registry.
- `POST /api/folders` with `name`, `parent_id` and `is_global`; a shared folder gets a `uid` and is written to `folders_registry.json`.
- `PATCH /api/folders/{id}` renames or moves a folder (400 if it would become its own parent).
- `DELETE /api/folders/{id}` deletes a folder; its subfolders and datasets move to its parent.

## Metadata endpoints

These endpoints of `api/metadata.py` query the CSV and Excel metadata attached to datasets.

- `POST /api/metadata/search` with `query`, `dataset_ids`, `mode` (`and` or `or`), `limit` (default 100) and `offset` runs a full-text search; returns `total`, `items` (image, dataset, thumbnail, cluster, rarity, `metadata`), `dataset_counts` and `indexed_datasets`. Datasets with metadata but no index are indexed on the fly.
- `GET /api/metadata/columns` lists every column with the datasets that have it, and `groups` of columns considered equivalent.
- `GET /api/metadata/facets?column=&dataset_ids=&limit=50` returns the distinct values of a column with their image counts.
- `POST /api/metadata/suggest-mapping` with `columns` (and optional `exclude_dataset_id`) returns `suggested_key_column` and `mapping` to known columns with a score.
- `POST /api/metadata/reindex?dataset_id=` rebuilds the index of one or every dataset.

## Settings, samples, docs and application endpoints

These endpoints configure the workspace and describe the running instance.

- `GET /api/settings` returns the settings; `PUT /api/settings` replaces them. The body must be the complete object: `workspace_path` and `annotation_app_imports_path` are required, and `workspace_path` and `user_name` are always overwritten from the environment.
- `GET /api/samples/datasets` and `GET /api/samples/datasets/{sample_id}` describe the tutorial sample folders (`path` on the backend, `exists`, `image_count`); 404 when the folder is missing.
- `GET /api/docs?lang=`, `GET /api/docs/{name}?lang=` and `GET /api/docs/assets/{path}` serve the pages of this documentation to the help page, with fallback to the other language; page names are restricted to the suite manifest.
- `GET /health` returns `status`, `clip_loaded`, `device`, `jobs` and `job_workers`.
- `GET /api/capabilities` lists the optional format adapters (`specific_formats`).
- `GET /api/app-mode` returns `mode` (`solo` or `orchestrator`), `subsets_dir`, `annotation_imports_dir` and `workspace`.
- `GET /api/audit?limit=100&action=` returns the latest audit entries (`dataset.delete`, `dataset.delete_global`, `subset.delete`, `subset.lock`, `subset.export`...).
- `GET /api/workspace/users`, `GET /api/workspace/history` and `POST /api/workspace/open` feed the user badge.

## Orchestrator integration endpoints

These endpoints of `api/orchestrator.py` (prefix `/api/orchestrator`) are called by the Orchestrator App. Ids take priority over names; an ambiguous name returns 409.

- `POST /load-dataset` with `name`, `root_path`, `n_clusters` (default 15), `wait_for_scan` (default true), `wait_timeout_s` (180) and `allow_duplicate`: reuses or creates the dataset, waits for the scan, pins it; returns `dataset_id`, `status`, `image_count`, `root_path` and `duplicate_of`. 504 on timeout.
- `POST /start-embed` with `dataset_name`, `dataset_id`, `wait_for_ready` (default true) and `wait_timeout_s` (1800): `already_ready` for a ready dataset, otherwise runs the embeddings and waits; 500 if the pipeline fails, 504 on timeout.
- `POST /create-subset` with `dataset_name`, `dataset_id`, `subset_name`, `query`, `top_k` (default 80), `min_score` and `source_subset_name`: text search, then a subset replacing any subset of the same name; 404 when nothing matches.
- `POST /export-subset` with `subset_name`, `subset_id`, `dataset_id` and `annotation_imports_path`: replaces the previous export folder and writes the new one; returns `export_path` and `image_count`.
- `GET /status?dataset_name=` returns the status of one dataset, or the list of all datasets without a name.

## Endpoint index

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
