# Integration ZMQ - Protocole generique JSON+JPEG

Architecture de communication ZMQ entre un sender C++ (`tools/zmq_cpp`, fourni
comme reference generique) et le pipeline Python (`tracker/data/zmq/`) :
ring buffer temps reel, recalage automatique, et reprojection des clics LDV.

Le protocole est volontairement simple (JSON + JPEG, pas de struct binaire
proprietaire) pour servir de contrat facile a reimplementer avec n'importe
quel sender (autre langage, autre capteur). La source de verite du format des
messages est `tracker/data/zmq/protocol.py` (Python) et
`tracker/tools/zmq_cpp/json_utils.hpp` (C++).

---

## Vue d'ensemble

3 sockets ZMQ PUSH/PULL, **ports fixes** (pas de decouverte dynamique) : host
et ports doivent correspondre des deux cotes.

```
C++ (tools/zmq_cpp)                          Python (pipeline)

PUSH bind(:zmq_port)      --> [meta JSON, JPEG] -->   PULL connect
                                                       ZmqFrameReader

PULL bind(:zmq_anno_port) <-- {frame_id, boxes} <--   PUSH connect
                                                       ZmqDisplayBridge

PUSH bind(:zmq_click_port) --> {frame_id, type, x, y} -->  PULL connect
                                                            ZmqDisplayBridge
```

Le canal annotations/clics n'est actif qu'en mode `headless` (le sender C++
doit alors etre lance avec `--display`) : c'est lui qui affiche les frames
annotees et remonte les clics operateur. En mode `interactive`, Python affiche
lui-meme les frames (fenetre OpenCV locale) et le canal annotations/clics
n'est pas utilise.

---

## Canal 1 - Frames C++ vers Python

**Socket** : `PUSH` cote C++ (bind `tcp://*:<zmq_port>`, defaut 5555), `PULL`
cote Python (connect). Message **multipart** a 2 parties.

**Partie 1 - meta JSON** (voir `json_utils.hpp::make_meta_json`) :
```json
{"az": 0.0123, "el": -0.045, "chh": 42.5, "frame_id": 128}
```

| Champ | Unite | Description |
|-----------|---------|------------------------------------------|
| `az` | radians | Azimut LDV |
| `el` | radians | Elevation LDV |
| `chh` | degres | FOV horizontal reel (deja en degres, pas de conversion) |
| `frame_id` | entier | Compteur de frame, croissant strict |

Pas de roulis ni de FOV vertical distinct dans ce protocole generique :
`ZmqFrameReader` remplit `roulis_deg = 0.0` et `vfov_deg = hfov_deg` (alias).

**Partie 2 - JPEG** : image encodee JPEG (`cv::imencode(".jpg", ...)` cote
C++), decodee par `cv2.imdecode` cote Python.

**Contraintes cote emetteur** : `frame_id` global croissant strict (un saut
negatif de plus de `zmq_ring_size` est interprete par Python comme un
redemarrage du sender). Envoi non-bloquant recommande (`--drop`/`--display`
cote `tools/zmq_cpp`) pour ne jamais accumuler de retard.

---

## Canal 2 - Annotations Python vers C++ (mode headless)

**Socket** : `PUSH` cote Python (connect), `PULL` cote C++ (bind
`tcp://*:<zmq_anno_port>`, defaut 5556). Message JSON, une seule partie (voir
`data/zmq/protocol.py::build_annotation` et
`tools/zmq_cpp/json_utils.hpp::parse_boxes`) :

```json
{"frame_id": 128, "boxes": [
  {"x1": 100, "y1": 80, "x2": 140, "y2": 110, "b": 50, "g": 210, "r": 50, "label": "3"}
]}
```

Pas de limite de nombre de boxes imposee par le protocole (liste JSON de
taille variable) ; `zmq_anno_n_boxes` (YAML) plafonne cote Python le nombre de
boxes envoyees par frame (defaut 5), pour la bande passante. Ordre d'envoi :
tracks SOT (par slot croissant) puis tracks MOT (par score decroissant).

**Couleurs par etat de tracking** (section `render:` du YAML) :

| Couleur (BGR) | Etat |
|-------------------|------------------|
| (50, 210, 50) | MOT actif |
| (50, 130, 50) | MOT predit |
| (255, 60, 220) | SOT1 verrouillee |
| (160, 30, 130) | SOT1 perdue |
| (0, 165, 255) | SOT2 verrouillee |
| (0, 100, 180) | SOT2 perdue |

Le `frame_id` des annotations est en retard sur la frame C++ courante (retard
nominal de quelques frames). Le sender doit garder un buffer local de frames
indexe par `frame_id` pour retrouver la bonne image (voir
`tools/zmq_cpp/frame_buffer.hpp`, taille configurable via `--buffer-size`).

---

## Canal 3 - Clics C++ vers Python

**Socket** : `PUSH` cote C++ (bind `tcp://*:<zmq_click_port>`, defaut 5557),
`PULL` cote Python (connect). Message JSON, une seule partie (voir
`display.hpp::on_mouse` et `data/zmq/protocol.py::parse_click`) :

```json
{"frame_id": 128, "type": "left", "x": 320, "y": 240}
```

| Champ | Valeurs | Description |
|------------|-------------------------------|--------------------------------------|
| `type` | `"left"` \| `"right"` \| `"scroll"` | gauche=SOT1, droit=SOT2, molette=kill |
| `x`, `y` | entiers | Coordonnees dans l'image affichee |
| `frame_id` | entier | frame_id de l'image affichee au moment du clic |

**Action selon le type (cote Python)** :

| `type` | Action Python |
|-----------|-------------------------------|
| `left` | `state_machine.trigger_sot()` |
| `right` | `state_machine.trigger_sot2()` |
| `scroll` | `state_machine.kill_all_sot()` |

**Reprojection LDV** (`ZmqDisplayBridge.apply_clicks`) : le clic arrive avec un
`frame_id` passe (retard d'affichage cote sender). Python reprojette les
coordonnees via le `LdvBuffer` inertiel :
```python
ldv_click   = ldv_buffer.get(frame_id_clic)     # az/el au moment du clic
ldv_courant = cur_ldv                            # az/el frame Python courante
x, y = compensator.reproject_click_ldv(ldv_click, ldv_courant, (x, y), shape)
# H = K * R_relative * K^-1
```
`max_delay_frames` (YAML) = taille du `LdvBuffer`, doit couvrir le retard max
entre le clic et la frame Python courante.

---

## Ring buffer et recalage automatique

```
Sender envoie sans se soucier de Python (hwm = ring_size * 2 cote Python)
          |
          v  reseau TCP
Python recv thread (ZmqFrameReader._recv_loop)
          |
          v
  +----------------------------------+
  |  Ring buffer Python (taille N)   |  drop oldest quand plein
  |  [frame 8][frame 9][frame 10]... |
  +----------------------------------+
          |  queue.get() -> prend la plus vieille dispo
          v
  _ZmqLoaderWrapper.__iter__
    -> mesure gap = frame_id_courant - frame_id_precedent
    -> si avg_gap > seuil : drain(n) pour sauter des frames
```

**Startup drain** : Python demarre apres le sender (YOLO warmup). Le ring
buffer est plein de vieilles frames. Au demarrage de la boucle, Python vide
tout sauf la derniere frame :
```
Log INFO :
ZMQ demarrage : drain 9 frame(s) pour partir de la plus recente [buffer 1/10]
```

**Recalage automatique** : si Python accumule du retard, l'ecart entre
frame_ids successifs depasse 1. `_ZmqLoaderWrapper` mesure `avg_gap` sur une
fenetre de 5 frames et saute des frames si `avg_gap > zmq_catchup_threshold`.

**Reconnect sender** : si le compteur `frame_id` repart brutalement en
arriere (saut negatif > `zmq_ring_size`), `ZmqFrameReader` considere que le
sender a redemarre et le signale via `check_reconnect()` (reinitialise le
suivi de gap cote `_ZmqLoaderWrapper`).

### Configuration et impact des parametres

```yaml
zmq_port:              5555   # port des frames (doit correspondre a --port cote C++)
zmq_anno_port:         5556   # port annotations (--anno-port)
zmq_click_port:        5557   # port clics (--click-port)
zmq_recv_timeout_ms:   5000
zmq_ring_size:         10     # frames gardees dans le ring buffer Python
zmq_catchup_threshold: 2.0    # ecart avg avant recalage automatique
zmq_anno_n_boxes:      5      # nb max de boxes envoyees par frame (headless)
```

**`zmq_ring_size`** : taille du ring buffer Python. Trop petit (3) : Python
attend des frames -> timeout, image noire. Trop grand (50) : retard qui
s'accumule avant recalage. Recommande : **10 frames** (~1s a 10 fps).

**`zmq_catchup_threshold`** : seuil sur l'ecart moyen inter-frame_ids. Trop bas
(1.2) : recalages frequents, frames inutilement sautees. Trop haut (5.0) :
retard s'accumule, bboxes sur vieilles frames. Recommande : **2.0**.

**`max_delay_frames`** : taille du `LdvBuffer` (az/el par frame_id) pour la
reprojection des clics. Recommande : **50 frames**.

---

## Fichiers concernes

| Fichier | Role |
|--------------------------------------|-----------------------------------------------------|
| `data/zmq/protocol.py` | Ports par defaut + encodage/decodage JSON (source de verite) |
| `data/zmq/zmq_reader.py` | `ZmqFrameReader` : reception frames + ring buffer |
| `data/zmq/zmq_display_bridge.py` | `ZmqDisplayBridge` : annotations + clics |
| `tools/zmq_cpp/` | Sender C++ generique de reference (main.cpp, sender.hpp, display.hpp, json_utils.hpp) |
| `pipeline/builders.py` | `_ZmqLoaderWrapper` + detection `sequence_dir="tcp"` |
| `pipeline/session.py` | Boucle principale : annotations + clics + LDV |
| `pipeline/ego_motion.py` | `LdvBuffer`, `reproject_click_ldv()` |
| `config_examples/F2_zmq_single_csv_headless.yaml` | Scenario headless (rendu C++) |
| `config_examples/F_zmq_single_csv_interactive.yaml` | Scenario interactif (rendu Python) |

---

## Demarrage rapide

```bash
# Terminal 1 : sender C++ generique, mode headless avec affichage
cd tracker/tools/zmq_cpp && make
./sender --video <video.mp4> --csv <meta.csv> --display

# Terminal 2 : pipeline headless
python main.py --config config_examples/F2_zmq_single_csv_headless.yaml
```
Pour un sender sur une machine distante :
```yaml
sequence_dir: "tcp://192.168.1.10"
```

---

## Ports par defaut (`tools/zmq_cpp/args.hpp` et `data/zmq/protocol.py`)

| Port | Usage | Option C++ | Cle YAML |
|-------|--------------------|----------------|----------------|
| 5555 | Canal frames | `--port` | `zmq_port` |
| 5556 | Canal annotations | `--anno-port` | `zmq_anno_port` |
| 5557 | Canal clics | `--click-port` | `zmq_click_port` |

Aucune decouverte dynamique : les valeurs doivent correspondre des deux
cotes.

---

## Ecrire un sender compatible (autre langage / autre capteur)

Resume des contraintes pour un nouveau sender qui doit s'interfacer avec ce
pipeline Python (le contrat de protocole, pas une implementation particuliere) :

| Contrainte | Raison |
|---|---|
| `frame_id` global croissant strict | Synchronisation annotations + reprojection clics |
| Sender **bind**, Python **connect** (PUSH/PULL) | Python peut redemarrer sans redemarrer le sender |
| Message frames multipart `[meta JSON, JPEG]` | Format attendu par `ZmqFrameReader._handle_message` |
| Envoi non-bloquant sur le canal frames | Pas d'accumulation si Python est lent/absent |
| Lire les annotations en polling non-bloquant | Ne pas bloquer la boucle d'envoi de frames |
| `frame_id` du clic = frame affichee | Permet la reprojection LDV cote Python |

**Dependances C++ de reference** : `libzmq >= 4.x` + `cppzmq` (header-only),
`OpenCV >= 4.x` pour `cv::imencode`/`cv::imshow`.
```bash
# Ubuntu
apt install libzmq3-dev
# cppzmq (header-only) : https://github.com/zeromq/cppzmq
```
