from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest

from backend.core.chunker import (
    MAX_WORDS,
    MIN_WORDS,
    chunk_document,
    count_words,
    plain_text,
    scan_headings,
)
from tests.helpers import page, prose

FIXTURES = Path(__file__).resolve().parents[2] / "tools" / "docs" / "fixtures"


def chunks_of(body: str, title: str = "Guide"):
    return chunk_document(body, app="annotation", doc_name="user-guide", title=title)


def words(chunk) -> int:
    return count_words(plain_text(chunk.text))


@pytest.mark.skipif(not (FIXTURES / "headings.md").is_file(), reason="fixture partagee absente")
def test_heading_ordinals_match_shared_fixture() -> None:
    body = (FIXTURES / "headings.md").read_text(encoding="utf-8")
    expected = json.loads((FIXTURES / "headings.expected.json").read_text(encoding="utf-8"))
    got = [{"idx": h.idx, "level": h.level, "text": h.text} for h in scan_headings(body)]
    assert got == expected


def test_headings_in_fences_are_not_counted() -> None:
    body = "# A\n\n```bash\n# comment\n## fake\n```\n\n~~~\n# tilde\n~~~\n\n## B\n"
    assert [(h.idx, h.text) for h in scan_headings(body)] == [(0, "A"), (1, "B")]


def test_chunk_heading_idx_counts_h4_and_code() -> None:
    body = (
        "# T\n\n"
        + prose("a", 70)
        + "\n\n## S1\n\n```\n## fake\n```\n\n"
        + prose("b", 70)
        + "\n\n#### Deep\n\n"
        + prose("c", 70)
        + "\n\n## S2\n\n"
        + prose("d", 70)
        + "\n"
    )
    chunks = chunks_of(body)
    # H1=0, S1=1, Deep=2, S2=3 : le titre dans le bloc de code ne compte pas
    assert [c.heading_idx for c in chunks] == [0, 1, 3]
    assert chunks[1].heading_path == ("T", "S1")
    assert "Deep" in chunks[1].text  # H4 : reste dans la section, pas de coupure


def test_split_only_at_h2_h3() -> None:
    body = (
        "# T\n\n"
        + prose("i", 70)
        + "\n\n## A\n\n"
        + prose("a", 70)
        + "\n\n### A1\n\n"
        + prose("b", 70)
        + "\n\n#### A1x\n\n"
        + prose("c", 70)
    )
    chunks = chunks_of(body)
    assert [c.heading_path[-1] for c in chunks] == ["T", "A", "A1"]


def test_code_fence_and_table_are_never_split() -> None:
    code = "```python\n" + "\n\n".join(f"x{i} = {i}" for i in range(400)) + "\n```"
    table = "\n".join(["| a | b |", "|---|---|"] + [f"| k{i} | v{i} |" for i in range(200)])
    body = f"# T\n\n## S\n\n{prose('p', 40)}\n\n{code}\n\n{prose('q', 40)}\n\n{table}\n\n{prose('r', 40)}\n"
    chunks = chunks_of(body)
    # le bloc de code entier tient dans un seul passage, de meme pour le tableau
    assert sum("x0 = 0" in c.text for c in chunks) == 1
    holder = next(c for c in chunks if "x0 = 0" in c.text)
    assert "x399 = 399" in holder.text and holder.text.count("```") == 2
    holder_t = next(c for c in chunks if "| k0 | v0 |" in c.text)
    assert "| k199 | v199 |" in holder_t.text


def test_long_section_is_split_with_overlap_and_bounds() -> None:
    paragraphs = [prose(f"w{i}p", 90) for i in range(8)]
    body = "# T\n\n## Long\n\n" + "\n\n".join(paragraphs) + "\n"
    chunks = chunks_of(body)
    assert len(chunks) > 1
    assert [c.part for c in chunks] == list(range(1, len(chunks) + 1))
    assert {c.heading_idx for c in chunks} == {1}
    assert all(words(c) <= MAX_WORDS + MIN_WORDS for c in chunks)
    # le recouvrement reprend la fin du morceau precedent
    tail = chunks[0].text.split()[-5:]
    assert " ".join(tail) in chunks[1].text.replace("\n", " ")
    assert len({c.pair_key for c in chunks}) == 1


def test_oversized_single_paragraph_is_cut_at_sentences() -> None:
    body = "# T\n\n## S\n\n" + prose("z", 800) + "\n"
    chunks = chunks_of(body)
    assert len(chunks) >= 3
    assert all(words(c) <= MAX_WORDS + MIN_WORDS for c in chunks)


def test_tiny_sections_are_merged_forward() -> None:
    body = (
        "# T\n\nCourte intro.\n\n## A\n\nTrois mots ici.\n\n## B\n\n"
        + prose("b", 90)
        + "\n\n## C\n\n"
        + prose("c", 90)
        + "\n"
    )
    chunks = chunks_of(body)
    assert len(chunks) == 2
    # l intro du H1 suit A et B dans un passage porte par le titre de A
    assert chunks[0].heading_idx == 1 and chunks[0].heading_path == ("T", "A")
    assert "## B" in chunks[0].text and "b0" in chunks[0].text and "Courte intro" in chunks[0].text
    assert chunks[1].heading_idx == 3


def test_tiny_last_section_is_merged_backward() -> None:
    body = "# T\n\n## A\n\n" + prose("a", 100) + "\n\n## Z\n\nFin.\n"
    chunks = chunks_of(body)
    assert len(chunks) == 1 and "Fin." in chunks[0].text


def test_heading_never_ends_a_part() -> None:
    body = "# T\n\n## S\n\n" + prose("a", 296) + "\n\n#### Sous-titre\n\n" + prose("b", 90) + "\n"
    chunks = chunks_of(body)
    for c in chunks[:-1]:
        assert not c.text.rstrip().endswith("#### Sous-titre")
    assert any(c.heading_path[-1] == "Sous-titre" for c in chunks)


def test_pair_key_equal_between_twins() -> None:
    def make(lang: str, title: str) -> str:
        secs = [(f"S{i}", prose(f"{lang}{i}", 90 + 20 * i)) for i in range(4)]
        return page("annotation", "user-guide", lang, title, secs).split("---\n\n", 1)[1]

    fr = chunk_document(make("fr", "Guide"), app="annotation", doc_name="user-guide", title="Guide")
    en = chunk_document(make("en", "Guide"), app="annotation", doc_name="user-guide", title="Guide")
    assert [c.pair_key for c in fr] == [c.pair_key for c in en]
    assert fr[0].pair_key == "annotation/user-guide#1"
    assert fr[0].chunk_hash != en[0].chunk_hash  # textes differents : pas de partage


def test_embed_text_and_hash() -> None:
    body = (
        "# Guide\n\n## Export\n\nVoir [la page](https://exemple.org/x) et ![schema](img/a.png).\n\n"
        "**Important** : utilisez `POST /export` ici pour les *petits* projets, "
        "et beaucoup d'autres mots pour depasser le seuil de fusion " + "mot " * 60 + "\n\n"
        "| Col | Val |\n|---|---|\n| cle | valeur |\n"
    )
    (chunk,) = chunks_of(body)
    assert chunk.embed_text.startswith("Guide > Export\n")  # H1 identique au titre : pas duplique
    assert "https://" not in chunk.embed_text and "img/a.png" not in chunk.embed_text
    assert "la page" in chunk.embed_text and "schema" in chunk.embed_text
    assert "POST /export" in chunk.embed_text and "**" not in chunk.embed_text and "`" not in chunk.embed_text
    assert "cle | valeur" in chunk.embed_text and "---" not in chunk.embed_text
    assert "](" in chunk.text  # le markdown brut est conserve pour l'affichage
    assert chunk.chunk_hash == hashlib.sha256(chunk.embed_text.encode("utf-8")).hexdigest()


def test_chunking_is_deterministic_and_ordered() -> None:
    body = "# T\n\n" + "\n\n".join(f"## S{i}\n\n{prose(f's{i}', 100)}" for i in range(6))
    first, second = chunks_of(body), chunks_of(body)
    assert first == second
    assert [c.ord for c in first] == list(range(len(first)))


def test_no_headings_document() -> None:
    chunks = chunks_of(prose("a", 100))
    assert len(chunks) == 1 and chunks[0].heading_idx == 0 and chunks[0].heading_path == ()


def test_empty_body_and_generated_markers_only() -> None:
    assert chunks_of("") == []
    assert chunks_of("<!-- generated:start -->\n<!-- generated:end -->\n") == []
