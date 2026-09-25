# ============================================================
# api/docs.py
# Documentation markdown de l'app (dossier Optuna_App/docs/), servie a la
# page Documentation du frontend (/guide).
#
# Une page = deux fichiers : <name>.md (anglais) et <name>.fr.md (francais).
# La liste des pages vient de docs/docs_manifest.json a la racine de la
# suite ; l'app pouvant etre deployee seule, on retombe sur une liste
# integree si le manifeste est absent.
# Prefixe : /api/docs
# ============================================================

import json
import logging
from pathlib import Path, PurePosixPath
from typing import Literal

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/docs", tags=["docs"])

Lang = Literal["en", "fr"]

APP_DIR = Path(__file__).resolve().parents[2]
DOCS_DIR = APP_DIR / "docs"
MANIFEST_PATH = APP_DIR.parent / "docs" / "docs_manifest.json"

# Repli quand le manifeste de la suite n'est pas livre avec l'app.
BUILTIN_DOC_SET: list[dict] = [
    {"name": "README", "doc_type": "readme", "audience": "both", "order": 0},
    {"name": "user-guide", "doc_type": "user-guide", "audience": "user", "order": 10},
    {"name": "workflows", "doc_type": "workflows", "audience": "user", "order": 20},
    {"name": "concepts", "doc_type": "concepts", "audience": "user", "order": 30},
    {"name": "configuration", "doc_type": "configuration", "audience": "both", "order": 40},
    {"name": "troubleshooting", "doc_type": "troubleshooting", "audience": "both", "order": 50},
    {"name": "architecture", "doc_type": "architecture", "audience": "dev", "order": 60},
    {"name": "api-reference", "doc_type": "api-reference", "audience": "dev", "order": 70},
    {"name": "code-map", "doc_type": "code-map", "audience": "dev", "order": 80},
]


# ---- Frontmatter (sous-ensemble YAML : `cle: valeur` a plat, listes [a, b]) ----


def _unquote(value: str) -> str:
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
        return value[1:-1]
    return value


def _parse_value(raw: str) -> str | int | list[str]:
    value = raw.strip()
    if value.startswith("[") and value.endswith("]"):
        inner = value[1:-1].strip()
        return [_unquote(item.strip()) for item in inner.split(",")] if inner else []
    if value.lstrip("-").isdigit():
        return int(value)
    return _unquote(value)


def parse_frontmatter(text: str) -> tuple[dict[str, str | int | list[str]], str]:
    """Separe le frontmatter du corps. Sans bloc `---` valide : ({}, texte)."""
    lines = text.splitlines(keepends=True)
    if not lines or lines[0].strip() != "---":
        return {}, text
    end = next((i for i in range(1, len(lines)) if lines[i].strip() == "---"), None)
    if end is None:
        return {}, text
    meta: dict[str, str | int | list[str]] = {}
    for raw_line in lines[1:end]:
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        key, sep, value = line.partition(":")
        if sep:
            meta[key.strip()] = _parse_value(value)
    return meta, "".join(lines[end + 1 :]).lstrip("\r\n")


# ---- Manifeste et fichiers ----


def load_doc_set(manifest_path: Path) -> list[dict]:
    """Entrees doc_set du manifeste, ou la liste integree s'il est absent/illisible."""
    try:
        entries = json.loads(manifest_path.read_text(encoding="utf-8"))["doc_set"]
    except FileNotFoundError:
        return BUILTIN_DOC_SET
    except (OSError, ValueError, KeyError, TypeError) as exc:
        logger.warning("Manifeste docs illisible (%s) : %s", manifest_path, exc)
        return BUILTIN_DOC_SET
    return [e for e in entries if isinstance(e, dict) and isinstance(e.get("name"), str)]


def doc_path(docs_dir: Path, name: str, lang: Lang) -> Path:
    return docs_dir / (f"{name}.md" if lang == "en" else f"{name}.{lang}.md")


def _other(lang: Lang) -> Lang:
    return "fr" if lang == "en" else "en"


def read_doc(docs_dir: Path, name: str, lang: Lang) -> tuple[Lang, dict, str] | None:
    """(langue servie, frontmatter, corps), avec repli sur l'autre langue."""
    for candidate in (lang, _other(lang)):
        path = doc_path(docs_dir, name, candidate)
        if path.is_file():
            # utf-8-sig : un BOM laisse par un editeur Windows casserait le "---".
            meta, body = parse_frontmatter(path.read_text(encoding="utf-8-sig"))
            return candidate, meta, body
    return None


def _title(docs_dir: Path, name: str, lang: Lang) -> str:
    found = read_doc(docs_dir, name, lang)
    if found is None:
        return name
    title = found[1].get("title")
    return title if isinstance(title, str) and title else name


def safe_asset_path(assets_dir: Path, rel: str) -> Path | None:
    """Chemin sous assets_dir, ou None si rel tente d'en sortir."""
    if not rel or "\\" in rel or ":" in rel:
        return None
    parts = PurePosixPath(rel).parts
    if PurePosixPath(rel).is_absolute() or any(p in ("..", ".") for p in parts):
        return None
    root = assets_dir.resolve()
    target = (root / Path(*parts)).resolve()
    return target if target.is_relative_to(root) else None


# ---- Endpoints ----


@router.get("")
def list_docs(lang: Lang = Query("en")) -> list[dict]:
    """Pages du jeu de docs, triees par `order`, avec les langues disponibles."""
    pages = []
    for entry in load_doc_set(MANIFEST_PATH):
        name = entry["name"]
        pages.append(
            {
                "name": name,
                "title": _title(DOCS_DIR, name, lang),
                "order": entry.get("order", 0),
                "audience": entry.get("audience", "both"),
                "doc_type": entry.get("doc_type", name),
                "langs": [
                    code for code in ("en", "fr") if doc_path(DOCS_DIR, name, code).is_file()
                ],
            }
        )
    return sorted(pages, key=lambda page: page["order"])


# Declare avant /{name} : les chemins d'images contiennent des "/".
@router.get("/assets/{asset_path:path}")
def get_doc_asset(asset_path: str) -> FileResponse:
    target = safe_asset_path(DOCS_DIR / "assets", asset_path)
    if target is None:
        raise HTTPException(status_code=400, detail="Chemin invalide")
    if not target.is_file():
        raise HTTPException(status_code=404, detail="Image introuvable")
    return FileResponse(target)


@router.get("/{name}")
def get_doc(name: str, lang: Lang = Query("en")) -> dict:
    """Une page : frontmatter + corps markdown, avec repli de langue."""
    # Validation stricte contre le manifeste : aucun chemin arbitraire.
    if name not in {entry["name"] for entry in load_doc_set(MANIFEST_PATH)}:
        raise HTTPException(status_code=404, detail=f"Page inconnue : {name}")
    found = read_doc(DOCS_DIR, name, lang)
    if found is None:
        raise HTTPException(status_code=404, detail=f"Page '{name}' pas encore ecrite")
    served, meta, body = found
    title = meta.get("title")
    return {
        "name": name,
        "lang": served,
        "title": title if isinstance(title, str) and title else name,
        "frontmatter": meta,
        "body": body,
    }
