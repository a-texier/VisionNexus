#!/usr/bin/env bash
# ============================================================
# Option "standalone" : produit UN SEUL zip auto-suffisant
#   deploy/natif/dist/Tracker_sol_export_standalone.zip
# contenant :
#   - Tracker_sol/        : le code (memes exclusions que export_zip.py)
#   - env.tar.gz      : un environnement Python 3.10 RELOCATABLE (conda-pack)
#                       avec torch cu121 + requirements.txt + tensorrt (export)
#   - install_standalone.sh / run.sh / README_STANDALONE.txt
#
# Sur la CIBLE (Ubuntu 22.04 x86_64, air-gap, driver NVIDIA deja OK) :
#   unzip Tracker_sol_export_standalone.zip
#   cd Tracker_sol_export_standalone
#   ./install_standalone.sh          # dezippe l'env + conda-unpack (1 fois)
#   ./run.sh --config config_examples/B_mot_sot_command.yaml
# -> aucun apt, aucun venv a construire, aucune compilation, zero internet.
#
# A executer sur la machine de BUILD : Ubuntu (idealement 22.04) x86_64, internet.
# Rien a pre-installer : Miniforge est bootstrappe automatiquement.
#
# Usage (depuis la racine du repo) :
#   ./deploy/natif/build_standalone_zip.sh
#
# Variables d'env optionnelles :
#   TORCH_VERSION=2.5.1  TORCHVISION_VERSION=0.20.1
#   TENSORRT_VERSION=8.6.1        (mettre "" pour ne PAS embarquer TensorRT)
#   PYTHON_VERSION=3.10
# ============================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT_DIR="${REPO_ROOT}/deploy/natif/dist"
BUILD_DIR="${OUT_DIR}/_standalone_build"
STAGE_DIR="${OUT_DIR}/Tracker_sol_export_standalone"
ZIP_PATH="${OUT_DIR}/Tracker_sol_export_standalone.zip"

TORCH_VERSION="${TORCH_VERSION:-2.5.1}"
TORCHVISION_VERSION="${TORCHVISION_VERSION:-0.20.1}"
TENSORRT_VERSION="${TENSORRT_VERSION:-8.6.1}"
PYTHON_VERSION="${PYTHON_VERSION:-3.10}"
ENV_NAME="Tracker_sol_env"

cd "${REPO_ROOT}"

# ── 0) Garde-fous plateforme ────────────────────────────────────
if [[ "$(uname -m)" != "x86_64" ]]; then
    echo "ERREUR: build a lancer sur x86_64 (cible = x86_64). uname -m = $(uname -m)" >&2
    exit 1
fi
UBUNTU_VER="$(. /etc/os-release 2>/dev/null && echo "${VERSION_ID:-?}")"
if [[ "${UBUNTU_VER}" != "22.04" ]]; then
    echo "ATTENTION: machine de build = Ubuntu ${UBUNTU_VER}, cible attendue = 22.04." >&2
    echo "           L'env conda est portable mais un glibc plus recent que la cible" >&2
    echo "           peut casser a l'execution. Ideal : builder sur 22.04 (ou conteneur ubuntu:22.04)." >&2
fi

mkdir -p "${BUILD_DIR}"

# ── 1) Bootstrap Miniforge (offline pas requis ici : machine de build a internet) ─
CONDA_ROOT="${BUILD_DIR}/miniforge"
if [[ ! -x "${CONDA_ROOT}/bin/conda" ]]; then
    echo "== 1/6 Bootstrap Miniforge =="
    INSTALLER="${BUILD_DIR}/miniforge.sh"
    curl -fsSL -o "${INSTALLER}" \
        "https://github.com/conda-forge/miniforge/releases/latest/download/Miniforge3-Linux-x86_64.sh"
    bash "${INSTALLER}" -b -p "${CONDA_ROOT}"
    rm -f "${INSTALLER}"
else
    echo "== 1/6 Miniforge deja present (${CONDA_ROOT}) =="
fi
# shellcheck disable=SC1091
source "${CONDA_ROOT}/etc/profile.d/conda.sh"

# ── 2) Env Python isole ─────────────────────────────────────────
ENV_PREFIX="${BUILD_DIR}/${ENV_NAME}"
echo "== 2/6 Creation de l'env Python ${PYTHON_VERSION} =="
rm -rf "${ENV_PREFIX}"
conda create -y -p "${ENV_PREFIX}" "python=${PYTHON_VERSION}" pip
conda activate "${ENV_PREFIX}"

python -m pip install --upgrade pip setuptools wheel

# ── 3) torch cu121 + requirements.txt ───────────────────────────
echo "== 3/6 torch cu121 + requirements.txt =="
python -m pip install \
    "torch==${TORCH_VERSION}" "torchvision==${TORCHVISION_VERSION}" \
    --extra-index-url https://download.pytorch.org/whl/cu121

# lap / cython_bbox : pas de wheel utilisable dans les pins d'origine.
#   - lap==0.4.0 : paquet abandonne, son setup.py ne compile plus avec les
#     toolchains recents. On le REMPLACE par lapx (fork maintenu, meme API
#     `import lap` / lapjv) qui fournit une WHEEL prebuilte. (deja dans
#     requirements.txt ; on l'installe aussi explicitement par securite.)
#   - cython_bbox==0.1.3 : NON installe. Meme compile, il crashe a l'import avec
#     numpy>=1.24 (`np.float` supprime), et on pin numpy==1.26.4. Les trackers
#     (BoT-SORT et ByteTrack) ont un fallback numpy pur sur ImportError -> ne pas
#     l'installer declenche proprement ce fallback (accel C en moins, resultats
#     identiques). cython_bbox est donc commente dans requirements.txt.
LAPX_VERSION="${LAPX_VERSION:-0.5.11}"
echo "== 3bis requirements.txt (cython_bbox exclu) + lapx==${LAPX_VERSION} =="
python -m pip install "setuptools<80" wheel
python -m pip install -r "${REPO_ROOT}/requirements.txt"
python -m pip install "lapx==${LAPX_VERSION}"

# ── 4) TensorRT (export .engine) + cuDNN 8 side-load ────────────
# 1) Le meta-paquet `tensorrt` relance un pip imbrique qui n'interroge QUE
#    l'index NVIDIA pour tensorrt_libs/bindings -> on pre-installe les composants
#    avec les DEUX index. 2) Le meta doit s'installer en --no-build-isolation :
#    sinon son pip imbrique tourne dans l'overlay d'isolation ou pip n'est pas
#    visible ("No module named pip"). 3) TRT 8.6 lie libcudnn.so.8, or torch
#    embarque cuDNN 9 (libcudnn.so.9) -> on side-load cuDNN 8 dans un dossier
#    dedie (sonames differents = cohabitation), que run.sh ajoute au LD_LIBRARY_PATH.
if [[ -n "${TENSORRT_VERSION}" ]]; then
    echo "== 4/6 TensorRT ${TENSORRT_VERSION} (+ cuDNN 8 side-load) =="
    python -m pip install --extra-index-url https://pypi.nvidia.com \
        "tensorrt_libs==${TENSORRT_VERSION}" "tensorrt_bindings==${TENSORRT_VERSION}"
    python -m pip install --no-build-isolation --extra-index-url https://pypi.nvidia.com \
        "tensorrt==${TENSORRT_VERSION}"

    CUDNN8_VERSION="${CUDNN8_VERSION:-8.9.7.29}"
    echo "== cuDNN 8 side-load (${CUDNN8_VERSION}) pour TensorRT =="
    TMPDL="$(mktemp -d)"
    python -m pip download --no-deps -d "${TMPDL}" "nvidia-cudnn-cu12==${CUDNN8_VERSION}"
    ENV_PREFIX="${ENV_PREFIX}" TMPDL="${TMPDL}" python - <<'PY'
import glob, os, zipfile
whl = glob.glob(os.path.join(os.environ["TMPDL"], "nvidia_cudnn_cu12-*.whl"))[0]
dst = os.path.join(os.environ["ENV_PREFIX"], "cudnn8", "lib")
os.makedirs(dst, exist_ok=True)
n = 0
with zipfile.ZipFile(whl) as z:
    for e in z.namelist():
        base = os.path.basename(e)
        if "/cudnn/lib/" in e and ".so" in base:
            open(os.path.join(dst, base), "wb").write(z.read(e))
            n += 1
print("cuDNN 8 :", n, "libs ->", dst)
PY
    rm -rf "${TMPDL}"
else
    echo "== 4/6 TensorRT ignore (TENSORRT_VERSION vide) =="
fi

# ── 5) conda-pack -> env.tar.gz relocatable ─────────────────────
echo "== 5/6 conda-pack (env relocatable) =="
python -m pip install conda-pack
rm -rf "${STAGE_DIR}"
mkdir -p "${STAGE_DIR}"
# CLI standalone (present dans env/bin apres le pip install ci-dessus),
# pas la sous-commande `conda pack` qui exigerait conda-pack dans l'env base.
# --ignore-missing-files : pip a legitimement remplace des paquets aussi geres
# par conda (setuptools downgrade <80, packaging==24.2 de requirements.txt) ;
# sans ce flag conda-pack refuse l'env comme "incoherent".
conda-pack -p "${ENV_PREFIX}" -o "${STAGE_DIR}/env.tar.gz" --n-threads -1 --ignore-missing-files

conda deactivate

# ── 6) Assemblage du zip (code + env + scripts) ─────────────────
echo "== 6/6 Assemblage Tracker_sol/ (via export_zip.py) + scripts =="
python3 "${REPO_ROOT}/export_zip.py" --nozip -o "${STAGE_DIR}/Tracker_sol"

cp "${REPO_ROOT}/deploy/natif/standalone_run.sh"     "${STAGE_DIR}/run.sh"
cp "${REPO_ROOT}/deploy/natif/standalone_install.sh" "${STAGE_DIR}/install_standalone.sh"
chmod +x "${STAGE_DIR}/run.sh" "${STAGE_DIR}/install_standalone.sh"

# Doc complete embarquee (reference hors ligne sur la cible).
cp "${REPO_ROOT}/../docs/deployment.md" "${STAGE_DIR}/deployment.md"

# README court cote cible : les etapes + les chemins a verifier/changer au besoin.
cat > "${STAGE_DIR}/README_STANDALONE.txt" <<EOF
==============================================================================
 Tracker_sol_export_standalone - genere le $(date -Iseconds)
 Build : $(. /etc/os-release 2>/dev/null && echo "${PRETTY_NAME:-?}")
 torch=${TORCH_VERSION} torchvision=${TORCHVISION_VERSION} tensorrt=${TENSORRT_VERSION:-none} python=${PYTHON_VERSION}
==============================================================================

PREREQUIS CIBLE : Ubuntu 22.04 x86_64 + driver NVIDIA fonctionnel (nvidia-smi OK).
Aucun internet, aucun apt, aucune compilation requis sur la cible.

------------------------------------------------------------------------------
 CE QU'IL FAUT FAIRE SUR LA CIBLE (dans l'ordre) + CE QU'ON DOIT VOIR
------------------------------------------------------------------------------
 0) Integrite AVANT de dezipper, depuis le dossier ou est le zip :
      sha256sum -c Tracker_sol_export_standalone.zip.sha256
    ATTENDU ->  Tracker_sol_export_standalone.zip: OK
    (si "FAILED" : le transfert USB a corrompu le zip, le recopier.)

 1) Dezipper et entrer dans le dossier :
      unzip Tracker_sol_export_standalone.zip
      cd Tracker_sol_export_standalone

 2) Installer (une seule fois) :
      ./install_standalone.sh
    ATTENDU (dans l'ordre) ->
      - une ligne "NVIDIA <nom GPU>, <version driver>"   (nvidia-smi OK)
      - "== Extraction de l'environnement Python =="
      - "== conda-unpack (reecriture des chemins) =="
      - "OK. Environnement pret dans .../env."
    -> cree le dossier ./env/ (voir STRUCTURE). AUCUN conda n'est installe sur le
       systeme : env/ est un env conda deja construit, juste "deplie" ici.

 3) Lancer :
      ./run.sh --config config_examples/B_mot_sot_command.yaml
    ATTENDU -> les logs de la pipeline Tracker_SOL demarrent (chargement du modele
      YOLO, ouverture sequence/flux, tracking). Mode interactif : une fenetre
      OpenCV s'ouvre. Mode headless : des fichiers apparaissent sous Tracker_sol/outputs/.
    Verif GPU rapide (hors pipeline) :
      source env/bin/activate
      python -c "import torch; print(torch.cuda.is_available(), torch.cuda.get_device_name(0))"
      ATTENDU ->  True   NVIDIA <modele du GPU> ...

------------------------------------------------------------------------------
 STRUCTURE APRES ./install_standalone.sh
------------------------------------------------------------------------------
 Tracker_sol_export_standalone/
 |- env/                      env Python 3.10 AUTONOME (conda-pack deplie, relocatable)
 |   |- bin/python            l'interpreteur (aucun Python systeme requis)
 |   |- lib/python3.10/site-packages/
 |   |   |- torch/lib/                libs de torch
 |   |   |- nvidia/<comp>/lib/        CUDA userspace : cublas, cudnn 9, cufft,
 |   |   |                            cusparse, nccl... (wheels pip tirees par torch)
 |   |   |- tensorrt/  tensorrt_libs/ TensorRT 8.6 (libnvinfer*.so) + bindings
 |   |   \- onnxruntime, opencv, ultralytics, lap (via lapx), scipy, numpy...
 |   \- cudnn8/lib/           cuDNN 8 (libcudnn.so.8) pour TensorRT 8.6, a cote du
 |                            cuDNN 9 de torch (sonames .so.8 vs .so.9 = cohabitation)
 |- Tracker_sol/                  le code : main.py, pipeline/, trackers/, weights/,
 |                            config_examples/, data/rejeu, data/network...
 |- run.sh                    active env/ + cable LD_LIBRARY_PATH + lance main.py
 |- install_standalone.sh
 |- deployment.md             doc complete (conteneur/natif/reseau/WSL)
 \- README_STANDALONE.txt     ce fichier

 => Les libs NVIDIA / CUDA / cuDNN / TensorRT ne sont PAS dans le systeme : elles
    sont TOUTES sous env/ (site-packages + cudnn8). run.sh les met en tete de
    LD_LIBRARY_PATH, donc la cible n'a besoin que du DRIVER NVIDIA.

Cas nominal : RIEN a modifier. La section ci-dessous ne sert que si un chemin
doit etre adapte a ta machine.

------------------------------------------------------------------------------
 CHEMINS A VERIFIER / CHANGER AU BESOIN (relatifs a ce dossier)
------------------------------------------------------------------------------
  env/                                   Environnement Python (cree par install).
                                         Si tu DEPLACES ce dossier apres install,
                                         relance ./install_standalone.sh.

  env/lib/python3.10/site-packages/      Libs CUDA/cuDNN/TensorRT embarquees.
    {nvidia/*/lib, tensorrt_libs,        Ajoutees seules a LD_LIBRARY_PATH par
     torch/lib}                          run.sh -> rien a faire.

  Tracker_sol/config_examples/*.yaml         La config lancee (--config). Editable
                                         directement (texte, pas de rebuild).

  Tracker_sol/weights/last.pt                Poids YOLO. Remplacer pour changer de modele.

  Tracker_sol/outputs/                       Sorties runtime (vide au depart). Verifier
                                         les droits d'ecriture.

  data/sequences (dans la config)        VIDE dans le zip : copie tes sequences et
                                         pointe leur chemin dans le YAML de config.

  CUDA systeme du drive (/usr/local/cuda) NON requis (env autonome). Seulement si un
                                         module tiers reclame une lib absente de l'env,
                                         edite run.sh et ajoute avant 'exec' :
                                           export LD_LIBRARY_PATH="/chemin/cuda/lib64:\${LD_LIBRARY_PATH}"

Doc complete : deployment.md (dans ce dossier, section "Partie 2 - Chemin natif").
EOF

echo "== Compression du zip =="
rm -f "${ZIP_PATH}"
if command -v zip >/dev/null 2>&1; then
    ( cd "${OUT_DIR}" && zip -r -q "${ZIP_PATH}" "$(basename "${STAGE_DIR}")" )
else
    # Fallback sans le binaire 'zip'
    python3 -c "import shutil,sys; shutil.make_archive(sys.argv[1], 'zip', sys.argv[2], sys.argv[3])" \
        "${ZIP_PATH%.zip}" "${OUT_DIR}" "$(basename "${STAGE_DIR}")"
fi
# .sha256 avec le NOM SEUL (pas le chemin absolu de la machine de build), sinon
# `sha256sum -c` echouerait sur la cible. Verifiable ainsi depuis le dossier du zip :
#   sha256sum -c Tracker_sol_export_standalone.zip.sha256
( cd "${OUT_DIR}" && sha256sum "$(basename "${ZIP_PATH}")" > "$(basename "${ZIP_PATH}").sha256" )

SIZE=$(du -h "${ZIP_PATH}" | cut -f1)
echo
echo "Termine : ${ZIP_PATH} (${SIZE})"
echo "A copier tel quel sur la cle USB. Sur la cible :"
echo "  unzip Tracker_sol_export_standalone.zip"
echo "  cd Tracker_sol_export_standalone && ./install_standalone.sh && ./run.sh --config ..."
