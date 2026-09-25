---
app: inference
doc_type: architecture
audience: dev
lang: fr
title: Architecture
order: 60
tags: [composants, contrat détecteur, bytetrack, csrt, évaluation, invariants]
sources: [Inference_App/backend/main.py, Inference_App/backend/config.py, Inference_App/backend/inference_core/runner.py, Inference_App/backend/inference_core/detectors.py, Inference_App/backend/inference_core/bytetrack.py, Inference_App/backend/inference_core/media.py, Inference_App/backend/inference_core/models.py, Inference_App/backend/inference_core/evaluation.py, Inference_App/frontend/src/App.tsx]
---

# Architecture

## Vue d'ensemble des composants d'Inference App

```text
frontend/ (React + Vite, port 5177)
  App.tsx  --  page unique : entrées de la barre latérale + onglets Inférence/Évaluation/Config
       |  HTTP, tout passe par le proxy Vite /api (pas de SSE ni d'images en direct)
       v
backend/ (FastAPI, port 8065)
  main.py                        --  routes, modèles de requête, registre des jobs
  api/settings.py                --  langue de l'interface persistée dans le workspace
  inference_core/
    media.py                     --  lecture image/vidéo, liste des frames, sondage dimensions/fps
    detectors.py                 --  YoloxDetector + contrat de plugin visionnexus.detector_backends
    bytetrack.py                 --  petite association MOT à deux passes de type ByteTrack
    runner.py                    --  le pipeline infer/mot/sot, dessin, écriture de la sortie
    evaluation.py                --  mAP/PR/F1/matrice de confusion sur un dataset YOLO
    models.py                    --  dataclasses Detection, Track, RunOptions
  config/defaults.yaml            --  schéma et défauts de configuration embarqués
```

Inference App est délibérément compacte et tournée vers le public : `inference_core/` n'a aucune dépendance vers le reste du monorepo à l'exception du code d'architecture de `yolox_model.py`, importé directement depuis `Training_App/backend/services/yolox_model.py` à travers le dépôt (pas via un paquet). C'est le seul couplage dur avec Training App ; tout le reste d'`inference_core/` est suffisamment autonome pour être lu (et packagé) indépendamment.

## Démarrage de l'application backend

`backend/main.py` construit l'application FastAPI, ajoute le CORS restreint au seul port de l'interface (`backend/config.py`), et inclut le router `settings`. Il n'y a pas de hook `lifespan` ni de modèle chargé au démarrage : `GET /health` répond `{"status": "ok", "app": "Inference_App", "version": "2.0.0"}` immédiatement, et chaque détecteur est construit à neuf pour chaque requête (voir la section suivante), il n'y a donc rien à préchauffer ni à attendre avant que VisionNexus ouvre l'onglet.

## Le contrat des détecteurs et la résolution des moteurs

`inference_core/detectors.py` définit le protocole `Detector` (un attribut `class_names: list[str]` et une méthode `predict(frame) -> list[Detection]`) et `create_detector(engine, **kwargs)`, qui le résout : `"yolox"` construit directement un `YoloxDetector` ; tout autre nom passe par `_lib/plugin_registry.py` du dépôt (groupe `visionnexus.detector_backends`, volontairement distinct du groupe `visionnexus.trainer_backends` de Training App, un plugin de détecteur et un plugin de moteur d'entraînement étant des contrats différents même quand ils sont fournis par le même paquet de plugin) et enveloppe le résultat dans un `Adapter` léger qui normalise les sorties tuple en objets `Detection`. Il n'y a pas de repli silencieux : un nom de moteur non résolu lève `ValueError`.

`YoloxDetector.__init__` ajoute `Training_App/` et `Training_App/backend/` à `sys.path`, importe `services.yolox_model.build_exp`/`load_checkpoint` depuis là, et déduit le nombre de classes directement de la forme du poids `head.cls_preds` du checkpoint plutôt que de faire confiance à un nombre fourni par l'appelant ; `class_names` issu de `config.yaml` doit alors être vide (des étiquettes génériques `class_<n>` sont utilisées) ou correspondre exactement à ce nombre déduit, ou la construction échoue bruyamment plutôt que d'étiqueter les classes silencieusement de travers.

## Le pipeline d'inférence : infer, mot et sot

`inference_core/runner.py::run_inference(options, runs_dir)` est une fonction unique qui pilote les trois modes au-dessus d'`inference_core/media.py::iter_frames` (un générateur qui lit soit une vidéo via `VideoCapture` d'OpenCV, soit un dossier trié d'images, en produisant uniformément des paires `(index, frame)`) :

- **infer** : `detector.predict(frame)` à chaque frame ; `last_detections` est dessiné tel quel.
- **mot** : même appel au détecteur ; si `tracker == "bytetrack"`, `ByteTracker.update(detections)` (voir la section suivante) produit en plus des objets `Track` avec un `track_id`, dessinés avec un préfixe `#<id>` au lieu des détections brutes.
- **sot** : sur la toute première frame, le détecteur s'exécute une fois et `_select_detection` choisit la détection au score le plus élevé qui contient le point cliqué (`options.click_x`/`click_y`, normalisé de 0 à 1) ; cette boîte amorce un `TrackerCSRT` d'OpenCV (`cv2.TrackerCSRT_create` ou, sur des versions plus anciennes d'OpenCV, `cv2.legacy.TrackerCSRT_create`), qui pilote seul chaque frame suivante via `csrt.update(frame)`, sans aucun autre appel au détecteur.

L'écriture de la sortie (`save_output`) se ramifie selon le nombre de frames : un `cv2.VideoWriter` (`mp4v`, fps de la source) pour une vidéo ou une source multi-images, un simple `cv2.imwrite` pour une image unique, les deux vers un nouveau dossier `runs/<nom du run>/` (`run_name` assaini par `_safe_name`, dédupliqué avec un suffixe aléatoire si le dossier existe déjà). Chaque run écrit `result.json` (le même dict renvoyé à l'appelant) et `request.json` (le `RunOptions` complet, via `dataclasses.asdict`) à côté de la sortie, ce qui est ce qui permet aux conseils de [Dépannage](troubleshooting.fr.md) de faire référence aux paramètres réellement enregistrés d'un run.

## Association ByteTrack

`inference_core/bytetrack.py::ByteTracker.update(detections)` exécute deux passes d'appariement glouton par appel, chacune via `_greedy_match` (une assignation gloutonne triée par IoU, de même classe seulement, pas l'algorithme hongrois que le ByteTrack embarqué de YOLOX utilise parfois, mais suffisant aux fréquences d'images visées par cette app) : d'abord les détections de haute confiance (`score >= high_thresh`) face à toutes les pistes existantes, puis les détections de faible confiance (`low_thresh <= score < high_thresh`) face uniquement aux pistes que la première passe a laissées non appariées. Les pistes non appariées accumulent un compteur `missed` et sont abandonnées une fois qu'il dépasse `buffer_size` ; une nouvelle piste n'est créée qu'à partir d'une détection de haute confiance non appariée dont le score atteint au moins `new_track_thresh`, jamais d'une détection de faible confiance, un nouvel objet ne peut donc pas démarrer une piste via la seule passe de faible confiance. `update()` ne renvoie que les pistes avec `missed == 0`, une piste invisible sur cette frame n'est donc pas dessinée même si elle survit en interne jusqu'à expiration du buffer.

## Pipeline d'évaluation de détection

`inference_core/evaluation.py::evaluate_detection(...)` lit le split `val` d'un `data.yaml` (`_dataset_images`), apparie les prédictions à la vérité terrain YOLO `.txt` par image (`_ground_truth`, en utilisant la même convention de substitution de chemin `images/` vers `labels/` que le chargeur de dataset de Training App, implémentée indépendamment plutôt que partagée), et calcule :

- L'AP par classe à dix seuils d'IoU de 0,50 à 0,95 (`_score_class`, un appariement glouton VP/FP fait maison plus une précision moyenne interpolée à 101 points, `_average_precision`), agrégée en `map50`/`map50_95`.
- Une courbe précision-rappel agrégée et une courbe F1 en fonction de la confiance (en regroupant les prédictions de chaque classe dans un seul classement, en décalant les indices d'image de chaque classe pour que la vérité terrain par image et par classe reste séparable).
- Une matrice de confusion à IoU 0,50 et une confiance fixe de 0,25, avec une ligne background (vérité terrain manquée) et une colonne background (prédictions non appariées), via la même approche d'appariement glouton par IoU que le score au niveau des classes.

C'est une implémentation séparée de `detection_metrics.py` de Training App (ordre d'appariement différent, seuils par défaut différents pour la matrice de confusion), pas un module partagé : attendez-vous à de petites différences numériques entre les mAP des deux apps sur le même modèle et le même dataset, et gardez cela en tête avant de considérer l'une plus "correcte" que l'autre. Toutes les sorties (`metrics.json`, `pr_curve.png`, `f1_curve.png`, `confusion_matrix.png`) sont écrites avec `matplotlib.use("Agg")` pour un rendu sans interface, vers un nouveau dossier `runs/eval_<id>/` qui ne doit pas déjà exister (`mkdir(parents=True, exist_ok=False)`).

## Le contrat Orchestrator

`main.py::orchestrator_infer` et `orchestrator_evaluate` sont de fins adaptateurs respectivement au-dessus de `run_inference` et `evaluate_detection`, construits pour `Orchestrator_App/backend/core/graph_runner.py` : ils acceptent un dict `overrides` de valeurs faiblement typées (correspondant aux clés de `config/defaults.yaml`, avec quelques alias historiques comme `conf_thresh`/`iou_thresh`), les convertissent en `RunOptions` typé ou en arguments nommés explicites, et s'exécutent de façon synchrone, en renvoyant le résultat une fois l'étape du pipeline terminée (pas de tâche en arrière-plan, pas de polling nécessaire de la part de l'Orchestrator pour ces deux endpoints, contrairement au run bloquant mais interrogeable séparément de Training App). `orchestrator_infer` force toujours `mode="mot"` (il n'y a pas de SOT piloté par l'Orchestrator, le SOT nécessitant un clic interactif) et dérive `tracker` de `tracker_mot`.

## Structure du frontend

`App.tsx` est tout le frontend : un seul composant qui détient tout l'état (source, poids, moteur, mode, tracker, seuils, la configuration chargée, le job actif ou le résultat d'évaluation) et qui affiche la barre latérale plus celui des trois onglets qui est actif. Il n'y a pas de routage côté client ni de module client API séparé (contrairement au `api/client.ts` de Training App) ; le petit assistant `api<T>(url, options)` enveloppe `fetch` et lève une exception sur une réponse non OK, en lisant le champ `detail` de FastAPI. `POST /api/runs` répond immédiatement avec un `job_id` ; le frontend interroge ensuite `GET /api/runs/{job_id}` toutes les 700 ms jusqu'à ce que le statut quitte `"running"`, le seul flux asynchrone de l'application (l'évaluation, à l'inverse, est un unique appel bloquant `POST /api/orchestrator/evaluate` attendu directement, réutilisant l'endpoint Orchestrator plutôt qu'un endpoint dédié, l'interface n'ayant pas besoin d'un contrat séparé).

## Invariants à ne pas casser

- **Le code YOLOX embarqué est la source unique d'architecture** : `YoloxDetector` doit continuer d'importer `Training_App/backend/services/yolox_model.py` plutôt que d'acquérir sa propre copie de l'architecture ; la compatibilité d'un checkpoint entre Training App et Inference App en dépend.
- **Le nombre de classes vient du checkpoint, pas de la configuration** : `class_names` ne doit jamais écraser le nombre de classes déduit de `head.cls_preds` ; une incohérence doit faire échouer la construction plutôt que d'étiqueter ou tronquer silencieusement les détections.
- **Pas de repli de plugin de détecteur** : `create_detector` doit lever une exception sur un moteur non résolu, jamais substituer `yolox` ; un appelant qui compte sur la compatibilité des poids échouerait sinon de façon confuse au moment de la prédiction plutôt qu'à la construction du détecteur.
- **`/api/output` ne sert jamais hors de `runs/`** : la vérification de confinement de chemin dans `main.py::output` est la seule chose empêchant une divulgation arbitraire de fichiers via cet endpoint ; toute modification de la résolution du dossier de run doit la préserver.
- **Un dossier de run n'est jamais écrasé silencieusement** : `run_inference` et `evaluate_detection` échouent tous deux bruyamment (`mkdir(..., exist_ok=False)`, un suffixe de déduplication) plutôt que de fusionner ou d'écraser les fichiers d'un run existant.
- **L'évaluation ne lit que le split `val`** : c'est délibéré et le contrat Orchestrator en dépend ; ne pas se rabattre sur `test` ou `train` même quand `val` est absent.
