---
app: explorer
doc_type: configuration
audience: both
lang: fr
title: Configuration
order: 40
tags: [installation, poids clip, ports, variables d'environnement, workspace, paramètres, liens symboliques]
sources: [Dataset_Explorer_App/backend/config.py, Dataset_Explorer_App/backend/api/settings.py, Dataset_Explorer_App/launcher.py, _lib/launcher_engine.py, Dataset_Explorer_App/frontend/vite.config.ts, Dataset_Explorer_App/backend/core/subset_manager.py, Dataset_Explorer_App/backend/core/job_runner.py, Dataset_Explorer_App/backend/utils/native_share.py, Dataset_Explorer_App/frontend/src/pages/SettingsPage.tsx, MODEL_WEIGHTS.md]
---

# Configuration

## Prérequis et dépendances de Dataset Explorer

Dataset Explorer a besoin de Python 3.12 (la suite utilise l'environnement conda `IA_env`) et de Node.js avec npm pour le frontend. Un GPU CUDA accélère les embeddings mais reste optionnel : CLIP tourne sur CPU quand aucun GPU n'est trouvé.

Paquets Python utilisés par le backend :

- Web et stockage : `fastapi`, `uvicorn`, `pydantic`, `sqlmodel` (SQLAlchemy, SQLite).
- Modèles et calcul : `torch`, `open_clip_torch`, `numpy`, `pillow`, `faiss-cpu` (ou une version GPU de FAISS), `umap-learn`, `scikit-learn` (t-SNE, PCA, KMeans), `hdbscan`.
- Fonctions optionnelles : `opencv-python` (lecture plus rapide et plus complète des images 16 bits et infrarouges ; PIL sert de repli), `pandas` avec `openpyxl` ou `xlrd` (tableaux de métadonnées ; le CSV ne demande que `pandas`), `httpx` (seulement pour l'appel `start-embed` de l'Orchestrateur).

Première installation depuis la racine de la suite, dans un terminal où `IA_env` est actif :

```bash
pip install open_clip_torch faiss-cpu umap-learn hdbscan sqlmodel pandas openpyxl
cd Dataset_Explorer_App/frontend
npm install
```

Les poids CLIP doivent ensuite être placés comme décrit dans la section suivante. L'application ne télécharge jamais rien d'elle-même.

## Poids du modèle CLIP

Dataset Explorer fonctionne hors ligne : au démarrage il fixe `HF_HUB_OFFLINE=1` et `TRANSFORMERS_OFFLINE=1` (sauf si elles sont déjà définies) et charge les poids CLIP ViT-B/32 depuis une source locale, dans cet ordre :

1. Le fichier donné par la variable d'environnement `CLIP_WEIGHTS`, s'il existe.
2. Le fichier embarqué `Dataset_Explorer_App/models/ViT-B-32-openai.safetensors`.
3. Le cache Hugging Face, toujours hors ligne, pour le tag `openai` de `ViT-B-32`.

Le fichier attendu est `open_clip_model.safetensors` du dépôt Hugging Face `timm/vit_base_patch32_clip_224.openai`, renommé `ViT-B-32-openai.safetensors` (voir `MODEL_WEIGHTS.md` à la racine de la suite). Pour remplir plutôt le cache une fois avec une connexion réseau, démarrez le backend avec `HF_HUB_OFFLINE=0`.

Le nom d'architecture doit rester `ViT-B-32` (et non `ViT-B-32-quickgelu`) : c'est la variante qui reproduit les embeddings déjà stockés dans les bases existantes. Changer de modèle rend les embeddings stockés incompatibles ; dans ce cas, réencodez chaque dataset avec `POST /api/datasets/{id}/embed?force=true`.

Si aucun poids n'est trouvé, le backend démarre quand même mais journalise "Impossible de charger CLIP", `/health` indique `clip_loaded: false`, et toute demande d'embeddings ou de recherche échoue avec "Modele CLIP non charge" (voir [Dépannage](troubleshooting.fr.md)).

## Lancer Dataset Explorer

VisionNexus lance Dataset Explorer pour vous, en local ou sur la VM distante, avec l'utilisateur et le workspace choisis dans le lanceur. Sans VisionNexus, deux lanceurs en ligne de commande existent.

Depuis la racine de la suite (lanceur commun, mêmes options pour toutes les applications) :

```bash
python launcher.py --app explorer --workspace <racine des workspaces> --user <nom>
```

Depuis le dossier de l'application (lanceur autonome) :

```bash
python Dataset_Explorer_App/launcher.py --workspace <racine des workspaces> --user <nom>
```

Les deux créent le workspace `<racine des workspaces>/explorer_<nom>/`, choisissent des ports libres, enregistrent l'instance dans la liste partagée des instances en cours, puis démarrent le backend (uvicorn sur `127.0.0.1`) et le frontend Vite. Options utiles : `--backend-port` et `--frontend-port` pour imposer les ports, `--backend-only`, `--no-reload` (sinon le backend se recharge à chaque modification du code), `--conda-env` (`IA_env` par défaut) et `--native-share-host` (voir *VM distante et partage natif*). Les workspaces créés avant le renommage de l'application (`visu_<nom>` avec `visu_bdd.db`) sont renommés automatiquement au premier lancement.

Lancement manuel pour le développement, depuis `Dataset_Explorer_App/` :

```bash
BACKEND_PORT=8001 EXPLORER_FRONTEND_PORT=5173 uvicorn backend.main:app --host 127.0.0.1 --port 8001 --reload
cd frontend && VITE_BACKEND_PORT=8001 npm run dev -- --port 5173
```

Sans `EXPLORER_WORKSPACE`, le lancement manuel utilise `Dataset_Explorer_App/data/` comme workspace.

## Ports et réseau

Chaque instance de Dataset Explorer utilise deux ports : le backend FastAPI et le frontend Vite.

| Lancement | Backend | Frontend |
|---|---|---|
| Lanceur de la suite ou de l'application | premier port libre à partir de 8001 | premier port libre à partir de 5174 |
| Manuel | 8001 (`BACKEND_PORT`) | 5173 (`VITE_FRONTEND_PORT`) |

Plusieurs utilisateurs peuvent faire tourner leur propre instance sur la même machine : les lanceurs sautent les ports déjà pris par d'autres instances enregistrées.

Le navigateur ne parle qu'au port du frontend. Vite relaie `/api`, `/thumbs` et `/gallery-thumbs` vers le backend (`VITE_BACKEND_PORT`, délai de 5 minutes), y compris les flux de progression des fusions et des rebuilds. C'est pourquoi seul le port du frontend doit être redirigé quand l'application tourne sur une VM distante via SSH. Le backend accepte les requêtes cross-origin de `localhost` et `127.0.0.1` sur le port frontend donné par `EXPLORER_FRONTEND_PORT`, et toujours sur 5173, 5174 et 5175.

La documentation interactive de l'API FastAPI est disponible sur le port du backend à l'adresse `/docs`.

## Variables d'environnement

Les lanceurs fixent la plupart de ces variables ; ne les définissez vous-même que pour un lancement manuel ou un déploiement particulier.

| Variable | Défaut | Effet |
|---|---|---|
| `EXPLORER_WORKSPACE` | `Dataset_Explorer_App/data` | Dossier du workspace (base, miniatures, index, subsets, paramètres). |
| `EXPLORER_USER` | `unknown` | Utilisateur courant ; propriétaire des datasets et dossiers qu'il publie, affiché dans le journal d'audit. |
| `BACKEND_PORT` | `8001` | Port du backend, utilisé pour l'auto-appel du `start-embed` de l'Orchestrateur. |
| `EXPLORER_FRONTEND_PORT` | `5173` | Port frontend autorisé par CORS. |
| `VITE_BACKEND_PORT`, `VITE_FRONTEND_PORT` | `8001`, `5173` | Cible du proxy et port du serveur Vite. |
| `VITE_IA_USER` | `anonymous` | Nom affiché dans le badge utilisateur. |
| `ANNOTATION_APP_IMPORTS` | `<suite>/Annotation_App/data/imports` | Dossier d'export par défaut des subsets. L'Orchestrateur le règle sur le dossier `imports` du workspace d'Annotation App. |
| `CLIP_WEIGHTS` | vide | Chemin explicite du fichier de poids CLIP. |
| `HF_HUB_OFFLINE`, `TRANSFORMERS_OFFLINE` | `1` | Interdisent tout téléchargement par les bibliothèques Hugging Face. |
| `CV_DATA_TUTO` | `<suite>/data_tuto` | Dossier des images d'exemple du tutoriel. |
| `EXPLORER_JOB_WORKERS` | `3` | Nombre de tâches lourdes exécutées en même temps. |
| `NATIVE_SHARE_HOST` | vide | Hôte de partage pour les chemins Windows (fixé par `--native-share-host`). |
| `LAUNCHED_BY_ORCHESTRATOR` | non définie | Fixée par l'Orchestrateur ; les exports vont alors toujours dans `ANNOTATION_APP_IMPORTS`. |
| `IA_INSTANCES_FILE`, `IA_APP_ID`, `IA_WORKSPACE_HISTORY_FILE` | fixées par les lanceurs | Sources des panneaux **Utilisateurs connectes** et **Historique des workspaces**. |
| `VITE_CACHE_DIR` | non définie | Cache Vite séparé quand deux frontends tournent depuis le même dossier. |

## Arborescence du workspace sur le disque

Le workspace d'un utilisateur de Dataset Explorer contient toutes ses données persistantes, hors du code source :

```text
<racine des workspaces>/explorer_<utilisateur>/
|-- dataset_explorer.db     base SQLite (datasets, images, embeddings, clusters, subsets, dossiers)
|-- settings.json           réglages de la page Paramètres, datasets épinglés, langue et tutoriel de repli
|-- audit.jsonl             journal d'audit des suppressions, verrous et exports (rotation à 5 Mo vers audit.jsonl.1)
|-- thumbs/                 miniatures JPEG de 256 pixels nommées <md5>.jpg
|-- faiss/<id dataset>/index.faiss   index de similarité de chaque dataset
`-- subsets/<nom du subset>/  un dossier de liens (ou de copies) par subset
```

Les miniatures portent le MD5 du fichier image : des fichiers identiques partagent une miniature. Supprimer un dataset retire ses fiches, son index et les miniatures qu'aucune autre image n'utilise ; les dossiers de subsets sous `subsets/` restent sur le disque.

Les données partagées vivent dans le dossier de l'application, pas dans le workspace, pour que tous les workspaces de l'installation les voient :

```text
Dataset_Explorer_App/data/dataset_gallery/
|-- registry.json           datasets publiés : nom, chemin, compteurs, statistiques de base, miniatures, auteur, dossier
|-- folders_registry.json   dossiers partagés
`-- <nom du dataset>/thumbs/0.jpg ... 4.jpg   miniatures d'aperçu fixes d'un dataset publié
```

Sauvegardez le dossier du workspace pour conserver les analyses ; sauvegardez `dataset_gallery/` pour conserver le catalogue partagé.

## Liens symboliques sous Windows

Les subsets et les exports sont faits de liens symboliques par défaut. Sous Linux, ils fonctionnent toujours. Sous Windows, créer un lien symbolique demande le Mode développeur (Paramètres Windows, Espace développeurs, Mode développeur activé) ou un backend lancé avec les droits administrateur.

Sans l'un ni l'autre, créer un subset l'enregistre en base mais son dossier ne peut pas être rempli (un avertissement est journalisé), et l'export échoue. Deux solutions : activer le Mode développeur, ou choisir **Copie physique** dans **Subsets & liens** de la page **Paramètres**. Les copies prennent de la place et du temps mais marchent partout, y compris sur des partages qui refusent les liens. Le choix s'applique aux subsets et exports suivants ; les dossiers existants ne sont pas convertis.

Les liens sont relatifs quand c'est possible, absolus sinon (lecteurs différents). Un lien est cassé si l'image originale est déplacée.

## Options de la page Paramètres

La page **Paramètres** écrit `settings.json` dans le workspace quand vous cliquez sur **Sauvegarder les modifications**. Options et effet réel :

| Option | Défaut | Effet |
|---|---|---|
| **Dossier d'imports** | `ANNOTATION_APP_IMPORTS` | Dossier d'export par défaut quand la fenêtre d'export n'a pas de **Dossier de destination** (mode autonome ; un lancement par l'Orchestrateur utilise toujours son propre dossier). |
| **Stratégie de liens** | Symlinks | Liens symboliques ou copies physiques pour les subsets et les exports. |
| **Méthode** (réduction) | UMAP | Méthode des prochains embeddings, de **Recalculer carte**, des fusions et des rebuilds ; un changement signale les cartes existantes comme obsolètes. |
| `n_neighbors`, `min_dist` | 15, 0.1 | Paramètres UMAP. |
| **Perplexité**, **Learning rate** | 30, 200 | Paramètres t-SNE. |
| **Méthode par défaut** (clustering) | KMeans | Clustering des prochains embeddings et des fusions filtrées ; défaut des panneaux **Cluster**. |
| `min_cluster_size` | 5 | Paramètre HDBSCAN. |
| **Clusters KMeans** | 20 | Chargé par les boutons **Défaut** des panneaux Cluster. Le formulaire d'ajout démarre toujours à 20. |
| **Top-K recherche** | 20 | Valeur de départ du Top-K dans les pages de recherche. |
| **Mode couleur carte UMAP (défaut)** | Cluster | Mode couleur avec lequel la carte s'ouvre (**Cluster**, **Rareté** ou **Uniforme**). |
| **Fond de l'application**, **Couleur d'accent** | Gris sombre, Indigo | Thème de l'interface. |

Champs sans interface, modifiables dans `settings.json` : `native_share_host` (hôte de partage, remplacé par `NATIVE_SHARE_HOST`), `ui_language` (langue utilisée hors de VisionNexus), `tutorial_launched_once` et `tutorial_completed` (état du tutoriel hors de VisionNexus), `playground_dataset_ids` (datasets épinglés).

## VM distante et partage natif

Quand le backend de Dataset Explorer tourne sur une VM Linux et l'interface sur Windows, les chemins circulent dans les deux sens et ont besoin d'un hôte de partage : le nom DNS ou l'IP du serveur SMB qui expose les dossiers de la VM à Windows. VisionNexus le transmet avec `--native-share-host` ; on peut aussi le fixer dans `settings.json` (`native_share_host`).

La traduction suppose que le nom du partage est le deuxième segment du chemin serveur sous une racine connue (`/home`, `/mnt`, `/srv`, `/media`, `/data`) :

- Serveur vers Windows : `/srv/datasets/run01/img.jpg` devient `\\<hôte de partage>\datasets\run01\img.jpg`. Dans VisionNexus, les miniatures et les images en pleine résolution sont alors lues directement sur le partage, bien plus vite via SSH ; sans hôte de partage elles sont servies par le backend.
- Windows vers serveur : un chemin comme `\\hote\datasets\run01` saisi ou déposé dans **Ajouter un dataset** (et dans la source de dataset de l'Orchestrateur) devient le premier dossier existant parmi `/home/datasets/run01`, `/mnt/datasets/run01`, `/srv/datasets/run01`, `/media/datasets/run01`, `/data/datasets/run01`.

Les chemins Windows locaux (`D:\...`) sont utilisés tels quels.
