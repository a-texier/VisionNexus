---
app: training
doc_type: code-map
audience: dev
lang: en
title: Code map
order: 80
tags: [modules, backend, frontend, engines, plugins, hyperparameters]
sources: [Training_App/backend, Training_App/frontend/src]
---

# Code map

## Where to start reading the backend code

Start at `backend/main.py` (app assembly, routers, `/health`), then `backend/services/training_service.py` (the run lifecycle: thread, events, MLflow, database updates -- the center of the backend) and `backend/services/trainer_backend.py` (the engine contract every training engine, including plugins, must satisfy). Everything specific to YOLOX (`yolox_engine.py`, `yolox_trainer.py`, `yolox_dataset.py`, `yolox_model.py`, `yolox_catalog.py`, `yolox_plots.py`, `detection_metrics.py`) sits behind that contract and can be read independently, without knowing how the rest of the backend works. The database model (`models/training_run.py::TrainingRun`) is intentionally thin: every field it holds is also readable through `routers/training.py`, so start from the routers to see what a run actually exposes before reading the model file itself. `backend/config.py` is the single place that resolves the workspace path, the database path and the ports from environment variables; read it before changing anything that depends on the workspace layout.

## Where to start reading the frontend code

Start at `frontend/src/App.tsx` (the two-route shell), then `frontend/src/pages/TrainingPage.tsx` (launch a run, form built from the engine catalog, live progress) and `frontend/src/pages/RunsPage.tsx` (history table and run detail: curves, analysis gallery, best/worst cases). `frontend/src/api/client.ts` centralizes every backend call, including the two that bypass the Vite proxy (`SSE_BASE`, `artifactUrl`); `frontend/src/types/api.ts` holds every TypeScript type shared between the two pages. Neither page hardcodes hyperparameter names or engine sizes: both are read from `GET /api/capabilities` and `GET /api/training/models`, so a change to an engine's catalog on the backend is enough to change what the form shows, with no frontend edit needed.

## Where to add a new engine

A new training engine is a plugin, not a change to Training App itself: create a folder under `plugins/` at the monorepo root, following the contract in `docs/plugins/README.md` (root of the repository) and the `TrainingEngine` protocol in `backend/services/trainer_backend.py`. Nothing in `Training_App/` needs editing; the engine is discovered through `_lib/plugin_registry.py` or a `visionnexus.trainer_backends` entry point (see [Configuration](configuration.md) and [Architecture](architecture.md)). Use `plugins/visionnexus_ultralytics/` as a worked example: `catalog.py` (a `CATALOG` dict with no heavy import, mirroring `yolox_catalog.py`) and `trainer.py` (the `TrainingEngine` implementation, importing its training library only inside `train()` and `load_predictor()`) are the two files a new engine needs at minimum.

## Where to change the YOLOX hyperparameter form or defaults

Edit `backend/services/yolox_catalog.py`: `DEFAULT_HYPERPARAMS` for default values, `HYPERPARAM_GROUPS` for the fields shown on the **Training** page (label, type, min/max/step), `HPO_RANGES` for the search space Optuna App uses, `ARTIFACTS` for which plots the gallery looks for. The frontend reads this catalog through `GET /api/training/models`; no hyperparameter name is hardcoded in `frontend/src/pages/TrainingPage.tsx`. Add the matching English label to `EXACT_EN` in `frontend/src/i18n/translate.ts` for every new French label, and add the key to `CATALOG["keys"]` only when it maps to a generic Orchestrator/Optuna field (`epochs`, `batch`, `imgsz`, `workers`); other keys stay engine-specific and are read as-is from `hyperparams`.

## Where to change the YOLOX training loop or evaluation

`backend/services/yolox_trainer.py` (`VisionNexusYoloxTrainer`) overrides the vendored `yolox.core.trainer.Trainer` hooks: `before_train`/`before_iter`/`after_iter`/`after_epoch`/`evaluate_and_save_model`. The evaluation metrics themselves (mAP, precision, recall, confusion matrix) live in `backend/services/detection_metrics.py`; the plots come from `yolox_plots.py` (dataset preview, augmented batches, validation grids) and `detection_metrics.save_plots` (confusion matrix, PR/P/R/F1 curves). Do not edit `backend/vendor/yolox/` directly (see its `VENDOR_NOTES.md`); every adaptation goes through the modules around it, so that the vendored code can be re-synced from upstream without losing local changes. Tests for this area live in `backend/tests/test_yolox_trainer.py`, `test_yolox_plots.py` and `test_yolox_dataset.py`.

## Where to change dataset reading (data.yaml, YOLO .txt, .ver)

`backend/services/yolox_dataset.py`: `load_data_yaml` parses `data.yaml` and picks the label format; `load_yolo_txt_labels` and `load_ver_file` parse each format; `YoloTxtDataset` is the torch/YOLOX dataset used by the trainer, exposing the `pull_item`/`__getitem__`/`load_anno` contract the vendored `MosaicDetection` wrapper expects. `VER_CLASS_MAP` holds the class-name-to-id table used only for `.ver` files; keep it in sync with the equivalent table in Inference App's annotation loader if you change it, since a `.ver` file used both for evaluation and training must map classes the same way in both apps. `backend/tests/test_yolox_dataset.py` covers both label formats.

## Where to change checkpoint loading or model construction

`backend/services/yolox_model.py`: `build_exp` (architecture and image size per model size), `build_model`, `load_checkpoint` (tolerant of shape mismatches, via the vendored `yolox.utils.checkpoint.load_ckpt`). This module is imported directly by Inference App's `inference_core/detectors.py::YoloxDetector` (across the repository, not through a package boundary), so a signature change here must be reflected there too; the two apps do not otherwise share code. `backend/tests/test_yolox_model.py` covers the size-to-architecture mapping.

## Where to change MLflow logging

`backend/services/mlflow_logging.py`: `resolve_tracking_uri` (store location), `start_run`/`_Run` (the defensive logging handle used by `training_service.py`). Any change must preserve the "never raises" property described in [Architecture](architecture.md): every public method of `_Run` must keep catching its own exceptions, since a training run must never fail because logging failed. Near-identical copies of this file exist in other apps of the suite (Inference App among them) and are kept in sync manually, not imported from a shared location -- update them together when fixing a bug here.

## Where to change the Orchestrator contract

`backend/routers/orchestrator.py`: `OrchestratorTrainRequest` (accepted fields) and `orchestrator_train` (dataset resolution from `dataset_path` or `data_yaml`, the blocking wait on run completion, the response shape). Endpoint paths and the response shape are meant to stay stable since Orchestrator App depends on them; if a field must change, keep the old one working or coordinate the change with Orchestrator App's `backend/core/graph_runner.py`, which builds the request body for the Training node. `Training_App/tests/test_orchestrator_dataset_contract.py` covers the `dataset_path` resolution, including the `.zip`-archive and legacy `.ver`-export rejection cases.

## Where to change run history, curves or the analysis gallery

Backend: `backend/routers/training.py` (`metrics_history`, `list_artifacts`, `get_artifact`, `inference_cases`) and `backend/services/run_artifacts.py` (`collect_artifacts`, matching a catalog's declared plots against what exists on disk). Frontend: `frontend/src/pages/RunsPage.tsx` (`RunCurves`, `AnalysisGallery`, `InferenceCasesView`, and the `ARTIFACT_SECTIONS` list of categories shown in the gallery -- keep it in sync with the categories engines actually declare, since a category present in a catalog but missing from `ARTIFACT_SECTIONS` never shows up).

## Where to change ports, workspace layout or environment variables

`backend/config.py` (workspace path, database path, ports, CORS origins, `TRAINER_BACKEND` default) and `Training_App/launcher.py` / `_lib/launcher_engine.py` (port allocation, environment variables passed to the backend and frontend processes, workspace subfolder creation). The suite-wide launcher (`_lib/launcher_engine.py`) and the app-local one (`Training_App/launcher.py`) duplicate most of their logic deliberately, so that Training App stays launchable on its own outside the monorepo; keep both in sync when changing port allocation or workspace naming. See [Configuration](configuration.md) for the full list of variables and their defaults.

## Where to change translations

`frontend/src/i18n/translate.ts`: `EXACT_EN` is the French-to-English dictionary keyed by the exact French string used in the JSX (`t('...')`); there is no semantic key. Add every new user-facing French string here when introducing it, in both `TrainingPage.tsx` and `RunsPage.tsx`; a string missing from the dictionary is shown untranslated in English mode rather than breaking the page, so a forgotten entry is easy to miss without a visual check of both languages.

## Debugging tools: run state and events

- `GET /api/training/{run_name}/status` and `GET /api/training/runs` read the persisted database state directly; use them to check what actually made it to disk versus what an SSE client observed.
- `_active_runs` (module-level dict in `training_service.py`) only exists in the backend process's memory: it cannot be inspected from outside except through the SSE stream or `GET /api/training/{run_name}/events`, and is empty after a backend restart.
- `results.csv` in a run's folder is the ground truth for per-epoch metrics and losses, independent of what the SSE stream delivered live; `metrics_history` reads it directly.
- `train_log.txt` in a run's folder has the full YOLOX log (including `logger.info` lines from `VisionNexusYoloxTrainer` and the base `Trainer`), useful when a run fails inside the engine rather than in the surrounding orchestration code.
- `backend/tests` runs with `python -m pytest backend/tests`; the `slow` marker (`pyproject.toml`) separates short real trainings from pure unit tests, run with `-m "not slow"` for a quick check.

## Module map

<!-- generated:start -->
### backend

| File | Description | Exports |
|---|---|---|
| `config.py` |  |  |
| `database.py` |  | `create_db_and_tables`, `get_session` |
| `main.py` |  | `lifespan`, `health`, `root`, `get_app_mode`, `workspace_users`, `workspace_open` |

### backend/api

| File | Description | Exports |
|---|---|---|
| `settings.py` |  | `AppSettings`, `load_settings`, `get_settings`, `update_settings` |

### backend/models

| File | Description | Exports |
|---|---|---|
| `training_run.py` |  | `TrainingRun` |

### backend/routers

| File | Description | Exports |
|---|---|---|
| `capabilities.py` | GET /api/capabilities -- moteurs d'entrainement que cette instance sait utiliser. | `capabilities` |
| `orchestrator.py` |  | `OrchestratorTrainRequest`, `orchestrator_train`, `orchestrator_run_status` |
| `training.py` |  | `StartTrainingRequest`, `TrainingRunOut`, `start_training`, `list_runs`, `get_status`, `metrics_history`, `list_artifacts`, `get_artifact`, `inference_cases`, `stop_run`, `delete_run`, `stream_events` (+1) |

### backend/services

| File | Description | Exports |
|---|---|---|
| `detection_metrics.py` |  | `Detection`, `GroundTruth`, `ClassCurve`, `EvalResult`, `compute_metrics`, `save_plots` |
| `mlflow_logging.py` |  | `resolve_tracking_uri`, `start_run`, `mlflow_run` |
| `run_artifacts.py` |  | `collect_artifacts`, `artifact_files` |
| `trainer_backend.py` |  | `TrainerStopped`, `TrainingEngine`, `normalize_engine`, `resolve_engine`, `engine_catalog`, `describe_backends`, `list_available_backends`, `check_weights_for_engine`, `filter_hyperparams`, `merge_hyperparams`, `epochs_of` |
| `training_service.py` |  | `RunConfigError`, `build_run_config`, `start_training`, `stop_training`, `get_events` |
| `yolox_catalog.py` |  |  |
| `yolox_dataset.py` |  | `DatasetSpec`, `load_data_yaml`, `load_yolo_txt_labels`, `load_ver_file`, `YoloTxtDataset` |
| `yolox_engine.py` |  | `YoloxEngine` |
| `yolox_model.py` |  | `build_exp`, `build_model`, `load_checkpoint` |
| `yolox_plots.py` |  | `save_labels_plot`, `save_train_batch_plot`, `save_dataset_preview_plots`, `save_val_batch_plots` |
| `yolox_trainer.py` |  | `TrainingStopped`, `VisionNexusYoloxTrainer` |

### frontend/src

| File | Description | Exports |
|---|---|---|
| `App.tsx` | App.tsx - Training_App | `App` |
| `main.tsx` |  |  |

### frontend/src/api

| File | Description | Exports |
|---|---|---|
| `client.ts` | api/client.ts - Training_App | `SSE_BASE`, `trainingAPI`, `artifactUrl`, `appModeAPI`, `settingsAPI`, `streamTrainingEvents` |

### frontend/src/components/common

| File | Description | Exports |
|---|---|---|
| `LanguageToggle.tsx` |  | `LanguageToggle` |

### frontend/src/i18n

| File | Description | Exports |
|---|---|---|
| `translate.ts` | Traduction FR -> EN a l'affichage. Le francais reste la source de | `getLang`, `setLang`, `subscribeLang`, `t`, `isDesktopPiloted`, `initWorkspaceLanguage`, `setLangAndMaybePersist` |
| `useLang.ts` |  | `useLang`, `useT` |

### frontend/src/pages

| File | Description | Exports |
|---|---|---|
| `RunsPage.tsx` | Historique des runs - tableau + detail. | `RunsPage` |
| `TrainingPage.tsx` | Interface principale - lancement + suivi temps reel. | `TrainingPage` |

### frontend/src/types

| File | Description | Exports |
|---|---|---|
| `api.ts` | types/api.ts - Training_App |  |
<!-- generated:end -->
