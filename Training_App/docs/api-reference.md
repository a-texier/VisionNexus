---
app: training
doc_type: api-reference
audience: dev
lang: en
title: API reference
order: 70
tags: [rest api, sse, endpoints, fastapi, orchestrator]
sources: [Training_App/backend/main.py, Training_App/backend/routers/training.py, Training_App/backend/routers/orchestrator.py, Training_App/backend/routers/capabilities.py, Training_App/backend/api/settings.py]
---

# API reference

## Conventions of the Training App API

The backend exposes a JSON REST API under `/api`, an SSE stream under `/api/training/{run_name}/events`, and interactive documentation (Swagger) at `/docs` on the backend port (8064 by default, see [Configuration](configuration.md)). Through the Vite frontend, `/api` is proxied, but the SSE stream and the artifact images are fetched directly from the backend port by the frontend (see [Architecture](architecture.md)).

General rules:

- **Errors** use FastAPI's format `{"detail": "..."}`, with 400 (invalid request, for example an unknown engine or size), 404 (unknown run) or 500. Detail messages are written in French; the frontend shows them as they are.
- **Long operations** (a training run) do not return a task id to poll generically: follow a run with `GET /api/training/{run_name}/status`, `GET /api/training/{run_name}/metrics-history`, or the SSE stream `GET /api/training/{run_name}/events`.
- **Engine and size**: most endpoints accept an `engine` field; an empty value resolves to the instance's default engine (`GET /api/capabilities` field `active`). A `model_size` empty value resolves to that engine's default size.
- **Hyperparameters**: sent as a flat `dict`; keys unknown to the resolved engine are dropped and listed in the response field `ignored_hyperparams` rather than causing an error.

The endpoint tables of the section *Endpoint index* are generated from the code; the sections below explain each domain.

## Run endpoints: start, follow, stop, delete

- `POST /api/training/start`: creates a `TrainingRun` and starts training in the background. Body: `engine`, `model_size`, `model_weights`, `data_yaml` (required, checked to exist on the backend), `dataset_name`, `hyperparams`. Returns `{run_name, run_id, status: "pending", engine, ignored_hyperparams}`.
- `GET /api/training/runs`: all runs, most recent first, with every persisted field (status, progress, metrics, paths, hyperparams, dates).
- `GET /api/training/{run_name}/status`: the same fields for one run.
- `POST /api/training/{run_name}/stop`: sets the run's stop flag; returns `{ok: bool}` (`false` if the run is not tracked in memory, for example after a backend restart).
- `DELETE /api/training/{run_name}`: removes the database row only; the run folder on disk is not deleted (see [Workflows](workflows.md)).

## Progress endpoints: SSE stream and metrics history

- `GET /api/training/{run_name}/events` (SSE): streams `status`, `epoch`, `done`, `error` and `stopped` events as they happen, from the in-memory event log of the run (see [Architecture](architecture.md)). The connection closes after a terminal event. Events prior to the connection are not replayed once the run's in-memory record is gone.
- `GET /api/training/{run_name}/metrics-history`: reads `results.csv` from the run folder and returns `{epochs: [{epoch, map50, map5095, precision, recall, box_loss, cls_loss}]}`. Column names are matched per engine (`iou_loss` or `train/box_loss` both map to `box_loss`), so this endpoint works across engines with different loss names. Returns `{epochs: []}` if the file is missing.

## Model catalog and capabilities endpoints

- `GET /api/capabilities`: `{trainer_backends: [...], default, active}`. Each entry of `trainer_backends` has `name`, `label`, `source` (`builtin`, `plugin` or `entry_point`), `available`, `reason` (when unavailable), and `catalog` (full engine catalog, only for available engines). `active` is the engine used when a request names none.
- `GET /api/training/models?engine=`: the catalog of one engine (`{engine, label, weights_suffixes, sizes, default_size, size_prefix, defaults, groups, keys, hpo_ranges, hpo_default_optimize, artifacts, train_batches_glob, pretrained_by_default}`), used by the **Training** page to build its form and by Optuna App for its search space.

## Analysis endpoints: artifacts and inference cases

- `GET /api/training/{run_name}/artifacts`: plots of the run, grouped by category as declared in its engine's catalog, plus `train_batches` and `run_dir`. Returns `{engine_error: "..."}` instead of the categories if the run's engine is no longer available.
- `GET /api/training/{run_name}/artifact/{name:path}`: serves one plot image from the run folder; `name` must be a relative path with no `..` or leading `/`, resolving to an existing file inside the run folder (400/404 otherwise).
- `GET /api/training/{run_name}/inference-cases?top_k=4`: runs the run's best model on up to 200 validation images and returns the `top_k` images with the most and least confident detections (`{run_name, n_images_scored, best: [...], worst: [...]}`, each item `{file, source, detections, mean_conf}`). Requires `best_model_path` to exist and the engine to expose `load_predictor`; the result is cached in `inference_cases/cases.json` of the run folder.

## Settings and application endpoints

- `GET` / `PUT /api/settings`: reads or merges the workspace's `ui_language` (see [Configuration](configuration.md)); only used outside VisionNexus.
- `GET /health`: `{"status": "ok", "app": "Training_App"}`, unconditional (no model to load at startup).
- `GET /`: `{"app", "version", "docs", "health"}`.
- `GET /api/app-mode`: `{mode: "solo" | "orchestrator", runs_dir, workspace}`, read by the frontend to show the orchestrator banner.
- `GET /api/workspace/users`: instances of this app registered in the shared launcher registry (`IA_INSTANCES_FILE`), used by the user badge; returns `[]` outside a launcher-managed session.
- `POST /api/workspace/open?path=`: opens a folder in the OS file explorer of the backend machine (no-op result on a headless remote VM beyond returning the path).

## Orchestrator integration endpoints

The `/api/orchestrator` router is the contract with Orchestrator App; its endpoints are designed to be called by another backend and are kept stable (see [Architecture](architecture.md)).

- `POST /api/orchestrator/train`: `dataset_path` (a folder searched for `data.yaml`, or a `.zip` extracted once) or `data_yaml` (explicit path, takes priority), `dataset_name`, `engine`, `model_size`, `model_weights`, `hyperparams`, generic `epochs`/`batch`/`imgsz`, `optuna_best` (best params from an upstream Optuna node; a non-dict value, such as an unresolved placeholder, is coerced to `{}`), `trace` (`{graph_id, graph_name, node_id, node_label, run_id, experiment, run_type, fork_parent_run}` for MLflow tags and run naming). **Blocks** until the run reaches `done`, `error` or `stopped` (governed by `TRAINING_ORCH_BLOCKING` and `TRAINING_ORCH_MAX_WAIT_S`, see [Configuration](configuration.md)), then returns `{status: "ok", run_name, run_id, run_status, best_map50, best_map5095, best_model_path, engine, model_size, ignored_hyperparams, data_yaml, message}`, or raises 500 with the run's error message if it failed.
- `GET /api/orchestrator/run-status?run_name=`: current state of one run (`{run_name, status, engine, model_size, progress_pct, current_epoch, total_epochs, best_map50, best_map5095, best_model_path, error_message}`), used for polling by custom integrations (the Orchestrator App's own pipeline runner relies on the blocking `POST /train` response instead).

## Endpoint index

<!-- generated:start -->
### Capabilities

| Method | Path | Summary | Source |
|---|---|---|---|
| GET | `/api/capabilities` | `capabilities()` | `Training_App/backend/routers/capabilities.py:21` |

### Orchestrator

| Method | Path | Summary | Source |
|---|---|---|---|
| GET | `/api/orchestrator/run-status` | Retourne l'etat actuel d'un run (utilise par l'Orchestrator pour poller). | `Training_App/backend/routers/orchestrator.py:208` |
| POST | `/api/orchestrator/train` | Lance un entrainement depuis l'Orchestrator. Detecte automatiquement data.yaml si seul dataset_path est fourni. Bloque jusqu'a la fin du run (TRAINING_ORCH_BLOCKING=0 : reponse des le demarrage). | `Training_App/backend/routers/orchestrator.py:62` |

### Sante

| Method | Path | Summary | Source |
|---|---|---|---|
| GET | `/` | `root()` | `Training_App/backend/main.py:76` |
| GET | `/api/app-mode` | Retourne si l'app est lancee par l'Orchestrateur ou en mode solo. | `Training_App/backend/main.py:86` |
| POST | `/api/workspace/open` | Ouvre un dossier dans l'explorateur OS. | `Training_App/backend/main.py:124` |
| GET | `/api/workspace/users` | `workspace_users()` | `Training_App/backend/main.py:98` |
| GET | `/health` | Endpoint de sante - utilise par l'Orchestrateur. | `Training_App/backend/main.py:70` |

### settings

| Method | Path | Summary | Source |
|---|---|---|---|
| GET | `/api/settings` | `get_settings()` | `Training_App/backend/api/settings.py:46` |
| PUT | `/api/settings` | `update_settings()` | `Training_App/backend/api/settings.py:51` |

### Training

| Method | Path | Summary | Source |
|---|---|---|---|
| GET | `/api/training/models` | Catalogue d'un moteur (tailles, defauts, formulaire, plages HPO, plots). `sizes`/`defaults` restent a la racine pour les anciens clients. | `Training_App/backend/routers/training.py:408` |
| GET | `/api/training/runs` | `list_runs()` | `Training_App/backend/routers/training.py:136` |
| POST | `/api/training/start` | Cree un TrainingRun en DB, puis demarre l'entrainement en background. | `Training_App/backend/routers/training.py:90` |
| DELETE | `/api/training/{run_name}` | `delete_run()` | `Training_App/backend/routers/training.py:357` |
| GET | `/api/training/{run_name}/artifact/{name:path}` | `get_artifact()` | `Training_App/backend/routers/training.py:239` |
| GET | `/api/training/{run_name}/artifacts` | Plots d'analyse du run, tels que declares par SON moteur (CATALOG["artifacts"]) : confusion, courbes, labels, batches, etc. Si le moteur n'est plus disponible (plugin retire), la liste est vide et `engine_error` dit pourquoi. | `Training_App/backend/routers/training.py:219` |
| GET | `/api/training/{run_name}/events` | SSE stream des evenements de progression. Le frontend se connecte ici et recoit des events: { type: "status", status, message? } { type: "epoch", epoch, total_epochs, progress_pct, metrics } { type: "done", engine, best_model_path, map50, map5095 } { type: "error", message } { type: "stopped" } | `Training_App/backend/routers/training.py:371` |
| GET | `/api/training/{run_name}/inference-cases` | Lance l'inférence du meilleur modèle (moteur du run) sur les images de validation et renvoie les **meilleurs** et **pires** cas (par confiance moyenne des détections). Les images annotées sont sauvegardées dans le dossier du run (sous-dossier `inference_cases/`) et servies via /artifact/... | `Training_App/backend/routers/training.py:259` |
| GET | `/api/training/{run_name}/metrics-history` | Historique par epoch lu dans le results.csv du run. Retourne {epochs: [{epoch, map50, map5095, precision, recall, box_loss, cls_loss}]}. Chaque cle accepte plusieurs noms de colonne selon le moteur : iou_loss (YOLOX) et train/box_loss jouent le meme role (erreur de localisation). | `Training_App/backend/routers/training.py:158` |
| GET | `/api/training/{run_name}/status` | `get_status()` | `Training_App/backend/routers/training.py:146` |
| POST | `/api/training/{run_name}/stop` | `stop_run()` | `Training_App/backend/routers/training.py:349` |
<!-- generated:end -->
