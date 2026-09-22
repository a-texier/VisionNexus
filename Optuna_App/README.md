*[Lire en francais](README.fr.md)*

# Optuna App - Hyperparameter optimization

Web interface for hyperparameter optimization built on top of Optuna, with SQLite storage.
Runs a training script as a subprocess for each trial and streams the logs in
real time.

## Features

- Creation, monitoring and deletion of Optuna studies
- Launching an optimization from a user script (see "User script contract"
  below), with a configurable search space
- Live monitoring of a study: progress, charts, trial table
- Trial logs streaming (SSE)
- Integrated mode driven by the Orchestrator: an Optuna study (TPE, pruning disabled) that trains
  a model directly with a Training_App engine (YOLOX by default), with no external script
- "Optimize a detection training run" preset on the launch page: trial script,
  arguments, search space and metric (mAP50) for the chosen engine

## Training engines

HPO trials train with a Training_App engine (`hpo_trial.py --engine`). The built-in
engine is YOLOX; others can be added via plugin (see
[../docs/plugins/README.md](../docs/plugins/README.md)). `GET /api/orchestrator/engines` lists the
usable engines and their catalog: the default search ranges (`hpo_ranges`) and the
default selection (`hpo_default_optimize`) come from the engine, not from Optuna_App. For YOLOX:
`basic_lr_per_img`, `mosaic_prob` and `degrees` by default, among `min_lr_ratio`, `momentum`,
`weight_decay`, `mixup_prob`, `hsv_prob`, `flip_prob`, `translate`, `shear`.

A trial always optimizes the engine of the downstream Training: the Orchestrator refuses a graph where an
Optuna study and its Training do not share the same engine. A parameter unknown to the engine is
ignored and listed in the trial result (`ignored_params`).

## User script contract (standalone mode)

The script passed as a parameter must:
- accept its hyperparameters as CLI arguments `--name value`;
- print the final metric value on the **last line** of its standard output.

```python
import argparse
parser = argparse.ArgumentParser()
parser.add_argument("--lr", type=float)
parser.add_argument("--depth", type=int)
args = parser.parse_args()

score = train_and_evaluate(lr=args.lr, depth=args.depth)
print(score)  # last line = metric
```

## Architecture

- **Backend**: FastAPI (Python 3.11+) + Optuna. Each study (`study.optimize()`, a
  synchronous call) runs in a background thread; each trial is a separate
  `subprocess.run(...)` on the user script.
- **Frontend**: React 18 + TypeScript + Vite + TailwindCSS + Recharts + TanStack Query.
- **Persistence**: SQLite (`optuna.db`) in the workspace, Optuna's native storage.
- **Orchestrator**: `POST /api/orchestrator/hpo` (`engine`, `model_size`, `optimize`...) launches an
  Optuna study that trains the requested engine via the reference trial script `hpo_trial.py`.
  This call is **blocking**: it only responds
  once all trials are finished, and the resulting `best_params` are merged into
  the downstream training node. In the suite's graph, this step is gated by
  human validation before it is triggered.

## Running it

Via the suite's unified launcher (recommended):

```bash
python launcher.py --app optuna --workspace <workspace_path> --user <username>
```

Standalone:

```bash
pip install fastapi uvicorn optuna
cd frontend && npm install && cd ..
python launcher.py
# or
bash start.sh
```

Frontend: http://localhost:3003
Backend: http://localhost:8003

See also [docs/ECOSYSTEM.md](../docs/ECOSYSTEM.md) for this app's place in the suite.
