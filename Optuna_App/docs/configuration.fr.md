---
app: optuna
doc_type: configuration
audience: both
lang: fr
title: Configuration
order: 40
tags: [installation, ports, variables d'environnement, workspace, lanceur]
sources: [Optuna_App/backend/config.py, Optuna_App/launcher.py, Optuna_App/start.sh, _lib/launcher_engine.py, Optuna_App/pyproject.toml]
---

# Configuration

## Prerequis systeme pour Optuna App

Optuna App tourne sous Windows et sous Linux x86_64 (cible habituelle pour une VM GPU distante). Il faut un environnement Python pour le backend et Node.js pour le frontend.

| Composant | Minimum | Notes |
|---|---|---|
| Python | 3.10+ | Environnement conda `IA_env` par defaut |
| Node.js / npm | 18+ / 8+ | Pour le frontend Vite |
| GPU NVIDIA | recommande | Necessaire seulement pour le prereglage d'entrainement de detection ; une etude sur un script CPU fonctionne sans |
| Disque | quelques Go | `optuna.db`, logs, et les dossiers par trial sous `hpo_runs/` (checkpoints inclus) |

Dependances Python : `fastapi`, `uvicorn`, `optuna`. Les installer avec `pip install fastapi uvicorn optuna` suffit pour une etude autonome sur votre propre script. Le prereglage d'entrainement de detection necessite en plus la presence de Training App a cote d'Optuna App, avec ses propres dependances d'entrainement installees.

## Lancer Optuna App depuis VisionNexus ou le lanceur de la suite

La facon normale de faire tourner Optuna App est via le lanceur de la suite, directement ou depuis l'application de bureau VisionNexus.

Depuis la racine de la suite :

```bash
python launcher.py --app optuna --workspace <racine-workspaces> --user <user>
```

Directement depuis le dossier de l'app :

```bash
cd Optuna_App
python launcher.py --workspace <racine-workspaces> --user <user>
```

Options de `Optuna_App/launcher.py` :

| Option | Defaut | Effet |
|---|---|---|
| `--user` | requis | Nom d'utilisateur ; le workspace est `<racine-workspaces>/optuna_<user>` |
| `--workspace` | requis | Dossier racine de tous les workspaces |
| `--conda-env` | `IA_env` | Environnement conda utilise pour trouver Python |
| `--backend-port` / `--frontend-port` | automatique | Force les ports au lieu d'en allouer des libres |
| `--backend-only` | off | Demarre seulement l'API |
| `--no-reload` | off | Demarre uvicorn sans auto-reload |
| `--access-log` | off | Imprime chaque requete HTTP |

Le lanceur cree le workspace, enregistre l'instance dans le `.run/.instances.json` partage de la suite, demarre uvicorn et le serveur de developpement Vite, et arrete les deux sur `Ctrl+C`.

## Lancer le backend et le frontend manuellement

Pour le developpement, ou pour une etude sur votre propre script sans le reste de la suite, le backend et le frontend peuvent etre demarres a la main. Sans le lanceur, le workspace revient a `Optuna_App/data/`.

Terminal 1, backend (depuis `Optuna_App/`) :

```bash
pip install fastapi uvicorn optuna
uvicorn backend.main:app --host 127.0.0.1 --port 8003 --reload
```

Terminal 2, frontend :

```bash
cd Optuna_App/frontend
npm install
npm run dev
```

`bash start.sh` execute les deux terminaux pour vous sous Linux, avec les memes ports par defaut. Faites toujours tourner un seul worker uvicorn : le stockage SQLite d'Optuna n'est pas sur pour des ecritures multi-processus. Pour pointer un backend manuel vers un workspace existant plutot que `Optuna_App/data/`, exportez `OPTUNA_APP_WORKSPACE` avant de demarrer uvicorn ; pour changer le port cible du frontend, exportez `VITE_BACKEND_PORT` avant `npm run dev`.

## Ports et acces reseau

Optuna App utilise deux ports : le backend FastAPI et le frontend Vite.

| Service | Defaut autonome | Defaut full-stack (lanceur) | Variable d'environnement |
|---|---|---|---|
| Backend (FastAPI) | 8003 | 8063 | `BACKEND_PORT` |
| Frontend (Vite) | 3003 | 3003 | `OPTUNA_APP_FRONTEND_PORT` |

Le defaut autonome (`backend/config.py`, `start.sh`) et le port de depart full-stack (`launcher.py`, `_lib/launcher_engine.py`) ne sont pas les memes pour le backend : un lancement manuel sans le lanceur ouvre le port 8003, alors que le lanceur de la suite commence l'allocation a 8063 pour qu'Optuna App n'entre pas en collision avec DVC App (8061) et MLflow App (8062). Le port de base du frontend est 3003 dans les deux modes. Quand plusieurs utilisateurs ou instances tournent sur la meme machine, le lanceur alloue les premiers ports libres a partir de ces bases et les enregistre dans `<racine suite>/.run/.instances.json`.

Le backend autorise les requetes cross-origin depuis les ports 3001 a 3003 et 5173 a 5174 sur `localhost` et `127.0.0.1`, plus le port du frontend courant. Le frontend redirige `/api` vers le port du backend (`vite.config.ts`) ; les logs des etudes (`GET /api/studies/{name}/logs`) se connectent directement au port du backend a la place, pour eviter la bufferisation du proxy Vite sur les evenements envoyes par le serveur.

## Variables d'environnement d'Optuna App

La plupart des variables sont fixees par le lanceur ; ne les definissez vous-meme que pour un lancement manuel.

| Variable | Defaut | Effet |
|---|---|---|
| `OPTUNA_APP_WORKSPACE` | `Optuna_App/data` | Dossier du workspace : base des etudes, logs, parametres |
| `OPTUNA_APP_USER` | `unknown` | Nom d'utilisateur courant |
| `BACKEND_PORT` | `8003` | Port du backend (utilise pour le CORS et les messages de stockage des etudes) |
| `OPTUNA_APP_FRONTEND_PORT` | `3003` | Port du frontend (ajoute aux origines CORS autorisees) |
| `VITE_BACKEND_PORT`, `VITE_FRONTEND_PORT` | `8063`, `3003` | Ports utilises par le serveur de developpement Vite et son proxy `/api` |
| `VITE_IA_USER`, `IA_USER` | aucun | Nom d'utilisateur affiche par le frontend et enregistre par le lanceur |
| `VITE_CACHE_DIR` | defaut Vite | Cache Vite separe par instance |
| `IA_APP_ID`, `IA_INSTANCES_FILE`, `IA_WORKSPACE_HISTORY_FILE` | fixees par le lanceur | Registre d'instances et historique de workspaces affiches dans le badge utilisateur |

Les variables doivent etre definies avant que uvicorn demarre ; les changer ensuite n'a aucun effet.

## Structure du workspace sur disque

Le workspace est le dossier qui contient toutes les donnees d'un utilisateur. Avec le lanceur, c'est `<racine-workspaces>/optuna_<user>/` ; un lancement manuel sans `OPTUNA_APP_WORKSPACE` utilise `Optuna_App/data/`.

```text
optuna_<user>/
  optuna.db              Base SQLite (stockage natif d'Optuna) : chaque etude et trial
  settings.json           Parametres de l'application (chemin workspace, nom utilisateur reecrits)
  logs/                   Cree par le lanceur ; reserve aux fichiers de log du backend
  hpo_runs/<etude>/
    trial_<n>/             Trial Orchestrator : result.json, stdout.log, stderr.log, results.csv, checkpoints
    trial_<date>_<pid>/    Trial autonome lance avec le prereglage de detection (pas de --trial_dir donne)
  hpo_datasets/<nom>/     Dataset YOLO extrait une fois d'un export Zip Annotation, reutilise par les trials suivants
```

`optuna.db` est la seule source de verite pour les etudes et les trials : le supprimer perd toutes les etudes. Supprimer un dossier `hpo_runs/` perd seulement les artefacts sur disque (checkpoints, CSV par epoch) des trials concernes ; le trial existe toujours dans la base avec sa valeur objectif enregistree. Pour sauvegarder un workspace, copiez `optuna.db` avec `hpo_runs/` si vous voulez aussi garder les checkpoints des trials passes ; `hpo_datasets/` peut toujours etre reconstruit depuis l'export d'origine et n'a pas besoin de sauvegarde.

## Valeurs par defaut des trials et du prereglage

Ces valeurs ne sont pas des reglages de l'app ; ce sont des defauts appliques la ou l'etude est demarree.

| Defaut | Valeur | Ou |
|---|---|---|
| Epochs par trial (prereglage et Orchestrator) | 10 | `EnginePreset.tsx`, `HpoRequest.epochs` |
| Timeout de trial (Orchestrator) | 1200 s (20 min) | `HpoRequest.trial_timeout_s` |
| Timeout de trial (script autonome) | 3600 s (1 h) | `optuna_runner.py` |
| Workers DataLoader | 0 sous Windows, 2 ailleurs | `HpoRequest.workers`, evite les gels multiprocessus du DataLoader sous Windows |
| Sampler | TPE (`TPESampler`), 10 trials de demarrage | fixe, non configurable depuis l'interface |
| Pruner | desactive (`NopPruner`) | fixe ; les moteurs ne rapportent pas encore de metriques par epoch |
| Politique d'echec (Orchestrator) | arreter le pipeline | `HpoRequest.stop_on_failure`, peut etre desactivee sur le noeud Optuna |

## Verifier l'installation

1. Demarrez le backend et ouvrez `http://localhost:<port-backend>/health` : il repond `{"status": "ok", "study_count": N}`.
2. Ouvrez le frontend et verifiez que la page des etudes se charge sans toast d'erreur.
3. Creez une etude de test, lancez-la sur un script trivial (voir [Workflows](workflows.fr.md)) et confirmez qu'un trial apparait avec un etat `COMPLETE`.
4. Pour le prereglage de detection, ouvrez `http://localhost:<port-backend>/api/orchestrator/engines` : une liste `engines` non vide confirme que Training App est accessible ; un champ `error` explique pourquoi non.
5. Pour une etude Orchestrator, lancez un petit pipeline avec un noeud Optuna en mode automatique avec un **Nombre de trials** bas et verifiez que le noeud termine avec un `best_params` non vide avant de s'y fier pour un vrai entrainement.
