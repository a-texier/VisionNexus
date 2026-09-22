*[Lire en francais](README.fr.md)*

# Dataset Explorer

Semantic explorer for image datasets. The pipeline encodes every image with CLIP
(ViT-B-32), indexes the embeddings in FAISS for similarity search and duplicate
detection, projects the 512D space into 2D (UMAP / t-SNE / PCA) for the interactive
map, and groups images by clustering (KMeans / HDBSCAN) with a per-image rarity
score. The user visually explores their datasets, creates subsets (lasso on the map,
semantic text search, multi-dataset CLIP filtering), manages duplicates, then exports
the subsets to Annotation_App for annotation.

## Architecture

- **Backend**: FastAPI + SQLModel (SQLite WAL) + PyTorch/open_clip + FAISS + UMAP/t-SNE/scikit-learn.
  ML logic isolated in `backend/core/` (no FastAPI dependency), routers per domain
  in `backend/api/`.
- **Frontend**: React 18 + TypeScript 5 + Vite 6, TanStack Query (server cache), Zustand
  (global image selection), Plotly.js (UMAP scatter + lasso), Tailwind CSS (dark mode
  by default).
- **Data**: everything is stored in a user workspace external to the source code
  (`EXPLORER_WORKSPACE`): SQLite database, FAISS index, thumbnails, subsets. A global
  gallery (fixed path, independent of the workspace) allows sharing datasets between
  users.
- **Long tasks**: embeddings, clustering, 2D reduction and thumbnail scanning run
  in the background (non-blocking), tracked via polling or SSE depending on the endpoint.

Full detail: [docs/architecture.md](docs/architecture.md).

## Quick start

```bash
# Recommended: via the launcher (from anywhere)
python <suite-root>/launcher.py --app explorer --workspace <workspaces-root> --user <username>

# Manual, from Dataset_Explorer_App/
conda activate IA_env
BACKEND_PORT=8001 EXPLORER_FRONTEND_PORT=5173 uvicorn backend.main:app --host 0.0.0.0 --port 8001 --reload
cd frontend && VITE_BACKEND_PORT=8001 npm run dev -- --port 5173
```

Default frontend: http://localhost:5173
Default backend: http://localhost:8001

Full installation (Python/Node dependencies, first time): see
[docs/developer-guide.md](docs/developer-guide.md).

## Documentation

- [docs/README.md](docs/README.md): thematic index of the full documentation.

## Optional Format Adapter

format specialise support is isolated in `backend/utils/format specialise.py`. The backend publishes the adapters
physically present via `GET /api/capabilities`; the frontend help only shows the
matching section if this list is not empty. Removing this file and restarting therefore
removes any format specialise option from the interface without affecting standard image datasets.
