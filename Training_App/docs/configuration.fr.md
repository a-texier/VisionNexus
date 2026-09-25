---
app: training
doc_type: configuration
audience: both
lang: fr
title: Configuration
order: 40
tags: [installation, lanceur, ports, variables d'environnement, workspace, poids, mlflow, plugins]
sources: [Training_App/backend/config.py, Training_App/backend/api/settings.py, Training_App/launcher.py, _lib/launcher_engine.py, launcher.py, Training_App/frontend/vite.config.ts, Training_App/backend/services/mlflow_logging.py, Training_App/backend/services/trainer_backend.py, Training_App/pyproject.toml]
---

# Configuration

## Prérequis système de Training App

Training App a besoin d'un environnement Python pour le backend et de Node.js pour l'interface. La suite utilise un seul environnement conda pour toutes les apps, `IA_env` par défaut.

- **Python** 3.10 ou plus récent, avec : `fastapi`, `uvicorn`, `sqlmodel`, `pydantic`, `torch` et `torchvision`, `opencv-python`, `numpy`, `pyyaml`, `matplotlib`, et les bibliothèques importées par le code YOLOX embarqué : `loguru`, `thop`, `tabulate`, `tqdm` et `pycocotools`.
- **MLflow** (`mlflow`) est facultatif : sans lui, les runs s'entraînent normalement mais rien n'est journalisé dans MLflow.
- **Node.js** 18 ou plus récent avec npm, pour faire tourner l'interface Vite. Les bundles Linux embarquent leur propre Node.js.
- **GPU** : un GPU NVIDIA avec une version CUDA de PyTorch est fortement recommandé. L'entraînement sur CPU fonctionne mais est très lent. La mémoire GPU nécessaire augmente avec la taille du modèle, **Taille image** et **Batch size** ; sur un petit GPU, baissez d'abord **Batch size**.
- **Disque** : chaque dossier de run contient plusieurs checkpoints (de quelques Mo pour `nano` à plusieurs centaines de Mo pour `x`, multipliés par le nombre d'évaluations).

Le code YOLOX est inclus dans `Training_App/backend/vendor/yolox/` (version 0.3.0, Apache-2.0) : rien à installer pour lui. Inference App importe ce même code pour charger les poids YOLOX, Training App doit donc être présente à côté d'elle.

## Lancer Training App depuis VisionNexus ou le lanceur de la suite

La manière normale de démarrer Training App est VisionNexus, qui lance le backend et l'interface pour l'utilisateur et la racine de workspaces choisis, en local ou sur une VM distante par SSH, et ouvre l'interface dans un onglet dès que le backend répond à `/health`.

Depuis la racine de la suite (`Computer_Vision_App/`), le lanceur commun fait la même chose dans un terminal :

```bash
python launcher.py --app training --workspace <racine des workspaces> --user <nom>
```

Options utiles : `--conda-env` (par défaut `IA_env`) ou `--conda-path` (environnement explicite), `--backend-only` (sans interface), `--no-reload` (désactive le redémarrage automatique du backend quand un fichier Python change), `--backend-port` / `--frontend-port` (ports fixes). Plusieurs apps peuvent être démarrées ensemble (`--app training inference`).

Le workspace de l'app est `<racine des workspaces>/training_<nom>`. Le lanceur enregistre l'instance dans `Computer_Vision_App/.run/.instances.json`, pour que plusieurs utilisateurs et apps obtiennent des ports distincts, et arrête le backend et l'interface sur `Ctrl+C`.

`Training_App/launcher.py` est un lanceur équivalent limité à cette app (`python launcher.py --user <nom> --workspace <racine>` depuis `Training_App/`), avec les mêmes options sauf `--conda-path`.

## Lancer le backend et le frontend manuellement

Pour le développement, les deux processus se lancent à la main depuis `Training_App/` :

```bash
uvicorn backend.main:app --host 127.0.0.1 --port 8064 --reload
cd frontend
npm install
npm run dev
```

Sans variables d'environnement, le workspace est `Training_App/data/` et les ports sont 8064 (backend) et 5176 (interface). Pour d'autres ports, définissez `BACKEND_PORT` pour le backend, et `VITE_BACKEND_PORT` et `VITE_FRONTEND_PORT` pour l'interface. `TRAINING_APP_WORKSPACE` et `TRAINING_APP_USER` peuvent aussi être définies à la main pour reproduire un workspace géré par un lanceur.

Avec `--reload`, uvicorn redémarre le backend dès qu'un fichier Python de l'app change : un run en cours est alors perdu (voir [Dépannage](troubleshooting.fr.md)). Utilisez `--no-reload` pour les longs entraînements, et préférez le lanceur en dehors du développement actif du backend.

## Ports et accès réseau

| Composant | Port par défaut | Variable |
|---|---|---|
| Backend (FastAPI) | 8064 | `BACKEND_PORT` |
| Interface (Vite) | 5176 | `TRAINING_APP_FRONTEND_PORT` pour la liste CORS du backend, `VITE_FRONTEND_PORT` pour Vite |

Les lanceurs partent de ces ports de base et prennent les suivants libres quand ils sont occupés par une autre instance. Le serveur Vite relaie `/api` vers le backend, mais deux types de requêtes vont directement du navigateur vers `http://localhost:<port du backend>` : le flux de progression d'un run (SSE) et les images de la galerie d'analyse. Le port du backend doit donc être joignable en `localhost` depuis la machine qui affiche l'interface. VisionNexus relaie les deux ports par son tunnel SSH quand l'app tourne sur une VM distante ; un navigateur ouvert sur une autre machine sans tunnel affiche les pages, mais ni la progression en direct ni les graphiques.

Le backend accepte les requêtes du port de l'interface et des ports de développement usuels (5173, 5175, 5176, 3000) sur `localhost` et `127.0.0.1`.

## Variables d'environnement de Training App

| Variable | Défaut | Rôle |
|---|---|---|
| `TRAINING_APP_WORKSPACE` | `Training_App/data` | Dossier du workspace (base, runs, réglages). Défini par les lanceurs. |
| `TRAINING_APP_USER` | `unknown` | Nom d'utilisateur, utilisé pour le store MLflow et les tags. Défini par les lanceurs. |
| `BACKEND_PORT` | `8064` | Port du backend. |
| `TRAINING_APP_FRONTEND_PORT` | `5176` | Port de l'interface, ajouté aux origines autorisées du backend. |
| `VITE_BACKEND_PORT` / `VITE_FRONTEND_PORT` | `8064` / `5176` | Ports utilisés par le serveur Vite et par l'interface pour ses appels directs au backend. |
| `TRAINING_APP_TRAINER_BACKEND` | `yolox` | Moteur par défaut quand une requête n'en nomme aucun. |
| `LAUNCHED_BY_ORCHESTRATOR` | vide | `1` quand l'app est démarrée par l'Orchestrator : l'interface affiche le mode orchestrateur. |
| `IA_MLFLOW_TRACKING_URI` | vide | Store MLflow à utiliser au lieu du store de l'utilisateur (défini par l'Orchestrator). |
| `TRAINING_ORCH_BLOCKING` | `1` | `0` fait répondre `POST /api/orchestrator/train` dès le démarrage du run au lieu d'attendre sa fin. |
| `TRAINING_ORCH_MAX_WAIT_S` | `5400` | Attente maximale de cet appel, en secondes, avant de répondre "encore en cours". |
| `IA_INSTANCES_FILE`, `IA_APP_ID` | définies par le lanceur de la suite | Servent à lister les utilisateurs de la même app dans `GET /api/workspace/users`. |
| `VITE_CACHE_DIR` | vide | Dossier de cache Vite séparé, quand deux interfaces tournent depuis le même dossier. |

## Arborescence du workspace sur le disque

Le workspace d'un utilisateur (`<racine des workspaces>/training_<user>`, ou `Training_App/data/` sans lanceur) contient :

```text
training_<user>/
  training.db              base des runs (SQLite)
  settings.json            langue de l'interface (hors VisionNexus seulement)
  runs/
    <nom du run>/          un dossier par run
      train_log.txt        journal complet de l'entraînement
      results.csv          métriques et pertes par epoch
      latest_ckpt.pth      checkpoints (voir Concepts)
      best_ckpt.pth
      ...
      artifacts/           graphiques d'analyse
      inference_cases/     meilleurs / pires cas, une fois calculés
    <nom de l'archive>/    datasets .zip extraits pour l'Orchestrator
  exports/                 créé, non utilisé par la version actuelle
```

Le store MLflow n'est pas dans ce dossier mais à côté (voir la section *Emplacement du store MLflow*). Supprimer un run depuis l'**Historique** ne retire que son enregistrement en base ; son dossier reste jusqu'à ce que vous le supprimiez (voir [Workflows](workflows.fr.md), section *Supprimer un run et libérer de l'espace disque*, pour ce qu'il faut garder d'abord).

## Poids de modèle pour Training App

Training App ne télécharge jamais de poids. Un run YOLOX part de poids aléatoires, sauf si **Poids de depart (optionnel)** donne un fichier `.pth` lisible par le backend.

Pour partir de poids pré-entraînés sur COCO, téléchargez le checkpoint officiel de la taille choisie depuis les publications YOLOX sur GitHub (`Megvii-BaseDetection/YOLOX` : `yolox_nano.pth`, `yolox_tiny.pth`, `yolox_s.pth`, `yolox_m.pth`, `yolox_l.pth`, `yolox_x.pth`, Apache-2.0), copiez-le sur la machine du backend et saisissez son chemin absolu. La liste des poids utilisés par toute la suite est dans `MODEL_WEIGHTS.md` à la racine du dépôt.

Les poids produits par un run sont les checkpoints `.pth` de son dossier ; le fichier recommandé est `best_ckpt.pth` (voir [Concepts](concepts.fr.md)).

## Emplacement du store MLflow

Chaque run est journalisé dans MLflow sans aucun serveur MLflow : Training App écrit directement dans un store SQLite.

- Par défaut, le store est `<racine des workspaces>/mlflow_<user>/mlflow_data/mlflow.db`, à côté du workspace Training, avec les artefacts (graphiques et poids) dans `mlflow_data/artifacts/<experiment>/`. Les dossiers sont créés au premier run. MLflow App lancée pour le même utilisateur et la même racine lit ce même store.
- Quand `IA_MLFLOW_TRACKING_URI` est définie (l'Orchestrator le fait), ce store est utilisé à la place.
- L'experiment est `training` pour les runs lancés depuis l'interface ou l'API ; l'Orchestrator choisit l'experiment de ses runs.

Si le paquet `mlflow` est absent ou si le store ne peut pas être écrit, la journalisation est ignorée sans message et l'entraînement n'est pas affecté. Le contenu journalisé est décrit dans [Workflows](workflows.fr.md), section *Retrouver un run et son modèle dans MLflow App*.

## Installer un plugin de moteur d'entraînement

Les moteurs autres que YOLOX sont fournis par des plugins. Un plugin est un dossier placé dans `plugins/` à la racine de la suite, qui déclare ses moteurs dans le groupe `visionnexus.trainer_backends` ; un paquet Python installé qui déclare un entry point dans ce groupe fonctionne aussi. Aucun réglage n'est nécessaire : le plugin est découvert quand le backend lit la liste des moteurs.

- Un plugin dont la bibliothèque manque est listé comme indisponible, avec la raison, dans le panneau modèle et dans `GET /api/capabilities` ; YOLOX continue de fonctionner.
- Avec plus d'un moteur disponible, la ligne **Moteur** apparaît sur la page **Training**.
- Un plugin peut ajouter sa propre page à cette documentation, affichée uniquement là où il est installé.

Le contrat qu'un plugin doit respecter est décrit dans `docs/plugins/README.md` à la racine du dépôt et dans [Architecture](architecture.fr.md).

## Langue de l'interface de Training App

L'interface existe en anglais et en français. Quand l'app est ouverte depuis VisionNexus, la langue réglée dans VisionNexus est passée dans l'adresse (`?lang=en` ou `?lang=fr`) et appliquée au chargement ; le bouton **EN** / **FR** ne change alors que la fenêtre courante.

Hors VisionNexus, la langue vient du stockage du navigateur, puis de `ui_language` dans `settings.json` du workspace (`en` par défaut). Le bouton **EN** / **FR** y enregistre le choix via `PUT /api/settings`. Ce fichier ne contient aucun autre réglage.

## Vérifier l'installation de Training App

Après l'installation, vérifiez la chaîne du backend jusqu'à un vrai run :

1. Ouvrez `http://localhost:<port du backend>/health` : la réponse est `{"status": "ok", "app": "Training_App"}`.
2. Ouvrez `http://localhost:<port du backend>/api/capabilities` : `yolox` est listé avec `"available": true`, et chaque plugin avec sa disponibilité.
3. Dans l'environnement du backend, lancez `python -c "import torch; print(torch.cuda.is_available())"` : `True` signifie que le GPU sera utilisé.
4. Depuis `Training_App/`, lancez les tests : `python -m pytest backend/tests -m "not slow"` (tests unitaires) et `python -m pytest backend/tests` (avec de courts entraînements réels).
5. Lancez un run de 2 epochs sur un petit dataset avec **Intervalle eval (ép.)** à 1 : il doit atteindre **Terminé** avec un chemin **Meilleur modèle** et des graphiques dans **Analyse du modèle**.
