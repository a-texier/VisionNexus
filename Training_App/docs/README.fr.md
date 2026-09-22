*[Read in English](README.md)*

# Documentation - Training App

Index des references : moteurs d'entrainement, modeles, hyperparametres, evenements SSE, plots et
contrat de l'endpoint orchestrateur. Vue d'ensemble et demarrage rapide : [../README.md](../README.md).

## Moteurs d'entrainement

Chaque run est entraine par un **moteur**, choisi run par run (champ `engine` des requetes). Le
coeur fournit le moteur `yolox` (moteur maison, Apache-2.0). D'autres moteurs peuvent etre ajoutes
par des plugins poses dans `plugins/` a la racine du monorepo : voir
[../../docs/plugins/README.md](../../docs/plugins/README.md).

`GET /api/capabilities` liste les moteurs connus, leur disponibilite et leur **catalogue** (tailles,
hyperparametres et leurs valeurs par defaut, formulaire, plages Optuna, plots produits). Les
interfaces (Training, Optuna, Orchestrator) se construisent uniquement a partir de ce catalogue :
sans plugin, seul YOLOX est liste et aucun selecteur de moteur n'apparait.

Regles communes a tous les moteurs :

- Le moteur d'un run est enregistre avec lui (base, MLflow, reponse de l'orchestrateur) : les poids
  produits ne se rechargent qu'avec leur moteur.
- Des poids de depart dont l'extension ne correspond pas au moteur sont refuses avant lancement
  (`400`), comme une taille absente de son catalogue.
- Les hyperparametres inconnus du moteur sont ignores et renvoyes dans `ignored_hyperparams`
  (cas typique : des `best_params` Optuna calcules pour un autre moteur).
- Pas de repli silencieux : un moteur absent ou indisponible est une erreur explicite.

## Moteur YOLOX

Moteur maison (`backend/services/yolox_engine.py` autour de `VisionNexusYoloxTrainer`), architecture
choisie par taille :

| Taille | Fichier exp (vendor) |
|--------|-----------------------|
| yolox-nano | exps/default/yolox_nano.py |
| yolox-tiny | exps/default/yolox_tiny.py |
| yolox-s    | exps/default/yolox_s.py |
| yolox-m    | exps/default/yolox_m.py |
| yolox-l    | exps/default/yolox_l.py |
| yolox-x    | exps/default/yolox_x.py |

Poids : `.pth` natifs YOLOX. Sans poids de depart, l'entrainement part de poids aleatoires. Le
nombre de classes de la tete est celui du `data.yaml`.

### Hyperparametres

Repris tels quels des defauts officiels `yolox/exp/yolox_base.py` (vendor), voir
`backend/services/yolox_catalog.py::DEFAULT_HYPERPARAMS` pour la liste et les valeurs exactes :

**Duree / planning** : max_epoch, warmup_epochs, no_aug_epochs (derniers epochs sans
mosaic/mixup), eval_interval, print_interval
**Optimiseur** : basic_lr_per_img (lr reel = valeur x batch_size), scheduler, warmup_lr,
min_lr_ratio, weight_decay, momentum, ema
**Dataloader** : batch_size, data_num_workers, seed, imgsz
**Augmentations geometriques** : degrees, translate, scale (tuple), shear, perspective
**Augmentations couleur/composition** : hsv_prob, flip_prob, mosaic_prob, mixup_prob, enable_mixup
**Inference/evaluation** : test_conf, nmsthre
**Materiel** : device, fp16

Correspondance des champs generiques (Orchestrator, Optuna) : `epochs` -> `max_epoch`,
`batch` -> `batch_size`, `imgsz` -> `imgsz`, `workers` -> `data_num_workers`.

### Plots d'analyse

Produits par `detection_metrics.py` (metriques) et `yolox_plots.py` (previews visuelles) dans
`<run>/artifacts/` :

| Fichier | Genere par | Mis a jour |
|---------|-----------|------------|
| `confusion_matrix.png` | `detection_metrics.save_plots` | a chaque evaluation |
| `PR_curve.png`, `P_curve.png`, `R_curve.png`, `F1_curve.png` | `detection_metrics.save_plots` | a chaque evaluation |
| `labels.jpg` | `yolox_plots.save_dataset_preview_plots` | une fois (ne depend que du dataset) |
| `train_batch0.jpg` | `yolox_plots.save_dataset_preview_plots` | une fois (mosaic/mixup/HSV/flip appliques) |
| `val_batch0_labels.jpg` | `yolox_plots.save_val_batch_plots` | une fois (verite terrain) |
| `val_batch0_pred.jpg` | `yolox_plots.save_val_batch_plots` | a chaque evaluation (predictions du modele courant) |

`val_batch0_labels.jpg`/`val_batch0_pred.jpg` donnent un controle visuel rapide sur un echantillon
de 16 images de validation au maximum.

## Plots : galerie, Insights et MLflow

Chaque moteur declare ses plots dans son catalogue (`artifacts`, par categorie : `summary`,
`confusion`, `curves`, `labels`, `val_labels`, `val_predictions`, plus `train_batches_glob`).
`GET /api/training/{run_name}/artifacts` renvoie ceux du **moteur du run** ; les memes fichiers
alimentent la galerie de l'historique, les Insights de l'Orchestrator et le run MLflow, ou ils sont
joints sous `plots/` en fin d'entrainement. Si le moteur d'un ancien run n'est plus disponible
(plugin retire), la reponse porte `engine_error` au lieu d'une liste vide muette.

`GET /api/training/{run_name}/artifact/{chemin}` sert une image situee sous le dossier du run.

## SSE - Flux temps reel

Endpoint : `GET /api/training/{run_name}/events`
Evenements : `epoch`, `val_metrics`, `done`, `error`, `stopped`, `status`

Chaque evenement `epoch` contient : `epoch`, `total_epochs`, `progress_pct`, `metrics` (pertes du
moteur + `metrics/mAP50(B)`, `metrics/mAP50-95(B)`, `metrics/precision(B)`, `metrics/recall(B)`,
memes noms pour tous les moteurs). Evenement `done` : `engine`, `best_model_path`, `map50`,
`map5095`.

## Format de dataset

`data.yaml` (path, train/val/test, names) + labels YOLO `.txt` (convention communautaire standard)
ou `.ver` (format historique VisionNexus, `annotation_file:` dans le data.yaml, lu par le moteur
YOLOX). Un `path:` relatif est resolu contre le dossier du `data.yaml`. Voir
`backend/services/yolox_dataset.py`.

## Endpoint orchestrateur

```
POST /api/orchestrator/train
{
  "dataset_path": "C:/workspace/annotation_bob/exports/mon-projet-yolo/",
  "engine": "yolox",            // vide = moteur par defaut de l'instance
  "model_size": "yolox-s",      // vide = taille par defaut du moteur
  "model_weights": "",
  "epochs": 100, "batch": 16, "imgsz": 640,
  "hyperparams": { "degrees": 5.0 }
}
-> { "run_name": "...", "engine": "yolox", "model_size": "yolox-s", "best_model_path": "...",
     "ignored_hyperparams": [], ... }

GET /api/orchestrator/run-status?run_name=...
-> etat du run, dont "engine"
```

Le backend cherche automatiquement `data.yaml` dans `dataset_path/data.yaml`.

## Autres endpoints

| Endpoint | Role |
|----------|------|
| `GET /api/capabilities` | moteurs, disponibilite, catalogues ; `active` = moteur par defaut |
| `GET /api/training/models?engine=` | catalogue d'un moteur |
| `POST /api/training/start` | lance un run (`engine`, `model_size`, `model_weights`, `data_yaml`, `hyperparams`) |
| `GET /api/training/{run}/metrics-history` | historique par epoch lu dans `results.csv` |
| `GET /api/training/{run}/inference-cases` | meilleurs / pires cas de validation, predits par le moteur du run |
