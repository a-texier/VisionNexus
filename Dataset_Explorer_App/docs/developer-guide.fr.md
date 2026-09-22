*[Read in English](developer-guide.md)*

# Developer Guide - Dataset Explorer

Installation, mise en route et depannage. Pour l'architecture (pipeline ML, schema DB,
flux de donnees), voir [architecture.md](architecture.md).

---

## Prerequis

| Outil | Version | Notes |
|-------|---------|-------|
| Python | 3.12 | Conda env `IA_env` |
| Node.js | 18+ | Pour le frontend React |
| npm | 10+ | |
| CUDA | 12.8 | Recommande (CPU aussi supporte) |

### Packages Python requis

```bash
# Deja dans IA_env
torch>=2.0, fastapi, numpy, pillow, scipy, scikit-learn

# Ajoutes pour Dataset Explorer
open_clip_torch, faiss-cpu, umap-learn, sqlmodel, hdbscan
aiofiles, python-multipart
```

---

## Installation complete (premiere fois)

```bash
# 1. Se placer dans le dossier de l'app
cd <racine-suite>/Dataset_Explorer_App

# 2. Installer les dependances Python manquantes
conda activate IA_env
pip install open_clip_torch faiss-cpu umap-learn sqlmodel hdbscan aiofiles python-multipart

# 3. Installer les dependances frontend
cd frontend
npm install
cd ..

# 4. Lancer
python launcher.py
```

### Symlinks Windows

Les symlinks Windows necessitent le **mode Developpeur** ou des **droits admin** :
- Parametres -> Pour les developpeurs -> Mode developpeur : ON
- Ou : lancer le terminal en administrateur

Configurable dans Parametres -> "Subsets & liens" : symlink (defaut) ou copie physique.
Implementation : `backend/core/subset_manager.py::_make_symlink()`.

---

## Tests

```bash
# Tous les tests
python -m pytest backend/tests/ -v

# Avec dataset reel
$env:TEST_DATASET_DIR="D:\datasets\images"
python -m pytest backend/tests/ -v
```

**test_embedder.py** :
- `test_md5_stability` - hashlib stable
- `test_embed_single_image` - shape (1,512), L2-norm proche de 1
- `test_embed_batch` - batch coherent
- `test_thumbnail_generation` - miniature <=256px

**test_indexer.py** :
- `test_build_and_search_self` - top-1 = soi-meme
- `test_duplicate_detection` - 2 paires -> 2 groupes
- `test_index_persistence` - write + read + search
- `test_no_duplicates_below_threshold` - vecteurs distincts

**test_semantic.py** :
- `test_embed_text_shape` - (512,), L2-norm
- `test_embed_text_different_queries` - requetes differentes -> vecteurs differents
- `test_semantic_search_returns_top_k` - count correct, scores decroissants

---

## Integration avec Annotation App

### Export d'un subset

```
Dataset_Explorer_App (subset "pedestrians")
    v  POST /api/subsets/{id}/export-to-annotation-app
Annotation_App/data/imports/pedestrians/
    |-- image1.jpg -> symlink -> chemin original
    `-- image2.jpg -> symlink -> chemin original
    v  Dans Annotation App : Importer un dossier
Nouveau projet Annotation App avec les images du subset
```

### Workspace

Annotation App : `ANNOTATION_WORKSPACE` -> `data/annotation.db`
Dataset Explorer : `EXPLORER_WORKSPACE` -> `data/dataset_explorer.db`

Les deux apps sont independantes, reliees uniquement par les symlinks d'export.

Chemin d'import configurable via variable d'environnement :
```bash
ANNOTATION_APP_IMPORTS=D:\autre\chemin python launcher.py
```

---

## Troubleshooting

### FAISS index non trouve au demarrage
```
[warning] Index FAISS non recharge pour dataset X : ...
```
Reexecuter `/embed` pour reconstruire l'index. Peut arriver si le workspace a ete
deplace.

### Symlinks echouent (Windows)
```
[subset_manager] WARNING: Symlink impossible pour {filename}, fallback copie
```
Activer le mode developpeur Windows : Parametres -> Pour les developpeurs -> Mode
developpeur.

### CUDA Out of Memory pendant l'embedding
Reduire `BATCH_SIZE` dans `backend/config.py` (defaut : 64 -> essayer 16 ou 32).

### UMAP prend trop de temps
Sur de tres grands datasets (>50k images), augmenter `UMAP_N_NEIGHBORS` ou utiliser un
fallback. UMAP est O(n log n) avec la metrique cosine.

### Frontend ne voit pas le backend
Verifier que le backend tourne bien sur le port 8001 : `GET http://localhost:8001/health`.

### Requetes SSE qui echouent silencieusement
Verifier que le port Vite reel figure dans `CORS_ORIGINS` (genere dynamiquement par
`backend/config.py` a partir du port frontend ; les ports 5173-5175 sont toujours
autorises).
