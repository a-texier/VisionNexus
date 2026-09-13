# ============================================================
# utils/native_share.py
# Traduction chemin UNC Windows -> chemin POSIX serveur.
#
# Meme logique (et meme duplication assumee) que
# Annotation_App/backend/utils/native_share.py et
# Dataset_Explorer_App/backend/utils/native_share.py : chaque app de la suite
# reste independante, aucune lib partagee.
#
# Cote Orchestrateur, la traduction se fait A LA SOURCE : un chemin saisi ou
# depose dans un node (dataset_path, model_path, sequence_dir) part ensuite
# vers plusieurs sous-apps. Le normaliser ici evite d'avoir a le faire dans
# chacune d'elles, et rend les comparaisons de chemins (doublons de dataset)
# coherentes quel que soit le format saisi.
# ============================================================

import os
import re
from typing import Optional

# Racines de partage connues cote serveur (1er segment du chemin POSIX).
# Doit rester aligne avec les autres apps de la suite.
_SHARE_ROOTS = ("home", "mnt", "srv", "media", "data")

_UNC_RE = re.compile(r'^\\\\([^\\]+)\\([^\\]+)(\\.*)?$')


def from_native_share_path(path_str: str) -> Optional[str]:
    r"""Traduit \\hote\partage\reste en /<racine>/<partage>/<reste>.

    Le backend de l'Orchestrateur tourne en PosixPath sur la VM : un UNC tape
    ou glisse depuis l'explorateur Windows n'y existe jamais. On essaie chaque
    racine de partage connue et on retourne la premiere qui existe reellement
    sur le disque, sinon la premiere (message d'erreur lisible cote sous-app).
    Retourne None si la chaine n'est pas un UNC (pass-through)."""
    m = _UNC_RE.match(path_str or "")
    if not m:
        return None
    _host, share, rest = m.groups()
    rest_posix = (rest or "").replace("\\", "/").lstrip("/")
    candidates = [f"/{root}/{share}/{rest_posix}".rstrip("/") for root in _SHARE_ROOTS]
    for c in candidates:
        if os.path.exists(c):
            return c
    return candidates[0]


def normalize_input_path(path_str: str) -> str:
    """`from_native_share_path` en pass-through total : renvoie toujours une
    chaine utilisable telle quelle (chemin POSIX, chemin Windows local, URL de
    flux tcp://... pour un node Inference). Ne touche que les UNC."""
    if not path_str or not isinstance(path_str, str):
        return path_str
    return from_native_share_path(path_str) or path_str
