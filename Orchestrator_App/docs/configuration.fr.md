---
app: orchestrator
doc_type: configuration
audience: both
lang: fr
title: Configuration
order: 40
tags: [lanceur, ports, variables d'environnement, workspace, conda, cors]
sources: [Orchestrator_App/launcher.py, Orchestrator_App/backend/config.py, Orchestrator_App/backend/core/app_launcher.py, Orchestrator_App/start.sh, Orchestrator_App/frontend/vite.config.ts, _lib/launcher_engine.py]
---

# Configuration

## Lancer Orchestrator App

La facon normale de demarrer l'application est `launcher.py`, qui alloue les ports, construit la structure du workspace et demarre le backend et le frontend :

```bash
cd Orchestrator_App
python launcher.py --user alice --workspace C:/ws
```

`--user` et `--workspace` sont obligatoires. Le workspace backend final est `<workspace>/orchestrator_<user>/`. Autres options : `--conda-env` (defaut `IA_env`), `--backend-port` et `--frontend-port` (ports fixes au lieu d'une allocation automatique), `--backend-only` (sans le frontend), `--reload` (active le rechargement automatique d'uvicorn, developpement seulement) et `--access-log` (active les logs d'acces par requete d'uvicorn). VisionNexus lance l'application de la meme facon, via `_lib/launcher_engine.py`, qui partage le meme registre de ports et le meme fichier de verrou.

Sur Linux, `start.sh` est une alternative minimale qui lit `BACKEND_PORT` et `ORCHESTRATOR_FRONTEND_PORT` depuis l'environnement (par defaut 8000 et 3000) et demarre uvicorn avec `--reload` ; il n'alloue pas de ports et ne construit pas le workspace, utilisez donc `launcher.py` sauf si vous avez deja un environnement fonctionnel.

Ne demarrez jamais `uvicorn backend.main:app` directement sans `ORCHESTRATOR_WORKSPACE` et `ORCHESTRATOR_USER` definis : le backend ecrirait dans le workspace `data/` par defaut et, pire, refuse carrement de demarrer s'il ne peut pas resoudre un vrai nom d'utilisateur non-placeholder (voir "Resolution de l'utilisateur courant" ci-dessous).

## Ports

Port backend par defaut : **8060**. Port frontend par defaut : **3000**. Les deux sont alloues dynamiquement a partir de ces bases si elles sont prises, en utilisant un fichier de verrou partage avec toutes les autres applications de la suite (`Computer_Vision_App/.run/.port_lock` et `.instances.json`), pour que deux utilisateurs ou deux applications lancees en meme temps n'entrent jamais en collision.

Table de reference pour toute la suite, telle que vue depuis `APP_URLS` de `config.py` :

| Service | Port par défaut |
|---|---|
| Backend Orchestrator | 8060 |
| Frontend Orchestrator | 3000 |
| Annotation_App | 8000 |
| Dataset_Explorer_App | 8001 |
| dvc-app | 8061 |
| mlflow-app | 8062 |
| optuna-app | 8063 |
| Training_App | 8064 |
| Inference_App | 8065 |

`APP_URLS` et `APP_FRONTEND_URLS` sont des dictionnaires mutables : `app_launcher.py` les met a jour en place avec le vrai port de chaque sous-application une fois qu'il la lance, ou une fois qu'il detecte que cette instance tourne deja. Les appels backend-a-backend utilisent toujours `127.0.0.1`, jamais `localhost`, car sur Windows `localhost` peut se resoudre en `::1` (IPv6) alors qu'uvicorn n'ecoute qu'en IPv4, ce qui provoque sinon de faux badges "offline".

## Variables d'environnement

Definies par `launcher.py` (ou par VisionNexus via `_lib/launcher_engine.py`) ; lues par `backend/config.py` :

| Variable | Signification |
|---|---|
| `ORCHESTRATOR_WORKSPACE` | Racine du workspace backend, `<workspace>/orchestrator_<user>/`. Par defaut `Orchestrator_App/data/` si absente. |
| `ORCHESTRATOR_USER` | Identifiant de l'utilisateur courant. Obligatoire pour un usage reel ; voir ci-dessous. |
| `BACKEND_PORT` | Port d'ecoute du backend (defaut 8060). |
| `ORCHESTRATOR_FRONTEND_PORT` | Port du serveur de dev frontend (defaut 3000). |
| `VITE_BACKEND_PORT` | Lue par `vite.config.ts` pour construire la cible du proxy `/api`. |

Chaque sous-application, une fois lancee par Orchestrator, recoit ses propres variables d'environnement (`ANNOTATION_APP_URL`, `DATASET_EXPLORER_APP_URL`, `TRAINING_APP_URL`, `INFERENCE_APP_URL`, `DVC_APP_URL`, `MLFLOW_APP_URL`, `OPTUNA_APP_URL`, plus les variables `*_FRONTEND_URL` correspondantes) pour qu'Orchestrator puisse l'atteindre ; celles-ci peuvent aussi etre definies a la main pour pointer vers une instance deja en cours plutot que de laisser Orchestrator en lancer une.

### Résolution de l'utilisateur courant

`ORCHESTRATOR_USER` ne peut jamais retomber sur un placeholder partage tel que `unknown`, `user` ou une chaine vide : toute l'isolation multi-utilisateur (chemins de workspace, cle du registre de ports partage) repose sur cette seule valeur, et deux utilisateurs partageant silencieusement `annotation_unknown` signifierait partager la meme base SQLite et les memes caches sans aucun avertissement. Si `ORCHESTRATOR_USER` est absente ou est l'un de ces placeholders, le backend essaie ensuite le login du systeme d'exploitation ; si cela echoue aussi, le demarrage est refuse avec une erreur explicite demandant de passer un vrai nom d'utilisateur.

## Arborescence du workspace sur disque

```
{WORKSPACE}/
  orchestrator_{user}/
    graphs/experiments.json      chaque sandgraph sauvegarde (nœuds, aretes, etat d'execution)
    pipelines/                   fichiers JSON PipelineDef generes, un par run
    insights/{graph_id}/{run_id}/  insights.json, insights.md, metrics.json, plots
    runs/{run_id}/manifest.json  index canonique des sorties d'un run
    plans/plans.json             Plans d'experiences
    activity.json                journal de runs en ajout seul (200 entrees max)
    experiments.json             enregistrements d'experiences historiques
    launcher_state.json          etat des sessions de sous-applications (pid, ports, workspace)
    settings.json                preferences utilisateur (theme, ui_language)
    debug.html                   journal de debug developpeur colorise, ecrase a chaque demarrage
  explorer_{user}/                 workspace Dataset_Explorer_App
    subsets/{name}/               chaque subset cree par Dataset Explorer
  annotation_{user}/           workspace Annotation_App
    imports/                     images preparees pour un nouveau projet d'annotation
    exports/                     sorties `{name}-yolo/`, `{name}.zip` ou `{name}.ver`
  dvc_{user}/                   workspace dvc-app (depot Git + DVC)
  mlflow_{user}/                workspace mlflow-app (store MLflow SQLite)
  optuna_{user}/                workspace optuna-app
  training_{user}/              workspace Training_App (runs, poids exportes)
  inference_{user}/             workspace Inference_App
```

`explorer_{user}/subsets/` et `annotation_{user}/exports/` sont les deux seuls emplacements qu'Orchestrator scanne pour construire les listes de subsets et d'exports existants du mode FREE ; il ne demande jamais cela a une sous-application par HTTP. Tout est du JSON lisible : pour inspecter l'etat brut d'un graphe, lisez `graphs/experiments.json` ; pour l'historique des runs, `activity.json`.

## Environnement conda et Node.js

Chaque sous-application lancee par Orchestrator tourne avec le meme environnement conda (defaut `IA_env`, modifiable avec `--conda-env` sur `launcher.py` ou par lancement sur la page **Applications**). `app_launcher.py` cherche `python.exe` sous `<racine conda>/envs/<env>/` a cote de l'interpreteur Python actuellement en cours d'execution ; sur Linux il retombe sur `envs/<env>/bin/python`.

Pour les serveurs de dev frontend, Orchestrator prefere un binaire Node.js embarque avec la suite (`<Computer_Vision_App>/node-v20.20.2-linux-x64/bin` sur Linux) au `npm` systeme, pour qu'un deploiement hors-ligne ne depende pas de Node installe separement ; sur Windows il utilise toujours le `npm.cmd` du systeme.

## CORS et accès réseau

Le backend accepte les requetes depuis `http://localhost:<FRONTEND_PORT>` et `http://127.0.0.1:<FRONTEND_PORT>` (le port frontend configure), plus les defauts fixes `3000`, `5173`, `5174` et `5175`/`5176` sur `localhost` et `127.0.0.1`, pour couvrir les serveurs de dev frontend de toute la suite pendant le developpement local. Cette liste n'est pas prevue pour etre editee pour un deploiement normal ; si vous servez le frontend depuis une origine differente, ajustez `_cors_origins` dans `backend/config.py`.

Le serveur de dev Vite proxifie chaque requete `/api/*` vers la cible backend (`http://localhost:<BACKEND_PORT>`) avec un delai de 300 secondes, si bien que le frontend appelle toujours des URLs relatives. La seule exception est le flux SSE d'execution : il utilise un `BACKEND_BASE` fixe et vide (`''`, ce qui signifie meme origine, toujours via le proxy) plutot qu'une URL absolue, car une URL absolue cross-origin cassait completement le SSE quand l'application etait ouverte depuis une IP du reseau local au lieu de `localhost`.
