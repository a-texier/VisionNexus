---
app: training
doc_type: api-reference
audience: dev
lang: fr
title: Référence API
order: 70
tags: [api rest, sse, endpoints, fastapi, orchestrateur]
sources: [Training_App/backend/main.py, Training_App/backend/routers/training.py, Training_App/backend/routers/orchestrator.py, Training_App/backend/routers/capabilities.py, Training_App/backend/api/settings.py]
---

# Référence API

## Conventions de l'API Training App

Le backend expose une API REST JSON sous `/api`, un flux SSE sous `/api/training/{run_name}/events`, et une documentation interactive (Swagger) sur `/docs` au port du backend (8064 par défaut, voir [Configuration](configuration.fr.md)). Via le frontend Vite, `/api` est proxifié, mais le flux SSE et les images d'artefacts sont récupérés directement au port du backend par le frontend (voir [Architecture](architecture.fr.md)).

Règles générales :

- **Erreurs** au format FastAPI `{"detail": "..."}`, avec 400 (requête invalide, par exemple un moteur ou une taille inconnus), 404 (run inconnu) ou 500. Les messages de détail sont écrits en français ; le frontend les affiche tels quels.
- **Opérations longues** (un entraînement) ne renvoient pas d'identifiant de tâche à interroger génériquement : suivez un run avec `GET /api/training/{run_name}/status`, `GET /api/training/{run_name}/metrics-history`, ou le flux SSE `GET /api/training/{run_name}/events`.
- **Moteur et taille** : la plupart des endpoints acceptent un champ `engine` ; une valeur vide résout au moteur par défaut de l'instance (champ `active` de `GET /api/capabilities`). Une valeur `model_size` vide résout à la taille par défaut de ce moteur.
- **Hyperparamètres** : envoyés en `dict` plat ; les clés inconnues du moteur résolu sont retirées et listées dans le champ `ignored_hyperparams` de la réponse plutôt que de provoquer une erreur.

Les tableaux d'endpoints de la section *Index des endpoints* sont générés depuis le code ; les sections ci-dessous expliquent chaque domaine.

## Endpoints de run : démarrer, suivre, arrêter, supprimer

- `POST /api/training/start` : crée un `TrainingRun` et démarre l'entraînement en arrière-plan. Corps : `engine`, `model_size`, `model_weights`, `data_yaml` (obligatoire, vérifié comme existant sur le backend), `dataset_name`, `hyperparams`. Renvoie `{run_name, run_id, status: "pending", engine, ignored_hyperparams}`.
- `GET /api/training/runs` : tous les runs, du plus récent au plus ancien, avec chaque champ persisté (statut, progression, métriques, chemins, hyperparamètres, dates).
- `GET /api/training/{run_name}/status` : les mêmes champs pour un run.
- `POST /api/training/{run_name}/stop` : arme le drapeau d'arrêt du run ; renvoie `{ok: bool}` (`false` si le run n'est pas suivi en mémoire, par exemple après un redémarrage du backend).
- `DELETE /api/training/{run_name}` : retire uniquement la ligne en base ; le dossier du run sur le disque n'est pas supprimé (voir [Workflows](workflows.fr.md)).

## Endpoints de progression : flux SSE et historique des métriques

- `GET /api/training/{run_name}/events` (SSE) : diffuse les événements `status`, `epoch`, `done`, `error` et `stopped` au fil de l'eau, depuis le journal d'événements en mémoire du run (voir [Architecture](architecture.fr.md)). La connexion se ferme après un événement terminal. Les événements antérieurs à la connexion ne sont pas rejoués une fois l'enregistrement en mémoire du run disparu.
- `GET /api/training/{run_name}/metrics-history` : lit `results.csv` du dossier du run et renvoie `{epochs: [{epoch, map50, map5095, precision, recall, box_loss, cls_loss}]}`. Les noms de colonnes sont appariés par moteur (`iou_loss` ou `train/box_loss` correspondent tous deux à `box_loss`), cet endpoint fonctionne donc à travers des moteurs aux noms de pertes différents. Renvoie `{epochs: []}` si le fichier est absent.

## Endpoints de catalogue de modèles et de capacités

- `GET /api/capabilities` : `{trainer_backends: [...], default, active}`. Chaque entrée de `trainer_backends` a `name`, `label`, `source` (`builtin`, `plugin` ou `entry_point`), `available`, `reason` (si indisponible), et `catalog` (catalogue complet du moteur, uniquement pour les moteurs disponibles). `active` est le moteur utilisé quand une requête n'en nomme aucun.
- `GET /api/training/models?engine=` : le catalogue d'un moteur (`{engine, label, weights_suffixes, sizes, default_size, size_prefix, defaults, groups, keys, hpo_ranges, hpo_default_optimize, artifacts, train_batches_glob, pretrained_by_default}`), utilisé par la page **Training** pour construire son formulaire et par Optuna App pour son espace de recherche.

## Endpoints d'analyse : artefacts et cas d'inférence

- `GET /api/training/{run_name}/artifacts` : graphiques du run, groupés par catégorie telle que déclarée dans le catalogue de son moteur, plus `train_batches` et `run_dir`. Renvoie `{engine_error: "..."}` à la place des catégories si le moteur du run n'est plus disponible.
- `GET /api/training/{run_name}/artifact/{name:path}` : sert une image de graphique depuis le dossier du run ; `name` doit être un chemin relatif sans `..` ni `/` de tête, résolvant vers un fichier existant à l'intérieur du dossier du run (400/404 sinon).
- `GET /api/training/{run_name}/inference-cases?top_k=4` : exécute le meilleur modèle du run sur jusqu'à 200 images de validation et renvoie les `top_k` images aux détections les plus et les moins confiantes (`{run_name, n_images_scored, best: [...], worst: [...]}`, chaque élément `{file, source, detections, mean_conf}`). Requiert que `best_model_path` existe et que le moteur expose `load_predictor` ; le résultat est mis en cache dans `inference_cases/cases.json` du dossier du run.

## Endpoints de réglages et d'application

- `GET` / `PUT /api/settings` : lit ou fusionne `ui_language` du workspace (voir [Configuration](configuration.fr.md)) ; utilisé uniquement hors VisionNexus.
- `GET /health` : `{"status": "ok", "app": "Training_App"}`, sans condition (aucun modèle à charger au démarrage).
- `GET /` : `{"app", "version", "docs", "health"}`.
- `GET /api/app-mode` : `{mode: "solo" | "orchestrator", runs_dir, workspace}`, lu par le frontend pour afficher le bandeau orchestrateur.
- `GET /api/workspace/users` : instances de cette app enregistrées dans le registre partagé du lanceur (`IA_INSTANCES_FILE`), utilisé par le badge utilisateur ; renvoie `[]` hors d'une session gérée par un lanceur.
- `POST /api/workspace/open?path=` : ouvre un dossier dans l'explorateur de fichiers du système sur la machine du backend (résultat sans effet sur une VM distante sans interface au-delà du renvoi du chemin).

## Endpoints d'intégration Orchestrator

Le router `/api/orchestrator` est le contrat avec Orchestrator App ; ses endpoints sont conçus pour être appelés par un autre backend et restent stables (voir [Architecture](architecture.fr.md)).

- `POST /api/orchestrator/train` : `dataset_path` (un dossier fouillé pour `data.yaml`, ou un `.zip` extrait une fois) ou `data_yaml` (chemin explicite, prioritaire), `dataset_name`, `engine`, `model_size`, `model_weights`, `hyperparams`, `epochs`/`batch`/`imgsz` génériques, `optuna_best` (meilleurs paramètres d'un nœud Optuna amont ; une valeur non-dict, comme un placeholder non résolu, est convertie en `{}`), `trace` (`{graph_id, graph_name, node_id, node_label, run_id, experiment, run_type, fork_parent_run}` pour les tags MLflow et le nommage du run). **Bloque** jusqu'à ce que le run atteigne `done`, `error` ou `stopped` (régi par `TRAINING_ORCH_BLOCKING` et `TRAINING_ORCH_MAX_WAIT_S`, voir [Configuration](configuration.fr.md)), puis renvoie `{status: "ok", run_name, run_id, run_status, best_map50, best_map5095, best_model_path, engine, model_size, ignored_hyperparams, data_yaml, message}`, ou lève une 500 avec le message d'erreur du run s'il a échoué.
- `GET /api/orchestrator/run-status?run_name=` : état actuel d'un run (`{run_name, status, engine, model_size, progress_pct, current_epoch, total_epochs, best_map50, best_map5095, best_model_path, error_message}`), utilisé pour le polling par des intégrations personnalisées (l'exécuteur de pipeline de l'Orchestrator App lui-même s'appuie plutôt sur la réponse bloquante de `POST /train`).

## Index des endpoints

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
| GET | `/api/training/models` | Catalogue d'un moteur (tailles, defauts, formulaire, plages HPO, plots). `sizes`/`defaults` restent a la racine pour les anciens clients. | `Training_App/backend/routers/training.py:407` |
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
