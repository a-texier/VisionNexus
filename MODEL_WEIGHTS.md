# Installation manuelle des poids de modèles

Ce document est la référence pour compléter un bundle créé avec
`package_cv_bundle.py --without-weights`. Les chemins sont relatifs à la racine
`Computer_Vision_App/`. Le code des modèles et leurs fichiers de configuration
restent dans le bundle léger ; seuls les poids sont retirés.

## Bundle léger

```bash
python package_cv_bundle.py --all --without-format specialise --without-node-modules --without-weights
```

Après extraction, recréer exactement les dossiers indiqués ci-dessous et y
copier les fichiers. Les applications ne téléchargent pas silencieusement de
poids lorsqu'elles fonctionnent en mode hors ligne.

## Annotation App

| Fonction | Fichier ou dossier attendu | Source |
|---|---|---|
| SAM2 et SAMURAI small | `Annotation_App/backend/checkpoints/sam2.1_hiera_small.pt` | `https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_small.pt` |
| Grounding DINO tiny | dossier complet `Annotation_App/backend/checkpoints/grounding_dino/` | dépôt HF `IDEA-Research/grounding-dino-tiny` |
| SAM3.1 multiplex | `Annotation_App/backend/checkpoints/sam3.1/sam3.1_multiplex.pt` et les JSON/tokenizer du même snapshot | dépôt HF protégé `facebook/sam3.1` |
| XFeat | `Annotation_App/backend/models/xfeat/weights/xfeat.pt` | dépôt `verlab/accelerated_features` |
| LightGlue pour XFeat | `Annotation_App/backend/models/xfeat/weights/xfeat-lighterglue.pt` | dépôt `verlab/accelerated_features` |
| Détecteur YOLO optionnel | chemin configuré dans Paramètres, ou fichier `.pt/.onnx/.engine` placé dans le workspace | modèle entraîné par Training App |

Téléchargement assisté depuis `Annotation_App/` :

```bash
python backend/tests/download_all_models.py
```

SAM3.1 nécessite au préalable l'autorisation du dépôt et `hf auth login`.
Grounding DINO doit conserver au minimum `config.json`, les fichiers du
processor/tokenizer et un poids `model.safetensors` ou `pytorch_model.bin`.

## Dataset Explorer

| Fonction | Fichier attendu | Source |
|---|---|---|
| Embeddings CLIP ViT-B/32 | `Dataset_Explorer_App/models/ViT-B-32-openai.safetensors` | dépôt HF `timm/vit_base_patch32_clip_224.openai`, fichier `open_clip_model.safetensors` renommé |

Le même fichier peut être placé ailleurs et référencé par `CLIP_WEIGHTS`.
Le nom d'architecture doit rester `ViT-B-32` afin de conserver la compatibilité
avec les embeddings FAISS existants.

## Inference App

| Fonction | Fichier attendu | Source |
|---|---|---|
| Détection YOLO par défaut | `Inference_App/tracker/weights/last.pt` | sortie `best.pt`/`last.pt` de Training App |
| Variante ONNX/TensorRT | chemin défini par `weights_yolo` dans le scénario | export depuis `tracker/tools/convert_pt_onnx_engine.py` |
| SOT SAM2 optionnel | `Inference_App/tracker/trackers/sot/sam2/sam2/checkpoints/<checkpoint>.pt` | script `checkpoints/download_ckpts.sh` du dépôt SAM2 embarqué |
| OSTrack optionnel | `Inference_App/tracker/trackers/sot/ostrack/OSTrack/pretrained_models/<checkpoint>.pth` | checkpoint correspondant au YAML OSTrack choisi |
| DiMP/ATOM/KYS optionnels | dossier de réseaux configuré par PyTracking | checkpoints correspondant au tracker activé |

ByteTrack n'a pas de poids propres : il utilise les détections du modèle YOLO.
BoT-SORT et BoostTrack peuvent demander des poids ReID supplémentaires seulement
si leur option ReID est activée ; leur chemin est défini dans le scénario choisi.


La source de vérité des chemins est

| Fonction | Emplacement attendu |
|---|---|
| Backbones EfficientNet | `tf_efficientnet_lite3-b733e338.pth` et `tf_efficientnet_b5_ap-9e82fae8.pth` dans le même dossier `checkpoints/` |

Les dépôts de code associés à MiDaS, DINOv2, DSINE et Depth Anything doivent
également rester sous leurs dossiers actuels. Pour préparer automatiquement les

```bash
python backend/scripts/download_models.py --all
```

Pour Mask2Former, CLIP et BLIP-2, télécharger le snapshot indiqué sur une
machine connectée, puis copier tout le dossier pour conserver configurations,
tokenizers et poids.

## Training et Optuna

Ultralytics accepte un nom officiel (`yolov8n.pt`, `yolo11n.pt`, etc.) ou un
chemin local. En environnement hors ligne, placer le modèle initial à la racine
de `Training_App/` ou `Optuna_App/`, ou fournir son chemin absolu dans la
configuration. Les modèles entraînés sont ensuite écrits dans le workspace et
peuvent être transmis à Inference et Annotation.

Orchestrator, DVC et MLflow n'ont pas de poids de modèle propres.

## Vérification rapide

```bash
python Annotation_App/backend/tests/download_all_models.py --skip-sam3
python -c "from pathlib import Path; assert Path('Dataset_Explorer_App/models/ViT-B-32-openai.safetensors').is_file()"
python -c "from pathlib import Path; assert Path('Inference_App/tracker/weights/last.pt').is_file()"
```

Une absence doit produire une erreur explicite sur la fonctionnalité concernée,
pas un téléchargement réseau implicite.
