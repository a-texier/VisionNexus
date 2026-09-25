---
app: optuna
doc_type: code-map
audience: dev
lang: en
title: Code map
order: 80
tags: [code navigation, backend, frontend, dashboard, extension]
sources: [Optuna_App/backend/main.py, Optuna_App/backend/core/optuna_runner.py, Optuna_App/backend/core/diagnostics.py, Optuna_App/backend/hpo_trial.py, Optuna_App/frontend/src/App.tsx, Optuna_App/frontend/src/components/StudyDashboard.tsx, Optuna_App/frontend/src/i18n/translate.ts]
---

# Code map

## Where to start reading the backend code

The backend of Optuna App is in `Optuna_App/backend/`. Read these files in this order to understand it:

1. `main.py`: the entry point. The lifespan pings the Optuna storage; the routers are mounted here; `/health` and the workspace helpers are defined here.
2. `config.py`: the workspace (`OPTUNA_APP_WORKSPACE`), the SQLite storage URL, the ports and the CORS origins.
3. `api/studies.py`: every endpoint used by the interface for standalone studies, plus the state-qualification and legacy-recovery helpers used by the study page.
4. `core/optuna_runner.py`: the background-thread runner behind `start`/`stop`/`status`/`logs`.
5. `api/orchestrator.py`: the blocking `/api/orchestrator/hpo` endpoint used by Orchestrator pipelines.
6. `hpo_trial.py`: the reference trial script run by both the Orchestrator endpoint and the detection preset; the file to read to understand exactly what one trial does.
7. `core/diagnostics.py`: the failure-classification rules shared by both runners.

Other folders: `tests/` and the root `tests/` (see [Verifying the installation](configuration.md#verifying-the-installation) for how to run them). `runs/` and `data/` are workspace-like folders created at runtime, not source.

## Where to start reading the frontend code

The frontend is a Vite/React app in `Optuna_App/frontend/src/`. Start with `App.tsx` for the route list and the sidebar, then `pages/StudiesPage.tsx` (the home page), `pages/StudyDetailPage.tsx` and `components/StudyDashboard.tsx` (the analysis panels), and `pages/LaunchPage.tsx` with `components/EnginePreset.tsx` (starting an optimization). `api/client.ts` is the single place that calls the backend; `types/api.ts` mirrors the backend's Pydantic and dataclass shapes. `i18n/translate.ts` and `i18n/useLang.ts` hold the French-to-English dictionary and the language hook used by every page through `useT()`. `hooks/useStudies.ts` centralizes the TanStack Query hooks and their refetch intervals for the studies list, the trials and the status polling.

## Where to change a failure diagnosis rule

Add or edit a `(patterns, code, title, action)` tuple in `backend/core/diagnostics.py::diagnose_failure()`. Rule order matters: a more specific pattern must come before a broader one that could also match it (see the comment about MLflow-store errors being checked before generic model-missing errors). Both runners call this function identically, so a new rule applies to standalone and Orchestrator studies at once. Match on lowercase text fragments taken from the real stderr or exception message, not on exception class names, since subprocess trials only expose text. Update [Troubleshooting](troubleshooting.md) with the new symptom.

## Where to change what a trial does

For Orchestrator studies and the detection preset, edit `backend/hpo_trial.py`. It must keep writing `result.json` atomically with the fields read by `orchestrator.py` (`status`, `objective_value`, `metrics`, `artifact_dir`, `results_csv`, `best_weights`) and keep printing the bare metric value as its last line of real stdout, since standalone launches of the same script rely on that fallback contract. For a study on your own script, nothing in the app needs to change: only your script's argument parsing and its final `print(value)` matter (see [Concepts](concepts.md#trial-result-contract)). Do not remove the plain-stdout fallback from `hpo_trial.py` even after adding new fields to `result.json`: it is what keeps the file usable as a manually preset script too.

## Where to add a setting

Add a field to `AppSettings` in `backend/api/settings.py` (with a sensible default) and to the matching TypeScript type in `frontend/src/types/api.ts`; the settings page is currently a placeholder (`SettingsPlaceholder` in `App.tsx`), so a new setting needs its own UI to be reachable from the interface. `_save_settings()` writes the whole model back to `settings.json` except `workspace_path` and `user_name`, which are always excluded since they must come from the environment. `load_settings()` merges the saved file onto the defaults field by field, so an old `settings.json` missing a newly added key still loads without error.

## Where to change the analysis dashboard

The payload is built entirely in `backend/api/studies.py::study_analysis()`; add a new field there first. Then add the matching panel or cell in `frontend/src/components/StudyDashboard.tsx`, which exports one function per panel (`OptunaOptimizationOverview`, `SearchSpacePanel`, `OptimizationHistoryChart`, `ParameterInteractionHeatmap`, `TPEEvolutionView`, `ParameterImportanceChart`, `PruningSummary`, `ParallelCoordinatesChart`) composed by the default-exported `StudyDashboard`. Keep new panels defensive about missing data (few trials, no numeric parameters): the existing panels all render an explanatory placeholder instead of an empty chart, following the same pattern as `ParameterImportanceChart`'s fallback text.

## Where to change help, tutorial and translations

The interactive introduction lives entirely in `frontend/src/pages/HPOLearnPage.tsx` (fixed teaching data, no backend call); `frontend/src/components/StudyDashboard.tsx`'s `OptunaOptimizationOverview` panel is the other main place with a similar explanatory role, this time built from the live status of the current study. This documentation's pages live in `Optuna_App/docs/`, served by `backend/api/docs.py` and rendered by `frontend/src/components/docs/MarkdownDoc.tsx` on `frontend/src/pages/GuidePage.tsx`. French strings are the source of truth in the code; add their English translation to the `EXACT_EN` dictionary in `frontend/src/i18n/translate.ts` (exact match) or to `PHRASE_EN` (substring, for dynamically built strings).

## Debugging tools

- `GET /health` and `GET /api/orchestrator/engines` are the two fastest checks of backend and Training App reachability (see [Configuration](configuration.md#verifying-the-installation)).
- The `optuna.db` SQLite file can be opened directly with `optuna-dashboard sqlite:///optuna.db` or any SQLite browser to inspect trial state independently of this app's interface.
- `hpo_runs/<study>/trial_*/stdout.log` and `stderr.log` (Orchestrator trials) hold the raw process output behind a failure diagnosis.
- The launch page's **Output** log and a study's `GET /api/studies/{name}/status` response are the two fastest ways to see why a standalone trial failed without opening a file on the backend machine.

## Module map

<!-- generated:start -->
### backend

| File | Description | Exports |
|---|---|---|
| `config.py` |  |  |
| `hpo_trial.py` | hpo_trial.py - script de trial Optuna pour l'orchestrateur. | `main` |
| `main.py` |  | `lifespan`, `health`, `workspace_users`, `workspace_open`, `workspace_history` |

### backend/api

| File | Description | Exports |
|---|---|---|
| `docs.py` |  | `parse_frontmatter`, `load_doc_set`, `doc_path`, `read_doc`, `safe_asset_path`, `list_docs`, `get_doc_asset`, `get_doc` |
| `orchestrator.py` |  | `engine_catalog`, `describe_engines`, `HpoRequest`, `engines`, `run_hpo` |
| `settings.py` |  | `AppSettings`, `load_settings`, `get_settings`, `update_settings` |
| `studies.py` |  | `StudyCreate`, `ParamSpec`, `StartBody`, `list_studies`, `create_study`, `delete_study`, `list_trials`, `study_analysis`, `best_trial`, `start_study`, `stop_study`, `study_status` (+1) |

### backend/core

| File | Description | Exports |
|---|---|---|
| `diagnostics.py` | Diagnostic lisible des échecs HPO, partagé par les deux moteurs Optuna. | `diagnose_failure` |
| `optuna_runner.py` |  | `StudyRunState`, `get_state`, `start_optimization`, `stop_optimization`, `stream_logs` |

### frontend/src

| File | Description | Exports |
|---|---|---|
| `App.tsx` | App.tsx - sidebar layout + routes | `App` |
| `main.tsx` |  |  |

### frontend/src/api

| File | Description | Exports |
|---|---|---|
| `client.ts` |  | `BACKEND_BASE`, `studiesAPI`, `enginesAPI`, `settingsAPI`, `docsAPI`, `streamLogs` |

### frontend/src/components

| File | Description | Exports |
|---|---|---|
| `EnginePreset.tsx` | Preremplit une etude manuelle pour entrainer un moteur de Training_App | `EnginePreset` |
| `StudyDashboard.tsx` |  | `OptunaOptimizationOverview`, `SearchSpacePanel`, `OptimizationHistoryChart`, `ParameterInteractionHeatmap`, `TPEEvolutionView`, `ParameterImportanceChart`, `ParallelCoordinatesChart`, `ObjectiveDistributionChart`, `PruningSummary`, `StudyDashboard` |
| `UserBadge.tsx` |  | `UserBadge` |

### frontend/src/components/common

| File | Description | Exports |
|---|---|---|
| `LanguageToggle.tsx` |  | `LanguageToggle` |

### frontend/src/components/docs

| File | Description | Exports |
|---|---|---|
| `markdown.ts` | Rendu markdown -> HTML des pages de docs/ et liens vers la page | `DOCS_ROUTE`, `docLink`, `renderMarkdown` |
| `MarkdownDoc.tsx` | Affiche un corps markdown de docs/ (sans frontmatter) avec les ancres | `MarkdownDoc` |

### frontend/src/hooks

| File | Description | Exports |
|---|---|---|
| `useStudies.ts` |  | `useStudies`, `useTrials`, `useStudyStatus`, `useInvalidateStudies` |

### frontend/src/i18n

| File | Description | Exports |
|---|---|---|
| `translate.ts` | Traduction FR -> EN a l'affichage. Le francais reste la source de | `getLang`, `setLang`, `subscribeLang`, `isDesktopPiloted`, `initWorkspaceLanguage`, `setLangAndMaybePersist`, `t` |
| `useLang.ts` |  | `useLang`, `useT` |

### frontend/src/pages

| File | Description | Exports |
|---|---|---|
| `GuidePage.tsx` | Page Documentation : rend les pages markdown de Optuna_App/docs/ servies | `GuidePage` |
| `HPOLearnPage.tsx` |  | `HPOLearnPage` |
| `LaunchPage.tsx` | Configure + launch an optimization run with live SSE logs. | `LaunchPage` |
| `StudiesPage.tsx` | StudiesPage.tsx - liste des études + modal création | `StudiesPage` |
| `StudyDetailPage.tsx` | Progression, meilleur trial, table trials, graphiques. | `StudyDetailPage` |

### frontend/src/types

| File | Description | Exports |
|---|---|---|
| `api.ts` | types/api.ts - miroir exact des schémas Pydantic backend |  |
<!-- generated:end -->
