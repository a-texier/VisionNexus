*[Read in English](ECOSYSTEM.md)*

# CV Suite - Reference Ecosysteme Complet

> Mis a jour : 2026-09-13. Chaque fait ci-dessous est verifie contre le code ou
> la doc a jour de l'app concernee, pas recopie d'une revision anterieure.

---

## 1. Vue d'ensemble

8 applications independantes (7 apps metier + 1 orchestrateur). Chaque app
tourne de facon autonome ; l'orchestrateur les chaine via HTTP selon un DAG
visuel (sandgraph).

```
+-----------------------------------------------------------+
|                    ORCHESTRATOR (8060)                    |
|  Sandgraph  ->  PipelineDef  ->  DAG executor  ->  SSE    |
+----+-------+--------+--------+--------+--------+----------+
     |       |        |        |        |        |
  Explorer  Annot.  Training  DVC   MLflow  Optuna  Inference
  (8001)   (8000)   (8064)  (8061) (8062)  (8063)   (8065, FREE node)
```

`Inference_App` est un noeud d'inference sur fichiers. Il recoit du graphe un
modele et un chemin de media. MLflow reste un noeud superviseur isole (voir
section 4.6).

---

## 2. Carte des ports

### Full-stack / lance par le launcher unifie (autoritaire)

| App | Launcher key | Backend | Frontend | Workspace subdir |
|-----|-------------|---------|----------|-------------------|
| Orchestrator | `orchestrator` | **8060** | **3000** | `orchestrator_<user>/` |
| Annotation | `annotation` | **8000** | **5173** | `annotation_<user>/` |
| Dataset Explorer | `explorer` | **8001** | **5174** | `explorer_<user>/` |
| Training | `training` | **8064** | **5176** | `training_<user>/` |
| DVC | `dvc` | **8061** | **3002** | `dvc_<user>/` |
| MLflow | `mlflow` | **8062** | **3001** | `mlflow_<user>/` |
| Optuna | `optuna` | **8063** | **3003** | `optuna_<user>/` |
| Inference | `inference` | **8065** | **5177** | `inference_<user>/` |

> Regle : ces ports sont fixes dans le launcher unifie. Ne jamais les
> hardcoder dans du code applicatif, toujours lire `APP_URLS`/`config.py`.

### Piege connu : defauts standalone vs full-stack

Plusieurs apps ont un port par defaut different selon qu'on les lance seules
(`start.sh`/uvicorn direct, pour du dev isole) ou via le launcher unifie :

- **DVC_App** : standalone 8002/3002, full-stack 8061/3002 (backend seul change).
- **MLflow_App** : standalone 8001/3001 (collision possible avec Dataset_Explorer_App
  en full-stack qui utilise aussi 8001), full-stack 8062/3001.

Ce n'est pas un bug : ce sont deux modes d'usage distincts. Mais ne pas
supposer qu'un `curl localhost:8001` cible forcement MLflow ou explorer selon le
contexte de lancement.

---

## 3. Lancement

### Launcher unifie (recommande)
```bash
python launcher.py --app orchestrator --workspace <WORKSPACE> --user bob
python launcher.py --app annotation   --workspace <WORKSPACE> --user bob
python launcher.py --app explorer         --workspace <WORKSPACE> --user bob
python launcher.py --app training     --workspace <WORKSPACE> --user bob
python launcher.py --app dvc          --workspace <WORKSPACE> --user bob
python launcher.py --app mlflow       --workspace <WORKSPACE> --user bob
python launcher.py --app optuna       --workspace <WORKSPACE> --user bob
python launcher.py --app inference    --workspace <WORKSPACE> --user bob
```

### Depuis l'Orchestrateur (recommande pour le dev)
Applications -> bouton Launch sur chaque card -> les apps se lancent en
arriere-plan, le frontend s'ouvre automatiquement.

### Lancer une app seule (debug)
```bash
cd Annotation_App && python launcher.py --workspace <WORKSPACE> --user bob
```

### Export / bundle

`App/Vision/package_cv_bundle.py` (un niveau au-dessus de `Computer_Vision_App/`)
produit un zip "cle en main" (launcher global + runtime Node + docs + apps).
C'est aussi ce script qui alimente la publication GitHub
(`App/Vision/publish_github.py`) : il exclut systematiquement les fichiers
`CLAUDE.md` (notes dev internes) et le contenu specifique au materiel de
deploiement, pour ne publier qu'une doc generique par application.

---

## 4. Etat actuel de chaque application

### 4.1 Orchestrator_App
Editeur de pipeline visuel (sandgraph ReactFlow), executeur DAG avec SSE.
Noeuds : `dataset_source`, `explorer`, `annotation`, `training`, `dvc`, `mlflow`,
`optuna`. Mode FREE/LOCKED automatique selon connectivite. Voir
[Orchestrator_App/docs/README.md](../Orchestrator_App/docs/README.md).

### 4.2 Annotation_App
Annotation d'images et sequences video/format specialise avec IA (SAM2/SAMURAI, Grounding
DINO, YOLO custom, homographie, flux optique). Multi-sequence, images 16 bits,
export YOLO/COCO/VER. Voir
[Annotation_App/docs/README.md](../Annotation_App/docs/README.md).

### 4.3 Dataset_Explorer_App
Exploration et analyse de datasets d'images via embeddings CLIP + FAISS,
UMAP/t-SNE/PCA, recherche semantique, gestion de subsets, export vers
Annotation_App. Voir [Dataset_Explorer_App/docs/README.md](../Dataset_Explorer_App/docs/README.md).

### 4.4 Training_App
Entrainement YOLO (v8/v9/v10/v11) avec SSE temps reel (loss, mAP50, mAP50-95,
precision, recall par epoch). **MLflow auto-push deja implemente** (
`backend/services/mlflow_logging.py`, ecrit directement dans le store sqlite
`mlflow_<user>/mlflow_data/mlflow.db`) - contrairement a ce que l'ancienne
doc indiquait comme manquant. Voir
[Training_App/docs/README.md](../Training_App/docs/README.md).

### 4.5 DVC_App
Versioning de datasets via DVC + Git (commits, historique, diff, sync).
Pages Diff et Sync completes (table de diff reelle, SSE push/pull avec
annulation). Voir [DVC_App/README.md](../DVC_App/README.md).

### 4.6 MLflow_App
Suivi d'experiences ML, registre de modeles. Pivot serverless : lit
directement le store sqlite par utilisateur, plus de sous-processus serveur
MLflow. C'est un **noeud superviseur isole** dans l'orchestrateur : pas
d'arete entrante, pas de gate `mlflow-check`, auto-lance des qu'un noeud
MLflow existe dans le graphe et affiche un resume live du store. Voir
[MLflow_App/README.md](../MLflow_App/README.md).

### 4.7 Optuna_App
Optimisation bayesienne d'hyperparametres (Optuna + SQLite), SSE temps reel.
Deux contrats orchestrateur distincts : script utilisateur (args `--name
value` + metrique finale en derniere ligne stdout) et endpoint
`/api/orchestrator/hpo` (bloquant pour toute l'etude). Voir
[Optuna_App/README.md](../Optuna_App/README.md).

### 4.8 Inference_App
Application FastAPI + React compacte pour l'inference YOLO sur images, videos
ou dossiers d'images. La detection pure est le mode par defaut ; ByteTrack est
optionnel pour le MOT et le SOT au clic utilise OpenCV CSRT apres la premiere
detection YOLO. L'evaluation produit mAP50, mAP50-95, courbes PR/F1, matrice de
confusion et temps detecteur/tracker/global separes. Voir
[Inference_App/docs/architecture.md](../Inference_App/docs/architecture.md).

---

## 5. Comment agrandir la suite

Voir [ADDING_AN_APP.md](ADDING_AN_APP.md) pour la checklist complete
(endpoint `/api/orchestrator/`, declaration dans `config.py`, noeud
`graph_runner.py`, cote frontend `NODE_ACCEPTS`/`TOOLBOX_NODES`).

Regles d'or :
| Regle | Detail |
|-------|--------|
| 1 app = 1 README.md + 1 docs/ | Voir [APP_TEMPLATE.md](APP_TEMPLATE.md) pour partir d'une base saine |
| Contrat `/api/orchestrator/` | Ne jamais renommer ces endpoints sans mettre a jour `graph_runner.py` |
| Workspace sacre | Jamais ecrire dans le repertoire de l'app, toujours dans `WORKSPACE/<app>_<user>/` |
| Tests avant merge | Chaque app a ses tests unitaires, toujours les passer avant de modifier le backend |

---

## 6. Structure workspace (reference)

```
WORKSPACE/
  orchestrator_bob/     graphs/ pipelines/ activity.json experiments/
  annotation_bob/       annotation.db  projects/  exports/
  explorer_bob/              dataset_explorer.db  thumbs/  faiss/  subsets/
  training_bob/         runs/
  dvc_bob/               settings.json
  mlflow_bob/            mlflow_data/mlflow.db
  optuna_bob/            optuna.db
  inference_bob/        runs/  config.yaml
```

---

## 7. Scenarios de test

Templates SC1 a SC5 (Orchestrateur, `ExperimentsPage`) : voir
[Orchestrator_App/docs/test-scenarios.md](../Orchestrator_App/docs/test-scenarios.md).

---

## 8. Stack technique globale

| Couche | Techno |
|--------|--------|
| Backend | Python 3.11+, FastAPI, uvicorn, SQLite (SQLModel), asyncio |
| HTTP inter-apps | httpx (async), proxy_client.py dans l'Orchestrateur |
| Frontend | React 18/19, TypeScript, Vite, Tailwind CSS, lucide-react |
| State serveur | TanStack Query v5 |
| State client | Zustand |
| Graph/Canvas | @xyflow/react (ReactFlow), Konva.js (Annotation) |
| Temps reel | SSE via fetch() direct backend (bypass proxy Vite) |
| ML | CLIP (open_clip), FAISS, UMAP-learn, SAM2/SAMURAI, Grounding DINO, YOLO |
| Train | Ultralytics YOLO (v8/v9/v10/v11) |
| Tracking video | Detections YOLO, MOT ByteTrack optionnel, SOT au clic avec OpenCV CSRT (Inference_App) |
| Experiment tracking | MLflow (serverless, sqlite) |
| HPO | Optuna + SQLite |
| Versioning | DVC + Git |
| OS | Windows 11 (dev), Linux (cible VM GPU) |

---

## 9. Reference documentaire par app

| App | Doc |
|-----|-----|
| Orchestrator_App | [docs/README.md](../Orchestrator_App/docs/README.md) |
| Annotation_App | [docs/README.md](../Annotation_App/docs/README.md) |
| Dataset_Explorer_App | [docs/README.md](../Dataset_Explorer_App/docs/README.md) |
| Training_App | [docs/README.md](../Training_App/docs/README.md) |
| DVC_App | [README.md](../DVC_App/README.md) (pas de docs/, app trop petite pour le justifier) |
| MLflow_App | [README.md](../MLflow_App/README.md) (idem) |
| Optuna_App | [README.md](../Optuna_App/README.md) (idem) |
| Inference_App | [README.md](../Inference_App/README.md), [architecture.md](../Inference_App/docs/architecture.md) |
