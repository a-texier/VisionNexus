*[Lire en francais](developer-guide.fr.md)*

# Developer Guide - Dataset Explorer

Installation, getting started and troubleshooting. For the architecture (ML pipeline, DB schema,
data flow), see [architecture.md](architecture.md).

---

## Prerequisites

| Tool | Version | Notes |
|-------|---------|-------|
| Python | 3.12 | Conda env `IA_env` |
| Node.js | 18+ | For the React frontend |
| npm | 10+ | |
| CUDA | 12.8 | Recommended (CPU also supported) |

### Required Python packages

```bash
# Already in IA_env
torch>=2.0, fastapi, numpy, pillow, scipy, scikit-learn

# Added for Dataset Explorer
open_clip_torch, faiss-cpu, umap-learn, sqlmodel, hdbscan
aiofiles, python-multipart
```

---

## Full installation (first time)

```bash
# 1. Move into the app folder
cd <suite-root>/Dataset_Explorer_App

# 2. Install the missing Python dependencies
conda activate IA_env
pip install open_clip_torch faiss-cpu umap-learn sqlmodel hdbscan aiofiles python-multipart

# 3. Install the frontend dependencies
cd frontend
npm install
cd ..

# 4. Launch
python launcher.py
```

### Windows symlinks

Windows symlinks require **Developer mode** or **admin rights**:
- Settings -> For developers -> Developer mode: ON
- Or: run the terminal as administrator

Configurable in Settings -> "Subsets & links": symlink (default) or physical copy.
Implementation: `backend/core/subset_manager.py::_make_symlink()`.

---

## Tests

```bash
# All tests
python -m pytest backend/tests/ -v

# With a real dataset
$env:TEST_DATASET_DIR="D:\datasets\images"
python -m pytest backend/tests/ -v
```

**test_embedder.py**:
- `test_md5_stability` - stable hashlib
- `test_embed_single_image` - shape (1,512), L2-norm close to 1
- `test_embed_batch` - consistent batch
- `test_thumbnail_generation` - thumbnail <=256px

**test_indexer.py**:
- `test_build_and_search_self` - top-1 = itself
- `test_duplicate_detection` - 2 pairs -> 2 groups
- `test_index_persistence` - write + read + search
- `test_no_duplicates_below_threshold` - distinct vectors

**test_semantic.py**:
- `test_embed_text_shape` - (512,), L2-norm
- `test_embed_text_different_queries` - different queries -> different vectors
- `test_semantic_search_returns_top_k` - correct count, decreasing scores

---

## Integration with Annotation App

### Exporting a subset

```
Dataset_Explorer_App (subset "pedestrians")
    v  POST /api/subsets/{id}/export-to-annotation-app
Annotation_App/data/imports/pedestrians/
    |-- image1.jpg -> symlink -> original path
    `-- image2.jpg -> symlink -> original path
    v  In Annotation App: Import a folder
New Annotation App project with the subset's images
```

### Workspace

Annotation App: `ANNOTATION_WORKSPACE` -> `data/annotation.db`
Dataset Explorer: `EXPLORER_WORKSPACE` -> `data/dataset_explorer.db`

The two apps are independent, connected only by the export symlinks.

Import path configurable via environment variable:
```bash
ANNOTATION_APP_IMPORTS=D:\other\path python launcher.py
```

---

## Troubleshooting

### FAISS index not found at startup
```
[warning] FAISS index not reloaded for dataset X : ...
```
Re-run `/embed` to rebuild the index. Can happen if the workspace has been
moved.

### Symlinks fail (Windows)
```
[subset_manager] WARNING: Symlink impossible pour {filename}, fallback copie
```
Enable Windows developer mode: Settings -> For developers -> Developer
mode.

### CUDA Out of Memory during embedding
Reduce `BATCH_SIZE` in `backend/config.py` (default: 64 -> try 16 or 32).

### UMAP takes too long
On very large datasets (>50k images), increase `UMAP_N_NEIGHBORS` or use a
fallback. UMAP is O(n log n) with the cosine metric.

### Frontend does not see the backend
Check that the backend is running on port 8001: `GET http://localhost:8001/health`.

### SSE requests failing silently
Check that the real Vite port is listed in `CORS_ORIGINS` (generated dynamically by
`backend/config.py` from the frontend port; ports 5173-5175 are always
allowed).
