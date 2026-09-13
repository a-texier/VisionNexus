# Tracker SOT CSRT

**Niveau 1** - CPU, sans GPU. Inclus dans OpenCV.

## Clé CLI
`--tracker-sot csrt`

## Init
Passe une bbox `(x, y, w, h)` - coordonnées pixel, espace image source.

## Performances (Jetson Orin nano 8 GB)
- ~1 ms/frame sur CPU
- VRAM : 0
- Robustesse : correcte pour déplacements lents, se perd sur occultations longues
