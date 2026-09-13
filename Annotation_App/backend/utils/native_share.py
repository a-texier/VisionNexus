# ============================================================
# utils/native_share.py
# Traduction chemin POSIX (serveur Linux) -> chemin UNC (client Windows).
#
# Deplace depuis main.py : utilise a la fois par les endpoints
# /api/workspace/open* (ouvrir dans l'explorateur Windows) et par
# /api/frames/{id}/image-path (chemin natif des pixels pour la coquille
# Electron). Module neutre pour eviter que dataset.py importe main.py
# (main.py monte et importe deja les routers, risque de cycle).
# ============================================================

import os
import re
from typing import Optional

# Chemin Windows deja natif (C:\..., C:/..., ou deja un UNC \\host\...) :
# lancement LOCAL, le backend tourne sur la MEME machine Windows que la
# coquille Electron -- rien a traduire, lecture directe du disque, zero
# reseau, zero dependance a un hote de partage configure. Avant ce garde-fou,
# to_native_share_path() retournait None immediatement (chemin ne commençant pas par
# "/"), forçant TOUJOURS le repli HTTP meme en local -- le pire cas alors
# que c'est justement le cas ou le chemin natif est le plus simple.
_WINDOWS_PATH_RE = re.compile(r'^[A-Za-z]:[\\/]|^\\\\')


def to_native_share_path(path_str: str) -> Optional[str]:
    r"""Traduit un chemin POSIX serveur en chemin UNC vu par un client
    Windows : /srv/datasets/xxx -> \\{native_share_host}\datasets\xxx. Le 1er segment
    (home, mnt, …) est la racine de partage, le 2e devient le nom de partage.
    Retourne None si le chemin ne correspond à aucune racine partagée."""
    if _WINDOWS_PATH_RE.match(path_str):
        return path_str
    if not path_str.startswith("/"):
        return None
    try:
        from backend.services.settings_service import settings_service
        s = settings_service.load()
        host = (s.get("paths", {}).get("native_share_host") or "").strip()
        roots = s.get("paths", {}).get("shared_roots") or ["home", "mnt", "srv", "media", "data"]
    except Exception:
        host, roots = "", ["home", "mnt", "srv", "media", "data"]
    parts = [p for p in path_str.split("/") if p]
    if len(parts) >= 2 and parts[0] in roots and host:
        share, rest = parts[1], parts[2:]
        unc = "\\\\" + host + "\\" + share
        if rest:
            unc += "\\" + "\\".join(rest)
        return unc
    return None


def from_native_share_path(path_str: str) -> Optional[str]:
    r"""Traduit un chemin UNC Windows (\\host\share\rest) en chemin POSIX
    serveur, symetrique de to_native_share_path() -- necessaire cote entree car le
    backend tourne en processus Linux (lance via SSH sur la VM) : pathlib.Path
    y est un PosixPath qui ne comprend jamais la syntaxe UNC, un chemin
    \\<share-host>\datasets tape/dropped tel quel echoue toujours en
    "introuvable". Essaie chaque racine de partage connue (home, mnt, ...) et
    retourne la premiere qui existe reellement sur le disque, sinon la
    premiere racine par defaut (pour un message d'erreur lisible). None si la
    chaine n'a pas la forme d'un UNC (pass-through pour les chemins POSIX)."""
    m = re.match(r'^\\\\([^\\]+)\\([^\\]+)(\\.*)?$', path_str)
    if not m:
        return None
    _host, share, rest = m.groups()
    rest_posix = (rest or "").replace("\\", "/").lstrip("/")
    try:
        from backend.services.settings_service import settings_service
        s = settings_service.load()
        roots = s.get("paths", {}).get("shared_roots") or ["home", "mnt", "srv", "media", "data"]
    except Exception:
        roots = ["home", "mnt", "srv", "media", "data"]
    candidates = [f"/{root}/{share}/{rest_posix}".rstrip("/") for root in roots]
    for c in candidates:
        if os.path.exists(c):
            return c
    return candidates[0]
