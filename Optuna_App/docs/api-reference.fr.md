---
app: optuna
doc_type: api-reference
audience: dev
lang: fr
title: Reference API
order: 70
tags: [rest api, fastapi, sse, endpoints, orchestrator]
sources: [Optuna_App/backend/main.py, Optuna_App/backend/api/studies.py, Optuna_App/backend/api/orchestrator.py, Optuna_App/backend/api/settings.py, Optuna_App/backend/api/docs.py]
---

# Reference API

## Conventions de l'API Optuna App

Le backend d'Optuna App expose une API REST JSON sous `/api`, un flux de logs SSE sous `/api/studies/{name}/logs`, et une documentation interactive (Swagger) sur `/docs` au port du backend (8003 en mode autonome, voir [Configuration](configuration.fr.md)). A travers le frontend Vite, `/api` est redirige, donc le frontend appelle des URL relatives ; le flux de logs se connecte directement au port du backend.

Regles generales :

- **Les erreurs** utilisent le format de FastAPI `{"detail": "..."}` avec 404 (etude inconnue), 409 (etat en conflit, par exemple demarrer une etude deja en cours) ou 500. Les messages de detail sont ecrits en francais ; le frontend les affiche tels quels.
- **Les noms d'etudes** sont utilises comme segments de chemin et doivent etre encodes URL par l'appelant (`encodeURIComponent` dans le client frontend).
- **L'endpoint Orchestrator est bloquant** : `POST /api/orchestrator/hpo` ne repond qu'une fois chaque trial demande termine, contrairement au couple autonome `start`/`status`.

Les tableaux d'endpoints de la section *Index des endpoints* sont generes depuis le code ; les sections ci-dessous expliquent chaque domaine.

## Etudes : CRUD, trials, lancement et statut

Le routeur des etudes (`/api/studies`) couvre tout ce qui est pilote depuis l'interface.

- `GET /api/studies` liste chaque etude avec sa direction, ses comptes de trials et sa meilleure valeur (utilise par la page des etudes) ; `POST /api/studies` en cree une (`study_name`, `direction` `minimize` ou `maximize`) ; `DELETE /api/studies/{name}` la retire du stockage Optuna (les fichiers de ses trials sous `hpo_runs/` ne sont pas supprimes).
- `GET /api/studies/{name}/trials` liste chaque trial avec son etat effectif, sa valeur, ses parametres, sa duree et ses artefacts recuperes, le cas echeant. `GET /api/studies/{name}/best` retourne le meilleur trial, ou 404 si aucun n'a termine.
- `GET /api/studies/{name}/analysis` retourne tout le payload du tableau de bord en un seul appel : resume de configuration, espace de recherche, importances de parametres (fANOVA) avec avertissements, comptes d'etats bruts et effectifs, analyse du sampler et du pruner, resumes de l'objectif et de la duree.
- `POST /api/studies/{name}/start` lance une optimisation en arriere-plan (`script_path`, `script_args`, `n_trials`, `metric_name`, `direction`, `param_space`) ; 409 si une est deja en cours pour cette etude. `POST /api/studies/{name}/stop` demande un arret propre apres le trial courant ; 409 si aucune n'est en cours.
- `GET /api/studies/{name}/status` retourne le statut en direct : comptes Optuna, diagnostics regroupes par cause racine, phase du sampler et tout candidat historique recupere. `GET /api/studies/{name}/logs` diffuse le journal du run en arriere-plan en `text/event-stream`.

## Endpoints d'integration Orchestrator

- `GET /api/orchestrator/engines` liste les moteurs d'entrainement exploitables par un trial, avec le catalogue HPO de chaque moteur (plages par defaut, selection par defaut, tailles de modele) ; retourne une liste vide et un champ `error` si Training App ne peut pas etre importe.
- `POST /api/orchestrator/hpo` execute une etude Optuna complete et bloquante (voir [Architecture](architecture.fr.md)) et retourne `best_params`, `best_value`, `n_trials` et les details d'echec dans la meme reponse ; ne leve jamais d'erreur HTTP pour une etude echouee, puisque la politique de pipeline de l'Orchestrator (arreter ou se replier sur les defauts de Training) est exprimee dans le corps de la reponse (`ok`, `hpo_succeeded`, `fallback_to_training_defaults`).

## Endpoints de parametres, documentation, sante et workspace

- `GET`/`PUT /api/settings` : le fichier de parametres propre a l'app (theme, repli de langue d'interface). `workspace_path` et `user_name` refletent toujours l'environnement, jamais le fichier sauvegarde.
- `GET /api/docs`, `GET /api/docs/{name}` et `GET /api/docs/assets/{path}` : ce jeu de documentation, servi a la page Documentation du frontend (voir [Carte du code](code-map.fr.md)).
- `GET /health` retourne `{"status": "ok", "study_count": N}`, ou un champ `warning` si le stockage Optuna n'a pas pu etre liste. VisionNexus le sonde avant d'ouvrir l'onglet de l'app.
- `GET /api/workspace/users`, `POST /api/workspace/open`, `GET /api/workspace/history` : auxiliaires de workspace partages utilises par le badge utilisateur, identiques en source aux autres apps de la suite ; aucun ne touche au stockage propre d'Optuna.

## Index des endpoints

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
