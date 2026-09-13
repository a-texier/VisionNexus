# custom_kalman - Tracker MOT interne

Tracker multi-objets Kalman 2D + algorithme Hongrois (scipy).
100 % Python, CPU uniquement, aucune dependance externe GitHub.

---

## Architecture

```
kalman_filter.py   KalmanFilter2D          etat [u,v,du,dv], camera_update/predict/update
mot_tracker.py     MultiObjectTracker      cycle camera_update -> predict -> association -> pruning
tracker.py         CustomKalmanTracker     adaptateur BaseTracker
```

---

## Methode B - Camera Update (CMC interne)

### Probleme de la Methode A (abandonnee)

`compensate_detections()` decalait les bbox YOLO vers un repere stabilise
virtuel. Le drift s'accumulait si H etait imprecis ou si plusieurs H etaient
composes sur plusieurs frames. Double compensation possible.

### Solution : Methode B

L'etat Kalman reste **toujours dans le repere de la frame courante**.
La compensation ego-motion est appliquee sur l'ETAT **avant** la prediction,
jamais sur les mesures YOLO.

```
Frame i-1 -> camera_update(H)    : x <- H @ x            (warp etat frame_i)
             predict()           : x_pred = F @ x         (prediction dans frame_i)
Frame i   -> YOLO dets [cx,cy]   : bruts                  (meme repere frame_i)
             update(cx,cy)       : correction Kalman       (meme repere -> OK)
```

H = K·R·K^-1 depuis les donnees LDV (inertiel, prioritaire) ou ORB/ECC image.

### Avantages

- Zero drift : H applique une seule fois par frame, jamais cumule
- Mesures YOLO brutes passees directement, IoU directe sans H^-1
- Covariance propagee proprement via le Jacobien analytique de H

### Jacobien de H

Pour H 3x3, la transformation perspective (u',v') = H_persp(u,v) a pour
Jacobien analytique en (u_p, v_p) :

```
w  = h20*u_p + h21*v_p + h22
J_2x2 = 1/w * [[h00 - u'*h20,  h01 - u'*h21],
                [h10 - v'*h20,  h11 - v'*h21]]
```

Covariance 4x4 propagee via J4 = diag(J_2x2, J_2x2) :
```
P' = J4 @ P @ J4^T
```

---

## Interface BaseTracker

```python
has_internal_cmc = True
# session.py NE compense PAS les detections exterieurement.
# Les dets YOLO sont passees brutes.

update(frame, detections, H=None)
# H : homographie 3x3 frame_{i-1}->frame_i, ou None si indisponible.
# Transmis par session.py :
#   H_cmc = H_ldv   si use_ldv_cmc=True et LDV disponible
#   H_cmc = H_image sinon (ORB ou ECC, peut etre None)
```

---

## Configuration YAML

```yaml
use_ldv_cmc: true   # LDV prioritaire si disponible (bypass ORB/ECC)

kalman:
  max_age:         5       # frames max sans detection avant suppression
  min_hits:        2       # hits min pour confirmer un track
  iou_threshold:   0.3     # seuil IoU association Hongrois
  dist_threshold:  100     # distance max centre (px) - fallback si IoU=0
  process_noise:   100     # bruit processus Q (accroitre si trajectoires erratiques)
  measure_noise:   0.001   # bruit mesure R (reduire si dets tres precises)
  use_mahalanobis: false   # distance Mahalanobis vs euclidienne
```

---

## Performances attendues

- CPU uniquement (Kalman + Hongrois NumPy/SciPy)
- Latence < 1 ms/frame pour < 50 objets
- Aucune VRAM

---

## Modifications du code source

Aucune bibliotheque GitHub tierce modifiee.
Ce tracker est entierement interne au projet.

### Fichiers modifies

| Fichier | Modification |
|---|---|
| `kalman_filter.py` | Methode B : `camera_update(H)` AVANT `predict()` + propagation Jacobien |
| `mot_tracker.py` | `update()` accepte `H=None` ; appelle `camera_update(H)` puis `predict()` |
| `tracker.py` | `has_internal_cmc=True`, `update(H=None)` transmis |
