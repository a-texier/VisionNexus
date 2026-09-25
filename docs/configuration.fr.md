---
app: suite
doc_type: configuration
audience: both
lang: fr
title: Configuration
order: 40
tags: [prérequis, réglages, variables d'environnement, ports, workspace, ssh, vm, poids, build]
sources: [launcher.py, _lib/launcher_engine.py, rebuild_all.py, desktop/package.json, desktop/src/settings.ts, desktop/src/catalog.ts, desktop/src/main.ts, MODEL_WEIGHTS.md]
---

# Configuration

## Prérequis

Les prérequis diffèrent entre la machine qui affiche VisionNexus et celle qui exécute les applications. C'est la même machine en mode local.

| Où | Ce qu'il faut |
|---|---|
| Machine qui affiche VisionNexus (Windows) | `VisionNexusElectron.exe`, un programme portable avec son propre runtime : aucun Node.js n'est nécessaire pour l'exécuter. Pour le mode VM, le client OpenSSH (`ssh` dans le PATH). |
| Machine qui exécute les applications | Le dépôt `Computer_Vision_App/` complet, Python 3.11 ou plus récent, un environnement conda contenant les dépendances des applications, et Node.js 20 ou plus récent. |
| Frontends | Dépendances installées et construites dans chaque application : exécutez `python rebuild_all.py` à la racine du dépôt (`--skip-install` conserve les `node_modules` existants). |
| Poids de modèles | Placés dans les dossiers des applications, voir [Poids de modèles](#poids-de-modèles). |

Le lanceur `launcher.py` n'utilise que la bibliothèque standard de Python : le `python` trouvé dans le PATH par le shell qui le démarre peut donc être n'importe quel Python 3.11 ou plus récent. Les applications s'exécutent avec l'interpréteur de l'environnement indiqué dans **Chemin conda**. Sous Linux, si un dossier nommé `node-v20.20.2-linux-x64` ou `node` se trouve à la racine du dépôt, son répertoire `bin/` est placé en tête du PATH pour que `npm` et `node` fonctionnent sans installation système.

Une machine avec un GPU compatible CUDA est attendue pour les applications gourmandes en modèles (Annotation, Training, Inference, embeddings de Dataset Explorer). VisionNexus ne le vérifie pas : les applications signalent leurs propres erreurs.

## Fichier de réglages et dossiers de logs

VisionNexus enregistre ses réglages dans un fichier JSON du dossier de données utilisateur du programme : `%APPDATA%\VisionNexusElectron\settings.json` sous Windows et `~/.config/VisionNexusElectron/settings.json` sous Linux. Le fichier appartient à l'utilisateur Windows et n'est pas partagé avec le workspace.

| Clé | Sens | Défaut |
|---|---|---|
| `username` | Champ **Utilisateur** | vide |
| `workspace` | Champ **Workspace** | vide |
| `cvRoot` | Champ **Racine Computer_Vision_App** | vide |
| `condaPath` | Champ **Chemin conda** | vide |
| `vms` | Liste des VM connues | `[]` |
| `selectedVm` | VM cible sélectionnée, vide pour le local | vide |
| `nativeMountHost` | Hôte de **Partage reseau natif (optionnel)** | vide |
| `uiLanguage` | `en` ou `fr` | `en` |
| `tutorials` | Progression des visites guidées, par app | `{}` |

Chaque lancement écrit un journal complet, `logs/<id>_<horodatage>.log`, dans le même dossier de données utilisateur (l'id est l'identifiant de l'app, `docs` pour le Docs Assistant, ou `orch_<app>` pour un onglet ouvert depuis l'Orchestrator). Il contient la sortie brute du lanceur, sans codes de couleur de terminal, et reste après la fermeture de la fenêtre. Les journaux de plus de 14 jours sont supprimés au démarrage, et seuls les 200 plus récents sont conservés. Le bouton **Logs** ouvre ce dossier. Le panneau **Lancements** n'affiche que les 800 dernières lignes de chaque élément.

## Lancer une app en ligne de commande

Chaque application peut être lancée sans VisionNexus, depuis la racine du dépôt :

```bash
python launcher.py --app annotation --workspace D:/ws --user alice
python launcher.py --app annotation explorer --workspace /data/ws --user alice
python launcher.py --app docs --workspace /data/ws --user alice --backend-only
```

`--app`, `--workspace` et `--user` sont obligatoires. Le lanceur crée `<workspace>/<app>_<utilisateur>`, choisit des ports libres, démarre le backend (et le frontend sauf avec `--backend-only`), affiche les ports choisis, et reste actif jusqu'à Ctrl+C. Il arrête toutes les applications qu'il a démarrées dès que l'un de leurs processus meurt. Si vous donnez `--backend-port` ou `--frontend-port` (pour une seule app), la valeur est un port imposé : le lancement échoue quand il est occupé au lieu de passer au port libre suivant.

Utilisez `--conda-path` pour l'environnement : il accepte le dossier de l'environnement, son script `bin/activate` ou son exécutable Python. Sans lui, le lanceur cherche un environnement nommé `IA_env` (ou le nom donné avec `--conda-env`) dans les dossiers conda habituels, puis se replie sur le Python qui exécute le lanceur, avec un avertissement. Chaque argument est décrit dans la [référence API](api-reference.fr.md#ligne-de-commande-du-lanceur).

## Variables d'environnement posées par le lanceur

Le lanceur transmet à chaque backend sa configuration par des variables d'environnement. Une application les lit au démarrage ; vous ne les définissez jamais à la main quand vous utilisez VisionNexus.

| Variable | Posée pour | Sens |
|---|---|---|
| `BACKEND_PORT` | toute app | Port sur lequel le backend doit écouter |
| `VITE_BACKEND_PORT` | toute app | Port du backend, lu par le proxy du serveur de dev du frontend |
| `VITE_FRONTEND_PORT` | apps avec frontend | Port du serveur de dev du frontend |
| `IA_USER`, `VITE_IA_USER` | toute app | Nom d'utilisateur (backend et frontend) |
| `IA_APP_ID` | toute app | Clé du lanceur, utilisée pour filtrer les utilisateurs connectés |
| `IA_INSTANCES_FILE` | toute app | Chemin de `.run/.instances.json` |
| `IA_WORKSPACE_HISTORY_FILE` | toute app | Chemin du `data/.history.json` de l'app |
| `NATIVE_SHARE_HOST` | toute app, si un hôte est défini | Hôte donné par `--native-share-host` |
| `VISIONNEXUS_PLUGINS_DIR` | lue par le registre de plugins | Utilise un autre dossier que `plugins/` |
| `CV_SESSION_TOKEN`, `CV_BOOTSTRAP_CODE` | chaque app, sauf si `CV_AUTH=0` | Jeton de session de l'instance et premier code navigateur à usage unique, voir [Sécurité](security.fr.md) |

Chaque app reçoit aussi trois variables propres, nommées d'après sa clé : le workspace, l'utilisateur et, pour les apps avec un frontend, le port du frontend.

| App | Workspace | Utilisateur | Port du frontend |
|---|---|---|---|
| `annotation` | `ANNOTATION_WORKSPACE` | `ANNOTATION_USER` | `ANNOTATION_FRONTEND_PORT` |
| `explorer` | `EXPLORER_WORKSPACE` | `EXPLORER_USER` | `EXPLORER_FRONTEND_PORT` |
| `orchestrator` | `ORCHESTRATOR_WORKSPACE` | `ORCHESTRATOR_USER` | `ORCHESTRATOR_FRONTEND_PORT` |
| `dvc` | `DVC_APP_WORKSPACE` | `DVC_APP_USER` | `DVC_APP_FRONTEND_PORT` |
| `mlflow` | `MLFLOW_APP_WORKSPACE` | `MLFLOW_APP_USER` | `MLFLOW_APP_FRONTEND_PORT` |
| `optuna` | `OPTUNA_APP_WORKSPACE` | `OPTUNA_APP_USER` | `OPTUNA_APP_FRONTEND_PORT` |
| `training` | `TRAINING_APP_WORKSPACE` | `TRAINING_APP_USER` | `TRAINING_APP_FRONTEND_PORT` |
| `inference` | `INFERENCE_APP_WORKSPACE` | `INFERENCE_APP_USER` | `INFERENCE_APP_FRONTEND_PORT` |
| `docs` | `DOCS_ASSISTANT_WORKSPACE` | `DOCS_ASSISTANT_USER` | aucun (pas de frontend) |

## Ports de base de chaque application

Voici les ports de base du catalogue. Le lanceur part de ces valeurs et prend le premier port libre : les ports réels peuvent donc être plus élevés ; VisionNexus lit toujours les ports réels dans la sortie du lanceur.

| Clé du lanceur | App | Backend | Frontend |
|---|---|---|---|
| `orchestrator` | Orchestrator | 8060 | 3000 |
| `annotation` | Annotation | 8000 | 5173 |
| `explorer` | Dataset Explorer | 8001 | 5174 |
| `optuna` | Optuna | 8063 | 3003 |
| `training` | Training | 8064 | 5176 |
| `inference` | Inference | 8065 | 5177 |
| `mlflow` | MLflow | 8062 | 3001 |
| `dvc` | DVC | 8061 | 3002 |
| `docs` | Docs Assistant | 8068 | aucun |

Le registre du lanceur connaît aussi `compare`, `3d`, `meshy` et `recon3d`, qui ne font partie ni de ce dépôt ni du catalogue ; le lanceur accepte leurs noms mais ne peut pas les démarrer quand leurs dossiers sont absents. Démarrer un backend à la main avec `uvicorn`, sans le lanceur, utilise les valeurs par défaut de son propre `config.py`, qui peuvent différer des ports de base ci-dessus (DVC utilise ainsi 8002 et MLflow 8001). Deux apps ayant la même valeur par défaut peuvent alors entrer en collision. Les backends écoutent sur toutes les interfaces de leur machine, et les frontends sur `127.0.0.1` uniquement.

## Arborescence du workspace

Sous la racine du workspace, le lanceur crée un dossier par application et par utilisateur, plus les sous-dossiers ci-dessous. Les applications créent elles-mêmes tout le reste ; chaque app documente ses fichiers dans sa propre page de configuration.

```text
<workspace>/
  annotation_<utilisateur>/
  explorer_<utilisateur>/        thumbs/  faiss/  subsets/
  orchestrator_<utilisateur>/    pipelines/
  training_<utilisateur>/        runs/  exports/
  inference_<utilisateur>/       runs/
  optuna_<utilisateur>/          logs/
  mlflow_<utilisateur>/          mlflow_data/
  dvc_<utilisateur>/             repo/
  docs_<utilisateur>/
```

Deux fichiers vivent dans le dépôt de la machine cible, en dehors du workspace : `.run/.instances.json` et `.run/.port_lock` (voir [Concepts](concepts.fr.md#le-registre-dinstances-partagé)), et chaque application garde dans son propre dossier un petit `data/.history.json` qui enregistre les workspaces qu'elle a utilisés.

## Prérequis de la VM Linux GPU

Le mode VM a ses propres exigences côté SSH et côté VM.

- **SSH non interactif** : `ssh <vm>` doit fonctionner depuis Windows sans invite de mot de passe (clé ou agent). VisionNexus démarre `ssh` sans moyen de répondre à une invite, et le panneau **Ports** utilise `BatchMode=yes` avec une limite de connexion de 5 secondes.
- **Nom de destination** : chaque entrée de **VM(s) connue(s)** est transmise telle quelle à `ssh` : un alias d'hôte de votre `~/.ssh/config` ou `utilisateur@hôte`. L'utilisateur SSH est décidé là, pas par **Utilisateur**.
- **Dépôt et chemins** : **Racine Computer_Vision_App**, **Workspace** et **Chemin conda** doivent être des chemins Linux qui existent sur la VM. Les commandes de lancement s'exécutent sous la forme `cd '<racine>' && python launcher.py ...`, donc `python` doit être trouvé par ce shell.
- **Ports locaux libres** : les mêmes numéros de ports que ceux choisis par la VM doivent être libres sur votre machine Windows, puisque les tunnels les réutilisent.
- **Outils du panneau Ports** : `ss`, `ps` et `pgrep`. **Tuer** prend le numéro de processus dans `ss` ; `lsof` ou `fuser` ne servent que de repli quand `ss` n'affiche pas de numéro de processus.
- **Exposition** : les backends et les frontends n'écoutent que sur `127.0.0.1`, et chaque backend exige le jeton de session de son instance. Seuls vos tunnels les atteignent ; [Sécurité](security.fr.md) décrit les protections et les variables `CV_BIND_HOST` et `CV_AUTH` qui les assouplissent.

## Poids de modèles

Les applications ne téléchargent jamais de poids à l'exécution. Les poids, leurs chemins attendus et leurs sources sont listés par application dans [MODEL_WEIGHTS.md](../MODEL_WEIGHTS.fr.md), qui fait référence ; cette page ne les répète pas. Chaque app documente dans sa propre page de configuration comment elle trouve ses poids et ce qu'elle fait quand l'un d'eux manque.

Pour le Docs Assistant, le petit modèle d'embeddings est téléchargé une fois, en ligne, avec `python scripts/download_model.py` depuis `Docs_Assistant_App/`, puis utilisé hors ligne. Sans lui, la recherche dans la documentation fonctionne encore avec les seuls mots-clés.

## Construire et installer l'app de bureau

Pour exécuter le lanceur depuis les sources, installez les dépendances et démarrez-le depuis le dossier `desktop/`. Les scripts npm sont :

| Commande | Effet |
|---|---|
| `npm ci` | Installe les dépendances depuis `package-lock.json` |
| `npm run build` | Compile `src/*.ts` dans `dist/` |
| `npm test` | Exécute les tests unitaires et la vérification des ancres de documentation |
| `npm start` | Construit, puis démarre le programme en mode développement |
| `npm run dist:win` | Construit, teste, embarque la documentation et produit le `release/VisionNexusElectron.exe` portable |
| `npm run dist:linux` | Idem, en produisant une AppImage sur une machine Linux |

Le programme portable ne demande aucune installation. Il embarque une copie des pages de documentation (`npm run copy-docs`, fait par les scripts `dist`), utilisée quand aucun dépôt n'est trouvé à côté de lui. Exécuter `python rebuild_all.py --package-desktop` à la racine du dépôt installe et construit tous les frontends et l'app de bureau en une seule commande.
