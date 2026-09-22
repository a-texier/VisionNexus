*[Lire en francais](README.fr.md)*

# DVC App - Dataset version tracking

Web interface for versioning datasets, annotations, and models with DVC (Data Version
Control) on top of a git repo, with history, diff, and synchronization to a remote.

## Features

- List of files tracked by DVC, with size and status (unchanged / modified / missing)
- Git history: timeline of commits that touch `.dvc` files
- Diff between two revisions: added, deleted, modified, and renamed files
- DVC push / pull to a remote, with a real-time log (SSE) and cancellation support
- Integration with the VisionNexus suite's Orchestrator: automatic commit of a dataset,
  a model, and a pipeline snapshot

## Architecture

- **Backend**: FastAPI (Python 3.11+), with a subprocess wrapper around `dvc` and `git`
  that turns their output into JSON structures usable by the frontend.
- **Frontend**: React 18 + TypeScript + Vite + TailwindCSS.
- **Persistence**: the git+DVC repo itself (configurable path) acts as the source of
  truth; no additional database, just a `settings.json` file for user preferences.
- **Orchestrator**: the app exposes two routes used by the suite's Orchestrator:
  - `POST /api/orchestrator/commit`: initializes git/dvc if needed, copies a dataset
    and/or a model into the repo then adds them to DVC, and versions a JSON snapshot of
    the pipeline (`.zip` archives are auto-extracted before being added).
  - `GET /api/orchestrator/status`: current state (repo present, git initialized, dvc
    initialized).

## Running

Via the suite's unified launcher (recommended, allocates ports and isolates the workspace):

```bash
python launcher.py --app dvc --workspace <workspace_path> --user <username>
```

Standalone:

```bash
bash start.sh
# or manually
DVC_REPO_PATH=/mon/repo BACKEND_PORT=8002 python -m uvicorn backend.main:app --port 8002 --reload
cd frontend && VITE_BACKEND_PORT=8002 npm run dev -- --port 3002
```

Frontend: http://localhost:3002
Backend: http://localhost:8002

An initialized git+DVC repo (`git init && dvc init`) is recommended in the target folder,
but the backend still starts without one (the routes then return a "repo not found"
status) and the orchestrator route can initialize it itself if needed.

See also [docs/ECOSYSTEM.md](../docs/ECOSYSTEM.md) for this app's place in the suite.
