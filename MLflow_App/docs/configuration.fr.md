---
app: mlflow
doc_type: configuration
audience: both
lang: fr
title: Configuration
order: 40
tags: [installation, ports, variables d'environnement, workspace, lanceur, serverless]
sources: [MLflow_App/backend/config.py, MLflow_App/launcher.py, MLflow_App/start.sh, _lib/launcher_engine.py]
---

# Configuration

## Prerequis systeme pour MLflow App

MLflow App tourne sous Windows et sous Linux x86_64. Il faut un environnement Python pour le backend et Node.js pour le frontend. Aucun GPU n'est requis : il ne fait que lire un fichier SQLite et le servir.

| Composant | Minimum | Notes |
|---|---|---|
| Python | 3.10+ | Environnement conda `IA_env` par defaut ; necessite le package `mlflow` |
| Node.js / npm | 18+ / 8+ | Pour le frontend Vite |
| Disque | depend des artefacts d'entrainement | Le store grossit avec les plots et poids logues par les apps emettrices, pas avec MLflow App lui-meme |

MLflow App n'a aucune dependance a un GPU ou aux moteurs d'entrainement : il n'execute jamais lui-meme un entrainement ou une evaluation. Les apps qui ecrivent dans le store (Training App, et toute autre app avec son propre `mlflow_logging.py`) ont leurs propres exigences, separees.

## Lancer MLflow App depuis VisionNexus ou le lanceur de la suite

La facon normale de faire tourner MLflow App est via le lanceur de la suite, directement ou depuis l'application de bureau VisionNexus.

Depuis la racine de la suite :

```bash
python launcher.py --app mlflow --workspace <racine-workspaces> --user <user>
```

Directement depuis le dossier de l'app :

```bash
cd MLflow_App
python launcher.py --workspace <racine-workspaces> --user <user>
```

Les options de `MLflow_App/launcher.py` refletent celles des autres apps de la suite : `--user` et `--workspace` (requis), `--conda-env` (defaut `IA_env`), `--backend-port`/`--frontend-port` (automatique par defaut), `--backend-only`, `--no-reload` et `--access-log`. Le lanceur cree le workspace, enregistre l'instance dans le `.run/.instances.json` partage de la suite, demarre uvicorn et le serveur de developpement Vite, et arrete les deux sur `Ctrl+C`.

## Lancer le backend et le frontend manuellement

Pour le developpement, le backend et le frontend peuvent etre demarres a la main. Sans le lanceur, le workspace revient a `MLflow_App/data/`.

Terminal 1, backend (depuis `MLflow_App/`) :

```bash
BACKEND_PORT=8001 python -m uvicorn backend.main:app --host 127.0.0.1 --port 8001 --reload
```

Terminal 2, frontend :

```bash
cd MLflow_App/frontend
VITE_BACKEND_PORT=8001 npm run dev -- --port 3001
```

`bash start.sh` execute les deux pour vous : il demarre le backend, sonde `/health` jusqu'a 30 secondes avant de demarrer le frontend, et arrete les deux sur `Ctrl+C`. Faites toujours tourner un seul worker uvicorn : le store SQLite n'est pas sur pour des ecritures multi-processus, que ce soit depuis ce backend ou depuis une app emettrice qui tourne en meme temps.

## Ports et acces reseau

MLflow App utilise deux ports : le backend FastAPI et le frontend Vite.

| Service | Defaut autonome | Defaut full-stack (lanceur) | Variable d'environnement |
|---|---|---|---|
| Backend (FastAPI) | 8001 | 8062 | `BACKEND_PORT` |
| Frontend (Vite) | 3001 | 3001 | `MLFLOW_APP_FRONTEND_PORT` |

Comme pour les autres apps de la suite, le defaut autonome et le port de depart full-stack different pour le backend : un lancement manuel ouvre le port 8001, alors que le lanceur de la suite commence l'allocation a 8062, a cote de DVC App (8061) et avant Optuna App (8063). Le port de base du frontend est 3001 dans les deux modes. Quand plusieurs utilisateurs ou instances tournent sur la meme machine, le lanceur alloue les premiers ports libres a partir de ces bases et les enregistre dans `<racine suite>/.run/.instances.json`.

Le backend autorise les requetes cross-origin depuis les ports 3001 a 3003 et 5173 a 5174 sur `localhost` et `127.0.0.1`, plus le port du frontend courant. Le frontend redirige aussi `/orchestrator-api` vers le port backend de l'Orchestrator (`VITE_ORCHESTRATOR_BACKEND_PORT`, 8060 par defaut), utilise par la page Lineage pour lire le graphe de lineage canonique et la liste des apps en cours.

## Variables d'environnement de MLflow App

La plupart des variables sont fixees par le lanceur ; ne les definissez vous-meme que pour un lancement manuel.

| Variable | Defaut | Effet |
|---|---|---|
| `MLFLOW_APP_WORKSPACE` | `MLflow_App/data` | Dossier du workspace ; `mlflow_data/` y est cree |
| `MLFLOW_TRACKING_URI` | `sqlite:///<workspace>/mlflow_data/mlflow.db` | Le store que lit MLflow App. Un `http://...` explicite reactive le mode serveur legacy (voir [Architecture](architecture.fr.md)) |
| `MLFLOW_APP_USER` | `unknown` | Nom d'utilisateur courant |
| `BACKEND_PORT` | `8001` | Port du backend (utilise pour le CORS) |
| `MLFLOW_APP_FRONTEND_PORT` | `3001` | Port du frontend (ajoute aux origines CORS autorisees) |
| `VITE_BACKEND_PORT`, `VITE_FRONTEND_PORT` | `8062`, `3001` | Ports utilises par le serveur de developpement Vite et son proxy `/api` |
| `VITE_ORCHESTRATOR_BACKEND_PORT` | `8060` | Port backend de l'Orchestrator, utilise par le proxy `/orchestrator-api` de la page Lineage |
| `VITE_IA_USER`, `IA_USER` | aucun | Nom d'utilisateur affiche par le frontend et enregistre par le lanceur |
| `IA_APP_ID`, `IA_INSTANCES_FILE`, `IA_WORKSPACE_HISTORY_FILE` | fixees par le lanceur | Registre d'instances et historique de workspaces affiches dans le badge utilisateur |

Les variables doivent etre definies avant que uvicorn demarre ; les changer ensuite n'a aucun effet. `IA_MLFLOW_TRACKING_URI`, lue par les apps emettrices comme Training App, est une variable separee (fixee par l'Orchestrator quand il les lance) qui resout vers le meme store que `MLFLOW_TRACKING_URI` ici quand les deux pointent vers le workspace du meme utilisateur.

## Structure du workspace sur disque

Avec le lanceur, le workspace est `<racine-workspaces>/mlflow_<user>/` ; un lancement manuel sans `MLFLOW_APP_WORKSPACE` utilise `MLflow_App/data/`.

```text
mlflow_<user>/
  mlflow_data/
    mlflow.db             Base SQLite : chaque experience, run, parametre, metrique et tag
    artifacts/<experience>/<run>/
      plots/               Plots d'entrainement joints par le moteur (servis par GET /api/runs/{id}/artifact)
      model/                Poids enregistres, quand le run en a produit
  settings.json            Parametres de l'application (chemin workspace, nom utilisateur reecrits)
```

`mlflow.db` est la source de verite : le supprimer perd chaque experience, run et version de modele enregistree. Le dossier `artifacts/` contient les fichiers reels (plots, poids) ; supprimer le dossier d'artefacts d'un run laisse intacts ses parametres et metriques dans la base mais casse sa galerie de plots et le lien vers les poids de son modele enregistre.

Les apps emettrices (Training App et toute autre app avec son propre `mlflow_logging.py`) resolvent exactement le meme chemin de store depuis leur propre workspace : `<leur-workspace>.parent / mlflow_<user> / mlflow_data`, un dossier sibling a cote du workspace de chaque app sous la meme `<racine-workspaces>`. C'est pourquoi rien n'a besoin d'etre configure cote MLflow App pour "recevoir" un run d'une autre app : les deux cotes calculent le meme chemin depuis le meme nom d'utilisateur.

## Verifier l'installation

1. Demarrez le backend et ouvrez `http://localhost:<port-backend>/health` : il repond `{"status": "ok", "mlflow_running": true}` une fois le store accessible.
2. Ouvrez le frontend : le point de statut de la barre laterale doit passer au vert avec un numero de version MLflow en quelques secondes.
3. Si aucun run n'existe encore, loguez un run de test depuis Training App (ou tout script utilisant `mlflow_logging.py`) dans le workspace du meme utilisateur, puis rechargez la page Lineage et confirmez qu'il apparait.
4. Ouvrez la page de detail d'un run et confirmez que ses metriques et artefacts se chargent ; une galerie d'artefacts cassee avec des metriques fonctionnelles signifie generalement que le dossier `artifacts/` a ete deplace ou supprime separement de `mlflow.db`.
