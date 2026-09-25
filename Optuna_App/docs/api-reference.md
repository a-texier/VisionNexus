---
app: optuna
doc_type: api-reference
audience: dev
lang: en
title: API reference
order: 70
tags: [rest api, fastapi, sse, endpoints, orchestrator]
sources: [Optuna_App/backend/main.py, Optuna_App/backend/api/studies.py, Optuna_App/backend/api/orchestrator.py, Optuna_App/backend/api/settings.py, Optuna_App/backend/api/docs.py]
---

# API reference

## Conventions of the Optuna App API

The Optuna App backend exposes a JSON REST API under `/api`, an SSE log stream under `/api/studies/{name}/logs`, and interactive documentation (Swagger) at `/docs` on the backend port (8003 in standalone mode, see [Configuration](configuration.md)). Through the Vite frontend, `/api` is proxied, so the frontend calls relative URLs; the log stream connects to the backend port directly.

General rules:

- **Errors** use FastAPI's format `{"detail": "..."}` with 404 (unknown study), 409 (conflicting state, for example starting an already-running study) or 500. Detail messages are written in French; the frontend shows them as they are.
- **Study names** are used as path segments and must be URL-encoded by the caller (`encodeURIComponent` in the frontend client).
- **The Orchestrator endpoint is blocking**: `POST /api/orchestrator/hpo` only responds once every requested trial has finished, unlike the standalone `start`/`status` pair.

The endpoint tables of the section *Endpoint index* are generated from the code; the sections below explain each domain.

## Studies: CRUD, trials, launch and status

The studies router (`/api/studies`) covers everything driven from the interface.

- `GET /api/studies` lists every study with its direction, trial counts and best value (used by the studies page); `POST /api/studies` creates one (`study_name`, `direction` `minimize` or `maximize`); `DELETE /api/studies/{name}` removes it from Optuna's storage (the files of its trials under `hpo_runs/` are not deleted).
- `GET /api/studies/{name}/trials` lists every trial with its effective state, value, parameters, duration and recovered artifacts, if any. `GET /api/studies/{name}/best` returns the best trial, or 404 if none completed.
- `GET /api/studies/{name}/analysis` returns the whole dashboard payload in one call: configuration summary, search space, parameter importances (fANOVA) with warnings, raw and effective state counts, sampler and pruner analysis, objective and duration summaries.
- `POST /api/studies/{name}/start` launches a background optimization (`script_path`, `script_args`, `n_trials`, `metric_name`, `direction`, `param_space`); 409 if one is already running for that study. `POST /api/studies/{name}/stop` requests a clean stop after the current trial; 409 if none is running.
- `GET /api/studies/{name}/status` returns the live status: Optuna counts, diagnostics grouped by root cause, sampler phase and any recovered historical candidate. `GET /api/studies/{name}/logs` streams the background run's log as `text/event-stream`.

## Orchestrator integration endpoints

- `GET /api/orchestrator/engines` lists the training engines usable by a trial, with each engine's HPO catalog (default ranges, default selection, model sizes); returns an empty list and an `error` field if Training App cannot be imported.
- `POST /api/orchestrator/hpo` runs one complete, blocking Optuna study (see [Architecture](architecture.md)) and returns `best_params`, `best_value`, `n_trials` and failure details on the same response; never raises an HTTP error for a failed study, since the Orchestrator's pipeline policy (stop or fall back to Training defaults) is expressed in the response body (`ok`, `hpo_succeeded`, `fallback_to_training_defaults`).

## Settings, documentation, health and workspace endpoints

- `GET`/`PUT /api/settings`: the app's own settings file (theme, UI language fallback). `workspace_path` and `user_name` always reflect the environment, never the saved file.
- `GET /api/docs`, `GET /api/docs/{name}` and `GET /api/docs/assets/{path}`: this documentation set, served to the frontend's Documentation page (see [Code map](code-map.md)).
- `GET /health` returns `{"status": "ok", "study_count": N}`, or a `warning` field if the Optuna storage could not be listed. VisionNexus polls it before opening the app's tab.
- `GET /api/workspace/users`, `POST /api/workspace/open`, `GET /api/workspace/history`: shared workspace helpers used by the user badge, identical in source to the other apps of the suite; none of them touch Optuna's own storage.

## Endpoint index

<!-- generated:start -->
### docs

| Method | Path | Summary | Source |
|---|---|---|---|
| GET | `/api/docs` | Pages du jeu de docs, triees par `order`, avec les langues disponibles. | `Optuna_App/backend/api/docs.py:141` |
| GET | `/api/docs/assets/{asset_path:path}` | `get_doc_asset()` | `Optuna_App/backend/api/docs.py:163` |
| GET | `/api/docs/{name}` | Une page : frontmatter + corps markdown, avec repli de langue. | `Optuna_App/backend/api/docs.py:173` |

### main

| Method | Path | Summary | Source |
|---|---|---|---|
| GET | `/api/workspace/history` | Retourne l'historique des workspaces (seulement les dossiers encore existants). Chaque entree: {"path": str, "user": str}. | `Optuna_App/backend/main.py:122` |
| POST | `/api/workspace/open` | Ouvre un dossier dans l'explorateur OS. path optionnel = dossier specifique. | `Optuna_App/backend/main.py:99` |
| GET | `/api/workspace/users` | `workspace_users()` | `Optuna_App/backend/main.py:74` |
| GET | `/health` | `health()` | `Optuna_App/backend/main.py:64` |

### orchestrator

| Method | Path | Summary | Source |
|---|---|---|---|
| GET | `/api/orchestrator/engines` | Moteurs utilisables par les trials, avec leurs plages HPO par defaut. | `Optuna_App/backend/api/orchestrator.py:127` |
| POST | `/api/orchestrator/hpo` | Lance une étude Optuna BLOQUANTE (TPE) et renvoie les best params. | `Optuna_App/backend/api/orchestrator.py:141` |

### settings

| Method | Path | Summary | Source |
|---|---|---|---|
| GET | `/api/settings` | `get_settings()` | `Optuna_App/backend/api/settings.py:54` |
| PUT | `/api/settings` | `update_settings()` | `Optuna_App/backend/api/settings.py:59` |

### studies

| Method | Path | Summary | Source |
|---|---|---|---|
| GET | `/api/studies` | `list_studies()` | `Optuna_App/backend/api/studies.py:433` |
| POST | `/api/studies` | `create_study()` | `Optuna_App/backend/api/studies.py:443` |
| DELETE | `/api/studies/{study_name}` | `delete_study()` | `Optuna_App/backend/api/studies.py:460` |
| GET | `/api/studies/{study_name}/analysis` | Données factuelles destinées au dashboard d'analyse HPO. | `Optuna_App/backend/api/studies.py:481` |
| GET | `/api/studies/{study_name}/best` | `best_trial()` | `Optuna_App/backend/api/studies.py:603` |
| GET | `/api/studies/{study_name}/logs` | `study_logs()` | `Optuna_App/backend/api/studies.py:765` |
| POST | `/api/studies/{study_name}/start` | `start_study()` | `Optuna_App/backend/api/studies.py:615` |
| GET | `/api/studies/{study_name}/status` | `study_status()` | `Optuna_App/backend/api/studies.py:640` |
| POST | `/api/studies/{study_name}/stop` | `stop_study()` | `Optuna_App/backend/api/studies.py:632` |
| GET | `/api/studies/{study_name}/trials` | `list_trials()` | `Optuna_App/backend/api/studies.py:475` |
<!-- generated:end -->
