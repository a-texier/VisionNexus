#!/usr/bin/env bash
# ============================================================
# Embarque dans Tracker_sol_export_standalone.zip -> copie en run.sh.
# Active l'env relocatable et lance main.py.
#
# Les libs CUDA/cuDNN/TensorRT userspace sont EMBARQUEES dans l'env (wheels pip
# nvidia-* / tensorrt) : on les met en tete de LD_LIBRARY_PATH pour que l'env
# soit autonome et n'ait besoin que du DRIVER NVIDIA sur la cible.
#
# Usage :
#   ./run.sh --config config_examples/B_mot_sot_command.yaml
# ============================================================
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_DIR="${HERE}/env"
CODE_DIR="${HERE}/Tracker_sol"

if [[ ! -f "${ENV_DIR}/bin/activate" ]]; then
    echo "ERREUR: env absent. Lancer d'abord ./install_standalone.sh" >&2
    exit 1
fi

# shellcheck disable=SC1091
source "${ENV_DIR}/bin/activate"

# Libs CUDA userspace embarquees par les wheels pip (torch, tensorrt, cudnn...).
# cudnn8/lib : cuDNN 8 side-loade pour TensorRT 8.6 (libcudnn.so.8), a cote du
# cuDNN 9 de torch (libcudnn.so.9) present dans nvidia/cudnn/lib.
SITE="$(python -c 'import site; print(site.getsitepackages()[0])')"
for d in "${ENV_DIR}/cudnn8/lib" "${SITE}"/nvidia/*/lib "${SITE}"/tensorrt_libs "${SITE}"/torch/lib; do
    [[ -d "${d}" ]] && LD_LIBRARY_PATH="${d}:${LD_LIBRARY_PATH:-}"
done
export LD_LIBRARY_PATH

cd "${CODE_DIR}"
exec python main.py "$@"
