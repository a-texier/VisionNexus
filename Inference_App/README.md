*[Lire en francais](README.fr.md)*

# VisionNexus Inference App

Public, compact application for running a YOLO model on an image, a video, or
a folder of images.

## Features

- reads `png`, `jpg`, `jpeg`, `bmp`, `tif`, `webp`, `mp4`, `avi`, `mov`,
  `mkv` and `webm`;
- pure YOLO inference, with no tracker imposed;
- multi-object detection with optional ByteTrack;
- single-object tracking: click a YOLO detection, then OpenCV CSRT tracking;
- detection evaluation: mAP50, mAP50-95, PR curve, F1 curve and confusion
  matrix;
- separate benchmarking of detector time, tracker time, and the full
  pipeline;
- per-workspace YAML configuration;
- integration with the VisionNexusElectron launcher and the Orchestrator's
  Inference node.

YOLOX is the native engine. Other engines can be added through the plugin
registry without modifying this application.

## Launching

From the `Computer_Vision_App` root:

```powershell
python launcher.py --app inference --workspace C:\VisionNexusWorkspaces --user alice
```

The backend uses port 8065 and the frontend port 5177 by default. The common
launcher automatically picks other ports on conflict.

## Layout

```text
Inference_App/
  backend/
    main.py                 FastAPI API
    inference_core/
      media.py              media reading
      detectors.py          YOLOX + plugin contract
      bytetrack.py          optional MOT association
      runner.py             inference, MOT and SOT/CSRT
      evaluation.py         detection metrics and plots
  config/defaults.yaml      documented settings
  frontend/                 React/Vite interface
  docs/                     architecture and integration
  tests/                    unit tests
```

## Tests

```powershell
pytest Inference_App/tests -q
cd Inference_App/frontend
npm run build
```
