---
app: inference
doc_type: api-reference
audience: dev
lang: fr
title: Référence API
order: 70
tags: [api rest, endpoints, fastapi, orchestrateur]
sources: [Inference_App/backend/main.py, Inference_App/backend/api/settings.py]
---

# Référence API

## Conventions de l'API Inference App

Le backend expose une API REST JSON sous `/api`, plus `/health` et une documentation interactive (Swagger) sur `/docs` au port du backend (8065 par défaut, voir [Configuration](configuration.fr.md)). Chaque requête est proxifiée par le frontend Vite sur `/api` ; contrairement à Training App, aucun endpoint n'est appelé directement au port du backend.

Règles générales :

- **Erreurs** au format FastAPI `{"detail": "..."}`, avec 400 (requête invalide : média illisible, YAML invalide, clic SOT ne touchant aucune détection) ou 403/404 (depuis `GET /api/output`). Les messages de détail sont écrits en français ; le frontend les affiche tels quels.
- **Opérations longues** : `POST /api/runs` répond immédiatement avec un `job_id` à interroger via `GET /api/runs/{job_id}`. `POST /api/orchestrator/infer` et `POST /api/orchestrator/evaluate`, à l'inverse, s'exécutent de façon synchrone et bloquent jusqu'à la fin de l'étape du pipeline, conformément à la façon dont l'Orchestrator les appelle.
- **Chemins** : `source`, `model_path`, `data_yaml` et les chemins à l'intérieur de `GET /api/output` sont tous des chemins serveur tels que vus par le backend ; rien n'est téléversé via ces endpoints.

Le tableau d'endpoints de la section *Index des endpoints* est généré depuis le code ; les sections ci-dessous expliquent chaque domaine.

## Endpoints média

- `POST /api/media/inspect` : corps `{source}` ; renvoie `{source, kind: "images" | "video", width, height, frames, fps}` après lecture du fichier ou du dossier. Lève une 400 sur une source illisible ou non prise en charge.
- `GET /api/media/preview?source=&frame=0` : renvoie une frame en image JPEG (`image/jpeg`), utilisée pour l'aperçu de la barre latérale et la cible de clic SOT.

## Endpoint de run : inférence, MOT et SOT

- `POST /api/runs` (202 Accepted) : corps correspondant à `RunRequest` (`source`, `model_path`, `engine` par défaut `yolox`, `model_size` par défaut `yolox-s`, `mode` parmi `infer`/`mot`/`sot`, `tracker` `none`/`bytetrack`, `click_x`/`click_y` (requis pour `sot`, 0-1), `confidence`, `iou`, `imgsz`, `device`, `class_names`, les cinq paramètres ByteTrack `track_*`, `save_output`, `max_frames`, `run_name`). Démarre un thread en arrière-plan et renvoie immédiatement `{status: "running", job_id}`.
- `GET /api/runs/{job_id}` : l'état courant du job, `{status: "running"}` en cours d'exécution, ou le résultat complet une fois terminé (`run_name`, `run_dir`, `output_path`, `mode`, `tracker`, `engine`, `frames`, `detections`, `objects_last_frame`, `unique_tracks`, `fps`, `detector_fps`, `detector_ms_per_frame`, `tracker_ms_per_frame`, `duration_s`, `last_detections`), ou `{status: "error", error}` en cas d'échec. 404 si `job_id` est inconnu.

## Endpoint d'évaluation (utilisé directement et par l'Orchestrator)

Il n'y a pas d'endpoint `/api/evaluate` dédié pour l'interface : l'onglet **Évaluation** appelle directement `POST /api/orchestrator/evaluate` (ci-dessous) avec `kind: "detection"`, le même endpoint que celui utilisé par l'Orchestrator.

## Endpoints de configuration

- `GET /api/config` : lit le `config.yaml` du workspace s'il existe, sinon le `config/defaults.yaml` embarqué ; renvoie `{source, yaml_text, values}` (`values` est le YAML analysé en JSON).
- `PUT /api/config` : corps `{yaml_text}` ; l'analyse comme YAML, exige que la racine soit un objet (400 sinon), l'écrit dans le `config.yaml` du workspace, et renvoie `{saved: true, source, values}`. Le schéma complet est dans [Configuration](configuration.fr.md).

## Endpoint de service des sorties

- `GET /api/output?path=` : sert un fichier sous `runs/` du workspace (média annoté, graphiques d'évaluation, `result.json`). Le chemin est résolu et vérifié comme restant sous `RUNS_DIR` ; un chemin en dehors est refusé avec 403, un fichier manquant avec 404. C'est le seul moyen pour le frontend de lire les sorties d'un run ; il n'y a pas d'endpoint de listage, le frontend connaît déjà les chemins depuis la réponse propre du run ou de l'évaluation.

## Endpoints de réglages et d'application

- `GET` / `PUT /api/settings` : lit ou fusionne `ui_language` du workspace (voir [Configuration](configuration.fr.md)) ; utilisé uniquement hors VisionNexus.
- `GET /health` : `{"status": "ok", "app": "Inference_App", "version": "2.0.0"}`, sans condition.
- `GET /` : `{"app", "version", "docs"}`.
- `GET /api/app-mode` : `{mode: "solo" | "orchestrator", workspace, runs_dir, user}`.
- `GET /api/capabilities` : `{detectors: [{name, label, available, plugin, reason}, ...], modes: ["infer", "mot", "sot"], trackers: ["none", "bytetrack", "csrt"], media: [extensions...]}`. Notez que `trackers` liste `csrt` à titre d'information même s'il n'est jamais sélectionné explicitement : le mode SOT utilise toujours CSRT en interne.

## Endpoints d'intégration Orchestrator

Les deux endpoints `/api/orchestrator` sont le contrat avec Orchestrator App ; ils s'exécutent de façon synchrone et bloquent jusqu'à la fin de l'inférence ou de l'évaluation sous-jacente (voir [Architecture](architecture.fr.md)).

- `POST /api/orchestrator/infer` : `sequence_dir` (requis), `model_path`, `engine` (défaut `yolox`), `model_size` (défaut `yolox-s`), `mode` (accepté mais actuellement toujours exécuté comme `"mot"` en interne), `clicks` (inutilisé pour les runs pilotés par l'Orchestrator, le SOT nécessitant un clic interactif), `tracker_mot` (`"bytetrack"` ou toute autre valeur pour aucun tracker), `tracker_sot` (accepté, inutilisé), `n_targets`, `compute_metrics` (accepté, inutilisé), `annotation_file`, `overrides` (un dict de valeurs de champs `RunOptions`, avec `conf_thresh`/`iou_thresh`/`img_size`/`save_video` acceptés comme alias de `confidence`/`iou`/`imgsz`/`save_output`), `trace` (`{graph_id, graph_name, node_id, node_label, run_id}`, utilisé pour construire un `run_name` déterministe). Renvoie le résultat de `run_inference` plus `video` (nom du fichier de sortie) et un résumé `benchmark` (`fps_total`, `n_frames`, `detections`, `objects_last_frame`, `unique_tracks`, `detector_ms_per_frame`, `tracker_ms_per_frame`).
- `POST /api/orchestrator/evaluate` : `kind` (`"detection"` ou `"tracker"`), `model_path`, `engine`, `model_size`, `data_yaml` (requis pour `kind: "detection"`), `sequence_dir` (requis pour `kind: "tracker"`), `overrides` (pour la détection : `split` par défaut `"val"`, `conf`/`confidence` par défaut 0,001, `iou` par défaut 0,6, `imgsz`, `device` ; pour le tracker : les mêmes champs `RunOptions` que `orchestrator_infer`), `timeout_s` (accepté, inutilisé par cette implémentation synchrone), `trace`. La détection renvoie `{status, run_dir, metrics: {map50, map50_95, images, ground_truth, predictions, duration_s, fps, per_class}, kind: "detection", mlflow_run_id: ""}` ; le tracker renvoie `{status: "done", kind: "tracker", run_dir, metrics: {fps, detector_fps, detector_ms_per_frame, tracker_ms_per_frame, frames, detections, unique_tracks}, mlflow_run_id: ""}`. `mlflow_run_id` est toujours une chaîne vide : Inference App ne journalise rien dans MLflow elle-même.

## Index des endpoints

<!-- generated:start -->
### main

| Method | Path | Summary | Source |
|---|---|---|---|
| GET | `/` | `root()` | `Inference_App/backend/main.py:323` |
| GET | `/api/app-mode` | `app_mode()` | `Inference_App/backend/main.py:118` |
| GET | `/api/capabilities` | `capabilities()` | `Inference_App/backend/main.py:128` |
| GET | `/api/config` | `get_config()` | `Inference_App/backend/main.py:48` |
| PUT | `/api/config` | `put_config()` | `Inference_App/backend/main.py:56` |
| POST | `/api/media/inspect` | `media_inspect()` | `Inference_App/backend/main.py:138` |
| GET | `/api/media/preview` | `media_preview()` | `Inference_App/backend/main.py:146` |
| POST | `/api/orchestrator/evaluate` | `orchestrator_evaluate()` | `Inference_App/backend/main.py:272` |
| POST | `/api/orchestrator/infer` | `orchestrator_infer()` | `Inference_App/backend/main.py:213` |
| GET | `/api/output` | `output()` | `Inference_App/backend/main.py:159` |
| POST | `/api/runs` | `start_run()` | `Inference_App/backend/main.py:171` |
| GET | `/api/runs/{job_id}` | `run_status()` | `Inference_App/backend/main.py:180` |
| GET | `/health` | `health()` | `Inference_App/backend/main.py:113` |

### settings

| Method | Path | Summary | Source |
|---|---|---|---|
| GET | `/api/settings` | `get_settings()` | `Inference_App/backend/api/settings.py:40` |
| PUT | `/api/settings` | `update_settings()` | `Inference_App/backend/api/settings.py:45` |
<!-- generated:end -->
