# Tracker SOT Tracking_TOPHAT (adaptatif)

**Niveau 1** - CPU, sans GPU (mode `tophat`). GPU optionnel pour le mode `resnet`.

Detection-par-segmentation (multi-kernel Top-Hat + multi-seuil) + association par
**features** (géométrie / intensité / fond / mouvement / apparence), avec une **ROI
et une bbox dont la taille s'adapte** (EMA) à celle de la cible.
Voir `algo.md` pour le détail complet du pipeline et des hyperparamètres.

## Clé CLI
`--tracker-sot tracking_tophat`

## Init
Bbox `(x1, y1, x2, y2)` depuis une track MOT, sinon TopHat ROI au clic, sinon
taille Tracking_TOPHAT mémorisée, sinon carré `fallback_bbox_size_px`.

## Points clés
- **BBox adaptative** : la sortie suit la taille réelle du blob (EMA) - rétrécit ET
  grandit (corrige l'ancien `max(blob, last)` qui ne pouvait que grandir).
- **Multi-kernel / multi-seuil** : capture la cible à différentes échelles/contrastes
  (`tophat_kernels`, `k_sigma_levels`). Coût ∝ nombre de passes × taille ROI.
- **Feature matching** : score pondéré (`w_geometry/intensity/background/motion/appearance`)
  vs un profil de cible mis à jour par EMA. Largement tolérant à l'échelle.
- **ROI bornée** par `max_search_radius_px` -> coût temps réel garanti.

## Performances (Jetson Orin Nano 8 GB, ordre de grandeur)
- Mono-pass (`tophat_kernels: []`)         : ~1–3 ms/frame
- Recommandé (`[3,5,7] × [2.5]`, 3 passes)  : ~3–10 ms/frame (cible petite/moyenne)
- Jetson léger (`[3,7] × [2.5]`, `w_appearance: 0`) : ~2× plus rapide
- Mode `resnet` : ~15–40 ms CPU, ~4–8 ms GPU
- VRAM : 0 MB (tophat) | ~650 MB (resnet GPU)

## Réglage rapide
- Cible qui change de taille -> augmenter `tophat_kernels`, `size_ema_alpha` ~0.3.
- Faux positifs sur fond chaud -> `k_sigma_levels: [3.0]`, `w_background` ↑, `feature_match_threshold` ↑.
- Budget serré -> 2 passes `[3,7]`, `w_appearance: 0`, `max_search_radius_px: 120`.
