*[Lire en francais](code-navigation.fr.md)*

# Code Navigation - Dataset Explorer

Guide to navigating the source code.

---

## Overall structure

```
Dataset_Explorer_App/
|-- launcher.py            # Single entry point - launches backend + frontend
|-- backend/
|   |-- main.py            # FastAPI app, lifespan, routers, CORS, static
|   |-- config.py          # All constants and paths (workspace)
|   |-- core/              # ML logic - no FastAPI dependency
|   |-- api/               # FastAPI routers - 1 file = 1 domain
|   |-- db/                # SQLModel ORM + SQLite engine
|   `-- tests/             # pytest tests
|-- frontend/
|   `-- src/
|       |-- App.tsx         # React router + sidebar layout
|       |-- pages/          # One page = one route
|       |-- components/     # Reusable components
|       |-- hooks/          # Data logic (TanStack Query + Zustand)
|       |-- api/            # Typed API client (axios + SSE fetch)
|       `-- types/          # TypeScript interfaces
`-- data/                  # User workspace (gitignored)
```

---

## Backend - where to find what

### API entry points

| Feature | File | Endpoint |
|---------------|---------|----------|
| Scan a folder | `api/datasets.py` | `POST /api/datasets` |
| Run the embeddings | `api/datasets.py` | `POST /api/datasets/{id}/embed` |
| List images | `api/datasets.py` | `GET /api/datasets/{id}/images` |
| UMAP map | `api/explore.py` | `GET /api/datasets/{id}/map` |
| List clusters | `api/explore.py` | `GET /api/datasets/{id}/clusters` |
| Semantic search | `api/filter.py` | `POST /api/datasets/{id}/semantic-search` |
| Duplicate detection | `api/duplicates.py` | `GET /api/datasets/{id}/duplicates` |
| Duplicate decisions | `api/duplicates.py` | `PATCH /api/datasets/{id}/duplicates/decision` |
| Create a subset | `api/export.py` | `POST /api/subsets` |
| Export to Annotation App | `api/export.py` | `POST /api/subsets/{id}/export-to-annotation-app` |
| Health check | `main.py` | `GET /health` |

### Core modules - ML logic

| Module | Singleton | Responsibility |
|--------|-----------|----------------|
| `core/embedder.py` | `clip_embedder` | CLIP ViT-B-32, thumbnails, MD5 |
| `core/indexer.py` | `faiss_indexer` | FAISS IndexFlatIP, BFS duplicates |
| `core/reducer.py` | `umap_reducer` | UMAP 2D, t-SNE/PCA fallback |
| `core/clusterer.py` | `clusterer` | KMeans, HDBSCAN, rarity scores |
| `core/semantic_filter.py` | - | text -> FAISS -> results |
| `core/subset_manager.py` | - | symlinks, Annotation App export |

### DB schema - `db/models.py`

Full tables and relations: see [architecture.md](architecture.md#database)
(schema, FAISS<->DB invariant).

Key fields on `Image`:
- `umap_x`, `umap_y` - 2D coordinates (filled by UMAP)
- `cluster_id` - KMeans label
- `rarity_score` - [0,1] normalized distance to centroid
- `md5` - file hash, thumbnail cache key
- `duplicate_group_id` - duplicate group (= image_id of the representative)

### Config - `backend/config.py`

All constants live here. Changing one is enough.

Important keys:
- `WORKSPACE` - workspace root (env: `EXPLORER_WORKSPACE`)
- `THUMBS_DIR` - `WORKSPACE/thumbs/`
- `FAISS_DIR` - `WORKSPACE/faiss/`
- `SUBSETS_DIR` - `WORKSPACE/subsets/`
- `ANNOTATION_APP_IMPORTS` - Annotation App import path

---

## Frontend - where to find what

### Pages (routes)

| Route | File | Description |
|-------|---------|-------------|
| `/` | `pages/Dashboard.tsx` | Stats, dataset list, add, launch embedding |
| `/datasets/:id/map` | `pages/DatasetMap.tsx` | UMAP scatter, lasso select, filters |
| `/datasets/:id/search` | `pages/SemanticSearch.tsx` | Text search -> results grid |
| `/datasets/:id/duplicates` | `pages/DuplicateExplorer.tsx` | Duplicate groups, keep/reject |
| `/subsets` | `pages/SubsetManager.tsx` | Subset list, Annotation App export |

### Key components

| Component | File | Description |
|-----------|---------|-------------|
| `ImageCard` | `components/ImageCard.tsx` | Thumbnail + cluster/rarity badges + checkbox |
| `ImageGrid` | `components/ImageGrid.tsx` | CSS grid with multi-select |
| `ScatterPlot` | `components/ScatterPlot.tsx` | Plotly scatter, lasso -> `onSelected(ids[])` |
| `FilterBar` | `components/FilterBar.tsx` | Color mode, cluster filter, rarity slider |

### Hooks

| Hook | File | Usage |
|------|---------|-------|
| `useDatasets()` | `hooks/useDataset.ts` | List all datasets |
| `useDataset(id)` | `hooks/useDataset.ts` | Dataset with cluster_distribution |
| `useDatasetMap(id)` | `hooks/useDataset.ts` | UMAP points for the scatter |
| `useDatasetClusters(id)` | `hooks/useDataset.ts` | Cluster info |
| `useSelectionStore` | `hooks/useSubset.ts` | Zustand - global image_id selection |
| `useCreateSubset()` | `hooks/useSubset.ts` | Create a subset from the selection |

### API client - `src/api/client.ts`

```typescript
import { datasetsAPI, subsetsAPI, startEmbedding } from './api/client'

// Examples
datasetsAPI.list()
datasetsAPI.create({ root_path: '...', n_clusters: 20 })
datasetsAPI.getMap(1)
datasetsAPI.semanticSearch(1, 'car', 20)
datasetsAPI.getDuplicates(1, 0.97)

subsetsAPI.create({ dataset_id: 1, name: 'test', image_ids: [1,2,3] })
subsetsAPI.exportToAnnotationApp(1)

// SSE streaming
const stop = startEmbedding(datasetId, (evt) => {
  if (evt.type === 'progress') { /* ... */ }
  if (evt.type === 'done') { /* ... */ }
})
stop() // cancel
```

### TypeScript types - `src/types/api.ts`

All the API interfaces live here: `DatasetSummary`, `DatasetDetail`, `ImageSummary`, `MapPoint`, `MapData`, `ClusterInfo`, `SearchResult`, `DuplicateGroup`, `SubsetSummary`, `EmbedEvent`.

---

## Main data flow

Full flow (statuses, pipeline phases, progress poll):
[architecture.md](architecture.md#dataset-addition-flow). Summary:

```
[Files on disk] -> POST /api/datasets (scan) -> POST /api/datasets/{id}/embed (background, poll)
  -> GET /api/datasets/{id}/map -> [ScatterPlot.tsx] lasso -> POST /api/subsets
  -> POST /api/subsets/{id}/export-to-annotation-app -> Annotation_App/data/imports/{name}/
```

---

## Adding an endpoint

1. Choose an existing router in `backend/api/` or create a new one
2. Add the router in `backend/main.py` with `app.include_router(...)`
3. Add the function in `frontend/src/api/client.ts`
4. Add the interface in `frontend/src/types/api.ts` if there is a new response
