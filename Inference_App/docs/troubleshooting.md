---
app: inference
doc_type: troubleshooting
audience: both
lang: en
title: Troubleshooting
order: 50
tags: [errors, cuda, csrt, checkpoint, evaluation, orchestrator]
sources: [Inference_App/backend/main.py, Inference_App/backend/inference_core/media.py, Inference_App/backend/inference_core/detectors.py, Inference_App/backend/inference_core/runner.py, Inference_App/backend/inference_core/models.py, Inference_App/backend/inference_core/evaluation.py]
---

# Troubleshooting

## "source introuvable" when reading a media

**Symptom**: clicking **Lire le média** shows an error containing "source introuvable" or "le dossier ne contient aucune image prise en charge".

**Cause**: `POST /api/media/inspect` checks the path on the backend machine: a missing file or folder, or a folder with no image of a supported extension (`.bmp`, `.jpeg`, `.jpg`, `.png`, `.tif`, `.tiff`), fails before anything is loaded. A path valid on your workstation means nothing when the backend runs on a remote VM.

**Solution**:

1. Check the path as seen by the backend, not by your workstation.
2. For a folder source, check that it directly contains image files with a supported extension (no recursive search into subfolders).
3. For a single-file source, check the extension is one of `.avi`, `.m4v`, `.mkv`, `.mov`, `.mp4`, `.webm` (video) or the image extensions above.

## "format non pris en charge" for a valid-looking file

**Symptom**: **Lire le média** or **Lancer** fails with "format non pris en charge : <extension>".

**Cause**: the file extension is not in the app's fixed list of supported extensions (see the previous entry), even if the file itself is a valid, readable media file under a different container or extension (for example `.gif`, `.flv`, `.wmv`).

**Solution**: convert or rename the file to a supported extension before using it; re-encoding a video with ffmpeg to `.mp4` usually resolves this.

## Run fails with a checkpoint loading error

**Symptom**: **Lancer** or **Évaluer** fails with a message mentioning `state_dict`, `size mismatch`, or another `torch.load` failure.

**Cause**: **Fichier de poids** does not point to a YOLOX checkpoint compatible with the **Architecture** size selected, or the checkpoint's class count does not match what is expected. `YoloxDetector` infers the number of classes directly from the checkpoint's classification layer, then requires `class_names` (from `config.yaml`) to either be empty (generic `class_0`, `class_1`... labels are used) or match that count exactly.

**Solution**:

1. Check that **Architecture** matches the size the checkpoint was trained with (a `yolox-m` checkpoint loaded as `yolox-s` has mostly incompatible layer shapes).
2. If `class_names` is set in **Config YAML**, check its length matches the number of classes the checkpoint was trained on; clear it to use generic labels while diagnosing.
3. Check that the file is a genuine YOLOX checkpoint (from Training App or an official YOLOX release), not a file from another framework saved with a `.pth` extension.

## CUDA out of memory during a run or evaluation

**Symptom**: **Lancer** or **Évaluer** fails with a message containing `CUDA out of memory`.

**Cause**: the model at the current **Architecture** size and image resolution no longer fits in GPU memory, often because another process (a Training App run, another Inference App run, another user) already uses the GPU.

**Solution**:

1. Check with `nvidia-smi` on the backend machine whether another process already uses the GPU memory.
2. Choose a smaller **Architecture** size, or set `device: cpu` in **Config YAML** (slower, but without a VRAM limit).
3. Avoid running a Training App run and an Inference App run on the same GPU at the same time.

## SOT run fails with "le clic SOT ne touche aucune detection"

**Symptom**: starting a run in **SOT par clic** mode fails with "le clic SOT ne touche aucune detection sur la premiere frame".

**Cause**: the click on the preview did not land inside any box the detector found on the first frame; the point must be strictly inside a detected box, not merely close to the object.

**Solution**:

1. Zoom in mentally on the preview before clicking, or click nearer the center of the object.
2. Lower **Confiance** so more (weaker) detections appear on the first frame, giving more clickable area.
3. If the object genuinely is not detected on the first frame, choose a different starting frame is not possible from the interface; use **Multi-objet** with ByteTrack instead, which does not require an initial click.

## The tracked object in SOT mode drifts onto the wrong region

**Symptom**: in **SOT par clic** mode, the highlighted box gradually or suddenly moves onto the background or another object, and never recovers.

**Cause**: CSRT has no notion of object class or confidence; once it loses the original object (fast motion, full occlusion, a visually similar object crossing paths), it keeps following whatever region best matches its internal appearance model, with no automatic recovery (see [Concepts](concepts.md)).

**Solution**: there is no way to reselect the object mid-run; if drift happens early, restart the run and click a frame closer to where the object becomes trackable, or switch to **Multi-objet** with ByteTrack, which re-detects the object on every frame instead of tracking pure appearance.

## Evaluation fails with "aucune image trouvee pour le split" or "la cle 'names' est absente"

**Symptom**: **Évaluer** fails with "aucune image trouvee pour le split 'val'" or "la cle 'names' est absente du data.yaml".

**Cause**: the given `data.yaml` either has no `val` key, or its `val` entry (a folder, a `.txt` list of images, or a single image path) resolves to no readable image after joining it with `path` (or the `data.yaml`'s own folder when `path` is absent); or the file has no `names` key at all. Evaluation only ever reads the `val` split, never `train` or `test`.

**Solution**:

1. Open the `data.yaml` and check it has both `val` (or `path` plus a `val` entry resolving under it) and `names`.
2. Check that the images referenced by `val` actually exist at the resolved path, from the backend's point of view.
3. If only `train` and `test` are populated, temporarily point `val` at a labeled subset to run an evaluation.

## Evaluation runs but every image scores mAP 0

**Symptom**: **Évaluer** completes without error, but **mAP50** and **mAP50-95** are both 0, or very close to it.

**Cause**: ground-truth labels are not found for the validation images. Labels are looked up by replacing the last `images` segment of each image's path with `labels` and keeping the same file stem with a `.txt` extension (for example `.../images/val/0001.jpg` -> `.../labels/val/0001.txt`); an image path without an `images` segment, or label files under a different naming scheme, silently yield zero ground truth for every image rather than an error.

**Solution**:

1. Check that the dataset follows the `images/<split>/...` and `labels/<split>/...` convention, mirrored folder for folder.
2. Check that at least one non-empty `.txt` label file exists next to (in the mirrored `labels/` location of) a validation image.
3. Check that **Architecture** and **Fichier de poids** are actually the right model for this dataset; a mismatched model can also score near 0 with correct ground truth.

## The Orchestrator inference or evaluation node fails

**Symptom**: an Orchestrator pipeline's Inference node fails with "echec inference: ..." or "echec evaluation: ...", or "sequence_dir requis pour le benchmark tracker" / "data_yaml requis pour l'evaluation detection".

**Cause**: `POST /api/orchestrator/infer` always requires `sequence_dir`; `POST /api/orchestrator/evaluate` requires `data_yaml` for a detection evaluation and `sequence_dir` for a tracker benchmark. A pipeline whose upstream nodes did not resolve one of these (a Training node that has not finished, a missing annotation export) sends an empty value and the call is rejected before any inference starts.

**Solution**:

1. Check that the upstream nodes (Training, Annotation, a dataset source) completed and actually produced the path the Inference node expects.
2. Check the node's resolved parameters in the Orchestrator's pipeline view before running; an unresolved placeholder is usually visible there.
3. Re-run the node once the upstream dependency is fixed; the Inference node itself needs no separate configuration for this class of failure.

## The backend does not start

**Symptom**: the backend terminal stops with an error at startup, and the interface shows nothing or "the backend is not responding".

**Cause and solution by message**:

- `ModuleNotFoundError: No module named 'yolox'`: `inference_core/detectors.py::YoloxDetector` imports the vendored YOLOX code from `Training_App/backend/vendor/yolox/`; check that `Training_App/` exists next to `Inference_App/` in the repository.
- `RuntimeError: CSRT indisponible : installez opencv-contrib-python`: the installed OpenCV build lacks the CSRT tracker (needed only for **SOT par clic** mode); install `opencv-contrib-python` (or `opencv-contrib-python-headless` on a headless backend) instead of the base `opencv-python` package.
- `Address already in use` / port 8065 in use: another instance is already running. Let the launcher allocate a free port, or find and stop the process (`netstat -ano | findstr :8065` then `taskkill /PID <pid> /F` on Windows).
- Errors about CUDA or `torch`: the installed PyTorch build does not match the driver. Check `nvidia-smi` and `python -c "import torch; print(torch.__version__, torch.version.cuda)"`, then reinstall PyTorch for the right CUDA version.

For the frontend, `Cannot find module 'vite'` means the frontend dependencies are missing: run `npm install` in `frontend/`.
