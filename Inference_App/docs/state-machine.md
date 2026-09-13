# pipeline/state_machine.py - Schema complet

Machine d'etats MOT/SOT du tracker (`tracker/pipeline/state_machine.py`). Voir
aussi [`track-objects.md`](track-objects.md) pour les objets track qu'elle
manipule et retourne, et [`architecture.md`](architecture.md) pour sa place dans
le flux `run_session`.

## Vue d'ensemble des modes

```
YAML : tracker_mot
+-- null / "none"  ->  MODE SOT-ONLY  (etats : IDLE <-> SOT)
+-- set            ->  MODE NORMAL    (etats : MOT  <-> SOT)
```

---

## Mode sans tracker MOT (`tracker_mot: null`)

```
Ignore    : mot_background
Actif     : detector_mot (yolo/tophat/none), detector_roi (fallback SOT init)
Param cle : sot_click_max_dist_px (filtre distance clic -> _DetTrack)
```

Comportement selon `detector_mot` :
- `yolo` / `tophat` -> dets brutes converties en `_DetTrack` ephemeres (sans ID
  persistant), affichees en IDLE, cliquables pour SOT init.
- `none` + `detector_roi` set -> vrai IDLE, SOT init via ROI au clic uniquement.
- `none` + `detector_roi: none` -> IDLE vide (sam2 point-only fonctionne quand
  meme).

```
+-----------------------------------------------------------------+
|  IDLE  (en attente de clic operateur)                           |
|  _DetTrack ephemeres affichees si detector_mot configure        |
+------------------------+------------------------------------------+
                         | clic souris (mode interactive)
                         | ou commande (mode command)
                         v
            priorite 1 : _DetTrack la plus proche du clic
            priorite 2 : detector_roi.detect_at_click(frame, click)
                         |
             +-----------+-----------+
        blob trouve              blob absent
             |                       |
             v                   log.warning [KO]
   SOT.init(blob_bbox)      "Impossible d'accrocher"
             |                   -> retour IDLE
             v
+-------------------------------------------------------------------+
|  SOT  (CSRT / DiMP / OSTrack / SAM2 en cours)                     |
+------+---------------+----------------------------------------------+
       | SOT OK        | SOT FAIL (miss++)
       |               |
       |               |  miss < sot_loss_threshold
       |               |  -> affiche derniere bbox connue
       |               |
       |               |  miss >= sot_loss_threshold
       |               |  log.info "DECROCHAGE SOT1"
       |               +----------------------------------> IDLE
       |
       | nouveau clic
       |  -> SOT.reset()
       +----------------------------------------------> (restart depuis IDLE)
```

---

## Mode normal (`tracker_mot: set`)

### Parametre cle : `sot_click_max_dist_px`

```
sot_click_max_dist_px = 0   ->  pas de filtre distance
                              tout clic declenche le SOT (toutes tracks passees a SOT.init)
sot_click_max_dist_px > 0   ->  filtre actif
                              clic -> cherche track dans le rayon
                              si trop loin -> fallback detector_roi
                              si detector_roi vide -> [KO] Warning, clic ignore
```

Ce meme parametre est transmis a : `TrackerStateMachine` (filtre click -> nearest
track), `CsrtSot._near_thresh_px` (filtre track -> bbox d'init), `DummySot._max_match_dist`
(filtre track -> bbox par frame).

### Cas 2 : `mot_background: true`

```
[MOT actif] - detector_mot tourne - tracks MOT visibles

    clic (depuis etat MOT) :
    +--------------------------------------------------------+
    | track dans le rayon sot_click_max_dist_px ?            |
    |    OUI ---> SOT.init(track.bbox)  -> [SOT+MOT]          |
    |    NON ---> detector_roi ?                              |
    |              blob trouve --> SOT.init(blob)->[SOT+MOT]  |
    |              blob absent / detector_roi=none            |
    |                  log.warning [KO] "failed fallback"     |
    |                  clic ignore, reste en [MOT]            |
    +--------------------------------------------------------+

+---------------------------------------------------------------+
|  SOT + MOT (MOT tourne en fond)                                |
|  affichage : track SOT (magenta) + tracks MOT visibles         |
+------+---------------+-------------------------------------------+
       | SOT OK        | SOT FAIL (miss++)
       |               |
       |               |  miss >= sot_loss_threshold
       |               |  log.info "DECROCHAGE SOT1"
       |               +----------------------------------> [MOT]
       |
       | nouveau clic (switch de cible) :
       | +--------------------------------------------------------+
       | | track MOT en fond dans le rayon ?                      |
       | |    OUI ---> SOT.reset() + SOT.init(track.bbox)          |
       | |    NON ---> detector_roi ?                              |
       | |            blob trouve --> SOT.reset() + SOT.init       |
       | |            blob absent  --> [KO] Warning                |
       | |              -> SOT continue sur derniere bbox connue   |
       | +--------------------------------------------------------+
       |
       +----------------------------------------------------> (reste SOT+MOT)
```

### Cas 3 : `mot_background: false`

```
[MOT actif] - detector_mot tourne - tracks MOT visibles

    clic (depuis etat MOT) :
    +--------------------------------------------------------+
    |  Meme logique que Cas 2 pour le 1er clic :              |
    |  track dans rayon -> SOT.init(track)  -> [SOT]           |
    |  trop loin -> detector_roi -> blob -> SOT.init            |
    |  fallback vide -> [KO] Warning, clic ignore              |
    +--------------------------------------------------------+

+---------------------------------------------------------------+
|  SOT  (MOT EN VEILLE - pas de tracks MOT pendant le SOT)       |
|  affichage : track SOT (magenta) uniquement                    |
+------+---------------+-------------------------------------------+
       | SOT OK        | SOT FAIL (miss++)
       |               |
       |               |  miss >= sot_loss_threshold
       |               |  log.info "DECROCHAGE SOT1"
       |               +----------------------------------> [MOT] (redemarre)
       |
       | nouveau clic (re-accrochage) :
       | +--------------------------------------------------------+
       | | MOT en veille -> pas de tracks MOT disponibles          |
       | | -> detector_roi direct                                  |
       | |    blob trouve --> SOT.reset() + SOT.init(blob)         |
       | |    blob absent  --> [KO] Warning -> retour [MOT]        |
       | +--------------------------------------------------------+
       |
       +----------------------------------------------------> (reste SOT)
```

---

## Logique commune `_activate_sot()`

```
Entree : click_pos, mot_tracks (liste eventuellement vide)

1. mot_tracks non vide
   -> tracker_sot.init(frame, click_pos, mot_tracks)
      CSRT : containment check -> plus proche dans near_thresh_px -> 40x40
      Dummy: plus proche (inf si sot_click_max_dist_px=0)

2. mot_tracks vide + detector_roi reel (tophat)
   -> roi_bbox = detector_roi.detect_at_click(frame, click_pos)
      blob trouve  -> _SyntheticTrack(roi_bbox) -> tracker_sot.init(...)  -> OK
      blob absent  -> log.warning [KO] "Impossible d'accrocher"          -> False

3. mot_tracks vide + detector_roi = NoneDetectorROI
   -> legacy fallback : CSRT 40x40 centre sur le clic (deprecated)
```

---

## Deuxieme cible SOT (`n_targets: 2`)

Quand `n_targets >= 2`, `build_trackers()` instancie un **second tracker SOT**
(`sot_tracker2`, meme classe, instance separee). La machine gere alors deux
cibles SOT en parallele :

```
clic GAUCHE  -> SOT1 (sot_slot=0, track_id=0,  couleur magenta)
clic DROIT   -> SOT2 (sot_slot=1, track_id=-2, couleur orange)
clic MOLETTE -> kill_all_sot() : relache TOUTES les cibles SOT -> retour etat de repos
```

- `trigger_sot(click, fid)` : enregistre le clic gauche (SOT1) -> `_pending_click`.
- `trigger_sot2(click, fid)` : enregistre le clic droit (SOT2) -> `_pending_click2`
  (ignore si `sot_tracker2 is None`, c.-a-d. `n_targets < 2`).
- SOT2 tourne **independamment** de l'etat MOT/SOT global : `_run_sot2_update()`
  est appele a chaque frame tant que `_sot2_active`. Un decrochage SOT2
  (`sot_miss >= sot_loss_threshold`) desactive SOT2 sans toucher SOT1 ni l'etat.

### Keepalive MOT (fenetre du 2e clic)

Probleme : en `mot_background: false`, des que SOT1 s'accroche, le MOT passe en
veille -> plus aucune track MOT disponible pour cliquer la 2e cible.

Solution : sur la transition MOT->SOT1, si `sot_tracker2` existe et que
`mot_background=false`, le MOT est **maintenu actif** pendant
`mot_keepalive_after_sot_s` secondes (defaut 2.0 s) :

```
[F00120] Dual SOT : MOT maintenu actif 2.0s pour le 2e clic (SOT2)
```

Pendant cette fenetre, `MotRole.KEEPALIVE` est actif et les tracks MOT restent
visibles (assemblees avec la track SOT1). Passe le delai, le MOT repasse en
veille (`MotRole.PAUSED`). `mot_keepalive_after_sot_s: 0` desactive le keepalive.

---

## Mode sans tracker MOT mais avec detecteur

Subtilite : en mode SOT-only (`tracker_mot: null`), l'**etat de repos** n'est pas
toujours IDLE. La propriete `_back_state` vaut :

```
tracker_mot=null ET detector_mot=none  -> IDLE  (vrai repos vide)
tracker_mot=null ET detector_mot set   -> MOT   (les dets brutes -> _DetTrack affichees)
tracker_mot set                        -> MOT
```

Dans le second cas, les detections sont enveloppees dans des `_DetTrack`
(`track_id` = index dans la frame, ephemere, sans persistance) et retournees
directement pour affichage + metriques. `should_run_mot_detection()` renvoie
alors `True` (il faut detecter pour alimenter l'affichage), meme sans tracker MOT.

---

## Etat structure (`PipelineState`)

La machine a etat expose un snapshot exportable via `get_pipeline_state()` :

```python
@dataclass
class PipelineState:
    mode:         PipelineMode   # IDLE | MOT | SOT
    mot_role:     MotRole        # off | foreground | background | keepalive | paused
    sot2_active:  bool
    last_event:   str            # texte libre du dernier evenement
    frame_id:     int
    sot_miss:     int
    n_sot_inits:  int
    n_sot_losses: int
```

`PipelineMode` et `MotRole` sont des `str` Enum : `PipelineMode.SOT == "SOT"` est
`True`.

---

## Logging

| Niveau | Prefixe | Signification |
|---------------|---------|-------------------------------------------------------|
| `log.debug` | - | Statut frame-par-frame (distances tracks, verbose MOT) |
| `log.info` | - | Transitions d'etat, clic recu, accrochage, decrochage SOT, fallback gere |
| `log.warning` | `[KO]` | Echec complet : clic **totalement ignore**, accrochage impossible |

**Regle** : des qu'un fallback prend le relais, c'est `log.info`. `log.warning
[KO]` uniquement quand l'action de l'operateur n'a eu **aucun effet**. Les
messages `[KO]` apparaissent en rouge dans le log panel (`debug_dialog_on_frames: true`).

---

## Resume des configurations YAML

| `tracker_mot` | `mot_background` | `detector_mot` | `detector_roi` | Comportement |
|---|---|---|---|---|
| `null` | ignore | yolo/tophat | optionnel | Dets -> `_DetTrack` ephemeres affichees + cliquables |
| `null` | ignore | `none` | requis | IDLE vide, SOT init via ROI au clic |
| `null` | ignore | `none` | `none` | IDLE vide total (sam2 point-only OK) |
| set | `false` | requis | recommande | MOT puis SOT solo |
| set | `true` | requis | recommande | MOT fond + SOT |

---

## Scenarios

| Scenario | tracker_mot | mot_bg | Mode | Fichier |
|----------|---------------|--------|-------------|-----------------------------------|
| A | botsort | false | interactive | mot_sot_interactive_light.yaml |
| A (solo) | **null** | ignore | interactive | sot_solo_interactive.yaml |
| B | botsort | true | command | B_mot_sot_command.yaml |
| C | custom_kalman | false | command | sot_solo_command.yaml |
| E | botsort | false | interactive | distributed_pc_jetson.yaml |
| F | botsort | false | interactive | F_zmq_single_csv_interactive.yaml |
| F2 | botsort | false | headless | F2_zmq_single_csv_headless.yaml |

Detail de lancement des scenarios en CLI : [`architecture.md`](architecture.md#lancer-en-cli-standalone-hors-app-web).
