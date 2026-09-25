"""Decoupage d'une page Markdown en passages, deterministe et independant du modele.

Le numero de titre (heading_idx) suit la regle h-<n> de docs/DOC_STYLE.md : tous les
titres ATX du corps (frontmatter retire), comptes depuis 0 dans l'ordre, hors blocs de
code. Le viewer s'en sert pour defiler jusqu'a la section, il ne doit donc jamais deriver.

Tailles en mots (tokens ~ 1.35 x mots) : on fusionne sous MIN_WORDS, on coupe au-dela de
MAX_WORDS aux frontieres de paragraphes avec un recouvrement de OVERLAP_WORDS. Un bloc de
code ou un tableau n'est jamais coupe.
"""

from __future__ import annotations

import hashlib
import re
from collections.abc import Iterator
from dataclasses import dataclass, field

MIN_WORDS = 60
MAX_WORDS = 300
OVERLAP_WORDS = 35
_SPLIT_LEVEL = 3  # on decoupe aux titres H1 a H3

_FENCE_OPEN = re.compile(r"^ {0,3}(`{3,}|~{3,})")
_ATX = re.compile(r"^ {0,3}(#{1,6})\s(.*)$")
_ATX_CLOSING = re.compile(r"(?:^|\s+)#+\s*$")
_LIST_ITEM = re.compile(r"^\s*(?:[-*+]|\d+[.)])\s+")
_SENTENCE_END = re.compile(r"(?<=[.!?])\s+")


@dataclass(frozen=True)
class Heading:
    idx: int
    level: int
    text: str
    line: int  # 1-based dans le corps


@dataclass(frozen=True)
class Chunk:
    ord: int
    heading_path: tuple[str, ...]
    heading_idx: int
    part: int | None  # 1..n si la section a ete coupee, sinon None
    text: str  # markdown brut, pour l'affichage
    embed_text: str  # "titre > fil\ntexte nettoye", recoit le prefixe passage: cote embedder
    chunk_hash: str  # sha256(embed_text)
    pair_key: str  # app/doc#heading_idx : lie la section FR a sa jumelle EN


@dataclass
class _Block:
    kind: str  # heading | para | list | table | code
    raw: str
    plain: str
    words: int
    idx: int  # titre courant (celui du bloc si c'est un titre)
    path: tuple[str, ...]
    level: int = 0  # niveau, pour les blocs heading
    is_overlap: bool = False  # copie de la fin du morceau precedent


@dataclass
class _Section:
    blocks: list[_Block] = field(default_factory=list)

    @property
    def words(self) -> int:
        return sum(b.words for b in self.blocks)


# --------------------------------------------------------------------------- #
# Lecture ligne a ligne : blocs de code et titres
# --------------------------------------------------------------------------- #


def _closes_fence(line: str, fence: str) -> bool:
    stripped = line.strip()
    indent = len(line) - len(line.lstrip(" "))
    return indent <= 3 and len(stripped) >= len(fence) and set(stripped) == {fence[0]}


def _iter_code_mask(lines: list[str]) -> Iterator[tuple[str, bool]]:
    """(ligne, dans_un_bloc_de_code) ; les lignes de fence comptent comme code."""
    fence: str | None = None
    for line in lines:
        if fence is None:
            match = _FENCE_OPEN.match(line)
            if match:
                fence = match.group(1)
                yield line, True
                continue
            yield line, False
        else:
            if _closes_fence(line, fence):
                fence = None
            yield line, True


def _body_lines(body: str) -> list[str]:
    return body.replace("\r\n", "\n").replace("\r", "\n").split("\n")


def scan_headings(body: str) -> list[Heading]:
    """Titres ATX du corps, numerotes selon la regle h-<n>."""
    out: list[Heading] = []
    for lineno, (line, in_code) in enumerate(_iter_code_mask(_body_lines(body)), start=1):
        if in_code:
            continue
        match = _ATX.match(line)
        if match:
            text = _ATX_CLOSING.sub("", match.group(2)).strip()
            out.append(Heading(len(out), len(match.group(1)), text, lineno))
    return out


# --------------------------------------------------------------------------- #
# Texte brut pour l'embedding
# --------------------------------------------------------------------------- #

_HTML_COMMENT = re.compile(r"<!--.*?-->", re.DOTALL)
_IMAGE = re.compile(r"!\[([^\]]*)\]\([^)]*\)")
_LINK = re.compile(r"\[([^\]]+)\]\([^)]*\)")
_REF_LINK = re.compile(r"\[([^\]]+)\]\[[^\]]*\]")
_AUTOLINK = re.compile(r"<(?:https?://|mailto:)[^>]+>")
_INLINE_CODE = re.compile(r"`+([^`]*)`+")
_BOLD = re.compile(r"(\*\*|__)(?=\S)(.+?)(?<=\S)\1")
_ITALIC = re.compile(r"(?<![\w*])\*(?=\S)([^*\n]+?)(?<=\S)\*(?![\w*])")
_TABLE_SEP = re.compile(r"^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$")
_HTML_TAG = re.compile(r"</?[A-Za-z][^>]*>")


def _plain_line(line: str) -> str:
    line = _IMAGE.sub(r"\1", line)
    line = _LINK.sub(r"\1", line)
    line = _REF_LINK.sub(r"\1", line)
    line = _AUTOLINK.sub("", line)
    line = _INLINE_CODE.sub(r"\1", line)
    line = _BOLD.sub(r"\2", line)
    line = _ITALIC.sub(r"\1", line)
    line = _HTML_TAG.sub("", line)
    return line


def plain_text(markdown: str) -> str:
    """Markdown -> texte brut : garde les mots (code, cellules de tableau, texte alternatif),
    retire URL de liens, syntaxe d'image, marqueurs de titre, de liste et d'emphase."""
    text = _HTML_COMMENT.sub("", markdown)
    out: list[str] = []
    fence: str | None = None
    for line in text.split("\n"):
        if fence is None:
            match = _FENCE_OPEN.match(line)
            if match:
                fence = match.group(1)
                continue
        else:
            if _closes_fence(line, fence):
                fence = None
            else:
                out.append(line.strip())
            continue
        stripped = line.strip()
        if not stripped or _TABLE_SEP.match(stripped):
            continue
        stripped = re.sub(r"^#{1,6}\s+", "", stripped)
        stripped = re.sub(r"^>\s?", "", stripped)
        stripped = _LIST_ITEM.sub("", stripped)
        if stripped.startswith("|"):
            cells = [c.strip() for c in stripped.strip("|").split("|")]
            stripped = " | ".join(c for c in cells if c)
        out.append(_plain_line(stripped))
    return "\n".join(line for line in out if line)


def count_words(plain: str) -> int:
    return sum(1 for w in plain.split() if any(c.isalnum() for c in w))


# --------------------------------------------------------------------------- #
# Blocs
# --------------------------------------------------------------------------- #


def _classify(lines: list[str]) -> str:
    if all(line.lstrip().startswith("|") for line in lines):
        return "table"
    if _LIST_ITEM.match(lines[0]):
        return "list"
    return "para"


def _parse_blocks(body: str) -> list[_Block]:
    blocks: list[_Block] = []
    levels: dict[int, str] = {}
    state = {"idx": 0, "path": ()}
    heading_count = 0
    pending: list[str] = []
    code: list[str] = []

    def add(kind: str, raw: str, plain: str, level: int = 0) -> None:
        blocks.append(_Block(kind, raw, plain, count_words(plain), state["idx"], state["path"], level))

    def flush_text() -> None:
        if pending:
            raw = "\n".join(pending)
            add(_classify(pending), raw, plain_text(raw))
            pending.clear()

    def flush_code() -> None:
        if code:
            raw = "\n".join(code)
            add("code", raw, plain_text(raw))
            code.clear()

    for line, in_code in _iter_code_mask(_body_lines(body)):
        if in_code:
            flush_text()
            code.append(line)
            continue
        flush_code()
        match = _ATX.match(line)
        if match:
            flush_text()
            level = len(match.group(1))
            text = _ATX_CLOSING.sub("", match.group(2)).strip()
            for lvl in [k for k in levels if k >= level]:
                del levels[lvl]
            levels[level] = text
            state["idx"] = heading_count
            state["path"] = tuple(levels[k] for k in sorted(levels))
            heading_count += 1
            add("heading", line.strip(), text, level)
        elif not line.strip():
            flush_text()
        else:
            pending.append(line)
    flush_text()
    flush_code()
    # Les blocs vides une fois nettoyes (commentaires generes, separateurs) n'apportent rien.
    return [b for b in blocks if b.plain.strip()]


def _sections(blocks: list[_Block]) -> list[_Section]:
    sections: list[_Section] = []
    for block in blocks:
        if not sections or (block.kind == "heading" and block.level <= _SPLIT_LEVEL):
            sections.append(_Section())
        sections[-1].blocks.append(block)
    return sections


def _merge_small(sections: list[_Section]) -> list[list[_Block]]:
    """Regroupe les sections trop petites avec la suivante (ou la precedente pour la queue)."""
    groups: list[list[_Block]] = []
    words = 0
    for section in sections:
        if groups and words < MIN_WORDS:
            groups[-1].extend(section.blocks)
            words += section.words
        else:
            groups.append(list(section.blocks))
            words = section.words
    if len(groups) > 1 and words < MIN_WORDS:
        tail = groups.pop()
        groups[-1].extend(tail)
    return groups


def _split_oversized(block: _Block) -> list[_Block]:
    """Coupe un paragraphe ou une liste plus long que MAX_WORDS ; code et tableaux restent entiers."""
    if block.kind in ("code", "table", "heading") or block.words <= MAX_WORDS:
        return [block]
    pieces: list[str] = []
    for line in block.raw.split("\n"):
        # Une ligne unique trop longue se coupe aux phrases.
        if count_words(plain_text(line)) > MAX_WORDS:
            pieces.extend(s for s in _SENTENCE_END.split(line) if s.strip())
        else:
            pieces.append(line)
    out: list[_Block] = []
    current: list[str] = []
    current_words = 0
    for piece in pieces:
        w = count_words(plain_text(piece))
        if current and current_words + w > MAX_WORDS:
            out.append(_piece(block, current))
            current, current_words = [], 0
        current.append(piece)
        current_words += w
    if current:
        out.append(_piece(block, current))
    return out


def _piece(block: _Block, lines: list[str]) -> _Block:
    raw = "\n".join(lines)
    plain = plain_text(raw)
    return _Block(block.kind, raw, plain, count_words(plain), block.idx, block.path, block.level)


def _tail_words(block: _Block, limit: int) -> _Block | None:
    """Fin de bloc (~limit mots) pour le recouvrement ; jamais pour code/tableau/titre."""
    if block.kind in ("code", "table", "heading"):
        return None
    if block.words <= limit:
        return _Block(block.kind, block.raw, block.plain, block.words, block.idx, block.path, is_overlap=True)
    words = block.raw.split()
    tail = " ".join(words[-limit:])
    plain = plain_text(tail)
    return _Block("para", tail, plain, count_words(plain), block.idx, block.path, is_overlap=True)


def _pack(blocks: list[_Block]) -> list[list[_Block]]:
    """Empile les blocs en morceaux <= MAX_WORDS (un bloc entier depasse seul), avec recouvrement."""
    expanded = [piece for block in blocks for piece in _split_oversized(block)]
    parts: list[list[_Block]] = []
    current: list[_Block] = []
    words = 0
    for block in expanded:
        if current and words + block.words > MAX_WORDS:
            # Un titre ne finit jamais un morceau : il suit son contenu dans le suivant.
            carry: list[_Block] = []
            while len(current) > 1 and current[-1].kind == "heading":
                carry.insert(0, current.pop())
            parts.append(current)
            overlap = None if carry else _tail_words(current[-1], OVERLAP_WORDS)
            # Pas de recouvrement d'une section a l'autre : il melangerait deux sujets.
            if carry:
                current = carry
            elif overlap is not None and overlap.idx == block.idx and block.kind != "heading":
                current = [overlap]
            else:
                current = []
            words = sum(b.words for b in current)
        current.append(block)
        words += block.words
    if current:
        parts.append(current)
    if len(parts) > 1 and sum(b.words for b in parts[-1] if not b.is_overlap) < MIN_WORDS:
        # Une miette finale est recollee au morceau precedent, quitte a depasser MAX_WORDS.
        tail = parts.pop()
        parts[-1].extend(b for b in tail if not b.is_overlap)
    return parts


def _header(title: str, path: tuple[str, ...], app_label: str = "") -> str:
    trail = list(path)
    if trail and trail[0].strip().lower() == title.strip().lower():
        trail = trail[1:]
    # Le titre d'une page ("Workflows") ne dit pas de quelle app elle parle : on l'ajoute.
    if app_label and app_label.lower() not in title.lower():
        title = f"{app_label} - {title}" if title else app_label
    return " > ".join([title, *trail]) if title else " > ".join(trail)


def _anchor(part: list[_Block]) -> _Block:
    """Bloc qui donne son titre au morceau (heading_idx, fil d'Ariane).

    C'est le premier bloc, sauf quand un court texte d'intro du H1 a ete fusionne avec
    la section suivante : le morceau porte alors le titre de cette section plutot que
    celui de la page, sinon la premiere section de chaque page perdrait son titre."""
    first = part[0]
    if first.kind == "heading" and first.level == 1:
        for block in part[1:]:
            if block.kind == "heading":
                return block
    return first


def chunk_document(body: str, *, app: str, doc_name: str, title: str, app_label: str = "") -> list[Chunk]:
    """Decoupe le corps d'une page (frontmatter deja retire) en passages ordonnes."""
    blocks = _parse_blocks(body)
    if not blocks:
        return []
    groups = _merge_small(_sections(blocks))
    chunks: list[Chunk] = []
    for group in groups:
        parts = _pack(group)
        for number, part in enumerate(parts, start=1):
            anchor = _anchor(part)
            # Les titres qui ancrent le morceau sont deja dans le fil d'Ariane.
            content = [b for b in part if not (b.kind == "heading" and (b is anchor or b is part[0]))]
            if not any(b.plain.strip() for b in content):
                content = part
            text = "\n\n".join(b.raw for b in content)
            body_plain = "\n".join(b.plain for b in content)
            embed_text = f"{_header(title, anchor.path, app_label)}\n{body_plain}"
            chunks.append(
                Chunk(
                    ord=len(chunks),
                    heading_path=anchor.path,
                    heading_idx=anchor.idx,
                    part=number if len(parts) > 1 else None,
                    text=text,
                    embed_text=embed_text,
                    chunk_hash=hashlib.sha256(embed_text.encode("utf-8")).hexdigest(),
                    pair_key=f"{app}/{doc_name}#{anchor.idx}",
                )
            )
    return chunks
