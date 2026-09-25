---
app: inference
doc_type: code-map
audience: dev
lang: fr
title: Carte du code
order: 80
tags: [modules, backend, frontend, plugin détecteur, bytetrack, évaluation]
sources: [Inference_App/backend, Inference_App/frontend/src]
---

# Carte du code

## Par où commencer la lecture du backend

Commencez par `backend/main.py` : il est assez court pour se lire de bout en bout et c'est là que vivent chaque corps de requête, chaque forme de réponse et les deux adaptateurs Orchestrator. De là, `backend/inference_core/runner.py::run_inference` est le cœur de l'onglet **Inférence** (les trois modes), et `backend/inference_core/evaluation.py::evaluate_detection` est le cœur de l'onglet **Évaluation** ; les deux sont appelés directement par `main.py`, sans couche de service intermédiaire. `backend/config.py` résout le chemin du workspace, les ports et l'origine CORS depuis les variables d'environnement ; lisez-le avant de modifier quoi que ce soit qui dépend de l'arborescence du workspace.

## Par où commencer la lecture du frontend

Commencez par `frontend/src/App.tsx` : contrairement à Training App, il n'y a que ce seul fichier (plus `LanguageToggle.tsx` et les assistants i18n) qui contient toute l'interface, état compris. Lisez d'abord l'assistant `api<T>()`, puis les fonctions `run`/`evaluate`/`saveConfig`, puis le JSX en bas, organisé par onglet (`tab === 'run'`, `'evaluate'`, `'config'`).

## Où ajouter un nouveau moteur de détection

Un nouveau moteur de détection est un plugin, pas une modification d'Inference App elle-même : ajoutez une entrée au groupe `visionnexus.detector_backends` (distinct du `visionnexus.trainer_backends` de Training App) dans le manifeste `__init__.py` d'un plugin, et implémentez une classe avec un attribut `class_names` et une méthode `predict(frame)` renvoyant une liste de tuples `(x1, y1, x2, y2, score, class_id, label)` ou d'objets `Detection` (`backend/inference_core/models.py`). Rien dans `Inference_App/` n'a besoin d'être modifié ; le moteur est découvert via `_lib/plugin_registry.py` (voir [Configuration](configuration.fr.md) et [Architecture](architecture.fr.md)). `plugins/visionnexus_ultralytics/detector.py` est un exemple concret du contrat, aux côtés du contrat de moteur d'entraînement dans le même plugin.

## Où modifier la lecture d'une source (images, vidéo, extraction de frames)

`backend/inference_core/media.py` : `media_files` (liste les fichiers vers lesquels une source résout), `inspect_media` (dimensions, nombre de frames, fps), `iter_frames` (le générateur que consomme chaque pipeline), `read_frame` (une frame unique par index, utilisée par l'endpoint d'aperçu). `IMAGE_EXTENSIONS` et `VIDEO_EXTENSIONS` sont l'ensemble fixe et codé en dur des extensions prises en charge ; ajoutez-y si un nouveau conteneur ou format d'image doit être pris en charge, et mettez à jour [Configuration](configuration.fr.md) et [Dépannage](troubleshooting.fr.md) en conséquence.

## Où modifier le détecteur YOLOX ou ajouter une gestion des noms de classe

`backend/inference_core/detectors.py::YoloxDetector` : la construction (importe `Training_App/backend/services/yolox_model.py` à travers le dépôt, déduit le nombre de classes du checkpoint) et `predict()` (prétraitement, passe avant, post-traitement, retour aux coordonnées de l'image d'origine). Ne dupliquez pas le code d'architecture YOLOX ici ; toute modification de la façon dont un checkpoint est construit ou chargé appartient à `yolox_model.py` de Training App, partagé par les deux apps (voir [Architecture](architecture.fr.md)).

## Où modifier l'appariement ou les seuils de ByteTrack

`backend/inference_core/bytetrack.py` : `box_iou` (aussi réutilisé par `evaluation.py`), `_greedy_match` (la primitive d'appariement à deux passes), `ByteTracker.update` (la logique d'association par frame et le cycle de vie des pistes). `Inference_App/tests/test_bytetrack.py` couvre la persistance d'identité à travers une frame de faible confiance et la règle de non-création de piste depuis une faible confiance ; étendez-le en même temps que toute modification de l'appariement.

## Où modifier le pipeline d'inférence ou l'écriture de la sortie

`backend/inference_core/runner.py::run_inference` : le branchement par mode (`infer`/`mot`/`sot`), `_draw` (rendu des annotations, partagé par tous les modes), `_select_detection` (résolution du clic SOT), la branche de sortie `cv2.VideoWriter`/`cv2.imwrite`, et la tenue de `result.json`/`request.json`. `main.py::start_run`/`_run_job` enveloppent cela dans un thread en arrière-plan et le registre de polling `_jobs` ; gardez les deux synchronisés si vous modifiez ce que renvoie `run_inference`, `main.py` stockant ce dict tel quel pour `GET /api/runs/{job_id}`.

## Où modifier les métriques ou graphiques d'évaluation

`backend/inference_core/evaluation.py` : `_dataset_images`/`_ground_truth` (lecture du dataset), `_score_class`/`_average_precision` (le calcul de l'AP), `_save_plots` (les trois sorties PNG), `evaluate_detection` (orchestre tout cela et écrit `metrics.json`). C'est une implémentation séparée de `detection_metrics.py` de Training App ; ne supposez pas que les deux produisent des nombres identiques sur la même entrée (voir [Architecture](architecture.fr.md)). `Inference_App/tests/test_evaluation.py` couvre le calcul des métriques sur de petits datasets synthétiques.

## Où modifier le contrat Orchestrator

`backend/main.py::orchestrator_infer` et `orchestrator_evaluate` : les modèles de requête acceptés (`OrchestratorInferRequest`, `EvaluateRequest`, `TraceFields`) et la traduction des `overrides` en `RunOptions` ou en arguments d'évaluation explicites. Les chemins d'endpoints et les formes de réponse sont censés rester stables puisque Orchestrator App en dépend ; si un champ doit changer, gardez l'ancien fonctionnel ou coordonnez-vous avec `backend/core/graph_runner.py` d'Orchestrator App, qui construit le corps de requête du nœud Inference.

## Où modifier les ports, l'arborescence du workspace ou les variables d'environnement

`backend/config.py` (chemin du workspace, ports, origine CORS) et `_lib/launcher_engine.py` (l'entrée `"inference"` d'`APP_REGISTRY` : allocation des ports, variables d'environnement, création des sous-dossiers du workspace). Inference App n'a pas de script de lancement local à l'app, contrairement à Training App ; elle ne se démarre que via le lanceur de la suite ou VisionNexus. Voir [Configuration](configuration.fr.md) pour la liste complète des variables.

## Où modifier le schéma de config.yaml ou son formulaire Orchestrator

`config/defaults.yaml` à la racine de l'app est à la fois les défauts embarqués sur lesquels l'application se replie et le schéma que lit `Orchestrator_App/backend/api/graphs.py::_INFERENCE_GROUPS` pour construire son formulaire de nœud ; ajoutez d'abord une nouvelle clé là, puis groupez-la dans `_INFERENCE_GROUPS` côté Orchestrator si elle doit apparaître dans une section précise plutôt que dans le groupe fourre-tout "Autres champs". Voir [Configuration](configuration.fr.md) pour le schéma actuel.

## Où modifier les traductions

`frontend/src/i18n/translate.ts` : `EXACT_EN` est le dictionnaire français vers anglais indexé par la chaîne française exacte utilisée dans le JSX (`t('...')`) ; il n'y a pas de clé sémantique. Ajoutez ici chaque nouvelle chaîne française destinée à l'utilisateur lors de son introduction dans `App.tsx` ; une chaîne absente du dictionnaire s'affiche non traduite en mode anglais plutôt que de casser la page.

## Outils de débogage : état des runs et des évaluations

- `GET /api/runs/{job_id}` est le seul moyen d'inspecter l'état d'un run de l'extérieur ; le dict `_jobs` de `main.py` n'existe qu'en mémoire et est vide après un redémarrage du backend, un job démarré avant un redémarrage ne peut donc pas être récupéré.
- `runs/<nom du run>/request.json` enregistre le `RunOptions` exact avec lequel un run a été démarré, utile quand un résultat semble erroné et que vous devez confirmer ce qui a réellement été demandé par rapport à ce que montre actuellement la barre latérale.
- `runs/<nom du run>/result.json` et `runs/eval_<id>/metrics.json` sont les mêmes payloads que ceux renvoyés par l'API, lisibles directement sur le disque si la session de l'interface a disparu.
- `Inference_App/tests` se lance avec `pytest tests -q` depuis `Inference_App/` ; il n'y a pas de marqueur `slow` ici, tous les tests sont des tests unitaires rapides sur des données synthétiques.

## Carte des modules

<!-- generated:start -->
### backend

| File | Description | Exports |
|---|---|---|
| `__init__.py` | Backend package for the public VisionNexus Inference App. |  |
| `config.py` |  |  |
| `main.py` |  | `InspectRequest`, `ConfigRequest`, `get_config`, `put_config`, `RunRequest`, `health`, `app_mode`, `capabilities`, `media_inspect`, `media_preview`, `output`, `start_run` (+7) |

### backend/api

| File | Description | Exports |
|---|---|---|
| `settings.py` |  | `AppSettings`, `load_settings`, `get_settings`, `update_settings` |

### backend/inference_core

| File | Description | Exports |
|---|---|---|
| `__init__.py` | Small, public inference runtime: media, detectors and tracking only. |  |
| `bytetrack.py` |  | `box_iou`, `ByteTracker` |
| `detectors.py` |  | `Detector`, `YoloxDetector`, `detector_capabilities`, `create_detector` |
| `evaluation.py` |  | `evaluate_detection` |
| `media.py` |  | `MediaInfo`, `media_files`, `inspect_media`, `iter_frames`, `read_frame` |
| `models.py` |  | `Detection`, `Track`, `RunOptions` |
| `runner.py` |  | `run_inference` |

### frontend/src

| File | Description | Exports |
|---|---|---|
| `App.tsx` |  | `api`, `App` |
| `main.tsx` |  |  |

### frontend/src/components

| File | Description | Exports |
|---|---|---|
| `LanguageToggle.tsx` |  | `LanguageToggle` |

### frontend/src/i18n

| File | Description | Exports |
|---|---|---|
| `translate.ts` | Traduction FR -> EN a l'affichage. Le francais reste la source de | `isDesktopPiloted`, `getLang`, `setLang`, `subscribeLang`, `initWorkspaceLanguage`, `setLangAndMaybePersist`, `t` |
| `useLang.ts` |  | `useLang`, `useT` |
<!-- generated:end -->
