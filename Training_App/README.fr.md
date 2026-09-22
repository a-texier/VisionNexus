*[Read in English](README.md)*

# Training App

Entrainement de modeles de detection, avec suivi temps reel des metriques (loss, mAP50,
mAP50-95, precision, recall par epoch) en SSE. Moteur integre : YOLOX (nano/tiny/s/m/l/x), via un
moteur d'entrainement maison (`VisionNexusYoloxTrainer`, licence Apache-2.0). Le moteur est un
choix par run : d'autres moteurs peuvent etre ajoutes par plugin, et l'interface ne propose un
choix que s'il en existe plusieurs. Dataset YOLO `.txt` ou `.ver` (format historique VisionNexus),
pilote par un `data.yaml`. Utilisable en standalone
(config du dataset saisie a la main dans l'UI) ou pilote par l'Orchestrator
(`POST /api/orchestrator/train`, dataset fourni automatiquement).

## Architecture

```
backend/ FastAPI + SQLModel (SQLite) - moteur YOLOX maison (dataset, modele, trainer, plots)
frontend/ React 18 + TypeScript + Vite - config hyperparams, suivi de progression, historique
```

Chaque run d'entrainement loggue aussi ses metriques/params/modele/plots dans le store MLflow
sqlite de l'utilisateur (`mlflow_<user>/mlflow_data/mlflow.db`, sibling du workspace, artefacts
sous `mlflow_data/artifacts/`) via
`backend/services/mlflow_logging.py` - 100% defensif, l'entrainement continue meme si MLflow
est indisponible. MLflow_App affiche ce meme fichier sans aucun branchement supplementaire.

## Quick start

```bash
python launcher.py --workspace C:\vision-workspaces --user demo-user
```

- Backend : http://localhost:8064
- Frontend : http://localhost:5176

## Stack

- **Backend** : FastAPI, SQLModel (SQLite), YOLOX (vendor `backend/vendor/yolox/`, Apache-2.0), Python 3.11+
- **Frontend** : React 18, TypeScript, Vite (port 5176), TanStack Query, Tailwind, lucide-react, react-hot-toast
- **SSE** : stream temps reel des metriques d'entrainement (epoch, mAP50, mAP50-95)

## Documentation

- [docs/README.md](docs/README.md) : reference (moteurs, modeles, hyperparametres, plots, evenements SSE, contrat orchestrateur)
