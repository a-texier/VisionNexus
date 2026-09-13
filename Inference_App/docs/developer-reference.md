# Guide developpeur - VisionNexus Inference

> Relocalise depuis `tracker/code_explication/DEVELOPER.md`. Voir
> [`README.md`](README.md) pour l'index de la documentation et
> [`architecture.md`](architecture.md) pour la vue d'ensemble de l'app.

Documentation interne detaillee : architecture, logique de chaque module,
decisions de conception, et guide pratique pour modifier ou etendre le pipeline.

---

## Table des matieres

1. [Vue d'ensemble](#1-vue-densemble)
2. [Point d'entree : main.py](#2-point-dentree--mainpy)
3. [pipeline/session.py - Orchestration](#3-pipelinesessionpy--orchestration)
4. [pipeline/builders.py - Usine de composants](#4-pipelinebuilderspyusine-de-composants)
5. [pipeline/state_machine.py - Machine d'etats MOT/SOT](#5-pipelinestate_machinepy--machine-detats-motsot)
6. [pipeline/ego_motion.py - Compensation ego-motion](#6-pipelineego_motionpy--compensation-ego-motion)
7. [pipeline/detector/ - Package detecteurs](#7-pipelinedetector--package-detecteurs)
8. [Trackers MOT](#8-trackers-mot)
9. [Trackers SOT](#9-trackers-sot)
10. [data/ - Couche donnees](#10-data--couche-donnees)
11. [utils/ - Visualizer et metriques](#11-utils--exploreralizer-et-metriques)
12. [profiling/ - Profiler frame-par-frame](#12-profiling--profiler-frame-par-frame)
13. [Systeme de configuration YAML](#13-systeme-de-configuration-yaml)
14. [Decisions de conception cles](#14-decisions-de-conception-cles)
15. [Guides pratiques : ajouter un composant](#15-guides-pratiques--ajouter-un-composant)
16. [Debug et diagnostics](#16-debug-et-diagnostics)

---

## 1. Vue d'ensemble

### Philosophie du projet

- **Tout est YAML** : aucun hyperparametre code en dur dans le code Python.
  Chaque tracker lit sa propre section dans le YAML.
- **Zero chemin absolu** : le projet est portable. Tous les chemins sont
  relatifs a la racine du projet ou au repertoire de la sequence.
- **Deps incluses** : les repos tiers (ByteTrack, BoT-SORT, BoostTrack,
  pytracking, OSTrack, SAM2) sont **co-localises** dans le projet.
  Aucun `pip install <github>` requis.
- **Separation stricte** : la logique metier (trackers, detecteurs) ne connait
  pas la logique d'affichage ni de profiling. Le pipeline orchestre sans coupler.

### Flux global simplifie

```
main.py  -->  session.run_session(cfg, run_dir)
                |
                +-- builders.*  (construction une seule fois)
                |
                +-- _run_loop() (boucle frame par frame)
                      |
                      frame_load -> detect_mot -> ego_motion -> state_machine
                      -> visualizer -> profiler.end_frame()
                |
                profiler.generate_report()
                compute_metrics()
                write_benchmark()
```

---

## 2. Point d'entree : main.py

Fichier court (~70 lignes). Responsabilites :

1. Parse `--config` (defaut : `config/config.yaml`)
2. Charge le YAML (`yaml.safe_load`)
3. Cree `run_dir` : `outputs/run_{timestamp}_{run_name}_{mot}_{sot}/`
4. Copie le YAML dans `run_dir/config.yaml` (tracabilite)
5. Appelle `session.run_session(cfg, run_dir)`
6. Affiche le benchmark final

**Ne pas modifier** : toute logique doit aller dans `session.py` ou `builders.py`.

---

## 3. pipeline/session.py - Orchestration

### `run_session(cfg, run_dir)`

Fonction principale appelee par `main.py`. Elle :
1. Construit tous les composants via `builders.*`
2. Construit le profiler (`build_profiler`)
3. Lance `_run_loop()`
4. Appelle `profiler.generate_report()`
5. Calcule les metriques (`compute_metrics`)
6. Ecrit `benchmark.json`

### `_run_loop(cfg, loader, detector, compensator, state_machine, ...)`

Boucle centrale. Pour chaque frame :

```
(frame_id, frame, meta) = next(loader)

with profiler.section("frame_load"):
    frame_buffer.push(frame_id, frame)
    cur_ldv = meta.get("ldv")
    ldv_buffer.push(frame_id, cur_ldv)

with profiler.section("detect_mot"):
    raw_dets = detector.detect(frame, frame_id)

# Calcul H_ldv (inertiel, toujours) [voir section 6 - chaine CMC 4 niveaux]
with profiler.section("ldv_cmc"):
    H_ldv = compensator.build_homography(prev_ldv, cur_ldv, frame.shape)

# H_image externe : calcule uniquement si niveaux 1 ET 2 inactifs
with profiler.section("image_cmc"):
    H_image = _compute_image_homography(...) if _need_H_image else None

# Chaine de fallback CMC - 4 niveaux (voir section 6)
H_cmc = H_ldv        # niv.1 si use_ldv_cmc et LDV dispo
     OR None         # niv.2 si tracker.has_own_image_cmc (sparseOptFlow/ECC interne)
     OR H_image      # niv.3 si homography_method_image configure
     OR None         # niv.4 aucune compensation

# Les detections sont TOUJOURS brutes (Methode B : H sur etats Kalman du tracker)
dets = raw_dets

# Reprojection des clics command (3 branches, voir section 6)
reproject_click_command(cmd, H_dets, ldv_buffer, frame_buffer)

prof_sec = "sot_update" if state == SOT else "mot_update"
with profiler.section(prof_sec):
    tracks = state_machine.update(frame, frame_id, dets, H=H_cmc)

with profiler.section("render"):
    viz.render(frame, tracks, ...)

profiler.end_frame(frame_id, total_s=time.perf_counter() - t0)
```

**Log CMC au demarrage** (une seule fois) :
```
[CMC] Chaine fallback : LDV(use_ldv_cmc=true) -> TRACKER_INTERNE(BotSortWrapper) -> H_EXT_IMAGE(orb) -> AUCUNE_CMC
[CMC] Tracker MOT : BotSortWrapper  |  has_own_image_cmc=True  |  use_ldv_cmc=True  |  method_ext=orb
```

**`frame_id`** : provient du loader, peut ne pas etre sequentiel (numeros de frames
originaux, pas indices d'iteration). Metriques et profiling utilisent ce `frame_id`.

---

## 4. pipeline/builders.py - Usine de composants

Chaque fonction `build_*` lit le YAML et instancie le bon composant.
Le reste du code ne connait que les interfaces (`BaseTracker`, `BaseSot`, etc.).

### Registres

```python
MOT_REGISTRY = {
    "custom_kalman": "trackers.mot.custom_kalman.tracker.CustomKalmanTracker",
    "bytetrack":     "trackers.mot.bytetrack.tracker.ByteTrackWrapper",
    "botsort":       "trackers.mot.botsort.tracker.BotSortWrapper",
    "boosttrack":    "trackers.mot.boosttrack.tracker.BoostTrackWrapper",
}

SOT_REGISTRY = {
    "dummy":   "trackers.sot.dummy.tracker.DummySot",
    "csrt":    "trackers.sot.csrt.tracker.CsrtSot",
    "tracking_tophat":     "trackers.sot.tracking_tophat.tracker.TrackingTophatSot",
    "dimp":    "trackers.sot.dimp.tracker.DimpSot",
    "ostrack": "trackers.sot.ostrack.tracker.OSTrackSot",
    "sam2":    "trackers.sot.sam2.tracker.Sam2Sot",
}
```

Les classes sont chargees dynamiquement via `importlib` (pas d'import statique) :

### `build_trackers(cfg)` -> `(mot_tracker, sot_tracker, sot_tracker2)`

```python
# tracker_mot peut etre null / "none" / "" -> mode SOT-only -> mot_tracker=None
sot_tracker = _load_class(SOT_REGISTRY, tracker_sot_key)()
sot_tracker.configure(cfg)   # SOT lit sa section YAML (pattern configure())

# SOT2 : instance separee de la MEME classe si n_targets >= 2 (sinon None)
sot_tracker2 = SotCls() if n_targets >= 2 else None

# MOT (None en mode SOT-only)
mot_tracker = _load_class(MOT_REGISTRY, tracker_mot_key)()
mot_tracker.init(cfg)        # MOT lit sa section YAML
```

Retourne un **triplet** `(mot_tracker, sot_tracker, sot_tracker2)` :
- `mot_tracker`  : `None` en mode SOT-only.
- `sot_tracker2` : `None` si `n_targets < 2` (voir dual-SOT dans state-machine.md).

Mode `tracker_mot: null` : les détections brutes (`detector_mot`) sont converties
en `_DetTrack` éphémères et retournées directement par `state_machine.update()`.
`detector_roi` n'est plus obligatoire — un warning est émis uniquement si
`detector_mot=none` ET `detector_roi=none` (aucune source de bbox pour le SOT init).

**Pattern `configure()`** : voir [section 9](#9-trackers-sot).

### `build_input_handler(cfg)`

| `mode`         | Retourne                              |
|----------------|---------------------------------------|
| `interactive`  | `(ClickHandler, None)`                |
| `command`      | `(None, CommandParser)`               |
| `headless`     | `(None, None)`                        |

### `build_detector_mot(cfg)` / `build_detector_roi(cfg)`

Lit `detector_mot:` et `detector_roi:` dans le YAML.
Renvoie le bon detecteur (voir [section 7](#7-pipelinedetector--package-detecteurs)).

---

## 5. pipeline/state_machine.py - Machine d'etats MOT/SOT

Documentation detaillee (diagrammes des cas, dual-SOT, keepalive) :
[`state-machine.md`](state-machine.md). Resume ci-dessous.

### Etats (PipelineMode)

```
IDLE  <--- repos si tracker_mot=null ET detector_mot=none
 |
MOT  <---[perte SOT / sot_loss_threshold]---  SOT
 |                                             ^
 +---[clic accepte]-------------------------->+
```

- **IDLE** : etat de repos uniquement si `tracker_mot=null` ET `detector_mot=none`.
  Sinon l'etat de repos est **MOT** (propriete `_back_state`).
- **MOT** : `mot_tracker.update()` tourne. Si clic valide -> SOT.
  En mode SOT-only avec detecteur, les dets brutes sont enveloppees en `_DetTrack`.
- **SOT** : `sot_tracker.update()` tourne. Si `N` echecs consecutifs
  (`sot_loss_threshold`), retour vers `_back_state`.

### Role MOT (MotRole) et dual-SOT

`PipelineState.mot_role` decrit le role du MOT a chaque frame :

| MotRole      | Quand                                                         |
|--------------|--------------------------------------------------------------|
| `OFF`        | `tracker_mot=None` ou MOT desactive (`set_mot_active(False)`) |
| `FOREGROUND` | etat MOT (MOT seul, premier plan)                            |
| `BACKGROUND` | etat SOT avec `mot_background=true` (MOT tourne en fond)      |
| `KEEPALIVE`  | fenetre `mot_keepalive_after_sot_s` pour cliquer la 2e cible |
| `PAUSED`     | etat SOT avec `mot_background=false` (MOT en veille)         |

**Dual-SOT** (`n_targets: 2`) : clic gauche -> SOT1 (slot 0), clic droit ->
SOT2 (slot 1), clic molette -> `kill_all_sot()` (relache toutes les cibles).
SOT2 tourne en parallele via `_run_sot2_update()` independamment de l'etat global.

### should_run_mot_detection()

API publique appelee par session.py **avant** la detection : evite de lancer le
detecteur MOT quand ses dets ne seraient pas consommees (SOT actif +
`mot_background=false` hors keepalive). Cas `tracker_mot=null` + detecteur
configure : renvoie toujours `True` (dets brutes -> `_DetTrack` affichees).

### Cas special : `mot_background`

Quand `mot_background: true` dans le YAML, **le MOT tourne en tache de fond**
meme en etat SOT. Les tracks MOT ne sont pas rendues mais le tracker reste a
jour. Cela evite une reinitialisation complete au retour de l'etat SOT.
`DummySot` requiert obligatoirement `mot_background: true` (il suit une track MOT).

### Compteurs de pertes/inits SOT

La state machine maintient deux compteurs :

```python
state_machine.get_n_losses() -> int
    # Nombre de fois que le SOT a perdu la cible (KO -> retour MOT/IDLE)
    # Incremente quand sot_loss_threshold echecs consecutifs sont atteints

state_machine.get_n_inits() -> int
    # Nombre d'initialisations SOT reussies (clic + detector_roi valide)
    # Incremente dans _activate_sot() apres succes
```

Ces compteurs sont passes a `compute_metrics()` en fin de run et
apparaissent dans `benchmark/benchmark.json` sous `sot.n_losses` et `sot.n_inits`.

### Filtrage des clics (`sot_click_max_dist_px`)

Quand un clic arrive en etat MOT :

```
si mot_active ET sot_click_max_dist_px > 0 :
    si 0 tracks MOT disponibles :
        --> REJETE (log WARNING : "MOT actif mais 0 track disponible")
    sinon :
        trouver la track MOT la plus proche du clic
        si distance > seuil :
            --> REJETE (log WARNING : "track la plus proche a Xpx > seuil")
        sinon :
            --> ACCEPTE -> _activate_sot(click_pos, nearest_track)
sinon (MOT inactif OU seuil = 0) :
    --> ACCEPTE sans filtrage
```

**Important** : `sot_click_max_dist_px` est un filtre au moment du clic,
pas un filtre frame-par-frame. C'est distinct de `dummy_sot.max_match_dist_px`
(recherche par frame dans DummySot) et `csrt.near_thresh_px` (rayon de
recherche de la bbox initiale dans CsrtSot).

### `_activate_sot(click_pos, mot_track)`

1. Appelle `detector_roi.detect(frame, click_pos)` pour affiner la bbox
2. Appelle `sot_tracker.init(frame, click_pos, mot_tracks)`
3. Passe en etat SOT

### `_SotTrack` / `_DetTrack` / `_SyntheticTrack`

Trois objets internes duck-typing (definis en bas de `state_machine.py`) :

- **`_SotTrack`** : cible SOT pour le rendu. `is_sot_target = True` (sentinel
  visualizer), `sot_slot` (0 = SOT1 magenta `track_id=0`, 1 = SOT2 orange
  `track_id=-2`), `time_since_update` = nombre de miss courants.
  **Ne pas tester `track_id == 0`** -- utiliser `getattr(trk, "is_sot_target", False)`.
- **`_DetTrack`** : adaptateur d'une detection brute en track (mode `tracker_mot=null`
  + detecteur). `track_id` = index dans la frame, ephemere (pas de persistance).
- **`_SyntheticTrack`** : track `track_id=-1` creee par `detector_roi` au clic pour
  fournir la bbox d'init SOT quand aucune track MOT n'est disponible.

### `MotControlCommand`

Commande speciale (mode `command`, fichier de clics) traitee par `CommandParser`.
`apply_commands()` appelle `state_machine.set_mot_active(bool)` pour
desactiver/reactiver le MOT. MOT desactive -> `MotRole.OFF` ; un SOT en cours est
remis a MOT (reset) et `mot_background` devient sans effet.

---

## 6. pipeline/ego_motion.py - Compensation ego-motion

### Principe

La camera est montee sur une plateforme mobile. Sans compensation,
les predictions Kalman divergent a cause du mouvement de la camera elle-meme.
L'ego-motion compense ce mouvement en calculant H (homographie frame_prev -> frame_cur).

### Chaine de fallback CMC - 4 niveaux

```
Niv.1  LDV inertiel    : use_ldv_cmc=True ET LDV dispo
                         H = K·R(daz,del)·K⁻¹  (zero cout image)
Niv.2  CMC interne     : tracker.has_own_image_cmc=True
                         H=None transmis ; tracker calcule son propre H image
                         (sparseOptFlow pour botsort, ECC pour boosttrack+use_ecc)
Niv.3  H image externe : homography_method_image configure (orb|ecc)
                         H calcule par session.py (~5 ms ORB / ~30 ms ECC)
Niv.4  Aucune CMC      : H=None ; pas de compensation
```

**Guard H_image** : H_image n'est calcule que si niveaux 1 ET 2 inactifs :
```python
_need_H_image = (
    bool(_homography_method) and _prev_frame is not None and
    not (_use_ldv_cmc and H_ldv is not None) and  # pas niv.1
    not _tracker_has_own_cmc                       # pas niv.2
)
```
Cela evite de payer ORB/ECC (~5-30 ms) quand LDV ou CMC interne suffisent.

### `has_own_image_cmc` (nouveau vs `has_internal_cmc`)

| Propriete | Signification | Qui l'override |
|-----------|---------------|----------------|
| `has_internal_cmc` | True si le tracker applique H sur ses etats Kalman (Methode B). Tous = True. | Tous les trackers |
| `has_own_image_cmc` | True si le tracker **calcule lui-meme** H depuis l'image (GMC / ECC). | botsort si `cmc_method != none`, boosttrack si `use_ecc=True` |

Quand `has_own_image_cmc=True`, session.py passe `H=None` et laisse le tracker
calculer son propre H. Les detections restent toujours brutes (Methode B).
`compensate_detections()` n'est **jamais appelee** depuis session.py.

### `get_last_homography()`

Apres `tracker.update()`, le H calcule en interne est expose :
- **BoT-SORT** : monkey-patch sur `gmc.apply()`, warp affine 2x3 converti en H 3x3.
- **BoostTrack+ECC** : lecture du cache interne `ecc._transforms` apres `update()`.

Utilise par session.py pour `H_dets` (reprojection des clics) :
```python
_last_H_tracker = mot_tracker.get_last_homography()
H_dets = H_ldv or _last_H_tracker or H_image
```

### Reprojection des clics - 3 branches

Quand `frame_click != frame_id` (clic enregistre a une frame anterieure) :

```
Branche A - LDV buffer                    : reproject_click_ldv()     [zero cout image]
Branche B - H_dets dispo, delai = 1 frame : perspectiveTransform(H_dets) [zero recalcul]
Branche C - delai > 1 frame OU H_dets None: reproject_click(frame_ref, frame, method)
            -> calcul ORB/ECC ad-hoc (non profile, ~5-30 ms)
            -> necessaire : H_image couvre frame-1->frame, pas frame-k->frame
```

> **Attention** : la branche C n'est **pas dans les sections de profiling**.
> Si visible dans les timings "other" du profiler, c'est la branche C active.

### `FrameBuffer` / `LdvBuffer`

Buffers circulaires (`max_delay_frames` frames). Permettent de retrouver
`frame_ref` ou `ldv_click` pour les branches A et C.
Un clic emis a la frame N peut etre recu a N+k (latence reseau/systeme).

---

## 7. pipeline/detector/ - Package detecteurs

### Structure

```
pipeline/detector/
  __init__.py      Re-export tout pour compatibilite : from pipeline.detector import *
  detector_mot.py  Detecteurs plein cadre (MOT)
  detector_roi.py  Detecteurs ROI (init SOT)
```

### Detecteurs MOT (`detector_mot.py`)

| Classe               | Cle YAML  | Description                              |
|----------------------|-----------|------------------------------------------|
| `NoneDetectorMOT`    | `none`    | Renvoie toujours `[]`                    |
| `DummyDetectorMOT`   | `dummy`   | Detections aleatoires (test)             |
| `TopHatDetectorMOT`  | `tophat`  | Top-hat morphologique IR                 |
| `YOLODetectorMOT`    | `yolo`    | YOLO ultralytics (GPU recommande)        |

Toutes heritent de `BaseDetectorMOT` :
```python
class BaseDetectorMOT:
    def detect(self, frame: np.ndarray, frame_id: int) -> List[Detection]:
        raise NotImplementedError
```

**Helpers partages** (`detector_mot.py`) :
- `_to_uint8_gray(frame)` : conversion BGR/gray -> uint8
- `_tophat_blobs(gray, cfg)` : morphologie + seuillage (utilise par TopHat MOT et ROI)

### Detecteurs ROI (`detector_roi.py`)

| Classe                 | Cle YAML  | Description                                  |
|------------------------|-----------|----------------------------------------------|
| `NoneDetectorROI`      | `none`    | Renvoie le clic brut (boite 40x40 centree)   |
| `TopHatROIDetector`    | `tophat`  | Top-hat dans un ROI autour du clic           |

Appelee par `state_machine._activate_sot()` pour affiner la bbox avant
d'appeler `sot_tracker.init()`. Permet au SOT de demarrer sur une bbox
precise plutot que sur le pixel clique.

---

## 8. Trackers MOT

### Interface `BaseTracker` (`trackers/base_tracker.py`)

```python
class BaseTracker:
    def init(self, cfg: dict) -> None: ...
    def update(self, frame, dets, H=None) -> List[Track]: ...
    def reset(self) -> None: ...

    @property
    def has_internal_cmc(self) -> bool:
        """True si tracker applique H sur etats Kalman (Methode B). Tous = True."""
        return False   # override dans chaque tracker concret

    @property
    def has_own_image_cmc(self) -> bool:
        """True si tracker calcule lui-meme H depuis l'image (GMC/ECC).
        Niv.2 de la chaine CMC : session.py passe H=None, le tracker gere."""
        return False   # True : botsort (cmc_method!=none), boosttrack (use_ecc=True)

    def get_last_homography(self) -> Optional[np.ndarray]:
        """H 3x3 (frame_prev -> frame_cur) calcule lors du dernier update().
        Utilise pour H_dets (reprojection clics). None si non disponible."""
        return None    # override : botsort, boosttrack+ECC
```

### `custom_kalman` - Kalman + Hongrois (code interne)

- **Aucune dependance externe** (NumPy + SciPy uniquement)
- Kalman 2D : etat `x = [u, v, du, dv]^T` - **4 dimensions** (centre + vitesse)
  - `u, v` : centre bbox (pixels) - `du, dv` : vitesse pixel/frame
  - La taille de la bbox (w, h) n'est **pas tracee** : elle vient de la detection
- Observation : `z = [u, v]^T` (centre YOLO brut)
- Association via Hongrois sur IoU ; gate optionnel par distance de Mahalanobis
- CMC interne : **Methode B** - `camera_update(H)` warp `[u, v, du, dv]`
  via le Jacobien analytique de H + propagation covariance

**Methode B** : avant chaque `predict()`, l'etat est warpé dans le repere frame_i.
La detection reste brute. Association IoU directe, zero drift.

### `bytetrack` - ByteTrack

Wrapper autour du repo `ByteTrack/`. Deux passes d'association :
1. Detections haute confiance (track_thresh)
2. Detections basse confiance (track_buffer)

- Etat STrack interne : **8D** `[cx, cy, a, h, vx, vy, va, vh]`
  Seuls `cx, cy, vx, vy` sont warpes par H (Jacobien analytique). `a, h` invariants.
- CMC : H fourni par session.py (niveaux 1 ou 3), applique sur `STrack.mean`
  via `_apply_camera_update()` avant chaque `tracker.update()`.
- `has_internal_cmc = True`, `has_own_image_cmc = False`, `get_last_homography() = None`.

### `botsort` - BoT-SORT

Wrapper autour du repo `BoT-SORT/`. CMC via GMC (`sparseOptFlow` par defaut).

- `has_internal_cmc = True`
- `has_own_image_cmc = True` si `cmc_method != "none"` (**niv.2** : session.py passe H=None)
- `get_last_homography()` : H 3x3 (warp affine 2x3 GMC converti)
- **Bypass LDV** (niv.1) : monkey-patch sur `gmc.apply()`, `_ldv_warp_2x3` injecte avant update.
  sparseOptFlow est court-circuite, warp LDV utilise directement.
- `_cmc_method` stocke depuis le YAML dans `init()` pour exposer `has_own_image_cmc`.

### `boosttrack` - BoostTrack

Wrapper autour du repo `BoostTrack/`. CMC optionnelle via ECC (`use_ecc`).

- `has_internal_cmc = True` dans tous les cas
- `has_own_image_cmc = True` si `use_ecc=True` (**niv.2** : ECC calcule H depuis l'image)
- `has_own_image_cmc = False` si `use_ecc=False` (niveaux 1/3 fournissent H)
- Si `use_ecc=False` : `_apply_camera_update()` identique a ByteTrack (warp STrack.mean)
- Si `use_ecc=True` + H LDV dispo : H injecte dans `ecc._transforms` avant update (bypass ECC)

---

## 9. Trackers SOT

### Interface `BaseSot` (`trackers/sot/base_sot.py`)

```python
class BaseSot:
    def init(self, frame: np.ndarray, click_pos: Tuple[int,int],
             mot_tracks: List[Track]) -> None: ...

    def update(self, frame: np.ndarray,
               mot_tracks: List[Track]) -> Tuple[bool, BBox, Optional[np.ndarray]]:
        # Retourne (ok, bbox, mask)
        # ok=False : echec (perte de cible)
        # bbox : [x1, y1, x2, y2]
        # mask : masque binaire optionnel (SAM2)
        ...

    def reset(self) -> None: ...

    def configure(self, cfg: dict) -> None:
        """Charge les hyperparametres depuis le YAML. No-op par defaut."""
        pass
```

Le comportement `mot_background` (MOT tourne en fond pendant SOT) est controle
par le YAML (`mot_background: true/false`) et non par un attribut du tracker SOT.
Seul `DummySot` le requiert obligatoirement (`dummy` ne peut pas fonctionner sans
les tracks MOT de fond).

### Pattern `configure(cfg)`

`configure()` est appele par `builders.build_trackers()` apres instanciation,
avant le premier `init()`. C'est le seul endroit ou les hyperparametres YAML
sont charges dans le tracker SOT.

```python
# Exemple dans trackers/sot/csrt/tracker.py
def configure(self, cfg: dict) -> None:
    csrt_cfg = cfg.get("csrt", {})
    self._psr_threshold  = float(csrt_cfg.get("psr_threshold",  6.0))
    self._near_thresh_px = float(csrt_cfg.get("near_thresh_px", 300.0))
```

**Pourquoi `configure()` et pas `init(cfg)` ?**
`init()` est appele a chaque activation SOT (clic). Les hyperparametres
sont charges une seule fois. Separer les deux evite de relire le YAML a chaque clic.

### `dummy` - DummySot

Placeholder. Lors de chaque `update()`, recherche la track MOT dont
le centre est le plus proche du dernier centre connu.
- Requiert `mot_background: true` (suit une track MOT existante)
- `max_match_dist_px` : rayon de recherche (section `dummy_sot` du YAML)

Utile pour tester la machine d'etats sans tracker SOT reel.

### `csrt` - CSRT (OpenCV)

Tracker discriminatif DCF + canal spatial. **Kalman integre** pour CMC.
- `update()` : verifie le PSR (Peak-to-Sidelobe Ratio). Si PSR < `psr_threshold`,
  declare echec (KO).
- Parametres : `kf_process_noise`, `kf_measure_noise`, `cmc_reinit_thresh_px`,
  `psr_threshold`, `min_width_px`, `min_height_px`.
- `sot_click_max_dist_px` (parametre top-level) : distance max pour accepter
  une track MOT comme bbox d'init (0 = pas de filtre).

### `tracking_tophat` - TrackingTophatSot (Poursuite par Composantes Connexes)

Tracker IR base sur Top-Hat + NCC (ou ResNet). **Kalman integre** pour CMC.
- Mode `"tophat"` : Normalized Cross-Correlation sur patchs uint8 (CPU)
- Mode `"resnet"` : similarite cosinus sur features ResNet18 (GPU optionnel)
- Template historique glissant pour eviter la derive (`template_history`)
- Parametres : `search_radius_px`, `ncc_threshold`, `kf_process_noise`,
  `kf_measure_noise`, `template_history`, `max_dist_px`.

### `dimp` / `ostrack` / `sam2`

Wrappers autour de repos deep learning inclus. Necessitent des fichiers de poids.
Consulter le README pour les chemins de poids YAML.

---

## 10. data/ - Couche donnees

### Organisation (3 sous-packages)

```
data/
  rejeu/      Sources fichiers locaux (rejeu format specialise / images / video)
    sequence_loader.py     SequenceLoader (iterateur principal)
    image_reader.py        Lecture bas-niveau format specialise | PNG/JPG | MP4
    annotation_loader.py   Parsing GT (.ver | YOLO .txt | dossier)
    metadata_base.py       ABC MetadataReaderBase
    convert_format specialise_to_png.py  Outil d'export format specialise -> PNG
    cameras/               Readers metadata specifiques camera
      __init__.py          CAMERA_REGISTRY + load_metadata_reader()
      multi_csv/, single_csv/
  network/
    network_reader.py      NetworkFrameReader (flux MJPEG HTTP)
  zmq/
    protocol.py            Ports par defaut + encodage/decodage JSON (protocole generique)
    zmq_reader.py          ZmqFrameReader (PULL, multipart [meta JSON, JPEG])
    zmq_display_bridge.py  Pont annotations Python->C++ + clics C++->Python
```

### `MetadataReaderBase` (`data/rejeu/metadata_base.py`)

Interface commune a toutes les cameras :

```python
class MetadataReaderBase(ABC):
    def get_ldv_series(self) -> Dict[int, Tuple[float, float]]:
        """frame_idx -> (az_deg, el_deg)"""
        ...

    def get_camera_info(self) -> Dict:
        """-> {fps, width, height, chh_deg[, chv_deg]}"""
        ...
```

`chh_deg` / `chv_deg` = champ de vision horizontal/vertical en degres.
Utilises pour convertir les angles LDV en pixels (K = matrice intrinseque estimee).

### Readers camera (`data/rejeu/cameras/<nom>/metadata_reader.py`)

- `MultiCsvMetadataReader` : 3 CSV (`*_BlockID_NumIm.csv`, `*_POINTAGECAM_IR.csv`,
  `*_INFO_VID_IR.csv`). Le `block_id` interne MultiCsv est resolu en `frame_idx`
  dans `get_ldv_series()` et n'est **jamais** expose au pipeline.
- `SingleCsvMetadataReader` : 1 CSV (az/el en radians -> convertis en degres).

La fabrique `load_metadata_reader(camera_name, ...)` resout le package via
`CAMERA_REGISTRY` puis instancie la classe dont le nom **finit par `MetadataReader`**
(`_find_class(module, "MetadataReader")`).

### `SequenceLoader` (`data/rejeu/sequence_loader.py`)

Iterateur principal. Renvoie `(frame_id, frame, metadata)` par frame.

- Auto-detecte le format via `ImageReader` (format specialise / PNG-JPG / MP4)
- Instancie le `MetadataReaderBase` via `load_metadata_reader()`
- Filtre les frames selon `start_frame_idx` / `stop_frame_idx`

> NB : les flux `http://` et `tcp` ne passent pas par `SequenceLoader` mais par
> `NetworkFrameReader` / `ZmqFrameReader`, enveloppes dans des wrappers legers dans
> `build_loader()` (`_NetworkLoaderWrapper`, `_ZmqLoaderWrapper`).

### `ImageReader` (`data/rejeu/image_reader.py`)

Lecture bas-niveau :
- Fichier `.optional` : `optional_format_adapter` -> frames IR
- Dossier PNG/JPG : `cv2.imread` frame par frame (lazy)
- Video `.mp4/.avi/...` : `cv2.VideoCapture`

### `annotation_loader.py` (`data/rejeu/annotation_loader.py`)

Auto-detection du format via extension et nombre de colonnes :

| Format            | Detection            | Contenu                          |
|-------------------|----------------------|----------------------------------|
| `.ver`            | Extension `.ver`     | `frame track_id x1 y1 x2 y2 ...` |
| YOLO fusionne     | `.txt`, 6 colonnes   | `frame class cx cy w h`          |
| YOLO frame unique | `.txt`, 5 colonnes   | `class cx cy w h`                |
| YOLO ultralytics  | Dossier de `.txt`    | 1 fichier par frame              |

---

## 11. utils/ - Visualizer et metriques

### `Visualizer` (`utils/visualizer.py`)

Rendu frame par frame. Composants :

- **`_draw_tracks()`** : bbox + label + trail (historique de positions)
  - Track SOT1 : magenta / SOT2 : orange (detection via `getattr(trk, "is_sot_target", False)` + `sot_slot`)
  - Track MOT actif : couleur par ID (palette cyclique)
  - Track MOT perdu (miss > 0) : couleur delavee
- **`_draw_raw_dets()`** : detections brutes en pointille (debug)
- **`_draw_debug_bar()`** : bande bas de frame avec etat, FPS, frame ID
- **`_draw_click_dots()`** : points rouges aux positions des clics recents
- **`render()`** : compose tous les elements, appelle display/write/imshow

**Important** : le visualizer ne sait pas si on est en etat MOT ou SOT.
Il detecte la cible SOT via `getattr(trk, "is_sot_target", False)`.
Ne jamais utiliser `track_id == 0` comme critere.

### `metrics/` (package `utils/metrics/`)

`utils/metrics.py` + `utils/metrics_plot.py` (2 fichiers monolithiques) ont ete
decoupes en un package lisible. API publique inchangee : `from utils.metrics import
compute_mot_metrics, generate_metrics_plots`.

| Module | Role |
|--------|------|
| `core.py` | calcul MOTA / IDF1 / IDSW (`compute_mot_metrics`, `_compute_mode`, `iou`) |
| `common.py` | palette, imports mpl/plotly conditionnels, helpers de plot |
| `png_plots.py` | PNG : resume, courbe ROC, confusion, boxplots |
| `size_plots.py` | PNG par bande de taille GT (voir plus bas) |
| `html_plots.py` | timelines Plotly (centroide, IoU, stabilite ID) |
| `dashboard.py` | `generate_metrics_plots` + `metrics_dashboard.html` |

**Calcul** (`core.py`), MOTA/IDF1/IDSW **separes par mode** (MOT / SOT / SOT2 / Global) :

```python
compute_mot_metrics(
    pred_tracks_per_frame,   # {frame_id: [Track]}
    gt_per_frame,            # {frame_id: [(cls, x1, y1, x2, y2[, track_id])]}
    iou_threshold=0.1,
    iou_decrochage=0.2,
    sot_active_per_frame=None,   # {frame_id: bool}
    n_sot_losses=0, n_sot_inits=0,     # de state_machine
    n_sot2_losses=0, n_sot2_inits=0,   # dual-SOT
) -> dict
```

Chaque sous-dict de mode contient les scalaires (`mota, idf1, idsw, tp, fp, fn,
n_gt, n_frames`) **et** les donnees brutes serialisees dans `benchmark.json` :
`det_scores` / `det_labels` (score + TP/FP par detection), `per_frame_tp/fp/fn`,
`centroid_dists`, `iou_per_frame`, `gt_id_timeline`, et deux champs de taille :

- `det_gt_diag` : diagonale (px) du GT appariee a chaque detection (-1 pour un FP) ;
- `gt_diags` : diagonale de **chaque** GT vu (population de reference par bande).

Le detail des formules est commente dans `core.py`. Le sous-dict `"sot2"` n'apparait
que quand `n_targets >= 2`.

### Plots (`dashboard.py`, `png_plots.py`, `html_plots.py`, `size_plots.py`)

```python
generate_metrics_plots(metrics, benchmark, out_dir) -> list[Path]
```

Ecrit dans `out_dir` : `plot/` (PNG), `html/` (Plotly si installe) et le point
d'entree `metrics_dashboard.html`. PNG produits : `metrics_summary`,
`roc_curve_total` (courbe ROC), `metrics_confusion`, `metrics_iou_boxplot`,
`metrics_centroids_box_plot`, plus les plots par bande de taille.

**Plots par bande de taille** (`size_plots.py`), calcules sur la **diagonale GT** :

| Fichier | Contenu |
|---------|---------|
| `metrics_f1_threshold.png` | F1 du detecteur en fonction du seuil de score (GT 15-40px) ; le maximum fixe le seuil retenu partout ailleurs (ROC, confusion). |
| `metrics_confusion_15_40_px.png` | matrice de confusion restreinte aux GT de diagonale 15-40px (TP/FN filtres bande ; FP/TN globaux au run), valeurs normalisees par ligne + compte brut. |

Regeneration hors session : [`tools/regen_metrics_plots.py`](../tracker/tools/regen_metrics_plots.py)
`<run_dir>` relit `benchmark.json` et rejoue `generate_metrics_plots`. L'option
`--ver <fichier.ver>` reconstruit `det_gt_diag` / `gt_diags` pour un `benchmark.json`
anterieur a leur capture (puis les persiste : plus besoin du `.ver` ensuite).

### `debug_panel.py` (`utils/debug_panel.py`)

Bande d'information rendue en bas du canvas quand `debug_dialog_on_frames: true`.
Separee du visualizer principal pour clarte.

---

## 12. profiling/ - Profiler frame-par-frame

### Architecture

```
profiling/
  __init__.py    Re-export : build_profiler, FrameProfiler, NullProfiler
  profiler.py    FrameProfiler + NullProfiler + build_profiler() factory
  report.py      Generateur HTML (Plotly.js)
```

### `NullProfiler` - Zero overhead

Quand `enabled: false` dans `profiling_config.yaml`, `build_profiler()` renvoie
un `NullProfiler`. Toutes ses methodes sont des no-ops :
- `section(name)` : context manager qui `yield` immediatement
- `end_frame(...)` : ne fait rien
- `generate_report()` : ne fait rien

Overhead : **zero** (pas d'appel systeme, pas d'allocation).

### `FrameProfiler` - Profiler reel

```python
with profiler.section("detect_mot"):
    raw_dets = detector.detect(frame, frame_id)
# -> mesure le temps entre __enter__ et __exit__

profiler.end_frame(frame_id, total_s=time.perf_counter() - t0)
# -> stocke les mesures de cette frame
#    calcule "other" = total_s - somme(sections_mesurees)

profiler.generate_report()
# -> genere le HTML Plotly.js interactif
```

**Sections accumulables** : si une section est appelee plusieurs fois dans
la meme frame (ex. deux appels `detect_mot`), les temps s'additionnent.

### `build_profiler(cfg, run_dir)` - Factory

Lit `profiling_config.yaml` a la racine du projet. Construit :
- `NullProfiler` si `enabled: false` ou fichier absent
- `FrameProfiler` avec les sections actives, sinon

### `report.py` - Rapport HTML

Genere un fichier HTML auto-contenu (aucun serveur requis, Plotly.js via CDN).

**Architecture du code** :
- `_JS_LOGIC` : chaine Python ordinaire (pas f-string) contenant toute la logique JS.
  Aucun echappement `{{`/`}}` necessaire pour les accolades JS.
- `data_js` : f-string qui injecte les donnees Python (frame_ids, section_data, etc.)
  comme constantes JSON dans le script JS.
- `html` : f-string externe qui combine CSS, HTML, `data_js`, et `_JS_LOGIC`.

**Fonctionnalites interactives** :
- Toggle ms / FPS : bascule entre graphe barre (ms par section) et ligne FPS (1000/total_ms)
- Pie chart reactif : `plotly_relayout` event sur le bar chart -> recalcul des moyennes
  pour la plage selectionnee -> `Plotly.react()` sur le pie chart
- Tableau reactif : meme declencheur, met a jour toutes les colonnes (mean/min/max/total/%)

---

## 13. Systeme de configuration YAML

### Fichier source de verite : `config/config.yaml`

Contient tous les parametres commentes. C'est la reference.
Les fichiers dans `config_examples/` sont des surcharges focalisees sur un cas
d'usage particulier : `main.py` charge toujours `config/config.yaml` comme
base puis fusionne recursivement le fichier passe en `--config` par-dessus
(`_deep_merge`), donc un scenario n'a besoin de lister que les cles qu'il
modifie.

### Lecture

```python
import yaml
with open(cfg_path, "r", encoding="utf-8") as fh:
    cfg = yaml.safe_load(fh)
```

Ensuite, chaque composant lit **sa propre section** :
```python
# Dans CsrtSot.configure() :
csrt_cfg = cfg.get("csrt", {})
self._near_thresh_px = float(csrt_cfg.get("near_thresh_px", 300.0))
```

### Convention de nommage des sections

| Section YAML        | Composant qui la lit                |
|---------------------|-------------------------------------|
| `kalman_mot_custom` | `custom_kalman/tracker.py`          |
| `bytetrack`         | `bytetrack/tracker.py`              |
| `botsort`           | `botsort/tracker.py`                |
| `boosttrack`        | `boosttrack/tracker.py`             |
| `sot_kalman`        | `csrt/tracker.py` + `tracking_tophat/tracker.py` (Kalman SOT partage) |
| `csrt`              | `csrt/tracker.py`                   |
| `tracking_tophat`               | `tracking_tophat/tracker.py`                    |
| `dummy_sot`         | `dummy/tracker.py`                  |
| `dimp`              | `dimp/tracker.py`                   |
| `ostrack`           | `ostrack/tracker.py`                |
| `sam2`              | `sam2/tracker.py`                   |
| `tophat_mot`        | `detector_mot.py` (TopHatDetectorMOT) |
| `tophat_roi`        | `detector_roi.py` (TopHatROIDetector) |

### Parametres MOT-only

Ces parametres n'ont de sens qu'en etat MOT (quand MOT tourne) :
- `sot_click_max_dist_px` : filtre de clic (distance max a la track la plus proche)
- `sot_loss_threshold` : nombre d'echecs SOT avant retour MOT

Les commenter `# [MOT uniquement]` dans le YAML pour eviter la confusion.

### `command_delta`

Fenetre temporelle d'activation d'une commande (en frames).

```python
# Dans CommandParser.get_commands(frame_id) :
active = [cmd for cmd in cmds if cmd.frame_emit <= frame_id < cmd.frame_emit + delta]
```

| `command_delta` | Comportement |
|:---:|---|
| `1` (defaut) | Commande active **uniquement** a `frame_id = frame_emit`. Replay exact frame-perfect. |
| `N > 1` | Active de `frame_emit` a `frame_emit + N - 1`. Tolere N-1 frames de decalage. |

**Pourquoi > 1 ?** En acquisition temps reel avec drops de FPS, le pipeline peut
sauter des frames (passer de frame_id=4 a frame_id=6 sans traiter la 5).
Une commande a `frame_emit=5, delta=1` serait silencieusement ratee.
Avec `delta=2`, elle reste active a frame_id=6.

**En mode `command` (replay fichier)** : le loader lit sequentiellement, aucun saut.
`delta=1` est toujours correct. Ne pas augmenter sauf si les frame_emit dans le
fichier sont imprecis de plusieurs frames.

---

## 14. Decisions de conception cles

### D1 - Methode B pour custom_kalman (warp prediction, pas detection)

La CMC peut s'appliquer de deux facons :
- **Methode A** : transformer les detections dans le repere de la frame precedente
- **Methode B** : transformer la prediction Kalman dans le repere de la frame courante

La Methode B est preferable car :
1. La detection reste dans ses coordonnees brutes (plus precise)
2. La prediction est "deplacee" vers le repere courant avant l'association IoU
3. Les trackers GitHub (BoT-SORT, BoostTrack) utilisent la Methode B en interne

### D2 - Guard H_image (eviter le calcul ORB/ECC inutile)

ORB coute ~5 ms, ECC ~30 ms. H_image externe n'est calcule que si les deux
conditions sont vraies : niveau 1 (LDV) inactif ET niveau 2 (CMC interne
tracker) inactif. En operation nominale (LDV present), H_image n'est **jamais
calcule**. Avec botsort+sparseOptFlow sans LDV, H_image n'est pas non plus
calcule (niveau 2 actif, tracker gere son propre H).

### D3 - NullProfiler (zero overhead en production)

Le profiler est concu pour etre desactive sans aucune penalite.
`NullProfiler.section()` est un context manager qui `yield` immediatement
sans mesurer le temps. `build_profiler()` renvoie `NullProfiler` si desactive.

### D4 - `is_sot_target` plutot que `track_id == 0`

La track SOT interne (`_SotTrack`) a un attribut sentinelle `is_sot_target = True`.
Le visualizer teste `getattr(trk, "is_sot_target", False)` pour la colorer
(magenta SOT1 / orange SOT2 selon `sot_slot`). Ne pas utiliser `track_id == 0` car :
- C'est une convention fragile (un futur tracker pourrait avoir une track ID 0)
- L'attribut sentinelle est explicite et documentable

### D5 - `configure()` separe de `init()`

`init(frame, click_pos, mot_tracks)` est appele a chaque activation SOT (clic).
`configure(cfg)` est appele une seule fois apres instanciation.
Separer les deux evite de relire le YAML a chaque clic et rend clair
ce qui est "statique" (hyperparametres) vs "dynamique" (initialisation du tracker).

### D6 - `mot_background` pour DummySot

DummySot n'est pas un vrai tracker SOT : il ne fait que "suivre" une track MOT
existante. Pour fonctionner, il a besoin que MOT tourne en background.
Configurer `mot_background: true` dans le YAML quand `tracker_sot: "dummy"`.

### D7 - Monkey-patch BoT-SORT sans modifier le repo clone

Pour capturer H et injecter H_ldv dans BoT-SORT sans toucher au code du repo :
```python
_orig_apply = gmc.apply  # methode liee capturee dans la fermeture
def _apply_capturing(img, dets):
    if self._ldv_warp_2x3 is not None:
        warp = self._ldv_warp_2x3   # bypass LDV : sparseOptFlow skippe
    else:
        warp = _orig_apply(img, dets)  # sparseOptFlow normal
    self._last_warp_2x3 = warp.copy() if warp is not None else None
    return warp
gmc.apply = _apply_capturing  # remplacement sur l'instance
```
`_ldv_warp_2x3` est mis a jour dans `update()` avant `tracker.update()`.
`get_last_homography()` convertit `_last_warp_2x3` (2x3) en H 3x3.
Le repo reste intact, pas de conflits lors des mises a jour Git.

### D8 - Injection de donnees JS via JSON.dumps (report.py)

La logique JS dans `report.py` utilise des accolades (`{`, `}`) partout.
Pour eviter l'echappement massif `{{`/`}}` dans les f-strings Python :
- Les **donnees** sont injectees via `f"const X = {json.dumps(data)};"` (f-string minimale)
- La **logique JS** est dans `_JS_LOGIC`, une chaine Python ordinaire (pas f-string)
  -> les accolades JS sont litterales, aucun echappement requis
- Le **template HTML** (f-string externe) interpole uniquement des variables Python

### D9 - `has_own_image_cmc` : distinguer "applique H" de "calcule H"

`has_internal_cmc=True` signifie que le tracker *applique* H sur ses etats (tous = True).
`has_own_image_cmc=True` signifie que le tracker *calcule lui-meme* H depuis l'image.

Cette distinction est necessaire pour la chaine CMC 4 niveaux :
- Si le tracker calcule son propre H (niv.2), session.py ne doit **pas** calculer
  H_image en plus (evite double calcul ORB/ECC) et ne doit **pas** lui injecter H.
- Si le tracker ne calcule pas H (niv.3/4), session.py doit calculer H_image
  et le passer via `update(H=H_image)` ou laisser H=None.

Sans cette propriete, injecter H_image dans botsort **bypasse** son sparseOptFlow
interne, ce qui est l'effet inverse du souhaite quand `use_ldv_cmc=False`.

---

## 15. Guides pratiques : ajouter un composant

### Nouveau tracker MOT

1. Creer `trackers/mot/<nom>/tracker.py` :
   ```python
   from trackers.base_tracker import BaseTracker
   class MonTrackerMOT(BaseTracker):
       def init(self, cfg: dict) -> None:
           mon_cfg = cfg.get("mon_tracker", {})
           self._param = mon_cfg.get("param", 0.5)
       def update(self, frame, dets, H=None): ...
       def reset(self): ...

       @property
       def has_internal_cmc(self) -> bool:
           return True  # toujours True : on applique H sur nos etats Kalman

       @property
       def has_own_image_cmc(self) -> bool:
           # True UNIQUEMENT si le tracker calcule lui-meme H depuis l'image
           # (ex: sparseOptFlow, ECC interne). False sinon (reçoit H de session.py).
           return False

       def get_last_homography(self):
           # Retourner H 3x3 si le tracker a calcule H en interne, None sinon.
           return None
   ```
2. Creer `trackers/mot/<nom>/__init__.py` vide
3. Ajouter dans `pipeline/builders.py` sous `MOT_REGISTRY` :
   ```python
   "mon_tracker": "trackers.mot.mon_tracker.tracker.MonTrackerMOT",
   ```
4. Ajouter la section YAML dans `config/config.yaml`
5. Utiliser : `tracker_mot: "mon_tracker"` dans le YAML de run

### Nouveau tracker SOT

1. Creer `trackers/sot/<nom>/tracker.py` :
   ```python
   from trackers.sot.base_sot import BaseSot
   class MonSOT(BaseSot):
       def configure(self, cfg: dict) -> None:
           sub = cfg.get("mon_sot", {})
           self._param = float(sub.get("param", 1.0))
       def init(self, frame, click_pos, mot_tracks): ...
       def update(self, frame, mot_tracks): ...
       def reset(self): ...
   ```
2. Ajouter dans `pipeline/builders.py` sous `SOT_REGISTRY` :
   ```python
   "mon_sot": "trackers.sot.mon_sot.tracker.MonSOT",
   ```
3. Ajouter la section YAML dans `config/config.yaml`
4. Utiliser : `tracker_sot: "mon_sot"` dans le YAML de run

### Nouvelle camera

1. Creer `data/rejeu/cameras/<nom>/metadata_reader.py` :
   ```python
   from data.rejeu.metadata_base import MetadataReaderBase
   class MaCameraMetadataReader(MetadataReaderBase):  # nom DOIT finir par "MetadataReader"
       def __init__(self, sequence_dir: Path, csv_files: list): ...
       def get_ldv_series(self): ...     # {frame_idx: (az_deg, el_deg)}
       def get_camera_info(self): ...    # {fps, width, height, chh_deg[, chv_deg]}
   ```
2. Creer `data/rejeu/cameras/<nom>/__init__.py` vide
3. Enregistrer dans `data/rejeu/cameras/__init__.py` :
   ```python
   CAMERA_REGISTRY["ma_camera"] = "data.rejeu.cameras.ma_camera"
   ```
   La fabrique instancie la classe dont le nom finit par `MetadataReader`.
4. Utiliser : `camera_name: "ma_camera"` dans le YAML

### Nouveau format d'annotation

Ajouter un `elif` dans `data/rejeu/annotation_loader.load_annotations()`.

### Nouvelle section de profiling

1. Ajouter le nom dans `SECTION_ORDER` dans `profiling/profiler.py` :
   ```python
   SECTION_ORDER = [
       "frame_load", "ldv_cmc", ..., "ma_section", "render"
   ]
   ```
2. Ajouter une couleur dans `SECTION_COLORS` (meme fichier)
3. Entourer le code cible dans `session.py` :
   ```python
   with profiler.section("ma_section"):
       # code a mesurer
   ```
4. Activer dans `profiling_config.yaml` :
   ```yaml
   sections:
     ma_section: true
   ```

### Nouveau detecteur MOT

1. Creer la classe dans `pipeline/detector/detector_mot.py` (heritant `BaseDetectorMOT`)
2. Ajouter une branche `elif detector_key == "ma_cle":` dans `build_detector_mot()`
   (`pipeline/builders.py`) qui lit sa section YAML et instancie la classe.
   Note : la selection se fait par chaine if/elif, **pas** par registre.
3. Ajouter la cle dans le YAML : `detector_mot: "ma_cle"`

### Nouveau detecteur ROI

1. Creer la classe dans `pipeline/detector/detector_roi.py` (heritant `BaseDetectorROI`)
2. Ajouter une branche `elif detector_key == "ma_cle":` dans `build_detector_roi()`
   (`pipeline/builders.py`).
3. Ajouter la cle dans le YAML : `detector_roi: "ma_cle"`

### Nouveau mode de rendu / visualisation

Modifier `utils/visualizer.py` -> `render()` ou `_build_canvas()`.

Les overlays sont conditionnés par :
- `self.cfg.light_render` -> si True, seules les bboxes sont dessinées (bypass total)
- `self.cfg.debug_overlay` -> bande debug bas de frame
- `self.cfg.show_*` -> flags individuels

Pour ajouter un nouvel overlay :
```python
def _draw_mon_overlay(self, canvas: np.ndarray, ...) -> None:
    # Dessiner sur canvas (modifie en place)
    ...

# Dans render(), après _build_canvas() et le guard light_render :
_light = self.cfg.light_render
if not _light and self.cfg.show_mon_overlay:
    self._draw_mon_overlay(canvas, ...)
```

Ajouter le flag dans `VisualizerConfig` :
```python
@dataclass
class VisualizerConfig:
    ...
    show_mon_overlay: bool = False
```

Et dans `build_visualizer()` dans `pipeline/builders.py` :
```python
viz_cfg = VisualizerConfig(
    ...
    show_mon_overlay = bool(cfg.get("show_mon_overlay", False)),
)
```

### Nouveau format de séquence en entrée réseau

Pour ajouter un nouveau protocole de streaming (RTSP, WebRTC, GStreamer…),
créer une nouvelle classe dans `data/` héritant de l'interface de `NetworkFrameReader` :

```python
class RTSPFrameReader:
    def __init__(self, url: str):
        import cv2
        self._cap = cv2.VideoCapture(url)  # cv2 supporte RTSP nativement
        self._fps = self._cap.get(cv2.CAP_PROP_FPS) or 10.0

    def __getitem__(self, idx: int) -> np.ndarray:
        ok, frame = self._cap.read()
        if not ok or frame is None:
            return np.zeros((512, 640, 3), dtype=np.uint8)
        return frame

    @property
    def fps(self) -> float:
        return self._fps

    def close(self) -> None:
        self._cap.release()
```

Enregistrer dans `pipeline/builders.py` -> `build_loader()` :
```python
if seq_dir.startswith("rtsp://"):
    from data.rtsp_reader import RTSPFrameReader
    reader = RTSPFrameReader(seq_dir)
    return _NetworkLoaderWrapper(reader, cfg)
```

Le `_NetworkLoaderWrapper` existant est réutilisable sans modification.
Les métadonnées LDV sont indisponibles depuis un flux réseau -> la CMC
bascule automatiquement sur le niveau 3 (H_image ORB/ECC) si configuré.

---

## 16. Debug et diagnostics

### Logs

Le projet utilise le module standard `logging`. Chaque fichier declare :
```python
log = logging.getLogger(__name__)
```

Niveaux utilises :
- `DEBUG` : details fins (candidats, distances, decisions intermediaires)
- `INFO` : evenements normaux (activation SOT, retour MOT, H calcule)
- `WARNING` : anomalies non fatales (clic rejete, perte SOT, LDV absent)
- `ERROR` : erreurs recuperables (generation rapport echouee, etc.)

Activer les logs DEBUG :
```python
# Dans main.py ou un script de test :
import logging
logging.basicConfig(level=logging.DEBUG)
```

### Logs specifiques par composant

| Composant           | Prefixe log                         | Information cle                        |
|---------------------|-------------------------------------|----------------------------------------|
| `DummySot`          | `trackers.sot.dummy.tracker`        | Distances candidates, `DANS RAYON`, `TROP LOIN` |
| `CsrtSot`           | `trackers.sot.csrt.tracker`         | PSR, `HORS RAYON`, source bbox (direct/fallback/40x40) |
| `TrackerStateMachine` | `pipeline.state_machine`           | Clic accepte/rejete, distance, seuil   |
| `EgoMotionCompensator` | `pipeline.ego_motion`             | H_ldv / H_image calcule, guard active  |
| `FrameProfiler`     | `profiling.profiler`                | Sections actives, chemin HTML          |

### Diagnostiquer la chaine CMC active

Au demarrage de chaque session, deux lignes INFO indiquent exactement quel
niveau de la chaine CMC est actif :

```
[CMC] Chaine fallback : LDV(use_ldv_cmc=true) -> TRACKER_INTERNE(BotSortWrapper) -> H_EXT_IMAGE(orb) -> AUCUNE_CMC
[CMC] Tracker MOT : BotSortWrapper  |  has_own_image_cmc=True  |  use_ldv_cmc=True  |  method_ext=orb
```

Lecture : le premier terme actif a gauche est celui qui sera utilise.
- `LDV(use_ldv_cmc=false)` -> niveau 1 desactive (LDV ignore meme si dispo)
- `TRACKER_INTERNE(non)` -> tracker n'a pas de CMC image propre (custom_kalman, bytetrack)
- `H_EXT_IMAGE(non)` -> `homography_method_image: ""` (pas de calcul ORB/ECC)

Dans le profiler HTML, verifier :
- `ldv_cmc > 0 ms` : LDV present, niv.1 actif
- `image_cmc > 0 ms` : niv.3 actif (niv.1 et 2 inactifs)
- `image_cmc = 0 ms` mais `mot_update` long : niv.2 actif (sparseOptFlow/ECC dans tracker)
- Tout a 0 ms : niv.4, aucune compensation

### Diagnostiquer un clic rejete

```
[F00142] Clic rejete : MOT actif mais 0 track disponible [...]
  -> Le detecteur ne detecte rien. Verifier detector_mot et les seuils YOLO.

[F00142] Clic rejete : track_id=3 la plus proche a 287.4 px > seuil 200 px [...]
  -> Augmenter sot_click_max_dist_px ou cliquer plus pres d'une track.
```

### Diagnostiquer une perte SOT

```
# DummySot
[F00200] DummySot.update: no MOT track within 300 px of (874,328) [0 candidats]
  -> dummy_sot.max_match_dist_px trop petit, ou le MOT a perdu la cible.

# CsrtSot
[F00200] CsrtSot lost target: PSR=4.2 < threshold=6.0
  -> csrt.psr_threshold trop strict, ou vraie perte de cible.
```

### Verifier l'integration du profiler

Apres un run avec `enabled: true`, le rapport HTML est dans `outputs/run_.../profiling.html`.
Si le fichier est absent :
1. Verifier `profiling_config.yaml` : `enabled: true`
2. Verifier les logs : `Profiling report: ...` (INFO) ou une erreur
3. Verifier que `profiler.generate_report()` est bien appele dans `session.py`

### Verifier la syntaxe des fichiers Python

```bash
# Verifier tous les fichiers du projet :
python -m py_compile pipeline/session.py
python -m py_compile pipeline/state_machine.py
python -m py_compile profiling/profiler.py
python -m py_compile profiling/report.py

# Ou en batch :
python -m compileall pipeline/ profiling/ trackers/ -q
```

### Chaine qualite (ruff / pytest / mypy / bandit)

Le projet embarque un orchestrateur qualite dans `quality/` :

```bash
python quality/quality.py                 # ruff + pytest + mypy + bandit
python quality/quality.py --fix           # corrige automatiquement les violations ruff
python quality/quality.py --no-mypy --no-bandit   # rapide : ruff + tests
```

- Chaque outil lit sa config dans `pyproject.toml` (racine projet).
- La sortie est aussi ecrite dans `quality/logs/quality_<date>.log`.
- Un echec n'arrete pas les etapes suivantes (bilan global en fin de run).
- Cibles mypy : `pipeline/`, `trackers/sot/csrt/`, `trackers/sot/tracking_tophat/`
  (les repos MOT tiers ont leurs propres stubs et sont exclus).
- Tests pytest : `quality/tests/` (data : loaders/readers/annotations,
  pipeline : detector_mot/detector_roi/ego_motion).

Documentation : [`quality.md`](quality.md) (ce que chaque outil corrige +
panorama des outils Python).
