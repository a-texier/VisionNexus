# Tracker BoT-SORT

**Repo** : https://github.com/NirAharon/BoT-SORT

## Installation

```bash
cd trackers/mot/botsort
git clone https://github.com/NirAharon/BoT-SORT
cd BoT-SORT
pip install -r requirements.txt
```

---

## Principe

ByteTrack + GMC (Global Motion Compensation via sparseOptFlow) + ReID optionnel (FastReID).
Particulierement adapte aux sequences avec ego-motion (camera mobile).

---

## Bypass LDV (use_ldv_cmc=True)

### Mecanisme

Quand `use_ldv_cmc=True` et que la LDV est disponible, `session.py` transmet
`H_cmc = H_ldv` (homographie K·R·K^-1 inertielle) a `update(H=H_cmc)`.

Le wrapper intercept cette valeur via un **monkey-patch sur `gmc.apply`** :

```python
# Dans init() - patch applique sur l'INSTANCE (pas la classe) :
def _apply_capturing(img, dets):
    if self._ldv_warp_2x3 is not None:
        return self._ldv_warp_2x3   # bypass image GMC -> LDV utilise
    return _orig(img, dets)         # calcul sparseOptFlow normal
```

Avant chaque `update()`, si `H` est fourni :
```python
self._ldv_warp_2x3 = H[:2, :]   # H 3x3 -> warp affine 2x3 (approx petites rotations)
```

### Consequences

- sparseOptFlow **skippe** -> gain ~5-15 ms/frame selon resolution
- BoT-SORT applique le warp LDV a ses predictions Kalman exactement comme
  il le ferait avec son GMC image
- `get_last_homography()` retourne quand meme le warp utilise (LDV ou image)
  pour la reprojection des clics (k=1)

### Limite

H_ldv est une homographie 3x3 pure rotation.
BoT-SORT attend une matrice affine 2x3 (estimateAffinePartial2D).
On utilise `H[:2,:]` comme approximation affine, valide pour les petites
rotations inertielle (< 5°). Pour de grandes rotations, privilegier ECC/ORB.

---

## Interface BaseTracker

```python
has_internal_cmc = True
# session.py ne compense pas les detections exterieurement.
# Les dets YOLO sont passees brutes a BoT-SORT.

update(frame, detections, H=None)
# H fourni -> bypass gmc.apply (sparseOptFlow skippe)
# H=None   -> gmc.apply normal (sparseOptFlow depuis image)
```

---

## Modifications de la bibliotheque

**Aucune modification du repo clone** `BoT-SORT/`.
Le patch est applique uniquement sur l'INSTANCE `gmc` dans `init()` :

```python
gmc.apply = _apply_capturing   # methode remplacee sur l'instance
```

Cette technique Python est safe : elle ne modifie pas la classe ni le fichier source.

### Patch optionnel en amont (pour un bypass plus propre)

Si on voulait eviter entierement le calcul image, on pourrait ajouter dans
`BoT-SORT/tracker/bot_sort.py` un parametre `external_warp=None` a la
methode `update()` et le transmettre a `gmc.apply`. Pas fait car cela
modifie le repo clone.

---

## Configuration YAML

```yaml
use_ldv_cmc: true   # bypass LDV si disponible

botsort:
  track_high_thresh: 0.5       # seuil score haute qualite (1ere passe)
  track_low_thresh:  0.1       # seuil score basse qualite (2e passe BYTE)
  new_track_thresh:  0.6       # score min pour creer un nouveau track
  track_buffer:      30        # frames max sans detection avant suppression
  match_thresh:      0.8       # seuil IoU association Hongrois
  proximity_thresh:  0.5       # seuil proximity spatiale
  appearance_thresh: 0.25      # seuil cosine ReID (ignore si with_reid=false)
  with_reid:         false     # activer ReID (FastReID)
  fast_reid_config:  ""        # config FastReID (vide si with_reid=false)
  fast_reid_weights: ""        # poids FastReID (vide si with_reid=false)
  fp16:              false     # precision mixte FP16 pour ReID
  fuse_score:        false     # fusionner score det et IoU
  mot20:             false     # mode scenes tres denses
  cmc_method:        "sparseOptFlow"  # methode GMC image (skippe si LDV dispo)
```
