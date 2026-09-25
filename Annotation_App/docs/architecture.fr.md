---
app: annotation
doc_type: architecture
audience: dev
lang: fr
title: Architecture
order: 60
tags: [fastapi, sqlite, websocket, registre de tâches, chaîne d'images, smb, react]
sources: [Annotation_App/backend/main.py, Annotation_App/backend/models/routers/docs.py, Annotation_App/backend/models/routers/annotation.py, Annotation_App/backend/database.py, Annotation_App/backend/config.py, Annotation_App/backend/services/task_registry.py, Annotation_App/backend/models/routers/tracking.py, Annotation_App/backend/models/routers/dataset.py, Annotation_App/backend/models/routers/export.py, Annotation_App/backend/utils/image_utils.py, Annotation_App/backend/utils/native_share.py, Annotation_App/backend/services/format_registry.py, Annotation_App/frontend/src/pages/AnnotationPage.tsx, Annotation_App/frontend/src/services/websocket.ts, Annotation_App/frontend/src/stores/annotationStore.ts, Annotation_App/frontend/vite.config.ts]
---

# Architecture

## Vue d'ensemble des composants d'Annotation App

Annotation App est une application web à deux niveaux : un backend FastAPI qui possède les données, les modèles et les calculs lourds, et un frontend React qui tourne dans un navigateur ou dans la coquille Electron de VisionNexus.

```text
Frontend (React 19 + TypeScript + Vite + Konva.js + Zustand)
  |-- HTTP /api (axios, client typé)   --+
  |-- WebSocket /ws (tâches, SAM)      --+--> proxy Vite (127.0.0.1) --> backend FastAPI
  `-- images : /api/frames/{id}/image, ou lecture native app-image:// dans VisionNexus

Backend (FastAPI + SQLModel + SQLite, un seul worker uvicorn)
  |-- routers (backend/models/routers/) : un fichier par domaine
  |-- services (backend/services/) : singletons des modèles et logique métier
  |-- registre de tâches : état en mémoire des tâches de fond, logs, frames live
  `-- workspace sur disque : annotation.db, projects/<id>/frames et caches, sauvegardes, exports
```

Technologies principales : FastAPI et uvicorn, SQLModel sur SQLAlchemy 2 avec SQLite en mode WAL, PyTorch avec SAM2, SAMURAI (fork de SAM2), Grounding DINO via `transformers`, SAM3.1, OpenCV (SIFT, Lucas-Kanade, décodage vidéo) et XFeat. Côté frontend : React 19, React Router, stores Zustand, Konva.js pour le canvas, axios et `react-hot-toast`.

Le backend tourne en un seul processus. Tout l'état partagé entre requêtes vit dans SQLite (persistant) ou dans des singletons de module (modèles, registre de tâches, caches). C'est pourquoi un seul worker uvicorn doit tourner par workspace.

## Démarrage de l'application backend

`backend/main.py` crée l'application FastAPI et exécute son lifespan au démarrage :

1. Relève la limite du threadpool anyio à 96 jetons. Chaque endpoint déclaré en `def` et chaque écriture en base des tâches de suivi tournent dans ce pool ; la valeur par défaut de 40 saturait pendant les propagations, laissant les requêtes d'état et d'arrêt en file jusqu'au délai d'expiration.
2. Crée les tables SQLite (`create_db_and_tables`) et exécute `_run_migrations()`, qui ajoute les colonnes manquantes par `ALTER TABLE ... ADD COLUMN` (par exemple `frame.sequence_id`, `sequence.lut_json`, `sequence.last_export_at`, `track.sequence_id`, `labelclass.subclass`, `project.is_template`, `frame.is_extracted`). Les tables ne sont jamais supprimées.
3. Charge SAM2 : le modèle small si `backend/checkpoints/sam2.1_hiera_small.pt` existe, sinon tiny. SAMURAI est chargé avec lui quand il est disponible. Grounding DINO, SAM3 et XFeat sont chargés à la demande par leurs services.

Middlewares : CORS pour les origines du frontend (`backend/config.py`), et `GZipMiddleware` avec un minimum de 1 Ko, qui compresse environ dix fois les listes JSON de frames et d'annotations (essentiel en SSH) tandis que les images restent non compressées. Les fichiers statiques du workspace sont montés sur `/media` (liens symboliques suivis).

Endpoints de niveau application définis dans `main.py` : `/health`, `/api/app-mode` (solo ou orchestrateur, d'après `LAUNCHED_BY_ORCHESTRATOR`), `/api/capabilities` (formats optionnels), `/api/sam/ping`, les utilitaires de workspace (`/api/workspace/*`) et les endpoints de monitoring (`/api/monitoring/stats`, `/api/monitoring/report`).

## Routers et services du backend

Les routers vivent dans `backend/models/routers/`, un fichier par domaine, et sont montés dans `main.py` :

| Router | Domaine |
|---|---|
| `projects.py` | Projets, classes, état de session, LUT par projet, sauvegarde et restauration |
| `dataset.py` | Imports (envoi, dossier serveur, vidéo serveur, formats spécifiques), frames, séquences, service des images, histogrammes, navigateur de fichiers, import d'annotations (`.ver`, YOLO) |
| `annotation.py` | CRUD des annotations, remplacement en bloc, suppression multi-frames avec annulation, copie entre frames, chevauchements, interpolation, NMS, résumés |
| `sam.py` | Points et état SAM2, prédiction texte Grounding DINO, prédiction texte SAM3, WebSockets SAM |
| `tracking.py` | Pistes, état des tâches, logs, arrêt/pause/reprise, WebSocket des tâches, propagation par homographie et flux optique, tracking guidé (Detect.), suivi SAMURAI / SAM2 vidéo, ByteTrack (API seulement), debug d'homographie |
| `export.py` | Export YOLO, COCO et `.ver` en tâches de fond, état, téléchargement, aperçu |
| `orchestrator.py` | Contrat avec Orchestrator App : création de projet, état, export YOLO et `.ver`, annotation automatique |
| `samples.py`, `settings.py`, `storage.py`, `convert.py` | Exemples du tutoriel, réglages utilisateur, stockage du workspace, conversions de formats |
| `docs.py` | Cette documentation : liste des pages depuis `docs/docs_manifest.json` de la suite (liste intégrée en repli), une page avec son frontmatter et le repli de langue, et images de `docs/assets/` ; lu par la page Présentation |

Les services de `backend/services/` sont des singletons de module :

| Service | Rôle |
|---|---|
| `sam_service.py` | Prédicteur d'image SAM2, générateur automatique de masques, prédicteur vidéo SAM2 / SAMURAI (`configure_video_tracking`, sessions vidéo fermées après chaque passage) |
| `grounding_service.py` | Chargement et prédiction Grounding DINO, raffinement SAM2 facultatif |
| `sam3_service.py` | Chargement de SAM3.1 et prédiction texte |
| `homography_service.py` | Appariement XFeat ou SIFT, homographie RANSAC, transformation des boîtes, flux optique Lucas-Kanade, visualisation de debug |
| `dataset_service.py` | Extraction de frames, import de dossiers, écriture des exports YOLO et COCO |
| `task_registry.py` | Registre en mémoire des tâches de fond |
| `settings_service.py` | Lecture, migration et écriture de `user_settings.json` |
| `interpolation_service.py`, `tracker_service.py` | Interpolation linéaire, ByteTrack |
| `annotation_import_service.py`, `convert_service.py`, `format_registry.py`, `monitoring_service.py` | Lecture `.ver` / YOLO, conversions, découverte des formats optionnels, événements et agrégation du monitoring |

## Modèle de données et base

La base est SQLite dans `<workspace>/annotation.db`, en mode WAL avec clés étrangères appliquées. Les modèles sont des classes SQLModel dans `backend/models/`.

| Table | Champs clés |
|---|---|
| `project` | `name`, `project_type` (`image` ou `video`), `source_path`, `lut_json`, `is_template`, `frame_count`, `annotated_count` |
| `sequence` | `project_id`, `name`, `source_type`, `source_path`, `start_index`, `frame_count`, `fps`, `lut_json`, `last_export_at`, `last_export_format` |
| `frame` | `project_id`, `sequence_id` (nul pour les frames anciennes), `frame_index` (global), `filename`, `width`, `height`, `is_annotated`, `is_empty`, `is_keyframe`, `is_extracted`, `source_frame_index`, `propagation_confidence` |
| `annotation` | `frame_id`, `class_id`, `track_id`, `annotation_type` (bbox ou polygon), `cx`, `cy`, `width`, `height`, `points` (JSON), `confidence`, `is_auto`, `is_interpolated`, `source_algorithm`, `created_at` |
| `track` | `project_id`, `sequence_id`, `track_uid`, `class_id`, `color`, `start_frame`, `end_frame`, `is_active`, `interpolated_frames` |
| `labelclass` | `project_id`, `name`, `subclass`, `subsubclass`, `color`, `shortcut_key` ; `full_name` joint les niveaux par `_` |
| `sessionstate` | Par projet : frame courante, zoom, décalages, classe et outil actifs |

Relations : un projet possède séquences, frames, pistes et classes ; une frame possède des annotations ; une annotation référence une classe et éventuellement une piste. La suppression d'un projet cascade manuellement (annotations, frames, pistes, classes, session, puis le projet).

Chaque import ajoute ses frames après les frames existantes (`frame_index` continue à partir de `project.frame_count`) et préfixe leurs fichiers par `s{seq_id:03d}_`. La résolution de l'image d'une frame passe par le chemin source de la séquence, avec le chemin source du projet comme repli pour les anciens projets.

Réglages de connexion : `check_same_thread=False`, une attente de verrou de 30 secondes, `PRAGMA busy_timeout=30000`, `synchronous=NORMAL`, et un pool de 20 connexions plus 40 en débordement avec un délai de pool de 10 secondes.

## Coordonnées et provenance des annotations

Toute la géométrie des annotations est stockée normalisée dans `[0, 1]` selon la convention YOLO : `cx`, `cy` sont le centre de la boîte, `width`, `height` sa taille, en fractions de l'image. Les points des polygones (`points`, une liste JSON de `[x, y]`) sont normalisés de la même façon. Aucune valeur en pixels n'entre en base.

Les conversions n'ont lieu qu'aux bords :

- le canvas convertit les coordonnées de la scène avec `stageToImageNormalized()` dans `AnnotationCanvas.tsx`, et `yoloToPixel()` / `pixelToYolo()` dans `frontend/src/utils/coordinates.ts` ;
- les sorties des modèles (SAM2, SAMURAI, Grounding DINO, SAM3, homographie, flux optique) sont normalisées par le backend avec la taille d'origine de la frame avant l'enregistrement ;
- les exports convertissent en pixels pour COCO et `.ver`, et gardent les valeurs normalisées pour YOLO.

Les champs de provenance décrivent comment chaque annotation a été produite : `is_auto` (modèle ou propagation), `is_interpolated` (homographie, flux optique, interpolation), `confidence` (1,0 pour le travail manuel) et `source_algorithm` (`sam_point`, `sam_auto`, `grounding_dino`, `sam3`, `samurai`, `sam2_video`, `guided_tracking`, `homography`, `optical_flow`, `imported` ; ancien `sam2_tracking`). Le frontend n'envoie jamais `manual` : les boîtes et polygones dessinés à la main sont enregistrés avec un `source_algorithm` vide. Les résultats d'homographie et de flux optique sont toujours des boîtes, marquées `homography` ou `optical_flow`. Dans les projets **Séquence Image**, `POST /api/frames/{frame_id}/annotations` rattache chaque annotation non automatique sans piste à la piste dont le `track_uid` est le plus petit libre sur cette frame (créée si besoin, rejointe si elle existe déjà dans la séquence).

Le service de monitoring enregistre les événements d'annotation (création, retouche, suppression, passages) dans `<workspace>/monitoring/events.jsonl` et les agrège avec cette provenance pour la page Monitoring et le rapport HTML, aussi régénéré par le lanceur de la suite quand un utilisateur d'annotation se déconnecte.

## Tâches de fond et registre de tâches

Les opérations longues (imports, extraction vidéo, propagations, tracking guidé, exports) tournent en tâches de fond. L'endpoint crée une tâche, lance le travail et renvoie immédiatement un `task_id`.

`backend/services/task_registry.py` conserve, par tâche et en mémoire :

- `status` (`pending`, `running`, `completed`, `error`), `progress` (0 à 100), `message`, `error`, `result` ;
- `current_frame_id`, la frame en cours de traitement, utilisée pour la navigation live ;
- un tampon circulaire de 300 lignes de log (`append_log`), lu de façon incrémentale avec `GET /api/tasks/{id}/logs?since=N` et affiché dans la vue **Logs** du panneau Tracks (la première ligne, qui commence par `$`, résume la commande) ;
- `live_frames_pending`, une file bornée (600 entrées) d'aperçus par frame : identifiant de frame, objets et chemin natif de l'image ;
- les indicateurs d'arrêt et de pause (`request_stop`, `request_pause`, `request_resume`).

Règles pour le code des tâches :

- Le travail lourd (OpenCV, XFeat, PyTorch) doit tourner dans une fonction synchrone exécutée dans le threadpool (`background_tasks.add_task` avec une `def`, ou un exécuteur). Une `async def` sans `await` bloque la boucle d'événements : aucune requête n'est servie pendant le passage, le suivi d'état se fige et l'arrêt est impossible.
- Chaque boucle vérifie `is_stop_requested(task_id)`, y compris pendant la phase de préparation de SAM2.
- Les boucles mettent `frame.is_annotated = True` sur chaque frame où elles créent des annotations, pour que les statistiques de séquence et les exports restent justes.
- Le registre n'est pas persistant : les tâches sont perdues au redémarrage du backend.

Les exports tiennent un registre séparé dans `export.py`, interrogé par le frontend toutes les 800 ms via `GET /api/exports/{task_id}/status` (`useTaskPolling`).

## Suivi des tâches par WebSocket

Le frontend suit les tâches par `WS /ws/tasks/{task_id}`, une connexion persistante unique par tâche qui a remplacé l'interrogation HTTP répétée.

Côté serveur, la boucle lit la tâche toutes les 150 ms (en mémoire, sous verrou), vide toute la file `live_frames_pending` avec `drain_live_frames()`, et n'envoie un message que si quelque chose a changé :

```json
{"type": "update", "status": "running", "progress": 42, "message": "...",
 "error": null, "current_frame_id": 1234, "live_frame": {...}, "live_frames": [...]}
```

La boucle se termine sur `completed` ou `error` ; une tâche inconnue donne `{"type": "not_found"}`.

Vider la file est essentiel : le champ unique `live_frame` est écrasé à chaque frame propagée, et l'échantillonner toutes les 150 ms perdait les frames intermédiaires (18 % d'entre elles à 8 frames/s). La file livre chaque frame.

Côté client, `subscribeTaskProgress()` dans `frontend/src/services/websocket.ts` est un broker : il garde une seule socket physique par tâche et diffuse chaque message à tous les abonnés locaux (le panneau Tracks et la barre de progression de la page). Deux sockets sur la même tâche se disputeraient la vidange destructive et perdraient au hasard des aperçus et des chemins natifs. Si la montée en WebSocket est bloquée (certains proxys SSH), le panneau Tracks se replie sur des requêtes `GET /api/tasks/{id}` séquentielles et les annule dès que la socket fonctionne de nouveau.

Les endpoints d'image SAM utilisent deux autres WebSockets : `/ws/sam/image` transmet les masques de SAM Auto au fil de leur production, et `/ws/sam/video` prend en charge des sessions vidéo interactives. `AnnotationWebSocket` dans `websocket.ts` est le client générique avec reconnexion automatique.

## Chaîne de propagation live (SAMURAI et SAM2)

Un passage vidéo SAMURAI ou SAM2 suit cette séquence :

```text
1. POST /api/projects/{id}/sam2-tracking/run  -> task_id (immédiat)
2. Le backend prépare la plage dans projects/<id>/_tracking_tmp/sam2_track_*/ :
   un JPEG 8 bits par frame (LUT appliquée, qualité 95, noms 000000.jpg...),
   lié sans réencodage quand la source est déjà un JPEG convenable
3. Session vidéo ouverte avec chargement asynchrone des frames ; SAMURAI pour une cible,
   SAM2 multi-objets natif pour plusieurs, ou une passe SAMURAI par objet
4. Pour chaque frame propagée : masques -> boîtes ou polygones, annotations tamponnées
   et validées par lots de 10, aperçu live mis en file (frame_id, objets, native_path)
5. WS /ws/tasks/{id} pousse live_frames ; le frontend met à jour la timeline pour chaque
   frame et déplace le canvas à la cadence configurée
6. Validation finale, session fermée (VRAM libérée), dossier temporaire nettoyé,
   état completed ; le frontend recharge une fois frames, pistes et frame courante
```

Contrat de l'affichage live : une frame affichée pendant le passage reçoit son image par le chemin natif (ou HTTP) et ses annotations du même lot WebSocket. Tant que le passage est actif, aucun `GET` d'annotations ne peut remplacer cet aperçu par un état de base pas encore validé ; le frontend l'impose par un indicateur explicite `hasLivePayload` et traite le WebSocket comme l'unique source d'annotations du canvas. Un tampon `liveAnnotationsRef` conserve les aperçus arrivés avant que le canvas cadencé n'atteigne leur frame. La base redevient la source de vérité après la resynchronisation finale.

Avec `interface.realtime_live_enabled` désactivé, aperçus et compteurs arrivent toujours, mais le canvas reste sur la frame de l'utilisateur. La cadence du canvas (`interface.propagation_nav_throttle_ms`, 150 ms par défaut) n'échantillonne que les images dessinées, jamais l'association entre une image et ses annotations.

La propagation vers l'arrière (frame de fin avant la référence) inverse la liste des frames pour que SAMURAI tourne toujours vers l'avant sur les frames réordonnées. Le backend journalise des lignes `[SAM2Track]`, dont la configuration (périphérique, offload CPU, taille d'image) et la route d'image choisie.

## Niveaux de service des images et caches disque

Les images des frames sont servies par `GET /api/frames/{frame_id}/image` en trois niveaux :

| Requête | Taille | Qualité JPEG | Usage |
|---|---|---|---|
| `preview=1` | 480 px de large | 70 (environ 10 à 20 Ko) | Défilement du curseur, lecture, propagation |
| `display=1` | 1600 px de large | 85 | Affichage normal du canvas |
| aucun | pleine résolution | fichier source (92 en cas de réencodage) | Zoom au-delà de 1,5x |

Les niveaux réduits sont générés à la demande et mis en cache. Avec `interface.preview_downscale_enabled` désactivé, chaque requête renvoie la pleine résolution et rien n'est écrit. Les réponses portent `Cache-Control: max-age=3600, immutable` : le navigateur réutilise les frames déjà vues.

Caches par projet (`projects/<id>/`) :

- `frames_preview/` : niveaux réduits `<stem>_prev<largeur>_<sig>.jpg`.
- `frames_8bit/` : `<stem>_8bit_<sig>.jpg`, versions 8 bits des sources 16 bits à travers la LUT effective.
- `frames_ai_lut/` : entrées des détecteurs guidés avec LUT appliquée, pour que Grounding DINO et SAM3 voient l'image affichée.
- `frames_format specialise_cache/` : niveaux du format optionnel format specialise.

`<sig>` est la signature de la LUT (`lut_signature()`) ; la signature d'une LUT manuelle vaut `man<lo>_<hi>` et contient un souligné : ces noms ne doivent jamais être découpés avec `rpartition("_")`. Quand une LUT change, `purge_stale_lut_caches()` ne garde que les signatures encore utilisées (LUT du projet et LUT de chaque séquence), ce qui empêche l'accumulation de générations mortes.

Quand le fichier d'une frame manque (lien symbolique cassé, frame pas encore extraite), le backend renvoie une image grise de remplacement en HTTP 200, avec `Cache-Control: no-store` et un en-tête `X-Frame-Missing` (`broken-symlink`, `not-extracted`), pour qu'aucun client ne la mette en cache comme la vraie frame. `GET /api/frames/{id}/histogram` calcule un histogramme des valeurs brutes, conservé dans un cache LRU de 4000 frames puisque les pixels sources ne changent jamais après l'import.

Tous les chargeurs des modèles lisent les images via `load_image_bgr_8bit` / `load_image_rgb` de `backend/utils/image_utils.py` avec la LUT effective de la frame, jamais par un simple `cv2.imread`, pour traiter les sources 16 bits de façon cohérente.

## Chemin natif des images via la coquille VisionNexus

Dans la coquille Electron de VisionNexus, le protocole personnalisé `app-image://` peut lire les pixels des frames directement sur le partage SMB au lieu de les télécharger en HTTP. Le trafic ne passe alors ni par le tunnel SSH, ni par les six connexions par origine du navigateur, ni par le threadpool du backend.

Résolution pour la navigation normale :

1. Le frontend demande à `app-image://` une frame et un niveau.
2. Electron appelle `GET /api/frames/{frame_id}/image-path`, qui renvoie le chemin UNC calculé par `to_native_share_path()` (et le fichier de cache du niveau si besoin) ainsi que l'URL de repli HTTP.
3. Electron lit le fichier avec `fs.readFile` ; en cas d'échec, il se replie sur `GET /api/frames/{frame_id}/image`.

Pendant une propagation, le backend écrit déjà un JPEG 8 bits par frame dans `_tracking_tmp/` : il annonce donc directement ce fichier dans chaque frame live (`native_path`). Le frontend le transmet comme `nativePath`, ce qui économise les deux requêtes HTTP de la résolution normale. La lecture directe est tentée même si la sonde SMB générique de VisionNexus est inactive ou utilise un autre nom d'hôte, avec un délai de 1,5 seconde avant le repli HTTP. Les JPEG temporaires ne vivent que pendant le passage : le repli HTTP dans l'URL `app-image://` est donc obligatoire.

`to_native_share_path()` (`backend/utils/native_share.py`) renvoie tels quels les chemins Windows (lancement local), traduit `/<racine>/<partage>/reste` en `\\<native_share_host>\<partage>\reste` pour les racines listées dans `paths.shared_roots`, et renvoie `None` sinon (par exemple sous `/tmp`, raison pour laquelle le dossier temporaire vit dans le projet). `from_native_share_path()` fait l'inverse pour les chemins saisis par les utilisateurs.

Logs : le backend écrit une ligne par passage (`chemin NATIF (SMB)`, `chemin NATIF (disque local)` ou `REPLI HTTP` avec la raison) ; VisionNexus confirme une fois par passage la route réellement utilisée (`[app-image] lecture native confirmee` ou `[app-image] repli HTTP`). Electron ne met jamais en cache les images provisoires (images de remplacement).

## Flux de données de la navigation entre frames

Passer à une autre frame (curseur, timeline, flèche ou **aller à**) déclenche une séquence courte et annulable dans `AnnotationPage.tsx` :

1. Le `frame_index` cible est résolu à partir des métadonnées de frames en mémoire. La liste des frames est chargée une fois par projet par pages de 10000 (pagination automatique jusqu'à épuisement) ; `GET /api/projects/{id}/frames/by-index/{n}` comble les trous d'une fenêtre partielle.
2. Les annotations sont prises dans un cache LRU de 600 frames, puis rafraîchies par un `GET /api/frames/{frame_id}/annotations` annulable.
3. L'URL de l'image est choisie : niveau aperçu pendant le défilement, la lecture ou la propagation, niveau affichage au repos, pleine résolution au-delà d'un zoom de 1,5x.
4. L'image est chargée (chemin natif dans VisionNexus, HTTP sinon) et validée dans le canvas avec les annotations seulement si les deux appartiennent au même `frame_id`.
5. Au repos, un petit voisinage est préchargé. Pendant le défilement et la propagation, il n'y a aucun préchargement, pour garder libres les six connexions.

Pendant qu'on fait glisser le curseur, la poignée suit immédiatement le pointeur et l'image change au plus toutes les 130 ms ; l'image complète se charge au relâchement. La timeline ne demande jamais d'images : elle est virtualisée et n'affiche que des compteurs. Pour les vidéos, `POST /api/projects/{id}/frames/ensure_extracted` extrait d'abord le voisinage de la frame courante (avec anti-rebond pendant le défilement).

`annotationStore.loadAnnotations(frameId, annotations)` prend l'identifiant de frame en premier et est idempotent : il ne publie aucun nouvel état quand la frame et le tableau sont inchangés. Le canvas ignore les mesures 0 x 0 des onglets Electron masqués et garde sa dernière taille valide.

## Chaîne d'import et stockage des séquences

Chaque import crée une `Sequence` et ajoute ses frames après les frames existantes du projet. Les imports lancés depuis le frontend sont sérialisés par `importStore.ts` : la fenêtre se ferme, une file exécute un import à la fois (le backend lit `project.frame_count` à la création de chaque séquence, deux imports simultanés entreraient donc en collision sur les index), et la page affiche une barre de progression par séquence.

| Source | Endpoint | Stockage |
|---|---|---|
| Dossier d'images serveur | `POST /api/projects/{id}/import/folder` | Liens symboliques dans `frames/` (copie si les liens sont refusés), insérés progressivement par lots |
| Images envoyées | `POST /api/projects/{id}/import/images` | Fichiers dans `frames/`, format d'origine conservé |
| Vidéo serveur | `POST /api/projects/{id}/import/video_from_path` | Analyse paresseuse, puis extraction de fond en JPEG ou PNG |
| Vidéo envoyée | `POST /api/projects/{id}/import/video` | Envoi par morceaux (8 Mo), puis extraction de fond |
| Format spécifique | `POST /api/projects/{id}/import/specific` | Délégué à l'adaptateur du format |

L'extraction ne garde qu'une frame décodée en mémoire à la fois (environ 6 Mo en 1080p, 25 Mo en 4K) et valide par lots. La décimation (`frame_keep`) garde une frame sur N et enregistre l'index d'origine dans `source_frame_index`. Au chargement d'un projet, le backend vérifie que les fichiers images présents sur disque ont une fiche `Frame`, ce qui répare les imports interrompus.

Les sources PNG et TIFF 16 bits sont liées sans modification ; leur affichage et l'entrée des modèles passent par la LUT. Un manifeste de séquences (`POST /api/sequences/parse-manifest`, lignes `chemin<TAB>nom`) permet à la fenêtre d'import de remplir tous les emplacements à partir du `.txt` écrit par la sauvegarde automatique.

## Adaptateurs de formats optionnels

Les formats de séquence spécifiques sont pris en charge par des modules adaptateurs autonomes dans `backend/utils/`. Le seul adaptateur livré est `format specialise.py`, pour le format brut format specialise (en-tête de 128 octets avec nombre d'images, lignes, colonnes, profondeur en bits et type ; les frames de taille fixe permettent un accès direct).

`backend/services/format_registry.py` découvre les adaptateurs sans les importer : il analyse chaque module avec `ast` et lit une constante littérale `FORMAT_CAPABILITY` (libellé, extensions, contrat d'import). Un module n'est importé que quand un fichier correspondant est traité. `GET /api/capabilities` renvoie `{"specific_formats": [...]}` ; le frontend construit le libellé, les extensions acceptées et la prise en charge du glisser-déposer à partir de cette liste et ne code en dur aucun nom de format.

Supprimer `backend/utils/format specialise.py` puis redémarrer donne `specific_formats: []` : aucune option format specialise n'apparaît et les imports standard continuent de fonctionner. Le lecteur format specialise accède directement à la frame demandée et garde la profondeur native ; un fichier format specialise n'est jamais servi en pleine résolution frame par frame à la volée, il est converti en PNG (à côté du fichier source, dans `<stem>_png/`, ou dans le projet pour les envois) ou servi via `frames_format specialise_cache/`. `POST /api/convert/video_to_format specialise`, `/api/convert/format specialise-to-png` et `/api/convert/png-to-format specialise` fournissent les conversions.

## Chaîne d'export

`POST /api/projects/{id}/export` démarre une tâche d'export et renvoie son identifiant. La requête porte `output_format` (`yolo`, `coco` ou `ver`), les ratios de découpage, `include_unannotated`, `class_filter`, `symlink_images`, un `export_name` facultatif et, en mode solo seulement, `custom_export_dir` (les chemins UNC sont traduits).

- **YOLO** : pour un projet multi-séquences, un dossier `<séquence>-yolo/` par séquence annotée dans le dossier d'export ; un projet à une seule séquence est exporté à plat. Les labels sont `classe cx cy w h` ; `data.yaml` associe les index de classes aux noms complets. Quand des polygones existent, `seg_labels/` et `seg_data.yaml` sont écrits en plus.
- **COCO** : `<séquence>-coco/` avec `images/{train,val,test}/` et `annotations/instances_{split}.json` ; boîtes en pixels `[x, y, w, h]`, `category_id` = index de classe + 1, polygones en pixels dans `segmentation`, `track_id` en champ supplémentaire. Écrit par `dataset_service.export_coco_dataset`, qui partage le placement des images avec YOLO.
- **.ver** : un `<séquence>.ver` par séquence, dix colonnes `frame_id visibility x1 y1 x2 y2 track_id classe sous_classe sous_sous_classe`, coins en pixels, frames à partir de 1, `track_id` = `track_uid` persistant (`-1` sans piste).

Avec `symlink_images`, le dataset pointe vers les images sources et aucun ZIP n'est produit (`GET /api/exports/{task_id}/download` refuse alors) ; sinon les images sont copiées et un ZIP est construit. Chaque séquence exportée reçoit `last_export_at` et `last_export_format`, que la page Monitoring utilise pour marquer les séquences terminées. En mode orchestrateur, l'export va dans le dossier `exports/` du workspace ; `/api/orchestrator/export-yolo` réutilise un export existant dont la signature de contenu est identique au lieu de le recalculer.

## Structure du frontend

Le frontend (`Annotation_App/frontend/src/`) est une application React à cinq routes définies dans `App.tsx` : `/` (projets), `/projects/:projectId/annotate` (espace d'annotation), `/presentation` (cette documentation, rendue par `components/docs/MarkdownDoc.tsx` depuis `GET /api/docs`, avec la page et la section dans l'URL : `?doc=<page>#h-<n>`), `/convert` et `/monitoring`.

L'état vit dans des stores Zustand (`stores/`) :

| Store | Contenu |
|---|---|
| `annotationStore.ts` | Annotations de la frame courante, outil et classe actifs, sélection, cibles de suivi partagées par tous les onglets Tracks, annuler/rétablir par frame (50 instantanés), presse-papier |
| `projectStore.ts` | Projets, projet courant, frames (pagination automatique), index de frame courant, sauvegarde de session |
| `samStore.ts` | Automate d'état de la WebSocket SAM, masques transmis (propositions SAM Auto), points en attente |
| `uiStore.ts` | Zoom et décalage, onglet actif de la barre latérale, fenêtres, panneau LUT, `zoomToAnnotation` |
| `settingsStore.ts` | Réglages utilisateur, chargés de façon asynchrone au démarrage |
| `importStore.ts` | File d'import en tâche de fond (sérielle) |
| `bulkUndoStore.ts` | Annuler/rétablir des suppressions multi-frames depuis la timeline |

Le canvas (`components/canvas/AnnotationCanvas.tsx`) est une scène Konva à trois calques : l'image de fond, les annotations (`BBoxShape` avec un transformateur, polygones), et un calque d'interaction (tracé en cours, points et masques SAM). `services/api.ts` est le client axios typé, organisé en espaces de noms (`projectsAPI`, `datasetAPI`, `annotationsAPI`, `samAPI`, `trackingAPI`, `taskAPI`, `exportAPI`, `settingsAPI`, `storageAPI`, `backupAPI`, `filesAPI`, `samplesAPI`, `monitoringAPI`, `appModeAPI`, `docsAPI`) ; son intercepteur affiche les toasts d'erreur et arrête les interrogations après des échecs de connexion répétés. `hooks/` contient les raccourcis clavier, la sauvegarde automatique (session et sauvegarde serveur toutes les 2 minutes, silencieuse) et le suivi des exports. Les traductions sont dans `i18n/translate.ts` (chaînes sources en français, dictionnaire anglais).

## Topologie distante et budget de connexions HTTP

Le déploiement distant cible répartit l'application sur deux machines :

```text
Poste Windows : VisionNexus (Electron) + frontend
  |-- API JSON + WebSocket --> 127.0.0.1:<port local> -- tunnel SSH --> <backend-vm>:<port backend>
  `-- pixels des frames -----> \\<native_share_host>\<partage>\... lus par app-image://
<backend-vm> : FastAPI, SQLite, SAM2 / SAMURAI et les autres modèles
```

`<backend-vm>` (l'hôte SSH) et `paths.native_share_host` (l'hôte UNC vu par Windows) peuvent avoir des noms différents. Le facteur limitant n'est pas React ou Vite mais la latence réseau multipliée par le nombre de requêtes. Un navigateur ouvre au plus six connexions HTTP simultanées par origine, toutes via le tunnel ; elles sont partagées entre les images (l'essentiel du volume) et les requêtes vitales (annotations, arrêt, sauvegarde).

Coût d'une frame :

| Transport | Taille | Requêtes HTTP |
|---|---|---|
| Message WebSocket de frame live | environ 415 o | 0 (socket déjà ouverte) |
| Image d'aperçu (480 px) | environ 9,7 Ko | 1 |
| Image d'affichage (1600 px) | environ 22 Ko | 1 |
| Image pleine résolution (données de test 640 x 512) | environ 35 Ko | 1 |

À la cadence SAMURAI mesurée de 8 frames/s, les annonces WebSocket coûtent 3,2 Ko/s et aucune requête, alors que suivre le canvas frame par frame en HTTP coûterait 79 Ko/s et 8 requêtes/s, plus que les six emplacements. D'où les choix de conception : lectures SMB natives pour les pixels, une WebSocket par tâche, GZip sur le JSON, niveaux d'aperçu, aucune vignette, suppressions et statistiques groupées côté serveur, proxy Vite sur `127.0.0.1`, et aucun préchargement pendant le défilement ou la propagation.

## Dimensionnement du pool de base et du threadpool

SQLAlchemy 2 utilise un `QueuePool` même pour une base SQLite sur fichier, avec 5 connexions plus 10 en débordement par défaut. Les endpoints FastAPI déclarés en `def` tournent dans le threadpool anyio. Quand le threadpool était plus grand que le pool, les requêtes attendaient une connexion jusqu'au délai du pool ; avec un délai de pool de 30 secondes, égal au délai des requêtes du frontend, toute l'interface se figeait avec « Le backend ne répond pas » sans qu'aucune tâche GPU ne tourne. Le pool se remplissait parce que `serve_frame_image` et `frame_histogram` gardaient leur connexion pendant un `cv2.imread` de PNG 16 bits sur un montage réseau.

Dimensionnement actuel :

- threadpool anyio : 96 jetons (réglé au démarrage) ;
- pool SQLAlchemy : `pool_size=20`, `max_overflow=40` (60 connexions), `pool_timeout=10`, `pool_recycle=3600` ;
- SQLite : WAL, `busy_timeout=30000`, `synchronous=NORMAL`.

Les requêtes ne doivent attendre que le verrou d'écriture SQLite (géré par WAL et le délai d'attente), jamais une place dans le pool ; si le pool est tout de même épuisé, les requêtes échouent vite au bout de 10 secondes au lieu de rester bloquées. Le cache LRU des histogrammes (calculés sur les valeurs brutes, indépendants de la LUT) supprime l'essentiel des relectures d'images : gain mesuré x5 en appel unique et x4,5 en rafale sur SSD local, davantage sur stockage réseau. Gardez le pool au-dessus du nombre de threads pouvant tenir une session si l'une des deux valeurs change.

## Empreinte mémoire

La mémoire est consommée par des processus différents, à ne pas confondre en lisant un gestionnaire de tâches :

- **Backend Python** : environ 1,0 Go au repos et 2,1 à 2,2 Go en pointe avec PyTorch, CUDA et SAM2 chargés. Sur une VM, cette mémoire est sur la VM, pas sur le poste. La mémoire GPU de SAMURAI dépend de la plage et du mode GPU rapide (toutes les frames en VRAM) ou de l'offload CPU.
- **Electron (VisionNexus)** : environ 790 Mo mesurés sur 7 processus (renderers, GPU, main, utilitaire) ; le gestionnaire des tâches de Windows les additionne sous un seul nom.

Un navigateur garde les images décodées, pas compressées : une frame 640 x 512 pèse environ 9,7 Ko en aperçu JPEG mais 1,25 Mo décodée en RGBA, soit un facteur d'environ 135.

Ce que l'application retient ne croît pas avec le dataset : le canvas ne garde qu'une image, le préchargement crée des objets `Image` qui ne sont pas stockés, la timeline est virtualisée, le cache d'annotations est borné à 600 frames, et la liste des frames coûte environ 20 Mo à 20 000 frames. Passer de 9 000 à 20 000 frames n'ajoute que quelques dizaines de mégaoctets. Pendant l'extraction, le backend ne garde qu'une frame décodée à la fois ; les envois par morceaux ne gardent qu'un morceau (8 Mo) à la fois.

## Mesures de référence

Ces mesures viennent d'un test de charge sur un dataset de 9402 frames PNG (640 x 512, 2,6 Go), avec Annotation App et Dataset Explorer lancées en parallèle. Réutilisez-les comme base de comparaison après une modification.

| Opération | Valeur |
|---|---|
| Import Annotation de 9402 frames (liens symboliques) | environ 110 s |
| Propagation SAMURAI | environ 8 frames/s |
| Latence du backend avec deux tâches simultanées | médiane 8 à 16 ms, p95 30 à 59 ms, aucun échec |
| Frames live livrées par la WebSocket après vidange de la file | 200 sur 201 (la frame de référence est sautée par conception) |
| Frames live portant un `native_path` | 80 sur 80, 79 lisibles au moment de l'envoi (la dernière est nettoyée avec son dossier) |
| Délai des requêtes du frontend (« le backend ne répond pas ») | 30 000 ms |

Les chiffres WebSocket se comparent aux 18 % de frames perdues avant l'introduction de la file. Pour reproduire les mesures du chemin natif, lancez VisionNexus sous Windows face au backend sur la VM : un navigateur local n'exerce que le repli HTTP.

## Invariants à ne pas casser

Ces règles gardent Annotation App cohérente ; en casser une provoque une corruption silencieuse des données ou des blocages difficiles à diagnostiquer.

1. **Coordonnées normalisées** : les annotations sont stockées dans `[0, 1]` (convention YOLO). Ne stockez jamais de pixels ; divisez par la largeur et la hauteur de la frame avant d'enregistrer.
2. **Un seul worker uvicorn par workspace** : SQLite en mode WAL ne supporte pas les écritures multi-processus.
3. **Migrations de schéma par `ALTER TABLE ... ADD COLUMN` uniquement** dans `_run_migrations()` ; ne supprimez ni ne recréez jamais de table.
4. **`loadAnnotations(frameId, annotations)`** : l'identifiant de frame vient en premier ; appelez `clearAnnotations()` au changement de projet.
5. **Les réglages se chargent de façon asynchrone** : les composants qui initialisent un état local à partir des réglages doivent se resynchroniser dans un effet une fois `settingsStore.loaded` vrai.
6. **Le travail lourd de fond tourne dans des fonctions synchrones** (threadpool) et vérifie régulièrement `is_stop_requested()` ; les boucles marquent `frame.is_annotated`.
7. **Une WebSocket par tâche** via le broker ; la vidange de la file live est destructive.
8. **Pendant un passage, la WebSocket est l'unique source d'annotations du canvas** ; les lectures en base reprennent après la resynchronisation finale ; une image et des annotations affichées ensemble doivent partager le même `frame_id`.
9. **Les cibles de suivi forment un ensemble unique partagé** (`trackingTargetIds` dans `annotationStore`) pour tous les onglets Tracks et le double-clic du canvas ; ne réintroduisez jamais d'ensembles par onglet.
10. **Les fichiers destinés à une lecture native vivent sous une racine partagée** (`home`, `mnt`, `srv`, `media`, `data`), et l'URL de repli HTTP est toujours conservée.
11. **Pool SQL au-dessus du threadpool** et délai de pool court.
12. **Les entrées des modèles passent par la LUT effective de la frame** (`load_image_bgr_8bit` / `load_image_rgb`), jamais par un simple `cv2.imread`.
13. **Aucun emoji ni caractère non encodable dans les `print` ou logs du backend** : la console Windows (cp1252) lève `UnicodeEncodeError` au démarrage.
14. **Les données utilisateur restent sous le workspace** (`annotation_<utilisateur>`), et les endpoints `/api/orchestrator/*` restent le contrat avec Orchestrator App.
