*[Lire en francais](README.fr.md)*

# Training App

Detection model training, with real-time metrics tracking (loss, mAP50,
mAP50-95, precision, recall per epoch) over SSE. Built-in engine: YOLOX (nano/tiny/s/m/l/x), via an
in-house training engine (`VisionNexusYoloxTrainer`, Apache-2.0 license). The engine is a
per-run choice: other engines can be added as plugins, and the UI only offers a
choice when more than one is available. YOLO dataset in `.txt` or `.ver` format (legacy VisionNexus
format), driven by a `data.yaml`. Usable standalone
(dataset config entered by hand in the UI) or driven by the Orchestrator
(`POST /api/orchestrator/train`, dataset supplied automatically).

## Architecture

```
backend/ FastAPI + SQLModel (SQLite) - in-house YOLOX engine (dataset, model, trainer, plots)
frontend/ React 18 + TypeScript + Vite - hyperparams config, progress tracking, history
```

Each training run also logs its metrics/params/model/plots to the user's MLflow
sqlite store (`mlflow_<user>/mlflow_data/mlflow.db`, sibling of the workspace, artifacts
under `mlflow_data/artifacts/`) via
`backend/services/mlflow_logging.py` - fully defensive, training continues even if MLflow
is unavailable. MLflow_App reads that same file with no additional wiring.

## Quick start

```bash
python launcher.py --workspace C:\vision-workspaces --user demo-user
```

- Backend: http://localhost:8064
- Frontend: http://localhost:5176

## Stack

- **Backend**: FastAPI, SQLModel (SQLite), YOLOX (vendored at `backend/vendor/yolox/`, Apache-2.0), Python 3.11+
- **Frontend**: React 18, TypeScript, Vite (port 5176), TanStack Query, Tailwind, lucide-react, react-hot-toast
- **SSE**: real-time stream of training metrics (epoch, mAP50, mAP50-95)

## Documentation

- [docs/README.md](docs/README.md): reference (engines, models, hyperparameters, plots, SSE events, orchestrator contract)
