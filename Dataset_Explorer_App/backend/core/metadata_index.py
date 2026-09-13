# ============================================================
# core/metadata_index.py
# Index texte (SQLite FTS5) sur les métadonnées CSV/Excel des images.
#
# Pourquoi : `Image.metadata_json` était stocké mais jamais interrogeable —
# impossible de retrouver « toutes les images de telle scène / tel domaine »
# à travers le catalogue. Cet index rend les valeurs des colonnes CSV
# cherchables par mot-clé, tous datasets confondus.
#
# Choix : table FTS5 autonome (et non "external content") — la table source
# `image` est écrite par plusieurs chemins (scan, merge, import) et une table
# externe imposerait des triggers de synchronisation partout. Ici la
# réindexation est explicite, idempotente et par dataset.
# ============================================================

import json
import logging
import re
from typing import Dict, List, Optional, Sequence

from sqlalchemy import text

logger = logging.getLogger(__name__)

FTS_TABLE = "image_metadata_fts"

# Un token FTS5 utile : lettres/chiffres/_ (le reste sert de séparateur).
_TOKEN_RE = re.compile(r"[^\w]+", re.UNICODE)


def _scalar(row) -> int:
    """Valeur d'un COUNT(*) : selon le pilote, `exec()` renvoie un int ou un Row."""
    try:
        return int(row[0])
    except (TypeError, KeyError, IndexError):
        return int(row)


def ensure_fts(session) -> None:
    """Crée la table FTS5 si absente. No-op si SQLite est compilé sans FTS5."""
    try:
        session.exec(text(
            f"CREATE VIRTUAL TABLE IF NOT EXISTS {FTS_TABLE} "
            "USING fts5(content, image_id UNINDEXED, dataset_id UNINDEXED, tokenize='unicode61')"
        ))
        session.commit()
    except Exception:
        logger.exception("FTS5 indisponible — la recherche par metadonnees sera desactivee")
        raise


def fts_available(session) -> bool:
    try:
        session.exec(text(f"SELECT 1 FROM {FTS_TABLE} LIMIT 1"))
        return True
    except Exception:
        return False


def _row_content(filename: str, metadata: dict) -> str:
    """Texte indexé pour une image : `colonne valeur` pour chaque champ.

    Le nom de colonne est indexé avec sa valeur : chercher « scene » ramène
    les images dont une colonne s'appelle scene, et chercher « nuit » celles
    dont une valeur vaut nuit — sans savoir d'avance dans quelle colonne.
    """
    parts: List[str] = [filename or ""]
    for key, value in (metadata or {}).items():
        if value is None or value == "":
            continue
        parts.append(f"{key} {value}")
    return " \n ".join(parts)


def reindex_dataset(session, dataset_id: int) -> int:
    """(Ré)indexe toutes les images d'un dataset. Retourne le nb de lignes."""
    from backend.db.models import Image

    ensure_fts(session)
    session.exec(text(f"DELETE FROM {FTS_TABLE} WHERE dataset_id = :d"), params={"d": dataset_id})

    from sqlmodel import select
    images = session.exec(
        select(Image).where(Image.dataset_id == dataset_id, Image.metadata_json.is_not(None))
    ).all()

    inserted = 0
    for img in images:
        try:
            meta = json.loads(img.metadata_json) if img.metadata_json else {}
        except Exception:
            continue
        if not isinstance(meta, dict) or not meta:
            continue
        session.exec(
            text(f"INSERT INTO {FTS_TABLE}(content, image_id, dataset_id) VALUES (:c, :i, :d)"),
            params={"c": _row_content(img.filename, meta), "i": img.id, "d": dataset_id},
        )
        inserted += 1

    session.commit()
    logger.info("Index metadonnees : %d lignes pour dataset %d", inserted, dataset_id)
    return inserted


def delete_dataset(session, dataset_id: int) -> None:
    try:
        session.exec(text(f"DELETE FROM {FTS_TABLE} WHERE dataset_id = :d"), params={"d": dataset_id})
        session.commit()
    except Exception:
        logger.debug("Suppression index metadonnees ignoree (dataset %d)", dataset_id)


def indexed_dataset_ids(session) -> List[int]:
    try:
        rows = session.exec(text(f"SELECT DISTINCT dataset_id FROM {FTS_TABLE}")).all()
        return sorted(int(r[0]) for r in rows)
    except Exception:
        return []


def build_match_query(raw: str, mode: str = "and") -> str:
    """Transforme une saisie libre en expression FTS5 sûre.

    Les tokens sont requotés : sans ça, un tiret ou une apostrophe dans la
    saisie fait échouer la requête FTS avec une erreur de syntaxe.
    """
    tokens = [t for t in _TOKEN_RE.split(raw or "") if t]
    if not tokens:
        return ""
    joiner = " OR " if mode.lower() == "or" else " AND "
    # Préfixe * sur le dernier token : recherche « au fil de la frappe ».
    quoted = [f'"{t}"' for t in tokens[:-1]] + [f'"{tokens[-1]}"*']
    return joiner.join(quoted)


def search(
    session,
    query: str,
    dataset_ids: Optional[Sequence[int]] = None,
    mode: str = "and",
    limit: int = 100,
    offset: int = 0,
) -> tuple:
    """Recherche plein-texte sur les métadonnées. Retourne (total, [(image_id, dataset_id)])."""
    match = build_match_query(query, mode)
    if not match:
        return 0, []

    where = [f"{FTS_TABLE} MATCH :q"]
    params: Dict = {"q": match}
    if dataset_ids:
        placeholders = ", ".join(f":d{i}" for i in range(len(dataset_ids)))
        where.append(f"dataset_id IN ({placeholders})")
        for i, d in enumerate(dataset_ids):
            params[f"d{i}"] = d
    where_sql = " AND ".join(where)

    total = _scalar(session.exec(
        text(f"SELECT COUNT(*) FROM {FTS_TABLE} WHERE {where_sql}"), params=params
    ).one())

    params_page = dict(params, lim=max(1, min(limit, 500)), off=max(0, offset))
    rows = session.exec(
        text(
            f"SELECT image_id, dataset_id FROM {FTS_TABLE} "
            f"WHERE {where_sql} ORDER BY rank LIMIT :lim OFFSET :off"
        ),
        params=params_page,
    ).all()
    return total, [(int(r[0]), int(r[1])) for r in rows]


def facet_values(
    session,
    column: str,
    dataset_ids: Optional[Sequence[int]] = None,
    limit: int = 50,
) -> List[dict]:
    """Valeurs distinctes d'une colonne de métadonnées + nombre d'images.

    Passe par json_extract (JSON1, intégré à SQLite) plutôt que par l'index FTS :
    on veut ici un comptage exact par valeur, pas une pertinence texte.
    """
    # `column` vient de l'utilisateur : il est injecté dans un chemin JSON, jamais
    # dans la structure SQL — on le passe donc en paramètre lié.
    sql = (
        "SELECT json_extract(metadata_json, '$.' || json_quote(:col)) AS value, COUNT(*) AS n "
        "FROM image WHERE metadata_json IS NOT NULL"
    )
    params: Dict = {"col": column}
    if dataset_ids:
        placeholders = ", ".join(f":d{i}" for i in range(len(dataset_ids)))
        sql += f" AND dataset_id IN ({placeholders})"
        for i, d in enumerate(dataset_ids):
            params[f"d{i}"] = d
    sql += " GROUP BY value HAVING value IS NOT NULL AND value != '' ORDER BY n DESC LIMIT :lim"
    params["lim"] = max(1, min(limit, 500))

    rows = session.exec(text(sql), params=params).all()
    return [{"value": str(r[0]), "count": int(r[1])} for r in rows]
