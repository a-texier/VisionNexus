"""Decouverte des pages de doc a indexer.

Le manifest docs/docs_manifest.json liste les apps (`sources`) et le jeu de pages
(`doc_set`). Les pages vivent dans <App>/docs/*.md (+ *.fr.md) ou dans le dossier
`docs_path` de la source (la suite : docs/), et parfois dans plugins/<plugin>/docs/<App>/.
Ce module n'importe rien de tools/ : le service doit tourner sans ce dossier, d'ou le
petit parseur de frontmatter ci-dessous.
"""

from __future__ import annotations

import dataclasses
import hashlib
import json
import logging
import re
from dataclasses import dataclass, field
from pathlib import Path

logger = logging.getLogger(__name__)

MANIFEST_RELPATH = Path("docs") / "docs_manifest.json"
LANGS = ("fr", "en")

_FM_LINE = re.compile(r"^([A-Za-z_][\w-]*)\s*:\s*(.*)$")

FrontmatterValue = str | list[str]


@dataclass(frozen=True)
class DocFile:
    path: str  # relatif a la racine du depot, separateurs "/"
    sha256: str
    mtime: float
    app: str
    doc_name: str
    lang: str
    doc_type: str
    audience: str
    title: str
    tags: tuple[str, ...]
    body: str = field(repr=False)
    app_label: str = ""  # nom affiche de l'app (titre de son README), indexe avec chaque passage


def _unquote(value: str) -> str:
    v = value.strip()
    if len(v) >= 2 and v[0] in "\"'" and v[-1] == v[0]:
        return v[1:-1]
    return v


def _parse_value(raw: str) -> FrontmatterValue:
    raw = raw.strip()
    if raw.startswith("[") and raw.endswith("]"):
        inner = raw[1:-1].strip()
        return [_unquote(v) for v in inner.split(",") if _unquote(v)] if inner else []
    return _unquote(raw)


def split_frontmatter(text: str) -> tuple[dict[str, FrontmatterValue], str]:
    """(meta, corps). Sans bloc ferme par '---', meta est vide et le corps est le texte entier.

    Tolerant : une ligne hors du sous-ensemble (cle: valeur) est ignoree, pour qu'une
    page au frontmatter incomplet reste indexable.
    """
    text = text.removeprefix("\ufeff").replace("\r\n", "\n").replace("\r", "\n")
    lines = text.split("\n")
    if not lines or lines[0].strip() != "---":
        return {}, text
    end = next((i for i in range(1, len(lines)) if lines[i].strip() == "---"), None)
    if end is None:
        return {}, text
    meta: dict[str, FrontmatterValue] = {}
    for line in lines[1:end]:
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        match = _FM_LINE.match(line)
        if match:
            meta[match.group(1)] = _parse_value(match.group(2))
    return meta, "\n".join(lines[end + 1 :])


def split_doc_name(filename: str) -> tuple[str, str]:
    """'user-guide.fr.md' -> ('user-guide', 'fr') ; 'x.md' -> ('x', 'en')."""
    if filename.lower().endswith(".fr.md"):
        return filename[:-6], "fr"
    return filename[:-3], "en"


def _as_str(value: FrontmatterValue | None) -> str:
    return value.strip() if isinstance(value, str) else ""


def _as_list(value: FrontmatterValue | None) -> tuple[str, ...]:
    if isinstance(value, list):
        return tuple(v for v in value if v)
    return (value,) if isinstance(value, str) and value else ()


def load_manifest(repo_root: Path) -> dict:
    path = repo_root / MANIFEST_RELPATH
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)


def docs_relpath(source: dict) -> str:
    """Dossier des pages d'une source, relatif a la racine du depot."""
    return source.get("docs_path") or f"{source['dir']}/docs"


def _candidate_files(repo_root: Path, source: dict) -> list[Path]:
    """Pages du dossier docs de la source puis plugins/<plugin>/docs/<dir>/*.md, tries (ordre stable)."""
    found: list[Path] = []
    source_dir = source["dir"]
    docs = repo_root / docs_relpath(source)
    if docs.is_dir():
        found.extend(sorted(docs.glob("*.md")))
    plugins = repo_root / "plugins"
    if plugins.is_dir():
        for plugin in sorted(p for p in plugins.iterdir() if p.is_dir()):
            page_dir = plugin / "docs" / source_dir
            if page_dir.is_dir():
                found.extend(sorted(page_dir.glob("*.md")))
    return found


def _read_doc(repo_root: Path, path: Path, app_id: str, doc_set: dict[str, dict]) -> DocFile | None:
    try:
        raw = path.read_bytes()
        stat = path.stat()
    except OSError as exc:
        logger.warning("doc illisible %s : %s", path, exc)
        return None
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        logger.warning("doc ignoree (pas de l'UTF-8) : %s", path)
        return None
    meta, body = split_frontmatter(text)

    doc_name, name_lang = split_doc_name(path.name)
    lang = _as_str(meta.get("lang")).lower()
    if lang not in LANGS:
        lang = name_lang
    app = _as_str(meta.get("app")) or app_id
    if not doc_name or not app:
        return None

    # Repli sur le doc_set quand le frontmatter est incomplet.
    spec = doc_set.get(doc_name, {})
    doc_type = _as_str(meta.get("doc_type")) or str(spec.get("doc_type") or doc_name)
    audience = _as_str(meta.get("audience")) or str(spec.get("audience") or "both")
    title = _as_str(meta.get("title")) or _first_h1(body) or doc_name

    return DocFile(
        path=path.relative_to(repo_root).as_posix(),
        sha256=hashlib.sha256(raw).hexdigest(),
        mtime=stat.st_mtime,
        app=app,
        doc_name=doc_name,
        lang=lang,
        doc_type=doc_type,
        audience=audience,
        title=title,
        tags=_as_list(meta.get("tags")),
        body=body,
    )


def _first_h1(body: str) -> str:
    match = re.search(r"^# +(.+?)\s*$", body, flags=re.MULTILINE)
    return match.group(1) if match else ""


def scan_sources(repo_root: Path) -> list[DocFile]:
    """Toutes les pages des sources `indexed: true`. Leve si le manifest est absent."""
    manifest = load_manifest(repo_root)
    doc_set = {d["name"]: d for d in manifest.get("doc_set", []) if "name" in d}
    docs: list[DocFile] = []
    for source in manifest.get("sources", []):
        if not source.get("indexed"):
            continue
        for path in _candidate_files(repo_root, source):
            doc = _read_doc(repo_root, path, source["id"], doc_set)
            if doc is not None:
                docs.append(doc)
    return _with_labels(docs)


def _with_labels(docs: list[DocFile]) -> list[DocFile]:
    """Pose le nom de l'app sur chaque page. Les titres des autres pages ("Workflows") ne
    disent pas de quelle app elles parlent : sans ce nom, une question qui nomme l'app ne
    peut pas rapprocher ses passages. Le nom entre dans l'empreinte du fichier : le
    renommer re-indexe les pages de l'app."""
    labels: dict[tuple[str, str], str] = {
        (d.app, d.lang): d.title for d in docs if d.doc_name.lower() == "readme"
    }
    out: list[DocFile] = []
    for d in docs:
        label = labels.get((d.app, d.lang)) or labels.get((d.app, "en")) or labels.get((d.app, "fr")) or d.app
        key = hashlib.sha256(f"{d.sha256}|{label}".encode()).hexdigest()
        out.append(dataclasses.replace(d, app_label=label, sha256=key))
    return out
