# Architecture

Vue d'ensemble narrative du backend, du frontend, du flux de donnees et du schema DB.
Pour la table de correspondance fichier/endpoint/route, voir
[code-navigation.md](code-navigation.md).

---

## Backend FastAPI

Pattern singleton par domaine, instancie une fois au chargement du module :

- `clip_embedder` (`core/embedder.py`, classe `CLIPEmbedder`) - modele CLIP charge une fois au demarrage
- `faiss_indexer` (`core/indexer.py`, classe `FAISSIndexer`) - index FAISS en memoire par `dataset_id`
- `umap_reducer` (`core/reducer.py`, classe `UMAPReducer`) - sans etat, lit les settings a chaque appel
- `clusterer` (`core/clusterer.py`, classe `Clusterer`) - sans etat

### Lifespan (`main.py`)

1. `create_db_and_tables()` - cree les tables SQLite
2. `THUMBS_DIR`, `FAISS_DIR`, `SUBSETS_DIR` - creation des dossiers workspace
3. `clip_embedder.load()` - charge ViT-B-32 sur GPU/CPU
4. Pour chaque dataset `status=="ready"` : `faiss_indexer.load()` (recharge l'index disque en memoire)

### Modules core - logique ML (aucune dependance FastAPI)

```
core/
|-- embedder.py        - CLIPEmbedder : embed_images(), embed_text(), compute_md5(), generate_thumbnail()
|-- indexer.py          - FAISSIndexer : build(), load(), search(), find_duplicates()
|-- reducer.py          - UMAPReducer : reduce() -> lit settings a l'execution (UMAP/t-SNE/PCA + hyperparams)
|-- clusterer.py         - Clusterer : kmeans(), hdbscan_cluster(), compute_rarity_scores()
|-- semantic_filter.py   - semantic_search() -> resultats classes
|-- scorer.py             - re-export compute_rarity_scores
|-- subset_manager.py    - create_subset_symlinks(), export_to_annotation_app()
`-- format specialise_converter.py      - read_format specialise(), convert_format specialise_to_png(), convert_path()
```

---

## Pipeline d'embedding

Endpoint : `POST /api/datasets/{id}/embed`. Non bloquant : lance une tache de fond et
renvoie immediatement `202 {status:"started"|"already_running"}`. Verrou
`_embedding_ids` (dict en memoire dans `api/datasets.py`) empeche un double-declenchement
sur re-clic. La progression est suivie par **poll** de `list_datasets`
(`embed_progress` / `embed_total` / `embed_phase`), pas par SSE - robuste en connexion
SSH ou proxy qui bufferise.

Phases successives : `embedding` -> `indexing` -> `umap` -> `clustering` -> `scoring`.

```
CLIPEmbedder.embed_images() -> Embedding rows (float32 blob, L2-normalise)
FAISSIndexer.build()         -> index.faiss sur disque
UMAPReducer.reduce()          -> Image.umap_x, umap_y
Clusterer.kmeans()             -> Image.cluster_id, ClusterCentroid rows
Clusterer.compute_rarity_scores() -> Image.rarity_score
```

### FAISS + CLIP

```
embed_images([path1, path2, ...])
  -> PILImage -> preprocess (224x224, normalize) -> torch.Tensor
  -> model.encode_image() -> (N, 512) float32
  -> F.normalize(dim=-1) -> L2-normalise

IndexFlatIP(512).add(embeddings)
  -> produit scalaire = cosine_similarity (vecteurs L2-normalises)

faiss.write_index(index, path)  # persistance disque
faiss.read_index(path)          # rechargement
```

### UMAP / t-SNE / PCA (reduction 2D)

Bloc **independant** du pipeline d'embedding : `POST /api/datasets/{id}/reduce` recalcule
uniquement les coordonnees 2D, sans retoucher CLIP ni le clustering. Tourne en fond
(`_reduce_progress`, poll). Config appliquee stockee dans `Dataset.reduction_method` /
`reduction_params_json`, affichee dans le Playground et sur la Carte. Bouton
"Reduction" separe du bouton "Clustering" (Dashboard + Carte).

```python
umap.UMAP(
    n_components=2,
    n_neighbors=min(15, n-1),  # adaptatif si peu d'images
    min_dist=0.1,
    metric="cosine",            # coherent avec l'espace CLIP
    random_state=42,
).fit_transform(embeddings)     # -> (N, 2) float32
```

Fallback automatique : UMAP -> t-SNE (sklearn, si erreur UMAP) -> PCA (si < 4 images).

Configurable dans **Parametres -> Reduction dimensionnelle**, sauvegarde dans
`settings.json` :

| Champ settings | Defaut | Description |
|---|---|---|
| `reduction_method` | `"umap"` | Methode : `"umap"` \| `"tsne"` \| `"pca"` |
| `umap_n_neighbors` | `15` | UMAP : voisins consideres par point |
| `umap_min_dist` | `0.1` | UMAP : distance minimale entre points |
| `tsne_perplexity` | `30` | t-SNE : balance local/global |
| `tsne_learning_rate` | `200.0` | t-SNE : vitesse d'apprentissage |

`UMAPReducer.reduce()` appelle `load_settings()` a chaque execution, donc les parametres
sont toujours a jour. `reduce(embeddings, params)` accepte aussi des hyperparametres
explicites passes par l'appelant (sinon lit les settings).

### Clustering (KMeans / HDBSCAN) + rarete

`POST /api/datasets/{id}/recluster` accepte `{method, n_clusters, min_cluster_size}`
(`kmeans` | `hdbscan`), tourne en fond (`_recluster_progress`). Config appliquee stockee
dans `Dataset.cluster_method` / `cluster_params_json`, affichee Playground + Carte.
Defauts dans Parametres (`cluster_method`, `hdbscan_min_cluster_size`).

**Le clustering est toujours calcule sur les embeddings CLIP 512D
(`_apply_clustering`), jamais sur les coordonnees 2D** (les distances y sont deformees
par la projection).

```python
KMeans(n_clusters=k, n_init=10, random_state=42).fit_predict(embeddings)
# -> labels (N,), cluster_centers_ (k, 512)

# Score rarete par cluster :
dists = ||embedding - centroid||_2  # pour chaque image
score = (dist - min_dist) / (max_dist - min_dist + 1e-8)  # -> [0, 1]
```

### Detection de doublons (BFS)

```python
# Pour chaque vecteur : chercher les voisins au-dessus du seuil
for i in range(n):
    scores, indices = index.search(embedding[i:i+1], top_50)
    adjacency[i] = {j for j, s in zip(indices, scores) if s >= threshold}

# BFS -> composantes connexes = groupes de doublons
```

### Thumbnails

Le scan initial est **rapide** : md5 + dimensions lues depuis le header seulement, pas de
thumbnail genere. 5 apercus sont generes immediatement, le reste en **tache de fond**
(`_thumb_progress`, `PIL.Image.draft()`). Fallback a la demande via
`GET /api/images/{id}/thumb`. **Les embeddings lisent toujours l'image de base
(`img.file_path`), jamais un thumbnail.** Pour les fichiers `.optional`, la conversion
`_to_png` (voir plus bas) reste la source des images et des thumbnails.

---

## Recherche semantique

Endpoint : `POST /api/datasets/{id}/semantic-search`

```json
{ "query": "person walking", "top_k": 20, "min_score": 0.35 }
```

- `top_k` seul (`min_score` absent) : retourne les N meilleures images.
- `min_score` (0.0-1.0) : retourne **toutes** les images avec score >= seuil (`top_k`
  ignore cote serveur, recherche sur tout le dataset).
- Les deux parametres sont mutuellement exclusifs cote frontend (toggle Top-K / Seuil %).

Frontend : `SemanticSearch.tsx`, toggle `useThreshold` -> envoie `min_score = thresholdPct / 100`.
Backend : `api/filter.py`, si `min_score` defini, `effective_k = max(dataset.image_count, 1)`.

### Filtrage CLIP multi-dataset

`POST /api/datasets/filter-by-text` classe les datasets **deja embeddes** par
pertinence par rapport a une ou plusieurs requetes texte. Multi-requete (`queries`
separees par virgules), seuil reglable (`threshold` 0-1), mode union (OR) ou
intersection (AND). Pour chaque dataset : `matched_count` / `total_count` / `percent` +
les 5 meilleures images (`top_images`, score CLIP). Le tri (absolu = nb matche, relatif =
%) se fait cote client.

Calcul : `_load_dataset_embeddings` charge la matrice 512D du dataset, `E @ term_vecs.T`
donne le cosine par image/terme, `_match_scores` applique le seuil et le mode. Le panneau
de resultats s'affiche dans la Gallery (cartes rangees + thumbs a droite, vue decalee a
gauche).

---

## Base de donnees

**Engine** : SQLite synchrone, mode WAL + `busy_timeout` actives (`db/database.py`) pour
supporter les taches de fond paralleles.
**ORM** : SQLModel (Pydantic + SQLAlchemy).
**Fichier** : `WORKSPACE/dataset_explorer.db`.

| Table | Cle primaire | Relations |
|-------|-------------|-----------|
| `Dataset` | id | -> Image[], Subset[], ClusterCentroid[] |
| `Image` | id | -> Dataset, Embedding, SubsetImage[] |
| `Embedding` | id (unique image_id) | -> Image |
| `ClusterCentroid` | id | -> Dataset |
| `Subset` | id | -> Dataset, SubsetImage[] |
| `SubsetImage` | id | -> Subset, Image |

Champs cles :
- `Dataset(id, name, root_path, status, umap_cached, faiss_index_path, cluster_method,
  cluster_params_json, reduction_method, reduction_params_json, folder_id, ...)`
- `Image(id, dataset_id, file_path, md5, umap_x, umap_y, cluster_id, rarity_score,
  duplicate_group_id, is_duplicate_kept, annotation_*, ...)`
- `Embedding(id, image_id, vector_blob bytes, dim, model_name)`
- `ClusterCentroid(id, dataset_id, cluster_id, centroid_blob bytes, size)`
- `Subset(id, dataset_id, name, symlink_dir, exported_to_annotation_app, ...)`
- `SubsetImage(id, subset_id, image_id)`
- `SubsetExport(id, subset_id, target_path, use_symlinks, created_at, ...)` - un subset peut
  etre exporte plusieurs fois vers des chemins differents

**Invariant FAISS <-> DB** : la position `i` dans l'index FAISS correspond a l'image de
rang `i` quand les images sont triees par `Image.id` ascendant. Toujours utiliser
`ORDER BY image.id` a la construction de l'index et a l'interpretation des resultats.

---

## Workspace utilisateur

Toutes les donnees persistantes vivent hors du code source :

```
{WORKSPACE}/               # defaut : Dataset_Explorer_App/data/
|-- dataset_explorer.db            # SQLite - toutes les tables
|-- settings.json          # parametres utilisateur (playground_dataset_ids, use_symlinks...)
|-- thumbs/                # miniatures 256px, nommees {md5}.jpg
|-- faiss/
|   `-- {dataset_id}/
|       `-- index.faiss    # index FAISS persiste
`-- subsets/
    `-- {subset_name}/     # symlinks vers images originales
```

Variable d'environnement : `EXPLORER_WORKSPACE` (defaut : `<racine_app>/data`).

### Galerie globale (independante du workspace)

```
data/dataset_gallery/       # chemin FIXE dans l'app, independant de EXPLORER_WORKSPACE
|-- registry.json           # registre minimal : name, root_path, image_count, n_clusters, created_at, gallery_thumb_urls, basic_stats
`-- {nom_dataset}/          # dossier REEL (jamais un symlink)
    `-- thumbs/
        |-- 0.jpg           # 5 miniatures fixes (copiees au scan, toujours accessibles)
        `-- ...4.jpg
```

Un dataset cree avec `share_dataset=True` est enregistre dans `registry.json` et ses 5
thumbs sont copiees dans `thumbs/`. Servies via
`/gallery-thumbs/{name}/thumbs/{idx}.jpg` (StaticFiles sur `DATASET_GALLERY_DIR`).

Flux d'affichage dans la Gallery :

1. **Datasets dans le workspace** (`in_workspace=True`) -> section "Mon workspace" ->
   badge Pin -> Playground.
2. **Datasets globaux pas encore importes** (`is_global=True, in_workspace=False`) ->
   section "Galerie globale" -> bouton "Importer" (re-scan du `root_path`, sans epingler
   dans le Playground) -> apparait ensuite dans "Mon workspace".
3. **Apres changement de workspace** : les datasets globaux restent visibles via
   `registry.json` (chemin fixe, fusionne avec la DB du workspace courant dans
   `list_datasets`).

Suppression (owner uniquement) : `DELETE /api/datasets/global?root_path=...` supprime du
registre ET du workspace courant si present. Helper interne
`_delete_dataset_from_session(dataset_id, session)` factorise la cascade (images,
embeddings, subsets, centroides, thumbnails orphelines). Un utilisateur non-owner voit
l'icone desactivee dans la Gallery.

Helpers dans `api/datasets.py` : `_load_global_registry()` / `_save_global_registry()`,
`_upsert_global_registry(summary, gallery_thumb_urls, basic_stats)` (un argument `None`
conserve la valeur existante), `_copy_gallery_thumbnails(dataset, session)`,
`POST /api/datasets/{id}/refresh-gallery` (regenere les miniatures manuellement).

### Dossiers (organisation des datasets)

`api/folders.py` gere un arbre `Folder` (personnel ou partage via `uid` +
`folders_registry.json`, resynchronise par workspace). `Dataset.folder_id` rattache un
dataset a un dossier, `PATCH /api/datasets/{id}/folder` le deplace. Affiche en arbre
depliable dans la Gallery, par section.

---

## Flux d'ajout d'un dataset

Statuts : `scanning -> pending -> embedding -> ready` (ou `-> error`).

- `scanning` : scan en arriere-plan, miniatures en cours de generation.
- `pending` : scan termine, embeddings pas encore lances.
- `embedding` : pipeline CLIP+FAISS+UMAP+KMeans+scoring en cours.
- `ready` : dataset explorable.

Le frontend poll toutes les 2s tant qu'un dataset est `scanning` ou `embedding`. Suivi en
memoire : `_scan_progress_map: dict[int, dict]` dans `api/datasets.py`.

```
[Fichiers sur disque]
       |
POST /api/datasets                      -> scan -> Image rows + MD5 + thumbnails
       |
POST /api/datasets/{id}/embed (tache de fond, poll)
       |
       |-- CLIPEmbedder.embed_images() -> Embedding rows (float32 blob)
       |-- FAISSIndexer.build()        -> index.faiss sur disque
       |-- UMAPReducer.reduce()        -> Image.umap_x, umap_y
       |-- Clusterer.kmeans()          -> Image.cluster_id, ClusterCentroid rows
       `-- Clusterer.compute_rarity_scores() -> Image.rarity_score
       |
GET /api/datasets/{id}/map              -> points [{image_id, x, y, cluster_id, rarity_score}]
       |
[ScatterPlot.tsx]                       -> Plotly scatter -> lasso -> useSelectionStore
       |
POST /api/subsets                       -> Subset + symlinks dans WORKSPACE/subsets/
       |
POST /api/subsets/{id}/export-to-annotation-app
       -> symlinks dans Annotation_App/data/imports/{name}/
```

---

## Format .optional - conversion

Le format format specialise (Optical Tile Image) est un binaire big-endian :
- Header 48 octets (magic fixe 4 octets) + 80 octets de padding -> donnees a l'octet 128.
- Champs cles : `n_img`, `n_row`, `n_col`, `deg_mult` (canaux), `type_img` (dtype).
- Donnees : `[n_img, deg_mult, n_row, n_col]` (big-endian) -> transposees en
  `[n_img, n_row, n_col, deg_mult]`.

Les PNG generes vont dans `{parent}/{stem}_to_png/`. Un `.optional` peut contenir N images
(frames) : `sequence_0000.png`, `sequence_0001.png`, etc.

Si un dossier scanne ne contient que des `.optional` (pas de JPG/PNG), `create_dataset`
convertit automatiquement avant de scanner. Pour un fichier `.optional` seul, il est converti
puis le dossier converti est scanne. Implementation : `backend/utils/format specialise.py`.

---

## Subsets

- **Creer** : lasso sur la carte, recherche semantique, ou page Subsets (selection
  courante).
- **Dupliquer** : `POST /api/subsets/{id}/duplicate`, nom auto-numerote `{base}_n`,
  possible meme si deja exporte.
- **Bouton Carte** : lien direct vers `/datasets/{dataset_id}/map` depuis la page
  Subsets (visible uniquement si UMAP calcule).
- **Bouton Doublons** : actif seulement si le subset n'est pas encore exporte, desactive
  apres export.
- **Exclure du dataset** : bouton dans le panel de selection de la Carte, marque
  `is_duplicate_kept=False` (rejet) sans passer par le flow doublons.

### Doublons et subsets

Les decisions de doublons prises dans un subset affectent le **dataset principal** :

- `Sauvegarder` (SubsetDuplicatesModal) -> `PATCH /api/datasets/{id}/duplicates/decision`
  -> met a jour `Image.is_duplicate_kept` dans le dataset principal. Ces images sont
  comptees comme "rejetees" partout dans le Playground.
- `Appliquer au subset` -> retire les images du subset (`SubsetImage` supprimes) sans
  toucher le dataset.
- Pour annuler les decisions sur le dataset : bouton `Reset` dans le Playground
  (`POST /api/datasets/{id}/reset-duplicate-filter`).

L'UI affiche un avertissement dans la modal pour rappeler cet impact.

### Merge

- **Merge manuel classique** : `POST /api/datasets/merge` (Dashboard).
- **Merge intelligent** (SSE) : `POST /api/datasets/merge-filtered` fusionne
  uniquement les images matchees (score > seuil) de plusieurs sources dans un nouveau
  dataset. Tags auto supprimes (redondants avec les embeddings). Annotations `.ver`/YOLO
  conservees (`core/annotation_ref.py`, colonnes `annotation_*`, badge, filtre "Avec
  annotations").

### Exports

Un subset peut etre exporte plusieurs fois vers des chemins differents ; chaque export
cree un enregistrement `SubsetExport` (table `subset_export`), affiche avec un badge
bleu (symlink) ou violet (copie). Symlink ou copie physique configurable dans
Parametres -> `use_symlinks`, lu au runtime par
`backend/core/subset_manager.py::_make_symlink()` (uniquement `os.symlink`, pas de
fallback hardlink ; copie physique si `use_symlinks=False`).

---

## Frontend

### Stack

- React 18 + TypeScript 5
- Vite 6 + proxy vers le backend (`:8001` par defaut)
- Tailwind CSS 3 (dark mode par defaut)
- TanStack Query v5 - cache serveur, invalidation
- Zustand v5 - etat global de selection d'images (`useSelectionStore`)
- Plotly.js - scatter UMAP interactif, lasso select
- React Router v6 - SPA routing
- react-hot-toast - notifications

### Etat global

`useSelectionStore` (Zustand) : `Set` d'`image_id` selectionnes, persiste entre les
pages.
- Alimente par le lasso select dans `ScatterPlot`.
- Alimente par les checkboxes dans `ImageGrid`.
- Consomme par `SubsetManager` et `DatasetMap` pour creer des subsets.

### Proxy Vite

```typescript
// vite.config.ts
proxy: {
  '/api': { target: 'http://localhost:8001', timeout: 300000 },
  '/thumbs': { target: 'http://localhost:8001' },
}
```

Timeout 300s pour couvrir les operations longues. Pour les tres grands datasets, si le
proxy bufferise, connecter directement le frontend a `http://localhost:8001/api/...`.

Les endpoints SSE restants (remap/rebuild/reset/merge) passent par le **proxy
meme-origine** (`SSE_BASE=''` dans `client.ts`) plutot que par une connexion directe.

---

## Integration avec Annotation App

L'export d'un subset cree des symlinks (ou copies) dans
`Annotation_App/data/imports/{subset_name}/`, consommables via "Importer un dossier"
dans Annotation App. Les deux apps restent independantes (workspaces SQLite separes),
reliees uniquement par ces liens d'export. Detail complet, variables d'environnement et
schema du flux : [developer-guide.md](developer-guide.md#integration-avec-annotation-app).
