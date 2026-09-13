# Prise en Main du Code — Navigation & Debugging

Guide pour comprendre la structure du code, savoir où chercher, et débugger hors-ligne.

---

## Le fil conducteur (par où commencer)

### Backend — 5 fichiers clés dans l'ordre

```
1. backend/main.py            ← Point d'entrée. Lifespan = démarrage services + migrations DB.
                                Tous les routers sont montés ici sous /api/.

2. backend/database.py        ← get_session() = générateur SQLite injecté dans chaque route.
                                WAL mode + foreign keys ON activés ici.

3. backend/models/*.py        ← Définitions ORM SQLModel (= Pydantic + SQLAlchemy).
                                Project → Frame → Annotation, LabelClass, Track, SessionState.

4. backend/models/routers/*.py ← Handlers HTTP. Un fichier = un domaine.
                                 Chaque route reçoit get_session() en injection.

5. backend/services/*.py      ← Logique métier. Singletons instanciés dans main.py lifespan.
                                 sam_service, grounding_service, sam3_service = jamais recréés.
```

### Frontend — 5 fichiers clés dans l'ordre

```
1. frontend/src/App.tsx                  ← Deux routes : "/" et "/projects/:id/annotate".

2. frontend/src/pages/AnnotationPage.tsx ← Fichier central (~900 lignes).
                                           Orchestre toolbar, canvas, sidebar, modals.
                                           Contient toute la logique de détection IA.

3. frontend/src/stores/annotationStore.ts ← État des annotations + undo/redo + clipboard.
                                            loadAnnotations(frameId, anns) ← frameId en PREMIER.

4. frontend/src/services/api.ts           ← Tous les appels HTTP. Client axios typé.
                                            Namespaces : projectsAPI, annotationsAPI, samAPI...

5. frontend/src/components/canvas/
   AnnotationCanvas.tsx                   ← Stage Konva.js 3 layers.
                                            Conversion coords : stageToImageNormalized() → [0,1].
```

---

## Qui parle avec qui

```
┌─────────────────────────────────────────────────────────────────┐
│  FRONTEND                                                        │
│                                                                  │
│  AnnotationPage.tsx                                              │
│    │  lit/écrit dans                                             │
│    ├─► annotationStore   ──► api.ts ──► POST /api/frames/{id}/annotations
│    ├─► projectStore      ──► api.ts ──► GET  /api/projects/{id}
│    ├─► samStore          ──► api.ts ──► POST /api/sam/predict/points
│    │                      └─► websocket.ts ──► WS /ws/sam/image
│    ├─► uiStore           (zoom, onglet actif, modals)
│    └─► settingsStore     (chargé async — voir pattern useEffect[algoLoaded])
│                                                                  │
│  AnnotationCanvas.tsx                                            │
│    ├── lit annotationStore.annotations → KonvaImage + shapes    │
│    └── mousedown/up/move → addAnnotation() dans annotationStore │
└─────────────────────────────────────────────────────────────────┘
             │ axios HTTP
             ▼
┌─────────────────────────────────────────────────────────────────┐
│  BACKEND                                                         │
│                                                                  │
│  main.py                                                         │
│    └─► routers/annotation.py   ─► get_session() → SQLite        │
│    └─► routers/sam.py          ─► sam_service / grounding_service│
│    └─► routers/tracking.py     ─► tracker_service / homography   │
│    └─► routers/dataset.py      ─► dataset_service (ffmpeg)       │
│    └─► routers/export.py       ─► dataset_service (YOLO zip)     │
└─────────────────────────────────────────────────────────────────┘
```

---

## Flux de données — cas concrets

### Ajouter une bbox manuellement

```
1. AnnotationCanvas.tsx     mousedown → startDrawing({tool:'bbox', startPoint})
2. AnnotationCanvas.tsx     mouseup   → buildAnnotationCreate() → annotationStore.addAnnotation()
3. annotationStore.ts       addAnnotation(frameId, data)
                             → api.ts POST /api/frames/{frameId}/annotations
                             → ajoute dans store.annotations + snapshot undo
4. AnnotationCanvas.tsx     re-render depuis store (useSyncExternalStore via Zustand)
```

### Détecter par texte (Grounding DINO)

```
1. AnnotationPage.tsx       submit textPrompt → samAPI.predictText(frameId, prompt, boxThr, textThr)
2. api.ts                   POST /api/sam/predict/text  {frame_id, text_prompt, box_threshold, ...}
3. routers/sam.py           predict_text() → grounding_service.predict()
4. grounding_service.py     DINO → boxes → SAM2 raffinement → retourne TextPredictResponse
5. AnnotationPage.tsx       boucle sur detections → annotationStore.addAnnotation() pour chaque
```

### Détecter par texte (SAM3)

```
1. AnnotationPage.tsx       submit textPrompt → sam3API.predictText(frameId, prompt, boxThr, textThr)
2. routers/sam.py           predict_text_sam3() → sam3_service.predict()
3. sam3_service.py          processor.set_image(img) + processor.set_text_prompt(state, prompt)
                             → retourne masks/boxes/scores en une seule passe
4. AnnotationPage.tsx       même boucle que GD → addAnnotation()
```

### Charger un projet (navigation vers /projects/:id/annotate)

```
1. AnnotationPage.tsx       useEffect([projectId]) → projectsAPI.getDetail(id)
2. projectStore.ts          setCurrentProject(detail) → classes + session restaurée
3. projectStore.ts          loadFrames(id) → GET /api/projects/{id}/frames
4. AnnotationPage.tsx       navigate to session.current_frame_index → loadFrame(index)
5. api.ts                   GET /api/frames/{frameId}/annotations
6. annotationStore.ts       loadAnnotations(frameId, annotations)
```

### Export YOLO

```
1. ExportModal.tsx          submit → exportAPI.start(projectId, config)
2. api.ts                   POST /api/projects/{id}/export → {task_id}
3. useTaskPolling.ts        GET /api/exports/{task_id}/status toutes les 800ms
4. ExportModal.tsx          status === 'completed' → exportAPI.download(task_id)
5. backend/services/
   dataset_service.py       write_yolo_label_file()     → labels/
                             write_yolo_seg_label_file() → seg_labels/ (si polygones)
```

---

## Settings — pattern async

Les settings se chargent en async au démarrage. **Ne jamais** initialiser un state directement depuis settings sans resync :

```ts
// MAUVAIS — valeur figée à undefined au premier render
const [boxThr, setBoxThr] = useState(settings?.algorithms?.grounding_dino_box_threshold ?? 0.3)

// BON — resync quand settings arrive
const algoLoaded = useSettingsStore((s) => s.loaded)
const algoSettings = useSettingsStore((s) => s.settings?.algorithms)
const [boxThr, setBoxThr] = useState(algoSettings?.grounding_dino_box_threshold ?? 0.3)

useEffect(() => {
  if (!algoLoaded || !algoSettings) return
  setBoxThr(algoSettings.grounding_dino_box_threshold)
}, [algoLoaded]) // eslint-disable-line
```

---

## Débugger hors-ligne

### Vérifier l'état du backend

```bash
# Santé globale (SAM2 chargé ? DINO dispo ?)
curl http://localhost:8000/health | python3 -m json.tool

# Statut Grounding DINO
curl http://localhost:8000/api/sam/grounding/status | python3 -m json.tool

# Swagger UI complet
open http://localhost:8000/docs
```

### Inspecter la base SQLite directement

```bash
# Ouvrir la DB en ligne de commande
sqlite3 data/annotation.db

# Requêtes utiles :
.tables                                        -- voir toutes les tables
SELECT id, name, project_type FROM project;    -- liste projets
SELECT COUNT(*) FROM annotation WHERE frame_id = 42;  -- nb annotations frame 42
SELECT * FROM annotation WHERE frame_id = 42 LIMIT 5;
SELECT * FROM sessionstate WHERE project_id = 1;
.quit

# Ou utiliser DB Browser for SQLite (GUI)
```

### Vérifier les fichiers sur disque

```bash
# Frames extraites d'un projet
ls data/projects/1/frames/ | head -20
ls data/projects/1/thumbnails/ | head -5

# format specialise → PNG (stockés à côté du .optional, pas dans data/)
ls /chemin/vers/fichier_png/

# Vérifier qu'une frame a bien son fichier image
ls -la data/projects/1/frames/frame_000042.jpg
```

### Frontend — inspecter l'état Zustand

Dans les devtools Chrome (F12) → Console :

```js
// Lire l'état du store annotations
window.__annotationStore = window.__annotationStore ||
  // injecter via zustand devtools extension
```

Méthode plus simple : ajouter `console.log(useAnnotationStore.getState())` temporairement dans le composant.

Ou utiliser l'extension Chrome **Zustand DevTools** (si installée).

### Frontend — inspecter les appels réseau

- F12 → Onglet **Network** → filtrer par `api`
- Voir les requêtes HTTP, bodies, réponses
- WS : filtrer par `WS` pour voir les messages WebSocket

### Erreurs courantes

| Symptôme | Cause probable | Où chercher |
|----------|---------------|-------------|
| `503 Service Unavailable` sur /api/sam/... | SAM2 checkpoint absent | `backend/checkpoints/` — fichier .pt manquant |
| `503` sur /api/sam/predict/text | Grounding DINO non chargé | `GET /health` → `grounding.loaded` |
| Annotations disparaissent au changement de projet | `clearAnnotations()` non appelé | `annotationStore.ts` + `AnnotationPage.tsx` |
| Settings non pris en compte au démarrage | Pattern async manquant | `useEffect([algoLoaded])` absent |
| `UnicodeEncodeError` au démarrage uvicorn | Emoji dans `print()` Python | Backend — enlever tous les emojis des logs |
| TypeScript build fail | Manque type | `npx tsc --noEmit` dans `frontend/` |

---

## Ajouter une fonctionnalité — checklist

### Nouvel endpoint backend

1. `backend/models/routers/` — ajouter la route dans le bon fichier domaine
2. `backend/main.py` — le router est déjà monté (rien à faire si même domaine)
3. `frontend/src/services/api.ts` — ajouter la fonction dans le bon namespace
4. `frontend/src/types/api.ts` — ajouter le type de retour si nouveau

### Nouveau paramètre settings

1. `backend/services/settings_service.py` — ajouter clé + valeur par défaut dans `DEFAULT_SETTINGS`
2. `frontend/src/types/api.ts` — ajouter dans `UserSettingsAlgorithms` (ou autre sous-interface)
3. `frontend/src/components/modals/SettingsModal.tsx` — ajouter le contrôle UI
4. Composant qui l'utilise — ajouter `useState` + `useEffect([algoLoaded])` pattern

### Nouveau type d'annotation

1. `frontend/src/types/api.ts` — étendre `AnnotationType`
2. `backend/models/annotation.py` — mettre à jour la validation
3. `frontend/src/components/canvas/AnnotationCanvas.tsx` — gérer le rendu
4. `backend/services/dataset_service.py` — gérer l'export
