---
app: training
doc_type: workflows
audience: user
lang: en
title: Workflows
order: 20
tags: [data.yaml, training, fine-tuning, stop, analysis, mlflow, orchestrator]
sources: [Training_App/frontend/src/pages/TrainingPage.tsx, Training_App/frontend/src/pages/RunsPage.tsx, Training_App/backend/services/yolox_dataset.py, Training_App/backend/services/training_service.py, Training_App/backend/routers/orchestrator.py, Training_App/backend/services/mlflow_logging.py]
---

# Workflows

## Prepare a data.yaml dataset for Training App

This workflow builds a dataset folder that Training App can read, when it does not come from an Annotation App export.

*Prerequisites*: images and their annotations as YOLO `.txt` files (one file per image, one line `class cx cy w h` per box, coordinates normalized between 0 and 1); the folder is reachable from the backend machine.

1. Create a folder with the images in `images/train/` and `images/val/` (optionally `images/test/`).
2. Put the label files in `labels/train/` and `labels/val/`, with the same file name as the image and the `.txt` extension (`images/train/0001.jpg` -> `labels/train/0001.txt`). An image without label file is used as an image without object.
3. Create `data.yaml` at the root of the folder:

   ```yaml
   path: .
   train: images/train
   val: images/val
   names:
     0: car
     1: person
   ```

   `path` is optional; a relative `path` is resolved from the folder of `data.yaml`. `names` can also be a plain list (`[car, person]`); class ids in the label files must match its order.
4. Check that `val` contains annotated images: they are used for every evaluation, plot and metric of the run.

*Result*: the path of `data.yaml` can be typed in **data.yaml path**. An export of Annotation App in YOLO format already has this layout, and a `.ver` annotation file can also be used (see [Concepts](concepts.md), section *Dataset formats: YOLO .txt labels and .ver files*).

## Train a YOLOX model from scratch

This workflow trains a new YOLOX detector with random starting weights, from the **Training** page.

*Prerequisites*: a dataset with a `data.yaml` (see the previous workflow); a GPU is strongly recommended.

1. Open the **Training** page. If an **Engine** row is shown, choose **YOLOX**.
2. In **Size**, choose the model size. Start with `s` on a mid-range GPU, `nano` or `tiny` for quick tests or a GPU with little memory, `m` to `x` when accuracy matters more than speed (see [Concepts](concepts.md)).
3. Leave **Starting weights (optional)** empty.
4. Type the path of `data.yaml` in **data.yaml path**, and optionally a **Dataset name (optional)**.
5. In the **Training** group of **Hyperparameters**, set **Epochs** (300 by default; 50 to 100 is enough for a first try on a small dataset), **Batch size** (lower it if the GPU runs out of memory) and **Image size** (a multiple of 32, 640 by default).
6. Keep the other values at their defaults for a first run.
7. Click **Start** and check the "Run started" notification.

*Result*: a new run `train_<id>` appears in **History** as **Running**. Its folder `runs/<run name>/` in the workspace receives the checkpoints, `results.csv`, `train_log.txt` and, from the first evaluation (epoch 10 by default), the analysis plots. Training from scratch needs many epochs; with few images, fine-tuning from pretrained weights (next workflow) gives much better results.

## Fine-tune from existing YOLOX weights

This workflow starts a run from a YOLOX checkpoint instead of random weights: the weights of a previous run, or the official COCO pretrained weights.

*Prerequisites*: a YOLOX `.pth` checkpoint whose size matches the size you will select; the file is reachable from the backend.

1. Get the weights:
   - from a previous run: the **Best model** path shown in its detail window in **History** (`best_ckpt.pth` of its run folder);
   - from the official YOLOX releases (`yolox_s.pth`, `yolox_m.pth`...), downloaded manually and copied to the backend machine (the app never downloads weights, see [Configuration](configuration.md)).
2. On the **Training** page, choose the same **Size** as the checkpoint (`s` for `yolox_s.pth`).
3. Type the full path of the file in **Starting weights (optional)**.
4. Fill **data.yaml path** and the hyperparameters. For fine-tuning, fewer epochs are usually needed (for example 30 to 100).
5. Click **Start**.

*Result*: the run starts from the given weights. Layers whose shape differs from the new model (typically the classification layer when the number of classes changed) keep their random initialization, the others are loaded; the log `train_log.txt` of the run lists the skipped layers. The epoch counter, optimizer and schedule start from zero. A file with another extension than `.pth` is refused before the start; a path that does not exist makes the run start from scratch (see [Troubleshooting](troubleshooting.md)).

## Follow a run and stop it

This workflow follows a run while it trains and stops it early when needed.

*Prerequisites*: a run was started.

1. On the **Training** page, just after **Start**, watch the **Progress** panel: epoch counter, progress bar and metric tiles are updated at the end of each epoch.
2. If you leave the page, open **History**: the run row shows its status and a small progress bar, refreshed every five seconds. Click the row to open the detail window: the **mAP evolution per epoch** and **Losses (train)** charts refresh every ten seconds.
3. Watch the metrics at each evaluation (every 10 epochs by default, and every epoch during the final epochs without augmentation). A mAP that stops increasing while the losses keep decreasing is a sign of overfitting.
4. To stop the run, click **Stop** on the **Training** page (only available on the page that started the run, before leaving it). The stop is taken into account before the next training iteration.
5. To stop a run started elsewhere (other page, Orchestrator, API), call `POST /api/training/<run name>/stop` (see [API reference](api-reference.md)).

*Result*: a stopped run is marked **Stopped**; its folder keeps the last checkpoints (`latest_ckpt.pth`, and `best_ckpt.pth` if an evaluation already took place), but no best model path is recorded on the run and nothing is registered in MLflow as a model version.

## Analyze a finished run in the History page

This workflow reviews the quality of a trained model with the tools of the **History** page.

*Prerequisites*: a run in the **Done** state.

1. Open **History** and click the run.
2. Read **mAP50** and **mAP50-95**: they come from the final validation of the run. Compare runs on the same validation set only.
3. Check the **mAP evolution per epoch** chart: a curve still rising at the end means more epochs would help; a curve that falls after a peak means overfitting.
4. In **Model analysis**, open **Confusion matrix** to see which classes are confused together, missed (background row) or falsely detected (background column).
5. Open **PR / P / R / F1 curves** to choose a confidence threshold for inference: the peak of the F1 curve is a good default.
6. Look at the **Validation** predictions next to the ground truth to spot systematic errors (small objects missed, boxes too large).
7. Click **Analyze best / worst cases (inference on the validation set)** to see the images where the model is most and least confident.

*Result*: you know whether to train longer, change the hyperparameters, add annotations for weak classes, or move on to Inference App. The meaning of each metric and plot is in [Concepts](concepts.md).

## Find a run and its model in MLflow App

This workflow finds the MLflow record of a training run, to compare runs or retrieve a registered model.

*Prerequisites*: MLflow is installed in the environment of Training App; MLflow App is launched for the same user and workspace root.

1. Note the run name in **History** (for example `train_1a2b3c4d`).
2. Open MLflow App and select the experiment `training` (runs started from the interface). Runs started by the Orchestrator are in the experiment set by the pipeline.
3. Find the run: from the interface, the MLflow run name is the Training run name; from the Orchestrator, it is `<pipeline name>/<node label>`. The tag `training_run` always holds the Training run name.
4. Open the run: parameters (all hyperparameters, `engine`, `model_size`, `model_weights`, `data_yaml`), metrics per epoch, `final_mAP50` and `final_mAP50-95`, and the artifacts `plots/` (analysis plots) and `model/` (best weights).
5. In the model registry, the weights are registered under `<experiment>/<size>`, for example `training/yolox-s`: each finished run adds a version, tagged with the dataset name, the mAP values and the engine.

*Result*: the run is found with its full context. Metric names are slightly changed by MLflow rules (parentheses removed: `metrics/mAP50(B)` becomes `metrics/mAP50B`). The location of the store is described in [Configuration](configuration.md).

## Use the trained model in Inference App

This workflow hands the weights of a finished run to Inference App.

*Prerequisites*: a **Done** YOLOX run; Inference App is available.

1. In **History**, open the run and copy the **Best model** path (a `best_ckpt.pth` file).
2. Note the size of the run (column **Model**, for example `yolox-s`) and the class names of its `data.yaml`.
3. In Inference App, paste the path in the weights field, choose the engine **YOLOX** and type the same size in the architecture field.
4. To see class names instead of `class_0`, `class_1`..., set `class_names` in the YAML configuration of Inference App, in the order of `names` of the `data.yaml`.
5. To measure the model against annotations, use the evaluation of Inference App with the same `data.yaml`.

*Result*: Inference App runs the model on images and videos. Weights produced by an engine can only be loaded by the same engine: never use YOLOX weights with another engine.

## Train from an Orchestrator pipeline

This workflow runs Training App as the training step of an Orchestrator pipeline.

*Prerequisites*: Orchestrator App is running; the graph has a Training node connected to an Annotation node (or to a dataset source), optionally preceded by an Optuna node.

1. In the Orchestrator, configure the Training node: engine, size, epochs, batch, image size and optional hyperparameters. Choose manual or automatic mode.
2. Run the pipeline. The Orchestrator starts Training App if needed, with the orchestrator mode shown on the **Training** page.
3. In manual mode, the pipeline stops on a step asking you to train by hand: open Training App from the node link, start the run with the parameters of your choice, wait for **Done**, then click **Continue** in the Orchestrator.
4. In automatic mode, the Orchestrator sends the dataset path of the annotation export. Training App finds the `data.yaml` in that folder or its subfolders, or extracts a `.zip` export into `runs/<archive name>/` first. Best parameters of an upstream Optuna node override the node hyperparameters.
5. Follow the run under the node (the Orchestrator polls the run list) or in **History**, where it appears as `orch_<id>`.

*Result*: the Orchestrator receives the run name, the engine, the size, the best model path, the final mAP values and the resolved `data.yaml`, and passes them to the next nodes (evaluation, inference, DVC). The call waits for the end of the run, up to 90 minutes by default (see [Configuration](configuration.md) for the related variables).

## Delete a run and free disk space

This workflow removes runs you no longer need and reclaims their disk space.

*Prerequisites*: the runs are finished; you have access to the workspace folder of the backend machine.

1. Copy what you want to keep: the **Best model** file, and the plots if needed. MLflow keeps its own copy of the best weights and plots for finished runs.
2. In **History**, click the trash icon of the run and confirm. The run disappears from the list.
3. Open the workspace folder (`training_<user>` under the workspaces root) and delete `runs/<run name>/`: the interface does not remove it.
4. Also delete the folders `runs/<archive name>/` created when the Orchestrator extracted `.zip` datasets, once no pipeline needs them.

*Result*: the disk space is reclaimed. A YOLOX run folder holds one checkpoint per evaluation (`epoch_<N>_ckpt.pth`) besides `latest_ckpt.pth`, `last_epoch_ckpt.pth`, `best_ckpt.pth` and `last_mosaic_epoch_ckpt.pth`; with large models and many evaluations it can reach several gigabytes.
