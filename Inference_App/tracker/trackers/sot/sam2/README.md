# Tracker SOT SAM 2

**Niveau 3** - SOT lourd, optionnel. GPU requis.

## Clé CLI
`--tracker-sot sam2`

## Installation

```bash
cd trackers/sot/sam2
git clone https://github.com/facebookresearch/sam2
cd sam2
pip install -e .
mkdir checkpoints && cd checkpoints
wget https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_large.pt
```

## Performances (Jetson Orin nano 8 GB)
- VRAM : 6-8 GB
- **Tendu** sur Jetson Orin nano 8 GB avec YOLO simultané
- Compatible Jetson Orin 32 GB sans problème
- Si VRAM libre < `vram_threshold_gb` (défaut 6.0 GB) : fallback CSRT automatique

## Spécificités
- Init par **point (x, y)**, pas bbox
- Retourne un **masque de segmentation** en plus de la bbox
- Propagation vidéo frame-by-frame via `propagate_in_video`
