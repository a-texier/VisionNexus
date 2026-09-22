# ============================================================
# core/metadata_loader.py
# Lecture robuste de métadonnées tabulaires (CSV / Excel) à
# associer aux images d'un dataset.
#
# Robustesse :
#   - CSV/TSV/TXT : détection auto du séparateur (, ; \t |) et de
#     l'encodage (utf-8 → latin-1 en repli).
#   - Excel (.xlsx/.xlsm/.xls) : via pandas + openpyxl/xlrd.
#   - Association : une "colonne clé" contient un identifiant qui
#     correspond au nom de fichier image (avec ou sans extension).
# ============================================================

import logging
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

_CSV_EXT = {".csv", ".tsv", ".txt"}
_EXCEL_EXT = {".xlsx", ".xlsm", ".xls"}
SUPPORTED_METADATA_EXT = _CSV_EXT | _EXCEL_EXT


def _read_dataframe(path: Path):
    """Lit un CSV/Excel en DataFrame pandas (str), robuste séparateur/encodage."""
    import pandas as pd

    ext = path.suffix.lower()
    if ext in _EXCEL_EXT:
        # dtype=str : on garde tout en texte pour un affichage fidèle
        return pd.read_excel(path, dtype=str)

    # CSV/TSV/TXT — détection auto du séparateur (sep=None => moteur python sniffer)
    for enc in ("utf-8-sig", "utf-8", "latin-1"):
        try:
            return pd.read_csv(path, dtype=str, sep=None, engine="python", encoding=enc)
        except UnicodeDecodeError:
            continue
        except Exception:
            # Repli : séparateur virgule strict
            try:
                return pd.read_csv(path, dtype=str, encoding=enc)
            except Exception:
                continue
    raise ValueError(f"Impossible de lire le fichier tabulaire : {path}")


def preview(path_str: str, n_rows: int = 5) -> dict:
    """Retourne {columns, sample_rows, n_rows, format} pour l'UI de mapping.

    Lève ValueError si le fichier est introuvable ou illisible.
    """
    path = Path(path_str)
    if not path.exists() or not path.is_file():
        raise ValueError(f"Fichier introuvable : {path_str}")
    if path.suffix.lower() not in SUPPORTED_METADATA_EXT:
        raise ValueError(f"Format non supporté : {path.suffix} (CSV/TSV/Excel attendus)")

    df = _read_dataframe(path)
    df = df.fillna("")
    columns = [str(c) for c in df.columns]
    sample = [
        {str(k): ("" if v is None else str(v)) for k, v in row.items()}
        for row in df.head(n_rows).to_dict(orient="records")
    ]
    return {
        "columns": columns,
        "sample_rows": sample,
        "n_rows": int(len(df)),
        "format": "excel" if path.suffix.lower() in _EXCEL_EXT else "csv",
    }


def _norm(value: str) -> str:
    return str(value).strip().lower()


def build_key_map(path_str: str, key_column: Optional[str]) -> tuple[dict, list[str]]:
    """Construit un index {clé_normalisée: dict_de_ligne} + la liste des colonnes.

    La clé est prise dans `key_column`. Pour chaque ligne on indexe la valeur
    telle quelle ET son stem (sans extension) pour maximiser le matching sur les
    noms de fichiers image. Si `key_column` est absente/None, on tente la 1re
    colonne. Retourne ({}, columns) si rien d'exploitable.
    """
    path = Path(path_str)
    df = _read_dataframe(path)
    df = df.fillna("")
    columns = [str(c) for c in df.columns]
    if not columns:
        return {}, []

    # Sans colonne clé explicite, on cherche l'en-tête qui ressemble à un nom de
    # fichier avant de retomber sur la 1re colonne (ancien comportement).
    if key_column and key_column in columns:
        key = key_column
    else:
        key = suggest_key_column(columns) or columns[0]

    key_map: dict[str, dict] = {}
    for row in df.to_dict(orient="records"):
        row = {str(k): ("" if v is None else str(v)) for k, v in row.items()}
        raw = row.get(key, "")
        if not raw:
            continue
        variants = {_norm(raw)}
        # variantes utiles pour matcher un nom de fichier
        p = Path(raw)
        variants.add(_norm(p.name))
        variants.add(_norm(p.stem))
        for v in variants:
            if v and v not in key_map:
                key_map[v] = row
    return key_map, columns


def match_image(filename: str, key_map: dict) -> Optional[dict]:
    """Retrouve la ligne de métadonnées pour un nom de fichier image.

    Tente : nom complet, stem, puis nom complet lowercase — tous normalisés.
    """
    if not key_map:
        return None
    name = Path(filename)
    for candidate in (name.name, name.stem, filename):
        hit = key_map.get(_norm(candidate))
        if hit is not None:
            return hit
    return None


# ------------------------------------------------------------------ #
# Rapprochement de colonnes entre CSV hétérogènes                     #
#                                                                     #
# Deux datasets décrivent souvent la même chose avec des en-têtes      #
# différents ("scene" vs "scene_name", "meteo" vs "weather"). Sans     #
# rapprochement, chaque dataset reste un îlot : impossible de filtrer  #
# le catalogue entier sur un critère commun.                          #
# ------------------------------------------------------------------ #

# Colonnes servant d'identifiant de fichier — le seul groupe dont la
# détection automatique a une vraie valeur fonctionnelle (choix de la clé).
_KEY_COLUMN_HINTS = (
    "filename", "file_name", "file", "fichier", "nom_fichier", "nom",
    "image", "img", "image_name", "path", "chemin", "frame", "id",
)


def _canon(name: str) -> str:
    """Forme canonique d'un nom de colonne : minuscules, sans séparateur."""
    return "".join(ch for ch in str(name).lower() if ch.isalnum())


def suggest_key_column(columns: list[str]) -> Optional[str]:
    """Devine la colonne contenant le nom de fichier image.

    Retourne None si aucun en-tête ne ressemble à un identifiant de fichier :
    l'appelant garde alors le comportement historique (1re colonne).
    """
    canon_map = {_canon(c): c for c in columns}
    for hint in _KEY_COLUMN_HINTS:
        if hint in canon_map:
            return canon_map[hint]
    # Repli : un en-tête qui *contient* un indice (ex. "source_filename")
    for hint in ("filename", "fichier", "image", "file"):
        for canon, original in canon_map.items():
            if hint in canon:
                return original
    return None


def suggest_column_mapping(
    columns: list[str],
    known_columns: list[str],
    cutoff: float = 0.82,
) -> dict:
    """Rapproche les colonnes d'un nouveau CSV de celles déjà connues.

    Retourne {colonne_du_csv: {"suggested": colonne_connue, "score": float}}
    uniquement pour les colonnes ayant une correspondance plausible. Le
    rapprochement est une *suggestion* : c'est l'utilisateur qui valide, on ne
    renomme jamais silencieusement une colonne.
    """
    import difflib

    known_canon = {}
    for k in known_columns:
        known_canon.setdefault(_canon(k), k)

    out: dict = {}
    for col in columns:
        canon = _canon(col)
        if not canon:
            continue
        if canon in known_canon and known_canon[canon] != col:
            out[col] = {"suggested": known_canon[canon], "score": 1.0}
            continue

        matches = difflib.get_close_matches(canon, list(known_canon.keys()), n=1, cutoff=cutoff)
        if matches:
            target = known_canon[matches[0]]
            if target != col:
                score = difflib.SequenceMatcher(None, canon, matches[0]).ratio()
                out[col] = {"suggested": target, "score": round(score, 3)}
            continue

        # Variante par inclusion : "scene_name" vs "scene", "altitude_m" vs
        # "altitude". difflib seul les rate (ratio trop bas des que le suffixe
        # est long), alors que c'est la forme la plus courante de divergence
        # d'en-tetes entre deux CSV decrivant la meme chose.
        best, best_score = None, 0.0
        for kcanon, koriginal in known_canon.items():
            if koriginal == col or len(kcanon) < 4 or len(canon) < 4:
                continue
            if kcanon in canon or canon in kcanon:
                short, long_ = sorted((kcanon, canon), key=len)
                score = len(short) / len(long_)
                if score > best_score:
                    best, best_score = koriginal, score
        if best and best_score >= 0.5:
            out[col] = {"suggested": best, "score": round(best_score, 3)}

    return out
