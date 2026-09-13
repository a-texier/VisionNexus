# Architecture

Vue d'ensemble de l'app et du tracker qu'elle embarque. Pour le detail module par
module du tracker (classes, fonctions, comment ajouter un composant), voir
[`developer-reference.md`](developer-reference.md). Pour la machine d'etats MOT/SOT
et les objets track, voir [`state-machine.md`](state-machine.md) et
[`track-objects.md`](track-objects.md).

---

## Vue d'ensemble

Inference_App est une app **unifiee** qui enveloppe un tracker generique **MOT/SOT**
(multi-objets + mono-objet cliquable) et le rend pilotable en IHM web + comme noeud
de l'**Orchestrator** (MLOps). Elle fusionne trois roles en un seul bloc (le tracker
est embarque **une seule fois**) :

| Onglet | Role | Sortie |
|--------|------|--------|
| **Tracker** | inference live/headless (SOT operateur, rejeu, benchmark) | video annotee + benchmark |
| **Evaluation** | detection YOLO (`model.val`) + tracker MOT/SOT avec GT | mAP / MOTA / IDF1 (-> MLflow) |
| **Acquisition** | capture un flux -> sauve les images | dataset d'images a annoter |

**Regle metier unifiee** : GT fourni -> metriques (MOTA/IDF1 ou mAP) ; **pas de GT ->
inference + benchmark temps reel seul**. Un seul flux, un seul panneau de resultats.

---

## Stack

- **Backend** : FastAPI (`backend/main.py`), routers par domaine (`session`, `eval`,
  `acquisition`, `export`, `settings`, `orchestrator`).
- **Frontend** : React / TypeScript / Vite (`frontend/src/pages` : `TrackerPage`,
  `EvaluationPage`, `AcquisitionPage`, `DocsPage`).
- **Tracker** : vendored dans `tracker/`, pipeline MOT/SOT Python autonome, pilote
  **in-process** (pas de sous-processus) via `tracker/pipeline/session.run_session()`.

---

## Le tracker vendored

Copie de `VisionNexus_Inference` dans `tracker/`. Le tracker resout ses chemins
contre son propre ROOT -> le backend ajoute simplement `tracker/` a `sys.path`
(`backend/services/tracker_bridge.py`), sans `chdir` ni sous-processus.

**Modifications du code tracker (2 seulement, a ne jamais perdre en resynchronisant
depuis la source vendored)** :
1. `builders.py` -- `record_dir` configurable (rejeu vers le workspace de l'app).
2. **`tracker/__init__.py` supprime** -- ce fichier vide faisait de `Inference_App/tracker`
   un package `tracker` qui **masquait** le sous-package `tracker` de BoT-SORT/BoostTrack
   (`ImportError: BoT-SORT non trouve` depuis le cwd Inference). Le supprimer transforme
   `tracker/` en namespace package et resout le conflit.

`backend/services/tracker_bridge.py` expose :
- `tracker_available()` -- verifie que `config/config.yaml` existe.
- `get_run_session()` / `get_build_loader()` -- imports paresseux (torch/opencv ne
  sont charges qu'au premier lancement).
- `load_base_config()` / `list_scenarios()` / `load_scenario(id)` -- lecture de la
  config de reference et des scenarios prets a l'emploi (`config_examples/*.yaml`).

> **Perimetre important** : `tracker/trackers/` (BoT-SORT, BoostTrack, ByteTrack,
> OSTrack, deep-person-reid, fast_reid, pytracking, YOLOX, TrackEval) est du code
> tiers vendored, chacun avec sa propre doc upstream. Cette documentation ne le
> couvre pas et ne doit pas y faire reference.

---

## Arborescence du tracker

```
tracker/
|
+-- main.py                        Point d'entree standalone : charge YAML -> run_session()
|
+-- pipeline/
|   +-- session.py                 run_session() + _run_loop() (boucle principale)
|   +-- builders.py                Usine de composants (registres MOT/SOT, factory)
|   +-- state_machine.py           Machine d'etats MOT <-> SOT <-> IDLE
|   +-- ego_motion.py              CMC : EgoMotionCompensator, FrameBuffer, LdvBuffer
|   +-- detector/
|   |   +-- detector_mot.py        YOLO (.pt/.onnx/.engine) | TopHat | None | Dummy
|   |   +-- detector_roi.py        TopHat ROI au clic (init SOT)
|   +-- click_handler.py           Mode interactif : souris -> queue SOT (+ record)
|   +-- command_parser.py          Mode command : fichier de clics -> queue SOT
|
+-- trackers/                      VENDORED - hors perimetre de cette doc
|   +-- base_tracker.py            Interface BaseTracker (MOT)
|   +-- mot/{custom_kalman,bytetrack,botsort,boosttrack}/
|   +-- sot/{base_sot,dummy,csrt,tracking_tophat,dimp,ostrack,sam2}/
|
+-- data/
|   +-- rejeu/                     Sources fichiers locaux (format specialise / images / video)
|   +-- network/                   Flux MJPEG reseau (HTTP)
|   +-- zmq/                       Protocole ZMQ generique JSON+JPEG (voir tools/zmq_cpp)
|   +-- sequences/                 Dossier de donnees (sequences format specialise)
|
+-- utils/
|   +-- visualizer.py              Rendu : display | save_video | MJPEG stream
|   +-- stream_server.py           Serveur HTTP MJPEG (pipeline -> PC operateur)
|   +-- metrics/                   Calcul metriques + plots benchmark
|
+-- profiling/                     FrameProfiler par section + rapport HTML
+-- tools/                         Sender/receiver reseau, export ONNX/TensorRT, regen plots
+-- quality/                       quality.py (ruff+pytest+mypy+bandit) + tests
+-- config/                        config.yaml (source de verite, commente parametre par parametre)
+-- config_examples/                Scenarios prets a l'emploi (deltas vs config.yaml)
+-- deploy/{conteneur,natif}/       Scripts de packaging air-gap
+-- cmd_send/                      Fichiers de clics enregistres (mode command)
+-- outputs/run_{date}_{name}/     Cree automatiquement par chaque run
```

---

## Donnees

Chargement des sequences, formats supportes, ajout d'une nouvelle camera,
annotations GT.

### Architecture de la couche donnees

```
data/
+-- rejeu/                     Sources fichiers locaux (rejeu)
|   +-- sequence_loader.py     Loader unifie (interface principale du pipeline)
|   +-- image_reader.py        Lecture bas niveau : format specialise | PNG/JPG | MP4
|   +-- annotation_loader.py   GT : .ver | YOLO .txt | dossier | ""
|   +-- metadata_base.py       Interface ABC MetadataReaderBase
|   +-- convert_format specialise_to_png.py  Outil d'export format specialise -> PNG
|   +-- cameras/
|       +-- __init__.py        CAMERA_REGISTRY + fabrique load_metadata_reader()
|       +-- multi_csv/           MultiCsvMetadataReader (3 CSV)
|       +-- single_csv/        SingleCsvMetadataReader (1 CSV, az/el radians)
+-- network/
|   +-- network_reader.py      NetworkFrameReader (flux MJPEG HTTP, distribue)
+-- zmq/
|   +-- protocol.py            Ports par defaut + encodage/decodage JSON (protocole generique)
|   +-- zmq_reader.py          ZmqFrameReader (PULL, multipart [meta JSON, JPEG])
|   +-- zmq_display_bridge.py  Pont annotations Python->C++ + clics C++->Python
+-- sequences/                 Donnees format specialise + .ver
```

**Regle** : tout ce qui est generique (lecture frame locale, parsing GT) est dans
`data/rejeu/`. Tout ce qui est specifique a une camera (noms de colonnes CSV...)
est **exclusivement** dans `data/rejeu/cameras/<nom>/`. Les flux reseau/temps
reel sont isoles dans `data/network/` (HTTP) et `data/zmq/` (capteur C++). Le
pipeline ne connait que `SequenceLoader` et l'interface `MetadataReaderBase`.

### Formats de sequences supportes

`sequence_dir` dans le YAML accepte :

| Valeur | Mode | Classe |
|---|---|---|
| Dossier `.optional` ou fichier `.optional` | format specialise (optional_format_adapter) | `ImageReader._init_format specialise()` |
| Dossier d'images PNG/JPG | Folder | `ImageReader._init_folder()` |
| Fichier `.mp4 .avi .mov .mkv .m4v` | Video | `ImageReader._init_video()` |
| `http://ip:port/stream` | Flux reseau MJPEG | `NetworkFrameReader` |
| `"tcp"` ou `"tcp://host"` | Flux ZMQ generique JSON+JPEG (`tools/zmq_cpp`) | `ZmqFrameReader` |

**format specialise (MultiCsvCamera)** : format proprietaire optional_format_adapter. Contient les frames IR
brutes + bloc de metadonnees. Lecture via `optional_format_adapter.optional.optional.read_slice(block_id)`.
`slice_size` dans le YAML controle le nombre de frames agregees par bloc
(typiquement 5).

**PNG/JPG / MP4** : `cv2.imread` ou `cv2.VideoCapture`. FPS lu depuis les
metadonnees de la video ou depuis `fps:` dans le YAML. Seek uniquement si
necessaire (lecture sequentielle = pas de seek = optimal).

**Flux reseau MJPEG (pipeline distribue)** :
```yaml
sequence_dir: "http://192.168.1.50:9090/stream"
```
Le noeud de calcul lit les frames depuis le PC hote via HTTP MJPEG.
`NetworkFrameReader` decode les frames dans un thread dedie, reconnexion
automatique. Lancer le PC hote :
```bash
python tools/sender/frame_sender.py --input video.mp4 --fps 10 --port 9090
```
Detail complet du reseau (latences, topologies) : [`deployment.md`](deployment.md#partie-3---reseau--flux-sortant-et-entrant-http-mjpeg).

**Flux ZMQ generique (capteur temps reel, `tools/zmq_cpp` comme reference)** :
```yaml
sequence_dir:          "tcp"    # "tcp://192.168.1.10" pour hote distant
zmq_port:              5555     # doit correspondre a --port cote sender
zmq_recv_timeout_ms:   5000
zmq_ring_size:         10       # ring buffer Python : N dernieres frames gardees
zmq_catchup_threshold: 2.0      # recalage auto si ecart inter-frame_id > seuil
```
`ZmqFrameReader` recoit un message multipart `[meta JSON, JPEG]` depuis un
sender C++ (PUSH bind cote sender, PULL connect cote Python). Le meta JSON
`{"az","el","chh","frame_id"}` transmet l'azimut/elevation (radians) et le FOV
horizontal (degres) ; ils sont convertis en degres et transmis comme LDV au
pipeline (roulis toujours 0.0, non fourni par ce protocole generique).

Aucune decouverte dynamique de port : `zmq_port`/`zmq_anno_port`/`zmq_click_port`
doivent correspondre aux options `--port`/`--anno-port`/`--click-port` cote
C++. Ring buffer (drop oldest, keep newest) : Python maintient un ring buffer
de `zmq_ring_size` frames ; si Python est lent, les frames les plus anciennes
sont silencieusement ecrasees ; au demarrage, un startup drain vide le ring
buffer pour partir des frames recentes. Recalage automatique :
`_ZmqLoaderWrapper` surveille l'ecart entre `frame_id` successifs (fenetre de
5 frames), saute des frames via `drain()` si l'ecart moyen depasse
`zmq_catchup_threshold`. Detail complet du protocole : [`zmq_integration.md`](zmq_integration.md).

Dependance Python : `pip install pyzmq`. Protocole binaire complet, tuning des
parametres, diagrammes : [`zmq_integration.md`](zmq_integration.md).

### Formats d'annotations GT

`annotation_file` est detecte automatiquement par `annotation_loader.py` :

| Extension / Type | Format | Detail |
|---|---|---|
| `.ver` | format texte historique | `frame_id track_id x1 y1 x2 y2 score class` |
| `.txt` (6 colonnes) | YOLO fusionne | `frame_id class cx cy w h` (normalise) |
| `.txt` (5 colonnes) | YOLO frame unique | `class cx cy w h` (normalise, 1 seule frame) |
| Dossier de `.txt` | YOLO ultralytics | 1 fichier par frame, nomme `000001.txt` |
| `""` (vide) | Pas de GT | Metriques non calculees |

Format dossier YOLO ultralytics :
```
annotations/
  000001.txt   ->  0 0.512 0.341 0.048 0.062   (class cx cy w h)
  000002.txt   ->  0 0.498 0.355 0.051 0.059
```
Le numero dans le nom de fichier = `frame_idx` (sequentiel 0, 1, 2...).

### Interface camera

Chaque camera expose deux methodes via `MetadataReaderBase` :

```python
class MetadataReaderBase(ABC):

    @abstractmethod
    def get_ldv_series(self) -> Dict[int, Tuple[float, float]]:
        """
        LDV (Line-of-sight Data Vector) : azimut + elevation par frame.
        Retourne {frame_idx: (az_deg, el_deg)}.
        frame_idx est sequentiel 0, 1, 2... (tout identifiant interne resolu ici).
        """

    @abstractmethod
    def get_camera_info(self) -> Dict:
        """
        Informations de la camera.
        Retourne {"fps": float, "width": int, "height": int, "chh_deg": float}
        "chv_deg" optionnel (0.0 si indisponible - non utilise par le pipeline).
        width/height peuvent etre 0 : le pipeline deduit de la 1ere frame.
        fps peut etre 0.0 : le pipeline utilise alors fps: du YAML.
        """
```

**Camera MultiCsv** (`camera_name: "multi_csv"`) -- 3 CSV requis (auto-decouverts
dans le dossier sequence par suffixe) :

| Suffixe fichier | Contenu |
|---|---|
| `*_BlockID_NumIm.csv` | Mapping interne `block_id <-> num_image` |
| `*_INFO_VID_IR.csv` | FPS, resolution, exposition |
| `*_POINTAGECAM_IR.csv` | Azimut/elevation par `block_id` |

Le `block_id` est un artefact interne MultiCsv resolu en `frame_idx` dans
`MultiCsvMetadataReader.get_ldv_series()`. Il n'est jamais expose au pipeline.
Usage H LDV : `H = K . R(az_t->t-1, el_t->t-1) . K^-1`, transmis aux trackers via
`camera_update(H)` (Methode B -- etats Kalman uniquement, voir
[`algorithms.md`](algorithms.md#14-cycle-par-frame-methode-b)).

**Camera SingleCsv** (`camera_name: "single_csv"`) -- 1 CSV requis
(auto-decouvert dans le dossier sequence, ou specifie dans `metadata_csv`) :

| Colonne | Contenu |
|---|---|
| `delta_ms` | Temps ecoule depuis la 1ere frame (ms) - sert a calculer le FPS |
| `ts` | Horodatage absolu (non utilise par le pipeline) |
| `az` | Azimut en radians -> converti en degres |
| `el` | Elevation en radians -> convertie en degres |
| `fov_deg_0` | FOV horizontal IR (degres) |
| `fov_deg_1` | FOV horizontal TV (degres) |
| `focus_m_0/1` | Distance de mise au point (non utilisee) |

Selection du FOV selon le nom du fichier CSV : `"TV"` dans le nom -> `fov_deg_1` ;
`"IR"` dans le nom (ou autre) -> `fov_deg_0`. Le reader ne fournit pas
`width`/`height` (retournes a 0, le pipeline deduit de la 1ere frame video) ni
`chv_deg` (retourne a 0.0, non utilise).

```yaml
sequence_dir: "/data/sequences/IR_fixed.mp4"
camera_name:  "single_csv"
metadata_csv: ["/data/sequences/IR_fixed.csv"]   # ou [] pour auto-decouverte
```

### Conversion format specialise -> PNG

```bash
python data/rejeu/convert_format specialise_to_png.py --input data/sequences/ma_seq.optional --output ma_seq_png/
```
Exporte toutes les frames d'un format specialise en PNG nommes `000001.png`, `000002.png`...

### Ajouter une nouvelle camera

Voir [`developer-reference.md`](developer-reference.md#nouvelle-camera).

---

## Fonctionnement d'une session (`run_session`)

```
main.py (standalone) ou backend/services/tracker_bridge.get_run_session() (app)
  load_yaml(cfg) / cfg deja construit par l'app
  mkdir outputs/run_{ts}_{name}_{mot}_{sot}/
  session.run_session(cfg, run_dir)
      |
      +-- INIT composants (builders.py)
      |     detector = build_detector_mot(cfg)       YOLO | TopHat | None | Dummy
      |     detector.warmup()                        chargement YOLO avant ZMQ
      |     loader   = build_loader(cfg)              format specialise|images|MP4|HTTP|tcp (ZMQ)
      |     compensator = EgoMotionCompensator()      gere HFOV/VFOV dynamiques
      |
      |     mot_tracker, sot_tracker, sot_tracker2 = build_trackers(cfg)
      |         (sot_tracker2 si n_targets >= 2)
      |
      |     roi_detector = build_detector_roi(cfg)    TopHatROI | None
      |     state_machine = TrackerStateMachine(mot_tracker, sot_tracker, sot_tracker2, ...)
      |     click_handler, command_parser = build_input_handler(cfg)
      |     frame_buffer = FrameBuffer(max_delay)     reprojection clics retardes
      |     ldv_buffer   = LdvBuffer(max_delay)        id.
      |     gt           = load_ground_truth(cfg)      .ver | YOLO .txt | dossier
      |     viz          = build_visualizer(cfg)        None si bench-only
      |     profiler     = build_profiler(cfg)          NullProfiler si desactive
      |
      +-- BOUCLE PRINCIPALE _run_loop()
            for frame_id, frame, meta in loader:
              +-- [frame_load]   frame_buffer.push() + ldv_buffer.push() + FOV
              +-- [detect_mot]   detection si state_machine.should_run_mot_detection()
              +-- [ldv_cmc]      H_ldv = compensator.build_homography(ldv_prev, ldv_cur)
              +-- [image_cmc]    H_img = ORB|ECC si niveaux 1/2 inactifs
              |   Chaine CMC 4 niveaux : H_ldv > interne tracker > H_image > None
              +-- [clics]        click_handler | display_bridge (ZMQ) | command_parser
              +-- [mot/sot]      tracks = state_machine.update(frame, frame_id, dets, H)
              +-- [render]       viz.render(...) -> imshow | VideoWriter | MJPEGServer
              +-- profiler.end_frame()
      |
      +-- FIN DE SESSION
            profiler.generate_report(fps_wall)  -> profiling.html
            detector.close() + loader.close()
            compute_metrics()  -> {mot: {...}, sot: {...}, sot2: {...}, global: ...}
            write_benchmark()  -> benchmark/benchmark.json + plot/ + html/ + metrics_dashboard.html
            return benchmark   -> consomme par backend/services/session_manager.py
```

Detail complet de chaque etape (builders, machine d'etats, CMC, comment ajouter un
tracker/une camera/un detecteur) : [`developer-reference.md`](developer-reference.md).

**Separations FPS :**
- `fps_proc` : FPS pipeline seul (loader format specialise exclu) = base du benchmark.
- `fps_total` : FPS total avec lecture loader = taux reel de la sequence.

**Metriques separees par mode :** `mot` (frames hors-SOT), `sot` (frames SOT, cible
1), `sot2` (frames SOT, cible 2 si `n_targets >= 2`).

---

## Lancer en CLI (standalone, hors app web)

Le tracker vendore peut tourner seul, hors de l'app web, utile pour du dev/debug
ou des campagnes de benchmark. Se placer dans `tracker/` avant toute commande :

```bash
python main.py --config config_examples/<fichier>.yaml
```

`config_examples/` contient des scenarios prets a l'emploi qui surchargent
`config/config.yaml` (base commune) sur quelques cles seulement : un MOT+SOT
interactif (ex. `mot_sot_interactive_light.yaml`), un SOT seul (`sot_solo_*.yaml`),
et des scenarios reseau distribues PC hote/noeud de calcul/PC operateur
(`distributed_pc_*.yaml`).

Reference complete de **tous** les parametres YAML : `tracker/config/config.yaml`
(chaque parametre y est commente en detail).

---

## API backend (prefixe `/api`)

**Session live** (`routers/session.py`) -- pilote `run_session` + proxifie le pont
MJPEG interne : `/scenarios`, `/config-schema`, `/sources`,
`/session/start|{id}/stop|status`, `/session/{id}/stream|info|click|key|record`,
`/replays`, `/replays/upload` (fichier `.txt` cmd_send).

**Evaluation** (`routers/eval.py`) : `/eval/detection`, `/eval/tracker`,
`/eval/sources`, `/evals`, `/eval/{id}`, `/eval/{id}/artifacts|artifact/{name}`.
Fenetre `[start_frame, stop_frame]` = "retest sur la zone".

**Acquisition** (`routers/acquisition.py`, mode **FREE**) : `/acquire` (source =
`.optional` / dossier / video / `http://host/stream` MJPEG / `tcp[://host]` ZMQ),
`/acquire/{id}/stop|status`, `/acquisitions`, `/acquisitions/datasets`. Sauve des
PNG 8-bit normalises dans `acquisitions/<nom>/` + `acquisition.json`.

**Export / deploiement** (`routers/export.py`) : `/export/model` (ONNX/TensorRT),
`/export/tracker-zip` (zip autonome via `export_zip.py`), `/export/info` (ou vont
les fichiers), `/deploy/build` (standalone conda-pack / conteneur Podman, cible
x86_64 avec GPU NVIDIA via WSL). Detail complet : [`deployment.md`](deployment.md).

**Reglages** (`routers/settings.py`) : `/settings` GET/PUT (workspace
`user_settings.json` : metriques, detection, tracker, export, rendu, mlflow) +
`/workspace/history`.

**Orchestrateur** (`routers/orchestrator.py`) -- endpoints deterministes du noeud
pipeline : `/orchestrator/infer`, `/orchestrator/evaluate`, `/orchestrator/acquire`.
Tous acceptent un bloc `trace = {graph_id, node_id, node_label}` -> nom de run
MLflow **deterministe `{graphe}/{noeud}`** + tags.

---

## Noeud Orchestrator -- FREE / LOCKED

Un seul noeud `inference` (unifie), avec la meme semantique FREE/LOCKED que
explorer/Annotation :

- **FREE** (aucune arete entrante) -> **acquisition** : capture un flux et
  **produit un dataset d'images** -> importable dans Dataset Explorer et Annotation
  (chemin serveur) pour fine-tuner.
- **LOCKED** (arete entrante) -> **eval / inference** selon `data.task`
  (`track` / `eval_tracker` / `eval_detection`). `model_path` vide -> `best.pt` du
  training le plus recent.

Boucle type : `Inference (FREE, acquisition) -> Annotation -> explorer ->
Training/fine-tune -> Inference (LOCKED, retest sur la zone)`.

**Auto-log MLflow** : chaque run (infer/eval) est logue dans le store
**serverless** du workspace (`mlflow_<user>/mlflow_data/mlflow.db`, sans serveur ni
port), lu par le MLflow_App.

---

## Cibles et environnement

Env = **IA_env** (torch 2.5.x avec CUDA 12.x, ultralytics, pyzmq, lapx, trackers
vendored...). Lancement via **VisionNexus** (tuile "Inference / Eval").
Deploiement embarque : **x86_64 avec GPU NVIDIA recent** (Ubuntu 22.04, build via
WSL sur Windows) -- pas de chemin Jetson/aarch64 pour l'app deployee (le tracker
vendored cite historiquement Jetson Orin Nano dans ses docs internes, voir
[`developer-reference.md`](developer-reference.md) ; la cible de deploiement
actuelle de l'app est x86_64 generique, voir [`deployment.md`](deployment.md)).

Detail des dependances (versions exactes) et de la fiche materiel de reference :
documentation interne de developpement (non publiee).
