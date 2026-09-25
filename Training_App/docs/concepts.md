---
app: training
doc_type: concepts
audience: user
lang: en
title: Concepts
order: 30
tags: [run, engine, yolox, hyperparameters, map, precision, recall, checkpoint]
sources: [Training_App/backend/services/yolox_catalog.py, Training_App/backend/services/trainer_backend.py, Training_App/backend/services/yolox_trainer.py, Training_App/backend/services/detection_metrics.py, Training_App/backend/services/yolox_dataset.py, Training_App/backend/services/yolox_plots.py, Training_App/backend/services/training_service.py, Training_App/backend/vendor/yolox/yolox/exp/yolox_base.py]
---

# Concepts

## Training runs, run names and statuses

A run is one training of one model on one dataset with one set of hyperparameters. Training App records each run in the workspace database with its engine, model size, starting weights, `data.yaml`, dataset name, the full hyperparameters actually used, its progress, its final metrics and the path of its best weights.

Run names are generated and unique: `train_<8 hex characters>` for runs started from the interface or the API, `orch_<8 hex characters>` for runs started by the Orchestrator. Each run writes into its own folder `runs/<run name>/` of the workspace.

A run goes through these statuses:

- **Pending**: recorded, the training thread is starting.
- **Running**: the engine is training; the current epoch and progress are updated at the end of each epoch.
- **Done**: training finished normally; the best weights path and the final metrics are recorded.
- **Error**: an exception stopped the training (dataset problem, out of memory...); the message is kept on the run.
- **Stopped**: a stop was requested and the engine stopped before the end.

Several runs can train at the same time: each run has its own thread in the backend process. They then share the GPU, so each is slower and memory may run out. The progress events of a run are kept in memory only while the backend runs: after a backend restart, a run that was **Running** cannot be resumed and keeps that status in the database.

## Training engines and the engine catalog

An engine is the component that actually trains a model: it builds the network, reads the dataset, runs the training loop and writes the weights and plots. Training App ships one engine, **YOLOX**. Other engines can be added as plugins (see [Configuration](configuration.md)); the engine is then chosen per run, and several engines can coexist in the same history.

Each engine publishes a catalog: its label, the extension of its weights files (`.pth` for YOLOX), its model sizes and default size, the default value of every hyperparameter, the groups of the form, the search ranges used by Optuna App, and the list of its analysis plots. The **Training** page, Optuna App and the Orchestrator build their forms from this catalog only.

Rules common to all engines:

- The engine of a run is recorded with it (database, MLflow, Orchestrator response). Weights can only be reloaded by the engine that produced them.
- Starting weights whose extension does not belong to the engine are refused before the run starts, as is a size absent from the catalog.
- Hyperparameters unknown to the engine are ignored and reported (typical case: best parameters found by Optuna for another engine).
- There is no silent fallback: a missing or unusable engine is an explicit error.

When a request does not name an engine, the default engine of the instance is used: `yolox`, unless the variable `TRAINING_APP_TRAINER_BACKEND` names another one.

## YOLOX model sizes

YOLOX is a one-stage, anchor-free object detector: for each cell of three feature maps, it predicts whether an object is present (objectness), its class and its box. Training App offers six sizes, which differ by the depth and width of the network:

| Size | Depth / width | Parameters (approx.) | Typical use |
|---|---|---|---|
| `yolox-nano` | 0.33 / 0.25, depthwise convolutions | 0.9 M | embedded targets, quick tests |
| `yolox-tiny` | 0.33 / 0.375 | 5 M | fast inference, small GPU |
| `yolox-s` | 0.33 / 0.50 | 9 M | default, good balance |
| `yolox-m` | 0.67 / 0.75 | 25 M | better accuracy, medium GPU |
| `yolox-l` | 1.0 / 1.0 | 54 M | high accuracy, large GPU |
| `yolox-x` | 1.33 / 1.25 | 99 M | maximum accuracy, slow |

Larger sizes are more accurate on large datasets but need more GPU memory, more time per epoch and more data to avoid overfitting. On a few hundred images, `s` or `m` from pretrained weights is usually the best choice.

In Training App, every size uses the **Image size** of the form (640 by default) and the same augmentation defaults. The upstream YOLOX recipes train `nano` and `tiny` at 416 pixels with lighter augmentation; set **Image size** to 416 and **Mixup enabled** to `false` to reproduce them. The number of classes of the network comes from `names` of the `data.yaml`.

## Starting weights: training from scratch or fine-tuning

Without starting weights, a YOLOX run starts from random weights ("from scratch"). This needs a large dataset and many epochs (the default 300 epochs come from COCO training).

With starting weights (a `.pth` checkpoint), the run fine-tunes an existing model: the weights of the file are copied into the new network, layer by layer. A layer whose shape differs is skipped and keeps its random initialization; this is what happens to the classification layer when the number of classes changed, while the backbone that extracts visual features is reused. Fine-tuning converges much faster and needs far fewer images.

Points to know:

- The checkpoint must come from the same size: a `yolox-m` file loaded into a `yolox-s` network has almost no layer of the right shape.
- Only the model weights are taken from the file. The epoch counter, the optimizer state and the learning rate schedule start from zero: this is not a resume of an interrupted run.
- Good starting points are the best weights of a previous run, or the official YOLOX COCO checkpoints (`yolox_s.pth`...), which the app never downloads by itself (see [Configuration](configuration.md)).

## Epochs, evaluation interval and the final epochs without augmentation

An epoch is one pass over all training images. The number of iterations per epoch is the number of training images divided by **Batch size**.

The YOLOX schedule of a run has three phases:

1. **Warmup** (**Warmup epochs**, 5 by default): the learning rate rises from **Warmup LR** to its nominal value, which stabilizes the first updates.
2. **Main phase**: the learning rate follows a cosine curve down to **Min LR (ratio)** times the nominal value, with the full augmentation (mosaic, mixup...).
3. **Final epochs without augmentation** (**No mosaic/mixup (final, ep.)**, 15 by default): mosaic and mixup are switched off so the model sees images close to real ones, an additional L1 box loss is enabled, the learning rate stays at its minimum, and the model is evaluated at every epoch. A checkpoint `last_mosaic_epoch_ckpt.pth` is saved when this phase starts.

The model is evaluated on the validation split every **Eval interval (ep.)** epochs (10 by default), at every epoch of the final phase, and always at the last epoch. Metrics, plots and the best checkpoint are only updated at these evaluations; the other epochs only report losses. With fewer epochs than **Eval interval (ep.)**, the only evaluation is the final one.

## YOLOX hyperparameters: training and optimizer

The fields of the **Training** and **Optimizer** groups of the YOLOX form, with their key (as stored on the run and in MLflow) and default value:

| Field | Key | Default | Effect |
|---|---|---|---|
| **Epochs** | `max_epoch` | 300 | Total number of epochs. |
| **Warmup epochs** | `warmup_epochs` | 5 | Length of the learning rate warmup. |
| **No mosaic/mixup (final, ep.)** | `no_aug_epochs` | 15 | Final epochs without mosaic and mixup. Must be lower than **Epochs**. |
| **Eval interval (ep.)** | `eval_interval` | 10 | Epochs between two evaluations. |
| **Log interval (iter.)** | `print_interval` | 10 | Iterations between two log lines; the losses reported per epoch are sampled at these lines. |
| **Batch size** | `batch_size` | 16 | Images per iteration. Main lever on GPU memory. |
| **Image size** | `imgsz` | 640 | Side of the square network input, in pixels (multiple of 32). |
| **Workers** | `data_num_workers` | 4 | Processes loading and augmenting images in parallel. |
| **Device** | `device` | empty | Empty or `auto`: GPU if available, else CPU. Also `cpu`, `cuda`, `cuda:1`. |
| **FP16 (mixed precision)** | `fp16` | false | Half precision on GPU: less memory, faster. Ignored on CPU. |
| **LR per image** | `basic_lr_per_img` | 0.00015625 | Learning rate per image; the real rate is this value times **Batch size** (0.0025 at batch 16). |
| **Scheduler** | `scheduler` | `yoloxwarmcos` | Learning rate schedule: warmup then cosine. |
| **Warmup LR** | `warmup_lr` | 0 | Starting learning rate of the warmup. |
| **Min LR (ratio)** | `min_lr_ratio` | 0.05 | Final learning rate, as a fraction of the nominal rate. |
| **Weight decay** | `weight_decay` | 0.0005 | L2 penalty on the weights; limits overfitting. |
| **Momentum** | `momentum` | 0.9 | Momentum of the SGD optimizer. |
| **EMA** | `ema` | true | Keeps a moving average of the weights, used for evaluation and checkpoints; smoother and usually better. |

Because the learning rate scales with the batch size, changing **Batch size** does not require changing **LR per image**. Two keys are not in the form and keep their defaults during evaluation: `test_conf` (0.01, minimum confidence kept) and `nmsthre` (0.65, NMS overlap threshold).

## YOLOX hyperparameters: data augmentation

Data augmentation creates modified copies of the training images at every iteration, so that the model generalizes instead of memorizing. The fields of the **Data augmentation** group:

| Field | Key | Default | Effect |
|---|---|---|---|
| **Rotation (°)** | `degrees` | 10 | Maximum random rotation, in degrees. |
| **Translation** | `translate` | 0.1 | Maximum random shift, as a fraction of the image size. |
| **Shear (°)** | `shear` | 2 | Maximum random shear, in degrees. |
| **Perspective** | `perspective` | 0 | Random perspective distortion (very small values). |
| **HSV jitter prob.** | `hsv_prob` | 1.0 | Probability of a random change of hue, saturation and brightness. |
| **Flip prob.** | `flip_prob` | 0.5 | Probability of a horizontal flip. |
| **Mosaic prob.** | `mosaic_prob` | 1.0 | Probability of building a training image from four images (mosaic). |
| **Mixup prob.** | `mixup_prob` | 1.0 | Probability of blending the mosaic with another image (mixup). |
| **Mixup enabled** | `enable_mixup` | true | Master switch of mixup. |

The zoom ranges applied with mosaic (`mosaic_scale`, 0.8 to 1.6) and mixup (`mixup_scale`, 0.5 to 1.5) are not in the form and keep their defaults.

When to change them: reduce **Rotation (°)** and **Shear (°)** to 0 when orientation matters (text, gauges) or when boxes become loose after rotation; set **Flip prob.** to 0 when left and right have a meaning; lower **Mosaic prob.** and **Mixup prob.** for small datasets of large objects, where mosaic cuts objects too often. Look at **Training batches (augmented)** in the run analysis to see the effect.

## Training losses of YOLOX

The loss measures how wrong the predictions are on the training batch; training lowers it. YOLOX reports several losses at the end of each epoch:

- `iou_loss`: box localization error, based on the overlap (IoU) between predicted and annotated boxes. Shown as the box loss in **Losses (train)**.
- `conf_loss`: objectness error, whether an object is present at each location.
- `cls_loss`: classification error on the detected objects.
- `l1_loss`: absolute error on box coordinates, active only during the final epochs without augmentation (0 before).
- `total_loss`: the weighted sum of the above.

The values reported for an epoch are those of the last log line of the epoch (every **Log interval (iter.)** iterations), not an average. If an epoch has fewer iterations than **Log interval (iter.)** (small dataset, large batch), no loss is reported: lower **Log interval (iter.)** to get the curves.

Losses on augmented training images are noisy and not comparable between runs with different augmentation. Judge the model with the validation metrics.

## Detection metrics: IoU, precision, recall, mAP50 and mAP50-95

Training App evaluates the model on the whole validation split with its own implementation of the COCO-style metrics.

- **IoU** (intersection over union): the area shared by a predicted box and an annotated box, divided by the area of their union. 1 means identical boxes.
- **True positive**: a prediction of the right class whose IoU with a not-yet-matched annotation reaches the threshold. Predictions are matched from the most confident to the least; the others are false positives, and unmatched annotations are missed objects.
- **Precision**: share of predictions that are correct. **Recall**: share of annotated objects that are found.
- **AP** (average precision) of a class: the area under its precision-recall curve, sampled at 101 recall points.
- **mAP50** (`metrics/mAP50(B)`): the mean AP over classes at IoU 0.50. It says whether objects are found with a roughly right box.
- **mAP50-95** (`metrics/mAP50-95(B)`): the mean of the mAP at the ten IoU thresholds 0.50, 0.55... 0.95. It also rewards precise boxes and is the main quality score.

Classes absent from the validation annotations are excluded from the means. The **precision** and **recall** values reported per epoch (`metrics/precision(B)`, `metrics/recall(B)`) are the average of each class curve over all confidence thresholds from 0 to 1 at IoU 0.50, averaged over classes: they are indicators for comparing runs, not the precision and recall you get at a given threshold. Use the P, R and F1 curves for that.

The mAP shown on a run is the one of its latest evaluation; at the end of a YOLOX run, it is the mAP of the final epoch. The best weights (`best_ckpt.pth`) are those of the evaluation with the highest mAP50-95, which may be an earlier epoch. Other tools (Inference App, other engines) use slightly different conventions, so compare values computed by the same tool.

## Checkpoints written by a YOLOX run

A checkpoint is a `.pth` file holding the network weights (the EMA weights when **EMA** is on) plus the optimizer state and training counters. A YOLOX run writes in its folder:

- `latest_ckpt.pth`: at the end of every epoch.
- `last_epoch_ckpt.pth`: at every evaluation.
- `best_ckpt.pth`: a copy made each time an evaluation beats the best mAP50-95 so far. This is the **Best model** of the run.
- `epoch_<N>_ckpt.pth`: one per evaluation, as a history.
- `last_mosaic_epoch_ckpt.pth`: when the final epochs without augmentation start.

If no evaluation ever reached a mAP50-95 above 0 (very short run, empty validation), `best_ckpt.pth` does not exist and `last_epoch_ckpt.pth` is recorded as the best model. The folder also holds `train_log.txt` (full training log), `results.csv` (one line per epoch with the metrics and losses) and `artifacts/` (analysis plots). Any of these checkpoints can be used as starting weights or in Inference App.

## Dataset formats: YOLO .txt labels and .ver files

A dataset is described by a `data.yaml` file with these keys:

- `path` (optional): root folder of the dataset, absolute or relative to the folder of `data.yaml` (default: that folder).
- `train`, `val`, `test`: image folder of each split (or a single image), relative to `path`. Images (`.jpg`, `.jpeg`, `.png`, `.bmp`, `.tif`, `.tiff`) are searched recursively. When `train` is missing, the `val` images are used for training too.
- `names`: class names, as a list or a `{id: name}` mapping. Required.
- `annotation_file` (optional): path of a `.ver` file to use as labels.

**YOLO .txt labels** (default): for each image, a text file with the same name and the `.txt` extension, in the folder obtained by replacing the last `images` segment of the image folder by `labels` (`images/val` -> `labels/val`). Each line is `class cx cy w h`, normalized between 0 and 1. Label files are looked up directly in that folder: images stored in subfolders of the split need their label files at the top of the labels folder.

**.ver files**: the historical VisionNexus format, one text file for a whole sequence, one line per box: `frame visibility x1 y1 x2 y2 [track_id class]`, in pixels, frames numbered from 1. The class column is a word mapped to an id (`drone` 0, `bird` 1, `plane` 2, `helicopter` 3, `unknown` 4, any other word 0); lines without class column get class 0. Images are matched by the first number of their file name, counted from 0: the image `frame_000000.jpg` receives the boxes of frame 1. The `.ver` file is used when `annotation_file` points to it, or when the labels path of a split is itself a `.ver` file; the same file then serves every split.

## Analysis plots of a YOLOX run

A YOLOX run writes its plots in `artifacts/` of its folder at every evaluation. They are shown in **Model analysis** and attached to the MLflow run.

- **Confusion matrix** (`confusion_matrix.png`): rows are predicted classes, columns are annotated classes, plus a background row and column. Predictions with confidence of at least 0.25 are matched to annotations with an IoU of at least 0.45. The diagonal counts correct detections; the background row counts missed objects; the background column counts false alarms; other cells are class confusions.
- **PR curve** (`PR_curve.png`): precision against recall at IoU 0.50, per class, with its AP. A curve close to the top right corner is good.
- **P, R and F1 curves** (`P_curve.png`, `R_curve.png`, `F1_curve.png`): precision, recall and F1 (their harmonic mean) against the confidence threshold. The threshold at the top of the F1 curve is a good default for inference.
- **Label distribution** (`labels.jpg`): number of boxes per class and scatter of box sizes. It reveals class imbalance and very small objects. Written once.
- **Training batches** (`train_batch0.jpg`): 16 training samples after augmentation, as the network sees them. Written once.
- **Validation** ground truth and predictions (`val_batch0_labels.jpg`, `val_batch0_pred.jpg`): the same first 16 validation images with annotated boxes, then with the boxes predicted by the current model, regenerated at every evaluation.

## Architecture and operation of the YOLOX network

The YOLOX engine of Training App builds a detector from three parts, whose width and depth depend on the chosen size (see the size table above). Understanding them explains what the losses measure and why some hyperparameters matter.

### YOLOX backbone and neck: CSPDarknet with a path aggregation pyramid

The **backbone** is CSPDarknet: a stem that reduces the image, then four stages of convolutions whose blocks split their channels in two paths (cross stage partial connections) to reduce computation while keeping gradient flow. Activations are SiLU (Nano uses depthwise convolutions to be lighter). The three last stages give feature maps at strides 8, 16 and 32, that is at one eighth, one sixteenth and one thirty-second of the input size: fine maps for small objects, coarse maps for large ones. The **neck** is a path aggregation feature pyramid (PAFPN): it sends the semantic information of the coarse maps down to the fine maps, then the precise positions of the fine maps back up, so that each of the three outputs is both precise and informed. Depth and width multiply the number of blocks and channels: `yolox-s` has the same layout as `yolox-x`, only slimmer.

### YOLOX decoupled head and label assignment: how a box is predicted

The **head** is applied to each of the three maps and is decoupled: after a shared 1 x 1 convolution, one branch predicts the class scores and another predicts the box and the objectness, instead of one branch doing everything. It is anchor-free: each cell of a map directly predicts the offset of the box center and the width and height of the box, without a list of predefined box shapes. The prediction of a cell is the box, the objectness (is there an object here) and the class probabilities; at inference the detection score is objectness times class probability.

Training has to decide which cells are responsible for which annotated box. YOLOX uses **SimOTA**, a dynamic assignment: for each annotated box, it estimates how many cells should predict it, from the overlap of the best candidates, then picks the cells whose combined classification and localization cost is lowest, and refuses that two boxes claim the same cell. This dynamic choice is what the `iou_loss`, `conf_loss` and `cls_loss` of the training curves are computed on. Strong augmentation (mosaic, mixup) helps because it exposes the assignment to varied contexts; it is switched off for the final epochs so that the network settles on natural images, and the `l1_loss` is enabled at that point.
