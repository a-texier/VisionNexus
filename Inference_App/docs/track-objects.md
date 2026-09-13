# Objets Track - Reference complete

> Perimetre : classes manipulees par la pipeline VisionNexus cote tracking. Les
> classes internes aux libs tierces (ByteTrack/BoT-SORT/BoostTrack) sont exclues.
> Voir [`state-machine.md`](state-machine.md) pour la machine d'etats qui produit
> et consomme ces objets.

---

## Table des matieres

1. [Vue d'ensemble - qui produit quoi](#1-vue-densemble---qui-produit-quoi)
2. [Interface commune MOT - `BaseTracker` (ABC)](#2-interface-commune-mot---basetracker-abc)
3. [Objet track MOT natif - `Track` (custom_kalman)](#3-objet-track-mot-natif---track-custom_kalman)
4. [Adaptateur track MOT - `_TrackAdapter`](#4-adaptateur-track-mot---_trackadapter)
5. [Interface commune SOT - `BaseSot` (ABC)](#5-interface-commune-sot---basesot-abc)
6. [Track synthetique ROI - `_SyntheticTrack`](#6-track-synthetique-roi---_synthetictrack)
7. [Track resultat SOT - `_SotTrack`](#7-track-resultat-sot---_sottrack)
8. [Interface duck-typing - contrat minimal](#8-interface-duck-typing---contrat-minimal)
9. [Hierarchie des trackers MOT](#9-hierarchie-des-trackers-mot)
10. [Hierarchie des trackers SOT](#10-hierarchie-des-trackers-sot)
11. [Ce que retourne `state_machine.update()`](#11-ce-que-retourne-state_machineupdate)
12. [Cycle de vie complet d'un objet track](#12-cycle-de-vie-complet-dun-objet-track)

---

## 1. Vue d'ensemble - qui produit quoi

```
DETECTEUR YOLO/TopHat
    -> list[ [x1,y1,x2,y2, score, class_id] ]   # detections brutes, pas des tracks

MOT Tracker (BaseTracker.update())
    -> list[ Track | _TrackAdapter ]             # tracks MOT avec IDs persistants

SOT Tracker (BaseSot.update())
    -> (success: bool, bbox: list, mask: ndarray|None)   # resultat brut SOT

state_machine.update()                            # SEUL point d'entree de session.py
    -> list[ Track | _TrackAdapter | _SotTrack ] # melange selon le mode
```

**Regle d'or** : `session.py` ne touche jamais directement aux trackers - tout
passe par `TrackerStateMachine.update()`. Les objets track qui en sortent sont
consommes par le `Visualizer` et les metriques.

---

## 2. Interface commune MOT - `BaseTracker` (ABC)

**Fichier** : `trackers/base_tracker.py:14`

Classe abstraite que tous les wrappers MOT implementent.

### Methodes abstraites

| Methode | Signature | Description |
|---|---|---|
| `init` | `(config: dict) -> None` | Initialise le tracker depuis le YAML |
| `update` | `(frame, detections, H=None) -> list` | Calcule les tracks pour une frame |
| `reset` | `() -> None` | Remet a l'etat initial (apres decrochage SOT) |

**`update()` detail** :
- `frame` : `np.ndarray` HxW ou HxWxC
- `detections` : `list[ [x1, y1, x2, y2, score, class_id] ]` - **toujours brutes**,
  jamais pre-compensees
- `H` : homographie 3x3 `frame_{i-1} -> frame_i` (None = pas de CMC)
- **Retourne** : `list[Track | _TrackAdapter]`

### Proprietes optionnelles (non abstraites)

| Propriete | Defaut | Description |
|---|---|---|
| `has_internal_cmc` | `False` | True si applique H en interne sur les etats Kalman (Methode B) |
| `has_own_image_cmc` | `False` | True si calcule sa propre H depuis l'image (botsort GMC, boosttrack ECC) |

**Valeurs reelles** :

| Tracker | `has_internal_cmc` | `has_own_image_cmc` |
|---|---|---|
| `custom_kalman` | `True` | `False` |
| `bytetrack` | `True` | `False` |
| `botsort` | `True` | `True` (sparseOptFlow) |
| `boosttrack` | `True` | `True` si `use_ecc=True` |

### Methode optionnelle

| Methode | Retour | Description |
|---|---|---|
| `get_last_homography()` | `np.ndarray(3,3) \| None` | H calcule lors du dernier `update()`. Utilise pour reprojecter un clic sans recalculer H depuis l'image. |

---

## 3. Objet track MOT natif - `Track` (custom_kalman)

**Fichier** : `trackers/mot/custom_kalman/mot_tracker.py:33`

`@dataclass` produit par `MultiObjectTracker`. C'est le seul tracker MOT dont les
objets track sont crees nativement par le projet (pas d'adaptation d'une lib
tierce).

### Champs

| Champ | Type | Defaut | Description |
|---|---|---|---|
| `track_id` | `int` | - | ID unique, incremental depuis 0 |
| `kf` | `KalmanFilter2D` | - | Filtre Kalman interne (position + vitesse) |
| `bbox` | `list[float]` | `[0,0,0,0]` | `[x1, y1, x2, y2]` derniere mesure associee |
| `class_id` | `int` | `0` | Classe YOLO (0 = drone dans ce projet) |
| `score` | `float` | `1.0` | Score de la detection YOLO associee |
| `age` | `int` | `0` | Frames depuis la creation du track |
| `hits` | `int` | `1` | Nombre de mises a jour reussies (detection associee) |
| `time_since_update` | `int` | `0` | Frames depuis la derniere association reussie |
| `history` | `list[(cx,cy)]` | `[]` | Trace des centres (pour affichage trail) |

### Proprietes calculees

| Propriete | Retour | Description |
|---|---|---|
| `is_confirmed` | `bool` | `hits >= 2` - confirme apres 2 associations reussies |
| `center` | `(float, float)` | Position Kalman courante `(cx, cy)` |

### Methode

| Methode | Retour | Description |
|---|---|---|
| `predicted_bbox()` | `list[float]` | Bbox predite depuis le centre Kalman + derniere taille connue |

> **Note `kf`** : `kf.position` = `(cx, cy)`, `kf.velocity` = `(vx, vy)`. Jamais
> expose hors du tracker custom_kalman.

---

## 4. Adaptateur track MOT - `_TrackAdapter`

**Fichiers** :
- `trackers/mot/bytetrack/tracker.py:36`
- `trackers/mot/botsort/tracker.py:44`
- `trackers/mot/boosttrack/tracker.py:53`

`@dataclass` prive a chaque wrapper. Adapte les objets internes des libs tierces
(`STrack` ByteTrack, `STrack` BoT-SORT, `STrack` BoostTrack) vers l'interface
duck-typing commune.

**Les trois `_TrackAdapter` sont identiques** :

| Champ | Type | Defaut | Description |
|---|---|---|---|
| `track_id` | `int` | - | ID issu de la lib tierce |
| `bbox` | `list` | - | `[x1, y1, x2, y2]` |
| `score` | `float` | - | Score de detection |
| `is_confirmed` | `bool` | `True` | Toujours True (seules les tracks actives sont exposees) |
| `time_since_update` | `int` | `0` | Frames sans association |
| `history` | `list` | `[]` | Trace des centres (peut rester vide) |

| Methode | Retour | Description |
|---|---|---|
| `predicted_bbox()` | `list` | Retourne `self.bbox` (pas de Kalman expose) |

> **Difference vs `Track`** : pas de `kf`, pas de `age`, pas de `hits`, pas de
> `class_id`, pas de `center`. Interface minimale suffisante pour le Visualizer
> et la state machine.

---

## 5. Interface commune SOT - `BaseSot` (ABC)

**Fichier** : `trackers/sot/base_sot.py:24`

### Methodes abstraites

| Methode | Signature | Description |
|---|---|---|
| `init` | `(frame, click_pos, mot_tracks=None) -> None` | Demarre le suivi |
| `update` | `(frame, mot_tracks=None, H=None) -> (bool, list\|None, ndarray\|None)` | Propage d'une frame |

**`init()` detail** :
- `frame` : image courante (IR uint16 ou BGR uint8)
- `click_pos` : `(x, y)` pixel du clic operateur
- `mot_tracks` : tracks MOT courantes - utilisees pour trouver la bbox initiale
  la plus proche du clic. Peut etre `None` ou `[]`.

**`update()` retour** : `(success, bbox, mask)`
- `success` : `bool` - False = decrochage SOT
- `bbox` : `[x1, y1, x2, y2]` ou `None` si `success=False`
- `mask` : `np.ndarray | None` - masque de segmentation (SAM2 uniquement)

### Methodes non abstraites (surchargeables)

| Methode | Signature | Description |
|---|---|---|
| `configure` | `(cfg: dict) -> None` | Charge les hyperparametres depuis le YAML. No-op par defaut. |
| `reset` | `() -> None` | Remet a l'etat initial. No-op par defaut. |

### Propriete

| Propriete | Defaut | Description |
|---|---|---|
| `hides_mot_tracks` | `False` | Si `True` : la state machine cache toutes les tracks MOT au visualizer et force MOT background. Utilise par `DummySot`. |

### Helper module-level

```python
find_bbox_from_tracks(cx, cy, mot_tracks, near_thresh_px=300.0) -> list | None
```
Retourne `[x1,y1,x2,y2]` de la track MOT la plus proche du clic. Priorite :
containment > nearest centre dans `near_thresh_px`.

---

## 6. Track synthetique ROI - `_SyntheticTrack`

**Fichier** : `pipeline/state_machine.py:898`

Cree par `detector_roi` (TopHatROIDetector) quand aucune `_DetTrack` ou track MOT
ne contient le clic (fallback ROI au point de clic).

**Ce n'est pas un resultat de tracking** - c'est un objet intermediaire pour
passer une bbox au `BaseSot.init()`.

| Champ/Propriete | Valeur | Description |
|---|---|---|
| `track_id` | `-1` | ID negatif = synthetique |
| `is_confirmed` | `True` | Classe attribute (toujours True) |
| `score` | `1.0` | Classe attribute |
| `bbox` | `list[float]` | `[x1, y1, x2, y2]` issu du detector_roi |
| `time_since_update` | `0` | Toujours 0 |
| `history` | `[[cx, cy]]` | Un seul point (centre de la bbox) |

| Methode | Retour | Description |
|---|---|---|
| `predicted_bbox()` | `list` | Retourne `self.bbox` |

> **Duree de vie** : cree dans `_handle_click_idle()`, passe a
> `sot_tracker.init()`, puis immediatement abandonne. N'apparait **jamais** dans
> la liste retournee par `state_machine.update()`.

---

## 7. Track resultat SOT - `_SotTrack`

**Fichier** : `pipeline/state_machine.py:919`

Objet resultat cree par la state machine a chaque frame en mode SOT. C'est ce qui
sort de `state_machine.update()` pour representer la cible SOT.

| Champ | Type | Valeur | Description |
|---|---|---|---|
| `track_id` | `int` | `0` (SOT1) ou `-2` (SOT2) | ID convenu - le Visualizer l'utilise pour choisir la couleur |
| `bbox` | `list[float]` | `[x1, y1, x2, y2]` | Sortie du `BaseSot.update()` |
| `score` | `float` | `1.0` | Toujours 1.0 |
| `mask` | `any \| None` | masque SAM2 ou `None` | Segmentation (SAM2 uniquement) |
| `time_since_update` | `int` | `miss` | Frames de decrochage courant (>0 = cible perdue) |
| `sot_slot` | `int` | `0` ou `1` | `0` = SOT1 (magenta), `1` = SOT2 (orange) |
| `is_sot_target` | `bool` | `True` | Sentinel - permet au Visualizer de distinguer SOT vs MOT |
| `is_confirmed` | `bool` | `True` | Toujours True |
| `history` | `list[[cx,cy]]` | positions | Trace des centres (copiee depuis `_sot_history`) |

| Methode | Retour | Description |
|---|---|---|
| `predicted_bbox()` | `list` | Retourne `self.bbox` |

**Detecter un `_SotTrack` dans une liste** :
```python
is_sot = hasattr(t, 'is_sot_target')   # le plus robuste
is_sot = t.track_id in (0, -2)         # convention numerique
```

---

## 8. Interface duck-typing - contrat minimal

Tous les objets retournes par `state_machine.update()` respectent ce contrat
minimum. Aucune classe de base commune n'est imposee.

| Attribut | Type | Requis par |
|---|---|---|
| `track_id` | `int` | Visualizer, metriques, state machine |
| `bbox` | `list[float]` `[x1,y1,x2,y2]` | Visualizer, metriques, SOT init |
| `score` | `float` | Visualizer |
| `is_confirmed` | `bool` | state machine (filtrage des tracks tentatives) |
| `time_since_update` | `int` | Visualizer (fade des tracks perdues) |
| `predicted_bbox()` | `-> list[float]` | state machine (SOT init, clic matching) |

**Attributs optionnels** (presents sur certains types seulement) :

| Attribut | Present sur | Utilisation |
|---|---|---|
| `is_sot_target` | `_SotTrack` uniquement | Visualizer pour couleur magenta/orange |
| `sot_slot` | `_SotTrack` uniquement | Visualizer : 0=magenta, 1=orange |
| `mask` | `_SotTrack` (SAM2) | Visualizer pour affichage masque |
| `history` | Tous sauf `_SyntheticTrack` (vide) | Visualizer pour trail |
| `kf` | `Track` (custom_kalman) uniquement | Debug interne custom_kalman |
| `age`, `hits` | `Track` (custom_kalman) uniquement | Debug, log verbose |
| `class_id` | `Track` (custom_kalman) uniquement | Filtrage par classe YOLO |

---

## 9. Hierarchie des trackers MOT

```
BaseTracker (ABC)                    trackers/base_tracker.py
+-- CustomKalmanTracker              trackers/mot/custom_kalman/tracker.py
|     +-- wraps MultiObjectTracker  trackers/mot/custom_kalman/mot_tracker.py
|              +-- produit Track    mot_tracker.py:33
+-- ByteTrackWrapper                 trackers/mot/bytetrack/tracker.py
|     +-- produit _TrackAdapter     bytetrack/tracker.py:36
+-- BotSortWrapper                   trackers/mot/botsort/tracker.py
|     +-- produit _TrackAdapter     botsort/tracker.py:44
+-- BoostTrackWrapper                trackers/mot/boosttrack/tracker.py
      +-- produit _TrackAdapter     boosttrack/tracker.py:53
```

**Tableau recapitulatif trackers MOT** :

| Tracker | Classe wrapper | Objet track produit | `has_internal_cmc` | `has_own_image_cmc` |
|---|---|---|---|---|
| `custom_kalman` | `CustomKalmanTracker` | `Track` | `True` | `False` |
| `bytetrack` | `ByteTrackWrapper` | `_TrackAdapter` | `True` | `False` |
| `botsort` | `BotSortWrapper` | `_TrackAdapter` | `True` | `True` |
| `boosttrack` | `BoostTrackWrapper` | `_TrackAdapter` | `True` | si `use_ecc=True` |

---

## 10. Hierarchie des trackers SOT

```
BaseSot (ABC)                        trackers/sot/base_sot.py
+-- DimpSot                          trackers/sot/dimp/tracker.py
+-- OSTrackSot                       trackers/sot/ostrack/tracker.py
+-- Sam2Sot                          trackers/sot/sam2/tracker.py

Classes SOT sans heritage BaseSot (duck-typing) :
+-- DummySot                         trackers/sot/dummy/tracker.py
|     hides_mot_tracks = True
+-- CsrtSot                          trackers/sot/csrt/tracker.py
+-- TrackingTophatSot                           trackers/sot/tracking_tophat/tracker.py
```

> `DummySot`, `CsrtSot`, `TrackingTophatSot` n'heritent pas de `BaseSot` mais exposent la
> meme interface `init()/update()/configure()`.

**Tableau recapitulatif trackers SOT** :

| Tracker | `hides_mot_tracks` | Source bbox init | Masque SAM2 |
|---|---|---|---|
| `dummy` | `True` | Track MOT la plus proche | Non |
| `csrt` | `False` | Track MOT la plus proche | Non |
| `tracking_tophat` | `False` | Track MOT la plus proche | Non |
| `dimp` | `False` | Track MOT la plus proche | Non |
| `ostrack` | `False` | Track MOT la plus proche | Non |
| `sam2` | `False` | Point de clic (bbox optionnelle) | **Oui** |

---

## 11. Ce que retourne `state_machine.update()`

**Signature** : `update(frame, frame_id, detections, H=None) -> list`

| Mode pipeline | Contenu de la liste retournee |
|---|---|
| `IDLE` | `[]` |
| `MOT` | N x `Track` ou `_TrackAdapter` (tracks actives confirmees) |
| `SOT` + `mot_background=False` | `[_SotTrack(sot_slot=0)]` |
| `SOT` + `mot_background=True` | `[_SotTrack(sot_slot=0)] + N x Track/_TrackAdapter` |
| SOT dual `n_targets=2`, SOT1 actif | `[_SotTrack(0), _SotTrack(1)] + MOT eventuel` |
| `DummySot` (toujours) | `[_SotTrack(sot_slot=0)]` - MOT cache (`hides_mot_tracks=True`) |

**Filtrage pratique dans le code consommateur** :

```python
for t in tracks:
    if hasattr(t, 'is_sot_target'):
        # c'est un _SotTrack
        slot = t.sot_slot   # 0 = SOT1, 1 = SOT2
        miss = t.time_since_update  # 0 = lock, >0 = decrochage
    else:
        # c'est un Track ou _TrackAdapter (MOT)
        confirmed = t.is_confirmed
```

---

## 12. Cycle de vie complet d'un objet track

```
[Frame t]
  YOLO/TopHat
      -> detections brutes [x1,y1,x2,y2,score,cls]
              |
              v
  BaseTracker.update(frame, detections, H)
              |
              +-- H applique sur etats Kalman (camera_update) AVANT predict()
              +-- predict() -> bbox predite
              +-- association Hongrois/IoU/distance
              +-- update Kalman si association reussie (hits++)
              +-> list[Track | _TrackAdapter]   <-- tracks MOT

  [Clic operateur]
              |
              v
  state_machine._handle_click_idle()
              +-- cherche track MOT contenant le clic (find_bbox_from_tracks)
              +-- si trouvee : Track/_TrackAdapter -> BaseSot.init(frame, click, mot_tracks)
              +-- si non trouvee : detector_roi -> _SyntheticTrack -> BaseSot.init(...)
                                                   (abandonne apres init)

  [Frame t+k, mode SOT]
              |
              v
  BaseSot.update(frame, mot_tracks, H)
              +-> (success, bbox, mask)
                      |
                      v
  state_machine._run_sot_update()
              +-> [_SotTrack(bbox, mask, history, miss, sot_slot)]
                      |
                      v
  session.py -> Visualizer.render(tracks)
             -> metriques (pred_per_frame)
```
