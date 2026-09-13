#!/usr/bin/env bash
# ============================================================
# A executer sur la machine de BUILD (x86_64, podman, internet OK).
# Construit l'image Tracker_SOL (modeles + code inclus), l'exporte en .tar
# et calcule le sha256 pour verification apres transfert USB.
#
# Usage (depuis n'importe où) :
#   ./deploy/conteneur/build_and_export_image.sh [tag]
# ============================================================
set -euo pipefail

TAG="${1:-latest}"
IMAGE="Tracker_sol:${TAG}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DIST_DIR="${REPO_ROOT}/deploy/conteneur/dist"

cd "$REPO_ROOT"

if [[ ! -f "deploy/conteneur/Containerfile" ]]; then
    echo "ERREUR: deploy/conteneur/Containerfile introuvable." >&2
    exit 1
fi

echo "== Build de ${IMAGE} =="
podman build -t "${IMAGE}" -f deploy/conteneur/Containerfile .

echo "== Taille de l'image =="
podman images "Tracker_sol"

mkdir -p "${DIST_DIR}"
TAR_PATH="${DIST_DIR}/Tracker_sol_${TAG}.tar"

echo "== Export en ${TAR_PATH} =="
podman save -o "${TAR_PATH}" "${IMAGE}"

echo "== Checksum =="
sha256sum "${TAR_PATH}" > "${TAR_PATH}.sha256"
cat "${TAR_PATH}.sha256"

echo
echo "Termine. A copier sur la cle USB avec deploy/conteneur/install_target_host_deps.sh :"
echo "  ${TAR_PATH}"
echo "  ${TAR_PATH}.sha256"
echo
echo "Compression optionnelle (plus lent, ~2x plus petit) :"
echo "  zstd -T0 ${TAR_PATH}   # -> ${TAR_PATH}.zst"
