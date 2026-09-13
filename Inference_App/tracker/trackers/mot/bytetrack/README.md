# Tracker ByteTrack

**Repo** : https://github.com/ifzhang/ByteTrack

## Installation

```bash
cd trackers/mot/bytetrack
git clone https://github.com/ifzhang/ByteTrack
cd ByteTrack
pip install -r requirements.txt
pip install -e .     # compile yolox._C (extension C++ - GCC 11 + nvcc 12.1)
```

---

## Principe

Associe TOUTES les detections en deux passes BYTE :
1. Detections haute confiance -> association stricte Kalman + IoU
2. Detections basse confiance -> recuperation des tracks perdus (1ere passe echec)

---

## CMC - Methode B interne (has_internal_cmc=True)

ByteTrack n'a pas de CMC dans son repo source.
Le wrapper applique H **directement sur les etats `STrack.mean`** AVANT
d'appeler `self._tracker.update()`, sans toucher au repo clone.

### Mecanisme : `_apply_camera_update(H)`

ByteTrack `STrack.mean` = `[cx, cy, a, h, vx, vy, va, vh]` (8D).
On warp positions `(cx, cy)` et vitesses `(vx, vy)` via le Jacobien analytique
de H. Les composantes aspect/hauteur `(a, h, va, vh)` restent inchangees.

```python
# Applique avant tracker.update() dans le wrapper :
for st in tracked_stracks + lost_stracks:
    cx, cy = st.mean[0], st.mean[1]
    w  = H[2,0]*cx + H[2,1]*cy + H[2,2]
    cx_w = (H[0,0]*cx + H[0,1]*cy + H[0,2]) / w
    cy_w = (H[1,0]*cx + H[1,1]*cy + H[1,2]) / w
    J = 1/w * [[h00-cx_w*h20, h01-cx_w*h21],   # Jacobien d(cx',cy')/d(cx,cy)
                [h10-cy_w*h20, h11-cy_w*h21]]
    vx_w, vy_w = J @ [vx, vy]
    st.mean[0], st.mean[1] = cx_w, cy_w
    st.mean[4], st.mean[5] = vx_w, vy_w
```

Resultat : ByteTrack predit dans le repere de la frame courante.
Les detections YOLO sont passees **brutes** (meme repere -> association directe).

Source de H prioritaire :
1. `H_ldv` si `use_ldv_cmc=True` et LDV disponible (K·R·K^-1 inertiel)
2. `H_image` (ORB ou ECC) si LDV indisponible
3. `H=None` -> `_apply_camera_update` no-op (camera fixe)

---

## Interface BaseTracker

```python
has_internal_cmc = True
# Les dets YOLO sont passees brutes.
# _apply_camera_update(H) patche STrack.mean avant tracker.update().

update(frame, detections, H=None)
# H fourni -> warp des etats STrack dans frame courante (Methode B)
# H=None   -> aucune compensation
```

---

## Modifications de la bibliotheque

**Aucune modification du repo clone** `ByteTrack/`.

Le patch opere sur les attributs publics `tracked_stracks`, `lost_stracks`
et `mean` des instances `STrack`. Ces attributs sont stables dans la version
clonee. En cas de changement de l'API STrack, verifier ici.

---

## Configuration YAML

```yaml
use_ldv_cmc: true   # H_ldv transmis comme H_cmc si LDV disponible (bypass ORB/ECC)

bytetrack:
  track_thresh: 0.5    # seuil score haute qualite (1ere passe)
  track_buffer: 30     # frames max sans detection avant suppression
  match_thresh:  0.8   # seuil IoU association Hongrois
  mot20:         false # mode scenes tres denses (>100 objets)
  min_box_area:  10    # surface min (px2) - filtre micro-detections
```
