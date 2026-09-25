---
app: training
doc_type: architecture
audience: dev
lang: fr
title: Architecture
order: 60
tags: [composants, contrat moteur, cycle de vie run, sse, mlflow, plugins, invariants]
sources: [Training_App/backend/main.py, Training_App/backend/database.py, Training_App/backend/models/training_run.py, Training_App/backend/services/training_service.py, Training_App/backend/services/trainer_backend.py, Training_App/backend/services/yolox_engine.py, Training_App/backend/services/yolox_trainer.py, Training_App/backend/services/run_artifacts.py, Training_App/backend/services/mlflow_logging.py, Training_App/backend/routers/training.py, Training_App/backend/routers/orchestrator.py, Training_App/frontend/src/App.tsx]
---

# Architecture

## Vue d'ensemble des composants de Training App

```text
frontend/ (React + Vite, port 5176)
  TrainingPage.tsx  --  formulaire de config + Lancer/Stop + Progression live (SSE)
  RunsPage.tsx      --  tableau Historique + détail du run (courbes, galerie, best/worst)
       |  HTTP (proxifié /api) + SSE et images en direct vers le port du backend
       v
backend/ (FastAPI, port 8064)
  routers/training.py       --  CRUD des runs, flux SSE, artefacts, catalogue des modèles
  routers/orchestrator.py   --  POST /train, GET /run-status (contrat Orchestrator)
  routers/capabilities.py   --  GET /api/capabilities (moteurs + catalogues)
  api/settings.py           --  langue de l'interface persistée dans le workspace
  services/training_service.py  --  cycle de vie du run : thread, événements, MLflow, MAJ base
  services/trainer_backend.py   --  contrat des moteurs, résolution, validation du catalogue
  services/yolox_engine.py + yolox_trainer.py + yolox_dataset.py + yolox_model.py
                              --  le moteur "yolox" (seul moteur du coeur)
  services/mlflow_logging.py    --  journalisation MLflow défensive vers un store sqlite par utilisateur
  database.py + models/training_run.py  --  SQLite (SQLModel), une ligne TrainingRun par run
```

Training App est propriétaire de l'architecture des modèles et du moteur d'entraînement : le coeur ne fournit que le moteur `yolox` ; les autres moteurs sont découverts comme des plugins (`plugins/` à la racine du monorepo) à travers le contrat de `trainer_backend.py`. Inference App réutilise le code YOLOX embarqué (`backend/vendor/yolox/`) pour charger les checkpoints YOLOX, mais aucune dépendance n'existe dans l'autre sens : Training App n'importe jamais Inference App. La base de données (SQLite, un fichier par workspace utilisateur) et le registre d'événements en mémoire sont le seul état du backend ; rien n'est mis en cache entre les requêtes au-delà de ce que ces deux-là contiennent.

## Démarrage de l'application backend

`backend/main.py` construit l'application FastAPI, ajoute le CORS pour les origines de l'interface (`backend/config.py`), et inclut les quatre routers (`training`, `orchestrator`, `capabilities`, `settings`). Son `lifespan` appelle `create_db_and_tables()` avant de servir des requêtes. `GET /health` répond `{"status": "ok", "app": "Training_App"}` sans condition : contrairement à Annotation App, Training App ne charge aucun modèle lourd au démarrage (les moteurs sont résolus paresseusement, seulement quand un run en a réellement besoin), la disponibilité est donc immédiate et VisionNexus n'a jamais à attendre avant d'ouvrir l'onglet. `create_db_and_tables()` applique aussi le petit ensemble de migrations additives de colonnes de `_ADDED_COLUMNS` (`database.py`), une base de workspace plus ancienne gagne donc de nouvelles colonnes (actuellement la colonne `engine`, par défaut `yolox` pour les lignes créées avant le passage multi-moteurs) sans étape de migration séparée.

## Le contrat du moteur d'entraînement

`trainer_backend.py` définit le contrat que chaque moteur respecte, sous forme d'un `Protocol` (`TrainingEngine`) : une classe avec un dict `CATALOG` et un constructeur prenant `model_size`, `data_yaml`, `run_name`, `output_dir`, `hyperparams`, `model_weights`, `stop_flag` et `on_epoch_end`, plus une méthode bloquante `train()` renvoyant `{"run_dir", "best_model_path", "last_model_path"}` et optionnellement `"metrics"`. `train()` appelle `on_epoch_end(payload)` à la fin de chaque epoch avec `{"epoch", "total_epochs", "progress_pct", "loss", "metrics"}`, en utilisant les noms de métriques `metrics/mAP50(B)`, `metrics/mAP50-95(B)`, `metrics/precision(B)`, `metrics/recall(B)` quel que soit le moteur, si bien que `training_service.py` et le frontend ne traitent jamais un moteur comme cas particulier.

`resolve_engine(name)` renvoie la classe du moteur : `yolox` charge directement `yolox_engine.YoloxEngine` ; tout autre nom passe par `_plugin_registry()` (le fichier `_lib/plugin_registry.py` du dépôt, trouvé en remontant depuis ce fichier jusqu'à la racine du monorepo) ou un entry point Python du groupe `visionnexus.trainer_backends`. Il n'y a jamais de repli silencieux vers un autre moteur : un nom non résolu lève `RuntimeError` avec la raison.

`engine_catalog(name)` résout le moteur et vérifie que son `CATALOG` contient chaque clé de `CATALOG_KEYS` (`label`, `weights_suffixes`, `sizes`, `default_size`, `defaults`, `groups`, `keys`, `hpo_ranges`, `hpo_default_optimize`, `artifacts`, `train_batches_glob`) ; un plugin dont le catalogue est incomplet est signalé indisponible plutôt que de faire planter toute la liste des moteurs. `describe_backends()` construit la liste servie par `GET /api/capabilities`, en important le module de chaque moteur disponible (jamais sa lourde bibliothèque d'entraînement) pour lire son catalogue.

`merge_hyperparams(catalog, overrides, epochs=, batch=, imgsz=)` superpose les défauts du moteur, puis les overrides filtrés aux clés connues (`filter_hyperparams` sépare les clés retenues des ignorées), puis les champs génériques `epochs`/`batch`/`imgsz` traduits via `catalog["keys"]`. `check_weights_for_engine(engine, weights)` refuse un chemin de poids dont l'extension n'est pas dans `catalog["weights_suffixes"]`. `build_run_config()` dans `training_service.py` combine tout cela pour valider une requête de bout en bout avant la création de toute ligne `TrainingRun`.

## Cycle de vie d'un run et le registre d'événements en mémoire

Une ligne `TrainingRun` (SQLModel, table `training_run`) est créée par `routers/training.py::start_training` (interface/API) ou `routers/orchestrator.py::orchestrator_train` (Orchestrator), après que `build_run_config()` a validé la requête. `services.training_service.start_training(run_name, trace=None)` ensuite :

1. Relit les champs persistés du run depuis la base (moteur, taille, poids, hyperparamètres, data_yaml).
2. Enregistre une entrée dans le dict `_active_runs` au niveau du module (`{run_name: {"events": [], "stop_flag": Event, "thread": Thread}}`, protégé par un `threading.Lock`), seul endroit où vivent les événements de progression du run.
3. Démarre un `Thread` démon exécutant `_train()` : résout la classe et le catalogue du moteur, ouvre un run MLflow (`mlflow_logging.start_run`), construit l'instance du moteur avec `on_epoch_end` branché pour ajouter des événements à `_active_runs[run_name]["events"]` et mettre à jour la ligne `TrainingRun` (`current_epoch`, `progress_pct`, `best_map50`, `best_map5095`, écrasés seulement quand les métriques de l'epoch contiennent effectivement une valeur, une epoch sans évaluation n'en remontant aucune), appelle `engine.train()`, puis enregistre le statut final.

`_active_runs` est un état purement en mémoire : il ne survit pas à un redémarrage du backend (voir l'invariant ci-dessous). `get_events(run_name, cursor)` renvoie les événements à partir d'un curseur ; `stop_training(run_name)` arme le `stop_flag` du run, que le moteur est censé vérifier entre les itérations et sur lequel il doit lever une exception (ou sortir autrement). `training_service.py` traite toute exception levée pendant que `stop_flag` est armé comme un arrêt propre plutôt qu'une erreur, un moteur n'a donc pas besoin d'importer un type d'exception spécifique à Training App, même si `TrainingStopped` de YOLOX hérite bien du `TrainerStopped` partagé de `trainer_backend.py`, par clarté.

## Diffusion de la progression : flux SSE

`GET /api/training/{run_name}/events` (`routers/training.py::stream_events`) est une `StreamingResponse` qui interroge `get_events` toutes les 0,5 s et émet chaque nouvel événement comme une ligne SSE `data:`, en s'arrêtant après un événement `done`, `error` ou `stopped`. Le frontend (`api/client.ts::streamTrainingEvents`) se connecte directement au port du backend (pas via le proxy Vite, pour éviter la mise en tampon) avec `fetch` et un lecteur de lignes manuel, se reconnectant après 2 s en cas d'échec réseau. Types d'événements : `status` (moteur démarré), `epoch` (payload par epoch), `done` (`engine`, `best_model_path`, `map50`, `map5095`), `error` (`message`), `stopped`.

Comme les événements ne vivent que dans `_active_runs`, un rechargement de page après la fermeture de la connexion SSE ne peut pas les rejouer ; la page **Historique** interroge à la place `GET /api/training/runs` et le détail du run interroge `GET /api/training/{run_name}/metrics-history`, qui lisent tous deux un état persisté (la base et `results.csv`), ce qui en fait le moyen fiable de suivre un run à travers les rechargements.

## Le moteur YOLOX : dataset, entraîneur et évaluation

`yolox_engine.YoloxEngine` adapte le `yolox.core.trainer.Trainer` embarqué au contrat `TrainingEngine`. `train()` construit un `Exp` (`yolox_model.build_exp`, qui choisit le fichier exp de la taille sélectionnée dans `backend/vendor/yolox/exps/default/`), applique chaque hyperparamètre correspondant à un attribut d'`Exp`, puis exécute `VisionNexusYoloxTrainer` (`yolox_trainer.py`), une sous-classe du `Trainer` de base qui remplace les parties codées en dur pour CUDA/COCO/Ultralytics :

- `__init__`/`before_train` : `device` configurable au lieu d'un `cuda:{rank}` codé en dur ; dataset construit à partir de `YoloTxtDataset` (`yolox_dataset.py`) au lieu de `COCODataset`.
- `before_iter` : lève `TrainingStopped` quand `stop_flag` est armé, vérifié avant chaque itération d'entraînement.
- `after_iter` : même journalisation périodique que la classe de base, sans l'appel `exp.random_resize()` de la base (réservé au CUDA).
- `after_epoch` : enregistre `latest_ckpt.pth`, évalue toutes les `eval_interval` epochs, ajoute une ligne à `results.csv`, et appelle `on_epoch_end` avec le payload SSE/MLflow.
- `evaluate_and_save_model` : exécute `detection_metrics.compute_metrics` (implémentation mAP maison de cette app, sans `pycocotools`) au lieu de `COCOEvaluator`, écrit les graphiques d'analyse (`detection_metrics.save_plots` et `yolox_plots.py`), et met à jour `best_ckpt.pth` quand le mAP50-95 s'améliore.

`yolox_dataset.YoloTxtDataset` lit un `data.yaml` et soit des labels YOLO `.txt`, soit un fichier `.ver` historique (format détaillé dans [Concepts](concepts.fr.md)), en exposant le contrat `pull_item`/`__getitem__`/`load_anno` attendu par le wrapper `MosaicDetection` embarqué. `yolox_model.py` (partagé avec Inference App) construit l'`Exp`/modèle pour une taille donnée et charge les checkpoints `.pth`, en tolérant les incompatibilités de forme par couche (`load_ckpt`, de `utils/checkpoint.py` embarqué) afin qu'un fine-tuning à travers un changement de nombre de classes ne réinitialise que la couche de classification.

## Graphiques d'analyse et le catalogue d'artefacts

Chaque moteur déclare ses graphiques dans `CATALOG["artifacts"]`, une correspondance `{catégorie: [chemins relatifs, du plus au moins préféré]}`, plus `"train_batches_glob"`. `run_artifacts.collect_artifacts(run_dir, catalog)` filtre chaque chemin déclaré à ceux présents sur le disque et parcourt les batches d'entraînement (plafonné à 3), produisant la structure servie par `GET /api/training/{run_name}/artifacts` et consommée par la galerie de l'**Historique**, la vue Insights de l'Orchestrator, et `artifact_files()` qui liste les mêmes fichiers pour l'attachement MLflow (dédupliqué, plusieurs catégories pouvant pointer vers le même fichier). `GET /api/training/{run_name}/artifact/{path}` sert une image, en se protégeant du path traversal en résolvant le chemin et en vérifiant qu'il reste sous le dossier du run, et ne sert que `.png`/`.jpg`/`.jpeg`. Si le moteur du run n'est plus résolvable, `collect_artifacts` est sauté et la réponse porte `engine_error` à la place (voir [Dépannage](troubleshooting.fr.md)).

## Journalisation MLflow

`mlflow_logging.py` (des copies quasi identiques existent dans Inference App et d'autres apps de la suite, synchronisées manuellement) ouvre un run contre un store SQLite par utilisateur, jamais un serveur réseau : `resolve_tracking_uri()` renvoie `IA_MLFLOW_TRACKING_URI` quand elle est définie (l'Orchestrator l'injecte pour la traçabilité de pipeline), sinon `<workspace>/../mlflow_<user>/mlflow_data/mlflow.db`, en créant l'emplacement d'artefacts de l'experiment sous `<store>/artifacts/<experiment>/` au premier usage pour que des runs lancés depuis des dossiers de travail différents atterrissent quand même au même endroit. Chaque méthode publique du handle `_Run` renvoyé (`log_metrics`, `log_params`, `log_artifact`, `set_tags`, `register_model`, `finish`) avale ses propres exceptions : un paquet `mlflow` absent ou un échec d'écriture n'interrompt jamais l'entraînement, c'est pourquoi `training_service.py` appelle ces méthodes sans condition plutôt que de vérifier la disponibilité d'abord. `log_metrics` assainit de plus les noms de métriques (MLflow refuse les caractères hors `[alnum _ - . / space :]`, et `metrics/mAP50(B)` contient des parenthèses) pour qu'un nom invalide ne fasse pas perdre tout le lot.

L'enregistrement de modèle (`register_model`) utilise `<experiment>/<model_size>` comme nom enregistré, délibérément stable entre les runs d'une même taille et d'un même experiment, pour que des entraînements successifs deviennent des versions v1..vN d'un seul modèle plutôt que des modèles distincts ; les tags de chaque version portent le nom du dataset, les valeurs de mAP, le moteur et les champs de traçabilité Orchestrator.

## Le contrat Orchestrator

`routers/orchestrator.py::orchestrator_train` résout `data.yaml` depuis un `dataset_path` explicite (un dossier fouillé pour `data.yaml`, ou un `.zip` extrait une fois dans `runs/<nom de l'archive>/` et mis en cache là) avant de valider et démarrer le run exactement comme le chemin interface, puis **bloque** la requête HTTP jusqu'à ce que le run atteigne un statut terminal (`TRAINING_ORCH_BLOCKING=1` par défaut, en interrogeant la base toutes les 2 s jusqu'à `TRAINING_ORCH_MAX_WAIT_S`). Ce comportement bloquant est délibéré : une version antérieure répondait dès le démarrage du run, ce qui laissait des étapes de pipeline en aval (par exemple un commit DVC) s'exécuter contre un modèle pas encore entraîné (voir le commentaire du code référençant le bug B12). `optuna_best` de la requête tolère la convention de placeholder non résolu de l'Orchestrator : une chaîne (`${STEP:...}` non résolu) est convertie en `{}` plutôt que de provoquer une erreur de validation.

## Structure du frontend

`App.tsx` est une coquille à deux routes (`/training`, `/runs`) partageant une barre de navigation et le `LanguageToggle`. `TrainingPage.tsx` récupère `GET /api/capabilities` et, une fois un moteur choisi, `GET /api/training/models?engine=` pour construire entièrement le formulaire d'hyperparamètres à partir du catalogue (types de champs, plages, libellés) : aucun nom ni plage d'hyperparamètre n'est codé en dur dans le frontend. `RunsPage.tsx` interroge `GET /api/training/runs` pour le tableau et, dans le tiroir de détail, `GET /api/training/{run}/metrics-history` (données des courbes, re-récupérées toutes les 10 s) et `GET /api/training/{run}/artifacts` (galerie, uniquement pour les runs `done`). `api/client.ts` centralise tous les appels au backend et expose `SSE_BASE`/`artifactUrl`, les deux endroits qui contournent le proxy Vite pour parler directement au port du backend.

## Invariants à ne pas casser

- **Propriété des poids par le moteur** : le champ `engine` d'un run, une fois enregistré, est le seul autorisé à interpréter son `best_model_path`. Ne jamais charger des poids YOLOX via le `load_predictor` d'un autre moteur, ni l'inverse.
- **Pas de repli silencieux de moteur** : `resolve_engine` doit lever une exception, jamais substituer un autre moteur, quand celui demandé est indisponible ; un appelant qui compte sur la compatibilité des poids échouerait sinon de façon confuse plus tard.
- **Le catalogue est la seule source de vérité du formulaire** : noms d'hyperparamètres, plages, défauts et catégories de graphiques ne vivent que dans le `CATALOG` de chaque moteur ; ni le frontend ni l'Orchestrator ne codent en dur un champ spécifique à YOLOX ou à un plugin.
- **Les événements sont éphémères, la base ne l'est pas** : ne jamais compter sur la survie de `_active_runs` à un redémarrage ; le statut persisté du run, `results.csv` et le dossier du run sont l'enregistrement durable.
- **Un seul écrivain par workspace** : ne jamais lancer deux instances du backend (`--workers` > 1 compris) contre le même `training.db` ; le workspace de chaque utilisateur est censé être exclusif.
- **La journalisation MLflow ne lève jamais** : toute modification de `mlflow_logging.py` doit préserver la propriété que chaque méthode publique de `_Run` attrape ses propres exceptions ; un run d'entraînement ne doit jamais échouer à cause d'un problème de journalisation.
