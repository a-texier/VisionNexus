# Tracker SOT : Tracking_TOPHAT (Poursuite par Composantes Connexes)

## Section 1 : Principe

Tracking_TOPHAT est un tracker SOT « detection-par-segmentation + association par features »,
conçu pour les cibles IR (drones, points chauds) dont **la taille varie** au cours
de la séquence (cible qui s'approche / s'éloigne).


**Pipeline par frame (état SOT) :**

```
FRAME IR
  |
  v  1. CMC / Homographie H        (warp du dernier centre sous H)
  v  2. Kalman prediction           -> centre predit (cx_pred, cy_pred) + vitesse
  v  3. Search ROI ADAPTATIVE       centre = predit Kalman
  |       taille = roi_size_factor x diametre_EMA_blob + vel_radius_factor x vitesse
  |       bornee par [search_radius_px .. max_search_radius_px]
  v  4a. Multi-kernel White TopHat  noyaux white_tophat_kernels (cible chaude sur fond froid)
  v  4b. Multi-kernel Black TopHat  noyaux black_tophat_kernels (cible froide sur fond chaud)
  |       les deux listes sont combinees - une liste vide = detection desactivee pour ce type
  v  5. Multi-threshold             seuils adaptatifs k_sigma_levels = [2.5] (mediane + k*MAD)
  v  6. Candidats combines          via _detect_candidates_multi() - coeur commun MOT/ROI/Tracking_TOPHAT
  v  7. Duplicate fusion Tracking_TOPHAT        suppression doublons riche (IoU + distance + max_candidates)
  v  8. Feature extraction          par candidat : geometrie / intensite / fond / mouvement
  v  9. Feature matching            score global pondere vs profil EMA de la cible
  v 10. Best blob selection         meilleur score >= feature_match_threshold ET dist <= max_dist_px
  |
  +-- INVALIDE -> miss++ -> apres sot_loss_threshold misses : retour MOT / IDLE
  |
  +-- VALIDE :
        v Kalman update(cx_blob, cy_blob)            + reset compteur miss
        v EMA bbox width/height                      -> BBOX adaptative (sortie)
        v EMA blob diameter                          -> search ROI de la frame suivante
        v EMA profil de features                     -> matching de la frame suivante
        v (option) maj template d'apparence          si w_appearance > 0
        v SORTIE bbox = centre_blob +/- (EMA_w, EMA_h)
```

**Features extraites par candidat** (cheap, bornées à la ROI) :

| Famille | Features | Rôle |
|---|---|---|
| Géométrie | largeur, hauteur, diamètre, ratio w/h, aire | tolérant à l'échelle (ratio) + sensible à la taille (diamètre) |
| Intensité | moyenne / max / écart-type du blob | signature radiométrique de la cible |
| Fond | moyenne/écart-type de l'anneau autour, contraste, **SNR** | discrimine cible vs fond chaud |
| Mouvement | distance au centre prédit Kalman | cohérence spatio-temporelle (gate `max_dist_px`) |
| Apparence (option) | NCC (mode `tophat`) ou cosinus ResNet18 (mode `resnet`) | discrimination fine ; pèse `w_appearance` (0 = OFF) |

**Score global** = somme pondérée normalisée des similarités par famille
(poids `w_geometry`, `w_intensity`, `w_background`, `w_motion`, `w_appearance`).
Chaque similarité géométrie/intensité/fond est une gaussienne sur l'écart **relatif**
au profil cible (donc tolérante à l'échelle). Un blob est retenu si
`score ≥ feature_match_threshold` **et** `dist ≤ max_dist_px`.

**Profil de la cible** : vecteur de features moyen mis à jour par EMA
(`feature_ema_alpha`) à chaque frame validée. Initialisé sur la bbox du clic.

**Mémoire inter-reset** : à la perte (`reset()`), les dimensions du dernier suivi
(`_prev_last_w/h`) sont préservées et réutilisées par `init()` comme fallback bbox.

---


---

## Section 2 : Paramètres YAML (section `tracking_tophat:`)

### Détection / ROI

| Paramètre | Type | Défaut | Effet |
|---|---|---|---|
| `use_resnet` | bool | `false` | Backend d'**apparence** uniquement. `false` = NCC CPU, `true` = cosinus ResNet18 GPU. La détection est toujours multi-kernel Top-Hat, quelle que soit la valeur. N'a d'effet que si `w_appearance > 0`. |
| `search_radius_px` | int | 40 | Demi-taille **minimale** de la ROI (plancher). |
| `max_search_radius_px` | int | 200 | Demi-taille **maximale** de la ROI (borne temps réel). |
| `white_tophat_kernels` | list[int] | `[3,5,7]` | Noyaux **white tophat** (cible chaude sur fond froid). 1 passe par noyau. `[]` = desactive. |
| `black_tophat_kernels` | list[int] | `[]` | Noyaux **black tophat** (cible froide sur fond chaud). `[]` = desactive (defaut). Ex: `[5, 7]`. |
| `k_sigma_levels` | list[float] | `[2.5]` | **LISTE unique** de seuils adaptatifs `mediane + k_sigma*MAD`. (kernels_total × seuils) passes. |
| `threshold_rel` | float | 0.3 | Seuil fixe (si `use_adaptive_thresh: false`). |
| `use_adaptive_thresh` | bool | true | Seuillage `médiane + k_sigma·MAD`. |
| `min_thresh_abs` | int | 5 | Seuil absolu minimum (0-255). |
| `min_area_px2` / `max_area_px2` | int | 8 / 5000 | Filtre d'aire des blobs (px²). |
| `max_dist_px` | float | 40 | **Gate dur** : distance max blob↔centre prédit (px). |

### Fusion des doublons

| Paramètre | Type | Défaut | Effet |
|---|---|---|---|
| `dedup_iou_thresh` | float | 0.3 | IoU au-dessus duquel deux blobs sont fusionnés. |
| `dedup_dist_px` | float | 5 | Distance centre↔centre de fusion (px). |
| `max_candidates` | int | 30 | Nombre max de blobs scorés (borne perf). |

### Feature matching (poids normalisés en interne)

| Paramètre | Type | Défaut | Effet |
|---|---|---|---|
| `w_geometry` | float | 0.20 | Poids géométrie (diamètre + ratio w/h). |
| `w_intensity` | float | 0.20 | Poids intensité moyenne du blob. |
| `w_background` | float | 0.15 | Poids contraste / SNR vs fond. |
| `w_motion` | float | 0.30 | Poids cohérence avec le centre prédit Kalman. |
| `w_appearance` | float | 0.15 | Poids NCC/cosinus template. **0 = désactivé (plus rapide)**. |
| `feature_match_threshold` | float | 0.45 | Score global minimum pour accepter un blob (0-1). |
| `feature_ema_alpha` | float | 0.3 | Lissage EMA du profil de features cible. |
| `bg_ring_margin_px` | int | 6 | Épaisseur de l'anneau de fond autour du blob (px). |

### Taille adaptative

| Paramètre | Type | Défaut | Effet |
|---|---|---|---|
| `adaptive_size` | bool | true | ROI adaptative (taille suit EMA blob + vitesse). |
| `size_ema_alpha` | float | 0.2 | Lissage EMA des tailles (bbox **et** diamètre blob). |
| `roi_size_factor` | float | 2.0 | Rayon ROI ≈ `roi_size_factor × diamètre_EMA`. |
| `vel_radius_factor` | float | 2.0 | Marge ROI = `vel_radius_factor × vitesse_Kalman`. |

> La **taille de la bbox de sortie** suit toujours la taille mesurée du blob via une
> EMA (`size_ema_alpha`), **indépendamment** de `adaptive_size` (qui ne pilote que la
> taille de la *zone de recherche*). C'est ce qui corrige le bug historique.

### Apparence (template) & Kalman

| Paramètre | Type | Défaut | Effet |
|---|---|---|---|
| `template_patch_size` | int | 48 | Taille du patch d'apparence (px). |
| `template_history` | int | 5 | Nb de templates gardés (anti-dérive). Buffer circulaire de patches bruts (NCC) ou vecteurs ResNet — uniquement pour `w_appearance`. Les autres features utilisent le profil EMA `feat_profile`. |
| `template_update_thresh` | float | 0.5 | Score d'apparence min pour mettre à jour le template. |
| `template_update_interval` | int | 3 | Maj template toutes les N frames acceptées. |
| `fallback_bbox_size_px` | int | 40 | Carré fallback si aucune track MOT ni mémoire Tracking_TOPHAT. |
| `kf_process_noise` / `kf_measure_noise` | float | (sot_kalman:) | Bruits Kalman (override possible). |
| `resnet_device` / `resnet_layer` | - | device / layer3 | Mode `resnet`. |

---

## Section 3 : Inputs / Outputs

**Entrées** : `frame` (ndarray IR), `click_pos` (init), `mot_tracks` (init), `H` (CMC).
**Sortie de `update()`** : `(ok: bool, bbox: [x1,y1,x2,y2] | None, mask: None)`.
**Utilitaire** : `get_last_size() -> (w, h)` du dernier suivi (persiste après reset).

### Flux d'init (priorité bbox)

```
clic -> tracking_tophat.init(frame, click_pos, mot_tracks)
  1. track MOT contenant le clic (hit exact)
  2. track MOT la plus proche (≤ sot_click_max_dist_px)
  3. dimensions Tracking_TOPHAT mémorisées (_prev_last_w/h > 0, après une perte)
  4. carré fallback_bbox_size_px
-> init du profil de features + template + Kalman + EMA tailles
```

### Debug vidéo

```yaml
debug_tracking:
  tracking_tophat_sot_save_video:    true   # vidéo annotée (ROI, blob, score)
  tracking_tophat_binary_save_video: true   # image binaire seuillée (OR des passes multi-kernel)
```
Un MP4 distinct par clic opérateur (`tracking_tophat_sot_debug_c001.mp4`, `_c002.mp4`, …).

---

## Section 4 : Conseils de réglage

### Cible chaude sur fond froid (cas nominal drone IR)
```yaml
adaptive_size:         true
white_tophat_kernels:  [3, 5, 7, 11]   # couvre petites ET moyennes echelles
black_tophat_kernels:  []
k_sigma_levels:        [2.5]
size_ema_alpha:        0.3             # bbox reactive au changement de taille
roi_size_factor:       2.0
max_search_radius_px:  180
```

### Cible froide sur fond chaud (ex. aeronef froid, fond solaire chaud)
```yaml
white_tophat_kernels:  []              # desactive detection cibles chaudes
black_tophat_kernels:  [5, 7, 11]     # detection cibles froides
k_sigma_levels:        [2.5]
w_background:          0.25           # contraste negatif -> SNR negatif dans profil
```

### Cible a polarite variable (transition : cible parfois chaude, parfois froide)
```yaml
white_tophat_kernels:  [3, 5, 7]      # detecte pics chauds
black_tophat_kernels:  [5, 7]         # detecte pics froids simultanement
k_sigma_levels:        [2.5]
# Le profil EMA de features (snr, contrast) suit la polarite observee.
# Les candidats des deux types sont scores contre le meme profil cible :
# la polarite dominante dans le profil gagne naturellement.
```

### Petite cible IR pointiforme (drone 5-10 px)
```yaml
white_tophat_kernels:  [3, 5]
black_tophat_kernels:  []
min_area_px2:          4
max_area_px2:          500
w_appearance:          0.10   # NCC peu discriminant sur cible minuscule
w_motion:              0.40
```

### Fond IR chaud / bruité (faux positifs)
```yaml
k_sigma_levels:          [3.0]   # seuillage plus strict
w_background:            0.30    # privilege le contraste/SNR
feature_match_threshold: 0.55
max_dist_px:             40
```

### Budget serré (Jetson / temps réel strict)
```yaml
white_tophat_kernels:  [3, 7]   # 2 passes
black_tophat_kernels:  []       # desactive black tophat pour economiser
k_sigma_levels:        [2.5]
max_search_radius_px:  120
w_appearance:          0.0      # supprime le calcul NCC/ResNet
```

### Caméra très mobile
```yaml
kf_process_noise: 30.0
max_dist_px:      100
use_ldv_cmc:      true   # LDV prioritaire (meilleur que ORB/ECC)
```

### Mode ResNet (apparence variable, GPU dispo)
```yaml
use_resnet:           true
w_appearance:         0.30
resnet_device:        "cuda"
resnet_layer:         "layer3"
```
