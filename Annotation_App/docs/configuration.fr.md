---
app: annotation
doc_type: configuration
audience: both
lang: fr
title: Configuration
order: 40
tags: [installation, hors ligne, poids des modèles, ports, variables d'environnement, workspace, paramètres]
sources: [Annotation_App/backend/config.py, Annotation_App/backend/services/settings_service.py, Annotation_App/launcher.py, _lib/launcher_engine.py, Annotation_App/frontend/vite.config.ts, Annotation_App/backend/requirements.txt, Annotation_App/backend/tests/download_all_models.py, Annotation_App/scripts/create_offline_zip.py, Annotation_App/install_samurai.bat, Annotation_App/backend/utils/native_share.py, Annotation_App/frontend/src/components/modals/SettingsModal.tsx, MODEL_WEIGHTS.md]
---

# Configuration

## Configuration système requise pour Annotation App

Annotation App fonctionne sous Windows 10/11 (64 bits) et sous Linux x86_64 (la cible habituelle d'une VM GPU distante). Elle a besoin d'un environnement Python pour le backend et de Node.js pour le frontend.

| Composant | Minimum | Remarques |
|---|---|---|
| Python | 3.11 | Environnement conda `IA_env` par défaut (Miniconda ou Anaconda 23+) |
| PyTorch | build CUDA recommandé | Installé à part de `backend/requirements.txt` |
| GPU NVIDIA | 6 Go de VRAM | Recommandé ; le CPU fonctionne mais SAM2, SAMURAI et Grounding DINO deviennent lents. Un GPU de 10 Go propage environ 350 à 450 frames par passage SAMURAI en mode GPU rapide |
| CUDA | 11.8+ | Facultatif, pour l'accélération GPU |
| Node.js / npm | 18+ / 8+ | Pour le frontend Vite. Le bundle Linux embarque `node-v20.20.2-linux-x64` |
| ffmpeg | 4+ | Nécessaire pour l'import vidéo |
| RAM | 8 Go, 16 Go recommandés | Le backend utilise environ 1 Go au repos et 2 à 2,2 Go avec les modèles chargés |
| Disque | 25 Go+ | Code, modèles (environ 3 Go avec SAM3.1), bundle hors ligne et données de travail |

Les dépendances Python sont listées dans `backend/requirements.txt` (FastAPI, uvicorn, SQLModel, OpenCV, Pillow, NumPy, SciPy, ffmpeg-python, lap, filterpy...). PyTorch, torchvision, `transformers` (pour Grounding DINO) et le paquet SAM2 s'installent à part, comme décrit dans les sections d'installation de cette page. Sans `transformers`, l'application démarre mais la détection par texte répond par une erreur.

## Lancer Annotation App depuis VisionNexus ou le lanceur de la suite

La façon normale de lancer Annotation App passe par le lanceur de la suite, directement ou depuis l'application de bureau VisionNexus, qui l'appelle pour vous (en local ou par SSH sur une VM).

Depuis la racine de la suite :

```bash
python launcher.py --app annotation --workspace <racine-workspaces> --user <utilisateur>
```

Directement depuis le dossier de l'application :

```bash
cd Annotation_App
python launcher.py --workspace <racine-workspaces> --user <utilisateur>
```

Options de `Annotation_App/launcher.py` :

| Option | Défaut | Effet |
|---|---|---|
| `--user` | obligatoire | Nom d'utilisateur ; le workspace est `<racine-workspaces>/annotation_<utilisateur>` |
| `--workspace` | obligatoire | Dossier racine de tous les workspaces |
| `--conda-env` | `IA_env` | Environnement conda utilisé pour trouver Python |
| `--backend-port` / `--frontend-port` | automatique | Force les ports au lieu d'en allouer des libres |
| `--backend-only` | désactivé | Ne démarre que l'API |
| `--no-reload` | désactivé | Démarre uvicorn sans rechargement automatique |
| `--access-log` | désactivé | Affiche chaque requête HTTP (utile uniquement pour un diagnostic) |
| `--native-share-host` | aucun | Nom DNS ou IP de l'hôte du partage SMB vu par les clients Windows |

Le lanceur de la suite accepte aussi `--conda-path` (racine d'un environnement conda, son `bin/activate`, ou un exécutable Python), prioritaire sur `--conda-env` ; VisionNexus le remplit depuis ses Paramètres lors d'un lancement par SSH.

Le lanceur crée le workspace, enregistre l'instance, démarre uvicorn (`backend.main:app` sur `127.0.0.1`) et le serveur de développement Vite, et arrête les deux sur `Ctrl+C`. VisionNexus attend l'endpoint `/health` du backend avant d'ouvrir l'onglet, car le chargement des modèles prend 10 à 40 secondes.

## Lancer manuellement le backend et le frontend

Pour le développement, le backend et le frontend peuvent être démarrés à la main. Sans le lanceur, le workspace est par défaut `Annotation_App/data/`.

Terminal 1, backend (depuis `Annotation_App/`) :

```bash
conda activate IA_env
uvicorn backend.main:app --host 127.0.0.1 --port 8000 --reload
```

Si `conda` n'est pas dans le PATH, appelez directement le Python de l'environnement, par exemple `/c/Users/<vous>/miniconda3/envs/IA_env/python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --reload`.

Terminal 2, frontend :

```bash
cd Annotation_App/frontend
npm run dev
```

Ouvrez ensuite `http://localhost:5173`. La documentation de l'API (Swagger) est sur `http://localhost:8000/docs`.

Pour utiliser un workspace précis, définissez `ANNOTATION_WORKSPACE` avant de démarrer uvicorn. Pour démarrer le frontend sur d'autres ports, définissez `VITE_BACKEND_PORT` et `VITE_FRONTEND_PORT`.

Règles pour les lancements manuels :

- Lancez toujours un seul worker uvicorn : SQLite ne supporte pas les écritures multi-processus. N'utilisez jamais `--workers` supérieur à 1.
- `--reload` sert au développement ; retirez-le pour les longues sessions.
- Démarrez uvicorn depuis `Annotation_App/`, pour que `backend.main` et les chemins relatifs des checkpoints se résolvent.

## Ports et accès réseau

Annotation App utilise deux ports : le backend FastAPI et le frontend Vite.

| Service | Port de base | Variable d'environnement | Remarques |
|---|---|---|---|
| Backend (FastAPI) | 8000 | `BACKEND_PORT` | API sous `/api`, WebSockets sous `/ws`, fichiers statiques sous `/media`, Swagger sous `/docs` |
| Frontend (Vite) | 5173 | `ANNOTATION_FRONTEND_PORT`, `VITE_FRONTEND_PORT` | Sert l'interface et relaie `/api`, `/media` et `/ws` vers le backend |

Quand plusieurs utilisateurs ou instances tournent sur la même machine, le lanceur alloue les premiers ports libres à partir de 8000 et 5173 et les enregistre dans `<racine de la suite>/.run/.instances.json`. Les ports réellement utilisés sont affichés au démarrage.

Le proxy Vite cible `127.0.0.1`, jamais `localhost` : sous Windows, Node essaie d'abord l'IPv6 alors qu'uvicorn écoute en IPv4, ce qui ajouterait environ 200 ms à chaque requête. Le délai du proxy est de 3 minutes pour les appels longs (lot texte, SAM3).

Le backend autorise les requêtes cross-origin depuis les ports 5173 et 3000 sur `localhost` et `127.0.0.1`, plus le port du frontend courant.

Sur une VM distante, le backend et le frontend n'écoutent que sur `127.0.0.1` (`CV_BIND_HOST=0.0.0.0` pour les exposer volontairement sur le réseau). Depuis Windows, atteignez le frontend par une redirection de port SSH (VisionNexus la met en place), ou par la redirection de port SSH de VS Code sur le port du frontend. Le proxy du frontend atteint alors le backend sur la VM elle-même.

## Variables d'environnement d'Annotation App

La plupart des variables sont définies par le lanceur ; ne les définissez vous-même que pour un lancement manuel.

| Variable | Défaut | Effet |
|---|---|---|
| `ANNOTATION_WORKSPACE` | `Annotation_App/data` | Dossier du workspace : base, projets, paramètres, sauvegardes, exports |
| `ANNOTATION_USER` | aucun | Nom de l'utilisateur courant (défini par le lanceur) |
| `IA_USER` | aucun | Nom d'utilisateur enregistré dans les événements du monitoring |
| `BACKEND_PORT` | `8000` | Port du backend (utilisé pour le CORS et les messages de démarrage) |
| `ANNOTATION_FRONTEND_PORT` | `5173` | Port du frontend (ajouté aux origines CORS autorisées) |
| `VITE_BACKEND_PORT`, `VITE_FRONTEND_PORT` | `8000`, `5173` | Ports utilisés par le serveur Vite et son proxy |
| `VITE_IA_USER` | aucun | Nom d'utilisateur affiché par le frontend |
| `VITE_CACHE_DIR` | défaut Vite | Cache Vite séparé par instance, évite les erreurs « Outdated Optimize Dep » quand deux instances partagent le dossier |
| `NATIVE_SHARE_HOST` | vide | Hôte SMB utilisé pour traduire les chemins serveur en chemins UNC ; prioritaire sur l'hôte enregistré |
| `CV_DATA_TUTO` | `<racine de la suite>/data_tuto` | Dossier des images d'exemple utilisées par le tutoriel |
| `IA_APP_ID`, `IA_INSTANCES_FILE`, `IA_WORKSPACE_HISTORY_FILE` | définies par le lanceur | Registre des instances et historique des workspaces affichés dans le badge utilisateur |
| `LAUNCHED_BY_ORCHESTRATOR` | non définie | Quand elle est définie, l'application tourne en mode orchestrateur (destination d'export fixée) |
| `TRANSFORMERS_OFFLINE`, `HF_HUB_OFFLINE`, `HF_DATASETS_OFFLINE` | non définies | Mettre à `1` pour interdire tout accès réseau à Hugging Face |
| `PYTHONIOENCODING` | système | Mettre à `utf-8` si la console lève `UnicodeEncodeError` au démarrage |

Les variables doivent être définies avant le démarrage d'uvicorn ; les modifier ensuite est sans effet.

## Arborescence du workspace sur disque

Le workspace est le dossier qui contient toutes les données d'un utilisateur. Avec le lanceur, c'est `<racine-workspaces>/annotation_<utilisateur>/` ; la racine par défaut de la suite est `All_workspaces/` à côté des applications, et un lancement sans utilisateur donne `annotation_default`. Un lancement manuel sans `ANNOTATION_WORKSPACE` utilise `Annotation_App/data/`.

```text
annotation_<utilisateur>/
  annotation.db              Base SQLite (mode WAL) : projets, frames, annotations, pistes, classes
  user_settings.json         Réglages de la fenêtre Paramètres
  projects/<id>/
    frames/                  Frames : liens symboliques, images envoyées ou frames extraites des vidéos
    frames_preview/          Aperçus JPEG 480 px et 1600 px en cache (régénérés à la demande)
    frames_8bit/             Versions 8 bits en cache des sources 16 bits (affichage)
    frames_ai_lut/           Images avec LUT appliquée données aux détecteurs, en cache
    frames_format specialise_cache/        Frames en cache du format optionnel format specialise
    _tracking_tmp/           Frames JPEG temporaires d'une tâche SAMURAI / SAM2 en cours
    <nom>_png/               Frames PNG converties depuis un fichier format specialise envoyé
  backup/p<id>_<nom>/        Sauvegarde JSON automatique et liste des séquences (.txt), écrasées toutes les 2 minutes
  exports/                   Exports YOLO, COCO et .ver (dossiers ou fichiers ZIP)
  imports/<sous-ensemble>/   Images transmises par l'Orchestrator pour un nouveau projet
  monitoring/events.jsonl    Journal d'événements de la page Monitoring
```

Tout ce qui se trouve sous `frames_preview/`, `frames_8bit/`, `frames_ai_lut/` et `frames_format specialise_cache/` est un cache : on peut le supprimer sans risque, il est reconstruit au besoin. Les fichiers de cache portent la signature de la LUT dans leur nom, et les générations périmées sont purgées quand une LUT change.

Pour sauvegarder un workspace, conservez `annotation.db` avec `projects/` (et les dossiers sources référencés par lien symbolique). Supprimer `annotation.db` recrée une base vide au démarrage suivant : tous les projets et annotations sont perdus. La section **Stockage workspace** de la fenêtre Paramètres affiche la taille des projets, des sauvegardes et des exports et peut vider les deux derniers.

## Poids des modèles et emplacement

Annotation App charge ses modèles depuis des fichiers locaux sous `Annotation_App/backend/`. En mode hors ligne, les modèles ne sont jamais téléchargés en silence.

| Modèle | Emplacement attendu | Taille | Source |
|---|---|---|---|
| SAM2 et SAMURAI small (requis pour SAM, SAMURAI, SAM2 vidéo) | `backend/checkpoints/sam2.1_hiera_small.pt` | environ 46 Mo | Publication SAM2.1 de Meta |
| SAM2 tiny (repli plus léger, facultatif) | `backend/checkpoints/sam2.1_hiera_tiny.pt` | environ 38 Mo | Publication SAM2.1 de Meta |
| Grounding DINO tiny | tout le dossier `backend/checkpoints/grounding_dino/` (`config.json`, fichiers du processeur et du tokenizer, `model.safetensors` ou `pytorch_model.bin`) | quelques centaines de Mo | Hugging Face `IDEA-Research/grounding-dino-tiny` |
| SAM3.1 multiplex (facultatif) | `backend/checkpoints/sam3.1/sam3.1_multiplex.pt` plus les fichiers JSON et tokenizer du même snapshot | environ 2,4 Go | Hugging Face `facebook/sam3.1` (accès restreint) |
| XFeat (facultatif, homographie sur GPU) | `backend/models/xfeat/` avec `weights/xfeat.pt` | environ 25 Mo | GitHub `verlab/accelerated_features` |

Au démarrage, le backend charge SAM2 small quand `sam2.1_hiera_small.pt` existe, sinon le modèle tiny. Sans aucun checkpoint SAM2, le serveur démarre quand même, mais les requêtes SAM échouent. Grounding DINO utilise le dossier local quand `config.json` est présent, sinon il télécharge `IDEA-Research/grounding-dino-tiny` depuis Hugging Face au premier usage. Sans XFeat, l'homographie se replie sur SIFT avec RANSAC (OpenCV).

Téléchargement assisté, depuis `Annotation_App/` avec accès internet :

```bash
conda activate IA_env
python backend/tests/download_all_models.py --skip-sam3                 # SAM2 + Grounding DINO
python backend/tests/download_all_models.py --hf-token hf_xxxxxxxx      # SAM3.1 en plus
```

SAM3.1 est à accès restreint : acceptez ses conditions sur sa page Hugging Face, puis connectez-vous (`huggingface-cli login`) ou passez `--hf-token`. Des scripts individuels existent aussi (`download_sam2.py`, `download_grounding_dino.py`, `download_sam3.py`). La liste des poids de toute la suite est dans `MODEL_WEIGHTS.md` à la racine de la suite.

## Installer SAMURAI et XFeat

SAMURAI et XFeat ne sont pas des paquets pip ; ils vivent dans des dossiers du backend.

**SAMURAI** est un fork de SAM2 (mêmes checkpoints, configurations différentes avec `samurai_mode` activé). Il est attendu dans `backend/ext/samurai_repo/`, avec son sous-dossier `sam2/` installé en mode éditable. Sous Windows, lancez `install_samurai.bat` depuis `Annotation_App/` : il clone `https://github.com/yangchris11/samurai` dans `backend/ext/samurai_repo/` (ou le met à jour) et l'installe dans `IA_env`. Les bundles de la suite le contiennent déjà. Quand SAMURAI manque, l'onglet **SAMURAI** affiche **SAM2 standard (SAMURAI absent)** et la propagation utilise SAM2 vidéo simple.

**XFeat** est attendu dans `backend/models/xfeat/` (avec `modules/xfeat.py` et `weights/xfeat.pt`). Pour l'installer avec accès internet :

```bash
git clone https://github.com/verlab/accelerated_features backend/models/xfeat
```

Quand XFeat est présent et se charge correctement, l'onglet **Homogr.** affiche **XFeat GPU** ; sinon il affiche **SIFT CPU**.

**SAM2** lui-même s'installe comme paquet Python : `pip install git+https://github.com/facebookresearch/segment-anything-2.git` avec accès internet, ou depuis une wheel préparée hors ligne (voir les sections d'installation hors ligne). L'erreur `ModuleNotFoundError: No module named 'sam2'` au démarrage signifie que cette étape manque.

## Installer Annotation App avec accès internet

Avec accès internet, une installation standard se fait en quatre étapes (commandes depuis `Annotation_App/`).

1. Créez l'environnement et installez PyTorch avec CUDA :

   ```bash
   conda create -n IA_env python=3.11
   conda activate IA_env
   conda install pytorch torchvision torchaudio pytorch-cuda=12.1 -c pytorch -c nvidia
   ```

   Sous Linux ou sans PyTorch conda, `pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121` fonctionne aussi.

2. Installez SAM2 et les dépendances du backend :

   ```bash
   pip install git+https://github.com/facebookresearch/segment-anything-2.git
   pip install -r backend/requirements.txt
   pip install transformers
   conda install -c conda-forge ffmpeg
   ```

3. Installez les dépendances du frontend : `cd frontend && npm install`.
4. Téléchargez les modèles (section *Poids des modèles et emplacement*) et, sous Windows, lancez `install_samurai.bat`.

Lancez ensuite l'application comme décrit dans *Lancer Annotation App depuis VisionNexus ou le lanceur de la suite*.

## Installation hors ligne : préparer le bundle sur une machine connectée

Une cible hors ligne (un PC ou une VM sans internet) s'installe à partir d'un bundle préparé une fois sur une machine avec accès internet. Toutes les commandes se lancent depuis `Annotation_App/`.

1. **Wheels Python**. Téléchargez les wheels pour chaque plateforme cible :

   ```bash
   pip download -r backend/requirements.txt -d offline_windows/wheels/ --platform win_amd64 --python-version 311 --only-binary :all:
   pip download -r backend/requirements.txt -d offline_linux/wheels/ --platform linux_x86_64 --python-version 311 --only-binary :all:
   ```

   `pip download` ne sait pas récupérer d'URL Git : construisez vous-même la wheel SAM2 (`git clone https://github.com/facebookresearch/segment-anything-2`, puis `pip wheel . -w <dossier offline>/wheels/`).

2. **Cache npm**. Le frontend dépend de binaires natifs (rolldown pour Vite, le moteur oxide de Tailwind CSS v4). Lancez `npm install` dans `frontend/`, puis copiez le cache npm (`npm config get cache`) vers `offline_windows/npm-cache`. Pour Linux, tirez d'abord les binaires Linux dans le cache avec `npm install --no-save --force @rolldown/binding-linux-x64-gnu@<version> @tailwindcss/oxide-linux-x64-gnu@<version>` (versions correspondant à `package-lock.json`), copiez le cache vers `offline_linux/npm-cache`, puis relancez `npm install` pour retrouver un `node_modules` propre.

3. **Environnement conda**. Exportez soit un fichier de spécification (`conda list --explicit > offline/conda/spec-file.txt`, Miniconda requis sur la cible), soit l'environnement complet avec `conda pack -n IA_env -o offline/conda/IA_env.tar.gz` (6 à 8 Go, conda non requis sur la cible). Gardez aussi `conda env export > offline/conda/environment.yml` pour référence.

4. **Modèles**. Vérifiez que les checkpoints listés dans *Poids des modèles et emplacement* sont présents.

5. **Archive**. Construisez le ZIP avec `python scripts/create_offline_zip.py --platform windows` (ou `linux`, ou `both`). `--skip-models` laisse les checkpoints de côté et `--dry-run` liste seulement le contenu. L'archive s'appelle `AnnotationApp_offline_<plateforme>_<date>.zip`.

## Installation hors ligne : installer sur la machine cible

Sur la machine cible, décompressez l'archive et lancez les commandes depuis `Annotation_App/`. Utilisez `offline_windows/` sous Windows et `offline_linux/` sous Linux.

1. **Environnement Python**, au choix :
   - depuis conda-pack : extrayez `offline/conda/IA_env.tar.gz` dans `<miniconda>/envs/IA_env`, activez-le et lancez `conda-unpack` pour corriger les chemins absolus ;
   - depuis le fichier de spécification : `conda create --name IA_env --file offline/conda/spec-file.txt` ;
   - depuis les wheels seules : `conda create -n IA_env python=3.11`, puis `pip install --no-index --find-links offline_windows/wheels/ torch torchvision torchaudio`.

2. **Dépendances du backend et SAM2** :

   ```bash
   pip install --no-index --find-links offline_windows/wheels/ -r backend/requirements.txt
   pip install --no-index --find-links offline_windows/wheels/ segment_anything_2
   ```

3. **Frontend** : `cd frontend && npm install --offline --cache ../offline_windows/npm-cache` (ou `--prefer-offline` pour autoriser le téléchargement de ce qui manque).

4. **Mode hors ligne Hugging Face** : définissez `TRANSFORMERS_OFFLINE=1`, `HF_HUB_OFFLINE=1` et `HF_DATASETS_OFFLINE=1` avant de démarrer uvicorn, par exemple dans un fichier `.env` ou dans le shell (`set` en CMD, `$env:NOM = "1"` en PowerShell, `export` en bash). Sinon le backend peut tenter de joindre Hugging Face au démarrage.

5. **Vérifiez** l'installation comme décrit dans *Vérifier l'installation*.

Sur un bundle Linux de toute la suite, remplacer le dossier `Annotation_App/` par une nouvelle version suffit : le lanceur de la suite trouve l'application sur place.

## Fenêtre Paramètres : options de l'interface

La section **Interface** de la fenêtre Paramètres (bouton engrenage) regroupe les options d'affichage. Les réglages sont enregistrés par utilisateur dans `user_settings.json` du workspace ; après une mise à jour de l'application, les clés manquantes reçoivent les valeurs par défaut ci-dessous.

| Option (libellé) | Clé | Défaut | Effet |
|---|---|---|---|
| **Couleur de fond canvas** | `background_color` | `#0f172a` | Couleur derrière l'image dans le canvas d'annotation |
| **Outil par défaut** | `default_tool` | Rectangle (`bbox`) | Outil sélectionné à l'ouverture d'un projet (Sélection, Bounding Box, Polygone, SAM Point, Déplacement) |
| **Opacité des annotations** | `annotation_opacity` | 0,2 | Opacité du remplissage des boîtes et des polygones (0 = contour seul, 1 = plein) |
| **Afficher les étiquettes** | `show_labels` | oui | Nom de la classe dessiné sur chaque annotation |
| **Afficher le score** | `show_confidence` | non | Confiance en % dessinée sur les annotations IA |
| **Épaisseur des bordures** | `annotation_border_width` | 2 | Épaisseur du contour, de 1 à 4 px |
| **Réduction preview (480/1600px)** | `preview_downscale_enabled` | activée | Sert des aperçus JPEG réduits (480 px pendant le défilement, 1600 px au zoom normal). À désactiver sur une connexion rapide pour toujours obtenir la pleine résolution, sans copies réduites écrites sur disque |
| **Live temps réel par défaut** | `realtime_live_enabled` | activé | Pendant SAMURAI et SAM2, le canvas suit la frame propagée, lit l'image par le partage natif quand il est disponible et affiche les annotations poussées par WebSocket. Désactivé, le canvas reste sur votre frame et le résultat est rechargé à la fin |
| **Suivi propagation : cadence du canvas** | `propagation_nav_throttle_ms` | 150 ms | Intervalle minimal entre deux sauts d'image du canvas pendant une propagation. 150 ms suit la boucle WebSocket ; 700 ms économise le trafic en repli HTTP ; 0 suit chaque résultat GPU. Les pastilles de la timeline et les annotations ne sont jamais cadencées |

La hauteur des pistes (`tracks_panel_height`, 92 px) est enregistrée quand vous faites glisser la poignée au-dessus de la timeline. Les profils enregistrés avec l'ancienne cadence par défaut de 700 ms sont migrés une fois vers 150 ms ; les valeurs personnalisées sont conservées.

## Fenêtre Paramètres : options d'import

La section **Import** de la fenêtre Paramètres contient des valeurs par défaut pour les imports.

| Option (libellé) | Clé | Défaut | Effet |
|---|---|---|---|
| **Qualité JPEG** | `jpeg_quality` | 85 | Qualité des frames extraites des vidéos (50 à 95). Les dossiers d'images ne sont jamais réencodés |
| **Chunk source (MB)** | `chunk_size_mb` | 8 | Taille des morceaux d'un envoi monofichier, qui est aussi la RAM maximale utilisée par le serveur pendant l'envoi |
| **Décimation frames (frame_keep)** | `frame_keep` | 0 | 0 garde toutes les frames, 2 une sur deux, 3 une sur trois... |
| **Taille batch images** | `batch_size_images` | 20 | Nombre d'images envoyées par requête lors de l'envoi d'un dossier d'images |

La fenêtre **Importer des séquences** démarre sa **Qualité JPEG** et sa **Décimation frames** avec ces valeurs (modifiables pour un import dans ses **Options d'optimisation**). **Chunk source (Mo)** et **Taille batch images** s'appliquent à chaque envoi. **Frames par batch (extraction arrière-plan)**, **PNG sans perte pour les MP4 (ignore la qualité JPEG)** et l'option de liens symboliques n'existent que dans la fenêtre d'import.

Conseils pour l'extraction : une qualité JPEG de 85 suffit pour l'annotation manuelle et SAM ; utilisez 95 ou le PNG sans perte quand l'homographie ou le flux optique comptent, car les artefacts de compression perturbent les points d'intérêt et les gradients. Un JPEG 1080p en qualité 85 pèse 200 à 400 Ko, donc 1000 frames occupent 200 à 400 Mo ; décimer une vidéo à 30 fps à une frame sur six divise cela par six. Pendant l'extraction, le serveur ne garde qu'une frame décodée en mémoire à la fois (environ 6 Mo en 1080p, 25 Mo en 4K).

## Fenêtre Paramètres : options des algorithmes

La section **Algorithmes** de la fenêtre Paramètres définit les paramètres par défaut des outils d'IA. L'interface lit ces valeurs à son chargement (enregistrer la fenêtre Paramètres recharge la page) ; modifier une valeur dans un panneau (onglets Tracks, barre texte) n'affecte que la session courante.

| Groupe | Option (libellé) | Clé | Défaut |
|---|---|---|---|
| NMS | **Seuil IoU NMS** | `nms_iou_threshold` | 0,5 |
| Grounding DINO | Box threshold / Text threshold | `grounding_dino_box_threshold` / `grounding_dino_text_threshold` | 0,30 / 0,25 |
| Grounding DINO | **Sortie segmentation par défaut** | `grounding_dino_use_sam_refine` | non (la barre d'outils démarre sur **BBox**) |
| SAM2 Auto | **Points par côté**, IoU threshold SAM | `sam_points_per_side`, `sam_pred_iou_thresh` | 32, 0,88 |
| Homographie | XFeat top-k keypoints, XFeat min cossim | `xfeat_top_k`, `xfeat_min_cossim` | 2048, 0,82 |
| Homographie | RANSAC threshold (px), **Min inliers**, **Min ratio inliers** | `ransac_threshold`, `min_inlier_count`, `min_inlier_ratio` | 4,0, 20, 0,3 |
| Flux optique | **Fenêtre win_size (px)**, **Niveaux pyramide max_level**, **Points min trackés** | `optflow_win_size`, `optflow_max_level`, `optflow_min_pts` | 21, 3, 4 |
| SAM3 | Box threshold / Text threshold | `sam3_box_threshold` / `sam3_text_threshold` | 0,25 / 0,20 |
| Appariement Detect. | **Max distance centroïde**, **Variation de taille max** | `guided_max_centroid_dist`, `guided_size_variation` | 0,15, 0,5 |
| SAMURAI / SAM2 vidéo | **Mode GPU rapide** | `sam2_offload_video_to_cpu` (inversé) | coché (frames sur le GPU) |
| Auto-stop | **Activer auto-stop**, **% d'objets perdus max**, **Frames consécutives** | `auto_stop_enabled`, `auto_stop_lost_ratio`, `auto_stop_consecutive_frames` | désactivé, 0,5, 5 |

**Mode GPU rapide** garde les frames de SAMURAI en VRAM (1,5 à 3 fois plus rapide, limité à environ 350 à 450 frames en 1024 x 1024 sur 10 Go) ; décoché, les frames restent en RAM (VRAM minimale, longues séquences, plus lent). L'outil **SAM Auto** de la barre d'outils utilise les **Points par côté** et le **Seuil IoU SAM** des réglages SAM2 Auto (son score de stabilité 0,95 et sa surface minimale de masque 100 px sont fixes). **Sortie segmentation par défaut** fixe la valeur de départ du sélecteur **BBox / Seg** de la barre d'outils, utilisé par SAM Auto, Grounding DINO et SAM3. Pour SAM3, seul le seuil de boîte est utilisé, comme score minimal, par la barre de détection par texte, son lot et l'onglet **Detect.** ; SAM3 n'a pas de seuil texte. Les valeurs d'appariement Detect. et celles de l'auto-stop sont les valeurs de départ de l'onglet **Detect.**. La signification de chaque paramètre est expliquée dans [Concepts](concepts.fr.md).

## Fenêtre Paramètres : stockage et valeurs par défaut de l'export YOLO

Les deux dernières sections de la fenêtre Paramètres concernent l'occupation disque et les valeurs par défaut de l'export.

**Stockage workspace** affiche la taille de trois dossiers du workspace : **Projets (frames + thumbnails)**, **Sauvegardes JSON** et **Exports YOLO (ZIP)**. Les lignes des sauvegardes et des exports ont un bouton corbeille (**Vider ce dossier**) qui supprime leur contenu ; les frames des projets ne sont jamais supprimées depuis cet endroit. **Actualiser** recalcule les tailles.

**Export YOLO** enregistre des valeurs par défaut pour les exports :

| Option (libellé) | Clé | Défaut |
|---|---|---|
| **Ratio Train**, **Ratio Val**, **Ratio Test** (la somme doit valoir 1.0) | `train_ratio`, `val_ratio`, `test_ratio` | 0,70, 0,20, 0,10 |
| **Inclure non-annotées** | `include_unannotated` | oui |
| **Liens symboliques images** | `symlink_images` | oui (dossier local, pas de ZIP) |

La fenêtre **Exporter le dataset** démarre avec ces valeurs (ratios train, validation et test, liens symboliques) et vous pouvez les modifier pour un export ; **Inclure non-annotées** est toujours appliqué (en `.ver`, les frames non annotées sont écrites sous forme de ligne de visibilité 0).

Boutons : **Réinitialiser** écrit aussitôt dans le fichier toutes les valeurs par défaut de toutes les sections, **Fermer** ferme sans enregistrer, **Sauvegarder** écrit le fichier puis recharge la page après un court délai pour que toutes les options prennent effet. **Réinitialiser** efface aussi l'hôte du partage enregistré dans le menu **Workspace** (sauf si `NATIVE_SHARE_HOST` est défini). La langue de l'interface ne se règle pas ici : elle suit VisionNexus (paramètre `?lang=`), ou le sélecteur de langue quand l'application tourne hors du lanceur.

## Partage natif (SMB) et réglages de chemins

Quand le backend tourne sur une VM Linux et l'interface sous Windows, les images des frames peuvent être lues directement sur le partage SMB qui expose les dossiers de la VM, au lieu d'être téléchargées via le backend et le tunnel SSH. C'est bien plus rapide et cela soulage le backend. Les mêmes réglages permettent de coller des chemins Windows dans la fenêtre d'import.

Deux réglages du groupe `paths` contrôlent la traduction entre chemins serveur et chemins UNC Windows :

- **Hôte du partage** (`native_share_host`, vide par défaut) : le nom DNS ou l'IP du serveur SMB tel que vu depuis Windows. Réglez-le dans le menu **Workspace** de la page des projets (**Montage Windows - hôte du partage**, puis **Enregistrer l'hôte du partage**), ou laissez VisionNexus le passer avec `--native-share-host` (variable d'environnement `NATIVE_SHARE_HOST`, prioritaire). L'hôte SSH de la VM et l'hôte du partage peuvent être des machines différentes.
- **Racines partagées** (`shared_roots`, par défaut `home`, `mnt`, `srv`, `media`, `data`) : les premiers segments des chemins serveur exposés comme partages.

Règle de traduction : `/srv/datasets/run01/f_000042.png` devient `\\<hôte>\datasets\run01\f_000042.png`. Le premier segment (la racine partagée) est retiré, le second devient le nom du partage. Les chemins hors des racines partagées (par exemple `/tmp`) ne peuvent pas être lus nativement et passent toujours par HTTP. Dans l'autre sens, un chemin UNC tapé dans la fenêtre d'import, le navigateur de fichiers ou la destination d'export est converti vers le premier chemin `/<racine>/<partage>/...` existant sur le backend.

Quand le backend tourne sur la même machine Windows que l'interface, les chemins sont déjà natifs et aucun hôte de partage n'est nécessaire. Les derniers dossiers parcourus sur le serveur sont mémorisés dans `browse_history` (12 entrées). L'utilisation du chemin natif à l'exécution est décrite dans [Architecture](architecture.fr.md).

## Vérifier l'installation

Après l'installation, vérifiez chaque couche depuis `Annotation_App/` : d'abord l'environnement Python et le GPU, puis le backend démarré et ses modèles, enfin l'interface. Chaque vérification ci-dessous isole une couche : la première qui échoue indique où chercher dans [Dépannage](troubleshooting.fr.md).

Python et GPU :

```bash
conda activate IA_env
python -c "import backend.main; print('Backend OK')"
python -c "import torch; print('CUDA:', torch.cuda.is_available())"
python -c "from backend.services.homography_service import homography_service; print('XFeat' if homography_service._use_xfeat else 'SIFT+RANSAC')"
```

Backend démarré :

```bash
curl http://localhost:8000/health                  # {"status": "ok", ..., "sam2": {...}}
curl http://localhost:8000/api/sam/ping            # SAM2 chargé, périphérique, modèle
curl http://localhost:8000/api/sam/grounding/status
curl http://localhost:8000/api/sam3/status
curl http://localhost:8000/api/samurai/status
```

Liste de contrôle :

- `conda activate IA_env` réussit et `ffmpeg -version` fonctionne.
- uvicorn démarre sans erreur et `/health` répond `"status": "ok"`.
- `backend/checkpoints/sam2.1_hiera_small.pt` existe et `/api/sam/ping` indique `loaded`.
- `npm run dev` démarre sur le port 5173 et l'interface s'ouvre sans erreur dans la console.
- Dans un projet Séquence Image, l'onglet **SAMURAI** affiche **SAMURAI actif (Kalman)** et l'onglet **Homogr.** affiche **XFeat GPU** sur une machine avec GPU.

## Mode local et mode VM distante

Annotation App exécute le même code dans deux déploiements ; seul l'endroit où tourne le backend change.

**Mode local** : backend, modèles et interface tournent sur le même ordinateur (Windows ou Linux). Les frames sont lues sur le disque local ; les chemins sont natifs ; aucun hôte de partage n'est nécessaire. Convient à un poste avec son propre GPU et des datasets modérés.

**Mode VM distante** : le backend, SQLite et les modèles tournent sur une VM Linux avec GPU ; l'interface tourne dans VisionNexus sur un poste Windows. L'API et les WebSockets passent par un tunnel SSH vers un port local ; les pixels des frames sont lus directement sur le partage SMB (protocole `app-image://` de VisionNexus) quand l'hôte du partage est configuré, avec un repli HTTP automatique. La mémoire utilisée par le backend et les modèles est sur la VM, pas sur le poste.

Recommandations pour le mode distant :

- Importez les datasets par chemin serveur avec liens symboliques plutôt que par envoi.
- Configurez l'hôte du partage, pour que les images ne passent pas par le tunnel.
- Gardez **Réduction preview** activée sauf si la connexion est rapide.
- Gardez **Live temps réel par défaut** activé ; ne passez la cadence du canvas à 700 ms que si le chemin natif n'est pas disponible.
- Vérifiez dans les logs la mention `chemin NATIF (SMB)` au début d'un passage SAMURAI : voir [Dépannage](troubleshooting.fr.md) si elle indique `REPLI HTTP`.
