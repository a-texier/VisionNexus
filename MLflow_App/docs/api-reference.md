---
app: mlflow
doc_type: api-reference
audience: dev
lang: en
title: API reference
order: 70
tags: [rest api, fastapi, mlflow, endpoints]
sources: [MLflow_App/backend/main.py, MLflow_App/backend/api/experiments.py, MLflow_App/backend/api/runs.py, MLflow_App/backend/api/models.py, MLflow_App/backend/api/compare.py, MLflow_App/backend/api/settings.py, MLflow_App/backend/api/docs.py]
---

# API reference

## Conventions of the MLflow App API

The MLflow App backend exposes a JSON REST API under `/api` and interactive documentation (Swagger) at `/docs` on the backend port (8001 in standalone mode, see [Configuration](configuration.md)). Through the Vite frontend, `/api` is proxied to this backend and `/orchestrator-api` is proxied to the Orchestrator's own backend (used only by the Lineage page).

General rules:

- **Errors** use FastAPI's format `{"detail": "..."}`. Every endpoint that touches `MlflowClient` returns 503 with "Serveur MLflow non disponible" (or, on `/api/experiments`, an older wording mentioning port 5000, see [Troubleshooting](troubleshooting.md)) when the store is unreachable, and 500 on any other SDK error.
- **Timestamps** (`creation_time`, `start_time`, `end_time`, ...) are milliseconds since epoch, or `null`, exactly as returned by the MLflow SDK; the frontend formats them locally.
- **This API is read-mostly.** Beyond creating or deleting an experiment, setting run tags, and transitioning a model version's stage, nothing here starts, stops or modifies a run: runs are written exclusively by the apps that train, evaluate or run inference.

The endpoint tables of the section *Endpoint index* are generated from the code; the sections below explain each domain.

## Experiments and store status

- `GET /api/mlflow-status` reports `{running, version}`, used by the sidebar status dot; `running` reflects `is_mlflow_running()` exactly as described in [Architecture](architecture.md).
- `GET /api/experiments` lists every experiment (active and deleted, `ViewType.ALL`); `POST /api/experiments` creates one (`name`, optional `artifact_location`, `tags`); `DELETE /api/experiments/{id}` removes it.
- These two endpoints back the Experiments page and the sidebar status dot; neither one is called by the Lineage page, which reads runs directly instead of listing experiments first. Deleting an experiment here also removes every run it contains from the store's index.

## Runs, tags and artifacts

- `GET /api/runs?experiment_id=...` lists the runs of one experiment (`max_results`, `order_by`, default `start_time DESC`). `GET /api/runs/{id}` returns the same summary plus `metric_history` (every logged step of every metric) and `artifacts` (the root artifact listing).
- `POST /api/runs/{id}/tags` merges the given `tags` onto a run; used by the Orchestrator to backfill `git_commit` and `dataset_version` after a DVC commit (see [Concepts](concepts.md)). It never removes an existing tag, only adds or overwrites the keys given.
- `GET /api/runs/{id}/artifacts?path=` lists one artifact subfolder (empty `path` = root). `GET /api/runs/{id}/artifact?path=...` serves a single image file (`.png`/`.jpg`/`.jpeg` only; any other extension is rejected with 400) by downloading it through the SDK first, used by the run detail page's plot gallery.

## Model registry endpoints

- `GET /api/models` lists every registered model with its `latest_versions` (one entry per stage that has a version). `GET /api/models/{name}/versions` lists every version of one model, newest first by version number, not limited to the latest per stage.
- `POST /api/models/{name}/versions/{version}/transition` moves a version to `stage` (`None`, `Staging`, `Production` or `Archived`), with an optional `archive_existing_versions` flag to auto-archive other versions at the target stage.
- A model's name and its versions are entirely managed by the writer app that calls `register_model`; this app only reads and transitions them, it never creates a model or a version on its own.

## Compare, settings and documentation endpoints

- `POST /api/compare` takes 2 to 10 `run_ids` and returns each run's full detail plus the union and intersection of their metric and parameter keys (`all_metrics`, `common_metrics`, `all_params`, `common_params`), computed once on the backend rather than per chart on the frontend.
- `GET`/`PUT /api/settings`: the app's own settings file, including `mlflow_tracking_uri` for display purposes only (changing it here does not change the backend's actual tracking URI, which is fixed at process start from the environment).
- `GET /api/docs`, `GET /api/docs/{name}` and `GET /api/docs/assets/{path}`: this documentation set, served to the frontend's Doc page.

## Health and workspace endpoints

- `GET /health` returns `{"status": "ok", "mlflow_running": bool}`. VisionNexus polls it before opening the app's tab.
- `GET /api/workspace/users`, `POST /api/workspace/open`, `GET /api/workspace/history`: shared workspace helpers used by the user badge, identical in source to the other apps of the suite; none of them touch the MLflow store.
- These endpoints stay useful even when the MLflow store is unreachable, since they do not depend on `_require_mlflow()`.

## Endpoint index

<!-- generated:start -->
### compare

| Method | Path | Summary | Source |
|---|---|---|---|
| POST | `/api/compare` | `compare_runs()` | `MLflow_App/backend/api/compare.py:27` |

### docs

| Method | Path | Summary | Source |
|---|---|---|---|
| GET | `/api/docs` | Pages du jeu de docs, triees par `order`, avec les langues disponibles. | `MLflow_App/backend/api/docs.py:141` |
| GET | `/api/docs/assets/{asset_path:path}` | `get_doc_asset()` | `MLflow_App/backend/api/docs.py:163` |
| GET | `/api/docs/{name}` | Une page : frontmatter + corps markdown, avec repli de langue. | `MLflow_App/backend/api/docs.py:173` |

### experiments

| Method | Path | Summary | Source |
|---|---|---|---|
| GET | `/api/experiments` | `list_experiments()` | `MLflow_App/backend/api/experiments.py:62` |
| POST | `/api/experiments` | `create_experiment()` | `MLflow_App/backend/api/experiments.py:83` |
| DELETE | `/api/experiments/{experiment_id}` | `delete_experiment()` | `MLflow_App/backend/api/experiments.py:102` |
| GET | `/api/mlflow-status` | `mlflow_status()` | `MLflow_App/backend/api/experiments.py:46` |

### main

| Method | Path | Summary | Source |
|---|---|---|---|
| GET | `/api/workspace/history` | Retourne l'historique des workspaces (seulement les dossiers encore existants). Chaque entree: {"path": str, "user": str}. | `MLflow_App/backend/main.py:132` |
| POST | `/api/workspace/open` | Ouvre un dossier dans l'explorateur OS. path optionnel = dossier specifique. | `MLflow_App/backend/main.py:109` |
| GET | `/api/workspace/users` | `workspace_users()` | `MLflow_App/backend/main.py:84` |
| GET | `/health` | `health()` | `MLflow_App/backend/main.py:78` |

### models

| Method | Path | Summary | Source |
|---|---|---|---|
| GET | `/api/models` | `list_models()` | `MLflow_App/backend/api/models.py:63` |
| GET | `/api/models/{model_name}/versions` | `list_model_versions()` | `MLflow_App/backend/api/models.py:77` |
| POST | `/api/models/{model_name}/versions/{version}/transition` | `transition_stage()` | `MLflow_App/backend/api/models.py:96` |

### runs

| Method | Path | Summary | Source |
|---|---|---|---|
| GET | `/api/runs` | `list_runs()` | `MLflow_App/backend/api/runs.py:64` |
| GET | `/api/runs/{run_id}` | `get_run()` | `MLflow_App/backend/api/runs.py:112` |
| GET | `/api/runs/{run_id}/artifact` | `get_run_artifact()` | `MLflow_App/backend/api/runs.py:174` |
| GET | `/api/runs/{run_id}/artifacts` | `list_run_artifacts()` | `MLflow_App/backend/api/runs.py:161` |
| POST | `/api/runs/{run_id}/tags` | Pose/complete des tags sur un run existant (lineage : git_commit, dataset_version...). Utilise par l'Orchestrateur pour boucler le lien MLflow <-> Git/DVC au moment du commit DVC (l'app proprietaire du store ecrit). | `MLflow_App/backend/api/runs.py:90` |

### settings

| Method | Path | Summary | Source |
|---|---|---|---|
| GET | `/api/settings` | `get_settings()` | `MLflow_App/backend/api/settings.py:84` |
| PUT | `/api/settings` | `update_settings()` | `MLflow_App/backend/api/settings.py:89` |
<!-- generated:end -->
