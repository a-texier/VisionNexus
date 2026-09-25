*[Read in English](README.md)*

# Dataset Explorer

Explorateur semantique de datasets d'images. Le pipeline encode chaque image avec CLIP
(ViT-B-32), indexe les embeddings dans FAISS pour la recherche par similarite et la
detection de doublons, projette l'espace 512D en 2D (UMAP / t-SNE / PCA) pour la carte
interactive, et regroupe les images par clustering (KMeans / HDBSCAN) avec un score de
rarete par image. L'utilisateur explore visuellement ses datasets, cree des subsets
(lasso sur la carte, recherche semantique texte, filtrage CLIP multi-dataset), gere les
doublons, puis exporte les subsets vers Annotation_App pour l'annotation.

## Architecture

- **Backend** : FastAPI + SQLModel (SQLite WAL) + PyTorch/open_clip + FAISS + UMAP/t-SNE/scikit-learn.
  Logique ML isolee dans `backend/core/` (aucune dependance FastAPI), routers par domaine
  dans `backend/api/`.
- **Frontend** : React 18 + TypeScript 5 + Vite 6, TanStack Query (cache serveur), Zustand
  (selection globale d'images), Plotly.js (scatter UMAP + lasso), Tailwind CSS (dark mode
  par defaut).
- **Donnees** : tout est stocke dans un workspace utilisateur externe au code source
  (`EXPLORER_WORKSPACE`) : base SQLite, index FAISS, thumbnails, subsets. Une galerie globale
  (chemin fixe, independante du workspace) permet de partager des datasets entre
  utilisateurs.
- **Taches longues** : embeddings, clustering, reduction 2D et scan de thumbnails tournent
  en arriere-plan (non bloquant), suivis par polling ou SSE selon l'endpoint.

Detail complet : [docs/architecture.md](docs/architecture.md).

## Demarrage rapide

```bash
# Recommande : via le launcher (depuis n'importe ou)
python <racine-suite>/launcher.py --app explorer --workspace <racine-workspaces> --user <utilisateur>

# Manuel, depuis Dataset_Explorer_App/
conda activate IA_env
BACKEND_PORT=8001 EXPLORER_FRONTEND_PORT=5173 uvicorn backend.main:app --host 127.0.0.1 --port 8001 --reload
cd frontend && VITE_BACKEND_PORT=8001 npm run dev -- --port 5173
```

Frontend par defaut : http://localhost:5173
Backend par defaut : http://localhost:8001

Installation complete (dependances Python/Node, premiere fois) : voir
[docs/configuration.fr.md](docs/configuration.fr.md).

## Documentation

- [docs/README.md](docs/README.md) : index thematique de toute la documentation.

## Adaptateur De Format Optionnel

Le support format specialise est isole dans `backend/utils/format specialise.py`. Le backend publie les adaptateurs
physiquement presents via `GET /api/capabilities`. Retirer ce fichier puis redemarrer supprime la conversion format specialise sans
affecter les datasets d'images standards.
