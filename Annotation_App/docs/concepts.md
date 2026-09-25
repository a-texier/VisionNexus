---
app: annotation
doc_type: concepts
audience: user
lang: en
title: Concepts
order: 30
tags: [sam2, samurai, grounding dino, sam3, homography, optical flow, tracks, classes]
sources: [Annotation_App/backend/services/sam_service.py, Annotation_App/backend/models/routers/annotation.py, Annotation_App/backend/services/grounding_service.py, Annotation_App/backend/services/sam3_service.py, Annotation_App/backend/services/homography_service.py, Annotation_App/backend/services/interpolation_service.py, Annotation_App/backend/models/routers/tracking.py, Annotation_App/backend/models/annotation.py, Annotation_App/backend/models/sequence.py, Annotation_App/backend/models/track.py, Annotation_App/backend/models/label_class.py, Annotation_App/backend/utils/image_utils.py, Annotation_App/backend/ext/samurai_repo/sam2/sam2/configs/samurai/sam2.1_hiera_s.yaml]
---

# Concepts

## Projects and project types in Annotation App

A project is the unit of work of Annotation App: a named set of frames, the classes used to label them, their annotations and their tracks. Projects live in the user's workspace; each one has its own folder under `projects/<id>/`.

A project has one of two types, chosen at creation and fixed afterwards:

| Type (label) | Stored value | Use it for | Tools |
|---|---|---|---|
| **Image Random** | `image` | Unrelated images (photos, crops, scraped data) | Manual tools, SAM2, text detection, export |
| **Sequence Image** | `video` | Videos and ordered image folders (time series) | Everything above plus the Tracks panel (SAMURAI, Detect., homography, optical flow), the Debug tab and the track lanes |

Both types support several sequences, the timeline, the LUT, import of existing annotations, backup and all export formats. The only difference is the availability of the temporal tools, which assume that consecutive frames show the same scene. Choosing **Sequence Image** for unordered images gives no benefit; choosing **Image Random** for a video removes the propagation tools, so pick **Sequence Image** whenever order matters.

A project is deleted with all its database records (frames, annotations, tracks, classes, session). Source images referenced by symbolic link, and exports already produced, are not deleted.

## Sequences and multi-sequence projects

A sequence is one imported source inside a project: an image folder, a video, or a file of an optional specific format. Each import creates a new sequence, so a project can mix, for example, three videos and two infrared image folders.

Each sequence has a name, a source type (`images`, `video` or a specific format), its source path, its first global frame index, its number of frames, and optionally its frame rate and its own display LUT. Frames of a new sequence are appended after the existing frames of the project, and their files get a per-sequence prefix (`s001_frame_000000.jpg`) so that two imports never collide.

The sequence is the working scope of the interface: the slider, the frame counters, the **go to** field, the timeline and the track lanes only show the current sequence. Tracks are also numbered per sequence, starting at 0 in each one.

The sequence name matters at export: it becomes the subfolder name (`<name>-yolo/`, `<name>-coco/`) or the file name (`<name>.ver`). Name sequences meaningfully at import time; the default is the folder or file name.

Projects created before multi-sequence support show their frames as a single pseudo-sequence called the main sequence. It works like any other sequence, except that its LUT can only be set at project level.

## Frames and frame indices

A frame is one image of a sequence. Annotation App stores frame metadata in the database (index, file name, size, sequence, annotated flag) and the pixels on disk; images are never stored in the database.

Each frame has a global `frame_index`, unique in the project, and a local position in its sequence. The interface shows local numbers starting at 1 (`12 / 450`) almost everywhere; exports use the local position too (1-based in `.ver`). Three places show the global index, starting at 0: the **Current frame** header of the Tracks panel (`#n`), the frame ranges of the **Tracks (N)** list, and the **From F** / **to F** range of the text detection batch.

Depending on the source, the pixels live in different places:

- **Server image folder**: symbolic links in `projects/<id>/frames/` point to the original files (zero copy). If links are not allowed, files are copied.
- **Uploaded images**: stored in `projects/<id>/frames/` in their original format.
- **Video**: frames are extracted in the background as JPEG (quality 85 by default) or lossless PNG into `projects/<id>/frames/`, optionally keeping one frame out of N. The canvas asks for extraction around the current frame first, so you can start before the extraction finishes.

16-bit PNG and TIFF sources are kept as they are. For display and for the models, an 8-bit version is computed through the display LUT and cached; the source is never modified.

A frame is marked annotated as soon as it holds at least one annotation; this is what turns its timeline cell green and what the project statistics count.

## Classes and the three-level class hierarchy

A class is the label given to an annotation. Classes belong to a project and each one has a color, used on the canvas, in the lists and on the track lanes.

A class can have up to three levels:

1. **Class (detection)**, required: what the object is at the coarsest level, for example `drone`.
2. **Subclass (recognition)**, optional: a finer category, for example `quadcopter`.
3. **Sub-subclass (identification)**, optional and only when a subclass exists: the precise identity, for example `mavic`.

Exports use the hierarchy differently:

- **YOLO** and **COCO** have a flat list of categories. The full name joins the levels with underscores (`drone_quadcopter_mavic`), and each distinct class of the project becomes one category (0-based index in YOLO, 1-based `category_id` in COCO).
- **.ver** keeps the three levels in three separate columns.

Every annotation needs a class, and the tools that create annotations (drawing, SAM, text detection) use the active class selected in the **Classes** tab. When annotations are imported from a `.ver` file or a YOLO folder, missing classes are created automatically (YOLO class names come from `classes.txt` or a `.yaml` file when present, otherwise `classe_<i>`).

## Annotations: boxes, polygons and masks

An annotation is one labeled object on one frame. Annotation App stores two geometric types:

- **Bounding box**: an axis-aligned rectangle, drawn with **Rectangle** or produced by most AI tools in **BBox** mode.
- **Polygon**: an outline made of points, drawn with **Polygon** or produced from a mask in **Seg** / **Segmentation** mode. A polygon also stores its enclosing box.

Masks are an intermediate result, never stored as such. SAM2, SAMURAI and SAM3 produce pixel masks; the app converts each mask either to its bounding box or to a polygon simplified with the Douglas-Peucker algorithm (tolerance proportional to the contour length), keeping the largest outline. SAM2 and SAMURAI polygons have at most 100 points, Grounding DINO boxes refined by SAM2 at most 64; SAM3 uses a finer tolerance (0.5 % of the contour length) without a point limit.

What to choose:

| Need | Choose |
|---|---|
| Object detection training (YOLO detect, COCO boxes) | Boxes |
| Instance segmentation training (YOLO segment, COCO segmentation) | Polygons |
| Fast review of many frames | Boxes (lighter to display and correct) |
| Thin, rotated or irregular objects | Polygons |

Exports adapt automatically: YOLO writes boxes for every annotation and additionally a segmentation variant when polygons exist; COCO includes the polygon as `segmentation`; `.ver` only stores boxes. Propagation by homography or optical flow only moves the enclosing box: from a polygon it produces an annotation that keeps the polygon type but has no outline points.

## Normalized coordinates and annotation provenance

Annotation App stores every annotation in normalized YOLO coordinates: the box center `cx, cy` and size `w, h` as fractions of the image width and height, between 0 and 1. Polygon points are normalized the same way. Pixel values are only computed for display and for the pixel-based export formats (COCO and `.ver`). This makes annotations independent of the resolution at which a frame is displayed or processed.

Each annotation also records where it came from:

| Field | Meaning |
|---|---|
| `confidence` | Score between 0 and 1; 1.0 for manual annotations |
| `is_auto` | True when produced by a model or a propagation (**AI** badge) |
| `is_interpolated` | True for homography and optical flow results (**Interp.** badge when not automatic) |
| `source_algorithm` | `sam_point`, `sam_auto`, `grounding_dino`, `sam3`, `samurai`, `sam2_video`, `guided_tracking`, `homography`, `optical_flow`, `imported`; older projects may contain `sam2_tracking`. Empty for boxes and polygons drawn by hand |
| `track_id` | The track the annotation belongs to, if any |

The provenance drives the **AI** filter and badges of the **Annots** tab and the Monitoring page, which compares automatic and manual work and counts automatic annotations that were later reworked or deleted.

## Tracks and track identifiers

A track links the annotations of one physical object across the frames of a sequence. It has a class, a color, a first and last frame, and a `track_uid`, the number shown as `#uid` in the interface and written in the `.ver` export.

Track numbers are per sequence: the first track of each sequence is `#0`. On a given frame, a new track takes the smallest free number.

Tracks are created by:

- drawing by hand in a **Sequence Image** project: every box or polygon drawn without a track gets one automatically, with the smallest number free on that frame; if a track with that number already exists in the sequence, the annotation joins it;
- SAMURAI and SAM2 video propagation, and the Detect. mode: each target keeps its track, or gets a new one;
- the track selector of the **Annots** tab (**+ new**);
- import of `.ver` files, which carry track ids.

Homography and optical flow copy the track of each source annotation (a source without a track gives results without one); text detection, SAM Point and SAM Auto never create or extend tracks.

On the timeline, each track is a lane. A block is a continuous stretch of frames where the track has annotations; blocks are separated by gaps where the object was lost or not processed. Deleting a block removes only that stretch; deleting a track removes it with all its annotations and renumbers the remaining tracks. **Clear all** in the Tracks panel removes the tracks but keeps their annotations, detached.

## Display LUT and the input pipeline of the models

The display LUT (look-up table) maps the raw pixel values of a frame to the 0-255 range shown on screen. It matters most for 16-bit and infrared imagery, whose useful information often occupies a narrow band of values.

Three modes exist: **Auto σ** stretches `[mean - Nσ, mean + Nσ]` (N = 3 by default), **Min-Max** stretches the real minimum and maximum of the frame, and **Manual** uses fixed low and high values. A LUT can be set per project and overridden per sequence; for each frame, the sequence LUT wins over the project LUT.

Every model uses the same input chain:

1. **Source**: 16-bit PNG or TIFF, 8-bit JPEG or PNG, or a specific format.
2. **LUT**: the effective LUT of the frame (sequence, else project) converts it to 8 bits. For SAMURAI, frames are written as JPEG quality 95 in a temporary folder of the project; an 8-bit JPEG that already fits is linked without re-encoding.
3. **Resize**: SAM2 and SAMURAI resize each frame to 1024 x 1024 without keeping the aspect ratio (the model was trained this way; coordinates are converted back with the original size).
4. **Tensor**: normalized, and computed in bfloat16 on GPU.

Practical consequence: adjusting the LUT changes what the model receives. On 16-bit imagery, a bad setting gives a crushed image, and the model works on the same flat picture that you see. Set the LUT before running detections or propagations. Changing a LUT invalidates the cached 8-bit images and previews of that project automatically.

## SAM2 image segmentation (points and auto)

SAM2 (Segment Anything Model 2) is a universal segmentation model: given an image and a prompt, it returns a precise mask of the object, whatever its class. Annotation App uses the `sam2.1_hiera_small.pt` checkpoint when present, with the tiny checkpoint as a lighter fallback, on GPU when available.

Two interactive uses:

- **SAM Point**: each left click is a foreground point (label 1), each right click a background point (label 0). The model returns up to three candidate masks after each point; a double-click accepts the best one, converted to a box or a polygon.
- **SAM Auto**: a grid of 32 points per side is sampled over the whole frame; masks with a predicted IoU below 0.88 or a stability score below 0.95, or smaller than 100 pixels, are dropped. The remaining masks are streamed over a WebSocket as proposals that you validate or reject.

SAM2 also refines Grounding DINO boxes into masks when text detection runs in **Seg** mode.

Limits: SAM2 segments "an object", not "a class": it has no idea what you want to label, so the class always comes from you. On low-contrast or cluttered scenes, a single point can select a part of the object or its surroundings; add background points to disambiguate. SAM Auto produces many small or overlapping masks: use NMS and the confidence filter afterwards.

## SAMURAI single-target video tracking

SAMURAI is the default tracker of the **SAMURAI** tab. It is not a different model but a fork of SAM2 video with the same weights (`sam2.1_hiera_small.pt`) and the same architecture; it adds a decision rule based on a Kalman filter. At each frame, SAM2 proposes several candidate masks with a confidence score. SAM2 alone takes the most confident one; SAMURAI takes the one that best reconciles confidence and consistency with the previous motion.

SAMURAI is shipped with the application in `backend/ext/samurai_repo/` and loaded automatically with SAM2. When it cannot be loaded, the tab falls back to standard SAM2 and says so in its badge.

Use it for one target over a long sequence, especially with partial occlusions, pose changes or nearby distractors. The prompt is the bounding box of the target on the reference frame. Propagation can run forward or backward from the reference frame.

### How SAMURAI chooses a mask with the Kalman filter

SAMURAI keeps a Kalman filter on the target box, with an 8-dimensional state in `xyah` space: center x, center y, aspect ratio, height, plus their four velocities. The motion model assumes constant velocity (one step per frame). Its noise is proportional to the box height (`_std_weight_position = 1/20`, `_std_weight_velocity = 1/160`), so a large object gets more absolute uncertainty than a distant one.

At each frame:

1. SAM2 proposes several masks, each with a predicted IoU.
2. The filter predicts the expected box from the previous state.
3. Each candidate gets a combined score `kf_score_weight x IoU_kalman + (1 - kf_score_weight) x IoU_model`. In the SAMURAI configuration used by the app, `kf_score_weight` is 0.25: the motion breaks ties, it does not decide alone.
4. The best combined score wins, not simply the most confident mask.
5. If the score is high enough, the filter is corrected with the chosen box. Otherwise the `stable_frames` counter falls back to 0 and the filter continues on pure prediction; it takes 15 consecutive good frames (`stable_frames_threshold`) to consider the target locked again.

The filter state belongs to the model, not to a tracked object: there is only one Kalman state in memory. That is why SAMURAI follows exactly one target. With several targets, the app switches to native multi-object SAM2 (in **Auto (fast)**) or runs one SAMURAI pass per target (**SAMURAI / object**), and resets the filter state before every run so that nothing leaks from one run to the next.

### SAMURAI memory, precision and parameters

SAMURAI and SAM2 video keep a memory bank of past frames. Cross-attention only looks at the 7 most recent memorized frames (`num_maskmem = 7`) plus the reference frame you annotated, so the cost per frame is constant and does not grow with the sequence length. SAMURAI also filters what enters this bank (`memory_bank_iou_threshold = 0.5`): a frame where tracking is doubtful is not memorized, which avoids poisoning the following frames.

Inference runs under `autocast(bfloat16)` on GPU for initialization, prompting and propagation alike. Without it, the fast attention kernels are refused and inference is 3 to 5 times slower; mixing precisions between steps would corrupt the memory bank. The video session is closed at the end of each run to release VRAM.

| Parameter | Value | Meaning |
|---|---|---|
| `image_size` | 1024 | Internal resolution applied to every frame |
| `num_maskmem` | 7 | Frames kept in the memory bank |
| `stable_frames_threshold` | 15 | Consecutive good frames before the target is considered locked again |
| `kf_score_weight` | 0.25 | Weight of the Kalman IoU in the mask selection score |
| `memory_bank_iou_threshold` | 0.5 | Minimum IoU for a frame to enter memory |
| Offload to CPU | off | Frames in RAM instead of VRAM (the **Fast GPU mode** setting unchecked): slower but needed for long ranges on a small GPU |

In fast GPU mode, VRAM limits the number of frames per run (about 350 to 450 frames at 1024 x 1024 on 10 GB); the Tracks panel shows an estimate for your GPU.

### SAMURAI assumptions and failure modes

SAMURAI works well as long as its assumptions hold. Each one, and what happens when it is wrong:

- **Motion is smooth, at nearly constant velocity.** If wrong: a sudden change of direction makes the prediction diverge and tracking drops.
- **The target stays visible or is only briefly occluded.** If wrong: after a long occlusion the filter has drifted too far to lock again.
- **The aspect ratio varies little.** If wrong: an in-plane rotation makes the box a poor descriptor of the object.
- **The starting box frames the object well.** If wrong: an approximate prompt locks an ambiguous target for the whole sequence.
- **The appearance stays comparable over 7 frames.** If wrong: a fast change of scale or lighting empties the memory of its usefulness.

When tracking drops, fix the box on the first wrong frame and propagate again from there: the corrected frame becomes the new reference.

## SAM2 video multi-object tracking and SAMURAI per object

SAM2 video is the tracker used automatically when several targets are propagated with **Auto (fast)**, and the only video tracker when SAMURAI is not available. Each object gets an identifier and its own set of masks, and the propagation is shared: one pass handles all objects, so there is no cost proportional to the number of objects.

The difference with SAMURAI fits in one sentence: SAM2 picks the mask it is most confident about, without asking whether that mask is plausible given the previous motion. On well-contrasted, isolated objects the difference is negligible. On two similar objects that cross, SAM2 can jump from one to the other where SAMURAI's Kalman filter would have rejected the jump.

**SAMURAI / object** works around the single-target limit differently: N independent passes, one session and one filter per target. Tracking quality is better on crossings and occlusions, at about N times the compute time.

Annotations record which tracker actually ran: `samurai` or `sam2_video`.

Assumptions of SAM2 video and their failure modes:

- **Objects stay distinguishable by appearance.** If wrong: two identical objects that cross swap identities.
- **Identities are fixed by the initial prompt.** If wrong: an object that enters mid-sequence is never tracked; annotate it on a later frame and run again.
- **A 7-frame memory is enough to keep the identity.** If wrong: a longer occlusion breaks the track with no way to recover.

## Grounding DINO text detection

Grounding DINO is an open-vocabulary detector driven by a text prompt. Annotation App uses the tiny model `IDEA-Research/grounding-dino-tiny`, loaded from `backend/checkpoints/grounding_dino/` when present, otherwise downloaded from Hugging Face on first use. It pairs a text encoder and an image encoder and returns the boxes whose representation matches the words of the prompt; the prompt does not need to belong to a predefined list of classes.

Two thresholds have two roles:

- **Box threshold** filters on the confidence of the box (default 0.30 in Settings).
- **Text threshold** filters on the strength of the association between the box and the prompt words (default 0.25).

Lower values maximize recall with more false positives. In the Detect. mode, low values are acceptable because the centroid matching then discards detections far from any target.

Write the prompt as concepts, not as a sentence: lowercase singular nouns separated by periods, such as `car . truck . person`. A full description degrades detection.

In **Seg** mode, each Grounding DINO box is refined into a mask by SAM2, then converted to a polygon. Annotations are created with the provenance `grounding_dino`.

Assumptions and failure modes:

- **The object belongs to the learned visual vocabulary.** If wrong: a very specific target (an industrial part, an infrared signature) is not found, whatever the prompt.
- **Each frame is independent.** There is no temporal consistency; identities only come from the centroid matching of the Detect. mode.
- **The visual domain is close to the training data.** If wrong: on infrared or badly remapped 16-bit imagery, scores collapse; fix the LUT first.

## SAM3 concept detection and segmentation

SAM3 (here SAM3.1, checkpoint `sam3.1_multiplex.pt` in `backend/checkpoints/sam3.1/`) is a standalone text-driven model: it takes an image and a text prompt and returns boxes, masks and scores in a single pass, without Grounding DINO and without SAM2. It is an alternative to Grounding DINO in the text detection bar, in the text batch and in the Detect. mode.

Its output can be boxes or segmentation polygons (**BBox** / **Seg** in the toolbar, **Output mode** in the Detect. tab). In the text detection bar, its batch and the Detect. mode, detections below a score threshold (default 0.25, the **Box:** field) are dropped; SAM3 has no text threshold. Annotations are created with the provenance `sam3`.

The choice between SAM3 and Grounding DINO is empirical: SAM3 usually behaves better on objects with sharp outlines and directly gives masks; Grounding DINO is lighter and often better on more abstract concepts.

SAM3.1 is a gated model on Hugging Face: its weights must be downloaded with an approved account (see [Configuration](configuration.md)). Without them, SAM3 requests fail with an explicit message.

Assumptions and failure modes:

- **The concept can be expressed in natural language.** If wrong: a purely visual distinction with no word for it stays out of reach.
- **Frames are independent.** Same lack of temporal continuity as Grounding DINO.

## Detect. mode: detection plus centroid matching

The Detect. mode (tab **Detect.**, also called guided tracking) continues selected targets with a text detector. It uses exactly the same models and calls as the text detection bar; only what happens after detection differs. The text bar keeps everything it finds, without tracks. Detect. keeps only the detections attached to a target.

For each frame of the range:

1. Grounding DINO or SAM3 produces N anonymous boxes.
2. For each target, the distance between its center and each box center is computed in normalized coordinates. The reference is the target's box on the previous processed frame, not the starting box.
3. Matching is greedy, target by target in order: each takes the closest free detection, only if it is closer than **Centroid dist.** (0.15 of the image by default).
4. A target with no detection under the threshold is recorded as a `missing` anomaly on that frame and leaves a gap in its track.
5. When the area of the matched box changes by more than **Max size var.** (0.5, that is plus or minus 50 %), the annotation is still created but the frame is recorded as a `size_variation` anomaly in the task result, which the interface does not display; this often means the box jumped to a neighboring object.
6. Unmatched detections are discarded: objects that are not targets are never added. Each target keeps its existing track or gets a new one.
7. With auto-stop enabled, the run stops when more than the given share of targets is lost for the given number of consecutive frames.

Annotations are saved with the provenance `guided_tracking`. The mode works well when targets stay close to their expected position and the prompt is reliable; it struggles with fast objects (raise the distance) and with crowded scenes of similar objects (identities can swap).

## Homography propagation with XFeat or SIFT

Homography propagation (tab **Homog.**) carries boxes from one frame to the next by estimating the global geometric transformation of the image, a 3 x 3 matrix. No detection network is involved: the boxes follow the camera motion (pan, tilt, zoom, rotation).

For each pair of consecutive frames, interest points are matched with XFeat on GPU (from `backend/models/xfeat/`), or with SIFT on CPU when XFeat is not available, then RANSAC estimates the matrix and separates consistent matches (inliers) from outliers. Each box is warped by the matrix.

| Parameter (interface) | Setting key | Default | Meaning |
|---|---|---|---|
| **Top-K pts** | `xfeat_top_k` | 2048 | Interest points extracted per image (XFeat) |
| **Min cossim** | `xfeat_min_cossim` | 0.82 | Minimum cosine similarity to accept a match (XFeat) |
| **Reproj. threshold** | `ransac_threshold` | 4.0 px | Tolerated reprojection error |
| **Min inliers** | `min_inlier_count` | 20 | Absolute number of inliers required |
| **Inlier ratio** | `min_inlier_ratio` | 0.3 | Required proportion of inliers |

When the estimate fails these thresholds, the homography of that step is rejected: a matrix computed from too few correspondences would produce aberrant boxes. The boxes are then copied unchanged to that frame. The confidence of each propagated box is the source confidence multiplied by `0.6 + 0.4 x inlier ratio`.

Assumptions and failure modes:

- **The scene is planar, or the camera rotates around its optical center.** If wrong: with parallax, a single matrix cannot describe the scene.
- **The object does not move relative to the scene.** If wrong: an object moving on its own does not follow the global transform; use optical flow.
- **The texture is sufficient.** If wrong: sky, sea or a uniform wall give no interest points and no homography.
- **Consecutive frames overlap a lot.** If wrong: fast motion leaves too few correspondences.

## Lucas-Kanade optical flow propagation

Optical flow propagation (tab **Opt. flow**) follows each box individually, which makes it the complement of homography: use it when the objects move and the camera does not.

For each box, 29 points are tracked from one frame to the next with pyramidal Lucas-Kanade: the four corners and a 5 x 5 grid inside the box (with a 15 % margin). From the points that were tracked successfully, the app fits a partial affine transform (translation, rotation and uniform scale) with RANSAC and applies it to the corners; the new box is the rectangle enclosing the transformed corners, so it grows or shrinks with the object. If the fit fails, the box is translated by the median displacement of the points. If fewer points than **Min pts** survive, the box is copied unchanged. Each object is processed separately, so several objects can move in different directions.

| Parameter (interface) | Setting key | Default | Meaning |
|---|---|---|---|
| **Window (px)** | `optflow_win_size` | 21 | Search window. Larger handles faster motion but is less precise; 15 to 21 for sharp scenes, 25 to 31 for compressed video |
| **Pyramid levels** | `optflow_max_level` | 3 | Each level doubles the manageable displacement; 2 above 30 fps, 4 for time-lapse |
| **Min pts** | `optflow_min_pts` | 4 | Minimum tracked points to move the box; 2 to 3 for small objects, 8 or more in low-texture areas |

Assumptions and failure modes:

- **Brightness constancy: a point keeps its intensity.** If wrong: a lighting change or a reflection loses the points.
- **The displacement stays within the search window.** If wrong: too fast for 21 px over 3 levels, tracking drops; raise the pyramid levels.
- **Neighboring points move together.** If wrong: on a deformable object, the fitted transform no longer describes the object.
- **The object is textured.** If wrong: a uniform surface provides no trackable point.

## Linear interpolation between keyframes

Linear interpolation fills the frames between two annotated keyframes of the same track by interpolating the box coordinates: for a frame at position `t` between the start (0) and the end (1), the box is `start + t x (end - start)` for `cx`, `cy`, `w` and `h` (polygons are resampled and interpolated point by point), and the confidence dips from 1.0 at the keyframes to 0.7 in the middle of the gap. Interpolated annotations are marked with the **Interp.** badge.

Interpolation is available through the API (`POST /api/projects/{id}/interpolate`, see [API reference](api-reference.md)) and is not exposed as a button in the current interface.

It assumes uniform motion between the two keyframes. It is suited to filling short gaps (5 to 20 frames) between two manual annotations of a slowly moving object; for curved trajectories or speed changes, optical flow or SAMURAI give better results.

## Choosing the right annotation or tracking method

Annotation App offers several ways to produce the same annotations. The right one depends on what moves and on what the models can recognize.

| Situation | Recommended method |
|---|---|
| One target, long sequence, occlusions | SAMURAI (**SAMURAI** tab, one target) |
| Several targets, well separated | SAM2 multi-object (**Auto (fast)**) |
| Several similar targets that cross | **SAMURAI / object**, if the compute time is acceptable |
| Many objects that can be named in words, on independent images | Text detection bar with Grounding DINO or SAM3, in batch |
| Existing targets to continue with a reliable prompt | **Detect.** tab |
| Moving camera, static scene | **Homog.** tab |
| Fixed camera, moving objects | **Opt. flow** tab |
| Short gap between two manual keyframes | Linear interpolation (API) |
| Precise outline of a single object | **SAM Point** in **Seg** mode |
| Dense image, quick start | **SAM Auto**, then NMS |

A reliable general workflow for a video: annotate one to three reference frames spread over the sequence, run SAMURAI (or Detect. when the prompt is reliable), use homography or optical flow for the stretches where they fit, review and clean the timeline, then export. See [Workflows](workflows.md) for the step-by-step procedures.

## Architecture and operation of the models of Annotation App

Annotation App combines five neural models and two classical algorithms. Each one solves a different sub-problem, and knowing how it works explains its strengths and its failures.

| Model | Parameters | What it produces | Used by |
|---|---|---|---|
| SAM2.1 Hiera Small | about 46 million | masks from clicks, and a mask per frame in video | SAM Point, SAM Auto, SAMURAI tab, Seg mode |
| SAMURAI | none added | same masks, chosen with a motion filter | SAMURAI tab (single target) |
| Grounding DINO tiny | about 172 million | boxes and scores from a text prompt | text detection bar, Detect. mode, text batch |
| SAM3.1 | see below | boxes, masks and scores from a text prompt | same places, as an alternative |
| XFeat | about 1.6 million | keypoints and descriptors to match two frames | homography propagation |

Lucas-Kanade optical flow and SIFT are classical algorithms without learned weights; they are described in their own sections of this page.

### SAM2.1 Hiera Small: image encoder, prompts, decoder and video memory

SAM2 is built from four blocks. The **image encoder** is Hiera, a hierarchical vision transformer: the frame is resized to 1024 x 1024 pixels and processed in four stages of 1, 2, 11 and 2 blocks, whose width starts at 96 and doubles at each stage. Most blocks attend inside local windows; blocks 7, 10 and 13 attend over the whole image. A feature pyramid network merges the four scales into feature maps of 256 channels. The **prompt encoder** turns points (foreground or background), boxes or a previous mask into tokens. The **mask decoder**, a small two-way transformer, lets these tokens and the image features exchange information and outputs up to three candidate masks. Each candidate comes with a predicted IoU, the model's own estimate of its quality, and an object score that says whether an object is present. The predicted IoU is what SAM Point uses to rank its candidates and what SAMURAI reuses.

For video, three pieces add a memory. A **memory encoder** compresses each processed frame and its mask into 64-channel features. A **memory bank** keeps the 7 most recent frames plus the frames where you gave a prompt. A **memory attention** of 4 transformer layers with rotary position encoding lets the current frame read that bank, together with one pointer vector per object. The current frame is then decoded like an image, but conditioned by what came before. This is why SAM2 follows an object through moderate deformation and short occlusions, and also why a wrong mask that enters the memory can contaminate the next frames.

### SAMURAI: a Kalman filter that changes which mask is kept

SAMURAI does not change any weight: it changes how one of the three candidate masks is chosen and which frames enter the memory. It follows the box of the target with a Kalman filter, a classical estimator that predicts where the box should be in the next frame from its position, shape and speed, then corrects that prediction with what is observed.

- Until 15 consecutive frames have been judged stable, SAMURAI keeps the candidate with the best predicted IoU and feeds the filter with its box.
- Once stable, each candidate is scored by `0.25 x motion score + 0.75 x predicted IoU`, where the motion score is the IoU between the candidate's box and the box predicted by the filter. The best score wins. The value 0.25 is the one set in the configuration shipped with the app.
- The filter is corrected with the chosen box only when its predicted IoU is above 0.3; otherwise the stable counter restarts at zero.
- A frame enters the memory bank only when its predicted IoU is above 0.5 and its object score is positive, so blurred or occluded frames do not pollute the memory.

The app applies SAMURAI to a single target. With several targets it uses the native multi-object mode of SAM2, without the filter.

### Grounding DINO tiny: image backbone, text backbone and language-guided queries

Grounding DINO pairs a detector of the DINO family with a language model. The **image backbone** is Swin-T (four stages of 2, 2, 6 and 2 transformer blocks) and produces feature maps at four scales. The **text backbone** is BERT: it turns the prompt into one vector per token, up to 256 tokens. A **feature enhancer** of 6 layers lets image and text features attend to each other. A **language-guided query selection** then keeps the 900 image positions that best match the prompt tokens as starting points, called queries, and a **cross-modality decoder** of 6 layers refines them into boxes while reading both image and text again.

Each of the 900 queries ends with a box and one score per prompt token. This is where the two thresholds come from: the box threshold applies to the best token score of a query, and the text threshold decides which tokens are strong enough to be counted in the label of the box. Because scores are computed against words and not against a fixed list of classes, any phrase can act as a class, but the model only knows what its training data showed: short, common English nouns work best, and the period in `car . truck . person` marks the boundary between concepts.

### SAM3.1: one detector for text-described concepts

SAM3 finds and segments every instance of a concept described by a short noun phrase. The configuration of the `sam3.1_multiplex.pt` checkpoint describes a video model with two parts that share one vision encoder: a detector and a SAM2-style tracker working on 1008-pixel images with 14-pixel patches. Annotation App builds the image model only, so it uses the detector alone, on independent frames, and only with text prompts.

The detector reads the text with a 24-layer CLIP-style text encoder (width 1024), fuses text and image features in a 6-layer DETR-style encoder, and decodes 200 object queries in a 6-layer decoder. A mask decoder turns each kept query into a mask. A presence token in the decoder predicts whether the concept appears in the image at all, so that recognizing the concept and locating it are two separate decisions. A geometry encoder of 3 layers exists for box or point examples, which the app does not send. Because masks come directly from the detector, SAM3 does not need SAM2 to refine its boxes, unlike Grounding DINO in **Seg** mode.

### XFeat: learned keypoints and descriptors for matching two frames

XFeat is a small convolutional network of about 1.6 million parameters, designed to be fast on modest hardware. It converts the frame to grayscale and computes three outputs from a shared trunk: a dense map of 64-dimensional descriptors at one eighth of the resolution, a keypoint map that predicts, for each 8 x 8 cell, which pixel is a keypoint, and a reliability map that says how trustworthy each location is. The app keeps the best 4096 keypoints of each frame.

To match two frames, the descriptors of the first are compared with those of the second by cosine similarity, and a pair is kept only when the two keypoints are each other's best match (mutual nearest neighbors) and their similarity exceeds 0.82. The matched points then feed a robust estimation of the homography with RANSAC and a 3-pixel reprojection tolerance. The learned descriptors are what let XFeat match frames where SIFT finds too few reliable points (low texture, blur, moderate lighting change); the homography itself, and its limits on non-planar scenes, are described in the homography section above.
