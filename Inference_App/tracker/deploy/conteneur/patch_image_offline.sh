#!/usr/bin/env bash
# ============================================================
# Modifie une image DEJA CHARGEE sur la cible (config, poids, code) sans
# rebuild complet et sans internet : podman cp + podman commit.
# Cree une nouvelle image taggee, l'image source n'est pas touchee.
#
# Usage :
#   ./patch_image_offline.sh <image_source> <image_dest> \
#       <fichier_hote:chemin_dans_le_conteneur> [...]
#
# Exemple - changer un scenario par defaut et remplacer les poids YOLO :
#   ./patch_image_offline.sh Tracker_sol:latest Tracker_sol:patched \
#       ./B_mot_sot_command.yaml:/app/config_examples/B_mot_sot_command.yaml \
#       ./last_v2.pt:/app/weights/last.pt
#
# Pour un simple changement de config au lancement (le plus courant),
# preferer un bind mount -v au lieu de patcher l'image : voir
# docs/deployment.md section "1.9 Modifier ou ajouter des choses sans tout rebuild".
# ============================================================
set -euo pipefail

SRC_IMAGE="${1:?image source, ex: Tracker_sol:latest}"
DST_IMAGE="${2:?image destination (nouveau tag), ex: Tracker_sol:patched}"
shift 2

if [[ $# -eq 0 ]]; then
    echo "ERREUR: aucun fichier a copier fourni." >&2
    echo "Usage: $0 <image_source> <image_dest> <hote:conteneur> [...]" >&2
    exit 1
fi

CID=$(podman create "${SRC_IMAGE}")
trap 'podman rm -f "${CID}" >/dev/null' EXIT

for pair in "$@"; do
    host_path="${pair%%:*}"
    container_path="${pair#*:}"
    if [[ ! -e "${host_path}" ]]; then
        echo "ERREUR: fichier hote introuvable: ${host_path}" >&2
        exit 1
    fi
    echo "COPY ${host_path} -> ${container_path}"
    podman cp "${host_path}" "${CID}:${container_path}"
done

podman commit "${CID}" "${DST_IMAGE}"
echo
echo "Nouvelle image : ${DST_IMAGE}"
echo "Lancer avec : podman run --rm --device nvidia.com/gpu=all ${DST_IMAGE} ..."
