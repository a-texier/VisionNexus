---
app: dvc
doc_type: configuration
audience: both
lang: fr
title: Configuration
order: 40
tags: [installation, ports, variables d'environnement, workspace, lanceur, repo]
sources: [DVC_App/backend/config.py, DVC_App/launcher.py, DVC_App/start.sh, _lib/launcher_engine.py, DVC_App/backend/core/dvc_runner.py]
---

# Configuration

## Prerequis systeme pour DVC App

DVC App tourne sous Windows et sous Linux x86_64. Il faut un environnement Python pour le backend (avec `git` et le package `dvc` disponibles) et Node.js pour le frontend. Aucun GPU n'est requis.

| Composant | Minimum | Notes |
|---|---|---|
| Python | 3.10+ | Environnement conda `IA_env` par defaut ; necessite le package `dvc` |
| Git | version recente | `git` doit etre sur le `PATH` du processus backend |
| Node.js / npm | 18+ / 8+ | Pour le frontend Vite |
| Disque | selon dataset et modele | Le cache DVC stocke une copie physique par fichier unique ; voir [Concepts](concepts.fr.md#cache-et-usage-disque) |

Un repository Git + DVC initialise (`git init && dvc init`) est recommande au chemin cible, mais le backend demarre quand meme sans ; ses routes rapportent alors un statut "repo non trouve", et `POST /api/orchestrator/commit` l'initialise lui-meme la premiere fois qu'il est appele.

## Lancer DVC App depuis VisionNexus ou le lanceur de la suite

La facon normale de faire tourner DVC App est via le lanceur de la suite, directement ou depuis l'application de bureau VisionNexus.

Depuis la racine de la suite :

```bash
python launcher.py --app dvc --workspace <racine-workspaces> --user <user>
```

Directement depuis le dossier de l'app :

```bash
cd DVC_App
python launcher.py --workspace <racine-workspaces> --user <user>
```

Les options de `DVC_App/launcher.py` refletent celles des autres apps de la suite : `--user` et `--workspace` (requis), `--conda-env` (defaut `IA_env`), `--backend-port`/`--frontend-port` (automatique par defaut), `--backend-only`, `--no-reload` et `--access-log`. Le lanceur cree le workspace et le dossier du repository, enregistre l'instance dans le `.run/.instances.json` partage de la suite, demarre uvicorn et le serveur de developpement Vite, et arrete les deux sur `Ctrl+C`.

## Lancer le backend et le frontend manuellement

Pour le developpement, le backend et le frontend peuvent etre demarres a la main. Sans le lanceur, le workspace revient a `DVC_App/data/` et le repository a `<workspace>/repo`.

Terminal 1, backend (depuis `DVC_App/`) :

```bash
DVC_REPO_PATH=/chemin/vers/repo BACKEND_PORT=8002 python -m uvicorn backend.main:app --port 8002 --reload
```

Terminal 2, frontend :

```bash
cd DVC_App/frontend
VITE_BACKEND_PORT=8002 npm run dev -- --port 3002
```

`bash start.sh` execute les deux pour vous : il demarre le backend, sonde `/health` jusqu'a 30 secondes avant de demarrer le frontend, et arrete les deux sur `Ctrl+C`. Faites toujours tourner un seul worker uvicorn, et n'appelez jamais l'executable `dvc` nu manuellement depuis un autre shell pendant que le backend est en cours d'operation sur le meme repository, pour eviter des ecrivains concurrents sur le meme cache DVC.

## Ports et acces reseau

DVC App utilise deux ports : le backend FastAPI et le frontend Vite.

| Service | Defaut autonome | Defaut full-stack (lanceur) | Variable d'environnement |
|---|---|---|---|
| Backend (FastAPI) | 8002 | 8061 | `BACKEND_PORT` |
| Frontend (Vite) | 3002 | 3002 | `DVC_APP_FRONTEND_PORT` |

Comme pour les autres apps de la suite, le defaut autonome et le port de depart full-stack different pour le backend : un lancement manuel ouvre le port 8002, alors que le lanceur de la suite commence l'allocation a 8061, la base la plus basse parmi DVC App (8061), MLflow App (8062) et Optuna App (8063). Le port de base du frontend est 3002 dans les deux modes. Quand plusieurs utilisateurs ou instances tournent sur la meme machine, le lanceur alloue les premiers ports libres a partir de ces bases et les enregistre dans `<racine suite>/.run/.instances.json`.

Le backend autorise les requetes cross-origin depuis les ports 3001 a 3003 et 5173 a 5174 sur `localhost` et `127.0.0.1`, plus le port du frontend courant. Le frontend redirige aussi `/orchestrator-api` vers le port backend de l'Orchestrator (`VITE_ORCHESTRATOR_BACKEND_PORT`, 8060 par defaut), utilise par la page Lineage pour lire le graphe de lineage canonique et la liste des apps en cours.

## Variables d'environnement de DVC App

La plupart des variables sont fixees par le lanceur ; ne les definissez vous-meme que pour un lancement manuel.

| Variable | Defaut | Effet |
|---|---|---|
| `DVC_REPO_PATH` | `<DVC_APP_WORKSPACE>/repo` | Chemin du repository Git + DVC sur lequel cette app opere |
| `DVC_APP_WORKSPACE` | `DVC_App/data` | Dossier du workspace ; le chemin du repository par defaut en est derive |
| `DVC_APP_USER` | `unknown` | Nom d'utilisateur courant |
| `BACKEND_PORT` | `8002` | Port du backend (utilise pour le CORS) |
| `DVC_APP_FRONTEND_PORT` | `3002` | Port du frontend (ajoute aux origines CORS autorisees) |
| `VITE_BACKEND_PORT`, `VITE_FRONTEND_PORT` | `8061`, `3002` | Ports utilises par le serveur de developpement Vite et son proxy `/api` |
| `VITE_ORCHESTRATOR_BACKEND_PORT` | `8060` | Port backend de l'Orchestrator, utilise par le proxy `/orchestrator-api` de la page Lineage |
| `VITE_IA_USER`, `IA_USER` | aucun | Nom d'utilisateur affiche par le frontend et enregistre par le lanceur |
| `IA_APP_ID`, `IA_INSTANCES_FILE`, `IA_WORKSPACE_HISTORY_FILE` | fixees par le lanceur | Registre d'instances et historique de workspaces affiches dans le badge utilisateur |

Les variables doivent etre definies avant que uvicorn demarre ; les changer ensuite n'a aucun effet.

## Structure du repository sur disque

Avec le lanceur, le repository est toujours `<racine-workspaces>/dvc_<user>/repo/` ; ce chemin devient `DVC_REPO_PATH` via l'environnement passe au subprocess backend, donc deux utilisateurs ne partagent jamais le meme repository DVC. Un lancement manuel sans `DVC_REPO_PATH` revient a `<DVC_APP_WORKSPACE>/repo`.

```text
dvc_<user>/repo/
  .git/                    Historique Git : chaque commit, y compris les trailers de lineage
  .dvc/                    Configuration propre a DVC et pointeurs de cache ; cache.type fixe a reflink,hardlink,copy
  datasets/<nom>/           Datasets versionnes, un sous-dossier par nom, chacun avec un pointeur datasets/<nom>.dvc correspondant
  models/<nom>              Poids de modele versionnes (par exemple best.pt), avec un pointeur .dvc correspondant
  annotations/<nom>/        Exports d'annotations natives (.ver) versionnes
  metrics/<nom>             Fichiers de metriques versionnes (l'insights.json d'un run)
  graphs/<graph_id>.json    Instantanes complets de pipeline Orchestrator, versionnes en texte clair (pas via DVC)
  params/optuna_best.json   Meilleurs hyperparametres Optuna, versionnes en texte clair (pas via DVC)
```

`graphs/` et `params/` sont commites directement via Git, pas via `dvc add` : ce sont de petits fichiers JSON lisibles destines a etre diffables dans l'historique Git ordinaire, contrairement aux gros datasets binaires et poids de modele sous `dvc add`. Supprimer `.git/` perd tout l'historique de commits et de lineage ; supprimer `.dvc/cache` perd le contenu reel derriere chaque pointeur `.dvc` (les pointeurs eux-memes, toujours dans l'historique Git, ne pointent alors plus vers rien jusqu'a ce que le contenu soit recupere depuis un remote).

## Verifier l'installation

1. Demarrez le backend et ouvrez `http://localhost:<port-backend>/health` : il repond `{"status": "ok", "repo_exists": bool, "repo_path": "..."}`.
2. Ouvrez le frontend : le statut du repository dans la barre laterale doit montrer un chemin ; une croix rouge avec "Repo introuvable" est attendue et n'est pas une erreur avant le premier commit.
3. Depuis un pipeline Orchestrator avec un noeud DVC, commitez un petit artefact et confirmez que le statut du repository passe au vert et qu'un commit apparait sur **Historique**.
4. Ouvrez **Sync** et confirmez que le bouton **Calculer l'usage disque** du panneau **Stockage** retourne des chiffres au lieu de "repo introuvable".
