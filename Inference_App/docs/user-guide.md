---
app: inference
doc_type: user-guide
audience: user
lang: en
title: User guide
order: 10
tags: [interface, inference tab, evaluation tab, config tab, modes]
sources: [Inference_App/frontend/src/App.tsx, Inference_App/frontend/src/components/LanguageToggle.tsx, Inference_App/frontend/src/i18n/translate.ts, Inference_App/config/defaults.yaml]
---

# User guide

## Header and the shared input panel

Inference App is a single page with a header and two areas: a left sidebar of inputs shared by every tab, and the tab content on the right.

The header shows the **Inference** mark and three tab buttons: **Inférence**, **Évaluation** and **Config YAML**. The button at the right end shows the current language (**EN** or **FR**); click it to switch. When the app is opened from VisionNexus, the language chosen in VisionNexus is applied at load time and the switch only affects the current window; outside VisionNexus, the choice is saved to the workspace `settings.json` (see [Configuration](configuration.md)).

The sidebar, visible on every tab, holds:

- **Source image, video or folder**: the path of the media to read, as seen by the backend (for example `/srv/data/video.mp4` on a remote VM). Click **Read media** to load it; the result feeds the preview of the **Inférence** tab.
- **Weights file**: the path of the model checkpoint, as seen by the backend (for example a `.pth` file produced by Training App).
- **Engine**: a dropdown of the available detector engines (`GET /api/capabilities`, filtered to those marked available). `yolox` is always present; other entries come from installed plugins.
- **Architecture**: a free-text field for the model size (for example `yolox-s`), matching the engine's catalog. It is a plain text field, not a dropdown: type the exact size string.
- **Confiance** (Confidence) and **NMS IoU**: two number fields (0 to 1, step 0.05) applied to every run and evaluation.

These fields are prefilled from `config/defaults.yaml` of the workspace on page load (see [Configuration](configuration.md)); values you change here are used immediately for the next run but are not saved until you use the **Config YAML** tab.

## Inférence tab: modes and running the model

The **Inférence** tab runs the model on the source loaded in the sidebar.

Three mode buttons choose what happens to each frame:

- **Inférence pure** ("YOLO uniquement"): the detector runs on every frame; no identity is kept between frames.
- **Multi-objet** ("YOLO + tracker optionnel"): the detector runs on every frame; a **Tracker** row appears with **Aucun** (detections only) and **ByteTrack** (adds a stable object id per track).
- **SOT par clic** ("YOLO initialise CSRT"): the detector runs once on the first frame; click a detected object on the preview to select it, then OpenCV's CSRT tracker follows it on every following frame without calling the detector again.

Below the mode buttons, the preview shows the first frame of the loaded source. In **SOT par clic** mode, clicking the image places a cross marker at the clicked point and selects the underlying detection; a placeholder message is shown instead of the preview until a source has been read. Below the preview, a line of text gives the media kind, width, height, frame count and frame rate.

Click **Lancer** (disabled until a source is loaded, weights are set, and, in SOT mode, a click was made) to start the run; the button reads "Traitement..." while it works. When it finishes, a result panel shows:

- Four figures: the number of **frames** processed, the overall **fps global**, the **détecteur** time per frame (ms) and the **tracker** time per frame (ms, 0 without a tracker).
- The output itself: a playable video if the source produced one, or the annotated image otherwise, both served from the run's output folder.

An error (unreadable source, missing weights, a SOT click that does not land on any detection) is shown in a red banner above the mode buttons.

## Évaluation tab: measuring a model against a dataset

The **Évaluation** tab computes standard detection metrics on the `val` split of a YOLO dataset, using the same **Weights file**, **Engine** and **Architecture** as the **Inférence** tab, and the same **Confiance** and **NMS IoU**.

1. Type the path of a `data.yaml` file (as seen by the backend) in the **data.yaml** field.
2. Click **Évaluer** (disabled until a `data.yaml` path and a weights path are both set); the button reads "Évaluation..." while it runs.
3. The result shows four figures (**mAP50**, **mAP50-95**, the number of **images**, and **fps**) and three plots: a precision-recall curve, an F1-versus-confidence curve, and a confusion matrix.

Evaluation always uses the `val` split of the given `data.yaml`; there is no way to choose another split from the interface (see [API reference](api-reference.md) for the underlying option). The meaning of each metric and plot is in [Concepts](concepts.md).

## Config YAML tab: editing the saved configuration

The **Config YAML** tab edits the raw YAML text that Inference App keeps for the current workspace, the same values that prefill the sidebar on page load.

1. The text area shows the current YAML (loaded from the workspace `config.yaml`, or the packaged defaults if none was saved yet).
2. Edit any field directly in the YAML text; the schema is described in [Configuration](configuration.md).
3. Click **Enregistrer et appliquer** (Save and apply). The file is validated (it must parse as a YAML object); on success, the sidebar fields (**Engine**, **Architecture**, mode, tracker, **Confiance**, **NMS IoU**) are updated to match the saved values immediately.

A YAML syntax error, or a document that is not an object, is shown in the red error banner and nothing is saved. The packaged `config/defaults.yaml` (not this tab) is also what the Orchestrator reads to build its own Inference node form; see [Workflows](workflows.md) for running the app from a pipeline.
