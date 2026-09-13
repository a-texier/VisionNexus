# Orchestrator App

Hub central du pipeline Computer Vision. Editeur de graphe visuel (Sandgraph) pour concevoir,
executer et monitorer des workflows multi-applications sans ecrire de configuration : il chaine
les autres apps de la suite (Dataset Explorer, Annotation, Training, DVC, MLflow, Optuna) via un DAG de
noeuds relies par des connexions, avec auto-lancement des sous-apps et validation humaine aux
etapes critiques.

**Frontend** : http://localhost:3000 - **Backend** : http://localhost:8060

---

## Demarrage

```bash
cd Orchestrator_App
python launcher.py --workspace C:/ws --user alice
```

Les sept sous-applications (explorer, Annotation, Optuna, Training, Inference, MLflow et DVC) sont lancees **automatiquement**
selon les noeuds presents dans le graphe. Aucun demarrage manuel requis.

---

## Noeuds disponibles

| Noeud | App declenchee | Ce qu'il fait |
|------|---------------|---------------|
| **Dataset Source** | Dataset_Explorer_App | Charge un dossier d'images, lance l'embedding CLIP |
| **Dataset Explorer** | Dataset_Explorer_App | Cree un subset semantique par requete texte (top_k images) |
| **Annotation** | Annotation_App | Cree un projet, annote (manuel ou IA), exporte YOLO |
| **Modele (.pt)** | aucune | Noeud d'entree sans etape pipeline : fournit un modele YOLO existant au Training (fine-tuning) ou a l'Inference, sans passer par un Training amont |
| **Training** | Training_App | Entraine un YOLO (auto ou gate manuelle) -> `best.pt` |
| **Inference / Eval** | Inference_App | Noeud UNIFIE (voir FREE/LOCKED ci-dessous) |
| **DVC Commit** | dvc-app | Versionne dataset + annotations |
| **MLflow** | mlflow-app | **SUPERVISEUR** : observe le store, aucune arete entrante |
| **Optuna HPO** | optuna-app | Gate humaine : optimiser les hyperparametres |

### Noeud Inference / Eval - FREE / LOCKED

- **FREE** (aucune entree) -> **acquisition** : capture un flux (MJPEG/ZMQ/format specialise/video) et
  **produit un dataset d'images** -> consommable par Dataset Explorer / Annotation (fine-tuning).
- **LOCKED** (entree) -> **eval / inference** (`task` = track / eval_tracker / eval_detection).
  `model_path` vide -> `best.pt` du training le plus recent.

Detail complet du mode FREE/LOCKED (implementation frontend/backend) :
[docs/architecture.md](docs/architecture.md#free--locked-node-mode-cle-du-systeme).

### MLflow - noeud SUPERVISEUR

MLflow n'est **pas** une etape de pipeline : c'est un **observateur** du store MLflow du
workspace (serverless). Aucune arete entrante reelle dans le flux, aucune etape generee ;
MLflow_App est auto-lancee des qu'un noeud MLflow existe, et le noeud affiche un **resume live**
des runs.

### Connexions valides

```
DatasetSource -> Dataset Explorer -> Annotation -> Training -> Inference/Eval (LOCKED: retest)
                 ^              ^
     Inference/Eval (FREE, acquisition) --+  (dataset d'images -> Dataset Explorer ou Annotation)
                              (Training -> DVC ; Optuna -> Training)
   MLflow = superviseur isole (non branche)
```

- **Dataset Explorer -> Dataset Explorer** : subset-de-subset - le 2eme explorer filtre aux images du 1er subset
- **Inference FREE -> explorer / Annotation** : la boucle d'acquisition -> annotation -> fine-tuning
- **Auto-propagation** : DatasetSource->Dataset Explorer copie `dataset_name` ; Dataset Explorer->Annotation copie `subset_name`

Chaque node declare des ports d'entree/sortie types (dataset, subset, dataset YOLO, GT `.ver`,
modele, best params, metriques) plutot qu'une simple liste de types acceptes - couleur par type,
exclusivite entre certaines entrees (ex. Inference : images brutes OU dataset YOLO, jamais les
deux), entrees obligatoires. Regles de validation completes : [docs/architecture.md](docs/architecture.md#ports-types-des-nodes-portsts).

---

## Modes d'annotation

### Manuel
`create-project` -> **gate humaine** (annoter dans Annotation_App) -> `export-yolo`

### Full Automatique IA
`create-project` -> `auto-annotate` (SAM3 ou Grounding DINO) -> `export-yolo`

Le champ **Prompt texte** du noeud Annotation definit ce qui est detecte (ex. `"Cars"`,
`"person. bicycle. car."`).

---

## Fonctionnalites MLOps (onglet MLOps)

Un onglet regroupe le monitoring et la tracabilite des experiences, en sous-onglets
(Insights, Plans, Activite, Lineage, Guide).

**Run Insight**
- A la fin (et progressivement pendant) chaque run, l'app collecte tout ce que savent les
  sous-apps sur ce run (metriques d'entrainement par epoch, etudes Optuna, runs MLflow, commits
  DVC) et genere un rapport : courbes interactives, images d'analyse Ultralytics (matrice de
  confusion, courbes PR/F1), journal complet des etapes.
- Carte d'identite du run avec liens directs vers l'objet reel (commit Git, dataset DVC, run
  MLflow, modele) et une checklist de reproductibilite honnete (aucun "vert" par defaut).
- Actions en un clic : forker un run (relancer avec le meme dataset/annotations en changeant les
  parametres) ou promouvoir un run experimental en suivi MLOps (ajoute MLflow + DVC au graphe).

**Lineage**
- Graphe interactif reliant TOUTES les experiences du workspace : dataset source, runs, forks,
  modeles et etapes MLflow produites, navigable jusqu'a l'objet reel.
- Comparaison de deux runs cote a cote (glisser-deposer) : seules les sections qui different
  (dataset, annotations, hyperparametres, resultats...) sont mises en avant.

**Plans d'experiences**
- Planifier une suite d'experiences (chacune = un graphe de base duplique + des parametres
  modifies) et les lancer d'un clic, gates humaines auto-validees ; les resultats de chaque etape
  sont ensuite consultables dans le Lineage. Le commit DVC reste toujours une decision manuelle.

Detail technique complet (collecte, format des donnees, comparaison, moteur d'execution) :
[docs/architecture.md](docs/architecture.md#run-insight-et-lineage-git--dvc--mlflow) et
[docs/architecture.md](docs/architecture.md#plans-dexperiences).

---

## Configuration des noeuds

### Dataset Source
| Champ | Description |
|-------|-------------|
| Nom du dataset | Identifiant dans Dataset_Explorer_App |
| Chemin (dossier) | Chemin absolu vers les images |
| n_clusters | Clusters CLIP pour visualisation (defaut 15) |

### Dataset Explorer
| Champ | Description |
|-------|-------------|
| Nom du subset | Identifiant du subset a creer |
| Requete semantique | Texte decrivant les images souhaitees |
| top_k | Nombre d'images a selectionner |

### Annotation
| Champ | Description |
|-------|-------------|
| Mode | `random` (images individuelles) ou `sequence` (video/sequence) |
| Full Auto | Active l'annotation IA sans gate humaine |
| Modele IA | `SAM3` ou `Grounding DINO` |
| Prompt texte | Classes a detecter |
| Seuil confiance | Score minimum des detections (defaut 0.20) |
| Train / Val split | Proportion de l'export YOLO |

---

## API Backend (port 8060)

| Methode | Route | Description |
|---------|-------|-------------|
| GET | `/api/graphs` | Liste des graphes |
| POST | `/api/graphs` | Creer un graphe |
| GET/PUT/DELETE | `/api/graphs/{id}` | Lire / modifier / supprimer |
| POST | `/api/graphs/{id}/duplicate` | Dupliquer |
| POST | `/api/graphs/{id}/reset` | Reinitialiser l'execution |
| POST | `/api/graphs/{id}/run` | Lancer le pipeline |
| GET | `/api/graphs/{id}/run/{run_id}/stream` | SSE evenements temps reel |
| POST | `/api/graphs/{id}/resume` | Reprendre apres gate humaine |
| GET | `/api/activity` | Historique des runs |
| GET/POST | `/api/apps` | Etat et lancement des sous-apps |

---

## Architecture interne

```
backend/
  api/graphs.py          CRUD + SSE stream + resume
  core/graph_runner.py   Graphe -> PipelineDef (traduit noeuds en steps HTTP)
  core/pipeline_runner.py Moteur DAG async : execute les steps, gere les gates
  core/graph_store.py    Persistance JSON des graphes
  core/app_launcher.py   Spawn / stop / health des sous-apps
  config.py              APP_URLS, ports, chemins workspace

frontend/src/
  pages/SandgraphPage.tsx  Editeur ReactFlow, validation connexions, SSE client
  nodes/AppNode.tsx        Rendu visuel des noeuds (status, bullets subsets/exports)
  components/NodeConfigPanel.tsx  Panneau de configuration lateral
```

Detail complet (SSE, FREE/LOCKED, fichier par fichier) : [docs/architecture.md](docs/architecture.md).

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

---

## Ports par defaut

Table de reference (Orchestrator backend/frontend + les 7 sous-apps) :
[docs/architecture.md](docs/architecture.md#ports).

---

## Canvas - raccourcis

| Touche | Action |
|--------|--------|
| `Ctrl+Z` / `Ctrl+Y` | Annuler / Retablir |
| `F` | Ajuster la vue |
| `Suppr` / `Backspace` | Supprimer selection |
| Canvas verrouille pendant l'execution | - |

---

## Documentation

- **[docs/README.md](docs/README.md)** : index thematique de la documentation (architecture,
  scenarios de test, ajout d'une nouvelle app connectee).
