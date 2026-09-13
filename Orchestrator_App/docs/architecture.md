# Architecture - Orchestrator App

Retour a [docs/README.md](README.md).

Ce document couvre le fonctionnement interne de l'orchestrateur : conversion graphe -> pipeline,
execution async du DAG, architecture SSE, mode FREE/LOCKED, auto-launch des sous-apps, et le detail
fichier par fichier du backend et du frontend.

---

## Ports

Table de reference unique pour tout le suite Computer Vision (orchestrateur + sous-apps). Ne pas
dupliquer cette table ailleurs : README.md pointe ici.

| Service | Port |
|---------|------|
| Orchestrator backend | 8060 |
| Orchestrator frontend | 3000 |
| Annotation_App | 8000 |
| Dataset_Explorer_App | 8001 |
| dvc-app | 8061 |
| mlflow-app | 8062 |
| optuna-app | 8063 |
| Training_App | 8064 |
| Inference_App | 8065 |

`config.py` lit `APP_URLS` / `APP_FRONTEND_URLS` comme dicts mutables : `graph_runner.py` les
met a jour en live quand il lance une app (`APP_URLS[key] = session.backend_url`). Ne jamais les
copier, toujours lire par reference.

---

## Structure workspace

```
{WORKSPACE}/
  orchestrator_{user}/
    graphs/experiments.json    sandgraphs persistes
    pipelines/                 pipelines generes
    activity.json
    sessions.json
  explorer_{user}/                 workspace Dataset_Explorer_App
  annotation_{user}/           workspace Annotation_App
  dvc_{user}/
  mlflow_{user}/
  optuna_{user}/
```

Regle critique : les outputs existants (subsets explorer, exports Annotation) viennent toujours du
workspace filesystem, jamais des repertoires d'application. Voir
`GET /api/graphs/meta/workspace-outputs`.
- Subsets explorer : `explorer_{user}/subsets/{name}/`
- Exports Annotation : `annotation_{user}/exports/{name}.zip`

---

## FREE / LOCKED node mode (cle du systeme)

Chaque node `explorer` et `annotation` a deux modes selon sa connectivite :

### MODE FREE (aucune arete entrante)
- Le node **expose les outputs existants** du workspace (scan filesystem)
- L'utilisateur **clique** sur un subset/export pour le selectionner -> met a jour `subset_name` / `project_name`
- Le node est **connectable directement** vers l'aval sans lancer de pipeline
- **Aucune etape pipeline generee** par ce node -> l'app correspondante n'est pas auto-lancee
- Badge vert `FREE` affiche dans le header du node

### MODE LOCKED (au moins une arete entrante)
- Le node **execute un nouveau pipeline** a partir de son input
- Affiche l'output qui sera produit apres run (unique)
- Badge ambre `LOCKED` affiche dans le header du node

### Implementation technique

**Frontend (`AppNode.tsx`)** :
- `data.has_input: boolean` - calcule depuis les aretes, jamais persiste
- En mode FREE : clic sur un item -> `window.dispatchEvent('orch:select-output', {nodeId, nodeType, name})`
- En mode LOCKED : affichage classique, items non-cliquables

**Frontend (`SandgraphPage.tsx`)** :
- `useEffect([edges])` -> recalcule `has_input` pour tous les nodes quand la topologie change
- `window.addEventListener('orch:select-output')` -> met a jour `subset_name`/`project_name`
- `refreshWorkspaceOutputs()` -> injecte aussi `has_input` via `edgesRef.current`
- `has_input` est strippe au save/run (etat derive, non persiste)

**Backend (`graph_runner.py`)** :
- `_is_free_node(node, edges)` -> True si ntype != dataset_source ET aucune arete entrante
- `graph_to_pipeline()` -> skip les FREE nodes (aucune etape generee)
- `_needed_app_keys()` -> skip les FREE nodes (app non lancee)

---

## Node types et leurs etapes pipeline

Les step IDs suivent la convention `{node_id}__{action}` (double underscore).

### dataset_source
- `{id}__load` -> POST Dataset_Explorer_App `/api/orchestrator/load-dataset`
- `{id}__embed` -> POST Dataset_Explorer_App `/api/orchestrator/start-embed`

### explorer (LOCKED uniquement - si FREE : aucune etape)
- `{id}__verifyembed` -> human_gate (verifier les clusters CLIP dans explorer playground)
- `{id}__subset` -> POST Dataset_Explorer_App `/api/orchestrator/create-subset`
- `{id}__validatesubset` -> human_gate (verifier les images du subset)
- `{id}__export` -> POST Dataset_Explorer_App `/api/orchestrator/export-subset`
- Apres export success : le frontend rescanne le workspace -> `available_subsets` mis a jour

### annotation (LOCKED uniquement - si FREE : aucune etape)
- `{id}__project` -> POST Annotation_App `/api/orchestrator/create-project`
- Si `full_auto=true` : `{id}__auto_annotate` -> POST Annotation_App `/api/orchestrator/auto-annotate`
- Si `full_auto=false` : `{id}__annotate` -> human_gate
- `{id}__exportyolo` -> POST Annotation_App `/api/orchestrator/export-yolo`
- Apres exportyolo success : le frontend rescanne le workspace -> `available_exports` mis a jour

### dvc
- `{id}__commit` -> POST dvc-app `/api/orchestrator/commit`

### training
- `{id}__train` -> POST Training_App `/api/orchestrator/train` (task, automatique)
- Entrees : dataset YOLO (`annotation`, obligatoire), modele de depart (node `model`, optionnel),
  best params HPO (`optuna`, optionnel) - voir [Ports types des nodes](#ports-types-des-nodes-portsts)

### mlflow / optuna
- `{id}__train` / `{id}__hpo` -> human_gate

MLflow n'est **pas** une etape de pipeline classique : c'est un **observateur** du store MLflow
du workspace (serverless). MLflow_App est auto-lancee des qu'un node MLflow existe, et le node
affiche un resume live des runs.

### model
Pas d'etape pipeline generee : un node `model` n'est jamais LOCKED, il n'a aucune entree. C'est
une source de valeur pure (le chemin `.pt` saisi a la main dans `NodeConfigPanel`) exposee via son
port de sortie `model`, consommee par `training` (poids de depart / fine-tuning) ou `inference`
(modele a tester) sans passer par un Training amont. Voir la section
[Ports types des nodes](#ports-types-des-nodes-portsts) ci-dessous.

---

## Ports types des nodes (ports.ts)

`NODE_ACCEPTS` (l'ancien dict plat `type cible -> types source acceptes` dans SandgraphPage.tsx)
a ete remplace par `frontend/src/nodes/ports.ts` : un schema **par port**, pas seulement par node.
Un node declare des **entrees** (a gauche) et des **sorties** (a droite), chacune avec un type de
donnee (`PortType`) qui determine sa couleur (handle + arete) :

```typescript
type PortType = 'dataset' | 'subset' | 'yolo' | 'ver' | 'model' | 'params' | 'metrics' | 'any'
```

Ce que le systeme de ports resout, qu'un `NODE_ACCEPTS` par node ne pouvait pas exprimer :
- **Plusieurs entrees typees sur un meme node** : `training` a 3 entrees independantes
  (`dataset` <- annotation, `model` <- node `model` uniquement, `hpo` <- optuna), chacune avec son
  propre handle et sa propre regle d'acceptation (`accepts`).
- **Plusieurs sorties typees sur un meme node** : `annotation` a 2 sorties distinctes
  (`out_yolo` = dataset YOLO complet -> Training/Optuna, `out_ver` = format `.ver` natif
  Inference_App -> Inference/Eval). `resolveHandles(srcType, tgtType)` choisit automatiquement la
  bonne paire de handles a la connexion (source dont le TYPE correspond au port cible choisi).
- **Exclusivite entre deux entrees** (`exclusiveWith`) : sur `inference`, `sequence` (images brutes)
  et `dataset_yolo` (dataset YOLO, GT incluse) ne peuvent jamais etre branches en meme temps -
  `wouldViolateExclusivity` bloque la connexion AVANT qu'elle ne se cree.
- **Dependance entre entrees** (`requiresPeer`) : sur `inference`, `gt` (.ver) n'a de sens que si
  `sequence` est aussi branche - sinon `validatePortRules` remonte un simple warning (pas bloquant).
- **Entree obligatoire** (`required`) : `validatePortRules` refuse la sauvegarde/le lancement si un
  port `required` n'est pas branche, SAUF en mode FREE (explorer/annotation sans arete restent valides).

`dvc` et `mlflow` ont `{ inputs: [], outputs: [] }` : aucun port, donc **inconnectables**. Ce sont
des observateurs purs du workspace (DVC scanne les artefacts produits par tout le graphe via
`_gather_graph_artifacts`, MLflow scanne son store), pas des etapes du DAG.

`compatibleNodeTypes(fromType, handleType, handleId)` alimente le popup "node compatible" quand on
tire un fil depuis un port sans le lacher sur une cible (drag-to-create).

Les nodes `explorer` et `annotation` SANS input entrant restent automatiquement en mode FREE (le
systeme de ports ne change rien a FREE/LOCKED, voir section dediee plus haut).

Auto-propagation des parametres sur `onConnect` (inchangee) :
- `dataset_source -> explorer` : copie `dataset_name`
- `explorer -> explorer` : copie `dataset_name`
- `explorer -> annotation` : copie `subset_name`
- `dataset_source -> annotation` : copie `dataset_name` dans `subset_name`

Cas particuliers :
- **Dataset Explorer -> Dataset Explorer** : subset-de-subset - le 2eme explorer filtre aux images du 1er subset
- **Inference FREE -> explorer / Annotation** : boucle d'acquisition -> annotation -> fine-tuning

### Rendu visuel des ports (`NodePorts.tsx`) et des aretes (`OrthogonalEdge.tsx`)

`NodePorts` est le bandeau "blueprint" affiche au bas de chaque node (via `NODE_PORTS[nodeType]`) :
une colonne Entrees a gauche, une colonne Sorties a droite, chaque port sur sa propre ligne avec
son handle ReactFlow. Un port d'entree est colore/allume seulement si CE handle precis recoit une
arete (`inputHandles.includes(p.id)`) - pas si le node a une arete entrante sur un AUTRE port
(bug corrige : sur `inference`, `dataset_yolo` et `gt` acceptent tous deux une source `annotation`,
un check par type aurait allume `gt` des que `dataset_yolo` est branche).

`OrthogonalEdge` remplace l'ancien fallback `smoothstep` + `DetourEdge` : c'est desormais l'UNIQUE
type d'arete (`edgeTypes = { orthogonal: OrthogonalEdge }`), utilise pour toutes les connexions.
Le trace est calcule par `routing.ts` (module pur, sans dependance React/xyflow) : detection des
nodes a contourner, choix d'un mode (`direct` / `zbend` / `corridor`), empilement des couloirs
paralleles, generation du path SVG. Tant que l'arete n'a pas ete editee a la main, le trace est
recalcule automatiquement a chaque deplacement de node. Des qu'un waypoint est ajoute (double-clic
sur l'arete) ou deplace, l'arete passe en `routeMode: 'manual'` et garde ce trace fige (un bouton
sur le label permet de revenir au routage automatique). Convention : une sortie quitte toujours son
node vers la droite, une entree recoit toujours depuis la gauche.

---

## SSE architecture

1. `start_run` -> cree un `RunState` dans `_active_runs: dict[str, RunState]` (in-memory)
2. Le pipeline emet des events dans `state.events: list[dict]`
3. `stream_events(run_id)` est un generateur async qui rejoue tous les events depuis cursor=0 a chaque connexion
4. `graphs.py` `event_generator` consomme ce flux, met a jour `graph_store`, et yield le SSE au client

### Human gate flow
- `_run_step` set `state.status = "waiting"`, emet l'event waiting, return
- `_execute` voit `state.status == "waiting"` -> return
- `stream_events` sort quand `cursor >= len(events)` a l'event waiting
- Le frontend affiche le banner "Intervention requise"
- L'utilisateur clique "Continuer" -> POST `/api/graphs/{id}/resume`
- `resume_run` marque le step waiting comme success, emet l'event success, rappelle `_execute`
- Le frontend reconnecte le SSE -> rejoue tous les events depuis cursor=0

### Loop bug fix (mai 2026)
- Cause racine : au reconnect SSE apres resume, `event_generator` sortait sur l'event historique
  "waiting" ET `graph_store.update_node_exec` regressait le statut du node vers "waiting"
- Fix 1 (`graphs.py`) : suppression de `if evt_type in ("done", "waiting"): return` - on ne sort
  plus que sur "done"
- Fix 2 (`graph_store.py`) : suppression de "waiting" du bypass "toujours mettre a jour" dans
  `update_node_exec` ; le statut graph-level ne passe a "waiting" que si le node transitionne
  reellement depuis un rang inferieur

### Server restart fix
- `run_in_memory(run_id)` verifie si le run existe dans `_active_runs`
- Si absent au resume : `reset_graph_execution()` -> HTTP 410 -> le frontend se rafraichit

---

## Auto-launch flow

1. `run_graph()` appelle `_preflight_check()` -> liste les apps injoignables necessaires aux nodes du graphe
2. Pour les nodes FREE : app non incluse dans `_needed_app_keys` -> pas de lancement auto
3. Pour les nodes LOCKED : auto-launch en background si l'app n'est pas disponible
4. Chaque step appelle `_wait_for_app(step.app, max_wait=60s)` avant execution - poll `/health` toutes les 2s

---

## Canvas behavior (SandgraphPage.tsx)

- `nodesDraggable`, `nodesConnectable`, `deleteKeyCode` tous desactives quand `isRunning || isWaiting`
- Undo/redo : `useRef` stacks (`historyRef`, `futureRef`) + mirror refs (`nodesRef`, `edgesRef`) pour eviter les stale closures
- Auto-propagation sur `onConnect` (voir section connexions ci-dessus)
- `stepNodeMap` (`step_id -> node_id`) est set par `runMut.onSuccess` et reutilise par `resumeMut.onSuccess`
- `has_input` injecte via `useEffect([edges])` + `refreshWorkspaceOutputs()`, strippe au save/run

Raccourcis :

| Touche | Action |
|--------|--------|
| `Ctrl+Z` / `Ctrl+Y` | Annuler / Retablir |
| `F` | Ajuster la vue |
| `Suppr` / `Backspace` | Supprimer selection |
| Canvas verrouille pendant l'execution | - |

---

## Annotation node params

Champs dans `node.data` :
- `annotation_mode` : `"sequence"` | `"random"`
- `full_auto` : boolean
- `ai_model` : `"sam3"` | `"grounding_dino"`
- `ai_text` : string (prompt pour GroundingDINO)
- `ai_threshold` : number (0-1)

---

## Run Insight et lineage (Git / DVC / MLflow)

Un "Run Insight" est le document (JSON + Markdown + plots) genere pour UN run de graphe. Le
"Lineage" est le graphe qui relie TOUS les runs de TOUS les graphes entre eux (dataset commun,
forks). Les deux s'appuient sur le meme lineage brut ecrit par `graph_runner`/`graph_store`
pendant le run (`git_commit`, `dataset`, `dvc_version`, `model_path`, `map50`, tags MLflow), mais
chacun le traite differemment : l'Insight COLLECTE et FIGE l'etat d'un run, le Lineage LIT cet etat
deja fige pour construire des relations entre runs.

### `core/insights.py` - generation d'un Insight

Un dossier `WORKSPACE/insights/{graph_id}/{run_id}/` est (re)genere automatiquement a la fin d'un
run (event SSE `done`) et progressivement pendant le run (apres chaque etape `train`, `exportyolo`,
`commit`, `hpo`, `export`, `subset` reussie - voir `event_generator` dans `graphs.py`), ou a la
demande via `POST /api/insights/{graph_id}/generate`.

- `collect(graph_id, run_id)` agrege TOUT ce que les sous-apps savent de ce run : statut/timings
  des nodes et journal brut des steps (depuis `graph_store`/`experiment_store`), historique
  d'entrainement epoch par epoch (Training_App, `GET .../metrics-history`), etudes Optuna dont le
  `run_id` (user_attr) correspond exactement a ce run (pas de fallback par date ou graph_id), runs
  MLflow tagues `orch_run_id == run_id`, commits DVC dont le trailer `run_id` correspond. Tout est
  filtre sur l'identite exacte du run : un fork ne recupere jamais les courbes ou artefacts de son
  parent par erreur.
- `_build_lineage(...)` assemble l'objet `lineage` (git_commit, dataset, dvc_version resolu par scan
  des fichiers DVC, model_path, map50 - cherche d'abord le lineage ecrit au run, puis les metriques
  MLflow, puis le statut Training_App) et une checklist `reproducibility` de 7 verifications
  honnetes (code Git commite, snapshot du graphe, dataset DVC versionne, run MLflow lie, fichier
  modele present sur disque, artefacts d'analyse presents, remote DVC configure). `reproducible`
  n'est vrai QUE si les 7 sont vrais - aucun "vert" par defaut.
- `generate()` regenere aussi 4 plots matplotlib (`training_curves.png`, `gains.png` - mAP50 finale
  par entrainement avec delta vs le premier run, `optuna_history.png`, `timeline.png` - Gantt des
  nodes), rapatrie les images d'analyse Ultralytics du/des training (matrice de confusion, courbes
  PR/F1, `results.png`, predictions de validation), puis ecrit 3 fichiers : `insights.json` (bundle
  brut complet), `insights.md` (journal lisible, aucune donnee cachee), `metrics.json` (sous-ensemble
  STABLE et trie - sans timestamp - destine a etre versionne par DVC sans "churner" a chaque
  regeneration). Termine par `run_manifest.finalize(...)`.

### `api/insights.py`

| Methode | Route | Description |
|---------|-------|--------------|
| GET | `/api/insights` | Liste tous les insights generes (tous graphes/runs confondus) |
| GET | `/api/insights/{graph_id}/{run_id}` | Contenu complet de l'insight (404 si non genere) |
| GET | `/api/insights/{graph_id}/{run_id}/plot/{name}` | Sert un plot PNG (garde-fou anti path-traversal) |
| DELETE | `/api/insights/{graph_id}/{run_id}` | Supprime le dossier d'insight (cache d'affichage - le lineage/DVC/MLflow sous-jacents restent intacts, regenerable) |
| POST | `/api/insights/{graph_id}/generate` | (Re)genere l'insight du run donne, ou du dernier run connu du graphe si `run_id` omis |

### `core/run_manifest.py` - index canonique d'un run

`WORKSPACE/runs/{run_id}/manifest.json` est l'index logique d'un run : les fichiers restent dans
les workspaces des sous-apps, mais chaque sortie produite (`outputs`) est explicitement rattachee a
son `run_id` d'origine (`start()` a l'ouverture du run, `finalize()` a la fin). Ecriture atomique
(fichier temporaire + `os.replace`) pour ne jamais exposer un manifeste JSON partiel. Une sortie du
run courant ne devient jamais implicitement une sortie du parent (`source_run_id` explicite), y
compris pour les inputs herites d'un fork (`inputs: [{kind: "fork_base", ...}]`).

### `api/lineage.py` - graphe cross-experiences

`GET /api/lineage?include_failed=bool` construit, a travers TOUS les graphes du workspace, un
graphe `{nodes, edges}` : chaque run publie (statut done/success/completed par defaut - vue
"published" ; `include_failed=true` inclut aussi les runs failed/interrompus/partiels - vue
"audit", avec `excluded_runs` listant ce que la vue published masque). Lecture seule et defensif :
un run sans aucun lineage apparait quand meme (marque "non versionne"), jamais d'exception qui
casserait la page entiere pour un run incomplet.

Types de node : `source_dataset` (dataset source commun, dedupe par chemin+nom) | `dataset`
(subset reellement extrait par CE run, dedupe par source+subset+requete+version DVC - jamais par le
commit du parent, pour qu'un fork non committe garde sa propre identite) | `run` | `model` (dedupe
par chemin) | `stage` (un run MLflow individuel, rattache au run pipeline qui l'a produit) |
`artifact` (annotations/metriques/graph/optuna produits, avec leur etat `versioned` calcule depuis
les chemins DVC reellement trackes).

Types d'arete : `source` (dataset source -> run), `subset` (run -> subset extrait), `model`
(run -> modele), `mlflow` (run -> stage MLflow), `artifact` (run -> artefact), `fork` (run parent ->
run enfant via `graph["forked_from"]` ; si un fork n'a encore aucun run, un node `draft` "non lance"
apparait quand meme pour representer la branche).

Aucune URL n'est resolue cote serveur - les deep-links vers dvc-app/mlflow-app sont construits cote
frontend via `/api/graphs/meta/app-urls`. Chaque node de type `run` porte un objet `comparison`
(`_comparison_snapshot`) : une vue normalisee et stable (dataset source, subset, annotations YOLO,
annotations `.ver`, HPO - `best_params` uniquement si produit par CE run, jamais herite du parent -,
params de training, modele, etapes MLflow avec leurs metriques, artefacts, mAP50) utilisee par le
frontend pour diffuser un run contre un autre section par section.

### `api/graphs.py` - actions liees (fork / promotion MLOps)

Deux actions du router `graphs` completent ce systeme (pas dans les fichiers lineage/insights eux-
memes, mais indissociables du flux Insight -> Lineage) :
- `POST /api/graphs/{graph_id}/fork-run` : duplique le graphe (memes nodes dataset/annotation, donc
  meme subset + memes annotations) et grave la provenance du run source dans `forked_from`
  (git_commit, dataset, dvc_version, map50, snapshot des parametres reglables du parent). Ne
  declenche AUCUN pull/re-telechargement DVC - sert uniquement a la tracabilite et a l'ecran de
  divergence. L'utilisateur ajuste ses parametres puis relance lui-meme.
- `POST /api/graphs/{graph_id}/track-mlops` : promeut un graphe "experimental" en "mlops" en
  injectant, s'ils manquent, les nodes FREE `mlflow` + `dvc` (paire couplee). Idempotent, ne lance
  et ne versionne rien - juste la structure pour que l'utilisateur committe ensuite via le node DVC.
  Le type derive `mlops` (`graph_store.mlops_status`) sert au badge MLOps/Experimental affiche par
  `InsightsPage`.

### Frontend - `InsightsPage.tsx`

Page de detail d'un run : carte d'identite (`LineageHeader`) avec badge MLOps/Experimental,
provenance de fork, 6 champs cliquables (Git, Dataset, DVC version, MLflow Run, Model, mAP50 -
chacun soit un lien reel soit "non relie", jamais une fausse valeur), actions directes (Open MLflow
Run, Inspect DVC, Inspect Dataset, View Artifacts, Open Sandgraph, Open Lineage, Track in MLOps,
Fork this run), un panneau "Reproduce Run" (recette en 4 etapes sans ligne de commande, actif
uniquement si `reproducibility.reproducible`) et le detail de la checklist de reproductibilite.
En dessous : apercu du Sandgraph source, courbes Plotly interactives (mAP/pertes/precision-rappel
par epoch, historique Optuna), images d'analyse Ultralytics repliables, journal brut des steps,
logs complets colores (memes blocs que le Sandgraph), et un export "rapport HTML" autonome
(Plotly inline, consultable hors-ligne sans serveur).

### Frontend - `LineageGraphPage.tsx`

Vue graphe (ReactFlow) de l'arbre de lineage complet, groupee par experience (dataset source commun
en tete, un cadre pointille par run avec ses productions). Chaque run est aussi represente par un
"jeton" (`RunToken`) draggable : le deposer dans le panneau `ComparisonPanel` (ou dans la vue Liste)
compare deux runs section par section via leur `comparison` snapshot, en surlignant uniquement les
sections qui different (ajoute/supprime/modifie) avec le detail champ par champ. Bascule Graphe/Liste,
recherche par nom/dataset/subset, compaction des productions par run, panneau de detail par node
avec liens directs DVC/MLflow et un raccourci "Forker ce run" identique a celui d'InsightsPage.

---

## Plans d'experiences

Un "Experiment Plan" est une suite ORDONNEE d'etapes ; chaque etape duplique un graphe de base deja
construit dans le Sandgraph et lui applique des overrides nommes, puis la lance. C'est l'automatisation
de "dupliquer + changer 2-3 parametres + relancer" repetee plusieurs fois (ex. balayer plusieurs
valeurs d'epochs/lr0 en partant du meme graphe reutilisation annotation FREE -> training).

### `core/plan_store.py`

Persistence JSON simple dans `WORKSPACE/plans/plans.json`. Un plan = `{plan_id, name, created_at,
updated_at, steps: [{id, label, base_graph_id, overrides}], last_run}`. `last_run` est ecrit par
`plan_runner` pendant l'execution (`status`, `started_at`, `finished_at`, `current`/`total`,
`results: [...]`) et sert d'etat de progression poll par le frontend.

### `core/plan_runner.py`

Le moteur d'execution NE reutilise PAS directement les fonctions Python internes : il rejoue, en
tache de fond (`asyncio.create_task`), la meme sequence qu'un utilisateur ferait a la main, mais EN
APPELANT LES ENDPOINTS HTTP INTERNES de l'app elle-meme (`http://127.0.0.1:{BACKEND_PORT}`) - donc
toute la logique existante (validation, auto-launch, SSE) est reutilisee telle quelle, sans code
duplique. Pour chaque etape :
1. `POST /api/graphs/{base_graph_id}/duplicate`
2. `_apply_overrides(graph, overrides)` - applique les overrides nommes sur des nodes standard
   identifies par convention d'id (`v1` = explorer, `a1` = annotation, `t1` = training) ; silencieux
   si un node n'existe pas (un graphe "reutilisation" n'a par exemple que `a1` + `t1`)
3. `PUT /api/graphs/{id}` pour sauvegarder les overrides
4. `POST /api/graphs/{id}/run` puis polling toutes les 3s (jusqu'a 40 min) : des que le graphe passe
   `waiting`, `POST /api/graphs/{id}/resume` automatiquement - un plan est une execution planifiee,
   il ne doit jamais rester bloque sur une gate humaine
5. Si le run termine `done` : `POST /api/insights/{id}/generate` puis relecture de l'insight pour
   recuperer `dvc_version`/`git_commit`/`map50` dans le resultat de l'etape

Important : le commit DVC reste volontairement MANUEL. Un plan ne cree jamais de commit lui-meme -
les sorties exactes de chaque run restent proposees dans le hub DVC, ou l'utilisateur choisit quoi
versionner. Le resultat de chaque etape est ensuite navigable dans l'onglet Lineage.

### `api/plans.py`

| Methode | Route | Description |
|---------|-------|--------------|
| GET | `/api/plans` | Liste des plans |
| POST | `/api/plans` | Cree un plan (nom + etapes) |
| GET/PUT/DELETE | `/api/plans/{plan_id}` | Lire / modifier / supprimer |
| POST | `/api/plans/{plan_id}/run` | Demarre l'execution en tache de fond (`{ok: false}` si deja en cours - pas d'erreur HTTP) |
| GET | `/api/plans/{plan_id}/status` | Etat d'execution courant (`last_run`, ou `{status: "idle"}`) |

### Frontend - `PlansPage.tsx`

Editeur de plan : nom + liste d'etapes, chaque etape choisit un graphe de base et des champs
d'override (subset, projet d'annotation, nb images, seuil, epochs, lr0, batch, run label - mappes
directement sur les cles lues par `_apply_overrides`). Bouton Lancer, puis polling du statut toutes
les 2.5s pendant l'execution avec, par etape, le statut et les badges mAP50/dvc/git recuperes de
l'insight genere.

---

## Backend - detail fichier par fichier

```
backend/
  config.py
  main.py
  api/
    graphs.py
    pipelines.py
    launcher_api.py
    experiments.py
    activity.py
    health.py
    settings.py
    insights.py            Run Insight : liste, detail, plots, generation
    lineage.py              graphe cross-experiences (fork tree)
    plans.py                Experiment Plans : CRUD + lancement
  core/
    graph_runner.py        cerveau du systeme
    pipeline_runner.py     executeur async
    graph_store.py
    app_launcher.py
    proxy_client.py
    pipeline_store.py
    experiment_store.py
    activity_store.py
    insights.py             collecte + generation d'un Run Insight
    run_manifest.py         index canonique des sorties d'un run
    plan_store.py            persistence des Experiment Plans
    plan_runner.py           moteur d'execution d'un plan
```

### `backend/config.py`
Configuration centralisee : ports, URLs des sous-apps, workspace.
- `WORKSPACE` (Path) - lu depuis `ORCHESTRATOR_WORKSPACE`
- `CURRENT_USER` - depuis `ORCHESTRATOR_USER`
- `APP_URLS` / `APP_FRONTEND_URLS` - dicts mutables, voir section Ports ci-dessus

### `backend/main.py`
Point d'entree FastAPI - monte les 10 routers (`health`, `pipelines`, `activity`, `settings`,
`experiments`, `graphs`, `launcher_api`, `insights`, `lineage`, `plans`), configure CORS
(localhost:3000 et 5173), expose quelques endpoints workspace directs (`/api/workspace/users`,
`/api/workspace/history`).

Important : l'ordre des routers importe - `graphs` en premier car ses routes `/meta/*` doivent
etre resolues avant les routes parametrees `/{id}`.

### `backend/api/graphs.py`
Router principal du sandgraph : CRUD + execution + streaming SSE + scan workspace.
- `GET/POST /api/graphs` - list / create
- `GET/PUT/DELETE /api/graphs/{id}` - read / update / delete
- `POST /api/graphs/{id}/duplicate`
- `POST /api/graphs/{id}/run` -> appelle `graph_runner.run_graph()`
- `GET /api/graphs/{id}/run/{run_id}/stream` -> SSE, rejoue tous les events depuis cursor=0
- `POST /api/graphs/{id}/resume` - reprend apres une human gate
- `POST /api/graphs/{id}/reset`
- `GET /api/graphs/meta/app-urls`
- `GET /api/graphs/meta/workspace-outputs` -> scan filesystem, retourne subsets + exports existants sans que les apps tournent

Voir la section SSE architecture ci-dessus pour le detail de `event_generator()`.

### `backend/api/launcher_api.py`
Router pour lancer/arreter les sous-apps manuellement depuis l'UI (page Apps).
- `GET /api/apps` - liste toutes les sessions avec statut (running/stopped/error)
- `POST /api/apps/launch` - lance une app avec workspace + user + conda_env
- `POST /api/apps/{id}/stop`
- `POST /api/apps/launch-all`, `POST /api/apps/stop-all`
- Health check live par app

Important : utilise `app_launcher.launch_app()` du core, meme fonction que l'auto-launch du
graph_runner. Le workspace est toujours transmis en parametre, jamais hardcode.

### `backend/api/insights.py`, `lineage.py`, `plans.py`, `backend/core/insights.py`,
`run_manifest.py`, `plan_store.py`, `plan_runner.py`
Detailles dans la section [Run Insight et lineage](#run-insight-et-lineage-git--dvc--mlflow) et
[Plans d'experiences](#plans-dexperiences) ci-dessus - pas repetes ici pour eviter le doublon.

### `backend/api/pipelines.py`, `experiments.py`, `activity.py`, `health.py`, `settings.py`
Routers secondaires, moins critiques pour le flux principal.
- **pipelines.py** : CRUD pipelines JSON + POST run avec SSE (ancien systeme, garde pour compatibilite)
- **experiments.py** : list/get/resume des experiments (schema Pydantic complet avec metriques)
- **activity.py** : `GET /api/activity?limit=50` - retourne `activity.json`
- **health.py** : `GET /api/health` - ping concurrent des sous-apps, retourne latences
- **settings.py** : `GET/PUT /api/settings` - preferences utilisateur persistees

### `backend/core/graph_runner.py` (cerveau)
Convertit le graphe visuel ReactFlow en `PipelineDef` executable + gere l'auto-launch.
- `_is_free_node(node, edges) -> bool` : voir section FREE/LOCKED
- `_steps_for_node(node, deps, ctx, parent_nodes) -> list[dict]` : traduit chaque type de node en
  liste d'etapes pipeline, voir section "Node types et leurs etapes pipeline"
- `graph_to_pipeline(graph) -> (PipelineDef, step_node_map)` : tri topologique (Kahn) -> pour
  chaque node LOCKED -> `_steps_for_node` -> construit la map `step_id -> node_id` utilisee par
  le frontend pour colorer les nodes pendant l'execution
- `_needed_app_keys(graph) -> set[str]` : liste les apps necessaires, skip les FREE nodes
- `_auto_launch_and_wait(app_key, timeout) -> bool` : lance en background via
  `asyncio.create_task()`, attend jusqu'a `timeout` secondes que `/health` reponde. Pour explorer :
  calcule toujours `annotation_imports` depuis la structure workspace (meme si Annotation n'est
  pas encore demarree)

Important : `annotation_imports_path` dans le contexte pipeline est calcule directement
`WORKSPACE / f"annotation_{CURRENT_USER}" / "imports"`, jamais via HTTP.

### `backend/core/pipeline_runner.py` (executeur)
Execution async du DAG de steps + gestion human gate + SSE events.
- `RunState` : classe in-memory (non persistee) - `status`, `events: list[dict]`,
  `step_states: dict`, `waiting_step`. Stockee dans `_active_runs: dict[str, RunState]`
- `_execute(pipeline, state)` : boucle async, trouve les steps dont toutes les dependances sont
  "success" -> `asyncio.gather()` -> execute en parallele. Sort si `state.status == "waiting"`
- `_run_step(step, state)` : appelle `_wait_for_app(step.app, max_wait=60s)` avant tout ; si
  `type == "human_gate"` -> set `state.status = "waiting"`, emet event waiting, return ; si
  `type == "task"` -> `proxy_client.request()` vers l'app cible
- `stream_events(run_id)` : generateur async qui rejoue `state.events` depuis l'index 0
- `resume_run(pipeline_id, run_id)` : marque le step waiting comme "success", emet l'event
  success, rappelle `_execute()`

Important : `_active_runs` est in-memory. Si le serveur redemarre, voir "Server restart fix"
dans la section SSE ci-dessus.

### `backend/core/graph_store.py`
Persistence des sandgraphs dans `graphs/experiments.json`.
- CRUD : `create_graph`, `get_graph`, `update_graph`, `delete_graph`, `list_graphs`
- `start_run(graph_id, run_id, pipeline_id, step_node_map)` - initialise l'etat d'execution
- `update_node_exec(graph_id, node_id, status, result)` - mis a jour par `graphs.py` a chaque event SSE
- Logique de statut graph-level : idle/running/waiting/done/failed calcule depuis les statuts nodes

Important : `update_node_exec` ne retrograde jamais un node de "done" vers "waiting" (fix du loop
bug mai 2026, voir section SSE).

### `backend/core/app_launcher.py`
Spawn et monitoring des sous-apps comme sous-processus independants.
- `AppSession` dataclass : `app_id`, `pid`, `backend_url`, `frontend_url`, `workspace`, `status`
- `launch_app(app_id, base_workspace, user, annotation_imports=None)` : construit les env vars
  (`EXPLORER_WORKSPACE`, `ANNOTATION_WORKSPACE`, etc.), spawn le process via `subprocess.Popen`
- `get_session(app_id)` -> renvoie la session active ou None
- `stop_app(app_id)` : kill le process + cleanup

Important : la transmission de `annotation_imports` a Dataset_Explorer_App via env var
`ANNOTATION_APP_IMPORTS` est toujours calculee depuis la structure workspace, jamais via HTTP
vers Annotation.

### `backend/core/proxy_client.py`
Client HTTP async vers les sous-apps.
- `ping(app_key) -> float | None` - latence en ms, ou None si down
- `ping_all() -> dict` - ping concurrent de toutes les apps
- `request(app_key, method, endpoint, json_body)` - proxy generique

Appele pour chaque step du pipeline.

### `backend/core/pipeline_store.py`
CRUD pour les `PipelineDef` persistees en JSON dans `pipelines/`. Schemas Pydantic :
`PipelineStep` (id, label, app, endpoint, method, params, depends_on, type, hint), `PipelineDef`
(id, name, steps).

### `backend/core/experiment_store.py`, `activity_store.py`
- **experiment_store** : schema Pydantic complet pour les experiences (run_id, steps, artifacts,
  metrics). Moins utilise que graph_store dans le flux principal.
- **activity_store** : log append-only `activity.json` (max 200 entrees).

---

## Frontend - detail fichier par fichier

```
frontend/src/
  main.tsx
  App.tsx
  index.css
  api/
    client.ts              tous les appels API types
  types/
    api.ts                 types TS miroirs des schemas Pydantic
  utils/
    time.ts
  hooks/
    useActivity.ts
    useHealth.ts
    usePipelines.ts
  nodes/                     composants ReactFlow
    index.ts
    shared.ts
    ports.ts                 schema des ports types (NODE_PORTS) + validation connexions
    routing.ts                moteur de routage orthogonal (pur, sans React/xyflow)
    AppNode.tsx            node generique explorer/annotation/dvc/mlflow/optuna
    DatasetNode.tsx
    ModelNode.tsx            node d'entree : modele .pt fourni a la main
    NodePorts.tsx            rendu visuel des ports (entrees/sorties) d'un node
    OrthogonalEdge.tsx        arete unique, tracee via routing.ts
  components/
    NodeConfigPanel.tsx    panneau droit de config d'un node selectionne
    UserBadge.tsx
  pages/
    SandgraphPage.tsx      editeur principal
    ExperimentsPage.tsx
    ActivityPage.tsx
    AppsPage.tsx
    LibraryPage.tsx
    PipelinePage.tsx
    DashboardPage.tsx
    AboutPage.tsx
    MLOpsPage.tsx            page parent des sous-onglets MLOps (routing imbrique)
    InsightsPage.tsx          detail d'un Run Insight
    PlansPage.tsx             editeur + suivi d'Experiment Plans
    LineageGraphPage.tsx      graphe cross-experiences + comparaison de runs
    GuidePage.tsx             doc de reference Git/DVC/MLflow (modele mental)
```

### `src/main.tsx` + `src/App.tsx`
- **main.tsx** : monte React, `QueryClientProvider` (React Query), `Toaster` (toast)
- **App.tsx** : layout global - sidebar nav (6 onglets, dont `MLOps`), `<Routes>` vers chaque page,
  `UserBadge` en footer. La route `/` pointe vers `SandgraphPage`. L'onglet `MLOps` (`MLOpsPage`)
  monte des routes imbriquees (`/mlops/insights`, `/mlops/plans`, `/mlops/activity`,
  `/mlops/lineage`, `/mlops/guide`) sous un meme sous-menu ; les anciennes routes courtes
  (`/insights`, `/activity`, `/lineage`, `/guide`) redirigent vers leur equivalent `/mlops/*`.

### `src/api/client.ts`
Couche d'acces API : toutes les fonctions fetch centralisees ici.
- Instance `axios` avec `baseURL: ''` (proxy Vite en dev, relatif en prod)
- `BACKEND_BASE` - URL absolue pour le SSE (bypass le proxy Vite qui bufferiserait le stream)
- `graphsAPI` - le plus important : `list`, `create`, `get`, `update`, `delete`, `duplicate`,
  `reset`, `run`, `resume`, `getAppUrls`, `getWorkspaceOutputs`
- `launcherAPI` - launch/stop apps
- `pipelinesAPI`, `activityAPI`, `settingsAPI`, `experimentsAPI` - secondaires
- `streamRun()` - connexion SSE directe via `fetch()` (pas axios) avec lecture du `ReadableStream`

Important : `getWorkspaceOutputs()` scanne le workspace cote backend et retourne
`{subsets, exports}` sans necessiter que les apps tournent.

### `src/types/api.ts`
Contrat de types entre frontend et backend.
- `SandGraph` - graph_id, name, nodes, edges, status, execution (map node_id -> NodeExecState), run_history
- `RunEvent` - step_id, status, type (step_update | done | waiting | error), hint, error
- `GraphRunResponse` - run_id, step_node_map
- `AppLaunchStatus` - app_id, status, backend_url, frontend_url, pid

### `src/nodes/shared.ts`
Constantes partagees entre tous les composants de nodes.
```typescript
type NodeExecStatus = 'idle' | 'running' | 'waiting' | 'done' | 'failed'
STATUS_DOT  // classes Tailwind par statut (couleur du dot)
STATUS_RING // classes ring par statut (bordure coloree du node)
```

### `src/nodes/index.ts`
Registre ReactFlow des node types :
```typescript
export const nodeTypes = {
  dataset_source: DatasetNode,
  model:          ModelNode,
  explorer:           AppNode,
  annotation:     AppNode,
  dvc:            AppNode,
  mlflow:         AppNode,
  optuna:         AppNode,
  training:       AppNode,
  inference:      AppNode,
}
```

### `src/nodes/DatasetNode.tsx`
Node source dataset, simple, pas de logique FREE/LOCKED. Affiche `dataset_name`, `dataset_path`,
`n_clusters`, statut d'execution. Section expandable avec les parametres. Handle source
uniquement (pas de target, il n'a pas d'input).

### `src/nodes/ModelNode.tsx`
Node d'entree, meme famille que `DatasetNode` (aucun input, pas de logique FREE/LOCKED) : un modele
YOLO `.pt` fourni a la main (`model_path`). Sert a combler l'entree `model` d'un `training` (poids
de depart pour du fine-tuning) ou d'un `inference` (modele a tester) sans faire passer le graphe
par un `training` amont. Affiche le nom de fichier, la version/taille YOLO si renseignees, et sa
seule sortie via `<NodePorts nodeType="model" inputHandles={[]} .../>`.

### `src/nodes/ports.ts`, `NodePorts.tsx`, `OrthogonalEdge.tsx`, `routing.ts`
Voir la section [Ports types des nodes](#ports-types-des-nodes-portsts) plus haut pour le detail du
schema `NODE_PORTS`, de la validation de connexion, du rendu visuel des ports et du routage des
aretes - pas repete ici.

### `src/nodes/AppNode.tsx` (nodes)
Composant generique pour les types d'app-nodes qui suivent le meme moule visuel (explorer,
annotation, dvc, mlflow, optuna, training, inference). Toute la logique visuelle FREE/LOCKED est ici.
- `AppNodeData` interface : tous les champs possibles - `node_type`, `label`, `exec_status`,
  `has_input` (calcule, jamais persiste), `frontend_url`, `waiting_hint`, champs specifiques
  explorer/annotation/dvc
- `APP_META` : map `AppNodeType -> {icon, color, bg, title}`, determine la couleur et l'icone de
  chaque type
- `dispatchSelectOutput(nodeId, nodeType, name)` : emet
  `window.CustomEvent('orch:select-output', {nodeId, nodeType, name})` quand l'utilisateur
  clique un output existant en mode FREE ; `SandgraphPage` ecoute cet event
- `AppNode({ id, data, selected })` : composant principal, calcule
  `isFreeMode = (type === 'explorer' || 'annotation') && data.has_input === false`. Badge FREE (vert,
  Unlock) ou LOCKED (ambre, Lock) dans le header. Banner "Action requise" si `status === 'waiting'`
- `VisuNodeSummary` : mode FREE -> liste les subsets cliquables (hover violet, clic ->
  `dispatchSelectOutput`) ; mode LOCKED -> affiche query + liste informative non-cliquable. Le
  subset correspondant a `data.subset_name` est toujours surligne en violet
- `AnnotationNodeSummary` : mode FREE -> liste les exports cliquables (hover rose) ; mode LOCKED
  -> affiche mode (auto/manuel), classes, liste exports historiques. L'export configure
  (`{project_name}-yolo`) est surligne en rose
- `NodeConfig` (panneau expanse) : affiche les parametres detailles selon le type ; en mode FREE
  masque les champs inutiles (query, top_k, split%, label_classes)

Important : `has_input` est passe dans `data` par `SandgraphPage`, pas de prop separee. Jamais
persiste (strippe au save/run).

### `src/components/NodeConfigPanel.tsx`
Panneau lateral droit : edition des parametres du node selectionne.
- `NodeConfigPanel({ node, appUrls, onUpdate, onClose, onDelete })`
- Switch sur `node.data.node_type` -> affiche le sous-formulaire correspondant
- `DatasetConfig` : dataset_name, dataset_path, n_clusters
- `VisuConfig` : dataset_name, subset_name, query, top_k
- `AnnotationConfig` : subset_name, project_name, annotation_mode, full_auto, ai_model, ai_text,
  ai_threshold, label_classes (add/remove/color), split_train/val
- `DVCConfig` : commit_message
- `ManualConfig` : message info pour MLflow/Optuna (etape manuelle)
- Chaque formulaire appelle `onUpdate(nodeId, patch)` -> `SandgraphPage` met a jour le state + `setDirty`

Important : les modifications ne sont pas auto-sauvegardees, l'utilisateur doit cliquer
"Sauvegarder" ou Ctrl+S.

### `src/components/UserBadge.tsx`
Footer avec infos utilisateur, workspace actif, et acces aux parametres. Affiche : nom
utilisateur, chemin workspace, icone de statut apps, acces rapide settings.

### `src/pages/SandgraphPage.tsx` (page principale)
Editeur visuel de graphes : canvas ReactFlow + toolbar + client SSE + gestion d'etat.
- `TOOLBOX_NODES` : definit les 6 types draggables avec leurs `defaults` (valeurs initiales a la
  creation). A mettre a jour ici si on change les parametres par defaut
- State principal : `nodes`, `edges` (etat ReactFlow), `activeId` (graph ouvert, persiste
  localStorage), `stepNodeMap` (`{step_id: node_id}` recu au lancement, colore les nodes pendant l'execution)
- Undo/Redo : `historyRef` + `futureRef` (snapshots `{nodes, edges}`), `nodesRef`/`edgesRef`
  (mirrors anti stale-closures), `pushHistory()` appele avant chaque mutation
- `refreshWorkspaceOutputs()` : appelle `getWorkspaceOutputs()` -> injecte `available_subsets`
  dans les nodes explorer et `available_exports` dans les nodes annotation, injecte aussi `has_input`
  via `edgesRef.current`. Appele au chargement, toutes les 30s, et apres chaque etape
  `__export`/`__exportyolo` reussie
- `useEffect([edges])` : recalcule `has_input` a chaque changement de topologie, bascule un node
  FREE -> LOCKED des qu'on le connecte
- `useEffect(window 'orch:select-output')` : ecoute les clics sur outputs existants depuis
  `AppNode`, met a jour `subset_name`/`project_name` + `setDirty`
- `onConnect` : ajoute l'arete + auto-propagation des parametres (voir section connexions)
- `isValidConnection` : filtre via `inputAccepts`/`wouldViolateExclusivity` (`nodes/ports.ts`)
- `saveMut` : strip les champs runtime avant save (`exec_status`, `frontend_url`,
  `waiting_hint`, `has_input`)
- `runMut` : save + POST `/run` -> recoit `{run_id, step_node_map}` -> ouvre SSE via `_openSSE()`
- `_openSSE(graphId, rid, snm)` : connexion SSE `fetch()` (pas axios), lit le `ReadableStream`
  ligne par ligne, sort sur `type === "done"` ou `type === "waiting"`, appelle
  `_handleSSEEvent` pour chaque event
- `_handleSSEEvent` : met a jour le statut du node correspondant (via `stepNodeMap`), declenche
  `refreshWorkspaceOutputs()` apres `__export`/`__exportyolo` reussis, ajoute une entree au log
- `resumeMut` : POST `/resume` -> recoit nouveau `run_id` -> reconnecte SSE
- `enrich(node)` : au premier chargement d'un graphe, injecte `exec_status`, `frontend_url`,
  `waiting_hint`, `has_input` depuis les aretes

Important : ReactFlow necessite d'etre wrappe dans `ReactFlowProvider` -> `SandgraphPage` exporte
un wrapper qui render `<SandgraphInner />` a l'interieur du provider.

### `src/pages/ExperimentsPage.tsx`
Galerie des experiences + templates predefinis.
- `SANDGRAPH_TEMPLATES` : 8 templates - 4 classiques (CV Training Loop, Annotation rapide,
  Exploration dataset, Re-train + HPO) + 4 scenarios de test FREE/LOCKED (SC1 a SC4, voir
  [test-scenarios.md](test-scenarios.md)). Les templates SC1/SC2 ont des nodes explorer/annotation
  sans arete entrante -> seront en mode FREE au chargement
- `GraphCard` : statut, progression (nodes done / total), derniere modification, actions
  (ouvrir / lancer / reset / dupliquer / supprimer)
- `TemplateCard` : card en pointilles pour chaque template, bouton "Utiliser ce template"

Important : au clic "Utiliser ce template", `createFromTemplateMut` cree le graph via API puis
navigue vers `/` (SandgraphPage) avec `active_graph_id` set en localStorage.

### `src/pages/AppsPage.tsx`
Dashboard de gestion des sous-apps : statut live (running/stopped/error), latence, URL frontend,
boutons Launch/Stop. Polling health toutes les 5s. Utile pour debug et pour lancer manuellement
les apps avant d'utiliser le mode FREE.

### `src/pages/ActivityPage.tsx`
Historique des executions pipeline. Liste les runs recents avec statut, duree, steps executes,
timestamp. Append-only, pas d'actions.

### `src/pages/LibraryPage.tsx` + `PipelinePage.tsx`
Systeme de pipelines "legacy", anterieur au systeme sandgraph. Permet de creer des pipelines
manuellement etape par etape (sans editeur visuel). Toujours fonctionnel mais secondaire, le
flux principal passe par les sandgraphs.

### `src/pages/DashboardPage.tsx`
Vue d'ensemble : etat du workspace, apps actives, derniere activite, raccourcis. Page d'accueil
si aucun graph actif.

### `src/pages/MLOpsPage.tsx`, `InsightsPage.tsx`, `PlansPage.tsx`, `LineageGraphPage.tsx`, `GuidePage.tsx`
Groupe de pages "MLOps" (monitoring + tracabilite), voir la section
[Run Insight et lineage](#run-insight-et-lineage-git--dvc--mlflow) et
[Plans d'experiences](#plans-dexperiences) plus haut pour le detail de chacune. `MLOpsPage.tsx` ne
fait que la barre de sous-onglets + `<Outlet/>` (routing imbrique) ; `GuidePage.tsx` est la doc de
reference statique du modele mental Git/DVC/MLflow (que les apps dvc-app/mlflow-app ne repetent pas,
elles y renvoient et restent centrees sur leur usage).

### `src/hooks/`
Trois hooks React Query secondaires :
- `useActivity(limit)` -> polling `GET /api/activity`
- `useHealth()` -> polling `GET /api/health` (latence apps), cache 10s
- `usePipelines()` -> liste pipelines legacy

### `src/utils/time.ts`
`formatDistanceToNow(isoDate)` -> "il y a 3 minutes", `formatDuration(ms)` -> "2m 34s".

### `vite.config.ts`
Dev server port 3000. Proxy `/api/*` -> `http://localhost:{VITE_BACKEND_PORT}` (default 8060).
Important : le SSE bypasse ce proxy (connexion directe `BACKEND_BASE`) pour eviter le buffering Vite.

---

## `launcher.py` (racine)

Script de lancement principal, unique point d'entree pour tout demarrer correctement.
- Parse args : `--workspace`, `--user`, `--app orchestrator`, `--conda-env`
- Cree la structure workspace (`explorer_{user}/`, `annotation_{user}/`, etc.) si elle n'existe pas
- Alloue les ports dynamiquement (lock file pour eviter les collisions)
- Set les env vars pour le backend : `ORCHESTRATOR_WORKSPACE`, `ORCHESTRATOR_USER`
- Lance `uvicorn` (backend 8060) + `npm run dev` (frontend 3000)
- Signal handler SIGINT/SIGTERM -> kill propre des deux processus

Important : ne jamais lancer `uvicorn` manuellement sans ces env vars, le backend ecrirait dans
les mauvais repertoires.

---

## `data/` (repertoire de donnees)

```
data/
  graphs/experiments.json    tous les sandgraphs (nodes, edges, exec state)
  pipelines/*.json           pipelines legacy + graph__*.json generes au run
  activity.json              log des executions (max 200)
  experiments.json           experiences avec metriques
  launcher_state.json        etat des sessions sous-apps
```

Tout est JSON humainement lisible. En cas de bug, lire `graphs/experiments.json` pour inspecter
l'etat d'un graph et `activity.json` pour l'historique des runs.
