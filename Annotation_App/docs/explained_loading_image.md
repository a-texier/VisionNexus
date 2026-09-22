*[Lire en francais](explained_loading_image.fr.md)*

# Frame Loading And RAM Management — Full Explanation

## 1. Frames stored on disk — what are they for?

### MP4 video / image folder

When you import a video or images, each frame is **extracted and written as JPEG to disk**:

```
data/projects/{project_id}/frames/
    frame_000000.jpg   <- full-resolution image (e.g. 1920x1080)
    frame_000001.jpg
    ...
    frame_000999.jpg

data/projects/{project_id}/thumbnails/
    frame_000000_thumb.jpg   <- 160x90 thumbnail for the timeline
    frame_000001_thumb.jpg
```

### format specialise file

For `.optional` files, the conversion is different. Frames are converted to **lossless PNG** and stored **next to the .optional file** (not in `data/`):

```
{format specialise_file_folder}/
    my_video.optional              <- source file (unmodified)
    my_video_png/              <- folder created on import
        frame_000000.png       <- full-resolution image, lossless
        frame_000001.png
        ...
        frame_000999.png

data/projects/{project_id}/thumbnails/
    frame_000000_thumb.jpg     <- thumbnails generated during conversion
```

The decision to store PNGs next to the .optional file (rather than in `data/`) avoids duplicating large datasets inside the workspace. YOLO export can symlink directly to these PNGs without creating an intermediate JPEG.

---

This folder is **the permanent source of truth**. Frames are not in the SQLite database (too heavy) -- SQLite only stores metadata (name, index, is_extracted) and annotations.

---

## 2. When you click on frame 100 — what happens?

**Nothing is pre-loaded into Python RAM.** Here is the exact flow:

```
Click frame 100
    -> React sets currentFrameIndex = 100
    -> Canvas makes an HTTP request GET /media/projects/1/frames/frame_000100.jpg
    -> FastAPI (StaticFiles) reads the file from disk
    -> The JPEG file is streamed to the browser
    -> The browser decodes the JPEG and displays it on the Konva.js canvas
    -> Python RAM = 0 bytes retained
```

The Python server keeps **no frame in memory**. FastAPI's StaticFiles open the file, stream it, and close it. It is the **browser** that caches the JPEG in its internal memory (HTTP cache).

> **Direct answer:** when you click on frame 100, it is loaded from disk on the fly. It was not pre-loaded into RAM.

---

## 3. Background extraction — RAM used

Background extraction works like this:

```python
for batch in batches:                    # e.g. batch of 10 frames
    for filename, source_idx in batch:
        cap.seek(source_idx)             # seek within the video
        frame = cap.read()               # ONE frame in RAM (~6 MB for 1080p)
        cv2.imwrite(frame_path, frame)   # written to disk as JPEG
        del frame                        # RAM freed immediately
    db.commit()                          # update is_extracted in the DB
```

**Maximum RAM during extraction = 1 frame at a time, ~6 MB for 1080p.**

The "Frames per batch" parameter (default 10) only controls:
- The number of frames between two DB commits
- The update frequency of the progress bar
- **NOT RAM usage** (always 1 frame in RAM at a time)

At the end of extracting 1000 frames:
- OK: 1000 JPEG files on disk
- OK: 0 frames in Python RAM
- OK: the browser can load any frame on demand

---

## 4. Video chunk upload — RAM during HTTP upload

When you upload a 162 MB video:

```
The browser sends the file in a single multipart HTTP request
    -> FastAPI reads the incoming stream in N MB chunks (chunk_size_mb)
    -> Each chunk is written to disk immediately
    -> next chunk read, and so on
    -> Server RAM during upload = N MB maximum
```

With chunk_size_mb = 8 MB: max RAM = **8 MB** (not 162 MB).
With chunk_size_mb = 200 MB: max RAM = **200 MB** (faster if you have the RAM).
With chunk_size_mb = 1000 MB: the entire file is buffered in RAM before being written.

> **For a 1 GB MP4:** with chunk=8 MB, max RAM = 8 MB. Without chunking = 1 GB of RAM.

---

## 5. JPEG and algorithms — Real problem and solutions

### What currently happens

The algorithms (ByteTrack, XFeat/SIFT homography, Lucas-Kanade optical flow) use **the same JPEG files** as the canvas display. They load frames via `cv2.imread()` from disk.

```python
frame = cv2.imread("frame_000100.jpg")   # compressed JPEG
result = compute_homography(frame_prev, frame_curr)  # on compressed data
```

### Impact of JPEG compression on the algorithms

| Algorithm | JPEG impact | Explanation |
|---|---|---|
| ByteTrack (box tracking) | Low | Uses the annotated bounding boxes, not the pixels |
| XFeat/SIFT homography | Moderate | Keypoint detection = sensitive to block artifacts |
| Lucas-Kanade optical flow | Moderate | Pixel gradients = JPEG artifacts can distort the vectors |
| Grounding DINO / SAM2 | Low | The models are robust to compression |

### Solutions depending on your needs

**Option A — Quality 95 (recommended for algorithms)**: in the optimization options, raise the quality to 95. JPEG 95 = nearly invisible artifacts, size ~3x larger than Q85.

**Option B — Quality 100**: JPEG 100 is near-lossless (~10x larger than Q85). Nearly identical to PNG but is still JPEG (DCT encoding with rounding).

**Option C — PNG storage (lossless, implemented for format specialise)**: storing frames as PNG guarantees zero loss. Impact: disk size 5-10x larger than JPEG. **For format specialise files, this is the default and mandatory behavior** -- all frames are converted to lossless PNG in `{format specialise_dir}/{format specialise_stem}_png/`. For MP4, frames stay as JPEG.

> **Summary:** for sensitive algorithms (homography, optical flow), use **quality 95+**. For plain annotation (ByteTrack, manual annotation), 85 is enough.

---

## 6. Full summary — Who uses what

```
+------------------------------------------------------------------------+
|  MP4/IMAGE SOURCE:                                                     |
|  data/projects/{id}/frames/frame_XXXXXX.jpg (JPEG, disk)               |
+--------------------------------------------------------------------------+
|  format specialise SOURCE:                                                           |
|  {format specialise_dir}/{format specialise_stem}_png/frame_XXXXXX.png (lossless PNG, disk)        |
+------------------------------------------------------------------------+
         |                              |
         v                              v
+------------------------+    +-----------------------------------------+
|  CANVAS DISPLAY        |    |  CV ALGORITHMS                          |
|  HTTP GET -> browser   |    |  cv2.imread() -> numpy array            |
|  Python RAM = 0        |    |  Python RAM = 1 frame (~6-25 MB)        |
|  Browser RAM = cache   |    |  Freed after processing                 |
+------------------------+    +-----------------------------------------+

THUMBNAILS (160x90): generated during extraction/conversion, stored in
data/projects/{id}/thumbnails/. Used in the timeline and the
frames panel. Never used by the algorithms.
```

---

## 7. Optimization parameters — quick guide

| Parameter | Default | Recommendation |
|---|---|---|
| JPEG quality | 85 | 85 for annotation, 95 for algorithms |
| Upload chunk RAM | 8 MB | 8 MB (low RAM) -> 200 MB (plenty of RAM, faster upload) |
| Frames per extraction batch | 10 | 10-50 depending on the desired CPU load |
| Decimation | All | 1/2 or 1/3 for videos > 30fps if frames are redundant |
