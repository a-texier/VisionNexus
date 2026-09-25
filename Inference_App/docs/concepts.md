---
app: inference
doc_type: concepts
audience: user
lang: en
title: Concepts
order: 30
tags: [bytetrack, csrt, sot, mot, mAP, evaluation, detector plugin]
sources: [Inference_App/backend/inference_core/runner.py, Inference_App/backend/inference_core/bytetrack.py, Inference_App/backend/inference_core/detectors.py, Inference_App/backend/inference_core/evaluation.py, Inference_App/backend/inference_core/models.py]
---

# Concepts

## The three inference modes

Inference App reads a source frame by frame and, for each frame, runs one of three pipelines, chosen by mode:

- **infer** (Pure inference): the detector runs on every frame; every detection is drawn, with no link between frames.
- **mot** (Multi-object): the detector runs on every frame; with the tracker set to **Aucun**, the result is identical to pure inference; with **ByteTrack**, detections are additionally associated into tracks with a stable id.
- **sot** (Single-object by click): the detector runs once, on the first frame, to build the list of clickable detections; the one you click seeds an OpenCV CSRT tracker, which then runs alone on every following frame.

All three modes share the same detector call and the same drawing code; what differs is what happens to the detector's output before it is drawn (see [Architecture](architecture.md)).

## The detector: YOLOX and pluggable engines

The detector turns one image into a list of boxes, each with a class, a label and a confidence score. Inference App ships one detector, **YOLOX**, built on the exact same architecture code as Training App (`build_exp`, `load_checkpoint`): a checkpoint produced by a Training App run loads here unmodified, as long as the same size is selected.

**Confiance** (confidence) is the minimum score a detection needs to be kept; raising it removes weaker, less certain detections. **NMS IoU** is the overlap threshold used to remove duplicate boxes on the same object (non-maximum suppression): lowering it removes more overlapping duplicates, at the risk of removing two genuinely separate, overlapping objects.

Other detector engines can be added as plugins, discovered the same way as Training App's training engines but in a separate group (`visionnexus.detector_backends`). A plugin engine is only usable in Inference App if it also exists as a Training App training engine producing compatible weights, since Inference App never trains anything itself.

## ByteTrack: keeping an identity across frames

ByteTrack links detections of the same object across consecutive frames into a **track**, identified by a number shown as `#<id>` on the annotated output. It works in two passes per frame:

1. High-confidence detections (score at or above the high threshold) are matched to existing tracks by box overlap; a match updates the track, an unmatched high-confidence detection above the new-track threshold starts a new track.
2. Low-confidence detections (between the low and high thresholds) are matched only against tracks that found no high-confidence match in the first pass, letting a track survive a frame where the object was detected weakly (partial occlusion, motion blur) instead of being lost and re-numbered.

A track that finds no match for more than the buffer size of consecutive frames is dropped; a new detection of the same object afterward starts a new id. Two similar objects that cross paths can also swap ids if the overlap-based matching picks the wrong pairing. ByteTrack only reassociates detections the model already found: it cannot recover an object the detector missed on every frame.

## CSRT: following one clicked object

CSRT (Channel and Spatial Reliability Tracking, from OpenCV) follows the appearance of one object frame by frame without calling the detector again after initialization. In **SOT par clic** mode, the detector's first-frame output supplies the candidate boxes; clicking one selects it and hands its box to CSRT as the starting position.

CSRT adapts to moderate appearance change and short partial occlusions, but has no notion of "object class" or "confidence": once it starts tracking the wrong region (after a fast motion, a full occlusion, or two similar objects crossing), it keeps following that region with no automatic recovery. There is no way to reselect the object mid-video from the interface; a lost SOT run must be restarted from a frame where the object is cleanly visible.

## Detection evaluation: mAP, precision-recall, F1 and confusion matrix

Evaluation compares the model's predictions on the validation images of a `data.yaml` against their YOLO `.txt` ground-truth labels, using an independent metrics implementation similar in spirit to Training App's but not code-shared, so small numeric differences between the two apps' mAP values are expected.

- **IoU** (intersection over union): the overlap between a predicted box and a ground-truth box; a prediction counts as correct (a true positive) when its IoU with an unmatched ground-truth box of the same class reaches a threshold.
- **mAP50**: mean average precision at IoU 0.50, averaged over classes; whether objects are found with a roughly right box.
- **mAP50-95**: the mean of that average precision at ten IoU thresholds from 0.50 to 0.95; also rewards precise boxes, and is the primary quality score.
- **Precision-recall curve**: precision against recall at IoU 0.50, summarizing the tradeoff between missing objects and raising false alarms as the confidence threshold varies.
- **F1 curve**: the harmonic mean of precision and recall against the confidence threshold; its peak is a reasonable confidence threshold to use for inference on this model.
- **Confusion matrix**: at IoU 0.50 and a fixed confidence of 0.25, which class was predicted against which class was annotated, plus a background row (missed objects) and column (false alarms).

Evaluation always uses the `val` split of the `data.yaml`; it is a fixed, deterministic measurement, unlike a Training App run's mAP which reflects only the last evaluation epoch of training.

## Benchmark figures: fps and per-stage timing

Every inference run and tracker benchmark reports timing figures, distinct from the accuracy figures of an evaluation:

- **fps** (frames per second, overall): frames processed divided by the total wall-clock duration of the run, including I/O, drawing and writing the output.
- **detector fps** / **détecteur ms/frame**: time spent inside the detector only, isolating model speed from the rest of the pipeline.
- **tracker ms/frame**: time spent inside ByteTrack's association step only; 0 when no tracker runs.

These figures depend on hardware (GPU vs CPU, GPU model), image size, and model size, and are only meaningful compared against a run on the same machine and source.

## How the detector and the trackers work inside Inference App

Inference App runs one neural network, YOLOX, and two trackers that contain no neural network. This section describes the exact path of one frame, because several behaviors of the output follow from it.

### YOLOX at inference: letterbox, decoding, score and non-maximum suppression

The network is the one described in Training App: a CSPDarknet backbone, a path aggregation neck and a decoupled anchor-free head on three scales. At inference, the frame is resized to fit the test size of the model while keeping its proportions, and the remaining area is filled with gray (letterbox), so nothing is stretched; the ratio is remembered to bring the boxes back to the original frame. The head outputs, for every cell of the three maps, a box, an objectness and class probabilities. The score of a detection is the objectness multiplied by the probability of its best class, and the detection is kept when this score reaches **Confiance**. Overlapping detections of the same class are then merged by non-maximum suppression: the best box is kept and those whose IoU with it exceeds **NMS IoU** are dropped. Suppression is done per class, so two objects of different classes at the same place both survive.

The number of classes is read from the checkpoint itself, which is why a checkpoint from Training App loads without configuration, and why using the wrong size for a checkpoint fails to load instead of giving wrong boxes.

### The ByteTrack-style tracker: overlap matching without motion model

The tracker of Inference App is a compact two-pass association in the spirit of ByteTrack, not the full reference implementation. In each pass, every track is compared with every detection of the same class, the pairs are ranked by IoU, and the best pairs are taken one by one, each track and each detection being used once, as long as the IoU is above **match_thresh** (0.3 by default). The first pass uses the high-confidence detections; those that remain unmatched and score at least **new_track_thresh** (0.6 by default) start new tracks. The second pass lets low-confidence detections rescue the tracks that found nothing in the first pass.

There is no Kalman filter and no motion prediction: a track is compared with the last box it received, not with where the object should be now. This makes the tracker easy to reason about and cheap, but it means that a fast object, whose boxes no longer overlap from one frame to the next, loses its identity, and that a track is only kept through a detector gap for at most **track_buffer** frames (30 by default). Identities also never depend on the appearance of the object.

### CSRT: a correlation filter trained on the clicked box

CSRT is a classical tracker of OpenCV with no neural network. From the box selected at the first frame, it learns a correlation filter, that is a template of the object made of several feature channels (color, gradients), and it weights the channels and the pixels of the box by how reliable they are (channel and spatial reliability), which lets it ignore the background inside the box. At each frame, it searches for the position where the filter answers most strongly around the previous position, then updates the filter. It never calls the detector again, has no notion of class or confidence, and cannot recover after a full occlusion: it keeps following the region where the response is strongest, even when it is the wrong one.
