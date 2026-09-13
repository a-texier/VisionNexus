# Tracker MOT : ByteTrack

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
| 8 | [Filtre de Kalman](#section-8--filtre-de-kalman---modele-interne-et-lien-avec-custom_kalman) |

---

## Section 0 : Architecture et logique d'association

### Vue d'ensemble du tracker

ByteTrack est un tracker **detect-then-track** à deux passes : la première associe les détections haute confiance (bucket HIGH), la deuxième tente de récupérer les pistes perdues en utilisant les détections basse confiance (bucket LOW / "BYTE"). Seul critère d'association : IoU, modulé par le score de détection.

```
frame N
  │
  ├─ prédiction Kalman → positions estimées des pistes
  │
  ├─ PASSE 1 (bucket HIGH : score >= track_thresh)
  │     dists = 1 - (IoU × score)
  │     LAP avec cost_limit = match_thresh
  │     → matches, u_track, u_detection
  │
  ├─ PASSE 2 (bucket LOW/BYTE : 0.1 <= score < track_thresh)
  │     dists = 1 - IoU  (pas de fusion score)
  │     LAP avec cost_limit = 0.5 (hardcode)
  │     sur : pistes tracked non matchées passe 1 vs dets LOW
  │
  ├─ PASSE 3 (unconfirmed tracks vs dets HIGH restantes)
  │     dists = 1 - (IoU × score)
  │     LAP avec cost_limit = 0.7 (hardcode)
  │
  ├─ matched      → update Kalman (correction mesure)
  ├─ unmatched_dets HIGH (score > det_thresh) → nouveau KalmanTrack
  └─ unmatched_tracks → mark_lost() ; supprimer si > buffer_size frames
```

---

### Construction de la cost_matrix

**ByteTrack travaille en DISTANCE (à minimiser), pas en similarité.** LAP rejette les paires dont le coût dépasse `cost_limit`.

#### Métrique de base : 1 - IoU

```python
cost_matrix = 1 - iou_batch(detections, trackers)   # distance IoU ∈ [0, 1]
```

`cost > match_thresh` → LAP rejette directement. Donc `match_thresh=0.8` → IoU minimum accepté = `1 - 0.8 = 0.2`.

#### Fusion score (fuse_score, passe 1 et 3)

```python
iou_sim  = 1 - cost_matrix            # = IoU
fuse_sim = iou_sim × detection_score  # = IoU × score ∈ [0, 1]
cost     = 1 - fuse_sim               # = 1 - (IoU × score)
```

**Rôle :** une détection avec `score=1.0` et `IoU=0.4` → coût = `0.6`. La même IoU avec `score=0.5` → coût = `0.8`. Le score de détection **abaisse le coût** des paires haute-confiance, leur donnant priorité à IoU égal.

**Limite :** si le score est faible mais l'IoU est fort, la fusion peut quand même rejeter la paire. Par exemple `IoU=0.3`, `score=0.4`, `match_thresh=0.8` → coût = `1 - 0.12 = 0.88 > 0.8` → rejeté. Alors que sans fusion, coût = `0.7 < 0.8` → accepté.

#### Passe 2 (bucket LOW) : IoU seul

```python
cost_matrix = 1 - iou_batch(...)   # sans fuse_score
# thresh = 0.5 (hardcodé dans le repo)
```

Les dets LOW ne fusionnent pas leur score (il est faible par définition). Seuil fixé à `0.5` soit IoU minimum = `0.5`.

---

### Résumé : ce qui gouverne l'association

| Terme | Présent | Rôle |
|---|---|---|
| `1 - IoU` (base) | Toujours | Coût principal ; le verrou est `cost_limit = match_thresh` |
| `× detection_score` | Passe 1 et 3 | Abaisse le coût des dets haute-confiance → priorité au ranking LAP |
| Mahalanobis | **Jamais** | Non utilisé dans ByteTrack |
| Shape similarity | **Jamais** | Non utilisé dans ByteTrack |
| Re-ID embedding | **Jamais** | Non utilisé dans ByteTrack |

**Conclusion : ByteTrack n'utilise que l'IoU (+ score).** L'IoU est à la fois le critère de ranking ET le verrou d'acceptation (via `cost_limit`). Pas de Mahalanobis ni de distance de forme pour départager. Le gain sur SORT vient exclusivement du bucket LOW (deuxième passe) qui récupère les pistes partiellement occultées avec des détections faibles.

---

### Conséquence pour les cibles rapides / petites

Si IoU = 0 (target trop rapide ou bbox trop petite pour chevaucher) → coût = 1 → rejeté par LAP quel que soit `match_thresh`. Pas de mécanisme de secours. Leviers :

- `match_thresh` élevé (ex. 0.9) → IoU min = 0.1 → tolère des décalages plus grands
- `kalman_std_velocity` plus grand → Kalman accepte des accélérations → meilleure prédiction
- CMC active (H_ldv) → prédiction Kalman compensée du mouvement caméra → IoU > 0

---

## Section 1 : Principe

ByteTrack (Zhang et al., ECCV 2022) est un tracker multi-objets qui exploite la totalite des
detections, y compris celles a bas score de confiance, via deux passes d'association successives.
La premiere passe associe les detections a haut score (bucket HIGH) aux pistes actives avec
un cout IoU et l'algorithme Hongrois. La deuxieme passe (BYTE) tente d'associer les detections
a bas score aux pistes non encore matchees : ces detections faiblards correspondent souvent a des
objets partiellement occultes. Les filtres Kalman internes utilisent un modele 8D
[cx, cy, a, h, vx, vy, va, vh]. La CMC est implementee selon la Methode B : le wrapper applique
`_apply_camera_update(H)` sur `STrack.mean` de chaque piste AVANT l'appel a `tracker.update()`,
permettant de passer les detections YOLO brutes au tracker clone.

---

## Section 2 : Parametres YAML

Section `bytetrack:` dans le YAML.

| Parametre       | Type   | Defaut | Plage         | Effet                                                                    |
|-----------------|--------|--------|---------------|--------------------------------------------------------------------------|
| `track_thresh`  | float  | 0.5    | 0.01-0.9      | Seuil bucket HIGH. Detections >= seuil entrent dans la 1ere passe. En interne, `det_thresh = track_thresh + 0.1` = score min pour creer une NOUVELLE piste. Avec tophat IR: < 0.05. Avec YOLO: 0.5. |
| `track_buffer`  | int    | 30     | 5-120         | Duree de vie des pistes perdues. `buffer_size = int(fps/30 * track_buffer)` frames. A 10 Hz : `buffer_size = int(10/30 * 30) = 10` frames. Augmenter pour 10 Hz : `track_buffer: 90` = 30 frames perdues. |
| `match_thresh`  | float  | 0.8    | 0.4-0.99      | Seuil sur la DISTANCE `1-IoU`. Rejette si `1-IoU > match_thresh`, donc IoU minimum = `1 - match_thresh`. `0.8` -> IoU min = 0.2 (permissif). `0.1` -> IoU min = 0.9 (tres strict, cause de clignotement !). |
| `mot20`         | bool   | false  | true/false    | Optimisations MOT20 (scenes tres denses, >100 objets). Laisser false sauf benchmark. |
| `min_box_area`  | float  | 10     | 1-500 px2     | Aire minimale (px2) des pistes RETOURNEES (filtrage en sortie du wrapper). Cibles IR 5x2px = 10 px2 : mettre 3-10. |
| `kalman_std_position` | float | 0.05 | 0.01-0.5 | Ecart-type bruit de mesure, proportionnel a h. `sigma_mes = 2 * val * h`. A h=7px : sigma=0.7px. Augmenter si blobs IR bruyants (0.1-0.3). |
| `kalman_std_velocity` | float | 0.00625 | 0.001-0.1 | Ecart-type bruit de processus vitesse, proportionnel a h. `sigma_vel = 10 * val * h`. Augmenter si cible manoeuvre (0.02-0.05). |

**Relation track_thresh / det_thresh** (interne BYTETracker) :
- `track_thresh` = seuil HIGH (bucket principal)
- `det_thresh = track_thresh + 0.1` = seuil pour CREER une nouvelle piste (evite les faux positifs trop faibles)
- Bucket LOW : scores entre `0.1` (hardcode) et `track_thresh` - peut seulement MATCHER des pistes existantes, jamais en creer
- Avec `track_thresh=0.3` : bucket HIGH = dets >= 0.3, LOW = dets entre 0.1 et 0.3, det_thresh = 0.4

---

## Section 3 : Inputs / Outputs du workflow

**Entrees recues dans `update()`**

| Entree      | Type                        | Description                                                      |
|-------------|-----------------------------|--------------------------------------------------------------------|
| `frame`     | `ndarray (H, W, ...)`       | Frame courante (utilisee pour img_info/img_size)                   |
| `detections`| `list[[x1,y1,x2,y2,score]]` | Detections brutes (jamais compensees exterieurement par session.py) |
| `H`         | `ndarray (3,3)` ou `None`   | Homographie frame_{i-1}->frame_i. Appliquee aux STrack avant update. |

**Sorties retournees**

Liste d'objets `_TrackAdapter` :

| Attribut            | Type              | Description                                   |
|---------------------|-------------------|-----------------------------------------------|
| `track_id`          | `int`             | Identifiant unique persistant                 |
| `bbox`              | `[x1,y1,x2,y2]`  | Position courante de la cible                 |
| `score`             | `float`           | Confiance de la derniere detection            |
| `is_confirmed`      | `bool`            | Toujours True (seuls les actifs sont retournes) |
| `time_since_update` | `int`             | Toujours 0 pour les pistes retournees         |
| `history`           | `list[(cx,cy)]`   | 50 dernieres positions (trace de trajectoire) |

---

## Section 4 : Integration dans le pipeline

**Appelant** : `session.py` a chaque frame dans la boucle principale.

**Flux d'appel** :
1. `session.py` calcule H (H_ldv prioritaire, puis H_image ORB/ECC, puis None).
2. `ByteTrackWrapper.update(frame, detections, H)` est appele.
3. `_apply_camera_update(H)` patche directement `STrack.mean` (cx, cy, vx, vy) via le Jacobien analytique de H pour toutes les pistes actives et perdues.
4. `BYTETracker.update(dets_np, img_info, img_size)` du repo clone est appele avec les detections brutes.
5. Le repo ByteTrack effectue ses deux passes d'association et sa prediction Kalman interne.
6. Les `STrack` retournes sont adaptes en `_TrackAdapter` et enrichis de l'historique de positions.

**Dependance externe** : le repo doit etre clone dans `trackers/mot/bytetrack/ByteTrack/`, chemin reference par `bytetrack_root:` dans le YAML.

**CMC** : `has_internal_cmc = True`. Session.py ne compense jamais les detections. Le patch sur les instances STrack ne modifie pas le repo clone.

**Interaction state machine** : en mode SOT avec MOT en fond (mot_background=true), update est appele a chaque frame pour maintenir les pistes a jour. En mode SOT pur (mot_background=false), le tracker est mis en veille.

---

## Section 5 : Conseils de reglage

**Avec detecteur YOLO (scores 0.3-0.99)** :
- `track_thresh: 0.5`, `match_thresh: 0.8` : valeurs recommandees par les auteurs.
- `min_box_area: 10-50` selon la taille minimale des cibles attendues.
- `track_buffer: 30` adapte pour 10 Hz avec occultations de 3 s max.

**Avec detecteur TopHat IR (scores = intensite blob 0.04-0.15)** :
- `track_thresh: 0.03-0.04` : indispensable pour que les blobs entrent dans le bucket HIGH.
- `min_box_area: 4-10` : cibles IR 5x2 px = 10 px2, ne pas filtrer trop fort.
- `match_thresh: 0.5-0.6` : les petites bboxes ont une IoU naturellement faible.

**Camera tres mobile (fortes rotations LDV)** :
- Verifier que `use_ldv_cmc: true` est actif et que H_ldv est bien recu.
- Si LDV absent : activer `homography_method_image: "orb"` en niveau 3.
- Consulter les logs `[CMC]` au demarrage pour confirmer le niveau actif.

**Scene dense (nombreux objets proches)** :
- `mot20: true` si >100 objets (active des heuristiques specifiques MOT20).
- Reduire `match_thresh: 0.7` pour tolerer les recouvrements partiels entre pistes proches.
- `track_buffer: 10-15` pour eviter les zombies (pistes mortes de longue date).

---

## Section 6 : Logs DEBUG

Condition d'activation : `log_level: "DEBUG"` **ET** `debug_tracking.verbose_mot_tracker: true` dans le YAML.

### Log verbose (verbose_mot_tracker=true)

Emis par `_log_verbose()` apres chaque `update()`, une ligne par frame :

```
[ByteTrack] tracked=2 lost=1 ret=2 | T01[tr len=23 s=0.82 c=(320,240) v=(1.2,-0.4)]  T07[tr len=5 s=0.45 c=(100,80) v=(0.0,0.0)]  T03[LOST len=8]
```

**Entete** :

| Champ        | Signification |
|--------------|---------------|
| `tracked=2`  | Pistes dans `tracked_stracks` (actives et confirmees ce frame) |
| `lost=1`     | Pistes dans `lost_stracks` (perdues, en attente de re-match pendant `track_buffer` frames) |
| `ret=2`      | Pistes retournees a la state machine (= `tracked` filtre sur `is_activated`) |

**Par piste trackee** (`TXX[tr ...]`) :

| Champ    | Signification |
|----------|---------------|
| `tr`     | Piste active (dans `tracked_stracks`) |
| `len=23` | `tracklet_len` - longueur de la tracklet en frames depuis activation |
| `s=0.82` | Score de confiance de la derniere detection associee |
| `c=(320,240)` | Centre Kalman courant `(cx, cy)` depuis `STrack.mean[0:2]` |
| `v=(1.2,-0.4)` | Vitesse Kalman `(vx, vy)` depuis `STrack.mean[4:6]` |

**Par piste perdue** (`TXX[LOST ...]`) :

| Champ    | Signification |
|----------|---------------|
| `LOST`   | Piste dans `lost_stracks`, plus de detection depuis N frames |
| `len=8`  | Longueur de la tracklet quand elle a ete perdue |

**Diagnostic typique** :
- Beaucoup de `LOST` qui reviennent rapidement comme nouvelles `tr` -> ID switching : `track_buffer` trop court ou `match_thresh` trop strict.
- `tracked=0` mais `lost` en croissance -> `track_thresh` trop eleve (blobs IR en dessous du seuil HIGH).
- IDs qui sautent continuellement -> probable issue de CMC (`v` tres eleve), verifier H_ldv.

---

## Section 7 : Comportement visuel - vert vif, vert sombre, clignotement

### Couleurs de rendu

| Couleur      | Signification                               | Condition                                 |
|--------------|---------------------------------------------|-------------------------------------------|
| Vert vif     | Track active, detection associee ce frame   | `time_since_update == 0` ET `is_confirmed` |
| Vert sombre  | Prediction Kalman pure (pas de detection)   | `time_since_update > 0` ET `is_confirmed` |
| Invisible    | Track disparue de l'affichage               | Piste non retournee par le tracker        |

### ByteTrack : uniquement vert vif ou invisible

**Jamais de vert sombre.** La raison :
- `_TrackAdapter.time_since_update` est force a `0` pour toutes les pistes retournees.
- Quand YOLO ne detecte pas la cible : ByteTrack place la piste dans `lost_stracks` et ne la retourne PAS.
- Resultat : la bbox **disparait completement** de l'ecran jusqu'a ce qu'une nouvelle detection soit associee ou que `track_buffer` soit epuise.

Pour voir des predictions Kalman visibles (vert sombre) quand la detection est absente, utiliser **custom_kalman** (seul tracker qui retourne des pistes avec `time_since_update > 0`).

### Delai d'initialisation (premiere apparition d'une track)

Comportement code en dur dans ByteTrack (non configurable) :

| Frame | Etat de la piste                                        | Affichage  |
|-------|---------------------------------------------------------|------------|
| N     | Detection non matchee -> `activate()` -> `is_activated=False` | Invisible  |
| N+1   | Matchee a nouveau -> `re_activate()` -> `is_activated=True`   | Vert vif   |

**Minimum 2 frames consecutives avec detection** avant qu'une track apparaisse a l'ecran.
Exception : au frame 1 de la sequence, `is_activated=True` immediat -> apparition immediate.

Note : `det_thresh = track_thresh + 0.1`. Une detection doit avoir un score > `track_thresh + 0.1` pour creer une NOUVELLE track. Les detections entre `0.1` et `track_thresh` ne peuvent que matcher des pistes existantes (bucket LOW/BYTE).

### Nomenclature interne ByteTrack

| Terme interne       | Signification                                                      |
|---------------------|--------------------------------------------------------------------|
| `track_thresh`      | Seuil HIGH : detections >= seuil entrent dans le bucket principal  |
| `det_thresh`        | `track_thresh + 0.1` : score min pour creer une NOUVELLE piste    |
| `0.1` (hardcode)    | Seuil LOW : detections entre 0.1 et track_thresh = bucket BYTE    |
| `match_thresh`      | Seuil sur la distance `1-IoU` : rejette si `1-IoU > match_thresh` -> IoU min = `1 - match_thresh` |
| `buffer_size`       | `int(fps/30 * track_buffer)` = frames max avant suppression d'une piste perdue |
| `tracked_stracks`   | Pistes confirmees (`is_activated=True`) ou en attente confirmation |
| `lost_stracks`      | Pistes perdues, en attente de re-match pendant `buffer_size` frames |
| `unconfirmed`       | Nouvelles pistes avec `is_activated=False` (premier hit)          |
| `STrack.mean`       | Etat Kalman 8D : `[cx, cy, a, h, vx, vy, va, vh]`               |
| `STrack.tracklet_len` | Longueur de la tracklet en frames depuis activation             |
| `STrack.is_activated` | False apres premier hit, True apres deuxieme (ou a frame=1)    |

---

## Section 8 : Filtre de Kalman - modèle interne et lien avec custom_kalman

### Modèle d'état ByteTrack (8D)

```
x = [cx, cy, a, h, vx, vy, va, vh]
     └## mesures ##┘  └# vitesses #┘
     cx, cy : centre bbox (pixels)
     a      : rapport d'aspect w/h
     h      : hauteur bbox (pixels)
     vx, vy : vitesses de cx, cy (px/frame)
     va, vh : vitesses de a, h
```

La matrice R (bruit de mesure) et Q (bruit de processus) sont construites **proportionnellement à la hauteur h** :

```
sigma_mesure  = 2  × kalman_std_position × h    (pour cx, cy, h)
sigma_vitesse = 10 × kalman_std_velocity  × h   (pour vx, vy, vh)

R = diag([sigma_mesure², sigma_mesure², 1e-2², sigma_mesure²])
Q[positions] = diag([sigma_mesure², ...])
Q[vitesses]  = diag([sigma_vitesse², ...])
```

Exemple à h=7px (drone IR), valeurs par défaut :
- sigma_mes = 2 × 0.05 × 7 = **0.7px** -> R_cx = R_cy = 0.49 px²
- sigma_vel = 10 × 0.00625 × 7 = **0.44 px/frame** -> Q_vx ≈ 0.19 (px/frame)²

### Lien avec custom_kalman

`custom_kalman` utilise un Kalman 4D `[u, v, du, dv]` avec matrices **absolues** (pas proportionnelles à h) :

| Aspect | custom_kalman | ByteTrack / BotSort |
|---|---|---|
| Paramètre mesure | `measure_noise` -> R = I × val | `kalman_std_position` -> R = diag((2 × val × h)²) |
| Paramètre vitesse/processus | `process_noise` -> Q = I × val | `kalman_std_velocity` -> Q_vel = (10 × val × h)² |
| Type | Absolu (px²) | Proportionnel à h (scale avec zoom) |
| Dimension état | 4D | 8D (inclut ratio a et leurs vitesses) |

La **proportionnalité à h** de ByteTrack signifie que le Kalman s'adapte automatiquement au zoom : si la cible grossit, R grandit aussi (le détecteur est "moins précis" en proportion). C'est un avantage pour les séquences avec variation de distance.

Pour une cible de taille fixe : `kalman_std_position=0.05` et `measure_noise=0.001 × (1/4h²)` sont conceptuellement équivalents - les deux fixent la confiance accordée au détecteur.

### Réglage pour IR drone (h ≈ 7–15 px)

| Situation | Action | Param |
|---|---|---|
| Blobs TopHat très bruités, position instable | Augmenter R -> ignorer un peu la mesure | `kalman_std_position: 0.1-0.3` |
| Drone manœuvre brusquement | Augmenter Q vitesse -> le Kalman accepte les accélérations | `kalman_std_velocity: 0.02-0.05` |
| Caméra très mobile malgré CMC | Augmenter les deux | `pos: 0.15, vel: 0.03` |
| Détecteur YOLO précis, cible lente | Réduire R (coller aux détections) | `kalman_std_position: 0.02-0.03` |

---

### Causes du clignotement

Le clignotement (track apparait un frame, disparait, reapparait avec un nouvel ID) a plusieurs causes :

| Cause | Parametre responsable | Correction |
|-------|-----------------------|-----------|
| `match_thresh` trop **bas** | `match_thresh=0.1` -> IoU minimum = `1-0.1 = 0.9` -> presque impossible pour bbox 5x2px -> chaque frame cree une nouvelle track | Augmenter : `match_thresh: 0.7-0.9` (IoU min = 0.1-0.3) |
| `track_thresh` trop **eleve** | Detections sous le seuil HIGH -> pas de bucket BYTE efficace -> tracks perdues | Reduire : `track_thresh: 0.03-0.05` pour tophat IR |
| `track_buffer` trop **court** | `buffer_size = int(fps/30 * track_buffer)` trop petit -> piste supprimee avant de se retrouver | Augmenter : `track_buffer: 50-100` a 10 Hz |
| CMC absente (camera mobile)  | Predictions Kalman decalees -> IoU nul -> tout est "lost" | Verifier `use_ldv_cmc: true` et reception H_ldv |
| `min_box_area` trop **eleve** | Tracks retournees filtrees par l'aire -> petites cibles eliminee en sortie | Reduire : `min_box_area: 3-10` pour cibles IR 5x2px |
