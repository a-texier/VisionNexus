---
app: training
doc_type: code-map
audience: dev
lang: fr
title: Carte du code
order: 80
tags: [modules, backend, frontend, moteurs, plugins, hyperparamètres]
sources: [Training_App/backend, Training_App/frontend/src]
---

# Carte du code

## Par où commencer la lecture du backend

Commencez par `backend/main.py` (assemblage de l'app, routers, `/health`), puis `backend/services/training_service.py` (le cycle de vie du run : thread, événements, MLflow, mises à jour de la base -- le centre du backend) et `backend/services/trainer_backend.py` (le contrat de moteur que chaque moteur d'entraînement, plugins compris, doit respecter). Tout ce qui est spécifique à YOLOX (`yolox_engine.py`, `yolox_trainer.py`, `yolox_dataset.py`, `yolox_model.py`, `yolox_catalog.py`, `yolox_plots.py`, `detection_metrics.py`) se tient derrière ce contrat et peut se lire indépendamment, sans connaître le reste du backend. Le modèle de base (`models/training_run.py::TrainingRun`) est volontairement minimal : chaque champ qu'il contient est aussi lisible via `routers/training.py`, partez donc des routers pour voir ce qu'un run expose réellement avant de lire le fichier du modèle lui-même. `backend/config.py` est l'unique endroit qui résout le chemin du workspace, le chemin de la base et les ports depuis les variables d'environnement ; lisez-le avant de modifier quoi que ce soit qui dépend de l'arborescence du workspace.

## Par où commencer la lecture du frontend

Commencez par `frontend/src/App.tsx` (la coquille à deux routes), puis `frontend/src/pages/TrainingPage.tsx` (lancer un run, formulaire construit depuis le catalogue du moteur, progression en direct) et `frontend/src/pages/RunsPage.tsx` (tableau d'historique et détail du run : courbes, galerie d'analyse, meilleurs/pires cas). `frontend/src/api/client.ts` centralise chaque appel au backend, y compris les deux qui contournent le proxy Vite (`SSE_BASE`, `artifactUrl`) ; `frontend/src/types/api.ts` contient chaque type TypeScript partagé entre les deux pages. Aucune des deux pages ne code en dur des noms d'hyperparamètres ou des tailles de moteur : les deux sont lus depuis `GET /api/capabilities` et `GET /api/training/models`, un changement du catalogue d'un moteur côté backend suffit donc à changer ce que montre le formulaire, sans modification du frontend.

## Où ajouter un nouveau moteur

Un nouveau moteur d'entraînement est un plugin, pas une modification de Training App elle-même : créez un dossier sous `plugins/` à la racine du monorepo, en suivant le contrat de `docs/plugins/README.md` (racine du dépôt) et le protocole `TrainingEngine` de `backend/services/trainer_backend.py`. Rien dans `Training_App/` n'a besoin d'être modifié ; le moteur est découvert via `_lib/plugin_registry.py` ou un entry point `visionnexus.trainer_backends` (voir [Configuration](configuration.fr.md) et [Architecture](architecture.fr.md)). Utilisez `plugins/visionnexus_ultralytics/` comme exemple concret : `catalog.py` (un dict `CATALOG` sans import lourd, à l'image de `yolox_catalog.py`) et `trainer.py` (l'implémentation de `TrainingEngine`, qui n'importe sa bibliothèque d'entraînement qu'à l'intérieur de `train()` et `load_predictor()`) sont les deux fichiers minimaux d'un nouveau moteur.

## Où modifier le formulaire ou les défauts d'hyperparamètres YOLOX

Modifiez `backend/services/yolox_catalog.py` : `DEFAULT_HYPERPARAMS` pour les valeurs par défaut, `HYPERPARAM_GROUPS` pour les champs affichés sur la page **Training** (libellé, type, min/max/pas), `HPO_RANGES` pour l'espace de recherche utilisé par Optuna App, `ARTIFACTS` pour les graphiques que la galerie recherche. Le frontend lit ce catalogue via `GET /api/training/models` ; aucun nom d'hyperparamètre n'est codé en dur dans `frontend/src/pages/TrainingPage.tsx`. Ajoutez le libellé anglais correspondant dans `EXACT_EN` de `frontend/src/i18n/translate.ts` pour chaque nouveau libellé français, et n'ajoutez la clé à `CATALOG["keys"]` que quand elle correspond à un champ générique Orchestrator/Optuna (`epochs`, `batch`, `imgsz`, `workers`) ; les autres clés restent spécifiques au moteur et sont lues telles quelles depuis `hyperparams`.

## Où modifier la boucle d'entraînement ou l'évaluation YOLOX

`backend/services/yolox_trainer.py` (`VisionNexusYoloxTrainer`) surcharge les points d'ancrage du `yolox.core.trainer.Trainer` embarqué : `before_train`/`before_iter`/`after_iter`/`after_epoch`/`evaluate_and_save_model`. Les métriques d'évaluation elles-mêmes (mAP, précision, rappel, matrice de confusion) vivent dans `backend/services/detection_metrics.py` ; les graphiques viennent de `yolox_plots.py` (aperçu du dataset, batches augmentés, grilles de validation) et de `detection_metrics.save_plots` (matrice de confusion, courbes PR/P/R/F1). Ne modifiez pas directement `backend/vendor/yolox/` (voir son `VENDOR_NOTES.md`) ; toute adaptation passe par les modules qui l'entourent, pour que le code embarqué puisse être resynchronisé avec l'amont sans perdre les changements locaux. Les tests de cette zone vivent dans `backend/tests/test_yolox_trainer.py`, `test_yolox_plots.py` et `test_yolox_dataset.py`.

## Où modifier la lecture du dataset (data.yaml, YOLO .txt, .ver)

`backend/services/yolox_dataset.py` : `load_data_yaml` analyse `data.yaml` et choisit le format de labels ; `load_yolo_txt_labels` et `load_ver_file` analysent chaque format ; `YoloTxtDataset` est le dataset torch/YOLOX utilisé par l'entraîneur, exposant le contrat `pull_item`/`__getitem__`/`load_anno` attendu par le wrapper `MosaicDetection` embarqué. `VER_CLASS_MAP` contient la table nom-de-classe vers numéro utilisée uniquement pour les fichiers `.ver` ; gardez-la synchronisée avec la table équivalente du chargeur d'annotations d'Inference App si vous la modifiez, un fichier `.ver` utilisé à la fois pour l'évaluation et l'entraînement doit convertir les classes de la même façon dans les deux apps. `backend/tests/test_yolox_dataset.py` couvre les deux formats de labels.

## Où modifier le chargement des checkpoints ou la construction du modèle

`backend/services/yolox_model.py` : `build_exp` (architecture et taille d'image par taille de modèle), `build_model`, `load_checkpoint` (tolérant aux incompatibilités de forme, via `yolox.utils.checkpoint.load_ckpt` embarqué). Ce module est importé directement par `inference_core/detectors.py::YoloxDetector` d'Inference App (à travers le dépôt, pas via une frontière de paquet), un changement de signature ici doit donc aussi s'y refléter ; les deux apps ne partagent pas de code autrement. `backend/tests/test_yolox_model.py` couvre la correspondance taille vers architecture.

## Où modifier la journalisation MLflow

`backend/services/mlflow_logging.py` : `resolve_tracking_uri` (emplacement du store), `start_run`/`_Run` (le handle de journalisation défensif utilisé par `training_service.py`). Toute modification doit préserver la propriété "ne lève jamais" décrite dans [Architecture](architecture.fr.md) : chaque méthode publique de `_Run` doit continuer d'attraper ses propres exceptions, un run d'entraînement ne doit jamais échouer parce que la journalisation a échoué. Des copies quasi identiques de ce fichier existent dans d'autres apps de la suite (Inference App comprise) et sont synchronisées manuellement, pas importées depuis un emplacement partagé -- mettez-les à jour ensemble en corrigeant un bug ici.

## Où modifier le contrat Orchestrator

`backend/routers/orchestrator.py` : `OrchestratorTrainRequest` (champs acceptés) et `orchestrator_train` (résolution du dataset depuis `dataset_path` ou `data_yaml`, attente bloquante jusqu'à la fin du run, forme de la réponse). Les chemins d'endpoints et la forme de la réponse sont censés rester stables puisque Orchestrator App en dépend ; si un champ doit changer, gardez l'ancien fonctionnel ou coordonnez le changement avec `backend/core/graph_runner.py` d'Orchestrator App, qui construit le corps de requête du nœud Training. `Training_App/tests/test_orchestrator_dataset_contract.py` couvre la résolution de `dataset_path`, y compris les cas d'archive `.zip` et de rejet des exports `.ver` historiques.

## Où modifier l'historique des runs, les courbes ou la galerie d'analyse

Backend : `backend/routers/training.py` (`metrics_history`, `list_artifacts`, `get_artifact`, `inference_cases`) et `backend/services/run_artifacts.py` (`collect_artifacts`, qui apparie les graphiques déclarés d'un catalogue avec ce qui existe sur le disque). Frontend : `frontend/src/pages/RunsPage.tsx` (`RunCurves`, `AnalysisGallery`, `InferenceCasesView`, et la liste `ARTIFACT_SECTIONS` des catégories affichées dans la galerie -- à garder synchronisée avec les catégories réellement déclarées par les moteurs, une catégorie présente dans un catalogue mais absente de `ARTIFACT_SECTIONS` ne s'affichant jamais).

## Où modifier les ports, l'arborescence du workspace ou les variables d'environnement

`backend/config.py` (chemin du workspace, chemin de la base, ports, origines CORS, défaut `TRAINER_BACKEND`) et `Training_App/launcher.py` / `_lib/launcher_engine.py` (allocation des ports, variables d'environnement transmises aux processus backend et frontend, création des sous-dossiers du workspace). Le lanceur commun de la suite (`_lib/launcher_engine.py`) et celui local à l'app (`Training_App/launcher.py`) dupliquent volontairement l'essentiel de leur logique, pour que Training App reste lançable seule hors du monorepo ; gardez les deux synchronisés en modifiant l'allocation des ports ou le nommage du workspace. Voir [Configuration](configuration.fr.md) pour la liste complète des variables et leurs défauts.

## Où modifier les traductions

`frontend/src/i18n/translate.ts` : `EXACT_EN` est le dictionnaire français vers anglais indexé par la chaîne française exacte utilisée dans le JSX (`t('...')`) ; il n'y a pas de clé sémantique. Ajoutez ici chaque nouvelle chaîne française destinée à l'utilisateur lors de son introduction, dans `TrainingPage.tsx` comme dans `RunsPage.tsx` ; une chaîne absente du dictionnaire s'affiche non traduite en mode anglais plutôt que de casser la page, un oubli est donc facile à manquer sans une vérification visuelle des deux langues.

## Outils de débogage : état des runs et événements

- `GET /api/training/{run_name}/status` et `GET /api/training/runs` lisent directement l'état persisté en base ; utilisez-les pour vérifier ce qui a réellement atteint le disque par rapport à ce qu'un client SSE a observé.
- `_active_runs` (dict au niveau du module dans `training_service.py`) n'existe qu'en mémoire du processus backend : il ne peut pas être inspecté de l'extérieur autrement que via le flux SSE ou `GET /api/training/{run_name}/events`, et il est vide après un redémarrage du backend.
- `results.csv` dans le dossier d'un run est la référence pour les métriques et pertes par epoch, indépendamment de ce que le flux SSE a livré en direct ; `metrics_history` le lit directement.
- `train_log.txt` dans le dossier d'un run contient le journal YOLOX complet (y compris les lignes `logger.info` de `VisionNexusYoloxTrainer` et du `Trainer` de base), utile quand un run échoue à l'intérieur du moteur plutôt que dans le code d'orchestration qui l'entoure.
- `backend/tests` se lance avec `python -m pytest backend/tests` ; le marqueur `slow` (`pyproject.toml`) sépare les courts entraînements réels des tests unitaires purs, à lancer avec `-m "not slow"` pour une vérification rapide.

## Carte des modules

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
| `api.ts` |  | `TrainingRun`, `StartTrainingRequest`, `HyperparamValue`, `HyperparamField`, `HyperparamGroup`, `ModelCatalog`, `EngineInfo`, `Capabilities`, `AppMode`, `TrainingEvent` |
<!-- generated:end -->
