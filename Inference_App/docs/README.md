---
app: inference
doc_type: readme
audience: both
lang: en
title: Inference App
order: 0
tags: [inference, yolox, tracking, bytetrack, evaluation, mAP]
sources: [Inference_App/backend/main.py, Inference_App/frontend/src/App.tsx, _lib/launcher_engine.py]
---

# Inference App

## What Inference App does

Inference App runs a trained YOLO model on an image, a video or a folder of images, and measures how good the model is. It is deliberately small and self-contained: one page, three modes, one detector engine built in.

- **Pure inference**: run the detector on every frame, with no tracker on top, to inspect and benchmark the model itself.
- **Multi-object (MOT)**: the same detector, with an optional ByteTrack association pass that keeps a stable identity per object across frames.
- **Single-object (SOT) by click**: click a detection on the first frame; OpenCV's CSRT tracker follows that object afterward without calling the detector again.
- **Detection evaluation**: mAP50, mAP50-95, a precision-recall curve, an F1 curve and a confusion matrix, computed on a YOLO dataset's validation split.
- **Engine YOLOX built in**, reusing Training App's own architecture code so a checkpoint trained there loads here unmodified. Other detector engines can be added as plugins.

The interface reads and writes the media, the weights path and the evaluation dataset as plain paths on the backend machine; nothing is uploaded through the browser.

## Place of Inference App in the suite pipeline

Inference App is the last step of the detection pipeline in the Computer Vision suite:

1. **Annotation App** produces a labeled dataset; **Training App** trains a YOLOX (or plugin-engine) model on it.
2. **Inference App** runs that trained model on new images or video, with or without tracking, and evaluates it against a validation set.
3. **MLflow App** and **DVC App** track the runs and datasets used along the way; the **Orchestrator App** can chain annotation, training and inference automatically.

Inference App has no workspace of shared state beyond its own run outputs: it takes a weights path and a source path, and writes its results to its own `runs/` folder. See [Configuration](configuration.md) for the workspace layout.

## Quick start in five steps

This quick start assumes the app is installed and launched from VisionNexus, or with `python launcher.py --app inference --workspace <root> --user <name>` from the suite root (see [Configuration](configuration.md)).

1. In **Source image, video or folder**, type the path of a video, an image or a folder of images reachable by the backend, then click **Read media**.
2. In **Weights file**, type the path of a `.pth` YOLOX checkpoint (for example the best model of a Training App run); leave **Engine** at `yolox` and **Architecture** at the matching size (`yolox-s` by default).
3. Choose a mode: **Pure inference**, **Multi-object** (optionally with **ByteTrack**), or **Click SOT** (then click the object on the preview).
4. Click **Run** and wait for the result: the annotated image or video, plus frames-per-second figures.
5. To measure the model instead, open the **Evaluation** tab, type the path of a `data.yaml`, and click **Evaluate**.

## Documentation pages for Inference App

The Inference App documentation is split into nine pages. User pages come first, developer pages last.

- [User guide](user-guide.md): the three tabs of the interface, field by field.
- [Workflows](workflows.md): complete tasks in numbered steps, from a first inference to an Orchestrator-driven evaluation.
- [Concepts](concepts.md): inference modes, ByteTrack, CSRT, detection metrics and the engine plugin contract, explained simply.
- [Configuration](configuration.md): installation, launch commands, ports, environment variables, workspace layout and the `config.yaml` schema.
- [Troubleshooting](troubleshooting.md): known problems by symptom, with cause and solution.
- [Architecture](architecture.md): components, the detector contract, the inference and evaluation pipelines, and the invariants that must not be broken.
- [API reference](api-reference.md): HTTP endpoints, including the Orchestrator contract.
- [Code map](code-map.md): where each feature lives in the code and where to change it.
