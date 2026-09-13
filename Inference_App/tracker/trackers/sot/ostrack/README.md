# Tracker SOT OSTrack

**Niveau 2 bis** - Transformer one-stream, GPU requis.

## Clé CLI
`--tracker-sot ostrack`

## Installation

```bash
cd trackers/sot/ostrack
git clone https://github.com/botaoye/OSTrack
cd OSTrack
pip install -r requirements.txt
# Poids : https://drive.google.com/drive/folders/1ttafo0O5S9DkYB0P_LaxRyAMQwlag
# -> placer dans OSTrack/output/checkpoints/train/ostrack/vitb_256_mae_ce_32x4_ep300/
```

## Performances (Jetson Orin nano 8 GB)
- VRAM : ~3 GB (ViT-Base)
- Compatible avec YOLO si VRAM totale ≥ 10 GB
- Si VRAM < 4 GB libre : fallback automatique sur CSRT
