# Annotation App — Frontend

React 19 + TypeScript + Vite + Konva.js + Zustand + Tailwind.

## Commandes

```bash
npm run dev          # Dev server sur :5173 (proxy /api, /ws → :8000)
npm run build        # tsc -b + vite build (0 erreurs requis)
npm run lint         # ESLint
npx tsc --noEmit     # Type-check only
```

## Architecture

### Routing (React Router v6)
- `/` — ProjectsPage (liste des projets)
- `/projects/:projectId/annotate` — AnnotationPage (page principale)
- `/presentation` — documentation intégrée

### Stores Zustand (`src/stores/`)
- `annotationStore.ts` — annotations de la frame courante, outil actif, undo/redo
  (50 snapshots), clipboard. `loadAnnotations(frameId, annotations)` — frameId en
  **premier** argument. `clearAnnotations()` obligatoire au changement de projet.
- `projectStore.ts` — projets, frames, `currentFrameIndex`, `totalFrames`.
  Le clamp de `setCurrentFrameIndex` prend le max de toutes les sources
  (frame_count projet, totalFrames, frames chargées) — ne jamais re-clamper
  sur `frame_count` seul (peut être obsolète en DB).
- `samStore.ts` — state machine WebSocket SAM2 (points, masques streamés).
- `uiStore.ts` — zoom/offset canvas, onglet sidebar, modals.
- `settingsStore.ts` — settings utilisateur chargés depuis le backend.

### Multi-séquence
Un projet peut contenir plusieurs séquences (dossiers d'images, MP4, format specialise).
- `datasetAPI.listSequences(projectId)` → `Sequence[]` avec stats
  (`annotated_frames`, `annotation_count`, plage `start_index`/`frame_count`).
- AnnotationPage affiche une **liste déroulante de séquences** à gauche du slider :
  la sélection navigue au début de la séquence ; le titre montre les stats.
- Chaque import (modal Importer) ajoute une **nouvelle séquence** au projet.

### Timeline (`components/timeline/Timeline.tsx`)
**Sans vignettes** (supprimées — trop coûteuses). Cellules compactes virtualisées :
- **Fenêtrée sur la séquence courante** (`windowStart`/`windowCount`) : changer de
  séquence remet à jour les frames ET les tracks affichés ;
- vert = frame annotée (compteur d'annotations affiché), rouge = frame vide ;
- le compteur de la frame courante est branché **en direct** sur `annotationStore` ;
  le compteur stocké est resynchronisé sur la DB à chaque chargement de frame
  (plus de décalage « 3 puis 2 au clic ») ;
- Ctrl/clic sélection, Shift/clic plage, Suppr efface les annotations sélectionnées.

#### Bandeau de tracks (`components/timeline/TrackLane.tsx`)
- Colonne gauche : `#uid` (gros, couleur du track) + `classe › sous-classe › sous-sous-classe` ;
- barre **segmentée** : blocs colorés = frames où l'objet a été **réellement trouvé**
  (`Track.segments`), bande grise = plage explorée sans détection, rail = non exploré.
  Un track peut donc apparaître en **plusieurs blocs séparés** ;
- clic sur un bloc = aller à son début, double-clic = aller à sa fin ;
- zone **scrollable** et **redimensionnable** en hauteur (poignée), persistée dans
  les settings du workspace (`interface.tracks_panel_height`) ;
- cliquer un track le sélectionne ; **Suppr** le supprime avec ses annotations
  (confirmation). Même effet depuis la vue *Tracks* du TrackPanel.

### Classes hiérarchiques (`components/sidebar/LabelManager.tsx`)
3 niveaux : **classe** (détection, obligatoire) > **sous-classe** (reconnaissance)
> **sous-sous-classe** (identification). Ex : drone > quadcoptere > mavic.
Champs `subclass` / `subsubclass` optionnels sur `LabelClass`.

### TrackPanel (`components/sidebar/TrackPanel.tsx`) — 4 onglets
1. **SAMURAI** (défaut) — SAM2 video tracking, prompt par box. Sélecteur
   *Stratégie multi-cible* : **Auto** (SAMURAI si 1 cible, sinon SAM2 multi-objets,
   1 passe) ou **SAMURAI / objet** (1 passe SAMURAI + Kalman par cible, plus lent).
2. **Detect.** — GD/SAM3 frame-par-frame + matching centroïde.
3. **Homogr.** — propagation homographie XFeat/SIFT.
4. **Flux opt.** — Lucas-Kanade par objet.

(ReID ResNet supprimé.) Vue *Tracks* en bas (bascule avec *Logs*) : liste des tracks,
suppression = suppression du track ET de ses annotations.

### Tracks / MOT
- **SAM2/SAMURAI resize interne à 1024×1024** (`image_size` du modèle) : la précision
  de tracking est plafonnée par cette résolution, quelle que soit la taille source.
- **Auto-track** : dans un projet **VIDÉO**, toute annotation manuelle sans piste reçoit
  automatiquement une **nouvelle** piste (`track_uid = max + 1`) — un objet a toujours
  un `track_id`. Réassignable via le sélecteur de la liste d'annotations
  (`— track / + nouvelle / #uid existant`).
- SAMURAI/guidé **réutilisent** la piste existante d'une cible (continuité MOT).

### Export (`components/modals/ExportModal.tsx`)
Deux formats :
- **YOLO** — multi-séquence : un sous-dossier `{sequence}-yolo/` par séquence
  annotée dans le dossier projet ; split train/val/test configurable.
- **.ver** — un fichier `{sequence}.ver` par séquence :
  `frame_id(1-based) visibility x1 y1 x2 y2 track_id classe sous-classe sous-sous-classe`
  (coordonnées pixels). L'export traite **tout le projet** (toutes les séquences) d'un coup.

### Canvas (`components/canvas/`)
Stage Konva.js 3 couches : image de fond, annotations (BBox + polygones),
overlay interactif. Coordonnées YOLO normalisées [0,1] en DB, conversion pixel
uniquement côté canvas (`utils/coordinates.ts`).
- Molette = zoom ; **clic molette (sans déplacement) = auto-ajustement (fit)** ;
  clic-molette maintenu + glisser = pan.
- Police d'annotation à taille écran **constante** (les coords sont déjà en espace
  écran) ; badge de track (rond coloré + `#uid`) au coin de chaque bbox.

### API client (`services/api.ts`)
Axios typé. Namespaces : `projectsAPI`, `datasetAPI`, `annotationsAPI`, `samAPI`,
`trackingAPI`, `exportAPI`, `taskAPI`, `backupAPI`.

### Performance (usage distant SSH)
- Aucune vignette chargée (timeline = compteurs texte).
- **3 paliers d'image** (le traitement IA/export lit TOUJOURS la source, jamais ces caches) :
  - `?preview=1` = 480px — scrubbing du slider ET **lecture (play)** : chaque frame se
    charge en <50 ms, la vidéo suit vraiment le rythme fps (fini la frame figée) ;
  - `?display=1` = 1600px — affichage canvas au zoom ajusté (fluide en SSH) ;
  - sans param = source pleine résolution dès qu'on zoome (> 1.5×) pour dessiner précis.
- Prefetch aligné sur le palier affiché (preview en lecture, en avance ; display/full sinon).
- Pendant scrub/lecture : pas d'appel API annotations par frame (évite le storm réseau).
- Réponses API gzippées côté backend (listes frames/annotations ~10x plus petites).
- Auto-save silencieux toutes les 2 min (aucun toast).
