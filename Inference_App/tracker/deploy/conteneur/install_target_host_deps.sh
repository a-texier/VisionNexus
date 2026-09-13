#!/usr/bin/env bash
# ============================================================
# "Script cle" #2 : a executer SUR LA MACHINE CIBLE (air-gap, offline).
# Installe depuis le bundle produit par fetch_target_host_deps.sh :
# driver NVIDIA, podman, nvidia-container-toolkit + config CDI.
#
# Usage :
#   tar xzf target_host_bundle.tar.gz
#   ./install_target_host_deps.sh ./target_host_bundle
# ============================================================
set -euo pipefail

BUNDLE_DIR="${1:?Usage: $0 /media/usb/target_host_bundle}"

if [[ ! -d "${BUNDLE_DIR}/debs" ]]; then
    echo "ERREUR: ${BUNDLE_DIR}/debs introuvable (bundle incomplet ?)" >&2
    exit 1
fi

echo "== Noyau cible : $(uname -r) =="
[[ -f "${BUNDLE_DIR}/README.txt" ]] && cat "${BUNDLE_DIR}/README.txt"
echo

echo "== Installation offline des .deb =="
# 'apt install ./*.deb' (paquets locaux) resout l'ordre/les dependances
# entre les .deb fournis sans toucher au reseau, tant que le bundle est complet.
sudo apt install -y "${BUNDLE_DIR}"/debs/*.deb

echo "== Verification driver NVIDIA =="
if ! nvidia-smi; then
    echo
    echo "Le driver vient d'etre installe et necessite un redemarrage."
    echo "Relancer ce script (ou juste les etapes CDI ci-dessous) apres reboot :"
    echo "  sudo reboot"
    exit 0
fi

echo "== Generation config CDI pour Podman =="
sudo nvidia-ctk cdi generate --output=/etc/cdi/nvidia.yaml
nvidia-ctk cdi list

echo
echo "OK. La cible est prete a charger l'image (podman load -i Tracker_sol.tar)."
