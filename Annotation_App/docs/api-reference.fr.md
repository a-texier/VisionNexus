---
app: annotation
doc_type: api-reference
audience: dev
lang: fr
title: Référence API
order: 70
tags: [api rest, websocket, endpoints, fastapi, orchestrator]
sources: [Annotation_App/backend/main.py, Annotation_App/backend/models/routers/docs.py, Annotation_App/backend/models/routers/projects.py, Annotation_App/backend/models/routers/dataset.py, Annotation_App/backend/models/routers/annotation.py, Annotation_App/backend/models/routers/sam.py, Annotation_App/backend/models/routers/tracking.py, Annotation_App/backend/models/routers/export.py, Annotation_App/backend/models/routers/samples.py, Annotation_App/backend/models/routers/settings.py, Annotation_App/backend/models/routers/storage.py, Annotation_App/backend/models/routers/convert.py, Annotation_App/backend/models/routers/orchestrator.py]
---

# Référence API

## Conventions de l'API d'Annotation App

Le backend d'Annotation App expose une API REST JSON sous `/api`, des WebSockets sous `/ws`, les fichiers du workspace sous `/media`, et une documentation interactive (Swagger) sur `/docs` au port du backend (8000 par défaut, voir [Configuration](configuration.fr.md)). À travers le frontend Vite, les mêmes chemins sont relayés : le frontend appelle toujours des URL relatives.

Règles générales :

- **Coordonnées** : dans les requêtes et les réponses, ce sont des valeurs YOLO normalisées dans `[0, 1]` (`cx`, `cy`, `width`, `height`, `points` des polygones), sauf pour les formats d'export en pixels.
- **Identifiants** : `project_id`, `frame_id`, `sequence_id`, `track_id` et `annotation_id` sont des identifiants de base. `frame_index` est l'index global d'une frame dans son projet ; l'interface affiche des positions à partir de 1 dans une séquence.
- **Erreurs** : format FastAPI `{"detail": "..."}` avec 400 (entrée invalide), 404 (objet inconnu), 503 (modèle indisponible) ou 500. Les messages de détail sont rédigés en français ; le frontend les affiche tels quels.
- **Opérations longues** : elles renvoient immédiatement un `task_id`. Suivez-les par `WS /ws/tasks/{task_id}` (recommandé) ou `GET /api/tasks/{task_id}` ; les exports ont leur propre endpoint d'état.
- **Chemins** : ceux envoyés au backend sont des chemins serveur ; les chemins UNC Windows sont traduits pour les imports, le navigateur de fichiers et les destinations d'export.
- Les réponses de plus de 1 Ko sont compressées en gzip quand le client l'accepte.

Les tableaux d'endpoints de la section *Index des endpoints* sont générés depuis le code ; les sections ci-dessous expliquent chaque domaine.

## Endpoints des projets, classes, session et sauvegarde

Le router des projets (`/api/projects`) gère les projets et tout ce qui leur est rattaché dans leur ensemble.

- `GET /api/projects` liste les projets avec leurs compteurs et un résumé de leurs séquences (utilisé par la page des projets) ; `POST /api/projects` en crée un (`name`, `project_type` `image` ou `video`, description et classes facultatives).
- `GET /api/projects/{id}` renvoie le projet avec ses classes et sa session ; `PUT` le modifie ; `DELETE` le supprime avec une cascade manuelle (annotations, frames, pistes, classes, session). `GET /api/projects/{id}/stats` donne des compteurs par classe et par type.
- `GET` / `PUT /api/projects/{id}/lut` lisent et écrivent la LUT d'affichage du projet (`mode` `sigma`, `minmax` ou `manual`, avec `sigma`, `lo`, `hi`).
- `GET` / `PUT /api/projects/{id}/session` stockent la frame courante, le zoom, les décalages, la classe et l'outil.
- Classes : `GET` / `POST /api/projects/{id}/classes`, `PUT` / `DELETE /api/projects/{id}/classes/{class_id}` (`name`, `color`, `subclass`, `subsubclass`, `shortcut_key`). Le champ `shortcut_key` est le seul moyen d'attribuer un raccourci chiffre à une classe.
- Sauvegarde : `GET /api/projects/{id}/backup` renvoie toutes les annotations groupées par séquence en JSON ; `POST /api/projects/{id}/backup/save` écrit `backup/p<id>_<nom>/p<id>_<nom>.json` et la liste `_sequences.txt` dans le workspace (appelé toutes les deux minutes par le frontend) ; `POST /api/projects/{id}/restore` prend un tel JSON et redistribue les annotations par nom de séquence et index local de frame, avec repli sur l'ordre des séquences, puis sur les anciens identifiants.

## Endpoints du dataset : imports, frames, séquences et images

Le router du dataset gère tout ce qui concerne les frames et leurs pixels.

**Imports** (tous créent une séquence et peuvent renvoyer un `task_id` pour le travail de fond) : `POST /api/projects/{id}/import/images` (envoi multipart), `/import/folder` (dossier serveur, liens symboliques ou copie, progressif), `/import/video` (envoi par morceaux avec `frame_keep`, `jpeg_quality`, `chunk_size_mb`, `extraction_batch_size`), `/import/video_from_path` (vidéo serveur), et `/import/specific` (adaptateur de format optionnel). `POST /api/sequences/parse-manifest` développe une liste de séquences `.txt`. `POST /api/projects/{id}/frames/ensure_extracted` extrait d'abord les frames autour d'un index donné.

**Frames et séquences** : `GET /api/projects/{id}/frames` (métadonnées paginées avec compteurs d'annotations, `sequence_id` facultatif), `GET /api/projects/{id}/frames/by-index/{frame_index}`, `GET /api/frames/{frame_id}`, `POST /api/frames/{frame_id}/mark-empty`, `PUT /api/frames/{frame_id}/keyframe`, `GET /api/projects/{id}/sequences` (avec frames annotées et nombre d'annotations), et la LUT par séquence `PUT` / `DELETE /api/sequences/{id}/lut`.

**Images** : `GET /api/frames/{frame_id}/image` avec `preview=1` (480 px), `display=1` (1600 px) ou pleine résolution ; un fichier manquant donne une image grise de remplacement avec `X-Frame-Missing`. `GET /api/frames/{frame_id}/image-path` renvoie le chemin natif (UNC) et l'URL de repli pour la coquille VisionNexus. `GET /api/frames/{frame_id}/histogram` renvoie l'histogramme des valeurs brutes utilisé par le panneau LUT.

**Import d'annotations** : `POST /api/projects/{id}/sequences/{sequence_id}/import-annotations` (chemin serveur d'un fichier `.ver` ou d'un dossier YOLO, `format`, `replace`) et `/import-annotations-upload` (idem avec des fichiers envoyés).

**Navigateur de fichiers** : `GET /api/files/browse` liste un dossier serveur ; `GET` / `POST /api/files/browse-history` lisent et enregistrent les dossiers récemment parcourus.

## Endpoints des annotations

Le router des annotations travaille sur les annotations d'une frame ou d'un projet entier.

- Par frame : `GET` / `POST /api/frames/{frame_id}/annotations` (liste, création), `PUT` / `DELETE /api/annotations/{annotation_id}`, `POST /api/frames/{frame_id}/annotations/bulk` (remplace ou ajoute une liste en une requête, utilisé par la détection par texte), `DELETE /api/frames/{frame_id}/annotations/all`.
- Nettoyage : `POST /api/frames/{frame_id}/annotations/nms` (suppression des non-maxima avec un seuil d'IoU, garde la plus confiante), `GET /api/frames/{frame_id}/overlaps` (paires d'annotations qui se chevauchent).
- Suppression multi-frames : `POST /api/projects/{id}/annotations/delete-frames` avec `{"frame_ids": [...]}` supprime les annotations de nombreuses frames en une seule transaction ; `undo-bulk-delete` et `redo-bulk-delete` restaurent ou rejouent la dernière suppression groupée (`Ctrl+Z` / `Ctrl+Y` de la timeline). `DELETE /api/projects/{id}/annotations/batch` et `/from-frame` suppriment par sélection ou à partir d'un index de frame.
- Copie et interpolation : `POST /api/frames/{frame_id}/copy-to` copie des annotations vers des frames cibles ; `POST /api/projects/{id}/interpolate` remplit les frames entre deux frames clés annotées d'une piste (non exposé dans l'interface).
- Vues projet : `GET /api/projects/{id}/annotations/all`, `/summary` (compteurs par frame) et `/validate` (contrôles de cohérence).

La création exige un `class_id` valide ; une annotation sans classe est refusée avec « class_id requis ».

## Endpoints SAM2, Grounding DINO et SAM3

Le router SAM expose les modèles de segmentation et de détection par texte.

- **SAM2** : `GET /api/sam/status` et `GET /api/sam/ping` indiquent si le modèle est chargé, sur quel périphérique et avec quel checkpoint ; `POST /api/sam/load` charge une taille de modèle ; `POST /api/sam/predict/points` prend un identifiant de frame et des points étiquetés (1 objet, 0 arrière-plan) et renvoie jusqu'à trois masques avec scores, boîtes et polygones. Les requêtes échouent avec « Modèle SAM2 non chargé » quand aucun checkpoint n'est chargé.
- **Grounding DINO** : `POST /api/sam/predict/text` prend `frame_id`, `text_prompt`, `box_threshold`, `text_threshold` et `use_sam` (raffiner chaque boîte en masque avec SAM2) ; il renvoie des détections avec boîtes normalisées, polygones facultatifs et scores. `GET /api/sam/grounding/status` indique la disponibilité.
- **SAM3** : `POST /api/sam3/predict/text`, avec le même type de prompt et de seuils, renvoie boîtes, masques et polygones en une passe ; `GET /api/sam3/status` et `POST /api/sam3/load` gèrent le modèle.
- **WebSockets** : `WS /ws/sam/image` exécute SAM Auto sur une frame et transmet un message par masque (le frontend les garde comme propositions) ; `WS /ws/sam/video` prend en charge des sessions vidéo interactives.

Les endpoints de prédiction n'enregistrent pas d'annotations ; le client les crée (une par une ou en bloc) après le choix de l'utilisateur. Le mode Detect. et l'annotation automatique de l'Orchestrator appellent les mêmes modèles côté serveur.

## Endpoints de suivi, de propagation et des tâches

Le router de suivi regroupe les pistes, les propagations et la mécanique des tâches.

- **Pistes** : `GET` / `POST /api/projects/{id}/tracks`, `PUT` / `DELETE /api/tracks/{track_id}` (la suppression retire les annotations de la piste), `POST /api/tracks/{track_id}/delete-block` (retirer les annotations d'une plage de frames), `POST /api/projects/{id}/tracks/merge` (`track_id_keep`, `track_id_merge`), `DELETE /api/projects/{id}/tracks` (supprimer toutes les pistes, annotations gardées et détachées), et `POST /api/annotations/{annotation_id}/track` (`action` `new`, `assign` ou `detach`).
- **SAMURAI / SAM2 vidéo** : `POST /api/projects/{id}/sam2-tracking/run` avec `reference_frame_id`, `annotation_ids`, `end_frame_id` (avant la référence signifie vers l'arrière), `output_mode` (`bbox` ou `segmentation`) et `tracking_mode` (`auto` ou `samurai_per_object`). `GET /api/samurai/status` indique la disponibilité de SAMURAI et une estimation GPU (`est_max_frames_gpu`).
- **Tracking guidé (Detect.)** : `POST /api/projects/{id}/guided-tracking/run` avec la frame de référence, les annotations cibles, la plage de frames, `algorithm` (`grounding_dino` ou `sam3`), `text_prompt` (obligatoire), les seuils, `max_centroid_distance`, `size_variation_threshold`, `sam3_output_mode` et les paramètres d'auto-stop. Les seuils ne servent qu'à Grounding DINO ; les détections SAM3 ne sont pas filtrées. Chaque cible garde sa piste ou en reçoit une nouvelle, et les annotations sont enregistrées avec `source_algorithm` `guided_tracking`. Le résultat liste les anomalies (`missing`, `size_variation`).
- **Homographie et flux optique** : `POST /api/projects/{id}/homography/propagate` avec `keyframe_id`, `end_frame_id`, `annotation_ids`, les paramètres RANSAC et XFeat et `use_optical_flow` (vrai pour Lucas-Kanade avec les paramètres `optflow_*`). Les défauts de l'API (4096 points, 3,0 px, 30 inliers, ratio 0,5) sont plus stricts que ceux de l'interface, tirés des réglages, et `use_optical_flow` vaut `true` par défaut : envoyez `false` explicitement pour l'homographie. La frame de fin doit suivre la keyframe (vers l'avant seulement) ; les résultats sont enregistrés comme boîtes avec `is_auto` et `is_interpolated`, le `track_id` de la source et le `source_algorithm` `homography` ou `optical_flow`. `GET /api/homography/status` et `GET /api/projects/{id}/homography/debug` servent l'onglet Debug ; le endpoint de debug accepte un `min_inlier_ratio` optionnel (0 à 1) pour juger la validité.
- **ByteTrack** : `POST /api/projects/{id}/bytetrack/run` reste disponible par l'API uniquement.
- **Tâches** : `GET /api/tasks/{task_id}` (état), `GET /api/tasks/{task_id}/logs?since=N` (lignes de log incrémentales), `POST .../stop`, `.../pause`, `.../resume`, et `WS /ws/tasks/{task_id}` (changements d'état et `live_frames`, voir [Architecture](architecture.fr.md)).

## Endpoints d'export

Le router d'export produit des datasets en tâches de fond.

- `POST /api/projects/{id}/export` démarre un export et renvoie `task_id`. Corps : `output_format` (`yolo`, `coco` ou `ver`), `split_train`, `split_val`, `split_test` (0,8 / 0,1 / 0,1 par défaut), `include_unannotated` (vrai par défaut), `class_filter` (liste d'identifiants de classes, toutes par défaut), `export_name`, `symlink_images` (vrai par défaut : dossier de dataset avec liens, pas de ZIP) et `custom_export_dir` (mode solo seulement).
- `GET /api/exports/{task_id}/status` renvoie `status`, `progress`, `message` et, une fois terminé, le chemin de sortie.
- `GET /api/exports/{task_id}/download` renvoie le ZIP d'un export en mode copie ; en mode liens symboliques, il répond 400 car il n'y a pas de ZIP.
- `GET /api/projects/{id}/export/preview` calcule ce que contiendrait un export (compteurs par partie et par classe) sans rien écrire.

Organisation des sorties : YOLO écrit des dossiers `<séquence>-yolo/` (à plat pour une seule séquence) avec `data.yaml`, plus `seg_labels/` et `seg_data.yaml` quand des polygones existent ; COCO écrit `<séquence>-coco/` avec `annotations/instances_{split}.json` ; `.ver` écrit un `<séquence>.ver` par séquence. Les exports réussis enregistrent `last_export_at` et `last_export_format` sur chaque séquence. Les détails des formats sont dans [Concepts](concepts.fr.md) et [Architecture](architecture.fr.md).

## Endpoints des exemples, réglages, stockage et workspace

Ces petits routers servent l'interface autour des projets.

- **Exemples** (`/api/samples`) : `GET /api/samples/sequences` liste les séquences d'exemple de la suite (`data_tuto/`, ou `CV_DATA_TUTO`), `GET /api/samples/sequences/{sample_id}` en décrit une ; le tutoriel interactif y importe son projet de démonstration.
- **Réglages** : `GET /api/settings` renvoie les réglages utilisateur fusionnés (valeurs par défaut complétées), `PUT /api/settings` fusionne une mise à jour partielle, `POST /api/settings/reset` restaure les valeurs par défaut. `GET /api/workspace/info` renvoie les chemins du workspace ; `POST /api/workspace/reveal` l'ouvre sur la machine du serveur.
- **Stockage** : `GET /api/storage/stats` donne la taille des projets, des sauvegardes et des exports ; `DELETE /api/storage/backup` et `DELETE /api/storage/exports` vident ces dossiers.
- **Utilitaires de workspace** (définis dans `main.py`) : `POST /api/workspace/open` ouvre un dossier dans l'explorateur de fichiers de la machine du backend ou, pour une session distante, renvoie son chemin UNC ; `GET /api/workspace/open-cmd` renvoie un fichier `.cmd` d'une ligne qui ouvre le dossier dans l'explorateur Windows ; `GET /api/workspace/users` et `GET /api/workspace/history` alimentent le badge utilisateur.
- **Monitoring** (défini dans `main.py`) : `GET /api/monitoring/stats?scope=me|all` renvoie les statistiques agrégées de la page Monitoring ; `GET /api/monitoring/report?scope=...` télécharge le rapport HTML autonome.

## Endpoints de conversion

Le router de conversion fournit des conversions entre formats d'annotation et de séquence, indépendamment des projets. Tous les chemins sont des chemins serveur ; les sorties ne doivent pas déjà exister.

- `POST /api/convert/ver-to-yolo` : fichier `.ver` (pixels) vers un dossier YOLO normalisé ; exige la largeur et la hauteur des images.
- `POST /api/convert/yolo-to-ver` : dossier YOLO vers un fichier `.ver` ; la classe est répétée dans les trois colonnes de classe et `track_id` vaut `-1`.
- `POST /api/convert/format specialise-to-png` et `POST /api/convert/png-to-format specialise` : conversions du format optionnel format specialise.
- `POST /api/convert/video_to_format specialise` (router du dataset) : convertit une vidéo en format specialise en tâche de fond.

La page Convert de l'interface utilise les deux premiers. Les conversions sont synchrones sauf `video_to_format specialise`, et renvoient des compteurs (classes, boîtes ou frames écrites).

## Endpoints d'intégration avec l'Orchestrator

Le router `/api/orchestrator` est le contrat avec Orchestrator App ; ses endpoints sont conçus pour être appelés par un autre backend et restent stables.

- `GET /api/orchestrator/check-source?subset_name=...` liste les projets existants dont la source correspond déjà à un sous-ensemble, pour que l'Orchestrator prévienne avant de créer un doublon.
- `POST /api/orchestrator/create-project` : `subset_name`, `project_name` facultatif, `label_classes`, `import_path` (dossier explicite) et `mode` (`sequence` ou `random`). Les images sont cherchées dans le chemin explicite, puis dans `<workspace>/imports/<sous-ensemble>` ; l'import tourne en tâche de fond.
- `GET /api/orchestrator/project-status?project_name=...` renvoie l'avancement de l'import et de l'annotation (frames annotées sur le total), interrogé par l'Orchestrator pour dessiner la progression sous son node.
- `POST /api/orchestrator/auto-annotate` : `project_name`, `model` (`sam3` ou `grounding_dino`), `text_prompt`, `threshold` (0,20 par défaut) ; lance la détection par texte sur chaque frame.
- `POST /api/orchestrator/export-yolo` : `project_name`, `export_name` facultatif, découpage (0,8 / 0,2 / 0,0 par défaut), `wait_timeout_s`, `reuse_if_exists`. Un export existant de même signature de contenu est réutilisé ; sinon le premier nom libre est utilisé, sans jamais écraser.
- `POST /api/orchestrator/export-ver` : export `.ver` du projet, toujours produit avec l'export YOLO dans les pipelines Orchestrator.

`GET /api/app-mode` indique au frontend si l'application a été lancée par l'Orchestrator (`LAUNCHED_BY_ORCHESTRATOR`) et où vont les exports.

## Endpoints de santé et de l'application

Quelques endpoints définis dans `main.py` décrivent l'application elle-même.

- `GET /health` renvoie `{"status": "ok", "api": "running", "sam2": {...}, "database": "connected"}`. VisionNexus l'interroge avant d'ouvrir l'onglet Annotation, car le chargement des modèles prend 10 à 40 secondes.
- `GET /` renvoie des liens vers `/docs`, `/redoc` et `/health`.
- `GET /api/capabilities` renvoie `{"specific_formats": [...]}`, les formats de séquence optionnels trouvés par le registre de formats (libellé, extensions, contrat d'import). La fenêtre d'import construit ses extensions acceptées à partir de cette liste.
- `GET /api/app-mode` renvoie `mode` (`solo` ou `orchestrator`), `exports_dir` et `workspace`.
- `GET /api/sam/ping` donne un état SAM2 court pour l'interface.
- `GET /api/docs`, `GET /api/docs/{name}` et `GET /api/docs/assets/{path}` servent cette documentation à la page de documentation intégrée.

Utilisez d'abord `GET /health` et `GET /api/sam/ping` pour diagnostiquer une installation (voir [Dépannage](troubleshooting.fr.md)). La documentation Swagger interactive sur `/docs` liste chaque endpoint avec son schéma de requête et permet de les appeler directement.

## Index des endpoints

<!-- generated:start -->
### Annotations

| Method | Path | Summary | Source |
|---|---|---|---|
| DELETE | `/api/annotations/{annotation_id}` | Supprime une annotation, met à jour les compteurs et recalcule les bornes du track associé. | `Annotation_App/backend/models/routers/annotation.py:379` |
| PUT | `/api/annotations/{annotation_id}` | Met à jour partiellement une annotation (position, classe, etc.). Utilisé lors du redimensionnement ou déplacement d'une box sur le canvas. | `Annotation_App/backend/models/routers/annotation.py:332` |
| GET | `/api/frames/{frame_id}/annotations` | Retourne toutes les annotations d'une frame. | `Annotation_App/backend/models/routers/annotation.py:184` |
| POST | `/api/frames/{frame_id}/annotations` | Crée une nouvelle annotation sur une frame. Valide les coordonnées YOLO avant insertion. | `Annotation_App/backend/models/routers/annotation.py:198` |
| DELETE | `/api/frames/{frame_id}/annotations/all` | Supprime toutes les annotations d'une frame. | `Annotation_App/backend/models/routers/annotation.py:552` |
| POST | `/api/frames/{frame_id}/annotations/bulk` | Ajoute plusieurs annotations en une seule requête. Si replace=True, supprime toutes les annotations existantes avant l'insertion. Utilisé pour sauvegarder les résultats d'une auto-segmentation SAM2. | `Annotation_App/backend/models/routers/annotation.py:432` |
| POST | `/api/frames/{frame_id}/annotations/nms` | Applique le Non-Maximum Suppression (NMS) sur les annotations d'une frame. Supprime les annotations redondantes qui se chevauchent trop. Conserve l'annotation avec la meilleure confiance dans chaque groupe. | `Annotation_App/backend/models/routers/annotation.py:1041` |
| POST | `/api/frames/{frame_id}/copy-to` | Copie toutes les annotations d'une frame vers une ou plusieurs frames cibles. Utile pour propager manuellement des annotations vers la frame suivante. | `Annotation_App/backend/models/routers/annotation.py:745` |
| GET | `/api/frames/{frame_id}/overlaps` | Détecte les annotations en doublon sur une frame (IoU > seuil). Utile pour identifier les objets annotés deux fois par erreur. | `Annotation_App/backend/models/routers/annotation.py:810` |
| GET | `/api/projects/{project_id}/annotations/all` | Retourne toutes les annotations du projet en une seule requete (cache client). | `Annotation_App/backend/models/routers/annotation.py:168` |
| DELETE | `/api/projects/{project_id}/annotations/batch` | Supprime plusieurs annotations en une seule requete. Verifie que chaque annotation appartient bien au projet. Met a jour les statuts de frames et compteurs du projet. | `Annotation_App/backend/models/routers/annotation.py:1185` |
| POST | `/api/projects/{project_id}/annotations/delete-frames` | Supprime toutes les annotations de PLUSIEURS frames en UNE transaction. | `Annotation_App/backend/models/routers/annotation.py:589` |
| DELETE | `/api/projects/{project_id}/annotations/from-frame` | Supprime toutes les annotations a partir de la frame N (incluse). Utile pour repartir proprement apres un echec de tracking ou de propagation. | `Annotation_App/backend/models/routers/annotation.py:1229` |
| POST | `/api/projects/{project_id}/annotations/redo-bulk-delete` | Refait la suppression annulée : re-supprime les annotations restaurées. | `Annotation_App/backend/models/routers/annotation.py:724` |
| GET | `/api/projects/{project_id}/annotations/summary` | Retourne toutes les annotations du projet avec leur contexte de frame. Utilise pour le panneau de resume global multi-frames. | `Annotation_App/backend/models/routers/annotation.py:1120` |
| POST | `/api/projects/{project_id}/annotations/undo-bulk-delete` | Annule la dernière suppression groupée : re-crée les annotations effacées. | `Annotation_App/backend/models/routers/annotation.py:701` |
| GET | `/api/projects/{project_id}/annotations/validate` | Valide toutes les annotations du projet avant export. Vérifie que les coordonnées sont dans [0, 1] et détecte les incohérences. | `Annotation_App/backend/models/routers/annotation.py:983` |
| POST | `/api/projects/{project_id}/interpolate` | Génère des annotations interpolées entre deux frames annotées manuellement. Utile pour combler les lacunes de tracking sur de courtes séquences. | `Annotation_App/backend/models/routers/annotation.py:856` |

### Capabilities

| Method | Path | Summary | Source |
|---|---|---|---|
| GET | `/api/capabilities` | Expose optional formats without coupling the frontend to a plugin name. | `Annotation_App/backend/main.py:272` |

### Convert

| Method | Path | Summary | Source |
|---|---|---|---|
| POST | `/api/convert/format specialise-to-png` | `convert_format specialise_to_png()` | `Annotation_App/backend/models/routers/convert.py:69` |
| POST | `/api/convert/png-to-format specialise` | `convert_png_to_format specialise()` | `Annotation_App/backend/models/routers/convert.py:80` |
| POST | `/api/convert/ver-to-yolo` | `convert_ver_to_yolo()` | `Annotation_App/backend/models/routers/convert.py:91` |
| POST | `/api/convert/yolo-to-ver` | `convert_yolo_to_ver()` | `Annotation_App/backend/models/routers/convert.py:101` |

### Dataset

| Method | Path | Summary | Source |
|---|---|---|---|
| POST | `/api/convert/video_to_format specialise` | Convertit un fichier vidéo (MP4, AVI...) en format specialise par lecture séquentielle. | `Annotation_App/backend/models/routers/dataset.py:2429` |
| GET | `/api/files/browse` | Liste les fichiers et dossiers d'un chemin serveur. Permet au frontend d'explorer le filesystem pour sélectionner un dossier d'images ou un fichier vidéo sans copier-coller. | `Annotation_App/backend/models/routers/dataset.py:2086` |
| GET | `/api/files/browse-history` | Derniers dossiers serveur parcourus (le plus recent en tete). | `Annotation_App/backend/models/routers/dataset.py:2040` |
| POST | `/api/files/browse-history` | Enregistre un dossier dans l'historique de navigation de l'utilisateur. | `Annotation_App/backend/models/routers/dataset.py:2055` |
| GET | `/api/frames/{frame_id}` | Retourne le détail d'une frame avec toutes ses annotations. C'est l'endpoint principal utilisé par le canvas d'annotation. | `Annotation_App/backend/models/routers/dataset.py:1407` |
| GET | `/api/frames/{frame_id}/histogram` | Histogramme des valeurs BRUTES de la frame (avant LUT), pour l'outil LUT. Lit la source réelle : format specialise décodé à la volée, sinon le fichier image UNCHANGED (préserve le 16 bits). Retourne bins/counts/min/max/mean/std/bit_depth. | `Annotation_App/backend/models/routers/dataset.py:1941` |
| GET | `/api/frames/{frame_id}/image` | Sert le fichier image d'une frame. - Extraite dans frames_dir standard -> FileResponse. - format specialise : fichier dans {format specialise_parent}/{format specialise_stem}_png/ -> FileResponse. - Non extraite ou introuvable -> placeholder gris. - preview=1 : JPEG 480 px (scrubbing du slider). - display=1 : JPEG 1600 px (affichage canvas au zoom ajuste). Le frontend rebascule sur la source pleine resolution au zoom fort. Le traitement IA (SAMURAI) et l'export lisent TOUJOURS la source, jamais ces versions reduites. | `Annotation_App/backend/models/routers/dataset.py:1700` |
| GET | `/api/frames/{frame_id}/image-path` | Variante legere de GET /image : au lieu de streamer les octets, garantit que le fichier cache existe deja sur disque puis renvoie son chemin natif. Pensee pour la coquille Electron (plan SMB) : cet endpoint ne transite que via le tunnel SSH avec un JSON minuscule ; les pixels (10-800 Ko/image) sont ensuite lus directement via le partage reseau, en contournant le tunnel pour la partie qui coute reellement cher. | `Annotation_App/backend/models/routers/dataset.py:1897` |
| PUT | `/api/frames/{frame_id}/keyframe` | Marque/démarque une frame comme keyframe pour le tracking. | `Annotation_App/backend/models/routers/dataset.py:1490` |
| POST | `/api/frames/{frame_id}/mark-empty` | Marque une frame comme explicitement vide (aucun objet d'intérêt). Lors de l'export YOLO, génère un fichier .txt vide pour cette frame. | `Annotation_App/backend/models/routers/dataset.py:1457` |
| GET | `/api/frames/{frame_id}/thumbnail` | Sert la miniature 160x90 d'une frame. - Miniature sur disque (data/projects/{id}/thumbnails/) -> FileResponse. - Non extraite -> placeholder gris. | `Annotation_App/backend/models/routers/dataset.py:1992` |
| GET | `/api/projects/{project_id}/frames` | Liste les frames d'un projet avec pagination. Supporte le filtrage des frames annotées uniquement, et par séquence. | `Annotation_App/backend/models/routers/dataset.py:1201` |
| GET | `/api/projects/{project_id}/frames/by-index/{frame_index}` | Retourne une frame par son index logique. Utilise pour la navigation sparse: le frontend peut sauter directement a F2400 sans charger toutes les frames precedentes. NOTE: la reparation des records est intentionnellement absente ici (hot path de navigation - appele a chaque frame). La reparation se fait uniquement via list_frames (chargement initial). | `Annotation_App/backend/models/routers/dataset.py:1375` |
| POST | `/api/projects/{project_id}/frames/ensure_extracted` | Extrait à la demande les frames autour de `center_frame_index` qui ne sont pas encore extraites physiquement (is_extracted=False). | `Annotation_App/backend/models/routers/dataset.py:1112` |
| POST | `/api/projects/{project_id}/import/folder` | Importe toutes les images d'un dossier local en arrière-plan. Retourne immédiatement un task_id pour suivre la progression via GET /api/tasks/{task_id}. Supporte les grands dossiers (2000+ images) sans timeout. | `Annotation_App/backend/models/routers/dataset.py:582` |
| POST | `/api/projects/{project_id}/import/images` | Importe des images dans le projet via upload multipart. Génère les miniatures et crée les entrées en base de données. Supporte : .jpg, .jpeg, .png, .bmp, .tiff, .webp | `Annotation_App/backend/models/routers/dataset.py:486` |
| POST | `/api/projects/{project_id}/import/format specialise` | Import fichier .optional uploade - extraction complete vers PNG en arriere-plan. Le fichier format specialise est sauvegarde dans data/projects/{id}/ et converti en PNG dans data/projects/{id}/{stem}_png/ avant d'entrer dans le projet. | `Annotation_App/backend/models/routers/dataset.py:935` |
| POST | `/api/projects/{project_id}/import/specific` | Import an uploaded sequence through an optional format adapter. | `Annotation_App/backend/models/routers/dataset.py:896` |
| POST | `/api/projects/{project_id}/import/video` | Import vidéo - mode lazy : | `Annotation_App/backend/models/routers/dataset.py:713` |
| POST | `/api/projects/{project_id}/import/video_from_path` | Import vidéo depuis un chemin sur le serveur - aucun upload. Identique à import_video mais sans copier le fichier source. La vidéo n'est JAMAIS supprimée (elle n'appartient pas au projet). | `Annotation_App/backend/models/routers/dataset.py:2179` |
| GET | `/api/projects/{project_id}/sequences` | Liste les séquences d'un projet (multi-séquence) avec leurs statistiques d'annotation : nombre de frames, frames annotées, nombre d'annotations. Les frames de chaque séquence occupent la plage globale [start_index, start_index + frame_count). | `Annotation_App/backend/models/routers/dataset.py:1249` |
| POST | `/api/projects/{project_id}/sequences/{sequence_id}/import-annotations` | Importe des annotations .ver / YOLO sur une séquence (S9). Convertit vers le format interne (YOLO normalisé), crée classes/tracks manquants, et associe les détections aux frames de la séquence (.ver : frame 1-based ; YOLO : par stem sinon par ordre). `replace` remplace les annotations existantes de la séquence. | `Annotation_App/backend/models/routers/dataset.py:128` |
| POST | `/api/projects/{project_id}/sequences/{sequence_id}/import-annotations-upload` | Variante UPLOAD de l'import d'annotations (drag & drop navigateur) : reçoit un ou plusieurs fichiers (un .ver, OU un dossier YOLO de .txt + data.yaml), les écrit dans un dossier temporaire serveur, puis réutilise _do_import_annotations. Le format est auto-détecté d'après les extensions reçues. | `Annotation_App/backend/models/routers/dataset.py:246` |
| POST | `/api/sequences/parse-manifest` | Lit un .txt de manifeste de séquences côté serveur (une ligne « source_path<TAB>nom », ou séparée par espace) et retourne les entrées pour pré-remplir l'import. Généré par le backup (step3b) -> récupération de projet. | `Annotation_App/backend/models/routers/dataset.py:54` |
| DELETE | `/api/sequences/{sequence_id}/lut` | Efface la LUT propre à la séquence -> repli sur la LUT projet. | `Annotation_App/backend/models/routers/dataset.py:1362` |
| PUT | `/api/sequences/{sequence_id}/lut` | Définit la LUT d'affichage PROPRE à une séquence (persistée, prioritaire sur la LUT projet). Renvoie la signature de cache pour le cache-buster. | `Annotation_App/backend/models/routers/dataset.py:1344` |

### Docs

| Method | Path | Summary | Source |
|---|---|---|---|
| GET | `/api/docs` | Pages du jeu de docs, triees par `order`, avec les langues disponibles. | `Annotation_App/backend/models/routers/docs.py:163` |
| GET | `/api/docs/assets/{asset_path:path}` | `get_doc_asset()` | `Annotation_App/backend/models/routers/docs.py:187` |
| GET | `/api/docs/{name}` | Une page : frontmatter + corps markdown, avec repli de langue. | `Annotation_App/backend/models/routers/docs.py:197` |

### Export

| Method | Path | Summary | Source |
|---|---|---|---|
| GET | `/api/exports/{task_id}/download` | Télécharge le fichier ZIP de l'export YOLO. N'est disponible qu'une fois la tâche terminée (status=completed). | `Annotation_App/backend/models/routers/export.py:542` |
| GET | `/api/exports/{task_id}/status` | Retourne le statut d'une tâche d'export. Utilisé par le frontend pour poller la progression. | `Annotation_App/backend/models/routers/export.py:521` |
| POST | `/api/projects/{project_id}/export` | Lance l'export du dataset en arrière-plan. Retourne un task_id pour suivre la progression et télécharger le fichier. | `Annotation_App/backend/models/routers/export.py:81` |
| GET | `/api/projects/{project_id}/export/preview` | Génère un aperçu de ce qui sera exporté : statistiques par classe, distribution des splits, validation des coordonnées. Utilisé par le modal d'export pour informer l'utilisateur avant le lancement. | `Annotation_App/backend/models/routers/export.py:576` |

### main

| Method | Path | Summary | Source |
|---|---|---|---|
| GET | `/api/app-mode` | Retourne si l'app est lancée par l'Orchestrateur ou en mode solo. | `Annotation_App/backend/main.py:259` |

### Monitoring

| Method | Path | Summary | Source |
|---|---|---|---|
| GET | `/api/monitoring/report` | Genere et renvoie le rapport HTML autonome (meme sortie que l'outil CLI). | `Annotation_App/backend/main.py:430` |
| GET | `/api/monitoring/stats` | Statistiques d'usage. | `Annotation_App/backend/main.py:393` |

### orchestrator

| Method | Path | Summary | Source |
|---|---|---|---|
| POST | `/api/orchestrator/auto-annotate` | `auto_annotate()` | `Annotation_App/backend/models/routers/orchestrator.py:622` |
| GET | `/api/orchestrator/check-source` | `check_source()` | `Annotation_App/backend/models/routers/orchestrator.py:102` |
| POST | `/api/orchestrator/create-project` | `create_project()` | `Annotation_App/backend/models/routers/orchestrator.py:119` |
| POST | `/api/orchestrator/export-ver` | `export_ver_orchestrator()` | `Annotation_App/backend/models/routers/orchestrator.py:547` |
| POST | `/api/orchestrator/export-yolo` | `export_yolo_orchestrator()` | `Annotation_App/backend/models/routers/orchestrator.py:398` |
| GET | `/api/orchestrator/project-status` | `project_status()` | `Annotation_App/backend/models/routers/orchestrator.py:261` |

### Projets

| Method | Path | Summary | Source |
|---|---|---|---|
| GET | `/api/projects` | Liste tous les projets avec leurs statistiques de base, ainsi qu'un résumé par séquence (multi-séquence) pour l'affichage de la page d'accueil. Retourne un résumé sans les données volumineuses (frames, annotations). | `Annotation_App/backend/models/routers/projects.py:74` |
| POST | `/api/projects` | Crée un nouveau projet d'annotation avec ses classes initiales. Génère automatiquement le fichier classes.yaml et initialise la session. | `Annotation_App/backend/models/routers/projects.py:133` |
| DELETE | `/api/projects/{project_id}` | Supprime un projet et TOUTES ses données associées (en cascade manuelle). Ordre imposé par les FK : annotations -> frames -> tracks -> sequences -> classes -> session -> projet. Bulk DELETE (rapide + fiable même sur gros projets). Supprime aussi le dossier physique data/projects/{project_id}/. | `Annotation_App/backend/models/routers/projects.py:353` |
| GET | `/api/projects/{project_id}` | Retourne le détail d'un projet incluant ses classes et sa session sauvegardée. | `Annotation_App/backend/models/routers/projects.py:245` |
| PUT | `/api/projects/{project_id}` | Met à jour les métadonnées d'un projet existant. | `Annotation_App/backend/models/routers/projects.py:325` |
| GET | `/api/projects/{project_id}/backup` | Exporte toutes les annotations du projet en JSON. Utile pour la sauvegarde automatique et le rechargement de session. | `Annotation_App/backend/models/routers/projects.py:707` |
| POST | `/api/projects/{project_id}/backup/save` | Sauvegarde les annotations du projet dans un fichier JSON sur le serveur. Cree un dossier backup/project_name_date/ contenant project_name_date.json. Appele automatiquement toutes les 2 minutes par le frontend. | `Annotation_App/backend/models/routers/projects.py:729` |
| GET | `/api/projects/{project_id}/classes` | Liste toutes les classes d'un projet dans l'ordre. | `Annotation_App/backend/models/routers/projects.py:522` |
| POST | `/api/projects/{project_id}/classes` | Ajoute une nouvelle classe au projet. | `Annotation_App/backend/models/routers/projects.py:555` |
| DELETE | `/api/projects/{project_id}/classes/{class_id}` | Supprime une classe. Attention : les annotations liées conservent la référence. | `Annotation_App/backend/models/routers/projects.py:629` |
| PUT | `/api/projects/{project_id}/classes/{class_id}` | Met à jour une classe existante (nom, couleur, raccourci). | `Annotation_App/backend/models/routers/projects.py:597` |
| GET | `/api/projects/{project_id}/lut` | `get_project_lut()` | `Annotation_App/backend/models/routers/projects.py:216` |
| PUT | `/api/projects/{project_id}/lut` | Définit la LUT d'affichage du projet (persistée). Renvoie la signature de cache. | `Annotation_App/backend/models/routers/projects.py:226` |
| POST | `/api/projects/{project_id}/restore` | Restaure les annotations depuis un JSON de sauvegarde, en REDISPATCHANT par SÉQUENCE (résilient aux ids DB différents après recréation du projet, aux séquences manquantes et à l'ordre différent). | `Annotation_App/backend/models/routers/projects.py:788` |
| GET | `/api/projects/{project_id}/session` | Récupère l'état de session sauvegardé pour un projet. | `Annotation_App/backend/models/routers/projects.py:451` |
| PUT | `/api/projects/{project_id}/session` | Met à jour l'état de session (sauvegarde automatique toutes les 30s). Crée la session si elle n'existe pas encore. | `Annotation_App/backend/models/routers/projects.py:474` |
| GET | `/api/projects/{project_id}/stats` | Statistiques détaillées du projet : distribution par classe, taux d'annotation, nombre de pistes, etc. | `Annotation_App/backend/models/routers/projects.py:407` |

### SAM2

| Method | Path | Summary | Source |
|---|---|---|---|
| GET | `/api/sam/grounding/status` | Retourne le statut du service Grounding DINO. | `Annotation_App/backend/models/routers/sam.py:225` |
| POST | `/api/sam/load` | Charge ou recharge le modèle SAM2 avec la taille spécifiée. Sur CPU, force automatiquement le modèle 'tiny'. | `Annotation_App/backend/models/routers/sam.py:76` |
| GET | `/api/sam/ping` | Endpoint de test rapide pour vérifier que SAM2 est chargé et opérationnel. Utilisé par le frontend pour afficher l'état du modèle dans les paramètres. | `Annotation_App/backend/main.py:524` |
| POST | `/api/sam/predict/points` | Segmentation interactive SAM2 par points de prompt. Retourne jusqu'à 3 masques candidats triés par score décroissant. | `Annotation_App/backend/models/routers/sam.py:86` |
| POST | `/api/sam/predict/text` | Segmentation guidée par texte : Grounding DINO -> boîtes -> SAM2 -> masques. | `Annotation_App/backend/models/routers/sam.py:152` |
| GET | `/api/sam/status` | Retourne l'état du service SAM2 : - Modèle chargé ou non - Dispositif (CPU/GPU) - Mémoire GPU utilisée - Sessions vidéo actives | `Annotation_App/backend/models/routers/sam.py:64` |
| POST | `/api/sam3/load` | Charge le modèle SAM3.1 en mémoire. Nécessite le checkpoint dans backend/checkpoints/sam3.1_hiera_large.pt (téléchargeable avec python backend/tests/download_sam3.py après accès HF) | `Annotation_App/backend/models/routers/sam.py:525` |
| POST | `/api/sam3/predict/text` | Détection et segmentation par texte open-vocabulary avec SAM3.1. Supporte 4M+ concepts sans training supplémentaire. | `Annotation_App/backend/models/routers/sam.py:547` |
| GET | `/api/sam3/status` | Statut du service SAM3 : - installed: SAM3 est installé dans l'environnement - checkpoint_exists: checkpoint disponible sur le disque - loaded: modèle chargé en mémoire GPU/CPU | `Annotation_App/backend/models/routers/sam.py:513` |
| WS | `/ws/sam/image` | WebSocket pour la segmentation automatique d'images avec streaming des résultats. | `Annotation_App/backend/models/routers/sam.py:234` |
| WS | `/ws/sam/video` | WebSocket pour la session de propagation vidéo SAM2. | `Annotation_App/backend/models/routers/sam.py:339` |

### Samples

| Method | Path | Summary | Source |
|---|---|---|---|
| GET | `/api/samples/sequences` | Liste les sequences d'exemple embarquees (chemin absolu cote backend). | `Annotation_App/backend/models/routers/samples.py:43` |
| GET | `/api/samples/sequences/{sample_id}` | Detail d'une sequence d'exemple. 404 si le dossier livre est absent. | `Annotation_App/backend/models/routers/samples.py:55` |

### Santé

| Method | Path | Summary | Source |
|---|---|---|---|
| GET | `/` | Page d'accueil de l'API avec liens utiles. | `Annotation_App/backend/main.py:282` |
| GET | `/api/workspace/history` | Retourne l'historique des workspaces (seulement les dossiers encore existants). Chaque entree: {"path": str, "user": str}. | `Annotation_App/backend/main.py:492` |
| POST | `/api/workspace/open` | Ouvre un dossier dans l'explorateur de fichiers. | `Annotation_App/backend/main.py:340` |
| GET | `/api/workspace/open-cmd` | Renvoie un petit script .cmd qui ouvre le dossier dans l'Explorateur Windows. | `Annotation_App/backend/main.py:459` |
| GET | `/api/workspace/users` | `workspace_users()` | `Annotation_App/backend/main.py:310` |
| GET | `/health` | Vérification de l'état de l'application : - API FastAPI opérationnelle - État du modèle SAM2 (chargé, dispositif, mémoire GPU) | `Annotation_App/backend/main.py:294` |

### Settings

| Method | Path | Summary | Source |
|---|---|---|---|
| GET | `/api/settings` | Retourne les paramètres utilisateur courants. Fusionne avec les valeurs par défaut si des clés sont manquantes. | `Annotation_App/backend/models/routers/settings.py:22` |
| PUT | `/api/settings` | Met à jour les paramètres utilisateur (fusion partielle profonde). Seules les sections envoyées sont mises à jour. | `Annotation_App/backend/models/routers/settings.py:31` |
| POST | `/api/settings/reset` | Remet tous les paramètres aux valeurs par défaut. Écrase le fichier user_settings.json avec les defaults. | `Annotation_App/backend/models/routers/settings.py:43` |
| GET | `/api/workspace/info` | Retourne le chemin du dossier de données du workspace. | `Annotation_App/backend/models/routers/settings.py:52` |
| POST | `/api/workspace/reveal` | Ouvre le dossier workspace dans l'explorateur de fichiers du serveur. Fonctionne sur Windows (Explorer), macOS (Finder), Linux (xdg-open). path optionnel : sous-dossier à ouvrir (relatif à DATA_DIR ou absolu). | `Annotation_App/backend/models/routers/settings.py:58` |

### Stockage

| Method | Path | Summary | Source |
|---|---|---|---|
| DELETE | `/api/storage/backup` | Vide le dossier backup (JSON de sauvegarde d'annotations). | `Annotation_App/backend/models/routers/storage.py:62` |
| DELETE | `/api/storage/exports` | Vide le dossier exports (ZIP YOLO générés). | `Annotation_App/backend/models/routers/storage.py:71` |
| GET | `/api/storage/stats` | Retourne la taille en Mo de chaque dossier du workspace. | `Annotation_App/backend/models/routers/storage.py:47` |

### Tracking

| Method | Path | Summary | Source |
|---|---|---|---|
| POST | `/api/annotations/{annotation_id}/track` | Assigne une track à une annotation (suivi objet / MOT) : - action="new" : crée une nouvelle track (uid incrémental, couleur, classe de l'annotation) et l'assigne ; - action="assign" : assigne une track existante (track_id) ; - action="detach" : détache (track_id = None). Met à jour la plage [start_frame, end_frame] de la track pour inclure la frame. | `Annotation_App/backend/models/routers/tracking.py:344` |
| GET | `/api/homography/status` | Retourne la methode de matching active (xfeat ou sift) et les parametres courants. | `Annotation_App/backend/models/routers/tracking.py:1581` |
| POST | `/api/projects/{project_id}/bytetrack/run` | Lance ByteTrack sur une plage de frames avec les annotations existantes comme détections. Génère des IDs de piste stables et met à jour les annotations en base de données. Exécuté en arrière-plan pour ne pas bloquer l'API. | `Annotation_App/backend/models/routers/tracking.py:728` |
| POST | `/api/projects/{project_id}/guided-tracking/run` | Tracking Guide : selectionner N cibles sur une frame de reference, puis les suivre sur une plage de frames via Grounding DINO ou SAM3 avec matching par distance de centroide. | `Annotation_App/backend/models/routers/tracking.py:1172` |
| GET | `/api/projects/{project_id}/homography/debug` | Retourne les informations de debug de l'homographie entre deux frames : methode utilisee, nb keypoints, matches, inliers, ratio, et visualisation base64. Utile pour evaluer la qualite du matching XFeat / SIFT entre deux frames consecutives. | `Annotation_App/backend/models/routers/tracking.py:2360` |
| POST | `/api/projects/{project_id}/homography/propagate` | Propage des annotations depuis une keyframe vers les frames suivantes en utilisant l'homographie (compensation du mouvement de caméra). Les frames avec faible score homographique sont marquées en orange. | `Annotation_App/backend/models/routers/tracking.py:891` |
| POST | `/api/projects/{project_id}/sam2-tracking/run` | Tracking video SAM2 (style SAMURAI) : - Utilise les boxes annotees sur la frame de reference comme prompts SAM2 - Propage les masques sur les frames suivantes - Cree des annotations bbox ou polygone selon output_mode | `Annotation_App/backend/models/routers/tracking.py:1638` |
| DELETE | `/api/projects/{project_id}/tracks` | Supprime toutes les pistes de tracking d'un projet et detache les annotations associees. | `Annotation_App/backend/models/routers/tracking.py:1597` |
| GET | `/api/projects/{project_id}/tracks` | Liste toutes les pistes de tracking d'un projet (avec segments réels). | `Annotation_App/backend/models/routers/tracking.py:297` |
| POST | `/api/projects/{project_id}/tracks` | Crée une nouvelle piste manuellement. | `Annotation_App/backend/models/routers/tracking.py:317` |
| POST | `/api/projects/{project_id}/tracks/merge` | Fusionne deux pistes en une seule. Toutes les annotations de track_id_merge sont réassignées à track_id_keep. Utile quand un objet est perdu puis réidentifié avec un nouvel ID. | `Annotation_App/backend/models/routers/tracking.py:549` |
| GET | `/api/samurai/status` | Retourne si SAMURAI est disponible comme prédicteur vidéo. SAMURAI = fork de SAM2 avec filtre de Kalman, repo cloné dans backend/ext/samurai_repo/sam2. Installé via : pip install -e backend/ext/samurai_repo/sam2 Détection : présence du dossier ext/samurai_repo + _samurai_loaded=True sur le service. | `Annotation_App/backend/models/routers/tracking.py:2305` |
| GET | `/api/tasks/{task_id}` | Retourne le statut d'une tache en arriere-plan (ByteTrack, propagation, etc.) Statuts possibles : pending \| running \| completed \| error | `Annotation_App/backend/models/routers/tracking.py:597` |
| GET | `/api/tasks/{task_id}/logs` | Retourne les lignes de log de l'algo depuis l'index `since` (incrementiel). Alimente le panneau de logs temps reel du TrackPanel (memes lignes que le terminal serveur). Renvoie {"lines": [...], "next": <index a renvoyer>}. | `Annotation_App/backend/models/routers/tracking.py:610` |
| POST | `/api/tasks/{task_id}/pause` | Met une tache en pause (la boucle de traitement attend la reprise). | `Annotation_App/backend/models/routers/tracking.py:635` |
| POST | `/api/tasks/{task_id}/resume` | Reprend une tache en pause. | `Annotation_App/backend/models/routers/tracking.py:646` |
| POST | `/api/tasks/{task_id}/stop` | Demande l'arret propre d'une tache en cours (verifie le flag a la prochaine iteration). | `Annotation_App/backend/models/routers/tracking.py:624` |
| DELETE | `/api/tracks/{track_id}` | Supprime une piste et toutes ses annotations associées. | `Annotation_App/backend/models/routers/tracking.py:443` |
| PUT | `/api/tracks/{track_id}` | Met à jour les métadonnées d'une piste (classe, couleur, statut). | `Annotation_App/backend/models/routers/tracking.py:411` |
| POST | `/api/tracks/{track_id}/delete-block` | Supprime les annotations d'une piste sur une plage de frames (un 'bloc' de la timeline), sans toucher au reste de la piste. Si la piste devient vide, elle est supprimée aussi. | `Annotation_App/backend/models/routers/tracking.py:484` |
| WS | `/ws/tasks/{task_id}` | Pousse l'etat d'une tache en arriere-plan (statut, progression, current_frame_id, live_frame) au client DES QU'IL CHANGE, sur UNE seule connexion persistante. | `Annotation_App/backend/models/routers/tracking.py:657` |
<!-- generated:end -->
