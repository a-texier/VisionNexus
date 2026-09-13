# Algorithmes de tracking

Fonctionnement mathematique des trackers MOT, differences entre eux, et pistes
d'optimisation temps-reel. Pour la machine d'etats qui orchestre MOT/SOT, voir
[`state-machine.md`](state-machine.md). Pour les objets track manipules par la
pipeline, voir [`track-objects.md`](track-objects.md).

---

## 1. Filtre de Kalman -- `custom_kalman`

### 1.1 Vue d'ensemble

Le tracker `custom_kalman` implemente un filtre de Kalman **4D minimaliste**
entierement en NumPy, sans dependance externe. Il suit uniquement le **centre**
d'une bbox, pas sa taille.

| Aspect | custom_kalman (4D) | ByteTrack / BoostTrack (8D) |
|--------|-------------------|------------------------------|
| Etat | `[u, v, du, dv]` | `[cx, cy, a, h, vx, vy, va, vh]` |
| Taille trackee | non (derniere YOLO) | oui (aspect ratio + hauteur) |
| Jacobien CMC | Sur les 4 composantes | Sur `cx,cy,vx,vy` seulement |
| Dependances | NumPy seul | filterpy / scipy (ByteTrack) |
| Observation | Centre `(u,v)` | Centre `(cx,cy)` + optionnel taille |
| Bruit taille | Aucun (constant) | Modelise (va, vh) |

### 1.2 Etat et signification physique

```
x = [u, v, du, dv]^T    (4x1, en pixels)

  u, v   : centre de la bbox dans la frame courante (coordonnees image)
  du, dv : vitesse en pixels/frame
             -> du > 0 : objet se deplace vers la droite
             -> dv > 0 : objet descend
```

**Pourquoi pas de largeur/hauteur dans l'etat ?** Les trackers 8D comme ByteTrack
modelisent aussi `a` (aspect ratio = w/h) et `h` (hauteur), ce qui permet de
predire la taille entre deux frames. Le custom_kalman assume que la **taille ne
change pas entre deux frames** : quand un track n'est pas detecte, il garde sa
derniere bbox YOLO connue (`predicted_bbox()` reconstruit la bbox a partir du
centre Kalman + la derniere `(w,h)` mesuree).

### 1.3 Matrices du filtre

**Transition F -- mouvement constant** :
```
F = [[1, 0, dt, 0 ],    ->  u'  = u  + du.dt
     [0, 1, 0,  dt],    ->  v'  = v  + dv.dt
     [0, 0, 1,  0 ],    ->  du' = du
     [0, 0, 0,  1 ]]    ->  dv' = dv
```
`dt = 1` (une frame = une unite de temps). Modele de **vitesse constante** (CWNA) :
l'objet continue a la meme vitesse, toute acceleration atterrit dans le bruit Q.

**Observation H -- on ne mesure que le centre** :
```
H = [[1, 0, 0, 0],    ->  z[0] = u   (YOLO donne le centre x)
     [0, 1, 0, 0]]    ->  z[1] = v   (YOLO donne le centre y)
```
La detection YOLO fournit `(x1,y1,x2,y2)`. Le centre est calcule : `cx = (x1+x2)/2`,
`cy = (y1+y2)/2`. La vitesse n'est pas observee directement, elle est **inferee**
par le filtre via les frames successives.

**Bruit de processus Q** : `Q = diag([q, q, 4q, 4q])`. Les vitesses recoivent un
bruit 4x plus grand que les positions (les accelerations sont plus incertaines que
les positions). `q = process_noise` est un hyperparametre YAML.

**Bruit de mesure R** : `R = diag([r, r])`. `r = measure_noise` modelise
l'incertitude sur le centre detecte par YOLO. Valeur elevee -> le filtre fait
confiance a sa prediction cinematique (lissage fort). Valeur faible -> le filtre
suit fidelement les detections.

**Covariance P** : `P_init = 100 . I4` (covariance initiale large = "je ne sais
pas ou il va"). Diminue a mesure que le filtre accumule des mesures.

### 1.4 Cycle par frame (Methode B)

```
Pour chaque frame i :
  camera_update(H)   <- compenser le mouvement camera AVANT tout
       v
  predict()          <- projeter l'etat dans le futur
       v
  associate()         <- apparier detections YOLO <-> tracks predits
       v
  update(u, v)        <- corriger l'etat avec la mesure YOLO
```

**Pourquoi Methode B (H sur l'etat) plutot que Methode A (H sur les detections) ?**
- Methode A : on inverse H sur chaque detection YOLO avant de les passer au
  tracker. Probleme : H^-1 introduit des erreurs de calcul, et l'incertitude sur H
  est ignoree.
- Methode B : H est applique directement sur l'etat Kalman, et **les detections
  YOLO restent brutes**. Position predite et detections sont dans le **meme
  repere** (frame_i) -> association IoU directe, aucun drift cumulatif.

### 1.5 `camera_update(H)` -- le Jacobien

H est une **transformation perspective non-lineaire** :
```
[u'] = (h00.u + h01.v + h02) / w
[v']   (h10.u + h11.v + h12) / w
ou w = h20.u + h21.v + h22
```
Pour propager la **covariance** a travers cette transformation, il faut la
lineariser localement au point `(u, v)` : c'est le Jacobien J = d(u',v')/d(u,v).
Si H est purement affine (h20=h21=0, h22=1), la transformation est lineaire et le
Jacobien est exact. Sinon (vraie homographie perspective), J est une approximation
du premier ordre, suffisante pour les petits mouvements camera entre frames
consecutives.

```
        1   [ h00 - u'.h20    h01 - u'.h21 ]
J =   ---- . [                               ]
        w   [ h10 - v'.h20    h11 - v'.h21 ]
```
Evalue **au point courant** `(u_p, v_p)` apres le warp.

**Extension a l'etat 4D** : position `(u,v)` et vitesse `(du,dv)` se transforment
de la meme facon sous une homographie (hypothese : le mouvement camera affecte
identiquement position et vitesse dans le plan image) :
```
     [ J   0 ]
J4 = [       ]    (4x4 bloc-diagonal)
     [ 0   J ]
```

**Propagation de la covariance** : `P' = J4 . P . J4^T` (loi de propagation de la
covariance pour une transformation lineaire/linearisee).

**Transformation de la vitesse** : `[du', dv']^T = J . [du, dv]^T` -- approximation
tangente. Si la camera pivote, une vitesse horizontale acquiert une composante
verticale proportionnelle a h21.

```python
# Code complet camera_update
w   = H[2,0]*u + H[2,1]*v + H[2,2]
u_  = (H[0,0]*u + H[0,1]*v + H[0,2]) / w
v_  = (H[1,0]*u + H[1,1]*v + H[1,2]) / w

J[0,0] = (H[0,0] - u_*H[2,0]) / w
J[0,1] = (H[0,1] - u_*H[2,1]) / w
J[1,0] = (H[1,0] - v_*H[2,0]) / w
J[1,1] = (H[1,1] - v_*H[2,1]) / w

du_, dv_ = J @ [du, dv]
J4 = [[J, 0], [0, J]]
P_ = J4 @ P @ J4.T
```

### 1.6 `predict()` -- etape de prediction

```
x_pred = F . x
P_pred = F . P . F^T + Q
```
F propage l'etat cinematiquement : la position avance de `(du, dv)`, la vitesse
reste constante. Q ajoute de l'incertitude (l'objet peut avoir accelere). Apres
`camera_update(H)` + `predict()`, l'etat est dans le repere `frame_i` avec une
prediction cinematique : la position predit ou l'objet serait s'il continuait sur
sa lancee dans la frame courante.

### 1.7 `update(u, v)` -- etape de correction

**Innovation (residu de mesure)** : `y = z - H.x_pred` (2x1), ecart entre mesure
YOLO et prediction Kalman.

**Covariance d'innovation** : `S = H . P . H^T + R` (2x2) -- incertitude de l'etat
projete plus bruit capteur.

**Gain de Kalman** : `K = P . H^T . S^-1` (4x2) -- equilibre la confiance entre le
modele (P faible -> K petit) et la mesure (R faible -> K grand).

**Mise a jour** : `x = x_pred + K.y` (correction de l'etat), `P = (I - K.H) . P`
(reduction de l'incertitude). Si K->0 (mesure peu fiable), x reste proche de x_pred.

### 1.8 Distance de Mahalanobis -- gate d'association

```
d^2 = y^T . S^-1 . y     (scalaire)
```
Distance normalisee par l'incertitude entre mesure et prediction. Contrairement a
la distance euclidienne, elle tient compte de la forme de la covariance : une
detection dans la direction de forte incertitude est moins penalisee. Utilisee en
mode `use_mahalanobis: true` comme cout d'association a la place de (1-IoU). Une
valeur elevee (> chi2(2) = 5.99 a 95%) signale une detection probablement non
associee a ce track.

### 1.9 Algorithme hongrois -- association detections <-> tracks

```
cout[i,j] = 1 - IoU(det_i, pred_bbox(trk_j))              si IoU > 0
           = dist_euclidienne(det_i, trk_j) / dist_threshold   sinon
           = 1e6                                            si impossible (sentinel)
```
Le fallback distance euclidienne evite d'exclure des paires valides quand les
bboxes ne se chevauchent pas mais sont proches (objet petit, track decale apres
occlusion courte). En mode `use_mahalanobis: true` : `cout[i,j] = d2_mahalanobis`.

`scipy.optimize.linear_sum_assignment` implemente l'algorithme hongrois en O(n^3),
trouve l'affectation bijective qui minimise la somme totale des couts. Les paires
dont le cout depasse le seuil (`> 1 - iou_threshold`) sont rejetees.

Resultats : `matches` (-> update Kalman), `unmatched_dets` (-> nouveau track),
`unmatched_trks` (-> predict seul, age++).

### 1.10 Cycle de vie d'un track

```
Detection sans track -> Track cree (hits=1, is_confirmed=False)
                          v
                    Frame suivante :
                      -> detection trouvee -> hits=2 -> is_confirmed=True
                      -> pas de detection -> time_since_update=1
                          v
                    Si time_since_update > max_age -> track supprime
```

| Parametre YAML | Role |
|---------------|------|
| `min_hits` (=2) | Frames consecutives avec detection pour confirmer un track |
| `max_age` (=5) | Frames sans detection avant suppression |

Un track non confirme (`hits < 2`) n'est **pas retourne** par `update()` sauf s'il
vient d'etre mis a jour (`time_since_update == 0`). Filtre les fausses detections
isolees.

**Reconstruction de la bbox** (`predicted_bbox`) : centre Kalman predit `(u,v)` +
largeur/hauteur = derniere mesure YOLO connue. La taille n'est pas predite : si
l'objet grossit ou retrecit entre deux detections, la bbox reconstruite aura la
mauvaise taille mais le bon centre.

### 1.11 Comparaison 4D vs 8D ByteTrack

Etat 8D ByteTrack : `x = [cx, cy, a, h, vx, vy, va, vh]` (`a` = aspect ratio w/h,
`h` = hauteur bbox). ByteTrack et BoostTrack appliquent egalement H via Jacobien,
mais **uniquement sur les 4 composantes cinematiques** `[cx, cy, vx, vy]`. Les
composantes `[a, h, va, vh]` restent **inchangees** -- invariantes sous une
rotation camera (la taille en pixels d'un objet ne change pas si la camera pivote
sur place, hors zoom). Le custom_kalman 4D applique J sur toutes ses composantes,
ce qui est exact puisqu'il ne modelise que position + vitesse.

| Critere | custom_kalman 4D | ByteTrack 8D |
|---------|:---:|:---:|
| Taille predite | non | oui |
| Aspect ratio suivi | non | oui |
| CMC sur vitesse taille | - | non (invariant) |
| Dependances | NumPy | filterpy / scipy |
| Vitesse CPU | Tres rapide | Rapide |
| Covariance propagee | Sur 4D | Sur 8D |
| Adapte objets rigides | oui | oui |
| Adapte objets deformables | non | oui |

**Avantages custom_kalman 4D** : simplicite (4 composantes, matrices 4x4 NumPy
seul, facile a debugger) ; pas de derive de taille (une bbox trop grande ne croit
pas indefiniment, elle reste a la valeur YOLO) ; compatible CMC LDV (Jacobien
K.R.K^-1 depuis l'IMU s'applique naturellement sur `[u,v,du,dv]`) ; aucune
dependance lourde.

**Inconvenients** : pas de prediction de taille (objet qui grossit rapidement --
approche vers la camera -- garde l'ancienne taille jusqu'a la prochaine detection
YOLO) ; pas d'aspect ratio (rotation 3D degrade l'association IoU) ; en cas
d'occultation longue, l'incertitude sur la position croit mais la taille reste
artificiellement fixe.

---

## 2. Differences ByteTrack / BoT-SORT / BoostTrack

### Vue d'ensemble

| Critere | ByteTrack | BoT-SORT | BoostTrack |
|---|---|---|---|
| Papier | Zhang et al., 2022 | Aharon et al., 2022 | Stanojevic et al., 2023 |
| Base | SORT + BYTE | ByteTrack + GMC + ReID | ByteTrack + ECC + Mahalanobis |
| CMC | Externe (Methode B) | Interne sparseOptFlow | Interne ECC (optionnel) |
| Etat Kalman | `[cx,cy,a,h,vx,vy,va,vh]` | `[cx,cy,a,h,vx,vy,va,vh]` | `[cx,cy,h,r,vx,vy,vh,vr]` |
| Cout CPU | Faible | Moyen (+GMC) | Moyen (+ECC si active) |
| ReID | Non | Optionnel (FastReID) | Optionnel (torchreid) |

### 2.1 ByteTrack

Association en **deux passes** : la premiere associe les detections a **score
eleve** (`> track_thresh`) aux tracks existantes. La seconde passe (BYTE) recupere
les detections a **bas score** (entre `0.1` et `track_thresh`) pour les associer
aux tracks perdues -- evite de perdre des tracks en cas d'occultation partielle ou
le detecteur retourne un score degrade.

- `det_thresh = track_thresh + 0.1` (hardcode dans BYTETracker) : seules les
  detections au-dessus creent de nouvelles tracks.
- `track_buffer` : nombre de frames avant suppression d'une track perdue
  (`max_age = fps * track_buffer / 30` en interne).
- **CMC** : ByteTrack n'a pas de CMC interne. Le pipeline applique la **Methode B**
  externe : avant chaque `tracker.update()`, warp des etats Kalman `(cx,cy,vx,vy)`
  des STrack via le Jacobien de `H` au point `(cx,cy)`. Les composantes `a,h,va,vh`
  restent inchangees.
- **Tracks perdues** : `lost_stracks` contient les tracks sans detection.
  ByteTrack **ne retourne jamais** les tracks perdues dans `online_targets` -> la
  track disparait visuellement entre deux detections. Avec
  `show_kalman_predict: true`, le wrapper inclut ces tracks avec
  `time_since_update=1` (vert sombre) jusqu'a leur expiration.

### 2.2 BoT-SORT

Reprend la logique BYTE de ByteTrack et ajoute :
- **GMC interne** (Global Motion Compensation) via `sparseOptFlow` (Shi-Tomasi +
  Lucas-Kanade). Warp affine 2x3 calcule depuis l'image, applique aux predictions
  Kalman avant l'association.
- **ReID optionnel** (FastReID) pour l'association de re-identification sur les
  tracks perdues.
- Trois buckets de score (`track_high_thresh`, `track_low_thresh`,
  `new_track_thresh`) au lieu de deux dans ByteTrack.

**CMC** : GMC interne genere une matrice affine 2x3. Quand `use_ldv_cmc=true` et
LDV disponible, le monkey-patch `gmc.apply` injecte `H_ldv[:2,:]` directement sans
calcul image (gain ~5-15 ms/frame).

**Difference vs ByteTrack** : cout supplementaire du GMC (~5 ms a 640x512) ;
meilleure robustesse aux mouvements camera car la CMC est integree dans la boucle
d'association ; `is_activated` filtre commente dans le wrapper -> 1 seule
detection suffit pour qu'une track soit retournee (ByteTrack requiert
`min_hits=2`). `lost_stracks` identique a ByteTrack.

### 2.3 BoostTrack

Ajoute au-dessus de ByteTrack : **distance de Mahalanobis** dans le cout
d'association (tient compte de l'incertitude Kalman) ; **distance de forme**
(ratio `w/h`) ; **DLO / DUO boost** (ajustements adaptatifs de confiance selon le
score detection et la distance Mahalanobis) ; **ECC optionnel** pour CMC image
interne.

**Modele Kalman different** : etat `[cx, cy, h, r, vcx, vcy, vh, vr]` ou `r = w/h`
(ByteTrack et BoT-SORT utilisent `[cx,cy,a,h,vx,vy,va,vh]`, ordre different). Les
matrices `Q` et `R` de BoostTrack sont des valeurs **absolues** (pas
proportionnelles a `h`), configurees via `kalman_R_pos`, `kalman_R_h`,
`kalman_Q_scale`, etc.

**CMC** : `use_ecc: true` -> ECC interne calcule `H` depuis l'image (si LDV
disponible, `H_ldv` injecte dans `ecc._transforms`, bypass ECC). `use_ecc: false`
-> Methode B via `KalmanBoxTracker.camera_update(H)`.

**`max_age` interne vs visible** : controle la duree de vie **interne**
uniquement. Une track sans detection survit `max_age` frames dans
`self._tracker.trackers` pour etre reaffectee en cas de reapparition, mais
**n'est pas retournee** dans `output` pendant cette periode (BoostTrack ne
retourne que `time_since_update == 0`). Avec `show_kalman_predict: true`, le
wrapper parcourt `self._tracker.trackers` et expose les tracks avec
`time_since_update >= 1` (vert sombre, bbox Kalman predite).

### 2.4 Tableau de decision (IR drone)

| Situation | Recommandation |
|---|---|
| CPU uniquement (pas de GPU) | `custom_kalman` |
| Mouvement camera connu (LDV disponible) | ByteTrack ou BoostTrack (`use_ecc: false`) |
| Mouvement camera image uniquement | BoT-SORT (`cmc_method: sparseOptFlow`) |
| Occultations longues, besoin de re-ID | BoT-SORT avec ReID ou BoostTrack |
| Petites cibles IR avec bruit de detection | BoostTrack (`lambda_mhd > 0`, Mahalanobis) |
| Debug : voir tracks sans detection | `show_kalman_predict: true` |

### 2.5 `show_kalman_predict`

Option ajoutee dans les sections `bytetrack:`, `botsort:`, `boosttrack:` du YAML :
```yaml
bytetrack:
  show_kalman_predict: true   # affiche tracks perdues en vert sombre
```
**Effet visuel** : les tracks sans detection ce frame apparaissent en **vert
sombre** (`color_mot_predict`) avec la bbox predite par le filtre de Kalman. Utile
pour diagnostiquer le clignotement (track disparait 1 frame sur 2 --
`show_kalman_predict: true` le supprime visuellement), les faux positifs de re-ID
(track fantome persistant trop longtemps), et la qualite de la prediction Kalman
pendant une occultation.

**Difference avec `custom_kalman`** : ce tracker retourne *nativement* les tracks
predites (`time_since_update > 0` inclus dans les resultats). Les trois autres
trackers ne le faisaient pas -- `show_kalman_predict` uniformise ce comportement.

---

## 3. Amelioration temps-reel

Cible historique de cette section : Jetson Orin Nano (ARM Cortex-A78AE, iGPU 1024
CUDA cores, TensorRT 8.6.2, JetPack 5/6), budget indicatif <= 20 ms/frame pour 50
FPS. Les principes restent valables sur la cible x86_64 actuelle avec GPU NVIDIA
recent (voir [`deployment.md`](deployment.md)), avec des marges plus
confortables.

### 3.1 Zones de goulot d'etranglement -- boucle `_run_loop()`

```
session.py  frame_load      <- lecture + push buffer
session.py  detect_mot      <- YOLO / TopHat (majeur)
session.py  ldv_cmc         <- homographie inertielle (negligeable)
session.py  image_cmc       <- ORB/ECC externe (optionnel, couteux)
session.py  mot_update      <- tracker MOT : Kalman + CMC interne + association
session.py  sot_update      <- tracker SOT : boucle de recherche region
session.py  render          <- imshow + dessin + MJPEG encode
```
Chiffres ci-dessous : estimations pour une image 640x512 IR sur Jetson Orin Nano,
variables selon la config YAML active.

**Detecteur MOT (dominant, 5-30 ms)**
- YOLO `.pt` CPU : 15-30 ms (pire cas, sans TRT).
- YOLO `.engine` TensorRT : 5-10 ms (FP16, gain x3-5 vs `.pt` CPU).
- TopHat `_detect_candidates_multi()` : 2-8 ms/passe. Cout = `n_kernels x
  n_k_sigma` passages (ex. `tophat_kernels=[3,7]` + `k_sigma_levels=[1.5,2.5]` =
  4 passes tophat + threshold + `connectedComponentsWithStats`).

**CMC image externe (6-30 ms, optionnel)** : active uniquement si
`homography_method_image != ""` **et** LDV absent **et** tracker sans CMC interne.
ORB (500 features + BFMatcher + RANSAC) : 6-12 ms. ECC (registration iterative
plein cadre) : 15-30 ms, tres couteux. Si LDV present, section court-circuitee.

**CMC inertielle LDV (< 0.2 ms)** : 2 rotations 3x3 + 2 multiplications
matricielles + normalisation, negligeable.

**Tracker MOT (5-20 ms)** : BoT-SORT (CMC interne sparseOptFlow, 500 points
Lucas-Kanade pyramid, 4-6 ms, redondant si LDV actif) ; BoostTrack (ECC interne,
5-20 ms si active, cout d'association superieur) ; ByteTrack (pas de CMC interne,
Kalman + association seulement, 1-3 ms, moins robuste sans CMC si camera mobile).

**Tracker SOT (3-50 ms selon algorithme)** : CSRT (`scales=33`, `padding=3.0`,
5-15 ms) ; Tracking_TOPHAT (Tophat ROI + correlation + vote, 3-8 ms mode tophat, 10-25 ms si
ResNet active) ; DiMP/OSTrack (backbone ResNet50/Swin, 20-50 ms sans TRT --
inutilisable en temps-reel sur Jetson sans compilation engine --, 8-15 ms estime
avec TRT) ; SAM2 (lourd GPU/memoire, a eviter en temps-reel sur Jetson Orin Nano).

**Rendu (5-20 ms)** : `cv2.imshow()` + `waitKey(1)` : 5-10 ms sur affichage local
(X11/HDMI), bloque au moins 1 ms meme sans evenement. MJPEG encode
(`stream_mode="mjpeg"`) : 3-8 ms/frame. Mode headless : rendu ~0 ms.

**Recapitulatif par mode** :

| Section | Mode MOT actif | Mode SOT actif | Config pire cas |
|---|---|---|---|
| `frame_load` | 1-3 ms | 1-3 ms | stockage reseau |
| `detect_mot` | 5-30 ms | 0 ms si `mot_bg=off` | YOLO .pt CPU |
| `ldv_cmc` | < 0.2 ms | < 0.2 ms | toujours negligeable |
| `image_cmc` | 0 / 6-30 ms | 0 / 6-30 ms | ECC externe sans LDV |
| `mot_update` | 5-20 ms | 0-5 ms (bg off) | BoostTrack ECC |
| `sot_update` | 0 ms | 5-50 ms | DiMP sans TRT |
| `render` | 5-20 ms | 5-20 ms | MJPEG + local_display |
| **TOTAL estime** | **16-73 ms** | **11-73 ms** | |

### 3.2 Ameliorations, par impact x facilite decroissant

**Tier 1 -- impact eleve, rapide a appliquer**

| # | Action | Gain |
|---|--------|------|
| A | Convertir YOLO `.pt` en TensorRT `.engine` (`python tools/convert_pt_onnx_engine.py weights/last.pt --engine --fp16`, puis `weights_yolo: "weights/last.engine"` + `device: "cuda:0"`) | 15-30 ms -> 5-10 ms/frame |
| B | `mot_background: false` (ou touche `M` en runtime) : desactive la detection MOT pendant le SOT. A eviter si dual-SOT actif (le 2e clic a besoin de bboxes MOT fraiches) | -5 a -30 ms en SOT |
| C | Reduire les passes TopHat : `tophat_kernels: [7]` + `k_sigma_levels: [2.0]` au lieu de `[3,7]`/`[1.5,2.5]` (tester la qualite avant de deployer) | -2 a -8 ms/passe supprimee |
| D | Verifier que LDV est actif pour eviter le sparseOptFlow de BoT-SORT (`use_ldv_cmc: true`, log `H_actif=LDV (Niv.1)`) | -4 a -6 ms/frame |

Le `.engine` est compile pour l'iGPU Jetson exact -- ne pas copier d'une autre
machine.

**Tier 2 -- impact moyen, demande tuning**

| # | Action | Gain |
|---|--------|------|
| E | CSRT : `scales: 17` (au lieu de 33), `padding: 2.0` (au lieu de 3.0). Tester sur sequences avec zoom/decrochage | -3 a -8 ms en SOT |
| F | `tracker_mot: "bytetrack"` au lieu de BoT-SORT si LDV couvre deja la CMC (sinon ByteTrack est moins robuste aux mouvements rapides) | -4 a -6 ms/frame |
| G | `img_size: 320` au lieu de 640 pour cibles de grande taille angulaire (perte des petits objets a calibrer) | x2-4 sur la duree d'inference |
| H | Compiler DiMP/OSTrack en TRT avant usage SOT (`tools/convert_pt_onnx_engine.py` ou export `ultralytics` si supporte) | 20-50 ms -> 8-15 ms en SOT |

**Tier 3 -- gains fins, profiling necessaire**

| # | Action | Gain |
|---|--------|------|
| I | `local_display: false` (+ `stream_mode: mjpeg` pour visualiser a distance) : supprime `waitKey`+`imshow` | -5 a -10 ms/frame |
| J | `cv2.ORB_create(nfeatures=200)` au lieu de 500 dans `ego_motion.py:385` si CMC image ORB active (acceptable si > 50 inliers habituels) | -2 a -5 ms |
| K | Profiler les temps de chargement loader (`[profiling] section 'frame_load'`) : si > 3 ms sur stockage lent, envisager un thread de pre-chargement (double-buffering) | variable |

### 3.3 Plan d'action recommande (ordre d'application)

| Etape | Action | Complexite | Gain estime |
|-------|--------|-----------|-------------|
| 1 | Convertir YOLO -> `.engine` TRT FP16 | Faible (script fourni) | -15 a -20 ms |
| 2 | `mot_background: false` | Triviale (YAML) | -5 a -30 ms en SOT |
| 3 | Reduire passes TopHat -> 1 kernel, 1 sigma | Faible (YAML + test) | -4 a -16 ms |
| 4 | Verifier LDV actif (logs CMC Niv.1) | Verification seulement | -4 a -6 ms |
| 5 | CSRT : scales 33 -> 17, padding 3.0 -> 2.0 | Faible (YAML + test) | -3 a -8 ms SOT |
| 6 | ByteTrack si LDV couvre la CMC | Faible (YAML) | -4 a -6 ms MOT |
| 7 | `local_display: false` + MJPEG distant | Triviale (YAML) | -5 a -10 ms |
| 8 | YOLO `img_size: 320` si cibles grandes | YAML + validation | -3 a -8 ms |

**Apres les etapes 1-4** : budget attendu environ 8-15 ms/frame en mode MOT pur ->
**50+ FPS viable**.
