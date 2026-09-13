# Deploiement

Packaging et deploiement air-gap du tracker vendore (`tracker/`) vers une cible
x86_64 avec GPU NVIDIA recent sous Ubuntu 22.04, sans connexion internet sur la
cible. Deux chemins independants (conteneur ou zip standalone), une section
reseau commune aux scenarios distribues, et un guide de build depuis Windows via
WSL.

Scripts source : `tracker/deploy/conteneur/` et `tracker/deploy/natif/`. Ces
scripts s'executent depuis la racine du tracker vendore (`tracker/`), pas depuis
la racine de l'app.

---

## Vue d'ensemble : conteneur vs natif

| | Conteneur (`deploy/conteneur/`) | Natif (`deploy/natif/`) |
|---|---|---|
| Format transfere | image OCI `.tar` (podman save) | zip standalone (env conda-pack) |
| Prerequis cible | driver NVIDIA + podman + nvidia-container-toolkit | driver NVIDIA seulement |
| Isolation | image OCI | env conda-pack relocatable |
| Taille typique | ~9-10 Go (image) + ~0.5-1 Go (bundle hote) | ~4-5 Go |
| Modifier sans rebuild | bind mount (`-v`) ou `podman commit` offline | remplacer un fichier dans `visionnexus_inference/` |
| Quand choisir | cible avec podman deja prevu, isolation OCI complete | cible plus simple, rien a installer que le driver |

Les deux ciblent **x86_64 uniquement** (plus de chemin Jetson/arm64 dans la boucle
de deploiement) : pas de cross-build, pas de QEMU.

---

## Partie 1 - Chemin conteneur (Podman)

**Objectif :** empaqueter le tracker + toutes ses dependances (code + modeles)
dans une image OCI, l'exporter en `.tar`, la transferer physiquement (cle USB,
disque externe), puis la charger et l'executer sur une machine x86_64 **qui ne
sera jamais connectee a internet**.

### 1.0 Les scripts en un coup d'oeil

| Script | Ou l'executer | Besoin internet | Ce qu'il fait |
|---|---|---|---|
| `deploy/conteneur/fetch_target_host_deps.sh` | Machine de BUILD | Oui | Telecharge en `.deb` tout ce que l'**hote** de la cible doit avoir (driver NVIDIA, podman, nvidia-container-toolkit) -> bundle pour cle USB |
| `deploy/conteneur/build_and_export_image.sh` | Machine de BUILD | Oui | `podman build` (code + modeles inclus) + `podman save` + sha256 -> `.tar` pour cle USB |
| `deploy/conteneur/install_target_host_deps.sh` | Machine CIBLE | **Non** | Installe le bundle ci-dessus, genere la config CDI |
| `deploy/conteneur/patch_image_offline.sh` | Machine CIBLE (ou build) | **Non** | Modifie une image deja chargee (config/modele/code) sans rebuild -- voir 1.9 |

La cible ne voit jamais internet : les deux premiers scripts tournent **avant** le
jour J, sur la machine de build (qui a deja internet + podman). Tout part ensuite
sur la meme cle USB.

```
Machine de BUILD (internet, x86_64)              Cle USB               Machine CIBLE (air-gap, x86_64, GPU NVIDIA)
+------------------------------------+                              +------------------------------------+
| fetch_target_host_deps.sh           |  target_host_bundle.tar.gz   | install_target_host_deps.sh         |
|  -> driver/podman/toolkit en .deb   | ----------------------------> |  -> installe l'hote, config CDI     |
|                                      |                              |                                      |
| build_and_export_image.sh           |  visionnexus_inference_latest.tar          | podman load -i visionnexus_inference_latest.tar   |
|  -> image avec code + modeles       | ----------------------------> | podman run --device nvidia.com/...  |
+------------------------------------+                              +------------------------------------+
```

### 1.1 Prerequis - machine de BUILD (x86_64, internet OK)

```bash
sudo apt install podman
podman version
```
Rien d'autre : CUDA, Python et les dependances embarquees viennent de l'image de
base et de `requirements.txt`.

### 1.2 Prerequis - machine CIBLE (a preparer AVANT que la cle parte)

La cible a besoin de 3 composants sur l'**hote** (pas dans le conteneur) : driver
NVIDIA, podman, nvidia-container-toolkit. Comme elle n'aura jamais internet, ces
paquets sont telecharges **ailleurs** puis installes offline.

**Point critique : correspondance du noyau.** Le module noyau NVIDIA (DKMS) est
compile pour un `uname -r` precis. La machine sur laquelle vous lancez
`fetch_target_host_deps.sh` doit tourner **la meme version d'Ubuntu et,
idealement, le meme noyau** que la cible -- sinon `linux-headers-$(uname -r)`
telecharge ne correspondra pas a la cible et le driver ne se construira pas
dessus.

```bash
# Sur la cible, avant de la sortir du reseau (ou depuis sa fiche d'install initiale) :
uname -r
lsb_release -a
```
Comparez avec la machine de build. Si elles divergent, faites tourner
`fetch_target_host_deps.sh` dans une VM/conteneur qui reproduit exactement l'OS
de la cible plutot que sur la machine de build elle-meme.

**Recuperer le bundle** (machine de build, avec internet) :
```bash
DRIVER_VERSION=535 ./deploy/conteneur/fetch_target_host_deps.sh
```
Produit `deploy/conteneur/dist/target_host_bundle.tar.gz` (+ `.sha256`) contenant
`nvidia-driver-535` + `linux-headers-$(uname -r)` + `dkms` + `build-essential`,
`podman`, `nvidia-container-toolkit` (+ dependances). `DRIVER_VERSION=535` est
compatible CUDA 12.1 (utilise par l'image, voir 1.3). Ajustez si
`ubuntu-drivers devices` recommande une autre branche sur la cible.

**Installer sur la cible (offline)** :
```bash
tar xzf target_host_bundle.tar.gz
sudo ./install_target_host_deps.sh ./target_host_bundle
```
Le script installe les `.deb` (`apt install ./*.deb`, resout les dependances
localement sans reseau), verifie `nvidia-smi`, puis genere la config CDI
(`nvidia-ctk cdi generate`). Si le driver vient d'etre installe, un `reboot` est
necessaire avant que `nvidia-smi` fonctionne -- relancez le script apres reboot.

### 1.3 Containerfile - modeles et code inclus

`deploy/conteneur/Containerfile` (build context = racine du tracker, voir 1.4) :

- Base `nvcr.io/nvidia/cuda:12.1.1-cudnn8-runtime-ubuntu22.04` -- alignee sur
  `requirements.txt` (CUDA 12.1 / cuDNN 8.9.7 / torch 2.5.1+cu121).
- Python 3.10 (= python3 par defaut sur Ubuntu 22.04, pas besoin de PPA).
- `torch`/`torchvision` installes en premier avec `--extra-index-url
  https://download.pytorch.org/whl/cu121` (sinon pip prend la roue CPU) puis le
  reste de `requirements.txt`.
- `build-essential` + `python3.10-dev` pour compiler `cython_bbox` (BoT-SORT).
- `libgtk-3-0` + libs X11/GL : `opencv-contrib-python` (pas la variante headless)
  est utilise avec `cv2.imshow` dans `pipeline/session.py`, `utils/visualizer.py`,
  `tools/receiver/mjpeg_receiver.py` -> il faut un backend GUI.
- `COPY . /app/` embarque le code, `config_examples/`, `weights/last.pt` (poids
  YOLO, ~50 Mo), `optional_format_adapter/` (vendored) et les trackers tiers (`trackers/`, ~270 Mo).

**Exclusions volontaires** (`.containerignore` a la racine) : `data/sequences`,
`data/rejeu`, `outputs/` (~600 Mo de runs precedents) sont exclus de l'image (ce
sont des donnees de test/sortie, pas des dependances de l'application, elles se
montent a l'execution -- 1.7). `.git`, `__pycache__` exclus aussi.

Les **modeles restent dans l'image** (`weights/`, poids ReID sous
`trackers/mot/boosttrack/BoostTrack/external/weights/` s'ils sont presents dans
le repo au moment du build) -- une seule image autosuffisante a transferer, sans
dependre d'un montage separe pour les poids.

**TensorRT (optionnel)** : si vous exportez des moteurs `.engine` (accelere
YOLO), ajoutez apres l'install CUDA :
```dockerfile
RUN pip install --no-cache-dir tensorrt==8.6.1 --extra-index-url https://pypi.nvidia.com
```
(version alignee sur le commentaire `TensorRT 8.6.1 LTS` de `requirements.txt`).

### 1.4 Build de l'image

```bash
# Depuis la racine du tracker, sur la machine de build (x86_64, internet)
./deploy/conteneur/build_and_export_image.sh
# ou un tag precis :
./deploy/conteneur/build_and_export_image.sh v1.2

podman images visionnexus_inference
```
Equivalent manuel : `podman build -t visionnexus_inference:latest -f deploy/conteneur/Containerfile .`
(notez `-f deploy/conteneur/Containerfile` : le Containerfile est dans
`deploy/conteneur/` mais le contexte de build reste la racine du tracker, car
`COPY . /app/` a besoin de tout voir).

### 1.5 Export + transfert

`build_and_export_image.sh` fait deja `podman save` + `sha256sum` ->
`deploy/conteneur/dist/visionnexus_inference_<tag>.tar` (+ `.sha256`).

Compression optionnelle :
```bash
zstd -T0 deploy/conteneur/dist/visionnexus_inference_latest.tar   # -> visionnexus_inference_latest.tar.zst, ~2x plus petit
```

Copier sur la cle USB **les deux bundles ET les scripts eux-memes** (les scripts
d'installation ne sont pas embarques dans les archives, ils doivent voyager a
cote) :
```bash
cp deploy/conteneur/dist/visionnexus_inference_latest.tar*        /media/usb/
cp deploy/conteneur/dist/target_host_bundle.tar.gz* /media/usb/
cp deploy/conteneur/install_target_host_deps.sh     /media/usb/
cp deploy/conteneur/patch_image_offline.sh          /media/usb/   # optionnel, voir 1.9.2
```

> **Taille typique :** image ~9-10 Go (CUDA+cuDNN base ~5 Go, torch cu121 ~3 Go,
> weights + code ~350 Mo). Bundle hote (driver+podman+toolkit) ~500 Mo-1 Go.
> Prevoir une cle/disque >= 32 Go.

### 1.6 Chargement sur la machine cible

```bash
sha256sum -c visionnexus_inference_latest.tar.sha256
podman load -i visionnexus_inference_latest.tar
podman images   # -> visionnexus_inference   latest   <id>   ...   ~9-10 GB
```

### 1.7 Lancement avec GPU

**Commande de base** (config au choix, montee par-dessus celle incluse) :
```bash
podman run --rm \
    --device nvidia.com/gpu=all \
    -v /chemin/sequences:/app/data/sequences:ro \
    -v /chemin/outputs:/app/outputs:rw \
    visionnexus_inference:latest \
    --config config_examples/B_mot_sot_command.yaml
```

**Mode headless** (production, sans affichage) :
```bash
podman run --rm \
    --device nvidia.com/gpu=all \
    -v $(pwd)/data/sequences:/app/data/sequences:ro \
    -v $(pwd)/outputs:/app/outputs:rw \
    visionnexus_inference:latest \
    --config config_examples/F2_zmq_single_csv_headless.yaml
```

**Mode interactif avec affichage local** (cv2.imshow / X11) :
```bash
xhost +local:podman

podman run --rm \
    --device nvidia.com/gpu=all \
    -e DISPLAY=$DISPLAY \
    -v /tmp/.X11-unix:/tmp/.X11-unix:rw \
    -v $(pwd)/data/sequences:/app/data/sequences:ro \
    -v $(pwd)/outputs:/app/outputs:rw \
    visionnexus_inference:latest \
    --config config_examples/10_mot_sot_interactive.yaml
```

**Acces reseau ZMQ** (capteur C++ externe) :
```bash
podman run --rm \
    --device nvidia.com/gpu=all \
    --network host \
    -v $(pwd)/outputs:/app/outputs:rw \
    visionnexus_inference:latest \
    --config config_examples/F_zmq_single_csv_interactive.yaml
```
`--network host` expose directement les ports ZMQ sans NAT.

### 1.8 Verification GPU dans le conteneur

```bash
podman run --rm --device nvidia.com/gpu=all visionnexus_inference:latest \
    python3 -c "import torch; print(torch.cuda.is_available(), torch.cuda.get_device_name(0))"
# -> True   NVIDIA <modele du GPU> ...
```

### 1.9 Modifier ou ajouter des choses sans tout rebuild

Deux cas, deux methodes -- a choisir selon si le changement doit etre
**temporaire / par lancement** ou **permanent dans l'image**.

**1.9.1 Cas courant : config, sequences, poids -- bind mount.** Methode par
defaut, zero manipulation d'image, entierement offline. Tout ce qui est dans
l'image peut etre ecrase au `podman run` avec `-v` :
```bash
# Changer le scenario / la config sans toucher a l'image
podman run --rm --device nvidia.com/gpu=all \
    -v /media/usb/nouveau_scenario.yaml:/app/config_examples/B_mot_sot_command.yaml:ro \
    -v $(pwd)/outputs:/app/outputs:rw \
    visionnexus_inference:latest --config config_examples/B_mot_sot_command.yaml

# Remplacer les poids YOLO sans rebuild
podman run --rm --device nvidia.com/gpu=all \
    -v /media/usb/last_v2.pt:/app/weights/last.pt:ro \
    visionnexus_inference:latest --config config_examples/B_mot_sot_command.yaml
```
Suffisant pour : nouvelle config YAML, nouveaux poids `.pt`/`.onnx`/`.engine`,
nouvelles sequences de test. Rien a reinstaller sur la cible.

**1.9.2 Cas permanent : figer le changement -- `podman commit`.** Si le
changement doit etre dans l'image elle-meme (deployer une version "patchee" avec
une config par defaut differente, sans dependre d'un montage a chaque
lancement), utiliser `deploy/conteneur/patch_image_offline.sh`. Il fait `podman
create` -> `podman cp` -> `podman commit`, entierement offline sur la cible, sans
passer par un rebuild complet (pas de reinstall pip, pas besoin du repo source) :
```bash
./deploy/conteneur/patch_image_offline.sh visionnexus_inference:latest visionnexus_inference:patched \
    ./B_mot_sot_command.yaml:/app/config_examples/B_mot_sot_command.yaml \
    ./last_v2.pt:/app/weights/last.pt

podman run --rm --device nvidia.com/gpu=all visionnexus_inference:patched \
    --config config_examples/B_mot_sot_command.yaml
```
Fonctionne pour n'importe quel fichier : config, poids, ou meme un fichier `.py`
modifie (ex. un correctif dans `pipeline/session.py`).

**1.9.3 Quand un vrai rebuild est necessaire.** Seulement si vous changez une
**dependance Python** (nouvelle lib dans `requirements.txt`) ou un paquet
**systeme** (apt) -- ca touche des layers profonds que `podman cp` ne peut pas
modifier proprement. Retour a la machine de build (1.4), donc prevoir
l'aller-retour USB.

### 1.10 Depannage courant

| Symptome | Cause probable | Solution |
|---|---|---|
| `Error: no CDI devices with name nvidia.com/gpu=all` | toolkit CDI pas genere | `sudo nvidia-ctk cdi generate --output=/etc/cdi/nvidia.yaml` |
| `CUDA not available` dans Python | Driver hote absent, vieux, ou pas reboote apres install | `nvidia-smi` sur l'hote ; si echec juste apres install, `sudo reboot` |
| `dpkg`/`apt install ./*.deb` echoue sur une dependance manquante | bundle `fetch_target_host_deps.sh` incomplet (souvent : noyau different de la cible) | Regenerer le bundle sur une machine avec le meme `uname -r`/Ubuntu que la cible |
| Image refuse de se charger | Architecture mismatch (l'image a ete buildee pour arm64) | Verifier que le build a bien tourne sur x86_64 (`podman build` sans `--platform`) |
| OpenCV `cannot open display` | Mode interactif sans X11 passe au conteneur | Ajouter `-e DISPLAY` + `-v /tmp/.X11-unix` (1.7) ou repasser en config headless/mjpeg |
| `Permission denied /dev/nvidia*` | Podman rootless sans CDI | Utiliser `--device nvidia.com/gpu=all` (CDI), pas `/dev/nvidia0` |
| `libGL.so.1 not found` | Base image sans libs GL alors que `cv2.imshow` est utilise | Verifier que `libgl1`/`libgtk-3-0` sont bien dans le Containerfile (1.3) |

### 1.11 Cheat-sheet conteneur

```bash
# -- AVANT (machine de BUILD, internet, une seule fois) --
DRIVER_VERSION=535 ./deploy/conteneur/fetch_target_host_deps.sh   # bundle hote cible
./deploy/conteneur/build_and_export_image.sh                      # image (code+modeles)
# -> copier deploy/conteneur/dist/*.tar* + deploy/conteneur/dist/target_host_bundle.tar.gz* sur USB

# -- CIBLE (air-gap, une seule fois) --
sudo ./install_target_host_deps.sh ./target_host_bundle  # driver+podman+CDI
sha256sum -c visionnexus_inference_latest.tar.sha256
podman load -i visionnexus_inference_latest.tar

# -- CIBLE (a chaque run) --
podman run --rm --device nvidia.com/gpu=all \
    -v ./data/sequences:/app/data/sequences:ro \
    -v ./outputs:/app/outputs:rw \
    visionnexus_inference:latest --config config_examples/B_mot_sot_command.yaml

# test GPU
podman run --rm --device nvidia.com/gpu=all visionnexus_inference:latest \
    python3 -c "import torch; print(torch.cuda.is_available())"

# modifier config/poids sans rebuild (bind mount, 1.9.1) ou
# ./deploy/conteneur/patch_image_offline.sh visionnexus_inference:latest visionnexus_inference:patched fichier:chemin (1.9.2)
```

---

## Partie 2 - Chemin natif (zip standalone)

**Contexte :** cible x86_64 Ubuntu 22.04, driver NVIDIA deja installe
(`nvidia-smi` marche), jamais d'internet. Objectif : **un seul fichier**
`visionnexus_inference_export_standalone.zip` contenant le code **et** un environnement Python
**deja construit** (Python, torch, TensorRT, toutes les libs). Sur la cible :
`unzip`, `install`, `run` -- aucun `apt`, aucun venv a construire, aucune
compilation, zero internet.

Alternative au chemin conteneur (Partie 1) : plus leger cote cible (pas de
podman/CDI), mais l'isolation vient de l'env conda-pack plutot que d'une image
OCI. Scripts dans `deploy/natif/`.

### 2.0 Vue d'ensemble

| Script | Ou l'executer | Besoin internet | Ce qu'il fait |
|---|---|---|---|
| `deploy/natif/build_standalone_zip.sh` | Machine de BUILD | Oui | Bootstrappe Miniforge, cree l'env (torch cu121 + `requirements.txt` + TensorRT), `conda-pack`, ajoute le code (`export_zip.py`) -> produit `visionnexus_inference_export_standalone.zip` |
| `standalone_install.sh` (dans le zip) | Machine CIBLE | **Non** | Dezippe `env/` + `conda-unpack` (reecrit les chemins) |
| `standalone_run.sh` (dans le zip, -> `run.sh`) | Machine CIBLE | **Non** | Active l'env, cable `LD_LIBRARY_PATH`, lance `main.py` |

```
Machine de BUILD (internet, Ubuntu 22.04 x86_64)         Cle USB                    Machine CIBLE (air-gap, driver OK)
+---------------------------------------------+                                     +--------------------------------+
| build_standalone_zip.sh                      |  visionnexus_inference_export_standalone.zip      | unzip                          |
|  Miniforge -> env -> conda-pack -> + code     | ------------------------------------> | ./install_standalone.sh        |
|  = 1 zip auto-suffisant                       |                                     | ./run.sh --config ...           |
+---------------------------------------------+                                     +--------------------------------+
```

L'env est **relocatable** grace a [`conda-pack`](https://conda.github.io/conda-pack/) :
tout l'env conda (Python + stdlib + libs + libs CUDA userspace des wheels pip) est
empaquete ; `conda-unpack` reecrit les chemins absolus a l'endroit reel
d'extraction sur la cible.

### 2.1 Pourquoi ce mode (et pas un simple pip install sur la cible)

- **La cible n'a pas internet et on ne veut rien compiler dessus.** `cython_bbox`
  / `lap` n'ont pas toujours de wheel prete ; les compiler sur la cible
  imposerait `build-essential`/`python3.10-dev`. Ici on compile **une fois sur le
  build**, et l'env packe contient deja les binaires.
- **Python est fourni dans l'env.** Pas besoin d'installer `python3.10` en `.deb`
  sur la cible : conda-pack embarque l'interpreteur et sa stdlib (contrairement a
  un `venv` classique qui depend du Python systeme).
- **CUDA userspace embarque, pas le driver.** Les libs CUDA/cuDNN/TensorRT
  viennent des wheels pip (`nvidia-*`, `tensorrt`, `torch/lib`). `run.sh` les met
  en tete de `LD_LIBRARY_PATH` -> l'env n'exige que le **driver** NVIDIA. La CUDA
  systeme de la cible n'est donc pas indispensable (mais ne gene pas).

### 2.2 Ce que contient le zip

```
visionnexus_inference_export_standalone/
+-- visionnexus_inference/                 # le code (memes exclusions que export_zip.py :
|                             #  tout sauf outputs/, data/sequences/, quality/logs/ vides ;
|                             #  le code de data/rejeu, data/network, data/zmq est CONSERVE)
+-- env.tar.gz                # env Python 3.10 relocatable (conda-pack) :
|                             #  torch 2.5.1+cu121, requirements.txt, tensorrt 8.6.1
+-- install_standalone.sh    # 1 fois : extrait env/ + conda-unpack
+-- run.sh                    # active l'env + LD_LIBRARY_PATH + main.py
+-- deployment.md              # ce document (copie pour reference hors ligne)
+-- README_STANDALONE.txt     # guide court cote cible + chemins a verifier/changer
```

### 2.3 Build (machine Ubuntu, internet, une seule fois)

Idealement **Ubuntu 22.04 x86_64** (glibc alignee sur la cible). Sur une autre
version, le script **previent** : un glibc de build plus recent que la cible peut
casser a l'execution -- dans ce cas, builder dans un conteneur `ubuntu:22.04`.
Rien a pre-installer : **Miniforge est bootstrappe automatiquement**.

```bash
# Depuis la racine du tracker
./deploy/natif/build_standalone_zip.sh
```

> **Pas de machine Linux ?** Le how-to complet depuis Windows via WSL2 (Partie 4)
> couvre installation, copie du projet, build, recuperation du zip, nettoyage, et
> le cas d'une cible non-22.04.

Le script, dans l'ordre : bootstrap Miniforge (telecharge l'installeur, aucune
conda prealable requise) ; cree un env `python=3.10` isole ; `pip install
torch==2.5.1 torchvision==0.20.1` (cu121) + `requirements.txt` ; `pip install
tensorrt==8.6.1` (export `.engine` -- libs dans le wheel) ; `conda-pack` ->
`env.tar.gz` relocatable ; ajoute `visionnexus_inference/` (via `export_zip.py --nozip`) +
`run.sh`/`install` + cette doc + README, puis compresse en
`deploy/natif/dist/visionnexus_inference_export_standalone.zip` (+ `.sha256`).

Variables optionnelles : `TORCH_VERSION`, `TORCHVISION_VERSION`,
`TENSORRT_VERSION` (mettre `""` pour ne pas embarquer TensorRT),
`PYTHON_VERSION`.

> **Taille typique :** ~4-5 Go (torch cu121 + TensorRT dominent). Plus lourd que
> transferer juste le code, mais rien a installer cote cible.

### 2.4 Copier sur la cle USB

```bash
cp deploy/natif/dist/visionnexus_inference_export_standalone.zip*  /media/usb/
```
Un seul fichier (+ son `.sha256`). Les scripts et la doc voyagent **dans** le zip.

### 2.5 Cible (offline, une seule fois)

```bash
sha256sum -c visionnexus_inference_export_standalone.zip.sha256
unzip visionnexus_inference_export_standalone.zip
cd visionnexus_inference_export_standalone
./install_standalone.sh     # verifie nvidia-smi, extrait env/, conda-unpack
```

### 2.6 Lancer

```bash
./run.sh --config config_examples/B_mot_sot_command.yaml
```
Equivalent manuel :
```bash
source env/bin/activate
cd visionnexus_inference
python main.py --config config_examples/B_mot_sot_command.yaml
```

### 2.7 Chemins a verifier / changer sur la cible

Dans le cas nominal (Ubuntu 22.04, driver OK, extraction dans le dossier
dezippe) **il n'y a rien a changer**. Les points ci-dessous ne concernent que les
cas particuliers. Tout est relatif au dossier `visionnexus_inference_export_standalone/`
(note `.`).

| Element | Chemin par defaut | Quand / pourquoi le changer |
|---|---|---|
| Environnement Python | `./env/` | Cree par `install_standalone.sh`. Si tu deplaces le dossier **apres** l'install, relance `./install_standalone.sh` (conda-unpack refixe les chemins). |
| Libs CUDA de l'env | `./env/lib/python3.10/site-packages/{nvidia/*/lib, tensorrt_libs, torch/lib}` | Auto-ajoutees a `LD_LIBRARY_PATH` par `run.sh`. Rien a faire. |
| CUDA systeme (drive cible) | `/usr/local/cuda*` (toolkit) | **Non requis** : l'env est autonome. Ne l'ajoute a `run.sh` que si un module tiers reclame une lib absente de l'env. |
| Config lancee | `./visionnexus_inference/config_examples/*.yaml` | Passe une autre config via `--config`, ou edite/remplace le YAML directement (pas de rebuild). |
| Poids YOLO | `./visionnexus_inference/weights/last.pt` | Remplace le fichier pour changer de modele. |
| Poids ReID | `./visionnexus_inference/trackers/mot/boosttrack/BoostTrack/external/weights/` | Idem si presents. |
| Sequences / entrees | definies dans le YAML de config | `data/sequences/` est **videe** dans le zip : monte/copie tes sequences et pointe le chemin dans la config. |
| Sorties | `./visionnexus_inference/outputs/` (vide au depart) | Cree au runtime. Verifie les droits d'ecriture. |

**Si tu dois pointer sur une CUDA/TensorRT du drive** (rare -- seulement si un
module tiers charge une lib systeme), edite `run.sh` et ajoute avant la ligne
`exec` :
```bash
export LD_LIBRARY_PATH="/chemin/vers/cuda/lib64:${LD_LIBRARY_PATH}"
```

### 2.8 Export TensorRT sur la cible

`tensorrt` est dans l'env et ses libs (`tensorrt_libs`) sont sur
`LD_LIBRARY_PATH` via `run.sh`. L'export d'un moteur `.engine` YOLO tourne donc
**offline** sans rien de plus :
```bash
source env/bin/activate && cd visionnexus_inference
# ex. via l'API/CLI Ultralytics deja presente dans l'env
```

### 2.9 Modifier apres coup (sans tout refaire)

- **Config / poids / sequences / code `.py`** : remplace le fichier dans
  `visionnexus_inference/`. Aucun rebuild (Python interprete). Voir 2.7 pour les chemins.
- **Nouvelle dependance pip / version TensorRT differente** : refaire le build
  sur la machine Ubuntu (`build_standalone_zip.sh`) et retransferer le zip --
  l'env est fige une fois packe.

### 2.10 Depannage courant

| Symptome | Cause probable | Solution |
|---|---|---|
| `version 'GLIBC_2.xx' not found` au lancement | env buildee sur une Ubuntu plus recente que la cible | Rebuilder sur / dans un conteneur `ubuntu:22.04` |
| `libcuda.so.1 not found` | driver NVIDIA absent sur la cible | Installer le driver (Partie 1), `nvidia-smi` doit marcher |
| `onnxruntime` : erreur de chargement cuDNN | lance sans `run.sh`, `LD_LIBRARY_PATH` non peuple | Toujours passer par `./run.sh` (pas `python main.py` en direct) |
| `conda-unpack: command not found` | `install_standalone.sh` non lance / env pas extrait | Relancer `./install_standalone.sh` |
| Chemins conda casses apres avoir deplace le dossier | conda-unpack fixe les chemins a l'emplacement au moment de l'install | Relancer `./install_standalone.sh` depuis le nouvel emplacement |
| `torch.cuda.is_available()` = False | driver casse/non reboote | `nvidia-smi` d'abord |

### 2.11 Cheat-sheet natif

```bash
# -- BUILD (Ubuntu 22.04, internet, une seule fois) --
./deploy/natif/build_standalone_zip.sh
# -> copier deploy/natif/dist/visionnexus_inference_export_standalone.zip* sur USB

# -- CIBLE (air-gap) --
unzip visionnexus_inference_export_standalone.zip && cd visionnexus_inference_export_standalone
./install_standalone.sh
./run.sh --config config_examples/B_mot_sot_command.yaml
```

---

## Partie 3 - Reseau : flux sortant et entrant (HTTP MJPEG)

Le pipeline supporte plusieurs topologies reseau, activables independamment ou
combinees, utilisees a la fois pour le deploiement embarque (Jetson historique)
et pour les scenarios distribues PC hote / noeud de calcul / PC operateur (voir
[`architecture.md`](architecture.md#lancer-en-cli-standalone-hors-app-web)).
Les scripts sender/receiver sont **autonomes** (aucune dependance projet) :
`pip install opencv-python numpy requests` suffit.

```
SCENARIO E1 - Flux ENTRANT + affichage local
  PC hote (frame_sender.py)  --MJPEG-->  Ce PC (pipeline + cv2)
  tools/sender/frame_sender.py           Source : MP4/format specialise/images sur le PC hote.

SCENARIO E2 - Donnees locales + flux SORTANT
  Ce PC (pipeline, lit format specialise/MP4)  --MJPEG-->  PC operateur
                                  frames annotees    mjpeg_receiver
                                 <-- POST /click /key --
  tools/receiver/mjpeg_receiver.py

SCENARIO E3 - Pipeline distribue complet (Jetson)
  PC hote                 Jetson                    PC operateur
  frame_sender.py -->    pipeline MOT+SOT  -->     mjpeg_receiver.py
  port 9090 (entree)     NetworkFrameReader         port 8080
                         MJPEGServer        <---- POST /click /key
  tools/sender/          E_distributed_pc_jetson.yaml
                                             tools/receiver/
```

> **Fix important** : `MJPEGServer` utilise `ThreadingHTTPServer` (au lieu de
> `HTTPServer` mono-thread), ce qui garantit que les POST `/click` sont traites
> en temps reel PENDANT que le GET `/stream` est ouvert -- sans quoi les clics
> s'accumulaient dans le backlog TCP jusqu'a la deconnexion du client.

### 3.1 Pourquoi le streaming plutot que l'affichage local

| Config | FPS Jetson |
|--------|------------|
| `local_display: true` (cv2.imshow X11) | ~5 fps |
| `local_display: false` + `stream_mode: mjpeg` | ~43 fps |
| `local_display: false` + `stream_mode: none` | ~45 fps |

`cv2.imshow` passe par X11/Xorg -> copie chaque frame via le bus memoire unifie
CPU/GPU, deja sature par YOLO + Tracking_TOPHAT -> ~180 ms/frame. L'encode JPEG CPU coute
~1-2 ms, le transit Ethernet ~0.5 ms.

### 3.2 Configuration reseau -- prerequis communs

**IP statique sur la Jetson (interface `enP8p1s0`)** :
```bash
ip link show enP8p1s0   # verifier que le cable est connecte

# Temporaire (perdu au reboot)
sudo ip addr add 192.168.100.10/24 dev enP8p1s0

# Permanent via NetworkManager
sudo nmcli connection add type ethernet ifname enP8p1s0 \
     con-name "eth-stream" \
     ipv4.method manual \
     ipv4.addresses 192.168.100.10/24 \
     ipv4.gateway "" \
     connection.autoconnect yes
sudo nmcli connection up eth-stream

ip addr show enP8p1s0   # verification -> inet 192.168.100.10/24
```

**IP statique sur le PC.** Windows (PowerShell admin) :
```powershell
Get-NetAdapter                                      # trouver le nom de la carte
New-NetIPAddress -InterfaceAlias "Ethernet" -IPAddress 192.168.100.50 -PrefixLength 24
```
Linux :
```bash
sudo ip addr add 192.168.100.50/24 dev eth0
```

**Test de connectivite** :
```bash
ping 192.168.100.10    # -> doit repondre
```
> Windows peut bloquer ICMP sans bloquer HTTP. Le ping sert de confirmation ; le
> stream fonctionne meme si le ping echoue (verifier le pare-feu si besoin).

### 3.3 Mode 1 - Flux sortant : pipeline -> PC operateur

```
Jetson Orin Nano                              PC operateur
pipeline (main.py)  ~43 fps                   navigateur / VLC / Python
  -> Visualizer.render(canvas)
       -> MJPEGServer.push(frame)  ----->    GET http://192.168.100.10:8080/
            +- thread encodage                multipart/x-mixed-replace
            |   cv2.imencode(".jpg") ~1-2ms   boundary=mjpeg_boundary
            +- thread HTTP                    chaque JPEG livre des encode

                <-- POST /click {x, y, button}  -- mjpeg_receiver.py
                <-- POST /key   {key: "m"|"r"|"q"}
```

YAML (`config_examples/distributed_pc_jetson.yaml`) :
```yaml
local_display:  false     # ZERO X11 - economise ~180 ms/frame
stream_mode:    "mjpeg"
stream_host:    "0.0.0.0" # toutes interfaces
stream_port:    8080
stream_quality: 70        # qualite JPEG (0-100)
stream_every:   2         # 1 frame sur N envoyee -> ~22 fps display a 43 fps pipeline
```

**Etapes** :
```bash
# 1. Lancer le pipeline
python main.py --config config_examples/distributed_pc_jetson.yaml
```

| Methode de connexion PC | Commande / URL |
|---------|---------------|
| Script Python (recommande) | `python tools/mjpeg_receiver.py --host 192.168.100.10` |
| Navigateur | `http://192.168.100.10:8080/` |
| VLC | Media -> Ouvrir un flux -> `http://192.168.100.10:8080/stream` |
| Snapshot debug | `http://192.168.100.10:8080/snapshot` |

**Back-channel (clics et touches)** : `mjpeg_receiver.py` et le navigateur
envoient automatiquement les clics via `POST /click`. Bouton gauche -> SOT cible
1 (magenta) ; bouton droit -> SOT cible 2 (orange, si `n_targets: 2`). Touche `M`
-> bascule `mot_background` a chaud. Touche `R` -> toggle enregistrement clics.
Touche `Q` -> arret pipeline.

**Test sans pipeline** (verification reseau seule) :
```bash
python tools/test_stream.py
# -> ouvrir http://192.168.100.10:8080/ depuis le PC
```

Fichiers concernes : `utils/stream_server.py` (`MJPEGServer` :
`ThreadingHTTPServer` + encodage + POST /click /key), `utils/visualizer.py`
(integre `MJPEGServer` dans `render()`/`close()`), `pipeline/builders.py` (lit
les cles `stream_*` du YAML), `tools/mjpeg_receiver.py` (client PC, version
projet), `tools/receiver/mjpeg_receiver.py` (**autonome**), `tools/test_stream.py`
(serveur de test sans pipeline).

### 3.4 Mode 2 - Flux entrant : PC hote -> pipeline

Dans le scenario distribue, la video source (fichier MP4, format specialise, camera externe)
est disponible sur un **PC hote** et non sur la machine de calcul. Le PC envoie
les frames brutes via HTTP MJPEG -> la machine de calcul traite normalement (MOT
+ SOT) sans meme savoir que la video vient du reseau.

```
PC hote                                    Jetson Orin Nano
tools/frame_sender.py                      pipeline (main.py)
  +- lit video.mp4 ou dossier              +- data/network_reader.py
       +- FPS regule                            +- NetworkFrameReader
       +- MJPEGServer(port=9090)  ----->            GET http://PC:9090/stream
            cv2.imencode(".jpg")                     thread MJPEG continu
            ~1.5 ms/frame                            _frame_queue (circulaire)
                                                 +- _NetworkLoaderWrapper
                                                      -> interface SequenceLoader
                                           pipeline.update(frame, ...)
```

**Latence ajoutee** :

| Etape | Temps |
|-------|-------|
| encode JPEG PC (q=90) | ~1.5 ms |
| transit TCP LAN Gbit | ~0.5 ms |
| decode JPEG Jetson | ~1.0 ms |
| **Total** | **~3 ms/frame** |

Imperceptible a 10 fps (interval = 100 ms).

YAML (`sequence_dir` = URL HTTP) :
```yaml
sequence_dir: "http://192.168.100.50:9090/stream"

# CMC : pas de LDV depuis le reseau -> utiliser H_image ORB
use_ldv_cmc:             false
homography_method_image: "orb"

# Pas de GT ni metadata camera depuis un flux reseau
annotation_file: ""
camera_name:     ""
metadata_csv:    []
```

**Etapes** :
```bash
# 1. PC hote - envoyer une video MP4
python tools/frame_sender.py --input data/sequences/video.mp4 --fps 10 --port 9090
#   --input    : chemin video MP4/AVI ou dossier PNG (requis)
#   --fps      : FPS d'envoi (defaut: 10.0)
#   --port     : port HTTP (defaut: 9090)
#   --quality  : qualite JPEG 0-100 (defaut: 90)
#   --host     : interface d'ecoute (defaut: 0.0.0.0)

# 2. Machine de calcul
python main.py --config config_examples/distributed_pc_jetson.yaml
```
La machine de calcul se connecte automatiquement au flux PC et demarre le
traitement. **Ordre de demarrage** : `frame_sender.py` doit etre lance **avant**
le pipeline (le `NetworkFrameReader` tente de se connecter au demarrage, avec
retry automatique).

**Comportements speciaux du flux entrant** :
- **Pas de LDV reseau** : les metadonnees inertielles (azimut/elevation LDV) ne
  sont pas disponibles depuis un flux reseau -> `meta = {}` a chaque frame -> CMC
  automatiquement sur niveau 3 (H_image ORB/ECC si
  `homography_method_image: "orb"`) ou niveau 4 (aucune).
- **FPS automatique depuis `/info`** : `NetworkFrameReader` interroge `GET
  http://PC:9090/info` au demarrage pour recuperer le FPS reel du flux. Si
  `fps: 0` dans le YAML, la valeur du flux est utilisee.
- **Reconnexion automatique** : si la connexion est perdue (pause PC, reseau
  instable), le `NetworkFrameReader` tente de se reconnecter automatiquement
  toutes les 2 secondes.
- **Timeout frame** : si aucune frame n'arrive pendant 5 secondes, la derniere
  frame recue est renvoyee (freeze) -> le pipeline continue sans crash.

Fichiers concernes : `tools/frame_sender.py` (serveur MJPEG, version projet,
importe `utils/stream_server`), `tools/sender/frame_sender.py` (**autonome**),
`data/network_reader.py` (`NetworkFrameReader` : client MJPEG, thread dedie),
`pipeline/builders.py` (`build_loader()` detecte `http://` -> `_NetworkLoaderWrapper`).

### 3.5 Mode 3 - Pipeline distribue complet (Scenario E)

Combinaison des deux modes : entree reseau depuis le PC hote + sortie reseau vers
le PC operateur. C'est le scenario de deploiement operationnel final.

```
PC hote (192.168.100.50)          Jetson (192.168.100.10)       PC operateur
[Video source]                    [NetworkFrameReader]           [mjpeg_receiver.py]
frame_sender.py                   port 9090 <- frames brutes     ou navigateur web
  port 9090 --MJPEG HTTP-->       pipeline MOT+SOT ~43fps        ou VLC
                                  [MJPEGServer]                   <-- POST /click /key
                                  port 8080 --MJPEG HTTP-->
                                             frames annotees -->
```

YAML complet (scenario E) :
```yaml
# Source (flux entrant depuis PC hote)
sequence_dir:    "http://192.168.100.50:9090/stream"
annotation_file: ""
camera_name:     ""
metadata_csv:    []
weights_yolo:    "weights/last.pt"

# Pipeline
tracker_mot:    "custom_kalman"
tracker_sot:    "tracking_tophat"
mot_background: false
n_targets:      1

mode:           "command"    # clics arrivent via POST /click reseau
fps:            10.0
device:         "cuda"

# Rendu
light_render:   true    # bboxes seules -> rapide
local_display:  false   # ZERO X11
save_frames:    false
save_video:     false

# Flux sortant (frames annotees vers PC operateur)
stream_mode:    "mjpeg"
stream_host:    "0.0.0.0"
stream_port:    8080
stream_quality: 70
stream_every:   1        # fps complet (clics necessitent reactivite)

# CMC : pas de LDV reseau -> ORB image
use_ldv_cmc:             false
homography_method_image: "orb"
```

**Etapes de demarrage (dans l'ordre)** :
```bash
# 1. PC hote : envoyer la video
python tools/frame_sender.py --input data/sequences/video.mp4 --fps 10 --port 9090 --quality 90

# 2. Jetson / machine de calcul : lancer le pipeline
python main.py --config config_examples/distributed_pc_jetson.yaml

# 3. PC operateur : affichage interactif
python tools/mjpeg_receiver.py --host 192.168.100.10 --port 8080   # script Python (recommande)
# ou navigateur -> http://192.168.100.10:8080/  (clic gauche/droit + touche M)
# ou VLC -> http://192.168.100.10:8080/stream   (affichage seul, pas de back-channel)
```

**Latences mesurees (LAN Gbit direct)** :

| Trajet | Latence |
|--------|---------|
| PC hote -> Jetson (entree) | ~3 ms/frame |
| Jetson -> PC operateur (sortie) | ~3 ms/frame |
| Total end-to-end | ~6-7 ms overhead |
| Interval a 10 fps | 100 ms |
| Clic -> reaction pipeline | ~6 ms reseau + ~50 ms attente frame = ~56 ms |
| vs local (sans reseau) | ~50 ms |
| Difference percue | ~6 ms -> imperceptible |

### 3.6 Recapitulatif des fichiers reseau

| Fichier | Mode | Role |
|---------|------|------|
| `utils/stream_server.py` | Sortant | `MJPEGServer` (ThreadingHTTPServer) : encodage + HTTP + back-channel |
| `utils/visualizer.py` | Sortant | Integre `MJPEGServer.push()` dans `render()` |
| `tools/frame_sender.py` | Entrant | Serveur (version projet, depend de `utils/stream_server`) |
| `tools/sender/frame_sender.py` | Entrant | **Autonome** - serveur MJPEG integre, aucune dependance projet |
| `data/network_reader.py` | Entrant | `NetworkFrameReader` : client MJPEG pipeline, thread dedie |
| `pipeline/builders.py` | Entrant | Detecte `http://` -> `_NetworkLoaderWrapper` |
| `tools/mjpeg_receiver.py` | Sortant | Client PC (version projet) |
| `tools/receiver/mjpeg_receiver.py` | Sortant | **Autonome** - `pip install opencv numpy requests` |
| `tools/test_stream.py` | Sortant | Test reseau sans pipeline (frames colorees) |
| `config_examples/distributed_pc_receiver_local_display.yaml` | Entrant | PC recoit frames + affichage local |
| `config_examples/distributed_pc_local_stream_out.yaml` | Sortant | PC lit local + stream annote vers operateur |
| `config_examples/distributed_pc_jetson.yaml` | Entrant+Sortant | Pipeline distribue complet (E3) |

### 3.7 A finir / valider sur cible reelle

Points architectures et documentes mais qui necessitent une validation ou
finition sur machine cible reelle :

- Tester `frame_sender.py` -> pipeline end-to-end (valider le FPS reel, la
  reconnexion automatique `NetworkFrameReader`, mesurer la latence reelle vs
  valeurs theoriques ci-dessus).
- Valider le CMC en mode flux entrant (ORB image) : sans LDV, verifier que
  H_image ORB compense correctement, comparer MOTA avec vs sans CMC sur la meme
  sequence.
- Test multi-client sur le flux sortant : `mjpeg_receiver` + navigateur
  simultanement, verifier que les clics d'un seul client sont bien routes.
- `stream_every` adaptatif (parametre YAML existant, fixe pour l'instant) : si
  pipeline > 30 fps, envoyer 1/2 (epargne bande passante) ; si pipeline < 15 fps,
  envoyer 1/1 (garder la fluidite).
- Securite basique (optionnel) : token d'authentification sur POST /click /key,
  evite les injections de clics non desirees sur un reseau partage.

---

## Partie 4 - Build depuis Windows (WSL2)

Procedure exacte pour regenerer `visionnexus_inference_export_standalone.zip` (Partie 2) a
partir d'un PC Windows, sans machine Linux physique : on utilise **WSL2 Ubuntu
22.04** comme machine de build (meme glibc que la cible).

> **Chemins d'exemple** : projet Windows dans
> `<dossier-tracker-source>` (configure par `--source` ou `INFERENCE_TRACKER_SOURCE`).
> Adapter cote WSL si besoin -- dans le contexte de cette app, la source
> equivalente est `Inference_App/tracker/`.

### 4.0 Prerequis Windows : virtualisation

WSL2 exige la virtualisation materielle. Si `wsl --install` se plaint
(`HYPERV_NOT_INSTALLED` / "virtualisation non activee") : activer **Intel VT-x /
AMD SVM** dans le BIOS/UEFI, et la fonctionnalite Windows *Plateforme de machine
virtuelle*. Verifier : Gestionnaire des taches > Performance > Processeur >
*Virtualisation : Active*.

### 4.1 Installer WSL2 + Ubuntu 22.04

PowerShell **administrateur** :
```powershell
wsl --install -d Ubuntu-22.04
```
Redemarrer si demande. Au 1er lancement d'Ubuntu : creer un user + mot de passe
UNIX. Verifier la version 2 :
```powershell
wsl -l -v      # colonne VERSION doit afficher 2
```

### 4.2 Paquets de build (dans le terminal Ubuntu)

```bash
sudo apt update
sudo apt install -y build-essential curl python3 zip git rsync
```
`build-essential` : compilation eventuelle de deps ; `curl` : bootstrap
Miniforge ; `python3` : `export_zip.py` ; `zip`/`rsync` : archive + copie
fiable. Rien d'autre : conda/torch/tensorrt sont geres par le script.

### 4.3 Copier le projet Windows -> home WSL (filesystem natif)

**Important** : builder dans `~` (ext4 natif), **jamais** dans `/mnt/d` (les
symlinks conda cassent sur DrvFs et c'est tres lent). `rsync` est plus robuste
que `cp -r` (qui, relance ou interrompu, cree des copies imbriquees ou
incompletes).
```bash
rsync -a --delete --exclude 'deploy/natif/dist/' \
    /mnt/d/Data/VisionNexus_Inference/ ~/visionnexus_inference/
cd ~/visionnexus_inference
```
Controle rapide (doit matcher la source) :
```bash
find ~/visionnexus_inference/trackers -type f | wc -l
```

### 4.4 Lancer le build

```bash
chmod +x deploy/natif/*.sh
./deploy/natif/build_standalone_zip.sh
```
Le script : bootstrap Miniforge -> env Python 3.10 -> torch cu121 + requirements
+ lapx -> TensorRT 8.6.1 + side-load cuDNN 8 -> `conda-pack` -> assemble le zip.
Sortie : `deploy/natif/dist/visionnexus_inference_export_standalone.zip` (+ `.sha256`), ~5 Go.

> Long build (plusieurs Go telecharges au 1er coup). Pas de GPU requis pour
> builder.

Validation optionnelle (l'env relocalise doit importer) :
```bash
R=/tmp/reloc; rm -rf $R; mkdir $R
tar xzf deploy/natif/dist/visionnexus_inference_export_standalone/env.tar.gz -C $R
source $R/bin/activate && conda-unpack
SITE=$(python -c "import site;print(site.getsitepackages()[0])")
export LD_LIBRARY_PATH="$R/cudnn8/lib:$SITE/tensorrt_libs:$SITE/torch/lib"
for d in "$SITE"/nvidia/*/lib; do export LD_LIBRARY_PATH="$d:$LD_LIBRARY_PATH"; done
python -c "import torch,tensorrt,lap,onnxruntime,cv2,ultralytics; print('OK')"
deactivate; rm -rf $R
```

### 4.5 Recuperer le zip sur D:

`cp` d'un fichier de 5 Go vers `/mnt` echoue souvent (`Cannot allocate memory`,
mmap DrvFs). Utiliser `dd` (streaming) :
```bash
DST=/mnt/d/Data
dd if=deploy/natif/dist/visionnexus_inference_export_standalone.zip \
   of=$DST/visionnexus_inference_export_standalone.zip bs=8M
cp deploy/natif/dist/visionnexus_inference_export_standalone.zip.sha256 $DST/

# verifier l'integrite de la copie D:
cd $DST && sha256sum -c visionnexus_inference_export_standalone.zip.sha256
```
Le `.sha256` sert a verifier, sur la cle USB puis sur la cible, que le transfert
du zip n'a pas corrompu le fichier (`sha256sum -c ...` doit repondre `OK`) avant
de deployer.

### 4.6 Nettoyage WSL

**Vider les fichiers du build** (dans Ubuntu) :
```bash
rm -rf ~/visionnexus_inference ~/.cache/pip /tmp/reloc*
```
Ubuntu et ses paquets restent intacts ; on supprime juste les fichiers du build.

**Recuperer la place disque sur C:** (optionnel). Le nettoyage ci-dessus vide
l'espace *dans* WSL, mais le fichier disque `ext4.vhdx` ne retrecit pas tout seul
cote Windows. Pour reprendre la place (ex. 36 Go -> ~3 Go), **PowerShell
administrateur** (copier-coller tel quel, le chemin est trouve tout seul) :
```powershell
wsl --shutdown
$v = (Get-ChildItem "$env:LOCALAPPDATA\wsl" -Recurse -Filter ext4.vhdx | Select-Object -First 1).FullName
@("select vdisk file=`"$v`"","attach vdisk readonly","compact vdisk","detach vdisk","exit") | Set-Content $env:TEMP\c.txt -Encoding ASCII
diskpart /s $env:TEMP\c.txt
(Get-Item $v).Length/1GB   # doit afficher ~1 a 3 (Go)
```
`compact vdisk` est sur (montage en lecture seule, on ne recupere que le vide) et
**garde Ubuntu 22.04 intact** -- contrairement au mode `--set-sparse
--allow-unsafe` que Windows refuse. A ne pas confondre avec `wsl --unregister`
(ci-dessous).

**Relancer ou repartir de zero sur Ubuntu** :
```powershell
# Relancer Ubuntu (juste rouvrir le shell, rien n'est perdu)
wsl -d Ubuntu-22.04

# Repartir de ZERO : effacer et reinstaller la distro (perd tout le contenu)
wsl --unregister Ubuntu-22.04
wsl --install -d Ubuntu-22.04
```
> `wsl --unregister` **supprime toute la distro** (Ubuntu + fichiers) : a
> n'utiliser que si tu veux vraiment un Ubuntu neuf. Pour un simple menage, 4.6
> (premiere partie) suffit.

### 4.7 Si la cible n'est pas Ubuntu 22.04

L'env est autonome (Python + libs + CUDA embarques) ; la seule contrainte est la
**glibc** : un env compile sur une glibc **plus recente** que la cible casse
(`GLIBC_2.xx not found`). Regle d'or : **builder sur une glibc <= celle de la
cible.**

| Cible | Que faire |
|---|---|
| **Ubuntu 22.04** (glibc 2.35) | Cette procedure (build sur WSL 22.04). |
| **Ubuntu 24.04 / 26.04** (glibc plus recente) | Le zip buildee sur 22.04 fonctionne tel quel (glibc plus ancienne = compatible ascendante). Rien a changer. |
| **Ubuntu 20.04** (glibc 2.31, plus ancienne) | Il faut builder sur 20.04. Installer `wsl --install -d Ubuntu-20.04` et refaire la procedure depuis 4.2. |
| **Autre distro** (RHEL/Rocky...) | Idem : builder sur une base de glibc <= cible. Le plus simple : un conteneur de la bonne famille. |

**Builder sur une autre version d'Ubuntu dans WSL** (ex. cible 24.04, build
exact) :
```powershell
wsl --install -d Ubuntu-24.04
```
puis refaire les etapes 4.2 a 4.6 dans cette distro. Le script
`build_standalone_zip.sh` detecte que la version n'est pas 22.04 et affiche un
simple avertissement (aucun blocage) ; `PYTHON_VERSION` reste 3.10 (l'env est
self-contained, la version d'Ubuntu de build n'impose pas la version de Python).

**Sans WSL supplementaire, via conteneur** (si Docker/Podman dispo) :
```bash
# depuis ~/visionnexus_inference, build dans une base identique a la cible
docker run --rm -v "$PWD":/src -w /src ubuntu:24.04 bash -c \
  "apt update && apt install -y build-essential curl python3 zip git && \
   ./deploy/natif/build_standalone_zip.sh"
```

> A retenir : builder sur **22.04** couvre les cibles 22.04, 24.04 et 26.04. Ne
> pas builder sur plus recent que si la cible est certainement au moins aussi
> recente.
