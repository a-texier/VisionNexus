# Documentation - Training App

Index des references : modeles supportes, hyperparametres exposes, evenements SSE et contrat de
l'endpoint orchestrateur. Vue d'ensemble et demarrage rapide : [../README.md](../README.md).

## Modeles supportes

| Version | Tailles disponibles |
|---------|---------------------|
| yolov8 | n, s, m, l, x |
| yolov9 | t, s, m, c, e |
| yolov10 | n, s, m, b, l, x |
| yolo11 | n, s, m, l, x |

## Hyperparametres exposes

**Entrainement** : epochs, patience, batch, imgsz, workers, device
**Learning rate** : lr0, lrf, momentum, weight_decay, warmup_epochs, warmup_momentum, warmup_bias_lr
**Pertes** : box, cls, dfl
**Augmentations** : hsv_h, hsv_s, hsv_v, degrees, translate, scale, flipud, fliplr, mosaic, mixup, copy_paste

## SSE - Flux temps reel

Endpoint : `GET /api/training/{run_name}/events`
Evenements : `epoch`, `val_metrics`, `done`, `error`, `stopped`, `status`

Chaque evenement `epoch` contient : `epoch`, `total_epochs`, `progress_pct`, `metrics` (dict brut Ultralytics).
Evenement `done` : `best_model_path`, `map50`, `map5095`.

## Endpoint orchestrateur

```
POST /api/orchestrator/train
{
  "dataset_path": "C:/workspace/annotation_bob/exports/mon-projet-yolo/",
  "yolo_version": "yolov8",
  "model_size": "n",
  "hyperparams": { "epochs": 100, "batch": 16, "imgsz": 640 }
}
-> { "run_name": "...", "run_id": 1, "status": "running" }

GET /api/orchestrator/run-status?run_name=...
-> TrainingRun JSON
```

Le backend cherche automatiquement `data.yaml` dans `dataset_path/data.yaml`.
