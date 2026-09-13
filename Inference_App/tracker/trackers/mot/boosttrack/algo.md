# Tracker MOT : BoostTrack

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
| 8 | [Filtre de Kalman BoostTrack](#section-8--filtre-de-kalman-boosttrack---constantnoise-et-lien-avec-custom_kalman) |

---

## Section 0 : Architecture et logique d'association

### Vue d'ensemble du tracker

BoostTrack est un tracker **detect-then-track** : à chaque frame, il reçoit les détections brutes du détecteur, maintient une liste de `KalmanBoxTracker` (un par piste), et résout l'association détections ↔ pistes via Hungarian (LAP).

```
frame N
  │
  ├─ prédiction Kalman → positions estimées des pistes (tracks)
  │
  ├─ associate(detections, trackers, …)
  │     └─ construction cost_matrix (voir ci-dessous)
  │     └─ LAP (Hungarian) sur cost_matrix
  │     └─ filtre final IoU
  │     └─ retourne (matches, unmatched_dets, unmatched_tracks)
  │
  ├─ matched      → update Kalman (correction mesure)
  ├─ unmatched_dets → créer nouveaux KalmanBoxTracker
  └─ unmatched_tracks → incrémenter time_since_update ; supprimer si > max_age
```

---

### Construction de la cost_matrix (fonction `associate`)

La cost_matrix est une **similarité** (plus grand = meilleure paire). LAP maximise la somme totale.

#### Étape 1 — Base IOU

```python
iou_matrix = iou_batch(detections, trackers)   # IoU standard [0,1]
cost_matrix = copy(iou_matrix)                 # base : le coût EST l'IoU
```

#### Étape 2 — Boost confiance × IoU (lambda_iou)

```python
conf[i,j] = detection_conf[i] × track_conf[j]   # confiance jointe
conf[iou_matrix < iou_threshold] = 0             # GATE IOU
cost_matrix += lambda_iou × conf × iou_matrix
```

**Rôle :** pour les paires qui passent déjà le seuil IoU, cette terme **booste** les paires haute-confiance. Ne crée aucune association nouvelle — il module seulement le ranking entre paires déjà valides.

#### Étape 3 — Mahalanobis (lambda_mhd)

```python
mhd_sim = MhDist_similarity(mahalanobis_distance)  # softmax sur distance chi²
cost_matrix += lambda_mhd × mhd_sim                # PAS de gate conf
```

**Rôle :** mesure la cohérence géométrique avec la prédiction Kalman. Ajouté **sans gate conf**, donc actif pour TOUTES les paires, même celles avec IoU < seuil. Influence le ranking LAP sur les cas borderline (deux pistes proches avec IoU similaires).

**Limite :** même si Mahalanobis booste une paire sous-seuil IoU, le filtre final dans `linear_assignment` rejette les matches avec `iou < threshold` (sauf si embedding fort : `iou >= threshold/2` ET `emb >= 0.75`). Mahalanobis **influence le ranking** mais ne **sauve pas** les associations trop loin géométriquement.

#### Étape 4 — Shape similarity (lambda_shape)

```python
cost_matrix += lambda_shape × conf × shape_similarity(detections, trackers)
# conf ici est déjà gatée : conf[iou < threshold] = 0
```

**Rôle :** bonus de forme (similarité de ratio w/h et taille). Gatée par `conf` → elle ne sert que comme **départageur** entre paires qui passent déjà le seuil IoU. Si IoU < threshold → conf=0 → shape = 0 pour cette paire.

#### Étape 5 — Embedding (optionnel, lambda_emb)

```python
lambda_emb = (1 + lambda_iou + lambda_shape + lambda_mhd) × 1.5
cost_matrix += lambda_emb × emb_cost  # PAS de gate conf
```

**Rôle :** features d'apparence ReID. Poids très fort (> somme des autres). Peut sauver un match avec `iou >= threshold/2` si `emb >= 0.75`. Désactivé dans ce pipeline (pas de poids).

#### Résumé des rôles

| Terme | Gate IoU ? | Rôle réel |
|---|---|---|
| `iou_matrix` (base) | — | Coût de base ; décide la majorité des associations |
| `λ_iou × conf × iou` | **Oui** | Booste le ranking des paires haute-conf déjà valides |
| `λ_mhd × mhd_sim` | **Non** | Départageur Kalman-cohérent sur cas borderline |
| `λ_shape × conf × shape` | **Oui** (via conf) | Départageur de forme entre paires déjà valides |
| `λ_emb × emb_cost` | **Non** | Apparence ; peut sauver des matchs à IoU/2 si fort |

#### Filtre final (dans `linear_assignment`)

Après LAP, chaque match est validé :

```python
valid = iou[d,t] >= threshold
     OR (iou[d,t] >= threshold/2 AND emb[d,t] >= 0.75)
```

**Conclusion : l'IoU est le verrou absolu.** Les autres termes modulent le ranking de LAP — dans les cas ambigus avec plusieurs candidats proches, Mahalanobis et shape orientent le choix. Mais aucune association ne survit sans IoU suffisant (sauf embedding fort).

---

## Section 1 : Principe

BoostTrack (Stanojevic et al., 2023) ameliore ByteTrack en enrichissant la fonction
de similarite d'association : le cout combine IoU geometrique, distance de Mahalanobis
(incertitude Kalman) et optionnellement un embedding d'apparence, avec des poids adaptatifs
selon le score de confiance de la detection. La CMC est geree selon le flag `use_ecc` :
si `use_ecc=True`, ECC (Enhanced Correlation Coefficient) calcule l'homographie depuis l'image,
avec possibilite de bypass LDV en injectant H dans `ecc._transforms` avant l'update ;
si `use_ecc=False`, la Methode B s'applique (`_apply_camera_update(H)` patche les STrack
internes avant `tracker.update()`). Les embeddings sont forces a False dans ce pipeline
(pas de poids fournis) : seuls IoU + Mahalanobis sont actifs.

---

## Section 2 : Parametres YAML

Section `boosttrack:` dans le YAML.

| Parametre       | Type   | Defaut | Plage       | Effet                                                                           |
|-----------------|--------|--------|-------------|---------------------------------------------------------------------------------|
| `use_ecc`       | bool   | false  | true/false  | Active ECC comme CMC image interne. true = ECC calcule H depuis l'image (+5-15 ms/frame). false = pas d'ECC, CMC via `KalmanBoxTracker.camera_update(H)`. |
| `track_thresh`  | float  | 0.5    | 0.01-0.9    | -> `GeneralSettings["det_thresh"]` : confiance min pour creer ou matcher une piste. Avec tophat IR: < 0.05. Avec YOLO: 0.5. |
| `match_thresh`  | float  | 0.3    | 0.0-0.9     | -> `GeneralSettings["iou_threshold"]` : IoU **MINIMUM** pour accepter une association (contrairement a ByteTrack ou c'est `1-IoU`). 0.3 = default BoostTrack. Pour cibles IR minuscules: 0.1. |
| `max_age`       | int    | 30     | 5-120       | -> `self._tracker.max_age` : frames max sans detection avant suppression. Pas de FPS scaling (contrairement a `track_buffer` de ByteTrack). |
| `min_hits`      | int    | 3      | 1-5         | -> `GeneralSettings["min_hits"]` : `hit_streak` consecutifs pour confirmer une piste. Default BoostTrack = 3, plus strict que ByteTrack (2). Reduire pour reactivite. |
| `min_box_area`  | float  | 10     | 1-500       | -> `GeneralSettings["min_box_area"]` : aire min (px2) des detections prises en compte. |
| `lambda_iou`    | float  | 0.5    | 0.0-1.0     | Poids IoU geometrique dans le cout combine. |
| `lambda_mhd`    | float  | 0.25   | 0.0-1.0     | Poids distance de Mahalanobis (incertitude Kalman). Cle pour les petites cibles ou les croisements. |
| `lambda_shape`  | float  | 0.25   | 0.0-1.0     | Poids similarite de forme (rapport d'aspect w/h). |
| `use_dlo_boost` | bool   | true   | true/false  | Dynamic Lambda Optimization : ajuste lambda_iou en fonction de la confiance detection. |
| `use_duo_boost` | bool   | true   | true/false  | Detection Uncertainty-aware : booste les detections a faible IoU Mahalanobis. |

| `use_embedding`    | bool   | false  | true/false  | Active l'embedding d'apparence (FastReID/OSNet). Necessite les poids dans `boosttrack_root/external/weights/`. GPU requis. Pour cibles IR generiques (blobs sans texture), le gain est faible. |
| `embedding_dataset`| str    | "mot17"| voir note   | Selectionne les poids ReID : `"mot17"` -> mot17_sbs_S50.pth, `"mot20"` -> mot20_sbs_S50.pth, `"dance"` -> dance_sbs_S50.pth. |
| `embedding_test_dataset` | bool | false | true/false | true = poids du jeu de test (vs ablation). Ignorer sauf benchmark. |
| `kalman_R_pos`  | float | 1.0    | 0.1-50  | Variance mesure position (cx,cy) en px². ABSOLUE (≠ ByteTrack qui scale avec h). Grand = moins confiance dans la detection. |
| `kalman_R_h`    | float | 10.0   | 1-100   | Variance mesure hauteur h. Eleve car h d'un blob IR est tres bruite. |
| `kalman_R_a`    | float | 0.01   | 0.001-1 | Variance mesure ratio w/h. Faible car un drone garde une forme stable. |
| `kalman_Q_scale`| float | 1.0    | 0.1-100 | Amplitude globale du bruit de processus Q. Augmenter si cible manoeuvrante. |
| `kalman_Q_vel`  | float | 0.01   | 0.001-1 | Facteur multiplicatif pour la partie vitesse dans Q. Faible = vitesse change lentement. |

**Notes sur l'embedding** :
- Poids a telecharger depuis le repo BoostTrack et placer dans `boosttrack_root/external/weights/`
- Pour cibles IR drones (5x2px, sans texture visible) : les features ReID entrainee sur pietons (MOT17) apportent peu. L'avantage IoU+Mahalanobis seul est deja superieur a ByteTrack pure.
- Activer pour des scenes avec de grands objets bien definis et des occultations longues.
- `use_embedding` est force a `False` si les poids sont absents (EmbeddingComputer echouera au demarrage).

---

## Section 3 : Inputs / Outputs du workflow

**Entrees recues dans `update()`**

| Entree      | Type                        | Description                                                     |
|-------------|-----------------------------|-----------------------------------------------------------------|
| `frame`     | `ndarray (H, W, ...)`       | Frame IR courante (convertie en BGR uint8 puis tensor PyTorch)  |
| `detections`| `list[[x1,y1,x2,y2,score]]` | Detections brutes (jamais compensees exterieurement)            |
| `H`         | `ndarray (3,3)` ou `None`   | Homographie LDV ou ORB/ECC. Utilise selon use_ecc (voir section 4). |

**Sorties retournees**

Liste d'objets `_TrackAdapter` :

| Attribut            | Type              | Description                                   |
|---------------------|-------------------|-----------------------------------------------|
| `track_id`          | `int`             | Identifiant unique                            |
| `bbox`              | `[x1,y1,x2,y2]`  | Position courante                             |
| `score`             | `float`           | Confiance                                     |
| `is_confirmed`      | `bool`            | Toujours True pour les pistes retournees      |
| `time_since_update` | `int`             | Toujours 0                                    |
| `history`           | `list[(cx,cy)]`   | 50 dernieres positions                        |

**Sorties complementaires (interface CMC)**

| Methode                 | Retour              | Description                                                  |
|-------------------------|---------------------|--------------------------------------------------------------|
| `get_last_homography()` | `ndarray (3,3)`     | H produit par ECC lors du dernier update (None si use_ecc=False) |
| `has_own_image_cmc`     | `bool`              | True si use_ecc=True (ECC interne actif)                    |

---

## Section 4 : Integration dans le pipeline

**Appelant** : `session.py` a chaque frame.

**Flux d'appel selon use_ecc** :

*Cas `use_ecc=False` (defaut)* :
1. Session.py fournit H (H_ldv ou H_image ORB/ECC selon la chaine CMC).
2. `_apply_camera_update(H)` patche `STrack.mean` (cx,cy,vx,vy) via Jacobien analytique de H.
3. `BoostTrack.update(dets_np, img_tensor, bgr, tag)` est appele avec detections brutes.

*Cas `use_ecc=True`* :
1. Session.py est en niveau 2 : H=None transmis si LDV absent (ECC calcule depuis l'image).
2. Si H_ldv disponible (niveau 1) : H est injecte dans `ecc.cache` AVANT update avec la cle
   `f"{tag}-{frame_count+1}"` (`tag = f"frame_{frame_idx}"`, `frame_count+1` anticipe
   l'increment effectue au debut de `BoostTrack.update()`).
3. `ECC.__call__` consulte `cache` avant de calculer -> retourne le H injecte directement.
4. Apres update, `_last_H` est capture depuis `ecc.cache[f"{tag}-{frame_count}"]`
   (frame_count deja incremente apres update) pour `get_last_homography()`.

**Structure interne ECC** :
- `ecc.cache` : `Dict[str, np.ndarray]` cle = `"{video}-{frame_id}"`.
- `ecc` n'a PAS d'attribut `_transforms` (erreur courante de documentation).
- Frame 1 : ECC retourne `np.eye()` sans consulter ni ecrire le cache -> injection sans effet frame 1.

**Dependance externe** : repo clone dans `trackers/mot/boosttrack/BoostTrack/`, reference par `boosttrack_root:`.
Note : l'acces a `ecc.cache` et aux attributs `tracked_stracks`/`lost_stracks` est
fragile (attributs internes du repo). Si l'API BoostTrack change, documenter.

**Interaction state machine** : identique aux autres MOT trackers.

---

## Section 5 : Conseils de reglage

**use_ecc=False (recommande par defaut)** :
- Pas de cout ECC ; CMC via H_ldv ou H_image selon la chaine.
- `track_thresh: 0.5` avec YOLO, `< 0.05` avec tophat IR.
- `match_thresh: 0.8` par defaut ; reduire a 0.6 pour petites cibles IR.

**use_ecc=True (utile si LDV absent et camera tres mobile)** :
- ECC ajoute 5-15 ms/frame selon resolution.
- Gain en stabilite sur les sequences avec variations de luminosite IR (ECC invariant intensite).
- `use_ldv_cmc: true` permet de bypasser ECC quand H_ldv disponible (economie de calcul).

**Avec detecteur TopHat IR** :
- `track_thresh: 0.03-0.04`, `match_thresh: 0.5-0.6` (idem ByteTrack).
- L'avantage Mahalanobis est particulierement utile quand les bboxes IR sont petites et les IoU naturellement faibles.

**Comparaison BoostTrack vs ByteTrack** :
- A memes parametres de base : BoostTrack fait moins d'ID-switch grace a Mahalanobis.
- Cout additionnel : marginal sans ECC (~1-2 ms pour le calcul Mahalanobis).
- Avec ECC : +5-15 ms mais meilleure stabilite sur camera mobile sans LDV.

---

## Section 6 : Logs DEBUG

Condition d'activation : `log_level: "DEBUG"` **ET** `debug_tracking.verbose_mot_tracker: true` dans le YAML.

### Log verbose (verbose_mot_tracker=true)

Emis par `_log_verbose()` apres chaque `update()`. BoostTrack utilise `self._tracker.trackers` (list de `KalmanBoxTracker`), pas `tracked_stracks`/`lost_stracks` qui n'existent pas dans ce tracker.

```
[BoostTrack] trk=3 active=2 lost=1 ret=2 ecc=off H=yes | T01[act str=5 tsu=0 c=(320,240)]  T07[act str=2 tsu=0 c=(100,80)]  T03[LOST str=0 tsu=1 c=(450,300)]
```

**Entete** :

| Champ        | Signification |
|--------------|---------------|
| `trk=3`      | Nombre total de `KalmanBoxTracker` internes (actifs + perdus) |
| `active=2`   | Trackers avec `time_since_update < 1` (detectes ce frame) |
| `lost=1`     | Trackers avec `time_since_update >= 1` (prediction pure, pas de detection) |
| `ret=2`      | Pistes retournees a la state machine (filtre `hit_streak >= min_hits`) |
| `ecc=off/on` | Etat de l'ECC interne (`use_ecc` dans le YAML) |
| `H=LDV/ECC/none` | Source de l'homographie appliquee ce frame : `LDV` (Methode B, use_ecc=false), `ECC` (ECC interne, use_ecc=true), `none` (aucune CMC ce frame) |

**Par tracker** (`TXX[...]`) :

| Champ      | Signification |
|------------|---------------|
| `act`      | Tracker detecte ce frame (`time_since_update < 1`) |
| `LOST`     | Tracker en prediction pure (`time_since_update >= 1`) |
| `str=N`    | `hit_streak` - detections CONSECUTIVES. Doit atteindre `min_hits` pour apparaitre en sortie |
| `tsu=N`    | `time_since_update` - frames depuis la derniere association |
| `c=(u,v)`  | Centre de la bbox estimee par le Kalman interne (`get_state()`) |

**Note sur le modele Kalman de BoostTrack** : les trackers internes (`KalmanBoxTracker`) utilisent un etat `[cx, cy, h, r, vcx, vcy, vh, vr]` ou `r = w/h` (rapport d'aspect). Ce modele est DIFFERENT de ByteTrack/BotSort qui utilisent `[cx, cy, a, h, vx, vy, va, vh]`.

**CMC** :
- `ecc=on H=ECC` : ECC active, H calcule depuis l'image (ou bypass LDV injecte dans `ecc._transforms`).
- `ecc=off H=LDV` : `KalmanBoxTracker.camera_update(H)` appele sur chaque tracker interne avec H_ldv.
- `ecc=off H=none` : LDV absent et `use_ecc=False` -> aucune CMC ce frame.

**Diagnostic typique** :
- `ret=0` mais `trk > 0` avec `str < min_hits` -> les pistes ne sont pas encore confirmees (pas assez de hits consecutifs). Reduire `min_hits` ou verifier la stabilite des detections.
- `active=0` et `lost` croissant -> `track_thresh` trop eleve (detections sous le seuil `det_thresh`).
- `ecc=off H=no` en permanence -> LDV absent et `use_ecc=False` -> aucune CMC active.

---

## Section 7 : Comportement visuel - vert vif, vert sombre, clignotement

### Couleurs de rendu

| Couleur      | Signification                               | Condition                                      |
|--------------|---------------------------------------------|------------------------------------------------|
| Vert vif     | Track active, detection associee ce frame   | `time_since_update == 0` ET `is_confirmed`     |
| Vert sombre  | Prediction Kalman pure (pas de detection)   | `time_since_update > 0` ET `is_confirmed`      |
| Invisible    | Track disparue de l'affichage               | Piste non retournee par le tracker             |

### BoostTrack : uniquement vert vif ou invisible

**Jamais de vert sombre.** La raison :
- `_TrackAdapter.time_since_update` est force a `0` pour toutes les pistes retournees.
- Quand YOLO ne detecte pas la cible : le `KalmanBoxTracker` interne reste dans `self._tracker.trackers` avec `time_since_update >= 1` mais n'est **pas retourne** (filtre `hit_streak >= min_hits AND time_since_update < 1`).
- Resultat : la bbox **disparait completement** de l'ecran jusqu'a ce qu'une nouvelle detection soit re-associee ou que `max_age` soit depasse.

Pour voir des predictions Kalman visibles (vert sombre) quand la detection est absente, utiliser **custom_kalman** (seul tracker qui retourne des pistes avec `time_since_update > 0`).

### Delai d'initialisation (premiere apparition d'une track)

BoostTrack utilise un mecanisme propre base sur `hit_streak` (configurable via `min_hits`) :

| Frame | Etat du KalmanBoxTracker         | Affichage |
|-------|----------------------------------|-----------|
| N     | Cree, `hit_streak=1`             | Invisible (`hit_streak < min_hits`) |
| N+1   | Re-detecte, `hit_streak=2`       | Invisible si `min_hits=3`, visible si `min_hits=2` |
| N+k   | `hit_streak=k >= min_hits`       | Vert vif (premiere apparition) |

Avec `min_hits=3` (default BoostTrack) : **3 frames consecutives** requises. Reduire `min_hits: 2` ou `1` pour plus de reactivite.

**Difference avec ByteTrack** : ByteTrack hard-code 2 hits (non configurable). BoostTrack expose `min_hits`.

### Nomenclature interne BoostTrack

| Terme interne          | Signification                                                         |
|------------------------|-----------------------------------------------------------------------|
| `trackers`             | `self._tracker.trackers` = `list[KalmanBoxTracker]` - tous les trackers actifs et perdus |
| `KalmanBoxTracker.id`  | ID unique (compteur incremental `KalmanBoxTracker.count`)            |
| `hit_streak`           | Detections consecutives depuis le dernier trou. Doit atteindre `min_hits` |
| `time_since_update`    | 0 = detecte ce frame, >= 1 = prediction pure (Kalman coasting)       |
| `kf.x`                 | Etat Kalman 8D : `[cx, cy, h, r, vcx, vcy, vh, vr]` ou `r = w/h`   |
| `det_thresh`           | = `track_thresh` YAML -> `GeneralSettings["det_thresh"]`              |
| `iou_threshold`        | = `match_thresh` YAML -> `GeneralSettings["iou_threshold"]` = IoU **minimum** pour associer |
| `max_age`              | = `max_age` YAML -> `self._tracker.max_age` (override post-init)      |
| `camera_update(H)`     | Methode sur `KalmanBoxTracker` : applique H sur les coins [x1,y1,x2,y2] de la bbox |

---

## Section 8 : Filtre de Kalman BoostTrack - ConstantNoise et lien avec custom_kalman

### Modèle d'état BoostTrack (8D, différent de ByteTrack)

```
x = [cx, cy, h, r, vcx, vcy, vh, vr]
     └## mesures ##┘  └## vitesses ##┘
     cx, cy : centre bbox (pixels)
     h      : hauteur bbox (pixels)
     r      : rapport d'aspect w/h  (≠ ByteTrack qui utilise 'a' = w/h aussi, mais ordre différent)
     vcx,vcy,vh,vr : vitesses respectives
```

### Politique ConstantNoise - variances ABSOLUES

Contrairement à ByteTrack (proportionnel à h), BoostTrack utilise des matrices **fixes** via `ConstantNoise` :

```python
R = diag([kalman_R_pos, kalman_R_pos, kalman_R_h, kalman_R_a])
Q = I × kalman_Q_scale
Q[4:, 4:] = Q[4:, 4:] × kalman_Q_vel  # parties vitesse seulement
```

| Paramètre | Matrice | Défaut | Effet |
|---|---|---|---|
| `kalman_R_pos` | R[cx,cy] | 1.0 px² | Confiance détection position. Grand = lissage, petit = réactif. |
| `kalman_R_h` | R[h] | 10.0 px² | Confiance hauteur. Élevé car h d'un blob IR est très bruité. |
| `kalman_R_a` | R[r] | 0.01 | Confiance ratio. Faible car drone = forme quasi-constante. |
| `kalman_Q_scale` | Q (global) | 1.0 | Amplitude modèle de mouvement. Augmenter si cible imprévisible. |
| `kalman_Q_vel` | Q[vitesses] | 0.01 | Facteur vitesse dans Q. Faible = trajectoire régulière attendue. |

### Lien direct avec custom_kalman

C'est le modèle le plus proche conceptuellement de `custom_kalman` car les deux utilisent des valeurs **absolues en px²** (non proportionnelles à h) :

| Aspect | custom_kalman | BoostTrack ConstantNoise |
|---|---|---|
| Dimension état | 4D `[u,v,du,dv]` | 8D (+ ratio et leurs vitesses) |
| R (mesure) | `measure_noise` -> R = I × val | `kalman_R_pos`, `R_h`, `R_a` diag |
| Q (processus) | `process_noise` -> Q = I × val | `kalman_Q_scale × I` (vel × `kalman_Q_vel`) |
| Type | Absolu (px²) | Absolu (px²) |
| Adaptatif au zoom | Non | Non (ConstantNoise = fixe) |

**Correspondances pratiques pour réglage :**
- `custom_kalman.measure_noise = 0.001` ↔ `kalman_R_pos ≈ 0.001` (très confiant dans le détecteur)
- `custom_kalman.process_noise = 100` ↔ `kalman_Q_scale ≈ 100` (dynamique très imprévisible)

En pratique, les valeurs par défaut de `custom_kalman` (R=0.001, Q=100) signifient "le détecteur est parfait mais la cible est erratique". Les valeurs BoostTrack (R_pos=1.0, Q_scale=1.0) sont plus équilibrées.

### Réglage pour IR drone (h ≈ 7–15 px)

| Situation | Action | Paramètre(s) |
|---|---|---|
| Blobs TopHat instables en position | Augmenter R_pos | `kalman_R_pos: 5.0-20.0` |
| Hauteur h oscille beaucoup | Augmenter R_h (déjà élevé) | `kalman_R_h: 20.0-50.0` |
| Drone manœuvre brusquement | Augmenter Q_scale | `kalman_Q_scale: 5.0-20.0` |
| Trajectoire très régulière | Réduire Q_vel | `kalman_Q_vel: 0.001-0.005` |
| Calquer custom_kalman (measure=0.001) | `kalman_R_pos: 0.001` | approx. identique |

---

### Causes du clignotement

| Cause | Parametre responsable | Correction |
|-------|-----------------------|-----------|
| `match_thresh` trop **bas** | `match_thresh=0.1` -> IoU minimum = 0.1 -> mais le cout combine peut quand meme rejeter -> verifier avec logs | Augmenter : `match_thresh: 0.3-0.5` |
| `match_thresh` trop **eleve** | `match_thresh=0.8` -> IoU minimum = 0.8 -> impossible pour cibles 5x2px avec decalage > 0px | Reduire : `match_thresh: 0.1-0.3` pour cibles IR tiny |
| `min_hits` trop **eleve** | Default 3 -> 3 frames sans affichage -> impression de clignotement au debut | Reduire : `min_hits: 2` ou `1` |
| `max_age` trop **court** | Piste supprimee avant re-match -> nouvel ID = clignotement d'ID | Augmenter : `max_age: 30-60` |
| CMC absente (camera mobile) | Predictions decalees -> IoU nul -> `hit_streak` reinitialisee a 0 | Verifier `use_ldv_cmc: true` |
