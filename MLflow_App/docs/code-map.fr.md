---
app: mlflow
doc_type: code-map
audience: dev
lang: fr
title: Carte du code
order: 80
tags: [navigation code, backend, frontend, lineage, extension]
sources: [MLflow_App/backend/main.py, MLflow_App/backend/core/mlflow_client.py, MLflow_App/frontend/src/App.tsx, MLflow_App/frontend/src/pages/LineagePage.tsx, MLflow_App/frontend/src/i18n/translate.ts]
---

# Carte du code

## Par ou commencer a lire le code backend

Le backend de MLflow App est dans `MLflow_App/backend/`. Lisez ces fichiers dans cet ordre pour le comprendre :

1. `main.py` : le point d'entree. Le lifespan appelle `ensure_mlflow_running()`/`stop_mlflow_server()` ; les routeurs sont montes ici ; `/health` et les auxiliaires de workspace sont definis ici.
2. `config.py` : le workspace, `MLFLOW_TRACKING_URI` et `MLFLOW_ARTIFACT_ROOT`, les ports et les origines CORS.
3. `core/mlflow_client.py` : `get_client()`, `is_mlflow_running()`, `ensure_mlflow_running()` ; le fichier qui trace la ligne entre le mode serverless par defaut et l'ancien mode serveur HTTP.
4. `api/experiments.py`, `api/runs.py`, `api/models.py`, `api/compare.py` : un fichier par domaine, chacun un fin wrapper autour d'appels `MlflowClient` derriere `_require_mlflow()`.

Hors de `backend/`, `Training_App/backend/services/mlflow_logging.py` est le pendant cote emetteur a lire en parallele de ce backend : c'est lui qui remplit reellement le store que cette app ne fait que lire.

## Par ou commencer a lire le code frontend

Le frontend est une app Vite/React dans `MLflow_App/frontend/src/`. Commencez par `App.tsx` pour la liste des routes et le point de statut de la barre laterale, puis `pages/LineagePage.tsx` (la page d'accueil et la plus impliquee, combinant la propre API de cette app avec celle de l'Orchestrator), `pages/ExperimentsPage.tsx` et `pages/RunDetailPage.tsx` pour les vues classiques par experience, et `pages/ModelRegistryPage.tsx`/`pages/CompareRunsPage.tsx` pour les deux pages restantes de la barre laterale. `api/client.ts` est l'unique endroit qui appelle le propre backend de cette app ; `types/api.ts` reflete ses formes de reponse Pydantic. `hooks/useRuns.ts`, `useExperiments.ts` et `useModels.ts` enveloppent les appels correspondants de `client.ts` dans des hooks TanStack Query avec leurs auxiliaires d'invalidation de cache.

## Ou changer ce qui compte comme tag de lineage

Les noms de tags eux-memes (`orch_run_id`, `graph_id`, `graph_name`, `fork_parent_run`, `git_commit`, `dataset_version`, `node_label`, `run_type`) sont ecrits par l'Orchestrator, pas par cette app : commencez par `Orchestrator_App/backend/core/graph_runner.py::_trace_of()` pour les tags poses a la creation du run, et `Orchestrator_App/backend/api/graphs.py::dvc_commit_selected()` pour le report `git_commit`/`dataset_version` via `POST /api/runs/{id}/tags`. Cote MLflow App, le tableau `lineageFields` de `frontend/src/pages/RunDetailPage.tsx` est l'endroit ou un tag devient une puce etiquetee sur la page de detail de run, et `RUN_TYPE_META` de `frontend/src/pages/ExperimentsPage.tsx` est l'endroit ou une valeur `run_type` devient un badge de role colore. Un tag que cette app ne reconnait pas n'est simplement affiche nulle part ; rien n'a besoin de changer ici pour accepter un nouveau tag Orchestrator qui n'a pas encore d'interface dediee.

## Ou changer la disposition du graphe Lineage

Tout est dans `frontend/src/pages/LineagePage.tsx::build()` : il transforme le payload `{nodes, edges}` de l'Orchestrator plus la propre liste de runs de cette app en tableaux `nodes`/`edges` ReactFlow, avec des decalages x par run (constantes d'espacement `BW`, `BG`) et des decalages y par etape calcules depuis le nombre d'etapes du run. Ajoutez un nouveau type de noeud en etendant l'union `Kind` et l'enregistrement `META` (titre, classe CSS, couleur de la minimap) en haut du fichier, puis un cas dans `build()` qui pousse un noeud positionne pour lui. La vue en liste rendue quand le bascule graphe/liste est desactive lit la meme structure de donnees `flow.runs`, donc un nouveau type de noeud a generalement besoin d'un petit ajout la aussi s'il doit etre visible hors du graphe.

## Ou ajouter un endpoint ou un champ

Ajoutez la route FastAPI dans le fichier `api/*.py` correspondant (ou un nouveau routeur, monte dans `main.py`), gardez-la derriere `_require_mlflow()` si elle touche le SDK, et refletez la forme de reponse dans `frontend/src/types/api.ts`. Pour un nouveau champ sur une reponse existante (par exemple un nouveau champ de resume de run), ajoutez-le au dict construit dans la fonction backend et a l'interface TypeScript correspondante ; rien d'autre n'a besoin de changer puisque chaque consommateur lit a travers les fonctions typees de `api/client.ts`. Gardez l'ordre de montage des routeurs dans `main.py` avec les chemins specifiques avant les generiques, comme l'indique le commentaire existant.

## Ou changer l'aide et les traductions

Les pages de cette documentation vivent dans `MLflow_App/docs/`, servies par `backend/api/docs.py` et rendues par `frontend/src/components/docs/MarkdownDoc.tsx` sur `frontend/src/pages/DocPage.tsx` (distinct du contenu explicatif propre a la suite aussi nomme `DocPage.tsx` avant l'existence de ce jeu de documentation ; la route `/doc` sert desormais ce markdown rendu a la place). Les chaines francaises sont la source de verite dans le code ; ajoutez leur traduction anglaise au dictionnaire `EXACT_EN` de `frontend/src/i18n/translate.ts` (correspondance exacte) ou a `PHRASE_EN` (sous-chaine, pour les chaines construites dynamiquement). Le contenu explicatif d'origine reste dans le git history si besoin de le retrouver ; les faits qu'il decrivait ont ete integres dans les pages Concepts et README de ce jeu de documentation.

## Outils de debogage

- `GET /health` et `GET /api/mlflow-status` sont les deux verifications les plus rapides pour savoir si le backend peut atteindre le store SQLite.
- Le fichier SQLite `mlflow.db` peut etre ouvert directement avec `mlflow ui --backend-store-uri sqlite:///mlflow.db` (une UI MLflow temporaire et separee) ou tout navigateur SQLite, pour inspecter l'etat des runs independamment de l'interface de cette app.
- Les propres logs de l'app emettrice autour d'un run d'entrainement sont le moyen le plus rapide de confirmer si `mlflow_logging.py` a reellement tente de loguer, puisqu'un echec de logging la est silencieux pour l'entrainement lui-meme.

## Carte des modules

<!-- generated:start -->
### backend

| File | Description | Exports |
|---|---|---|
| `config.py` |  |  |
| `main.py` |  | `lifespan`, `health`, `workspace_users`, `workspace_open`, `workspace_history` |

### backend/api

| File | Description | Exports |
|---|---|---|
| `compare.py` |  | `CompareBody`, `compare_runs` |
| `docs.py` |  | `parse_frontmatter`, `load_doc_set`, `doc_path`, `read_doc`, `safe_asset_path`, `list_docs`, `get_doc_asset`, `get_doc` |
| `experiments.py` |  | `mlflow_status`, `list_experiments`, `ExperimentCreate`, `create_experiment`, `delete_experiment` |
| `models.py` |  | `list_models`, `list_model_versions`, `TransitionBody`, `transition_stage` |
| `runs.py` |  | `list_runs`, `SetTagsBody`, `set_run_tags`, `get_run`, `list_run_artifacts`, `get_run_artifact` |
| `settings.py` |  | `AppSettings`, `load_settings`, `get_settings`, `update_settings` |

### backend/core

| File | Description | Exports |
|---|---|---|
| `mlflow_client.py` |  | `get_client`, `is_mlflow_running`, `ensure_mlflow_running`, `stop_mlflow_server` |

### frontend/src

| File | Description | Exports |
|---|---|---|
| `App.tsx` | Routing + sidebar avec indicateur de statut MLflow. | `App` |
| `main.tsx` |  |  |

### frontend/src/api

| File | Description | Exports |
|---|---|---|
| `client.ts` | Client API typé - axios. | `mlflowAPI`, `experimentsAPI`, `runsAPI`, `modelsAPI`, `compareAPI`, `settingsAPI`, `docsAPI` |

### frontend/src/components

| File | Description | Exports |
|---|---|---|
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
| `useExperiments.ts` |  | `useExperiments`, `useInvalidateExperiments` |
| `useModels.ts` |  | `useModels`, `useModelVersions`, `useInvalidateModels` |
| `useRuns.ts` |  | `useRuns`, `useRun`, `useInvalidateRuns`, `useRunArtifacts` |
| `useSettings.ts` |  | `useSettings`, `useInvalidateSettings` |

### frontend/src/i18n

| File | Description | Exports |
|---|---|---|
| `translate.ts` | Traduction FR -> EN a l'affichage. Le francais reste la source de | `getLang`, `setLang`, `subscribeLang`, `isDesktopPiloted`, `initWorkspaceLanguage`, `setLangAndMaybePersist`, `t` |
| `useLang.ts` |  | `useLang`, `useT` |

### frontend/src/pages

| File | Description | Exports |
|---|---|---|
| `CompareRunsPage.tsx` | Sélection de runs via checkboxes, métriques côte-à-côte. | `CompareRunsPage` |
| `DocPage.tsx` | Page Doc : rend les pages markdown de MLflow_App/docs/ servies | `DocPage` |
| `ExperimentsPage.tsx` | Liste des expériences + drill-down runs par expérience. | `ExperimentsPage` |
| `LineagePage.tsx` |  | `LineagePage` |
| `ModelRegistryPage.tsx` | Modèles enregistrés, versions, transition de stage. | `ModelRegistryPage` |
| `RunDetailPage.tsx` | Métriques (recharts), params, artifacts d'un run MLflow. | `RunDetailPage` |

### frontend/src/types

| File | Description | Exports |
|---|---|---|
| `api.ts` | Interfaces TypeScript - miroir exact des schémas Pydantic. |  |
<!-- generated:end -->
