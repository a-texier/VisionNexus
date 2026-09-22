*[Lire en francais](SETUP_STEP_BY_STEP.fr.md)*

# Setup Guide — Annotation App (Offline)

Full step-by-step installation guide for deploying the Annotation App on a new Windows PC.
This guide covers both preparing the offline bundle (source machine with internet) and
installing on the target machine (without internet).

---

## Table of contents

1. [System prerequisites](#1-system-prerequisites)
2. [Getting the project](#2-getting-the-project)
3. [Prepare the offline folder (SOURCE machine)](#3-prepare-the-offline-folder-source-machine)
4. [Python environment (TARGET machine)](#4-python-environment-target-machine)
5. [Frontend dependencies (TARGET machine)](#5-frontend-dependencies-target-machine)
6. [AI models](#6-ai-models)
7. [Offline mode configuration](#7-offline-mode-configuration)
8. [Launching the application](#8-launching-the-application)
9. [Installation verification](#9-installation-verification)
10. [Troubleshooting](#10-troubleshooting)

---

## 1. System prerequisites

| Component    | Minimum version  | Notes                                              |
|--------------|------------------|----------------------------------------------------|
| Windows      | 10 / 11 (64-bit) | Only supported OS                                  |
| NVIDIA GPU   | 6+ GB VRAM       | Recommended. CPU works but is much slower           |
| CUDA         | 11.8+            | Optional -- speeds up SAM2, SAM3, Grounding DINO, XFeat |
| Disk space   | 25+ GB           | Code + models + offline/ + working data            |
| RAM          | 8+ GB            | 16 GB recommended for long videos                  |
| Conda        | Miniconda 23+    | Or Anaconda -- Python environment management       |
| Node.js      | 18+              | For the frontend build/dev                         |
| npm          | 8+               | Installed with Node.js                             |
| ffmpeg       | 4+               | Required for MP4 video import                      |

### Check prerequisites

```bash
conda --version
node --version
npm --version
ffmpeg -version
nvidia-smi          # optional
```

### Install ffmpeg (if missing)

```bash
# Option A -- Via conda (recommended)
conda install -c conda-forge ffmpeg

# Option B -- Via winget
winget install Gyan.FFmpeg
```

---

## 2. Getting the project

### From an offline archive (deployment with no internet)

1. Get the file `AnnotationApp_offline_YYYYMMDD.zip`
2. Unzip it into a folder of your choice, e.g. `C:\Apps\Annotation_App\`
3. Check the structure:
   ```
   C:\Apps\Annotation_App\
   ├── backend\
   ├── frontend\
   ├── offline\             ← conda spec-file, conda-pack, README
   ├── offline_windows\     ← pip wheels + npm cache (Windows binaries)
   ├── offline_linux\       ← pip wheels + npm cache (Linux binaries)
   ├── data\
   ├── scripts\
   ├── README.md
   └── SETUP_STEP_BY_STEP.md
   ```
4. Open a terminal in this folder

> All commands assume you are in the `Annotation_App/` root folder.

### From the Git repository (if internet access is available)

```bash
git clone <repo_url>
cd Annotation_App
```

---

## 3. Prepare the offline folder (SOURCE machine)

> This section must be run ONCE on a machine with internet access.
> It populates the project's `offline/` folder with everything the target machine will need.

### Structure of the offline/ folder

```
offline/                      <- Conda + documentation
├── conda/
│   ├── IA_env.tar.gz         <- Full conda environment with PyTorch CUDA (optional, ~6-8 GB)
│   └── spec-file.txt         <- List of conda packages (lightweight, needs internet on the target)
└── README.txt                <- Reminder of the install commands

offline_windows/              <- Bundle for a Windows machine
├── wheels/                   <- pip win_amd64 wheels (~400-600 MB)
│   ├── segment_anything_2-*.whl
│   └── ...
└── npm-cache/                <- npm cache with Windows binaries (~500 MB)
    └── _cacache/             <- rolldown win32-x64-msvc + oxide-win32-x64-msvc

offline_linux/                <- Bundle for a Linux machine
├── wheels/                   <- pip linux_x86_64 wheels (~400-600 MB)
│   └── ...
└── npm-cache/                <- npm cache with Linux binaries (~500 MB)
    └── _cacache/             <- rolldown linux-x64-gnu + oxide-linux-x64-gnu
```

---

### 3.1 — pip wheels (requirements.txt + SAM2)

```bash
conda activate IA_env
mkdir -p offline_windows/wheels offline_linux/wheels

# Wheels for Windows (win_amd64)
pip download -r backend/requirements.txt -d offline_windows/wheels/ --platform win_amd64 --python-version 311 --only-binary :all:
# Complement with packages that have no binary wheel (build from source)
pip download -r backend/requirements.txt -d offline_windows/wheels/

# Wheels for Linux (linux_x86_64)
pip download -r backend/requirements.txt -d offline_linux/wheels/ --platform linux_x86_64 --python-version 311 --only-binary :all:
```

**SAM2 — special case (Git repository)**

`pip download` does not support git+https URLs. You have to build the wheel yourself:

```bash
# Option A: clone and build the wheel locally
git clone https://github.com/facebookresearch/segment-anything-2 C:\Temp\sam2_src
cd C:\Temp\sam2_src
pip wheel . -w C:\Apps\Annotation_App\offline\wheels\
cd C:\Apps\Annotation_App

# Option B: install, then extract the wheel from the pip cache
pip install git+https://github.com/facebookresearch/segment-anything-2.git
pip download segment-anything-2 --no-deps -d offline/wheels/ --find-links "$(pip cache dir)/wheels"
# If Option B fails, use Option A
```

**Check the wheel contents**

```bash
ls offline/wheels/ | grep -i segment   # should show segment_anything_2-*.whl
ls offline/wheels/ | wc -l             # typically 40-60 files
```

---

### 3.2a — Windows npm cache

The frontend uses packages with platform-specific native binaries:
- **rolldown** (Vite bundler): `@rolldown/binding-win32-x64-msvc` v1.0.0-rc.12
- **Tailwind CSS v4** (oxide engine): `@tailwindcss/oxide-win32-x64-msvc` v4.2.2

```bash
cd frontend
npm install    # make sure node_modules is up to date and the Windows binaries are cached

# Locate the npm cache
npm config get cache
# Typical Windows path: C:\Users\<you>\AppData\Local\npm-cache

# Copy the cache into offline_windows/npm-cache
# PowerShell (recommended):
robocopy (npm config get cache) ..\offline_windows\npm-cache /E /NFL /NDL /NJH /NJS

# Git Bash (alternative):
# cp -r "$(npm config get cache)" ../offline_windows/npm-cache

cd ..
```

### 3.2b — Linux npm cache

To allow an offline `npm install` on Linux, the Linux binaries must first
be pulled into the npm cache from the Windows machine. Install with `--force` to
bypass the platform check:

```bash
cd frontend

# Install the Linux binaries into the npm cache (without adding them to package.json)
npm install --no-save --force @rolldown/binding-linux-x64-gnu@1.0.0-rc.12 @tailwindcss/oxide-linux-x64-gnu@4.2.2

# Copy the cache (which now contains the Linux binaries) into offline_linux/npm-cache
robocopy (npm config get cache) ..\offline_linux\npm-cache /E /NFL /NDL /NJH /NJS

# Reinstall the Windows binaries to restore a clean node_modules
npm install

cd ..
```

> The npm cache now contains both variants (Windows and Linux).
> `offline_windows/npm-cache` includes only the Windows binaries,
> `offline_linux/npm-cache` includes both (the Linux binaries were added before the copy).

---

### 3.3 — Conda environment (optional but recommended)

**Option A: spec-file (lightweight, needs Miniconda on the target)**

```bash
conda activate IA_env
conda list --explicit > offline/conda/spec-file.txt
# Includes the exact URL of every conda package -- the target can reinstall without searching
```

Installation on the target:
```bash
conda create --name IA_env --file offline/conda/spec-file.txt
```

**Option B: conda-pack (heavy, 100% offline, no conda required on the target)**

```bash
conda install -c conda-forge conda-pack   # install once
conda pack -n IA_env -o offline/conda/IA_env.tar.gz
# Creates a portable environment (~6-8 GB with PyTorch CUDA)
```

Installation on the target:
```bash
mkdir C:\miniconda3\envs\IA_env
tar -xzf offline/conda/IA_env.tar.gz -C C:\miniconda3\envs\IA_env

# Fix absolute paths (required after extraction)
conda activate IA_env
conda-unpack
```

> `conda-pack` is the most robust way to deploy without internet. The .tar.gz is large
> (~6-8 GB) but once extracted, no download is needed.

---

### 3.4 — Export the conda environment (environment.yml)

In addition, always export a readable `environment.yml`:

```bash
conda activate IA_env
conda env export > offline/conda/environment.yml
conda env export --from-history > offline/conda/environment_minimal.yml
```

---

### 3.5 — AI models (checkpoints)

The models are large and already included in the project ZIP if you use
`scripts/create_offline_zip.py`. Check they are present before zipping:

```bash
ls backend/checkpoints/sam2.1_hiera_small.pt        # ~46 MB
ls backend/checkpoints/grounding_dino/config.json   # ~172 MB total
ls backend/checkpoints/sam3.1/sam3.1_multiplex.pt   # ~2.4 GB (optional)
ls backend/models/xfeat/weights/xfeat.pt            # ~25 MB
```

If some are missing, download them before creating the ZIP (see section 6).

---

### 3.6 — Create the deployable ZIP

```bash
conda activate IA_env

# ZIP for Windows only (includes offline_windows/, excludes offline_linux/)
python scripts/create_offline_zip.py --platform windows
# Generates: AnnotationApp_offline_windows_YYYYMMDD.zip

# ZIP for Linux only (includes offline_linux/, excludes offline_windows/)
python scripts/create_offline_zip.py --platform linux
# Generates: AnnotationApp_offline_linux_YYYYMMDD.zip

# ZIP with both platforms (offline_windows/ + offline_linux/ included)
python scripts/create_offline_zip.py --platform both
# Generates: AnnotationApp_offline_YYYYMMDD.zip

# Without the models (code + offline/ only, lighter)
python scripts/create_offline_zip.py --platform linux --skip-models

# Dry run without creating the file
python scripts/create_offline_zip.py --platform linux --dry-run
```

The ZIP automatically includes the `offline/`, `offline_windows/` and/or `offline_linux/` folders
depending on the `--platform` flag.

---

## 4. Python environment (TARGET machine)

### Option A — From conda-pack (100% offline)

If `offline/conda/IA_env.tar.gz` is present:

```bash
mkdir C:\miniconda3\envs\IA_env
tar -xzf offline/conda/IA_env.tar.gz -C C:\miniconda3\envs\IA_env
conda activate IA_env
conda-unpack     # fixes absolute paths
```

Check:

```bash
python -c "import torch; print('PyTorch:', torch.__version__); print('CUDA:', torch.cuda.is_available())"
```

### Option B — From conda spec-file + pip wheels

```bash
# 1. Create the env from the spec-file (needs Miniconda on the target)
conda create --name IA_env --file offline/conda/spec-file.txt
conda activate IA_env
```

If the spec-file fails (network URLs), create the env manually and install PyTorch from PyPI:

```bash
conda create -n IA_env python=3.11
conda activate IA_env

# PyTorch -- use the wheel from offline_windows/wheels/ if present
pip install --no-index --find-links offline_windows/wheels/ torch torchvision torchaudio
# OR (if no PyTorch wheel in offline_windows/): install from the internet
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121
```

```bash
# 2. Install all pip dependencies from the local wheels
pip install --no-index --find-links offline_windows/wheels/ -r backend/requirements.txt

# 3. Install SAM2 from the local wheel
pip install --no-index --find-links offline_windows/wheels/ segment_anything_2
# If the wheel is not found:
pip install --find-links offline_windows/wheels/ segment_anything_2
```

### Option C — Standard Windows installation (with internet)

```bash
conda create -n IA_env python=3.11
conda activate IA_env

# PyTorch GPU (CUDA 12.1+)
conda install pytorch torchvision torchaudio pytorch-cuda=12.1 -c pytorch -c nvidia

# SAM2
pip install git+https://github.com/facebookresearch/segment-anything-2.git

# Other dependencies
pip install -r backend/requirements.txt
```

### Option C (Linux) — Offline Linux install from the wheels

```bash
conda create -n IA_env python=3.11
conda activate IA_env

# PyTorch GPU (CUDA 12.1+) from the Linux wheels
pip install --no-index --find-links offline_linux/wheels/ torch torchvision torchaudio
# OR from the internet:
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121

# pip dependencies from offline_linux/wheels/
pip install --no-index --find-links offline_linux/wheels/ -r backend/requirements.txt

# SAM2
pip install --no-index --find-links offline_linux/wheels/ segment_anything_2
```

### Verify the Python installation

```bash
python -c "import backend.main; print('Backend OK')"
python -c "import torch; print('CUDA:', torch.cuda.is_available())"
```

---

## 5. Frontend dependencies (TARGET machine)

### From the offline cache (no internet)

**Windows machine**:

```bash
cd frontend
npm install --prefer-offline --cache ../offline_windows/npm-cache
cd ..
```

**Linux machine**:

```bash
cd frontend
npm install --prefer-offline --cache ../offline_linux/npm-cache
cd ..
```

If the cache is incomplete, npm will try to download the rest. To force 100% offline:

```bash
# Windows
npm install --offline --cache ../offline_windows/npm-cache
# Linux
npm install --offline --cache ../offline_linux/npm-cache
```

### Standard installation (with internet)

```bash
cd frontend
npm install
cd ..
```

### Check the frontend

```bash
cd frontend
npx tsc --noEmit
cd ..
```

---

## 6. AI models

### Expected locations

```
backend/
├── checkpoints/
│   ├── sam2.1_hiera_small.pt          (~46 MB)  — SAM2 small (GPU)
│   ├── sam2.1_hiera_tiny.pt           (~38 MB)  — SAM2 tiny (CPU fallback)
│   ├── grounding_dino/                (~172 MB) — Grounding DINO tiny
│   │   ├── config.json
│   │   ├── model.safetensors
│   │   └── tokenizer.json
│   └── sam3.1/                        (~2.4 GB) — SAM3.1 multiplex (optional)
│       ├── sam3.1_multiplex.pt
│       └── config.json
└── models/
    └── xfeat/                         (~25 MB)  — Fast GPU homography
        ├── modules/xfeat.py
        └── weights/xfeat.pt
```

### Check that the models are present

```bash
ls backend/checkpoints/sam2.1_hiera_small.pt
ls backend/checkpoints/grounding_dino/config.json
ls backend/checkpoints/sam3.1/sam3.1_multiplex.pt   # optional
ls backend/models/xfeat/weights/xfeat.pt
```

### Download the missing models (with internet)

```bash
conda activate IA_env

# Download SAM2 + Grounding DINO (without SAM3.1)
python backend/tests/download_all_models.py --skip-sam3

# With SAM3.1 (gated HuggingFace model -- needs an approved token)
python backend/tests/download_all_models.py --hf-token hf_xxxxxxxxxxxx
```

> SAM3.1 is a "gated" model: accept the terms at
> https://huggingface.co/facebook/sam3.1 then log in with
> `huggingface-cli login` or `--hf-token`.

### XFeat (if missing)

```bash
git clone https://github.com/verlab/accelerated_features backend/models/xfeat
```

If XFeat is missing, the application falls back to SIFT+RANSAC (included in OpenCV).

---

## 7. Offline mode configuration

Create a `.env` file at the project root to block all HuggingFace network access:

```
TRANSFORMERS_OFFLINE=1
HF_DATASETS_OFFLINE=1
HF_HUB_OFFLINE=1
```

Or set the variables before launching uvicorn:

```bash
# Windows CMD:
set TRANSFORMERS_OFFLINE=1 && set HF_HUB_OFFLINE=1

# PowerShell:
$env:TRANSFORMERS_OFFLINE = "1"; $env:HF_HUB_OFFLINE = "1"

# Git Bash:
export TRANSFORMERS_OFFLINE=1 HF_HUB_OFFLINE=1
```

> These variables must be set BEFORE starting uvicorn.

---

## 8. Launching the application

### Terminal 1 — Backend

```bash
conda activate IA_env
cd C:\Apps\Annotation_App
uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
```

If conda is not in the bash PATH:

```bash
/c/Users/<your_name>/miniconda3/envs/IA_env/python.exe -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
```

Backend available at: http://localhost:8000
API docs: http://localhost:8000/docs

### Terminal 2 — Frontend

```bash
cd C:\Apps\Annotation_App\frontend
npm run dev
```

Application available at: http://localhost:5173

### Quick start (3 commands)

```bash
# 1.
conda activate IA_env
# 2. Terminal 1
uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
# 3. Terminal 2
cd frontend && npm run dev
```

---

## 9. Installation verification

### Quick tests via curl

```bash
curl http://localhost:8000/health
curl http://localhost:8000/api/projects
curl http://localhost:8000/api/sam/grounding/status
```

### Detailed Python tests

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
print('Grounding DINO available:', grounding_service.is_available())
"

python -c "
from backend.services.homography_service import homography_service
print('Homography:', 'XFeat' if homography_service._use_xfeat else 'SIFT+RANSAC')
"

python -c "
import torch
print('CUDA:', torch.cuda.is_available())
if torch.cuda.is_available():
    print('GPU:', torch.cuda.get_device_name(0))
    print('VRAM:', round(torch.cuda.get_device_properties(0).total_memory/1e9,1), 'GB')
"
```

### Startup checklist

- [ ] `conda activate IA_env` succeeds
- [ ] `python -m uvicorn backend.main:app --port 8000` starts without error
- [ ] `GET http://localhost:8000/health` returns `{"status": "ok"}`
- [ ] At least `sam2.1_hiera_small.pt` present in `backend/checkpoints/`
- [ ] `ffmpeg -version` works
- [ ] `npm run dev` starts on `:5173`
- [ ] The interface opens with no console error

---

## 10. Troubleshooting

### The backend does not start

**`ModuleNotFoundError: No module named 'sam2'`**

```bash
conda activate IA_env
# From the offline wheels:
pip install --no-index --find-links offline/wheels/ segment_anything_2
# With internet:
pip install git+https://github.com/facebookresearch/segment-anything-2.git
```

**`UnicodeEncodeError` at startup**

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

### The frontend does not start

**`Cannot find module 'vite'`**

```bash
cd frontend
rm -rf node_modules package-lock.json
# Windows:
npm install --prefer-offline --cache ../offline_windows/npm-cache
# Linux:
npm install --prefer-offline --cache ../offline_linux/npm-cache
```

**The frontend starts but does not talk to the backend**

```bash
curl http://localhost:8000/health
# Check vite.config.ts: proxy /api -> http://localhost:8000
```

---

### GPU / CUDA issues

**CUDA Out of Memory**

```bash
set SAM_MODEL_SIZE=tiny
uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
```

**PyTorch does not detect the GPU**

```bash
nvcc --version && nvidia-smi
python -c "import torch; print(torch.__version__, torch.version.cuda)"
# Reinstall PyTorch with the right CUDA version if needed
conda install pytorch torchvision torchaudio pytorch-cuda=12.1 -c pytorch -c nvidia
```

---

### Grounding DINO not available

```bash
ls backend/checkpoints/grounding_dino/
python -c "import transformers; print(transformers.__version__)"
pip install --no-index --find-links offline/wheels/ transformers
```

---

### Video import fails (`ffmpeg not found`)

```bash
ffmpeg -version
conda activate IA_env && conda install -c conda-forge ffmpeg
```

---

### Slow performance on CPU

- SAM2 automatically uses the `tiny` model
- Grounding DINO: ~5-15 seconds per image
- XFeat replaced by SIFT+RANSAC (pure OpenCV)

```bash
uvicorn backend.main:app --host 0.0.0.0 --port 8000 --workers 1
```

---

## Important notes

1. **Single worker** -- Never run uvicorn with `--workers > 1` (SQLite is multi-process unsafe).

2. **Data backup** -- Back up `data/annotation.db` and `data/projects/`
   regularly.

3. **Reset the database** -- Deleting `data/annotation.db` recreates it automatically
   (all annotations are lost).

4. **Development mode** -- The `--reload` flag is meant for development. In production,
   remove it.

5. **Offline variables** -- Always set `TRANSFORMERS_OFFLINE=1` and `HF_HUB_OFFLINE=1`
   on the target machine to avoid HuggingFace connection attempts at startup.
