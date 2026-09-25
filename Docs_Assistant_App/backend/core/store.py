"""Index SQLite (WAL) : fichiers, passages, embeddings et table FTS5.

La table FTS reste dans la meme transaction que `chunks` : un passage n'existe jamais
sans sa ligne FTS. Les vecteurs sont L2-normalises, donc cosinus = produit scalaire ; ils
sont charges en une matrice float32 contigue (voir `load_snapshot`).
"""

from __future__ import annotations

import json
import shutil
import sqlite3
import threading
import time
from collections.abc import Iterable, Iterator, Sequence
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from backend.core.chunker import Chunk, plain_text
from backend.core.sources import DocFile

# 2 : nom de l'app dans le texte indexe (embeddings et FTS), colonne files.app_label.
# Le changement de version vide l'index : il se reconstruit depuis les pages.
SCHEMA_VERSION = "2"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS files (
    path TEXT PRIMARY KEY, sha256 TEXT NOT NULL, mtime REAL, app TEXT, lang TEXT,
    audience TEXT, doc_type TEXT, doc_name TEXT, title TEXT, app_label TEXT
);
CREATE TABLE IF NOT EXISTS chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_path TEXT NOT NULL, ord INTEGER NOT NULL, heading_path TEXT NOT NULL,
    heading_idx INTEGER NOT NULL, part INTEGER, pair_key TEXT NOT NULL,
    text TEXT NOT NULL, embed_text TEXT NOT NULL, chunk_hash TEXT NOT NULL,
    app TEXT, lang TEXT, audience TEXT, doc_type TEXT, doc_name TEXT, title TEXT
);
CREATE INDEX IF NOT EXISTS chunks_file ON chunks(file_path);
CREATE INDEX IF NOT EXISTS chunks_hash ON chunks(chunk_hash);
CREATE INDEX IF NOT EXISTS chunks_pair ON chunks(pair_key);
CREATE TABLE IF NOT EXISTS embeddings (
    chunk_hash TEXT NOT NULL, model_id TEXT NOT NULL, dim INTEGER NOT NULL, vec BLOB NOT NULL,
    PRIMARY KEY (chunk_hash, model_id)
);
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
    text, title, heading_path, tags, app, chunk_id UNINDEXED,
    tokenize='unicode61 remove_diacritics 2'
);
"""

# Poids bm25 par colonne (text, title, heading_path, tags, app, chunk_id) : le fil d'Ariane
# et les tags valent plus que le corps, le titre de page est commun a tous ses passages.
FTS_WEIGHTS = (1.0, 1.5, 3.0, 2.0, 2.0, 0.0)


@dataclass(frozen=True)
class ChunkMeta:
    id: int
    file_path: str
    app: str
    lang: str
    audience: str
    doc_type: str
    doc_name: str
    title: str
    heading_path: tuple[str, ...]
    heading_idx: int
    part: int | None
    pair_key: str


@dataclass(frozen=True)
class Snapshot:
    """Vue immuable de l'index pour la recherche, remplacee d'un bloc apres chaque sync."""

    metas: dict[int, ChunkMeta]
    vec_ids: np.ndarray  # int64, aligne sur les lignes de `matrix`
    matrix: np.ndarray  # float32 (n, dim), L2-normalise
    pair_langs: dict[str, frozenset[str]]
    labels: dict[str, str] = field(default_factory=dict)  # id d'app -> nom affiche

    @staticmethod
    def empty() -> Snapshot:
        return Snapshot({}, np.zeros(0, dtype=np.int64), np.zeros((0, 0), dtype=np.float32), {})


def vec_to_blob(vec: np.ndarray) -> bytes:
    return np.ascontiguousarray(vec, dtype="<f4").tobytes()


def blob_to_vec(blob: bytes) -> np.ndarray:
    return np.frombuffer(blob, dtype="<f4")


class Store:
    """Une connexion par thread (sqlite3 l'exige) ; les ecritures sont serialisees."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self._local = threading.local()
        self._write_lock = threading.RLock()
        path.parent.mkdir(parents=True, exist_ok=True)
        with self._write_lock, self._conn() as con:
            self._migrate(con)
            con.executescript(_SCHEMA)
            con.execute(
                "INSERT OR IGNORE INTO meta(key, value) VALUES ('schema_version', ?)",
                (SCHEMA_VERSION,),
            )

    @staticmethod
    def _migrate(con: sqlite3.Connection) -> None:
        """Un index d'une autre version est de la donnee derivee : on le jette, la sync le refait."""
        try:
            row = con.execute("SELECT value FROM meta WHERE key = 'schema_version'").fetchone()
        except sqlite3.Error:
            return  # base neuve
        if row is not None and row[0] != SCHEMA_VERSION:
            for table in ("chunks_fts", "chunks", "files", "embeddings", "meta"):
                con.execute(f"DROP TABLE IF EXISTS {table}")

    def _conn(self) -> sqlite3.Connection:
        con: sqlite3.Connection | None = getattr(self._local, "con", None)
        if con is None:
            con = sqlite3.connect(self.path, timeout=30)
            con.row_factory = sqlite3.Row
            con.execute("PRAGMA journal_mode=WAL")
            con.execute("PRAGMA synchronous=NORMAL")
            self._local.con = con
        return con

    @contextmanager
    def transaction(self) -> Iterator[sqlite3.Connection]:
        with self._write_lock:
            con = self._conn()
            try:
                con.execute("BEGIN IMMEDIATE")
                yield con
            except BaseException:
                con.rollback()
                raise
            else:
                con.commit()

    def close(self) -> None:
        con = getattr(self._local, "con", None)
        if con is not None:
            con.close()
            self._local.con = None

    # ---- meta ----------------------------------------------------------- #

    def meta_get(self, key: str, default: str | None = None) -> str | None:
        row = self._conn().execute("SELECT value FROM meta WHERE key = ?", (key,)).fetchone()
        return row["value"] if row else default

    def meta_set(self, **values: str) -> None:
        with self.transaction() as con:
            con.executemany(
                "INSERT INTO meta(key, value) VALUES (?, ?) "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                [(k, str(v)) for k, v in values.items()],
            )

    # ---- fichiers et passages ------------------------------------------- #

    def file_hashes(self) -> dict[str, str]:
        rows = self._conn().execute("SELECT path, sha256 FROM files").fetchall()
        return {r["path"]: r["sha256"] for r in rows}

    def replace_file(self, doc: DocFile, chunks: Sequence[Chunk]) -> None:
        """Remplace fichier, passages et lignes FTS d'une page en une seule transaction."""
        with self.transaction() as con:
            self._delete_file_rows(con, doc.path)
            con.execute(
                "INSERT INTO files(path, sha256, mtime, app, lang, audience, doc_type, doc_name, title,"
                " app_label) VALUES (?,?,?,?,?,?,?,?,?,?)",
                (
                    doc.path,
                    doc.sha256,
                    doc.mtime,
                    doc.app,
                    doc.lang,
                    doc.audience,
                    doc.doc_type,
                    doc.doc_name,
                    doc.title,
                    doc.app_label,
                ),
            )
            tags = " ".join(doc.tags)
            for chunk in chunks:
                cur = con.execute(
                    "INSERT INTO chunks(file_path, ord, heading_path, heading_idx, part, pair_key,"
                    " text, embed_text, chunk_hash, app, lang, audience, doc_type, doc_name, title)"
                    " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (
                        doc.path,
                        chunk.ord,
                        json.dumps(list(chunk.heading_path), ensure_ascii=False),
                        chunk.heading_idx,
                        chunk.part,
                        chunk.pair_key,
                        chunk.text,
                        chunk.embed_text,
                        chunk.chunk_hash,
                        doc.app,
                        doc.lang,
                        doc.audience,
                        doc.doc_type,
                        doc.doc_name,
                        doc.title,
                    ),
                )
                con.execute(
                    "INSERT INTO chunks_fts(text, title, heading_path, tags, app, chunk_id)"
                    " VALUES (?,?,?,?,?,?)",
                    (
                        plain_text(chunk.text),
                        doc.title,
                        " ".join(chunk.heading_path),
                        tags,
                        doc.app_label,
                        cur.lastrowid,
                    ),
                )

    @staticmethod
    def _delete_file_rows(con: sqlite3.Connection, path: str) -> None:
        con.execute(
            "DELETE FROM chunks_fts WHERE chunk_id IN (SELECT id FROM chunks WHERE file_path = ?)",
            (path,),
        )
        con.execute("DELETE FROM chunks WHERE file_path = ?", (path,))
        con.execute("DELETE FROM files WHERE path = ?", (path,))

    def remove_files(self, paths: Iterable[str]) -> None:
        with self.transaction() as con:
            for path in paths:
                self._delete_file_rows(con, path)

    def clear_all(self) -> None:
        with self.transaction() as con:
            for table in ("chunks_fts", "chunks", "files", "embeddings"):
                con.execute(f"DELETE FROM {table}")

    # ---- embeddings ----------------------------------------------------- #

    def missing_embeddings(self, model_id: str) -> list[tuple[str, str]]:
        """(chunk_hash, embed_text) des passages sans vecteur pour ce modele, sans doublon."""
        rows = (
            self._conn()
            .execute(
                "SELECT c.chunk_hash, MIN(c.embed_text) AS embed_text FROM chunks c "
                "LEFT JOIN embeddings e ON e.chunk_hash = c.chunk_hash AND e.model_id = ? "
                "WHERE e.chunk_hash IS NULL GROUP BY c.chunk_hash",
                (model_id,),
            )
            .fetchall()
        )
        return [(r["chunk_hash"], r["embed_text"]) for r in rows]

    def save_embeddings(self, model_id: str, hashes: Sequence[str], vectors: np.ndarray) -> None:
        dim = int(vectors.shape[1])
        with self.transaction() as con:
            con.executemany(
                "INSERT OR REPLACE INTO embeddings(chunk_hash, model_id, dim, vec) VALUES (?,?,?,?)",
                [(h, model_id, dim, vec_to_blob(v)) for h, v in zip(hashes, vectors, strict=True)],
            )

    def drop_other_models(self, model_id: str) -> int:
        with self.transaction() as con:
            return con.execute("DELETE FROM embeddings WHERE model_id != ?", (model_id,)).rowcount

    def gc_embeddings(self) -> int:
        """Supprime les vecteurs qu'aucun passage ne reference plus."""
        with self.transaction() as con:
            return con.execute(
                "DELETE FROM embeddings WHERE chunk_hash NOT IN (SELECT chunk_hash FROM chunks)"
            ).rowcount

    # ---- lecture pour la recherche -------------------------------------- #

    def load_snapshot(self, model_id: str) -> Snapshot:
        con = self._conn()
        metas: dict[int, ChunkMeta] = {}
        pair_langs: dict[str, set[str]] = {}
        for r in con.execute(
            "SELECT id, file_path, app, lang, audience, doc_type, doc_name, title, heading_path,"
            " heading_idx, part, pair_key FROM chunks ORDER BY id"
        ):
            metas[r["id"]] = ChunkMeta(
                id=r["id"],
                file_path=r["file_path"],
                app=r["app"],
                lang=r["lang"],
                audience=r["audience"],
                doc_type=r["doc_type"],
                doc_name=r["doc_name"],
                title=r["title"],
                heading_path=tuple(json.loads(r["heading_path"])),
                heading_idx=r["heading_idx"],
                part=r["part"],
                pair_key=r["pair_key"],
            )
            pair_langs.setdefault(r["pair_key"], set()).add(r["lang"])

        rows = con.execute(
            "SELECT c.id, e.dim, e.vec FROM chunks c JOIN embeddings e "
            "ON e.chunk_hash = c.chunk_hash AND e.model_id = ? ORDER BY c.id",
            (model_id,),
        ).fetchall()
        if rows:
            dim = rows[0]["dim"]
            matrix = np.vstack([blob_to_vec(r["vec"]) for r in rows]).astype(np.float32, copy=False)
            if matrix.shape[1] != dim:
                raise ValueError("dimension des embeddings incoherente")
            ids = np.fromiter((r["id"] for r in rows), dtype=np.int64, count=len(rows))
        else:
            ids = np.zeros(0, dtype=np.int64)
            matrix = np.zeros((0, 0), dtype=np.float32)
        labels = {
            r["app"]: r["app_label"]
            for r in con.execute("SELECT DISTINCT app, app_label FROM files WHERE app_label != ''")
        }
        return Snapshot(metas, ids, matrix, {k: frozenset(v) for k, v in pair_langs.items()}, labels)

    def chunk_texts(self, ids: Sequence[int]) -> dict[int, str]:
        if not ids:
            return {}
        marks = ",".join("?" for _ in ids)
        rows = (
            self._conn().execute(f"SELECT id, text FROM chunks WHERE id IN ({marks})", tuple(ids)).fetchall()
        )
        return {r["id"]: r["text"] for r in rows}

    def keyword_hits(self, match: str, limit: int) -> list[tuple[int, float]]:
        """[(chunk_id, bm25)] tries du meilleur au moins bon ; `match` doit deja etre sur."""
        if not match:
            return []
        rows = (
            self._conn()
            .execute(
                f"SELECT chunk_id, bm25(chunks_fts, {', '.join(str(w) for w in FTS_WEIGHTS)}) AS score "
                "FROM chunks_fts WHERE chunks_fts MATCH ? ORDER BY score LIMIT ?",
                (match, limit),
            )
            .fetchall()
        )
        return [(int(r["chunk_id"]), float(r["score"])) for r in rows]

    # ---- statistiques --------------------------------------------------- #

    def counts(self, model_id: str) -> dict:
        con = self._conn()
        per_app = {
            r["app"]: r["n"]
            for r in con.execute("SELECT app, COUNT(*) AS n FROM chunks GROUP BY app ORDER BY app")
        }
        per_lang = {
            r["lang"]: r["n"]
            for r in con.execute("SELECT lang, COUNT(*) AS n FROM chunks GROUP BY lang ORDER BY lang")
        }
        embedded = con.execute(
            "SELECT COUNT(*) AS n FROM chunks c JOIN embeddings e "
            "ON e.chunk_hash = c.chunk_hash AND e.model_id = ?",
            (model_id,),
        ).fetchone()["n"]
        return {
            "files": con.execute("SELECT COUNT(*) AS n FROM files").fetchone()["n"],
            "chunks": sum(per_app.values()),
            "embedded": embedded,
            "per_app": per_app,
            "per_lang": per_lang,
        }


def peek_meta(path: Path, key: str) -> str | None:
    """Lit une cle meta d'un fichier SQLite sans le modifier (le seed reste intact)."""
    try:
        con = sqlite3.connect(f"file:{path.as_posix()}?mode=ro", uri=True)
    except sqlite3.Error:
        return None
    try:
        row = con.execute("SELECT value FROM meta WHERE key = ?", (key,)).fetchone()
        return row[0] if row else None
    except sqlite3.Error:
        return None
    finally:
        con.close()


def install_seed(seed: Path, target: Path, model_id: str) -> bool:
    """Copie le seed vers `target` s'il est compatible (modele et schema identiques)."""
    if target.exists() or not seed.is_file():
        return False
    if peek_meta(seed, "model_id") != model_id or peek_meta(seed, "schema_version") != SCHEMA_VERSION:
        return False
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_name(target.name + f".{int(time.time())}.tmp")
    shutil.copyfile(seed, tmp)
    tmp.replace(target)
    return True
