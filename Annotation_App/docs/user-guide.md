---
app: annotation
doc_type: user-guide
audience: user
lang: en
title: User guide
order: 10
tags: [interface, toolbar, tracks panel, timeline, shortcuts, import, export]
sources: [Annotation_App/frontend/src/pages/ProjectsPage.tsx, Annotation_App/frontend/src/pages/AnnotationPage.tsx, Annotation_App/frontend/src/pages/MonitoringPage.tsx, Annotation_App/frontend/src/pages/ConvertPage.tsx, Annotation_App/frontend/src/pages/PresentationPage.tsx, Annotation_App/frontend/src/components/canvas/AnnotationCanvas.tsx, Annotation_App/frontend/src/components/sidebar/TrackPanel.tsx, Annotation_App/frontend/src/components/sidebar/AnnotationList.tsx, Annotation_App/frontend/src/components/sidebar/LabelManager.tsx, Annotation_App/frontend/src/components/timeline/Timeline.tsx, Annotation_App/frontend/src/components/modals/ImportModal.tsx, Annotation_App/frontend/src/components/modals/ExportModal.tsx, Annotation_App/frontend/src/components/modals/SettingsModal.tsx, Annotation_App/frontend/src/components/panels/LutPanel.tsx, Annotation_App/frontend/src/hooks/useKeyboardShortcuts.ts, Annotation_App/frontend/src/components/help/helpContent.ts]
---

# User guide

## Projects page of Annotation App

The projects page is the home screen of Annotation App. It lists every project of your workspace as a card and gives access to the tools that are not tied to one project.

Each project card shows:

- the project name and its type, **Sequence Image** (purple) or **Image Random** (blue); the demo project created by the tutorial has an orange border and a **Tutorial demo** badge;
- the number of annotated frames out of the total, with a percentage and a progress bar (green from 80 %, amber from 40 %);
- for multi-sequence projects, one line per sequence with its annotated frames, its annotation count and its own progress bar (the first three are shown, a link expands the rest);
- the last modification date.

Click a card to open the project in the annotation workspace. Hover a card to reveal the trash icon; deleting asks for confirmation (**Delete project**) and removes the project with all its frame records, annotations, tracks and classes. Image files referenced by symbolic link are not touched.

The header contains, from left to right:

- **Interactive tutorial**: starts the guided tour (it glows until you have launched it once).
- **Presentation**: opens the built-in documentation, described in the section *Presentation page (built-in documentation)* of this guide.
- **Convert**: opens the Convert page, a `.ver` and YOLO conversion utility.
- **Settings**: opens the Settings window (the same as in the workspace).
- **Monitoring**: opens the Monitoring page with usage statistics.
- **New project**: opens the project creation window.

The bottom-left corner holds the user badge and the **Workspace** menu, described in the section *Workspace menu and share host setting* of this guide.

## Creating a project in Annotation App

The **New project** window, opened from the projects page, creates an empty project. It has three fields:

- **Project name** (required).
- **Type**: **Image Random** for a set of unrelated images, or **Sequence Image** for a video or an ordered image folder.
- **Create** / **Cancel**.

The type decides which tools are available. **Sequence Image** projects show the left sidebar with the **Tracks** and **Debug** tabs (all tracking and propagation tools) and the track lanes above the timeline. **Image Random** projects hide the left sidebar: you annotate frame by frame with the manual tools, SAM2 and text detection. Both types have the timeline, the frame slider, import, export and backup. In **Sequence Image** projects, every box or polygon you draw by hand is also attached to a track automatically (the smallest track number free on that frame). The type cannot be changed after creation, so choose **Sequence Image** whenever the frames come from a video or a time series, even if you do not plan to track yet.

After **Create**, the project appears on the projects page. Open it and use **Import** to add frames; the project stays empty until the first sequence is imported. The differences between the two types are explained in [Concepts](concepts.md).

## Workspace menu and share host setting

The **Workspace** button at the bottom left of the projects page opens a menu about the folder where your data lives. It shows the workspace path on the backend machine and offers:

- **Open on the server (local app only)**: opens the folder in the file explorer. It only works when the backend runs on your own computer; with a remote VM, the app cannot open a window on your workstation.
- **Copy the server path**: copies the workspace path as seen by the backend (for example `/srv/data/All_workspaces/annotation_alice`).
- **Copy the Windows path (mount)**: copies the same folder as a Windows network path (for example `\\share-host\data\All_workspaces\annotation_alice`). This entry appears once a share host is saved.
- **Windows mount - share host**: a text field for the DNS name or IP of the SMB server that exposes the backend folders to Windows. The example line under the field shows how `/srv/datasets/...` becomes `\\<share-host>\datasets\...`: the first path segment (the shared root) is dropped and the second becomes the share name. Click **Save the share host** to store it.

The share host is also what lets the VisionNexus shell read frame images directly from the share instead of downloading them through the backend, which is much faster over SSH. When VisionNexus launches the app with a share host, that value takes priority. Details are in [Configuration](configuration.md) (section *Native share (SMB) and path settings*).

The user badge next to the menu shows the current user and gives access to the list of recent workspaces and connected users of the same instance.

## Annotation workspace layout

The annotation workspace opens when you click a project card. It is organized in five areas:

1. **Top toolbar**: back to projects, project name, annotation tools, output mode, text detection, undo/redo, zoom, **Import**, backup, **Settings**, help and **Export**.
2. **Left sidebar** (Sequence Image projects only): the **Tracks** tab with all tracking tools and the **Debug** tab for homography inspection. Drag its right edge to resize it (the width is not saved).
3. **Canvas** in the center: the current frame with its annotations, the floating **LUT** button in the top-right corner, and the frame navigation bar below it.
4. **Right panel**: the **Classes**, **Annots** and **Help** tabs. Drag its left edge to resize it (the width is not saved).
5. **Timeline** at the bottom: one cell per frame of the current sequence, with the track lanes above it and the user badge on its left.

Progress bars appear between the toolbar and the canvas while a background job runs: frame extraction (orange), sequence import (blue), propagation (green), text batch (green or yellow when paused) and SAM Auto (emerald).

The workspace restores your session when you come back: the current frame is saved 1.5 seconds after each navigation, and the session (frame, zoom, active tool and class) is saved every two minutes together with a silent JSON backup of all annotations on the server. When the settings are loaded, the active tool starts on the **Default tool** of the Settings window (**Rectangle** by default). Drag a `.ver` file, a YOLO label folder or a backup `.json` onto the workspace to import or restore annotations (see [Workflows](workflows.md)).

## Top toolbar of the annotation workspace

The top toolbar of the annotation workspace holds the tools used on every frame. From left to right:

- **Back to projects** (arrow icon) and the project name.
- **Annotation tools**: **Selection**, **Pan**, **Rectangle**, **Polygon**, **SAM Point** and **SAM Auto**. The active tool is highlighted in blue. **SAM Auto** starts immediately on the current frame when clicked.
- **BBox / Seg**: the output mode for automatic annotations. **BBox** creates boxes; **Seg** creates polygons (SAM Auto masks, Grounding DINO boxes refined by SAM2, SAM3 masks). Its starting value comes from the *Default segmentation output* setting.
- **Annotate by text (GD / SAM3)** (T icon): shows or hides the text detection bar, described in its own section of this guide.
- **Undo (Ctrl+Z)** and **Redo (Ctrl+Y)**: 50 levels per frame. After a multi-frame deletion from the timeline, `Ctrl+Z` undoes that deletion first.
- **Zoom out**, the zoom percentage (click to reset zoom and position), **Zoom in**, and **Center the view (reset zoom + pan)**.
- **Import**: opens the Import sequences window.
- **Backup** (upload icon): downloads a JSON backup of all project annotations. Drop that file back onto the workspace to restore it.
- **Settings** (gear icon) and **Help** (question mark icon): open the Settings window and the help window.
- **Export**: opens the Export the dataset window.

The keyboard shortcuts of the tools are listed in the section *Canvas interactions and keyboard shortcuts*. The tooltips show the same keys: `A` for **Selection**, `R`, `P` and `S` for the drawing tools, the middle mouse button for **Pan**; **SAM Auto** has no key.

## Text detection bar (Grounding DINO and SAM3)

The text detection bar of the annotation workspace appears when you click **Annotate by text (GD / SAM3)** in the top toolbar. It finds objects described by words and creates annotations of the active class.

Controls:

- **GD / SAM3**: chooses the detector. **GD** is Grounding DINO; **SAM3** is the SAM3.1 concept model.
- **Box:** and **Txt:**: the two thresholds of the chosen detector. With **GD** they are the box and text thresholds of Grounding DINO. With **SAM3**, **Box:** is the minimum score kept and **Txt:** is not used, so it is hidden in the Detect. tab. Lower values find more objects and more false positives. Their starting values come from the Settings window.
- **Prompt field**: type concepts separated by periods, lowercase and singular, for example `car. person. bike.`. Press `Enter` or click the wand button to detect on the current frame.
- **Frame range** button, shown as `[F<start>...F<end>]` (visible when the project has more than one frame): opens the **From F** / **to F** fields. These numbers are project-wide frame indices starting at 0, not the 1-based numbers of the current sequence. By default the range runs from the current frame to the last frame of the project, so in a multi-sequence project it can continue into the following sequences: set **to F** explicitly to stay in one sequence.
- **Batch**: runs the detection on every frame of the range. While it runs, **Pause**, **Resume** and **Stop** buttons appear in the bar and in a progress bar above the canvas.

Detections are saved immediately as automatic annotations (**AI** badge, provenance Grounding DINO or SAM3) of the active class, as boxes or polygons depending on **BBox / Seg**. With **Seg**, Grounding DINO boxes are refined into masks by SAM2. Text detection needs at least one class and an active class; otherwise a warning is shown and the run button stays disabled. Text detection never creates tracks. To continue existing tracks with a detector, use the **Detect.** tab of the Tracks panel instead.

## Canvas interactions and keyboard shortcuts

The canvas of the annotation workspace displays the current frame and its annotations. Drawing needs an active class: if no class exists or none is selected, a message asks you to create or select one in the **Classes** tab.

Mouse actions on the canvas:

| Action | Effect |
|---|---|
| Wheel | Zoom centered on the cursor |
| Middle button held and dragged | Pan the view |
| Middle click without moving | Fit the image to the canvas and center it |
| Left drag (Pan tool) | Pan the view |
| Click and drag (Rectangle) | Draw a bounding box (very small boxes are ignored) |
| Clicks, then double-click (Polygon) | Draw a polygon; the double-click closes it when it has at least three points |
| Left click / right click (SAM Point) | Add a foreground / background point; SAM2 predicts up to three masks |
| Double-click (SAM Point) | Accept the best predicted mask |
| Double-click on a box | Check or uncheck it as a tracking target (dashed ring), for all Tracks tabs at once |
| Drag a selected box (Selection) | Move or resize it with the handles |

Keyboard shortcuts (ignored while typing in a field):

| Key | Effect |
|---|---|
| `A` | Selection tool |
| `R` | Rectangle tool |
| `P` | Polygon tool |
| `S` | SAM Point tool |
| `Esc` | Cancel the drawing or SAM points, deselect, back to Selection |
| `Delete` / `Backspace` | Delete the selected annotations |
| `Ctrl+Z` / `Ctrl+Y` (or `Ctrl+Shift+Z`) | Undo / redo |
| `Ctrl+C` / `Ctrl+V` | Copy the selected annotations / paste them on the current frame |
| Left / right arrow | Previous / next frame |
| `1` to `9` | Select the class whose shortcut key is that digit (no effect if no class has it) |
| `V` | Toggles the review mode flag (no visible effect in the current version) |

`Space` has no function: pan with the middle mouse button. Digit keys select the class that has this shortcut key, shown in the **Classes** tab; a class without a shortcut key does not react.

## Frame navigation bar under the canvas

The frame navigation bar sits under the canvas of the annotation workspace when the project has more than one frame. It always works inside the current sequence: the slider and the counters cover only that sequence's frames.

Controls on the first row:

- **Sequence selector**: lists the sequences of the project with their type, name, annotated frames and annotation count. Selecting one jumps to its first frame.
- **Import annotations** (upload icon, tooltip "Import annotations (.ver or YOLO folder) onto this sequence"): asks for a server path to a `.ver` file or a YOLO label folder and imports it onto the current sequence. You choose to replace or add to the existing annotations.
- **Previous / next** arrows and the **slider**. While you drag the slider, the canvas shows light 480 px previews; the full image loads when you release it.
- **Counter** `n / total` and the **go to** field: type a frame number (1-based, relative to the sequence) and press `Enter` to jump to it.

Controls on the second row:

- **Back to start**: returns to the first frame of the sequence.
- **Play** / **Pause**: plays the sequence.
- **FPS** 1 to 5: playback speed.

## LUT and display panel

The LUT panel of the annotation workspace controls how image values are mapped to screen brightness. It opens with the floating **LUT** button in the top-right corner of the canvas and is mainly useful for 16-bit and infrared imagery.

Controls of the **LUT / Display** panel:

- **Project** / **Sequence**: the scope of the setting. **Project** applies to every sequence; **Sequence** overrides it for the current sequence only (for example an infrared sequence next to RGB ones). **fall back to project** removes the sequence override. The main pseudo-sequence of older projects can only use the project scope.
- **Histogram** of the raw frame values, with the low (pink) and high (amber) cut lines, the minimum and maximum values and the bit depth.
- **Auto σ**: stretches `[mean - Nσ, mean + Nσ]` to 0-255. The **Sigma (N)** slider goes from 0.5 to 6, default 3.
- **Min-Max**: stretches the real minimum and maximum of the frame (maximum contrast).
- **Manual**: **Low (lo)** and **High (hi)** fields and sliders.

The LUT is saved as soon as you change it. It is also applied to the images given to the AI models (SAM2, SAMURAI, Grounding DINO, SAM3, homography, optical flow), so the models see exactly what you see: a crushed display means crushed model input. The source files are never modified. See [Concepts](concepts.md) for the input pipeline.

## Classes tab of the right panel

The **Classes** tab of the right panel manages the label classes of the project. Every annotation belongs to a class, so create at least one before drawing.

- **+** (**Add a class**) opens the creation form: three text fields whose placeholders read class (detection, required), subclass (recognition) and sub-subclass (identification, enabled once a subclass is entered), a color picker, then **Create** or **Cancel**. Only the base class is required. A class you create becomes the active class at once.
- **Click a class** to make it the active class (highlighted in blue). Click it again to deselect it. New manual and AI annotations use the active class.
- **Hover a class** to show the edit (pencil) and delete (trash) icons. Editing opens the same fields inline; confirm with the check mark or `Enter`.

The three levels form a hierarchy such as drone, quadcopter, mavic. The YOLO and COCO exports use the full name joined with underscores (`drone_quadcopter_mavic`); the `.ver` export writes the three levels in separate columns. The trash icon deletes the class immediately, without confirmation, and its annotations are not deleted: they keep a reference to the missing class (shown as `classe_<id>`, exported as `unknown` in `.ver`). Reassign or delete those annotations before deleting a class.

## Annots tab of the right panel

The **Annots** tab of the right panel lists the annotations of the current frame and gives the per-frame cleanup tools.

Each row shows the class color and name, the type (`BBox` or `Poly`), the confidence score (green from 0.8, yellow from 0.5, red below), a badge for automatic annotations, an **Interp.** badge for interpolated annotations that are not automatic, and a track selector. The badge names the provenance when it is recorded (SAM Point, SAM Auto, Grounding DINO, SAM3, SAMURAI, SAM2 video, Guided for the Detect. tab, Homog. and Flux opt. for propagated boxes); annotations from older versions of these tools may show a plain **AI** badge.

Interactions:

- **Click** a row to select the annotation (it is highlighted on the canvas); **Shift+click** selects a range; **double-click** zooms the canvas on it.
- **Track selector**: detach the annotation from its track, create a new track (**+ new**), or attach it to an existing track `#uid`.
- **Trash icon** (on hover): deletes that annotation.

Header buttons:

- **IA** (tooltip "Show AI annotations only"): hides manual annotations.
- **Confidence filter** (sliders icon): **Minimum confidence score** slider and **Reset**.
- **NMS** (layers icon): an IoU field (default from Settings, 0.5) and **Apply NMS**, which removes overlapping duplicates and keeps the most confident one.
- **Class chips**: click one to show only that class; the filter icon clears the class filter.

When SAM Auto has run, a **SAM Auto** section lists the proposals that are not validated yet, with **Validate all**, **Reject all**, and per-proposal validate and reject buttons. Proposals validated from this list use the active class (or the first class) and are saved as polygons whenever the mask has an outline, whatever the **BBox / Seg** choice; a proposal validated by clicking its mask on the canvas follows **BBox / Seg**. The footer shows the selection count with **Deselect**, and **All** (delete all annotations of the frame) with a **Confirm?** **Yes** / **No** step.

## Help tab and help window

Annotation App has two built-in help views with the same content. The **Help** tab of the right panel is always at hand; the help window opens with the question mark button of the top toolbar.

Both are organized in four tabs:

- **Shortcuts**: keyboard and mouse shortcuts grouped by tools, editing, navigation and canvas, and timeline and tracks.
- **Modes & Features**: the annotation modes, the tracking modes of the Tracks panel, and the main features (multi-sequence, shared tracking targets, block deletion, sparse timeline, NMS, export, auto-save, display LUT, monitoring).
- **Models**: the models used by the app (SAM2 Small and Tiny, SAMURAI, Grounding DINO, SAM3, XFeat) and their status.
- **Workflow**: the recommended flow to annotate a sequence.

The help window also has **Start the interactive tutorial**, which creates the demo project and starts the guided tour. This built-in help is a short reminder; this documentation is the complete reference.

## Tracks panel of the left sidebar

The Tracks panel is the **Tracks** tab of the left sidebar, available in **Sequence Image** projects only. It propagates annotations of the current frame to the following (or previous) frames and shows what the algorithms are doing.

The top of the panel shows **Current frame** with its project-wide index (`#n`, starting at 0, unlike the 1-based numbers of the frame fields below) and the number of annotations available on it. Below, four tabs give four propagation methods:

- **SAMURAI**: video segmentation tracking with SAM2 or SAMURAI, the default and most robust method.
- **Detect.**: Grounding DINO or SAM3 run on each frame, then matched to your targets by centroid distance.
- **Homog.**: geometric propagation that compensates camera motion (XFeat on GPU, SIFT on CPU).
- **Opt. flow**: Lucas-Kanade optical flow that follows each object's own motion.

All tabs share the same set of tracking targets: the annotations checked in one tab are checked in all of them, and double-clicking a box on the canvas toggles it everywhere. In the **SAMURAI**, **Homog.** and **Opt. flow** tabs, if no target is checked, every annotation of the current frame is used; the **Detect.** tab needs at least one checked target. Frame fields (**Up to frame**, **From**, **To**) use 1-based numbers inside the current sequence, and a propagation never leaves the current sequence. Only one job runs at a time. The bottom of the panel shows the run status and switches between the **Logs** console and the **Tracks** list. Each tab is described in its own section below; the algorithms themselves are explained in [Concepts](concepts.md).

### SAMURAI tab of the Tracks panel

The **SAMURAI** tab of the Tracks panel propagates the selected annotations through the sequence with SAM2 video segmentation. A badge shows which engine is loaded: **SAMURAI active (Kalman)**, **SAMURAI installed, SAM2 running**, or **Standard SAM2 (SAMURAI absent)**; when SAMURAI is not installed, a line reads **To install SAMURAI: run** `install_samurai.bat`.

Controls:

- **Targets to track**: one checkbox per annotation of the current frame, with **Select all** / **Deselect all**. The box of each target is the prompt given to the model.
- **Up to frame**: the last frame to process (1-based in the sequence). A value before the current frame propagates backward in time; a **reverse direction** tag appears.
- **Estimated max frames (fast GPU)**: a gauge comparing the number of frames to process with the estimated VRAM capacity, with the GPU name and free memory. It turns red when the range exceeds the capacity: reduce the range, decimate at import, or uncheck **Fast GPU mode** in Settings (the warning text of the gauge calls this option "Offload CPU"; it is the same setting, inverted). When CPU offload is active (**CPU offload active**) or no GPU is found, a short note replaces the gauge.
- **Output mode**: **BBox** or **Segmentation** (polygons from the masks).
- **Multi-target strategy**: **Auto (fast)** uses SAMURAI for one target and native multi-object SAM2 in a single pass for several targets. **SAMURAI / object** runs one SAMURAI pass per target, better on crossings and occlusions but about N times slower; it requires SAMURAI to be loaded.
- **Propagate via SAMURAI** (or **Propagate via SAM2**): starts the job.

Each target keeps its track if it already has one (in **Sequence Image** projects every manual box gets a track automatically); otherwise a new track is created. **SAMURAI / object** only applies with at least two targets; with a single target, SAMURAI is used anyway when it is loaded. During the run, boxes appear frame by frame on the timeline and, when real-time live is enabled in Settings, on the canvas. The green progress bar above the canvas and the status area of the panel both have a stop button. At the end, frames, tracks and annotations are reloaded once from the database.

### Detect. tab of the Tracks panel

The **Detect.** tab of the Tracks panel continues your existing targets on the following frames with a text-driven detector. It runs Grounding DINO or SAM3 on each frame, then keeps only the detections that match a target by centroid distance. Detections that match no target are discarded: objects that are not targets are never added.

Controls:

- **Targets to track**: checkboxes for the annotations of the current frame, with **Select all** / **Deselect all**. The tab asks you to annotate the frame first if it is empty.
- **Frame range**: **From** and **To** (1-based in the sequence). **From** starts on the frame after the current one.
- **Algorithm**: **GDINO** (Grounding DINO) or **SAM3.1**. With SAM3.1, an **Output mode** choice (**BBox** or **Segmentation**) appears; with GDINO the output is always boxes.
- **Detection prompt** (required): concepts separated by periods, for example `car. person.`.
- **Advanced settings**: **Box threshold** and **Text threshold**, **Centroid dist.** (maximum distance between a target and a detection, as a fraction of the image; 0.15 means 15 %), **Max size var.** (tolerated area change between two frames; 0.5 means plus or minus 50 %), and **Auto-stop if objects lost** with **Max % lost** and **Consec. frames**.
- **Detect + match (N targets)**: starts the job.

With Grounding DINO both thresholds apply. With **SAM3.1** the text threshold does not exist (its field is hidden) and the box threshold is the minimum score kept. **Max size var.** does not reject anything: the box is saved and the frame is only recorded as an anomaly in the task result, which the interface does not display. Each target keeps its existing track, or gets a new one. This job can be paused and resumed from the status area. Targets without a match on a frame leave a gap in their track. Starting values of the thresholds, the distance, the size variation and the auto-stop come from the Settings window.

### Homog. tab of the Tracks panel

The **Homog.** tab of the Tracks panel propagates the boxes of the current frame to the following frames by estimating the global motion of the camera between consecutive frames. Use it when the camera pans or zooms over a mostly static scene. It only works forward: **Up to frame** must be after the current frame.

Controls:

- **Source annotations** and **Source frame**: a summary of what will be propagated.
- **Annotations to propagate**: checkboxes, with **Select all** / **Deselect all**.
- **Up to frame**: the last frame to process.
- **Method badge**: **XFeat GPU** when the XFeat model is available, otherwise **SIFT CPU**.
- **RANSAC**: **Min inliers** (absolute number of consistent matches required), **Inlier ratio** (required proportion, 0 to 1) and **Reproj. threshold** (tolerated reprojection error in pixels).
- **XFeat GPU** (XFeat only): **Top-K pts** (keypoints per image) and **Min cossim** (minimum descriptor similarity).
- **Propagate via homography**: starts the job.

Propagated boxes are saved as automatic, interpolated annotations with the provenance Homog., with a confidence of the source confidence multiplied by `0.6 + 0.4 x inlier ratio`. They keep the track of their source annotation, if any. When the homography of a step is rejected by the quality thresholds, the boxes are copied unchanged to that frame. Only the enclosing box of a polygon moves, so the propagated annotation is always a box: propagate boxes rather than polygons. Starting values come from the Settings window; the RANSAC fields are shown for both methods, the **XFeat GPU** fields only when XFeat is available.

### Opt. flow tab of the Tracks panel

The **Opt. flow** tab of the Tracks panel follows each selected box individually with Lucas-Kanade optical flow. Use it when the camera is fixed and the objects move on their own (vehicles, people).

Controls:

- **Targets to track**: checkboxes, with **Select all** / **Deselect all**.
- **Up to frame**: the last frame to process.
- **Lucas-Kanade** parameters: **Window (px)** (search window, default 21; larger is more robust to fast motion but less precise), **Pyramid levels** (default 3; each level doubles the manageable displacement) and **Min pts** (default 4; below this number of tracked points the box is copied unchanged).
- **Track via optical flow**: starts the job.

For each box, the app tracks its four corners and a 5 x 5 grid of inner points (29 points), then fits a scale, rotation and translation transform, so the box grows or shrinks when the object approaches or moves away. The tab's info note states this; it does not compensate perspective, for which homography is the tool. If the fit fails, the box is only translated by the median displacement. Like homography, this tab only works forward, and results are saved as automatic, interpolated boxes with the provenance Flux opt., keeping the track of their source annotation.

### Run status, Logs and Tracks list of the Tracks panel

The bottom part of the Tracks panel follows the running job and lists the tracks of the current sequence.

**Run status**: while a job runs, a progress bar with the percentage and the latest message appears, with a **Stop** button (square icon). Detect. jobs also have **Pause** / **Resume**. The same job is shown by the green progress bar above the canvas, which also has a stop button.

**Logs** view: a real-time console with the same lines as the server terminal. The first line, starting with `$`, summarizes the command (algorithm, targets, frames, device); the following lines report progress. Errors are shown in red. **Clear** empties the console. The dot next to **Logs** pulses while a job runs.

**Tracks (N)** view: one row per track of the current sequence, with its color, its `#uid`, its class, its frame range (project-wide indices starting at 0) and its length. A green dot marks tracks present on the current frame. Click a row to go to the first frame of the track, double-click to go to its last frame, and use the trash icon to delete the track with all its annotations. **Clear all** deletes every track of the project but keeps the annotations, which become detached. To delete only a part of a track, use the track lanes of the timeline.

## Debug tab of the left sidebar

The **Debug** tab of the left sidebar (**Homography Debug**) checks whether homography propagation can work between two frames before you run it on a whole range.

Choose two frames (**Use current frame** fills one of them), then click **Compute homography**. The panel shows the **Method** (XFeat or SIFT), **Total matches**, **Filtered matches**, **RANSAC inliers**, **Inlier ratio**, **Valid homography** (**Yes** / **No**) and a picture of the **Keypoint correspondences** with inliers in green and outliers in red (at most 200 lines). **Valid homography** checks that the inlier ratio reaches the **Inlier ratio** set in the Settings window (0.3 by default), the same threshold as the propagation; the minimum inlier count used by propagation is not checked here.

Few inliers or a low ratio mean the scene lacks texture, the camera moved too much, or the scene is not planar: in that case prefer SAMURAI or optical flow for this sequence.

## Timeline and track lanes

The timeline at the bottom of the annotation workspace shows every frame of the current sequence as a compact cell. It has no thumbnails, so it stays fast on sequences of tens of thousands of frames and over SSH.

Frame cells:

- **Green** cells are annotated frames and show their annotation count; **red** cells have no annotation. The count of the current frame updates live.
- **Click** a cell to go to that frame. **Ctrl+click** adds or removes a frame from the selection, **Shift+click** selects a range, **Ctrl+A** (while the pointer is over the timeline) or **Select all** selects every frame of the sequence, and `Esc` clears the selection.
- **Delete** clears the annotations of all selected frames in one server request. A message confirms the number of frames and `Ctrl+Z` restores them.

Track lanes (Sequence Image projects) sit above the cells, one lane per track:

- A white bar marks the current frame on each lane; the percentage on the right is the share of frames the tracker explored.
- **Click a colored block** to select it (it glows) and jump to its first frame; **double-click** jumps to its last frame. `Delete` or **Delete this block** removes only the annotations of that track on that block, without confirmation.
- **Click the gray part** of a lane to select the whole track; **Ctrl/Shift+click** selects several tracks. `Delete` or the delete button removes the selected tracks and all their annotations, after confirmation. Remaining track numbers are renumbered.
- The `Delete` key acts on a selected block or track only while the pointer is over the timeline; `Esc` clears the frame, block and track selections.
- Drag the handle between the lanes and the cells to enlarge or shrink the lanes area.

## Import sequences window

The **Import sequences** window, opened with **Import** in the top toolbar, adds one or more sequences to the project. Each filled slot becomes one sequence; a new empty slot appears as soon as one is filled, so several sources can be queued at once.

The window title recalls the project type (**Import sequences** followed by **Sequence Image** or **Image Random**), and an **Importable formats** box lists the accepted sources. For each slot (**SEQ 1**, **SEQ 2**...):

- **Drag and drop** a folder of images (JPG, PNG, BMP, WebP, TIFF), a video (`.mp4`, `.avi`, `.mov`, `.mkv`, `.webm`) or a supported specific format, or use **browse locally**. In a web browser, dropped files are uploaded, even from a Windows network drive. In the VisionNexus shell, the real path of the dropped folder or file is used instead, as if you had typed it as a server path (no upload, no copy).
- **Or type a server path** (for example `/mnt/datasets/frames` or `/data/video.mp4`), or click **Server** to browse the backend's folders. A server path is referenced without copying (symbolic links) and is the recommended choice for large datasets. Windows UNC paths such as `\\share-host\datasets\run01` are translated to the backend path automatically. A `.txt` sequence list (one `path<TAB>name` line per sequence, as written by the automatic backup) fills all slots at once.
- **Sequence name**: defaults to the folder or file name. It becomes the subfolder or file name at export.

**Optimization options (applied to each sequence)**:

- **Video frame decimation**: **All**, **1/2** to **1/5**, or **1/N** to keep one frame out of N.
- **JPEG quality of extracted frames (MP4)**: 50 to 95, default 85.
- **Lossless PNG for MP4 (ignores JPEG quality)**: better for XFeat and optical flow, heavier on disk.
- **Symbolic links for server folders (recommended)**: no image copy; the app copies automatically if links are not allowed.
- **Frames per batch (background extraction)**: default 50.

Click **Import N sequence(s) in the background**: the window closes, the imports run one after the other and a blue progress bar per sequence appears above the canvas while you keep working. 16-bit PNG and TIFF sources stay 16-bit on disk; only their display and model input go through the LUT.

## Export the dataset window

The **Export the dataset** window, opened with **Export** in the top toolbar, exports the whole project at once into a folder named `<project>_<date>_<time>`: every sequence goes to its own subfolder or file named after the sequence. A project with a single sequence is exported flat in YOLO and COCO (no per-sequence subfolder).

- **Output format**:
  - **YOLO**: one `<sequence>-yolo/` folder per annotated sequence, with `images/`, `labels/` and `data.yaml` split into train, val and test. When polygons exist, a YOLO segmentation variant (`seg_labels/`, `seg_data.yaml`) is written as well.
  - **COCO JSON**: `images/` plus `annotations/instances_{train,val,test}.json`, pixel boxes, 1-based `category_id`, polygons as `segmentation`.
  - **.ver**: one `<sequence>.ver` text file per annotated sequence, pixel coordinates, 1-based frames, with track id and the three class levels.
- **Train** and **Validation** sliders (YOLO and COCO only), default 80 % and 10 %; the rest goes to test. A colored bar summarizes the split and a warning appears when a split is empty.
- **Symbolic links for images**: checked, the dataset folder links to the original images and no ZIP is produced (use it on the same server); unchecked, images are copied and a ZIP is generated.
- **Destination folder** (standalone mode only): leave empty to use the `exports/` folder of the workspace. When the app is launched by the Orchestrator, this field is replaced by a note: the export is saved automatically in the `exports/` folder of the workspace, whose path is shown.

Click **Export**. A progress view follows the job; at the end, **Export complete!** shows the dataset path (symbolic link mode) or a **Download ZIP** button (copy mode), plus **New export** and **Close**. For **.ver** in copy mode, the ZIP of the `.ver` files is offered as well. Formats are detailed in [Concepts](concepts.md) and the full procedure in [Workflows](workflows.md).

## Settings window

The **Settings** window opens from the gear button of the annotation workspace or from **Settings** on the projects page. Settings are stored per user in the workspace and apply to all projects.

It has collapsible sections:

- **Interface**: canvas background color, default tool, annotation opacity, labels and confidence display, border thickness, preview downscale, real-time live during propagation and canvas cadence.
- **Import**: JPEG quality, upload chunk size, frame decimation and image batch size.
- **Algorithms**: NMS, Grounding DINO, SAM2 Auto, homography, optical flow, SAM3, Detect. matching, SAMURAI and SAM2 video memory mode, global auto-stop.
- **Workspace storage**: the disk size of projects, JSON backups and exports, with **Empty this folder** buttons for backups and exports, and **Refresh**.
- **YOLO export**: default ratios, include unannotated frames, symbolic links.

The **Interface** and **Import** sections are open when the window opens; click a section title to fold or unfold it. Buttons at the bottom: **Reset** writes all defaults to the settings file at once (no **Save** needed), **Close** discards unsaved changes, **Save** (enabled once something changed) writes the settings, shows **Saved!** and reloads the page so that every option takes effect. Every option, its default and its effect are listed in [Configuration](configuration.md).

## Monitoring page

The Monitoring page, opened with **Monitoring** on the projects page, measures how much of the annotation work was done automatically and how much people had to correct.

Controls in the header:

- **Me** / **All users**: your workspace only, or every annotation workspace under the same workspaces root.
- **Detail** / **Global**: per project and sequence, or a summary per user and per workspace root.
- **All projects** selector: limits the detail view to one project.
- **Export HTML**: downloads a standalone report that opens offline.
- **Refresh**.

The page shows key figures (users, workspace roots, annotations, automatic, manual, sequences exported), each user's share of all and of manual annotations, and per project: **Auto**, **Manual**, **Auto reworked**, **Auto deleted**, **Frames reworked 2+ times**, the split by source (SAMURAI, Grounding DINO, manual...), the fate of automatic outputs (**Kept**, **Reworked**, **Deleted**), the list of sequences with a green check when exported, the human rework per dataset and the list of automatic runs.

Reworks and deletions are counted from an event log that starts when monitoring was first enabled; annotations that existed before count as kept. A sequence that is annotated but never exported is not considered finished.

## Convert page

The Convert page, opened with **Convert** on the projects page, converts annotation files between the `.ver` format and YOLO without creating a project. All paths are server paths.

Two converters are available:

- **.ver to YOLO**: converts a `.ver` file (pixel coordinates) into a normalized YOLO folder. Fill **.ver file path**, **Output YOLO folder** and the image resolution (width and height in pixels, needed to normalize), then click **Convert**. The result message gives the number of classes written.
- **YOLO to .ver**: converts a YOLO label folder into a `.ver` file. Fill **YOLO folder (.txt)**, **Output .ver file** and the image resolution (needed to convert back to pixels), then click **Convert**. YOLO has no subclass and no track: the class is repeated in the three class columns and `track_id` is `-1`. The result message gives the number of boxes written.

An error is shown when a required path is missing or when the output file already exists.

## Presentation page (built-in documentation)

The Presentation page, opened with **Presentation** on the projects page, shows this documentation inside Annotation App, under the title **Built-in documentation**. It reads the pages from the backend (`/api/docs`), so it is available offline and always matches the installed version.

The left column groups the pages in three sets: **User** (overview, user guide, workflows, concepts), **Setup and settings** (configuration, troubleshooting) and **Developer** (architecture, API reference, code map). Click a page to open it; the headings of the open page are listed under its name and scroll the page to that section when clicked. Links between pages open the target page and section directly, and the address of the page (`/presentation?doc=<page>#h-<n>`) can be kept as a bookmark.

The page follows the interface language. When a page does not exist in that language, the other version is shown with a notice. If the backend does not answer, the page says so: start the backend and reload. **Back to projects** returns to the projects page.

## Interactive tutorial

The interactive tutorial is a guided tour of Annotation App that runs on real data. Start it with **Interactive tutorial** on the projects page (the button glows until you have launched it once) or with **Start the interactive tutorial** in the help window.

The tour creates a demo project, **Template Cars Annotation**, from the ten sample images shipped with the suite (`data_tuto/` at the suite root), then walks through the complete workflow in about ten minutes: project creation, import, class creation, drawing a box, SAMURAI propagation, cleanup on the timeline, tracking two targets with segmentation, the **Detect.** tab, the LUT, export and settings. A second part creates **Template Traffic Lights**, an **Image Random** project annotated only with text detection in batch, then visits the Monitoring and Presentation pages.

Each step highlights the control to use and waits for your action. Demo projects are marked **Tutorial demo** on the projects page and can be deleted like any other project. Whether you have already launched or completed the tutorial is remembered by VisionNexus for your user.
