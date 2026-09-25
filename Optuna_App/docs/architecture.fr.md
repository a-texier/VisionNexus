---
app: optuna
doc_type: architecture
audience: dev
lang: fr
title: Architecture
order: 60
tags: [fastapi, optuna, sqlite, sse, thread arriere-plan, training app]
sources: [Optuna_App/backend/main.py, Optuna_App/backend/config.py, Optuna_App/backend/core/optuna_runner.py, Optuna_App/backend/core/diagnostics.py, Optuna_App/backend/api/studies.py, Optuna_App/backend/api/orchestrator.py, Optuna_App/backend/hpo_trial.py, Optuna_App/frontend/src/App.tsx]
---

# Architecture

## Vue d'ensemble des composants d'Optuna App

Optuna App est un backend FastAPI plus un frontend Vite/React, avec le stockage SQLite propre a Optuna comme unique base de donnees. Il a deux facons independantes d'executer une optimisation, partageant le meme stockage et le meme tableau de bord :

- Le **runner autonome** (`backend/core/optuna_runner.py`), utilise par les etudes creees et lancees depuis l'interface, qui execute un thread arriere-plan par etude et diffuse les logs par evenements envoyes par le serveur.
- L'**endpoint Orchestrator** (`backend/api/orchestrator.py`), utilise quand un noeud de pipeline appelle `POST /api/orchestrator/hpo`, qui execute une etude Optuna bloquante dans la requete HTTP elle-meme.

Les deux ecrivent dans le meme `optuna.db` et reutilisent le meme code de diagnostic d'echec (`backend/core/diagnostics.py`), donc une etude a le meme aspect sur la page d'etude quoi qu'elle ait lancee.

## Demarrage de l'application backend

`backend/main.py` construit l'app FastAPI avec un `lifespan` qui sonde le stockage Optuna (`optuna.get_all_study_summaries`) pour confirmer que le fichier SQLite est accessible, journalisant un avertissement plutot qu'un echec s'il n'est pas encore initialise. Il monte quatre routeurs (`studies`, `settings`, `orchestrator`, `docs`) et definit directement sur l'app : `/health`, et les auxiliaires de workspace `/api/workspace/users`, `/api/workspace/open` et `/api/workspace/history`, partages en source avec les autres apps de la suite (Annotation, MLflow, DVC portent chacune leur propre copie). Le CORS est configure depuis `CORS_ORIGINS` de `backend/config.py`, qui inclut toujours le port frontend courant en plus de la plage de ports habituelle de la suite, pour qu'un frontend lance manuellement sur un autre port atteigne quand meme le backend.

## Routeurs et services du backend

`backend/config.py` resout le workspace (`OPTUNA_APP_WORKSPACE`), l'URL de stockage SQLite (`OPTUNA_STORAGE`), les ports et les origines CORS ; tout autre module importe depuis lui.

- `backend/api/studies.py` : CRUD sur les etudes (`GET`/`POST`/`DELETE /api/studies`), liste des trials, l'endpoint `/analysis` qui calcule tout le payload du tableau de bord, `/best`, `/start`, `/stop`, `/status` et l'endpoint SSE `/logs`. Il contient aussi la logique de qualification d'etat (`_effective_state`, `_is_stale_running`) et la logique de recuperation legacy (`_recover_legacy_artifacts`, `_legacy_log_diagnostic`) qui ne reecrivent jamais la base Optuna.
- `backend/api/orchestrator.py` : `GET /api/orchestrator/engines` (liste les moteurs d'entrainement et leur catalogue HPO) et `POST /api/orchestrator/hpo` (execute une etude bloquante).
- `backend/api/settings.py` : `GET`/`PUT /api/settings`, un petit fichier JSON dans le workspace (chemin du workspace et nom d'utilisateur toujours ecrases depuis l'environnement, jamais persistes).
- `backend/api/docs.py` : sert les pages de cette documentation a la page Documentation du frontend.
- `backend/core/optuna_runner.py` : le runner autonome (voir ci-dessous).
- `backend/core/diagnostics.py` : `diagnose_failure(raw_text)`, une table de regles partagee qui transforme un texte d'erreur brut ou un extrait de stderr en `{code, title, reason, action}`, utilisee par les deux runners et par la reponse de l'Orchestrator.
- `backend/hpo_trial.py` : le script de trial de reference pour les etudes Orchestrator et le prereglage de detection (voir ci-dessous).

## Runner autonome : thread arriere-plan et SSE

`start_optimization()` refuse de demarrer si un `StudyRunState` pour la meme etude est deja `running` (dict au niveau module `_study_states`, une entree par nom d'etude, qui survit a la navigation du frontend mais pas a un redemarrage du backend). Sinon il lance un `threading.Thread` daemon executant `_run()`, qui appelle le `study.optimize()` synchrone d'Optuna avec un `TPESampler` et un `NopPruner`, et une closure `objective()` qui :

1. Suggere chaque hyperparametre de `param_space` avec `trial.suggest_float/int/categorical`.
2. Construit `python <script> <script_args> --k1 v1 --k2 v2 ...` et l'execute avec `subprocess.run(..., timeout=3600)`.
3. Sur un code de sortie non nul, un timeout, ou une derniere ligne inanalysable, appelle `diagnose_failure()`, stocke ses champs comme `trial.user_attrs["failure_*"]` et leve `RuntimeError` (captoure par le `catch=(RuntimeError,)` d'Optuna, donc le trial est marque `FAIL` et l'etude continue).
4. En cas de succes, analyse la derniere ligne stdout comme un flottant (ou une ligne `nom_metrique=valeur` en repli) et retourne cette valeur.

`StudyRunState.add_log()` ajoute des lignes horodatees a une liste en memoire plafonnee a 500 entrees. `stream_logs()` est un generateur async qui sonde cette liste et emet les nouvelles lignes plus un evenement de statut en `text/event-stream`, jusqu'a ce que l'etat atteigne `finished`, `stopped` ou `error`. Le frontend s'y connecte directement au port du backend (`api/client.ts::streamLogs`), en contournant le proxy Vite, qui bufferise le SSE.

## Endpoint Orchestrator : etude bloquante dans la requete

`run_hpo()` resout `data.yaml` depuis `dataset_path` ou `data_yaml` de la requete (en extrayant un export `.zip` une fois dans `hpo_datasets/`), charge le catalogue de moteur depuis Training App via injection `sys.path` (`_TRAINING_APP_BACKEND = ../Training_App/backend`), et construit l'espace de recherche depuis les `hpo_ranges` du catalogue, filtres par les cles `optimize` demandees (ou la selection par defaut du catalogue). Il cree alors une etude fraiche (nom derive des identifiants de graphe/run/noeud/attempt, ou du nom du dossier dataset) et appelle `study.optimize()` de facon synchrone dans le handler de requete : **l'appel HTTP ne retourne pas avant que tous les trials soient termines**, contrairement a tout autre endpoint `orchestrator.py` de la suite, qui retourne immediatement un `run_id` a sonder.

L'`objective()` de chaque trial execute `python hpo_trial.py --data_yaml ... --engine ... --result_json <dossier_trial>/result.json ...` avec un timeout par trial (`trial_timeout_s`, 1200 s par defaut), ecrit `stdout.log`/`stderr.log` sous `hpo_runs/<etude>/trial_<NNNN>/`, et en cas de succes lit `objective_value` depuis `result.json` plutot que depuis stdout (l'encodage de la console Windows peut sinon corrompre ou perdre stdout avant qu'il n'atteigne le parent, d'ou ce transport par fichier JSON). `ACTIVE_HPO_STUDIES` est un ensemble au niveau module des noms d'etudes en cours ici, verifie par `studies.py::_is_active_here()` pour que la page d'etude ne marque pas a tort une etude Orchestrator vraiment en cours comme `INTERRUPTED`.

## Contrat du script de trial (hpo_trial.py)

`hpo_trial.py` est l'unique implementation de reference d'un trial, pour l'endpoint Orchestrator et pour le prereglage de detection. Il importe `services.trainer_backend` depuis Training App via `sys.path` (meme motif inter-apps que `Inference_App/backend/services/tracker_bridge.py`), resout le moteur et la taille de modele demandes, fusionne les arguments CLI libres `--cle valeur` avec le catalogue du moteur (les cles inconnues sont ignorees et rapportees dans `ignored_params`), instancie la classe de trainer du moteur et appelle `.train()`.

Il ecrit son resultat de facon atomique (`_write_result` : ecrit dans un fichier `.tmp`, puis `os.replace`) dans `--result_json`, avec `status: "completed"` ou `"failed"`, la valeur objectif et `map50`/`map5095` tous deux, et les chemins de `results.csv` et des checkpoints. Pour la compatibilite avec l'ancien contrat stdout brut, il imprime aussi `metric=valeur` et la valeur brute vers `sys.__stdout__` explicitement (un moteur d'entrainement peut rediriger `sys.stdout` vers son propre logger, ce qui avalerait sinon ces lignes avant qu'elles n'atteignent le pipe du processus parent).

## Diagnostic d'echec et recuperation de trials legacy

`diagnose_failure(raw_text)` dans `backend/core/diagnostics.py` est une liste ordonnee de regles `(patterns, code, title, action)` comparee au texte d'erreur en minuscules (les erreurs de store MLflow sont verifiees avant les erreurs de modele manquant, car une trace MLflow mentionnant "model"/"store" serait sinon mal classee). Les deux runners l'appellent une fois par trial echoue et stockent les quatre champs comme attributs utilisateur du trial, que `studies.py` relit sans les modifier.

`studies.py` reconstruit en plus des informations pour les trials qui precedent ce systeme de diagnostic ou qui ont ete abandonnes :

- `_is_stale_running()` : un trial `RUNNING` vieux de plus de 30 minutes sans entree correspondante dans `ACTIVE_HPO_STUDIES` ou `StudyRunState` est lu comme `INTERRUPTED`, une qualification en lecture jamais reecrite dans la base Optuna.
- `_recover_legacy_artifacts()` : pour un ancien trial `FAIL`/`PRUNED` sans attribut `artifact_dir`, le rapproche des `runs/detect/*/args.yaml` d'Ultralytics en comparant hyperparametres et timestamp, pour exposer son `results.csv` et ses poids comme "informatif, non COMPLETE" sans changer l'etat du trial.
- `_legacy_log_diagnostic()` : parcourt les fichiers `optuna_backend_*.log` a la recherche d'un echec de chargement de dataset correspondant au timestamp et au numero d'un ancien trial `PRUNED`.

## Structure du frontend

L'app React (`frontend/src/App.tsx`) est une disposition a barre laterale unique avec cinq routes : `/` (`StudiesPage`), `/studies/:studyName` (`StudyDetailPage`), `/studies/:studyName/launch` (`LaunchPage`), `/learn/hpo` (`HPOLearnPage`) et `/guide` (`GuidePage`, cette documentation). `StudyDashboard.tsx` regroupe les huit panneaux d'analyse (apercu, espace de recherche, historique, distribution, carte de chaleur, evolution TPE, importance, resume du pruning, coordonnees paralleles) consommes par `StudyDetailPage`, tous alimentes par le seul payload `GET /api/studies/{name}/analysis` plus la liste des trials. `EnginePreset.tsx` appelle `GET /api/orchestrator/engines` une fois au montage et, quand des moteurs sont disponibles, rend le prereglage d'entrainement de detection montre sur `LaunchPage`.

TanStack Query pilote toute la recuperation de donnees avec des `refetchInterval` par endpoint (5 s pour le badge des etudes en cours, 15 s pour la liste des etudes, 2 s ou 10 s pour le statut d'une etude selon qu'elle tourne ou non, 5 s ou 30 s pour son analyse). `i18n/translate.ts` contient un dictionnaire francais-vers-anglais par correspondance exacte ; le francais est la langue source dans le code et l'anglais est une couche de traduction appliquee au rendu via `t()`.

## Invariants a ne pas casser

- **Un seul worker uvicorn.** Le stockage SQLite d'Optuna n'est pas sur pour des ecrivains concurrents ; tourner avec `--workers > 1` corrompt l'etat des etudes sous des ecritures concurrentes de trials.
- **`ACTIVE_HPO_STUDIES` et `StudyRunState` sont locaux au processus.** Un redemarrage du backend les perd ; toute etude vraiment en cours a ce moment sera relue comme `INTERRUPTED` une fois la fenetre de 30 minutes ecoulee, ce qui est un signal delibere en lecture, pas un bug a "corriger" en persistant ces ensembles.
- **Ne jamais reecrire l'etat propre a Optuna des trials depuis `studies.py`.** `INTERRUPTED`, `LEGACY_PRUNED_UNKNOWN` et `LEGACY_FAILURE_RECOVERED` sont des qualifications d'affichage seulement, calculees a chaque lecture ; les artefacts recuperes et les correspondances de log legacy sont exposes comme des champs separes, jamais utilises pour promouvoir silencieusement un trial `FAIL`/`PRUNED` en `COMPLETE`.
- **Le script de trial imprime derniere-ligne-puis-rien.** Tout changement dans la sortie finale de `hpo_trial.py`, ou dans la gestion stdout du moteur, qui empeche la valeur brute finale d'atteindre `sys.__stdout__` casse le contrat de repli stdout dont dependent encore le prereglage de detection et tout script ecrit a la main.
- **`/api/orchestrator/hpo` reste bloquant.** C'est le seul `orchestrator.py` de la suite concu pour tenir la connexion HTTP le temps de toute l'etude ; le changer pour retourner un `run_id` sondable casserait l'integration actuelle avec `pipeline_runner.py` de l'Orchestrator, qui attend directement la reponse.
