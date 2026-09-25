---
app: inference
doc_type: workflows
audience: user
lang: en
title: Workflows
order: 20
tags: [inference, tracking, evaluation, orchestrator, config]
sources: [Inference_App/frontend/src/App.tsx, Inference_App/backend/main.py, Inference_App/backend/inference_core/runner.py, Inference_App/backend/inference_core/evaluation.py, Inference_App/backend/config.py]
---

# Workflows

## Run pure inference on an image or a video

This workflow runs a trained model on a source and saves the annotated result, without tracking.

*Prerequisites*: a `.pth` YOLOX checkpoint reachable from the backend (for example the best model of a Training App run); a source image, video or folder of images reachable from the backend.

1. In the sidebar, type the source path in **Source image, video or folder** and click **Read media**. The preview and the media information line appear.
2. Type the checkpoint path in **Weights file**, keep **Engine** at `yolox`, and set **Architecture** to the same size the checkpoint was trained with (for example `yolox-s`).
3. Adjust **Confiance** (raise it to keep fewer, more certain detections) and **NMS IoU** (lower it to remove more overlapping duplicates) if needed.
4. On the **Inférence** tab, click **Inférence pure**, then **Lancer**.
5. Read the result: frame count, overall fps, detector time per frame, and the annotated image or video.

*Result*: an annotated file is written to the run's output folder (`result.mp4` for a video source, `result<ext>` for an image), and the interface plays or displays it directly.

## Track objects across a video with ByteTrack

This workflow gives each detected object a stable identity through a video, for counting or trajectory analysis.

*Prerequisites*: same as the previous workflow, with a video or an image sequence as source (ByteTrack needs several frames to be useful).

1. Load the source and set the weights as in the previous workflow.
2. Click **Multi-objet**. A **Tracker** row appears.
3. Click **ByteTrack**.
4. Click **Lancer**.
5. In the result, the tracker time per frame is now non-zero; the annotated output shows a `#<id>` prefix on each box, stable across frames while the object stays detected with reasonable confidence.

*Result*: the same output as pure inference, with persistent object identities. An identity can still change if the object is lost for longer than the tracker's buffer, or when two similar objects cross paths (see [Concepts](concepts.md)).

## Track a single object by clicking it

This workflow follows one chosen object through a video without relying on the detector after the first frame, useful when the detector is unreliable on later frames (motion blur, partial occlusion) but the object is visually trackable.

*Prerequisites*: a video source; the object of interest must be detected by the model on the first frame.

1. Load the source and set the weights.
2. Click **SOT par clic**. The preview becomes clickable.
3. Click directly on the object you want to follow; a cross marker appears, and the detection under the click is selected (the click must land inside a detected box, not just near the object).
4. Click **Lancer**.
5. The result plays the tracked object with a highlighted box and its class label; CSRT runs on every frame after the first without calling the detector again.

*Result*: a video following one object, robust to changes the detector alone might miss, but unable to recover automatically if CSRT drifts off the object (see [Troubleshooting](troubleshooting.md)).

## Evaluate a model on a YOLO dataset

This workflow measures a trained model's detection quality (mAP, precision-recall, confusion matrix) on a labeled validation set.

*Prerequisites*: a `data.yaml` describing a YOLO dataset with a `val` split of annotated images (for example a Training App or Annotation App export), reachable from the backend; the weights and engine to evaluate.

1. Set **Weights file**, **Engine** and **Architecture** in the sidebar as for inference.
2. Open the **Évaluation** tab and type the path of the `data.yaml` in the **data.yaml** field.
3. Click **Évaluer**.
4. Read **mAP50** and **mAP50-95**, and inspect the precision-recall curve, the F1-versus-confidence curve and the confusion matrix.

*Result*: `metrics.json`, `pr_curve.png`, `f1_curve.png` and `confusion_matrix.png` are written to a new run folder under `runs/` of the workspace, and shown inline in the tab. Only the `val` split is evaluated; to evaluate `test` instead, use the API directly (see [API reference](api-reference.md)).

## Save default settings for the next session

This workflow makes the current sidebar values (engine, architecture, mode, tracker, confidence, IoU) the defaults shown the next time the app opens.

*Prerequisites*: none.

1. Set the sidebar fields, and the mode and tracker on the **Inférence** tab, the way you want them to default.
2. Open the **Config YAML** tab: the text area already reflects the values currently in memory only if you have not reloaded the page since changing them; otherwise edit the YAML fields directly (`engine`, `model_size`, `mode`, `tracker`, `confidence`, `iou`, plus any tracking-specific field from [Configuration](configuration.md)).
3. Click **Enregistrer et appliquer**.

*Result*: `config.yaml` is written in the workspace; the next time the app is opened for this workspace, the sidebar and mode start from these values. This does not affect the Orchestrator's own node configuration, which reads the packaged `config/defaults.yaml` of the app instead (see the next workflow).

## Run Inference App from an Orchestrator pipeline

This workflow runs Inference App as the inference or evaluation step of an Orchestrator pipeline.

*Prerequisites*: Orchestrator App is running; the graph has an Inference node connected to a Training node (for the model) and a source of media or a dataset.

1. In the Orchestrator, configure the Inference node: engine, model size, mode (tracking or evaluation), and the overrides taken from `config/defaults.yaml`'s groups (thresholds, tracker parameters).
2. Run the pipeline. The Orchestrator calls `POST /api/orchestrator/infer` (tracking, headless mode) or `POST /api/orchestrator/evaluate` (detection or tracker benchmark) directly; Inference App does not need its own interface open for this.
3. For a tracking node, the Orchestrator passes the model path resolved from the upstream Training node, the sequence directory, and the tracker choice; the call blocks until inference finishes and returns benchmark figures (fps, detections, unique tracks).
4. For an evaluation node, the Orchestrator passes `data_yaml` (resolved from the Training node's dataset when available) and evaluation overrides; the call returns the same metrics shown in the **Évaluation** tab.

*Result*: the pipeline receives benchmark or evaluation figures for the next nodes or for the pipeline report, without any manual step in Inference App. See [API reference](api-reference.md) for the exact request and response shapes.
