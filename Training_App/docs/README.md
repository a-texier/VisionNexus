---
app: training
doc_type: readme
audience: both
lang: en
title: Training App
order: 0
tags: [training, yolox, object detection, engines, mlflow, orchestrator]
sources: [Training_App/backend/main.py, Training_App/frontend/src/App.tsx, Training_App/launcher.py, _lib/launcher_engine.py]
---

# Training App

## What Training App does

Training App trains object detection models for the Computer Vision suite. You give it a dataset described by a `data.yaml` file, choose a model size and its hyperparameters, and the app trains the model in the background while showing the progress epoch by epoch.

Main features:

- **YOLOX engine built in**: six model sizes, from `yolox-nano` to `yolox-x`, trained by an in-house trainer built on the vendored YOLOX code (Apache-2.0). No external training library is needed.
- **Pluggable engines**: other training engines can be installed as plugins. The engine is chosen per run; when only YOLOX is installed, no engine choice is shown.
- **Complete hyperparameter form**: epochs, batch size, image size, learning rate schedule, optimizer and data augmentation, with the defaults of the engine.
- **Real-time follow-up**: losses and detection metrics (mAP50, mAP50-95, precision, recall) are streamed to the interface at the end of each epoch.
- **History and analysis**: every run is kept with its parameters, its curves, its analysis plots (confusion matrix, precision-recall curves, label distribution, augmented batches, validation predictions) and an on-demand best/worst case inference on the validation images.
- **MLflow tracking**: each run is logged automatically (parameters, metrics per epoch, plots, weights and a registered model version) in the MLflow store of the user, readable by MLflow App.

Training App runs standalone, or as the training step of an Orchestrator pipeline, in which case the dataset and the parameters are provided automatically.

## Place of Training App in the suite pipeline

Training App sits after annotation and before inference in the Computer Vision suite:

1. **Dataset Explorer** selects images, **Annotation App** annotates them and exports a YOLO dataset (a folder with a `data.yaml`).
2. **Training App** trains a detector on that dataset. **Optuna App** can search its hyperparameters with the same engines and catalogs.
3. **Inference App** runs the trained weights on images and videos and evaluates them on a dataset.
4. **MLflow App** shows the runs and model versions logged by Training App; **DVC App** versions the datasets.

The **Orchestrator App** chains these steps: its Training node calls Training App, waits for the end of the run and passes the resulting weights and the resolved `data.yaml` to the next nodes.

Each user has an isolated workspace (`training_<user>` under the workspaces root) holding the run database, the run folders and the settings. The layout is described in [Configuration](configuration.md).

## Quick start in five steps

This quick start assumes the app is installed and launched from VisionNexus, or with `python launcher.py --app training --workspace <root> --user <name>` from the suite root (see [Configuration](configuration.md)).

1. Export a YOLO dataset from Annotation App, or prepare a folder with `images/`, `labels/` and a `data.yaml` (see [Workflows](workflows.md)).
2. On the **Training** page, choose a size in **Size** (for example `s`), and type the path of the `data.yaml` in **data.yaml path**.
3. Open the **Training** group of **Hyperparameters** and set **Epochs** (for example 50) and **Batch size** according to your GPU memory.
4. Click **Start**. The **Progress** panel shows the current epoch, the progress bar and the latest metrics.
5. When the run is **Done**, open the **History** page and click the run to see its curves, its analysis plots and the path of the best model.

## Documentation pages for Training App

The Training App documentation is split into nine pages. User pages come first, developer pages last.

- [User guide](user-guide.md): every page, panel, field and button of the interface.
- [Workflows](workflows.md): complete tasks in numbered steps, from preparing a dataset to fine-tuning, analyzing a run, finding it in MLflow and running a pipeline.
- [Concepts](concepts.md): runs, engines, model sizes, hyperparameters, evaluation, mAP and the other metrics, checkpoints and plots, explained simply.
- [Configuration](configuration.md): requirements, launch commands, ports, environment variables, workspace layout, weights, MLflow store and plugins.
- [Troubleshooting](troubleshooting.md): known problems by symptom, with cause and solution.
- [Architecture](architecture.md): components, engine contract, run lifecycle, event stream, YOLOX trainer, MLflow logging and invariants.
- [API reference](api-reference.md): HTTP and SSE endpoints, including the Orchestrator contract.
- [Code map](code-map.md): where each feature lives in the code and where to change it.
