# Training App

Entrainement de modeles YOLO (v8/v9/v10/v11) via Ultralytics, avec suivi temps reel des metriques
(loss, mAP50, mAP50-95, precision, recall par epoch) en SSE. Utilisable en standalone (config du
dataset saisie a la main dans l'UI) ou pilote par l'Orchestrator (`POST /api/orchestrator/train`,
dataset fourni automatiquement).

## Architecture

```
backend/ FastAPI + SQLModel (SQLite) - wrapper Ultralytics (threads + callbacks SSE)
frontend/ React 18 + TypeScript + Vite - config hyperparams, suivi de progression, historique
```

Chaque run d'entrainement loggue aussi ses metriques/params/modele dans le store MLflow
sqlite de l'utilisateur (`mlflow_<user>/mlflow_data/mlflow.db`, sibling du workspace) via
`backend/services/mlflow_logging.py` - 100% defensif, l'entrainement continue meme si MLflow
est indisponible. MLflow_App affiche ce meme fichier sans aucun branchement supplementaire.

## Quick start

```bash
python launcher.py --workspace C:\vision-workspaces --user demo-user
```

- Backend : http://localhost:8064
- Frontend : http://localhost:5176

## Stack

- **Backend** : FastAPI, SQLModel (SQLite), Ultralytics, Python 3.11+
- **Frontend** : React 18, TypeScript, Vite (port 5176), TanStack Query, Tailwind, lucide-react, react-hot-toast
- **SSE** : stream temps reel des metriques d'entrainement (epoch, mAP50, mAP50-95)

## Documentation

- [docs/README.md](docs/README.md) : reference (modeles supportes, hyperparametres, evenements SSE, contrat orchestrateur)
