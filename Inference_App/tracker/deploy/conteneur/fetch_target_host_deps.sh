#!/usr/bin/env bash
# ============================================================
# "Script cle" #1 : a executer AVANT le jour J, sur une machine x86_64
# AVEC internet (typiquement la machine de BUILD elle-meme).
#
# La machine CIBLE ne verra JAMAIS internet -> tout ce dont l'hote cible
# a besoin (driver NVIDIA, podman, nvidia-container-toolkit) doit etre
# telecharge ICI en .deb, puis installe OFFLINE sur la cible avec
# install_target_host_deps.sh.
#
# IMPORTANT - correspondance noyau :
#   Le module noyau NVIDIA (DKMS) est compile pour un uname -r precis.
#   Cette machine doit tourner EXACTEMENT la meme version d'Ubuntu et,
#   idealement, le meme noyau que la cible. Sinon le paquet
#   linux-headers-$(uname -r) telecharge ici ne correspondra pas a la
#   cible et le driver ne s'installera pas.
#   -> Verifier `uname -r` et `lsb_release -a` sur la cible AVANT de
#      lancer ce script, et les comparer a ceux de cette machine.
#
# Usage :
#   DRIVER_VERSION=535 ./deploy/conteneur/fetch_target_host_deps.sh [dossier_sortie]
# ============================================================
set -euo pipefail

DRIVER_VERSION="${DRIVER_VERSION:-535}"
OUT_DIR="${1:-./deploy/conteneur/dist/target_host_bundle}"

echo "== Machine courante =="
echo "Ubuntu   : $(lsb_release -ds 2>/dev/null || echo inconnu)"
echo "Noyau    : $(uname -r)"
echo "-> Doit correspondre a la machine CIBLE. Ctrl-C si ce n'est pas le cas."
echo

mkdir -p "${OUT_DIR}/debs"

echo "== 1/3 Driver NVIDIA (${DRIVER_VERSION}) + DKMS + headers =="
sudo apt-get update
sudo apt-get install --download-only --no-install-recommends -y \
    "nvidia-driver-${DRIVER_VERSION}" \
    "linux-headers-$(uname -r)" \
    dkms build-essential

echo "== 2/3 Podman =="
sudo apt-get install --download-only --no-install-recommends -y podman

echo "== 3/3 NVIDIA Container Toolkit (CDI pour Podman) =="
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey \
  | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list \
  | sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' \
  | sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
sudo apt-get update
sudo apt-get install --download-only --no-install-recommends -y \
    nvidia-container-toolkit nvidia-container-toolkit-base \
    libnvidia-container1 libnvidia-container-tools

echo "== Copie des .deb telecharges =="
cp /var/cache/apt/archives/*.deb "${OUT_DIR}/debs/"

cat > "${OUT_DIR}/README.txt" <<EOF
Bundle genere le $(date -Iseconds)
Machine source : $(lsb_release -ds 2>/dev/null || echo inconnu) / noyau $(uname -r)
Driver NVIDIA  : ${DRIVER_VERSION}

Installation sur la cible (offline) :
  ./install_target_host_deps.sh <ce_dossier>
EOF

TAR_PATH="${OUT_DIR}.tar.gz"
tar -C "$(dirname "${OUT_DIR}")" -czf "${TAR_PATH}" "$(basename "${OUT_DIR}")"
sha256sum "${TAR_PATH}" > "${TAR_PATH}.sha256"

echo
echo "Termine. A copier sur la cle USB avec install_target_host_deps.sh :"
echo "  ${TAR_PATH}"
echo "  ${TAR_PATH}.sha256"
