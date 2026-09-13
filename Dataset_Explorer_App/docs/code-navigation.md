# Code Navigation - Dataset Explorer

Guide de navigation dans le code source.

---

## Structure globale

```
Dataset_Explorer_App/
|-- launcher.py            # Point d'entree unique - lance backend + frontend
|-- backend/
|   |-- main.py            # App FastAPI, lifespan, routers, CORS, static
|   |-- config.py          # Toutes les constantes et chemins (workspace)
|   |-- core/              # Logique ML - aucune dependance FastAPI
|   |-- api/               # Routers FastAPI - 1 fichier = 1 domaine
|   |-- db/                # ORM SQLModel + engine SQLite
|   `-- tests/             # Tests pytest
|-- frontend/
|   `-- src/
|       |-- App.tsx         # Router React + layout sidebar
|       |-- pages/          # Une page = une route
|       |-- components/     # Composants reutilisables
|       |-- hooks/          # Logique donnees (TanStack Query + Zustand)
|       |-- api/            # Client API type (axios + fetch SSE)
|       `-- types/          # Interfaces TypeScript
`-- data/                  # Workspace utilisateur (gitignored)
```

---

## Backend - ou trouver quoi

### Points d'entree API

| Fonctionnalite | Fichier | Endpoint |
|---------------|---------|----------|
| Scanner un dossier | `api/datasets.py` | `POST /api/datasets` |
| Lancer les embeddings | `api/datasets.py` | `POST /api/datasets/{id}/embed` |
| Liste des images | `api/datasets.py` | `GET /api/datasets/{id}/images` |
| Carte UMAP | `api/explore.py` | `GET /api/datasets/{id}/map` |
| Liste clusters | `api/explore.py` | `GET /api/datasets/{id}/clusters` |
| Recherche semantique | `api/filter.py` | `POST /api/datasets/{id}/semantic-search` |
| Detection doublons | `api/duplicates.py` | `GET /api/datasets/{id}/duplicates` |
| Decisions doublons | `api/duplicates.py` | `PATCH /api/datasets/{id}/duplicates/decision` |
| Creer un subset | `api/export.py` | `POST /api/subsets` |
| Exporter Annotation App | `api/export.py` | `POST /api/subsets/{id}/export-to-annotation-app` |
| Health check | `main.py` | `GET /health` |

### Modules core - logique ML

| Module | Singleton | Responsabilite |
|--------|-----------|----------------|
| `core/embedder.py` | `clip_embedder` | CLIP ViT-B-32, thumbnails, MD5 |
| `core/indexer.py` | `faiss_indexer` | FAISS IndexFlatIP, doublons BFS |
| `core/reducer.py` | `umap_reducer` | UMAP 2D, fallback t-SNE/PCA |
| `core/clusterer.py` | `clusterer` | KMeans, HDBSCAN, rarity scores |
| `core/semantic_filter.py` | - | text -> FAISS -> resultats |
| `core/subset_manager.py` | - | symlinks, export Annotation App |

### Schema DB - `db/models.py`

Tables et relations completes : voir [architecture.md](architecture.md#base-de-donnees)
(schema, invariant FAISS<->DB).

Champs critiques sur `Image` :
- `umap_x`, `umap_y` - coordonnees 2D (remplies par UMAP)
- `cluster_id` - label KMeans
- `rarity_score` - [0,1] distance au centroide normalisee
- `md5` - hash du fichier, cle de cache thumbnails
- `duplicate_group_id` - groupe de doublons (= image_id du representant)

### Config - `backend/config.py`

Toutes les constantes sont ici. En modifier une seule fois suffit.

Cles importantes :
- `WORKSPACE` - racine du workspace (env: `EXPLORER_WORKSPACE`)
- `THUMBS_DIR` - `WORKSPACE/thumbs/`
- `FAISS_DIR` - `WORKSPACE/faiss/`
- `SUBSETS_DIR` - `WORKSPACE/subsets/`
- `ANNOTATION_APP_IMPORTS` - chemin d'import Annotation App

---

## Frontend - ou trouver quoi

### Pages (routes)

| Route | Fichier | Description |
|-------|---------|-------------|
| `/` | `pages/Dashboard.tsx` | Stats, liste datasets, ajout, lancement embedding |
| `/datasets/:id/map` | `pages/DatasetMap.tsx` | Scatter UMAP, lasso select, filtres |
| `/datasets/:id/search` | `pages/SemanticSearch.tsx` | Recherche texte -> grille resultats |
| `/datasets/:id/duplicates` | `pages/DuplicateExplorer.tsx` | Groupes doublons, keep/reject |
| `/subsets` | `pages/SubsetManager.tsx` | Liste subsets, export Annotation App |

### Composants cles

| Composant | Fichier | Description |
|-----------|---------|-------------|
| `ImageCard` | `components/ImageCard.tsx` | Thumbnail + badges cluster/rarete + checkbox |
| `ImageGrid` | `components/ImageGrid.tsx` | Grille CSS avec selection multi |
| `ScatterPlot` | `components/ScatterPlot.tsx` | Plotly scatter, lasso -> `onSelected(ids[])` |
| `FilterBar` | `components/FilterBar.tsx` | Mode couleur, filtre cluster, slider rarete |

### Hooks

| Hook | Fichier | Usage |
|------|---------|-------|
| `useDatasets()` | `hooks/useDataset.ts` | Liste tous les datasets |
| `useDataset(id)` | `hooks/useDataset.ts` | Dataset avec cluster_distribution |
| `useDatasetMap(id)` | `hooks/useDataset.ts` | Points UMAP pour le scatter |
| `useDatasetClusters(id)` | `hooks/useDataset.ts` | Infos clusters |
| `useSelectionStore` | `hooks/useSubset.ts` | Zustand - selection globale d'image_ids |
| `useCreateSubset()` | `hooks/useSubset.ts` | Creer subset depuis la selection |

### API client - `src/api/client.ts`

```typescript
import { datasetsAPI, subsetsAPI, startEmbedding } from './api/client'

// Exemples
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
stop() // annuler
```

### Types TypeScript - `src/types/api.ts`

Toutes les interfaces API sont ici : `DatasetSummary`, `DatasetDetail`, `ImageSummary`, `MapPoint`, `MapData`, `ClusterInfo`, `SearchResult`, `DuplicateGroup`, `SubsetSummary`, `EmbedEvent`.

---

## Flux de donnees principal

Flux complet (statuts, phases du pipeline, poll de progression) :
[architecture.md](architecture.md#flux-dajout-dun-dataset). Resume :

```
[Fichiers sur disque] -> POST /api/datasets (scan) -> POST /api/datasets/{id}/embed (fond, poll)
  -> GET /api/datasets/{id}/map -> [ScatterPlot.tsx] lasso -> POST /api/subsets
  -> POST /api/subsets/{id}/export-to-annotation-app -> Annotation_App/data/imports/{name}/
```

---

## Ajouter un endpoint

1. Choisir le router existant dans `backend/api/` ou en creer un nouveau
2. Ajouter le router dans `backend/main.py` avec `app.include_router(...)`
3. Ajouter la fonction dans `frontend/src/api/client.ts`
4. Ajouter l'interface dans `frontend/src/types/api.ts` si nouvelle reponse
