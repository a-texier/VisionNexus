---
app: inference
doc_type: configuration
audience: both
lang: fr
title: Configuration
order: 40
tags: [installation, lanceur, ports, variables d'environnement, workspace, config.yaml]
sources: [Inference_App/backend/config.py, Inference_App/backend/api/settings.py, Inference_App/config/defaults.yaml, Inference_App/requirements.txt, Inference_App/frontend/vite.config.ts, _lib/launcher_engine.py]
---

# Configuration

## Prérequis système d'Inference App

Inference App a besoin d'un environnement Python pour le backend et de Node.js pour l'interface, le même environnement conda que le reste de la suite (`IA_env` par défaut).

- **Python** 3.10 ou plus récent, avec : `fastapi`, `uvicorn[standard]`, `numpy`, `opencv-contrib-python-headless` (ou une autre version d'OpenCV fournissant `cv2.legacy.TrackerCSRT_create` ou `cv2.TrackerCSRT_create` pour le mode SOT), `torch`, `pyyaml`, `matplotlib` (voir `requirements.txt`).
- **Node.js** 18 ou plus récent avec npm, pour faire tourner l'interface Vite.
- **GPU** : un GPU NVIDIA avec une version CUDA de PyTorch est recommandé pour des fréquences d'images raisonnables ; l'application fonctionne aussi sur CPU, plus lentement.
- Le code YOLOX embarqué utilisé pour charger les checkpoints vit dans `Training_App/backend/vendor/yolox/` : Training App doit être présente à côté d'Inference App dans le dépôt, même en n'utilisant que l'inférence (voir [Architecture](architecture.fr.md)).

## Lancer Inference App depuis VisionNexus ou le lanceur de la suite

La manière normale de démarrer Inference App est VisionNexus, qui lance le backend et l'interface pour l'utilisateur et la racine de workspaces choisis, en local ou sur une VM distante par SSH.

Depuis la racine de la suite (`Computer_Vision_App/`), le lanceur commun fait la même chose dans un terminal :

```bash
python launcher.py --app inference --workspace <racine des workspaces> --user <nom>
```

Options utiles : `--conda-env` (par défaut `IA_env`) ou `--conda-path`, `--backend-only` (sans interface), `--no-reload`, `--backend-port` / `--frontend-port` (ports fixes, uniquement pour un lancement d'une seule app). Plusieurs apps peuvent être démarrées ensemble (`--app training inference`).

Le workspace de l'app est `<racine des workspaces>/inference_<nom>`. Contrairement à Training App, Inference App n'a pas de script de lancement local à l'app ; elle ne se démarre que via le lanceur de la suite (`launcher.py` à la racine du dépôt) ou VisionNexus.

## Lancer le backend et le frontend manuellement

Pour le développement, les deux processus se lancent à la main depuis `Inference_App/` :

```bash
uvicorn backend.main:app --host 127.0.0.1 --port 8065 --reload
cd frontend
npm install
npm run dev
```

Sans variables d'environnement, le workspace est `Inference_App/data/` et les ports sont 8065 (backend) et 5177 (interface). Définissez `BACKEND_PORT` pour le backend, et `VITE_BACKEND_PORT` / `VITE_FRONTEND_PORT` pour l'interface, pour utiliser d'autres ports.

## Ports et accès réseau

| Composant | Port par défaut | Variable |
|---|---|---|
| Backend (FastAPI) | 8065 | `BACKEND_PORT` |
| Interface (Vite) | 5177 | `INFERENCE_APP_FRONTEND_PORT` pour la liste CORS du backend, `VITE_FRONTEND_PORT` pour Vite |

Le serveur Vite relaie chaque requête `/api` vers le backend, avec un timeout de 3600 secondes pour accommoder les longues inférences et évaluations ; l'interface ne parle jamais directement au port du backend (contrairement au flux SSE de Training App). VisionNexus relaie le port de l'interface par son tunnel SSH quand l'app tourne sur une VM distante.

Le backend n'accepte les requêtes que de son propre port d'interface (`INFERENCE_APP_FRONTEND_PORT`), sur `localhost` et `127.0.0.1`.

## Variables d'environnement d'Inference App

| Variable | Défaut | Rôle |
|---|---|---|
| `INFERENCE_APP_WORKSPACE` | `Inference_App/data` | Dossier du workspace (runs, uploads, réglages). Défini par le lanceur. |
| `INFERENCE_APP_USER` | `unknown` | Nom d'utilisateur, utilisé par `GET /api/app-mode`. Défini par le lanceur. |
| `BACKEND_PORT` | `8065` | Port du backend. |
| `INFERENCE_APP_FRONTEND_PORT` | `5177` | Port de l'interface, la seule origine autorisée par le CORS du backend. |
| `VITE_BACKEND_PORT` / `VITE_FRONTEND_PORT` | `8065` / `5177` | Ports utilisés par le serveur de développement Vite. |
| `LAUNCHED_BY_ORCHESTRATOR` | vide | `1` quand l'app est démarrée par l'Orchestrator : `GET /api/app-mode` remonte le mode `orchestrator`. |
| `VITE_CACHE_DIR` | vide | Dossier de cache Vite séparé, quand deux interfaces tournent depuis le même dossier. |

## Arborescence du workspace sur le disque

Le workspace d'un utilisateur (`<racine des workspaces>/inference_<user>`, ou `Inference_App/data/` sans lanceur) contient :

```text
inference_<user>/
  config.yaml        configuration modifiée (voir ci-dessous) ; absent avant le premier enregistrement
  settings.json       langue de l'interface (hors VisionNexus seulement)
  runs/
    <nom du run>/        un dossier par run d'inférence ou d'évaluation
      result.mp4 / result<ext>   sortie annotée (runs d'inférence)
      result.json, request.json  chiffres de benchmark et requête qui les a produits
      metrics.json, pr_curve.png, f1_curve.png, confusion_matrix.png  (runs d'évaluation)
  uploads/             créé au démarrage, non utilisé par la version actuelle
```

`GET /api/output?path=` ne sert que des fichiers sous `runs/` du workspace (une tentative de sortie de ce dossier est refusée), c'est ainsi que l'interface affiche le résultat d'un run et les graphiques d'une évaluation.

## Le schéma de config.yaml

`config/defaults.yaml` à la racine de l'app fournit les défauts embarqués et n'est jamais modifié par l'application elle-même. Le `config.yaml` du workspace (créé au premier enregistrement depuis l'onglet **Config YAML**) le remplace entièrement quand il existe : `GET /api/config` lit `config.yaml` s'il existe, sinon `defaults.yaml`.

Les clés reconnues, avec leurs valeurs par défaut :

```yaml
engine: yolox
model_size: yolox-s
mode: infer            # infer | mot | sot
tracker: none           # none | bytetrack
confidence: 0.25
iou: 0.45
imgsz: 640
device: ""              # "" = auto (cuda si disponible, sinon cpu)
class_names: []          # facultatif, dans l'ordre des id de classe ; sinon class_<n> est affiché
track_high_thresh: 0.5
track_low_thresh: 0.1
new_track_thresh: 0.6
match_thresh: 0.3
track_buffer: 30
save_output: true
max_frames: 0            # 0 = pas de limite
```

`PUT /api/config` accepte n'importe quel objet YAML ; les clés inconnues sont conservées telles quelles dans le fichier enregistré mais ignorées par l'application. Le `config/defaults.yaml` propre à Inference App (pas le `config.yaml` enregistré du workspace) est ce que l'endpoint meta de l'Orchestrator lit pour construire son formulaire de nœud Inference, groupé en **Detector** (`engine`, `model_size`, `confidence`, `iou`, `imgsz`, `device`, `class_names`), **Mode** (`mode`, `tracker`), **ByteTrack** (`track_high_thresh`, `track_low_thresh`, `new_track_thresh`, `match_thresh`, `track_buffer`) et **Output** (`save_output`, `max_frames`) ; `engine` et `model_size` sont verrouillés dans ce formulaire quand le nœud Inference est alimenté par un nœud Training.

## Vérifier l'installation d'Inference App

1. Ouvrez `http://localhost:<port du backend>/health` : la réponse est `{"status": "ok", "app": "Inference_App", "version": "2.0.0"}`.
2. Ouvrez `http://localhost:<port du backend>/api/capabilities` : `yolox` est listé sous `detectors` avec `"available": true`.
3. Dans l'environnement du backend, lancez `python -c "import torch; print(torch.cuda.is_available())"` : `True` signifie que le GPU sera utilisé.
4. Depuis `Inference_App/`, lancez `pytest tests -q`.
5. Depuis l'interface, chargez une petite image avec **Lire le média**, réglez un checkpoint YOLOX valide, et cliquez sur **Lancer** en mode **Inférence pure** : le panneau de résultat doit afficher le nombre de frames, les chiffres de fps et une image annotée.
