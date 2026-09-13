# Tracker MOT : custom_kalman (Kalman + Algorithme Hongrois)

## Section 1 : Principe

Custom Kalman est un tracker multi-objets entierement realise en interne, sans dependance externe.
Il associe un filtre de Kalman 2D par cible (modele position+vitesse dans le plan image) et
l'algorithme Hongrois (LAP) pour l'association optimale entre les detections courantes et les
pistes actives. La compensation du mouvement camera (CMC) est appliquee en interne selon la
Methode B : `camera_update(H)` warp l'etat Kalman de chaque piste dans le referentiel de la
frame courante AVANT la prediction cinematique, ce qui permet de passer les detections YOLO
brutes sans aucune compensation externe.

---

## Section 2 : Parametres YAML

Section `kalman_mot_custom:` dans le YAML.

| Parametre        | Type   | Defaut  | Plage       | Effet                                                                 |
|------------------|--------|---------|-------------|-----------------------------------------------------------------------|
| `max_age`        | int    | 5       | 1-60        | Frames max sans detection avant suppression. Augmenter pour occultations longues. |
| `min_hits`       | int    | 2       | 1-5         | Observations consecutives pour confirmer une piste. Reduire pour reactivite, augmenter contre faux positifs. |
| `iou_threshold`  | float  | 0.3     | 0.0-0.9     | IoU minimum pour accepter une association. 0 = toute association acceptee. |
| `dist_threshold` | float  | 100     | 20-500 px   | Distance max (px) pour le fallback Euclidien quand IoU=0. |
| `process_noise`  | float  | 100     | 1-1000      | Bruit processus Kalman (Q). Elever si trajectoires erratiques. |
| `measure_noise`  | float  | 0.001   | 0.0001-10   | Bruit mesure Kalman (R). Reduire si detections tres precises. |
| `use_mahalanobis`| bool   | false   | true/false  | Remplace IoU+Euclidien par distance de Mahalanobis (incertitude Kalman). |

---

## Section 3 : Inputs / Outputs du workflow

**Entrees recues dans `update()`**

| Entree      | Type                     | Description                                                    |
|-------------|--------------------------|----------------------------------------------------------------|
| `frame`     | `ndarray (H, W, ...)`    | Frame courante (non utilisee par l'algo, gardee pour interface uniforme) |
| `detections`| `list[[x1,y1,x2,y2,score,cls]]` | Detections YOLO brutes dans le referentiel frame courante |
| `H`         | `ndarray (3,3)` ou `None`| Homographie frame_{i-1}->frame_i (LDV ou ORB/ECC). None = camera fixe. |

**Sorties retournees**

Liste d'objets `Track` exposes par `mot_tracker.py` :

| Attribut            | Type              | Description                                        |
|---------------------|-------------------|----------------------------------------------------|
| `track_id`          | `int`             | Identifiant unique persistant de la cible          |
| `bbox`              | `[x1,y1,x2,y2]`  | Bbox issue de la derniere detection associee       |
| `score`             | `float`           | Confiance de la derniere detection                 |
| `is_confirmed`      | `bool`            | True si hits >= min_hits                           |
| `time_since_update` | `int`             | Frames depuis la derniere association              |
| `history`           | `list[(cx,cy)]`   | 50 dernieres positions (trace de trajectoire)      |
| `predicted_bbox()`  | methode           | Bbox predite par Kalman (centre + derniere taille) |

---

## Section 4 : Integration dans le pipeline

**Appelant** : `session.py` a chaque frame, dans la boucle principale.

**Flux d'appel** :
1. `session.py` calcule ou recupere H (H_ldv via LDV inertiel, ou H_image via ORB/ECC, ou None).
2. `session.py` appelle `mot_tracker.update(frame, detections, H=H_cmc)`.
3. `custom_kalman/tracker.py` delegue a `MultiObjectTracker.update(detections, frame_idx, H)`.
4. Pour chaque piste active : `kf.camera_update(H)` puis `kf.predict()` (Methode B).
5. Matrice de cout (IoU ou distance) calculee entre predictions et detections brutes.
6. Algorithme Hongrois associe pistes et detections.
7. Pistes mises a jour, nouvelles pistes creees, vieilles pistes supprimees.
8. Les pistes confirmees sont retournees a `session.py`.

**Interaction avec la state machine** :
- En mode MOT pur : les tracks retournees sont visualisees et passees aux composants SOT.
- En mode SOT actif (mot_background=false) : le tracker est mis en veille (update non appele).
- En mode SOT avec MOT en fond (mot_background=true) : update appele a chaque frame ; les tracks alimentent `DummySot` ou `TrackingTophatSot`.

**CMC** : `has_internal_cmc = True`. Les detections ne sont JAMAIS compensees exterieurement par session.py. H est transmis brut au tracker qui applique la correction en interne.

---

## Section 5 : Conseils de reglage

**Scene IR peu dense (1-5 drones, camera mobile)** :
- `process_noise: 100`, `measure_noise: 0.001` : configuration par defaut, bon compromis.
- `max_age: 5-10` : tolere les breves occultations (passage derriere nuage).
- `min_hits: 2` : confirme rapidement les nouvelles cibles.
- `iou_threshold: 0.1-0.2` : les petites cibles IR ont une IoU faible ; abaisser pour associer.
- `dist_threshold: 80-120 px` : fallback distance pour les cibles sans chevauchement.

**Scene dense (>20 objets, croisements frequents)** :
- `use_mahalanobis: true` pour mieux gerer l'incertitude lors des croisements.
- `min_hits: 3` pour reduire les faux positifs.
- `max_age: 3` pour eviter les zombies (pistes mortes qui subsistent).

**Camera tres mobile (fortes rotations)** :
- Verifier que `use_ldv_cmc: true` est actif et que H_ldv est bien recu.
- Si LDV absent : activer `homography_method_image: "orb"` pour le niveau 3.
- Elever `process_noise` si la cible semble "en retard" sur les detections apres CMC.

**Petites cibles (< 10 px)** :
- `iou_threshold: 0.0` ou tres bas (< 0.1) car l'IoU entre deux petites bbox est naturellement nul.
- `dist_threshold: 50-80 px` selon la vitesse maximale de la cible a 10 Hz.
- `min_box_area` dans `bytetrack:` n'affecte pas custom_kalman ; ici c'est le detecteur qui filtre.

---

## Section 6 : Logs DEBUG

Condition d'activation : `log_level: "DEBUG"` **ET** `debug_tracking.verbose_mot_tracker: true` dans le YAML.

### Log standard (toujours en DEBUG)

Emis par `tracker.py` apres chaque `update()` :

```
CustomKalman F00572: dets=3 -> tracks=2  H=yes
```

| Champ    | Signification |
|----------|---------------|
| `F00572` | Index de frame (frame_idx interne, monotone depuis init) |
| `dets=3` | Nombre de detections recues (entrees YOLO/TopHat) |
| `tracks=2` | Nombre de tracks retournees (confirmees + time_since_update=0) |
| `H=yes/no` | Homographie CMC recue ou non |

### Log verbose (verbose_mot_tracker=true)

Emis par `_log_verbose()`, une ligne par frame :

```
[CK F00572] all=3 conf=2 tent=1 ret=2 | T01[CONF h=5 tsu=0 c=(320,240) v=(1.2,-0.4) b=[310,230,330,250]]  T02[CONF h=3 tsu=1 c=(100,80) v=(0.0,0.0) b=[95,75,105,85]]  T03[TENT h=1 tsu=0 c=(450,300) v=(0.3,0.1) b=[445,295,455,305]]
```

**Entete** :

| Champ   | Signification |
|---------|---------------|
| `all=3` | Toutes les pistes internes (actives + en prediction) |
| `conf=2`| Pistes confirmees (`hits >= min_hits`) |
| `tent=1`| Pistes tentatives (`hits < min_hits`) - non retournees par defaut |
| `ret=2` | Pistes effectivement retournees a la state machine |

**Par piste** (`TXX[...]`) :

| Champ   | Signification |
|---------|---------------|
| `CONF` / `TENT` | Etat : confirmee ou tentative |
| `h=5`   | `hits` - nombre de detections associees depuis la creation |
| `tsu=0` | `time_since_update` - frames depuis la derniere association. 0 = mise a jour ce frame. >0 = prediction pure (Kalman seul, pas de detection) |
| `c=(320,240)` | Centre Kalman courant `(u, v)` en pixels |
| `v=(1.2,-0.4)` | Vitesse Kalman `(du, dv)` en px/frame |
| `b=[x1,y1,x2,y2]` | Derniere bbox de detection associee (NON la bbox predite) |

**Diagnostic typique** :
- Beaucoup de `TENT` qui n'apparaissent pas dans `ret` -> `min_hits` trop eleve ou detections trop inconstantes.
- `tsu` croissant sur plusieurs frames -> piste en prediction pure, la detection a disparu ou l'IoU est trop faible pour matcher.
- `v` tres eleve -> la CMC ne compense pas assez (verifier H_ldv/ORB).
- IDs qui sautent (ex : 1 -> 90) -> `max_age` tres court qui tue les pistes + `min_hits` = 1 qui cree de nouvelles pistes immediatement. Augmenter `max_age` et `min_hits`.

---

## Section 7 : Comportement visuel - vert vif, vert sombre, clignotement

### Couleurs de rendu

| Couleur      | Signification                               | Condition                                 |
|--------------|---------------------------------------------|-------------------------------------------|
| Vert vif     | Track active, detection associee ce frame   | `time_since_update == 0` ET `is_confirmed` |
| Vert sombre  | Prediction Kalman pure (pas de detection)   | `time_since_update > 0` ET `is_confirmed` |
| Invisible    | Track non retournee (tentative ou supprimee) | `hits < min_hits` OU `time_since_update > max_age` |

### custom_kalman : le seul tracker avec vert sombre

**Le vert sombre est possible et attendu** pour custom_kalman. Quand YOLO ne detecte pas la cible :
- La piste confirmee reste dans les tracks internes avec `time_since_update > 0`.
- Le filtre de Kalman continue de predire la position (extrapolation cinematique).
- La piste est **toujours retournee** avec `time_since_update > 0` -> affichee en vert sombre.
- Elle disparait seulement quand `time_since_update > max_age`.

C'est le comportement **le plus robuste** pour les courtes occultations : la bbox reste visible et indique la position predite de la cible.

### Delai d'initialisation (premiere apparition d'une track)

| Frame | Etat de la piste                           | Affichage        |
|-------|--------------------------------------------|------------------|
| N     | Premiere detection -> `hits=1`, `is_confirmed=(1>=min_hits)` | Vert vif si `min_hits=1`, sinon invisible |
| N+1   | Deuxieme detection -> `hits=2`              | Vert vif si `min_hits<=2`, sinon invisible |
| N+k   | kième detection -> `hits=k >= min_hits`    | Vert vif (premiere apparition) |

Avec `min_hits=2` (defaut) : **2 frames consecutives** pour voir la track.
Avec `min_hits=1` : apparition immediate mais plus de faux positifs.

### Nomenclature interne custom_kalman

| Terme interne      | Signification                                                         |
|--------------------|-----------------------------------------------------------------------|
| `hits`             | Nombre total de detections associees a cette piste depuis sa creation |
| `time_since_update` (`tsu`) | Frames depuis la derniere association. 0 = detecte ce frame, >0 = prediction pure |
| `is_confirmed`     | `hits >= min_hits` -> piste retournee et affichee                     |
| `kf.position`      | `(u, v)` = centre Kalman courant, etat `x[0], x[1]`                 |
| `kf.velocity`      | `(du, dv)` = vitesse Kalman, etat `x[2], x[3]`                      |
| `KalmanFilter2D.x` | Etat 4D : `[u, v, du, dv]` (position + vitesse en pixels/frame)     |
| `camera_update(H)` | Applique H sur l'etat `[u, v, du, dv]` AVANT `predict()` (Methode B) |
| `iou_threshold`    | IoU MINIMUM pour accepter une association (pas `1-IoU` comme ByteTrack) |
| `dist_threshold`   | Distance Euclidienne max (px) pour le fallback quand IoU=0           |
| `max_age`          | `tsu > max_age` -> piste supprimee                                    |
| `min_hits`         | Observations consecutives (hits) pour confirmer                      |

### Comparison avec ByteTrack/BotSort/BoostTrack

| Aspect                 | custom_kalman           | ByteTrack / BotSort    | BoostTrack              |
|------------------------|-------------------------|------------------------|-------------------------|
| Vert sombre            | **Oui** (tsu > 0)       | Non (toujours tsu=0)   | Non (toujours tsu=0)    |
| Délai confirmation     | `min_hits` frames (configurable) | 2 (ByteTrack) / 1 (BotSort) | `min_hits` frames (defaut 3) |
| Piste perdue           | Reste visible (vert sombre) jusqu'a `max_age` | Disparait immediatement (lost_stracks) | Disparait immediatement |
| Cout association       | IoU + Euclidien         | IoU (BYTE: deux passes) | IoU + Mahalanobis + Shape |

### Causes du clignotement (custom_kalman)

| Cause | Parametre responsable | Correction |
|-------|-----------------------|-----------|
| `max_age` tres court | Piste supprimee apres 1-2 frames sans detection -> nouvel ID immediatement | Augmenter : `max_age: 5-15` |
| `min_hits=1` + `max_age` court | Cree une track a chaque detection, la supprime des la prochaine absence | `min_hits: 2`, `max_age: 5` |
| `iou_threshold` trop eleve | Pour cibles 5x2px, IoU entre deux frames peut etre 0 si decalage > 1px | Reduire : `iou_threshold: 0.0-0.1` |
| `dist_threshold` trop petit | Fallback Euclidien ne couvre pas le deplacement entre frames | Augmenter : `dist_threshold: 80-150` selon vitesse |
| CMC absente | Predictions decalees -> IoU nul -> piste "perdue" chaque frame | Verifier H_ldv et `use_ldv_cmc: true` |
