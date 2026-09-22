*[Lire en francais](architecture.fr.md)*

# Architecture

Narrative overview of the backend, the frontend, the data flow and the DB schema.
For the file/endpoint/route correspondence table, see
[code-navigation.md](code-navigation.md).

---

## FastAPI Backend

Singleton pattern per domain, instantiated once at module load:

- `clip_embedder` (`core/embedder.py`, class `CLIPEmbedder`) - CLIP model loaded once at startup
- `faiss_indexer` (`core/indexer.py`, class `FAISSIndexer`) - in-memory FAISS index per `dataset_id`
- `umap_reducer` (`core/reducer.py`, class `UMAPReducer`) - stateless, reads settings on each call
- `clusterer` (`core/clusterer.py`, class `Clusterer`) - stateless

### Lifespan (`main.py`)

1. `create_db_and_tables()` - creates the SQLite tables
2. `THUMBS_DIR`, `FAISS_DIR`, `SUBSETS_DIR` - creates the workspace folders
3. `clip_embedder.load()` - loads ViT-B-32 on GPU/CPU
4. For each dataset with `status=="ready"`: `faiss_indexer.load()` (reloads the disk index into memory)

### Core modules - ML logic (no FastAPI dependency)

```
core/
|-- embedder.py        - CLIPEmbedder: embed_images(), embed_text(), compute_md5(), generate_thumbnail()
|-- indexer.py          - FAISSIndexer: build(), load(), search(), find_duplicates()
|-- reducer.py          - UMAPReducer: reduce() -> reads settings at execution time (UMAP/t-SNE/PCA + hyperparams)
|-- clusterer.py         - Clusterer: kmeans(), hdbscan_cluster(), compute_rarity_scores()
|-- semantic_filter.py   - semantic_search() -> ranked results
|-- scorer.py             - re-exports compute_rarity_scores
|-- subset_manager.py    - create_subset_symlinks(), export_to_annotation_app()
`-- format specialise_converter.py      - read_format specialise(), convert_format specialise_to_png(), convert_path()
```

---

## Embedding pipeline

Endpoint: `POST /api/datasets/{id}/embed`. Non-blocking: launches a background task and
returns `202 {status:"started"|"already_running"}` immediately. Lock
`_embedding_ids` (in-memory dict in `api/datasets.py`) prevents a double-trigger
on a re-click. Progress is tracked by **polling** `list_datasets`
(`embed_progress` / `embed_total` / `embed_phase`), not by SSE - robust over an
SSH connection or a buffering proxy.

Successive phases: `embedding` -> `indexing` -> `umap` -> `clustering` -> `scoring`.

```
CLIPEmbedder.embed_images() -> Embedding rows (float32 blob, L2-normalized)
FAISSIndexer.build()         -> index.faiss on disk
UMAPReducer.reduce()          -> Image.umap_x, umap_y
Clusterer.kmeans()             -> Image.cluster_id, ClusterCentroid rows
Clusterer.compute_rarity_scores() -> Image.rarity_score
```

### FAISS + CLIP

```
embed_images([path1, path2, ...])
  -> PILImage -> preprocess (224x224, normalize) -> torch.Tensor
  -> model.encode_image() -> (N, 512) float32
  -> F.normalize(dim=-1) -> L2-normalized

IndexFlatIP(512).add(embeddings)
  -> dot product = cosine_similarity (L2-normalized vectors)

faiss.write_index(index, path)  # disk persistence
faiss.read_index(path)          # reload
```

### UMAP / t-SNE / PCA (2D reduction)

**Independent** block from the embedding pipeline: `POST /api/datasets/{id}/reduce` only
recomputes the 2D coordinates, without touching CLIP or the clustering. Runs in the
background (`_reduce_progress`, poll). Applied config stored in `Dataset.reduction_method` /
`reduction_params_json`, shown in the Playground and on the Map. "Reduction" button
separate from the "Clustering" button (Dashboard + Map).

```python
umap.UMAP(
    n_components=2,
    n_neighbors=min(15, n-1),  # adaptive if few images
    min_dist=0.1,
    metric="cosine",            # consistent with the CLIP space
    random_state=42,
).fit_transform(embeddings)     # -> (N, 2) float32
```

Automatic fallback: UMAP -> t-SNE (sklearn, if UMAP errors) -> PCA (if < 4 images).

Configurable in **Settings -> Dimensionality reduction**, saved in
`settings.json`:

| Settings field | Default | Description |
|---|---|---|
| `reduction_method` | `"umap"` | Method: `"umap"` \| `"tsne"` \| `"pca"` |
| `umap_n_neighbors` | `15` | UMAP: neighbors considered per point |
| `umap_min_dist` | `0.1` | UMAP: minimum distance between points |
| `tsne_perplexity` | `30` | t-SNE: local/global balance |
| `tsne_learning_rate` | `200.0` | t-SNE: learning speed |

`UMAPReducer.reduce()` calls `load_settings()` on every execution, so the parameters
are always up to date. `reduce(embeddings, params)` also accepts explicit
hyperparameters passed by the caller (otherwise it reads the settings).

### Clustering (KMeans / HDBSCAN) + rarity

`POST /api/datasets/{id}/recluster` accepts `{method, n_clusters, min_cluster_size}`
(`kmeans` | `hdbscan`), runs in the background (`_recluster_progress`). Applied config stored
in `Dataset.cluster_method` / `cluster_params_json`, shown in the Playground + Map.
Defaults in Settings (`cluster_method`, `hdbscan_min_cluster_size`).

**Clustering is always computed on the 512D CLIP embeddings
(`_apply_clustering`), never on the 2D coordinates** (distances are distorted there
by the projection).

```python
KMeans(n_clusters=k, n_init=10, random_state=42).fit_predict(embeddings)
# -> labels (N,), cluster_centers_ (k, 512)

# Rarity score per cluster:
dists = ||embedding - centroid||_2  # for each image
score = (dist - min_dist) / (max_dist - min_dist + 1e-8)  # -> [0, 1]
```

### Duplicate detection (BFS)

```python
# For each vector: find the neighbors above the threshold
for i in range(n):
    scores, indices = index.search(embedding[i:i+1], top_50)
    adjacency[i] = {j for j, s in zip(indices, scores) if s >= threshold}

# BFS -> connected components = duplicate groups
```

### Thumbnails

The initial scan is **fast**: md5 + dimensions read from the header only, no
thumbnail generated. 5 previews are generated immediately, the rest in the
**background** (`_thumb_progress`, `PIL.Image.draft()`). On-demand fallback via
`GET /api/images/{id}/thumb`. **Embeddings always read the base image
(`img.file_path`), never a thumbnail.** For `.optional` files, the `_to_png`
conversion (see below) remains the source of the images and thumbnails.

---

## Semantic search

Endpoint: `POST /api/datasets/{id}/semantic-search`

```json
{ "query": "person walking", "top_k": 20, "min_score": 0.35 }
```

- `top_k` alone (`min_score` absent): returns the N best images.
- `min_score` (0.0-1.0): returns **all** the images with a score >= threshold (`top_k`
  ignored server-side, search across the whole dataset).
- The two parameters are mutually exclusive on the frontend (Top-K / Threshold % toggle).

Frontend: `SemanticSearch.tsx`, `useThreshold` toggle -> sends `min_score = thresholdPct / 100`.
Backend: `api/filter.py`, if `min_score` is set, `effective_k = max(dataset.image_count, 1)`.

### Multi-dataset CLIP filtering

`POST /api/datasets/filter-by-text` ranks the **already embedded** datasets by
relevance against one or more text queries. Multi-query (`queries`
comma-separated), adjustable threshold (`threshold` 0-1), union mode (OR) or
intersection (AND). For each dataset: `matched_count` / `total_count` / `percent` +
the 5 best images (`top_images`, CLIP score). Sorting (absolute = matched count, relative =
%) is done client-side.

Computation: `_load_dataset_embeddings` loads the dataset's 512D matrix, `E @ term_vecs.T`
gives the cosine per image/term, `_match_scores` applies the threshold and the mode. The
results panel is shown in the Gallery (ranked cards + thumbs on the right, offset view on
the left).

---

## Database

**Engine**: synchronous SQLite, WAL mode + `busy_timeout` enabled (`db/database.py`) to
support parallel background tasks.
**ORM**: SQLModel (Pydantic + SQLAlchemy).
**File**: `WORKSPACE/dataset_explorer.db`.

| Table | Primary key | Relations |
|-------|-------------|-----------|
| `Dataset` | id | -> Image[], Subset[], ClusterCentroid[] |
| `Image` | id | -> Dataset, Embedding, SubsetImage[] |
| `Embedding` | id (unique image_id) | -> Image |
| `ClusterCentroid` | id | -> Dataset |
| `Subset` | id | -> Dataset, SubsetImage[] |
| `SubsetImage` | id | -> Subset, Image |

Key fields:
- `Dataset(id, name, root_path, status, umap_cached, faiss_index_path, cluster_method,
  cluster_params_json, reduction_method, reduction_params_json, folder_id, ...)`
- `Image(id, dataset_id, file_path, md5, umap_x, umap_y, cluster_id, rarity_score,
  duplicate_group_id, is_duplicate_kept, annotation_*, ...)`
- `Embedding(id, image_id, vector_blob bytes, dim, model_name)`
- `ClusterCentroid(id, dataset_id, cluster_id, centroid_blob bytes, size)`
- `Subset(id, dataset_id, name, symlink_dir, exported_to_annotation_app, ...)`
- `SubsetImage(id, subset_id, image_id)`
- `SubsetExport(id, subset_id, target_path, use_symlinks, created_at, ...)` - a subset can
  be exported several times to different paths

**FAISS <-> DB invariant**: position `i` in the FAISS index corresponds to the image
ranked `i` when images are sorted by `Image.id` ascending. Always use
`ORDER BY image.id` when building the index and when interpreting the results.

---

## User workspace

All persistent data lives outside the source code:

```
{WORKSPACE}/               # default: Dataset_Explorer_App/data/
|-- dataset_explorer.db            # SQLite - all tables
|-- settings.json          # user settings (playground_dataset_ids, use_symlinks...)
|-- thumbs/                # 256px thumbnails, named {md5}.jpg
|-- faiss/
|   `-- {dataset_id}/
|       `-- index.faiss    # persisted FAISS index
`-- subsets/
    `-- {subset_name}/     # symlinks to original images
```

Environment variable: `EXPLORER_WORKSPACE` (default: `<app-root>/data`).

### Global gallery (independent of the workspace)

```
data/dataset_gallery/       # FIXED path in the app, independent of EXPLORER_WORKSPACE
|-- registry.json           # minimal registry: name, root_path, image_count, n_clusters, created_at, gallery_thumb_urls, basic_stats
`-- {dataset_name}/          # REAL folder (never a symlink)
    `-- thumbs/
        |-- 0.jpg           # 5 fixed thumbnails (copied at scan time, always accessible)
        `-- ...4.jpg
```

A dataset created with `share_dataset=True` is registered in `registry.json` and its 5
thumbs are copied into `thumbs/`. Served via
`/gallery-thumbs/{name}/thumbs/{idx}.jpg` (StaticFiles on `DATASET_GALLERY_DIR`).

Display flow in the Gallery:

1. **Datasets in the workspace** (`in_workspace=True`) -> "My workspace" section ->
   Pin badge -> Playground.
2. **Global datasets not yet imported** (`is_global=True, in_workspace=False`) ->
   "Global gallery" section -> "Import" button (re-scans the `root_path`, without pinning
   into the Playground) -> then appears in "My workspace".
3. **After a workspace change**: the global datasets remain visible via
   `registry.json` (fixed path, merged with the current workspace's DB in
   `list_datasets`).

Deletion (owner only): `DELETE /api/datasets/global?root_path=...` deletes it from the
registry AND from the current workspace if present. Internal helper
`_delete_dataset_from_session(dataset_id, session)` factors out the cascade (images,
embeddings, subsets, centroids, orphan thumbnails). A non-owner user sees the icon
disabled in the Gallery.

Helpers in `api/datasets.py`: `_load_global_registry()` / `_save_global_registry()`,
`_upsert_global_registry(summary, gallery_thumb_urls, basic_stats)` (a `None` argument
keeps the existing value), `_copy_gallery_thumbnails(dataset, session)`,
`POST /api/datasets/{id}/refresh-gallery` (regenerates the thumbnails manually).

### Folders (dataset organization)

`api/folders.py` manages a `Folder` tree (personal or shared via `uid` +
`folders_registry.json`, resynced per workspace). `Dataset.folder_id` attaches a
dataset to a folder, `PATCH /api/datasets/{id}/folder` moves it. Shown as an expandable
tree in the Gallery, per section.

---

## Dataset addition flow

Statuses: `scanning -> pending -> embedding -> ready` (or `-> error`).

- `scanning`: background scan, thumbnails being generated.
- `pending`: scan finished, embeddings not yet started.
- `embedding`: CLIP+FAISS+UMAP+KMeans+scoring pipeline in progress.
- `ready`: dataset explorable.

The frontend polls every 2s while a dataset is `scanning` or `embedding`. Tracked in
memory: `_scan_progress_map: dict[int, dict]` in `api/datasets.py`.

```
[Files on disk]
       |
POST /api/datasets                      -> scan -> Image rows + MD5 + thumbnails
       |
POST /api/datasets/{id}/embed (background task, poll)
       |
       |-- CLIPEmbedder.embed_images() -> Embedding rows (float32 blob)
       |-- FAISSIndexer.build()        -> index.faiss on disk
       |-- UMAPReducer.reduce()        -> Image.umap_x, umap_y
       |-- Clusterer.kmeans()          -> Image.cluster_id, ClusterCentroid rows
       `-- Clusterer.compute_rarity_scores() -> Image.rarity_score
       |
GET /api/datasets/{id}/map              -> points [{image_id, x, y, cluster_id, rarity_score}]
       |
[ScatterPlot.tsx]                       -> Plotly scatter -> lasso -> useSelectionStore
       |
POST /api/subsets                       -> Subset + symlinks in WORKSPACE/subsets/
       |
POST /api/subsets/{id}/export-to-annotation-app
       -> symlinks in Annotation_App/data/imports/{name}/
```

---

## .optional format - conversion

The format specialise format (Optical Tile Image) is a big-endian binary:
- 48-byte header (fixed 4-byte magic) + 80 bytes of padding -> data starts at byte 128.
- Key fields: `n_img`, `n_row`, `n_col`, `deg_mult` (channels), `type_img` (dtype).
- Data: `[n_img, deg_mult, n_row, n_col]` (big-endian) -> transposed into
  `[n_img, n_row, n_col, deg_mult]`.

The generated PNGs go into `{parent}/{stem}_to_png/`. A `.optional` file can contain N images
(frames): `sequence_0000.png`, `sequence_0001.png`, etc.

If a scanned folder contains only `.optional` files (no JPG/PNG), `create_dataset`
converts automatically before scanning. For a single `.optional` file, it is converted
then the converted folder is scanned. Implementation: `backend/utils/format specialise.py`.

---

## Subsets

- **Create**: lasso on the map, semantic search, or the Subsets page (current
  selection).
- **Duplicate**: `POST /api/subsets/{id}/duplicate`, auto-numbered name `{base}_n`,
  possible even if already exported.
- **Map button**: direct link to `/datasets/{dataset_id}/map` from the
  Subsets page (visible only if UMAP has been computed).
- **Duplicates button**: active only if the subset has not yet been exported, disabled
  after export.
- **Exclude from dataset**: button in the Map's selection panel, marks
  `is_duplicate_kept=False` (reject) without going through the duplicates flow.

### Duplicates and subsets

Duplicate decisions made within a subset affect the **main dataset**:

- `Save` (SubsetDuplicatesModal) -> `PATCH /api/datasets/{id}/duplicates/decision`
  -> updates `Image.is_duplicate_kept` in the main dataset. These images are
  counted as "rejected" everywhere in the Playground.
- `Apply to subset` -> removes the images from the subset (`SubsetImage` rows deleted) without
  touching the dataset.
- To undo the decisions on the dataset: `Reset` button in the Playground
  (`POST /api/datasets/{id}/reset-duplicate-filter`).

The UI shows a warning in the modal to recall this impact.

### Merge

- **Classic manual merge**: `POST /api/datasets/merge` (Dashboard).
- **Smart merge** (SSE): `POST /api/datasets/merge-filtered` merges
  only the matched images (score > threshold) from several sources into a new
  dataset. Auto tags removed (redundant with the embeddings). `.ver`/YOLO annotations
  preserved (`core/annotation_ref.py`, `annotation_*` columns, badge, "With
  annotations" filter).

### Exports

A subset can be exported several times to different paths; each export
creates a `SubsetExport` record (`subset_export` table), shown with a blue badge
(symlink) or a purple one (copy). Symlink or physical copy configurable in
Settings -> `use_symlinks`, read at runtime by
`backend/core/subset_manager.py::_make_symlink()` (uses only `os.symlink`, no
hardlink fallback; physical copy if `use_symlinks=False`).

---

## Frontend

### Stack

- React 18 + TypeScript 5
- Vite 6 + proxy to the backend (`:8001` by default)
- Tailwind CSS 3 (dark mode by default)
- TanStack Query v5 - server cache, invalidation
- Zustand v5 - global image selection state (`useSelectionStore`)
- Plotly.js - interactive UMAP scatter, lasso select
- React Router v6 - SPA routing
- react-hot-toast - notifications

### Global state

`useSelectionStore` (Zustand): a `Set` of selected `image_id`s, persisted across
pages.
- Fed by the lasso select in `ScatterPlot`.
- Fed by the checkboxes in `ImageGrid`.
- Consumed by `SubsetManager` and `DatasetMap` to create subsets.

### Vite proxy

```typescript
// vite.config.ts
proxy: {
  '/api': { target: 'http://localhost:8001', timeout: 300000 },
  '/thumbs': { target: 'http://localhost:8001' },
}
```

300s timeout to cover long operations. For very large datasets, if the
proxy buffers, connect the frontend directly to `http://localhost:8001/api/...`.

The remaining SSE endpoints (remap/rebuild/reset/merge) go through the **same-origin
proxy** (`SSE_BASE=''` in `client.ts`) rather than a direct connection.

---

## Integration with Annotation App

Exporting a subset creates symlinks (or copies) in
`Annotation_App/data/imports/{subset_name}/`, consumable via "Import a folder"
in Annotation App. The two apps remain independent (separate SQLite workspaces),
connected only by these export links. Full detail, environment variables and
flow diagram: [developer-guide.md](developer-guide.md#integration-with-annotation-app).
