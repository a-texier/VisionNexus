#!/usr/bin/env bash
# ============================================================
# Embarque dans Tracker_sol_export_standalone.zip -> copie en install_standalone.sh.
# A executer UNE FOIS sur la cible apres le unzip.
#   - dezippe l'env conda-pack (env.tar.gz -> env/)
#   - lance conda-unpack pour reecrire les chemins absolus a l'emplacement reel
# Aucun internet, aucun apt.
# ============================================================
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_DIR="${HERE}/env"

if [[ ! -f "${HERE}/env.tar.gz" ]]; then
    echo "ERREUR: env.tar.gz introuvable a cote de ce script." >&2
    exit 1
fi

echo "== Verification driver NVIDIA (prerequis) =="
if ! nvidia-smi >/dev/null 2>&1; then
    echo "ERREUR: nvidia-smi echoue. Le driver NVIDIA doit etre installe et fonctionnel." >&2
    exit 1
fi
nvidia-smi --query-gpu=name,driver_version --format=csv,noheader

echo "== Extraction de l'environnement Python =="
rm -rf "${ENV_DIR}"
mkdir -p "${ENV_DIR}"
tar xzf "${HERE}/env.tar.gz" -C "${ENV_DIR}"

echo "== conda-unpack (reecriture des chemins) =="
# shellcheck disable=SC1091
source "${ENV_DIR}/bin/activate"
conda-unpack
deactivate 2>/dev/null || true

echo
echo "OK. Environnement pret dans ${ENV_DIR}."
echo "Lancer avec : ./run.sh --config config_examples/B_mot_sot_command.yaml"
