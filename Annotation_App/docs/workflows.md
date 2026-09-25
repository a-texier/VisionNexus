---
app: annotation
doc_type: workflows
audience: user
lang: en
title: Workflows
order: 20
tags: [import, samurai, grounding dino, propagation, export, backup, orchestrator]
sources: [Annotation_App/frontend/src/pages/AnnotationPage.tsx, Annotation_App/frontend/src/components/modals/ImportModal.tsx, Annotation_App/frontend/src/components/modals/ExportModal.tsx, Annotation_App/frontend/src/components/sidebar/TrackPanel.tsx, Annotation_App/frontend/src/components/timeline/Timeline.tsx, Annotation_App/backend/models/routers/orchestrator.py, Annotation_App/backend/models/routers/projects.py, Annotation_App/backend/utils/native_share.py]
---

# Workflows

## Create a project and import local images or a video

This workflow creates an Annotation App project and fills it with images or a video stored on your own computer, uploaded through the browser.

*Prerequisites*: Annotation App is open on the projects page.

1. Click **New project**, type a **Project name**, and choose the **Type**: **Sequence Image** for a video or an ordered image folder (tracking tools available), **Image Random** for unrelated images. Click **Create**.
2. Click the new project card to open the annotation workspace. The canvas shows "No frame available".
3. Click **Import** in the top toolbar (or the link under the empty canvas).
4. Drag a folder of images or a video file (`.mp4`, `.avi`, `.mov`, `.mkv`, `.webm`) onto the **SEQ 1** slot, or click **browse locally** and pick the files. A second empty slot appears: fill it to add another sequence in the same run.
5. Optionally edit **Sequence name**; it becomes the folder or file name at export.
6. For a video, open **Optimization options (applied to each sequence)** and set **Video frame decimation** (for example **1/3** for a 30 fps video with redundant frames) and **JPEG quality of extracted frames (MP4)**. Check **Lossless PNG for MP4 (ignores JPEG quality)** if you plan to use homography or optical flow.
7. Click **Import N sequence(s) in the background**. The window closes and a blue progress bar per sequence appears above the canvas; for videos, an orange extraction bar follows.
8. Start annotating as soon as the first frames appear; the timeline fills as the import progresses.

*Result*: the project contains one sequence per imported source, listed in the sequence selector under the canvas and on the project card. Uploaded images keep their original format; video frames are extracted to JPEG (or PNG) in the project folder of the workspace. In the VisionNexus shell, a dropped folder is referenced by its real path instead of being uploaded, as in the next workflow.

## Import a sequence from a server folder or an SMB/UNC share

This workflow references images that already live on the backend machine or on a network share, without copying them. It is the recommended way to import large datasets, especially when the backend runs on a remote VM.

*Prerequisites*: a project is open in the annotation workspace; the images are reachable from the backend (local disk, mounted share under `/srv`, `/mnt`, `/data`, `/home` or `/media`); for UNC paths, the share host is saved in the **Workspace** menu or provided by VisionNexus.

1. Click **Import** in the top toolbar.
2. In the path field of **SEQ 1**, type the server path of an image folder or a video, for example `/srv/datasets/run01` or `/data/video.mp4`. You can also paste a Windows path such as `\\share-host\datasets\run01`: it is translated to the matching backend path (`/srv/datasets/run01`, `/mnt/datasets/run01`...) automatically.
3. Alternatively, click **Server** to browse the backend folders, select a folder or a video, and click **Choose this folder** or **Select**. Recently visited folders are remembered.
4. To import many sequences at once, type the path of a `.txt` list instead (one `path<TAB>name` line per sequence): all slots are filled at once.
5. Check that **Symbolic links for server folders (recommended)** is ticked in **Optimization options (applied to each sequence)**.
6. Adjust **Sequence name** if needed, then click **Import N sequence(s) in the background**.

*Result*: image folders are referenced by symbolic links (zero copy, available almost immediately, inserted in batches); server videos are extracted in the background. If the path does not exist on the backend, the import fails with a "Dossier introuvable" (folder not found) error; see [Troubleshooting](troubleshooting.md).

## Annotate manually with boxes and polygons

This workflow draws annotations by hand in the annotation workspace, the baseline for every project type.

*Prerequisites*: a project with at least one imported frame is open.

1. Open the **Classes** tab of the right panel, click **+**, type the class name (subclass and sub-subclass are optional), pick a color and click **Create**. Repeat for each class.
2. Click the class you want to draw so it becomes the active class (highlighted in blue).
3. Press `R` (or click **Rectangle**) and drag on the canvas to draw a box. Release to save it.
4. For a precise outline, press `P` (or click **Polygon**), click each vertex, then double-click to close the polygon (at least three points).
5. Press `A` to switch to **Selection**: click an annotation to select it, drag it or its handles to adjust, press `Delete` to remove it. Use `Ctrl+Z` / `Ctrl+Y` to undo or redo.
6. Use `Ctrl+C` on selected annotations and `Ctrl+V` on another frame to copy them across frames.
7. Move to the next frame with the right arrow key or the slider, and repeat.

*Result*: annotations are saved immediately in the database in normalized coordinates, as manual annotations with a confidence of 1.0. In a **Sequence Image** project, each one is also attached to a track automatically (the smallest track number free on the frame). The timeline cell of each annotated frame turns green with its annotation count.

## Annotate with SAM point prompts

This workflow uses SAM2 to turn a few clicks into a precise mask, saved as a box or a polygon.

*Prerequisites*: a project is open, a class is active, and the SAM2 checkpoint is installed (see [Configuration](configuration.md)).

1. Choose the output in the toolbar: **BBox** for a box, **Seg** for a polygon.
2. Press `S` (or click **SAM Point**).
3. Left-click on the object: SAM2 predicts up to three candidate masks and shows them on the canvas.
4. If the mask spills over the background, right-click on the wrong area to add a background point; add more foreground points with left clicks where the object is missing. The masks are recomputed after each point.
5. Double-click to accept the best mask. It is saved as an automatic annotation of the active class, with the mask score as confidence.
6. Press `Esc` at any time to discard the points and start again.

*Result*: one annotation per accepted mask, marked with the **SAM Point** badge in the **Annots** tab (no track is attached). If nothing happens after a click, SAM2 is not loaded: see [Troubleshooting](troubleshooting.md).

## Auto-segment a frame with SAM Auto

This workflow segments everything on the current frame without any prompt, then lets you keep only the useful masks.

*Prerequisites*: a project is open, the SAM2 checkpoint is installed, and a class is active for validation.

1. Choose **BBox** or **Seg** in the toolbar.
2. Click **SAM Auto**. An emerald bar shows the connection, then the number of masks received as they stream in.
3. Open the **Annots** tab. The **SAM Auto** section lists the proposals that are not validated yet.
4. Validate the useful proposals one by one, or click **Validate all**; reject the others one by one or with **Reject all**. Clicking a proposal mask on the canvas also validates it. Proposals validated from the list are saved as polygons when the mask has an outline, even in **BBox** mode; canvas clicks follow **BBox / Seg**.
5. Open the **NMS** panel of the **Annots** tab, keep an IoU around 0.5 and click **Apply NMS** to remove overlapping duplicates.

*Result*: validated proposals become annotations of the active class with the provenance SAM Auto. SAM Auto works best on dense images to start quickly; for specific object types, text detection is usually more direct.

## Auto-annotate with a text prompt (Grounding DINO or SAM3)

This workflow detects every object matching a text description, on one frame or on a range of frames, in any project type.

*Prerequisites*: a project is open, at least one class exists and is active, and Grounding DINO or SAM3 is installed.

1. Click **Annotate by text (GD / SAM3)** (T icon) in the top toolbar.
2. Choose **GD** (Grounding DINO) or **SAM3**, and **BBox** or **Seg** for the output.
3. Type the prompt as lowercase singular concepts separated by periods, for example `car. truck.`. Avoid full sentences.
4. Press `Enter` to detect on the current frame and check the result on the canvas. If there are too many false positives, raise **Box:**; if objects are missed, lower it.
5. To process many frames, click the frame range button, set **From F** and **to F**, then click **Batch**. These fields take project-wide frame indices starting at 0, and the default end is the last frame of the project: in a multi-sequence project, set **to F** to stay in the current sequence. Use **Pause**, **Resume** or **Stop** if needed; keep the page open, since the batch is driven by the interface.
6. Review the result in the **Annots** tab and on the timeline; use **Apply NMS** or the confidence filter to clean up.

*Result*: detections are saved as automatic annotations of the active class (one class per run: run the prompt again with another active class for other object types). Text detection does not create tracks; to link detections into tracks on a video, use the Detect. workflow of this page.

## Track one object through a sequence with SAMURAI

This workflow annotates one object on one frame and lets SAMURAI follow it through the video. It is the recommended way to annotate a moving target, even with partial occlusions.

*Prerequisites*: a **Sequence Image** project with an imported sequence, an active class, and the SAM2 checkpoint installed (SAMURAI is included).

1. Go to a frame where the object is fully visible and draw a tight box around it (`R`). A loose box makes the target ambiguous for the whole run.
2. Open the **Tracks** tab of the left sidebar, then the **SAMURAI** tab. Check that the badge reads **SAMURAI active (Kalman)**.
3. In **Targets to track**, check the box (or double-click it on the canvas).
4. Set **Up to frame** to the last frame to process. A value before the current frame tracks backward in time.
5. Look at the **Estimated max frames (fast GPU)** gauge. If it is red, reduce the range or uncheck **Fast GPU mode** in Settings.
6. Choose **BBox** or **Segmentation** in **Output mode**, keep **Auto (fast)**, and click **Propagate via SAMURAI**.
7. Watch the boxes appear on the timeline and, with real-time live enabled, on the canvas. Stop at any time with the stop button of the green progress bar.
8. When the object is lost, go to the first wrong frame, fix or redraw the box there, and run the propagation again from that frame.

*Result*: the object has one track with a `#uid`, visible as a lane above the timeline, and one annotation per processed frame with the provenance SAMURAI.

## Track several objects with SAM2 multi-object or SAMURAI per object

This workflow propagates several targets at once in a **Sequence Image** project.

*Prerequisites*: the reference frame contains one box per object to follow; SAM2 is installed.

1. On the reference frame, draw one box per object, all with their class.
2. Double-click each box on the canvas to mark it as a target (a dashed ring appears), or check them in **Targets to track** of the **SAMURAI** tab.
3. Set **Up to frame** and **Output mode**.
4. In **Multi-target strategy**, choose:
   - **Auto (fast)** for a single pass of native SAM2 multi-object tracking, fast but without motion model;
   - **SAMURAI / object** for one SAMURAI pass per target, better when similar objects cross or hide each other, but about N times slower.
5. Click **Propagate via SAMURAI** (or **Propagate via SAM2**).
6. Review each lane on the timeline. If two objects swapped identities after a crossing, delete the wrong blocks and rerun from the frame where they separate.

*Result*: one track per target. Annotations carry the provenance SAM2 video (Auto with several targets) or SAMURAI (one target, or per-object mode).

## Propagate boxes with homography (XFeat or SIFT)

This workflow carries the boxes of a keyframe to the following frames by compensating the camera motion. It suits a panning or zooming camera over objects that do not move on their own.

*Prerequisites*: a **Sequence Image** project; the current frame has the boxes to propagate.

1. Optionally, check the scene in the **Debug** tab: pick the current frame and a later one, click **Compute homography**, and verify that **Valid homography** is **Yes** with a good **Inlier ratio**.
2. Open **Tracks**, then **Homog.**. The badge shows **XFeat GPU** or **SIFT CPU**.
3. Check the boxes in **Annotations to propagate** (none checked means all boxes of the frame) and set **Up to frame**, which must be after the current frame: homography only propagates forward.
4. Keep the default **RANSAC** values first. Raise **Min inliers** if boxes drift; lower **Inlier ratio** slightly if too many frames are rejected.
5. Click **Propagate via homography** and follow the progress in the **Logs** view (keypoints, matches, inliers and ratio per frame).

*Result*: each frame of the range receives the warped boxes, marked automatic and interpolated, with a confidence lowered when the inlier ratio is low. Where the homography is rejected, boxes are copied unchanged, so check the timeline for frozen boxes.

## Follow moving objects with optical flow

This workflow follows each box individually with Lucas-Kanade optical flow, for objects moving in front of a fixed or slowly moving camera.

*Prerequisites*: a **Sequence Image** project; the current frame has the boxes to follow, on textured objects.

1. Open **Tracks**, then **Opt. flow**.
2. Check the targets in **Targets to track** (none checked means all boxes of the frame) and set **Up to frame**, after the current frame.
3. Keep **Window (px)** at 21, **Pyramid levels** at 3 and **Min pts** at 4 for a first run. For fast motion, raise **Pyramid levels**; for compressed video, raise **Window (px)** to 25 to 31.
4. Click **Track via optical flow**.
5. Review the boxes: when a box stops moving, the object lost its trackable points (uniform surface, reflection, lighting change). Redraw it and run again from that frame, or switch to SAMURAI.

*Result*: each target has a box on every processed frame, resized when the object approaches or moves away, saved as automatic interpolated annotations.

## Continue existing tracks with Detect.

This workflow extends targets over the following frames with Grounding DINO or SAM3, keeping only the detections close to each target.

*Prerequisites*: a **Sequence Image** project; the reference frame has the targets; Grounding DINO or SAM3 is installed; the objects can be named in words.

1. Open **Tracks**, then **Detect.**.
2. Check the targets in **Targets to track** and set **Frame range** (**From**, **To**).
3. Choose **GDINO** or **SAM3.1** in **Algorithm**, and for SAM3.1 the **Output mode**.
4. Type the **Detection prompt**, for example `car. truck.`.
5. Open **Advanced settings** if needed: raise **Centroid dist.** for fast objects, lower it when targets are close to each other; enable **Auto-stop if objects lost** for long ranges.
6. Click **Detect + match (N targets)**. Pause or stop from the status area if needed.

*Result*: each target is continued on the frames where a detection lies within the centroid distance of its previous position, in its existing track or in a new one. Frames without a match leave a gap in the track; unmatched detections are discarded. With **SAM3.1**, the box threshold of **Advanced settings** is the minimum score kept and there is no text threshold.

## Review and fix tracks on the timeline

This workflow cleans the result of a propagation using the timeline and its track lanes, at the bottom of the annotation workspace.

*Prerequisites*: a **Sequence Image** project with at least one track.

1. Scan the frame cells: green cells are annotated, red cells are empty. Gaps in the middle of a sequence often mean a lost target.
2. Scan the track lanes: each colored block is a stretch where the object was tracked. Click a block to jump to its first frame; double-click to jump to its last frame.
3. To remove a wrong stretch, click its block (it glows) and press `Delete`, or click **Delete this block**. Only that track's annotations on that stretch are removed.
4. To remove a whole track, click the gray part of its lane (or several with `Ctrl+click`), press `Delete` and confirm. The track and all its annotations are deleted and the remaining tracks are renumbered.
5. To clear some frames entirely, select their cells (`Ctrl+click`, `Shift+click`, or `Ctrl+A` over the timeline) and press `Delete`. `Ctrl+Z` restores them.
6. To correct a single frame, go to it, fix the box in the canvas, and reattach it to the right track with the track selector of the **Annots** tab if needed.
7. Rerun a propagation from the corrected frame to regenerate the following frames.

*Result*: tracks are continuous and correctly identified, ready for export.

## Adjust the display LUT for 16-bit or infrared images

This workflow sets the contrast of 16-bit or infrared sequences so that both you and the models see usable images.

*Prerequisites*: a project with 16-bit PNG or TIFF frames (or any frames with poor contrast).

1. Click the floating **LUT** button at the top right of the canvas.
2. Choose the scope: **Project** for all sequences, or **Sequence** for the current one only (useful when infrared and RGB sequences share a project).
3. Try **Auto σ** first and move **Sigma (N)**: lower values increase contrast, higher values keep more extreme values.
4. If needed, switch to **Min-Max** for maximum contrast, or **Manual** and set **Low (lo)** and **High (hi)** while watching the histogram.
5. Close the panel. The setting is saved immediately. Use **fall back to project** to remove a sequence override.

*Result*: the display, the previews and the input of every model use the new mapping. Run detections and propagations after setting the LUT, because the models see exactly the displayed image.

## Export the dataset to YOLO, COCO or .ver

This workflow exports all sequences of a project in one operation.

*Prerequisites*: the project has annotations; classes are defined.

1. Click **Export** in the top toolbar.
2. Choose the **Output format**: **YOLO** for Ultralytics training (detection, plus segmentation when polygons exist), **COCO JSON** for COCO-compatible tools, **.ver** for the native text format with track ids.
3. For YOLO and COCO, set the **Train** and **Validation** sliders; the rest goes to test.
4. Keep **Symbolic links for images** checked to create a dataset folder on the server without copying images (the fastest option, used by Training App on the same machine). Uncheck it to copy the images and get a ZIP to download.
5. In standalone mode, optionally type a **Destination folder**; leave it empty to use `exports/` in the workspace.
6. Click **Export** and wait for **Export complete!**.
7. Copy the dataset path shown, or click **Download ZIP** in copy mode.

*Result*: an export folder `<project>_<date>_<time>` containing one `<sequence>-yolo/` or `<sequence>-coco/` folder, or one `<sequence>.ver` file, per annotated sequence (a single-sequence project is exported flat in YOLO and COCO). Each exported sequence is marked as exported on the Monitoring page.

## Import existing annotations (.ver or YOLO) into a sequence

This workflow loads annotations produced elsewhere onto an imported sequence.

*Prerequisites*: the sequence is imported and its frames match the annotation file. A `.ver` file is matched by its 1-based frame numbers; YOLO label files are matched by file name (stem), otherwise by order. Missing classes and tracks are created automatically.

1. Select the sequence in the sequence selector under the canvas.
2. Click the **Import annotations** icon next to the selector.
3. Type the server path of a `.ver` file or of a YOLO label folder (`.txt` files).
4. Answer the confirmation: **OK** replaces the existing annotations of the sequence, **Cancel** adds to them.
5. Alternatively, drag the `.ver` file or the YOLO folder directly onto the annotation workspace: it is imported onto the current sequence.

*Result*: a message gives the number of annotations imported and the number of frames covered. Imported annotations have the provenance "imported".

## Back up and restore annotations

This workflow protects annotations against mistakes and rebuilds a lost project.

*Prerequisites*: a project is open.

1. Nothing to do for the automatic backup: every two minutes, the app writes `backup/p<id>_<name>/p<id>_<name>.json` in the workspace, plus `p<id>_<name>_sequences.txt` listing the source path and name of each sequence. The file is overwritten each time.
2. For a manual copy, click the backup button (upload icon) in the top toolbar: a JSON file is downloaded.
3. To restore into the same project, drag the JSON file onto the annotation workspace.
4. To rebuild a deleted project: create a new project of the same type, open **Import**, type the path of the `_sequences.txt` file in the first slot (all sequences are filled with their names), import, then drag the backup JSON onto the workspace.

*Result*: annotations are restored per sequence, matched by sequence name and frame position, even if the database ids changed. Track references that no longer exist are dropped.

## Convert between .ver and YOLO without a project

This workflow converts annotation files on the server with the Convert page, without importing any image.

*Prerequisites*: the source file or folder is on the backend machine; you know the image resolution.

1. On the projects page, click **Convert**.
2. For `.ver` to YOLO: fill **.ver file path**, **Output YOLO folder**, and the image width and height, then click **Convert**.
3. For YOLO to `.ver`: fill **YOLO folder (.txt)**, **Output .ver file**, and the image width and height, then click **Convert**.
4. Read the result message (number of classes or boxes written).

*Result*: the converted file or folder is written at the given path. The output must not already exist.

## Use Annotation App from an Orchestrator pipeline

This workflow runs Annotation App as the annotation step of an Orchestrator pipeline, between Dataset Explorer and training.

*Prerequisites*: the Orchestrator App is running; its graph contains an Annotation node connected to a Dataset Explorer subset or a dataset source node.

1. In the Orchestrator, configure the Annotation node: project name, classes, mode (sequence or random), and either manual annotation or full auto (model SAM3 or Grounding DINO, text prompt, threshold, optional review before export).
2. Run the pipeline. The Orchestrator starts Annotation App if needed and creates the project from the subset folder (`imports/<subset>` in the Annotation workspace) or from the dataset source path. A progress bar under the node follows the import.
3. In manual mode, the pipeline stops on the "Annotate images manually" step. Open Annotation App from the node link, find the project on the projects page, annotate it with any tool of this guide, then click **Continue** in the Orchestrator.
4. In full auto mode, the Orchestrator runs text detection on every frame; with review enabled, it stops so you can check and fix the boxes, then you click **Continue**.
5. The Orchestrator then triggers the YOLO export (and a `.ver` export) into `exports/` of the Annotation workspace. An existing export with identical content is reused instead of being recomputed.

*Result*: the exported dataset is available to the next nodes (training, DVC). While Annotation App is launched by the Orchestrator, the **Export the dataset** window has no destination field: manual exports also go to the `exports/` folder of the workspace, whose path is shown in the window.
