# DVC App - Suivi de versions de datasets

Interface web pour versionner datasets, annotations et modeles avec DVC (Data Version
Control) au-dessus d'un repo git, avec historique, diff et synchronisation vers un remote.

## Fonctionnalites

- Liste des fichiers suivis par DVC, avec taille et statut (unchanged / modified / missing)
- Historique git : timeline des commits qui touchent des fichiers `.dvc`
- Diff entre deux revisions : fichiers ajoutes, supprimes, modifies, renommes
- Push / pull DVC vers un remote, avec log en temps reel (SSE) et annulation possible
- Integration a l'Orchestrator de la suite VisionNexus : commit automatique d'un dataset,
  d'un modele et d'un snapshot de pipeline

## Architecture

- **Backend** : FastAPI (Python 3.11+), avec un wrapper subprocess autour de `dvc` et `git`
  qui transforme leur sortie en structures JSON exploitables par le frontend.
- **Frontend** : React 18 + TypeScript + Vite + TailwindCSS.
- **Persistance** : le repo git+DVC lui-meme (chemin configurable) fait office de source de
  verite ; aucune base de donnees additionnelle, seulement un fichier `settings.json` pour
  les preferences utilisateur.
- **Orchestrator** : l'app expose deux routes utilisees par l'Orchestrator de la suite :
  - `POST /api/orchestrator/commit` : initialise git/dvc si besoin, copie un dataset et/ou
    un modele dans le repo puis les ajoute a DVC, et versionne un snapshot JSON du pipeline
    (les archives `.zip` sont auto-extraites avant l'ajout).
  - `GET /api/orchestrator/status` : etat courant (repo present, git initialise, dvc
    initialise).

## Lancer

Via le lanceur unifie de la suite (recommande, alloue les ports et isole le workspace) :

```bash
python launcher.py --app dvc --workspace <chemin_workspace> --user <nom_utilisateur>
```

En standalone :

```bash
bash start.sh
# ou manuellement
DVC_REPO_PATH=/mon/repo BACKEND_PORT=8002 python -m uvicorn backend.main:app --port 8002 --reload
cd frontend && VITE_BACKEND_PORT=8002 npm run dev -- --port 3002
```

Frontend : http://localhost:3002
Backend : http://localhost:8002

Un repo git+DVC initialise (`git init && dvc init`) est recommande dans le dossier cible,
mais le backend demarre sans (les routes renvoient alors un statut "repo non trouve") et la
route orchestrator peut l'initialiser elle-meme au besoin.

Voir aussi [docs/ECOSYSTEM.md](../docs/ECOSYSTEM.md) pour la place de cette app dans la suite.
