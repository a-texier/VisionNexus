---
app: training
doc_type: user-guide
audience: user
lang: en
title: User guide
order: 10
tags: [interface, training page, history, hyperparameters, progress, analysis]
sources: [Training_App/frontend/src/App.tsx, Training_App/frontend/src/pages/TrainingPage.tsx, Training_App/frontend/src/pages/RunsPage.tsx, Training_App/frontend/src/components/common/LanguageToggle.tsx, Training_App/frontend/src/i18n/translate.ts, Training_App/backend/services/yolox_catalog.py]
---

# User guide

## Navigation bar and language of Training App

Training App has two pages, reached from the navigation bar at the top of the window:

- **Training**: configure and start a run, then follow it live. The app opens on this page.
- **History**: the list of all runs of your workspace, with a detail window per run.

The button at the right end of the bar shows the current language (**EN** or **FR**); click it to switch. When the app is opened from VisionNexus, the language chosen in VisionNexus is applied at load time and the switch only affects the current window. When the app runs outside VisionNexus, the choice is saved in the workspace settings (see [Configuration](configuration.md)).

Under the title, the subtitle of the **Training** page reminds the engine of the current form (for example "Training YOLOX") and the mode of the app: **solo mode** when you enter the dataset yourself, **orchestrator mode** when the app was started by an Orchestrator pipeline.

## Training page: model panel

The model panel, at the top left of the **Training** page, chooses what will be trained. Its title shows the engine label, for example **Model YOLOX**.

- **Engine**: one button per available training engine. This row only appears when more than one engine is available, that is when an engine plugin is installed. Changing the engine reloads the sizes, the hyperparameter form and its default values, and clears **Starting weights (optional)**. The note under the buttons reminds that weights can only be reloaded by the engine that produced them.
- An amber line "<engine> unavailable: <reason>" appears for each engine that is installed but cannot be used (missing library, unreadable catalog). The other engines keep working.
- **Size**: one button per model size of the engine. For YOLOX the buttons read `nano`, `tiny`, `s`, `m`, `l` and `x`; the line **Model:** under them gives the full name (`yolox-s` by default). Sizes are compared in [Concepts](concepts.md).
- **Starting weights (optional)**: path of a weights file on the backend machine. Empty means the engine default: for YOLOX, the placeholder reads "empty = train from scratch (.pth)", so the model starts from random weights. A file with another extension than the one of the engine is refused when you click **Start**.

Only files reachable by the backend can be used: when the backend runs on a remote VM, type a path of the VM, not of your workstation.

## Training page: YOLO Dataset panel and run buttons

The **YOLO Dataset** panel, under the model panel, tells the app which data to train on.

- **data.yaml path**: path of the `data.yaml` file of the dataset, as seen by the backend (for example `C:/data/dataset/data.yaml` or `/srv/datasets/run01/data.yaml`). The expected format is described in [Concepts](concepts.md) and a preparation procedure is in [Workflows](workflows.md).
- **Dataset name (optional)**: a readable name stored with the run. It is shown under the run name in the **History** table and in the run detail, and is attached as the `dataset` tag of the model version registered in MLflow. It does not change the run name, which is always generated (`train_` followed by 8 hexadecimal characters).
- In orchestrator mode, a blue box reads "Orchestrator mode - path provided automatically." and shows the runs folder of the workspace. You can still start manual runs from the page.

Under the panels:

- **Start** launches the run. It is disabled while a run started from this page is in progress (its label becomes **Running...**), while **data.yaml path** is empty, or while the engine catalog is loading. A notification "Run started: <run name>" confirms the start. If some hyperparameters are unknown to the engine, a second notification lists them ("Parameters ignored by this engine: ..."). If the backend refuses the request (missing `data.yaml`, invalid size, incompatible weights), its message is shown in red.
- **Stop** appears while the run is in progress. It asks the backend to stop the run after the current training iteration, shows "Run stopped" and marks the progress panel **Stopped**. The run then appears as **Stopped** in **History**.

## Training page: Hyperparameters panel

The **Hyperparameters** panel, on the right of the **Training** page, shows the training settings of the selected engine, grouped in collapsible sections. Click a group title to open or close it. For YOLOX, **Training** and **Data augmentation** are open by default and **Optimizer** is closed.

Every field is prefilled with the default value of the engine catalog. Numbers are typed in number fields with the minimum, maximum and step of the catalog; yes/no settings (such as **EMA** or **FP16 (mixed precision)**) are `true` / `false` lists; text settings (**Device**, **Scheduler**) are free text. Leaving a field empty sends nothing for it, so the engine default applies. A value that is not a number in a number field is sent as 0.

The fields of the YOLOX form are:

- **Training**: **Epochs**, **Warmup epochs**, **No mosaic/mixup (final, ep.)**, **Eval interval (ep.)**, **Log interval (iter.)**, **Batch size**, **Image size**, **Workers**, **Device**, **FP16 (mixed precision)**.
- **Optimizer**: **LR per image**, **Scheduler**, **Warmup LR**, **Min LR (ratio)**, **Weight decay**, **Momentum**, **EMA**.
- **Data augmentation**: **Rotation (°)**, **Translation**, **Shear (°)**, **Perspective**, **HSV jitter prob.**, **Flip prob.**, **Mosaic prob.**, **Mixup prob.**, **Mixup enabled**.

The meaning, default value and effect of each field are explained in [Concepts](concepts.md), sections *YOLOX hyperparameters: training and optimizer* and *YOLOX hyperparameters: data augmentation*. A few engine settings are not in the form (the seed and the scale ranges of mosaic and mixup): they always keep their default value.

## Training page: Progress panel during a run

The **Progress** panel appears above **Hyperparameters** once you click **Start**, and follows the run live through a stream of events from the backend.

- The first line gives the run name, "Epoch N / total" and the state: **Running** (blue), **Done** (green), **Error** (red) or **Stopped**.
- The progress bar fills with the percentage of epochs completed.
- The metric tiles show the values sent at the end of the last epoch, with four decimals. For YOLOX: the training losses `total_loss`, `iou_loss`, `l1_loss`, `conf_loss` and `cls_loss`, plus, on the epochs where the model is evaluated, `metrics/mAP50(B)`, `metrics/mAP50-95(B)`, `metrics/precision(B)` and `metrics/recall(B)`. On epochs without evaluation, only the losses are shown. `l1_loss` stays at 0 until the final epochs without augmentation. These values are explained in [Concepts](concepts.md).
- When the run ends, a green box shows **Model saved:** with the path of the best weights, and the final **mAP50** and **mAP50-95**.
- If the run fails, the error message of the backend is shown in red.

The panel only lives in the current page: if you switch to **History** or reload the window, it disappears, while the run continues on the backend. Follow it from the **History** page, which refreshes every five seconds.

## History page: runs table

The **History** page lists every run recorded in the workspace, whether it was started from the interface, from the Orchestrator or directly through the API. The header shows the number of runs and a **Refresh** button; the list also refreshes automatically every five seconds.

Each row shows:

- **Run**: the run name (`train_...` for runs started from the interface, `orch_...` for runs started by the Orchestrator) and, below it, the dataset name when one was given.
- **Model**: the model size and, below it, the engine.
- **Status**: **Pending**, **Running** (with a small progress bar), **Done**, **Error** or **Stopped**.
- **mAP50** and **mAP50-95**: the values of the latest evaluation, or of the final validation when the run is done ("-" before the first evaluation).
- **Duration**: from the start to the end of the run; empty while it runs.
- **Created**: the creation date, in day/month/year format.
- A trash icon (**Delete**): after confirmation ('Delete run "<name>"?'), removes the run from the list. The run folder with its weights and plots stays on disk, and the MLflow run is not affected.

Runs are listed from the oldest at the top to the most recent at the bottom. Click a row to open its detail window.

## Run detail window: status, metrics and curves

The run detail window opens when you click a row of the **History** table. Close it with the cross at the top right.

The top of the window shows the run name and a status line: state, engine and size, dataset name, and **Duration:**. Two tiles give **mAP50** and **mAP50-95** as in the table.

Two charts follow when the run has at least two epochs recorded in its `results.csv` file:

- **mAP evolution per epoch**: mAP50 (green) and mAP50-95 (blue) at each evaluated epoch. Epochs without evaluation are skipped, so the line joins the evaluation points.
- **Losses (train)**: the box loss (amber) and the classification loss (red) per epoch. For YOLOX, the box loss is `iou_loss`.

The charts refresh every ten seconds, so they can be used to follow a run in progress.

The lower part of the window shows the progress bar ("current / total epochs"), the `data.yaml` path, **Best model** (path of the weights file kept at the end of the run), the error message if the run failed, the **Hyperparameters** actually used (the defaults of the engine merged with your values) and the **Created**, **Started** and **Finished** dates.

## Run detail window: Model analysis gallery

The **Model analysis** section of the run detail window appears only for runs in the **Done** state. It shows the analysis plots written by the engine in the run folder, grouped by category. Click an image to open it at full size in a new window.

For a YOLOX run, the sections are:

- **Confusion matrix**: how validation objects were classified, including missed objects and false alarms.
- **PR / P / R / F1 curves**: precision-recall curve, and precision, recall and F1 as a function of the confidence threshold.
- **Label distribution**: number of boxes per class and scatter of box widths and heights.
- **Training batches (augmented)**: a grid of training images after mosaic, mixup, color jitter and flip, as the network sees them.
- **Validation** ground truth and predictions: the same sample of up to 16 validation images with the annotated boxes, then with the boxes predicted by the model.

How to read each plot is explained in [Concepts](concepts.md), section *Analysis plots of a YOLOX run*. Another engine may add a **Training summary** section. When no plot exists, the message "No analysis plot (run not finished or plots disabled)." is shown; when the engine of the run is no longer installed, the reason is shown in amber instead.

## Run detail window: best and worst inference cases

The **Inference - best / worst cases** block of the run detail window runs the best model of a finished run on the validation images and shows where it does well and where it struggles.

1. Click **Analyze best / worst cases (inference on the validation set)**. The message "Inference in progress on validation images..." is shown while the backend works.
2. The result gives the number of images evaluated (at most the first 200 validation images), then two grids of four annotated images:
   - **Best cases (clean detections, high confidence)**: images with detections and the highest mean confidence.
   - **Worst cases (nothing detected / low confidence)**: images without any detection first, then those with the lowest mean confidence.
3. Each image shows the predicted boxes with class and confidence; its caption gives the file name, the number of detections and the mean confidence. Click an image to open it at full size.

The result is computed once and saved in the run folder (`inference_cases/`); opening the block again shows the saved result. The ranking is based on confidence only, not on the ground truth: an image with confident false detections can appear among the best cases. For a measure against the ground truth, use the evaluation of Inference App.
