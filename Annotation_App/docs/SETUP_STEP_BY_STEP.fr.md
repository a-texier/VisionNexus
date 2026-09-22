*[Read in English](SETUP_STEP_BY_STEP.md)*

# Setup Guide — Annotation App (Offline)

Guide d'installation complet pas-a-pas pour deployer l'Annotation App sur un nouveau PC Windows.
Ce guide couvre a la fois la preparation du bundle offline (machine source avec internet) et
l'installation sur la machine cible (sans internet).

---

## Sommaire

1. [Prerequis systeme](#1-prerequis-systeme)
2. [Obtenir le projet](#2-obtenir-le-projet)
3. [Preparer le dossier offline (machine SOURCE)](#3-preparer-le-dossier-offline-machine-source)
4. [Environnement Python (machine CIBLE)](#4-environnement-python-machine-cible)
5. [Dependances frontend (machine CIBLE)](#5-dependances-frontend-machine-cible)
6. [Modeles IA](#6-modeles-ia)
7. [Configuration mode offline](#7-configuration-mode-offline)
8. [Lancer l'application](#8-lancer-lapplication)
9. [Verification de l'installation](#9-verification-de-linstallation)
10. [Depannage](#10-depannage)

---

## 1. Prerequis systeme

| Composant    | Version minimale | Notes                                              |
|--------------|------------------|----------------------------------------------------|
| Windows      | 10 / 11 (64-bit) | Seul OS supporte                                   |
| GPU NVIDIA   | 6+ GB VRAM       | Recommande. CPU fonctionne mais est beaucoup plus lent |
| CUDA         | 11.8+            | Optionnel — accelere SAM2, SAM3, Grounding DINO, XFeat |
| Espace disque| 25+ GB           | Code + modeles + offline/ + donnees de travail     |
| RAM          | 8+ GB            | 16 GB recommande pour les videos longues           |
| Conda        | Miniconda 23+    | Ou Anaconda — gestion de l'environnement Python    |
| Node.js      | 18+              | Pour le build/dev frontend                         |
| npm          | 8+               | Installe avec Node.js                              |
| ffmpeg       | 4+               | Requis pour l'import de videos MP4                 |

### Verifier les prerequis

```bash
conda --version
node --version
npm --version
ffmpeg -version
nvidia-smi          # optionnel
```

### Installer ffmpeg (si absent)

```bash
# Option A — Via conda (recommande)
conda install -c conda-forge ffmpeg

# Option B — Via winget
winget install Gyan.FFmpeg
```

---

## 2. Obtenir le projet

### Depuis une archive offline (deploiement sans internet)

1. Obtenir le fichier `AnnotationApp_offline_YYYYMMDD.zip`
2. Dezipper dans un dossier de votre choix, par exemple `C:\Apps\Annotation_App\`
3. Verifier la structure :
   ```
   C:\Apps\Annotation_App\
   ├── backend\
   ├── frontend\
   ├── offline\             ← conda spec-file, conda-pack, README
   ├── offline_windows\     ← wheels pip + cache npm (binaires Windows)
   ├── offline_linux\       ← wheels pip + cache npm (binaires Linux)
   ├── data\
   ├── scripts\
   ├── README.md
   └── SETUP_STEP_BY_STEP.md
   ```
4. Ouvrir un terminal dans ce dossier

> Toutes les commandes supposent que vous etes dans le dossier racine `Annotation_App/`.

### Depuis le depot Git (si acces internet disponible)

```bash
git clone <url_du_depot>
cd Annotation_App
```

---

## 3. Preparer le dossier offline (machine SOURCE)

> Cette section est a executer UNE SEULE FOIS sur une machine ayant acces internet.
> Elle peuple le dossier `offline/` du projet avec tout ce dont la machine cible aura besoin.

### Structure du dossier offline/

```
offline/                      <- Conda + documentation
├── conda/
│   ├── IA_env.tar.gz         <- Environnement conda complet avec PyTorch CUDA (optionnel, ~6-8 GB)
│   └── spec-file.txt         <- Liste des packages conda (leger, necessite internet sur la cible)
└── README.txt                <- Rappel des commandes d'installation

offline_windows/              <- Bundle pour machine Windows
├── wheels/                   <- Wheels pip win_amd64 (~400-600 MB)
│   ├── segment_anything_2-*.whl
│   └── ...
└── npm-cache/                <- Cache npm avec binaires Windows (~500 MB)
    └── _cacache/             <- rolldown win32-x64-msvc + oxide-win32-x64-msvc

offline_linux/                <- Bundle pour machine Linux
├── wheels/                   <- Wheels pip linux_x86_64 (~400-600 MB)
│   └── ...
└── npm-cache/                <- Cache npm avec binaires Linux (~500 MB)
    └── _cacache/             <- rolldown linux-x64-gnu + oxide-linux-x64-gnu
```

---

### 3.1 — Wheels pip (requirements.txt + SAM2)

```bash
conda activate IA_env
mkdir -p offline_windows/wheels offline_linux/wheels

# Wheels pour Windows (win_amd64)
pip download -r backend/requirements.txt -d offline_windows/wheels/ --platform win_amd64 --python-version 311 --only-binary :all:
# Complementer avec les packages sans wheel binaire (build depuis source)
pip download -r backend/requirements.txt -d offline_windows/wheels/

# Wheels pour Linux (linux_x86_64)
pip download -r backend/requirements.txt -d offline_linux/wheels/ --platform linux_x86_64 --python-version 311 --only-binary :all:
```

**SAM2 — cas special (depot Git)**

`pip download` ne supporte pas les URLs git+https. Il faut construire le wheel :

```bash
# Option A : cloner et construire le wheel localement
git clone https://github.com/facebookresearch/segment-anything-2 C:\Temp\sam2_src
cd C:\Temp\sam2_src
pip wheel . -w C:\Apps\Annotation_App\offline\wheels\
cd C:\Apps\Annotation_App

# Option B : installer, puis extraire le wheel depuis le cache pip
pip install git+https://github.com/facebookresearch/segment-anything-2.git
pip download segment-anything-2 --no-deps -d offline/wheels/ --find-links "$(pip cache dir)/wheels"
# Si Option B echoue, utiliser Option A
```

**Verifier le contenu des wheels**

```bash
ls offline/wheels/ | grep -i segment   # doit afficher segment_anything_2-*.whl
ls offline/wheels/ | wc -l             # typiquement 40-60 fichiers
```

---

### 3.2a — Cache npm Windows

Le frontend utilise des packages avec des binaires natifs specifiques a la plateforme :
- **rolldown** (bundler Vite) : `@rolldown/binding-win32-x64-msvc` v1.0.0-rc.12
- **Tailwind CSS v4** (oxide engine) : `@tailwindcss/oxide-win32-x64-msvc` v4.2.2

```bash
cd frontend
npm install    # s'assurer que node_modules est a jour et les binaires Windows sont en cache

# Localiser le cache npm
npm config get cache
# Windows typique : C:\Users\<vous>\AppData\Local\npm-cache

# Copier le cache dans offline_windows/npm-cache
# PowerShell (recommande) :
robocopy (npm config get cache) ..\offline_windows\npm-cache /E /NFL /NDL /NJH /NJS

# Git Bash (alternatif) :
# cp -r "$(npm config get cache)" ../offline_windows/npm-cache

cd ..
```

### 3.2b — Cache npm Linux

Pour permettre un `npm install` hors-ligne sur Linux, les binaires Linux doivent d'abord
etre tires dans le cache npm depuis la machine Windows. Installer avec `--force` pour
contourner le check de plateforme :

```bash
cd frontend

# Installer les binaires Linux dans le cache npm (sans les ajouter a package.json)
npm install --no-save --force @rolldown/binding-linux-x64-gnu@1.0.0-rc.12 @tailwindcss/oxide-linux-x64-gnu@4.2.2

# Copier le cache (qui contient desormais les binaires Linux) dans offline_linux/npm-cache
robocopy (npm config get cache) ..\offline_linux\npm-cache /E /NFL /NDL /NJH /NJS

# Reinstaller les binaires Windows pour restaurer node_modules propre
npm install

cd ..
```

> Le cache npm contient maintenant les deux variantes (Windows et Linux).
> `offline_windows/npm-cache` inclut uniquement les binaires Windows,
> `offline_linux/npm-cache` inclut les deux (les binaires Linux ont ete ajoutes avant la copie).

---

### 3.3 — Environnement conda (optionnel mais recommande)

**Option A : spec-file (leger, necessite Miniconda sur la cible)**

```bash
conda activate IA_env
conda list --explicit > offline/conda/spec-file.txt
# Inclut les URLs exactes de chaque package conda — la cible peut reinstaller sans chercher
```

Installation sur la cible :
```bash
conda create --name IA_env --file offline/conda/spec-file.txt
```

**Option B : conda-pack (lourd, 100% offline, aucun conda requis sur la cible)**

```bash
conda install -c conda-forge conda-pack   # a installer une seule fois
conda pack -n IA_env -o offline/conda/IA_env.tar.gz
# Cree un environnement portable (~6-8 GB avec PyTorch CUDA)
```

Installation sur la cible :
```bash
mkdir C:\miniconda3\envs\IA_env
tar -xzf offline/conda/IA_env.tar.gz -C C:\miniconda3\envs\IA_env

# Reparation des chemins absolus (obligatoire apres extraction)
conda activate IA_env
conda-unpack
```

> `conda-pack` est la solution la plus robuste pour deployer sans internet. Le .tar.gz est gros
> (~6-8 GB) mais une fois extrait, aucun telechargement n'est necessaire.

---

### 3.4 — Exporter l'environnement conda (environment.yml)

En complement, toujours exporter un `environment.yml` lisible :

```bash
conda activate IA_env
conda env export > offline/conda/environment.yml
conda env export --from-history > offline/conda/environment_minimal.yml
```

---

### 3.5 — Modeles IA (checkpoints)

Les modeles sont volumineux et deja inclus dans le ZIP du projet si vous utilisez
`scripts/create_offline_zip.py`. Verifier qu'ils sont presents avant de zipper :

```bash
ls backend/checkpoints/sam2.1_hiera_small.pt        # ~46 MB
ls backend/checkpoints/grounding_dino/config.json   # ~172 MB total
ls backend/checkpoints/sam3.1/sam3.1_multiplex.pt   # ~2.4 GB (optionnel)
ls backend/models/xfeat/weights/xfeat.pt            # ~25 MB
```

Si certains manquent, les telecharger avant de creer le ZIP (voir section 6).

---

### 3.6 — Creer le ZIP deployable

```bash
conda activate IA_env

# ZIP pour Windows uniquement (inclut offline_windows/, exclut offline_linux/)
python scripts/create_offline_zip.py --platform windows
# Genere : AnnotationApp_offline_windows_YYYYMMDD.zip

# ZIP pour Linux uniquement (inclut offline_linux/, exclut offline_windows/)
python scripts/create_offline_zip.py --platform linux
# Genere : AnnotationApp_offline_linux_YYYYMMDD.zip

# ZIP avec les deux plateformes (offline_windows/ + offline_linux/ inclus)
python scripts/create_offline_zip.py --platform both
# Genere : AnnotationApp_offline_YYYYMMDD.zip

# Sans les modeles (code + offline/ seulement, plus leger)
python scripts/create_offline_zip.py --platform linux --skip-models

# Simulation sans creer le fichier
python scripts/create_offline_zip.py --platform linux --dry-run
```

Le ZIP inclut automatiquement les dossiers `offline/`, `offline_windows/` et/ou `offline_linux/`
selon le flag `--platform`.

---

## 4. Environnement Python (machine CIBLE)

### Option A — Depuis conda-pack (100% offline)

Si `offline/conda/IA_env.tar.gz` est present :

```bash
mkdir C:\miniconda3\envs\IA_env
tar -xzf offline/conda/IA_env.tar.gz -C C:\miniconda3\envs\IA_env
conda activate IA_env
conda-unpack     # corrige les chemins absolus
```

Verifier :

```bash
python -c "import torch; print('PyTorch:', torch.__version__); print('CUDA:', torch.cuda.is_available())"
```

### Option B — Depuis spec-file conda + wheels pip

```bash
# 1. Creer l'env depuis le spec-file (necessite Miniconda sur la cible)
conda create --name IA_env --file offline/conda/spec-file.txt
conda activate IA_env
```

Si le spec-file echoue (URLs reseau), creer manuellement et installer PyTorch depuis PyPI :

```bash
conda create -n IA_env python=3.11
conda activate IA_env

# PyTorch — utiliser le wheel depuis offline_windows/wheels/ si present
pip install --no-index --find-links offline_windows/wheels/ torch torchvision torchaudio
# OU (si pas de wheel PyTorch dans offline_windows/) : installer depuis internet
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121
```

```bash
# 2. Installer toutes les dependances pip depuis les wheels locaux
pip install --no-index --find-links offline_windows/wheels/ -r backend/requirements.txt

# 3. Installer SAM2 depuis le wheel local
pip install --no-index --find-links offline_windows/wheels/ segment_anything_2
# Si le wheel n'est pas trouve :
pip install --find-links offline_windows/wheels/ segment_anything_2
```

### Option C — Installation standard Windows (avec internet)

```bash
conda create -n IA_env python=3.11
conda activate IA_env

# PyTorch GPU (CUDA 12.1+)
conda install pytorch torchvision torchaudio pytorch-cuda=12.1 -c pytorch -c nvidia

# SAM2
pip install git+https://github.com/facebookresearch/segment-anything-2.git

# Autres dependances
pip install -r backend/requirements.txt
```

### Option C (Linux) — Installation offline Linux depuis les wheels

```bash
conda create -n IA_env python=3.11
conda activate IA_env

# PyTorch GPU (CUDA 12.1+) depuis les wheels Linux
pip install --no-index --find-links offline_linux/wheels/ torch torchvision torchaudio
# OU depuis internet :
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121

# Dependances pip depuis offline_linux/wheels/
pip install --no-index --find-links offline_linux/wheels/ -r backend/requirements.txt

# SAM2
pip install --no-index --find-links offline_linux/wheels/ segment_anything_2
```

### Verifier l'installation Python

```bash
python -c "import backend.main; print('Backend OK')"
python -c "import torch; print('CUDA:', torch.cuda.is_available())"
```

---

## 5. Dependances frontend (machine CIBLE)

### Depuis le cache offline (sans internet)

**Machine Windows** :

```bash
cd frontend
npm install --prefer-offline --cache ../offline_windows/npm-cache
cd ..
```

**Machine Linux** :

```bash
cd frontend
npm install --prefer-offline --cache ../offline_linux/npm-cache
cd ..
```

Si le cache est incomplet, npm tente de telecharger le complement. Pour forcer 100% offline :

```bash
# Windows
npm install --offline --cache ../offline_windows/npm-cache
# Linux
npm install --offline --cache ../offline_linux/npm-cache
```

### Installation standard (avec internet)

```bash
cd frontend
npm install
cd ..
```

### Verifier le frontend

```bash
cd frontend
npx tsc --noEmit
cd ..
```

---

## 6. Modeles IA

### Emplacements attendus

```
backend/
├── checkpoints/
│   ├── sam2.1_hiera_small.pt          (~46 MB)  — SAM2 small (GPU)
│   ├── sam2.1_hiera_tiny.pt           (~38 MB)  — SAM2 tiny (CPU fallback)
│   ├── grounding_dino/                (~172 MB) — Grounding DINO tiny
│   │   ├── config.json
│   │   ├── model.safetensors
│   │   └── tokenizer.json
│   └── sam3.1/                        (~2.4 GB) — SAM3.1 multiplex (optionnel)
│       ├── sam3.1_multiplex.pt
│       └── config.json
└── models/
    └── xfeat/                         (~25 MB)  — Homographie GPU rapide
        ├── modules/xfeat.py
        └── weights/xfeat.pt
```

### Verifier la presence des modeles

```bash
ls backend/checkpoints/sam2.1_hiera_small.pt
ls backend/checkpoints/grounding_dino/config.json
ls backend/checkpoints/sam3.1/sam3.1_multiplex.pt   # optionnel
ls backend/models/xfeat/weights/xfeat.pt
```

### Telecharger les modeles manquants (avec internet)

```bash
conda activate IA_env

# Telecharger SAM2 + Grounding DINO (sans SAM3.1)
python backend/tests/download_all_models.py --skip-sam3

# Avec SAM3.1 (modele gated HuggingFace — necessite un token approuve)
python backend/tests/download_all_models.py --hf-token hf_xxxxxxxxxxxx
```

> SAM3.1 est un modele "gated" : accepter les conditions sur
> https://huggingface.co/facebook/sam3.1 puis se connecter avec
> `huggingface-cli login` ou `--hf-token`.

### XFeat (si absent)

```bash
git clone https://github.com/verlab/accelerated_features backend/models/xfeat
```

Si XFeat est absent, l'application utilise SIFT+RANSAC (inclus dans OpenCV) en fallback.

---

## 7. Configuration mode offline

Creer un fichier `.env` a la racine du projet pour empecher tout acces reseau HuggingFace :

```
TRANSFORMERS_OFFLINE=1
HF_DATASETS_OFFLINE=1
HF_HUB_OFFLINE=1
```

Ou definir les variables avant de lancer uvicorn :

```bash
# Windows CMD :
set TRANSFORMERS_OFFLINE=1 && set HF_HUB_OFFLINE=1

# PowerShell :
$env:TRANSFORMERS_OFFLINE = "1"; $env:HF_HUB_OFFLINE = "1"

# Git Bash :
export TRANSFORMERS_OFFLINE=1 HF_HUB_OFFLINE=1
```

> Ces variables doivent etre definies AVANT de demarrer uvicorn.

---

## 8. Lancer l'application

### Terminal 1 — Backend

```bash
conda activate IA_env
cd C:\Apps\Annotation_App
uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
```

Si conda n'est pas dans le PATH bash :

```bash
/c/Users/<votre_nom>/miniconda3/envs/IA_env/python.exe -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
```

Backend disponible : http://localhost:8000
Docs API : http://localhost:8000/docs

### Terminal 2 — Frontend

```bash
cd C:\Apps\Annotation_App\frontend
npm run dev
```

Application disponible : http://localhost:5173

### Demarrage rapide (3 commandes)

```bash
# 1.
conda activate IA_env
# 2. Terminal 1
uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
# 3. Terminal 2
cd frontend && npm run dev
```

---

## 9. Verification de l'installation

### Tests rapides via curl

```bash
curl http://localhost:8000/health
curl http://localhost:8000/api/projects
curl http://localhost:8000/api/sam/grounding/status
```

### Tests Python detailles

```bash
conda activate IA_env
cd C:\Apps\Annotation_App

python -c "import backend.main; print('Backend OK')"

python -c "
from backend.services.sam_service import sam_service
print('SAM2 status:', sam_service.get_status())
"

python -c "
from backend.services.grounding_service import grounding_service
print('Grounding DINO disponible:', grounding_service.is_available())
"

python -c "
from backend.services.homography_service import homography_service
print('Homographie:', 'XFeat' if homography_service._use_xfeat else 'SIFT+RANSAC')
"

python -c "
import torch
print('CUDA:', torch.cuda.is_available())
if torch.cuda.is_available():
    print('GPU:', torch.cuda.get_device_name(0))
    print('VRAM:', round(torch.cuda.get_device_properties(0).total_memory/1e9,1), 'GB')
"
```

### Checklist de demarrage

- [ ] `conda activate IA_env` reussit
- [ ] `python -m uvicorn backend.main:app --port 8000` demarre sans erreur
- [ ] `GET http://localhost:8000/health` retourne `{"status": "ok"}`
- [ ] Au moins `sam2.1_hiera_small.pt` present dans `backend/checkpoints/`
- [ ] `ffmpeg -version` fonctionne
- [ ] `npm run dev` demarre sur `:5173`
- [ ] L'interface s'ouvre sans erreur console

---

## 10. Depannage

### Le backend ne demarre pas

**`ModuleNotFoundError: No module named 'sam2'`**

```bash
conda activate IA_env
# Depuis les wheels offline :
pip install --no-index --find-links offline/wheels/ segment_anything_2
# Avec internet :
pip install git+https://github.com/facebookresearch/segment-anything-2.git
```

**`UnicodeEncodeError` au demarrage**

```bash
set PYTHONIOENCODING=utf-8
uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
```

**`Port 8000 is already in use`**

```bash
netstat -ano | findstr :8000
taskkill /PID <PID> /F
```

**`FileNotFoundError: checkpoint not found`**

```bash
ls backend/checkpoints/
python backend/tests/download_all_models.py --skip-sam3
```

---

### Le frontend ne demarre pas

**`Cannot find module 'vite'`**

```bash
cd frontend
rm -rf node_modules package-lock.json
# Windows :
npm install --prefer-offline --cache ../offline_windows/npm-cache
# Linux :
npm install --prefer-offline --cache ../offline_linux/npm-cache
```

**Le frontend demarre mais ne communique pas avec le backend**

```bash
curl http://localhost:8000/health
# Verifier vite.config.ts : proxy /api -> http://localhost:8000
```

---

### Problemes GPU / CUDA

**CUDA Out of Memory**

```bash
set SAM_MODEL_SIZE=tiny
uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
```

**PyTorch ne detecte pas le GPU**

```bash
nvcc --version && nvidia-smi
python -c "import torch; print(torch.__version__, torch.version.cuda)"
# Reinstaller PyTorch avec la bonne version CUDA si necessaire
conda install pytorch torchvision torchaudio pytorch-cuda=12.1 -c pytorch -c nvidia
```

---

### Grounding DINO non disponible

```bash
ls backend/checkpoints/grounding_dino/
python -c "import transformers; print(transformers.__version__)"
pip install --no-index --find-links offline/wheels/ transformers
```

---

### Import video echoue (`ffmpeg not found`)

```bash
ffmpeg -version
conda activate IA_env && conda install -c conda-forge ffmpeg
```

---

### Performances lentes sur CPU

- SAM2 utilise automatiquement le modele `tiny`
- Grounding DINO : ~5-15 secondes par image
- XFeat remplace par SIFT+RANSAC (OpenCV pur)

```bash
uvicorn backend.main:app --host 0.0.0.0 --port 8000 --workers 1
```

---

## Notes importantes

1. **Un seul worker** — Ne jamais lancer uvicorn avec `--workers > 1` (SQLite multi-process).

2. **Sauvegarde des donnees** — Sauvegarder `data/annotation.db` et `data/projects/`
   regulierement.

3. **Reinitialiser la base** — Supprimer `data/annotation.db` la recrEe automatiquement
   (toutes les annotations sont perdues).

4. **Mode developpement** — Le flag `--reload` est destine au developpement. En production,
   le retirer.

5. **Variables offline** — Toujours definir `TRANSFORMERS_OFFLINE=1` et `HF_HUB_OFFLINE=1`
   sur la machine cible pour eviter les tentatives de connexion HuggingFace au demarrage.
