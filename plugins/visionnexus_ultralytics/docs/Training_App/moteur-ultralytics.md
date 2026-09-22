# Moteur Ultralytics (plugin)

Cette page decrit ce que le plugin Ultralytics ajoute a Training_App. Tout le reste de l'app est
inchange : meme interface, memes runs, memes endpoints. Le moteur par defaut reste YOLOX, decrit
dans la doc de l'app.

## Choisir le moteur

Un selecteur **Moteur** apparait dans le panneau Modele des que plusieurs moteurs sont
disponibles. Le moteur est un choix **par run** : les deux peuvent coexister dans le meme
historique.

Changer de moteur recharge le catalogue : tailles, hyperparametres et valeurs par defaut sont ceux
du moteur choisi. Un hyperparametre saisi pour un moteur n'est pas transmis a l'autre (il est
liste comme ignore au lancement) : `basic_lr_per_img` (YOLOX) et `lr0` (Ultralytics) ne sont pas
la meme chose.

## Modeles et poids

| | Ultralytics | YOLOX (coeur) |
|---|---|---|
| Tailles | `yolov8n..x`, `yolo11n..x`, `yolo26n..x` | `yolox-nano..x` |
| Poids | `.pt` | `.pth` |
| Sans poids de depart | poids COCO pre-entraines de la taille choisie, telecharges au premier usage | entrainement depuis zero |

Les poids telecharges sont ranges a cote du dossier des runs (`<workspace>/pretrained/`), ou dans
le dossier indique par `VISIONNEXUS_PRETRAINED_DIR`. Sur une machine sans acces reseau, deposez-y
les `.pt` a l'avance ou indiquez un chemin de poids explicite.

Des poids `.pth` sont refuses avant lancement pour ce moteur, et inversement : un `.pt`
Ultralytics ne se charge pas avec YOLOX.

## Hyperparametres

Ceux d'Ultralytics (`ultralytics/cfg/default.yaml`), groupes dans le formulaire : duree
(`epochs`, `patience`, `batch`, `imgsz`, `close_mosaic`, `workers`, `device`, `amp`, `cache`),
optimiseur (`optimizer`, `lr0`, `lrf`, `momentum`, `weight_decay`, `warmup_*`), pertes (`box`,
`cls`, `dfl`) et augmentations (`hsv_*`, `degrees`, `translate`, `scale`, `shear`, `perspective`,
`flipud`, `fliplr`, `mosaic`, `mixup`, `copy_paste`, `erasing`). Seul `workers` s'ecarte du defaut
amont (4 au lieu de 8, comme cote YOLOX).

Correspondances avec les champs generiques de l'Orchestrator : `epochs` -> `epochs`,
`batch` -> `batch`, `imgsz` -> `imgsz`, `workers` -> `workers`.

## Plots et suivi

Les plots natifs d'Ultralytics sont conserves tels quels, sous leurs noms, a la racine du dossier
du run : `results.png` (synthese pertes/metriques), `confusion_matrix_normalized.png` et
`confusion_matrix.png`, `BoxPR_curve.png`, `BoxP_curve.png`, `BoxR_curve.png`, `BoxF1_curve.png`,
`labels.jpg`, `train_batch*.jpg`, `val_batch0_labels.jpg`, `val_batch0_pred.jpg`. Ce sont eux que
montrent la galerie de l'historique et les Insights de l'Orchestrator, et qui sont joints au run
MLflow sous `plots/` (la synthese `results.png` n'a pas d'equivalent YOLOX).

Le suivi temps reel est identique a celui du moteur YOLOX : un evenement par epoque, avec
`box_loss` / `cls_loss` / `dfl_loss` et les metriques `metrics/mAP50(B)`, `metrics/mAP50-95(B)`,
`metrics/precision(B)`, `metrics/recall(B)`. Les mAP finaux sont ceux de la revalidation des
poids retenus (`best.pt`), pas ceux de la derniere epoque.

`results.csv` est ecrit par Ultralytics (colonnes `train/box_loss`...) ; l'historique par epoch de
l'app lit indifferemment ces colonnes et celles de YOLOX.

## Dataset

Labels YOLO `.txt` uniquement. Un dataset au format `.ver` (`annotation_file:` dans le
`data.yaml`) est refuse avec un message explicite : exportez-le en YOLO depuis Annotation_App.

Le `data.yaml` est recopie dans le dossier du run avec un `path:` absolu
(`data_resolved.yaml`) : Ultralytics resout sinon un `path:` relatif contre son dossier global de
datasets, pas contre le dossier du fichier.

## Details d'integration

- Le callback MLflow d'Ultralytics est retire a chaque run : Training_App journalise deja le run,
  avec ses tags de tracabilite. Laisse actif, il creerait un second run orphelin dans un store
  `runs/mlflow` relatif au dossier courant.
- `CUDA_VISIBLE_DEVICES` est protege : Ultralytics l'ecrit (`-1` ou vide) quand on entraine sur
  CPU et ne le retablit pas. Sans cette protection, un run CPU privait de GPU tous les runs
  suivants du meme processus, quel que soit leur moteur.
- L'arret depuis l'interface est verifie avant chaque batch : la reponse est immediate, le run
  passe en `stopped`.
