*[Lire en francais](README.fr.md)*

# MLflow App - Experiment Tracking and Model Registry

Web interface for MLflow: experiments, runs, metrics and model registry. Within the
VisionNexus suite, this app acts as a supervisor: it displays runs logged by the other
apps in real time, without driving any pipeline step itself.

## Features

- List of MLflow experiments, with drill-down into runs
- Run detail: metrics as charts, parameters, artifacts
- Model registry: registered versions, stage transitions
- Side-by-side comparison of several selected runs

## Architecture

- **Backend**: FastAPI (Python 3.11+) on top of the MLflow SDK.
- **Serverless store**: MLflow tracking is a plain **sqlite** file local to the workspace
  (`mlflow_data/mlflow.db`). No `mlflow server` process runs and no port is reserved:
  `MlflowClient` reads and writes this file directly, which avoids the disconnections and
  port collisions that the old server mode required. An explicit `MLFLOW_TRACKING_URI` in
  `http(s)://` form reactivates that legacy server mode if needed.
- **Frontend**: React 18 + TypeScript + Vite + TailwindCSS + Recharts.
- **Orchestrator**: MLflow is a **supervisor** node in the suite. It has no incoming edge
  and exposes no `/api/orchestrator/...` route: the other apps (Training, Inference,
  Evaluation) log directly into the same sqlite file through their own logging module,
  without going through this app. MLflow App simply observes this store continuously and
  displays a live summary of it; no network wiring is needed.

## Running it

Via the suite's unified launcher (recommended):

```bash
python launcher.py --app mlflow --workspace <workspace_path> --user <username>
```

Standalone:

```bash
bash start.sh
# or manually
BACKEND_PORT=8001 python -m uvicorn backend.main:app --host 127.0.0.1 --port 8001 --reload
cd frontend && VITE_BACKEND_PORT=8001 npm run dev -- --port 3001
```

Frontend: http://localhost:3001
Backend: http://localhost:8001
Store: `<workspace>/mlflow_data/mlflow.db` (sqlite, serverless, no dedicated port)

See also [docs/README.md](../docs/README.md) for this app's place in the suite.
