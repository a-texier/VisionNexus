# Tracker SOT : DummySot (Tracker de proximite MOT)

## Section 1 : Principe

DummySot est un tracker SOT base uniquement sur la proximite spatiale avec les pistes MOT.
Il n'a aucun modele d'apparence propre. A l'init, il memorise la track MOT la plus proche
du clic operateur. A chaque frame, il retrouve la track MOT dont le centre est le plus proche
du dernier centre connu de la cible, dans un rayon configurable.
Il force le MOT en fonctionnement continu en fond (`hides_mot_tracks=True`) car il depend
entierement des tracks MOT pour localiser la cible a chaque frame.
Usage typique : suivi de "focus" sur une cible MOT, sans calcul d'apparence, charge CPU nulle.

---

## Section 2 : Parametres YAML

Pas de section propre dans le YAML. DummySot utilise uniquement le parametre top-level :

| Parametre              | Section      | Defaut | Plage    | Effet                                                                         |
|------------------------|--------------|--------|----------|-------------------------------------------------------------------------------|
| `sot_click_max_dist_px`| (top-level)  | 200    | 0-1000   | Distance max (px) entre le dernier centre connu et une track MOT candidate, a chaque frame. 0 = pas de filtre. |

La section `dummy_sot:` dans le YAML est presente mais vide (l'ancien parametre `max_match_dist_px` a ete supprime et remplace par `sot_click_max_dist_px`).

---

## Section 3 : Inputs / Outputs du workflow

**Entrees de `init()`**

| Entree      | Type                    | Description                                             |
|-------------|-------------------------|---------------------------------------------------------|
| `frame`     | `ndarray`               | Frame courante (non utilisee)                           |
| `click_pos` | `(x, y)`                | Position du clic operateur                              |
| `mot_tracks`| `list[Track]` ou `None` | Tracks MOT disponibles au moment du clic               |

**Entrees de `update()`**

| Entree      | Type                    | Description                                             |
|-------------|-------------------------|---------------------------------------------------------|
| `frame`     | `ndarray`               | Frame courante (non utilisee)                           |
| `mot_tracks`| `list[Track]` ou `None` | Tracks MOT mises a jour pour la frame courante         |
| `H`         | non utilise             | Ignore (DummySot ne compense pas le mouvement camera)  |

**Sorties de `update()`**

| Sortie  | Type                       | Description                                                   |
|---------|----------------------------|---------------------------------------------------------------|
| `ok`    | `bool`                     | True si une track MOT est trouvee dans le rayon max_dist      |
| `bbox`  | `[x1,y1,x2,y2]` ou `None` | Bbox de la track MOT selectionnee                             |
| `mask`  | `None`                     | Toujours None                                                 |

---

## Section 4 : Integration dans le pipeline

**Comportement special** : `hides_mot_tracks = True` force la state machine a :
- Toujours faire tourner le MOT en fond (meme si mot_background=false dans le YAML).
- Ne retourner a la visualisation que la track SOT selectionnee (ID=0, magenta).
- Passer la liste de tracks MOT a jour a chaque appel de `update()`.

**Flux d'init** :
1. Clic operateur -> state machine appelle `dummy_sot.init(frame, click_pos, mot_tracks)`.
2. `_closest_track()` trouve la track MOT la plus proche du clic (sans filtre de distance a l'init).
3. Le centre de la track selectionnee devient `_target_cx, _target_cy`.

**Flux d'update** (chaque frame) :
1. Session.py passe les tracks MOT courantes a `dummy_sot.update(frame, mot_tracks)`.
2. `_closest_track(_target_cx, _target_cy, mot_tracks, max_dist=_max_match_dist)` cherche la track la plus proche.
3. Si trouvee dans le rayon : `ok=True`, bbox de la track retournee, centre mis a jour.
4. Si aucune track dans le rayon : `ok=False`, session.py incremente `sot_miss`.

**Echec SOT** : si aucune track MOT n'est disponible (liste vide ou toutes hors rayon), DummySot echoue systematiquement. Apres `sot_loss_threshold` echecs -> retour MOT.

**Prerequis** : le MOT doit etre actif en fond. DummySot est incompatible avec le mode SOT solo (tracker_mot=none).

---

## Section 5 : Conseils de reglage

**Mode standard (MOT + SOT focus)** :
- `sot_click_max_dist_px: 100-200` : filtre raisonnable, rejette les tracks trop lointaines.
- `mot_background: true` recommande pour que le MOT reste actif ; sinon DummySot force automatiquement le MOT en fond.
- `sot_loss_threshold: 5-10` : tolere les breves periodes sans track proche.

**Mode scriptage (fichier de clics)** :
- `sot_click_max_dist_px: 0` : pas de filtre distance, les clics scriptes peuvent etre moins precis.
- Recommande pour les scenarios B (command) pour maximiser le taux d'accrochage.

**Scène dense (nombreuses tracks proches)** :
- Reduire `sot_click_max_dist_px: 50-80` pour selectionner uniquement la track vraiment la plus proche.
- Si deux tracks sont a distance quasi-egale, DummySot peut osciller entre les deux : utiliser CSRT ou Tracking_TOPHAT dans ce cas.

**Limitations** :
- DummySot ne peut pas suivre une cible que le MOT a perdue. Si la cible disparait des tracks MOT, DummySot echoue.
- Pas adapte aux modes SOT solo (D, C) ni a tracker_mot=none.
- Preferer CSRT, Tracking_TOPHAT ou SAM2 si un modele d'apparence est necessaire.
