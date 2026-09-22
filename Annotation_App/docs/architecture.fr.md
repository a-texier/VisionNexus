*[Read in English](architecture.md)*

# Architecture

Vue d'ensemble du backend, du frontend et des flux de donnees de l'Annotation App.
Pour les commandes de lancement et la liste des invariants a ne jamais violer, voir le
[README.md](../README.md) a la racine de l'app. Pour la navigation fichier par fichier
et le debug, voir [code-navigation.md](code-navigation.md).

---

## Domaine

### Types de projets

| Valeur DB | Label UI        | Description                                   |
|-----------|------------------|------------------------------------------------|
| `image`   | Image Random     | Jeu d'images non-sequentielles                  |
| `video`   | Sequence Image   | Video .mp4, dossier d'images, ou fichier .optional   |

L'onglet **Tracks** n'est visible qu'en mode `video` (Sequence Image).

### Multi-sequence

Un projet peut contenir **plusieurs sequences** (dossiers d'images, MP4, format specialise melanges).

- Table `sequence` (`backend/models/sequence.py`) : une sequence = une source importee.
  Champs : `name`, `source_type` ('images'|'video'|'format specialise'), `source_path`,
  `start_index` (frame_index global de la 1re frame), `frame_count`, `fps`.
- `Frame.sequence_id` (nullable, NULL = frames importees avant le multi-sequence,
  exposees comme pseudo-sequence "Sequence principale").
- Chaque import **ajoute** ses frames a la suite (`frame_index += project.frame_count`)
  avec un prefixe de fichier unique `s{seq_id:03d}_` (evite les collisions
  `frame_000000.jpg` entre imports).
- La resolution de source (extraction on-demand, PNG format specialise, tracking) passe par
  `frame.sequence.source_path` avec repli sur `project.source_path` (legacy) :
  `_resolve_sequence_source()` dans dataset.py, `_resolve_frame_image_path()` dans tracking.py.
- `GET /api/projects/{id}/sequences` : liste avec stats (frames annotees, nb annotations).
- `GET /api/projects` inclut aussi un resume `sequences[]` par projet (page d'accueil).
- Frontend : liste deroulante de sequences a gauche du slider (AnnotationPage), la
  selection navigue au `start_index` de la sequence.
- Le slider et les boutons prev/next sont **relatifs a la sequence active** : quand un
  projet a des sequences, ils couvrent uniquement la plage `[start_index, start_index+count)`
  de la sequence active (affiche `frame locale / count`), pas l'espace global. Sans ca,
  choisir seq2 semblait "bloque" car le slider restait sur 0 -> total.

### Import (ImportModal) - sources supportees

**ImportModal = panneau unifie multi-sequences** : une liste de "slots", chaque slot
accepte SOIT un glisser-depose (fichiers/dossier -> upload navigateur, le navigateur
ne transmet jamais un chemin, seulement le contenu), SOIT un chemin serveur tape en dur
ou choisi au FileBrowserModal (zero copie). Un slot rempli fait apparaitre un slot vierge.
Type auto-detecte a l'extension : dossier images / `.mp4 .avi .mov .mkv` / `.optional`.
Chaque slot a un champ **Nom sequence** (auto = nom du dossier/fichier ; ce nom est
`Sequence.name` et se retrouve TEL QUEL a l'export : sous-dossier `{nom}-yolo/` ou
fichier `{nom}.ver`).

**Import non-bloquant** (`stores/importStore.ts`) : "Importer en fond" empile les slots
dans `importStore.startImport()` puis ferme le modal, l'utilisateur annote pendant que
les sequences chargent. La boucle est **serie** (le backend lit `project.frame_count` a
la creation de chaque sequence, deux imports concurrents entreraient en collision
d'index) mais detachee du cycle de vie du modal. AnnotationPage affiche une barre de
progression par sequence (bandeau bleu) depuis `importStore.jobs` et rafraichit
frames/sequences apres chacune (`onSequenceDone`).

**Stockage physique des frames** : `data/projects/{id}/frames/` avec prefixe
`s{seq_id:03d}_` par sequence (anti-collision). Les fichiers restent a plat mais
`Frame.sequence_id` + `Sequence.name` portent l'appartenance. C'est le nom de sequence
(pas le prefixe fichier) qui structure l'export en sous-dossiers/fichiers par sequence.

**`frames_preview/`** : cache de vignettes JPEG 480 px (qualite 70, ~15 Ko) generees a
la volee par `serve_frame_image(preview=1)`. Servent uniquement pendant le scrubbing du
slider et la propagation (images legeres = defilement fluide en SSH), jamais pour
l'annotation fine (le canvas repasse en pleine resolution au relache du slider). Purger
ce dossier est sans risque (regenere au besoin). Idem `frames_8bit/` (cache 8 bits des
sources 16 bits).

#### Provenance serveur (zero copie source)

- **MP4 serveur** : scan lazy (metadonnees) + extraction complete en arriere-plan -> JPEG
  dans `data/projects/{id}/frames/`. Barre de progression, redirection apres "MP4 en
  frames converti - OK".
- **format specialise serveur** : conversion complete format specialise -> PNG dans `{format specialise_dir}/{format specialise_stem}_png/` (a cote
  du fichier .optional, jamais dans data/). Barre de progression, meme comportement que MP4.
  Export peut symlinker directement vers ces PNG.
- **Dossier images serveur** : symlink par defaut (zero copie), ou copie. Import incremental
  par batch. Aucune miniature generee (notion supprimee).
- Tout import cree une **Sequence** ; les frames sont ajoutees a la suite du projet
  (multi-sequence).

#### Provenance locale (upload)

- **MP4 upload** : chunks HTTP -> JPEG extraction. Meme barre de progression.
- **format specialise upload** : sauvegarde dans `data/projects/{id}/`, conversion vers PNG dans
  `data/projects/{id}/{stem}_png/`.
- **Images upload** : multipart batch.

#### Format format specialise

- Header 128 bytes : `n_img`, `n_row`, `n_col`, `n_bits_pix`, `type_img`. Frames a taille
  fixe -> seek O(1).
- `load_format specialise(path, seq_range=(i, i+1))` dans `backend/utils/format specialise.py`.
- Ne jamais servir a la volee (trop lent sur 4K) : toujours convertir en PNG d'abord.
- Le dossier PNG est cree a cote de l'format specialise : `{parent}/{stem}_png/frame_000000.png`.
- `dataset_service.scan_format specialise_for_png_extraction()` prepare les records (tous `is_extracted=False`).
- L'extraction PNG en arriere-plan ne genere plus aucune thumbnail (notion supprimee).
- `_format specialise_png_dir(format specialise_path)` dans `dataset.py` calcule le chemin du dossier PNG.
- `serve_frame_image` : si `is_extracted=True` et frame absente du dossier frames standard,
  cherche dans `_format specialise_png_dir(source_path)`.
- **Outil de conversion MP4 -> format specialise** : `POST /api/convert/video_to_format specialise` (tache async).
  Disponible dans l'UI en bouton optionnel "Convertir en format specialise" sur les chemins MP4 serveur.

### Images 16 bits (RGB ou IR)

- Support natif des dossiers d'images 16 bits (PNG/TIFF) : conversion **3-sigma -> 8 bits**
  centralisee dans `backend/utils/image_utils.py` (`to_8bit_3sigma`, `load_image_bgr_8bit`,
  `load_image_rgb`).
- Visuel : `serve_frame_image` sert une version 8 bits JPEG mise en cache dans
  `data/projects/{id}/frames_8bit/` (source 16 bits jamais modifiee).
- Tracking/IA : tous les chargeurs (SAM2, SAM3, Grounding DINO, homographie, flux optique,
  SAMURAI tmp frames) passent par `load_image_bgr_8bit`/`load_image_rgb`, jamais `cv2.imread`
  direct.
- format specialise 16 bits : `_format specialise_frame_to_bgr` applique aussi le 3-sigma.
- **LUT d'affichage reglable** (`image_utils.apply_lut`, modes `sigma`/`minmax`/`manual`) :
  persistee PAR PROJET (`project.lut_json`) ET PAR SEQUENCE (`sequence.lut_json`, prioritaire,
  IR vs RGB dans un meme projet). Resolution par frame : `dataset._frame_lut` (sequence -> projet).
  Endpoints : `GET/PUT /api/projects/{id}/lut`, `PUT/DELETE /api/sequences/{id}/lut`,
  histogramme brut `GET /api/frames/{id}/histogram`. La signature LUT (`lut_signature`) est
  incluse dans les noms de cache (`frames_8bit/`, `frames_preview/`, `frames_format specialise_cache/`)
  pour une invalidation propre.
- **LUT sur le chemin IA** : le tracking guide bake la LUT effective de la frame dans l'entree
  du detecteur (`_ai_input_path` -> `ensure_8bit_cached`, cache `frames_ai_lut/`) -> GD/SAM3/YOLO
  voient la MEME image que l'utilisateur. UI : `LutPanel` (bouton flottant) avec selecteur de
  portee Projet/Sequence.

---

## Backend (FastAPI + SQLite)

`backend/main.py` orchestre tout : lifespan cree les tables, migre le schema, charge SAM2.
CORS autorise `:5173`. Fichiers statiques servis a `/media`.

**Routers** (`backend/models/routers/`), un fichier par domaine, toutes les routes prefixees
`/api/` :

- `projects.py` : CRUD projets + classes + session. **Suppression en cascade manuelle**
  (annotations -> frames -> tracks -> classes -> session -> projet).
- `dataset.py` : upload multipart images / import video / format specialise + import dossier incremental +
  frames sparse + sequences (multi-sequence). Plus de generation de thumbnails.
- `annotation.py` : CRUD annotations, bulk replace, NMS (`POST /api/frames/{id}/annotations/nms`),
  copie inter-frames, detection overlaps, interpolation.
- `tracking.py` : ByteTrack run, CRUD tracks, merge tracks, propagation homographique et flux
  optique. Tracking guide (`guided-tracking/run`) : `algorithm` parmi `grounding_dino | sam3 | yolo`.
  **YOLO custom** = modele `.pt` local (chemin `settings.algorithms.yolo_model_path`, resolu vs
  workspace) utilise comme detecteur en mode tracking : conf BASSE + matching centroide vers les
  cibles -> les fausses alarmes sans cible proche sont ecartees. Service `yolo_service.py`
  (ultralytics, cache modele par chemin). Statut : `GET /api/yolo/status`. Pas de prompt texte
  pour YOLO.
- `sam.py` : SAM2 point prediction, text prediction (Grounding DINO), SAM3 text prediction,
  WebSocket streaming.
- `export.py` : export en tache async. Trois formats (`output_format`) :
  - `yolo` : multi-sequence -> un sous-dossier `{sequence}-yolo/` par sequence annotee dans le
    dossier projet (ZIP unique du parent si copie) ; projet mono-sequence -> YOLO a plat.
    YOLO-seg (`seg_labels/` + `seg_data.yaml`) genere EN PLUS des qu'il y a des polygones.
  - `coco` : layout COCO standard `{sequence}-coco/` (mono-seq a plat) : `images/{train,val,test}/`
    + `annotations/instances_{split}.json`. bbox PIXELS `[x,y,w,h]`, `category_id` 1-based
    (= class_index+1), `segmentation` (polygones pixels) incluse, `track_id` en extra.
    Implemente par `dataset_service.export_coco_dataset` (partage `_place_image` avec YOLO).
  - `ver` : un fichier `{sequence}.ver` par sequence, format texte natif a 10 colonnes :
    `frame_id(1-based) visibility x1 y1 x2 y2 track_id classe sous-classe nom`
    (coordonnees pixels, track_id = track_uid persistant).

**Services** (`backend/services/`), tous singletons :

- `sam_service.py` : SAM2 image/video predictor + auto mask generator. GPU detecte a l'import ;
  fallback `tiny` sur CPU. Checkpoint requis : `backend/checkpoints/sam2.1_hiera_small.pt`
  (ou tiny).
- `grounding_service.py` : Grounding DINO (`IDEA-Research/grounding-dino-tiny`) + pipeline SAM2.
  Telechargement auto HuggingFace (~340 MB). Fallback gracieux si transformers absent.
- `sam3_service.py` : SAM3 (modele autonome texte -> masques).
- `tracker_service.py` : ByteTrack avec mapping stable `bytetrack_id -> project_track_id`.
- `homography_service.py` : XFeat (GPU) ou SIFT+RANSAC (CPU) via `compute_homography()`. Flux
  optique Lucas-Kanade via `track_bboxes_optical_flow()` (params : `win_size`, `max_level`,
  `min_tracked_pts`). Retourne `None` si ratio inliers < 0.3.
- `dataset_service.py` : extraction frames video, import dossier lazy, export YOLO/COCO. Prefixe
  de fichiers par sequence (`filename_prefix`). Aucune generation de thumbnail.
- `settings_service.py` : lecture/ecriture de `data/settings.json` (settings utilisateur).
- `interpolation_service.py` : interpolation lineaire entre keyframes.
- `yolo_service.py` : chargement/cache d'un modele YOLO `.pt` custom pour le tracking guide.
- `task_registry.py` : registre des taches async (export, import, tracking) + logs par tache.

**Models** (`backend/models/`) : SQLModel (Pydantic + SQLAlchemy).

- Invariant central : **toutes les coordonnees normalisees `[0, 1]`** (format YOLO :
  `cx cy w h`). Conversion pixel uniquement cote canvas frontend.
- `Annotation.points` : polygone serialise en JSON string.
- `Annotation.source_algorithm` : `'manual' | 'sam_point' | 'sam_auto' | 'grounding_dino' |
  'guided_tracking' | 'sam2_tracking' | 'interpolation' | null`.
- `LabelClass` : hierarchie 3 niveaux : `name` (classe/detection, obligatoire), `subclass`
  (reconnaissance), `subsubclass` (identification). Ex : drone > quadcoptere > mavic.
  `full_name` (property) = jointure par `_`, utilisee dans data.yaml a l'export YOLO.
- `Sequence` : source d'import (multi-sequence), voir section dediee plus haut.

**Table `annotation`, champs cles :**

| Colonne             | Type   | Description                                                   |
|----------------------|--------|-----------------------------------------------------------------|
| `cx, cy, w, h`       | float  | Coordonnees YOLO normalisees [0,1]. Jamais de pixels en DB.    |
| `points`             | string | JSON `[[x1,y1],[x2,y2],...]` (polygone). Null pour bbox.       |
| `is_auto`            | bool   | Generee par IA (SAM, GD, SAM3, tracking guide, ...)            |
| `source_algorithm`   | string | Voir liste ci-dessus.                                          |
| `confidence`         | float  | Score [0,1]. 1.0 = annotation manuelle.                        |
| `track_id`           | int    | FK vers Track (nullable, null = pas de tracking).               |

**Database** : SQLite a `data/annotation.db`, mode WAL, foreign keys ON.

**Migrations** : `_run_migrations()` dans `main.py` ajoute les colonnes manquantes via
`ALTER TABLE` sans recreer les tables.

---

## Frontend (React + TypeScript + Konva.js)

**Routing** : React Router v6, deux routes principales : `/` (ProjectsPage) et
`/projects/:projectId/annotate` (AnnotationPage).

**State management** : stores Zustand :

- `annotationStore.ts` : annotations courantes, outil actif, undo/redo (50 snapshots JSON),
  clipboard, dessin en cours. `loadAnnotations(frameId, annotations)` : `frameId` en **premier**
  argument. `clearAnnotations()` : a appeler au changement de projet pour isoler les donnees.
  `deleteAllAnnotations()` : supprime toutes les annotations de la frame courante via
  `DELETE /api/frames/{id}/annotations/all`.
- `projectStore.ts` : liste projets, frames, `currentFrameIndex`, session persistence.
- `samStore.ts` : state machine WebSocket (DISCONNECTED -> CONNECTING -> SESSION_READY ->
  PROPAGATING), masques streames, points SAM en attente.
- `uiStore.ts` : zoom/offset canvas, onglet sidebar, modals, mode review.
  `zoomToAnnotation(cx, cy, w, h, imgW, imgH, containerW, containerH)` : zoom et centre le canvas
  sur une annotation.
- `settingsStore.ts` : settings utilisateur, charges async au demarrage (voir pattern async
  dans [code-navigation.md](code-navigation.md)).
- `importStore.ts` : file d'imports en fond (multi-sequence), voir section Import plus haut.

**Timeline** (`components/timeline/Timeline.tsx`), **sans vignettes** (supprimees, trop
couteuses) :

- Cellules compactes virtualisees : vert = frame annotee (avec compteur), rouge = frame vide.
- Le compteur de la frame courante est branche en direct sur `annotationStore`
  (`currentFrameId` + `annotations.length`) : mise a jour instantanee sans reload.
- Ctrl/clic selection, Shift/clic plage, **Ctrl+A** (quand la timeline est survolee) tout
  selectionner, Echap deselectionne, Suppr efface les annotations selectionnees.
- La suppression multi-frames passe par `POST /api/projects/{id}/annotations/delete-frames`
  (body `{frame_ids}`) : UNE transaction (un DELETE en masse + un recompte + un commit) au lieu
  de N appels `DELETE /frames/{id}/annotations/all` (chacun recomptait tout le projet + fsync,
  ~0,5 s/frame). La timeline passe des **frame_index** (pas des positions tableau) ->
  `handleDeleteAnnotationsForFrames` resout par `frame.frame_index`.

**Auto-save** (`hooks/useAutoSave.ts`) : session + backup JSON toutes les 2 min, totalement
silencieux (aucun toast, aucun log).

**GZip** : `GZipMiddleware` dans `backend/main.py` (min 1 Ko) : reponses JSON compressees
~10x, essentiel en usage distant SSH.

**Performance navigation :**

- `vite.config.ts` : proxy vers `127.0.0.1` et jamais `localhost`, sur Windows Node tente
  d'abord ::1 (IPv6) alors qu'uvicorn n'ecoute qu'en IPv4, d'ou ~200 ms de penalite sur chaque
  requete proxifiee.
- `GET /api/frames/{id}/image?preview=1` : JPEG 480 px qualite 70 (~15 Ko), genere a la volee
  et mis en cache dans `data/projects/{id}/frames_preview/`. Utilise par AnnotationPage pendant
  le scrubbing du slider (`isScrubbing`) + prefetch +-6 frames.
- `projectStore.fetchFrames` auto-pagine (boucle tant que la page est pleine, limit 10000) :
  sans ca, un projet de 21000 frames n'en chargeait que 10000.
- SQLite : `busy_timeout=30000` + `timeout=30` connect_arg + `synchronous=NORMAL` (sinon
  "database is locked" quand un import ecrit pendant un `get_project`).

**Taches d'arriere-plan :** une tache lancee via `background_tasks.add_task` qui fait du calcul
lourd (OpenCV, XFeat, torch) doit etre une fonction **synchrone** (`def`, executee dans le
threadpool) ou faire des `await` reguliers. Une `async def` sans `await` bloque la boucle
d'evenements : plus aucune requete servie pendant le run (polling fige, timeouts, stop
impossible). Toutes les boucles de tracking verifient `is_stop_requested(task_id)`, y compris
pendant la phase de preparation SAM2, et marquent `frame.is_annotated = True` sur chaque frame
ou elles creent des annotations (stats sequences, exports).

**Canvas** (`components/canvas/`) : Stage Konva.js avec trois layers :

1. Background image (KonvaImage)
2. Annotations (BBoxShape avec Transformer, PolygonShape)
3. Interaction overlay (dessin en cours, points SAM, masques streames)

Conversion coordonnees : `stageToImageNormalized()` dans AnnotationCanvas -> `[0,1]`.
`yoloToPixel()` / `pixelToYolo()` dans `utils/coordinates.ts`.

**API client** (`services/api.ts`) : axios type avec intercepteur toast. Namespaces :
`projectsAPI`, `datasetAPI`, `annotationsAPI`, `samAPI`, `trackingAPI`, `exportAPI`, `taskAPI`,
`backupAPI`. `annotationsAPI.applyNMS(frameId, iouThreshold)` -> `POST /api/frames/{id}/annotations/nms`.

**WebSocket** (`services/websocket.ts`) : classe generique `AnnotationWebSocket<TMessage>` avec
auto-reconnect. Utilisee par samStore pour l'auto-segmentation image et la propagation video.

**Sidebar** (`components/sidebar/Sidebar.tsx`) :

- Recoit `projectType` prop, affiche l'onglet Tracks seulement si `projectType === 'video'`.
- Passe `onDeleteAllAnnotations` et `onApplyNMS` a `AnnotationList`.

**Cibles de tracking partagees** : les 4 onglets (SAMURAI, Detect, Homogr., Flux opt.)
utilisent le MEME set `trackingTargetIds` (annotationStore). Le double-clic sur une bbox dans le
canvas (`onDblClick={toggleTrackingTarget}`) coche/decoche donc la cible dans tous les onglets a
la fois. Ne jamais reintroduire de sets locaux par onglet.

**Console de logs algo** (bas du TrackPanel, remplace l'ancienne liste visuelle de tracks) :

- `task_registry.append_log(task_id, line)` accumule les lignes (anneau 300, print defensif
  cp1252) ; `GET /api/tasks/{id}/logs?since=N` renvoie `{lines, next}` incremental.
- Le TrackPanel poll ces logs (700 ms) et les affiche : ligne `$ ...` = commande synthetique
  (algo, cibles, frames, device), reste = avancement temps reel (memes lignes que le terminal).

**TrackPanel** (`components/sidebar/TrackPanel.tsx`), 4 onglets + file anomalies :

- **SAMURAI** (onglet par defaut, en premier) : SAM2 video tracking. SAMURAI ne suit qu'**une**
  cible (filtre de Kalman a etat unique porte par le modele) : avec >1 cible,
  `sam_service.configure_video_tracking(n)` bascule en **SAM2 multi-objets natif**
  (`samurai_mode=False`) et reinitialise l'etat Kalman ; sinon SAMURAI mono-cible. Sans ca :
  `RuntimeError: Boolean value of Tensor with more than one value is ambiguous`. Prompt = **box
  englobante** de chaque cible via `add_video_prompt(box=...)`. Session video
  `init_state(async_loading_frames=True)` : la propagation demarre sans attendre le chargement
  complet ; preparation PNG->JPEG parallelisee (ThreadPoolExecutor). Session fermee en `finally`
  (`close_video_session`), sinon fuite VRAM. Logs serveur `[SAM2Track]`.
- **Detect.** : Tracking guide GD/SAM3 + matching centroide.
- **Homogr.** : Propagation par homographie XFeat/SIFT via `compute_homography()`. Params :
  `xfeat_top_k`, `xfeat_min_cossim`, `ransac_threshold`, `min_inlier_count`, `min_inlier_ratio`.
  Passe `use_optical_flow: false`.
- **Flux opt.** : Propagation par flux optique Lucas-Kanade via `track_bboxes_optical_flow()`.
  Params : `optflow_win_size`, `optflow_max_level`, `optflow_min_pts`. Passe
  `use_optical_flow: true`. Ideal pour objets en mouvement (vehicules, personnes).
- **File anomalies** : visible directement dans Tracks apres un run guide, avec navigation,
  bouton `Resolu frame` et touche `R`.
- ReID ResNet supprime (UI + endpoints backend + service). ByteTrack supprime de l'UI (API
  backend conservee pour compatibilite).
- Les onglets Homogr. et Flux opt. appellent le meme endpoint
  `POST /api/projects/{id}/homography/propagate` avec le param `use_optical_flow`.
- Propagation tasks affichent une barre verte dans AnnotationPage via le callback
  `onPropagationStarted(taskId, label)`.
- Le registre de taches expose `current_frame_id` pour la navigation temps reel pendant la
  propagation.

**AnnotationList** (`components/sidebar/AnnotationList.tsx`) :

- Scroll automatique vers l'annotation selectionnee depuis le canvas.
- Shift+clic pour multi-selection ; touche Suppr pour supprimer.
- Double-clic -> zoom canvas sur l'annotation via `uiStore.zoomToAnnotation`.
- Badge provenance IA (SAM Point, SAM Auto, Grounding DINO, tracking guide, interpolation).
- Bouton NMS avec seuil IoU reglable (panel depliable).
- Bouton "Tout supprimer" avec confirmation inline.

**Hooks cles :**

- `useKeyboardShortcuts(classes?)` : raccourcis globaux ; ignore les inputs.
- `useAutoSave(projectId)` : sauvegarde session toutes les 2 min.
- `useTaskPolling(taskId)` : poll `exportAPI.getStatus()` toutes les 800 ms. Statuts :
  `'pending' | 'running' | 'completed' | 'error'`.

---

## Flux de donnees

### Ajout d'une annotation manuelle

1. L'utilisateur dessine sur le canvas -> `AnnotationCanvas` appelle
   `addAnnotation(AnnotationCreate)` sur `annotationStore`.
2. Store appelle `annotationsAPI.create(frameId, data)` -> `POST /api/frames/{id}/annotations`.
3. Reponse ajoutee a `store.annotations`, snapshot undo sauvegarde.
4. Canvas re-render depuis l'etat du store.

### Annotation par texte (Grounding DINO)

1. L'utilisateur tape un prompt dans la toolbar -> `samAPI.predictText(frameId, prompt)`.
2. Backend : Grounding DINO trouve les boites -> SAM2 raffinement en masques.
3. Detections ajoutees via `addAnnotation()` avec `is_auto: true, source_algorithm: 'grounding_dino'`.

### NMS (Non-Maximum Suppression)

1. Bouton NMS dans AnnotationList -> `onApplyNMS(iouThreshold)`.
2. `AnnotationPage.handleApplyNMS` -> `annotationsAPI.applyNMS(frameId, threshold)` ->
   `POST /api/frames/{id}/annotations/nms`.
3. Backend : tri par confiance, calcul IoU pairwise, suppression des doublons.
4. Frontend : rechargement des annotations de la frame.

### Export YOLO

1. `POST /api/projects/{id}/export` -> tache async -> retourne `task_id`.
2. Frontend poll `GET /api/exports/{task_id}/status` via `useTaskPolling`.
3. Sur `completed` : telechargement via `GET /api/exports/{task_id}/download` (ZIP).

---

## Deploiement production

```bash
# Builder le frontend
cd frontend && npm run build  # -> frontend/dist/

# Ajouter dans backend/main.py apres les routers :
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

app.mount("/assets", StaticFiles(directory="frontend/dist/assets"), name="assets")

@app.get("/{full_path:path}")
async def serve_frontend(full_path: str):
    return FileResponse("frontend/dist/index.html")

# Lancer sans --reload
uvicorn backend.main:app --host 0.0.0.0 --port 8000 --workers 1
```

Un seul worker uvicorn : SQLite (mode WAL) n'est pas prevu pour de l'ecriture multi-process.
