*[Read in English](README.md)*

# Annotation App

Application FastAPI + React pour annoter des images et sequences video avec assistance IA.
Des formats de sequence supplementaires peuvent etre ajoutes par un adaptateur Python optionnel.

Etat de cette refonte : l'architecture workspace isolee et les endpoints orchestrateur sont conserves, mais le chargement media a ete rendu sparse et paresseux pour les gros datasets.

## Objectif

L'app est pensee pour des datasets lourds (ex : 4000 images en 3000 x 3000) et
un usage distant (backend sur VM via SSH, UI web sur Windows) :

- aucune vignette : la timeline affiche des compteurs d'annotations (vert/rouge) ;
- navigation slider fluide, prefetch des frames adjacentes, reponses API gzippees ;
- projets **multi-sequences** : dossiers d'images, videos et formats optionnels melanges dans un meme projet ;
- images **16 bits** (RGB ou IR) lues nativement (conversion 3-sigma -> 8 bits) ;
- classes hierarchiques : classe (detection) > sous-classe (reconnaissance) > sous-sous-classe (identification) ;
- affichage des traitements de tracking frame par frame en temps reel ;
- anomalies de suivi exposees pour correction manuelle ;
- export YOLO par sequence ou fichiers .ver (format texte natif) par sequence.

## Lancement

Depuis le launcher global :

```bash
cd <racine-suite>
python launcher.py --app annotation --workspace <racine-workspaces> --user <utilisateur>
```

Lancement direct :

```bash
cd <racine-suite>/Annotation_App
python launcher.py --workspace <racine-workspaces> --user <utilisateur>
```

Ports par defaut :

- backend : `http://localhost:8000`
- frontend : `http://localhost:5173`
- API docs : `http://localhost:8000/docs`

Sur VM Linux accessible depuis Windows via VS Code SSH, lancer le meme launcher dans la VM avec `--host 0.0.0.0` si le launcher l'expose, puis ouvrir le port forwarde `5173` cote Windows. Le frontend proxifie `/api` vers le backend ; si le backend s'arrete, les pollers coupent apres plusieurs echecs pour eviter le spam `ECONNREFUSED`.

Par defaut, le launcher demarre uvicorn avec les access logs desactives pour eviter le spam console. Ajouter `--access-log` au launcher si vous voulez voir chaque requete HTTP pendant un diagnostic.

Le launcher global accepte `--conda-path <chemin>` (racine de l'env conda, `bin/activate`,
ou executable python) — prioritaire sur `--conda-env`. Ce chemin est renseigne dans les
Parametres de VisionNexus (champ obligatoire) et transmis automatiquement a la commande SSH.

## Invariants Conserves

- Les donnees utilisateur restent dans `WORKSPACE/annotation_<user>/`.
- Les endpoints `/api/orchestrator/*` restent le contrat avec Orchestrator App.
- Les coordonnees d'annotation restent normalisees YOLO `[0, 1]` en base.
- SQLite reste en mode WAL, avec un seul worker uvicorn.
- Les fichiers projet restent sous `projects/{project_id}/frames`, `frames_8bit` (cache 16 bits), `exports`.

## Adaptateur De Format Optionnel

Le support format specialise est contenu dans un seul fichier amovible : `backend/utils/format specialise.py`.
`GET /api/capabilities` lit uniquement la constante `FORMAT_CAPABILITY` par AST ; le module
n'est importe que lorsqu'un fichier correspondant est traite. Le frontend construit alors
dynamiquement le libelle, les extensions acceptees, le drag-and-drop et l'import.

Retirer `backend/utils/format specialise.py`, puis redemarrer l'app, donne `specific_formats: []` : aucune
option format specialise n'apparait dans le frontend et les imports image/video standards continuent de
fonctionner. Le lecteur fait un seek direct vers la frame demandee et conserve le dtype natif ;
le fichier de validation de 1,8 Go a ete lu sur sa derniere frame sans charger la sequence.

## Media Et Performance

### Frames

`GET /api/projects/{id}/frames` retourne les metadonnees des frames (avec `annotation_count`). La timeline est virtualisee : seules les cellules visibles autour du scroll sont montees dans le DOM. Filtre optionnel `?sequence_id=` pour une sequence donnee.

Le store frontend ne fait plus d'auto-pagination recursive. Pour les datasets usuels, il charge les metadonnees en une passe large, puis laisse la timeline gerer le rendu sparse.

L'import dossier est maintenant incremental : la tache insere les frames en base par batch pendant que le dossier est scanne. La page peut donc commencer a afficher les frames deja importees sans attendre la fin des 4000 images.

Au chargement d'un projet existant, le backend verifie que les fichiers image presents sur disque ont bien un enregistrement `Frame` en base. Cela repare les imports interrompus ou les anciens projets ou seules quelques vignettes etaient navigables alors que `frame_count` annoncait plusieurs milliers de frames.

### Multi-sequence

Chaque import (dossier d'images, video ou format optionnel, par upload ou chemin serveur) cree une **Sequence**
dans le projet. Les frames sont ajoutees a la suite (frame_index globaux contigus) avec un
prefixe de fichier unique par sequence (`s001_frame_000000.jpg`).

- `GET /api/projects/{id}/sequences` : liste + stats (frames annotees, nb annotations).
- L'UI affiche une liste deroulante de sequences a gauche du slider : la selection
  saute au debut de la sequence, le libelle montre `annotees/total` et le nb d'annotations.

### Images 16 bits (RGB / IR)

Les dossiers d'images 16 bits (PNG/TIFF) sont importes tels quels (symlink zero copie).
Pour le visuel, `GET /api/frames/{id}/image` sert une version 8 bits (etirement 3-sigma)
mise en cache dans `frames_8bit/`. Tous les algos (SAM2/SAM3/GD/homographie/flux optique/
SAMURAI) chargent via `load_image_bgr_8bit` — meme rendu que le visuel.

### Extraction Lazy

Pour les videos, l'app conserve l'extraction en arriere-plan, mais le canvas demande aussi l'extraction locale autour de la frame active :

```text
POST /api/projects/{project_id}/frames/ensure_extracted
```

Pendant le scrubbing, la demande est debouncee et limitee pour eviter une cascade de seeks. Hors scrubbing, un petit voisinage est precharge.

## Timeline

La timeline est une barre sparse **sans aucune vignette** (notion supprimee — trop
couteuse en temps, surtout via SSH) :

- cellules compactes virtualisees : **vert** = frame annotee avec le nombre d'annotations,
  **rouge** = frame vide ;
- le compteur de la frame courante est mis a jour **en direct** a chaque ajout/suppression
  d'annotation (branche sur le store), sans reload web ;
- scroll horizontal sur toute la sequence, compteur frame courant ;
- lanes de tracks conservees au-dessus ;
- selection batch : `Ctrl`/`Cmd` + clic ajoute/retire une frame, `Shift` + clic
  selectionne une plage, **`Ctrl+A`** (timeline survolee) selectionne tout, `Echap`
  desselectionne, `Suppr` vide les annotations des frames selectionnees ;
- la suppression multi-frames se fait en **une seule requete** cote serveur (rapide meme
  sur des milliers de frames), pas un appel par frame.

Le slider principal sous le canvas est **relatif a la sequence active** en multi-sequence
(il couvre uniquement les frames de cette sequence) : changer de sequence via la liste
deroulante recale le slider sur `0 -> N` de la nouvelle sequence.

## Performance temps reel via SSH

Le workflow cible est : backend FastAPI/SAMURAI sur une VM Linux distante, frontend dans
VisionNexus Electron sur Windows, API et WebSocket via port-forward SSH vers un port local.
Les pixels suivent une route differente : lecture directe UNC via `app-image://` et
`paths.native_share_host` (nom DNS ou IP du partage), avec repli HTTP automatique. Le nom de la VM
SSH et celui de l'hote partage réseau natif peuvent etre differents.
Le facteur limitant n'est PAS React/Vite mais la **latence reseau x nombre de requetes**.
Choix de conception pour rester fluide :

- **Proxy Vite en `127.0.0.1`** (jamais `localhost`) : evite ~200 ms de tentative IPv6
  par requete cote Windows.
- **GZip** sur les reponses JSON (~10x) — listes de frames, annotations.
- **Scrubbing** : le slider charge des previews JPEG 480 px (~15 Ko) au lieu des images
  pleine resolution (plusieurs Mo), avec prefetch d'un voisinage ; l'image pleine
  resolution n'est chargee qu'a l'arret du slider.
- **Cache navigateur** (`Cache-Control: max-age`) sur les images extraites + cache
  memoire des annotations adjacentes → navigation ← → quasi instantanee.
- **Live temps reel** (`interface.realtime_live_enabled`, ON par defaut) : pendant
  SAMURAI/SAM2, les annotations arrivent par WebSocket et l'image utilise
  `nativePath`/`app-image://` sous Electron quand le chemin natif est disponible. Un chemin
  direct fourni par le backend est tente meme si la sonde SMB generique du lanceur est
  inactive ; timeout court puis repli HTTP automatique en cas d'echec. Le panneau Tracks
  et la barre du haut partagent une seule connexion WebSocket, afin qu'aucun `native_path`
  ne soit consomme par le mauvais composant.
- **Cadence live** : `interface.propagation_nav_throttle_ms` vaut 150 ms par defaut, soit
  la cadence de la boucle WebSocket. `0` suit chaque resultat GPU ; `700` limite les
  decodages si le client utilise surtout le repli HTTP. Cette cadence echantillonne les
  images dessinees, jamais l'association image/annotations. Les profils qui avaient encore
  l'ancien defaut 700 ms sont migres une fois vers 150 ms ; les valeurs personnalisees sont
  conservees.
- **Protection du canvas pendant une propagation** : le cache et les lectures DB sont
  suspendus tant que le WebSocket fournit les apercus. Cela evite l'alternance entre un
  cache non encore commite et l'etat live qui provoquait `Maximum update depth exceeded`
  puis l'ecran gris. Les mesures temporaires `0x0` d'un onglet Electron masque sont aussi
  ignorees afin que Konva ne detruise pas ses buffers pendant un dessin differe.
- **Suppression / stats** groupees en une requete plutot que N.
- **Pas de vignettes** (aucune requete image pour la timeline).

Reste couteux et inevitable : le **premier** chargement d'une image pleine resolution
non encore en cache (taille du fichier x latence). Si un dataset est tres lourd (PNG 4K),
privilegier l'extraction en JPEG a l'import. En pratique, avec ces optimisations, se
balader dans une sequence via SSH est fluide ; les pics de latence viennent d'une image
lourde jamais encore vue, pas d'un exces de requetes.

## Annotation IA

Fonctions principales :

- SAM2 point et SAM auto ;
- Grounding DINO texte vers bbox ;
- SAM3 texte vers bbox ou segmentation ;
- batch texte sur une plage de frames ;
- NMS par frame ;
- classes hierarchiques : classe (obligatoire) > sous-classe > sous-sous-classe
  (ex : drone > quadcoptere > mavic) ;
- export **YOLO** (un sous-dossier `{sequence}-yolo/` par sequence annotee) ou
  **.ver** (un fichier par sequence, format texte natif :
  `frame_id vis x1 y1 x2 y2 track_id classe sous-classe nom`, pixels, 1-based).

Le bouton texte/GD/SAM3 de la top bar reste le chemin recommande pour une detection interactive frame courante, car il rend directement les resultats visibles.

## Tracking

Modes disponibles (dans l'ordre des onglets) :

- `SAMURAI/SAM2` (defaut) : propagation video depuis les annotations de reference,
  **prompt par box englobante**. Si le fork local `backend/ext/samurai_repo/sam2` et les
  configs `configs/samurai/*.yaml` sont charges, l'UI affiche SAMURAI ; sinon elle annonce
  explicitement le fallback SAM2. Logs serveur avec prefixe `[SAM2Track]`, session video
  fermee apres chaque run (pas de fuite VRAM).
- `Detect.` : Grounding DINO ou SAM3 + matching par centroide. Ce mode detecte sur les frames suivantes et associe les detections aux cibles selectionnees ; il est efficace si la cible reste proche et si le prompt texte est fiable.
- `Homographie` : XFeat/SIFT, utile surtout si le mouvement camera domine.
- `Flux optique` : Lucas-Kanade, utile pour petits deplacements locaux.

(ReID ResNet et ByteTrack supprimes.)

Pour une sequence video reelle, le mode recommande est :

1. annoter proprement une frame cle ;
2. lancer SAMURAI si la cible doit etre propagee depuis une seule frame, surtout avec occlusions ;
3. utiliser Detect. si le prompt texte est fiable et que le mouvement est progressif ;
4. inspecter le dock `Anom.`, corriger manuellement, puis relancer depuis une nouvelle frame cle si besoin.

Le mode Detect. et les propagations longues alimentent le dock `Anom.` a droite de `Aide` :

- cible manquante ;
- variation de taille excessive ;
- erreur de detection ;
- auto-stop si trop de cibles sont perdues sur plusieurs frames.

Chaque entree d'historique est groupee par frame, cliquable, et affiche la raison claire de l'anomalie. La frame courante peut etre marquee resolue avec le bouton `Resolu frame` ou la touche `R`.

Le frontend suit la tache par WebSocket (`/ws/tasks/{id}`) et navigue vers
`current_frame_id` quand `interface.realtime_live_enabled` est actif. Les apercus
d'annotations sont pousses dans `live_frames`, sans attendre le flush SQLite, et les images
de propagation passent par `nativePath`/SMB sous Electron quand disponible. Le prechargement
agressif de plusieurs images pleine resolution a ete retire pour eviter de saturer la
memoire et le decodeur image.

Avec le live desactive, le canvas reste sur la frame choisie pendant le calcul ; la
progression et les compteurs continuent d'arriver par WebSocket, puis une
resynchronisation DB unique recharge le resultat final. Avec le live active, le canvas
suit la propagation a la cadence configuree et le WebSocket reste son unique source
d'annotations jusqu'a la fin. Aucun error boundary n'est utilise pour masquer un crash :
les conflits d'etat et les tailles de canvas nulles sont bloques a leur source.

Le symptome « annotations visibles une frame sur dix » venait d'une relecture DB lancee
apres chaque lot `live_frames`. Comme SAMURAI commit SQLite par lots de 10, cette relecture
renvoyait une liste vide et effacait l'overlay WebSocket. Un marqueur explicite
`hasLivePayload` interdit maintenant tout GET annotations lorsqu'un lot live a ete recu ;
chaque frame affichee garde donc son image et ses annotations du meme `frame_id`.

Dans le log VisionNexus, `[SAM2Track] ... NATIF (SMB)` confirme le chemin calcule par le
backend ; `[app-image] lecture native confirmee` confirme la lecture SMB effective par
Electron. Une ligne `[app-image] repli HTTP: ...` donne au contraire la raison du fallback.

## Architecture

```text
Annotation_App/
  backend/
    main.py
    config.py
    database.py
    models/
      project.py
      frame.py
      annotation.py
      track.py
      routers/
        projects.py
        dataset.py
        annotation.py
        tracking.py
        sam.py
        export.py
        orchestrator.py
    services/
      dataset_service.py
      task_registry.py
      sam_service.py
      sam3_service.py
      grounding_service.py
      homography_service.py
      tracker_service.py
  frontend/
    src/
      pages/AnnotationPage.tsx
      components/timeline/Timeline.tsx
      components/sidebar/TrackPanel.tsx
      components/canvas/AnnotationCanvas.tsx
      stores/projectStore.ts
      services/api.ts
```

## Endpoints Cles

```text
GET  /health
GET  /api/projects
POST /api/projects
GET  /api/projects/{id}
GET  /api/projects/{id}/frames
GET  /api/projects/{id}/sequences
POST /api/projects/{id}/frames/ensure_extracted
GET  /api/frames/{id}/image

GET  /api/frames/{id}/annotations
POST /api/frames/{id}/annotations
POST /api/frames/{id}/annotations/bulk
POST /api/frames/{id}/annotations/nms

POST /api/sam/predict/points
POST /api/sam/predict/text
POST /api/sam3/predict/text

POST /api/projects/{id}/guided-tracking/run
POST /api/projects/{id}/sam2-tracking/run
POST /api/projects/{id}/homography/propagate
GET  /api/tasks/{task_id}

POST /api/projects/{id}/export
POST /api/orchestrator/create-project
POST /api/orchestrator/export-yolo
```

## Validation Dev

Backend :

```bash
python -m py_compile backend\services\dataset_service.py backend\models\routers\dataset.py backend\models\routers\tracking.py
```

Frontend :

```bash
cd frontend
npm run build
```

## Packaging Linux (machine cible hors-reseau)

Depuis `App/Vision/` :

```bash
# Zip autonome de l'Annotation App seule (modeles inclus — checkpoints in-tree) :
python zip_all_apps.py --annotation

# Remplacement dans le bundle Computer_Vision_App sur la machine cible :
#   (le zip contient Annotation_App/ a la racine, structure identique au bundle)
rm -rf /chemin/Computer_Vision_App/Annotation_App
unzip Annotation_App_linux_x64.zip -d /chemin/Computer_Vision_App/
chmod +x /chemin/Computer_Vision_App/Annotation_App/setup_linux.sh
/chemin/Computer_Vision_App/Annotation_App/setup_linux.sh
```

Aucun autre changement requis : le launcher global du bundle retrouve l'app en place.

## Notes

- Aucune miniature n'est generee (timeline = compteurs d'annotations).
- Les images 3000 x 3000 restent lourdes : le canvas ne doit pas precharger plusieurs frames pleine resolution.
- Les modes Homographie et Flux optique sont conserves, mais doivent etre consideres comme outils specialises, pas comme tracking principal universel.
- Pour un dataset image sequentiel lourd sur disque local/VM, utiliser l'import dossier avec symlink quand possible.
- Auto-save totalement silencieux (session + backup JSON toutes les 2 min, aucun toast).

## Documentation

- [docs/README.md](docs/README.md) : index thematique (architecture, navigation du code,
  chargement des frames, installation pas-a-pas).
