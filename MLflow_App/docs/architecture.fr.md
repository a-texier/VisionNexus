---
app: mlflow
doc_type: architecture
audience: dev
lang: fr
title: Architecture
order: 60
tags: [fastapi, sdk mlflow, sqlite, serverless, superviseur, lineage]
sources: [MLflow_App/backend/main.py, MLflow_App/backend/config.py, MLflow_App/backend/core/mlflow_client.py, MLflow_App/backend/api/experiments.py, MLflow_App/backend/api/runs.py, MLflow_App/backend/api/models.py, MLflow_App/backend/api/compare.py, Training_App/backend/services/mlflow_logging.py, Orchestrator_App/backend/core/graph_runner.py, MLflow_App/frontend/src/pages/LineagePage.tsx]
---

# Architecture

## Vue d'ensemble des composants de MLflow App

MLflow App est un backend FastAPI leger autour du SDK Python MLflow, le `MlflowClient`, plus un frontend Vite/React. Il ne possede aucune base de donnees ni logique metier propre au-dela du formatage : chaque lecture va directement au `MlflowClient` contre une URI de tracking resolue une fois a l'import, et chaque endpoint d'ecriture (`POST /api/experiments`, l'endpoint de transition de stage, `POST /api/runs/{id}/tags`) est un simple passe-plat vers le SDK.

L'app est un **superviseur**, pas un participant au pipeline : elle n'a pas de routeur `orchestrator.py`, contrairement a DVC App et Optuna App, car elle ne pilote jamais une etape de pipeline. Sa seule integration avec l'Orchestrator est unidirectionnelle et en lecture seule depuis le frontend : la page Lineage recupere `/orchestrator-api/lineage` et `/orchestrator-api/apps` pour dessiner son graphe, et l'Orchestrator, dans l'autre sens, appelle les propres `GET /api/experiments`, `GET /api/runs` et `POST /api/runs/{id}/tags` de cette app a travers son client proxy pour lire les donnees de run et reporter les tags de lineage apres un commit DVC.

## Store serverless : le pivot hors de `mlflow server`

`backend/config.py` resout `MLFLOW_TRACKING_URI` depuis l'environnement, par defaut `sqlite:///<workspace>/mlflow_data/mlflow.db` ; `MLFLOW_ARTIFACT_ROOT` pointe vers `mlflow_data/artifacts/` comme une URI `file://`. `backend/core/mlflow_client.py::get_client()` construit un `MlflowClient(tracking_uri=MLFLOW_TRACKING_URI)` frais a chaque appel ; il n'y a pas d'instance de client longue duree a garder synchronisee, puisque le fichier SQLite lui-meme est l'etat partage.

`_is_http_uri()` verifie si l'URI commence par `http(s)://`. Avec l'URI `sqlite:///` par defaut, `ensure_mlflow_running()` ne demarre aucun processus et confirme seulement que le fichier est accessible via `is_mlflow_running()` (`search_experiments(max_results=1)`) ; aucun port n'est ouvert, donc rien ne peut entrer en collision ou se deconnecter. Ce n'est que quand `MLFLOW_TRACKING_URI` est explicitement defini a une URL `http://` ou `https://` que `ensure_mlflow_running()` lance `python -m mlflow server` en subprocess et le sonde, pour compatibilite avec l'ancienne configuration d'avant 2026-07 ; `stop_mlflow_server()` termine ce subprocess a l'arret, et ne fait rien en mode par defaut.

## Store partage et le cote emetteur

MLflow App ne recoit jamais de "push" d'une app emettrice ; il n'y a aucun appel reseau entre Training App et MLflow App pour le logging. Les deux resolvent independamment exactement le meme chemin de fichier : `backend/config.py` ici calcule `<MLFLOW_APP_WORKSPACE>/mlflow_data/mlflow.db`, tandis que `Training_App/backend/services/mlflow_logging.py::resolve_tracking_uri()` calcule `<workspace>.parent / mlflow_<user> / mlflow_data / mlflow.db` depuis son propre workspace, un dossier sibling sous la meme `<racine-workspaces>` et le meme `<user>`. Quand l'Orchestrator lance une app emettrice, il peut aussi injecter `IA_MLFLOW_TRACKING_URI` directement, que `resolve_tracking_uri()` prefere au chemin sibling calcule.

`mlflow_logging.py` (duplique a l'identique dans chaque app emettrice, jamais importe entre limites d'app) est entierement defensif : chaque methode de son wrapper `_Run` (`log_metrics`, `log_params`, `log_artifact`, `set_tags`, `register_model`, `finish`) est enveloppee dans un `try/except Exception: pass` nu, et `start_run()`/`mlflow_run()` retournent un stub `_Run(mlflow, ok=False)` si `mlflow.start_run()` lui-meme leve. Un entrainement n'echoue jamais, ne ralentit jamais visiblement, et ne change jamais de comportement parce que le logging MLflow a echoue ; il produit simplement aucun run visible.

`_use_experiment()` cote emetteur cree l'emplacement d'artefacts d'une experience explicitement sous `<store>/artifacts/<experience>/` quand l'experience n'existe pas encore, plutot que d'accepter le defaut propre de MLflow de `./mlruns` relatif au dossier de travail du processus emetteur, ce qui disperserait sinon les artefacts hors de tout workspace que cette app sait servir.

## Routeurs backend

`backend/main.py` construit l'app FastAPI avec un `lifespan` qui appelle `ensure_mlflow_running()` au demarrage et `stop_mlflow_server()` a l'arret (les deux sont des no-op en mode serverless par defaut), et monte cinq routeurs plus le routeur `docs` ajoute pour ce jeu de documentation : `experiments`, `runs`, `models`, `compare`, `settings`, `docs`. `/health` et les auxiliaires de workspace (`/api/workspace/users`, `/api/workspace/open`, `/api/workspace/history`) sont definis directement sur l'app, identiques en source aux autres apps de la suite.

Chaque routeur partage le meme garde-fou `_require_mlflow()`, levant une 503 avant de toucher `MlflowClient` si `is_mlflow_running()` est faux, donc un store brievement inaccessible produit une forme d'erreur coherente partout au lieu d'une exception brute du SDK qui fuiterait.

- `api/experiments.py` : `GET`/`POST`/`DELETE /api/experiments`, plus `GET /api/mlflow-status` utilise par le point de la barre laterale.
- `api/runs.py` : `GET /api/runs` (par `experiment_id`), `GET /api/runs/{id}` (avec son historique complet de metriques et sa liste d'artefacts), `POST /api/runs/{id}/tags` (utilise par le report de lineage de l'Orchestrator apres un commit DVC), et le couple de service d'artefacts `GET /api/runs/{id}/artifacts` (liste) et `GET /api/runs/{id}/artifact` (un seul fichier image, restreint a `.png`/`.jpg`/`.jpeg`).
- `api/models.py` : `GET /api/models`, `GET /api/models/{name}/versions` et l'endpoint de transition de stage.
- `api/compare.py` : `POST /api/compare`, calculant l'union et l'intersection des cles de metriques et de parametres a travers les runs demandes cote backend, pour que le frontend n'ait jamais a reconcilier des cles disparates lui-meme.
- `api/docs.py` : sert ce jeu de documentation a la page Doc du frontend.

## Structure du frontend et le graphe Lineage

`frontend/src/App.tsx` est une disposition a barre laterale unique avec six routes : `/` et `/lineage` (`LineagePage`), `/experiments` (`ExperimentsPage`, accessible mais absente de la barre laterale), `/runs/:runId` (`RunDetailPage`), `/models` (`ModelRegistryPage`), `/compare` (`CompareRunsPage`) et `/doc` (`DocPage`). `api/client.ts` contient chaque appel type vers le propre backend de cette app ; `LineagePage.tsx` appelle en plus l'Orchestrator directement via `axios` sur `/orchestrator-api/lineage` et `/orchestrator-api/apps`, en contournant `api/client.ts`, puisque ces donnees ne viennent pas du propre backend de cette app.

`LineagePage.tsx::build()` fusionne deux sources en un graphe : le payload canonique `{nodes, edges}` de l'Orchestrator (dataset source, subsets, un noeud par run de pipeline) et le propre `runsAPI.list()` de cette app par experience (utilise pour attacher des metriques en direct sur les noeuds d'etape de chaque run via `stageById`, indexe par `run_id`). La hauteur de l'image d'un run et la largeur totale du graphe sont calculees depuis son nombre d'etapes pour que les runs replies (etat `collapsed`, bascule par run) prennent moins de place sans necessiter une seconde passe de mise en page.

## Invariants a ne pas casser

- **Ne jamais lancer de processus `mlflow server` dans la configuration par defaut.** `ensure_mlflow_running()` doit continuer a conditionner strictement le demarrage en mode serveur sur `_is_http_uri()` ; demarrer un serveur inconditionnellement reintroduirait les collisions de port et deconnexions que le pivot de 2026-07 a supprimees.
- **Les deux cotes du store partage doivent continuer a resoudre le meme chemin.** Tout changement a la formule chemin-workspace-vers-store dans `backend/config.py` doit etre reflete dans le `mlflow_logging.py::resolve_tracking_uri()` de chaque app emettrice, sinon les runs cessent silencieusement d'apparaitre d'un cote pendant que l'autre continue de loguer avec succes.
- **Le logging cote emetteur reste 100% defensif.** Le `except Exception: pass` nu autour de chaque appel SDK dans `mlflow_logging.py` est delibere : un entrainement ne doit jamais echouer, ralentir, ou changer ses artefacts sauvegardes parce que le logging MLflow a leve une exception.
- **MLflow App ne pilote aucune etape de pipeline.** Ajouter un routeur `orchestrator.py` ou un endpoint que l'Orchestrator appellerait pour avancer un graphe casserait le contrat de superviseur documente dans `Orchestrator_App/CLAUDE.md` et changerait la facon dont l'Orchestrator decide quelles apps auto-lancer.
- **Les tags de lineage sont additifs, jamais deduits.** `git_commit` et `dataset_version` ne sont ecrits que par le report de commit DVC de l'Orchestrator ; MLflow App ne doit pas deviner ou reconstruire ces champs quand ils sont absents, puisque [Concepts](concepts.fr.md) documente leur absence comme significative (pas encore de commit DVC) plutot que comme une donnee manquante a masquer.
