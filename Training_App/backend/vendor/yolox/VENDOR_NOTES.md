# YOLOX vendored (Apache-2.0)

Source : https://github.com/Megvii-BaseDetection/YOLOX
Version vendorisee : tag `0.3.0` (commit `419778480a`)
Licence : Apache License 2.0 (voir `LICENSE` dans ce dossier)

Contenu retire du depot upstream (non necessaire ici) : `assets/` (images de
demo du README), `demo/` (demos C++/ncnn/OpenVINO/MegEngine), `docs/`
(sphinx), `datasets/` (placeholder vide), `tests/` (suite de tests upstream),
`hubconf.py`, `MANIFEST.in`.

Cette copie est la source YOLOX unique de la suite. Training App l'utilise
pour l'entrainement et Inference App la reutilise pour charger les checkpoints,
ce qui evite une seconde copie vendoree et garantit la compatibilite des poids.

Ne pas modifier ce dossier directement : toute adaptation VisionNexus passe
par les modules qui l'entourent (`yolox_dataset.py`, `yolox_model.py`,
`yolox_trainer.py` cote Training App ; `inference_core/detectors.py` cote
Inference App).
