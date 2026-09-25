# ============================================================
# utils/native_share.py
# Traduction chemin POSIX (serveur Linux) -> chemin UNC (client Windows).
#
# Meme logique qu'Annotation_App/backend/utils/native_share.py -- code duplique
# volontairement (chaque app de Computer_Vision_App reste independante, zero
# lib partagee entre apps). Utilise par les endpoints */*-path (chemin natif
# pour la coquille Electron -- desktop/src/imageProtocol.ts).
# ============================================================

import os
import re
from typing import Optional

# Racines de partage connues cote serveur (1er segment du chemin POSIX).
# Doit matcher les racines testees cote client par le lanceur Electron
# (desktop/src/main.ts: KNOWN_SHARE_ROOTS).
_SHARE_ROOTS = ("home", "mnt", "srv", "media", "data")

# Chemin Windows deja natif (deploiement 100% local, meme machine que la
# coquille Electron) : rien a traduire, lecture directe, zero reseau, zero
# hote de partage requis -- avant ce garde-fou le repli HTTP etait force meme en
# local, le pire cas alors que c'est le plus simple a servir nativement.
_WINDOWS_PATH_RE = re.compile(r'^[A-Za-z]:[\\/]|^\\\\')


def to_native_share_path(path_str: str) -> Optional[str]:
    r"""Traduit un chemin POSIX serveur en chemin UNC vu par un client
    Windows : /srv/datasets/xxx -> \\{host}\datasets\xxx. Retourne None si
    aucun hote n'est configure (Parametres > native_share_host) ou si le chemin ne
    correspond a aucune racine partagee."""
    if _WINDOWS_PATH_RE.match(path_str):
        return path_str
    if not path_str.startswith("/"):
        return None
    try:
        from backend.api.settings import load_settings
        host = (load_settings().native_share_host or "").strip()
    except Exception:
        return None
    if not host:
        return None
    parts = [p for p in path_str.split("/") if p]
    if len(parts) >= 2 and parts[0] in _SHARE_ROOTS:
        share, rest = parts[1], parts[2:]
        unc = "\\\\" + host + "\\" + share
        if rest:
            unc += "\\" + "\\".join(rest)
        return unc
    return None


def from_native_share_path(path_str: str) -> Optional[str]:
    r"""Traduit un chemin UNC Windows (\\host\share\rest) en chemin POSIX
    serveur, symetrique de to_native_share_path() -- necessaire cote entree quand le
    backend tourne en processus Linux (lance via SSH sur la VM, meme
    mecanisme de lancement generique que les autres apps) : pathlib.Path y
    est un PosixPath qui ne comprend jamais la syntaxe UNC. Essaie chaque
    racine de partage connue et retourne la premiere qui existe reellement
    sur le disque, sinon la premiere par defaut (message d'erreur lisible).
    None si la chaine n'a pas la forme d'un UNC (pass-through POSIX) ou si le backend
    tourne sous Windows : un UNC y est un chemin valide tel quel, le convertir en
    /srv/... le rendrait introuvable."""
    if os.name == "nt":
        return None
    m = re.match(r'^\\\\([^\\]+)\\([^\\]+)(\\.*)?$', path_str)
    if not m:
        return None
    _host, share, rest = m.groups()
    rest_posix = (rest or "").replace("\\", "/").lstrip("/")
    candidates = [f"/{root}/{share}/{rest_posix}".rstrip("/") for root in _SHARE_ROOTS]
    for c in candidates:
        if os.path.exists(c):
            return c
    return candidates[0]
