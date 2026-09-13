# Tracker BoostTrack

**Repo** : https://github.com/vukasin-stanojevic/BoostTrack

## Installation

```bash
cd trackers/mot/boosttrack
git clone https://github.com/vukasin-stanojevic/BoostTrack
cd BoostTrack
pip install -r requirements.txt
```

---

## Principe

Ameliore l'association ByteTrack par :
- Score de confiance "booste" tenant compte de la coherence temporelle
- ECC (Enhanced Correlation Coefficient) pour la compensation camera (optionnel)
- Distance de Mahalanobis pour l'association

---

## CMC selon use_ecc (has_internal_cmc=True dans les deux cas)

| `use_ecc` | Mecanisme CMC                                              |
|---|---|
| `true`    | ECC interne OU bypass LDV si `use_ldv_cmc=True` (injection `ecc._transforms`) |
| `false`   | Methode B : `_apply_camera_update(H)` patche les STrack internes avant update |

Les detections YOLO sont toujours passees **brutes** (jamais compensees exterieurement).

---

## Bypass LDV (use_ecc=True + use_ldv_cmc=True)

Quand H est fourni a `update()` et `use_ecc=True`, le wrapper injecte H dans
`ecc._transforms` avant l'appel a `tracker.update()` :

```python
if H is not None and self._use_ecc:
    ecc = getattr(self._tracker, 'ecc', None)
    if ecc is not None:
        ecc._transforms[frame_idx] = H.copy()
```

BoostTrack lit `_transforms[frame_idx]` pour recuperer le warp ECC.
En injectant H_ldv avant l'appel, BoostTrack utilisera notre H inertiel
sans relancer le calcul ECC depuis l'image.

### Fragile ?

L'acces a `ecc._transforms` est un attribut interne. Si BoostTrack
modifie son API, ce bypass peut echouer silencieusement (log DEBUG).
En cas d'echec, BoostTrack lance son propre ECC normalement (fallback safe).

---

## CMC sans ECC (use_ecc=False) : Methode B directe

Quand `use_ecc=False` et H est fourni, `_apply_camera_update(H)` patche
directement les attributs `mean` des `STrack` internes (tracked + lost) :

```python
# BoostTrack STrack.mean = [cx, cy, a, h, vx, vy, va, vh] (meme format ByteTrack)
elif H is not None and not self._use_ecc:
    self._apply_camera_update(H)
```

Meme logique que ByteTrack : H applique sur (cx,cy,vx,vy) via Jacobien analytique.
BoostTrack predira ensuite depuis un etat deja dans frame_i.

---

## Interface BaseTracker

```python
has_internal_cmc = True   # toujours, use_ecc ou non

update(frame, detections, H=None)
# use_ecc=True  + H fourni : injection dans ecc._transforms (bypass LDV)
# use_ecc=True  + H=None   : ECC calcule normalement depuis l'image
# use_ecc=False + H fourni : _apply_camera_update(H) sur STrack.mean (Methode B)
# use_ecc=False + H=None   : aucune compensation
```

---

## Modifications de la bibliotheque

**Aucune modification du repo clone** `BoostTrack/`.

Le bypass LDV utilise un acces en lecture-ecriture sur `ecc._transforms`
(attribut de cache interne). C'est la methode la moins invasive sans
modifier le repo.

### Patch propre en amont (optionnel)

Dans `BoostTrack/tracker/boost_track.py`, ajouter :
```python
def update(self, dets, img_tensor, img_numpy, tag, external_H=None):
    if external_H is not None and self.ecc is not None:
        self.ecc._transforms[self.frame_count] = external_H
    # ... suite normale
```
Non implemente pour conserver le repo intact.

---

## Configuration YAML

```yaml
use_ldv_cmc: true   # bypass LDV si use_ecc=True et LDV disponible

boosttrack:
  use_ecc:      false   # true -> ECC interne + LDV bypass possible
  track_thresh: 0.5     # seuil score haute qualite
  track_buffer: 30      # frames max sans detection
  match_thresh: 0.8     # seuil association Hongrois
```
