# Tracker SOT DiMP

**Niveau 2** - SOT IA léger, GPU recommandé.

## Clé CLI
`--tracker-sot dimp`

## Installation

```bash
cd trackers/sot/dimp
git clone https://github.com/visionml/pytracking
cd pytracking
pip install -r requirements.txt
# Télécharger les poids DiMP50 :
# https://drive.google.com/drive/folders/1WVhJqvdu-_JG1U-V0IkFXTd6QeWKB3_h
# -> placer dans pytracking/pytracking/networks/dimp50.pth.tar
```

## Performances (Jetson Orin nano 8 GB)
- VRAM : ~2 GB
- FPS tracker seul : ~25 FPS sur GPU
- Compatible avec YOLO simultané (~6 GB total)
- Si VRAM < 4 GB libre : fallback automatique sur CSRT + WARNING log

## Fallback CSRT
Activé automatiquement si :
- `torch.cuda.is_available()` = False
- VRAM libre < `vram_threshold_gb` (défaut 4.0 GB)
- pytracking non installé
