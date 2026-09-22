*[Lire en francais](algorithmes.fr.md)*

# Algorithms

Text version of the app's Presentation > Algorithms tab (a styled visual
with interactive diagrams: `frontend/src/components/presentation/TabAlgorithms.tsx`).
How each method available in the Tracks tab actually works, with
its effective parameters and the assumptions it makes. The values quoted
are those from the code, not from the original papers -- each assumption
spells out what breaks the algorithm, not just how it works.

## Input pipeline common to all models

Source (16-bit PNG/TIFF, 8-bit JPEG, or raw format specialise) -> LUT (3-sigma / minmax
/ manual, sequence > project) -> 8-bit (JPEG quality 95, temp folder)
-> Resize (1024x1024, without preserving aspect ratio) -> Tensor (ImageNet
normalized, bfloat16 on GPU).

Practical consequence: adjusting the LUT changes what the model receives. On
16-bit imagery, a bad setting produces a crushed image, and the model then
works on the same mush as what is shown on screen.

## SAMURAI — single-target video tracking

*SAM2 augmented with a Kalman filter that arbitrates the mask choice.*

SAMURAI is a fork of SAM2, not a different model: same weights
(`sam2.1_hiera_small.pt`), same architecture. What it adds is a decision
rule. At each frame, SAM2 proposes several candidate masks with a
confidence score; SAM2 alone picks the most confident one, SAMURAI picks the one that
reconciles confidence with motion consistency.

**The decision loop**: SAM2 proposes several masks (frame t) with
their predicted IoU -> a Kalman filter predicts an expected box from
the previous state -> combined score = `0.15 x IoU_kalman + 0.85 x IoU_model`
-> the retained mask is the best scoring one on this combined score, not just the
most confident one -> if the score exceeds the threshold, the filter is corrected with the
retained box. Below the threshold, the `stable_frames` counter falls back to 0 and the
filter goes back to pure prediction; it takes 15 consecutive correct frames
(`stable_frames_threshold`) to consider it relocked.

**The Kalman filter in detail**: an 8-dimensional state in `xyah` space
(center x, center y, aspect ratio, height) plus the four associated
velocities. Constant-velocity model (`dt = 1` frame). Noise is
proportional to the box height (`_std_weight_position = 1/20`,
`_std_weight_velocity = 1/160`): an object that occupies many pixels
gets more absolute uncertainty than a distant object. The score blend
is fixed at `kf_score_weight = 0.15` -- Kalman breaks ties, it does not
decide.

**Why SAMURAI only tracks ONE target**: `kf_mean`, `kf_covariance` and
`stable_frames` are attributes of the *model*, not of a tracked object. There is
therefore only a single Kalman state in memory, regardless of the number
of targets. With two objects, the score comparison operates on a tensor with
several elements and raises `RuntimeError: Boolean value of Tensor with more
than one value is ambiguous`.

The application handles this case instead of crashing: as soon as a 2nd target appears,
`configure_video_tracking()` sets `samurai_mode = False` and switches to native
multi-object SAM2, which tracks N objects without Kalman. The state is also reset to
zero on every run -- the model is a shared singleton, a leftover state would
corrupt the next run.

The per-object SAMURAI mode works around the limitation differently: N independent
passes, one session and one filter per target. Higher-quality tracking,
at roughly N times the compute cost.

**Memory bank**: `num_maskmem = 7` -- cross-attention only looks
at the 7 most recently memorized frames, plus the reference frame (the annotated one).
Per-frame cost is therefore constant and does not grow with the
sequence length. SAMURAI additionally filters what enters this
bank (`memory_bank_iou_threshold = 0.5`): a frame where tracking is
doubtful is not memorized, which avoids poisoning the following
frames.

**Image preparation**: frames are converted to JPEG quality 95,
numbered `000000.jpg`, in a temp folder -- SAMURAI requires names
that are pure integers. An 8-bit JPEG that already conforms is symlinked without
re-encoding; otherwise the LUT is applied and the image re-encoded. Each frame
is then resized to 1024x1024 without preserving aspect ratio: a
16:9 image is therefore distorted, in the same way as during
training, which has no effect on quality. Coordinates are converted back to normalized form via
the original size.

**Numerical precision**: inference runs under `autocast(bfloat16)`. Without
this, PyTorch refuses the Flash and memory-efficient attention kernels and
falls back to a naive implementation, 3 to 5 times slower. The same
context wraps initialization, prompting, and propagation: a different dtype
between these steps would corrupt the memory bank.

**Parameters**

| Name | Default | Description |
|---|---|---|
| `image_size` | 1024 | Internal resolution, applied to every frame. |
| `num_maskmem` | 7 | Frames kept in the memory bank. |
| `stable_frames_threshold` | 15 | Consecutive correct frames before considering tracking relocked. |
| `kf_score_weight` | 0.15 | Kalman weight in the mask selection score. |
| `memory_bank_iou_threshold` | 0.5 | Minimum IoU for a frame to enter memory. |
| `offload_video_to_cpu` | false | Frames in RAM instead of VRAM. Slower, essential on a small GPU. |

**Assumptions (and what breaks if they are wrong)**

- Motion is smooth at near-constant velocity -- if wrong: a sudden change of direction makes the prediction diverge, tracking drops out.
- The target stays visible or is only briefly occluded -- if wrong: after a long occlusion the filter has drifted too far to relock.
- Aspect ratio varies little -- if wrong: an in-plane rotation makes the box a poor descriptor.
- The starting box frames the object well -- if wrong: an approximate prompt locks in an ambiguous target for the whole sequence.
- Appearance stays comparable over 7 frames -- if wrong: a fast change of scale or lighting empties the memory of its usefulness.

## SAM2 video — multi-object tracking

*Attention memory alone, with no motion model.*

Used automatically as soon as several targets are requested, and
available on its own if SAMURAI is not installed. Each object gets an
id and its own set of masks; propagation is shared across objects, so there
is no per-object overhead the way there is in per-object mode.

The difference from SAMURAI comes down to one sentence: SAM2 picks the mask
it is most confident about, without ever asking whether that mask is plausible
given prior motion. On well-contrasted, isolated objects, the difference is
negligible. On two similar objects that cross paths, SAM2 can jump from
one to the other where SAMURAI's Kalman filter would have rejected the jump.

Distinct provenance in the database: since the split, annotations
carry `samurai` or `sam2_video` depending on which tracker was actually active. Earlier
runs keep `sam2_tracking`, which did not allow distinguishing between them.

**Assumptions**

- Objects remain distinguishable by appearance -- if wrong: two identical objects that cross paths swap identities.
- Identities are fixed by the initial prompt -- if wrong: an object that enters mid-sequence will never be tracked.
- The 7-frame memory is enough to maintain identity -- if wrong: a longer occlusion breaks the track with no way to recover.

## Grounding DINO — text-driven detection

*An open detector driven by a prompt, with no notion of time.*

Model `IDEA-Research/grounding-dino-tiny`, downloaded automatically
from HuggingFace on first use (about 340 MB). It pairs a
text encoder and an image encoder and returns the boxes whose
representation matches the prompt. Open vocabulary: the prompt does not
need to belong to a predefined class list.

**Two thresholds, two roles**: `box_threshold` filters on the box's
confidence; `text_threshold` filters on the strength of the association between
the box and the prompt's words. In guided tracking both are deliberately
kept low (0.20 and 0.15): the goal is to maximize recall, sorting
is then done by geometric matching against the targets.

**Writing the prompt**: terms must be separated by periods,
lowercase, singular: `car . truck . person`. A full sentence
degrades detection -- the model expects concepts, not a description.

**Assumptions**

- The object belongs to the learned visual vocabulary -- if wrong: a very specific target (an industrial part, an infrared signature) is not found, regardless of the prompt.
- Each frame is independent -- no temporal consistency: identities come solely from centroid matching.
- The visual domain is close to the training data -- if wrong: on infrared or poorly remapped 16-bit imagery, scores collapse.

## SAM3 — concept-based detection and segmentation

*An alternative to Grounding DINO, box or mask output.*

Also text-driven, but able to directly produce
segmentation masks in addition to boxes -- configurable via
`sam3_output_mode` (`bbox` or `segmentation`). Local weights in
`backend/checkpoints/sam3.1/`.

In guided tracking, it occupies exactly the same place as Grounding
DINO: a detector applied frame by frame, whose outputs are then
matched to the targets. The choice between the two is empirical -- SAM3 tends
to behave better on objects with sharp edges, Grounding
DINO on more abstract concepts.

**Assumptions**

- The concept can be expressed in natural language -- if wrong: a purely visual distinction with no word for it remains out of reach.
- Independent frames -- same lack of temporal continuity as Grounding DINO.

## Custom YOLO — a home-trained detector

*Your own `.pt` weights, in the tracking loop.*

Loads a local model via `settings.algorithms.yolo_model_path`
(Ultralytics, cached by path). No text prompt: the classes are
whatever you trained. This is the preferred path when you already have
a detector on your domain -- it will systematically beat a general-purpose
model.

**Deliberately low confidence threshold**: `yolo_conf_threshold = 0.15`
by default. This is not a detection setting but a tracking one: many
candidates are accepted, and centroid matching then eliminates
those that don't fall near a known target. A false alarm far from
any target is discarded without ever becoming an annotation.
`yolo_iou_threshold = 0.7` controls the internal NMS.

**Assumptions**

- The model's classes match the project's -- if wrong: class indices are shifted and annotations are mislabeled.
- The training domain covers the annotated images -- if wrong: a model trained on daytime images detects nothing at night.

## XFeat / SIFT homography

*Geometric propagation when it's the camera that moves.*

No detection network: the transformation between two frames is estimated
and the boxes are carried through it. Matching by XFeat on GPU, falling
back to SIFT on CPU, then RANSAC to estimate a 3x3 matrix.

**Parameters**

| Name | Default | Description |
|---|---|---|
| `xfeat_top_k` | 4096 | Interest points extracted per image. |
| `xfeat_min_cossim` | 0.82 | Minimum cosine similarity to validate a match. |
| `ransac_threshold` | 3.0 | Tolerated reprojection error, in pixels. |
| `min_inlier_count` | 30 | Absolute number of inliers required. |
| `min_inlier_ratio` | 0.5 | Required proportion of inliers. |

Explicit refusal rather than a wrong result: below 30% inliers,
`compute_homography()` returns `None` and propagation stops. A
homography estimated from too few correspondences produces aberrant
boxes; better to write nothing.

**Assumptions**

- The scene is planar, or the camera rotates around its optical center -- if wrong: in the presence of parallax a single matrix cannot describe the scene.
- The object is stationary relative to the scene -- if wrong: an object moving on its own does not follow the global transform (use optical flow instead).
- Texture is sufficient -- if wrong: sky, sea, a uniform wall: no interest points, no homography.
- Overlap between frames is significant -- if wrong: too-fast motion doesn't leave enough correspondences.

## Lucas-Kanade optical flow

*Per-object propagation, when it's the target that moves.*

Complementary to homography. Points are seeded inside each box
then tracked individually from one frame to the next via pyramidal
Lucas-Kanade. The median displacement of surviving points translates the box.
Each object is processed separately, so several objects can move
in different directions.

**Parameters**

| Name | Default | Description |
|---|---|---|
| `optflow_win_size` | 21 | Search window, in pixels. Larger = handles fast motion but is less precise. |
| `optflow_max_level` | 3 | Pyramid levels. Each level doubles the manageable amplitude. |
| `optflow_min_pts` | 4 | Minimum tracked points to validate the displacement. |

**Assumptions**

- Brightness constancy: a point keeps its intensity -- if wrong: a lighting change or a reflection loses the points.
- Displacement stays within the search window -- if wrong: too fast for 21 px over 3 levels, tracking drops out (increase `max_level`).
- Neighboring points move together -- if wrong: on a deformable object, the median displacement no longer makes sense.
- The object is textured -- if wrong: a uniform surface provides no trackable point.

## How to choose

- **One target, long sequence** -- SAMURAI, the best trade-off.
- **Several targets** -- multi-object SAM2; switch to per-object SAMURAI if quality isn't enough and the compute time is acceptable.
- **Many nameable objects** -- Grounding DINO or SAM3 in guided tracking.
- **A detector already trained on the domain** -- custom YOLO, without hesitation.
- **Moving camera, static scene** -- homography.
- **Static camera, moving objects** -- optical flow.
