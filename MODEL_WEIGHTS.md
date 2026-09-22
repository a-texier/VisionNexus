*[Lire en francais](MODEL_WEIGHTS.fr.md)*

# Manual installation of model weights

This document is the reference for completing a bundle created with
`package_cv_bundle.py --without-weights`. Paths are relative to the
`Computer_Vision_App/` root. Model code and their configuration files stay
in the lightweight bundle; only the weights are stripped out.

## Lightweight bundle

```bash
python package_cv_bundle.py --all --without-format specialise --without-node-modules --without-weights
```

After extraction, recreate exactly the folders shown below and copy the
files into them. The applications do not silently download weights when
running in offline mode.

## Annotation App

| Purpose | Expected file or folder | Source |
|---|---|---|
| SAM2 and SAMURAI small | `Annotation_App/backend/checkpoints/sam2.1_hiera_small.pt` | `https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_small.pt` |
| Grounding DINO tiny | full folder `Annotation_App/backend/checkpoints/grounding_dino/` | HF repo `IDEA-Research/grounding-dino-tiny` |
| SAM3.1 multiplex | `Annotation_App/backend/checkpoints/sam3.1/sam3.1_multiplex.pt` and the JSON/tokenizer files from the same snapshot | gated HF repo `facebook/sam3.1` |
| XFeat | `Annotation_App/backend/models/xfeat/weights/xfeat.pt` | `verlab/accelerated_features` repo |
| LightGlue for XFeat | `Annotation_App/backend/models/xfeat/weights/xfeat-lighterglue.pt` | `verlab/accelerated_features` repo |
| Optional YOLO detector | path configured in Settings, or a `.pt/.onnx/.engine` file placed in the workspace | model trained by Training App |

Assisted download from `Annotation_App/`:

```bash
python backend/tests/download_all_models.py
```

SAM3.1 requires prior authorization on the repo and `hf auth login`.
Grounding DINO must keep at least `config.json`, the processor/tokenizer
files and a `model.safetensors` or `pytorch_model.bin` weight file.

## Dataset Explorer

| Purpose | Expected file | Source |
|---|---|---|
| CLIP ViT-B/32 embeddings | `Dataset_Explorer_App/models/ViT-B-32-openai.safetensors` | HF repo `timm/vit_base_patch32_clip_224.openai`, file `open_clip_model.safetensors` renamed |

The same file can be placed elsewhere and referenced through
`CLIP_WEIGHTS`. The architecture name must stay `ViT-B-32` to keep
compatibility with existing FAISS embeddings.

## Inference App

| Purpose | Expected file | Source |
|---|---|---|
| Native YOLOX detection | Any explicit `.pth` checkpoint path | a checkpoint produced by Training App, or an official YOLOX checkpoint matching the selected model size |
| Optional plugin detector | Any checkpoint format accepted by the installed detector plugin | documented by that plugin |

Inference App never downloads weights silently. The model path is selected in
the UI or supplied to the API. ByteTrack and OpenCV CSRT have no model weights
of their own: they consume the detector output or the clicked bounding box.



| Purpose | Expected location |
|---|---|
| EfficientNet backbones | `tf_efficientnet_lite3-b733e338.pth` and `tf_efficientnet_b5_ap-9e82fae8.pth` in the same `checkpoints/` folder |

The code repos associated with MiDaS, DINOv2, DSINE and Depth Anything must
also stay under their current folders. To automatically prepare the four

```bash
python backend/scripts/download_models.py --all
```

For Mask2Former, CLIP and BLIP-2, download the indicated snapshot on a
connected machine, then copy the whole folder to keep the configs,
tokenizers and weights together.

## Training and Optuna

In-house YOLOX training engine (`Training_App/backend/services/yolox_trainer.py`,
`VisionNexusYoloxTrainer`, no Ultralytics). No weights are downloaded
automatically by name: a run starts trained from scratch by default, or
from a `.pth` checkpoint provided explicitly (the `model_weights` field, an
absolute path). To start from a COCO pretrained model instead of from
scratch, download the official checkpoint matching the chosen size
(`yolox_s.pth`, etc., GitHub releases `Megvii-BaseDetection/YOLOX`,
Apache-2.0 -- the same files listed for Inference App above) and provide it
as `model_weights`. Trained models are then written to the workspace
(`.pth` checkpoints) and can be handed off to Inference and Annotation.

Orchestrator, DVC and MLflow have no model weights of their own.

## Quick check

```bash
python Annotation_App/backend/tests/download_all_models.py --skip-sam3
python -c "from pathlib import Path; assert Path('Dataset_Explorer_App/models/ViT-B-32-openai.safetensors').is_file()"
python -c "from pathlib import Path; assert Path(r'<YOUR_YOLO_CHECKPOINT>').is_file()"
```

A missing file must produce an explicit error on the relevant feature, not
a silent network download.
