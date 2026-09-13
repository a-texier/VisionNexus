# Tracker SOT : SAM 2 (Segment Anything Model 2)

## Section 1 : Principe

SAM 2 (Ravi et al., Meta 2024) est un modele de segmentation et de tracking universel
qui suit un masque de segmentation pixel-level en exploitant une memoire temporelle.
Il etend SAM au video via un Memory Bank : les features et masques des frames precedentes
sont stockes et utilises pour conditionner la segmentation de la frame courante via
une attention croisee temporelle. L'initialisation se fait depuis un simple point (x, y)
ou une bbox, sans entite pre-labelisee. SAM2 est le seul tracker du pipeline a produire
un masque de segmentation en plus de la bbox. Il necessite 6-8 GB VRAM (variant large)
ou 3-5 GB (variant tiny/small). Fallback automatique sur CSRT si VRAM insuffisante.

---

## Section 2 : Parametres YAML

Section `sam2:` dans le YAML.

| Parametre   | Type | Defaut                    | Plage            | Effet                                                           |
|-------------|------|---------------------------|------------------|-----------------------------------------------------------------|
| `weights`   | str  | ""                        | chemin .pt       | Chemin vers les poids SAM2. Vide = erreur explicite.           |
| `model_cfg` | str  | "sam2_hiera_large.yaml"   | voir tableau     | Architecture SAM2. Choisir selon VRAM disponible.              |

Modeles disponibles :

| model_cfg                     | Params | VRAM approx | Vitesse GPU |
|-------------------------------|--------|-------------|-------------|
| `sam2_hiera_tiny.yaml`        | 38M    | ~3 GB       | ~25 FPS     |
| `sam2_hiera_small.yaml`       | 46M    | ~4 GB       | ~20 FPS     |
| `sam2_hiera_base_plus.yaml`   | 80M    | ~5 GB       | ~15 FPS     |
| `sam2_hiera_large.yaml`       | 224M   | ~8 GB       | ~10 FPS     |

---

## Section 3 : Inputs / Outputs du workflow

**Entrees**

| Entree      | Type                     | Description                                                          |
|-------------|--------------------------|----------------------------------------------------------------------|
| `frame`     | `ndarray (H, W, ...)`    | Frame courante (utilisee pour l'encodage Hiera et la propagation)   |
| `click_pos` | `(x, y)`                 | Point de clic operateur (seul prompt utilise a l'init)              |
| `mot_tracks`| `list[Track]` ou `None`  | Accepte pour uniformite de l'interface, mais IGNORE par SAM2        |
| `H`         | non utilise par SAM2     | Transmis au fallback CSRT si actif                                  |

**Sorties de `update()`**

| Sortie  | Type                         | Description                                                    |
|---------|------------------------------|----------------------------------------------------------------|
| `ok`    | `bool`                       | True si SAM2 localise un masque valide pour l'objet suivi      |
| `bbox`  | `[x1,y1,x2,y2]` ou `None`   | Bbox englobante du masque de segmentation                      |
| `mask`  | `ndarray (H, W, uint8)` ou `None` | Masque binaire pixel-level (1=cible, 0=fond)              |

---

## Section 4 : Integration dans le pipeline

**Appelant** : `session.py`, via la state machine, apres un clic operateur.

**Particularite** : SAM2 est un tracker "point-only". `mot_tracks` est IGNORE dans `init()`.
Il n'a pas besoin d'une bbox MOT pour s'initialiser, contrairement a CSRT, DiMP et OSTrack.
C'est pourquoi SAM2 est le tracker privilegie pour les modes SOT solo (scenarios C, D)
et pour `tracker_sot_solo:` quand aucune track MOT n'est disponible.

**Flux d'init** :
1. Clic operateur (x, y) -> `sam2_sot.init(frame, click_pos, mot_tracks)`.
2. `mot_tracks` est ignore.
3. Verification VRAM : si libre < `vram_threshold_gb` -> fallback CSRT (avec bbox 40x40 autour du clic).
4. Import `sam2.build_sam` du repo clone (lazy) : si echec -> fallback CSRT.
5. `build_sam2_video_predictor(model_cfg, weights)` -> predictor.
6. `predictor.init_state(video_path=None)` -> inference_state.
7. `predictor.add_new_points(frame_idx=0, obj_id=1, points=[[x,y]], labels=[1])` : le clic est le prompt.

**Flux d'update** :
1. Session.py appelle `sam2_sot.update(frame)`.
2. Si fallback actif : delegue a `_fallback.update()` (CSRT).
3. Sinon : `predictor.propagate_in_video(inference_state, max_frame_num_to_track=1)`.
4. SAM2 produit `out_mask_logits` -> seuillage a 0.0 -> masque binaire.
5. `np.where(mask)` -> bbox englobante.
6. Retour (ok=True, bbox, mask) si masque non vide.

**Fallback CSRT** : actif si VRAM insuffisante, PyTorch absent, ou erreur d'init. Dans ce cas CSRT utilise une bbox 40x40 autour du clic (sans track MOT). Transparent pour session.py.

**Note sur la CMC** : SAM2 n'integre pas de Kalman CMC propre. H est ignore par SAM2 et transmis uniquement au fallback CSRT. La memoire temporelle de SAM2 compense partiellement le mouvement camera en "se souvenant" de la forme de l'objet.

**Interaction state machine** : identique aux autres SOT. Echec (masque vide) -> sot_miss -> retour MOT ou IDLE.

---

## Section 5 : Conseils de reglage

**Choix du variant selon le GPU** :
- Jetson Orin 8 GB avec YOLO (~3 GB) : budget GPU residuel ~4-5 GB -> `sam2_hiera_small` ou `sam2_hiera_base_plus`.
- GPU dedie 8 GB (RTX 3070/4070) sans YOLO : `sam2_hiera_large` possible.
- `vram_threshold_gb: 4.0` : ajuster selon le variant choisi et les autres modeles actifs.

**Mode SOT solo (scenarios C, D)** :
- SAM2 est optimal ici car il n'a pas besoin de track MOT.
- Un clic precis sur la cible suffit. Pas de boite fallback approximative.
- La memoire temporelle retrouve la cible apres une breve occultation.

**Cibles IR vs RGB** :
- SAM2 a ete entraine sur des datasets RGB. Sur IR pur (uint16), les features peuvent etre moins discriminantes.
- Preferer CSRT ou Tracking_TOPHAT si la cible est minuscule (< 10 px) : SAM2 a du mal a segmenter les micro-objets.
- SAM2 excelle sur les cibles avec contours bien definis en IR (vehicules, corps humains proches).

**Occultations longues** :
- SAM2 est le seul tracker du pipeline avec memoire temporelle : il peut retrouver une cible apres une occultation de plusieurs frames grace au Memory Bank.
- Augmenter `sot_loss_threshold` si la cible disparait souvent temporairement.

**Temps reel** :
- `sam2_hiera_large` a ~10 FPS est marginal a 10 Hz pipeline. Preferer `sam2_hiera_small` (~20 FPS) pour rester en temps reel.
- `save_frames: false` et `save_video: false` pour reduire la charge I/O si FPS limite.
