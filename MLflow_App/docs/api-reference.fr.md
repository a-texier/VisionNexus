---
app: mlflow
doc_type: api-reference
audience: dev
lang: fr
title: Reference API
order: 70
tags: [rest api, fastapi, mlflow, endpoints]
sources: [MLflow_App/backend/main.py, MLflow_App/backend/api/experiments.py, MLflow_App/backend/api/runs.py, MLflow_App/backend/api/models.py, MLflow_App/backend/api/compare.py, MLflow_App/backend/api/settings.py, MLflow_App/backend/api/docs.py]
---

# Reference API

## Conventions de l'API MLflow App

Le backend de MLflow App expose une API REST JSON sous `/api` et une documentation interactive (Swagger) sur `/docs` au port du backend (8001 en mode autonome, voir [Configuration](configuration.fr.md)). A travers le frontend Vite, `/api` est redirige vers ce backend et `/orchestrator-api` vers le propre backend de l'Orchestrator (utilise seulement par la page Lineage).

Regles generales :

- **Les erreurs** utilisent le format de FastAPI `{"detail": "..."}`. Chaque endpoint qui touche `MlflowClient` retourne 503 avec "Serveur MLflow non disponible" (ou, sur `/api/experiments`, une formulation plus ancienne mentionnant le port 5000, voir [Depannage](troubleshooting.fr.md)) quand le store est inaccessible, et 500 sur toute autre erreur SDK.
- **Les timestamps** (`creation_time`, `start_time`, `end_time`, ...) sont des millisecondes depuis l'epoch, ou `null`, exactement comme retournes par le SDK MLflow ; le frontend les formate localement.
- **Cette API est majoritairement en lecture.** Au-dela de creer ou supprimer une experience, poser des tags de run, et transitionner le stage d'une version de modele, rien ici ne demarre, n'arrete ou ne modifie un run : les runs sont ecrits exclusivement par les apps qui entrainent, evaluent ou font de l'inference.

Les tableaux d'endpoints de la section *Index des endpoints* sont generes depuis le code ; les sections ci-dessous expliquent chaque domaine.

## Experiences et statut du store

- `GET /api/mlflow-status` rapporte `{running, version}`, utilise par le point de statut de la barre laterale ; `running` reflete `is_mlflow_running()` exactement comme decrit dans [Architecture](architecture.fr.md).
- `GET /api/experiments` liste chaque experience (actives et supprimees, `ViewType.ALL`) ; `POST /api/experiments` en cree une (`name`, `artifact_location` et `tags` optionnels) ; `DELETE /api/experiments/{id}` la supprime.
- Ces deux endpoints alimentent la page Experiments et le point de statut de la barre laterale ; aucun n'est appele par la page Lineage, qui lit les runs directement sans d'abord lister les experiences.

## Runs, tags et artefacts

- `GET /api/runs?experiment_id=...` liste les runs d'une experience (`max_results`, `order_by`, defaut `start_time DESC`). `GET /api/runs/{id}` retourne le meme resume plus `metric_history` (chaque etape loguee de chaque metrique) et `artifacts` (la liste d'artefacts a la racine).
- `POST /api/runs/{id}/tags` fusionne les `tags` donnes sur un run ; utilise par l'Orchestrator pour reporter `git_commit` et `dataset_version` apres un commit DVC (voir [Concepts](concepts.fr.md)). Il ne retire jamais un tag existant, il ajoute ou ecrase seulement les cles donnees.
- `GET /api/runs/{id}/artifacts?path=` liste un sous-dossier d'artefacts (`path` vide = racine). `GET /api/runs/{id}/artifact?path=...` sert un seul fichier image (`.png`/`.jpg`/`.jpeg` seulement ; toute autre extension est rejetee avec 400) en le telechargeant d'abord via le SDK, utilise par la galerie de plots de la page de detail de run.

## Endpoints du model registry

- `GET /api/models` liste chaque modele enregistre avec ses `latest_versions` (une entree par stage qui a une version). `GET /api/models/{name}/versions` liste chaque version d'un modele, la plus recente d'abord par numero de version, pas limitee a la derniere par stage.
- `POST /api/models/{name}/versions/{version}/transition` deplace une version vers `stage` (`None`, `Staging`, `Production` ou `Archived`), avec un drapeau `archive_existing_versions` optionnel pour auto-archiver les autres versions au stage cible.
- Le nom d'un modele et ses versions sont entierement geres par l'app emettrice qui appelle `register_model` ; cette app ne fait que les lire et les transitionner, elle ne cree jamais elle-meme un modele ou une version.

## Endpoints de comparaison, parametres et documentation

- `POST /api/compare` prend 2 a 10 `run_ids` et retourne le detail complet de chaque run plus l'union et l'intersection de leurs cles de metriques et de parametres (`all_metrics`, `common_metrics`, `all_params`, `common_params`), calculees une fois cote backend plutot que par graphique cote frontend.
- `GET`/`PUT /api/settings` : le fichier de parametres propre a l'app, incluant `mlflow_tracking_uri` a titre d'affichage seulement (le changer ici ne change pas l'URI de tracking reelle du backend, fixee au demarrage du processus depuis l'environnement).
- `GET /api/docs`, `GET /api/docs/{name}` et `GET /api/docs/assets/{path}` : ce jeu de documentation, servi a la page Doc du frontend.

## Endpoints de sante et de workspace

- `GET /health` retourne `{"status": "ok", "mlflow_running": bool}`. VisionNexus le sonde avant d'ouvrir l'onglet de l'app.
- `GET /api/workspace/users`, `POST /api/workspace/open`, `GET /api/workspace/history` : auxiliaires de workspace partages utilises par le badge utilisateur, identiques en source aux autres apps de la suite ; aucun ne touche le store MLflow.
- Ces endpoints restent utiles meme quand le store MLflow est inaccessible, puisqu'ils ne dependent pas de `_require_mlflow()`. C'est pourquoi le point de statut de la barre laterale continue de repondre meme quand le reste de l'interface affiche des erreurs 503.

## Index des endpoints

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
