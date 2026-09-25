---
app: annotation
doc_type: readme
audience: both
lang: en
title: Annotation App
order: 0
tags: [annotation, segmentation, tracking, sam2, samurai, yolo, dataset]
sources: [Annotation_App/backend/main.py, Annotation_App/launcher.py, _lib/launcher_engine.py, Annotation_App/frontend/src/App.tsx]
---

# Annotation App

## What Annotation App does

Annotation App is the labeling tool of the Computer Vision suite. It turns raw images, image folders and videos into annotated datasets ready for training: bounding boxes, polygons and object tracks, organized by class and by sequence.

You can annotate by hand, or let AI models do most of the work and review their output:

- **Manual tools**: rectangle (bounding box) and polygon, with undo/redo, copy/paste and a per-frame annotation list.
- **SAM2 point prompts and SAM Auto**: click on an object to get a precise mask, or segment a whole frame automatically.
- **Text detection**: type `car. person.` and Grounding DINO or SAM3 finds every matching object, on one frame or on a range of frames.
- **Video tracking**: annotate one frame, then propagate the boxes or masks through the sequence with SAMURAI or SAM2, homography (XFeat or SIFT), optical flow, or text detection plus centroid matching.
- **Review**: a sparse timeline shows which frames are annotated, track lanes show where each object was followed, and blocks or whole tracks can be deleted in one click.
- **Export**: YOLO (detection and segmentation), COCO JSON, or the native `.ver` text format, one folder or file per sequence.

The app is built for heavy datasets (thousands of frames, 16-bit or infrared imagery) and for remote use: the backend and the models can run on a Linux GPU VM while the interface runs on a Windows workstation inside the VisionNexus launcher, with frame pixels read directly from the network share.

## Place of Annotation App in the suite pipeline

Annotation App sits between dataset selection and model training in the Computer Vision suite:

1. **Dataset Explorer** selects and exports a subset of images.
2. **Annotation App** creates a project from that subset (or from any folder, video or share path), annotates it and exports a dataset.
3. **Training App** trains a detector or segmenter on the exported YOLO or COCO dataset; **Optuna App** tunes its hyperparameters.
4. **Inference App** runs the trained model, and **MLflow App** and **DVC App** track runs and data versions.

The **Orchestrator App** can drive the first steps automatically: it asks Annotation App to create a project from a Dataset Explorer subset, waits while you annotate, then triggers the YOLO export into its own workspace. Annotation App also works standalone, without any other app running.

Each user gets an isolated workspace (`annotation_<user>` under the workspaces root) holding the database, the projects, the backups and the exports. The exact layout is described in the section *Workspace layout on disk* of [Configuration](configuration.md).

## Quick start in five steps

This quick start assumes the app is installed and launched from VisionNexus (or with `python launcher.py --app annotation --workspace <root> --user <name>` from the suite root). For installation, see [Configuration](configuration.md).

1. On the projects page, click **New project**, enter a name, choose **Sequence Image** for a video or an ordered image folder (or **Image Random** for unrelated images), then click **Create**.
2. In the annotation workspace, click **Import**, drop a folder or a video on the first slot (or type a server path such as `/srv/datasets/run01`), then click the import button at the bottom of the window. The import runs in the background.
3. Open the **Classes** tab on the right, click **+**, create a class, and select it so it becomes the active class.
4. Press `R`, draw a box around an object, then open the **Tracks** tab on the left and click **Propagate via SAMURAI** to follow it through the sequence.
5. Click **Export**, choose **YOLO**, **COCO JSON** or **.ver**, and click **Export**.

The interactive tutorial (**Interactive tutorial** button on the projects page) walks through the same steps on a demo project in about ten minutes.

## Documentation pages for Annotation App

The Annotation App documentation is split into nine pages. User pages come first, developer pages last.

- [User guide](user-guide.md): screen-by-screen tour of every page, panel, button and shortcut, and when to use each one.
- [Workflows](workflows.md): complete tasks from start to finish in numbered steps, from creating a project to exporting a dataset or running the app from an Orchestrator pipeline.
- [Concepts](concepts.md): projects, sequences, frames, tracks and classes, and a plain explanation of every algorithm (SAM2, SAMURAI, Grounding DINO, SAM3, homography, optical flow), with what each one is good and bad at.
- [Configuration](configuration.md): installation (online and offline), model weights, launch commands, ports, environment variables, workspace layout, and every option of the **Settings** window.
- [Troubleshooting](troubleshooting.md): known problems described by their symptom, with cause and solution.
- [Architecture](architecture.md): backend and frontend components, task and WebSocket model, storage, the image loading pipeline and its caches, and the invariants that must not be broken.
- [API reference](api-reference.md): HTTP and WebSocket endpoints grouped by domain.
- [Code map](code-map.md): where each feature lives in the code and where to change it.
