# Tracker MOT : BoT-SORT

## Sommaire

| # | Section |
|---|---------|
| 0 | [Architecture et logique d'association](#section-0--architecture-et-logique-dassociation) |
| 1 | [Principe général](#section-1--principe) |
| 2 | [Paramètres YAML](#section-2--parametres-yaml) |
| 3 | [Inputs / Outputs du workflow](#section-3--inputs--outputs-du-workflow) |
| 4 | [Intégration dans le pipeline](#section-4--integration-dans-le-pipeline) |
| 5 | [Conseils de réglage](#section-5--conseils-de-reglage) |
| 6 | [Logs DEBUG](#section-6--logs-debug) |
| 7 | [Comportement visuel](#section-7--comportement-visuel---vert-vif-vert-sombre-clignotement) |
| 8 | [Filtre de Kalman](#section-8--filtre-de-kalman---modele-et-lien-avec-custom_kalman) |

---

## Section 0 : Architecture et logique d'association

### Vue d'ensemble du tracker

BoT-SORT étend ByteTrack avec deux ajouts : la CMC interne via `gmc.apply` (sparseOptFlow ou bypass LDV) appliquée aux prédictions Kalman **avant** l'association, et un Re-ID optionnel (FastReID). La structure en deux passes est identique à ByteTrack.

```
frame N
  │
  ├─ prédiction Kalman → positions estimées
  ├─ gmc.apply(img) → warp 2x3 → STrack.multi_gmc(strack_pool, warp)
  │     (CMC appliquée sur les états Kalman, avant calcul IoU)
  │
  ├─ PASSE 1 (bucket HIGH : score >= track_high_thresh)
  │     ious_dists = 1 - IoU
  │     ious_dists_mask = (ious_dists > proximity_thresh)  ← filtre spatial
  │     si fuse_score: ious_dists = 1 - (IoU × score)
  │     si with_reid:
  │         emb_dists = embedding_distance / 2
  │         emb_dists[emb > appearance_thresh] = 1.0
  │         emb_dists[ious_mask] = 1.0         ← gate spatial sur embedding
  │         dists = min(ious_dists, emb_dists)  ← prend le meilleur des deux
  │     sinon: dists = ious_dists
  │     LAP avec cost_limit = match_thresh
  │
  ├─ PASSE 2 (bucket LOW : track_low_thresh <= score < track_high_thresh)
  │     dists = 1 - IoU (sans fuse_score)
  │     LAP avec cost_limit = 0.5 (hardcodé)
  │     sur : pistes tracked non matchées passe 1 vs dets LOW
  │
  ├─ PASSE 3 (unconfirmed vs dets HIGH restantes)
  │     même logique passe 1
  │     LAP avec cost_limit = 0.7 (hardcodé)
  │
  ├─ matched      → update Kalman
  ├─ unmatched_dets (score > new_track_thresh) → nouveau STrack
  └─ unmatched_tracks → mark_lost() ; supprimer si > buffer_size frames
```

---

### Construction de la cost_matrix

**BoT-SORT travaille en DISTANCE (à minimiser), même convention que ByteTrack.**

#### Étape 1 — Base IoU (après CMC)

```python
# Les positions STrack ont déjà été corrigées par multi_gmc()
ious_dists = 1 - iou_batch(strack_pool, detections)
```

La CMC est appliquée AVANT ce calcul → l'IoU est calculé entre la **prédiction Kalman compensée du mouvement caméra** et la détection brute. C'est le mécanisme central de BoT-SORT.

#### Étape 2 — Filtre spatial proximity_thresh

```python
ious_dists_mask = (ious_dists > proximity_thresh)
# i.e. : masque les paires où IoU < (1 - proximity_thresh)
```

Ce masque ne rejette pas directement la paire dans LAP (il ne modifie pas `ious_dists`). Il sert uniquement à **bloquer l'embedding** pour les paires trop éloignées (`emb_dists[ious_dists_mask] = 1.0`). Sans Re-ID, `proximity_thresh` n'a aucun effet.

#### Étape 3 — Fusion score (optionnel, si not mot20)

```python
fuse_sim = (1 - ious_dists) × detection_score   # = IoU × score
ious_dists = 1 - fuse_sim                        # = 1 - (IoU × score)
```

Même rôle que dans ByteTrack : abaisse le coût des détections haute-confiance pour leur donner priorité au ranking LAP.

#### Étape 4 — Re-ID embedding (si with_reid=True)

```python
emb_dists = embedding_distance(strack, det) / 2.0   # distance cosinus / 2 → [0, 0.5]
emb_dists[emb_dists > appearance_thresh] = 1.0       # seuil apparence
emb_dists[ious_dists_mask] = 1.0                     # gate spatial (voir étape 2)
dists = np.minimum(ious_dists, emb_dists)            # prend le meilleur des deux
```

**Rôle :** pour une piste avec bonne apparence mais IoU moyen, l'embedding peut dominer le coût final via `minimum`. Contrairement à BoostTrack (qui ADDITIONNE les termes), BoT-SORT prend le **minimum** — il suffit qu'un des deux critères soit bon pour que la paire soit retenue.

---

### Résumé : ce qui gouverne l'association

| Terme | Présent | Rôle |
|---|---|---|
| `1 - IoU` (base, post-CMC) | Toujours | Coût principal ; verrou via `cost_limit = match_thresh` |
| `× detection_score` (fuse_score) | Passe 1 et 3 | Priorité ranking pour dets haute-confiance |
| `proximity_thresh` | Toujours | Gate sur l'embedding uniquement (sans Re-ID : sans effet) |
| Re-ID embedding | Si `with_reid=True` | `min(iou_cost, emb_cost)` — peut sauver des paires à faible IoU |
| Mahalanobis | **Jamais** | Non utilisé |
| Shape similarity | **Jamais** | Non utilisé |

**L'IoU reste le verrou principal.** Sans Re-ID, le mécanisme est identique à ByteTrack — seule la CMC intégrée (GMC) différencie BoT-SORT. Avec Re-ID, l'embedding peut sauver des paires à IoU faible mais uniquement si `iou_distance <= proximity_thresh` (embedding non masqué).

**Différence clé avec ByteTrack :**
- ByteTrack : CMC appliquée dans le wrapper (`_apply_camera_update` sur `STrack.mean`)
- BoT-SORT : CMC appliquée en interne via `multi_gmc` (warp 2x3 → rotation + translation sur l'état Kalman complet 8D ET la covariance)

La CMC BoT-SORT est plus correcte mathématiquement (elle propage aussi la covariance P via `R8x8·P·R8x8ᵀ`).

---

### Conséquence pour les cibles rapides / petites

Même conclusion que ByteTrack : IoU = 0 → coût = 1 → rejeté. La CMC interne (GMC ou bypass LDV) est la principale protection pour les caméras mobiles. Sans CMC et sans Re-ID, BoT-SORT = ByteTrack en termes d'association. Avec Re-ID actif, l'embedding peut récupérer des pistes à IoU = 0 si `appearance_thresh` est permissif et que `proximity_thresh` est petit (embedding non masqué).

---

## Section 1 : Principe

BoT-SORT (Aharon et al., 2022) etend ByteTrack avec deux composants supplementaires :
la Compensation Globale du Mouvement (GMC) via flux optique sparse (sparseOptFlow) qui aligne
les predictions Kalman sur le mouvement camera avant l'association, et un module Re-ID
optionnel (FastReID) pour les associations a longue portee. Dans ce pipeline, le Re-ID est
desactive par defaut. La CMC est nativement geree par le repo via `gmc.apply` ; notre wrapper
injecte un monkey-patch double role : capturer le warp produit pour `get_last_homography()`
(reprojection des clics) et, quand H_ldv est disponible, bypasser le calcul image (sparseOptFlow
skippe) en retournant directement la matrice affine 2x3 derivee de H_ldv. Les detections YOLO
sont toujours passees brutes.

---

## Section 2 : Parametres YAML

Section `botsort:` dans le YAML.

| Parametre          | Type   | Defaut         | Plage         | Effet                                                                     |
|--------------------|--------|----------------|---------------|---------------------------------------------------------------------------|
| `track_high_thresh`| float  | 0.04           | 0.01-0.9      | Seuil bucket HIGH (peut creer de nouvelles pistes). Avec tophat: < 0.05. Avec YOLO: 0.5. |
| `track_low_thresh` | float  | 0.01           | 0.001-0.3     | Seuil bucket LOW (peut seulement matcher des pistes existantes, jamais en creer). |
| `new_track_thresh` | float  | 0.04           | 0.01-0.9      | Score minimum pour initialiser une nouvelle piste depuis HIGH. Doit etre <= track_high_thresh. |
| `track_buffer`     | int    | 30             | 5-120         | Frames de vie d'une piste perdue. 30 @ 10 Hz = 3 s. |
| `match_thresh`     | float  | 0.8            | 0.4-0.95      | Seuil IoU pour l'association Hongrois. |
| `proximity_thresh` | float  | 0.5            | 0.1-0.9       | IoU minimum pour qu'une association soit candidate (filtre spatial). |
| `appearance_thresh`| float  | 0.25           | 0.0-1.0       | Distance cosinus max pour Re-ID (ignoré si with_reid=false). |
| `with_reid`        | bool   | false          | true/false    | Active FastReID. Necessite fast_reid_config et fast_reid_weights. |
| `fast_reid_config` | str    | ""             | chemin        | Chemin config FastReID (vide si with_reid=false). |
| `fast_reid_weights`| str    | ""             | chemin        | Chemin poids FastReID (vide si with_reid=false). |
| `fp16`             | bool   | false          | true/false    | Inference Re-ID en demi-precision FP16 (GPU compatible). |
| `fuse_score`       | bool   | false          | true/false    | Fusionner score detection et score IoU pour l'association. |
| `mot20`            | bool   | false          | true/false    | Optimisations MOT20 (scenes tres denses). |
| `cmc_method`       | str    | "sparseOptFlow"| voir ci-dessous| Methode GMC interne. Options: sparseOptFlow, orb, ecc, sof, file, none. |
| `kalman_std_position` | float | 0.05 | 0.01-0.5 | Ecart-type bruit de mesure proportionnel a h. Meme modele que ByteTrack. Voir bytetrack/algo.md. |
| `kalman_std_velocity` | float | 0.00625 | 0.001-0.1 | Ecart-type bruit processus vitesse proportionnel a h. Voir bytetrack/algo.md. |

---

## Section 3 : Inputs / Outputs du workflow

**Entrees recues dans `update()`**

| Entree      | Type                        | Description                                                      |
|-------------|-----------------------------|--------------------------------------------------------------------|
| `frame`     | `ndarray (H, W, ...)`       | Frame IR courante (convertie en BGR uint8 pour GMC)              |
| `detections`| `list[[x1,y1,x2,y2,score]]` | Detections brutes (jamais compensees exterieurement)              |
| `H`         | `ndarray (3,3)` ou `None`   | Homographie LDV. Si fourni: bypasse sparseOptFlow. Si None: GMC image normal. |

**Sorties retournees**

Liste d'objets `_TrackAdapter`, identiques au format ByteTrack :

| Attribut            | Type              | Description                                   |
|---------------------|-------------------|-----------------------------------------------|
| `track_id`          | `int`             | Identifiant unique persistant                 |
| `bbox`              | `[x1,y1,x2,y2]`  | Position courante                             |
| `score`             | `float`           | Confiance                                     |
| `is_confirmed`      | `bool`            | Toujours True pour les pistes retournees      |
| `time_since_update` | `int`             | Toujours 0                                    |
| `history`           | `list[(cx,cy)]`   | 50 dernieres positions                        |

**Sorties complementaires (interface CMC)**

| Methode                 | Retour              | Description                                                   |
|-------------------------|---------------------|---------------------------------------------------------------|
| `get_last_homography()` | `ndarray (3,3)`     | H calcule par GMC lors du dernier update (pour reprojection clic) |
| `has_own_image_cmc`     | `bool`              | True si cmc_method != "none" (GMC interne actif)             |

---

## Section 4 : Integration dans le pipeline

**Appelant** : `session.py` a chaque frame.

**Flux d'appel** :
1. `session.py` calcule H (H_ldv si disponible, sinon None si BoT-SORT gere sa propre CMC image).
2. Quand `has_own_image_cmc=True` et H_ldv absent, session.py envoie `H=None` pour laisser GMC calculer.
3. `BotSortWrapper.update(frame, detections, H)` :
   - Si H fourni (bypass LDV) : `_ldv_warp_2x3 = H[:2,:]` stocke pour le monkey-patch.
   - `_to_bgr(frame)` : conversion IR -> BGR pour que GMC fonctionne.
   - `BoTSORT.update(dets_np, bgr)` du repo clone : appelle `gmc.apply(bgr, dets)` en interne.
   - `gmc.apply` patche : retourne `_ldv_warp_2x3` si disponible, sinon calcule sparseOptFlow normal.
   - `_last_warp_2x3` est capture apres chaque appel pour `get_last_homography()`.
4. Les tracks retournes sont adaptes en `_TrackAdapter`.

**Dependance externe** : repo clone dans `trackers/mot/botsort/BoT-SORT/`, reference par `botsort_root:`.

**CMC levels** :
- `has_internal_cmc = True` toujours.
- `has_own_image_cmc = True` si cmc_method != "none" : session.py est en niveau 2 (H=None transmis si pas de LDV).
- Quand H_ldv fourni : niveau 1 (bypass GMC), gain ~5-15 ms/frame.

**Interaction state machine** : identique aux autres MOT trackers. `get_last_homography()` est utilise par session.py pour reprojecter les clics operateur quand BoT-SORT est le tracker actif.

---

## Section 5 : Conseils de reglage

**Avec detecteur TopHat IR (blobs 0.04-0.15)** :
- `track_high_thresh: 0.03-0.04`, `new_track_thresh: 0.03-0.04`, `track_low_thresh: 0.01`.
- Invariant : `new_track_thresh <= track_high_thresh` sinon aucune piste n'est jamais creee.
- `match_thresh: 0.5-0.6` pour les petites bboxes a faible IoU naturelle.

**Avec detecteur YOLO (scores 0.3-0.99)** :
- `track_high_thresh: 0.5`, `new_track_thresh: 0.6`, `track_low_thresh: 0.05`.
- `match_thresh: 0.8` recommande par les auteurs.

**Camera mobile avec LDV disponible** :
- `use_ldv_cmc: true` : le bypass LDV elimine le calcul sparseOptFlow (~5-15 ms economises).
- `cmc_method: "sparseOptFlow"` reste utile comme fallback si LDV momentanement absent.
- Pour desactiver totalement le GMC interne : `cmc_method: "none"` (non recommande si camera mobile).

**Re-ID pour sequences longues avec occultations** :
- `with_reid: true`, fournir `fast_reid_config` et `fast_reid_weights`.
- `appearance_thresh: 0.25` (defaut), reduire a 0.4 si trop de fausses re-identifications.
- Necessite GPU ; `fp16: true` pour accelerer sur GPU compatible.

---

## Section 6 : Logs DEBUG

Condition d'activation : `log_level: "DEBUG"` **ET** `debug_tracking.verbose_mot_tracker: true` dans le YAML.

### Log verbose (verbose_mot_tracker=true)

Emis par `_log_verbose()` apres chaque `update()` :

```
[BotSort] tracked=2 lost=1 ret=2 cmc=LDV | T01[tr len=23 s=0.82 c=(320,240) v=(1.2,-0.4)]  T07[tr len=5 s=0.45 c=(100,80) v=(0.0,0.0)]  T03[LOST len=8]
```

**Entete** :

| Champ        | Signification |
|--------------|---------------|
| `tracked=2`  | Pistes dans `tracked_stracks` (actives et activees ce frame) |
| `lost=1`     | Pistes dans `lost_stracks` (perdues, en attente re-match) |
| `ret=2`      | Pistes retournees a la state machine |
| `cmc=LDV`    | Source CMC utilisee : `LDV` (bypass via H_ldv injecte) ou `GMC` (sparseOptFlow calcule) ou `none` |

**Par piste** (meme format que ByteTrack) :

| Champ    | Signification |
|----------|---------------|
| `tr`     | Piste active (`tracked_stracks`) |
| `LOST`   | Piste perdue (`lost_stracks`) |
| `len=N`  | `tracklet_len` - frames depuis activation |
| `s=0.82` | Score detection |
| `c=(u,v)` | Centre Kalman courant (depuis `STrack.mean[0:2]`) |
| `v=(vx,vy)` | Vitesse Kalman (depuis `STrack.mean[4:6]`) |

**Comportement specifique BoT-SORT vs ByteTrack** :
- Idem ByteTrack : seules les `tracked_stracks` sont retournees -> `time_since_update=0` toujours -> uniquement vert vif (jamais de prediction Kalman visible).
- La difference visible est dans `cmc=` : avec H_ldv, les vitesses `v=(vx,vy)` doivent etre proches de zero sur une camera stable (le warp LDV a absorbe le mouvement camera).

**Diagnostic typique** :
- `cmc=none` alors que `use_ldv_cmc: true` -> H_ldv non disponible ce frame (LDV momentanement absent), GMC ni ORB non calcules.
- `cmc=GMC` alors que `use_ldv_cmc: true` -> LDV absent, sparseOptFlow a pris le relais.
- Beaucoup de `LOST` + peu de `tracked` -> `track_high_thresh` trop eleve (detections sous le seuil) ou `match_thresh` trop strict.

---

## Section 7 : Comportement visuel - vert vif, vert sombre, clignotement

### Couleurs de rendu

| Couleur      | Signification                               | Condition                                 |
|--------------|---------------------------------------------|-------------------------------------------|
| Vert vif     | Track active, detection associee ce frame   | `time_since_update == 0` ET `is_confirmed` |
| Vert sombre  | Prediction Kalman pure (pas de detection)   | `time_since_update > 0` ET `is_confirmed` |
| Invisible    | Track disparue de l'affichage               | Piste non retournee par le tracker        |

### BoT-SORT : uniquement vert vif ou invisible

**Jamais de vert sombre.** Meme raison que ByteTrack :
- `_TrackAdapter.time_since_update` est force a `0` pour toutes les pistes retournees.
- Quand YOLO ne detecte pas la cible : BoT-SORT place la piste dans `lost_stracks` (non retournee).
- Resultat : la bbox **disparait completement** de l'ecran.

### Delai d'initialisation (premiere apparition d'une track)

BoT-SORT herite la logique ByteTrack mais avec une **difference importante** :

```python
# bot_sort.py (ligne 432-433 du repo)
# output_stracks = [track for track in self.tracked_stracks if track.is_activated]  # COMMENTE
output_stracks = [track for track in self.tracked_stracks]  # TOUTES retournees
```

**Le filtre `is_activated` est desactive dans BoT-SORT !** Toutes les pistes `tracked_stracks` sont retournees, y compris celles avec `is_activated=False` (premier hit). Cela signifie :

| Frame | Etat de la piste     | Affichage  |
|-------|----------------------|------------|
| N     | Premiere detection -> `activate()` -> `is_activated=False` | **Vert vif** (retourne quand meme) |

**Minimum 1 frame** avec detection pour qu'une track apparaisse a l'ecran (contrairement a ByteTrack qui en requiert 2).

### Nomenclature interne BoT-SORT

| Terme interne         | Signification                                                        |
|-----------------------|----------------------------------------------------------------------|
| `track_high_thresh`   | Seuil HIGH : peut creer de nouvelles pistes ET matcher existantes    |
| `track_low_thresh`    | Seuil LOW (BYTE) : peut seulement matcher des pistes existantes      |
| `new_track_thresh`    | Score min pour initier une nouvelle piste depuis bucket HIGH. Doit etre <= `track_high_thresh` |
| `match_thresh`        | Seuil sur distance `1-IoU` : rejette si `1-IoU > match_thresh` -> IoU min = `1 - match_thresh` |
| `proximity_thresh`    | Filtre spatial pre-association : rejette les paires avec IoU < seuil avant le matching |
| `STrack.mean`         | Etat Kalman 8D identique a ByteTrack : `[cx, cy, a, h, vx, vy, va, vh]` |
| `tracked_stracks`     | Toutes pistes actives (incluant `is_activated=False`) -> retournees   |
| `lost_stracks`        | Pistes perdues (non retournees), gardees pendant `track_buffer` frames |
| `gmc.apply()`         | Monkey-patche dans le wrapper pour capturer le warp et optionnellement bypasser LDV |

---

## Section 8 : Filtre de Kalman - modèle et lien avec custom_kalman

BoT-SORT utilise **exactement le même filtre de Kalman que ByteTrack** (8D, proportionnel à h). Voir `bytetrack/algo.md Section 8` pour les équations complètes.

Les paramètres exposés sont identiques :

| Param YAML | Equivaut à | Plage |
|---|---|---|
| `kalman_std_position` | sigma_mesure = 2 × val × h | 0.01–0.5 |
| `kalman_std_velocity` | sigma_vel = 10 × val × h (parties vitesse de Q) | 0.001–0.1 |

**Différence BoT-SORT vs ByteTrack pour le Kalman** : BoT-SORT applique la CMC via `gmc.apply` (monkey-patch), ce qui modifie l'état Kalman en interne dans le repo. ByteTrack applique la CMC via `_apply_camera_update(H)` externe sur `STrack.mean`. Le modèle de bruit est identique, seul le chemin CMC diffère.

**Lien custom_kalman** : voir bytetrack/algo.md Section 8. Identique.

---

### Causes du clignotement (BoT-SORT)

Similaires a ByteTrack, avec deux specificites :

| Cause | Parametre responsable | Correction |
|-------|-----------------------|-----------|
| `match_thresh` trop bas (comme ByteTrack) | `match_thresh=0.1` -> IoU min = 0.9 -> impossible | Augmenter : `match_thresh: 0.7-0.9` |
| `new_track_thresh > track_high_thresh` | Aucune nouvelle piste cree (invariant viole) | S'assurer que `new_track_thresh <= track_high_thresh` |
| `proximity_thresh` trop eleve | Filtre spatial elimine les candidats avant association | Reduire : `proximity_thresh: 0.1-0.3` pour petites cibles |
| CMC `cmc=none` sur camera mobile | Predictions decalees -> tout `LOST` | Verifier H_ldv ou activer ORB fallback |
